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
 * Called AFTER Corsair has verified the signature and updated its
 * local DB. Our job: emit SSE signals so the frontend refetches.
 *
 * SSE channel key = Corsair tenantId = "user_<googleSub>"
 * (see /api/events/stream — subscribes via getTenantId(session.user.googleSub),
 * and /api/connect — registers OAuth under the same key).
 *
 * The webhook route (`/api/webhooks?tenantId=...`) must pass that SAME
 * "user_<googleSub>" string as the tenantId query param so emitToUser
 * reaches the right SSE subscriber.
 */

import { logger } from "@/src/lib/logger";
import { emitToUser } from "../lib/sse";

interface WebhookPayload {
  message?: {
    data?: string;
    messageId?: string;
  };
  subscription?: string;
  event?: unknown;
}

/**
 * Handle Gmail messageChanged webhook.
 * Emits SSE "new_email" to trigger inbox refetch.
 *
 * @param tenantId - Corsair tenantId ("user_<googleSub>"), passed straight
 *   through from the webhook route's ?tenantId= query param.
 */
export async function handleGmailWebhook(
  tenantId: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    logger.info("Processing Gmail webhook", { tenantId });

    let historyId: string | undefined;
    if (payload.message?.data) {
      try {
        const decoded = Buffer.from(payload.message.data, "base64").toString("utf-8");
        const parsed = JSON.parse(decoded) as { historyId?: string };
        historyId = parsed.historyId;
      } catch {
        logger.warn("Could not decode Gmail webhook payload", { tenantId });
      }
    }

    emitToUser(tenantId, { type: "new_email", data: { historyId } });

    logger.info("Gmail webhook processed — SSE emitted", { tenantId });
  } catch (err) {
    logger.error("Gmail webhook handler failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle Google Calendar onEventChanged webhook.
 * Emits SSE "new_event" to trigger calendar refetch.
 */
export async function handleCalendarWebhook(
  tenantId: string,
  payload: WebhookPayload,
): Promise<void> {
  try {
    logger.info("Processing Calendar webhook", { tenantId });

    emitToUser(tenantId, { type: "new_event", data: {} });

    logger.info("Calendar webhook processed — SSE emitted", { tenantId });
  } catch (err) {
    logger.error("Calendar webhook handler failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}