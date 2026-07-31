import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Same single-module stub the other suites use: everything in src reaches
// SillyTavern through st-api.js, so replacing it lets the real code run here.
const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false, personas: {} };
export const escapeHtml = value => String(value);
export const escapeRegex = value => String(value).replace(/[/\\-\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
export const extension_settings = {};
let context = { chat: [], chatMetadata: {} };
export const getContext = () => context;
export const setTestContext = value => { context = value; };
export const eventSource = { on() {}, emit() {} };
export const event_types = {};
export const setExtensionPrompt = () => {};
export const saveSettings = () => {};
export const saveSettingsDebounced = () => {};
export const saveCharacterDebounced = () => {};
export const getCharacters = () => [];
export const extension_prompt_types = {};
export const extension_prompt_roles = {};
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = () => {};
export const saveMetadataDebounced = () => {};
`;

globalThis.document ??= { body: {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const { clearDialogueCountCache, refreshDomDialogueCounts } = await import('../src/dom-engine.js');
const { resolveColorPresetName } = await import('../src/palettes.js');
const { normalizeToggleSettings } = await import('../src/storage.js');
const { MAX_REGISTRY_IDENTITY_LENGTH } = await import('../src/group-profiles.js');
const { characterColors, settings } = await import('../src/state.js');
hooks.deregister();

const sourceNames = ['context-menu.js', 'dom-engine.js', 'main.js', 'palettes.js', 'ui.js'];
const sourceEntries = await Promise.all(sourceNames.map(async name => [
    name,
    await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'),
]));
const sources = Object.fromEntries(sourceEntries);

function withCharacters(names, run) {
    const previousColors = { ...characterColors };
    const previousEngine = settings.coloringEngine;
    const previousSymbols = settings.thoughtSymbols;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    for (const name of names) {
        characterColors[name.toLowerCase()] = { name, color: '#112233', aliases: [], dialogueCount: 0 };
    }
    settings.coloringEngine = 'dom';
    settings.thoughtSymbols = '*';
    clearDialogueCountCache();
    try {
        return run();
    } finally {
        clearDialogueCountCache();
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        settings.coloringEngine = previousEngine;
        settings.thoughtSymbols = previousSymbols;
    }
}

function countsOf(keys) {
    return Object.fromEntries(keys.map(key => [key, characterColors[key]?.dialogueCount ?? null]));
}

test('cached dialogue counts stay identical across repeated passes', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const chat = [
            { id: 'm1', name: 'Alice', mes: '"One," Alice said. "Two."' },
            { id: 'm2', name: 'Bob', mes: 'Bob shrugged.\n\n"Three."' },
        ];
        refreshDomDialogueCounts(chat);
        const first = countsOf(['alice', 'bob']);
        assert.deepEqual(first, { alice: 2, bob: 1 });

        // The second pass is served from the cache and must agree exactly; it also
        // must report no further change, which is what stops the repeated save.
        const second = refreshDomDialogueCounts(chat);
        assert.deepEqual(countsOf(['alice', 'bob']), first);
        assert.equal(second.changed, false);
    });
});

test('edited message text is recounted rather than served from the cache', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const chat = [{ id: 'm1', name: 'Alice', mes: '"One," Alice said.' }];
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 1);

        chat[0].mes = '"One," Alice said. "Two." "Three."';
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 3);
    });
});

test('a registry change invalidates cached dialogue counts', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const chat = [{ id: 'm1', name: 'Alice', mes: 'Bob folded his arms.\n\n"Mine."' }];
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.bob.dialogueCount, 1);
        assert.equal(characterColors.alice.dialogueCount, 0);

        // Removing Bob has to re-resolve the quote, not replay his cached count.
        delete characterColors.bob;
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 1);
    });
});

test('a thought-delimiter change invalidates cached dialogue counts', () => {
    withCharacters(['Alice'], () => {
        const chat = [{ id: 'm1', name: 'Alice', mes: '"Spoken." ~Thought.~' }];
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 1);

        settings.thoughtSymbols = '~';
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 2);
    });
});

test('counts for removed messages do not survive in the cache', () => {
    withCharacters(['Alice'], () => {
        const chat = [
            { id: 'm1', name: 'Alice', mes: '"One."' },
            { id: 'm2', name: 'Alice', mes: '"Two."' },
        ];
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 2);

        chat.pop();
        refreshDomDialogueCounts(chat);
        assert.equal(characterColors.alice.dialogueCount, 1);
    });
});

test('preset names that storage would drop are refused instead of reported saved', () => {
    // These normalize to nothing, so saving them used to toast success and leave
    // the dropdown empty.
    for (const rejected of ['constructor', 'prototype', '__proto__', '   ', 'x'.repeat(MAX_REGISTRY_IDENTITY_LENGTH + 1)]) {
        assert.equal(resolveColorPresetName(rejected), '', `expected "${rejected.slice(0, 20)}" to be refused`);
    }
    // Accepted names come back in the exact form storage will key them under, so
    // the overwrite prompt tests the same string that is written.
    assert.equal(resolveColorPresetName('  My  Preset  '), 'My Preset');
    assert.equal(resolveColorPresetName('Evening cast'), 'Evening cast');
});

test('saveColorPreset refuses a name it cannot persist', () => {
    const save = sources['palettes.js'].slice(sources['palettes.js'].indexOf('export function saveColorPreset'));
    const body = save.slice(0, save.indexOf('\nexport function '));
    assert.match(body, /resolveColorPresetName\(nameInput\?\.value\)/);
    assert.match(body, /if\s*\(!name\)\s*\{[\s\S]*return;/);
    assert.doesNotMatch(body, /nameInput\?\.value\?\.trim\(\)\s*;/);
});

test('prompt depth is clamped to the range its control declares', () => {
    const previous = settings.promptDepth;
    try {
        for (const [input, expected] of [[-5, 0], [0, 0], [50, 50], [99, 99], [5000, 99], ['12', 12], [NaN, 1], [undefined, 1]]) {
            settings.promptDepth = input;
            normalizeToggleSettings();
            assert.equal(settings.promptDepth, expected, `promptDepth ${String(input)} should normalize to ${expected}`);
        }
    } finally {
        settings.promptDepth = previous;
    }
});

test('the manual assignment dialog validates the name outside its closing finally', () => {
    const source = sources['context-menu.js'];
    const handler = source.slice(source.indexOf("menu.querySelector('#dc-ctx-assign').onclick"));
    const validation = handler.indexOf('readCharacterName(nameInput)');
    const tryStart = handler.indexOf('try {');
    const closeInFinally = handler.indexOf('closeMenu();', handler.indexOf('} finally {'));
    assert.ok(validation >= 0 && tryStart >= 0 && closeInFinally > tryStart);
    // An invalid name is corrected in place, so it must not reach the finally that
    // tears the dialog down.
    assert.ok(validation < tryStart, 'name validation must run before the try/finally');
});

test('a persona switch persists and repaints the restored color', () => {
    const restore = sources['ui.js'].slice(sources['ui.js'].indexOf('export function applyRestoredPersonaColor'));
    const body = restore.slice(0, restore.indexOf('\nexport function '));
    assert.match(body, /restorePinnedPersonaColor\(\)/);
    assert.match(body, /applyLiveColorChangesFromSnapshot\(/);
    assert.match(body, /saveData\(\{\s*preserveEffectiveColors:\s*true\s*\}\)/);
    assert.match(body, /repaintDomAfterCharacterDataChange\(/);
    assert.match(sources['main.js'], /personaChanged: \(\) => \{[\s\S]*?applyRestoredPersonaColor\(\)/);
});

test('registry keys always come from the normalized identity, never raw lowercase', () => {
    // buildCharacterEntry keys on the normalized identity; storing under a raw
    // lowercase name produces an entry whose key does not match itself, which then
    // only heals on the next full normalization pass.
    for (const name of ['ui.js', 'context-menu.js']) {
        assert.doesNotMatch(
            sources[name],
            /resolveCharacterKeyByNameOrAlias\([^)]*\)\s*\|\|\s*[\w.]*\.?(?:trim\(\)\.)?toLowerCase\(\)/,
            `${name} still falls back to a lowercased name when resolving a registry key`,
        );
        assert.doesNotMatch(
            sources[name],
            /\bkey\s*=\s*char\.name\.toLowerCase\(\)/,
            `${name} still derives a registry key from a raw card name`,
        );
    }
    assert.match(sources['ui.js'], /key = built\.key/);
    assert.match(sources['ui.js'], /characterColors\[built\.key\] = built\.entry/);
    // Both assignment dialogs write through the built key.
    assert.equal((sources['context-menu.js'].match(/key = built\.key/g) || []).length, 2);
});
