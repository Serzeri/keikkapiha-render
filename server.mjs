import http from "node:http";

const upstream = "https://keikka.keikkapiha.workers.dev";
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
  "accept-encoding",
]);

function forwardedHeaders(request) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!hopByHop.has(key)) headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";
  if (request.headers.origin) headers.origin = upstream;
  return headers;
}

function responseHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers) {
    if (!hopByHop.has(key)) headers[key] = value;
  }
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) headers["set-cookie"] = cookies;
  return headers;
}

const server = http.createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? "/", upstream);
    if (target.origin !== upstream) {
      response.writeHead(400).end();
      return;
    }
    const publicOrigin = process.env.RENDER_EXTERNAL_URL || "http://localhost:10000";
    if ((request.headers.origin && request.headers.origin !== publicOrigin) ||
        ["cross-site", "same-site"].includes(request.headers["sec-fetch-site"])) {
      response.writeHead(403).end();
      return;
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstreamResponse = await fetch(target, {
      method: request.method,
      headers: forwardedHeaders(request),
      body: hasBody ? request : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse));
    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body) response.write(chunk);
    }
    response.end();
  } catch (error) {
    console.error("Proxy request failed", error);
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("Keikkapiha ei ole juuri nyt saatavilla.");
  }
});

const port = Number(process.env.PORT || 10000);
server.listen(port, "0.0.0.0", () => console.log(`Keikkapiha proxy listening on ${port}`));
