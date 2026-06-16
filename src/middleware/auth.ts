import { NextRequest, NextResponse } from "next/server";
import { SessionUser } from "../types";
import { getServerSession } from "next-auth";
import { authConfig } from "../auth/config";
import { createUnauthorizedError } from "../lib/errors";
import { handleRouteError } from "../lib/api-response";

// Take NextRequest
// and add a user property
export type AuthedRequest = NextRequest & {user : SessionUser};
// req.url
// req.headers
// req.cookies
// req.user



// What kind of function
// can be wrapped by withAuth?
type RouteHandler = (
  req: AuthedRequest,
  ctx: { params: Record<string, string> }
) => Promise<Response>;

/**
 * Wraps a route handler and injects the authenticated user.
 * Throws 401 if session is missing or invalid.
 *
 * Usage:
 *   export const GET = withAuth(async (req) => {
 *     const { user } = req;
 *     ...
 *   });
 */

export function withAuth(handler:RouteHandler){
    return async (req:NextRequest,ctx : {params : Record <string,string>})=>{
        try{
            const session = await getServerSession(authConfig);

            if(!session?.user?.email || !session.user.id){
                throw createUnauthorizedError();
            }

            const user : SessionUser = {
                id:session.user.id as string,
                googleSub: session.user.googleSub,
                email : session.user.email,
                name : session.user.name,
                image : session.user.image,
            };


            // console.log("AUTH USER", user);
            // Augment request with user
            // This literally adds: user onto the request.
            (req as AuthedRequest).user = user;

            // run the handler
            return await handler(req as AuthedRequest,ctx);
        }catch(err){
            return handleRouteError(err);
        }
    }
}