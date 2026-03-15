// src/billing/licenseIssuer.js — JWT RS256 license generation + verification
import jwt from 'jsonwebtoken';
import fs from 'fs';

// ─── Feature map per tier ────────────────────────────────────────
const FEATURE_MAP = {
  community: ['translate_public', 'live_dashboard', 'bidirectional'],
  indie: ['translate_private', 'analytics_30d', 'priority_queue', 'email_support'],
  team: ['translate_private', 'analytics_90d', 'custom_glossary', 'multi_repo_10', 'slack_support'],
  enterprise: ['translate_private', 'analytics_unlimited', 'sso_saml', 'scim', 'audit_logs', 'ghe'],
};

// ─── Public key (bundled in package for offline verification) ────
const PUBLIC_KEY = fs.readFileSync(
  new URL('../../keys/public.pem', import.meta.url)
);

// ─── Verify an existing license ─────────────────────────────────
/**
 * Verify a ContribBridge license JWT.
 *
 * @param {string} token  The RS256-signed JWT license key
 * @param {string} orgId  The GitHub org/owner that must match the license
 * @returns {{ valid: boolean, reason?: string, tier?: string, features?: string[], wordQuota?: number, repos?: string[] }}
 */
export function verifyLicense(token, orgId) {
  try {
    const payload = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });

    // Check expiry (custom field — belt-and-suspenders with jwt.verify's own exp)
    if (payload.expiresAt && new Date() > new Date(payload.expiresAt)) {
      return { valid: false, reason: 'expired' };
    }

    // Verify org ownership
    if (payload.orgId !== orgId) {
      return { valid: false, reason: 'org_mismatch' };
    }

    return {
      valid: true,
      tier: payload.tier,
      features: payload.features,
      wordQuota: payload.wordQuota,
      repos: payload.repos,
    };
  } catch (e) {
    return { valid: false, reason: 'invalid_signature' };
  }
}

// ─── Issue a new license (billing server only) ──────────────────
/**
 * Generate a signed RS256 JWT license key. Only runs on the billing server
 * where keys/private.pem is available.
 *
 * @param {{ orgId: string, tier: string, repos: string[], wordQuota: number, expiresAt: Date }} opts
 * @returns {string} Signed JWT token
 */
export function issueLicense({ orgId, tier, repos, wordQuota, expiresAt }) {
  const PRIVATE_KEY = fs.readFileSync(
    new URL('../../keys/private.pem', import.meta.url)
  );

  return jwt.sign(
    {
      iss: 'contribbridge.dev',
      sub: orgId,
      orgId,
      tier,
      repos,
      wordQuota,
      features: FEATURE_MAP[tier],
      expiresAt: expiresAt.toISOString(),
    },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '365d' }
  );
}
