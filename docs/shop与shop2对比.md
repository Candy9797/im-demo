# Shop 与 Shop2 对比

两套商城列表页并存：**shop** 为客户端取数，**shop2** 为服务端取数（SSR 首屏）。数据源与 UI 组件共用，仅取数时机与路由不同。

---

## 一、路由与入口

| 对比项 | Shop | Shop2 |
|--------|------|-------|
| **URL** | `/shop` → 中间件重定向到 `/zh/shop` 或 `/en/shop` | `/shop2` |
| **路由结构** | `app/[locale]/shop/page.tsx`（带国际化段） | `app/shop2/page.tsx`（无 locale） |
| **布局** | `app/[locale]/layout.tsx`（IntlProvider + 按 locale 加载 messages） | `app/shop2/layout.tsx`（IntlProvider 固定 zh） |
| **国际化** | 支持中英切换（中文 / English），URL 带 `/zh/`、`/en/` | 仅中文，无语言切换 |

---

## 二、首屏数据从哪来

| 对比项 | Shop | Shop2 |
|--------|------|-------|
| **谁取首屏数据** | 浏览器里的 `ShopProductFeed`（Client Component） | 服务端 `Shop2PageContent`（async Server Component） |
| **何时取数** | 页面 HTML 到 → JS Hydration 后 → `fetch('/api/shop/products?page=1&pageSize=12')` | 用户请求 `/shop2?page=1` 时，服务端直接 `await getProducts({ page: 1, ... })` |
| **首屏 HTML 是否含商品列表** | 否，先骨架（wf-skeleton），等接口返回后再渲染列表 | 是，首屏 HTML 里就有首屏 12 条商品 |
| **数据来源** | `/api/shop/products`（内部也调 `getProducts()`） | `getProducts()` 在 Node 进程内直接调用，无首屏 HTTP |

---

## 三、加载更多 / 筛选

| 对比项 | Shop | Shop2 |
|--------|------|-------|
| **加载更多** | React Query `useProductsInfiniteQuery`，触底发 `fetch('/api/shop/products?page=2')`，追加到列表 | `Shop2ProductFeed` 用 `useInfiniteQuery` + `initialData`（首屏来自 props），后续页同样请求 `/api/shop/products` |
| **筛选 / 搜索 / 分页** | 改 URL 或表单 → 整页仍在 `[locale]/shop`，列表用新 params 重新请求，React Query 缓存 | 改 URL → 整页重新 SSR（服务端再次 `getProducts()`），首屏又是服务端直出；加载更多仍走客户端 API |

---

## 四、组件与复用

| 对比项 | Shop | Shop2 |
|--------|------|-------|
| **列表组件** | `ShopProductFeed`（dynamic 按需加载，仅首屏用 React Query，无 initialData） | `Shop2ProductFeed`（接收 `initialItems/initialPage/initialTotal/initialHasMore`，useInfiniteQuery 带 initialData） |
| **共用** | `ShopHeader`、`ShopFilters`、`ShopSearchBar`、`WaterfallCard`、`Pagination` | 同上；Header/Filters 传 `basePath="/shop2"`，分页传 `basePath="/shop2"` |
| **购物车 / 详情** | 链到 `/zh/shop/cart`、`/zh/shop/checkout`、`/zh/shop/[id]` | 链到 `/zh/shop/cart`（未做 shop2 独立购物车） |

---

## 五、性能与体验对比

| 对比项 | Shop | Shop2 |
|--------|------|-------|
| **首屏「有内容」** | 晚：需等 JS + 一次接口，中间是骨架 | 早：HTML 里就有首屏商品，查看源代码可见 |
| **SEO** | 依赖壳 + 部分爬虫执行 JS 拿列表 | 直接爬 HTML 即可拿到列表 |
| **TTFB** | 首屏 HTML 快，无服务端取数 | 首屏需等服务端 `getProducts()` + 渲染，略长 |
| **筛选/分页** | 只发 API、局部更新列表（不整页重刷） | 整页跳转、重新 SSR，首屏再次服务端取数 |

---

## 六、何时用哪个

| 场景 | 更合适 |
|------|--------|
| 需要国际化（中英切换、URL 带语言） | **Shop**（`/[locale]/shop`） |
| 首屏速度与 SEO 优先（首屏即出商品 HTML） | **Shop2**（`/shop2`） |
| 希望首屏不依赖接口、壳先到即可 | **Shop** |
| 希望筛选/分页尽量少整页重刷 | **Shop**（客户端拉数 + React Query） |
| 仅中文、不打算做多语言 | 两者皆可，按首屏/SEO 需求选 |

---

## 七、文件速查

| 类型 | Shop | Shop2 |
|------|------|-------|
| 页面 | `src/app/[locale]/shop/page.tsx` | `src/app/shop2/page.tsx` |
| 布局 | `src/app/[locale]/layout.tsx` | `src/app/shop2/layout.tsx` |
| 列表组件 | `src/components/shop/ShopProductFeed.tsx` | `src/components/shop/Shop2ProductFeed.tsx` |
| 数据（服务端） | 无首屏调用 | `getProducts()` 在 page 内 `await` |
| 数据（客户端） | `src/hooks/useProducts.ts`（useProductsInfiniteQuery） | Shop2ProductFeed 内 useInfiniteQuery + initialData |
| 购物车/结算/详情 | `src/app/[locale]/shop/cart|checkout|[id]/page.tsx` | 使用上述 [locale]/shop 路由 |
