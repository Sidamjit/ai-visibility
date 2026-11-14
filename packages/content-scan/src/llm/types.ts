/**
 * Optional LLM classifier adapter.
 *
 * DISABLED BY DEFAULT. When enabled, extracted text is sent ONLY to an endpoint
 * the client controls: Azure OpenAI in the client's own subscription, or an
 * OpenAI-compatible server they run (e.g. Ollama, vLLM) on their network.
 * `assertClientControlledEndpoint` refuses vendor-hosted public AI APIs.
 * See docs/SECURITY.md → "LLM classification".
 */
export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmClient {
  /** 'azure-openai' | 'openai-compatible' */
  readonly provider: string;
  /** Deployment / model name (for audit and the assessment record). */
  readonly model: string;
  /** Host the client sends data to (shown in Settings and the audit log). */
  readonly endpointHost: string;
  /** Send a chat completion; returns the assistant text. */
  complete(messages: LlmMessage[], opts?: { maxTokens?: number; json?: boolean }): Promise<string>;
}

export class LlmEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmEndpointError';
  }
}
