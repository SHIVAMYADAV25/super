import IORedis from "ioredis";

// Only instantiated when actually imported (worker in prod).
// queueEmailEnrichment() in priority-queue.ts creates its own connection
// so this module is only used by priority-worker.ts.
if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required for BullMQ worker in production");
}

export const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});