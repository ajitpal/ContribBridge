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
  
  try {
    const { data } = await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: webhookUrl || `${process.env.WEBHOOK_URL}/webhook/github`,
        content_type: 'json',
        secret: process.env.GITHUB_WEBHOOK_SECRET,
      },
      events: ['issues', 'issue_comment'],
      active: true,
    });
    console.log(`✓ Webhook registered for ${repoFullName} (ID: ${data.id})`);
    return data;
  } catch (err) {
    if (err.status === 422) {
      console.warn(`! Webhook already exists for ${repoFullName}`);
      return;
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
 * Post a translated reply (English maintainer -> contributor locale) back to GitHub.
 */
export async function postReplyTranslation(repo, issueNumber, { locale, originalBody, translatedBody, author }) {
  const [owner, repoName] = repo.full_name.split('/');
  
  const body = [
    `> 🌎 **ContribBridge** · Translated for @${author} into \`${locale}\``,
    `> Original: _"${originalBody.length > 50 ? originalBody.substring(0, 47) + '...' : originalBody}"_`,
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
function formatTranslationComment({ locale, translatedTitle, translatedBody, labels, confidence }) {
  const flagMap = { zh:'🇨🇳', pt:'🇧🇷', ja:'🇯🇵', hi:'🇮🇳', de:'🇩🇪', ko:'🇰🇷', ar:'🇸🇦', ru:'🇷🇺', fr: '🇫🇷', es: '🇪🇸' };
  const flag = flagMap[locale.slice(0,2)] || '🌐';
  
  return [
    `> ${flag} **ContribBridge** · Translated from \`${locale}\` · ${confidence}% confidence`,
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
