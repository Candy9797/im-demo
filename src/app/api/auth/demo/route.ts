/**
 * 访客登录 API 代理
 *
 * 转发到 IM 后端 /api/auth/demo，返回 demo token。避免 CORS，支持前后端分离部署
 */
const BACKEND = process.env.IM_API_URL || "http://127.0.0.1:3001";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${BACKEND}/api/auth/demo`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json(data, { status: res.status });
    }
    return Response.json(data);
  } catch (e) {
    clearTimeout(timeout);
    console.error("[api/auth/demo]", e);
    const err = e instanceof Error ? e : new Error(String(e));
    const isTimeout = err.name === "AbortError";
    const isRefused =
      "cause" in err &&
      err.cause instanceof Error &&
      (err.cause as NodeJS.ErrnoException).code === "ECONNREFUSED";
    const message = isTimeout
      ? "连接超时，请确认 IM 后端 (3001) 已启动"
      : isRefused
        ? "IM 后端 (127.0.0.1:3001) 未启动，请执行 pnpm run dev 同时启动前后端"
        : "IM 后端未启动。请执行 pnpm run dev（同时启动前端 3000 + 后端 3001）";
    return Response.json({ error: message }, { status: 502 });
  }
}
