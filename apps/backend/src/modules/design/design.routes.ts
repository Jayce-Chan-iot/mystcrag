import {
  CloneDesignRequestSchema,
  CloneDesignResponseSchema,
  CreateOrderFromDesignRequestSchema,
  CreateOrderFromDesignResponseSchema,
  DeleteDesignRequestSchema,
  DeleteDesignResponseSchema,
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema,
  PriceDesignRequestSchema,
  PriceDesignResponseSchema,
  PublishDesignRequestSchema,
  PublishDesignResponseSchema,
  SaveDesignRequestSchema,
  SaveDesignResponseSchema,
  UpdateDesignRequestSchema,
  UpdateDesignResponseSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance } from "fastify";

import {
  createAuthenticationPreHandler,
  type AuthProvider
} from "../../auth/auth-provider.js";
import {
  handleDesignGet,
  handleCatalogMaterialsGet,
  handleDesignPost,
  handleMyDesignsGet,
  handleMyOrdersGet
} from "./design.controller.js";
import type { DesignApiService } from "./design-api.service.js";

export function registerDesignContractRoutes(
  app: FastifyInstance,
  service: DesignApiService,
  authProvider: AuthProvider
) {
  const authenticate = createAuthenticationPreHandler(authProvider);
  const protectedRoute = { preHandler: authenticate };

  app.post("/api/design/generate", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      GenerateDesignRequestSchema,
      GenerateDesignResponseSchema,
      (api, actorId, input) => api.generate(actorId, input),
      service
    )
  );
  app.post("/api/design/update", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      UpdateDesignRequestSchema,
      UpdateDesignResponseSchema,
      (api, actorId, input) => api.update(actorId, input),
      service,
      { ownerScoped: true }
    )
  );
  app.post("/api/design/price", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      PriceDesignRequestSchema,
      PriceDesignResponseSchema,
      (api, actorId, input) => api.price(actorId, input),
      service
    )
  );
  app.post("/api/design/save", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      SaveDesignRequestSchema,
      SaveDesignResponseSchema,
      (api, actorId, input) => api.save(actorId, input),
      service,
      { ignoreOwnerId: true, ownerScoped: true }
    )
  );
  app.post("/api/design/delete", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      DeleteDesignRequestSchema,
      DeleteDesignResponseSchema,
      (api, actorId, input) => api.delete(actorId, input),
      service,
      { ownerScoped: true }
    )
  );
  app.post("/api/design/clone", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      CloneDesignRequestSchema,
      CloneDesignResponseSchema,
      (api, actorId, input) => api.cloneDesign(actorId, input),
      service,
      { ownerScoped: true }
    )
  );
  app.post("/api/design/publish", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      PublishDesignRequestSchema,
      PublishDesignResponseSchema,
      (api, actorId, input) => api.publish(actorId, input),
      service,
      { ownerScoped: true }
    )
  );
  app.post("/api/orders/from-design", protectedRoute, (request, reply) =>
    handleDesignPost(
      request,
      reply,
      CreateOrderFromDesignRequestSchema,
      CreateOrderFromDesignResponseSchema,
      (api, actorId, input) => api.createOrder(actorId, input),
      service,
      { ownerScoped: true }
    )
  );
  app.get<{ Params: { id: string } }>(
    "/api/design/:id",
    protectedRoute,
    (request, reply) => handleDesignGet(request, reply, service, false)
  );
  app.get<{ Params: { id: string } }>(
    "/api/design/:id/revisions",
    protectedRoute,
    (request, reply) => handleDesignGet(request, reply, service, true)
  );
  app.get<{ Querystring: { currency?: string } }>(
    "/api/catalog/materials",
    protectedRoute,
    (request, reply) => handleCatalogMaterialsGet(request, reply, service)
  );
  app.get("/api/designs", protectedRoute, (request, reply) =>
    handleMyDesignsGet(request, reply, service)
  );
  app.get("/api/orders", protectedRoute, (request, reply) =>
    handleMyOrdersGet(request, reply, service)
  );
}

export type { DesignApiService } from "./design-api.service.js";
