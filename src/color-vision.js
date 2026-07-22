// color-vision.js - pure display-only color-vision simulation.

export const COLOR_VISION_MODES = Object.freeze([
    'none',
    'protanopia',
    'deuteranopia',
    'tritanopia',
    'achromatopsia',
]);

const COLOR_VISION_MATRICES = Object.freeze({
    protanopia: Object.freeze([
        Object.freeze([0.152286, 1.052583, -0.204868]),
        Object.freeze([0.114503, 0.786281, 0.099216]),
        Object.freeze([-0.003882, -0.048116, 1.051998]),
    ]),
    deuteranopia: Object.freeze([
        Object.freeze([0.367322, 0.860646, -0.227968]),
        Object.freeze([0.280085, 0.672501, 0.047413]),
        Object.freeze([-0.011820, 0.042940, 0.968881]),
    ]),
    tritanopia: Object.freeze([
        Object.freeze([1.255528, -0.076749, -0.178779]),
        Object.freeze([-0.078411, 0.930809, 0.147602]),
        Object.freeze([0.004733, 0.691367, 0.303900]),
    ]),
    achromatopsia: Object.freeze([
        Object.freeze([0.2126, 0.7152, 0.0722]),
        Object.freeze([0.2126, 0.7152, 0.0722]),
        Object.freeze([0.2126, 0.7152, 0.0722]),
    ]),
});

function normalizeHex(value, fallback = '#888888') {
    const color = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function srgbToLinear(value) {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped <= 0.0031308 ? clamped * 12.92 : (1.055 * (clamped ** (1 / 2.4))) - 0.055;
}

function rgbToHex(channels) {
    return `#${channels
        .map(channel => Math.round(linearToSrgb(channel) * 255).toString(16).padStart(2, '0'))
        .join('')}`;
}

export function normalizeColorVisionSimulation(value = {}) {
    const source = typeof value === 'string'
        ? { mode: value }
        : (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const requestedMode = String(source.mode ?? 'none').trim().toLowerCase();
    const mode = COLOR_VISION_MODES.includes(requestedMode) ? requestedMode : 'none';
    const rawSeverity = Number(source.severity);
    const severity = mode === 'none'
        ? 0
        : (Number.isFinite(rawSeverity) ? Math.max(0, Math.min(1, rawSeverity)) : 1);
    return { mode, severity };
}

export function simulateColorVision(color, value = {}) {
    const normalizedColor = normalizeHex(color);
    const simulation = normalizeColorVisionSimulation(value);
    if (simulation.mode === 'none' || simulation.severity === 0) return normalizedColor;

    const rgb = [
        parseInt(normalizedColor.slice(1, 3), 16) / 255,
        parseInt(normalizedColor.slice(3, 5), 16) / 255,
        parseInt(normalizedColor.slice(5, 7), 16) / 255,
    ].map(srgbToLinear);
    const matrix = COLOR_VISION_MATRICES[simulation.mode];
    const simulated = matrix.map(row => row.reduce((total, factor, index) => total + (factor * rgb[index]), 0));
    const blended = rgb.map((channel, index) => channel + ((simulated[index] - channel) * simulation.severity));
    return rgbToHex(blended);
}
