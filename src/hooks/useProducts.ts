'use client';

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { Product } from '@/lib/shop/mockProducts';
import type { SortOption } from '@/lib/shop/getProducts';

export interface ProductsQueryParams {
  q?: string;
  brand?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: SortOption;
}

export interface ProductsResult {
  items: Product[];
  total: number;
  page: number;
  hasMore: boolean;
}

async function fetchProducts(params: ProductsQueryParams & { page: number }): Promise<ProductsResult> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.brand) sp.set('brand', params.brand);
  if (params.category) sp.set('category', params.category);
  if (params.priceMin != null) sp.set('priceMin', String(params.priceMin));
  if (params.priceMax != null) sp.set('priceMax', String(params.priceMax));
  if (params.sort && params.sort !== 'default') sp.set('sort', params.sort);
  sp.set('page', String(params.page));
  sp.set('pageSize', '12');
  const res = await fetch(`/api/shop/products?${sp.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

export function useProductsQuery(params: ProductsQueryParams & { page?: number }) {
  const page = params.page ?? 1;
  return useQuery({
    queryKey: ['products', { ...params, page }],
    queryFn: () => fetchProducts({ ...params, page }),
  });
}

export function useProductsInfiniteQuery(params: ProductsQueryParams) {
  return useInfiniteQuery({
    queryKey: ['products', 'infinite', params],
    queryFn: ({ pageParam }) => fetchProducts({ ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}
