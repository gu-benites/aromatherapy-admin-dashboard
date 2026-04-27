import 'server-only';

import { createHash } from 'node:crypto';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

type CachedJsonResult<T> = {
  data: T;
  cache: 'disabled' | 'hit' | 'miss' | 'error';
};

const REDIS_OPERATION_TIMEOUT_MS = 750;

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: RedisClient;
  redisClientConnectPromise?: Promise<RedisClient>;
};

export const redisCacheKeyPrefix = process.env.REDIS_CACHE_KEY_PREFIX?.trim() || 'aroma-admin:v1';

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL?.trim();
  return redisUrl || null;
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

export function stableCacheHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);
}

export function makeCacheKey(domain: string, procedure: string, input: unknown = null) {
  return `${redisCacheKeyPrefix}:${domain}:${procedure}:${stableCacheHash(input)}`;
}

export function makeDomainVersionKey(domain: string) {
  return `${redisCacheKeyPrefix}:version:${domain}`;
}

export async function makeVersionedCacheKey(
  domain: string,
  procedure: string,
  input: unknown = null
) {
  const client = await getRedisClient({ timeoutMs: REDIS_OPERATION_TIMEOUT_MS });
  const version = client
    ? ((await withTimeout(
        client.get(makeDomainVersionKey(domain)),
        REDIS_OPERATION_TIMEOUT_MS
      ).catch(() => null)) ?? '0')
    : '0';

  return `${redisCacheKeyPrefix}:${domain}:v${version}:${procedure}:${stableCacheHash(input)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Redis operation timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function getRedisClient(options: { timeoutMs?: number } = {}) {
  const url = getRedisUrl();

  if (!url) {
    return null;
  }

  if (!globalForRedis.redisClient) {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: options.timeoutMs ?? REDIS_OPERATION_TIMEOUT_MS,
        reconnectStrategy: false
      }
    });
    client.on('error', () => {
      // Keep Redis optional: individual cache calls report failures without crashing the app.
    });
    globalForRedis.redisClient = client;
  }

  if (globalForRedis.redisClient.isOpen) {
    return globalForRedis.redisClient;
  }

  globalForRedis.redisClientConnectPromise ??= globalForRedis.redisClient
    .connect()
    .then(() => globalForRedis.redisClient as RedisClient)
    .finally(() => {
      globalForRedis.redisClientConnectPromise = undefined;
    });

  return options.timeoutMs
    ? withTimeout(globalForRedis.redisClientConnectPromise, options.timeoutMs).catch(() => null)
    : globalForRedis.redisClientConnectPromise;
}

export async function redisHealthCheck() {
  if (!isRedisConfigured()) {
    return {
      configured: false,
      ok: false,
      cacheKeyPrefix: redisCacheKeyPrefix,
      latencyMs: null,
      message: 'REDIS_URL is not configured'
    };
  }

  const startedAt = Date.now();

  try {
    const client = await getRedisClient({ timeoutMs: REDIS_OPERATION_TIMEOUT_MS });
    const pong = client ? await withTimeout(client.ping(), REDIS_OPERATION_TIMEOUT_MS) : null;

    return {
      configured: true,
      ok: pong === 'PONG',
      cacheKeyPrefix: redisCacheKeyPrefix,
      latencyMs: Date.now() - startedAt,
      message: pong === 'PONG' ? 'Redis responded to PING' : 'Redis did not return PONG'
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      cacheKeyPrefix: redisCacheKeyPrefix,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getCachedJson<T>({
  key,
  ttlSeconds,
  load
}: {
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
}): Promise<CachedJsonResult<T>> {
  const client = await getRedisClient({ timeoutMs: REDIS_OPERATION_TIMEOUT_MS });

  if (!client) {
    return {
      data: await load(),
      cache: 'disabled'
    };
  }

  try {
    const cached = await withTimeout(client.get(key), REDIS_OPERATION_TIMEOUT_MS);

    if (cached) {
      return {
        data: JSON.parse(cached) as T,
        cache: 'hit'
      };
    }

    const data = await load();
    await withTimeout(
      client.setEx(key, ttlSeconds, JSON.stringify(data)),
      REDIS_OPERATION_TIMEOUT_MS
    );

    return {
      data,
      cache: 'miss'
    };
  } catch {
    return {
      data: await load(),
      cache: 'error'
    };
  }
}

export async function deleteCacheKeys(keys: string[]) {
  const client = await getRedisClient({ timeoutMs: REDIS_OPERATION_TIMEOUT_MS });

  if (!client || keys.length === 0) {
    return 0;
  }

  return withTimeout(client.del(keys), REDIS_OPERATION_TIMEOUT_MS).catch(() => 0);
}

export async function bumpCacheDomainVersion(domain: string) {
  const client = await getRedisClient({ timeoutMs: REDIS_OPERATION_TIMEOUT_MS });

  if (!client) {
    return null;
  }

  const key = makeDomainVersionKey(domain);
  const version = await withTimeout(client.incr(key), REDIS_OPERATION_TIMEOUT_MS).catch(() => null);

  if (version === null) {
    return null;
  }

  await withTimeout(client.expire(key, 60 * 60 * 24 * 30), REDIS_OPERATION_TIMEOUT_MS).catch(
    () => false
  );

  return version;
}

export async function bumpCacheDomainVersions(domains: string[]) {
  const uniqueDomains = Array.from(new Set(domains));
  await Promise.all(uniqueDomains.map((domain) => bumpCacheDomainVersion(domain)));
}
