/** Content-scanning settings + where content goes (nowhere) + LLM/telemetry status. */
import { createLlmClientFromEnv } from '@aiv/content-scan';
import { getScanSettings, telemetryEnabled } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';
import { Card, PageHeader, Pill } from '@/components/ui';
import { ScanSettingsForm } from '@/components/settings/ScanSettingsForm';

function llmStatus(): { configured: boolean; text: string } {
  try {
    const c = createLlmClientFromEnv(process.env);
    return c
      ? { configured: true, text: `${c.provider} · ${c.model} at ${c.endpointHost}` }
      : { configured: false, text: 'Not configured (LLM_PROVIDER=none)' };
  } catch (err) {
    return { configured: false, text: `Misconfigured: ${(err as Error).message}` };
  }
}

export default async function ScanningPage() {
  const user = await requireRole(['IT']);
  const settings = await getScanSettings(user.tenantId);
  const llm = llmStatus();
  const telemetry = telemetryEnabled();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Content scanning"
        subtitle="How file content is read and classified inside your environment."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Where content goes">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>
              The worker (in your network / subscription) downloads a file via Microsoft Graph into
              memory.
            </li>
            <li>Text is extracted and checked by validated detectors and your custom detectors.</li>
            <li>
              The bytes and text are discarded. Only detector names, counts, keyed hashes and
              (optional) redacted snippets are saved in your database.
            </li>
            <li>Nothing is sent to the app vendor.</li>
          </ol>
        </Card>
        <Card title="LLM classification">
          <p className="text-sm">
            <Pill tone={llm.configured ? 'blue' : 'slate'}>
              {llm.configured ? 'endpoint configured' : 'off'}
            </Pill>
          </p>
          <p className="mt-2 text-sm text-slate-700">{llm.text}</p>
          <p className="mt-2 text-xs text-slate-500">
            Only your own Azure OpenAI resource or a model server on your network can be used;
            public AI APIs are refused by the app. Off by default.
          </p>
        </Card>
        <Card title="Vendor telemetry">
          <p className="text-sm">
            <Pill tone={telemetry ? 'amber' : 'green'}>{telemetry ? 'opted in' : 'off'}</Pill>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {telemetry
              ? 'Anonymised, bucketed counts are sent after each analysis; every payload is in the audit log.'
              : 'No data leaves your environment. Opt-in via TELEMETRY_ENABLED (see docs/SECURITY.md).'}
          </p>
        </Card>
      </div>
      <Card title="Settings">
        <ScanSettingsForm settings={settings} llmConfigured={llm.configured} />
      </Card>
    </div>
  );
}
