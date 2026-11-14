/**
 * Demo content-scan results for Harbourview Group.
 *
 * In a real deployment these come from `@aiv/content-scan` reading files in
 * the client's environment. Here we describe WHAT the scanner would have found
 * in each demo file (classifier counts only — there is no demo file content),
 * plus "hidden" files whose innocent names give no metadata signal at all.
 * This is the point of content scanning: names don't reveal "Scan 0042.pdf"
 * holds 120 IRD numbers.
 */
import type { ClassifierHit, ClassifierCategory, ContentScan } from '@aiv/core';
import type { Random } from './random';

type Profile = Array<[classifierId: string, count: number, distinct?: number]>;

const CATEGORY: Record<string, ClassifierCategory> = {
  'nz-ird-number': 'government-id',
  'nz-bank-account': 'financial',
  'nz-driver-licence': 'government-id',
  'nz-passport': 'government-id',
  'nz-nhi': 'health',
  'credit-card': 'financial',
  'au-tfn': 'government-id',
  'email-address': 'contact',
  'phone-number': 'contact',
  'secret-credential': 'credential',
  'health-information': 'health',
  'personal-information': 'personal',
  'legal-privilege': 'custom',
};

/** Redacted example snippets (as produced with snippet mode "redacted"). */
const SNIPPETS: Record<string, string[]> = {
  'nz-ird-number': ['…Employee «PERSONAL-INFORMATION» IRD «NZ-IRD-NUMBER» tax code M…'],
  'nz-bank-account': ['…pay to account «NZ-BANK-ACCOUNT» ref ###…'],
  'secret-credential': ['…svc-backup «SECRET-CREDENTIAL» (rotate quarterly)…'],
  'credit-card': ['…card «CREDIT-CARD» exp ##/## refund approved…'],
  'nz-nhi': ['…patient NHI «NZ-NHI» admitted after site incident…'],
  'nz-driver-licence': ['…driver «NZ-DRIVER-LICENCE» class 2 expires ####…'],
  'legal-privilege': ['…«LEGAL-PRIVILEGE» — prepared for the purpose of litigation…'],
};

/** What the scanner finds in named demo files (by file name). */
export const CONTENT_PROFILES: Record<string, Profile> = {
  'Salary bands 2025.xlsx': [['personal-information', 8, 2]],
  'Restructure proposal - confidential.docx': [
    ['personal-information', 14, 5],
    ['health-information', 2, 2],
  ],
  'Org chart.pdf': [
    ['email-address', 410, 410],
    ['phone-number', 380, 380],
  ],
  'Payroll exports 2024.csv': [
    ['nz-ird-number', 186, 186],
    ['nz-bank-account', 186, 186],
    ['personal-information', 3, 2],
  ],
  'Bank statements 2018.pdf': [['nz-bank-account', 44, 12]],
  'Sick leave register.xlsx': [
    ['health-information', 64, 11],
    ['personal-information', 18, 3],
  ],
  'Salary review 2024.xlsx': [
    ['nz-ird-number', 37, 37],
    ['personal-information', 12, 2],
  ],
  'Customer list export.csv': [
    ['email-address', 2410, 2390],
    ['phone-number', 2104, 2088],
  ],
  'Mailing list export.csv': [['email-address', 5120, 5120]],
  'Attendee list with dietary needs.xlsx': [
    ['email-address', 312, 312],
    ['health-information', 47, 6],
  ],
  'Complaint register.xlsx': [
    ['email-address', 402, 398],
    ['phone-number', 381, 377],
    ['personal-information', 21, 4],
  ],
  'Privacy breach log.xlsx': [
    ['personal-information', 31, 6],
    ['nz-ird-number', 4, 4],
  ],
  'Service account passwords.xlsx': [['secret-credential', 48, 48]],
  'Contracts register.xlsx': [['legal-privilege', 3, 2]],
  'Training records.xlsx': [['nz-driver-licence', 86, 86]],
  'Bank details for suppliers.xlsx': [
    ['nz-bank-account', 142, 142],
    ['email-address', 140, 138],
  ],
  'Board pack Q3.pdf': [['legal-privilege', 2, 1]],
  'CEO remuneration.docx': [
    ['nz-ird-number', 1, 1],
    ['nz-bank-account', 1, 1],
    ['personal-information', 4, 3],
  ],
  'Commission plan.xlsx': [['personal-information', 2, 1]],
  'Employee handbook.pdf': [['email-address', 6, 4]],
};

/** Files with innocuous names that hold sensitive content. [site, name, profile, ageDays?] */
export const HIDDEN_FILES: Array<[site: string, name: string, profile: Profile, ageDays?: number]> =
  [
    ['Harbourview Intranet', 'IT onboarding guide.docx', [['secret-credential', 3, 2]]],
    [
      'Operations',
      'Fleet list.xlsx',
      [
        ['nz-driver-licence', 61, 61],
        ['phone-number', 58, 58],
      ],
    ],
    [
      'Health & Safety',
      'Incident summary 2017.docx',
      [
        ['nz-nhi', 14, 14],
        ['health-information', 42, 9],
      ],
      3_150,
    ],
    [
      'Finance Archive',
      'Scan 0042.pdf',
      [
        ['nz-ird-number', 121, 121],
        ['nz-bank-account', 118, 118],
      ],
      3_050,
    ],
    [
      'IT Projects Archive',
      'migration-notes.txt',
      [
        ['secret-credential', 12, 9],
        ['email-address', 8, 6],
      ],
    ],
    [
      'Project Borealis (closed)',
      'Data extract.csv',
      [
        ['nz-ird-number', 904, 904],
        ['email-address', 910, 905],
        ['personal-information', 904, 1],
      ],
    ],
    ['Sales Hub', 'Deal desk notes.docx', [['credit-card', 3, 3]]],
    [
      'Customer Service',
      'Refund requests.xlsx',
      [
        ['credit-card', 57, 55],
        ['email-address', 60, 58],
      ],
    ],
    ['Risk & Compliance', 'Advice summary.docx', [['legal-privilege', 2, 1]]],
    ['Legal', 'Advice - Smith matter.docx', [['legal-privilege', 6, 2]]],
    [
      'People & Culture',
      'Team notes.docx',
      [
        ['nz-passport', 9, 9],
        ['personal-information', 12, 4],
      ],
    ],
    [
      'Key Accounts',
      'Client onboarding.xlsx',
      [
        ['au-tfn', 7, 7],
        ['nz-ird-number', 6, 6],
      ],
    ],
  ];

const EXT_SIZE: Record<string, [number, number]> = {
  pdf: [80_000, 6_000_000],
  xlsx: [20_000, 3_000_000],
  docx: [15_000, 900_000],
  csv: [5_000, 9_000_000],
  txt: [1_000, 60_000],
  pptx: [200_000, 12_000_000],
};

const hex = (r: Random) =>
  Array.from({ length: 64 }, () => '0123456789abcdef'[r.int(0, 15)]).join('');

export function ext(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

function hitsFor(profile: Profile, snippets: boolean): ClassifierHit[] {
  return profile.map(([classifierId, count, distinct]) => ({
    classifierId,
    category: CATEGORY[classifierId] ?? 'custom',
    count,
    distinctValues: distinct ?? count,
    confidence: classifierId.endsWith('information') ? 'medium' : 'high',
    snippets: snippets ? (SNIPPETS[classifierId] ?? []) : [],
  }));
}

/** A scanned demo file (status 'scanned'). */
export function demoScan(
  r: Random,
  opts: {
    locationExternalId: string;
    siteExternalId: string;
    name: string;
    asOfMs: number;
    profile: Profile | null;
  },
): ContentScan {
  const e = ext(opts.name);
  const [min, max] = EXT_SIZE[e] ?? [10_000, 500_000];
  const size = r.int(min, max);
  const sha = hex(r);
  return {
    locationExternalId: opts.locationExternalId,
    siteExternalId: opts.siteExternalId,
    extension: e,
    sizeBytes: size,
    contentSha256: sha,
    sourceVersion: `c-${sha.slice(0, 12)}`,
    scannedAt: new Date(opts.asOfMs - r.int(1, 36) * 3_600_000).toISOString(),
    status: 'scanned',
    statusReason: null,
    textChars: Math.round(size / r.int(6, 30)),
    hits: opts.profile ? hitsFor(opts.profile, true) : [],
    llm: null,
  };
}

/**
 * Background files with no findings (coverage numbers), plus a few skipped
 * (too large) and failed (encrypted) files, per site. No locations are emitted
 * for these: the app stores nothing about unremarkable files except the scan row.
 */
export function backgroundScans(r: Random, siteId: string, asOfMs: number): ContentScan[] {
  const out: ContentScan[] = [];
  const names = [
    'Notes.docx',
    'Minutes.docx',
    'Tracker.xlsx',
    'Slides.pptx',
    'Report.pdf',
    'Data.csv',
  ];
  const n = r.int(30, 160);
  for (let i = 0; i < n; i++) {
    const scan = demoScan(r, {
      locationExternalId: `${siteId}-bg-${i + 1}`,
      siteExternalId: siteId,
      name: r.pick(names),
      asOfMs,
      profile: null,
    });
    const roll = r.next();
    if (roll < 0.012)
      out.push({
        ...scan,
        status: 'skipped',
        statusReason: 'larger than 25 MB',
        textChars: 0,
        contentSha256: null,
        sizeBytes: r.int(26, 400) * 1_048_576,
      });
    else if (roll < 0.02)
      out.push({
        ...scan,
        status: 'failed',
        statusReason: 'encrypted: Encrypted (IRM/password) or legacy Office file',
        textChars: 0,
      });
    else out.push(scan);
  }
  return out;
}
