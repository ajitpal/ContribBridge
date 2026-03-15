import 'dotenv/config';
import crypto from 'crypto';

const secret = process.env.GITHUB_WEBHOOK_SECRET;
const payload = JSON.stringify({
  action: 'opened',
  issue: {
    id: 12345,
    number: 1,
    title: 'Test Issue',
    body: 'Hola mundo'
  },
  repository: {
    full_name: 'ajitpal/markdown-converter-ui',
    owner: { login: 'ajitpal' }
  }
});

const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

console.log('Sending test webhook to localhost:4000...');
const res = await fetch('http://localhost:4000/webhook/github', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-github-event': 'issues',
    'x-hub-signature-256': signature
  },
  body: payload
});

console.log('Status:', res.status);
console.log('Body:', await res.text());
