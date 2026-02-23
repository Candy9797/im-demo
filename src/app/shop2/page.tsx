/**
 * 瀑布流商城 shop2 - 服务端取数（SSR）
 * 首屏由 getProducts() 在服务端取数并输出 HTML，加载更多走客户端 API
 * 路由：/shop2，与 /[locale]/shop（客户端拉数）并存
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Shop2PageClient } from '@/components/shop/Shop2PageClient';
import { getProducts } from '@/lib/shop/getProducts';
import { SEARCH_SUGGESTIONS } from '@/lib/shop/mockProducts';
import type { Shop2FilterParams } from '@/lib/shop/getProducts';

export const metadata: Metadata = {
  title: '淘宝网官网 - 淘！我喜欢（SSR）',
  description: '淘宝全球购，海量商品任你选 - 服务端取数首屏',
};

const PAGE_SIZE = 12;

interface PageProps {
  searchParams: Promise<{
    q?: string;
    brand?: string;
    category?: string;
    sort?: string;
    priceMin?: string;
    priceMax?: string;
    page?: string;
  }>;
}

function Shop2PageFallback() {
  return (
    <main className="tb-page wf-page">
      <div className="wf-content" style={{ padding: '1rem' }}>
        <div className="wf-skeleton" />
      </div>
    </main>
  );
}

async function Shop2PageContent(props: PageProps) {
  const params = await props.searchParams;
  const q = params.q || '';
  const brand = params.brand || '';
  const category = params.category || '';
  const priceMin = params.priceMin ? Number(params.priceMin) : undefined;
  const priceMax = params.priceMax ? Number(params.priceMax) : undefined;
  const sortRaw = params.sort || 'default';
  const sort = ['default', 'price_asc', 'price_desc', 'sales_desc', 'rating_desc'].includes(sortRaw)
    ? sortRaw
    : 'default';
  const page = Math.max(1, parseInt(params.page || '1', 10));

  const result = await getProducts({
    q,
    brand,
    category,
    priceMin,
    priceMax,
    sort: sort as 'default' | 'price_asc' | 'price_desc' | 'sales_desc' | 'rating_desc',
    page,
    pageSize: PAGE_SIZE,
  });

  const initialParams: Shop2FilterParams = {
    q: q || undefined,
    brand: brand || undefined,
    category: category || undefined,
    sort,
    priceMin,
    priceMax,
    page,
  };

  return (
    <Shop2PageClient
      initialItems={result.items}
      initialPage={result.page}
      initialTotal={result.total}
      initialHasMore={result.hasMore}
      initialParams={initialParams}
    />
  );
}

export default function Shop2Page(props: PageProps) {
  return (
    <Suspense fallback={<Shop2PageFallback />}>
      <Shop2PageContent searchParams={props.searchParams} />
    </Suspense>
  );
}
