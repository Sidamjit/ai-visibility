'use client';
/**
 * Classified files table for the "Content & policy breaches" view.
 * Rows are content-free: classification, detector counts, exposure and the
 * policy breaches. Snippets (if the client enabled them) are already redacted.
 */
import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { BREACH_LABEL, date } from '@/lib/format';

export interface ContentFileRow {
  id: string;
  name: string;
  webUrl: string | null;
  siteExternalId: string | null;
  siteName: string | null;
  levelId: string;
  levelName: string;
  levelRank: number;
  levelColor: string | null;
  source: string;
  classifiers: Array<{ name: string; count: number; distinctValues: number }>;
  label: string | null;
  access: string;
  lastModifiedAt: string | null;
  breaches: Array<{ type: string; message: string }>;
  snippets: string[];
}

export function ContentFilesTable({
  rows,
  levels,
}: {
  rows: ContentFileRow[];
  levels: Array<{ id: string; name: string }>;
}) {
  const [level, setLevel] = useState('all');
  const [breach, setBreach] = useState('breaching');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const types = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.breaches.map((b) => b.type)))).sort(),
    [rows],
  );
  const filtered = rows.filter(
    (r) =>
      (level === 'all' || r.levelId === level) &&
      (breach === 'all' ||
        (breach === 'breaching'
          ? r.breaches.length > 0
          : r.breaches.some((b) => b.type === breach))) &&
      (query === '' ||
        `${r.name} ${r.siteName ?? ''} ${r.classifiers.map((c) => c.name).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <select
          aria-label="Classification"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="all">All classifications</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Breach"
          value={breach}
          onChange={(e) => setBreach(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1"
        >
          <option value="breaching">Breaching policy</option>
          <option value="all">All classified files</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {BREACH_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <input
          aria-label="Search"
          placeholder="Search file, site or detector…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-56 flex-1 rounded-md border border-slate-300 px-2 py-1"
        />
        <span className="self-center text-xs text-slate-500">
          {filtered.length} of {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">File</th>
              <th className="py-2 pr-3">Classification</th>
              <th className="py-2 pr-3">Detected</th>
              <th className="py-2 pr-3">Label</th>
              <th className="py-2 pr-3">Who has access</th>
              <th className="py-2 pr-3">Breaches</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr
                  className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50"
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.siteExternalId ? (
                        <Link
                          className="hover:underline"
                          href={`/it/sites/${encodeURIComponent(r.siteExternalId)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.siteName ?? r.siteExternalId}
                        </Link>
                      ) : (
                        '—'
                      )}
                      {' · modified '}
                      {date(r.lastModifiedAt)}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ background: r.levelColor ?? '#475569' }}
                    >
                      {r.levelName}
                    </span>
                    {r.source === 'llm' ? (
                      <div className="mt-0.5 text-[10px] text-slate-500">raised by LLM</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-700">
                    {r.classifiers.map((c) => (
                      <div key={c.name}>
                        {c.name} <span className="text-slate-500">×{c.count}</span>
                      </div>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {r.label ?? <span className="text-red-600">none</span>}
                  </td>
                  <td className="max-w-64 py-2 pr-3 text-xs text-slate-700">{r.access}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {r.breaches.length === 0 ? (
                        <span className="text-xs text-emerald-700">compliant</span>
                      ) : (
                        r.breaches.map((b) => (
                          <span
                            key={b.type}
                            className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-800 ring-1 ring-red-200"
                          >
                            {BREACH_LABEL[b.type] ?? b.type}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
                {open === r.id ? (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={6} className="px-3 py-3 text-xs text-slate-700">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 font-semibold text-slate-900">Why it breaches</div>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {r.breaches.map((b) => (
                              <li key={b.type}>{b.message}</li>
                            ))}
                            {r.breaches.length === 0 ? (
                              <li>Handled as the policy requires.</li>
                            ) : null}
                          </ul>
                          {r.webUrl ? (
                            <a
                              className="mt-2 inline-block text-sky-700 hover:underline"
                              href={r.webUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in SharePoint ↗
                            </a>
                          ) : null}
                        </div>
                        <div>
                          <div className="mb-1 font-semibold text-slate-900">
                            Evidence (redacted)
                          </div>
                          {r.snippets.length ? (
                            <ul className="space-y-1 font-mono text-[11px]">
                              {r.snippets.map((s, i) => (
                                <li
                                  key={i}
                                  className="rounded bg-white px-2 py-1 ring-1 ring-slate-200"
                                >
                                  {s}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-500">
                              No snippets stored (snippet mode is off). Counts above are the
                              evidence.
                            </p>
                          )}
                          <p className="mt-2 text-slate-500">
                            {r.classifiers
                              .map(
                                (c) =>
                                  `${c.name}: ${c.count} matches, ${c.distinctValues} distinct`,
                              )
                              .join(' · ')}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No files match these filters.</p>
        ) : null}
      </div>
    </div>
  );
}
