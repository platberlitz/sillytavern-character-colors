// import-codec.js - bounded, side-effect-free JSON decoding and canonicalization.

export const MAX_JSON_SOURCE_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 20;
export const MAX_JSON_NODES = 20000;

export const RESERVED_JSON_KEYS = Object.freeze([
    '__proto__',
    'prototype',
    'constructor',
]);

const RESERVED_KEY_SET = new Set(RESERVED_JSON_KEYS);

export const JSON_SOURCE_LIMITS = Object.freeze({
    maxBytes: MAX_JSON_SOURCE_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxNodes: MAX_JSON_NODES,
});

export class ImportCodecError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'ImportCodecError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function boundedLimit(value, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return maximum;
    return Math.min(maximum, Math.floor(parsed));
}

function getLimits(options = {}) {
    return {
        maxBytes: boundedLimit(options.maxBytes, MAX_JSON_SOURCE_BYTES),
        maxDepth: boundedLimit(options.maxDepth, MAX_JSON_DEPTH),
        maxNodes: boundedLimit(options.maxNodes, MAX_JSON_NODES),
    };
}

function byteLength(value) {
    const text = String(value);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
}

function assertByteLimit(length, maxBytes) {
    if (length > maxBytes) {
        throw new ImportCodecError(
            'input_too_large',
            `JSON source exceeds the ${maxBytes}-byte limit.`,
            { byteLength: length, maxBytes },
        );
    }
}

function isArrayIndex(key, length) {
    if (!/^(0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function appendPath(path, key) {
    if (typeof key === 'number' || /^\d+$/.test(String(key))) return `${path}[${key}]`;
    const segment = String(key);
    return /^[A-Za-z_$][\w$]*$/.test(segment)
        ? `${path}.${segment}`
        : `${path}[${JSON.stringify(segment)}]`;
}

function inspectContainer(source, path, limits) {
    const isArray = Array.isArray(source);
    const prototype = Object.getPrototypeOf(source);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        throw new ImportCodecError('unsafe_object', `Non-JSON object at ${path}.`);
    }

    const ownKeys = Reflect.ownKeys(source);
    const dataKeys = [];
    for (const key of ownKeys) {
        if (typeof key !== 'string') {
            throw new ImportCodecError('invalid_json_value', `Symbol property at ${path} is not JSON data.`);
        }
        if (isArray && key === 'length') continue;
        if (RESERVED_KEY_SET.has(key)) {
            throw new ImportCodecError('reserved_key', `Reserved key "${key}" at ${path}.`, { key, path });
        }
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new ImportCodecError('unsafe_object', `Accessor or hidden property at ${appendPath(path, key)}.`);
        }
        if (isArray && !isArrayIndex(key, source.length)) {
            throw new ImportCodecError('invalid_json_value', `Non-index array property at ${appendPath(path, key)}.`);
        }
        dataKeys.push(key);
    }

    if (isArray) {
        if (source.length > limits.maxNodes || dataKeys.length !== source.length) {
            throw new ImportCodecError('invalid_json_value', `Sparse or excessive array at ${path}.`);
        }
        dataKeys.sort((left, right) => Number(left) - Number(right));
    }
    return dataKeys;
}

/**
 * Validate a JSON-compatible value and copy every dictionary onto a null prototype.
 * Cyclic and shared object references are rejected because neither can be represented
 * unambiguously by this bounded tree codec.
 */
export function inspectJsonValue(value, options = {}) {
    const limits = getLimits(options);
    const seen = new WeakSet();
    const rootHolder = [undefined];
    const stack = [{ source: value, parent: rootHolder, key: 0, depth: 0, path: '$' }];
    let nodeCount = 0;
    let maxDepth = 0;

    while (stack.length) {
        const frame = stack.pop();
        nodeCount++;
        if (nodeCount > limits.maxNodes) {
            throw new ImportCodecError(
                'too_many_nodes',
                `JSON source exceeds the ${limits.maxNodes}-node limit.`,
                { nodeCount, maxNodes: limits.maxNodes },
            );
        }
        if (frame.depth > limits.maxDepth) {
            throw new ImportCodecError(
                'too_deep',
                `JSON source exceeds the maximum depth of ${limits.maxDepth}.`,
                { depth: frame.depth, maxDepth: limits.maxDepth, path: frame.path },
            );
        }
        maxDepth = Math.max(maxDepth, frame.depth);

        const source = frame.source;
        if (source === null || typeof source === 'string' || typeof source === 'boolean') {
            frame.parent[frame.key] = source;
            continue;
        }
        if (typeof source === 'number') {
            if (!Number.isFinite(source)) {
                throw new ImportCodecError('invalid_json_value', `Non-finite number at ${frame.path}.`);
            }
            frame.parent[frame.key] = Object.is(source, -0) ? 0 : source;
            continue;
        }
        if (typeof source !== 'object') {
            throw new ImportCodecError('invalid_json_value', `Unsupported JSON value at ${frame.path}.`);
        }
        if (seen.has(source)) {
            throw new ImportCodecError('repeated_reference', `Cyclic or shared object reference at ${frame.path}.`);
        }
        seen.add(source);

        const keys = inspectContainer(source, frame.path, limits);
        const target = Array.isArray(source) ? new Array(source.length) : Object.create(null);
        frame.parent[frame.key] = target;
        for (let index = keys.length - 1; index >= 0; index--) {
            const key = keys[index];
            stack.push({
                source: source[key],
                parent: target,
                key,
                depth: frame.depth + 1,
                path: appendPath(frame.path, key),
            });
        }
    }

    const hardened = rootHolder[0];
    const canonicalLength = byteLength(JSON.stringify(hardened));
    assertByteLimit(canonicalLength, limits.maxBytes);
    return { value: hardened, nodeCount, maxDepth, byteLength: canonicalLength };
}

export function hardenJsonValue(value, options = {}) {
    return inspectJsonValue(value, options).value;
}

function decodeUtf8(bytes) {
    try {
        if (typeof TextDecoder === 'function') {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    } catch {
        throw new ImportCodecError('invalid_encoding', 'JSON source is not valid UTF-8.');
    }
    throw new ImportCodecError('unsupported_source', 'This environment cannot decode UTF-8 input.');
}

function isArrayBufferView(value) {
    return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);
}

async function readTextSource(source, limits) {
    if (typeof source === 'string') {
        const length = byteLength(source);
        assertByteLimit(length, limits.maxBytes);
        return { text: source, byteLength: length };
    }

    if (typeof ArrayBuffer !== 'undefined' && source instanceof ArrayBuffer) {
        assertByteLimit(source.byteLength, limits.maxBytes);
        return { text: decodeUtf8(new Uint8Array(source)), byteLength: source.byteLength };
    }

    if (isArrayBufferView(source)) {
        assertByteLimit(source.byteLength, limits.maxBytes);
        const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        return { text: decodeUtf8(bytes), byteLength: source.byteLength };
    }

    const isFileLike = source && typeof source === 'object'
        && (typeof source.arrayBuffer === 'function' || typeof source.text === 'function');
    if (!isFileLike) return null;
    if (Number.isFinite(source.size)) assertByteLimit(source.size, limits.maxBytes);

    try {
        if (typeof source.arrayBuffer === 'function') {
            const buffer = await source.arrayBuffer();
            if (!(buffer instanceof ArrayBuffer)) {
                throw new ImportCodecError('read_failed', 'The JSON source returned invalid binary data.');
            }
            assertByteLimit(buffer.byteLength, limits.maxBytes);
            return { text: decodeUtf8(new Uint8Array(buffer)), byteLength: buffer.byteLength };
        }
        const text = await source.text();
        if (typeof text !== 'string') {
            throw new ImportCodecError('read_failed', 'The JSON source returned invalid text data.');
        }
        const length = byteLength(text);
        assertByteLimit(length, limits.maxBytes);
        return { text, byteLength: length };
    } catch (error) {
        if (error instanceof ImportCodecError) throw error;
        throw new ImportCodecError('read_failed', 'The JSON source could not be read.');
    }
}

function parseText(text) {
    const normalized = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    try {
        return JSON.parse(normalized);
    } catch {
        throw new ImportCodecError('invalid_json', 'The source is not valid JSON.');
    }
}

async function decodeJsonSource(source, options = {}) {
    const limits = getLimits(options);
    const textSource = await readTextSource(source, limits);
    const parsed = textSource ? parseText(textSource.text) : source;
    const inspected = inspectJsonValue(parsed, limits);
    return {
        ...inspected,
        byteLength: textSource?.byteLength ?? inspected.byteLength,
    };
}

/** Parse local JSON text, bytes, file-like data, or an already-decoded JSON value. */
export async function parseJsonSource(source, options = {}) {
    return (await decodeJsonSource(source, options)).value;
}

export async function analyzeJsonSource(source, options = {}) {
    try {
        const result = await decodeJsonSource(source, options);
        return { ok: true, ...result };
    } catch (error) {
        const normalized = error instanceof ImportCodecError
            ? error
            : new ImportCodecError('invalid_source', 'The JSON source could not be analyzed.');
        return {
            ok: false,
            error: normalized.code,
            message: normalized.message,
            ...(normalized.details === undefined ? {} : { details: normalized.details }),
        };
    }
}

function sortJsonValue(value) {
    if (Array.isArray(value)) return value.map(sortJsonValue);
    if (!value || typeof value !== 'object') return value;
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) sorted[key] = sortJsonValue(value[key]);
    return sorted;
}

export function canonicalizeJsonValue(value, options = {}) {
    return sortJsonValue(hardenJsonValue(value, options));
}

export function stringifyCanonicalJson(value, options = {}) {
    const spacing = options.space === undefined ? 0 : Math.max(0, Math.min(10, Number(options.space) || 0));
    return JSON.stringify(canonicalizeJsonValue(value, options), null, spacing);
}

export function canonicalizeJson(value, options = {}) {
    return JSON.stringify(canonicalizeJsonValue(value, options));
}

async function sha256(bytes) {
    if (globalThis.crypto?.subtle) return globalThis.crypto.subtle.digest('SHA-256', bytes);
    try {
        const cryptoModule = await import('node:crypto');
        const digest = cryptoModule.createHash('sha256').update(bytes).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
    } catch {
        throw new ImportCodecError('digest_unavailable', 'SHA-256 is unavailable in this environment.');
    }
}

export async function digestCanonicalJson(value, options = {}) {
    const canonical = canonicalizeJson(value, options);
    const bytes = typeof TextEncoder === 'function'
        ? new TextEncoder().encode(canonical)
        : Uint8Array.from(Buffer.from(canonical, 'utf8'));
    const digest = new Uint8Array(await sha256(bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const digestJson = digestCanonicalJson;
