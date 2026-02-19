/**
 * 流式渲染 Demo 页
 *
 * 技术：Next.js App Router + React 18 Suspense + 异步 Server Component
 * - loading.tsx 先流式输出（秒开骨架屏）
 * - 各 Suspense 边界按 resolve 顺序逐步流式输出 HTML
 * - 底层由 renderToPipeableStream（Node）或 renderToReadableStream（Edge）实现
 */
import { Suspense } from "react";

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 模拟慢速数据：200ms — 核心介绍 */
async function BlockIntro() {
  await delay(200);
  return (
    <div className="stream-card stream-card-highlight">
      <h3>🚀 流式 SSR 核心原理</h3>
      <p>
        React 18 引入 renderToPipeableStream（Node）和 renderToReadableStream（Edge），
        支持将 HTML 分块逐步推送到客户端。配合 Suspense，慢数据不会阻塞首屏，
        用户可立即看到骨架或已有内容，其余部分异步填充。
      </p>
    </div>
  );
}

/** 300ms — 数据统计 */
async function BlockStats() {
  await delay(300);
  return (
    <div className="stream-card">
      <h3>📊 性能指标</h3>
      <div className="stream-stats">
        <div className="stream-stat">
          <span className="stream-stat-value">~200ms</span>
          <span className="stream-stat-label">TTFB</span>
        </div>
        <div className="stream-stat">
          <span className="stream-stat-value">~500ms</span>
          <span className="stream-stat-label">LCP</span>
        </div>
        <div className="stream-stat">
          <span className="stream-stat-value">渐进</span>
          <span className="stream-stat-label">FCP</span>
        </div>
        <div className="stream-stat">
          <span className="stream-stat-value">分块</span>
          <span className="stream-stat-label">传输</span>
        </div>
      </div>
    </div>
  );
}

/** 400ms — 特性列表 */
async function BlockFeatures() {
  await delay(400);
  const items = [
    "Suspense 边界独立 resolve，互不阻塞",
    "loading.tsx 路由级 fallback，秒开骨架",
    "选择性 Hydration，交互更快",
    "降级 SEO，流式不影响爬虫",
  ];
  return (
    <div className="stream-card">
      <h3>✨ 技术特性</h3>
      <ul className="stream-list">
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

/** 500ms — 代码示例 */
async function BlockCode() {
  await delay(500);
  const code = `<Suspense fallback={<Skeleton />}>
  <AsyncDataBlock />
</Suspense>`;
  return (
    <div className="stream-card stream-card-code">
      <h3>💻 使用方式</h3>
      <pre className="stream-pre">{code}</pre>
      <p className="stream-code-desc">
        异步 Server Component 包裹在 Suspense 中，fallback 先流式输出，数据就绪后替换。
      </p>
    </div>
  );
}

/** 600ms — 时间线 */
async function BlockTimeline() {
  await delay(600);
  const steps = [
    { t: "0ms", label: "请求发出，loading 骨架流式输出" },
    { t: "200ms", label: "首块 Async 数据 resolve，流式推送" },
    { t: "400ms", label: "后续块按顺序逐步填充" },
    { t: "800ms", label: "页面完整呈现" },
  ];
  return (
    <div className="stream-card">
      <h3>⏱ 渲染时间线</h3>
      <div className="stream-timeline">
        {steps.map((s, i) => (
          <div key={i} className="stream-timeline-item">
            <span className="stream-timeline-time">{s.t}</span>
            <span className="stream-timeline-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 700ms — 对比说明 */
async function BlockCompare() {
  await delay(700);
  return (
    <div className="stream-card stream-card-compare">
      <h3>🔄 与传统 SSR 对比</h3>
      <div className="stream-compare-grid">
        <div className="stream-compare-item">
          <strong>传统 SSR</strong>
          <p>等待所有数据后一次性返回，慢接口会拖累整个 TTFB。</p>
        </div>
        <div className="stream-compare-item">
          <strong>流式 SSR</strong>
          <p>HTML 分块发送，首屏秒开，慢数据异步补充，TTFB 显著降低。</p>
        </div>
      </div>
    </div>
  );
}

/** 850ms — 适用场景 */
async function BlockUseCases() {
  await delay(850);
  const cases = [
    { icon: "📄", title: "内容页", desc: "文章、详情页，慢 CMS 数据不影响首屏" },
    { icon: "🛒", title: "电商", desc: "主内容优先，评论、推荐异步加载" },
    { icon: "📊", title: "仪表盘", desc: "核心图表先展示，次要模块后加载" },
    { icon: "🔍", title: "搜索", desc: "结果分块返回，提升感知速度" },
  ];
  return (
    <div className="stream-card">
      <h3>🎯 适用场景</h3>
      <div className="stream-usecases">
        {cases.map((c, i) => (
          <div key={i} className="stream-usecase">
            <span className="stream-usecase-icon">{c.icon}</span>
            <div>
              <strong>{c.title}</strong>
              <p>{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 1000ms — 总结 */
async function BlockSummary() {
  await delay(1000);
  return (
    <div className="stream-card stream-card-highlight">
      <h3>✅ 小结</h3>
      <p>
        流式渲染通过 renderToPipeableStream + Suspense，实现 HTML 的渐进式推送。
        用户可在 200ms 内看到首屏骨架，完整内容在约 1 秒内逐步呈现，
        有效提升 LCP、FCP 等核心 Web 指标，适合对首屏速度要求高的场景。
      </p>
    </div>
  );
}

function BlockSkeleton() {
  return (
    <div className="stream-block">
      <div className="stream-skeleton stream-skeleton-block" />
      <div className="stream-skeleton stream-skeleton-line" />
      <div className="stream-skeleton stream-skeleton-line" style={{ width: "85%" }} />
    </div>
  );
}

export default function StreamPage() {
  return (
    <main className="stream-page">
      <header className="stream-header">
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          🔄 流式 SSR Demo
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          React 18 renderToPipeableStream · 逐步发送 HTML · 秒开首屏
        </p>
      </header>

      <div className="stream-content">
        <Suspense fallback={<BlockSkeleton />}>
          <BlockIntro />
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <BlockStats />
        </Suspense>
        <div className="stream-grid">
          <Suspense fallback={<BlockSkeleton />}>
            <BlockFeatures />
          </Suspense>
          <Suspense fallback={<BlockSkeleton />}>
            <BlockCode />
          </Suspense>
        </div>
        <Suspense fallback={<BlockSkeleton />}>
          <BlockTimeline />
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <BlockCompare />
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <BlockUseCases />
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <BlockSummary />
        </Suspense>
      </div>
    </main>
  );
}
