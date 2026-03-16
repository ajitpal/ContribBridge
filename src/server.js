// src/server.js — Express webhook server + static dashboard
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { verifyGitHubSignature } from './middleware/verifyGhSig.js';
import { processIssue, processComment } from './pipeline.js';
import { initDashboard, broadcast } from './dashboard.js';
import { initLingo, translateGenericText } from './translate.js';
import { getRepoVisibility, registerWebhook } from './github.js';

// Simple in-memory rate limiter for playground
const playgroundCooldowns = new Map();

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

// ─── Translation Playground API ──────────────────────────────────
app.post('/api/playground', async (req, res) => {
  const { text } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'];

  if (!text) return res.status(400).json({ error: 'Text is required' });

  // 1. Guardrail: Character Limit
  if (text.length > 1000) {
    return res.status(400).json({ error: 'Text too long (max 1000 characters)' });
  }

  // 2. Guardrail: IP-based Rate Limiting (10 reqs per minute)
  const now = Date.now();
  const userData = playgroundCooldowns.get(ip) || { count: 0, reset: now + 60000 };
  
  if (now > userData.reset) {
    userData.count = 0;
    userData.reset = now + 60000;
  }

  if (userData.count >= 10) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  userData.count++;
  playgroundCooldowns.set(ip, userData);

  try {
    console.log(`[Playground] Translating for IP ${ip}...`);
    const translated = await translateGenericText(text, 'en');
    
    // Broadcast playground result so it shows up in dashboard feed as a special item
    broadcast({
      type: 'playground_result',
      data: {
        original: text,
        translated,
        timestamp: new Date().toISOString()
      }
    });

    res.json({ translated });
  } catch (err) {
    res.status(500).json({ error: 'Translation failed' });
  }
});

// ─── Repository Connector API ────────────────────────────────────
app.post('/api/connect', async (req, res) => {
  const { repo } = req.body;
  
  if (!repo || !repo.includes('/')) {
    return res.status(400).json({ error: 'Valid repository (org/repo) required' });
  }

  try {
    console.log(`[Connector] Attempting to connect: ${repo}...`);
    
    // 1. Check repo visibility
    const { isPrivate } = await getRepoVisibility(repo);

    // 2. License check for private repos
    if (isPrivate && !process.env.CONTRIBBRIDGE_LICENSE_KEY) {
      return res.status(403).json({ 
        error: 'Private repository requires ContribBridge Pro.',
        isPrivate: true
      });
    }

    // 3. Register Webhook
    // We use the server-side WEBHOOK_URL if available
    await registerWebhook(repo);

    res.json({ 
      success: true, 
      repo,
      message: `Successfully connected ${repo}` 
    });
  } catch (err) {
    console.error(`[Connector] Failed to connect ${repo}:`, err.message);
    res.status(err.status || 500).json({ 
      error: err.status === 404 ? 'Repository not found' : 'Connection failed' 
    });
  }
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
