# IM SDK 做了什么，为什么要封装

> 简洁版：SDK 的职责、核心能力，以及封装的动机与收益。

---

## 一、IM SDK 做了什么

**一句话**：把「连接、协议、消息队列、可靠投递、同步与历史」从 UI 里抽出来，对外提供**统一 API + 事件**，业务只调 API、只订阅事件，不碰 WebSocket、不碰帧、不碰队列。

**分层与职责**：

| 层级 | 模块 | 做什么 |
|------|------|--------|
| **统一 API 层** | TIM（可选） | 对外 create/login/sendMessage/getMessageList/loadHistory 等，内部委托 IMClient；事件名统一为 TIM_EVENT。 |
| **业务层** | IMClient | 会话管理、消息收发、ACK 匹配、sync/history、文件上传、转人工；订阅 WebSocketManager 与 MessageQueue，收到帧/批次后做语义解析并 emit SDKEvent。 |
| **传输层** | WebSocketManager | 建立/关闭 WebSocket、帧收发、心跳、断线指数退避重连、大帧分片重组；不关心消息语义，只 emit 原始帧或 auth_ok。 |
| **队列层** | MessageQueue | 入站/出站批处理（50ms 一批）、入站去重（seenIds）、出站 pendingAck + ACK 超时重发 + 断线回滚；不关心 WebSocket，只通过回调收/发。 |
| **编解码** | serializer | 帧的 JSON/Protobuf 编解码、大帧拆片与重组。 |

**核心能力归纳**：

- **连接与鉴权**：URL + token（Sec-WebSocket-Protocol）、auth_ok 后视为就绪。
- **可靠投递**：乐观更新 + 出队发送、pendingAck、ACK 超时重发、断线回滚，不丢；入站去重、服务端 clientMsgId 幂等，不重。
- **顺序与一致性**：服务端 seqId，前端合并时按 seqId 排序；列表 key 稳定（clientMsgId）。
- **高频与长列表**：批处理降渲染/帧数，大帧分片、可选 Protobuf。
- **离线与恢复**：persist 持久化 messages/conversationId；重连后 SYNC 补拉，与本地合并。

---

## 二、为什么要封装

**1. 业务与传输/协议解耦**

- 若不封装：页面里直接 `new WebSocket`、手写心跳/重连、手写帧格式与重试，UI 和协议、连接强绑定，改协议或换传输要改一堆组件。
- 封装后：业务只调 `login()`、`sendMessage()`、`loadHistory()`，只订阅 `MESSAGE_RECEIVED`、`CONNECTED` 等事件；**协议、帧格式、连接细节都在 SDK 内部**，换后端或换传输（如 long-polling）时业务改动最小。

**2. 业务与「底层复杂度」隔离**

- 连接稳定性（心跳、Pong 超时、指数退避、网络恢复/切前台）、批处理与去重、ACK 与回滚、大帧分片、SYNC 补拉，这些逻辑集中在一个库里，**UI 不写 if (断线) / 重试 / 去重**，只响应事件和更新状态。
- 降低出错面：复杂逻辑集中维护，而不是散落在各个组件。

**3. 事件驱动，框架无关**

- SDK 继承 EventEmitter，只 `emit` 事件，不引用 React/Vue；Store/UI 通过 `on(SDKEvent.xxx)` 订阅。
- **同一套 SDK** 可给不同页面、不同框架用，甚至 Node 侧复用；不封装则容易变成「为当前页面写的 WebSocket 脚本」，难以复用。

**4. 可测试、可替换**

- 各层职责清晰：传输层可 mock WebSocket，队列层可单测批处理/去重，IMClient 可单测会话与 ACK 逻辑。
- 传输层可替换（如换成长轮询、SSE），业务层与队列层复用；协议可扩展（JSON/Protobuf），业务无感。

**5. 统一维护「不丢、不重、不乱序」**

- 不丢（pendingAck、重试、回滚）、不重（seenIds、服务端幂等）、不乱序（seqId、稳定 key）都在 SDK 内闭环，**业务不自己实现一遍**，避免各页面各写一套导致行为不一致。

---

## 三、一句话总结

**IM SDK 做了**：把连接、协议、消息队列、可靠投递、同步与历史封装成**分层 + 事件驱动**的一整套能力，对外是**统一 API + 事件**。**为什么要封装**：让业务与传输/协议解耦、与底层复杂度隔离，做到框架无关、可测试、可替换，并在一处统一保证不丢、不重、不乱序，避免逻辑分散和重复实现。
