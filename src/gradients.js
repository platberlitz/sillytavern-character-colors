// gradients.js - canonical gradient data helpers shared by state, storage, and rendering.

// Conic reads `angle` as the sweep start and `x`/`y` as the pivot, so it uses
// every geometry field the other two types already carry. Unknown types are
// rejected rather than coerced: a gradient that cannot be rendered must not be
// stored as one that can.
export const GRADIENT_TYPES = Object.freeze(['linear', 'radial', 'conic']);

export const MAX_GRADIENT_STOPS = 5;
export const MAX_GRADIENT_SECONDARY_STOPS = MAX_GRADIENT_STOPS - 1;
export const DEFAULT_GRADIENT_ANGLE = 90;
export const DEFAULT_GRADIENT_POSITION = 50;
// Animation duration is stored in seconds.
export const DEFAULT_GRADIENT_DURATION = 8;

function normalizeHex(value, fallback = null) {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function normalizeNumber(value, fallback, min, max) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return fallback;
}

function normalizeGradientStop(stop) {
    if (!stop || typeof stop !== 'object' || Array.isArray(stop)) return null;
    const color = normalizeHex(stop.color, null);
    const baseColor = normalizeHex(stop.baseColor, color);
    if (!baseColor) return null;
    return {
        baseColor,
        color: color || baseColor,
        position: normalizeNumber(stop.position, DEFAULT_GRADIENT_POSITION, 0, 100),
    };
}

/**
 * Map a [0,1) sample onto a gradient type.
 *
 * Linear keeps the majority because it is the one that stays legible behind
 * short runs of dialogue text; conic is the rarest because a full hue sweep
 * across a few words is striking once and noisy everywhere.
 */
export function pickRandomGradientType(sample) {
    const value = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0;
    if (value < 0.15) return 'conic';
    if (value < 0.4) return 'radial';
    return 'linear';
}

export function normalizeGradient(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!GRADIENT_TYPES.includes(value.type)) return null;

    const stops = Array.isArray(value.stops)
        ? value.stops.map(normalizeGradientStop).filter(Boolean).slice(0, MAX_GRADIENT_SECONDARY_STOPS)
        : [];
    if (!stops.length) return null;
    stops.sort((left, right) => left.position - right.position);

    const animation = value.animation && typeof value.animation === 'object' && !Array.isArray(value.animation)
        ? value.animation
        : {};
    return {
        type: value.type,
        angle: normalizeNumber(value.angle, DEFAULT_GRADIENT_ANGLE, 0, 360),
        x: normalizeNumber(value.x, DEFAULT_GRADIENT_POSITION, 0, 100),
        y: normalizeNumber(value.y, DEFAULT_GRADIENT_POSITION, 0, 100),
        primaryPosition: normalizeNumber(value.primaryPosition, 0, 0, 100),
        stops,
        animation: {
            enabled: normalizeBoolean(animation.enabled, false),
            duration: normalizeNumber(animation.duration, DEFAULT_GRADIENT_DURATION, 0.5, 120),
            reverse: normalizeBoolean(animation.reverse, false),
        },
    };
}

function randomSample(random) {
    const value = Number(typeof random === 'function' ? random() : Math.random());
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(0.999999999, value));
}

function parseHexRgb(color) {
    const normalized = normalizeHex(color, '#888888');
    return [
        parseInt(normalized.slice(1, 3), 16),
        parseInt(normalized.slice(3, 5), 16),
        parseInt(normalized.slice(5, 7), 16),
    ];
}

function colorsAreDistinct(left, right) {
    const leftRgb = parseHexRgb(left);
    const rightRgb = parseHexRgb(right);
    const distanceSquared = leftRgb.reduce((total, channel, index) => total + ((channel - rightRgb[index]) ** 2), 0);
    return distanceSquared >= 2025;
}

function hexToHsl(color) {
    const [rawRed, rawGreen, rawBlue] = parseHexRgb(color);
    const red = rawRed / 255;
    const green = rawGreen / 255;
    const blue = rawBlue / 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const lightness = (maximum + minimum) / 2;
    if (maximum === minimum) return [0, 0, lightness * 100];
    const delta = maximum - minimum;
    const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
    let hue;
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * (((blue - red) / delta) + 2);
    else hue = 60 * (((red - green) / delta) + 4);
    return [(hue + 360) % 360, saturation * 100, lightness * 100];
}

function hslToHex(hue, saturation, lightness) {
    const normalizedHue = ((hue % 360) + 360) % 360;
    const normalizedSaturation = Math.max(0, Math.min(100, saturation)) / 100;
    const normalizedLightness = Math.max(0, Math.min(100, lightness)) / 100;
    const chroma = (1 - Math.abs((2 * normalizedLightness) - 1)) * normalizedSaturation;
    const secondary = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
    const offset = normalizedLightness - (chroma / 2);
    const sectors = [
        [chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
        [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary],
    ];
    const [red, green, blue] = sectors[Math.floor(normalizedHue / 60) % 6];
    return `#${[red, green, blue].map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function buildFallbackRandomColor(seedColor, index, random) {
    const [hue, saturation, lightness] = hexToHsl(seedColor);
    if (saturation < 10) {
        const lightnessShift = (index % 2 ? -1 : 1) * (18 + (randomSample(random) * 28));
        return hslToHex(hue, saturation, Math.max(12, Math.min(88, lightness + lightnessShift)));
    }
    const hueShift = 45 + (randomSample(random) * 225);
    const nextSaturation = Math.max(35, Math.min(95, saturation + ((randomSample(random) - 0.5) * 24)));
    const nextLightness = Math.max(28, Math.min(78, lightness + ((randomSample(random) - 0.5) * 30)));
    return hslToHex(hue + (hueShift * (index % 2 ? -1 : 1)), nextSaturation, nextLightness);
}

function buildDeterministicFallbackColor(seedColor, index) {
    const [hue, saturation] = hexToHsl(seedColor);
    const lightnessLevels = [42, 62, 52, 72, 32, 57];
    return hslToHex(
        hue + 47 + (index * 137.508),
        Math.max(55, Math.min(88, saturation || 65)),
        lightnessLevels[index % lightnessLevels.length],
    );
}

function buildRgbLatticeColor(index) {
    const levels = [0, 51, 102, 153, 204, 255];
    const red = levels[Math.floor(index / 36) % levels.length];
    const green = levels[Math.floor(index / 6) % levels.length];
    const blue = levels[index % levels.length];
    return `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function colorIsAvailable(candidate, selectedColors, selectedRenderedColors, transformColor) {
    const rendered = normalizeHex(transformColor(candidate), candidate);
    return selectedColors.every(selected => colorsAreDistinct(selected, candidate))
        && selectedRenderedColors.every(selected => selected !== rendered);
}

export function buildRandomGradient(primaryColor, options = {}, random = Math.random) {
    const primary = normalizeHex(primaryColor, '#888888');
    const transformColor = typeof options.transformColor === 'function' ? options.transformColor : color => color;
    const palette = [...new Set((Array.isArray(options.palette) ? options.palette : [])
        .map(color => normalizeHex(color, null))
        .filter(Boolean))];
    for (let index = palette.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(randomSample(random) * (index + 1));
        [palette[index], palette[swapIndex]] = [palette[swapIndex], palette[index]];
    }

    const requestedTotal = Number(options.totalStops);
    const totalStops = Number.isFinite(requestedTotal)
        ? Math.max(2, Math.min(MAX_GRADIENT_STOPS, Math.round(requestedTotal)))
        : 2 + Math.floor(randomSample(random) * (MAX_GRADIENT_STOPS - 1));
    const secondaryCount = totalStops - 1;
    const selectedColors = [primary];
    const selectedRenderedColors = [normalizeHex(transformColor(primary), primary)];
    const stops = [];
    let previousPosition = 0;

    for (let index = 0; index < secondaryCount; index++) {
        let candidate = null;
        while (palette.length && !candidate) {
            const paletteCandidate = palette.shift();
            if (colorIsAvailable(paletteCandidate, selectedColors, selectedRenderedColors, transformColor)) {
                candidate = paletteCandidate;
            }
        }
        for (let attempt = 0; attempt < 24 && !candidate; attempt++) {
            const nextColor = buildFallbackRandomColor(primary, index + attempt, random);
            if (colorIsAvailable(nextColor, selectedColors, selectedRenderedColors, transformColor)) {
                candidate = nextColor;
                break;
            }
        }
        for (let attempt = 0; attempt < 72 && !candidate; attempt++) {
            const nextColor = buildDeterministicFallbackColor(primary, index + attempt);
            if (colorIsAvailable(nextColor, selectedColors, selectedRenderedColors, transformColor)) {
                candidate = nextColor;
            }
        }
        for (let attempt = 0; attempt < 216 && !candidate; attempt++) {
            const nextColor = buildRgbLatticeColor(attempt);
            if (colorIsAvailable(nextColor, selectedColors, selectedRenderedColors, transformColor)) {
                candidate = nextColor;
            }
        }
        if (!candidate) throw new Error('Could not generate distinct gradient colors.');
        selectedColors.push(candidate);
        selectedRenderedColors.push(normalizeHex(transformColor(candidate), candidate));

        const isLast = index === secondaryCount - 1;
        const remainingStops = secondaryCount - index - 1;
        const evenPosition = ((index + 1) / secondaryCount) * 100;
        const jitter = isLast ? 0 : (randomSample(random) - 0.5) * 14;
        const minimumPosition = previousPosition + 5;
        const maximumPosition = 100 - (remainingStops * 5);
        const position = isLast ? 100 : Math.max(minimumPosition, Math.min(maximumPosition, evenPosition + jitter));
        previousPosition = position;
        stops.push({ baseColor: candidate, color: candidate, position: Number(position.toFixed(1)) });
    }

    return normalizeGradient({
        type: pickRandomGradientType(randomSample(random)),
        angle: Number((randomSample(random) * 360).toFixed(1)),
        x: Math.round(20 + (randomSample(random) * 60)),
        y: Math.round(20 + (randomSample(random) * 60)),
        primaryPosition: 0,
        stops,
        animation: options.animation || { enabled: false, duration: DEFAULT_GRADIENT_DURATION, reverse: false },
    });
}

export function cloneGradient(value) {
    const gradient = normalizeGradient(value);
    if (!gradient) return null;
    return {
        ...gradient,
        stops: gradient.stops.map(stop => ({ ...stop })),
        animation: { ...gradient.animation },
    };
}

// Returns the canonical JSON-safe object used by every persistence path.
export function serializeGradient(value) {
    return cloneGradient(value);
}

export function mapGradientStops(value, mapper) {
    const gradient = normalizeGradient(value);
    if (!gradient || typeof mapper !== 'function') return cloneGradient(gradient);
    const stops = gradient.stops.map((stop, index) => {
        const original = { ...stop };
        const mapped = mapper(original, index);
        return normalizeGradientStop(mapped) || original;
    });
    return normalizeGradient({ ...gradient, stops });
}

export function synchronizeGradientEffectiveColors(value, resolveEffectiveColor) {
    if (typeof resolveEffectiveColor !== 'function') return cloneGradient(value);
    return mapGradientStops(value, stop => ({
        ...stop,
        color: normalizeHex(resolveEffectiveColor(stop.baseColor), stop.baseColor),
    }));
}

export function normalizeGradientPreset(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const gradient = normalizeGradient(value.gradient);
    const color = normalizeHex(value.color, null);
    const baseColor = normalizeHex(value.baseColor, color);
    if (!gradient || !baseColor) return null;
    return {
        baseColor,
        color: color || baseColor,
        gradient,
    };
}

export function createGradientPresetFromEntry(entry) {
    return normalizeGradientPreset(entry);
}

export function applyGradientPresetToEntry(entry, preset, resolveEffectiveColor = color => color) {
    const normalizedPreset = normalizeGradientPreset(preset);
    if (!entry || typeof entry !== 'object' || !normalizedPreset) return null;
    const color = normalizeHex(resolveEffectiveColor(normalizedPreset.baseColor), normalizedPreset.baseColor);
    return {
        ...entry,
        baseColor: normalizedPreset.baseColor,
        color,
        gradient: synchronizeGradientEffectiveColors(normalizedPreset.gradient, resolveEffectiveColor),
        gradientGenerator: null,
    };
}

export function normalizeGradientPresetName(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function normalizeGradientPresets(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const presets = {};
    for (const [rawName, rawPreset] of Object.entries(value)) {
        const name = normalizeGradientPresetName(rawName);
        const preset = normalizeGradientPreset(rawPreset);
        if (name && preset) presets[name] = preset;
    }
    return presets;
}

function formatCssNumber(value) {
    return Number(value.toFixed(4)).toString();
}

export function buildGradientCss(entry) {
    const gradient = normalizeGradient(entry?.gradient);
    if (!gradient) return null;
    const primaryColor = normalizeHex(entry?.color, normalizeHex(entry?.baseColor, '#888888'));
    const colorStops = [
        { color: primaryColor, position: gradient.primaryPosition },
        ...gradient.stops.map(stop => ({ color: stop.color, position: stop.position })),
    ]
        .sort((left, right) => left.position - right.position)
        .map(stop => `${stop.color} ${formatCssNumber(stop.position)}%`)
        .join(', ');
    if (gradient.type === 'radial') {
        return `radial-gradient(circle at ${formatCssNumber(gradient.x)}% ${formatCssNumber(gradient.y)}%, ${colorStops})`;
    }
    if (gradient.type === 'conic') {
        // Stop positions stay percentages: CSS maps 0-100% onto the full turn,
        // so the same stop data drives all three types unchanged.
        return `conic-gradient(from ${formatCssNumber(gradient.angle)}deg at ${formatCssNumber(gradient.x)}% ${formatCssNumber(gradient.y)}%, ${colorStops})`;
    }
    return `linear-gradient(${formatCssNumber(gradient.angle)}deg, ${colorStops})`;
}

export function getGradientSignature(entry) {
    const gradient = normalizeGradient(entry?.gradient);
    if (!gradient) return '';
    return JSON.stringify({
        baseColor: normalizeHex(entry?.baseColor, normalizeHex(entry?.color, '#888888')),
        color: normalizeHex(entry?.color, normalizeHex(entry?.baseColor, '#888888')),
        gradient,
    });
}

function freezePreset(preset) {
    Object.freeze(preset.gradient.animation);
    preset.gradient.stops.forEach(Object.freeze);
    Object.freeze(preset.gradient.stops);
    Object.freeze(preset.gradient);
    return Object.freeze(preset);
}

export const BUILTIN_GRADIENT_PRESETS = Object.freeze({
    'sunset-ribbon': freezePreset(normalizeGradientPreset({
        baseColor: '#ff6b6b',
        color: '#ff6b6b',
        gradient: {
            type: 'linear', angle: 112, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#ff9f43', color: '#ff9f43', position: 34 },
                { baseColor: '#feca57', color: '#feca57', position: 67 },
                { baseColor: '#ee5a6f', color: '#ee5a6f', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'aurora-drift': freezePreset(normalizeGradientPreset({
        baseColor: '#5ee7df',
        color: '#5ee7df',
        gradient: {
            type: 'linear', angle: 137.5, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#7b61ff', color: '#7b61ff', position: 24 },
                { baseColor: '#b56cff', color: '#b56cff', position: 50 },
                { baseColor: '#ff6ec7', color: '#ff6ec7', position: 76 },
                { baseColor: '#5ee7df', color: '#5ee7df', position: 100 },
            ],
            animation: { enabled: true, duration: 10, reverse: true },
        },
    })),
    'moonlit-focus': freezePreset(normalizeGradientPreset({
        baseColor: '#dbeafe',
        color: '#dbeafe',
        gradient: {
            type: 'radial', angle: 90, x: 38, y: 30, primaryPosition: 0,
            stops: [
                { baseColor: '#818cf8', color: '#818cf8', position: 55 },
                { baseColor: '#312e81', color: '#312e81', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'ember-halo': freezePreset(normalizeGradientPreset({
        baseColor: '#fde68a',
        color: '#fde68a',
        gradient: {
            type: 'radial', angle: 90, x: 50, y: 55, primaryPosition: 0,
            stops: [
                { baseColor: '#fb923c', color: '#fb923c', position: 42 },
                { baseColor: '#dc2626', color: '#dc2626', position: 72 },
                { baseColor: '#450a0a', color: '#450a0a', position: 100 },
            ],
            animation: { enabled: true, duration: 14, reverse: false },
        },
    })),
    'ocean-current': freezePreset(normalizeGradientPreset({
        baseColor: '#67e8f9',
        color: '#67e8f9',
        gradient: {
            type: 'linear', angle: 125, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#22d3ee', color: '#22d3ee', position: 28 },
                { baseColor: '#2563eb', color: '#2563eb', position: 66 },
                { baseColor: '#1e3a8a', color: '#1e3a8a', position: 100 },
            ],
            animation: { enabled: true, duration: 12, reverse: true },
        },
    })),
    'forest-canopy': freezePreset(normalizeGradientPreset({
        baseColor: '#d9f99d',
        color: '#d9f99d',
        gradient: {
            type: 'radial', angle: 90, x: 42, y: 28, primaryPosition: 0,
            stops: [
                { baseColor: '#4ade80', color: '#4ade80', position: 38 },
                { baseColor: '#15803d', color: '#15803d', position: 70 },
                { baseColor: '#14532d', color: '#14532d', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'rose-gold': freezePreset(normalizeGradientPreset({
        baseColor: '#fdf2f8',
        color: '#fdf2f8',
        gradient: {
            type: 'linear', angle: 102, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#f9a8d4', color: '#f9a8d4', position: 32 },
                { baseColor: '#d4a373', color: '#d4a373', position: 68 },
                { baseColor: '#9f1239', color: '#9f1239', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'cyber-pulse': freezePreset(normalizeGradientPreset({
        baseColor: '#00f5d4',
        color: '#00f5d4',
        gradient: {
            type: 'linear', angle: 145, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#00bbf9', color: '#00bbf9', position: 24 },
                { baseColor: '#9b5de5', color: '#9b5de5', position: 50 },
                { baseColor: '#f15bb5', color: '#f15bb5', position: 76 },
                { baseColor: '#fee440', color: '#fee440', position: 100 },
            ],
            animation: { enabled: true, duration: 7, reverse: false },
        },
    })),
    'lavender-dusk': freezePreset(normalizeGradientPreset({
        baseColor: '#ede9fe',
        color: '#ede9fe',
        gradient: {
            type: 'linear', angle: 118, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#c4b5fd', color: '#c4b5fd', position: 34 },
                { baseColor: '#8b5cf6', color: '#8b5cf6', position: 68 },
                { baseColor: '#4c1d95', color: '#4c1d95', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'citrus-bloom': freezePreset(normalizeGradientPreset({
        baseColor: '#fef08a',
        color: '#fef08a',
        gradient: {
            type: 'radial', angle: 90, x: 36, y: 34, primaryPosition: 0,
            stops: [
                { baseColor: '#facc15', color: '#facc15', position: 32 },
                { baseColor: '#f97316', color: '#f97316', position: 68 },
                { baseColor: '#ef4444', color: '#ef4444', position: 100 },
            ],
            animation: { enabled: true, duration: 9, reverse: true },
        },
    })),
    'glacier-prism': freezePreset(normalizeGradientPreset({
        baseColor: '#ecfeff',
        color: '#ecfeff',
        gradient: {
            type: 'linear', angle: 72, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#a5f3fc', color: '#a5f3fc', position: 24 },
                { baseColor: '#67e8f9', color: '#67e8f9', position: 48 },
                { baseColor: '#38bdf8', color: '#38bdf8', position: 74 },
                { baseColor: '#6366f1', color: '#6366f1', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'royal-velvet': freezePreset(normalizeGradientPreset({
        baseColor: '#f5d0fe',
        color: '#f5d0fe',
        gradient: {
            type: 'radial', angle: 90, x: 46, y: 35, primaryPosition: 0,
            stops: [
                { baseColor: '#d946ef', color: '#d946ef', position: 40 },
                { baseColor: '#7e22ce', color: '#7e22ce', position: 72 },
                { baseColor: '#3b0764', color: '#3b0764', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'cherry-cola': freezePreset(normalizeGradientPreset({
        baseColor: '#fecdd3',
        color: '#fecdd3',
        gradient: {
            type: 'linear', angle: 155, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#fb7185', color: '#fb7185', position: 35 },
                { baseColor: '#be123c', color: '#be123c', position: 70 },
                { baseColor: '#4c0519', color: '#4c0519', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'desert-sky': freezePreset(normalizeGradientPreset({
        baseColor: '#fde68a',
        color: '#fde68a',
        gradient: {
            type: 'linear', angle: 128, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#fb923c', color: '#fb923c', position: 34 },
                { baseColor: '#e879f9', color: '#e879f9', position: 66 },
                { baseColor: '#7c3aed', color: '#7c3aed', position: 100 },
            ],
            animation: { enabled: true, duration: 16, reverse: false },
        },
    })),
    'mint-shadow': freezePreset(normalizeGradientPreset({
        baseColor: '#d1fae5',
        color: '#d1fae5',
        gradient: {
            type: 'radial', angle: 90, x: 32, y: 30, primaryPosition: 0,
            stops: [
                { baseColor: '#6ee7b7', color: '#6ee7b7', position: 36 },
                { baseColor: '#0f766e', color: '#0f766e', position: 70 },
                { baseColor: '#134e4a', color: '#134e4a', position: 100 },
            ],
            animation: { enabled: true, duration: 13, reverse: true },
        },
    })),
    'silver-screen': freezePreset(normalizeGradientPreset({
        baseColor: '#f8fafc',
        color: '#f8fafc',
        gradient: {
            type: 'linear', angle: 110, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#cbd5e1', color: '#cbd5e1', position: 32 },
                { baseColor: '#64748b', color: '#64748b', position: 68 },
                { baseColor: '#0f172a', color: '#0f172a', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),

    // --- Conic: a sweep around a pivot, which no linear or radial stop
    // arrangement can reproduce. Kept to a handful because a full hue rotation
    // across a few words of dialogue is striking once and noisy in bulk.

    'spectral-wheel': freezePreset(normalizeGradientPreset({
        baseColor: '#ff4d6d',
        color: '#ff4d6d',
        gradient: {
            // First and last stops are the same hue so the sweep closes with no
            // seam where 100% meets 0%.
            type: 'conic', angle: 0, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#ffd166', color: '#ffd166', position: 25 },
                { baseColor: '#06d6a0', color: '#06d6a0', position: 50 },
                { baseColor: '#4cc9f0', color: '#4cc9f0', position: 75 },
                { baseColor: '#ff4d6d', color: '#ff4d6d', position: 100 },
            ],
            animation: { enabled: true, duration: 18, reverse: false },
        },
    })),
    'chromatic-aberration': freezePreset(normalizeGradientPreset({
        baseColor: '#f8f9ff',
        color: '#f8f9ff',
        gradient: {
            // RGB fringing: pale core, split channels, back to pale.
            type: 'conic', angle: 210, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#ff2d55', color: '#ff2d55', position: 30 },
                { baseColor: '#30d158', color: '#30d158', position: 55 },
                { baseColor: '#0a84ff', color: '#0a84ff', position: 80 },
                { baseColor: '#f8f9ff', color: '#f8f9ff', position: 100 },
            ],
            animation: { enabled: true, duration: 11, reverse: true },
        },
    })),
    'beacon-sweep': freezePreset(normalizeGradientPreset({
        baseColor: '#fffbe6',
        color: '#fffbe6',
        gradient: {
            // A paired hard stop cuts one bright wedge out of the sweep, like a
            // lamp turning. Five stops cannot make more spokes than this.
            type: 'conic', angle: 45, x: 50, y: 48, primaryPosition: 0,
            stops: [
                { baseColor: '#fffbe6', color: '#fffbe6', position: 12 },
                { baseColor: '#f59e0b', color: '#f59e0b', position: 12 },
                { baseColor: '#f59e0b', color: '#f59e0b', position: 38 },
                { baseColor: '#7c2d12', color: '#7c2d12', position: 100 },
            ],
            animation: { enabled: true, duration: 24, reverse: false },
        },
    })),
    'oil-slick': freezePreset(normalizeGradientPreset({
        baseColor: '#1b1b2f',
        color: '#1b1b2f',
        gradient: {
            type: 'conic', angle: 128, x: 42, y: 58, primaryPosition: 0,
            stops: [
                { baseColor: '#00c2a8', color: '#00c2a8', position: 22 },
                { baseColor: '#7b2ff7', color: '#7b2ff7', position: 48 },
                { baseColor: '#f72585', color: '#f72585', position: 70 },
                { baseColor: '#1b1b2f', color: '#1b1b2f', position: 100 },
            ],
            animation: { enabled: true, duration: 15, reverse: true },
        },
    })),
    'nixie-sweep': freezePreset(normalizeGradientPreset({
        baseColor: '#ffb347',
        color: '#ffb347',
        gradient: {
            // Neon-orange cathode glow falling off into unlit tube.
            type: 'conic', angle: 270, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#ff7b00', color: '#ff7b00', position: 30 },
                { baseColor: '#8c2f00', color: '#8c2f00', position: 62 },
                { baseColor: '#1a0f0a', color: '#1a0f0a', position: 100 },
            ],
            animation: { enabled: true, duration: 20, reverse: false },
        },
    })),

    // --- Hard-banded: stops sharing a position render as a cut, not a blend.

    'heraldic-bands': freezePreset(normalizeGradientPreset({
        baseColor: '#2d1b4e',
        color: '#2d1b4e',
        gradient: {
            type: 'linear', angle: 90, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#2d1b4e', color: '#2d1b4e', position: 33 },
                { baseColor: '#c9184a', color: '#c9184a', position: 33 },
                { baseColor: '#c9184a', color: '#c9184a', position: 66 },
                { baseColor: '#ffb703', color: '#ffb703', position: 66 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'thermal-imaging': freezePreset(normalizeGradientPreset({
        baseColor: '#03071e',
        color: '#03071e',
        gradient: {
            // False-colour ramp: cold floor through to white-hot.
            type: 'linear', angle: 90, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#370617', color: '#370617', position: 22 },
                { baseColor: '#dc2f02', color: '#dc2f02', position: 52 },
                { baseColor: '#ffba08', color: '#ffba08', position: 78 },
                { baseColor: '#fff3b0', color: '#fff3b0', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'stained-glass': freezePreset(normalizeGradientPreset({
        baseColor: '#0b132b',
        color: '#0b132b',
        gradient: {
            // Leaded panes: saturated blocks separated by dark came lines.
            type: 'linear', angle: 62, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#1c7293', color: '#1c7293', position: 26 },
                { baseColor: '#0b132b', color: '#0b132b', position: 30 },
                { baseColor: '#9d0208', color: '#9d0208', position: 64 },
                { baseColor: '#e9c46a', color: '#e9c46a', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),

    // --- Mineral and pigment: named after the material rather than a mood.

    'cinnabar-verdigris': freezePreset(normalizeGradientPreset({
        baseColor: '#e34234',
        color: '#e34234',
        gradient: {
            // Two pigments that corrode toward each other: vermilion into
            // oxidised copper.
            type: 'linear', angle: 138, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#a53f2b', color: '#a53f2b', position: 34 },
                { baseColor: '#2f6f6a', color: '#2f6f6a', position: 68 },
                { baseColor: '#43aa8b', color: '#43aa8b', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'orpiment-realgar': freezePreset(normalizeGradientPreset({
        baseColor: '#ffd23f',
        color: '#ffd23f',
        gradient: {
            // Arsenic sulphides: the yellow one weathers into the orange one.
            type: 'linear', angle: 96, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#f4a259', color: '#f4a259', position: 40 },
                { baseColor: '#bc4749', color: '#bc4749', position: 74 },
                { baseColor: '#582f0e', color: '#582f0e', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'labradorite': freezePreset(normalizeGradientPreset({
        baseColor: '#c9d6df',
        color: '#c9d6df',
        gradient: {
            // Schiller: the flash sits off-centre and the stone is dark
            // everywhere else.
            type: 'radial', angle: 90, x: 26, y: 74, primaryPosition: 0,
            stops: [
                { baseColor: '#4ea8de', color: '#4ea8de', position: 26 },
                { baseColor: '#3d348b', color: '#3d348b', position: 54 },
                { baseColor: '#1a1423', color: '#1a1423', position: 100 },
            ],
            animation: { enabled: true, duration: 17, reverse: true },
        },
    })),
    'malachite-vein': freezePreset(normalizeGradientPreset({
        baseColor: '#d8f3dc',
        color: '#d8f3dc',
        gradient: {
            type: 'radial', angle: 90, x: 68, y: 22, primaryPosition: 0,
            stops: [
                { baseColor: '#52b788', color: '#52b788', position: 30 },
                { baseColor: '#1b4332', color: '#1b4332', position: 58 },
                { baseColor: '#081c15', color: '#081c15', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'tarnished-brass': freezePreset(normalizeGradientPreset({
        baseColor: '#f2e8cf',
        color: '#f2e8cf',
        gradient: {
            type: 'linear', angle: 168, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#c9a227', color: '#c9a227', position: 30 },
                { baseColor: '#6b705c', color: '#6b705c', position: 62 },
                { baseColor: '#283618', color: '#283618', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),

    // --- Light without a sun: emission, decay, and the dark.

    'abyssal-glow': freezePreset(normalizeGradientPreset({
        baseColor: '#7ae7c7',
        color: '#7ae7c7',
        gradient: {
            // Bioluminescence: a small cold light and a great deal of water.
            type: 'radial', angle: 90, x: 50, y: 82, primaryPosition: 0,
            stops: [
                { baseColor: '#1f7a8c', color: '#1f7a8c', position: 24 },
                { baseColor: '#022b3a', color: '#022b3a', position: 56 },
                { baseColor: '#000814', color: '#000814', position: 100 },
            ],
            animation: { enabled: true, duration: 21, reverse: true },
        },
    })),
    'cherenkov-blue': freezePreset(normalizeGradientPreset({
        baseColor: '#caf0f8',
        color: '#caf0f8',
        gradient: {
            type: 'radial', angle: 90, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#48cae4', color: '#48cae4', position: 22 },
                { baseColor: '#0077b6', color: '#0077b6', position: 48 },
                { baseColor: '#03045e', color: '#03045e', position: 100 },
            ],
            animation: { enabled: true, duration: 9, reverse: false },
        },
    })),
    'blacklight-poster': freezePreset(normalizeGradientPreset({
        baseColor: '#b5179e',
        color: '#b5179e',
        gradient: {
            // Fluorescent inks over near-black: high chroma, low lightness.
            type: 'linear', angle: 118, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#7209b7', color: '#7209b7', position: 32 },
                { baseColor: '#3a0ca3', color: '#3a0ca3', position: 62 },
                { baseColor: '#10002b', color: '#10002b', position: 100 },
            ],
            animation: { enabled: true, duration: 12, reverse: true },
        },
    })),
    'event-horizon': freezePreset(normalizeGradientPreset({
        baseColor: '#ffedd5',
        color: '#ffedd5',
        gradient: {
            // Accretion disc: a thin bright rim collapsing straight to nothing.
            type: 'radial', angle: 90, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#fb8500', color: '#fb8500', position: 14 },
                { baseColor: '#6a040f', color: '#6a040f', position: 34 },
                { baseColor: '#03071e', color: '#03071e', position: 62 },
                { baseColor: '#000000', color: '#000000', position: 100 },
            ],
            animation: { enabled: true, duration: 26, reverse: false },
        },
    })),
    'crt-phosphor': freezePreset(normalizeGradientPreset({
        baseColor: '#ccff33',
        color: '#ccff33',
        gradient: {
            // P1 green burning down into an unlit tube.
            type: 'linear', angle: 90, x: 50, y: 50, primaryPosition: 0,
            stops: [
                { baseColor: '#70e000', color: '#70e000', position: 28 },
                { baseColor: '#38b000', color: '#38b000', position: 52 },
                { baseColor: '#004b23', color: '#004b23', position: 100 },
            ],
            animation: { enabled: true, duration: 6, reverse: true },
        },
    })),

    // --- Organic and decaying.

    'mycelium-bloom': freezePreset(normalizeGradientPreset({
        baseColor: '#ede0d4',
        color: '#ede0d4',
        gradient: {
            type: 'radial', angle: 90, x: 18, y: 20, primaryPosition: 0,
            stops: [
                { baseColor: '#b08968', color: '#b08968', position: 34 },
                { baseColor: '#7f5539', color: '#7f5539', position: 66 },
                { baseColor: '#3b2417', color: '#3b2417', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
    'foxfire': freezePreset(normalizeGradientPreset({
        baseColor: '#d9ed92',
        color: '#d9ed92',
        gradient: {
            // Rotting wood that glows: sickly green over damp dark.
            type: 'radial', angle: 90, x: 62, y: 66, primaryPosition: 0,
            stops: [
                { baseColor: '#99d98c', color: '#99d98c', position: 26 },
                { baseColor: '#34a0a4', color: '#34a0a4', position: 52 },
                { baseColor: '#184e77', color: '#184e77', position: 100 },
            ],
            animation: { enabled: true, duration: 19, reverse: true },
        },
    })),
    'antique-vellum': freezePreset(normalizeGradientPreset({
        baseColor: '#fefae0',
        color: '#fefae0',
        gradient: {
            // Foxed paper: clean centre, staining toward the edges.
            type: 'radial', angle: 90, x: 44, y: 40, primaryPosition: 0,
            stops: [
                { baseColor: '#e6ccb2', color: '#e6ccb2', position: 42 },
                { baseColor: '#a68a64', color: '#a68a64', position: 74 },
                { baseColor: '#582f0e', color: '#582f0e', position: 100 },
            ],
            animation: { enabled: false, duration: 8, reverse: false },
        },
    })),
});

export function getBuiltInGradientPreset(name) {
    return normalizeGradientPreset(BUILTIN_GRADIENT_PRESETS[normalizeGradientPresetName(name)]);
}
