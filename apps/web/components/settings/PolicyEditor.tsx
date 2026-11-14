'use client';
/** YAML/JSON policy editor with server-side validation (errors listed by path). */
import { useActionState, useEffect, useState } from 'react';
import { savePolicyAction, type FormState } from '@/app/(app)/settings/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { FormMessages } from './FormMessages';

export function PolicyEditor({ initial }: { initial: string }) {
  const [state, action] = useActionState<FormState, FormData>(savePolicyAction, {});
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (state.text !== undefined) setText(state.text);
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <textarea
        name="policy"
        aria-label="Policy YAML"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[28rem] w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100"
      />
      <FormMessages state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="Validating and re-analysing…">Validate &amp; save</SubmitButton>
        <button
          type="submit"
          name="intent"
          value="sample"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Load NZ sample
        </button>
        <a
          download="classification-policy.yaml"
          href={`data:text/yaml;charset=utf-8,${encodeURIComponent(text)}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download YAML
        </a>
      </div>
    </form>
  );
}
