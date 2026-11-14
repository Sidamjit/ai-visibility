/** POL-005 — Classified content kept beyond its retention period. */
import { listFiles, policyRule } from './pol-helpers';

export const policyRetentionRule = policyRule({
  id: 'POL-005',
  name: 'Classified content kept beyond retention',
  group: 'retention',
  description:
    'Classified files have not been modified for longer than their level’s retention period (review / archive / dispose).',
  rationale:
    'Keeping personal information longer than needed breaches Privacy Act IPP 9 and inflates the impact of any breach; old content also pollutes Copilot answers.',
  severityShift: 2,
  title: (n, site) => `${n} classified file(s) past retention in "${site}"`,
  recommendation: (files) => {
    const actions = [...new Set(files.map((f) => f.classification.level.retention.action))];
    return {
      title: 'Apply retention and dispose of expired content',
      steps: [
        `Review ${listFiles(files)} with the records owner (required action: ${actions.join(' / ')}).`,
        'Check for legal holds and Public Records Act obligations before disposal; record the disposal decision.',
        'Apply a Purview retention label / policy so this happens automatically for the library.',
      ],
      audience: ['IT'],
      effort: 'medium',
      impact: 'medium',
    };
  },
});
