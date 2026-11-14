/**
 * Anthropic Claude (Team / Enterprise / API) connector (PLANNED).
 *
 * TODO(implementation):
 *  - Auth: Anthropic Admin API key (sk-ant-admin...) as ANTHROPIC_ADMIN_API_KEY.
 *  - Members & seats: organisation members -> Identity + Licence (asset 'claude').
 *  - Usage & cost: Usage and Cost Admin API reports (tokens by workspace/API key/model, cost)
 *    -> UsageSummary (per API key / workspace) and CostItem (category 'consumption').
 *  - Claude Code / Enterprise analytics where available -> UsageSummary feature keys.
 *  - Cursor: last report bucket end time.
 */
import { plannedConnector } from './planned';

export const claudeConnector = plannedConnector({
  id: 'anthropic-claude',
  displayName: 'Claude (Anthropic)',
  vendor: 'Anthropic',
  description: 'Members, seats, token usage and cost via the Anthropic Admin API.',
  requiredPermissions: [
    {
      name: 'Admin API key',
      type: 'API key',
      reason: 'Read organisation members, usage and cost reports.',
      dataAccessed: 'Members, token usage, cost by workspace/model.',
      required: true,
    },
  ],
  secretEnvVars: ['ANTHROPIC_ADMIN_API_KEY'],
});
