/**
 * chatPersistStorage - Zustand persist 的 IndexedDB 存储引擎
 *
 * ## 功能
 * - 实现 Zustand persist 的 StateStorage 接口，将 chatStore 部分状态持久化到 IndexedDB
 * - 持久化字段：messages、conversationId（与 partialize 一致）
 * - 提供 getPersistedChatState：在 rehydration 未完成时，供 IMClient 直接读取离线消息
 *
 * ## 为何用 IndexedDB 而非 localStorage？
 * - 消息列表可能很大，localStorage 约 5MB 限制，且同步阻塞主线程
 * - IndexedDB 异步、容量大，适合存储较多消息
 *
 * ## 为何 setItem 要防抖？
 * - 每次消息更新（新消息、ACK、编辑、反应等）都会触发 persist 的 setItem
 * - IndexedDB 写入有开销，频繁写入会卡顿、耗电
 * - 防抖 80ms：将短时间内多次更新合并为一次写入，降低 I/O 频率
 *
 * ## 调用关系
 * - chatStore persist 中间件 → createJSONStorage(() => chatPersistStorage)
 * - IMClient auth_ok 收到空消息时 → getPersistedChatState() 读取离线消息展示
 * 
 * 为何需要 getPersistedChatState？
Zustand persist 的 rehydration 是异步的，刚连上时 store 里的 messages 可能还没恢复
服务端又返回空消息
若不从 IndexedDB 读，界面会先显示空列表，等 rehydration 完成才出现历史
通过 getPersistedChatState 直接读 IndexedDB，可以在 rehydration 前就拿到离线消息并展示，减少空白时间

Rehydration 是什么？
Rehydration（补水 / 水合） 是指：把之前持久化到本地存储的状态，重新加载回内存并恢复到应用里的过程。
可以类比：
Dehydration（脱水）：把内存里的 state 序列化后存到 IndexedDB / localStorage
Rehydration（补水）：从 IndexedDB / localStorage 读出并反序列化，还原为内存中的 state
在本项目里
使用 Zustand persist 时：
Dehydration：每次 chatStore 更新，persist 会把选中的 state（如 messages、conversationId）写入 IndexedDB
Rehydration：页面加载时，persist 从 IndexedDB 读取，解析 JSON，再 set 回 store
Rehydration 是异步的，所以在 connect() 刚完成时，可能还没完成从 IndexedDB 的恢复，store 里的 messages 可能暂时为空，这时会用到 getPersistedChatState 直接读 IndexedDB。
词源
英文 “hydrate” = 加水
“Rehydration” = 再次加水，让脱水的东西恢复原状
在状态持久化场景里，指的是把“存起来的数据”还原成“可用的状态”。
 */
const DB_NAME = "web3-im-chat";
const DB_VERSION = 1;
const STORE_NAME = "state";

/** 与 chatStore persist 的 name 一致，用于 getItem/setItem 的 key */
export const CHAT_PERSIST_NAME = "web3-im-chat";

const DEBOUNCE_MS = 80;

/** 打开 IndexedDB 连接，onupgradeneeded 时创建 objectStore */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    // 在这个事件里可以创建或升级 objectStore（表结构）
    // 只有在 onupgradeneeded 里才能执行 createObjectStore 等 schema 修改
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
  });
}

/** 防抖缓冲：待写入的值，多次 setItem 会覆盖为最新 */
let pendingKey: string | null = null;
let pendingValue: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将 pending 写入 IndexedDB，写入后清空 pending
 * 由 setItem 的 setTimeout 触发，或 getPersistedChatState 主动调用（保证读到最新）
 */
async function flushWrite(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const key = pendingKey;
  const value = pendingValue;
  pendingKey = null;
  pendingValue = null;
  if (key === null || value === null) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key, value });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Zustand persist 的 StateStorage 实现
 * persist 中间件在初始化和每次 state 变化时调用 getItem/setItem
 */
export const chatPersistStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(name);
      req.onsuccess = () => {
        db.close();
        const row = req.result as { key: string; value: string } | undefined;
        resolve(row?.value ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * 防抖写入：更新 pending，80ms 内无新调用时才真正写入 IndexedDB
   * 若已有 timer，仅更新 pending，不重置 timer
   * setItem 被调用
  → 更新 pendingKey / pendingValue（只改内存，不立刻写库）
  → 启动 80ms 定时器
  → 80ms 内没有新的 setItem
  → 定时器触发 → flushWrite()
  → 把 pending 里的 key/value 写入 IndexedDB
  → 清空 pending
   */
  setItem: async (name: string, value: string): Promise<void> => {
    pendingKey = name;
    pendingValue = value;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushWrite().catch(() => {});
    }, DEBOUNCE_MS);
  },

  /**
   * 删除持久化数据（如 destroy 时）
   * 取消未执行的 flush，清空 pending，同步删除 DB 中的 key
   *  flush 就是把暂存在内存里的待写入数据真正写入 IndexedDB。
   *  flush = flushWrite = 把 pending 里的内容落盘到 IndexedDB。
   */
  removeItem: async (name: string): Promise<void> => {
    if (flushTimer) {
      // 在 removeItem 里做 clearTimeout(flushTimer)，让这个 timer 不再执行
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingValue = null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      // 按主键 name 删除记录 在 IndexedDB 里执行 delete(name)，删除对应记录
      tx.objectStore(STORE_NAME).delete(name);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },
};

/**
 * 持久化状态的子集，与 chatStore persist partialize 一致
 * 仅 messages、conversationId 需要离线恢复
 */
export interface PersistedChatState {
  messages: Array<Record<string, unknown>>;
  conversationId: string;
}

/**
 * 读取已持久化的 chat 状态
 *
 * ## 使用场景
 * - IMClient 连接成功后，auth_ok 返回空消息列表（服务端无历史或未同步）
 * - Zustand persist 的 rehydration 可能尚未完成，store 里 messages 还是空的
 * - 此时可直接从 IndexedDB 读取，展示离线消息，避免空白
 *
 * ## 实现
 * - 若有 pending 未写入，先 flush，确保读到最新
 * - 解析 JSON，校验 messages 为数组、conversationId 为字符串
 */
export async function getPersistedChatState(): Promise<PersistedChatState | null> {
  // 先 flush 未写入的缓冲，保证读到最新
  if (pendingValue !== null && flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    await flushWrite();
  }
  const raw = await chatPersistStorage.getItem(CHAT_PERSIST_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: PersistedChatState };
    const state = parsed?.state;
    if (
      state &&
      Array.isArray(state.messages) &&
      typeof state.conversationId === "string"
    ) {
      return state;
    }
  } catch {
    // ignore parse error
  }
  return null;
}
