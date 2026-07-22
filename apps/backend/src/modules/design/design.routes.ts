import {
  CreateOrderFromDesignRequestSchema,
  CreateOrderFromDesignResponseSchema,
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
  handleDesignPost
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
}

export type { DesignApiService } from "./design-api.service.js";
