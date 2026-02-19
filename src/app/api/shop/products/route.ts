/**
 * 商品列表 API - 支持搜索、筛选、排序、分页
 * GET /api/shop/products?q=&brand=&category=&priceMin=&priceMax=&sort=&page=1
 */
import { NextRequest, NextResponse } from 'next/server';
import { getProducts } from '@/lib/shop/getProducts';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const brand = searchParams.get('brand') || '';
  const category = searchParams.get('category') || '';
  const priceMin = searchParams.get('priceMin');
  const priceMax = searchParams.get('priceMax');
  const sortRaw = searchParams.get('sort') || 'default';
  const sort = ['default', 'price_asc', 'price_desc', 'sales_desc', 'rating_desc'].includes(sortRaw)
    ? sortRaw
    : 'default';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '12', 10)));

  const result = await getProducts({
    q,
    brand,
    category,
    priceMin: priceMin ? Number(priceMin) : undefined,
    priceMax: priceMax ? Number(priceMax) : undefined,
    sort,
    page,
    pageSize,
  });
  return NextResponse.json(result);
}
