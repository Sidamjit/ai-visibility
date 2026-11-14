#!/usr/bin/env node
/**
 * Prisma CLI wrapper that picks the database provider from DATABASE_URL.
 *
 *   postgresql://...  -> provider "postgresql" (production, Docker Compose)
 *   file:...          -> provider "sqlite"     (local dev without Docker)
 *
 * `prisma/schema.prisma` is the single source of truth (written for Postgres
 * and kept portable: no enums, no native types, no scalar lists). This script
 * writes `prisma/generated.prisma` with the right provider and forwards the
 * remaining arguments to the Prisma CLI.
 *
 * Env is loaded from the repo-root `.env` if present.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const rootEnv = join(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  // `prisma generate` doesn't need a live DB; default to postgres so CI can generate without env.
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
}
const provider = url.startsWith('file:') ? 'sqlite' : 'postgresql';

const source = readFileSync(join(pkgRoot, 'prisma/schema.prisma'), 'utf8');
const out = source.replace(/provider\s*=\s*"postgresql"/, `provider = "${provider}"`);
writeFileSync(
  join(pkgRoot, 'prisma/generated.prisma'),
  `// GENERATED from schema.prisma by scripts/prisma.mjs — do not edit.\n${out}`,
);

const args = [...process.argv.slice(2), '--schema', 'prisma/generated.prisma'];
console.log(`[db] provider=${provider} -> prisma ${args.join(' ')}`);
execFileSync(process.execPath, [join(repoRoot, 'node_modules/prisma/build/index.js'), ...args], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: process.env,
});
