import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The design bundle in project/ is reference material, not application code —
  // it must never be picked up as routes or pages.
  pageExtensions: ['ts', 'tsx'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    // The upload field advertises 100 MB, so the action has to accept it.
    serverActions: { bodySizeLimit: '100mb' },
  },
};

export default nextConfig;
