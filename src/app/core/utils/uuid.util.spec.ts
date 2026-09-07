import { generateUuidV4, isValidUuidV4 } from './uuid.util';

describe('uuid.util', () => {
  it('should generate valid RFC 4122 v4 UUIDs', () => {
    const uuid = generateUuidV4();
    expect(isValidUuidV4(uuid)).toBe(true);
    expect(uuid.charAt(14)).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(uuid.charAt(19).toLowerCase());
  });

  it('should generate unique UUIDs across multiple invocations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) {
      set.add(generateUuidV4());
    }
    expect(set.size).toBe(50);
  });

  it('should validate valid UUID v4 strings', () => {
    expect(isValidUuidV4('c56a4180-65aa-42ec-a945-5fd21dec0538')).toBe(true);
    expect(isValidUuidV4('00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it('should reject invalid UUIDs or non-v4 UUIDs', () => {
    expect(isValidUuidV4(null)).toBe(false);
    expect(isValidUuidV4(undefined)).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4('1715000000000')).toBe(false);
    expect(isValidUuidV4('c56a4180-65aa-12ec-a945-5fd21dec0538')).toBe(false);
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
  });
});
