/**
 * ChatGPT Enterprise / Edu connector (PLANNED).
 *
 * TODO(implementation):
 *  - Auth: OpenAI Compliance API key created by a workspace owner (Admin console →
 *    Compliance API). Store as CHATGPT_COMPLIANCE_API_KEY + CHATGPT_WORKSPACE_ID.
 *  - Users & seats: list workspace users -> Identity + Licence (asset 'chatgpt-enterprise').
 *  - Usage: conversation METADATA only (counts, timestamps, GPT/tool used) -> UsageSummary.
 *    Never persist message text. Aggregate per user per day.
 *  - GPTs / custom GPTs and their connected data sources -> AIAsset (kind 'agent').
 *  - Cost: seats × contract price via CostItem (category 'licence').
 *  - Cursor: last processed event timestamp.
 */
import { plannedConnector } from './planned';

export const chatgptEnterpriseConnector = plannedConnector({
  id: 'chatgpt-enterprise',
  displayName: 'ChatGPT Enterprise',
  vendor: 'OpenAI',
  description: 'Seats, usage metadata and custom GPTs via the ChatGPT Enterprise Compliance API.',
  requiredPermissions: [
    {
      name: 'Compliance API key',
      type: 'API key',
      reason: 'Read workspace users, usage metadata and GPT inventory.',
      dataAccessed: 'User list, usage counts, GPT metadata (no message content stored).',
      required: true,
    },
  ],
  secretEnvVars: ['CHATGPT_COMPLIANCE_API_KEY', 'CHATGPT_WORKSPACE_ID'],
});
