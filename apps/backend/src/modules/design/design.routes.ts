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

import { handleStubRoute, type StubRouteContract } from "./design.controller.js";
import {
  NotImplementedDesignStubService,
  type DesignStubService
} from "./design.service.js";

export type { DesignStubService } from "./design.service.js";

const routeContracts = [
  {
    method: "POST",
    url: "/api/design/generate",
    contract: {
      operation: "GENERATE",
      requestSchema: GenerateDesignRequestSchema,
      responseSchema: GenerateDesignResponseSchema
    }
  },
  {
    method: "POST",
    url: "/api/design/update",
    contract: {
      operation: "UPDATE",
      requestSchema: UpdateDesignRequestSchema,
      responseSchema: UpdateDesignResponseSchema
    }
  },
  {
    method: "POST",
    url: "/api/design/price",
    contract: {
      operation: "PRICE",
      requestSchema: PriceDesignRequestSchema,
      responseSchema: PriceDesignResponseSchema
    }
  },
  {
    method: "POST",
    url: "/api/design/save",
    contract: {
      operation: "SAVE",
      requestSchema: SaveDesignRequestSchema,
      responseSchema: SaveDesignResponseSchema
    }
  },
  {
    method: "POST",
    url: "/api/design/publish",
    contract: {
      operation: "PUBLISH",
      requestSchema: PublishDesignRequestSchema,
      responseSchema: PublishDesignResponseSchema
    }
  },
  {
    method: "POST",
    url: "/api/orders/from-design",
    contract: {
      operation: "CREATE_ORDER",
      requestSchema: CreateOrderFromDesignRequestSchema,
      responseSchema: CreateOrderFromDesignResponseSchema
    }
  }
] as const satisfies ReadonlyArray<{
  method: "POST";
  url: string;
  contract: StubRouteContract;
}>;

export function registerDesignContractRoutes(
  app: FastifyInstance,
  service: DesignStubService = new NotImplementedDesignStubService()
) {
  for (const route of routeContracts) {
    app.route({
      method: route.method,
      url: route.url,
      handler: (request, reply) => handleStubRoute(request, reply, route.contract, service)
    });
  }
}
