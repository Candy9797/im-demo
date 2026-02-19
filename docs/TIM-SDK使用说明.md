# TIM-SDK 使用说明

本项目的 `src/sdk/TIM.ts` 提供了类似腾讯云 IM (TIM-JS-SDK) 的 API，基于现有 IMClient 实现，可直接接入现有后端。

---

## 一、快速开始

```typescript
import { TIM } from '@/sdk';

// 1. 创建实例
const tim = TIM.create({ sdkAppId: 0 });

// 2. 登录（userSig 即 token）
await tim.login({
  userId: 'user-001',
  userSig: 'your-jwt-token',
  fresh: false,  // true 表示新建会话，不拉历史
});

// 3. 获取会话列表
const { data } = await tim.getConversationList();
console.log(data.conversationList);

// 4. 发送消息
const textMsg = tim.createTextMessage({ text: 'Hello!' });
const res = await tim.sendMessage(textMsg);
console.log(res.data.message);

// 5. 监听事件
tim.on(TIM.EVENT.MESSAGE_RECEIVED, (msg) => {
  console.log('新消息:', msg);
});

// 6. 登出
tim.logout();
```

---

## 二、API 一览

### 2.1 生命周期

| 方法 | 说明 |
|------|------|
| `TIM.create(options?)` | 创建实例 |
| `tim.login({ userId, userSig, fresh? })` | 登录 |
| `tim.logout()` | 登出 |

### 2.2 会话与消息

| 方法 | 说明 |
|------|------|
| `tim.getConversationList()` | 获取会话列表 |
| `tim.getMessageList({ conversationID, count, nextReqMessageID? })` | 获取消息列表（分页） |
| `tim.sendMessage(message)` | 发送消息 |
| `tim.createTextMessage({ text })` | 创建文本消息 |
| `tim.createImageMessage({ file })` | 创建图片消息 |
| `tim.createCustomMessage(payload)` | 创建自定义消息 |

### 2.3 进阶能力

| 方法 | 说明 |
|------|------|
| `tim.loadHistory(beforeSeqId)` | 加载更早历史 |
| `tim.markAsRead(messageIds)` | 标记已读 |
| `tim.addReaction(messageId, emoji)` | 添加反应 |
| `tim.removeReaction(messageId, emoji)` | 移除反应 |
| `tim.requestHumanAgent()` | 转人工 |
| `tim.searchMessages(query)` | 搜索消息 |

### 2.4 事件

| 事件 | 说明 |
|------|------|
| `TIM.EVENT.CONNECTED` | 已连接 |
| `TIM.EVENT.DISCONNECTED` | 已断开 |
| `TIM.EVENT.RECONNECTING` | 重连中 |
| `TIM.EVENT.MESSAGE_RECEIVED` | 收到新消息 |
| `TIM.EVENT.MESSAGE_SENT` | 消息已发送 |
| `TIM.EVENT.CONVERSATION_LIST_UPDATED` | 会话列表更新 |
| `TIM.EVENT.KICKED` | 被踢下线 |

```typescript
tim.on(TIM.EVENT.MESSAGE_RECEIVED, (msg) => { /* ... */ });
tim.off(TIM.EVENT.MESSAGE_RECEIVED, handler);
```

### 2.5 底层 IMClient

需要访问 Bot/Agent、FAQ、Queue 等业务能力时，可使用底层 IMClient：

```typescript
const client = tim.getIMClient();
if (client) {
  client.getConversation();
  client.getFAQItems();
  client.selectFAQ('faq-1');
}
```

---

## 三、与 chatStore 的配合

当前 `chatStore` 仍使用 `createIMClient`。若希望用 TIM 替代，可：

1. 在 `initialize` 中改为 `TIM.create().login({ userId, userSig })`
2. 用 `tim.getIMClient()` 获取 IMClient，保持现有事件订阅逻辑
3. 或用 `tim.on(TIM.EVENT.XXX)` 替代 `client.on(SDKEvent.XXX)`

两者可并存：TIM 作为对外 API，IMClient 作为内部实现。
