// visual-resolver.js - shared pure output for CSS and canvas visual consumers.
import { buildGradientCss, normalizeGradient } from './gradients.js';
import { normalizeColorVisionSimulation, simulateColorVision } from './color-vision.js';

export const VISUAL_RESOLVER_VERSION = 'dc-visual-resolver-v1';

function normalizeHex(value, fallback = null) {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function buildCanvasStops(gradient, fallbackColor) {
    if (!gradient) {
        return [
            { offset: 0, color: fallbackColor },
            { offset: 1, color: fallbackColor },
        ];
    }
    return [
        { offset: gradient.primaryPosition / 100, color: fallbackColor },
        ...gradient.stops.map(stop => ({ offset: stop.position / 100, color: stop.color })),
    ].sort((left, right) => left.offset - right.offset);
}

export function resolveVisual(entry, options = {}) {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    const colorVision = normalizeColorVisionSimulation(options.colorVision);
    const sourceFallbackColor = normalizeHex(source.color, normalizeHex(source.baseColor, '#888888'));
    const fallbackColor = simulateColorVision(sourceFallbackColor, colorVision);
    const sourceGradient = normalizeGradient(source.gradient);
    const displayGradient = sourceGradient
        ? {
            ...sourceGradient,
            stops: sourceGradient.stops.map(stop => ({
                ...stop,
                color: simulateColorVision(stop.color, colorVision),
            })),
            animation: { ...sourceGradient.animation },
        }
        : null;
    const gradientCss = displayGradient
        ? buildGradientCss({ color: fallbackColor, baseColor: source.baseColor, gradient: displayGradient })
        : null;
    const canvasStops = buildCanvasStops(displayGradient, fallbackColor);
    const animationRequested = !!displayGradient
        && (displayGradient.animation.enabled || options.animateAllGradients === true);
    const effectiveAnimation = {
        enabled: animationRequested && options.reducedMotion !== true,
        requested: animationRequested,
        durationSeconds: displayGradient?.animation.duration ?? 0,
        reverse: displayGradient?.animation.reverse ?? false,
        direction: displayGradient?.animation.reverse ? 'alternate-reverse' : 'alternate',
    };
    const signature = JSON.stringify({
        version: VISUAL_RESOLVER_VERSION,
        colorVision,
        fallbackColor,
        gradientCss,
        canvasStops,
        effectiveAnimation,
    });

    return {
        fallbackColor,
        gradientCss,
        canvasStops,
        effectiveAnimation,
        signature,
    };
}
