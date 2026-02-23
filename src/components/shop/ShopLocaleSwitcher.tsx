'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from '@/components/providers/IntlProvider';
import { useLocale } from '@/hooks/useLocale';
import { locales, switchLocalePath } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function setLocaleCookie(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}`;
}

/** 语言切换：用 Link 全量导航，确保服务端用新 locale 渲染文案 */
export function ShopLocaleSwitcher() {
  const t = useTranslations('shop');
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const currentLocale = useLocale();

  return (
    <span className="tb-locale-switcher" style={{ marginLeft: 8, fontSize: 12 }}>
      {locales.map((loc) => {
        if (loc === currentLocale) {
          return (
            <span
              key={loc}
              aria-current="true"
              style={{
                marginRight: 6,
                padding: '2px 6px',
                border: '1px solid #ddd',
                borderRadius: 4,
                background: '#ff6700',
                color: '#fff',
                fontSize: 'inherit',
              }}
            >
              {loc === 'zh' ? t('languageZh') : t('languageEn')}
            </span>
          );
        }
        const path = switchLocalePath(pathname, loc);
        const search = searchParams.toString();
        const href = search ? `${path}?${search}` : path;
        return (
          <Link
            key={loc}
            href={href}
            onClick={() => setLocaleCookie(loc)}
            aria-label={loc === 'zh' ? t('languageZh') : t('languageEn')}
            style={{
              marginRight: 6,
              padding: '2px 6px',
              border: '1px solid #ddd',
              borderRadius: 4,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 'inherit',
              textDecoration: 'none',
            }}
          >
            {loc === 'zh' ? t('languageZh') : t('languageEn')}
          </Link>
        );
      })}
    </span>
  );
}
