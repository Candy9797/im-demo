# IM SDK 详细说明

> 客服 IM 前端 SDK：连接管理、消息队列、会话与事件，支持 JSON/Protobuf、离线恢复、批处理与可靠发送。

---

## 一、概述

### 1.1 定位

- **职责**：在 Web 端与 IM 服务端之间提供连接、认证、消息收发、会话状态与事件派发，与 UI 解耦。
- **分层**：上层可用 **TIM** 统一 API，或直接使用 **IMClient**；底层由 WebSocketManager、MessageQueue、序列化层组成。
- **持久化**：消息列表与会话 ID 由业务层（如 chatStore + Zustand persist）持久化；SDK 通过 `getPersistedMessages` 在 auth_ok 空消息时参与离线恢复。

### 1.2 目录与入口

```
src/sdk/
├── index.ts           # 统一导出：TIM、IMClient、类型、常量
├── IMClient.ts        # 核心客户端：会话、收发、sync/history、事件转发
├── WebSocketManager.ts # WebSocket：连接、心跳、重连、帧收发、分片
├── MessageQueue.ts    # 消息队列：出站批处理、ACK、重试、入站去重
├── MessageQueue.md    # MessageQueue 专项技术文档
├── EventEmitter.ts    # 事件：on/once/off/emit
├── serializer.ts      # 帧序列化：JSON / Protobuf、大帧分片
├── types.ts           # 消息、会话、连接、帧、事件等类型与常量
├── TIM.ts             # 类 TIM 风格适配层（可选）
└── SDK.md             # 本文档
```

**对外使用**：从 `@/sdk` 或 `src/sdk/index.ts` 引入 `createIMClient`、`IMClient`、`SDKEvent`、`Message`、`ConnectionState` 等即可。

---

## 二、架构

### 2.1 分层关系

```
┌─────────────────────────────────────────────────────────────────┐
│  业务层（chatStore / 页面）                                       │
│  - 订阅 SDKEvent，更新 messages / phase / connectionState         │
│  - 调用 sendMessage / loadMoreHistory / markAsRead 等             │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│  TIM（可选）                                                      │
│  - create / login / getConversationList / getMessageList / ...   │
│  - 内部持有 IMClient，做协议与 API 形状适配                        │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│  IMClient                                                        │
│  - connect / disconnect / sendMessage / sendFile / loadHistory   │
│  - conversation 内存状态，sync/history 与 message_ack 更新        │
│  - 将 WebSocketManager / MessageQueue 事件转为 SDKEvent 派发     │
└─────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌──────────────────────┐            ┌──────────────────────────────┐
│  WebSocketManager    │            │  MessageQueue                 │
│  - connect/disconnect│            │  - enqueueOutgoing/Incoming  │
│  - send(type,payload)│◄───────────│  - flush 定时、ACK 超时       │
│  - 心跳、重连、分片   │            │  - rollbackPendingAck / pause │
└──────────────────────┘            └──────────────────────────────┘
         │
         ▼
┌──────────────────────┐            ┌──────────────────────────────┐
│  serializer          │            │  EventEmitter                 │
│  - encodeFrame       │            │  - on / once / off / emit     │
│  - decodeFrame       │            │  - IMClient/WebSocketManager   │
│  - JSON / Protobuf   │            │    继承，用于事件派发          │
└──────────────────────┘            └──────────────────────────────┘
```

### 2.2 数据流简图

- **发消息**：`sendMessage` → 创建 Message、push 到 conversation、`enqueueOutgoing` → 定时 flush → `handleOutgoingBatch` → `wsManager.send(SEND_MESSAGE)` → 服务端 → `message_ack` → `onAck` 更新 status、派发 `MESSAGE_STATUS_UPDATE`。
- **收消息**：服务端 MESSAGE 帧 → `handleFrame` → `frame_in` → IMClient 更新 conversation、`enqueueIncoming` → 定时 flush → `handleIncomingBatch` → 派发 `MESSAGE_RECEIVED` / `MESSAGE_BATCH_RECEIVED`。
- **断线**：`DISCONNECTED` → `rollbackPendingAck`、`pause` MessageQueue；重连 `CONNECTED` → `resume`、发 SYNC 拉取 afterSeqId 之后消息。

---

## 三、模块说明

### 3.1 IMClient（IMClient.ts）

**职责**：单会话 IM 客户端。维护当前会话（id、phase、messages）、消息收发、文件上传、FAQ/转人工、历史与同步，并将底层事件转为 SDKEvent。

**主要方法**：

| 方法 | 说明 |
|------|------|
| `connect()` | 建立 WebSocket，等待 auth_ok 后初始化会话、启动 MessageQueue，支持从 getPersistedMessages 恢复离线消息 |
| `disconnect()` | 停止队列、断开 WebSocket |
| `sendMessage(content, type?, metadata?)` | 创建消息、入队、乐观派发 MESSAGE_SENT |
| `sendFile(file)` | 上传到 apiBaseUrl/api/upload，成功后 createMessage 并入队发送 |
| `selectFAQ(faqId)` | 发送 FAQ 问题；faq-6 走转人工 |
| `requestHumanAgent()` | 发送 REQUEST_AGENT，插入排队系统消息，phase → QUEUING |
| `loadHistory(beforeSeqId)` | 拉取该 seqId 之前的历史，结果通过 history_response → HISTORY_LOADED |
| `markAsRead(messageIds)` | 标记已读 |
| `addReaction` / `removeReaction` | 表情反应 |
| `editMessage(messageId, content)` | 编辑消息 |
| `recallMessage(messageId)` | 撤回消息 |
| `searchMessages(query)` | HTTP 搜索当前会话消息 |
| `getConversation()` | 当前会话对象 |
| `getConnectionState()` | 连接状态 |
| `getQueueStats()` | 队列统计（压测等用） |
| `forceFlushOutgoing()` | 立即 flush 出站队列（压测用） |

**内部**：`createMessage` 生成 clientMsgId、status=SENDING；`handleOutgoingBatch` 单条发对象、多条发数组；重连后若有 conversationId 则发 SYNC(afterSeqId)。

### 3.2 WebSocketManager（WebSocketManager.ts）

**职责**：WebSocket 生命周期、帧收发、心跳、断线指数退避重连、大帧分片（Protobuf 时）。

**认证**：JWT 通过 `Sec-WebSocket-Protocol: ["im-auth", token]` 传递，URL 不带 token。支持 `fresh=1` 新建会话。

**主要方法**：

| 方法 | 说明 |
|------|------|
| `connect()` | 创建 WebSocket(url, ["im-auth", token])，onopen 后派发 CONNECTED、开心跳、绑定页面可见性/网络事件 |
| `disconnect()` | 停心跳、清重连定时器、关 ws、派发 DISCONNECTED |
| `send(type, payload)` | 组 Frame、encodeFrame、>CHUNK_SIZE 时分片发送；返回 Frame |
| `getState()` | 当前 ConnectionState |
| `getCurrentSeq()` | 当前帧序列号 |

**事件（内部）**：auth_ok、frame_in、message_ack、queue_update、agent_assigned、phase_change、sync_response、history_response、server_error 等；由 IMClient 订阅并转发或处理。

**心跳**：默认 30s Ping，10s 内未收到 Pong 则断开并触发重连。**重连**：指数退避 + 抖动，最多 5 次，最大间隔 30s。

### 3.3 MessageQueue（MessageQueue.ts）

**职责**：出站批处理、ACK 确认与超时重试、断线回滚；入站批处理与去重。详见 **MessageQueue.md**。

**要点**：

- **出站**：`enqueueOutgoing` → outgoing 队列 → 定时 flush → `onFlushOutgoing`（实际发 ws）→ 消息进入 pendingAck，ack 超时则重发或失败回调。
- **入站**：`enqueueIncoming` → seenIds 去重 → incoming → flush → `onFlushIncoming`（派发到 UI）。
- **断线**：`rollbackPendingAck` 把未确认消息放回 outgoing；`pause` 停 flush；重连后 `resume` 继续发送。
- **配置**：batchSize、flushInterval、ackTimeoutMs、deduplicationWindow 等；IMClient 使用 flushInterval 50、batchSize 300。

### 3.4 EventEmitter（EventEmitter.ts）

**职责**：发布/订阅。`on` 持久订阅、`once` 单次订阅、`off` 取消、`emit` 派发（先 on 后 once），单次触发后 once 监听器移除。IMClient、WebSocketManager 继承，用于解耦 SDK 与 UI。

### 3.5 serializer（serializer.ts）

**职责**：帧的编码/解码。支持 **JSON**（默认）和 **Protobuf**（高 QPS、体积更小）。大帧（>64KB）在 Protobuf 下分片：首条为 frag_meta（messageId、totalChunks、format），后续为二进制分片，接收端重组后 decode。

**导出**：`encodeFrame`、`decodeFrame`、`CHUNK_SIZE`、`createFragMeta`、`isFragMeta`、`splitIntoChunks`、`reassembleChunks`、`SerializeFormat`。

### 3.6 types（types.ts）

**职责**：消息、会话、连接、帧、事件等类型与常量。

**常用类型**：

- **Message**：id、conversationId、content、type、status、senderType、senderId、senderName、timestamp、metadata、seqId 等。
- **MessageType**：text、image、pdf、emoji、system、sticker、voice、video 等。
- **MessageStatus**：sending、sent、delivered、read、failed。
- **SenderType**：user、bot、agent、system。
- **ConnectionState**：disconnected、connecting、connected、reconnecting。
- **ConversationPhase**：bot、queuing、agent、closed。
- **ConnectionConfig**：url、token、userId、reconnectAttempts、heartbeatInterval、messageQueueSize、apiBaseUrl、ackTimeoutMs、getPersistedMessages、format 等。
- **Frame**：type、seq、timestamp、payload。
- **FrameType**：C2S 与 S2C 所有帧类型（auth、send_message、message、message_ack、sync、load_history、auth_ok、error 等）。

**SDKEvent**：见下节。

### 3.7 TIM（TIM.ts）

**职责**：在 IMClient 之上提供类 TIM 风格 API（create、login、getConversationList、getMessageList、sendMessage 等），便于对接不同后端或上层统一调用。核心逻辑仍在 IMClient，TIM 做参数与返回值形状转换。

---

## 四、事件（SDKEvent）

IMClient 派发以下事件，业务层通过 `client.on(SDKEvent.XXX, handler)` 订阅。

| 事件 |  payload 说明 |
|------|----------------|
| CONNECTED | - |
| DISCONNECTED | - |
| RECONNECTING | - |
| CONNECTION_ERROR | error |
| MESSAGE_RECEIVED | Message |
| MESSAGE_BATCH_RECEIVED | Message[] |
| MESSAGE_SENT | Message（乐观更新） |
| MESSAGE_STATUS_UPDATE | Message（如 ACK 后 status→sent） |
| MESSAGE_SEND_FAILED | Message |
| PHASE_CHANGED | ConversationPhase |
| AGENT_ASSIGNED | AgentInfo |
| QUEUE_UPDATE | { position, total, estimatedWait } |
| TYPING_START / TYPING_STOP | payload |
| MESSAGES_RESET | { messages, conversationId } |
| PRESENCE_UPDATE / READ_RECEIPT / REACTION_UPDATE | payload |
| MESSAGE_EDIT / MESSAGE_RECALL | payload |
| KICKED | payload |
| HISTORY_LOADED | { messages, hasMore } |

另有 **server_error**（如 rate_limit）、**message_ack_batch**（批量 ack 条数）供压测等使用。

---

## 五、连接与认证

- **建立连接**：`createIMClient(config)` 得到 IMClient，再 `await client.connect()`。connect 内部：`wsManager.connect()` → 收到 auth_ok → 写入 conversationId/phase/messages（或从 getPersistedMessages 恢复）→ 启动 MessageQueue → resolve。
- **URL**：默认 `ws://${hostname}:3001/ws`，可配 `url`。Query 支持 `fresh=1`（新建会话）、`format=protobuf`。
- **Token**：通过 `Sec-WebSocket-Protocol: ["im-auth", token]` 传递，不在 URL 中，避免泄露。
- **离线恢复**：若 auth_ok 的 messages 为空，且配置了 `getPersistedMessages`，则用其结果填充 conversation 并派发 MESSAGE_RECEIVED/BATCH，供界面先展示本地持久化消息。

---

## 六、消息收发与同步

### 6.1 发送

- **文本/贴纸等**：`sendMessage(content, type?, metadata?)` → createMessage（id 为 clientMsgId）→ push 到 conversation、enqueueOutgoing、emit MESSAGE_SENT。MessageQueue 定时 flush，调用 handleOutgoingBatch，单条发 `SEND_MESSAGE` 单对象，多条发数组。
- **文件**：`sendFile(file)` → POST /api/upload → 成功后 createMessage(url, type, metadata) 再入队发送。
- **ACK**：服务端 message_ack（含 clientMsgId/serverMsgId/seqId）→ messageQueue.onAck(clientMsgId) 移除 pendingAck，更新消息 status 为 SENT、写 seqId，派发 MESSAGE_STATUS_UPDATE。

### 6.2 接收

- 服务端 MESSAGE 帧 → frame_in → 更新 conversation.messages、enqueueIncoming；MessageQueue 去重后 flush 调用 handleIncomingBatch，派发 MESSAGE_RECEIVED 或 MESSAGE_BATCH_RECEIVED。
- **sync_response**：重连后 SYNC(afterSeqId) 的响应，合并进 conversation、按 seqId 排序后派发。
- **history_response**：loadHistory(beforeSeqId) 的响应，插入列表头部、按 seqId 排序，派发 HISTORY_LOADED。

### 6.3 可靠性与顺序

- **不丢**：出站 pendingAck + ACK 超时重发、断线 rollbackPendingAck 重连后重发。
- **不重**：入站 seenIds 窗口去重；sync/history 合并时按 id 去重。
- **顺序**：消息按 seqId（或 timestamp）排序；服务端保证 seqId 单调递增，见项目内后端文档。

---

## 七、配置速查

| 配置项 | 默认 | 说明 |
|--------|------|------|
| url | ws://hostname:3001/ws | WebSocket 地址 |
| token | "" | JWT，Sec-WebSocket-Protocol 传递 |
| userId | - | 当前用户 ID |
| reconnectAttempts | 5 | 最大重连次数 |
| reconnectInterval | 1000 | 重连间隔基数（指数退避） |
| heartbeatInterval | 30000 | 心跳 Ping 间隔（ms） |
| heartbeatPongTimeoutMs | 10000 | Pong 超时（ms） |
| messageQueueSize | 2000 | 出站队列最大长度 |
| ackTimeoutMs | 10000 | ACK 超时（ms） |
| apiBaseUrl | http://hostname:3001 | 上传、搜索等 HTTP 根地址 |
| fresh | - | 是否新建会话 |
| format | "json" | "json" \| "protobuf" |
| getPersistedMessages | - | 离线恢复回调 |

---

## 八、使用示例

```ts
import { createIMClient, SDKEvent } from "@/sdk";

const client = createIMClient({
  userId: "user-1",
  token: "jwt-xxx",
  getPersistedMessages: async (convId) => {
    const raw = await getPersistedChatState(); // 从 IndexedDB 等读取
    return raw?.conversationId === convId ? raw.messages : [];
  },
});

client.on(SDKEvent.CONNECTED, () => console.log("connected"));
client.on(SDKEvent.MESSAGE_RECEIVED, (msg) => console.log("received", msg));
client.on(SDKEvent.MESSAGE_SENT, (msg) => console.log("sent", msg));

await client.connect();

client.sendMessage("Hello");
const conv = client.getConversation();
console.log(conv.messages, conv.phase);

client.loadHistory(conv.messages[0]?.seqId ?? 0);
client.on(SDKEvent.HISTORY_LOADED, ({ messages, hasMore }) => {
  console.log("history", messages.length, hasMore);
});
```

---

## 九、相关文档

- **MessageQueue**：队列设计、出站/入站流程、ACK 与断线回滚见 `MessageQueue.md`。
- **后端**：WebSocket 帧协议、限流、seqId、存储等见服务端代码与项目 docs（若保留）。
