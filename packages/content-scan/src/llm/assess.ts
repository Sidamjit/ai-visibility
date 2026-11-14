/** LLM-assisted classification of one document against the tenant policy. */
import type { LlmAssessment } from '@aiv/core';
import type { Policy } from '@aiv/policy';
import { redactText, type Span } from '../redact';
import type { LlmClient } from './types';

const MAX_PROMPT_CHARS = 12_000;

export async function llmAssess(
  client: LlmClient,
  text: string,
  policy: Policy,
  spans: readonly Span[],
): Promise<LlmAssessment> {
  const levels = [...policy.levels]
    .sort((a, b) => a.rank - b.rank)
    .map((l) => `- ${l.id}: ${l.name}. ${l.description}`)
    .join('\n');
  // Pre-redact detected identifiers: the model needs the gist, not the numbers.
  const redacted = redactText(
    text.slice(0, MAX_PROMPT_CHARS),
    spans.filter((s) => s.index < MAX_PROMPT_CHARS),
  );
  const answer = await client.complete(
    [
      {
        role: 'system',
        content:
          "You classify documents against an organisation's data classification policy. " +
          'Reply ONLY with JSON: {"levelId": string|null, "categories": string[], "confidence": number 0-1, "rationale": string}. ' +
          'The rationale must be one sentence and must NOT quote names, numbers or other personal information.\n' +
          `Levels:\n${levels}`,
      },
      { role: 'user', content: redacted },
    ],
    { json: true, maxTokens: 300 },
  );
  let parsed: Partial<{
    levelId: unknown;
    categories: unknown;
    confidence: unknown;
    rationale: unknown;
  }> = {};
  try {
    parsed = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
  } catch {
    /* fall through to defaults */
  }
  const levelId =
    typeof parsed.levelId === 'string' && policy.levels.some((l) => l.id === parsed.levelId)
      ? parsed.levelId
      : null;
  return {
    provider: client.provider,
    model: client.model,
    levelId,
    categories: Array.isArray(parsed.categories)
      ? parsed.categories.filter((c): c is string => typeof c === 'string').slice(0, 8)
      : [],
    confidence:
      typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
    rationale: redactText(typeof parsed.rationale === 'string' ? parsed.rationale : '', []).slice(
      0,
      500,
    ),
  };
}
