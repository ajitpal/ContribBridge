// src/pipeline.js — Main orchestrator: calls every module in sequence
import { detectLanguage, translateIssue, translateReply } from './translate.js';
import { enrichIssue } from './enrich.js';
import { postTranslation, postReplyTranslation } from './github.js';
import { broadcast, broadcastStats } from './dashboard.js';
import { licenseGate } from './middleware/licenseGate.js';
import cache from './cache.js';
import db from './db.js';

// ─── Helper: get all target locales for a repo ──────────────────
function getTargetLocales(repoFullName) {
  const rows = db.prepare('SELECT target_locale FROM repo_locales WHERE repo = ?').all(repoFullName);
  if (rows.length > 0) return rows.map(r => r.target_locale);
  // Fallback to env var or 'en'
  return [process.env.TARGET_LOCALE || 'en'];
}

// ─── Process a new issue ─────────────────────────────────────────
/**
 * Full translation pipeline for a newly opened GitHub issue.
 * Translates into ALL configured target locales for the repo.
 */
export async function processIssue(issue, repo) {
  console.log(`[Pipeline] Starting processing for issue #${issue.number}...`);
  try {
    // 1. Dedup: skip if already translated
    if (cache.has(`issue:${issue.id}`)) return;

    // 2. Gate: check license for private repos
    await licenseGate(repo.full_name, repo.owner?.login);

    // 3. Detect source language
    const { locale } = await detectLanguage(
      issue.title + ' ' + (issue.body || '')
    );

    // 4. Get all configured target locales for this repo
    const targetLocales = getTargetLocales(repo.full_name)
      .filter(tl => tl !== locale && !locale.startsWith(tl + '-'));

    if (targetLocales.length === 0) {
      console.log(`[Pipeline] Issue #${issue.number} is already in all target locales — skipping`);
      return;
    }

    const startMs = Date.now();

    // 5. Translate to each configured target locale
    for (const targetLocale of targetLocales) {
      const { translatedTitle, translatedBody } = await translateIssue({
        ...issue,
        detectedLocale: locale,
        targetLocale,
      });

      // 6. AI enrichment — labels + severity (only once, on first translation)
      const enriched = await enrichIssue({
        title: translatedTitle,
        body: translatedBody,
      });

      enriched.ms = enriched.ms || Date.now() - startMs;

      // 7. Post translated comment back to GitHub
      await postTranslation(repo, issue.number, {
        locale,
        targetLocale,
        translatedTitle,
        translatedBody,
        ...enriched,
      });

      // 8. Broadcast to live dashboard
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
          targetLocale,
          confidence: enriched.confidence,
          labels: enriched.labels,
          severity: enriched.severity,
          translationMs: enriched.ms,
          timestamp: new Date().toISOString(),
        },
      });

      console.log(
        `✓ Translated issue #${issue.number} (${locale} → ${targetLocale}) in ${enriched.ms}ms`
      );
    }

    // 9. Persist to SQLite (store source locale for comment bidirectional lookups)
    db.prepare(
      `INSERT OR REPLACE INTO issues VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      issue.id,
      repo.full_name,
      issue.number,
      locale,
      '', // title stored as empty — multi-locale translations are in comments
      '',
      98,
      new Date().toISOString()
    );

    broadcastStats();

    // 10. Cache the issue so we don't process it again
    cache.set(`issue:${issue.id}`, true, 3600);

  } catch (err) {
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
    console.error(`Pipeline error for issue #${issue?.number}:`, err);
  }
}

// ─── Process a new comment (bidirectional translation) ───────────
/**
 * Bidirectional comment translation with multi-locale support:
 *  A) Comment NOT in any target locale → translate to all configured locales
 *  B) Comment in a configured locale on a tracked issue → translate back to contributor's language
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
    const { locale: commentLocale } =
      await detectLanguage(comment.body);

    const targetLocales = getTargetLocales(repo.full_name);
    const isInTargetLocale = targetLocales.some(
      tl => commentLocale === tl || commentLocale.startsWith(tl + '-')
    );

    // 5. Look up the original issue's detected locale from the DB
    const issueRecord = db
      .prepare('SELECT locale FROM issues WHERE id = ?')
      .get(issue.id);
    const issueOriginalLocale = issueRecord ? issueRecord.locale : null;

    // ─── Unified Multi-Locale Translation Logic ───
    // We want to translate this comment so that:
    // 1. All maintainers can read it (add all targetLocales)
    // 2. The original issue contributor can read it (add issueOriginalLocale)
    const neededLocales = new Set(targetLocales);
    if (issueOriginalLocale) {
      neededLocales.add(issueOriginalLocale);
    }

    // 3. Subtract the language the comment is already written in
    neededLocales.delete(commentLocale);
    for (const loc of neededLocales) {
      if (commentLocale.startsWith(loc + '-')) {
        neededLocales.delete(loc);
      }
    }

    if (neededLocales.size === 0) {
      console.log(`[Comment] No translation needed for comment #${comment.id} on #${issue.number} (locale=${commentLocale}, issueLocale=${issueOriginalLocale || 'untracked'})`);
      return;
    }

    // 4. Translate and post for each required locale
    for (const tl of neededLocales) {
      console.log(`[Comment] Translating comment on #${issue.number} (${commentLocale} → ${tl})`);

      const translatedReply = await translateReply(comment.body, tl, commentLocale);
      
      // Determine direction for UI/logging
      // If the target is the issue's original locale AND it's not a maintainer locale, we assume it's for the contributor
      const isForContributor = tl === issueOriginalLocale && !targetLocales.includes(tl);
      const direction = isForContributor ? 'to-contributor' : 'to-maintainer';

      await postReplyTranslation(repo, issue.number, {
        locale: tl,
        originalLocale: commentLocale,
        originalBody: comment.body,
        translatedBody: translatedReply,
        author: comment.user.login,
        direction,
        commentUrl: comment.html_url,
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
          direction: `${commentLocale} → ${tl}`,
          locale: tl,
          timestamp: new Date().toISOString(),
          commentUrl: comment.html_url,
        },
      });

      console.log(`✓ Translated comment on #${issue.number} (${commentLocale} → ${tl})`);

      // Persist comment to DB for dashboard history/threading
      db.prepare(`
        INSERT OR REPLACE INTO comments (id, repo, issue_number, author, original_body, translated_body, direction, locale, comment_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        comment.id,
        repo.full_name,
        issue.number,
        comment.user.login,
        comment.body,
        translatedReply,
        direction,
        tl,
        comment.html_url,
        new Date().toISOString()
      );
    }

    broadcastStats();
    cache.set(`comment:${comment.id}`, true, 3600);

  } catch (err) {
    console.error(`Pipeline error for comment #${comment?.id}:`, err);
  }
}
