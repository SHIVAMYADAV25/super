import { logger } from "@/src/lib/logger";
import { emitToUser } from "../lib/sse";



// ─── Gmail webhook handler ────────────────────────────────────────────────────
interface GmailWebhookPayload {
  message?: {
    data?: string; // base64-encoded JSON
    messageId?: string;
  };
  subscription?: string;
  event?: unknown;
}


/**
 * Handle a Gmail webhook event from Corsair.
 * Corsair has already verified the signature and decoded the payload.
 *
 * The messageChanged event fires when a message is received, deleted,
 * or has its labels changed.
 */

export async function handleGmailWebhook(
    tenantId : string,
    payload : GmailWebhookPayload,
):Promise<void> {
    try{
        logger.info("Processing Gmail webhook",{tenantId});

        // Decode the Pub/Sub message data
        let emailData : {historId ?: string,emailAddress ?: string} = {};

        if(payload.message?.data){
            try {
                const decoded = Buffer.from(payload.message.data , "base64").toString("utf-8");
                emailData  = JSON.parse(decoded);
            } catch (error) {
                logger.warn("could not decode Gmail webHook payload" , {tenantId});
            }
        }

        // We don't get the specific message ID from the push notification,
        // so we fetch recent unread messages to discover what changed.
        // In a production app, you'd use the History API with historyId.
        // For now, emit a refresh signal to the frontend.

        emitToUser(tenantId,{type : "new_email",data : {historyId : emailData.historId}});

        logger.info("Gmail webhook processed -UI refresh triggered", {tenantId});
    }catch(err){
        logger.error("Gmail webhook handler failed",{
            tenantId ,
            error : err instanceof Error ? err.message : String(err)
        })
    }
}

// ─── Calendar webhook handler

interface CalendarWebhookPayload{
    message ?: {
        data ?: string;
        messageId ?: string;
    };
    subscription ?: string;
    event ?: unknown
}

/**
 * Handle a Google Calendar webhook event from Corsair.
 * Fires when an event is created, updated, or deleted.
 */

export async function handleCalendarWebhook(
    tenantId : string,
    payload : CalendarWebhookPayload
):Promise <void>{
    try{
        logger.info("Processing Calendar Webhook",{tenantId});

        // Emit refresh signal to frontend
        emitToUser(tenantId, { type: "new_event", data: {} });
        logger.info("Calendar webhook processed — UI refresh triggered", { tenantId });
    }catch(err){
        logger.error("Calendar webhook handler failed", {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}