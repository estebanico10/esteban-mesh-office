'use strict';

const crypto = require('crypto');

const KEY_FORMAT = 'esteban-cloud-key';
const KEY_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const KEY_PREFIX = 'ECLOUD1:';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function verifyTokenHash(token, expectedHex) {
  if (!token || !expectedHex || typeof expectedHex !== 'string') return false;
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function makeKeyId() {
  const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `EC-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function spkiDerToOpenSshEd25519(spkiDer, comment) {
  // Ed25519 SPKI DER ends with the 32-byte raw public key
  const pubKeyRaw = spkiDer.subarray(spkiDer.length - 32);
  const typeBuf = Buffer.from('ssh-ed25519', 'ascii');
  const lenType = Buffer.alloc(4);
  lenType.writeUInt32BE(typeBuf.length, 0);
  const lenKey = Buffer.alloc(4);
  lenKey.writeUInt32BE(pubKeyRaw.length, 0);
  const blob = Buffer.concat([lenType, typeBuf, lenKey, pubKeyRaw]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment || 'esteban-cloud'}`;
}

function generateEd25519Pair(comment) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const sshPublicKey = spkiDerToOpenSshEd25519(spkiDer, comment);
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { sshPublicKey, privateKeyPem };
}

function encryptPayload(payloadObj, passphrase, meta) {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 6) {
    throw new Error('La frase de paso debe tener al menos 6 caracteres.');
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    format: KEY_FORMAT,
    version: KEY_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString('base64')
    },
    cipher: {
      name: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    },
    meta: meta || {},
    ciphertext: ciphertext.toString('base64')
  };
}

function parseKeyBundle(input) {
  if (!input) throw new Error('No se proporcionó ninguna llave encriptada.');
  let obj = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith(KEY_PREFIX)) {
      const jsonStr = Buffer.from(trimmed.slice(KEY_PREFIX.length), 'base64').toString('utf8');
      obj = JSON.parse(jsonStr);
    } else {
      obj = JSON.parse(trimmed);
    }
  }
  if (!obj || obj.format !== KEY_FORMAT || obj.version !== KEY_VERSION) {
    throw new Error('Formato de llave .ecloudkey no válido.');
  }
  if (!obj.kdf || !obj.cipher || !obj.ciphertext) {
    throw new Error('Llave .ecloudkey incompleta o dañada.');
  }
  return obj;
}

function decryptKeyBundle(input, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Debes ingresar la frase de paso para desbloquear la llave.');
  }
  const bundle = parseKeyBundle(input);
  const salt = Buffer.from(bundle.kdf.salt, 'base64');
  const iv = Buffer.from(bundle.cipher.iv, 'base64');
  const tag = Buffer.from(bundle.cipher.tag, 'base64');
  const ciphertext = Buffer.from(bundle.ciphertext, 'base64');
  const iterations = Number(bundle.kdf.iterations) || PBKDF2_ITERATIONS;

  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('Frase de paso incorrecta o llave modificada.');
  }
}

function generateKeyBundle({ label, permissions = 'rw', shareIds = ['*'], hostInfo = {}, passphrase }) {
  const cleanLabel = String(label || 'Llave Pendrive').trim() || 'Llave Pendrive';
  const cleanPerm = permissions === 'ro' ? 'ro' : 'rw';
  const keyId = makeKeyId();
  const createdAt = new Date().toISOString();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const { sshPublicKey, privateKeyPem } = generateEd25519Pair(`${cleanLabel} (${keyId})`);

  const payload = {
    version: KEY_VERSION,
    keyId,
    label: cleanLabel,
    createdAt,
    permissions: cleanPerm,
    shareIds: Array.isArray(shareIds) && shareIds.length > 0 ? shareIds : ['*'],
    token,
    host: {
      nodeName: hostInfo.nodeName || '',
      tailscaleIp: hostInfo.tailscaleIp || '',
      tailscaleDns: hostInfo.tailscaleDns || '',
      lanIp: hostInfo.lanIp || '',
      port: Number(hostInfo.port) || 4789,
      sshUser: hostInfo.sshUser || ''
    },
    sshPublicKey,
    sshPrivateKeyPem: privateKeyPem
  };

  const meta = {
    keyId,
    label: cleanLabel,
    nodeName: payload.host.nodeName,
    tailscaleIp: payload.host.tailscaleIp,
    lanIp: payload.host.lanIp,
    port: payload.host.port,
    permissions: cleanPerm,
    createdAt
  };

  const bundle = encryptPayload(payload, passphrase, meta);
  const clipboardString = KEY_PREFIX + Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64');

  const hostRecord = {
    keyId,
    label: cleanLabel,
    createdAt,
    permissions: cleanPerm,
    shareIds: payload.shareIds,
    tokenHash,
    sshPublicKey,
    revoked: false,
    lastUsedAt: null
  };

  return {
    keyId,
    hostRecord,
    bundle,
    bundleJson: JSON.stringify(bundle, null, 2),
    clipboardString
  };
}

module.exports = {
  KEY_FORMAT,
  KEY_VERSION,
  KEY_PREFIX,
  hashToken,
  verifyTokenHash,
  parseKeyBundle,
  decryptKeyBundle,
  generateKeyBundle
};
