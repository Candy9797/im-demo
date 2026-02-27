/**
 * 流式 SSR 演示：先发 HTML 壳 + 骨架，各区块就绪后「分块」推送到浏览器
 *
 * 原理：每个区块包在 Suspense 里，async 子组件独立 resolve；
 * Next 先流式输出 loading.tsx（骨架），再按 resolve 顺序流式输出各区块 HTML。
 * TTFB 低（很快收到首字节），FCP/LCP 渐进提升。
 *
 * 说明：本页用 delay(ms) 模拟慢接口，未接真实 API/DB。流式行为由 Next.js + React
 * （底层 renderToPipeableStream / Suspense）实现；生产里把 delay 换成 fetch/DB 即可。
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { BlockHydrationButton } from '../HydrationDemoButton';

/** Mock：模拟慢接口，生产环境替换为 fetch() 或 DB 查询 */
async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const cardBase = {
  padding: '1.25rem 1.5rem',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.04)',
} as const;

async function Block1() {
  await delay(300);
  return (
    <section style={{ ...cardBase, background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', borderLeft: '4px solid #22c55e' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#166534' }}>区块一</h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#14532d', fontWeight: 500 }}><strong>耗时：</strong>300ms</p>
      <p style={{ color: '#15803d', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>此块 resolve 后立即流式推送，不等其他块。</p>
      <BlockHydrationButton blockLabel="区块一" hint="流式更好：此块约 300ms 即到达，可先于区块二、三注水，更早可点击。" />
    </section>
  );
}

async function Block2() {
  await delay(500);
  return (
    <section style={{ ...cardBase, background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', borderLeft: '4px solid #6366f1' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#3730a3' }}>区块二</h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#312e81', fontWeight: 500 }}><strong>耗时：</strong>500ms</p>
      <p style={{ color: '#4338ca', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>独立 Suspense 边界，500ms 时推送到客户端。</p>
      <BlockHydrationButton blockLabel="区块二" hint="流式更好：此块约 500ms 到达，可先于区块三注水，比传统 SSR 更早可点击。" />
    </section>
  );
}

async function Block3() {
  await delay(700);
  return (
    <section style={{ ...cardBase, background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', borderLeft: '4px solid #f59e0b' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600, color: '#92400e' }}>区块三</h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#78350f', fontWeight: 500 }}><strong>耗时：</strong>700ms</p>
      <p style={{ color: '#b45309', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>最慢的块也不阻塞前面内容，用户已看到 1、2。</p>
      <BlockHydrationButton blockLabel="区块三" hint="流式更好：先到的块先注水、先可点击，不必等整页 1.5s。" />
    </section>
  );
}

function BlockSkeleton() {
  return (
    <div
      style={{
        padding: '1.25rem 1.5rem',
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        borderRadius: 12,
        height: 100,
        border: '1px dashed #cbd5e1',
      }}
    />
  );
}

export default function SSRStreamingPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', color: '#0f172a' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '2rem 2rem 2.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>流式 SSR 演示</h1>
        <p style={{ color: '#64748b', marginBottom: '1.75rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
          本页先流式输出骨架（loading），再按 <strong style={{ color: '#0f172a' }}>300ms / 500ms / 700ms</strong> 分块推送各区块 HTML，
          TTFB 低，用户很快看到首屏，内容渐进呈现。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Suspense fallback={<BlockSkeleton />}>
            <Block1 />
          </Suspense>
          <Suspense fallback={<BlockSkeleton />}>
            <Block2 />
          </Suspense>
          <Suspense fallback={<BlockSkeleton />}>
            <Block3 />
          </Suspense>
        </div>

        <nav style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Link href="/demo/ssr-traditional" style={{ display: 'inline-block', padding: '0.5rem 1rem', borderRadius: 8, background: '#2563eb', color: '#fff', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>→ 对比：传统 SSR</Link>
          <Link href="/demo/server-actions" style={{ display: 'inline-block', padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #e2e8f0', color: '#64748b', textDecoration: 'none', fontSize: '0.9rem' }}>Server Actions Demo</Link>
        </nav>
      </div>
    </main>
  );
}
