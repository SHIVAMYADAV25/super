import { ListEmailsInput, SendEmailInput } from "@/src/schema";
import { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { buildRawMimeMessage, parseGmailMessage } from "../lib/gmail-parser";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { queueEmailEmbedding } from "@/src/jobs/priority-queue";
import { and, eq, sql, inArray, ne } from "drizzle-orm";

// ─── Labels that should never appear in the inbox ─────────────────────────────
const INBOX_EXCLUDE_LABELS = new Set(["DRAFT", "SENT", "TRASH", "SPAM"]);

/**
 * Return true if this message should be shown in the inbox view.
 * Drafts, sent mail, trash and spam are excluded.
 */
function isInboxMessage(labelIds: string[]): boolean {
  return !labelIds.some((l) => INBOX_EXCLUDE_LABELS.has(l));
}

/**
 * Read stored priority values for a batch of gmailIds from our emails table.
 * Falls back to "normal" for any gmailId not yet enriched.
 */
async function getPriorityMap(
  userId: string,
  gmailIds: string[],
): Promise<Map<string, EmailPriority>> {
  const map = new Map<string, EmailPriority>();
  if (gmailIds.length === 0) return map;

  try {
    const rows = await db
      .select({ gmailId: emails.gmailId, priority: emails.priority })
      .from(emails)
      .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)));

    for (const row of rows) {
      map.set(row.gmailId, row.priority);
    }
  } catch (err) {
    logger.warn("getPriorityMap failed", { userId, error: String(err) });
  }

  return map;
}

/**
 * Return the set of gmailIds that have already completed enrichment
 * (priority classification + embedding) in the DB.
 *
 * Embedding presence is used as the SOLE completion signal — enrichEmail
 * runs classification and embedding together via Promise.all and re-throws
 * if embedding fails, so embedding != null implies priority was also set
 * (even if that priority value happens to be "normal").
 *
 * Using priority != 'normal' as a signal would incorrectly re-queue
 * correctly-classified "normal" emails forever; using embedding alone
 * avoids that while still catching genuinely unenriched rows.
 */
async function getClassifiedGmailIds(
  userId: string,
  gmailIds: string[],
): Promise<Set<string>> {
  if (gmailIds.length === 0) return new Set();

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

/**
 * Queue enrichment only for emails that haven't been classified yet.
 * Prevents wasting LLM tokens on already-processed emails.
 */
async function queueUnclassifiedEmails(
  userId: string,
  tenantId: string, 
  parsedEmails: Array<{ gmailId: string; subject: string | null; snippet: string | null; body: string | null }>,
): Promise<void> {
  if (parsedEmails.length === 0) return;

  const allIds = parsedEmails.map((e) => e.gmailId).filter(Boolean);
  const classified = await getClassifiedGmailIds(userId, allIds);

  for (const email of parsedEmails) {
    if (!email.gmailId) continue;
    // Skip if already classified — no need to burn LLM tokens again
    if (classified.has(email.gmailId)) continue;
    // Skip if there's no content to classify
    if (!email.subject && !email.snippet) continue;

    
    void queueEmailEmbedding({
      userId,
      tenantId,
      gmailId: email.gmailId,
      subject: email.subject ?? "",
      snippet: email.snippet ?? "",
      body: email.body ?? "",
    });
  }
}

/** Apply priority filter client-side (Gmail/Corsair don't know our LLM priority). */
function applyPriorityFilter(
  items: EmailListItem[],
  priority: ListEmailsInput["priority"],
): EmailListItem[] {
  if (!priority || priority === "all") return items;
  return items.filter((item) => item.priority === priority);
}

// ─── listEmail ────────────────────────────────────────────────────────────────

export async function listEmail(
  tenantId: string,
  userId: string,
  opts: ListEmailsInput,
): Promise<PaginatedResponse<EmailListItem>> {
  try {
    const tenant = getTenant(tenantId);

    // Fetch a wider page when filtering by priority so filtered results aren't
    // sparse — priority is applied client-side after fetching.
    const fetchLimit =
      opts.priority && opts.priority !== "all"
        ? Math.min(opts.limit * 3, 100)
        : opts.limit;

    // ── Search path (opts.q) ──────────────────────────────────────────────────
    if (opts.q) {
      const result = await tenant.gmail.api.messages.list({
        q: opts.q,
        maxResults: fetchLimit,
        pageToken: opts.pageToken,
        labelIds: opts.labelIds,
      });

      const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
      const fullMessages = await fetchMessagesBatch(tenant, ids);

      // Filter out drafts/sent from search results too
      const inboxMessages = fullMessages.filter((m) =>
        isInboxMessage(m.labelIds ?? []),
      );

      // Persist to our DB (fire & wait — keeps DB in sync)
      await upsertEmailsBatch(userId, inboxMessages);

      // Queue enrichment only for unclassified emails
      const parsed = inboxMessages.map((m) => parseGmailMessage(m));
      await queueUnclassifiedEmails(userId,tenantId, parsed);

      const items = inboxMessages.map(mapToListItem);
      const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
      const priorityMap = await getPriorityMap(userId, gmailIds);
      logger.info("PRIORITY MAP", {
      count: priorityMap.size,
    });
      const withPriority = applyPriorityMap(items, priorityMap);

      return {
        items: applyPriorityFilter(withPriority, opts.priority),
        nextPageToken: result.nextPageToken,
        total: result.resultSizeEstimate,
      };
    }

    // ── Cache path ────────────────────────────────────────────────────────────
    const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

    const cached = await tenant.gmail.db.messages.search({
      data: {},
      limit: fetchLimit,
      offset,
    });

    console.log(cached)

    // const cached: any[] = []

    // Filter out drafts/sent/trash/spam from cache results
    const inboxCached = cached.filter((row) =>
      isInboxMessage(row.data.labelIds ?? []),
    );

    if (inboxCached.length === 0 && offset === 0) {
      // Cache is cold — hit Gmail API directly
      return await fetchFromGmailApi(tenant, tenantId, userId, opts, fetchLimit);
    }

    // Cache hit — map to UI items

    // TEMP DEBUG — remove after checking shape
if (inboxCached.length > 0) {
  logger.warn("CACHE ROW SHAPE", {
    entity_id: inboxCached[0].entity_id,
    row_id: inboxCached[0].id,
    data_keys: Object.keys(inboxCached[0].data ?? {}),
    raw_sample: JSON.stringify(inboxCached[0]).slice(0, 1000),
  });
}

    const mapped: EmailListItem[] = inboxCached.map((row) => ({
      id: row.id,
      gmailId: (row.data as any).id ?? row.entity_id,
      threadId: row.data.threadId ?? null,
      fromAddr: row.data.from ?? null,
      subject: row.data.subject ?? null,
      snippet: row.data.snippet ?? null,
      isRead: !(row.data.labelIds ?? []).includes("UNREAD"),
      labels: row.data.labelIds ?? [],
      priority: "normal" as const,
      receivedAt: row.data.internalDate
        ? new Date(parseInt(row.data.internalDate, 10))
        : null,
    }));

    const cachedIds = mapped.map((m) => m.gmailId).filter(Boolean);

    // ── FIX #1: Cache path also queues enrichment ─────────────────────────────
    // Previously the cache path never called queueEmailEmbedding, so cached
    // emails were never classified. We also need to upsert into our DB if the
    // row doesn't exist yet (Corsair cache populated by webhook, our DB may lag).
    const parsedForQueue = inboxCached.map((row) => ({
      gmailId: (row.data as any).id ?? row.entity_id,
      subject: row.data.subject ?? null,
      snippet: row.data.snippet ?? null,
      body: null, // cache doesn't store body
    }));
    await queueUnclassifiedEmails(userId,tenantId, parsedForQueue);

    const priorityMap = await getPriorityMap(userId, cachedIds);


    logger.info("PRIORITY MAP", {
        count: priorityMap.size,
      });
    
    const withPriority = applyPriorityMap(mapped, priorityMap);

    return {
      items: applyPriorityFilter(withPriority, opts.priority),
      nextPageToken:
        inboxCached.length === fetchLimit
          ? String(offset + fetchLimit)
          : undefined,
    };
  } catch (error) {
    logger.error("listEmail failed", { userId, error: String(error) });
    throw createExternalApiError("Gmail", error);
  }
}

/** Shared helper: fetch from Gmail API, persist, queue enrichment, return items. */
async function fetchFromGmailApi(
  tenant: ReturnType<typeof getTenant>,
  tenantId: string,
  userId: string,
  opts: ListEmailsInput,
  fetchLimit: number,
): Promise<PaginatedResponse<EmailListItem>> {
  const labelIds = opts.labelIds?.length
    ? opts.labelIds
    : ["INBOX"]; // Always scope to INBOX when no explicit labels

  const result = await tenant.gmail.api.messages.list({
    maxResults: fetchLimit,
    pageToken: opts.pageToken,
    labelIds,
  });

  logger.info("Fetching from Gmail API (cache miss)", { userId });

  const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  const fullMessages = await fetchMessagesBatch(tenant, ids);

  // Filter out non-inbox messages (drafts, sent, etc.)
  const inboxMessages = fullMessages.filter((m) =>
    isInboxMessage(m.labelIds ?? []),
  );

  // Persist to our DB
  await upsertEmailsBatch(userId, inboxMessages);

  // Populate Corsair's local DB cache (fire-and-forget, best-effort)
  for (const msg of inboxMessages) {
    if (!msg.id) continue;
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

    void tenant.gmail.db.messages.upsertByEntityId(
        msg.id,
        {
          id: msg.id,
          threadId: msg.threadId ?? undefined,
          snippet: msg.snippet ?? undefined,
          historyId: (msg as any).historyId ?? undefined,
          internalDate:
            msg.internalDate != null
              ? String(msg.internalDate)
              : undefined,
          labelIds: msg.labelIds ?? [],
          subject: getHeader("Subject") ?? undefined,
          from: getHeader("From") ?? undefined,
          to: getHeader("To") ?? undefined,
          body: undefined,
        }
      )
      .catch((err: unknown) =>
        logger.warn("Failed to cache message in Corsair DB", {
          gmailId: msg.id,
          error: String(err),
        }),
      );
  }

  // Queue enrichment for unclassified emails only
  const parsed = inboxMessages.map((m) => parseGmailMessage(m));
  await queueUnclassifiedEmails(userId,tenantId,parsed);

  const items = inboxMessages.map(mapToListItem);
  const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
  const priorityMap = await getPriorityMap(userId, gmailIds);
  logger.info("PRIORITY MAP", {
  count: priorityMap.size,
});
  const withPriority = applyPriorityMap(items, priorityMap);

  return {
    items: applyPriorityFilter(withPriority, opts.priority),
    nextPageToken: result.nextPageToken,
    total: result.resultSizeEstimate,
  };
}

/** Fetch full Gmail messages in parallel batches of 5. */
async function fetchMessagesBatch(
  tenant: ReturnType<typeof getTenant>,
  ids: string[],
): Promise<RawGmailMsg[]> {
  const BATCH = 5;
  const results: RawGmailMsg[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map((id) => tenant.gmail.api.messages.get({ id, format: "metadata" })),
    );
    results.push(...fetched);
  }
  return results;
}

/** Merge priorityMap into items. Falls back to item's existing priority. */
function applyPriorityMap(
  items: EmailListItem[],
  priorityMap: Map<string, EmailPriority>,
): EmailListItem[] {
  return items.map((item) => ({
    ...item,
    priority: priorityMap.get(item.gmailId) ?? item.priority,
  }));
}

// ─── getEmail ─────────────────────────────────────────────────────────────────

export async function getEmail(
  userId: string,
  gmailTenantId: string,
  gmailId: string,
): Promise<Email> {
  try {
    const tenant = getTenant(gmailTenantId);

    const msg = await tenant.gmail.api.messages.get({
      id: gmailId,
      format: "full",
    });

    if (!msg) throw createNotFoundError("Email");

    const parsed = parseGmailMessage(msg);

    // Persist full email (includes body)
    await upsertEmail(userId, parsed);

    // Queue enrichment only if not yet classified
    if (parsed.subject || parsed.snippet) {
      await queueUnclassifiedEmails(userId,gmailTenantId, [
        {
          gmailId: parsed.gmailId,
          subject: parsed.subject,
          snippet: parsed.snippet,
          body: parsed.body,
        },
      ]);
    }

    // ── FIX #4: Read actual priority from DB instead of hardcoding "normal" ──
    const priorityMap = await getPriorityMap(userId, [gmailId]);
    logger.info("PRIORITY MAP", {
  count: priorityMap.size,
});
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

// ─── modifyEmail ──────────────────────────────────────────────────────────────

export async function modifyEmail(
  tenantId: string,
  userId: string,
  gmailId: string,
  opts: { isRead?: boolean; addLabels?: string[]; removeLabels?: string[] },
): Promise<void> {
  try {
    const tenant = getTenant(tenantId);

    const addLabelIds: string[] = [...(opts.addLabels ?? [])];
    const removeLabelIds: string[] = [...(opts.removeLabels ?? [])];

    if (opts.isRead === true) removeLabelIds.push("UNREAD");
    if (opts.isRead === false) addLabelIds.push("UNREAD");

    if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
      await tenant.gmail.api.messages.modify({ id: gmailId, addLabelIds, removeLabelIds });
    }

    await db
      .update(emails)
      .set({
        isRead: opts.isRead !== undefined ? opts.isRead : sql`${emails.isRead}`,
        updatedAt: new Date(),
      })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
  } catch (error) {
    logger.error("modifyEmail failed", { userId, gmailId, error: String(error) });
    throw createExternalApiError("Gmail", error);
  }
}

// ─── archiveEmail ─────────────────────────────────────────────────────────────

export async function archiveEmail(
  tenantId: string,
  userId: string,
  gmailId: string,
): Promise<void> {
  try {
    const tenant = getTenant(tenantId);

    await tenant.gmail.api.messages.modify({
      id: gmailId,
      removeLabelIds: ["INBOX"],
    });

    await db
      .update(emails)
      .set({ updatedAt: new Date() })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
  } catch (err) {
    logger.error("archiveEmail failed", { userId, gmailId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

// ─── sendEmail ────────────────────────────────────────────────────────────────

export async function sendEmail(
  tenantId: string,
  userId: string,
  input: SendEmailInput,
  userEmail: string,
): Promise<{ messageId: string; threadId: string | null }> {
  try {
    const tenant = getTenant(tenantId);

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

    return {
      messageId: result.id ?? "",
      threadId: result.threadId ?? null,
    };
  } catch (err) {
    logger.error("sendEmail failed", { userId, error: String(err) });
    throw createExternalApiError("Email", err);
  }
}

// ─── Draft management ─────────────────────────────────────────────────────────

export async function createDraft(
  tenantId: string,
  userId: string,
  raw: string,
): Promise<{ draftId: string }> {
  try {
    const tenant = getTenant(tenantId);
    const result = await tenant.gmail.api.drafts.create({ draft: { message: { raw } } });
    return { draftId: result.id ?? "" };
  } catch (err) {
    logger.error("createDraft failed", { userId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

export async function updateDraft(
  tenantId: string,
  userId: string,
  gmailDraftId: string,
  raw: string,
): Promise<void> {
  try {
    const tenant = getTenant(tenantId);
    await tenant.gmail.api.drafts.update({ id: gmailDraftId, draft: { message: { raw } } });
  } catch (err) {
    logger.error("updateDraft failed", { userId, error: String(err) });
    throw createExternalApiError("Gmail", err);
  }
}

export async function deleteDraft(
  tenantId: string,
  userId: string,
  gmailDraftId: string,
): Promise<void> {
  try {
    const tenant = getTenant(tenantId);
    await tenant.gmail.api.drafts.delete({ id: gmailDraftId });
  } catch (err) {
    logger.warn("deleteDraft failed", { userId, error: String(err) });
    // Non-fatal: draft may already be gone
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface RawGmailMsg {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string | number | null;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

async function upsertEmail(
  userId: string,
  parsed: ReturnType<typeof parseGmailMessage>,
): Promise<void> {
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
          // ✅ Preserve enriched fields — only update if currently default
          priority: sql`CASE WHEN ${emails.priority} = 'normal' AND excluded.priority != 'normal' THEN excluded.priority ELSE ${emails.priority} END`,
          // ✅ Never overwrite a stored embedding
          embedding: sql`COALESCE(${emails.embedding}, excluded.embedding)`,
        },
      })
  } catch (err) {
    logger.warn("upsertEmail failed", { gmailId: parsed.gmailId, error: String(err) });
  }
}

// ── FIX #5: Run upserts in parallel instead of sequentially ──────────────────
async function upsertEmailsBatch(
  userId: string,
  messages: RawGmailMsg[],
): Promise<void> {
  await Promise.allSettled(
    messages.map(async (msg) => {
      try {
        const parsed = parseGmailMessage(msg);
        await upsertEmail(userId, parsed);
      } catch (err) {
        logger.warn("upsertEmail in batch failed", {
          gmailId: msg.id,
          error: String(err),
        });
      }
    }),
  );
}

function mapToListItem(msg: RawGmailMsg): EmailListItem {
  const headers = msg.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

  const internalDate = msg.internalDate;
  let receivedAt: Date | null = null;
  if (internalDate) {
    const ts =
      typeof internalDate === "number"
        ? internalDate
        : typeof internalDate === "string"
          ? parseInt(internalDate, 10)
          : null;
    if (ts) receivedAt = new Date(ts);
  }

  return {
    id: msg.id ?? "",
    gmailId: msg.id ?? "",
    threadId: msg.threadId ?? null,
    fromAddr: getHeader("From"),
    subject: getHeader("Subject"),
    snippet: msg.snippet ?? null,
    isRead: !(msg.labelIds ?? []).includes("UNREAD"),
    labels: msg.labelIds ?? [],
    priority: "normal",
    receivedAt,
  };
}