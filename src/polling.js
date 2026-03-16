// src/polling.js — Watcher for OSS repositories (Pull-based fallback)
import db from './db.js';
import { processIssue } from './pipeline.js';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
let pollingInterval = null;

/**
 * Start the polling engine.
 * Scans 'watched_repos' in 'polling' mode every 2 minutes.
 */
export function startPolling(intervalMs = 120000) {
  if (pollingInterval) return;
  
  console.log(`[Polling] Starting OSS engine (Interval: ${intervalMs}ms)`);
  
  pollingInterval = setInterval(async () => {
    const repos = db.prepare("SELECT repo, last_polled FROM watched_repos WHERE mode = 'polling'").all();
    
    for (const { repo, last_polled } of repos) {
      try {
        await pollRepo(repo, last_polled);
      } catch (err) {
        console.error(`[Polling] Failed to poll ${repo}:`, err.message);
      }
    }
  }, intervalMs);
}

/**
 * Stop the polling engine.
 */
export function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Fetch new issues for a specific repository.
 */
async function pollRepo(repoFullName, lastPolled) {
  const [owner, repo] = repoFullName.split('/');
  
  // Fetch issues created since last poll (or last 1 hour if fresh)
  const since = lastPolled || new Date(Date.now() - 3600000).toISOString();
  
  const { data: issues } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    since,
    sort: 'created',
    direction: 'asc',
    per_page: 10
  });

  if (issues.length > 0) {
    console.log(`[Polling] Found ${issues.length} new items for ${repoFullName}`);
    
    for (const issue of issues) {
      // Skip if it's a Pull Request (GitHub Issues API returns both)
      if (issue.pull_request) continue;
      
      // Pass through existing pipeline (it handles dedup via cache)
      const mockRepoPayload = { full_name: repoFullName, owner: { login: owner } };
      await processIssue(issue, mockRepoPayload);
    }
  }

  // Update last_polled timestamp
  db.prepare('UPDATE watched_repos SET last_polled = ? WHERE repo = ?')
    .run(new Date().toISOString(), repoFullName);
}
