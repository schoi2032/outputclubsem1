import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC = [
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/invite',
  '/check-email',
  // Meeting guest links (people without an account).
  '/join',
  // The Output Club homepage (public/landing) and public site pages.
  '/landing',
  '/welcome',
  '/terms',
  '/privacy',
  '/developers',
  '/changelog',
]

const LANDING = '/landing/index.html'

/** Cheap gate: send visitors without a session cookie to sign-in. The API is the real authority. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  // The WickyChat homepage, always viewable at /welcome.
  if (pathname === '/welcome') return NextResponse.rewrite(new URL(LANDING, req.url))
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next()
  if (!req.cookies.has('quid_session')) {
    // Signed-out visitors see the homepage at the root.
    if (pathname === '/') return NextResponse.rewrite(new URL(LANDING, req.url))
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next|\\.well-known|icon.svg|favicon.ico|robots.txt).*)'],
}
