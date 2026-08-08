import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths that only
// resolve inside a SillyTavern install. Stubbing that one module lets the real palette
// code run under node --test.
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
export const extension_prompt_types = {};
export const extension_prompt_roles = {};
export const generateQuietPrompt = async () => '';
export const registerMacro = () => {};
export const getRequestHeaders = () => ({});
export const saveMetadata = () => {};
export const saveMetadataDebounced = () => {};
`;

globalThis.document ??= {
    body: { classList: { contains: () => false } },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
};
globalThis.getComputedStyle ??= () => ({ backgroundColor: 'rgb(0, 0, 0)' });
globalThis.window ??= { innerWidth: 1024, innerHeight: 768, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.requestAnimationFrame ??= () => 0;

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const stApi = await import(stApiUrl);
const { getEntryEffectiveColor, setEntryFromEffectiveColor, syncAllEffectiveColors } = await import('../src/palettes.js');
const { replaceCanonicalFontSpanColor, updateTextColorReferences } = await import('../src/live-colors.js');
const { captureCanonicalFontAssignmentTarget, isCanonicalFontAssignmentTargetCurrent } = await import('../src/context-menu.js');
const state = await import('../src/state.js');
hooks.deregister();

const contextMenu = await readFile(new URL('../src/context-menu.js', import.meta.url), 'utf8');

function gradientEntry(name) {
    return {
        name,
        color: '#00e600',
        baseColor: '#00e600',
        gradient: {
            type: 'linear',
            angle: 90,
            x: 50,
            y: 50,
            primaryPosition: 0,
            stops: [{ baseColor: '#3366ff', color: '#3366ff', position: 100 }],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    };
}

function withRegistry(entry, run) {
    const previousColors = { ...state.characterColors };
    const previousThemeMode = state.settings.themeMode;
    for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
    // A forced mode pins both the lightness band and the readability target, so the
    // arithmetic under test does not depend on a detected page background.
    state.settings.themeMode = 'dark';
    state.characterColors.ivy = entry;
    try {
        return run();
    } finally {
        for (const key of Object.keys(state.characterColors)) delete state.characterColors[key];
        Object.assign(state.characterColors, previousColors);
        state.settings.themeMode = previousThemeMode;
    }
}

// Chat text is decorated by color: a font tag carrying a color no entry holds resolves to no
// character and loses that character's gradient, font and text style. Every saveData() runs
// syncAllEffectiveColors(), which regenerates color from baseColor, and deriving a base color
// is lossy - so a manually picked color stored verbatim moved out from under the text that the
// same click had just written it into.
test('a manually assigned color survives the save that follows it', () => {
    const entry = gradientEntry('Ivy');
    withRegistry(entry, () => {
        // #00a300 sits below the dark theme's lightness floor, so it is one of the picks the
        // base-color round trip does not reproduce.
        const applied = setEntryFromEffectiveColor(entry, '#00a300');
        syncAllEffectiveColors();
        assert.equal(entry.color, applied);
        assert.equal(getEntryEffectiveColor(entry), applied);
    });
});

test('manual assignment colors message text with the stored color, not the picked color', () => {
    // context-menu.js needs a live DOM, so this half stays a source contract, in the style of
    // tests/source-contracts.test.js.
    for (const name of ['showMenu', 'showSelectionMenu']) {
        const declaration = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
        const match = declaration.exec(contextMenu);
        assert.ok(match, `missing named function ${name}`);
        const remainder = contextMenu.slice(match.index + match[0].length);
        const next = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(remainder);
        const section = contextMenu.slice(match.index, next ? match.index + match[0].length + next.index : contextMenu.length);
        const readBacks = section.match(/finalColor = getEntryEffectiveColor\(nextEntry\)/g) || [];
        assert.equal(readBacks.length, 2, `${name} must read the final color back for both an existing and a new entry`);
    }
});

test('right-click replacement mutates only the clicked canonical span and rebuilds metadata', () => {
    const destination = gradientEntry('Ivy');
    withRegistry(destination, () => {
        state.characterColors.old = { name: 'Old', color: '#ff4d6d', baseColor: '#ff4d6d', aliases: [] };
        const pendingDestination = structuredClone(destination);
        const destinationColor = setEntryFromEffectiveColor(pendingDestination, '#00a300');
        const input = '<font color="#ff4d6d">"One"</font><font color="#ff4d6d">"Two"</font>\n[COLORS:Old=#ff4d6d]';

        const result = replaceCanonicalFontSpanColor(input, 0, '#ff4d6d', '"One"', destinationColor, {
            pendingEntries: [{ key: 'ivy', entry: pendingDestination }],
        });

        assert.ok(result?.changed);
        assert.equal(
            result.updatedText,
            `<font color="${destinationColor}">"One"</font><font color="#ff4d6d">"Two"</font>\n`
                + `[COLORS:Ivy=${destinationColor},Old=#ff4d6d]`,
        );
        assert.ok(pendingDestination.gradient, 'the existing gradient destination remains intact');
    });
});

test('right-click replacement preserves untouched color metadata when an existing color moves', () => {
    const destination = gradientEntry('Ivy');
    withRegistry(destination, () => {
        const oldColor = getEntryEffectiveColor(destination);
        const pendingDestination = structuredClone(destination);
        const destinationColor = setEntryFromEffectiveColor(pendingDestination, '#3366ff');
        assert.notEqual(destinationColor, oldColor, 'fixture must move the existing effective color');
        const input = `<font color="${oldColor}">"One"</font><font color="${oldColor}">"Two"</font>\n`
            + `[COLORS:Ivy=${oldColor},<Unsafe>=${oldColor}]`;

        const result = replaceCanonicalFontSpanColor(input, 0, oldColor, '"One"', destinationColor, {
            pendingEntries: [{ key: 'ivy', entry: pendingDestination }],
        });

        assert.equal(
            result?.updatedText,
            `<font color="${destinationColor}">"One"</font><font color="${oldColor}">"Two"</font>\n`
                + `[COLORS:Ivy=${destinationColor},Ivy=${oldColor}]`,
        );
        assert.equal(
            updateTextColorReferences(result.updatedText, { [oldColor]: destinationColor }).updatedText,
            `<font color="${destinationColor}">"One"</font><font color="${destinationColor}">"Two"</font>\n`
                + `[COLORS:Ivy=${destinationColor}]`,
            'automatic recolor collapses the temporary old/new metadata pair',
        );
    });
});

test('right-click replacement rejects an ambiguous destination color', () => {
    const destination = gradientEntry('Ivy');
    withRegistry(destination, () => {
        const oldColor = getEntryEffectiveColor(destination);
        const pendingDestination = structuredClone(destination);
        const destinationColor = setEntryFromEffectiveColor(pendingDestination, '#3366ff');
        state.characterColors.other = {
            name: 'Other',
            color: destinationColor,
            baseColor: pendingDestination.baseColor,
            aliases: [],
        };
        const input = `<font color="${oldColor}">"One"</font>\n[COLORS:Ivy=${oldColor}]`;

        assert.equal(replaceCanonicalFontSpanColor(input, 0, oldColor, '"One"', destinationColor, {
            pendingEntries: [{ key: 'ivy', entry: pendingDestination }],
        }), null);
    });
});

test('font assignment targeting fails closed when any rendered span diverges from source', () => {
    const message = {
        mes: '`<font color="#ff4d6d">"Code"</font>` <font color="#ff4d6d">"Live"</font>',
    };
    const mesRoot = { getAttribute: name => name === 'mesid' ? '0' : null };
    let fonts = [];
    const mesText = { querySelectorAll: selector => selector === 'font[color]' ? fonts : [] };
    const makeFont = (text, color = '#ff4d6d') => ({
        isConnected: true,
        tagName: 'FONT',
        textContent: text,
        getAttribute: name => name === 'color' ? color : null,
        closest: selector => selector === '.mes' ? mesRoot : selector === '.mes_text' ? mesText : null,
    });
    const clicked = makeFont('"Live"');
    fonts = [clicked];
    stApi.setTestContext({ chat: [message], chatMetadata: {} });
    assert.equal(captureCanonicalFontAssignmentTarget(clicked), null, 'a hidden source font shifts the count');

    message.mes = '<font color="#ff4d6d">"Live"</font><font color="#ff4d6d">"Peer"</font>';
    fonts = [clicked, makeFont('"Different"')];
    assert.equal(captureCanonicalFontAssignmentTarget(clicked), null, 'a mismatched peer invalidates the whole mapping');
    fonts = [clicked, makeFont('"Peer"', '#4dffff')];
    assert.equal(captureCanonicalFontAssignmentTarget(clicked), null, 'a mismatched peer color invalidates the whole mapping');
    stApi.setTestContext({ chat: [], chatMetadata: {} });
});

test('captured font assignments reject replaced, swiped, and edited messages', () => {
    const message = {
        id: 'm1',
        send_date: 'date1',
        swipe_id: 0,
        mes: '<font color="#ff4d6d">"One"</font>',
    };
    const mesRoot = { getAttribute: name => name === 'mesid' ? '0' : null };
    let font;
    const mesText = { querySelectorAll: selector => selector === 'font[color]' ? [font] : [] };
    font = {
        isConnected: true,
        tagName: 'FONT',
        textContent: '"One"',
        getAttribute: name => name === 'color' ? '#ff4d6d' : null,
        closest: selector => selector === '.mes' ? mesRoot : selector === '.mes_text' ? mesText : null,
    };
    stApi.setTestContext({ chat: [message], chatMetadata: {} });
    const target = captureCanonicalFontAssignmentTarget(font);
    assert.ok(target);
    assert.equal(isCanonicalFontAssignmentTargetCurrent(target), true);

    message.is_user = true;
    assert.equal(captureCanonicalFontAssignmentTarget(font), null, 'user messages cannot become persistent right-click targets');
    assert.equal(isCanonicalFontAssignmentTargetCurrent(target), false, 'a target that becomes a user message is stale');
    message.is_user = false;

    stApi.setTestContext({ chat: [{ ...message }], chatMetadata: {} });
    assert.equal(isCanonicalFontAssignmentTargetCurrent(target), false, 'replacement object must be stale');
    stApi.setTestContext({ chat: [message], chatMetadata: {} });
    message.swipe_id = 1;
    assert.equal(isCanonicalFontAssignmentTargetCurrent(target), false, 'swiped source must be stale');
    message.swipe_id = 0;
    message.mes += ' edited';
    assert.equal(isCanonicalFontAssignmentTargetCurrent(target), false, 'edited source must be stale');
    stApi.setTestContext({ chat: [], chatMetadata: {} });
});

test('message re-renders chain the decoration re-apply after they settle', () => {
    // refreshMessageDom re-renders mes_text from msg.mes, wiping the extension's gradient
    // classes and CSS vars. It resolves only once the re-render has settled, so a
    // fire-and-forget call loses the race against the scheduled font refresh and the
    // clicked message renders bare until reload. Every call must chain the re-apply.
    const chained = contextMenu.match(/void refreshMessageDom\([^;]*\)\.then\(\(\) => scheduleCustomFontRefresh\(0\)\);/g) || [];
    assert.equal(chained.length, 3, 'all three persistent text mutation paths must refresh fonts after re-render');
    const bare = contextMenu.match(/^\s+refreshMessageDom\(/gm) || [];
    assert.equal(bare.length, 0, 'no fire-and-forget refreshMessageDom call may remain');
});

test('right-click overrides use the streaming painter for its owned message', () => {
    const helper = contextMenu.match(/function repaintDomAssignment[\s\S]*?\n}/)?.[0] || '';
    assert.match(helper, /isStreamingOwnedMessage\(messageIndex\).*paintStreamingMessage\(\)/);
    const calls = contextMenu.match(/await repaintDomAssignment\(/g) || [];
    assert.equal(calls.length, 2, 'manual assignment and automatic restoration must share the streaming-aware repaint');
});

test('one-span assignment never calls the broad visible-color replacement helper', () => {
    assert.doesNotMatch(contextMenu, /updateVisibleMessageColors/);
});

test('persistent assignment paths await chat save confirmation', () => {
    assert.equal((contextMenu.match(/const chatSaveConfirmation = flushChatSave\(\)/g) || []).length, 2);
    assert.equal((contextMenu.match(/await chatSaveConfirmation/g) || []).length, 2);
    assert.doesNotMatch(contextMenu, /^\s+flushChatSave\(\);/m);
});
