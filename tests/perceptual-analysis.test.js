import assert from 'node:assert/strict';
import test from 'node:test';

import { simulateColorVision } from '../src/color-vision.js';
import { getGradientRenderState } from '../src/gradient-rendering.js';
import {
    PERCEPTUAL_CONFLICT_LIMITS,
    createPerceptualConflictReport,
    sampleGradient,
} from '../src/perceptual-conflicts.js';
import { resolveVisual } from '../src/visual-resolver.js';

function animatedGradient() {
    return {
        type: 'linear',
        angle: 90,
        x: 50,
        y: 50,
        primaryPosition: 0,
        stops: [{ baseColor: '#ffffff', color: '#ffffff', position: 100 }],
        animation: { enabled: true, duration: 8, reverse: false },
    };
}

function items(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `item-${index}`,
        name: `Item ${index}`,
        color: '#336699',
    }));
}

test('gradient sampling is capped while retaining both endpoints', () => {
    const samples = sampleGradient(
        { color: '#000000', gradient: animatedGradient() },
        { sampleCount: Number.MAX_SAFE_INTEGER },
    );

    assert.equal(samples.length, PERCEPTUAL_CONFLICT_LIMITS.maxUniformGradientSamples);
    assert.ok(samples.length <= PERCEPTUAL_CONFLICT_LIMITS.maxGradientSamples);
    assert.equal(samples[0].offset, 0);
    assert.equal(samples.at(-1).offset, 1);
});

test('gradient sampling includes explicit positions and both sides of hard cuts', () => {
    const samples = sampleGradient({
        color: '#000000',
        gradient: {
            type: 'linear',
            primaryPosition: 0,
            stops: [
                { color: '#ffffff', position: 49.9 },
                { color: '#000000', position: 49.9 },
                { color: '#000000', position: 50.1 },
                { color: '#ffffff', position: 50.1 },
            ],
        },
    }, { sampleCount: 2 });

    assert.ok(samples.length <= PERCEPTUAL_CONFLICT_LIMITS.maxGradientSamples);
    assert.deepEqual(new Set(samples.filter(sample => sample.position === 49.9).map(sample => sample.color)), new Set(['#ffffff', '#000000']));
    assert.deepEqual(new Set(samples.filter(sample => sample.position === 50.1).map(sample => sample.color)), new Set(['#000000', '#ffffff']));
});

test('gradient sampling includes the midpoint of every narrow stop interval', () => {
    const entry = {
        color: '#ff0000',
        gradient: {
            type: 'linear',
            primaryPosition: 51,
            stops: [{ color: '#00ff00', position: 52 }],
        },
    };
    const simulation = { mode: 'deuteranopia', severity: 1 };
    const samples = sampleGradient(entry, { sampleCount: 2, colorVision: simulation });

    assert.ok(samples.length <= PERCEPTUAL_CONFLICT_LIMITS.maxGradientSamples);
    assert.equal(
        samples.find(sample => sample.position === 51.5)?.color,
        simulateColorVision('#808000', simulation),
    );
});

test('color-vision simulation transforms the rendered midpoint, not the endpoints', () => {
    const entry = { color: '#ff0000', gradient: animatedGradient() };
    entry.gradient.stops[0] = { baseColor: '#00ff00', color: '#00ff00', position: 100 };
    const simulation = { mode: 'deuteranopia', severity: 1 };
    const expected = simulateColorVision('#808000', simulation);
    const samples = sampleGradient(entry, { sampleCount: 3, colorVision: simulation });
    const visual = resolveVisual(entry, { colorVision: simulation });

    assert.equal(samples.find(sample => sample.offset === 0.5)?.color, expected);
    assert.equal(visual.canvasStops.find(stop => stop.offset === 0.5)?.color, expected);
});

test('perceptual reports cap comparison work and mark truncation as partial', () => {
    const report = createPerceptualConflictReport(items(70), {
        modes: ['none'],
        sampleCount: 2,
        comparisonLimit: Number.MAX_SAFE_INTEGER,
        conflictLimit: Number.MAX_SAFE_INTEGER,
    });

    assert.equal(report.comparisonCountPerMode, PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode);
    assert.ok(report.comparisonCountPerMode < report.possibleComparisonCountPerMode);
    assert.ok(report.conflicts.length <= PERCEPTUAL_CONFLICT_LIMITS.maxConflictsPerMode);
    assert.equal(report.truncated.comparisons, true);
    assert.equal(report.truncated.conflicts, true);
    assert.equal(report.partial, true);
    assert.equal(report.allItemsParticipate, true);
});

test('comparison coverage includes every item even under a tiny requested budget', () => {
    const report = createPerceptualConflictReport(items(7), {
        modes: ['none'],
        sampleCount: 2,
        comparisonLimit: 1,
    });

    assert.equal(report.coverageComparisonCountPerMode, 4);
    assert.equal(report.comparisonCountPerMode, 4);
    assert.equal(report.modes[0].participatingItemCount, 7);
    assert.equal(report.allItemsParticipate, true);
    assert.equal(report.partial, true);
});

test('item sampling keeps the per-mode comparison count hard-bounded above 4096 items', () => {
    const requestedCount = PERCEPTUAL_CONFLICT_LIMITS.maxItems + 1;
    const report = createPerceptualConflictReport(items(requestedCount), {
        modes: ['none'],
        sampleCount: 2,
        comparisonLimit: Number.MAX_SAFE_INTEGER,
        conflictLimit: 1,
    });

    assert.equal(report.itemCount, requestedCount);
    assert.equal(report.analyzedItemCount, PERCEPTUAL_CONFLICT_LIMITS.maxItems);
    assert.equal(report.omittedItemCount, 1);
    assert.equal(report.modes[0].omittedItemCount, 1);
    assert.equal(report.comparisonCountPerMode, PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode);
    assert.ok(report.maximumComparisonCountPerMode <= PERCEPTUAL_CONFLICT_LIMITS.maxComparisonsPerMode);
    assert.equal(report.allAnalyzedItemsParticipate, true);
    assert.equal(report.allItemsParticipate, false);
    assert.equal(report.truncated.items, true);
    assert.equal(report.partial, true);
});

test('pre-aborted analysis performs no item sampling and reports the omission', () => {
    const controller = new AbortController();
    controller.abort();
    const report = createPerceptualConflictReport(items(5), {
        modes: ['none'],
        sampleCount: 2,
        signal: controller.signal,
    });

    assert.equal(report.itemCount, 5);
    assert.equal(report.analyzedItemCount, 0);
    assert.equal(report.sampledItemCountPerMode, 0);
    assert.equal(report.omittedItemCount, 5);
    assert.equal(report.comparisonCountPerMode, 0);
    assert.equal(report.allItemsParticipate, false);
    assert.equal(report.truncated.items, true);
    assert.equal(report.truncated.cancelled, true);
    assert.equal(report.partial, true);
    assert.deepEqual(sampleGradient({ color: '#336699' }, { signal: controller.signal }), []);
});

test('mode input is bounded and reports partial analysis', () => {
    const requestedModes = Array.from({ length: 20 }, (_, index) => ({
        mode: index % 2 ? 'protanopia' : 'deuteranopia',
        severity: index / 20,
    }));
    const report = createPerceptualConflictReport(items(2), { modes: requestedModes, sampleCount: 2 });

    assert.ok(report.modes.length <= PERCEPTUAL_CONFLICT_LIMITS.maxModes);
    assert.equal(report.truncated.modes, true);
    assert.equal(report.partial, true);
});

test('duplicate mode inputs do not make complete mode coverage partial', () => {
    const report = createPerceptualConflictReport(items(2), {
        modes: ['none', 'none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'],
        sampleCount: 2,
    });

    assert.equal(report.modes.length, 5);
    assert.equal(report.truncated.modes, false);
});

test('the pure conflict report keeps similarity findings separate from readability', () => {
    const report = createPerceptualConflictReport(items(2), { modes: ['none'], sampleCount: 2 });

    assert.ok(report.conflicts.length > 0);
    assert.ok(report.conflicts.every(conflict => conflict.type === 'similarity'));
    assert.equal(report.conflicts.some(conflict => conflict.type === 'readability'), false);
    assert.equal(Object.hasOwn(report, 'readabilityIssues'), false);
});

test('reduced motion disables requested animation through the render API', () => {
    const entry = { color: '#000000', gradient: animatedGradient() };
    const visual = resolveVisual(entry, { reducedMotion: true });
    const rendered = getGradientRenderState(entry, {
        reducedMotion: true,
        settings: {
            colorVisionPreviewMode: 'none',
            colorVisionPreviewSeverity: 100,
            colorVisionPreviewTarget: 'all',
            driftAllGradientColors: false,
        },
    });

    assert.equal(visual.effectiveAnimation.requested, true);
    assert.equal(visual.effectiveAnimation.enabled, false);
    assert.equal(rendered.animationEnabled, false);
});
