/**
 * SIWE nonce API 代理
 * 转发到 IM 后端 /api/auth/nonce，避免 CORS
 */
const BACKEND = process.env.IM_API_URL || "http://127.0.0.1:3001";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${BACKEND}/api/auth/nonce?address=${encodeURIComponent(address)}`, {
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
    console.error("[api/auth/nonce]", e);
    const isTimeout = e instanceof Error && e.name === "AbortError";
    return Response.json(
      {
        error: isTimeout
          ? "连接超时，请确认 IM 后端 (3001) 已启动"
          : "IM 后端未启动。请执行 npm run dev（同时启动前端 3000 + 后端 3001）",
      },
      { status: 502 }
    );
  }
}
