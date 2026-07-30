// gradient-rendering.js - shared display-only visual resolution for rendered text.
import { registerGradientAnimationElement, refreshGradientAnimationState } from './animation-controller.js';
import { normalizeColorVisionSimulation } from './color-vision.js';
import { normalizeGradient } from './gradients.js';
import { settings } from './state.js';
import { resolveVisual } from './visual-resolver.js';

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

export function getColorVisionSimulationForTarget(target = 'chat', sourceSettings = settings) {
    const previewTarget = ['ui', 'chat', 'all'].includes(sourceSettings?.colorVisionPreviewTarget)
        ? sourceSettings.colorVisionPreviewTarget
        : 'all';
    const applies = previewTarget === 'all' || previewTarget === target;
    const severity = Math.max(0, Math.min(100, Number(sourceSettings?.colorVisionPreviewSeverity) || 0)) / 100;
    return normalizeColorVisionSimulation({
        mode: applies ? sourceSettings?.colorVisionPreviewMode : 'none',
        severity: applies ? severity : 0,
    });
}

export function getVisualRenderState(entry, options = {}) {
    const sourceSettings = options.settings || settings;
    const colorVision = options.colorVision === undefined
        ? getColorVisionSimulationForTarget(options.target || 'chat', sourceSettings)
        : normalizeColorVisionSimulation(options.colorVision);
    return resolveVisual(entry, {
        colorVision,
        animateAllGradients: sourceSettings.driftAllGradientColors === true,
        reducedMotion: options.reducedMotion === true,
    });
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

export function getGradientRenderState(entry, options = {}) {
    const gradient = normalizeGradient(entry?.gradient);
    const visual = getVisualRenderState(entry, options);
    if (!gradient || !visual.gradientCss) return null;
    const animationEnabled = options.allowAnimation === false ? false : visual.effectiveAnimation.enabled;
    return {
        css: visual.gradientCss,
        fallbackColor: visual.fallbackColor,
        type: gradient.type,
        animationEnabled,
        durationSeconds: visual.effectiveAnimation.durationSeconds,
        reverse: visual.effectiveAnimation.reverse,
        signature: `${visual.signature}:${animationEnabled ? 1 : 0}`,
    };
}

export function clearGradientText(element) {
    if (!element) return false;
    let changed = false;
    for (const className of [GRADIENT_TEXT_CLASS, GRADIENT_ANIMATED_CLASS, 'dc-gradient-running', GRADIENT_REVERSE_CLASS, GRADIENT_HIGHLIGHT_CLASS]) {
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
    if (changed) refreshGradientAnimationState();
    return changed;
}

export function applyGradientText(element, entry, options = {}) {
    const state = getGradientRenderState(entry, options);
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

    // Registration is idempotent, but the refresh strips and re-adds
    // dc-gradient-running on every animated element, which restarts the
    // animation from zero. During streaming this runs several times a second,
    // so it only fires when this element actually changed.
    registerGradientAnimationElement(element);
    if (changed) refreshGradientAnimationState();
    return { applied: true, changed, state };
}
