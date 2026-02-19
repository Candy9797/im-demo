/**
 * SQLite database for IM server
 * cd /Users/wqx/im
sqlite3 data/im.db
 *.tables              -- 列出所有表
.schema users        -- 查看 users 表结构
SELECT * FROM users; -- 查询 users
 * ## 数据库设计概览
 *
 * ### 表结构
 * | 表 | 用途 |
 * |----|------|
 * | users | 用户表，address 唯一，支持访客随机地址和钱包真实地址 |
 * | conversations | 会话表，支持 bot（智能助手）和 agent（人工客服）双会话 |
 * | messages | 消息表，按 conversation_id + seq_id 有序存储 |
 * | nonces | SIWE 一次性 nonce，防重放，5 分钟过期 |
 *
 * ### 会话模型（Dual-session）
 * - bot 会话：智能助手对话，phase=bot
 * - agent 会话：转人工后新建，phase=queuing|agent|closed，parent_conv_id 指向 bot 会话
 * - 转人工时创建新的 agent 会话，与 bot 会话独立
 *
 * ### Demo Token 生成流程
 * 1. createDemoAuth()（auth.ts）随机生成 40 位十六进制地址：0x + 40 字符
 * 2. ensureUser(address) 查 users，若已有则返回 id，否则插入新用户（address 存小写）
 * 3. createToken(userId, address) 用 JWT 签发 token（payload: { userId, address }，24h 过期）
 * 4. 返回 { token, userId, address } 给前端
 * - Demo 不经过 nonce/SIWE，直接随机地址 + ensureUser + JWT
 * 一、db 设计概览
1. 表结构
表	用途
users	用户表，address 唯一。Demo 使用随机 0x... 地址，钱包使用真实地址
conversations	会话表，支持 bot（智能助手）和 agent（人工客服）两种类型
messages	消息表，按 conversation_id + seq_id 有序存储
nonces	SIWE 一次性 nonce，用于防重放，5 分钟过期
2. 会话模型（Dual-session）
bot 会话：智能助手对话，phase=bot
agent 会话：转人工后新建，phase=queuing|agent|closed，parent_conv_id 指向 bot 会话
转人工时会新建一个 agent 会话，与原有 bot 会话并行存在
3. 关键函数
ensureUser(address)：保证用户存在；已存在则返回 id，否则插入新用户（address 统一存小写）
createNonce(address)：生成 SIWE nonce，格式为仅字母数字且 ≥8 字符
consumeNonce(nonce)：校验 nonce 是否存在且未过期，返回绑定的 address 并删除该记录（一次性使用）
二、Demo Token 生成流程
GET /api/auth/demo  →  createDemoAuth() (auth.ts)
生成随机地址：0x + 40 位十六进制（Array.from({ length: 40 }, ...)）
ensureUser(address)：在 users 中查找该 address；若存在则返回已有 id，否则插入新行（address 存小写）
createToken(userId, address)：JWT 签发，payload 为 { userId, address }，24h 过期
返回：{ token, userId, address } 给前端
Demo 不走 nonce/SIWE，直接基于随机地址 + ensureUser + JWT 生成 token。
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { generateNonce as siweGenerateNonce } from "siwe";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "im.db"));

// WAL mode for better concurrent read/write under high load
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

db.exec(`
  /* 用户表：address 唯一，Demo 用随机 0x...，钱包用真实地址 */
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'bot',
    phase TEXT NOT NULL DEFAULT 'bot',
    parent_conv_id TEXT,
    agent_id TEXT,
    agent_name TEXT,
    agent_code TEXT,
    queue_position INTEGER,
    queue_total INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_conv_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    seq_id INTEGER NOT NULL,
    client_msg_id TEXT,
    content TEXT NOT NULL,
    msg_type TEXT NOT NULL DEFAULT 'text',
    sender_type TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    metadata TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  /* nonces：SIWE 一次性 nonce，createNonce 时写入，consumeNonce 时校验+删除 */
  CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user_type ON conversations(user_id, session_type);
  CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);
`);

// Migration: add session_type if missing
try {
  db.exec(
    "ALTER TABLE conversations ADD COLUMN session_type TEXT DEFAULT 'bot'"
  );
} catch (_e) {}
try {
  db.exec("ALTER TABLE conversations ADD COLUMN parent_conv_id TEXT");
} catch (_e) {}

// User ops
/** 确保用户存在：有则返回 id，无则新建。Demo 和 SIWE 均复用此逻辑，address 统一存小写 */
export function ensureUser(address: string): string {
  const existing = db
    .prepare("SELECT id FROM users WHERE address = ?")
    .get(address) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    "INSERT INTO users (id, address, created_at) VALUES (?, ?, ?)"
  ).run(id, address.toLowerCase(), Date.now());
  return id;
}

// Conversation ops
const STMT_CREATE_CONV = db.prepare(
  "INSERT INTO conversations (id, user_id, session_type, phase, parent_conv_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

export function createBotConversation(userId: string): { id: string } {
  const id = `conv-bot-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const now = Date.now();
  STMT_CREATE_CONV.run(id, userId, "bot", "bot", null, now, now);
  return { id };
}

export function createAgentConversation(
  userId: string,
  parentBotConvId: string
): { id: string } {
  const id = `conv-agent-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const now = Date.now();
  STMT_CREATE_CONV.run(
    id,
    userId,
    "agent",
    "queuing",
    parentBotConvId,
    now,
    now
  );
  return { id };
}

export function getOrCreateBotConversation(userId: string): { id: string } {
  const row = db
    .prepare(
      "SELECT id FROM conversations WHERE user_id = ? AND session_type = 'bot' AND phase != 'closed' ORDER BY updated_at DESC LIMIT 1"
    )
    .get(userId) as { id: string } | undefined;
  if (row) return row;
  return createBotConversation(userId);
}

export function getOrCreateActiveConversation(userId: string): { id: string } {
  return getOrCreateBotConversation(userId);
}

export function updateConversation(
  convId: string,
  updates: {
    phase?: string;
    agent_id?: string;
    agent_name?: string;
    agent_code?: string;
    queue_position?: number;
    queue_total?: number;
  }
) {
  const now = Date.now();
  if (updates.phase) {
    db.prepare(
      "UPDATE conversations SET phase = ?, updated_at = ? WHERE id = ?"
    ).run(updates.phase, now, convId);
  }
  if (updates.agent_id !== undefined) {
    db.prepare(
      "UPDATE conversations SET agent_id = ?, agent_name = ?, agent_code = ?, updated_at = ? WHERE id = ?"
    ).run(
      updates.agent_id,
      updates.agent_name ?? null,
      updates.agent_code ?? null,
      now,
      convId
    );
  }
  if (
    updates.queue_position !== undefined ||
    updates.queue_total !== undefined
  ) {
    const curr = db
      .prepare(
        "SELECT queue_position, queue_total FROM conversations WHERE id = ?"
      )
      .get(convId) as {
      queue_position: number | null;
      queue_total: number | null;
    };
    db.prepare(
      "UPDATE conversations SET queue_position = ?, queue_total = ?, updated_at = ? WHERE id = ?"
    ).run(
      updates.queue_position ?? curr?.queue_position ?? 0,
      updates.queue_total ?? curr?.queue_total ?? 0,
      now,
      convId
    );
  }
}

export function getConversation(convId: string) {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as
    | {
        id: string;
        user_id: string;
        session_type: string;
        phase: string;
        parent_conv_id: string | null;
        agent_id: string | null;
        agent_name: string | null;
        agent_code: string | null;
        queue_position: number | null;
        queue_total: number | null;
      }
    | undefined;
}

// Message ops
export function nextSeqId(convId: string): number {
  const row = db
    .prepare("SELECT MAX(seq_id) as m FROM messages WHERE conversation_id = ?")
    .get(convId) as { m: number | null };
  return (row?.m ?? 0) + 1;
}

const STMT_INSERT_MSG = db.prepare(
  `INSERT INTO messages (id, conversation_id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)`
);

export function insertMessage(
  msgId: string,
  convId: string,
  seqId: number,
  content: string,
  msgType: string,
  senderType: string,
  senderId: string,
  senderName: string,
  metadata?: string,
  clientMsgId?: string
) {
  STMT_INSERT_MSG.run(
    msgId,
    convId,
    seqId,
    clientMsgId ?? null,
    content,
    msgType,
    senderType,
    senderId,
    senderName,
    metadata ?? null,
    Date.now()
  );
}

/** Batch insert for high QPS - single transaction */
export function insertMessages(
  rows: Array<{
    msgId: string;
    convId: string;
    seqId: number;
    content: string;
    msgType: string;
    senderType: string;
    senderId: string;
    senderName: string;
    metadata?: string;
    clientMsgId?: string;
  }>
) {
  if (rows.length === 0) return;
  const insert = db.transaction((r: typeof rows) => {
    for (const row of r) {
      STMT_INSERT_MSG.run(
        row.msgId,
        row.convId,
        row.seqId,
        row.clientMsgId ?? null,
        row.content,
        row.msgType,
        row.senderType,
        row.senderId,
        row.senderName,
        row.metadata ?? null,
        Date.now()
      );
    }
  });
  insert(rows);
}

export function getMessagesAfter(
  convId: string,
  afterSeqId: number
): Array<{
  id: string;
  seq_id: number;
  client_msg_id: string | null;
  content: string;
  msg_type: string;
  sender_type: string;
  sender_id: string;
  sender_name: string;
  status: string;
  metadata: string | null;
  timestamp: number;
}> {
  return db
    .prepare(
      "SELECT id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp FROM messages WHERE conversation_id = ? AND seq_id > ? ORDER BY seq_id ASC"
    )
    .all(convId, afterSeqId) as any;
}

/** Pagination: load older messages (beforeSeqId=0 means latest, returns oldest first for prepend) */
export function getMessagesBefore(
  convId: string,
  beforeSeqId: number,
  limit: number
): Array<{
  id: string;
  seq_id: number;
  client_msg_id: string | null;
  content: string;
  msg_type: string;
  sender_type: string;
  sender_id: string;
  sender_name: string;
  status: string;
  metadata: string | null;
  timestamp: number;
}> {
  if (beforeSeqId <= 0) return [];
  return db
    .prepare(
      "SELECT id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp FROM messages WHERE conversation_id = ? AND seq_id < ? ORDER BY seq_id DESC LIMIT ?"
    )
    .all(convId, beforeSeqId, limit) as any;
}

export function updateMessageStatus(msgId: string, status: string) {
  db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, msgId);
}

export function updateMessageContent(msgId: string, content: string) {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, msgId);
}

export function updateMessageMetadata(msgId: string, metadata: string) {
  db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(
    metadata,
    msgId
  );
}

export function getMessage(msgId: string, convId?: string) {
  let row = db.prepare("SELECT * FROM messages WHERE id = ?").get(msgId) as
    | {
        id: string;
        conversation_id: string;
        client_msg_id: string | null;
        msg_type: string;
        sender_id: string;
        metadata: string | null;
        timestamp: number;
      }
    | undefined;
  if (!row && convId) {
    row = db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? AND client_msg_id = ?"
      )
      .get(convId, msgId) as typeof row;
  }
  return row;
}

/** Full-text search (LIKE) - returns messages matching query in content */
export function searchMessages(
  convId: string,
  query: string,
  limit = 50
): Array<{
  id: string;
  seq_id: number;
  content: string;
  msg_type: string;
  sender_type: string;
  sender_id: string;
  sender_name: string;
  timestamp: number;
}> {
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  return db
    .prepare(
      "SELECT id, seq_id, content, msg_type, sender_type, sender_id, sender_name, timestamp FROM messages WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY seq_id DESC LIMIT ?"
    )
    .all(convId, `%${escaped}%`, limit) as any;
}

/** Message retention: delete messages older than days */
export function deleteMessagesOlderThan(days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const r = db.prepare("DELETE FROM messages WHERE timestamp < ?").run(cutoff);
  return r.changes;
}

// Nonce ops
/** 使用 siwe 的 generateNonce 保证 nonce 符合 EIP-4361 要求（字母数字 ≥8 字符） */
export function createNonce(address: string): string {
  const nonce = siweGenerateNonce();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min
  db.prepare(
    "INSERT OR REPLACE INTO nonces (nonce, address, expires_at) VALUES (?, ?, ?)"
  ).run(nonce, address.toLowerCase(), expiresAt);
  return nonce;
}

/** 消耗 nonce：校验存在且未过期，返回绑定的 address 并删除记录（一次性，防重放） */
export function consumeNonce(nonce: string): string | null {
  const row = db
    .prepare("SELECT address FROM nonces WHERE nonce = ? AND expires_at > ?")
    .get(nonce, Date.now()) as { address: string } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM nonces WHERE nonce = ?").run(nonce);
  return row.address;
}
