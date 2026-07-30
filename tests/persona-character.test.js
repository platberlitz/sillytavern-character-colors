import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that
// only resolve inside a SillyTavern install. Stubbing that one module lets the real
// persona code run under node --test, and setTestContext stands in for the active
// persona that SillyTavern would otherwise report.
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

// Adding a character repaints the floating legend, so the DOM stub has to be just
// real enough for that pass to run without turning into the error path under test.
function createStubElement() {
    return {
        id: '',
        innerHTML: '',
        style: { cssText: '', display: 'none' },
        classList: { add() {}, remove() {}, contains: () => false },
        appendChild() {},
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        contains: () => false,
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    };
}

const stubElements = new Map();
globalThis.document ??= {
    body: createStubElement(),
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: id => stubElements.get(id) ?? null,
    createElement: () => {
        const element = createStubElement();
        // createLegend looks the node back up by id on later passes.
        Object.defineProperty(element, 'id', {
            get: () => element._id ?? '',
            set: value => { element._id = value; stubElements.set(value, element); },
        });
        return element;
    },
    addEventListener() {},
};
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });
globalThis.window ??= { innerWidth: 1024, innerHeight: 768, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.requestAnimationFrame ??= () => 0;
// Saving verifies itself against the SillyTavern settings endpoint, which is not here.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const { setTestContext } = await import(stApiUrl);
const { ensurePersonaCharacter, isPersonaEntry, renamePersonaCharacter } = await import('../src/ui.js');
const { isColorableMessage } = await import('../src/live-colors.js');
const { getPersonaName } = await import('../src/palettes.js');
// Saving replaces the registry object wholesale, so it has to be read off the module
// namespace rather than captured once.
const state = await import('../src/state.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };

function registry() {
    return state.characterColors;
}

function withPersona(personaName, run) {
    const previousColors = { ...registry() };
    for (const key of Object.keys(registry())) delete registry()[key];
    Object.assign(settings, DEFAULT_SETTINGS);
    setTestContext({ chat: [], chatMetadata: {}, name1: personaName });
    try {
        return run();
    } finally {
        for (const key of Object.keys(registry())) delete registry()[key];
        Object.assign(registry(), previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
        setTestContext({ chat: [], chatMetadata: {} });
    }
}

test('the active persona name comes from the SillyTavern context', () => {
    withPersona('Marisol', () => {
        assert.equal(getPersonaName(), 'Marisol');
    });
});

test('adding the persona creates exactly one entry', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        assert.deepEqual(Object.keys(registry()), ['marisol']);
        assert.equal(registry().marisol.name, 'Marisol');
    });
});

test('adding the persona twice does not duplicate it', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        ensurePersonaCharacter({ silent: true });
        ensurePersonaCharacter({ silent: true });
        assert.equal(Object.keys(registry()).length, 1);
    });
});

test('a persona already tracked under an alias is not added again', () => {
    withPersona('Marisol', () => {
        registry().mari = { name: 'Mari', aliases: ['Marisol'], baseColor: '#aabbcc', color: '#aabbcc' };
        ensurePersonaCharacter({ silent: true });
        assert.deepEqual(Object.keys(registry()), ['mari']);
    });
});

test('no persona means nothing is added', () => {
    withPersona('', () => {
        ensurePersonaCharacter({ silent: true });
        assert.deepEqual(Object.keys(registry()), []);
    });
});

test('a persona named Narrator is refused', () => {
    withPersona('Narrator', () => {
        ensurePersonaCharacter({ silent: true });
        assert.deepEqual(Object.keys(registry()), []);
    });
});

test('the persona entry is the one flagged as yours', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        registry().diego = { name: 'Diego', baseColor: '#aabbcc', color: '#aabbcc' };
        assert.equal(isPersonaEntry(registry().marisol), true);
        assert.equal(isPersonaEntry(registry().diego), false);
    });
});

test('an alias of the persona also counts as yours', () => {
    withPersona('Marisol', () => {
        registry().mari = { name: 'Mari', aliases: ['Marisol'], baseColor: '#aabbcc', color: '#aabbcc' };
        assert.equal(isPersonaEntry(registry().mari), true);
    });
});

test('renaming the persona moves its entry and keeps its color', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        const color = registry().marisol.color;
        assert.equal(renamePersonaCharacter('Marisol', 'Marisol Vega'), true);
        assert.equal(registry().marisol, undefined);
        assert.equal(registry()['marisol vega'].name, 'Marisol Vega');
        assert.equal(registry()['marisol vega'].color, color);
    });
});

test('renaming an untracked persona changes nothing', () => {
    withPersona('Marisol', () => {
        assert.equal(renamePersonaCharacter('Nobody', 'Someone'), false);
        assert.deepEqual(Object.keys(registry()), []);
    });
});

test('a rename onto an existing character is refused', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        registry().diego = { name: 'Diego', baseColor: '#aabbcc', color: '#aabbcc' };
        assert.equal(renamePersonaCharacter('Marisol', 'Diego'), false);
        assert.equal(registry().marisol.name, 'Marisol');
        assert.equal(registry().diego.name, 'Diego');
    });
});

test('the LLM engine leaves user messages alone by default', () => {
    withPersona('Marisol', () => {
        settings.autoPersonaCharacter = false;
        assert.equal(isColorableMessage({ is_user: true, name: 'Marisol' }), false);
    });
});

test('opting in lets the LLM engine color the persona own messages', () => {
    withPersona('Marisol', () => {
        settings.autoPersonaCharacter = true;
        ensurePersonaCharacter({ silent: true });
        assert.equal(isColorableMessage({ is_user: true, name: 'Marisol' }), true);
    });
});

test('opting in does not open up other user messages', () => {
    withPersona('Marisol', () => {
        settings.autoPersonaCharacter = true;
        ensurePersonaCharacter({ silent: true });
        assert.equal(isColorableMessage({ is_user: true, name: 'Diego' }), false);
        assert.equal(isColorableMessage({ is_user: true }), false);
    });
});

test('character messages stay colorable regardless of the setting', () => {
    withPersona('Marisol', () => {
        settings.autoPersonaCharacter = false;
        assert.equal(isColorableMessage({ is_user: false, name: 'Diego' }), true);
        settings.autoPersonaCharacter = true;
        assert.equal(isColorableMessage({ is_user: false, name: 'Diego' }), true);
    });
});

test('a missing message is never colorable', () => {
    assert.equal(isColorableMessage(null), false);
});

test('persona coloring stays off unless it is explicitly enabled', async () => {
    const source = await readFile(new URL('../src/live-colors.js', import.meta.url), 'utf8');
    const start = source.indexOf('export function isColorableMessage(');
    const section = source.slice(start, source.indexOf('\n}', start));
    assert.match(section, /settings\.autoPersonaCharacter\s*!==\s*true/);
});
