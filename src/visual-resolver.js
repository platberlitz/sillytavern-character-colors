// visual-resolver.js - shared pure output for CSS and canvas visual consumers.
import { MAX_GRADIENT_RAMP_SAMPLES, MAX_GRADIENT_UNIFORM_SAMPLES, buildGradientCss, getGradientColorStops, normalizeGradient, sampleGradientRamp } from './gradients.js';
import { normalizeColorVisionSimulation, simulateColorVision } from './color-vision.js';

export const VISUAL_RESOLVER_VERSION = 'dc-visual-resolver-v2';

function normalizeHex(value, fallback = null) {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function formatCssNumber(value) {
    return Number(value.toFixed(4)).toString();
}

function buildGradientCssFromStops(gradient, stops) {
    const colorStops = stops.map(stop => `${stop.color} ${formatCssNumber(stop.offset * 100)}%`).join(', ');
    if (gradient.type === 'radial') {
        return `radial-gradient(circle at ${formatCssNumber(gradient.x)}% ${formatCssNumber(gradient.y)}%, ${colorStops})`;
    }
    if (gradient.type === 'conic') {
        return `conic-gradient(from ${formatCssNumber(gradient.angle)}deg at ${formatCssNumber(gradient.x)}% ${formatCssNumber(gradient.y)}%, ${colorStops})`;
    }
    return `linear-gradient(${formatCssNumber(gradient.angle)}deg, ${colorStops})`;
}

export function resolveVisual(entry, options = {}) {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    const colorVision = normalizeColorVisionSimulation(options.colorVision);
    const sourceFallbackColor = normalizeHex(source.color, normalizeHex(source.baseColor, '#888888'));
    const fallbackColor = simulateColorVision(sourceFallbackColor, colorVision);
    const sourceGradient = normalizeGradient(source.gradient);
    const simulationActive = colorVision.mode !== 'none' && colorVision.severity > 0;
    const canvasStops = simulationActive
        ? sampleGradientRamp({ color: sourceFallbackColor, gradient: sourceGradient }, {
            uniformCount: MAX_GRADIENT_UNIFORM_SAMPLES,
            maxSamples: MAX_GRADIENT_RAMP_SAMPLES,
            transformColor: color => simulateColorVision(color, colorVision),
        }).map(({ offset, color }) => ({ offset, color }))
        : getGradientColorStops({ color: sourceFallbackColor, gradient: sourceGradient });
    const hasVisibleGradient = !!sourceGradient && canvasStops.some(stop => stop.color !== fallbackColor);
    const gradientCss = hasVisibleGradient
        ? (simulationActive
            ? buildGradientCssFromStops(sourceGradient, canvasStops)
            : buildGradientCss({ color: sourceFallbackColor, baseColor: source.baseColor, gradient: sourceGradient }))
        : null;
    const animationRequested = hasVisibleGradient
        && (sourceGradient.animation.enabled || options.animateAllGradients === true);
    const effectiveAnimation = {
        enabled: animationRequested && options.reducedMotion !== true,
        requested: animationRequested,
        durationSeconds: sourceGradient?.animation.duration ?? 0,
        reverse: sourceGradient?.animation.reverse ?? false,
        direction: sourceGradient?.animation.reverse ? 'alternate-reverse' : 'alternate',
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
