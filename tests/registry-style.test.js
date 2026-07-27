import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CHARACTER_STYLE_FIELD_MASKS,
    CHARACTER_STYLE_KIND,
    CHARACTER_STYLE_VERSION,
    applyCharacterStyle,
    normalizeCharacterStyle,
} from '../src/character-style.js';
import {
    MAX_REGISTRY_IDENTITY_LENGTH,
    isDangerousRegistryIdentity,
    normalizeGroupProfile,
    normalizeRegistryIdentity,
    normalizeRegistryIdentityName,
} from '../src/group-profiles.js';
import { characterColors, setCharacterColors } from '../src/state.js';

function gradient(color) {
    return {
        type: 'linear',
        angle: 90,
        x: 50,
        y: 50,
        primaryPosition: 0,
        stops: [{ baseColor: color, color, position: 100 }],
        animation: { enabled: false, duration: 8, reverse: false },
    };
}

test('registry identity normalization rejects unsafe names', () => {
    for (const value of ['__proto__', 'Prototype', ' CONSTRUCTOR ']) {
        assert.equal(isDangerousRegistryIdentity(value), true);
        assert.equal(normalizeRegistryIdentityName(value), '');
        assert.equal(normalizeRegistryIdentity(value), '');
    }
    for (const value of [null, 42, {}, [], Symbol('name')]) {
        assert.equal(normalizeRegistryIdentityName(value), '');
    }
    for (const value of ['Alice\u0000Admin', 'Alice\u007fAdmin', 'x'.repeat(MAX_REGISTRY_IDENTITY_LENGTH + 1)]) {
        assert.equal(normalizeRegistryIdentityName(value), '');
    }
    assert.equal(normalizeRegistryIdentityName('  Alice   Smith  '), 'Alice Smith');
});

test('the character registry setter stays null-prototyped and filters unsafe identities', () => {
    const previous = characterColors;
    const source = JSON.parse(`{
        "__proto__":{"name":"__proto__","polluted":true},
        "constructor":{"name":"constructor"},
        "alice":{"name":"Alice","aliases":["Al"]},
        "bad":{"name":"Bad","aliases":["prototype"]}
    }`);

    try {
        const normalized = setCharacterColors(source);
        assert.equal(Object.getPrototypeOf(normalized), null);
        assert.deepEqual(Object.keys(normalized), ['alice']);
        assert.equal(normalized.alice.name, 'Alice');
        assert.equal(Object.prototype.polluted, undefined);
    } finally {
        setCharacterColors(previous);
    }
});

test('unsupported character and group style versions are rejected', () => {
    const unsupported = {
        kind: CHARACTER_STYLE_KIND,
        version: CHARACTER_STYLE_VERSION + 1,
        fields: 0,
    };

    assert.equal(normalizeCharacterStyle(unsupported), null);
    assert.equal(normalizeGroupProfile({ name: 'Party', style: unsupported }), null);
});

test('applying a changed gradient clears stale generator metadata', () => {
    const entry = {
        gradient: gradient('#112233'),
        gradientGenerator: { algorithm: 'dc-gradient-v1', seed: 'stale', iteration: 4 },
    };
    const payload = {
        kind: CHARACTER_STYLE_KIND,
        version: CHARACTER_STYLE_VERSION,
        fields: CHARACTER_STYLE_FIELD_MASKS.GRADIENT,
        gradient: gradient('#abcdef'),
    };

    assert.deepEqual(applyCharacterStyle(entry, payload), ['gradient']);
    assert.equal(entry.gradient.stops[0].color, '#abcdef');
    assert.equal(entry.gradientGenerator, null);
});
