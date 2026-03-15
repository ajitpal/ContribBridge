// src/middleware/verifyGhSig.js — GitHub HMAC-SHA256 signature verification
import crypto from 'crypto';

/**
 * Verify the GitHub webhook signature (x-hub-signature-256 header).
 *
 * @param {string}        signature  The x-hub-signature-256 header value
 * @param {Buffer|string} body       Raw request body (must be Buffer, NOT parsed JSON)
 * @param {string}        secret     The GITHUB_WEBHOOK_SECRET used when registering the hook
 * @returns {boolean}                true if the signature matches
 */
export function verifyGitHubSignature(signature, body, secret) {
  if (!signature || !secret) return false;

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(body) // body must be raw Buffer, NOT parsed JSON
      .digest('hex');

  // Timing-safe comparison prevents timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    // timingSafeEqual throws if buffers differ in length — always invalid
    return false;
  }
}
