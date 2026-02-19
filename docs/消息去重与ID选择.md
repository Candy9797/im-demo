# 消息去重与 ID 选择

本文档说明本 IM 项目中消息 ID 的生成策略、去重机制及实现位置。

---

## 一、ID 选择策略

### 1.1 两种 ID 角色

| 角色 | 含义 | 生成方 | 使用场景 |
|------|------|--------|----------|
| **client_msg_id** | 客户端消息 ID | 客户端 | 用户发送时，乐观更新、ACK 匹配 |
| **server_msg_id (id)** | 服务端消息 ID | 服务端 | 落库主键、下发、历史拉取、去重 |

### 1.2 客户端生成规则

```typescript
// src/sdk/IMClient.ts - createMessage()
id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
// 示例: msg-1739260800123-a1b2c3d4
```

- **时间戳**：`Date.now()` 保证同会话内基本有序
- **随机后缀**：8 位 base36，降低碰撞概率
- **用途**：用户发送消息时临时 id，用于乐观展示和 ACK 匹配

### 1.3 服务端生成规则

| 消息来源 | 格式 | 示例 |
|----------|------|------|
| 用户消息 | `msg-${Date.now()}-${random}` | `msg-1739260800456-x7y8z9` |
| Bot 回复 | `msg-${Date.now()}-b` | `msg-1739260800457-b` |
| Agent 回复 | `msg-${Date.now()}-a` | `msg-1739260800458-a` |
| 系统消息 | `msg-${Date.now()}-sys` | `msg-1739260800459-sys` |

```typescript
// server/ws-handler.ts
const serverMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const botId = `msg-${Date.now()}-b`;
const agentId = `msg-${Date.now()}-a`;
```

### 1.4 client_msg_id 与 server_msg_id 的映射

- 用户消息落库时，同时存 `id`（server_msg_id）和 `client_msg_id`（用户发来的 msg.id）
- ACK 帧携带 `{ clientMsgId, serverMsgId }`，客户端用 clientMsgId 找到消息，将 `msg.id` 替换为 serverMsgId
- 之后所有逻辑（已读、反应、引用等）统一用 `id`（server_msg_id）作为唯一标识

```typescript
// IMClient - message_ack 处理
const msg = this.conversation.messages.find((m) => m.id === clientMsgId);
if (msg) {
  msg.id = serverMsgId ?? msg.id;
  msg.status = MessageStatus.SENT;
  // ...
}
```

### 1.5 为何需要 client_msg_id？

1. **乐观更新**：发送后立即展示，此时尚无 server_msg_id
2. **ACK 匹配**：服务端返回 ACK 时，用 client_msg_id 定位到对应乐观消息
3. **按 client_msg_id 查找**：`db.getMessage(msgId, convId)` 支持按 client_msg_id 查（用于 MARK_READ、REACTION 等）

---

## 二、去重机制

### 2.1 去重发生的环节

| 环节 | 去重 key | 实现 |
|------|----------|------|
| 入站消息队列 | message.id | MessageQueue.seenIds |
| Store 单条接收 | message.id | `s.messages.some(m => m.id === message.id)` |
| Store 批量接收 | message.id | `ids.has(m.id)` 过滤 |
| Store 历史加载 | message.id | `ids.has(m.id)` 过滤 |
| IMClient frame_in | message.id | `conversation.messages.some(m => m.id === msg.id)` |
| IMClient sync/history | message.id | `!conversation.messages.some(m => m.id === msg.id)` |
| IndexedDB 写入 | message.id | keyPath: "id"，put 覆盖同 id |

### 2.2 MessageQueue 入站去重

```typescript
// src/sdk/MessageQueue.ts
private seenIds: Map<string, number> = new Map();  // id -> timestamp

enqueueIncoming(message: Message): boolean {
  if (this.isDuplicate(message.id)) return false;  // 已见过则丢弃
  this.seenIds.set(message.id, Date.now());
  this.incoming.push(message);
  this.cleanupDedup();  // 清理过期条目
  return true;
}

private isDuplicate(id: string): boolean {
  return this.seenIds.has(id);
}

// 5s 窗口后清理，避免 seenIds 无限增长
private cleanupDedup(): void {
  const cutoff = Date.now() - this.config.deduplicationWindow;  // 5000ms
  for (const [id, ts] of this.seenIds) {
    if (ts < cutoff) this.seenIds.delete(id);
  }
}
```

- **窗口**：`deduplicationWindow: 5000` ms
- **key**：`message.id`（服务端生成的 id）
- **原因**：网络重试、服务端重发、批量/单条重复推送等可能导致同一消息多次到达

### 2.3 Store 层去重

```typescript
// MESSAGE_SENT / MESSAGE_RECEIVED
if (s.messages.some((m) => m.id === message.id)) return s;

// MESSAGE_BATCH_RECEIVED
const ids = new Set(s.messages.map((m) => m.id));
const newOnes = batch.filter((m) => !ids.has(m.id));

// HISTORY_LOADED
const ids = new Set(s.messages.map((m) => m.id));
const merged = [...newMsgs.filter((m) => !ids.has(m.id)), ...s.messages].sort(...);
```

- 保证同一 id 的消息不会重复加入 `messages` 数组

### 2.4 IMClient 层去重

```typescript
// frame_in (MESSAGE 帧)
if (!this.conversation.messages.some((m) => m.id === msg.id)) {
  this.conversation.messages.push(msg);
  this.messageQueue.enqueueIncoming(msg);
}

// sync_response / history_response
const newMsgs = messages.filter((msg) => !this.conversation.messages.some((m) => m.id === msg.id));
```

- frame_in 先检查 conversation 中是否已有，避免重复入队
- sync/history 只处理本地尚未存在的消息

### 2.5 IndexedDB 层去重

```typescript
// IndexedDBStore - ObjectStore keyPath: "id"
tx.objectStore(STORE_NAME).put(msg);  // put 会覆盖同 id，天然去重
writeBuffer.set(msg.id, msg);         // Map 按 id，后写入覆盖
```

- 以 `id` 为主键，同一 id 多次写入只会保留最后一次

---

## 三、去重链路总览

```
WebSocket 收到 MESSAGE 帧
        ↓
IMClient frame_in: conversation 已有 ? 跳过
        ↓
MessageQueue enqueueIncoming: seenIds.has(id) ? 丢弃
        ↓
flush → handleIncomingBatch → emit MESSAGE_RECEIVED/BATCH
        ↓
chatStore: ids.has(m.id) ? 过滤
        ↓
saveMessages → IndexedDB put (同 id 覆盖)
```

---

## 四、ID 选择与去重的配合

1. **服务端消息**：始终有 server_msg_id，去重统一用 `message.id`
2. **用户乐观消息**：先用 client_msg_id，ACK 后替换为 server_msg_id
3. **去重窗口**：5s 内的重复消息会被 MessageQueue 拦截；超窗口后同一 id 若再次到达，会通过 Store/IMClient 的 `ids.has(id)` 过滤
4. **跨源合并**：auth_ok 历史 + sync 补拉 + 实时 MESSAGE，均按 id 去重，保证无重复展示

---

## 五、可调参数

| 模块 | 参数 | 默认值 | 说明 |
|------|------|--------|------|
| MessageQueue | deduplicationWindow | 5000 | 去重窗口 ms，超时后 id 可再次通过 |
| MessageQueue | batchSize | 30 | 每批 flush 条数 |
| MessageQueue | flushInterval | 50 | 批处理间隔 ms |
| MessageQueue | ackTimeoutMs | 10000 | ACK 超时 ms，超时未收到则回队重发 |
| MessageQueue | retryAttempts | 3 | 重试次数，超限后 markSendFailed |

---

## 六、消息可靠性：ACK 超时与增量同步

### 6.1 ACK 超时重发

**问题**：`ws.send` 成功只表示写入缓冲区，网络异常时 ACK 可能永远不到达。

**方案**：send 后消息移入 pendingAck，同时启动 ackTimeoutMs（默认 10s）定时器。超时未收到 ACK 则 `handleAckTimeout` 回队重发或标记失败。

| 环节 | 实现 |
|------|------|
| 移入 pendingAck | flushOutgoing 成功后 `pendingAck.set(message.id, pending)`，启动 timer |
| 收到 ACK | onAck(clientMsgId) 清除 timer、从 pendingAck 移除 |
| 超时 | handleAckTimeout 清除 timer、回队或 markSendFailed |
| 断线 | rollbackPendingAck 清除所有 timer，回滚到 outgoing |

**与 ID 的配合**：重发时仍用 client_msg_id，服务端按 client_msg_id 去重，同一消息不会重复入库。

### 6.2 增量离线同步

**问题**：断线期间有新消息，重连后需补拉，避免依赖 auth_ok 全量。

**方案**：CONNECTED 时若有 conversationId（重连），发送 `SYNC { afterSeqId: maxSeqId }`，服务端返回 `seq_id > afterSeqId` 的消息。

```
CONNECTED（重连）
  → afterSeqId = max(seqId in messages) 或 0
  → 发送 SYNC { afterSeqId, conversationId }
  → sync_response { messages }
  → 合并：filter 去重（按 message.id）→ push → 按 seqId 排序
  → emit MESSAGE_BATCH_RECEIVED
```

**与去重的配合**：sync_response 中消息均有 server_msg_id，通过 `!conversation.messages.some(m => m.id === msg.id)` 去重后合并，保证无重复。

### 6.3 数据流概要

```
发送：outgoing → flush → ws.send → pendingAck（+ ackTimer）
       ↓
ACK 到达 → onAck 移除
超时 → handleAckTimeout 回队/失败
断线 → rollbackPendingAck 回滚

重连：CONNECTED → SYNC { afterSeqId } → sync_response → 去重合并
```
