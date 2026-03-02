/**
 * WebSocketManager - WebSocket 连接管理
 *
 * 负责 IM 的 WebSocket 连接：建连/断连、收发帧、心跳保活、断线重连、大帧分片，以及浏览器下的页面生命周期联动。
 * 上层 IMClient 使用本类建立长连接并订阅其派发的事件。
 *
 * --- 一、职责概览 ---
 * - 建连/断连：connect() 建立连接，JWT 通过 Sec-WebSocket-Protocol 子协议 ["im-auth", token] 传递；disconnect() 优雅关闭并解绑监听。
 * - 收发帧：send(type, payload) 编码后发送；onmessage 里解码、分片重组后按 type 派发事件（frame_in、message_ack 等）。
 * - 心跳：连接成功后按间隔发 HEARTBEAT_PING，收到 HEARTBEAT_PONG 清掉「等 Pong」超时；超时未收到 Pong 则主动 close 触发重连。
 * - 断线重连：onclose 时若未达最大重连次数则 scheduleReconnect()（指数退避+随机抖动），超限则派发 DISCONNECTED。
 * - 分片：Protobuf 模式下单帧超过 CHUNK_SIZE 时拆成多段发送；收端先收分片元数据再收各 chunk，重组后解码并 handleFrame。
 * - 页面生命周期（仅浏览器）：连接后绑定 visibilitychange（切回前台发一次 Ping）、online（网络恢复立即重连）；disconnect 时解绑。
 *
 * --- 二、连接状态 ---
 * DISCONNECTED 未连接 | CONNECTING 首次/重连中 | CONNECTED 已连接可收发 | RECONNECTING 已断线等待重连定时器。
 * getState() 返回当前状态；connect() 在已是 CONNECTED/CONNECTING 时直接 return，避免重复建连。
 *
 * --- 三、认证与 URL ---
 * Token 不放在 URL 上，通过 new WebSocket(url, ["im-auth", token]) 子协议传递，避免泄露与日志污染。
 * URL 仅带 query：fresh=1 新建会话（不恢复历史）；format=json|protobuf 序列化格式（非 json 时带上）。
 *
 * --- 四、连接建立与关闭 ---
 * connect()：若已 CONNECTED/CONNECTING 则 return；否则 CONNECTING，getWsUrl()，创建 ws，binaryType=arraybuffer。
 *   onopen → CONNECTED、重连次数清零、派发 CONNECTED、startHeartbeat()、bindPageLifecycle()。
 *   onmessage → 按 data 类型转成统一格式后 handleMessage()。
 *   onclose → handleDisconnect()（停心跳、清 Pong 超时；未达重连上限则 scheduleReconnect()，否则派发 DISCONNECTED）。
 *   onerror → 打日志、派发 CONNECTION_ERROR，不断开，由 onclose 统一处理。
 * disconnect()：停止心跳、清除 Pong 超时、取消重连定时器、unbindPageLifecycle()、清空分片状态，ws.close() 置 null，DISCONNECTED 并派发 DISCONNECTED。
 *
 * --- 五、发送与接收 ---
 * send(type, payload)：要求 CONNECTED 且有 ws；构造 Frame(seq 自增、timestamp)，按 format 编码；JSON 不分片直接 send；Protobuf 且体积>CHUNK_SIZE 则先发 createFragMeta 再发各 chunk。
 * handleMessage(data)：string 时 JSON.parse，若 isFragMeta 则初始化 fragmentState 并 return，否则 decodeFrame→handleFrame；ArrayBuffer 时若有 fragmentState 则追加 chunk，收齐后 reassembleChunks→decodeFrame→handleFrame 并清 fragmentState，否则直接 decodeFrame→handleFrame。
 * handleFrame(frame)：按 frame.type 派发 auth_ok、frame_in、message_ack、typing_start/stop、HEARTBEAT_PONG→clearPongTimeout、queue_update、agent_assigned、phase_change、sync_response、session_switched、history_response、presence_update、read_receipt、reaction_update、message_edit、message_recall、kicked、server_error 等，供 IMClient 订阅。
 *
 * --- 六、心跳与「等 Pong」超时 ---
 * startHeartbeat()：按 heartbeatInterval（默认 30s）周期发 HEARTBEAT_PING，每次发完 schedulePongTimeout()。
 * schedulePongTimeout()：设 heartbeatPongTimeoutMs（默认 10s）定时器；若期内收到 HEARTBEAT_PONG 则 clearPongTimeout()；超时未收到 Pong 则主动 ws.close()→onclose→重连。用于检测半开连接（网络已断本地未感知）。
 *
 * --- 七、断线重连 ---
 * handleDisconnect()：停心跳、清 Pong 超时、DISCONNECTED；若 reconnectCount < reconnectAttempts 则 scheduleReconnect()，否则派发 DISCONNECTED 并不再重连。
 * scheduleReconnect()：RECONNECTING、派发 RECONNECTING、reconnectCount++，延迟 min(reconnectInterval*2^reconnectCount + [0,1000) 随机, 30000) ms 后 connect()，指数退避+抖动，最大间隔 30s。
 * online 事件：浏览器 window.online 时，若 RECONNECTING 或 DISCONNECTED 则清重连定时器、reconnectCount=0、立即 connect()，不等待退避。
 *
 * --- 八、分片（Protobuf 大帧）---
 * 发送：format!==json 且体积>CHUNK_SIZE 时 splitIntoChunks，先发 createFragMeta(messageId,totalChunks,format) 再依次发二进制 chunk。
 * 接收：先收分片元数据则创建 fragmentState，后续二进制按序 push 到 chunks，chunks.length>=totalChunks 时 reassembleChunks→decodeFrame→handleFrame，清 fragmentState。
 *
 * --- 九、页面生命周期（仅浏览器）---
 * bindPageLifecycle()：onopen 后若未绑定则 document.visibilitychange→切回可见时若已连接则立即发一次 HEARTBEAT_PING 并 schedulePongTimeout()；window.online→网络恢复时若 RECONNECTING/DISCONNECTED 则立即重连。
 * unbindPageLifecycle()：disconnect() 时移除上述监听。
 *
 * --- 十、默认配置 ---
 * reconnectAttempts 5 | reconnectInterval 1000(ms) | heartbeatInterval 30000(ms) | heartbeatPongTimeoutMs 10000(ms)
 *
 * --- 十一、相关文件 ---
 * 类型与帧：src/sdk/types.ts（ConnectionConfig、ConnectionState、Frame、FrameType、SDKEvent）
 * 编解码与分片：src/sdk/serializer.ts（encodeFrame、decodeFrame、splitIntoChunks、reassembleChunks、createFragMeta、isFragMeta、CHUNK_SIZE）
 * 事件基类：src/sdk/EventEmitter.ts；使用方：IMClient 创建本类、connect/disconnect、send，订阅 frame_in、message_ack、auth_ok 等以更新会话与消息状态。
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

/** --- 十、默认配置：可被传入的 config 覆盖 --- */
const DEFAULT_CONFIG: Partial<ConnectionConfig> = {
  reconnectAttempts: 5,       // 最大重连次数，超过后派发 DISCONNECTED 不再重连
  reconnectInterval: 1000,    // 重连间隔基数（ms），实际间隔为指数退避：base * 2^reconnectCount + 随机 0~1000
  heartbeatInterval: 30000,   // 心跳 Ping 间隔（ms），默认 30 秒
  heartbeatPongTimeoutMs: 10000, // 发 Ping 后若在此时间内未收到 Pong 则主动 close，触发重连
};

/** 分片重组状态：收到分片元数据后创建，按序收集 chunks，收齐后重组为完整帧再解码 */
interface FragmentState {
  messageId: string;
  totalChunks: number;
  format: SerializeFormat;
  chunks: Uint8Array[];
}

/** 生成分片消息 ID，用于多段二进制帧的关联；优先用 crypto.randomUUID，否则降级为时间戳+随机串 */
function generateFragMessageId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `frag-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class WebSocketManager extends EventEmitter {
  // --- 二、连接状态：DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING ---
  private config: ConnectionConfig;
  private format: SerializeFormat;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;  // 定时发 Ping 的 setInterval
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null; // 单次「等 Pong」的超时，超时则 close
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;   // 下一次重连的 setTimeout
  private reconnectCount = 0;       // 当前已重连次数，用于指数退避与上限判断
  private visibilityBound = false; // 是否已绑定 document.visibilitychange（仅浏览器）
  private onlineBound = false;     // 是否已绑定 window.online（仅浏览器）
  private seq = 0;                 // 发帧序列号，每帧自增，用于服务端排序/去重
  private fragmentState: FragmentState | null = null; // 当前正在重组的分片（仅 Protobuf 大帧）

  constructor(config: ConnectionConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.format = this.config.format ?? "json";
  }

  // --- 三、认证与 URL：token 经子协议传，URL 仅带 fresh、format ---
  /** 构造 WebSocket URL：只带 query（fresh、format），不含 token，避免泄露；token 通过子协议传 */
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

  // --- 四、连接建立与关闭 ---
  /**
   * 建立 WebSocket 连接。
   * 已 CONNECTED 或 CONNECTING 时直接 return；否则设为 CONNECTING，创建 ws，JWT 通过 protocols 传入。
   * onopen：置 CONNECTED、重连次数清零、派发 CONNECTED、启动心跳、绑定页面生命周期（visibility/online）。
   * onmessage：根据 data 类型（string/Blob/ArrayBuffer）转成统一格式后 handleMessage（解码 + 分片重组 + handleFrame）。
   * onclose：handleDisconnect（停心跳、清 Pong 超时、未达重连上限则 scheduleReconnect，否则派发 DISCONNECTED）。
   * onerror：仅打日志并派发 CONNECTION_ERROR，不断开逻辑由 onclose 统一处理。
   */
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
   * 优雅断开：停止心跳、清除 Pong 超时、取消未执行的重连定时器、解绑页面生命周期监听、清空分片状态，
   * 然后关闭 WebSocket 并置 null，最后置 DISCONNECTED 并派发 DISCONNECTED 事件。
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

  // --- 五、发送与接收：send 编码/分片，handleMessage 解码/重组，handleFrame 按 type 派发事件 ---
  /**
   * 发送一帧到服务端。需已 CONNECTED 且有 ws，否则抛 "Not connected"。
   * 帧带 seq（自增）、timestamp；按 format 编码后：JSON 模式不分片直接 send；
   * 非 JSON 且体积超过 CHUNK_SIZE 时先发分片元数据（createFragMeta），再依次发各 chunk。
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
   * 处理单条 WebSocket 消息（string 或 ArrayBuffer）。
   * --- 八、分片：string 若为分片元数据则初始化 fragmentState；ArrayBuffer 在 fragmentState 下按序收齐后重组再解码 ---
   * - 若为 string：先 JSON.parse；若为分片元数据（isFragMeta）则初始化 fragmentState 并 return，否则 decodeFrame 后 handleFrame。
   * - 若为 ArrayBuffer：空则 return；若有 fragmentState 则当作一个 chunk 追加，收齐后 reassembleChunks → decodeFrame → handleFrame 并清空 fragmentState；否则直接 decodeFrame → handleFrame。
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

  /** 返回当前连接状态（DISCONNECTED / CONNECTING / CONNECTED / RECONNECTING） */
  getState(): ConnectionState {
    return this.state;
  }

  /** 返回当前已使用的帧序列号（下一帧将用 seq+1），供上层排序或去重用 */
  getCurrentSeq(): number {
    return this.seq;
  }

  // ============ 私有方法 ============

  private setState(state: ConnectionState): void {
    this.state = state;
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  /** 根据服务端帧的 type 派发对应事件（auth_ok、frame_in、message_ack、HEARTBEAT_PONG 清 Pong 超时等） */
  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case FrameType.AUTH_OK:
        this.emit("auth_ok", frame.payload); // 鉴权通过，上层可更新会话等
        break;
      case FrameType.MESSAGE:
        this.emit("frame_in", frame); // 单条或批量消息，IMClient 收后写 store
        break;
      case FrameType.MESSAGE_ACK:
        if (process.env.NODE_ENV === "development") {
          console.log("[WS] message_ack received", Array.isArray(frame.payload) ? frame.payload.length : 1, "acks", frame.payload);
        }
        this.emit("message_ack", frame.payload); // 服务端对发送消息的确认
        break;
      case FrameType.TYPING_START:
        this.emit(SDKEvent.TYPING_START, frame.payload);
        break;
      case FrameType.TYPING_STOP:
        this.emit(SDKEvent.TYPING_STOP, frame.payload);
        break;
      case FrameType.HEARTBEAT_PONG:
        this.clearPongTimeout(); // 收到 Pong 说明连接存活，取消「等 Pong」超时
        break;
      case FrameType.QUEUE_STATUS:
        this.emit("queue_update", frame.payload); // 排队状态变更
        break;
      case FrameType.AGENT_INFO:
        this.emit("agent_assigned", frame.payload); // 分配/更换客服
        break;
      case FrameType.PHASE_CHANGE:
        this.emit("phase_change", frame.payload); // 会话阶段变化
        break;
      case FrameType.SYNC_RESPONSE:
        this.emit("sync_response", frame.payload); // 同步请求的响应
        break;
      case FrameType.SESSION_SWITCHED:
        this.emit("session_switched", frame.payload); // 会话切换结果
        break;
      case FrameType.HISTORY_RESPONSE:
        this.emit("history_response", frame.payload); // 历史消息拉取结果
        break;
      case FrameType.PRESENCE_UPDATE:
        this.emit(SDKEvent.PRESENCE_UPDATE, frame.payload); // 在线状态
        break;
      case FrameType.READ_RECEIPT:
        this.emit(SDKEvent.READ_RECEIPT, frame.payload); // 已读回执
        break;
      case FrameType.REACTION_UPDATE:
        this.emit(SDKEvent.REACTION_UPDATE, frame.payload); // 表情回应
        break;
      case FrameType.MESSAGE_EDIT:
        this.emit(SDKEvent.MESSAGE_EDIT, frame.payload); // 消息编辑
        break;
      case FrameType.MESSAGE_RECALL:
        this.emit(SDKEvent.MESSAGE_RECALL, frame.payload); // 消息撤回
        break;
      case FrameType.KICKED:
        this.emit(SDKEvent.KICKED, frame.payload); // 被踢下线
        break;
      case FrameType.ERROR:
        console.error("[WebSocketManager] Server error:", frame.payload);
        this.emit("server_error", frame.payload);
        break;
      default:
        break;
    }
  }

  // --- 七、断线重连：未达上限则指数退避 scheduleReconnect，online 时立即重连 ---
  /**
   * 连接断开时（onclose 调用）：停止心跳、清除 Pong 超时、置 DISCONNECTED。
   * 若当前重连次数未达 reconnectAttempts 则 scheduleReconnect()；否则派发 DISCONNECTED 并打日志，不再重连。
   */
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

  /**
   * 调度一次重连：置 RECONNECTING、派发 RECONNECTING、reconnectCount+1，
   * 延迟 = min(baseInterval * 2^reconnectCount + [0,1000) 随机, 30000) ms，到期后调用 connect()。
   */
  private scheduleReconnect(): void {
    const baseInterval = this.config.reconnectInterval || 1000;
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

  /** 取消尚未执行的重连定时器（disconnect 或 online 时调用） */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- 六、心跳与「等 Pong」超时：周期 Ping，超时未收到 Pong 则 close 触发重连，检测半开连接 ---
  /**
   * 启动心跳：按 heartbeatInterval 周期发送 HEARTBEAT_PING，每次发完后 schedulePongTimeout；
   * 若在 heartbeatPongTimeoutMs 内未收到 Pong 则 close，从而触发重连。
   */
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

  /** 停止心跳：清除 setInterval 并清除当前 Pong 超时定时器 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimeout();
  }

  /**
   * 设置「等 Pong」超时：在 heartbeatPongTimeoutMs 后若仍 CONNECTED 则主动 ws.close()，
   * 从而触发 onclose → handleDisconnect → 重连，用于检测半开连接。
   */
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

  // --- 九、页面生命周期（仅浏览器）：visibilitychange 切回前台发 Ping，online 立即重连 ---
  /**
   * 仅在浏览器环境：若尚未绑定则绑定 visibilitychange（切回前台发 Ping）和 online（网络恢复立即重连），
   * 避免重复绑定。
   */
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

  /** 移除 visibilitychange 与 online 监听（disconnect 时调用） */
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

  /**
   * 页面从隐藏切回可见时：若当前已连接则立即发一次 HEARTBEAT_PING 并 schedulePongTimeout，
   * 用于快速发现切后台期间断开的连接并触发重连。
   */
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

  /**
   * 浏览器检测到网络恢复（online）时：若当前为 RECONNECTING 或 DISCONNECTED，
   * 则清除重连定时器、将 reconnectCount 置 0，并立即 connect()，不等待退避间隔。
   */
  private _onNetworkOnline = (): void => {
    if (this.state !== ConnectionState.RECONNECTING && this.state !== ConnectionState.DISCONNECTED) return;
    this.clearReconnectTimer();
    this.reconnectCount = 0;
    this.connect();
  };
}
