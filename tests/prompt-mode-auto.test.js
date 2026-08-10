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

const { flushPromptInjection, getEffectivePromptMode, promptHasDialogueColorsMacro } = await import('../src/prompts.js');
const { settings } = await import('../src/state.js');
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
        () => stApi.setTestContext({
            chat: [],
            chatMetadata: {},
            chatCompletionSettings: { prompts: [{ content: 'Main prompt.' }, { content: 'Colors: {{ DialogueColors }}' }] },
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

test('the DOM engine ignores prompt modes entirely', () => {
    reset();
    settings.coloringEngine = 'dom';
    settings.domStealthColors = false;
    stApi.power_user.sysprompt = { content: '{{dialoguecolors}}' };
    assert.equal(flushPromptInjection(), '');
});
