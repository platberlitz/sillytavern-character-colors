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
const { applySegmentDecoration, getStreamingAttributionOverrides, matchSegmentsToElements, setMessageQuoteOverride, setStreamingAttributionOverride } = await import('../src/dom-engine.js');
const { characterColors, resetStreamingSession, settings, streamingSession } = await import('../src/state.js');
const { paintStreamingMessage } = await import('../src/streaming-paint.js');
const { cancelStreamingAttributionVerification } = await import('../src/verify.js');
const { normalizeSegmentText } = await import('../src/utils.js');
const { setTestContext } = await import(stApiUrl);
hooks.deregister();

function withCharacters(names, run) {
    const previousColors = { ...characterColors };
    const previousEnabled = settings.enabled;
    const previousEngine = settings.coloringEngine;
    const previousSymbols = settings.thoughtSymbols;
    const previousHighlightMode = settings.highlightMode;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    names.forEach((name, index) => {
        characterColors[name.toLowerCase()] = { name, color: index === 0 ? '#112233' : '#445566', aliases: [], dialogueCount: 0 };
    });
    settings.enabled = true;
    settings.coloringEngine = 'dom';
    settings.thoughtSymbols = '*';
    try {
        return run();
    } finally {
        resetStreamingSession();
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        settings.enabled = previousEnabled;
        settings.coloringEngine = previousEngine;
        settings.thoughtSymbols = previousSymbols;
        settings.highlightMode = previousHighlightMode;
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

function fakeElement(text, serializeStyle = (_name, value) => value) {
    const attributes = new Map();
    const style = {};
    const priorities = {};
    const el = {
        isConnected: true,
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
                if (property === 'getPropertyPriority') return name => priorities[name] ?? '';
                if (property === 'removeProperty') return name => {
                    if (name in target) el.writes++;
                    delete target[name];
                    delete priorities[name];
                };
                if (property === 'setProperty') return (name, value, priority = '') => {
                    const serialized = serializeStyle(name, value);
                    if (target[name] !== serialized || priorities[name] !== priority) el.writes++;
                    target[name] = serialized;
                    priorities[name] = priority;
                };
                return target[property] ?? '';
            },
        }),
        classList: (() => {
            const classes = new Set();
            return {
                add: name => classes.add(name),
                remove: name => classes.delete(name),
                contains: name => classes.has(name),
                toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
            };
        })(),
        getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
        setAttribute(name, value) { el.writes++; attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        hasAttribute: name => attributes.has(name),
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
    };
    return el;
}

test('a saved correction repaints the streaming-owned gradient immediately', () => {
    const message = { mes: 'Alice said "Hello."', name: 'Alice' };
    setTestContext({ chat: [message], chatMetadata: {} });
    try {
        withCharacters(['Alice', 'Bob'], () => {
            characterColors.bob.baseColor = characterColors.bob.color;
            characterColors.bob.gradient = {
                type: 'linear',
                angle: 90,
                x: 50,
                y: 50,
                primaryPosition: 0,
                stops: [{ baseColor: '#778899', color: '#778899', position: 100 }],
                animation: { enabled: false, duration: 8, reverse: false },
            };

            const quote = fakeElement('Hello.');
            const mesText = fakeElement('Hello.');
            mesText.querySelectorAll = selector => selector === 'q' ? [quote] : [];
            armSession();
            streamingSession.mesElement = { isConnected: true };
            streamingSession.mesText = mesText;

            assert.equal(setMessageQuoteOverride(0, message, 0, 'Bob'), true);
            assert.equal(paintStreamingMessage(), true);
            assert.equal(quote.getAttribute('data-dc-speaker'), 'bob');
            assert.equal(quote.classList.contains('dc-gradient-text'), true);
            assert.match(quote.style.getPropertyValue('--dc-gradient'), /#445566.*#778899/);
        });
    } finally {
        setTestContext({ chat: [], chatMetadata: {} });
    }
});

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

test('no-clear decoration removes stale owned state and updates owned ARIA', () => {
    withCharacters(['Alice', 'Bob'], () => {
        Object.assign(characterColors.alice, {
            baseColor: characterColors.alice.color,
            font: 'Roboto',
            style: 'bold italic',
            gradient: {
                type: 'linear',
                stops: [{ color: '#112233', position: 0 }, { color: '#778899', position: 100 }],
                animation: { enabled: false, duration: 8, reverse: false },
            },
        });
        const element = fakeElement('Hello.');
        applySegmentDecoration({ index: 0, confidence: 0.9, assignment: { key: 'alice', name: 'Alice', color: '#112233' } }, element);
        assert.equal(element.classList.contains('dc-gradient-text'), true);
        assert.match(element.getAttribute('aria-label'), /^Alice:/);

        settings.highlightMode = false;
        applySegmentDecoration({ index: 0, confidence: 0.9, assignment: { key: 'bob', name: 'Bob', color: '#445566' } }, element);
        assert.equal(element.classList.contains('dc-gradient-text'), false);
        assert.equal(element.style.getPropertyValue('font-family'), '');
        assert.equal(element.style.getPropertyValue('font-weight'), '');
        assert.equal(element.style.getPropertyValue('font-style'), '');
        assert.equal(element.getAttribute('data-dc-speaker'), 'bob');
        assert.match(element.getAttribute('aria-label'), /^Bob:/);

        applySegmentDecoration({ index: 0, confidence: 0, assignment: null }, element);
        assert.equal(element.style.getPropertyValue('color'), '');
        assert.equal(element.getAttribute('data-dc-speaker'), null);
        assert.equal(element.getAttribute('aria-label'), null);
    });
});

test('owned decoration restores foreign inline styles and leaves foreign ARIA alone', () => {
    withCharacters(['Alice'], () => {
        Object.assign(characterColors.alice, { font: 'Roboto', style: 'bold' });
        settings.highlightMode = true;
        const element = fakeElement('Hello.');
        element.style.setProperty('color', 'purple');
        element.style.setProperty('background-color', 'yellow');
        element.style.setProperty('font-family', 'serif');
        element.style.setProperty('font-weight', '600');
        element.setAttribute('aria-label', 'Foreign description');

        applySegmentDecoration({ index: 0, confidence: 0.9, assignment: { key: 'alice', name: 'Alice', color: '#112233' } }, element);
        assert.equal(element.getAttribute('aria-label'), 'Foreign description');
        applySegmentDecoration({ index: 0, confidence: 0, assignment: null }, element);

        assert.equal(element.style.getPropertyValue('color'), 'purple');
        assert.equal(element.style.getPropertyValue('background-color'), 'yellow');
        assert.equal(element.style.getPropertyValue('font-family'), 'serif');
        assert.equal(element.style.getPropertyValue('font-weight'), '600');
        assert.equal(element.getAttribute('aria-label'), 'Foreign description');
    });
});

test('owned decoration restores styles after browser serialization', () => {
    withCharacters(['Alice'], () => {
        const element = fakeElement('Hello.', (name, value) => (
            name === 'color' && value === '#112233' ? 'rgb(17, 34, 51)' : value
        ));
        element.style.setProperty('color', 'purple', 'important');

        applySegmentDecoration({ index: 0, confidence: 0.9, assignment: { key: 'alice', name: 'Alice', color: '#112233' } }, element);
        assert.equal(element.style.getPropertyValue('color'), 'rgb(17, 34, 51)');
        element.writes = 0;
        applySegmentDecoration({ index: 0, confidence: 0.9, assignment: { key: 'alice', name: 'Alice', color: '#112233' } }, element);
        assert.equal(element.writes, 0);
        applySegmentDecoration({ index: 0, confidence: 0, assignment: null }, element);
        assert.equal(element.style.getPropertyValue('color'), 'purple');
        assert.equal(element.style.getPropertyPriority('color'), 'important');
    });
});

test('streaming clears decoration from a rendered segment that disappears', () => {
    const message = { mes: 'Alice said "Hello."', name: 'Alice' };
    setTestContext({ chat: [message], chatMetadata: {} });
    try {
        withCharacters(['Alice'], () => {
            const quote = fakeElement('"Hello."');
            const mesText = fakeElement('Hello.');
            mesText.querySelectorAll = selector => selector === 'q' ? [quote] : [];
            armSession();
            streamingSession.mesElement = { isConnected: true };
            streamingSession.mesText = mesText;
            assert.equal(paintStreamingMessage(), true);
            assert.equal(quote.getAttribute('data-dc-colored'), '1');

            message.mes = 'Narration only.';
            assert.equal(paintStreamingMessage(), true);
            assert.equal(quote.getAttribute('data-dc-colored'), null);
            assert.equal(quote.style.getPropertyValue('color'), '');
        });
    } finally {
        setTestContext({ chat: [], chatMetadata: {} });
    }
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

test('repainting an unchanged gradient does not restart its animation', async () => {
    // The running class is stripped and re-added on every refresh, which
    // restarts the animation from zero. Refreshes are coalesced per frame, so a
    // paint that changed nothing must not request a frame at all.
    const originalRaf = globalThis.requestAnimationFrame;
    const originalDocument = globalThis.document;
    let frames = 0;
    let pending = null;
    // Frames must resolve the way the browser does - after the caller returns -
    // or the controller's own "a refresh is already queued" guard would hide the
    // repeated restarts this test exists to catch.
    globalThis.requestAnimationFrame = callback => { frames++; pending = callback; return frames; };
    const flushFrame = () => { const callback = pending; pending = null; callback?.(); };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] };
    try {
        const { applyGradientText } = await import('../src/gradient-rendering.js');
        const entry = {
            color: '#ff0000',
            baseColor: '#ff0000',
            gradient: { type: 'linear', stops: [{ color: '#ff0000', position: 0 }, { color: '#00ff00', position: 100 }], animation: { enabled: true, durationSeconds: 4 } },
        };
        const element = fakeElement('Hello');
        applyGradientText(element, entry, { target: 'chat' });
        flushFrame();
        const afterFirstPaint = frames;

        for (let tick = 0; tick < 5; tick++) {
            applyGradientText(element, entry, { target: 'chat' });
            flushFrame();
        }
        assert.equal(frames - afterFirstPaint, 0);
    } finally {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.document = originalDocument;
    }
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

test('generation-end cancellation drops provisional streaming overrides', () => {
    const message = { id: 'm-1', name: 'Alice', mes: '"Hello."' };
    setTestContext({ chat: [message], chatMetadata: {} });
    try {
        assert.equal(setStreamingAttributionOverride(0, message, 0, 'Alice'), true);
        assert.equal(getStreamingAttributionOverrides(0, message)?.['0'], 'Alice');
        cancelStreamingAttributionVerification();
        assert.equal(getStreamingAttributionOverrides(0, message), null);
    } finally {
        setTestContext({ chat: [], chatMetadata: {} });
    }
});
