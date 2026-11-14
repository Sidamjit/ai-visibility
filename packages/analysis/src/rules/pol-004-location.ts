/** POL-004 — Classified content stored outside its approved locations. */
import { listFiles, policyRule } from './pol-helpers';

export const policyLocationRule = policyRule({
  id: 'POL-004',
  name: 'Classified content in a non-approved location',
  group: 'location',
  description:
    'Files are stored in sites, OneDrives or departments that the policy does not approve for their classification level.',
  rationale:
    'Information-management policies name where each class of information may live (e.g. Restricted only in Legal/Board sites). Content outside those places escapes their access controls and retention.',
  severityShift: 1,
  title: (n, site) => `${n} classified file(s) stored outside approved locations ("${site}")`,
  recommendation: (files) => ({
    title: 'Move content to an approved location',
    steps: [
      `Agree the correct home for ${listFiles(files)} with the information owner.`,
      'Move (not copy) the files to the approved site/library; remove the original and any copies in OneDrive.',
      'Publish the approved-locations list to staff and add it to the information-management training.',
    ],
    audience: ['IT', 'MANAGER'],
    effort: 'medium',
    impact: 'medium',
  }),
});
