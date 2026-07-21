# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

Phase 2B registers development-level HTTP boundaries for all six design operations. Every request is parsed with its shared request schema and every successful service value is parsed with its shared response schema. Business orchestration remains a stub, so a valid request currently returns the stable `NOT_IMPLEMENTED` domain error instead of fabricated product data.

Errors use `{ error: { code, message, fieldErrors?, requestId } }`. Supported stable codes are `VALIDATION_ERROR`, `NOT_IMPLEMENTED`, `NOT_FOUND`, `CONFLICT`, `COMPLIANCE_BLOCKED`, `CONSENT_REQUIRED`, `INVENTORY_CHANGED`, `PRICE_CHANGED`, and `INTERNAL_ERROR`. Publish rejects public or unlisted requests without consent; order creation rejects a `REJECTED` design before service execution.

## Service endpoints

GET /health

Return backend process readiness. This endpoint does not imply database or external provider readiness.

GET /api/modules

Return registered backend module metadata for initialization diagnostics. This is not a public product API and may be removed after module routing is implemented.

## User API

POST /api/users

Create user profile.

## AI Design API

POST /api/design/generate

Uses `GenerateDesignRequestSchema` and `GenerateDesignResponseSchema`. It never returns an independent `threeConfig` copy.

POST /api/design/update

Uses `UpdateDesignRequestSchema` and `UpdateDesignResponseSchema`.

POST /api/design/price

Uses `PriceDesignRequestSchema` and `PriceDesignResponseSchema`. The mapper retains product IDs and currency as pricing intent but discards all client-supplied unit and total prices before orchestration.

## Design Save API

POST /api/design/save

Uses `SaveDesignRequestSchema` and `SaveDesignResponseSchema`.

## Community API

GET /api/community/designs

Return popular designs.

POST /api/design/publish

Uses `PublishDesignRequestSchema` and `PublishDesignResponseSchema`, with a consent guard before service execution.

## Order API

POST /api/orders/from-design

Uses `CreateOrderFromDesignRequestSchema` and `CreateOrderFromDesignResponseSchema`, with a compliance guard before service execution.

## Initialization status

`/health`, `/api/modules`, and the six validated design/order stub routes are registered. Authentication, ownership checks, catalog/inventory validation, persistence, live pricing, and successful product operations remain unimplemented.
