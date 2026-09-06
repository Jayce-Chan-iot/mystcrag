import {
  ASSET_IMPORT_SESSION_TERMINAL_STATES,
  assetImportCheckpointRank,
  type AssetImportSessionGroupView,
  type AssetImportSessionResponse,
  type AssetImportSessionState
} from "@mystcrag/design-contract";

/**
 * The operator-facing four step workflow. Step resolution reads only Backend
 * session state and verified checkpoints, so a refresh or a crashed run lands
 * on the step the server can actually support instead of on React memory.
 */
export const WORKFLOW_STEPS = [
  "UPLOAD_FOLDER",
  "REVIEW_GROUPS",
  "NAME_AND_CURATE",
  "PROCESS_REVIEW_PUBLISH"
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const WORKFLOW_STEP_LABELS: Record<WorkflowStep, { title: string; hint: string }> = {
  UPLOAD_FOLDER: {
    title: "拖入素材",
    hint: "选择整个拍摄文件夹，仅上传 ARW、JPG、PNG、WEBP 源文件。"
  },
  REVIEW_GROUPS: {
    title: "确认分组",
    hint: "合并、拆分、移动或忽略建议分组，并为每组指定主图。"
  },
  NAME_AND_CURATE: {
    title: "命名与草稿",
    hint: "由操作者手工填写珠子名称与商品草稿，系统不会从图片或文件夹名推断水晶身份。"
  },
  PROCESS_REVIEW_PUBLISH: {
    title: "处理、审核与发布",
    hint: "查看处理版本与 QC 结果，逐项确认授权信息后再发布。"
  }
};

const MANIFEST_STATES: ReadonlySet<AssetImportSessionState> = new Set(["CREATED", "UPLOADING"]);
const UPLOAD_STATES: ReadonlySet<AssetImportSessionState> = new Set([
  "UPLOADING",
  "ARCHIVING",
  "PARTIALLY_FAILED"
]);
const GROUPING_STATES: ReadonlySet<AssetImportSessionState> = new Set(["ARCHIVING", "PARTIALLY_FAILED"]);
const PROCESSING_STATES: ReadonlySet<AssetImportSessionState> = new Set([
  "NEEDS_REVIEW",
  "PARTIALLY_FAILED"
]);

const RANK_GROUPED = assetImportCheckpointRank("GROUPED");
const RANK_LABELED = assetImportCheckpointRank("LABELED");
const RANK_PROCESSED = assetImportCheckpointRank("PROCESSED");

export function workflowStepIndex(step: WorkflowStep): number {
  return WORKFLOW_STEPS.indexOf(step);
}

export function isTerminalSessionState(state: AssetImportSessionState): boolean {
  return ASSET_IMPORT_SESSION_TERMINAL_STATES.includes(state);
}

export function canRegisterManifest(state: AssetImportSessionState): boolean {
  return MANIFEST_STATES.has(state);
}

export function canUploadFileContent(state: AssetImportSessionState): boolean {
  return UPLOAD_STATES.has(state);
}

export function canStartGrouping(state: AssetImportSessionState): boolean {
  return GROUPING_STATES.has(state);
}

export function canStartProcessing(state: AssetImportSessionState): boolean {
  return PROCESSING_STATES.has(state);
}

export function allGroupsNamed(groups: readonly AssetImportSessionGroupView[]): boolean {
  return (
    groups.length > 0 &&
    groups.every((group) => typeof group.crystalName === "string" && group.crystalName.trim().length > 0)
  );
}

export type UploadProgressSummary = {
  declaredFileCount: number;
  pending: number;
  uploading: number;
  archived: number;
  failed: number;
  skippedDuplicate: number;
  declaredBytes: number;
  uploadedBytes: number;
  byteProgress: number;
  isComplete: boolean;
  hasFailures: boolean;
};

export function summarizeUploadProgress(session: AssetImportSessionResponse): UploadProgressSummary {
  let pending = 0;
  let uploading = 0;
  let archived = 0;
  let failed = 0;
  let skippedDuplicate = 0;
  for (const file of session.files) {
    switch (file.state) {
      case "PENDING":
        pending += 1;
        break;
      case "UPLOADING":
        uploading += 1;
        break;
      case "ARCHIVED":
        archived += 1;
        break;
      case "FAILED":
        failed += 1;
        break;
      case "SKIPPED_DUPLICATE":
        skippedDuplicate += 1;
        break;
    }
  }
  const { declaredBytes, uploadedBytes, declaredFileCount } = session;
  const ratio = declaredBytes > 0 ? Math.min(1, uploadedBytes / declaredBytes) : 0;
  return {
    declaredFileCount,
    pending,
    uploading,
    archived,
    failed,
    skippedDuplicate,
    declaredBytes,
    uploadedBytes,
    byteProgress: Math.round(ratio * 10000) / 10000,
    isComplete: declaredFileCount > 0 && archived + skippedDuplicate >= declaredFileCount && failed === 0,
    hasFailures: failed > 0 || session.failedFileCount > 0
  };
}

function checkpointRank(session: AssetImportSessionResponse): number {
  const checkpoint = session.lastVerifiedCheckpoint;
  return checkpoint === null ? -1 : assetImportCheckpointRank(checkpoint);
}

function hasProcessedOutput(session: AssetImportSessionResponse): boolean {
  return session.groups.some((group) => group.processedAssets.length > 0);
}

export function resolveWorkflowStep(session: AssetImportSessionResponse): WorkflowStep {
  const rank = checkpointRank(session);
  const { state, groups } = session;
  if (
    state === "PUBLISHED" ||
    state === "READY_TO_PUBLISH" ||
    state === "PUBLISHING" ||
    rank >= RANK_PROCESSED ||
    (state === "PROCESSING" && rank >= RANK_LABELED) ||
    hasProcessedOutput(session)
  ) {
    return "PROCESS_REVIEW_PUBLISH";
  }
  if (rank === RANK_LABELED || allGroupsNamed(groups)) {
    return "NAME_AND_CURATE";
  }
  if (rank >= RANK_GROUPED || groups.length > 0 || state === "PROCESSING") {
    return "REVIEW_GROUPS";
  }
  return "UPLOAD_FOLDER";
}

export function maxReachableWorkflowStep(session: AssetImportSessionResponse): WorkflowStep {
  if (allGroupsNamed(session.groups) && canStartProcessing(session.state)) {
    return "PROCESS_REVIEW_PUBLISH";
  }
  return resolveWorkflowStep(session);
}

export function isWorkflowStepReachable(session: AssetImportSessionResponse, step: WorkflowStep): boolean {
  return workflowStepIndex(step) <= workflowStepIndex(maxReachableWorkflowStep(session));
}
