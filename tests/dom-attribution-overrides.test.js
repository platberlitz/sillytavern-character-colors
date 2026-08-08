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
    acceptAttributionReview,
    deleteMessageQuoteOverride,
    getMessageQuoteOverrideOptions,
    markMessageAttributionVerified,
    matchSegmentsToElements,
    queueObservedMessageDecoration,
    reconcileMessageQuoteOverridesAfterDeletion,
    renderMessageDomFallback,
    resolveDomSegmentIndexForElement,
    setMessageQuoteOverride,
    setStreamingAttributionOverride,
    stopDomHealthCheck,
    upsertAttributionReview,
} = await import('../src/dom-engine.js');
const { ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS } = await import('../src/attribution-store.js');
const { characterColors, runtimeState, settings } = await import('../src/state.js');
const { normalizeSegmentText } = await import('../src/utils.js');
hooks.deregister();

// Copied from SillyTavern public/script.js (the quote replace inside
// messageFormatting). The extension's segmentation has to agree with it or
// segment indices stop lining up with the rendered <q> elements.
const SILLYTAVERN_QUOTE_RE = /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim;

function renderSillyTavernQuotes(text) {
    const quotes = [];
    // Copied from the same place: with encode_tags off (the default) the host hides the double
    // quotes inside every HTML tag behind U+FFFE before the quote pass, then restores them, so
    // an attribute value never becomes a <q>.
    const masked = String(text).replace(/<([^>]+)>/g, (_, contents) => `<${contents.replaceAll('"', '\ufffe')}>`);
    masked.replace(SILLYTAVERN_QUOTE_RE, (match, ...groups) => {
        const captured = groups.slice(0, 6).find(value => value !== undefined);
        if (captured !== undefined) quotes.push(captured.replaceAll('\ufffe', '"'));
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
        '<STYLE>q{color:"red"}</STYLE>\n"B"',
        '<div class="stat-block">"A"</div>\n"B"',
        '<img src="portrait.png" alt="Bob">\n"B"',
        '<font color="#aabbcc">"A"</font>\n"B"',
        '"A <span class="tag"> B"\n"C"',
        '<div\n  class="wrapped">"A"</div>',
        '"6" and <div class="x">"B"</div>',
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
            mesText.elements[0].setAttribute('data-dc-seg', '0');
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

test('an existing verification-only entry still gets frozen siblings', () => {
    withCharacters(['Bob', 'Alice'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"\n"C"' };
        withChat([message], metadata => {
            assert.equal(markMessageAttributionVerified(0, message, ATTRIBUTION_VERIFICATION_STATUS.CLEAN), true);
            assert.deepEqual(metadata.dialogue_colors_overrides['0'].segments, {});
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Alice', {
                source: ATTRIBUTION_SOURCE.MANUAL,
                freezeSegments: {},
            }), true);
            assert.equal(metadata.dialogue_colors_overrides['0'].sources['1'], ATTRIBUTION_SOURCE.FROZEN);
            assert.equal(metadata.dialogue_colors_overrides['0'].sources['2'], ATTRIBUTION_SOURCE.FROZEN);
        });
    });
});

test('reassigning after deleting the last override rebuilds the frozen snapshot', () => {
    withCharacters(['Bob', 'Alice'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"\n"C"' };
        withChat([message], metadata => {
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Alice', { freezeSegments: {} }), true);
            assert.equal(deleteMessageQuoteOverride(0, message, 0), true);
            assert.deepEqual(metadata.dialogue_colors_overrides['0'].segments, {});
            assert.equal(setMessageQuoteOverride(0, message, 2, 'Alice', { freezeSegments: {} }), true);
            assert.equal(metadata.dialogue_colors_overrides['0'].sources['0'], ATTRIBUTION_SOURCE.FROZEN);
            assert.equal(metadata.dialogue_colors_overrides['0'].sources['1'], ATTRIBUTION_SOURCE.FROZEN);
        });
    });
});

test('an unresolved frozen sibling remains explicitly unassigned', () => {
    withCharacters(['Alice'], () => {
        const message = { id: 'm-1', name: '', mes: '"A" "B"' };
        withChat([message], metadata => {
            assert.deepEqual(speakersFor(0, message), [null, null]);
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Alice', { freezeSegments: {} }), true);
            const entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(Object.prototype.hasOwnProperty.call(entry.segments, '1'), true);
            assert.equal(entry.segments['1'], null);
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.FROZEN);
            assert.deepEqual(speakersFor(0, message), ['Alice', null]);
        });
    });
});

test('a frozen speaker removed from the registry stays unresolved', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const message = { id: 'm-1', name: 'Alice', mes: '"A"\n"B"' };
        withChat([message], () => {
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Bob', { source: ATTRIBUTION_SOURCE.FROZEN }), true);
            delete characterColors.bob;
            assert.deepEqual(speakersFor(0, message), [null, 'Alice']);
        });
    });
});

test('the frozen snapshot includes a streaming-visible sibling', () => {
    withCharacters(['Alice', 'Bob', 'Carol'], () => {
        const message = { id: 'm-1', name: 'Alice', mes: '"A"\n"B"' };
        withChat([message], metadata => {
            assert.equal(setStreamingAttributionOverride(0, message, 1, 'Bob'), true);
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Carol', { freezeSegments: {} }), true);
            const entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.segments['1'], 'Bob');
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.FROZEN);
        });
    });
});

test('freezing never overwrites a real sibling and manual writes drop stale review evidence', () => {
    withCharacters(['Alice', 'Bob', 'Carol'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"' };
        withChat([message], metadata => {
            assert.equal(setMessageQuoteOverride(0, message, 1, 'Carol', {
                source: ATTRIBUTION_SOURCE.REVIEW,
                confidence: 0.9,
                reviewId: 'review-1',
                evidence: [{ type: 'review' }],
            }), true);
            assert.equal(setMessageQuoteOverride(0, message, 0, 'Alice', {
                source: ATTRIBUTION_SOURCE.MANUAL,
                freezeSegments: { 1: 'Bob' },
            }), true);
            let entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.segments['1'], 'Carol');
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.REVIEW);

            assert.equal(setMessageQuoteOverride(0, message, 1, 'Bob', { source: ATTRIBUTION_SOURCE.MANUAL }), true);
            entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.confidences?.['1'], undefined);
            assert.equal(entry.reviewIds?.['1'], undefined);
            assert.equal(entry.records?.['1'], undefined);
        });
    });
});

test('review acceptance uses the freeze-preserving persistent write', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const message = { id: 'm-1', name: 'Bob', mes: '"A"\n"B"' };
        withChat([message], metadata => {
            const [segment] = attributeDialogueSegments(message.mes, message.name, { autoAddMessageSpeaker: false }).segments;
            const review = upsertAttributionReview({
                message,
                messageIndex: 0,
                segment,
                currentSpeaker: 'Bob',
                proposedSpeaker: 'Alice',
                source: ATTRIBUTION_SOURCE.LLM,
                confidence: 0.9,
            });
            assert.ok(review);
            assert.equal(acceptAttributionReview(review.id)?.status, 'accepted');
            const entry = metadata.dialogue_colors_overrides['0'];
            assert.equal(entry.segments['0'], 'Alice');
            assert.equal(entry.sources['0'], ATTRIBUTION_SOURCE.REVIEW);
            assert.equal(entry.segments['1'], 'Bob');
            assert.equal(entry.sources['1'], ATTRIBUTION_SOURCE.FROZEN);
        });
    });
});

test('message deletion reconciliation follows stable message identity', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const messages = [
            { id: 'a', name: 'Bob', mes: '"A"' },
            { id: 'b', name: 'Bob', mes: '"B"' },
            { id: 'c', name: 'Bob', mes: '"C"' },
        ];
        withChat(messages, metadata => {
            messages.forEach((message, index) => setMessageQuoteOverride(index, message, 0, 'Alice'));
            stApi.setTestContext({ chat: [messages[0], messages[2]], chatMetadata: metadata });
            assert.equal(reconcileMessageQuoteOverridesAfterDeletion(), true);
            assert.deepEqual(Object.keys(metadata.dialogue_colors_overrides), ['0', '1']);
            assert.equal(metadata.dialogue_colors_overrides['0'].messageId, 'a');
            assert.equal(metadata.dialogue_colors_overrides['1'].messageId, 'c');
        });
    });
});

test('message deletion uniquely reconciles a legacy hash-only override', () => {
    withCharacters(['Alice', 'Bob'], () => {
        const messages = [
            { id: 'a', name: 'Bob', mes: '"A"' },
            { id: 'b', name: 'Bob', mes: '"B"' },
        ];
        withChat(messages, metadata => {
            assert.equal(setMessageQuoteOverride(1, messages[1], 0, 'Alice'), true);
            const legacy = metadata.dialogue_colors_overrides['1'];
            delete legacy.messageId;
            delete legacy.messageFingerprint;
            delete legacy.textLength;

            stApi.setTestContext({ chat: [messages[1]], chatMetadata: metadata });
            assert.equal(reconcileMessageQuoteOverridesAfterDeletion(), true);
            assert.equal(metadata.dialogue_colors_overrides['0'], legacy);
            assert.equal(metadata.dialogue_colors_overrides['0'].segments['0'], 'Alice');
        });
    });
});

test('fallback rendering escapes markup when host formatting is unavailable or fails', () => {
    const originalDocument = globalThis.document;
    const payload = '<img src=x onerror="globalThis.pwned=true">';
    const message = { id: 'm-1', name: 'Bob', mes: payload };
    const mesText = {
        innerHTML: '',
        querySelectorAll: () => [],
    };
    const mesElement = {
        isConnected: true,
        getAttribute: name => name === 'mesid' ? '0' : null,
        querySelector: selector => selector === '.mes_text' ? mesText : null,
    };
    const chatRoot = {};
    globalThis.document = {
        body: {},
        getElementById: id => id === 'chat' ? chatRoot : null,
        querySelector: selector => selector.includes('.mes[mesid="0"]') ? mesElement : null,
        querySelectorAll: () => [],
    };
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        for (const messageFormatting of [undefined, () => '', () => { throw new Error('formatter failed'); }]) {
            mesText.innerHTML = '';
            stApi.setTestContext({ chat: [message], chatMetadata: {}, messageFormatting });
            assert.equal(renderMessageDomFallback(0, message), true);
            assert.doesNotMatch(mesText.innerHTML, /<img\b/i);
            assert.match(mesText.innerHTML, /&lt;img/);
        }
    } finally {
        console.warn = originalWarn;
        globalThis.document = originalDocument;
        stApi.setTestContext({ chat: [], chatMetadata: {} });
    }
});

test('observer work rejects detached elements and teardown clears settle work', () => {
    const detached = { isConnected: false };
    const pendingBefore = runtimeState.pendingObservedMessages.size;
    queueObservedMessageDecoration(detached);
    assert.equal(runtimeState.pendingObservedMessages.size, pendingBefore);

    let settleDisconnected = false;
    let chatDisconnected = false;
    const settleTimer = setTimeout(() => {}, 60000);
    const retryTimer = setTimeout(() => {}, 60000);
    runtimeState.messageSettleObservers.set({}, {
        observer: { disconnect() { settleDisconnected = true; } },
        fallbackTimer: settleTimer,
        retryTimers: [retryTimer],
    });
    runtimeState.pendingObservedMessages.add({ isConnected: false });
    runtimeState.chatObserver = { disconnect() { chatDisconnected = true; } };
    runtimeState.chatObserverTimer = setTimeout(() => {}, 60000);
    stopDomHealthCheck();
    assert.equal(settleDisconnected, true);
    assert.equal(chatDisconnected, true);
    assert.equal(runtimeState.messageSettleObservers.size, 0);
    assert.equal(runtimeState.pendingObservedMessages.size, 0);
    assert.equal(runtimeState.chatObserverTimer, null);
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
