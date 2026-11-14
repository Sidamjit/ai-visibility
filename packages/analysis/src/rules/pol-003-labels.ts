/** POL-003 — Classified content without the sensitivity label its level requires. */
import { policyRule } from './pol-helpers';

export const policyLabelRule = policyRule({
  id: 'POL-003',
  name: 'Classified content missing the required label',
  group: 'label',
  description:
    'Files whose content classification requires a sensitivity label have none, or a label below the required level.',
  rationale:
    'Labels drive encryption, DLP and Copilot protections. Unlabelled In-Confidence/Sensitive content is handled as if it were public by every downstream control.',
  severityShift: 1,
  title: (n, site) => `${n} classified file(s) without the required label in "${site}"`,
  recommendation: (files, ctx) => {
    const classifiers = [
      ...new Set(files.flatMap((f) => f.scan.hits.map((h) => h.classifierId))),
    ].slice(0, 6);
    const levels = [...new Set(files.map((f) => f.classification.level))];
    return {
      title: 'Label classified content (and automate it)',
      steps: [
        `Apply the required label (${levels
          .map((l) =>
            l.labels.acceptedLabels.length
              ? `${l.name}: ${l.labels.acceptedLabels.join(' / ')}`
              : `${l.name}: priority ≥ ${l.labels.minimumPriority ?? 'any sensitive'}`,
          )
          .join('; ')}) to the ${files.length} file(s) listed.`,
        `Create a Purview auto-labelling policy for the sensitive information types found here (${classifiers.join(', ')}).`,
        'Set a default sensitivity label on the document library so new files are labelled automatically.',
        ctx.policy
          ? `Confirm the label mapping in ${ctx.policy.name} matches the published Purview labels.`
          : 'Confirm the label mapping in the classification policy.',
      ],
      audience: ['IT'],
      effort: 'medium',
      impact: 'medium',
    };
  },
});
