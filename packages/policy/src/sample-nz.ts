/**
 * Sample policy modelled on the New Zealand Government Protective Security
 * Requirements (PSR) classification system, plus common NZ information
 * management practice (Public Records Act retention, Privacy Act 2020).
 *
 * It is a STARTING POINT for a client workshop, not legal advice. Every value
 * (label names, audience caps, retention periods, allowed sites) should be
 * confirmed with the client's information-management and privacy owners.
 *
 * The same policy is published as YAML in `samples/nz-psr-sample.yaml`
 * (a test keeps the two identical).
 */
import type { PolicyInput } from './schema';

const SEVEN_YEARS = 7 * 365;

export const NZ_PSR_SAMPLE_POLICY: PolicyInput = {
  schemaVersion: 1,
  name: 'NZ PSR-style data classification policy (sample)',
  owner: 'Information Management & Privacy',
  version: '1.0-sample',
  sources: [
    'NZ Protective Security Requirements - classification system (protectivesecurity.govt.nz)',
    'Privacy Act 2020 - Information Privacy Principles 5 and 9',
    'Public Records Act 2005 / General Disposal Authorities',
  ],
  defaultLevel: 'UNCLASSIFIED',
  levels: [
    {
      id: 'UNCLASSIFIED',
      name: 'Unclassified',
      rank: 0,
      description: 'Information that would cause no harm if released. Normal sharing rules apply.',
      color: '#64748b',
      breachSeverity: 'info',
      sharing: {
        anyoneLinks: true,
        organizationLinks: true,
        externalGuests: true,
        publicSites: true,
        maxAudience: null,
      },
      labels: { required: false, acceptedLabels: [], minimumPriority: null },
      retention: { maxAgeDays: null, action: 'review', reference: null },
      locations: {
        allowedSitePatterns: [],
        blockedSitePatterns: [],
        allowOneDrive: true,
        allowedDepartments: [],
      },
    },
    {
      id: 'IN-CONFIDENCE',
      name: 'In-Confidence',
      rank: 10,
      description:
        "Personal or commercial information whose release could prejudice privacy, commercial position or relationships (e.g. one person's IRD or bank details, HR correspondence).",
      color: '#0ea5e9',
      breachSeverity: 'medium',
      sharing: {
        anyoneLinks: false,
        organizationLinks: true,
        externalGuests: true,
        publicSites: true,
        maxAudience: null,
      },
      labels: { required: true, acceptedLabels: [], minimumPriority: 2 },
      retention: { maxAgeDays: SEVEN_YEARS, action: 'review', reference: 'GDA6 - 7 years' },
      locations: {
        allowedSitePatterns: [],
        blockedSitePatterns: ['*public*', '*all staff*', '*intranet*'],
        allowOneDrive: true,
        allowedDepartments: [],
      },
    },
    {
      id: 'SENSITIVE',
      name: 'Sensitive',
      rank: 20,
      description:
        'Bulk personal information, identity documents, payment card data, credentials or health information - serious harm to people or the organisation if released.',
      color: '#f59e0b',
      breachSeverity: 'high',
      sharing: {
        anyoneLinks: false,
        organizationLinks: false,
        externalGuests: false,
        publicSites: false,
        maxAudience: 250,
      },
      labels: { required: true, acceptedLabels: [], minimumPriority: 2 },
      retention: { maxAgeDays: SEVEN_YEARS, action: 'dispose', reference: 'GDA6 - 7 years' },
      locations: {
        allowedSitePatterns: [],
        blockedSitePatterns: ['*public*', '*all staff*', '*intranet*', '*social*'],
        allowOneDrive: false,
        allowedDepartments: [],
      },
    },
    {
      id: 'RESTRICTED',
      name: 'Restricted',
      rank: 30,
      description:
        'Information whose release would cause serious damage: bulk health records, legally privileged advice, board-only material.',
      color: '#dc2626',
      breachSeverity: 'critical',
      sharing: {
        anyoneLinks: false,
        organizationLinks: false,
        externalGuests: false,
        publicSites: false,
        maxAudience: 50,
      },
      labels: { required: true, acceptedLabels: [], minimumPriority: 3 },
      retention: { maxAgeDays: SEVEN_YEARS, action: 'review', reference: 'Legal hold check' },
      locations: {
        allowedSitePatterns: ['*legal*', '*board*', '*executive*', '*health*', '*people*', '*hr*'],
        blockedSitePatterns: [],
        allowOneDrive: false,
        allowedDepartments: [],
      },
    },
  ],
  contentRules: [
    {
      id: 'bulk-health',
      description: 'Health records for many people (10+ distinct NHI numbers).',
      level: 'RESTRICTED',
      classifiers: ['nz-nhi'],
      minCount: 1,
      minDistinct: 10,
      minConfidence: 'medium',
    },
    {
      id: 'legal-privilege',
      description: 'Legally privileged advice (custom keyword classifier).',
      level: 'RESTRICTED',
      classifiers: ['legal-privilege'],
      minCount: 1,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'health-info',
      description: 'Any NHI number or repeated health terms.',
      level: 'SENSITIVE',
      classifiers: ['nz-nhi', 'health-information'],
      minCount: 3,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'bulk-tax-or-bank',
      description: 'Lists of IRD, TFN or bank account numbers (5+ distinct values).',
      level: 'SENSITIVE',
      classifiers: ['nz-ird-number', 'nz-bank-account', 'au-tfn'],
      minCount: 1,
      minDistinct: 5,
      minConfidence: 'medium',
    },
    {
      id: 'identity-documents',
      description: 'Passport or driver licence numbers.',
      level: 'SENSITIVE',
      classifiers: ['nz-passport', 'nz-driver-licence'],
      minCount: 1,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'payment-cards',
      description: 'Payment card numbers (PCI DSS scope).',
      level: 'SENSITIVE',
      classifiers: ['credit-card'],
      minCount: 1,
      minDistinct: 1,
      minConfidence: 'high',
    },
    {
      id: 'credentials',
      description: 'Passwords, API keys, private keys or connection strings.',
      level: 'SENSITIVE',
      classifiers: ['secret-credential'],
      minCount: 1,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'individual-tax-or-bank',
      description: "An individual's IRD, TFN or bank account number.",
      level: 'IN-CONFIDENCE',
      classifiers: ['nz-ird-number', 'nz-bank-account', 'au-tfn'],
      minCount: 1,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'personal-info',
      description: 'Personal information such as date of birth, home address, next of kin.',
      level: 'IN-CONFIDENCE',
      classifiers: ['personal-information'],
      minCount: 2,
      minDistinct: 1,
      minConfidence: 'medium',
    },
    {
      id: 'contact-lists',
      description: 'Contact lists (20+ distinct emails or phone numbers).',
      level: 'IN-CONFIDENCE',
      classifiers: ['email-address', 'phone-number'],
      minCount: 1,
      minDistinct: 20,
      minConfidence: 'medium',
    },
  ],
  classifiers: {
    disabled: [],
    custom: [
      {
        id: 'legal-privilege',
        name: 'Legal privilege marking',
        category: 'custom',
        description: 'Documents marked as legally privileged.',
        keywords: [
          'legally privileged',
          'subject to legal privilege',
          'privileged and confidential',
        ],
        confidence: 'high',
      },
    ],
  },
};
