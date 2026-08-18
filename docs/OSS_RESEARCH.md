# OSS Research — Bracelet Engine V2

Reviewed on 2026-08-18 from repository metadata, licenses, manifests, and relevant source/documentation.

| Project | License | Decision |
| --- | --- | --- |
| clauderic/dnd-kit | MIT | Do not add now. Sensors are mature, but circular physical-slot collision still requires the engine; existing Pointer Events remain smaller. |
| pmndrs/zustand | MIT | Candidate for editor working draft; defer until its state boundary is extracted. |
| charkour/zundo | MIT | Candidate with Zustand for bounded temporal history. |
| TanStack/query | MIT | Suitable for later server-cache extraction; unnecessary for removing one redundant request. |
| Motion | MIT | Candidate for transform/opacity motion with reduced-motion support. |
| Radix Primitives | MIT | Adopt by component when accessible overlay primitives are required. |
| Vaul | MIT | Mobile sheet candidate; verify final React 19 behavior in the UI slice. |
| Microsoft Playwright | Apache-2.0 | Adopt for E2E and visual regression. |
| Deque axe-core | MPL-2.0 | Adopt as test tooling only. |
| rndaorg/open-configurator | MIT | State/pricing separation reference; no source copied. |
| gorhorvat/product-configurator-3d | no detected license | Ideas only; no reusable source. |
| jerryzhao173985/Vercel-crystal-bracelet | no detected license | Product-flow reference only; no code/assets copied. |
| SergiiSharpov/Jewelry-3D-configurator | GPL-3.0 | Architecture study only; GPL source is not copied. |

The first slice therefore uses a dependency-free pure TypeScript geometry core.
