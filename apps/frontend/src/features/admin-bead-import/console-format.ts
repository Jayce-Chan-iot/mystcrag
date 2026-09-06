/**
 * Operator-facing formatting for the bead import console. Timestamps are pinned
 * to one zone so the same task reads identically for every operator and in every
 * test run, and no formatter ever emits a storage key, a file path or a secret.
 */

const CONSOLE_TIME_ZONE = "Asia/Shanghai";

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: CONSOLE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const parts = TIMESTAMP_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatByteSize(bytes: number): string {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${trimZero(rounded)} ${BYTE_UNITS[unit]}`;
}

export function formatPercent(ratio: number): string {
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return `${trimZero(Math.round(clamped * 1000) / 10)}%`;
}

function trimZero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
