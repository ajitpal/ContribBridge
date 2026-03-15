// src/server.js — Express webhook server + static dashboard
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { verifyGitHubSignature } from './middleware/verifyGhSig.js';
import { processIssue, processComment } from './pipeline.js';
import { initDashboard } from './dashboard.js';
import { initLingo } from './translate.js';

// ─── Express app ─────────────────────────────────────────────────
const app = express();
const server = createServer(app);

// Parse raw body for signature verification BEFORE json().
// Only the webhook route gets raw body; everything else gets parsed JSON.
app.use('/webhook/github', express.raw({ type: 'application/json' }));
app.use(express.json());

// Serve dashboard UI (dashboard/index.html)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'dashboard')));

// ─── GitHub webhook endpoint ─────────────────────────────────────
app.post('/webhook/github', async (req, res) => {
  // 1. Verify GitHub HMAC-SHA256 signature
  const valid = verifyGitHubSignature(
    req.headers['x-hub-signature-256'],
    req.body, // raw Buffer (thanks to express.raw)
    process.env.GITHUB_WEBHOOK_SECRET
  );
  if (!valid) return res.status(401).send('Invalid signature');

  // 2. ACK immediately — GitHub requires response within 10 seconds
  res.status(200).send('ACK');

  // 3. Parse and process async (don't block response)
  const payload = JSON.parse(req.body.toString());
  const event = req.headers['x-github-event'];

  if (event === 'issues' && payload.action === 'opened') {
    processIssue(payload.issue, payload.repository).catch(console.error);
  }

  if (event === 'issue_comment' && payload.action === 'created') {
    // Translate maintainer replies back to contributor's locale
    processComment(payload.comment, payload.issue, payload.repository).catch(
      console.error
    );
  }
});

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Exported start function (used by CLI `watch` command) ───────
export async function startServer() {
  // Initialise Lingo.dev SDK engine
  await initLingo().catch((err) => {
    console.warn('Lingo.dev init skipped:', err.message);
  });

  // Initialise WebSocket dashboard feed
  initDashboard(server);

  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => {
    console.log(`ContribBridge running on :${PORT}`);
    console.log(`Dashboard → http://localhost:${PORT}`);
    console.log(`Webhook   → POST http://localhost:${PORT}/webhook/github`);
  });

  return server;
}

// ─── Auto-start when run directly (node src/server.js) ───────────
// Detects if this file is the entry point (not imported by CLI)
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  startServer();
}
