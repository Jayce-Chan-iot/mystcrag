import { OracleCopyService } from "@mystcrag/ai-agent/oracle";
import {
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema,
  OracleCastDtoSchema,
  type CreateOracleSessionRequest,
  type CreateOracleSessionResponse,
  type GenerateOracleRecommendationsRequest,
  type GenerateOracleRecommendationsResponse,
  type GetOracleSessionResponse,
  type SaveOracleSessionRequest,
  type SaveOracleSessionResponse
} from "@mystcrag/design-contract";
import { deriveOracleDesignSignal, resolveOracleContext } from "@mystcrag/context-resolver";
import { PersistenceError, type OracleSessionRepository } from "@mystcrag/database";
import { castThreeCoinHexagram, type CoinSource } from "@mystcrag/oracle-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import { deriveOracleDesignAuthorityId } from "../design/design-api.service.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  mapCreateOracleResponse,
  mapGetOracleResponse,
  mapRecommendationsOracleResponse,
  mapSaveOracleResponse
} from "./oracle.public-mapper.js";
import type {
  OracleApiService,
  OracleCatalogPort,
  OracleCopyPort,
  OracleDesignGenerator,
  OracleDesignReader
} from "./oracle.types.js";

const DEFAULT_WRIST_CIRCUMFERENCE_MM = 155;
const MAX_WRIST_CIRCUMFERENCE_MM = 200;
const DIRECTIONS = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;
// Fixed lifecycle revisions: a recommendation command is first accepted at the CAST revision and a save command at the RECOMMENDED revision.
const RECOMMENDATION_ACCEPTED_REVISION = 1;
const SAVE_ACCEPTED_REVISION = 2;

const deterministicDesignId = (sessionId: string, ruleVersion: string, rank: number): string =>
  `oracle-design-${createHash("sha256").update(`${sessionId}\u0000${ruleVersion}\u0000${rank}`).digest("hex").slice(0, 32)}`;

const tagValue = (tag: string): string => tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;

function sellableMaterials(
  catalog: readonly import("@mystcrag/database").AvailableCatalogMaterialProduct[],
  signal: import("@mystcrag/design-contract").OracleDesignSignal
) {
  const desired = new Set([
    ...signal.primaryColorTags,
    ...signal.supportColorTags,
    ...signal.styleTags
  ].map(tagValue));
  return catalog
    .filter((product) =>
      product.active &&
      product.productType === "MATERIAL" &&
      Number.isFinite(product.diameterMm) &&
      product.diameterMm > 0 &&
      product.availableQuantity >= Math.ceil(MAX_WRIST_CIRCUMFERENCE_MM / product.diameterMm) &&
      product.modelAssetKey !== null &&
      product.textureAssetKey !== null
    )
    .map((product, index) => ({
      product,
      index,
      score: [...product.colorTags, ...product.visualTags, ...product.styleTags]
        .map(tagValue)
        .filter((tag) => desired.has(tag)).length
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ product }) => product);
}

function sequenceAroundWrist(
  pattern: readonly import("@mystcrag/database").AvailableCatalogMaterialProduct[],
  wristCircumferenceMm: number
): string[] {
  const sequence: string[] = [];
  let length = 0;
  let index = 0;
  while (length < wristCircumferenceMm) {
    const product = pattern[index % pattern.length];
    if (!product) throw new DomainApiError("INVENTORY_CHANGED", "Oracle materials are unavailable.");
    if (length + product.diameterMm > MAX_WRIST_CIRCUMFERENCE_MM) break;
    sequence.push(product.id);
    length += product.diameterMm;
    index += 1;
  }
  if (length < 130) throw new DomainApiError("INVENTORY_CHANGED", "Oracle materials cannot complete the bracelet fit.");
  return sequence;
}

function candidateForDirection(input: {
  sessionId: string;
  ruleVersion: string;
  rank: number;
  direction: typeof DIRECTIONS[number];
  sequence: readonly string[];
}) {
  const directionId = input.direction.toLowerCase().replaceAll("_", "-");
  return {
    designName: `Oracle ${directionId} direction`,
    materialProductIds: [...input.sequence],
    accessoryProductIds: [],
    designStory: "A composition derived from the cast's color, rhythm, and accent structure.",
    recommendationReasons: ["Translates the Oracle design signal into an editable bead rhythm."],
    culturalInspiration: [],
    sourceTemplateIds: [],
    productionNotes: [],
    providerMetadata: {
      modelProvider: "deterministic",
      modelName: "mystcrag-oracle-candidate-builder",
      promptVersion: "oracle-copy-policy-v1",
      knowledgeBaseVersion: input.ruleVersion,
      designTemplateVersion: `oracle-${directionId}-rank-${input.rank}`,
      oracleCandidate: {
        sessionId: input.sessionId,
        ruleVersion: input.ruleVersion,
        rank: input.rank,
        direction: input.direction
      }
    }
  };
}

function toDomainError(error: unknown): never {
  if (error instanceof DomainApiError) throw error;
  if (error instanceof PersistenceError) {
    const code = error.code === "DATA_INTEGRITY_ERROR" || error.code === "DUPLICATE_KNOWLEDGE"
      ? "INTERNAL_ERROR"
      : error.code;
    throw new DomainApiError(code, error.message);
  }
  throw error;
}

export class OracleService implements OracleApiService {
  constructor(private readonly dependencies: {
    readonly repository: OracleSessionRepository;
    readonly coins: CoinSource;
    readonly copy?: OracleCopyPort;
    readonly designReader?: OracleDesignReader;
    readonly catalog?: OracleCatalogPort;
    readonly designGenerator?: OracleDesignGenerator;
  }) {}

  async create(actorId: string, input: CreateOracleSessionRequest): Promise<CreateOracleSessionResponse> {
    try {
      const existing = await this.dependencies.repository.findOwnedByOperation(actorId, input.operationId);
      if (existing !== null) {
        if (
          existing.locale !== input.locale ||
          existing.currency !== input.currency ||
          existing.wristCircumferenceMm !== (input.wristCircumferenceMm ?? null) ||
          existing.parentSessionId !== (input.parentSessionId ?? null)
        ) {
          throw new DomainApiError("CONFLICT", "Oracle operation ID was reused with different durable input.");
        }
        if (existing.status !== "CAST") {
          throw new DomainApiError("CONFLICT", "Oracle operation ID was already used for an advanced session.");
        }
        return await mapCreateOracleResponse(actorId, input.requestId, existing, this.dependencies.designReader);
      }
      const domain = castThreeCoinHexagram(this.dependencies.coins);
      const cast = OracleCastDtoSchema.parse({
        lines: [...domain.lines],
        movingLineIndices: [...domain.movingLineIndices],
        primaryHexagram: { ...domain.primaryHexagram },
        ...(domain.transformedHexagram === undefined
          ? {}
          : { transformedHexagram: { ...domain.transformedHexagram } }),
        algorithm: { ...domain.algorithm }
      });
      const signal = deriveOracleDesignSignal(cast);
      const copy = await (this.dependencies.copy ?? new OracleCopyService()).createInterpretation({
        cast,
        signal,
        locale: input.locale
      });
      const record = await this.dependencies.repository.createOrGet({
        ownerId: actorId,
        operationId: input.operationId,
        locale: input.locale,
        currency: input.currency,
        ...(input.wristCircumferenceMm === undefined ? {} : { wristCircumferenceMm: input.wristCircumferenceMm }),
        cast,
        signal,
        interpretation: copy.interpretation,
        ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId })
      });
      return await mapCreateOracleResponse(actorId, input.requestId, record, this.dependencies.designReader);
    } catch (error) {
      toDomainError(error);
    }
  }

  async get(actorId: string, sessionId: string): Promise<GetOracleSessionResponse> {
    try {
      const record = await this.dependencies.repository.getOwned(actorId, sessionId);
      return await mapGetOracleResponse(actorId, `restore-${record.id}`, record, this.dependencies.designReader);
    } catch (error) {
      toDomainError(error);
    }
  }

  async recommendations(
    actorId: string,
    sessionId: string,
    input: GenerateOracleRecommendationsRequest
  ): Promise<GenerateOracleRecommendationsResponse> {
    try {
      const current = await this.dependencies.repository.getOwned(actorId, sessionId);
      if (current.status === "RECOMMENDED" || current.status === "SAVED") {
        if (
          current.recommendationOperationId !== input.operationId ||
          input.expectedRevision !== RECOMMENDATION_ACCEPTED_REVISION
        ) {
          throw new DomainApiError("CONFLICT", "Oracle recommendations already used another operation or revision.");
        }
        return await mapRecommendationsOracleResponse(actorId, input.requestId, current, this.dependencies.designReader);
      }
      if (current.status !== "CAST" || current.stateRevision !== input.expectedRevision) {
        throw new DomainApiError("CONFLICT", "Oracle recommendation revision conflict.");
      }
      if (!this.dependencies.catalog || !this.dependencies.designGenerator || !this.dependencies.designReader) {
        throw new DomainApiError("INTERNAL_ERROR", "Oracle recommendation dependencies are unavailable.");
      }
      const catalog = await this.dependencies.catalog.listActiveCatalogProducts(current.currency);
      const ranked = sellableMaterials(catalog, current.signal);
      if (ranked.length < 3) {
        throw new DomainApiError("INVENTORY_CHANGED", "Three in-stock Oracle materials are required.");
      }
      const wrist = current.wristCircumferenceMm ?? DEFAULT_WRIST_CIRCUMFERENCE_MM;
      const context = resolveOracleContext({
        cast: current.cast,
        signal: current.signal,
        wristCircumferenceMm: wrist,
        locale: current.locale,
        currency: current.currency
      });
      const patterns = [
        [ranked[0]!, ranked[1]!, ranked[2]!],
        [ranked[0]!, ranked[0]!, ranked[1]!, ranked[2]!],
        [ranked[2]!, ranked[2]!, ranked[0]!, ranked[1]!]
      ] as const;
      const sequences = patterns.map((pattern) => sequenceAroundWrist(pattern, wrist));
      if (new Set(sequences.map((sequence) => sequence.join("|"))).size !== 3) {
        throw new DomainApiError("INVENTORY_CHANGED", "The active catalog cannot produce three Oracle directions.");
      }
      const byId = new Map(ranked.map((product) => [product.id, product]));
      const generated: Array<{ rank: number; designId: string }> = [];
      for (const [index, direction] of DIRECTIONS.entries()) {
        const rank = index + 1;
        const sequence = sequences[index]!;
        const designIdSeed = deterministicDesignId(current.id, current.ruleVersion, rank);
        const request = GenerateDesignRequestSchema.parse({
          requestId: `${current.id}:${rank}`,
          locale: current.locale,
          currency: current.currency,
          wristCircumferenceMm: context.hardConstraints.wristCircumferenceMm,
          emotionTags: [...context.preferences.emotionTags],
          styleTags: [...context.preferences.styleTags, `oracle-direction-${direction.toLowerCase().replaceAll("_", "-")}`],
          colorTags: [...context.preferences.colorPreferences],
          excludedProductIds: [...context.hardConstraints.excludedProductIds],
          personalizationConsent: false
        });
        const response = GenerateDesignResponseSchema.parse(
          await this.dependencies.designGenerator.generateFromCandidate({
            actorId,
            request,
            candidate: candidateForDirection({
              sessionId: current.id,
              ruleVersion: current.ruleVersion,
              rank,
              direction,
              sequence
            }),
            designMode: "ORACLE_GUIDED",
            designId: designIdSeed
          })
        );
        const design = response.design;
        if (
          response.requestId !== request.requestId ||
          design.designId !== deriveOracleDesignAuthorityId(designIdSeed, design) ||
          design.designMode !== "ORACLE_GUIDED" ||
          design.locale !== current.locale ||
          design.currency !== current.currency ||
          design.bracelet.wristCircumferenceMm !== wrist ||
          design.provenance.modelProvider !== "deterministic" ||
          design.provenance.modelName !== "mystcrag-oracle-candidate-builder" ||
          design.provenance.promptVersion !== "oracle-copy-policy-v1" ||
          design.provenance.knowledgeBaseVersion !== current.ruleVersion ||
          design.provenance.designTemplateVersion !==
            `oracle-${direction.toLowerCase().replaceAll("_", "-")}-rank-${rank}` ||
          design.provenance.sourceDesignId !== null ||
          !isDeepStrictEqual(design.beads.map(({ beadProductId }) => beadProductId), sequence) ||
          !isDeepStrictEqual(design.provenance.oracleCandidate, {
            sessionId: current.id,
            ruleVersion: current.ruleVersion,
            rank,
            direction
          }) ||
          design.provenance.tarotCandidate !== undefined
        ) {
          throw new DomainApiError("INTERNAL_ERROR", "Generated Oracle design metadata is invalid.");
        }
        for (const bead of design.beads) {
          const product = byId.get(bead.beadProductId);
          if (!product) {
            throw new DomainApiError("INVENTORY_CHANGED", "Generated Oracle material is no longer available.");
          }
          if (bead.unitPriceMinor !== product.unitPriceMinor) {
            throw new DomainApiError("PRICE_CHANGED", "Generated Oracle price no longer matches the catalog.");
          }
          if (
            bead.modelAssetKey !== product.modelAssetKey ||
            bead.textureAssetKey !== product.textureAssetKey ||
            bead.materialKey !== product.materialKey ||
            bead.diameterMm !== product.diameterMm
          ) {
            throw new DomainApiError("INTERNAL_ERROR", "Generated Oracle material metadata is invalid.");
          }
        }
        generated.push({ rank, designId: design.designId });
      }
      if (new Set(generated.map(({ designId }) => designId)).size !== DIRECTIONS.length) {
        throw new DomainApiError("INTERNAL_ERROR", "Oracle recommendations must contain three distinct designs.");
      }
      const saved = await this.dependencies.repository.saveRecommendations({
        ownerId: actorId,
        sessionId,
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
        recommendations: generated
      });
      return await mapRecommendationsOracleResponse(actorId, input.requestId, saved, this.dependencies.designReader);
    } catch (error) {
      toDomainError(error);
    }
  }

  async save(
    actorId: string,
    sessionId: string,
    input: SaveOracleSessionRequest
  ): Promise<SaveOracleSessionResponse> {
    try {
      const current = await this.dependencies.repository.getOwned(actorId, sessionId);
      if (current.status === "SAVED") {
        if (
          current.saveOperationId !== input.operationId ||
          current.selectedDesignId !== input.selectedDesignId ||
          input.expectedRevision !== SAVE_ACCEPTED_REVISION
        ) {
          throw new DomainApiError("CONFLICT", "Oracle save already used another operation or revision.");
        }
        return await mapSaveOracleResponse(actorId, input.requestId, current, this.dependencies.designReader);
      }
      const saved = await this.dependencies.repository.markSaved({
        ownerId: actorId,
        sessionId,
        operationId: input.operationId,
        expectedRevision: input.expectedRevision,
        selectedDesignId: input.selectedDesignId
      });
      return await mapSaveOracleResponse(actorId, input.requestId, saved, this.dependencies.designReader);
    } catch (error) {
      toDomainError(error);
    }
  }
}
