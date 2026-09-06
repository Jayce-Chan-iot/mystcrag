import { ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE } from "@mystcrag/design-contract";

import { BEAD_IMPORT_CLIENT_ERROR_CODES, safeOperatorMessage } from "./api-client";

/**
 * Every loader reports failures through this one classifier, because a raw
 * transport error can name the backend origin, an archive path or a database
 * column. Only an error that carries a code this client itself produced has a
 * message worth showing; anything else is replaced by fixed operator copy.
 */

export type ClassifiedFailure = { code: string; message: string; retryable: boolean };

const KNOWN_FAILURE_CODES: ReadonlySet<string> = new Set([
  ...Object.keys(ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE),
  ...BEAD_IMPORT_CLIENT_ERROR_CODES
]);

const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE"
]);

const FALLBACK_MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  UNAUTHORIZED: "管理员会话已失效，请重新登录。",
  NOT_FOUND: "导入任务不存在或已被清理。",
  CONFLICT: "服务端数据已更新，请确认后重试。",
  PAYLOAD_TOO_LARGE: "文件超出允许的大小上限。",
  UNSUPPORTED_MEDIA_TYPE: "文件类型不受支持。",
  UNPROCESSABLE_ENTITY: "服务端无法处理该请求。",
  VALIDATION_ERROR: "请求未通过服务端校验。",
  NETWORK_ERROR: "无法连接珠子素材导入服务，请稍后重试。",
  UNEXPECTED_RESPONSE: "服务返回了未预期的响应。",
  CONTRACT_VIOLATION: "服务返回的数据不符合契约。",
  CLIENT_VALIDATION: "提交的数据未通过契约校验。"
};

const GENERIC_FAILURE_MESSAGE = "珠子素材导入服务暂时不可用，请稍后重试。";

export function classifyFailure(error: unknown): ClassifiedFailure {
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown } | null | undefined;
  const rawCode = typeof candidate?.code === "string" ? candidate.code : null;
  // An error without a known code never came from the contract client, so its
  // message is untrusted and is dropped instead of being sanitised.
  const known = rawCode !== null && KNOWN_FAILURE_CODES.has(rawCode);
  const code = known && rawCode !== null ? rawCode : "NETWORK_ERROR";
  const fallback = FALLBACK_MESSAGE_BY_CODE[code] ?? GENERIC_FAILURE_MESSAGE;
  const rawMessage = known ? candidate?.message : undefined;
  return {
    code,
    message:
      typeof rawMessage === "string" && rawMessage.trim() !== ""
        ? safeOperatorMessage(rawMessage, fallback)
        : fallback,
    retryable:
      known && typeof candidate?.retryable === "boolean" ? candidate.retryable : !NON_RETRYABLE_CODES.has(code)
  };
}
