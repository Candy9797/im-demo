'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { shopPath } from '@/lib/i18n';
import { useTranslations } from '@/components/providers/IntlProvider';
import type { Locale } from '@/lib/i18n';

interface ShopSearchBarProps {
  suggestions?: string[];
  defaultSearch?: string;
  locale?: Locale;
  /** 搜索链接前缀，如 /shop2 则提交到 /shop2?q=xxx */
  basePath?: string;
}

export function ShopSearchBar({ suggestions = [], defaultSearch = '', locale, basePath }: ShopSearchBarProps) {
  const t = useTranslations('shop');
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || defaultSearch;
  const base = basePath ?? (locale ? shopPath('', locale) : '/shop');

  const buildUrl = (newQ: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (newQ) p.set('q', newQ);
    else p.delete('q');
    p.delete('page');
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const baseParams = new URLSearchParams(searchParams.toString());
  baseParams.delete('q');
  baseParams.delete('page');

  return (
    <div className="tb-search-wrap">
      <form className="tb-search-form" action={base} method="get">
        {Array.from(baseParams.entries()).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input
          type="search"
          name="q"
          className="tb-search-input"
          placeholder={t('searchPlaceholder')}
          defaultValue={q}
          aria-label={t('search')}
        />
        <button type="submit" className="tb-search-btn">
          {t('search')}
        </button>
      </form>
      <div className="tb-search-suggestions">
        <Link href={base}>{t('allCategories')}</Link>
        {suggestions.slice(0, 8).map((s) => (
          <Link key={s} href={buildUrl(s)}>
            {s}
          </Link>
        ))}
        <Link href={base}>{t('more')}</Link>
      </div>
    </div>
  );
}
