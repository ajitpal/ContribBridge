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

      // Get global health (average confidence)
      const health = db.prepare(`
        SELECT AVG(confidence) as avgConf, COUNT(*) as total 
        FROM issues
      `).get();

      // Get repo stats
      const repoStats = db.prepare(`
        SELECT repo, COUNT(*) as count 
        FROM issues 
        GROUP BY repo 
        ORDER BY count DESC
      `).all();

      // Get language stats
      const langStats = db.prepare(`
        SELECT locale as lang, COUNT(*) as count 
        FROM issues 
        GROUP BY locale 
        ORDER BY count DESC
      `).all();

      ws.send(JSON.stringify({
        type: 'history',
        data: {
          history,
          repoStats,
          langStats,
          health: {
            confidence: Math.round((health.avgConf || 0.95) * 100),
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
      SELECT repo, COUNT(*) as count 
      FROM issues 
      GROUP BY repo 
      ORDER BY count DESC
    `).all();

    const langStats = db.prepare(`
      SELECT locale as lang, COUNT(*) as count 
      FROM issues 
      GROUP BY locale 
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
          confidence: Math.round((health.avgConf || 0.95) * 100),
          context: Math.min(100, 80 + (health.total * 2))
        }
      }
    });
  } catch (err) {
    console.error('[Dashboard] Failed to broadcast stats:', err.message);
  }
}
