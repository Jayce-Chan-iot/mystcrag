# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

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
