# Current Product Status

**Observed:** 2026-08-24 at local `main` `1a34c16`<br>
**Product posture:** demonstrable 2.5D MVP core; not commercially production-ready<br>
**Repository baseline:** `NOT READY`

Completion is based on mounted production paths, source and contract reachability, automated checks and current browser evidence. A compiled or tested dormant component is not counted as a completed product Feature.

## Completion matrix

| Feature | Status | Completion | Quality | Production Ready | Main problem |
| --- | --- | ---: | --- | --- | --- |
| Atelier home and navigation | ACTIVE | 95% | High | Yes, within MVP | No product analytics; current browser smoke only covers entry/navigation. |
| AI questionnaire and three recommendations | ACTIVE | 85% | Medium-high | Conditional | Production path is deterministic and functional; generate/recommend API roles are conflated in registry/docs and orchestration is large. |
| Design result and compact preview | ACTIVE | 90% | High | Conditional | Depends on development-grade identity for protected data. |
| 2D DIY editor | ACTIVE | 85% | Medium-high | Conditional | Full-server edit round trips, manual save/session recovery, 1,275-line component and export/visible asset divergence. |
| Save, revisions, clone and delete | ACTIVE | 90% | High | Conditional | Persistence and owner isolation are tested, but production authentication is absent. |
| Pricing and inventory validation | ACTIVE | 85% | High | Conditional | Core checks pass; catalog seed documentation is contradictory. |
| Immutable order creation/history | ACTIVE | 65% | High for implemented scope | No for commerce | Produces an internal snapshot only; no address, shipping, tax, payment or fulfillment workflow. |
| Crystal library/catalog | ACTIVE | 80% | Medium-high | Conditional | Runtime catalog exists; source/seed counts and some operational docs disagree. |
| Personal design gallery | ACTIVE | 75% | Medium-high | Conditional | Lists the actor's own designs; it is not public community discovery. |
| Community publish/discovery | PARTIAL | 25% | Medium | No | Backend publish/unpublish boundary exists; no frontend action, public feed/listing, share or moderation flow. |
| Profile/account | PARTIAL | 45% | Medium | No | Design/order history is server-backed, but identity, addresses, favorites, feedback and privacy preferences are browser-local. |
| Authentication and session | PARTIAL | 30% | High for test boundary | No | Backend is fail-closed and actor-scoped, but only signed development/test tokens exist; frontend uses a public fixed-token variable. |
| Tarot-guided design | ACTIVE | 80% | High | Conditional | Lifecycle and privacy behavior are tested; shared public enum authority is duplicated. |
| Knowledge admin/ingestion | ACTIVE | 80% | High | Conditional | Strong pipeline/admin boundary; deployment credentials, retention and current operations remain environment-specific. |
| Decision trace/telemetry | PARTIAL | 45% | Medium-high | No | Knowledge usage events are write-oriented operational telemetry, not a product analytics system. |
| 3D bracelet presentation | EXPERIMENTAL | 55% | Medium | No, not required for MVP | Renderer and tests exist but no production route, WebGL fallback/performance gate or responsive E2E. |
| White label / multitenancy | PLANNED | 5% | N/A | No | No tenant, brand, theme, isolation or configuration model. |

## Product-loop assessment

The current loop is real through:

```text
Home -> questionnaire or direct DIY -> 2D edit -> save revision -> immutable order snapshot
```

It stops before a commercial loop:

```text
production login -> durable account/profile -> address/shipping -> payment -> fulfillment -> post-order lifecycle
```

3D is deliberately outside the MVP release requirement. Its absence from the production DIY route is a lifecycle/positioning decision, not a P0 product defect.

## Five current bottlenecks

1. **Production identity/session:** all owner-isolated product data depends on an actor, but there is no real user login, callback, refresh, revocation or durable account provisioning.
2. **Commercial checkout:** order creation stops at a `PENDING`/restock-aware immutable snapshot without payment, address, shipping, tax or fulfillment.
3. **DIY resilience and concentration:** the editor is a large component with synchronous server mutations, manual persistence and weak interrupted-session recovery.
4. **No current authenticated browser release gate:** unit/build/PostgreSQL coverage is strong, but the full customer loop is not replayed in CI.
5. **Community promise exceeds implementation:** personal design management and a backend publish method exist, while discovery/feed/share/moderation do not.

## Current and next phase boundary

- Current Phase: governance integration, shared-contract authority fixes and a frozen replay-validated baseline.
- Next Phase: implement exactly one major Feature—FEAT-018 Production Identity & Session.
- Not in the next Phase: payment, public community, 3D promotion, multitenancy, broad refactors or half-year roadmap work.
