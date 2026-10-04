// Bound memory and keep failed authentication attempts across reconnects.
export class PinAttemptLimiter {
  constructor({ limit = 5, cooldownMs = 30_000, globalLimit = 50, maxPeers = 1024 } = {}) {
    this.limit = limit;
    this.cooldownMs = cooldownMs;
    this.globalLimit = globalLimit;
    this.maxPeers = maxPeers;
    this.failedAttempts = new Map();
    this.expiresAt = new Map();
    this.globalFailures = 0;
    this.globalExpiresAt = 0;
  }

  prune() {
    const now = Date.now();
    for (const [peerId, expiry] of this.expiresAt) {
      if (expiry <= now) this.resetPeer(peerId);
    }
    if (this.globalExpiresAt <= now) this.globalFailures = 0;
  }

  isRateLimited(peerId) {
    this.prune();
    return this.globalFailures >= this.globalLimit ||
      (this.failedAttempts.get(peerId) || 0) >= this.limit ||
      (!this.failedAttempts.has(peerId) && this.failedAttempts.size >= this.maxPeers);
  }

  recordFailedAttempt(peerId) {
    this.prune();
    if (!peerId || this.isRateLimited(peerId)) return this.limit;
    const now = Date.now();
    const count = (this.failedAttempts.get(peerId) || 0) + 1;
    this.failedAttempts.set(peerId, count);
    if (count === 1 || count === this.limit) this.expiresAt.set(peerId, now + this.cooldownMs);
    if (this.globalFailures === 0) this.globalExpiresAt = now + this.cooldownMs;
    this.globalFailures++;
    // Starting a cooldown at the threshold also covers IDs rotated near the
    // end of the global window.
    if (this.globalFailures === this.globalLimit) this.globalExpiresAt = now + this.cooldownMs;
    return count;
  }

  resetPeer(peerId) {
    this.failedAttempts.delete(peerId);
    this.expiresAt.delete(peerId);
  }

  clear() {
    this.failedAttempts.clear();
    this.expiresAt.clear();
    this.globalFailures = 0;
    this.globalExpiresAt = 0;
  }
}
