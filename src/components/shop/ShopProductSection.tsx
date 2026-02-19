/**
 * 商品列表区 - 异步 RSC，供 PPR Suspense 孔洞使用
 * 将 getProducts 放在 Suspense 内部，实现：先发静态壳+fallback，再流式填充
 */
import Link from "next/link";
import { WaterfallList } from "./WaterfallList";
import { Pagination } from "./Pagination";
import { getProducts } from "@/lib/shop/getProducts";

interface ShopProductSectionProps {
  q: string;
  brand: string;
  page: number;
}

export async function ShopProductSection({ q, brand, page }: ShopProductSectionProps) {
  const { items, total, hasMore } = await getProducts({ q, brand, page, pageSize: 12 });

  return (
    <>
      <div className="wf-breadcrumb">
        <Link href="/">首页</Link>
        <span className="tb-sep">&gt;</span>
        <span>淘宝网官网</span>
        <span className="tb-item-count">（共找到{total}件商品）</span>
      </div>

      <WaterfallList
        key={`${q}-${brand}-${page}`}
        initialItems={items}
        initialPage={page}
        initialHasMore={hasMore}
      />
      <Pagination page={page} total={total} pageSize={12} />
    </>
  );
}
