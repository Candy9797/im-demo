'use client';

import { usePathname } from 'next/navigation';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n';

/**
 * 从当前路径解析 locale（如 /zh/shop/... -> 'zh'），仅对带 [locale] 的 shop 路由有效
 */
export function useLocale(): Locale {
  const pathname = usePathname() ?? '';
  const segment = pathname.split('/').filter(Boolean)[0];
  return segment && isValidLocale(segment) ? segment : defaultLocale;
}
