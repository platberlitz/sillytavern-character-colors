import { cloneGradient, normalizeGradient } from './gradients.js';

export const CHARACTER_STYLE_KIND = 'dialogue-colors/character-style';
export const CHARACTER_STYLE_VERSION = 1;

export const CHARACTER_STYLE_FIELD_MASKS = Object.freeze({
    BASE_COLOR: 1 << 0,
    GRADIENT: 1 << 1,
    FONT: 1 << 2,
    STYLE: 1 << 3,
    ALL: (1 << 4) - 1,
});

const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);

function normalizeHex(value) {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
}

function normalizeFont(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[^A-Za-z0-9 .,'&+-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function normalizeStyle(value) {
    return VALID_STYLES.has(value) ? value : '';
}

function resolveFieldMask(value, fallback = CHARACTER_STYLE_FIELD_MASKS.ALL) {
    const candidate = typeof value === 'number'
        ? value
        : value?.fields ?? value?.fieldMask ?? value?.mask;
    if (!Number.isInteger(candidate) || candidate < 0) return fallback;
    return candidate & CHARACTER_STYLE_FIELD_MASKS.ALL;
}

function inferFieldMask(value) {
    let fields = 0;
    if (Object.hasOwn(value, 'baseColor')) fields |= CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR;
    if (Object.hasOwn(value, 'gradient')) fields |= CHARACTER_STYLE_FIELD_MASKS.GRADIENT;
    if (Object.hasOwn(value, 'font')) fields |= CHARACTER_STYLE_FIELD_MASKS.FONT;
    if (Object.hasOwn(value, 'style')) fields |= CHARACTER_STYLE_FIELD_MASKS.STYLE;
    return fields;
}

export function captureCharacterStyle(entry, options = CHARACTER_STYLE_FIELD_MASKS.ALL) {
    const requestedFields = resolveFieldMask(options);
    const payload = {
        kind: CHARACTER_STYLE_KIND,
        version: CHARACTER_STYLE_VERSION,
        fields: requestedFields,
    };

    if (requestedFields & CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR) {
        const baseColor = normalizeHex(entry?.baseColor);
        if (baseColor) payload.baseColor = baseColor;
        else payload.fields &= ~CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR;
    }
    if (requestedFields & CHARACTER_STYLE_FIELD_MASKS.GRADIENT) {
        payload.gradient = cloneGradient(entry?.gradient);
    }
    if (requestedFields & CHARACTER_STYLE_FIELD_MASKS.FONT) {
        payload.font = normalizeFont(entry?.font);
    }
    if (requestedFields & CHARACTER_STYLE_FIELD_MASKS.STYLE) {
        payload.style = normalizeStyle(entry?.style);
    }
    return payload;
}

export function normalizeCharacterStyle(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.kind && value.kind !== CHARACTER_STYLE_KIND) return null;
    if (value.version && value.version !== CHARACTER_STYLE_VERSION) return null;

    const hasExplicitMask = Number.isInteger(value.fields ?? value.fieldMask ?? value.mask);
    let fields = hasExplicitMask ? resolveFieldMask(value, 0) : inferFieldMask(value);
    const payload = {
        kind: CHARACTER_STYLE_KIND,
        version: CHARACTER_STYLE_VERSION,
        fields,
    };

    if (fields & CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR) {
        const baseColor = normalizeHex(value.baseColor);
        if (baseColor) payload.baseColor = baseColor;
        else fields &= ~CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR;
    }
    if (fields & CHARACTER_STYLE_FIELD_MASKS.GRADIENT) {
        if (value.gradient === null) {
            payload.gradient = null;
        } else {
            const gradient = normalizeGradient(value.gradient);
            if (gradient) payload.gradient = cloneGradient(gradient);
            else fields &= ~CHARACTER_STYLE_FIELD_MASKS.GRADIENT;
        }
    }
    if (fields & CHARACTER_STYLE_FIELD_MASKS.FONT) payload.font = normalizeFont(value.font);
    if (fields & CHARACTER_STYLE_FIELD_MASKS.STYLE) payload.style = normalizeStyle(value.style);
    payload.fields = fields;
    return payload;
}

export function applyCharacterStyle(entry, value, options = CHARACTER_STYLE_FIELD_MASKS.ALL) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const payload = normalizeCharacterStyle(value);
    if (!payload) return [];

    const fields = payload.fields & resolveFieldMask(options);
    const changedFields = [];
    if ((fields & CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR) && entry.baseColor !== payload.baseColor) {
        entry.baseColor = payload.baseColor;
        changedFields.push('baseColor');
    }
    if (fields & CHARACTER_STYLE_FIELD_MASKS.GRADIENT) {
        const gradient = cloneGradient(payload.gradient);
        if (JSON.stringify(entry.gradient ?? null) !== JSON.stringify(gradient)) {
            entry.gradient = gradient;
            changedFields.push('gradient');
        }
    }
    if ((fields & CHARACTER_STYLE_FIELD_MASKS.FONT) && entry.font !== payload.font) {
        entry.font = payload.font;
        changedFields.push('font');
    }
    if ((fields & CHARACTER_STYLE_FIELD_MASKS.STYLE) && entry.style !== payload.style) {
        entry.style = payload.style;
        changedFields.push('style');
    }
    return changedFields;
}
