/**
 * Rule registry. Order here is the order rules run and appear in the rule catalogue.
 * To add a rule: create `xxx-nnn-name.ts`, export a RuleDefinition, add it below,
 * and add a test in `rules.test.ts`. See docs/ADDING_AN_ANALYSIS_RULE.md.
 */
import type { RuleDefinition } from '../types';
import { anyoneLinksRule } from './ovr-001-anyone-links';
import { orgWideLinksRule } from './ovr-002-org-wide-links';
import { externalGuestsRule } from './ovr-003-external-guests';
import { broadAccessSitesRule } from './ovr-004-broad-access-sites';
import { staleContentRule } from './ovr-005-stale-content';
import { brokenInheritanceRule } from './ovr-006-broken-inheritance';
import { unlabeledSensitiveRule } from './lab-001-unlabeled-sensitive';
import { dormantAccessRule } from './idn-001-dormant-access';
import { copilotReadinessRule } from './rdy-001-copilot-readiness';
import { licenceWasteRule } from './lic-001-licence-waste';
import { departmentUnderuseRule } from './ado-001-department-underuse';
import { capabilityGapsRule } from './cap-001-capability-gaps';
import { spendVsAdoptionRule } from './spd-001-spend-vs-adoption';
import { valueOpportunityRule } from './val-001-value-opportunity';
import { policySharingRule } from './pol-001-sharing';
import { policyAudienceRule } from './pol-002-audience';
import { policyLabelRule } from './pol-003-labels';
import { policyLocationRule } from './pol-004-location';
import { policyRetentionRule } from './pol-005-retention';
import { secretsInContentRule } from './sec-001-secrets-in-content';

export const RULES: readonly RuleDefinition[] = [
  anyoneLinksRule,
  orgWideLinksRule,
  externalGuestsRule,
  broadAccessSitesRule,
  staleContentRule,
  brokenInheritanceRule,
  unlabeledSensitiveRule,
  dormantAccessRule,
  copilotReadinessRule,
  licenceWasteRule,
  departmentUnderuseRule,
  capabilityGapsRule,
  spendVsAdoptionRule,
  valueOpportunityRule,
  // Content classification vs policy (need content scans + a tenant policy).
  policySharingRule,
  policyAudienceRule,
  policyLabelRule,
  policyLocationRule,
  policyRetentionRule,
  secretsInContentRule,
];

export { TRAINING_BY_FEATURE } from './cap-001-capability-gaps';
