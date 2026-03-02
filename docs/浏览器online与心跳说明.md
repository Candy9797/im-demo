# 浏览器 online 事件监听与心跳说明

## 一、如何监听浏览器 online 事件

浏览器提供了 **`window` 的 `online` / `offline` 事件**，用于感知网络从「断开」变为「可用」。

### 1.1 基本写法

```js
// 网络恢复（从离线变为在线）时触发
window.addEventListener('online', () => {
  console.log('网络已恢复');
  // 例如：重连 WebSocket、刷新列表等
});

// 网络断开时触发（可选）
window.addEventListener('offline', () => {
  console.log('网络已断开');
});

// 组件卸载时记得移除
const handler = () => { /* ... */ };
window.addEventListener('online', handler);
// cleanup:
window.removeEventListener('online', handler);
```

### 1.2 在 React 里用 useEffect 监听

```tsx
useEffect(() => {
  const handleOnline = () => {
    // 网络恢复后的逻辑，例如重连、提示等
  };
  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
}, []);
```

---

## 二、本项目里 online 是怎么用的

**位置**：`src/sdk/WebSocketManager.ts`，在 **WebSocket 连接成功（onopen）** 后调用 `bindPageLifecycle()`，其中会绑定 `online` 事件。

### 2.1 绑定时机

- `connect()` 内创建 WebSocket，在 **`ws.onopen`** 回调里依次调用：
  - `startHeartbeat()`：启动心跳
  - **`bindPageLifecycle()`**：绑定页面生命周期（含 online）

### 2.2 bindPageLifecycle 做了什么

```ts
private bindPageLifecycle(): void {
  if (typeof window === "undefined") return;
  // ...
  if (!this.onlineBound) {
    this.onlineBound = true;
    window.addEventListener("online", this._onNetworkOnline);
  }
}
```

- 仅浏览器环境、且只绑定一次（`onlineBound` 防重复）。
- 使用类方法 **`_onNetworkOnline`** 作为监听函数，便于在 `disconnect()` 里用 `unbindPageLifecycle()` 移除监听。

### 2.3 _onNetworkOnline 的逻辑

```ts
private _onNetworkOnline = (): void => {
  // 仅在「正在重连」或「已断开」时处理，避免已连接时重复连
  if (this.state !== ConnectionState.RECONNECTING && this.state !== ConnectionState.DISCONNECTED) return;
  this.clearReconnectTimer();  // 清掉当前等待中的重连定时器
  this.reconnectCount = 0;     // 重置重连次数，立即重连不计入退避
  this.connect();              // 立即发起一次连接
};
```

含义：**网络恢复（online）时，若当前是断开或重连中，就取消当前重连等待、重置重连次数并立即重连**，不依赖退避间隔。

### 2.4 解绑

在 **`disconnect()`** 里会调用 **`unbindPageLifecycle()`**，里面执行：

```ts
window.removeEventListener("online", this._onNetworkOnline);
this.onlineBound = false;
```

---

## 三、本项目的心跳是怎么做的

心跳在 **WebSocketManager** 里实现，用于**保活**和**发现半开连接**（连接假死、对端已断但本端未收到 close）。

### 3.1 配置（默认值）

| 配置 | 默认值 | 含义 |
|------|--------|------|
| `heartbeatInterval` | 30000（30 秒） | 每隔多久发一次 Ping |
| `heartbeatPongTimeoutMs` | 10000（10 秒） | 发 Ping 后多久内必须收到 Pong，否则认为连接异常并关闭 |

在 `src/sdk/WebSocketManager.ts` 的 `DEFAULT_CONFIG` 和 `ConnectionConfig`（types.ts）里定义。

### 3.2 客户端：发 Ping、等 Pong

- **启动**：在 **`ws.onopen`** 里调用 **`startHeartbeat()`**。
- **startHeartbeat**：
  - 用 `setInterval(heartbeatInterval)` 定时执行：
    - 若当前状态为 CONNECTED 且有 `this.ws`，则 **发送一帧 `HEARTBEAT_PING`**（payload 如 `{ ts: Date.now() }`）；
    - 同时调用 **`schedulePongTimeout()`**，启动一个 `setTimeout(heartbeatPongTimeoutMs)`。
  - 若在超时时间内**没有**收到 **`HEARTBEAT_PONG`**，则 Pong 超时回调里会 **主动 `this.ws.close()`**，触发 onclose，进而走断线重连逻辑。
- **收到 Pong**：在消息分发里处理 `FrameType.HEARTBEAT_PONG` 时调用 **`clearPongTimeout()`**，取消本次 Pong 超时。
- **断开/清理**：在 **`disconnect()`** / 关闭连接时调用 **`stopHeartbeat()`**，清除心跳定时器和 Pong 超时定时器。

### 3.3 服务端：回 Pong

**位置**：`server/ws-handler.ts`，在 **handleFrame** 的 `switch` 里：

```ts
case FrameType.HEARTBEAT_PING:
  send(ws, FrameType.HEARTBEAT_PONG, { ts: Date.now() });
  break;
```

即：收到客户端的 Ping 后，立刻回一帧 **HEARTBEAT_PONG**，payload 带时间戳。

### 3.4 流程小结

```
客户端（WebSocketManager）                    服务端（ws-handler）
       |                                              |
       | 每 30s 或 切回前台时 发 HEARTBEAT_PING        |
       | ------------------------------------------>  |
       |                  HEARTBEAT_PONG              |
       | <------------------------------------------  |
       | 收到 Pong → clearPongTimeout()               |
       | 若超时未收到 Pong → ws.close() → 重连        |
```

- **visibilitychange**：切回前台时也会**立即发一次 Ping** 并挂上 Pong 超时，用于快速发现「挂后台期间连接已死」的情况。
- **online**：网络恢复时不做心跳，而是直接按上面说的 **立即重连**。

---

## 四、相关文件

| 文件 | 说明 |
|------|------|
| `src/sdk/WebSocketManager.ts` | 客户端：心跳 startHeartbeat/stopHeartbeat、Pong 超时、bindPageLifecycle、online/visibility 监听与解除 |
| `src/sdk/types.ts` | ConnectionConfig 中的 heartbeatInterval、heartbeatPongTimeoutMs；FrameType.HEARTBEAT_PING / HEARTBEAT_PONG |
| `server/ws-handler.ts` | 服务端：处理 HEARTBEAT_PING，回 HEARTBEAT_PONG |
