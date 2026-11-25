/**
 * NexVault Security Event Bus
 * Decoupled publish-subscribe system for real-time threat notifications,
 * integrity warnings, and ecosystem-wide defensive telemetry.
 */

class SecurityEventBus {
  constructor() {
    this.handlers = new Map();
    this.auditLog = [];
    this.maxAuditEntries = 200;
  }

  /**
   * Subscribe to a security event type.
   * @param {string} event 
   * @param {Function} handler 
   * @returns {Function} Unsubscribe callback
   */
  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from a security event.
   */
  off(event, handler) {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  /**
   * Emit a security event with payload and record in the local audit log.
   * @param {string} event 
   * @param {object} payload 
   */
  async emit(event, payload = {}) {
    const timestamp = Date.now();
    const entry = {
      event,
      payload,
      timestamp,
      iso: new Date(timestamp).toISOString()
    };

    // Store in circular audit log
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.shift();
    }

    const set = this.handlers.get(event);
    if (!set) return [];

    const promises = [];
    for (const handler of set) {
      try {
        const res = handler(entry);
        if (res instanceof Promise) promises.push(res);
      } catch (err) {
        console.error(`[SecurityEventBus] Error in handler for ${event}:`, err);
      }
    }

    return Promise.all(promises);
  }

  /**
   * Retrieve recent security audit events.
   */
  getAuditLog(limit = 50) {
    return this.auditLog.slice(-limit);
  }

  /**
   * Clear the in-memory audit log.
   */
  clearAuditLog() {
    this.auditLog = [];
  }
}

// Global shared singleton
const globalEventBus = new SecurityEventBus();

module.exports = {
  SecurityEventBus,
  globalEventBus
};
