// src/middleware/licenseGate.js — Open-core gate: public = free, private = license required
import { getRepoVisibility } from '../github.js';
import { verifyLicense } from '../billing/licenseIssuer.js';
import db from '../db.js';

// ─── Word quota per tier ─────────────────────────────────────────
const QUOTA_LIMITS = {
  community: 10_000,
  indie: 500_000,
  team: 2_000_000,
  enterprise: Infinity,
};

/**
 * License gate — the single rule that powers the open-core model.
 *
 *  Public repo  → ALWAYS free, no check needed
 *  Private repo → requires a valid CONTRIBBRIDGE_LICENSE_KEY JWT
 *
 * @param {string} repoFullName  e.g. "myorg/myrepo"
 * @param {string} orgId         GitHub org or user login
 * @returns {{ allowed: boolean, tier: string, usage?: object }}
 * @throws {{ code: string, message?: string, reason?: string }}
 */
export async function licenseGate(repoFullName, orgId) {
  // 1. Check repo visibility
  const { isPrivate } = await getRepoVisibility(repoFullName);

  // 2. PUBLIC REPOS: always pass — no license check needed
  if (!isPrivate) {
    return { allowed: true, tier: 'community' };
  }

  // 3. PRIVATE REPOS: require a valid license key in .env
  const licenseKey = process.env.CONTRIBBRIDGE_LICENSE_KEY;
  if (!licenseKey) {
    throw {
      code: 'NO_LICENSE',
      message:
        `Private repos require ContribBridge Pro.\n` +
        `Upgrade: https://contribbridge.dev/upgrade?org=${encodeURIComponent(orgId)}`,
    };
  }

  // 4. Verify the JWT license (RS256 offline check)
  const license = verifyLicense(licenseKey, orgId);
  if (!license.valid) {
    throw { code: 'INVALID_LICENSE', reason: license.reason };
  }

  // 5. QUOTA CHECK: count words used this billing month
  const usage = db
    .prepare(
      `SELECT COALESCE(SUM(word_count), 0) as words
       FROM usage
       WHERE org_id = ? AND month = strftime('%Y-%m', 'now')`
    )
    .get(orgId);

  const limit = QUOTA_LIMITS[license.tier];
  if (usage.words >= limit) {
    throw {
      code: 'QUOTA_EXCEEDED',
      used: usage.words,
      limit,
      tier: license.tier,
    };
  }

  // 6. All checks passed
  return { allowed: true, tier: license.tier, usage };
}
