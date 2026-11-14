/**
 * Client-defined classifiers from the policy (`classifiers.custom`).
 * Regexes come from the client's own administrators and run inside the
 * client's environment; text is capped before custom regexes run.
 */
import type { CustomClassifier } from '@aiv/policy';
import { auTfnValid, luhnValid, nzIrdValid, nzNhiValid } from '../validators';
import { keywordRegExp, match, matchAll } from './helpers';
import type { Classifier, RawMatch } from './types';

const CUSTOM_REGEX_TEXT_CAP = 500_000;

const VALIDATORS: Record<NonNullable<CustomClassifier['validator']>, (v: string) => boolean> = {
  luhn: luhnValid,
  'nz-ird': nzIrdValid,
  'nz-nhi': nzNhiValid,
  'au-tfn': auTfnValid,
  'nz-bank': (v) => {
    const d = v.replace(/\D/g, '');
    return d.length >= 15 && d.length <= 18;
  },
};

export function customClassifier(def: CustomClassifier): Classifier {
  const pattern = def.pattern ? new RegExp(def.pattern, 'g') : null;
  const keywords = def.keywords.length ? keywordRegExp(def.keywords) : null;
  const validate = def.validator ? VALIDATORS[def.validator] : null;
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    description: def.description,
    validation: [
      pattern ? 'custom pattern' : null,
      keywords ? `${def.keywords.length} keyword(s)` : null,
      def.validator ? `validator: ${def.validator}` : null,
    ]
      .filter(Boolean)
      .join(', '),
    builtin: false,
    detect(text) {
      const capped =
        text.length > CUSTOM_REGEX_TEXT_CAP ? text.slice(0, CUSTOM_REGEX_TEXT_CAP) : text;
      const out: RawMatch[] = [];
      if (pattern)
        for (const m of matchAll(capped, pattern)) {
          if (validate && !validate(m[0])) continue;
          out.push(match(m, m[0], def.confidence));
        }
      if (keywords)
        for (const m of matchAll(capped, keywords))
          out.push(match(m, m[0].toLowerCase(), def.confidence));
      return out;
    },
  };
}
