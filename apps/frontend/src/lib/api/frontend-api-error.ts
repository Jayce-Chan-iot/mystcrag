export const FRONTEND_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "PRICE_CHANGED",
  "INVENTORY_CHANGED",
  "COMPLIANCE_BLOCKED",
  "CONSENT_REQUIRED",
  "NOT_IMPLEMENTED",
  "INTERNAL_ERROR",
  "AI_GENERATION_FAILED",
  "THREE_ASSET_FALLBACK",
  "NETWORK_ERROR",
  "EMPTY_STATE"
] as const;

export type FrontendErrorCode = (typeof FRONTEND_ERROR_CODES)[number];

export class FrontendApiError extends Error {
  constructor(public readonly code: FrontendErrorCode, message: string, public readonly requestId?: string) {
    super(message);
    this.name = "FrontendApiError";
  }
}

export const ERROR_PRESENTATION: Record<FrontendErrorCode, { title: string; message: string; action: string; tone: "warning" | "danger" | "neutral" }> = {
  UNAUTHORIZED: { title: "需要验证开发会话", message: "请配置明确的短期访问凭证后重新打开页面；系统不会以固定用户静默继续。", action: "重新连接", tone: "warning" },
  FORBIDDEN: { title: "无法访问这份设计", message: "当前已验证身份不是这份设计的所有者。", action: "重新生成", tone: "danger" },
  VALIDATION_ERROR: { title: "还有信息需要确认", message: "请检查标注的输入项，再继续生成设计。", action: "返回修改", tone: "warning" },
  NOT_FOUND: { title: "没有找到这份设计", message: "设计可能不存在，或当前身份无权查看。", action: "重新生成", tone: "neutral" },
  CONFLICT: { title: "设计已在其他位置更新", message: "我们保留了你当前的操作。请同步最新版本后再尝试。", action: "同步最新设计", tone: "warning" },
  PRICE_CHANGED: { title: "价格已更新", message: "材料或工艺价格发生变化，请确认新价格后继续。", action: "查看新价格", tone: "warning" },
  INVENTORY_CHANGED: { title: "材料库存有变化", message: "部分材料刚刚不可用，系统会在重试时重新匹配当前可用材料。", action: "重新生成方案", tone: "warning" },
  COMPLIANCE_BLOCKED: { title: "内容需要调整", message: "当前设计说明含有不适合展示的表达，已停止生成。", action: "调整偏好", tone: "danger" },
  CONSENT_REQUIRED: { title: "需要发布授权", message: "发布前请明确同意公开展示；设计仍保持私密。", action: "确认授权", tone: "warning" },
  NOT_IMPLEMENTED: { title: "塔罗灵感尚未开放", message: "当前环境暂未开启塔罗灵感设计，请稍后再试或选择其他设计入口。", action: "返回设计入口", tone: "neutral" },
  INTERNAL_ERROR: { title: "服务暂时无法完成操作", message: "设计数据未被更改，请稍后重试。", action: "重试", tone: "danger" },
  AI_GENERATION_FAILED: { title: "灵感暂时没有抵达", message: "AI 生成未完成，你的问卷答案已保留。", action: "重新生成", tone: "neutral" },
  THREE_ASSET_FALLBACK: { title: "正在使用轻量预览", message: "部分 3D 材质未加载，当前以可靠的简化外观展示。", action: "重新加载", tone: "neutral" },
  NETWORK_ERROR: { title: "网络连接中断", message: "暂时无法连接服务。请检查网络后重试。", action: "重新连接", tone: "danger" },
  EMPTY_STATE: { title: "还没有可展示的设计", message: "完成一轮 AI 问卷后，三套设计会出现在这里。", action: "开始 AI 设计", tone: "neutral" }
};

export function toFrontendApiError(error: unknown): FrontendApiError {
  if (error instanceof FrontendApiError) return error;
  return new FrontendApiError("NETWORK_ERROR", error instanceof Error ? error.message : "Unknown network error");
}
