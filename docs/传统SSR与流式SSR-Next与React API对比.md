# 传统 SSR 与流式 SSR：Next.js / React API 对比

本文从 **API 用法** 和 **代码形态** 对比：在 Next.js App Router 里如何写「传统 SSR」和「流式 SSR」，分别用到哪些 React/Next 能力，以及对照数据。

---

## 一、用到的 React / Next.js API 一览

| API / 能力 | 来源 | 传统 SSR 是否用 | 流式 SSR 是否用 | 说明 |
|------------|------|-----------------|------------------|------|
| **async Server Component** | React / RSC 协议 | ✅ 用（一个组件内 await 全部） | ✅ 用（多个 async 组件，各 await 自己的） | 服务端异步组件，可 await 数据 |
| **Suspense** | React 18 | ✅ 用（**一个**边界包住整块） | ✅ 用（**多个**边界，每块一个） | 未 resolve 时先渲染 fallback |
| **fallback** | React (Suspense) | ✅ 一个 fallback | ✅ 每块一个 fallback（可共用组件） | Suspense 的占位 UI |
| **loading.tsx** | Next.js App Router | ❌ 可选（本 demo 未用） | ✅ 用（路由级骨架） | 路由级 fallback，先于 page 流出 |
| **page.tsx 默认 RSC** | Next.js | ✅ 同步或 async | ✅ 同步（内部用 Suspense） | 页面入口 |
| **renderToPipeableStream** | React 18 (Node) | Next 内部用（整树或单边界） | Next 内部用（多边界流式写） | 开发者不直接写，Next 底层用 |
| **renderToReadableStream** | React 18 (Edge) | 同上 | 同上 | Edge 运行时等价 API |

**结论**：传统和流式都用到 **async Server Component + Suspense**，区别是 **Suspense 的个数与粒度**（一个整块 vs 多个块）以及是否用 **loading.tsx**。

---

## 二、传统 SSR：API 用法与代码形态

### 2.1 用到的 API

- **React**：`Suspense`（一个）、async 函数组件（一个，内部串行/并行 await 所有数据）。
- **Next.js**：App Router 的 `page.tsx`（默认 RSC），无 `loading.tsx` 也可。

### 2.2 代码形态（本项目）

```tsx
// 1. 页面是同步组件，内部只有一个 Suspense
export default function SSRTraditionalPage() {
  return (
    <main>
      <h1>传统 SSR 演示</h1>
      <Suspense fallback={<TraditionalSSRFallback />}>
        <TraditionalSSRContent />   {/* 唯一一个 async 子组件，内部 await 全部 */}
      </Suspense>
    </main>
  );
}

// 2. 唯一的 async 子组件：串行 await 所有慢数据，再一次性 return
async function TraditionalSSRContent() {
  const d1 = await fetchBlock1();  // 300ms
  const d2 = await fetchBlock2();  // 500ms
  const d3 = await fetchBlock3();  // 700ms
  return (
    <div>
      <section>{/* 区块一 */}</section>
      <section>{/* 区块二 */}</section>
      <section>{/* 区块三 */}</section>
    </div>
  );
}
```

### 2.3 关键点

| 项目 | 说明 |
|------|------|
| **Suspense 数量** | **1 个**，包住整块慢内容 |
| **async 组件数量** | **1 个**（TraditionalSSRContent），内部串行或并行 await |
| **loading.tsx** | 不用也可；若用，则路由级先出 loading，再出整块内容（仍是一整块） |
| **数据等待** | 在**一个** async 组件里等完所有数据后再 return |
| **输出时序** | 先 fallback，等该 async 组件 resolve 后**整块**替换，不会「先出 A 再出 B」 |

---

## 三、流式 SSR：API 用法与代码形态

### 3.1 用到的 API

- **React**：`Suspense`（**多个**）、async 函数组件（**多个**，每个只 await 自己的数据）。
- **Next.js**：App Router 的 `page.tsx`、**loading.tsx**（路由级骨架，先于 page 流出）。

### 3.2 代码形态（本项目）

```tsx
// 1. 路由级：loading.tsx 会先被流式输出（可选但推荐）
//    src/app/demo/ssr-streaming/loading.tsx
export default function StreamingLoading() {
  return <main>{/* 骨架 UI */}</main>;
}

// 2. 页面是同步组件，内部多个 Suspense，每个包一个 async 组件
export default function SSRStreamingPage() {
  return (
    <main>
      <h1>流式 SSR 演示</h1>
      <div>
        <Suspense fallback={<BlockSkeleton />}>
          <Block1 />   {/* async，只 await 300ms */}
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <Block2 />   {/* async，只 await 500ms */}
        </Suspense>
        <Suspense fallback={<BlockSkeleton />}>
          <Block3 />   {/* async，只 await 700ms */}
        </Suspense>
      </div>
    </main>
  );
}

// 3. 每个块是独立的 async 组件，只等自己的数据
async function Block1() {
  await delay(300);
  return <section>区块一</section>;
}
async function Block2() {
  await delay(500);
  return <section>区块二</section>;
}
async function Block3() {
  await delay(700);
  return <section>区块三</section>;
}
```

### 3.3 关键点

| 项目 | 说明 |
|------|------|
| **Suspense 数量** | **多个**（本 demo 为 3），每块一个边界 |
| **async 组件数量** | **多个**（Block1 / Block2 / Block3），各自 await 自己的数据 |
| **loading.tsx** | **使用**，路由级骨架先流出，再流各块 |
| **数据等待** | 每个 async 组件**只等自己的**数据，互不阻塞 |
| **输出时序** | loading → 壳 → 各块按 resolve 顺序**分块**输出（300ms / 500ms / 700ms） |

---

## 四、API 与用法对比表

| 对比项 | 传统 SSR | 流式 SSR |
|--------|----------|----------|
| **Suspense** | 1 个，包住整块慢内容 | 多个，每块一个 |
| **async Server Component** | 1 个，内部 await 全部数据 | 多个，每个只 await 自己块的数据 |
| **loading.tsx** | 可选；若用，先出 loading 再出整块 | 推荐，先出路由级骨架再出各块 |
| **fallback** | 一个（整块占位） | 每块一个（可共用同一骨架组件） |
| **数据请求方式** | 在一个组件内 `await a(); await b(); await c();` 或 `Promise.all([a(),b(),c()])` | 各块内独立 `await`，块与块并发 |
| **Next 底层** | 同一套流式 API，但整块 resolve 后才写这一块 | 多块各自 resolve，每块 resolve 就写一块 |
| **React 底层** | renderToPipeableStream，先写 fallback，再写整块内容 | renderToPipeableStream，先写 fallback，再按块写多段内容 |

---

## 五、怎么选、怎么用（速查）

- **要做传统 SSR（整页等完再出）**：  
  - 一个 `<Suspense fallback={...}>`，里面**一个** async 组件，在该组件里 **await 所有需要的数据**（串行或 Promise.all），然后 return 整块 JSX。  
  - 不用或可选 `loading.tsx`。

- **要做流式 SSR（先壳再分块出）**：  
  - **多个** `<Suspense fallback={...}>`，每个里面**一个** async 组件，每个组件**只 await 自己块的数据**。  
  - 建议配 **loading.tsx** 作为路由级骨架。  
  - 把「慢数据」按区块拆开，每块一个 async 组件 + 一个 Suspense。

---

## 六、本项目对应文件与 API 对照

| 能力 | 传统 SSR 实现位置 | 流式 SSR 实现位置 |
|------|-------------------|-------------------|
| 页面入口 | `src/app/demo/ssr-traditional/page.tsx` | `src/app/demo/ssr-streaming/page.tsx` |
| 路由级骨架 | 无 | `src/app/demo/ssr-streaming/loading.tsx` |
| 单一大 async 组件 | `TraditionalSSRContent`（await 三块） | — |
| 多个 async 组件 | — | `Block1` / `Block2` / `Block3` |
| Suspense 边界 | 1 个（包 TraditionalSSRContent） | 3 个（各包 Block1/2/3） |
| fallback | `TraditionalSSRFallback` | `BlockSkeleton`（共用） |

以上即「用 React / Next 做传统 SSR 和流式 SSR」的 API 区别、用法和对比数据；代码以本项目 `demo/ssr-traditional` 与 `demo/ssr-streaming` 为准。
