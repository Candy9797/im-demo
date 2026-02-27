/**
 * 传统 SSR 演示：等服务端「全部数据就绪」后一次性返回 HTML
 *
 * 原理：串行 await 所有慢数据（在 Suspense 内），Next 15 要求未缓存数据放在 Suspense 中，
 * 此处 fallback 先出，约 1.5s 后整块内容替换 → 仍可观察「整块延迟」与传统 SSR 的体验。
 *
 * 说明：用 delay(ms) 模拟慢接口，未接真实 API/DB。生产里把 fetchBlockX 换成真实 fetch/DB。
 */
import Link from 'next/link';
import { Suspense } from 'react';
import { BlockHydrationButton } from '../HydrationDemoButton';

/** Mock：模拟慢接口，生产环境替换为 fetch() 或 DB 查询 */
async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mock 慢接口：300ms */
async function fetchBlock1() {
  await delay(300);
  return { title: '区块一', time: '300ms', desc: '传统 SSR 会等此接口完成才继续' };
}

/** Mock 慢接口：500ms */
async function fetchBlock2() {
  await delay(500);
  return { title: '区块二', time: '500ms', desc: '再等此接口，累计 800ms' };
}

/** Mock 慢接口：700ms */
async function fetchBlock3() {
  await delay(700);
  return { title: '区块三', time: '700ms', desc: '再等此接口，累计 1500ms 后才发响应' };
}

const cardBase = {
  padding: '1.25rem 1.5rem',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.04)',
} as const;

/** 串行等待三块数据，用于 Suspense 内（满足 Next 15 blocking-route 要求） */
async function TraditionalSSRContent() {
  const d1 = await fetchBlock1();
  const d2 = await fetchBlock2();
  const d3 = await fetchBlock3();
  const traditionalHint = '传统 SSR：三块 1.5s 后一起到达，注水同时完成，三个按钮同时可点击。';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <section style={{ ...cardBase, background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', borderLeft: '4px solid #22c55e' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#166534' }}>{d1.title}</h3>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#14532d', fontWeight: 500 }}><strong>耗时：</strong>{d1.time}</p>
        <p style={{ color: '#15803d', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{d1.desc}</p>
        <BlockHydrationButton blockLabel="区块一" hint={traditionalHint} />
      </section>
      <section style={{ ...cardBase, background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', borderLeft: '4px solid #6366f1' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#3730a3' }}>{d2.title}</h3>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#312e81', fontWeight: 500 }}><strong>耗时：</strong>{d2.time}</p>
        <p style={{ color: '#4338ca', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{d2.desc}</p>
        <BlockHydrationButton blockLabel="区块二" hint={traditionalHint} />
      </section>
      <section style={{ ...cardBase, background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', borderLeft: '4px solid #f59e0b' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#92400e' }}>{d3.title}</h3>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#78350f', fontWeight: 500 }}><strong>耗时：</strong>{d3.time}</p>
        <p style={{ color: '#b45309', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{d3.desc}</p>
        <BlockHydrationButton blockLabel="区块三" hint={traditionalHint} />
      </section>
    </div>
  );
}

function TraditionalSSRFallback() {
  return (
    <div style={{ padding: '1.5rem 1.5rem', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderRadius: 12, color: '#64748b', border: '1px dashed #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <span style={{ display: 'inline-block', marginRight: 6 }}>⏳</span>
      传统 SSR 模拟：等待 300 + 500 + 700 = 1500ms 中…
    </div>
  );
}

export default function SSRTraditionalPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', color: '#0f172a' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '2rem 2rem 2.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>传统 SSR 演示</h1>
        <p style={{ color: '#64748b', marginBottom: '1.75rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
          本页在服务端串行等待 <strong style={{ color: '#0f172a' }}>300 + 500 + 700 = 1500ms</strong> 全部完成后才渲染下方内容
          （Next 15 要求未缓存数据放在 Suspense 内，先显示 fallback，约 1.5s 后替换为完整内容）。
        </p>

        <Suspense fallback={<TraditionalSSRFallback />}>
          <TraditionalSSRContent />
        </Suspense>

        <nav style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Link href="/demo/ssr-streaming" style={{ display: 'inline-block', padding: '0.5rem 1rem', borderRadius: 8, background: '#2563eb', color: '#fff', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>→ 对比：流式 SSR</Link>
          <Link href="/demo/server-actions" style={{ display: 'inline-block', padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #e2e8f0', color: '#64748b', textDecoration: 'none', fontSize: '0.9rem' }}>Server Actions Demo</Link>
        </nav>
      </div>
    </main>
  );
}
