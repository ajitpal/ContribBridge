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

// Serve professional landing page (docs/index.html) at root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Serve minimal real-time dashboard at /dashboard
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

// ─── GitHub webhook endpoint ─────────────────────────────────────
app.post('/webhook/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  // 1. Verify GitHub HMAC signature
  // We prefer SHA256, but fallback to SHA1 if SHA256 is missing
  const signature256 = req.headers['x-hub-signature-256'];
  const signature1 = req.headers['x-hub-signature'];
  const signature = signature256 || signature1;

  console.log(`[Webhook] Received ${event} event`);

  // Special case: GitHub sends a 'ping' event to test the webhook.
  if (event === 'ping') {
    console.log('[Webhook] Received ping event — responding 200 OK');
    return res.status(200).send('pong');
  }

  // Handle 'repository' events (setup/meta changes)
  if (event === 'repository') {
    console.log('[Webhook] Received repository event — acknowledging');
    return res.status(200).send('ACK');
  }

  const valid = verifyGitHubSignature(
    signature,
    req.body, // raw Buffer (thanks to express.raw)
    process.env.GITHUB_WEBHOOK_SECRET
  );

  if (!valid) {
    console.error(`[Webhook] Invalid signature for ${event} event!`);
    console.error(`  Received header: ${signature ? (signature.substring(0, 15) + '...') : 'undefined'}`);
    console.error(`  Secret set on server: ${process.env.GITHUB_WEBHOOK_SECRET ? 'YES' : 'NO'}`);
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
      const isBot = payload.comment.user.type === 'Bot' || 
                    payload.comment.body.includes('ContribBridge');
      
      if (!isBot) {
        console.log(`[Webhook] Processing NEW COMMENT on issue #${payload.issue.number}`);
        processComment(payload.comment, payload.issue, payload.repository).catch(
          console.error
        );
      }
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
