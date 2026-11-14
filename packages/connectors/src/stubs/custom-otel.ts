/**
 * Custom AI / LMS AI ingestion via webhook or OpenTelemetry (PLANNED).
 *
 * For in-house bots, LMS AI tutors and vendor tools without an admin API, the
 * customer PUSHES events to us instead of us pulling.
 *
 * TODO(implementation):
 *  - Endpoint: POST /api/ingest/events (per-tenant bearer token, INGEST_TOKEN_<tenant>).
 *    Body: { assetId, assetName, vendor, events: [{ userEmail, timestamp, feature, tokens?, costUsd? }] }
 *    validated with zod; aggregate into UsageSummary + CostItem.
 *  - OTLP/HTTP: accept GenAI semantic-convention spans (gen_ai.system, gen_ai.request.model,
 *    gen_ai.usage.input_tokens/output_tokens). Drop prompt/completion attributes on arrival.
 *  - Because data is pushed, `sync()` just drains the ingestion table since the cursor.
 */
import { plannedConnector } from './planned';

export const customOtelConnector = plannedConnector({
  id: 'custom-ingest',
  displayName: 'Custom AI / LMS (webhook & OpenTelemetry)',
  vendor: 'Any',
  description:
    'Push usage events from in-house AI, LMS AI tutors or other tools via webhook or OTLP.',
  requiredPermissions: [
    {
      name: 'Ingestion token',
      type: 'API key',
      reason: 'Authenticates events pushed by the customer system.',
      dataAccessed: 'Event metadata only; prompt/response text is discarded.',
      required: true,
    },
  ],
  secretEnvVars: ['INGEST_TOKEN'],
});
