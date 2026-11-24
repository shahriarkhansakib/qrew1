import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:8787';

const FORWARDED_REQUEST_HEADERS = [
  'cookie',
  'content-type',
  'accept',
  'origin',
  'referer',
  'user-agent',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-request-id',
  'x-qrew-rsc-prefetch',
] as const;

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

async function proxyRequest(request: NextRequest): Promise<NextResponse> {
  const upstreamUrl = `${API_INTERNAL_URL}${request.nextUrl.pathname}${request.nextUrl.search}`;

  const forwardHeaders = new Headers();
  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(headerName);
    if (value !== null) {
      forwardHeaders.set(headerName, value);
    }
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawBody = await request.arrayBuffer();
    if (rawBody.byteLength > 0) {
      body = rawBody;
    }
  }

  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  for (const setCookieHeader of upstreamRes.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', setCookieHeader);
  }

  const responseBody =
    request.method === 'HEAD' || NULL_BODY_STATUSES.has(upstreamRes.status)
      ? null
      : upstreamRes.body;

  return new NextResponse(responseBody, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return proxyRequest(request);
}
