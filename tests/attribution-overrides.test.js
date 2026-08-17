import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAX_PENDING_ATTRIBUTION_REVIEWS,
    MAX_RAW_PENDING_ATTRIBUTION_REVIEWS,
    createAttributionReviewStore,
    createMessageFingerprint,
    hashAttributionMessageText,
    isLegacyAttributionOverrideEntry,
    setAttributionOverrideRecord,
} from '../src/attribution-store.js';

test('review normalization stops at the raw persisted cap', () => {
    const pending = Array.from({ length: MAX_RAW_PENDING_ATTRIBUTION_REVIEWS }, (_, index) => ({
        id: `review-${index}`,
        messageFingerprint: `message-${index}`,
        segmentFingerprint: `segment-${index}`,
        proposedSpeaker: 'Alice',
        status: 'pending',
    }));
    Object.defineProperty(pending, MAX_RAW_PENDING_ATTRIBUTION_REVIEWS, {
        configurable: true,
        get() { throw new Error('raw review cap was crossed'); },
    });
    pending.length = MAX_RAW_PENDING_ATTRIBUTION_REVIEWS + 1;
    const store = createAttributionReviewStore({ pending }, { now: 1 });
    assert.equal(store.pending.length, MAX_PENDING_ATTRIBUTION_REVIEWS);
});

function reviewFor(message, overrides = {}) {
    return {
        id: 'review-1',
        messageIndex: 0,
        segmentIndex: 1,
        proposedSpeaker: 'Alice',
        source: 'llm',
        confidence: 0.9,
        messageId: message.id,
        messageHash: hashAttributionMessageText(message.mes),
        messageFingerprint: createMessageFingerprint(message),
        segmentFingerprint: 'segment-1',
        ...overrides,
    };
}

test('legacy hash-only overrides migrate onto the current message identity', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Hello there.' };
    const legacy = {
        hash: hashAttributionMessageText(message.mes),
        segments: { 0: 'Legacy speaker' },
    };
    const overrides = { 0: legacy };

    assert.equal(setAttributionOverrideRecord(overrides, reviewFor(message), { message }), true);
    assert.equal(overrides[0], legacy);
    assert.equal(overrides[0].segments[0], 'Legacy speaker');
    assert.equal(overrides[0].segments[1], 'Alice');
    assert.equal(overrides[0].messageId, message.id);
    assert.equal(overrides[0].messageFingerprint, createMessageFingerprint(message));
    assert.equal(overrides[0].textLength, message.mes.length);
});

test('exact HEAD hash-length overrides preserve siblings and gain identity', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Hello there.' };
    const legacy = {
        hash: hashAttributionMessageText(message.mes),
        textLength: message.mes.length,
        segments: { 0: 'Legacy speaker', 2: 'Sibling speaker' },
    };
    const overrides = { 0: legacy };

    assert.equal(isLegacyAttributionOverrideEntry(legacy, {
        messageHash: hashAttributionMessageText(message.mes),
        textLength: message.mes.length,
    }), true);
    assert.equal(setAttributionOverrideRecord(overrides, reviewFor(message), { message }), true);
    assert.equal(overrides[0], legacy);
    assert.deepEqual(overrides[0].segments, {
        0: 'Legacy speaker',
        1: 'Alice',
        2: 'Sibling speaker',
    });
    assert.equal(overrides[0].messageId, message.id);
    assert.equal(overrides[0].messageFingerprint, createMessageFingerprint(message));
    assert.equal(overrides[0].textLength, message.mes.length);
});

test('pre-fingerprint hash-length overrides reject a different text length', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Same hash input.' };
    const stale = {
        hash: hashAttributionMessageText(message.mes),
        textLength: message.mes.length + 1,
        segments: { 0: 'Stale speaker' },
    };
    const overrides = { 0: stale };

    assert.equal(isLegacyAttributionOverrideEntry(stale, {
        messageHash: hashAttributionMessageText(message.mes),
        textLength: message.mes.length,
    }), false);
    assert.equal(setAttributionOverrideRecord(overrides, reviewFor(message), { message }), true);
    assert.notEqual(overrides[0], stale);
    assert.equal(overrides[0].segments[0], undefined);
    assert.equal(overrides[0].segments[1], 'Alice');
});

test('legacy overrides reject an explicitly invalid text length', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Same hash input.' };
    for (const textLength of [-1, 1.5, '16', null]) {
        const legacy = {
            hash: hashAttributionMessageText(message.mes),
            textLength,
            segments: { 0: 'Stale speaker' },
        };
        assert.equal(isLegacyAttributionOverrideEntry(legacy, {
            messageHash: hashAttributionMessageText(message.mes),
            textLength: message.mes.length,
        }), false);
    }
});

test('override writes replace records bound to a different message identity', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Same text.' };
    const stale = {
        hash: hashAttributionMessageText(message.mes),
        messageId: 'different-message',
        messageFingerprint: createMessageFingerprint({ id: 'different-message', name: 'Other', mes: message.mes }),
        textLength: message.mes.length,
        segments: { 0: 'Stale speaker' },
    };
    const overrides = { 0: stale };

    assert.equal(setAttributionOverrideRecord(overrides, reviewFor(message), { message }), true);
    assert.notEqual(overrides[0], stale);
    assert.equal(overrides[0].segments[0], undefined);
    assert.equal(overrides[0].segments[1], 'Alice');
    assert.equal(overrides[0].messageId, message.id);
});

test('override writes reject a review for changed message content', () => {
    const message = { id: 'message-1', name: 'Narrator', mes: 'Current text.' };
    const overrides = {};
    const review = reviewFor(message, { messageHash: hashAttributionMessageText('Old text.') });

    assert.equal(setAttributionOverrideRecord(overrides, review, { message }), false);
    assert.deepEqual(overrides, {});
});
