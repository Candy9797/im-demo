/**
 * WebSocketManager - WebSocket 连接管理
 *
 * 职责：建立/关闭连接、收发帧、心跳保活、断线指数退避重连
 * 认证：JWT 通过 Sec-WebSocket-Protocol 头传递（子协议 ["im-auth", token]），避免 URL 泄露；支持 &fresh=1 新建会话
 */

import { EventEmitter } from "./EventEmitter";
import {
  type ConnectionConfig,
  ConnectionState,
  type Frame,
  FrameType,
  SDKEvent,
} from "./types";
import {
  encodeFrame,
  decodeFrame,
  CHUNK_SIZE,
  createFragMeta,
  isFragMeta,
  splitIntoChunks,
  reassembleChunks,
  type SerializeFormat,
} from "./serializer";

/** 默认连接配置 */
const DEFAULT_CONFIG: Partial<ConnectionConfig> = {
  reconnectAttempts: 5,     // 最大重连次数
  reconnectInterval: 1000,  // 重连间隔基数（指数退避）
  heartbeatInterval: 30000, // 每 30 秒发一次 Ping
  heartbeatPongTimeoutMs: 10000, // Ping 后未在此时限内收到 Pong 则断开重连
};

/** 分片重组状态 */
interface FragmentState {
  messageId: string;
  totalChunks: number;
  format: SerializeFormat;
  chunks: Uint8Array[];
}

function generateFragMessageId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `frag-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class WebSocketManager extends EventEmitter {
  private config: ConnectionConfig;
  private format: SerializeFormat;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount = 0;  // 当前重连次数
  private visibilityBound = false; // 是否已绑定页面可见性（仅浏览器）
  private onlineBound = false;    // 是否已绑定网络在线事件（仅浏览器）
  private seq = 0;             // 帧序列号（发帧时自增）
  private fragmentState: FragmentState | null = null;

  constructor(config: ConnectionConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.format = this.config.format ?? "json";
  }

  /** 构造 WebSocket URL，仅附带 fresh、format（不含 token，避免 URL 泄露） */
  private getWsUrl(): string {
    const base = this.config.url.replace(/\/$/, "");
    const fresh = (this.config as ConnectionConfig & { fresh?: boolean }).fresh;
    const params = new URLSearchParams();
    if (fresh) params.set("fresh", "1");
    const format = this.config.format;
    if (format && format !== "json") params.set("format", format);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** 建立 WebSocket 连接，已连接/连接中时直接返回；JWT 通过 Sec-WebSocket-Protocol 传递 */
  connect(): void {
    if (
      this.state === ConnectionState.CONNECTED ||
      this.state === ConnectionState.CONNECTING
    ) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    try {
      const url = this.getWsUrl();
      const token = this.config.token;
      const protocols = token ? ["im-auth", token] : undefined;
      this.ws = new WebSocket(url, protocols);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.setState(ConnectionState.CONNECTED);
        this.reconnectCount = 0;
        this.emit(SDKEvent.CONNECTED);
        this.startHeartbeat();
        this.bindPageLifecycle();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data instanceof Blob) {
          data.arrayBuffer().then((ab) => {
            try {
              this.handleMessage(ab);
            } catch (err) {
              console.error("[WebSocketManager] Failed to parse frame (from Blob):", err);
            }
          }).catch((err) =>
            console.error("[WebSocketManager] Blob.arrayBuffer failed", err),
          );
          return;
        }
        try {
          this.handleMessage(data);
        } catch (err) {
          const info =
            typeof data === "string"
              ? `string length ${data.length}`
              : `binary length ${(data as ArrayBuffer)?.byteLength ?? 0}`;
          console.error("[WebSocketManager] Failed to parse frame:", err, info);
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[WebSocketManager] WebSocket error:", error);
        this.emit(SDKEvent.CONNECTION_ERROR, error);
      };
    } catch (err) {
      console.error("[WebSocketManager] Failed to create WebSocket:", err);
      this.handleDisconnect();
    }
  }

  /**
   * 优雅断开：停止心跳、取消重连、关闭 ws、派发 DISCONNECTED
   */
  disconnect(): void {
    this.stopHeartbeat();
    this.clearPongTimeout();
    this.clearReconnectTimer();
    this.unbindPageLifecycle();
    this.fragmentState = null;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState(ConnectionState.DISCONNECTED);
    this.emit(SDKEvent.DISCONNECTED);
  }

  /**
   * 发送一帧到服务端（需已连接）
   */
  send(type: FrameType, payload: unknown): Frame {
    const frame: Frame = {
      type,
      seq: this.nextSeq(),
      timestamp: Date.now(),
      payload,
    };

    if (this.state !== ConnectionState.CONNECTED || !this.ws) {
      throw new Error("Not connected");
    }

    const encoded = encodeFrame(frame, this.format);
    const size =
      typeof encoded === "string"
        ? new TextEncoder().encode(encoded).length
        : encoded.byteLength;
    // JSON 模式下不分片，全程走文本帧，便于调试与限流统计
    if (this.format !== "json" && size > CHUNK_SIZE) {
      const { chunks, totalChunks } = splitIntoChunks(encoded);
      const messageId = generateFragMessageId();
      this.ws.send(createFragMeta(messageId, totalChunks, this.format));
      for (const chunk of chunks) {
        this.ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
      }
    } else {
      this.ws.send(encoded);
    }
    return frame;
  }

  /**
   * 处理单条 WebSocket 消息：完整帧或分片元数据/分片数据
   */
  private handleMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      const parsed = JSON.parse(data) as unknown;
      if (isFragMeta(parsed)) {
        this.fragmentState = {
          messageId: parsed.payload.messageId,
          totalChunks: parsed.payload.totalChunks,
          format: parsed.payload.format,
          chunks: [],
        };
        return;
      }
      const frame = decodeFrame(data, this.format);
      this.handleFrame(frame);
      return;
    }
    if (data.byteLength === 0) {
      return;
    }
    const buf = new Uint8Array(data);
    if (this.fragmentState) {
      this.fragmentState.chunks.push(buf);
      if (this.fragmentState.chunks.length >= this.fragmentState.totalChunks) {
        const reassembled = reassembleChunks(this.fragmentState.chunks);
        const format = this.fragmentState.format;
        this.fragmentState = null;
        const frame = decodeFrame(reassembled, format);
        this.handleFrame(frame);
      }
      return;
    }
    const frame = decodeFrame(data, this.format);
    if (frame.type === "message" && process.env.NODE_ENV === "development") {
      const n = Array.isArray(frame.payload) ? frame.payload.length : 1;
      console.log("[WS] 收到 message 帧(Protobuf)，条数:", n);
    }
    this.handleFrame(frame);
  }

  /** 获取当前连接状态 */
  getState(): ConnectionState {
    return this.state;
  }

  /** 获取当前帧序列号（用于排序与去重） */
  getCurrentSeq(): number {
    return this.seq;
  }

  // ============ 私有方法 ============

  /** 更新连接状态（内部用） */
  private setState(state: ConnectionState): void {
    this.state = state;
  }

  /** 获取下一序列号并自增 */
  private nextSeq(): number {
    return ++this.seq;
  }

  /** 处理服务端下发的帧，按 type 派发对应事件 */
  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.AUTH_OK:
        this.emit("auth_ok", frame.payload);
        break;
      case FrameType.MESSAGE:
        this.emit("frame_in", frame);
        break;
      case FrameType.MESSAGE_ACK:
        if (process.env.NODE_ENV === "development") {
          console.log("[WS] message_ack received", Array.isArray(frame.payload) ? frame.payload.length : 1, "acks", frame.payload);
        }
        this.emit("message_ack", frame.payload);
        break;
      case FrameType.TYPING_START:
        this.emit(SDKEvent.TYPING_START, frame.payload);
        break;
      case FrameType.TYPING_STOP:
        this.emit(SDKEvent.TYPING_STOP, frame.payload);
        break;
      case FrameType.HEARTBEAT_PONG:
        this.clearPongTimeout();
        break;
      case FrameType.QUEUE_STATUS:
        this.emit("queue_update", frame.payload);
        break;
      case FrameType.AGENT_INFO:
        this.emit("agent_assigned", frame.payload);
        break;
      case FrameType.PHASE_CHANGE:
        this.emit("phase_change", frame.payload);
        break;
      case FrameType.SYNC_RESPONSE:
        this.emit("sync_response", frame.payload);
        break;
      case FrameType.SESSION_SWITCHED:
        this.emit("session_switched", frame.payload);
        break;
      case FrameType.HISTORY_RESPONSE:
        this.emit("history_response", frame.payload);
        break;
      case FrameType.PRESENCE_UPDATE:
        this.emit(SDKEvent.PRESENCE_UPDATE, frame.payload);
        break;
      case FrameType.READ_RECEIPT:
        this.emit(SDKEvent.READ_RECEIPT, frame.payload);
        break;
      case FrameType.REACTION_UPDATE:
        this.emit(SDKEvent.REACTION_UPDATE, frame.payload);
        break;
      case FrameType.MESSAGE_EDIT:
        this.emit(SDKEvent.MESSAGE_EDIT, frame.payload);
        break;
      case FrameType.MESSAGE_RECALL:
        this.emit(SDKEvent.MESSAGE_RECALL, frame.payload);
        break;
      case FrameType.KICKED:
        this.emit(SDKEvent.KICKED, frame.payload);
        break;
      case FrameType.ERROR:
        console.error("[WebSocketManager] Server error:", frame.payload);
        this.emit("server_error", frame.payload);
        break;
      default:
        break;
    }
  }

  /** 连接断开时：停止心跳、清除 Pong 超时，未达上限则 scheduleReconnect，否则派发 DISCONNECTED */
  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.clearPongTimeout();
    this.setState(ConnectionState.DISCONNECTED);

    if (this.reconnectCount < (this.config.reconnectAttempts || 5)) {
      this.scheduleReconnect();
    } else {
      this.emit(SDKEvent.DISCONNECTED);
      console.error("[WebSocketManager] Max reconnect attempts reached");
    }
  }

  /** 调度重连：指数退避 + 随机抖动，最大间隔 30s */
  private scheduleReconnect(): void {
    const baseInterval = this.config.reconnectInterval || 1000;
    // Exponential backoff with jitter
    const delay = Math.min(
      baseInterval * Math.pow(2, this.reconnectCount) + Math.random() * 1000,
      30000
    );

    this.setState(ConnectionState.RECONNECTING);
    this.emit(SDKEvent.RECONNECTING);
    this.reconnectCount++;

    console.log(
      `[WebSocketManager] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /** 清除重连定时器 */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** 启动心跳：按 heartbeatInterval 定时发送 Ping，并设 Pong 超时以检测半开连接 */
  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.CONNECTED && this.ws) {
        try {
          this.send(FrameType.HEARTBEAT_PING, { ts: Date.now() });
          this.schedulePongTimeout();
        } catch {
          // send 可能因连接已断抛错，忽略
        }
      }
    }, interval);
  }

  /** 停止心跳定时器 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimeout();
  }

  /** Pong 超时：Ping 发出后未在限定时间内收到 Pong 则主动关闭连接，触发 onclose → 重连 */
  private schedulePongTimeout(): void {
    this.clearPongTimeout();
    const ms = this.config.heartbeatPongTimeoutMs ?? 10000;
    this.pongTimeoutTimer = setTimeout(() => {
      this.pongTimeoutTimer = null;
      if (this.state === ConnectionState.CONNECTED && this.ws) {
        console.warn("[WebSocketManager] Heartbeat Pong timeout, closing connection");
        this.ws.close();
      }
    }, ms);
  }

  private clearPongTimeout(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  /** 仅浏览器：绑定页面可见性、网络在线事件，用于切后台恢复与断网恢复 */
  private bindPageLifecycle(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (this.visibilityBound && this.onlineBound) return;

    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }
    if (!this.onlineBound) {
      this.onlineBound = true;
      window.addEventListener("online", this._onNetworkOnline);
    }
  }

  private unbindPageLifecycle(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (this.visibilityBound) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this.visibilityBound = false;
    }
    if (this.onlineBound) {
      window.removeEventListener("online", this._onNetworkOnline);
      this.onlineBound = false;
    }
  }

  /** 切回前台：立即发一次 Ping，用 Pong 超时检测连接是否仍有效 */
  private _onVisibilityChange = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (this.state !== ConnectionState.CONNECTED || !this.ws) return;
    try {
      this.send(FrameType.HEARTBEAT_PING, { ts: Date.now() });
      this.schedulePongTimeout();
    } catch {
      // 已断则忽略，onclose 会触发重连
    }
  };

  /** 网络恢复：立即重连，不等待退避间隔 */
  private _onNetworkOnline = (): void => {
    if (this.state !== ConnectionState.RECONNECTING && this.state !== ConnectionState.DISCONNECTED) return;
    this.clearReconnectTimer();
    this.reconnectCount = 0;
    this.connect();
  };
}
