# Shop 页面性能优化

本文档汇总商城页（`/[locale]/shop`）已做的性能优化，便于排查与演进。

---

## 一、渲染与首屏

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **PPR / cacheComponents** | `next.config.ts` 中 `cacheComponents: true` | Next.js 16+ 静态壳 + 动态孔洞流式填充，先出壳再流式填内容 |
| **Suspense 流式** | 页面、布局均用 `Suspense` 包裹异步逻辑 | params/searchParams 在 Suspense 内 await，避免 blocking-route，首屏先出 fallback 再替换 |
| **骨架屏** | `wf-skeleton` 作为多处 Suspense fallback | 页面级、布局级、商品列表 dynamic 的 loading 均为骨架，减少白屏与布局跳动 |
| **布局 fallback 不渲染子页面** | `[locale]/layout` 的 fallback 只渲染骨架，不渲染 `children` | 等 IntlProvider 就绪后再渲染页面，避免文案 key 闪现、重复渲染 |

---

## 二、代码分割与按需加载

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **商品列表按需加载** | `next/dynamic` 加载 `ShopProductFeed`，仅 shop 页引用 | 商品列表 JS 单独 chunk，其它页面不加载，减小首包 |
| **SSR 保留** | `dynamic(..., { ssr: true })` | 首屏仍服务端渲染商品列表壳，SEO 与首屏体验兼顾 |
| **loading 占位** | `loading: () => <div className="wf-skeleton" />` | dynamic 加载过程中显示骨架，避免空白 |

---

## 三、数据请求与列表

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **React Query 无限滚动** | `useProductsInfiniteQuery` + `getNextPageParam` | 分页数据统一走 React Query，queryKey 含筛选参数，自动去重与缓存 |
| **单页数量上限** | `MAX_ITEMS_PER_VIEW = 100` | 无限滚动最多加载 100 条后不再请求下一页，控制 DOM 与内存 |
| **IntersectionObserver 触底加载** | `sentinelRef` + `rootMargin: '200px'` | 哨兵元素进入视口前 200px 即请求下一页，减少用户等待 |
| **API 分页** | `pageSize=12` 默认，API 内 `pageSize` 上限 50 | 首屏 12 条，后续每页 12 条，接口层限制单次最大 50 |

---

## 四、图片

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **Next/Image** | `next/image` 的 `Image` 组件 | 自动格式与尺寸优化，CDN 友好 |
| **响应式 sizes** | `sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"` | 按视口选择合适宽度，减少多余流量 |
| **懒加载** | `loading="lazy"` | 首屏外图片延迟加载，减轻首屏请求与解析 |
| **unoptimized 仅外链** | `unoptimized={product.image.includes('picsum')}` | 仅对 picsum 等外链图关闭优化，其余走 Next 图片管线 |

---

## 五、国际化与 Edge

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **Edge 中间件做 i18n** | `middleware.ts` 对 `/shop` 做 locale 重定向 | 重定向在 Edge 完成，不占用 Node，matcher 仅命中 shop 相关路径 |
| **文案内存缓存** | `getMessages(locale)` 内 `messagesCache[loc]` | 同 locale 的 JSON 只加载一次，后续命中缓存 |
| **IntlProvider key** | `IntlProvider key={locale}` | locale 切换时整棵子树重挂载，保证文案与当前语言一致 |

---

## 六、布局与 CLS

| 优化项 | 实现 | 说明 |
|--------|------|------|
| **列表项最小高度** | `.wf-item { min-height: 340px }` | 卡片有稳定高度，避免加载过程中列表“塌陷”或按钮被裁切 |
| **卡片正文不写死高度** | `.wf-card-body` 仅 `min-height`，无固定 `height` | 标题/价格行可自然撑开，减少文字被裁或遮挡 |
| **底部安全区** | `.tb-page` / `.wf-content` 的 `padding-bottom: max(..., env(safe-area-inset-bottom))` | 底部留白适配安全区与固定栏，避免内容被挡 |

---

## 七、与「瀑布流 SSR 方案」的差异：客户端拉数 vs 服务端取数

### 7.1 当前实现：客户端拉数

| 维度 | 说明 |
|------|------|
| **谁取数** | 浏览器里的 React 组件（`ShopProductFeed`） |
| **何时取数** | 页面 HTML 先到 → JS 加载并 Hydration 后 → 再发 `fetch('/api/shop/products?page=1&pageSize=12')` |
| **首屏内容** | 先看到骨架（wf-skeleton），等接口返回后才渲染商品列表 |
| **数据路径** | 浏览器 → Next 服务 `/api/shop/products` → 服务端 `getProducts()` → JSON 返回 → 客户端渲染 |
| **实现** | `useProductsInfiniteQuery`（React Query）+ 无限滚动 + IntersectionObserver |

**特点**：首屏不包含商品 HTML，SEO 依赖页面壳和接口；首屏可交互快（壳先到），但首屏「有内容」要等一次接口；改筛选/分页只发 API，不整页重刷。

---

### 7.2 文档方案：服务端取数（《瀑布流SSR商城技术方案》）

| 维度 | 说明 |
|------|------|
| **谁取数** | Next 服务端（Server Component） |
| **何时取数** | 用户请求 `/shop?page=1` 时，在 Node 里直接调 `getProducts({ page: 1 })`，无浏览器请求 |
| **首屏内容** | 服务端把首屏 12 条商品直接渲染进 HTML，查看源代码可见完整列表 |
| **数据路径** | 用户请求 → Next Server → `getProducts()` 在进程内调用 → 输出 HTML（含商品）→ 浏览器直接展示 |
| **实现** | async `ShopPage` + `await getProducts()` + 把 `initialItems` 传给 Client 的 `WaterfallList` |

**特点**：首屏 HTML 里就有商品，SEO 和首屏「有内容」更好；首屏需等服务端取数+渲染，TTFB 略长；改筛选/分页通常通过 URL 跳转，整页重新 SSR。

---

### 7.3 对比小结

| 对比项 | 客户端拉数（当前） | 服务端取数（文档方案） |
|--------|--------------------|------------------------|
| 首屏是否含商品 HTML | 否，先骨架再接口再渲染 | 是，HTML 里就有列表 |
| SEO | 依赖壳 + 部分爬虫执行 JS | 直接爬 HTML 即可 |
| 首屏「有内容」的时机 | 晚（需等 JS + 一次接口） | 早（随 HTML 一起到） |
| 筛选/分页体验 | 只发 API、局部更新 | 常为整页跳转、重新 SSR |
| 服务端压力 | 首屏小，压力在接口请求 | 每次打开/跳转都跑一次 `getProducts()` |

若需要首屏就是完整商品列表（尤其 SEO 或首屏速度优先），可按《瀑布流SSR商城技术方案》改为服务端取数；现有优化（代码分割、图片、无限滚动、i18n 缓存等）两种方案都可沿用。

---

## 八、相关文件速查

| 类型 | 路径 |
|------|------|
| 页面 | `src/app/[locale]/shop/page.tsx` |
| 布局 | `src/app/[locale]/layout.tsx` |
| 商品列表 | `src/components/shop/ShopProductFeed.tsx` |
| 商品卡片 | `src/components/shop/WaterfallCard.tsx` |
| 数据 Hook | `src/hooks/useProducts.ts` |
| 国际化 | `src/lib/translations.ts`、`src/middleware.ts` |
| 配置 | `next.config.ts` |
