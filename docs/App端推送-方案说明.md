# App 端推送 - 方案说明

本文说明 IM 场景下 **App 端推送** 的实现思路，包括 Web（PWA/Service Worker）与原生（FCM/APNs/HMS）两条线，以及与服务端在线状态、免打扰、角标的配合。**当前项目未实现推送**，本文为方案级文档，便于后续落地或面试梳理。

---

## 目录

- [一、概述](#一概述)
- [二、Web 端推送（Web Push）](#二web-端推送web-push)
- [三、原生 App 推送（FCM / APNs / HMS）](#三原生-app-推送fcm--apns--hms)
- [四、与在线、免打扰、角标的配合](#四与在线免打扰角标的配合)
- [五、推送收敛与去重](#五推送收敛与去重)
- [六、本项目现状与 Web 端落地清单](#六本项目现状与-web-端落地清单)
- [七、面试可答要点](#七面试可答要点)
- [八、相关文档](#八相关文档)

---

## 一、概述

| 端 | 通道 | 典型能力 |
|----|------|----------|
| **Web / PWA** | Web Push API + Service Worker | 浏览器/桌面通知，需 HTTPS，支持 Chrome / Firefox / Edge 等 |
| **Android** | FCM / 厂商通道（HMS 等） | 系统通知栏、角标、静音、点击跳转 |
| **iOS** | APNs | 同上，需 Apple 证书与设备 token |

**共性**：服务端不直接连设备，而是把「推送给谁、推什么」交给**推送网关**；客户端需先**注册并上报 token**，服务端按 token 调用对应 API 发推送。

---

## 二、Web 端推送（Web Push）

### 2.1 数据流概览

```
[ 前端 ]                     [ 业务后端 ]                  [ 推送网关 / SW ]
   |                               |                                |
   | 1. 请求通知权限                 |                                |
   | 2. PushManager.subscribe()      |                                |
   | 3. POST /api/push/subscribe    |                                |
   | ------------------------------>| 4. 存 userId → PushSubscription  |
   |                                |                                |
   |     (用户离线，新消息到达)        |                                |
   |                                | 5. 查在线 → 离线则入推送队列      |
   |                                | 6. web-push.send(subscription,   |
   |                                |     payload)                     |
   |                                | ------------------------------->| 7. 推送到浏览器
   |                                |                                 | 8. SW push 事件
   |<---------------------------------------------------------------| 9. showNotification()
```

### 2.2 前端要点

| 步骤 | 说明 |
|------|------|
| **权限** | `Notification.requestPermission()`，用户同意后才能订阅 |
| **订阅** | `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`，`applicationServerKey` 为 VAPID 公钥 |
| **VAPID** | 公钥给前端订阅用，私钥后端保管，用于对 Web Push 请求签名 |
| **SW** | 独立 `sw.js`，`push` 事件里解析 payload、`showNotification()` 展示；`notificationclick` 里打开页面/聚焦会话 |

### 2.3 后端要点

- **存储**：PushSubscription（或 endpoint + auth + p256dh）与 **userId**（及可选 deviceId）关联。
- **发送**：用 VAPID 私钥 + subscription + payload 调 Web Push 协议（如 `web-push` 库）。
- **Payload**：建议轻量，如 `{ conversationId, messageId, title, body }`，点击后再拉详情。

### 2.4 与「在线」的关系

- 若该用户当前有 **WebSocket 长连接在线**且消息已通过长连下发，则**不再发 Web Push**（或仅静默角标）。
- 实现：消息投递时先查在线；在线走长连；离线则入「待推送队列」，由推送服务消费并发 Web Push。

---

## 三、原生 App 推送（FCM / APNs / HMS）

### 3.1 流程概览

1. **客户端**：获取 device token（FCM Token / APNs deviceToken / HMS Push Token）。
2. **客户端**：登录后把 **token + 平台(ios/android) + 可选 deviceId** 上报业务后端；后端存「用户-设备」表。
3. **后端**：新消息时查接收方是否在线；**离线**则按 token 调 FCM/APNs/HMS 的 HTTP API 下发。
4. **客户端**：收到系统推送；点击打开 App 并跳转到对应会话。

### 3.2 平台要点

| 平台 | Token 获取 | 后端发送方式 |
|------|------------|--------------|
| **FCM** | Firebase SDK `getToken()` | HTTP v1 API，OAuth2 或服务账号 |
| **APNs** | `didRegisterForRemoteNotifications` 回调 | HTTP/2 API，.p8/.p12 证书 |
| **HMS** | 华为 Push SDK | 华为开放平台 HTTP 接口 |

### 3.3 Payload 与静音

- **data**：可带 `conversationId`、`messageId`、`title`、`body`、`badge` 等。
- **静音**：免打扰会话可发静音推送（FCM/APNs 的 silent/content-available），仅更新角标或后台拉取。

---

## 四、与在线、免打扰、角标的配合

### 4.1 与在线互斥

| 原则 | 实现 |
|------|------|
| 同一条消息已通过长连下发则不再发离线推送 | 消息落库后先经长连投递；仅对「未投递成功」或「无在线连接」的设备入推送队列 |

### 4.2 免打扰

| 策略 | 行为 |
|------|------|
| A | 该会话免打扰 → 不发推送 |
| B | 免打扰 → 发**静音推送**（不响铃不振动，仅角标/后台同步） |

静音由 FCM/APNs/HMS 的 silent 或 content-available 类参数实现，详见 `消息免打扰-服务端方案.md`。

### 4.3 角标

- 未读数按会话汇总；产品可约定**免打扰会话是否计入角标**。
- 角标数由服务端统一计算，推送 payload 中带 `badge`，客户端直接设角标，保证多端一致。

---

## 五、推送收敛与去重

| 手段 | 说明 |
|------|------|
| **收敛** | 同一会话短时多条未读合并为一条通知，如「张三发来 3 条消息」；按时窗或条数阈值合并后再发 |
| **去重** | 推送前查该设备该会话 **lastReadSeq**；已读则不推或只推角标更新，避免「已读还推」 |

---

## 六、本项目现状与 Web 端落地清单

### 6.1 当前状态

| 能力 | 状态 |
|------|------|
| Web Push（SW、VAPID、订阅上报） | 未实现 |
| 原生 FCM/APNs/HMS | 未实现（本项目以 Web 为主） |
| 服务端推送网关、用户-设备 token 存储 | 未实现 |
| 与在线互斥、免打扰、角标 | 见「消息免打扰-服务端方案」「IM高级功能」文档 |

### 6.2 Web 端落地步骤（Next.js 示例）

**1. 生成 VAPID 并暴露公钥**

- 使用 `web-push` 等库生成密钥对，私钥放环境变量，公钥可供前端订阅使用。
- 可选：增加接口 `GET /api/push/vapid-public-key` 返回公钥（或构建时注入前端配置）。

**2. 注册 Service Worker**

- 在 `public/sw.js` 实现 `push`、`notificationclick`：

```js
// public/sw.js 示例结构
self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  const { title, body, conversationId, messageId } = data;
  e.waitUntil(
    self.registration.showNotification(title || '新消息', {
      body: body || '',
      data: { conversationId, messageId },
      tag: conversationId,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { conversationId } = e.notification.data || {};
  const url = conversationId ? `/#/chat?conv=${conversationId}` : '/';
  e.waitUntil(clients.openWindow(url));
});
```

**3. 前端：请求权限、订阅、上报**

- 在用户登录后（如 chatStore 的 `auth` 就绪后）：
  - `Notification.requestPermission()`
  - `navigator.serviceWorker.ready` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey })`
  - 将 `subscription.toJSON()` 发到后端，例如 `POST /api/push/subscribe`，body 含 `userId`（或由鉴权中间件取）、`subscription`。

**4. 后端：订阅存储与发送**

- **存储**：`POST /api/push/subscribe` 接收 `{ subscription }`，与当前 userId 关联写入 DB 或 Redis（如 `user_push_subscriptions` 表：userId, endpoint, auth, p256dh, createdAt）。
- **发送**：在现有消息投递逻辑中，若判断该用户离线（无 WebSocket 连接），则将推送任务入队；消费者用 `web-push` 的 `sendNotification(subscription, payload, options)` 发送，options 中带 VAPID 私钥。
- **Payload**：`JSON.stringify({ title, body, conversationId, messageId })`，与在线、免打扰逻辑结合：在线不发，免打扰则静音或不发。

**5. 接入在线与免打扰**

- 消息落库后，先走现有 WebSocket 投递；仅对「无在线连接」的用户查 push subscription，入推送队列。
- 推送前查该用户对该会话是否免打扰；若免打扰则不发或发静音（Web Push 的 silent 依浏览器支持情况可做兼容）。

---

## 七、面试可答要点

| 问题 | 要点 |
|------|------|
| **推送怎么发？** | 客户端注册并上报 token（Web 为 PushSubscription，原生为 FCM/APNs token）；服务端按 token 调推送网关 API；不直接连设备。 |
| **怎么避免已读还推？** | 推送前查该设备该会话 lastReadSeq，已读则不推或只推角标；与在线互斥：长连已下发则不再发离线 push。 |
| **免打扰怎么体现？** | 服务端根据会话免打扰配置决定是否发推送、是否静音；静音由各通道的 silent/content-available 实现。 |
| **送达率怎么保障？** | 选稳定通道；token 失效让客户端重新上报；失败重试；多厂商冗余（如国内 HMS + FCM 降级）。 |

---

## 八、相关文档

| 文档 | 内容 |
|------|------|
| `消息免打扰-服务端方案.md` | 免打扰与推送/静音/角标的服务端逻辑 |
| `IM高级功能-技术原理与面试要点.md` | 第 8 节「推送体系」：离线推送、收敛、与在线互斥 |
