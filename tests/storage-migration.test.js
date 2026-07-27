import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    MAX_REGISTRY_IDENTITY_LENGTH,
    migrateLegacyRegistryEntries,
    migrateLegacyRegistryIdentities,
    normalizeRegistryIdentity,
} from '../src/group-profiles.js';
import { COLOR_SCHEMA_VERSION } from '../src/state.js';

const storageSource = await readFile(new URL('../src/storage.js', import.meta.url), 'utf8');

test('legacy registry migration retains bounded NFKC collisions', () => {
    const longName = `Long ${'x'.repeat(MAX_REGISTRY_IDENTITY_LENGTH + 40)}`;
    const source = JSON.parse(JSON.stringify({
        Alice: { id: 1, name: 'Alice' },
        'Ａlice': { id: 2, name: 'Ａlice' },
        [longName]: { id: 3, name: longName },
        constructor: { id: 4, name: 'constructor' },
    }));
    Object.defineProperty(source, '__proto__', {
        value: { id: 5, name: '__proto__', polluted: true },
        enumerable: true,
    });
    const migrated = migrateLegacyRegistryEntries(source, {
        maximum: MAX_REGISTRY_IDENTITY_LENGTH,
        fallback: 'Legacy character',
        nameFromValue: true,
    });

    assert.equal(Object.getPrototypeOf(migrated.registry), null);
    assert.equal(Object.keys(migrated.registry).length, 5);
    assert.deepEqual(Object.values(migrated.registry).map(entry => entry.id).sort(), [1, 2, 3, 4, 5]);
    assert.ok(Object.keys(migrated.registry).every(name => normalizeRegistryIdentity(name)));
    assert.ok(Object.keys(migrated.registry).every(name => name.length <= MAX_REGISTRY_IDENTITY_LENGTH));
    assert.equal(migrated.renames.some(rename => rename.collision), true);
    assert.equal(migrated.renames.some(rename => rename.from === 'Ａlice'), true);
    assert.equal(migrated.renames.some(rename => rename.from === longName), true);
    assert.equal(normalizeRegistryIdentity(longName), '');
    assert.equal(Object.prototype.polluted, undefined);
});

test('legacy aliases deduplicate equivalents but retain truncation collisions', () => {
    const prefix = 'x'.repeat(MAX_REGISTRY_IDENTITY_LENGTH + 10);
    const migrated = migrateLegacyRegistryIdentities([
        'Al',
        'Ａｌ',
        `${prefix} one`,
        `${prefix} two`,
    ]);

    assert.equal(migrated.values.length, 3);
    assert.equal(migrated.values[0], 'Al');
    assert.notEqual(migrated.values[1], migrated.values[2]);
    assert.ok(migrated.values.every(alias => normalizeRegistryIdentity(alias)));
});

test('legacy entries with blank explicit names retain their dictionary identities', () => {
    const migrated = migrateLegacyRegistryEntries({
        'Group One': { name: null, style: {} },
        'Group Two': { name: '   ', style: {} },
    }, {
        maximum: 80,
        fallback: 'Legacy group',
        nameFromValue: true,
    });

    assert.deepEqual(Object.keys(migrated.registry), ['Group One', 'Group Two']);
    assert.equal(migrated.registry['Group One'].name, 'Group One');
    assert.equal(migrated.registry['Group Two'].name, 'Group Two');
    assert.equal(migrated.mappings['Group One'], 'Group One');
    assert.match(storageSource, /const names = \[rawKey\]/);
    assert.match(storageSource, /if \(legacyIdentityLookup\(explicitName\)\) names\.push\(explicitName\)/);
});

test('storage normalization preserves canonical collisions and clears blank legacy groups', () => {
    assert.match(storageSource, /function normalizeNameDictionary[\s\S]*?const occupied = new Set\(\)/);
    assert.match(storageSource, /while \(occupied\.has\(identity\)\)[\s\S]*?const suffix = ` \(\$\{collisionIndex\+\+\}\)`/);
    assert.match(storageSource, /occupied\.add\(identity\)[\s\S]*?normalized\[name\] = value/);
    assert.match(storageSource, /const groupLookup = legacyIdentityLookup\(entry\.group\)/);
    assert.match(storageSource, /if \(!groupLookup\) \{\s*entry\.group = '';/);
    assert.match(storageSource, /mappedGroup \|\| migrateLegacyRegistryIdentityName\(entry\.group, 80, 'Legacy group'\)/);
});

test('storage identity migration is schema-versioned before strict normalization', () => {
    assert.equal(COLOR_SCHEMA_VERSION, 9);
    assert.match(storageSource, /version < COLOR_SCHEMA_VERSION\s*\? migrateLegacyAutoSyncRecord\(source\)/);
    assert.match(storageSource, /colorData: migrateLegacyStoredColorData/);
    assert.match(storageSource, /presets: migrateLegacyStoredColorPresets/);
    assert.match(storageSource, /customPalettes: palettes\.registry/);
    assert.match(storageSource, /migrateLegacyGroupProfileRegistry/);
    assert.match(storageSource, /allowUnversioned: kind === 'card'/);
    assert.match(storageSource, /key\.startsWith\('dc_chat_'\)/);
    assert.match(storageSource, /identitySchemaMigration/);
    assert.match(storageSource, /if \(identitySchemaMigrated\) persistModuleStore\(record\)/);
});
