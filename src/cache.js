class Cache {
  constructor(defaultTTL = 15000) {
    this.store = new Map();
    this.defaultTTL = defaultTTL;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data, ttl = this.defaultTTL) {
    this.store.set(key, { data, expiresAt: Date.now() + ttl });
  }

  wrap(key, ttl, fn) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) return Promise.resolve(cached);
    return Promise.resolve()
      .then(fn)
      .then((data) => {
        this.set(key, data, ttl);
        return data;
      });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = new Cache();
