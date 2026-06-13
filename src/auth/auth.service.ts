import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "../server/db/schema";
import { logger } from "../lib/logger";
import { getTenant } from "../server/lib/corsair";
import { createExternalApiError } from "../lib/errors";

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
        id: profile.sub, // using google sub
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
    tokens : OAuthTokens,
):Promise<void> {
    try{
        const tenant = getTenant(userId);

        // Store Gmail OAuth credentials for this tenant
        // Corsair uses these for every gmail.api.* call and handles refresh
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
 */

export async function revokeCorsairTenant(userId:string):Promise<void> {
    try{
        const tenant = getTenant(userId);

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