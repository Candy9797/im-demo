# 流式 SSR（Next.js）与流式 SSR（Node）逻辑区别

两个入口都演示「流式服务端渲染」：先输出壳/骨架，再按块逐步推送 HTML，首屏秒开。**差异在于谁负责路由、谁调 React 流式 API、以及“慢数据”如何挂起**。

---

## 1. 流式 SSR（Next.js）— `/stream`

| 项目 | 说明 |
|------|------|
| **入口** | Next.js App Router：`src/app/stream/page.tsx`，路由 `/stream` |
| **谁处理请求** | Next.js 自身（dev 时 `next dev`，生产 `next start`），响应由框架构造并流式写出 |
| **流式 API** | 框架内部使用 `renderToPipeableStream`（Node）或 `renderToReadableStream`（Edge），对业务不可见 |
| **“慢数据”怎么写** | **异步 Server Component**：每个 Block 是 `async function`，内部 `await delay(ms)`，数据就绪后 return JSX。例如 `async function BlockIntro() { await delay(200); return <div>...</div>; }` |
| **首屏骨架** | 路由级 `loading.tsx`：Next 会**先**流式输出该 UI（骨架屏），再流式输出 page 中各个 Suspense 边界内的内容 |
| **Suspense 边界** | 每个 Block 包一层 `<Suspense fallback={<BlockSkeleton />}>`，某块未 resolve 时先输出 fallback，resolve 后替换为该块 HTML |
| **效果** | 用户先看到 loading 骨架，再按 200ms / 300ms / … 逐步看到各块内容；无需手写 Node 流式逻辑，全部由 Next 约定完成 |

**逻辑要点**：Next 负责路由、流式响应和 RSC 调度；业务只写 async Server Component + Suspense + loading.tsx，不直接碰 `renderToPipeableStream`。

---

## 2. 流式 SSR（Node）— `http://127.0.0.1:3001/stream`

| 项目 | 说明 |
|------|------|
| **入口** | Express 路由：`server/index.ts` 里 `app.get("/stream", ...)`，端口 3001 |
| **谁处理请求** | 自建 Node 服务（Express），直接 `res.setHeader("Content-Type", "text/html; charset=utf-8")`，再把 React 流 pipe 到 `res` |
| **流式 API** | **显式调用** `renderToPipeableStream(createStreamDocument(), { onError })`，再 `pipe(res)`，由 Node 把 HTML 流写入 HTTP 响应 |
| **“慢数据”怎么写** | **React 19 use(Promise)**：每个 Block 是同步组件，内部用自定义 hook（如 `use200()`）调用 `use(delay(200))`，Promise 未 resolve 时 React 挂起该子树，Suspense 显示 fallback；resolve 后该块继续渲染并流出 |
| **首屏骨架** | 无单独 loading 路由；同一棵 React 树里用 `<Suspense fallback={<BlockSkeleton />}>` 包住各 Block，首帧先流出 shell + fallback，再按块替换 |
| **Suspense 边界** | 与 Next 类似，每个 Block 一层 Suspense，fallback 为骨架；区别是整棵树在 Node 里一次 `renderToPipeableStream` 渲染并 pipe 出去 |
| **效果** | 同样是先骨架、再按块逐步出现内容；但路由、响应头、流式写入都由你自己在 Node 里控制，不经过 Next |

**逻辑要点**：Node 负责 HTTP 和流式写出；业务写一棵 React 树（含 Suspense + use(Promise)），在 Node 里用 `renderToPipeableStream` 把这棵树流式渲染到 `res`。

---

## 3. 对比小结

| 维度 | 流式 SSR（Next.js） | 流式 SSR（Node） |
|------|---------------------|-------------------|
| **请求入口** | Next 路由 `/stream`（同域，如 3000） | Express `GET /stream`（如 3001） |
| **谁建流** | Next 框架内部 | 你调 `renderToPipeableStream` 并 `pipe(res)` |
| **挂起方式** | async Server Component + `await` | 同步组件 + `use(Promise)` 挂起 |
| **骨架来源** | 路由级 `loading.tsx` 先流出 | 同一 React 树内 Suspense fallback |
| **适用场景** | 全站用 Next、希望用框架约定和 RSC | 只要某一路由做流式、或非 Next 的 Node 服务单独提供流式页 |

**共同点**：都依赖 React 18+ 的 `renderToPipeableStream`（或 Edge 的 `renderToReadableStream`）+ Suspense，实现「先壳/骨架，再按块推送 HTML」；用户体感都是首屏快、内容渐进出现。

**一句话**：Next 版是「在框架里写 async 组件 + loading」；Node 版是「在自建 Node 服务里手写流式响应 + use(Promise) 挂起」，同一套流式原理，不同运行栈与写法。
