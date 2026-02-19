'use client';

import React, { useRef, useEffect, useState } from 'react';
import Image from 'next/image';
import type { Product } from '@/lib/shop/mockProducts';

interface ProductCardProps {
  product: Product;
  onBuy?: (p: Product) => void;
  onAddCart?: (p: Product) => void;
}

/** 懒加载包装：进入视口才渲染图片 */
function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setVisible(true);
      },
      { rootMargin: '100px' }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${className ?? ''} shop-card-img-wrap`} style={{ minHeight: 300, position: 'relative' }}>
      {visible && (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 480px) 100vw, 480px"
          className="shop-card-img"
          loading="lazy"
          unoptimized={src.includes('picsum')}
        />
      )}
    </div>
  );
}

export function ProductCard({ product, onBuy, onAddCart }: ProductCardProps) {
  const discount =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 10)
      : 0;

  return (
    <article
      className="shop-card"
      style={{ contentVisibility: 'auto' }}
    >
      <div className="shop-card-media">
        <LazyImage src={product.image} alt={product.title} />
        {product.tags && product.tags.length > 0 && (
          <div className="shop-card-tags">
            {product.tags.slice(0, 2).map((t) => (
              <span key={t} className="shop-tag">{t}</span>
            ))}
          </div>
        )}
        {discount > 0 && (
          <span className="shop-card-discount">省{discount}元</span>
        )}
      </div>
      <div className="shop-card-body">
        <h3 className="shop-card-title">{product.title}</h3>
        <p className="shop-card-shop">{product.shopName}</p>
        <div className="shop-card-price-row">
          <span className="shop-card-price">¥{product.price.toFixed(2)}</span>
          {product.originalPrice && (
            <span className="shop-card-original">¥{product.originalPrice.toFixed(2)}</span>
          )}
          {product.sales != null && (
            <span className="shop-card-sales">已售{formatSales(product.sales)}</span>
          )}
        </div>
        <div className="shop-card-actions">
          <button
            type="button"
            className="shop-btn shop-btn-cart"
            onClick={() => onAddCart?.(product)}
          >
            加入购物车
          </button>
          <button
            type="button"
            className="shop-btn shop-btn-buy"
            onClick={() => onBuy?.(product)}
          >
            立即购买
          </button>
        </div>
      </div>
    </article>
  );
}

function formatSales(n: number): string {
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}
