/**
 * search.service.ts
 *
 * Hybrid search: text → DB → Gmail API (with full metadata) + semantic (pgvector).
 *
 * Key fixes vs previous version:
 * - Gmail API fallback now fetches full metadata (subject, from, snippet, date) —
 *   no more "(loading...)" titles.
 * - Text search checks fromAddr, subject, snippet, body in one DB query.
 * - Results are scored by match quality so closest matches come first.
 * - Dedup across all sources by gmailId.
 */

import { sql, eq, and, or, ilike } from "drizzle-orm";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { getTenant } from "../lib/corsair";
import { getEmbedding, EMBEDDING_DIM } from "../lib/llm-provider";
import { logger } from "@/src/lib/logger";
import type { SearchInput } from "@/src/schema";
import type { SearchResult } from "@/src/types";

// ─── Scoring helpers ───────────────────────────────────────────────────────────

/**
 * Simple relevance score for a DB text match (0.0–1.0).
 * Subject match > fromAddr match > snippet match > body match.
 */
function scoreDbRow(
  q: string,
  row: { subject: string | null; fromAddr: string | null; snippet: string | null },
): number {
  const lq = q.toLowerCase();
  let score = 0;
  if (row.subject?.toLowerCase().includes(lq)) score += 0.9;
  if (row.fromAddr?.toLowerCase().includes(lq)) score += 0.8;
  if (row.snippet?.toLowerCase().includes(lq)) score += 0.5;
  return Math.min(score, 1.0);
}

// ─── Gmail API fetch with full metadata ───────────────────────────────────────

/**
 * Fetch a batch of Gmail messages by ID and return them as SearchResults.
 * Uses `format: "metadata"` so we get headers (From, Subject) + snippet
 * without downloading full bodies — fast and cheap.
 */
async function fetchGmailResultsByIds(
  googleSub: string,
  ids: string[],
): Promise<SearchResult[]> {
  if (!ids.length) return [];

  try {
    const tenant = getTenant(googleSub);
    const BATCH = 5;
    const results: SearchResult[] = [];

    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const fetched = await Promise.allSettled(
        slice.map((id) => tenant.gmail.api.messages.get({ id, format: "metadata" })),
      );

      for (const settled of fetched) {
        if (settled.status === "rejected") continue;
        const msg = settled.value;
        if (!msg?.id) continue;

        const headers = msg.payload?.headers ?? [];
        const getH = (name: string) =>
          headers.find((h: { name?: string; value?: string }) =>
            h.name?.toLowerCase() === name.toLowerCase(),
          )?.value ?? null;

        const subject = getH("Subject") ?? "(no subject)";
        const from = getH("From") ?? "";
        const snippet = msg.snippet ?? "";

        let receivedAt: Date | null = null;
        if (msg.internalDate) {
          const ts = parseInt(String(msg.internalDate), 10);
          if (!isNaN(ts)) receivedAt = new Date(ts);
        }

        results.push({
          type: "email",
          id: msg.id,
          title: subject,
          subtitle: from,
          snippet,
          date: receivedAt,
        });
      }
    }

    return results;
  } catch (err) {
    logger.warn("fetchGmailResultsByIds failed", { error: String(err) });
    return [];
  }
}

// ─── Text search ──────────────────────────────────────────────────────────────

/**
 * Search order:
 * 1. Our DB (fromAddr + subject + snippet + body) — fast, scored by field weight
 * 2. Gmail API search (q=) — authoritative, returns IDs then we fetch metadata
 *
 * We skip the Corsair cache text search because its `{ contains }` filter
 * doesn't map cleanly to multi-field search and gives inconsistent results.
 */
async function textSearch(
  googleSub: string,
  userId: string,
  q: string,
  limit: number,
): Promise<SearchResult[]> {
  // ── 1. Our DB ──────────────────────────────────────────────────────────────
  try {
    const rows = await db
      .select({
        gmailId: emails.gmailId,
        subject: emails.subject,
        fromAddr: emails.fromAddr,
        snippet: emails.snippet,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(
        and(
          eq(emails.userId, userId),
          or(
            ilike(emails.fromAddr, `%${q}%`),
            ilike(emails.subject, `%${q}%`),
            ilike(emails.snippet, `%${q}%`),
            ilike(emails.body, `%${q}%`),
          ),
        ),
      )
      .limit(limit * 2); // fetch extra so we can rank + trim

    if (rows.length > 0) {
      const scored = rows
        .map((row) => ({
          result: {
            type: "email" as const,
            id: row.gmailId,
            title: row.subject ?? "(no subject)",
            subtitle: row.fromAddr ?? "",
            snippet: row.snippet ?? "",
            date: row.receivedAt,
          },
          score: scoreDbRow(q, {
            subject: row.subject,
            fromAddr: row.fromAddr,
            snippet: row.snippet,
          }),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored.map((s) => ({ ...s.result, relevanceScore: s.score }));
    }
  } catch (err) {
    logger.warn("DB text search failed", { error: String(err) });
  }

  // ── 2. Gmail API search → fetch metadata for each result ──────────────────
  try {
    const tenant = getTenant(googleSub);
    const result = await tenant.gmail.api.messages.list({ q, maxResults: limit });
    const ids = (result.messages ?? []).map((m: { id: string }) => m.id).filter(Boolean);
    return fetchGmailResultsByIds(googleSub, ids);
  } catch (err) {
    logger.warn("Gmail API text search failed", { error: String(err) });
    return [];
  }
}

// ─── Semantic search (pgvector) ────────────────────────────────────────────────

async function semanticSearch(
  userId: string,
  q: string,
  limit: number,
): Promise<SearchResult[]> {
  const embedding = await getEmbedding({ text: q });
  if (!embedding) return [];

  try {
    const vectorStr = `[${embedding.join(",")}]`;

    const rows = await db.execute(sql`
      SELECT
        gamil_id         AS gmail_id,
        subject,
        from_addr,
        snippet,
        received_at,
        1 - (embedding <=> ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))})) AS score
      FROM emails
      WHERE
        user_id  = ${userId}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))})
      LIMIT ${limit}
    `);

    return (
      rows.rows as Array<{
        gmail_id: string;
        subject: string | null;
        from_addr: string | null;
        snippet: string | null;
        received_at: string | null;
        score: number;
      }>
    ).map((row) => ({
      type: "email" as const,
      id: row.gmail_id,
      title: row.subject ?? "(no subject)",
      subtitle: row.from_addr ?? "",
      snippet: row.snippet ?? "",
      date: row.received_at ? new Date(row.received_at) : null,
      relevanceScore: row.score,
    }));
  } catch (err) {
    logger.warn("Semantic search failed", { error: String(err) });
    return [];
  }
}

// ─── Public: hybrid search ─────────────────────────────────────────────────────

export async function search(
  googleSub: string,
  userId: string,
  input: SearchInput,
): Promise<SearchResult[]> {
  const { q, mode, limit } = input;

  if (mode === "text") return textSearch(googleSub, userId, q, limit);
  if (mode === "semantic") return semanticSearch(userId, q, limit);

  // Hybrid: run both in parallel, merge deduped, semantic score wins ties.
  const [textResults, semanticResults] = await Promise.all([
    textSearch(googleSub, userId, q, limit),
    semanticSearch(userId, q, limit),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  // Semantic first (higher quality signal when embeddings exist)
  for (const r of [...semanticResults, ...textResults]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
    if (merged.length >= limit) break;
  }

  // Sort by relevanceScore descending (text results without a score get 0.5)
  merged.sort((a, b) => (b.relevanceScore ?? 0.5) - (a.relevanceScore ?? 0.5));

  return merged;
}

// ─── Embedding storage ─────────────────────────────────────────────────────────

export async function storeEmailEmbedding(
  userId: string,
  gmailId: string,
  text: string,
): Promise<void> {
  const embedding = await getEmbedding({ text });
  if (!embedding) throw new Error("Embedding provider returned null");

  const vectorStr = `[${embedding.join(",")}]`;

  await db.execute(sql`
    UPDATE emails
    SET
      embedding  = ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))}),
      updated_at = NOW()
    WHERE
      user_id  = ${userId}::uuid
      AND gamil_id = ${gmailId}
  `);
}