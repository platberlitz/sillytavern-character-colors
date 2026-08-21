import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only resolve
// inside a SillyTavern install. Stubbing that one module lets the real save/load cycle run under
// node --test, against a live extension_settings record rather than a source-text assertion.
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
export const saveSettings = async () => {};
export const saveSettingsDebounced = () => {};
export const saveCharacterDebounced = () => {};
export const getCharacters = () => [];
export const extension_prompt_types = {};
export const extension_prompt_roles = {};
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = async () => {};
export const saveMetadataDebounced = () => {};
export const promptManager = null;
`;

globalThis.document ??= { body: {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const stApi = await import(stApiUrl);
const storage = await import('../src/storage.js');
const state = await import('../src/state.js');
const { settings, MODULE_NAME } = state;
hooks.deregister();

// The host round-trips extension_settings through its own server, and the immediate-persist
// path verifies what it wrote by reading it back. Mirror that so a scope switch can confirm.
globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ settings: JSON.stringify({ extension_settings: stApi.extension_settings }) }),
});

function hostContext(chatId, avatar = 'bob.png') {
    return {
        chat: [],
        chatMetadata: {},
        chatId,
        characterId: 0,
        characters: [{ avatar, name: 'Bob' }],
        groupId: null,
        saveMetadata: async () => {},
    };
}

function withFreshStore(chatId, run) {
    delete stApi.extension_settings[MODULE_NAME];
    stApi.setTestContext(hostContext(chatId));
    settings.colorStorageScope = 'card';
    try {
        return run();
    } finally {
        delete stApi.extension_settings[MODULE_NAME];
        stApi.setTestContext({});
        settings.colorStorageScope = 'card';
    }
}

test('a snapshot that does not mention the scope leaves the active one alone', () => {
    withFreshStore('c1', () => {
        settings.colorStorageScope = 'chat';
        storage.applyStoredSettingsSnapshot({ themeMode: 'dark', colorTheme: 'neon' });
        assert.equal(settings.colorStorageScope, 'chat', 'an unrelated snapshot must not reset the scope');
        storage.applyStoredSettingsSnapshot({});
        assert.equal(settings.colorStorageScope, 'chat', 'an empty snapshot must not reset the scope');
        storage.applyStoredSettingsSnapshot({ colorStorageScope: 'global' });
        assert.equal(settings.colorStorageScope, 'global', 'a snapshot that does carry it still applies');
    });
});

test('a stored record that predates the setting is not stamped with a default', () => {
    withFreshStore('c1', () => {
        stApi.extension_settings[MODULE_NAME] = {
            version: 8,
            globalSettings: { themeMode: 'dark', colorTheme: 'neon' },
            legacyLocalStorageMigrated: true,
        };
        const record = storage.getAutoSyncRecord(true);
        assert.equal(record.globalSettings.colorStorageScope, undefined,
            'reading a record must not write a scope choice the user never made');
        assert.equal(record.globalSettings.themeMode, 'dark', 'the rest of the snapshot still normalizes');
    });
});

test('loading a partial record keeps the scope the user is on', () => {
    for (const globalSettings of [undefined, {}, { themeMode: 'dark' }]) {
        withFreshStore('c1', () => {
            stApi.extension_settings[MODULE_NAME] = {
                version: 8,
                globalSettings,
                colorData: {},
                legacyLocalStorageMigrated: true,
            };
            settings.colorStorageScope = 'chat';
            storage.loadData();
            assert.equal(settings.colorStorageScope, 'chat',
                `a record with globalSettings ${JSON.stringify(globalSettings)} reset the scope`);
        });
    }
});

test('the auto-sync writer keeps both halves of the record in step', () => {
    withFreshStore('c1', () => {
        storage.loadData();
        settings.colorStorageScope = 'chat';
        state.setAutoSyncEnabled(true);
        try {
            storage.saveSettingsToStore({ force: true, schedule: false });
            const record = stApi.extension_settings[MODULE_NAME];
            // globalSettings is the half a reload restores from. Publishing only the transport
            // payload left it empty, and the scope came back as Per card on the next load.
            assert.equal(record.settings.colorStorageScope, 'chat');
            assert.equal(record.globalSettings.colorStorageScope, 'chat',
                'the auto-sync write must not leave globalSettings behind');
        } finally {
            state.setAutoSyncEnabled(false);
        }
    });
});

test('a record whose globalSettings is missing falls back to the auto-sync payload', () => {
    withFreshStore('c1', () => {
        stApi.extension_settings[MODULE_NAME] = {
            version: 8,
            settings: { themeMode: 'dark', colorStorageScope: 'chat' },
            colorData: {},
            legacyLocalStorageMigrated: true,
        };
        settings.colorStorageScope = 'card';
        storage.loadData();
        assert.equal(settings.colorStorageScope, 'chat',
            'a lopsided record still holds the choice in its payload');
    });
});

test('a value globalSettings did record still wins over the payload', () => {
    withFreshStore('c1', () => {
        stApi.extension_settings[MODULE_NAME] = {
            version: 8,
            globalSettings: { colorStorageScope: 'global' },
            settings: { colorStorageScope: 'chat' },
            colorData: {},
            legacyLocalStorageMigrated: true,
        };
        settings.colorStorageScope = 'card';
        storage.loadData();
        assert.equal(settings.colorStorageScope, 'global', 'the fallback fills gaps, it does not override');
    });
});

test('a chosen scope survives a reload, a new chat and a new card', async () => {
    delete stApi.extension_settings[MODULE_NAME];
    stApi.setTestContext(hostContext('c1'));
    settings.colorStorageScope = 'card';
    storage.loadData();

    const result = await storage.switchColorStorageScope('chat', 'copy');
    assert.equal(result.ok, true, result.message);
    assert.equal(stApi.extension_settings[MODULE_NAME].globalSettings.colorStorageScope, 'chat');

    // A reload starts from the module default and has only the stored record to go on.
    settings.colorStorageScope = 'card';
    storage.loadData();
    assert.equal(settings.colorStorageScope, 'chat', 'the scope did not survive a reload');

    for (const [label, context] of [['new chat', hostContext('c2')], ['new card', hostContext('c2', 'alice.png')]]) {
        stApi.setTestContext(context);
        storage.saveData();
        storage.loadData();
        assert.equal(settings.colorStorageScope, 'chat', `the scope did not survive a ${label}`);
    }

    delete stApi.extension_settings[MODULE_NAME];
    stApi.setTestContext({});
    settings.colorStorageScope = 'card';
});

function characterEntry(name, baseColor, extra = {}) {
    return {
        name,
        color: baseColor,
        baseColor,
        locked: false,
        keep: false,
        aliases: [],
        style: '',
        dialogueCount: 0,
        group: '',
        font: '',
        gradient: null,
        gradientGenerator: null,
        ...extra,
    };
}

function withPinnedScope(run) {
    delete stApi.extension_settings[MODULE_NAME];
    stApi.setTestContext(hostContext('c1'));
    settings.colorStorageScope = 'chat';
    storage.loadData();
    try {
        return run();
    } finally {
        state.setCharacterColors({});
        delete stApi.extension_settings[MODULE_NAME];
        stApi.setTestContext({});
        settings.colorStorageScope = 'card';
    }
}

// The reason this store exists: a per-chat table is keyed by the chat, so every new chat used
// to come up empty except for the persona. Keep is the user saying "not this one".
test('a kept character is pinned on save and an unkept one is not', () => {
    withPinnedScope(() => {
        state.setCharacterColors({
            aria: characterEntry('Aria', '#ff0000', { keep: true }),
            kel: characterEntry('Kel', '#00ff00'),
        });
        storage.saveData();
        const pins = storage.getPinnedCharacters();
        assert.equal(pins.aria?.baseColor, '#ff0000');
        assert.equal(pins.kel, undefined, 'only kept characters follow the user around');
    });
});

test('a new chat on the same card comes up with the pinned cast', () => {
    withPinnedScope(() => {
        state.setCharacterColors({
            aria: characterEntry('Aria', '#ff0000', { keep: true, aliases: ['the elf'] }),
            kel: characterEntry('Kel', '#00ff00'),
        });
        storage.saveData();

        stApi.setTestContext(hostContext('c2'));
        storage.loadData();
        assert.equal(state.characterColors.aria?.baseColor, '#ff0000', 'the pinned color must be reproduced exactly');
        assert.equal(state.characterColors.aria?.keep, true, 'a seeded character arrives still pinned');
        assert.deepEqual(state.characterColors.aria?.aliases, ['the elf'], 'aliases describe the character, so they travel');
        assert.equal(state.characterColors.kel, undefined, 'an unpinned character stays behind');
    });
});

test('pins do not follow the user onto another card', () => {
    withPinnedScope(() => {
        state.setCharacterColors({ aria: characterEntry('Aria', '#ff0000', { keep: true }) });
        storage.saveData();

        stApi.setTestContext(hostContext('c2', 'alice.png'));
        storage.loadData();
        assert.equal(state.characterColors.aria, undefined, 'one card cast must not leak into another card chats');
    });
});

test('a chat that already knows the character gets the pinned color', () => {
    withPinnedScope(() => {
        state.setCharacterColors({ aria: characterEntry('Aria', '#ff0000', { keep: true }) });
        storage.saveData();

        stApi.setTestContext(hostContext('c2'));
        storage.setStoredColorData(
            storage.getStorageKeyForScope('chat'),
            { aria: characterEntry('Aria', '#0000ff') },
            { ...settings, colorStorageScope: 'chat' },
        );
        storage.loadData();
        assert.equal(state.characterColors.aria?.baseColor, '#ff0000', 'the pin is the one color, in every chat');
        assert.equal(state.characterColors.aria?.keep, true);
    });
});

test('unpinning stops the carry everywhere, not just in this chat', () => {
    withPinnedScope(() => {
        state.setCharacterColors({ aria: characterEntry('Aria', '#ff0000', { keep: true }) });
        storage.saveData();

        state.characterColors.aria.keep = false;
        storage.saveData();
        assert.equal(storage.getPinnedCharacters().aria, undefined);

        stApi.setTestContext(hostContext('c3'));
        storage.loadData();
        assert.equal(state.characterColors.aria, undefined, 'an unpinned character stops seeding new chats');
    });
});

test('card and global scopes record pins without seeding them back', () => {
    withPinnedScope(() => {
        settings.colorStorageScope = 'card';
        storage.loadData();
        state.setCharacterColors({ aria: characterEntry('Aria', '#ff0000', { keep: true }) });
        storage.saveData();
        // Recorded on card scope so a later switch to per-chat already knows the answer, but
        // never seeded: a card table already outlives a chat change on its own.
        assert.equal(storage.getPinnedCharacters().aria?.baseColor, '#ff0000');

        state.setCharacterColors({});
        assert.equal(storage.restorePinnedCharacters(), false);
        assert.equal(state.characterColors.aria, undefined);
    });
});

test('a user who never pins anyone leaves no bucket behind', () => {
    withPinnedScope(() => {
        state.setCharacterColors({ kel: characterEntry('Kel', '#00ff00') });
        storage.saveData();
        assert.equal(stApi.extension_settings[MODULE_NAME].ui?.pinnedCharacters, undefined,
            'an empty bucket for every card the user opens would ride along in every settings sync');
    });
});
