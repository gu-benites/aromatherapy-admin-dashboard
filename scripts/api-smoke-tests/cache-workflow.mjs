import { readFileSync } from 'node:fs';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

function readEnvFile() {
  try {
    return readFileSync('.env', 'utf8');
  } catch {
    return '';
  }
}

function readEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;

  const match = readEnvFile().match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...value] = arg.slice(2).split('=');
      args.set(key, value.join('='));
    }
  }

  return {
    baseUrl: args.get('base-url') ?? DEFAULT_BASE_URL
  };
}

function makeClient({ baseUrl, auth = true }) {
  const headers = auth
    ? {
        'x-dev-user-id': 'codex-cache-workflow-smoke',
        'x-dev-auth-token': readEnv('TRPC_DEV_AUTH_TOKEN') ?? ''
      }
    : undefined;

  return createTRPCClient({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, '')}/api/trpc`,
        transformer: superjson,
        headers
      })
    ]
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectFailure(label, action) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  const { baseUrl } = parseArgs();
  const client = makeClient({ baseUrl });
  const anonymousClient = makeClient({ baseUrl, auth: false });

  const anonymousError = await expectFailure('anonymous cache health query', () =>
    anonymousClient.system.cacheHealth.query()
  );

  const health = await client.system.cacheHealth.query();

  assert(health.configured, `Redis is not configured: ${health.message}`);
  assert(health.ok, `Redis health check failed: ${health.message}`);
  assert(typeof health.latencyMs === 'number', 'Redis health check did not return latency');

  const firstSummary = await client.system.databaseSummary.query();
  const secondSummary = await client.system.databaseSummary.query();

  assert(firstSummary.essentialOilCount > 0, 'databaseSummary did not return oils');
  assert(firstSummary.pregnancyProfileCount > 0, 'databaseSummary did not return pregnancy profiles');
  assert(secondSummary.cache === 'hit', `databaseSummary second fetch was not a cache hit: ${secondSummary.cache}`);

  console.log(
    JSON.stringify(
      {
        redis: {
          configured: health.configured,
          ok: health.ok,
          cacheKeyPrefix: health.cacheKeyPrefix,
          latencyMs: health.latencyMs
        },
        databaseSummary: {
          essentialOilCount: secondSummary.essentialOilCount,
          pregnancyProfileCount: secondSummary.pregnancyProfileCount,
          firstFetchCache: firstSummary.cache,
          secondFetchCache: secondSummary.cache
        },
        auth: {
          anonymousProtectedReadRejected: Boolean(anonymousError)
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
