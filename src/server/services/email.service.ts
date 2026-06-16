// // // import { ListEmailsInput, SendEmailInput } from "@/src/schema";
// // // import { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
// // // import { getTenant } from "../lib/corsair";
// // // import { db } from "../db";
// // // import { emails } from "../db/schema/emails";
// // // import { buildRawMimeMessage, parseGmailMessage } from "../lib/gmail-parser";
// // // import { logger } from "@/src/lib/logger";
// // // import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
// // // import { queueEmailEmbedding } from "@/src/jobs/priority-queue";
// // // import { and, eq, sql, inArray, } from "drizzle-orm";

// // // // ─── Labels that should never appear in the inbox ─────────────────────────────
// // // const INBOX_EXCLUDE_LABELS = new Set(["DRAFT", "SENT", "TRASH", "SPAM"]);

// // // /**
// // //  * Return true if this message should be shown in the inbox view.
// // //  * Drafts, sent mail, trash and spam are excluded.
// // //  */
// // // function isInboxMessage(labelIds: string[]): boolean {
// // //   return !labelIds.some((l) => INBOX_EXCLUDE_LABELS.has(l));
// // // }

// // // /**
// // //  * Read stored priority values for a batch of gmailIds from our emails table.
// // //  * Falls back to "normal" for any gmailId not yet enriched.
// // //  */
// // // async function getPriorityMap(
// // //   userId: string,
// // //   gmailIds: string[],
// // // ): Promise<Map<string, EmailPriority>> {
// // //   const map = new Map<string, EmailPriority>();
// // //   if (gmailIds.length === 0) return map;

// // //   try {
// // //     const rows = await db
// // //       .select({ gmailId: emails.gmailId, priority: emails.priority })
// // //       .from(emails)
// // //       .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)));
    
// // //     logger.warn("CLASSIFIED CHECK", {
// // //   userId,
// // //   requested: gmailIds.length,
// // //   found: rows.length,
// // //   sampleRequested: gmailIds.slice(0, 5),
// // //   sampleFound: rows.slice(0, 5).map((r: { gmailId: any; }) => r.gmailId),
// // // });

// // //     for (const row of rows) {
// // //       map.set(row.gmailId, row.priority);
// // //     }
// // //   } catch (err) {
// // //     logger.warn("getPriorityMap failed", { userId, error: String(err) });
// // //   }

// // //   return map;
// // // }

// // // /**
// // //  * Return the set of gmailIds that have already completed enrichment
// // //  * (priority classification + embedding) in the DB.
// // //  *
// // //  * Embedding presence is used as the SOLE completion signal — enrichEmail
// // //  * runs classification and embedding together via Promise.all and re-throws
// // //  * if embedding fails, so embedding != null implies priority was also set
// // //  * (even if that priority value happens to be "normal").
// // //  *
// // //  * Using priority != 'normal' as a signal would incorrectly re-queue
// // //  * correctly-classified "normal" emails forever; using embedding alone
// // //  * avoids that while still catching genuinely unenriched rows.
// // //  */
// // // async function getClassifiedGmailIds(
// // //   userId: string,
// // //   gmailIds: string[],
// // // ): Promise<Set<string>> {
// // //   if (gmailIds.length === 0) return new Set();

// // //   const rows = await db
// // //     .select({ gmailId: emails.gmailId })
// // //     .from(emails)
// // //     .where(
// // //       and(
// // //         eq(emails.userId, userId),
// // //         inArray(emails.gmailId, gmailIds),
// // //         sql`${emails.embedding} IS NOT NULL`,
// // //       ),
// // //     );

// // //   return new Set(rows.map((r: { gmailId: any; }) => r.gmailId));
// // // }

// // // /**
// // //  * Queue enrichment only for emails that haven't been classified yet.
// // //  * Prevents wasting LLM tokens on already-processed emails.
// // //  */
// // // async function queueUnclassifiedEmails(
// // //   userId: string,
// // //   tenantId: string, 
// // //   parsedEmails: Array<{ gmailId: string; subject: string | null; snippet: string | null; body: string | null }>,
// // // ): Promise<void> {
// // //   if (parsedEmails.length === 0) return;

// // //   const allIds = parsedEmails.map((e) => e.gmailId).filter(Boolean);
// // //   const classified = await getClassifiedGmailIds(userId, allIds);

// // //   logger.warn("QUEUE CHECK", {
// // //   userId,
// // //   totalIds: allIds.length,
// // //   classifiedCount: classified.size,
// // // });

// // //   for (const email of parsedEmails) {
// // //     if (!email.gmailId) continue;
// // //     // Skip if already classified — no need to burn LLM tokens again
// // //     if (classified.has(email.gmailId)) continue;
// // //     // Skip if there's no content to classify
// // //     if (!email.subject && !email.snippet) continue;

    
// // //     void queueEmailEmbedding({
// // //       userId,
// // //       tenantId,
// // //       gmailId: email.gmailId,
// // //       subject: email.subject ?? "",
// // //       snippet: email.snippet ?? "",
// // //       body: email.body ?? "",
// // //     });
// // //   }
// // // }

// // // /** Apply priority filter client-side (Gmail/Corsair don't know our LLM priority). */
// // // function applyPriorityFilter(
// // //   items: EmailListItem[],
// // //   priority: ListEmailsInput["priority"],
// // // ): EmailListItem[] {
// // //   if (!priority || priority === "all") return items;
// // //   return items.filter((item) => item.priority === priority);
// // // }

// // // // ─── listEmail ────────────────────────────────────────────────────────────────

// // // export async function listEmail(
// // //   tenantId: string,
// // //   userId: string,
// // //   opts: ListEmailsInput,
// // // ): Promise<PaginatedResponse<EmailListItem>> {
// // //     logger.warn("LIST EMAIL ENTRY", {
// // //     userId,
// // //     tenantId,
// // //   });
// // //   try {
// // //     const tenant = getTenant(tenantId);

// // //     // Fetch a wider page when filtering by priority so filtered results aren't
// // //     // sparse — priority is applied client-side after fetching.
// // //     const fetchLimit =
// // //       opts.priority && opts.priority !== "all"
// // //         ? Math.min(opts.limit * 3, 100)
// // //         : opts.limit;

// // //     // ── Search path (opts.q) ──────────────────────────────────────────────────
// // //     if (opts.q) {
// // //       const result = await tenant.gmail.api.messages.list({
// // //         q: opts.q,
// // //         maxResults: fetchLimit,
// // //         pageToken: opts.pageToken,
// // //         labelIds: opts.labelIds,
// // //       });

// // //       const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
// // //       const fullMessages = await fetchMessagesBatch(tenant, ids);

// // //       // Filter out drafts/sent from search results too
// // //       const inboxMessages = fullMessages.filter((m) =>
// // //         isInboxMessage(m.labelIds ?? []),
// // //       );

// // //       // Persist to our DB (fire & wait — keeps DB in sync)
// // //       await upsertEmailsBatch(userId, inboxMessages);

// // //       // Queue enrichment only for unclassified emails
// // //       const parsed = inboxMessages.map((m) => parseGmailMessage(m));
// // //       // await queueUnclassifiedEmails(userId,tenantId, parsed);

// // //       const items = inboxMessages.map(mapToListItem);
// // //       const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
// // //       const priorityMap = await getPriorityMap(userId, gmailIds);
// // //       logger.info("PRIORITY MAP", {
// // //       count: priorityMap.size,
// // //     });
// // //       const withPriority = applyPriorityMap(items, priorityMap);

// // //       return {
// // //         items: applyPriorityFilter(withPriority, opts.priority),
// // //         nextPageToken: result.nextPageToken,
// // //         total: result.resultSizeEstimate,
// // //       };
// // //     }

// // //     // ── Cache path ────────────────────────────────────────────────────────────
// // //     const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

// // //     const cached = await tenant.gmail.db.messages.search({
// // //       data: {},
// // //       limit: fetchLimit,
// // //       offset,
// // //     });

// // //     console.log(cached.length)

// // //     // console.log(cached)

// // //     // const cached: any[] = []

// // //     // Filter out drafts/sent/trash/spam from cache results
// // //     const inboxCached = cached.filter((row) =>
// // //       isInboxMessage(row.data.labelIds ?? []),
// // //     );

// // //     if (inboxCached.length === 0 && offset === 0) {
// // //       // Cache is cold — hit Gmail API directly
// // //       return await fetchFromGmailApi(tenant, tenantId, userId, opts, fetchLimit);
// // //     }

// // //     // Cache hit — map to UI items

// // //     // TEMP DEBUG — remove after checking shape
// // // if (inboxCached.length > 0) {
// // //   logger.warn("CACHE ROW SHAPE", {
// // //     entity_id: inboxCached[0].entity_id,
// // //     row_id: inboxCached[0].id,
// // //     data_keys: Object.keys(inboxCached[0].data ?? {}),
// // //     raw_sample: JSON.stringify(inboxCached[0]).slice(0, 1000),
// // //   });
// // // }

// // //     const mapped: EmailListItem[] = inboxCached.map((row) => ({
// // //       id: row.id,
// // //       gmailId: (row.data as any).id ?? row.entity_id,
// // //       threadId: row.data.threadId ?? null,
// // //       fromAddr: row.data.from ?? null,
// // //       subject: row.data.subject ?? null,
// // //       snippet: row.data.snippet ?? null,
// // //       isRead: !(row.data.labelIds ?? []).includes("UNREAD"),
// // //       labels: row.data.labelIds ?? [],
// // //       priority: "normal" as const,
// // //       receivedAt: row.data.internalDate
// // //         ? new Date(parseInt(row.data.internalDate, 10))
// // //         : null,
// // //     }));

// // //     const cachedIds = mapped.map((m) => m.gmailId).filter(Boolean);

// // //     // ── FIX #1: Cache path also queues enrichment ─────────────────────────────
// // //     // Previously the cache path never called queueEmailEmbedding, so cached
// // //     // emails were never classified. We also need to upsert into our DB if the
// // //     // row doesn't exist yet (Corsair cache populated by webhook, our DB may lag).
// // //     const parsedForQueue = inboxCached.map((row) => ({
// // //       gmailId: (row.data as any).id ?? row.entity_id,
// // //       subject: row.data.subject ?? null,
// // //       snippet: row.data.snippet ?? null,
// // //       body: null, // cache doesn't store body
// // //     }));
    
// // //     // await queueUnclassifiedEmails(userId,tenantId, parsedForQueue);

// // //     const priorityMap = await getPriorityMap(userId, cachedIds);


// // //     logger.info("PRIORITY MAP", {
// // //         count: priorityMap.size,
// // //       });
    
// // //     const withPriority = applyPriorityMap(mapped, priorityMap);

// // //     return {
// // //       items: applyPriorityFilter(withPriority, opts.priority),
// // //       nextPageToken:
// // //         inboxCached.length === fetchLimit
// // //           ? String(offset + fetchLimit)
// // //           : undefined,
// // //     };
// // //   } catch (error) {
// // //     logger.error("listEmail failed", { userId, error: String(error) });
// // //     throw createExternalApiError("Gmail", error);
// // //   }
// // // }

// // // /** Shared helper: fetch from Gmail API, persist, queue enrichment, return items. */
// // // async function fetchFromGmailApi(
// // //   tenant: ReturnType<typeof getTenant>,
// // //   tenantId: string,
// // //   userId: string,
// // //   opts: ListEmailsInput,
// // //   fetchLimit: number,
// // // ): Promise<PaginatedResponse<EmailListItem>> {
// // //   const labelIds = opts.labelIds?.length
// // //     ? opts.labelIds
// // //     : ["INBOX"]; // Always scope to INBOX when no explicit labels

// // //   const result = await tenant.gmail.api.messages.list({
// // //     maxResults: fetchLimit,
// // //     pageToken: opts.pageToken,
// // //     labelIds,
// // //   });

// // //   logger.info("Fetching from Gmail API (cache miss)", { userId });

// // //   const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
// // //   const fullMessages = await fetchMessagesBatch(tenant, ids);

// // //   // Filter out non-inbox messages (drafts, sent, etc.)
// // //   const inboxMessages = fullMessages.filter((m) =>
// // //     isInboxMessage(m.labelIds ?? []),
// // //   );

// // //   // Persist to our DB
// // //   await upsertEmailsBatch(userId, inboxMessages);

// // //   // Populate Corsair's local DB cache (fire-and-forget, best-effort)
// // //   for (const msg of inboxMessages) {
// // //     if (!msg.id) continue;
// // //     const headers = msg.payload?.headers ?? [];
// // //     const getHeader = (name: string) =>
// // //       headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

// // //     void tenant.gmail.db.messages.upsertByEntityId(
// // //         msg.id,
// // //         {
// // //           id: msg.id,
// // //           threadId: msg.threadId ?? undefined,
// // //           snippet: msg.snippet ?? undefined,
// // //           historyId: (msg as any).historyId ?? undefined,
// // //           internalDate:
// // //             msg.internalDate != null
// // //               ? String(msg.internalDate)
// // //               : undefined,
// // //           labelIds: msg.labelIds ?? [],
// // //           subject: getHeader("Subject") ?? undefined,
// // //           from: getHeader("From") ?? undefined,
// // //           to: getHeader("To") ?? undefined,
// // //           body: undefined,
// // //         }
// // //       )
// // //       .catch((err: unknown) =>
// // //         logger.warn("Failed to cache message in Corsair DB", {
// // //           gmailId: msg.id,
// // //           error: String(err),
// // //         }),
// // //       );
// // //   }

// // //   // Queue enrichment for unclassified emails only
// // //   const parsed = inboxMessages.map((m) => parseGmailMessage(m));
  
// // //   await queueUnclassifiedEmails(userId,tenantId,parsed);

// // //   const items = inboxMessages.map(mapToListItem);
// // //   const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
// // //   const priorityMap = await getPriorityMap(userId, gmailIds);
// // //   logger.info("PRIORITY MAP", {
// // //   count: priorityMap.size,
// // // });
// // //   const withPriority = applyPriorityMap(items, priorityMap);

// // //   return {
// // //     items: applyPriorityFilter(withPriority, opts.priority),
// // //     nextPageToken: result.nextPageToken,
// // //     total: result.resultSizeEstimate,
// // //   };
// // // }

// // // /** Fetch full Gmail messages in parallel batches of 5. */
// // // async function fetchMessagesBatch(
// // //   tenant: ReturnType<typeof getTenant>,
// // //   ids: string[],
// // // ): Promise<RawGmailMsg[]> {
// // //   const BATCH = 5;
// // //   const results: RawGmailMsg[] = [];
// // //   for (let i = 0; i < ids.length; i += BATCH) {
// // //     const batch = ids.slice(i, i + BATCH);
// // //     const fetched = await Promise.all(
// // //       batch.map((id) => tenant.gmail.api.messages.get({ id, format: "metadata" })),
// // //     );
// // //     results.push(...fetched);
// // //   }
// // //   return results;
// // // }

// // // /** Merge priorityMap into items. Falls back to item's existing priority. */
// // // function applyPriorityMap(
// // //   items: EmailListItem[],
// // //   priorityMap: Map<string, EmailPriority>,
// // // ): EmailListItem[] {
// // //   return items.map((item) => ({
// // //     ...item,
// // //     priority: priorityMap.get(item.gmailId) ?? item.priority,
// // //   }));
// // // }

// // // // ─── getEmail ─────────────────────────────────────────────────────────────────

// // // export async function getEmail(
// // //   userId: string,
// // //   gmailTenantId: string,
// // //   gmailId: string,
// // // ): Promise<Email> {
// // //   try {
// // //     const tenant = getTenant(gmailTenantId);

// // //     const msg = await tenant.gmail.api.messages.get({
// // //       id: gmailId,
// // //       format: "full",
// // //     });

// // //     if (!msg) throw createNotFoundError("Email");

// // //     const parsed = parseGmailMessage(msg);

// // //     // Persist full email (includes body)
// // //     await upsertEmail(userId, parsed);

// // //     // Queue enrichment only if not yet classified
// // //     if (parsed.subject || parsed.snippet) {
// // //       await queueUnclassifiedEmails(userId,gmailTenantId, [
// // //         {
// // //           gmailId: parsed.gmailId,
// // //           subject: parsed.subject,
// // //           snippet: parsed.snippet,
// // //           body: parsed.body,
// // //         },
// // //       ]);
// // //     }

// // //     // ── FIX #4: Read actual priority from DB instead of hardcoding "normal" ──
// // //     const priorityMap = await getPriorityMap(userId, [gmailId]);
// // //     logger.info("PRIORITY MAP", {
// // //   count: priorityMap.size,
// // // });
// // //     const priority = priorityMap.get(gmailId) ?? "normal";

// // //     return {
// // //       id: gmailId,
// // //       userId,
// // //       gmailId,
// // //       threadId: parsed.threadId,
// // //       fromAddr: parsed.fromAddr,
// // //       toAddrs: parsed.toAddrs,
// // //       ccAddrs: parsed.ccAddrs,
// // //       subject: parsed.subject,
// // //       snippet: parsed.snippet,
// // //       body: parsed.body,
// // //       isRead: parsed.isRead,
// // //       labels: parsed.labels,
// // //       priority,
// // //       attachments: parsed.attachments,
// // //       receivedAt: parsed.receivedAt,
// // //     };
// // //   } catch (err) {
// // //     logger.error("getEmail failed", { userId, gmailId, error: String(err) });

// // //     if ((err as Error).message?.includes("not found")) throw err;

// // //     throw createExternalApiError("Gmail", err);
// // //   }
// // // }

// // // // ─── modifyEmail ──────────────────────────────────────────────────────────────

// // // export async function modifyEmail(
// // //   tenantId: string,
// // //   userId: string,
// // //   gmailId: string,
// // //   opts: { isRead?: boolean; addLabels?: string[]; removeLabels?: string[] },
// // // ): Promise<void> {
// // //   try {
// // //     const tenant = getTenant(tenantId);

// // //     const addLabelIds: string[] = [...(opts.addLabels ?? [])];
// // //     const removeLabelIds: string[] = [...(opts.removeLabels ?? [])];

// // //     if (opts.isRead === true) removeLabelIds.push("UNREAD");
// // //     if (opts.isRead === false) addLabelIds.push("UNREAD");

// // //     if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
// // //       await tenant.gmail.api.messages.modify({ id: gmailId, addLabelIds, removeLabelIds });
// // //     }

// // //     await db
// // //       .update(emails)
// // //       .set({
// // //         isRead: opts.isRead !== undefined ? opts.isRead : sql`${emails.isRead}`,
// // //         updatedAt: new Date(),
// // //       })
// // //       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
// // //   } catch (error) {
// // //     logger.error("modifyEmail failed", { userId, gmailId, error: String(error) });
// // //     throw createExternalApiError("Gmail", error);
// // //   }
// // // }

// // // // ─── archiveEmail ─────────────────────────────────────────────────────────────

// // // export async function archiveEmail(
// // //   tenantId: string,
// // //   userId: string,
// // //   gmailId: string,
// // // ): Promise<void> {
// // //   try {
// // //     const tenant = getTenant(tenantId);

// // //     await tenant.gmail.api.messages.modify({
// // //       id: gmailId,
// // //       removeLabelIds: ["INBOX"],
// // //     });

// // //     await db
// // //       .update(emails)
// // //       .set({ updatedAt: new Date() })
// // //       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
// // //   } catch (err) {
// // //     logger.error("archiveEmail failed", { userId, gmailId, error: String(err) });
// // //     throw createExternalApiError("Gmail", err);
// // //   }
// // // }

// // // // ─── sendEmail ────────────────────────────────────────────────────────────────

// // // export async function sendEmail(
// // //   tenantId: string,
// // //   userId: string,
// // //   input: SendEmailInput,
// // //   userEmail: string,
// // // ): Promise<{ messageId: string; threadId: string | null }> {
// // //   try {
// // //     const tenant = getTenant(tenantId);

// // //     const raw = buildRawMimeMessage({
// // //       from: userEmail,
// // //       to: input.to,
// // //       cc: input.cc,
// // //       bcc: input.bcc,
// // //       subject: input.subject,
// // //       body: input.body,
// // //     });

// // //     const result = await tenant.gmail.api.messages.send({ raw });

// // //     logger.info("Email sent", { userId, messageId: result.id });

// // //     return {
// // //       messageId: result.id ?? "",
// // //       threadId: result.threadId ?? null,
// // //     };
// // //   } catch (err) {
// // //     logger.error("sendEmail failed", { userId, error: String(err) });
// // //     throw createExternalApiError("Email", err);
// // //   }
// // // }

// // // // ─── Draft management ─────────────────────────────────────────────────────────

// // // export async function createDraft(
// // //   tenantId: string,
// // //   userId: string,
// // //   raw: string,
// // // ): Promise<{ draftId: string }> {
// // //   try {
// // //     const tenant = getTenant(tenantId);
// // //     const result = await tenant.gmail.api.drafts.create({ draft: { message: { raw } } });
// // //     return { draftId: result.id ?? "" };
// // //   } catch (err) {
// // //     logger.error("createDraft failed", { userId, error: String(err) });
// // //     throw createExternalApiError("Gmail", err);
// // //   }
// // // }

// // // export async function updateDraft(
// // //   tenantId: string,
// // //   userId: string,
// // //   gmailDraftId: string,
// // //   raw: string,
// // // ): Promise<void> {
// // //   try {
// // //     const tenant = getTenant(tenantId);
// // //     await tenant.gmail.api.drafts.update({ id: gmailDraftId, draft: { message: { raw } } });
// // //   } catch (err) {
// // //     logger.error("updateDraft failed", { userId, error: String(err) });
// // //     throw createExternalApiError("Gmail", err);
// // //   }
// // // }

// // // export async function deleteDraft(
// // //   tenantId: string,
// // //   userId: string,
// // //   gmailDraftId: string,
// // // ): Promise<void> {
// // //   try {
// // //     const tenant = getTenant(tenantId);
// // //     await tenant.gmail.api.drafts.delete({ id: gmailDraftId });
// // //   } catch (err) {
// // //     logger.warn("deleteDraft failed", { userId, error: String(err) });
// // //     // Non-fatal: draft may already be gone
// // //   }
// // // }

// // // // ─── DB helpers ───────────────────────────────────────────────────────────────

// // // interface RawGmailMsg {
// // //   id?: string;
// // //   threadId?: string;
// // //   snippet?: string;
// // //   labelIds?: string[];
// // //   internalDate?: string | number | null;
// // //   payload?: {
// // //     headers?: Array<{ name?: string; value?: string }>;
// // //   };
// // // }

// // // async function upsertEmail(
// // //   userId: string,
// // //   parsed: ReturnType<typeof parseGmailMessage>,
// // // ): Promise<void> {
// // //   if (!parsed.gmailId) return;

// // //   logger.warn("UPSERT EMAIL", {
// // //   userId,
// // //   gmailId: parsed.gmailId,
// // // });
// // //   try {
// // //     await db
// // //       .insert(emails)
// // //       .values({
// // //         userId,
// // //         gmailId: parsed.gmailId,
// // //         threadId: parsed.threadId,
// // //         fromAddr: parsed.fromAddr,
// // //         toAddrs: parsed.toAddrs,
// // //         ccAddrs: parsed.ccAddrs,
// // //         subject: parsed.subject,
// // //         snippet: parsed.snippet,
// // //         body: parsed.body,
// // //         isRead: parsed.isRead,
// // //         labels: parsed.labels,
// // //         attachments: parsed.attachments,
// // //         receivedAt: parsed.receivedAt,
// // //       })
// // //       .onConflictDoUpdate({
// // //         target: [emails.userId, emails.gmailId],
// // //         set: {
// // //           snippet: parsed.snippet,
// // //           isRead: parsed.isRead,
// // //           labels: parsed.labels,
// // //           body: parsed.body ?? sql`${emails.body}`,
// // //           updatedAt: new Date(),
// // //           // ✅ Preserve enriched fields — only update if currently default
// // //           priority: sql`CASE WHEN ${emails.priority} = 'normal' AND excluded.priority != 'normal' THEN excluded.priority ELSE ${emails.priority} END`,
// // //           // ✅ Never overwrite a stored embedding
// // //           embedding: sql`COALESCE(${emails.embedding}, excluded.embedding)`,
// // //         },
// // //       })
// // //   } catch (err) {
// // //     logger.warn("upsertEmail failed", { gmailId: parsed.gmailId, error: String(err) });
// // //   }
// // // }

// // // // ── FIX #5: Run upserts in parallel instead of sequentially ──────────────────
// // // async function upsertEmailsBatch(
// // //   userId: string,
// // //   messages: RawGmailMsg[],
// // // ): Promise<void> {
// // //   await Promise.allSettled(
// // //     messages.map(async (msg) => {
// // //       try {
// // //         const parsed = parseGmailMessage(msg);
// // //         await upsertEmail(userId, parsed);
// // //       } catch (err) {
// // //         logger.warn("upsertEmail in batch failed", {
// // //           gmailId: msg.id,
// // //           error: String(err),
// // //         });
// // //       }
// // //     }),
// // //   );
// // // }

// // // function mapToListItem(msg: RawGmailMsg): EmailListItem {
// // //   const headers = msg.payload?.headers ?? [];
// // //   const getHeader = (name: string) =>
// // //     headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

// // //   const internalDate = msg.internalDate;
// // //   let receivedAt: Date | null = null;
// // //   if (internalDate) {
// // //     const ts =
// // //       typeof internalDate === "number"
// // //         ? internalDate
// // //         : typeof internalDate === "string"
// // //           ? parseInt(internalDate, 10)
// // //           : null;
// // //     if (ts) receivedAt = new Date(ts);
// // //   }

// // //   return {
// // //     id: msg.id ?? "",
// // //     gmailId: msg.id ?? "",
// // //     threadId: msg.threadId ?? null,
// // //     fromAddr: getHeader("From"),
// // //     subject: getHeader("Subject"),
// // //     snippet: msg.snippet ?? null,
// // //     isRead: !(msg.labelIds ?? []).includes("UNREAD"),
// // //     labels: msg.labelIds ?? [],
// // //     priority: "normal",
// // //     receivedAt,
// // //   };
// // // }


// // /**
// //  * email.service.ts
// //  *
// //  * Single source of truth for all Gmail operations.
// //  *
// //  * Flow:
// //  *  login → /inbox loads → listEmail() → cache hit? serve from Corsair cache + DB priority
// //  *                                      → cache miss? fetch Gmail API → persist → return
// //  *  background: enrichEmail() classifies priority + generates embedding → updates DB → SSE push
// //  *  new mail: Gmail webhook → upsert to Corsair cache + DB → enrich → SSE push to UI
// //  */

// // import { and, eq, inArray, sql } from "drizzle-orm";
// // import { db } from "../db";
// // import { emails } from "../db/schema/emails";
// // import { getTenant, getTenantId } from "../lib/corsair";
// // import { buildRawMimeMessage, parseGmailMessage } from "../lib/gmail-parser";
// // import { logger } from "@/src/lib/logger";
// // import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
// // import { queueEmailEmbedding } from "@/src/jobs/priority-queue";
// // import { emitToUser } from "../lib/sse";
// // import type { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
// // import type { ListEmailsInput, SendEmailInput } from "@/src/schema";

// // // ─── Constants ────────────────────────────────────────────────────────────────

// // /** Labels that must never appear in the inbox view */
// // const INBOX_EXCLUDE = new Set(["DRAFT", "SENT", "TRASH", "SPAM"]);

// // const PAGE_SIZE = 50;

// // // ─── Helpers ──────────────────────────────────────────────────────────────────

// // function isInboxMessage(labelIds: string[]): boolean {
// //   return !labelIds.some((l) => INBOX_EXCLUDE.has(l));
// // }

// // /** Pull priority values for a batch of gmailIds from our DB. */
// // async function getPriorityMap(
// //   userId: string,
// //   gmailIds: string[],
// // ): Promise<Map<string, EmailPriority>> {
// //   const map = new Map<string, EmailPriority>();
// //   if (!gmailIds.length) return map;

// //   try {
// //     const rows = await db
// //       .select({ gmailId: emails.gmailId, priority: emails.priority })
// //       .from(emails)
// //       .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)));

// //     for (const row of rows) {
// //       map.set(row.gmailId, row.priority as EmailPriority);
// //     }
// //   } catch (err) {
// //     logger.warn("getPriorityMap failed", { userId, error: String(err) });
// //   }

// //   return map;
// // }

// // /**
// //  * Return the set of gmailIds that have already been enriched.
// //  * We use `embedding IS NOT NULL` as the completion signal — enrichEmail sets
// //  * both priority AND embedding atomically so either both are done or neither.
// //  */
// // async function getEnrichedIds(
// //   userId: string,
// //   gmailIds: string[],
// // ): Promise<Set<string>> {
// //   if (!gmailIds.length) return new Set();

// //   const rows = await db
// //     .select({ gmailId: emails.gmailId })
// //     .from(emails)
// //     .where(
// //       and(
// //         eq(emails.userId, userId),
// //         inArray(emails.gmailId, gmailIds),
// //         sql`${emails.embedding} IS NOT NULL`,
// //       ),
// //     );

// //   return new Set(rows.map((r) => r.gmailId));
// // }

// // /** Queue enrichment only for emails that haven't been enriched yet. */
// // async function queueUnclassified(
// //   userId: string,
// //   googleSub: string,
// //   items: Array<{ gmailId: string; subject: string | null; snippet: string | null; body: string | null }>,
// // ): Promise<void> {
// //   if (!items.length) return;

// //   const ids = items.map((e) => e.gmailId).filter(Boolean);
// //   const enriched = await getEnrichedIds(userId, ids);

// //   for (const item of items) {
// //     if (!item.gmailId) continue;
// //     if (enriched.has(item.gmailId)) continue;
// //     if (!item.subject && !item.snippet) continue;

// //     console.log(item);
// //     void queueEmailEmbedding({
// //       userId,
// //       tenantId: googleSub, // raw googleSub — getTenantId() is called inside queueEmailEmbedding
// //       gmailId: item.gmailId,
// //       subject: item.subject ?? "",
// //       snippet: item.snippet ?? "",
// //       body: item.body ?? "",
// //     });
// //   }
// // }

// // function applyPriorityMap(
// //   items: EmailListItem[],
// //   map: Map<string, EmailPriority>,
// // ): EmailListItem[] {
// //   return items.map((item) => ({
// //     ...item,
// //     priority: map.get(item.gmailId) ?? item.priority,
// //   }));
// // }

// // /** Raw Gmail message shape returned by Corsair/API */
// // interface RawMsg {
// //   id?: string;
// //   threadId?: string;
// //   snippet?: string;
// //   labelIds?: string[];
// //   internalDate?: string | number | null;
// //   payload?: {
// //     headers?: Array<{ name?: string; value?: string }>;
// //   };
// // }

// // function getHeader(msg: RawMsg, name: string): string | null {
// //   return (
// //     msg.payload?.headers?.find(
// //       (h) => h.name?.toLowerCase() === name.toLowerCase(),
// //     )?.value ?? null
// //   );
// // }

// // function rawToListItem(msg: RawMsg): EmailListItem {
// //   let receivedAt: Date | null = null;
// //   if (msg.internalDate) {
// //     const ts =
// //       typeof msg.internalDate === "number"
// //         ? msg.internalDate
// //         : parseInt(String(msg.internalDate), 10);
// //     if (!isNaN(ts)) receivedAt = new Date(ts);
// //   }

// //   return {
// //     id: msg.id ?? "",
// //     gmailId: msg.id ?? "",
// //     threadId: msg.threadId ?? null,
// //     fromAddr: getHeader(msg, "From"),
// //     subject: getHeader(msg, "Subject"),
// //     snippet: msg.snippet ?? null,
// //     isRead: !(msg.labelIds ?? []).includes("UNREAD"),
// //     labels: msg.labelIds ?? [],
// //     priority: "normal",
// //     receivedAt,
// //   };
// // }

// // /** Fetch full Gmail messages in parallel batches of 5. */
// // async function fetchBatch(
// //   tenant: ReturnType<typeof getTenant>,
// //   ids: string[],
// //   format: "metadata" | "full" = "metadata",
// // ): Promise<RawMsg[]> {
// //   const BATCH = 5;
// //   const results: RawMsg[] = [];
// //   for (let i = 0; i < ids.length; i += BATCH) {
// //     const slice = ids.slice(i, i + BATCH);
// //     const fetched = await Promise.all(
// //       slice.map((id) => tenant.gmail.api.messages.get({ id, format })),
// //     );
// //     results.push(...fetched);
// //   }
// //   return results;
// // }

// // // ─── DB upsert ────────────────────────────────────────────────────────────────

// // async function upsertOne(
// //   userId: string,
// //   parsed: ReturnType<typeof parseGmailMessage>,
// // ): Promise<void> {
// //   if (!parsed.gmailId) return;
// //   try {
// //     await db
// //       .insert(emails)
// //       .values({
// //         userId,
// //         gmailId: parsed.gmailId,
// //         threadId: parsed.threadId,
// //         fromAddr: parsed.fromAddr,
// //         toAddrs: parsed.toAddrs,
// //         ccAddrs: parsed.ccAddrs,
// //         subject: parsed.subject,
// //         snippet: parsed.snippet,
// //         body: parsed.body,
// //         isRead: parsed.isRead,
// //         labels: parsed.labels,
// //         attachments: parsed.attachments,
// //         receivedAt: parsed.receivedAt,
// //       })
// //       .onConflictDoUpdate({
// //         target: [emails.userId, emails.gmailId],
// //         set: {
// //           snippet: parsed.snippet,
// //           isRead: parsed.isRead,
// //           labels: parsed.labels,
// //           body: parsed.body ?? sql`${emails.body}`,
// //           updatedAt: new Date(),
// //           // Never downgrade a classified priority back to "normal"
// //           priority: sql`CASE WHEN ${emails.priority} != 'normal' THEN ${emails.priority} ELSE excluded.priority END`,
// //           // Never overwrite an existing embedding
// //           embedding: sql`COALESCE(${emails.embedding}, excluded.embedding)`,
// //         },
// //       });
// //   } catch (err) {
// //     logger.warn("upsertOne failed", { gmailId: parsed.gmailId, error: String(err) });
// //   }
// // }

// // async function upsertBatch(userId: string, msgs: RawMsg[]): Promise<void> {
// //   await Promise.allSettled(
// //     msgs.map(async (msg) => {
// //       try {
// //         await upsertOne(userId, parseGmailMessage(msg));
// //       } catch (err) {
// //         logger.warn("upsertBatch item failed", { gmailId: msg.id, error: String(err) });
// //       }
// //     }),
// //   );
// // }

// // /** Also populate Corsair's local cache (best-effort, fire-and-forget). */
// // function populateCorsairCache(
// //   tenant: ReturnType<typeof getTenant>,
// //   msgs: RawMsg[],
// // ): void {
// //   for (const msg of msgs) {
// //     if (!msg.id) continue;
// //     void tenant.gmail.db.messages
// //       .upsertByEntityId(msg.id, {
// //         id: msg.id,
// //         threadId: msg.threadId ?? undefined,
// //         snippet: msg.snippet ?? undefined,
// //         internalDate: msg.internalDate != null ? String(msg.internalDate) : undefined,
// //         labelIds: msg.labelIds ?? [],
// //         subject: getHeader(msg, "Subject") ?? undefined,
// //         from: getHeader(msg, "From") ?? undefined,
// //         to: getHeader(msg, "To") ?? undefined,
// //       })
// //       .catch((err: unknown) =>
// //         logger.warn("Corsair cache upsert failed", { gmailId: msg.id, error: String(err) }),
// //       );
// //   }
// // }

// // // ─── listEmail ────────────────────────────────────────────────────────────────

// // /**
// //  * List emails for the inbox.
// //  *
// //  * @param googleSub  - User's Google Subject ID (used as Corsair tenantId)
// //  * @param userId     - Internal DB user UUID
// //  * @param opts       - Pagination / filter options
// //  */
// // export async function listEmail(
// //   googleSub: string,
// //   userId: string,
// //   opts: ListEmailsInput,
// // ): Promise<PaginatedResponse<EmailListItem>> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     const fetchLimit = opts.limit ?? PAGE_SIZE;

// //     // ── Search path ─────────────────────────────────────────────────────────
// //     if (opts.q) {
// //       const result = await tenant.gmail.api.messages.list({
// //         q: opts.q,
// //         maxResults: fetchLimit,
// //         pageToken: opts.pageToken,
// //         labelIds: opts.labelIds,
// //       });

// //       const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
// //       const fullMsgs = await fetchBatch(tenant, ids);
// //       const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

// //       await upsertBatch(userId, inbox);
// //       populateCorsairCache(tenant, inbox);

// //       const items = inbox.map(rawToListItem);
// //       const priorityMap = await getPriorityMap(userId, items.map((i) => i.gmailId));
// //       const withPriority = applyPriorityMap(items, priorityMap);

// //       // Queue enrichment for any unclassified emails
// //       await queueUnclassified(
// //         userId,
// //         googleSub,
// //         inbox.map((m) => parseGmailMessage(m)),
// //       );

// //       return {
// //         items: filterByPriority(withPriority, opts.priority),
// //         nextPageToken: result.nextPageToken,
// //         total: result.resultSizeEstimate,
// //       };
// //     }

// //     // ── Cache path ──────────────────────────────────────────────────────────
// //     const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

// //     const cached = await tenant.gmail.db.messages.search({
// //       data: {},
// //       limit: fetchLimit,
// //       offset,
// //     });

// //     const inboxCached = cached.filter((row) =>
// //       isInboxMessage((row.data.labelIds as string[]) ?? []),
// //     );
// //     // console.log("inbox",inboxCached)

// //     // Cold cache → hit Gmail API
// //     if (!inboxCached.length && offset === 0) {
// //       return fetchFromGmailApi(tenant, googleSub, userId, opts, fetchLimit);
// //     }

// //     // Map cached rows to EmailListItem
// //     const items: EmailListItem[] = inboxCached.map((row) => {
// //       const data = row.data as Record<string, unknown>;
// //       const internalDate = data.internalDate as string | undefined;
// //       return {
// //         id: row.id,
// //         gmailId: (data.id as string) ?? row.entity_id,
// //         threadId: (data.threadId as string) ?? null,
// //         fromAddr: (data.from as string) ?? null,
// //         subject: (data.subject as string) ?? null,
// //         snippet: (data.snippet as string) ?? null,
// //         isRead: !((data.labelIds as string[]) ?? []).includes("UNREAD"),
// //         labels: (data.labelIds as string[]) ?? [],
// //         priority: "normal",
// //         receivedAt: internalDate ? new Date(parseInt(internalDate, 10)) : null,
// //       };
// //     });

// //     const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
// //     const priorityMap = await getPriorityMap(userId, gmailIds);
// //     const withPriority = applyPriorityMap(items, priorityMap);

// //     // Queue any unclassified items (cache path was previously missing this)
// //     // await queueUnclassified(
// //     //   userId,
// //     //   googleSub,
// //     //   inboxCached.map((row) => {
// //     //     const d = row.data as Record<string, unknown>;
// //     //     return {
// //     //       gmailId: ((d.id as string) ?? row.entity_id),
// //     //       subject: (d.subject as string) ?? null,
// //     //       snippet: (d.snippet as string) ?? null,
// //     //       body: null,
// //     //     };
// //     //   }),
// //     // );

// //     return {
// //       items: filterByPriority(withPriority, opts.priority),
// //       nextPageToken:
// //         inboxCached.length === fetchLimit ? String(offset + fetchLimit) : undefined,
// //     };
// //   } catch (err) {
// //     logger.error("listEmail failed", { userId, error: String(err) });
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // /** Fetch from Gmail API (cache miss path). Persists + queues enrichment. */
// // async function fetchFromGmailApi(
// //   tenant: ReturnType<typeof getTenant>,
// //   googleSub: string,
// //   userId: string,
// //   opts: ListEmailsInput,
// //   fetchLimit: number,
// // ): Promise<PaginatedResponse<EmailListItem>> {
// //   const labelIds = opts.labelIds?.length ? opts.labelIds : ["INBOX"];

// //   const result = await tenant.gmail.api.messages.list({
// //     maxResults: fetchLimit,
// //     pageToken: opts.pageToken,
// //     labelIds,
// //   });

// //   logger.info("Cache miss — fetched from Gmail API", { userId });

// //   const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
// //   const fullMsgs = await fetchBatch(tenant, ids);
// //   const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

// //   // Persist to our DB and Corsair cache in parallel
// //   await Promise.all([
// //     upsertBatch(userId, inbox),
// //   ]);
// //   populateCorsairCache(tenant, inbox);

// //   const items = inbox.map(rawToListItem);
// //   const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
// //   const priorityMap = await getPriorityMap(userId, gmailIds);
// //   const withPriority = applyPriorityMap(items, priorityMap);

// //   // Queue enrichment for unclassified emails
// //   await queueUnclassified(
// //     userId,
// //     googleSub,
// //     inbox.map((m) => parseGmailMessage(m)),
// //   );

// //   return {
// //     items: filterByPriority(withPriority, opts.priority),
// //     nextPageToken: result.nextPageToken,
// //     total: result.resultSizeEstimate,
// //   };
// // }

// // function filterByPriority(
// //   items: EmailListItem[],
// //   priority: ListEmailsInput["priority"],
// // ): EmailListItem[] {
// //   if (!priority || priority === "all") return items;
// //   return items.filter((i) => i.priority === priority);
// // }

// // // ─── getEmail ─────────────────────────────────────────────────────────────────

// // export async function getEmail(
// //   userId: string,
// //   googleSub: string,
// //   gmailId: string,
// // ): Promise<Email> {
// //   try {
// //     const tenant = getTenant(googleSub);

// //     const msg = await tenant.gmail.api.messages.get({ id: gmailId, format: "full" });
// //     if (!msg) throw createNotFoundError("Email");

// //     // console.log(msg)

// //     const parsed = parseGmailMessage(msg);
// //     await upsertOne(userId, parsed);

// //     // Queue enrichment if not done yet
// //     // if (parsed.subject || parsed.snippet) {
// //     //   await queueUnclassified(userId, googleSub, [
// //     //     {
// //     //       gmailId: parsed.gmailId,
// //     //       subject: parsed.subject,
// //     //       snippet: parsed.snippet,
// //     //       body: parsed.body,
// //     //     },
// //     //   ]);
// //     // }

// //     const priorityMap = await getPriorityMap(userId, [gmailId]);
// //     const priority = priorityMap.get(gmailId) ?? "normal";

// //     return {
// //       id: gmailId,
// //       userId,
// //       gmailId,
// //       threadId: parsed.threadId,
// //       fromAddr: parsed.fromAddr,
// //       toAddrs: parsed.toAddrs,
// //       ccAddrs: parsed.ccAddrs,
// //       subject: parsed.subject,
// //       snippet: parsed.snippet,
// //       body: parsed.body,
// //       isRead: parsed.isRead,
// //       labels: parsed.labels,
// //       priority,
// //       attachments: parsed.attachments,
// //       receivedAt: parsed.receivedAt,
// //     };
// //   } catch (err) {
// //     logger.error("getEmail failed", { userId, gmailId, error: String(err) });
// //     if ((err as Error).message?.includes("not found")) throw err;
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // // ─── modifyEmail ──────────────────────────────────────────────────────────────

// // export async function modifyEmail(
// //   googleSub: string,
// //   userId: string,
// //   gmailId: string,
// //   opts: { isRead?: boolean; addLabels?: string[]; removeLabels?: string[] },
// // ): Promise<void> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     const addLabelIds = [...(opts.addLabels ?? [])];
// //     const removeLabelIds = [...(opts.removeLabels ?? [])];

// //     if (opts.isRead === true) removeLabelIds.push("UNREAD");
// //     if (opts.isRead === false) addLabelIds.push("UNREAD");

// //     if (addLabelIds.length || removeLabelIds.length) {
// //       await tenant.gmail.api.messages.modify({ id: gmailId, addLabelIds, removeLabelIds });
// //     }

// //     await db
// //       .update(emails)
// //       .set({
// //         isRead: opts.isRead !== undefined ? opts.isRead : sql`${emails.isRead}`,
// //         updatedAt: new Date(),
// //       })
// //       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
// //   } catch (err) {
// //     logger.error("modifyEmail failed", { userId, gmailId, error: String(err) });
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // // ─── archiveEmail ─────────────────────────────────────────────────────────────

// // export async function archiveEmail(
// //   googleSub: string,
// //   userId: string,
// //   gmailId: string,
// // ): Promise<void> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     await tenant.gmail.api.messages.modify({ id: gmailId, removeLabelIds: ["INBOX"] });
// //     await db
// //       .update(emails)
// //       .set({ updatedAt: new Date() })
// //       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
// //   } catch (err) {
// //     logger.error("archiveEmail failed", { userId, gmailId, error: String(err) });
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // // ─── sendEmail ────────────────────────────────────────────────────────────────

// // export async function sendEmail(
// //   googleSub: string,
// //   userId: string,
// //   input: SendEmailInput,
// //   userEmail: string,
// // ): Promise<{ messageId: string; threadId: string | null }> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     const raw = buildRawMimeMessage({
// //       from: userEmail,
// //       to: input.to,
// //       cc: input.cc,
// //       bcc: input.bcc,
// //       subject: input.subject,
// //       body: input.body,
// //     });
// //     const result = await tenant.gmail.api.messages.send({ raw });
// //     logger.info("Email sent", { userId, messageId: result.id });
// //     return { messageId: result.id ?? "", threadId: result.threadId ?? null };
// //   } catch (err) {
// //     logger.error("sendEmail failed", { userId, error: String(err) });
// //     throw createExternalApiError("Email", err);
// //   }
// // }

// // // ─── Draft management ─────────────────────────────────────────────────────────

// // export async function createDraft(
// //   googleSub: string,
// //   userId: string,
// //   raw: string,
// // ): Promise<{ draftId: string }> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     const result = await tenant.gmail.api.drafts.create({ draft: { message: { raw } } });
// //     return { draftId: result.id ?? "" };
// //   } catch (err) {
// //     logger.error("createDraft failed", { userId, error: String(err) });
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // export async function updateDraft(
// //   googleSub: string,
// //   userId: string,
// //   gmailDraftId: string,
// //   raw: string,
// // ): Promise<void> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     await tenant.gmail.api.drafts.update({ id: gmailDraftId, draft: { message: { raw } } });
// //   } catch (err) {
// //     logger.error("updateDraft failed", { userId, error: String(err) });
// //     throw createExternalApiError("Gmail", err);
// //   }
// // }

// // export async function deleteDraft(
// //   googleSub: string,
// //   userId: string,
// //   gmailDraftId: string,
// // ): Promise<void> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     await tenant.gmail.api.drafts.delete({ id: gmailDraftId });
// //   } catch (err) {
// //     logger.warn("deleteDraft failed — non-fatal", { userId, error: String(err) });
// //   }
// // }

// // // ─── handleNewEmail (called from webhook handler) ─────────────────────────────

// // /**
// //  * Process a newly arrived email from a Gmail webhook.
// //  * 1. Fetch the message from Gmail API
// //  * 2. Persist to DB + Corsair cache
// //  * 3. Queue enrichment
// //  * 4. SSE push to the user's UI — only this specific email, no full refetch
// //  */
// // export async function handleNewEmail(
// //   googleSub: string,
// //   userId: string,
// //   gmailId: string,
// // ): Promise<void> {
// //   try {
// //     const tenant = getTenant(googleSub);
// //     const [msg] = await fetchBatch(tenant, [gmailId], "metadata");
// //     if (!msg) {
// //       logger.warn("handleNewEmail: message not found", { gmailId });
// //       return;
// //     }

// //     if (!isInboxMessage(msg.labelIds ?? [])) {
// //       logger.debug("handleNewEmail: skipping non-inbox message", { gmailId });
// //       return;
// //     }

// //     const parsed = parseGmailMessage(msg);
// //     await upsertOne(userId, parsed);
// //     populateCorsairCache(tenant, [msg]);

// //     // Queue enrichment
// //     await queueUnclassified(userId, googleSub, [parsed]);

// //     // Push surgical SSE update — only the new item, no full refetch
// //     const item = rawToListItem(msg);
// //     emitToUser(getTenantId(googleSub), {
// //       type: "new_email",
// //       data: { email: item },
// //     });

// //     logger.info("handleNewEmail: processed and emitted", { gmailId });
// //   } catch (err) {
// //     logger.error("handleNewEmail failed", { googleSub, gmailId, error: String(err) });
// //   }
// // }

// /**
//  * email.service.ts — single source of truth for Gmail operations.
//  *
//  * Flow:
//  *  Login → /inbox loads → listEmail()
//  *    - Cache hit (Corsair local DB): map rows → merge DB priority → return.
//  *      Queue enrichment for any gmailIds not yet enriched.
//  *    - Cache cold: hit Gmail API → persist to our DB + Corsair cache →
//  *      queue enrichment → return.
//  *
//  *  Background: enrichEmail() (priority.service) classifies priority +
//  *  generates embedding → updates DB → emits "email_enriched" SSE (one row).
//  *
//  *  New mail: Gmail webhook → handleNewEmail() → fetch single message →
//  *  persist to DB + Corsair cache → queue enrichment → emit "new_email" SSE
//  *  (one row, no full refetch).
//  */

// import { and, eq, inArray, sql } from "drizzle-orm";
// import { db } from "../db";
// import { emails } from "../db/schema/emails";
// import { getTenant, getTenantId } from "../lib/corsair";
// import { buildRawMimeMessage, parseGmailMessage, type GmailMessage } from "../lib/gmail-parser";
// // import { buildRawMimeMessage , parseGmailMessage } from "../lib/gmail-parser";
// import { logger } from "@/src/lib/logger";
// import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
// import { queueEmailEnrichment } from "@/src/jobs/priority-queue";
// import { emitToUser } from "../lib/sse";
// import type { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
// import type { ListEmailsInput, SendEmailInput } from "@/src/schema";

// // ─── Constants ──────────────────────────────────────────────────────────────

// /** Labels that must never appear in the inbox view. */
// const INBOX_EXCLUDE = new Set(["DRAFT", "SENT", "TRASH", "SPAM"]);

// const DEFAULT_PAGE_SIZE = 50;

// // ─── Helpers ────────────────────────────────────────────────────────────────

// function isInboxMessage(labelIds: string[]): boolean {
//   return !labelIds.some((l) => INBOX_EXCLUDE.has(l));
// }

// /** Pull stored priority values for a batch of gmailIds. */
// async function getPriorityMap(
//   userId: string,
//   gmailIds: string[],
// ): Promise<Map<string, EmailPriority>> {
//   const map = new Map<string, EmailPriority>();
//   if (!gmailIds.length) return map;

//   try {
//     const rows = await db
//       .select({ gmailId: emails.gmailId, priority: emails.priority })
//       .from(emails)
//       .where(and(eq(emails.userId, userId), inArray(emails.gmailId, gmailIds)));

//     for (const row of rows) map.set(row.gmailId, row.priority as EmailPriority);
//   } catch (err) {
//     logger.warn("getPriorityMap failed", { userId, error: String(err) });
//   }

//   return map;
// }

// /**
//  * gmailIds that have already been enriched.
//  * `embedding IS NOT NULL` is the completion signal — enrichEmail sets both
//  * priority and embedding together, so either both are done or neither is.
//  */
// async function getEnrichedIds(userId: string, gmailIds: string[]): Promise<Set<string>> {
//   if (!gmailIds.length) return new Set();

//   const rows = await db
//     .select({ gmailId: emails.gmailId })
//     .from(emails)
//     .where(
//       and(
//         eq(emails.userId, userId),
//         inArray(emails.gmailId, gmailIds),
//         sql`${emails.embedding} IS NOT NULL`,
//       ),
//     );

//   return new Set(rows.map((r) => r.gmailId));
// }

// /** Queue enrichment only for emails not yet enriched. */
// async function queueUnenriched(
//   userId: string,
//   googleSub: string,
//   items: Array<{ gmailId: string; subject: string | null; snippet: string | null; body: string | null }>,
// ): Promise<void> {
//   if (!items.length) return;

//   const ids = items.map((e) => e.gmailId).filter(Boolean);
//   const enriched = await getEnrichedIds(userId, ids);

//   for (const item of items) {
//     if (!item.gmailId) continue;
//     if (enriched.has(item.gmailId)) continue;
//     if (!item.subject && !item.snippet) continue;

//     void queueEmailEnrichment({
//       userId,
//       googleSub,
//       gmailId: item.gmailId,
//       subject: item.subject ?? "",
//       snippet: item.snippet ?? "",
//       body: item.body ?? "",
//     });
//   }

  
// }

// function applyPriorityMap(items: EmailListItem[], map: Map<string, EmailPriority>): EmailListItem[] {
//   return items.map((item) => ({ ...item, priority: map.get(item.gmailId) ?? item.priority }));
// }

// function filterByPriority(items: EmailListItem[], priority: ListEmailsInput["priority"]): EmailListItem[] {
//   if (!priority || priority === "all") return items;
//   return items.filter((i) => i.priority === priority);
// }

// function getHeader(msg: GmailMessage, name: string): string | null {
//   return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
// }

// function rawToListItem(msg: GmailMessage): EmailListItem {
//   let receivedAt: Date | null = null;
//   if (msg.internalDate != null) {
//     const ts =
//       typeof msg.internalDate === "number" ? msg.internalDate : parseInt(String(msg.internalDate), 10);
//     if (!isNaN(ts)) receivedAt = new Date(ts);
//   }

//   return {
//     id: msg.id ?? "",
//     gmailId: msg.id ?? "",
//     threadId: msg.threadId ?? null,
//     fromAddr: getHeader(msg, "From"),
//     subject: getHeader(msg, "Subject"),
//     snippet: msg.snippet ?? null,
//     isRead: !(msg.labelIds ?? []).includes("UNREAD"),
//     labels: msg.labelIds ?? [],
//     priority: "normal",
//     receivedAt,
//   };
// }

// /** Fetch full Gmail messages in parallel batches of 5. */
// async function fetchBatch(
//   tenant: ReturnType<typeof getTenant>,
//   ids: string[],
//   format: "metadata" | "full" = "metadata",
// ): Promise<GmailMessage[]> {
//   const BATCH = 5;
//   const results: GmailMessage[] = [];
//   for (let i = 0; i < ids.length; i += BATCH) {
//     const slice = ids.slice(i, i + BATCH);
//     const fetched = await Promise.all(slice.map((id) => tenant.gmail.api.messages.get({ id, format })));
//     results.push(...fetched);
//   }
//   return results;
// }

// // ─── DB persistence ─────────────────────────────────────────────────────────

// async function upsertOne(userId: string, parsed: ReturnType<typeof parseGmailMessage>): Promise<void> {
//   if (!parsed.gmailId) return;

//   try {
//     await db
//       .insert(emails)
//       .values({
//         userId,
//         gmailId: parsed.gmailId,
//         threadId: parsed.threadId,
//         fromAddr: parsed.fromAddr,
//         toAddrs: parsed.toAddrs,
//         ccAddrs: parsed.ccAddrs,
//         subject: parsed.subject,
//         snippet: parsed.snippet,
//         body: parsed.body,
//         isRead: parsed.isRead,
//         labels: parsed.labels,
//         attachments: parsed.attachments,
//         receivedAt: parsed.receivedAt,
//       })
//       .onConflictDoUpdate({
//         target: [emails.userId, emails.gmailId],
//         set: {
//           snippet: parsed.snippet,
//           isRead: parsed.isRead,
//           labels: parsed.labels,
//           body: parsed.body ?? sql`${emails.body}`,
//           updatedAt: new Date(),
//           // Never downgrade an already-classified priority back to "normal"
//           priority: sql`CASE WHEN ${emails.priority} != 'normal' THEN ${emails.priority} ELSE excluded.priority END`,
//           // Never overwrite an existing embedding
//           embedding: sql`COALESCE(${emails.embedding}, excluded.embedding)`,
//         },
//       });
//   } catch (err) {
//     logger.warn("upsertOne failed", { gmailId: parsed.gmailId, error: String(err) });
//   }
// }

// async function upsertBatch(userId: string, msgs: GmailMessage[]): Promise<void> {
//   await Promise.allSettled(
//     msgs.map(async (msg) => {
//       try {
//         await upsertOne(userId, parseGmailMessage(msg));
//       } catch (err) {
//         logger.warn("upsertBatch item failed", { gmailId: msg.id, error: String(err) });
//       }
//     }),
//   );
// }

// /** Populate Corsair's local cache (best-effort, fire-and-forget). */
// function populateCorsairCache(tenant: ReturnType<typeof getTenant>, msgs: GmailMessage[]): void {
//   for (const msg of msgs) {
//     if (!msg.id) continue;
//     void tenant.gmail.db.messages
//       .upsertByEntityId(msg.id, {
//         id: msg.id,
//         threadId: msg.threadId ?? undefined,
//         snippet: msg.snippet ?? undefined,
//         internalDate: msg.internalDate != null ? String(msg.internalDate) : undefined,
//         labelIds: msg.labelIds ?? [],
//         subject: getHeader(msg, "Subject") ?? undefined,
//         from: getHeader(msg, "From") ?? undefined,
//         to: getHeader(msg, "To") ?? undefined,
//       })
//       .catch((err: unknown) =>
//         logger.warn("Corsair cache upsert failed", { gmailId: msg.id, error: String(err) }),
//       );
//   }
// }

// // ─── listEmail ──────────────────────────────────────────────────────────────

// export async function listEmail(
//   googleSub: string,
//   userId: string,
//   opts: ListEmailsInput,
// ): Promise<PaginatedResponse<EmailListItem>> {
//   try {
//     const tenant = getTenant(googleSub);
//     const fetchLimit = opts.limit ?? DEFAULT_PAGE_SIZE;

//     // ── Search path (Gmail q=) ────────────────────────────────────────────
//     if (opts.q) {
//       const result = await tenant.gmail.api.messages.list({
//         q: opts.q,
//         maxResults: fetchLimit,
//         pageToken: opts.pageToken,
//         labelIds: opts.labelIds,
//       });

//       const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
//       const fullMsgs = await fetchBatch(tenant, ids);
//       const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

//       await upsertBatch(userId, inbox);
//       populateCorsairCache(tenant, inbox);

//       const items = inbox.map(rawToListItem);
//       const priorityMap = await getPriorityMap(userId, items.map((i) => i.gmailId));
//       const withPriority = applyPriorityMap(items, priorityMap);

//       await queueUnenriched(userId, googleSub, inbox.map((m) => parseGmailMessage(m)));

//       return {
//         items: filterByPriority(withPriority, opts.priority),
//         nextPageToken: result.nextPageToken,
//         total: result.resultSizeEstimate,
//       };
//     }

//     // ── Cache path ──────────────────────────────────────────────────────────
//     const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

//     const cached = await tenant.gmail.db.messages.search({
//       data: {},
//       limit: fetchLimit,
//       offset,
//     });

//     // const cached :any[] =[]
//     const inboxCached = cached.filter((row) => isInboxMessage((row.data.labelIds as string[]) ?? []));

//     // Cold cache → hit Gmail API
//     if (!inboxCached.length && offset === 0) {
//       return fetchFromGmailApi(tenant, googleSub, userId, opts, fetchLimit);
//     }

//     const items: EmailListItem[] = inboxCached.map((row) => {
//       const data = row.data as Record<string, unknown>;
//       const internalDate = data.internalDate as string | undefined;
//       return {
//         id: row.id,
//         gmailId: (data.id as string) ?? row.entity_id,
//         threadId: (data.threadId as string) ?? null,
//         fromAddr: (data.from as string) ?? null,
//         subject: (data.subject as string) ?? null,
//         snippet: (data.snippet as string) ?? null,
//         isRead: !((data.labelIds as string[]) ?? []).includes("UNREAD"),
//         labels: (data.labelIds as string[]) ?? [],
//         priority: "normal",
//         receivedAt: internalDate ? new Date(parseInt(internalDate, 10)) : null,
//       };
//     });

//     const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
//     const priorityMap = await getPriorityMap(userId, gmailIds);
//     const withPriority = applyPriorityMap(items, priorityMap);

//     // Queue enrichment for any cached rows we haven't classified yet.
//     // await queueUnenriched(
//     //   userId,
//     //   googleSub,
//     //   inboxCached.map((row) => {
//     //     const d = row.data as Record<string, unknown>;
//     //     return {
//     //       gmailId: (d.id as string) ?? row.entity_id,
//     //       subject: (d.subject as string) ?? null,
//     //       snippet: (d.snippet as string) ?? null,
//     //       body: null, // cache doesn't store body; enrichment falls back to subject+snippet
//     //     };
//     //   }),
//     // );

//     return {
//       items: filterByPriority(withPriority, opts.priority),
//       nextPageToken: inboxCached.length === fetchLimit ? String(offset + fetchLimit) : undefined,
//     };
//   } catch (err) {
//     logger.error("listEmail failed", { userId, error: String(err) });
//     throw createExternalApiError("Gmail", err);
//   }
// }

// /** Cache-miss path: fetch from Gmail API, persist, queue enrichment. */
// async function fetchFromGmailApi(
//   tenant: ReturnType<typeof getTenant>,
//   googleSub: string,
//   userId: string,
//   opts: ListEmailsInput,
//   fetchLimit: number,
// ): Promise<PaginatedResponse<EmailListItem>> {
//   const labelIds = opts.labelIds?.length ? opts.labelIds : ["INBOX"];

//   const result = await tenant.gmail.api.messages.list({
//     maxResults: fetchLimit,
//     pageToken: opts.pageToken,
//     labelIds,
//   });

//   logger.info("listEmail: cache miss — fetching from Gmail API", { userId });

//   const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
//   const fullMsgs = await fetchBatch(tenant, ids);
//   const inbox = fullMsgs.filter((m) => isInboxMessage(m.labelIds ?? []));

//   await upsertBatch(userId, inbox);
//   populateCorsairCache(tenant, inbox);

//   const items = inbox.map(rawToListItem);
//   const priorityMap = await getPriorityMap(userId, items.map((i) => i.gmailId));
//   const withPriority = applyPriorityMap(items, priorityMap);

//   await queueUnenriched(userId, googleSub, inbox.map((m) => parseGmailMessage(m)));

//   return {
//     items: filterByPriority(withPriority, opts.priority),
//     nextPageToken: result.nextPageToken,
//     total: result.resultSizeEstimate,
//   };
// }

// // ─── getEmail ───────────────────────────────────────────────────────────────

// export async function getEmail(userId: string, googleSub: string, gmailId: string): Promise<Email> {
//   try {
//     const tenant = getTenant(googleSub);

//     const msg = await tenant.gmail.api.messages.get({ id: gmailId, format: "full" });
//     if (!msg) throw createNotFoundError("Email");

//     const parsed = parseGmailMessage(msg);
//     await upsertOne(userId, parsed);

//     if (parsed.subject || parsed.snippet) {
//       await queueUnenriched(userId, googleSub, [
//         {
//           gmailId: parsed.gmailId,
//           subject: parsed.subject,
//           snippet: parsed.snippet,
//           body: parsed.body,
//         },
//       ]);
//     }

//     const priorityMap = await getPriorityMap(userId, [gmailId]);
//     const priority = priorityMap.get(gmailId) ?? "normal";

//     return {
//       id: gmailId,
//       userId,
//       gmailId,
//       threadId: parsed.threadId,
//       fromAddr: parsed.fromAddr,
//       toAddrs: parsed.toAddrs,
//       ccAddrs: parsed.ccAddrs,
//       subject: parsed.subject,
//       snippet: parsed.snippet,
//       body: parsed.body,
//       isRead: parsed.isRead,
//       labels: parsed.labels,
//       priority,
//       attachments: parsed.attachments,
//       receivedAt: parsed.receivedAt,
//     };
//   } catch (err) {
//     logger.error("getEmail failed", { userId, gmailId, error: String(err) });
//     if ((err as Error).message?.includes("not found")) throw err;
//     throw createExternalApiError("Gmail", err);
//   }
// }

// // ─── modifyEmail ────────────────────────────────────────────────────────────

// export async function modifyEmail(
//   googleSub: string,
//   userId: string,
//   gmailId: string,
//   opts: { isRead?: boolean; addLabels?: string[]; removeLabels?: string[] },
// ): Promise<void> {
//   try {
//     const tenant = getTenant(googleSub);
//     const addLabelIds = [...(opts.addLabels ?? [])];
//     const removeLabelIds = [...(opts.removeLabels ?? [])];

//     if (opts.isRead === true) removeLabelIds.push("UNREAD");
//     if (opts.isRead === false) addLabelIds.push("UNREAD");

//     if (addLabelIds.length || removeLabelIds.length) {
//       await tenant.gmail.api.messages.modify({ id: gmailId, addLabelIds, removeLabelIds });
//     }

//     await db
//       .update(emails)
//       .set({
//         isRead: opts.isRead !== undefined ? opts.isRead : sql`${emails.isRead}`,
//         updatedAt: new Date(),
//       })
//       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
//   } catch (err) {
//     logger.error("modifyEmail failed", { userId, gmailId, error: String(err) });
//     throw createExternalApiError("Gmail", err);
//   }
// }

// // ─── archiveEmail ───────────────────────────────────────────────────────────

// export async function archiveEmail(googleSub: string, userId: string, gmailId: string): Promise<void> {
//   try {
//     const tenant = getTenant(googleSub);
//     await tenant.gmail.api.messages.modify({ id: gmailId, removeLabelIds: ["INBOX"] });
//     await db
//       .update(emails)
//       .set({ updatedAt: new Date() })
//       .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
//   } catch (err) {
//     logger.error("archiveEmail failed", { userId, gmailId, error: String(err) });
//     throw createExternalApiError("Gmail", err);
//   }
// }

// // ─── sendEmail ──────────────────────────────────────────────────────────────

// export async function sendEmail(
//   googleSub: string,
//   userId: string,
//   input: SendEmailInput,
//   userEmail: string,
// ): Promise<{ messageId: string; threadId: string | null }> {
//   try {
//     const tenant = getTenant(googleSub);
//     const raw = buildRawMimeMessage({
//       from: userEmail,
//       to: input.to,
//       cc: input.cc,
//       bcc: input.bcc,
//       subject: input.subject,
//       body: input.body,
//     });
//     const result = await tenant.gmail.api.messages.send({ raw });
//     logger.info("Email sent", { userId, messageId: result.id });
//     return { messageId: result.id ?? "", threadId: result.threadId ?? null };
//   } catch (err) {
//     logger.error("sendEmail failed", { userId, error: String(err) });
//     throw createExternalApiError("Email", err);
//   }
// }

// // ─── Draft management ───────────────────────────────────────────────────────

// export async function createDraft(googleSub: string, userId: string, raw: string): Promise<{ draftId: string }> {
//   try {
//     const tenant = getTenant(googleSub);
//     const result = await tenant.gmail.api.drafts.create({ draft: { message: { raw } } });
//     return { draftId: result.id ?? "" };
//   } catch (err) {
//     logger.error("createDraft failed", { userId, error: String(err) });
//     throw createExternalApiError("Gmail", err);
//   }
// }

// export async function updateDraft(
//   googleSub: string,
//   userId: string,
//   gmailDraftId: string,
//   raw: string,
// ): Promise<void> {
//   try {
//     const tenant = getTenant(googleSub);
//     await tenant.gmail.api.drafts.update({ id: gmailDraftId, draft: { message: { raw } } });
//   } catch (err) {
//     logger.error("updateDraft failed", { userId, error: String(err) });
//     throw createExternalApiError("Gmail", err);
//   }
// }

// export async function deleteDraft(googleSub: string, userId: string, gmailDraftId: string): Promise<void> {
//   try {
//     const tenant = getTenant(googleSub);
//     await tenant.gmail.api.drafts.delete({ id: gmailDraftId });
//   } catch (err) {
//     logger.warn("deleteDraft failed — non-fatal", { userId, error: String(err) });
//   }
// }

// // ─── handleNewEmail (called from webhook handler) ──────────────────────────

// /**
//  * Process one new message reported by a Gmail webhook:
//  * 1. Fetch the message
//  * 2. Skip if not an inbox message (draft/sent/trash/spam)
//  * 3. Persist to DB + Corsair cache
//  * 4. Queue enrichment
//  * 5. SSE-push "new_email" with just that row — UI prepends it, no refetch
//  */
// export async function handleNewEmail(googleSub: string, userId: string, gmailId: string): Promise<void> {
//   try {
//     const tenant = getTenant(googleSub);
//     const [msg] = await fetchBatch(tenant, [gmailId], "metadata");
//     if (!msg) {
//       logger.warn("handleNewEmail: message not found", { gmailId });
//       return;
//     }

//     if (!isInboxMessage(msg.labelIds ?? [])) {
//       logger.debug("handleNewEmail: skipping non-inbox message", { gmailId });
//       return;
//     }

//     const parsed = parseGmailMessage(msg);
//     await upsertOne(userId, parsed);
//     populateCorsairCache(tenant, [msg]);

//     await queueUnenriched(userId, googleSub, [
//       { gmailId: parsed.gmailId, subject: parsed.subject, snippet: parsed.snippet, body: parsed.body },
//     ]);

//     const item = rawToListItem(msg);
//     emitToUser(getTenantId(googleSub), { type: "new_email", data: { email: item } });

//     logger.info("handleNewEmail: processed and emitted", { gmailId });
//   } catch (err) {
//     logger.error("handleNewEmail failed", { googleSub, gmailId, error: String(err) });
//   }
// }

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

import { and, eq, inArray, sql } from "drizzle-orm";
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

    // ── Cache path ──────────────────────────────────────────────────────────
    const offset = opts.pageToken ? parseInt(opts.pageToken, 10) : 0;

    const cached = await tenant.gmail.db.messages.search({
      data: {},
      limit: fetchLimit,
      offset,
    });

    // const cached :any[] = []

    const inboxCached = cached.filter((row) => isInboxMessage((row.data.labelIds as string[]) ?? []));

    // Cold cache → hit Gmail API
    if (!inboxCached.length && offset === 0) {
      return fetchFromGmailApi(tenant, googleSub, userId, opts, fetchLimit);
    }

    const items: EmailListItem[] = inboxCached.map((row) => {
      const data = row.data as Record<string, unknown>;
      const internalDate = data.internalDate as string | undefined;
      return {
        id: row.id,
        gmailId: (data.id as string) ?? row.entity_id,
        threadId: (data.threadId as string) ?? null,
        fromAddr: (data.from as string) ?? null,
        subject: (data.subject as string) ?? null,
        snippet: (data.snippet as string) ?? null,
        isRead: !((data.labelIds as string[]) ?? []).includes("UNREAD"),
        labels: (data.labelIds as string[]) ?? [],
        priority: "normal",
        receivedAt: internalDate ? new Date(parseInt(internalDate, 10)) : null,
      };
    });

    const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
    const priorityMap = await getPriorityMap(userId, gmailIds);
    const withPriority = applyPriorityMap(items, priorityMap);

    // Queue enrichment for any cached rows we haven't classified yet.
    // await queueUnenriched(
    //   userId,
    //   googleSub,
    //   inboxCached.map((row) => {
    //     const d = row.data as Record<string, unknown>;
    //     return {
    //       gmailId: (d.id as string) ?? row.entity_id,
    //       subject: (d.subject as string) ?? null,
    //       snippet: (d.snippet as string) ?? null,
    //       body: null, // cache doesn't store body; enrichment falls back to subject+snippet
    //     };
    //   }),
    // );

    return {
      items: filterByPriority(withPriority, opts.priority),
      nextPageToken: inboxCached.length === fetchLimit ? String(offset + fetchLimit) : undefined,
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

    console.log(gmailId,addLabelIds,removeLabelIds);

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
    await db
      .update(emails)
      .set({ updatedAt: new Date() })
      .where(and(eq(emails.userId, userId), eq(emails.gmailId, gmailId)));
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