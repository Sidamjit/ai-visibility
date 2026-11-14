/**
 * Editable value/cost assumptions. Saving re-runs the analysis so every money
 * and hours figure in the app updates immediately.
 */
import { ASSUMPTION_DOCS, type Assumptions } from '@aiv/core';
import { requireRole } from '@/lib/auth';
import { getLatestRun } from '@/lib/data';
import { SubmitButton } from '@/components/SubmitButton';
import { Card, PageHeader } from '@/components/ui';
import { getTenantAssumptions } from '@aiv/pipeline';
import { saveAssumptions } from '../../actions';

export default async function AssumptionsPage() {
  const user = await requireRole(['IT', 'EXECUTIVE']);
  const [assumptions, run] = await Promise.all([
    getTenantAssumptions(user.tenantId),
    getLatestRun(user.tenantId),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Value assumptions"
        subtitle="Every money and time-saved figure is calculated from these numbers. Adjust them to your organisation; they are shown in the report."
      />
      <Card>
        <form action={saveAssumptions} className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {(Object.keys(ASSUMPTION_DOCS) as Array<keyof Assumptions>).map((key) => (
            <label key={key} className="block text-sm">
              <span className="font-medium text-slate-800">{ASSUMPTION_DOCS[key].label}</span>
              <input
                name={key}
                defaultValue={String(assumptions[key])}
                type={key === 'currency' ? 'text' : 'number'}
                step="any"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <span className="mt-1 block text-xs text-slate-500">{ASSUMPTION_DOCS[key].help}</span>
            </label>
          ))}
          <div className="md:col-span-2">
            <SubmitButton pendingText="Saving and re-analysing…">
              Save and re-run analysis
            </SubmitButton>
            {run ? (
              <span className="ml-3 text-xs text-slate-500">
                Last analysis {run.createdAt.toLocaleString('en-NZ')}
              </span>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
