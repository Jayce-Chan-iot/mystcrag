import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  ShowroomRequestError,
  createShowroomDeps,
  getShowroomProduct,
  parseDetailRequest,
  sendShowroomDetail,
  sendShowroomUpstreamError,
  sendShowroomValidationError
} from "../../../../../showroom/projection";

/**
 * `GET /api/showroom/products/{slug}?market=...&locale=...`
 *
 * Anonymous, read-only product detail. An unapproved, revoked, expired,
 * out-of-market, untranslated, unpriced or media-less product returns `404`
 * exactly as an unknown slug does, so withdrawn work never reveals its
 * existence. A source read failure is a `500`, never a raw store response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  let request;
  try {
    request = parseDetailRequest(req.query as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ShowroomRequestError) {
      sendShowroomValidationError(res, error, req.requestId);
      return;
    }
    throw error;
  }

  try {
    const result = await getShowroomProduct(
      createShowroomDeps(req.scope),
      String(req.params.slug ?? ""),
      request
    );
    sendShowroomDetail(res, result, req.requestId);
  } catch {
    sendShowroomUpstreamError(res, req.requestId);
  }
}
