'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useCartStore } from '@/stores/cartStore';
import { useLocale } from '@/hooks/useLocale';
import { shopPath } from '@/lib/i18n';
import { useTranslations } from '@/components/providers/IntlProvider';

export default function CartPage() {
  const t = useTranslations('shop');
  const searchParams = useSearchParams();
  const locale = useLocale();
  const checkoutMode = searchParams.get('checkout') === '1';

  const { items, removeItem, updateQuantity, totalCount, totalAmount } = useCartStore();

  if (items.length === 0 && !checkoutMode) {
    return (
      <main className="tb-page" style={{ minHeight: '60vh', padding: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>{t('cartEmpty')}</h1>
        <p style={{ color: 'var(--tb-text-light)', marginBottom: '1.5rem' }}>{t('goPick')}</p>
        <Link href={shopPath('', locale)} className="tb-btn">
          {t('goBrowse')}
        </Link>
      </main>
    );
  }

  return (
    <main className="tb-page" style={{ minHeight: '60vh', padding: '2rem' }}>
      <h1 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>
        {checkoutMode ? t('confirmOrder') : t('cart')}
      </h1>

      <div className="tb-cart-list" style={{ background: 'white', borderRadius: 8, overflow: 'hidden', marginBottom: '1.5rem' }}>
        {items.map(({ product, quantity }) => (
          <div
            key={product.id}
            className="tb-cart-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: 16,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <Link href={shopPath(`/${product.id}`, locale)} style={{ flexShrink: 0 }}>
              <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden' }}>
                <Image
                  src={product.image}
                  alt={product.title}
                  fill
                  style={{ objectFit: 'cover' }}
                  unoptimized={product.image.includes('picsum')}
                />
              </div>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link href={shopPath(`/${product.id}`, locale)} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {product.title}
                </div>
              </Link>
              <div style={{ marginTop: 4, color: '#e4393c', fontWeight: 600 }}>¥{product.price}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => updateQuantity(product.id, quantity - 1)}
                style={{ width: 28, height: 28, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', background: 'white' }}
              >
                -
              </button>
              <span style={{ minWidth: 24, textAlign: 'center' }}>{quantity}</span>
              <button
                type="button"
                onClick={() => updateQuantity(product.id, quantity + 1)}
                style={{ width: 28, height: 28, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', background: 'white' }}
              >
                +
              </button>
            </div>
            <div style={{ fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
              ¥{(product.price * quantity).toFixed(2)}
            </div>
            <button
              type="button"
              onClick={() => removeItem(product.id)}
              style={{ padding: '4px 12px', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', background: 'white', color: '#999' }}
            >
              {t('delete')}
            </button>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          {t('totalItems')}<strong>{totalCount()}</strong>{t('itemsUnit')}{' '}
          <strong style={{ color: '#e4393c', fontSize: '1.25rem' }}>¥{totalAmount().toFixed(2)}</strong>
        </span>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href={shopPath('', locale)} className="tb-btn" style={{ background: 'white', color: 'var(--tb-orange)' }}>
            {t('continueShopping')}
          </Link>
          <Link
            href={shopPath('/checkout', locale)}
            className="tb-btn"
            style={{ background: 'var(--tb-orange)', color: 'white', border: 'none' }}
          >
            {t('checkout')}
          </Link>
        </div>
      </div>
    </main>
  );
}
