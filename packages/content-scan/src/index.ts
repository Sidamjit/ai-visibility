/** Public surface of @aiv/content-scan. */
export * from './validators';
export type { Classifier, RawMatch } from './classifiers/types';
export { BUILTIN_CLASSIFIERS, BUILTIN_CLASSIFIER_IDS } from './classifiers/builtin';
export { buildClassifiers } from './classifiers/registry';
export { customClassifier } from './classifiers/custom';
export { classifyText } from './scan-text';
export { redactSnippet, redactText, maskResidual, type Span } from './redact';
export {
  extractText,
  extensionOf,
  ExtractionError,
  EXTRACTABLE,
  type ExtractResult,
} from './extract';
export { createContentScanner, type ContentScanner, type CreateScannerOptions } from './scanner';
export type { LlmClient, LlmMessage } from './llm/types';
export { LlmEndpointError } from './llm/types';
export { assertClientControlledEndpoint, BLOCKED_PUBLIC_AI_HOSTS } from './llm/guard';
export {
  createAzureOpenAiClient,
  createOpenAiCompatibleClient,
  createLlmClientFromEnv,
} from './llm/clients';
export { llmAssess } from './llm/assess';
