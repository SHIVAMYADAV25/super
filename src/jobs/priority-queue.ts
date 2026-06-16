// /**
//  * priority-queue.ts — in-process concurrency-limited queue for email enrichment.
//  * Swap for BullMQ/Redis in production for persistence across restarts.
//  */

// import { logger } from "@/src/lib/logger";

// export interface EmailEnrichmentJob {
//   userId: string;     // internal DB user UUID
//   googleSub: string;  // raw Google sub — used to derive tenantId for SSE + Corsair
//   gmailId: string;
//   subject: string;
//   snippet: string;
//   body: string;
// }

// let queue: import("p-queue").default | null = null;

// async function getQueue() {
//   if (!queue) {
//     const { default: PQueue } = await import("p-queue");
//     queue = new PQueue({
//       concurrency: 3,
//       intervalCap: 10,
//       interval: 60_000,
//       timeout: 30_000,
//     });
//     queue.on("error", (err) => {
//       logger.error("priority-queue error", { error: String(err) });
//     });
//   }
//   return queue;
// }

// // Dedup guard so the same email isn't enriched twice concurrently.
// const inFlight = new Set<string>();

// function jobKey(job: EmailEnrichmentJob): string {
//   return `${job.userId}:${job.gmailId}`;
// }

// /**
//  * Queue an enrichment job (priority classification + embedding).
//  * Fire-and-forget — never awaited by callers.
//  */
// export async function queueEmailEnrichment(job: EmailEnrichmentJob): Promise<void> {
//   const key = jobKey(job);
//   if (inFlight.has(key)) {
//     logger.debug("Enrichment already in flight, skipping", { gmailId: job.gmailId });
//     return;
//   }
//   inFlight.add(key);

//   try {
//     const q = await getQueue();
//     void q.add(async () => {
//       try {
//         const { enrichEmail } = await import("../server/services/priority.service");
//         await enrichEmail(job);
//       } catch (err) {
//         logger.error("Enrichment job failed", {
//           userId: job.userId,
//           gmailId: job.gmailId,
//           error: String(err),
//         });
//       } finally {
//         inFlight.delete(key);
//       }
//     });
//   } catch (err) {
//     inFlight.delete(key);
//     logger.warn("Failed to enqueue enrichment job", { error: String(err) });
//   }
// }



/**
 * Persistent email enrichment queue.
 *
 * Uses BullMQ + Redis.
 *
 * API remains unchanged:
 *
 * await queueEmailEnrichment(job)
 */

import { Queue } from "bullmq";
import { logger } from "@/src/lib/logger";
import { redis } from "./redis-bullmq";

export interface EmailEnrichmentJob {
  userId: string;
  googleSub: string;
  gmailId: string;
  subject: string;
  snippet: string;
  body: string;
}

const enrichmentQueue = new Queue("email-enrichment", {
  connection: redis,
});

function jobKey(job: EmailEnrichmentJob): string {
  return `${job.userId}:${job.gmailId}`;
}

/**
 * Same API as before.
 */
export async function queueEmailEnrichment(
  job: EmailEnrichmentJob,
): Promise<void> {
  try {
    await enrichmentQueue.add(
      "enrich-email",
      job,
      {
        jobId: jobKey(job), // dedupe
        removeOnComplete: 1000,
        removeOnFail: 1000,

        attempts: 3,

        backoff: {
          type: "exponential",
          delay: 5000,
        },
      },
    );
  } catch (err) {
    logger.error("Failed to enqueue enrichment job", {
      gmailId: job.gmailId,
      error: String(err),
    });
  }
}