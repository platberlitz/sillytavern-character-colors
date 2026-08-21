import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths
// that only resolve inside a SillyTavern install. Stubbing that one module lets
// the real prompt-mode resolution run under node --test.
const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false };
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
export const extensionPromptCalls = [];
export const setExtensionPrompt = (...args) => { extensionPromptCalls.push(args); };
export const saveSettings = () => {};
export const saveSettingsDebounced = () => {};
export const saveCharacterDebounced = () => {};
export const getCharacters = () => [];
export const extension_prompt_types = { IN_CHAT: 1 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1 };
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = () => {};
export const saveMetadataDebounced = () => {};
export let promptManager = null;
export const setTestPromptManager = value => { promptManager = value; };
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

const { buildColoredPromptPreview, buildDomStealthColorsInstruction, buildMinimalPromptInstruction, flushPromptInjection, getEffectivePromptMode, promptHasDialogueColorsMacro, stripMacroComments } = await import('../src/prompts.js');
const { characterColors, settings } = await import('../src/state.js');
const stApi = await import(stApiUrl);

hooks.deregister();

function reset({ promptMode = 'inject', autoPromptMode = true } = {}) {
    settings.enabled = true;
    settings.coloringEngine = 'llm';
    settings.promptMode = promptMode;
    settings.autoPromptMode = autoPromptMode;
    stApi.power_user.sysprompt = { content: '' };
    stApi.power_user.context = { story_string: '' };
    delete stApi.extension_settings.note;
    stApi.setTestContext({ chat: [], chatMetadata: {} });
    stApi.setTestPromptManager(null);
    stApi.extensionPromptCalls.length = 0;
}

test('no macro anywhere leaves the injected mode alone', () => {
    reset();
    stApi.setTestContext({ chat: [], chatMetadata: {}, chatCompletionSettings: { prompts: [{ content: 'Write a story.' }] } });
    assert.equal(promptHasDialogueColorsMacro(), false);
    assert.equal(getEffectivePromptMode(), 'inject');
});

test('the macro is detected in every scanned prompt source', () => {
    for (const seed of [
        () => { stApi.power_user.sysprompt = { content: 'Be helpful. {{dialoguecolors}}' }; },
        () => { stApi.power_user.context = { story_string: '{{dialoguecolors}}\n{{description}}' }; },
        () => stApi.setTestContext({ chat: [], chatMetadata: { note_prompt: 'Remember: {{dialoguecolors}}' } }),
        () => { stApi.extension_settings.note = { default: '{{dialoguecolors}}' }; },
        () => stApi.setTestPromptManager({
            activeCharacter: { id: 1 },
            getPromptsForCharacter: (character, onlyEnabled) => onlyEnabled ? [{ content: 'Main prompt.' }, { content: 'Colors: {{ DialogueColors }}' }] : [],
        }),
    ]) {
        reset();
        seed();
        assert.equal(promptHasDialogueColorsMacro(), true);
        assert.equal(getEffectivePromptMode(), 'macro');
    }
});

test('a detected macro suppresses the automatic injection', () => {
    reset();
    const injected = flushPromptInjection();
    assert.match(injected, /Dialogue Colors/);

    reset();
    stApi.power_user.sysprompt = { content: '{{dialoguecolors}}' };
    assert.equal(flushPromptInjection(), '');
    assert.equal(stApi.extensionPromptCalls.at(-1)[1], '');
});

test('detection only overrides inject mode, and only while the option is on', () => {
    reset({ autoPromptMode: false });
    stApi.power_user.sysprompt = { content: '{{dialoguecolors}}' };
    assert.equal(getEffectivePromptMode(), 'inject');
    assert.match(flushPromptInjection(), /Dialogue Colors/);

    reset({ promptMode: 'macro', autoPromptMode: false });
    assert.equal(getEffectivePromptMode(), 'macro');
});

test('the colorize profile mode sends nothing to the reply model', () => {
    reset({ promptMode: 'profile' });
    assert.equal(getEffectivePromptMode(), 'profile');
    assert.equal(flushPromptInjection(), '');
    assert.equal(stApi.extensionPromptCalls.at(-1)[1], '', 'an injection left over from inject mode is cleared');

    // The reply model is not doing the coloring in this mode, so a macro sitting in a preset
    // must not deliver the instruction behind its back.
    reset({ promptMode: 'profile' });
    stApi.power_user.sysprompt = { content: '{{dialoguecolors}}' };
    assert.equal(promptHasDialogueColorsMacro(), true);
    assert.equal(getEffectivePromptMode(), 'profile');
    assert.equal(flushPromptInjection(), '');
});

test('the DOM engine ignores prompt modes entirely', () => {
    reset();
    settings.coloringEngine = 'dom';
    settings.domStealthColors = false;
    stApi.power_user.sysprompt = { content: '{{dialoguecolors}}' };
    assert.equal(flushPromptInjection(), '');
});

test('dialogue color metadata instructions stay compact and singular', () => {
    const previousColors = { ...characterColors };
    const previousPersonas = stApi.power_user.personas;
    try {
        reset();
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        characterColors.dawn = { name: 'Dawn', color: '#112233', aliases: ['Sunrise'] };
        characterColors.kris = { name: 'Kris', color: '#445566', aliases: [] };
        stApi.power_user.personas = { 'dawn.png': 'Dawn', 'kris.png': 'Kris' };
        stApi.setTestContext({ chat: [], chatMetadata: {}, name1: 'Dawn', userAvatar: 'dawn.png' });

        const prompts = [
            { text: buildMinimalPromptInstruction(), wording: /including known speakers/ },
            { text: buildDomStealthColorsInstruction(), wording: /not already listed in Known colors/ },
        ];
        for (const { text: prompt, wording } of prompts) {
            assert.match(prompt, /Dawn\(Sunrise\)=#112233/);
            assert.doesNotMatch(prompt, /Kris/);
            assert.match(prompt, wording);
            assert.equal(prompt.split('\n').filter(line => line.includes('[COLORS:')).length, 1);
            assert.equal(prompt.split('\n').filter(line => line.includes('final')).length, 1);
            assert.doesNotMatch(prompt, /Reuse those exact names|If there are no new speakers|The \[COLORS:/);
        }
        assert.match(buildColoredPromptPreview(), /Dawn/);
        assert.doesNotMatch(buildColoredPromptPreview(), /Kris/);
    } finally {
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        if (previousPersonas === undefined) delete stApi.power_user.personas;
        else stApi.power_user.personas = previousPersonas;
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

// SillyBunny ships a preset whose README prompt says "added `{{dialoguecolors}}`"
// inside a {{// ...}} comment; the model never sees a comment, so it is not delivery.
const README_COMMENT = '{{// README\n- Formatting: added `{{dialoguecolors}}`. Remove it if you do not use it.}}{{trim}}';

test('a macro mentioned inside a {{// }} comment does not switch to macro mode', () => {
    for (const seed of [
        () => stApi.setTestPromptManager({
            activeCharacter: { id: 1 },
            getPromptsForCharacter: () => [{ content: README_COMMENT }, { content: 'Formatting rules.' }],
        }),
        () => { stApi.power_user.sysprompt = { content: `Be helpful. ${README_COMMENT}` }; },
        () => stApi.setTestContext({ chat: [], chatMetadata: { note_prompt: README_COMMENT } }),
    ]) {
        reset();
        seed();
        assert.equal(promptHasDialogueColorsMacro(), false);
        assert.equal(getEffectivePromptMode(), 'inject');
        assert.match(flushPromptInjection(), /Dialogue Colors/);
    }
});

test('a live macro next to a commented mention still counts', () => {
    reset();
    stApi.setTestPromptManager({
        activeCharacter: { id: 1 },
        getPromptsForCharacter: () => [{ content: README_COMMENT }, { content: 'Formatting:\n- {{getvar::length}}\n- {{dialoguecolors}}' }],
    });
    assert.equal(promptHasDialogueColorsMacro(), true);
    assert.equal(getEffectivePromptMode(), 'macro');
    assert.equal(flushPromptInjection(), '');
});

test('stripMacroComments removes nested comments and keeps everything else', () => {
    assert.equal(stripMacroComments('a {{// x {{y}} {{z::{{w}}}} }} b'), 'a  b');
    assert.equal(stripMacroComments('{{//one}}{{//two}}keep {{macro}}'), 'keep {{macro}}');
    assert.equal(stripMacroComments('plain {{macro}} text'), 'plain {{macro}} text');
    // An unterminated comment is treated as dead through the end of the text.
    assert.equal(stripMacroComments('a {{// open {{dialoguecolors}}'), 'a ');
});

test('only preset prompts enabled in the active prompt order are scanned', () => {
    const prompts = [
        { identifier: 'colors', content: 'Colors: {{dialoguecolors}}' },
        { identifier: 'main', content: 'Main prompt.' },
    ];
    const enabled = new Set(['main']);
    const promptManager = {
        activeCharacter: { id: 100001 },
        getPromptsForCharacter: (character, onlyEnabled) => onlyEnabled ? prompts.filter(p => enabled.has(p.identifier)) : prompts,
    };
    reset();
    stApi.setTestPromptManager(promptManager);
    assert.equal(promptHasDialogueColorsMacro(), false);
    assert.equal(getEffectivePromptMode(), 'inject');

    enabled.add('colors');
    assert.equal(promptHasDialogueColorsMacro(), true);
    assert.equal(getEffectivePromptMode(), 'macro');

    // Without a usable prompt manager the raw preset list is NOT scanned: a
    // disabled prompt's macro must not silence the injection.
    reset();
    stApi.setTestPromptManager({ activeCharacter: null });
    assert.equal(promptHasDialogueColorsMacro(), false);
    assert.equal(getEffectivePromptMode(), 'inject');
    assert.match(flushPromptInjection(), /Dialogue Colors/);

    reset();
    stApi.setTestPromptManager({ activeCharacter: { id: 1 }, getPromptsForCharacter: () => { throw new Error('boom'); } });
    assert.equal(promptHasDialogueColorsMacro(), false);
    assert.equal(getEffectivePromptMode(), 'inject');
    assert.match(flushPromptInjection(), /Dialogue Colors/);
});
