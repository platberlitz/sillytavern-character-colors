import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

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
export const promptManager = null;
`;

function createStubElement() {
    return {
        id: '',
        innerHTML: '',
        style: { cssText: '', display: 'none' },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
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

const localStorageValues = new Map();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        get length() { return localStorageValues.size; },
        clear() { localStorageValues.clear(); },
        getItem(key) { return localStorageValues.has(key) ? localStorageValues.get(key) : null; },
        key(index) { return [...localStorageValues.keys()][index] ?? null; },
        removeItem(key) { localStorageValues.delete(key); },
        setItem(key, value) { localStorageValues.set(key, String(value)); },
    },
});
globalThis.document ??= {
    body: createStubElement(),
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => createStubElement(),
    addEventListener() {},
};

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const { buildCharRowHtml } = await import('../src/ui.js');
const state = await import('../src/state.js');
const { resolveVisual } = await import('../src/visual-resolver.js');

function makeEntry({ color, stopColor }) {
    return {
        name: 'Cinder',
        baseColor: color,
        color,
        gradient: {
            type: 'linear',
            primaryPosition: 0,
            stops: [{ baseColor: stopColor, color: stopColor, position: 100 }],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    };
}

test('an expanded row renders the gradient editor when readability flattening collapses the gradient to a solid visual', () => {
    const entry = makeEntry({ color: '#ff00ff', stopColor: '#ff00ff' });
    assert.equal(resolveVisual(entry).gradientCss, null);
    state.expandedCharacterRows.add('cinder');
    try {
        const html = buildCharRowHtml('cinder', entry);
        assert.match(html, /dc-gradient-editor/);
        assert.match(html, /data-gradient-enabled="true"/);
        assert.match(html, /dc-gradient-secondary-color/);
    } finally {
        state.expandedCharacterRows.clear();
    }
});

test('an expanded row renders the gradient editor when an active color-vision preview collapses the gradient ramp', () => {
    const simulation = { mode: 'achromatopsia', severity: 100 };
    const entry = makeEntry({ color: '#32003c', stopColor: '#32003c' });
    const previous = {
        mode: state.settings.colorVisionPreviewMode,
        severity: state.settings.colorVisionPreviewSeverity,
        target: state.settings.colorVisionPreviewTarget,
    };
    state.settings.colorVisionPreviewMode = 'achromatopsia';
    state.settings.colorVisionPreviewSeverity = 100;
    state.settings.colorVisionPreviewTarget = 'ui';
    state.expandedCharacterRows.add('cinder');
    try {
        assert.equal(resolveVisual(entry, { colorVision: simulation }).gradientCss, null);
        const html = buildCharRowHtml('cinder', entry);
        assert.match(html, /dc-gradient-editor/);
        assert.match(html, /data-gradient-enabled="true"/);
    } finally {
        state.expandedCharacterRows.clear();
        state.settings.colorVisionPreviewMode = previous.mode;
        state.settings.colorVisionPreviewSeverity = previous.severity;
        state.settings.colorVisionPreviewTarget = previous.target;
    }
});

test('a visible gradient still renders with its presentation classes and attributes', () => {
    const entry = makeEntry({ color: '#000000', stopColor: '#ffffff' });
    assert.notEqual(resolveVisual(entry).gradientCss, null);
    state.expandedCharacterRows.add('cinder');
    try {
        const html = buildCharRowHtml('cinder', entry);
        assert.match(html, /dc-has-gradient/);
        assert.match(html, /data-dc-gradient="linear"/);
    } finally {
        state.expandedCharacterRows.clear();
    }
});
