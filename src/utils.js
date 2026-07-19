// utils.js - extracted from index.js (mechanical split)
import { pruneReducibleCompositeEntries } from './color-blocks.js';
import { escapeHtml } from './st-api.js';
import { settings } from './state.js';

export function escapeAttr(s) {
    return escapeHtml(s);
}

export function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    }
    return fallback;
}

export function normalizeHexColor(value, fallback = '#888888') {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

export function normalizeManualColorInput(value, fallback = null) {
    const color = String(value ?? '').trim();
    const withHash = color.startsWith('#') ? color : `#${color}`;
    return normalizeHexColor(withHash, fallback);
}

export const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);

export function normalizeAliases(aliases) {
    if (!Array.isArray(aliases)) return [];
    return [...new Set(aliases.map(a => String(a ?? '').trim()).filter(Boolean))];
}

export function normalizeGoogleFontName(fontName) {
    const normalized = String(fontName ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized
        .replace(/[^A-Za-z0-9 .,'&+-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

export function getGoogleFontFamily(fontName) {
    const normalized = normalizeGoogleFontName(fontName);
    if (!normalized) return '';
    return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", sans-serif`;
}

export function normalizeCharacterEntry(entry, fallbackName = '') {
    const name = String(entry?.name ?? fallbackName ?? '').trim();
    if (!name) return null;
    const color = normalizeHexColor(entry?.color);
    const baseColor = normalizeHexColor(entry?.baseColor, color);
    return {
        color,
        baseColor,
        name,
        locked: !!entry?.locked,
        keep: !!entry?.keep,
        aliases: normalizeAliases(entry?.aliases),
        style: VALID_STYLES.has(entry?.style) ? entry.style : '',
        dialogueCount: Number.isFinite(entry?.dialogueCount) && entry.dialogueCount > 0 ? Math.floor(entry.dialogueCount) : 0,
        group: String(entry?.group ?? '').trim(),
        font: normalizeGoogleFontName(entry?.font)
    };
}

export function normalizeCharacterColors(rawColors, options = {}) {
    if (!rawColors || typeof rawColors !== 'object') return {};
    const normalized = {};
    for (const [rawKey, entry] of Object.entries(rawColors)) {
        const normalizedEntry = normalizeCharacterEntry(entry, rawKey);
        if (!normalizedEntry) continue;
        const key = normalizedEntry.name.toLowerCase();
        if (!normalized[key]) {
            normalized[key] = normalizedEntry;
            continue;
        }
        const existing = normalized[key];
        existing.locked = existing.locked || normalizedEntry.locked;
        existing.keep = existing.keep || normalizedEntry.keep;
        existing.aliases = [...new Set([...existing.aliases, ...normalizedEntry.aliases])];
        existing.dialogueCount = Math.max(existing.dialogueCount || 0, normalizedEntry.dialogueCount || 0);
        if (!existing.group && normalizedEntry.group) existing.group = normalizedEntry.group;
        if (!existing.style && normalizedEntry.style) existing.style = normalizedEntry.style;
        if (!existing.font && normalizedEntry.font) existing.font = normalizedEntry.font;
        if (existing.baseColor === '#888888' && normalizedEntry.baseColor !== '#888888') existing.baseColor = normalizedEntry.baseColor;
        if (existing.color === '#888888' && normalizedEntry.color !== '#888888') existing.color = normalizedEntry.color;
    }
    return options.pruneCompositeEntries === true ? pruneReducibleCompositeEntries(normalized) : normalized;
}

export const COLOR_CONFLICT_HUE_THRESHOLD = 12;

// Optimized color distance calculation
export const COLOR_CONFLICT_LIGHTNESS_THRESHOLD = 8;

// Optimized color distance calculation
export function colorDistance(color1, color2) {
    const [h1, , l1] = hexToHsl(color1);
    const [h2, , l2] = hexToHsl(color2);
    const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
    return hDiff < COLOR_CONFLICT_HUE_THRESHOLD && Math.abs(l1 - l2) < COLOR_CONFLICT_LIGHTNESS_THRESHOLD;
}

export function hslToHex(h, s, l) {
    l = Math.max(0, Math.min(100, l));
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex) {
    if (!hex || typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [0, 0, 50];
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export const toast = {
    info:    (...a) => !settings.disableToasts && toastr?.info?.(...a),
    success: (...a) => !settings.disableToasts && toastr?.success?.(...a),
    warning: (...a) => !settings.disableToasts && toastr?.warning?.(...a),
    error:   (...a) => toastr?.error?.(...a),
};

export function unwrapCodeFence(text) {
    const cleaned = String(text ?? '').trim();
    const match = cleaned.match(/^```(?:html|xml|markdown|md|text|txt)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : cleaned;
}

export function stripFontTags(text) {
    return String(text ?? '')
        .replace(/<font\b[^>]*>/gi, '')
        .replace(/<\/font>/gi, '');
}

export function stripColorBlocks(text) {
    return String(text ?? '').replace(/\n?\[COLORS?:[^\]]*\]/gi, '');
}

export function getMessageElementByIndex(messageIndex) {
    const index = Number(messageIndex);
    if (!Number.isFinite(index) || index < 0) return null;
    return document.querySelector(`#chat .mes[mesid="${index}"]`)
        || document.querySelector(`.mes[mesid="${index}"]`)
        || document.querySelectorAll('#chat .mes[mesid]')[index]
        || document.querySelectorAll('.mes[mesid]')[index]
        || null;
}

export function parseNameWithNicknames(rawName) {
    const match = rawName.match(/^([^(]+)(.*)$/);
    if (!match) return { name: rawName.trim(), nicknames: [] };
    const name = match[1].trim();
    const nicknames = [...rawName.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).filter(Boolean);
    return { name, nicknames };
}

export function splitCompositeSpeakerName(rawName) {
    const trimmedName = String(rawName ?? '').trim();
    if (!trimmedName) return [];
    const parts = trimmedName
        .split(/\s*(?:&|\/|\+|,|\band\b)\s*/i)
        .map(part => String(part ?? '').trim())
        .filter(Boolean);
    if (parts.length < 2) return [];
    const seen = new Set();
    return parts.filter(part => {
        const key = part.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function isCompositeSpeakerLabel(rawName) {
    return splitCompositeSpeakerName(rawName).length >= 2;
}

export function makeLengthPreservingSearchText(text) {
    return String(text ?? '')
        .replace(/<[^>]+>/g, match => ' '.repeat(match.length))
        .replace(/&(?:[a-z]+|#[0-9]+|#x[0-9a-f]+);/gi, match => ' '.repeat(match.length))
        .replace(/[*_`~]/g, ' ');
}

export function buildMaskedDialogueText(text, segments) {
    const raw = String(text ?? '');
    if (!segments.length) return raw;
    let masked = '';
    let cursor = 0;
    for (const seg of segments) {
        masked += raw.slice(cursor, seg.start);
        masked += ' '.repeat(Math.max(0, seg.end - seg.start));
        cursor = seg.end;
    }
    return masked + raw.slice(cursor);
}

export function getDialogueParagraphRange(text, start, end) {
    const raw = String(text ?? '');
    let rangeStart = 0;
    for (let i = Math.max(0, start) - 1; i >= 0; i--) {
        if (raw[i] === '\n' || raw[i] === '\r') {
            rangeStart = i + 1;
            break;
        }
    }
    let rangeEnd = raw.length;
    for (let i = Math.min(raw.length, end); i < raw.length; i++) {
        if (raw[i] === '\n' || raw[i] === '\r') {
            rangeEnd = i;
            break;
        }
    }
    return { start: rangeStart, end: rangeEnd };
}

export function isSameDialogueParagraph(left, right) {
    return !!left && !!right && left.start === right.start && left.end === right.end;
}

export function getElementPath(root, element) {
    if (!root || !element) return null;
    const path = [];
    let current = element;
    while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) return null;
        const index = Array.prototype.indexOf.call(parent.children, current);
        if (index < 0) return null;
        path.unshift(index);
        current = parent;
    }
    return current === root ? path : null;
}

export function getElementByPath(root, path) {
    if (!root || !Array.isArray(path)) return null;
    let current = root;
    for (const index of path) {
        current = current?.children?.[index];
        if (!current) return null;
    }
    return current;
}

export function captureOpenDetailsState(root) {
    if (!root?.querySelectorAll) return null;
    const allDetails = Array.from(root.querySelectorAll('details'));
    const detailsState = allDetails.map((detailsElement, index) => ({
        path: getElementPath(root, detailsElement),
        index,
        open: detailsElement.open,
    }));
    return detailsState.length ? detailsState : null;
}

export function restoreOpenDetailsState(root, state) {
    if (!root || !state?.length) return false;
    const allDetails = Array.from(root.querySelectorAll('details'));
    let restored = false;
    for (const entry of state) {
        let detailsElement = entry?.path ? getElementByPath(root, entry.path) : null;
        if (!detailsElement || detailsElement.tagName !== 'DETAILS') {
            detailsElement = Number.isFinite(entry?.index) ? allDetails[entry.index] : null;
        }
        if (detailsElement?.tagName === 'DETAILS') {
            detailsElement.open = entry.open === true;
            restored = true;
        }
    }
    return restored;
}

export function hashMessageText(text) {
    const str = String(text ?? '');
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    return hash.toString(36);
}

export function normalizeSegmentText(text) {
    return String(text ?? '')
        .replace(/[\u201c\u201d\u00ab\u00bb\u201e]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u2026/g, '...')
        .replace(/[*_`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function htmlToNode(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html).trim();
    return tpl.content.firstElementChild;
}
