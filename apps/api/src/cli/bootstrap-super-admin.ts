import { createContainer } from '../composition/container.js';
import { loadEnv } from '../shared/env.js';

function parseEmailArg(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email' && argv[i + 1]) {
      return argv[i + 1]!;
    }
    if (arg?.startsWith('--email=')) {
      return arg.slice('--email='.length);
    }
  }
  const envEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL;
  if (envEmail) {
    return envEmail;
  }
  throw new Error('Missing required argument: --email <verified-user-email>');
}

async function main(): Promise<void> {
  const env = loadEnv();
  const email = parseEmailArg(process.argv.slice(2));
  const container = createContainer(env);

  try {
    const result = await container.bootstrapSuperAdmin.execute({ email });
    console.log(
      JSON.stringify({
        ok: true,
        status: result.status,
        userId: result.userId,
        email: result.email,
      }),
    );
  } finally {
    await container.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Super Admin bootstrap failed';
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
