import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only
// resolve inside a SillyTavern install. Stubbing that one module lets the real segmentation,
// local colorizer and LLM finalizer run under node --test.
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

const {
    attributeDialogueSegments,
    balanceStreamingText,
    colorizeMessageText,
    ensureCharacterEntry,
} = await import('../src/attribution.js');
const { fillUncoloredDialogueGaps, finalizeLLMColorizedText, repairHtmlBreakingColorSpans } = await import('../src/live-colors.js');
const { maskHtmlTagQuotes, splitsHtmlTag, findHtmlTagRanges } = await import('../src/utils.js');
const state = await import('../src/state.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };

function withCleanRegistry(run) {
    const previousColors = { ...state.characterColors };
    for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
    Object.assign(settings, DEFAULT_SETTINGS);
    try {
        return run();
    } finally {
        for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
        Object.assign(state.characterColors, previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
    }
}

function bobColor() {
    ensureCharacterEntry('Bob');
    return state.characterColors.bob.color;
}

test('the quotes of an HTML tag are masked exactly where the host masks them', () => {
    assert.equal(maskHtmlTagQuotes('<div class="row">"Hi."</div>'), '<div class=\uffferow\ufffe>"Hi."</div>');
    // Length preserving, or every segment offset taken from the masked text would drift.
    for (const text of ['<img src="a.png" alt="Bob">', 'plain "text"', '<b>bold</b>', '<div\n class="x">']) {
        assert.equal(maskHtmlTagQuotes(text).length, text.length, text);
    }
    // Only what sits between < and > is hidden; a tag with no quotes comes back untouched.
    assert.equal(maskHtmlTagQuotes('<br> "Hi."'), '<br> "Hi."');
});

test('an attribute value is not a dialogue segment', () => {
    withCleanRegistry(() => {
        bobColor();
        const segments = attributeDialogueSegments('<div class="stat-block">Bob said, "Hello."</div>', 'Bob', {
            autoAddMessageSpeaker: true,
        }).segments;
        assert.deepEqual(segments.map(segment => segment.text), ['"Hello."']);
    });
});

test('the local colorizer leaves the element intact and still colors the dialogue', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const input = '<div class="stat-block">Bob said, "Hello."</div>';
        const result = colorizeMessageText(input, 'Bob', { autoAddMessageSpeaker: true });

        assert.ok(result.updatedText.startsWith('<div class="stat-block">'), result.updatedText);
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hello."</font>`), result.updatedText);
        assert.ok(!/<div class=</.test(result.updatedText), 'no font tag may be spliced into the element');
    });
});

test('a message that is only markup is left byte-identical', () => {
    withCleanRegistry(() => {
        bobColor();
        const input = '<img src="portrait.png" alt="Bob">';
        const result = colorizeMessageText(input, 'Bob', { autoAddMessageSpeaker: true });
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('gap completion never fills inside a tag', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const input = '<font color="#ff4d6d">"Hi."</font> <div class="row">Bob said, "Hello."</div>';
        const result = fillUncoloredDialogueGaps(input, 'Bob', { autoAddMessageSpeaker: true });

        assert.equal(result.filledCount, 1);
        assert.ok(result.updatedText.includes('<div class="row">'), result.updatedText);
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hello."</font>`), result.updatedText);
    });
});

test('an LLM span spliced into a tag is dropped and the rest of the message kept', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const raw = '<img src="portrait.png"> "Hi."';
        const response = `<img src=<font color="${color}">"portrait.png"</font>> <font color="${color}">"Hi."</font>`;
        const result = finalizeLLMColorizedText(raw, response, null, { silent: true });

        assert.equal(result.colorized, true);
        assert.ok(result.updatedText.startsWith('<img src="portrait.png"> '), result.updatedText);
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hi."</font>`), result.updatedText);
    });
});

test('an LLM response whose only span is inside a tag counts as uncolorized', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const raw = '<img src="portrait.png"> Bob waves.';
        const response = `<img src=<font color="${color}">"portrait.png"</font>> Bob waves.`;
        const result = finalizeLLMColorizedText(raw, response, null, { silent: true });

        assert.equal(result.colorized, false);
        assert.equal(result.changed, false);
        assert.equal(result.updatedText, raw);
    });
});

test('a span that wraps a whole element is valid markup and survives', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const raw = '<b>"Hi."</b>';
        const response = `<font color="${color}"><b>"Hi."</b></font>`;
        const result = finalizeLLMColorizedText(raw, response, null, { silent: true });

        assert.equal(result.colorized, true);
        assert.ok(result.updatedText.startsWith(`<font color="${color}"><b>"Hi."</b></font>`), result.updatedText);
    });
});

test('splitsHtmlTag only rejects boundaries strictly inside a tag', () => {
    const text = '<div class="row">"Hi."</div>';
    const ranges = findHtmlTagRanges(text);
    assert.equal(splitsHtmlTag(text.indexOf('"row"'), text.indexOf('"row"') + 5, ranges), true);
    assert.equal(splitsHtmlTag(text.indexOf('"Hi."'), text.indexOf('"Hi."') + 5, ranges), false);
    assert.equal(splitsHtmlTag(0, text.length, ranges), false, 'wrapping the tags whole is fine');
});

test('HTML boundaries are quote-aware and require the same safe element context', () => {
    const quoted = '<div data-label="1 > 0">"Hi."</div>';
    const quotedRanges = findHtmlTagRanges(quoted);
    assert.equal(splitsHtmlTag(quoted.indexOf('"Hi."'), quoted.indexOf('"Hi."') + 5, quotedRanges), false);
    assert.equal(maskHtmlTagQuotes(quoted).length, quoted.length);

    const crossed = '<b>"starts</b> and ends"';
    assert.equal(splitsHtmlTag(crossed.indexOf('"'), crossed.lastIndexOf('"') + 1, findHtmlTagRanges(crossed)), true);

    const code = '<code>"literal"</code>';
    assert.equal(splitsHtmlTag(code.indexOf('"'), code.lastIndexOf('"') + 1, findHtmlTagRanges(code)), true);

    const angleThought = '<I should leave.>';
    assert.equal(splitsHtmlTag(0, angleThought.length, findHtmlTagRanges(angleThought)), true);
});

test('a message an older version broke is repaired without disturbing its real colors', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const damaged = `<div class=<font color="${color}">"stat-block"</font>>Bob said, `
            + `<font color="${color}">"Hello."</font></div>\n[COLORS:Bob=${color}]`;
        const chat = [{ name: 'Bob', mes: damaged }];

        assert.deepEqual(repairHtmlBreakingColorSpans(chat).repairedIndices, [0]);
        assert.equal(chat[0].mes,
            `<div class="stat-block">Bob said, <font color="${color}">"Hello."</font></div>\n[COLORS:Bob=${color}]`);
        // Idempotent: the repaired message is not damaged, so a later load leaves it alone.
        assert.deepEqual(repairHtmlBreakingColorSpans(chat).repairedIndices, []);
    });
});

// A styled card of the kind a card author or a model emits, reduced from a chat this bug was
// reported against. The small fixtures above cannot show what actually broke: several elements,
// each with a long style attribute full of colons, commas, hashes and parentheses.
const STYLED_CARD = [
    '<div style="width:320px;margin:20px auto;background:#1a1a1c;border-radius:24px;padding:16px 14px;'
        + 'font-size:14px;color:#e8e8ea;box-shadow:0 8px 30px rgba(0,0,0,0.6);border:1px solid #2a2a2e">',
    '<div style="text-align:center;color:#6a6a72;font-size:12px;letter-spacing:0.5px">Today</div>',
    '<div style="display:flex;flex-direction:column;gap:10px">',
    '<div style="background:#2c2c30;border-radius:18px;padding:9px 13px">Bob said, "Hello."</div>',
    '</div></div>',
].join('\n');

test('a styled card keeps every attribute and gets only its dialogue colored', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const result = colorizeMessageText(STYLED_CARD, 'Bob', { autoAddMessageSpeaker: true });

        for (const attribute of STYLED_CARD.match(/style="[^"]*"/g)) {
            assert.ok(result.updatedText.includes(attribute), `mangled ${attribute.slice(0, 40)}...`);
        }
        assert.equal(result.updatedText.match(/<font /g).length, 1);
        assert.ok(result.updatedText.includes(`<font color="${color}">"Hello."</font>`));
    });
});

test('a styled card damaged by an older version is repaired attribute by attribute', () => {
    withCleanRegistry(() => {
        const color = bobColor();
        const colorized = STYLED_CARD.replace('"Hello."', `<font color="${color}">"Hello."</font>`);
        // What the pre-5.9.4 colorizer produced: every attribute value wrapped as if it were speech.
        const damaged = colorized.replace(/style="([^"]*)"/g, `style=<font color="${color}">"$1"</font>`);
        const chat = [{ name: 'Bob', mes: damaged }];

        assert.deepEqual(repairHtmlBreakingColorSpans(chat).repairedIndices, [0]);
        assert.equal(chat[0].mes, colorized, 'the dialogue keeps its color; the attributes lose theirs');
    });
});

test('the repair declines markup this extension did not write', () => {
    const foreign = '<div class=<font size="3">"row"</font>>"Hi."</div>';
    const chat = [{ name: 'Bob', mes: foreign }, { name: 'Bob', mes: '<b>"Hi."</b>' }];
    assert.deepEqual(repairHtmlBreakingColorSpans(chat).repairedIndices, []);
    assert.equal(chat[0].mes, foreign);
});

test('attribute quotes do not tip the streaming parity count', () => {
    assert.equal(balanceStreamingText('<img src="x.png"> Bob waves'), '<img src="x.png"> Bob waves');
    assert.equal(balanceStreamingText('<img src="x.png"> "Hel'), '<img src="x.png"> "Hel"');
});
