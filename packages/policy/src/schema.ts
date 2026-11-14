/**
 * The policy model: an organisation's data-classification and
 * information-management rules, in a form the analysis engine can evaluate.
 *
 * A policy has three parts:
 *   1. `levels`       — classification levels (e.g. NZ PSR: UNCLASSIFIED,
 *                       IN-CONFIDENCE, SENSITIVE, RESTRICTED) and, per level,
 *                       what handling is allowed: sharing, audience, labels,
 *                       retention and storage locations.
 *   2. `contentRules` — which detected content types (classifier ids) put a
 *                       file at which level ("3+ IRD numbers => IN-CONFIDENCE").
 *   3. `classifiers`  — which built-in detectors are switched off, and any
 *                       custom detectors (regex / keywords) the client adds.
 *
 * Clients edit this as YAML/JSON (Settings → Policy) or start from
 * `samples/nz-psr-sample.yaml`. See docs/POLICY_GUIDE.md.
 */
import { z } from 'zod';
import { CLASSIFIER_CATEGORIES } from '@aiv/core';

export const POLICY_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type PolicySeverity = (typeof POLICY_SEVERITIES)[number];

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'use letters, digits, ".", "_" or "-"');

/** Allowed exposure for content at a level. */
export const SharingPolicySchema = z.object({
  /** "Anyone with the link" (anonymous) links. */
  anyoneLinks: z.boolean().default(false),
  /** "People in <org>" links. */
  organizationLinks: z.boolean().default(false),
  /** External guests (B2B) via links, direct grants or site membership. */
  externalGuests: z.boolean().default(false),
  /** Public (org-wide joinable) M365 group sites. */
  publicSites: z.boolean().default(false),
  /** Max people who can reach the content (site members + specific grants). Null = unlimited. */
  maxAudience: z.number().int().positive().nullable().default(null),
});

/** Sensitivity-label requirement for a level. */
export const LabelPolicySchema = z.object({
  required: z.boolean().default(false),
  /** Accepted Purview label names (case-insensitive). Empty = any sensitive label. */
  acceptedLabels: z.array(z.string()).default([]),
  /** Minimum Purview label priority accepted (higher = more sensitive). */
  minimumPriority: z.number().int().nullable().default(null),
});

export const RETENTION_ACTIONS = ['review', 'archive', 'dispose'] as const;

/** Retention / disposal: content untouched longer than this breaches the policy. */
export const RetentionPolicySchema = z.object({
  /** Days since last modification. Null = no limit. */
  maxAgeDays: z.number().int().positive().nullable().default(null),
  action: z.enum(RETENTION_ACTIONS).default('review'),
  /** Authority/schedule reference shown in evidence, e.g. "GDA6 class 3.1". */
  reference: z.string().nullable().default(null),
});

/**
 * Where content at a level may be stored. Patterns are case-insensitive globs
 * ("*" = any characters) matched against the site NAME and the site URL.
 */
export const LocationPolicySchema = z.object({
  /** Empty = anywhere (subject to `blockedSitePatterns`). */
  allowedSitePatterns: z.array(z.string()).default([]),
  blockedSitePatterns: z.array(z.string()).default([]),
  /** Personal OneDrive storage permitted. */
  allowOneDrive: z.boolean().default(true),
  /** Owning departments permitted (empty = any). */
  allowedDepartments: z.array(z.string()).default([]),
});

export const LevelSchema = z.object({
  id,
  name: z.string().min(1),
  /** Higher = more sensitive. Unique across levels. */
  rank: z.number().int().min(0).max(100),
  description: z.string().default(''),
  /** Hex colour used in dashboards. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Severity of a handling breach (sharing/audience/location) at this level. */
  breachSeverity: z.enum(POLICY_SEVERITIES).default('medium'),
  sharing: SharingPolicySchema.prefault({}),
  labels: LabelPolicySchema.prefault({}),
  retention: RetentionPolicySchema.prefault({}),
  locations: LocationPolicySchema.prefault({}),
});
export type PolicyLevel = z.infer<typeof LevelSchema>;

/** Maps detected content to a level. ANY listed classifier meeting the thresholds triggers it. */
export const ContentRuleSchema = z.object({
  id,
  description: z.string().default(''),
  level: id,
  /** Classifier ids (built-in or custom). */
  classifiers: z.array(z.string().min(1)).min(1),
  /** Minimum matches of one classifier in a file. */
  minCount: z.number().int().positive().default(1),
  /** Minimum DISTINCT values (e.g. 5 different IRD numbers = a list of people). */
  minDistinct: z.number().int().positive().default(1),
  /** Ignore low-confidence matches unless this is 'low'. */
  minConfidence: z.enum(['low', 'medium', 'high']).default('medium'),
});
export type ContentRule = z.infer<typeof ContentRuleSchema>;

/** Client-defined detector. Either a regex, keywords, or both. */
export const CustomClassifierSchema = z
  .object({
    id,
    name: z.string().min(1),
    category: z.enum(CLASSIFIER_CATEGORIES).default('custom'),
    description: z.string().default(''),
    /** JavaScript regular expression source (no slashes). Matched globally. */
    pattern: z.string().max(500).optional(),
    /** Case-insensitive whole-word keywords / phrases. */
    keywords: z.array(z.string().min(2)).default([]),
    /** Optional built-in validator for regex matches. */
    validator: z.enum(['luhn', 'nz-ird', 'nz-bank', 'nz-nhi', 'au-tfn']).optional(),
    confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  })
  .refine((c) => Boolean(c.pattern) || c.keywords.length > 0, {
    message: 'a custom classifier needs a pattern or keywords',
  })
  .refine(
    (c) => {
      if (!c.pattern) return true;
      try {
        new RegExp(c.pattern, 'g');
        return true;
      } catch {
        return false;
      }
    },
    { message: 'pattern is not a valid regular expression' },
  );
export type CustomClassifier = z.infer<typeof CustomClassifierSchema>;

export const ClassifierConfigSchema = z.object({
  /** Built-in classifier ids to switch off. */
  disabled: z.array(z.string()).default([]),
  custom: z.array(CustomClassifierSchema).default([]),
});
export type ClassifierConfig = z.infer<typeof ClassifierConfigSchema>;

export const PolicySchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    name: z.string().min(1),
    /** Organisation / owner of the policy (shown in reports). */
    owner: z.string().default(''),
    version: z.string().default('1.0'),
    /** Source documents this policy was derived from (titles/refs, not content). */
    sources: z.array(z.string()).default([]),
    levels: z.array(LevelSchema).min(1),
    /** Level for scanned files that match no content rule. */
    defaultLevel: id,
    contentRules: z.array(ContentRuleSchema).default([]),
    classifiers: ClassifierConfigSchema.prefault({}),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    const ranks = new Set<number>();
    p.levels.forEach((l, i) => {
      if (ids.has(l.id))
        ctx.addIssue({ code: 'custom', path: ['levels', i, 'id'], message: 'duplicate level id' });
      if (ranks.has(l.rank))
        ctx.addIssue({ code: 'custom', path: ['levels', i, 'rank'], message: 'duplicate rank' });
      ids.add(l.id);
      ranks.add(l.rank);
    });
    if (!ids.has(p.defaultLevel))
      ctx.addIssue({ code: 'custom', path: ['defaultLevel'], message: 'unknown level' });
    p.contentRules.forEach((r, i) => {
      if (!ids.has(r.level))
        ctx.addIssue({
          code: 'custom',
          path: ['contentRules', i, 'level'],
          message: `unknown level "${r.level}"`,
        });
    });
  });
export type Policy = z.infer<typeof PolicySchema>;
/** What clients write (defaults may be omitted). */
export type PolicyInput = z.input<typeof PolicySchema>;
