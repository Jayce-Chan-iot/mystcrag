import type {
  CrystalSearchResult,
  ListCrystalsQuery,
  ListCrystalsResponse
} from "@mystcrag/design-contract";

/**
 * The operator side of existing-Crystal resolution. Queries are collapsed so a
 * burst of keystrokes fires one request for the newest value only, and a query
 * shorter than the contract minimum never leaves the browser. The endpoint is
 * the dedicated admin Crystal search: it returns names and ids only, never a
 * storage key, and it is the only way this console may resolve an existing
 * Crystal — nothing here infers identity from an image or a folder name.
 */

export type CrystalSearchClient = {
  listCrystals(
    query: ListCrystalsQuery,
    requestOptions?: { signal?: AbortSignal }
  ): Promise<ListCrystalsResponse>;
};

export type CrystalSearchController = {
  query(raw: string): Promise<CrystalSearchResult[]>;
};

export const CRYSTAL_SEARCH_MINIMUM_CHARS = 1;

export function createCrystalSearch(deps: {
  client: CrystalSearchClient;
  /** Injectable delay runner so tests can collapse bursts deterministically. */
  runDelayed: (handler: () => void) => void;
  minimumChars?: number;
}): CrystalSearchController {
  const minimumChars = deps.minimumChars ?? CRYSTAL_SEARCH_MINIMUM_CHARS;
  let latestQueryId = 0;

  return {
    query(raw: string): Promise<CrystalSearchResult[]> {
      const id = (latestQueryId += 1);
      const trimmed = raw.trim();
      if (trimmed.length < minimumChars) {
        return Promise.resolve([]);
      }
      return new Promise((resolve) => {
        deps.runDelayed(() => {
          if (id !== latestQueryId) {
            resolve([]);
            return;
          }
          void deps.client
            .listCrystals({ q: trimmed })
            .then((page) => resolve(id === latestQueryId ? page.crystals : []))
            .catch(() => resolve(id === latestQueryId ? [] : []));
        });
      });
    }
  };
}
