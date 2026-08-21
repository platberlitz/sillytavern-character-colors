import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

// A chat metadata save is a full rewrite of the user's chat file, so every write
// this module makes has to be backed by a real change. These tests count the
// host save calls rather than inspecting metadata alone, because "the data is
// right" and "we did not rewrite the file to get there" are different claims.
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
export const saveMetadata = (...args) => {
    if (typeof context.saveMetadata === 'function') return context.saveMetadata(...args);
    return context.saveMetadataDebounced?.(...args);
};
export const saveMetadataDebounced = (...args) => context.saveMetadataDebounced?.(...args);
export const promptManager = null;
`;

globalThis.document ??= { body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const stApi = await import(stApiUrl);
const { settings } = await import('../src/state.js');
const {
    clearSessionAttributionVerifications,
    isMessageAttributionVerified,
    listAttributionReviews,
    markMessageAttributionVerified,
    retryDirtyChatMetadataSave,
    saveChatMetadata,
    saveChatMetadataIfChanged,
    setMessageQuoteOverride,
    upsertAttributionReview,
} = await import('../src/dom-engine.js');
const { ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS } = await import('../src/attribution-store.js');
const {
    captureLoadedAttributionMessageBaseline,
    clearAutoAttributionVerificationQueue,
    drainAutoAttributionVerificationQueue,
    getAutoAttributionVerifyKey,
    queueAutoAttributionVerificationForMessage,
} = await import('../src/verify.js');
hooks.deregister();

const storageSource = await readFile(new URL('../src/storage.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const verifySource = await readFile(new URL('../src/verify.js', import.meta.url), 'utf8');
const OVERRIDES_KEY = 'dialogue_colors_overrides';
const REVIEWS_KEY = 'dialogue_colors_attribution_reviews';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

// The host exposes both methods; attribution writes must use the chat-bound
// promise rather than the cancellable, void-returning debounce.
function withCountedChat(messages, run) {
    const metadata = {};
    const saves = { count: 0, debounced: 0 };
    stApi.setTestContext({
        chat: messages,
        chatMetadata: metadata,
        saveMetadata: () => { saves.count++; return true; },
        saveMetadataDebounced: () => { saves.debounced++; },
    });
    clearSessionAttributionVerifications();
    try {
        return run({ metadata, saves });
    } finally {
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
}

test('a verdict the local pass re-derives for free never touches the chat file', () => {
    const message = { id: 'm-1', name: 'Bob', mes: 'He walked to the window and said nothing.' };
    withCountedChat([message], ({ metadata, saves }) => {
        assert.equal(
            markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN, { persist: false }),
            true,
        );
        assert.equal(saves.count, 0);
        assert.equal(metadata[OVERRIDES_KEY], undefined);
        // The verdict still counts, so the message is not re-verified all
        // session long just because it was never written down.
        assert.equal(isMessageAttributionVerified(0, message), true);
    });
});

test('an in-memory verdict does not survive an edit or a chat change', () => {
    const message = { id: 'm-1', name: 'Bob', mes: 'He walked to the window.' };
    withCountedChat([message], () => {
        markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN, { persist: false });
        assert.equal(isMessageAttributionVerified(0, message), true);

        const edited = { ...message, mes: 'He walked to the window and swore.' };
        assert.equal(isMessageAttributionVerified(0, edited), false);

        clearSessionAttributionVerifications();
        assert.equal(isMessageAttributionVerified(0, message), false);
    });
});

test('re-verifying an unchanged message writes once, not once per pass', () => {
    const message = { id: 'm-1', name: 'Bob', mes: '"Hello there," she said.' };
    withCountedChat([message], ({ metadata, saves }) => {
        assert.equal(markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN), true);
        assert.equal(saves.count, 1);
        const firstStamp = metadata[OVERRIDES_KEY]['0'].verifiedAt;

        for (let pass = 0; pass < 3; pass++) {
            assert.equal(markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN), true);
        }
        assert.equal(saves.count, 1);
        // An unconditional Date.now() here is what made every no-op re-check
        // look like a change worth rewriting the chat for.
        assert.equal(metadata[OVERRIDES_KEY]['0'].verifiedAt, firstStamp);
    });
});

test('a changed verdict still writes', () => {
    const message = { id: 'm-1', name: 'Bob', mes: '"Hello there," she said.' };
    withCountedChat([message], ({ metadata, saves }) => {
        markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN);
        assert.equal(saves.count, 1);
        markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.PENDING_REVIEW);
        assert.equal(saves.count, 2);
        assert.equal(
            metadata[OVERRIDES_KEY]['0'].verificationStatus,
            ATTRIBUTION_VERIFICATION_STATUS.PENDING_REVIEW,
        );
    });
});

test('re-applying an identical override does not rewrite the chat', () => {
    const message = { id: 'm-1', name: 'Bob', mes: '"One"\n"Two"' };
    withCountedChat([message], ({ metadata, saves }) => {
        assert.equal(
            setMessageQuoteOverride(0, message, 1, 'Alice', { source: ATTRIBUTION_SOURCE.MANUAL }),
            true,
        );
        assert.equal(saves.count, 1);
        const firstStamp = metadata[OVERRIDES_KEY]['0'].verifiedAt;

        assert.equal(
            setMessageQuoteOverride(0, message, 1, 'Alice', { source: ATTRIBUTION_SOURCE.MANUAL }),
            true,
        );
        assert.equal(saves.count, 1);
        assert.equal(metadata[OVERRIDES_KEY]['0'].verifiedAt, firstStamp);

        // A different speaker is a real edit and must still reach the host.
        assert.equal(
            setMessageQuoteOverride(0, message, 1, 'Carol', { source: ATTRIBUTION_SOURCE.MANUAL }),
            true,
        );
        assert.equal(saves.count, 2);
        assert.equal(metadata[OVERRIDES_KEY]['0'].segments['1'], 'Carol');
    });
});

test('reading the review list leaves a chat with no review data untouched', () => {
    const message = { id: 'm-1', name: 'Bob', mes: '"Hello there," she said.' };
    withCountedChat([message], ({ metadata, saves }) => {
        assert.deepEqual(listAttributionReviews(), []);
        assert.equal(saves.count, 0);
        // Normalising the store into chat metadata on a read is enough to make
        // the host persist it on its next save, so the key must not appear.
        assert.equal(Object.prototype.hasOwnProperty.call(metadata, REVIEWS_KEY), false);
    });
});

test('automatic attribution skips loaded messages without suppressing new or edited messages', () => {
    const original = {
        enabled: settings.enabled,
        coloringEngine: settings.coloringEngine,
        llmAttributionCheck: settings.llmAttributionCheck,
        llmAttributionParallel: settings.llmAttributionParallel,
        autoScanOnLoad: settings.autoScanOnLoad,
    };
    const loaded = { id: 'loaded', name: 'Bob', mes: 'The loaded message.' };
    const appended = { id: 'appended', name: 'Alice', mes: 'The new message.' };

    try {
        Object.assign(settings, {
            enabled: true,
            coloringEngine: 'dom',
            llmAttributionCheck: true,
            llmAttributionParallel: false,
            autoScanOnLoad: false,
        });
        stApi.setTestContext({ chat: [loaded], chatMetadata: {} });
        clearSessionAttributionVerifications();
        captureLoadedAttributionMessageBaseline();

        assert.equal(queueAutoAttributionVerificationForMessage(0, { delay: 60000 }), false);
        assert.equal(queueAutoAttributionVerificationForMessage(0, { includeLoaded: true, delay: 60000 }), true);
        clearAutoAttributionVerificationQueue({ clearCooldown: true });

        settings.autoScanOnLoad = true;
        assert.equal(queueAutoAttributionVerificationForMessage(0, { delay: 60000 }), true);
        clearAutoAttributionVerificationQueue({ clearCooldown: true });
        settings.autoScanOnLoad = false;

        stApi.setTestContext({ chat: [loaded, appended], chatMetadata: {} });
        assert.equal(queueAutoAttributionVerificationForMessage(1, { delay: 60000 }), true);
        clearAutoAttributionVerificationQueue({ clearCooldown: true });

        loaded.mes = 'The edited message.';
        assert.equal(queueAutoAttributionVerificationForMessage(0, { delay: 60000 }), true);
        assert.notEqual(
            getAutoAttributionVerifyKey(0, { mes: 'Ab' }),
            getAutoAttributionVerifyKey(0, { mes: 'BA' }),
        );
    } finally {
        clearAutoAttributionVerificationQueue({ clearCooldown: true });
        Object.assign(settings, original);
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
        captureLoadedAttributionMessageBaseline();
    }
});

test('an ordinary requeue preserves explicit permission to verify a loaded message', async () => {
    const original = {
        enabled: settings.enabled,
        coloringEngine: settings.coloringEngine,
        llmAttributionCheck: settings.llmAttributionCheck,
        llmAttributionParallel: settings.llmAttributionParallel,
        autoScanOnLoad: settings.autoScanOnLoad,
    };
    const loaded = { id: 'loaded', name: 'Bob', mes: 'The loaded narration.' };

    try {
        Object.assign(settings, {
            enabled: true,
            coloringEngine: 'dom',
            llmAttributionCheck: true,
            llmAttributionParallel: false,
            autoScanOnLoad: true,
        });
        stApi.setTestContext({ chat: [loaded], chatMetadata: {} });
        clearSessionAttributionVerifications();
        captureLoadedAttributionMessageBaseline();

        assert.equal(queueAutoAttributionVerificationForMessage(0, { includeLoaded: true, delay: 60000 }), true);
        assert.equal(queueAutoAttributionVerificationForMessage(0, { delay: 60000 }), true);
        settings.autoScanOnLoad = false;

        await drainAutoAttributionVerificationQueue();
        assert.equal(isMessageAttributionVerified(0, loaded), true);
    } finally {
        clearAutoAttributionVerificationQueue({ clearCooldown: true });
        Object.assign(settings, original);
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
        captureLoadedAttributionMessageBaseline();
    }
});

test('queueing a review still attaches the store and saves', () => {
    const message = { id: 'm-1', name: 'Bob', mes: '"Hello there," she said.' };
    withCountedChat([message], ({ metadata, saves }) => {
        const review = upsertAttributionReview({
            message,
            messageIndex: 0,
            segment: { index: 0, text: '"Hello there,"' },
            currentSpeaker: 'Bob',
            proposedSpeaker: 'Alice',
            source: ATTRIBUTION_SOURCE.LLM,
            confidence: 0.9,
        });

        assert.ok(review);
        assert.equal(Object.prototype.hasOwnProperty.call(metadata, REVIEWS_KEY), true);
        assert.equal(saves.count, 1);
        assert.equal(saves.debounced, 0);
        assert.equal(listAttributionReviews().length, 1);
    });
});

test('failed and unverified metadata saves stay dirty with bounded automatic retry', async () => {
    const metadata = { [OVERRIDES_KEY]: { marker: 1 } };
    const attempts = [];
    let debounced = 0;
    stApi.setTestContext({
        chat: [],
        chatMetadata: metadata,
        saveMetadata: () => {
            const attempt = deferred();
            attempts.push(attempt);
            return attempt.promise;
        },
        saveMetadataDebounced: () => { debounced++; },
    });
    clearSessionAttributionVerifications();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(saveChatMetadataIfChanged(null, metadata), true);
        assert.equal(saveChatMetadataIfChanged(null, metadata), false, 'one in-flight save is enough');
        assert.equal(debounced, 0);
        attempts[0].reject(new Error('save failed'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(saveChatMetadataIfChanged(null, metadata), true);
        assert.equal(attempts.length, 2);
        attempts[1].resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(saveChatMetadataIfChanged(null, metadata), false);
        const manualRetry = retryDirtyChatMetadataSave();
        assert.equal(attempts.length, 3);
        attempts[2].resolve(true);
        assert.equal(await manualRetry, true);
        assert.equal(saveChatMetadataIfChanged(null, metadata), false);
    } finally {
        console.warn = originalWarn;
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('a canceled debounce cannot advance the last-saved scope', () => {
    const metadata = { [OVERRIDES_KEY]: { marker: 1 } };
    let attempts = 0;
    stApi.setTestContext({
        chat: [],
        chatMetadata: metadata,
        saveMetadataDebounced: () => { attempts++; return false; },
    });
    clearSessionAttributionVerifications();
    try {
        assert.equal(saveChatMetadataIfChanged(null, metadata), true);
        assert.equal(saveChatMetadataIfChanged(null, metadata), true);
        assert.equal(attempts, 2);
    } finally {
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('an old chat save settlement cannot mark a new chat saved', async () => {
    const firstMetadata = { [OVERRIDES_KEY]: { marker: 1 } };
    const secondMetadata = { [OVERRIDES_KEY]: { marker: 1 } };
    const firstSave = deferred();
    let secondSaves = 0;
    stApi.setTestContext({ chat: [{ id: 'first' }], chatMetadata: firstMetadata, saveMetadataDebounced: () => firstSave.promise });
    clearSessionAttributionVerifications();
    try {
        assert.equal(saveChatMetadataIfChanged(null, firstMetadata), true);
        stApi.setTestContext({
            chat: [{ id: 'second' }],
            chatMetadata: secondMetadata,
            saveMetadataDebounced: () => { secondSaves++; return Promise.resolve(); },
        });
        firstSave.resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(saveChatMetadataIfChanged(null, secondMetadata), true);
        assert.equal(secondSaves, 1);
    } finally {
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('metadata writes serialize and coalesce to the latest scope', async () => {
    const metadata = { [OVERRIDES_KEY]: { marker: 1 } };
    const attempts = [];
    stApi.setTestContext({
        chat: [{ id: 'one' }],
        chatMetadata: metadata,
        saveMetadata: () => {
            const attempt = deferred();
            attempt.marker = metadata[OVERRIDES_KEY].marker;
            attempts.push(attempt);
            return attempt.promise;
        },
    });
    clearSessionAttributionVerifications();
    try {
        const settled = [];
        const first = saveChatMetadata().then(() => settled.push('first'));
        metadata[OVERRIDES_KEY].marker = 2;
        const second = saveChatMetadata().then(() => settled.push('second'));
        metadata[OVERRIDES_KEY].marker = 3;
        const third = saveChatMetadata().then(() => settled.push('third'));

        assert.deepEqual(attempts.map(attempt => attempt.marker), [1]);
        attempts[0].resolve(true);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(attempts.map(attempt => attempt.marker), [1, 3]);
        attempts[1].resolve(true);
        await Promise.all([first, second, third]);
        assert.deepEqual(settled, ['first', 'second', 'third']);
    } finally {
        clearSessionAttributionVerifications();
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('a disabled extension tears down before it can resolve a storage key', () => {
    // getCharKey()/getStorageKey() stamp a chat-scope ID into chat metadata under
    // the "Per chat" scope, which rewrites the chat file even with the extension
    // switched off. The guard has to sit ahead of both.
    const guard = mainSource.indexOf('if (!settings.enabled) {');
    const charKey = mainSource.indexOf('const currentCharKey = getCharKey();');
    const storageKey = mainSource.indexOf('const scanStorageKey = getStorageKey();');

    assert.ok(guard > 0, 'handleChatChanged must guard on settings.enabled');
    assert.ok(charKey > guard, 'the guard must precede getCharKey()');
    assert.ok(storageKey > guard, 'the guard must precede getStorageKey()');
    assert.match(mainSource.slice(guard, charKey), /\n {8}return;\n {4}\}/);
});

test('chat lifecycle captures loaded messages before scheduling decoration', () => {
    const handleChatChanged = mainSource.indexOf('export function handleChatChanged()');
    const handleCapture = mainSource.indexOf('captureLoadedAttributionMessageBaseline();', handleChatChanged);
    const handleSchedule = mainSource.indexOf('scheduleDomRefreshSeries(150);', handleChatChanged);
    const init = mainSource.indexOf('export function init()');
    const initSync = mainSource.indexOf('syncAutomaticRuntime();', init);
    const sync = mainSource.indexOf('export function syncAutomaticRuntime()');
    const syncHandle = mainSource.indexOf('handleChatChanged();', sync);

    assert.ok(handleChatChanged >= 0 && handleCapture > handleChatChanged);
    assert.ok(handleCapture < handleSchedule);
    assert.ok(init >= 0 && initSync > init);
    assert.ok(sync >= 0 && syncHandle > sync);
});

test('loaded-message suppression also guards streaming and in-flight verification', () => {
    assert.match(verifySource, /function isAttributionMessageIdentityCurrent[\s\S]*?isLoadedAttributionMessage\(msg\)/);
    assert.match(verifySource, /export function scheduleStreamingAttributionVerification[\s\S]*?isLoadedAttributionMessage\(msg\)/);
    assert.match(verifySource, /export async function runStreamingAttributionVerification[\s\S]*?isLoadedAttributionMessage\(msg\)/);
});

test('stored colour data keeps its timestamp when the payload is identical', () => {
    // storage.js cannot be imported without a live SillyTavern, so the contract
    // is pinned in source: updatedAt must be conditional, or no caller can ever
    // tell a real save from a no-op one.
    assert.match(storageSource, /const unchanged = isPlainObject\(previous\)/);
    assert.match(storageSource, /entry\.updatedAt = unchanged \? previous\.updatedAt : new Date\(\)\.toISOString\(\)/);
    assert.doesNotMatch(storageSource, /updatedAt: new Date\(\)\.toISOString\(\)/);
});

test('a module record the server already holds is not written again', () => {
    assert.match(storageSource, /let lastServerVerifiedModuleRecord = null/);
    assert.match(
        storageSource,
        /function persistModuleStore[\s\S]*?lastServerVerifiedModuleRecord !== null && recordsEqual\(normalized, lastServerVerifiedModuleRecord\)/,
    );
    // Anything that leaves the server copy unconfirmed has to drop the cache,
    // or a genuinely needed write could be skipped.
    assert.match(storageSource, /lastServerVerifiedModuleRecord = getModuleRecordSnapshot\(stored\)/);
    assert.match(storageSource, /setAutoSyncError\('Save could not be verified'\)/);
});
