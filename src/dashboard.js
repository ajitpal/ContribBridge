// src/dashboard.js — WebSocket server for real-time dashboard updates
import { WebSocketServer } from 'ws';
import db from './db.js';

const clients = new Set();

/**
 * Initialize the WebSocket server on the main HTTP server.
 */
export function initDashboard(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/feed' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`+ Dashboard client connected (total: ${clients.size})`);

    // 1. Send connection ACK
    ws.send(JSON.stringify({ 
      type: 'connected', 
      data: { clients: clients.size, timestamp: new Date().toISOString() } 
    }));

    // 2. Load historical data from SQLite
    try {
      // Get last 20 issues
      const history = db.prepare(`
        SELECT id, repo, issue_number as number, locale as detectedLocale, 
               translated_title as translatedTitle, translated_body as translatedBody, 
               confidence, created_at as timestamp 
        FROM issues 
        ORDER BY created_at DESC 
        LIMIT 20
      `).all();

      const commentHistory = db.prepare(`
        SELECT id, repo, issue_number as issueNumber, author, 
               original_body as originalBody, translated_body as translatedBody, 
               direction, locale, created_at as timestamp, comment_url as commentUrl
        FROM comments
        ORDER BY created_at DESC
        LIMIT 100
      `).all();

      // Get global health (average confidence)
      const health = db.prepare(`
        SELECT AVG(confidence) as avgConf, COUNT(*) as total 
        FROM issues
      `).get();

      // Get repo stats (from watched_repos)
      const repoStats = db.prepare(`
        SELECT w.repo, w.mode,
               (SELECT COUNT(*) FROM issues WHERE repo = w.repo) as count,
               (SELECT GROUP_CONCAT(target_locale) FROM repo_locales WHERE repo = w.repo) as locales
        FROM watched_repos w
        ORDER BY count DESC
      `).all();

      // Get language stats (from configured target locales in repo_locales)
      const langStats = db.prepare(`
        SELECT target_locale as lang, COUNT(*) as count 
        FROM repo_locales 
        GROUP BY target_locale 
        ORDER BY count DESC
      `).all();

      ws.send(JSON.stringify({
        type: 'history',
        data: {
          history,
          commentHistory,
          repoStats,
          langStats,
          health: {
            confidence: Math.round(health.avgConf > 1 ? health.avgConf : (health.avgConf || 0.95) * 100),
            context: Math.min(100, 80 + (health.total * 2)) // Heuristic for context growth
          }
        }
      }));
    } catch (err) {
      console.error('[Dashboard] Failed to load history:', err.message);
    }

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`- Dashboard client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket Error:', err.message);
      clients.delete(ws);
    });
  });
}

/**
 * Broadcast a payload to all connected dashboard clients.
 */
export function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) { // 1 = OPEN
      ws.send(msg);
    }
  }
}

/**
 * Broadcast updated stats (repos/langs) to all clients
 */
export function broadcastStats() {
  try {
    const repoStats = db.prepare(`
      SELECT w.repo, w.mode,
             (SELECT COUNT(*) FROM issues WHERE repo = w.repo) as count,
             (SELECT GROUP_CONCAT(target_locale) FROM repo_locales WHERE repo = w.repo) as locales
      FROM watched_repos w
      ORDER BY count DESC
    `).all();

    const langStats = db.prepare(`
      SELECT target_locale as lang, COUNT(*) as count 
      FROM repo_locales 
      GROUP BY target_locale 
      ORDER BY count DESC
    `).all();

    const health = db.prepare(`
      SELECT AVG(confidence) as avgConf, COUNT(*) as total 
      FROM issues
    `).get();

    broadcast({
      type: 'stats',
      data: {
        repoStats,
        langStats,
        health: {
          confidence: Math.round(health.avgConf > 1 ? health.avgConf : (health.avgConf || 0.95) * 100),
          context: Math.min(100, 80 + (health.total * 2))
        }
      }
    });
  } catch (err) {
    console.error('[Dashboard] Failed to broadcast stats:', err.message);
  }
}
