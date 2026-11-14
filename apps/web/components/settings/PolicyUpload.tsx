'use client';
/** Upload a policy document → draft rules for review (document is not stored). */
import { useActionState } from 'react';
import { uploadPolicyDocumentAction, type FormState } from '@/app/(app)/settings/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { FormMessages } from './FormMessages';

export function PolicyUpload({ llm }: { llm: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(uploadPolicyDocumentAction, {});
  return (
    <form action={action} className="space-y-3">
      <input
        type="file"
        name="document"
        accept=".docx,.pdf,.txt,.md,.pptx,.xlsx,.eml,.msg,.html"
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
      />
      <p className="text-xs text-slate-500">
        {llm
          ? `Rules are drafted by your own model at ${llm}, then validated. `
          : 'No LLM endpoint is configured, so rules are drafted with pattern matching (markings, retention periods, handling phrases). '}
        The document is read in memory and not stored — only its name and hash are kept with the
        draft. Nothing changes until you accept a draft.
      </p>
      <FormMessages state={state} />
      <SubmitButton pendingText="Reading document…">Draft rules from document</SubmitButton>
    </form>
  );
}
