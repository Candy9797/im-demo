'use client';

import React from 'react';
import Link from 'next/link';
import { ShopSearchBar } from './ShopSearchBar';
import { ShopLocaleSwitcher } from './ShopLocaleSwitcher';
import { useCartStore } from '@/stores/cartStore';
import { shopPath } from '@/lib/i18n';
import { useTranslations } from '@/components/providers/IntlProvider';
import type { Locale } from '@/lib/i18n';

interface ShopHeaderProps {
  suggestions?: string[];
  defaultSearch?: string;
  /** 当前 locale，在 [locale]/shop 下传入以生成带语言前缀的链接 */
  locale?: Locale;
  /** 页面路径前缀，如 /shop2 时搜索/筛选指向 /shop2，购物车仍可用 locale */
  basePath?: string;
}

export function ShopHeader({ suggestions = [], defaultSearch = '', locale, basePath }: ShopHeaderProps) {
  const t = useTranslations('shop');
  const totalCount = useCartStore((s) => s.totalCount());
  const cartHref = locale ? shopPath('/cart', locale) : basePath ? `${basePath}/cart` : '/shop/cart';

  return (
    <>
      <div className="tb-top-bar">
        <div className="tb-top-inner">
          <span>{t('global')}</span>
          <Link href="/">{t('pleaseLogin')}</Link>
          <Link href="/">{t('freeRegister')}</Link>
          <Link href="/">{t('mobileTaobao')}</Link>
          <span className="tb-top-right">
            <ShopLocaleSwitcher />
            <Link href="/">{t('myTaobao')}</Link>
            <Link href={cartHref} className="tb-cart-link">
              {t('cart')}
              {totalCount > 0 && (
                <span className="tb-cart-count">{totalCount > 99 ? '99+' : totalCount}</span>
              )}
            </Link>
            <Link href="/">{t('favorites')}</Link>
          </span>
        </div>
      </div>

      <header className="tb-header">
        <div className="tb-header-inner">
          <Link href="/" className="tb-logo">
            <span className="tb-logo-cn">{t('taobao')}</span>
            <span className="tb-logo-en">{t('taobaoEn')}</span>
            <span className="tb-logo-global">{t('global')}</span>
          </Link>

          <ShopSearchBar suggestions={suggestions} defaultSearch={defaultSearch} locale={locale} basePath={basePath} />

          <div className="tb-user-area">
            <span className="tb-greeting">{t('hiLogin')}</span>
            <Link href="/" className="tb-btn tb-btn-login">
              {t('login')}
            </Link>
            <Link href="/" className="tb-btn tb-btn-register">
              {t('registerBenefit')}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
