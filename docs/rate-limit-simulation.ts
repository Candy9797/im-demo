/**
 * 滑动窗口限流 - 高 QPS 场景模拟
 *
 * 运行: npx ts-node docs/rate-limit-simulation.ts
 * 或: npx tsx docs/rate-limit-simulation.ts
 */

const RATE_LIMIT_MSGS_PER_SEC = 20;
const RATE_WINDOW_MS = 1000;

const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string, now: number): boolean {
  let timestamps = rateLimitMap.get(userId);
  if (!timestamps) {
    rateLimitMap.set(userId, [now]);
    return true;
  }
  timestamps = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MSGS_PER_SEC) return false;
  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return true;
}

function simulate(userId: string, baseTime: number, msgsPer100ms: number, durationMs: number) {
  rateLimitMap.clear();
  const results: { t: number; allowed: boolean; count: number }[] = [];
  let sent = 0;

  for (let t = 0; t < durationMs; t += 100) {
    for (let i = 0; i < msgsPer100ms; i++) {
      const now = baseTime + t;
      const allowed = checkRateLimit(userId, now);
      if (allowed) sent++;
      results.push({ t, allowed, count: (rateLimitMap.get(userId) ?? []).length });
    }
  }

  return { results, sent, totalAttempts: results.length };
}

// ============ 场景 1：30 条消息在 1.5 秒内以每 50ms 一条发送 ============
console.log("======== 场景 1：高 QPS，30 条 / 1.5s（每 50ms 一条）=========\n");

const baseTime = 1000000; // 基准时间戳
rateLimitMap.clear();

const timestamps: number[] = [];
for (let i = 0; i < 30; i++) {
  const now = baseTime + i * 50;
  const allowed = checkRateLimit("user-A", now);
  timestamps.push(now);
  const inWindow = (rateLimitMap.get("user-A") ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  console.log(
    `msg ${i + 1}: t=${now - baseTime}ms, allowed=${allowed}, 窗口内条数=${inWindow.length}, rateLimitMap结构=`,
    JSON.stringify(inWindow.map((t) => t - baseTime))
  );
}

console.log("\n--- rateLimitMap 最终结构（user-A）---");
console.log("key: userId = 'user-A'");
console.log(
  "value:",
  (rateLimitMap.get("user-A") ?? []).map((t) => t - baseTime)
);
console.log("含义: 每个数字表示一次成功发送时的时间戳（相对于 baseTime 的 ms）");

// ============ 场景 2：前 20 条通过，后 10 条被拒绝 ============
console.log("\n\n======== 场景 2：1 秒内连发 25 条（前 20 过，后 5 拒）=========\n");

rateLimitMap.clear();
let allowedCount = 0;
for (let i = 0; i < 25; i++) {
  const now = baseTime + i * 40; // 每 40ms 一条，1s 内约 25 条
  const allowed = checkRateLimit("user-B", now);
  if (allowed) allowedCount++;
  const inWindow = (rateLimitMap.get("user-B") ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  console.log(`msg ${i + 1}: t=${now - baseTime}ms, allowed=${allowed}, 窗口内=${inWindow.length}`);
}
console.log(`\n结果: 25 次尝试中通过 ${allowedCount} 次，拒绝 ${25 - allowedCount} 次`);

// ============ 场景 3：滑动窗口演示（1s 后旧数据滑出）===========
console.log("\n\n======== 场景 3：滑动窗口 - 1s 后旧消息滑出，又可发 20 条 =========\n");

rateLimitMap.clear();
// 先在 0~800ms 发 20 条
for (let i = 0; i < 20; i++) {
  checkRateLimit("user-C", baseTime + i * 40);
}
console.log("0~800ms 发了 20 条");
console.log("1000ms 时再发 1 条:", checkRateLimit("user-C", baseTime + 1000)); // 第 0 条已滑出窗口
console.log("再发 20 条:");
for (let i = 0; i < 20; i++) {
  const ok = checkRateLimit("user-C", baseTime + 1000 + i * 10);
  console.log(`  msg ${i + 1}: allowed=${ok}`);
}
