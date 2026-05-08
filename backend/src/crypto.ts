// backend/src/crypto.ts
// AES-256-GCM encryption for AWS credentials at rest
// Storage format: "iv_hex:tag_hex:ciphertext_hex" (colon-separated)

import crypto from 'crypto';

// Encrypt plaintext with AES-256-GCM
// Returns format: "iv_hex:tag_hex:ciphertext_hex"
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars)');
  }

  const iv = crypto.randomBytes(12); // 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Store as "iv:tag:ciphertext" all in hex
  const stored = `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  return stored;
}

// Decrypt stored value (format: "iv_hex:tag_hex:ciphertext_hex")
// Returns plaintext string
export function decrypt(stored: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Decryption key must be 32 bytes (64 hex chars)');
  }

  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected "iv:tag:ciphertext"');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  if (iv.length !== 12) {
    throw new Error('Invalid IV length: expected 12 bytes');
  }
  if (tag.length !== 16) {
    throw new Error('Invalid auth tag length: expected 16 bytes');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  return plaintext;
}
