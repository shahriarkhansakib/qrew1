import path from 'node:path';
import type { NextConfig } from 'next';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // Root .env is optional (CI provides environment variables directly).
}

const nextConfig: NextConfig = {
  transpilePackages: ['@qrew/contracts'],
};

export default nextConfig;
