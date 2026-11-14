/**
 * Org-level and department-level metrics, including the VALUE MODEL.
 *
 * Value model (deliberately simple and transparent):
 *   hours saved / month per user = hoursSavedPerWeek[intensity] × 4.33
 *   monthly value                = Σ hours × loadedHourlyCost × valueConfidenceFactor
 * All constants come from `Assumptions` and are editable in the UI.
 */
import type { Assumptions, NormalizedBatch } from '@aiv/core';
import type { AnalysisIndex, UsageIntensity } from './context';
import type { DepartmentStat, OrgMetrics } from './types';

const WEEKS_PER_MONTH = 4.33;

export function hoursPerMonthFor(intensity: UsageIntensity, a: Assumptions): number {
  const perWeek =
    intensity === 'power'
      ? a.hoursSavedPerWeekPowerUser
      : intensity === 'regular'
        ? a.hoursSavedPerWeekRegularUser
        : intensity === 'light'
          ? a.hoursSavedPerWeekLightUser
          : 0;
  return perWeek * WEEKS_PER_MONTH;
}

export function computeDepartmentStats(index: AnalysisIndex, a: Assumptions): DepartmentStat[] {
  const out: DepartmentStat[] = [];
  for (const [name, people] of index.peopleByDepartment) {
    let licensed = 0;
    let active = 0;
    let breadthSum = 0;
    let hours = 0;
    const featureUsers: Record<string, number> = {};
    for (const p of people) {
      if (!index.licencesByIdentity.has(p.externalId)) continue;
      licensed++;
      const usage = index.usageByIdentity.get(p.externalId)?.[0];
      if (index.isActiveSeat(p.externalId)) {
        active++;
        if (usage) breadthSum += index.featureBreadth(usage);
      }
      if (usage) {
        hours += hoursPerMonthFor(index.intensity(usage), a);
        for (const [feature, last] of Object.entries(usage.featureLastActivity)) {
          if (last) featureUsers[feature] = (featureUsers[feature] ?? 0) + 1;
        }
      }
    }
    out.push({
      name,
      headcount: people.length,
      licensed,
      active,
      adoptionRate: licensed ? active / licensed : 0,
      avgBreadth: active ? breadthSum / active : 0,
      featureUsers,
      estimatedHoursSavedPerMonth: Math.round(hours),
    });
  }
  return out.sort((x, y) => y.licensed - x.licensed);
}

export function computeOrgMetrics(
  data: NormalizedBatch,
  index: AnalysisIndex,
  a: Assumptions,
  departments: DepartmentStat[],
): OrgMetrics {
  const licensedIds = [...index.licencesByIdentity.keys()];
  const activeSeats = licensedIds.filter((id) => index.isActiveSeat(id)).length;
  const licenceSpend = data.licences.length * a.copilotSeatMonthlyCost;
  const otherSpend = data.costs.reduce((s, c) => s + c.monthlyAmount, 0);
  const hours = departments.reduce((s, d) => s + d.estimatedHoursSavedPerMonth, 0);
  const value = hours * a.loadedHourlyCost * a.valueConfidenceFactor;
  const monthlySpend = licenceSpend + otherSpend;
  const activeBreadths = licensedIds
    .filter((id) => index.isActiveSeat(id))
    .map((id) => index.usageByIdentity.get(id)?.[0])
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => index.featureBreadth(u));

  const grants = data.grants.filter((g) => !g.inherited);
  const sensitive = data.locations.filter((l) => index.isSensitive(l));
  return {
    totalUsers: data.identities.filter((i) => !i.isGuest).length,
    guestUsers: data.identities.filter((i) => i.isGuest).length,
    licensedSeats: licensedIds.length,
    activeSeats,
    inactiveSeats: licensedIds.length - activeSeats,
    adoptionRate: licensedIds.length ? activeSeats / licensedIds.length : 0,
    avgFeatureBreadth: activeBreadths.length
      ? activeBreadths.reduce((s, x) => s + x, 0) / activeBreadths.length
      : 0,
    monthlySpend,
    licenceSpend,
    otherSpend,
    wastedSpend: (licensedIds.length - activeSeats) * a.copilotSeatMonthlyCost,
    estimatedHoursSavedPerMonth: Math.round(hours),
    estimatedMonthlyValue: Math.round(value),
    roi: monthlySpend > 0 ? value / monthlySpend : null,
    sites: index.sites.length,
    publicSites: index.sites.filter((s) => s.visibility === 'public').length,
    sensitiveLocations: sensitive.length,
    unlabeledSensitive: sensitive.filter((l) => !index.hasSensitiveLabel(l)).length,
    anyoneLinks: grants.filter((g) => g.scope === 'anyone').length,
    orgLinks: grants.filter((g) => g.scope === 'organization').length,
    externalGrants: grants.filter((g) => g.scope === 'external-guest').length,
    uniquePermissionItems: data.locations.filter((l) => l.hasUniquePermissions).length,
    staleSites: index.sites.filter((s) => index.isStale(s)).length,
    currency: a.currency,
  };
}
