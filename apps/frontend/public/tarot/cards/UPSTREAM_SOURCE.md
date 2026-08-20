# Tarot card asset provenance

- Source snapshot: `prototypes/tarot-upstream/public/cards` in the project owner's read-only checkout.
- Upstream repository: `renanbotasse/tarot`, recorded source commit `e4d3a20265dd8a8b7e14e9ec980685fe20a79040`.
- Authorization: the project owner stated that authorization from the upstream author has been obtained for this integration.
- Imported scope: exactly 78 Rider–Waite face PNGs and `CardBack.png`; no upstream application code, navigation, styles, state store, or runtime dependency is imported here.
- Integrity check recorded on 2026-08-20: source count `79`, destination count `79`, zero basename/hash differences. The SHA-256 of the sorted `<file hash><two spaces><basename>` manifest is `84bb0f793a9d696e0a578822dfc2fdc757cd7d1e52d47517cead237783e8307c`.
- Public-release gate: before any public or commercial release, archive the written authorization and independently confirm rights for the card back, fonts, and every third-party visual. Local integration is allowed; this file is not a substitute for release evidence.

The source README identifies the 78 Rider–Waite face illustrations as public domain and the upstream code as MIT. The custom card back remains covered by the explicit release-rights gate above.
