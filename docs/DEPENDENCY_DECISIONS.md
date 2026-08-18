# Dependency Decisions

No new registry runtime dependency was added in Phase 0–1. `@mystcrag/bracelet-engine` is a local workspace package using existing TypeScript/tsx tooling.

The circle interaction remains on Pointer Events because dnd-kit would still require a custom physical-slot solver and circular collision layer. Zustand/zundo, TanStack Query, Motion, Radix, and Vaul remain reviewed candidates and will be installed only if their vertical slice replaces meaningful infrastructure.
