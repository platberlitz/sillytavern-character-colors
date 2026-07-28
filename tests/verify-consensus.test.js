import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isSpeakerNamePresentInText,
    normalizeAttributionVerifyPasses,
    reduceAttributionVerifierBallots,
} from '../src/verify-consensus.js';

// Mirrors how verify.js searches: the message plus the two preceding ones.
function groundedIn(name, chat, mesIndex) {
    const texts = [chat[mesIndex]?.mes, chat[mesIndex]?.name];
    for (let i = Math.max(0, mesIndex - 2); i < mesIndex; i++) texts.push(chat[i]?.mes, chat[i]?.name);
    return isSpeakerNamePresentInText(name, texts);
}

function correction(index, speaker, confidence = 0.9) {
    return { index, speaker, confidence, reason: 'speech tag' };
}

test('a single pass keeps every correction it produced', () => {
    const agreed = reduceAttributionVerifierBallots([[correction(0, 'Alice'), correction(1, 'Bram')]]);
    assert.deepEqual(agreed.map(c => [c.index, c.speaker]), [[0, 'Alice'], [1, 'Bram']]);
    assert.equal(agreed[0].confidence, 0.9);
});

test('a correction only two of three passes propose still wins', () => {
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice')],
        [correction(0, 'Alice')],
        [correction(0, 'Cass')],
    ]);
    assert.equal(agreed.length, 1);
    assert.equal(agreed[0].speaker, 'Alice');
    assert.equal(agreed[0].agreement, 2);
    assert.equal(agreed[0].passes, 3);
});

test('a one-off guess is dropped', () => {
    // The exact failure being fixed: a fast model proposes a speaker in one
    // sample out of three and nothing else backs it up.
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice')],
        [],
        [],
    ]);
    assert.deepEqual(agreed, []);
});

test('passes that disagree on the speaker cancel out', () => {
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice')],
        [correction(0, 'Bram')],
        [correction(0, 'Cass')],
    ]);
    assert.deepEqual(agreed, []);
});

test('silence is a vote to leave the segment alone', () => {
    // Two of four passes is not a majority: the other two saying nothing are
    // votes for the current attribution, not abstentions.
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice')],
        [correction(0, 'Alice')],
        [],
        [],
    ]);
    assert.deepEqual(agreed, []);
});

test('the same speaker written two ways counts as one vote', () => {
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice')],
        [correction(0, ' alice ')],
        [],
    ]);
    assert.equal(agreed.length, 1);
    assert.equal(agreed[0].agreement, 2);
});

test('reported confidence cannot exceed the agreement rate', () => {
    // A model that reports 0.99 on every sample must not launder that through
    // a 2-of-3 result, because review policies gate on this number.
    const agreed = reduceAttributionVerifierBallots([
        [correction(0, 'Alice', 0.99)],
        [correction(0, 'Alice', 0.99)],
        [correction(0, 'Bram', 0.99)],
    ]);
    assert.equal(agreed.length, 1);
    assert.ok(agreed[0].confidence <= 2 / 3 + 1e-9, `expected <= 0.667, got ${agreed[0].confidence}`);
});

test('segments are reported in index order regardless of ballot order', () => {
    const agreed = reduceAttributionVerifierBallots([
        [correction(3, 'Cass'), correction(1, 'Alice')],
        [correction(1, 'Alice'), correction(3, 'Cass')],
    ]);
    assert.deepEqual(agreed.map(c => c.index), [1, 3]);
});

test('no ballots yields no corrections', () => {
    assert.deepEqual(reduceAttributionVerifierBallots([]), []);
    assert.deepEqual(reduceAttributionVerifierBallots(null), []);
});

test('pass counts are clamped to a usable range', () => {
    assert.equal(normalizeAttributionVerifyPasses(1), 1);
    assert.equal(normalizeAttributionVerifyPasses(3), 3);
    assert.equal(normalizeAttributionVerifyPasses(0), 1);
    assert.equal(normalizeAttributionVerifyPasses(-4), 1);
    assert.equal(normalizeAttributionVerifyPasses(99), 5);
    assert.equal(normalizeAttributionVerifyPasses(2.7), 2);
    assert.equal(normalizeAttributionVerifyPasses('nonsense'), 1);
    assert.equal(normalizeAttributionVerifyPasses(undefined), 1);
});

const chat = [
    { name: 'Narrator', mes: 'The tavern was loud that night.' },
    { name: 'Alice', mes: '"Over here," Alice called to Bram.' },
    { name: 'Alice', mes: '"Sit down," she said. Cass frowned.' },
];

test('a speaker named in the message is grounded', () => {
    assert.equal(groundedIn('Cass', chat, 2), true);
});

test('a speaker named only in preceding context is grounded', () => {
    assert.equal(groundedIn('Bram', chat, 2), true);
});

test('a speaker who appears nowhere is not grounded', () => {
    // This is the correction that used to auto-create a character under
    // accept-all, from a name the model invented.
    assert.equal(groundedIn('Dorian', chat, 2), false);
});

test('grounding does not match a name inside another word', () => {
    const message = { name: 'Narrator', mes: 'She also frowned.' };
    assert.equal(groundedIn('Al', [message], 0), false);
});

test('grounding matches names with spaces and punctuation', () => {
    const message = { name: 'Narrator', mes: '"Enough," said Mary-Anne O\'Connor.' };
    assert.equal(groundedIn("Mary-Anne O'Connor", [message], 0), true);
});

test('grounding ignores case', () => {
    assert.equal(groundedIn('cass', chat, 2), true);
});

test('an empty or missing name is never grounded', () => {
    assert.equal(groundedIn('', chat, 2), false);
    assert.equal(groundedIn(null, chat, 2), false);
    assert.equal(groundedIn('   ', chat, 2), false);
});

test('regex metacharacters in a name are treated literally', () => {
    const message = { name: 'Narrator', mes: 'The figure called A.B. stepped forward.' };
    assert.equal(groundedIn('A.B.', [message], 0), true);
    assert.equal(groundedIn('AXBX', [message], 0), false);
});
