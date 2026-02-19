# MessageQueue 技术文档

> 高频 IM 消息队列：批处理、去重、ACK 确认、重试、断线回滚

---

## 一、背景与问题

### 1.1 场景

IM 场景下消息收发是**高频操作**：
- **出站**：用户连续发送、Bot 回复、文件上传后发送，可能短时间产生大量待发帧
- **入站**：服务端推送、群聊/行情等可能每秒数十条消息

若每条消息立刻：
- **出站**：立刻 `ws.send()` → WebSocket 帧数过多，增加网络负担和序列化开销
- **入站**：立刻 `emit` + `setState` → 组件重渲染过于频繁，造成卡顿

### 1.2 核心诉求

| 诉求 | 说明 |
|------|------|
| 批处理 | 多条消息合并一批处理，降低 I/O 和渲染频率 |
| 去重 | 网络抖动、重连 sync 可能导致同一消息重复到达 |
| 可靠发送 | 发送失败可重试，ACK 超时未确认可重发 |
| 断线恢复 | 断线时已发出但未 ACK 的消息，重连后应回滚并重发 |
| 背压控制 | 队列满时需有丢弃策略，避免内存爆炸 |

---

## 二、架构概览

### 2.1 整体模型

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MessageQueue                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  出站侧                                                                   │
│  enqueueOutgoing ──► outgoing[] ──► flushOutgoing ──► onFlushOutgoing    │
│                                          │                               │
│                                          ▼                               │
│                              pendingAck (等 ACK)                         │
│                                    │                                     │
│                      onAck 到达 ──► 移除      ACK 超时 ──► 回队/失败      │
│                                                                          │
│  入站侧                                                                   │
│  enqueueIncoming ──► incoming[] ──► flushIncoming ──► onFlushIncoming    │
│       │                    │                                              │
│       └── seenIds 去重 ◄───┘                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

**模式**：生产者-消费者。`setInterval(flush, flushInterval)` 定时从队列取一批数据交给回调处理。

### 2.2 与 IMClient 的集成

```
IMClient.sendMessage / sendFile
  → createMessage + conversation.push
  → messageQueue.enqueueOutgoing(message)
  → emit MESSAGE_SENT（乐观更新）

定时 flush
  → messageQueue.flushOutgoing
  → handleOutgoingBatch(msgs)
  → wsManager.send(FrameType.SEND_MESSAGE, msgs.length === 1 ? msgs[0] : msgs)  // 单条发对象，多条发数组（一帧）

message_ack 到达
  → messageQueue.onAck(clientMsgId)
  → 从 pendingAck 移除

frame_in 到达（收到服务端消息）
  → conversation.push + messageQueue.enqueueIncoming(msg)
  → 定时 flush → handleIncomingBatch
  → emit MESSAGE_RECEIVED / MESSAGE_BATCH_RECEIVED
```

---

## 三、核心数据结构

### 3.1 出站侧

| 结构 | 类型 | 含义 |
|------|------|------|
| `outgoing` | `PendingMessage[]` | 待发送队列，FIFO |
| `pendingAck` | `Map<clientMsgId, PendingMessage>` | 已发出、等待 ACK 的消息 |
| `ackTimers` | `Map<clientMsgId, timer>` | ACK 超时定时器，超时则重发或标记失败 |

**PendingMessage**：`{ message, attempts, addedAt }`，`attempts` 用于限制重试次数。

### 3.2 入站侧

| 结构 | 类型 | 含义 |
|------|------|------|
| `incoming` | `Message[]` | 待处理入站队列 |
| `seenIds` | `Map<id, timestamp>` | 去重缓存，窗口内重复 id 丢弃 |

### 3.3 控制

| 结构 | 含义 |
|------|------|
| `_isPaused` | 断线时暂停 flush，重连后 resume |
| `flushTimer` | `setInterval`，每 `flushInterval` ms 执行一次 flush |

---

## 四、出站流程详解

### 4.1 入队 → 发送 → ACK

```
enqueueOutgoing(msg)
  → outgoing.push({ message, attempts: 0, addedAt })
  → 队列满时丢弃最旧的非 SENDING 消息

flush 定时触发
  → splice(0, batchSize) 取一批
  → attempts++
  → onFlushOutgoing(batch)  // ws.send
  → 成功：移入 pendingAck，启动 ackTimeout 定时器
  → 失败：attempts < retryAttempts 则 unshift 回队，否则 markSendFailed
```

### 4.2 为何需要 pendingAck？

- WebSocket `send()` 只是写入发送缓冲区，不等服务端真正收到
- 服务端收到后会回 `message_ack`，客户端据此确认
- 在收到 ACK 前，消息处于「已发出但未确认」状态；若此时断线，需要重发

**pendingAck** 就是「已发出但未 ACK」的消息集合。断线时 `rollbackPendingAck()` 把它们移回 `outgoing`，重连后再 flush 重发。

### 4.3 ACK 超时

- 每条发出消息启动 `ackTimeoutMs`（默认 10s）定时器
- 超时未收到 ACK：可能丢包或服务端异常
- 处理：`attempts < retryAttempts` 则回队重发，否则标记失败并回调 `onMessageSendFailed`

### 4.4 断线时的 rollbackPendingAck

```
DISCONNECTED 事件
  → messageQueue.rollbackPendingAck()
  → 遍历 pendingAck，清除 ackTimers，将未确认消息 unshift 回 outgoing
  → messageQueue.pause()  // 暂停 flush，避免断线时继续发

CONNECTED（重连成功）
  → messageQueue.resume()
  → flush 恢复，outgoing 中的消息会再次被发送
```

这样可以在重连后自动重发断线前「已发出但未确认」的消息。

---

## 五、入站流程详解

### 5.1 入队 → 去重 → 派发

```
enqueueIncoming(msg)
  → 若 seenIds.has(msg.id)，return false（丢弃重复）
  → seenIds.set(msg.id, Date.now())
  → incoming.push(msg)
  → cleanupDedup()  // 清理超出 deduplicationWindow 的 seenIds

flush 定时触发
  → flushIncoming：splice(0, batchSize)
  → onFlushIncoming(batch)
  → IMClient 中 emit MESSAGE_RECEIVED 或 MESSAGE_BATCH_RECEIVED
```

### 5.2 为何需要入站去重？

- 网络重传、重连 sync、多端同步等可能让同一消息多次到达
- 若不去重，会导致重复渲染、重复 push 到 conversation
- `seenIds` 在 `deduplicationWindow`（默认 5s）内记住已见过的 id，窗口外的 id 会被清理，避免内存无限增长

### 5.3 为何入站也要批处理？

- 每条消息立刻 `emit` 会导致 Store 频繁 `set`，React 频繁重渲染
- 批量 emit 一次，`MESSAGE_BATCH_RECEIVED` 时 Store 只 `set` 一次，减少渲染次数

---

## 六、为何先 flush 入站再 flush 出站？

```ts
private async flush(): Promise<void> {
  this.flushIncoming();
  await this.flushOutgoing();
}
```

- **入站**：用户更关心「收到新消息」，优先处理入站可更快展示
- **出站**：已乐观更新，稍晚几毫秒发出对体验影响小
- 顺序上先入后出，保证「收到」优先于「发出」

---

## 七、配置说明

| 配置 | 默认 | 说明 |
|------|------|------|
| maxSize | 1000 | 出站队列最大长度，超限丢弃最旧非 sending |
| batchSize | 20 | 每批处理的条数 |
| flushInterval | 100 | 批量 flush 间隔（ms） |
| retryAttempts | 3 | 发送失败 / ACK 超时最大重试次数 |
| retryDelay | 1000 | 重试间隔基数（当前实现未用指数退避，可扩展） |
| deduplicationWindow | 5000 | 入站去重窗口（ms） |
| ackTimeoutMs | 10000 | ACK 超时（ms） |

IMClient 实际使用：`flushInterval: 50`，`batchSize: 30`，适应客服 IM 的中高频场景。

---

## 八、设计取舍

### 8.1 为何用定时 flush 而不是「积满 batchSize 就 flush」？

- 消息可能稀疏，若只按「满 batch 才 flush」，最后几条可能长时间停留在队列
- 定时 flush 保证**最大延迟**约为 `flushInterval`，兼顾吞吐和延迟

### 8.2 队列满时为何丢弃「最旧的非 sending」？

- SENDING 状态表示正在发送，不应中途移除
- 丢弃最旧的未发送消息，尽量保留最近的消息，符合用户直觉

### 8.3 为何 unshift 回队（头部插入）？

- 重试 / 回滚的消息希望**尽早**再次发送
- `unshift` 让它们排到队头，下一次 flush 就能被处理

### 8.4 pause / resume 的作用

- 断线时：`pause()` 停止 flush，避免向已断开的 WebSocket 发送
- 重连后：`resume()` 恢复 flush，配合 `rollbackPendingAck` 重发未确认消息

---

## 九、总结

| 能力 | 实现方式 |
|------|----------|
| 批处理 | 定时 flush，每批 batchSize 条，减少 ws 帧数和 setState 次数 |
| 去重 | seenIds 窗口去重，避免重复消息 |
| 可靠发送 | pendingAck + ackTimeout，超时重发或标记失败 |
| 断线恢复 | rollbackPendingAck 回滚未确认消息，重连后重发 |
| 背压 | 队列满时丢弃最旧非 sending 消息 |

整体上，MessageQueue 在**吞吐、延迟、可靠性**之间做了平衡，适合 IM、行情等高频消息场景。
