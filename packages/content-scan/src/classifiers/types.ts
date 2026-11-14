import type { ClassifierCategory, Confidence } from '@aiv/core';

/** One raw match inside extracted text. Lives only in memory during a scan. */
export interface RawMatch {
  /** Matched value (normalised). Used only for in-memory distinct counting and redaction. */
  value: string;
  index: number;
  length: number;
  confidence: Confidence;
}

/**
 * A detector for one kind of sensitive information.
 * `detect` must be pure, synchronous and linear-time on its input.
 */
export interface Classifier {
  id: string;
  name: string;
  category: ClassifierCategory;
  description: string;
  /** How matches are validated (shown in the UI classifier catalogue). */
  validation: string;
  builtin: boolean;
  detect(text: string): RawMatch[];
}
