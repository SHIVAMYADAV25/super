

import { env } from "@/src/env";
import { handleRouteError } from "@/src/lib/api-response";
import { createValidationError } from "@/src/lib/errors";
import { withAuth } from "@/src/middleware/auth";
import { corsair, getTenantId } from "@/src/server/lib/corsair";
import { generateOAuthUrl } from "corsair/oauth";
import { NextResponse } from "next/server";


const REDIRECT_URI = `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth-callback`;

/**
 * GET /api/connect?plugin=gmail
 * GET /api/connect?plugin=googlecalendar
 *
 * Generates a Corsair OAuth URL for connecting a plugin.
 * Redirects the user to the provider's consent screen.
 *
 * SECURITY: tenantId is read from session — NEVER from query params
 */

export const GET = withAuth(async (req) => {
    try{
        const plugin = new URL(req.url).searchParams.get("plugin");
        

        if(!plugin || !["gmail","googlecalendar"].includes(plugin)){
            throw createValidationError("plugin must be 'gmail' or 'googlecalendar");
        }
        
        const {url,state } = await generateOAuthUrl(corsair,plugin,{
            // CRITICAL: must match the tenantId used by every service call
            // (getTenant(req.user.googleSub) throughout email/calendar/chat/search
            // services). Using googleSub here ensures OAuth tokens are stored
            // under the SAME Corsair tenant that all API calls read from.
            tenantId: getTenantId(req.user.googleSub),
            redirectUri: REDIRECT_URI,
        })

        const response = NextResponse.redirect(url);

        // Store HMAC-signed state in httpOnly cookie for CSRF protection
            response.cookies.set("oauth_state", state, {
            httpOnly: true,
            sameSite: "lax",
            secure: env.NODE_ENV === "production",
            maxAge: 60 * 10, // 10 minutes
            path: "/",
            });

        return response;
    }catch(err){
        return handleRouteError(err);
    }
})