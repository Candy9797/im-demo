/**
 * WebSocket 帧序列化层
 * 支持 JSON（默认）和 Protobuf（高 QPS 场景：快约 10 倍，体积小约 60%）
 */
import * as protobuf from "protobufjs";
import type { Frame, FrameType } from "./types";

/** 序列化格式 */
export type SerializeFormat = "json" | "protobuf";

/** 单分片最大字节数（64KB），避免大消息阻塞连接与心跳超时 */
export const CHUNK_SIZE = 64 * 1024;

/** 分片元数据：首条文本消息，告知 messageId / 总片数 / 格式 */
export const FRAG_META_TYPE = "frag_meta" as const;
export interface FragMetaPayload {
  messageId: string;
  totalChunks: number;
  format: SerializeFormat;
}

export function createFragMeta(
  messageId: string,
  totalChunks: number,
  format: SerializeFormat
): string {
  return JSON.stringify({
    type: FRAG_META_TYPE,
    payload: { messageId, totalChunks, format },
  });
}

export function isFragMeta(obj: unknown): obj is { type: typeof FRAG_META_TYPE; payload: FragMetaPayload } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as { type?: string }).type === FRAG_META_TYPE &&
    typeof (obj as { payload?: FragMetaPayload }).payload === "object"
  );
}

/**
 * 将已编码的整帧（string 或 ArrayBuffer）按 CHUNK_SIZE 拆成多个分片
 */
export function splitIntoChunks(encoded: string | ArrayBuffer): { chunks: Uint8Array[]; totalChunks: number } {
  const bytes =
    typeof encoded === "string"
      ? new TextEncoder().encode(encoded)
      : new Uint8Array(encoded);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length)));
  }
  return { chunks, totalChunks: chunks.length };
}

/** 根据已收到的分片顺序拼接为完整 buffer */
export function reassembleChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** FrameType 字符串 -> Protobuf 枚举值 */
const FRAME_TYPE_TO_ENUM: Record<string, number> = {
  auth: 1,
  send_message: 2,
  typing: 3,
  ack: 4,
  ping: 5,
  request_agent: 6,
  sync: 7,
  load_history: 8,
  mark_read: 9,
  add_reaction: 10,
  remove_reaction: 11,
  edit_message: 12,
  recall_message: 13,
  simulate_push: 14,
  auth_ok: 15,
  message: 16,
  message_ack: 17,
  typing_start: 18,
  typing_stop: 19,
  pong: 20,
  queue_status: 21,
  agent_info: 22,
  phase_change: 23,
  error: 24,
  sync_response: 25,
  session_switched: 26,
  history_response: 27,
  presence_update: 28,
  read_receipt: 29,
  reaction_update: 30,
  message_edit: 31,
  message_recall: 32,
  kicked: 33,
};

/** Protobuf 枚举值 -> FrameType 字符串 */
const ENUM_TO_FRAME_TYPE: Record<number, string> = Object.fromEntries(
  Object.entries(FRAME_TYPE_TO_ENUM).map(([k, v]) => [v, k])
);

// 内联 proto 内容，便于 client/server 共用，无需加载外部文件
const PROTO_SOURCE = `
syntax = "proto3";
package im;
enum FrameTypeEnum {
  FRAME_TYPE_UNKNOWN = 0;
  AUTH = 1; SEND_MESSAGE = 2; TYPING = 3; ACK = 4; HEARTBEAT_PING = 5;
  REQUEST_AGENT = 6; SYNC = 7; LOAD_HISTORY = 8; MARK_READ = 9;
  ADD_REACTION = 10; REMOVE_REACTION = 11; EDIT_MESSAGE = 12; RECALL_MESSAGE = 13;
  SIMULATE_PUSH = 14; AUTH_OK = 15; MESSAGE = 16; MESSAGE_ACK = 17;
  TYPING_START = 18; TYPING_STOP = 19; HEARTBEAT_PONG = 20; QUEUE_STATUS = 21;
  AGENT_INFO = 22; PHASE_CHANGE = 23; ERROR = 24; SYNC_RESPONSE = 25;
  SESSION_SWITCHED = 26; HISTORY_RESPONSE = 27; PRESENCE_UPDATE = 28;
  READ_RECEIPT = 29; REACTION_UPDATE = 30; MESSAGE_EDIT = 31; MESSAGE_RECALL = 32; KICKED = 33;
}
message IMMessage {
  string id = 1;
  string conversation_id = 2;
  string content = 3;
  string type = 4;
  string status = 5;
  string sender_type = 6;
  string sender_id = 7;
  string sender_name = 8;
  optional string sender_avatar = 9;
  int64 timestamp = 10;
  optional bytes metadata = 11;
  optional int32 seq_id = 12;
}
message MessageListPayload { repeated IMMessage messages = 1; optional bool has_more = 2; }
message SingleMessagePayload { IMMessage message = 1; }
message MessageAckItem { string client_msg_id = 1; string server_msg_id = 2; int32 seq_id = 3; }
message MessageAckPayload { repeated MessageAckItem acks = 1; }
message HeartbeatPayload { int64 ts = 1; }
message QueueStatusPayload { int32 position = 1; int32 total = 2; int32 estimated_wait = 3; }
message Frame {
  FrameTypeEnum type = 1;
  int32 seq = 2;
  int64 timestamp = 3;
  bytes payload = 4;
}
`;

let root: protobuf.Root;
let FrameMessage: protobuf.Type;
let MessageListPayload: protobuf.Type;
let SingleMessagePayload: protobuf.Type;
let MessageAckPayload: protobuf.Type;
let HeartbeatPayload: protobuf.Type;
let QueueStatusPayload: protobuf.Type;

function initProto() {
  if (root) return;
  root = new protobuf.Root();
  protobuf.parse(PROTO_SOURCE, root);
  FrameMessage = root.lookupType("im.Frame");
  MessageListPayload = root.lookupType("im.MessageListPayload");
  SingleMessagePayload = root.lookupType("im.SingleMessagePayload");
  MessageAckPayload = root.lookupType("im.MessageAckPayload");
  HeartbeatPayload = root.lookupType("im.HeartbeatPayload");
  QueueStatusPayload = root.lookupType("im.QueueStatusPayload");
}

/** 将 Message 转为 IMMessage 格式 */
function toIMMessage(m: {
  id?: string;
  conversationId?: string;
  content?: string;
  type?: string;
  status?: string;
  senderType?: string;
  senderId?: string;
  senderName?: string;
  senderAvatar?: string;
  timestamp?: number;
  metadata?: unknown;
  seqId?: number;
}) {
  return {
    id: m.id ?? "",
    conversation_id: m.conversationId ?? "",
    content: m.content ?? "",
    type: m.type ?? "text",
    status: m.status ?? "sent",
    sender_type: m.senderType ?? "user",
    sender_id: m.senderId ?? "",
    sender_name: m.senderName ?? "",
    sender_avatar: m.senderAvatar,
    timestamp: BigInt(m.timestamp ?? 0),
    metadata: m.metadata
      ? new TextEncoder().encode(JSON.stringify(m.metadata))
      : undefined,
    seq_id: m.seqId,
  };
}

/** 将 IMMessage 转为 Message 格式 */
function fromIMMessage(p: {
  id?: string;
  conversation_id?: string;
  content?: string;
  type?: string;
  status?: string;
  sender_type?: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  timestamp?: bigint;
  metadata?: Uint8Array;
  seq_id?: number;
}) {
  let metadata: unknown;
  if (p.metadata && p.metadata.length > 0) {
    try {
      metadata = JSON.parse(new TextDecoder().decode(p.metadata));
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: p.id ?? "",
    conversationId: p.conversation_id ?? "",
    content: p.content ?? "",
    type: p.type ?? "text",
    status: p.status ?? "sent",
    senderType: p.sender_type ?? "user",
    senderId: p.sender_id ?? "",
    senderName: p.sender_name ?? "",
    senderAvatar: p.sender_avatar,
    timestamp: Number(p.timestamp ?? 0),
    metadata,
    seqId: p.seq_id,
  };
}

/** 编码 payload 为 Protobuf bytes */
function encodePayload(type: string, payload: unknown): Uint8Array {
  initProto();
  const json = JSON.stringify;
  const enc = (s: string) => new TextEncoder().encode(s);

  switch (type) {
    case "ping":
    case "pong": {
      const obj = payload as { ts?: number };
      const encoded = HeartbeatPayload.encode({
        ts: BigInt(obj?.ts ?? Date.now()),
      }).finish();
      return encoded;
    }
    case "queue_status": {
      const obj = payload as { position?: number; total?: number; estimatedWait?: number };
      const encoded = QueueStatusPayload.encode({
        position: obj?.position ?? 0,
        total: obj?.total ?? 0,
        estimated_wait: obj?.estimatedWait ?? 0,
      }).finish();
      return encoded;
    }
    case "message_ack": {
      const arr = Array.isArray(payload) ? payload : [payload];
      const acks = arr.map((a: { clientMsgId?: string; serverMsgId?: string; seqId?: number }) => ({
        client_msg_id: a.clientMsgId ?? "",
        server_msg_id: a.serverMsgId ?? "",
        seq_id: a.seqId ?? 0,
      }));
      return MessageAckPayload.encode({ acks }).finish();
    }
    case "message": {
      const msgs = Array.isArray(payload) ? payload : [payload];
      if (msgs.length === 1) {
        return SingleMessagePayload.encode({
          message: toIMMessage(msgs[0]),
        }).finish();
      }
      return MessageListPayload.encode({
        messages: msgs.map(toIMMessage),
      }).finish();
    }
    default:
      return enc(json(payload ?? {}));
  }
}

/** 解码 Protobuf payload bytes */
function decodePayload(type: string, bytes: Uint8Array): unknown {
  initProto();
  const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

  switch (type) {
    case "ping":
    case "pong": {
      const decoded = HeartbeatPayload.decode(bytes);
      return { ts: Number(decoded.ts) };
    }
    case "queue_status": {
      const decoded = QueueStatusPayload.decode(bytes);
      return {
        position: decoded.position,
        total: decoded.total,
        estimatedWait: decoded.estimated_wait,
      };
    }
    case "message_ack": {
      const decoded = MessageAckPayload.decode(bytes);
      return decoded.acks.map((a) => ({
        clientMsgId: a.client_msg_id,
        serverMsgId: a.server_msg_id,
        seqId: a.seq_id,
      }));
    }
    case "message": {
      if (bytes.length === 0) return [];
      try {
        const asList = MessageListPayload.decode(bytes);
        if (asList.messages?.length) {
          return asList.messages.map((m) => fromIMMessage(m));
        }
      } catch {
        /* try single */
      }
      try {
        const asSingle = SingleMessagePayload.decode(bytes);
        if (asSingle.message) {
          return [fromIMMessage(asSingle.message)];
        }
      } catch {
        /* fallback */
      }
      return dec(bytes);
    }
    default:
      return dec(bytes);
  }
}

/** 检测数据是否为 Protobuf（JSON 以 { 或 [ 开头，否则视为二进制） */
function looksLikeProtobuf(data: ArrayBuffer | string): boolean {
  if (typeof data === "string") return false;
  const arr = new Uint8Array(data);
  if (arr.length === 0) return false;
  const first = arr[0];
  return first !== 0x7b && first !== 0x5b; // not '{' or '['
}

export interface SerializerOptions {
  format: SerializeFormat;
}

/**
 * 序列化 Frame 为 WebSocket 可发送格式（string 或 ArrayBuffer）
 */
export function encodeFrame(frame: Frame, format: SerializeFormat): string | ArrayBuffer {
  if (format === "json") {
    return JSON.stringify(frame);
  }
  initProto();
  const typeNum = FRAME_TYPE_TO_ENUM[frame.type] ?? 0;
  const payloadBytes = encodePayload(frame.type, frame.payload);
  const encoded = FrameMessage.encode({
    type: typeNum,
    seq: frame.seq,
    timestamp: BigInt(frame.timestamp),
    payload: payloadBytes,
  }).finish();
  return encoded.buffer;
}

/**
 * 解析 WebSocket 收到的数据为 Frame
 */
export function decodeFrame(
  data: string | ArrayBuffer | Buffer | Uint8Array,
  format?: SerializeFormat
): Frame {
  const str = typeof data === "string" ? data : null;
  const buf =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : null;

  if (buf && buf.length === 0) {
    throw new Error("Empty binary frame");
  }

  const useProto =
    format === "protobuf" || (buf && !str && looksLikeProtobuf(buf));

  if (useProto && buf) {
    initProto();
    const decoded = FrameMessage.decode(buf) as {
      type: number;
      seq: number;
      timestamp: bigint;
      payload: Uint8Array;
    };
    const typeStr = ENUM_TO_FRAME_TYPE[decoded.type] ?? "auth";
    const payload = decodePayload(typeStr, decoded.payload ?? new Uint8Array(0));
    return {
      type: typeStr as FrameType,
      seq: decoded.seq ?? 0,
      timestamp: Number(decoded.timestamp ?? 0),
      payload,
    };
  }

  const text = str ?? (buf ? new TextDecoder().decode(buf) : "");
  if (!text || text.trim().length < 2) {
    throw new Error("Empty or invalid frame (text too short for JSON)");
  }
  return JSON.parse(text) as Frame;
}
