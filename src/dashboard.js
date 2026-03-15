// src/dashboard.js — WebSocket server for real-time dashboard updates
import { WebSocketServer } from 'ws';

const clients = new Set();

/**
 * Initialize the WebSocket server on the main HTTP server.
 */
export function initDashboard(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/feed' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`+ Dashboard client connected (total: ${clients.size})`);

    ws.send(JSON.stringify({ 
      type: 'connected', 
      data: { clients: clients.size, timestamp: new Date().toISOString() } 
    }));

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
