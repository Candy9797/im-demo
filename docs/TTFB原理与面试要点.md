# TTFB 原理与面试要点

> Time To First Byte：从发起请求到收到响应体第一个字节的时间

---

## 一、定义

**TTFB = 浏览器发起 HTTP 请求 → 收到响应体第一个字节 的时间差**

```
用户点击 → DNS → TCP 连接 → TLS 握手 → 发送请求 → [服务器处理] → 收到第一个字节
                                                    ↑
                                              TTFB 主要消耗在这里
```

---

## 二、TTFB 包含哪些阶段

| 阶段 | 说明 | 可优化点 |
|------|------|----------|
| 网络延迟 | DNS、TCP、TLS | CDN、Keep-Alive、HTTP/2 |
| **服务端处理** | 业务逻辑、DB 查询、渲染 | 缓存、异步、流式、减少阻塞 |
| 响应发送 | 第一个字节返回 | 流式输出、压缩 |

**重点**：TTFB 的瓶颈往往在服务端，不是网络。

---

## 三、为何重要

1. **影响 FCP/LCP**：首字节到达前，浏览器无法解析 HTML、加载资源
2. **Core Web Vitals 前置指标**：TTFB 差，LCP 很难好
3. **用户感知**：> 600ms 容易感觉「卡」

---

## 四、优化手段（按优先级）

| 手段 | 原理 | 典型场景 |
|------|------|----------|
| **流式 SSR** | 不等全部数据，先发 HTML 头部+骨架，边算边发 | Next.js Suspense、renderToPipeableStream |
| 缓存 | 减少 DB/计算，直接返回 | CDN、Redis、边缘缓存 |
| 异步/并行 | 不阻塞首字节，后台处理 | 非关键数据异步拉取 |
| 减少阻塞 I/O | 慢查询、RPC 拖慢首字节 | 索引优化、读写分离、降级 |
| 边缘部署 | 就近响应，降低网络 RTT | Vercel Edge、Cloudflare Workers |
| 预连接 | 提前建 TCP/TLS | dns-prefetch、preconnect |

---

## 五、Next.js 如何降低 TTFB

### 5.1 流式渲染（默认开启）

| 机制 | 说明 |
|------|------|
| **loading.tsx** | 路由级 fallback，请求到达后先流式输出 loading UI，实现秒开 |
| **Suspense** | 包裹 async Server Component，慢块独立 resolve，不阻塞首块 |
| **底层 API** | Node：`renderToPipeableStream`；Edge：`renderToReadableStream` |

```
请求 → 立即流式输出 <html> + loading 骨架 → 各 Suspense 块就绪后依次推送 → 完整页面
       ↑ TTFB 低（~200ms）              ↑ 渐进填充
```

### 5.2 RSC 流式传输

- Server Component 按「块」序列化，用 `0:` `1:` 等占位符流式推送
- 客户端逐步 hydration，慢组件不阻塞首屏
- 相比传统 SSR「等全量 HTML」，首字节更快发出

### 5.3 缓存与动态渲染

| 策略 | 对 TTFB 的影响 |
|------|----------------|
| **静态生成 (SSG)** | 预渲染 HTML，TTFB 极低（CDN 直接返回） |
| **ISR / revalidate** | 增量再验证，命中缓存时 TTFB 低 |
| **force-dynamic** | 每次动态渲染，依赖流式降低 TTFB |
| **fetch cache** | 减少服务端等 DB/API 时间，间接降低 TTFB |

### 5.4 底层流式 API 原理

#### renderToPipeableStream（Node.js）

| 项 | 说明 |
|----|------|
| **用途** | 在 Node.js 中流式渲染 React 树 |
| **输出** | 可 pipe 的 Node Writable Stream |
| **流程** | 增量渲染 → 写入流 → `res.pipe(stream)` → 分块推送给客户端 |
| **Suspense** | 先发 shell，各边界 resolve 后再推送对应 HTML 块 |
| **回调** | `onError`、`onReady` 等，用于控制流开始/结束 |

首字节可早发出，无需等整棵树渲染完。

#### renderToReadableStream（Edge / Deno）

| 项 | 说明 |
|----|------|
| **用途** | 在 Edge 中流式渲染（Vercel Edge、Cloudflare Workers、Deno） |
| **输出** | Web Streams API 的 `ReadableStream` |
| **原因** | Edge 无 Node stream，只有 Web Streams |
| **用法** | `new Response(stream)` 返回给 Fetch API |

行为与 renderToPipeableStream 一致，只是适配不同运行时的流抽象。

**对比**：Node 用 pipe + Writable，Edge 用 ReadableStream + Response。

**本项目中**：`server/index.ts` 的 `GET /stream` 使用 `renderToPipeableStream` 纯 Node 实现，访问 `http://127.0.0.1:3001/stream` 可对比 Next.js `/stream`（3000）的流式效果。

### 5.5 面试：Next.js 如何优化 TTFB？

**答**：① App Router 默认流式，loading.tsx 优先输出；② Suspense 包裹慢数据，分块 resolve；③ 底层用 renderToPipeableStream 边渲染边发送；④ 静态/ISR 命中缓存时直接返回，TTFB 接近 CDN RTT。

---

## 六、面试重难点

### Q1：TTFB 和 TTI/FCP/LCP 的关系？

**答**：TTFB 是前置指标。首字节未到，浏览器不能解析 DOM，FCP/LCP 无法开始；TTFB 越小，FCP/LCP 才有优化空间。

---

### Q2：流式 SSR 为何能显著降低 TTFB？

**答**：传统 SSR 要等所有数据就绪再一次性返回，慢接口会拉高 TTFB。流式 SSR（如 `renderToPipeableStream`）边渲染边发送，首块 HTML 几百毫秒内就能发出，TTFB 明显下降，后续慢数据异步补充。

---

### Q3：TTFB 多少算好？

**答**：  
- < 200ms：好  
- 200–500ms：可接受  
- > 600ms：需优化  

---

### Q4：TTFB 高但 FCP 还行，可能原因？

**答**：  
1. 首字节后 HTML 体量小，解析快  
2. 关键资源用 preload 并行  
3. 使用了 Service Worker 缓存

---

### Q5：如何测量 TTFB？

**答**：  
- Chrome DevTools → Network → 某请求 → Timing → `Waiting (TTFB)`  
- Performance API：`responseStart - requestStart`  
- `PerformanceResourceTiming.fetchStart` 到 `responseStart`

---

## 七、一句话总结

**TTFB 是首字节到达时间，瓶颈多在服务端；流式输出、缓存和减少阻塞 I/O 是主要优化方向。**
