import type { ClassifierConfig } from '@aiv/policy';
import { BUILTIN_CLASSIFIERS } from './builtin';
import { customClassifier } from './custom';
import type { Classifier } from './types';

/** Active classifiers for a tenant: built-ins minus `disabled`, plus custom ones. */
export function buildClassifiers(config: ClassifierConfig | null | undefined): Classifier[] {
  const disabled = new Set(config?.disabled ?? []);
  return [
    ...BUILTIN_CLASSIFIERS.filter((c) => !disabled.has(c.id)),
    ...(config?.custom ?? []).map(customClassifier),
  ];
}
