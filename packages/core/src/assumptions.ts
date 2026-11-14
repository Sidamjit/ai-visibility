/**
 * Editable value/cost assumptions.
 *
 * Every number used to estimate money or hours lives here with a label and a
 * plain-English explanation, so executives can see (and change, via
 * Settings → Assumptions) exactly what drives the value figures. Nothing in the
 * analysis engine hard-codes a monetary or time constant.
 */
import { z } from 'zod';

export const AssumptionsSchema = z.object({
  currency: z.string().length(3),
  copilotSeatMonthlyCost: z.number().nonnegative(),
  loadedHourlyCost: z.number().nonnegative(),
  hoursSavedPerWeekLightUser: z.number().nonnegative(),
  hoursSavedPerWeekRegularUser: z.number().nonnegative(),
  hoursSavedPerWeekPowerUser: z.number().nonnegative(),
  valueConfidenceFactor: z.number().min(0).max(1),
  inactiveSeatDays: z.number().int().positive(),
  staleContentDays: z.number().int().positive(),
  excessiveMembershipThreshold: z.number().int().positive(),
  departmentAdoptionTarget: z.number().min(0).max(1),
  lowFeatureBreadthThreshold: z.number().int().positive(),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  currency: 'USD',
  copilotSeatMonthlyCost: 30,
  loadedHourlyCost: 55,
  hoursSavedPerWeekLightUser: 0.25,
  hoursSavedPerWeekRegularUser: 1,
  hoursSavedPerWeekPowerUser: 2.5,
  valueConfidenceFactor: 0.6,
  inactiveSeatDays: 30,
  staleContentDays: 730,
  excessiveMembershipThreshold: 250,
  departmentAdoptionTarget: 0.6,
  lowFeatureBreadthThreshold: 2,
};

/** Labels + explanations rendered on the Assumptions settings page and in the report. */
export const ASSUMPTION_DOCS: Record<keyof Assumptions, { label: string; help: string }> = {
  currency: { label: 'Currency', help: 'ISO currency code used for all money figures.' },
  copilotSeatMonthlyCost: {
    label: 'Copilot seat cost / month',
    help: 'What the organisation pays per Microsoft 365 Copilot licence per month (list price is ~USD 30; use your agreement price).',
  },
  loadedHourlyCost: {
    label: 'Loaded hourly staff cost',
    help: 'Average fully-loaded cost of one hour of staff time (salary + overheads). Converts hours saved into money.',
  },
  hoursSavedPerWeekLightUser: {
    label: 'Hours saved / week — light user',
    help: 'Estimated weekly time saved by a user active on fewer than 5 days in the period.',
  },
  hoursSavedPerWeekRegularUser: {
    label: 'Hours saved / week — regular user',
    help: 'Estimated weekly time saved by a user active on 5–14 days in the period.',
  },
  hoursSavedPerWeekPowerUser: {
    label: 'Hours saved / week — power user',
    help: 'Estimated weekly time saved by a user active on 15+ days in the period.',
  },
  valueConfidenceFactor: {
    label: 'Confidence factor (0–1)',
    help: 'Discount applied to estimated value to stay conservative. 0.6 means "count 60% of the estimate".',
  },
  inactiveSeatDays: {
    label: 'Inactive seat threshold (days)',
    help: 'A licensed user with no AI activity for this many days counts as an inactive (wasted) seat.',
  },
  staleContentDays: {
    label: 'Stale content threshold (days)',
    help: 'Content not modified for this long is "stale": still discoverable by Copilot but rarely needed.',
  },
  excessiveMembershipThreshold: {
    label: 'Excessive site membership',
    help: 'Sites with more members than this are flagged as over-broad, especially when sensitive.',
  },
  departmentAdoptionTarget: {
    label: 'Department adoption target (0–1)',
    help: 'Share of licensed users in a department expected to be active. Below this is "under-use".',
  },
  lowFeatureBreadthThreshold: {
    label: 'Low feature breadth (apps)',
    help: 'Active users using Copilot in this many apps or fewer are flagged as a capability gap.',
  },
};
