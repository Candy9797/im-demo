# WebSocketManager 说明

`WebSocketManager`（`src/sdk/WebSocketManager.ts`）负责 IM 的 WebSocket 连接：建连/断连、收发帧、心跳保活、断线重连、大帧分片，以及浏览器下的页面生命周期联动。上层 `IMClient` 使用它建立长连接并订阅其派发的事件。

---

## 一、职责概览

| 职责 | 说明 |
|------|------|
| **建连 / 断连** | `connect()` 建立连接，JWT 通过 `Sec-WebSocket-Protocol` 子协议传递；`disconnect()` 优雅关闭并解绑监听 |
| **收发帧** | `send(type, payload)` 编码后发送；`onmessage` 里解码、分片重组后按 `type` 派发事件（如 `frame_in`、`message_ack`） |
| **心跳** | 连接成功后按间隔发 `HEARTBEAT_PING`，收到 `HEARTBEAT_PONG` 清掉「等 Pong」超时；超时未收到 Pong 则主动 `close` 触发重连 |
| **断线重连** | `onclose` 时若未达最大重连次数则 `scheduleReconnect()`（指数退避 + 随机抖动），超限则派发 `DISCONNECTED` |
| **分片** | Protobuf 模式下单帧超过 `CHUNK_SIZE` 时拆成多段发送；收端先收分片元数据再收各 chunk，重组后解码并 `handleFrame` |
| **页面生命周期** | 仅浏览器：连接后绑定 `visibilitychange`（切回前台发一次 Ping）、`online`（网络恢复立即重连）；`disconnect` 时解绑 |

---

## 二、连接状态

内部维护 `ConnectionState`：

- **DISCONNECTED**：未连接
- **CONNECTING**：首次连接或重连中（正在建连）
- **CONNECTED**：已连接，可收发
- **RECONNECTING**：已断线，等待下一次重连定时器触发

`getState()` 返回当前状态；`connect()` 在已是 CONNECTED/CONNECTING 时直接返回，避免重复建连。

---

## 三、认证与 URL

- **Token**：不放在 URL 上，通过 `new WebSocket(url, ["im-auth", token])` 作为子协议传递，避免泄露与日志污染。
- **URL 参数**：仅带业务相关 query：
  - `fresh=1`：新建会话（不恢复历史）
  - `format=json` 或 `format=protobuf`：序列化格式（非 json 时带上）

---

## 四、连接建立与关闭

### connect()

1. 若已是 CONNECTED 或 CONNECTING，直接 return。
2. 设为 CONNECTING，`getWsUrl()` 得到 URL，用 `["im-auth", token]` 创建 WebSocket，`binaryType = "arraybuffer"`。
3. 绑定：
   - **onopen**：CONNECTED、重连次数清零、派发 `CONNECTED`、`startHeartbeat()`、`bindPageLifecycle()`。
   - **onmessage**：根据 data 类型（string / Blob / ArrayBuffer）转成统一格式后 `handleMessage()`（见下文）。
   - **onclose**：`handleDisconnect()`（停心跳、清 Pong 超时、未达重连上限则 `scheduleReconnect()`，否则派发 `DISCONNECTED`）。
   - **onerror**：打日志并派发 `CONNECTION_ERROR`，不断开；断开由 onclose 统一处理。

### disconnect()

停止心跳、清除 Pong 超时、取消重连定时器、`unbindPageLifecycle()`、清空分片状态，然后 `ws.close()` 并置 null，最后置 DISCONNECTED 并派发 `DISCONNECTED`。

---

## 五、发送与接收

### send(type, payload)

- 要求当前为 CONNECTED 且有 `ws`，否则抛 `"Not connected"`。
- 构造 `Frame`（含 `seq` 自增、`timestamp`），按 `format`（json/protobuf）编码：
  - **JSON**：不分片，直接 `ws.send(encoded)`。
  - **Protobuf 且体积 > CHUNK_SIZE**：先发分片元数据（`createFragMeta`），再依次发各 chunk。
- 返回构造好的 `Frame`。

### handleMessage(data)

- **string**：`JSON.parse` 后若为分片元数据（`isFragMeta`），则初始化 `fragmentState` 并 return；否则 `decodeFrame` → `handleFrame`。
- **ArrayBuffer**：空则 return；若存在 `fragmentState` 则当作一个 chunk 追加，收齐后 `reassembleChunks` → `decodeFrame` → `handleFrame` 并清空 `fragmentState`；否则直接 `decodeFrame` → `handleFrame`。

### handleFrame(frame)

按 `frame.type` 派发不同事件，供 IMClient 订阅，例如：

- `auth_ok`、`frame_in`、`message_ack`
- `typing_start` / `typing_stop`
- `HEARTBEAT_PONG` → 只做 `clearPongTimeout()`
- `queue_update`、`agent_assigned`、`phase_change`、`sync_response`、`session_switched`、`history_response`
- `presence_update`、`read_receipt`、`reaction_update`、`message_edit`、`message_recall`、`kicked`
- `server_error`

---

## 六、心跳与「等 Pong」超时

- **startHeartbeat()**：连接成功后调用，按 `heartbeatInterval`（默认 30s）周期发送 `HEARTBEAT_PING`，每次发完后调用 `schedulePongTimeout()`。
- **schedulePongTimeout()**：设置一个 `heartbeatPongTimeoutMs`（默认 10s）的定时器；若在此时限内收到 `HEARTBEAT_PONG`，则 `clearPongTimeout()` 取消该定时器；若超时仍未收到 Pong，则主动 `ws.close()`，从而触发 onclose → handleDisconnect → 重连。
- **作用**：检测「半开连接」——网络已断但本地未感知时，通过「发 Ping 等 Pong」超时来发现并主动断开、触发重连。

---

## 七、断线重连

- **handleDisconnect()**：在 onclose 时调用；先停心跳、清 Pong 超时、置 DISCONNECTED；若 `reconnectCount < reconnectAttempts` 则 `scheduleReconnect()`，否则派发 `DISCONNECTED` 并打日志，不再重连。
- **scheduleReconnect()**：置 RECONNECTING、派发 `RECONNECTING`、`reconnectCount++`，延迟  
  `min(reconnectInterval * 2^reconnectCount + [0, 1000) 随机, 30000)` ms 后再次 `connect()`，即指数退避 + 抖动，最大间隔 30s。
- **online 事件**：浏览器下 `window.online` 时，若当前为 RECONNECTING 或 DISCONNECTED，则清除重连定时器、将 `reconnectCount` 置 0 并立即 `connect()`，不等待退避。

---

## 八、分片（Protobuf 大帧）

- **发送**：当 `format !== "json"` 且编码后体积 > `CHUNK_SIZE` 时，`splitIntoChunks` 拆成多段，先发 `createFragMeta(messageId, totalChunks, format)`（JSON 字符串），再依次发二进制 chunk。
- **接收**：先收到分片元数据则创建 `fragmentState`，之后收到的二进制按序 push 到 `chunks`，当 `chunks.length >= totalChunks` 时 `reassembleChunks` 得到完整缓冲，再 `decodeFrame` 并 `handleFrame`，最后清空 `fragmentState`。

---

## 九、页面生命周期（仅浏览器）

- **bindPageLifecycle()**：在 onopen 后调用；若尚未绑定则：
  - `document.addEventListener("visibilitychange", _onVisibilityChange)`：页面从隐藏切回可见时，若已连接则立即发一次 `HEARTBEAT_PING` 并 `schedulePongTimeout()`，用于快速发现切后台期间断开的连接。
  - `window.addEventListener("online", _onNetworkOnline)`：网络恢复时若处于 RECONNECTING/DISCONNECTED 则立即重连（见上）。
- **unbindPageLifecycle()**：在 `disconnect()` 时移除上述监听。

---

## 十、默认配置

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| reconnectAttempts | 5 | 最大重连次数 |
| reconnectInterval | 1000 | 重连间隔基数（ms），实际为指数退避 |
| heartbeatInterval | 30000 | 心跳 Ping 间隔（ms） |
| heartbeatPongTimeoutMs | 10000 | 发 Ping 后等待 Pong 的超时（ms），超时则 close 触发重连 |

---

## 十一、相关文件

- **实现**：`src/sdk/WebSocketManager.ts`
- **类型与帧类型**：`src/sdk/types.ts`（ConnectionConfig、ConnectionState、Frame、FrameType、SDKEvent）
- **编解码与分片**：`src/sdk/serializer.ts`（encodeFrame、decodeFrame、splitIntoChunks、reassembleChunks、createFragMeta、isFragMeta、CHUNK_SIZE）
- **事件基类**：`src/sdk/EventEmitter.ts`
- **使用方**：`IMClient` 创建 WebSocketManager、调用 connect/disconnect、send，并订阅其派发的事件（如 `frame_in`、`message_ack`、`auth_ok` 等）以更新会话与消息状态。
