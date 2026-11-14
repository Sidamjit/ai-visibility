'use client';
/**
 * Filterable findings table for the IT dashboard. Receives serializable
 * findings from the server; filtering is client-side (a run has ~hundreds).
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CATEGORY_LABEL, SEVERITY_STYLE } from '@/lib/format';

export interface FindingRow {
  id: string;
  ruleId: string;
  severity: string;
  category: string;
  kind: string;
  title: string;
  summary: string;
  siteExternalId: string | null;
  departmentName: string | null;
  affectedCount: number;
  fix: string | null;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export function FindingsTable({ rows }: { rows: FindingRow[] }) {
  const [severity, setSeverity] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category))).sort(), [rows]);
  const filtered = rows.filter(
    (r) =>
      (severity === 'all' || r.severity === severity) &&
      (category === 'all' || r.category === category) &&
      (query === '' ||
        `${r.title} ${r.summary} ${r.ruleId} ${r.departmentName ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <select
          aria-label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="all">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c] ?? c}
            </option>
          ))}
        </select>
        <input
          aria-label="Search findings"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-48 flex-1 rounded-md border border-slate-300 px-2 py-1"
        />
        <span className="self-center text-slate-500">
          {filtered.length} of {rows.length}
        </span>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3">Rule</th>
              <th className="py-2 pr-3">Finding</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Fix</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${SEVERITY_STYLE[r.severity]}`}
                  >
                    {r.severity}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-slate-500">
                  {r.ruleId}
                </td>
                <td className="py-2 pr-3">
                  {r.siteExternalId ? (
                    <Link
                      className="font-medium text-slate-900 hover:underline"
                      href={`/it/sites/${encodeURIComponent(r.siteExternalId)}`}
                    >
                      {r.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-900">{r.title}</span>
                  )}
                  <div className="text-xs text-slate-500">{r.summary}</div>
                </td>
                <td className="py-2 pr-3 text-xs">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                <td className="py-2 pr-3 text-xs text-slate-600">{r.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
