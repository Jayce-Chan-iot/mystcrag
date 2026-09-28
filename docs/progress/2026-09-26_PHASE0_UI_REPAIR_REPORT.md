# Phase 0 UI Repair Report

Date: 2026-09-29  
Task: `TASK-QA-P0-001`  
Scope: high-priority usability repair before the "Xuangui Star Platform" redesign

## Outcome

Phase 0 closes the high-priority navigation, notice-action, desktop DIY,
responsive-density, mock-data, empty-state truthfulness, and accessibility
gaps registered as `TASK-FE-P0-001` through `TASK-FE-P0-007` plus the final QA
gate. It deliberately does not claim that the approved full-site Eastern
mysticism redesign or the fast three-coin Oracle flow is complete; those remain
the next dependency-ordered delivery phases.

## Repairs accepted

- Primary and mobile navigation use the capability rules consistently and do
  not advertise disabled Tarot entry points.
- Notices use caller-owned retry, navigation, or dismiss actions and do not
  imply that a failed operation succeeded.
- Desktop DIY uses one catalog collection, an independent inspector, and a
  sticky completion footer; mobile retains the same underlying editor state.
- Short-height layouts retain their primary content and actions without CSS
  zoom or application-scale transforms.
- Mock catalog rows satisfy the public schema. Mock Gallery/Profile collections
  return honest empty arrays without network calls or fabricated user data.
- Gallery/Profile empty states promise only the available AI and DIY paths.
- Visible controls on principal routes meet a 44x44 px target floor, critical
  leaf text meets a 12 px floor, focus remains visible, and reduced motion is
  respected.

## Browser evidence

The final Mock API matrix covers five viewports by seven routes, for 35 cases:

| Viewports | Routes | Result |
| --- | --- | --- |
| 390x844, 768x1024, 1024x768, 1440x560, 1440x900 | `/`, `/ai-design`, `/diy/rain-after-blue`, `/crystal-library`, `/gallery`, `/profile`, `/tarot` | 35/35 PASS |

Every case returned HTTP 200, had no horizontal overflow, had no visible
interactive target below 44x44 px, had no critical leaf text below 12 px, and
matched the mobile-navigation breakpoint. DIY exposed its completion control at
all five sizes. At 390x844, keyboard traversal reached "完成设计" on Tab 21,
showed a solid focus outline, and Enter produced the explicit validation path.

With Tarot disabled, Gallery/Profile contain no Tarot promise; direct `/tarot`
compatibility resolves to `/tarot/setup`. Gallery/Profile render ready empty
states rather than false network or validation errors. The DIY mock catalog
renders all four schema-valid products.

Canonical screenshots:

- `output/playwright/task-qa-p0-001/home-390x844.png`
- `output/playwright/task-qa-p0-001/questionnaire-768x1024.png`
- `output/playwright/task-qa-p0-001/diy-1024x768.png`
- `output/playwright/task-qa-p0-001/diy-1440x560.png`
- `output/playwright/task-qa-p0-001/profile-1440x900.png`

## Boundary and next phase

No Backend, database, Auth, pricing, inventory, order, Bracelet Engine, or API
contract behavior changed in this gate. Phase 0 establishes a usable baseline;
the next supervised sequence is Oracle contract and engine work, Oracle
frontend/backend integration, the full "Xuangui Star Platform" visual redesign,
and finally the cross-page visual and interaction gate.
