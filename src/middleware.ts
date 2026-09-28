import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

const DEVOPS_ONLY_PREFIXES = ["/admin", "/api/connections", "/api/kill-command"];
// Admin-only is a stricter subset of DEVOPS_ONLY — creating accounts and
// resetting someone else's MFA is deliberately narrower than DB Machines.
const ADMIN_ONLY_PREFIXES = ["/admin/users", "/api/users"];

// Routes reachable WITHOUT a full session cookie, because they authenticate
// some other way: a password-only login step, a short-lived pending-MFA
// cookie (checked inside the route/page itself — see src/lib/session.ts
// getPendingSession), or a one-time token emailed to the user (invite /
// MFA lost-device recovery). Exact matches for fixed paths, prefixes for
// paths with a dynamic [token] segment.
const PUBLIC_EXACT_PATHS = [
  "/login",
  "/api/auth/login",
  "/mfa/verify",
  "/api/auth/mfa-verify",
  "/mfa/setup",
  "/api/mfa/setup",
  "/api/mfa/setup/confirm",
  "/mfa/recovery",
  "/api/mfa/recovery-request",
];
const PUBLIC_PREFIXES = ["/invite/", "/api/invite/", "/mfa/recovery/", "/api/mfa/recovery/"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const requiresAdmin = ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
  if (requiresAdmin && session.role !== "ADMIN") {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  }

  const requiresDevops = DEVOPS_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
  if (requiresDevops && session.role === "DEVELOPER") {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Forbidden: DevOps/Admin role required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard?denied=1", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
