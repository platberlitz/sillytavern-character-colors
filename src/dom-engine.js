// dom-engine.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { ATTRIBUTION_REVIEW_STATUS, ATTRIBUTION_VERIFICATION_STATUS, createAttributionStore, deleteAttributionOverrideRecord, normalizeAttributionConfidence, normalizeAttributionSource } from './attribution-store.js';
import { unregisterGradientAnimationRoot } from './animation-controller.js';
import { collectFontColorsFromText, resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { applyCustomFontsToFontTags, applyCustomFontsToMessageElements, clearCustomFontsFromFontTags, loadGoogleFont, scheduleCardStyle, scheduleCustomFontRefresh } from './fonts.js';
import { applyGradientText, clearGradientText, getVisualRenderState } from './gradient-rendering.js';
import { queueColorStateSave } from './live-colors.js';
import { getNarratorVisual } from './narrator-style.js';
import { applyThemeReadabilityAndBrightness } from './palettes.js';
import { converter, escapeHtml, eventSource, event_types, getContext } from './st-api.js';
import { ATTRIBUTION_VERIFIER_VERSION, AUTO_ATTRIBUTION_VERIFY_DELAY_MS, attributionChatGeneration, characterColors, isDomEngine, runtimeState, settings, streamingAttributionOverrides, streamingHeuristicCache } from './state.js';
import { isPlainObject } from './storage.js';
import { applyTextStyle, clearTextStyle } from './text-style-rendering.js';
import { updateLegend } from './ui.js';
import { captureOpenDetailsState, getGoogleFontFamily, getMessageElementByIndex, hashMessageText, normalizeSegmentText, restoreOpenDetailsState, stripColorBlocks } from './utils.js';
import { queueAutoAttributionVerificationForElements, queueAutoAttributionVerificationForMessage, queueAutoAttributionVerificationForRenderedMessages } from './verify.js';

export function renderMessageDomFallback(messageIndex, message, ctx = getContext(), detailsState = null) {
    const mesEl = getMessageElementByIndex(messageIndex);
    const mesText = mesEl?.querySelector?.('.mes_text');
    if (!mesText || !message) return false;
    if (suspendMessageDomWorkForEdit(mesEl, messageIndex)) return false;
    const openDetailsState = detailsState ?? captureOpenDetailsState(mesText);
    const rawText = stripColorBlocks(message.mes || '');
    let formatted = '';
    try {
        if (typeof ctx?.messageFormatting === 'function') {
            formatted = ctx.messageFormatting(rawText, message.name || '', message.is_system || false, message.is_user || false, messageIndex);
        }
    } catch (e) {
        console.warn('[Dialogue Colors] Message formatting fallback failed:', e);
    }
    if (!formatted && typeof converter?.makeHtml === 'function') formatted = converter.makeHtml(rawText);
    try {
        mesText.innerHTML = formatted || escapeHtml(rawText).replace(/\n/g, '<br>');
    } finally {
        restoreOpenDetailsState(mesText, openDetailsState);
    }
    return true;
}

export async function refreshMessageDom(messageIndex, message) {
    if (!Number.isFinite(messageIndex) || messageIndex < 0) return false;
    const mesElement = getMessageElementByIndex(messageIndex);
    if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
    const openDetailsState = captureMessageOpenDetailsState(mesElement, messageIndex);
    const ctx = getContext();
    if (typeof ctx?.updateMessageBlock === 'function') {
        let timeoutId = null;
        let timedOut = false;
        try {
            const updatePromise = Promise.resolve(ctx.updateMessageBlock(messageIndex, message ?? ctx?.chat?.[messageIndex]))
                // Skip the deferred details-restore if the fallback path already
                // took over; re-applying the stale snapshot would revert any
                // <details> the user toggled in the interim.
                .finally(() => { if (!timedOut) restoreMessageOpenDetailsState(mesElement, messageIndex, openDetailsState); });
            const status = await Promise.race([
                updatePromise.then(() => 'updated'),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => resolve('timeout'), UPDATE_MESSAGE_BLOCK_TIMEOUT_MS);
                }),
            ]);
            if (status === 'updated') return true;
            timedOut = true;
            console.warn('[Dialogue Colors] updateMessageBlock timed out, using fallback render.');
        } catch (e) {
            console.warn('[Dialogue Colors] updateMessageBlock failed, using fallback render:', e);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
    if (renderMessageDomFallback(messageIndex, message, ctx, openDetailsState)) {
        return true;
    }
    if (typeof eventSource?.emit === 'function' && event_types?.MESSAGE_UPDATED) {
        try {
            await eventSource.emit(event_types.MESSAGE_UPDATED, messageIndex);
            return true;
        } catch (e) {
            console.warn('[Dialogue Colors] MESSAGE_UPDATED fallback emit failed:', e);
        }
    }
    return false;
}

export function waitForDomFrame(maxWaitMs = 80) {
    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve();
        };
        const timeoutId = setTimeout(finish, Math.max(0, Number(maxWaitMs) || 0));
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
        else setTimeout(finish, 0);
    });
}

export function getMessageDomReadiness(mesElement, msg, mesIndex) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText || !msg || msg.is_system) return { ready: false, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: 0, correctDecorations: 0 };
    if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) {
        return { ready: true, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: 0, correctDecorations: 0 };
    }
    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex,
    });
    const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
    const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
    const qElements = Array.from(mesText.querySelectorAll('q'));
    const emElements = Array.from(mesText.querySelectorAll('em'));
    const totalSegments = quoteSegments.length + emphasisSegments.length;
    const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
    let matchedSegments = 0;
    let correctDecorations = 0;
    const countMatch = (seg, el) => {
        matchedSegments++;
        if (seg.assignment && el.getAttribute('data-dc-speaker') === seg.assignment.key) correctDecorations++;
    };
    matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), countMatch);
    matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), countMatch);
    return {
        ready: totalSegments === 0 || matchedSegments >= totalSegments,
        totalSegments,
        matchedSegments,
        expectedDecorations,
        coloredDecorations: mesText.querySelectorAll('[data-dc-colored]').length,
        correctDecorations,
    };
}

export function waitForMessageDomReadyForDecoration(messageIndex, msg, timeoutMs = 1600) {
    if (!msg) return Promise.resolve({ ready: false, mesElement: getMessageElementByIndex(messageIndex), readiness: null });
    return new Promise(resolve => {
        const started = Date.now();
        let observer = null;
        let interval = null;
        let settled = false;

        const cleanup = () => {
            if (observer) {
                try { observer.disconnect(); } catch (_) { /* ignored */ }
                observer = null;
            }
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
        };

        const finish = result => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const check = () => {
            const mesElement = getMessageElementByIndex(messageIndex);
            if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) {
                finish({ ready: false, mesElement, readiness: null, edited: true });
                return;
            }
            const readiness = getMessageDomReadiness(mesElement, msg, messageIndex);
            if (readiness.ready) {
                finish({ ready: true, mesElement, readiness });
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                finish({ ready: false, mesElement, readiness });
            }
        };

        const mesElement = getMessageElementByIndex(messageIndex);
        if (mesElement && typeof MutationObserver === 'function') {
            observer = new MutationObserver(check);
            observer.observe(mesElement, { childList: true, subtree: true, characterData: true });
        }
        interval = setInterval(check, 50);
        check();
    });
}

export async function refreshAndDecorateMessageDom(messageIndex, message, options = {}) {
    const msg = message ?? getContext()?.chat?.[messageIndex];
    const mesElement = getMessageElementByIndex(messageIndex);
    if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
    await refreshMessageDom(messageIndex, msg);
    let { ready, mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg);
    if (edited) return false;
    if (!ready && renderMessageDomFallback(messageIndex, msg)) {
        await waitForDomFrame();
        ({ mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, 300));
        if (edited) return false;
    }
    const effectiveMesElement = readyMesElement || getMessageElementByIndex(messageIndex);
    if (!effectiveMesElement) return false;
    decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
    scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
    return true;
}

// Per-message follow-up repair timers so override/verifier repaints can be
// cancelled when a newer override lands for the same message (prevents
// stale follow-ups from re-decorating with outdated state).

export async function decorateMessageDomFromCurrentRender(messageIndex, message, options = {}) {
    const msg = message ?? getContext()?.chat?.[messageIndex];
    const mesElement = getMessageElementByIndex(messageIndex);
    if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
    let { ready, mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, options.timeoutMs ?? 400);
    if (edited) return false;
    if (!ready && options.renderFallback !== false && renderMessageDomFallback(messageIndex, msg)) {
        await waitForDomFrame();
        ({ mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, 300));
        if (edited) return false;
    }
    const effectiveMesElement = readyMesElement || getMessageElementByIndex(messageIndex);
    if (!effectiveMesElement) return false;
    decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
    return true;
}

// Per-message follow-up repair timers so override/verifier repaints can be
// cancelled when a newer override lands for the same message (prevents
// stale follow-ups from re-decorating with outdated state).
export const messageDomFollowupTimers = new Map();

export function cancelMessageDomFollowupRepairs(messageIndex) {
    const index = Number(messageIndex);
    if (!Number.isFinite(index) || index < 0) return;
    const timers = messageDomFollowupTimers.get(index);
    if (timers) {
        timers.forEach(clearTimeout);
        messageDomFollowupTimers.delete(index);
    }
}

export function scheduleMessageDomFollowupRepair(messageIndex, repainted) {
    const index = Number(messageIndex);
    if (!Number.isFinite(index) || index < 0) return;
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;
    // Cancel any in-flight follow-ups for this message first so we never
    // stack overlapping repair passes that fight each other.
    cancelMessageDomFollowupRepairs(index);
    const chatGeneration = attributionChatGeneration;
    const delays = repainted ? [120, 900, 3200] : [0, 900, 3200];
    const timers = [];
    for (const delay of delays) {
        const timer = setTimeout(async () => {
            // Remove this timer from the tracked set as soon as it fires.
            const tracked = messageDomFollowupTimers.get(index);
            if (tracked) {
                const at = tracked.indexOf(timer);
                if (at >= 0) tracked.splice(at, 1);
                if (!tracked.length) messageDomFollowupTimers.delete(index);
            }
            try {
                if (!settings.enabled || !isDomEngine()) return;
                if (chatGeneration !== attributionChatGeneration) return;
                const msg = getContext()?.chat?.[index];
                const mesElement = getMessageElementByIndex(index);
                if (!msg || !mesElement) return;
                if (suspendMessageDomWorkForEdit(mesElement, index)) return;
                const repairType = getMessageDomHealthRepairType(mesElement, msg, index);
                // renderFallback:false — never write .mes_text innerHTML here.
                // A fallback write would trigger the chat observer and cause a
                // re-decoration cascade (the flicker users were seeing).
                if (repairType === 'refresh') await decorateMessageDomFromCurrentRender(index, msg, { queueVerification: false, renderFallback: false });
                else if (repairType === 'decorate') decorateObservedMessages([mesElement], { queueVerification: false });
            } catch (e) {
                console.warn('[Dialogue Colors] Follow-up DOM repair failed:', e);
            }
        }, Math.max(0, Number(delay) || 0));
        timers.push(timer);
    }
    messageDomFollowupTimers.set(index, timers);
}

export function clearMessageDomRepairTimer(mesIndex) {
    const index = Number(mesIndex);
    if (!Number.isFinite(index) || index < 0) return;
    const timer = runtimeState.messageDomRepairTimers.get(index);
    if (timer) clearTimeout(timer);
    runtimeState.messageDomRepairTimers.delete(index);
}

export function clearMessageDomRepairTimers() {
    for (const timer of runtimeState.messageDomRepairTimers.values()) clearTimeout(timer);
    runtimeState.messageDomRepairTimers.clear();
    // Also clear all per-message follow-up repair timers.
    for (const timers of messageDomFollowupTimers.values()) timers.forEach(clearTimeout);
    messageDomFollowupTimers.clear();
    healthRefreshAttempts.clear();
}

export function scheduleMessageDomRepair(mesIndex, options = {}) {
    const index = Number(mesIndex);
    if (!Number.isFinite(index) || index < 0) return false;

    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return false;

    clearMessageDomRepairTimer(index);

    const chatGeneration = attributionChatGeneration;
    const delay = Math.max(0, Number(options.delay ?? POST_MUTATION_DOM_REPAIR_DELAY_MS) || 0);
    const timer = setTimeout(async () => {
        try {
            if (!settings.enabled || !isDomEngine()) return;
            if (chatGeneration !== attributionChatGeneration) return;

            const msg = getContext()?.chat?.[index];
            if (!msg || msg.is_system) return;
            if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;

            await decorateMessageDomFromCurrentRender(index, msg, {
                queueVerification: options.queueVerification !== false,
                timeoutMs: options.timeoutMs ?? 700,
                renderFallback: options.renderFallback,
            });

            if (chatGeneration !== attributionChatGeneration) return;

            if (options.verify !== false) {
                queueAutoAttributionVerificationForMessage(index, {
                    force: options.forceVerify === true,
                    delay: options.verifyDelay ?? AUTO_ATTRIBUTION_VERIFY_DELAY_MS,
                });
            }
        } catch (e) {
            console.warn('[Dialogue Colors] Post-update DOM repair failed:', e);
            const mesElement = getMessageElementByIndex(index);
            if (mesElement) decorateObservedMessages([mesElement], { queueVerification: options.queueVerification !== false });
        } finally {
            if (runtimeState.messageDomRepairTimers.get(index) === timer) {
                runtimeState.messageDomRepairTimers.delete(index);
            }
        }
    }, delay);
    runtimeState.messageDomRepairTimers.set(index, timer);
    return true;
}

// ===== DOM coloring engine (non-destructive) =====
export const OVERRIDES_METADATA_KEY = 'dialogue_colors_overrides';

export let decorateAllTimer = null;

export let decorateLastTimer = null;

export let isDecoratingDom = false;

export let decorateAllFirstCallTime = 0;

export let decorateLastFirstCallTime = 0;

export let observedDecorationFirstCallTime = 0;

export const DECORATE_ALL_MAX_WAIT = 500;

export const DECORATE_LAST_MAX_WAIT = 250;

export const OBSERVED_DECORATION_MAX_WAIT = 250;

export const DOM_SETTLE_REFRESH_DELAYS = [0, 120, 350, 900, 1800, 3000];

export const DOM_RETRY_REFRESH_DELAYS = [120, 350, 900, 1800, 3000];

export const DOM_HEALTH_CHECK_INTERVAL_MS = 1500;

export const DOM_HEALTH_CHECK_VISIBLE_LIMIT = 40;

export const POST_MUTATION_DOM_REPAIR_DELAY_MS = 700;

export const UPDATE_MESSAGE_BLOCK_TIMEOUT_MS = 1500;

export let pendingDeferredMutations = false;

let pendingDomSettleRefreshKey = '';

let pendingDomSettleRefreshCount = 0;

let domHealthCheckCursor = 0;

let decoratedWatcherHealthIterator = null;

export const MESSAGE_EDIT_TEXTAREA_SELECTOR = '#curEditTextarea, .edit_textarea, .reasoning_edit_textarea';

export function getEditingMessageElement(mesElement, mesIndex) {
    const resolvedElement = mesElement || (Number.isFinite(Number(mesIndex)) ? getMessageElementByIndex(mesIndex) : null);
    if (!resolvedElement) return null;
    const editTextarea = resolvedElement.matches?.(MESSAGE_EDIT_TEXTAREA_SELECTOR)
        ? resolvedElement
        : resolvedElement.querySelector?.(MESSAGE_EDIT_TEXTAREA_SELECTOR);
    return editTextarea?.closest?.('.mes[mesid]') || null;
}

export function suspendMessageDomWorkForEdit(mesElement, mesIndex) {
    const editingMesElement = getEditingMessageElement(mesElement, mesIndex);
    if (!editingMesElement) return false;
    const requestedIndex = Number(mesIndex);
    const index = Number.isFinite(requestedIndex) ? requestedIndex : Number(editingMesElement.getAttribute?.('mesid'));
    if (Number.isFinite(index) && index >= 0) {
        clearMessageDomRepairTimer(index);
        cancelMessageDomFollowupRepairs(index);
    }
    runtimeState.pendingObservedMessages?.delete?.(editingMesElement);
    clearMessageObservers(editingMesElement);
    return true;
}

export function getMessageDetailsRoot(mesElement, mesIndex) {
    const resolvedElement = mesElement?.isConnected ? mesElement : getMessageElementByIndex(mesIndex);
    return resolvedElement?.querySelector?.('.mes_text') || null;
}

export function captureMessageOpenDetailsState(mesElement, mesIndex) {
    return captureOpenDetailsState(getMessageDetailsRoot(mesElement, mesIndex));
}

export function restoreMessageOpenDetailsState(mesElement, mesIndex, state) {
    return restoreOpenDetailsState(getMessageDetailsRoot(mesElement, mesIndex), state);
}

export function getChatMetadataStore() {
    const ctx = getContext();
    const metadata = ctx?.chatMetadata || ctx?.chat_metadata;
    return isPlainObject(metadata) ? metadata : null;
}

export function saveChatMetadata() {
    const ctx = getContext();
    if (typeof ctx?.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
    else if (typeof ctx?.saveMetadata === 'function') ctx.saveMetadata();
}

export function getQuoteOverridesMap(create = false) {
    const metadata = getChatMetadataStore();
    if (!metadata) return null;
    if (!isPlainObject(metadata[OVERRIDES_METADATA_KEY])) {
        if (!create) return null;
        metadata[OVERRIDES_METADATA_KEY] = {};
    }
    return metadata[OVERRIDES_METADATA_KEY];
}

export function getMessageQuoteOverrides(mesIndex, msg) {
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    return entry?.segments || null;
}

export function getStreamingAttributionMessageId(msg, mesIndex) {
    return String(msg?.id ?? msg?.send_date ?? mesIndex ?? '');
}

export function getStreamingAttributionOverrideEntry(mesIndex, msg, create = false) {
    const key = String(mesIndex);
    const messageId = getStreamingAttributionMessageId(msg, mesIndex);
    let entry = streamingAttributionOverrides.get(key);
    if (!isPlainObject(entry) || entry.messageId !== messageId) {
        if (!create) return null;
        entry = { messageId, segments: {}, sources: {} };
        streamingAttributionOverrides.set(key, entry);
    }
    if (!isPlainObject(entry.segments)) entry.segments = {};
    if (!isPlainObject(entry.sources)) entry.sources = {};
    return entry;
}

export function getStreamingAttributionOverrides(mesIndex, msg) {
    const entry = getStreamingAttributionOverrideEntry(mesIndex, msg, false);
    return entry?.segments || null;
}

export function getMessageQuoteOverridesForDecoration(mesIndex, msg) {
    const persisted = getMessageQuoteOverrides(mesIndex, msg);
    const streaming = getStreamingAttributionOverrides(mesIndex, msg);
    if (!persisted) return streaming;
    if (!streaming) return persisted;
    return { ...streaming, ...persisted };
}

export function getMessageQuoteOverrideOptions(mesIndex, msg) {
    const persisted = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    const streaming = getStreamingAttributionOverrideEntry(mesIndex, msg, false);
    const overrides = getMessageQuoteOverridesForDecoration(mesIndex, msg);
    const sources = persisted?.sources || streaming?.sources
        ? { ...(streaming?.sources || {}), ...(persisted?.sources || {}) }
        : null;
    return {
        overrides,
        overrideSources: sources,
        overrideConfidences: persisted?.confidences || null,
        overrideRecords: persisted?.records || null,
    };
}

export function hasMessageQuoteOverridesForDecoration(mesIndex, msg) {
    const overrides = getMessageQuoteOverridesForDecoration(mesIndex, msg);
    return !!overrides && Object.keys(overrides).length > 0;
}

export function setStreamingAttributionOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
    const entry = getStreamingAttributionOverrideEntry(mesIndex, msg, true);
    if (!entry) return false;
    entry.segments[String(segmentIndex)] = String(speakerName);
    entry.sources[String(segmentIndex)] = options.source || 'llm';
    streamingHeuristicCache.clear();
    return true;
}

export function clearStreamingAttributionOverrides(mesIndex = null) {
    if (mesIndex === null || mesIndex === undefined) streamingAttributionOverrides.clear();
    else streamingAttributionOverrides.delete(String(mesIndex));
}

export function hasMessageQuoteOverridesForLatestMessage() {
    const chat = getContext()?.chat || [];
    const mesIndex = chat.length - 1;
    if (mesIndex < 0) return false;
    return hasMessageQuoteOverridesForDecoration(mesIndex, chat[mesIndex]);
}

export function getMessageQuoteOverrideEntry(mesIndex, msg, create = false) {
    const map = getQuoteOverridesMap(create);
    if (!map) return null;
    const key = String(mesIndex);
    const hash = hashMessageText(msg?.mes);
    let entry = map[key];
    if (!isPlainObject(entry) || entry.hash !== hash) {
        if (!create) return null;
        entry = { hash, segments: {} };
        map[key] = entry;
    }
    if (!isPlainObject(entry.segments)) {
        if (!create) return null;
        entry.segments = {};
    }
    return entry;
}

export function setMessageQuoteOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, true);
    if (!entry) return false;
    const key = String(segmentIndex);
    entry.segments[key] = String(speakerName);
    if (!isPlainObject(entry.sources)) entry.sources = {};
    entry.sources[key] = normalizeAttributionSource(options.source, 'manual');
    if (options.confidence !== undefined) {
        if (!isPlainObject(entry.confidences)) entry.confidences = {};
        entry.confidences[key] = normalizeAttributionConfidence(options.confidence);
    }
    if (options.reviewId !== undefined && options.reviewId !== null) {
        const reviewId = String(options.reviewId).trim().slice(0, 96);
        if (reviewId) {
            if (!isPlainObject(entry.reviewIds)) entry.reviewIds = {};
            entry.reviewIds[key] = reviewId;
        }
    }
    if (options.evidence !== undefined) {
        if (!isPlainObject(entry.records)) entry.records = {};
        entry.records[key] = {
            speaker: String(speakerName),
            source: entry.sources[key],
            confidence: entry.confidences?.[key],
            evidence: Array.isArray(options.evidence) ? options.evidence : [options.evidence],
            ...(entry.reviewIds?.[key] ? { reviewId: entry.reviewIds[key] } : {}),
        };
    }
    const messageId = msg?.id ?? msg?.send_date;
    if (messageId !== undefined && messageId !== null && String(messageId).trim()) entry.messageId = String(messageId).trim().slice(0, 120);
    entry.textLength = String(msg?.mes ?? '').length;
    if (Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(options.verificationStatus)) {
        entry.verificationStatus = options.verificationStatus;
    }
    streamingHeuristicCache.clear();
    // A manual override means the LLM-verified state is no longer authoritative.
    delete entry.verifiedHash;
    delete entry.verifiedAt;
    delete entry.verifiedVersion;
    saveChatMetadata();
    return true;
}

export function deleteMessageQuoteOverride(mesIndex, msg, segmentIndex) {
    const map = getQuoteOverridesMap(false);
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    if (!map || !entry || !deleteAttributionOverrideRecord(map, mesIndex, segmentIndex)) return false;
    streamingHeuristicCache.clear();
    saveChatMetadata();
    return true;
}

export function restoreMessageQuoteOverrideEntry(mesIndex, snapshot) {
    const map = getQuoteOverridesMap(true);
    if (!map) return false;
    const key = String(mesIndex);
    if (snapshot && isPlainObject(snapshot)) map[key] = JSON.parse(JSON.stringify(snapshot));
    else delete map[key];
    streamingHeuristicCache.clear();
    saveChatMetadata();
    return true;
}

export function markMessageAttributionVerified(mesIndex, msg, verificationStatus = ATTRIBUTION_VERIFICATION_STATUS.CLEAN) {
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, true);
    if (!entry) return false;
    entry.verifiedHash = hashMessageText(msg?.mes);
    entry.verifiedAt = Date.now();
    entry.verifiedVersion = ATTRIBUTION_VERIFIER_VERSION;
    entry.verificationStatus = Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(verificationStatus)
        ? verificationStatus
        : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
    const messageId = msg?.id ?? msg?.send_date;
    if (messageId !== undefined && messageId !== null && String(messageId).trim()) entry.messageId = String(messageId).trim().slice(0, 120);
    entry.textLength = String(msg?.mes ?? '').length;
    saveChatMetadata();
    return true;
}

export function isMessageAttributionVerified(mesIndex, msg) {
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    const hash = hashMessageText(msg?.mes);
    return !!entry
        && entry.hash === hash
        && entry.verifiedHash === hash
        && entry.verifiedVersion === ATTRIBUTION_VERIFIER_VERSION
        && Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(entry.verificationStatus);
}

function markAttributionReviewDecisionStatus(review) {
    const chat = getContext()?.chat || [];
    const index = Number(review?.messageIndex);
    const msg = Number.isInteger(index) ? chat[index] : null;
    const expectedId = String(review?.messageId ?? '');
    const currentId = String(msg?.id ?? msg?.send_date ?? '');
    if (!msg || (expectedId && expectedId !== currentId)) return false;
    if (review?.messageHash && review.messageHash !== hashMessageText(msg.mes)) return false;
    const hasPendingReview = getAttributionReviewAdapter().list({ status: ATTRIBUTION_REVIEW_STATUS.PENDING })
        .some(item => item.messageFingerprint === review.messageFingerprint);
    return markMessageAttributionVerified(
        index,
        msg,
        hasPendingReview ? ATTRIBUTION_VERIFICATION_STATUS.PENDING_REVIEW : ATTRIBUTION_VERIFICATION_STATUS.CLEAN,
    );
}

export function getAttributionReviewAdapter() {
    return createAttributionStore({
        getMetadata: getChatMetadataStore,
        getChat: () => getContext()?.chat || [],
        getOverrideMap: () => getQuoteOverridesMap(true),
        saveMetadata: saveChatMetadata,
        extendedOverrides: true,
        applyOverride(review) {
            streamingHeuristicCache.clear();
            markAttributionReviewDecisionStatus(review);
        },
    });
}

export function getAttributionReviewStore() {
    return getAttributionReviewAdapter().get();
}

export function upsertAttributionReview(candidate, options = {}) {
    return getAttributionReviewAdapter().upsert(candidate, options);
}

export function listAttributionReviews(options = {}) {
    return getAttributionReviewAdapter().list(options);
}

export function acceptAttributionReview(id, options = {}) {
    return getAttributionReviewAdapter().accept(id, options);
}

export function rejectAttributionReview(id, options = {}) {
    const decision = getAttributionReviewAdapter().reject(id, options);
    if (decision?.status === ATTRIBUTION_REVIEW_STATUS.REJECTED) markAttributionReviewDecisionStatus(decision);
    return decision;
}

export function dismissAttributionReview(id, options = {}) {
    const decision = getAttributionReviewAdapter().dismiss(id, options);
    if (decision?.status === ATTRIBUTION_REVIEW_STATUS.STALE) markAttributionReviewDecisionStatus(decision);
    return decision;
}

export function pruneAttributionReviews(options = {}) {
    return getAttributionReviewAdapter().prune(options);
}

export function getMessageIndexFromElement(el) {
    const mesEl = el?.closest?.('.mes');
    if (!mesEl) return -1;
    const mesId = Number(mesEl.getAttribute('mesid'));
    if (Number.isFinite(mesId) && mesId >= 0) return mesId;
    return Array.from(document.querySelectorAll('.mes')).indexOf(mesEl);
}

export function refreshDomDialogueCounts(chat = getContext()?.chat || []) {
    const nextCounts = {};
    let createdCharacters = false;

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || msg.is_system || !msg.mes || collectFontColorsFromText(msg.mes).size) continue;
        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            autoAddMessageSpeaker: true,
            ...getMessageQuoteOverrideOptions(i, msg),
            mesIndex: i,
        });
        if (attribution.createdCharacters) createdCharacters = true;
        for (const seg of attribution.segments) {
            const key = seg.assignment?.key;
            if (!key || !characterColors[key]) continue;
            nextCounts[key] = (nextCounts[key] || 0) + 1;
        }
    }

    let changed = createdCharacters;
    for (const [key, entry] of Object.entries(characterColors)) {
        const nextCount = nextCounts[key] || 0;
        if ((entry.dialogueCount || 0) !== nextCount) {
            entry.dialogueCount = nextCount;
            changed = true;
        }
    }

    return { changed, createdCharacters };
}

export function matchSegmentsToElements(segments, elements, getTargetText, onMatch) {
    let elementIndex = 0;
    for (const seg of segments) {
        if (elementIndex >= elements.length) break;
        const target = getTargetText(seg);
        if (!target) continue;
        let foundIndex = -1;
        for (let i = elementIndex; i < elements.length; i++) {
            if (normalizeSegmentText(elements[i].textContent) === target) {
                foundIndex = i;
                break;
            }
        }
        if (foundIndex === -1) continue;
        onMatch(seg, elements[foundIndex]);
        elementIndex = foundIndex + 1;
    }
}

export function resolveDomSegmentIndexForElement(segmentEl, mesIndex, msg) {
    if (!segmentEl || !msg) return NaN;
    if (segmentEl.hasAttribute?.('data-dc-seg')) {
        const directIndex = Number(segmentEl.getAttribute('data-dc-seg'));
        if (Number.isFinite(directIndex)) return directIndex;
    }

    const mesText = segmentEl.closest?.('.mes_text');
    if (!mesText) return NaN;

    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: true,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex,
    });

    const isThoughtElement = segmentEl.matches?.('em');
    const segments = attribution.segments.filter(seg => isThoughtElement
        ? (seg.delimiter === '*' || seg.delimiter === '_')
        : (seg.delimiter !== '*' && seg.delimiter !== '_'));
    const elements = Array.from(mesText.querySelectorAll(isThoughtElement ? 'em' : 'q'));
    let resolvedIndex = NaN;

    matchSegmentsToElements(
        segments,
        elements,
        seg => isThoughtElement ? normalizeSegmentText(seg.text.slice(1, -1)) : normalizeSegmentText(seg.text),
        (seg, el) => {
            if (el === segmentEl) resolvedIndex = seg.index;
        }
    );
    if (Number.isFinite(resolvedIndex)) return resolvedIndex;

    // If SillyTavern's rendered text differs slightly from msg.mes, fall back
    // to ordinal mapping so manual DOM overrides can still recover coloring.
    const ordinal = elements.indexOf(segmentEl);
    return ordinal >= 0 && segments[ordinal] ? segments[ordinal].index : NaN;
}

export function clearSegmentDecoration(el) {
    clearGradientText(el);
    clearTextStyle(el);
    el.style.color = '';
    el.style.backgroundColor = '';
    el.style.fontFamily = '';
    if (!el.getAttribute('style')) el.removeAttribute('style');
    el.removeAttribute('data-dc-colored');
    el.removeAttribute('data-dc-speaker');
    el.removeAttribute('data-dc-speaker-name');
    el.removeAttribute('data-dc-font');
    el.removeAttribute('data-dc-seg');
    if (el.hasAttribute('data-dc-aria-label')) {
        el.removeAttribute('aria-label');
        el.removeAttribute('data-dc-aria-label');
    }
}

export function clearNarratorTextSpans(mesText) {
    const spans = Array.from(mesText?.querySelectorAll?.('span[data-dc-narrator]') || []);
    spans.forEach(span => {
        clearGradientText(span);
        clearTextStyle(span);
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
    });
    return spans.length > 0;
}

function clearLegacyNarratorContainerStyle(mesText) {
    if (!mesText?.hasAttribute?.('data-dc-narrator')) return false;
    mesText.style.color = '';
    mesText.removeAttribute('data-dc-narrator');
    if (!mesText.getAttribute('style')) mesText.removeAttribute('style');
    return true;
}

function applyNarratorSpanVisual(span, narrator) {
    const displayVisual = getVisualRenderState(narrator, { target: 'chat' });
    span.style.color = displayVisual.fallbackColor;
    applyTextStyle(span, narrator.style);
    const family = getGoogleFontFamily(narrator.font);
    if (family) {
        loadGoogleFont(narrator.font);
        span.style.fontFamily = family;
        span.setAttribute('data-dc-font', '1');
    } else {
        span.style.fontFamily = '';
        span.removeAttribute('data-dc-font');
    }
    applyGradientText(span, narrator, { target: 'chat' });
}

function collectNarratorTextNodes(mesText) {
    if (!mesText) return [];
    const documentRef = mesText.ownerDocument || document;
    const nodeFilter = documentRef.defaultView?.NodeFilter || globalThis.NodeFilter;
    if (!nodeFilter || typeof documentRef.createTreeWalker !== 'function') return [];
    const walker = documentRef.createTreeWalker(mesText, nodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue?.trim()) return nodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || parent.closest('q, em, font, script, style, textarea, pre, code, [data-dc-colored], [data-dc-narrator], .dc-auto-colorize-indicator')) {
                return nodeFilter.FILTER_REJECT;
            }
            return nodeFilter.FILTER_ACCEPT;
        },
    });
    const textNodes = [];
    let textNode;
    while ((textNode = walker.nextNode())) textNodes.push(textNode);
    return textNodes;
}

export function hasNarratorTextNodesToDecorate(mesText) {
    return collectNarratorTextNodes(mesText).length > 0;
}

export function decorateNarratorTextNodes(mesText, narrator) {
    if (!mesText || !narrator) return 0;
    const existing = Array.from(mesText.querySelectorAll('span[data-dc-narrator]'));
    existing.forEach(span => applyNarratorSpanVisual(span, narrator));
    const documentRef = mesText.ownerDocument || document;
    const textNodes = collectNarratorTextNodes(mesText);
    textNodes.forEach(node => {
        const span = documentRef.createElement('span');
        span.setAttribute('data-dc-narrator', '1');
        node.parentNode.insertBefore(span, node);
        span.appendChild(node);
        applyNarratorSpanVisual(span, narrator);
    });
    return existing.length + textNodes.length;
}

export function undecorateMessageDom(mesElement, options = {}) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (mesText) {
        clearLegacyNarratorContainerStyle(mesText);
        mesText.querySelectorAll('[data-dc-colored], [data-dc-seg]').forEach(clearSegmentDecoration);
        clearCustomFontsFromFontTags(mesText);
        if (options.preserveNarrator !== true) clearNarratorTextSpans(mesText);
    }
    // Tear down the external-rebuild watcher so it doesn't re-decorate
    // a message we've intentionally undecorated.
    if (options.clearWatcher !== false) clearDecoratedWatcher(mesElement);
    if (options.clearWatcher !== false) unregisterGradientAnimationRoot(mesElement);
}

export function decorateMessageDom(mesElement, msg, mesIndex) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText) return { decorated: false, createdCharacters: false, needsRetry: !!msg && !msg.is_system };
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return { decorated: false, createdCharacters: false, needsRetry: false };
    undecorateMessageDom(mesElement, { clearWatcher: false, preserveNarrator: true });
    if (!settings.enabled || !msg || msg.is_system) {
        clearNarratorTextSpans(mesText);
        return { decorated: false, createdCharacters: false };
    }
    const hasPersistedFontColors = mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size;
    if (hasPersistedFontColors) {
        clearNarratorTextSpans(mesText);
        applyCustomFontsToFontTags(mesText, msg.mes);
        clearDecoratedWatcher(mesElement);
        return { decorated: false, createdCharacters: false };
    }
    if (!isDomEngine()) {
        clearNarratorTextSpans(mesText);
        return { decorated: false, createdCharacters: false };
    }

    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: true,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex: mesIndex,
    });

    let decorated = false;
    const applyDecoration = (seg, el) => {
        el.setAttribute('data-dc-seg', String(seg.index));
        if (!seg.assignment) return;
        const entryKey = characterColors[seg.assignment.key]
            ? seg.assignment.key
            : resolveCharacterKeyByNameOrAlias(seg.assignment.name || seg.assignment.key);
        const entry = entryKey ? characterColors[entryKey] : null;
        const displayVisual = getVisualRenderState(entry || { color: seg.assignment.color, baseColor: seg.assignment.color }, { target: 'chat' });
        el.style.color = displayVisual.fallbackColor;
        applyTextStyle(el, entry?.style);
        const font = entry?.font || seg.assignment.font;
        const family = getGoogleFontFamily(font);
        if (family) {
            loadGoogleFont(font);
            el.style.fontFamily = family;
            el.setAttribute('data-dc-font', '1');
        }
        const highlightColor = settings.highlightMode ? `${displayVisual.fallbackColor}26` : '';
        const gradientResult = applyGradientText(el, entry, { highlightColor, target: 'chat' });
        if (settings.highlightMode && !gradientResult.applied) el.style.backgroundColor = highlightColor;
        el.setAttribute('data-dc-colored', '1');
        el.setAttribute('data-dc-speaker', seg.assignment.key);
        const speakerName = entry?.name || seg.assignment.name || seg.assignment.key;
        el.setAttribute('data-dc-speaker-name', speakerName);
        if (!el.hasAttribute('aria-label')) {
            el.setAttribute('aria-label', `${speakerName}: ${el.textContent.trim()}`);
            el.setAttribute('data-dc-aria-label', '1');
        }
        decorated = true;
    };

    const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
    const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
    const qElements = Array.from(mesText.querySelectorAll('q'));
    const emElements = Array.from(mesText.querySelectorAll('em'));
    const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
    let matchedDecorations = 0;

    matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), applyDecoration);
    matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), applyDecoration);
    matchedDecorations = mesText.querySelectorAll('[data-dc-colored]').length;

    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (narrator) decorated = decorateNarratorTextNodes(mesText, narrator) > 0 || decorated;
    else clearNarratorTextSpans(mesText);

    return {
        decorated,
        createdCharacters: attribution.createdCharacters,
        segments: attribution.segments,
        needsRetry: expectedDecorations > matchedDecorations,
    };
}

export function undecorateAllMessages() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(undecorateMessageDom);
}

// Disconnect every long-lived "decorated message" watcher. Called on chat
// change and when DOM decoration is disabled wholesale.

export function clearDomSettleRefreshes() {
    for (const [key, { observer, fallbackTimer }] of runtimeState.messageSettleObservers.entries()) {
        if (typeof key !== 'string' || !key.startsWith('__settle_fallback_')) continue;
        try { observer.disconnect(); } catch (_) { /* ignored */ }
        clearTimeout(fallbackTimer);
        runtimeState.messageSettleObservers.delete(key);
    }
    pendingDomSettleRefreshKey = '';
    pendingDomSettleRefreshCount = 0;
}

// Disconnect the long-lived decorated watcher for a single .mes element.

// Disconnect every long-lived "decorated message" watcher. Called on chat
// change and when DOM decoration is disabled wholesale.
export function clearDecoratedWatchers() {
    for (const [mesElement, { observer }] of runtimeState.decoratedWatchers.entries()) {
        try { observer.disconnect(); } catch (_) { /* ignored */ }
        unregisterGradientAnimationRoot(mesElement);
    }
    runtimeState.decoratedWatchers.clear();
    decoratedWatcherHealthIterator = null;
}

// Tear down per-element observers (both the settle observer and the
// long-lived decorated watcher) for a single .mes element.

// Disconnect the long-lived decorated watcher for a single .mes element.
export function clearDecoratedWatcher(mesElement) {
    const watcher = runtimeState.decoratedWatchers.get(mesElement);
    if (watcher) {
        try { watcher.observer.disconnect(); } catch (_) { /* ignored */ }
        runtimeState.decoratedWatchers.delete(mesElement);
    }
}

// Maximum time to wait for a message's DOM to settle before giving up.

// Tear down per-element observers (both the settle observer and the
// long-lived decorated watcher) for a single .mes element.
export function clearMessageObservers(mesElement) {
    const settle = runtimeState.messageSettleObservers.get(mesElement);
    if (settle) {
        try { settle.observer.disconnect(); } catch (_) { /* ignored */ }
        clearTimeout(settle.fallbackTimer);
        settle.retryTimers?.forEach?.(clearTimeout);
        runtimeState.messageSettleObservers.delete(mesElement);
    }
    const watcher = runtimeState.decoratedWatchers.get(mesElement);
    if (watcher) {
        try { watcher.observer.disconnect(); } catch (_) { /* ignored */ }
        runtimeState.decoratedWatchers.delete(mesElement);
    }
}

// Maximum time to wait for a message's DOM to settle before giving up.
export const MESSAGE_SETTLE_MAX_WAIT_MS = 3000;

/**
 * Attach a self-terminating MutationObserver to a single .mes element.
 * Re-tries decoration whenever child nodes are added or removed inside the
 * message element. Disconnects as soon as decoration succeeds (no
 * needsRetry) or after MESSAGE_SETTLE_MAX_WAIT_MS, whichever comes first.
 */

export function attachMessageSettleObserver(mesElement, mesIndex) {
    if (!mesElement?.isConnected) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    // Remove any existing watcher for this element.
    const existing = runtimeState.messageSettleObservers.get(mesElement);
    if (existing) {
        try { existing.observer.disconnect(); } catch (_) { /* ignored */ }
        clearTimeout(existing.fallbackTimer);
        existing.retryTimers?.forEach?.(clearTimeout);
        runtimeState.messageSettleObservers.delete(mesElement);
    }

    let retryTimers = [];

    const attempt = () => {
        if (!mesElement.isConnected || !settings.enabled || !isDomEngine()) {
            cleanup();
            return;
        }
        // Re-read the index: ST renumbers mesid attributes after deletions, so a
        // closed-over mesIndex may now point at a different message.
        const currentMesIndex = Number(mesElement.getAttribute('mesid'));
        const effectiveIndex = Number.isFinite(currentMesIndex) ? currentMesIndex : mesIndex;
        const msg = getContext()?.chat?.[effectiveIndex];
        if (!msg) { cleanup(); return; }
        if (suspendMessageDomWorkForEdit(mesElement, effectiveIndex)) { cleanup(); return; }
        const result = decorateMessageDom(mesElement, msg, effectiveIndex);
        if (result.createdCharacters) {
            queueColorStateSave({ history: false, injectPrompt: false });
        }
        updateLegend();
        if (!result.needsRetry) {
            cleanup();
            // Decoration succeeded: arm the long-lived watcher so a later
            // external re-render (e.g. Prose Polisher) re-decorates.
            if (result.decorated) watchDecoratedMessage(mesElement, effectiveIndex);
        }
    };

    const cleanup = () => {
        const entry = runtimeState.messageSettleObservers.get(mesElement);
        if (!entry) return;
        try { entry.observer.disconnect(); } catch (_) { /* ignored */ }
        clearTimeout(entry.fallbackTimer);
        entry.retryTimers?.forEach?.(clearTimeout);
        runtimeState.messageSettleObservers.delete(mesElement);
    };

    const observer = new MutationObserver(() => attempt());
    observer.observe(mesElement, { childList: true, subtree: true });

    retryTimers = DOM_RETRY_REFRESH_DELAYS
        .filter(delay => Number(delay) > 0 && Number(delay) < MESSAGE_SETTLE_MAX_WAIT_MS)
        .map(delay => setTimeout(() => attempt(), Number(delay)));

    const fallbackTimer = setTimeout(() => {
        cleanup();
    }, MESSAGE_SETTLE_MAX_WAIT_MS);

    runtimeState.messageSettleObservers.set(mesElement, { observer, fallbackTimer, retryTimers });
}

/**
 * Attach a long-lived MutationObserver that watches for external re-renders
 * of an already-decorated message (e.g. a post-gen agent editing msg.mes and
 * calling updateMessageBlock(), which rebuilds .mes_text innerHTML, wiping DC
 * inline styles). When .mes_text childList changes and all data-dc-colored
 * elements have disappeared, we trigger attachMessageSettleObserver so
 * decoration is re-applied once <q>/<em> elements re-appear.
 *
 * Unlike attachMessageSettleObserver (which is self-terminating), this watcher
 * lives for the lifetime of the decorated message and is only torn down when
 * the message is undecorated or the chat changes.
 *
 * DC's own decoration only writes style/attributes (not childList mutations),
 * so this observer will not self-trigger on our own changes.
 */

export function watchDecoratedMessage(mesElement, mesIndex) {
    if (!mesElement?.isConnected) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    // Tear down any existing watcher for this element first.
    clearDecoratedWatcher(mesElement);

    const initialMesText = mesElement.querySelector('.mes_text');
    if (!initialMesText) return;

    const observer = new MutationObserver(() => {
        if (!mesElement.isConnected || !settings.enabled || !isDomEngine()) {
            clearDecoratedWatcher(mesElement);
            return;
        }
        if (isDecoratingDom) return;
        // Re-read the index: ST renumbers mesid attributes after deletions.
        const currentMesIndex = Number(mesElement.getAttribute('mesid'));
        const repairIndex = Number.isFinite(currentMesIndex) ? currentMesIndex : Number(mesIndex);
        if (runtimeState.messageDomRepairTimers.has(repairIndex)) return;
        if (suspendMessageDomWorkForEdit(mesElement, repairIndex)) return;
        // Re-query .mes_text: external agents may replace the node entirely.
        const currentMesText = mesElement.querySelector('.mes_text');
        if (!currentMesText || !currentMesText.isConnected) return;
        // Skip messages with LLM-emitted font[color] tags.
        if (currentMesText.querySelector('font[color]')) return;
        // If all applicable decorations are still present, the rebuild did not wipe them.
        const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        const narratorMissing = narrator && !currentMesText.querySelector('[data-dc-narrator]')
            && hasNarratorTextNodesToDecorate(currentMesText);
        if ((currentMesText.querySelector('[data-dc-colored]') || currentMesText.querySelector('[data-dc-narrator]')) && !narratorMissing) return;
        const msg = getContext()?.chat?.[repairIndex];
        if (!msg || msg.is_system) return;
        decorateObservedMessages([mesElement]);
    });

    // Observe mesElement subtree so we catch .mes_text replacement itself.
    observer.observe(mesElement, { childList: true, subtree: true });
    runtimeState.decoratedWatchers.set(mesElement, { observer, mesText: initialMesText });
}

export function collectDomHealthCheckMessages() {
    const chatRoot = document.getElementById('chat');
    if (!chatRoot) return [];
    const children = chatRoot.children;
    if (children.length <= DOM_HEALTH_CHECK_VISIBLE_LIMIT) {
        domHealthCheckCursor = 0;
        return [...children].filter(element => element.matches?.('.mes[mesid]'));
    }

    // Sample the rendered chat viewport without reading every message's geometry,
    // then keep recent messages hot and rotate through the remainder.
    const selected = new Set();
    const sampledVisible = new Set();
    const chatRect = chatRoot?.getBoundingClientRect?.();
    if (chatRoot && chatRect) {
        const top = Math.max(0, chatRect.top);
        const bottom = Math.min(window.innerHeight, chatRect.bottom);
        const x = Math.max(0, Math.min(window.innerWidth - 1, chatRect.left + chatRect.width / 2));
        if (bottom > top) {
            const sampleCount = Math.min(10, DOM_HEALTH_CHECK_VISIBLE_LIMIT);
            for (let index = 0; index < sampleCount; index++) {
                const y = top + ((bottom - top) * (index + 0.5) / sampleCount);
                const elementsAtPoint = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
                const message = elementsAtPoint
                    .map(element => element.closest?.('.mes[mesid]'))
                    .find(element => element && chatRoot.contains(element));
                if (message) sampledVisible.add(message);
            }
        }
    }
    const visibleMessages = [...sampledVisible].sort((left, right) => {
        if (left === right) return 0;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    if (visibleMessages.length) {
        let message = visibleMessages[0];
        const lastVisible = visibleMessages[visibleMessages.length - 1];
        while (message && selected.size < DOM_HEALTH_CHECK_VISIBLE_LIMIT) {
            if (message.matches?.('.mes[mesid]')) selected.add(message);
            if (message === lastVisible) break;
            message = message.nextElementSibling;
        }
    }
    const tailCount = Math.max(4, Math.floor(DOM_HEALTH_CHECK_VISIBLE_LIMIT / 3));
    let tail = chatRoot.lastElementChild;
    let tailScanned = 0;
    while (tail && tailScanned < tailCount && selected.size < DOM_HEALTH_CHECK_VISIBLE_LIMIT) {
        const message = tail;
        tail = tail.previousElementSibling;
        if (!message.matches?.('.mes[mesid]')) continue;
        if (selected.size >= DOM_HEALTH_CHECK_VISIBLE_LIMIT) break;
        selected.add(message);
        tailScanned++;
    }
    let scanned = 0;
    const scanLimit = Math.min(children.length, DOM_HEALTH_CHECK_VISIBLE_LIMIT * 3);
    while (selected.size < DOM_HEALTH_CHECK_VISIBLE_LIMIT && scanned < scanLimit) {
        const message = children[(domHealthCheckCursor + scanned) % children.length];
        if (message?.matches?.('.mes[mesid]')) selected.add(message);
        scanned++;
    }
    domHealthCheckCursor = (domHealthCheckCursor + Math.max(1, scanned)) % children.length;
    return Array.from(selected);
}

// Consecutive health-check 'refresh' attempts per message+text. Caps the
// re-render loop when a segment can never match the rendered DOM.
const DOM_HEALTH_REFRESH_MAX_ATTEMPTS = 4;
const healthRefreshAttempts = new Map();

export function getMessageDomHealthRepairType(mesElement, msg, mesIndex) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText || !msg || msg.is_system) return '';
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return '';
    if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) return '';
    const readiness = getMessageDomReadiness(mesElement, msg, mesIndex);
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    const narratorMissing = narrator && !mesText.querySelector('[data-dc-narrator]')
        && hasNarratorTextNodesToDecorate(mesText);
    if (readiness.totalSegments === 0) {
        return narratorMissing ? 'decorate' : '';
    }
    if (!readiness.ready) return 'refresh';
    return readiness.expectedDecorations > readiness.correctDecorations || narratorMissing ? 'decorate' : '';
}

export function runDomHealthCheck() {
    if (!settings.enabled || !isDomEngine()) {
        stopDomHealthCheck();
        return;
    }
    if (isDecoratingDom) return;
    setupChatObserver();

    const chat = getContext()?.chat || [];
    const decorateTargets = new Set();
    if (!decoratedWatcherHealthIterator) decoratedWatcherHealthIterator = runtimeState.decoratedWatchers.entries();
    for (let checked = 0; checked < DOM_HEALTH_CHECK_VISIBLE_LIMIT; checked++) {
        let next = decoratedWatcherHealthIterator.next();
        if (next.done) {
            decoratedWatcherHealthIterator = null;
            break;
        }
        const [mesElement, watcher] = next.value;
        const currentMesText = mesElement?.querySelector?.('.mes_text');
        if (!mesElement?.isConnected || !currentMesText?.isConnected) {
            clearDecoratedWatcher(mesElement);
            continue;
        }
        const repairIndex = Number(mesElement.getAttribute('mesid'));
        if (suspendMessageDomWorkForEdit(mesElement, repairIndex)) continue;
        if (watcher?.mesText !== currentMesText) {
            clearDecoratedWatcher(mesElement);
            scheduleMessageDomRepair(repairIndex, { delay: 0, verify: false });
        }
    }

    for (const mesElement of collectDomHealthCheckMessages()) {
        const mesIndex = Number(mesElement.getAttribute('mesid'));
        if (!Number.isFinite(mesIndex) || mesIndex < 0) continue;
        if (runtimeState.messageDomRepairTimers.has(mesIndex)) continue;
        const msg = chat[mesIndex];
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
        const repairType = getMessageDomHealthRepairType(mesElement, msg, mesIndex);
        const attemptsKey = `${mesIndex}:${hashMessageText(msg?.mes)}`;
        if (repairType === 'refresh') {
            // Back off after a few consecutive failures: if a segment can never
            // match the rendered DOM (e.g. **bold** rendered as <strong>), an
            // unbounded refresh loop re-renders innerHTML every tick (flicker).
            const attempts = healthRefreshAttempts.get(attemptsKey) || 0;
            if (attempts < DOM_HEALTH_REFRESH_MAX_ATTEMPTS) {
                healthRefreshAttempts.set(attemptsKey, attempts + 1);
                // renderFallback:false — the health check must never rewrite
                // .mes_text innerHTML; that retriggers the observer cascade.
                scheduleMessageDomRepair(mesIndex, { delay: 0, verify: false, renderFallback: false });
            }
            continue;
        }
        healthRefreshAttempts.delete(attemptsKey);
        if (repairType === 'decorate') {
            decorateTargets.add(mesElement);
            continue;
        }
        const mesText = mesElement.querySelector('.mes_text');
        if (mesText?.querySelector?.('[data-dc-colored], [data-dc-narrator]') && !runtimeState.decoratedWatchers.has(mesElement)) {
            watchDecoratedMessage(mesElement, mesIndex);
        }
    }

    if (decorateTargets.size) decorateObservedMessages(Array.from(decorateTargets));
}

export function startDomHealthCheck() {
    if (!settings.enabled || !isDomEngine() || runtimeState.domHealthCheckTimer) return;
    runtimeState.domHealthCheckTimer = setInterval(runDomHealthCheck, DOM_HEALTH_CHECK_INTERVAL_MS);
}

export function stopDomHealthCheck() {
    if (runtimeState.domHealthCheckTimer) {
        clearInterval(runtimeState.domHealthCheckTimer);
        runtimeState.domHealthCheckTimer = null;
    }
    clearMessageDomRepairTimers();
}

/**
 * Bounded fallback pass series for races where ST/external agents update
 * msg.mes before the rendered .mes_text has caught up. Per-message observers
 * handle the common path; these delayed passes keep verification/overrides
 * from requiring a full chat reload when the live DOM is briefly stale.
 */

export function scheduleDomSettleRefresh(delays = DOM_RETRY_REFRESH_DELAYS, reason = 'settle') {
    if (!isDomEngine()) return;
    startDomHealthCheck();
    const refreshDelays = Array.isArray(delays) && delays.length ? delays : [400];
    const chatGeneration = attributionChatGeneration;
    const reasonKey = String(reason || 'settle');
    const normalizedDelays = refreshDelays.map(delay => Math.max(0, Number(delay) || 0));
    const requestKey = `${chatGeneration}:${reasonKey}:${normalizedDelays.join(',')}`;
    // Restart the bounded fallbacks relative to the latest render trigger.
    clearDomSettleRefreshes();
    pendingDomSettleRefreshKey = requestKey;
    pendingDomSettleRefreshCount = normalizedDelays.length;
    normalizedDelays.forEach((normalizedDelay, index) => {
        const key = `__settle_fallback_${index}__`;
        const timer = setTimeout(() => {
            runtimeState.messageSettleObservers.delete(key);
            if (pendingDomSettleRefreshKey === requestKey) {
                pendingDomSettleRefreshCount--;
                if (pendingDomSettleRefreshCount <= 0) {
                    pendingDomSettleRefreshKey = '';
                    pendingDomSettleRefreshCount = 0;
                }
            }
            if (!settings.enabled || !isDomEngine()) return;
            if (chatGeneration !== attributionChatGeneration) return;
            setupChatObserver();
            decorateAllMessages();
        }, normalizedDelay);
        runtimeState.messageSettleObservers.set(key, {
            observer: { disconnect: () => {} },
            fallbackTimer: timer,
        });
    });
}

export function scheduleDomRefreshSeries(delay = 0) {
    startDomHealthCheck();
    scheduleDecorateAll(delay);
}

export function decorateAllMessages() {
    const previousDecoratingState = isDecoratingDom;
    isDecoratingDom = true;
    try {
        if (!settings.enabled || !isDomEngine()) {
            stopDomHealthCheck();
            undecorateAllMessages();
            return;
        }
        const ctx = getContext();
        const chat = ctx?.chat || [];
        const countResult = refreshDomDialogueCounts(chat);
        let changedColorData = countResult.changed;
        document.querySelectorAll('#chat .mes[mesid]').forEach(mesElement => {
            const mesIndex = Number(mesElement.getAttribute('mesid'));
            const msg = chat[mesIndex];
            if (!msg) return;
            const result = decorateMessageDom(mesElement, msg, mesIndex);
            if (result.createdCharacters) changedColorData = true;
            // If the message's quotes/emphasis have not rendered yet, attach a
            // self-terminating observer that finishes decoration once they appear.
            if (result.needsRetry) {
                attachMessageSettleObserver(mesElement, mesIndex);
            } else if (result.decorated) {
                // Fully decorated: watch for external re-renders (e.g. Prose Polisher).
                watchDecoratedMessage(mesElement, mesIndex);
            }
        });
        if (changedColorData) {
            // Decoration discovered new characters/counts. Persist via the
            // debounced color-state saver instead of a synchronous heavy
            // saveData()+updateCharList() on every render pass.
            queueColorStateSave({ history: false, injectPrompt: false });
        }
        updateLegend();
        queueAutoAttributionVerificationForRenderedMessages();
    } finally {
        isDecoratingDom = previousDecoratingState;
        if (pendingDeferredMutations) {
            pendingDeferredMutations = false;
            scheduleDecorateAll(0);
        }
    }
}

export function decorateMessageElementByIndex(mesElement, mesIndex) {
    if (!mesElement || !Number.isFinite(mesIndex) || mesIndex < 0) return { decorated: false, createdCharacters: false };
    const msg = getContext()?.chat?.[mesIndex];
    if (!msg) return { decorated: false, createdCharacters: false };
    return decorateMessageDom(mesElement, msg, mesIndex);
}

export function decorateObservedMessages(elements, options = {}) {
    if (!settings.enabled || !isDomEngine() || !elements?.length) return;
    const previousDecoratingState = isDecoratingDom;
    isDecoratingDom = true;
    let createdCharacters = false;
    const verificationElements = [];
    try {
        for (const mesElement of elements) {
            if (!mesElement?.isConnected) continue;
            const mesIndex = Number(mesElement.getAttribute('mesid'));
            if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
            verificationElements.push(mesElement);
            const result = decorateMessageElementByIndex(mesElement, mesIndex);
            if (result.createdCharacters) createdCharacters = true;
            if (result.needsRetry) {
                attachMessageSettleObserver(mesElement, mesIndex);
            } else if (result.decorated) {
                watchDecoratedMessage(mesElement, mesIndex);
            }
        }
    } finally {
        isDecoratingDom = previousDecoratingState;
        if (pendingDeferredMutations) {
            pendingDeferredMutations = false;
            scheduleDecorateAll(0);
        }
    }
    if (createdCharacters) {
        queueColorStateSave({ history: false, injectPrompt: false });
    }
    updateLegend();
    if (options.queueVerification !== false) queueAutoAttributionVerificationForElements(verificationElements);
}

export function decorateLastMessageDom() {
    if (!settings.enabled || !isDomEngine()) return;
    const messages = document.querySelectorAll('#chat .mes[mesid]');
    const mesElement = messages[messages.length - 1];
    if (!mesElement) return;
    decorateObservedMessages([mesElement]);
}

export function scheduleDecorateAll(delay = 100) {
    if (!isDomEngine()) return;
    startDomHealthCheck();
    const now = Date.now();
    if (!decorateAllFirstCallTime) decorateAllFirstCallTime = now;
    clearTimeout(decorateAllTimer);
    const effectiveDelay = Math.min(delay, Math.max(0, DECORATE_ALL_MAX_WAIT - (now - decorateAllFirstCallTime)));
    decorateAllTimer = setTimeout(() => {
        decorateAllTimer = null;
        decorateAllFirstCallTime = 0;
        decorateAllMessages();
    }, effectiveDelay);
}

export function scheduleDecorateLast(delay = 80) {
    if (!settings.enabled || !isDomEngine()) return;
    startDomHealthCheck();
    const now = Date.now();
    if (!decorateLastFirstCallTime) decorateLastFirstCallTime = now;
    clearTimeout(decorateLastTimer);
    const effectiveDelay = Math.min(delay, Math.max(0, DECORATE_LAST_MAX_WAIT - (now - decorateLastFirstCallTime)));
    decorateLastTimer = setTimeout(() => {
        decorateLastTimer = null;
        decorateLastFirstCallTime = 0;
        decorateLastMessageDom();
    }, effectiveDelay);
}

export function disconnectChatObserver() {
    if (runtimeState.chatObserver) runtimeState.chatObserver.disconnect();
    runtimeState.chatObserver = null;
    runtimeState.chatObserverTarget = null;
    if (runtimeState.chatObserverTimer) clearTimeout(runtimeState.chatObserverTimer);
    runtimeState.chatObserverTimer = null;
    observedDecorationFirstCallTime = 0;
    runtimeState.pendingObservedMessages?.clear?.();
}

export function queueObservedMessageDecoration(mesElement) {
    if (!mesElement || !settings.enabled || !isDomEngine()) return;
    const mesIndex = Number(mesElement.getAttribute('mesid'));
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    const now = Date.now();
    if (!observedDecorationFirstCallTime) observedDecorationFirstCallTime = now;
    runtimeState.pendingObservedMessages.add(mesElement);
    if (runtimeState.chatObserverTimer) clearTimeout(runtimeState.chatObserverTimer);
    const effectiveDelay = Math.min(80, Math.max(0, OBSERVED_DECORATION_MAX_WAIT - (now - observedDecorationFirstCallTime)));
    runtimeState.chatObserverTimer = setTimeout(() => {
        runtimeState.chatObserverTimer = null;
        observedDecorationFirstCallTime = 0;
        const pending = Array.from(runtimeState.pendingObservedMessages || []);
        runtimeState.pendingObservedMessages.clear();
        decorateObservedMessages(pending);
    }, effectiveDelay);
}

export function shouldDecorateObservedMessageImmediately(mesElement) {
    if (!mesElement || !settings.enabled || !isDomEngine()) return false;
    const mesIndex = Number(mesElement.getAttribute('mesid'));
    if (!Number.isFinite(mesIndex) || mesIndex < 0) return false;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return false;
    const msg = getContext()?.chat?.[mesIndex];
    return hasMessageQuoteOverridesForDecoration(mesIndex, msg);
}

export function collectMutatedMessageElements(mutation) {
    const elements = [];
    const pushClosestMessage = node => {
        if (!node) return;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        const direct = element?.matches?.('.mes[mesid]') ? element : element?.closest?.('.mes[mesid]');
        if (direct) elements.push(direct);
    };
    const pushAddedMessages = node => {
        if (!node) return;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        pushClosestMessage(element);
        element?.querySelectorAll?.('.mes[mesid]')?.forEach(mesElement => elements.push(mesElement));
    };
    pushClosestMessage(mutation.target);
    mutation.addedNodes?.forEach(pushAddedMessages);
    return elements;
}

export function setupChatObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    if (runtimeState.chatObserver && runtimeState.chatObserverTarget === chatEl) return;
    disconnectChatObserver();
    runtimeState.pendingObservedMessages = new Set();
    runtimeState.chatObserverTarget = chatEl;
    runtimeState.chatObserver = new MutationObserver(mutations => {
        if (!settings.enabled) {
            clearCustomFontsFromFontTags(chatEl);
            return;
        }
        if (isDecoratingDom) { pendingDeferredMutations = true; return; }
        const immediate = new Set();
        const delayed = new Set();
        const fontTargets = new Set();
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class'
                && mutation.target?.matches?.('[data-dc-colored], font[data-dc-gradient]')) {
                continue;
            }
            for (const mesElement of collectMutatedMessageElements(mutation)) {
                const mesIndex = Number(mesElement?.getAttribute?.('mesid'));
                if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
                fontTargets.add(mesElement);
                if (!isDomEngine()) continue;
                if (shouldDecorateObservedMessageImmediately(mesElement)) immediate.add(mesElement);
                else delayed.add(mesElement);
            }
        }
        if (!isDomEngine()) {
            applyCustomFontsToMessageElements(fontTargets);
            return;
        }
        if (immediate.size) {
            for (const mesElement of immediate) runtimeState.pendingObservedMessages.delete(mesElement);
            decorateObservedMessages(Array.from(immediate));
        }
        for (const mesElement of delayed) queueObservedMessageDecoration(mesElement);
    });
    runtimeState.chatObserver.observe(chatEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'mesid'] });
}

export function setupChatRootObserver() {
    if (runtimeState.chatRootObserver || !document.body) return;
    const mutationTouchesChatRoot = mutations => {
        if (runtimeState.chatObserverTarget && !runtimeState.chatObserverTarget.isConnected) return true;
        const hasChatNode = node => {
            const element = node?.nodeType === Node.ELEMENT_NODE ? node : null;
            return !!element && (element.id === 'chat' || !!element.querySelector?.('#chat'));
        };
        return mutations.some(mutation => {
            if (mutation.target === runtimeState.chatObserverTarget) return false;
            return Array.from(mutation.addedNodes || []).some(hasChatNode)
                || Array.from(mutation.removedNodes || []).some(hasChatNode);
        });
    };
    runtimeState.chatRootObserver = new MutationObserver(mutations => {
        scheduleCardStyle(100);
        if (!mutationTouchesChatRoot(mutations)) return;
        if (runtimeState.chatRootObserverTimer) clearTimeout(runtimeState.chatRootObserverTimer);
        runtimeState.chatRootObserverTimer = setTimeout(() => {
            runtimeState.chatRootObserverTimer = null;
            const chatEl = document.getElementById('chat');
            if (!chatEl || runtimeState.chatObserverTarget === chatEl) return;
            for (const key of [...runtimeState.messageSettleObservers.keys()]) {
                if (key instanceof Element) clearMessageObservers(key);
            }
            clearDomSettleRefreshes();
            clearDecoratedWatchers();
            setupChatObserver();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            scheduleCustomFontRefresh(80);
        }, 50);
    });
    runtimeState.chatRootObserver.observe(document.body, { childList: true, subtree: true });
}
