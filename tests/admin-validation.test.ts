import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasUnsafeNestedRepetition,
  isSafeRegexPattern,
  parsePositiveId,
} from '../src/server/admin/validation.js';

describe('admin input validation', () => {
  it('accepts only positive safe integer route ids', () => {
    assert.equal(parsePositiveId('1'), 1);
    assert.equal(parsePositiveId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);

    for (const value of ['0', '-1', '1.5', 'not-a-number', '9007199254740992']) {
      assert.equal(parsePositiveId(value), null, value);
    }
  });

  it('accepts valid autoresponder expressions', () => {
    assert.equal(isSafeRegexPattern('hello\\s+world'), true);
    assert.equal(isSafeRegexPattern('^(foo|bar)$'), true);
  });

  it('rejects invalid or obviously nested repetition', () => {
    assert.equal(isSafeRegexPattern('['), false);
    assert.equal(hasUnsafeNestedRepetition('(a+)+$'), true);
    assert.equal(hasUnsafeNestedRepetition('(.*)*'), true);
  });
});
