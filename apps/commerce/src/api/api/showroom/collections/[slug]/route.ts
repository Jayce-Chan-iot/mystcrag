import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  ShowroomRequestError,
  createShowroomDeps,
  getShowroomCollection,
  parseDetailRequest,
  sendShowroomDetail,
  sendShowroomUpstreamError,
  sendShowroomValidationError
} from "../../../../../showroom/projection";

/**
 * `GET /api/showroom/collections/{slug}?market=...&locale=...`
 *
 * Anonymous, read-only collection detail. The collection and its works are
 * filtered by the same publication predicate; an unapproved collection or work
 * is `404`/excluded rather than partially served.
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
    const result = await getShowroomCollection(
      createShowroomDeps(req.scope),
      String(req.params.slug ?? ""),
      request
    );
    sendShowroomDetail(res, result);
  } catch {
    sendShowroomUpstreamError(res);
  }
}
