import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only
// resolve inside a SillyTavern install. Stubbing that one module lets the real span
// re-scoper run under node --test.
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
    finalizeLLMColorizedText,
    repairOverreachingColorSpans,
    replaceCanonicalFontSpanColor,
    trimOverreachingColorSpans,
} = await import('../src/live-colors.js');
const { getNarratorVisual } = await import('../src/narrator-style.js');
const { applyThemeReadabilityAndBrightness } = await import('../src/palettes.js');
const state = await import('../src/state.js');
hooks.deregister();

const settings = state.settings;
const DEFAULT_SETTINGS = { ...settings };
const BOB = '#ff4d6d';
const ANA = '#4dd0ff';

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

// The projection: the message text with every font tag removed. Re-scoping is only ever
// allowed to move tags, so this string has to come out of the trim byte-identical.
function projectionOf(text) {
    return String(text).replace(/<font color="#[0-9a-fA-F]{6}">|<\/font>/g, '');
}

function assertTextPreserved(input, output) {
    assert.equal(projectionOf(output), projectionOf(input), 'the trim must move tags and nothing else');
}

test('a span closed at the end of the sentence is pulled back to the closing quote', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">"Text", he says, blah blah</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, true);
        assert.equal(result.updatedText, `<font color="${BOB}">"Text"</font>, he says, blah blah`);
        assertTextPreserved(input, result.updatedText);
    });
});

test('a span swallowing narration between two quotes splits into two spans of the same color', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">"Wait." He turned. "Please."</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, true);
        assert.equal(
            result.updatedText,
            `<font color="${BOB}">"Wait."</font> He turned. <font color="${BOB}">"Please."</font>`,
        );
        assertTextPreserved(input, result.updatedText);
    });
});

test('an inner-thought span that already ends at its delimiter is untouched', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">"Hello."</font> he said. <font color="${ANA}">*I should run.*</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('a thought span running past its closing delimiter is pulled back', () => {
    withCleanRegistry(() => {
        const input = `<font color="${ANA}">*I should run.* She did not move.</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, true);
        assert.equal(result.updatedText, `<font color="${ANA}">*I should run.*</font> She did not move.`);
        assertTextPreserved(input, result.updatedText);
    });
});

test('a span that opens on narration is left alone rather than guessed at', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">He only ever said "no" to her.</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, false, 'the span was never scoped to the quote, so there is nothing to pull back');
        assert.equal(result.updatedText, input);
    });
});

test('a narrator-colored span keeps the quoted words it was meant to cover', () => {
    withCleanRegistry(() => {
        settings.narratorStyle = { enabled: true, baseColor: '#888888', gradient: null, gradientGenerator: null };
        const narratorColor = getNarratorVisual(settings, applyThemeReadabilityAndBrightness).color;
        const input = `<font color="${narratorColor}">"Later" was all the note said, and nothing else.</font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(result.changed, false);
        assert.equal(result.updatedText, input);
    });
});

test('a span wrapping a whole element survives, and attribute quotes never become a boundary', () => {
    withCleanRegistry(() => {
        const wrapping = `<font color="${BOB}"><b>"Hi."</b></font>`;
        assert.equal(trimOverreachingColorSpans(wrapping, { silent: true }).changed, false);

        const input = `<font color="${BOB}">"Hi." <b class="loud">he shouted</b></font>`;
        const result = trimOverreachingColorSpans(input, { silent: true });
        assert.equal(result.changed, true);
        assert.equal(result.updatedText, `<font color="${BOB}">"Hi."</font> <b class="loud">he shouted</b>`);
        assert.ok(result.updatedText.includes('<b class="loud">'), 'the attribute must survive verbatim');
        assert.ok(!/class=<font/.test(result.updatedText), 'an attribute value is markup, not dialogue');
        assertTextPreserved(input, result.updatedText);
    });
});

test('trailing whitespace inside a span is not worth rewriting the message for', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">"Hi." </font>and then silence.`;
        const result = trimOverreachingColorSpans(input, { silent: true });
        assert.equal(result.changed, false);
    });
});

test('non-canonical markup is declined, never guessed at', () => {
    withCleanRegistry(() => {
        for (const input of [
            `<font color='${BOB}'>"Hi.", he said.</font>`,
            `<font color="${BOB}">"Hi.", he said.`,
            '"Hi.", he said.',
        ]) {
            const result = trimOverreachingColorSpans(input, { silent: true });
            assert.equal(result.changed, false, `must decline: ${input}`);
            assert.equal(result.updatedText, input);
        }
    });
});

test('the trim is idempotent and keeps exactly one metadata block', () => {
    withCleanRegistry(() => {
        const input = `<font color="${BOB}">"Text", he says.</font>\n[COLORS:Bob=${BOB}]`;
        const once = trimOverreachingColorSpans(input, { silent: true });

        assert.equal(once.changed, true);
        assert.equal(once.updatedText, `<font color="${BOB}">"Text"</font>, he says.\n[COLORS:Bob=${BOB}]`);
        assert.equal(once.updatedText.match(/\[COLORS/g).length, 1);

        const twice = trimOverreachingColorSpans(once.updatedText, { silent: true });
        assert.equal(twice.changed, false);
        assert.equal(twice.updatedText, once.updatedText);
    });
});

test('the chat sweep repairs damaged messages and skips everything else', () => {
    withCleanRegistry(() => {
        const chat = [
            { name: 'Bob', mes: `<font color="${BOB}">"Text", he says.</font>` },
            { name: 'Ana', mes: `<font color="${ANA}">"Fine."</font> She left.` },
            { name: 'Bob', mes: 'No colors here at all.' },
            { name: 'Tool', extra: { tool_invocations: [] }, mes: `<font color="${BOB}">"Text", he says.</font>` },
        ];
        const report = repairOverreachingColorSpans(chat);

        assert.deepEqual(report.repairedIndices, [0]);
        assert.equal(chat[0].mes, `<font color="${BOB}">"Text"</font>, he says.`);
        assert.equal(chat[1].mes, `<font color="${ANA}">"Fine."</font> She left.`);
        assert.equal(chat[3].mes, `<font color="${BOB}">"Text", he says.</font>`, 'tool-call messages are not ours');

        assert.deepEqual(repairOverreachingColorSpans(chat).repairedIndices, [], 'idempotent');
    });
});

test('the LLM colorize path trims, and a manual recolor does not', () => {
    withCleanRegistry(() => {
        const raw = '"Text", he says, blah blah';
        const response = `<font color="${BOB}">"Text", he says, blah blah</font>`;

        const trimmed = finalizeLLMColorizedText(raw, response, null, { silent: true, trimOverreach: true });
        assert.equal(trimmed.colorized, true);
        assert.ok(trimmed.updatedText.startsWith(`<font color="${BOB}">"Text"</font>, he says, blah blah`));

        const untrimmed = finalizeLLMColorizedText(raw, response, null, { silent: true });
        assert.ok(untrimmed.updatedText.startsWith(response), 'no re-scoping without the opt-in');

        // A manual recolor addresses one span by ordinal; re-scoping under it would move a
        // boundary the user drew and renumber the list the next click depends on.
        const recolored = replaceCanonicalFontSpanColor(response, 0, BOB, '"Text", he says, blah blah', ANA, { silent: true });
        assert.ok(recolored?.updatedText.startsWith(`<font color="${ANA}">"Text", he says, blah blah</font>`));
    });
});
