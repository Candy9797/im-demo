'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { shopPath } from '@/lib/i18n';
import { useTranslations } from '@/components/providers/IntlProvider';
import type { Locale } from '@/lib/i18n';
import type { Shop2FilterParams } from '@/lib/shop/getProducts';

const BRANDS = [
  { key: 'vivo', labelKey: 'brandVivo' as const },
  { key: '故宫', labelKey: 'brandPalace' as const },
];

const CATEGORIES = [
  { key: '', labelKey: 'allCategoriesFilter' as const },
  { key: '数码', labelKey: 'digital' as const },
  { key: '家居', labelKey: 'home' as const },
  { key: '女装', labelKey: 'women' as const },
  { key: '文创', labelKey: 'culture' as const },
  { key: '美妆', labelKey: 'beauty' as const },
  { key: '母婴', labelKey: 'baby' as const },
  { key: '运动', labelKey: 'sports' as const },
  { key: '文具', labelKey: 'stationery' as const },
];

const SORT_OPTIONS = [
  { key: 'default', labelKey: 'sortDefault' as const },
  { key: 'sales_desc', labelKey: 'sortSales' as const },
  { key: 'price_asc', labelKey: 'sortPriceAsc' as const },
  { key: 'price_desc', labelKey: 'sortPriceDesc' as const },
  { key: 'rating_desc', labelKey: 'sortRating' as const },
];

const RESET_UPDATES: Partial<Shop2FilterParams> = {
  brand: undefined,
  category: undefined,
  sort: 'default',
  priceMin: undefined,
  priceMax: undefined,
  page: 1,
};

interface ShopFiltersProps {
  /** 当前 locale，在 [locale]/shop 下传入以生成带语言前缀的链接 */
  locale?: Locale;
  /** 筛选链接前缀，如 /shop2 则链接为 /shop2?category=xxx */
  basePath?: string;
  /** 纯客户端筛选：不跳转链接，通过 onParamsChange 更新父组件状态 */
  clientSideFilter?: boolean;
  /** 客户端模式下的当前筛选参数（由父组件传入） */
  currentParams?: Shop2FilterParams;
  /** 客户端模式下筛选变更回调 */
  onParamsChange?: (updates: Partial<Shop2FilterParams>) => void;
}

export function ShopFilters({
  locale,
  basePath,
  clientSideFilter,
  currentParams,
  onParamsChange,
}: ShopFiltersProps) {
  const t = useTranslations('shop');
  const searchParams = useSearchParams();
  const [priceMin, setPriceMin] = useState(
    () => (clientSideFilter && currentParams?.priceMin != null ? String(currentParams.priceMin) : searchParams.get('priceMin') || '')
  );
  const [priceMax, setPriceMax] = useState(
    () => (clientSideFilter && currentParams?.priceMax != null ? String(currentParams.priceMax) : searchParams.get('priceMax') || '')
  );
  const base = basePath ?? (locale ? shopPath('', locale) : '/shop');

  useEffect(() => {
    if (clientSideFilter && currentParams) {
      setPriceMin(currentParams.priceMin != null ? String(currentParams.priceMin) : '');
      setPriceMax(currentParams.priceMax != null ? String(currentParams.priceMax) : '');
    }
  }, [clientSideFilter, currentParams?.priceMin, currentParams?.priceMax]);

  const buildUrl = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete('page');
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const buildPriceUrl = () => {
    const p = new URLSearchParams(searchParams.toString());
    if (priceMin) p.set('priceMin', priceMin);
    else p.delete('priceMin');
    if (priceMax) p.set('priceMax', priceMax);
    else p.delete('priceMax');
    p.delete('page');
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const brand = clientSideFilter && currentParams ? (currentParams.brand ?? '') : (searchParams.get('brand') || '');
  const category = clientSideFilter && currentParams ? (currentParams.category ?? '') : (searchParams.get('category') || '');
  const sort = clientSideFilter && currentParams ? (currentParams.sort ?? 'default') : (searchParams.get('sort') || 'default');
  const isClientMode = Boolean(clientSideFilter && onParamsChange);

  const FilterLink = ({
    href,
    onClick: onClickProp,
    active,
    children,
    className = 'tb-filter-link',
  }: {
    href: string;
    onClick?: () => void;
    active?: boolean;
    children: React.ReactNode;
    className?: string;
  }) => {
    if (isClientMode && onClickProp) {
      return (
        <button
          type="button"
          onClick={onClickProp}
          className={`${className} ${active ? 'active' : ''}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
        >
          {children}
        </button>
      );
    }
    return (
      <Link href={href} className={`${className} ${active ? 'active' : ''}`}>
        {children}
      </Link>
    );
  };

  return (
    <aside className="tb-sidebar wf-sidebar">
      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">{t('recommendTitle')}</h4>
        {isClientMode ? (
          <button
            type="button"
            onClick={() => onParamsChange?.(RESET_UPDATES)}
            className="tb-sidebar-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
          >
            {t('recommendRank')}
          </button>
        ) : (
          <Link href={base} className="tb-sidebar-link">
            {t('recommendRank')}
          </Link>
        )}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">{t('categoryTitle')}</h4>
        {CATEGORIES.map((c) => (
          <FilterLink
            key={c.key || 'all'}
            href={buildUrl({ category: c.key || null })}
            onClick={isClientMode ? () => onParamsChange?.({ category: c.key || undefined, page: 1 }) : undefined}
            active={category === c.key}
          >
            {t(c.labelKey)}
          </FilterLink>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">{t('brandTitle')}</h4>
        {BRANDS.map((b) => (
          <FilterLink
            key={b.key}
            href={buildUrl({ brand: brand === b.key ? null : b.key })}
            onClick={isClientMode ? () => onParamsChange?.({ brand: brand === b.key ? undefined : b.key, page: 1 }) : undefined}
            active={brand === b.key}
          >
            {t(b.labelKey)}
          </FilterLink>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">{t('sortTitle')}</h4>
        {SORT_OPTIONS.map((s) => (
          <FilterLink
            key={s.key}
            href={buildUrl({ sort: s.key === 'default' ? null : s.key })}
            onClick={isClientMode ? () => onParamsChange?.({ sort: s.key === 'default' ? undefined : s.key, page: 1 }) : undefined}
            active={sort === s.key}
          >
            {t(s.labelKey)}
          </FilterLink>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">{t('priceRange')}</h4>
        <form
          className="tb-price-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (isClientMode) {
              onParamsChange?.({
                priceMin: priceMin ? Number(priceMin) : undefined,
                priceMax: priceMax ? Number(priceMax) : undefined,
                page: 1,
              });
            }
          }}
          action={isClientMode ? undefined : buildPriceUrl()}
          method={isClientMode ? undefined : 'get'}
        >
          {!isClientMode &&
            Array.from(searchParams.entries())
              .filter(([k]) => !['priceMin', 'priceMax', 'page'].includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
          <div className="tb-price-inputs">
            <input
              type="number"
              name="priceMin"
              className="tb-price-input"
              placeholder={t('priceMinPlaceholder')}
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              min={0}
            />
            <span className="tb-price-sep">-</span>
            <input
              type="number"
              name="priceMax"
              className="tb-price-input"
              placeholder={t('priceMaxPlaceholder')}
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              min={0}
            />
          </div>
          <button type="submit" className="tb-btn tb-btn-sm">
            {t('confirmPrice')}
          </button>
        </form>
      </div>

      {isClientMode ? (
        <button
          type="button"
          onClick={() => onParamsChange?.(RESET_UPDATES)}
          className="tb-btn tb-btn-reset"
          style={{ cursor: 'pointer' }}
        >
          {t('reset')}
        </button>
      ) : (
        <Link href={base} className="tb-btn tb-btn-reset">
          {t('reset')}
        </Link>
      )}
    </aside>
  );
}
