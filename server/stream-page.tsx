/**
 * 流式 SSR 页面 - 供 Node renderToPipeableStream 使用
 *
 * 使用 React 19 use() + Suspense 实现数据获取挂起
 * 各 Block 独立 resolve 后逐步流式输出 HTML
 */
import React, { use, useState } from "react";

function delay(ms: number) {
  return new Promise<number>((r) => setTimeout(() => r(1), ms));
}

function createDelayHook(ms: number) {
  return function useDelay() {
    const [p] = useState(() => delay(ms));
    use(p);
  };
}

const use200 = createDelayHook(200);
const use300 = createDelayHook(300);
const use400 = createDelayHook(400);
const use500 = createDelayHook(500);
const use600 = createDelayHook(600);
const use700 = createDelayHook(700);
const use850 = createDelayHook(850);
const use1000 = createDelayHook(1000);

function BlockIntro() {
  use200();
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

function BlockStats() {
  use300();
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

function BlockFeatures() {
  use400();
  const items = [
    "Suspense 边界独立 resolve，互不阻塞",
    "loading.tsx 路由级 fallback，秒开骨架",
    "选择性 Hydration，交互更快",
    "流式不影响 SEO",
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

function BlockCode() {
  use500();
  const code = `<Suspense fallback={<Skeleton />}>
  <AsyncDataBlock />
</Suspense>`;
  return (
    <div className="stream-card stream-card-code">
      <h3>💻 使用方式</h3>
      <pre className="stream-pre">{code}</pre>
      <p className="stream-code-desc">
        异步数据组件包裹在 Suspense 中，fallback 先流式输出，数据就绪后替换。
      </p>
    </div>
  );
}

function BlockTimeline() {
  use600();
  const steps = [
    { t: "0ms", label: "请求发出，shell 流式输出" },
    { t: "200ms", label: "首块 resolve，流式推送" },
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

function BlockCompare() {
  use700();
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

function BlockUseCases() {
  use850();
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

function BlockSummary() {
  use1000();
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

function StreamContent() {
  return (
    <main className="stream-page">
      <header className="stream-header">
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🔄 流式 SSR Demo</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Node renderToPipeableStream · 逐步发送 HTML · 秒开首屏
        </p>
      </header>

      <div className="stream-content">
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockIntro />
        </React.Suspense>
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockStats />
        </React.Suspense>
        <div className="stream-grid">
          <React.Suspense fallback={<BlockSkeleton />}>
            <BlockFeatures />
          </React.Suspense>
          <React.Suspense fallback={<BlockSkeleton />}>
            <BlockCode />
          </React.Suspense>
        </div>
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockTimeline />
        </React.Suspense>
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockCompare />
        </React.Suspense>
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockUseCases />
        </React.Suspense>
        <React.Suspense fallback={<BlockSkeleton />}>
          <BlockSummary />
        </React.Suspense>
      </div>
    </main>
  );
}

const STREAM_CSS = `
:root {
  --bg-primary: #0b0e11;
  --bg-secondary: #1e2329;
  --bg-tertiary: #2b3139;
  --bg-hover: #363c45;
  --brand: #f0b90b;
  --text-primary: #eaecef;
  --text-secondary: #b7bdc6;
  --text-tertiary: #848e9c;
  --border: #2b3139;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; font-family: var(--font-family); background: var(--bg-primary); color: var(--text-primary); }
.stream-page { min-height: 100vh; padding: 2rem; }
.stream-header { margin-bottom: 2rem; }
.stream-content { display: flex; flex-direction: column; gap: 1.5rem; }
.stream-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
.stream-block { padding: 1.25rem; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px solid var(--border); }
.stream-skeleton { background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%); background-size: 200% 100%; animation: stream-shimmer 1.5s infinite; }
.stream-skeleton-block { height: 1.5rem; width: 120px; margin-bottom: 1rem; border-radius: var(--radius-sm); }
.stream-skeleton-line { height: 0.875rem; width: 100%; margin-top: 0.5rem; border-radius: var(--radius-sm); }
@keyframes stream-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.stream-card { padding: 1.25rem; background: var(--bg-secondary); border-radius: var(--radius-lg); border: 1px solid var(--border); }
.stream-card h3 { color: var(--brand); font-size: 1rem; margin-bottom: 0.5rem; }
.stream-card p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; }
.stream-card-highlight { border-color: rgba(240,185,11,0.3); background: linear-gradient(135deg, var(--bg-secondary) 0%, rgba(240,185,11,0.05) 100%); }
.stream-stats { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.75rem; }
.stream-stat { flex: 1; min-width: 80px; padding: 0.75rem 1rem; background: var(--bg-tertiary); border-radius: var(--radius-md); text-align: center; }
.stream-stat-value { display: block; color: var(--brand); font-weight: 600; font-size: 1rem; }
.stream-stat-label { display: block; color: var(--text-tertiary); font-size: 0.75rem; margin-top: 0.25rem; }
.stream-list { color: var(--text-secondary); font-size: 0.9rem; line-height: 2; padding-left: 1.25rem; margin: 0; }
.stream-list li { margin-bottom: 0.25rem; }
.stream-pre { background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; font-size: 0.8rem; color: var(--text-secondary); overflow-x: auto; white-space: pre-wrap; margin: 0.75rem 0; line-height: 1.5; }
.stream-code-desc { margin-top: 0.5rem; font-size: 0.85rem; }
.stream-timeline { margin-top: 0.75rem; }
.stream-timeline-item { display: flex; align-items: baseline; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
.stream-timeline-item:last-child { border-bottom: none; }
.stream-timeline-time { flex-shrink: 0; color: var(--brand); font-weight: 600; font-size: 0.85rem; min-width: 50px; }
.stream-timeline-label { color: var(--text-secondary); font-size: 0.9rem; }
.stream-compare-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.75rem; }
.stream-compare-item { padding: 1rem; background: var(--bg-tertiary); border-radius: var(--radius-md); border: 1px solid var(--border); }
.stream-compare-item strong { color: var(--text-primary); font-size: 0.9rem; }
.stream-compare-item p { margin: 0.5rem 0 0; font-size: 0.85rem; }
.stream-usecases { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 0.75rem; }
.stream-usecase { display: flex; gap: 0.75rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: var(--radius-md); }
.stream-usecase-icon { font-size: 1.5rem; line-height: 1; }
.stream-usecase strong { display: block; color: var(--text-primary); font-size: 0.9rem; }
.stream-usecase p { margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--text-tertiary); }
`;

export function createStreamDocument() {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>流式 SSR Demo - renderToPipeableStream</title>
        <style dangerouslySetInnerHTML={{ __html: STREAM_CSS }} />
      </head>
      <body>
        <div id="root">
          <StreamContent />
        </div>
      </body>
    </html>
  );
}
