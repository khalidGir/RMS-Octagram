import { NextResponse, type NextRequest } from 'next/server';

// Canonical trailing-slash policy for customer PWA routes (ADR-030).
//
// The installed-app scope is the slash-terminated path /r/{slug}/ so W3C
// appmanifest §5 prefix matching cannot pull /r/{slug}-annex into the same
// installed app. §1.6 requires start_url to be within scope, so the launch
// URL must carry the slash too — but Next's default trailing-slash redirect
// would 308 it back to the bare form, an out-of-scope document that drops
// the installed manifest on open. `skipTrailingSlashRedirect` in
// next.config.js disables that built-in rule; this middleware restores
// canonicalization for every other route and inverts it for bare restaurant
// roots. Both rules are single-form, so no input can loop:
//   /r/x          -> /r/x/     (already canonical, stop)
//   /r/x/         -> unchanged
//   /login/       -> /login    (previous Next behavior, stop)
const RESTAURANT_ROOT = /^\/r\/[^/]+$/;
const RESTAURANT_ROOT_CANONICAL = /^\/r\/[^/]+\/$/;

/** Returns the canonical path to redirect to, or null to serve as-is. */
export function trailingSlashRedirect(pathname: string): string | null {
  if (pathname === '/') return null;
  if (RESTAURANT_ROOT.test(pathname)) return `${pathname}/`;
  if (pathname.endsWith('/') && !RESTAURANT_ROOT_CANONICAL.test(pathname)) {
    return pathname.slice(0, -1);
  }
  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const target = trailingSlashRedirect(request.nextUrl.pathname);
  if (target === null) return NextResponse.next();
  // Plain WHATWG URL: assigning pathname on a cloned NextURL silently keeps
  // the request's original form, which turns this redirect into a self-loop.
  const url = new URL(request.url);
  url.pathname = target;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ['/((?!_next/).*)'],
};
