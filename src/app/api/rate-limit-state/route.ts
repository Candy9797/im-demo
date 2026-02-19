/**
 * 限流状态 API 代理
 *
 * 转发到 IM 后端 /api/rate-limit-state。同源请求可避免扩展 SW 拦截导致的 Failed to fetch
 */
const BACKEND = process.env.IM_API_URL || "http://127.0.0.1:3001";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/rate-limit-state`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json(data, { status: res.status });
    return Response.json(data);
  } catch {
    return Response.json({}, { status: 200 });
  }
}
