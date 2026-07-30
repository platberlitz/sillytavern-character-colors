import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths
// that only resolve inside a SillyTavern install. Stubbing that one module lets
// the real attribution, segmentation and override code run under node --test.
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

// Theme detection reads the page background to pick readability bounds.
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
const { buildDialogueRegex, DIALOGUE_SKIP_GROUP } = await import('../src/color-blocks.js');
const { attributeDialogueSegments } = await import('../src/attribution.js');
const {
    deleteMessageQuoteOverride,
    getMessageQuoteOverrideOptions,
    matchSegmentsToElements,
    resolveDomSegmentIndexForElement,
    setMessageQuoteOverride,
} = await import('../src/dom-engine.js');
const { ATTRIBUTION_SOURCE } = await import('../src/attribution-store.js');
const { characterColors, settings } = await import('../src/state.js');
const { normalizeSegmentText } = await import('../src/utils.js');
hooks.deregister();

// Copied from SillyTavern public/script.js (the quote replace inside
// messageFormatting). The extension's segmentation has to agree with it or
// segment indices stop lining up with the rendered <q> elements.
const SILLYTAVERN_QUOTE_RE = /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim;

function renderSillyTavernQuotes(text) {
    const quotes = [];
    String(text).replace(SILLYTAVERN_QUOTE_RE, (match, ...groups) => {
        const captured = groups.slice(0, 6).find(value => value !== undefined);
        if (captured !== undefined) quotes.push(captured);
        return match;
    });
    return quotes;
}

function extractQuoteSegments(text, speaker = 'Bob') {
    return attributeDialogueSegments(text, speaker)
        .segments
        .filter(segment => segment.delimiter !== '*' && segment.delimiter !== '_');
}

// Minimal stand-ins for the DOM nodes resolveDomSegmentIndexForElement walks.
function createFakeElement(tagName, textContent, mesText) {
    const attributes = new Map();
    return {
        tagName,
        textContent,
        closest: selector => (selector === '.mes_text' ? mesText : null),
        matches: selector => selector === tagName.toLowerCase(),
        hasAttribute: name => attributes.has(name),
        getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
        setAttribute: (name, value) => attributes.set(name, String(value)),
    };
}

function createFakeMesText(quoteTexts) {
    const mesText = { elements: [] };
    mesText.elements = quoteTexts.map(text => createFakeElement('Q', text, mesText));
    mesText.querySelectorAll = selector => (selector === 'q' ? mesText.elements : []);
    return mesText;
}

function withCharacters(names, run) {
    const previousColors = { ...characterColors };
    const previousEngine = settings.coloringEngine;
    const previousSymbols = settings.thoughtSymbols;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    for (const name of names) {
        characterColors[name.toLowerCase()] = { name, color: '#112233', aliases: [] };
    }
    settings.coloringEngine = 'dom';
    settings.thoughtSymbols = '*';
    try {
        return run();
    } finally {
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        settings.coloringEngine = previousEngine;
        settings.thoughtSymbols = previousSymbols;
    }
}

function withChat(messages, run) {
    const metadata = {};
    stApi.setTestContext({ chat: messages, chatMetadata: metadata });
    try {
        return run(metadata);
    } finally {
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
}

function speakersFor(mesIndex, message) {
    return attributeDialogueSegments(message.mes, message.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, message),
        mesIndex,
    }).segments.map(segment => segment.assignment?.name || null);
}

function frozenSiblings(mesIndex, message, segmentIndex) {
    const frozen = {};
    for (const segment of attributeDialogueSegments(message.mes, message.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, message),
        mesIndex,
    }).segments) {
        if (segment.index === segmentIndex) continue;
        const name = segment.assignment?.name || segment.assignment?.key;
        if (name) frozen[String(segment.index)] = name;
    }
    return frozen;
}

test('segmentation matches SillyTavern rendered quotes', () => {
    const cases = [
        '"This this"\n"Reply reply"',
        '"A"\n\n"B"',
        '*thinks* "A"\n"B"',
        '"He said **stop**"\n"B"',
        '\u00abBonjour\u00bb\n"Reply reply"',
        '\u300cKonnichiwa\u300d\n"Reply reply"',
        '\u300eShiro\u300f\n"B"',
        '\uff02Hi\uff02\n"B"',
        '\u201cHi\u201d\n"B"',
        '"This this\n"Reply reply"',
        'The 6" pipe.\n"This this"\n"Reply reply"',
        'Type `say "hi"` then "B"',
        '```\nsay "hi"\n```\n"B"',
        '"This this\nstill talking"\n\n"Reply reply"',
        '"" and "B"',
        '<style>q{color:"red"}</style>\n"B"',
    ];
    withCharacters(['Bob'], () => {
        for (const text of cases) {
            assert.deepEqual(
                extractQuoteSegments(text).map(segment => segment.text),
                renderSillyTavernQuotes(text),
                `segmentation diverged for ${JSON.stringify(text)}`,
            );
        }
    });
});

test('code spans and fences are skipped rather than segmented', () => {
    const regex = buildDialogueRegex();
    const matches = Array.from('Type `say "hi"` then "B"'.matchAll(regex));
    assert.equal(matches.filter(match => match.groups?.[DIALOGUE_SKIP_GROUP] !== undefined).length, 1);
    withCharacters(['Bob'], () => {
        assert.deepEqual(extractQuoteSegments('Type `say "hi"` then "B"').map(segment => segment.text), ['"B"']);
    });
});

test('every rendered quote resolves to a distinct segment index', () => {
    withCharacters(['Bob'], () => {
        for (const text of [
            '"This this"\n"Reply reply"',
            '\u00abBonjour\u00bb\n"Reply reply"',
            'The 6" pipe.\n"This this"\n"Reply reply"',
        ]) {
            const message = { id: `m-${text.length}`, name: 'Bob', mes: text };
            withChat([message], () => {
                const mesText = createFakeMesText(renderSillyTavernQuotes(text));
                const indices = mesText.elements
                    .map(element => resolveDomSegmentIndexForElement(element, 0, message))
                    .filter(Number.isFinite);
                assert.equal(indices.length, mesText.elements.length, `unresolved quote in ${JSON.stringify(text)}`);
                assert.equal(new Set(indices).size, indices.length, `duplicate segment index in ${JSON.stringify(text)}`);
            });
        }
    });
});

test('an unmappable quote refuses to resolve instead of guessing an index', () => {
    withCharacters(['Bob'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"This this"\n"Reply reply"' };
        withChat([message], () => {
            const mesText = createFakeMesText(['"Something else entirely"']);
            assert.equal(Number.isNaN(resolveDomSegmentIndexForElement(mesText.elements[0], 0, message)), true);
        });
    });
});

test('a manual override does not re-attribute its neighbours', () => {
    const texts = [
        '"A" "B"',
        '"A"\n"B"',
        '"A"\n"B"\n"C"',
        '"A"\n"B"\n"C"\n"D"',
        '"A" "B"\n"C" "D"',
    ];
    withCharacters(['Bob', 'Alice'], () => {
        for (const text of texts) {
            const message = { id: `m-${text.length}`, name: 'Bob', mes: text };
            for (let pinned = 0; pinned < extractQuoteSegments(text).length; pinned++) {
                withChat([message], () => {
                    const before = speakersFor(0, message);
                    assert.equal(
                        setMessageQuoteOverride(0, message, pinned, 'Alice', {
                            source: ATTRIBUTION_SOURCE.MANUAL,
                            freezeSegments: frozenSiblings(0, message, pinned),
                        }),
                        true,
                    );
                    const after = speakersFor(0, message);
                    const expected = before.slice();
                    expected[pinned] = 'Alice';
                    assert.deepEqual(after, expected, `override on ${pinned} of ${JSON.stringify(text)} cascaded`);
                });
            }
        }
    });
});

test('frozen siblings are recorded separately and dropped with the last real override', () => {
    withCharacters(['Bob', 'Alice'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"\n"C"' };
        withChat([message], metadata => {
            setMessageQuoteOverride(0, message, 0, 'Alice', {
                source: ATTRIBUTION_SOURCE.MANUAL,
                freezeSegments: frozenSiblings(0, message, 0),
            });
            const entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.sources['0'], ATTRIBUTION_SOURCE.MANUAL);
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.FROZEN);
            assert.equal(entry.sources['2'], ATTRIBUTION_SOURCE.FROZEN);

            assert.equal(deleteMessageQuoteOverride(0, message, 0), true);
            assert.deepEqual(metadata.dialogue_colors_overrides['0'].segments, {});
            assert.deepEqual(speakersFor(0, message), ['Bob', 'Bob', 'Bob']);
        });
    });
});

test('clearing one of two manual overrides keeps the frozen snapshot', () => {
    withCharacters(['Bob', 'Alice', 'Carol'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"\n"C"\n"D"' };
        withChat([message], metadata => {
            setMessageQuoteOverride(0, message, 0, 'Alice', {
                source: ATTRIBUTION_SOURCE.MANUAL,
                freezeSegments: frozenSiblings(0, message, 0),
            });
            setMessageQuoteOverride(0, message, 2, 'Carol', { source: ATTRIBUTION_SOURCE.MANUAL });
            assert.equal(deleteMessageQuoteOverride(0, message, 0), true);
            const entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.segments['2'], 'Carol');
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.FROZEN);
            assert.equal(entry.sources['3'], ATTRIBUTION_SOURCE.FROZEN);
        });
    });
});

test('matchSegmentsToElements never hands two elements the same segment', () => {
    const mesText = createFakeMesText(['"A"', '"A"', '"B"']);
    const segments = [
        { index: 0, text: '"A"', delimiter: '"' },
        { index: 1, text: '"A"', delimiter: '"' },
        { index: 2, text: '"B"', delimiter: '"' },
    ];
    const pairs = [];
    matchSegmentsToElements(segments, mesText.elements, seg => normalizeSegmentText(seg.text), (seg, el) => {
        pairs.push([seg.index, mesText.elements.indexOf(el)]);
    });
    assert.deepEqual(pairs, [[0, 0], [1, 1], [2, 2]]);
});
