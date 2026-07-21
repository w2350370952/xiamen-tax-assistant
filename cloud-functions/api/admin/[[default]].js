const ORIGIN = "https://xiamen-tax-assistant.w2350370952.chatgpt.site";

export default async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, ORIGIN);

  try {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.set("accept-encoding", "identity");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", "no-store, private");

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Admin proxy failed", error);
    return Response.json(
      { error: "管理员服务连接失败，请稍后重试" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
