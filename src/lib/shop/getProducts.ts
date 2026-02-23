/**
 * 商品列表 - 服务端/API 共用
 * 支持搜索、品牌、分类、价格区间、排序、分页
 */
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import type { Product } from './mockProducts';
import { MOCK_PRODUCTS } from './mockProducts';

export type SortOption = 'default' | 'price_asc' | 'price_desc' | 'sales_desc' | 'rating_desc';

/** 用于 shop2 客户端筛选/分页的状态（与 URL 解耦） */
export interface Shop2FilterParams {
  q?: string;
  brand?: string;
  category?: string;
  sort?: SortOption | string;
  priceMin?: number;
  priceMax?: number;
  page?: number;
}

export interface GetProductsParams {
  q?: string;
  brand?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
}

export interface GetProductsResult {
  items: Product[];
  total: number;
  page: number;
  hasMore: boolean;
}

/** shopName -> category 映射（商品无 category 时使用） */
const SHOP_CATEGORY: Record<string, string> = {
  '故宫淘宝旗舰店': '文创',
  'vivo官方旗舰店': '数码',
  '文具生活馆': '文具',
  '数码配件专营': '数码',
  '家居旗舰店': '家居',
  '女装专营店': '女装',
  '鞋靴专营': '鞋靴',
  '旅行用品': '旅行',
  '派对用品': '派对',
  '动漫周边': '动漫',
  '母婴专营': '母婴',
  '美妆优选': '美妆',
  '数码好物': '数码',
  '生活好物': '家居',
  '日用百货': '日用',
  '亲子乐园': '母婴',
  '茶艺轩': '文创',
  '吃货研究所': '零食',
  '玩具总动员': '玩具',
  '运动户外旗舰': '运动',
};

function getCategory(p: Product): string {
  return p.category ?? SHOP_CATEGORY[p.shopName] ?? '综合';
}

/** 纯函数实现 */
function getProductsImpl(params: GetProductsParams = {}): GetProductsResult {
  const {
    q = '',
    brand = '',
    category = '',
    priceMin,
    priceMax,
    sort = 'default',
    page = 1,
    pageSize = 12,
  } = params;
  let items = [...MOCK_PRODUCTS].map((p) => ({
    ...p,
    category: getCategory(p),
  }));

  const qLower = q.toLowerCase().trim();
  if (qLower) {
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(qLower) ||
        p.shopName.toLowerCase().includes(qLower) ||
        (p.category && p.category.toLowerCase().includes(qLower))
    );
  }

  const brandLower = brand.toLowerCase();
  if (brandLower) {
    items = items.filter((p) =>
      p.shopName.toLowerCase().includes(brandLower)
    );
  }

  if (category) {
    const catLower = category.toLowerCase();
    items = items.filter((p) =>
      (p.category ?? '').toLowerCase().includes(catLower)
    );
  }

  if (priceMin != null) {
    items = items.filter((p) => p.price >= priceMin);
  }
  if (priceMax != null) {
    items = items.filter((p) => p.price <= priceMax);
  }

  switch (sort) {
    case 'price_asc':
      items.sort((a, b) => a.price - b.price);
      break;
    case 'price_desc':
      items.sort((a, b) => b.price - a.price);
      break;
    case 'sales_desc':
      items.sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
      break;
    case 'rating_desc':
      items.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    default:
      break;
  }

  const total = items.length;
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);

  return {
    items: data,
    total,
    page,
    hasMore: start + data.length < total,
  };
}

const REVALIDATE_SECONDS = 60;

async function getProductsCached(params: GetProductsParams): Promise<GetProductsResult> {
  const { q = '', brand = '', category = '', priceMin, priceMax, sort = 'default', page = 1, pageSize = 12 } = params;
  return unstable_cache(
    async () => getProductsImpl({ q, brand, category, priceMin, priceMax, sort, page, pageSize }),
    ['shop-products', q, brand, category, String(priceMin ?? ''), String(priceMax ?? ''), sort, String(page), String(pageSize)],
    { revalidate: REVALIDATE_SECONDS, tags: ['shop-products'] }
  )();
}

export const getProducts = cache(getProductsCached);
