const crypto = require('crypto');

class TrustLedger {
  constructor(store, devicePublicKey) {
    this.store = store;
    this.devicePublicKey = devicePublicKey;
    this.events = store.get('trust.events', []) || [];
  }

  append(type, payload = {}) {
    const previous = this.events[this.events.length - 1];
    const event = {
      index: this.events.length,
      type,
      payload,
      devicePublicKey: this.devicePublicKey,
      createdAt: new Date().toISOString(),
      previousHash: previous ? previous.hash : null
    };
    event.hash = this.hash(event);
    this.events.push(event);
    this.store.set('trust.events', this.events);
    return event;
  }

  verify() {
    return this.events.every((event, index) => {
      const previous = this.events[index - 1];
      return event.index === index &&
        event.previousHash === (previous ? previous.hash : null) &&
        event.hash === this.hash(event);
    });
  }

  list() {
    return this.events.slice();
  }

  hash(event) {
    const { hash, ...unsignedEvent } = event;
    return crypto.createHash('sha256').update(JSON.stringify(unsignedEvent)).digest('hex');
  }
}

module.exports = TrustLedger;
