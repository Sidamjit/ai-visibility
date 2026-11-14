import { describe, expect, it, vi } from 'vitest';
import { PolicySchema, NZ_PSR_SAMPLE_POLICY } from '@aiv/policy';
import { strToU8 } from 'fflate';
import {
  BUILTIN_CLASSIFIERS,
  assertClientControlledEndpoint,
  auTfnValid,
  buildClassifiers,
  classifyText,
  createAzureOpenAiClient,
  createContentScanner,
  createLlmClientFromEnv,
  createOpenAiCompatibleClient,
  extractText,
  llmAssess,
  luhnValid,
  maskResidual,
  nzBankAccountValid,
  nzIrdValid,
  nzNhiValid,
  redactSnippet,
  type LlmClient,
} from './index';
import { docx, eml, pdf, pptx, xlsx } from './__fixtures__/files';

const policy = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
const all = buildClassifiers(policy.classifiers);
const off = { snippetMode: 'off' as const, snippetContextChars: 20, maxSnippetsPerClassifier: 2 };
const redacted = { ...off, snippetMode: 'redacted' as const };
const hitsOf = (text: string) =>
  Object.fromEntries(classifyText(text, all, off).hits.map((h) => [h.classifierId, h]));

describe('validators (published test values)', () => {
  it('IRD numbers (Inland Revenue spec examples)', () => {
    for (const ok of ['49091850', '35901981', '49098576', '136410132'])
      expect(nzIrdValid(ok)).toBe(true);
    expect(nzIrdValid('136410133')).toBe(false);
    expect(nzIrdValid('9125568')).toBe(false); // out of range
  });
  it('NZ bank accounts (IRD textbook, algorithms A/B/D/G/X)', () => {
    expect(nzBankAccountValid('01', '0902', '0068389', '00')).toBe(true);
    expect(nzBankAccountValid('01', '0902', '0068388', '00')).toBe(false);
    expect(nzBankAccountValid('01', '0902', '0990008', '00')).toBe(true); // algorithm B
    expect(nzBankAccountValid('08', '6523', '1954512', '001')).toBe(true); // D
    expect(nzBankAccountValid('26', '2600', '0320871', '032')).toBe(true); // G
    expect(nzBankAccountValid('31', '2800', '1234567', '00')).toBe(true); // X
    expect(nzBankAccountValid('99', '0902', '0068389', '00')).toBe(false); // unknown bank
  });
  it('NHI numbers, legacy mod 11 and expanded mod 23', () => {
    for (const ok of [
      'WLD9413',
      'EPT6335',
      'CGC2720',
      'ZAA0067',
      'JBX3656',
      'ACA31FM',
      'ZSC21TN',
      'ARE62RS',
    ])
      expect(nzNhiValid(ok)).toBe(true);
    for (const bad of ['WLD9410', 'ZZZ0044', 'JBX3657', 'ACA31FN', 'ABI1234'])
      expect(nzNhiValid(bad)).toBe(false);
  });
  it('AU TFN and Luhn', () => {
    expect(auTfnValid('123 456 782')).toBe(true);
    expect(auTfnValid('123456789')).toBe(false);
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
  });
});

describe('built-in classifiers', () => {
  it('ships every classifier the sample policy references', () => {
    const ids = new Set(all.map((c) => c.id));
    for (const rule of policy.contentRules)
      for (const id of rule.classifiers) expect(ids.has(id)).toBe(true);
    expect(BUILTIN_CLASSIFIERS.length).toBeGreaterThanOrEqual(12);
  });

  it('detects validated identifiers and rejects look-alikes', () => {
    const h = hitsOf(
      'Employee IRD number: 49-091-850. Second IRD 35901981. Not an IRD: 49091851. ' +
        'Pay to 01-0902-0068389-00 (bad: 01-0902-0068388-00). Card 4111 1111 1111 1111, ref 1234 5678 9012 3456. ' +
        'NHI: ZAA0067. TFN 123 456 782. Passport number: LA123456. Driver licence AB123456.',
    );
    expect(h['nz-ird-number']).toMatchObject({ count: 2, distinctValues: 2, confidence: 'high' });
    expect(h['nz-bank-account']).toMatchObject({ count: 1, confidence: 'high' });
    expect(h['credit-card']).toMatchObject({ count: 1 });
    expect(h['nz-nhi']).toMatchObject({ count: 1, confidence: 'high' });
    expect(h['au-tfn']).toMatchObject({ count: 1, confidence: 'high' });
    expect(h['nz-passport']).toMatchObject({ count: 1 });
    expect(h['nz-driver-licence']).toMatchObject({ count: 1 });
  });

  it('requires context for passport / licence formats', () => {
    const h = hitsOf('Order AB123456 shipped. Part LA123456.');
    expect(h['nz-passport']).toBeUndefined();
    expect(h['nz-driver-licence']).toBeUndefined();
  });

  it('detects credentials but ignores placeholders', () => {
    const h = hitsOf(
      'AWS key AKIAIOSFODNN7EXAMPLF\n-----BEGIN RSA PRIVATE KEY-----\nServer=db;Password=Sup3rS3cret!;\n' +
        'password: ********\napi_key = "<your key here>"\nclient_secret: abcdEFGH1234ijklMNOP5678',
    );
    expect(h['secret-credential']!.count).toBe(4);
  });

  it('counts contact details and keyword categories', () => {
    const h = hitsOf(
      'Contact jo@example.co.nz or 021 555 1234 / +64 9 555 1234. Date of birth: 01/02/1980. ' +
        'Next of kin listed. Diagnosis: depression; prescription renewed; ACC claim lodged.',
    );
    expect(h['email-address']!.count).toBe(1);
    expect(h['phone-number']!.count).toBe(2);
    expect(h['personal-information']!.count).toBeGreaterThanOrEqual(2);
    expect(h['health-information']).toMatchObject({ count: 4, distinctValues: 4 });
  });

  it('honours disabled built-ins and custom classifiers from the policy', () => {
    const cs = buildClassifiers({
      disabled: ['email-address'],
      custom: [
        {
          id: 'proj',
          name: 'Project code',
          category: 'custom',
          description: '',
          pattern: 'PRJ-\\d{4}',
          keywords: [],
          confidence: 'high',
        },
        {
          id: 'kw',
          name: 'Kw',
          category: 'custom',
          description: '',
          keywords: ['Board only'],
          confidence: 'medium',
        },
      ],
    });
    const ids = classifyText('PRJ-1234 a@b.co board   only', cs, off).hits.map(
      (x) => x.classifierId,
    );
    expect(ids).toEqual(expect.arrayContaining(['proj', 'kw']));
    expect(ids).not.toContain('email-address');
    expect(classifyText('legally privileged advice', all, off).hits[0]!.classifierId).toBe(
      'legal-privilege',
    );
  });
});

describe('redaction', () => {
  const text =
    'Payroll: Jane Smith IRD 49-091-850, account 01-0902-0068389-00, email jane@example.co.nz.';

  it('stores no snippets when snippet mode is off (default)', () => {
    const r = classifyText(text, all, off);
    expect(r.hits.every((h) => h.snippets.length === 0)).toBe(true);
  });

  it('redacted snippets never contain matched values or residual digit runs', () => {
    const r = classifyText(text, all, { ...redacted, snippetContextChars: 60 });
    const snippets = r.hits.flatMap((h) => h.snippets);
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) {
      expect(s).not.toMatch(/\d{3}/);
      expect(s).not.toContain('jane@example');
      expect(s).not.toContain('49-091-850');
    }
    expect(snippets.join(' ')).toContain('«NZ-IRD-NUMBER»');
  });

  it('masks residual numbers and emails', () => {
    expect(maskResidual('call 0800 123 456 or x@y.nz')).toBe('call #### ### ### or «EMAIL»');
    expect(redactSnippet('abc SECRET def', { index: 4, length: 6, classifierId: 'x' }, [], 3)).toBe(
      '…bc «X» de…',
    );
  });
});

describe('text extraction', () => {
  const opts = { maxChars: 100_000 };
  it('docx: body and footer', async () => {
    const r = await extractText(docx(['Staff IRD 49091850', 'Second line']), 'docx', opts);
    expect(r.text).toContain('Staff IRD 49091850');
    expect(r.text).toContain('IN-CONFIDENCE');
  });
  it('xlsx: shared strings and NUMERIC cells (identifiers stored as numbers)', async () => {
    const r = await extractText(
      xlsx([
        ['IRD', 49091850],
        ['IRD', 35901981],
      ]),
      'xlsx',
      opts,
    );
    expect(r.text).toContain('49091850');
    expect(r.text).toContain('35901981');
    expect(r.text).not.toMatch(/^0\t/m); // shared-string indices are not emitted
  });
  it('pptx: slide text in order', async () => {
    const r = await extractText(pptx(['First', 'Card 4111111111111111']), 'pptx', opts);
    expect(r.text.indexOf('First')).toBeLessThan(r.text.indexOf('Card'));
  });
  it('pdf: text layer', async () => {
    const r = await extractText(pdf(['Patient NHI ZAA0067', 'Diagnosis noted']), 'pdf', opts);
    expect(r.text).toContain('ZAA0067');
  });
  it('eml: body and supported attachments', async () => {
    const r = await extractText(
      eml('Please pay 01-0902-0068389-00', { name: 'list.docx', bytes: docx(['IRD 49091850']) }),
      'eml',
      opts,
    );
    expect(r.text).toContain('01-0902-0068389-00');
    expect(r.text).toContain('49091850');
  });
  it('plain text incl. UTF-16 with BOM; truncation', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('IRD 49091850', 'utf16le')]);
    expect((await extractText(utf16, 'txt', opts)).text).toBe('IRD 49091850');
    const t = await extractText(strToU8('x'.repeat(50)), 'csv', { maxChars: 10 });
    expect(t).toMatchObject({ truncated: true });
    expect(t.text).toHaveLength(10);
  });
  it('rejects encrypted/legacy Office, corrupt zips and unsupported types', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    await expect(extractText(ole, 'docx', opts)).rejects.toMatchObject({ reason: 'encrypted' });
    await expect(extractText(strToU8('PK nope'), 'xlsx', opts)).rejects.toMatchObject({
      reason: 'corrupt',
    });
    await expect(extractText(strToU8('x'), 'exe', opts)).rejects.toMatchObject({
      reason: 'unsupported',
    });
  });
  it('guards against zip bombs', async () => {
    await expect(
      extractText(docx(['x'.repeat(10_000)]), 'docx', {
        maxChars: 10,
        maxUncompressedBytes: 1_000,
      }),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });
});

describe('scanner', () => {
  const target = {
    locationExternalId: 'item-1',
    siteExternalId: 'site-1',
    name: 'Payroll.xlsx',
    sizeBytes: 1000,
    sourceVersion: 'c1',
  };

  it('applies allow list and size limit before download', () => {
    const s = createContentScanner({
      settings: { maxFileSizeMb: 1, allowedExtensions: ['xlsx'] },
      policy,
    });
    expect(s.skipReason(target)).toBeNull();
    expect(s.skipReason({ ...target, name: 'a.zip' })).toMatch(/not in allow list/);
    expect(s.skipReason({ ...target, sizeBytes: 5 * 1024 * 1024 })).toMatch(/larger than 1 MB/);
    expect(createContentScanner({ settings: { enabled: false } }).skipReason(target)).toMatch(
      /disabled/,
    );
  });

  it('returns counts + hash only, and zero-fills the content buffer', async () => {
    const s = createContentScanner({ policy, now: () => new Date('2026-11-01T00:00:00Z') });
    const bytes = xlsx([
      ['IRD', 49091850],
      ['IRD', 35901981],
      ['IRD', 49098576],
    ]);
    const result = await s.scan(target, bytes);
    expect(result.status).toBe('scanned');
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.hits.find((h) => h.classifierId === 'nz-ird-number')).toMatchObject({
      count: 3,
      distinctValues: 3,
      snippets: [],
    });
    expect(JSON.stringify(result)).not.toContain('49091850');
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it('reports failures without throwing', async () => {
    const s = createContentScanner({ policy });
    const r = await s.scan({ ...target, name: 'x.docx' }, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    expect(r).toMatchObject({ status: 'failed', hits: [] });
    expect(r.statusReason).toMatch(/encrypted/);
  });

  it('uses the LLM only when enabled, and redacts what is sent', async () => {
    const complete = vi.fn(async () =>
      JSON.stringify({
        levelId: 'SENSITIVE',
        categories: ['hr'],
        confidence: 0.9,
        rationale: 'Pay list 49091850',
      }),
    );
    const llm: LlmClient = { provider: 'test', model: 'm', endpointHost: 'localhost', complete };
    const bytes = () => strToU8('Salary list IRD 49091850');
    await createContentScanner({ policy, llm }).scan({ ...target, name: 'a.txt' }, bytes());
    expect(complete).not.toHaveBeenCalled();
    const r = await createContentScanner({ policy, llm, settings: { llmEnabled: true } }).scan(
      { ...target, name: 'a.txt' },
      bytes(),
    );
    expect(complete).toHaveBeenCalledOnce();
    const sent = JSON.stringify(complete.mock.calls[0]);
    expect(sent).not.toContain('49091850');
    expect(r.llm).toMatchObject({ levelId: 'SENSITIVE', confidence: 0.9 });
    expect(r.llm!.rationale).not.toContain('49091850');
  });
});

describe('LLM endpoint guard (client-controlled endpoints only)', () => {
  it('refuses vendor-hosted public AI APIs, whatever the provider', () => {
    expect(() =>
      assertClientControlledEndpoint('https://api.openai.com/v1', 'openai-compatible'),
    ).toThrow(/vendor-hosted/);
    expect(() =>
      assertClientControlledEndpoint('https://api.anthropic.com', 'openai-compatible', [
        'api.anthropic.com',
      ]),
    ).toThrow(/vendor-hosted/);
  });
  it('accepts the client’s Azure OpenAI resource and allow-listed private endpoints', () => {
    expect(() =>
      assertClientControlledEndpoint('https://contoso-ai.openai.azure.com', 'azure-openai'),
    ).not.toThrow();
    expect(() => assertClientControlledEndpoint('https://example.com', 'azure-openai')).toThrow();
    expect(() =>
      assertClientControlledEndpoint('https://aoai.privatelink.contoso.nz', 'azure-openai', [
        'aoai.privatelink.contoso.nz',
      ]),
    ).not.toThrow();
  });
  it('accepts local/private OpenAI-compatible servers; requires HTTPS for anything else', () => {
    for (const ok of [
      'http://localhost:11434/v1',
      'http://ollama:11434/v1',
      'http://10.1.2.3/v1',
      'https://llm.internal/v1',
    ])
      expect(() => assertClientControlledEndpoint(ok, 'openai-compatible')).not.toThrow();
    expect(() =>
      assertClientControlledEndpoint('https://llm.example.com/v1', 'openai-compatible'),
    ).toThrow(/not local/);
    expect(() =>
      assertClientControlledEndpoint('http://llm.example.com/v1', 'openai-compatible', [
        'llm.example.com',
      ]),
    ).toThrow(/HTTPS/);
  });
  it('builds no client unless LLM_PROVIDER is set', () => {
    expect(createLlmClientFromEnv({})).toBeNull();
    expect(() => createLlmClientFromEnv({ LLM_PROVIDER: 'azure-openai' })).toThrow(
      /AZURE_OPENAI_ENDPOINT/,
    );
    expect(() =>
      createLlmClientFromEnv({
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'https://api.openai.com/v1',
        LLM_MODEL: 'x',
      }),
    ).toThrow();
  });
  it('sends well-formed requests to Azure OpenAI and Ollama', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
        }),
    );
    const az = createAzureOpenAiClient({
      endpoint: 'https://contoso.openai.azure.com',
      deployment: 'gpt-4o-mini',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await az.complete([{ role: 'user', content: 'hi' }], { json: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://contoso.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21',
    );
    expect((init.headers as Record<string, string>)['api-key']).toBe('k');
    expect(init.redirect).toBe('error');
    const ol = createOpenAiCompatibleClient({
      baseUrl: 'http://ollama:11434/v1',
      model: 'llama3.1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await ol.complete([{ role: 'user', content: 'hi' }])).toBe('{"ok":true}');
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe(
      'http://ollama:11434/v1/chat/completions',
    );
  });
  it('ignores unknown level ids returned by the model', async () => {
    const llm: LlmClient = {
      provider: 't',
      model: 'm',
      endpointHost: 'h',
      complete: async () => '{"levelId":"TOP-SECRET","confidence":2}',
    };
    const r = await llmAssess(llm, 'text', policy, []);
    expect(r).toMatchObject({ levelId: null, confidence: 1 });
  });
});
