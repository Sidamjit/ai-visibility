import type { FormState } from '@/app/(app)/settings/actions';

export function FormMessages({ state }: { state: FormState }) {
  return (
    <div className="space-y-2 text-sm">
      {state.message ? (
        <p className={state.ok === false ? 'text-red-700' : 'text-emerald-700'}>{state.message}</p>
      ) : null}
      {state.errors?.length ? (
        <ul className="list-disc space-y-0.5 rounded-lg bg-red-50 py-2 pl-6 pr-3 text-red-800">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {state.warnings?.length ? (
        <ul className="list-disc space-y-0.5 rounded-lg bg-amber-50 py-2 pl-6 pr-3 text-amber-900">
          {state.warnings.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
