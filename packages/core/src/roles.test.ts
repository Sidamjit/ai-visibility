import { describe, expect, it } from 'vitest';
import { canAccess } from './roles';

describe('role access', () => {
  it('keeps existing role boundaries', () => {
    expect(canAccess('IT', '/it/breaches')).toBe(true);
    expect(canAccess('EXECUTIVE', '/it/breaches')).toBe(false);
    expect(canAccess('MANAGER', '/executive')).toBe(false);
    expect(canAccess('EXECUTIVE', '/settings')).toBe(true);
    expect(canAccess('EXECUTIVE', '/settings/vendor-access')).toBe(false);
    expect(canAccess('EXECUTIVE', '/settings/policy')).toBe(false);
  });

  it('denies the vendor everything without an active grant scope', () => {
    for (const p of ['/support', '/it', '/executive', '/settings', '/', '/anything'])
      expect(canAccess('VENDOR_SUPPORT', p, null)).toBe(false);
  });

  it('limits the vendor to the grant scope and never opens settings or exports', () => {
    expect(canAccess('VENDOR_SUPPORT', '/support', 'diagnostics')).toBe(true);
    expect(canAccess('VENDOR_SUPPORT', '/it', 'diagnostics')).toBe(false);
    expect(canAccess('VENDOR_SUPPORT', '/it/breaches', 'read-only')).toBe(true);
    expect(canAccess('VENDOR_SUPPORT', '/report', 'read-only')).toBe(true);
    for (const p of [
      '/settings',
      '/settings/vendor-access',
      '/settings/audit',
      '/api/export/findings',
      '/manager',
    ])
      expect(canAccess('VENDOR_SUPPORT', p, 'read-only')).toBe(false);
  });
});
