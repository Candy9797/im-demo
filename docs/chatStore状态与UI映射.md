# chatStore 状态与 UI 映射

> 完整列出 chatStore 全部状态，对应 UI 组件，以及数据流说明。

---

## 一、组件层级

```
page.tsx (首页)
├── LandingHero          # 落地页，入口按钮
└── ChatWidget           # IM 入口
    ├── ChatTrigger      # 悬浮按钮（未打开时）
    ├── ChatWindow       # 聊天主窗口（打开时）
    │   ├── Header       # 标题、连接态、最小化/关闭
    │   │   ├── PresenceIndicator  # 在线人数
    │   │   └── SearchBar          # 搜索弹层
    │   ├── QueueBanner  # 转人工排队提示
    │   ├── chat-body
    │   │   ├── MessageList        # 消息列表 + 虚拟滚动
    │   │   │   ├── MessageItem    # 单条消息（含 MessageReactions）
    │   │   │   └── TypingIndicator # 输入中
    │   │   └── SmartAssistant     # Bot 阶段 FAQ 快捷按钮
    │   └── InputArea    # 输入框
    │       └── QuotePreview       # 引用回复预览
    └── WalletConnect    # 钱包连接弹窗（showWalletModal 时）
```

---

## 二、全部状态与 UI 映射

### 2.1 认证

| 状态 | 类型 | 说明 | 对应 UI | 更新来源 |
|------|------|------|---------|----------|
| **client** | IMClient \| null | SDK 实例，业务逻辑不直接给组件 | 内部用，不渲染 | initialize、destroy |
| **auth** | AuthState \| null | token、userId、address | LandingHero（决定显示入口按钮逻辑）、ChatTrigger（是否需登录）、ChatWindow（countUnread）、PresenceIndicator（排除自己）、MessageReactions（判断是否已反应） | connectWallet、connectAsGuest |
| **authError** | string \| null | 登录失败或 KICKED 错误信息 | LandingHero（红色错误提示） | connectWallet 失败、connectAsGuest 失败、initialize 未登录、KICKED |

---

### 2.2 连接

| 状态 | 类型 | 说明 | 对应 UI | 更新来源 |
|------|------|------|---------|----------|
| **connectionState** | ConnectionState | connected / reconnecting / disconnected | Header（连接状态圆点颜色）、InputArea（发送按钮 disabled） | CONNECTED、DISCONNECTED、RECONNECTING、KICKED、destroy |

---

### 2.3 会话（核心）

| 状态 | 类型 | 说明 | 对应 UI | 更新来源 |
|------|------|------|---------|----------|
| **phase** | ConversationPhase | BOT \| QUEUING \| AGENT \| CLOSED | Header（标题/副标题/头像）、QueueBanner（是否展示）、SmartAssistant（是否展示）、PresenceIndicator（BOT/AGENT 时展示） | PHASE_CHANGED |
| **agentInfo** | AgentInfo \| null | 转人工后 Agent 信息 | Header（标题显示 Agent 名称/工号） | AGENT_ASSIGNED |
| **queue** | QueueState \| null | position、total、estimatedWait | QueueBanner（排队位置、预计等待） | QUEUE_UPDATE、AGENT_ASSIGNED 时清空 |
| **messages** | Message[] | 当前会话消息列表 | MessageList（渲染）、ChatWindow/ChatTrigger（countUnread 未读数） | MESSAGE_SENT/RECEIVED/BATCH、MESSAGES_RESET、HISTORY_LOADED、addReaction、removeReaction、editMessage、recallMessage、READ_RECEIPT、REACTION_UPDATE |
| **faqItems** | FAQItem[] | Bot 阶段 FAQ 配置 | SmartAssistant（FAQ 按钮列表） | initialize 时从 client 拉取 |

---

### 2.4 会话辅助

| 状态 | 类型 | 说明 | 对应 UI | 更新来源 |
|------|------|------|---------|----------|
| **typing** | TypingState | isTyping、senderType | TypingIndicator（显示「Smart Assistant / Agent 正在输入」） | TYPING_START、TYPING_STOP |
| **hasMoreHistory** | boolean | 是否还有更早历史 | MessageList（是否显示加载更多、atTopStateChange 触发 loadMoreHistory） | HISTORY_LOADED、destroy |
| **loadingHistory** | boolean | 历史加载中 | MessageList（加载态，如顶部 spinner） | loadMoreHistory、HISTORY_LOADED、1.5s 兜底 |
| **onlineUsers** | string[] | 在线 userId 列表 | PresenceIndicator（展示除自己外的在线人数） | PRESENCE_UPDATE |

---

### 2.5 UI 控制

| 状态 | 类型 | 说明 | 对应 UI | 更新来源 |
|------|------|------|---------|----------|
| **isMinimized** | boolean | 是否最小化 | ChatWindow（minimized 时只显示一条栏） | toggleMinimize |
| **isOpen** | boolean | 聊天窗口是否打开 | ChatWindow（显示/隐藏）、ChatTrigger（打开时隐藏）、LandingHero（入口逻辑） | toggleOpen、initialize、destroy |
| **showWalletModal** | boolean | 钱包连接弹窗是否显示 | ChatWidget（渲染 WalletConnect） | setShowWalletModal |
| **wantFreshStart** | boolean | 新建会话不拉历史 | 内部用，LandingHero 点「新对话」时设置 | setWantFreshStart、initialize 消费 |
| **searchResults** | Message[] \| null | 搜索命中消息 | SearchBar（搜索结果列表） | searchMessages、clearSearch |
| **quoteTarget** | Message \| null | 引用回复目标 | QuotePreview（展示被引用内容）、InputArea（发送时带入 metadata.quote） | setQuoteTarget、replyToMessage、sendMessage 发送后清空 |
| **scrollToInputRequest** | number | 时间戳信号，请求滚动并聚焦 | MessageList（scrollToIndex）、InputArea（focus） | replyToMessage、destroy 清空 |

---

## 三、Actions 与 UI 调用

| Action | 调用者 UI | 作用 |
|--------|-----------|------|
| connectWallet | WalletConnect | 钱包签名登录 |
| connectAsGuest | LandingHero、ChatTrigger | 访客登录 |
| initialize | ChatWidget（WalletConnect onSuccess）、ChatWindow（isOpen 时 useEffect） | 创建 IMClient、连接 WS、同步初始状态 |
| destroy | LandingHero（新对话） | 断开连接、清空状态 |
| sendMessage | InputArea | 发送文本 |
| sendFile | InputArea | 上传文件 |
| sendSticker | InputArea | 发送贴纸 |
| selectFAQ | SmartAssistant | 点击 FAQ 快捷问题 |
| requestAgent | SmartAssistant（转人工入口） | 转人工 |
| toggleMinimize | Header、ChatWindow（minimized 栏点击） | 最小化/展开 |
| toggleOpen | Header、ChatTrigger | 打开/关闭窗口 |
| loadMoreHistory | MessageList（滚动到顶部） | 拉取更早历史 |
| markAsRead | MessageItem（onVisible） | 消息可见时标记已读 |
| addReaction | MessageReactions | 添加反应 |
| removeReaction | MessageReactions | 移除反应 |
| searchMessages | SearchBar | 搜索消息 |
| clearSearch | SearchBar | 清空搜索 |
| editMessage | MessageItem | 编辑消息 |
| recallMessage | MessageItem | 撤回消息 |
| replyToMessage | MessageItem | 点击回复 |
| setQuoteTarget | QuotePreview（取消） | 清空引用 |
| setShowWalletModal | ChatWidget、LandingHero（连接钱包入口） | 开关钱包弹窗 |
| setWantFreshStart | LandingHero | 新对话标记 |

---

## 四、SDKEvent → Store 更新 → UI 链路

```
IMClient.emit(SDKEvent.xxx)
    → chatStore 的 client.on(...) 回调
    → set({ ... }) 或 set(state => { ... })
    → 订阅该 state 的组件 useChatStore(useShallow(...)) 检测到变化
    → 组件重渲染
```

| SDKEvent | 更新状态 | 受影响 UI |
|----------|----------|-----------|
| CONNECTED | connectionState | Header、InputArea |
| DISCONNECTED | connectionState | Header、InputArea |
| RECONNECTING | connectionState | Header、InputArea |
| MESSAGE_SENT | messages | MessageList、ChatTrigger |
| MESSAGE_RECEIVED | messages | MessageList、ChatTrigger |
| MESSAGE_BATCH_RECEIVED | messages | MessageList、ChatTrigger |
| MESSAGE_STATUS_UPDATE | messages（单条 status） | MessageList |
| MESSAGES_RESET | messages | MessageList |
| PHASE_CHANGED | phase | Header、QueueBanner、SmartAssistant、PresenceIndicator |
| AGENT_ASSIGNED | agentInfo、queue | Header、QueueBanner |
| QUEUE_UPDATE | queue | QueueBanner |
| TYPING_START | typing | TypingIndicator |
| TYPING_STOP | typing | TypingIndicator |
| HISTORY_LOADED | messages、hasMoreHistory、loadingHistory | MessageList |
| PRESENCE_UPDATE | onlineUsers | PresenceIndicator |
| READ_RECEIPT | messages（单条 status、metadata.readBy） | MessageList |
| REACTION_UPDATE | messages（单条 metadata.reactions） | MessageList、MessageReactions |
| KICKED | authError、connectionState | LandingHero、Header、InputArea |

---

## 五、未直接订阅但间接使用的状态

- **client**：仅在 Store 内部 get().client 调用，用于 sendMessage、loadHistory、addReaction 等
- **wantFreshStart**：LandingHero 设置，initialize 读取后消费并清空
