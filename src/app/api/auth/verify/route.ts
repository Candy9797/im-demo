/**
 * SIWE verify API 代理
 * 转发到 IM 后端 /api/auth/verify，避免 CORS
 */
const BACKEND = process.env.IM_API_URL || "http://127.0.0.1:3001";

export async function POST(req: Request) {
  let body: { message?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, signature } = body;
  if (!message || !signature) {
    return Response.json(
      { error: "Missing message or signature" },
      { status: 400 },
    );
  }

  // 合并「前端取消」与「8 秒超时」：任一触发都会中止对后端的 fetch
  if (req.signal.aborted) {
    return Response.json({ error: "Request aborted" }, { status: 499 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  req.signal.addEventListener("abort", () => {
    clearTimeout(timeout);
    controller.abort();
  });

  try {
    const res = await fetch(`${BACKEND}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json(data, { status: res.status });
    }
    return Response.json(data);
  } catch (e) {
    clearTimeout(timeout);
    console.error("[api/auth/verify]", e);
    const isTimeout = e instanceof Error && e.name === "AbortError";
    return Response.json(
      {
        error: isTimeout
          ? "连接超时，请确认 IM 后端 (3001) 已启动"
          : "IM 后端未启动。请执行 npm run dev（同时启动前端 3000 + 后端 3001）",
      },
      { status: 502 },
    );
  }
}
