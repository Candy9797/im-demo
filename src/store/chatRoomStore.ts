"use client";

/**
 * 多人房间状态：连接 /ws-room，加入房间，收发消息
 * 依赖 useChatStore 的 auth（token），未登录时需先访客或钱包登录
 */
import { create } from "zustand";

export interface RoomMessage {
  id: string;
  roomId: string;
  seqId: number;
  senderId: string;
  senderName: string;
  content: string;
  type: string;
  timestamp: number;
}

export interface RoomMember {
  userId: string;
  userName: string;
}

type ConnectionState = "disconnected" | "connecting" | "connected";

interface ChatRoomState {
  roomId: string;
  roomName: string;
  messages: RoomMessage[];
  members: RoomMember[];
  connectionState: ConnectionState;
  error: string | null;
  ws: WebSocket | null;

  connect: (token: string, roomId: string, displayName?: string) => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  clearError: () => void;
}

export const useChatRoomStore = create<ChatRoomState>((set, get) => ({
  roomId: "",
  roomName: "",
  messages: [],
  members: [],
  connectionState: "disconnected",
  error: null,
  ws: null,

  clearError: () => set({ error: null }),

  connect: (token: string, roomId: string, displayName?: string) => {
    const prev = get().ws;
    if (prev) {
      prev.close();
      set({ ws: null, connectionState: "disconnected" });
    }
    const base = typeof window !== "undefined" ? `${window.location.hostname}:3001` : "localhost:3001";
    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${base}/ws-room?token=${encodeURIComponent(token)}`;
    set({ connectionState: "connecting", error: null, messages: [], members: [] });

    const ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join_room", roomId: roomId.trim() || "general", displayName: displayName?.trim() || undefined }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as { type: string; roomId?: string; roomName?: string; members?: RoomMember[]; messages?: RoomMessage[]; message?: RoomMessage; userId?: string; userName?: string; typing?: boolean; code?: string; message?: string };
        switch (data.type) {
          case "room_joined":
            set({
              connectionState: "connected",
              roomId: data.roomId ?? get().roomId,
              roomName: data.roomName ?? get().roomName,
              members: data.members ?? [],
              messages: data.messages ?? [],
              error: null,
            });
            break;
          case "room_message":
            if (data.message) {
              const msg = data.message as RoomMessage;
              set((s) => ({ messages: [...s.messages, { ...msg, roomId: msg.roomId || s.roomId }] }));
            }
            break;
          case "room_user_joined":
            set((s) => {
              const m = { userId: data.userId!, userName: data.userName ?? "" };
              if (s.members.some((x) => x.userId === m.userId)) return s;
              return { members: [...s.members, m] };
            });
            break;
          case "room_user_left":
            set((s) => ({ members: s.members.filter((m) => m.userId !== data.userId) }));
            break;
          case "error":
            set({ error: data.message ?? data.code ?? "Unknown error", connectionState: "disconnected" });
            break;
          default:
            break;
        }
      } catch (_e) {
        // ignore parse error
      }
    };
    ws.onerror = () => set({ error: "WebSocket error", connectionState: "disconnected" });
    ws.onclose = () => {
      set((s) => (s.connectionState === "connecting" ? { connectionState: "disconnected", error: s.error ?? "Connection closed" } : { ws: null, connectionState: "disconnected" }));
    };
    set({ ws });
  },

  disconnect: () => {
    const ws = get().ws;
    if (ws) {
      ws.close();
      set({ ws: null, connectionState: "disconnected", roomId: "", roomName: "", messages: [], members: [] });
    }
  },

  sendMessage: (content: string) => {
    const ws = get().ws;
    const text = content.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "send_message", content: text }));
  },
}));
