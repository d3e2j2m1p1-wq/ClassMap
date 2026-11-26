// A small stand-in for the parts of Vitest's API the unit tests use, on top of Node's own
// test runner (node --test), so the project needs no extra packages to run them.
import assert from 'node:assert/strict';
export { describe, it } from 'node:test';

const isObj = v => v && typeof v === 'object';
function matches(actual, expected) {
  if (!isObj(expected)) return Object.is(actual, expected);
  return isObj(actual) && Object.keys(expected).every(k => matches(actual[k], expected[k]));
}

function make(actual, negate = false) {
  const check = (ok, msg) => { if (negate ? ok : !ok) assert.fail((negate ? 'not: ' : '') + msg); };
  const deepEq = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };
  return {
    toBe: v => check(Object.is(actual, v), `expected ${actual} to be ${v}`),
    toEqual: v => check(deepEq(actual, v), `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(v)}`),
    toBeNull: () => check(actual === null, `expected ${actual} to be null`),
    toBeGreaterThan: v => check(actual > v, `expected ${actual} > ${v}`),
    toBeLessThanOrEqual: v => check(actual <= v, `expected ${actual} <= ${v}`),
    toBeCloseTo: (v, digits = 2) => check(Math.abs(actual - v) < 10 ** -digits / 2, `expected ${actual} ≈ ${v}`),
    toContainEqual: v => check(actual.some(x => deepEq(x, v)), `expected list to contain ${JSON.stringify(v)}`),
    toMatchObject: v => check(matches(actual, v), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(v)}`),
  };
}

export function expect(actual) {
  const m = make(actual);
  m.not = make(actual, true);
  m.rejects = { toThrow: async re => { await assert.rejects(actual, re); } };
  return m;
}
