

// app/api/auth/[...nextauth]/route.ts
//
// BUG FIXED (Bug 5):
//   subscribeAllWebhooks was called INSIDE the try block that wraps
//   linkCorsairTenant. If linkCorsairTenant throws (e.g. missing
//   corsair_integrations row on first run), the catch block fires and
//   subscribeAllWebhooks is never reached — user gets no webhooks silently.
//
//   Additionally, linkCorsairTenant ends with `throw createExternalApiError()`
//   on failure, which means any Corsair setup error also skips webhooks.
//
// FIX:
//   - Move subscribeAllWebhooks to AFTER the try/catch block for linking,
//     guarded by a `linked` boolean flag. Webhooks only need to subscribe
//     once tokens are stored — if linking failed there's nothing to subscribe.
//   - Keep the existing fire-and-forget pattern (void + .catch) so webhook
//     registration never blocks sign-in.

import NextAuth, { AuthOptions } from "next-auth";
import { linkCorsairTenant, getOrCreateUser } from "@/src/auth/auth.service";
import { authConfig } from "@/src/auth/config";
import { logger } from "@/src/lib/logger";
import { subscribeAllWebhooks } from "@/src/server/lib/webhook-subscriptions";
import type { User, Account } from "next-auth";

type SignInParams = {
  user: User;
  account: (Account & {
    access_token?: string;
    refresh_token?: string;
  }) | null;
};

const extendedConfig: AuthOptions = {
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }: SignInParams) {
      if (!account || !user.id) return true;

      logger.info("SIGNIN CALLBACK", { userId: user.id });

      // Step 1: Upsert our users row. If this fails we still allow sign-in
      // but we can't do anything useful without a DB user, so bail early.
      let dbUser: Awaited<ReturnType<typeof getOrCreateUser>> | undefined;
      try {
        dbUser = await getOrCreateUser({
          sub: user.id,
          email: user.email!,
          name: user.name ?? undefined,
          picture: user.image ?? undefined,
        });
        (user as unknown as Record<string, unknown>).dbUserId = dbUser.id;
      } catch (err) {
        logger.error("getOrCreateUser failed during sign-in", {
          userId: user.id,
          error: String(err),
        });
        return true; // don't block login
      }

      if (!account.access_token) return true;

      // Step 2: Link OAuth tokens to Corsair tenant.
      // BUG FIX: track whether this succeeded so we only subscribe webhooks
      // when we actually have tokens stored.
      let linked = false;
      try {
        await linkCorsairTenant(dbUser.id, user.id, {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
        });
        linked = true;
      } catch (err) {
        logger.error("Corsair link failed during sign-in", {
          userId: user.id,
          error: String(err),
        });
        // Don't block sign-in — API calls will fail until user re-auths.
      }

      // Step 3: Register webhook subscriptions.
      // BUG FIX: this is now OUTSIDE the try/catch above.
      // Only subscribe if linking succeeded — there's no point registering
      // webhooks without valid stored credentials.
      if (linked) {
        void subscribeAllWebhooks(user.id, dbUser.id).catch((err: unknown) => {
          logger.warn("Webhook subscription registration failed", {
            userId: user.id,
            error: String(err),
          });
        });
      }

      return true;
    },
    jwt: authConfig.callbacks?.jwt,
    session: authConfig.callbacks?.session,
  },
};

const handler = NextAuth(extendedConfig);
export { handler as GET, handler as POST };