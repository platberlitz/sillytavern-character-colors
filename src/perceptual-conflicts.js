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
export const PERCEPTUAL_CONFLICT_LIMITS = Object.freeze({
    maxModes: 5,
    maxModeInputs: 12,
    maxGradientSamples: 12,
    maxItems: 512,
    maxComparisonsPerMode: 512,
    maxConflictsPerMode: 128,
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
    const requested = Number.isFinite(number) ? Math.floor(number) : PERCEPTUAL_CONFLICT_THRESHOLDS.gradientSampleCount;
    return Math.max(2, Math.min(PERCEPTUAL_CONFLICT_LIMITS.maxGradientSamples, requested));
}

export function sampleGradient(entry, options = {}) {
    const sampleCount = normalizeSampleCount(options.sampleCount);
    if (options.signal?.aborted) return [];
    const resolved = resolveVisual(entry, { colorVision: options.colorVision });
    const samples = [];
    for (let index = 0; index < sampleCount; index++) {
        if (options.signal?.aborted) break;
        const offset = index / (sampleCount - 1);
        samples.push({
            offset,
            position: offset * 100,
            color: interpolateStops(resolved.canvasStops, offset),
        });
    }
    return samples;
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

function normalizeBoundedLimit(value, fallback, maximum, minimum = 1) {
    const number = Number(value);
    const requested = Number.isFinite(number) ? Math.floor(number) : fallback;
    return Math.max(minimum, Math.min(maximum, requested));
}

function normalizeConflictItem(item, fallbackId, index) {
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
}

function selectBoundedItemIndexes(itemCount, itemLimit) {
    const selectedCount = Math.min(itemCount, itemLimit);
    if (selectedCount <= 0) return [];
    if (selectedCount === itemCount) return Array.from({ length: selectedCount }, (_, index) => index);
    if (selectedCount === 1) return [0];
    return Array.from({ length: selectedCount }, (_, index) => (
        Math.round((index * (itemCount - 1)) / (selectedCount - 1))
    ));
}

function normalizeConflictItems(value, options = {}) {
    const items = [];
    const isArray = Array.isArray(value);
    const keys = !isArray && value && typeof value === 'object' ? Object.keys(value) : [];
    const requestedItemCount = isArray ? value.length : keys.length;
    const selectedIndexes = options.signal?.aborted
        ? []
        : selectBoundedItemIndexes(requestedItemCount, PERCEPTUAL_CONFLICT_LIMITS.maxItems);
    let cancelled = options.signal?.aborted === true;
    for (const sourceIndex of selectedIndexes) {
        if (options.signal?.aborted) {
            cancelled = true;
            break;
        }
        const fallbackId = isArray ? String(sourceIndex + 1) : keys[sourceIndex];
        const item = isArray ? value[sourceIndex] : value[fallbackId];
        items.push(normalizeConflictItem(item, fallbackId, sourceIndex));
    }
    return {
        items,
        requestedItemCount,
        omittedItemCount: Math.max(0, requestedItemCount - items.length),
        limitOmittedItemCount: Math.max(0, requestedItemCount - PERCEPTUAL_CONFLICT_LIMITS.maxItems),
        cancelled,
        samplingStrategy: cancelled
            ? 'cancelled'
            : requestedItemCount > PERCEPTUAL_CONFLICT_LIMITS.maxItems
                ? 'evenly-spaced-input-order'
                : 'all-input-items',
    };
}

function normalizeReportModes(value, cvdSeverity) {
    const requested = Array.isArray(value) && value.length ? value : COLOR_VISION_MODES;
    const normalized = [];
    const seen = new Set();
    const inputLimit = Math.min(requested.length, PERCEPTUAL_CONFLICT_LIMITS.maxModeInputs);
    let extraUniqueMode = false;
    for (let index = 0; index < inputLimit; index++) {
        const item = requested[index];
        const simulation = typeof item === 'string' && item !== 'none'
            ? normalizeColorVisionSimulation({ mode: item, severity: cvdSeverity })
            : normalizeColorVisionSimulation(item);
        const key = `${simulation.mode}:${simulation.severity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (normalized.length < PERCEPTUAL_CONFLICT_LIMITS.maxModes) normalized.push(simulation);
        else extraUniqueMode = true;
    }
    return {
        simulations: normalized,
        truncated: requested.length > inputLimit || extraUniqueMode,
    };
}

function buildComparisonSchedule(itemCount, requestedLimit) {
    const possibleCount = (itemCount * (itemCount - 1)) / 2;
    if (possibleCount <= 0) return { pairs: [], possibleCount, coverageCount: 0, limit: 0 };
    const coverageCount = Math.min(
        Math.ceil(itemCount / 2),
        PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode,
    );
    const limit = Math.min(
        possibleCount,
        PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode,
        Math.max(coverageCount, requestedLimit),
    );
    const pairs = [];
    const seen = new Set();
    const add = (first, second) => {
        if (first === second || pairs.length >= limit) return;
        const left = Math.min(first, second);
        const right = Math.max(first, second);
        const key = `${left}:${right}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push([left, right]);
    };

    for (let index = 0; index + 1 < itemCount; index += 2) add(index, index + 1);
    if (itemCount % 2 === 1 && itemCount > 1) add(itemCount - 1, 0);
    for (let left = 0; left < itemCount && pairs.length < limit; left++) {
        for (let right = left + 1; right < itemCount && pairs.length < limit; right++) add(left, right);
    }
    return { pairs, possibleCount, coverageCount, limit };
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
    const normalizedItems = normalizeConflictItems(value, { signal: options.signal });
    const items = normalizedItems.items;
    const sampleCount = normalizeSampleCount(options.sampleCount);
    const rawConflictDeltaE = Number(options.conflictDeltaE);
    const rawStrongConflictDeltaE = Number(options.strongConflictDeltaE);
    const conflictDeltaE = Number.isFinite(rawConflictDeltaE) && rawConflictDeltaE >= 0
        ? Math.min(100, rawConflictDeltaE)
        : PERCEPTUAL_CONFLICT_THRESHOLDS.conflictDeltaE;
    const strongConflictDeltaE = Number.isFinite(rawStrongConflictDeltaE) && rawStrongConflictDeltaE >= 0
        ? Math.min(rawStrongConflictDeltaE, conflictDeltaE)
        : Math.min(PERCEPTUAL_CONFLICT_THRESHOLDS.strongConflictDeltaE, conflictDeltaE);
    const rawCvdSeverity = Number(options.cvdSeverity);
    const cvdSeverity = Number.isFinite(rawCvdSeverity) ? Math.max(0, Math.min(1, rawCvdSeverity)) : 1;
    const normalizedModes = normalizeReportModes(options.modes, cvdSeverity);
    const simulations = normalizedModes.simulations;
    const requestedComparisonLimit = normalizeBoundedLimit(options.comparisonLimit, PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode, PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode);
    const comparisonSchedule = buildComparisonSchedule(items.length, requestedComparisonLimit);
    const possibleComparisonCount = comparisonSchedule.possibleCount;
    const comparisonLimit = comparisonSchedule.limit;
    const conflictLimit = normalizeBoundedLimit(options.conflictLimit, PERCEPTUAL_CONFLICT_LIMITS.maxConflictsPerMode, PERCEPTUAL_CONFLICT_LIMITS.maxConflictsPerMode);
    const thresholds = {
        version: PERCEPTUAL_CONFLICT_THRESHOLDS.version,
        conflictDeltaE,
        strongConflictDeltaE,
        gradientSampleCount: sampleCount,
    };
    const modes = simulations.map(simulation => {
        const sampledItems = [];
        let cancelled = normalizedItems.cancelled || options.signal?.aborted === true;
        if (!cancelled) {
            for (const item of items) {
                if (options.signal?.aborted) {
                    cancelled = true;
                    break;
                }
                const samples = sampleGradient(item.visual, {
                    sampleCount,
                    colorVision: simulation,
                    signal: options.signal,
                });
                if (samples.length !== sampleCount) {
                    cancelled = true;
                    break;
                }
                const oklabSamples = [];
                for (const sample of samples) {
                    if (options.signal?.aborted) {
                        cancelled = true;
                        break;
                    }
                    oklabSamples.push(colorToOklab(sample.color));
                }
                if (cancelled || oklabSamples.length !== samples.length) break;
                sampledItems.push({
                    ...copyIdentity(item),
                    samples,
                    oklabSamples,
                });
            }
        }
        const modeSchedule = sampledItems.length === items.length
            ? comparisonSchedule
            : buildComparisonSchedule(sampledItems.length, requestedComparisonLimit);
        const conflicts = [];
        let comparisonCount = 0;
        let comparisonsTruncated = false;
        let conflictsTruncated = false;

        const participatingItems = new Set();
        for (const [leftIndex, rightIndex] of modeSchedule.pairs) {
            if (options.signal?.aborted) {
                cancelled = true;
                comparisonsTruncated = true;
                break;
            }
            comparisonCount++;
            participatingItems.add(leftIndex);
            participatingItems.add(rightIndex);
            const left = sampledItems[leftIndex];
            const right = sampledItems[rightIndex];
            const closest = compareSamples(left, right);
            if (!closest || closest.deltaE > conflictDeltaE) continue;
            if (conflicts.length >= conflictLimit) {
                conflictsTruncated = true;
                continue;
            }
            const deltaE = Number(closest.deltaE.toFixed(3));
            conflicts.push({
                type: 'similarity',
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
        if (comparisonCount < possibleComparisonCount) comparisonsTruncated = true;
        const omittedItemCount = Math.max(0, normalizedItems.requestedItemCount - sampledItems.length);

        return {
            ...simulation,
            itemCount: normalizedItems.requestedItemCount,
            sampledItemCount: sampledItems.length,
            omittedItemCount,
            comparisonCount,
            possibleComparisonCount,
            unexaminedComparisonCount: Math.max(0, possibleComparisonCount - comparisonCount),
            participatingItemCount: sampledItems.length < 2 ? sampledItems.length : participatingItems.size,
            items: sampledItems.map(item => ({ ...copyIdentity(item), samples: item.samples })),
            conflicts,
            truncated: {
                items: omittedItemCount > 0,
                comparisons: comparisonsTruncated,
                conflicts: conflictsTruncated,
                cancelled,
            },
        };
    });

    const conflicts = [];
    let comparisonCountPerMode = modes.length ? Number.POSITIVE_INFINITY : 0;
    let maximumComparisonCountPerMode = 0;
    let comparisonsTruncated = false;
    let conflictsTruncated = false;
    let cancelled = normalizedItems.cancelled;
    let sampledItemCountPerMode = modes.length ? Number.POSITIVE_INFINITY : 0;
    for (const mode of modes) {
        comparisonCountPerMode = Math.min(comparisonCountPerMode, mode.comparisonCount);
        maximumComparisonCountPerMode = Math.max(maximumComparisonCountPerMode, mode.comparisonCount);
        sampledItemCountPerMode = Math.min(sampledItemCountPerMode, mode.sampledItemCount);
        comparisonsTruncated = comparisonsTruncated || mode.truncated.comparisons;
        conflictsTruncated = conflictsTruncated || mode.truncated.conflicts;
        cancelled = cancelled || mode.truncated.cancelled;
        for (const conflict of mode.conflicts) {
            conflicts.push({ mode: mode.mode, severity: mode.severity, ...conflict });
        }
    }

    const unexaminedComparisonCountPerMode = Math.max(0, possibleComparisonCount - comparisonCountPerMode);
    const modeOmittedItemCount = Math.max(0, normalizedItems.requestedItemCount - sampledItemCountPerMode);
    const truncated = {
        items: normalizedItems.omittedItemCount > 0 || modeOmittedItemCount > 0,
        modes: normalizedModes.truncated,
        comparisons: comparisonsTruncated,
        conflicts: conflictsTruncated,
        cancelled,
    };
    return {
        version: PERCEPTUAL_CONFLICT_REPORT_VERSION,
        thresholds,
        limits: {
            itemLimit: PERCEPTUAL_CONFLICT_LIMITS.maxItems,
            requestedComparisonLimit,
            comparisonLimit,
            conflictLimit,
            maxGradientSamples: PERCEPTUAL_CONFLICT_LIMITS.maxGradientSamples,
        },
        itemCount: normalizedItems.requestedItemCount,
        analyzedItemCount: items.length,
        sampledItemCountPerMode,
        omittedItemCount: normalizedItems.omittedItemCount,
        limitOmittedItemCount: normalizedItems.limitOmittedItemCount,
        sampling: {
            strategy: normalizedItems.samplingStrategy,
            requestedItemCount: normalizedItems.requestedItemCount,
            analyzedItemCount: items.length,
            omittedItemCount: normalizedItems.omittedItemCount,
        },
        possibleComparisonCountPerMode: possibleComparisonCount,
        comparisonCountPerMode,
        maximumComparisonCountPerMode,
        unexaminedComparisonCountPerMode,
        coverageComparisonCountPerMode: comparisonSchedule.coverageCount,
        allAnalyzedItemsParticipate: modes.every(mode => mode.participatingItemCount === items.length),
        allItemsParticipate: normalizedItems.omittedItemCount === 0
            && !cancelled
            && modes.every(mode => mode.participatingItemCount === normalizedItems.requestedItemCount),
        modes,
        truncated,
        partial: Object.values(truncated).some(Boolean),
        conflicts,
    };
}
