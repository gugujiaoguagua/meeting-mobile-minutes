const BACKEND_BASE_URL = (process.env.MEETING_BACKEND_BASE_URL || "http://124.223.100.178").replace(/\/+$/, "");

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

type ProxyContext = {
  params: Promise<{
    path?: string[];
  }>;
};

function buildTargetUrl(sourceUrl: URL, path: string[]) {
  const encodedPath = path.map((part) => encodeURIComponent(part)).join("/");
  const targetUrl = new URL(`${BACKEND_BASE_URL}/${encodedPath}`);
  targetUrl.search = sourceUrl.search;
  return targetUrl;
}

async function proxyToBackend(request: Request, context: ProxyContext) {
  const { path = [] } = await context.params;
  const sourceUrl = new URL(request.url);
  const targetUrl = buildTargetUrl(sourceUrl, path);
  const requestHeaders = new Headers(request.headers);

  for (const headerName of HOP_BY_HOP_HEADERS) requestHeaders.delete(headerName);
  requestHeaders.delete("accept-encoding");
  requestHeaders.set("x-forwarded-host", sourceUrl.host);
  requestHeaders.set("x-forwarded-proto", sourceUrl.protocol.replace(":", ""));

  const requestInit: RequestInit = {
    method: request.method,
    headers: requestHeaders,
    redirect: "manual"
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.body = await request.arrayBuffer();
  }

  const backendResponse = await fetch(targetUrl, requestInit);
  const responseHeaders = new Headers(backendResponse.headers);

  for (const headerName of HOP_BY_HOP_HEADERS) responseHeaders.delete(headerName);
  responseHeaders.delete("content-encoding");
  responseHeaders.set("cache-control", "no-store");

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders
  });
}

export const dynamic = "force-dynamic";

export const GET = proxyToBackend;
export const POST = proxyToBackend;
export const PUT = proxyToBackend;
export const PATCH = proxyToBackend;
export const DELETE = proxyToBackend;
