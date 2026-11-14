/** POL-002 — Classified content stored where too many people can reach it. */
import { listFiles, policyRule } from './pol-helpers';

export const policyAudienceRule = policyRule({
  id: 'POL-002',
  name: 'Classified content in an over-broad audience',
  group: 'audience',
  description:
    'Classified files sit in public (org-wide joinable) sites or sites whose membership exceeds the maximum audience for their level.',
  rationale:
    'Site membership is invisible exposure: everyone in a 400-person "All Staff" site — and Microsoft 365 Copilot acting for each of them — can find and summarise the file.',
  severityShift: 0,
  title: (n, site) => `${n} classified file(s) exposed to too wide an audience in "${site}"`,
  recommendation: (files) => ({
    title: 'Move classified content to a restricted location',
    steps: [
      `Move ${listFiles(files)} to a private site or library limited to the people who need it.`,
      'If the whole site holds classified content, make it private and review membership (owners attest quarterly).',
      'Apply the level’s sensitivity label with access restrictions so the file stays protected if moved or downloaded.',
      'Consider SharePoint Restricted Content Discovery / Restricted Access Control for the site to keep it out of Copilot until cleaned up.',
    ],
    audience: ['IT'],
    effort: 'medium',
    impact: 'high',
  }),
});
