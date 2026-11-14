/**
 * Built-in classifiers. Each one documents its pattern and validation. IDs are
 * stable: policies reference them (see packages/policy sample).
 *
 * Confidence guide:
 *   high   — checksum/structure validated AND distinctive (or explicit context)
 *   medium — validated, or distinctive pattern with supporting context
 *   low    — pattern only; policies ignore these unless minConfidence: low
 */
import type { Classifier, RawMatch } from './types';
import { closestPrecedingContext, keywordRegExp, match, matchAll, nearby } from './helpers';

const ID_DOC_CONTEXT = {
  passport: /passport/i,
  licence: /(driver'?s?|driving)\s*licen[cs]e|\bDL\s*(no|number|#)/i,
};
import {
  auTfnValid,
  looksLikeCardNumber,
  luhnValid,
  nzBankAccountValid,
  nzIrdValid,
  nzNhiValid,
} from '../validators';

const digits = (s: string) => s.replace(/\D/g, '');

export const nzIrdClassifier: Classifier = {
  id: 'nz-ird-number',
  name: 'NZ IRD number',
  category: 'government-id',
  description:
    'New Zealand Inland Revenue (tax) numbers, 8–9 digits, optionally formatted 123-456-789.',
  validation: 'IRD mod-11 check digit with secondary weights; range 10,000,000–150,000,000.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /(?<![\d-])(\d{2,3})[- ]?(\d{3})[- ]?(\d{3})(?![\d-])/g)) {
      const value = digits(m[0]);
      if (!nzIrdValid(value)) continue;
      const context = nearby(
        text,
        m.index,
        m[0].length,
        /\b(IRD|tax (file )?(no|number)|GST|inland revenue)\b/i,
      );
      const formatted = /[- ]/.test(m[0]);
      out.push(match(m, value, context ? 'high' : formatted ? 'medium' : 'low'));
    }
    return out;
  },
};

export const nzBankAccountClassifier: Classifier = {
  id: 'nz-bank-account',
  name: 'NZ bank account number',
  category: 'financial',
  description: 'NZ bank account numbers written as BB-bbbb-AAAAAAA-SS(S).',
  validation:
    'Inland Revenue bank-account modulus algorithms (A, B, D, E, F, G, X) and bank id list.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(
      text,
      /(?<![\d-])(\d{2})[- ](\d{4})[- ](\d{7,8})[- ](\d{2,4})(?![\d-])/g,
    )) {
      if (!nzBankAccountValid(m[1]!, m[2]!, m[3]!, m[4]!)) continue;
      out.push(match(m, digits(m[0]), 'high'));
    }
    return out;
  },
};

export const nzNhiClassifier: Classifier = {
  id: 'nz-nhi',
  name: 'NZ National Health Index (NHI) number',
  category: 'health',
  description: 'NHI numbers in the legacy (AAANNNC) and expanded (AAANNAX) formats.',
  validation: 'HISO 10046 check character (mod 11 legacy, mod 23 expanded).',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /\b[A-HJ-NP-Z]{3}(?:\d{4}|\d{2}[A-HJ-NP-Z]{2})\b/g)) {
      if (!nzNhiValid(m[0])) continue;
      const context = nearby(
        text,
        m.index,
        m[0].length,
        /\b(NHI|national health index|patient)\b/i,
      );
      out.push(match(m, m[0], context ? 'high' : 'medium'));
    }
    return out;
  },
};

export const nzPassportClassifier: Classifier = {
  id: 'nz-passport',
  name: 'NZ passport number',
  category: 'government-id',
  description: 'NZ passport numbers (1–2 letters + 6 digits) preceded by the word "passport".',
  validation: 'Format plus required "passport" context (no public check digit).',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /\b[A-Z]{1,2}\d{6}\b/g)) {
      if (closestPrecedingContext(text, m.index, ID_DOC_CONTEXT) !== 'passport') continue;
      out.push(match(m, m[0], 'high'));
    }
    return out;
  },
};

export const nzDriverLicenceClassifier: Classifier = {
  id: 'nz-driver-licence',
  name: 'NZ driver licence number',
  category: 'government-id',
  description: 'NZ driver licence numbers (2 letters + 6 digits) near licence wording.',
  validation: 'Format plus required licence context (no public check digit).',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /\b[A-Z]{2}\d{6}\b/g)) {
      if (closestPrecedingContext(text, m.index, ID_DOC_CONTEXT) !== 'licence') continue;
      out.push(match(m, m[0], 'high'));
    }
    return out;
  },
};

export const creditCardClassifier: Classifier = {
  id: 'credit-card',
  name: 'Payment card number',
  category: 'financial',
  description: 'Visa, Mastercard, Amex, Discover, JCB and Diners card numbers (PCI DSS scope).',
  validation: 'Issuer prefix (IIN) and Luhn check digit.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)) {
      const value = digits(m[0]);
      if (!looksLikeCardNumber(value) || !luhnValid(value)) continue;
      out.push(match(m, value, 'high'));
    }
    return out;
  },
};

export const auTfnClassifier: Classifier = {
  id: 'au-tfn',
  name: 'Australian Tax File Number',
  category: 'government-id',
  description: 'Australian TFNs (8–9 digits, often 123 456 782).',
  validation: 'ATO weighted mod-11 check; high confidence only with "TFN"/"tax file" context.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(text, /(?<![\d-])\d{3} ?\d{3} ?\d{2,3}(?![\d-])/g)) {
      const value = digits(m[0]);
      if (!auTfnValid(value)) continue;
      const context = nearby(text, m.index, m[0].length, /\b(TFN|tax file)\b/i);
      out.push(match(m, value, context ? 'high' : 'low'));
    }
    return out;
  },
};

export const emailClassifier: Classifier = {
  id: 'email-address',
  name: 'Email address',
  category: 'contact',
  description: 'Email addresses (contact lists, exports).',
  validation: 'RFC-style pattern with a dotted domain.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    for (const m of matchAll(
      text,
      /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b/g,
    ))
      out.push(match(m, m[0].toLowerCase(), 'high'));
    return out;
  },
};

export const phoneClassifier: Classifier = {
  id: 'phone-number',
  name: 'Phone number (NZ/AU)',
  category: 'contact',
  description: 'NZ mobile/landline and Australian mobile numbers, local or +64/+61 format.',
  validation: 'Numbering-plan prefixes and lengths.',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    const re =
      /(?<![\d+-])(?:(?:\+?64[ -]?|0)(?:2[0-9][ -]?\d{3}[ -]?\d{3,5}|[34679][ -]?\d{3}[ -]?\d{4})|(?:\+?61[ -]?|0)4\d{2}[ -]?\d{3}[ -]?\d{3})(?!\d)/g;
    for (const m of matchAll(text, re))
      out.push(match(m, digits(m[0]).replace(/^(64|61)/, '0'), 'medium'));
    return out;
  },
};

/** Patterns for credentials. Each entry: [label, regex, confidence]. */
const SECRET_PATTERNS: Array<[string, RegExp, 'high' | 'medium']> = [
  [
    'private key',
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    'high',
  ],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'high'],
  ['Azure storage key', /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/g, 'high'],
  ['Entra client secret', /\b[A-Za-z0-9_~.-]{3}8Q~[A-Za-z0-9_~.-]{31,34}\b/g, 'high'],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, 'high'],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, 'high'],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g, 'high'],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'high'],
  ['connection-string password', /\b(?:Password|Pwd)\s*=\s*[^;\s'"]{4,}/gi, 'medium'],
  [
    'API key / client secret assignment',
    /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-.~+/]{16,}/gi,
    'medium',
  ],
  [
    'password in text',
    /\b(?:password|passwd|passcode|pwd)\b\s*(?:is|:|=|-)\s*["']?[^\s"'<>]{6,}/gi,
    'medium',
  ],
];
const PLACEHOLDER =
  /(\*{3,}|x{4,}|<[^>]*>|\{\{|\$\{|changeme|example|placeholder|redacted|your[_-]?password)/i;

export const secretClassifier: Classifier = {
  id: 'secret-credential',
  name: 'Passwords, keys & secrets',
  category: 'credential',
  description:
    'Private keys, cloud access keys, tokens, connection-string passwords and written-down passwords.',
  validation:
    'Vendor-specific token formats (high) or assignment patterns with placeholder filtering (medium).',
  builtin: true,
  detect(text) {
    const out: RawMatch[] = [];
    const seen = new Set<number>();
    for (const [label, re, confidence] of SECRET_PATTERNS) {
      for (const m of matchAll(text, re)) {
        if (seen.has(m.index) || PLACEHOLDER.test(m[0])) continue;
        seen.add(m.index);
        out.push({ value: `${label}:${m[0]}`, index: m.index, length: m[0].length, confidence });
      }
    }
    return out;
  },
};

const HEALTH_TERMS = [
  'diagnosis',
  'diagnosed',
  'prognosis',
  'prescription',
  'prescribed',
  'medication',
  'medical certificate',
  'medical condition',
  'medical history',
  'mental health',
  'depression',
  'anxiety disorder',
  'psychiatric',
  'psychologist',
  'counselling',
  'ACC claim',
  'injury claim',
  'disability',
  'pregnancy',
  'HIV',
  'cancer',
  'diabetes',
  'surgery',
  'hospital admission',
  'discharge summary',
  'clinical notes',
  'allergies',
  'immunisation',
  'vaccination status',
  'sick leave',
  'drug test',
  'alcohol test',
];
const HEALTH_RE = keywordRegExp(HEALTH_TERMS);

export const healthClassifier: Classifier = {
  id: 'health-information',
  name: 'Health information terms',
  category: 'health',
  description:
    'Medical, mental-health, ACC and treatment terminology (Health Information Privacy Code 2020).',
  validation: 'Whole-word keyword list; each occurrence counts, distinct = distinct terms.',
  builtin: true,
  detect(text) {
    return [...matchAll(text, HEALTH_RE)].map((m) => match(m, m[0].toLowerCase(), 'medium'));
  },
};

const PERSONAL_TERMS = [
  'date of birth',
  'DOB',
  'home address',
  'residential address',
  'next of kin',
  'emergency contact',
  'marital status',
  'ethnicity',
  'iwi affiliation',
  'religion',
  'religious belief',
  'sexual orientation',
  'gender identity',
  'criminal conviction',
  'criminal record',
  'police vetting',
  'immigration status',
  'visa status',
  'maiden name',
  'place of birth',
  'salary',
  'disciplinary',
  'performance improvement plan',
];
const PERSONAL_RE = keywordRegExp(PERSONAL_TERMS);
const DOB_RE =
  /\b(?:DOB|date of birth|born)\b\s*[:-]?\s*\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/gi;

export const personalInfoClassifier: Classifier = {
  id: 'personal-information',
  name: 'Personal information terms',
  category: 'personal',
  description:
    'Privacy Act 2020 personal information indicators: dates of birth, addresses, next of kin, ethnicity, convictions.',
  validation: 'Keyword list (medium) and labelled dates of birth (high).',
  builtin: true,
  detect(text) {
    const out = [...matchAll(text, PERSONAL_RE)].map((m) =>
      match(m, m[0].toLowerCase(), 'medium' as const),
    );
    for (const m of matchAll(text, DOB_RE)) out.push(match(m, m[0].toLowerCase(), 'high'));
    return out;
  },
};

/** All built-in classifiers, in catalogue order. */
export const BUILTIN_CLASSIFIERS: readonly Classifier[] = [
  nzIrdClassifier,
  nzBankAccountClassifier,
  nzDriverLicenceClassifier,
  nzPassportClassifier,
  nzNhiClassifier,
  creditCardClassifier,
  auTfnClassifier,
  emailClassifier,
  phoneClassifier,
  secretClassifier,
  healthClassifier,
  personalInfoClassifier,
];

export const BUILTIN_CLASSIFIER_IDS: readonly string[] = BUILTIN_CLASSIFIERS.map((c) => c.id);
