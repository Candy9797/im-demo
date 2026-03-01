/**
 * 多人房间 WebSocket：/ws-room
 * - 认证：URL token 或 Sec-WebSocket-Protocol（与主 WS 一致）
 * - 首帧：join_room { roomId, displayName? }，服务端校验后加入房间并下发 room_joined
 * - 之后可发：send_message { content }，服务端落库并广播 room_message 给房间内所有人
 * - 纯 JSON，无 Protobuf
 */
import type { WebSocket } from "ws";
import { verifyToken } from "./auth";
import * as db from "./db";

const ROOM_HISTORY_LIMIT = 50;

interface RoomMember {
  ws: WebSocket;
  userId: string;
  userName: string;
}

const roomMembers = new Map<string, Set<RoomMember>>();
const wsToRoom = new WeakMap<WebSocket, { roomId: string; userId: string; userName: string }>();

function send(ws: WebSocket, type: string, payload: unknown) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type, ...payload }));
  } catch (e) {
    console.error("[ws-room] send error", e);
  }
}

function broadcastToRoom(roomId: string, type: string, payload: unknown, excludeWs?: WebSocket) {
  const members = roomMembers.get(roomId);
  if (!members) return;
  const raw = JSON.stringify({ type, ...payload });
  for (const m of members) {
    if (m.ws !== excludeWs && m.ws.readyState === 1) {
      try {
        m.ws.send(raw);
      } catch (e) {
        console.error("[ws-room] broadcast send error", e);
      }
    }
  }
}

function toRoomMessage(row: { id: string; seq_id: number; sender_id: string; sender_name: string; content: string; msg_type: string; timestamp: number }) {
  return {
    id: row.id,
    roomId: "",
    seqId: row.seq_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    content: row.content,
    type: row.msg_type,
    timestamp: row.timestamp,
  };
}

export function handleRoomConnection(ws: WebSocket, token: string | null) {
  if (!token) {
    send(ws, "error", { code: "auth_required", message: "Please connect wallet or use guest login first" });
    ws.close();
    return;
  }
  const auth = verifyToken(token);
  if (!auth) {
    send(ws, "error", { code: "invalid_token", message: "Invalid or expired token" });
    ws.close();
    return;
  }

  const defaultUserName = `${auth.address.slice(0, 6)}…${auth.address.slice(-4)}`;
  let joined = false;

  ws.on("message", (raw) => {
    try {
      const data = typeof raw === "string" ? raw : (Array.isArray(raw) ? Buffer.concat(raw) : raw).toString();
      const msg = JSON.parse(data) as { type: string; roomId?: string; displayName?: string; content?: string };

      if (!joined) {
        if (msg.type !== "join_room" || !msg.roomId || typeof msg.roomId !== "string") {
          send(ws, "error", { code: "join_first", message: "Send join_room with roomId first" });
          ws.close();
          return;
        }
        const roomId = String(msg.roomId).trim().slice(0, 64) || "general";
        const room = db.ensureRoom(roomId);
        const userName = (msg.displayName && String(msg.displayName).trim().slice(0, 64)) || defaultUserName;

        let members = roomMembers.get(roomId);
        if (!members) {
          members = new Set();
          roomMembers.set(roomId, members);
        }
        const member: RoomMember = { ws, userId: auth.userId, userName };
        members.add(member);
        wsToRoom.set(ws, { roomId, userId: auth.userId, userName });
        joined = true;

        const latest = db.getRoomMessagesBefore(roomId, Number.MAX_SAFE_INTEGER, ROOM_HISTORY_LIMIT);
        const messages = latest.map((r) => ({ ...toRoomMessage(r), roomId }));

        send(ws, "room_joined", {
          roomId: room.id,
          roomName: room.name,
          members: Array.from(members).map((m) => ({ userId: m.userId, userName: m.userName })),
          messages,
        });

        broadcastToRoom(roomId, "room_user_joined", { userId: auth.userId, userName }, ws);
        return;
      }

      if (msg.type === "send_message") {
        const info = wsToRoom.get(ws);
        if (!info || !msg.content || typeof msg.content !== "string") return;
        const content = String(msg.content).trim().slice(0, 4096);
        if (!content) return;

        const roomId = info.roomId;
        const seqId = db.nextRoomSeqId(roomId);
        const msgId = `room-${roomId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        db.insertRoomMessage(msgId, roomId, seqId, info.userId, info.userName, content, "text");

        const payload = {
          message: {
            id: msgId,
            roomId,
            seqId,
            senderId: info.userId,
            senderName: info.userName,
            content,
            type: "text",
            timestamp: Date.now(),
          },
        };
        send(ws, "room_message", payload);
        broadcastToRoom(roomId, "room_message", payload, ws);
        return;
      }

      if (msg.type === "typing") {
        const info = wsToRoom.get(ws);
        if (!info) return;
        broadcastToRoom(info.roomId, "room_typing", {
          userId: info.userId,
          userName: info.userName,
          typing: Boolean(msg.typing),
        }, ws);
      }
    } catch (e) {
      console.error("[ws-room] message parse/handle error", e);
      send(ws, "error", { code: "bad_request", message: "Invalid JSON or payload" });
    }
  });

  ws.on("close", () => {
    const info = wsToRoom.get(ws);
    if (info) {
      const members = roomMembers.get(info.roomId);
      if (members) {
        for (const m of members) {
          if (m.ws === ws) {
            members.delete(m);
            break;
          }
        }
        if (members.size === 0) roomMembers.delete(info.roomId);
        broadcastToRoom(info.roomId, "room_user_left", { userId: info.userId, userName: info.userName });
      }
      wsToRoom.delete(ws);
    }
  });
}
