import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { TarotCopyComplianceError, TarotCopyService } from "@mystcrag/ai-agent/tarot";

import type {
  CreateTarotSessionRequest,
  CreateTarotSessionResponse,
  GenerateDesignRequest,
  GenerateTarotRecommendationsRequest,
  GenerateTarotRecommendationsResponse,
  GenerateDesignResponse,
  GetTarotSessionResponse,
  RevealTarotSessionRequest,
  RevealTarotSessionResponse,
  SaveTarotSessionRequest,
  SaveTarotSessionResponse,
  SelectTarotCardRequest,
  SelectTarotCardResponse
} from "@mystcrag/design-contract";
import {
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema
} from "@mystcrag/design-contract";
import {
  PersistenceError,
  type CatalogMaterialProduct,
  type TarotRecommendationSnapshot,
  type TarotDrawSnapshot,
  type TarotSessionRepository
} from "@mystcrag/database";
import {
  TAROT_DESIGN_RULE_VERSION,
  createPrivateDrawState,
  deriveDesignSignals,
  revealDraw,
  scoreTarotMaterials,
  selectPosition,
  type RandomSource,
  type RevealedTarotCard,
  type TarotDesignSignals
} from "@mystcrag/tarot-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import { deriveTarotDesignAuthorityId } from "../design/design-api.service.js";
import {
  mapCreateTarotResponse,
  mapGetTarotResponse,
  mapRecommendationsTarotResponse,
  mapRevealTarotResponse,
  mapSaveTarotResponse,
  mapSelectTarotResponse
} from "./tarot.public-mapper.js";
import type {
  TarotApiService,
  TarotCatalogPort,
  TarotDesignPreferences,
  TarotDesignGenerator,
  TarotDesignReader,
  TarotPreferencePort,
  TarotQuestionEncryptionPort,
  TarotRecommendationCopyPort
} from "./tarot.types.js";

const TAROT_DECK_VERSION = "rws-major-minor-v1";
const DEFAULT_WRIST_CIRCUMFERENCE_MM = 155;
const MIN_COMPLETION_MM = 130;
const MAX_COMPLETION_MM = 200;

type TarotDirection = TarotDesignSignals["directions"][number];

const COLOR_HEX: Readonly<Record<string, string>> = Object.freeze({
  amber: "#C8954C",
  blue: "#6F95B5",
  ink: "#31343B",
  ivory: "#F2EEE5",
  rose: "#C98C99",
  violet: "#7562A8"
});

const colorHex = (color: string): string => COLOR_HEX[color] ?? "#777777";

const directionTag = (direction: TarotDirection): string =>
  `tarot-direction-${direction.toLowerCase().replaceAll("_", "-")}`;

const deterministicDesignId = (
  sessionId: string,
  ruleVersion: string,
  rank: number
): string => {
  const digest = createHash("sha256")
    .update(`${sessionId}\u0000${ruleVersion}\u0000${rank}`)
    .digest("hex")
    .slice(0, 32);
  return `tarot-design-${digest}`;
};

const isSellableMaterial = (product: CatalogMaterialProduct): boolean =>
  product.active &&
  product.productType === "MATERIAL" &&
  product.colorTags.length > 0 &&
  Number.isFinite(product.diameterMm) &&
  product.diameterMm > 0 &&
  typeof product.modelAssetKey === "string" &&
  product.modelAssetKey.length > 0 &&
  typeof product.textureAssetKey === "string" &&
  product.textureAssetKey.length > 0;

function sequenceAroundWrist(
  pattern: readonly CatalogMaterialProduct[],
  targetMm = DEFAULT_WRIST_CIRCUMFERENCE_MM
): string[] {
  const sequence: string[] = [];
  let assembledMm = 0;
  let patternIndex = 0;
  while (assembledMm < targetMm) {
    const product = pattern[patternIndex % pattern.length];
    if (!product) {
      throw new DomainApiError("INVENTORY_CHANGED", "No material pattern is available.");
    }
    if (assembledMm + product.diameterMm > MAX_COMPLETION_MM) break;
    sequence.push(product.id);
    assembledMm += product.diameterMm;
    patternIndex += 1;
  }
  if (assembledMm < MIN_COMPLETION_MM || assembledMm > MAX_COMPLETION_MM) {
    throw new DomainApiError(
      "INVENTORY_CHANGED",
      "The active catalog cannot complete a bracelet within the supported fit range."
    );
  }
  return sequence;
}

function validateDesignPreferences(
  preferences: TarotDesignPreferences | undefined
): {
  wristCircumferenceMm: number;
  budget?: { minMinor?: number; maxMinor?: number };
} {
  const wristCircumferenceMm =
    preferences?.wristCircumferenceMm ?? DEFAULT_WRIST_CIRCUMFERENCE_MM;
  const budget = preferences?.budget;
  const validMinor = (value: number | undefined): boolean =>
    value === undefined || (Number.isSafeInteger(value) && value >= 0);
  if (
    !Number.isFinite(wristCircumferenceMm) ||
    wristCircumferenceMm < MIN_COMPLETION_MM ||
    wristCircumferenceMm > MAX_COMPLETION_MM ||
    !validMinor(budget?.minMinor) ||
    !validMinor(budget?.maxMinor) ||
    (budget?.minMinor !== undefined &&
      budget.maxMinor !== undefined &&
      budget.minMinor > budget.maxMinor)
  ) {
    throw new DomainApiError("INTERNAL_ERROR", "Saved Tarot design preferences are invalid.");
  }
  return {
    wristCircumferenceMm,
    ...(budget === undefined ? {} : { budget: { ...budget } })
  };
}

function directionPatterns(
  materials: readonly CatalogMaterialProduct[]
): Readonly<Record<TarotDirection, readonly CatalogMaterialProduct[]>> {
  const primary = materials[0];
  const secondary = materials[1];
  if (!primary || !secondary) {
    throw new DomainApiError(
      "INVENTORY_CHANGED",
      "At least two active materials are required for distinct Tarot directions."
    );
  }
  const accent = materials[2] ?? secondary;
  const neutral = materials.find((material) =>
    material.colorTags.some((tag) =>
      ["black", "clear", "gray", "neutral", "white"].includes(tag.toLowerCase())
    )
  ) ?? accent;
  return {
    BALANCED: [primary, secondary, accent],
    CONTRAST: [primary, primary, secondary, secondary, secondary, accent],
    NEUTRAL_LED: [neutral, neutral, neutral, primary, neutral, accent]
  };
}

function candidateForDirection(input: {
  sessionId: string;
  rank: number;
  direction: TarotDirection;
  materialProductIds: readonly string[];
  ruleVersion: string;
}) {
  const directionName = input.direction.toLowerCase().replaceAll("_", " ");
  const directionId = input.direction.toLowerCase().replaceAll("_", "-");
  return {
    designName: `Tarot ${directionName} direction`,
    materialProductIds: [...input.materialProductIds],
    accessoryProductIds: [],
    designStory: `A reflective ${directionName} composition shaped by the revealed palette.`,
    recommendationReasons: [
      `Uses a ${directionName} bead rhythm as one creative direction for reflection.`
    ],
    culturalInspiration: [],
    sourceTemplateIds: [],
    providerMetadata: {
      modelProvider: "deterministic",
      modelName: "mystcrag-tarot-candidate-builder",
      promptVersion: "tarot-fallback-copy-v1",
      knowledgeBaseVersion: input.ruleVersion,
      designTemplateVersion: `tarot-${directionId}-rank-${input.rank}`,
      tarotCandidate: {
        sessionId: input.sessionId,
        ruleVersion: input.ruleVersion,
        rank: input.rank,
        direction: input.direction
      }
    }
  };
}

function requestForDirection(input: {
  sessionId: string;
  rank: number;
  direction: TarotDirection;
  locale: string;
  currency: "CNY" | "TWD";
  theme: string;
  signals: TarotDesignSignals;
  wristCircumferenceMm: number;
}): GenerateDesignRequest {
  return GenerateDesignRequestSchema.parse({
    requestId: `${input.sessionId}:${input.rank}`,
    locale: input.locale,
    currency: input.currency,
    wristCircumferenceMm: input.wristCircumferenceMm,
    emotionTags: [input.theme.toLowerCase().replaceAll("_", "-")],
    styleTags: [...input.signals.styleTags, directionTag(input.direction)].slice(0, 30),
    colorTags: [
      input.signals.palette.primary,
      input.signals.palette.support,
      input.signals.palette.accent
    ],
    excludedProductIds: [],
    personalizationConsent: false
  });
}

export class TarotAiRecommendationCopyPort
implements TarotRecommendationCopyPort {
  constructor(private readonly copyService = new TarotCopyService()) {}

  async createSnapshot(input: {
    cards: readonly RevealedTarotCard[];
    signals: TarotDesignSignals;
    materials: readonly CatalogMaterialProduct[];
    locale: string;
    theme: Parameters<TarotRecommendationCopyPort["createSnapshot"]>[0]["theme"];
    question?: string;
  }): Promise<TarotRecommendationSnapshot> {
    const copy = await this.copyService.createInterpretation({
      cards: input.cards.map((card) => ({
        slot: card.slot,
        nameZh: card.nameZh,
        nameEn: card.nameEn,
        orientation: card.orientation,
        keywords: [...(card.orientation === "UPRIGHT"
          ? card.uprightKeywords
          : card.reversedKeywords)]
      })),
      theme: input.theme,
      palette: { ...input.signals.palette },
      materials: input.materials.map((material) => ({
        displayName: material.name,
        crystalName: input.locale.toLowerCase().startsWith("zh")
          ? material.crystalNameCn
          : material.crystalNameEn,
        colorTags: [...material.colorTags]
      })),
      locale: input.locale,
      ...(input.question === undefined ? {} : { question: input.question })
    });
    return {
      interpretation: copy.interpretation,
      copySource: copy.source,
      colorStory: {
        primaryColor: colorHex(input.signals.palette.primary),
        supportColor: colorHex(input.signals.palette.support),
        accentColor: colorHex(input.signals.palette.accent),
        rationale: "The primary, support, and accent tones translate the card imagery into a wearable visual palette."
      },
      materialRecommendations: input.materials.map((material) => ({
        beadProductId: material.id,
        displayName: material.name,
        crystalName: input.locale.toLowerCase().startsWith("zh")
          ? material.crystalNameCn
          : material.crystalNameEn,
        colorTags: [...material.colorTags],
        reason: `Its ${material.colorTags[0]} tone supports the selected visual palette.`
      }))
    };
  }
}

export class DeterministicTarotRecommendationCopyPort extends TarotAiRecommendationCopyPort {}

const defaultCopyPort = new TarotAiRecommendationCopyPort();

function validateGeneratedDesign(
  responseInput: GenerateDesignResponse,
  input: {
    expectedDesignIdSeed: string;
    expectedSequence: readonly string[];
    expectedSourceDesignId: string;
    expectedRuleVersion: string;
    expectedDirection: TarotDirection;
    expectedRank: number;
    expectedWristCircumferenceMm: number;
    currency: "CNY" | "TWD";
    productsById: ReadonlyMap<string, CatalogMaterialProduct>;
  }
): GenerateDesignResponse {
  const response = GenerateDesignResponseSchema.parse(responseInput);
  const design = response.design;
  if (
    design.designId !== deriveTarotDesignAuthorityId(input.expectedDesignIdSeed, design) ||
    design.designMode !== "TAROT_GUIDED" ||
    design.currency !== input.currency ||
    design.bracelet.wristCircumferenceMm !== input.expectedWristCircumferenceMm ||
    design.provenance.knowledgeBaseVersion !== input.expectedRuleVersion ||
    design.provenance.designTemplateVersion !==
      `tarot-${input.expectedDirection.toLowerCase().replaceAll("_", "-")}-rank-${input.expectedRank}` ||
    design.provenance.modelProvider !== "deterministic" ||
    design.provenance.modelName !== "mystcrag-tarot-candidate-builder" ||
    design.provenance.promptVersion !== "tarot-fallback-copy-v1" ||
    design.provenance.sourceDesignId !== null ||
    !isDeepStrictEqual(design.provenance.tarotCandidate, {
      sessionId: input.expectedSourceDesignId,
      ruleVersion: input.expectedRuleVersion,
      rank: input.expectedRank,
      direction: input.expectedDirection
    }) ||
    !isDeepStrictEqual(
      design.beads.map(({ beadProductId }) => beadProductId),
      input.expectedSequence
    )
  ) {
    throw new DomainApiError("INTERNAL_ERROR", "Generated Tarot design metadata is invalid.");
  }
  for (const bead of design.beads) {
    const product = input.productsById.get(bead.beadProductId);
    if (
      !product ||
      !isSellableMaterial(product) ||
      bead.unitPriceMinor !== product.unitPriceMinor ||
      bead.modelAssetKey !== product.modelAssetKey ||
      bead.textureAssetKey !== product.textureAssetKey ||
      bead.materialKey !== product.materialKey ||
      bead.diameterMm !== product.diameterMm
    ) {
      throw new DomainApiError(
        "INTERNAL_ERROR",
        "Generated Tarot design does not match the active catalog."
      );
    }
  }
  return response;
}

const drawSnapshotFromState = (
  state: Parameters<typeof selectPosition>[0],
  cards?: readonly RevealedTarotCard[]
): TarotDrawSnapshot => ({
  acceptedSelections: state.selections.map((selection) => ({
    slot: selection.slot,
    displayedPosition: selection.displayedPosition,
    operationId: selection.operationId
  })),
  ...(cards === undefined
    ? {}
    : {
        revealedCards: cards.map((card) => ({
          slot: card.slot,
          displayedPosition: card.displayedPosition,
          cardId: card.id,
          number: card.number,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          assetFile: card.assetFile,
          orientation: card.orientation,
          keywords: [
            ...(card.orientation === "UPRIGHT"
              ? card.uprightKeywords
              : card.reversedKeywords)
          ]
        }))
      })
});

function conflictFromEngine(error: unknown): never {
  if (error instanceof Error) {
    throw new DomainApiError("CONFLICT", error.message);
  }
  throw error;
}

export class TarotService implements TarotApiService {
  constructor(
    private readonly dependencies: {
      readonly repository: TarotSessionRepository;
      readonly random: RandomSource;
      readonly designReader?: TarotDesignReader;
      readonly catalog?: TarotCatalogPort;
      readonly designGenerator?: TarotDesignGenerator;
      readonly copy?: TarotRecommendationCopyPort;
      readonly questionEncryption?: TarotQuestionEncryptionPort;
      readonly preferences?: TarotPreferencePort;
      readonly now?: () => Date;
    }
  ) {}

  async create(
    actorId: string,
    input: CreateTarotSessionRequest
  ): Promise<CreateTarotSessionResponse> {
    const privateDeckState = createPrivateDrawState({
      spreadType: input.spreadType,
      random: this.dependencies.random
    });
    const record = await this.dependencies.repository.create({
      ownerId: actorId,
      spreadType: input.spreadType,
      theme: input.theme,
      deckVersion: TAROT_DECK_VERSION,
      ruleVersion: TAROT_DESIGN_RULE_VERSION,
      privateDeckState,
      drawSnapshot: drawSnapshotFromState(privateDeckState),
      ...(input.parentSessionId === undefined
        ? {}
        : { parentSessionId: input.parentSessionId })
    });
    return mapCreateTarotResponse(input.requestId, record);
  }

  async select(
    actorId: string,
    sessionId: string,
    input: SelectTarotCardRequest
  ): Promise<SelectTarotCardResponse> {
    const current = await this.dependencies.repository.getOwned(actorId, sessionId);
    const acceptedOperation = current.privateDeckState.selections.find(
      (selection) => selection.operationId === input.operationId
    );
    if (acceptedOperation !== undefined) {
      if (
        acceptedOperation.slot !== input.slot ||
        acceptedOperation.displayedPosition !== input.displayedPosition
      ) {
        throw new DomainApiError(
          "CONFLICT",
          "Tarot operation ID was reused with different input."
        );
      }
      return mapSelectTarotResponse(
        actorId,
        input.requestId,
        current,
        this.dependencies.designReader
      );
    }
    if (current.status !== "DRAWING" || current.privateDeckState.revealed) {
      throw new DomainApiError("CONFLICT", "Completed Tarot draws are immutable.");
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }

    let nextState;
    try {
      nextState = selectPosition(current.privateDeckState, {
        slot: input.slot,
        displayedPosition: input.displayedPosition,
        expectedRevision: current.privateDeckState.revision,
        operationId: input.operationId
      });
    } catch (error) {
      conflictFromEngine(error);
    }
    const record = await this.dependencies.repository.updateDraw({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      status: "DRAWING",
      privateDeckState: nextState,
      drawSnapshot: drawSnapshotFromState(nextState)
    });
    return mapSelectTarotResponse(
      actorId,
      input.requestId,
      record,
      this.dependencies.designReader
    );
  }

  async reveal(
    actorId: string,
    sessionId: string,
    input: RevealTarotSessionRequest
  ): Promise<RevealTarotSessionResponse> {
    const current = await this.dependencies.repository.getOwned(actorId, sessionId);
    if (
      current.privateDeckState.revealed &&
      (current.status === "DRAWN" ||
        current.status === "RECOMMENDED" ||
        current.status === "SAVED")
    ) {
      const originalRevealRevision = current.privateDeckState.revision;
      const refreshedDrawRevision =
        current.status === "DRAWN" && input.expectedRevision === current.stateRevision;
      if (
        input.expectedRevision !== originalRevealRevision &&
        !refreshedDrawRevision
      ) {
        throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
      }
      return mapRevealTarotResponse(
        actorId,
        input.requestId,
        current,
        this.dependencies.designReader
      );
    }
    if (current.status !== "DRAWING") {
      throw new DomainApiError("CONFLICT", "Tarot session cannot be revealed in its current state.");
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }

    let revealed;
    try {
      revealed = revealDraw(
        current.privateDeckState,
        current.privateDeckState.revision
      );
    } catch (error) {
      conflictFromEngine(error);
    }
    const record = await this.dependencies.repository.updateDraw({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      status: "DRAWN",
      privateDeckState: revealed.state,
      drawSnapshot: drawSnapshotFromState(revealed.state, revealed.cards)
    });
    return mapRevealTarotResponse(
      actorId,
      input.requestId,
      record,
      this.dependencies.designReader
    );
  }

  async get(actorId: string, sessionId: string): Promise<GetTarotSessionResponse> {
    const record = await this.dependencies.repository.getOwned(actorId, sessionId);
    return mapGetTarotResponse(
      actorId,
      `restore-${record.id}`,
      record,
      this.dependencies.designReader
    );
  }

  async recommendations(
    actorId: string,
    sessionId: string,
    input: GenerateTarotRecommendationsRequest
  ): Promise<GenerateTarotRecommendationsResponse> {
    if (input.saveQuestion && (input.question === undefined || !this.dependencies.questionEncryption)) {
      throw new DomainApiError(
        "VALIDATION_ERROR",
        "Saving a Tarot question requires encrypted question storage."
      );
    }
    const current = await this.dependencies.repository.getOwned(actorId, sessionId);
    if (current.status === "RECOMMENDED" || current.status === "SAVED") {
      if (input.saveQuestion) {
        if (current.questionCiphertext === null) {
          throw new DomainApiError(
            "CONFLICT",
            "A Tarot question cannot be added after recommendations are generated."
          );
        }
        let sameQuestion = false;
        try {
          sameQuestion = await this.dependencies.questionEncryption!.matchesIdentity(
            input.question!,
            current.questionCiphertext
          );
        } catch {
          sameQuestion = false;
        }
        if (!sameQuestion) {
          throw new DomainApiError(
            "CONFLICT",
            "Tarot recommendations were generated for a different saved question."
          );
        }
      }
      return mapRecommendationsTarotResponse(
        actorId,
        input.requestId,
        current,
        this.dependencies.designReader
      );
    }
    if (current.status !== "DRAWN" || !current.privateDeckState.revealed) {
      throw new DomainApiError(
        "CONFLICT",
        "Tarot recommendations require a revealed draw."
      );
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }
    if (!this.dependencies.catalog || !this.dependencies.designGenerator) {
      throw new DomainApiError(
        "INTERNAL_ERROR",
        "Tarot recommendation dependencies are unavailable."
      );
    }
    let encryptedQuestion:
      | { readonly questionCiphertext: string; readonly questionSavedAt: Date }
      | undefined;
    if (input.saveQuestion && input.question !== undefined) {
      encryptedQuestion = {
        questionCiphertext: await this.dependencies.questionEncryption!.encrypt(input.question),
        questionSavedAt: (this.dependencies.now ?? (() => new Date()))()
      };
    }

    const revealed = revealDraw(
      current.privateDeckState,
      current.privateDeckState.revision
    );
    const signals = deriveDesignSignals({
      spreadType: current.spreadType,
      cards: revealed.cards,
      theme: current.theme
    });
    const preferences = validateDesignPreferences(
      await this.dependencies.preferences?.getDesignPreferences(actorId)
    );
    const catalog = await this.dependencies.catalog.listActiveCatalogProducts(input.currency);
    const sellable = catalog.filter(isSellableMaterial);
    const byId = new Map(sellable.map((product) => [product.id, product]));
    const scored = scoreTarotMaterials({
      signals,
      products: sellable.map((product) => ({
        productId: product.id,
        colorTags: product.colorTags,
        visualStyleTags: [...product.visualTags, ...product.styleTags],
        themeTags: [...product.emotionTags, ...product.cultureTags],
        active: product.active,
        unitPriceMinor: product.unitPriceMinor
      })),
      ...(preferences.budget === undefined ? {} : { budget: preferences.budget })
    });
    const rankedMaterials = scored.flatMap(({ productId }) => {
      const product = byId.get(productId);
      return product ? [product] : [];
    });
    const patterns = directionPatterns(rankedMaterials);
    const candidates = signals.directions.map((direction) => ({
      direction,
      sequence: sequenceAroundWrist(
        patterns[direction],
        preferences.wristCircumferenceMm
      )
    }));
    if (new Set(candidates.map(({ sequence }) => sequence.join("|"))).size !== 3) {
      throw new DomainApiError(
        "INVENTORY_CHANGED",
        "The active catalog cannot produce three distinct Tarot directions."
      );
    }

    let snapshot: TarotRecommendationSnapshot;
    try {
      snapshot = await (this.dependencies.copy ?? defaultCopyPort).createSnapshot({
        cards: revealed.cards,
        signals,
        materials: rankedMaterials.slice(0, 3),
        locale: input.locale,
        theme: current.theme,
        ...(input.question === undefined ? {} : { question: input.question })
      });
    } catch (error) {
      if (error instanceof TarotCopyComplianceError) {
        throw new DomainApiError("COMPLIANCE_BLOCKED", error.message);
      }
      throw error;
    }
    const generated = [];
    for (const [index, { direction, sequence }] of candidates.entries()) {
      const rank = index + 1;
      const designId = deterministicDesignId(current.id, current.ruleVersion, rank);
      const request = requestForDirection({
        sessionId: current.id,
        rank,
        direction,
        locale: input.locale,
        currency: input.currency,
        theme: current.theme,
        signals,
        wristCircumferenceMm: preferences.wristCircumferenceMm
      });
      const response = validateGeneratedDesign(
        await this.dependencies.designGenerator.generateFromCandidate({
          actorId,
          request,
          candidate: candidateForDirection({
            sessionId: current.id,
            rank,
            direction,
            materialProductIds: sequence,
            ruleVersion: current.ruleVersion
          }),
          designMode: "TAROT_GUIDED",
          designId
        }),
        {
          expectedDesignIdSeed: designId,
          expectedSequence: sequence,
          expectedSourceDesignId: current.id,
          expectedRuleVersion: current.ruleVersion,
          expectedDirection: direction,
          expectedRank: rank,
          expectedWristCircumferenceMm: preferences.wristCircumferenceMm,
          currency: input.currency,
          productsById: byId
        }
      );
      generated.push({ rank, response });
    }
    if (
      new Set(generated.map(({ response }) => response.design.designId)).size !== 3 ||
      new Set(
        generated.map(({ response }) =>
          response.design.beads.map(({ beadProductId }) => beadProductId).join("|")
        )
      ).size !== 3
    ) {
      throw new DomainApiError(
        "INTERNAL_ERROR",
        "Tarot recommendations must contain three distinct designs."
      );
    }

    const recommendationLinks = generated.map(({ rank, response }) => ({
      rank,
      designId: response.design.designId
    }));
    let saved;
    try {
      saved = await this.dependencies.repository.saveRecommendations({
        ownerId: actorId,
        sessionId,
        expectedRevision: input.expectedRevision,
        recommendationSnapshot: snapshot,
        ...encryptedQuestion,
        recommendations: recommendationLinks
      });
    } catch (error) {
      if (
        !(error instanceof PersistenceError) ||
        error.code !== "CONFLICT" ||
        !input.saveQuestion ||
        input.question === undefined
      ) {
        throw error;
      }
      const concurrent = await this.dependencies.repository.getOwned(actorId, sessionId);
      const concurrentLinks = concurrent.recommendations.map(({ rank, designId }) => ({
        rank,
        designId
      }));
      let sameQuestion = false;
      if (concurrent.questionCiphertext !== null) {
        try {
          sameQuestion = await this.dependencies.questionEncryption!.matchesIdentity(
            input.question,
            concurrent.questionCiphertext
          );
        } catch {
          sameQuestion = false;
        }
      }
      if (
        concurrent.status !== "RECOMMENDED" ||
        concurrent.stateRevision !== input.expectedRevision + 1 ||
        concurrent.ruleVersion !== current.ruleVersion ||
        concurrent.recommendationSnapshot === null ||
        !isDeepStrictEqual(concurrentLinks, recommendationLinks) ||
        concurrent.questionSavedAt === null ||
        !sameQuestion
      ) {
        throw new DomainApiError(
          "CONFLICT",
          "Tarot recommendations were generated by another request."
        );
      }
      saved = concurrent;
    }
    return mapRecommendationsTarotResponse(
      actorId,
      input.requestId,
      saved,
      this.dependencies.designReader
    );
  }

  async save(
    actorId: string,
    sessionId: string,
    input: SaveTarotSessionRequest
  ): Promise<SaveTarotSessionResponse> {
    const record = await this.dependencies.repository.markSaved({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      ...(input.selectedDesignId === undefined
        ? {}
        : { selectedDesignId: input.selectedDesignId })
    });
    return mapSaveTarotResponse(
      actorId,
      input.requestId,
      record,
      this.dependencies.designReader
    );
  }
}
