import path from 'node:path';
import type { NextConfig } from 'next';

// The single repo-root .env is injected by the npm scripts (dotenv-cli) BEFORE
// Next starts, because Next resets process.env when it loads its own env files.
// In Docker, variables come from the container environment instead.
const repoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@aiv/core',
    '@aiv/connectors',
    '@aiv/analysis',
    '@aiv/db',
    '@aiv/pipeline',
    '@aiv/policy',
    '@aiv/content-scan',
  ],
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // Native/worker-heavy parsers stay as node_modules requires (not bundled).
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'unpdf', '@kenjiuno/msgreader'],
  experimental: {
    // Policy documents are uploaded through a server action.
    serverActions: { bodySizeLimit: '20mb' },
  },
  poweredByHeader: false,
  // Linting runs once for the whole monorepo via `npm run lint` (root eslint.config.mjs).
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
