import { randomFillSync } from 'node:crypto';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let lastTimestamp = 0;
let sequenceCounter = 0;

/**
 * Generates an RFC 9562 monotonic UUIDv7 string using Node's CSPRNG.
 * Layout: 48-bit unix_ts_ms | 4-bit ver (0111) | 12-bit rand_a (monotonic) | 2-bit var (10) | 62-bit rand_b
 */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  const now = Date.now();
  if (now > lastTimestamp) {
    lastTimestamp = now;
    // Seed 12-bit monotonic counter in the lower half of the 12-bit range so same-ms increments don't overflow easily
    sequenceCounter = (((bytes[6] ?? 0) & 0x07) << 8) | (bytes[7] ?? 0);
  } else {
    sequenceCounter = (sequenceCounter + 1) & 0x0fff;
    if (sequenceCounter === 0) {
      lastTimestamp += 1;
    }
  }

  const ts = BigInt(lastTimestamp);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7 (0111) + top 4 bits of monotonic rand_a
  bytes[6] = 0x70 | ((sequenceCounter >> 8) & 0x0f);
  bytes[7] = sequenceCounter & 0xff;

  // Variant RFC 9562 (10xx xxxx)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_REGEX.test(value);
}
