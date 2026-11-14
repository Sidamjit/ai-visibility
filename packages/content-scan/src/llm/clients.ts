/** Azure OpenAI and OpenAI-compatible (Ollama, vLLM, LM Studio) chat clients. */
import { assertClientControlledEndpoint } from './guard';
import { LlmEndpointError, type LlmClient, type LlmMessage } from './types';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

async function postChat(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<string> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error', // never follow a redirect off the approved host
  });
  const json = (await res.json().catch(() => ({}))) as ChatResponse;
  if (!res.ok)
    throw new LlmEndpointError(
      `LLM request failed (${res.status}): ${json.error?.message ?? res.statusText}`,
    );
  return json.choices?.[0]?.message?.content ?? '';
}

export interface AzureOpenAiOptions {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion?: string;
  allowedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createAzureOpenAiClient(o: AzureOpenAiOptions): LlmClient {
  const base = assertClientControlledEndpoint(o.endpoint, 'azure-openai', o.allowedHosts);
  const url = new URL(
    `/openai/deployments/${encodeURIComponent(o.deployment)}/chat/completions`,
    base,
  );
  url.searchParams.set('api-version', o.apiVersion ?? '2024-10-21');
  return {
    provider: 'azure-openai',
    model: o.deployment,
    endpointHost: base.host,
    complete: (messages: LlmMessage[], opts = {}) =>
      postChat(
        o.fetchImpl ?? fetch,
        url.toString(),
        { 'api-key': o.apiKey },
        {
          messages,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 800,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        },
        o.timeoutMs ?? 60_000,
      ),
  };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  allowedHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createOpenAiCompatibleClient(o: OpenAiCompatibleOptions): LlmClient {
  const base = assertClientControlledEndpoint(o.baseUrl, 'openai-compatible', o.allowedHosts);
  const url = `${base.toString().replace(/\/$/, '')}/chat/completions`;
  return {
    provider: 'openai-compatible',
    model: o.model,
    endpointHost: base.host,
    complete: (messages, opts = {}) =>
      postChat(
        o.fetchImpl ?? fetch,
        url,
        o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {},
        {
          model: o.model,
          messages,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 800,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        },
        o.timeoutMs ?? 120_000,
      ),
  };
}

/**
 * Build the configured client from environment variables, or null when
 * LLM_PROVIDER is unset/"none" (the default).
 *
 *   LLM_PROVIDER=azure-openai       AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY[, AZURE_OPENAI_API_VERSION]
 *   LLM_PROVIDER=openai-compatible  LLM_BASE_URL, LLM_MODEL[, LLM_API_KEY]
 *   LLM_ALLOWED_HOSTS               comma-separated extra hosts inside the client's network
 */
export function createLlmClientFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): LlmClient | null {
  const provider = (env.LLM_PROVIDER ?? 'none').trim().toLowerCase();
  const allowedHosts = (env.LLM_ALLOWED_HOSTS ?? '').split(',');
  if (provider === '' || provider === 'none') return null;
  if (provider === 'azure-openai') {
    const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY } = env;
    if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_DEPLOYMENT || !AZURE_OPENAI_API_KEY)
      throw new LlmEndpointError(
        'LLM_PROVIDER=azure-openai needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT and AZURE_OPENAI_API_KEY.',
      );
    return createAzureOpenAiClient({
      endpoint: AZURE_OPENAI_ENDPOINT,
      deployment: AZURE_OPENAI_DEPLOYMENT,
      apiKey: AZURE_OPENAI_API_KEY,
      apiVersion: env.AZURE_OPENAI_API_VERSION,
      allowedHosts,
      fetchImpl,
    });
  }
  if (provider === 'openai-compatible') {
    if (!env.LLM_BASE_URL || !env.LLM_MODEL)
      throw new LlmEndpointError(
        'LLM_PROVIDER=openai-compatible needs LLM_BASE_URL and LLM_MODEL.',
      );
    return createOpenAiCompatibleClient({
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL,
      apiKey: env.LLM_API_KEY,
      allowedHosts,
      fetchImpl,
    });
  }
  throw new LlmEndpointError(
    `Unknown LLM_PROVIDER "${provider}" (use none, azure-openai or openai-compatible).`,
  );
}
