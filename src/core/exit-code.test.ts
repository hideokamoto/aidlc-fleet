import { test, expect, describe } from 'bun:test';
import {
  exitCodeForInstall,
  exitCodeForUpdate,
  exitCodeForDrift,
  exitCodeForPluginOp,
  exitCodeForLockfileAccess,
  INVALID_REF_EXIT_CODE,
} from './exit-code';

describe('exit-code helper (M8 canonical 0/1/2/3/4 contract)', () => {
  test('exitCodeForInstall: success -> 0, failure -> 4 (init has no gate/drift codes)', () => {
    expect(exitCodeForInstall(true)).toBe(0);
    expect(exitCodeForInstall(false)).toBe(4);
  });

  test('exitCodeForUpdate: gate rejection -> 3, regardless of verifier outcome', () => {
    expect(exitCodeForUpdate({ gateAllowed: false, verifierSuccess: true })).toBe(3);
    expect(exitCodeForUpdate({ gateAllowed: false, verifierSuccess: false })).toBe(3);
  });

  test('exitCodeForUpdate: gate passes, verifier fails -> 4', () => {
    expect(exitCodeForUpdate({ gateAllowed: true, verifierSuccess: false })).toBe(4);
  });

  test('exitCodeForUpdate: gate passes, verifier succeeds -> 0', () => {
    expect(exitCodeForUpdate({ gateAllowed: true, verifierSuccess: true })).toBe(0);
  });

  test("exitCodeForDrift: passes DriftDetector's 0/1/2 through unchanged (BR5.2)", () => {
    expect(exitCodeForDrift(0)).toBe(0);
    expect(exitCodeForDrift(1)).toBe(1);
    expect(exitCodeForDrift(2)).toBe(2);
  });

  test('exitCodeForPluginOp: success -> 0, failure -> 4 (no gate/drift involvement)', () => {
    expect(exitCodeForPluginOp(true)).toBe(0);
    expect(exitCodeForPluginOp(false)).toBe(4);
  });

  test('exitCodeForLockfileAccess: present -> 0, absent/malformed -> 1', () => {
    expect(exitCodeForLockfileAccess('present')).toBe(0);
    expect(exitCodeForLockfileAccess('absent')).toBe(1);
    expect(exitCodeForLockfileAccess('malformed')).toBe(1);
  });

  test('INVALID_REF_EXIT_CODE: single source of truth for pin.ts\'s invalid-ref exit code -> 1', () => {
    expect(INVALID_REF_EXIT_CODE).toBe(1);
  });
});
