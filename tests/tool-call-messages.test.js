import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only
// resolve inside a SillyTavern install. Stubbing that one module lets the real gate,
// colorizer and repair run under node --test.
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
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const { isToolCallMessage } = await import('../src/utils.js');
const { isHostSystemOrToolMessage } = await import('../src/attribution-store.js');
const { isColorableMessage, repairColorizedToolCallMessages, restoreColorizedToolCallText } = await import('../src/live-colors.js');
const { colorizeMessageText, ensureCharacterEntry } = await import('../src/attribution.js');
const { processColorBlocksInText, recountDialogueCountsFromChat } = await import('../src/color-blocks.js');
const state = await import('../src/state.js');
const { isMessageEligibleForAttributionVerification } = await import('../src/verify.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };

function registry() {
    return state.characterColors;
}

function withCleanRegistry(run) {
    const previousColors = { ...registry() };
    for (const key of Object.keys(registry())) delete registry()[key];
    Object.assign(settings, DEFAULT_SETTINGS);
    try {
        return run();
    } finally {
        for (const key of Object.keys(registry())) delete registry()[key];
        Object.assign(registry(), previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
    }
}

// The shape SillyTavern's ToolManager actually posts: a <details> wrapping a JSON dump,
// under the host's system user, flagged with the invocation array.
const TOOL_MES = '<details><summary>Tool calls: Dice Roll (with DC) (2)</summary>'
    + '<pre><code class="language-json">[\n  {\n    "name": "DiceRoll",\n'
    + '    "parameters": { "sides": 20 },\n    "result": "Emily rolls a 17"\n  }\n]</code></pre></details>';

function toolMessage(mes = TOOL_MES) {
    return {
        name: 'SillyTavern System',
        is_system: true,
        is_user: false,
        mes,
        extra: { isSmallSys: true, tool_invocations: [{ id: 'a1', name: 'DiceRoll', parameters: '{}', result: '17' }] },
    };
}

const HISTORICAL_TOOL_COLOR = '#a1b2c3';

function historicallyColorizedToolText(name = 'SillyTavern System') {
    return TOOL_MES.replace('"name"', `<font color="${HISTORICAL_TOOL_COLOR}">"name"</font>`)
        + `\n[COLORS:${name}=${HISTORICAL_TOOL_COLOR}]`;
}

test('a tool-call message is recognised the way SillyTavern recognises it', () => {
    assert.equal(isToolCallMessage(toolMessage()), true);
    assert.equal(isToolCallMessage(null), false);
    assert.equal(isToolCallMessage(undefined), false);
    assert.equal(isToolCallMessage({}), false);
    assert.equal(isToolCallMessage({ extra: {} }), false);
    assert.equal(isToolCallMessage({ extra: { tool_invocations: null } }), false);
    assert.equal(isToolCallMessage({ extra: { tool_invocations: 'DiceRoll' } }), false);
});

test('the LLM engine refuses to color a tool-call message', () => {
    assert.equal(isColorableMessage(toolMessage()), false);
});

test('an ordinary system-flagged message stays colorable', () => {
    // /hide sets is_system on ordinary character messages (hideChatMessageRange in
    // public/scripts/chats.js). They still render, and their saved font tags still have to
    // follow a color change, so the gate must not widen to is_system.
    const hidden = { name: 'Alice', is_system: true, is_user: false, mes: '"Hi."', extra: {} };
    assert.equal(isColorableMessage(hidden), true);
    assert.equal(isHostSystemOrToolMessage(hidden), false);
    assert.equal(isMessageEligibleForAttributionVerification(hidden), true);
});

test('hiding compact ordinary dialogue does not turn it into a host system message', () => {
    const hidden = {
        name: 'Alice',
        is_system: true,
        is_user: false,
        mes: '"Hi."',
        extra: { isSmallSys: true, api: 'manual', model: 'slash command' },
    };
    assert.equal(isHostSystemOrToolMessage(hidden), false);
    assert.equal(isMessageEligibleForAttributionVerification(hidden), true);
});

test('actual host system and tool messages share the non-dialogue gate', () => {
    const system = {
        name: 'SillyTavern System',
        is_system: true,
        is_user: false,
        mes: 'Internal status',
        extra: { type: 'generic' },
    };
    assert.equal(isHostSystemOrToolMessage(system), true);
    assert.equal(isMessageEligibleForAttributionVerification(system), false);
    assert.equal(isHostSystemOrToolMessage(toolMessage()), true);
    assert.equal(isMessageEligibleForAttributionVerification(toolMessage()), false);
});

test('a historically colorized tool-call payload is reversed byte for byte', () => {
    withCleanRegistry(() => {
        ensureCharacterEntry('Emily');
        const damaged = historicallyColorizedToolText();

        const chat = [toolMessage(damaged)];
        const report = repairColorizedToolCallMessages(chat);
        assert.deepEqual(report.repairedIndices, [0]);
        assert.equal(chat[0].mes, TOOL_MES);
    });
});

test('markup this extension did not write is declined rather than guessed at', () => {
    const foreign = TOOL_MES.replace('<pre>', '<font size="3"><pre>') + '</font>';
    assert.equal(restoreColorizedToolCallText(foreign), null);

    const unbalanced = `${TOOL_MES}</font>`;
    assert.equal(restoreColorizedToolCallText(unbalanced), null);

    const chat = [toolMessage(foreign), toolMessage(unbalanced)];
    const report = repairColorizedToolCallMessages(chat);
    assert.deepEqual(report.repairedIndices, []);
    assert.equal(chat[0].mes, foreign);
    assert.equal(chat[1].mes, unbalanced);
});

test('canonical font markup without matching generated metadata is never auto-repaired', () => {
    const legitimate = '<font color="#a1b2c3">"tool result"</font>';
    const mismatched = `${legitimate}\n[COLORS:Alice=#112233]`;
    const chat = [toolMessage(legitimate), toolMessage(mismatched)];

    assert.equal(restoreColorizedToolCallText(legitimate), null);
    assert.equal(restoreColorizedToolCallText(mismatched), null);
    assert.deepEqual(repairColorizedToolCallMessages(chat).repairedIndices, []);
    assert.deepEqual(chat.map(message => message.mes), [legitimate, mismatched]);
});

test('an undamaged tool-call message is left alone and the repair is idempotent', () => {
    const chat = [toolMessage()];
    assert.deepEqual(repairColorizedToolCallMessages(chat).repairedIndices, []);
    assert.equal(chat[0].mes, TOOL_MES);

    withCleanRegistry(() => {
        ensureCharacterEntry('Emily');
        const repeat = [toolMessage(historicallyColorizedToolText())];
        assert.equal(repairColorizedToolCallMessages(repeat).repairedIndices.length, 1);
        assert.deepEqual(repairColorizedToolCallMessages(repeat).repairedIndices, []);
        assert.equal(repeat[0].mes, TOOL_MES);
    });
});

test('colored ordinary messages are never touched by the repair', () => {
    const normal = {
        name: 'Alice',
        is_user: false,
        mes: '<font color="#ff4d6d">"Hello."</font>\n[COLORS:Alice=#ff4d6d]',
        extra: {},
    };
    const hidden = {
        name: 'Bob',
        is_system: true,
        is_user: false,
        mes: '<font color="#4dffff">"Hidden."</font>\n[COLORS:Bob=#4dffff]',
        extra: {},
    };
    const chat = [normal, hidden];
    const before = chat.map(msg => msg.mes);
    assert.deepEqual(repairColorizedToolCallMessages(chat).repairedIndices, []);
    assert.deepEqual(chat.map(msg => msg.mes), before);
});

test('the bogus system character is removed while real speakers survive', () => {
    withCleanRegistry(() => {
        ensureCharacterEntry('Emily');
        const damaged = historicallyColorizedToolText();
        // Register the entries the way the bug registered them: by ingesting the block, which
        // creates them locked when autoLockDetected is on.
        processColorBlocksInText(damaged);
        assert.ok(registry()['sillytavern system'], 'the bug must have created the system entry');

        const emilyColor = registry().emily.color;
        const chat = [
            { name: 'Emily', is_user: false, extra: {}, mes: `<font color="${emilyColor}">"Still here."</font>\n[COLORS:Emily=${emilyColor}]` },
            toolMessage(damaged),
        ];
        const report = repairColorizedToolCallMessages(chat);

        assert.deepEqual(report.repairedIndices, [1]);
        assert.equal(registry()['sillytavern system'], undefined);
        assert.ok(report.removedCharacterKeys.includes('sillytavern system'));
        assert.ok(registry().emily, 'a speaker referenced elsewhere must survive');
    });
});

test('an entry the user marked Keep survives the cleanup', () => {
    withCleanRegistry(() => {
        ensureCharacterEntry('Emily');
        const damaged = historicallyColorizedToolText();
        processColorBlocksInText(damaged);
        registry()['sillytavern system'].keep = true;

        const chat = [toolMessage(damaged)];
        const report = repairColorizedToolCallMessages(chat);

        assert.deepEqual(report.repairedIndices, [0]);
        assert.ok(registry()['sillytavern system'], 'Keep must protect the entry');
        assert.deepEqual(report.removedCharacterKeys, []);
    });
});

test('a candidate whose color is still used elsewhere is kept', () => {
    withCleanRegistry(() => {
        ensureCharacterEntry('Emily');
        const damaged = historicallyColorizedToolText();
        processColorBlocksInText(damaged);
        const systemColor = registry()['sillytavern system'].color;

        const chat = [
            { name: 'Emily', is_user: false, extra: {}, mes: `<font color="${systemColor}">"Wearing that color."</font>` },
            toolMessage(damaged),
        ];
        const report = repairColorizedToolCallMessages(chat);

        assert.deepEqual(report.repairedIndices, [1]);
        assert.ok(registry()['sillytavern system'], 'a color still in use must not be orphaned');
    });
});

test('a candidate who authors an ordinary message survives tool repair', () => {
    withCleanRegistry(() => {
        const { entry } = ensureCharacterEntry('Alice');
        const damaged = `<font color="${entry.color}">payload</font>\n[COLORS:Alice=${entry.color}]`;
        const chat = [
            { name: 'Alice', is_user: false, extra: {}, mes: 'An ordinary uncolored message.' },
            toolMessage(damaged),
        ];

        const report = repairColorizedToolCallMessages(chat);

        assert.deepEqual(report.repairedIndices, [1]);
        assert.ok(registry().alice, 'ordinary message authors are real references');
        assert.ok(!report.removedCharacterKeys.includes('alice'));
    });
});

test('LLM dialogue counts are rebuilt after a message deletion', () => {
    withCleanRegistry(() => {
        registry().alice = { name: 'Alice', color: '#112233', aliases: [], dialogueCount: 99 };
        registry().bob = { name: 'Bob', color: '#445566', aliases: [], dialogueCount: 99 };
        const chat = [
            { name: 'Alice', is_user: false, extra: {}, mes: '<font color="#112233">"A"</font>\n[COLORS:Alice=#112233]' },
            { name: 'Bob', is_user: false, extra: {}, mes: '<font color="#445566">"B"</font>' },
            toolMessage('<font color="#112233">internal</font>'),
        ];

        assert.equal(recountDialogueCountsFromChat(chat), true);
        assert.equal(registry().alice.dialogueCount, 1);
        assert.equal(registry().bob.dialogueCount, 1);

        chat.shift();
        assert.equal(recountDialogueCountsFromChat(chat), true);
        assert.equal(registry().alice.dialogueCount, 0);
        assert.equal(registry().bob.dialogueCount, 1);
    });
});
