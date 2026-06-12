

// Simple in-process queue — swap for BullMQ/Redis in production

import { logger } from "../lib/logger";

// p-queue limits concurrency so we don't flood OpenAI
let queue : import("p-queue").default | null = null


async function getQueue() {
    if(!queue){
        const {default : PQueue} = await import("p-queue");
        queue = new PQueue({
            concurrency: 2,          // max 2 OpenAI calls at once
            intervalCap: 10,         // max 10 jobs per interval
            interval: 60_000,        // per minute (OpenAI rate limits)
            timeout: 30_000,         // 30s per job timeout
        })

        queue.on("error",(err) =>{
            logger.error("Job queue error" , {error: String(err)})
        });
    }

    return queue;
} 

/**
 * Queue an email enrichment job (priority + embedding).
 * Fire-and-forget — never awaited by callers.
 */

export async function queueEmailEmbedding(job:EmailE) {
    
}