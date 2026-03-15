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
  const event = req.headers['x-github-event'];
  const signature = req.headers['x-hub-signature-256'];
  
  console.log(`[Webhook] Received ${event} event`);

  // 1. Verify GitHub HMAC-SHA256 signature
  const valid = verifyGitHubSignature(
    signature,
    req.body, // raw Buffer (thanks to express.raw)
    process.env.GITHUB_WEBHOOK_SECRET
  );

  if (!valid) {
    console.error(`[Webhook] Invalid signature for ${event} event!`);
    console.error(`  Received: ${signature?.substring(0, 15)}...`);
    console.error(`  Secret set: ${process.env.GITHUB_WEBHOOK_SECRET ? 'YES' : 'NO'}`);
    return res.status(401).send('Invalid signature');
  }

  // 2. ACK immediately — GitHub requires response within 10 seconds
  res.status(200).send('ACK');
  console.log(`[Webhook] Signature verified. Processing ${event}...`);

  // 3. Parse and process async (don't block response)
  try {
    const payload = JSON.parse(req.body.toString());

    if (event === 'issues' && payload.action === 'opened') {
      console.log(`[Webhook] Processing NEW ISSUE: ${payload.issue.title}`);
      processIssue(payload.issue, payload.repository).catch(console.error);
    }

    if (event === 'issue_comment' && payload.action === 'created') {
      console.log(`[Webhook] Processing NEW COMMENT on issue #${payload.issue.number}`);
      processComment(payload.comment, payload.issue, payload.repository).catch(
        console.error
      );
    }
  } catch (err) {
    console.error(`[Webhook] Failed to parse payload: ${err.message}`);
  }
});

// ─── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Exported start function (used by CLI `watch` command) ───────
export async function startServer() {
  // Initialise Lingo.dev SDK engine
  try {
    await initLingo();
  } catch (err) {
    console.error('CRITICAL: Lingo.dev initialization failed:', err.message);
  }

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
