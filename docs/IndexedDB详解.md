# IndexedDB 详解

> 浏览器内置的异步 NoSQL 数据库，适合存储大量结构化数据。
> 本项目中用于 chatStore 的持久化（chatPersistStorage）。

---

## 一、概述

### 1.1 什么是 IndexedDB？

- **异步**：操作不阻塞主线程，通过回调或 Promise 获取结果
- **容量大**：通常数百 MB 至无限制（取决于磁盘）
- **同源**：每个 origin 独立，不同站点互不访问
- **事务**：支持 readwrite / readonly 事务，保证原子性
- **索引**：可建索引，按 key 或 index 查询

### 1.2 与 localStorage 对比

| 特性 | IndexedDB | localStorage |
|------|-----------|--------------|
| 容量 | 大（百 MB 级） | 约 5MB |
| 异步 | 是 | 否（同步阻塞） |
| 存储类型 | 结构化数据、Blob、File | 仅字符串 |
| 事务 | 支持 | 不支持 |
| 适用 | 大量数据、离线应用 | 少量配置、Token |

---

## 二、核心 API

### 2.1 打开/升级数据库

```javascript
const request = indexedDB.open(dbName, version);
```

| 参数 | 说明 |
|------|------|
| `dbName` | 数据库名，同源下唯一 |
| `version` | 版本号（整数），升级时触发 `onupgradeneeded` |

**事件：**

| 事件 | 说明 |
|------|------|
| `onsuccess` | 打开成功，`request.result` 为 `IDBDatabase` |
| `onerror` | 打开失败，`request.error` 为错误对象 |
| `onupgradeneeded` | 版本变化时触发，在此创建/修改 objectStore、索引 |

```javascript
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  if (!db.objectStoreNames.contains('storeName')) {
    db.createObjectStore('storeName', { keyPath: 'id' });
  }
};
```

---

### 2.2 IDBDatabase（数据库实例）

| 属性/方法 | 说明 |
|-----------|------|
| `name` | 数据库名 |
| `version` | 版本号 |
| `objectStoreNames` | 当前 objectStore 名称集合（DOMStringList） |
| `createObjectStore(name, options?)` | 创建 objectStore（仅 `onupgradeneeded` 内可用） |
| `deleteObjectStore(name)` | 删除 objectStore |
| `transaction(storeNames, mode)` | 创建事务 |
| `close()` | 关闭数据库连接 |

---

### 2.3 Object Store（对象存储）

类似于「表」，存储键值对。

**创建：**

```javascript
db.createObjectStore('users', { keyPath: 'id' });
db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
db.createObjectStore('state', { keyPath: 'key' });
```

| 选项 | 说明 |
|------|------|
| `keyPath` | 主键路径，如 `'id'` 表示对象必须有 `id` 字段 |
| `autoIncrement` | 若 `true`，未提供主键时自动生成递增数字 |

---

### 2.4 IDBTransaction（事务）

| 模式 | 说明 |
|------|------|
| `'readonly'` | 只读，可并发 |
| `'readwrite'` | 读写，通常独占 |
| `'versionchange'` | 结构变更，由 `open()` 升级触发 |

```javascript
const tx = db.transaction(['storeName'], 'readwrite');
tx.objectStore('storeName').put({ key: 'a', value: '1' });
tx.oncomplete = () => console.log('done');
tx.onerror = () => console.error(tx.error);
```

| 属性/方法 | 说明 |
|-----------|------|
| `objectStore(name)` | 获取 objectStore |
| `oncomplete` | 事务成功 |
| `onerror` | 事务失败 |
| `abort()` | 中止事务 |

---

### 2.5 IDBObjectStore 操作

| 方法 | 说明 |
|------|------|
| `add(value)` | 添加，主键已存在则报错 |
| `put(value)` | 添加或更新（upsert） |
| `get(key)` | 按主键读取，返回 `IDBRequest` |
| `getAll(key?, count?)` | 读取多条 |
| `delete(key)` | 按主键删除 |
| `clear()` | 清空 store |
| `createIndex(name, keyPath, options?)` | 创建索引（仅 upgrade 内） |
| `index(name)` | 获取索引，用于 `index.get()` 等 |

```javascript
const store = tx.objectStore('state');
store.put({ key: 'chat', value: JSON.stringify(data) });
const req = store.get('chat');
req.onsuccess = () => console.log(req.result);
```

---

### 2.6 IDBRequest / IDBOpenDBRequest

所有异步操作返回 `IDBRequest`：

| 属性 | 说明 |
|------|------|
| `result` | 成功时结果 |
| `error` | 失败时错误 |
| `readyState` | `'pending'` \| `'done'` |
| `onsuccess` | 成功回调 |
| `onerror` | 失败回调 |

---

### 2.7 IDBCursor（游标）

遍历 objectStore 或 index：

```javascript
const req = store.openCursor();
req.onsuccess = (e) => {
  const cursor = e.target.result;
  if (cursor) {
    console.log(cursor.key, cursor.value);
    cursor.continue(); // 继续下一条
  }
};
```

| 方法 | 说明 |
|------|------|
| `continue(key?)` | 移动到下一条 |
| `advance(count)` | 跳过若干条 |
| `delete()` | 删除当前记录 |
| `update(value)` | 更新当前记录 |

---

### 2.8 IDBIndex（索引）

在 objectStore 上建立索引，按非主键字段查询：

```javascript
store.createIndex('byTime', 'timestamp', { unique: false });
const index = store.index('byTime');
const req = index.getAll(IDBKeyRange.lowerBound(0), 10);
```

---

### 2.9 IDBKeyRange（键范围）

| 方法 | 说明 |
|------|------|
| `IDBKeyRange.only(key)` | 等于 key |
| `IDBKeyRange.lowerBound(key, open?)` | ≥ key（open=true 则 >） |
| `IDBKeyRange.upperBound(key, open?)` | ≤ key |
| `IDBKeyRange.bound(lower, upper, lowerOpen?, upperOpen?)` | 区间 |

---

## 三、Promise 封装示例

原生 API 基于回调，通常封装为 Promise：

```javascript
function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state', { keyPath: 'key' });
      }
    };
  });
}

async function getItem(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function setItem(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

---

## 四、本项目中 chatPersistStorage 的用法

| 操作 | 对应 API |
|------|----------|
| 打开 DB | `indexedDB.open(DB_NAME, DB_VERSION)` |
| 创建 store | `db.createObjectStore(STORE_NAME, { keyPath: 'key' })` |
| 读取 | `tx.objectStore(STORE_NAME).get(name)` → `row?.value` |
| 写入 | `tx.objectStore(STORE_NAME).put({ key, value })` |
| 删除 | `tx.objectStore(STORE_NAME).delete(name)` |
| 防抖 | 项目内对 `setItem` 做 80ms 防抖，减少写入频率 |

---

## 五、注意事项

1. **连接用完要关闭**：`db.close()`，避免连接泄漏
2. **事务自动提交**：无显式 `commit`，回调结束后自动提交
3. **跨标签页**：同一 origin 多标签页共享 DB，`versionchange` 会阻塞其他连接
4. **隐私模式**：部分浏览器隐私模式下 IndexedDB 可能受限
5. **配额**：`navigator.storage.estimate()` 可查询配额使用情况

---

## 参考

- [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [IndexedDB 规范](https://w3c.github.io/IndexedDB/)
