import { NextRequest } from "next/server";
import { SessionUser } from "../types";
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
  ctx: RouteContext
) => Promise<Response>;

export function withAuth(handler: RouteHandler) {
  return async (
    req: NextRequest,
    ctx: RouteContext
  ): Promise<Response> => {
    try {
      const session = await getServerSession(authConfig);

      if (!session?.user?.email || !session.user.id) {
        throw createUnauthorizedError();
      }

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