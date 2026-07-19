// verify.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments, ensureCharacterEntry } from './attribution.js';
import { buildNameColorLookup, collectFontColorsFromText, parseNamedColorAssignmentsFromText, registerLookupAssignment, resolveSingleSpeakerAssignment } from './color-blocks.js';
import { cancelMessageDomFollowupRepairs, clearMessageDomRepairTimer, clearStreamingAttributionOverrides, decorateMessageDomFromCurrentRender, decorateObservedMessages, getMessageQuoteOverrideEntry, getMessageQuoteOverridesForDecoration, isMessageAttributionVerified, markMessageAttributionVerified, scheduleMessageDomFollowupRepair, setMessageQuoteOverride, setStreamingAttributionOverride, suspendMessageDomWorkForEdit } from './dom-engine.js';
import { callLLMWithProfile } from './llm.js';
import { getEntryEffectiveColor } from './palettes.js';
import { formatPromptLiteralSymbol, getThoughtDelimiterSymbols } from './prompts.js';
import { getContext } from './st-api.js';
import { AUTO_ATTRIBUTION_VERIFY_DELAY_MS, AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS, AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS, attributionChatGeneration, autoAttributionVerifyTimer, autoAttributionVerifyTimerDue, characterColors, isDomEngine, isStreamingGenerationActive, isVerifyingAttribution, lastStreamingAttributionVerifyKey, pendingAttributionVerifications, pendingAutoAttributionVerifyIndices, recentAutoAttributionVerifyAttempts, setAutoAttributionVerifyTimer, setAutoAttributionVerifyTimerDue, setIsVerifyingAttribution, setLastStreamingAttributionVerifyKey, setStreamingAttributionGeneration, setStreamingAttributionVerifyTimer, settings, streamingAttributionGeneration, streamingAttributionVerifyTimer } from './state.js';
import { saveData } from './storage.js';
import { setVerifyAttributionButtonBusy, updateCharList } from './ui.js';
import { getMessageElementByIndex, hashMessageText, isCompositeSpeakerLabel, toast, unwrapCodeFence } from './utils.js';

export function isMessageEligibleForAttributionVerification(msg) {
    return !!msg && !msg.is_system && !!msg.mes && !collectFontColorsFromText(msg.mes).size;
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
    const messages = Array.from(document.querySelectorAll('#chat .mes[mesid]')).reverse();
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
    if (!responseText || typeof responseText !== 'string') return null;
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
            if (Array.isArray(corrections)) return corrections;
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
{"corrections":[{"index":0,"speaker":"Name"}]}

If there are no corrections, return exactly:
{"corrections":[]}

Rules:
1. ${conservativeLine}
2. If the current speaker is already correct, omit that segment.
3. If the speaker is unclear or only a guess, omit that segment.
4. Use one speaker name only, preferably from the known speakers and aliases.
5. Do not invent a speaker unless the full message text explicitly names them.
6. Do not use Unknown, Unclear, None, N/A, Narrator, or a group/composite name as a speaker correction.
7. Correction indexes must match the numbered segment list exactly.

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
    const speakerName = String(rawName ?? '').trim();
    // Reject control characters (prompt-injection vector into future verifier
    // prompts) and [COLORS:...] block delimiters (would corrupt the block on
    // the next ingest round-trip).
    if (!speakerName || speakerName.length > 80 || isCompositeSpeakerLabel(speakerName)) return { assignment: null, created: false };
    if (/[\r\n\t\[\]=,()]/.test(speakerName)) return { assignment: null, created: false };
    const normalized = speakerName.toLowerCase();
    if (['unknown', 'unclear', 'narrator', 'none', 'n/a'].includes(normalized)) return { assignment: null, created: false };

    let assignment = resolveSingleSpeakerAssignment(speakerName, lookup);
    if (assignment) return { assignment, created: false };

    const ensured = ensureCharacterEntry(speakerName);
    if (!ensured?.entry) return { assignment: null, created: false };
    registerLookupAssignment(lookup, ensured.entry.name, getEntryEffectiveColor(ensured.entry), ensured.entry.aliases, false, ensured.entry.font);
    assignment = lookup.get(speakerName.toLowerCase()) || lookup.get(ensured.key) || null;
    return { assignment, created: !!ensured.created };
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

    const localAssignments = parseNamedColorAssignmentsFromText(msg.mes);
    const lookup = buildNameColorLookup(localAssignments);
    const existingEntry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    const attributionOverrides = useTransientOverrides
        ? getMessageQuoteOverridesForDecoration(mesIndex, msg)
        : existingEntry?.segments || null;
    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: true,
        overrides: attributionOverrides,
        mesIndex: mesIndex,
    });
    const persistCreatedCharacters = () => {
        if (!attribution.createdCharacters) return;
        saveData();
        updateCharList();
    };
    const segments = attribution.segments;
    if (!segments.length) {
        if (!skipMarkVerified) {
            markMessageAttributionVerified(mesIndex, msg);
            clearStreamingAttributionOverrides(mesIndex);
        }
        persistCreatedCharacters();
        return { checked: true, corrections: 0, createdCharacters: attribution.createdCharacters };
    }

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
                    },
                    required: ['index', 'speaker'],
                    additionalProperties: false,
                },
            },
        },
        required: ['corrections'],
        additionalProperties: false,
    };

    let corrections = null;
    const textBeforeVerify = msg.mes;
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
        persistCreatedCharacters();
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    if (!Array.isArray(corrections)) {
        console.warn('[Dialogue Colors] LLM attribution verification returned invalid JSON.');
        if (!quiet) toast.warning('Color verification failed (see console).');
        persistCreatedCharacters();
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    // The message may have been edited/swiped/regenerated while the LLM call was
    // in flight; applying corrections computed from the old text would persist
    // wrong overrides under the new text's hash. For the streaming (transient)
    // path, appended tokens are fine — only non-append changes abort.
    if (getContext()?.chat?.[mesIndex] !== msg) {
        return { checked: false, corrections: 0, createdCharacters: false };
    }
    const textUnchanged = msg.mes === textBeforeVerify;
    const textOnlyAppended = useTransientOverrides && msg.mes.startsWith(textBeforeVerify);
    if (!textUnchanged && !textOnlyAppended) {
        return { checked: false, corrections: 0, createdCharacters: false };
    }

    const segmentByIndex = new Map(segments.map(seg => [seg.index, seg]));
    let appliedCorrections = 0;
    let createdCharacters = !!attribution.createdCharacters;
    for (const correction of corrections) {
        const index = Number(correction?.index);
        if (!Number.isInteger(index) || !segmentByIndex.has(index)) continue;
        const seg = segmentByIndex.get(index);
        // In conservative mode we only fill segments that are currently uncolored/unknown.
        if (settings.attributionConservativeOnly && seg.assignment?.key) continue;
        const { assignment, created } = resolveVerifierSpeakerName(correction?.speaker, lookup);
        if (!assignment || assignment.key === seg.assignment?.key) continue;

        const latestEntry = getMessageQuoteOverrideEntry(mesIndex, msg, !useTransientOverrides);
        const existingOverride = latestEntry?.segments?.[String(index)];
        const existingSource = latestEntry?.sources?.[String(index)];
        if (existingOverride && existingSource !== 'llm' && !options.manual) continue;

        const overrideSource = options.manual ? 'manual' : 'llm';
        const didSetOverride = useTransientOverrides
            ? setStreamingAttributionOverride(mesIndex, msg, index, assignment.name, { source: overrideSource })
            : setMessageQuoteOverride(mesIndex, msg, index, assignment.name, { source: overrideSource });
        if (didSetOverride) {
            appliedCorrections++;
            if (created) createdCharacters = true;
        }
    }

    if (!skipMarkVerified) {
        if (appliedCorrections === 0) markMessageAttributionVerified(mesIndex, msg);
        clearStreamingAttributionOverrides(mesIndex);
    }
    if (appliedCorrections) {
        saveData();
        updateCharList();
    }
    if (appliedCorrections) {
        clearMessageDomRepairTimer(mesIndex);
        cancelMessageDomFollowupRepairs(mesIndex);
        // Verifier corrections only change override metadata; decorate the
        // already-rendered DOM without an innerHTML fallback write.
        const repainted = await decorateMessageDomFromCurrentRender(mesIndex, msg, { queueVerification: false, renderFallback: false });
        if (repainted) scheduleMessageDomFollowupRepair(mesIndex, repainted);
    } else {
        const mesElement = document.querySelector(`#chat .mes[mesid="${mesIndex}"]`) || document.querySelectorAll('#chat .mes[mesid]')[mesIndex];
        if (mesElement) decorateObservedMessages([mesElement]);
    }

    return { checked: true, corrections: appliedCorrections, createdCharacters };
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
            else pendingAttributionVerifications.push(queued);
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
