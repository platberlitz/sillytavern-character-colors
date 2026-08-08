import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false, personas: {} };
export const escapeHtml = value => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const escapeRegex = value => String(value).replace(/[/\\-\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
export const extension_settings = {};
let context = {
    chat: [], chatMetadata: {}, characterId: 0,
    characters: [{ name: 'Card', avatar: 'card.png' }],
    registerMacro() {}, saveMetadata() {}, saveChat() { return true; },
};
export const getContext = () => context;
export const setTestContext = value => { context = value; };
const handlers = new Map();
export const eventSource = {
    on(type, handler) {
        if (!type) return;
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
    },
    emit(type, ...args) {
        for (const handler of handlers.get(type) || []) handler(...args);
    },
};
export const event_types = {
    SETTINGS_UPDATED: 'settings_updated', CHAT_CHANGED: 'chat_changed',
    GENERATION_STARTED: 'generation_started', GENERATION_AFTER_COMMANDS: 'generation_after_commands',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered', USER_MESSAGE_RENDERED: 'user_message_rendered',
    MESSAGE_UPDATED: 'message_updated', MESSAGE_SWIPED: 'message_swiped', MESSAGE_DELETED: 'message_deleted',
    STREAM_TOKEN_RECEIVED: 'stream_token', SMOOTH_STREAM_TOKEN_RECEIVED: 'smooth_stream_token',
    GENERATION_ENDED: 'generation_ended', CHAT_CREATED: 'chat_created', GROUP_CHAT_CREATED: 'group_chat_created',
    CHARACTER_RENAMED: 'character_renamed', PERSONA_CHANGED: 'persona_changed',
    PERSONA_UPDATED: 'persona_updated', PERSONA_RENAMED: 'persona_renamed',
};
export const setExtensionPrompt = () => {};
let saveSettingsImpl = () => {};
export const saveSettings = (...args) => saveSettingsImpl(...args);
export const setSaveSettingsImpl = value => { saveSettingsImpl = typeof value === 'function' ? value : () => {}; };
export const saveSettingsDebounced = () => {};
export const saveCharacterDebounced = () => {};
export const getCharacters = () => context.characters || [];
export const extension_prompt_types = {};
export const extension_prompt_roles = {};
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = () => {};
export const saveMetadataDebounced = () => {};
`;

const documentListeners = new Map();
const documentElements = new Map();
const documentQueries = new Map();

class FakeElement {
    constructor() {
        this.attributes = new Map();
        this.children = [];
        this.isConnected = true;
        this.inert = false;
        this.style = {
            cssText: '',
            setProperty(name, value) { this[name] = value; },
            getPropertyValue(name) { return this[name] || ''; },
            getPropertyPriority() { return ''; },
            removeProperty(name) { delete this[name]; },
        };
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
            toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        };
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    addEventListener() {}
    removeEventListener() {}
    contains(node) { return node === this || this.children.includes(node); }
    closest() { return null; }
    focus() {}
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }; }
    getClientRects() { return [{}]; }
    hasAttribute(name) { return this.attributes.has(name); }
    matches() { return false; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    remove() { this.isConnected = false; }
    removeAttribute(name) { this.attributes.delete(name); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
    }
    observe(target, options) {
        this.target = target;
        this.options = options;
        this.disconnected = false;
    }
    disconnect() { this.disconnected = true; }
}

const body = new FakeElement();
body.ownerDocument = null;
globalThis.Element = FakeElement;
globalThis.Node = { ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 };
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.MutationObserver = FakeMutationObserver;
globalThis.document = {
    body,
    hidden: false,
    activeElement: null,
    addEventListener(type, handler) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
        const listeners = documentListeners.get(type) || [];
        const index = listeners.indexOf(handler);
        if (index >= 0) listeners.splice(index, 1);
    },
    createElement: () => new FakeElement(),
    createTreeWalker: () => ({ nextNode: () => null }),
    getElementById: id => documentElements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: selector => documentQueries.get(selector) || [],
};
body.ownerDocument = document;
globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    visualViewport: { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
};
globalThis.CSS = { escape: value => String(value) };
globalThis.getComputedStyle = () => ({
    backgroundColor: 'rgb(0, 0, 0)',
    color: 'rgb(255, 255, 255)',
    getPropertyValue: () => '',
});
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const stApi = await import(stApiUrl);
const state = await import('../src/state.js');
const storage = await import('../src/storage.js');
const main = await import('../src/main.js');
const contextMenu = await import('../src/context-menu.js');
const domEngine = await import('../src/dom-engine.js');
const { buildDialogueRegex, DIALOGUE_SKIP_GROUP } = await import('../src/color-blocks.js');
const { isColorableMessage } = await import('../src/live-colors.js');
hooks.deregister();

const baseContext = () => ({
    chat: [],
    chatMetadata: {},
    characterId: 0,
    characters: [{ name: 'Card', avatar: 'card.png' }],
    registerMacro() {},
    saveMetadata() {},
    saveChat() { return true; },
});

function resetRegistry() {
    for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
}

test('persisted disable cannot overwrite an explicit first enable, and lifecycle mutations clear streaming state', () => {
    const enabledControl = new FakeElement();
    enabledControl.checked = false;
    documentElements.set('dc-enabled', enabledControl);
    stApi.extension_settings['dialogue-colors'] = {
        version: state.COLOR_SCHEMA_VERSION,
        autoSyncEnabled: false,
        globalSettings: { enabled: false, autoScanOnLoad: false, colorStorageScope: 'card', coloringEngine: 'llm' },
        settings: { enabled: false, autoScanOnLoad: false, colorStorageScope: 'card', coloringEngine: 'llm' },
        colorData: {},
        legacyLocalStorageMigrated: true,
    };
    stApi.setTestContext(baseContext());
    storage.loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
    assert.equal(state.settings.enabled, false);

    try {
        enabledControl.checked = true;
        state.settings.enabled = true;
        assert.equal(main.syncAutomaticRuntime(), true);
        assert.equal(state.settings.enabled, true);
        assert.equal(enabledControl.checked, true);

        resetRegistry();
        state.characterColors.alice = { name: 'Alice', color: '#112233', aliases: [], dialogueCount: 99 };
        const message = { id: 'm-1', name: 'Alice', mes: '<font color="#112233">"Hi"</font>\n[COLORS:Alice=#112233]' };
        stApi.setTestContext({ ...baseContext(), chat: [message] });
        main.handleChatChanged();
        assert.equal(state.characterColors.alice.dialogueCount, 1);

        let disconnected = false;
        state.streamingSession.active = true;
        state.streamingSession.mesIndex = 0;
        state.streamingSession.observer = { disconnect() { disconnected = true; } };
        domEngine.setStreamingAttributionOverride(0, message, 0, 'Alice');
        state.setStreamingAttributionVerifyTimer(setTimeout(() => {}, 60_000));
        main.handleMessageUpdated(0);
        assert.equal(disconnected, true);
        assert.equal(state.streamingSession.active, false);
        assert.equal(state.streamingAttributionVerifyTimer, null);
        assert.equal(domEngine.getStreamingAttributionOverrides(0, message), null);

        disconnected = false;
        state.streamingSession.active = true;
        state.streamingSession.mesIndex = 0;
        state.streamingSession.observer = { disconnect() { disconnected = true; } };
        domEngine.setStreamingAttributionOverride(0, message, 0, 'Alice');
        state.setStreamingAttributionVerifyTimer(setTimeout(() => {}, 60_000));
        main.handleMessageDeleted();
        assert.equal(disconnected, true);
        assert.equal(state.streamingSession.active, false);
        assert.equal(state.streamingAttributionVerifyTimer, null);
        assert.equal(domEngine.getStreamingAttributionOverrides(0, message), null);
    } finally {
        state.settings.enabled = false;
        main.syncAutomaticRuntime();
        resetRegistry();
        documentElements.delete('dc-enabled');
        stApi.setTestContext(baseContext());
    }
});

test('a server-loaded enabled transition runs the registered runtime lifecycle', async () => {
    const previousRecord = structuredClone(stApi.extension_settings[state.MODULE_NAME]);
    const previousFetch = globalThis.fetch;
    let disconnected = false;
    try {
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
        });
        state.settings.enabled = true;
        main.syncAutomaticRuntime();
        storage.queueImmediateSettingsSave();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        state.streamingSession.active = true;
        state.streamingSession.observer = { disconnect() { disconnected = true; } };

        const current = storage.getAutoSyncRecord(true);
        const remote = storage.buildAutoSyncRecord({
            ...structuredClone(current),
            timestamp: new Date(Date.now() + 1000).toISOString(),
            writerId: 'remote-test',
            sequence: (current.sequence || 0) + 1,
            settings: { ...current.settings, enabled: false },
        });
        const disposition = storage.applyAutoSyncRecord(remote, { serverVerified: true });
        assert.equal(disposition, 'apply');
        for (let attempt = 0; attempt < 20 && state.settings.enabled; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(state.settings.enabled, false);
        assert.equal(disconnected, true);
        assert.equal(state.streamingSession.active, false);
    } finally {
        state.settings.enabled = false;
        main.syncAutomaticRuntime();
        globalThis.fetch = previousFetch;
        if (previousRecord === undefined) delete stApi.extension_settings[state.MODULE_NAME];
        else stApi.extension_settings[state.MODULE_NAME] = previousRecord;
    }
});

test('an old server response waits behind its own queued local save', async () => {
    const previousFetch = globalThis.fetch;
    const oldRecord = structuredClone(storage.getAutoSyncRecord(true));
    let releaseSave;
    const blockedSave = new Promise(resolve => { releaseSave = resolve; });
    stApi.setSaveSettingsImpl(() => blockedSave);
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
    });
    try {
        assert.equal(storage.saveSettingsToStore({ force: true, schedule: false }), true);
        storage.queueImmediateSettingsSave();
        assert.equal(storage.applyAutoSyncRecord(oldRecord, { serverVerified: true }), 'deferred');
        assert.notEqual(state.autoSyncStatusError, 'Remote state changed while saving');
        storage.stopAutoSyncPolling();
    } finally {
        releaseSave();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        storage.clearAutoSyncPending();
        stApi.setSaveSettingsImpl(null);
        globalThis.fetch = previousFetch;
    }
});

test('master disable removes context focusability and blocks every document entry event', async () => {
    const managed = new FakeElement();
    managed.setAttribute('data-dc-context-focus', 'tabindex');
    managed.setAttribute('tabindex', '0');
    managed.setAttribute('aria-keyshortcuts', 'Shift+F10');
    documentQueries.set('[data-dc-context-focus]', [managed]);
    documentQueries.set('#chat .mes_text', []);

    state.settings.enabled = true;
    state.settings.enableRightClick = true;
    stApi.eventSource.emit(stApi.event_types.SETTINGS_UPDATED);
    await Promise.resolve();
    managed.setAttribute('data-dc-context-focus', 'tabindex');
    managed.setAttribute('tabindex', '0');
    managed.setAttribute('aria-keyshortcuts', 'Shift+F10');

    state.settings.enabled = false;
    stApi.eventSource.emit(stApi.event_types.SETTINGS_UPDATED);
    await Promise.resolve();
    assert.equal(managed.hasAttribute('tabindex'), false);
    assert.equal(managed.hasAttribute('aria-keyshortcuts'), false);
    assert.equal(managed.hasAttribute('data-dc-context-focus'), false);

    let prevented = 0;
    const target = new FakeElement();
    for (const handler of documentListeners.get('contextmenu') || []) {
        handler({ target, preventDefault() { prevented++; } });
    }
    for (const handler of documentListeners.get('keydown') || []) {
        handler({ target, key: 'ContextMenu', code: 'ContextMenu', repeat: false, preventDefault() { prevented++; } });
    }
    for (const handler of documentListeners.get('touchstart') || []) {
        handler({ target, touches: [{ clientX: 1, clientY: 1 }], preventDefault() { prevented++; } });
    }
    assert.equal(prevented, 0);

    documentQueries.delete('[data-dc-context-focus]');
    documentQueries.delete('#chat .mes_text');
});

test('deletion reconciliation keeps current and ambiguous ID-less overrides without guessing', () => {
    const duplicate = () => ({ name: 'Bob', mes: '"Same"' });
    const metadata = {};
    const oldChat = [{ name: 'Other', mes: 'Other' }, duplicate(), duplicate()];
    stApi.setTestContext({ ...baseContext(), chat: oldChat, chatMetadata: metadata });
    assert.equal(domEngine.setMessageQuoteOverride(2, oldChat[2], 0, 'Alice'), true);
    const entry = metadata.dialogue_colors_overrides['2'];

    const currentChat = [duplicate(), duplicate()];
    stApi.setTestContext({ ...baseContext(), chat: currentChat, chatMetadata: metadata });
    assert.equal(domEngine.reconcileMessageQuoteOverridesAfterDeletion(), false);
    assert.equal(metadata.dialogue_colors_overrides['2'], entry);

    const currentMetadata = {};
    stApi.setTestContext({ ...baseContext(), chat: currentChat, chatMetadata: currentMetadata });
    assert.equal(domEngine.setMessageQuoteOverride(1, currentChat[1], 0, 'Alice'), true);
    const currentEntry = currentMetadata.dialogue_colors_overrides['1'];
    assert.equal(domEngine.reconcileMessageQuoteOverridesAfterDeletion(), false);
    assert.equal(currentMetadata.dialogue_colors_overrides['1'], currentEntry);

    stApi.setTestContext({ ...baseContext(), chat: [], chatMetadata: currentMetadata });
    assert.equal(domEngine.reconcileMessageQuoteOverridesAfterDeletion(undefined, { deletion: false }), false);
    assert.equal(currentMetadata.dialogue_colors_overrides['1'], currentEntry);
});

test('LLM font observer survives DOM-health teardown and disconnects on master disable', () => {
    const chat = new FakeElement();
    documentElements.set('chat', chat);
    state.settings.enabled = true;
    state.settings.coloringEngine = 'dom';
    domEngine.setupChatObserver();
    const observer = state.runtimeState.chatObserver;
    assert.ok(observer);

    state.settings.coloringEngine = 'llm';
    domEngine.stopDomHealthCheck();
    assert.equal(state.runtimeState.chatObserver, observer);
    assert.equal(observer.disconnected, false);

    state.settings.enabled = false;
    domEngine.stopDomHealthCheck();
    assert.equal(state.runtimeState.chatObserver, null);
    assert.equal(observer.disconnected, true);
    documentElements.delete('chat');
});

test('host system messages are rejected by live and manual coloring paths', () => {
    const message = {
        name: 'SillyTavern System',
        is_system: true,
        is_user: false,
        extra: { type: 'generic' },
        mes: '"Internal"',
    };
    assert.equal(isColorableMessage(message), false);
    assert.equal(contextMenu.replaceMessageSelectionWithFontTag(message, 'Internal', '#112233', {
        sourceStart: 1,
        sourceEnd: 9,
    }), false);
    assert.equal(message.mes, '"Internal"');
});

test('STYLE matching is case-insensitive without folding custom thought delimiters', () => {
    const previous = state.settings.thoughtSymbols;
    state.settings.thoughtSymbols = 'x';
    try {
        const matches = Array.from('XUPPERX <STYLE>"hidden"</STYLE> xlowerx "shown"'.matchAll(buildDialogueRegex()));
        assert.deepEqual(
            matches.filter(match => match.groups?.[DIALOGUE_SKIP_GROUP] === undefined).map(match => match[0]),
            ['xlowerx', '"shown"'],
        );
        assert.equal(matches.filter(match => match.groups?.[DIALOGUE_SKIP_GROUP] !== undefined).length, 1);
    } finally {
        state.settings.thoughtSymbols = previous;
    }
});
