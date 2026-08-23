"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type CoverageChartData = {
  domain: string;
  current: number;
  target: number;
}[];

/**
 * Console V1 chart scope (task book): coverage comparison only — current vs
 * target per knowledge domain, rendered with Recharts. Kept as the single
 * client-side chart surface; everything else stays server-rendered tables.
 */
export function CoverageChart({ data }: { data: CoverageChartData }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 64 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="domain"
            angle={-35}
            textAnchor="end"
            interval={0}
            height={72}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="current" name="当前" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="target" name="目标" fill="var(--border)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type YieldChartData = {
  name: string;
  yield: number;
  documents: number;
}[];

export function SourceYieldChart({ data }: { data: YieldChartData }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 56 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="name"
            angle={-30}
            textAnchor="end"
            interval={0}
            height={64}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12
            }}
          />
          <Bar dataKey="yield" name="产出率（有效候选/文档）" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type RunsTrendChartData = {
  run: string;
  documents: number;
  candidates: number;
  needsReview: number;
}[];

export function RunsTrendChart({ data }: { data: RunsTrendChartData }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="run" tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 12
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="documents" name="新增文档" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="candidates" name="新增候选" fill="var(--accent-soft)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="needsReview" name="待审核" fill="var(--warning)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
