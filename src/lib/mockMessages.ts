/**
 * Mock 消息生成器
 *
 * 用于历史页、性能测试等场景，生成随机用户/Bot/Agent 消息
 */
import type { Message } from '@/sdk';
import { MessageType, MessageStatus, SenderType } from '@/sdk';

const USER_MSGS = [
  'How to deposit crypto?',
  'Thanks for the help!',
  'What about withdrawal fees?',
  'Can I use MetaMask?',
  'How long does KYC take?',
  'Is my transaction safe?',
  'Why is my deposit pending?',
  'How to enable 2FA?',
  'Please connect me to an agent',
  'I need help with my account',
  'When will the maintenance end?',
  'How do I reset my password?',
  'Can you explain the fee structure?',
  'What networks are supported?',
  'Is there a minimum withdrawal?',
];

const BOT_MSGS = [
  'To deposit crypto:\n1. Go to **Wallet** → **Deposit**\n2. Select the token and network\n3. Copy the deposit address\n\n⚠️ Make sure to select the *correct network* to avoid loss of funds.',
  'You\'re welcome! Is there anything else I can help you with?',
  'Withdrawal fees vary by network. You can check the exact fee when initiating a withdrawal in the Wallet section.',
  'Yes, MetaMask is supported. Connect it via Settings → Connect Wallet.',
  'KYC verification typically takes 24-48 hours. You\'ll receive an email once it\'s complete.',
  'All transactions are secured with industry-standard encryption. We never store your private keys.',
  'Pending deposits usually confirm within 10-30 minutes depending on network congestion.',
  'Go to Security Settings → Two-Factor Authentication → Enable. You can use Google Authenticator or Authy.',
  'I\'ll transfer you to a human agent. Please hold...',
  'I understand. Let me connect you with our support team.',
];

const AGENT_MSGS = [
  'I understand your concern. Let me look into this for you.',
  'Thank you for providing that information. I\'m checking our system now.',
  'I can see the issue on our end. Let me help you resolve this.',
  'For security purposes, could you please verify your account email?',
  'I\'ve escalated this to our specialist team. You should receive an update within 24 hours.',
];

const SENDER_NAMES: Record<string, string> = {
  [SenderType.USER]: 'You',
  [SenderType.BOT]: 'Smart Assistant',
  [SenderType.AGENT]: 'Customer Service',
  [SenderType.SYSTEM]: 'System',
};

/**
 * @param count 生成条数
 * @param startSeqId 起始 seqId，用于追加时接续已有列表（默认 1）
 */
export function generateMockMessages(count: number, startSeqId = 1): Message[] {
  const messages: Message[] = [];
  const convId = 'conv-history-mock';
  const baseTime = Date.now() - count * 60000;
  const types = [MessageType.TEXT, MessageType.TEXT, MessageType.TEXT, MessageType.STICKER] as const;
  const senders = [SenderType.USER, SenderType.BOT, SenderType.AGENT] as const;

  for (let i = 0; i < count; i++) {
    const seqId = startSeqId + i;
    const sender = senders[i % senders.length];
    const type = i % 20 === 0 && i > 0 ? MessageType.SYSTEM : types[i % types.length];
    const isSystem = type === MessageType.SYSTEM;

    let content: string;
    if (isSystem) {
      content = 'You are now connected with Customer Service #1024. How can we help you today?';
    } else if (sender === SenderType.USER) {
      content = USER_MSGS[i % USER_MSGS.length];
    } else if (sender === SenderType.BOT) {
      content = BOT_MSGS[i % BOT_MSGS.length];
    } else {
      content = AGENT_MSGS[i % AGENT_MSGS.length];
    }

    if (type === MessageType.STICKER && !isSystem) {
      content = ['👍', '❤️', '😂', '🔥', '🎉'][i % 5];
    }

    const timestamp = baseTime + i * (30000 + Math.random() * 60000);
    const hasReactions = i % 7 === 0 && !isSystem;
    const metadata = hasReactions
      ? { reactions: { '👍': ['user-1'], '❤️': ['user-1', 'user-2'] } }
      : undefined;

    messages.push({
      id: `msg-history-${seqId}`,
      conversationId: convId,
      content,
      type: isSystem ? MessageType.SYSTEM : type,
      status: MessageStatus.READ,
      senderType: isSystem ? SenderType.SYSTEM : sender,
      senderId: isSystem ? 'system' : `${sender}-1`,
      senderName: isSystem ? 'System' : SENDER_NAMES[sender],
      timestamp,
      seqId,
      metadata,
    });
  }

  return messages;
}

/** 创建单条用户消息（用于历史页本地发送） */
export function createUserMessage(content: string, seqId: number): Message {
  return {
    id: `msg-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: 'conv-history-mock',
    content,
    type: MessageType.TEXT,
    status: MessageStatus.READ,
    senderType: SenderType.USER,
    senderId: 'user-1',
    senderName: 'You',
    timestamp: Date.now(),
    seqId,
  };
}

/** 创建单条机器人回复（用于历史页本地模拟） */
export function createBotReply(content: string, seqId: number): Message {
  return {
    id: `msg-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: 'conv-history-mock',
    content,
    type: MessageType.TEXT,
    status: MessageStatus.READ,
    senderType: SenderType.BOT,
    senderId: 'bot-1',
    senderName: 'Smart Assistant',
    timestamp: Date.now() + 500,
    seqId,
  };
}

/** 生成对方发来的 Mock 消息（用于 WS 测试页模拟服务端推送） */
export function createMockIncomingMessages(
  count: number,
  conversationId: string,
  baseSeqId: number
): Message[] {
  const messages: Message[] = [];
  const baseTime = Date.now();
  for (let i = 0; i < count; i++) {
    const seqId = baseSeqId + i;
    const content = BOT_MSGS[i % BOT_MSGS.length];
    messages.push({
      id: `msg-sim-${baseTime}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      content,
      type: MessageType.TEXT,
      status: MessageStatus.READ,
      senderType: SenderType.BOT,
      senderId: 'bot-1',
      senderName: 'Smart Assistant',
      timestamp: baseTime + i * 10,
      seqId,
    });
  }
  return messages;
}
