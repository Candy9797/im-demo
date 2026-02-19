# IM 底层逻辑与面试要点

> 梳理 IM SDK 架构中的底层应用逻辑，用于面试时清晰表达对即时通讯底层实现的理解。

---

## 一、整体架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│  UI 层：Zustand store + React 组件（MessageList、InputArea 等）    │
├─────────────────────────────────────────────────────────────────┤
│  应用逻辑层：IMClient（会话管理、消息收发、事件派发）               │
├─────────────────────────────────────────────────────────────────┤
│  中间层：MessageQueue（批处理、去重）、IndexedDBStore（离线持久化）  │
├─────────────────────────────────────────────────────────────────┤
│  传输层：WebSocketManager（连接、心跳、重连）                       │
└─────────────────────────────────────────────────────────────────┘
```

**面试可答**：我负责的 IM 采用分层架构，上层是 Zustand + React，中间是自研 SDK（IMClient、MessageQueue、WebSocketManager），底层是 WebSocket 和 IndexedDB。重点在中间层的消息队列、去重、持久化和连接管理。

---

## 二、核心底层逻辑

### 2.1 消息 ID 与 ACK 机制

| 概念 | 说明 | 面试可答 |
|------|------|----------|
| **client_msg_id** | 客户端发送时生成，用于乐观更新 | 用户发消息后立即展示，用 client_msg_id 标识 |
| **server_msg_id** | 服务端落库后生成，作为最终唯一 ID | ACK 帧携带 `{ clientMsgId, serverMsgId }`，客户端用 clientMsgId 找到乐观消息，替换为 serverMsgId |
| **乐观更新** | 发送即展示，不等 ACK | 减少 perceived latency，ACK 失败需回退或重试 |

**ID 生成规则**：`msg-${Date.now()}-${random}`，时间戳保证大致有序，随机后缀降低碰撞。

---

### 2.2 消息去重（多层防护）

| 层级 | 去重 key | 机制 |
|------|----------|------|
| **MessageQueue** | message.id | seenIds Map，5s 窗口内已见过的 id 直接丢弃 |
| **IMClient frame_in** | message.id | `conversation.messages.some(m => m.id === msg.id)`，已有则不入队 |
| **Store** | message.id | MESSAGE_BATCH_RECEIVED / HISTORY_LOADED 时 `ids.has(m.id)` 过滤 |
| **IndexedDB** | message.id | keyPath 为主键，put 覆盖同 id，天然去重 |

**面试可答**：网络重试、服务端重发、多端同步都可能导致同一消息多次到达。我们在 MessageQueue 用 5s 窗口的 seenIds 做第一道过滤，Store 和 IMClient 再按 id 做二次过滤，IndexedDB 用 id 作为主键保证写入幂等。

---

### 2.3 消息队列与批处理（MessageQueue）

| 能力 | 实现 | 面试可答 |
|------|------|----------|
| **入站批处理** | 收到消息先入队，每 50ms 批量 flush | 高 QPS 时避免每条消息触发一次 setState，减少渲染 |
| **出站批处理** | 发送消息按 batchSize=30 批处理 | 降低 WebSocket 帧数，减轻服务端压力 |
| **去重** | 5s 窗口 seenIds | 见 2.2 |
| **断线暂停** | `pause()` / `resume()` | 重连时暂停 flush，恢复连接后再处理，避免脏数据 |
| **发送失败重试** | 指数退避，最多 3 次 | 失败消息重新入队，超限后标记 FAILED |

**面试可答**：用生产者-消费者模式，入站消息先入 MessageQueue，定时器每 50ms flush 一批到 Store，这样每秒最多约 20 次 setState，而不是每条消息一次。

---

### 2.4 离线持久化（IndexedDBStore）

| 能力 | 实现 | 面试可答 |
|------|------|----------|
| **单条写入** | saveMessage：80ms 防抖 + 缓冲，达 50 条即 flush | 高频 ACK 等场景下减少 IndexedDB 写入次数 |
| **批量写入** | saveMessages：auth/sync 大批量直接事务写入 | 连接成功或同步时一次性落库 |
| **读前一致性** | getMessages 前自动 flush 未写入缓冲 | 避免读到脏数据 |
| **按会话查询** | getMessages(conversationId)，按 timestamp 排序 | 重连后恢复会话内容 |

**面试可答**：IndexedDB 写入较慢，我们做了防抖和批量缓冲。单条 saveMessage 先入 buffer，80ms 或满 50 条才真正写入；大批量用 saveMessages 直接事务写。

---

### 2.5 连接管理（WebSocketManager）

| 能力 | 实现 | 面试可答 |
|------|------|----------|
| **心跳** | 每 30s 发 HEARTBEAT_PING，收 HEARTBEAT_PONG | 保活，及时发现死连接 |
| **重连** | 指数退避 + 随机抖动，最多 5 次 | `delay = min(base * 2^n + jitter, 30000)`，避免雪崩 |
| **状态** | CONNECTING / CONNECTED / RECONNECTING / DISCONNECTED | 上层可根据状态做 UI 和逻辑区分 |

**面试可答**：断线后用指数退避重连，避免瞬间大量客户端同时重连造成服务端压力。同时 MessageQueue 在重连期间 pause，恢复后再 resume，保证消息顺序和一致性。

---

### 2.6 同步与历史拉取

| 场景 | 触发 | 逻辑 |
|------|------|------|
| **auth_ok** | 连接成功 | 服务端下发 conversationId、phase、历史 messages |
| **load_history** | 用户滚动到顶部 | 客户端发 `{ beforeSeqId }`，服务端按 seq 分页返回 |
| **sync** | 断线重连后 | 客户端发 `{ afterSeqId }`，服务端返回该 seq 之后的消息 |
| **合并** | 上述任意 | 按 message.id 去重，按 seqId/timestamp 排序 |

**面试可答**：历史拉取按 seq 分页，同步按 afterSeqId 补拉断线期间的消息。合并时用 id 去重，用 seq 排序，保证无重复、无乱序。

---

### 2.7 双会话模型（Bot / Agent）

| 会话类型 | 说明 |
|----------|------|
| **Bot** | 用户与智能助手，`conv-bot-*` |
| **Agent** | 转人工后的会话，`conv-agent-*`，通过 parent_conv_id 关联 Bot |

转人工时服务端创建新 Agent 会话，发送 SESSION_SWITCHED，客户端切换 conversationId 并重置 messages。

---

## 三、高频场景优化（High-QPS）

**面试可答**：针对群聊、行情推送等高 QPS 场景做了几层优化：

1. **MessageQueue 批处理**：50ms 窗口、batchSize 30，减少 React 更新和 IndexedDB 写入
2. **Store 批量 setState**：MESSAGE_BATCH_RECEIVED 一次合并多条，而非逐条 set
3. **IndexedDB 防抖**：saveMessage 80ms 防抖 + 50 条缓冲
4. **虚拟列表**：react-virtuoso 只渲染可视区，千条消息 DOM 恒定约 20
5. **服务端限流**：每用户 20 条/秒，超限返回 rate_limit

---

## 四、面试常见问题与回答要点

| 问题 | 回答要点 |
|------|----------|
| 如何保证消息不丢不重？ | 不重：多层去重（MessageQueue seenIds、Store id 过滤、IndexedDB 主键）；不丢：ACK 机制、发送失败重试、IndexedDB 持久化、sync 补拉 |
| 断线重连后如何恢复？ | 指数退避重连 → sync 按 afterSeqId 补拉 → 与本地消息按 id 去重、按 seq 排序合并 |
| 高频消息如何优化？ | 批处理（MessageQueue）、批量 setState、IndexedDB 防抖、虚拟列表 |
| client_msg_id 和 server_msg_id 为什么分开？ | 乐观更新需要发前就有 id；服务端落库后才生成最终 id；ACK 用 client_msg_id 匹配并替换 |
| 消息顺序如何保证？ | 服务端 seq_id 单调递增；拉取按 seq 分页；合并时按 seq/timestamp 排序 |

---

## 五、可补充的加分点

- **协议设计**：帧结构 `{ type, seq, timestamp, payload }`，type 区分业务，seq 用于调试和顺序
- **数据隔离**：Zustand + Immer 时，Store 与 IMClient 不共享引用，避免 Immer 冻结影响 SDK
- **双会话与转人工**：Bot/Agent 分离，转人工时新建会话、排队、分配客服的完整流程
