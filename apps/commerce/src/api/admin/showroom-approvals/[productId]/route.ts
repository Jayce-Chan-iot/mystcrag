import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  ShowroomApprovalNotFoundError,
  ShowroomMediaWithdrawalTargetError,
  computeTranslationFingerprint
} from "../../../../showroom/publication-gate";
import { SHOWROOM_PUBLICATION_MODULE } from "../../../../modules/showroom-publication";
import type ShowroomPublicationService from "../../../../modules/showroom-publication/service";

/**
 * `POST /admin/showroom-approvals/{productId}` (requires Medusa Admin auth)
 *
 * Records one audited manual publication decision for a product: `APPROVE`
 * (versioned authorization, approved price fingerprint, per-locale reviewed copy
 * and approved media), `REVOKE` (withdraw the whole authorization) or
 * `WITHDRAW_MEDIA` (withdraw one asset by provenance checksum). Every action
 * appends an audit event and takes effect on the next public read; there is no
 * path here that writes a product, a price row or a media file.
 *
 * On `APPROVE` the server pins each reviewed locale to the live Medusa
 * translation it was reviewed against; an Admin edit that is not followed by a
 * new review then fails the public gate closed.
 *
 * `GET` returns the current approval and its audit trail.
 */
const ACTIONS = ["APPROVE", "REVOKE", "WITHDRAW_MEDIA"] as const;
type ApprovalAction = (typeof ACTIONS)[number];

const AVAILABILITY_STATES = ["AVAILABLE", "INQUIRY_ONLY", "OUT_OF_STOCK", "COMING_SOON"];
const MARKETS = ["CN", "TW"];
const LOCALES = ["zh-CN", "zh-TW", "en-US"];

function errorEnvelope(
  code: string,
  message: string,
  requestId?: string,
  fieldErrors?: { path: string; message: string }[]
) {
  return {
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      requestId: requestId && requestId.trim().length > 0 ? requestId : "unknown-request"
    }
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateApproveBody(body: any): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  if (!Number.isSafeInteger(body.publicRevision) || body.publicRevision < 1) {
    errors.push({ path: "publicRevision", message: "Expected a positive safe integer." });
  }
  const authorization = body.authorization;
  if (!authorization || typeof authorization !== "object") {
    errors.push({ path: "authorization", message: "Authorization is required." });
  } else {
    if (authorization.status !== "APPROVED") {
      errors.push({ path: "authorization.status", message: "A new approval must be APPROVED." });
    }
    if (!Array.isArray(authorization.markets) || authorization.markets.some((m: unknown) => !MARKETS.includes(m as string)) || authorization.markets.length === 0) {
      errors.push({ path: "authorization.markets", message: "Expected a non-empty subset of CN and TW." });
    }
    if (!isNonEmptyString(authorization.effectiveFrom) || !isNonEmptyString(authorization.expiresAt)) {
      errors.push({ path: "authorization.effectiveFrom", message: "An effective window is required." });
    }
  }
  if (!AVAILABILITY_STATES.includes(body.availability)) {
    errors.push({ path: "availability", message: "Expected an approved availability state." });
  }
  if (body.prices !== null && body.prices !== undefined) {
    if (typeof body.prices !== "object" || Array.isArray(body.prices)) {
      errors.push({ path: "prices", message: "Expected a per-market approved price map." });
    } else {
      for (const [market, entry] of Object.entries(body.prices as Record<string, any>)) {
        if (!MARKETS.includes(market)) {
          errors.push({ path: `prices.${market}`, message: "Unknown market." });
          continue;
        }
        if (
          !isNonEmptyString(entry?.currency) ||
          !Number.isSafeInteger(entry?.amountMinor) ||
          entry.amountMinor < 0 ||
          !isNonEmptyString(entry?.regionId)
        ) {
          errors.push({ path: `prices.${market}`, message: "Expected a complete manually approved price row." });
        }
      }
    }
  }
  if (!body.locales || typeof body.locales !== "object") {
    errors.push({ path: "locales", message: "Reviewed per-locale copy is required." });
  } else {
    for (const [locale, copy] of Object.entries(body.locales as Record<string, any>)) {
      if (!LOCALES.includes(locale)) {
        errors.push({ path: `locales.${locale}`, message: "Unknown locale." });
        continue;
      }
      if (!Number.isSafeInteger(copy?.reviewedRevision) || copy.reviewedRevision < 1) {
        errors.push({ path: `locales.${locale}.reviewedRevision`, message: "Expected a positive safe integer." });
      }
      if (!isNonEmptyString(copy?.title) || !isNonEmptyString(copy?.summary)) {
        errors.push({ path: `locales.${locale}`, message: "Reviewed title and summary are required." });
      }
    }
  }
  if (!Array.isArray(body.media)) {
    errors.push({ path: "media", message: "An array of approved media is required." });
  } else {
    body.media.forEach((asset: any, index: number) => {
      if (!isNonEmptyString(asset?.url) || !isNonEmptyString(asset?.alt) || !isNonEmptyString(asset?.checksum)) {
        errors.push({ path: `media.${index}`, message: "Expected approved url, alt and provenance checksum." });
      }
    });
  }
  return errors;
}

/**
 * The live per-locale translation fingerprint for the product, read from the
 * Medusa translation module. Every display locale is covered: a locale with no
 * stored translation reports the empty-payload fingerprint, so creating one
 * later is itself a change. A failed read is surfaced, never skipped, so an
 * approval can never be stamped against an unknown translation state.
 */
async function liveTranslationFingerprints(scope: any, productId: string): Promise<Record<string, string>> {
  const byLocale: Record<string, string> = Object.fromEntries(
    LOCALES.map((locale) => [locale, computeTranslationFingerprint(null)])
  );
  let rows: any[] = [];
  try {
    rows = (await scope
      .resolve(Modules.TRANSLATION)
      .listTranslations({ reference: "product", reference_id: productId })) ?? [];
  } catch {
    throw new Error("Failed to read the live product translations");
  }
  for (const row of rows) {
    const locale = String(row?.locale_code ?? "");
    if (LOCALES.includes(locale)) {
      byLocale[locale] = computeTranslationFingerprint(row?.translations);
    }
  }
  return byLocale;
}

/**
 * Pins each reviewed locale copy to the live translation it was reviewed
 * against, so an Admin edit that is not followed by a new editorial review
 * fails the public gate closed instead of serving the superseded approval.
 */
function stampTranslationFingerprints(
  locales: Record<string, any>,
  fingerprints: Record<string, string>
): Record<string, any> {
  const stamped: Record<string, any> = {};
  for (const [locale, copy] of Object.entries(locales)) {
    stamped[locale] = { ...copy, translationFingerprint: fingerprints[locale] };
  }
  return stamped;
}

/**
 * The live product public facts an approval records: the handle (the public slug)
 * and the Medusa status. They are observed at approval time — not an atomic
 * snapshot of the public response, which is recomputed per read from the live
 * catalog together with the record — and recorded so the event carries the
 * catalog facts that decision saw. A read failure is surfaced; a product that
 * does not exist is `null`, so no decision is ever recorded against unknown
 * facts.
 */
async function liveProductPublicFacts(
  scope: any,
  productId: string
): Promise<{ handle: string; status: string } | null> {
  let rows: any[] = [];
  try {
    const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "product",
      fields: ["id", "handle", "status"],
      filters: { id: productId }
    });
    rows = data ?? [];
  } catch {
    throw new Error("Failed to read the live product");
  }
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { handle: String(row.handle ?? ""), status: String(row.status ?? "") };
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const productId = String(req.params.productId ?? "");
  const service = req.scope.resolve(SHOWROOM_PUBLICATION_MODULE) as ShowroomPublicationService;
  const approval = await service.findApproval("PRODUCT", productId);
  res.status(200).json({ approval, audit: approval?.audit ?? [] });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const productId = String(req.params.productId ?? "");
  const body = (req.body ?? {}) as any;
  const actorId = String((req as any).auth_context?.actor_id ?? "unknown-admin");
  const action = body.action as ApprovalAction;

  if (!ACTIONS.includes(action)) {
    res.status(400).json(
      errorEnvelope(
        "VALIDATION_ERROR",
        `Expected action to be one of ${ACTIONS.join(", ")}.`,
        req.requestId,
        [{ path: "action", message: "Unknown approval action." }]
      )
    );
    return;
  }

  if (action === "APPROVE") {
    const fieldErrors = validateApproveBody(body);
    if (fieldErrors.length > 0) {
      res.status(400).json(errorEnvelope("VALIDATION_ERROR", "Invalid approval payload.", req.requestId, fieldErrors));
      return;
    }
  }
  if (action === "WITHDRAW_MEDIA" && !isNonEmptyString(body.checksum)) {
    res.status(400).json(
      errorEnvelope("VALIDATION_ERROR", "A media checksum is required.", req.requestId, [
        { path: "checksum", message: "Expected the withdrawn asset's provenance checksum." }
      ])
    );
    return;
  }

  const service = req.scope.resolve(SHOWROOM_PUBLICATION_MODULE) as ShowroomPublicationService;
  try {
    if (action === "APPROVE") {
      const fingerprints = await liveTranslationFingerprints(req.scope, productId);
      const productFacts = await liveProductPublicFacts(req.scope, productId);
      if (!productFacts) {
        res.status(404).json(errorEnvelope("NOT_FOUND", "The product does not exist.", req.requestId));
        return;
      }
      const approval = await service.approve(
        {
          subjectKind: "PRODUCT",
          subjectRef: productId,
          publicRevision: body.publicRevision,
          authorization: body.authorization,
          availability: body.availability,
          prices: body.prices ?? {},
          locales: stampTranslationFingerprints(body.locales, fingerprints),
          media: body.media,
          handle: productFacts.handle,
          productStatus: productFacts.status
        },
        actorId
      );
      res.status(200).json({ approval, audit: approval.audit });
      return;
    }
    if (action === "REVOKE") {
      const approval = await service.revoke("PRODUCT", productId, actorId, body.reason);
      res.status(200).json({ approval, audit: approval.audit });
      return;
    }
    const approval = await service.withdrawMedia("PRODUCT", productId, body.checksum, actorId, body.reason);
    res.status(200).json({ approval, audit: approval.audit });
  } catch (error) {
    // A subject with no approval, or a media checksum the subject never carried,
    // is a client-facing not-found. Anything else — a translation-module or
    // database failure — is a server error whose internal detail must not leak.
    if (error instanceof ShowroomApprovalNotFoundError || error instanceof ShowroomMediaWithdrawalTargetError) {
      res.status(404).json(errorEnvelope("NOT_FOUND", error.message, req.requestId));
      return;
    }
    res.status(500).json(
      errorEnvelope("INTERNAL_ERROR", "The showroom approval decision could not be recorded.", req.requestId)
    );
  }
}
