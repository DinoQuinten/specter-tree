import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // auth check
  return null;
}

export const config = {
  matcher: '/api/:path*'
};
