import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only
// resolve inside a SillyTavern install. Stubbing that one module lets the real gap
// completion run under node --test.
const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false, personas: {} };
export const escapeHtml = value => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

const { fillUncoloredDialogueGaps } = await import('../src/live-colors.js');
const { ensureCharacterEntry } = await import('../src/attribution.js');
const state = await import('../src/state.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };

function withCleanRegistry(run) {
    const previousColors = { ...state.characterColors };
    for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
    Object.assign(settings, DEFAULT_SETTINGS);
    try {
        return run();
    } finally {
        for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
        Object.assign(state.characterColors, previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
    }
}

function bobColor() {
    ensureCharacterEntry('Bob');
    return state.characterColors.bob.color;
}

test('only the uncolored dialogue is wrapped; existing tags stay byte-identical', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const input = '<font color="#ff4d6d">"Hi."</font> Bob said, "Hello."';
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });

        assert.equal(result.changed, true);
        assert.equal(result.filledCount, 1);
        assert.ok(result.updatedText.includes('<font color="#ff4d6d">"Hi."</font>'),
            'the model\'s own tag must survive byte for byte');
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hello."</font>`),
            'the gap must get the attributed speaker\'s color');
        assert.match(result.updatedText, /\n\[COLORS:[^\]]*\]$/, 'a single trailing metadata block');
        assert.equal(result.updatedText.match(/\[COLORS/g).length, 1);
    });
});

test('a fully colored message is a byte-identical no-op', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const input = `<font color="${color}">"Hi."</font>\n[COLORS:Bob=${color}]`;
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('a message with no font tags is declined — it belongs to the autoColorize path', () => {
    withCleanRegistry(() => {
        bobColor();
        const input = 'Bob said, "Hello."';
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('non-canonical markup is declined rather than guessed at', () => {
    withCleanRegistry(() => {
        bobColor();
        const input = '<font color=\'#ff0000\'>"Hi."</font> Bob said, "Hello."';
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('a segment partly covered by a font span counts as covered', () => {
    withCleanRegistry(() => {
        bobColor();
        const input = '"Hel<font color="#ff4d6d">lo."</font>';
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('an existing trailing metadata block is merged, never duplicated', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const input = `<font color="${color}">"Hi."</font> Bob said, "Hello."\n[COLORS:Bob=${color}]`;
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });

        assert.equal(result.changed, true);
        assert.equal(result.updatedText.match(/\[COLORS/g).length, 1);
        assert.match(result.updatedText, /\n\[COLORS:[^\]]*\]$/);
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hello."</font>`));
    });
});

test('completion is idempotent: its own output has no gaps left', () => {
    withCleanRegistry(() => {
        bobColor();
        const input = '<font color="#ff4d6d">"Hi."</font> Bob said, "Hello."';
        const first = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(first.changed, true);
        const second = fillUncoloredDialogueGaps(first.updatedText, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(second.changed, false);
        assert.equal(second.updatedText, first.updatedText);
    });
});
