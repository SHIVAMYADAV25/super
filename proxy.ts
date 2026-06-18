import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";


// Routes that don't require authentication
const PUBLIC_PATHS = [
    "/",
  "/login",
  "/api/auth",        // NextAuth routes
  "/api/health",      // Health check
  "/api/webhooks",    // Corsair webhooks (signature-verified separately)
  "/api/auth/oauth-callback", // OAuth callback
  "/_next",           // Next.js internal
  "/favicon",
];

function isPublicPath(pathname : string):boolean{
    return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function proxy(req:NextRequest) {
    console.log("PROXY:", req.nextUrl.pathname);
    const {pathname} = req.nextUrl;

    // Allow public paths
    if (isPublicPath(pathname)) {
        return NextResponse.next();
    }

    // Check for valid session token

    const token = await getToken({
        req,
        secret : process.env.NEXTAUTH_SECRET
    });

    if(!token){
        // API routes return 401 JSON
        if(pathname.startsWith("/api/")){
            return NextResponse.json(
                { ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
                { status: 401 },
            )
        }

        // UI routes redirect to login
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};