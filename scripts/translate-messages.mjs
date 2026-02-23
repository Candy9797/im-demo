#!/usr/bin/env node
/**
 * 文案 i18n：只维护 src/messages/zh.json，运行后生成 en.json 等
 *
 * 使用：npm run i18n:translate
 * - 未配置 key：按 zh 结构生成 en.json（内容与 zh 相同），可手动改英文或后续配置 key 再跑
 * - 自配置 key 后：自动调用翻译接口生成英文
 * 可选环境变量：
 *   TRANSLATE_SOURCE=zh    源语言（默认 zh）
 *   TRANSLATE_TARGETS=en   目标语言，逗号分隔（默认 en）
 *   LIBRE_TRANSLATE_API_KEY  LibreTranslate key（自申请）
 *   LIBRE_TRANSLATE_URL=   自建实例（默认 https://libretranslate.com）
 *   DEEPL_AUTH_KEY=        DeepL key（自申请）
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MESSAGES_DIR = join(ROOT, 'src', 'messages');

const sourceLocale = process.env.TRANSLATE_SOURCE || 'zh';
const targetLocales = (process.env.TRANSLATE_TARGETS || 'en').split(',').map((s) => s.trim());
const libreUrl = process.env.LIBRE_TRANSLATE_URL || 'https://libretranslate.com';
const libreKey = process.env.LIBRE_TRANSLATE_API_KEY;
const deeplKey = process.env.DEEPL_AUTH_KEY;

const SOURCE_LANG = sourceLocale === 'zh' ? 'zh' : sourceLocale;
const TARGET_MAP = { en: 'en', zh: 'zh' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 保护占位符：把 {id} {count} 等替换成占位，翻译后再还原 */
function protectPlaceholders(text) {
  const placeholders = [];
  const replaced = text.replace(/\{[^}]+\}/g, (m) => {
    const i = placeholders.length;
    placeholders.push(m);
    return `__PLACEHOLDER_${i}__`;
  });
  return { replaced, placeholders };
}

function restorePlaceholders(text, placeholders) {
  return placeholders.reduce((acc, p, i) => acc.replace(`__PLACEHOLDER_${i}__`, p), text);
}

async function translateLibre(text, from, to) {
  const body = { q: text, source: from, target: to };
  if (libreKey) body.api_key = libreKey;
  const res = await fetch(`${libreUrl}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LibreTranslate error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.translatedText;
}

async function translateDeepL(text, from, to) {
  const lang = to.toUpperCase();
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `DeepL-Auth-Key ${deeplKey}`,
    },
    body: new URLSearchParams({
      text,
      source_lang: from === 'zh' ? 'ZH' : from.toUpperCase(),
      target_lang: lang,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepL error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.translations?.[0]?.text ?? text;
}

async function translateOne(text, from, to) {
  const { replaced, placeholders } = protectPlaceholders(text);
  const translated = deeplKey
    ? await translateDeepL(replaced, from, to)
    : await translateLibre(replaced, from, to);
  return restorePlaceholders(translated, placeholders);
}

async function walkAndTranslate(obj, from, to, translate) {
  if (typeof obj === 'string') {
    return translate(obj, from, to);
  }
  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item) => walkAndTranslate(item, from, to, translate)));
  }
  if (obj !== null && typeof obj === 'object') {
    const entries = await Promise.all(
      Object.entries(obj).map(async ([k, v]) => [k, await walkAndTranslate(v, from, to, translate)])
    );
    return Object.fromEntries(entries);
  }
  return obj;
}

async function translateObject(obj, from, to) {
  const translate = async (text, fromLang, toLang) => {
    if (!text || typeof text !== 'string') return text;
    await sleep(300);
    return translateOne(text, fromLang, toLang);
  };
  return walkAndTranslate(obj, from, to, translate);
}

/** 深拷贝 JSON，不翻译 */
function copyStructure(obj) {
  if (typeof obj === 'string' || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(copyStructure);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = copyStructure(v);
  return out;
}

async function main() {
  const sourcePath = join(MESSAGES_DIR, `${sourceLocale}.json`);
  let source;
  try {
    source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (e) {
    console.error('Failed to read source:', sourcePath, e.message);
    process.exit(1);
  }

  const hasKey = !!(deeplKey || libreKey);

  for (const target of targetLocales) {
    if (target === sourceLocale) continue;
    if (hasKey) {
      console.log(`Translating ${sourceLocale} -> ${target}...`);
      try {
        const translated = await translateObject(source, SOURCE_LANG, TARGET_MAP[target] || target);
        const outPath = join(MESSAGES_DIR, `${target}.json`);
        writeFileSync(outPath, JSON.stringify(translated, null, 0), 'utf8');
        console.log('Written:', outPath);
      } catch (e) {
        console.error('Error for', target, e.message);
      }
    } else {
      const outPath = join(MESSAGES_DIR, `${target}.json`);
      writeFileSync(outPath, JSON.stringify(copyStructure(source), null, 0), 'utf8');
      console.log('No API key: wrote', outPath, '(same content as source, edit manually or set LIBRE_TRANSLATE_API_KEY / DEEPL_AUTH_KEY)');
    }
  }
}

main();
