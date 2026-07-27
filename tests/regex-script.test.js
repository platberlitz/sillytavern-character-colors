import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../regex-script.json', import.meta.url), 'utf8'));
const storageSource = await readFile(new URL('../src/storage.js', import.meta.url), 'utf8');

function parseRegexLiteral(value) {
    assert.equal(typeof value, 'string');
    assert.equal(value.startsWith('/'), true);
    const separator = value.lastIndexOf('/');
    assert.ok(separator > 0);
    return new RegExp(value.slice(1, separator), value.slice(separator + 1));
}

function matchesWholeTag(regex, value) {
    regex.lastIndex = 0;
    const match = regex.exec(value);
    return match?.[0] === value;
}

test('regex JSON matches exact opening, closing, and self-closing font tags', () => {
    const regex = parseRegexLiteral(config.findRegex);
    for (const tag of [
        '<font>',
        '<FONT color="#aabbcc">',
        '<font color="#aabbcc" face="serif">',
        '</font>',
        '</FONT   >',
        '<font/>',
        '<font />',
        '<font color="#aabbcc" />',
    ]) {
        assert.equal(matchesWholeTag(regex, tag), true, tag);
    }
});

test('regex JSON does not match font-prefixed tag names', () => {
    const regex = parseRegexLiteral(config.findRegex);
    for (const tag of [
        '<font-face>',
        '<fontcolor="#aabbcc">',
        '<fontastic>',
        '</font-face>',
        '</fontastic>',
    ]) {
        assert.equal(matchesWholeTag(regex, tag), false, tag);
    }
});

test('runtime CSS trimming uses stable ownership and exact legacy migration', () => {
    assert.match(storageSource, /id: 'dialogue-colors:trim-css-effects:v1'/);
    assert.match(storageSource, /scriptName: '\[Dialogue Colors\] Trim CSS Effects \(Prompt\)'/);
    assert.match(storageSource, /const isLegacyOwnedCssRule = rule => rule\?\.scriptName === 'Trim CSS Effects \(Prompt\)'/);
    assert.match(storageSource, /const stableOwnedCssRule = extension_settings\.regex\.find\(rule => rule\?\.id === CSS_EFFECTS_TRIM_RULE\.id\)/);
    assert.match(storageSource, /const hasUnownedCssTargetName/);
    assert.match(storageSource, /else if \(!hasUnownedCssTargetName\)/);
});
