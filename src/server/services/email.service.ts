import {  ListEmailsInput, SendEmailInput } from "@/src/schema";
import { Email, EmailListItem, EmailPriority, PaginatedResponse } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { buildRawMimeMessage, parseGmailMessage } from "../lib/gmail-parser";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { queueEmailEmbedding } from "@/src/jobs/priority-queue";
import { and, eq, sql, inArray } from "drizzle-orm";

/**
 * Bulk-fetch stored priority values for a set of gmailIds from our own
 * `emails` table (populated by the LLM enrichment pipeline — see
 * priority.service.ts / enrichEmail). Falls back to "normal" for any
 * gmailId not yet enriched.
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

async function getExistingPriorities(
  userId: string,
  gmailIds: string[],
): Promise<Set<string>> {
  const rows = await db
    .select({
      gmailId: emails.gmailId,
      priority: emails.priority,
    })
    .from(emails)
    .where(
      and(
        eq(emails.userId, userId),
        inArray(emails.gmailId, gmailIds),
      ),
    );

  return new Set(
    rows
      .filter((r) => r.priority !== "normal")
      .map((r) => r.gmailId),
  );
}

/**
 * Apply the requested priority filter to a list of EmailListItem.
 * "all" (default) is a no-op passthrough.
 */
function applyPriorityFilter(
    items: EmailListItem[],
    priority: ListEmailsInput["priority"],
): EmailListItem[] {
    if (!priority || priority === "all") return items;
    return items.filter((item) => item.priority === priority);
}

export async function listEmail(
    tenantId : string,
    userId : string,
    opts : ListEmailsInput
):Promise <PaginatedResponse<EmailListItem>>{
    try {
        // Prefer Corsair's local DB cache for speed — no API call
        // Falls back to Gmail API if cache is cold

        const tenant = getTenant(tenantId);

        // NOTE: priority filtering happens client-side AFTER fetching a page,
        // since Gmail/Corsair don't know about our LLM-assigned priority.
        // When a priority filter is active, fetch a wider page so the
        // filtered result isn't empty just because this page had no matches.
        const fetchLimit = opts.priority && opts.priority !== "all"
            ? Math.min(opts.limit * 3, 100)
            : opts.limit;

        let corsairMessage : Array<{
            data : {
                id ?: string;
                threadId ?: string;
                snippet ?: string;
                labelIds ?: string[];
                internalDate ?: string;
                payload ?: {header ?: Array<{name ?: string ; value?: string}>};
            };
        }> = [];


        if(opts.q){
            // Use Gmail API for text search (Corsair routes to Gmail)
            const result = await tenant.gmail.api.messages.list({
                q: opts.q,
                maxResults : fetchLimit,
                pageToken : opts.pageToken,
                labelIds : opts.labelIds
            })

            // Fetch full messages in parallel (max 5 concurrent)
            const ids = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
            const batchSize = 5;
            const fullMessage = [];

            for(let i =0;i<ids.length ; i+= batchSize){
                const batch = ids.slice(i,i + batchSize);
                const fetched = await Promise.all(
                    batch.map((id) =>
                        tenant.gmail.api.messages.get({id, format : "metadata"})
                    )
                )
                fullMessage.push(...fetched)
            };

            // Upsert in background
            await upsertEmailsBatch(userId, fullMessage);

for (const msg of fullMessage) {
  const parsed = parseGmailMessage(msg);

  if (parsed.gmailId && (parsed.subject || parsed.snippet)) {
    void queueEmailEmbedding({
      userId,
      gmailId: parsed.gmailId,
      subject: parsed.subject ?? "",
      snippet: parsed.snippet ?? "",
      body: parsed.body ?? "",
    });
  }
}

            const items = fullMessage.map(mapToListItem);
            const gmailIds = items.map((i) => i.gmailId).filter(Boolean);
            const priorityMap = await getPriorityMap(userId, gmailIds);
            const withPriority = items.map((item) => ({
                ...item,
                priority: priorityMap.get(item.gmailId) ?? item.priority,
            }));

            return {
                items : applyPriorityFilter(withPriority, opts.priority),
                nextPageToken : result.nextPageToken,
                total : result.resultSizeEstimate
            }
        }

        const cached = await tenant.gmail.db.messages.search({
            data : opts.labelIds?.length ? {} : {},
            limit : fetchLimit,
            offset : opts.pageToken ? parseInt(opts.pageToken,10) : 0
        })

        // const cached: any[] = [];

        // logger.info("CACHE RESULT", {
        //     count: cached.length,
        //     pageToken: opts.pageToken,
        //     limit: opts.limit,
        // });

        // if (cached.length > 0) {
        //     logger.info("SEEDING DB FROM CACHE");

        //     for (const row of cached) {
        //         logger.info("CACHE EMAIL", {
        //             gmailId: row.entity_id,
        //             subject: row.data.subject,
        //         });
        //     }
        // }

        // Corsair's local cache is populated by webhooks, which require
        // Gmail push notifications (Pub/Sub) to be configured. Until then
        // (or on first load), the cache is empty — fall back to a live
        // Gmail API call so the inbox isn't empty.
        if (cached.length === 0 && !(opts.pageToken && parseInt(opts.pageToken, 10) > 0)) {
            const result = await tenant.gmail.api.messages.list({
                maxResults: fetchLimit,
                pageToken: opts.pageToken,
                labelIds: opts.labelIds,
            });

            logger.info("FETCHING FROM GMAIL API");

            const itemsIds = (result.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
            const batchSize = 5;
            const fullMessage = [];

            for (let i = 0; i < itemsIds.length; i += batchSize) {
                const batch = itemsIds.slice(i, i + batchSize);
                const fetched = await Promise.all(
                    batch.map((id) =>
                        tenant.gmail.api.messages.get({ id, format: "metadata" })
                    )
                );
                fullMessage.push(...fetched);
            }

            // Cache into Corsair's local DB + our own emails table for next time.
            // gmail.db.messages stores flattened fields (subject, from, to,
            // body, snippet, internalDate, threadId, labelIds) — not raw
            // payload — so flatten headers before upserting.
            logger.info("ABOUT TO SAVE EMAILS", {
                count: fullMessage.length,
            });
            logger.info("STARTING UPSERT");

await upsertEmailsBatch(userId, fullMessage);

logger.info("Emails saved to DB");

// Queue enrichment for all newly fetched emails
for (const msg of fullMessage) {
  const parsed = parseGmailMessage(msg);

  if (parsed.gmailId && (parsed.subject || parsed.snippet)) {
    void queueEmailEmbedding({
      userId,
      gmailId: parsed.gmailId,
      subject: parsed.subject ?? "",
      snippet: parsed.snippet ?? "",
      body: parsed.body ?? "",
    });
  }
}

            for (const msg of fullMessage) {
                if (msg.id) {
                    const headers = msg.payload?.headers ?? [];
                    const getHeader = (name: string) =>
                        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

                    void tenant.gmail.db.messages
                        .upsertByEntityId({
                            entityId: msg.id,
                            version: "1",
                            data: {
                                id: msg.id,
                                threadId: msg.threadId ?? null,
                                snippet: msg.snippet ?? null,
                                historyId: msg.historyId ?? null,
                                internalDate: msg.internalDate ?? null,
                                labelIds: msg.labelIds ?? [],
                                subject: getHeader("Subject"),
                                from: getHeader("From"),
                                to: getHeader("To"),
                                body: null,
                            },
                        })
                        .catch((err: unknown) =>
                            logger.warn("Failed to cache message in corsair db", {
                                userId,
                                error: String(err),
                            })
                        );
                }
            }

            const items = fullMessage.map(mapToListItem);
            const ids = items.map((i) => i.gmailId).filter(Boolean);
            const priorityMap = await getPriorityMap(userId, ids);
            const withPriority = items.map((item) => ({
                ...item,
                priority: priorityMap.get(item.gmailId) ?? item.priority,
            }));

            return {
                items: applyPriorityFilter(withPriority, opts.priority),
                nextPageToken: result.nextPageToken,
                total: result.resultSizeEstimate,
            };
        }

        // logger.info("RETURNING CACHED EMAILS", {
        //     count: cached.length,
        // });

        const mapped : EmailListItem[] = cached.map((row) =>({
                id : row.id,
                gmailId : row.entity_id,
                threadId : row.data.threadId ?? null,
                fromAddr: row.data.from ?? null,
                subject: row.data.subject ?? null,
                snippet: row.data.snippet ?? null,
                isRead: !(row.data.labelIds ?? []).includes("UNREAD"),
                labels: row.data.labelIds ?? [],
                priority: "normal" as const, // overwritten below from our emails table
                receivedAt: row.data.internalDate
                ? new Date(parseInt(row.data.internalDate, 10))
                : null,
            }));

        const cachedIds = mapped.map((m) => m.gmailId).filter(Boolean);
        const priorityMap = await getPriorityMap(userId, cachedIds);
        const withPriority = mapped.map((item) => ({
            ...item,
            priority: priorityMap.get(item.gmailId) ?? item.priority,
        }));

        return {
            items : applyPriorityFilter(withPriority, opts.priority),
            nextPageToken:
            cached.length === fetchLimit ? 
            String((opts.pageToken ? parseInt(opts.pageToken,10) : 0) + fetchLimit) : undefined,
        };
    } catch (error) {
        logger.error("ListEmail failed" , {userId, error : String(error)});
        throw createExternalApiError("Gmail" , error)
    }
}


// get single email
export async function getEmail(
    userId : string,
    gmailTenantId : string,
    gmailId : string
): Promise<Email>{
    try{
        const tenant = getTenant(gmailTenantId);

        // fetch full message from Gmail via corsair
        const msg = await tenant.gmail.api.messages.get({
            id : gmailId,
            format :"full",
        })

        console.log("msg" ,msg);

        if(!msg) throw createNotFoundError("Email");

        const parsed = parseGmailMessage(msg);

        console.log("parsed",parsed);

        // Upsert into our Db cache
        await upsertEmail(userId,parsed);

        // Queue priority classification + embedding async (fire and forget)
        // if(parsed.subject || parsed.snippet){
        //     void queueEmailEmbedding({
        //         userId,
        //         gmailId,
        //         subject : parsed.subject ?? "",
        //         snippet : parsed.snippet ?? "",
        //         body : parsed.body ?? "",
        //     });
        // }

        return {
            id : gmailId,
            userId,
            gmailId,
            threadId : parsed.threadId,
            fromAddr : parsed.fromAddr,
            toAddrs : parsed.toAddrs,
            ccAddrs : parsed.ccAddrs,
            subject : parsed.subject,
            snippet : parsed.snippet,
            body: parsed.body,
            isRead : parsed.isRead,
            labels : parsed.labels,
            priority : "normal",
            attachments : parsed.attachments,
            receivedAt : parsed.receivedAt
        }
    }catch(err){
        
        console.error("FULL ERROR");
        console.dir(err, { depth: null });

        if((err as Error).message?.includes("not found")) {
            throw err;
        }

        logger.error("getEmail Failed" , {
            userId,
            gmailId,
            error : String(err)
        });

        throw createExternalApiError("Gmail",err)
        }    
}

export async function modifyEmail(
    tenantId : string,   // googleSub — for Corsair
    userId : string,     // DB UUID — for DB writes
    gmailId : string,
    opts : {isRead ?: boolean; addLabels ?: string[],removeLabels ?: string[]},
):Promise<void> {
    try {
        const tenant = getTenant(tenantId);

        const addLabelIds : string[] = [...(opts.addLabels ?? [])];
        const removeLabelIds :string[] = [...(opts.removeLabels ?? [])];

        // Map isRead to Gmail label operation
        if(opts.isRead === true) removeLabelIds.push("UNREAD");
        if(opts.isRead === false) addLabelIds.push("UNREAD");

        if(addLabelIds.length > 0 || removeLabelIds.length > 0){
            await tenant.gmail.api.messages.modify({
                id : gmailId,
                addLabelIds,
                removeLabelIds
            })
        }

        await db.update(emails)
        .set({
            isRead : opts.isRead !== undefined
            ? opts.isRead
            : sql`${emails.isRead}`,
            updatedAt : new Date(),
        }).where(and(eq(emails.userId,userId), eq(emails.gmailId,gmailId)));
    } catch (error) {
        
        logger.error("ModifyEmail failed" ,{userId,gmailId,error:String(error)});
        throw createExternalApiError("Gmail",error)
    }
}

//Archive (remove from INBOX) 

export async function archiveEmail(tenantId : string,userId:string,gmailId : string):Promise<void>{
    try{
        const tenant = getTenant(tenantId);

        await tenant.gmail.api.messages.modify({
            id : gmailId,
            removeLabelIds : ["INBOX"],
        });

        await db
        .update(emails)
        .set({updatedAt : new Date()})
        .where(and(eq(emails.userId,userId),eq(emails.gmailId,gmailId)));
    }catch(err){
        logger.error("archiveEmail failed",{userId,gmailId,error : String(err)});
        throw createExternalApiError("Gmail",err);
    }
}

// Send email 

export async function sendEmail(
    TenantId : string,
    userId : string,
    input : SendEmailInput,
    userEmail : string
):Promise<{messageId : string;threadId : string | null }>{
    try {
        const tenant = getTenant(TenantId);

        const raw = buildRawMimeMessage({
            from : userEmail,
            to : input.to,
            cc : input.cc,
            bcc : input.bcc,
            subject : input.subject,
            body : input.body,
        });

        // Use Corsair Gmail API to send — handles auth automatically
        const result = await tenant.gmail.api.messages.send({raw});

        logger.info("Email send",{userId,messageId : result.id});

        return {
            messageId : result.id ?? "",
            threadId : result.threadId ?? null,
        };
    }catch(err){
        logger.error("sendEmail failed",{userId,error : String(err)});
        throw createExternalApiError("Email" , err)
    }
}


// Draft management 

export async function createDraft(
    TenantId : string,
    userId : string,
    raw : string,
):Promise<{draftId : string }>{
    try{
        const tenant = getTenant(TenantId);

        const result = await tenant.gmail.api.drafts.create({
            draft : {message : {raw}}
        });

        return {draftId : result.id ?? ""};
    }catch(err){
        logger.error("createDraft failed" , {userId,error : String(err)});
        throw createExternalApiError("Gmail",err);
    }
} 


export async function updateDraft(
    tenantId : string,
    userId : string,
    gamilDraftId : string,
    raw : string
): Promise<void>{
    try{
        const tenant = getTenant(tenantId);

        await tenant.gmail.api.drafts.update({
            id : gamilDraftId,
            draft : {message: {raw}},
        });


    }catch(err){
        logger.error("updateDraft failed",{userId,error : String(err)});
        throw createExternalApiError("Gmail",err);
    }
}

export async function deleteDraft(
    tenantId : string,
    userId : string,
    gmailDraftId : string
):Promise<void>{
    try{
        const tenant = getTenant(tenantId);
        await tenant.gmail.api.drafts.delete({id : gmailDraftId});

    }catch(err){
        logger.error("deleteDraft failed ",{userId,error : String(err)})
        // throw 
    }
}

// DB helpers 


interface RawGmailMsg{
    id?: string;
    threadId?: string;
    snippet?: string;
    labelIds?: string[];
    internalDate?: string | number | null;
    payload?: {
        headers?: Array<{ name?: string; value?: string }>;
    };
}

async function upsertEmail(userId: string, parsed: ReturnType<typeof parseGmailMessage>) {
  if (!parsed.gmailId) return;
logger.info("UPSERTING EMAIL", {
    gmailId: parsed.gmailId,
    subject: parsed.subject,
  });

  console.log({
  gmailId: parsed.gmailId,
  threadId: parsed.threadId,
  fromAddr: parsed.fromAddr,
  toAddrs: parsed.toAddrs,
  ccAddrs: parsed.ccAddrs,
  subject: parsed.subject,
  snippet: parsed.snippet,
  labels: parsed.labels,
  attachments: parsed.attachments,
  receivedAt: parsed.receivedAt,
});

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
        body: parsed.body,
        updatedAt: new Date(),
      },
    });
}

async function upsertEmailsBatch(userId: string, messages: RawGmailMsg[]) {
      logger.info("UPSERT BATCH CALLED", {
            count: messages.length,
        });
  for (const msg of messages) {
    try {
      const parsed = parseGmailMessage(msg);
      await upsertEmail(userId, parsed);
    } catch (err) {
        console.error("UPSERT FAILED");
        console.dir(err, { depth: null });
    }
  }
}

function mapToListItem(msg : RawGmailMsg): EmailListItem {
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