import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  ShowroomRequestError,
  createShowroomDeps,
  listShowroomProducts,
  parseListRequest,
  sendShowroomList,
  sendShowroomUpstreamError,
  sendShowroomValidationError
} from "../../../../showroom/projection";

/**
 * `GET /api/showroom/products?market=...&locale=...`
 *
 * Anonymous, read-only list. Only products that pass the single server-side
 * publication predicate appear; the page is a strictly parsed
 * `ShowroomProductPageSchema`. No store credentials are accepted (see the
 * middleware public bypass policy) and a source read failure is a `500`, never a
 * fallback to raw store data.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  let request;
  try {
    request = parseListRequest(req.query as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ShowroomRequestError) {
      sendShowroomValidationError(res, error);
      return;
    }
    throw error;
  }

  try {
    const result = await listShowroomProducts(createShowroomDeps(req.scope), request);
    sendShowroomList(res, result);
  } catch {
    sendShowroomUpstreamError(res);
  }
}
