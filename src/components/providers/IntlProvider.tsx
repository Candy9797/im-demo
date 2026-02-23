'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { Locale } from '@/lib/i18n';
import type { Messages } from '@/lib/translations';

type IntlContextValue = { locale: Locale; messages: Messages };

const IntlContext = createContext<IntlContextValue | null>(null);

export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <IntlContext.Provider value={value}>{children}</IntlContext.Provider>;
}

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

/** 客户端：取 t 函数，namespace 默认 'shop' */
export function useTranslations(namespace: string = 'shop'): (key: string, params?: Record<string, string | number>) => string {
  const ctx = useContext(IntlContext);
  return useMemo(() => {
    if (!ctx) {
      return (key: string) => key;
    }
    const ns = getNested(ctx.messages, namespace);
    const dict = (typeof ns === 'object' && ns !== null ? ns : {}) as Record<string, string>;
    return (key: string, params?: Record<string, string | number>) => {
      const value = getNested(dict, key) ?? key;
      return interpolate(value, params);
    };
  }, [ctx, namespace]);
}
