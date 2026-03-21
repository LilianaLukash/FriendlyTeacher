import * as crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Всегда берём секрет из server/.env — иначе при запуске из корня репозитория
// подхватывался бы корневой .env без PROMO_CODE_SECRET и коды были бы с другим HMAC.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROMO_CODE_SECRET = process.env.PROMO_CODE_SECRET ?? 'dev-insecure-secret';
const PROMO_CODE_PREFIX = (process.env.PROMO_CODE_PREFIX ?? 'SAM').toUpperCase();
const PROMO_NONCE_LEN = Number(process.env.PROMO_NONCE_LEN ?? 10);
const PROMO_SIG_LEN = Number(process.env.PROMO_SIG_LEN ?? 12);

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function randomBase32String(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (const b of bytes) out += BASE32_ALPHABET[b % 32];
  return out;
}

function computePromoSignature(nonce: string): string {
  const mac = crypto.createHmac('sha256', PROMO_CODE_SECRET).update(nonce).digest();
  return base32Encode(mac).slice(0, PROMO_SIG_LEN);
}

function getArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const v = Number(process.argv[idx + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const count = getArg('--count', 20);

const codes: string[] = [];
for (let i = 0; i < count; i++) {
  const nonce = randomBase32String(PROMO_NONCE_LEN);
  const sig = computePromoSignature(nonce);
  codes.push(`${PROMO_CODE_PREFIX}-${nonce}-${sig}`);
}

console.log(codes.join('\n'));

