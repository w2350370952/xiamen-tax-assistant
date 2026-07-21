const ORIGIN = "https://xiamen-tax-assistant.w2350370952.chatgpt.site";

function upstreamHeaders(request) {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const cookie = request.headers.get("cookie");
  const acceptLanguage = request.headers.get("accept-language");

  headers.set("accept", "application/json");
  headers.set("accept-encoding", "identity");
  headers.set("origin", ORIGIN);
  headers.set("referer", `${ORIGIN}/`);
  headers.set("user-agent", "Mozilla/5.0 XiamenTaxAssistant/1.0");
  if (contentType) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);
  return headers;
}

function upstreamError(status, body) {
  const title = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const hint = title && !/error|forbidden/i.test(title) ? `：${title}` : "";
  return Response.json(
    { error: `原课程服务拒绝了请求（HTTP ${status}）${hint}` },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export default async function onRequest({ request }) {
  const incoming = new URL(request.url);

  if (incoming.pathname === "/api/admin/health") {
    return Response.json(
      { ok: true, service: "edgeone-admin-proxy" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const target = new URL(`${incoming.pathname}${incoming.search}`, ORIGIN);

  try {
    const init = {
      method: request.method,
      headers: upstreamHeaders(request),
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const responseHeaders = new Headers(upstream.headers);
    const contentType = responseHeaders.get("content-type") || "";

    if (!upstream.ok && !contentType.includes("application/json")) {
      return upstreamError(upstream.status, new TextDecoder().decode(body).slice(0, 1000));
    }

    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", "no-store, private");

    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Admin proxy failed", error);
    return Response.json(
      { error: "EdgeOne 无法连接原课程服务，请稍后重试" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
