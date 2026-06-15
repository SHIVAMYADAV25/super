

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
  tenantId: string;   // ADD THIS — googleSub, needed for SSE emit channel
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
      concurrency: 5,       // max 2 LLM calls at once
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
    logger.debug("Enrichment job started", { gmailId: job.gmailId });
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




// import { logger } from "@/src/lib/logger";
// import { EmailPriority } from "@/src/types";
// import { db } from "../db";
// import { emails } from "../db/schema/emails";
// import { storeEmailEmbedding } from "./search.service";
// import { and, eq } from "drizzle-orm";
// import { getChatClient, ACTIVE_CHAT_MODEL } from "../lib/llm-provider";
// import { emitToUser } from "../lib/sse";
// import { getTenantId } from "../lib/corsair";



// const CLASSIFICATION_PROMPT = (subject: string, snippet: string) =>
//   `Classify this email's priority. Reply with EXACTLY one word: high, normal, or low.

// Subject: ${subject.slice(0, 200)}
// Preview: ${snippet.slice(0, 300)}

// Priority:`;

// export async function classifyEmailPriority(
//   subject: string,
//   snippet: string,
// ): Promise<EmailPriority> {
//   try {
//     const client = getChatClient(ACTIVE_CHAT_MODEL);

//     if (client.kind === "anthropic") {
//       const response = await client.anthropic!.messages.create({
//         model: client.model,
//         max_tokens: 5,
//         messages: [{ role: "user", content: CLASSIFICATION_PROMPT(subject, snippet) }],
//       });

//       const raw =
//         response.content
//           .filter((b) => b.type === "text")
//           .map((b) => b.text)
//           .join("")
//           .trim()
//           .toLowerCase();

//       if (raw === "high" || raw === "low") return raw;
//       return "normal";
//     } else {
//       // OpenRouter / OpenAI-compatible
//       const completion = await client.openai!.chat.completions.create({
//         model: client.model,
//         max_tokens: 5,
//         temperature: 0,
//         messages: [{ role: "user", content: CLASSIFICATION_PROMPT(subject, snippet) }],
//       });

//       const raw =
//         completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";

//       if (raw === "high" || raw === "low") return raw;
//       return "normal";
//     }
//   } catch (err) {
//     logger.warn("Priority classification failed", { error: String(err) });
//     return "normal";
//   }
// }

// export interface EmailEnrichmentJob {
//   userId: string;
//   tenantId: string;
//   gmailId: string;
//   subject: string;
//   snippet: string;
//   body: string;
// }

// /**
//  * Run all enrichment steps for an email:
//  * 1. Classify priority via LLM
//  * 2. Generate + store embedding for semantic search
//  * 3. Persist priority in DB
//  */
// export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
//   const {
//   userId,
//   tenantId,
//   gmailId,
//   subject,
//   snippet,
//   body,
// } = job;

//   logger.info("CLASSIFYING EMAIL", {
//   gmailId,
//   subject,
// });

// try {
//   logger.info("START EMBEDDING", { gmailId });

//   const [priority] = await Promise.all([
//     classifyEmailPriority(subject, snippet),
//     storeEmailEmbedding(
//       userId,
//       gmailId,
//       `${subject}\n\n${body.slice(0, 2000)}`
//     ),
//   ]);

//   logger.info("EMBEDDING DONE", { gmailId });

//   logger.info("UPDATING DB", {
//     gmailId,
//     priority,
//   });

//   await db
//     .update(emails)
//     .set({
//       priority,
//       updatedAt: new Date(),
//     })
//     .where(
//       and(
//         eq(emails.userId, userId),
//         eq(emails.gmailId, gmailId)
//       )
//     );

//   logger.info("DB UPDATED", {
//     gmailId,
//   });

//   emitToUser(getTenantId(tenantId), {
//     type: "email_enriched",
//     data: {
//       gmailId,
//       priority,
//     },
//   });

//   logger.debug("Email enriched", {
//     userId,
//     gmailId,
//     priority,
//   });
// } catch (err) {
//   logger.error("Email enrichment failed", {
//     userId,
//     gmailId,
//     error: String(err),
//     stack:
//       err instanceof Error
//         ? err.stack
//         : undefined,
//   });
// }

// }


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
// export async function queueEmailEmbedding(job: EmailEnrichmentJob): Promise<void> {
//   try {
//     const q = await getQueue();

//     void q.add(async () => {
//   try {
//     logger.debug("Enrichment job started", { gmailId: job.gmailId });
//     // Dynamic import to avoid circular deps at module load time
//     const { enrichEmail } = await import("../server/services/priority.service");
    
//     await enrichEmail(job);
//       } catch (err) {
//         logger.error("Enrichment job failed", {
//           userId: job.userId,
//           gmailId: job.gmailId,
//           error: String(err),
//         });
//       }
//     });
//   } catch (err) {
//     logger.warn("Failed to queue enrichment job", { error: String(err) });
//   }
// }

// each and every table has embedding still there is insertion embedding priortizing is happing and i don't know why

// because of that the google token good over