const ORIGIN = "https://xiamen-tax-assistant.w2350370952.chatgpt.site";

export async function proxyAdmin(request, pathname) {
  try {
    const incoming = new URL(request.url);
    const target = new URL(pathname, ORIGIN);
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.set("accept-encoding", "identity");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "no-store, private");
    responseHeaders.delete("content-length");
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "管理服务暂时无法连接，请稍后重试" }, { status: 502 });
  }
}
