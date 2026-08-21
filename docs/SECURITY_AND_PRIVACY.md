# Security And Privacy

## Principles

Protect user data.

## Requirements

-   Encrypt sensitive data
-   Do not store unnecessary personal information
-   Separate user identity and design preference data
-   Validate all API input

## AI Privacy

User conversations should not be exposed publicly.

Community sharing requires user permission.

## Persistence controls

- Every repository write requires an explicit `actorId`; current test identity injection is not a substitute for authentication.
- Owner identity is never accepted from request JSON. Repository ownership filters and optimistic revision checks are applied together.
- `unitCostMinor`, supplier data, and internal margins remain server-only. Community projections clear production notes and never expose costs.
- Design Contract JSON is validated before storage and after retrieval. Raw Prisma JSON and database errors do not cross repository boundaries.
- Revisions and order snapshots are immutable at both repository and PostgreSQL-trigger layers. Orders cannot be physically deleted.
- Logs must record identifiers, versions, and structured error codes, not full design/order snapshots. Birth dates, birth times, private conversations, hidden reasoning, and unnecessary personalization data do not belong in snapshots.
- Tarot questions remain in memory only by default and are never copied into logs, public DTOs, provider metadata, or recommendation provenance. Explicit opt-in storage requires a valid 32-byte base64 environment key. A domain-separated HMAC key-derivation step produces distinct AES-256-GCM encryption and HMAC-SHA-256 identity subkeys from that master. The strict v2 envelope contains only its fixed version/algorithm identifiers, keyed question identity, fresh random 96-bit nonce, 128-bit authentication tag, and non-empty ciphertext; version, algorithm, and question identity are authenticated as AES-GCM associated data. Identity matching first parses canonical base64url fields and exact lengths, rejects unknown fields and legacy versions, authenticates and internally decrypts the ciphertext, then constant-time compares the stored identity with identities recomputed from both authenticated plaintext and the requested question. It exposes no decrypt API, plaintext, or public unsalted hash. Concurrent same-question retries retain the first authenticated envelope; different-question retries conflict, and question storage cannot be added after an immutable no-save recommendation. Missing or invalid encryption configuration, malformed or swapped envelopes, and wrong keys fail closed; plaintext and reversible ad-hoc encodings are forbidden.
