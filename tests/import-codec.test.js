import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RESERVED_JSON_KEYS,
    hardenJsonValue,
    parseJsonSource,
} from '../src/import-codec.js';

function hasCode(code) {
    return error => {
        assert.equal(error?.code, code);
        return true;
    };
}

test('parseJsonSource rejects every reserved JSON key without prototype pollution', async () => {
    assert.equal(Object.prototype.polluted, undefined);
    for (const key of RESERVED_JSON_KEYS) {
        const source = JSON.stringify({ safe: true }).replace('{', `{"${key}":{"polluted":true},`);
        await assert.rejects(parseJsonSource(source), hasCode('reserved_key'));
    }
    assert.equal(Object.prototype.polluted, undefined);
});

test('JSON inspection enforces depth and node limits', () => {
    assert.throws(
        () => hardenJsonValue({ outer: { inner: true } }, { maxDepth: 1 }),
        hasCode('too_deep'),
    );
    assert.throws(
        () => hardenJsonValue([1, 2, 3], { maxNodes: 3 }),
        hasCode('too_many_nodes'),
    );
});

test('parseJsonSource enforces UTF-8 byte limits', async () => {
    await assert.rejects(parseJsonSource('"é"', { maxBytes: 3 }), hasCode('input_too_large'));
});

test('parseJsonSource rejects malformed text, bytes, and file-like sources', async () => {
    await assert.rejects(parseJsonSource('{"unfinished":'), hasCode('invalid_json'));
    await assert.rejects(parseJsonSource(Uint8Array.from([0xc3, 0x28])), hasCode('invalid_encoding'));
    await assert.rejects(parseJsonSource({ text: async () => 42 }), hasCode('read_failed'));
});

test('hardenJsonValue copies every dictionary onto a null prototype', () => {
    const source = JSON.parse('{"nested":{"answer":42},"items":[{"safe":true}]}');
    const hardened = hardenJsonValue(source);

    assert.equal(Object.getPrototypeOf(hardened), null);
    assert.equal(Object.getPrototypeOf(hardened.nested), null);
    assert.equal(Object.getPrototypeOf(hardened.items[0]), null);
    assert.equal(Object.getPrototypeOf(hardened.items), Array.prototype);
    assert.notEqual(hardened, source);
    assert.equal(Object.prototype.polluted, undefined);
});
