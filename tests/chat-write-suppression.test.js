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
export const saveMetadata = () => {};
export const saveMetadataDebounced = () => {};
`;

globalThis.document ??= { body: {}, querySelector: () => null, querySelectorAll: () => [] };
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const stApi = await import(stApiUrl);
const {
    clearSessionAttributionVerifications,
    isMessageAttributionVerified,
    markMessageAttributionVerified,
    setMessageQuoteOverride,
} = await import('../src/dom-engine.js');
const { ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS } = await import('../src/attribution-store.js');
hooks.deregister();

const storageSource = await readFile(new URL('../src/storage.js', import.meta.url), 'utf8');
const OVERRIDES_KEY = 'dialogue_colors_overrides';

// Mirrors how the host reports a save: the extension calls saveMetadataDebounced
// and the chat file is rewritten some time later.
function withCountedChat(messages, run) {
    const metadata = {};
    const saves = { count: 0 };
    stApi.setTestContext({
        chat: messages,
        chatMetadata: metadata,
        saveMetadataDebounced: () => { saves.count++; },
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
