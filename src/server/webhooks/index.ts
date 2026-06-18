// import { logger } from "@/src/lib/logger";
// import { emitToUser } from "../lib/sse";



// // ─── Gmail webhook handler ────────────────────────────────────────────────────
// interface GmailWebhookPayload {
//   message?: {
//     data?: string; // base64-encoded JSON
//     messageId?: string;
//   };
//   subscription?: string;
//   event?: unknown;
// }


// /**
//  * Handle a Gmail webhook event from Corsair.
//  * Corsair has already verified the signature and decoded the payload.
//  *
//  * The messageChanged event fires when a message is received, deleted,
//  * or has its labels changed.
//  */

// export async function handleGmailWebhook(
//     tenantId : string,
//     payload : GmailWebhookPayload,
// ):Promise<void> {
//     try{
//         logger.info("Processing Gmail webhook",{tenantId});

//         // Decode the Pub/Sub message data
//         let emailData : {historId ?: string,emailAddress ?: string} = {};

//         if(payload.message?.data){
//             try {
//                 // convert  "eyJoaXN0b3J5SWQiOiIxMjM0NSJ9" into "{"historyId":"12345"}"
//                 const decoded = Buffer.from(payload.message.data , "base64").toString("utf-8");
//                 emailData  = JSON.parse(decoded); // proper object
//             } catch (error) {
//                 logger.warn("could not decode Gmail webHook payload" , {tenantId});
//             }
//         }

//         // We don't get the specific message ID from the push notification,
//         // so we fetch recent unread messages to discover what changed.
//         // In a production app, you'd use the History API with historyId.
//         // For now, emit a refresh signal to the frontend.

//         emitToUser(tenantId,{type : "new_email",data : {historyId : emailData.historId}});

//         logger.info("Gmail webhook processed -UI refresh triggered", {tenantId});
//     }catch(err){
//         logger.error("Gmail webhook handler failed",{
//             tenantId ,
//             error : err instanceof Error ? err.message : String(err)
//         })
//     }
// }

// // ─── Calendar webhook handler

// interface CalendarWebhookPayload{
//     message ?: {
//         data ?: string;
//         messageId ?: string;
//     };
//     subscription ?: string;
//     event ?: unknown
// }

// /**
//  * Handle a Google Calendar webhook event from Corsair.
//  * Fires when an event is created, updated, or deleted.
//  */

// export async function handleCalendarWebhook(
//     tenantId : string,
//     payload : CalendarWebhookPayload
// ):Promise <void>{
//     try{
//         logger.info("Processing Calendar Webhook",{tenantId});

//         // Emit refresh signal to frontend
//         emitToUser(tenantId, { type: "new_event", data: {} });
//         logger.info("Calendar webhook processed — UI refresh triggered", { tenantId });
//     }catch(err){
//         logger.error("Calendar webhook handler failed", {
//             tenantId,
//             error: err instanceof Error ? err.message : String(err),
//         });
//     }
// }
/**
 * Webhook handlers for Gmail and Google Calendar Corsair events.
 *
 * Gmail flow (per webhook):
 *   1. Extract googleSub from tenantId ("user_<googleSub>")
 *   2. Look up user row → get userId + last known gmailHistoryId
 *   3. Call Gmail history.list(startHistoryId) → discover new message IDs
 *   4. Call handleNewEmail() for each → fetch, upsert DB, queue enrichment, SSE push
 *   5. Advance gmailHistoryId cursor in users table
 *
 * Calendar flow:
 *   Google sends no event ID in the push notification — just "something changed".
 *   We call syncEventsFromWebhook() which re-fetches upcoming events and upserts
 *   them into the DB, then emits an SSE signal.
 */

import { logger } from "@/src/lib/logger";
import { emitToUser } from "../lib/sse";
import { getTenant } from "../lib/corsair";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { handleNewEmail } from "../services/email.service";
import { syncEventsFromWebhook } from "../services/calendar.service";

// ─── Shared types ─────────────────────────────────────────────────────────────

interface WebhookPayload {
  message?: {
    data?: string;
    messageId?: string;
  };
  subscription?: string;
  event?: unknown;
}

// ─── Gmail History API types ──────────────────────────────────────────────────

interface GmailHistoryMessage {
  id: string;
  threadId: string;
}

interface GmailHistoryRecord {
  id: string;
  messages?: GmailHistoryMessage[];
  messagesAdded?: Array<{ message: GmailHistoryMessage }>;
  messagesDeleted?: Array<{ message: GmailHistoryMessage }>;
  labelsAdded?: Array<{ message: GmailHistoryMessage; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: GmailHistoryMessage; labelIds: string[] }>;
}

interface GmailHistoryListResponse {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** tenantId is "user_<googleSub>" — strip the prefix. */
function googleSubFromTenantId(tenantId: string): string {
  return tenantId.startsWith("user_") ? tenantId.slice("user_".length) : tenantId;
}

/**
 * Look up the DB user row from a Corsair tenantId.
 * Returns null if the user doesn't exist (stale/unknown tenant).
 */
async function lookupUser(
  tenantId: string,
): Promise<{ id: string; googleSub: string; gmailHistoryId: string | null } | null> {
  const googleSub = googleSubFromTenantId(tenantId);

  const rows = await db
    .select({
      id: users.id,
      googleSub: users.googleSub,
      gmailHistoryId: users.gmailHistoryId,
    })
    .from(users)
    .where(eq(users.googleSub, googleSub))
    .limit(1);

  const row = rows[0];
  if (!row?.googleSub) return null;

  return {
    id: row.id,
    googleSub: row.googleSub,
    gmailHistoryId: row.gmailHistoryId ?? null,
  };
}

/**
 * Call Gmail's history.list REST endpoint directly.
 *
 * The @corsair-dev/gmail package doesn't expose history.list, so we call
 * the Google REST API ourselves using Corsair's stored access token.
 *
 * Returns an array of newly-added message IDs and the latest historyId
 * we should advance our cursor to.
 */
async function fetchNewMessageIds(
  googleSub: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; latestHistoryId: string | null }> {
  const tenant = getTenant(googleSub);
  const accessToken = await tenant.gmail.keys.get_access_token();

  if (!accessToken) {
    logger.warn("fetchNewMessageIds: no access token", { googleSub });
    return { messageIds: [], latestHistoryId: null };
  }

  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  url.searchParams.set("maxResults", "20");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn("Gmail history.list non-2xx", {
      googleSub,
      status: response.status,
      body: text,
    });
    return { messageIds: [], latestHistoryId: null };
  }

  const data = (await response.json()) as GmailHistoryListResponse;

  // Extract unique message IDs from messagesAdded events
  const messageIds = new Set<string>();
  for (const record of data.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      if (added.message?.id) messageIds.add(added.message.id);
    }
  }

  return {
    messageIds: Array.from(messageIds),
    latestHistoryId: data.historyId ?? null,
  };
}

// ─── Gmail webhook handler ────────────────────────────────────────────────────

/**
 * Handle Gmail messageChanged webhook.
 *
 * The Pub/Sub notification carries only a historyId — we use Gmail's
 * history.list to discover which specific messages were added to INBOX,
 * then persist + enrich each one via handleNewEmail().
 */
export async function handleGmailWebhook(
  tenantId: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    logger.info("Processing Gmail webhook", { tenantId });

    // 1. Decode the Pub/Sub historyId from the notification payload
    let incomingHistoryId: string | undefined;
    if (payload.message?.data) {
      try {
        const decoded = Buffer.from(payload.message.data, "base64").toString("utf-8");
        const parsed = JSON.parse(decoded) as { historyId?: string };
        incomingHistoryId = parsed.historyId;
      } catch {
        logger.warn("Could not decode Gmail Pub/Sub payload", { tenantId });
      }
    }

    // 2. Look up the user
    const user = await lookupUser(tenantId);
    if (!user) {
      logger.warn("Gmail webhook: no user found for tenant", { tenantId });
      // Emit a generic refresh so the UI still updates via full refetch
      emitToUser(tenantId, { type: "new_email", data: { historyId: incomingHistoryId } });
      return;
    }

    // 3. Determine the startHistoryId for history.list
    //    Prefer the cursor stored in our DB (set when we called watch()).
    //    Fall back to the historyId in this notification if we have nothing stored.
    const startHistoryId = user.gmailHistoryId ?? incomingHistoryId;

    if (!startHistoryId) {
      // No cursor at all — we can't diff. Emit a generic refresh signal.
      logger.warn("Gmail webhook: no historyId cursor, emitting generic refresh", { tenantId });
      emitToUser(tenantId, { type: "new_email", data: {} });
      return;
    }

    // 4. Fetch new message IDs from Gmail history API
    const { messageIds, latestHistoryId } = await fetchNewMessageIds(
      user.googleSub,
      startHistoryId,
    );

    logger.info("Gmail webhook: discovered new messages", {
      tenantId,
      count: messageIds.length,
      startHistoryId,
      latestHistoryId,
    });

    // 5. Process each new message — fetch, upsert DB, queue enrichment, SSE push
    if (messageIds.length > 0) {
      await Promise.allSettled(
        messageIds.map((gmailId) =>
          handleNewEmail(user.googleSub, user.id, gmailId),
        ),
      );
    } else {
      // No new INBOX messages (could be label changes, sent mail, etc.)
      // Still emit a lightweight refresh so the UI can update read status etc.
      emitToUser(tenantId, { type: "new_email", data: { historyId: incomingHistoryId } });
    }

    // 6. Advance the history cursor so the next webhook diffs from here
    if (latestHistoryId) {
      await db
        .update(users)
        .set({ gmailHistoryId: latestHistoryId, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    emitToUser(tenantId, { type: "new_email", data: { historyId: incomingHistoryId } });

    logger.info("Gmail webhook processed", { tenantId, messageIds });
  } catch (err) {
    logger.error("Gmail webhook handler failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Best-effort fallback: at least tell the UI to refresh
    emitToUser(tenantId, { type: "new_email", data: {} });
  }
}

// ─── Calendar webhook handler ─────────────────────────────────────────────────

/**
 * Handle Google Calendar onEventChanged webhook.
 *
 * Google doesn't include event details in push notifications — just a
 * "something changed" signal. We re-sync upcoming events and persist them.
 */
export async function handleCalendarWebhook(
  tenantId: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    logger.info("Processing Calendar webhook", { tenantId });

    // Look up the user so syncEventsFromWebhook has a real userId
    const user = await lookupUser(tenantId);
    if (!user) {
      logger.warn("Calendar webhook: no user found for tenant", { tenantId });
      emitToUser(tenantId, { type: "new_event", data: {} });
      return;
    }

    // Re-fetch upcoming events and persist any changes to the DB
    const synced = await syncEventsFromWebhook(tenantId, user.id);

    // Notify the UI so it refetches the calendar view
    emitToUser(tenantId, { type: "new_event", data: {} });

    logger.info("Calendar webhook processed", { tenantId, synced });
  } catch (err) {
    logger.error("Calendar webhook handler failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    emitToUser(tenantId, { type: "new_event", data: {} });
  }
}