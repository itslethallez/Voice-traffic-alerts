/**
 * Fan-out for a freshly-ingested alert. Deliberately a no-op placeholder:
 *
 * - Live delivery is Expo push notifications to opted-in devices (Phase 1),
 *   plus the 15-30s foreground poll of GET /alerts/nearby - there is no
 *   pub/sub broadcast layer in this stack (see .windsurfrules).
 * - Cache invalidation for the corridor query's Upstash keys lands here
 *   once that endpoint exists.
 * - If fan-out ever needs async retries or many receivers, it goes through
 *   QStash - never a worker process.
 */
export async function notifyNewAlert(_alert: { id: string }): Promise<void> {
  // Phase 0 placeholder - see comment above.
}
