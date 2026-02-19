# SDK 设计 rationale 与面试问答

> 为何这样设计 + 面试官可能问的问题与参考答案

---

## 一、设计 rationale（为何这样设计）

### 1.1 为何分层？WebSocketManager / MessageQueue / IMClient 分开？

**原因**：

- **职责单一**：传输层只关心连接和帧收发，业务层只关心消息语义、ACK、sync，队列层只关心批处理与去重。
- **可替换性**：WebSocket 可换成其他传输（如 long-polling、SSE），业务逻辑不必改动。
- **可测试性**：各层可单独 mock，便于单元测试。
- **复用**：MessageQueue 可用于其他高频流（如行情推送），WebSocketManager 可用于其他长连接场景。

**不分开的后果**：逻辑混在一起，改传输要动业务，改业务要动传输，难以维护和扩展。

---

### 1.2 为何用事件驱动？SDK 直接操作 UI 不行吗？

**原因**：

- **框架无关**：SDK 不依赖 React/Vue，可用于任意前端框架或 Node。
- **解耦**：UI 通过 `client.on(SDKEvent.xxx)` 订阅，SDK 只 `emit`，不引用组件。
- **可组合**：同一 SDK 可被多个 UI 同时订阅（如主窗口 + 通知浮窗）。
- **可调试**：事件流清晰，方便日志和 DevTools。

**直接操作 UI**：SDK 需依赖 React context、ref 等，强耦合，难以迁移和测试。

---

### 1.3 为何要 MessageQueue？每条消息直接 emit 不行吗？

**原因**：

- **高频场景**：群聊、推送每秒数十条，若每条都 emit → setState，会导致大量 re-render，卡顿。
- **批处理**：50ms 一批 flush，一次 setState 合并多条，显著降低渲染次数。
- **去重**：网络重试、服务端重发会造成重复，seenIds + deduplicationWindow 过滤。
- **重试**：发送失败可重入队头，指数退避，提高送达率。

**不用队列**：高 QPS 下渲染压力大，重复消息难以统一处理。

---

### 1.4 为何 MessageQueue 要 pause/resume？断线时继续 flush 不行吗？

**原因**：

- **数据一致性**：断线期间服务端可能重发、sync 补拉，若继续 flush 旧数据，可能产生乱序或重复。
- **pause**：断线时暂停 flush，消息仍入队，但不推到上层。
- **resume**：连接恢复、auth_ok 或 sync 完成后 resume，此时状态稳定。

**不 pause**：断线时继续 flush 可能把基于不完整状态的数据推到 Store，造成展示错误。

---

### 1.5 为何 client_msg_id 和 server_msg_id 分开？

**原因**：

- **乐观更新**：用户发消息后立即展示，不等服务端，此时尚无 server_msg_id。
- **临时标识**：客户端用 client_msg_id（如 `msg-{timestamp}-{random}`）做临时 ID，用于 ACK 匹配。
- **服务端落库**：服务端写入后生成 server_msg_id，ACK 帧带回，客户端替换。
- **后续操作**：markAsRead、addReaction 等需用 server_msg_id，服务端 getMessage 支持双 id 查找。

**不分开**：无法实现乐观更新，用户发送后需等待服务端响应才能展示。

---

### 1.6 为何用 IndexedDB 而不是 localStorage？

**原因**：

- **容量**：localStorage 约 5MB，消息多了不够；IndexedDB 容量大得多。
- **异步**：localStorage 同步阻塞主线程，IndexedDB 异步不卡 UI。
- **结构化**：支持索引、事务，适合按 conversationId 查询、按 seq 排序。
- **类型**：可存对象，不需 JSON.stringify/parse。

**localStorage**：容量小、同步阻塞、无索引，不适合大量消息。

---

### 1.7 为何 IndexedDB 要防抖？直接每次 save 不行吗？

**原因**：

- **I/O 成本**：IndexedDB put 是异步 I/O，频繁调用会占用主线程、影响交互。
- **批处理**：80ms 防抖 + 50 条即 flush，把多次写入合并成一次事务，降低 I/O 次数。
- **平衡**：80ms 和 50 条保证数据不会积压太久，同时显著减少写入次数。

**不防抖**：高频 ACK 时每条都 put，主线程压力大，可能卡顿。

---

### 1.8 为何 Store 里 push 消息要拷贝 { ...m }？

**原因**：

- **Immer 会 freeze**：Store 用 Immer，`produce` 完成会对新 state 做 `Object.freeze`。
- **共享引用**：若不拷贝，Store 与 IMClient 共享同一 message 对象。
- **冲突**：Immer freeze 后，IMClient 在 ACK 时无法再修改该对象（替换 id、更新 status），会静默失败。
- **拷贝**：`{ ...m }` 后，Store 持有独立副本，freeze 不影响 IMClient 侧。

---

### 1.9 为何单会话模型？多会话不行吗？

**原因**：

- **业务**：客服 IM 场景是「用户 ↔ Bot/Agent」单线程对话，不需要多会话切换。
- **简化**：单会话状态简单，conversation 一个，phase 区分 Bot/Agent。
- **转人工**：SESSION_SWITCHED 时替换 conversationId 和 messages，本质仍是单会话切换。

**多会话**：适合好友/群组聊天，需 messagesByConv 等结构，当前场景不需要。

---

### 1.10 为何重连用指数退避？

**原因**：

- **惊群效应**：大量客户端同时断线后同时重连，服务端瞬时压力激增，可能拖垮。
- **指数退避**：每次重试间隔变长（`base * 2^n`），加上随机抖动，不同客户端错开重连时间。
- **公式**：`min(1000 * 2^n + jitter, 30000)`，n 为已重试次数。

---

## 二、面试官可能问的问题与答案

### Q1：SDK 的整体架构是什么？为什么要分层？

**答**：分三层。传输层 WebSocketManager 负责连接、收发帧、心跳、重连；队列层 MessageQueue 负责批处理、去重、重试；业务层 IMClient 负责会话管理、消息收发、ACK 匹配、sync/history、事件派发。分层是为了职责单一、可替换（如换传输）、可测试、可复用。

---

### Q2：SDK 和 UI 之间怎么通信？为什么不用直接调用？

**答**：用事件驱动。SDK 继承 EventEmitter，UI 通过 `client.on(SDKEvent.MESSAGE_RECEIVED, cb)` 订阅，SDK 在收到消息时 `emit`。这样 SDK 与 React 解耦，可用于任意框架，也方便多端订阅和调试。直接调用会让 SDK 依赖 UI 框架，难以迁移。

---

### Q3：MessageQueue 的作用？为什么需要批处理？

**答**：MessageQueue 做入站/出站批处理、去重、发送失败重试。批处理是因为高频场景（群聊、推送）每秒数十条消息，若每条都 emit → setState，会导致大量 re-render。50ms 一批 flush，一次 setState 合并多条，显著降低渲染次数。去重用 seenIds + 5s 窗口，过滤网络重试和服务端重发带来的重复。

---

### Q4：断线重连时为什么要 pause MessageQueue？resume 在什么时候？

**答**：断线时若继续 flush，可能把基于不完整状态或重复推送的数据推到 Store，造成乱序或重复。pause 后消息仍入队，但不 flush 到上层。连接恢复、auth_ok 或 sync 补拉完成后 resume，此时状态稳定，再恢复 flush。

---

### Q5：client_msg_id 和 server_msg_id 为什么分开？何时替换？

**答**：乐观更新需要立即展示，此时服务端未落库，没有 server_msg_id。客户端生成 client_msg_id 做临时标识，用于 ACK 匹配。服务端落库后返回 server_msg_id，ACK 帧携带，客户端用 clientMsgId 找到对应消息，替换 id 并更新 status。后续 markAsRead、addReaction 等用 server_msg_id。

---

### Q6：IndexedDB 的写入策略？为什么防抖？

**答**：单条用 saveMessage → writeBuffer → 80ms 防抖或 50 条即 flush；批量用 saveMessages 直接 doWrite。防抖是因为 IndexedDB put 是 I/O，高频 ACK 时每条都写会占用主线程，80ms + 50 条能把多次写入合并成一次，降低 I/O 次数。

---

### Q7：为什么 Store 里 push 消息要拷贝 { ...m }？不拷贝会怎样？

**答**：Immer 会对 produce 产出的新 state 做 Object.freeze。若不拷贝，Store 和 IMClient 共享同一引用，freeze 后 IMClient 无法再修改该对象（如 ACK 时替换 id），会静默失败。拷贝后 Store 持有独立副本，freeze 不影响 IMClient。

---

### Q8：重连为什么用指数退避？惊群效应是什么？

**答**：惊群效应指大量客户端同时断线后同时重连，服务端瞬时流量激增，可能拖垮。指数退避让每次重试间隔逐渐变长（base * 2^n），加上随机抖动，不同客户端错开重连时间，分散压力。

---

### Q9：WebSocketManager 和 IMClient 的职责边界？

**答**：WebSocketManager 只负责传输：建立/关闭连接、收发 JSON 帧、心跳、断线重连，不解析业务、不处理消息语义。IMClient 负责业务：sendMessage、ACK 匹配、loadHistory、sync、requestAgent 等，内部用 wsManager.send 和 wsManager.on 交互。

---

### Q10：如果要把 WebSocket 换成 HTTP 轮询，需要改哪些？

**答**：只需实现一个新的「传输层」类，提供 connect、disconnect、send、on 等接口，内部用轮询替代 WebSocket。IMClient 依赖这个接口，把 WebSocketManager 替换成新类即可，业务层和 MessageQueue 逻辑基本不动。

---

## 三、追问速查

| 追问 | 要点 |
|------|------|
| 批处理间隔为什么 50ms？ | 太短效果有限，太长用户感觉延迟；50–100ms 常见折中 |
| 去重窗口为什么 5s？ | 覆盖网络重试、服务端重发的典型延迟，过长占用内存 |
| 为何不把 IndexedDB 放在 IMClient 内部？ | 抽离成独立模块，便于测试、复用，IMClient 只调 saveMessage/getMessages |
| TIM 和 IMClient 什么关系？ | TIM 是 TIM 风格 API 封装，内部委托 IMClient，面向不同调用方 |
| 多实例部署时 SDK 要改什么？ | SDK 侧无需大改，主要服务端用 Redis 共享连接、消息路由 |
