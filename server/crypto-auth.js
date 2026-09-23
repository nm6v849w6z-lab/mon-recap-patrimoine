const crypto = require('crypto');

const SCRYPT_KEYLEN = 32; // AES-256
const CANARY_PLAINTEXT = 'grand-livre-unlocked';

function deriveKey(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(pin, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 });
}

// Chiffre une chaine avec AES-256-GCM. Retourne "iv:tag:ciphertext" en base64.
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Dechiffre une chaine produite par encrypt(). Leve une erreur si la cle est
// incorrecte ou si les donnees ont ete alterees (verification d'integrite GCM).
function decrypt(payload, key) {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Payload chiffre invalide');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

// Genere un nouveau sel + canary pour un PIN choisi a la premiere configuration.
function setupPin(pin) {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const key = deriveKey(pin, saltHex);
  const canary = encrypt(CANARY_PLAINTEXT, key);
  return { saltHex, canary, key };
}

// Verifie un PIN saisi contre le sel + canary stockes. Retourne la cle
// derivee (Buffer) si le PIN est correct, sinon null. La verification GCM
// (tag d'authentification) est ce qui garantit qu'un mauvais PIN est rejete.
function verifyPin(pin, saltHex, canary) {
  try {
    const key = deriveKey(pin, saltHex);
    const decoded = decrypt(canary, key);
    return decoded === CANARY_PLAINTEXT ? key : null;
  } catch (e) {
    return null;
  }
}

module.exports = { deriveKey, encrypt, decrypt, setupPin, verifyPin };
