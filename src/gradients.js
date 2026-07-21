// gradients.js - canonical gradient data helpers shared by state, storage, and rendering.

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

export function normalizeGradient(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.type !== 'linear' && value.type !== 'radial') return null;

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
});

export function getBuiltInGradientPreset(name) {
    return normalizeGradientPreset(BUILTIN_GRADIENT_PRESETS[normalizeGradientPresetName(name)]);
}
