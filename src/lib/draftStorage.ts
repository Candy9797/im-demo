/**
 * 未发送内容（草稿）持久化到 IndexedDB
 * - 按场景 key 存储（如 chat:convId、customer-service），页面恢复时读出并填入输入框，支持继续编辑或发送
 */
const DB_NAME = 'im-demo-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

export interface DraftRecord {
  id: string;
  text: string;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

/** 读取草稿，无则返回 null */
export function getDraft(id: string): Promise<string | null> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        tx.oncomplete = () => {
          db.close();
          const record = req.result as DraftRecord | undefined;
          resolve(record?.text ?? null);
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** 写入草稿（防抖由调用方控制） */
export function setDraft(id: string, text: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          id,
          text,
          updatedAt: Date.now(),
        } as DraftRecord);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** 删除草稿（发送成功后调用） */
export function clearDraft(id: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}
