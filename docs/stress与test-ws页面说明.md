# /stress、/test-ws、/history 页面说明（面试用）

> 面向面试官：各页面/协议分别做什么、解决什么问题，专业简洁。

---

## /stress（高 QPS 压测页）

**做什么**

- 在已连接 IM 的前提下，按可配置的**发送条数**和**发送间隔**（ms）连续发消息；间隔为 0 时为**突发模式**（依赖 MessageQueue 的 `forceFlushOutgoing` 批量发出）。
- 统计本次压测的**请求条数**与**被服务端限流条数**（`server_error` code=`rate_limit`），并展示**最近一次批量 ACK 的条数**（`message_ack_batch`）。
- 轮询展示服务端**限流状态**：`rateLimitMap`（按 userId 的滑动窗口时间戳）、当前限流配置（条/秒），便于观察限流是否生效。

**解决什么问题**

- **验证高并发下的客户端与服务端行为**：MessageQueue 50ms 批处理、seenIds 5s 去重、Virtuoso 虚拟列表在「短时间内大量发送」时的表现；服务端滑动窗口限流（如 20 条/秒）是否按预期触发并返回 rate_limit。
- **回归与压测**：为「批处理 + 限流 + 虚拟列表」提供可重复的压测入口，便于面试或优化前后对比。

**一句话**：高 QPS 压测入口，观测批处理、限流与 UI 响应，用于高并发方案验证与回归。

---

## /test-ws（WebSocket 联调测试页）

**做什么**

- **全链路走真实 WebSocket**：连接、认证（auth_ok）、收发消息、message_ack、MESSAGE 帧、SYNC/历史等，均走 `server/ws-handler` 与 SQLite，**无 Mock**。
- 提供与主站一致的**完整聊天 UI**：MessageList（Virtuoso）、InputArea、QueueBanner、SmartAssistant，便于在真实会话下操作与观察。
- **模拟推送**：通过 WS 请求服务端一次性推送 N 条（如 50/100/200）Mock 消息，用于验证虚拟列表、大量消息下的渲染与滚动表现。
- 展示**调试信息**：connectionState、conversationId、phase、messages 条数，便于联调时对照协议与状态。

**解决什么问题**

- **联调与回归 IM 全链路**：在真实 WS + 真实 DB 下验证「连接 → auth_ok → 发送 → ACK / 收消息 → 批 ack、限流、虚拟列表」是否按设计工作，与主站聊天环境隔离，数据真实可复现。
- **长列表与虚拟列表验证**：通过「模拟推送」快速制造大量消息，验证 MessageList（Virtuoso）在千级消息下的流畅度与无错位。

**一句话**：WS 全链路联调页，会话与消息全走真实后端，支持模拟推送，用于 IM 协议与高并发渲染的验证。

---

## 对比小结

| 页面 | 主要用途 | 核心验证点 |
|------|----------|------------|
| **/stress** | 高 QPS 压测 | 客户端批处理、服务端限流、批量 ACK、压测数据统计 |
| **/test-ws** | WS 联调 + 真实会话 | 连接/认证/收发/ACK 全链路、虚拟列表与大量消息 UI |

两者配合：**/test-ws** 保证协议与全链路正确，**/stress** 在真实连接下做高并发压测与限流观测。

---

## /history（会话历史 / 性能测试页）

**做什么**

- 用 **Mock 消息**（`generateMockMessages`）生成 500 / 1k / 2k / 5k / 1 万条，不接 WebSocket。
- 使用 **HistoryMessageList**（Virtuoso 虚拟滚动）+ **MessageItem**，支持「显示/隐藏表情反应」开关，展示消息条数与生成耗时。

**解决什么问题**

- **长列表性能**：千级/万级消息时全量渲染会导致 DOM 过多、卡顿或白屏。用 Virtuoso 只渲染视口内若干条 + overscan，DOM 数量基本恒定（约 10–20 个），不随消息量线性增长。
- **性能回归验证**：与真实 IM 的 MessageList 同属 Virtuoso，相当于可控制规模的性能测试环境；切换不同消息量验证虚拟列表在极端数据量下是否流畅。
- **渲染复杂度对比**：通过 hideReactions 开关对比有无表情反应时的渲染耗时与流畅度。

**一句话**：用 Mock 长列表验证虚拟滚动与 MessageItem 在千/万级消息下的性能，为 IM 长列表方案做回归验证。

---

## load_history / history_response（IM 协议：向上分页拉历史）

**做什么**

- 用户**滚动到顶部**时，取当前最小 `seqId`，发 `load_history(beforeSeqId)`；服务端返回 `history_response`（messages + hasMore），插入列表头部并按 seq 排序。

**解决什么问题**

- **会话历史分页加载**：不一次性拉全量历史，按需「向上翻页」拉更早消息，首屏与带宽可控。

**一句话**：实现向上翻页拉更早消息，避免全量拉取，保证长会话下的首屏与流量可控。

---

## 对比小结（含 history）

| 页面/协议 | 主要用途 | 核心验证点 |
|-----------|----------|------------|
| **/stress** | 高 QPS 压测 | 客户端批处理、服务端限流、批量 ACK、压测数据统计 |
| **/test-ws** | WS 联调 + 真实会话 | 连接/认证/收发/ACK 全链路、虚拟列表与大量消息 UI |
| **/history** | 长列表性能验证 | Virtuoso 虚拟滚动、DOM 恒定、hideReactions 对渲染影响 |
| **load_history** | 历史分页 | 向上翻页拉更早消息，按需加载、带宽/首屏可控 |
