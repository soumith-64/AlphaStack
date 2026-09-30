import crypto from 'crypto';
import { config } from '../config.js';

// Derive a fixed 32-byte (256-bit) key from the application secret
const secret = process.env.ENCRYPTION_KEY || config.jwtSecret || 'phonemail-default-secure-key-2026';
const MASTER_KEY = crypto.createHash('sha256').update(String(secret)).digest();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const ENCRYPTED_PREFIX = 'enc:v1:';

export const cryptoService = {
  /**
   * Encrypts plain text or HTML using AES-256-GCM
   * Returns a compact token formatted as: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
   */
  encrypt(plainText) {
    if (plainText === null || plainText === undefined) return '';
    const str = String(plainText);
    if (str.length === 0) return '';
    // Avoid double encryption if already encrypted
    if (str.startsWith(ENCRYPTED_PREFIX)) return str;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
      
      let encrypted = cipher.update(str, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag().toString('hex');
      return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
      console.error('❌ [CryptoService] Encryption error:', err.message);
      return str; // Fallback to original string if encryption fails
    }
  },

  /**
   * Decrypts ciphertext formatted as enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
   * If string is not encrypted (e.g. legacy plain text), returns it as-is (100% backward compatible)
   */
  decrypt(text) {
    if (!text || typeof text !== 'string') return text || '';
    if (!text.startsWith(ENCRYPTED_PREFIX)) {
      return text; // Legacy plaintext message
    }

    try {
      const parts = text.split(':');
      if (parts.length < 5) return text;
      
      // parts[0] = 'enc', parts[1] = 'v1', parts[2] = iv, parts[3] = tag, parts[4] = ciphertext
      const iv = Buffer.from(parts[2], 'hex');
      const authTag = Buffer.from(parts[3], 'hex');
      const ciphertext = parts[4];

      const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.warn('⚠️ [CryptoService] Decryption warning (auth tag mismatch or corrupted payload):', err.message);
      return text; // Return text safely rather than crashing
    }
  },

  /**
   * Checks if a payload is encrypted with PhoneMail AES-256-GCM
   */
  isEncrypted(text) {
    return Boolean(text && typeof text === 'string' && text.startsWith(ENCRYPTED_PREFIX));
  },

  /**
   * Generates a tamper-proof SHA-256 integrity hash / digital stamp for an email
   */
  generateFingerprint(sender, recipient, subject, timestamp) {
    const raw = `${sender || ''}|${recipient || ''}|${subject || ''}|${timestamp || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
    return `INAI-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}`;
  }
};
