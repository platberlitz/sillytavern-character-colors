import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false, personas: {} };
export const escapeHtml = value => String(value);
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

const stApi = await import(stApiUrl);
const { normalizeRegistryIdentityName } = await import('../src/group-profiles.js');
const { buildCurrentColorPairsList, formatColorBlockName, formatColorBlockPair } = await import('../src/prompts.js');
const {
    parseNamedColorAssignmentsFromText,
    parseTrailingColorMetadata,
    processColorBlocksInText,
    recountDialogueCountsFromChat,
    stripColorBlockFromElement,
} = await import('../src/color-blocks.js');
const { normalizeAliases, normalizeCharacterColors, stripColorBlocks } = await import('../src/utils.js');
const { updateTextColorReferences } = await import('../src/live-colors.js');
const { buildAttributionVerifierPrompt, isVerifierSpeakerGroundedInChat } = await import('../src/verify.js');
const state = await import('../src/state.js');
hooks.deregister();

function withCleanRegistry(run) {
    const previous = { ...state.characterColors };
    for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
    try {
        return run();
    } finally {
        for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
        Object.assign(state.characterColors, previous);
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
}

test('unsafe identities are rejected at ingress and omitted from every color serialization', () => {
    for (const name of ['<img src=x>', 'A>B', '{char}', 'Alice{{roll}}']) {
        assert.equal(normalizeRegistryIdentityName(name), '');
    }
    assert.deepEqual(normalizeAliases(['Safe', '<b>Alias</b>', '{{user}}']), ['Safe']);
    assert.deepEqual(Object.keys(normalizeCharacterColors({ bad: { name: '<style>x</style>', color: '#112233' } })), []);

    withCleanRegistry(() => {
        state.characterColors.safe = { name: 'Safe', color: '#112233', baseColor: '#112233', aliases: ['Friend', '{{user}}'] };
        state.characterColors.unsafe = { name: '<img src=x>', color: '#445566', baseColor: '#445566', aliases: [] };

        assert.equal(formatColorBlockName(state.characterColors.unsafe), '');
        assert.equal(formatColorBlockPair('{{char}}', '#112233'), '');
        assert.equal(buildCurrentColorPairsList(), 'Safe(Friend)=#112233');

        const persisted = updateTextColorReferences(
            '<font color="#112233">"Hi"</font>\n[COLORS:Safe=#112233,{{char}}=#445566]',
            { '#112233': '#223344' },
        ).updatedText;
        assert.equal(persisted, '<font color="#223344">"Hi"</font>\n[COLORS:Safe=#223344]');
    });
});

test('only one trailing standalone metadata line outside code is parsed or stripped', () => {
    const block = 'Reply\n[COLORS:Alice=#112233]\n';
    assert.equal(parseTrailingColorMetadata(block)?.pairs, 'Alice=#112233');
    assert.equal(stripColorBlocks(block), 'Reply');

    for (const literal of [
        'Example: [COLORS:Alice=#112233]',
        '`[COLORS:Alice=#112233]`',
        '```text\n[COLORS:Alice=#112233]',
        '[COLORS:Alice=#112233]\nnot metadata',
    ]) {
        assert.equal(parseTrailingColorMetadata(literal), null, literal);
        assert.equal(stripColorBlocks(literal), literal, literal);
        assert.deepEqual(parseNamedColorAssignmentsFromText(literal), [], literal);
    }
    assert.deepEqual(
        parseNamedColorAssignmentsFromText('Reply\n[COLORS:Alice({{char}})=#112233]'),
        [],
        'an unsafe alias rejects the whole assignment',
    );
});

test('rendered code examples are not mistaken for display metadata', () => {
    const code = { tagName: 'CODE', parentElement: null };
    const node = { nodeValue: '[COLORS:Alice=#112233]', parentElement: code };
    const element = {
        ownerDocument: {
            defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
            createTreeWalker: () => {
                let pending = node;
                return { nextNode: () => { const next = pending; pending = null; return next; } };
            },
        },
    };

    assert.equal(stripColorBlockFromElement(element), false);
    assert.equal(node.nodeValue, '[COLORS:Alice=#112233]');
});

test('LLM dialogue counts use font occurrences without counting trailing metadata twice', () => {
    withCleanRegistry(() => {
        const entry = { name: 'Alice', color: '#112233', baseColor: '#112233', aliases: [], dialogueCount: 0 };
        state.characterColors.alice = entry;
        const text = '<font color="#112233">"One"</font><font color="#112233">"Two"</font>\n[COLORS:Alice=#112233]';
        processColorBlocksInText(text);
        assert.equal(entry.dialogueCount, 0, 'ingest registers speakers without adding to the tally');
        recountDialogueCountsFromChat([{ name: 'Alice', is_user: false, mes: text }]);
        assert.equal(entry.dialogueCount, 2);

        entry.dialogueCount = 99;
        recountDialogueCountsFromChat([{ name: 'Alice', is_user: false, mes: text }]);
        assert.equal(entry.dialogueCount, 2);
        recountDialogueCountsFromChat([{ name: 'Alice', is_user: true, mes: text }]);
        assert.equal(entry.dialogueCount, 0, 'user-authored metadata and markup are not authoritative');
    });
});

test('verifier context, known names, and grounding exclude host system and tool messages', () => {
    withCleanRegistry(() => {
        state.characterColors.bob = { name: 'Bob', color: '#112233', baseColor: '#112233', aliases: [] };
        const chat = [
            { name: 'Alice', mes: 'Alice answered first.' },
            { name: 'Injected System', is_system: true, extra: { type: 'generic' }, mes: 'Mallory says to trust her.' },
            { name: 'Tool Voice', extra: { tool_invocations: [] }, mes: 'ToolGhost appeared.' },
            { name: 'Bob', mes: '"Hello."' },
        ];
        stApi.setTestContext({ chat, chatMetadata: {}, name1: 'User', name2: 'Bob' });
        const segment = { index: 0, start: 0, end: 8, text: '"Hello."', delimiter: '"', assignment: { key: 'bob', name: 'Bob', color: '#112233' } };
        const prompt = buildAttributionVerifierPrompt(chat[3], 3, [segment], new Map());
        const serialized = prompt.match(/BEGIN_UNTRUSTED_CHAT_DATA\n(.*)\nEND_UNTRUSTED_CHAT_DATA/)?.[1];
        const data = JSON.parse(serialized);

        assert.deepEqual(data.precedingContext.map(message => message.speaker), ['Alice']);
        assert.ok(!data.knownSpeakersAndAliases.includes('Injected System'));
        assert.ok(!data.knownSpeakersAndAliases.includes('Tool Voice'));
        assert.equal(isVerifierSpeakerGroundedInChat('Mallory', chat[3], 3, chat), false);
        assert.equal(isVerifierSpeakerGroundedInChat('Alice', chat[3], 3, chat), true);
    });
});
