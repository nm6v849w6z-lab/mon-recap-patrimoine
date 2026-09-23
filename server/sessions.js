const crypto = require('crypto');

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4h d'inactivite avant re-verrouillage
const sessions = new Map(); // sessionId -> { userId, key: Buffer, expiresAt: number }

function createSession(userId, key) {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { userId, key, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  s.expiresAt = Date.now() + SESSION_TTL_MS; // sliding expiration
  return s;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = { createSession, getSession, destroySession };
