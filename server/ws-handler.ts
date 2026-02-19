/**
 * WebSocket message handler - real-time IM logic
 * Multi-device, kick, presence, read receipts, reactions, history pagination
 * 支持 JSON / Protobuf 格式，高 QPS 场景用 Protobuf
 */
import type { WebSocket } from "ws";
import {
  FrameType,
  type Frame,
  type Message,
  MessageType,
  SenderType,
} from "../src/sdk/types";
import {
  encodeFrame,
  decodeFrame,
  CHUNK_SIZE,
  createFragMeta,
  isFragMeta,
  splitIntoChunks,
  reassembleChunks,
} from "../src/sdk/serializer";
import * as db from "./db";
import { verifyToken } from "./auth";
import {
  getBotReply,
  createBotMessage,
  createAgentMessage,
  getRandomAgentResponse,
} from "./bot";
import { getFileUrl } from "./upload";

type SerializeFormat = "json" | "protobuf";

interface FragmentState {
  messageId: string;
  totalChunks: number;
  format: SerializeFormat;
  chunks: Uint8Array[];
}

function generateFragMessageId(): string {
  return `frag-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

interface ConnEntry {
  ws: WebSocket;
  userId: string;
  address: string;
  convId: string;
  connId: string;
  outSeq: number;
  format: SerializeFormat;
  fragmentState: FragmentState | null;
}
const connsByUser = new Map<string, Map<string, ConnEntry>>();
const wsToConn = new WeakMap<WebSocket, ConnEntry>();
// 限流配置
const RATE_LIMIT_MSGS_PER_SEC = 200;
const RATE_WINDOW_MS = 1000;
const rateLimitMap = new Map<string, number[]>();
let msgIdCounter = 0; // 单调递增，保证批量处理时 id 不碰撞
const HISTORY_PAGE_SIZE = 50;

/** 导出限流状态供前端展示（调试/监控用） */
// rateLimitMap 里存的是原始数组引用，checkRateLimit 会直接修改它：
//timestamps.push(now);rateLimitMap.set(userId, timestamps);
// 如果不拷贝，直接把 timestamps 交给前端，会导致：
// 调用方拿到的是内部数组的引用
// 后续 checkRateLimit 继续 push 时，引用会跟着变
// 外部也能通过这个引用修改内部状态
// 用 [...timestamps] 创建新数组，就是做一次快照，之后内部再怎么改都不会影响返回给前端的数据。

export function getRateLimitState(): Record<string, number[]> {
  // Map 序列化成 JSON 会变成 {}
  // Record<string, number[]> 是普通对象，res.json(out) 才能得到正确的 JSON：
  const out: Record<string, number[]> = {};
  for (const [userId, timestamps] of rateLimitMap.entries()) {
    out[userId] = [...timestamps];
  }
  return out;
}

export function getRateLimitConfig(): { limitPerSec: number } {
  return { limitPerSec: RATE_LIMIT_MSGS_PER_SEC };
}

const INITIAL_LOAD_LIMIT = 100;
// 每个用户 1 秒内最多发送 RATE_LIMIT_MSGS_PER_SEC 条消息

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(userId);
  if (!timestamps) {
    rateLimitMap.set(userId, [now]);
    return true;
  }
  timestamps = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MSGS_PER_SEC) return false;
  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return true;
}

function send(ws: WebSocket, type: string, payload: unknown, format: SerializeFormat = "json") {
  if (ws.readyState !== 1) return;
  const entry = wsToConn.get(ws);
  const seq = entry ? ++entry.outSeq : 0;
  const frame: Frame = { type: type as Frame["type"], seq, timestamp: Date.now(), payload };
  const encoded = encodeFrame(frame, format);
  const size =
    typeof encoded === "string"
      ? Buffer.byteLength(encoded, "utf8")
      : encoded.byteLength;
  // JSON 模式下不分片，全程走文本帧，便于限流与调试
  if (format !== "json" && size > CHUNK_SIZE) {
    const { chunks, totalChunks } = splitIntoChunks(encoded);
    const messageId = generateFragMessageId();
    ws.send(createFragMeta(messageId, totalChunks, format));
    for (const chunk of chunks) {
      ws.send(Buffer.from(chunk));
    }
  } else {
    ws.send(encoded);
  }
}

function sendToUser(userId: string, type: string, payload: unknown) {
  const conns = connsByUser.get(userId);
  if (!conns) return;
  for (const e of conns.values()) {
    send(e.ws, type, payload, e.format);
  }
}


/** 发给该会话的所有参与者：用户 + Agent（若有） */
function sendToConversation(convId: string, type: string, payload: unknown) {
  const conv = db.getConversation(convId);
  if (!conv) return;
  const seen = new Set<string>();
  if (conv.user_id) {
    seen.add(conv.user_id);
    sendToUser(conv.user_id, type, payload);
  }
  if (conv.agent_id && !seen.has(conv.agent_id)) {
    sendToUser(conv.agent_id, type, payload);
  }
}

function broadcastPresence() {
  const online = Array.from(connsByUser.keys());
  for (const [, conns] of connsByUser) {
    for (const e of conns.values()) {
      send(e.ws, FrameType.PRESENCE_UPDATE, { online, timestamp: Date.now() });
    }
  }
}

export function handleConnection(
  ws: WebSocket,
  token: string | null,
  fresh = false,
  kickOthers = true,
  format: SerializeFormat = "json",
) {
  if (!token) {
    send(ws, FrameType.ERROR, { code: "auth_required" }, format);
    ws.close();
    return;
  }
  const auth = verifyToken(token);
  if (!auth) {
    send(ws, FrameType.ERROR, { code: "invalid_token" }, format);
    ws.close();
    return;
  }

  const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id: convId } = fresh
    ? db.createBotConversation(auth.userId)
    : db.getOrCreateBotConversation(auth.userId);

  if (kickOthers) {
    const existing = connsByUser.get(auth.userId);
    if (existing) {
      for (const e of existing.values()) {
        if (e.ws !== ws) {
          send(e.ws, FrameType.KICKED, { reason: "logged_in_elsewhere" }, e.format);
          e.ws.close();
        }
      }
      existing.clear();
    }
  }

  const entry: ConnEntry = {
    ws,
    userId: auth.userId,
    address: auth.address,
    convId,
    connId,
    outSeq: 0,
    format,
    fragmentState: null,
  };
  let userConns = connsByUser.get(auth.userId);
  if (!userConns) {
    userConns = new Map();
    connsByUser.set(auth.userId, userConns);
  }
  userConns.set(connId, entry);
  wsToConn.set(ws, entry);

  const allMsgs = db.getMessagesAfter(convId, 0);
  const initialMsgs = allMsgs.slice(-INITIAL_LOAD_LIMIT).map(toMessage);

  send(ws, FrameType.AUTH_OK, {
    conversationId: convId,
    sessionType: "bot",
    phase: "bot",
    messages: initialMsgs,
    hasMore: allMsgs.length > INITIAL_LOAD_LIMIT,
  });

  broadcastPresence();

  ws.on("message", (raw) => {
    try {
      const e = wsToConn.get(ws);
      if (!e) {
        console.warn("[WS] message received but no conn entry (ws not in wsToConn)");
        return;
      }
      const fmt = e.format;
      const data = Array.isArray(raw) ? Buffer.concat(raw) : raw;
      if (typeof data === "string") {
        const parsed = JSON.parse(data) as unknown;
        if (isFragMeta(parsed)) {
          if (e) {
            e.fragmentState = {
              messageId: parsed.payload.messageId,
              totalChunks: parsed.payload.totalChunks,
              format: parsed.payload.format,
              chunks: [],
            };
          }
          return;
        }
        const frame = decodeFrame(data, fmt) as Frame;
        handleFrame(ws, e, frame);
        return;
      }
      const buf = Buffer.isBuffer(data) ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
      if (e.fragmentState) {
        e.fragmentState.chunks.push(buf);
        if (e.fragmentState.chunks.length >= e.fragmentState.totalChunks) {
          const reassembled = reassembleChunks(e.fragmentState.chunks);
          const frame = decodeFrame(reassembled, e.fragmentState.format) as Frame;
          e.fragmentState = null;
          handleFrame(ws, e, frame);
        }
        return;
      }
      const frame = decodeFrame(data, fmt) as Frame;
      if (fmt === "protobuf") {
        console.log("[WS] 收到 Protobuf 帧:", frame.type, "seq:", frame.seq);
      }
      handleFrame(ws, e, frame);
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  });

  ws.on("close", () => {
    const e = wsToConn.get(ws);
    if (e) {
      connsByUser.get(e.userId)?.delete(e.connId);
      if (connsByUser.get(e.userId)?.size === 0) {
        connsByUser.delete(e.userId);
        rateLimitMap.delete(e.userId);
      }
      broadcastPresence();
    }
  });
}

function toMessage(row: {
  id: string;
  seq_id: number;
  content: string;
  msg_type: string;
  sender_type: string;
  sender_id: string;
  sender_name: string;
  status: string;
  metadata: string | null;
  timestamp: number;
}) {
  let content = row.content;
  if (
    (row.msg_type === "image" || row.msg_type === "pdf") &&
    !content.startsWith("http")
  ) {
    content = getFileUrl(content);
  }
  return {
    id: row.id,
    conversationId: "",
    content,
    type: row.msg_type,
    status: row.status,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    timestamp: row.timestamp,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    seqId: row.seq_id,
  };
}

function handleFrame(ws: WebSocket, entry: ConnEntry, frame: Frame) {
  const { userId, convId } = entry;
  const conv = db.getConversation(convId);
  if (!conv) {
    console.warn("[WS] handleFrame: no conv for convId", convId, "frame.type", frame.type);
    return;
  }

  switch (frame.type) {
    case FrameType.HEARTBEAT_PING:
      send(ws, FrameType.HEARTBEAT_PONG, { ts: Date.now() });
      break;

    case FrameType.LOAD_HISTORY: {
      const { beforeSeqId } = (frame.payload as { beforeSeqId?: number }) ?? {};
      const rows = db.getMessagesBefore(
        convId,
        beforeSeqId ?? 0,
        HISTORY_PAGE_SIZE,
      );
      const older = rows.reverse().map(toMessage);
      const hasMore = rows.length >= HISTORY_PAGE_SIZE;
      send(ws, FrameType.HISTORY_RESPONSE, { messages: older, hasMore });
      break;
    }

    case FrameType.MARK_READ: {
      const { messageIds } = (frame.payload as { messageIds?: string[] }) ?? {};
      if (!messageIds?.length) break;
      for (const msgId of messageIds) {
        db.updateMessageStatus(msgId, "read");
        const row = db.getMessage(msgId);
        if (row) {
          let meta: Record<string, unknown> = row.metadata
            ? JSON.parse(row.metadata as string)
            : {};
          if (!Array.isArray(meta.readBy)) meta.readBy = [];
          if (!(meta.readBy as string[]).includes(userId))
            (meta.readBy as string[]).push(userId);
          db.updateMessageMetadata(msgId, JSON.stringify(meta));
        }
      }
      sendToUser(userId, FrameType.READ_RECEIPT, {
        messageIds,
        readBy: userId,
      });
      break;
    }

    case FrameType.ADD_REACTION:
    case FrameType.REMOVE_REACTION: {
      const { messageId, emoji } =
        (frame.payload as { messageId?: string; emoji?: string }) ?? {};
      if (!messageId || !emoji) break;
      const row = db.getMessage(messageId, convId);
      if (!row || row.conversation_id !== convId) break;
      const meta: Record<string, unknown> = row.metadata
        ? JSON.parse(row.metadata as string)
        : {};
      if (!meta.reactions || typeof meta.reactions !== "object")
        meta.reactions = {};
      const r = meta.reactions as Record<string, string[]>;
      if (!r[emoji]) r[emoji] = [];
      const idx = r[emoji].indexOf(userId);
      if (frame.type === FrameType.ADD_REACTION && idx < 0)
        r[emoji].push(userId);
      if (frame.type === FrameType.REMOVE_REACTION && idx >= 0)
        r[emoji].splice(idx, 1);
      if (r[emoji].length === 0) delete r[emoji];
      const actualMsgId = row.id;
      db.updateMessageMetadata(actualMsgId, JSON.stringify(meta));
      const msg = db
        .getMessagesAfter(convId, 0)
        .find((m) => m.id === actualMsgId);
      sendToUser(userId, FrameType.REACTION_UPDATE, {
        messageId: actualMsgId,
        clientMsgId: row.client_msg_id || undefined,
        reactions: meta.reactions,
        message: msg ? toMessage(msg) : undefined,
      });
      break;
    }

    case FrameType.EDIT_MESSAGE: {
      const { messageId, content } = (frame.payload as {
        messageId?: string;
        content?: string;
      }) ?? {};
      if (!messageId || !content?.trim()) break;
      const row = db.getMessage(messageId, convId);
      if (!row || row.conversation_id !== convId || row.sender_id !== userId)
        break;
      if (row.msg_type !== MessageType.TEXT) break;
      db.updateMessageContent(messageId, content.trim());
      sendToConversation(convId, FrameType.MESSAGE_EDIT, {
        messageId,
        content: content.trim(),
      });
      break;
    }

    case FrameType.RECALL_MESSAGE: {
      const { messageId } = (frame.payload as { messageId?: string }) ?? {};
      if (!messageId) break;
      const row = db.getMessage(messageId, convId);
      if (!row || row.conversation_id !== convId || row.sender_id !== userId)
        break;
      const RECALL_LIMIT_MS = 2 * 60 * 1000; // 2 分钟内可撤回
      if (Date.now() - row.timestamp > RECALL_LIMIT_MS) {
        send(ws, FrameType.ERROR, {
          code: "recall_expired",
          message: "超过 2 分钟无法撤回",
          messageId,
        });
        break;
      }
      const meta: Record<string, unknown> = row.metadata
        ? JSON.parse(row.metadata as string)
        : {};
      meta.recalled = true;
      db.updateMessageContent(messageId, "已撤回");
      db.updateMessageMetadata(messageId, JSON.stringify(meta));
      sendToConversation(convId, FrameType.MESSAGE_RECALL, { messageId });
      break;
    }

    case FrameType.SEND_MESSAGE: {
      const raw = frame.payload;
      if (raw == null || (typeof raw !== "object" && !Array.isArray(raw))) {
        console.warn("[WS] SEND_MESSAGE invalid payload", typeof raw);
        break;
      }
      const messages = Array.isArray(raw) ? (raw as Message[]) : [raw as Message];
      if (entry.format === "protobuf") {
        console.log("[WS] SEND_MESSAGE received (protobuf), count:", messages.length, "first id:", messages[0]?.id);
      } else if (messages.length > 1) {
        console.log("[WS] 收到批量 send_message:", messages.length, "条");
      }
      const acksToSend: Array<{
        clientMsgId: string;
        serverMsgId: string;
        seqId: number;
      }> = [];
      for (const msg of messages) {
        if (!msg?.id) {
          console.warn("[WS] SEND_MESSAGE skip msg without id", msg);
          continue;
        }
        if (!checkRateLimit(userId)) {
          send(ws, FrameType.ERROR, {
            code: "rate_limit",
            message: "Too many messages, please slow down",
          });
          continue;
        }
        const conv2 = db.getConversation(convId);
        if (!conv2) continue;
        const seqId = db.nextSeqId(convId);
        const ts = Date.now();
        const n = ++msgIdCounter;
        const rnd = () => Math.random().toString(36).slice(2, 8);
        const serverMsgId = `msg-${ts}-${n}-${rnd()}`;

        const toInsert: Parameters<typeof db.insertMessages>[0] = [
          {
            msgId: serverMsgId,
            convId,
            seqId,
            content: msg.content,
            msgType: msg.type,
            senderType: SenderType.USER,
            senderId: userId,
            senderName: "You",
            metadata: msg.metadata ? JSON.stringify(msg.metadata) : undefined,
            clientMsgId: msg.id,
          },
        ];

        if (conv2.phase === "bot") {
          const isSticker = msg.type === MessageType.STICKER;
          if (isSticker) {
            db.insertMessages(toInsert);
            acksToSend.push({ clientMsgId: msg.id, serverMsgId, seqId });
            sendToUser(userId, FrameType.MESSAGE_ACK, [{ clientMsgId: msg.id, serverMsgId, seqId }]);
            continue;
          }
          const reply = getBotReply(msg.content);
          if (reply === null) {
            db.insertMessages(toInsert);
            acksToSend.push({ clientMsgId: msg.id, serverMsgId, seqId });
            sendToUser(userId, FrameType.MESSAGE_ACK, [{ clientMsgId: msg.id, serverMsgId, seqId }]);
            handleRequestAgent(ws, userId, convId, entry);
            continue;
          }
          const botSeq = seqId + 1;
          const botId = `msg-${ts}-${++msgIdCounter}-${rnd()}-b`;
          const botMsg = createBotMessage(botId, convId, reply);
          sendToUser(userId, FrameType.MESSAGE_ACK, [{ clientMsgId: msg.id, serverMsgId, seqId }]);
          sendToUser(userId, FrameType.TYPING_START, { senderType: SenderType.BOT });
          toInsert.push({
            msgId: botId,
            convId,
            seqId: botSeq,
            content: reply,
            msgType: MessageType.TEXT,
            senderType: SenderType.BOT,
            senderId: "bot-1",
            senderName: "Smart Assistant",
          });
          db.insertMessages(toInsert);
          sendToUser(userId, FrameType.MESSAGE, { ...botMsg, seqId: botSeq });
          sendToUser(userId, FrameType.TYPING_STOP, {});
        } else if (conv2.phase === "agent") {
          const agentSeq = seqId + 1;
          const agentId = `msg-${ts}-${++msgIdCounter}-${rnd()}-a`;
          sendToUser(userId, FrameType.TYPING_START, { senderType: SenderType.AGENT });
          const agentMsg = createAgentMessage(
            agentId,
            convId,
            getRandomAgentResponse(),
            conv2.agent_id ?? "agent-1",
            conv2.agent_name ?? "Customer Service",
          );
          toInsert.push({
            msgId: agentId,
            convId,
            seqId: agentSeq,
            content: agentMsg.content,
            msgType: MessageType.TEXT,
            senderType: SenderType.AGENT,
            senderId: conv2.agent_id ?? "agent-1",
            senderName: conv2.agent_name ?? "Customer Service",
          });
          db.insertMessages(toInsert);
          acksToSend.push({ clientMsgId: msg.id, serverMsgId, seqId });
          sendToUser(userId, FrameType.MESSAGE_ACK, [{ clientMsgId: msg.id, serverMsgId, seqId }]);
          sendToUser(userId, FrameType.MESSAGE, {
            ...agentMsg,
            seqId: agentSeq,
          });
          sendToUser(userId, FrameType.TYPING_STOP, {});
        } else {
          db.insertMessages(toInsert);
          acksToSend.push({ clientMsgId: msg.id, serverMsgId, seqId });
          sendToUser(userId, FrameType.MESSAGE_ACK, [{ clientMsgId: msg.id, serverMsgId, seqId }]);
        }
      }
      break;
    }

    case FrameType.REQUEST_AGENT:
      handleRequestAgent(ws, userId, convId, entry);
      break;

    case FrameType.SIMULATE_PUSH: {
      const { count = 50 } = (frame.payload as { count?: number }) ?? {};
      const n = Math.min(Math.max(1, Math.floor(count)), 500);
      const BOT_TEXTS = [
        "To deposit crypto: Go to Wallet → Deposit, select the token and network.",
        "You're welcome! Is there anything else I can help with?",
        "Withdrawal fees vary by network. Check the exact fee in the Wallet section.",
        "Yes, MetaMask is supported. Connect via Settings → Connect Wallet.",
        "KYC verification typically takes 24-48 hours.",
      ];
      const toInsert: Parameters<typeof db.insertMessages>[0] = [];
      const batchMsgs: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const seqId = db.nextSeqId(convId);
        const ts = Date.now();
        const msgId = `msg-sim-${ts}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        const content = BOT_TEXTS[i % BOT_TEXTS.length];
        const botMsg = createBotMessage(msgId, convId, content);
        toInsert.push({
          msgId,
          convId,
          seqId,
          content,
          msgType: MessageType.TEXT,
          senderType: SenderType.BOT,
          senderId: "bot-1",
          senderName: "Smart Assistant",
        });
        batchMsgs.push({ ...botMsg, seqId });
      }
      db.insertMessages(toInsert);
      sendToUser(userId, FrameType.MESSAGE, batchMsgs);
      console.log("[WS] simulate_push:", n, "条（批量下发）→", userId);
      break;
    }

    case FrameType.SYNC: {
      const { afterSeqId } = (frame.payload as { afterSeqId?: number }) ?? {};
      const msgs = db.getMessagesAfter(convId, afterSeqId ?? 0);
      send(ws, FrameType.SYNC_RESPONSE, { messages: msgs.map(toMessage) });
      break;
    }

    default:
      break;
  }
}

function handleRequestAgent(
  ws: WebSocket,
  userId: string,
  currentConvId: string,
  entry: ConnEntry,
) {
  const conv = db.getConversation(currentConvId);
  const parentBotId =
    conv?.session_type === "bot"
      ? currentConvId
      : (conv?.parent_conv_id ?? db.getOrCreateBotConversation(userId).id);

  const { id: agentConvId } = db.createAgentConversation(userId, parentBotId);

  for (const e of connsByUser.get(userId)?.values() ?? []) {
    e.convId = agentConvId;
  }

  db.updateConversation(agentConvId, {
    phase: "queuing",
    queue_position: 3,
    queue_total: 5,
  });
  sendToUser(userId, FrameType.PHASE_CHANGE, {
    phase: "queuing",
    queuePosition: 3,
    queueTotal: 5,
    estimatedWait: 90,
  });

  let pos = 3;
  const iv = setInterval(() => {
    pos--;
    db.updateConversation(agentConvId, { queue_position: pos, queue_total: 5 });
    sendToUser(userId, FrameType.QUEUE_STATUS, {
      position: pos,
      total: 5,
      estimatedWait: pos * 30,
    });
    if (pos <= 0) {
      clearInterval(iv);
      assignAgent(userId, agentConvId);
    }
  }, 2000);
}

function assignAgent(userId: string, agentConvId: string) {
  const agent = {
    id: "agent-1024",
    name: "Customer Service",
    code: "1024",
    department: "General Support",
  };
  db.updateConversation(agentConvId, {
    phase: "agent",
    agent_id: agent.id,
    agent_name: agent.name,
    agent_code: agent.code,
  });

  const sysMsg = {
    id: `msg-${Date.now()}-sys`,
    conversationId: agentConvId,
    content: `You are now connected with ${agent.name} #${agent.code}. How can we help you today?`,
    type: MessageType.SYSTEM,
    status: "delivered",
    senderType: SenderType.SYSTEM,
    senderId: "system",
    senderName: "System",
    timestamp: Date.now(),
  };
  db.insertMessage(
    sysMsg.id,
    agentConvId,
    db.nextSeqId(agentConvId),
    sysMsg.content,
    MessageType.SYSTEM,
    SenderType.SYSTEM,
    "system",
    "System",
  );

  sendToUser(userId, FrameType.SESSION_SWITCHED, {
    conversationId: agentConvId,
    sessionType: "agent",
    phase: "agent",
    agentInfo: agent,
    messages: db.getMessagesAfter(agentConvId, 0).map(toMessage),
  });
}
