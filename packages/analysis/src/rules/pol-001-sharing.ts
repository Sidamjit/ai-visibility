/**
 * POL-001 — Classified content shared beyond what its classification allows
 * (anyone links, organisation-wide links, external guests).
 */
import { listFiles, policyRule } from './pol-helpers';

export const policySharingRule = policyRule({
  id: 'POL-001',
  name: 'Classified content shared beyond policy',
  group: 'sharing',
  description:
    'Files whose CONTENT is classified (e.g. Sensitive, Restricted) carry sharing links or guest access that their level forbids.',
  rationale:
    'This is the breach scenario: content the organisation itself classifies as sensitive is reachable by anonymous links, everyone in the company, or outsiders.',
  severityShift: 0,
  title: (n, site) => `${n} classified file(s) overshared in "${site}"`,
  recommendation: (files) => ({
    title: 'Remove links and guest access that breach the classification policy',
    steps: [
      `Remove "anyone" and organisation-wide links on ${listFiles(files)} (Manage access in SharePoint).`,
      'Re-share only with named people who need it; remove guests unless the policy level allows them.',
      'Apply the required sensitivity label and a Purview DLP policy that blocks external / anyone sharing for this classification.',
      'Ask the content owner whether the information needs to be kept at all (data minimisation, Privacy Act IPP 9).',
      'If an anonymous or guest link was used to open the file, assess it as a potential privacy breach (Privacy Act 2020 notifiable breach test).',
    ],
    audience: ['IT', 'EXECUTIVE'],
    effort: 'low',
    impact: 'high',
  }),
});
