import {
  ApprovedAssetDeliveryHeadersSchema,
  ResolveApprovedAssetParamsSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance } from "fastify";

import {
  assetImportErrorEnvelope,
  normalizeAssetImportError
} from "../bead-asset-import/bead-asset-import.errors.js";
import type { ProductAssetService } from "./product-asset.service.js";

export function registerProductAssetRoutes(app: FastifyInstance, service: ProductAssetService): void {
  app.get("/api/assets/:assetKey", async (request, reply) => {
    try {
      const parsed = ResolveApprovedAssetParamsSchema.parse(request.params);
      const delivery = await service.resolve(parsed.assetKey);
      const headers = ApprovedAssetDeliveryHeadersSchema.parse(delivery.headers);
      for (const [name, value] of Object.entries(headers)) reply.header(name, value);
      return reply.status(200).send(delivery.bytes);
    } catch (error) {
      const normalized = normalizeAssetImportError(error);
      return reply.status(normalized.statusCode).send(assetImportErrorEnvelope(normalized, request.id));
    }
  });
}
