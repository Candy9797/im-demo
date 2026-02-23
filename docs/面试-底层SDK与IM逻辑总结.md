# 面试总结：底层 SDK 架构 + 即时通讯底层应用逻辑

> 用于展示：**对底层 SDK 架构具备经验，即时通讯工作集中在底层应用逻辑**，让面试官觉得你既懂架构又懂 IM 的「底层实现」。

---

## 一、怎么自我介绍（一句话）

**建议说法**：

> 我在即时通讯这块主要做的是**底层 SDK 架构和底层应用逻辑**：包括连接与鉴权、消息队列的批处理与去重、可靠投递（ACK、重试、断线回滚）、协议设计与传输（帧 seq、大帧分片、JSON/Protobuf），以及高并发下的限流和顺序一致性。上层业务只依赖统一 API 和事件，具体连接、会话、消息流都在 SDK 内部完成。

**变体（更短）**：

> 我的 IM 经验集中在**底层**：SDK 分层设计、消息队列（批处理/去重/可靠投递）、WebSocket 连接与重连、协议层（帧、分片、双格式），以及不丢、不重、不乱序的完整闭环。

---

## 二、怎么展示「很了解」—— 面试可说的要点

### 1. 底层 SDK 架构

| 你说了什么 | 说明（展示你懂） |
|------------|------------------|
| **分层清晰** | 统一 API 层（TIM）→ IMClient（会话、收发）→ WebSocketManager（连接/心跳/重连）+ MessageQueue（队列）+ serializer（编解码/分片）；业务只依赖 API 层，底层可替换。 |
| **事件驱动** | 各层继承 EventEmitter，连接、收消息、发消息、阶段变更、已读/反应等全部通过事件派发，UI/Store 只订阅事件，与 SDK 解耦。 |
| **职责边界** | WebSocketManager 只管「连上、收发帧、心跳、重连」，不关心消息语义；MessageQueue 只管「入队、批处理、ACK 匹配、重试、回滚」，不关心 WebSocket；IMClient 串联会话、消息、上传、历史，并桥接事件。 |

**项目对应**：`TIM` → `IMClient` → `WebSocketManager` / `MessageQueue` / `serializer`，见 `src/sdk/`。

---

### 2. 底层应用逻辑（连接与鉴权）

| 你说了什么 | 说明 |
|------------|------|
| **连接建立** | WebSocket URL 带 `?token=xxx`，服务端首帧校验 JWT 后回 auth_ok（会话 id、历史消息等），客户端收到 auth_ok 后才启动 MessageQueue、视为连接就绪。 |
| **心跳与重连** | 心跳：固定间隔发 Ping，Pong 超时则主动断开触发重连，避免半开连接；重连：onclose 指数退避、限制次数，并监听网络恢复/切回前台做立即重连或 Ping 探测。 |

**项目对应**：`WebSocketManager.getWsUrl()`、`handleConnection` 里 verifyToken、`auth_ok`；心跳/重连见 `WebSocketManager` 注释与 `IM-SDK-面试回答.md` 六。

---

### 3. 底层应用逻辑（消息流与队列）

| 你说了什么 | 说明 |
|------------|------|
| **出站** | 业务发消息 → 乐观更新 UI → 消息入队（outgoing）→ 定时/批量 flush 时真正发到 WebSocket；发出后移入 pendingAck，只有收到 message_ack 才移除，否则 ACK 超时重发，断线时 pendingAck 回滚到 outgoing 重连后重发。 |
| **入站** | 收帧 → 解析出 Message → 入队（incoming）→ 入队时按 message.id 经 seenIds 窗口去重 → 定时 flush 时一批交给 onFlushIncoming，再更新 store、派发事件，避免「来一条 setState 一次」。 |
| **批处理** | 出站/入站都按「时间窗口（如 50ms）+ 批大小（如 300 条）」合并，降低帧数和渲染次数，这是高并发下不卡的关键。 |

**项目对应**：`MessageQueue` 的 `enqueueOutgoing` / `enqueueIncoming`、`flush`、`pendingAck`、`rollbackPendingAck`、seenIds、`onFlushIncoming`/`onFlushOutgoing`。

---

### 4. 底层应用逻辑（顺序与一致性）

| 你说了什么 | 说明 |
|------------|------|
| **服务端 seqId** | 消息落库时分配会话内单调递增 seqId，多路到达（实时推送、SYNC、历史）时前端按 seqId 排序，保证展示顺序一致。 |
| **列表 key** | 用 message.id（clientMsgId）做列表 key，ACK 后不换 id，只更新 status/seqId，避免 key 变化导致重排、闪动。 |
| **帧 seq** | 每帧带单调递增 seq，用于顺序、去重、幂等重试。 |

**项目对应**：服务端写 seqId；前端合并消息时按 seqId 排序；`MessageItem` / 列表 `computeItemKey` 用 `msg.id`；`Frame.seq`。

---

### 5. 底层应用逻辑（不丢、不重、不乱序）

| 你说了什么 | 说明 |
|------------|------|
| **不丢** | 出站：pendingAck + ACK 超时重发 + 断线回滚；入站：服务端持久化 + SYNC/历史补拉。 |
| **不重** | 入站：seenIds 窗口去重；出站：服务端按 clientMsgId 幂等。 |
| **不乱序** | 服务端 seqId + 前端合并时按 seqId 排序；列表 key 用稳定 id。 |

**项目对应**：`IM-SDK-面试回答.md` 八、`MessageQueue` 与 ws-handler 去重/幂等。

---

### 6. 底层应用逻辑（协议与传输）

| 你说了什么 | 说明 |
|------------|------|
| **大帧分片** | 单帧超过阈值（如 64KB）拆成 frag_meta + 多 chunk，接收端按 messageId 重组，避免单帧过大阻塞或超时。 |
| **双格式** | serializer 支持 JSON 与 Protobuf，按连接参数切换，高 QPS 时 Protobuf 体积小、解析快。 |

**项目对应**：`serializer` 的 `splitIntoChunks` / `reassembleChunks`、`encodeFrame`/`decodeFrame` 的 format。

---

## 三、面试时怎么用（展示「很了解」）

1. **先定性**：说「我这边主要做底层 SDK 和底层应用逻辑，不是只写页面」。
2. **再分层**：用「API 层 → IMClient → WebSocketManager / MessageQueue / serializer」把架构说清楚，强调职责边界和事件驱动。
3. **抓一条线**：从「发一条消息」或「收一条消息」走一遍：入队 → 批处理 → 发帧/收帧 → ACK 或去重 → 更新 store/派发事件，中间提到 pendingAck、seenIds、seqId、clientMsgId 幂等。
4. **补可靠性**：主动提不丢（pendingAck + 重试 + 回滚）、不重（seenIds + 服务端幂等）、不乱序（seqId + 稳定 key），以及心跳和重连。
5. **需要时展开**：被问到高并发时，说批处理、去重、限流、虚拟列表、大帧分片（见 `IM高并发场景优化总结.md`）。

---

## 四、口述版（可直接背）

> 我在 IM 这边主要做的是**底层 SDK 架构和底层应用逻辑**。架构上我们是分层加事件驱动：最上层是统一 API，业务只调这一层；下面是 IMClient，负责会话和消息收发，再下面是 WebSocketManager 管连接、心跳、重连，MessageQueue 管消息的入队、批处理、ACK 和重试，serializer 管编解码和大帧分片。所有状态变化都通过事件抛上去，业务只订阅事件。
>
> 底层逻辑上，发消息是乐观更新后入队，定时批量发到 WebSocket，发出后进待确认队列，只有收到 ACK 才移除，超时重发，断线时会把未确认的滚回待发队列，重连后再发。收消息是解析后先入队，按 id 做时间窗口去重，再定时一批批更新到 store 并派发事件，这样高并发时不会来一条就 setState 一次。顺序靠服务端 seqId 和前端按 seqId 排序，列表 key 用稳定的 clientMsgId 不随 ACK 改。协议上有帧 seq、大帧分片、以及 JSON 和 Protobuf 双格式可选。整体上不丢、不重、不乱序和连接稳定性（心跳、重连）都在这一层闭环。

---

## 五、参考文档

- SDK 分层与 API：`docs/IM-SDK-面试回答.md` 一～五、七
- 心跳与重连：`docs/IM-SDK-面试回答.md` 六
- 不丢/不重/不乱序：`docs/IM-SDK-面试回答.md` 八
- 高并发：`docs/IM高并发场景优化总结.md`
- 压测与联调页：`docs/stress与test-ws页面说明.md`
