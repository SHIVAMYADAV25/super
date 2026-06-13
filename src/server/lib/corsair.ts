import { logger } from "@/src/lib/logger";
import { gmail } from "@corsair-dev/gmail";
import { createCorsair } from "corsair"
import { pool } from "../db";
import { env } from "@/src/env";
import { googlecalendar } from "@corsair-dev/googlecalendar";

// https://chatgpt.com/s/t_6a282c9c311881918a94ab7246317f0e

type CorsairInstance = ReturnType<typeof buildCorsair>;

const globalForCorsair = globalThis as {
  corsair?: CorsairInstance;
};

/**
 * Corsair instance — singleton shared across the entire server.
 *
 * Architecture:
 * - multiTenancy: true  → each user gets their own encrypted credentials
 * - We pass our pg Pool so Corsair and our app share the same DB connection
 * - kek: Key Encryption Key protects all stored OAuth tokens
 * - Gmail + Google Calendar plugins with cautious permissions:
 *     reads: allow, writes: allow, destructive: require_approval
 *
 * Usage:
 *   const tenant = corsair.withTenant(userId);
 *   await tenant.gmail.api.messages.list({ maxResults: 50 });
 */

function buildCorsair(){
    return createCorsair({
        plugins:[
            gmail({
                // cautious mode: reads + writes are immediate, destructive needs approval
                permissions:{
                    mode:"cautious",
                    overrides:{
                        // permanently block hard-delete — use trash instead
                        "messages.delete" : "deny",
                        "threads.delete" : "deny",
                    },
                },
                // Webhook hooks — guaranteed to fire on every Gmail webhook event
                webhookHooks:{
                    messageChanged:{
                        before:async(ctx,args) => {
                            logger.debug("Gmail webhook received" , {type : "messageChanged"});
                            return {ctx,args};
                        },
                        after : async(ctx,result) => {
                            logger.info("Gmail webhook processed",{result});
                        },
                    },
                },
            }),

            googlecalendar({
                permissions:{
                    mode : "cautious",
                    overrides : {
                        "events.delete" : "require_approval",
                    },
                },
                webhookHooks:{
                    onEventChanged:{
                        before : async(ctx,args) =>{
                            logger.debug("Calendar webhook received" ,{type : "onEventChanged"});
                            return {ctx,args};
                        },
                        after:async(ctx,result) => {
                            logger.info("Calendar webhook processed" , {result});
                        },
                    },
                },
            }),
        ],
        database : pool,
        kek : env.CORSAIR_KEK,
        multiTenancy:true
    })
}

export const corsair = globalForCorsair.corsair ?? buildCorsair();

if(process.env.NODE_ENV !== "production"){
    globalForCorsair.corsair = corsair;
}

/**
 * Get a tenant-scoped Corsair client for a specific user.
 * All API calls and DB queries are automatically scoped to this tenant.
 */

/**
 * Corsair has a bug where all-numeric tenant_id strings (like raw Google
 * `sub` IDs, e.g. "115022235190203160742") get coerced to a JS number
 * internally and fail zod's `tenant_id: z.string()` check.
 *
 * Fix: always prefix the userId before handing it to Corsair, so the
 * tenant_id is never purely numeric.
 */
export function getTenantId(userId: string): string {
    return `user_${userId}`;
}

export function getTenant(userId : string){
    return corsair.withTenant(getTenantId(userId));
}

export type CorsairTenant = ReturnType<typeof getTenant>;