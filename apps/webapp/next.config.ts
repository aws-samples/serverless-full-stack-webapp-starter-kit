import type { NextConfig } from 'next';

const allowedOrigins = ['localhost:3000'];
if (process.env.ALLOWED_ORIGIN_HOST) {
  allowedOrigins.push(process.env.ALLOWED_ORIGIN_HOST);
}

const nextConfig: NextConfig = {
  output: 'standalone',
  // Required for pnpm workspace packages — Next.js standalone output does not
  // resolve symlinked workspace dependencies by default.
  transpilePackages: ['@repo/db', '@repo/shared-types'],
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
    serverActions: {
      allowedOrigins,
    },
  },
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TS_BUILD == 'true',
  },
};

export default nextConfig;
