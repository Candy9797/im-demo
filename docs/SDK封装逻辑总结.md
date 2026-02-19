# src/sdk 封装逻辑总结

> IM SDK 的分层架构、模块职责、数据流及封装设计

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI 层 (chatStore + React)                 │
│   订阅 SDKEvent → set 更新 → 组件重渲染                           │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    │ client.on(SDKEvent.xxx)
                                    │ client.sendMessage / loadHistory ...
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         IMClient (业务层)                         │
│   会话管理、消息收发、ACK 匹配、sync/history、事件派发             │
│   依赖：WebSocketManager、MessageQueue、IndexedDBStore            │
└─────────────────────────────────────────────────────────────────┘
              │                    │                    │
              │ wsManager.send     │ enqueueOutgoing    │ saveMessage
              │ wsManager.on       │ enqueueIncoming    │ getMessages
              ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ WebSocketManager │  │   MessageQueue   │  │ IndexedDBStore   │
│ 传输层           │  │ 批处理/去重/重试  │  │ 本地持久化        │
└──────────────────┘  └──────────────────┘  └──────────────────┘
              │                    │
              │ new WebSocket      │ flush 定时
              ▼                    ▼
┌──────────────────┐         handleOutgoingBatch
│   WebSocket      │         handleIncomingBatch
│  ws://host:3001  │
└──────────────────┘
```

---

## 二、模块职责

### 2.1 EventEmitter（事件基类）

- **职责**：发布订阅，解耦 SDK 内部与 UI
- **能力**：`on` / `once` / `off` / `emit` / `removeAllListeners`
- **继承者**：WebSocketManager、MessageQueue 不继承；IMClient、TIM 继承

---

### 2.2 WebSocketManager（传输层）

- **职责**：建立/关闭 WebSocket、收发 JSON 帧、心跳、断线重连
- **不负责**：业务语义、消息解析
- **帧格式**：`{ type, seq, timestamp, payload }`
- **认证**：URL `?token=xxx`，`&fresh=1` 新建会话
- **心跳**：heartbeatInterval 30s 发 HEARTBEAT_PING
- **重连**：指数退避 `min(base * 2^n + jitter, 30000)`，最多 5 次

| 入帧 | 触发事件 |
|------|----------|
| AUTH_OK | auth_ok |
| MESSAGE | frame_in |
| MESSAGE_ACK | message_ack |
| QUEUE_STATUS | queue_update |
| AGENT_INFO | agent_assigned |
| PHASE_CHANGE | phase_change |
| SYNC_RESPONSE | sync_response |
| SESSION_SWITCHED | session_switched |
| HISTORY_RESPONSE | history_response |
| PRESENCE_UPDATE、READ_RECEIPT、REACTION_UPDATE、KICKED、ERROR | 同名转发 |

---

### 2.3 MessageQueue（批处理队列）

- **职责**：高频消息批处理、去重、出站重试
- **入站**：enqueueIncoming → 去重（seenIds + deduplicationWindow 5s）→ flush 每 50ms 取 batchSize 30 → onFlushIncoming
- **出站**：enqueueOutgoing → flush 每 50ms → onFlushOutgoing → 逐条 wsManager.send
- **失败重试**：重入队头，最多 retryAttempts 3 次，失败改 status=FAILED 并推入 incoming
- **pause/resume**：断线时 pause，auth_ok / sync 后 resume，避免乱序

---

### 2.4 IndexedDBStore（本地持久化）

- **职责**：消息离线存储，刷新/断网后可恢复
- **库名**：web3-im，ObjectStore messages，keyPath: id
- **单条**：saveMessage → writeBuffer → 80ms 防抖或 50 条即 flush
- **批量**：saveMessages 直接 doWrite
- **读前一致性**：getMessages 前先 flush 未写缓冲

---

### 2.5 IMClient（业务层核心）

- **职责**：会话管理、消息收发、ACK 匹配、sync/history、文件上传、事件派发
- **单会话模型**：conversation 一个，Bot/Agent 切换通过 phase + session_switched

**connect 流程**：
1. wsManager.connect() → 服务端验证 token
2. 收到 auth_ok → 若有 serverMessages 覆盖 conversation，否则从 IndexedDB 拉
3. 检查 welcome 消息，无则 unshift
4. messageQueue.start(onFlushOutgoing, onFlushIncoming) → resolve

**消息流**：
- **发送**：createMessage（client_msg_id）→ conversation.messages.push → enqueueOutgoing → emit(MESSAGE_SENT) → flush 时 wsManager.send(SEND_MESSAGE)
- **接收**：frame_in → 去重后 enqueueIncoming → flush → handleIncomingBatch → emit(MESSAGE_RECEIVED/BATCH) → saveMessages
- **ACK**：message_ack → 找 clientMsgId → 替换 id 为 serverMsgId、status=SENT → emit(MESSAGE_STATUS_UPDATE) → saveMessage

**断线恢复**：DISCONNECTED 时 pause，RECONNECTED 时 resume；重连后由服务端发 sync 或客户端主动发 SYNC 帧补拉。

---

### 2.6 TIM（可选封装层）

- **职责**：仿腾讯云 TIM 风格 API，内部委托 IMClient
- **用途**：兼容 TIM 用法，如 `TIM.create()`、`login({ userId, userSig })`、`getConversationList`、`sendMessage`
- **事件映射**：SDKEvent → TIM_EVENT 转发

---

### 2.7 types.ts（类型与常量）

- **消息**：Message、MessageMetadata、QuoteInfo、MessageType、MessageStatus、SenderType
- **连接**：ConnectionConfig、ConnectionState
- **会话**：Conversation、ConversationPhase、AgentInfo、FAQItem
- **协议**：Frame、FrameType
- **事件**：SDKEvent

---

## 三、数据流

### 3.1 发送消息

```
UI sendMessage
  → chatStore.sendMessage
  → client.sendMessage(content)
  → createMessage（client_msg_id）
  → conversation.messages.push
  → messageQueue.enqueueOutgoing
  → emit(MESSAGE_SENT)
  → chatStore 收到 → set(state => state.messages.push({...message}))
  → [50ms 后] flushOutgoing
  → handleOutgoingBatch
  → wsManager.send(SEND_MESSAGE, msg)
  → 服务端
  → message_ack（clientMsgId, serverMsgId）
  → IMClient 替换 id/status
  → emit(MESSAGE_STATUS_UPDATE)
  → chatStore set
```

### 3.2 接收消息

```
服务端 MESSAGE 帧
  → WebSocketManager handleFrame → emit("frame_in")
  → IMClient frame_in 监听
  → 去重后 messageQueue.enqueueIncoming
  → [50ms 后] flushIncoming
  → handleIncomingBatch
  → emit(MESSAGE_RECEIVED/BATCH)
  → saveMessages
  → chatStore 收到 → set(state => ...)
```

---

## 四、封装设计要点

| 点 | 说明 |
|----|------|
| **分层** | 传输(WS) / 队列(MessageQueue) / 业务(IMClient) 分离，可替换传输实现 |
| **事件驱动** | SDK 不依赖 React，UI 通过 on(SDKEvent) 订阅，解耦 |
| **单会话** | conversation 一个，简化状态，Bot/Agent 通过 phase 区分 |
| **client_msg_id / server_msg_id** | 乐观更新用 client_msg_id，ACK 后替换为 server_msg_id |
| **引用隔离** | Store 拷贝 { ...m } 再 push，避免与 IMClient 共享被 Immer freeze |
| **批处理** | 入站/出站均批处理，降低 setState 与网络帧频率 |
| **去重** | MessageQueue seenIds + Store Set 过滤 + IndexedDB keyPath id |
| **持久化** | IndexedDB 防抖写入，读前 flush 保证一致性 |

---

## 五、文件清单

| 文件 | 职责 |
|------|------|
| EventEmitter.ts | 事件基类 |
| WebSocketManager.ts | WebSocket 连接管理 |
| MessageQueue.ts | 消息批处理、去重、重试 |
| IndexedDBStore.ts | 消息本地持久化 |
| IMClient.ts | 业务层核心 |
| TIM.ts | TIM 风格封装（可选） |
| types.ts | 类型与常量 |
| index.ts | 统一导出 |
