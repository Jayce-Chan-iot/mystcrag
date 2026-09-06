import {
  ASSET_MANIFEST_LIMITS,
  AssetBusinessErrorEnvelopeSchema,
  AssetImportSessionResponseSchema,
  AssetTransportErrorEnvelopeSchema,
  CancelAssetImportSessionRequestSchema,
  CancelAssetImportSessionResponseSchema,
  CheckBeadProductDraftCompletenessResponseSchema,
  CreateAssetImportSessionRequestSchema,
  CreateAssetImportSessionResponseSchema,
  GetBeadImageGroupPublishResultResponseSchema,
  ListAssetImportSessionsResponseSchema,
  PublishBeadImageGroupRequestSchema,
  PublishBeadImageGroupResponseSchema,
  RegisterAssetManifestRequestSchema,
  RegisterAssetManifestResponseSchema,
  ReprocessBeadImageGroupRequestSchema,
  ReprocessBeadImageGroupResponseSchema,
  ReviewProcessedAssetRequestSchema,
  ReviewProcessedAssetResponseSchema,
  SaveBeadProductDraftRequestSchema,
  SaveBeadProductDraftResponseSchema,
  SelectProcessedVersionRequestSchema,
  SelectProcessedVersionResponseSchema,
  Sha256Schema,
  StartAssetImportGroupingRequestSchema,
  StartAssetImportGroupingResponseSchema,
  StartAssetImportProcessingRequestSchema,
  StartAssetImportProcessingResponseSchema,
  UpdateBeadImageGroupRequestSchema,
  UpdateBeadImageGroupResponseSchema,
  UpdateCrystalDraftCurationRequestSchema,
  UpdateCrystalDraftCurationResponseSchema,
  UploadAssetFileResponseSchema,
  type AssetImportErrorCode,
  type AssetImportErrorRecoveryAction,
  type AssetImportFieldError,
  type AssetImportSessionFileView,
  type AssetImportSessionResponse,
  type CancelAssetImportSessionResponse,
  type CheckBeadProductDraftCompletenessResponse,
  type CreateAssetImportSessionResponse,
  type GetBeadImageGroupPublishResultResponse,
  type ListAssetImportSessionsQuery,
  type ListAssetImportSessionsResponse,
  type PublishBeadImageGroupRequest,
  type PublishBeadImageGroupResponse,
  type RegisterAssetManifestRequest,
  type RegisterAssetManifestResponse,
  type ReprocessBeadImageGroupRequest,
  type ReprocessBeadImageGroupResponse,
  type ReviewProcessedAssetRequest,
  type ReviewProcessedAssetResponse,
  type SaveBeadProductDraftRequest,
  type SaveBeadProductDraftResponse,
  type SelectProcessedVersionRequest,
  type SelectProcessedVersionResponse,
  type StartAssetImportGroupingResponse,
  type StartAssetImportProcessingResponse,
  type UpdateBeadImageGroupRequest,
  type UpdateBeadImageGroupResponse,
  type UpdateCrystalDraftCurationRequest,
  type UpdateCrystalDraftCurationResponse,
  type UploadAssetFileResponse
} from "@mystcrag/design-contract";

/**
 * Browser-facing client for the bead import admin API. It only ever talks to
 * the Next proxy mounted inside the admin cookie scope: the proxy authenticates
 * the session cookie and is the single place that attaches the server-held
 * admin key, so this module never reads configuration, never names that header
 * and never sees a backend origin.
 */
export const BEAD_IMPORT_BROWSER_PROXY_PREFIX = "/admin/bead-import/proxy";

/** Non-secret client-side classifications that are not contract transport codes. */
export const BEAD_IMPORT_CLIENT_ERROR_CODES = [
  "NETWORK_ERROR",
  "UNEXPECTED_RESPONSE",
  "CONTRACT_VIOLATION",
  "CLIENT_VALIDATION"
] as const;
export type BeadImportClientErrorCode = (typeof BEAD_IMPORT_CLIENT_ERROR_CODES)[number];

const NETWORK_MESSAGE = "无法连接珠子素材导入服务，请稍后重试。";
const UNEXPECTED_MESSAGE = "服务返回了未预期的响应。";
const CONTRACT_VIOLATION_MESSAGE = "服务返回的数据不符合契约。";
const CLIENT_VALIDATION_MESSAGE = "提交的数据未通过契约校验。";
const GENERIC_ISSUE_MESSAGE = "输入不符合契约要求。";

const FALLBACK_MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "管理员会话已失效，请重新登录。",
  NOT_FOUND: "导入任务或分组不存在。",
  CONFLICT: "服务端数据已更新，请确认后重试。",
  PAYLOAD_TOO_LARGE: "文件超出允许的大小上限。",
  UNSUPPORTED_MEDIA_TYPE: "文件类型不受支持。",
  UNPROCESSABLE_ENTITY: "服务端无法处理该请求。",
  VALIDATION_ERROR: "请求未通过服务端校验。",
  INTERNAL_ERROR: "珠子素材导入服务暂时不可用。"
};

const NON_RETRYABLE_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_ENTITY"
]);

const ISSUE_MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  invalid_type: "字段类型不正确。",
  invalid_enum_value: "字段取值不在允许范围内。",
  invalid_literal: "字段取值不正确。",
  invalid_string: "字段格式不正确。",
  too_small: "字段长度或数值低于允许下限。",
  too_big: "字段长度或数值超出允许上限。",
  unrecognized_keys: "请求包含契约未定义的字段。",
  invalid_union: "字段取值不符合任何一种允许的形式。",
  invalid_date: "日期格式不正确。"
};

/**
 * Rejects anything that looks like an absolute path, a drive letter, a storage
 * key name or a control character before it can reach operator-visible copy.
 */
const UNSAFE_MESSAGE = /(?:^|[\s"'(])(?:\/|[A-Za-z]:[\\/])\S|[\u0000-\u001f]|archiveKey|storageKey/i;

export function safeOperatorMessage(candidate: string, fallback: string): string {
  return UNSAFE_MESSAGE.test(candidate) ? fallback : candidate;
}

type ContractIssue = {
  code: string;
  path: readonly PropertyKey[];
  message: string;
};

type ContractSchema<T> = {
  safeParse(
    value: unknown
  ): { success: true; data: T } | { success: false; error: { issues: readonly ContractIssue[] } };
};

export type BeadImportApiErrorDetail = {
  code: string;
  status: number;
  message: string;
  retryable: boolean;
  assetCode?: AssetImportErrorCode | null;
  recoveryAction?: AssetImportErrorRecoveryAction | null;
  fieldErrors?: readonly AssetImportFieldError[];
};

export class BeadImportApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly assetCode: AssetImportErrorCode | null;
  readonly recoveryAction: AssetImportErrorRecoveryAction | null;
  readonly fieldErrors: readonly AssetImportFieldError[];

  constructor(detail: BeadImportApiErrorDetail) {
    super(detail.message);
    this.name = "BeadImportApiError";
    this.code = detail.code;
    this.status = detail.status;
    this.retryable = detail.retryable;
    this.assetCode = detail.assetCode ?? null;
    this.recoveryAction = detail.recoveryAction ?? null;
    this.fieldErrors = detail.fieldErrors ?? [];
  }
}

function contractError(
  code: "CLIENT_VALIDATION" | "CONTRACT_VIOLATION",
  issues: readonly ContractIssue[]
): BeadImportApiError {
  return new BeadImportApiError({
    code,
    status: 0,
    message: code === "CONTRACT_VIOLATION" ? CONTRACT_VIOLATION_MESSAGE : CLIENT_VALIDATION_MESSAGE,
    retryable: false,
    fieldErrors: issues.map((issue) => ({
      fieldPath: issue.path.length === 0 ? "(root)" : issue.path.map((segment) => String(segment)).join("."),
      message:
        issue.code === "custom" && !UNSAFE_MESSAGE.test(issue.message)
          ? issue.message
          : (ISSUE_MESSAGE_BY_CODE[issue.code] ?? GENERIC_ISSUE_MESSAGE)
    }))
  });
}

/** Validates operator-supplied request bodies before they leave the browser. */
function parseRequest<T>(schema: ContractSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw contractError("CLIENT_VALIDATION", result.error.issues);
  }
  return result.data;
}

/**
 * Validates server payloads. A mismatch means the backend drifted from the
 * shared contract, so it is reported distinctly and never surfaced as operator
 * input feedback.
 */
function parseResponse<T>(schema: ContractSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw contractError("CONTRACT_VIOLATION", result.error.issues);
  }
  return result.data;
}

/**
 * Private server archive keys are stripped before any session data reaches UI
 * state, so no view, log or snapshot can surface storage layout.
 */
function sanitizeFile(file: AssetImportSessionFileView): AssetImportSessionFileView {
  if (file.archiveKey === undefined) {
    return file;
  }
  const copy: AssetImportSessionFileView = { ...file };
  delete copy.archiveKey;
  return copy;
}

export function sanitizeSession(session: AssetImportSessionResponse): AssetImportSessionResponse {
  return { ...session, files: session.files.map(sanitizeFile) };
}

export type SanitizedUploadResult = Omit<UploadAssetFileResponse, "archiveKey">;

function sanitizeUploadResult(result: UploadAssetFileResponse): SanitizedUploadResult {
  const copy: UploadAssetFileResponse = { ...result };
  delete copy.archiveKey;
  return copy;
}

function classifyFailure(status: number, body: string): BeadImportApiError {
  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  const business = AssetBusinessErrorEnvelopeSchema.safeParse(payload);
  if (business.success) {
    const error = business.data.error;
    const fallback = FALLBACK_MESSAGE_BY_CODE[error.code] ?? UNEXPECTED_MESSAGE;
    return new BeadImportApiError({
      code: error.code,
      status,
      message: safeOperatorMessage(error.message, fallback),
      retryable: error.retryable,
      assetCode: error.assetCode,
      recoveryAction: error.recoveryAction,
      fieldErrors: (error.fieldErrors ?? []).map((field) => ({
        fieldPath: field.fieldPath,
        message: safeOperatorMessage(field.message, GENERIC_ISSUE_MESSAGE)
      }))
    });
  }
  const transport = AssetTransportErrorEnvelopeSchema.safeParse(payload);
  if (transport.success) {
    const error = transport.data.error;
    const fallback = FALLBACK_MESSAGE_BY_CODE[error.code] ?? UNEXPECTED_MESSAGE;
    return new BeadImportApiError({
      code: error.code,
      status,
      message: safeOperatorMessage(error.message, fallback),
      retryable: !NON_RETRYABLE_TRANSPORT_CODES.has(error.code),
      fieldErrors: (error.fieldErrors ?? []).map((field) => ({
        fieldPath: field.fieldPath,
        message: safeOperatorMessage(field.message, GENERIC_ISSUE_MESSAGE)
      }))
    });
  }
  return new BeadImportApiError({
    code: "UNEXPECTED_RESPONSE",
    status,
    message: UNEXPECTED_MESSAGE,
    retryable: false
  });
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

type FetchLike = (url: string, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

export type BeadImportClientOptions = {
  fetcher?: FetchLike;
  proxyPrefix?: string;
};

export type BeadImportRequestOptions = {
  signal?: AbortSignal;
};

export type BeadImportUpload = {
  body: ReadableStream<Uint8Array>;
  byteLength: number;
  contentType?: string;
  sha256?: string;
};

type SendConfig = {
  method: "GET" | "POST" | "PATCH" | "PUT";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  stream?: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function buildUrl(prefix: string, path: string, query?: SendConfig["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  return `${prefix}${path}${suffix}`;
}

export function createBeadImportClient(options: BeadImportClientOptions = {}) {
  const prefix = options.proxyPrefix ?? BEAD_IMPORT_BROWSER_PROXY_PREFIX;
  const fetcher = options.fetcher ?? fetch;

  async function send<T>(
    path: string,
    config: SendConfig,
    parse: (payload: unknown) => T
  ): Promise<T> {
    const init: RequestInit & { duplex?: "half" } = {
      method: config.method,
      cache: "no-store",
      credentials: "same-origin",
      signal: config.signal
    };
    if (config.headers !== undefined) {
      init.headers = config.headers;
    }
    if (config.stream !== undefined) {
      init.body = config.stream;
      init.duplex = "half";
    } else if (config.body !== undefined) {
      init.headers = { ...config.headers, "content-type": "application/json" };
      init.body = JSON.stringify(config.body);
    }

    let response: Response;
    try {
      response = await fetcher(buildUrl(prefix, path, config.query), init);
    } catch {
      throw new BeadImportApiError({
        code: "NETWORK_ERROR",
        status: 0,
        message: NETWORK_MESSAGE,
        retryable: true
      });
    }
    const text = await response.text();
    if (!response.ok) {
      throw classifyFailure(response.status, text);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BeadImportApiError({
        code: "UNEXPECTED_RESPONSE",
        status: response.status,
        message: UNEXPECTED_MESSAGE,
        retryable: false
      });
    }
    return parse(payload);
  }

  function sessionPath(sessionId: string): string {
    return `/sessions/${encodeURIComponent(sessionId)}`;
  }

  function groupPath(groupId: string): string {
    return `/groups/${encodeURIComponent(groupId)}`;
  }

  return {
    async createSession(
      idempotencyKey: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<CreateAssetImportSessionResponse> {
      const body = parseRequest(CreateAssetImportSessionRequestSchema, { idempotencyKey });
      return send(
        "/sessions",
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(CreateAssetImportSessionResponseSchema, payload)
      );
    },

    async listSessions(
      query: ListAssetImportSessionsQuery,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<ListAssetImportSessionsResponse> {
      return send(
        "/sessions",
        {
          method: "GET",
          query: { state: query.state, limit: query.limit, cursor: query.cursor },
          signal: requestOptions.signal
        },
        (payload) => parseResponse(ListAssetImportSessionsResponseSchema, payload)
      );
    },

    async getSession(
      sessionId: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<AssetImportSessionResponse> {
      return send(sessionPath(sessionId), { method: "GET", signal: requestOptions.signal }, (payload) =>
        sanitizeSession(parseResponse(AssetImportSessionResponseSchema, payload))
      );
    },

    async cancelSession(
      sessionId: string,
      idempotencyKey: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<CancelAssetImportSessionResponse> {
      const body = parseRequest(CancelAssetImportSessionRequestSchema, { idempotencyKey });
      return send(
        `${sessionPath(sessionId)}/cancel`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(CancelAssetImportSessionResponseSchema, payload)
      );
    },

    async registerManifest(
      sessionId: string,
      request: RegisterAssetManifestRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<RegisterAssetManifestResponse> {
      const body = parseRequest(RegisterAssetManifestRequestSchema, request);
      return send(
        `${sessionPath(sessionId)}/manifest`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(RegisterAssetManifestResponseSchema, payload)
      );
    },

    async uploadFileContent(
      sessionId: string,
      fileId: string,
      upload: BeadImportUpload,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<SanitizedUploadResult> {
      const { byteLength } = upload;
      if (
        !Number.isInteger(byteLength) ||
        byteLength <= 0 ||
        byteLength > ASSET_MANIFEST_LIMITS.maxFileBytes
      ) {
        throw contractError("CLIENT_VALIDATION", [
          {
            code: "custom",
            path: ["byteLength"],
            message: `上传文件字节数必须是正整数，且不超过 ${ASSET_MANIFEST_LIMITS.maxFileBytes} 字节。`
          }
        ]);
      }
      if (upload.sha256 !== undefined) {
        parseRequest(Sha256Schema, upload.sha256);
      }
      const headers: Record<string, string> = { "content-length": String(byteLength) };
      if (upload.contentType !== undefined) {
        headers["content-type"] = upload.contentType;
      }
      if (upload.sha256 !== undefined) {
        headers["x-content-sha256"] = upload.sha256;
      }
      return send(
        `${sessionPath(sessionId)}/files/${encodeURIComponent(fileId)}/content`,
        {
          method: "PUT",
          stream: upload.body,
          headers,
          signal: requestOptions.signal
        },
        (payload) => sanitizeUploadResult(parseResponse(UploadAssetFileResponseSchema, payload))
      );
    },

    async startGrouping(
      sessionId: string,
      idempotencyKey: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<StartAssetImportGroupingResponse> {
      const body = parseRequest(StartAssetImportGroupingRequestSchema, { idempotencyKey });
      return send(
        `${sessionPath(sessionId)}/grouping/start`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(StartAssetImportGroupingResponseSchema, payload)
      );
    },

    async startProcessing(
      sessionId: string,
      idempotencyKey: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<StartAssetImportProcessingResponse> {
      const body = parseRequest(StartAssetImportProcessingRequestSchema, { idempotencyKey });
      return send(
        `${sessionPath(sessionId)}/processing/start`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(StartAssetImportProcessingResponseSchema, payload)
      );
    },

    async updateGroup(
      groupId: string,
      request: UpdateBeadImageGroupRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<UpdateBeadImageGroupResponse> {
      const body = parseRequest(UpdateBeadImageGroupRequestSchema, request);
      return send(
        groupPath(groupId),
        { method: "PATCH", body, signal: requestOptions.signal },
        (payload) => parseResponse(UpdateBeadImageGroupResponseSchema, payload)
      );
    },

    async reprocessGroup(
      groupId: string,
      request: ReprocessBeadImageGroupRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<ReprocessBeadImageGroupResponse> {
      const body = parseRequest(ReprocessBeadImageGroupRequestSchema, request);
      return send(
        `${groupPath(groupId)}/reprocess`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(ReprocessBeadImageGroupResponseSchema, payload)
      );
    },

    async selectProcessedVersion(
      groupId: string,
      request: SelectProcessedVersionRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<SelectProcessedVersionResponse> {
      const body = parseRequest(SelectProcessedVersionRequestSchema, request);
      return send(
        `${groupPath(groupId)}/processed-version`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(SelectProcessedVersionResponseSchema, payload)
      );
    },

    async reviewProcessedAsset(
      groupId: string,
      processedAssetId: string,
      request: ReviewProcessedAssetRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<ReviewProcessedAssetResponse> {
      const body = parseRequest(ReviewProcessedAssetRequestSchema, request);
      return send(
        `${groupPath(groupId)}/processed-assets/${encodeURIComponent(processedAssetId)}/review`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(ReviewProcessedAssetResponseSchema, payload)
      );
    },

    async saveGroupDraft(
      groupId: string,
      request: SaveBeadProductDraftRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<SaveBeadProductDraftResponse> {
      const body = parseRequest(SaveBeadProductDraftRequestSchema, request);
      return send(
        `${groupPath(groupId)}/draft`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(SaveBeadProductDraftResponseSchema, payload)
      );
    },

    async getDraftCompleteness(
      groupId: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<CheckBeadProductDraftCompletenessResponse> {
      return send(
        `${groupPath(groupId)}/draft-completeness`,
        { method: "GET", signal: requestOptions.signal },
        (payload) => parseResponse(CheckBeadProductDraftCompletenessResponseSchema, payload)
      );
    },

    async updateCrystalDraft(
      crystalDraftId: string,
      request: UpdateCrystalDraftCurationRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<UpdateCrystalDraftCurationResponse> {
      const body = parseRequest(UpdateCrystalDraftCurationRequestSchema, request);
      return send(
        `/crystal-drafts/${encodeURIComponent(crystalDraftId)}`,
        { method: "PATCH", body, signal: requestOptions.signal },
        (payload) => parseResponse(UpdateCrystalDraftCurationResponseSchema, payload)
      );
    },

    async publishGroup(
      groupId: string,
      request: PublishBeadImageGroupRequest,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<PublishBeadImageGroupResponse> {
      const body = parseRequest(PublishBeadImageGroupRequestSchema, request);
      return send(
        `${groupPath(groupId)}/publish`,
        { method: "POST", body, signal: requestOptions.signal },
        (payload) => parseResponse(PublishBeadImageGroupResponseSchema, payload)
      );
    },

    async getPublishResult(
      groupId: string,
      requestOptions: BeadImportRequestOptions = {}
    ): Promise<GetBeadImageGroupPublishResultResponse> {
      return send(
        `${groupPath(groupId)}/publish-result`,
        { method: "GET", signal: requestOptions.signal },
        (payload) => parseResponse(GetBeadImageGroupPublishResultResponseSchema, payload)
      );
    }
  };
}

export type BeadImportClient = ReturnType<typeof createBeadImportClient>;
