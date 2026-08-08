// fonts.js - extracted from index.js (mechanical split)
import { buildColorFontLookup, buildColorRenderingLookup, refreshTransientNarratorCount, resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { applyGradientText, clearGradientText, getVisualRenderState } from './gradient-rendering.js';
import { getContext } from './st-api.js';
import { characterColors, loadedGoogleFonts, settings } from './state.js';
import { applyTextStyle, clearTextStyle, TEXT_STYLE_MARKER_ATTRIBUTE } from './text-style-rendering.js';
import { getGoogleFontFamily, normalizeGoogleFontName, normalizeHexColor } from './utils.js';

export const REMOTE_FONT_REQUEST_LIMIT = 16;
const REMOTE_FONT_LINK_SELECTOR = 'link[data-dc-google-font], link[data-dc-google-font-fallback]';
const remoteFontRequests = new Set();
let remoteFontTrackingInitialized = false;

function getRemoteFontLinkKey(link) {
    return normalizeGoogleFontName(link?.dataset?.dcGoogleFont || link?.dataset?.dcGoogleFontFallback).toLowerCase();
}

function initializeRemoteFontTracking() {
    if (remoteFontTrackingInitialized || typeof document === 'undefined') return;
    remoteFontTrackingInitialized = true;
    loadedGoogleFonts.clear();
    const linksByKey = new Map();
    document.querySelectorAll(REMOTE_FONT_LINK_SELECTOR).forEach(link => {
        const key = getRemoteFontLinkKey(link);
        if (!key) {
            link.remove();
            return;
        }
        const existing = linksByKey.get(key);
        if (existing) {
            if (link.hasAttribute('data-dc-google-font-fallback')
                && !existing.hasAttribute('data-dc-google-font-fallback')) {
                existing.remove();
                linksByKey.set(key, link);
            } else {
                link.remove();
            }
            return;
        }
        linksByKey.set(key, link);
    });
    let retainedCount = 0;
    linksByKey.forEach((link, key) => {
        if (retainedCount >= REMOTE_FONT_REQUEST_LIMIT) {
            link.remove();
            loadedGoogleFonts.delete(key);
            return;
        }
        retainedCount++;
        remoteFontRequests.add(key);
        link.dataset.dcGoogleFont = key;
        delete link.dataset.dcGoogleFontFallback;
        link.onload = null;
        link.onerror = null;
        if (link.dataset.dcGoogleFontState !== 'failed') loadedGoogleFonts.add(key);
    });
}

export function syncRemoteFontLoadingPolicy() {
    if (typeof document === 'undefined') return false;
    initializeRemoteFontTracking();
    const enabled = settings.allowRemoteFonts === true;
    document.querySelectorAll(REMOTE_FONT_LINK_SELECTOR).forEach(link => {
        link.disabled = !enabled || link.dataset.dcGoogleFontState === 'failed';
    });
    return enabled;
}

function waitForGoogleFontStylesheet(link, normalized) {
    if (link?.dataset?.dcGoogleFontState !== 'loading' || typeof link.addEventListener !== 'function') {
        return Promise.resolve(normalized);
    }
    return new Promise(resolve => {
        const finish = () => resolve(normalized);
        link.addEventListener('load', finish, { once: true });
        link.addEventListener('error', finish, { once: true });
    });
}

export function loadGoogleFont(fontName, { wait = false } = {}) {
    const normalized = normalizeGoogleFontName(fontName);
    const result = () => wait ? Promise.resolve(normalized) : normalized;
    if (!normalized || settings.allowRemoteFonts !== true || typeof document === 'undefined' || !document.head) return result();
    initializeRemoteFontTracking();
    const key = normalized.toLowerCase();
    const existing = [...document.querySelectorAll(REMOTE_FONT_LINK_SELECTOR)]
        .find(link => getRemoteFontLinkKey(link) === key);
    if (existing) {
        existing.disabled = existing.dataset.dcGoogleFontState === 'failed';
        return wait ? waitForGoogleFontStylesheet(existing, normalized) : normalized;
    }
    if (remoteFontRequests.has(key) || remoteFontRequests.size >= REMOTE_FONT_REQUEST_LIMIT) return result();

    remoteFontRequests.add(key);
    loadedGoogleFonts.add(key);
    const family = encodeURIComponent(normalized).replace(/%20/g, '+');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.referrerPolicy = 'no-referrer';
    link.href = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
    link.dataset.dcGoogleFont = key;
    link.dataset.dcGoogleFontState = 'loading';
    link.onload = () => {
        link.dataset.dcGoogleFontState = 'loaded';
        link.disabled = settings.allowRemoteFonts !== true;
        link.onload = null;
        link.onerror = null;
    };
    link.onerror = () => {
        loadedGoogleFonts.delete(key);
        // Release the request slot so one unreachable font cannot exhaust the
        // budget for every other font. The failed link stays in the document and
        // keeps acting as the dedup guard against re-requesting this family.
        remoteFontRequests.delete(key);
        link.dataset.dcGoogleFontState = 'failed';
        link.disabled = true;
        link.onload = null;
        link.onerror = null;
        console.warn(`[Dialogue Colors] Google Font could not be loaded: ${normalized}`);
    };
    try {
        document.head.appendChild(link);
    } catch (error) {
        loadedGoogleFonts.delete(key);
        remoteFontRequests.delete(key);
        link.dataset.dcGoogleFontState = 'failed';
        console.warn(`[Dialogue Colors] Google Font request could not be started: ${normalized}`, error);
        return result();
    }
    return wait ? waitForGoogleFontStylesheet(link, normalized) : normalized;
}

export let customFontRefreshTimer = null;

const FONT_FAMILY_STATE_ATTRIBUTE = 'data-dc-font';
const PREVIEW_COLOR_STATE_ATTRIBUTE = 'data-dc-preview-color';
const ARIA_LABEL_STATE_ATTRIBUTE = 'data-dc-aria-label';
const SPEAKER_NAME_STATE_ATTRIBUTE = 'data-dc-speaker-name-state';
const CARD_COLOR_STATE_ATTRIBUTE = 'data-dc-card-color-state';
const CARD_FONT_STATE_ATTRIBUTE = 'data-dc-card-font-state';
const CARD_BORDER_STATE_ATTRIBUTE = 'data-dc-card-border-state';
const CARD_SHADOW_STATE_ATTRIBUTE = 'data-dc-card-shadow-state';

function readOwnedStyleState(element, attribute) {
    try {
        const state = JSON.parse(element.getAttribute(attribute) || '');
        if (!state || typeof state !== 'object' || typeof state.applied !== 'string') return null;
        return {
            value: typeof state.value === 'string' ? state.value : '',
            priority: typeof state.priority === 'string' ? state.priority : '',
            applied: state.applied,
            appliedPriority: typeof state.appliedPriority === 'string' ? state.appliedPriority : '',
        };
    } catch (_) {
        return null;
    }
}

function applyOwnedStyle(element, property, value, attribute) {
    const currentValue = element.style.getPropertyValue(property);
    const currentPriority = element.style.getPropertyPriority(property);
    let state = readOwnedStyleState(element, attribute);
    if (!state || currentValue !== state.applied || currentPriority !== state.appliedPriority) {
        state = { value: currentValue, priority: currentPriority, applied: '', appliedPriority: '' };
    }

    element.style.setProperty(property, value);
    state.applied = element.style.getPropertyValue(property);
    state.appliedPriority = element.style.getPropertyPriority(property);
    let changed = currentValue !== state.applied || currentPriority !== state.appliedPriority;
    const encodedState = JSON.stringify(state);
    if (element.getAttribute(attribute) !== encodedState) {
        element.setAttribute(attribute, encodedState);
        changed = true;
    }
    return changed;
}

function clearOwnedStyle(element, property, attribute) {
    if (!element.hasAttribute(attribute)) return false;
    const state = readOwnedStyleState(element, attribute);
    if (state
        && element.style.getPropertyValue(property) === state.applied
        && element.style.getPropertyPriority(property) === state.appliedPriority) {
        if (state.value) element.style.setProperty(property, state.value, state.priority);
        else element.style.removeProperty(property);
    }
    element.removeAttribute(attribute);
    if (!element.getAttribute('style')) element.removeAttribute('style');
    return true;
}

function readOwnedAttributeState(element, stateAttribute) {
    try {
        const state = JSON.parse(element.getAttribute(stateAttribute) || '');
        if (!state || typeof state !== 'object' || typeof state.applied !== 'string') return null;
        return {
            hadValue: state.hadValue === true,
            value: typeof state.value === 'string' ? state.value : '',
            applied: state.applied,
        };
    } catch (_) {
        return null;
    }
}

function applyOwnedAttribute(element, name, value, stateAttribute) {
    const hasValue = element.hasAttribute(name);
    const currentValue = element.getAttribute(name) || '';
    let state = readOwnedAttributeState(element, stateAttribute);
    if (!state || !hasValue || currentValue !== state.applied) {
        state = { hadValue: hasValue, value: currentValue, applied: value };
    } else {
        state.applied = value;
    }

    let changed = false;
    if (!hasValue || currentValue !== value) {
        element.setAttribute(name, value);
        changed = true;
    }
    const encodedState = JSON.stringify(state);
    if (element.getAttribute(stateAttribute) !== encodedState) {
        element.setAttribute(stateAttribute, encodedState);
        changed = true;
    }
    return changed;
}

function clearOwnedAttribute(element, name, stateAttribute) {
    if (!element.hasAttribute(stateAttribute)) return false;
    const state = readOwnedAttributeState(element, stateAttribute);
    if (state && element.hasAttribute(name) && element.getAttribute(name) === state.applied) {
        if (state.hadValue) element.setAttribute(name, state.value);
        else element.removeAttribute(name);
    }
    element.removeAttribute(stateAttribute);
    return true;
}

function clearCustomFontOnly(fontEl) {
    if (!fontEl) return false;
    return clearOwnedStyle(fontEl, 'font-family', FONT_FAMILY_STATE_ATTRIBUTE);
}

export function clearCustomFontTag(fontEl) {
    if (!fontEl) return false;
    let changed = clearGradientText(fontEl);
    if (clearTextStyle(fontEl)) changed = true;
    if (clearCustomFontOnly(fontEl)) changed = true;
    if (clearOwnedStyle(fontEl, 'color', PREVIEW_COLOR_STATE_ATTRIBUTE)) changed = true;
    if (clearOwnedAttribute(fontEl, 'aria-label', ARIA_LABEL_STATE_ATTRIBUTE)) changed = true;
    if (clearOwnedAttribute(fontEl, 'data-dc-speaker-name', SPEAKER_NAME_STATE_ATTRIBUTE)) changed = true;
    return changed;
}

export function clearCustomFontsFromFontTags(root = document) {
    let changed = false;
    root?.querySelectorAll?.(`font[data-dc-font], font[data-dc-gradient], font[${TEXT_STYLE_MARKER_ATTRIBUTE}], font[data-dc-aria-label], font[data-dc-speaker-name-state], font[data-dc-preview-color]`).forEach(fontEl => {
        if (clearCustomFontTag(fontEl)) changed = true;
    });
    return changed;
}

export function applyCustomFontsToFontTags(mesText, rawText = '') {
    const fontTags = Array.from(mesText?.querySelectorAll?.('font[color]') || []);
    if (!fontTags.length) return false;
    const fontByColor = buildColorFontLookup(rawText);
    const renderingByColor = buildColorRenderingLookup(rawText);
    let changed = false;
    for (const fontEl of fontTags) {
        const color = normalizeHexColor(fontEl.getAttribute('color'), null);
        const rendering = color ? renderingByColor.get(color) : null;
        const font = color ? fontByColor.get(color) || '' : '';
        const family = getGoogleFontFamily(font);
        if (family) {
            loadGoogleFont(font);
            if (applyOwnedStyle(fontEl, 'font-family', family, FONT_FAMILY_STATE_ATTRIBUTE)) changed = true;
        } else if (clearCustomFontOnly(fontEl)) {
            changed = true;
        }
        const textStyleResult = applyTextStyle(fontEl, rendering?.entry?.style);
        if (textStyleResult.changed) changed = true;
        if (rendering?.entry) {
            const displayColor = getVisualRenderState(rendering.entry, { target: 'chat' }).fallbackColor;
            if (applyOwnedStyle(fontEl, 'color', displayColor, PREVIEW_COLOR_STATE_ATTRIBUTE)) changed = true;
        } else if (clearOwnedStyle(fontEl, 'color', PREVIEW_COLOR_STATE_ATTRIBUTE)) {
            changed = true;
        }
        const gradientResult = applyGradientText(fontEl, rendering?.entry, { target: 'chat' });
        if (gradientResult.changed) changed = true;
        const generatedLabel = rendering?.entry?.name ? `${rendering.entry.name}: ${fontEl.textContent.trim()}` : '';
        const generatedSpeakerName = rendering?.entry?.name || '';
        const ownsSpeakerName = fontEl.hasAttribute(SPEAKER_NAME_STATE_ATTRIBUTE);
        if (generatedSpeakerName && (!fontEl.hasAttribute('data-dc-speaker-name') || ownsSpeakerName)) {
            if (applyOwnedAttribute(fontEl, 'data-dc-speaker-name', generatedSpeakerName, SPEAKER_NAME_STATE_ATTRIBUTE)) changed = true;
        } else if (!generatedSpeakerName && ownsSpeakerName) {
            if (clearOwnedAttribute(fontEl, 'data-dc-speaker-name', SPEAKER_NAME_STATE_ATTRIBUTE)) changed = true;
        }
        const ownsAriaLabel = fontEl.hasAttribute(ARIA_LABEL_STATE_ATTRIBUTE);
        if (generatedLabel && (!fontEl.hasAttribute('aria-label') || ownsAriaLabel)) {
            if (applyOwnedAttribute(fontEl, 'aria-label', generatedLabel, ARIA_LABEL_STATE_ATTRIBUTE)) changed = true;
        } else if (!generatedLabel && ownsAriaLabel) {
            if (clearOwnedAttribute(fontEl, 'aria-label', ARIA_LABEL_STATE_ATTRIBUTE)) changed = true;
        }
    }
    return changed;
}

export function applyCustomFontsToMessageElement(mesElement, chat = getContext()?.chat || []) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText) return false;
    if (!settings.enabled) return clearCustomFontsFromFontTags(mesText);
    const mesIndex = Number(mesElement.getAttribute?.('mesid'));
    const msg = Number.isFinite(mesIndex) ? chat[mesIndex] : null;
    if (msg?.is_system) return clearCustomFontsFromFontTags(mesText);
    return applyCustomFontsToFontTags(mesText, msg?.mes || mesText.innerHTML || '');
}

export function applyCustomFontsToMessageElements(elements) {
    const targets = Array.from(new Set(Array.from(elements || []).filter(Boolean)));
    if (!targets.length) return false;
    const chat = getContext()?.chat || [];
    let changed = false;
    for (const mesElement of targets) {
        if (applyCustomFontsToMessageElement(mesElement, chat)) changed = true;
    }
    return changed;
}

export function applyCustomFontsToRenderedMessages() {
    refreshTransientNarratorCount(getContext()?.chat || []);
    return applyCustomFontsToMessageElements(document.querySelectorAll('#chat .mes[mesid]'));
}

export let cardStyleTimer = null;

export function scheduleCardStyle(delay = 50) {
    if (cardStyleTimer) clearTimeout(cardStyleTimer);
    cardStyleTimer = setTimeout(() => {
        cardStyleTimer = null;
        styleAllCharacterCards();
    }, Math.max(0, Number(delay) || 0));
}

export function clearSingleCharacterCardStyles(card) {
    if (card.hasAttribute('data-dc-card-styled')) {
        const nameEl = card.querySelector('.ch_name');
        if (nameEl) {
            clearGradientText(nameEl);
            clearOwnedStyle(nameEl, 'color', CARD_COLOR_STATE_ATTRIBUTE);
            clearOwnedStyle(nameEl, 'font-family', CARD_FONT_STATE_ATTRIBUTE);
        }
        const avatarImg = card.querySelector('.avatar img');
        if (avatarImg) {
            clearOwnedStyle(avatarImg, 'box-shadow', CARD_SHADOW_STATE_ATTRIBUTE);
            clearOwnedStyle(avatarImg, 'border-color', CARD_BORDER_STATE_ATTRIBUTE);
        }
        card.removeAttribute('data-dc-card-styled');
    }
}

export function clearAllCharacterCardStyles() {
    const cards = document.querySelectorAll('[data-dc-card-styled]');
    cards.forEach(card => clearSingleCharacterCardStyles(card));
}

export function styleAllCharacterCards() {
    if (!settings.enabled) {
        clearAllCharacterCardStyles();
        return;
    }
    const cards = document.querySelectorAll('.group_member, .character_select');
    cards.forEach(card => {
        const nameEl = card.querySelector('.ch_name');
        if (!nameEl) return;
        const name = nameEl.textContent.trim();
        if (!name) return;
        const key = resolveCharacterKeyByNameOrAlias(name);
        if (key && characterColors[key]) {
            const entry = characterColors[key];
            const color = getVisualRenderState(entry, { target: 'chat' }).fallbackColor;
            
            // Apply name color
            applyOwnedStyle(nameEl, 'color', color, CARD_COLOR_STATE_ATTRIBUTE);
            applyGradientText(nameEl, entry, { target: 'chat' });
            
            // Apply custom font if set
            const fontFamily = getGoogleFontFamily(entry.font);
            if (fontFamily) {
                loadGoogleFont(entry.font);
                applyOwnedStyle(nameEl, 'font-family', fontFamily, CARD_FONT_STATE_ATTRIBUTE);
            } else {
                clearOwnedStyle(nameEl, 'font-family', CARD_FONT_STATE_ATTRIBUTE);
            }
            
            // Apply avatar border and shadow ring
            const avatarImg = card.querySelector('.avatar img');
            if (avatarImg) {
                applyOwnedStyle(avatarImg, 'border-color', color, CARD_BORDER_STATE_ATTRIBUTE);
                applyOwnedStyle(avatarImg, 'box-shadow', `0 0 6px ${color}`, CARD_SHADOW_STATE_ATTRIBUTE);
            }
            
            // Mark with a data attribute so we know it's styled by us
            card.setAttribute('data-dc-card-styled', 'true');
        } else {
            // If it was styled before but no longer has a color, clear it!
            clearSingleCharacterCardStyles(card);
        }
    });
}

export function scheduleCustomFontRefresh(delay = 0) {
    clearTimeout(customFontRefreshTimer);
    customFontRefreshTimer = setTimeout(() => {
        customFontRefreshTimer = null;
        applyCustomFontsToRenderedMessages();
        scheduleCardStyle(0);
    }, Math.max(0, Number(delay) || 0));
}
