import * as React from "react";

import type { CrystalSearchResult } from "@mystcrag/design-contract";

import { FIELD_CLASS, HINT_CLASS, SECONDARY_BUTTON_CLASS, SUBCARD_CLASS } from "./control-styles";

/**
 * Presentational existing-Crystal search. The state comes from a loader, the
 * selection goes to the parent as a whole result, and an internal id is never
 * the visible label: an operator selects a crystal by its names, not by an id
 * they cannot verify.
 */

export type CrystalSearchStatus = "IDLE" | "LOADING" | "READY";

export type CrystalSearchProps = {
  query: string;
  status: CrystalSearchStatus;
  results: readonly CrystalSearchResult[];
  onQueryChange: (query: string) => void;
  onSelect: (result: CrystalSearchResult) => void;
};

export function CrystalSearch({
  query,
  status,
  results,
  onQueryChange,
  onSelect
}: CrystalSearchProps) {
  return (
    <div className={`${SUBCARD_CLASS} gap-2`}>
      <p className="min-w-0 text-sm font-medium">关联已有水晶（可选）</p>
      <p className={HINT_CLASS}>
        搜索平台已有的水晶资料并选择；选中后会保存该分组的珠子名称，由服务端解析为唯一的水晶引用。
      </p>
      <input
        id="bead-import-crystal-search"
        type="text"
        value={query}
        placeholder="输入中文名、英文名或矿物名称搜索"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        className={FIELD_CLASS}
      />
      {status === "LOADING" && (
        <p role="status" className="min-w-0 text-xs text-[var(--muted)]">
          正在搜索…
        </p>
      )}
      {status === "READY" && results.length === 0 && query.trim() !== "" && (
        <p role="status" className="min-w-0 text-xs text-[var(--muted)]">
          没有匹配的已有水晶，可以直接使用下方人工填写的资料。
        </p>
      )}
      {results.length > 0 && (
        <ul aria-label="已有水晶搜索结果" className="flex min-w-0 flex-col gap-1">
          {results.map((result) => (
            <li
              key={result.crystalId}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2"
            >
              <span className="min-w-0 break-all text-sm">
                {result.nameCn}
                {result.nameEn !== null ? ` · ${result.nameEn}` : ""}
                {result.mineralName !== null ? ` · ${result.mineralName}` : ""}
              </span>
              <button
                type="button"
                onClick={() => onSelect(result)}
                className={`${SECONDARY_BUTTON_CLASS} shrink-0`}
              >
                选择
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="min-w-0 text-xs text-[var(--muted)]">
        未选择时，水晶资料由下方八项人工填写内容提升而来。
      </span>
    </div>
  );
}
