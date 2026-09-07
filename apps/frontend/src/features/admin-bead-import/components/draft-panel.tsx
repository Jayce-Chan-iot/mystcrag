import * as React from "react";

import type { BeadImageGroupState } from "@mystcrag/design-contract";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@mystcrag/design-contract";

import {
  BEAD_SHAPES,
  BEAD_SHAPE_LABELS,
  CRYSTAL_CURATION_TAG_FIELDS,
  CRYSTAL_CURATION_TEXT_FIELDS,
  DECISION_FIELD_LABELS,
  DRAFT_COMPLETENESS_LABELS,
  PRODUCT_DRAFT_DECISION_FIELDS,
  PRODUCT_DRAFT_TEXT_FIELDS,
  PRODUCT_FIELD_LABELS,
  USAGE_PERMISSIONS,
  USAGE_PERMISSION_LABELS,
  emptyCurationForm,
  emptyProductDraftForm,
  type CurationForm,
  type ProductDraftForm
} from "../draft-form";
import {
  canSubmitCuration,
  canSubmitGroupMutation,
  completenessRecordFor,
  crystalDraftViewFor,
  curationEntryFor,
  isCurationDirty,
  isCompletenessCurrent,
  isProductDraftDirty,
  productDraftEntryFor,
  type BeadImportWorkflowState,
  type CurationPatch,
  type ProductDraftPatch
} from "../workflow-state";
import type { CrystalSearchClient } from "../crystal-search";
import type { CrystalSearchResult } from "@mystcrag/design-contract";
import { CrystalSearchField } from "./crystal-search-field";
import {
  BUTTON_CLASS,
  CARD_CLASS,
  FIELD_CLASS,
  HINT_CLASS,
  LABEL_CLASS,
  NOTICE_CLASS,
  NOTICE_TONE_CLASS,
  PILL_CLASS,
  SECONDARY_BUTTON_CLASS,
  SUBCARD_CLASS
} from "./control-styles";

/**
 * Presentational naming-and-curation step. Every field is filled by a human and
 * every bound is judged by the contract: this file never restates a length, a
 * range or a placeholder rule, and never infers a crystal identity, a quality or
 * an effect from a file, a folder or an image.
 */

export type DraftGroupCard = {
  groupId: string;
  crystalName: string | null;
  state: BeadImageGroupState;
  productForm: ProductDraftForm;
  productDirty: boolean;
  canSubmitProduct: boolean;
  completeness: { complete: boolean; missingFields: string[] } | null;
  completenessCurrent: boolean;
  crystalDraft: {
    crystalDraftId: string;
    curationComplete: boolean;
    promotionEligible: boolean;
    missingFields: string[];
    form: CurationForm;
    dirty: boolean;
    canSubmit: boolean;
    stale: boolean;
    inFlight: boolean;
  } | null;
  stale: boolean;
  inFlightProduct: boolean;
  failureMessage: string | null;
  curationFailureMessage: string | null;
};

export type DraftPanelProps = {
  cards: readonly DraftGroupCard[];
  locked: boolean;
  blockedByConflict: boolean;
  conflictMessage: string;
  onProductPatch: (groupId: string, patch: ProductDraftPatch) => void;
  onResetProduct: (groupId: string) => void;
  onSaveProduct: (groupId: string) => void;
  onCheckCompleteness: (groupId: string) => void;
  onCurationPatch: (crystalDraftId: string, patch: CurationPatch) => void;
  onResetCuration: (crystalDraftId: string) => void;
  onSaveCuration: (crystalDraftId: string) => void;
  onAcknowledgeConflict: () => void;
  /** The dedicated admin Crystal search client; absent means no search field. */
  crystalSearchClient?: CrystalSearchClient | null;
  onCrystalSelected?: (groupId: string, result: CrystalSearchResult) => void;
};

const CURRENCY_LABELS: Readonly<Record<SupportedCurrency, string>> = {
  CNY: "人民币 (CNY)",
  TWD: "新台币 (TWD)"
};

const CURATION_INPUT_LABELS: Readonly<Record<string, string>> = {
  nameCn: "中文名",
  nameEn: "英文名",
  mineralName: "矿物学名称",
  complianceNote: "合规说明",
  colorTags: "颜色标签",
  visualTags: "视觉特征标签",
  styleTags: "风格标签",
  priceLevel: "价格档位（1 到 5）"
};

function failureMessageFor(
  notices: BeadImportWorkflowState["notices"],
  prefix: string,
  id: string
): string | null {
  const notice = notices.find((item) => item.id === `${prefix}${id}`);
  return notice?.message ?? null;
}

/** Projects the authoritative session into the cards the naming step reads. */
export function draftCardsOf(state: BeadImportWorkflowState): DraftGroupCard[] {
  const groups = state.session?.groups ?? [];
  return groups.map((group) => {
    const entry = productDraftEntryFor(state, group.groupId);
    const crystalDraft = crystalDraftViewFor(state, group.groupId);
    const completeness = completenessRecordFor(state, group.groupId);
    const curationEntry = crystalDraft === null ? null : curationEntryFor(state, crystalDraft.crystalDraftId);

    return {
      groupId: group.groupId,
      crystalName: group.crystalName ?? null,
      state: group.state,
      productForm: entry?.form ?? emptyProductDraftForm(),
      productDirty: isProductDraftDirty(state, group.groupId),
      canSubmitProduct: canSubmitGroupMutation(state, group.groupId),
      completeness:
        completeness === null
          ? null
          : { complete: completeness.complete, missingFields: [...completeness.missingFields] },
      completenessCurrent: isCompletenessCurrent(state, group.groupId),
      crystalDraft:
        crystalDraft === null
          ? null
          : {
              crystalDraftId: crystalDraft.crystalDraftId,
              curationComplete: crystalDraft.curationComplete,
              promotionEligible: crystalDraft.promotionEligible,
              missingFields: [...crystalDraft.missingFields],
              form: curationEntry?.form ?? emptyCurationForm(),
              dirty: isCurationDirty(state, crystalDraft.crystalDraftId),
              canSubmit: canSubmitCuration(state, crystalDraft.crystalDraftId),
              stale: state.staleCrystalDraftIds.includes(crystalDraft.crystalDraftId),
              inFlight: state.inFlightCrystalDraftIds.includes(crystalDraft.crystalDraftId)
            },
      stale: state.staleGroupIds.includes(group.groupId),
      inFlightProduct: state.inFlightGroupIds.includes(group.groupId),
      failureMessage: failureMessageFor(state.notices, "group-mutation-failure:", group.groupId),
      curationFailureMessage:
        crystalDraft === null
          ? null
          : failureMessageFor(state.notices, "curation-failure:", crystalDraft.crystalDraftId)
    };
  });
}

function Pill({ label, tone }: { label: string; tone: "info" | "success" | "warning" | "danger" }) {
  return <span className={`${PILL_CLASS} ${NOTICE_TONE_CLASS[tone]}`}>{label}</span>;
}

function DecisionSelect({
  id,
  label,
  value,
  disabled,
  onChange
}: {
  id: string;
  label: string;
  value: boolean | null;
  disabled: boolean;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          onChange(raw === "" ? null : raw === "true");
        }}
        className={FIELD_CLASS}
      >
        <option value="">未回答</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    </div>
  );
}

function ProductDraftFormView({
  card,
  canOperate,
  onPatch,
  onReset,
  onSave,
  onCheck
}: {
  card: DraftGroupCard;
  canOperate: boolean;
  onPatch: (patch: ProductDraftPatch) => void;
  onReset: () => void;
  onSave: () => void;
  onCheck: () => void;
}) {
  const { productForm: form } = card;
  const saveDisabled = !canOperate || !card.productDirty;
  const checkDisabled = !canOperate || card.state === "PUBLISHED";

  return (
    <div className={`${SUBCARD_CLASS} gap-3`}>
      <p className="min-w-0 text-sm font-medium">商品草稿</p>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {PRODUCT_DRAFT_TEXT_FIELDS.map((field) => (
          <div key={field} className="min-w-0">
            <label htmlFor={`bead-import-draft-${card.groupId}-${field}`} className={LABEL_CLASS}>
              {PRODUCT_FIELD_LABELS[field]}
            </label>
            <input
              id={`bead-import-draft-${card.groupId}-${field}`}
              type="text"
              value={form.text[field]}
              disabled={!canOperate}
              onChange={(event) => onPatch({ text: { [field]: event.currentTarget.value } })}
              className={FIELD_CLASS}
            />
          </div>
        ))}
      </div>

      <div className="min-w-0">
        <label htmlFor={`bead-import-draft-${card.groupId}-shape`} className={LABEL_CLASS}>
          珠子形状
        </label>
        <select
          id={`bead-import-draft-${card.groupId}-shape`}
          value={form.shape ?? ""}
          disabled={!canOperate}
          onChange={(event) =>
            onPatch({ shape: (event.currentTarget.value === "" ? null : event.currentTarget.value) as ProductDraftForm["shape"] })
          }
          className={FIELD_CLASS}
        >
          <option value="">未选择</option>
          {BEAD_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {BEAD_SHAPE_LABELS[shape]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`bead-import-draft-${card.groupId}-currency`} className={LABEL_CLASS}>
            结算币种
          </label>
          <select
            id={`bead-import-draft-${card.groupId}-currency`}
            value={form.currency ?? ""}
            disabled={!canOperate}
            onChange={(event) =>
              onPatch({
                currency:
                  event.currentTarget.value === "" ? null : (event.currentTarget.value as SupportedCurrency)
              })
            }
            className={FIELD_CLASS}
          >
            <option value="">未选择</option>
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {CURRENCY_LABELS[currency]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`bead-import-draft-${card.groupId}-usage`} className={LABEL_CLASS}>
            使用授权
          </label>
          <select
            id={`bead-import-draft-${card.groupId}-usage`}
            value={form.usagePermission ?? ""}
            disabled={!canOperate}
            onChange={(event) =>
              onPatch({
                usagePermission:
                  event.currentTarget.value === ""
                    ? null
                    : (event.currentTarget.value as ProductDraftForm["usagePermission"])
              })
            }
            className={FIELD_CLASS}
          >
            <option value="">未选择</option>
            {USAGE_PERMISSIONS.map((permission) => (
              <option key={permission} value={permission}>
                {USAGE_PERMISSION_LABELS[permission]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset disabled={!canOperate} className="flex min-w-0 flex-col gap-3">
        <legend className={LABEL_CLASS}>权利与授权决定（逐项由人工选择）</legend>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {PRODUCT_DRAFT_DECISION_FIELDS.map((field) => (
            <DecisionSelect
              key={field}
              id={`bead-import-draft-${card.groupId}-${field}`}
              label={DECISION_FIELD_LABELS[field]}
              value={form.decisions[field]}
              disabled={!canOperate}
              onChange={(value) => onPatch({ decisions: { [field]: value } })}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={saveDisabled} className={BUTTON_CLASS}>
          {card.inFlightProduct ? "保存中…" : "保存草稿"}
        </button>
        <button type="button" onClick={onCheck} disabled={checkDisabled} className={SECONDARY_BUTTON_CLASS}>
          核对完整性
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!canOperate || !card.productDirty}
          className={SECONDARY_BUTTON_CLASS}
        >
          放弃修改
        </button>
        {card.productDirty && <span className="text-xs text-[var(--warning)]">未保存</span>}
      </div>

      {card.completeness !== null && (
        <div
          className={`${NOTICE_CLASS} ${
            card.completeness.complete ? NOTICE_TONE_CLASS.success : NOTICE_TONE_CLASS.warning
          }`}
        >
          <p className="min-w-0">
            {card.completeness.complete
              ? "草稿已完整，可以进入处理与发布。"
              : `草稿仍缺少：${card.completeness.missingFields
                  .map((field) => DRAFT_COMPLETENESS_LABELS[field as keyof typeof DRAFT_COMPLETENESS_LABELS] ?? field)
                  .join("、")}。`}
          </p>
          {!card.completenessCurrent && (
            <p className="mt-1 min-w-0 text-xs">该核对结果对应服务端旧版本，保存后需重新核对。</p>
          )}
        </div>
      )}
    </div>
  );
}

function CurationFormView({
  card,
  canOperate,
  onPatch,
  onReset,
  onSave
}: {
  card: DraftGroupCard;
  canOperate: boolean;
  onPatch: (patch: CurationPatch) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const draft = card.crystalDraft;
  if (draft === null) {
    return (
      <div className={SUBCARD_CLASS}>
        <p className="min-w-0 text-sm font-medium">水晶资料</p>
        <p className="min-w-0 text-xs leading-5 text-[var(--muted)]">
          保存商品草稿后，服务端会建立水晶资料草稿，这里才能逐项填写。
        </p>
      </div>
    );
  }

  return (
    <div className={`${SUBCARD_CLASS} gap-3`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-sm font-medium">水晶资料（八项，人工填写）</p>
        {draft.curationComplete ? (
          <Pill label="已完整" tone="success" />
        ) : (
          <Pill label="未完整" tone="warning" />
        )}
        {draft.promotionEligible && <Pill label="服务端允许提升" tone="info" />}
        {draft.stale && <Pill label="服务端已更新，待确认" tone="warning" />}
      </div>

      {draft.missingFields.length > 0 && (
        <p className="min-w-0 text-xs text-[var(--warning)]">
          仍缺少：{draft.missingFields.join("、")}。
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {CRYSTAL_CURATION_TEXT_FIELDS.map((field) => (
          <div key={field} className="min-w-0">
            <label htmlFor={`bead-import-curation-${draft.crystalDraftId}-${field}`} className={LABEL_CLASS}>
              {CURATION_INPUT_LABELS[field]}
            </label>
            <input
              id={`bead-import-curation-${draft.crystalDraftId}-${field}`}
              type="text"
              value={draft.form[field]}
              disabled={!canOperate}
              onChange={(event) => onPatch({ [field]: event.currentTarget.value })}
              className={FIELD_CLASS}
            />
          </div>
        ))}
        {CRYSTAL_CURATION_TAG_FIELDS.map((field) => (
          <div key={field} className="min-w-0">
            <label htmlFor={`bead-import-curation-${draft.crystalDraftId}-${field}`} className={LABEL_CLASS}>
              {CURATION_INPUT_LABELS[field]}
            </label>
            <input
              id={`bead-import-curation-${draft.crystalDraftId}-${field}`}
              type="text"
              value={draft.form[field]}
              disabled={!canOperate}
              onChange={(event) => onPatch({ [field]: event.currentTarget.value })}
              className={FIELD_CLASS}
            />
          </div>
        ))}
        <div className="min-w-0">
          <label htmlFor={`bead-import-curation-${draft.crystalDraftId}-priceLevel`} className={LABEL_CLASS}>
            {CURATION_INPUT_LABELS.priceLevel}
          </label>
          <input
            id={`bead-import-curation-${draft.crystalDraftId}-priceLevel`}
            type="text"
            inputMode="numeric"
            value={draft.form.priceLevel}
            disabled={!canOperate}
            onChange={(event) => onPatch({ priceLevel: event.currentTarget.value })}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!canOperate || !draft.dirty}
          className={BUTTON_CLASS}
        >
          {draft.inFlight ? "保存中…" : "保存水晶资料"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!canOperate || !draft.dirty}
          className={SECONDARY_BUTTON_CLASS}
        >
          放弃修改
        </button>
        {draft.dirty && <span className="text-xs text-[var(--warning)]">未保存</span>}
      </div>
    </div>
  );
}

function DraftCard({
  card,
  locked,
  blockedByConflict,
  onProductPatch,
  onResetProduct,
  onSaveProduct,
  onCheckCompleteness,
  onCurationPatch,
  onResetCuration,
  onSaveCuration,
  crystalSearchClient,
  onCrystalSelected
}: {
  card: DraftGroupCard;
  locked: boolean;
  blockedByConflict: boolean;
  onProductPatch: (patch: ProductDraftPatch) => void;
  onResetProduct: () => void;
  onSaveProduct: () => void;
  onCheckCompleteness: () => void;
  onCurationPatch: (patch: CurationPatch) => void;
  onResetCuration: () => void;
  onSaveCuration: () => void;
  crystalSearchClient: CrystalSearchClient | null;
  onCrystalSelected: (result: CrystalSearchResult) => void;
}) {
  const canOperate = !locked && !blockedByConflict && card.state !== "PUBLISHED" && !card.stale;
  const headingId = `bead-import-draft-${card.groupId}-heading`;

  return (
    <article aria-labelledby={headingId} aria-busy={card.inFlightProduct ? true : undefined} className={CARD_CLASS}>
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="min-w-0 break-all text-sm font-semibold">
          {card.crystalName ?? "未命名分组"}
        </h3>
        {card.stale && <Pill label="服务端已更新，待确认" tone="warning" />}
        {card.inFlightProduct && <Pill label="提交中" tone="info" />}
      </header>

      {card.failureMessage !== null && (
        <p role="alert" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} min-w-0 break-all`}>
          {card.failureMessage}
        </p>
      )}

      {crystalSearchClient !== null && canOperate && (
        <CrystalSearchField
          client={crystalSearchClient}
          onSelect={onCrystalSelected}
        />
      )}

      <ProductDraftFormView
        card={card}
        canOperate={canOperate}
        onPatch={(patch) => onProductPatch(patch)}
        onReset={onResetProduct}
        onSave={onSaveProduct}
        onCheck={onCheckCompleteness}
      />

      {card.curationFailureMessage !== null && (
        <p role="alert" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} min-w-0 break-all`}>
          {card.curationFailureMessage}
        </p>
      )}

      <CurationFormView
        card={card}
        canOperate={canOperate}
        onPatch={(patch) => onCurationPatch(patch)}
        onReset={onResetCuration}
        onSave={onSaveCuration}
      />
    </article>
  );
}

export function DraftPanel({
  cards,
  locked,
  blockedByConflict,
  conflictMessage,
  onProductPatch,
  onResetProduct,
  onSaveProduct,
  onCheckCompleteness,
  onCurationPatch,
  onResetCuration,
  onSaveCuration,
  onAcknowledgeConflict,
  crystalSearchClient = null,
  onCrystalSelected = () => {}
}: DraftPanelProps) {
  return (
    <section aria-labelledby="bead-import-draft-heading" className="flex min-w-0 flex-col gap-4">
      <header className="min-w-0">
        <h2 id="bead-import-draft-heading" className="text-lg font-semibold tracking-tight">
          命名与草稿
        </h2>
        <p className={HINT_CLASS}>
          珠子名称、商品草稿与水晶资料一律由人工填写。系统不会从图片、文件夹或文件名推断水晶身份。
        </p>
      </header>

      {blockedByConflict && (
        <div
          role="alert"
          className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.danger} flex min-w-0 flex-col gap-3`}
        >
          <p className="min-w-0 break-all">{conflictMessage}</p>
          <button
            type="button"
            onClick={() => onAcknowledgeConflict()}
            className={`${SECONDARY_BUTTON_CLASS} self-start`}
          >
            我已确认最新数据
          </button>
        </div>
      )}

      {locked && (
        <p role="status" className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          导入任务已进入不可编辑阶段，命名与草稿仅供查看。
        </p>
      )}

      {cards.length === 0 ? (
        <p className={`${NOTICE_CLASS} ${NOTICE_TONE_CLASS.info}`}>
          还没有分组：请先完成上传与分组确认，再填写命名与草稿。
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {cards.map((card) => (
            <DraftCard
              key={card.groupId}
              card={card}
              locked={locked}
              blockedByConflict={blockedByConflict}
              onProductPatch={(patch) => onProductPatch(card.groupId, patch)}
              onResetProduct={() => onResetProduct(card.groupId)}
              onSaveProduct={() => onSaveProduct(card.groupId)}
              onCheckCompleteness={() => onCheckCompleteness(card.groupId)}
              onCurationPatch={(patch) => onCurationPatch(card.crystalDraft?.crystalDraftId ?? "", patch)}
              onResetCuration={() => onResetCuration(card.crystalDraft?.crystalDraftId ?? "")}
              onSaveCuration={() => onSaveCuration(card.crystalDraft?.crystalDraftId ?? "")}
              crystalSearchClient={crystalSearchClient}
              onCrystalSelected={(result) => onCrystalSelected(card.groupId, result)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
