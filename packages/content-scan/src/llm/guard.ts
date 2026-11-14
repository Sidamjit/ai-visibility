/**
 * Endpoint guard: the LLM adapter may only talk to endpoints the CLIENT controls.
 *
 * Always refused: vendor-hosted public AI APIs (OpenAI, Anthropic, Google, xAI,
 * Mistral, Cohere, Groq, OpenRouter, Together, DeepSeek, ...), because content
 * would leave the client's environment.
 *
 * azure-openai:      *.openai.azure.com, *.cognitiveservices.azure.com,
 *                    *.services.ai.azure.com (the client's own resource) or a host
 *                    listed in LLM_ALLOWED_HOSTS (e.g. private-endpoint DNS).
 * openai-compatible: loopback, private IP ranges, single-label hosts (Docker
 *                    service names such as "ollama"), *.local / *.internal /
 *                    *.lan, or a host listed in LLM_ALLOWED_HOSTS.
 *
 * HTTPS is required except for loopback/private/single-label hosts.
 * NOTE: a hostname cannot prove which Azure subscription owns a resource; the
 * client's admin configures the endpoint, and it is recorded in the audit log.
 */
import { LlmEndpointError } from './types';

export const BLOCKED_PUBLIC_AI_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'api.x.ai',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'api.groq.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.deepseek.com',
  'api.perplexity.ai',
  'api.fireworks.ai',
];

const AZURE_SUFFIXES = [
  '.openai.azure.com',
  '.cognitiveservices.azure.com',
  '.services.ai.azure.com',
];

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (!host.includes('.') && !host.includes(':')) return true; // single-label (docker service)
  if (/\.(local|internal|lan|home\.arpa)$/i.test(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h.startsWith('fd') || h.startsWith('fc') || h.startsWith('fe80');
}

export function assertClientControlledEndpoint(
  rawUrl: string,
  provider: 'azure-openai' | 'openai-compatible',
  allowedHosts: readonly string[] = [],
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LlmEndpointError(`LLM endpoint "${rawUrl}" is not a valid URL.`);
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_PUBLIC_AI_HOSTS.some((b) => host === b || host.endsWith(`.${b}`)))
    throw new LlmEndpointError(
      `LLM endpoint ${host} is a vendor-hosted public AI service. Only client-controlled endpoints are allowed.`,
    );
  const allowListed = allowedHosts
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host);
  const local = isPrivateHost(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new LlmEndpointError(
      `LLM endpoint must use HTTPS (plain HTTP only for local/private hosts).`,
    );
  if (provider === 'azure-openai') {
    if (!allowListed && !AZURE_SUFFIXES.some((s) => host.endsWith(s)))
      throw new LlmEndpointError(
        `Azure OpenAI endpoint must be the client's own resource (*.openai.azure.com) or listed in LLM_ALLOWED_HOSTS.`,
      );
  } else if (!allowListed && !local) {
    throw new LlmEndpointError(
      `OpenAI-compatible endpoint ${host} is not local/private. Add it to LLM_ALLOWED_HOSTS if it is hosted inside the client's network.`,
    );
  }
  return url;
}
