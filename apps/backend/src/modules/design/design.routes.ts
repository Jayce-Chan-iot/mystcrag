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
  actorIdFromRequestContext,
  handleDesignGet,
  handleDesignPost,
  type ActorResolver
} from "./design.controller.js";
import type { DesignApiService } from "./design-api.service.js";

export function registerDesignContractRoutes(
  app: FastifyInstance,
  service: DesignApiService,
  actorResolver: ActorResolver = actorIdFromRequestContext
) {
  app.post("/api/design/generate", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      GenerateDesignRequestSchema,
      GenerateDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.generate(actorId, input),
      service
    )
  );
  app.post("/api/design/update", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      UpdateDesignRequestSchema,
      UpdateDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.update(actorId, input),
      service
    )
  );
  app.post("/api/design/price", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      PriceDesignRequestSchema,
      PriceDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.price(actorId, input),
      service
    )
  );
  app.post("/api/design/save", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      SaveDesignRequestSchema,
      SaveDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.save(actorId, input),
      service,
      { ignoreOwnerId: true }
    )
  );
  app.post("/api/design/publish", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      PublishDesignRequestSchema,
      PublishDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.publish(actorId, input),
      service
    )
  );
  app.post("/api/orders/from-design", (request, reply) =>
    handleDesignPost(
      request,
      reply,
      CreateOrderFromDesignRequestSchema,
      CreateOrderFromDesignResponseSchema,
      actorResolver,
      (api, actorId, input) => api.createOrder(actorId, input),
      service
    )
  );
  app.get<{ Params: { id: string } }>("/api/design/:id", (request, reply) =>
    handleDesignGet(request, reply, actorResolver, service, false)
  );
  app.get<{ Params: { id: string } }>(
    "/api/design/:id/revisions",
    (request, reply) => handleDesignGet(request, reply, actorResolver, service, true)
  );
}

export type { DesignApiService } from "./design-api.service.js";
