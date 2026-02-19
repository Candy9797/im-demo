# use() + Suspense 原理详解

> React 19 的 `use()` 与 Suspense 配合，实现声明式数据获取与流式渲染

---

## 零、SSR 方案演进与现状

### 0.1 演进历史

| 阶段 | 代表技术 | 特点 | 痛点 |
|------|----------|------|------|
| **1. 传统 SSR** | PHP/JSP、Express + `renderToString` | 服务端拼接 HTML，首屏直出 | 等全部数据再返回，慢接口拉高 TTFB |
| **2. 同构渲染** | Next.js (Pages)、Nuxt | 一套代码服务端+客户端，`getServerSideProps` | 仍是一次性返回，无流式 |
| **3. 静态预渲染** | SSG、ISR | 构建时或按需生成，TTFB 极低 | 动态数据需 revalidate，非实时 |
| **4. 流式 SSR** | React 18 `renderToPipeableStream` | 边渲染边发送 HTML，TTFB 提前 | 需配合 Suspense，生态适配中 |
| **5. RSC + 流式** | Next.js App Router、React 19 | Server Component 按块序列化，流式推送 | 概念多，心智负担 |

### 0.2 方案对比

| 方案 | 数据获取 | 输出方式 | TTFB | 代表框架 |
|------|----------|----------|------|----------|
| **CSR** | 客户端 fetch | 无 SSR | 快（空 HTML） | CRA、Vite |
| **传统 SSR** | 服务端等数据 | 一次性 HTML | 慢接口拖累 | Express + React |
| **SSG/ISR** | 构建时/增量 | 预生成 HTML | 极低 | Next.js、Astro |
| **流式 SSR** | Suspense 挂起 | 分块 HTML | 低 | React 18+、Next.js |
| **RSC 流式** | async Server Component | 分块 RSC 序列 | 低 | Next.js App Router |

### 0.3 最新技术栈（2024–2025）

| 技术 | 说明 |
|------|------|
| **React 19** | `use()` 消费 Promise，与 Suspense 配合做数据挂起 |
| **Next.js 15/16** | App Router、RSC、流式默认开启，`loading.tsx` 秒开 |
| **renderToPipeableStream** | Node 端流式渲染，边算边发 |
| **renderToReadableStream** | Edge 端流式，适配 Vercel/Cloudflare |
| **Server Component** | 服务端组件，async 自动挂起，按块序列化 |
| **选择性 Hydration** | 先 hydrate 交互关键区域，其余延迟 |

**推荐组合**：Next.js App Router + RSC + Suspense + `use()`，兼顾流式、SEO 与开发体验。

---

## 一、核心概念

### 1.1 use() 是什么

`use()` 是 React 19 新增的 Hook，用于**读取 Promise 或 Context**。

```tsx
import { use } from 'react';

function UserProfile({ userId }) {
  const user = use(fetchUser(userId));  // 传入 Promise，挂起直到 resolve
  return <div>{user.name}</div>;
}
```

- **传 Promise**：pending 时组件「挂起」，resolve 后继续渲染
- **传 Context**：等同 `useContext`，但可在条件/循环中调用

### 1.2 Suspense 是什么

Suspense 是**边界组件**，用于捕获子树的「挂起」并展示 fallback。

```tsx
<Suspense fallback={<Skeleton />}>
  <UserProfile userId="1" />   {/* 内部 use(promise) 挂起时，显示 Skeleton */}
</Suspense>
```

---

## 二、use() + Suspense 协作流程

```
1. 渲染 UserProfile
2. 执行 use(fetchUser(userId))，Promise 未 resolve → 组件挂起
3. React 向上查找最近的 Suspense，显示 fallback
4. Promise resolve 后，React 重新渲染 UserProfile
5. use(fulfilledPromise) 立即返回结果，不再挂起
6. 渲染真实内容，替换 fallback
```

**关键**：挂起时不会报错，只会暂停渲染并展示 fallback，直到数据就绪。

---

## 三、Promise 必须「稳定」

`use()` 要求**同一 Promise 引用**在挂起和重试时保持一致，否则会死循环。

### ❌ 错误写法

```tsx
function Block() {
  use(delay(200));  // 每次渲染都创建新 Promise → 无限挂起
  return <div>...</div>;
}
```

每次重试都会 `delay(200)` 生成新 Promise，导致反复挂起。

### ✅ 正确写法

```tsx
function Block() {
  const [p] = useState(() => delay(200));  // 只在首次创建，引用稳定
  use(p);
  return <div>...</div>;
}
```

`useState` 保证同一渲染周期内 Promise 引用不变，挂起与重试共用同一个。

### 或：工厂 + cache

```tsx
const cache = new Map();
function useDelay(ms: number) {
  const key = ms;
  if (!cache.has(key)) cache.set(key, delay(ms));
  use(cache.get(key));
}
```

适用于多实例、需要按 key 区分的场景。

---

## 四、在流式 SSR 中的行为

### 4.1 服务端（renderToPipeableStream）

```
请求到达
  → 渲染树，遇到 use(pendingPromise)
  → 该子树挂起，输出 <template> 占位或 fallback HTML
  → 流式推送给客户端（TTFB 提前）
  → Promise resolve 后继续渲染
  → 输出真实 HTML 块，再次推送
```

**结果**：首屏 HTML 先发，慢数据块后续补发，TTFB 降低。

### 4.2 客户端（Hydration）

```
HTML 已收到（含 fallback 或占位）
  → React 开始 hydration
  → 遇到 use(pendingPromise) 再次挂起
  → 显示 fallback
  → Promise resolve 后完成 hydration，显示真实 UI
```

服务端与客户端共用同一套 `use()` + Suspense 逻辑。

---

## 五、startTransition 与 useDeferredValue

二者都是 React 18+ 的**并发特性**，用于将更新标记为「非紧急」，避免阻塞用户交互，减轻 fallback 闪烁感。

### 5.1 startTransition

**作用**：把一次 `setState` 标记为过渡更新，React 会优先处理紧急更新（如输入），再处理这次更新。

```tsx
import { startTransition, useState } from 'react';

function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const handleChange = (e) => {
    setQuery(e.target.value);  // 紧急：立即更新输入框

    fetchResults(e.target.value).then((data) => {
      startTransition(() => setResults(data));  // 非紧急：setResults 被标记为过渡
    });
  };

  return (
    <>
      <input value={query} onChange={handleChange} />
      <Results list={results} />  // 更新可能稍晚，但输入不卡顿
    </>
  );
}
```

| 项 | 说明 |
|----|------|
| **触发方** | 开发者主动包裹 `setState` |
| **优先级** | 过渡更新 < 默认更新 |
| **效果** | 输入等紧急更新先执行，结果列表后渲染 |
| **适用** | 搜索、Tab 切换、筛选等「可延迟」的 UI 更新 |

### 5.2 useDeferredValue

**作用**：返回一个「延后」版本的值，当上游状态快速变化时，该值会滞后更新，减少重渲染压力。

```tsx
import { useDeferredValue, useState } from 'react';

function SearchPage() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);  // query 变化时，deferredQuery 会滞后

  const results = useMemo(() => filterHugeList(deferredQuery), [deferredQuery]);

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <Results list={results} />  // 依赖 deferredQuery，更新被推迟
    </>
  );
}
```

| 项 | 说明 |
|----|------|
| **触发方** | 由 props/state 推导，无需手动包裹 |
| **机制** | 上游值变 → 生成「待更新」的 defer 值 → 空闲时再 commit |
| **效果** | 重计算、重渲染被延后，输入保持流畅 |
| **适用** | 大列表过滤、复杂计算、子组件依赖父状态但可滞后 |

### 5.3 二者对比

| | startTransition | useDeferredValue |
|---|-----------------|------------------|
| **用法** | 包裹 `setState` 的调用 | 包装一个值 |
| **控制点** | 更新发起方 | 值消费方 |
| **场景** | 你知道哪里触发「慢更新」 | 你有一个「慢消费」的值 |
| **本质** | 标记某次更新为过渡 | 对值的读取做延迟 |

### 5.4 与 Suspense fallback 的关系

- Suspense fallback 闪一下，是因为数据从 pending → 就绪时，会立刻用真实内容替换骨架。
- 用 `startTransition` 包裹「引起挂起」的状态更新，可让 React 在切换时保持 fallback 更久一点，或分批渲染，减少「闪一下」的突兀感。
- `useDeferredValue` 适用于：父组件传给子组件的值变化很快（如输入），而子组件又依赖 Suspense/慢数据时，用 deferred 值可降低更新频率，间接减轻闪烁。

### 5.5 面试要点

**Q：startTransition 和防抖有什么不同？**  
**答**：防抖是「延迟执行」，startTransition 是「立即调度但低优先级」。过渡更新仍会执行，只是可被高优先级更新打断、延后，不丢更新。

**Q：useDeferredValue 和 useMemo 的区别？**  
**答**：useMemo 是「缓存计算结果」，依赖不变就不重算；useDeferredValue 是「延迟传播值」，值会变，只是变更时机被延后，用于配合并发渲染。

---

## 六、与传统方式对比

| 方式 | 写法 | 特点 |
|------|------|------|
| **useEffect + 状态** | 先渲染 loading，fetch 完 setState | 需手动 loading/error，易重复请求 |
| **React Query / SWR** | 封装请求 + 缓存 | 强大，但引入额外库 |
| **use() + Suspense** | 声明式 `use(promise)` | 无 loading 状态、支持 SSR 流式、内置重试 |

---

## 七、面试要点

### Q1：use() 和 useEffect 里的 fetch 有何不同？

**答**：`use()` 在渲染阶段消费 Promise，pending 时直接挂起组件，由 Suspense 捕获；`useEffect` 在 commit 后执行，需自己维护 loading 状态，且首屏必为 loading。

### Q2：为什么 use(promise) 时 Promise 必须稳定？

**答**：React 靠 Promise 引用识别「同一请求」。每次渲染都创建新 Promise 会导致反复挂起、重复请求，形成死循环。用 `useState` 或 cache 保证引用稳定。

### Q3：use() 和 async/await 在组件里能互换吗？

**答**：不能。组件不能是 async 的（返回 Promise 而非 React 节点）。`use()` 在同步组件内消费 Promise，由 React 调度挂起与恢复。

### Q4：Suspense 的 fallback 会闪吗？

**答**：会。数据就绪后 fallback 被真实内容替换。可用 `startTransition` 或 `useDeferredValue` 做过渡，或尽量减少 fallback 与实际内容的布局差异（如骨架屏）。

---

## 八、一句话总结

**`use()` 在渲染阶段消费 Promise，pending 时挂起组件；Suspense 捕获挂起并显示 fallback；二者配合实现声明式数据获取和流式 SSR，前提是 Promise 引用稳定。**
