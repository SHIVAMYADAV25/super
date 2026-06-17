// import { type NextAuthOptions } from "next-auth";
// import GoogleProvider from "next-auth/providers/google"
// import { env } from "../env";
// import { logger } from "../lib/logger";

// // Add more properties
// // to existing NextAuth types
// declare module "next-auth"{
//     interface Session{
//         user : {
//             id : string;          // DB UUID
//             googleSub : string;   // Google User ID
//             email :string;
//             name ?: string | null;
//             image ?: string | null;
//         };
//         accessToken ?: string;
//         error ?: "RefreshAccessTokenError";
//     }

//     interface User {
//         id : string;
//     }
// }

// declare module "next-auth/jwt"{
//     interface JWT {
//         sub:string;

//         dbUserId?: string;
//         googleSub?: string;


//         email : string;
//         accessToken ?: string;
//         refreshToken ?: string;
//         accessTokenExpires ?: number;
//         error ?: "RefreshAccessTokenError";
//     }
// }


// export const authConfig : NextAuthOptions = {
//     providers : [
//         GoogleProvider({
//             clientId : env.GOOGLE_CLIENT_ID,
//             clientSecret : env.GOOGLE_CLIENT_SECRET,
//             authorization:{
//                 params : {
//                     // request all scopes needed for Gmail + calendar
//                     scope :[
//                         "openid",
//                         "email",
//                         "profile",
//                         "https://www.googleapis.com/auth/gmail.modify",
//                         "https://www.googleapis.com/auth/gmail.send",
//                         "https://www.googleapis.com/auth/gmail.compose",
//                         "https://www.googleapis.com/auth/calendar",
//                     ].join(" "),
//                     // force refresh token on first auth
//                     access_type:"offline",
//                     // only prompt if no refresh token stored
//                     prompt:"consent"
//                 },
//             },
//         }),
//     ],

//     session : {strategy : "jwt"},

//     callbacks : {
//         async jwt({token,account,user}) {
//             // Initail sign-in : store token from google
//             if(account && user){
//                 logger.info("New Oauth sign-in" , {userId : user.id});
//                 return {
//                     ...token,
//                     dbUserId : (user as any).dbUserId,
//                     googleSub : user.id,
//                     accessToken : account.access_token,
//                     refreshToken: account.refresh_token,
//                     accessTokenExpires : account.expires_at ? account.expires_at * 1000 : undefined
//                 };
//             }

//             // Token still valid
//             if(token.accessTokenExpires && Date.now() < token.accessTokenExpires){
//                 return token;
//             }

//             // Access token expired — Corsair handles refresh automatically via stored
//             // refresh token, so we just flag the client here
//             // NOTE: Corsair will refresh on each API call using the stored refresh token 

//             logger.debug("Access token expired - corsair will refresh on next API call");
//             return {...token,error : "RefreshAccessTokenError" as const}
//         },

//         async session({session,token}) {
//             if(token.dbUserId){
//                 session.user.id = token.dbUserId;
//             }

//             if(token.googleSub){
//                 session.user.googleSub = token.googleSub;
//             }

//             // console.log("SESSION USER", session.user);

//             if(token.error){
//                 session.error = token.error;
//             }

//             return session;
//         }
//     },

//     pages : {
//         signIn : "/login",
//         error : "/login"
//     },

//     events : {
//         async signIn({user}) {
//             logger.info("User signed in",{userId : user.id,email : user.email});
//         },
//         async signOut({token}) {
//             logger.info("User signed out" ,{userId : token?.sub})
//         },
//     },

//     debug : process.env.NODE_ENV === "development"
// }

import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { env } from "../env";
import { logger } from "../lib/logger";
import { db } from "@/src/server/db";
import { users } from "@/src/server/db/schema";
import { eq } from "drizzle-orm";

// ─── NextAuth type augmentations ─────────────────────────────────────────────

declare module "next-auth" {
  interface Session {
    user: {
      id: string;        // DB UUID
      googleSub: string; // Google User ID
      email: string;
      name?: string | null;
      image?: string | null;
    };
    accessToken?: string;
    error?: "RefreshAccessTokenError";
  }

  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;
    dbUserId?: string;
    googleSub?: string;
    email: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: "RefreshAccessTokenError";
  }
}

// ─── Auth config ──────────────────────────────────────────────────────────────

export const authConfig: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.compose",
            "https://www.googleapis.com/auth/calendar",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    // ── JWT callback ──────────────────────────────────────────────────────
    // NextAuth passes a single destructured params object — NOT three
    // separate arguments. The old code had `jwt(token, account, user)`
    // which caused all the TS errors.
    async jwt({ token, account, user }) {
      // Initial sign-in: store Google OAuth data in the token.
      if (account && user) {
        logger.info("New OAuth sign-in", { userId: user.id });
        return {
          ...token,
          // dbUserId is attached to `user` by the signIn callback in
          // [...nextauth]/route.ts before this jwt callback fires.
          dbUserId: (user as unknown as Record<string, unknown>).dbUserId as string | undefined,
          googleSub: user.id,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at
            ? account.expires_at * 1000
            : undefined,
        };
      }

      // Bug 7 fix: if googleSub is present but dbUserId is missing (e.g.
      // getOrCreateUser threw on first sign-in), backfill from DB by email.
      if (token.googleSub && !token.dbUserId && token.email) {
        try {
          const rows = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, token.email))
            .limit(1);

          if (rows[0]) {
            token = { ...token, dbUserId: rows[0].id };
            logger.info("JWT: backfilled missing dbUserId from DB", {
              googleSub: token.googleSub,
            });
          }
        } catch (err) {
          logger.warn("JWT: dbUserId backfill query failed", {
            error: String(err),
          });
          // Non-fatal — wrong ID until re-auth, but don't crash.
        }
      }

      // Token still valid — return as-is.
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // Access token expired. Corsair refreshes on each API call via the
      // stored refresh token. Flag the client so withAuth can return a
      // clean 401 instead of letting the request fail inside Corsair.
      logger.debug("Access token expired — Corsair will refresh on next API call");
      return { ...token, error: "RefreshAccessTokenError" as const };
    },

    // ── Session callback ──────────────────────────────────────────────────
    async session({ session, token }) {
      if (token.dbUserId) {
        session.user.id = token.dbUserId;
      }

      if (token.googleSub) {
        session.user.googleSub = token.googleSub;
      }

      if (token.error) {
        session.error = token.error;
      }

      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  events: {
    async signIn({ user }) {
      logger.info("User signed in", { userId: user.id, email: user.email });
    },
    async signOut({ token }) {
      logger.info("User signed out", { userId: token?.sub });
    },
  },

  debug: process.env.NODE_ENV === "development",
};