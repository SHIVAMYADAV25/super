// import NextAuth, { AuthOptions } from "next-auth";
// import { linkCorsairTenant, getOrCreateUser } from "@/src/auth/auth.service";
// import { authConfig } from "@/src/auth/config";
// import { logger } from "@/src/lib/logger";
// import type { User, Account } from "next-auth";

// type SignInParams = {
//   user: User;
//   account: (Account & {
//     access_token?: string;
//     refresh_token?: string;
//   }) | null;
// };

// // Extend authConfig to link Corsair on first login
// const extendedConfig: AuthOptions = {
//   ...authConfig,
//   callbacks: {
//     ...authConfig.callbacks,
//     async signIn({ user, account }:SignInParams) {
//       if (!account || !user.id) return true;
//       logger.info("SIGNIN CALLBACK", {
//                     user,
//                     account,
//                   });
 
//       // Ensure a row exists in our `users` table for this Google account
//       let dbUser:
//   | Awaited<ReturnType<typeof getOrCreateUser>>
//   | undefined;

// try {
//   dbUser = await getOrCreateUser({
//     sub: user.id,
//     email: user.email!,
//     name: user.name ?? undefined,
//     picture: user.image ?? undefined,
//   });

//   (user as any).dbUserId = dbUser.id;

//   console.log("USER IDS", {
//     googleSub: user.id,
//     dbUserId: dbUser.id,
//   });
// } catch (err) {
//         logger.error("getOrCreateUser failed during sign-in", {
//           userId: user.id,
//           error: String(err),
//         });
//         return true; // don't block login on a profile upsert failure
//       }

//       // On first OAuth sign-in, link tokens to Corsair tenant
//       // This stores encrypted credentials for all subsequent API calls
//       if (account.access_token) {
//         try {
//           await linkCorsairTenant(dbUser.id,
//                       user.id, {
//             accessToken: account.access_token,
//             refreshToken: account.refresh_token,
//           });
//         } catch (err) {
//           logger.error("Corsair link failed during sign-in", {
//             userId: user.id,
//             error: String(err),
//           });
//           // Don't block sign-in — user can still log in, API calls will prompt re-auth
//         }
//       }
      
//       return true;
//     },
//     // Merge with existing callbacks
//     jwt: authConfig.callbacks?.jwt,
//     session: authConfig.callbacks?.session,
//   },
// };
 
// const handler = NextAuth(extendedConfig);
// export { handler as GET, handler as POST };

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

// Extend authConfig to link Corsair on first login
const extendedConfig: AuthOptions = {
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }:SignInParams) {
      if (!account || !user.id) return true;
      logger.info("SIGNIN CALLBACK", {
                    user,
                    account,
                  });
 
      // Ensure a row exists in our `users` table for this Google account
      let dbUser:
  | Awaited<ReturnType<typeof getOrCreateUser>>
  | undefined;

try {
  dbUser = await getOrCreateUser({
    sub: user.id,
    email: user.email!,
    name: user.name ?? undefined,
    picture: user.image ?? undefined,
  });

  (user as any).dbUserId = dbUser.id;

  console.log("USER IDS", {
    googleSub: user.id,
    dbUserId: dbUser.id,
  });
} catch (err) {
        logger.error("getOrCreateUser failed during sign-in", {
          userId: user.id,
          error: String(err),
        });
        return true; // don't block login on a profile upsert failure
      }

      // On first OAuth sign-in, link tokens to Corsair tenant
      // This stores encrypted credentials for all subsequent API calls
      if (account.access_token) {
        try {
          await linkCorsairTenant(dbUser.id,
                      user.id, {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
          });

          // Register Gmail watch + Calendar push channel so we get
          // realtime webhooks instead of polling. Fire-and-forget —
          // never blocks sign-in, and re-registers (renews) on every login
          // since both subscription types expire after a few days/weeks.
          void subscribeAllWebhooks(user.id).catch((err:any) => {
            logger.warn("Webhook subscription registration failed", {
              userId: user.id,
              error: String(err),
            });
          });
        } catch (err) {
          logger.error("Corsair link failed during sign-in", {
            userId: user.id,
            error: String(err),
          });
          // Don't block sign-in — user can still log in, API calls will prompt re-auth
        }
      }
      
      return true;
    },
    // Merge with existing callbacks
    jwt: authConfig.callbacks?.jwt,
    session: authConfig.callbacks?.session,
  },
};
 
const handler = (extendedConfig);
export { handler as GET, handler as POST };