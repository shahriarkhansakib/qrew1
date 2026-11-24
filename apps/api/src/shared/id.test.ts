import { describe, expect, it } from 'vitest';
import { generateId, isUuidV7 } from './id.js';

describe('UUIDv7 generator', () => {
  it('generates RFC 9562 valid UUIDv7 values with version 7 and RFC 4122/9562 variant', () => {
    const ids = Array.from({ length: 100 }, () => generateId());
    for (const id of ids) {
      expect(isUuidV7(id)).toBe(true);
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]?.toLowerCase());
    }
  });

  it('produces strictly monotonically increasing IDs across tight sequential generation', () => {
    const ids = Array.from({ length: 500 }, () => generateId());
    for (let i = 1; i < ids.length; i += 1) {
      const current = ids[i];
      const previous = ids[i - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      if (current && previous) {
        expect(current > previous).toBe(true);
      }
    }
  });

  it('rejects UUIDv4 and malformed strings', () => {
    expect(isUuidV7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
  });
});
