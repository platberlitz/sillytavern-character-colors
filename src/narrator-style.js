// narrator-style.js - canonical narrator settings and ephemeral visual derivation.
import { normalizeGradient, synchronizeGradientEffectiveColors } from './gradients.js';
import { GRADIENT_GENERATOR_ALGORITHM, normalizeGradientGenerator } from './seeded-gradient-generator.js';

export const NARRATOR_VISUAL_ID = '__narrator__';
export const DEFAULT_NARRATOR_STYLE = Object.freeze({
    enabled: false,
    baseColor: '#888888',
    gradient: null,
    gradientGenerator: null,
});

let transientNarratorCount = null;
let transientNarratorCountSource = null;

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    }
    return fallback;
}

function normalizeHex(value, fallback = '#888888') {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function normalizeGenerator(value, gradient) {
    if (!gradient || !value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.algorithm !== undefined && value.algorithm !== GRADIENT_GENERATOR_ALGORITHM) return null;
    const seed = String(value.seed ?? '');
    return seed ? normalizeGradientGenerator({ ...value, seed }) : null;
}

export function normalizeNarratorStyle(value, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const legacy = options.legacy && typeof options.legacy === 'object' ? options.legacy : {};
    const gradient = normalizeGradient(source.gradient);
    const enabled = hasOwn(source, 'enabled')
        ? normalizeBoolean(source.enabled, false)
        : hasOwn(legacy, 'disableNarration') ? !normalizeBoolean(legacy.disableNarration, true) : false;
    const baseColor = normalizeHex(
        hasOwn(source, 'baseColor') ? source.baseColor : legacy.narratorColor,
        DEFAULT_NARRATOR_STYLE.baseColor,
    );
    return {
        enabled,
        baseColor,
        gradient,
        gradientGenerator: normalizeGenerator(source.gradientGenerator, gradient),
    };
}

export function setNarratorStyle(target, value = target?.narratorStyle, resolveEffectiveColor = color => color) {
    if (!target || typeof target !== 'object') return normalizeNarratorStyle(value);
    const normalized = normalizeNarratorStyle(value, { legacy: target });
    const resolver = typeof resolveEffectiveColor === 'function' ? resolveEffectiveColor : color => color;
    normalized.gradient = synchronizeGradientEffectiveColors(normalized.gradient, resolver);
    normalized.gradientGenerator = normalizeGenerator(normalized.gradientGenerator, normalized.gradient);
    target.narratorStyle = normalized;
    // Keep the release-one mirrors current for old consumers and old exports.
    target.disableNarration = !normalized.enabled;
    target.narratorColor = normalized.baseColor;
    return normalized;
}

export function getNarratorVisual(source, resolveEffectiveColor = color => color) {
    const settingsSource = source && typeof source === 'object' ? source : {};
    const style = normalizeNarratorStyle(settingsSource.narratorStyle, { legacy: settingsSource });
    if (!style.enabled) return null;
    const resolver = typeof resolveEffectiveColor === 'function' ? resolveEffectiveColor : color => color;
    return {
        id: NARRATOR_VISUAL_ID,
        key: NARRATOR_VISUAL_ID,
        kind: 'narrator',
        name: 'Narration',
        baseColor: style.baseColor,
        color: normalizeHex(resolver(style.baseColor), style.baseColor),
        gradient: synchronizeGradientEffectiveColors(style.gradient, resolver),
        gradientGenerator: normalizeGenerator(style.gradientGenerator, style.gradient),
        aliases: [],
        font: '',
        style: '',
    };
}

export function setTransientNarratorCount(value, source = null) {
    const count = Number(value);
    transientNarratorCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
    transientNarratorCountSource = source;
    return transientNarratorCount;
}

export function getTransientNarratorCount(source) {
    if (arguments.length && source !== transientNarratorCountSource) return null;
    return transientNarratorCount;
}
