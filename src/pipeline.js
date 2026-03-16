// src/pipeline.js — Main orchestrator: calls every module in sequence
import { detectLanguage, translateIssue, translateReply } from './translate.js';
import { enrichIssue } from './enrich.js';
import { postTranslation, postReplyTranslation } from './github.js';
import { broadcast, broadcastStats } from './dashboard.js';
import { licenseGate } from './middleware/licenseGate.js';
import cache from './cache.js';
import db from './db.js';

// ─── Process a new issue ─────────────────────────────────────────
/**
 * Full translation pipeline for a newly opened GitHub issue.
 *
 *  1. Dedup check (cache)
 *  2. License gate (public = free, private = license)
 *  3. Detect source language
 *  4. Skip if English
 *  5. Translate title + body via Lingo.dev SDK
 *  6. AI enrichment (labels, severity)
 *  7. Post translated comment back to GitHub
 *  8. Persist to SQLite
 *  9. Broadcast to live dashboard
 * 10. Cache the issue ID
 */
export async function processIssue(issue, repo) {
  console.log(`[Pipeline] Starting processing for issue #${issue.number}...`);
  try {
    // 1. Dedup: skip if already translated
    if (cache.has(`issue:${issue.id}`)) return;

    // 2. Gate: check license for private repos
    await licenseGate(repo.full_name, repo.owner?.login);

    // 3. Detect source language
    const { locale, isEnglish } = await detectLanguage(
      issue.title + ' ' + (issue.body || '')
    );

    // 4. Skip if already English — nothing to translate
    if (isEnglish) return;

    const startMs = Date.now();

    // 5. Translate title + body via Lingo.dev SDK
    const { translatedTitle, translatedBody } = await translateIssue({
      ...issue,
      detectedLocale: locale,
    });

    // 6. AI enrichment — labels + severity
    const enriched = await enrichIssue({
      title: translatedTitle,
      body: translatedBody,
    });

    // Add translation timing
    enriched.ms = enriched.ms || Date.now() - startMs;

    // 7. Post translated comment back to GitHub
    await postTranslation(repo, issue.number, {
      locale,
      translatedTitle,
      translatedBody,
      ...enriched,
    });

    // 8. Persist to SQLite
    db.prepare(
      `INSERT OR REPLACE INTO issues VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      issue.id,
      repo.full_name,
      issue.number,
      locale,
      translatedTitle,
      translatedBody,
      enriched.confidence,
      new Date().toISOString()
    );

    // 9. Broadcast to live dashboard
    broadcast({
      type: 'issue',
      data: {
        id: issue.id,
        number: issue.number,
        repo: repo.full_name,
        author: issue.user.login,
        originalTitle: issue.title,
        originalBody: issue.body,
        translatedTitle,
        translatedBody,
        detectedLocale: locale,
        confidence: enriched.confidence,
        labels: enriched.labels,
        severity: enriched.severity,
        translationMs: enriched.ms,
        timestamp: new Date().toISOString(),
      },
    });
    broadcastStats();

    // 10. Cache the issue so we don't process it again
    cache.set(`issue:${issue.id}`, true, 3600);

    console.log(
      `✓ Translated issue #${issue.number} (${locale} → en) in ${enriched.ms}ms`
    );
  } catch (err) {
    // License gate throws structured error objects
    if (err.code === 'NO_LICENSE' || err.code === 'INVALID_LICENSE') {
      console.warn(`License gate blocked: [${err.code}] ${err.message || err.reason}`);
      return;
    }
    if (err.code === 'QUOTA_EXCEEDED') {
      console.warn(
        `Quota exceeded for tier "${err.tier}": ${err.used}/${err.limit} words`
      );
      return;
    }
    // Unexpected errors — log but don't crash the server
    console.error(`Pipeline error for issue #${issue?.number}:`, err);
  }
}

// ─── Process a new comment (bidirectional translation) ───────────
/**
 * Bidirectional comment translation:
 *  A) Contributor comments in non-English → translate to English
 *  B) Maintainer replies in English → translate back to contributor's language
 */
export async function processComment(comment, issue, repo) {
  try {
    // 1. Skip bot comments to avoid infinite loops
    if (comment.user.type === 'Bot') {
      console.log(`[Comment] Skipping bot comment #${comment.id}`);
      return;
    }
    
    // 2. Strict brand check: ignore any comment containing our signature
    if (comment.body.includes('ContribBridge')) {
      console.log(`[Comment] Skipping our own translated comment #${comment.id}`);
      return;
    }

    // 3. Dedup check
    if (cache.has(`comment:${comment.id}`)) {
      console.log(`[Comment] Skipping duplicate comment #${comment.id}`);
      return;
    }

    // 4. Detect language of the comment
    const { locale: commentLocale, isEnglish: commentIsEnglish } =
      await detectLanguage(comment.body);

    const isContributor = comment.user.id === issue.user.id;

    // 5. Look up the original issue's detected locale from the DB
    const issueRecord = db
      .prepare('SELECT locale FROM issues WHERE id = ?')
      .get(issue.id);

    // ─── Path A: Contributor follow-up comment (non-English → English) ───
    if (isContributor && !commentIsEnglish) {
      console.log(`[Comment] Translating contributor comment on #${issue.number} (${commentLocale} → en)`);

      const translatedReply = await translateReply(comment.body, 'en', commentLocale);

      await postReplyTranslation(repo, issue.number, {
        locale: commentLocale,
        originalBody: comment.body,
        translatedBody: translatedReply,
        author: comment.user.login,
        direction: 'to-english',
      });

      broadcast({
        type: 'comment',
        data: {
          id: comment.id,
          issueNumber: issue.number,
          repo: repo.full_name,
          author: comment.user.login,
          originalBody: comment.body,
          translatedBody: translatedReply,
          direction: `${commentLocale} → en`,
          locale: commentLocale,
          timestamp: new Date().toISOString(),
        },
      });
      broadcastStats();
      cache.set(`comment:${comment.id}`, true, 3600);

      console.log(`✓ Translated contributor comment on #${issue.number} (${commentLocale} → en)`);
      return;
    }

    // ─── Path B: Maintainer reply in English → contributor's language ────
    if (!isContributor && commentIsEnglish) {
      if (!issueRecord || issueRecord.locale === 'en') {
        console.log(`[Comment] Skipping English reply on #${issue.number} — original issue is English or not tracked`);
        return;
      }

      const targetLocale = issueRecord.locale;
      console.log(`[Comment] Translating maintainer reply on #${issue.number} (en → ${targetLocale})`);

      const translatedReply = await translateReply(comment.body, targetLocale);

      await postReplyTranslation(repo, issue.number, {
        locale: targetLocale,
        originalBody: comment.body,
        translatedBody: translatedReply,
        author: comment.user.login,
        direction: 'to-contributor',
      });

      broadcast({
        type: 'comment',
        data: {
          id: comment.id,
          issueNumber: issue.number,
          repo: repo.full_name,
          author: comment.user.login,
          originalBody: comment.body,
          translatedBody: translatedReply,
          direction: `en → ${targetLocale}`,
          locale: targetLocale,
          timestamp: new Date().toISOString(),
        },
      });
      broadcastStats();
      cache.set(`comment:${comment.id}`, true, 3600);

      console.log(`✓ Translated maintainer reply on #${issue.number} (en → ${targetLocale})`);
      return;
    }

    // ─── No translation needed ───────────────────────────────────────
    console.log(`[Comment] No translation needed for comment #${comment.id} on #${issue.number} (contributor=${isContributor}, english=${commentIsEnglish})`);

  } catch (err) {
    console.error(`Pipeline error for comment #${comment?.id}:`, err);
  }
}
