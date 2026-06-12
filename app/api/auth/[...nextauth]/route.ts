import NextAuth, { AuthOptions } from "next-auth";
import { linkCorsairTenant } from "@/src/auth/auth.service";
import { authConfig } from "@/src/auth/config";
import { logger } from "@/src/lib/logger";
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
 
      // On first OAuth sign-in, link tokens to Corsair tenant
      // This stores encrypted credentials for all subsequent API calls
      if (account.access_token) {
        try {
          await linkCorsairTenant(user.id, {
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
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
 
const handler = NextAuth(extendedConfig);
export { handler as GET, handler as POST };