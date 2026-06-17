/**
 * priority-queue.ts
 *
 * DEV  (NODE_ENV !== "production"):  in-process p-queue, no Redis needed.
 * PROD (NODE_ENV === "production"):  BullMQ + Redis (REDIS_URL env var).
 *
 * Both paths expose the same API:
 *   await queueEmailEnrichment(job)
 *
 * To use BullMQ in prod you also need the worker running.
 * In Next.js App Router, start it in instrumentation.ts:
 *
 *   // instrumentation.ts (project root)
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME === "nodejs" &&
 *         process.env.NODE_ENV === "production") {
 *       await import("./src/jobs/priority-worker");
 *     }
 *   }
 */

import { logger } from "@/src/lib/logger";

export interface EmailEnrichmentJob {
  userId: string;    // internal DB user UUID
  googleSub: string; // raw Google sub — used to derive tenantId for SSE + Corsair
  gmailId: string;
  subject: string;
  snippet: string;
  body: string;
}

function jobKey(job: EmailEnrichmentJob): string {
  return `${job.userId}:${job.gmailId}`;
}

// ─── PRODUCTION: BullMQ ───────────────────────────────────────────────────────

async function queueWithBullMQ(job: EmailEnrichmentJob): Promise<void> {
  const { Queue } = await import("bullmq");
  const IORedis = (await import("ioredis")).default;

  // Lazy-init so the connection is only created when the first job is queued
  const redis = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

  const enrichmentQueue = new Queue("email-enrichment", {
    connection: redis,
  });

  try {
    await enrichmentQueue.add("enrich-email", job, {
      jobId: jobKey(job),       // BullMQ dedupes by jobId — same as inFlight Set in dev
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000,
      },
    });
    logger.debug("BullMQ: enrichment job enqueued", { gmailId: job.gmailId });
  } catch (err) {
    logger.error("BullMQ: failed to enqueue enrichment job", {
      gmailId: job.gmailId,
      error: String(err),
    });
  }
}

// ─── DEVELOPMENT: p-queue ─────────────────────────────────────────────────────

let _pqueue: import("p-queue").default | null = null;

async function getPQueue() {
  if (!_pqueue) {
    const { default: PQueue } = await import("p-queue");
    _pqueue = new PQueue({
      concurrency: 3,
      intervalCap: 10,
      interval: 60_000,
      timeout: 30_000,
    });
    _pqueue.on("error", (err) => {
      logger.error("p-queue error", { error: String(err) });
    });
  }
  return _pqueue;
}

// Dedup guard — BullMQ uses jobId for this; p-queue needs it manually.
const inFlight = new Set<string>();

async function queueWithPQueue(job: EmailEnrichmentJob): Promise<void> {
  const key = jobKey(job);

  if (inFlight.has(key)) {
    logger.debug("p-queue: enrichment already in flight, skipping", {
      gmailId: job.gmailId,
    });
    return;
  }

  inFlight.add(key);

  try {
    const q = await getPQueue();
    void q.add(async () => {
      try {
        const { enrichEmail } = await import(
          "../server/services/priority.service"
        );
        await enrichEmail(job);
      } catch (err) {
        logger.error("p-queue: enrichment job failed", {
          userId: job.userId,
          gmailId: job.gmailId,
          error: String(err),
        });
      } finally {
        inFlight.delete(key);
      }
    });
  } catch (err) {
    inFlight.delete(key);
    logger.warn("p-queue: failed to add job to queue", { error: String(err) });
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

export async function queueEmailEnrichment(
  job: EmailEnrichmentJob,
): Promise<void> {
  if (IS_PROD) {
    if (!process.env.REDIS_URL) {
      logger.warn(
        "REDIS_URL not set in production — falling back to p-queue. " +
        "Set REDIS_URL to enable persistent BullMQ queue.",
      );
      return queueWithPQueue(job);
    }
    return queueWithBullMQ(job);
  }

  return queueWithPQueue(job);
}