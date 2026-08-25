import type { ExternalIdentityMappingPort } from "./authenticated-actor-provider.js";

export type RecordedIdentityMappingCall = {
  readonly issuer: string;
  readonly subject: string;
};

/**
 * Deterministic in-memory stand-in for the AUTH-003 ExternalIdentityRepository.
 * Keys identities by (issuer, subject) and never lets a provider subject leak
 * out as the internal actor id: unmapped identities get a generated internal id.
 */
export class InMemoryExternalIdentityMapping implements ExternalIdentityMappingPort {
  readonly #actors = new Map<string, string>();
  readonly calls: RecordedIdentityMappingCall[] = [];

  constructor(entries: ReadonlyArray<readonly [issuer: string, subject: string, actorId: string]> = []) {
    for (const [issuer, subject, actorId] of entries) {
      this.#actors.set(`${issuer}\n${subject}`, actorId);
    }
  }

  findOrProvisionExternalIdentity(input: {
    readonly issuer: string;
    readonly subject: string;
  }): Promise<{ readonly actorId: string }> {
    this.calls.push({ issuer: input.issuer, subject: input.subject });
    const key = `${input.issuer}\n${input.subject}`;
    let actorId = this.#actors.get(key);
    if (actorId === undefined) {
      actorId = `user-internal-${this.#actors.size + 1}`;
      this.#actors.set(key, actorId);
    }
    return Promise.resolve({ actorId });
  }
}
