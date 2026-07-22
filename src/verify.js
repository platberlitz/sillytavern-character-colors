// verify.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS, normalizeAttributionConfidence } from './attribution-store.js';
import { buildNameColorLookup, collectFontColorsFromText, parseNamedColorAssignmentsFromText, resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { cancelMessageDomFollowupRepairs, clearMessageDomRepairTimer, clearStreamingAttributionOverrides, decorateMessageDomFromCurrentRender, decorateObservedMessages, getMessageQuoteOverrideEntry, getMessageQuoteOverrideOptions, isMessageAttributionVerified, markMessageAttributionVerified, scheduleMessageDomFollowupRepair, setMessageQuoteOverride, setStreamingAttributionOverride, suspendMessageDomWorkForEdit, upsertAttributionReview } from './dom-engine.js';
import { callLLMWithProfile } from './llm.js';
import { formatPromptLiteralSymbol, getThoughtDelimiterSymbols } from './prompts.js';
import { getContext } from './st-api.js';
import { AUTO_ATTRIBUTION_VERIFY_DELAY_MS, AUTO_ATTRIBUTION_VERIFY_RENDERED_LIMIT, AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS, AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS, MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS, attributionChatGeneration, autoAttributionVerifyTimer, autoAttributionVerifyTimerDue, characterColors, isDomEngine, isStreamingGenerationActive, isVerifyingAttribution, lastStreamingAttributionVerifyKey, pendingAttributionVerifications, pendingAutoAttributionVerifyIndices, recentAutoAttributionVerifyAttempts, setAutoAttributionVerifyTimer, setAutoAttributionVerifyTimerDue, setIsVerifyingAttribution, setLastStreamingAttributionVerifyKey, setStreamingAttributionGeneration, setStreamingAttributionVerifyTimer, settings, streamingAttributionGeneration, streamingAttributionVerifyTimer } from './state.js';
import { setVerifyAttributionButtonBusy } from './ui.js';
import { getMessageElementByIndex, hashMessageText, isCompositeSpeakerLabel, toast, unwrapCodeFence } from './utils.js';

export function isMessageEligibleForAttributionVerification(msg) {
    return !!msg && !msg.is_system && !!msg.mes && !collectFontColorsFromText(msg.mes).size;
}

export const MAX_ATTRIBUTION_VERIFIER_RESPONSE_CHARS = 65536;
export const MAX_ATTRIBUTION_VERIFIER_CORRECTIONS = 50;
export const AUTO_HIGH_ATTRIBUTION_CONFIDENCE = 0.85;

const RESERVED_VERIFIER_SPEAKER_NAMES = new Set(['unknown', 'unclear', 'narrator', 'none', 'n/a']);
const RESERVED_VERIFIER_SPEAKER_SYNTAX = /[\u0000-\u001f\u007f\[\]{}<>=,():;]/;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAttributionVerifierSpeaker(value) {
    if (typeof value !== 'string') return null;
    const speaker = value.trim();
    if (!speaker || speaker.length > 80 || RESERVED_VERIFIER_SPEAKER_SYNTAX.test(speaker)) return null;
    if (RESERVED_VERIFIER_SPEAKER_NAMES.has(speaker.toLowerCase()) || isCompositeSpeakerLabel(speaker)) return null;
    return speaker;
}

export function normalizeAttributionVerifierConfidence(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1
        ? normalizeAttributionConfidence(value)
        : null;
    if (typeof value !== 'string') return null;
    const text = value.trim().toLowerCase();
    const labels = { none: 0, low: 0.25, medium: 0.5, high: 0.75, certain: 1 };
    if (Object.prototype.hasOwnProperty.call(labels, text)) return labels[text];
    if (!/^\d+(?:\.\d+)?%?$/.test(text)) return null;
    const numeric = Number.parseFloat(text) / (text.endsWith('%') ? 100 : 1);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
        ? normalizeAttributionConfidence(numeric)
        : null;
}

export function normalizeAttributionVerifierReason(value) {
    if (typeof value !== 'string') return null;
    const reason = value.trim();
    if (!reason || reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason)) return null;
    return reason;
}

export function normalizeAttributionVerifierCorrection(value) {
    if (!isPlainObject(value)) return null;
    const index = Number(value.index);
    const speaker = normalizeAttributionVerifierSpeaker(value.speaker);
    const confidence = normalizeAttributionVerifierConfidence(value.confidence);
    const reason = normalizeAttributionVerifierReason(value.reason);
    if (!Number.isInteger(index) || index < 0 || !speaker || confidence === null || !reason) return null;
    return { index, speaker, confidence, reason };
}

export function validateAttributionVerifierCorrections(corrections, segments = null) {
    if (!Array.isArray(corrections) || corrections.length > MAX_ATTRIBUTION_VERIFIER_CORRECTIONS) return null;
    const segmentIndexes = Array.isArray(segments) ? new Set(segments.map(segment => segment?.index)) : null;
    const indexes = new Set();
    const normalized = [];
    for (const correction of corrections) {
        const valid = normalizeAttributionVerifierCorrection(correction);
        if (!valid || indexes.has(valid.index) || (segmentIndexes && !segmentIndexes.has(valid.index))) return null;
        indexes.add(valid.index);
        normalized.push(valid);
    }
    return normalized;
}

export function isAutoAttributionVerificationEnabled() {
    return settings.enabled && isDomEngine() && (settings.llmAttributionCheck || settings.llmAttributionParallel);
}

export function getAutoAttributionVerifyKey(mesIndex, msg) {
    return `${mesIndex}:${hashMessageText(msg?.mes)}`;
}

export function getAutoAttributionMessageId(msg) {
    const id = msg?.id ?? msg?.send_date ?? '';
    return id === null || id === undefined ? '' : String(id);
}

export function pruneRecentAutoAttributionVerifyAttempts(now = Date.now()) {
    const maxAge = AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS * 2;
    for (const [key, timestamp] of recentAutoAttributionVerifyAttempts.entries()) {
        if (now - timestamp > maxAge) recentAutoAttributionVerifyAttempts.delete(key);
    }
    for (const [key, record] of stabilityVerifyRetries.entries()) {
        if (now - record.at > maxAge) stabilityVerifyRetries.delete(key);
    }
}

export function clearAutoAttributionVerificationQueue(options = {}) {
    clearTimeout(autoAttributionVerifyTimer);
    setAutoAttributionVerifyTimer(null);
    setAutoAttributionVerifyTimerDue(0);
    pendingAutoAttributionVerifyIndices.clear();
    if (options.clearCooldown) {
        recentAutoAttributionVerifyAttempts.clear();
        stabilityVerifyRetries.clear();
    }
}

export function shouldQueueAutoAttributionVerification(mesIndex, msg, options = {}) {
    if (!isAutoAttributionVerificationEnabled()) return false;
    if (isStreamingGenerationActive && !options.allowDuringStreaming) return false;
    if (!Number.isFinite(mesIndex) || mesIndex < 0) return false;
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(mesIndex), mesIndex)) return false;
    if (!isMessageEligibleForAttributionVerification(msg) || isMessageAttributionVerified(mesIndex, msg)) return false;

    if (!options.force) {
        const key = getAutoAttributionVerifyKey(mesIndex, msg);
        const lastAttempt = recentAutoAttributionVerifyAttempts.get(key) || 0;
        if (Date.now() - lastAttempt < AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS) return false;
    }
    return true;
}

export function scheduleAutoAttributionVerificationDrain(delay = AUTO_ATTRIBUTION_VERIFY_DELAY_MS) {
    if (!isAutoAttributionVerificationEnabled() || !pendingAutoAttributionVerifyIndices.size) return;
    const nextDue = Date.now() + Math.max(0, delay);
    if (autoAttributionVerifyTimer && autoAttributionVerifyTimerDue <= nextDue) return;
    clearTimeout(autoAttributionVerifyTimer);
    setAutoAttributionVerifyTimerDue(nextDue);
    setAutoAttributionVerifyTimer(setTimeout(() => {
        setAutoAttributionVerifyTimer(null);
        setAutoAttributionVerifyTimerDue(0);
        drainAutoAttributionVerificationQueue()
            .catch(e => console.warn('[Dialogue Colors] Automatic attribution verification queue failed:', e));
    }, Math.max(0, nextDue - Date.now())));
}

function boundPendingAutoAttributionVerifications() {
    if (pendingAutoAttributionVerifyIndices.size <= MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS) return;
    const retained = Array.from(pendingAutoAttributionVerifyIndices.values())
        .sort((left, right) => right.mesIndex - left.mesIndex)
        .slice(0, MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS);
    pendingAutoAttributionVerifyIndices.clear();
    retained.reverse().forEach(item => pendingAutoAttributionVerifyIndices.set(item.key, item));
}

export function queueAutoAttributionVerificationForMessage(mesIndex, options = {}) {
    const index = Number(mesIndex);
    const msg = getContext()?.chat?.[index];
    if (!shouldQueueAutoAttributionVerification(index, msg, options)) return false;

    const key = getAutoAttributionVerifyKey(index, msg);
    const existing = pendingAutoAttributionVerifyIndices.get(key);
    pendingAutoAttributionVerifyIndices.set(key, {
        key,
        mesIndex: index,
        messageId: getAutoAttributionMessageId(msg),
        chatGeneration: attributionChatGeneration,
        force: options.force === true || existing?.force === true,
    });
    boundPendingAutoAttributionVerifications();
    scheduleAutoAttributionVerificationDrain(options.delay ?? AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
    return true;
}

export function queueAutoAttributionVerificationForElements(elements, options = {}) {
    if (!elements?.length) return false;
    let queued = false;
    for (const mesElement of elements) {
        const mesIndex = Number(mesElement?.getAttribute?.('mesid'));
        if (queueAutoAttributionVerificationForMessage(mesIndex, options)) queued = true;
    }
    return queued;
}

export function queueAutoAttributionVerificationForRenderedMessages(options = {}) {
    const messages = Array.from(document.querySelectorAll('#chat .mes[mesid]'))
        .reverse()
        .slice(0, AUTO_ATTRIBUTION_VERIFY_RENDERED_LIMIT);
    return queueAutoAttributionVerificationForElements(messages, options);
}

// Cap forced stability re-checks so a nondeterministic model that flip-flops on
// a segment cannot loop forever (each pass costs a full LLM call + repaint).
const AUTO_VERIFY_STABILITY_MAX_RETRIES = 2;
const stabilityVerifyRetries = new Map(); // verify key -> { count, at }

export function queueAutoAttributionVerificationAfterCorrections(mesIndex, result, options = {}) {
    if (!result?.checked || !(result.corrections > 0)) return false;
    const index = Number(mesIndex);
    if (!Number.isFinite(index) || index < 0) return false;
    const msg = getContext()?.chat?.[index];
    if (!msg) return false;
    const key = getAutoAttributionVerifyKey(index, msg);
    const record = stabilityVerifyRetries.get(key);
    const count = record?.count || 0;
    if (count >= AUTO_VERIFY_STABILITY_MAX_RETRIES) return false;
    stabilityVerifyRetries.set(key, { count: count + 1, at: Date.now() });
    return queueAutoAttributionVerificationForMessage(index, {
        force: true,
        delay: options.delay ?? AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS,
    });
}

export async function drainAutoAttributionVerificationQueue() {
    if (!pendingAutoAttributionVerifyIndices.size) return;
    if (!isAutoAttributionVerificationEnabled()) {
        pendingAutoAttributionVerifyIndices.clear();
        return;
    }
    if (isStreamingGenerationActive) {
        scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
        return;
    }

    const queued = Array.from(pendingAutoAttributionVerifyIndices.values());
    pendingAutoAttributionVerifyIndices.clear();
    pruneRecentAutoAttributionVerifyAttempts();
    const deferredItems = [];

    for (let i = 0; i < queued.length; i++) {
        const item = queued[i];
        if (!isAutoAttributionVerificationEnabled()) break;
        if (isStreamingGenerationActive) {
            // Streaming started mid-drain: re-queue the whole unprocessed suffix,
            // not just the current item, so no message silently loses verification.
            for (const rest of queued.slice(i)) pendingAutoAttributionVerifyIndices.set(rest.key, rest);
            boundPendingAutoAttributionVerifications();
            scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
            break;
        }
        if (item.chatGeneration !== attributionChatGeneration) continue;

        const msg = getContext()?.chat?.[item.mesIndex];
        if (suspendMessageDomWorkForEdit(getMessageElementByIndex(item.mesIndex), item.mesIndex)) {
            deferredItems.push(item);
            continue;
        }
        if (!isMessageEligibleForAttributionVerification(msg) || isMessageAttributionVerified(item.mesIndex, msg)) continue;
        const currentKey = getAutoAttributionVerifyKey(item.mesIndex, msg);
        if (currentKey !== item.key) continue;
        const currentMessageId = getAutoAttributionMessageId(msg);
        if (item.messageId && currentMessageId && item.messageId !== currentMessageId) continue;

        const now = Date.now();
        const lastAttempt = recentAutoAttributionVerifyAttempts.get(currentKey) || 0;
        if (!item.force && now - lastAttempt < AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS) continue;
        recentAutoAttributionVerifyAttempts.set(currentKey, now);
        pruneRecentAutoAttributionVerifyAttempts(now);

        try {
            await runAttributionVerification(
                async () => {
                    const result = await verifyAttributionsWithLLM(item.mesIndex, { manual: false, quiet: true });
                    queueAutoAttributionVerificationAfterCorrections(item.mesIndex, result);
                    return result;
                },
                { manual: false, queueKey: `auto:${currentKey}` }
            );
        } catch (e) {
            console.warn('[Dialogue Colors] Automatic attribution verification failed:', e);
        }
    }
    if (deferredItems.length) {
        for (const item of deferredItems) pendingAutoAttributionVerifyIndices.set(item.key, item);
        boundPendingAutoAttributionVerifications();
        scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
    }
}

export function collectJsonObjectCandidates(text) {
    const candidates = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    const source = String(text ?? '');

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
            continue;
        }
        if (ch === '}' && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                candidates.push(source.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return candidates;
}

export function parseAttributionVerifierResponse(responseText) {
    if (!responseText || typeof responseText !== 'string' || responseText.length > MAX_ATTRIBUTION_VERIFIER_RESPONSE_CHARS) return null;
    // Strip common reasoning/thinking wrappers so we can find the final JSON.
    let cleaned = responseText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/### Reasoning:[\s\S]*?(?=###|(?=\{)|$)/gi, '')
        .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
    const fencedBlocks = [];
    cleaned.replace(/```(?:json|javascript|js|text|txt)?\s*([\s\S]*?)\s*```/gi, (_, body) => {
        fencedBlocks.push(String(body ?? '').trim());
        return '';
    });
    cleaned = unwrapCodeFence(cleaned).trim();

    const candidates = [];
    for (const source of [...fencedBlocks, cleaned]) {
        if (!source) continue;
        candidates.push(source);
        const objects = collectJsonObjectCandidates(source);
        for (let i = objects.length - 1; i >= 0; i--) candidates.push(objects[i]);
    }

    const seen = new Set();
    for (const candidate of candidates) {
        const trimmed = String(candidate ?? '').trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        try {
            const parsed = JSON.parse(trimmed);
            const corrections = Array.isArray(parsed) ? parsed : parsed?.corrections;
            // Only accept candidates that actually carry a corrections array; a
            // parseable-but-wrong-shape object (e.g. a trailing status object)
            // must not hide the real answer later in the candidate list.
            const validated = validateAttributionVerifierCorrections(corrections);
            if (validated) return validated;
        } catch { /* try next candidate */ }
    }
    return null;
}

export function buildAttributionVerifierPrompt(msg, mesIndex, segments, lookup) {
    const thoughtSymbols = getThoughtDelimiterSymbols();
    const thoughtSymbolList = thoughtSymbols.map(formatPromptLiteralSymbol).join(', ');
    const knownNames = [];
    const seenNames = new Set();
    const addKnownName = name => {
        const trimmed = String(name ?? '').trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seenNames.has(key) || isCompositeSpeakerLabel(trimmed)) return;
        seenNames.add(key);
        knownNames.push(trimmed);
    };
    for (const entry of Object.values(characterColors)) {
        addKnownName(entry.name);
        for (const alias of entry.aliases || []) addKnownName(alias);
    }
    for (const assignment of lookup.values()) addKnownName(assignment.name);
    addKnownName(msg?.name);

    const quoteList = segments
        .map(seg => `${seg.index}. current=${seg.assignment?.name || 'Uncolored/Unknown'} delimiter=${JSON.stringify(seg.delimiter)} text=${JSON.stringify(seg.text)}`)
        .join('\n');
    const knownList = knownNames.length ? knownNames.join(', ') : '(none)';
    const conservativeLine = settings.attributionConservativeOnly
        ? 'Include a correction only when the current speaker is Uncolored/Unknown and the speaker is clear enough to color it.'
        : 'Include a correction when the current speaker is clearly wrong, or when a segment is Uncolored/Unknown and the speaker is clear enough to color it.';
    const thoughtLine = thoughtSymbolList
        ? `\n- Configured inner-thought delimiters: ${thoughtSymbolList}. Treat those as dialogue segments that also need speaker attribution.`
        : '';

    return `[Dialogue Colors — verify quote speakers]
Return ONLY valid JSON. No reasoning, no Markdown, no code fence, no extra text.

Required schema:
{"corrections":[{"index":0,"speaker":"Name","confidence":0.95,"reason":"explicit speaker tag"}]}

If there are no corrections, return exactly:
{"corrections":[]}

Rules:
1. ${conservativeLine}
2. If the current speaker is already correct, omit that segment.
3. If the speaker is unclear or only a guess, omit that segment.
4. Use one speaker name only, preferably from the known speakers and aliases.
5. Include a numeric confidence from 0 to 1 and a short evidence-based reason for every correction.
6. If an explicitly named speaker is not known, it may be proposed for review but will not be applied automatically.
7. Do not use Unknown, Unclear, None, N/A, Narrator, or a group/composite name as a speaker correction.
8. Correction indexes must match the numbered segment list exactly.

Context:
- Message index: ${mesIndex}
- Message speaker/fallback: ${msg?.name || 'Unknown'}
- Known speakers and aliases: ${knownList}${thoughtLine}

Full message text:
${msg?.mes || ''}

Numbered dialogue/thought segments:
${quoteList}`;
}

export function resolveVerifierSpeakerName(rawName, lookup) {
    const speakerName = normalizeAttributionVerifierSpeaker(rawName);
    if (!speakerName) return { assignment: null, created: false };
    // Verifier output may only reuse a configured character or alias. A model
    // suggestion must never create a new character entry on its own.
    const key = resolveCharacterKeyByNameOrAlias(speakerName);
    if (!key || !characterColors[key]) return { assignment: null, created: false };
    const assignment = lookup.get(speakerName.toLowerCase())
        || lookup.get(characterColors[key].name.toLowerCase())
        || lookup.get(key)
        || null;
    return { assignment, created: false };
}

export function getAttributionReviewPolicy(value = settings.attributionReviewPolicy) {
    const policy = String(value ?? '').trim().toLowerCase();
    return ['review', 'auto-high', 'legacy-auto'].includes(policy) ? policy : 'review';
}

export function isHumanAttributionOverride(source) {
    return source !== ATTRIBUTION_SOURCE.LLM;
}

function captureAttributionVerificationTarget(mesIndex, msg, segments) {
    return {
        mesIndex,
        message: msg,
        messageId: getAutoAttributionMessageId(msg),
        text: String(msg?.mes ?? ''),
        segments: new Map(segments.map(segment => [segment.index, {
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            delimiter: segment.delimiter,
        }])),
    };
}

function isAttributionVerificationTargetCurrent(target, { allowAppendedText = false } = {}) {
    const msg = getContext()?.chat?.[target.mesIndex];
    if (msg !== target.message || getAutoAttributionMessageId(msg) !== target.messageId) return false;
    const currentText = String(msg?.mes ?? '');
    return currentText === target.text || (allowAppendedText && currentText.startsWith(target.text));
}

function hasCurrentVerifierSegments(target, segments) {
    const current = new Map(segments.map(segment => [segment.index, segment]));
    for (const original of target.segments.values()) {
        const next = current.get(original.index);
        if (!next || next.start !== original.start || next.end !== original.end
            || next.text !== original.text || next.delimiter !== original.delimiter) return false;
    }
    return true;
}

function isAttributionVerificationTargetAndSegmentsCurrent(target, options = {}) {
    if (!isAttributionVerificationTargetCurrent(target, options)) return false;
    const msg = getContext()?.chat?.[target.mesIndex];
    const attribution = attributeDialogueSegments(msg?.mes, msg?.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(target.mesIndex, msg),
        mesIndex: target.mesIndex,
    });
    return hasCurrentVerifierSegments(target, attribution.segments);
}

function createVerifierEvidence(segment, correction) {
    const evidence = [{
        type: 'verifier-correction',
        source: ATTRIBUTION_SOURCE.LLM,
        speaker: correction.speaker,
        detail: correction.reason,
        segmentIndex: segment.index,
    }];
    if (segment.provenance?.source) {
        evidence.push({
            type: 'heuristic-provenance',
            source: segment.provenance.source,
            method: segment.provenance.method,
            speaker: segment.assignment?.name,
            detail: segment.evidence?.map(item => item.type).filter(Boolean).join(', '),
            segmentIndex: segment.index,
        });
    }
    return evidence;
}

export async function verifyAttributionsWithLLM(mesIndex, options = {}) {
    if (!settings.enabled || !isDomEngine()) return { checked: false, corrections: 0, createdCharacters: false };
    const ctx = getContext();
    const msg = ctx?.chat?.[mesIndex];
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(mesIndex), mesIndex)) return { checked: false, corrections: 0, createdCharacters: false };
    if (!isMessageEligibleForAttributionVerification(msg)) return { checked: false, corrections: 0, createdCharacters: false };
    const skipMarkVerified = options.skipMarkVerified === true;
    const useTransientOverrides = options.transientOverrides === true;
    const quiet = options.quiet === true;
    if (!options.manual && isMessageAttributionVerified(mesIndex, msg)) return { checked: false, corrections: 0, createdCharacters: false };

    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        // A verifier pass must not create characters just because the model or
        // message speaker names someone not already configured.
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex,
    });
    const segments = attribution.segments;
    if (!segments.length) {
        if (!skipMarkVerified && !useTransientOverrides) {
            markMessageAttributionVerified(mesIndex, msg, ATTRIBUTION_VERIFICATION_STATUS.CLEAN);
            clearStreamingAttributionOverrides(mesIndex);
        }
        return { checked: true, corrections: 0, createdCharacters: false, queuedReviews: 0 };
    }

    const localAssignments = parseNamedColorAssignmentsFromText(msg.mes);
    const lookup = buildNameColorLookup(localAssignments);
    const target = captureAttributionVerificationTarget(mesIndex, msg, segments);

    const jsonSchema = {
        type: 'object',
        properties: {
            corrections: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        index: { type: 'integer' },
                        speaker: { type: 'string' },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                        reason: { type: 'string', minLength: 1, maxLength: 240 },
                    },
                    required: ['index', 'speaker', 'confidence', 'reason'],
                    additionalProperties: false,
                },
                maxItems: MAX_ATTRIBUTION_VERIFIER_CORRECTIONS,
            },
        },
        required: ['corrections'],
        additionalProperties: false,
    };

    let corrections = null;
    try {
        const response = await callLLMWithProfile(buildAttributionVerifierPrompt(msg, mesIndex, segments, lookup), {
            profileId: settings.attributionConnectionProfile,
            quietName: `DC_Attr_${mesIndex}_${Date.now()}`,
            jsonSchema,
            maxTokens: Number.isFinite(settings.attributionMaxTokens) && settings.attributionMaxTokens > 0 ? settings.attributionMaxTokens : 4096,
        });
        corrections = parseAttributionVerifierResponse(response);
    } catch (e) {
        console.warn('[Dialogue Colors] LLM attribution verification failed:', e);
        if (!quiet) toast.warning('Color verification failed (see console).');
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    if (!Array.isArray(corrections)) {
        console.warn('[Dialogue Colors] LLM attribution verification returned invalid JSON.');
        if (!quiet) toast.warning('Color verification failed (see console).');
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    // A verifier response is only valid for the exact message object, stable
    // message ID, and text snapshot it was generated from. Streaming previews
    // may retain their already-complete segments when text is appended.
    if (!isAttributionVerificationTargetCurrent(target, { allowAppendedText: useTransientOverrides })) {
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    const currentAttribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex,
    });
    const validCorrections = validateAttributionVerifierCorrections(corrections, currentAttribution.segments);
    if (!validCorrections || !hasCurrentVerifierSegments(target, currentAttribution.segments)) {
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    const segmentByIndex = new Map(currentAttribution.segments.map(segment => [segment.index, segment]));
    const currentLookup = buildNameColorLookup(parseNamedColorAssignmentsFromText(msg.mes));
    const policy = getAttributionReviewPolicy();
    let appliedCorrections = 0;
    let queuedReviews = 0;
    for (const correction of validCorrections) {
        const seg = segmentByIndex.get(correction.index);
        const { assignment } = resolveVerifierSpeakerName(correction.speaker, currentLookup);
        if (assignment?.key === seg.assignment?.key) continue;

        const latestEntry = getMessageQuoteOverrideEntry(mesIndex, msg, !useTransientOverrides);
        const existingOverride = latestEntry?.segments?.[String(correction.index)];
        const existingSource = latestEntry?.sources?.[String(correction.index)];
        const hasHumanOverride = !!existingOverride && isHumanAttributionOverride(existingSource);
        const canAutoApply = !settings.attributionConservativeOnly || !seg.assignment?.key;
        const evidence = createVerifierEvidence(seg, correction);
        const shouldQueueReview = !useTransientOverrides && (
            policy === 'review'
            || !assignment
            || !canAutoApply
            || (policy === 'auto-high' && (correction.confidence < AUTO_HIGH_ATTRIBUTION_CONFIDENCE || hasHumanOverride))
        );
        if (shouldQueueReview) {
            const review = upsertAttributionReview({
                message: msg,
                messageIndex: mesIndex,
                messageId: target.messageId,
                messageHash: hashMessageText(target.text),
                segment: seg,
                currentSpeaker: seg.assignment?.name,
                proposedSpeaker: correction.speaker,
                source: ATTRIBUTION_SOURCE.LLM,
                confidence: correction.confidence,
                reason: correction.reason,
                evidence,
            });
            if (review) queuedReviews++;
            continue;
        }

        const shouldApply = !!assignment && !hasHumanOverride && canAutoApply && (
            policy === 'legacy-auto'
            || (policy === 'auto-high' && correction.confidence >= AUTO_HIGH_ATTRIBUTION_CONFIDENCE)
        );
        if (!shouldApply) continue;
        const didSetOverride = useTransientOverrides
            ? setStreamingAttributionOverride(mesIndex, msg, correction.index, assignment.name, { source: ATTRIBUTION_SOURCE.LLM })
            : setMessageQuoteOverride(mesIndex, msg, correction.index, assignment.name, {
                source: ATTRIBUTION_SOURCE.LLM,
                confidence: correction.confidence,
                evidence,
            });
        if (didSetOverride) {
            appliedCorrections++;
        }
    }

    if (!skipMarkVerified && !useTransientOverrides) {
        const verificationStatus = queuedReviews > 0
            ? ATTRIBUTION_VERIFICATION_STATUS.PENDING_REVIEW
            : appliedCorrections > 0
                ? ATTRIBUTION_VERIFICATION_STATUS.AUTO_APPLIED
                : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
        if (!isAttributionVerificationTargetCurrent(target)) {
            return { checked: false, corrections: 0, createdCharacters: false };
        }
        markMessageAttributionVerified(mesIndex, msg, verificationStatus);
        clearStreamingAttributionOverrides(mesIndex);
    }
    if (appliedCorrections) {
        clearMessageDomRepairTimer(mesIndex);
        cancelMessageDomFollowupRepairs(mesIndex);
        // Verifier corrections only change override metadata; decorate the
        // already-rendered DOM without an innerHTML fallback write.
        if (isAttributionVerificationTargetAndSegmentsCurrent(target, { allowAppendedText: useTransientOverrides })) {
            const repainted = await decorateMessageDomFromCurrentRender(mesIndex, msg, { queueVerification: false, renderFallback: false });
            if (repainted && isAttributionVerificationTargetAndSegmentsCurrent(target, { allowAppendedText: useTransientOverrides })) {
                scheduleMessageDomFollowupRepair(mesIndex, repainted);
            }
        }
    } else {
        const mesElement = document.querySelector(`#chat .mes[mesid="${mesIndex}"]`) || document.querySelectorAll('#chat .mes[mesid]')[mesIndex];
        if (mesElement && isAttributionVerificationTargetCurrent(target, { allowAppendedText: useTransientOverrides })) {
            decorateObservedMessages([mesElement]);
        }
    }

    return { checked: true, corrections: appliedCorrections, createdCharacters: false, queuedReviews };
}

export async function verifyLatestAttributionsWithLLM(options = {}) {
    const chat = getContext()?.chat || [];
    if (!chat.length) {
        if (options.manual) toast.info('No messages to verify.');
        return { checked: false, corrections: 0, createdCharacters: false };
    }
    const lastIdx = chat.length - 1;
    const msg = chat[lastIdx];
    if (!isMessageEligibleForAttributionVerification(msg) || (!options.manual && isMessageAttributionVerified(lastIdx, msg))) {
        if (options.manual) toast.info('Latest message already verified or not eligible.');
        return { checked: false, corrections: 0, createdCharacters: false };
    }
    toast.info('Verifying dialogue colors with LLM...');
    const result = await verifyAttributionsWithLLM(lastIdx, options);
    if (result.checked && result.corrections > 0) toast.info(`Verified DOM colors: applied ${result.corrections} correction${result.corrections !== 1 ? 's' : ''}.`);
    else if (result.checked && result.corrections === 0) toast.info('Verified colors: no corrections needed.');
    return result;
}

export async function verifyVisibleAttributionsWithLLM(options = {}) {
    const chat = getContext()?.chat || [];
    const indices = Array.from(document.querySelectorAll('#chat .mes[mesid]'))
        .map(el => Number(el.getAttribute('mesid')))
        .filter(index => Number.isInteger(index) && index >= 0)
        .reverse();
    let checked = 0;
    let corrections = 0;
    toast.info('Verifying visible messages with LLM...');
    for (const index of indices) {
        const msg = chat[index];
        if (!isMessageEligibleForAttributionVerification(msg) || (!options.manual && isMessageAttributionVerified(index, msg))) continue;
        const result = await verifyAttributionsWithLLM(index, options);
        if (result.checked) checked++;
        corrections += result.corrections || 0;
    }
    if (corrections > 0) toast.info(`Verified DOM colors: applied ${corrections} correction${corrections !== 1 ? 's' : ''}.`);
    else if (options.manual && !checked) toast.info('No unverified visible DOM messages to check.');
    else if (options.manual && checked) toast.info('Verified visible colors: no corrections needed.');
    return { checked: checked > 0, corrections, createdCharacters: false };
}

export async function runAttributionVerification(action, options = {}) {
    if (isVerifyingAttribution) {
        if (options.manual) toast.info('Attribution verification is already running.');
        else if (options.queue !== false) {
            const queued = { action, options };
            const queueKey = options.queueKey ? String(options.queueKey) : '';
            const existingIndex = queueKey
                ? pendingAttributionVerifications.findIndex(item => item.options?.queueKey === queueKey)
                : -1;
            if (existingIndex >= 0) pendingAttributionVerifications[existingIndex] = queued;
            else {
                pendingAttributionVerifications.push(queued);
                if (pendingAttributionVerifications.length > MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS) {
                    pendingAttributionVerifications.splice(0, pendingAttributionVerifications.length - MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS);
                }
            }
        }
        return { checked: false, corrections: 0, createdCharacters: false, queued: !options.manual && options.queue !== false };
    }
    setIsVerifyingAttribution(true);
    setVerifyAttributionButtonBusy(true);
    try {
        return await action();
    } finally {
        setIsVerifyingAttribution(false);
        const next = pendingAttributionVerifications.shift();
        if (next) {
            setTimeout(() => {
                runAttributionVerification(next.action, next.options)
                    .catch(e => console.warn('[Dialogue Colors] Queued attribution verification failed:', e));
            }, 0);
        } else {
            setVerifyAttributionButtonBusy(false);
        }
    }
}

export function cancelStreamingAttributionVerification(options = {}) {
    clearTimeout(streamingAttributionVerifyTimer);
    setStreamingAttributionVerifyTimer(null);
    setStreamingAttributionGeneration(streamingAttributionGeneration + 1);
    setLastStreamingAttributionVerifyKey('');
    if (options.clearOverrides) clearStreamingAttributionOverrides();
}

export function scheduleStreamingAttributionVerification() {
    if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return;
    if (getAttributionReviewPolicy() === 'review') return;
    // Continuous loop: do NOT reset an already-scheduled timer on every token.
    // The loop reschedules itself from runStreamingAttributionVerification's finally,
    // so we only arm the timer when nothing is pending.
    if (streamingAttributionVerifyTimer) return;
    const chat = getContext()?.chat || [];
    const mesIndex = chat.length - 1;
    const msg = chat[mesIndex];
    if (!isMessageEligibleForAttributionVerification(msg)) return;

    const generation = streamingAttributionGeneration;
    setStreamingAttributionVerifyTimer(setTimeout(() => {
        setStreamingAttributionVerifyTimer(null);
        runStreamingAttributionVerification(mesIndex, generation)
            .catch(e => console.warn('[Dialogue Colors] Streaming attribution verification failed:', e));
    }, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS));
}

export function rescheduleStreamingAttributionVerification(mesIndex, generation) {
    if (generation !== streamingAttributionGeneration) return;
    if (!isStreamingGenerationActive) return;
    if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return;
    if (getAttributionReviewPolicy() === 'review') return;
    if (streamingAttributionVerifyTimer) return;
    setStreamingAttributionVerifyTimer(setTimeout(() => {
        setStreamingAttributionVerifyTimer(null);
        runStreamingAttributionVerification(mesIndex, generation)
            .catch(e => console.warn('[Dialogue Colors] Streaming attribution verification failed:', e));
    }, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS));
}

export async function runStreamingAttributionVerification(mesIndex, generation) {
    try {
        if (generation !== streamingAttributionGeneration) return { checked: false, corrections: 0, createdCharacters: false };
        if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return { checked: false, corrections: 0, createdCharacters: false };
        if (getAttributionReviewPolicy() === 'review') return { checked: false, corrections: 0, createdCharacters: false };
        if (isVerifyingAttribution) return { checked: false, corrections: 0, createdCharacters: false };

        const msg = getContext()?.chat?.[mesIndex];
        if (!isMessageEligibleForAttributionVerification(msg)) return { checked: false, corrections: 0, createdCharacters: false };

        const verifyKey = `${mesIndex}:${hashMessageText(msg.mes)}`;
        if (verifyKey !== lastStreamingAttributionVerifyKey) {
            const result = await runAttributionVerification(
                () => verifyAttributionsWithLLM(mesIndex, { manual: false, skipMarkVerified: true, transientOverrides: true, quiet: true }),
                { manual: false, queue: false }
            );
            setLastStreamingAttributionVerifyKey(result.checked && result.corrections === 0 ? verifyKey : '');
            return result;
        }
        return { checked: false, corrections: 0, createdCharacters: false };
    } finally {
        // Self-perpetuating loop: keep re-checking while streaming is active.
        // New tokens may have arrived since the last run; rescheduling lets us
        // re-verify dialogue attributed in the interim.
        rescheduleStreamingAttributionVerification(mesIndex, generation);
    }
}
