import { describe, expect, it } from 'vitest';
import * as fx from '../__fixtures__/graph';
import {
  hasUniquePermissions,
  parseCopilotLicences,
  parseCopilotUsageRow,
  parseDriveItem,
  parsePermission,
  parseSite,
  parseUser,
  toIsoDate,
  type GraphPermission,
} from './parsers';

describe('Graph parsers', () => {
  it('parses users and detects guests by userType / #EXT#', () => {
    const [ana, , gail] = fx.users.map(parseUser);
    expect(ana).toMatchObject({
      externalId: 'u1',
      departmentName: 'Finance',
      isGuest: false,
      lastSignInAt: '2026-11-10T08:00:00.000Z',
    });
    expect(gail?.isGuest).toBe(true);
  });

  it('extracts only Copilot SKUs as licences', () => {
    const lic = parseCopilotLicences(fx.users, fx.skus);
    expect(lic).toHaveLength(2);
    expect(lic.every((l) => l.skuName === 'Microsoft_365_Copilot')).toBe(true);
  });

  it('maps Copilot usage rows to per-feature last activity and skips unknown users', () => {
    const map = new Map([
      ['ana@contoso.com', 'u1'],
      ['ben@contoso.com', 'u2'],
    ]);
    const ana = parseCopilotUsageRow(fx.copilotUsage[0]!, map);
    expect(ana?.identityExternalId).toBe('u1');
    expect(ana?.featureLastActivity.teams).toBe('2026-11-11T00:00:00.000Z');
    expect(ana?.featureLastActivity.excel).toBeNull(); // empty string -> null
    expect(Object.values(ana!.featureLastActivity).filter(Boolean)).toHaveLength(4);
    expect(parseCopilotUsageRow(fx.copilotUsage[1]!, map)?.lastActivityAt).toBeNull();
    expect(parseCopilotUsageRow(fx.copilotUsage[2]!, map)).toBeNull();
  });

  it('maps permission scopes: anonymous, organization, guest, inherited', () => {
    const guests = new Set(['g1']);
    const [anon, owner] = (fx.permissions.it1 as GraphPermission[]).map((p) =>
      parsePermission(p, 'it1', guests),
    );
    const [org, guest] = (fx.permissions.it3 as GraphPermission[]).map((p) =>
      parsePermission(p, 'it3', guests),
    );
    expect(anon).toMatchObject({ scope: 'anyone', inherited: false, roles: ['read'] });
    expect(owner).toMatchObject({ scope: 'direct', inherited: true });
    expect(org?.scope).toBe('organization');
    expect(guest).toMatchObject({
      scope: 'external-guest',
      externalPrincipalCount: 1,
      grantedToExternalIds: ['g1'],
    });
    expect(hasUniquePermissions([anon!, owner!])).toBe(true);
    expect(hasUniquePermissions([owner!])).toBe(false);
  });

  it('flags sensitive items from the name or the parent path (metadata only)', () => {
    expect(parseDriveItem(fx.deltaPage1.value[1]!, 'drv1', 'site1').likelySensitive).toBe(true);
    const q3 = parseDriveItem(fx.deltaPage2.value[1]!, 'drv1', 'site1');
    expect(q3.likelySensitive).toBe(true);
    expect(q3.sensitivityReasons).toContain('financial');
    expect(parseDriveItem(fx.deltaPage2.value[0]!, 'drv1', 'site1').likelySensitive).toBe(false);
  });

  it('marks group-connected public sites', () => {
    const loc = parseSite(fx.sites[0]!, { ...fx.groups[0]!, memberCount: 300, guestCount: 2 });
    expect(loc).toMatchObject({
      kind: 'team',
      visibility: 'public',
      memberCount: 300,
      guestMemberCount: 2,
    });
  });

  it('normalizes report dates', () => {
    expect(toIsoDate('2026-01-05')).toBe('2026-01-05T00:00:00.000Z');
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('garbage')).toBeNull();
  });
});
