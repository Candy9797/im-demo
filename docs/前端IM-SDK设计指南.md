# 前端 IM SDK 设计指南（类 TIM-JS-SDK）

参考腾讯云 IM (TIM)、融云、环信等商用 SDK，梳理设计一个通用前端 IM SDK 的架构思路与技术要点。

---

## 一、SDK 核心能力矩阵

| 能力域 | 子能力 | 说明 |
|--------|--------|------|
| **连接管理** | 登录/登出、重连、心跳、多端踢线 | 长连接生命周期 |
| **会话管理** | 会话列表、未读数、置顶、草稿 | 会话级状态 |
| **消息能力** | 收发、富媒体、引用、反应、已读回执 | 消息级能力 |
| **群组** | 创建/解散、成员、@、群公告 | 群聊特有 |
| **离线与同步** | 本地存储、差量同步、未读拉取 | 可靠性 |
| **扩展** | 插件、自定义消息、信令 | 可扩展性 |

---

## 二、分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     API 层 (对外暴露)                         │
│  login / sendMessage / getConversationList / on(EVENT)       │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                     业务逻辑层                                │
│  ConversationManager | MessageManager | GroupManager         │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                     核心能力层                                │
│  EventEmitter | MessageQueue | 去重 | 乐观更新 | ACK 匹配     │
└─────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────┐
│                     传输与存储层                              │
│  WebSocketManager | LongPolling(降级) | IndexedDB / LocalStorage │
└─────────────────────────────────────────────────────────────┘
```

**设计原则**：上层不直接依赖底层实现，通过接口/事件通信，便于替换传输层、存储层。

---

## 三、关键技术要点

### 3.1 框架无关与运行环境

| 要点 | 说明 |
|------|------|
| **无 React/Vue 依赖** | 核心 SDK 用纯 TS/JS，不 import React 等，可在任意前端框架、Node、小程序中使用 |
| **适配器模式** | 提供 `createWebAdapter` / `createMiniProgramAdapter` 等，封装不同环境的 WebSocket、Storage、网络请求 |
| **构建产物** | 支持 UMD、ESM、CJS，Tree-shaking 友好 |

```typescript
interface IAdapter {
  WebSocket: typeof WebSocket;
  getStorage: (key: string) => Promise<string | null>;
  setStorage: (key: string, value: string) => Promise<void>;
  request: (url: string, options?: RequestInit) => Promise<Response>;
}
```

### 3.2 连接与传输

| 要点 | 说明 |
|------|------|
| **多传输通道** | WebSocket 为主，失败时降级长轮询，保证弱网可用 |
| **连接状态机** | DISCONNECTED → CONNECTING → CONNECTED ↔ RECONNECTING，状态变更 emit 事件 |
| **重连策略** | 指数退避 + 随机抖动，最大间隔可配置（如 30s） |
| **心跳** | 可配置间隔（如 4min），超时无 PONG 触发重连 |
| **多端/踢线** | 服务端下发 KICKED，SDK 通知上层并清理本地会话 |

### 3.3 消息协议与序列化

| 要点 | 说明 |
|------|------|
| **帧结构** | type + seq + payload，支持 JSON / Protobuf / 自定义编码 |
| **seq 单调递增** | 用于排序、去重、断点续传 |
| **client_msg_id / server_msg_id** | 客户端生成临时 id，服务端 ACK 回填 server id，用于乐观更新与幂等 |

### 3.4 会话与消息模型

| 要点 | 说明 |
|------|------|
| **会话类型** | C2C、群组、系统会话，各类型有不同的未读、@、草稿逻辑 |
| **消息类型** | 文本、图片、语音、视频、文件、自定义，通过 type 枚举 + payload 扩展 |
| **Conversation 抽象** | 每个会话持有 messageList、unreadCount、lastMessage 等，SDK 内部维护，通过 getConversationList 等 API 暴露 |

### 3.5 消息队列与批处理

| 要点 | 说明 |
|------|------|
| **入站批处理** | 高频收消息时，按时间窗口（如 50ms）或条数（如 30）批量 flush，减少上层回调次数 |
| **出站队列** | 发送失败自动重试，断线时暂停、恢复时续发 |
| **去重** | 按 message.id + 时间窗口（如 5s）去重，避免重试/重推导致重复 |

### 3.6 离线存储与同步

| 要点 | 说明 |
|------|------|
| **本地存储** | IndexedDB 存消息、会话元数据，按 conversationId 分区，支持按 seq 分页 |
| **同步策略** | 登录后拉取各会话 lastMsgSeq，缺什么补什么；或全量拉取 + 本地 merge |
| **写入优化** | 防抖、批量写，避免每一条消息都触发一次事务 |

### 3.7 事件系统

| 要点 | 说明 |
|------|------|
| **事件分层** | 连接事件、会话事件、消息事件、群组事件等，便于按需订阅 |
| **once / on** | 支持一次性监听，用于 login 的 resolve |
| **错误事件** | 统一 ERROR 事件，携带 code、message、context，便于监控与降级 |

```typescript
enum TIM_EVENT {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  MESSAGE_RECEIVED = 'message_received',
  CONVERSATION_UPDATED = 'conversation_updated',
  KICKED = 'kicked',
  ERROR = 'error',
}
```

### 3.8 单例与多实例

| 模式 | 说明 |
|------|------|
| **单例** | 同一页面/应用只存在一个 SDK 实例，适合单账号场景（类似 TIM） |
| **多实例** | 支持多账号同时在线，实例间隔离，适合管理端、多账号工具 |

```typescript
// 单例
const tim = TIM.create({ appId, userId, userSig });
await tim.login();

// 多实例
const tim1 = TIM.create({ ...config1 });
const tim2 = TIM.create({ ...config2 });
```

### 3.9 插件与扩展

| 要点 | 说明 |
|------|------|
| **插件接口** | 提供 registerPlugin(plugin)，plugin 可注册中间件、新消息类型、自定义存储 |
| **自定义消息** | 通过 type + payload 扩展，SDK 透传，渲染由业务层决定 |
| **信令通道** | 单独的信令消息类型，用于音视频、白板等业务信令 |

### 3.10 安全性

| 要点 | 说明 |
|------|------|
| **UserSig/Token** | 登录凭证，定期刷新，不在 SDK 内硬编码 |
| **敏感信息** | 不在日志中输出 token、消息内容等 |
| **传输** | 生产环境强制 wss，支持证书校验 |

---

## 四、API 设计风格（参考 TIM）

### 4.1 初始化与登录

```typescript
const tim = TIM.create({
  appId: number,
  SDKAppID?: number,  // 兼容旧版
});

tim.setLogLevel(0);  // 0: 关闭, 1: 错误, 2: 警告, 3: 信息, 4: 调试

await tim.login({
  userId: string,
  userSig: string,
});
```

### 4.2 会话

```typescript
// 获取会话列表
const { data } = await tim.getConversationList();
// data.conversationList: Conversation[]

// 获取某会话消息
const { data } = await tim.getMessageList({
  conversationID: string,
  count: number,
  nextReqMessageID?: string,  // 分页游标
});

// 删除会话、置顶、标记已读等
await tim.deleteConversation(conversationID);
await tim.setConversationPin(conversationID, true);
await tim.setMessageRead(conversationID);
```

### 4.3 消息

```typescript
// 发送
const message = tim.createTextMessage({ text: 'hello' });
await tim.sendMessage(message);

// 监听
tim.on(TIM.EVENT.MESSAGE_RECEIVED, (ev) => {
  ev.data.forEach(msg => { /* ... */ });
});
```

### 4.4 事件

```typescript
tim.on(TIM.EVENT.CONNECTED, () => {});
tim.on(TIM.EVENT.MESSAGE_RECEIVED, (ev) => {});
tim.on(TIM.EVENT.CONVERSATION_LIST_UPDATED, (ev) => {});
tim.off(TIM.EVENT.MESSAGE_RECEIVED, handler);
```

---

## 五、数据流图（本项目）

```
出站: Store ──► IMClient ──► MessageQueue ──► WebSocketManager ──► Server
入站: Server ──► WebSocketManager ──► IMClient ──► Store
```

**详细说明**：

```
【出站：发送消息】
Store ──sendMessage──► IMClient ──enqueueOutgoing──► MessageQueue ──flush──► WebSocketManager ──► Server
  ▲                                                                                              │
  └──────────────── MESSAGE_SENT（乐观更新）─────────────────────────────────────────────────────┘

【入站：接收消息】
Server ──► WebSocketManager ──► IMClient ──emit MESSAGE_RECEIVED──► Store
                │                     │
                │                     └── (内部经 MessageQueue 批处理)
                └── frame / auth_ok
```

**文字描述**：
- **出站**：Store 调 `sendMessage` → IMClient 乐观 emit → 入队 MessageQueue → 定时 flush 经 WebSocketManager 发出 → Server
- **入站**：Server 推送 → WebSocketManager 解析 → IMClient 入队 MessageQueue → flush 后 emit → Store 订阅更新 UI

---

## 六、消息协议与序列化（本项目实现）

### 6.1 帧结构（Frame）

所有 WebSocket 帧采用统一格式，定义在 `src/sdk/types.ts`：

```typescript
interface Frame {
  type: FrameType;   // 帧类型
  seq: number;       // 帧序列号，用于顺序与去重
  timestamp: number; // 时间戳（毫秒）
  payload: unknown;  // 业务负载，根据 type 解析
}
```

### 6.2 序列化方式

使用 **JSON** 编解码，未使用 Protobuf：

- **发送**：`ws.send(JSON.stringify(frame))`
- **接收**：`JSON.parse(event.data)` 得到 Frame，再按 `type` 分发

### 6.3 帧类型（FrameType）

| 方向 | 类型 | 用途 |
|------|------|------|
| C2S | `send_message` | 发送消息 |
| C2S | `ping` | 心跳 Ping |
| C2S | `sync` | 拉取增量消息 |
| C2S | `load_history` | 拉取历史消息 |
| C2S | `request_agent` | 请求转人工 |
| C2S | `mark_read`、`add_reaction`、`remove_reaction` | 已读、表情等 |
| S2C | `auth_ok` | 认证成功，附带会话和消息 |
| S2C | `message` | 收到消息 |
| S2C | `message_ack` | 消息送达确认（含 serverMsgId、seqId） |
| S2C | `pong` | 心跳 Pong |
| S2C | `queue_status`、`phase_change`、`session_switched` 等 | 排队、阶段、会话切换等 |

### 6.4 client_msg_id / server_msg_id

- **clientMsgId**：客户端发送时生成，格式 `msg-${Date.now()}-${random}`，作为 `Message.id`，用于乐观更新与幂等
- **MESSAGE_ACK**：服务端回填 `{ clientMsgId, serverMsgId, seqId }`，客户端收到后更新消息 id 为 `serverMsgId`、status 为 `SENT`

### 6.5 seq 的用法

- **帧 seq**：`WebSocketManager` 维护，每次 `send` 自增，用于帧级排序与去重
- **消息 seqId**：服务端在会话内分配，用于消息排序与增量同步（`sync` 的 `afterSeqId`、`load_history` 的 `beforeSeqId`）

### 6.6 小结

| 要点 | 本项目实现 |
|------|------------|
| 序列化 | JSON |
| 帧结构 | type + seq + timestamp + payload |
| seq | 客户端帧 seq 自增；消息 seqId 由服务端分配 |
| clientMsgId / serverMsgId | 客户端生成临时 id，服务端 ACK 回填 serverMsgId |

---

## 七、与当前项目的对应

本项目的 `src/sdk/` 已实现部分能力，可作为「轻量版 TIM」的雏形：

| 能力 | 本项目实现 | 类 TIM 完整形态 |
|------|------------|-----------------|
| 连接 | WebSocketManager、重连、心跳 | + 长轮询降级 |
| 协议 | Frame、FrameType、clientMsgId | + Protobuf 可选 |
| 消息队列 | MessageQueue 批处理、去重 | + 更细粒度配置 |
| 存储 | IndexedDBStore | + 会话元数据、分页 |
| 事件 | EventEmitter、SDKEvent | + 分层事件、once |
| 会话 | 单会话（Bot/Agent） | + 多会话、未读、置顶 |
| 框架无关 | 纯 TS，无 React 依赖 | 已满足 |
| 单例 | createIMClient 每次新建 | 可加 getInstance 单例 |

---

## 八、断线重连与离线消息（本项目实现）

### 8.1 离线消息存在哪里

| 存储位置 | 说明 |
|----------|------|
| **服务端 SQLite** | 路径 `data/im.db`。断线期间的聊天记录存于此，重连时服务端在 `handleConnection` 中调用 `db.getMessagesAfter(convId, 0)`，取最近 100 条，通过 `auth_ok` 下发 |
| **客户端 IndexedDB** | `src/lib/chatPersistStorage.ts`，库名 `web3-im-chat`。chatStore 通过 Zustand persist 持久化 `messages`、`conversationId`。当 `auth_ok` 返回空时，IMClient 调用 `getPersistedMessages` 从 IndexedDB 读取本地兜底 |

### 8.2 为何 auth_ok 会返回空

`auth_ok` 的 `messages` 来自 `db.getMessagesAfter(convId, 0)`。以下情况该会话无消息，服务端会返回空数组：

1. **新建会话（fresh=true）**：用户点击「新对话」，连接带 `?fresh=1`，服务端调用 `createBotConversation` 新建会话，新会话无任何消息
2. **新用户或首次使用**：`getOrCreateBotConversation` 为新用户创建空会话
3. **会话刚创建、尚未收发任何消息**：会话已存在但消息表为空

### 8.3 本地兜底（IndexedDB）何时有效

`getPersistedMessages` 会校验 `s?.conversationId === conversationId`，只有本地持久化的会话 ID 与当前会话 ID 一致才会使用。

| 场景 | 服务端 messages | 本地兜底是否有效 |
|------|-----------------|------------------|
| 新建会话 | 空 | 否（新 convId 与持久化不匹配） |
| 新用户首次连接 | 空 | 否（本地无该会话数据） |
| 正常重连 | 有消息 | 不需要兜底 |
| 重连但服务端异常返回空（DB 清空、错误等） | 空 | 可能有效（convId 一致时可展示本地消息） |

本地兜底主要应对：重连到已有会话时，服务端因异常未返回消息，可用本地持久化先展示历史。

---

## 九、实现优先级建议

1. **P0**：连接、协议、消息收发、事件、基础存储
2. **P1**：会话模型、未读、分页拉取、重连优化
3. **P2**：批处理、去重、长轮询降级
4. **P3**：群组、插件、多实例、自定义消息

---

## 十、参考

- 腾讯云 IM：https://cloud.tencent.com/document/product/269
- 融云 SDK：https://docs.rongcloud.cn/
- 本项目 `src/sdk/`：EventEmitter、WebSocketManager、MessageQueue、IMClient、IndexedDBStore
