import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const values = new Map();
const deviceStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: deviceStorage });

const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false, personas: {} };
export const escapeHtml = value => String(value);
export const escapeRegex = value => String(value).replace(/[/\\-\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
export const extension_settings = {};
let context = {};
export const getContext = () => context;
export const setTestContext = value => { context = value; };
export const eventSource = { on() {}, emit() {} };
export const event_types = {};
export const setExtensionPrompt = () => {};
export const saveSettings = async () => globalThis.__dcSaveSettings?.();
export const saveSettingsDebounced = () => {};
export const saveCharacterDebounced = () => {};
export const getCharacters = async () => globalThis.__dcGetCharacters?.();
export const extension_prompt_types = {};
export const extension_prompt_roles = {};
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = async () => {};
export const saveMetadataDebounced = () => {};
`;

globalThis.document ??= {};
const fakeElement = {
    style: {},
    dataset: {},
    children: [],
    firstElementChild: null,
    addEventListener() {},
    removeEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    insertBefore() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    contains: () => false,
    closest: () => null,
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} },
};
Object.assign(globalThis.document, {
    body: { ...fakeElement, children: [], ownerDocument: globalThis.document },
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: id => id === 'dc-char-list' ? fakeElement : null,
    addEventListener() {},
    removeEventListener() {},
    createElement: tag => tag === 'template' ? {
        content: { firstElementChild: { ...fakeElement, remove() {}, nextElementSibling: null } },
        innerHTML: '',
    } : ({
        click() {},
        style: {},
        dataset: {},
        append() {},
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        classList: { add() {}, remove() {}, toggle() {} },
    }),
});
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });
globalThis.toastr ??= { success() {}, error() {}, warning() {}, info() {} };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1024, innerHeight: 768 };
globalThis.requestAnimationFrame ??= callback => { callback(); return 1; };
globalThis.cancelAnimationFrame ??= () => {};

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const stApi = await import(stApiUrl);
const storage = await import('../src/storage.js');
const history = await import('../src/history.js');
const state = await import('../src/state.js');
hooks.deregister();

const { COLOR_SCHEMA_VERSION, MODULE_NAME, settings } = state;

globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
});

function character(name, color, extra = {}) {
    return {
        name,
        color,
        baseColor: color,
        aliases: [],
        dialogueCount: 0,
        group: '',
        style: '',
        font: '',
        gradient: null,
        gradientGenerator: null,
        locked: false,
        keep: false,
        ...extra,
    };
}

function context(avatar = 'card.png', extra = {}) {
    return {
        chat: [],
        chatMetadata: {},
        chatId: 'chat-1',
        characterId: 0,
        characters: [{ name: 'Card', avatar, data: { extensions: {} } }],
        ...extra,
    };
}

function reset(activeContext = context()) {
    values.clear();
    delete stApi.extension_settings[MODULE_NAME];
    stApi.setTestContext(activeContext);
    state.setCharacterColors({});
    state.setGroupProfiles({});
    state.setColorHistory([]);
    state.setHistoryIndex(-1);
    settings.colorStorageScope = 'card';
    settings.colorTheme = 'pastel';
    settings.persistPersonaColor = false;
    settings.keepPersonaCharacter = false;
    settings.keepCardCharacter = false;
    settings.disableToasts = true;
    storage.loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
}

test('legacy migration completion is device-local and waits for complete enumeration', () => {
    reset();
    values.set('dc_global', JSON.stringify({
        colors: { Alice: character('Alice', '#112233') },
        settings: { colorSchemaVersion: COLOR_SCHEMA_VERSION },
    }));
    stApi.extension_settings[MODULE_NAME] = {
        version: COLOR_SCHEMA_VERSION,
        colorData: {},
        legacyLocalStorageMigrated: true,
    };

    const first = storage.migrateLegacyLocalStorageIfNeeded();
    assert.equal(first.ok, true);
    assert.equal(first.migrated, true, 'a synced legacy flag must not suppress this device');
    assert.equal(storage.getAutoSyncRecord(true).colorData.dc_global.colors.alice.name, 'Alice');
    assert.equal(values.get(storage.LEGACY_LOCAL_STORAGE_MIGRATION_KEY), 'true');
    assert.equal(storage.migrateLegacyLocalStorageIfNeeded().migrated, false);

    values.delete(storage.LEGACY_LOCAL_STORAGE_MIGRATION_KEY);
    const key = deviceStorage.key;
    deviceStorage.key = () => { throw new Error('blocked'); };
    const failed = storage.migrateLegacyLocalStorageIfNeeded();
    deviceStorage.key = key;
    assert.equal(failed.error, 'legacy_storage_enumeration_failed');
    assert.equal(values.has(storage.LEGACY_LOCAL_STORAGE_MIGRATION_KEY), false);
});

test('future schemas fail closed without rewriting records or import sources', async () => {
    reset();
    const future = { version: COLOR_SCHEMA_VERSION + 1, colorData: { untouched: { future: true } } };
    stApi.extension_settings[MODULE_NAME] = future;
    const before = JSON.stringify(future);

    assert.throws(() => storage.getAutoSyncRecord(true), error => error?.code === 'unsupported_schema_version');
    assert.equal(storage.applyAutoSyncRecord(future), 'unsupported_schema_version');
    assert.equal(storage.loadData().error, 'unsupported_schema_version');
    assert.equal(JSON.stringify(stApi.extension_settings[MODULE_NAME]), before);

    delete stApi.extension_settings[MODULE_NAME];
    storage.loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
    for (const analyze of [storage.analyzeColorImport, storage.analyzeSettingsImport]) {
        const source = analyze === storage.analyzeColorImport
            ? { version: COLOR_SCHEMA_VERSION + 1, colors: {} }
            : { version: COLOR_SCHEMA_VERSION + 1, settings: { themeMode: 'dark' } };
        const result = await analyze(JSON.stringify(source));
        assert.equal(result.error, 'unsupported_schema_version');
    }
    assert.equal(storage.analyzeCardData({ version: COLOR_SCHEMA_VERSION + 1, colors: {} }).error, 'unsupported_schema_version');
});

test('reviewed imports reject normalized source and destination changes before mutation', async () => {
    reset();
    state.setCharacterColors({ current: character('Current', '#112233') });
    storage.saveData({ immediate: false });

    const changedSource = await storage.analyzeColorImport(JSON.stringify({
        version: COLOR_SCHEMA_VERSION,
        colors: { incoming: character('Incoming', '#445566') },
    }));
    changedSource.payload.colors.incoming.baseColor = '#abcdef';
    const sourceResult = await storage.applyColorImport(changedSource.payload, { mode: 'replace', applyScope: false });
    assert.equal(sourceResult.error, 'context_changed');
    assert.deepEqual(Object.keys(state.characterColors), ['current']);

    const changedDestination = await storage.analyzeColorImport(JSON.stringify({
        version: COLOR_SCHEMA_VERSION,
        colors: { incoming: character('Incoming', '#445566') },
    }));
    state.characterColors.current.baseColor = '#778899';
    const destinationResult = await storage.applyColorImport(changedDestination.payload, { mode: 'merge', applyScope: false });
    assert.equal(destinationResult.error, 'context_changed');
    assert.equal(state.characterColors.incoming, undefined);
    assert.equal(state.characterColors.current.baseColor, '#778899');
});

test('replace restores Keep pins immediately and history removes stale forward rename pins', async () => {
    reset();
    settings.colorStorageScope = 'chat';
    storage.loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
    state.setCharacterColors({ old: character('Old', '#112233', { keep: true }) });
    storage.saveData({ immediate: false });

    const analysis = await storage.analyzeColorImport(JSON.stringify({
        version: COLOR_SCHEMA_VERSION,
        colors: { incoming: character('Incoming', '#445566') },
    }));
    const replaced = await storage.applyColorImport(analysis.payload, { mode: 'replace', applyScope: false });
    assert.equal(replaced.ok, true, replaced.message);
    assert.equal(state.characterColors.old.keep, true);

    state.setColorHistory([history.createHistorySnapshot()]);
    state.setHistoryIndex(0);
    state.characterColors.next = { ...state.characterColors.old, name: 'Next' };
    delete state.characterColors.old;
    storage.removePinnedCharacterKey('old');
    history.saveHistory();
    storage.saveData({ immediate: false });
    assert.ok(storage.getPinnedCharacters().next);
    assert.equal(storage.getPinnedCharacters().old, undefined);

    history.undo();
    assert.ok(storage.getPinnedCharacters().old);
    assert.equal(storage.getPinnedCharacters().next, undefined);
    history.redo();
    assert.ok(storage.getPinnedCharacters().next);
    assert.equal(storage.getPinnedCharacters().old, undefined);
});

test('custom palette references must resolve and portable exports carry their palette', async () => {
    reset();
    const missing = await storage.analyzeSettingsImport(JSON.stringify({
        version: COLOR_SCHEMA_VERSION,
        settings: { colorTheme: 'custom:Missing' },
    }));
    assert.equal(missing.error, 'missing_custom_palette');

    const selfContained = await storage.analyzeSettingsImport(JSON.stringify({
        version: COLOR_SCHEMA_VERSION,
        settings: { colorTheme: 'custom:Ocean' },
        customPalettes: { Ocean: ['#112233', '#445566'] },
        customPaletteMeta: { Ocean: { notes: 'portable' } },
    }));
    assert.equal(selfContained.ok, true, selfContained.message);
    const applied = await storage.applySettingsImport(selfContained.payload, { mode: 'merge', applyScope: false });
    assert.equal(applied.ok, true, applied.message);
    assert.equal(settings.colorTheme, 'custom:Ocean');
    assert.deepEqual(storage.getAutoSyncRecord(true).customPalettes.Ocean, ['#112233', '#445566']);

    let exportedBlob;
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = blob => { exportedBlob = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    try {
        storage.exportSettings();
        const exported = JSON.parse(await exportedBlob.text());
        assert.equal(exported.settings.colorTheme, 'custom:Ocean');
        assert.deepEqual(exported.customPalettes.Ocean, ['#112233', '#445566']);
    } finally {
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
    }
});

test('card writes require an awaitable bound writer and verify settled data', async () => {
    const cardContext = context();
    reset(cardContext);
    state.setCharacterColors({ card: character('Card', '#123456') });
    const unavailable = await storage.saveToCard();
    assert.equal(unavailable.error, 'card_save_unavailable');
    assert.equal(cardContext.characters[0].data.extensions.dialogueColors, undefined);

    let settled = false;
    cardContext.writeExtensionField = async (characterId, key, value) => {
        await Promise.resolve();
        cardContext.characters[characterId].data.extensions[key] = value;
        settled = true;
    };
    globalThis.__dcGetCharacters = async () => {};
    const saved = await storage.saveToCard();
    assert.equal(saved.ok, true, saved.message);
    assert.equal(settled, true);
    assert.equal(cardContext.characters[0].data.extensions.dialogueColors.version, COLOR_SCHEMA_VERSION);
    delete globalThis.__dcGetCharacters;
});

test('archive fingerprints reject changed selected data without deleting it', async () => {
    reset();
    const key = 'dc_char_inactive';
    storage.setStoredColorData(key, { old: character('Old', '#112233') }, settings, { debounce: false });
    const fingerprint = storage.getStoredColorDataFingerprint(key);
    storage.getUserColorDataStore()[key].colors.old.baseColor = '#445566';

    const result = await storage.archiveStoredColorData([key], { [key]: fingerprint });
    assert.equal(result.error, 'context_changed');
    assert.ok(storage.getUserColorDataStore()[key]);
    assert.equal(storage.getArchivedColorData(), null);
});
