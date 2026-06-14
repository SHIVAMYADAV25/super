// import { env } from "@/src/env";
// import { logger } from "@/src/lib/logger";
// import { EmailPriority } from "@/src/types";
// import { db } from "../db";
// import { emails } from "../db/schema/emails";
// import { storeEmailEmbedding } from "./search.service";
// import { and, eq } from "drizzle-orm";

// let openaiClient: import("openai").default | null = null;
 
// async function getOpenAIClient() {
//   if (!env.OPENAI_API_KEY) return null;
//   if (!openaiClient) {
//     const { default: OpenAI } = await import("openai");
//     openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
//   }
//   return openaiClient;
// }
 

// export async function classifyEmailPriority(
//     subject :string,
//     snippet : string
// ):Promise<EmailPriority>{
//     const client = await getOpenAIClient();

//     if (!client) return "normal";

//     const prompt = `Classify this email's priority level. Reply with exactly one word: high, normal, or low.
 
// Subject: ${subject.slice(0, 200)}
// Preview: ${snippet.slice(0, 300)}
 
// Priority:`;

//     try{
//         const response = await client.chat.completions.create({
//             model : "gpt-4o-mini",
//             messages : [{role : "user",content : prompt}],
//             max_tokens : 5,
//             temperature : 0 
//         })

//         const raw = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";

//         if(raw === "high" || raw === "low") return raw;

//         return "normal"
//     }catch(err){
//     logger.warn("Priority classification failed", { error: String(err) });
//     return "normal";
//     }
// }

// // Background job payload 

// export interface EmailEnrichmentJob{
//     userId : string;
//     gmailId : string;
//     subject : string;
//     snippet : string;
//     body : string;
// }

// /**
//  * Run all enrichment for an email:
//  * 1. Classify priority via LLM
//  * 2. Generate + store embedding for semantic search
//  */

// export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
//   const { userId, gmailId, subject, snippet, body } = job;

//     try {
//         // 1. Priority classification
//         const priority = await classifyEmailPriority(subject, snippet);

//         // 2. Embedding from subject + first 2000 chars of body
//         const textForEmbedding = `${subject}\n\n${body.slice(0, 2000)}`;
//         await storeEmailEmbedding(userId, gmailId, textForEmbedding);

//         // 3. Update priority in DB
//         await db
//         .update(emails)
//         .set({ priority, updatedAt: new Date() })
//         .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));

//         logger.debug("Email enriched", { userId, gmailId, priority });
//     } catch (err) {
//         logger.error("Email enrichment failed", { userId, gmailId, error: String(err) });
//     }
// }

/**
 * Priority classification service.
 * Uses the active LLM provider (llm-provider.ts) — no hardcoded OpenAI import.
 * Cheap models (gpt-4o-mini or OpenRouter free) work fine here since
 * the task is just a single-word classification.
 */

import { logger } from "@/src/lib/logger";
import { EmailPriority } from "@/src/types";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { storeEmailEmbedding } from "./search.service";
import { and, eq } from "drizzle-orm";
import { getChatClient, ACTIVE_CHAT_MODEL } from "../lib/llm-provider";
import { emitToUser } from "../lib/sse";

const CLASSIFICATION_PROMPT = (subject: string, snippet: string) =>
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

    if (client.kind === "anthropic") {
      const response = await client.anthropic!.messages.create({
        model: client.model,
        max_tokens: 5,
        messages: [{ role: "user", content: CLASSIFICATION_PROMPT(subject, snippet) }],
      });

      const raw =
        response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim()
          .toLowerCase();

      if (raw === "high" || raw === "low") return raw;
      return "normal";
    } else {
      // OpenRouter / OpenAI-compatible
      const completion = await client.openai!.chat.completions.create({
        model: client.model,
        max_tokens: 5,
        temperature: 0,
        messages: [{ role: "user", content: CLASSIFICATION_PROMPT(subject, snippet) }],
      });

      const raw =
        completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "normal";

      if (raw === "high" || raw === "low") return raw;
      return "normal";
    }
  } catch (err) {
    logger.warn("Priority classification failed", { error: String(err) });
    return "normal";
  }
}

export interface EmailEnrichmentJob {
  userId: string;
  gmailId: string;
  subject: string;
  snippet: string;
  body: string;
}

/**
 * Run all enrichment steps for an email:
 * 1. Classify priority via LLM
 * 2. Generate + store embedding for semantic search
 * 3. Persist priority in DB
 */
export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
  const { userId, gmailId, subject, snippet, body } = job;

  logger.info("CLASSIFYING EMAIL", {
  gmailId,
  subject,
});

try {
  logger.info("START EMBEDDING", { gmailId });

  const [priority] = await Promise.all([
    classifyEmailPriority(subject, snippet),
    storeEmailEmbedding(
      userId,
      gmailId,
      `${subject}\n\n${body.slice(0, 2000)}`
    ),
  ]);

  logger.info("EMBEDDING DONE", { gmailId });

  logger.info("UPDATING DB", {
    gmailId,
    priority,
  });

  await db
    .update(emails)
    .set({
      priority,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emails.userId, userId),
        eq(emails.gmailId, gmailId)
      )
    );

  logger.info("DB UPDATED", {
    gmailId,
  });

  emitToUser(userId, {
    type: "email_enriched",
    data: {
      gmailId,
      priority,
    },
  });

  logger.debug("Email enriched", {
    userId,
    gmailId,
    priority,
  });
} catch (err) {
  logger.error("Email enrichment failed", {
    userId,
    gmailId,
    error: String(err),
    stack:
      err instanceof Error
        ? err.stack
        : undefined,
  });
}

}