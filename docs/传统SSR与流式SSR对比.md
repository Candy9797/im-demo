# 传统 SSR 与流式 SSR：原理与区别（P7/P8 级详解）

本文从原理、协议、实现和工程权衡四方面，把「传统 SSR」和「流式 SSR」讲透，便于架构决策和面试深挖。

---

## 一、背景：为什么会有两种 SSR 模式

### 1.1 SSR 要解决什么问题

- **CSR 的问题**：首屏依赖 JS 执行完再请求数据、再渲染，TTFB 可能还行，但 **FCP/LCP 晚**、**SEO 依赖爬虫执行 JS**。
- **SSR 的目标**：在服务端把「数据 + 组件」渲染成 HTML，一次性或分块发给浏览器，从而 **首屏即内容**、**爬虫拿到完整 HTML**。

### 1.2 传统 SSR 的瓶颈

传统做法是：**等服务端整页数据都就绪、整棵组件树都渲染完，再一次性把完整 HTML 写入响应体、关闭连接**。

- 只要页面里有一个「慢数据」（慢接口、慢 DB、慢 RPC），**整页的 TTFB 都会被拖到至少等于这个最慢数据的时间**（若串行则是所有时间之和）。
- 用户在这段时间内：**收不到任何字节 → 浏览器白屏 → 体感卡顿**。  
即：**传统 SSR 用「首屏完整性」换来了「首字节延迟」**。

### 1.3 流式 SSR 要解决的问题

- **目标**：在「首屏仍是服务端渲染的 HTML、SEO 友好」的前提下，**把 TTFB 降下来**，让用户尽快看到「壳 + 骨架或先完成的内容」。
- **思路**：不一次性等整页，而是 **边渲染边通过 HTTP 流把 HTML 分块（chunk）推给浏览器**，浏览器边收边解析、边渲染，实现 **渐进式首屏**。

下面分别讲两种模式的**原理**和**区别**。

---

## 二、传统 SSR 的原理（深入）

### 2.1 响应模型：一次性完整响应

- 服务端在内存里跑完整个「数据拉取 → 组件树渲染 → HTML 序列化」的管线。
- **只有在整份 HTML 都准备好之后**，才调用 `res.write()`（或等价 API）把完整 HTML 写入响应体，然后 `res.end()` 关闭连接。
- HTTP 语义上：**Content-Length 已知**（或最后用 chunked 但也是一次性写完），**没有「先发一部分再发另一部分」的中间状态**。

### 2.2 渲染管线（概念）

1. **请求进入** → 路由匹配到页面组件（如 Next.js 的 `page.tsx`）。
2. **数据依赖**：若页面是 async Server Component，会 `await` 所有数据（串行或 `Promise.all` 并行）。
3. **树渲染**：数据就绪后，React 在服务端把整棵组件树渲染成 React 元素树，再序列化成 HTML 字符串（或流式 API 的「一次性缓冲」用法）。
4. **写出响应**：把整份 HTML 作为响应体写出，**此时 TTFB = 步骤 1～3 的总耗时**。

### 2.3 TTFB 与「最慢数据」的关系

- **串行 await**：例如先 300ms、再 500ms、再 700ms，则 **TTFB ≥ 300 + 500 + 700 = 1500ms**。
- **并行 await（Promise.all）**：三个请求同时发，**TTFB ≥ max(300, 500, 700) = 700ms**。  
即：**传统 SSR 的 TTFB 下界 = 最慢的那条数据路径**（串行则是路径之和）。

### 2.4 特点小结

| 维度 | 说明 |
|------|------|
| **实现** | 一个 async 页面组件，内部 `await` 所有数据后 return 整页 JSX；或外层用单个 Suspense 包住「整块慢内容」（见下）。 |
| **HTTP** | 响应体是「整页 HTML」一次性写出，首字节时间 = 整页就绪时间。 |
| **TTFB** | 高，且由最慢数据（或串行总和）决定。 |
| **白屏** | 在收到首字节之前，用户看不到任何内容，白屏时长 ≈ TTFB。 |
| **SEO** | 首包即完整 HTML，爬虫无需等待流结束，行为最简单、可预期。 |

### 2.5 本项目中的「传统 SSR」演示

- 路由：`/demo/ssr-traditional`。
- 为满足 Next 15 的「未缓存数据必须在 Suspense 内」的要求，实现上用了 **一个大的 `<Suspense>`**，内部是 **一个** async 子组件 `TraditionalSSRContent`，在该子组件内 **串行** `await` 三份慢数据（300 + 500 + 700 ms）。
- **语义上仍是「传统 SSR」**：整块内容要么一起不出（fallback），要么 **1.5s 后整块一起** 替换 fallback；**没有「先出一块再出另一块」**，TTFB 和「整块出现时间」仍然由 1.5s 决定。

---

## 三、流式 SSR 的原理（深入）

### 3.1 响应模型：分块流式响应

- 服务端**不等到整页 HTML 都就绪**，而是：
  1. 先渲染并输出「壳」（文档结构、布局、以及占位/骨架）。
  2. 各块「慢数据」在各自的 async 子组件中 resolve，**每 resolve 一块就立刻把该块对应的 HTML 追加写入同一个响应流**。
- HTTP 上通常使用 **Transfer-Encoding: chunked**：不设 Content-Length，每次写出一段就发一个 chunk，浏览器边收边解析。

### 3.2 依赖的 React 能力（React 18+）

- **流式渲染 API**：  
  - Node：`renderToPipeableStream`，把 React 树渲染到一个 **Writable 流**，每块 HTML 准备好就 `write` 一块。  
  - Edge：`renderToReadableStream`，产出 ReadableStream，等价于「边渲染边推 chunk」。
- **Suspense 与流的配合**：  
  - 渲染遇到「尚未 resolve 的异步子组件」时，**不阻塞整棵树**，而是先输出该 Suspense 的 **fallback**（如骨架）到流。  
  - 当该子组件在服务端 resolve 后，React 再输出 **真实内容** 对应的 HTML 片段，**替换** fallback 在流中的占位（通过内联 script 或约定好的标记，在浏览器端做「替换」或「插入」）。  
- 因此：**流式 SSR = 流式写入 + 多段「先 fallback 后真实内容」的时序**。

### 3.3 渲染管线（概念）

1. **请求进入** → 路由匹配，若有 `loading.tsx`，先流式输出 loading UI（路由级 fallback）。
2. **页面组件开始渲染**：遇到 `<Suspense><AsyncBlock /></Suspense>` 时，不等待 `AsyncBlock`，先输出 fallback 的 HTML 到流 → **此时浏览器已可收到首字节，TTFB 很低**。
3. **各 AsyncBlock 在服务端并发执行**：Block1(300ms)、Block2(500ms)、Block3(700ms) 各自 `await`，谁先 resolve 谁先被序列化成 HTML 写入流。
4. **浏览器**：先收到壳 + 多个 fallback，再按时间顺序收到各块真实 HTML，**渐进式**从骨架变为最终内容。

### 3.4 TTFB 与 FCP/LCP 的关系

- **TTFB**：≈ 壳 + 第一个可写出的内容（如 loading 或第一个 fallback）的渲染时间，**与最慢的 700ms 块无关**，通常可做到几十～一两百 ms。
- **FCP**：首次有「像素绘制」，往往由壳 + 骨架或第一个完成的块触发，**明显早于**「等整页」的传统 SSR。
- **LCP**：通常是首屏内最大的一块内容；流式下可以是「第一个大块」出现的时间，**不必等最慢的那块**，所以 LCP 也会提前。

### 3.5 特点小结

| 维度 | 说明 |
|------|------|
| **实现** | 多个 `<Suspense>` 边界，每个包一个 async 子组件；可选路由级 `loading.tsx`。 |
| **HTTP** | Transfer-Encoding: chunked，先发壳 + fallback，再按 resolve 顺序发各块 HTML。 |
| **TTFB** | 低，由壳和 fallback 的渲染时间决定，不等慢数据。 |
| **白屏** | 短，用户很快看到骨架或首块内容。 |
| **SEO** | 流结束后仍是完整 HTML；若爬虫等流结束再解析，与传统 SSR 一致；若在流未结束就解析，可能只看到部分 fallback，需结合爬虫策略评估。 |

### 3.6 本项目中的「流式 SSR」演示

- 路由：`/demo/ssr-streaming`。  
- **路由级**：`loading.tsx` 先被流式输出（标题骨架 + 三块占位），TTFB 很低。  
- **页面级**：三个独立的 `<Suspense fallback={<BlockSkeleton />}><Block1|2|3 /></Suspense>`，Block1/2/3 分别 `await delay(300/500/700)`。  
- 效果：先看到 loading 骨架，约 300ms、500ms、700ms 时**分别**出现三块真实内容，**块与块之间互不阻塞**。

---

## 四、核心区别（多维度对比）

### 4.1 对比表

| 维度 | 传统 SSR | 流式 SSR |
|------|----------|----------|
| **响应方式** | 整页 HTML 一次性写出，再关闭连接 | 先写壳 + fallback，再按块追加 HTML（chunked） |
| **TTFB** | 高，≥ 最慢数据时间（或串行总和） | 低，由壳/fallback 决定，不等慢数据 |
| **首字节内容** | 完整 HTML 的第一字节（往往很晚） | 壳 + 骨架/占位，很快 |
| **白屏时长** | 长，≈ TTFB | 短，很快有可看内容 |
| **内容呈现** | 整页一次性出现 | 渐进：骨架 → 各块依次替换为真实内容 |
| **实现形态** | 单一大 async 或单一大 Suspense 包住整块慢内容 | 多个 Suspense 边界，每块独立 async |
| **底层 API** | 同是服务端渲染，但一次性缓冲再 flush | `renderToPipeableStream` / `renderToReadableStream` 分块写流 |
| **SEO** | 首包即完整 HTML，爬虫行为最简单 | 流结束后完整；流未结束前爬虫可能只看到部分，需策略配合 |

### 4.2 「一次性」vs「分块」的本质

- **传统 SSR**：  
  - 服务端把「整页」视为**一个原子单元**：只有全部就绪才写响应。  
  - 因此**任意一个慢数据都会把整页的 TTFB 往后推**。

- **流式 SSR**：  
  - 把页面拆成**多个可独立 resolve 的单元**（Suspense 边界），每个单元要么先出 fallback，要么等自己就绪后出一块 HTML。  
  - **首字节和首屏不依赖最慢的单元**，只依赖壳和已就绪的块。

### 4.3 为何流式能降低 TTFB（用本项目数字直观理解）

- **传统**：三块串行 300 + 500 + 700 = 1500ms，用户 1.5s 内收不到内容区的任何字节（或整块 1.5s 后才替换 fallback）。  
- **流式**：  
  - 0ms 附近：壳 + loading/骨架发出 → **TTFB ≈ 几十～百 ms**。  
  - 300ms：Block1 HTML 发出；500ms：Block2；700ms：Block3。  
  - 用户在前几百 ms 就看到「有东西」，700ms 时三块都齐，**体感远好于等 1.5s 才看到整页**。

---

## 五、实现细节（Next.js / React 层）

### 5.1 Next.js App Router 如何体现两种模式

- **传统 SSR 语义**：  
  - 页面是 async，且**所有**慢数据在**同一棵子树**里被 await（例如一个 async 组件内串行/并行 await 所有接口），或**一个** Suspense 包住整块慢内容。  
  - 该子树整体 resolve 前，要么不写（老实现），要么只写该 Suspense 的 fallback（Next 15）；**不会**先写 A 块再写 B 块。

- **流式 SSR 语义**：  
  - 页面拆成**多个** `<Suspense>`，每个内部是独立的 async 组件。  
  - Next 在底层用 React 的流式 API，先输出路由级 `loading.tsx`（若有），再按 Suspense 边界和 resolve 顺序输出各块。

### 5.2 Next 15 的「blocking-route」与 Suspense

- Next 15 要求：**未缓存的数据访问**（或 `connection()` 等）不能阻塞整条路由，必须放在 **Suspense 边界内**，否则报错 `Uncached data or connection() was accessed outside of <Suspense>`。  
- 因此即使用「传统 SSR」**语义**（整块 1.5s 后才出内容），实现上也要用 **一个** Suspense 包住整块慢内容，内部一个 async 组件串行 await。这样既满足框架要求，又保留「整块一起出、不先出 A 再出 B」的对比效果。

### 5.3 协议层：chunked 与「替换」机制

- 流式响应使用 **Transfer-Encoding: chunked**：每个 chunk 前有长度，浏览器按序拼接。  
- React/Next 在流中会插入**占位符或 script**，用于在客户端把后到的 HTML 块**插入**到对应 Suspense 的 fallback 位置（或替换占位），从而实现「骨架 → 真实内容」的无刷新替换。具体格式由 React 服务端流式渲染协议决定，开发只需用 Suspense + async 组件即可。

### 5.4 注水（Hydration）流程

**注水**：服务端只产出「静态」HTML，没有事件、没有客户端 state。浏览器收到 HTML 后先解析、绘制，此时按钮点不了、输入框不能输入。**注水**就是客户端加载 React 后，对这份已存在的 DOM 做「绑定」：挂上事件、恢复客户端状态，使页面变为可交互。下面分别写两种方案里注水是怎么做的。

#### 传统 SSR 的注水流程

1. **服务端**：整页数据就绪 → 整棵组件树渲染成 HTML → 一次性写出响应 → 关闭连接。
2. **浏览器**：收到**完整 HTML** → 解析 DOM → 绘制首屏（此时页面可见但**不可交互**：无 onClick、无 useState）。
3. **加载脚本**：HTML 中的 `<script>` 指向 React 运行时 + 页面 chunk，浏览器下载并执行。
4. **注水**：React 在客户端用**同一棵组件树**（同一路由、同一 props）对**当前 DOM 做一次 reconcile**：不重新生成 DOM，而是**把现有 DOM 节点与 React 树一一对应**，在对应节点上挂载事件监听、挂载 hooks 的 state。  
   - 若服务端 HTML 与客户端首次渲染结果一致，则 **reconcile 通过**，注水完成，页面可点击、可输入。  
   - 若不一致（例如服务端渲染的某块数据与客户端请求结果不同），React 会**报 hydration mismatch** 或在开发态告警。
5. **时序**：  
   - 传统 SSR 下，**整页 DOM 先完整到达**，然后脚本加载，然后**整树一次性注水**。  
   - 注水开始时间 ≥ 「HTML 收完 + 脚本加载并执行」；注水完成前，整页都不可交互。

**小结**：传统 SSR = **先整页 HTML，再整树一次注水**；注水是「整页一起可交互」的单一时刻。

#### 流式 SSR 的注水流程

1. **服务端**：先写出壳 + fallback（及内联的流式占位），再按块写出各 Suspense 的真实内容；响应是 chunked，不一次性结束。
2. **浏览器**：**边收边解析**：先收到壳 + fallback → 解析、绘制（首屏很快，但部分区域仍是骨架）；后续 chunk 到达 → 通过流式协议**替换**对应占位，DOM 被增量更新。
3. **加载脚本**：与传统一样，HTML 中的 script 加载 React + 页面 chunk。  
   - 流式下，**不必等整份 HTML 收完**即可开始解析已到达的 HTML；但通常要等**文档中 script 所在位置之前的 HTML** 都到了，script 才会执行（具体取决于流式实现里 script 的插入时机）。
4. **注水**：  
   - **React 18 选择性注水（Selective Hydration）**：React 可以对「已经到达并插入 DOM 的」部分先做注水，不必等整棵流式树都写完。例如壳和先到达的 Block1 可以先注水，用户可以先点击壳里的按钮；后到达的 Block2、Block3 在插入 DOM 后再注水。  
   - 若框架/实现是「等流结束再注水」，则行为与传统类似：流结束后整棵 DOM 就绪，再一次性注水。  
   - Next.js App Router 的流式页：通常会在**流结束后**或**主要壳 + 先到达的 chunk** 就绪后开始注水；壳内的客户端组件（如本项目的「注水测试」按钮）会随其所在 DOM 的注水而变为可交互。
5. **时序**：  
   - 流式下，**首屏 DOM 更早可用**（壳 + fallback），但注水仍依赖「脚本加载 + 对应 DOM 已存在」。  
   - 若采用选择性注水，则**壳或先到达的块可先变为可交互**，慢块后到达、后注水；否则仍是「流结束 → 整树注水 → 整页可交互」。

**小结**：流式 SSR = **先渐进式 HTML（壳 + 块），再按 DOM 就绪顺序注水**（或流结束后整树注水）；可交互时刻可以是「渐进」的（选择性注水）或「整页一起」（流结束后注水）。

#### 对比表（注水）

| 维度 | 传统 SSR | 流式 SSR |
|------|----------|----------|
| **DOM 就绪** | 整页 HTML 一次性到达后，DOM 即完整 | 壳先到，各块随 chunk 增量插入 DOM |
| **注水时机** | 整页 DOM 就绪 + 脚本加载后，**整树一次注水** | 可选：选择性注水（先到先注水）或流结束后整树注水 |
| **可交互时刻** | 注水完成后，整页一起可交互 | 选择性注水下，壳/先到块先可交互；否则流结束后整页可交互 |
| **本项目演示** | 页面底部「注水测试」按钮：整页注水完成后可点击 | 同上；若按钮在壳内，可能更早可点击（取决于 Next 实现） |

---

## 六、服务端渲染相关指标拆解（含公式）

**一句话**：**TTFB** = Time To First Byte，即**从浏览器发出文档请求到收到响应体第一个字节**的时间；它直接反映「服务端多快开始给你数据」，是 SSR 性能里最容易被慢数据拖累的指标。

本节用**公式和时序**把 TTFB 及与 SSR 相关的核心指标讲清楚，避免「首字节」「首屏」等说法模糊。

---

### 6.1 TTFB（Time To First Byte）— 首字节时间

**定义（公式）**：从**浏览器发出文档请求**到**浏览器收到响应体第一个字节**所经过的时间。

$$
\text{TTFB} = t_{\text{first byte received}} - t_{\text{request sent}}
$$

- \( t_{\text{request sent}} \)：文档请求（如 GET /page）**离开浏览器**的时刻（或 `fetch` 调用的时刻）。
- \( t_{\text{first byte received}} \)：该请求的**响应体**中**第一个字节到达浏览器**的时刻（注意：是响应 body 的第一个字节，不是 response headers 收完的时刻）。

**拆解（从请求发起到首字节到达）**：

$$
\text{TTFB} = \underbrace{\text{DNS + TCP + TLS（若 HTTPS）}}_{\text{连接建立}} + \underbrace{\text{请求上传到服务器}}_{\text{通常很小}} + \underbrace{\text{服务端处理}}_{\text{SSR 关键}} + \underbrace{\text{首字节回传}}_{\text{网络 RTT 的一部分}}
$$

- **连接建立**：DNS 查询、TCP 握手、TLS 握手（HTTPS）。本地/同机房可忽略或很小。
- **服务端处理**：从收到请求到**开始写出响应体第一个字节**的时间。对 SSR 来说，这部分就是「多快能写出第一字节」。
- **首字节回传**：第一个字节从服务器到浏览器的网络传输，约等于 **单程 RTT 的一部分**（不一定等于整段 RTT，因为服务器可能边算边发）。

**在 SSR 场景下的进一步拆解（服务端处理）**：

服务端从「收到请求」到「写出第一个字节」的时间可以写成：

$$
T_{\text{server}} = T_{\text{routing}} + T_{\text{data}} + T_{\text{render}} + T_{\text{first write}}
$$

- **\( T_{\text{routing}} \)**：路由匹配、中间件等，一般几毫秒级。
- **\( T_{\text{data}} \)**：**等待首屏所需数据就绪**的时间。  
  - **传统 SSR（整页等完再写）**：必须等**整页**用到的所有数据，例如串行时  
    \( T_{\text{data}} = t_1 + t_2 + t_3 \)（如 300 + 500 + 700 = 1500ms），并行时  
    \( T_{\text{data}} = \max(t_1, t_2, t_3) \)（如 700ms）。  
  - **流式 SSR**：只需等「壳 + 第一个要写出的 chunk」所需的数据，\( T_{\text{data}} \) 可以很小（不依赖最慢的块）。
- **\( T_{\text{render}} \)**：把组件树渲染成 HTML（或第一个 chunk）的时间，通常远小于 \( T_{\text{data}} \)。
- **\( T_{\text{first write}} \)**：从渲染出第一个字节到该字节真正写入 socket 的时间，通常可忽略。

因此，**传统 SSR 的 TTFB 大，主要是因为 \( T_{\text{data}} \) 大**（等最慢或全部数据）；**流式 SSR 的 TTFB 小**，是因为可以先写出壳和 fallback，不把最慢的数据算进「首字节之前」的时间。

**与本项目传统 SSR 演示页的对应关系**：  
该页串行等待 300 + 500 + 700 = 1500ms，即 \( T_{\text{data}} = 1500\text{ms} \)。在本地/同机房条件下，TTFB ≈ 1500ms + 少量路由与渲染时间；你看到的「约 1.5s 后才看到内容」正是 TTFB 被 \( T_{\text{data}} \) 主导的体现。

---

### 6.2 FCP（First Contentful Paint）— 首次内容绘制

**定义（公式）**：从**页面开始加载**（navigation start）到**第一次有「内容」被绘制到屏幕**的时间。

$$
\text{FCP} = t_{\text{first contentful paint}} - t_{\text{navigation start}}
$$

- **内容**：指第一次出现任意「非空白、非背景」的像素，例如文本、图片、非白色的 `<canvas>`、SVG 等（由规范定义）。
- FCP 是**用户感知**的指标：「多快看到屏幕上有一点东西」。

**与 TTFB 的关系**：  
浏览器必须先收到**足够解析出首屏可见内容**的 HTML（及可能的关键资源），才能进行首次绘制，因此一般有：

$$
\text{FCP} \geq \text{TTFB} + \text{解析/渲染首屏所需时间}
$$

传统 SSR 下，TTFB 大，FCP 也会被拖后；流式 SSR 下，TTFB 小，首屏壳/骨架很快到达，FCP 会明显提前。

---

### 6.3 LCP（Largest Contentful Paint）— 最大内容绘制

**定义（公式）**：从**页面开始加载**到**视口内「最大内容元素」完成渲染**的时间。

$$
\text{LCP} = t_{\text{largest contentful paint}} - t_{\text{navigation start}}
$$

- **最大内容元素**：当前视口内，在加载过程中曾出现过的、面积最大的「内容」元素（如图片、视频、文本块等），以该元素**完成渲染**（如图片加载完成、文本已绘制）的时刻作为 LCP 时刻。
- LCP 反映「首屏主内容多快真正就绪」，是 Core Web Vitals 之一。

**与传统 / 流式 SSR 的关系**：  
- **传统 SSR**：整页 HTML 一起到达，LCP 往往由「整页中最大的那块」决定，且要等该块对应的**数据**也都在服务端就绪（因为整页一起渲染），所以 LCP 会被最慢的数据拖后。  
- **流式 SSR**：首屏先出现壳和骨架，各块独立到达；LCP 可以是**第一个大块**完成的时间，不必等最慢的那一块，因此 LCP 通常更早。

---

### 6.4 小结：各指标公式与 SSR 关系

| 指标 | 公式（含义） | 传统 SSR | 流式 SSR |
|------|----------------|----------|----------|
| **TTFB** | \( t_{\text{first byte}} - t_{\text{request sent}} \)；受 \( T_{\text{data}} \) 主导 | 大（\( T_{\text{data}} \) = 最慢或全部数据） | 小（先发壳/fallback，不等最慢块） |
| **FCP** | \( t_{\text{first contentful paint}} - t_{\text{navigation start}} \) | 晚（依赖大 TTFB） | 早（壳/骨架先到） |
| **LCP** | \( t_{\text{largest contentful paint}} - t_{\text{navigation start}} \) | 晚（常等整页最大块） | 早（首个大块即可） |

---

### 6.5 如何测量（Chrome DevTools）

1. **Network**：选中**文档请求**（如 `ssr-traditional`），看 **Waiting (TTFB)**，即从发请求到收到**第一个字节**的时间，对应上述 TTFB。
2. **Performance / Lighthouse**：看 **FCP、LCP**（及 INP 等），对应上述公式中的时间点。
3. **体感**：传统页「长时间白屏后整页出现」对应大 TTFB、晚 FCP/LCP；流式页「很快有骨架，再逐块变实」对应小 TTFB、早 FCP、LCP 由首个大块决定。

### 6.5.1 TTFB 怎么看？「下载内容」代表什么？怎么证明流式更好？

**TTFB 怎么看**

- 在 Chrome DevTools 的 **Network** 面板中，选中该页的**文档请求**（如 `ssr-traditional` 或 `ssr-streaming`）。
- 右侧点 **「时间」/ Timing** 标签，看时间分解：
  - **「正在等待服务器响应」**（Waiting for server response）= **TTFB**。  
    即从「请求发出」到「收到响应体第一个字节」的时间，图中通常用**绿色条**表示。
- 有的面板里同一请求的 **Headers** 下也有 **Timing** 小节，其中 **Waiting (TTFB)** 就是同一指标。

**「下载内容」时间代表什么**

- **「下载内容」**（Content Download）表示：从**收到第一个字节**到**收到最后一个字节**、即**收完整个响应体**所花费的时间。
- 公式上：**Content Download 时长** = 收完响应体的时刻 − 收到首字节的时刻。
- 含义：
  - **传统 SSR（本项目）**：因 Next 15 要求，壳 + fallback 先发，所以首字节也较早（TTFB 约 170ms）；但**真正的主内容**要等 1.5s 后服务端才写出，浏览器在「首字节之后」还要收很久，即 **Content Download 很长**（如 1.37s）。这段时间里用户一直看到 fallback，直到整块内容到达。
  - **流式 SSR**：同样先发壳 + fallback（TTFB 约 170ms），然后**边渲染边发**各块，浏览器在较短时间内收完（Content Download 如约 570ms），且**边收边解析、边渲染**，约 300/500/700ms 时三块依次出现。

**为什么本项目中两个页的 TTFB 都是约 170ms？**

- 本项目在 **Next 15** 下实现：传统 SSR 页也用了 **一个大的 Suspense**，内部才是串行等 1.5s 的慢内容；**壳 + fallback 会先发**，所以**首字节**在「壳和 fallback 写出时」就发出了，不必等 1.5s。
- 因此 **ssr-traditional 和 ssr-streaming 的 TTFB 都会是「壳/fallback 写出时间」**，在同一环境下（如本地）可能都是约 170ms，**这是正常现象**。
- 纯理论上的「传统 SSR」（整页等完再发、没有任何 fallback）才会出现 TTFB ≈ 1.5s；当前演示为了满足 Next 15 的 Suspense 要求，传统页也先发了 fallback，所以 TTFB 被「提前」了。

**怎么用两个请求对比证明流式更好（当 TTFB 都是 170ms 时）**

既然 TTFB 相近，**不要单看 TTFB**，要看下面几项：

| 对比项 | 传统 SSR（ssr-traditional） | 流式 SSR（ssr-streaming） | 说明 |
|--------|-----------------------------|----------------------------|------|
| **TTFB** | 约 170ms（壳 + fallback 先发） | 约 170ms（壳 + fallback 先发） | **本项目两者相近**，因传统页也先发 fallback。 |
| **下载内容（Content Download）** | **很长**（如 1.37s）：1.5s 后服务端才写出整块内容，浏览器在这段时间内收完 | **较短**（如 570ms）：边渲染边发，收完即结束 | **关键区别**：传统下「首字节后」要等很久才收完（等服务器 1.5s 后开写）；流式下边收边解析，总下载时间更短。 |
| **总时间** | 长（如 1.54s = 170ms + 1.37s） | 短（如 741ms = 170ms + 570ms） | **流式总时间更短**，且内容**渐进**到达。 |
| **内容何时出现** | 用户先看到 fallback，**约 1.5s 后**三块**一起**替换 | 用户先看到 fallback，**约 300/500/700ms** 三块**依次**出现 | **证明流式更好**：首块内容更早出现，可点击更早。 |

**证明流式更好的三个直观点（在本项目里）**

1. **看「下载内容」和总时间**：传统页 **Content Download 明显更长**（如 1.37s），总时间约 1.5s；流式页 Content Download 较短（如 570ms），总时间约 0.7s。→ **流式收完更快、总等待更短。**
2. **看内容何时出现（体感）**：传统页在约 1.5s 内一直只有 fallback，然后三块**同时**变成真实内容；流式页约 300ms 出现第一块、500ms 第二块、700ms 第三块。→ **流式下首块内容更早出现。**
3. **看可交互**：传统页要等整页注水后，三个「注水测试」按钮**同时**可点；流式页**区块一的按钮可先于二、三可点**。→ **先到先可点击 = 流式更好。**

### 6.6 简单 TTFB 脚本（浏览器 Console）

```js
const start = performance.now();
const res = await fetch('/demo/ssr-traditional');
const reader = res.body.getReader();
await reader.read(); // 收到第一 chunk
console.log('TTFB (traditional):', performance.now() - start, 'ms');
// 同理测 /demo/ssr-streaming，对比 TTFB
```

---

## 七、工程权衡（P7/P8 关注点）

### 7.1 SEO

- **传统 SSR**：首包即完整 HTML，爬虫逻辑简单，无需处理流与占位。  
- **流式 SSR**：流结束后同样是完整 HTML；若爬虫在流结束前就解析，可能只看到部分 fallback。实践中多数爬虫会等待或重试，关键首屏内容可尽量放在「早 resolve」的块或壳里，减少对最慢块的依赖。

### 7.2 缓存与可复用性

- **传统 SSR**：整页可做「全页缓存」（如 CDN），失效策略简单（整页 revalidate）。  
- **流式 SSR**：可对「壳」或部分块做缓存，但「流」的组装和 chunk 顺序需要与缓存策略一致；部分框架支持对 Suspense 块做独立缓存/revalidate，复杂度更高。

### 7.3 错误与降级

- **传统 SSR**：一个数据失败可整页 500 或 fallback 整页。  
- **流式 SSR**：单块失败可用 **Error Boundary** 包住该 Suspense，只让该块显示错误态，其余块照常输出，可用性更好；但错误态和重试逻辑要设计清楚。

### 7.4 选型建议（何时用哪种）

- **传统 SSR 更适合**：页面数据依赖少、且都很快；或强需求「首包即完整 HTML、爬虫行为极简」；或基础设施不支持/不优化流式。  
- **流式 SSR 更适合**：首屏有多块独立数据、且存在慢接口；强需求低 TTFB、快 FCP/LCP；技术栈已支持 React 18 流式 + Suspense（如 Next App Router）。

---

## 八、面试常见问题与参考答案（可口头练到 P7/P8）

### Q1：传统 SSR 和流式 SSR 的根本区别是什么？

**答**：传统 SSR 是等服务端把**整页** HTML 都渲染完，**一次性**发给浏览器，所以**首字节时间（TTFB）**会被最慢的那条数据拖住（或串行时所有数据之和）。流式 SSR 是**边渲染边发送**：先发 HTML 壳和 Suspense 的 fallback（骨架），慢的数据块各自 resolve 后再把对应 HTML **分块**推送到同一响应流，浏览器边收边解析、边渲染。所以流式 SSR 的 TTFB 低、首屏更快，用户先看到壳和骨架或先完成的块，再渐进看到其余部分。

---

### Q2：流式 SSR 是怎么实现的？依赖什么？

**答**：依赖 **React 18** 的流式渲染 API：在 Node 里用 `renderToPipeableStream`，在 Edge 里用 `renderToReadableStream`，把 React 树渲染成**可写/可读流**，每块 HTML 准备好就写入流、推给客户端。再配合 **Suspense**：遇到未 resolve 的异步子组件就先输出 fallback，等该子组件 resolve 后再把真实内容对应的 HTML 推出去（并在客户端替换/插入对应占位），从而实现「先壳 + 骨架，再分块替换」。Next.js App Router 的 async Server Component + `loading.tsx` + 多 Suspense 就是在这一套机制上的封装。

---

### Q3：TTFB、FCP、LCP 在两种 SSR 下会有什么不同？

**答**：**传统 SSR**：TTFB 高（要等最慢或全部数据），FCP/LCP 都要等整页 HTML 到达后才开始解析渲染，所以都会偏晚。**流式 SSR**：TTFB 低（壳和 fallback 先发），FCP 会提前（很快有首屏内容或骨架），LCP 可以是第一个大块内容出现的时间，不必等整页，整体体感更快。

---

### Q4：流式 SSR 对 SEO 有影响吗？

**答**：流**正常结束**后，推送给浏览器的仍是**完整 HTML**，爬虫若等流结束再解析，拿到的和传统 SSR 一致，SEO 没问题。若爬虫在流未结束时就解析，可能只看到部分 fallback；实际中主流爬虫会等待或多次抓取，影响通常可控。对 SEO 极其敏感时，可把首屏关键内容放在早 resolve 的块或壳里，或对关键路由做预渲染/静态化。

---

### Q5：为什么说「慢接口会拖累整个 TTFB」？流式如何解决？

**答**：传统 SSR 里，整页 HTML 要一起写出，只要有一个慢接口（例如 700ms），服务端就要等它回来才能继续渲染、发送，所以 TTFB 至少 700ms（或串行时更长）。流式 SSR 里，慢接口对应的那块用 Suspense 包住，先发 fallback，**不阻塞首字节**；等 700ms 后该块 resolve，再单独把这块 HTML 推出去。所以**首字节**不依赖慢接口，TTFB 降下来，用户先看到其它内容，慢块后补上。

---

### Q6：Next.js 里怎么做一个「传统 SSR」页和一个「流式 SSR」页？

**答**：**传统 SSR 语义**：用**一个**大的 `<Suspense>` 包住整块慢内容，其内部是**一个** async 子组件，在该子组件里 `await` 所有需要的数据（串行或 Promise.all），然后 return 整块 JSX；整块要么一起是 fallback，要么 1.5s 后一起变成真实内容，没有「先出 A 再出 B」。**流式 SSR**：把页面拆成**多个**块，每块用 `<Suspense fallback={骨架}>` 包住，块内是 async 组件、各自 `await` 自己的数据；再配路由级 `loading.tsx`。Next 会先流式输出 loading，再按各块 resolve 顺序流式输出各 Suspense 内容。本项目 `/demo/ssr-traditional` 和 `/demo/ssr-streaming` 就是按这两种方式做的对比页。

---

### Q7：HTTP 层上，两种方式在响应上有什么不同？有哪些字段可以区分？浏览器怎么看？

**答**：传统 SSR 一般是「整份 HTML 准备好后一次性写入响应体」，理论上可以有 **Content-Length**；流式 SSR 用 **Transfer-Encoding: chunked**，**不设 Content-Length**，先发壳和 fallback，再按 resolve 顺序发各块 HTML。但在 **Next.js 里**，传统 SSR 的文档请求也常见 **Transfer-Encoding: chunked 且没有 Content-Length**，不能单靠这两个头区分。

**为什么传统 SSR 在 Next.js 里也是 chunked、没有 Content-Length？**

1. **HTTP 层的默认行为**：Node/Next 对**动态响应**常默认用 chunked 编码。只要服务端没有先设 `Content-Length` 再写 body，底层就会用 `Transfer-Encoding: chunked` 把已写出的内容一块块发出去，所以**不一定会**去缓冲整份 HTML 再算总长、再写 Content-Length。
2. **压缩（gzip）**：若响应经过 gzip 等压缩，最终长度要等压缩完才知道，很多实现就干脆用 chunked 发压缩后的数据，不再设 Content-Length。
3. **框架实现**：Next 的 App Router 对动态路由的 HTML 响应，即使用「传统」语义（整页等完再写），也常走同一套写流接口，统一用 chunked 输出，所以你在 Network 里看到传统 SSR 页也是 `Transfer-Encoding: chunked`、没有 `Content-Length` 是**正常现象**。

**结论**：**不能仅凭「有/无 Content-Length」或「是否 chunked」区分传统 SSR 与流式 SSR**。两者在 Next 里都可能表现为 `Transfer-Encoding: chunked`、无 Content-Length。真正区别在于**何时开始写、分几次写**：传统是「等整页就绪后一次性/少量几次写出」；流式是「先写壳和 fallback，再按块多次写出」。因此要看**时序**，而不是单看响应头。

**可用来区分的 HTTP 响应头与实操：**

| 字段 | 传统 SSR（理论） | 流式 SSR（理论） | Next.js 实际 |
|------|------------------|------------------|--------------|
| **Transfer-Encoding** | 可为 chunked（一次性写完） | chunked（分块写） | **两者都常为 chunked** |
| **Content-Length** | 部分实现会有 | 无 | **两者都常无**（动态路由） |

要点：在 Next 里**不能只靠响应头**区分，要结合 **Timing（TTFB、Content Download）** 和 **Response 内容是否逐步出现** 判断。

**在浏览器里怎么看：**

1. 打开 **Chrome DevTools**（F12 或右键「检查」）→ 切到 **Network** 面板。
2. 勾选 **Disable cache**，刷新页面（或访问 `/demo/ssr-traditional`、`/demo/ssr-streaming`）。
3. 在请求列表里点选**文档请求**（类型为 `document`，即该页的 HTML 请求，名称通常是页面路径）。
4. 右侧打开 **Headers** 子面板，看 **Response Headers**：
   - 在 Next 里传统 SSR 也常见 **Transfer-Encoding: chunked**、**无 Content-Length**，所以**单看这两个头无法区分**。
5. 同一面板里看 **Timing**（这才是有效区分方式）：
   - **Waiting (TTFB)** 很大（如约 1.5s）→ 多半传统 SSR（等整页才发首字节）。
   - **Waiting (TTFB)** 较小（几十～一两百 ms）→ 多半流式 SSR（壳/fallback 先发）。
   - **Content Download** 在 TTFB 之后若还有明显时长、且收包是渐进的 → 流式；若 TTFB 后很快收完 → 传统（整份一次写出）。
6. 可选：在 **Response** 子面板看 HTML 是否**逐步出现**（流式）还是**一次性出现**（传统）。

---

### Q8：若要做「首屏关键内容优先、其余流式」，该怎么设计？

**答**：把首屏关键内容放在「早 resolve」的数据块或壳里（例如首屏 above-the-fold 一个 Suspense，内部只请求关键接口），并保证该块没有慢依赖；其余首屏外或次要内容用多个 Suspense 包住，各自独立请求。这样 TTFB 和 FCP/LCP 都由关键块决定，其余块流式补全，兼顾体验和可维护性。

---

## 九、本项目演示页一览

| 路由 | 说明 |
|------|------|
| `/demo/ssr-traditional` | 传统 SSR 语义：单一大 Suspense 内串行 await 300+500+700ms（共 1.5s），整块一起替换 fallback；TTFB/体感由 1.5s 决定。 |
| `/demo/ssr-streaming` | 流式 SSR：`loading.tsx` 先出，再按 300/500/700ms 分块推送三块内容，块与块互不阻塞。 |

**说明**：两页均用 **delay(ms) 模拟慢接口**，未接真实 API/DB，仅用于体感对比。**流式/传统的核心行为**由 Next.js + React 实现（底层如 `renderToPipeableStream`、Suspense 边界）；生产环境把 `delay` 换成真实 `fetch()` 或 DB 查询即可，流式/传统的差异与表现不变。

建议用 Network 看两个页面的 TTFB 与 Content Download，用 Performance/Lighthouse 看 FCP、LCP，再结合上文原理与面试题做口头练习，即可达到 P7/P8 级表述。

**API 与代码对比**：传统 SSR / 流式 SSR 在 Next.js、React 里分别用哪些 API、怎么写、对照数据见 [传统SSR与流式SSR-Next与React API对比.md](./传统SSR与流式SSR-Next与React%20API对比.md)。
