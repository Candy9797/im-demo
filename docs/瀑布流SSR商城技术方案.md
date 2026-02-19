# 瀑布流 SSR 商城技术方案

基于 Next.js 16 App Router、React 19 的瀑布流电商列表页，采用 **RSC + SSR + PPR（cacheComponents）** 流式渲染，首屏输出完整 HTML，分页、筛选、搜索全链路可点击。

---

## 一、是否采用 RSC + SSR 流式渲染？

**是。** 项目使用 App Router 默认的 RSC（React Server Components）+ SSR 流式渲染：

| 特性 | 实现 |
|------|------|
| **RSC 默认** | 页面无 `'use client'` → 默认在服务端执行 |
| **SSR** | async 页面 + `await getProducts()` → 服务端取数后输出 HTML |
| **流式** | `Suspense` 包裹 Client 子组件 → 先发 fallback，再流式替换 |
| **PPR** | `cacheComponents: true`（Next.js 16+ 统一配置）→ 静态壳 + 动态孔洞流式填充 |
| **缓存** | `unstable_cache(revalidate:60)` 在 getProducts 内；cacheComponents 模式下页面级 revalidate 不可用 |

---

## 二、是否使用 SSR？

**是。** 商城列表页 `/shop` 采用 SSR 渲染，核心流程如下：

| 步骤 | 发生位置 | 说明 |
|------|----------|------|
| 1. 用户请求 `/shop?page=1` | 服务端 | Next.js 接收请求 |
| 2. 执行 `ShopPage` (async) | 服务端 | Server Component |
| 3. 调用 `getProducts({ q, brand, page })` | 服务端 | 同步取数，无客户端请求 |
| 4. 渲染完整 HTML（含首屏商品列表） | 服务端 | RSC + Client 预渲染 |
| 5. 返回 HTML 到浏览器 | 网络 | 首屏即可展示 |
| 6. Hydration | 客户端 | 激活交互 |

**验证方式**：访问 `/shop` → 查看页面源代码（Ctrl+U）→ 可见完整商品列表 HTML，说明由服务端渲染。

---

## 三、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | Next.js 16 | App Router，cacheComponents 启用 PPR |
| UI | React 19 | useTransition、Suspense |
| 渲染 | RSC + SSR | Server Components 为主 |
| 路由 | App Router | 文件系统路由 |
| 数据 | 服务端直接调用 | `getProducts()`，无首屏 fetch |
| 瀑布流 | CSS `column-count` | 无第三方库 |
| 分页 | URL + API | `?page=N`，加载更多调用 API |

---

## 四、架构图

```
┌────────────────────────────────────────────────────────────────┐
│  用户请求 GET /shop?q=蜡笔小新&page=1                            │
└────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  Next.js Server                                                │
│                                                                │
│  ShopPage (async Server Component)                             │
│    │                                                           │
│    ├─ await searchParams                                       │
│    ├─ Suspense(ShopProductSection)  ◄── PPR 孔洞                │
│    │     └─ getProducts({ q, brand, page })  服务端取数后流式输出│
│    │                                                           │
│    └─ render:                                                  │
│         ShopHeader (Client, Suspense)                          │
│         ShopFilters (Client, Suspense)                         │
│         WaterfallList (Client)  ◄── initialItems 来自 ShopProductSection│
│           └─ items.map → WaterfallCard                         │
│         Pagination (Client)                                    │
│                                                                │
│  输出: 完整 HTML（含首屏 12 条商品）                             │
└────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  Browser                                                       │
│  - 首屏直接展示 HTML，无需等待 JS                                │
│  - Hydration 后：搜索、筛选、分页、加载更多可交互                  │
└────────────────────────────────────────────────────────────────┘
```

---

## 五、SSR 数据流

### 4.1 首屏（SSR）

```typescript
// src/app/shop/page.tsx
export default async function ShopPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1', 10));
  
  // 服务端同步调用，无 HTTP 请求
  const { items, total, hasMore } = getProducts({ q, brand, page, pageSize: 12 });

  return (
    // ...
    <WaterfallList initialItems={items} initialPage={page} initialHasMore={hasMore} />
  );
}
```

- `getProducts()` 在 Node 进程中直接执行
- 不请求 `/api/shop/products`
- 首屏 HTML 已包含当前页商品

### 4.2 分页（URL 驱动）

| 方式 | 行为 | 是否 SSR |
|------|------|----------|
| 点击页码 | `router.push('/shop?page=2')` | 是，整页重新 SSR |
| 加载更多 | `fetch('/api/shop/products?page=2')` | 否，客户端追加 |

### 4.3 搜索 / 筛选

- 使用 `?q=xxx&brand=xxx`，通过表单或 Link 跳转
- 每次跳转都会触发完整 SSR，服务端用新参数调用 `getProducts()`

---

## 六、组件职责

| 组件 | 类型 | 说明 |
|------|------|------|
| `ShopPage` | Server | 入口页，只 await searchParams，不 await getProducts（PPR 壳） |
| `ShopProductSection` | Server (async) | PPR 孔洞，内部调用 `getProducts`，传 `initialItems` 给 WaterfallList |
| `WaterfallList` | Client | 接收 `initialItems`，支持加载更多 |
| `WaterfallCard` | Server | 商品卡片，被 WaterfallList 的子组件使用 |
| `ShopHeader` | Client | 搜索、登录入口 |
| `ShopFilters` | Client | 品牌、适用对象筛选 |
| `Pagination` | Client | 上一页 / 页码 / 下一页 |

---

## 七、瀑布流实现

```css
.wf-container {
  column-count: 4;
  column-gap: 16px;
}
.wf-item {
  break-inside: avoid;
  margin-bottom: 16px;
}
```

- 大屏 4 列，中屏 3 列，小屏 2 列
- 纯 CSS，无 JS 计算布局

---

## 八、分页

| 参数 | 说明 |
|------|------|
| `page` | 当前页，默认 1 |
| `pageSize` | 每页 12 条 |
| `total` | 总条数（如 50） |

- 页码分页：`<Link href="/shop?page=N">`，跳转后整页 SSR
- 加载更多：`fetch` API，客户端追加到 `WaterfallList` 的 state

---

## 九、目录与入口

```
src/
├── app/
│   ├── shop/
│   │   ├── page.tsx          # SSR 入口
│   │   └── [id]/page.tsx     # 商品详情
│   └── api/shop/products/
│       └── route.ts          # 供「加载更多」调用
├── components/shop/
│   ├── WaterfallList.tsx     # Client，列表 + 加载更多
│   ├── WaterfallCard.tsx     # 商品卡片
│   ├── Pagination.tsx        # Client，分页
│   ├── ShopHeader.tsx        # Client
│   ├── ShopFilters.tsx       # Client
│   └── ShopProductSection.tsx # Server (async)，PPR 孔洞，内部 getProducts
└── lib/shop/
    ├── getProducts.ts        # 服务端/API 共用
    └── mockProducts.ts       # 50 条 Mock 数据
```

- 列表：`/shop`
- 详情：`/shop/[id]`
- API：`GET /api/shop/products?q=&brand=&page=1`

---

## 十、ISR / React.cache 缓存

为降低服务端压力，对商品列表做了两层缓存：

| 缓存 | 作用域 | 说明 |
|------|--------|------|
| **unstable_cache** | 跨请求 | ISR：同一 `q/brand/page` 60 秒内复用，超时后台重验 |
| **React.cache** | 请求内 | 同一请求内相同参数只执行一次 |

```typescript
// lib/shop/getProducts.ts
const getProductsCached = unstable_cache(
  async () => getProductsImpl(params),
  ['shop-products', q, brand, String(page)],
  { revalidate: 60, tags: ['shop-products'] }
);
export const getProducts = cache(getProductsCached); // React.cache 包一层
```

- **失效**：`revalidateTag('shop-products')` 可主动使缓存失效
- **cacheComponents**：页面级 `revalidate` 不可用，缓存由 `unstable_cache` 承担

---

## 十一、PPR（Partial Prerendering）

PPR 将页面分为**静态壳**和**动态孔洞**：壳先输出，孔洞在 Suspense 边界内异步填充。

### 11.1 配置

```typescript
// next.config.ts（Next.js 16+：PPR 已合并到 cacheComponents，全应用启用）
cacheComponents: true
// 注意：使用 cacheComponents 时，不可再导出 experimental_ppr
```

### 11.2 实现要点

| 要点 | 说明 |
|------|------|
| 壳不 await 慢请求 | `ShopPage` 只 await `searchParams`，不 await `getProducts` |
| 孔洞在 Suspense 内 | `getProducts` 移入 `ShopProductSection`（async RSC），用 Suspense 包裹 |
| 流式填充 | 先发 shell + fallback（wf-skeleton），商品内容 ready 后流式替换 |

### 11.3 架构（PPR）

```
用户请求 → 立即返回：<main> + header + filters + <div class="wf-skeleton" />
         → 异步：ShopProductSection 内 await getProducts → 流式输出商品列表
```

- **ShopProductSection**：async Server Component，内部调用 `getProducts`，渲染 breadcrumb、WaterfallList、Pagination

---

## 十二、Next.js 16 cacheComponents 新特性与兼容说明

### 12.1 背景

Next.js 16 将 `experimental.ppr`、`useCache`、`dynamicIO` 合并为统一的 `cacheComponents` 配置。启用后，PPR 全应用生效，无需也不支持旧的段级配置。

### 12.2 新配置

```typescript
// next.config.ts
const nextConfig = {
  cacheComponents: true,  // 替代 experimental: { ppr: 'incremental' }
  // ...
};
```

### 12.3 不再兼容的段配置（需移除）

| 配置 | 说明 |
|------|------|
| `export const experimental_ppr = true` | 与 cacheComponents 互斥，必须删除 |
| `export const revalidate = 60` | 与 cacheComponents 互斥，必须删除 |

### 12.4 替代方案

| 原用途 | 替代方式 |
|--------|----------|
| 页面级 ISR | 在数据层使用 `unstable_cache(revalidate: 60)`（本项目已采用） |
| PPR 按路由启用 | cacheComponents 启用后 PPR 全应用生效，按 Suspense 划分孔洞 |

### 12.5 仍可用的能力

- `unstable_cache`、`revalidateTag`：数据层缓存照常使用
- `Suspense` + async RSC：实现 PPR 孔洞流式填充
- `metadata`、`generateMetadata`：不受影响

---

## 十三、SSR 带来的好处

| 收益 | 说明 |
|------|------|
| SEO | 首屏 HTML 含完整商品信息 |
| 首屏性能 | 不依赖 JS 即可展示内容 |
| 分享 | 带参数的 URL 可直接分享，他人打开即 SSR |
| 无闪烁 | 无「先空白再加载」的过程 |
