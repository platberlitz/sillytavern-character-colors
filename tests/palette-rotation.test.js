import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Every src module reaches SillyTavern through st-api.js, which imports paths
// that only resolve inside a SillyTavern install. Stubbing that one module lets
// the real palette rotation code run under node --test.
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
let pageBackground = 'rgb(0, 0, 0)';
globalThis.document ??= { body: {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
globalThis.getComputedStyle ??= () => ({ backgroundColor: pageBackground });

const stApiUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(stApiStub)}`;
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './st-api.js') return { url: stApiUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const {
    applyThemeReadabilityAndBrightness,
    buildCharacterEntry,
    getEntryEffectiveColor,
    getNextColor,
    invalidateThemeCache,
    isAssignedColorConflict,
} = await import('../src/palettes.js');
const { characterColors, settings } = await import('../src/state.js');
hooks.deregister();

const DEFAULT_SETTINGS = { ...settings };

function withPalette({ themeMode = 'dark', brightness = 0, colorTheme = 'pastel' }, run) {
    const previousColors = { ...characterColors };
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    Object.assign(settings, DEFAULT_SETTINGS, { themeMode, brightness, colorTheme });
    invalidateThemeCache();
    try {
        return run();
    } finally {
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
        invalidateThemeCache();
    }
}

function addCharacters(count) {
    const entries = [];
    for (let i = 0; i < count; i++) {
        const built = buildCharacterEntry(`Character ${i}`);
        assert.ok(built.entry, `character ${i} should be created`);
        characterColors[built.key] = built.entry;
        entries.push(built.entry);
    }
    return entries;
}

const MATRIX = [
    { themeMode: 'dark', brightness: 0 },
    { themeMode: 'dark', brightness: 10 },
    { themeMode: 'dark', brightness: -10 },
    { themeMode: 'light', brightness: 0 },
    { themeMode: 'light', brightness: 10 },
    { themeMode: 'light', brightness: -10 },
];

for (const variant of MATRIX) {
    const label = `${variant.themeMode} theme, brightness ${variant.brightness}`;

    test(`the palette ladder advances as characters are added (${label})`, () => {
        withPalette(variant, () => {
            const seen = [];
            for (let i = 0; i < 8; i++) {
                const next = getNextColor();
                assert.ok(!seen.includes(next), `getNextColor repeated ${next} after ${seen.length} characters`);
                seen.push(next);
                const built = buildCharacterEntry(`Character ${i}`);
                characterColors[built.key] = built.entry;
            }
        });
    });

    test(`new characters receive distinct primary colors (${label})`, () => {
        withPalette(variant, () => {
            const effectiveColors = addCharacters(8).map(entry => getEntryEffectiveColor(entry));
            assert.equal(new Set(effectiveColors).size, effectiveColors.length, 'primary colors should all differ');
            for (let i = 0; i < effectiveColors.length; i++) {
                const others = effectiveColors.filter((_, index) => index !== i);
                assert.ok(
                    !isAssignedColorConflict(effectiveColors[i], others),
                    `${effectiveColors[i]} perceptually collides with another primary`
                );
            }
        });
    });

    // The reported symptom: gradient stops consume getNextColor raw, with no
    // uniqueness repair, so a stalled ladder gives every character the same partner.
    test(`default gradient partners stay distinct (${label})`, () => {
        withPalette(variant, () => {
            const partners = [];
            for (let i = 0; i < 8; i++) {
                const built = buildCharacterEntry(`Character ${i}`);
                characterColors[built.key] = built.entry;
                const partner = getNextColor();
                built.entry.gradient = {
                    type: 'linear',
                    angle: 90,
                    primaryPosition: 0,
                    stops: [{ baseColor: partner, color: applyThemeReadabilityAndBrightness(partner), position: 100 }],
                };
                partners.push(partner);
            }
            assert.equal(new Set(partners).size, partners.length, `gradient partners repeated: ${partners.join(', ')}`);
        });
    });
}

test('getNextColor avoids a color that exists only as a gradient stop', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        const reservedStop = getNextColor();
        const built = buildCharacterEntry('Holder');
        characterColors[built.key] = built.entry;
        built.entry.gradient = {
            type: 'linear',
            angle: 90,
            primaryPosition: 0,
            stops: [{
                baseColor: reservedStop,
                color: applyThemeReadabilityAndBrightness(reservedStop),
                position: 100,
            }],
        };

        const next = getNextColor();
        assert.notEqual(next, reservedStop);
        assert.ok(
            !isAssignedColorConflict(
                applyThemeReadabilityAndBrightness(next),
                [applyThemeReadabilityAndBrightness(reservedStop)]
            ),
            `${next} collides with the reserved gradient stop ${reservedStop}`
        );
    });
});

test('a custom palette rotates through its slots', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        settings.customPalettes = {
            testers: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
        };
        settings.colorTheme = 'custom:testers';
        invalidateThemeCache();

        const seen = [];
        for (let i = 0; i < 4; i++) {
            const next = getNextColor();
            assert.ok(!seen.includes(next), `custom palette repeated ${next}`);
            seen.push(next);
            const built = buildCharacterEntry(`Custom ${i}`);
            characterColors[built.key] = built.entry;
        }
    });
});
