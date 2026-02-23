/**
 * 瀑布流商城 - React Query 客户端数据请求 + 淘宝风格
 * 商品列表由 useProductsQuery 拉取，支持搜索、筛选、排序、分页、购物车
 * searchParams 使用 React 19 use() + Suspense 解包。
 * 路由：/[locale]/shop，由 Edge 中间件做 i18n 重定向。
 */
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { use, Suspense } from 'react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { SEARCH_SUGGESTIONS } from '@/lib/shop/mockProducts';
import { getLocale } from '@/lib/i18n';
import { getTranslations } from '@/lib/translations';

const ShopProductFeed = dynamic(
  () => import('@/components/shop/ShopProductFeed').then((m) => ({ default: m.ShopProductFeed })),
  { ssr: true, loading: () => <div className="wf-skeleton" /> }
);

export const metadata: Metadata = {
  title: '淘宝网官网 - 淘！我喜欢',
  description: '淘宝全球购，海量商品任你选',
};

interface SearchParamsPromise {
  q?: string;
  brand?: string;
  category?: string;
  sort?: string;
  priceMin?: string;
  priceMax?: string;
  page?: string;
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsPromise>;
}

function ShopPageContent({
  locale,
  searchParams,
  consultLabel,
}: {
  locale: string;
  searchParams: Promise<SearchParamsPromise>;
  consultLabel: string;
}) {
  const params = use(searchParams);
  const q = params.q || '';

  return (
    <main className="tb-page wf-page">
      <ShopHeader locale={locale} suggestions={SEARCH_SUGGESTIONS} defaultSearch={q} />

      <div className="wf-content">
        <ShopFilters locale={locale} />

        <div className="wf-main">
          <ShopProductFeed />
        </div>
      </div>

      <Link href="/" className="tb-float-consult" title={consultLabel}>
        <span className="tb-float-icon">😊</span>
        <span>{consultLabel}</span>
      </Link>
    </main>
  );
}

function ShopPageFallback() {
  return (
    <main className="tb-page wf-page">
      <div className="wf-content" style={{ padding: '1rem' }}>
        <div className="wf-skeleton" />
      </div>
    </main>
  );
}

/** 在 Suspense 内 await params/searchParams，避免 Next.js 15+ blocking-route 报错 */
async function ShopPageInner(props: PageProps) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const locale = getLocale(params.locale);
  const t = await getTranslations(locale, 'shop');
  const consultLabel = t('consult');
  return (
    <ShopPageContent locale={locale} searchParams={Promise.resolve(searchParams)} consultLabel={consultLabel} />
  );
}

export default function ShopPage(props: PageProps) {
  return (
    <Suspense fallback={<ShopPageFallback />}>
      <ShopPageInner params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
