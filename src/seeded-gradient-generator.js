// seeded-gradient-generator.js - reproducible gradient generation and metadata.
import { buildRandomGradient, cloneGradient } from './gradients.js';

export const GRADIENT_GENERATOR_ALGORITHM = 'dc-gradient-v1';

export function normalizeGradientGenerator(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawIteration = Number(source.iteration);
    const iteration = Number.isFinite(rawIteration)
        ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(rawIteration)))
        : 0;
    return {
        algorithm: GRADIENT_GENERATOR_ALGORITHM,
        seed: String(source.seed ?? 'default'),
        iteration,
    };
}

// xmur3 and sfc32 are kept public so deterministic vectors can be tested directly.
export function createXmur3(value) {
    const seed = String(value ?? '');
    let hash = 1779033703 ^ seed.length;
    for (let index = 0; index < seed.length; index++) {
        hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
    }
    return function nextHash() {
        hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
        hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
        return (hash ^= hash >>> 16) >>> 0;
    };
}

export function createSfc32(first, second, third, fourth) {
    let a = first >>> 0;
    let b = second >>> 0;
    let c = third >>> 0;
    let d = fourth >>> 0;
    return function nextRandom() {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let result = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = ((c << 21) | (c >>> 11));
        d = (d + 1) | 0;
        result = (result + d) | 0;
        c = (c + result) | 0;
        return (result >>> 0) / 4294967296;
    };
}

export function createGradientRandom(value) {
    const generator = normalizeGradientGenerator(value);
    const serializedSeed = JSON.stringify([
        generator.algorithm,
        generator.seed,
        generator.iteration,
    ]);
    const seedHash = createXmur3(serializedSeed);
    return createSfc32(seedHash(), seedHash(), seedHash(), seedHash());
}

export function advanceGradientGenerator(value, amount = 1) {
    const generator = normalizeGradientGenerator(value);
    const rawAmount = Number(amount);
    const increment = Number.isFinite(rawAmount) ? Math.max(0, Math.floor(rawAmount)) : 1;
    return {
        ...generator,
        iteration: Math.min(Number.MAX_SAFE_INTEGER, generator.iteration + increment),
    };
}

export function generateSeededGradient(primaryColor, value, options = {}) {
    const generator = normalizeGradientGenerator(value);
    const gradient = cloneGradient(buildRandomGradient(primaryColor, options, createGradientRandom(generator)));

    // Persist both sibling fields: metadata reproduces the operation, while the
    // materialized gradient remains the durable visual if algorithms later change.
    return { generator, gradient };
}
