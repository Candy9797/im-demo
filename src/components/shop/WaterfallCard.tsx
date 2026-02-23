'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Product } from '@/lib/shop/mockProducts';
import { useCartStore } from '@/stores/cartStore';
import { useLocale } from '@/hooks/useLocale';
import { shopPath } from '@/lib/i18n';
import { useTranslations } from '@/components/providers/IntlProvider';

interface WaterfallCardProps {
  product: Product;
}

function formatSales(n: number): string {
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

function priceToSgd(yuan: number): string {
  return (yuan * 0.19).toFixed(1);
}

/** 瀑布流商品卡片 - 支持加入购物车、立即购买 */
export function WaterfallCard({ product }: WaterfallCardProps) {
  const t = useTranslations('shop');
  const router = useRouter();
  const locale = useLocale();
  const addItem = useCartStore((s) => s.addItem);

  const handleAddCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product);
  };

  const handleBuyNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product);
    router.push(shopPath('/checkout', locale));
  };

  return (
    <div className="wf-card">
      <Link href={shopPath(`/${product.id}`, locale)} className="wf-card-link">
        <div className="wf-card-media">
          {/* 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：图片 - loading="lazy"、sizes 尺寸适配 */}
          <Image
            src={product.image}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="wf-card-img"
            loading="lazy"
            unoptimized={product.image.includes('picsum')}
          />
          {product.label && (
            <span className="wf-card-label">{product.label}</span>
          )}
          {product.tags && product.tags.length > 0 && (
            <div className="wf-card-tags">
              {product.tags.slice(0, 2).map((t) => (
                <span key={t} className="wf-tag">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="wf-card-body">
          <h3 className="wf-card-title">{product.title}</h3>
          <div className="wf-card-price-row">
            <span className="wf-card-price">¥{product.price}</span>
            {product.originalPrice && (
              <span className="wf-card-original">¥{product.originalPrice}</span>
            )}
            <span className="wf-card-sgd">约SGD ${priceToSgd(product.price)}</span>
          </div>
          {product.rating != null && (
            <div className="wf-card-rating">★★★★★ {product.rating}</div>
          )}
          {product.sales != null && (
            <div className="wf-card-sales">已售{formatSales(product.sales)}</div>
          )}
        </div>
      </Link>
      <div className="wf-card-actions">
        <button type="button" className="wf-btn-cart" onClick={handleAddCart}>
          {t('addCart')}
        </button>
        <button type="button" className="wf-btn-buy" onClick={handleBuyNow}>
          {t('buyNow')}
        </button>
      </div>
    </div>
  );
}
