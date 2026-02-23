# IM SDK 核心结构与对外 API（面试回答版）

> 代码中统一入口的类名为 **TIM**，下文叙述中称为「**统一 IM API 层**」或「**API 层**」。

## 一、整体架构（分层）

SDK 是**分层 + 事件驱动**的：

```
业务层（React / Store）
        ↓ 调用统一 API 层 / 订阅 TIM_EVENT
┌───────────────────────────────────────┐
│  统一 IM API 层（TIM）/ 适配器          │  create / login / getConversationList /
│  - 对外统一 API，与底层实现解耦         │  getMessageList / sendMessage / loadHistory 等
└───────────────────────────────────────┘
        ↓ 内部持有并调用
┌───────────────────────────────────────┐
│  IMClient（核心客户端）                 │  会话管理、消息收发、文件上传、事件派发
│  - 单会话：Bot / 排队 / Agent 阶段      │  依赖 WebSocketManager + MessageQueue
└───────────────────────────────────────┘
        ↓
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ WebSocketManager │  │  MessageQueue    │  │  serializer      │
│ 连接/心跳/重连    │  │  出站批处理      │  │  JSON/Protobuf   │
│ 帧收发/分片       │  │  ACK 匹配/重试   │  │  大帧分片        │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        ↑                      ↑
  继承 EventEmitter      入站去重、pendingAck 回滚
```

- **统一 IM API 层（TIM）**：对业务暴露的入口，提供 create/login/sendMessage 等统一 API，内部创建并持有 `IMClient`，事件转发为 `TIM_EVENT`。
- **IMClient**：真正做连接、会话、消息、上传、历史、转人工等，依赖 `WebSocketManager`（连接）、`MessageQueue`（收发队列）、`serializer`（编解码）。
- **EventEmitter**：统一 API 层、IMClient、WebSocketManager 都继承它，用 `on/once/emit` 做发布订阅，Store/UI 只订阅事件，不直接依赖内部实现。

---

## 二、对外暴露的入口与主要 API

### 1. 从 `src/sdk/index.ts` 导出的内容

- **统一入口（业务常用）**
  - **统一 IM API 层（TIM）**：类，`TIM.create(options)` 创建实例；`TIM_EVENT`、`LOG_LEVEL` 常量。
  - **IMClient**、**createIMClient(config)**：核心客户端及工厂；**DEFAULT_FAQ_ITEMS** 默认 FAQ。
- **底层模块（高级用法）**
  - **WebSocketManager**、**MessageQueue**、**EventEmitter**。
- **类型与常量**
  - `MessageType`、`MessageStatus`、`SenderType`、`ConnectionState`、`ConversationPhase`、`SDKEvent`、`FrameType` 等常量；
  - `Message`、`Conversation`、`ConnectionConfig`、`Frame`、`FAQItem` 等类型。

### 2. 统一 IM API 层（TIM）暴露的核心方法（面试可答「上层 API」）

| 方法 | 说明 |
|------|------|
| **TIM.create(options?)** | 创建实例（静态工厂） |
| **login({ userId, userSig, fresh? })** | 登录并建立连接（创建 IMClient、connect） |
| **logout()** | 断开连接并清理 IMClient |
| **getConversationList()** | 获取会话列表（单会话模式返回当前会话） |
| **getMessageList({ conversationID, count, nextReqMessageID? })** | 分页拉消息，游标为 nextReqMessageID |
| **sendMessage(message: TIMMessage)** | 发送消息（text/image/file/custom，内部调 IMClient.sendMessage/sendFile） |
| **createTextMessage / createImageMessage / createCustomMessage** | 构造统一 API 风格消息体（TIMMessage） |
| **getCurrentConversation()** | 当前会话 |
| **getConnectionState()** | 连接状态 |
| **loadHistory(beforeSeqId)** | 向上分页拉历史，结果通过 HISTORY_LOADED 事件下发 |
| **markAsRead(messageIds)** | 标记已读 |
| **addReaction / removeReaction** | 表情反应 |
| **requestHumanAgent()** | 转人工客服 |
| **searchMessages(query)** | HTTP 搜索当前会话消息 |
| **getIMClient()** | 获取底层 IMClient（高级能力用） |

事件：`tim.on(TIM_EVENT.XXX, callback)`，如 `CONNECTED`、`MESSAGE_RECEIVED`、`MESSAGE_SENT`、`CONVERSATION_LIST_UPDATED`、`KICKED`、`ERROR` 等。

### 3. IMClient 暴露的核心方法（底层/高级用法）

| 方法 | 说明 |
|------|------|
| **connect()** | 建立连接：WebSocket → auth_ok → 同步会话/消息 → 启动 MessageQueue |
| **disconnect()** | 断开连接并停止队列 |
| **sendMessage(content, type?, metadata?)** | 发文本/系统等，乐观更新 + 入队 |
| **sendFile(file)** | 上传文件后发消息（HTTP /api/upload + 入队） |
| **selectFAQ(faqId)** | 发送 FAQ 选项（faq-6 走转人工） |
| **requestHumanAgent()** | 发送 REQUEST_AGENT 帧，转人工 |
| **getConversation()** | 当前会话（含 phase、messages） |
| **getConnectionState()** | 连接状态 |
| **getFAQItems()** | FAQ 列表 |
| **getQueueStats()** | 队列统计（调试用） |
| **forceFlushOutgoing()** | 立即刷出站队列 |
| **loadHistory(beforeSeqId)** | 拉历史，HISTORY_LOADED 事件 |
| **markAsRead(messageIds)** | 标记已读 |
| **addReaction / removeReaction** | 表情反应 |
| **editMessage / recallMessage** | 编辑/撤回 |
| **searchMessages(query)** | HTTP 搜索 |
| **requestSimulatePush(count)** | 压测用模拟推送 |
| **sendSticker(stickerId)** | 发送贴纸 |

事件：`client.on(SDKEvent.XXX, callback)`，如连接、消息收发、状态更新、阶段变更、已读、反应、历史加载等。

### 4. WebSocketManager（底层）

- **connect() / disconnect()**：建立/关闭 WebSocket；URL 带 `?token=xxx&fresh=1`。
- 内部：心跳 Ping、断线指数退避重连、收帧后解码（JSON/Protobuf）、大帧分片重组，通过 EventEmitter 派发 `CONNECTED`、`auth_ok`、各类帧等。

### 5. MessageQueue（底层）

- **start(onFlushOutgoing, onFlushIncoming, onMessageSendFailed)**：启动定时 flush，注册出站/入站/失败回调。
- **enqueueOutgoing(msg)**：发消息时入队；**enqueueIncoming(msg)**：收消息入队。
- 能力：出站/入站批处理、ACK 超时重发、pendingAck 断线回滚、入站去重。
- **forceFlushOutgoing()**、**stop()** 等。

### 6. serializer（工具层）

- **encodeFrame(frame, format)** / **decodeFrame(data, format)**：帧的 JSON/Protobuf 编解码。
- **splitIntoChunks** / **reassembleChunks**：大帧按 64KB 分片与重组。
- **createFragMeta** / **isFragMeta**：分片元数据。

---

## 三、核心数据结构（面试可简述）

- **Message**：id、conversationId、content、type、status、senderType、senderId、timestamp、metadata（引用、已读、反应）等。
- **Conversation**：id、phase(bot/queuing/agent/closed)、messages、agentInfo、queuePosition 等。
- **Frame**：type（FrameType）、payload，WebSocket 上行/下行单位。
- **ConnectionConfig**：url、token、userId、重连/心跳/队列/ackTimeout/apiBaseUrl/fresh/getPersistedMessages/format 等。

---

## 四、面试可一句话概括的亮点

1. **分层清晰**：统一 IM API 层做统一 API 与事件命名，IMClient 做会话与收发，WebSocketManager 管连接与重连，MessageQueue 管批处理与可靠投递，业务只依赖该 API 层即可。
2. **适配器模式**：统一 API 层对业务提供固定 API，底层可换 IMClient 或后端协议，业务侧改动小。
3. **事件驱动**：连接、收消息、发消息、阶段变更、已读/反应等全部通过 EventEmitter 派发，UI/Store 只订阅事件，解耦。
4. **可靠性与性能**：MessageQueue 出站批处理 + ACK 超时重发 + 断线 pendingAck 回滚；入站批处理 + 去重；大帧 64KB 分片，避免阻塞与超时。
5. **协议可扩展**：serializer 支持 JSON 与 Protobuf，按 format 切换，高 QPS 可选用 Protobuf。

---

## 五、典型使用流程（口述用）

1. **初始化**：`const tim = TIM.create({ wsUrl, apiBaseUrl });`
2. **登录**：`await tim.login({ userId, userSig });` → 内部 createIMClient、connect，收到 auth_ok 后 resolve。
3. **订阅**：`tim.on(TIM_EVENT.MESSAGE_RECEIVED, (msg) => { ... });`，`tim.on(TIM_EVENT.CONNECTED, ...)` 等。
4. **拉会话/消息**：`await tim.getConversationList();`、`await tim.getMessageList({ conversationID, count, nextReqMessageID });`
5. **发消息**：`await tim.sendMessage(tim.createTextMessage({ text: '...' }));` 或先 create 再 send。
6. **转人工**：`tim.requestHumanAgent();`，监听阶段/排队/分配客服等事件。
7. **登出**：`tim.logout();` 断开并清空 client。

以上可作为「我们 IM SDK 的分层、对外暴露的入口与核心方法、以及设计亮点」的面试回答版本使用。

---

## 六、WebSocket 连接稳定性：心跳与重连（面试回答）

### 1. 为什么需要心跳和重连？

- **心跳**：WebSocket 长时间无数据时，NAT、防火墙、代理可能回收连接，但两端不一定立刻感知；心跳定期发 Ping、服务端回 Pong，起到**保活**作用；若连接已死，Pong 超时或下次发送失败会触发重连。
- **重连**：断网、切后台、服务端重启等都会导致 `onclose`；客户端需要**自动重连**，并配合指数退避、网络恢复、切回前台等，避免频繁打爆服务端、又能尽快恢复。

### 2. 心跳设计

| 项 | 说明 |
|----|------|
| **Ping 间隔** | `heartbeatInterval`，默认 30 秒，按间隔发 `HEARTBEAT_PING`。 |
| **Pong 超时** | `heartbeatPongTimeoutMs`，默认 10 秒；发 Ping 后若在此时间内未收到 Pong，认为连接已死，主动 `ws.close()`，由 `onclose` 触发重连。 |
| **半开连接** | 断网、NAT 超时等会导致「能发不能收」；仅靠 Ping 间隔无法发现，必须配合 **Pong 超时** 才能及时断开并重连。 |

### 3. 重连设计

| 项 | 说明 |
|----|------|
| **触发** | WebSocket `onclose`（含网络异常、服务端关闭、Pong 超时主动关闭）。 |
| **退避** | 指数退避 + 随机抖动：`delay = min(1000 × 2^reconnectCount + random(0~1000), 30000)`，避免雪崩。 |
| **次数** | `reconnectAttempts` 默认 5 次；超过后派发 `DISCONNECTED`，不再自动重连。 |
| **重置** | 重连成功（`onopen`）时 `reconnectCount = 0`；**网络恢复**（`window.online`）时也会重置并立即重连，不等待退避。 |

### 4. 断网、切后台的专门处理

| 场景 | 处理方式 |
|------|----------|
| **断网恢复** | 监听 `window.addEventListener('online')`；若当前为 RECONNECTING 或 DISCONNECTED（含已达最大重连次数），清除重连定时器、`reconnectCount = 0`、**立即 connect()**，不等待退避间隔。 |
| **切回前台** | 监听 `document.visibilitychange`，当 `visibilityState === 'visible'` 且已连接时，**立即发一次 Ping** 并启动 Pong 超时；若连接在后台已被回收，会在 Pong 超时内发现并触发重连。 |
| **仅浏览器** | 上述 visibility、online 仅在 `document`/`window` 存在时绑定；用户主动 `disconnect()` 时解绑，避免泄漏。 |

### 5. 配置小结（面试可简述）

- **心跳**：`heartbeatInterval` 30s 发 Ping，`heartbeatPongTimeoutMs` 10s 内未收到 Pong 则断开重连。
- **重连**：`reconnectAttempts` 5 次，`reconnectInterval` 1s 为基数做指数退避，上限 30s；网络恢复时立即重连并重置次数；切回前台时发一次 Ping 用 Pong 超时检测连接是否仍有效。

### 6. 口述版（可直接背）

我们 WebSocket 的稳定性主要靠心跳和重连。心跳是每 30 秒发一次 Ping，服务端回 Pong；同时我们做了 Pong 超时，默认 10 秒内没收到 Pong 就认为连接已经死了，主动关掉连接触发重连，这样半开连接、断网、NAT 超时都能及时发现。重连是 onclose 时用指数退避，1 秒起、最多 30 秒，最多重连 5 次；另外在浏览器里会监听网络恢复事件，一旦从断网恢复就立刻重连并重置次数，不等退避；还会监听页面可见性，用户从后台切回前台时发一次 Ping，用 Pong 超时检查连接是否还有效，无效就触发重连。这样断网、切后台、连接不稳定都能比较稳地恢复。

---

## 七、面试口述总结（可直接背/说给面试官）

我们这边有一个自研的 IM SDK，主要给客服场景用，支持 Bot 对话和转人工。整体是分层加事件驱动的：最上层是统一 IM API 层，对外提供 create、login、getConversationList、getMessageList、sendMessage、loadHistory、转人工这些能力，业务只依赖这一层；下面一层是 IMClient，负责真正的连接、单会话管理、消息收发、文件上传、历史拉取，依赖 WebSocketManager 做连接和重连、MessageQueue 做发消息的批处理和 ACK 重试；再往下是 WebSocketManager、MessageQueue 和 serializer，分别管连接心跳重连、出站入站批处理与可靠投递、以及 JSON/Protobuf 编解码和大帧分片。所有层都继承 EventEmitter，连接、收消息、发消息、阶段变更、已读反应等都通过事件派发，前端 Store 和 UI 只订阅事件，和 SDK 解耦。设计上我们用了适配器模式，统一 API 层对业务接口固定，底层可以换 IMClient 或后端协议而业务改动很小；可靠性方面有 MessageQueue 的 ACK 超时重发、断线时 pending 消息回滚、入站去重，以及大帧 64KB 分片避免阻塞。协议上支持 JSON 和 Protobuf，高 QPS 可以切 Protobuf。大致就是这样一套分层清晰、事件驱动、可扩展的 IM SDK。

---

## 八、消息不丢、不重复、不乱序（面试可答）

**问：IM 里怎么保证消息不丢、不重复、不乱序？**

---

### 一、不丢（消息不丢失）

#### 1. 发出去的消息（出站可靠）

**思路**：发出去的消息在「服务端确认前」都视为未落地，用**待确认队列 + 超时重发 + 断线回滚**保证最终送达或明确失败。

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| **待确认队列（pendingAck）** | `MessageQueue` | 消息经 `flushOutgoing` 真正发到 WebSocket 后，从 `outgoing` 移入 `pendingAck`（key 为 clientMsgId）；**只有收到服务端 `message_ack`** 且 payload 里带对应 `clientMsgId` 时，才在 `onAck(clientMsgId)` 里从 pendingAck 移除并清掉 ACK 超时定时器。 |
| **ACK 超时重发** | `MessageQueue` | 每条进入 pendingAck 的消息会起一个定时器，`ackTimeoutMs`（默认 10s）内未收到 ACK 则触发 `handleAckTimeout`：从 pendingAck 取出该条，若 `attempts < retryAttempts`（默认 3）则重新 **unshift 回 outgoing**，下次 flush 会重发；否则标记为 FAILED 并回调 `onMessageSendFailed`，UI 可展示发送失败。 |
| **断线回滚** | `MessageQueue` + `IMClient` | WebSocket 触发 `DISCONNECTED` 时，IMClient 调用 `messageQueue.rollbackPendingAck()`：把 pendingAck 里所有未确认消息按「未超重试次数则回滚到 outgoing、否则标记失败」处理，并清空 pendingAck、清除所有 ACK 定时器。重连成功后队列 `resume()`，这些消息会在后续 flush 中再次发出。**outgoing 与 pendingAck 均在内存**，不持久化到 IndexedDB；故**页面刷新**后队列重建为空，刷新前仍在待发/待确认的消息不会自动重发，只有已进会话列表并 persist 的消息会从 IndexedDB 恢复展示。 |
| **发送失败时回队** | `MessageQueue.flushOutgoing` | `onFlushOutgoing`（即实际 ws.send）抛错时（如已断开），不丢消息：该批消息重新放回 outgoing 或达到重试上限后标记失败。 |

**流程简述**：用户发消息 → 入队 outgoing → 定时 flush 调用 ws 发送 → 发成功的进入 pendingAck 并启动 ACK 定时器 → 服务端回 message_ack(clientMsgId) → onAck 移除并更新消息状态为 SENT；若超时或断线，则回滚到 outgoing 或标记失败，重连后继续发。

#### 2. 收进来的消息（入站补拉）

**思路**：网络抖动、断线、页面刷新会导致漏收；用**重连后增量同步 + 历史分页**把缺口补上。

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| **重连后 SYNC** | `IMClient` 监听 `CONNECTED` | 重连成功且当前有 `conversationId` 时，取本地 `conversation.messages` 里**最大 seqId** 作为 `afterSeqId`，发一帧 `SYNC { afterSeqId, conversationId }`；服务端返回该会话中 seqId > afterSeqId 的所有消息，通过 `sync_response` 下发给客户端，客户端合并进 messages 并去重、排序后派发。这样离线期间产生的消息会被补拉。 |
| **历史分页 loadHistory** | `IMClient` 监听 `history_response` | 用户向上滚动拉更早消息时，发 `LOAD_HISTORY { beforeSeqId }`，服务端返回该会话中 seqId < beforeSeqId 的若干条；客户端用 `id` 去重后插入列表头部，再整体按 seqId 排序。用于首屏之前的消息补全，而不是实时缺口，但同样避免「只依赖实时推送」导致的漏消息。 |
| **协议层 seq** | `Frame`、WebSocketManager | 每帧带单调递增 `seq`（README 约定），便于服务端/客户端发现**序号缺口**（例如收到 seq=1、3 缺 2），可据此请求补发或告警，为「不丢」提供协议基础。 |
| **本地持久化（IndexedDB）** | `chatStore` + `chatPersistStorage` | 会话与消息列表通过 Zustand persist 存到 IndexedDB；页面刷新或 auth_ok 时若服务端未带消息，通过 `getPersistedMessages(conversationId)` 从本地恢复展示，避免已收到的消息「看不见」，相当于接收侧的本地兜底。 |

**流程简述**：断线期间服务端有新消息 → 重连 → CONNECTED 里取本地 max(seqId)，发 SYNC(afterSeqId) → 服务端返回 afterSeqId 之后的消息 → sync_response 里按 id 去重、按 seqId 排序合并 → 派发 MESSAGE_RECEIVED/BATCH，UI 更新。

---

### 二、不重复（消息不重复、幂等）

**思路**：网络重传、重连重发、多端同步都会导致同一条消息被多次投递；客户端要在**入站**和**出站**两侧都做幂等。

#### 1. 入站去重

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| **时间窗口 seenIds** | `MessageQueue.enqueueIncoming` | 入站消息在进入 incoming 队列前，用 `isDuplicate(id)` 检查：`seenIds` 里若已有该 `message.id`（任意来源：实时推送、sync、重试导致的重复帧），则**直接丢弃**，不入队。seenIds 存的是 id → 时间戳，定期 `cleanupDedup()` 删除超过 `deduplicationWindow`（默认 5s）的条目，避免缓存无限增长；5s 窗口能覆盖常见网络重传、重复推送。 |
| **sync_response 合并去重** | `IMClient` 监听 `sync_response` | 同步下来的消息在合并前 `filter` 掉本地已存在的：`!conversation.messages.some(m => m.id === msg.id)`，只 push 真正新的，再 sort。避免重连多次 SYNC 或服务端重复下发的重复。 |
| **history_response 合并去重** | `IMClient` 监听 `history_response` | 同上，拉历史时按 `id` 过滤掉本地已有消息，再插入头部并排序。 |
| **frame_in 合并去重** | `IMClient` 监听 `frame_in` | 实时 MESSAGE 帧到达时，先用 `ids = new Set(conversation.messages.map(m => m.id))`，只保留 `!ids.has(m.id)` 的为新消息，再合并、排序、派发；同时也会 `enqueueIncoming` 给 MessageQueue（用于批处理/统计），那里会再做一次 seenIds 去重。 |

#### 2. 出站幂等

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| **clientMsgId 唯一** | `IMClient.createUserMessage` 等 | 每条发出的消息在客户端生成唯一 **clientMsgId**（如 uuid），从发起到 ACK 全程不变；重试发的是同一条消息（同一 clientMsgId），服务端应**按 clientMsgId 去重**，只落库一条并回一条 message_ack。 |
| **ACK 按 clientMsgId 匹配** | `IMClient` 监听 `message_ack` | 服务端 ACK 里带 `clientMsgId`（或 client_msg_id），客户端用其找到本地对应消息并更新为 SENT、可选的 serverMsgId；多次重发同一 clientMsgId 只会对应同一条本地消息，不会在 UI 上变成多条。 |

**口述要点**：入站用 **seenIds 窗口 + 各合并点按 id 过滤** 防重复展示；出站用 **clientMsgId 唯一 + 服务端按 clientMsgId 去重** 防重复落库，重试是幂等的。

---

### 三、不乱序（消息顺序一致）

**思路**：消息可能从**实时推送、SYNC、loadHistory** 多条路径到达，且到达顺序不等于全局发送顺序；用**统一序号 + 合并后排序**保证展示顺序与发送顺序一致。

| 机制 | 实现位置 | 说明 |
|------|----------|------|
| **服务端 seqId** | `Message` 类型、服务端 | **seqId 由服务端分配**。**生成规则**：`nextSeqId(convId) = MAX(seq_id) + 1`（按会话取当前最大 seq_id 加一，空会话从 1 起）。**格式**：整数（DB 为 INTEGER，下发给前端为 number），同一会话内严格单调递增，不同会话独立。落库后随 MESSAGE 或 message_ack 下发给前端；客户端乐观消息在 ACK 前可能无 seqId，ACK 或 SYNC 会补全。 |
| **合并后统一排序** | `IMClient` 中 frame_in、sync_response、history_response | 每次往 `conversation.messages` 插入新消息后，都执行一次排序：`(a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp)`。即：有 seqId 用服务端序号，没有则用 timestamp 兜底，保证列表顺序与「发送/服务端顺序」一致。 |
| **协议帧 seq** | `Frame.seq`、WebSocketManager | 每帧带单调递增 `seq`（客户端/服务端各自维护发帧序号），用于**帧级**顺序与去重、重试幂等；与**消息 seqId**（服务端分配、会话内递增）是两套：帧 seq 管帧，消息 seqId 管消息列表排序与 SYNC(afterSeqId)。 |

**涉及位置小结**：  
- `frame_in`：合并新消息后 `[...conversation.messages, ...newMsgs].sort(seqId ?? timestamp)`。  
- `sync_response`：push 新消息后 `conversation.messages.sort(seqId ?? timestamp)`。  
- `history_response`：新消息插到头部后 `[...newMsgs, ...conversation.messages].sort(seqId ?? timestamp)`。  

**口述要点**：所有写入消息列表的地方都**按 seqId（或 timestamp）排序**；协议层帧带 **seq**，保证顺序可检测、可恢复。

---

### 四、小结表（面试可扫一眼）

| 目标 | 主要手段 |
|------|----------|
| **不丢** | 出站：pendingAck + ACK 超时重发（最多 3 次）+ 断线 rollbackPendingAck 回滚到 outgoing；入站：重连 SYNC(afterSeqId) 补拉、loadHistory(beforeSeqId) 分页；本地：会话/消息列表 Zustand persist 到 IndexedDB，刷新或 auth_ok 空消息时从本地恢复展示；协议 seq 做 gap 检测。 |
| **不重复** | 入站：MessageQueue seenIds 窗口去重 + frame_in/sync_response/history_response 按 message.id 合并去重；出站：clientMsgId 唯一、服务端按 clientMsgId 去重，重试幂等。 |
| **不乱序** | 消息带 seqId；所有合并点合并后按 (seqId ?? timestamp) 排序；帧带 seq。 |

---

### 五、口述版（详细版，可直接背/说给面试官）

我们 IM 保证消息不丢、不重复、不乱序是这样做的：

**不丢**方面，发出去的消息会进待确认队列 pendingAck，只有收到服务端的 message_ack 才移除；如果超过 10 秒没收到 ACK，会重发，最多重试 3 次，还不行就标记发送失败。待发队列（outgoing）和待确认队列（pendingAck）都在**内存**里，不存 IndexedDB。断线时会把所有未确认的消息回滚到内存中的待发队列，重连后队列 resume 继续发，所以发送侧不会因为断线丢消息。这里**断线**和**页面刷新**不一样：断线只是 WebSocket 断开，页面进程还在，MessageQueue 实例和内存里的队列都还在，所以能回滚、重连后重发；**页面刷新**会重建整个应用，MessageQueue 是新建的、outgoing/pendingAck 为空，刷新前还在「待发」或「待确认」的那几条消息不会自动重发（本项目没有把发送队列持久化到 IndexedDB），只有已经进会话列表、被 persist 存进 IndexedDB 的「已展示消息」会在刷新后从本地恢复。收消息这边，重连成功后会发 SYNC（增量同步），带上本地已收到的最大 seqId， conversationId，服务端返回这个序号之后的消息，把离线期间漏掉的补拉回来；历史消息用 beforeSeqId 分页拉取，和本地合并。另外会话和消息列表会通过 Zustand persist 存到 IndexedDB，页面刷新或登录时如果服务端 auth_ok 没带消息，会从本地恢复已收到的消息展示，避免「已收消息看不见」；协议上每帧带 seq，方便发现序号缺口后向服务端请求补发。

**不重复**方面，入站用 MessageQueue 的 seenIds 做时间窗口去重，默认 5 秒内同一 message.id 只接受一次；另外在实时消息、SYNC 结果、历史拉取合并时都会按消息 id 过滤，已经存在的就不重复插入。出站每条消息有唯一的 clientMsgId，服务端按 clientMsgId 去重，我们重试发同一条不会在服务端变成多条，是幂等的。收到 message_ack 后，会用服务端下发的 serverMsgId 更新该条消息的 id（clientMsgId 被替换为服务端 id），之后去重和排序都按这条唯一 id 来；前端排序统一用 seqId 优先、没有则用 timestamp，即 `(a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp)`，所有合并消息的地方（实时推送、SYNC、历史）都按这一规则重排，保证顺序一致。这里的 timestamp 指的就是 消息对象（Message）上的 timestamp 字段，单位是毫秒（number）。
在哪用：排序代码里用的是 a.timestamp / b.timestamp，也就是每条消息自带的 Message.timestamp。
从哪来：
自己发的消息：客户端 createMessage 里写的是 timestamp: Date.now()，即客户端本地时间。
服务端下发的消息（推送、SYNC、历史）：timestamp 来自服务端（DB 里存的或当时生成的），一般是服务端时间。

**不乱序**方面，**seqId 由服务端分配**。**生成规则**：按会话维度，`nextSeqId(convId) = MAX(seq_id) + 1`（该会话下当前最大 seq_id 加一，空会话从 1 起）。**格式**：整数（服务端 DB 为 INTEGER，下发给前端为 number），无额外编码；同一会话内严格单调递增，不同会话各自独立。服务端落库后随 MESSAGE 或 message_ack 下发给前端。前端所有合并消息的地方——无论是实时推送、SYNC 还是历史拉取——合并后都按 seqId 排序，没有 seqId 就用 timestamp 兜底，这样展示顺序和发送顺序一致。注意**协议层帧的 seq** 是客户端/服务端发帧时的自增序号（帧级），和**消息体的 seqId**（服务端分配、会话内唯一递增）是两套：前者用于帧顺序与去重，后者用于消息列表排序与 SYNC(afterSeqId) 增量拉取。
服务端为这条消息在该会话里分配的序号，会话内从 1 开始单调递增（第一条 1，第二条 2…）。
谁维护：由服务端在落库时按会话用 nextSeqId(convId) = MAX(seq_id)+1 生成，并随 MESSAGE / message_ack 下发给前端。
作用：业务层用——消息列表按 seqId 排序、SYNC 用 afterSeqId 拉增量，保证「不丢、不乱序」都是基于消息的 seqId，不是帧的 seq。
这样不丢、不重复、不乱序就都覆盖到了。

---

### 六、与项目实现一致的表述（修正版）

下面是你提供的思路经**对照本项目代码**修正后的版本，可直接用于面试或方案文档；括号内为与本项目实现不符、已按实际实现改动的说明。

#### 1. 不丢消息

- **发送端**
  - **ACK 超时重试**：消息发出后进入待确认队列 pendingAck，若 `ackTimeoutMs`（默认 10s）内未收到服务端 `message_ack`，则重发，最多重试 3 次，超限则标记发送失败并回调 `MESSAGE_SEND_FAILED`。
  - **断线回滚**：断线时 `rollbackPendingAck()` 将 pendingAck 中未确认消息回滚到待发队列 outgoing，重连后队列 resume，这些消息会在后续 flush 中再次发出。（**本项目没有**「两级队列 + 断连时持久化到 IndexedDB」：MessageQueue 的 outgoing/pendingAck 仅在内存，不持久化；IndexedDB 用于 **chatStore 的会话与消息列表** 的 Zustand persist，用于页面刷新/重连后恢复展示及 auth_ok 空消息时用 getPersistedMessages 拉本地消息，不是发送队列的持久化。）
  - **重连后补发**：即上述回滚到 outgoing 的消息在重连后由定时 flush 自动发出，不依赖「先查后端已接收再选择性补发」；服务端按 clientMsgId 去重即可。
- **接收端**
  - **重连后 SYNC 补拉**：重连成功（CONNECTED）且当前有 conversationId 时，取本地消息列表最大 `seqId` 作为 `afterSeqId`，发 `SYNC { afterSeqId, conversationId }`，服务端返回该会话中 seqId > afterSeqId 的消息，通过 sync_response 合并进本地并去重、排序后派发，补全离线期间漏收的消息。（**本项目 SDK 未实现**「前端确认接收并返回 recv 确认、后端未确认则重推」；接收端不丢主要依赖重连后的 SYNC 补拉，若后端另有 recv 确认与重推可单独说明。）
  - **历史分页**：`loadHistory(beforeSeqId)` 拉取更早消息，与本地按 id 去重后插入并排序，用于首屏之前的消息补全。
- **兜底**
  - 依赖**重连后的 SYNC(afterSeqId) + loadHistory(beforeSeqId)** 补拉漏消息；协议帧带 `seq` 便于发现序号缺口。（**本项目没有**「SDK 记录所有收发消息日志、定期校验完整性、发现丢失自动拉取补全」的独立模块。）

#### 2. 不重消息

- **前端**
  - 收到消息后先按 **message.id** 去重：实时帧（frame_in）、SYNC 结果（sync_response）、历史拉取（history_response）在合并前都会过滤掉本地已存在的 id，只插入新消息，不重复渲染、不重复写入 conversation.messages。
  - MessageQueue 入站还有 **seenIds** 时间窗口（默认 5s）去重，同一 id 在窗口内只接受一次，防止网络重传导致的重复帧。
  - （多 Tab 场景本项目未在 SDK 层专门处理；若有多 Tab，可由业务层或后端用 msgId/clientMsgId 统一去重。）
- **后端（协议约定）**
  - 发送侧使用唯一 **clientMsgId**，服务端应对 clientMsgId 做唯一约束或去重：同一 clientMsgId 只落库一条、只回一条 message_ack；客户端重试发同一条消息（同一 clientMsgId）不会在服务端产生多条，即幂等。
- **重连补发**
  - 本项目**不**在重连后「先查询后端已接收列表、仅补发未接收的」；断线时未确认消息全部回滚到 outgoing 并重发，依赖**服务端按 clientMsgId 去重**：已处理过的会直接回 ACK，不重复落库、不重复推送。

#### 3. 不乱消息

- **核心**
  - **以服务端下发的 seqId 为排序主键**，无 seqId 时用消息的 timestamp 兜底；不依赖「统一用后端服务器时间戳」的表述，只要消息带 seqId 即可保证顺序一致。（本项目未在客户端做「发送时带本地时间戳、后端替换为服务器时间戳再推送」的显式约定，排序逻辑是 `seqId ?? timestamp`。）
- **发送端**
  - 消息发送时带 clientMsgId 和本地 timestamp；ACK 后可能带上 serverMsgId；后续 SYNC 会补全服务端分配的 seqId。
- **接收端**
  - 所有合并消息的入口（frame_in、sync_response、history_response）在插入后都执行**同一种排序**：`(a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp)`，保证展示顺序与发送/服务端顺序一致；拉取历史、补全离线消息时同样按该规则排序。
- **兜底**
  - 无需单独的「检测乱序再触发一次重排」：**每次合并新消息后都会重排**，弱网延迟到达的消息在合并时会被排到正确位置。

#### 差异小结（你原描述 → 本项目实现）

| 原描述 | 本项目实际情况 |
|--------|----------------|
| 发送端：两级队列断连时持久化到 IndexedDB | 发送队列（outgoing/pendingAck）仅在内存；IndexedDB 用于 chatStore 的会话/消息列表持久化与 auth_ok 空消息时恢复展示，不是队列持久化。 |
| 接收端：前端返回 recv 确认，后端未确认则重推 | SDK 未实现 recv 确认；接收端不丢靠重连 SYNC(afterSeqId) 补拉。 |
| 兜底：SDK 记录收发日志、定期校验、自动补全 | 无该模块；兜底为重连 SYNC + loadHistory + 协议 seq。 |
| 重连补发：先查后端已接收，仅补发未接收的 | 未确认消息全部回队重发；依赖服务端 clientMsgId 去重实现幂等。 |
| 不乱序：统一后端服务器时间戳 | 以 **seqId** 为主、timestamp 兜底；不强调「后端替换时间戳」的实现细节。 |
| 不乱序兜底：前端检测乱序后触发一次重排 | 每次合并后都会排序，无单独「检测乱序再重排」逻辑。 |
