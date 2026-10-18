import { NextResponse, type NextRequest } from "next/server";

// Optimistic check ONLY: presence of the session cookie. No DB access here; real
// authorization happens in the page guards (src/lib/auth/guards.ts) and requireRole.
// The cookie name is duplicated from lib/auth/session.ts on purpose: importing that
// module would pull next/headers and the DB client into the proxy.
const SESSION_COOKIE = "bh_session";

export function proxy(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: [
    "/caja",
    "/mostrador",
    "/mostrador/:path*",
    "/retiro",
    "/retiro/:path*",
    "/delivery",
    "/delivery/:path*",
    "/despacho",
    "/despacho/:path*",
    "/admin",
    "/admin/:path*",
    "/estacion",
    "/cocina",
    "/cocina/:path*",
  ],
};
