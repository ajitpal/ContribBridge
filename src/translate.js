// src/translate.js — Lingo.dev SDK wrapper — all 5 SDK methods + error handling
import { LingoDotDevEngine } from 'lingo.dev/sdk';
import { marked } from 'marked';
import TurndownService from 'turndown';

// ─── SDK Instance ────────────────────────────────────────────────
let lingo = null;

/**
 * Initialise the Lingo.dev engine.
 * Call once at server startup; subsequent calls are a no-op.
 */
export async function initLingo() {
  if (lingo) return lingo;

  const apiKey = process.env.LINGODOTDEV_API_KEY;
  const engineId = process.env.LINGO_ENGINE_ID;

  if (!apiKey) {
    throw new Error(
      'LINGODOTDEV_API_KEY is not set. Get one at https://lingo.dev/dashboard'
    );
  }

  lingo = new LingoDotDevEngine({ apiKey, engineId });
  return lingo;
}

// ─── Method 1: detectLocale ──────────────────────────────────────
/**
 * Detect the source language of a text string.
 * Returns ISO 639-1 locale ('zh', 'pt-BR', 'ja', 'hi', …)
 * and a boolean shortcut `isEnglish`.
 */
export async function detectLanguage(text) {
  const engine = lingo ?? (await initLingo());
  const locale = await engine.detectLocale(text);
  return {
    locale,
    isEnglish: locale === 'en' || locale.startsWith('en-'),
  };
}

// ─── Method 2 + 3: localizeText + localizeHtml ───────────────────
/**
 * Translate an entire GitHub issue (title + markdown body).
 *
 * 1. Title  → localizeText  (fast, single-line)
 * 2. Body   → markdown→HTML → localizeHtml (preserves <code> blocks)
 *           → HTML→markdown via Turndown
 */
export async function translateIssue({ title, body, detectedLocale }) {
  const engine = lingo ?? (await initLingo());
  const td = new TurndownService();

  // --- Title ---
  const translatedTitle = await safeTranslate(
    () => engine.localizeText(title, {
      sourceLocale: detectedLocale,
      targetLocale: 'en',
    }),
    title
  );

  // --- Body ---
  let translatedBody = '';
  if (body) {
    const bodyHtml = marked.parse(body);

    const translatedHtml = await safeTranslate(
      () => engine.localizeHtml(bodyHtml, {
        sourceLocale: detectedLocale,
        targetLocale: 'en',
      }),
      bodyHtml
    );

    translatedBody = td.turndown(translatedHtml);
  }

  return { translatedTitle, translatedBody };
}

// ─── Method 4-a: localizeText (EN → contributor locale) ──────────
/**
 * Translate a single maintainer reply from English back to the
 * contributor's language.
 */
export async function translateReply(text, targetLocale) {
  const engine = lingo ?? (await initLingo());
  return await safeTranslate(
    () => engine.localizeText(text, {
      sourceLocale: 'en',
      targetLocale,
    }),
    text
  );
}

// ─── Method 4-b: localizeChat (full thread) ──────────────────────
/**
 * Translate an entire comment thread from EN back to the
 * contributor's locale. Preserves author names.
 */
export async function translateThread(messages, targetLocale) {
  const engine = lingo ?? (await initLingo());
  return await safeTranslate(
    () => engine.localizeChat(
      messages.map((m) => ({ name: m.author, text: m.body })),
      { sourceLocale: 'en', targetLocale }
    ),
    messages.map(m => m.body).join('\n')
  );
}

// ─── Method 5: localizeObject (structured UI/metadata) ───────────
/**
 * Translate a structured object containing multiple strings (e.g. enriched 
 * issue metadata). Preserves keys, translates values.
 */
export async function translateObject(obj, { sourceLocale, targetLocale }) {
  const engine = lingo ?? (await initLingo());
  return await safeTranslate(
    () => engine.localizeObject(obj, {
      sourceLocale,
      targetLocale,
    }),
    obj
  );
}

// ─── Error-handling wrapper ──────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps any async Lingo.dev call with error handling.
 *
 *  • QUOTA_EXCEEDED  → warn + return fallback
 *  • RATE_LIMIT      → wait 1 s + one automatic retry
 *  • Anything else   → log + return fallback
 *
 * Usage:
 *   const title = await safeTranslate(
 *     () => lingo.localizeText(issue.title, { sourceLocale, targetLocale: 'en' }),
 *     issue.title   // fallback: return original if translation fails
 *   );
 */
export async function safeTranslate(fn, fallback = '') {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 'QUOTA_EXCEEDED') {
      console.warn(
        'Lingo.dev quota exceeded — upgrade at https://lingo.dev/pricing'
      );
      return fallback;
    }
    if (err.code === 'RATE_LIMIT') {
      await sleep(1000);
      return await fn(); // one retry
    }
    console.error('Translation error:', err.message);
    return fallback;
  }
}
