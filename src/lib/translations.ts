/**
 * 按 locale 取文案：服务端用 getTranslations，客户端用 useTranslations（需 IntlProvider）
 * 仅 shop 等 [locale] 路由使用；文案在 messages/{locale}.json
 */
import { getLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

export type Messages = Record<string, unknown>;

function getNested(obj: unknown, path: string): string | undefined {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    text
  );
}

let messagesCache: Partial<Record<Locale, Messages>> = {};

/** 服务端/布局：加载某 locale 的 messages（可缓存） */
export async function getMessages(locale: string): Promise<Messages> {
  const loc = getLocale(locale);
  if (messagesCache[loc]) return messagesCache[loc] as Messages;
  const mod = await import(`@/messages/${loc}.json`);
  const messages = mod.default as Messages;
  messagesCache[loc] = messages;
  return messages;
}

/** 服务端：按 locale 取 t 函数，namespace 如 'shop' 对应 messages.shop */
export async function getTranslations(
  locale: string,
  namespace: string = 'shop'
): Promise<(key: string, params?: Record<string, string | number>) => string> {
  const messages = await getMessages(locale);
  const ns = getNested(messages, namespace);
  const dict = (typeof ns === 'object' && ns !== null ? ns : {}) as Record<string, string>;

  return (key: string, params?: Record<string, string | number>) => {
    const value = getNested(dict, key) ?? getNested(messages as Record<string, unknown>, `${namespace}.${key}`) ?? key;
    return interpolate(value, params);
  };
}
