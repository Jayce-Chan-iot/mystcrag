# @mystcrag/design-contract

Runtime-validated, versioned contracts for Mystcrag bracelet designs. Zod schemas are the source of TypeScript types; handwritten duplicate interfaces are not part of this package.

## Responsibilities

- Validate `DesignV1` metadata, bracelet geometry, ordered components, story, pricing, production, compliance, provenance, and community controls.
- Validate six API request/response pairs without implementing HTTP routes.
- Produce public-safe projections and immutable order snapshots.
- Keep commercial costs in a server-only schema.
- Validate current V1 input and create review-required candidates from the `legacy-initial` fixture shape.

The package is framework-independent. It does not depend on React, Next.js, Three.js, Prisma, Fastify, or an LLM provider SDK.

## Exports

The main `@mystcrag/design-contract` export includes:

- `DesignV1Schema`, `PublicDesignV1Schema`, and their inferred types.
- Component, pricing, production, compliance, provenance, and community schemas.
- Generate, Update, Price, Save, Publish, and CreateOrder request/response schemas.
- `OrderDesignSnapshotV1Schema`, `toPublicDesign()`, and `toOrderSnapshot()`.
- `LegacyInitialDesignSchema` and `migrateDesignToV1()`.
- Version, currency, minor-unit, and disclaimer constants.

Fixtures are available from `@mystcrag/design-contract/fixtures`.

The server-only `InternalCommercialDesignV1Schema` is intentionally isolated at `@mystcrag/design-contract/internal`. Frontend and community code must not import this subpath.

## Trust boundaries

Parse all network, provider, persistence, and migration input as `unknown` before it enters domain logic:

```ts
import { DesignV1Schema } from "@mystcrag/design-contract";

const result = DesignV1Schema.safeParse(untrustedInput);
if (!result.success) {
  // Translate result.error into the owning application's error contract.
}

const design = result.data;
```

Never return the commercial envelope directly. Derive a clean public object:

```ts
import { toPublicDesign } from "@mystcrag/design-contract";
import { InternalCommercialDesignV1Schema } from "@mystcrag/design-contract/internal";

const commercialDesign = InternalCommercialDesignV1Schema.parse(serverOnlyInput);
const publicDesign = toPublicDesign(commercialDesign);
```

## Version rules

- `DesignV1.schemaVersion` is the literal SemVer value `1.0.0`.
- Unknown versions are rejected. They are never parsed as the current contract.
- Backward-compatible optional additions may use a minor version. Semantic changes, removals, and changed invariants require a major version and an explicit migration.
- `migrateDesignToV1()` does not mutate input. Current V1 input returns `MIGRATED`; grouped legacy input returns `REQUIRES_REVIEW` with information-loss warnings.
- There is no production-data backfill in Phase 2A.

## Money rules

- Every monetary value is a safe integer in minor units.
- CNY uses 100 minor units per yuan. TWD uses 1 minor unit per dollar.
- CNY and TWD use independent price tables and pricing versions. This package performs no exchange-rate conversion.
- Component subtotals must equal component price sums. The total must equal fees and subtotals, minus discount, plus explicit signed adjustments.
- `DesignV1` never contains `unitCostMinor`, supplier references, or another cost field.

## Prohibited usage

- Do not treat Prisma models, Three.js scene descriptors, provider JSON, or UI state as the design contract.
- Do not use arbitrary JSON Patch for updates; use the finite update-operation union.
- Do not persist hidden reasoning or private user conversations in provenance or story fields.
- Do not publish without explicit consent or create publication/order snapshots for rejected designs.
- Do not automatically apply production substitutions. Rules only describe candidates and confirmation requirements.
- Do not import the internal commercial subpath from browser, frontend, community, or public API code.
