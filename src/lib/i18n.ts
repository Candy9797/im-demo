/**
 * 国际化配置 - 与 Edge 中间件配合，仅 shop 等需 i18n 的路由使用 [locale] 前缀
 */
export const locales = ['zh', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh';

export function isValidLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function getLocale(value: string | null | undefined): Locale {
  if (value && isValidLocale(value)) return value;
  return defaultLocale;
}

/** 从 Accept-Language 取首选语言（简单实现） */
export function getLocaleFromAcceptLanguage(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;
  const parts = acceptLanguage.split(',').map((s) => s.split(';')[0].trim().toLowerCase());
  for (const part of parts) {
    const lang = part.slice(0, 2);
    if (lang === 'zh') return 'zh';
    if (lang === 'en') return 'en';
  }
  return defaultLocale;
}

/** 带 locale 的 shop 路径，用于 Link href */
export function shopPath(path: string, locale: Locale): string {
  const base = `/${locale}/shop`;
  if (!path || path === '/') return base;
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/** 当前 pathname 下切换到另一 locale 的完整路径（含 search），用于语言切换 */
export function switchLocalePath(currentPathname: string, targetLocale: Locale): string {
  const segments = currentPathname.split('/').filter(Boolean);
  if (segments.length > 0 && isValidLocale(segments[0])) {
    segments[0] = targetLocale;
    return '/' + segments.join('/');
  }
  return shopPath('', targetLocale);
}
