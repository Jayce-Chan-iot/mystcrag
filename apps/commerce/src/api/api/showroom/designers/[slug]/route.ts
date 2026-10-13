import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  ShowroomRequestError,
  createShowroomDeps,
  getShowroomDesigner,
  parseDetailRequest,
  sendShowroomDetail,
  sendShowroomUpstreamError,
  sendShowroomValidationError
} from "../../../../../showroom/projection";

/**
 * `GET /api/showroom/designers/{slug}?market=...&locale=...`
 *
 * Anonymous, read-only designer detail. The profile and every listed work go
 * through the same publication predicate, so an unapproved designer or an
 * unapproved work is `404`/excluded rather than fabricated.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  let request;
  try {
    request = parseDetailRequest(req.query as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ShowroomRequestError) {
      sendShowroomValidationError(res, error);
      return;
    }
    throw error;
  }

  try {
    const result = await getShowroomDesigner(
      createShowroomDeps(req.scope),
      String(req.params.slug ?? ""),
      request
    );
    sendShowroomDetail(res, result);
  } catch {
    sendShowroomUpstreamError(res);
  }
}
