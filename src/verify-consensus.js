// verify-consensus.js - agreement and grounding rules for LLM attribution
// verification.
//
// Deliberately free of SillyTavern imports so this logic can be unit tested in
// Node. verify.js supplies the chat data and the speaker-name rules; this file
// only decides what survives.

export const MAX_ATTRIBUTION_VERIFY_PASSES = 5;

export function normalizeAttributionVerifyPasses(value, fallback = 1) {
    const passes = Number(value);
    if (!Number.isFinite(passes)) return fallback;
    return Math.min(MAX_ATTRIBUTION_VERIFY_PASSES, Math.max(1, Math.trunc(passes)));
}

/**
 * Collapse several independent verifier samples into the corrections they
 * agree on.
 *
 * A pass that proposes nothing for a segment is not an abstention, it is a
 * vote to leave that segment alone, so the majority is taken over every pass
 * rather than only the ones that spoke. With three passes a correction has to
 * be proposed twice with the same speaker to survive, which is what stops a
 * fast model's one-off guesses from being written to chat metadata.
 *
 * @param {Array<Array<{index:number, speaker:string, confidence:number}>>} ballots
 * @returns {Array<object>} corrections in segment order
 */
export function reduceAttributionVerifierBallots(ballots) {
    const passes = Array.isArray(ballots) ? ballots.length : 0;
    if (!passes) return [];
    const majority = Math.floor(passes / 2) + 1;

    const bySegment = new Map();
    for (const ballot of ballots) {
        if (!Array.isArray(ballot)) continue;
        for (const correction of ballot) {
            if (!correction || !Number.isFinite(correction.index)) continue;
            // The same speaker written two ways is still the same vote.
            const speakerKey = String(correction.speaker ?? '').trim().toLowerCase();
            if (!speakerKey) continue;
            if (!bySegment.has(correction.index)) bySegment.set(correction.index, new Map());
            const votes = bySegment.get(correction.index);
            if (!votes.has(speakerKey)) votes.set(speakerKey, []);
            votes.get(speakerKey).push(correction);
        }
    }

    const agreed = [];
    for (const [index, votes] of bySegment) {
        let winner = null;
        for (const group of votes.values()) {
            if (!winner || group.length > winner.length) winner = group;
        }
        if (!winner || winner.length < majority) continue;
        const meanConfidence = winner.reduce((sum, c) => sum + (Number(c.confidence) || 0), 0) / winner.length;
        const agreementRate = winner.length / passes;
        agreed.push({
            ...winner[0],
            index,
            // Cap the model's self-reported confidence at how often the samples
            // actually agreed. A model that reports 0.99 every time must not
            // launder that through a bare-majority result, because the review
            // policies gate on this number.
            confidence: passes > 1 ? Math.min(meanConfidence, agreementRate) : meanConfidence,
            agreement: winner.length,
            passes,
        });
    }
    return agreed.sort((a, b) => a.index - b.index);
}

function escapeRegexLiteral(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a speaker name literally occurs in any of the supplied texts.
 *
 * Boundaries are non-alphanumeric rather than \b so that names containing
 * spaces, apostrophes, or hyphens still match, while "Al" does not match
 * "also".
 *
 * @param {string} name already normalized speaker name
 * @param {Array<unknown>} texts message bodies and speaker labels to search
 */
export function isSpeakerNamePresentInText(name, texts) {
    const needle = String(name ?? '').trim();
    if (!needle) return false;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegexLiteral(needle)}([^\\p{L}\\p{N}]|$)`, 'iu');
    return (Array.isArray(texts) ? texts : []).some(text => typeof text === 'string' && pattern.test(text));
}
