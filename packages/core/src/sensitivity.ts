/**
 * Metadata-only sensitivity heuristics.
 *
 * We NEVER read file contents. Instead, names of sites/folders/files are matched
 * against keyword patterns that commonly indicate personal, financial, HR, legal
 * or health information. This is a triage signal, not a classifier: findings
 * that rely on it say so in their evidence, and the fix is always "label it
 * properly with Purview" so the signal is replaced by a real label over time.
 */
export const SENSITIVE_NAME_PATTERNS: ReadonlyArray<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'payroll / salary',
    pattern: /\b(payroll|salar(y|ies)|remuneration|pay ?slips?|bonus)\b/i,
  },
  {
    reason: 'HR / personnel',
    pattern:
      /\b(hr|human resources|personnel|disciplinary|grievance|performance review|recruit\w*|cvs?|resumes?)\b/i,
  },
  {
    reason: 'identity documents',
    pattern: /\b(passports?|driver'?s? licen[cs]e|ird|ssn|tax file|national id)\b/i,
  },
  {
    reason: 'financial',
    pattern: /\b(bank|iban|credit card|invoices?|budget|forecast|board pack|financials?|audit)\b/i,
  },
  {
    reason: 'legal / contracts',
    pattern: /\b(contracts?|legal|nda|litigation|settlement|privileged)\b/i,
  },
  {
    reason: 'health / medical',
    pattern: /\b(medical|health records?|patient|clinical|sick leave|wellbeing case)\b/i,
  },
  {
    reason: 'security / credentials',
    pattern: /\b(passwords?|credentials?|secrets?|keys?|vpn config)\b/i,
  },
  {
    reason: 'explicitly confidential',
    pattern: /\b(confidential|restricted|private|do not share|internal only)\b/i,
  },
  {
    reason: 'customer personal data',
    pattern: /\b(customer (data|list|records)|crm export|pii|personal data|mailing list)\b/i,
  },
];

/** Returns human-readable reasons why `name` looks sensitive (empty array = no signal). */
export function sensitiveNameReasons(name: string): string[] {
  const normalized = name.replace(/[_\-.]+/g, ' ');
  return SENSITIVE_NAME_PATTERNS.filter((p) => p.pattern.test(normalized)).map((p) => p.reason);
}
