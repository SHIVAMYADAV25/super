import { env } from "@/src/env";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "@/src/lib/logger";
import { SearchResult } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { SearchInput } from "@/src/schema";

let openaiClient: import("openai").default | null = null;

async function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    const { default: OpenAI } = await import("openai");
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function getEmbedding(text: string): Promise<number[] | null> {
  const client = await getOpenAIClient();
  if (!client) return null;
 
  try {
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // token limit
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    logger.warn("Embedding generation failed", { error: String(err) });
    return null;
  }
}


// ─── Text search via Corsair → Gmail API 

async function textSearch(
  userId: string,
  q : string,
  limit : number
):Promise<SearchResult[]> {
  try{
    const tenant = getTenant(userId);

    // Use Corsair's Gmail local DB search first (fast, no rate limits)
    const cached = await tenant.gmail.db.messages.search({
      data : {
        subject : {contains : q},
      },
      limit
    });

    // Also search snippets
    const snippetResults = await tenant.gmail.db.messages.search({
      data : {
        snippet : {contains : q},
      },
      limit
    });

    // merge and deduplicate
    const seen = new Set<string>();

    const results : SearchResult[] = [];

    for(const row of [...cached,...snippetResults]){
      if(seen.has(row.entity_id)) continue;
      seen.add(row.entity_id);

      results.push({
        type : "email",
        id : row.entity_id,
        title : row.data.subject ?? "(no subject",
        snippet : row.data.snippet ?? "",
        date : row.data.internalDate
        ? new Date(parseInt(row.data.internalDate,10))
        : null,
      });
    }

    return results.slice(0,limit);
  }catch(err){
    logger.warn("Text search via corsair DB failed, falling back to Gmail API",{
      error : String(err),
    })

    // Fallback to direct Gmail API search

    try{
      const tenant = getTenant(userId);
      const result = await tenant.gmail.api.messages.list({
        q,
        maxResults : limit,
      })

      return (result.messages ?? []).map((m) => ({
        type : "email"  as  const,
        id : m.id ?? "",
        title : "(loading...)",
        snippet : "",
        date : null
      }));
    }catch{
      return [];
    }
  }
}

// ─── Semantic search via pgvector

async function semanticSearch(
userId : string,
q : string,
limit: number,
):Promise<SearchResult[]>{
  const embedding = await getEmbedding(q);

  if(!embedding) return [];
  
  try{
     // pgvector cosine distance query
    const vectorStr = `[${embedding.join(",")}]`;

    const rows = await db.execute(sql`
      SELECT
        id,
        gmail_id,
        subject,
        snippet,
        received_at,
        1 - (embedding <=> ${vectorStr}::vector) AS score
      FROM emails
      WHERE
        user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (rows.rows as Array<{
      id: string;
      gmail_id: string;
      subject: string | null;
      snippet: string | null;
      received_at: string | null;
      score: number;
    }>).map((row) => ({
      type: "email" as const,
      id: row.gmail_id,
      title: row.subject ?? "(no subject)",
      snippet: row.snippet ?? "",
      date: row.received_at ? new Date(row.received_at) : null,
      relevanceScore: row.score,
    }));
  }catch(err){
    logger.warn("Semantic search failed (pgvector)", { error: String(err) });
    return [];
  }
}

// Hybrid search

export async function search(
  userId : string,
  input : SearchInput
):Promise<SearchResult[]> {
  const {q,mode,limit} = input;

  if(mode === "text"){
    return textSearch(userId,q,limit);
  }

  if(mode === "semantic"){
    return semanticSearch(userId,q,limit);
  }
  
  // Hybrid: run both in parallel, merge + deduplicate
  const [textResults, semanticResults] = await Promise.all([
    textSearch(userId, q, limit),
    semanticSearch(userId, q, limit),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];


  // Interleave: semantic first (higher relevance), then text
  for (const result of [...semanticResults, ...textResults]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
    if (merged.length >= limit) break;
  }
 
  return merged;
}


export async function storeEmailEmbedding(
    userId : string,
    gmailId : string,
    text : string,
):Promise<void>{
    const embedding = await getEmbedding(text);

    if(!embedding) return;

    const vectorStr = `[${embedding.join(",")}]`;

    await db.execute(sql`
    UPDATE emails
    SET embedding = ${vectorStr}::vector, updated_at = NOW()
    WHERE user_id = ${userId} AND gmail_id = ${gmailId}
  `)
}