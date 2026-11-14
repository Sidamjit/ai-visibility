/** Server-only: classifier display names (from @aiv/content-scan + tenant custom classifiers). */
import { BUILTIN_CLASSIFIERS } from '@aiv/content-scan';
import type { Policy } from '@aiv/policy';

export function classifierNames(policy?: Policy | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of BUILTIN_CLASSIFIERS) out[c.id] = c.name;
  for (const c of policy?.classifiers.custom ?? []) out[c.id] = c.name;
  return out;
}

export function classifierCatalogue() {
  return BUILTIN_CLASSIFIERS.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    validation: c.validation,
  }));
}
