// src/github.js — Octokit integration: Webhook registration + Post translation
import { Octokit } from '@octokit/rest';

// Note: Ensure GITHUB_TOKEN is in .env or passed via environment
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/**
 * Register a GitHub webhook programmatically on a repository.
 * Requires GITHUB_WEBHOOK_SECRET and WEBHOOK_URL in .env.
 */
export async function registerWebhook(repoFullName, webhookUrl) {
  const [owner, repo] = repoFullName.split('/');
  const finalUrl = webhookUrl || `${process.env.WEBHOOK_URL}/webhook/github`;
  
  try {
    // 1. Try to create the webhook
    const { data } = await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: finalUrl,
        content_type: 'json',
        secret: process.env.GITHUB_WEBHOOK_SECRET,
      },
      events: ['issues', 'issue_comment'],
      active: true,
    });
    console.log(`✓ Webhook registered for ${repoFullName} (ID: ${data.id})`);
    return data;
  } catch (err) {
    // 2. If it already exists (422), synchronise it
    if (err.status === 422) {
      console.warn(`! Webhook already exists for ${repoFullName}. Synchronizing configuration...`);
      
      // Fetch all hooks (page size 100 is safer)
      const { data: hooks } = await octokit.repos.listWebhooks({ owner, repo, per_page: 100 });
      
      // Look for a hook that:
      // a) matches the EXACT URL we want (already perfect)
      // b) looks like our hook (ends with /webhook/github)
      let existingHook = hooks.find(h => h.config.url === finalUrl);
      
      if (!existingHook) {
        existingHook = hooks.find(h => h.config.url && h.config.url.endsWith('/webhook/github'));
      }
      
      if (existingHook) {
        // If it's already pointing to finalUrl and using the same secret/content_type, we can just skip update
        // but it's safer to just update it to be sure the secret matches the current ENV.
        const { data: updated } = await octokit.repos.updateWebhook({
          owner,
          repo,
          hook_id: existingHook.id,
          config: {
            url: finalUrl,
            content_type: 'json',
            secret: process.env.GITHUB_WEBHOOK_SECRET,
          },
        });
        console.log(`✓ Webhook synchronized for ${repoFullName} (Points to: ${finalUrl})`);
        return updated;
      } else {
        // We got a 422 but couldn't find the hook in the list? 
        // This might happen if there's a hook with exact same URL but we don't have read access?
        // Let's log and proceed if we can't find it to update - it already exists anyway.
        console.warn(`! Warning: Validation failed but no matching hook found in list. Proceeding anyway.`);
        return { id: 'existing', config: { url: finalUrl } };
      }
    }
    
    // 3. Handle Permission Errors (403/404)
    if (err.status === 403 || err.status === 404) {
      const pError = new Error('Lack of administrative permissions on this repository.');
      pError.status = 403;
      pError.code = 'NOPERM';
      throw pError;
    }
    
    throw err;
  }
}

/**
 * Post a translated issue comment back to the GitHub issue.
 */
export async function postTranslation(repo, issueNumber, data) {
  const [owner, repoName] = repo.full_name.split('/');
  const body = formatTranslationComment(data);
  
  const { data: comment } = await octokit.issues.createComment({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    body,
  });
  
  return comment;
}

/**
 * Post a translated reply back to GitHub. Handles both directions:
 * - Contributor comment (non-English → English): "Translated from `locale`"
 * - Maintainer reply (English → contributor locale): "Translated into `locale`"
 */
export async function postReplyTranslation(repo, issueNumber, { locale, originalLocale, originalBody, translatedBody, author, direction, commentUrl }) {
  const [owner, repoName] = repo.full_name.split('/');
  
  const dirLabel = direction === 'to-english' || direction === 'to-maintainer'
    ? `Translated from \`${originalLocale}\` → \`${locale}\``
    : `Translated for @${author} into \`${locale}\``;
  
  const authorLink = commentUrl 
    ? `[Original comment by @${author}](${commentUrl})` 
    : `Original`;

  const body = [
    `> 🌎 **ContribBridge** · ${dirLabel}`,
    `> ${authorLink}: _"${originalBody.length > 50 ? originalBody.substring(0, 47) + '...' : originalBody}"_`,
    '',
    translatedBody,
  ].join('\n');

  const { data: comment } = await octokit.issues.createComment({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    body,
  });
  
  return comment;
}

/**
 * Format the comment body for GitHub.
 */
function formatTranslationComment({ locale, targetLocale, translatedTitle, translatedBody, labels, confidence }) {
  const flagMap = { zh:'🇨🇳', pt:'🇧🇷', ja:'🇯🇵', hi:'🇮🇳', de:'🇩🇪', ko:'🇰🇷', ar:'🇸🇦', ru:'🇷🇺', fr: '🇫🇷', es: '🇪🇸', en: '🇬🇧' };
  const flag = flagMap[locale.slice(0,2)] || '🌐';
  const target = targetLocale || 'en';
  
  return [
    `> ${flag} **ContribBridge** · Translated from \`${locale}\` → \`${target}\` · ${confidence}% confidence`,
    `> Powered by [Lingo.dev](https://lingo.dev) · [ContribBridge](https://ajitpal.github.io/ContribBridge/)`,
    '',
    `### ${translatedTitle}`,
    '',
    translatedBody,
    '',
    '---',
    `*Suggested labels: ${labels && labels.length ? labels.join(', ') : 'none'}*`,
  ].join('\n');
}

/**
 * Check if a repository is public or private.
 */
export async function getRepoVisibility(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  const { data } = await octokit.repos.get({ owner, repo });
  return { isPrivate: data.private, name: data.full_name, owner: data.owner.login };
}
