import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, getLocale, getLocaleFromAcceptLanguage, isValidLocale } from '@/lib/i18n';

const shopPathPrefix = '/shop';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静态资源、API、Next 内部路径不处理
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // 已是 /zh/shop 或 /en/shop 等，直接放行
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 1 && isValidLocale(segments[0]) && segments[1] === 'shop') {
    return NextResponse.next();
  }

  // 访问 /shop 或 /shop/xxx 时，在 Edge 层做国际化：重定向到 /[locale]/shop
  if (pathname === shopPathPrefix || pathname.startsWith(shopPathPrefix + '/')) {
    const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
    const headerLocale = getLocaleFromAcceptLanguage(request.headers.get('accept-language'));
    const locale = getLocale(cookieLocale || headerLocale);
    const rest = pathname.slice(shopPathPrefix.length) || '';
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/shop${rest}`;
    const res = NextResponse.redirect(url);
    res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/shop', '/shop/:path*', '/zh/shop', '/zh/shop/:path*', '/en/shop', '/en/shop/:path*'],
};
