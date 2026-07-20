const SOURCE = "https://xiamen-tax-assistant.w2350370952.chatgpt.site/api/courses";

export default async function onRequest() {
  try {
    const response = await fetch(SOURCE, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`source ${response.status}`);
    return new Response(await response.text(), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  } catch {
    return Response.json({ error: "课程数据暂时无法同步" }, { status: 502 });
  }
}
