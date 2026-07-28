import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BUILTIN_GRADIENT_PRESETS,
    GRADIENT_TYPES,
    MAX_GRADIENT_STOPS,
    buildGradientCss,
    getBuiltInGradientPreset,
    normalizeGradient,
    pickRandomGradientType,
} from '../src/gradients.js';

const presetEntries = Object.entries(BUILTIN_GRADIENT_PRESETS);

test('every built-in preset survives normalization', () => {
    assert.ok(presetEntries.length >= 30, `expected a grown catalog, got ${presetEntries.length}`);
    for (const [name, preset] of presetEntries) {
        const gradient = normalizeGradient(preset.gradient);
        assert.ok(gradient, `${name} failed to normalize`);
        assert.ok(GRADIENT_TYPES.includes(gradient.type), `${name} has type ${gradient.type}`);
        // Primary colour plus secondary stops must fit the editor's cap, or the
        // preset loads into a row that cannot round-trip it.
        assert.ok(gradient.stops.length + 1 <= MAX_GRADIENT_STOPS, `${name} has too many stops`);
        assert.ok(gradient.stops.length >= 1, `${name} has no secondary stops`);
    }
});

test('preset names resolve through the public lookup', () => {
    for (const [name] of presetEntries) {
        assert.ok(getBuiltInGradientPreset(name), `${name} is not retrievable by name`);
    }
});

test('every preset colour is a valid hex triple', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const [name, preset] of presetEntries) {
        assert.match(preset.baseColor, hex, `${name} base colour`);
        assert.match(preset.color, hex, `${name} colour`);
        for (const stop of preset.gradient.stops) {
            assert.match(stop.baseColor, hex, `${name} stop base colour`);
            assert.match(stop.color, hex, `${name} stop colour`);
        }
    }
});

test('stop positions stay within range and sorted', () => {
    for (const [name, preset] of presetEntries) {
        let previous = -1;
        for (const stop of preset.gradient.stops) {
            assert.ok(stop.position >= 0 && stop.position <= 100, `${name} stop out of range`);
            // normalizeGradient sorts, so a decrease means the data was mangled.
            assert.ok(stop.position >= previous, `${name} stops are not sorted`);
            previous = stop.position;
        }
    }
});

test('hard-banded presets keep their duplicate positions', () => {
    // Two stops sharing a position are what render as a cut instead of a
    // blend. Sorting must not deduplicate or nudge them apart.
    const heraldic = normalizeGradient(BUILTIN_GRADIENT_PRESETS['heraldic-bands'].gradient);
    const positions = heraldic.stops.map(stop => stop.position);
    assert.deepEqual(positions, [33, 33, 66, 66]);

    const beacon = normalizeGradient(BUILTIN_GRADIENT_PRESETS['beacon-sweep'].gradient);
    assert.equal(beacon.stops.filter(stop => stop.position === 12).length, 2);
});

test('the catalog covers all three gradient types', () => {
    const types = new Set(presetEntries.map(([, preset]) => preset.gradient.type));
    assert.deepEqual([...types].sort(), ['conic', 'linear', 'radial']);
});

test('conic presets render as conic-gradient with both geometry values', () => {
    const preset = BUILTIN_GRADIENT_PRESETS['spectral-wheel'];
    const css = buildGradientCss(preset);
    assert.match(css, /^conic-gradient\(from 0deg at 50% 50%, /);
    assert.match(css, /#ff4d6d 0%/);
    assert.match(css, /#ff4d6d 100%/);
});

test('radial and linear rendering is unchanged', () => {
    assert.match(buildGradientCss(BUILTIN_GRADIENT_PRESETS['moonlit-focus']), /^radial-gradient\(circle at /);
    assert.match(buildGradientCss(BUILTIN_GRADIENT_PRESETS['sunset-ribbon']), /^linear-gradient\(112deg, /);
});

test('an unknown gradient type is rejected rather than coerced', () => {
    assert.equal(normalizeGradient({ type: 'mesh', stops: [{ color: '#ffffff', position: 50 }] }), null);
    assert.equal(normalizeGradient({ type: '', stops: [{ color: '#ffffff', position: 50 }] }), null);
    assert.equal(normalizeGradient({ type: 'CONIC', stops: [{ color: '#ffffff', position: 50 }] }), null);
});

test('a conic gradient round-trips through normalization', () => {
    const gradient = normalizeGradient({
        type: 'conic',
        angle: 210,
        x: 42,
        y: 58,
        primaryPosition: 0,
        stops: [{ color: '#123456', position: 40 }],
    });
    assert.equal(gradient.type, 'conic');
    assert.equal(gradient.angle, 210);
    assert.equal(gradient.x, 42);
    assert.equal(gradient.y, 58);
});

test('random type selection stays weighted toward legible types', () => {
    assert.equal(pickRandomGradientType(0), 'conic');
    assert.equal(pickRandomGradientType(0.14), 'conic');
    assert.equal(pickRandomGradientType(0.15), 'radial');
    assert.equal(pickRandomGradientType(0.39), 'radial');
    assert.equal(pickRandomGradientType(0.4), 'linear');
    assert.equal(pickRandomGradientType(0.999), 'linear');
    // Out-of-range or missing samples must still yield a renderable type.
    assert.ok(GRADIENT_TYPES.includes(pickRandomGradientType(1)));
    assert.ok(GRADIENT_TYPES.includes(pickRandomGradientType(-1)));
    assert.ok(GRADIENT_TYPES.includes(pickRandomGradientType(NaN)));
    assert.ok(GRADIENT_TYPES.includes(pickRandomGradientType(undefined)));
});

test('preset names are kebab-case and unique', () => {
    const names = presetEntries.map(([name]) => name);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) {
        assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name} is not kebab-case`);
    }
});
