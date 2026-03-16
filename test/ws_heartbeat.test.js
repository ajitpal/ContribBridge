import { WebSocket } from 'ws';

/**
 * Test script to verify WebSocket heartbeat.
 * Run this while the server is running.
 */
async function testHeartbeat() {
  const url = 'ws://localhost:4000/feed';
  console.log(`Connecting to ${url}...`);
  
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    console.log('Connected!');
  });
  
  ws.on('ping', () => {
    console.log('Received Ping from server');
    // ws client automatically responds with pong
  });
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Received Message:', msg.type);
  });
  
  ws.on('close', () => {
    console.log('Disconnected');
  });
  
  ws.on('error', (err) => {
    console.error('Error:', err.message);
  });
  
  // Wait for 40 seconds to see at least one heartbeat (interval is 30s)
  console.log('Waiting 40s for heartbeat...');
  await new Promise(resolve => setTimeout(resolve, 40000));
  
  ws.close();
}

testHeartbeat().catch(console.error);
