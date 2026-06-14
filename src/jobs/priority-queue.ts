

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

import { logger } from "../lib/logger";

export interface EmailEnrichmentJob {
  userId: string;
  gmailId: string;
  subject: string;
  snippet: string;
  body: string;
}

// Keep type alias for backward compat (old callers used EmailE)
type EmailE = EmailEnrichmentJob;

let queue: import("p-queue").default | null = null;

async function getQueue() {
  if (!queue) {
    const { default: PQueue } = await import("p-queue");
    queue = new PQueue({
      concurrency: 2,       // max 2 LLM calls at once
      intervalCap: 10,      // max 10 jobs per minute
      interval: 60_000,
      timeout: 30_000,
    });

    queue.on("error", (err) => {
      logger.error("Job queue error", { error: String(err) });
    });
  }
  return queue;
}

/**
 * Queue an email enrichment job (priority classification + embedding).
 * Fire-and-forget — callers never await this.
 */
export async function queueEmailEmbedding(job: EmailEnrichmentJob): Promise<void> {
  try {
    const q = await getQueue();

    void q.add(async () => {
      try {
        // Dynamic import to avoid circular deps at module load time
        const { enrichEmail } = await import("../server/services/priority.service");
        
        await enrichEmail(job);
      } catch (err) {
        logger.error("Enrichment job failed", {
          userId: job.userId,
          gmailId: job.gmailId,
          error: String(err),
        });
      }
    });
  } catch (err) {
    logger.warn("Failed to queue enrichment job", { error: String(err) });
  }
}