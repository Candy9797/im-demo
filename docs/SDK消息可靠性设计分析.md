# SDK 消息可靠性设计分析

> 基于「消息不丢失、不重复、不乱序」的底线，分析本项目 IM SDK 的当前实现与设计要点。

---

## 一、理想设计 vs 当前实现对比

| 维度 | 理想设计（面试重点） | 当前实现 | 差距 |
|------|---------------------|----------|------|
| **消息发送回执** | sendMessage 后 SDK 等待 ACK，超时重发（默认 3 次），失败触发回调 | ✅ ACK 匹配；✅ 待确认队列（pendingAck）断线回滚重发；✅ ACK 超时重发（ackTimeoutMs 10s）；✅ 重试耗尽 emit MESSAGE_SEND_FAILED | 已实现 |
| **离线消息缓存** | 重连后自动拉取离线消息，缓存本地，onMessage 推送 | ✅ auth_ok 携带历史；✅ getPersistedMessages 兜底；✅ 重连后 SYNC { afterSeqId } 增量补拉 | 已实现 |
| **消息去重** | SDK 内部 msgId 去重，前端无感知 | ✅ seenIds（5s 窗口）+ conversation.messages 去重 | 已实现 |
| **乱序处理** | 用 timestamp + seq 保证有序 | ✅ seqId / timestamp 排序（history、sync_response） | 已实现 |

---

## 二、当前 SDK 架构（三层）

```
┌─────────────────────────────────────────────────────────────────┐
│                         IMClient                                 │
│  会话管理、ACK 匹配、事件派发、getPersistedMessages 注入          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐
│ WebSocketManager │  │  MessageQueue   │  │ chatStore/persist │
│ 连接、重连、心跳  │  │ 批处理、去重、   │  │ 持久化、离线恢复   │
│                 │  │ pendingAck 回滚  │  │                  │
└───────────────┘  └─────────────────┘  └──────────────────┘
```

---

## 三、消息发送回执（ACK）

### 3.1 当前流程（含待确认队列）

```
前端 sendMessage(content)
  → IMClient.sendMessage()
      → createMessage() 生成 client_msg_id（msg-${Date.now()}-${random}）
      → conversation.messages.push(message)  // 乐观更新
      → messageQueue.enqueueOutgoing(message)
      → emit(MESSAGE_SENT, message)          // 前端立即看到
  → MessageQueue 每 50ms flush
      → flushOutgoing: batch = outgoing.splice(0, 30)
      → handleOutgoingBatch() → wsManager.send(SEND_MESSAGE, msg)
      → 成功后移入 pendingAck（不再丢弃）
  → 服务端入库，返回 MESSAGE_ACK { clientMsgId, serverMsgId, seqId }
  → IMClient 监听 message_ack
      → messageQueue.onAck(clientMsgId)      // 从 pendingAck 移除
      → 用 clientMsgId 找到 conversation.messages 中对应项
      → 更新 id = serverMsgId，status = SENT
      → emit(MESSAGE_STATUS_UPDATE, updated)

断线时：
  → WebSocket onclose → DISCONNECTED
  → messageQueue.rollbackPendingAck()        // pendingAck 全部移回 outgoing
  → messageQueue.pause()
  → 重连成功后 resume() → 下次 flush 再次发送
```

### 3.2 ACK 字段说明：clientMsgId / serverMsgId / seqId

| 字段 | 生成方 | 何时生成 | 作用 | 唯一性 |
|------|--------|----------|------|--------|
| **clientMsgId** | 客户端 | 发送前，乐观更新时 | 临时 ID，用于 ACK 匹配 | 客户端内唯一 |
| **serverMsgId** | 服务端 | 入库成功后 | 消息的持久化主键，引用/回复用 | 全局唯一 |
| **seqId** | 服务端 | 入库时分配 | 会话内顺序，用于排序、补拉历史 | 会话内单调递增 |

**clientMsgId**：SDK 在 `createMessage` 时生成，格式 `msg-${Date.now()}-${random}`。乐观消息先以 clientMsgId 展示，ACK 到达后由 serverMsgId 替换。

**serverMsgId**：服务端写入 DB 后生成，是消息的正式 id。引用回复、消息反应等后续操作均使用 serverMsgId。

**seqId**：按会话递增，用于 `getMessagesAfter(convId, afterSeqId)` 补拉、历史排序。与 id 不同：id 是全局唯一标识，seqId 是会话内顺序号。

**流程示意**：

```
用户发送 "Hello"
    → SDK 生成 clientMsgId = "msg-1739260800000-abc123"
    → 乐观更新：messages.push({ id: clientMsgId, status: "sending" })
    → 发送 SEND_MESSAGE（payload.id = clientMsgId）
    → 服务端入库，生成 serverMsgId、seq_id = 42
    → 返回 MESSAGE_ACK { clientMsgId, serverMsgId, seqId: 42 }
    → SDK 用 clientMsgId 匹配，替换 id = serverMsgId，status = "sent"
```

### 3.3 已实现

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 乐观更新 | IMClient.sendMessage | 先 push、emit MESSAGE_SENT，再入队 |
| ACK 匹配 | IMClient setupEventListeners | message_ack 用 clientMsgId 匹配，替换 id、status |
| 状态推送 | MESSAGE_STATUS_UPDATE | 前端可监听，更新 UI（sending → sent） |
| **待确认队列** | MessageQueue.pendingAck | send 后移入，ACK 到达 onAck 移除 |
| **断线回滚** | MessageQueue.rollbackPendingAck | DISCONNECTED 时调用，未确认消息移回 outgoing |
| **失败回调** | start(onMessageSendFailed) | 重试用尽时更新 status、emit MESSAGE_SEND_FAILED |

### 3.4 已实现（补充）

| 能力 | 实现 |
|------|------|
| **ACK 超时重发** | ackTimeoutMs 默认 10s，pendingAck 中每条启动定时器，超时 handleAckTimeout 回队重发或标记失败 |
| **增量离线同步** | CONNECTED 时若有 conversationId，发送 SYNC { afterSeqId: maxSeqId }；sync_response 按 seq 合并 |
| 可配置 | ConnectionConfig.ackTimeoutMs、retryAttempts |

**MessageQueue 重试逻辑**（`flushOutgoing`，当前实现）：

```typescript
try {
  await this.onFlushOutgoing(messages);
  for (const pending of batch) {
    this.pendingAck.set(pending.message.id, pending);  // 成功后移入待确认
  }
} catch {
  for (const pending of batch) {
    if (pending.attempts < this.config.retryAttempts) {
      this.outgoing.unshift(pending);   // 重新入队
    } else {
      this.markSendFailed(pending);     // onMessageSendFailed，emit MESSAGE_SEND_FAILED
    }
  }
}
```

**断线回滚**（`rollbackPendingAck`）：DISCONNECTED 时调用，pendingAck 中消息 attempts++，未超限则 unshift 回 outgoing，超限则 markSendFailed。解决了「send 成功但断线导致消息丢失」的问题。

#### 详细解释与流程图

**1. WebSocket send 的语义**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ws.send(data) 是同步调用                                                │
│                                                                         │
│  浏览器行为：将 data 追加到「发送缓冲区」后立即返回                        │
│  → 不等待数据真正发出                                                    │
│  → 不等待服务端接收                                                      │
│  → 网络异常时通常不抛错（由 onerror / onclose 异步通知）                  │
└─────────────────────────────────────────────────────────────────────────┘
```

**2. 正常流程（连接正常）**

```
MessageQueue.flush (每 50ms)
    │
    ├─► flushOutgoing()
    │       │
    │       ├─► batch = outgoing.splice(0, 30)    // 从队列取出
    │       │
    │       └─► await onFlushOutgoing(batch)      // handleOutgoingBatch
    │                   │
    │                   └─► for (msg of batch)
    │                           wsManager.send(SEND_MESSAGE, msg)
    │                               └─► ws.send(JSON.stringify(frame))  // 同步，写入缓冲区
    │                                                                   // 不抛错 ✓
    │
    └─► try/catch 不触发
            batch 已从 outgoing 移除，认为「发送成功」
```

**3. 断线场景：消息已出队、尚未真正发出**

```
时间线 ────────────────────────────────────────────────────────────────────►

T1: flush 执行
    batch = outgoing.splice(0, 30)     // 消息 A、B、C 出队
    handleOutgoingBatch([A,B,C])
        ws.send(A)  → 写入缓冲区 ✓
        ws.send(B)  → 写入缓冲区 ✓
        ws.send(C)  → 写入缓冲区 ✓
    // 同步完成，无异常

T2: 网络断开（如 WiFi 掉线）
    // 缓冲区内的 A、B、C 可能尚未发出，或发出后未到达服务端

T3: WebSocket onclose 触发
    handleDisconnect()
    emit(DISCONNECTED)
        │
        └─► IMClient 监听 DISCONNECTED
                messageQueue.pause()   // 暂停 flush

此时：
┌─────────────────────────────────────────────────────────────────────┐
│  • A、B、C 已从 outgoing 中移除（T1 时 splice）                       │
│  • try/catch 从未触发（ws.send 未抛错）                               │
│  • 重试逻辑不会执行                                                  │
│  • A、B、C 既不在队列中，也可能未到达服务端 → 实际丢失                 │
└─────────────────────────────────────────────────────────────────────┘
```

**4. 断线场景：消息尚在队列中**

```
T1: 用户发送消息 D、E
    enqueueOutgoing(D), enqueueOutgoing(E)
    outgoing = [D, E]

T2: 网络断开
    onclose → messageQueue.pause()
    // 下一次 flush 被跳过（pause 后 flush 内不执行）

此时：
┌─────────────────────────────────────────────────────────────────────┐
│  • D、E 仍在 outgoing 中                                             │
│  • 重连后 resume()，下一次 flush 会处理 D、E                          │
│  • 这种情况可以自动重试 ✓                                             │
└─────────────────────────────────────────────────────────────────────┘
```

**5. 重试 catch 何时触发？**

```
只有在 wsManager.send() 内部抛错时才会进入 catch：

WebSocketManager.send():
  if (this.state !== ConnectionState.CONNECTED || !this.ws) {
    throw new Error("Not connected");   // ← 唯一会抛的情况
  }
  this.ws.send(JSON.stringify(frame));

触发条件：在 flush 执行时，state 已是 DISCONNECTED 或 ws 已被置空。
但实际流程是：onclose → pause → flush 不再运行。
因此 flush 执行时，连接通常仍是 CONNECTED，catch 几乎不会触发。
```

**6. 问题小结图（改造前 vs 改造后）**

```
改造前：
  gap：出队后、确认到达前断线 → 消息丢失、无重试

改造后（pendingAck）：
  send 后移入 pendingAck → 断线时 rollbackPendingAck 回滚到 outgoing
  → 重连后 flush 再次发送 ✓
```

**7. 后续改进方向**

| 方向 | 说明 |
|------|------|
| 持久化待发 | rollbackPendingAck 时写入 IndexedDB，刷新后重连可恢复 outgoing |

**8. 待确认队列（Pending-Ack）— 已实现**

核心思路：**以 ACK 为「真正发送成功」的标志，send 后消息进入待确认队列，断线时回滚到 outgoing**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        消息状态流转（已实现）                                 │
└─────────────────────────────────────────────────────────────────────────────┘

  outgoing (未发送)          pendingAck (已发送待确认)          完成
        │                            │                          │
        │  flush: ws.send            │  MESSAGE_ACK              │
        │  ────────────────────────► │  ──────────────────────► onAck 移除
        │  splice 后 send 成功       │  messageQueue.onAck()     │
        │  移入 pendingAck           │                          │
        │                            │                          │
        │                            │  onclose (断线)           │
        │                            │  rollbackPendingAck()     │
        │  ◄──────────────────────── │  ──────────────────────── 移回 outgoing
        │  重连后 flush 再次发送      │  或重试用尽 → FAILED      │
        │                            │                          │
```

**实现位置：**

| 模块 | 文件 | 实现 |
|------|------|------|
| **MessageQueue** | `src/sdk/MessageQueue.ts` | `pendingAck`、`ackTimers`；`flushOutgoing` 成功后移入 pendingAck 并启动 ackTimeout 定时器；`onAck` 清除 timer；`handleAckTimeout` 超时回队或 markSendFailed；`rollbackPendingAck()` |
| **IMClient** | `src/sdk/IMClient.ts` | message_ack → onAck；DISCONNECTED → rollbackPendingAck；CONNECTED → SYNC { afterSeqId } 增量补拉；onMessageSendFailed 回调 |
| **chatStore** | `src/store/chatStore.ts` | 监听 MESSAGE_SEND_FAILED，更新消息 status 为 failed |

**完整流程：**

```
1. 发送阶段
   sendMessage → enqueueOutgoing → outgoing
   flush → splice batch → handleOutgoingBatch (ws.send) → pendingAck.set

2. 确认阶段
   MESSAGE_ACK → onAck(clientMsgId) → 清除 ackTimer、pendingAck.delete
   → 更新 conversation、emit MESSAGE_STATUS_UPDATE

3. ACK 超时阶段（ackTimeoutMs 默认 10s）
   超时 → handleAckTimeout(clientMsgId) → 清除 timer、从 pendingAck 移除
   → attempts < retryAttempts 则 unshift 回 outgoing，否则 markSendFailed

4. 断线阶段
   onclose → DISCONNECTED → rollbackPendingAck()（同时清除所有 ackTimer）
   → pendingAck 中每条：attempts++，若 < retryAttempts 则 unshift 回 outgoing
   → 否则 markSendFailed，emit MESSAGE_SEND_FAILED
   → pendingAck.clear()
   → pause()

5. 重连阶段
   CONNECTED → resume() → 下次 flush 处理回滚到 outgoing 的消息
   → 若有 conversationId：发送 SYNC { afterSeqId: maxSeqId } 增量补拉
   → sync_response → 合并去重、排序、emit MESSAGE_BATCH_RECEIVED
```

**幂等保障**：服务端按 `client_msg_id` 去重，同一消息重发不会重复入库。

**可选扩展**：`rollbackPendingAck` 时同步写入 IndexedDB，页面刷新后重连时从 IndexedDB 恢复 outgoing，避免刷新导致待发消息丢失。

---

## 四、离线消息缓存

### 4.1 当前流程

**场景 A：首次连接 / 刷新后重连**

```
connect()
  → WebSocket 连接，URL 带 token
  → 服务端 handleConnection → auth_ok
      → payload: { conversationId, messages: getMessagesAfter(convId, 0).slice(-100) }
  → IMClient onAuthOk
      → if (serverMessages.length > 0): 用服务端数据，emit MESSAGE_BATCH_RECEIVED
      → else: 调用 getPersistedMessages(convId)，用本地 IndexedDB 兜底
```

**场景 B：断线重连 + 增量离线同步**

```
WebSocket onclose
  → scheduleReconnect() 指数退避
  → 再次 connect()
  → 新连接 → CONNECTED
  → 若有 conversationId：发送 SYNC { afterSeqId: max(seqId in messages) }
  → sync_response 返回 seq_id > afterSeqId 的消息
  → 合并去重、排序、emit MESSAGE_BATCH_RECEIVED
  → auth_ok 也会到达（首次连接时处理），重连时主要依赖 SYNC 增量补拉
```

**场景 C：关闭页面后重新打开**

```
页面加载 → 用户 login / 访客 → initialize()
  → createIMClient({ getPersistedMessages: ... })
  → connect()
  → auth_ok 到达前，Zustand rehydrate 可能已完成，但 conversation 还是空的
  → auth_ok 带服务端 messages 或空
  → 空时用 getPersistedMessages 兜底
```

### 4.2 已实现

| 能力 | 实现 |
|------|------|
| 连接时拉历史 | auth_ok 携带 messages（last 100） |
| 本地兜底 | getPersistedMessages 在 auth_ok 空消息时调用 |
| 持久化 | Zustand persist → chatPersistStorage（IndexedDB） |
| 去重 | auth_ok / sync_response 写入前 `!conversation.messages.some(m => m.id === msg.id)` |

### 4.3 未实现 / 差异

| 能力 | 理想 | 当前 |
|------|------|------|
| 增量补拉 | 重连后发 SYNC { afterSeqId }，只拉断线期间新消息 | 无 SYNC 请求；重连后 auth_ok 全量 last 100，非增量 |
| afterSeqId | 客户端维护「最后已确认 seq」，补拉时带上 | 无此字段，服务端 getMessagesAfter(0) 即全量 |
| 离线期间消息 | 关闭页面期间的新消息，下次打开需拉取 | 依赖 auth_ok 的 last 100；若离线期间 > 100 条，会丢 |

**协议支持**：FrameType 已有 SYNC、SYNC_RESPONSE，但 IMClient 未在重连后发送 SYNC。服务端需实现 LOAD_SYNC（或复用 LOAD_HISTORY）支持 afterSeqId 参数。

---

## 五、消息去重

### 5.1 入站去重（MessageQueue）

```typescript
enqueueIncoming(message: Message): boolean {
  if (this.isDuplicate(message.id)) return false;  // seenIds.has(id)
  this.seenIds.set(message.id, Date.now());
  this.incoming.push(message);
  this.cleanupDedup();  // 5s 外删除
  return true;
}
```

- **去重键**：`message.id`（服务端或客户端生成，全局唯一）
- **窗口**：5s（deduplicationWindow），超时清理，控制内存
- **场景**：网络重试、服务端重推、多端同步，同一 msg 多次到达时只处理一次

### 5.2 写入 conversation 时的去重

**frame_in（单条 MESSAGE）**：

```typescript
if (!this.conversation.messages.some((m) => m.id === msg.id)) {
  this.conversation.messages = [...];
  this.messageQueue.enqueueIncoming(msg);
}
```

**sync_response**：

```typescript
const newMsgs = messages.filter((msg) => !this.conversation.messages.some((m) => m.id === msg.id));
```

**history_response**：

```typescript
const newMsgs = messages.filter((m) => !this.conversation.messages.some((x) => x.id === m.id));
```

多层去重：MessageQueue 的 seenIds + conversation.messages 的 id 存在性检查。

---

## 六、乱序处理

### 6.1 服务端顺序

- 每条消息有 `seq_id`，按会话单调递增
- `getMessagesAfter(convId, afterSeqId)`、`getMessagesBefore` 均按 seq 查询

### 6.2 客户端排序

**history_response**：

```typescript
this.conversation.messages = [...newMsgs, ...this.conversation.messages]
  .sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
```

**chatStore HISTORY_LOADED**：

```typescript
state.messages = [...prepend, ...state.messages].sort(
  (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp)
);
```

- **排序键**：优先 `seqId`，无则 `timestamp`
- **场景**：历史分页、sync 补拉，保证最终列表按 seq 有序

### 6.3 实时消息

- 服务端按 seq 顺序推送 MESSAGE
- 客户端按接收顺序 push，天然有序；若乱序需在插入时按 seqId 查找位置再 insert，当前实现未做（依赖服务端有序推送）

---

## 七、前端视角下的封装边界

### 7.1 已封装（前端无需处理）

| 能力 | 前端只需 |
|------|----------|
| 去重 | 监听 MESSAGE_RECEIVED / MESSAGE_BATCH_RECEIVED，收到的已去重 |
| 基本有序 | 按收序展示即可，历史通过 seq 排序 |
| 乐观更新 | 监听 MESSAGE_SENT 展示「发送中」 |
| 状态更新 | 监听 MESSAGE_STATUS_UPDATE 更新 sent/delivered/read |
| 离线恢复 | 配置 getPersistedMessages，auth_ok 空时自动用本地数据 |
| 发送失败 | 监听 MESSAGE_SEND_FAILED 展示失败状态（chatStore 已接入） |
| 增量离线 | 重连后自动 SYNC 补拉，无需前端处理 |

### 7.2 需前端配合或缺失

| 能力 | 说明 |
|------|------|
| 重连状态 | 需监听 RECONNECTING 展示「重连中」 |

---

## 八、面试表述建议

### 8.1 如何介绍当前设计

**「SDK 在消息可靠性上做了分层封装：」**

1. **去重**：MessageQueue 用 msgId + 5s 窗口去重，写入 conversation 前再做一次 id 校验，前端拿到的消息保证不重复。
2. **有序**：服务端 seq_id 单调递增，历史拉取和 sync 后按 seqId/timestamp 排序，前端按顺序渲染即可。
3. **ACK**：发送时用 client_msg_id 做乐观更新，服务端 ACK 带回 server_msg_id，SDK 内部匹配并更新状态，通过 MESSAGE_STATUS_UPDATE 通知前端。
4. **离线**：auth_ok 携带最近 100 条，若为空则用 getPersistedMessages 从 IndexedDB 恢复，保证冷启动和短时离线不丢消息。
5. **重试与断线回滚**：MessageQueue 有 pendingAck 待确认队列，send 后移入并启动 ACK 超时定时器（10s）；ACK 到达或超时回队重发；断线时 rollbackPendingAck 将未确认消息回滚到 outgoing；重试用尽 emit MESSAGE_SEND_FAILED。
6. **增量离线同步**：重连后 CONNECTED 时若有 conversationId，发送 SYNC { afterSeqId } 补拉离线期间新消息，sync_response 合并去重并排序。

### 8.2 与理想设计的差距（可作优化方向）

- **出站持久化**：rollbackPendingAck 时写入 IndexedDB，刷新后重连可恢复 outgoing。

---

## 九、小结

| 维度 | 实现情况 | 核心机制 |
|------|----------|----------|
| **不重复** | ✅ | seenIds + conversation 去重 |
| **不乱序** | ✅ | seqId/timestamp 排序 |
| **不丢失（常规）** | ✅ | auth_ok 历史 + persist 兜底 |
| **ACK 回执** | ✅ | clientMsgId 匹配，状态推送 |
| **断线回滚重发** | ✅ | pendingAck + rollbackPendingAck |
| **发送失败回调** | ✅ | MESSAGE_SEND_FAILED，chatStore 监听 |
| **ACK 超时重发** | ✅ | ackTimeoutMs 默认 10s，超时回队重发 |
| **增量离线同步** | ✅ | 重连后发送 SYNC { afterSeqId }，按 seq 补拉 |

**整体**：SDK 已覆盖去重、有序、ACK 匹配、断线回滚、ACK 超时重发、增量离线同步和发送失败回调。
