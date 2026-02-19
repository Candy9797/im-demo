'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCartStore } from '@/stores/cartStore';

export default function CheckoutPage() {
  const router = useRouter();
  const { items, totalAmount, clear } = useCartStore();
  const [submitting, setSubmitting] = useState(false);
  const [ordered, setOrdered] = useState(false);

  if (items.length === 0 && !ordered) {
    return (
      <main className="tb-page" style={{ minHeight: '60vh', padding: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem' }}>购物车为空</h1>
        <Link href="/shop" className="tb-btn">去选购</Link>
      </main>
    );
  }

  if (ordered) {
    return (
      <main className="tb-page" style={{ minHeight: '60vh', padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: '1rem' }}>✅</div>
        <h1 style={{ marginBottom: '0.5rem' }}>下单成功</h1>
        <p style={{ color: 'var(--tb-text-light)', marginBottom: '1.5rem' }}>感谢您的购买</p>
        <Link href="/shop" className="tb-btn">继续购物</Link>
      </main>
    );
  }

  const handleSubmit = () => {
    setSubmitting(true);
    setTimeout(() => {
      clear();
      setOrdered(true);
      setSubmitting(false);
    }, 800);
  };

  return (
    <main className="tb-page" style={{ minHeight: '60vh', padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>确认订单</h1>

      <div style={{ background: 'white', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 14 }}>商品清单</h3>
        {items.map(({ product, quantity }) => (
          <div
            key={product.id}
            style={{
              display: 'flex',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid #f5f5f5',
            }}
          >
            <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}>
              <Image
                src={product.image}
                alt={product.title}
                fill
                style={{ objectFit: 'cover' }}
                unoptimized={product.image.includes('picsum')}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {product.title}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
                ¥{product.price} × {quantity}
              </div>
            </div>
            <div style={{ fontWeight: 600 }}>¥{(product.price * quantity).toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span>商品总价</span>
          <span>¥{totalAmount().toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '1.1rem' }}>
          <span>应付金额</span>
          <span style={{ color: '#e4393c' }}>¥{totalAmount().toFixed(2)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Link href="/shop/cart" className="tb-btn" style={{ background: 'white', color: 'var(--tb-orange)' }}>
          返回修改
        </Link>
        <button
          type="button"
          className="tb-btn"
          style={{ background: 'var(--tb-orange)', color: 'white', border: 'none', cursor: submitting ? 'wait' : 'pointer' }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? '提交中...' : '提交订单'}
        </button>
      </div>
    </main>
  );
}
