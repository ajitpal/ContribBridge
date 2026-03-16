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
 * When a maintainer replies in English, translate the reply back to
 * the contributor's original language and post it as a follow-up comment.
 */
export async function processComment(comment, issue, repo) {
  try {
    // 1. Skip bot comments to avoid infinite loops
    // GitHub Apps have type 'Bot'; PATs have type 'User'
    if (comment.user.type === 'Bot') return;
    
    // 2. Strict brand check: ignore any comment containing our signature
    if (comment.body.includes('ContribBridge')) {
      return;
    }

    // 3. Skip if the comment is from the issue author (contributor)
    // We only want to translate replies from maintainers BACK to the contributor.
    if (comment.user.id === issue.user.id) {
      return;
    }

    // Dedup check
    if (cache.has(`comment:${comment.id}`)) return;

    // Detect language of the comment
    const { locale: commentLocale, isEnglish: commentIsEnglish } =
      await detectLanguage(comment.body);

    // We only translate English comments back to the issue author's language
    if (!commentIsEnglish) return;

    // Look up the original issue's detected locale from the DB
    const issueRecord = db
      .prepare('SELECT locale FROM issues WHERE id = ?')
      .get(issue.id);

    if (!issueRecord || issueRecord.locale === 'en') return;

    const targetLocale = issueRecord.locale;

    // Translate the English reply back to the contributor's language
    const translatedReply = await translateReply(comment.body, targetLocale);

    // Post translated reply back to GitHub
    await postReplyTranslation(repo, issue.number, {
      locale: targetLocale,
      originalBody: comment.body,
      translatedBody: translatedReply,
      author: comment.user.login,
    });

    // Broadcast to live dashboard
    broadcast({
      type: 'comment',
      data: {
        id: comment.id,
        issueNumber: issue.number,
        repo: repo.full_name,
        author: comment.user.login,
        originalBody: comment.body,
        translatedBody: translatedReply,
        locale: targetLocale,
        timestamp: new Date().toISOString()
      },
    });
    broadcastStats();

    cache.set(`comment:${comment.id}`, true, 3600);

    console.log(
      `✓ Translated reply on issue #${issue.number} (en → ${targetLocale})`
    );
  } catch (err) {
    console.error(`Pipeline error for comment #${comment?.id}:`, err);
  }
}
