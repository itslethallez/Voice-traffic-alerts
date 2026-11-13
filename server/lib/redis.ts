import { Redis } from '@upstash/redis';

/**
 * Upstash Redis over REST - serverless-native, no connection to manage per
 * invocation. This is a CACHE layer only (in front of the corridor-relevance
 * query once GET /alerts/nearby exists, so the 15-30s foreground poll
 * doesn't hammer Postgres), never a pub/sub broadcast transport: live
 * delivery is Expo push + polling, per .windsurfrules.
 *
 * Lazy singleton so importing this module never throws in environments
 * without UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN set (tests,
 * scripts that don't touch the cache).
 */
let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = Redis.fromEnv();
  }
  return client;
}
