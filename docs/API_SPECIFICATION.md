# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

Phase 2A defines DTOs only. Backend routes, authorization, catalog pricing, inventory checks, persistence, and error-to-HTTP mapping remain unimplemented. Existing placeholder examples below are not the V1 wire contract and must not be copied into new code.

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

Input:

{ emotion:"", style:"", color:"", budget:"" }

Output:

{ design_name:"", story:"", crystals:\[\], style:"", price:"",
three_config:{} }

The snake_case example above is retained only to describe the initialization placeholder. The approved future route must validate `GenerateDesignRequestSchema` and return `GenerateDesignResponseSchema`; it must not return an independent `three_config` copy of the design.

## Design Save API

POST /api/design/save

Save user created design.

## Community API

GET /api/community/designs

Return popular designs.

POST /api/community/publish

Publish user design.

## Order API

POST /api/orders

Create production order.

## Initialization status

Only `/health` and `/api/modules` are implemented in the project scaffold. All product endpoints above remain contractual placeholders and require validation, authorization, service, and persistence layers before implementation.
