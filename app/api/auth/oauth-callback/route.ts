
import { env } from "@/src/env";
import { logger } from "@/src/lib/logger";
import { corsair } from "@/src/server/lib/corsair";
import { processOAuthCallback } from "corsair/oauth";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authConfig } from "@/src/auth/config";
import { subscribeGmailWebhook, subscribeCalendarWebhook } from "@/src/server/lib/webhook-subscriptions";


const REDIRECT_URI = `${env.NEXT_PUBLIC_APP_URL}/api/auth/oauth-callback`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * GET /api/auth/oauth-callback?code=...&state=...
 *
 * Called by Google after the user approves OAuth.
 * Corsair extracts the tenantId from the HMAC-signed state,
 * exchanges the code for tokens, and stores them encrypted.
 *
 * Per Corsair security docs:
 * - Verify oauth_state cookie matches query param (CSRF protection)
 * - Always clear cookie on every exit path
 * - HTML-escape all user-controlled values before rendering
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Helper: clear cookie header for every exit path
  const clearCookieHeader = {
    "Set-Cookie": "oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax",
    "Content-Type": "text/html; charset=utf-8",
  };

  // Provider returned an error (user denied, etc.)
  if (error) {
    logger.warn("OAuth provider error", { error });
    return new NextResponse(
      `<html><body>
        <h2>Authorization failed</h2>
        <p>${escapeHtml(error)}</p>
        <p><a href="/inbox">Back to inbox</a></p>
      </body></html>`,
      { status: 400, headers: clearCookieHeader },
    );
  }

  if (!code || !state) {
    return new NextResponse(
      `<html><body><p>Missing OAuth parameters.</p><a href="/login">Try again</a></body></html>`,
      { status: 400, headers: clearCookieHeader },
    );
  }

  // CSRF check — verify state matches cookie
  const storedState = request.cookies.get("oauth_state")?.value;
  if (!storedState || storedState !== state) {
    logger.warn("OAuth CSRF check failed");
    return new NextResponse(
      `<html><body><p>Invalid state. Possible CSRF attempt.</p><a href="/login">Try again</a></body></html>`,
      { status: 400, headers: clearCookieHeader },
    );
  }

  try {
    // Corsair exchanges the code for tokens and stores them encrypted
    // The tenantId is extracted from the signed state — no query param needed

    const payload = JSON.parse(
  Buffer.from(state.split(".")[0], "base64url").toString()
);

// console.log(payload);
// console.log(typeof payload.tenantId);

    const result = await processOAuthCallback(corsair, {
      code,
      state,
      redirectUri: REDIRECT_URI,
    });

    logger.info("OAuth callback processed", {
      plugin: result.plugin,
      tenantId: result.tenantId,
    });

    // Re-register the webhook for whichever plugin was just (re)connected.
    // This covers the "Connect Gmail" / "Connect Calendar" buttons in the UI
    // (separate from the NextAuth sign-in flow, which subscribes both on
    // every login). We need the DB user's UUID to persist tracking columns,
    // so we read it from the still-active NextAuth session cookie — the
    // user is mid-flow in the same browser that's logged in.
    try {
      const session = await getServerSession(authConfig);
      const dbUserId = session?.user?.id;
      const googleSub = session?.user?.googleSub;

      if (dbUserId && googleSub) {
        if (result.plugin === "gmail") {
          void subscribeGmailWebhook(googleSub, dbUserId).catch((err) =>
            logger.warn("Gmail webhook re-subscribe after connect failed", {
              error: String(err),
            }),
          );
        } else if (result.plugin === "googlecalendar") {
          void subscribeCalendarWebhook(googleSub, dbUserId).catch((err) =>
            logger.warn("Calendar webhook re-subscribe after connect failed", {
              error: String(err),
            }),
          );
        }
      } else {
        logger.warn("No session found after OAuth callback — skipping webhook subscribe", {
          plugin: result.plugin,
        });
      }
    } catch (err) {
      logger.warn("Webhook subscribe after connect failed", { error: String(err) });
    }

    // Redirect to inbox with success indicator
    const response = NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/inbox?connected=${escapeHtml(result.plugin)}`,
    );
    response.cookies.delete("oauth_state");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("OAuth callback failed", { error: message });

    return new NextResponse(
      `<html><body>
        <h2>OAuth error</h2>
        <p>${escapeHtml(message)}</p>
        <p><a href="/login">Try again</a></p>
      </body></html>`,
      { status: 500, headers: clearCookieHeader },
    );
  }
}