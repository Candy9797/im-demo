/**
 * Mock data for chat session page (friends, groups, messages)
 * 模拟好友、群组、消息数据，后续可对接真实后端
 */
import type { Message } from "@/sdk";
import { MessageType, MessageStatus, SenderType } from "@/sdk";

export const CURRENT_USER_ID = "user-me";

export interface Friend {
  id: string;
  name: string;
  avatar?: string;
  online: boolean;
  lastSeen?: number;
  /** 未读数 */
  unreadCount: number;
  /** 最后一条消息预览 */
  lastMessagePreview?: string;
  lastMessageTime?: number;
}

export interface Group {
  id: string;
  name: string;
  avatar?: string;
  memberCount: number;
  /** 未读数 */
  unreadCount: number;
  lastMessagePreview?: string;
  lastMessageTime?: number;
  /** 是否有人正在输入 */
  typingUserIds: string[];
}

export const MOCK_FRIENDS: Friend[] = [
  {
    id: "user-alice",
    name: "Alice",
    online: true,
    unreadCount: 2,
    lastMessagePreview: "好的，明天见！",
    lastMessageTime: Date.now() - 300000,
  },
  {
    id: "user-bob",
    name: "Bob",
    online: false,
    lastSeen: Date.now() - 3600000,
    unreadCount: 0,
    lastMessagePreview: "Thanks for the file",
    lastMessageTime: Date.now() - 7200000,
  },
  {
    id: "user-carol",
    name: "Carol",
    online: true,
    unreadCount: 5,
    lastMessagePreview: "在吗？",
    lastMessageTime: Date.now() - 60000,
  },
  {
    id: "user-dave",
    name: "Dave",
    online: false,
    lastSeen: Date.now() - 86400000,
    unreadCount: 0,
    lastMessagePreview: "OK",
    lastMessageTime: Date.now() - 86400000,
  },
  {
    id: "user-eve",
    name: "Eve",
    online: true,
    unreadCount: 0,
    lastMessagePreview: "See you!",
    lastMessageTime: Date.now() - 1800000,
  },
];

export const MOCK_GROUPS: Group[] = [
  {
    id: "group-1",
    name: "技术交流",
    memberCount: 12,
    unreadCount: 3,
    lastMessagePreview: "Alice: 有人了解 Layer2 吗？",
    lastMessageTime: Date.now() - 120000,
    typingUserIds: ["user-alice"],
  },
  {
    id: "group-2",
    name: "项目协作",
    memberCount: 5,
    unreadCount: 0,
    lastMessagePreview: "Bob: 任务已完成",
    lastMessageTime: Date.now() - 3600000,
    typingUserIds: [],
  },
  {
    id: "group-3",
    name: "日常闲聊",
    memberCount: 28,
    unreadCount: 15,
    lastMessagePreview: "Carol: 哈哈哈",
    lastMessageTime: Date.now() - 30000,
    typingUserIds: ["user-carol", "user-eve"],
  },
];

/** 各好友的独立对话内容，避免 Bob/Carol 等对话完全一样 */
const C2C_LINES_BY_FRIEND: Record<string, [string, string][]> = {
  "user-alice": [
    ["嗨，我是 Alice", "friend"],
    ["你好！有什么可以帮你的？", "me"],
    ["想请教一些技术问题", "friend"],
    ["好的，请说", "me"],
    ["关于钱包集成，有什么推荐方案？", "friend"],
    ["可以试试 ethers.js 或 wagmi，文档比较全", "me"],
    ["wagmi 和 viem 哪个更好？", "friend"],
    ["viem 更轻量，wagmi 封装了 React hooks，看项目需求", "me"],
    ["收到，我去看看", "friend"],
    ["有疑问随时问", "me"],
    ["这个 gas 费怎么优化？", "friend"],
    ["可以用批量交易、L2、或错峰发送", "me"],
    ["明白了，谢谢！", "friend"],
    ["不客气", "me"],
    ["好的，明天见！", "me"],
    ["明天见", "friend"],
  ],
  "user-bob": [
    ["Bob: 在吗？", "friend"],
    ["在的，咋了", "me"],
    ["上次那个文件你还有吗，我电脑重装了", "friend"],
    ["有，我找一下发你", "me"],
    ["Thanks for the file", "friend"],
    ["不客气", "me"],
    ["改天请你喝咖啡", "friend"],
    ["哈哈行", "me"],
  ],
  "user-carol": [
    ["在吗？", "friend"],
    ["在的", "me"],
    ["周末一起吃饭？", "friend"],
    ["可以啊，几点", "me"],
    ["六点老地方？", "friend"],
    ["OK 不见不散", "me"],
    ["好哒", "friend"],
    ["对了，那个需求你看了吗", "me"],
    ["看了，我明天给你反馈", "friend"],
    ["好的", "me"],
  ],
  "user-dave": [
    ["Dave: 嗨", "friend"],
    ["嗨", "me"],
    ["OK", "friend"],
  ],
  "user-eve": [
    ["Eve: 会议改到下午 3 点了", "friend"],
    ["收到", "me"],
    ["See you!", "friend"],
    ["See you", "me"],
  ],
};

const SAMPLE_IMAGE_URL = "https://picsum.photos/400/300";
const SAMPLE_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

function createC2CMessages(friendId: string, friendName: string): Message[] {
  const lines = C2C_LINES_BY_FRIEND[friendId] ?? [
    ["嗨，我是 " + friendName, "friend"],
    ["你好！", "me"],
  ];
  const base = Date.now() - 86400000;
  const msgs: Message[] = lines.map(([content, from], i) => {
    const isMe = from === "me";
    return {
      id: `msg-c2c-${friendId}-${i + 1}`,
      conversationId: `c2c-${friendId}`,
      content,
      type: MessageType.TEXT,
      status: MessageStatus.READ,
      senderType: SenderType.USER,
      senderId: isMe ? CURRENT_USER_ID : friendId,
      senderName: isMe ? "Me" : friendName,
      timestamp: base + (i + 1) * 45000,
      seqId: i + 1,
    };
  });
  // 注入图片、视频、URL 消息（仅 Alice 示例）
  if (friendId === "user-alice") {
    const off = msgs.length;
    msgs.push(
      {
        id: `msg-c2c-${friendId}-img`,
        conversationId: `c2c-${friendId}`,
        content: SAMPLE_IMAGE_URL,
        type: MessageType.IMAGE,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: friendId,
        senderName: friendName,
        timestamp: base + off * 45000,
        seqId: off + 1,
      },
      {
        id: `msg-c2c-${friendId}-vid`,
        conversationId: `c2c-${friendId}`,
        content: SAMPLE_VIDEO_URL,
        type: MessageType.VIDEO,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: CURRENT_USER_ID,
        senderName: "Me",
        timestamp: base + (off + 1) * 45000,
        seqId: off + 2,
      },
      {
        id: `msg-c2c-${friendId}-url`,
        conversationId: `c2c-${friendId}`,
        content:
          "推荐看看这个文档：https://docs.ethers.org 和 https://ethereum.org",
        type: MessageType.TEXT,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: friendId,
        senderName: friendName,
        timestamp: base + (off + 2) * 45000,
        seqId: off + 3,
      },
      {
        id: `msg-c2c-${friendId}-md`,
        conversationId: `c2c-${friendId}`,
        content:
          "集成可以用 **ethers.js** 或 `wagmi`，示例：\n\n```js\nconst provider = new ethers.BrowserProvider(window.ethereum);\n```",
        type: MessageType.TEXT,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: CURRENT_USER_ID,
        senderName: "Me",
        timestamp: base + (off + 3) * 45000,
        seqId: off + 4,
      },
    );
  }
  return msgs;
}

/** 各群组的独立对话内容，避免项目协作/日常闲聊等会话完全一样 */
const GROUP_LINES_BY_GROUP: Record<string, string[]> = {
  "group-1": [
    "欢迎加入 {group}",
    "大家好！",
    "Hi all",
    "有人了解 Layer2 吗？",
    "了解一些，你问哪方面？",
    "跨链桥这块",
    "可以看看 Stargate、Across",
    "谢谢",
    "不客气",
    "文档更新了，大家看下",
    "收到",
    "有问题群里说",
    "好的",
  ],
  "group-2": [
    "欢迎加入 {group}",
    "大家好",
    "任务进度如何？",
    "前端差不多了",
    "后端 API 今天能完",
    "好，明天联调",
    "收到",
    "任务已完成",
    "辛苦",
    "明天开会 10 点",
    "知道了",
    "同步下排期",
    "我发文档",
    "OK",
  ],
  "group-3": [
    "欢迎加入 {group}",
    "大家好！",
    "有人要咖啡吗",
    "我要",
    "+1",
    "哈哈哈",
    "笑死",
    "这个需求改了几版了",
    "产品说最后一版",
    "我信了",
    "哈哈哈哈",
    "冷静",
    "周末去哪玩",
    "还没想好",
    "约饭吗",
    "可以啊",
  ],
};

function createGroupMessages(groupId: string, groupName: string): Message[] {
  const base = Date.now() - 7200000;
  const members = [
    { id: "user-alice", name: "Alice" },
    { id: "user-bob", name: "Bob" },
    { id: "user-carol", name: "Carol" },
    { id: "user-dave", name: "Dave" },
    { id: CURRENT_USER_ID, name: "Me" },
  ];
  const lines = GROUP_LINES_BY_GROUP[groupId] ?? [
    "欢迎加入 " + groupName,
    "大家好！",
  ];
  const msgs: Message[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isSystem = i === 0;
    const m = members[i % members.length];
    const content = line.replace("{group}", groupName);
    msgs.push({
      id: `msg-grp-${groupId}-${i + 1}`,
      conversationId: groupId,
      content,
      type: isSystem ? MessageType.SYSTEM : MessageType.TEXT,
      status: MessageStatus.READ,
      senderType: isSystem ? SenderType.SYSTEM : SenderType.USER,
      senderId: isSystem ? "system" : m.id,
      senderName: isSystem ? "System" : m.name,
      timestamp: base + i * 90000,
      seqId: i + 1,
    });
  }
  // 群组内注入图片、视频、URL 富文本（仅技术交流）
  if (groupId === "group-1") {
    const off = msgs.length;
    msgs.push(
      {
        id: `msg-grp-${groupId}-img`,
        conversationId: groupId,
        content: "https://picsum.photos/500/280",
        type: MessageType.IMAGE,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: "user-alice",
        senderName: "Alice",
        timestamp: base + off * 90000,
        seqId: off + 1,
      },
      {
        id: `msg-grp-${groupId}-vid`,
        conversationId: groupId,
        content: SAMPLE_VIDEO_URL,
        type: MessageType.VIDEO,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: CURRENT_USER_ID,
        senderName: "Me",
        timestamp: base + (off + 1) * 90000,
        seqId: off + 2,
      },
      {
        id: `msg-grp-${groupId}-url`,
        conversationId: groupId,
        content: "Layer2 入门可以参考：https://ethereum.org 和 https://viem.sh",
        type: MessageType.TEXT,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: "user-bob",
        senderName: "Bob",
        timestamp: base + (off + 2) * 90000,
        seqId: off + 3,
      },
      {
        id: `msg-grp-${groupId}-md`,
        conversationId: groupId,
        content:
          "发个代码示例：\n```solidity\nfunction transfer(address to, uint256 amount) external {\n  _transfer(msg.sender, to, amount);\n}\n```",
        type: MessageType.TEXT,
        status: MessageStatus.READ,
        senderType: SenderType.USER,
        senderId: "user-carol",
        senderName: "Carol",
        timestamp: base + (off + 3) * 90000,
        seqId: off + 4,
      },
    );
  }
  return msgs;
}

/** 预生成的 C2C 消息 */
const C2C_MESSAGES: Record<string, Message[]> = {};
MOCK_FRIENDS.forEach((f) => {
  C2C_MESSAGES[`c2c-${f.id}`] = createC2CMessages(f.id, f.name);
});

/** 预生成的群组消息 */
const GROUP_MESSAGES: Record<string, Message[]> = {};
MOCK_GROUPS.forEach((g) => {
  GROUP_MESSAGES[g.id] = createGroupMessages(g.id, g.name);
});

export function getMessagesForConversation(convKey: string): Message[] {
  return [...(C2C_MESSAGES[convKey] ?? GROUP_MESSAGES[convKey] ?? [])].sort(
    (a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp),
  );
}

export function getConversationKey(type: "c2c" | "group", id: string): string {
  return type === "c2c" ? `c2c-${id}` : id;
}
