/**
 * SQLite database for IM server (using sql.js - no native bindings, runs everywhere)
 * 使用 sql.js 替代 better-sqlite3，无需编译原生模块，避免 ECONNREFUSED 因后端无法启动。
 *
 * 使用方式：在 server 启动前必须 await initDb()。
 */
import initSqlJs from "sql.js";
import path from "path";
import fs from "fs";
import { generateNonce as siweGenerateNonce } from "siwe";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA synchronous = NORMAL");

  db.exec(`
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

  try {
    db.run("ALTER TABLE conversations ADD COLUMN session_type TEXT DEFAULT 'bot'");
  } catch (_e) {}
  try {
    db.run("ALTER TABLE conversations ADD COLUMN parent_conv_id TEXT");
  } catch (_e) {}
}

function getDb() {
  if (!db) throw new Error("DB not initialized: call initDb() before starting the server");
  return db;
}

/** sql.js 没有 db.get()，用 prepare + step + getAsObject 取单行 */
function getOne(d: ReturnType<typeof getDb>, sql: string, params: unknown[]): Record<string, unknown> | undefined {
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const hasRow = stmt.step();
  const row = hasRow ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
  stmt.free();
  return row;
}

/** sql.js 没有 db.all()，用 prepare + 循环 step + getAsObject 取多行 */
function getAll(d: ReturnType<typeof getDb>, sql: string, params: unknown[]): Record<string, unknown>[] {
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
  stmt.free();
  return rows;
}

// User ops
export function ensureUser(address: string): string {
  const d = getDb();
  const existing = getOne(d, "SELECT id FROM users WHERE address = ?", [address]) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  d.run("INSERT INTO users (id, address, created_at) VALUES (?, ?, ?)", [
    id,
    address.toLowerCase(),
    Date.now(),
  ]);
  return id;
}

// Conversation ops
export function createBotConversation(userId: string): { id: string } {
  const id = `conv-bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  getDb().run(
    "INSERT INTO conversations (id, user_id, session_type, phase, parent_conv_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, userId, "bot", "bot", null, now, now]
  );
  return { id };
}

export function createAgentConversation(userId: string, parentBotConvId: string): { id: string } {
  const id = `conv-agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  getDb().run(
    "INSERT INTO conversations (id, user_id, session_type, phase, parent_conv_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, userId, "agent", "queuing", parentBotConvId, now, now]
  );
  return { id };
}

export function getOrCreateBotConversation(userId: string): { id: string } {
  const row = getOne(getDb(), "SELECT id FROM conversations WHERE user_id = ? AND session_type = 'bot' AND phase != 'closed' ORDER BY updated_at DESC LIMIT 1", [userId]) as { id: string } | undefined;
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
  const d = getDb();
  const now = Date.now();
  if (updates.phase) {
    d.run("UPDATE conversations SET phase = ?, updated_at = ? WHERE id = ?", [
      updates.phase,
      now,
      convId,
    ]);
  }
  if (updates.agent_id !== undefined) {
    d.run(
      "UPDATE conversations SET agent_id = ?, agent_name = ?, agent_code = ?, updated_at = ? WHERE id = ?",
      [
        updates.agent_id,
        updates.agent_name ?? null,
        updates.agent_code ?? null,
        now,
        convId,
      ]
    );
  }
  if (updates.queue_position !== undefined || updates.queue_total !== undefined) {
    const curr = getOne(d, "SELECT queue_position, queue_total FROM conversations WHERE id = ?", [convId]) as { queue_position: number | null; queue_total: number | null };
    d.run(
      "UPDATE conversations SET queue_position = ?, queue_total = ?, updated_at = ? WHERE id = ?",
      [
        updates.queue_position ?? curr?.queue_position ?? 0,
        updates.queue_total ?? curr?.queue_total ?? 0,
        now,
        convId,
      ]
    );
  }
}

export function getConversation(convId: string) {
  return getOne(getDb(), "SELECT * FROM conversations WHERE id = ?", [convId]) as
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
  const row = getOne(getDb(), "SELECT MAX(seq_id) as m FROM messages WHERE conversation_id = ?", [convId]) as { m: number | null };
  return (row?.m ?? 0) + 1;
}

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
  getDb().run(
    `INSERT INTO messages (id, conversation_id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)`,
    [
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
      Date.now(),
    ]
  );
}

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
  const d = getDb();
  d.run("BEGIN");
  try {
    for (const row of rows) {
      d.run(
        `INSERT INTO messages (id, conversation_id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?)`,
        [
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
          Date.now(),
        ]
      );
    }
    d.run("COMMIT");
  } catch (e) {
    d.run("ROLLBACK");
    throw e;
  }
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
  return getAll(getDb(), "SELECT id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp FROM messages WHERE conversation_id = ? AND seq_id > ? ORDER BY seq_id ASC", [convId, afterSeqId]) as any;
}

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
  return getAll(getDb(), "SELECT id, seq_id, client_msg_id, content, msg_type, sender_type, sender_id, sender_name, status, metadata, timestamp FROM messages WHERE conversation_id = ? AND seq_id < ? ORDER BY seq_id DESC LIMIT ?", [convId, beforeSeqId, limit]) as any;
}

export function updateMessageStatus(msgId: string, status: string) {
  getDb().run("UPDATE messages SET status = ? WHERE id = ?", [status, msgId]);
}

export function updateMessageContent(msgId: string, content: string) {
  getDb().run("UPDATE messages SET content = ? WHERE id = ?", [content, msgId]);
}

export function updateMessageMetadata(msgId: string, metadata: string) {
  getDb().run("UPDATE messages SET metadata = ? WHERE id = ?", [metadata, msgId]);
}

export function getMessage(msgId: string, convId?: string) {
  const d = getDb();
  let row = getOne(d, "SELECT * FROM messages WHERE id = ?", [msgId]) as
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
    row = getOne(d, "SELECT * FROM messages WHERE conversation_id = ? AND client_msg_id = ?", [convId, msgId]) as typeof row;
  }
  return row;
}

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
  return getAll(getDb(), "SELECT id, seq_id, content, msg_type, sender_type, sender_id, sender_name, timestamp FROM messages WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY seq_id DESC LIMIT ?", [convId, `%${escaped}%`, limit]) as any;
}

export function deleteMessagesOlderThan(days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  getDb().run("DELETE FROM messages WHERE timestamp < ?", [cutoff]);
  const r = getOne(getDb(), "SELECT changes() as c", []) as { c: number };
  return r?.c ?? 0;
}

// Nonce ops
export function createNonce(address: string): string {
  const nonce = siweGenerateNonce();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  getDb().run(
    "INSERT OR REPLACE INTO nonces (nonce, address, expires_at) VALUES (?, ?, ?)",
    [nonce, address.toLowerCase(), expiresAt]
  );
  return nonce;
}

export function consumeNonce(nonce: string): string | null {
  const d = getDb();
  const row = getOne(d, "SELECT address FROM nonces WHERE nonce = ? AND expires_at > ?", [nonce, Date.now()]) as { address: string } | undefined;
  if (!row) return null;
  d.run("DELETE FROM nonces WHERE nonce = ?", [nonce]);
  return row.address;
}
