import type { NextConfig } from 'next';

const allowedOrigins = ['localhost:3000'];
if (process.env.ALLOWED_ORIGIN_HOST) {
  allowedOrigins.push(process.env.ALLOWED_ORIGIN_HOST);
}

const nextConfig: NextConfig = {
  output: 'standalone',
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
