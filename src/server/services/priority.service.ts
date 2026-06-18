
/**
 * priority.service.ts
 *
 * Classifies email priority via LLM and stores embedding.
 * After enrichment completes, emits a surgical SSE "email_enriched" event
 * so the UI can update ONLY that email's priority badge — no full refetch.
 *
 * ─── BUG FIXES ────────────────────────────────────────────────────────────────
 *
 * FIX 3 — Promise.all races classification against embedding; one failure
 *          discards both results (CRITICAL)
 *
 *   BEFORE:
 *     const [priority] = await Promise.all([
 *       classifyEmailPriority(subject, snippet),
 *       storeEmailEmbedding(userId, gmailId, text),   // throws on dim mismatch
 *     ]);
 *     // ^ Promise.all rejects on the FIRST rejection.
 *     // Even though classifyEmailPriority() resolved successfully, its value
 *     // is lost.  The outer catch absorbs the error, priority is never written
 *     // to the DB, and no SSE is emitted.  With the default openai-3-small
 *     // model vs the old vector(768) column this meant 100 % of enrichment
 *     // jobs silently failed — both AI Priority Filtering AND Semantic Search
 *     // bonus features were completely broken in production.
 *
 *   AFTER:
 *     We run classification and embedding independently.
 *     - classifyEmailPriority is awaited first; its result is always persisted
 *       and SSE-emitted regardless of what happens to the embedding step.
 *     - storeEmailEmbedding is attempted separately; failures are logged and
 *       swallowed so a bad embedding never rolls back a good priority.
 *     - Now that the vector dimension bug (FIX 1) is also fixed, both steps
 *       should succeed together — but the decoupled structure means a future
 *       model change or transient embedding error won't break priority.
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

// ─── Classification ───────────────────────────────────────────────────────────

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
    logger.warn("classifyEmailPriority failed — defaulting to normal", {
      error: String(err),
    });
    return "normal";
  }
}

// ─── Enrichment job ───────────────────────────────────────────────────────────

/**
 * Run enrichment for a single email:
 * 1. Classify priority via LLM  ← always persisted + SSE-emitted
 * 2. Generate + store embedding  ← attempted independently; failure is logged
 *    but does NOT cancel the priority write (FIX 3).
 *
 * Never throws — failures are logged and absorbed so the BullMQ queue stays
 * healthy and doesn't retry infinitely on a broken embedding provider.
 */
export async function enrichEmail(job: EmailEnrichmentJob): Promise<void> {
  const { userId, googleSub, gmailId, subject, snippet, body } = job;

  logger.info("enrichEmail: start", { gmailId, subject: subject.slice(0, 60) });

  // ── Step 1: Priority classification ──────────────────────────────────────
  // This is the high-value step — always run it first and persist the result
  // even if the embedding step below fails.
  let priority: EmailPriority = "normal";
  try {
    priority = await classifyEmailPriority(subject, snippet);
  } catch (err) {
    // classifyEmailPriority already catches internally and returns "normal",
    // but guard here just in case.
    logger.warn("enrichEmail: classification threw unexpectedly", {
      gmailId,
      error: String(err),
    });
  }

  // ── Step 2: Persist priority to DB ────────────────────────────────────────
  // Do this BEFORE attempting the embedding so a slow/failing embedding call
  // can never block the priority write.
  try {
    await db
      .update(emails)
      .set({ priority, updatedAt: new Date() })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));

    logger.info("enrichEmail: priority persisted", { gmailId, priority });
  } catch (err) {
    logger.error("enrichEmail: DB priority write failed", {
      userId,
      gmailId,
      priority,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Priority write failed — still emit SSE with the classified priority so
    // the UI is at least temporarily correct until next page load.
  }

  // ── Step 3: Emit SSE — surgical update for this email's badge only ────────
  try {
    emitToUser(getTenantId(googleSub), {
      type: "email_enriched",
      data: { gmailId, priority },
    });
  } catch (err) {
    logger.warn("enrichEmail: SSE emit failed", { gmailId, error: String(err) });
  }

  // ── Step 4: Embedding (independent — failure must NOT affect priority) ────
  // FIX 3: This is now fully decoupled from the priority steps above.
  // A vector dimension mismatch, missing API key, or any other embedding error
  // will be logged but will NOT cause the enrichment job to be marked as failed
  // in BullMQ (which would cause unnecessary retries and log spam).
  try {
    const textForEmbedding = `${subject}\n\n${body.slice(0, 2000)}`;
    await storeEmailEmbedding(userId, gmailId, textForEmbedding);
    logger.info("enrichEmail: embedding stored", { gmailId });
  } catch (err) {
    // Log as warn, not error — embedding failure is recoverable (the email is
    // still classified; semantic search just won't include this email until the
    // embedding is re-generated on the next enrichment pass).
    logger.warn("enrichEmail: embedding storage failed (non-fatal)", {
      gmailId,
      error: String(err),
    });
  }

  logger.info("enrichEmail: complete", { gmailId, priority });
}