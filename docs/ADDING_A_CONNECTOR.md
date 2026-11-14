# Adding a connector

A connector turns one source (an AI product, a content platform, a log stream) into the normalized
model. Dashboards and rules never change when you add one.

## 1. Create the module

```
packages/connectors/src/<your-source>/
  connector.ts       # implements Connector<TConfig>
  client.ts          # HTTP client if needed (paging, throttling)
  parsers.ts         # PURE functions: raw API JSON -> normalized types
  parsers.test.ts    # tests with fixtures in ../__fixtures__/
```

Start from `stubs/*.ts` if the source is already listed as planned.

## 2. Implement the interface (`packages/connectors/src/types.ts`)

```ts
export const myConnector: Connector<MyConfig> = {
  id: 'my-source', // stable, kebab-case, never renamed
  displayName: 'My Source',
  vendor: 'Vendor',
  description: 'What it reads, in one sentence.',
  maturity: 'preview', // 'available' once piloted
  requiredPermissions: [/* name, type, reason, dataAccessed, required */],
  secretEnvVars: ['MY_SOURCE_API_KEY'],
  configSchema: z.object({/* non-secret settings with defaults */}),
  async authenticate(ctx) {
    /* cheap call(s) to verify creds + permissions */
  },
  async sync(ctx, sinceCursor) {
    // 1. read ctx.secrets / ctx.config
    // 2. fetch (use ctx.fetch so tests can inject a mock)
    // 3. map with parsers into a NormalizedBatch (emptyBatch() helper)
    // 4. return { batch, nextCursor, fullSync, deletions, stats, warnings }
  },
};
```

Rules of the road:

- **Read-only and metadata-only.** Never fetch document bodies, prompts, responses or messages.
  If an API returns them anyway, drop them in the parser.
- **Secrets only from `ctx.secrets`** (env vars listed in `secretEnvVars`).
- **Use `ctx.fetch`** and `ctx.now` — never globals — so tests are deterministic.
- **Map to existing types.** E.g. ChatGPT seats → `Licence`, daily message counts → `UsageSummary`
  (feature keys like `gpts`, `code-interpreter`), custom GPTs → `AIAsset{kind:'agent'}`,
  monthly invoice → `CostItem`. If you truly need a new field, add it to `@aiv/core/model.ts`,
  the Prisma schema, `saveBatch`/`loadBatch`, and document it.
- **Incremental sync**: store whatever you need (timestamps, delta tokens) in `nextCursor`.
- **Graceful degradation**: optional permissions missing → push a warning, don't throw.

## 3. Register it

Add it to `CONNECTORS` in `packages/connectors/src/registry.ts`. It now appears on the Connectors page
with its permissions, and `npm run worker -- create-tenant --connector my-source` can attach it.

## 4. Test it

- Parser tests with realistic fixtures (copy real response _shapes_, fake values).
- A `connector.test.ts` using `__fixtures__/mock-fetch.ts` that asserts: valid
  `NormalizedBatchSchema`, cursor behaviour, warnings on 403 for optional calls, and that no
  content endpoints are called.

## 5. Document it

Add its permissions/setup to a `docs/<SOURCE>_SETUP.md` (follow `PILOT_SETUP.md`) and update the
table in `README.md`.
