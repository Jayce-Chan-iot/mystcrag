import {
  EvaluateDesignRequestSchema,
  EvaluateDesignResponseSchema,
  OptimizeDesignRequestSchema,
  OptimizeDesignResponseSchema,
  RecommendDesignRequestSchema,
  RecommendDesignResponseSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance } from "fastify";

import {
  createAuthenticationPreHandler,
  type AuthProvider
} from "../../auth/auth-provider.js";
import {
  handleDesignTraceGet,
  handleMaterialSuggestGet,
  handleRecommendationPost
} from "./recommendation.controller.js";
import type { RecommendationApiService } from "./recommendation.service.js";

export type { RecommendationApiService } from "./recommendation.service.js";

export function registerRecommendationRoutes(
  app: FastifyInstance,
  service: RecommendationApiService,
  authProvider: AuthProvider
) {
  const authenticate = createAuthenticationPreHandler(authProvider);
  const protectedRoute = { preHandler: authenticate };

  app.post("/api/design/recommend", protectedRoute, (request, reply) =>
    handleRecommendationPost(
      request,
      reply,
      RecommendDesignRequestSchema,
      RecommendDesignResponseSchema,
      (api, actorId, input) => api.recommend(actorId, input),
      service
    )
  );
  app.post("/api/design/evaluate", protectedRoute, (request, reply) =>
    handleRecommendationPost(
      request,
      reply,
      EvaluateDesignRequestSchema,
      EvaluateDesignResponseSchema,
      (api, actorId, input) => api.evaluate(actorId, input),
      service
    )
  );
  app.post("/api/design/optimize", protectedRoute, (request, reply) =>
    handleRecommendationPost(
      request,
      reply,
      OptimizeDesignRequestSchema,
      OptimizeDesignResponseSchema,
      (api, actorId, input) => api.optimize(actorId, input),
      service
    )
  );
  app.get<{ Params: { id: string } }>(
    "/api/design/:id/trace",
    protectedRoute,
    (request, reply) => handleDesignTraceGet(request, reply, service)
  );
  app.get<{ Params: { id: string }; Querystring: { currency?: string; locale?: string } }>(
    "/api/materials/:id/suggest",
    protectedRoute,
    (request, reply) => handleMaterialSuggestGet(request, reply, service)
  );
}
