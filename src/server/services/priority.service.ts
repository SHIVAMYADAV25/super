// // import { env } from "@/src/env";
// // import { logger } from "@/src/lib/logger";
// // import { EmailPriority } from "@/src/types";
// // import { db } from "../db";
// // import { emails } from "../db/schema/emails";
// // import { storeEmailEmbedding } from "./search.service";
// // import { and, eq } from "drizzle-orm";

// // let openaiClient: import("openai").default | null = null;
 
// // async function getOpenAIClient() {
// //   if (!env.OPENAI_API_KEY) return null;
// //   if (!openaiClient) {
// //     const { default: OpenAI } = await import("openai");
// //     openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
// //   }
// //   return openaiClient;
// // }
 

// // export async function classifyEmailPriority(
// //     subject :string,
// //     snippet : string
// // ):Promise<EmailPriority>{
// //     const client = await getOpenAIClient();

// //     if (!client) return "normal";

// //     const prompt = `Classify this email's priority level. Reply with exactly one word: high, normal, or low.
 
// // Subject: ${subject.slice(0, 200)}
// // Preview: ${snippet.slice(0, 300)}
 
// // Priority:`;

// //     try{
// //         const response = await client.chat.completions.create({
// //             model : "gpt-4o-mini",
// //             messages : [{role : "user",content : prompt}],
// //             max_tokens : 5,
// //             temperature : 0 
// //         })

// //         const raw = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";

// //         if(raw === "high" || raw === "low") return raw;

// //         return "normal"
// //     }catch(err){
// //     logger.warn("Priority classification failed", { error: String(err) });
// //     return "normal";
// //     }
// // }

// // // Background job payload 

// // export interface EmailEnrichmentJob{
// //     userId : string;
// //     gmailId : string;
// //     subject : string;
// //     snippet : string;
// //     body : string;
// // }

// // /**
// //  * Run all enrichment for an email:
// //  * 1. Classify priority via LLM
// //  * 2. Generate + store embedding for semantic search
// //  */

// // export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
// //   const { userId, gmailId, subject, snippet, body } = job;

// //     try {
// //         // 1. Priority classification
// //         const priority = await classifyEmailPriority(subject, snippet);

// //         // 2. Embedding from subject + first 2000 chars of body
// //         const textForEmbedding = `${subject}\n\n${body.slice(0, 2000)}`;
// //         await storeEmailEmbedding(userId, gmailId, textForEmbedding);

// //         // 3. Update priority in DB
// //         await db
// //         .update(emails)
// //         .set({ priority, updatedAt: new Date() })
// //         .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));

// //         logger.debug("Email enriched", { userId, gmailId, priority });
// //     } catch (err) {
// //         logger.error("Email enrichment failed", { userId, gmailId, error: String(err) });
// //     }
// // }

// /**
//  * Priority classification service.
//  * Uses the active LLM provider (llm-provider.ts) — no hardcoded OpenAI import.
//  * Cheap models (gpt-4o-mini or OpenRouter free) work fine here since
//  * the task is just a single-word classification.
//  */

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

/**
 * priority.service.ts
 *
 * Classifies email priority via LLM and stores embedding.
 * After enrichment completes, emits a surgical SSE event so the UI
 * can update ONLY that email's priority badge — no full refetch.
 */

// import { and, eq } from "drizzle-orm";
// import { db } from "../db";
// import { emails } from "../db/schema/emails";
// import { getChatClient, ACTIVE_CHAT_MODEL } from "../lib/llm-provider";
// import { storeEmailEmbedding } from "./search.service";
// import { emitToUser } from "../lib/sse";
// import { getTenantId } from "../lib/corsair";
// import { logger } from "@/src/lib/logger";
// import type { EmailPriority } from "@/src/types";

// // ─── Classification ───────────────────────────────────────────────────────────

// const buildPrompt = (subject: string, snippet: string) =>
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

//     let raw: string;

//     if (client.kind === "anthropic") {
//       const response = await client.anthropic!.messages.create({
//         model: client.model,
//         max_tokens: 5,
//         messages: [{ role: "user", content: buildPrompt(subject, snippet) }],
//       });
//       raw = response.content
//         .filter((b) => b.type === "text")
//         .map((b) => (b as { text: string }).text)
//         .join("")
//         .trim()
//         .toLowerCase();
//     } else {
//       const completion = await client.openai!.chat.completions.create({
//         model: client.model,
//         max_tokens: 5,
//         temperature: 0,
//         messages: [{ role: "user", content: buildPrompt(subject, snippet) }],
//       });
//       raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";
//     }

//     if (raw === "high" || raw === "low") return raw;
//     return "normal";
//   } catch (err) {
//     logger.warn("classifyEmailPriority failed — defaulting to normal", { error: String(err) });
//     return "normal";
//   }
// }

// // ─── Enrichment job ───────────────────────────────────────────────────────────

// export interface EmailEnrichmentJob {
//   userId: string;
//   /** Raw Google `sub` — getTenantId() wraps this before SSE emit */
//   tenantId: string;
//   gmailId: string;
//   subject: string;
//   snippet: string;
//   body: string;
// }

// /**
//  * Run enrichment for a single email:
//  * 1. Classify priority via LLM
//  * 2. Generate + store embedding
//  * 3. Persist priority to DB
//  * 4. SSE push — only the affected gmailId + new priority
//  */
// export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
//   const { userId, tenantId, gmailId, subject, snippet, body } = job;

//   logger.info("enrichEmail: start", { gmailId, subject: subject.slice(0, 60) });

//   try {
//     // Run classification and embedding generation in parallel
//     const [priority] = await Promise.all([
//       classifyEmailPriority(subject, snippet),
//       storeEmailEmbedding(userId, gmailId, `${subject}\n\n${body.slice(0, 2000)}`),
//     ]);

//     // Persist priority — never downgrade an already-classified email
//     await db
//       .update(emails)
//       .set({ priority, updatedAt: new Date() })
//       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));

//     logger.info("enrichEmail: complete", { gmailId, priority });

//     // Surgical SSE push — UI updates ONLY this email's priority badge
//     emitToUser(getTenantId(tenantId), {
//       type: "email_enriched",
//       data: { gmailId, priority },
//     });
//   } catch (err) {
//     logger.error("enrichEmail failed", {
//       userId,
//       gmailId,
//       error: String(err),
//       stack: err instanceof Error ? err.stack : undefined,
//     });
//     // Do NOT re-throw — the queue runner handles logging; we just absorb here
//   }
// }

/**
 * priority.service.ts
 *
 * - classifyEmailPriority: LLM call → "high" | "normal" | "low"
 * - enrichEmail: runs classification + embedding, persists priority,
 *   and emits a surgical SSE "email_enriched" event so the UI updates
 *   only that one row's badge.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { getChatClient, ACTIVE_CHAT_MODEL } from "../lib/llm-provider";
import { storeEmailEmbedding } from "./search.service";
import { emitToUser } from "../lib/sse";
import { getTenantId } from "../lib/corsair";
import { logger } from "@/src/lib/logger";
import type { EmailPriority } from "@/src/types";
import type { EmailEnrichmentJob } from "@/src/jobs/priority-queue";

const buildPrompt = (subject: string, snippet: string) =>
  `Classify this email's priority. Reply with EXACTLY one word: high, normal, or low.

Subject: ${subject.slice(0, 200)}
Preview: ${snippet.slice(0, 300)}

Priority:`;

export async function classifyEmailPriority(
  subject: string,
  snippet: string,
): Promise<EmailPriority> {
  try {
    const client = getChatClient(ACTIVE_CHAT_MODEL);
    let raw: string;

    if (client.kind === "anthropic") {
      const response = await client.anthropic!.messages.create({
        model: client.model,
        max_tokens: 5,
        messages: [{ role: "user", content: buildPrompt(subject, snippet) }],
      });
      raw = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("")
        .trim()
        .toLowerCase();
    } else {
      const completion = await client.openai!.chat.completions.create({
        model: client.model,
        max_tokens: 5,
        temperature: 0,
        messages: [{ role: "user", content: buildPrompt(subject, snippet) }],
      });
      raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";
    }

    if (raw === "high" || raw === "low") return raw;
    return "normal";
  } catch (err) {
    logger.warn("classifyEmailPriority failed — defaulting to normal", { error: String(err) });
    return "normal";
  }
}

/**
 * Run enrichment for a single email:
 * 1. Classify priority via LLM
 * 2. Generate + store embedding
 * 3. Persist priority to DB
 * 4. SSE push — only the affected gmailId + new priority
 *
 * Never throws — failures are logged and absorbed so the queue stays healthy.
 */
export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
  const { userId, googleSub, gmailId, subject, snippet, body } = job;

  logger.info("enrichEmail: start", { gmailId, subject: subject.slice(0, 60) });

  try {
    const [priority] = await Promise.all([
      classifyEmailPriority(subject, snippet),
      storeEmailEmbedding(userId, gmailId, `${subject}\n\n${body.slice(0, 2000)}`),
    ]);

    await db
      .update(emails)
      .set({ priority, updatedAt: new Date() })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));

    logger.info("enrichEmail: complete", { gmailId, priority });

    emitToUser(getTenantId(googleSub), {
      type: "email_enriched",
      data: { gmailId, priority },
    });
  } catch (err) {
    logger.error("enrichEmail failed", {
      userId,
      gmailId,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}