// import { eq } from "drizzle-orm";
// import { db, pool } from "../server/db";
// import { users, corsairAccounts, corsairIntegrations } from "../server/db/schema";
// import { logger } from "../lib/logger";
// import { getTenant, getTenantId } from "../server/lib/corsair";
// import { createExternalApiError } from "../lib/errors";
// import { initializeAccountDEK } from "corsair/core";
// import { createCorsairDatabase } from "corsair/db";
// import { env } from "../env";
// import { randomUUID } from "crypto";

// interface GoogleProfile {
//     sub : string; // Google's user ID (we use as our user ID)
//     email : string;
//     name ?: string;
//     picture ?: string;
// }

// interface OAuthTokens {
//     accessToken : string;
//     refreshToken ?: string | null;
// }

// /**
//  * Upsert user in our DB on first/subsequent login.
//  * Returns the user record.
//  */

// export async function getOrCreateUser(profile : GoogleProfile) {
//     const existing = await db
//     .select()
//     .from(users)
//     .where(eq(users.email,profile.email))
//     .limit(1);

//     if(existing.length > 0){
//         return existing[0]
//     }

//     logger.info("Creating new User",{email : profile.email})

//     const [created] = await db
//     .insert(users)
//     .values({
//         email : profile.email,
//         name : profile.name,
//         image : profile.picture
//     })
//     .onConflictDoUpdate({
//         target :users.email,
//         set : {
//             name : profile.name ?? null,
//             image : profile.picture ?? null,
//             updatedAt : new Date(),
//         }
//     })
//     .returning();

    
//     return created!;
// }

// /**
//  * Link a user's Google OAuth tokens to their Corsair tenant.
//  * Called once after first OAuth login.
//  *
//  * Corsair stores tokens encrypted with the user's DEK,
//  * which is itself encrypted with the KEK. We never touch
//  * raw tokens after this point.
//  */

// export async function linkCorsairTenant(
//     userId : string,
//     googleSub: string,
//     tokens : OAuthTokens,
// ):Promise<void> {
//     try{
//         const tenantId = getTenantId(googleSub);
//         console.log("LINK TENANT", {
//             userId,
//             googleSub,
//             tenantId,
//             });

//         // Corsair only auto-creates the corsair_accounts row inside
//         // processOAuthCallback (the /api/connect flow) or `corsair setup`.
//         // On a plain NextAuth sign-in there is no row yet, and
//         // initializeAccountDEK requires the row to already exist
//         // ("Account not found... Make sure to create the account first").
//         // So create the corsair_accounts row ourselves for each
//         // integration before initializing the DEK.
//         for (const integrationName of ["gmail", "googlecalendar"] as const) {
//             const integration = await db
//                 .select()
//                 .from(corsairIntegrations)
//                 .where(eq(corsairIntegrations.name, integrationName))
//                 .limit(1);

//             if (integration.length === 0) {
//                 throw new Error(
//                     `corsair_integrations row for "${integrationName}" is missing. ` +
//                     `Run the corsair setup/CLI to configure the plugin's client_id/client_secret first.`
//                 );
//             }

//             const integrationId = integration[0]!.id;

//             const existingAccount = await db
//                 .select()
//                 .from(corsairAccounts)
//                 .where(eq(corsairAccounts.tenantId, tenantId))
//                 .limit(1000); // small table; filter in JS for the matching integration

//             const alreadyExists = existingAccount.some(
//                 (a) => a.tenantId === tenantId && a.integrationId === integrationId
//             );

//             if (!alreadyExists) {
//                 await db.insert(corsairAccounts).values({
//                     id: randomUUID(),
//                     tenantId,
//                     integrationId,
//                     config: {},
//                 });
//                 logger.info("Created corsair_accounts row", { tenantId, integrationName });
//             }
//         }

//         const corsairDb = createCorsairDatabase(pool);
//         await initializeAccountDEK(corsairDb, "gmail", tenantId, env.CORSAIR_KEK);
//         await initializeAccountDEK(corsairDb, "googlecalendar", tenantId, env.CORSAIR_KEK);

//         const tenant = getTenant(googleSub);

//         // Store Gmail OAuth credentials for this tenant
//         // Corsair uses these for every gmail.api.* call and handles refresh
//         console.log("SETTING TOKENS FOR", {
//         googleSub,
//         tenantId,
//         });
//         await tenant.gmail.keys.set_access_token(tokens.accessToken);
//         if(tokens.refreshToken){
//             await tenant.gmail.keys.set_refresh_token(tokens.refreshToken);
//         }

//         // Store Google Calendar OAuth credentials
//         await tenant.googlecalendar.keys.set_access_token(tokens.accessToken);
//         if(tokens.refreshToken){
//             await tenant.googlecalendar.keys.set_refresh_token(tokens.refreshToken);
//         }

//         logger.info("Corsair tenant linked" , {userId});
//     }catch(err){
//         // Non-fatal — user can still use the app, just API calls will fail
//         // until they re-auth. Log but don't throw.
//         logger.error("Failed to link corsair tenant",{
//             userId,
//             error : err instanceof Error ? err.message : String(err),
//         });
//         throw createExternalApiError("Corsair",err);
//     }
// }

// /**
//  * Revoke a user's Corsair tenant credentials on logout.
//  */

// export async function revokeCorsairTenant(userId:string):Promise<void> {
//     try{
//         const tenant = getTenant(userId);

//         // Clear stored credentials for both plugins
//         // Corsair will no longer be able to make API calls on behalf of this user

//         await tenant.gmail.keys.set_access_token(null);
//         await tenant.googlecalendar.keys.set_access_token(null);

//         logger.info("Corsair tenat credential revoked" , {userId});
//     }catch(err){
//         logger.warn("Failed to revok Corsair credentials" , {
//             userId,
//             error : err instanceof Error ? err.message : String(err),
//         });
//         // Don't throw — logout should always succeed
//     }
// }

import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, corsairAccounts, corsairIntegrations } from "../server/db/schema";
import { logger } from "../lib/logger";
import { getTenant, getTenantId } from "../server/lib/corsair";
import { createExternalApiError } from "../lib/errors";
import { initializeAccountDEK } from "corsair/core";
import { createCorsairDatabase } from "corsair/db";
import { env } from "../env";
import { randomUUID } from "crypto";

interface GoogleProfile {
    sub : string; // Google's user ID (we use as our user ID)
    email : string;
    name ?: string;
    picture ?: string;
}

interface OAuthTokens {
    accessToken : string;
    refreshToken ?: string | null;
}

/**
 * Upsert user in our DB on first/subsequent login.
 * Returns the user record.
 */

export async function getOrCreateUser(profile : GoogleProfile) {
    const existing = await db
    .select()
    .from(users)
    .where(eq(users.email,profile.email))
    .limit(1);

    if(existing.length > 0){
        return existing[0]
    }

    logger.info("Creating new User",{email : profile.email})

    const [created] = await db
    .insert(users)
    .values({
        email : profile.email,
        name : profile.name,
        image : profile.picture
    })
    .onConflictDoUpdate({
        target :users.email,
        set : {
            name : profile.name ?? null,
            image : profile.picture ?? null,
            updatedAt : new Date(),
        }
    })
    .returning();

    
    return created!;
}

/**
 * Link a user's Google OAuth tokens to their Corsair tenant.
 * Called once after first OAuth login.
 *
 * Corsair stores tokens encrypted with the user's DEK,
 * which is itself encrypted with the KEK. We never touch
 * raw tokens after this point.
 */

export async function linkCorsairTenant(
    userId : string,
    googleSub: string,
    tokens : OAuthTokens,
):Promise<void> {
    try{
        const tenantId = getTenantId(googleSub);
        console.log("LINK TENANT", {
            userId,
            googleSub,
            tenantId,
            });

        // Corsair only auto-creates the corsair_accounts row inside
        // processOAuthCallback (the /api/connect flow) or `corsair setup`.
        // On a plain NextAuth sign-in there is no row yet, and
        // initializeAccountDEK requires the row to already exist
        // ("Account not found... Make sure to create the account first").
        // So create the corsair_accounts row ourselves for each
        // integration before initializing the DEK.
        for (const integrationName of ["gmail", "googlecalendar"] as const) {
            const integration = await db
                .select()
                .from(corsairIntegrations)
                .where(eq(corsairIntegrations.name, integrationName))
                .limit(1);

            if (integration.length === 0) {
                throw new Error(
                    `corsair_integrations row for "${integrationName}" is missing. ` +
                    `Run the corsair setup/CLI to configure the plugin's client_id/client_secret first.`
                );
            }

            const integrationId = integration[0]!.id;

            const existingAccount = await db
                .select()
                .from(corsairAccounts)
                .where(eq(corsairAccounts.tenantId, tenantId))
                .limit(1000); // small table; filter in JS for the matching integration

            const alreadyExists = existingAccount.some(
                (a) => a.tenantId === tenantId && a.integrationId === integrationId
            );

            if (!alreadyExists) {
                await db.insert(corsairAccounts).values({
                    id: randomUUID(),
                    tenantId,
                    integrationId,
                    config: {},
                });
                logger.info("Created corsair_accounts row", { tenantId, integrationName });
            }
        }

        const corsairDb = createCorsairDatabase(pool);
        await initializeAccountDEK(corsairDb, "gmail", tenantId, env.CORSAIR_KEK);
        await initializeAccountDEK(corsairDb, "googlecalendar", tenantId, env.CORSAIR_KEK);

        const tenant = getTenant(googleSub);

        // Store Gmail OAuth credentials for this tenant
        // Corsair uses these for every gmail.api.* call and handles refresh
        console.log("SETTING TOKENS FOR", {
        googleSub,
        tenantId,
        });
        await tenant.gmail.keys.set_access_token(tokens.accessToken);
        if(tokens.refreshToken){
            await tenant.gmail.keys.set_refresh_token(tokens.refreshToken);
        }

        // Store Google Calendar OAuth credentials
        await tenant.googlecalendar.keys.set_access_token(tokens.accessToken);
        if(tokens.refreshToken){
            await tenant.googlecalendar.keys.set_refresh_token(tokens.refreshToken);
        }

        logger.info("Corsair tenant linked" , {userId});
    }catch(err){
        // Non-fatal — user can still use the app, just API calls will fail
        // until they re-auth. Log but don't throw.
        logger.error("Failed to link corsair tenant",{
            userId,
            error : err instanceof Error ? err.message : String(err),
        });
        throw createExternalApiError("Corsair",err);
    }
}

/**
 * Revoke a user's Corsair tenant credentials on logout.
 * @param googleSub - Google sub ID (NOT the DB UUID) — must match the
 *   tenantId used by linkCorsairTenant / every service call.
 */

export async function revokeCorsairTenant(googleSub:string,userId:string):Promise<void> {
    try{
        const tenant = getTenant(googleSub);

        // Clear stored credentials for both plugins
        // Corsair will no longer be able to make API calls on behalf of this user

        await tenant.gmail.keys.set_access_token(null);
        await tenant.googlecalendar.keys.set_access_token(null);

        logger.info("Corsair tenat credential revoked" , {userId});
    }catch(err){
        logger.warn("Failed to revok Corsair credentials" , {
            userId,
            error : err instanceof Error ? err.message : String(err),
        });
        // Don't throw — logout should always succeed
    }
}