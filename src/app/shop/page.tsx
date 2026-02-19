/**
 * 瀑布流商城 - React Query 客户端数据请求 + 淘宝风格
 * 商品列表由 useProductsQuery 拉取，支持搜索、筛选、排序、分页、购物车
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { ShopProductFeed } from '@/components/shop/ShopProductFeed';
import { SEARCH_SUGGESTIONS } from '@/lib/shop/mockProducts';

export const metadata: Metadata = {
  title: '淘宝网官网 - 淘！我喜欢',
  description: '淘宝全球购，海量商品任你选',
};

interface PageProps {
  searchParams: Promise<{ q?: string; brand?: string; category?: string; sort?: string; priceMin?: string; priceMax?: string; page?: string }>;
}

export default async function ShopPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q || '';

  return (
    <main className="tb-page wf-page">
      <ShopHeader suggestions={SEARCH_SUGGESTIONS} defaultSearch={q} />

      <div className="wf-content">
        <ShopFilters />

        <div className="wf-main">
          <ShopProductFeed />
        </div>
      </div>

      <Link href="/" className="tb-float-consult" title="自助咨询">
        <span className="tb-float-icon">😊</span>
        <span>自助咨询</span>
      </Link>
    </main>
  );
}
