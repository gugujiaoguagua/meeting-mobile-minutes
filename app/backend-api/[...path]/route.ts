const BACKEND_BASE_URL = (process.env.MEETING_BACKEND_BASE_URL || "https://api.shayuguagua.dpdns.org").replace(/\/+$/, "");

const RESPONSE_HEADERS_TO_DROP = new Set(["connection", "content-encoding", "content-length", "keep-alive", "transfer-encoding"]);

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
  const sourceHeaders = request.headers;
  const requestHeaders = new Headers();

  for (const headerName of ["accept", "authorization", "content-type", "cookie"]) {
    const headerValue = sourceHeaders.get(headerName);
    if (headerValue) requestHeaders.set(headerName, headerValue);
  }
  requestHeaders.set("user-agent", "meeting-mobile-minutes-cloudflare-proxy");

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

  for (const headerName of RESPONSE_HEADERS_TO_DROP) responseHeaders.delete(headerName);
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
