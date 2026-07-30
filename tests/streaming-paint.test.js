import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Same single-module stub as dom-attribution-heuristics.test.js: src reaches
// SillyTavern only through st-api.js, so replacing it lets the real streaming
// attribution and decoration code run under node --test.
const stApiStub = `
export const converter = { makeHtml: value => String(value) };
export const power_user = { quote_text_color: '#888888', encode_tags: false };
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

const { attributeDialogueSegments, balanceStreamingText } = await import('../src/attribution.js');
const { applySegmentDecoration, matchSegmentsToElements } = await import('../src/dom-engine.js');
const { characterColors, resetStreamingSession, settings, streamingSession } = await import('../src/state.js');
const { normalizeSegmentText } = await import('../src/utils.js');
hooks.deregister();

function withCharacters(names, run) {
    const previousColors = { ...characterColors };
    const previousEngine = settings.coloringEngine;
    const previousSymbols = settings.thoughtSymbols;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    names.forEach((name, index) => {
        characterColors[name.toLowerCase()] = { name, color: index === 0 ? '#112233' : '#445566', aliases: [], dialogueCount: 0 };
    });
    settings.coloringEngine = 'dom';
    settings.thoughtSymbols = '*';
    try {
        return run();
    } finally {
        resetStreamingSession();
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        settings.coloringEngine = previousEngine;
        settings.thoughtSymbols = previousSymbols;
    }
}

// A streaming tick: the same message body, one prefix longer than the last.
function streamTick(text, speaker, options = {}) {
    return attributeDialogueSegments(text, speaker, {
        streaming: true,
        mesIndex: streamingSession.mesIndex,
        autoAddMessageSpeaker: true,
        ...options,
    }).segments.filter(segment => segment.delimiter !== '*' && segment.delimiter !== '_');
}

function armSession(mesIndex = 0) {
    resetStreamingSession();
    streamingSession.active = true;
    streamingSession.mesIndex = mesIndex;
}

// Without the freeze this quote is Bob's until "Alice added." streams in, then
// becomes Alice's - the visible mid-stream colour change being fixed here.
const EARLY_TICK = 'Bob shrugged. "Fine."';
const LATER_TICK = 'Bob shrugged. "Fine." Alice added.';

test('a later tick cannot recolour a quote the user already saw', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const unfrozen = attributeDialogueSegments(LATER_TICK, 'Alice', { autoAddMessageSpeaker: true }).segments;
        assert.equal(unfrozen[0].assignment?.name, 'Alice');

        armSession();
        const early = streamTick(EARLY_TICK, 'Alice');
        assert.equal(early[0].assignment?.name, 'Bob');

        const later = streamTick(LATER_TICK, 'Alice');
        assert.equal(later[0].assignment?.name, 'Bob');
        assert.equal(later[0].provenance.method, 'streaming-cache');
    });
});

test('identical quote texts freeze independently by their order in the message', () => {
    withCharacters(['Alice', 'Bob'], () => {
        armSession();
        streamTick('Alice said "Yes." Bob said "Yes."', 'Alice');
        const keys = Array.from(streamingSession.assignments.keys());
        assert.equal(keys.length, 2);
        assert.equal(new Set(keys).size, 2);
        assert.ok(keys.some(key => key.endsWith('#0')));
        assert.ok(keys.some(key => key.endsWith('#1')));
    });
});

test('a manual override outranks the frozen assignment', () => {
    withCharacters(['Alice', 'Bob'], () => {
        armSession();
        assert.equal(streamTick(EARLY_TICK, 'Alice')[0].assignment?.name, 'Bob');
        const overridden = streamTick(EARLY_TICK, 'Alice', { overrides: { 0: 'Alice' } })[0];
        assert.equal(overridden.assignment?.name, 'Alice');
        assert.equal(overridden.provenance.method, 'override');
    });
});

test('nothing freezes for a message the painter does not own', () => {
    withCharacters(['Alice', 'Bob'], () => {
        armSession(3);
        attributeDialogueSegments('Bob shrugged. "Fine."', 'Alice', { streaming: true, mesIndex: 2, autoAddMessageSpeaker: true });
        assert.equal(streamingSession.assignments.size, 0);
    });
});

test('balancing closes a half-typed delimiter and leaves complete text alone', () => {
    assert.equal(balanceStreamingText('He said "Hel'), 'He said "Hel"');
    assert.equal(balanceStreamingText('She *smi'), 'She *smi*');
    assert.equal(balanceStreamingText('He said "Hello."'), 'He said "Hello."');
    assert.equal(balanceStreamingText('*nods*'), '*nods*');
    // Trailing whitespace would otherwise land inside the quote.
    assert.equal(balanceStreamingText('He said "Hel   '), 'He said "Hel"');
    // Code fences never render as <q> or <em>, so they are left as-is.
    assert.equal(balanceStreamingText('```js'), '```js');
});

test('a half-typed quote is segmented the same way the host renders it', () => {
    withCharacters(['Alice'], () => {
        armSession();
        const partial = streamTick('Alice said "Hel', 'Alice');
        assert.equal(partial.length, 1);
        assert.equal(normalizeSegmentText(partial[0].text), normalizeSegmentText('"Hel"'));
    });
});

function fakeElement(text) {
    const attributes = new Map();
    const style = {};
    const el = {
        textContent: text,
        writes: 0,
        style: new Proxy(style, {
            set(target, property, value) {
                if (target[property] !== value) el.writes++;
                target[property] = value;
                return true;
            },
            get(target, property) {
                if (property === 'getPropertyValue') return name => target[name] ?? '';
                if (property === 'removeProperty') return name => { if (name in target) { el.writes++; delete target[name]; } };
                if (property === 'setProperty') return (name, value) => { if (target[name] !== value) el.writes++; target[name] = value; };
                return target[property] ?? '';
            },
        }),
        classList: { add() {}, remove() {}, contains: () => false },
        getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
        setAttribute(name, value) { el.writes++; attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        hasAttribute: name => attributes.has(name),
        querySelectorAll: () => [],
        closest: () => null,
    };
    return el;
}

test('repainting an already-correct element writes nothing to the DOM', () => {
    withCharacters(['Alice'], () => {
        armSession();
        const segments = streamTick('Alice said "Hello."', 'Alice');
        const el = fakeElement('Hello.');
        applySegmentDecoration(segments[0], el);
        assert.ok(el.writes > 0);
        assert.equal(el.getAttribute('data-dc-colored'), '1');

        el.writes = 0;
        applySegmentDecoration(segments[0], el);
        assert.equal(el.writes, 0, 'a no-op repaint must not restart gradients or wake observers');
    });
});

test('a wiped tick repaints to the same colour without a clear pass', () => {
    withCharacters(['Alice', 'Bob'], () => {
        armSession();
        const paint = text => {
            const segments = streamTick(text, 'Alice');
            // The host replaces .mes_text wholesale, so every tick starts from
            // fresh, undecorated elements.
            const elements = segments.map(segment => fakeElement(normalizeSegmentText(segment.text).slice(1, -1)));
            matchSegmentsToElements(segments, elements, seg => normalizeSegmentText(seg.text), applySegmentDecoration, { allowAnchoredFallback: true });
            return elements.map(el => el.style.color);
        };

        const first = paint(EARLY_TICK);
        const second = paint(LATER_TICK);
        assert.ok(first[0]);
        assert.equal(second[0], first[0]);
    });
});

test('ending the session drops the frozen assignments and the observer', () => {
    withCharacters(['Alice'], () => {
        armSession();
        let disconnected = false;
        streamingSession.observer = { disconnect() { disconnected = true; } };
        streamTick('Alice said "Hello."', 'Alice');
        assert.ok(streamingSession.assignments.size > 0);

        resetStreamingSession();
        assert.ok(disconnected);
        assert.equal(streamingSession.active, false);
        assert.equal(streamingSession.mesIndex, -1);
        assert.equal(streamingSession.assignments.size, 0);
        assert.equal(streamingSession.observer, null);
    });
});
