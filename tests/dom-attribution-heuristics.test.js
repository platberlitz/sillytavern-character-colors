import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Same single-module stub as dom-attribution-overrides.test.js: everything in
// src reaches SillyTavern through st-api.js, so replacing it lets the real
// heuristics, confidence scoring and element matching run under node --test.
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

const { attributeDialogueSegments, scoreSpeakerCandidateConfidence } = await import('../src/attribution.js');
const {
    isApproximateSegmentTextMatch,
    matchSegmentsToElements,
    refreshDomDialogueCounts,
} = await import('../src/dom-engine.js');
const { ATTRIBUTION_SOURCE, getAttributionConfidenceBand } = await import('../src/attribution-store.js');
const { characterColors, settings } = await import('../src/state.js');
const { normalizeSegmentText } = await import('../src/utils.js');
hooks.deregister();

function withCharacters(names, run) {
    const previousColors = { ...characterColors };
    const previousEngine = settings.coloringEngine;
    const previousSymbols = settings.thoughtSymbols;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    for (const name of names) {
        characterColors[name.toLowerCase()] = { name, color: '#112233', aliases: [], dialogueCount: 0 };
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

// Quote segments only; emphasis segments map to <em> and are attributed the
// same way, so they add noise without adding coverage here.
function quotesOf(text, speaker) {
    return attributeDialogueSegments(text, speaker, { autoAddMessageSpeaker: false })
        .segments
        .filter(segment => segment.delimiter !== '*' && segment.delimiter !== '_');
}

function attribute(text, speaker) {
    return quotesOf(text, speaker).map(segment => ({
        speaker: segment.assignment?.name ?? null,
        source: segment.provenance.source,
        method: segment.provenance.method,
        confidence: segment.confidence,
        band: getAttributionConfidenceBand(segment.confidence),
        evidence: segment.evidence,
    }));
}

function fakeElements(texts) {
    return texts.map(textContent => ({ textContent }));
}

function matchPairs(segmentTexts, elementTexts, options) {
    const elements = fakeElements(elementTexts);
    const segments = segmentTexts.map((text, index) => ({ index, text, delimiter: '"' }));
    const pairs = [];
    matchSegmentsToElements(
        segments,
        elements,
        segment => normalizeSegmentText(segment.text),
        (segment, element) => pairs.push([segment.index, elements.indexOf(element)]),
        options,
    );
    return pairs;
}

test('an explicit speech tag reports the speaker with high confidence and its evidence', () => {
    withCharacters(['Dana', 'Alice'], () => {
        for (const text of [
            'Alice said, "Hello there friend."',
            '"Hello there friend," Alice said.',
            'Alice: "Hello there friend."',
        ]) {
            const [result] = attribute(text, 'Dana');
            assert.equal(result.speaker, 'Alice', `wrong speaker for ${JSON.stringify(text)}`);
            assert.equal(result.source, ATTRIBUTION_SOURCE.EXPLICIT_MENTION);
            assert.equal(result.method, 'context-proximity');
            assert.equal(result.band, 'high', `${JSON.stringify(text)} scored ${result.confidence}`);
            // The scoring inputs have to survive into the record, otherwise the
            // confidence number is unauditable.
            assert.equal(result.evidence[0].type, 'nearby-speaker-mention');
            assert.equal(result.evidence[0].speaker, 'Alice');
            assert.equal(typeof result.evidence[0].distance, 'number');
            assert.ok(result.evidence[0].strength >= 3);
        }
    });
});

test('possessive and addressee mentions never outrank the message speaker', () => {
    withCharacters(['Dana', 'Alice'], () => {
        for (const text of [
            'Alice\'s coat lay across the chair. "Hello there friend."',
            'Someone pushed the note over to Alice. "Hello there friend."',
        ]) {
            const [result] = attribute(text, 'Dana');
            assert.equal(result.speaker, 'Dana', `weak mention won for ${JSON.stringify(text)}`);
            assert.equal(result.source, ATTRIBUTION_SOURCE.MESSAGE_SPEAKER);
        }
    });
});

test('a subject mention without a speech tag is weaker than a tagged one', () => {
    withCharacters(['Dana', 'Alice'], () => {
        const [tagged] = attribute('Alice said, "Hello there friend."', 'Dana');
        const [subject] = attribute('Alice walked in slowly. "Hello there friend."', 'Dana');
        assert.equal(subject.speaker, 'Alice');
        assert.equal(subject.method, 'context-proximity');
        assert.ok(subject.confidence < tagged.confidence, `${subject.confidence} !< ${tagged.confidence}`);
    });
});

test('a pronoun speech tag binds to the nearest preceding name, below a literal tag', () => {
    // Long enough that the name is outside the proximity window's reach as a
    // direct tag, so only the pronoun path can resolve it.
    const filler = 'The room stayed quiet for a while and nothing at all happened in it. '.repeat(5);
    withCharacters(['Dana', 'Alice'], () => {
        const [tagged] = attribute('Alice said, "Hello there friend."', 'Dana');
        for (const text of [
            `Alice walked in slowly. ${filler}"Hello there friend," she said.`,
            `Alice walked in slowly. ${filler}She said, "Hello there friend."`,
        ]) {
            const [result] = attribute(text, 'Dana');
            assert.equal(result.speaker, 'Alice', `pronoun bind failed for ${JSON.stringify(text.slice(0, 40))}`);
            assert.equal(result.source, ATTRIBUTION_SOURCE.EXPLICIT_MENTION);
            assert.equal(result.method, 'pronoun-proximity');
            assert.ok(result.confidence < tagged.confidence, `${result.confidence} !< ${tagged.confidence}`);
            assert.equal(result.evidence[0].type, 'pronoun-speech-tag');
            assert.equal(result.evidence[0].detail, 'she');
            assert.equal(result.evidence[0].speaker, 'Alice');
        }
    });
});

test('a pronoun with no usable antecedent falls through instead of guessing', () => {
    withCharacters(['Dana', 'Alice'], () => {
        // No name at all in the paragraph.
        const [bare] = attribute('"Hello there friend," she said.', 'Dana');
        assert.equal(bare.speaker, 'Dana');
        assert.equal(bare.source, ATTRIBUTION_SOURCE.MESSAGE_SPEAKER);

        // The only name is possessive, which the binder refuses as an antecedent.
        const [possessive] = attribute('Alice\'s hand trembled. "I cannot do it," she said.', 'Dana');
        assert.equal(possessive.speaker, 'Dana');
        assert.equal(possessive.source, ATTRIBUTION_SOURCE.MESSAGE_SPEAKER);
    });
});

test('alternation stays a two-speaker ping-pong and reports scene crowding as doubt', () => {
    withCharacters(['Alice', 'Carol'], () => {
        const twoSpeakers = attribute('Alice said, "A one"\nCarol said, "B two"\n"C three"\n"D four"', 'Alice');
        assert.deepEqual(twoSpeakers.map(entry => entry.speaker), ['Alice', 'Carol', 'Alice', 'Carol']);
        assert.equal(twoSpeakers[2].source, ATTRIBUTION_SOURCE.ALTERNATION);
        assert.equal(twoSpeakers[2].confidence, 0.45);
        assert.equal(twoSpeakers[2].band, 'low');
    });

    withCharacters(['Dana', 'Alice', 'Carol'], () => {
        // Three distinct speakers in the ring: alternation is a coin flip, and
        // the confidence has to say so.
        const crowded = attribute('Alice said, "A one"\nCarol said, "B two"\n"C three"\n"D four"', 'Dana');
        assert.equal(crowded[2].source, ATTRIBUTION_SOURCE.ALTERNATION);
        assert.ok(crowded[2].confidence < 0.45, `${crowded[2].confidence} !< 0.45`);
        assert.equal(crowded[2].band, 'low');
        assert.ok(crowded[2].evidence[0].strength >= 3);
    });
});

test('carried and alternated speakers never read as more certain than their source', () => {
    withCharacters(['Dana', 'Alice'], () => {
        const carried = attribute('Alice paced the length of the room. "A one" then "B two"', 'Dana');
        assert.equal(carried[1].speaker, 'Alice');
        assert.ok(
            carried[1].confidence <= carried[0].confidence,
            `carry ${carried[1].confidence} > source ${carried[0].confidence}`,
        );

        // A contested default (another known character named in the narration)
        // is a guess, so it must not present as a plain default.
        const [contested] = attribute('Alice was elsewhere entirely.\n"A one"', 'Dana');
        const [uncontested] = attribute('"A one"', 'Dana');
        assert.equal(contested.speaker, 'Dana');
        assert.equal(uncontested.speaker, 'Dana');
        assert.ok(contested.confidence < uncontested.confidence, `${contested.confidence} !< ${uncontested.confidence}`);
        assert.equal(contested.band, 'low');
    });
});

test('confidence bands split at the values the UI and CSS rely on', () => {
    assert.equal(getAttributionConfidenceBand(1), 'high');
    assert.equal(getAttributionConfidenceBand(0.75), 'high');
    assert.equal(getAttributionConfidenceBand(0.749), 'medium');
    assert.equal(getAttributionConfidenceBand(0.5), 'medium');
    assert.equal(getAttributionConfidenceBand(0.499), 'low');
    assert.equal(getAttributionConfidenceBand(0), 'low');
    assert.equal(getAttributionConfidenceBand(undefined), 'low');
});

test('candidate scoring ranks strength above distance but lets distance break ties', () => {
    const near = scoreSpeakerCandidateConfidence({ strength: 4, distance: 1 });
    const far = scoreSpeakerCandidateConfidence({ strength: 4, distance: 200 });
    const weakerNear = scoreSpeakerCandidateConfidence({ strength: 2, distance: 1 });
    assert.ok(near > far, `${near} !> ${far}`);
    assert.ok(far > weakerNear, `${far} !> ${weakerNear}`);
    assert.ok(scoreSpeakerCandidateConfidence({ strength: 1, distance: 5000 }) >= 0.35);
    assert.ok(scoreSpeakerCandidateConfidence({ strength: 4, distance: 0 }) <= 0.95);
});

test('an empty quote consumes its element instead of shifting every later segment', () => {
    // '*_*' normalizes to an empty target. Skipping it without consuming used to
    // hand element 0 to the next segment and desync the whole message.
    assert.deepEqual(matchPairs(['*_*', '"B"'], ['_', '"B"']), [[0, 0], [1, 1]]);
});

test('anchored fallback fills a rewritten quote only when asked', () => {
    const segments = ['"A one"', '"B two here"', '"C three"'];
    const rendered = ['"A one"', '"B two here" &amp; more', '"C three"'];
    assert.deepEqual(matchPairs(segments, rendered), [[0, 0], [2, 2]]);
    assert.deepEqual(
        matchPairs(segments, rendered, { allowAnchoredFallback: true }),
        [[0, 0], [2, 2], [1, 1]],
    );
});

test('anchored fallback claims a lone unmatched element between two anchors', () => {
    assert.deepEqual(
        matchPairs(['"A one"', '"B two"', '"C three"'], ['"A one"', 'wholly rewritten', '"C three"'], { allowAnchoredFallback: true }),
        [[0, 0], [2, 2], [1, 1]],
    );
});

test('anchored fallback never invents an element or double-books one', () => {
    // Nothing left to claim.
    assert.deepEqual(matchPairs(['"A one"', '"B two"'], ['"A one"'], { allowAnchoredFallback: true }), [[0, 0]]);
    // Duplicate texts still map one-to-one.
    assert.deepEqual(
        matchPairs(['"A"', '"A"', '"B"'], ['"A"', '"A"', '"B"'], { allowAnchoredFallback: true }),
        [[0, 0], [1, 1], [2, 2]],
    );
    // Two unmatched segments competing for one gap: neither may guess.
    const ambiguous = matchPairs(
        ['"A one"', '"B two"', '"C three"', '"D four"'],
        ['"A one"', 'rewritten', '"D four"'],
        { allowAnchoredFallback: true },
    );
    assert.equal(new Set(ambiguous.map(pair => pair[1])).size, ambiguous.length);
});

test('approximate matching requires containment and a length floor', () => {
    assert.equal(isApproximateSegmentTextMatch('"B two here"', '"B two here" & more'), true);
    assert.equal(isApproximateSegmentTextMatch('"abc"', '"abc" plus a whole lot more text here'), false);
    assert.equal(isApproximateSegmentTextMatch('"a one"', '"b two"'), false);
    assert.equal(isApproximateSegmentTextMatch('', '"a one"'), false);
});

test('DOM statistics count font-tagged messages from their saved tags', () => {
    withCharacters(['Alice', 'Bob'], () => {
        characterColors.alice.color = '#ff0000';
        characterColors.bob.color = '#00ff00';
        const chat = [
            {
                id: 'm1',
                name: 'Bob',
                mes: '<font color="#ff0000">"Hi there"</font> and <font color="#ff0000">"again"</font>\n<font color="#00ff00">"Bob speaks"</font>',
            },
            { id: 'm2', name: 'Bob', mes: '"plain one"' },
        ];
        const result = refreshDomDialogueCounts(chat);
        assert.equal(result.changed, true);
        // Two Alice tags in the font-tagged message, one Bob tag there plus one
        // decorated quote in the plain message.
        assert.equal(characterColors.alice.dialogueCount, 2);
        assert.equal(characterColors.bob.dialogueCount, 2);
    });
});
