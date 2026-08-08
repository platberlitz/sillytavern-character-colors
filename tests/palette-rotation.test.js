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
    applyGradientPreset,
    buildCharacterEntry,
    collectReservedGradientColors,
    createRandomGradient,
    deriveBaseColorFromEffectiveColor,
    detectTheme,
    getContrastRatio,
    getContrastSurfaceColor,
    getTextContrastSurfaceColor,
    getEntryEffectiveColor,
    getNextColor,
    flipColorsForTheme,
    invalidateThemeCache,
    isAssignedColorConflict,
    syncAllEffectiveColors,
} = await import('../src/palettes.js');
const { characterColors, settings } = await import('../src/state.js');
const { BUILTIN_GRADIENT_PRESETS, colorDistanceOklab, getGradientColorStops, interpolateGradientColor } = await import('../src/gradients.js');
const { NARRATOR_VISUAL_ID, getNarratorVisual } = await import('../src/narrator-style.js');
const { sampleGradient } = await import('../src/perceptual-conflicts.js');
const { resolveVisual } = await import('../src/visual-resolver.js');
const { ASSIGNED_COLOR_MIN_DELTA_E, hexToHsl } = await import('../src/utils.js');
hooks.deregister();

const DEFAULT_SETTINGS = { ...settings };

function withPalette({ themeMode = 'dark', brightness = 0, colorTheme = 'pastel' }, run) {
    const previousColors = { ...characterColors };
    const previousBackground = pageBackground;
    for (const key of Object.keys(characterColors)) delete characterColors[key];
    // The contrast repair samples the page, so a light theme has to be tested against a light
    // page. Leaving it dark drags every color to the same end and hides real differences.
    pageBackground = themeMode === 'light' ? 'rgb(245, 245, 245)' : 'rgb(20, 22, 26)';
    Object.assign(settings, DEFAULT_SETTINGS, { themeMode, brightness, colorTheme });
    invalidateThemeCache();
    try {
        return run();
    } finally {
        for (const key of Object.keys(characterColors)) delete characterColors[key];
        Object.assign(characterColors, previousColors);
        Object.assign(settings, DEFAULT_SETTINGS);
        pageBackground = previousBackground;
        invalidateThemeCache();
    }
}

function minimumSeparation(colors) {
    let closest = Infinity;
    for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
            closest = Math.min(closest, colorDistanceOklab(colors[i], colors[j]));
        }
    }
    return closest;
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

// The reported symptom: with the brightness slider at its maximum every color was pushed onto
// the theme's lightness ceiling, where HSL chroma runs out, and a cast of thirteen arrived as
// thirteen near-white swatches nobody could tell apart.
const BRIGHTNESS_SWEEP = [-100, -75, -50, -25, 0, 25, 50, 75, 100];
const CAST_SIZE = 13;

for (const themeMode of ['dark', 'light']) {
    for (const brightness of BRIGHTNESS_SWEEP) {
        const label = `${themeMode} theme, brightness ${brightness}`;

        test(`a full cast stays perceptually apart (${label})`, () => {
            withPalette({ themeMode, brightness }, () => {
                const colors = addCharacters(CAST_SIZE).map(entry => getEntryEffectiveColor(entry));
                const closest = minimumSeparation(colors);
                assert.ok(
                    closest >= ASSIGNED_COLOR_MIN_DELTA_E,
                    `two of ${CAST_SIZE} characters are only Delta E ${closest.toFixed(2)} apart: ${colors.join(', ')}`
                );
            });
        });

        test(`stored base colors survive the brightness pass (${label})`, () => {
            withPalette({ themeMode, brightness }, () => {
                for (const entry of addCharacters(CAST_SIZE)) {
                    // Subtracting the offset straight back out used to bottom out at black,
                    // which throws away the hue and saturation along with the lightness.
                    assert.notEqual(entry.baseColor, '#000000', `${entry.name} lost its color to black`);
                    assert.notEqual(entry.baseColor, '#ffffff', `${entry.name} lost its color to white`);
                    const [, saturation] = hexToHsl(entry.baseColor);
                    const [, effectiveSaturation] = hexToHsl(entry.color);
                    if (effectiveSaturation > 0) {
                        assert.ok(saturation > 0, `${entry.name} kept a grey base color for ${entry.color}`);
                    }
                    // Both halves of the entry have to describe the same color, or the next
                    // synchronization silently repaints the character.
                    const rerendered = applyThemeReadabilityAndBrightness(entry.baseColor);
                    assert.ok(
                        colorDistanceOklab(rerendered, entry.color) <= 1,
                        `${entry.name} renders as ${rerendered} but stores ${entry.color}`
                    );
                }
            });
        });

        test(`characters stay apart after the slider is moved back (${label})`, () => {
            withPalette({ themeMode, brightness }, () => {
                const entries = addCharacters(CAST_SIZE);
                settings.brightness = 0;
                invalidateThemeCache();
                syncAllEffectiveColors();
                const colors = entries.map(entry => getEntryEffectiveColor(entry));
                assert.equal(new Set(colors).size, colors.length, `characters collapsed onto each other: ${colors.join(', ')}`);
            });
        });
    }
}

test('the brightness pass leaves colors untouched at zero', () => {
    // Everything below the slider is unchanged for the default setting, so upgrading does not
    // repaint anyone who never moved it.
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        for (const color of ['#f4bed0', '#bee2f4', '#c6ecc6', '#db3333', '#2e2eb8']) {
            const rendered = applyThemeReadabilityAndBrightness(color);
            assert.equal(deriveBaseColorFromEffectiveColor(rendered), rendered, `${color} did not round-trip at brightness 0`);
        }
    });
});

test('a base color survives a trip through the brightness pass and back', () => {
    // The inverse has to undo the exact travel the forward pass applied. Writing the sign out
    // in both places let them drift apart for negative brightness, which quietly moved every
    // color the picker or an import stored while the slider was left of centre.
    const bases = ['#f4bed0', '#bee2f4', '#c6ecc6', '#c1c1f0', '#93ecec', '#7a5fb0'];
    for (const themeMode of ['dark', 'light']) {
        for (const brightness of BRIGHTNESS_SWEEP) {
            withPalette({ themeMode, brightness }, () => {
                for (const base of bases) {
                    const rendered = applyThemeReadabilityAndBrightness(base);
                    const recovered = deriveBaseColorFromEffectiveColor(rendered);
                    // The readability walk is not invertible, so compare where it lands: a base
                    // that renders back to the same color is a base that round-tripped.
                    const settled = applyThemeReadabilityAndBrightness(recovered);
                    assert.ok(
                        colorDistanceOklab(settled, rendered) <= 2,
                        `${themeMode} brightness ${brightness}: ${base} rendered ${rendered}, came back as ${recovered} which renders ${settled}`
                    );
                }
            });
        }
    }
});

test('deriving a base color never discards the hue', () => {
    for (const brightness of BRIGHTNESS_SWEEP) {
        withPalette({ themeMode: 'dark', brightness }, () => {
            for (const effective of ['#f4bed0', '#bee2f4', '#c6ecc6', '#db3333']) {
                const base = deriveBaseColorFromEffectiveColor(effective);
                const [effectiveHue] = hexToHsl(effective);
                const [baseHue] = hexToHsl(base);
                // Eight bits per channel cannot hold every hue exactly; anything past a degree
                // or two of drift means the transform moved the color rather than rounded it.
                const drift = Math.min(Math.abs(baseHue - effectiveHue), 360 - Math.abs(baseHue - effectiveHue));
                assert.ok(drift <= 2, `brightness ${brightness} moved the hue of ${effective} to ${base}`);
            }
        });
    }
});

test('a greyscale palette never invents a hue', () => {
    // Reaching for saturation when the ladder runs out hands the user brown characters out of a
    // palette chosen for having no color in it.
    for (const brightness of BRIGHTNESS_SWEEP) {
        withPalette({ themeMode: 'dark', brightness, colorTheme: 'monochrome' }, () => {
            for (const color of addCharacters(8).map(entry => getEntryEffectiveColor(entry))) {
                const [, saturation] = hexToHsl(color);
                assert.ok(saturation <= 5, `brightness ${brightness} colored a greyscale palette: ${color}`);
            }
        });
    }
});

test('a greyscale palette still separates characters wherever there is room', () => {
    // Lightness is the only axis a grey palette has. Full darkening on a dark theme is the one
    // place it runs out: the travel lands every slot near lightness 50 and the contrast floor
    // holds it there, so a handful of lightness points has to seat the whole cast. Everywhere
    // that leaves room, all eight have to differ.
    for (const brightness of [100, 75, 50, 25, 0, -25, -50, -75]) {
        withPalette({ themeMode: 'dark', brightness, colorTheme: 'monochrome' }, () => {
            const colors = addCharacters(8).map(entry => getEntryEffectiveColor(entry));
            assert.equal(new Set(colors).size, colors.length, `brightness ${brightness} repeated a grey: ${colors.join(', ')}`);
        });
    }
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

test('a forced mode pins the readability surface no matter what the page shows', () => {
    // The reported failure: a semi-dark theme misdetected as light let the contrast
    // clamp drag every forced-bright color dark again. Forcing a mode must pin the
    // readability target too, not just the lightness band.
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        pageBackground = 'rgb(245, 245, 245)';
        invalidateThemeCache();
        assert.equal(getContrastSurfaceColor(), '#202328');
        const color = applyThemeReadabilityAndBrightness('#8888cc');
        assert.ok(getContrastRatio(color, '#202328') >= 4.5,
            `forced dark produced ${color}, unreadable on the dark reference surface`);
    });
    withPalette({ themeMode: 'light', brightness: 0 }, () => {
        pageBackground = 'rgb(20, 22, 26)';
        invalidateThemeCache();
        assert.equal(getContrastSurfaceColor(), '#f5f5f5');
        const color = applyThemeReadabilityAndBrightness('#8888cc');
        assert.ok(getContrastRatio(color, '#f5f5f5') >= 4.5,
            `forced light produced ${color}, unreadable on the light reference surface`);
    });
});

test('a transparent page background no longer reads as dark', () => {
    // rgba(0,0,0,0) used to parse as luma 0 and lock every image/overlay theme to
    // 'dark'. What actually shows through a transparent body is the layers above it
    // composited over the browser's white default canvas.
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        settings.themeMode = 'auto';
        pageBackground = 'rgba(0, 0, 0, 0)';
        invalidateThemeCache();
        assert.equal(detectTheme(), 'light');
    });
});

test('an unsafe midpoint inside a narrow stop interval falls back to a solid readable visual', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        const entry = {};
        applyGradientPreset(entry, {
            baseColor: '#ff00ff',
            color: '#ff00ff',
            gradient: {
                type: 'linear',
                primaryPosition: 51,
                stops: [{ baseColor: '#00ff00', color: '#00ff00', position: 52 }],
            },
        });

        assert.equal(new Set([entry.color, ...entry.gradient.stops.map(stop => stop.color)]).size, 1);
        assert.equal(resolveVisual(entry).gradientCss, null);
        assert.ok(sampleGradient(entry, { sampleCount: 17 })
            .every(sample => getContrastRatio(sample.color, getTextContrastSurfaceColor(entry.color)) >= 4.5));
    });
});

test('an unsafe interpolation color between finite samples falls back to a solid visual', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        const candidate = {
            color: '#f86f54',
            gradient: {
                type: 'linear',
                primaryPosition: 0,
                stops: [{ baseColor: '#309bc5', color: '#309bc5', position: 100 }],
            },
        };
        const surface = '#202328';
        assert.ok(sampleGradient(candidate, { sampleCount: 17 })
            .every(sample => getContrastRatio(sample.color, surface) >= 4.5));
        const missedColor = interpolateGradientColor(getGradientColorStops(candidate), 0.578);
        assert.equal(missedColor, '#848895');
        assert.ok(getContrastRatio(missedColor, surface) < 4.5);

        const entry = {};
        applyGradientPreset(entry, { baseColor: candidate.color, color: candidate.color, gradient: candidate.gradient });
        assert.equal(entry.gradient.stops[0].color, entry.color);
        assert.equal(resolveVisual(entry).gradientCss, null);
    });
});

test('every built-in gradient remains readable after ramp and highlight transformation', () => {
    for (const themeMode of ['dark', 'light']) {
        for (const highlightMode of [false, true]) {
            withPalette({ themeMode, brightness: 0 }, () => {
                settings.highlightMode = highlightMode;
                for (const [name, preset] of Object.entries(BUILTIN_GRADIENT_PRESETS)) {
                    const entry = {};
                    applyGradientPreset(entry, preset);
                    const surface = getTextContrastSurfaceColor(entry.color);
                    const minimum = Math.min(...sampleGradient(entry, { sampleCount: 17 })
                        .map(sample => getContrastRatio(sample.color, surface)));
                    assert.ok(minimum >= 4.5, `${themeMode}/${highlightMode ? 'highlight' : 'plain'} ${name}: ${minimum}`);
                }
            });
        }
    }
});

test('narrator primary and stop colors are reserved from palette assignment', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        settings.narratorStyle = {
            enabled: true,
            baseColor: '#ff00ff',
            gradient: {
                type: 'linear',
                primaryPosition: 0,
                stops: [{ baseColor: '#00ff00', color: '#00ff00', position: 100 }],
            },
        };
        const reserved = collectReservedGradientColors();
        assert.ok(reserved.includes(applyThemeReadabilityAndBrightness('#ff00ff')));
        assert.ok(reserved.includes(applyThemeReadabilityAndBrightness('#00ff00')));
    });
});

test('narrator gradient generation uses its visual identity instead of its display name', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        settings.gradientRandomMasterSeed = 'identity-test';
        settings.narratorStyle = {
            enabled: true,
            baseColor: '#f86f54',
            gradient: {
                type: 'linear',
                primaryPosition: 0,
                stops: [{ baseColor: '#ffffff', color: '#ffffff', position: 100 }],
            },
        };
        characterColors.narration = {
            name: 'Narration',
            baseColor: '#f86f54',
            color: '#f86f54',
            gradient: {
                type: 'linear',
                primaryPosition: 0,
                stops: [{ baseColor: '#ff80ff', color: '#ff80ff', position: 100 }],
            },
        };

        const narratorReserved = collectReservedGradientColors(NARRATOR_VISUAL_ID);
        const characterReserved = collectReservedGradientColors('Narration');
        const narratorStop = applyThemeReadabilityAndBrightness('#ffffff');
        assert.ok(narratorReserved.includes('#ff80ff'));
        assert.ok(!narratorReserved.includes(narratorStop));
        assert.ok(characterReserved.includes(narratorStop));
        assert.ok(!characterReserved.includes('#ff80ff'));

        const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        const first = createRandomGradient(narrator, { initial: true, totalStops: 3 });
        const repeatNarrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        const repeat = createRandomGradient(repeatNarrator, { initial: true, totalStops: 3 });
        const characterGradient = createRandomGradient(characterColors.narration, { initial: true, totalStops: 3 });

        assert.equal(narrator.gradientGenerator.seed, `identity-test\u001f${NARRATOR_VISUAL_ID}`);
        assert.equal(characterColors.narration.gradientGenerator.seed, 'identity-test\u001fnarration');
        assert.deepEqual(first, repeat);
        assert.notDeepEqual(first, characterGradient);
    });
});

test('character creation rejects both reserved narrator identities', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        assert.ok(buildCharacterEntry('Narration').entry);
        for (const name of ['Narrator', '__narrator__']) {
            assert.deepEqual(buildCharacterEntry(name), { key: '', entry: null, remapped: false });
        }
    });
});

test('flipping a generated gradient clears stale generator provenance', () => {
    withPalette({ themeMode: 'dark', brightness: 0 }, () => {
        const originalGetElementById = document.getElementById;
        const originalToastr = globalThis.toastr;
        document.getElementById = id => id === 'dc-legend-float' ? { style: { display: 'none' } } : null;
        globalThis.toastr = { success() {} };
        characterColors.alice = {
            name: 'Alice',
            baseColor: '#ff00ff',
            color: applyThemeReadabilityAndBrightness('#ff00ff'),
            gradient: {
                type: 'linear',
                primaryPosition: 0,
                stops: [{ baseColor: '#00ff00', color: applyThemeReadabilityAndBrightness('#00ff00'), position: 100 }],
            },
            gradientGenerator: { algorithm: 'dc-gradient-v1', seed: 'stale', iteration: 3 },
        };
        try {
            flipColorsForTheme();
            assert.equal(characterColors.alice.gradientGenerator, null);
        } finally {
            document.getElementById = originalGetElementById;
            if (originalToastr === undefined) delete globalThis.toastr;
            else globalThis.toastr = originalToastr;
        }
    });
});
