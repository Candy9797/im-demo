# 消息引用（Quote）功能 - 技术方案

## 一、功能概述

**消息引用**：用户回复某条消息时，可以在新消息中附带被引用消息的预览，形成「引用回复」的对话结构，便于上下文理解。

### 1.1 用户体验流程

1. 用户长按/右键/点击消息气泡上的「引用」按钮
2. 输入框上方出现被引用消息的预览卡片
3. 用户输入回复内容后发送
4. 新消息在气泡内展示「引用块 + 回复内容」的结构
5. （可选）点击引用块可滚动定位到原消息

---

## 二、数据模型

### 2.1 MessageMetadata 扩展

在 `MessageMetadata` 中新增 `quote` 字段：

```typescript
// src/sdk/types.ts

export interface QuoteInfo {
  /** 被引用消息的 ID（客户端或服务端 ID） */
  messageId: string;
  /** 被引用消息的发送者名称 */
  senderName: string;
  /** 被引用消息的内容摘要（最多 200 字符，用于预览） */
  content: string;
  /** 被引用消息的类型 */
  type: MessageType;
  /** 被引用消息的时间戳 */
  timestamp: number;
}

export interface MessageMetadata {
  reactions?: Record<string, string[]>;
  mentions?: string[];
  readBy?: string[];
  /** 引用信息：当本消息为引用回复时存在 */
  quote?: QuoteInfo;
  [key: string]: unknown;
}
```

### 2.2 存储

- 复用现有 `messages.metadata` (JSON) 字段，无需改表结构
- `quote` 作为 metadata 的一个 key 存入
- 服务端持久化时直接 `JSON.stringify(metadata)` 写入

---

## 三、协议设计

### 3.1 发送消息（已有 SEND_MESSAGE）

客户端在发送时，payload 中携带 `metadata.quote` 即可，无需新帧类型：

```json
{
  "type": "send_message",
  "payload": {
    "id": "client-msg-xxx",
    "content": "这是回复内容",
    "type": "text",
    "metadata": {
      "quote": {
        "messageId": "msg-xxx",
        "senderName": "Smart Assistant",
        "content": "To deposit crypto, go to Wallet...",
        "type": "text",
        "timestamp": 1739260800000
      }
    }
  }
}
```

### 3.2 服务端处理

- 接收 `SEND_MESSAGE` 时，将 `msg.metadata` 原样写入 DB
- 下发 MESSAGE / MESSAGE_ACK 时，metadata 含 quote 一并返回
- 无需新增接口

---

## 四、前端实现

### 4.1 状态与 Store

在 `chatStore` 中新增：

```typescript
// 当前待发送的引用
quoteTarget: Message | null;

// 设置引用目标
setQuoteTarget: (msg: Message | null) => void;

// 发送时：若有 quoteTarget，将其转为 QuoteInfo 放入 metadata，发送后清空
```

### 4.2 组件设计

| 组件 | 职责 |
|------|------|
| **MessageItem** | 增加「引用」入口（长按菜单或悬浮图标），点击后调用 `setQuoteTarget(message)` |
| **QuotePreview** | 输入框上方展示被引用消息预览，可取消 |
| **InputArea** | 集成 QuotePreview；发送时读取 quoteTarget 构造 metadata |
| **MessageQuoteBlock** | 在 MessageItem 内渲染引用块（发送者 + 内容摘要） |

### 4.3 UI 交互细节

**引用入口（MessageItem）**：
- 用户消息、机器人、客服消息均可被引用
- 系统消息一般不提供引用
- 入口形式：消息 hover 时显示「引用」图标，或长按弹出菜单

**QuotePreview（输入框上方）**：
- 显示：头像/图标 + 发送者名称 + 内容摘要（单行截断）
- 提供「取消」按钮，调用 `setQuoteTarget(null)`
- 与 EmojiPicker、StickerPicker 共存时，采用优先级或分区展示

**MessageQuoteBlock（消息气泡内）**：
- 引用块在上，回复内容在下
- 引用块样式：左侧竖线 + 发送者 + 内容预览，可点击滚动到原消息
- 内容过长时省略显示（如最多 2 行）

---

## 五、实现清单

### 5.1 类型与 SDK

- [ ] `src/sdk/types.ts`：定义 `QuoteInfo`，扩展 `MessageMetadata.quote`
- [ ] `IMClient.sendMessage`：支持传入 `metadata`，内部合并 quote

### 5.2 Store

- [ ] `chatStore`：`quoteTarget`、`setQuoteTarget`
- [ ] `sendMessage`：若 `quoteTarget` 存在，构建 `metadata.quote` 并传入
- [ ] 发送成功后调用 `setQuoteTarget(null)`

### 5.3 组件

- [ ] `QuotePreview`：新建，展示 + 取消
- [ ] `MessageQuoteBlock`：新建，在消息气泡内渲染引用
- [ ] `MessageItem`：添加引用入口，渲染 `MessageQuoteBlock`
- [ ] `InputArea`：挂载 QuotePreview，发送逻辑中读取 quoteTarget

### 5.4 样式

- [ ] `.quote-preview`：输入框上方引用预览卡片
- [ ] `.message-quote-block`：消息内引用块样式
- [ ] 引用入口按钮样式

### 5.5 服务端

- [ ] 确认 `ws-handler` 中 `metadata` 透传无误（已支持，无需改）
- [ ] 如有需要，校验 `quote.messageId` 属于当前会话（可选）

---

## 六、可选增强

1. **点击引用定位**：`MessageList` 暴露 `scrollToMessage(id)`，引用块点击时调用
2. **引用链**：若被引用消息本身也有 quote，可选择展示多层或只展示一层
3. **通知**：被引用时给原消息发送者推送（需通知体系支持）

---

## 七、兼容性

- 旧消息无 `metadata.quote`，`MessageQuoteBlock` 不渲染
- 旧客户端忽略 `metadata.quote`，不影响展示
- 无需数据迁移
