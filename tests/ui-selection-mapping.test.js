import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const stubSources = new Map([
    ['./attribution.js', 'export const attributeDialogueSegments = () => ({ segments: [] });'],
    ['./color-blocks.js', 'export const resolveCharacterKeyByNameOrAlias = () => "";'],
    ['./dom-engine.js', `
        export const cancelMessageDomFollowupRepairs = () => {};
        export const clearMessageDomRepairTimer = () => {};
        export const clearStreamingAttributionOverrides = () => {};
        export const decorateMessageDomFromCurrentRender = async () => false;
        export const deleteMessageQuoteOverride = () => false;
        export const getMessageIndexFromElement = () => -1;
        export const getMessageQuoteOverrideEntry = () => null;
        export const getMessageQuoteOverrideOptions = () => ({});
        export const isStreamingOwnedMessage = () => false;
        export const matchSegmentsToElements = () => {};
        export const refreshAndDecorateMessageDom = async () => false;
        export const refreshMessageDom = () => {};
        export const resolveDomSegmentIndexForElement = () => null;
        export const restoreMessageQuoteOverrideEntry = () => {};
        export const scheduleMessageDomFollowupRepair = () => {};
        export const setMessageQuoteOverride = () => false;
    `],
    ['./fonts.js', 'export const scheduleCustomFontRefresh = () => {};'],
    ['./live-colors.js', `
        export const applyLiveColorChangesFromSnapshot = () => {};
        export const captureEffectiveColorSnapshot = () => null;
        export const commit = () => {};
        export const flushChatSave = () => {};
        export const parseCanonicalFontMarkup = () => null;
        export const queueChatSave = () => {};
        export const replaceCanonicalFontSpanColor = () => null;
    `],
    ['./palettes.js', `
        export const buildCharacterEntry = () => ({ entry: null });
        export const getEntryEffectiveColor = () => "#888888";
        export const setEntryFromEffectiveColor = () => {};
    `],
    ['./st-api.js', `
        export const escapeHtml = value => String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
        export const eventSource = { on() {} };
        export const event_types = {};
        export const getContext = () => ({ chat: [] });
        export const power_user = { quote_text_color: "#888888" };
    `],
    ['./state.js', `
        export const characterColors = Object.create(null);
        export const isDomEngine = () => false;
        export const runtimeState = {};
        export const settings = {};
    `],
    ['./streaming-paint.js', 'export const paintStreamingMessage = () => false;'],
    ['./ui.js', `
        export const getSortedEntries = () => [];
        export const updateLegend = () => {};
    `],
    ['./utils.js', `
        export const escapeAttr = value => String(value);
        export const hashMessageText = value => String(value);
        export const isToolCallMessage = () => false;
        export const normalizeHexColor = (value, fallback = null) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
        export const normalizeSegmentText = value => String(value || "");
        export const toast = { error() {}, info() {}, success() {}, warning() {} };
    `],
]);

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL?.includes('/src/context-menu.js') && stubSources.has(specifier)) {
            return {
                url: `data:text/javascript;charset=utf-8,${encodeURIComponent(stubSources.get(specifier))}`,
                shortCircuit: true,
            };
        }
        return nextResolve(specifier, context);
    },
});

const {
    mapRenderedSelectionToSourceSpan,
    replaceMessageSelectionWithFontTag,
} = await import(new URL('../src/context-menu.js?ui-selection-mapping-test', import.meta.url));
hooks.deregister();

test('maps the final overlapping rendered occurrence to the final source span', () => {
    assert.deepEqual(mapRenderedSelectionToSourceSpan('aaa', 'aaa', 'aa', 1), { start: 1, end: 3 });
});

test('counts unsafe visible occurrences before a later safe occurrence', () => {
    const codeSource = '`aa` aa';
    assert.equal(mapRenderedSelectionToSourceSpan(codeSource, 'aa aa', 'aa', 0), null);
    assert.deepEqual(
        mapRenderedSelectionToSourceSpan(codeSource, 'aa aa', 'aa', 3),
        { start: codeSource.lastIndexOf('aa'), end: codeSource.length },
    );

    const escapedSource = '\\_ _';
    assert.equal(mapRenderedSelectionToSourceSpan(escapedSource, '_ _', '_', 0), null);
    assert.deepEqual(
        mapRenderedSelectionToSourceSpan(escapedSource, '_ _', '_', 2),
        { start: escapedSource.lastIndexOf('_'), end: escapedSource.length },
    );
});

test('does not count hidden HTML or Markdown destinations as rendered occurrences', () => {
    const destinationSource = '[label](aa) aa';
    const destinationStart = destinationSource.lastIndexOf('aa');
    assert.deepEqual(
        mapRenderedSelectionToSourceSpan(destinationSource, 'label aa', 'aa', 6),
        { start: destinationStart, end: destinationStart + 2 },
    );

    const htmlSource = '<span data-value="aa">label</span> aa';
    const htmlStart = htmlSource.lastIndexOf('aa');
    assert.deepEqual(
        mapRenderedSelectionToSourceSpan(htmlSource, 'label aa', 'aa', 6),
        { start: htmlStart, end: htmlStart + 2 },
    );
});

test('counts decoded entities but fails closed when the selected occurrence is encoded', () => {
    const source = '&amp; &';
    assert.equal(mapRenderedSelectionToSourceSpan(source, '& &', '&', 0), null);
    assert.deepEqual(mapRenderedSelectionToSourceSpan(source, '& &', '&', 2), { start: 6, end: 7 });
});

test('fails closed when the local projection cannot decode or model rendered syntax', () => {
    assert.equal(mapRenderedSelectionToSourceSpan('&copy; ©', '© ©', '©', 0), null);
    assert.equal(mapRenderedSelectionToSourceSpan('&copy; ©', '© ©', '©', 2), null);
    assert.equal(mapRenderedSelectionToSourceSpan('![alt](image.png) alt', 'alt alt', 'alt', 4), null);
    assert.equal(mapRenderedSelectionToSourceSpan('<https://example.test> example.test', 'https://example.test example.test', 'example.test', 21), null);
    assert.equal(mapRenderedSelectionToSourceSpan('<alice@example.test> alice', 'alice@example.test alice', 'alice', 19), null);
    assert.equal(mapRenderedSelectionToSourceSpan('<irc:room> room', 'irc:room room', 'room', 9), null);
    assert.equal(mapRenderedSelectionToSourceSpan('&#0; A', '� A', 'A', 2), null);
});

test('keeps UTF-16 source offsets aligned after an astral numeric entity', () => {
    const source = '&#x1F600;AA';
    const firstA = source.indexOf('A');
    assert.deepEqual(mapRenderedSelectionToSourceSpan(source, '😀AA', 'A', 2), {
        start: firstA,
        end: firstA + 1,
    });
    assert.deepEqual(mapRenderedSelectionToSourceSpan(source, '😀AA', 'A', 3), {
        start: firstA + 1,
        end: firstA + 2,
    });
    assert.equal(mapRenderedSelectionToSourceSpan(source, '😀AA', '😀', 0), null);
});

test('excludes nested Markdown destinations from source occurrence mapping', () => {
    const source = '[outer [inner]](aa) aa';
    const start = source.lastIndexOf('aa');
    assert.deepEqual(
        mapRenderedSelectionToSourceSpan(source, 'outer inner aa', 'aa', 12),
        { start, end: start + 2 },
    );
});

test('preserves duplicate, multiline, underscore, bracket, and plain-text mapping', () => {
    const cases = [
        ['aa aa', 'aa'],
        ['first line\nsecond line\nsecond line', 'second line'],
        ['name_under name_under', 'name_under'],
        ['[plain] [plain]', '[plain]'],
        ['ordinary text ordinary text', 'ordinary text'],
    ];
    for (const [source, selection] of cases) {
        const start = source.lastIndexOf(selection);
        assert.deepEqual(
            mapRenderedSelectionToSourceSpan(source, source, selection, start),
            { start, end: start + selection.length },
        );
    }
});

test('escapes exact source text before inserting font markup', () => {
    const selectedText = '5 < 6 & 7';
    const msg = { mes: selectedText };

    assert.equal(replaceMessageSelectionWithFontTag(msg, selectedText, '#12ABef', {
        sourceStart: 0,
        sourceEnd: selectedText.length,
    }), true);
    assert.equal(msg.mes, '<font color="#12abef">5 &lt; 6 &amp; 7</font>');

    const unsafe = { mes: '`aa` aa' };
    assert.equal(replaceMessageSelectionWithFontTag(unsafe, 'aa', '#123456', {
        sourceStart: 1,
        sourceEnd: 3,
    }), false);
    assert.equal(unsafe.mes, '`aa` aa');
});
