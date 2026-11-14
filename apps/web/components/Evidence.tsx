/**
 * Renders a finding's evidence object: arrays of objects become tables,
 * scalars become a definition list. Evidence never contains file content (counts and redacted snippets only).
 */
function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '')
    return <span className="text-slate-400">—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (Array.isArray(value))
    return (
      <span>
        {value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}
      </span>
    );
  if (typeof value === 'object')
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  const s = String(value);
  return <span>{/^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toLocaleDateString('en-NZ') : s}</span>;
}

/** 'sensitiveItems' -> 'Sensitive items' */
const humanize = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function Evidence({
  evidence,
  maxRows = 25,
}: {
  evidence: Record<string, unknown>;
  maxRows?: number;
}) {
  const tables = Object.entries(evidence).filter(
    ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object',
  );
  const scalars = Object.entries(evidence).filter(
    ([, v]) => !(Array.isArray(v) && v.length > 0 && typeof v[0] === 'object'),
  );
  return (
    <div className="space-y-3 text-sm">
      {scalars.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {scalars.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-slate-500">{humanize(k)}:</dt>
              <dd className="text-slate-800">
                <Cell value={v} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {tables.map(([k, rows]) => {
        const list = rows as Array<Record<string, unknown>>;
        const cols = Array.from(new Set(list.flatMap((r) => Object.keys(r)))).filter(
          (c) => c !== 'id',
        );
        return (
          <div key={k}>
            <div className="mb-1 font-medium text-slate-600">
              {humanize(k)} ({list.length})
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    {cols.map((c) => (
                      <th key={c} className="py-1 pr-4 font-medium">
                        {humanize(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, maxRows).map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {cols.map((c) => (
                        <td key={c} className="py-1 pr-4 align-top">
                          <Cell value={r[c]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length > maxRows ? (
                <div className="mt-1 text-xs text-slate-400">…and {list.length - maxRows} more</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
