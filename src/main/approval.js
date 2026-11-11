'use strict';

const crypto = require('node:crypto');

/**
 * Short-lived, single-use approvals for repair actions.
 *
 * The renderer cannot run a repair by id alone. It must first request an
 * approval token, and the main process consumes that token exactly once.
 * This keeps the approval gate deterministic and independent of the UI.
 */
class ApprovalStore {
  constructor({ ttlMs = 120000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.tokens = new Map();
  }

  approve(repairId, metadata = {}) {
    if (typeof repairId !== 'string' || !repairId) throw new Error('A repair id is required.');
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = this.now() + this.ttlMs;
    this.tokens.set(token, { repairId, expiresAt, createdAt: this.now(), metadata });
    return { token, expiresAt };
  }

  /** Validate and consume a token. Throws on mismatch, reuse, or expiry. */
  consume(token, repairId) {
    if (typeof token !== 'string' || !token) {
      throw Object.assign(new Error('An approval token is required.'), { code: 'APPROVAL_REQUIRED' });
    }
    const entry = this.tokens.get(token);
    if (!entry) {
      throw Object.assign(new Error('This approval is invalid or has already been used.'), { code: 'APPROVAL_INVALID' });
    }
    this.tokens.delete(token);
    if (entry.repairId !== repairId) {
      throw Object.assign(new Error('This approval is for a different repair action.'), { code: 'APPROVAL_MISMATCH' });
    }
    if (this.now() > entry.expiresAt) {
      throw Object.assign(new Error('This approval has expired. Approve the repair again.'), { code: 'APPROVAL_EXPIRED' });
    }
    return entry;
  }

  prune() {
    const now = this.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token);
    }
  }
}

module.exports = { ApprovalStore };
