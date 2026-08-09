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

const stubElements = new Map();
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
globalThis.toastr ??= { info() {}, success() {}, warning() {}, error() {} };
// Saving verifies itself against the SillyTavern settings endpoint, which is not here.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const stApi = await import(stApiUrl);
const { setTestContext } = stApi;
const { addCharacter, createCanvasGradientFill, ensurePersonaCharacter, exportLegendPng, isPersonaEntry, renamePersonaCharacter, updateLegend } = await import('../src/ui.js');
const { isColorableMessage } = await import('../src/live-colors.js');
const { getPersonaName } = await import('../src/palettes.js');
const {
    CHAT_SCOPE_METADATA_KEY,
    analyzeColorImport,
    analyzeSettingsImport,
    analyzeStylePackImport,
    applySettingsImport,
    applyStylePackImport,
    applyStoredColorData,
    buildAutoSyncRecord,
    buildPortableSettingsSnapshot,
    getAutoSyncRecord,
    getPinnedPersonaColors,
    getStorageScopeDescriptor,
    loadData,
    migrateColorSchemaIfNeeded,
    normalizeStoredSettings,
    pinCurrentPersonaColor,
    renamePinnedPersonaColor,
    restorePinnedPersonaColor,
    saveData,
    tryLoadFromCard,
} = await import('../src/storage.js');
const { createRestoreSnapshot } = await import('../src/history.js');
const { isReservedCharacterIdentity, renameGroupProfile } = await import('../src/group-profiles.js');
// Saving replaces the registry object wholesale, so it has to be read off the module
// namespace rather than captured once.
const state = await import('../src/state.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };

function registry() {
    return state.characterColors;
}

test('canvas conic gradients use the CSS angle origin and configured pivot', () => {
    const calls = [];
    const fill = { addColorStop(offset, color) { calls.push(['stop', offset, color]); } };
    const ctx = {
        createConicGradient(angle, x, y) {
            calls.push(['conic', angle, x, y]);
            return fill;
        },
    };
    const result = createCanvasGradientFill(ctx, {
        color: '#ff0000',
        gradient: {
            type: 'conic',
            angle: 0,
            x: 25,
            y: 75,
            primaryPosition: 0,
            stops: [{ color: '#0000ff', position: 100 }],
        },
    }, { x: 10, y: 20, width: 200, height: 100 });

    assert.equal(result, fill);
    assert.deepEqual(calls[0], ['conic', -Math.PI / 2, 60, 95]);
    assert.deepEqual(calls.slice(1), [
        ['stop', 0, '#ff0000'],
        ['stop', 1, '#0000ff'],
    ]);
});

test('force-bold invalidates and redraws floating legend typography', () => {
    const previousColors = structuredClone(registry());
    const previousShowLegend = settings.showLegend;
    const previousForceBold = settings.forceBoldText;
    try {
        state.setCharacterColors({ Alice: { name: 'Alice', color: '#112233', baseColor: '#112233' } });
        settings.showLegend = true;
        settings.forceBoldText = false;
        updateLegend();
        const legend = stubElements.get('dc-legend-float');
        assert.ok(legend);
        assert.doesNotMatch(legend.innerHTML, /font-weight:bold/);

        settings.forceBoldText = true;
        updateLegend();
        assert.match(legend.innerHTML, /font-weight:bold/);
    } finally {
        settings.showLegend = false;
        updateLegend();
        stubElements.delete('dc-legend-float');
        settings.showLegend = previousShowLegend;
        settings.forceBoldText = previousForceBold;
        state.setCharacterColors(previousColors);
    }
});

test('PNG legend waits for the remote stylesheet and font face before measuring', async () => {
    const previousColors = structuredClone(registry());
    const previousSettings = structuredClone(settings);
    const previousCreateElement = document.createElement;
    const previousQuerySelectorAll = document.querySelectorAll;
    const previousHead = document.head;
    const previousFonts = document.fonts;
    const events = [];
    const links = [];
    const context = {
        beginPath() {},
        arc() {},
        fill() {},
        fillRect() {},
        fillText() { events.push('draw-text'); },
        measureText() { events.push('measure'); return { width: 40 }; },
    };
    const createLink = () => {
        const listeners = { load: [], error: [] };
        return {
            dataset: {},
            disabled: false,
            addEventListener(type, listener) { listeners[type]?.push(listener); },
            hasAttribute() { return false; },
            remove() {},
            dispatch(type) {
                const handler = this[`on${type}`];
                handler?.();
                listeners[type]?.forEach(listener => listener());
            },
        };
    };
    try {
        state.setCharacterColors({ Alice: {
            name: 'Alice',
            color: '#112233',
            baseColor: '#112233',
            font: 'Final Review Font',
        } });
        settings.allowRemoteFonts = true;
        settings.themeMode = 'light';
        settings.colorVisionPreviewMode = 'none';
        settings.narratorStyle = { ...settings.narratorStyle, enabled: false };
        document.querySelectorAll = selector => selector.includes('data-dc-google-font') ? links : [];
        document.head = {
            appendChild(link) {
                links.push(link);
                events.push('stylesheet-request');
                queueMicrotask(() => {
                    events.push('stylesheet-load');
                    link.dispatch('load');
                });
            },
        };
        document.fonts = {
            async load() {
                events.push('font-face-start');
                await Promise.resolve();
                events.push('font-face-ready');
                return [];
            },
        };
        document.createElement = tag => {
            if (tag === 'link') return createLink();
            if (tag === 'canvas') return {
                getContext: () => context,
                toDataURL: () => 'data:image/png;base64,test',
            };
            if (tag === 'a') return { click() { events.push('download'); } };
            return previousCreateElement(tag);
        };

        await exportLegendPng();
        assert.ok(events.indexOf('stylesheet-load') < events.indexOf('font-face-start'));
        assert.ok(events.indexOf('font-face-ready') < events.indexOf('measure'));
        assert.ok(events.indexOf('measure') < events.indexOf('download'));
    } finally {
        document.createElement = previousCreateElement;
        document.querySelectorAll = previousQuerySelectorAll;
        if (previousHead === undefined) delete document.head;
        else document.head = previousHead;
        if (previousFonts === undefined) delete document.fonts;
        else document.fonts = previousFonts;
        Object.assign(settings, previousSettings);
        state.setCharacterColors(previousColors);
    }
});

function withPersona(personaName, run) {
    const previousColors = { ...registry() };
    for (const key of Object.keys(registry())) delete registry()[key];
    Object.assign(settings, DEFAULT_SETTINGS);
    const pins = getPinnedPersonaColors();
    for (const key of Object.keys(pins)) delete pins[key];
    setTestContext({ chat: [], chatMetadata: {}, name1: personaName });
    try {
        return run();
    } finally {
        for (const key of Object.keys(getPinnedPersonaColors())) delete getPinnedPersonaColors()[key];
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

test('reserved narrator identities are refused by manual and persona creation', () => {
    for (const name of ['Narrator', '__narrator__']) {
        withPersona(name, () => {
            ensurePersonaCharacter({ silent: true });
            assert.deepEqual(Object.keys(registry()), []);
            assert.equal(addCharacter(name), undefined);
            assert.deepEqual(Object.keys(registry()), []);
        });
    }
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

test('persona rekeys refuse every reserved narrator identity', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        for (const reserved of ['Narrator', '__narrator__']) {
            assert.equal(renamePersonaCharacter('Marisol', reserved), false);
            assert.equal(registry().marisol.name, 'Marisol');
            assert.equal(registry()[reserved.toLowerCase()], undefined);
        }
    });
});

test('the persona color is only pinned once the option is on', () => {
    withPersona('Marisol', () => {
        ensurePersonaCharacter({ silent: true });
        assert.equal(pinCurrentPersonaColor(), false);
        assert.deepEqual(getPinnedPersonaColors(), {});
        settings.persistPersonaColor = true;
        assert.equal(pinCurrentPersonaColor(), true);
        assert.equal(getPinnedPersonaColors().marisol.baseColor, registry().marisol.baseColor);
    });
});

test('a new scope gets the pinned persona color back, exactly', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        registry().marisol.baseColor = '#ff00aa';
        registry().marisol.color = '#ff00aa';
        pinCurrentPersonaColor();
        // A scope switch wipes the registry and reloads whatever that scope stored.
        for (const key of Object.keys(registry())) delete registry()[key];
        registry().diego = { name: 'Diego', baseColor: '#ff00aa', color: '#ff00aa' };
        assert.equal(restorePinnedPersonaColor(), true);
        assert.equal(registry().marisol.name, 'Marisol');
        assert.equal(registry().marisol.baseColor, '#ff00aa');
    });
});

test('restoring overwrites a color the new scope had for the persona', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        registry().marisol.baseColor = '#ff00aa';
        registry().marisol.color = '#ff00aa';
        pinCurrentPersonaColor();
        registry().marisol.baseColor = '#123456';
        registry().marisol.color = '#123456';
        assert.equal(restorePinnedPersonaColor(), true);
        assert.equal(registry().marisol.baseColor, '#ff00aa');
        assert.equal(restorePinnedPersonaColor(), false);
    });
});

test('each persona keeps its own pin', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        registry().marisol.baseColor = '#ff00aa';
        registry().marisol.color = '#ff00aa';
        pinCurrentPersonaColor();
        setTestContext({ chat: [], chatMetadata: {}, name1: 'Diego' });
        ensurePersonaCharacter({ silent: true });
        registry().diego.baseColor = '#00ccdd';
        registry().diego.color = '#00ccdd';
        pinCurrentPersonaColor();
        assert.equal(getPinnedPersonaColors().marisol.baseColor, '#ff00aa');
        assert.equal(getPinnedPersonaColors().diego.baseColor, '#00ccdd');
    });
});

test('nothing is restored while the option is off', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        pinCurrentPersonaColor();
        settings.persistPersonaColor = false;
        for (const key of Object.keys(registry())) delete registry()[key];
        assert.equal(restorePinnedPersonaColor(), false);
        assert.deepEqual(Object.keys(registry()), []);
    });
});

test('renaming the persona carries its pin along', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        registry().marisol.baseColor = '#ff00aa';
        registry().marisol.color = '#ff00aa';
        pinCurrentPersonaColor();
        assert.equal(renamePinnedPersonaColor('Marisol', 'Marisol Vega'), true);
        assert.equal(getPinnedPersonaColors().marisol, undefined);
        assert.equal(getPinnedPersonaColors()['marisol vega'].name, 'Marisol Vega');
        assert.equal(getPinnedPersonaColors()['marisol vega'].baseColor, '#ff00aa');
    });
});

test('persona pins migrate from display name through avatar to persona ID', () => {
    withPersona('Marisol', () => {
        settings.persistPersonaColor = true;
        ensurePersonaCharacter({ silent: true });
        registry().marisol.baseColor = '#ff00aa';
        registry().marisol.color = '#ff00aa';
        pinCurrentPersonaColor();
        assert.ok(getPinnedPersonaColors().marisol);

        setTestContext({ chat: [], chatMetadata: {}, name1: 'Marisol', userAvatar: 'persona-a.png' });
        assert.equal(restorePinnedPersonaColor(), true);
        assert.equal(getPinnedPersonaColors().marisol, undefined);
        assert.equal(getPinnedPersonaColors()['avatar:persona-a.png'].baseColor, '#ff00aa');

        setTestContext({ chat: [], chatMetadata: {}, name1: 'Marisol', userAvatar: 'persona-a.png', personaId: 'persona-1' });
        assert.equal(restorePinnedPersonaColor(), true);
        assert.equal(getPinnedPersonaColors()['avatar:persona-a.png'], undefined);
        assert.equal(getPinnedPersonaColors()['persona:persona-1'].baseColor, '#ff00aa');

        assert.equal(renamePinnedPersonaColor('Marisol', 'Marisol Vega'), true);
        assert.equal(getPinnedPersonaColors()['persona:persona-1'].name, 'Marisol Vega');
    });
});

test('legacy stored tables enter schema-zero migration even with the current runtime schema', () => {
    withPersona('', () => {
        settings.colorSchemaVersion = state.COLOR_SCHEMA_VERSION;
        applyStoredColorData({
            colors: { Alice: { name: 'Alice', color: '#336699', baseColor: '#000000' } },
            settings: { themeMode: 'dark' },
        });
        assert.equal(settings.colorSchemaVersion, 0);
        assert.equal(migrateColorSchemaIfNeeded(), true);
        assert.equal(settings.colorSchemaVersion, state.COLOR_SCHEMA_VERSION);
        assert.notEqual(registry().alice.baseColor, '#000000');
    });
});

test('stored settings normalize every active value and portable snapshots omit profile IDs', () => {
    const normalized = normalizeStoredSettings({
        enabled: 'no',
        themeMode: 'sideways',
        colorTheme: ` custom:${'x'.repeat(200)} `,
        brightness: 900,
        thoughtSymbols: 'x'.repeat(100),
        promptDepth: -20,
        promptRole: 'assistant',
        promptMode: 'other',
        coloringEngine: 'other',
        gradientRandomMasterSeed: 's'.repeat(200),
        colorVisionPreviewMode: 'unknown',
        colorVisionPreviewSeverity: -5,
        colorVisionPreviewTarget: 'unknown',
        gradientAnimationMode: 'unknown',
        attributionReviewPolicy: 'unsafe',
        attributionMaxTokens: 999999,
        attributionVerifyPasses: 99,
        sortMode: 'unknown',
        colorSchemaVersion: 999,
        narratorStyle: {
            enabled: true,
            baseColor: '#123456',
            gradient: { type: 'linear', stops: [{ color: '#654321', position: 100 }] },
            gradientGenerator: { seed: 'n'.repeat(200), iteration: 2 },
        },
        llmConnectionProfile: { id: 'bad' },
        attributionConnectionProfile: 'p'.repeat(400),
    });

    assert.equal(normalized.enabled, false);
    assert.equal(normalized.themeMode, 'auto');
    assert.equal(normalized.colorTheme.length, 127);
    assert.equal(normalized.brightness, 100);
    assert.equal(normalized.thoughtSymbols.length, 64);
    assert.equal(normalized.promptDepth, 0);
    assert.equal(normalized.promptRole, 'system');
    assert.equal(normalized.promptMode, 'inject');
    assert.equal(normalized.coloringEngine, 'llm');
    assert.equal(normalized.gradientRandomMasterSeed.length, 128);
    assert.equal(normalized.colorVisionPreviewMode, 'none');
    assert.equal(normalized.colorVisionPreviewSeverity, 0);
    assert.equal(normalized.colorVisionPreviewTarget, 'all');
    assert.equal(normalized.gradientAnimationMode, 'auto');
    assert.equal(normalized.attributionReviewPolicy, 'review');
    assert.equal(normalized.attributionMaxTokens, 32768);
    assert.equal(normalized.attributionVerifyPasses, 5);
    assert.equal(normalized.sortMode, 'name');
    assert.equal(normalized.colorSchemaVersion, state.COLOR_SCHEMA_VERSION);
    assert.equal(normalized.narratorStyle.gradientGenerator.seed.length, 128);
    assert.equal(normalized.llmConnectionProfile, null);
    assert.equal(normalized.attributionConnectionProfile.length, 256);
    // A key the source never mentions must not come back. colorStorageScope used to be emitted
    // unconditionally, which made every partial snapshot reset the storage scope to the default.
    assert.deepEqual(normalizeStoredSettings({
        promptDepth: null,
        colorVisionPreviewSeverity: null,
        attributionMaxTokens: null,
    }), {
        promptDepth: 1,
        colorVisionPreviewSeverity: 100,
        attributionMaxTokens: 4096,
    });
    assert.equal(normalizeStoredSettings({ colorStorageScope: 'chat' }).colorStorageScope, 'chat');
    assert.equal(normalizeStoredSettings({ colorStorageScope: 'nonsense' }).colorStorageScope, 'card');
    // shareColorsGlobally is the pre-scope spelling and still has to migrate.
    assert.equal(normalizeStoredSettings({ shareColorsGlobally: true }).colorStorageScope, 'global');

    const previousProfiles = [settings.llmConnectionProfile, settings.attributionConnectionProfile];
    settings.llmConnectionProfile = 'local-main';
    settings.attributionConnectionProfile = 'local-review';
    try {
        const portable = buildPortableSettingsSnapshot();
        assert.equal(Object.hasOwn(portable, 'llmConnectionProfile'), false);
        assert.equal(Object.hasOwn(portable, 'attributionConnectionProfile'), false);
        assert.equal(Object.hasOwn(portable, 'attributionMaxTokens'), true);
        assert.equal(Object.hasOwn(portable, 'attributionVerifyPasses'), true);
        assert.equal(Object.hasOwn(portable, 'sortMode'), true);
    } finally {
        [settings.llmConnectionProfile, settings.attributionConnectionProfile] = previousProfiles;
    }
});

test('group-profile rename relabels matching members in the same state update', () => {
    const previousColors = structuredClone(registry());
    const previousProfiles = structuredClone(state.groupProfiles);
    try {
        state.setCharacterColors({
            Alice: { name: 'Alice', color: '#112233', group: 'Old Team' },
            Bob: { name: 'Bob', color: '#445566', group: 'Other Team' },
        });
        state.setGroupProfiles({ old: { name: 'Old Team', style: { fields: 0 } } });
        state.setGroupProfiles(renameGroupProfile(state.groupProfiles, 'old team', 'New Team'));
        assert.equal(state.groupProfiles['new team'].name, 'New Team');
        assert.equal(registry().alice.group, 'New Team');
        assert.equal(registry().bob.group, 'Other Team');
    } finally {
        state.setCharacterColors(previousColors);
        state.setGroupProfiles(previousProfiles);
    }
});

test('canonical owners beat aliases and ambiguous aliases fail closed', () => {
    const previousColors = structuredClone(registry());
    try {
        state.setCharacterColors({
            Alice: { name: 'Alice', color: '#112233', aliases: ['Shared'] },
            Bob: { name: 'Bob', color: '#445566', aliases: ['Shared', 'Ａｌｉｃｅ'] },
        });
        assert.deepEqual(registry().alice.aliases, []);
        assert.deepEqual(registry().bob.aliases, []);
    } finally {
        state.setCharacterColors(previousColors);
    }
});

test('schema-nine reserved character identities migrate before strict normalization', () => {
    const previousColors = structuredClone(registry());
    try {
        const migrated = buildAutoSyncRecord({
            version: 9,
            colorData: {
                dc_global: {
                    colors: {
                        sentinel: { name: '__narrator__', color: '#112233' },
                        occupied: { name: '__narrator__ (legacy)', color: '#445566' },
                        narrator: { name: 'Narrator', color: '#778899' },
                    },
                    settings: { colorSchemaVersion: 9 },
                },
                dc_char_alias: {
                    colors: {
                        alice: { name: 'Alice', color: '#99aabb', aliases: ['__narrator__'] },
                    },
                    settings: { colorSchemaVersion: 9 },
                },
            },
        });

        assert.equal(migrated.version, state.COLOR_SCHEMA_VERSION);
        state.setCharacterColors(migrated.colorData.dc_global.colors);
        const entries = Object.values(registry());
        assert.equal(entries.length, 3);
        assert.deepEqual(new Set(entries.map(entry => entry.color)), new Set(['#112233', '#445566', '#778899']));
        assert.ok(entries.every(entry => !isReservedCharacterIdentity(entry.name)));
        assert.deepEqual(entries.map(entry => entry.name).sort(), [
            'Narrator (legacy)',
            '__narrator__ (legacy)',
            '__narrator__ (legacy) (2)',
        ].sort());
        state.setCharacterColors(migrated.colorData.dc_char_alias.colors);
        assert.deepEqual(registry().alice.aliases, ['__narrator__ (legacy)']);
        assert.equal(migrated.ui.identitySchemaMigration.version, state.COLOR_SCHEMA_VERSION);
    } finally {
        state.setCharacterColors(previousColors);
    }
});

test('color imports validate global canonical and alias ownership', async () => {
    setTestContext({ chat: [], chatMetadata: {} });
    const canonicalWins = await analyzeColorImport(JSON.stringify({
        version: state.COLOR_SCHEMA_VERSION,
        colors: {
            Alice: { name: 'Alice', color: '#112233' },
            Bob: { name: 'Bob', color: '#445566', aliases: ['Ａｌｉｃｅ'] },
        },
    }));
    assert.equal(canonicalWins.ok, true);
    assert.deepEqual(canonicalWins.payload.colors.bob.aliases, []);

    const ambiguous = await analyzeColorImport(JSON.stringify({
        version: state.COLOR_SCHEMA_VERSION,
        colors: {
            Alice: { name: 'Alice', color: '#112233', aliases: ['Shared'] },
            Bob: { name: 'Bob', color: '#445566', aliases: ['Ｓｈａｒｅｄ'] },
        },
    }));
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.error, 'identity_collision');

    for (const reserved of ['Narrator', '__narrator__']) {
        const analysis = await analyzeColorImport(JSON.stringify({
            version: state.COLOR_SCHEMA_VERSION,
            colors: { Reserved: { name: reserved, color: '#112233' } },
        }));
        assert.equal(analysis.ok, false);
        assert.equal(analysis.error, 'reserved_identity');
    }
});

test('portable enabled imports invoke lifecycle synchronization after applying state', async () => {
    const previousRecord = structuredClone(stApi.extension_settings[state.MODULE_NAME]);
    const previousSettings = structuredClone(settings);
    const previousFetch = globalThis.fetch;
    let lifecycleCalls = 0;
    try {
        setTestContext({ chat: [], chatMetadata: {}, characterId: 0, characters: [{ avatar: 'card.png' }] });
        settings.enabled = true;
        stApi.extension_settings[state.MODULE_NAME] = buildAutoSyncRecord({
            ...getAutoSyncRecord(true),
            globalSettings: buildPortableSettingsSnapshot(),
            legacyLocalStorageMigrated: true,
        });
        loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
        state.setEnabledLifecycleSynchronizer(() => { lifecycleCalls++; });
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
        });

        const analysis = await analyzeSettingsImport(JSON.stringify({
            version: state.COLOR_SCHEMA_VERSION,
            settings: { enabled: false },
        }));
        assert.equal(analysis.ok, true);
        const result = await applySettingsImport(analysis.payload, { mode: 'merge', applyScope: false });
        assert.equal(result.ok, true);
        assert.equal(settings.enabled, false);
        assert.equal(lifecycleCalls, 1);
    } finally {
        state.setEnabledLifecycleSynchronizer(null);
        globalThis.fetch = previousFetch;
        if (previousRecord === undefined) delete stApi.extension_settings[state.MODULE_NAME];
        else stApi.extension_settings[state.MODULE_NAME] = previousRecord;
        Object.assign(settings, previousSettings);
        setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('library-only style-pack install survives a chat and card context change', async () => {
    const previousRecord = structuredClone(stApi.extension_settings[state.MODULE_NAME]);
    const previousFetch = globalThis.fetch;
    try {
        setTestContext({ chat: [], chatMetadata: {}, characterId: 0, characters: [{ avatar: 'first.png' }] });
        const analysis = await analyzeStylePackImport(JSON.stringify({
            format: 'dialogue-colors-style-pack',
            formatVersion: 1,
            metadata: { name: 'Portable library' },
            palettes: { Library: ['#112233', '#445566'] },
        }));
        assert.equal(analysis.ok, true);
        setTestContext({ chat: [], chatMetadata: {}, characterId: 0, characters: [{ avatar: 'second.png' }] });
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
        });

        const result = await applyStylePackImport(analysis);
        assert.equal(result.ok, true);
        assert.equal(result.installed, 1);
    } finally {
        globalThis.fetch = previousFetch;
        if (previousRecord === undefined) delete stApi.extension_settings[state.MODULE_NAME];
        else stApi.extension_settings[state.MODULE_NAME] = previousRecord;
        setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('style-pack replace with an empty assignment preset clears the table', async () => {
    const previousColors = structuredClone(registry());
    const previousFetch = globalThis.fetch;
    const previousRecord = structuredClone(stApi.extension_settings['dialogue-colors']);
    const previousHistory = [...state.colorHistory];
    const previousHistoryIndex = state.historyIndex;
    try {
        setTestContext({ chat: [], chatMetadata: {}, name1: 'User' });
        loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
        state.setCharacterColors({ Alice: { name: 'Alice', color: '#112233' } });
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                settings: JSON.stringify({ extension_settings: stApi.extension_settings }),
            }),
        });
        const analysis = await analyzeStylePackImport(JSON.stringify({
            format: 'dialogue-colors-style-pack',
            formatVersion: 1,
            metadata: { name: 'Empty cast' },
            assignmentPresets: { Empty: [] },
        }));
        assert.equal(analysis.ok, true);
        const result = await applyStylePackImport(analysis, {
            applyAssignments: true,
            assignmentApplyMode: 'replace',
        });
        assert.equal(result.ok, true);
        assert.deepEqual(Object.keys(registry()), []);
        assert.equal(state.historyIndex, 0);
        assert.equal(state.colorHistory.length, 1);
    } finally {
        globalThis.fetch = previousFetch;
        state.setCharacterColors(previousColors);
        state.setColorHistory(previousHistory);
        state.setHistoryIndex(previousHistoryIndex);
        if (previousRecord === undefined) delete stApi.extension_settings['dialogue-colors'];
        else stApi.extension_settings['dialogue-colors'] = previousRecord;
    }
});

test('automatic card color seeding preserves scoped group profiles', () => {
    const previousColors = structuredClone(registry());
    const previousProfiles = structuredClone(state.groupProfiles);
    try {
        state.setCharacterColors({});
        state.setGroupProfiles({ scoped: { name: 'Scoped Group', style: { fields: 0 } } });
        setTestContext({
            chat: [],
            chatMetadata: {},
            characterId: 0,
            characters: [{
                avatar: 'card.png',
                data: { extensions: { dialogueColors: {
                    colors: { Alice: { name: 'Alice', color: '#336699' } },
                    groupProfiles: { card: { name: 'Card Group', style: { fields: 0 } } },
                } } },
            }],
        });
        tryLoadFromCard();
        assert.equal(registry().alice.name, 'Alice');
        assert.deepEqual(Object.keys(state.groupProfiles), ['scoped group']);
    } finally {
        state.setCharacterColors(previousColors);
        state.setGroupProfiles(previousProfiles);
        setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('per-chat scope inspection does not stamp chat metadata', () => {
    const chatMetadata = {};
    setTestContext({ chat: [], chatMetadata, characterId: 0, characters: [{ avatar: 'card.png' }] });
    try {
        getStorageScopeDescriptor('chat');
        assert.equal(Object.hasOwn(chatMetadata, CHAT_SCOPE_METADATA_KEY), false);
    } finally {
        setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('toast restore reverts only operation-touched fields', () => {
    const previousColors = structuredClone(registry());
    try {
        state.setCharacterColors({ Alice: { name: 'Alice', color: '#112233', baseColor: '#112233', aliases: [] } });
        const restore = createRestoreSnapshot();
        registry().alice.color = '#445566';
        registry().alice.baseColor = '#445566';
        restore.capture();
        registry().alice.aliases = ['Later edit'];
        registry().bob = { name: 'Bob', color: '#778899', baseColor: '#778899', aliases: [] };
        restore();
        assert.equal(registry().alice.baseColor, '#112233');
        assert.deepEqual(registry().alice.aliases, ['Later edit']);
        assert.equal(registry().bob.name, 'Bob');
    } finally {
        state.setCharacterColors(previousColors);
    }
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

test('connection profile IDs migrate and reload only from device-local storage', () => {
    const moduleName = state.MODULE_NAME;
    const previousRecord = structuredClone(stApi.extension_settings[moduleName]);
    const previousSettings = structuredClone(settings);
    const previousColors = structuredClone(registry());
    const previousProfiles = structuredClone(state.groupProfiles);
    localStorage.clear();
    try {
        stApi.extension_settings[moduleName] = {
            version: 9,
            globalSettings: {
                colorStorageScope: 'card',
                colorSchemaVersion: 9,
                llmConnectionProfile: 'legacy-main',
                attributionConnectionProfile: 'legacy-review',
            },
            colorData: {},
        };
        settings.llmConnectionProfile = null;
        settings.attributionConnectionProfile = null;

        const migrated = getAutoSyncRecord(true);
        assert.equal(Object.hasOwn(migrated.globalSettings, 'llmConnectionProfile'), false);
        assert.equal(Object.hasOwn(migrated.globalSettings, 'attributionConnectionProfile'), false);
        loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
        assert.equal(settings.llmConnectionProfile, 'legacy-main');
        assert.equal(settings.attributionConnectionProfile, 'legacy-review');

        settings.llmConnectionProfile = 'device-main';
        settings.attributionConnectionProfile = 'device-review';
        saveData({ skipAutoSync: true });
        settings.llmConnectionProfile = null;
        settings.attributionConnectionProfile = null;
        loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
        assert.equal(settings.llmConnectionProfile, 'device-main');
        assert.equal(settings.attributionConnectionProfile, 'device-review');
        assert.equal(Object.hasOwn(buildPortableSettingsSnapshot(), 'llmConnectionProfile'), false);
        assert.equal(Object.hasOwn(getAutoSyncRecord(true).settings, 'attributionConnectionProfile'), false);
    } finally {
        localStorage.clear();
        if (previousRecord === undefined) delete stApi.extension_settings[moduleName];
        else stApi.extension_settings[moduleName] = previousRecord;
        Object.assign(settings, previousSettings);
        state.setCharacterColors(previousColors);
        state.setGroupProfiles(previousProfiles);
        setTestContext({ chat: [], chatMetadata: {} });
    }
});
