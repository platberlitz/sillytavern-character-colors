// gradient-rendering.js - shared DOM markers and CSS variables for gradient text.
import { buildGradientCss, getGradientSignature, normalizeGradient } from './gradients.js';

export const GRADIENT_TEXT_CLASS = 'dc-gradient-text';
export const GRADIENT_ANIMATED_CLASS = 'dc-gradient-animated';
export const GRADIENT_REVERSE_CLASS = 'dc-gradient-reverse';
export const GRADIENT_HIGHLIGHT_CLASS = 'dc-gradient-highlight';

export const GRADIENT_STYLE_PROPERTIES = Object.freeze([
    '--dc-gradient',
    '--dc-gradient-fallback',
    '--dc-gradient-animation-enabled',
    '--dc-gradient-duration',
    '--dc-gradient-reverse',
    '--dc-gradient-direction',
    '--dc-gradient-highlight',
]);

const GRADIENT_DATA_ATTRIBUTES = Object.freeze([
    'data-dc-gradient',
    'data-dc-gradient-animation',
    'data-dc-gradient-reverse',
]);

function normalizeFallbackColor(entry) {
    const color = String(entry?.color ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    const baseColor = String(entry?.baseColor ?? '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(baseColor) ? baseColor : '#888888';
}

function setClass(element, className, enabled) {
    const hasClass = element.classList.contains(className);
    if (hasClass === enabled) return false;
    element.classList.toggle(className, enabled);
    return true;
}

function setAttribute(element, name, value) {
    if (element.getAttribute(name) === value) return false;
    element.setAttribute(name, value);
    return true;
}

function setStyleProperty(element, name, value) {
    if (element.style.getPropertyValue(name) === value) return false;
    element.style.setProperty(name, value);
    return true;
}

export function getGradientRenderState(entry) {
    const gradient = normalizeGradient(entry?.gradient);
    const css = buildGradientCss(entry);
    if (!gradient || !css) return null;
    return {
        css,
        fallbackColor: normalizeFallbackColor(entry),
        type: gradient.type,
        animationEnabled: gradient.animation.enabled,
        durationSeconds: gradient.animation.duration,
        reverse: gradient.animation.reverse,
        signature: getGradientSignature(entry),
    };
}

export function clearGradientText(element) {
    if (!element) return false;
    let changed = false;
    for (const className of [GRADIENT_TEXT_CLASS, GRADIENT_ANIMATED_CLASS, GRADIENT_REVERSE_CLASS, GRADIENT_HIGHLIGHT_CLASS]) {
        if (element.classList.contains(className)) {
            element.classList.remove(className);
            changed = true;
        }
    }
    for (const attribute of GRADIENT_DATA_ATTRIBUTES) {
        if (element.hasAttribute(attribute)) {
            element.removeAttribute(attribute);
            changed = true;
        }
    }
    for (const property of GRADIENT_STYLE_PROPERTIES) {
        if (element.style.getPropertyValue(property)) {
            element.style.removeProperty(property);
            changed = true;
        }
    }
    if (!element.getAttribute('style')) element.removeAttribute('style');
    return changed;
}

export function applyGradientText(element, entry, options = {}) {
    const state = getGradientRenderState(entry);
    if (!element || !state) {
        return { applied: false, changed: clearGradientText(element), state: null };
    }

    const highlightColor = String(options.highlightColor ?? '').trim();
    let changed = false;
    changed = setClass(element, GRADIENT_TEXT_CLASS, true) || changed;
    changed = setClass(element, GRADIENT_ANIMATED_CLASS, state.animationEnabled) || changed;
    changed = setClass(element, GRADIENT_REVERSE_CLASS, state.reverse) || changed;
    changed = setClass(element, GRADIENT_HIGHLIGHT_CLASS, !!highlightColor) || changed;
    changed = setAttribute(element, 'data-dc-gradient', state.type) || changed;
    changed = setAttribute(element, 'data-dc-gradient-animation', state.animationEnabled ? 'on' : 'off') || changed;
    changed = setAttribute(element, 'data-dc-gradient-reverse', state.reverse ? 'true' : 'false') || changed;
    changed = setStyleProperty(element, '--dc-gradient', state.css) || changed;
    changed = setStyleProperty(element, '--dc-gradient-fallback', state.fallbackColor) || changed;
    changed = setStyleProperty(element, '--dc-gradient-animation-enabled', state.animationEnabled ? '1' : '0') || changed;
    changed = setStyleProperty(element, '--dc-gradient-duration', `${state.durationSeconds}s`) || changed;
    changed = setStyleProperty(element, '--dc-gradient-reverse', state.reverse ? '1' : '0') || changed;
    changed = setStyleProperty(element, '--dc-gradient-direction', state.reverse ? 'alternate-reverse' : 'alternate') || changed;
    if (highlightColor) {
        changed = setStyleProperty(element, '--dc-gradient-highlight', highlightColor) || changed;
    } else if (element.style.getPropertyValue('--dc-gradient-highlight')) {
        element.style.removeProperty('--dc-gradient-highlight');
        changed = true;
    }

    return { applied: true, changed, state };
}
