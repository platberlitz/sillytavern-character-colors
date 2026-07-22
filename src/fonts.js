// fonts.js - extracted from index.js (mechanical split)
import { buildColorFontLookup, buildColorRenderingLookup, refreshTransientNarratorCount, resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { applyGradientText, clearGradientText, getVisualRenderState } from './gradient-rendering.js';
import { getContext } from './st-api.js';
import { characterColors, loadedGoogleFonts, settings } from './state.js';
import { applyTextStyle, clearTextStyle, TEXT_STYLE_MARKER_ATTRIBUTE } from './text-style-rendering.js';
import { getGoogleFontFamily, normalizeGoogleFontName, normalizeHexColor } from './utils.js';

const invalidGoogleFontNames = new Set(['']);

export function loadGoogleFont(fontName) {
    const rawName = String(fontName ?? '');
    if (invalidGoogleFontNames.has(rawName)) return '';
    const normalized = normalizeGoogleFontName(rawName);
    if (!normalized) invalidGoogleFontNames.add(rawName);
    if (!normalized || typeof document === 'undefined' || !document.head) return normalized;
    const key = normalized.toLowerCase();
    if (loadedGoogleFonts.has(key)) return normalized;
    loadedGoogleFonts.add(key);
    const family = encodeURIComponent(normalized).replace(/%20/g, '+');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
    link.dataset.dcGoogleFont = key;
    link.onerror = () => {
        const fallback = document.createElement('link');
        fallback.rel = 'stylesheet';
        fallback.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
        fallback.dataset.dcGoogleFontFallback = key;
        document.head.appendChild(fallback);
    };
    document.head.appendChild(link);
    return normalized;
}

export let customFontRefreshTimer = null;

function clearCustomFontOnly(fontEl) {
    if (!fontEl?.hasAttribute?.('data-dc-font')) return false;
    fontEl.style.fontFamily = '';
    if (!fontEl.getAttribute('style')) fontEl.removeAttribute('style');
    fontEl.removeAttribute('data-dc-font');
    return true;
}

export function clearCustomFontTag(fontEl) {
    if (!fontEl) return false;
    let changed = clearGradientText(fontEl);
    if (clearTextStyle(fontEl)) changed = true;
    if (clearCustomFontOnly(fontEl)) changed = true;
    if (fontEl.hasAttribute('data-dc-preview-color')) {
        fontEl.style.color = '';
        fontEl.removeAttribute('data-dc-preview-color');
        changed = true;
    }
    if (fontEl.hasAttribute('data-dc-aria-label')) {
        fontEl.removeAttribute('aria-label');
        fontEl.removeAttribute('data-dc-aria-label');
        changed = true;
    }
    if (fontEl.hasAttribute('data-dc-speaker-name')) {
        fontEl.removeAttribute('data-dc-speaker-name');
        changed = true;
    }
    return changed;
}

export function clearCustomFontsFromFontTags(root = document) {
    let changed = false;
    root?.querySelectorAll?.(`font[data-dc-font], font[data-dc-gradient], font[${TEXT_STYLE_MARKER_ATTRIBUTE}], font[data-dc-aria-label], font[data-dc-speaker-name], font[data-dc-preview-color]`).forEach(fontEl => {
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
            if (fontEl.style.fontFamily !== family) {
                fontEl.style.fontFamily = family;
                changed = true;
            }
            if (!fontEl.hasAttribute('data-dc-font')) {
                fontEl.setAttribute('data-dc-font', '1');
                changed = true;
            }
        } else if (clearCustomFontOnly(fontEl)) {
            changed = true;
        }
        const textStyleResult = applyTextStyle(fontEl, rendering?.entry?.style);
        if (textStyleResult.changed) changed = true;
        if (rendering?.entry) {
            const displayColor = getVisualRenderState(rendering.entry, { target: 'chat' }).fallbackColor;
            if (fontEl.style.color !== displayColor) {
                fontEl.style.color = displayColor;
                changed = true;
            }
            fontEl.setAttribute('data-dc-preview-color', '1');
        } else if (fontEl.hasAttribute('data-dc-preview-color')) {
            fontEl.style.color = '';
            fontEl.removeAttribute('data-dc-preview-color');
            changed = true;
        }
        const gradientResult = applyGradientText(fontEl, rendering?.entry, { target: 'chat' });
        if (gradientResult.changed) changed = true;
        const generatedLabel = rendering?.entry?.name ? `${rendering.entry.name}: ${fontEl.textContent.trim()}` : '';
        const generatedSpeakerName = rendering?.entry?.name || '';
        if (generatedSpeakerName) {
            if (fontEl.getAttribute('data-dc-speaker-name') !== generatedSpeakerName) {
                fontEl.setAttribute('data-dc-speaker-name', generatedSpeakerName);
                changed = true;
            }
        } else if (fontEl.hasAttribute('data-dc-speaker-name')) {
            fontEl.removeAttribute('data-dc-speaker-name');
            changed = true;
        }
        const ownsAriaLabel = fontEl.hasAttribute('data-dc-aria-label');
        if (generatedLabel && (!fontEl.hasAttribute('aria-label') || ownsAriaLabel)) {
            if (fontEl.getAttribute('aria-label') !== generatedLabel) {
                fontEl.setAttribute('aria-label', generatedLabel);
                changed = true;
            }
            fontEl.setAttribute('data-dc-aria-label', '1');
        } else if (!generatedLabel && ownsAriaLabel) {
            fontEl.removeAttribute('aria-label');
            fontEl.removeAttribute('data-dc-aria-label');
            changed = true;
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
            nameEl.style.color = '';
            nameEl.style.fontFamily = '';
        }
        const avatarImg = card.querySelector('.avatar img');
        if (avatarImg) {
            avatarImg.style.boxShadow = '';
            avatarImg.style.borderColor = '';
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
            nameEl.style.color = color;
            applyGradientText(nameEl, entry, { target: 'chat' });
            
            // Apply custom font if set
            if (entry.font) {
                loadGoogleFont(entry.font);
                nameEl.style.fontFamily = getGoogleFontFamily(entry.font);
            } else {
                nameEl.style.fontFamily = '';
            }
            
            // Apply avatar border and shadow ring
            const avatarImg = card.querySelector('.avatar img');
            if (avatarImg) {
                avatarImg.style.borderColor = color;
                avatarImg.style.boxShadow = `0 0 6px ${color}`;
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
