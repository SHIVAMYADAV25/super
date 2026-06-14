

import { db } from "../db";
import { sql, eq, and, ilike, or } from "drizzle-orm";
import { logger } from "@/src/lib/logger";
import { SearchResult } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { SearchInput } from "@/src/schema";
import { getEmbedding, EMBEDDING_DIM } from "../lib/llm-provider";
import { emails } from "../db/schema";

// ─── Text search via Corsair DB → Gmail API fallback ──────────────────────────

async function textSearch(
  tenantId: string,  // googleSub
  userId: string,    // DB UUID — for our own emails table
  q: string,
  limit: number,
): Promise<SearchResult[]> {
  // 1. Try Corsair's local synced DB first (fast, no rate limits)
  try {
    const tenant = getTenant(tenantId);

    const [subjectHits, snippetHits, bodyHits] = await Promise.all([
      tenant.gmail.db.messages.search({
        data: { subject: { contains: q } },
        limit,
      }),
      tenant.gmail.db.messages.search({
        data: { snippet: { contains: q } },
        limit,
      }),
      tenant.gmail.db.messages.search({
        data: { body: { contains: q } },
        limit,
      }),
    ]);

    const seen = new Set<string>();
    const results: SearchResult[] = [];

    for (const row of [...subjectHits, ...snippetHits, ...bodyHits]) {
      if (seen.has(row.entity_id)) continue;
      seen.add(row.entity_id);

      results.push({
        type: "email",
        id: row.entity_id,
        title: row.data.subject ?? "(no subject)",
        snippet: row.data.snippet ?? "",
        date: row.data.internalDate
          ? new Date(parseInt(row.data.internalDate, 10))
          : null,
      });

      if (results.length >= limit) break;
    }

    if (results.length > 0) return results;
  } catch (err) {
    logger.warn("Corsair DB text search failed, falling back", { error: String(err) });
  }

  // 2. Fallback: our own emails table
  try {
    const rows = await db
      .select({
        gmailId: emails.gmailId,
        subject: emails.subject,
        snippet: emails.snippet,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(
        and(
          eq(emails.userId, userId),
          or(
            ilike(emails.subject, `%${q}%`),
            ilike(emails.snippet, `%${q}%`),
            ilike(emails.body, `%${q}%`),
          ),
        ),
      )
      .limit(limit);

    if (rows.length > 0) {
      return rows.map((row) => ({
        type: "email" as const,
        id: row.gmailId,
        title: row.subject ?? "(no subject)",
        snippet: row.snippet ?? "",
        date: row.receivedAt,
      }));
    }
  } catch (err) {
    logger.warn("DB text search failed, falling back to Gmail API", { error: String(err) });
  }

  // 3. Fallback: direct Gmail API
  try {
    const tenant = getTenant(tenantId);
    const result = await tenant.gmail.api.messages.list({ q, maxResults: limit });
    return (result.messages ?? []).map((m) => ({
      type: "email" as const,
      id: m.id ?? "",
      title: "(loading...)",
      snippet: "",
      date: null,
    }));
  } catch {
    return [];
  }
}

// ─── Semantic search via pgvector ──────────────────────────────────────────────

async function semanticSearch(
  userId: string,  // DB UUID — owns the email rows
  q: string,
  limit: number,
): Promise<SearchResult[]> {
  const embedding = await getEmbedding({ text: q });
  if (!embedding) return [];

  try {
    const vectorStr = `[${embedding.join(",")}]`;

    // Cast to the stored dimension — pgvector requires exact match
    const rows = await db.execute(sql`
      SELECT
        id,
        gamil_id AS gmail_id,
        subject,
        snippet,
        received_at,
        1 - (embedding <=> ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))})) AS score
      FROM emails
      WHERE
        user_id = ${userId}::uuid
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))})
      LIMIT ${limit}
    `);

    return (
      rows.rows as Array<{
        id: string;
        gmail_id: string;
        subject: string | null;
        snippet: string | null;
        received_at: string | null;
        score: number;
      }>
    ).map((row) => ({
      type: "email" as const,
      id: row.gmail_id,
      title: row.subject ?? "(no subject)",
      snippet: row.snippet ?? "",
      date: row.received_at ? new Date(row.received_at) : null,
      relevanceScore: row.score,
    }));
  } catch (err) {
    logger.warn("Semantic search failed (pgvector)", { error: String(err) });
    return [];
  }
}

// ─── Public: hybrid search ─────────────────────────────────────────────────────

export async function search(
  tenantId: string,  // googleSub
  userId: string,    // DB UUID
  input: SearchInput,
): Promise<SearchResult[]> {
  const { q, mode, limit } = input;

  if (mode === "text") return textSearch(tenantId, userId, q, limit);
  if (mode === "semantic") return semanticSearch(userId, q, limit);

  // Hybrid: parallel, semantic first (higher relevance), deduplicated
  const [textResults, semanticResults] = await Promise.all([
    textSearch(tenantId, userId, q, limit),
    semanticSearch(userId, q, limit),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const result of [...semanticResults, ...textResults]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
    if (merged.length >= limit) break;
  }

  return merged;
}

// ─── Embedding store (called from email.service.ts after saving emails) ────────

export async function storeEmailEmbedding(
  userId: string,
  gmailId: string,
  text: string,
): Promise<void> {

  logger.info("STORE EMBEDDING START", {
    gmailId,
  });

  const embedding = await getEmbedding({ text });

  logger.info("EMBEDDING RESPONSE", {
    gmailId,
    exists: !!embedding,
    dimensions: embedding?.length,
  });

  if (!embedding) {
    throw new Error("Embedding provider returned null");
  }

  const vectorStr = `[${embedding.join(",")}]`;

  logger.info("SAVING EMBEDDING", {
    gmailId,
    dim: EMBEDDING_DIM,
  });

  try {
  await db.execute(sql`
    UPDATE emails
    SET
      embedding = ${vectorStr}::vector(${sql.raw(String(EMBEDDING_DIM))}),
      updated_at = NOW()
    WHERE
      user_id = ${userId}::uuid
      AND gamil_id = ${gmailId}
  `);
} catch (err) {
  logger.error("EMBEDDING UPDATE FAILED", {
    gmailId,
    error: String(err),
  });
  throw err;
}

  logger.info("EMBEDDING SAVED", {
    gmailId,
  });
}