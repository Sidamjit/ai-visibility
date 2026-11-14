/**
 * Recorded-shape Microsoft Graph responses used by unit tests. Field names and
 * nesting mirror real v1.0/beta payloads; values are fictional.
 */
export const TENANT = 'contoso-tenant-id';

export const users = [
  {
    id: 'u1',
    displayName: 'Ana Admin',
    mail: 'ana@contoso.com',
    userPrincipalName: 'ana@contoso.com',
    department: 'Finance',
    jobTitle: 'CFO',
    userType: 'Member',
    accountEnabled: true,
    assignedLicenses: [{ skuId: 'sku-copilot' }, { skuId: 'sku-e5' }],
    signInActivity: { lastSignInDateTime: '2026-11-10T08:00:00Z' },
  },
  {
    id: 'u2',
    displayName: 'Ben Builder',
    mail: 'ben@contoso.com',
    userPrincipalName: 'ben@contoso.com',
    department: 'Operations',
    jobTitle: null,
    userType: 'Member',
    accountEnabled: true,
    assignedLicenses: [{ skuId: 'sku-copilot' }],
  },
  {
    id: 'g1',
    displayName: 'Gail Guest',
    mail: 'gail@partner.com',
    userPrincipalName: 'gail_partner.com#EXT#@contoso.onmicrosoft.com',
    department: null,
    userType: 'Guest',
    accountEnabled: true,
    assignedLicenses: [],
  },
];

export const skus = [
  { skuId: 'sku-copilot', skuPartNumber: 'Microsoft_365_Copilot' },
  { skuId: 'sku-e5', skuPartNumber: 'SPE_E5' },
];

export const copilotUsage = [
  {
    reportRefreshDate: '2026-11-12',
    userPrincipalName: 'ana@contoso.com',
    displayName: 'Ana Admin',
    lastActivityDate: '2026-11-11',
    microsoftTeamsCopilotLastActivityDate: '2026-11-11',
    wordCopilotLastActivityDate: '2026-11-02',
    excelCopilotLastActivityDate: '',
    powerPointCopilotLastActivityDate: null,
    outlookCopilotLastActivityDate: '2026-11-09',
    oneNoteCopilotLastActivityDate: null,
    loopCopilotLastActivityDate: null,
    copilotChatLastActivityDate: '2026-11-11',
  },
  {
    reportRefreshDate: '2026-11-12',
    userPrincipalName: 'ben@contoso.com',
    displayName: 'Ben Builder',
    lastActivityDate: '',
  },
  {
    reportRefreshDate: '2026-11-12',
    userPrincipalName: 'unknown@contoso.com',
    lastActivityDate: '2026-11-01',
  },
];

export const groups = [
  { id: 'grp1', displayName: 'Finance Team', visibility: 'Public', assignedLabels: [] },
];

export const sites = [
  {
    id: 'site1',
    name: 'Finance',
    displayName: 'Finance Team',
    webUrl: 'https://contoso.sharepoint.com/sites/Finance',
    lastModifiedDateTime: '2026-10-01T00:00:00Z',
    isPersonalSite: false,
  },
  {
    id: 'od1',
    name: 'ana',
    displayName: 'Ana Admin',
    webUrl: 'https://contoso-my.sharepoint.com/personal/ana',
    lastModifiedDateTime: '2026-10-01T00:00:00Z',
    isPersonalSite: true,
  },
];

export const drives = [
  {
    id: 'drv1',
    name: 'Documents',
    webUrl: 'https://contoso.sharepoint.com/sites/Finance/Shared Documents',
    driveType: 'documentLibrary',
    lastModifiedDateTime: '2026-10-01T00:00:00Z',
  },
];

export const deltaPage1 = {
  value: [
    { id: 'root', name: 'root', root: {}, folder: { childCount: 3 } },
    {
      id: 'it1',
      name: 'Payroll 2026.xlsx',
      file: {},
      shared: { scope: 'anonymous' },
      lastModifiedDateTime: '2026-09-01T00:00:00Z',
      parentReference: { id: 'root', driveId: 'drv1', path: '/drives/drv1/root:' },
    },
  ],
  '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drv1/root/delta?$skiptoken=page2',
};
export const deltaPage2 = {
  value: [
    {
      id: 'it2',
      name: 'Team lunch.docx',
      file: {},
      lastModifiedDateTime: '2026-09-01T00:00:00Z',
      parentReference: { id: 'root', path: '/drives/drv1/root:' },
    },
    {
      id: 'it3',
      name: 'Q3.xlsx',
      file: {},
      shared: { scope: 'organization' },
      parentReference: { id: 'f1', path: '/drives/drv1/root:/Board pack' },
    },
  ],
  '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/drv1/root/delta?token=DELTA1',
};
export const deltaIncremental = {
  value: [{ id: 'it3', name: 'Q3.xlsx', deleted: { state: 'deleted' } }],
  '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/drv1/root/delta?token=DELTA2',
};

export const permissions: Record<string, unknown[]> = {
  it1: [
    { id: 'p-anon', roles: ['read'], link: { scope: 'anonymous', type: 'view' } },
    {
      id: 'p-owner',
      roles: ['owner'],
      grantedToV2: { siteGroup: { id: '3', displayName: 'Finance Owners' } },
      inheritedFrom: { id: 'root' },
    },
  ],
  it3: [
    { id: 'p-org', roles: ['read'], link: { scope: 'organization', type: 'view' } },
    {
      id: 'p-guest',
      roles: ['write'],
      link: { scope: 'users', type: 'edit' },
      grantedToIdentitiesV2: [
        { user: { id: 'g1', displayName: 'Gail Guest', email: 'gail@partner.com' } },
      ],
    },
  ],
};
