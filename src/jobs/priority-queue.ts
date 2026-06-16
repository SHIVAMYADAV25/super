

// // Simple in-process queue — swap for BullMQ/Redis in production

// import { logger } from "../lib/logger";

// // p-queue limits concurrency so we don't flood OpenAI
// let queue : import("p-queue").default | null = null


// async function getQueue() {
//     if(!queue){
//         const {default : PQueue} = await import("p-queue");
//         queue = new PQueue({
//             concurrency: 2,          // max 2 OpenAI calls at once
//             intervalCap: 10,         // max 10 jobs per interval
//             interval: 60_000,        // per minute (OpenAI rate limits)
//             timeout: 30_000,         // 30s per job timeout
//         })

//         queue.on("error",(err) =>{
//             logger.error("Job queue error" , {error: String(err)})
//         });
//     }

//     return queue;
// } 

// /**
//  * Queue an email enrichment job (priority + embedding).
//  * Fire-and-forget — never awaited by callers.
//  */

// export async function queueEmailEmbedding(job:EmailE) {
    
// }

/**
 * In-process job queue for email enrichment.
 * Concurrency-limited to avoid flooding LLM APIs.
 * Swap for BullMQ/Redis in production for persistence.
 */

// import { logger } from "../lib/logger";

// export interface EmailEnrichmentJob {
//   userId: string;
//   tenantId: string;   // ADD THIS — googleSub, needed for SSE emit channel
//   gmailId: string;
//   subject: string;
//   snippet: string;
//   body: string;
// }

// // Keep type alias for backward compat (old callers used EmailE)
// type EmailE = EmailEnrichmentJob;

// let queue: import("p-queue").default | null = null;

// async function getQueue() {
//   if (!queue) {
//     const { default: PQueue } = await import("p-queue");
//     queue = new PQueue({
//       concurrency: 5,       // max 2 LLM calls at once
//       intervalCap: 10,      // max 10 jobs per minute
//       interval: 60_000,
//       timeout: 30_000,
//     });

//     queue.on("error", (err) => {
//       logger.error("Job queue error", { error: String(err) });
//     });
//   }
//   return queue;
// }

// /**
//  * Queue an email enrichment job (priority classification + embedding).
//  * Fire-and-forget — callers never await this.
//  */
// const inFlight = new Set<string>();

// export async function queueEmailEmbedding(job: EmailEnrichmentJob): Promise<void> {
//   if (inFlight.has(job.gmailId)) {
//     logger.debug("Skipping duplicate enrichment job (already in flight)", { gmailId: job.gmailId });
//     return;
//   }
//   inFlight.add(job.gmailId);

//   try {
//     const q = await getQueue();
//     void q.add(async () => {
//       try {
//         logger.debug("Enrichment job started", { gmailId: job.gmailId });
//         const { enrichEmail } = await import("../server/services/priority.service");
//         await enrichEmail(job);
//       } catch (err) {
//         logger.error("Enrichment job failed", {
//           userId: job.userId,
//           gmailId: job.gmailId,
//           error: String(err),
//         });
//       } finally {
//         inFlight.delete(job.gmailId);
//       }
//     });
//   } catch (err) {
//     inFlight.delete(job.gmailId);
//     logger.warn("Failed to queue enrichment job", { error: String(err) });
//   }
// }



/**
 * priority-queue.ts — in-process concurrency-limited queue for email enrichment.
 * Swap for BullMQ/Redis in production for persistence across restarts.
 */

import { logger } from "@/src/lib/logger";
import { emitToUser } from "../server/lib/sse";
import { getTenantId } from "../server/lib/corsair";

export interface EmailEnrichmentJob {
  userId: string;     // internal DB user UUID
  googleSub: string;  // raw Google sub — used to derive tenantId for SSE + Corsair
  gmailId: string;
  subject: string;
  snippet: string;
  body: string;
}

let queue: import("p-queue").default | null = null;

async function getQueue() {
  if (!queue) {
    const { default: PQueue } = await import("p-queue");
    queue = new PQueue({
      concurrency: 3,
      intervalCap: 10,
      interval: 60_000,
      timeout: 30_000,
    });
    queue.on("error", (err) => {
      logger.error("priority-queue error", { error: String(err) });
    });
  }
  return queue;
}

// Dedup guard so the same email isn't enriched twice concurrently.
const inFlight = new Set<string>();

function jobKey(job: EmailEnrichmentJob): string {
  return `${job.userId}:${job.gmailId}`;
}

/**
 * Queue an enrichment job (priority classification + embedding).
 * Fire-and-forget — never awaited by callers.
 */
export async function queueEmailEnrichment(job: EmailEnrichmentJob): Promise<void> {
  const key = jobKey(job);
  if (inFlight.has(key)) {
    logger.debug("Enrichment already in flight, skipping", { gmailId: job.gmailId });
    return;
  }
  inFlight.add(key);

  try {
    const q = await getQueue();
    void q.add(async () => {
      try {
        const { enrichEmail } = await import("../server/services/priority.service");
        await enrichEmail(job);
      } catch (err) {
        logger.error("Enrichment job failed", {
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
    logger.warn("Failed to enqueue enrichment job", { error: String(err) });
  }
}

