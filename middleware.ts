import { NextResponse, type NextRequest } from 'next/server';

const PREVIEW_READ_ONLY = process.env.VERCEL_ENV === 'preview';
const AUTH_API_PREFIX = '/api/auth';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function middleware(request: NextRequest) {
  if (!PREVIEW_READ_ONLY || !MUTATING_METHODS.has(request.method.toUpperCase())) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith(AUTH_API_PREFIX)) return NextResponse.next();
  return NextResponse.json(
    { error: 'Este Preview está em modo somente leitura; alterações ficam desabilitadas.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const config = { matcher: ['/api/:path*'] };
