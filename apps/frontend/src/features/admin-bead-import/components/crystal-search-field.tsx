"use client";

import * as React from "react";

import type { CrystalSearchResult } from "@mystcrag/design-contract";

import { createCrystalSearch, type CrystalSearchClient } from "../crystal-search";
import { CrystalSearch, type CrystalSearchStatus } from "./crystal-search";

/**
 * The interactive existing-Crystal search field: local query state, a collapsed
 * debounce, and results from the dedicated admin search client. Selecting a
 * result hands the whole record to the parent — the field itself never decides
 * what the selection means.
 */
export function CrystalSearchField({
  client,
  onSelect,
  disabled = false
}: {
  client: CrystalSearchClient;
  onSelect: (result: CrystalSearchResult) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<readonly CrystalSearchResult[]>([]);
  const [status, setStatus] = React.useState<CrystalSearchStatus>("IDLE");

  React.useEffect(() => {
    if (disabled) {
      return;
    }
    const search = createCrystalSearch({
      client,
      // The field owns its debounce; the loader runs immediately inside it.
      runDelayed: (handler) => {
        window.setTimeout(handler, 0);
      }
    });
    let alive = true;
    const handle = window.setTimeout(() => {
      if (query.trim() === "") {
        if (alive) {
          setResults([]);
          setStatus("IDLE");
        }
        return;
      }
      if (alive) {
        setStatus("LOADING");
      }
      void search.query(query).then((found) => {
        if (!alive) {
          return;
        }
        setResults(found);
        setStatus("READY");
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [client, query, disabled]);

  if (disabled) {
    return null;
  }

  return (
    <CrystalSearch
      query={query}
      status={status}
      results={results}
      onQueryChange={setQuery}
      onSelect={onSelect}
    />
  );
}
