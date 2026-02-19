'use client';

import React, { useRef, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/lib/shop/mockProducts';

interface TaobaoProductCardProps {
  product: Product;
}

function LazyImage({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([e]) => e?.isIntersecting && setVisible(true),
      { rootMargin: '80px' }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  return (
    <div ref={ref} className="tb-card-img-wrap">
      {visible && (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 50vw, 200px"
          className="tb-card-img"
          loading="lazy"
          unoptimized={src.includes('picsum')}
        />
      )}
    </div>
  );
}

function formatSales(n: number): string {
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

function priceToSgd(yuan: number): string {
  return (yuan * 0.19).toFixed(1); // 示例汇率
}

export function TaobaoProductCard({ product }: TaobaoProductCardProps) {
  return (
    <Link href={`/shop/${product.id}`} className="tb-product-card">
      <div className="tb-card-media">
        <LazyImage src={product.image} alt={product.title} />
        {product.label && (
          <span className="tb-card-label">{product.label}</span>
        )}
        {product.tags && product.tags.length > 0 && (
          <div className="tb-card-tags">
            {product.tags.slice(0, 2).map((t) => (
              <span key={t} className="tb-tag">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="tb-card-body">
        <h3 className="tb-card-title">{product.title}</h3>
        <div className="tb-card-price-row">
          <span className="tb-card-price">¥{product.price}</span>
          {product.originalPrice && (
            <span className="tb-card-original">¥{product.originalPrice}</span>
          )}
          <span className="tb-card-sgd">约SGD ${priceToSgd(product.price)}</span>
        </div>
        {product.rating != null && (
          <div className="tb-card-rating">
            <span className="tb-stars">★★★★★</span>
            <span>{product.rating}</span>
          </div>
        )}
        {product.sales != null && (
          <div className="tb-card-sales">已售{formatSales(product.sales)}</div>
        )}
        {product.originalPrice && product.originalPrice > product.price && (
          <div className="tb-card-promo">活动价</div>
        )}
      </div>
    </Link>
  );
}
