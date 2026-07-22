// perceptual-conflicts.js - gradient sampling and generic visual conflict reports.
import { COLOR_VISION_MODES, normalizeColorVisionSimulation } from './color-vision.js';
import { resolveVisual } from './visual-resolver.js';

export const PERCEPTUAL_CONFLICT_REPORT_VERSION = 'dc-perceptual-conflict-v1';
export const PERCEPTUAL_CONFLICT_THRESHOLDS = Object.freeze({
    version: 'dc-perceptual-thresholds-v1',
    conflictDeltaE: 8,
    strongConflictDeltaE: 4,
    gradientSampleCount: 9,
});

function hexToRgb(color) {
    const normalized = /^#[0-9a-fA-F]{6}$/.test(String(color ?? '')) ? String(color).toLowerCase() : '#888888';
    return [
        parseInt(normalized.slice(1, 3), 16),
        parseInt(normalized.slice(3, 5), 16),
        parseInt(normalized.slice(5, 7), 16),
    ];
}

function rgbToHex(channels) {
    return `#${channels
        .map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
        .join('')}`;
}

function interpolateStops(stops, offset) {
    if (offset <= stops[0].offset) return stops[0].color;
    if (offset >= stops[stops.length - 1].offset) return stops[stops.length - 1].color;
    const rightIndex = stops.findIndex(stop => stop.offset >= offset);
    const left = stops[rightIndex - 1];
    const right = stops[rightIndex];
    const width = right.offset - left.offset;
    if (width <= 0) return right.color;
    const progress = (offset - left.offset) / width;
    const leftRgb = hexToRgb(left.color);
    const rightRgb = hexToRgb(right.color);
    return rgbToHex(leftRgb.map((channel, index) => channel + ((rightRgb[index] - channel) * progress)));
}

function normalizeSampleCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(2, Math.floor(number)) : PERCEPTUAL_CONFLICT_THRESHOLDS.gradientSampleCount;
}

export function sampleGradient(entry, options = {}) {
    const sampleCount = normalizeSampleCount(options.sampleCount);
    const resolved = resolveVisual(entry, { colorVision: options.colorVision });
    return Array.from({ length: sampleCount }, (_, index) => {
        const offset = index / (sampleCount - 1);
        return {
            offset,
            position: offset * 100,
            color: interpolateStops(resolved.canvasStops, offset),
        };
    });
}

function srgbToLinear(value) {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function colorToOklab(color) {
    const [red, green, blue] = hexToRgb(color).map(srgbToLinear);
    const lRoot = Math.cbrt((0.4122214708 * red) + (0.5363325363 * green) + (0.0514459929 * blue));
    const mRoot = Math.cbrt((0.2119034982 * red) + (0.6806995451 * green) + (0.1073969566 * blue));
    const sRoot = Math.cbrt((0.0883024619 * red) + (0.2817188376 * green) + (0.6299787005 * blue));
    return [
        (0.2104542553 * lRoot) + (0.793617785 * mRoot) - (0.0040720468 * sRoot),
        (1.9779984951 * lRoot) - (2.428592205 * mRoot) + (0.4505937099 * sRoot),
        (0.0259040371 * lRoot) + (0.7827717662 * mRoot) - (0.808675766 * sRoot),
    ];
}

function oklabDistance(left, right) {
    return Math.sqrt(left.reduce((total, channel, index) => total + ((channel - right[index]) ** 2), 0)) * 100;
}

export function colorDistanceOklab(leftColor, rightColor) {
    return oklabDistance(colorToOklab(leftColor), colorToOklab(rightColor));
}

function normalizeConflictItems(value) {
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index + 1), item])
        : (value && typeof value === 'object' ? Object.entries(value) : []);
    return entries.map(([fallbackId, item], index) => {
        const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        const visualSource = source.visual && typeof source.visual === 'object' ? source.visual : source;
        const id = String(source.id ?? fallbackId ?? `item-${index + 1}`);
        return {
            id,
            label: String(source.label ?? source.name ?? id),
            kind: String(source.kind ?? 'item'),
            visual: {
                baseColor: visualSource.baseColor,
                color: typeof item === 'string' ? item : visualSource.color,
                gradient: visualSource.gradient,
            },
        };
    });
}

function normalizeReportModes(value, cvdSeverity) {
    const requested = Array.isArray(value) && value.length ? value : COLOR_VISION_MODES;
    const normalized = requested.map(item => {
        if (typeof item === 'string' && item !== 'none') {
            return normalizeColorVisionSimulation({ mode: item, severity: cvdSeverity });
        }
        return normalizeColorVisionSimulation(item);
    });
    const seen = new Set();
    return normalized.filter(simulation => {
        const key = `${simulation.mode}:${simulation.severity}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function compareSamples(leftItem, rightItem) {
    let closest = null;
    for (let leftIndex = 0; leftIndex < leftItem.samples.length; leftIndex++) {
        for (let rightIndex = 0; rightIndex < rightItem.samples.length; rightIndex++) {
            const left = leftItem.samples[leftIndex];
            const right = rightItem.samples[rightIndex];
            const deltaE = oklabDistance(leftItem.oklabSamples[leftIndex], rightItem.oklabSamples[rightIndex]);
            if (!closest || deltaE < closest.deltaE) closest = { deltaE, left, right };
        }
    }
    return closest;
}

function copyIdentity(item) {
    return { id: item.id, label: item.label, kind: item.kind };
}

function describeViewingCondition(simulation) {
    if (simulation.mode === 'none') return 'normal color vision';
    return `${simulation.mode} simulation at ${Math.round(simulation.severity * 100)}% severity`;
}

export function createPerceptualConflictReport(value, options = {}) {
    const items = normalizeConflictItems(value);
    const sampleCount = normalizeSampleCount(options.sampleCount);
    const rawConflictDeltaE = Number(options.conflictDeltaE);
    const rawStrongConflictDeltaE = Number(options.strongConflictDeltaE);
    const conflictDeltaE = Number.isFinite(rawConflictDeltaE) && rawConflictDeltaE >= 0
        ? rawConflictDeltaE
        : PERCEPTUAL_CONFLICT_THRESHOLDS.conflictDeltaE;
    const strongConflictDeltaE = Number.isFinite(rawStrongConflictDeltaE) && rawStrongConflictDeltaE >= 0
        ? Math.min(rawStrongConflictDeltaE, conflictDeltaE)
        : Math.min(PERCEPTUAL_CONFLICT_THRESHOLDS.strongConflictDeltaE, conflictDeltaE);
    const rawCvdSeverity = Number(options.cvdSeverity);
    const cvdSeverity = Number.isFinite(rawCvdSeverity) ? Math.max(0, Math.min(1, rawCvdSeverity)) : 1;
    const simulations = normalizeReportModes(options.modes, cvdSeverity);
    const comparisonCount = (items.length * (items.length - 1)) / 2;
    const thresholds = {
        version: PERCEPTUAL_CONFLICT_THRESHOLDS.version,
        conflictDeltaE,
        strongConflictDeltaE,
        gradientSampleCount: sampleCount,
    };
    const modes = simulations.map(simulation => {
        const sampledItems = items.map(item => {
            const samples = sampleGradient(item.visual, { sampleCount, colorVision: simulation });
            return {
                ...copyIdentity(item),
                samples,
                oklabSamples: samples.map(sample => colorToOklab(sample.color)),
            };
        });
        const conflicts = [];

        // Every pair is evaluated; large casts are not silently skipped or truncated.
        for (let leftIndex = 0; leftIndex < sampledItems.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < sampledItems.length; rightIndex++) {
                const left = sampledItems[leftIndex];
                const right = sampledItems[rightIndex];
                const closest = compareSamples(left, right);
                if (!closest || closest.deltaE > conflictDeltaE) continue;
                const deltaE = Number(closest.deltaE.toFixed(3));
                conflicts.push({
                    left: copyIdentity(left),
                    right: copyIdentity(right),
                    level: deltaE <= strongConflictDeltaE ? 'strong' : 'potential',
                    deltaE,
                    samples: {
                        left: { ...closest.left },
                        right: { ...closest.right },
                    },
                    narration: `${left.label} and ${right.label} may be difficult to distinguish under ${describeViewingCondition(simulation)}.`,
                });
            }
        }

        return {
            ...simulation,
            comparisonCount,
            items: sampledItems.map(item => ({ ...copyIdentity(item), samples: item.samples })),
            conflicts,
        };
    });

    return {
        version: PERCEPTUAL_CONFLICT_REPORT_VERSION,
        thresholds,
        itemCount: items.length,
        comparisonCountPerMode: comparisonCount,
        modes,
        conflicts: modes.flatMap(mode => mode.conflicts.map(conflict => ({
            mode: mode.mode,
            severity: mode.severity,
            ...conflict,
        }))),
    };
}
