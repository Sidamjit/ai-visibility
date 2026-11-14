'use client';
import { useActionState } from 'react';
import type { ScanSettings } from '@aiv/core';
import { saveScanSettingsAction, type FormState } from '@/app/(app)/settings/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { FormMessages } from './FormMessages';

const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

export function ScanSettingsForm({
  settings,
  llmConfigured,
}: {
  settings: ScanSettings;
  llmConfigured: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveScanSettingsAction, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <label className="flex items-start gap-3 text-sm md:col-span-2">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-1" />
        <span>
          <span className="font-medium text-slate-800">Read and classify file content</span>
          <span className="block text-xs text-slate-500">
            Files are downloaded into memory by the worker in your environment, classified, and
            discarded. Turn off to analyse metadata only.
          </span>
        </span>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Max file size (MB)</span>
        <input
          name="maxFileSizeMb"
          type="number"
          min={1}
          max={200}
          defaultValue={settings.maxFileSizeMb}
          className={field}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Larger files are recorded as skipped.
        </span>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Files scanned in parallel</span>
        <input
          name="concurrency"
          type="number"
          min={1}
          max={16}
          defaultValue={settings.concurrency}
          className={field}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Graph throttling (429) is honoured automatically.
        </span>
      </label>
      <label className="text-sm md:col-span-2">
        <span className="font-medium text-slate-800">File types to read</span>
        <input
          name="allowedExtensions"
          defaultValue={settings.allowedExtensions.join(', ')}
          className={field}
        />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Max files read per sync</span>
        <input
          name="maxFilesPerRun"
          type="number"
          min={1}
          defaultValue={settings.maxFilesPerRun}
          className={field}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Remaining files are picked up next sync (incremental).
        </span>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Max text characters per file</span>
        <input
          name="maxTextChars"
          type="number"
          min={1000}
          defaultValue={settings.maxTextChars}
          className={field}
        />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Evidence snippets</span>
        <select name="snippetMode" defaultValue={settings.snippetMode} className={field}>
          <option value="off">Off — store counts only (default)</option>
          <option value="redacted">Redacted — short context with matches masked</option>
        </select>
        <span className="mt-1 block text-xs text-slate-500">
          Redacted snippets help reviewers confirm a detection. Matched values, other numbers and
          emails are masked.
        </span>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Snippet context (characters each side)</span>
        <input
          name="snippetContextChars"
          type="number"
          min={0}
          max={80}
          defaultValue={settings.snippetContextChars}
          className={field}
        />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-800">Snippets per detector per file</span>
        <input
          name="maxSnippetsPerClassifier"
          type="number"
          min={0}
          max={5}
          defaultValue={settings.maxSnippetsPerClassifier}
          className={field}
        />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="llmEnabled"
          defaultChecked={settings.llmEnabled}
          className="mt-1"
          disabled={!llmConfigured && !settings.llmEnabled}
        />
        <span>
          <span className="font-medium text-slate-800">LLM second opinion (your endpoint)</span>
          <span className="block text-xs text-slate-500">
            {llmConfigured
              ? 'Sends extracted text of files with no detector hits to YOUR model endpoint for a classification opinion. It can only raise a classification.'
              : 'Unavailable: no LLM endpoint is configured (LLM_PROVIDER). See docs/SECURITY.md.'}
          </span>
        </span>
      </label>
      <div className="md:col-span-2 space-y-3">
        <FormMessages state={state} />
        <SubmitButton pendingText="Saving…">Save scanning settings</SubmitButton>
      </div>
    </form>
  );
}
