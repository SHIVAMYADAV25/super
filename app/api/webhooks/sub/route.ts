import { handleRouteError, success } from "@/src/lib/api-response";
import { withAuth } from "@/src/middleware/auth";
import { subscribeAllWebhooks } from "@/src/server/lib/webhook-subscriptions";

/**
 * POST /api/webhooks/subscribe
 *
 * Manually (re)register Gmail watch + Calendar push channel subscriptions
 * for the current user. Useful for:
 *  - Testing webhook setup without signing out/in
 *  - Renewing subscriptions before they expire (Gmail watch: 7 days,
 *    Calendar push channels: up to 1 month)
 *
 * Normally this runs automatically on every sign-in (see
 * app/api/auth/[...nextauth]/route.ts signIn callback).
 */
export const POST = withAuth(async (req) => {
  try {
    await subscribeAllWebhooks(req.user.googleSub);
    return success({ subscribed: true });
  } catch (err) {
    return handleRouteError(err);
  }
});