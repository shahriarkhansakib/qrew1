'use client';

import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const appBaseUrl =
  typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

export const authClient = createAuthClient({
  baseURL: appBaseUrl,
  plugins: [twoFactorClient()],
});
