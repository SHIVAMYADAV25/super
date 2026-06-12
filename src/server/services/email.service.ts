import {  ListEmailsInput, SendEmailInput } from "@/src/schema";
import { Email, EmailListItem, PaginatedResponse } from "@/src/types";
import { getTenant } from "../lib/corsair";
import { db } from "../db";
import { emails } from "../db/schema/emails";
import { buildRawMimeMessage, parseGmailMessage } from "../lib/gmail-parser";
import { logger } from "@/src/lib/logger";
import { createExternalApiError, createNotFoundError } from "@/src/lib/errors";
import { queueEmailEmbedding } from "@/src/jobs/priority-queue";
import { and, eq, sql } from "drizzle-orm";

export async function listEmail(
    userId : string,
    opts : ListEmailsInput
):Promise <PaginatedResponse<EmailListItem>>{
    try {
        // Prefer Corsair's local DB cache for speed — no API call
        // Falls back to Gmail API if cache is cold

        const tenant = getTenant(userId);

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
                maxResults : opts.limit,
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
            void upsertEmailsBatch(userId,fullMessage);

            return {
                items : fullMessage.map(mapToListItem),
                nextPageToken : result.nextPageToken,
                total : result.resultSizeEstimate
            }
        }

        const cached = await tenant.gmail.db.messages.search({
            data : opts.labelIds?.length ? {} : {},
            limit : opts.limit,
            offset : opts.pageToken ? parseInt(opts.pageToken,10) : 0
        })

        return {
            items : cached.map((row) =>({
                id : row.id,
                gmailId : row.entity_id,
                threadId : row.data.threadId ?? null,
                fromAddr: row.data.from ?? null,
                subject: row.data.subject ?? null,
                snippet: row.data.snippet ?? null,
                isRead: !(row.data.labelIds ?? []).includes("UNREAD"),
                labels: row.data.labelIds ?? [],
                priority: "normal" as const, // populated async by priority service
                receivedAt: row.data.internalDate
                ? new Date(parseInt(row.data.internalDate, 10))
                : null,
            })),
            nextPageToken:
            cached.length === opts.limit ? 
            String((opts.pageToken ? parseInt(opts.pageToken,10) : 0) + opts.limit) : undefined,
        };
    } catch (error) {
        logger.error("ListEmail failed" , {userId, error : String(error)});
        throw createExternalApiError("Gmail" , error)
    }
}


// get single email
export async function getEmail(
    userId : string,
    gmailId : string
): Promise<Email>{
    try{
        const tenant = getTenant(userId);

        // fetch full message from Gmail via corsair
        const msg = await tenant.gmail.api.messages.get({
            id : gmailId,
            format :"full",
        })

        if(!msg) throw createNotFoundError("Email");

        const parsed = parseGmailMessage(msg);

        // Upsert into our Db cache
        await upsertEmail(userId,parsed);

        // Queue priority classification async (fire and forget)
        if(parsed.subject || parsed.snippet){
            void queueEmailEmbedding({
                userId,
                gmailId,
                subject : parsed.subject ?? "",
                snippet : parsed.snippet ?? "",
                body : parsed.body ?? "",
            });
        }

        return {
            id : gmailId,
            userId,
            gmailId,
            threadId : parsed.threadId,
            formAddr : parsed.fromAddr,
            toAddrs : parsed.toAddrs,
            ccAddrs : parsed.ccAddrs,
            subject : parsed.subject,
            snippet : parsed.snippet,
            body: parsed.body,
            isRead : parsed.isRead,
            labels : parsed.labels,
            priority : "normal",
            attachement : parsed.attachments,
            receivedAt : parsed.receivedAt
        }
    }catch(err){
        if((err as Error).message?.includes("not found")) throw err;
        logger.error("getEmail Failed" , {userId,gmailId, error : String(err)});
        throw createExternalApiError("Gmail",err)
    }    
}

export async function modifyEmail(
    userId : string,
    gmailId : string,
    opts : {isRead ?: boolean; addLabels ?: string[],removeLabels ?: string[]},
):Promise<void> {
    try {
        const tenant = getTenant(userId);

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

export async function archiveEmail(userId : string,gmailId : string):Promise<void>{
    try{
        const tenant = getTenant(userId);

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
    userId : string,
    input : SendEmailInput,
    userEmail : string
):Promise<{messageId : string;threadId : string | null }>{
    try {
        const tenant = getTenant(userId);

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
    userId : string,
    raw : string,
):Promise<{draftId : string }>{
    try{
        const tenant = getTenant(userId);

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
    userId : string,
    gamilDraftId : string,
    raw : string
): Promise<void>{
    try{
        const tenant = getTenant(userId);

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
    userId : string,
    gmailDraftId : string
):Promise<void>{
    try{
        const tenant = getTenant(userId);
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
  for (const msg of messages) {
    try {
      const parsed = parseGmailMessage(msg);
      await upsertEmail(userId, parsed);
    } catch (err) {
      logger.warn("Failed to upsert email", { gmailId: msg.id, error: String(err) });
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