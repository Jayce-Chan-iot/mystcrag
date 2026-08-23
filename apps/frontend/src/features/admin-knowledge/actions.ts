"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  createAdminSession,
  destroyAdminSession,
  isAdminAuthenticated,
  verifyAdminKey
} from "./admin-auth";
import { KnowledgeConsoleError, createKnowledgeAdminClient } from "./admin-api";

/**
 * All console writes flow through these Server Actions → Admin API → existing
 * Review/Source services. The browser never talks to the database or the
 * Admin API directly (task book: 不得前端直接操作 DB).
 */

async function requireAdminSession(): Promise<ReturnType<typeof createKnowledgeAdminClient>> {
  if (!(await isAdminAuthenticated())) {
    throw new KnowledgeConsoleError("FORBIDDEN", "Admin session required.", 403);
  }
  return createKnowledgeAdminClient();
}

function revalidateConsole(): void {
  revalidatePath("/admin/knowledge");
  revalidatePath("/admin/knowledge/review");
  revalidatePath("/admin/knowledge/sources");
  revalidatePath("/admin/knowledge/coverage");
  revalidatePath("/admin/knowledge/atlas");
  revalidatePath("/admin/knowledge/runs");
}

export async function loginAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!verifyAdminKey(key)) {
    redirect("/admin/knowledge/login?error=invalid");
  }
  await createAdminSession();
  redirect("/admin/knowledge");
}

export async function logoutAction(): Promise<void> {
  await destroyAdminSession();
  redirect("/admin/knowledge/login");
}

export async function ruleActionAction(formData: FormData): Promise<void> {
  const api = await requireAdminSession();
  const ruleId = String(formData.get("ruleId") ?? "");
  const action = String(formData.get("action") ?? "");
  if (action !== "approve" && action !== "reject" && action !== "supersede") {
    throw new KnowledgeConsoleError("VALIDATION_ERROR", "Unknown rule action.", 400);
  }
  await api.actOnRule(ruleId, action);
  revalidateConsole();
}

export async function editRuleAction(formData: FormData): Promise<void> {
  const api = await requireAdminSession();
  const ruleId = String(formData.get("ruleId") ?? "");
  const confidenceRaw = formData.get("confidence");
  const claimTypeRaw = formData.get("claimType");
  const input: { confidence?: number; claimType?: string | null } = {};
  if (typeof confidenceRaw === "string" && confidenceRaw !== "") {
    input.confidence = Number(confidenceRaw);
  }
  if (typeof claimTypeRaw === "string" && claimTypeRaw !== "") {
    input.claimType = claimTypeRaw === "none" ? null : claimTypeRaw;
  }
  if (input.confidence === undefined && input.claimType === undefined) {
    throw new KnowledgeConsoleError("VALIDATION_ERROR", "Nothing to edit.", 400);
  }
  await api.editRule(ruleId, input);
  revalidateConsole();
}

export async function reviewSourceAction(formData: FormData): Promise<void> {
  const api = await requireAdminSession();
  const sourceId = String(formData.get("sourceId") ?? "");
  const reviewStatus = String(formData.get("reviewStatus") ?? "");
  if (reviewStatus !== "APPROVED" && reviewStatus !== "REJECTED" && reviewStatus !== "NEEDS_REVIEW") {
    throw new KnowledgeConsoleError("VALIDATION_ERROR", "Unknown source review status.", 400);
  }
  await api.reviewSource(sourceId, reviewStatus);
  revalidateConsole();
}

export async function setSourceEnabledAction(formData: FormData): Promise<void> {
  const api = await requireAdminSession();
  const sourceId = String(formData.get("sourceId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await api.setSourceEnabled(sourceId, enabled);
  revalidateConsole();
}

export async function runReviewPipelineAction(): Promise<void> {
  const api = await requireAdminSession();
  await api.runReviewPipeline();
  revalidateConsole();
}

export async function publishVersionAction(formData: FormData): Promise<void> {
  const api = await requireAdminSession();
  const version = String(formData.get("version") ?? "").trim();
  if (version === "") {
    throw new KnowledgeConsoleError("VALIDATION_ERROR", "A version slug is required.", 400);
  }
  await api.publishVersion(version);
  revalidateConsole();
}
