'use client';
/**
 * Chart components (Recharts). Client-only; pages pass plain serializable data.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });

export function TrendChart({
  data,
  height = 260,
}: {
  data: Array<{ date: string; risk: number; value: number; adoption?: number }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} />
        <YAxis domain={[0, 100]} fontSize={12} />
        <Tooltip labelFormatter={(v) => shortDate(String(v))} />
        <Legend />
        <Line
          type="monotone"
          dataKey="risk"
          name="Risk score"
          stroke="#dc2626"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="value"
          name="Value score"
          stroke="#059669"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {data.some((d) => d.adoption !== undefined) ? (
          <Line
            type="monotone"
            dataKey="adoption"
            name="Adoption %"
            stroke="#0284c7"
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({
  data,
  bars,
  xKey = 'name',
  height = 260,
  layout = 'horizontal',
}: {
  data: Array<Record<string, string | number>>;
  bars: Array<{ key: string; label: string; color: string; stack?: string }>;
  xKey?: string;
  height?: number;
  layout?: 'horizontal' | 'vertical';
}) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={vertical ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, left: vertical ? 40 : -16, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {/* Recharts only inspects DIRECT children, so axes cannot be wrapped in fragments. */}
        {vertical ? (
          <XAxis type="number" fontSize={12} />
        ) : (
          <XAxis
            dataKey={xKey}
            fontSize={11}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={60}
          />
        )}
        {vertical ? (
          <YAxis type="category" dataKey={xKey} fontSize={11} width={130} />
        ) : (
          <YAxis fontSize={12} />
        )}
        <Tooltip />
        {bars.length > 1 ? <Legend /> : null}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={b.color}
            stackId={b.stack}
            isAnimationActive={false}
            radius={b.stack ? 0 : 3}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#fbbf24',
  low: '#7dd3fc',
  info: '#cbd5e1',
};

export function SeverityDonut({
  counts,
  height = 220,
}: {
  counts: Record<string, number>;
  height?: number;
}) {
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={80}
          isAnimationActive={false}
          label
        >
          {data.map((d) => (
            <Cell key={d.name} fill={SEVERITY_COLORS[d.name] ?? '#94a3b8'} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
