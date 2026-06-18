/**
 * email.service.ts — single source of truth for Gmail operations.
 *
 * Flow:
 *  Login → /inbox loads → listEmail()
 *    - Cache hit (Corsair local DB): map rows → merge DB priority → return.
 *      Queue enrichment for any gmailIds not yet enriched.
 *    - Cache cold: hit Gmail API → persist to our DB + Corsair cache →
 *      queue enrichment → return.
 *
 *  Background: enrichEmail() (priority.service) classifies priority +
 *  generates embedding → updates DB → emits "email_enriched" SSE (one row).
 *
 *  New mail: Gmail webhook → handleNewEmail() → fetch single message →
 *  persist to DB + Corsair cache → queue enrichment → emit "new_email" SSE
 *  (one row, no full refetch).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { getTenant, getTenantId } from "../lib/corsair";
import { buildRawMimeMessage, parseGmailMessage, type GmailMessage } from "../lib/gmail-parser";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { queueEmailEnrichment } from "@/src/jobs/priority-queue";
import { emitToUser } from "../lib/sse";
import type { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
import type { ListEmailsInput, SendEmailInput } from "@/src/schema";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Labels that must never appear in the inbox view. */
const INBOX_EXCLUDE = new Set(["DRAFT", "SENT", "TRASH", "SPAM"]);

const DEFAULT_PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isInboxMessage(labelIds: string[]): boolean {
  return !labelIds.some((l) => INBOX_EXCLUDE.has(l));
}

/** Pull stored priority values for a batch of gmailIds. */
async function getPriorityMap(
  userId: string,
  gmailIds: string[],
): Promise<Map<string, EmailPriority>> {
  const map = new Map<string, EmailPriority>();
  if (!gmailIds.length) return map;

  try {
    const rows = await db
      .select({ gmailId: emails.gmailId, priority: emails.priority })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)));

    for (const row of rows) map.set(row.gmailId, row.priority as EmailPriority);
  } catch (err) {
    logger.warn("getPriorityMap failed", { userId, error: String(err) });
  }

  return map;
}

/**
 * gmailIds that have already been enriched.
 * `embedding IS NOT NULL` is the completion signal — enrichEmail sets both
 * priority and embedding together, so either both are done or neither is.
 */
async function getEnrichedIds(userId: string, gmailIds: string[]): Promise<Set<string>> {
  if (!gmailIds.length) return new Set();

  const rows = await db
    .select({ gmailId: emails.gmailId })
    .from(emails)
    .where(
      and(
        eq(emails.userId, userId),
        inArray(emails.gmailId, gmailIds),
        sql`${emails.embedding} IS NOT NULL`,
      ),
    );

  return new Set(rows.map((r) => r.gmailId));
}

/** Queue enrichment only for emails not yet enriched. */
async function queueUnenriched(
  userId: string,
  googleSub: string,
  items: Array<{ gmailId: string; subject: string | null; snippet: string | null; body: string | null }>,
): Promise<void> {
  if (!items.length) return;

  const ids = items.map((e) => e.gmailId).filter(Boolean);
  const enriched = await getEnrichedIds(userId, ids);

  for (const item of items) {
    if (!item.gmailId) continue;
    if (enriched.has(item.gmailId)) continue;
    if (!item.subject && !item.snippet) continue;

    void queueEmailEnrichment({
      userId,
      googleSub,
      gmailId: item.gmailId,
      subject: item.subject ?? "",
      snippet: item.snippet ?? "",
      body: item.body ?? "",
    });
  }
}

function applyPriorityMap(items: EmailListItem[], map: Map<string, EmailPriority>): EmailListItem[] {
  return items.map((item) => ({ ...item, priority: map.get(item.gmailId) ?? item.priority }));
}

function filterByPriority(items: EmailListItem[], priority: ListEmailsInput["priority"]): EmailListItem[] {
  if (!priority || priority === "all") return items;
  return items.filter((i) => i.priority === priority);
}

function getHeader(msg: GmailMessage, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function rawToListItem(msg: GmailMessage): EmailListItem {
  let receivedAt: Date | null = null;
  if (msg.internalDate != null) {
    const ts =
      typeof msg.internalDate === "number" ? msg.internalDate : parseInt(String(msg.internalDate), 10);
    if (!isNaN(ts)) receivedAt = new Date(ts);
  }

  return {
    id: msg.id ?? "",
    gmailId: msg.id ?? "",
    threadId: msg.threadId ?? null,
    fromAddr: getHeader(msg, "From"),
    subject: getHeader(msg, "Subject"),
    snippet: msg.snippet ?? null,
    isRead: !(msg.labelIds ?? []).includes("UNREAD"),
    labels: msg.labelIds ?? [],
    priority: "normal",
    receivedAt,
  };
}

/** Fetch full Gmail messages in parallel batches of 5. */
async function fetchBatch(
  tenant: ReturnType<typeof getTenant>,
  ids: string[],
  format: "metadata" | "full" = "metadata",
): Promise<GmailMessage[]> {
  const BATCH = 5;
  const results: GmailMessage[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const fetched = await Promise.all(slice.map((id) => tenant.gmail.api.messages.get({ id, format })));
    results.push(...fetched);
  }
  return results;
}

// ─── DB persistence ─────────────────────────────────────────────────────────

async function upsertOne(userId: string, parsed: ReturnType<typeof parseGmailMessage>): Promise<void> {
  if (!parsed.gmailId) return;

  try {
    await db
      .insert(emails)
      .values({
        userId,
        gmailId: parsed.gmailId,
        threadId: parsed.threadId,
        fromAddr: parsed.fromAddr,
        toAddrs: parsed.toAddrs,
        ccAddrs: parsed.ccAddrs,
        subject: parsed.subject,
        snippet: parsed.snippet,
        body: parsed.body,
        isRead: parsed.isRead,
        labels: parsed.labels,
        attachments: parsed.attachments,
        receivedAt: parsed.receivedAt,
      })
      .onConflictDoUpdate({
        target: [emails.userId, emails.gmailId],
        set: {
          snippet: parsed.snippet,
          isRead: parsed.isRead,
          labels: parsed.labels,
          body: parsed.body ?? sql`${emails.body}`,
          updatedAt: new Date(),
          // Never downgrade an already-classified priority back to "normal"
          priority: sql`CASE WHEN ${emails.priority} != 'normal' THEN ${emails.priority} ELSE excluded.priority END`,
          // Never overwrite an existing embedding
          embedding: sql`COALESCE(${emails.embedding}, excluded.embedding)`,
        },
      });
  } catch (err) {
    logger.warn("upsertOne failed", { gmailId: parsed.gmailId, error: String(err) });
  }
}

async function upsertBatch(userId: string, msgs: GmailMessage[]): Promise<void> {
  await Promise.allSettled(
    msgs.map(async (msg) => {
      try {
        await upsertOne(userId, parseGmailMessage(msg));
      } catch (err) {
        logger.warn("upsertBatch item failed", { gmailId: msg.id, error: String(err) });
      }
    }),
  );
}

/** Populate Corsair's local cache (best-effort, fire-and-forget). */
function populateCorsairCache(tenant: ReturnType<typeof getTenant>, msgs: GmailMessage[]): void {
  for (const msg of msgs) {
    if (!msg.id) continue;
    void tenant.gmail.db.messages
      .upsertByEntityId(msg.id, {
        id: msg.id,
        threadId: msg.threadId ?? undefined,
        snippet: msg.snippet ?? undefined,
        internalDate: msg.internalDate != null ? String(msg.internalDate) : undefined,
        labelIds: msg.labelIds ?? [],
        subject: getHeader(msg, "Subject") ?? undefined,
        from: getHeader(msg, "From") ?? undefined,
        to: getHeader(msg, "To") ?? undefined,
      })
      .catch((err: unknown) =>
        logger.warn("Corsair cache upsert failed", { gmailId: msg.id, error: String(err) }),
      );
  }
}

// ─── listEmailFromDb ─────────────────────────────────────────────────────────

/**
 * Read emails directly from our own `emails` table.
 * This is always up-to-date because every incoming/archived email is upserted
 * to our DB (via upsertOne / upsertBatch) before we emit any SSE signal.
 * The Corsair cache is NOT consulted here — it can lag behind the DB.
 */
async function listEmailFromDb(
  userId: string,
  limit: number,
  offset: number,
): Promise<EmailListItem[]> {
  const rows = await db
    .select({
      id: emails.id,
      gmailId: emails.gmailId,
      threadId: emails.threadId,
      fromAddr: emails.fromAddr,
      subject: emails.subject,
      snippet: emails.snippet,
      isRead: emails.isRead,
      labels: emails.labels,
      priority: emails.priority,
      receivedAt: emails.receivedAt,
    })
    .from(emails)
    .where(eq(emails.userId, userId))
    .orderBy(desc(emails.receivedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    gmailId: row.gmailId,
    threadId: row.threadId ?? null,
    fromAddr: row.fromAddr ?? null,
    subject: row.subject ?? null,
    snippet: row.snippet ?? null,
    isRead: row.isRead,
    labels: (row.labels as string[]) ?? [],
    priority: (row.priority as EmailPriority) ?? "normal",
    receivedAt: row.receivedAt ?? null,
  }));
}

// ─── listEmail ──────────────────────────────────────────────────────────────

export async function listEmail(
  googleSub: string,
  userId: string,
  opts: ListEmailsInput,
): Promise<PaginatedResponse<EmailListItem>> {
  try {
    const tenant = getTenant(googleSub);
    const fetchLimit = opts.limit ?? DEFAULT_PAGE_SIZE;

    // ── Search path (Gmail q=) ────────────────────────────────────────────
    if (opts.q) {
      const result = await tenant.gmail.api.messages.list({
        q: opts.q,
        maxResults: fetchLimit,
        pageToken: opts.pageToken,
        labelIds: opts.labelIds,
      });

      const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
      const fullMsgs = await fetchBatch(tenant, ids);
      const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

      await upsertBatch(userId, inbox);
      populateCorsairCache(tenant, inbox);

      const items = inbox.map(rawToListItem);
      const priorityMap = await getPriorityMap(userId, items.map((i) => i.gmailId));
      const withPriority = applyPriorityMap(items, priorityMap);

      await queueUnenriched(userId, googleSub, inbox.map((m) => parseGmailMessage(m)));

      return {
        items: filterByPriority(withPriority, opts.priority),
        nextPageToken: result.nextPageToken,
        total: result.resultSizeEstimate,
      };
    }

    // ── DB path — primary source of truth ───────────────────────────────────
    // Our DB is always current: every webhook upserts before emitting SSE,
    // and the initial load also upserts. Reading from DB guarantees that new
    // emails pushed via handleNewEmail() are immediately visible on refetch.
    const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

    const dbItems = await listEmailFromDb(userId, fetchLimit, offset);

    // Cold DB — no emails for this user yet → hit Gmail API to seed
    if (dbItems.length === 0 && offset === 0) {
      logger.info("listEmail: DB empty, seeding from Gmail API", { userId });
      return fetchFromGmailApi(tenant, googleSub, userId, opts, fetchLimit);
    }

    return {
      items: filterByPriority(dbItems, opts.priority),
      nextPageToken: dbItems.length === fetchLimit ? String(offset + fetchLimit) : undefined,
    };
  } catch (err) {
    logger.error("listEmail failed", { userId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

/** Cache-miss path: fetch from Gmail API, persist, queue enrichment. */
async function fetchFromGmailApi(
  tenant: ReturnType<typeof getTenant>,
  googleSub: string,
  userId: string,
  opts: ListEmailsInput,
  fetchLimit: number,
): Promise<PaginatedResponse<EmailListItem>> {
  const labelIds = opts.labelIds?.length ? opts.labelIds : ["INBOX"];

  const result = await tenant.gmail.api.messages.list({
    maxResults: fetchLimit,
    pageToken: opts.pageToken,
    labelIds,
  });

  logger.info("listEmail: cache miss — fetching from Gmail API", { userId });

  const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  const fullMsgs = await fetchBatch(tenant, ids);
  const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

  await upsertBatch(userId, inbox);
  populateCorsairCache(tenant, inbox);

  const items = inbox.map(rawToListItem);
  const priorityMap = await getPriorityMap(userId, items.map((i) => i.gmailId));
  const withPriority = applyPriorityMap(items, priorityMap);

  await queueUnenriched(userId, googleSub, inbox.map((m) => parseGmailMessage(m)));

  return {
    items: filterByPriority(withPriority, opts.priority),
    nextPageToken: result.nextPageToken,
    total: result.resultSizeEstimate,
  };
}

// ─── getEmail ───────────────────────────────────────────────────────────────

export async function getEmail(userId: string, googleSub: string, gmailId: string): Promise<Email> {
  try {
    const tenant = getTenant(googleSub);

    const msg = await tenant.gmail.api.messages.get({ id: gmailId, format: "full" });
    if (!msg) throw createNotFoundError("Email");

    const parsed = parseGmailMessage(msg);
    await upsertOne(userId, parsed);

    if (parsed.subject || parsed.snippet) {
      await queueUnenriched(userId, googleSub, [
        {
          gmailId: parsed.gmailId,
          subject: parsed.subject,
          snippet: parsed.snippet,
          body: parsed.body,
        },
      ]);
    }

    const priorityMap = await getPriorityMap(userId, [gmailId]);
    const priority = priorityMap.get(gmailId) ?? "normal";

    return {
      id: gmailId,
      userId,
      gmailId,
      threadId: parsed.threadId,
      fromAddr: parsed.fromAddr,
      toAddrs: parsed.toAddrs,
      ccAddrs: parsed.ccAddrs,
      subject: parsed.subject,
      snippet: parsed.snippet,
      body: parsed.body,
      isRead: parsed.isRead,
      labels: parsed.labels,
      priority,
      attachments: parsed.attachments,
      receivedAt: parsed.receivedAt,
    };
  } catch (err) {
    logger.error("getEmail failed", { userId, gmailId, error: String(err) });
    if ((err as Error).message?.includes("not found")) throw err;
    throw createExternalApiError("Gmail", err);
  }
}

// ─── modifyEmail ────────────────────────────────────────────────────────────

export async function modifyEmail(
  googleSub: string,
  userId: string,
  gmailId: string,
  opts: { isRead?: boolean; addLabels?: string[]; removeLabels?: string[] },
): Promise<void> {
  try {
    const tenant = getTenant(googleSub);
    const addLabelIds = [...(opts.addLabels ?? [])];
    const removeLabelIds = [...(opts.removeLabels ?? [])];

    if (opts.isRead === true) removeLabelIds.push("UNREAD");
    if (opts.isRead === false) addLabelIds.push("UNREAD");

    // console.log(gmailId,addLabelIds,removeLabelIds);

    if (addLabelIds.length || removeLabelIds.length) {
      await tenant.gmail.api.messages.modify({ id: gmailId, addLabelIds, removeLabelIds });
    }

    await db
      .update(emails)
      .set({
        isRead: opts.isRead !== undefined ? opts.isRead : sql`${emails.isRead}`,
        updatedAt: new Date(),
      })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
  } catch (err) {
    logger.error("modifyEmail failed", { userId, gmailId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

// ─── archiveEmail ───────────────────────────────────────────────────────────

export async function archiveEmail(googleSub: string, userId: string, gmailId: string): Promise<void> {
  try {
    const tenant = getTenant(googleSub);
    await tenant.gmail.api.messages.modify({ id: gmailId, removeLabelIds: ["INBOX"] });
    await db.update(emails).set({
        labels: sql`array_remove(${emails.labels}, 'INBOX')`,
        updatedAt: new Date(),
      }).where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
  } catch (err) {
    logger.error("archiveEmail failed", { userId, gmailId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

// ─── sendEmail ──────────────────────────────────────────────────────────────

export async function sendEmail(
  googleSub: string,
  userId: string,
  input: SendEmailInput,
  userEmail: string,
): Promise<{ messageId: string; threadId: string | null }> {
  try {
    const tenant = getTenant(googleSub);
    const raw = buildRawMimeMessage({
      from: userEmail,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
    });
    const result = await tenant.gmail.api.messages.send({ raw });
    logger.info("Email sent", { userId, messageId: result.id });
    return { messageId: result.id ?? "", threadId: result.threadId ?? null };
  } catch (err) {
    logger.error("sendEmail failed", { userId, error: String(err) });
    throw createExternalApiError("Email", err);
  }
}

// ─── Draft management ───────────────────────────────────────────────────────

export async function createDraft(googleSub: string, userId: string, raw: string): Promise<{ draftId: string }> {
  try {
    const tenant = getTenant(googleSub);
    const result = await tenant.gmail.api.drafts.create({ draft: { message: { raw } } });
    return { draftId: result.id ?? "" };
  } catch (err) {
    logger.error("createDraft failed", { userId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

export async function updateDraft(
  googleSub: string,
  userId: string,
  gmailDraftId: string,
  raw: string,
): Promise<void> {
  try {
    const tenant = getTenant(googleSub);
    await tenant.gmail.api.drafts.update({ id: gmailDraftId, draft: { message: { raw } } });
  } catch (err) {
    logger.error("updateDraft failed", { userId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

export async function deleteDraft(googleSub: string, userId: string, gmailDraftId: string): Promise<void> {
  try {
    const tenant = getTenant(googleSub);
    await tenant.gmail.api.drafts.delete({ id: gmailDraftId });
  } catch (err) {
    logger.warn("deleteDraft failed — non-fatal", { userId, error: String(err) });
  }
}

// ─── handleNewEmail (called from webhook handler) ──────────────────────────

/**
 * Process one new message reported by a Gmail webhook:
 * 1. Fetch the message
 * 2. Skip if not an inbox message (draft/sent/trash/spam)
 * 3. Persist to DB + Corsair cache
 * 4. Queue enrichment
 * 5. SSE-push "new_email" with just that row — UI prepends it, no refetch
 */
export async function handleNewEmail(googleSub: string, userId: string, gmailId: string): Promise<void> {
  try {
    const tenant = getTenant(googleSub);
    const [msg] = await fetchBatch(tenant, [gmailId], "metadata");
    if (!msg) {
      logger.warn("handleNewEmail: message not found", { gmailId });
      return;
    }

    if (!isInboxMessage(msg.labelIds ?? [])) {
      logger.info("handleNewEmail: skipping non-inbox message", { gmailId });
      return;
    }

    const parsed = parseGmailMessage(msg);
    await upsertOne(userId, parsed);
    populateCorsairCache(tenant, [msg]);

    await queueUnenriched(userId, googleSub, [
      { gmailId: parsed.gmailId, subject: parsed.subject, snippet: parsed.snippet, body: parsed.body },
    ]);

    const item = rawToListItem(msg);
    emitToUser(getTenantId(googleSub), { type: "new_email", data: { email: item } });

    logger.info("handleNewEmail: processed and emitted", { gmailId });
  } catch (err) {
    logger.error("handleNewEmail failed", { googleSub, gmailId, error: String(err) });
  }
}