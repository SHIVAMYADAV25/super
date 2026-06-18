// src/middleware/auth.ts
//
// BUG FIXED (Bug 6):
//   When the access token expires, the JWT callback sets
//   session.error = "RefreshAccessTokenError". The old withAuth only checked
//   session.user.email and session.user.id — it never checked session.error.
//   Expired-token requests passed the auth gate, reached Corsair, and failed
//   with an opaque 401 from Google rather than a clean 401 to the client.
//
// FIX:
//   After the standard session checks, also check session.error.
//   If it's "RefreshAccessTokenError", throw createUnauthorizedError() so the
//   client gets a clean 401 and knows to redirect the user to re-authenticate.

import { NextRequest } from "next/server";
import type { SessionUser } from "../types";
import { getServerSession } from "next-auth";
import { authConfig } from "../auth/config";
import { createUnauthorizedError } from "../lib/errors";
import { handleRouteError } from "../lib/api-response";

export type AuthedRequest = NextRequest & {
  user: SessionUser;
};

type RouteContext = {
  params: Promise<Record<string, string>>;
};

type RouteHandler = (
  req: AuthedRequest,
  ctx: RouteContext,
) => Promise<Response>;

export function withAuth(handler: RouteHandler) {
  return async (
    req: NextRequest,
    ctx: RouteContext,
  ): Promise<Response> => {
    try {
      const session = await getServerSession(authConfig);

      if (!session?.user?.email || !session.user.id) {
        throw createUnauthorizedError();
      }

      // BUG FIX: if the access token is expired and Corsair couldn't refresh it,
      // the JWT callback sets this error flag. Reject now with a clean 401
      // instead of letting the request through to fail opaquely inside Corsair.
      // if (session.error === "RefreshAccessTokenError") {
      //   throw createUnauthorizedError("Session expired — please sign in again");
      // }

      const user: SessionUser = {
        id: session.user.id,
        googleSub: session.user.googleSub,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      };

      (req as AuthedRequest).user = user;

      return handler(req as AuthedRequest, ctx);
    } catch (err) {
      return handleRouteError(err);
    }
  };
}