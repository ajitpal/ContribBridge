// src/cache.js — node-cache wrapper for deduplication and translation caching
import NodeCache from 'node-cache';

// Default TTL: 1 hour (3600 seconds)
const ttl = process.env.CACHE_TTL || 3600;
const cache = new NodeCache({ stdTTL: ttl, checkperiod: 600 });

console.log(`✓ Cache initialized (TTL: ${ttl}s)`);

export default cache;
