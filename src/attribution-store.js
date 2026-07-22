// Pure attribution review/provenance metadata. This module intentionally has no
// dependencies on SillyTavern state, storage, or UI code.

export const ATTRIBUTION_REVIEW_STORE_VERSION = 1;
export const ATTRIBUTION_REVIEW_METADATA_KEY = 'dialogue_colors_attribution_reviews';
export const ATTRIBUTION_OVERRIDES_METADATA_KEY = 'dialogue_colors_overrides';
export const MAX_PENDING_ATTRIBUTION_REVIEWS = 200;
export const MAX_RECENT_ATTRIBUTION_DECISIONS = 100;
export const ATTRIBUTION_STORE_VERSION = ATTRIBUTION_REVIEW_STORE_VERSION;
export const MAX_PENDING_REVIEWS = MAX_PENDING_ATTRIBUTION_REVIEWS;
export const MAX_RECENT_DECISIONS = MAX_RECENT_ATTRIBUTION_DECISIONS;

export const ATTRIBUTION_REVIEW_STATUS = Object.freeze({
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    STALE: 'stale',
});

export const ATTRIBUTION_REVIEW_STATUSES = Object.freeze(Object.values(ATTRIBUTION_REVIEW_STATUS));

export const ATTRIBUTION_VERIFICATION_STATUS = Object.freeze({
    CLEAN: 'clean',
    PENDING_REVIEW: 'pending-review',
    AUTO_APPLIED: 'auto-applied',
});

export const ATTRIBUTION_VERIFICATION_STATUSES = Object.freeze(Object.values(ATTRIBUTION_VERIFICATION_STATUS));

export const ATTRIBUTION_SOURCE = Object.freeze({
    MANUAL: 'manual',
    LLM: 'llm',
    REVIEW: 'review',
    OVERRIDE: 'override',
    EXPLICIT_MENTION: 'explicit-mention',
    STREAMING_CACHE: 'streaming-cache',
    PARAGRAPH_CARRY: 'paragraph-carry',
    ALTERNATION: 'alternation',
    MESSAGE_SPEAKER: 'message-speaker',
    COLOR_BLOCK: 'color-block',
    HEURISTIC: 'heuristic',
    IMPORTED: 'imported',
    UNKNOWN: 'unknown',
});

export const ATTRIBUTION_SOURCES = Object.freeze(Object.values(ATTRIBUTION_SOURCE));
export const KNOWN_ATTRIBUTION_SOURCES = ATTRIBUTION_SOURCES;

const STATUS_SET = new Set(ATTRIBUTION_REVIEW_STATUSES);
const SOURCE_SET = new Set(ATTRIBUTION_SOURCES);
const VERIFICATION_STATUS_SET = new Set(ATTRIBUTION_VERIFICATION_STATUSES);
const SOURCE_ALIASES = Object.freeze({
    ai: ATTRIBUTION_SOURCE.LLM,
    model: ATTRIBUTION_SOURCE.LLM,
    verifier: ATTRIBUTION_SOURCE.LLM,
    'manual-override': ATTRIBUTION_SOURCE.MANUAL,
    manual_override: ATTRIBUTION_SOURCE.MANUAL,
    accepted: ATTRIBUTION_SOURCE.REVIEW,
    explicit: ATTRIBUTION_SOURCE.EXPLICIT_MENTION,
    proximity: ATTRIBUTION_SOURCE.EXPLICIT_MENTION,
    streaming: ATTRIBUTION_SOURCE.STREAMING_CACHE,
    carry: ATTRIBUTION_SOURCE.PARAGRAPH_CARRY,
    default: ATTRIBUTION_SOURCE.MESSAGE_SPEAKER,
    local: ATTRIBUTION_SOURCE.HEURISTIC,
});

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maxLength, fallback = '') {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return text ? text.slice(0, maxLength) : fallback;
}

function normalizedIndex(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizedTimestamp(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function getNow(options = {}) {
    const value = typeof options.now === 'function' ? options.now() : options.now;
    return normalizedTimestamp(value, Date.now());
}

function cloneReview(review) {
    return {
        ...review,
        evidence: review.evidence.map(item => ({ ...item })),
    };
}

function stableHash(value) {
    const text = String(value ?? '');
    let left = 0xdeadbeef ^ text.length;
    let right = 0x41c6ce57 ^ text.length;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        left = Math.imul(left ^ code, 2654435761);
        right = Math.imul(right ^ code, 1597334677);
    }
    left = Math.imul(left ^ (left >>> 16), 2246822507) ^ Math.imul(right ^ (right >>> 13), 3266489909);
    right = Math.imul(right ^ (right >>> 16), 2246822507) ^ Math.imul(left ^ (left >>> 13), 3266489909);
    return `${(right >>> 0).toString(16).padStart(8, '0')}${(left >>> 0).toString(16).padStart(8, '0')}`;
}

// Kept identical to the existing override hash so accepted reviews can be
// written without invalidating legacy dialogue_colors_overrides entries.
export function hashAttributionMessageText(text) {
    const value = String(text ?? '');
    let hash = 5381;
    for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
    return hash.toString(36);
}

export function normalizeAttributionSource(value, fallback = ATTRIBUTION_SOURCE.UNKNOWN) {
    const normalizedFallback = SOURCE_SET.has(fallback) ? fallback : ATTRIBUTION_SOURCE.UNKNOWN;
    const source = boundedString(value, 64).toLowerCase().replace(/\s+/g, '-');
    if (!source) return normalizedFallback;
    const aliased = SOURCE_ALIASES[source] || source;
    return SOURCE_SET.has(aliased) ? aliased : normalizedFallback;
}

export const normalizeSource = normalizeAttributionSource;

export function normalizeAttributionConfidence(value, fallback = 0) {
    const labels = { none: 0, low: 0.25, medium: 0.5, high: 0.75, certain: 1 };
    let number = value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(labels, normalized)) number = labels[normalized];
        else if (/^-?\d+(?:\.\d+)?%$/.test(normalized)) number = Number.parseFloat(normalized) / 100;
        else number = Number(normalized);
    }
    number = Number(number);
    if (!Number.isFinite(number)) {
        const normalizedFallback = Number(fallback);
        number = Number.isFinite(normalizedFallback) ? normalizedFallback : 0;
    }
    return Math.round(Math.min(1, Math.max(0, number)) * 1000) / 1000;
}

export const normalizeConfidence = normalizeAttributionConfidence;

export function normalizeAttributionEvidence(value) {
    const items = Array.isArray(value) ? value : (value === null || value === undefined ? [] : [value]);
    const evidence = [];
    for (const item of items.slice(0, 8)) {
        if (typeof item === 'string') {
            const type = boundedString(item, 64);
            if (type) evidence.push({ type });
            continue;
        }
        if (!isPlainObject(item)) continue;
        const type = boundedString(item.type ?? item.kind ?? item.code, 64);
        if (!type) continue;
        const normalized = { type };
        const method = boundedString(item.method, 64);
        const speaker = boundedString(item.speaker, 80);
        const detail = boundedString(item.detail ?? item.reason, 160);
        if (method) normalized.method = method;
        if (speaker) normalized.speaker = speaker;
        if (detail) normalized.detail = detail;
        if (item.source !== undefined) normalized.source = normalizeAttributionSource(item.source);
        for (const key of ['segmentIndex', 'start', 'end', 'distance', 'strength']) {
            const number = Number(item[key]);
            if (Number.isFinite(number)) normalized[key] = number;
        }
        evidence.push(normalized);
    }
    return evidence;
}

export const normalizeEvidence = normalizeAttributionEvidence;

export function createMessageFingerprint(message) {
    const object = isPlainObject(message) ? message : null;
    const text = object ? (object.mes ?? object.text ?? '') : message;
    const speaker = object ? (object.name ?? object.speaker ?? '') : '';
    return `m1_${stableHash(`${String(speaker)}\u0000${String(text ?? '')}`)}`;
}

export const fingerprintMessage = createMessageFingerprint;

export function createSegmentFingerprint(segment, messageFingerprint = '') {
    const object = isPlainObject(segment) ? segment : { text: segment };
    const index = normalizedIndex(object.index);
    const start = normalizedIndex(object.start);
    const end = normalizedIndex(object.end);
    const text = String(object.text ?? '');
    const identity = [
        boundedString(messageFingerprint, 80),
        index ?? '',
        start ?? '',
        end ?? '',
        text,
    ].join('\u0000');
    return `s1_${stableHash(identity)}`;
}

export const fingerprintSegment = createSegmentFingerprint;

export function createAttributionReviewId(value, segmentFingerprint, proposedSpeaker, source) {
    const input = isPlainObject(value) ? value : {
        messageFingerprint: value,
        segmentFingerprint,
        proposedSpeaker,
        source,
    };
    const messagePart = boundedString(input.messageFingerprint, 80);
    const segmentPart = boundedString(input.segmentFingerprint, 80);
    const speakerPart = boundedString(input.proposedSpeaker ?? input.speaker, 80).toLowerCase();
    const sourcePart = normalizeAttributionSource(input.source ?? input.provenance?.source ?? input.provenance);
    return `ar1_${stableHash([messagePart, segmentPart, speakerPart, sourcePart].join('\u0000'))}`;
}

export const createReviewId = createAttributionReviewId;

function normalizeStatus(value, fallback = ATTRIBUTION_REVIEW_STATUS.PENDING) {
    const status = boundedString(value, 16).toLowerCase();
    return STATUS_SET.has(status) ? status : fallback;
}

function normalizeStoredReview(value, fallbackStatus, now) {
    if (!isPlainObject(value)) return null;
    const messageFingerprint = boundedString(value.messageFingerprint, 80);
    const segmentFingerprint = boundedString(value.segmentFingerprint, 80);
    const proposedSpeaker = boundedString(value.proposedSpeaker ?? value.speaker, 80);
    if (!messageFingerprint || !segmentFingerprint || !proposedSpeaker) return null;
    const source = normalizeAttributionSource(value.source ?? value.provenance?.source ?? value.provenance);
    const computedId = createAttributionReviewId({ messageFingerprint, segmentFingerprint, proposedSpeaker, source });
    const suppliedId = boundedString(value.id, 96);
    const createdAt = normalizedTimestamp(value.createdAt, now);
    const updatedAt = normalizedTimestamp(value.updatedAt, createdAt);
    const status = normalizeStatus(value.status, fallbackStatus);
    const review = {
        id: suppliedId || computedId,
        status,
        messageFingerprint,
        segmentFingerprint,
        proposedSpeaker,
        source,
        confidence: normalizeAttributionConfidence(value.confidence),
        evidence: normalizeAttributionEvidence(value.evidence),
        createdAt,
        updatedAt,
    };
    const messageIndex = normalizedIndex(value.messageIndex ?? value.mesIndex);
    const segmentIndex = normalizedIndex(value.segmentIndex ?? value.index);
    const segmentStart = normalizedIndex(value.segmentStart ?? value.start);
    const segmentEnd = normalizedIndex(value.segmentEnd ?? value.end);
    const currentSpeaker = boundedString(value.currentSpeaker, 80);
    const messageId = boundedString(value.messageId, 120);
    const messageHash = boundedString(value.messageHash, 32);
    const reason = boundedString(value.reason ?? value.staleReason, 80);
    if (messageIndex !== null) review.messageIndex = messageIndex;
    if (segmentIndex !== null) review.segmentIndex = segmentIndex;
    if (segmentStart !== null) review.segmentStart = segmentStart;
    if (segmentEnd !== null) review.segmentEnd = segmentEnd;
    if (currentSpeaker) review.currentSpeaker = currentSpeaker;
    if (messageId) review.messageId = messageId;
    if (messageHash) review.messageHash = messageHash;
    if (reason) review.reason = reason;
    if (status !== ATTRIBUTION_REVIEW_STATUS.PENDING) {
        review.decidedAt = normalizedTimestamp(value.decidedAt, updatedAt);
    }
    return review;
}

function valuesFromCollection(value) {
    if (Array.isArray(value)) return value;
    return isPlainObject(value) ? Object.values(value) : [];
}

function compareOldest(left, right) {
    return left.updatedAt - right.updatedAt || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function compareNewest(left, right) {
    return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id);
}

function deduplicateReviews(reviews) {
    const byId = new Map();
    for (const review of reviews) {
        const existing = byId.get(review.id);
        if (!existing || compareNewest(review, existing) < 0) byId.set(review.id, review);
    }
    return Array.from(byId.values());
}

function boundStore(store, now) {
    store.pending = deduplicateReviews(store.pending).sort(compareOldest);
    store.recent = deduplicateReviews(store.recent).sort(compareNewest);
    const decidedIds = new Set(store.recent.map(review => review.id));
    store.pending = store.pending.filter(review => !decidedIds.has(review.id));
    while (store.pending.length > MAX_PENDING_ATTRIBUTION_REVIEWS) {
        const review = store.pending.shift();
        store.recent.push({
            ...review,
            status: ATTRIBUTION_REVIEW_STATUS.STALE,
            reason: 'pending-limit',
            updatedAt: now,
            decidedAt: now,
        });
    }
    store.recent = deduplicateReviews(store.recent).sort(compareNewest).slice(0, MAX_RECENT_ATTRIBUTION_DECISIONS);
    return store;
}

export function createAttributionReviewStore(value = {}, options = {}) {
    const now = getNow(options);
    const pending = valuesFromCollection(value?.pending)
        .map(review => normalizeStoredReview(review, ATTRIBUTION_REVIEW_STATUS.PENDING, now))
        .filter(review => review && review.status === ATTRIBUTION_REVIEW_STATUS.PENDING);
    const recentFromPending = valuesFromCollection(value?.pending)
        .map(review => normalizeStoredReview(review, ATTRIBUTION_REVIEW_STATUS.PENDING, now))
        .filter(review => review && review.status !== ATTRIBUTION_REVIEW_STATUS.PENDING);
    const recent = valuesFromCollection(value?.recent ?? value?.decisions)
        .map(review => normalizeStoredReview(review, ATTRIBUTION_REVIEW_STATUS.STALE, now))
        .filter(review => review && review.status !== ATTRIBUTION_REVIEW_STATUS.PENDING);
    return boundStore({
        version: ATTRIBUTION_REVIEW_STORE_VERSION,
        pending,
        recent: recent.concat(recentFromPending),
    }, now);
}

export const createReviewStore = createAttributionReviewStore;

export function getAttributionReviewStore(metadata, options = {}) {
    if (!isPlainObject(metadata)) return null;
    const metadataKey = boundedString(options.metadataKey, 120, ATTRIBUTION_REVIEW_METADATA_KEY);
    const existing = metadata[metadataKey];
    if (!isPlainObject(existing) && options.create === false) return null;
    const store = createAttributionReviewStore(existing, options);
    if (options.create !== false) metadata[metadataKey] = store;
    return store;
}

export const getReviewStore = getAttributionReviewStore;

function replaceStore(target, normalized) {
    for (const key of Object.keys(target)) delete target[key];
    target.version = normalized.version;
    target.pending = normalized.pending;
    target.recent = normalized.recent;
    return target;
}

function prepareMutableStore(store, options = {}) {
    if (!isPlainObject(store)) throw new TypeError('Attribution review store must be an object.');
    return replaceStore(store, createAttributionReviewStore(store, options));
}

function reviewFromCandidate(candidate, now) {
    if (!isPlainObject(candidate)) return null;
    const message = candidate.message;
    const segment = candidate.segment;
    const messageFingerprint = boundedString(candidate.messageFingerprint, 80)
        || (message !== undefined ? createMessageFingerprint(message) : '');
    const segmentFingerprint = boundedString(candidate.segmentFingerprint, 80)
        || (segment !== undefined ? createSegmentFingerprint(segment, messageFingerprint) : '');
    const proposedSpeaker = boundedString(candidate.proposedSpeaker ?? candidate.speaker ?? candidate.assignment?.name, 80);
    if (!messageFingerprint || !segmentFingerprint || !proposedSpeaker) return null;
    const source = normalizeAttributionSource(candidate.source ?? candidate.provenance?.source ?? candidate.provenance);
    const id = createAttributionReviewId({ messageFingerprint, segmentFingerprint, proposedSpeaker, source });
    const messageIndex = normalizedIndex(candidate.messageIndex ?? candidate.mesIndex);
    const segmentIndex = normalizedIndex(candidate.segmentIndex ?? segment?.index ?? candidate.index);
    const segmentStart = normalizedIndex(candidate.segmentStart ?? segment?.start ?? candidate.start);
    const segmentEnd = normalizedIndex(candidate.segmentEnd ?? segment?.end ?? candidate.end);
    const messageId = boundedString(candidate.messageId ?? message?.id ?? message?.send_date, 120);
    const messageHash = boundedString(candidate.messageHash, 32)
        || (message !== undefined ? hashAttributionMessageText(message?.mes ?? message?.text ?? message) : '');
    const currentSpeaker = boundedString(candidate.currentSpeaker ?? candidate.currentAssignment?.name, 80);
    const review = {
        id,
        status: ATTRIBUTION_REVIEW_STATUS.PENDING,
        messageFingerprint,
        segmentFingerprint,
        proposedSpeaker,
        source,
        confidence: normalizeAttributionConfidence(candidate.confidence),
        evidence: normalizeAttributionEvidence(candidate.evidence),
        createdAt: now,
        updatedAt: now,
    };
    if (messageIndex !== null) review.messageIndex = messageIndex;
    if (segmentIndex !== null) review.segmentIndex = segmentIndex;
    if (segmentStart !== null) review.segmentStart = segmentStart;
    if (segmentEnd !== null) review.segmentEnd = segmentEnd;
    if (messageId) review.messageId = messageId;
    if (messageHash) review.messageHash = messageHash;
    if (currentSpeaker) review.currentSpeaker = currentSpeaker;
    const reason = boundedString(candidate.reason, 80);
    if (reason) review.reason = reason;
    return review;
}

export function upsertAttributionReview(store, candidate, options = {}) {
    const now = getNow(options);
    prepareMutableStore(store, { now });
    const next = reviewFromCandidate(candidate, now);
    if (!next) return null;
    const pendingIndex = store.pending.findIndex(review => review.id === next.id);
    if (pendingIndex >= 0) {
        const existing = store.pending[pendingIndex];
        next.createdAt = existing.createdAt;
        if (candidate.confidence === undefined) next.confidence = existing.confidence;
        if (candidate.evidence === undefined) next.evidence = existing.evidence;
        if (!next.currentSpeaker && existing.currentSpeaker) next.currentSpeaker = existing.currentSpeaker;
        store.pending[pendingIndex] = next;
        boundStore(store, now);
        return cloneReview(next);
    }
    const recentIndex = store.recent.findIndex(review => review.id === next.id);
    if (recentIndex >= 0 && options.reopen !== true) return cloneReview(store.recent[recentIndex]);
    if (recentIndex >= 0) store.recent.splice(recentIndex, 1);
    store.pending.push(next);
    boundStore(store, now);
    return cloneReview(next);
}

export const upsertReview = upsertAttributionReview;
export const upsert = upsertAttributionReview;

export function listAttributionReviews(store, options = {}) {
    const normalized = createAttributionReviewStore(store, options);
    const requested = options.status ?? ATTRIBUTION_REVIEW_STATUS.PENDING;
    const statuses = requested === 'all'
        ? new Set(ATTRIBUTION_REVIEW_STATUSES)
        : new Set((Array.isArray(requested) ? requested : [requested]).map(status => normalizeStatus(status, '')));
    const limitValue = Number(options.limit);
    const limit = Number.isInteger(limitValue) && limitValue >= 0 ? limitValue : Infinity;
    return normalized.pending.concat(normalized.recent)
        .filter(review => statuses.has(review.status))
        .sort(options.oldestFirst === true ? compareOldest : compareNewest)
        .slice(0, limit)
        .map(cloneReview);
}

export const listReviews = listAttributionReviews;
export const list = listAttributionReviews;

function decideAttributionReview(store, id, status, options = {}) {
    const now = getNow(options);
    prepareMutableStore(store, { now });
    const reviewId = boundedString(id, 96);
    const index = store.pending.findIndex(review => review.id === reviewId);
    if (index < 0) {
        const existing = store.recent.find(review => review.id === reviewId);
        return existing ? cloneReview(existing) : null;
    }
    const pending = store.pending.splice(index, 1)[0];
    const decided = {
        ...pending,
        status,
        updatedAt: now,
        decidedAt: now,
    };
    const reason = boundedString(options.reason, 80);
    if (reason) decided.reason = reason;
    else delete decided.reason;
    store.recent.push(decided);
    boundStore(store, now);
    return cloneReview(decided);
}

export function acceptAttributionReview(store, id, options = {}) {
    return decideAttributionReview(store, id, ATTRIBUTION_REVIEW_STATUS.ACCEPTED, options);
}

export const acceptReview = acceptAttributionReview;
export const accept = acceptAttributionReview;

export function rejectAttributionReview(store, id, options = {}) {
    return decideAttributionReview(store, id, ATTRIBUTION_REVIEW_STATUS.REJECTED, options);
}

export const rejectReview = rejectAttributionReview;
export const reject = rejectAttributionReview;

export function dismissAttributionReview(store, id, options = {}) {
    return decideAttributionReview(store, id, ATTRIBUTION_REVIEW_STATUS.STALE, {
        ...options,
        reason: options.reason || 'dismissed',
    });
}

export const dismissReview = dismissAttributionReview;
export const dismiss = dismissAttributionReview;

function messageIdFor(message) {
    return boundedString(message?.id ?? message?.send_date, 120);
}

function findCurrentMessage(chat, review) {
    const indexed = review.messageIndex !== undefined ? chat[review.messageIndex] : null;
    if (indexed && (!review.messageId || messageIdFor(indexed) === review.messageId)) return indexed;
    if (review.messageId) {
        const byId = chat.find(message => messageIdFor(message) === review.messageId);
        return byId || null;
    }
    return chat.find(message => createMessageFingerprint(message) === review.messageFingerprint) || null;
}

function findCurrentMessageIndex(chat, review, message = findCurrentMessage(chat, review)) {
    if (!Array.isArray(chat) || !message) return null;
    const index = chat.indexOf(message);
    return index >= 0 ? index : null;
}

function getStaleReason(review, chat, options) {
    if (typeof options.isCurrent === 'function') return options.isCurrent(cloneReview(review)) ? '' : 'callback-stale';
    if (!Array.isArray(chat)) return '';
    const message = findCurrentMessage(chat, review);
    if (!message) return 'message-missing';
    const messageFingerprint = createMessageFingerprint(message);
    if (messageFingerprint !== review.messageFingerprint) return 'message-changed';
    if (review.segmentStart === undefined || review.segmentEnd === undefined) return '';
    const text = String(message?.mes ?? message?.text ?? '');
    if (review.segmentStart > review.segmentEnd || review.segmentEnd > text.length) return 'segment-missing';
    const currentSegmentFingerprint = createSegmentFingerprint({
        index: review.segmentIndex,
        start: review.segmentStart,
        end: review.segmentEnd,
        text: text.slice(review.segmentStart, review.segmentEnd),
    }, messageFingerprint);
    return currentSegmentFingerprint === review.segmentFingerprint ? '' : 'segment-changed';
}

export function pruneAttributionReviews(store, options = {}) {
    const now = getNow(options);
    prepareMutableStore(store, { now });
    const chat = typeof options.getChat === 'function' ? options.getChat() : options.chat;
    const retained = [];
    let stale = 0;
    for (const review of store.pending) {
        const reason = getStaleReason(review, chat, options);
        if (!reason) {
            retained.push(review);
            continue;
        }
        stale++;
        store.recent.push({
            ...review,
            status: ATTRIBUTION_REVIEW_STATUS.STALE,
            reason,
            updatedAt: now,
            decidedAt: now,
        });
    }
    store.pending = retained;
    boundStore(store, now);
    return { stale, pending: store.pending.length, recent: store.recent.length };
}

export const pruneReviews = pruneAttributionReviews;
export const prune = pruneAttributionReviews;

function valueFromMap(map, key) {
    if (map instanceof Map) return map.get(key) ?? map.get(String(key));
    return isPlainObject(map) ? map[String(key)] : undefined;
}

function speakerFromOverride(value) {
    if (typeof value === 'string') return boundedString(value, 80);
    if (!isPlainObject(value)) return '';
    return boundedString(value.speaker ?? value.name ?? value.assignment?.name ?? value.value, 80);
}

export function getAttributionOverrideRecord(overrideMap, messageIndex, segmentIndex) {
    const entry = valueFromMap(overrideMap, messageIndex);
    if (!isPlainObject(entry)) return null;
    const segmentValue = valueFromMap(entry.segments, segmentIndex);
    const extended = valueFromMap(entry.records, segmentIndex);
    const speaker = speakerFromOverride(segmentValue) || speakerFromOverride(extended);
    if (!speaker) return null;
    const sourceValue = extended?.source ?? valueFromMap(entry.sources, segmentIndex) ?? segmentValue?.source;
    const record = {
        speaker,
        source: normalizeAttributionSource(sourceValue, ATTRIBUTION_SOURCE.OVERRIDE),
        confidence: normalizeAttributionConfidence(
            extended?.confidence ?? valueFromMap(entry.confidences, segmentIndex) ?? segmentValue?.confidence,
            1,
        ),
        evidence: normalizeAttributionEvidence(extended?.evidence ?? segmentValue?.evidence),
    };
    for (const key of ['messageFingerprint', 'segmentFingerprint', 'reviewId']) {
        const text = boundedString(extended?.[key] ?? (key === 'reviewId' ? valueFromMap(entry.reviewIds, segmentIndex) : ''), 96);
        if (text) record[key] = text;
    }
    return record;
}

export function getAttributionOverrideRecordMap(overrideMap, messageIndex, options = {}) {
    let entry = valueFromMap(overrideMap, messageIndex);
    if (!isPlainObject(entry) && options.create === true && isPlainObject(overrideMap)) {
        entry = { segments: {} };
        overrideMap[String(messageIndex)] = entry;
    }
    if (!isPlainObject(entry)) return null;
    if (!isPlainObject(entry.records) && options.create === true) entry.records = {};
    return isPlainObject(entry.records) ? entry.records : null;
}

export function setAttributionOverrideRecord(overrideMap, review, options = {}) {
    if (!isPlainObject(overrideMap) || !isPlainObject(review)) return false;
    const messageIndex = normalizedIndex(review.messageIndex ?? options.messageIndex);
    const segmentIndex = normalizedIndex(review.segmentIndex ?? options.segmentIndex);
    const speaker = boundedString(options.speaker ?? review.proposedSpeaker ?? review.speaker, 80);
    if (messageIndex === null || segmentIndex === null || !speaker) return false;
    const message = options.message;
    const expectedHash = message !== undefined
        ? hashAttributionMessageText(message?.mes ?? message?.text ?? message)
        : boundedString(review.messageHash, 32);
    const messageKey = String(messageIndex);
    let entry = overrideMap[messageKey];
    if (!isPlainObject(entry) || (expectedHash && entry.hash !== expectedHash)) {
        entry = { segments: {} };
        if (expectedHash) entry.hash = expectedHash;
        overrideMap[messageKey] = entry;
    }
    if (!isPlainObject(entry.segments)) entry.segments = {};
    if (!isPlainObject(entry.sources)) entry.sources = {};
    const segmentKey = String(segmentIndex);
    const source = normalizeAttributionSource(options.source ?? review.overrideSource ?? review.source, ATTRIBUTION_SOURCE.REVIEW);
    entry.segments[segmentKey] = speaker;
    entry.sources[segmentKey] = source;
    const confidence = normalizeAttributionConfidence(options.confidence ?? review.confidence);
    if (!isPlainObject(entry.confidences)) entry.confidences = {};
    entry.confidences[segmentKey] = confidence;
    const reviewId = boundedString(options.reviewId ?? review.id, 96);
    if (reviewId) {
        if (!isPlainObject(entry.reviewIds)) entry.reviewIds = {};
        entry.reviewIds[segmentKey] = reviewId;
    }
    const messageId = boundedString(options.messageId ?? review.messageId ?? messageIdFor(message), 120);
    if (messageId) entry.messageId = messageId;
    const text = message === undefined ? '' : String(message?.mes ?? message?.text ?? message);
    if (message !== undefined) entry.textLength = text.length;
    const verificationStatus = boundedString(options.verificationStatus, 32).toLowerCase();
    if (VERIFICATION_STATUS_SET.has(verificationStatus)) entry.verificationStatus = verificationStatus;
    delete entry.verifiedHash;
    delete entry.verifiedAt;
    delete entry.verifiedVersion;
    if (options.extended === true || isPlainObject(options.recordMap)) {
        const records = isPlainObject(options.recordMap)
            ? options.recordMap
            : getAttributionOverrideRecordMap(overrideMap, messageIndex, { create: true });
        const extended = {
            speaker,
            source,
            confidence: normalizeAttributionConfidence(options.confidence ?? review.confidence),
            evidence: normalizeAttributionEvidence(options.evidence ?? review.evidence),
            messageFingerprint: boundedString(review.messageFingerprint, 80),
            segmentFingerprint: boundedString(review.segmentFingerprint, 80),
            reviewId: boundedString(review.id, 96),
        };
        const reviewedAt = normalizedTimestamp(review.decidedAt ?? options.reviewedAt, null);
        if (reviewedAt !== null) extended.reviewedAt = reviewedAt;
        records[segmentKey] = extended;
    }
    return true;
}

export function deleteAttributionOverrideRecord(overrideMap, messageIndex, segmentIndex) {
    if (!isPlainObject(overrideMap)) return false;
    const messageKey = String(normalizedIndex(messageIndex));
    const segmentKey = String(normalizedIndex(segmentIndex));
    if (messageKey === 'null' || segmentKey === 'null') return false;
    const entry = overrideMap[messageKey];
    if (!isPlainObject(entry)) return false;
    let deleted = false;
    for (const mapName of ['segments', 'sources', 'confidences', 'reviewIds', 'records']) {
        const map = entry[mapName];
        if (!isPlainObject(map) || !Object.prototype.hasOwnProperty.call(map, segmentKey)) continue;
        delete map[segmentKey];
        deleted = true;
    }
    return deleted;
}

export const deleteOverrideRecord = deleteAttributionOverrideRecord;

function resolveFactoryOptions(value, chat) {
    if (isPlainObject(value) && (
        Object.prototype.hasOwnProperty.call(value, 'metadata')
        || typeof value.getMetadata === 'function'
        || Object.prototype.hasOwnProperty.call(value, 'chat')
        || typeof value.getChat === 'function'
    )) return value;
    return { metadata: value, chat };
}

export function createAttributionStore(value = {}, chat) {
    const options = resolveFactoryOptions(value, chat);
    const metadataKey = boundedString(options.metadataKey, 120, ATTRIBUTION_REVIEW_METADATA_KEY);
    const fallbackMetadata = isPlainObject(options.metadata) ? options.metadata : {};
    const getMetadata = () => {
        const metadata = typeof options.getMetadata === 'function' ? options.getMetadata() : fallbackMetadata;
        return isPlainObject(metadata) ? metadata : fallbackMetadata;
    };
    const getChat = () => {
        const current = typeof options.getChat === 'function' ? options.getChat() : options.chat;
        return Array.isArray(current) ? current : null;
    };
    const nowOptions = () => ({ now: typeof options.now === 'function' ? options.now() : options.now });
    const ensureStore = () => {
        const metadata = getMetadata();
        const normalized = createAttributionReviewStore(metadata[metadataKey], nowOptions());
        metadata[metadataKey] = normalized;
        return normalized;
    };
    const notify = (action, record = null) => {
        const metadata = getMetadata();
        if (typeof options.onChange === 'function') options.onChange({ action, record, metadata });
        if (typeof options.saveMetadata === 'function') options.saveMetadata(metadata);
    };
    const service = {
        getStore() {
            return ensureStore();
        },
        get() {
            return ensureStore();
        },
        upsert(candidate, operationOptions = {}) {
            const store = ensureStore();
            pruneAttributionReviews(store, { ...nowOptions(), chat: getChat() });
            const review = upsertAttributionReview(store, candidate, { ...nowOptions(), ...operationOptions });
            if (review) notify('upsert', review);
            return review;
        },
        list(operationOptions = {}) {
            return listAttributionReviews(ensureStore(), { ...nowOptions(), ...operationOptions });
        },
        accept(id, operationOptions = {}) {
            const store = ensureStore();
            const pruned = pruneAttributionReviews(store, { ...nowOptions(), chat: getChat() });
            const pending = store.pending.find(review => review.id === id);
            if (!pending) {
                if (pruned.stale) notify('prune');
                const existing = store.recent.find(review => review.id === id);
                return existing ? cloneReview(existing) : null;
            }
            const decision = acceptAttributionReview(store, id, { ...nowOptions(), ...operationOptions });
            const metadata = getMetadata();
            const currentChat = getChat();
            const message = currentChat ? findCurrentMessage(currentChat, decision) : undefined;
            const currentMessageIndex = currentChat ? findCurrentMessageIndex(currentChat, decision, message) : null;
            if (currentMessageIndex !== null && decision.messageIndex !== currentMessageIndex) {
                decision.messageIndex = currentMessageIndex;
                const storedDecision = store.recent.find(review => review.id === decision.id);
                if (storedDecision) storedDecision.messageIndex = currentMessageIndex;
            }
            if (decision && operationOptions.applyOverride !== false && options.applyOverrides !== false) {
                let overrideMap = operationOptions.overrideMap;
                if (!overrideMap && typeof options.getOverrideMap === 'function') overrideMap = options.getOverrideMap();
                if (!overrideMap) {
                    if (!isPlainObject(metadata[ATTRIBUTION_OVERRIDES_METADATA_KEY])) metadata[ATTRIBUTION_OVERRIDES_METADATA_KEY] = {};
                    overrideMap = metadata[ATTRIBUTION_OVERRIDES_METADATA_KEY];
                }
                const overrideSource = operationOptions.source
                    ?? (decision.source === ATTRIBUTION_SOURCE.MANUAL ? ATTRIBUTION_SOURCE.MANUAL : ATTRIBUTION_SOURCE.REVIEW);
                setAttributionOverrideRecord(overrideMap, decision, {
                    message,
                    source: overrideSource,
                    verificationStatus: operationOptions.verificationStatus ?? ATTRIBUTION_VERIFICATION_STATUS.CLEAN,
                    extended: operationOptions.extended !== false || options.extendedOverrides === true,
                    recordMap: operationOptions.recordMap,
                });
            }
            if (decision && typeof options.applyOverride === 'function') options.applyOverride(cloneReview(decision));
            if (decision) notify('accept', decision);
            return decision;
        },
        reject(id, operationOptions = {}) {
            const decision = rejectAttributionReview(ensureStore(), id, { ...nowOptions(), ...operationOptions });
            if (decision) notify('reject', decision);
            return decision;
        },
        dismiss(id, operationOptions = {}) {
            const decision = dismissAttributionReview(ensureStore(), id, { ...nowOptions(), ...operationOptions });
            if (decision) notify('dismiss', decision);
            return decision;
        },
        prune(operationOptions = {}) {
            const result = pruneAttributionReviews(ensureStore(), {
                ...nowOptions(),
                chat: getChat(),
                ...operationOptions,
            });
            if (result.stale) notify('prune');
            return result;
        },
        deleteOverride(messageIndex, segmentIndex, operationOptions = {}) {
            const metadata = getMetadata();
            let overrideMap = operationOptions.overrideMap;
            if (!overrideMap && typeof options.getOverrideMap === 'function') overrideMap = options.getOverrideMap();
            if (!overrideMap) overrideMap = metadata[ATTRIBUTION_OVERRIDES_METADATA_KEY];
            const deleted = deleteAttributionOverrideRecord(overrideMap, messageIndex, segmentIndex);
            if (deleted) notify('delete-override');
            return deleted;
        },
        fingerprintMessage: createMessageFingerprint,
        fingerprintSegment: createSegmentFingerprint,
        createReviewId: createAttributionReviewId,
    };
    return Object.freeze(service);
}

export const createAttributionReviewService = createAttributionStore;
