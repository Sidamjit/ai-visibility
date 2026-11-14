'use client';
import { useActionState } from 'react';
import { grantVendorAccessAction, type FormState } from '@/app/(app)/settings/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { FormMessages } from './FormMessages';

const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

export function VendorGrantForm({ maxHours }: { maxHours: number }) {
  const [state, action] = useActionState<FormState, FormData>(grantVendorAccessAction, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="text-sm">
        <span className="font-medium text-slate-800">Vendor engineer email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="support@weltrous.com"
          className={field}
        />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Name</span>
        <input name="name" placeholder="Weltrous support" className={field} />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Scope</span>
        <select name="scope" defaultValue="diagnostics" className={field}>
          <option value="diagnostics">
            Diagnostics only — sync health, versions, errors (no findings or names)
          </option>
          <option value="read-only">Read-only — also dashboards, findings and breach detail</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Expires after (hours, max {maxHours})</span>
        <input
          name="hours"
          type="number"
          min={1}
          max={maxHours}
          defaultValue={4}
          className={field}
        />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="font-medium text-slate-800">Reason / ticket</span>
        <input
          name="reason"
          required
          placeholder="e.g. INC-1042 sync failing since Tuesday"
          className={field}
        />
      </label>
      <div className="space-y-3 md:col-span-2">
        <FormMessages state={state} />
        {state.secret ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <div className="font-semibold">One-time password — shown once</div>
            <p className="mt-1">
              Give this to <b>{state.secret.email}</b> through a channel you trust. It stops working
              at {new Date(state.secret.expiresAt).toLocaleString('en-NZ')} or when you revoke the
              grant.
            </p>
            <code className="mt-2 block select-all rounded bg-white px-2 py-1 font-mono text-base">
              {state.secret.password}
            </code>
          </div>
        ) : null}
        <SubmitButton pendingText="Granting…">Grant time-boxed access</SubmitButton>
      </div>
    </form>
  );
}
