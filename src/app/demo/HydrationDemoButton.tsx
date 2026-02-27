'use client';

/**
 * 注水演示：每个区块一个按钮，用于对比「传统 SSR 三块同时注水」vs「流式 SSR 先到的块先注水、先可点击」。
 */
import { useState } from 'react';

export type BlockHydrationButtonProps = {
  blockLabel: string;
  hint: string;
};

export function BlockHydrationButton({ blockLabel, hint }: BlockHydrationButtonProps) {
  const [count, setCount] = useState(0);
  const [firstClickAt, setFirstClickAt] = useState<number | null>(null);

  const handleClick = () => {
    if (firstClickAt === null) setFirstClickAt(Date.now());
    setCount((c) => c + 1);
  };

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.75rem 1rem',
        background: 'rgba(255,255,255,0.6)',
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.35rem' }}>{blockLabel} · 注水测试</div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>{hint}</p>
      <button
        type="button"
        onClick={handleClick}
        style={{
          padding: '0.4rem 0.75rem',
          borderRadius: 6,
          border: '1px solid #0ea5e9',
          background: '#0284c7',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        点击测试注水
      </button>
      {(count > 0 || firstClickAt !== null) && (
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#0369a1' }}>
          {firstClickAt !== null && <>首次可点击：{new Date(firstClickAt).toLocaleTimeString()}</>}
          {count > 0 && <> · 点击 {count} 次</>}
        </p>
      )}
    </div>
  );
}

/** 兼容旧用法：整页一个按钮（可选保留） */
export function HydrationDemoButton({ label = '注水测试' }: { label?: string }) {
  return (
    <BlockHydrationButton
      blockLabel={label}
      hint="此区域在客户端注水后变为可交互，点击下方按钮可验证。"
    />
  );
}
