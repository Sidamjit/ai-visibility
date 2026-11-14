/**
 * Import/export of policies as YAML or JSON, with friendly validation errors
 * for the Settings → Policy editor and the CLI.
 */
import { parse, stringify } from 'yaml';
import { PolicySchema, type Policy, type PolicyInput } from './schema';

export type ParsePolicyResult =
  { ok: true; policy: Policy; warnings: string[] } | { ok: false; errors: string[] };

/** Parse YAML or JSON text (JSON is valid YAML) into a validated policy. */
export function parsePolicy(
  text: string,
  knownClassifierIds?: readonly string[],
): ParsePolicyResult {
  let raw: unknown;
  try {
    raw = parse(text, { maxAliasCount: 50 });
  } catch (err) {
    return { ok: false, errors: [`Not valid YAML/JSON: ${(err as Error).message}`] };
  }
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return {
    ok: true,
    policy: parsed.data,
    warnings: knownClassifierIds ? lintPolicy(parsed.data, knownClassifierIds) : [],
  };
}

/** Non-fatal problems: rules that reference classifiers that do not exist or are disabled. */
export function lintPolicy(policy: Policy, builtinClassifierIds: readonly string[]): string[] {
  const available = new Set([
    ...builtinClassifierIds.filter((id) => !policy.classifiers.disabled.includes(id)),
    ...policy.classifiers.custom.map((c) => c.id),
  ]);
  const warnings: string[] = [];
  for (const rule of policy.contentRules) {
    for (const id of rule.classifiers) {
      if (!available.has(id))
        warnings.push(
          `Content rule "${rule.id}" uses classifier "${id}", which is unknown or disabled.`,
        );
    }
  }
  for (const id of policy.classifiers.disabled) {
    if (!builtinClassifierIds.includes(id))
      warnings.push(`Disabled classifier "${id}" is not a built-in id.`);
  }
  return warnings;
}

/** Serialise for the editor / download. */
export function policyToYaml(policy: Policy | PolicyInput): string {
  return stringify(policy, { lineWidth: 100 });
}
