/**
 * Run one connector instance: load config + cursor, call `connector.sync()`,
 * persist the normalized batch, record a SyncRun, and store the new cursor.
 */
import { consoleLogger, getConnector, type ConnectorLogger } from '@aiv/connectors';
import { createContentScanner, createLlmClientFromEnv } from '@aiv/content-scan';
import { loadKnownContentVersions, prisma, saveBatch, type Prisma } from '@aiv/db';
import { audit } from './audit';
import { getScanSettings, getTenantPolicy } from './policy';

export interface SyncOutcome {
  ok: boolean;
  stats: Record<string, number>;
  warnings: string[];
  error?: string;
}

/** Secrets come ONLY from the environment. Never from the database. */
function secretsFor(envVars: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(envVars.map((k) => [k, process.env[k]]));
}

export async function runConnectorSync(
  tenantId: string,
  connectorInstanceId: string,
  opts: { logger?: ConnectorLogger; now?: () => Date } = {},
): Promise<SyncOutcome> {
  const instance = await prisma.connectorInstance.findFirstOrThrow({
    where: { id: connectorInstanceId, tenantId },
  });
  const connector = getConnector(instance.connectorId);
  if (!connector) throw new Error(`Unknown connector '${instance.connectorId}'`);

  const run = await prisma.syncRun.create({
    data: { tenantId, connectorInstanceId, status: 'running' },
  });
  await prisma.connectorInstance.update({
    where: { id: instance.id },
    data: { status: 'running' },
  });
  try {
    const config = connector.configSchema.parse(instance.config ?? {});
    const logger = opts.logger ?? consoleLogger;
    // Content scanning runs HERE, inside the client's environment. File bytes
    // and extracted text live only in this process's memory during the scan.
    const settings = await getScanSettings(tenantId);
    let contentScanner;
    let knownContentVersions;
    if (settings.enabled) {
      const { policy } = await getTenantPolicy(tenantId);
      const llm = settings.llmEnabled ? createLlmClientFromEnv(process.env) : null;
      if (settings.llmEnabled && !llm)
        logger.warn(
          'LLM classification is enabled in settings but LLM_PROVIDER is not configured.',
        );
      if (llm)
        await audit({
          tenantId,
          actor: 'worker',
          action: 'scan.llm.use',
          target: llm.endpointHost,
          detail: { provider: llm.provider, model: llm.model },
        });
      contentScanner = createContentScanner({ settings, policy, llm, now: opts.now });
      knownContentVersions = await loadKnownContentVersions(prisma, {
        tenantId,
        connectorInstanceId,
      });
    }
    const result = await connector.sync(
      {
        tenantId,
        config,
        secrets: secretsFor(connector.secretEnvVars),
        logger,
        now: opts.now,
        contentScanner,
        knownContentVersions,
      },
      (instance.cursor as Record<string, unknown> | null) ?? null,
    );
    await saveBatch(prisma, { tenantId, connectorInstanceId }, result.batch, {
      fullSync: result.fullSync,
      deletions: result.deletions,
      contentScanScope: result.contentScanScope,
    });
    const finishedAt = new Date();
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'ok',
        finishedAt,
        fullSync: result.fullSync,
        stats: result.stats,
        warnings: result.warnings,
      },
    });
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: {
        status: 'ok',
        lastSyncAt: finishedAt,
        lastError: null,
        cursor: result.nextCursor as Prisma.InputJsonValue,
        lastStats: result.stats,
        lastWarnings: result.warnings,
      },
    });
    return { ok: true, stats: result.stats, warnings: result.warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'error', finishedAt: new Date(), error: message },
    });
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { status: 'error', lastError: message },
    });
    return { ok: false, stats: {}, warnings: [], error: message };
  }
}
