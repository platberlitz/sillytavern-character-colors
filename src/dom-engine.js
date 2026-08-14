// dom-engine.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { ATTRIBUTION_REVIEW_METADATA_KEY, ATTRIBUTION_REVIEW_STATUS, ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS, createAttributionStore, createMessageFingerprint, deleteAttributionOverrideRecord, getAttributionConfidenceBand, isHostSystemOrToolMessage, isLegacyAttributionOverrideEntry, normalizeAttributionConfidence, normalizeAttributionSource, setAttributionOverrideRecord } from './attribution-store.js';
import { unregisterGradientAnimationRoot } from './animation-controller.js';
import { buildUniqueKnownColorStatsLookup, collectFontColorsFromText, countFontColorOccurrencesFromText, resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { applyCustomFontsToFontTags, applyCustomFontsToMessageElements, clearCustomFontsFromFontTags, loadGoogleFont, scheduleCardStyle, scheduleCustomFontRefresh } from './fonts.js';
import { applyGradientText, clearGradientText, getVisualRenderState } from './gradient-rendering.js';
import { isTrackedPersonaMessage, onNewMessage, queueColorStateSave } from './live-colors.js';
import { getNarratorVisual } from './narrator-style.js';
import { applyThemeReadabilityAndBrightness } from './palettes.js';
import { escapeHtml, eventSource, event_types, getContext } from './st-api.js';
import { ATTRIBUTION_VERIFIER_VERSION, AUTO_ATTRIBUTION_VERIFY_DELAY_MS, attributionChatGeneration, characterColors, isDomEngine, runtimeState, settings, streamingAttributionOverrides, streamingSession } from './state.js';
import { isPlainObject } from './storage.js';
import { applyTextStyle, clearTextStyle } from './text-style-rendering.js';
import { updateLegend } from './ui.js';
import { captureOpenDetailsState, getGoogleFontFamily, getMessageElementByIndex, hashMessageText, normalizeSegmentText, restoreOpenDetailsState, stripColorBlocks } from './utils.js';
import { queueAutoAttributionVerificationForElements, queueAutoAttributionVerificationForMessage, queueAutoAttributionVerificationForRenderedMessages } from './verify.js';

function getStableMessageId(message) {
    for (const value of [message?.id, message?.send_date]) {
        if (value === undefined || value === null) continue;
        const id = String(value).trim().slice(0, 120);
        if (id) return id;
    }
    return '';
}

function getMessageText(message) {
    return String(message?.mes ?? message?.text ?? '');
}

function getMessageSpeaker(message) {
    return String(message?.name ?? message?.speaker ?? '');
}

export function isDomTargetMessage(msg) {
    if (!msg || isHostSystemOrToolMessage(msg)) return false;
    return isDomEngine() || isTrackedPersonaMessage(msg);
}

function hasDomTargetMessages(chat = getContext()?.chat || []) {
    return isDomEngine() || (Array.isArray(chat) && chat.some(isTrackedPersonaMessage));
}

function isHybridPersonaMessage(msg) {
    return !isDomEngine() && isTrackedPersonaMessage(msg);
}

function getChatContextIdentity(ctx) {
    const normalizeId = value => {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '';
    };
    const chatId = normalizeId(ctx?.chatId ?? ctx?.chat_id);
    const groupId = normalizeId(ctx?.groupId ?? ctx?.group_id);
    const characterIndex = ctx?.characterId ?? ctx?.character_id;
    const character = groupId || chatId ? null : ctx?.characters?.[characterIndex];
    const ownerId = groupId || chatId
        ? ''
        : normalizeId(character?.avatar ?? character?.characterId ?? character?.character_id ?? characterIndex);
    return `chat:${chatId}\u0000group:${groupId}\u0000owner:${ownerId}`;
}

function captureMessageDomTarget(messageIndex, message, ctx = getContext()) {
    const index = Number(messageIndex);
    const chat = ctx?.chat;
    if (!Number.isInteger(index) || index < 0 || !Array.isArray(chat)) return null;
    const currentMessage = message ?? chat[index];
    if (!currentMessage || chat[index] !== currentMessage) return null;
    const text = getMessageText(currentMessage);
    const mesElement = getMessageElementByIndex(index);
    return {
        chatGeneration: attributionChatGeneration,
        context: ctx,
        contextIdentity: getChatContextIdentity(ctx),
        chat,
        message: currentMessage,
        messageId: getStableMessageId(currentMessage),
        messageIndex: index,
        messageHash: hashMessageText(text),
        messageText: text,
        messageSpeaker: getMessageSpeaker(currentMessage),
        isSystem: !!currentMessage.is_system,
        isUser: !!currentMessage.is_user,
        chatRoot: typeof document !== 'undefined' ? document.getElementById('chat') : null,
        mesElement,
        mesTextElement: mesElement?.querySelector?.('.mes_text') || null,
    };
}

function isMessageDomTargetCurrent(target) {
    if (!target || target.chatGeneration !== attributionChatGeneration) return false;
    const ctx = getContext();
    if (!ctx || getChatContextIdentity(ctx) !== target.contextIdentity || ctx.chat !== target.chat) return false;
    const message = target.chat[target.messageIndex];
    if (message !== target.message) return false;
    const currentMessageId = getStableMessageId(message);
    if ((target.messageId || currentMessageId) && target.messageId !== currentMessageId) return false;
    const currentText = getMessageText(message);
    if (currentText !== target.messageText || hashMessageText(currentText) !== target.messageHash) return false;
    if (getMessageSpeaker(message) !== target.messageSpeaker
        || !!message.is_system !== target.isSystem
        || !!message.is_user !== target.isUser) return false;
    if (target.chatRoot && (typeof document === 'undefined' || document.getElementById('chat') !== target.chatRoot)) return false;
    return true;
}

function isMessageDomElementCurrent(target, mesElement) {
    if (!isMessageDomTargetCurrent(target) || !mesElement || mesElement.isConnected === false) return false;
    if (target.mesElement && mesElement !== target.mesElement) return false;
    if (Number(mesElement.getAttribute?.('mesid')) !== target.messageIndex) return false;
    if (target.mesTextElement && mesElement.querySelector?.('.mes_text') !== target.mesTextElement) return false;
    return getMessageElementByIndex(target.messageIndex) === mesElement;
}

function isMessageDomWriteTargetCurrent(target) {
    return isMessageDomTargetCurrent(target)
        && (!target.mesElement || isMessageDomElementCurrent(target, target.mesElement));
}

function renderMessageDomFallbackForTarget(target, detailsState = null) {
    if (!isMessageDomWriteTargetCurrent(target)) return false;
    const mesEl = target.mesElement || getMessageElementByIndex(target.messageIndex);
    const mesText = target.mesTextElement || mesEl?.querySelector?.('.mes_text');
    if (!mesText || !isMessageDomElementCurrent(target, mesEl)) return false;
    if (suspendMessageDomWorkForEdit(mesEl, target.messageIndex)) return false;
    if (!isMessageDomElementCurrent(target, mesEl) || mesEl.querySelector?.('.mes_text') !== mesText) return false;
    const openDetailsState = detailsState ?? captureOpenDetailsState(mesText);
    const rawText = stripColorBlocks(target.messageText);
    let formatted = '';
    try {
        if (typeof target.context?.messageFormatting === 'function') {
            formatted = target.context.messageFormatting(rawText, target.messageSpeaker, target.isSystem, target.isUser, target.messageIndex);
        }
    } catch (e) {
        console.warn('[Dialogue Colors] Message formatting fallback failed:', e);
        formatted = '';
    }
    if (!isMessageDomElementCurrent(target, mesEl) || mesEl.querySelector?.('.mes_text') !== mesText) return false;
    mesText.innerHTML = formatted || escapeHtml(rawText).replace(/\n/g, '<br>');
    if (!isMessageDomElementCurrent(target, mesEl) || mesEl.querySelector?.('.mes_text') !== mesText) return false;
    restoreOpenDetailsState(mesText, openDetailsState);
    return isMessageDomElementCurrent(target, mesEl) && mesEl.querySelector?.('.mes_text') === mesText;
}

export function renderMessageDomFallback(messageIndex, message, ctx = getContext(), detailsState = null) {
    const target = captureMessageDomTarget(messageIndex, message, ctx);
    return target ? renderMessageDomFallbackForTarget(target, detailsState) : false;
}

async function refreshMessageDomForTarget(target) {
    if (!isMessageDomWriteTargetCurrent(target)) return false;
    const { messageIndex, message, context: ctx } = target;
    const mesElement = target.mesElement;
    if (mesElement && suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
    if (!isMessageDomWriteTargetCurrent(target)) return false;
    const openDetailsState = captureMessageOpenDetailsState(mesElement, messageIndex);
    if (typeof ctx?.updateMessageBlock === 'function') {
        let timeoutId = null;
        let timedOut = false;
        try {
            if (!isMessageDomWriteTargetCurrent(target)) return false;
            const updatePromise = Promise.resolve(ctx.updateMessageBlock(messageIndex, message))
                // Skip the deferred details-restore if the fallback path already
                // took over; re-applying the stale snapshot would revert any
                // <details> the user toggled in the interim.
                .finally(() => {
                    if (!timedOut && mesElement && isMessageDomElementCurrent(target, mesElement)) {
                        restoreMessageOpenDetailsState(mesElement, messageIndex, openDetailsState);
                    }
                });
            const status = await Promise.race([
                updatePromise.then(() => 'updated'),
                new Promise(resolve => {
                    timeoutId = setTimeout(() => resolve('timeout'), UPDATE_MESSAGE_BLOCK_TIMEOUT_MS);
                }),
            ]);
            if (!isMessageDomTargetCurrent(target)) return false;
            if (status === 'updated') return true;
            timedOut = true;
            console.warn('[Dialogue Colors] updateMessageBlock timed out, using fallback render.');
        } catch (e) {
            console.warn('[Dialogue Colors] updateMessageBlock failed, using fallback render:', e);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }
    if (!isMessageDomWriteTargetCurrent(target)) return false;
    if (renderMessageDomFallbackForTarget(target, openDetailsState)) {
        return true;
    }
    if (typeof eventSource?.emit === 'function' && event_types?.MESSAGE_UPDATED) {
        try {
            if (!isMessageDomWriteTargetCurrent(target)) return false;
            await eventSource.emit(event_types.MESSAGE_UPDATED, messageIndex);
            return isMessageDomTargetCurrent(target);
        } catch (e) {
            console.warn('[Dialogue Colors] MESSAGE_UPDATED fallback emit failed:', e);
        }
    }
    return false;
}

export async function refreshMessageDom(messageIndex, message) {
    const target = captureMessageDomTarget(messageIndex, message);
    return target ? refreshMessageDomForTarget(target) : false;
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
    if (!mesText || !msg || !isDomTargetMessage(msg)) return { ready: false, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: 0, correctDecorations: 0 };
    const hasPersistedFontColors = mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size;
    if (hasPersistedFontColors && !isHybridPersonaMessage(msg)) {
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
    if (hasPersistedFontColors && isHybridPersonaMessage(msg) && !qElements.length && !emElements.length) {
        return { ready: true, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: mesText.querySelectorAll('[data-dc-colored]').length, correctDecorations: 0 };
    }
    const totalSegments = quoteSegments.length + emphasisSegments.length;
    const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
    let matchedSegments = 0;
    let correctDecorations = 0;
    const countMatch = (seg, el) => {
        matchedSegments++;
        if (seg.assignment && el.getAttribute('data-dc-speaker') === seg.assignment.key) correctDecorations++;
    };
    // Must use the same matching rules as decorateMessageDom, or readiness will
    // keep demanding re-renders for messages that decorated fine.
    matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), countMatch, { allowAnchoredFallback: true });
    matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), countMatch, { allowAnchoredFallback: true });
    return {
        ready: totalSegments === 0 || matchedSegments >= totalSegments,
        totalSegments,
        matchedSegments,
        expectedDecorations,
        coloredDecorations: mesText.querySelectorAll('[data-dc-colored]').length,
        correctDecorations,
    };
}

export function waitForMessageDomReadyForDecoration(messageIndex, msg, timeoutMs = 1600, isCurrent = null) {
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
            if (isCurrent && !isCurrent()) {
                finish({ ready: false, mesElement: getMessageElementByIndex(messageIndex), readiness: null, stale: true });
                return;
            }
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
    let target = captureMessageDomTarget(messageIndex, message);
    if (!target || !isDomTargetMessage(target.message) || !isMessageDomWriteTargetCurrent(target)) return false;
    const { message: msg, messageIndex: index } = target;
    if (target.mesElement && suspendMessageDomWorkForEdit(target.mesElement, index)) return false;
    if (!isMessageDomWriteTargetCurrent(target)) return false;
    await refreshMessageDomForTarget(target);
    if (!isMessageDomTargetCurrent(target)) return false;
    target = captureMessageDomTarget(index, msg);
    if (!target || !isMessageDomWriteTargetCurrent(target)) return false;
    const isCurrent = () => isMessageDomWriteTargetCurrent(target);
    let { ready, mesElement: readyMesElement, edited, stale } = await waitForMessageDomReadyForDecoration(index, msg, 1600, isCurrent);
    if (edited || stale || !isCurrent()) return false;
    if (!ready && renderMessageDomFallbackForTarget(target)) {
        if (!isCurrent()) return false;
        await waitForDomFrame();
        if (!isCurrent()) return false;
        ({ ready, mesElement: readyMesElement, edited, stale } = await waitForMessageDomReadyForDecoration(index, msg, 300, isCurrent));
        if (edited || stale || !isCurrent()) return false;
    }
    const effectiveMesElement = readyMesElement || getMessageElementByIndex(index);
    if (!isMessageDomElementCurrent(target, effectiveMesElement)) return false;
    decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
    if (!isMessageDomTargetCurrent(target)) return false;
    scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
    return true;
}

// Per-message follow-up repair timers so override/verifier repaints can be
// cancelled when a newer override lands for the same message (prevents
// stale follow-ups from re-decorating with outdated state).

export async function decorateMessageDomFromCurrentRender(messageIndex, message, options = {}) {
    const target = captureMessageDomTarget(messageIndex, message);
    if (!target || !isDomTargetMessage(target.message)) return false;
    const { message: msg, messageIndex: index } = target;
    const isCurrent = () => isMessageDomWriteTargetCurrent(target)
        && (!options.isCurrent || options.isCurrent());
    if (!isCurrent()) return false;
    if (target.mesElement && suspendMessageDomWorkForEdit(target.mesElement, index)) return false;
    if (!isCurrent()) return false;
    let { ready, mesElement: readyMesElement, edited, stale } = await waitForMessageDomReadyForDecoration(index, msg, options.timeoutMs ?? 400, isCurrent);
    if (edited || stale || !isCurrent()) return false;
    if (!ready && options.renderFallback !== false && renderMessageDomFallbackForTarget(target)) {
        if (!isCurrent()) return false;
        await waitForDomFrame();
        if (!isCurrent()) return false;
        ({ ready, mesElement: readyMesElement, edited, stale } = await waitForMessageDomReadyForDecoration(index, msg, 300, isCurrent));
        if (edited || stale || !isCurrent()) return false;
    }
    if (!ready && options.renderFallback === false) return false;
    if (!isCurrent()) return false;
    const effectiveMesElement = readyMesElement || getMessageElementByIndex(index);
    if (!isMessageDomElementCurrent(target, effectiveMesElement)) return false;
    decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
    return isMessageDomTargetCurrent(target);
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
    if (isStreamingOwnedMessage(index)) return;
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;
    const target = captureMessageDomTarget(index);
    if (!target || !isDomTargetMessage(target.message)) return;
    // Cancel any in-flight follow-ups for this message first so we never
    // stack overlapping repair passes that fight each other.
    cancelMessageDomFollowupRepairs(index);
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
                if (!settings.enabled || !hasDomTargetMessages()) return;
                if (!isMessageDomTargetCurrent(target)) return;
                const msg = target.message;
                const mesElement = getMessageElementByIndex(index);
                if (!msg || !mesElement) return;
                if (suspendMessageDomWorkForEdit(mesElement, index)) return;
                const repairType = getMessageDomHealthRepairType(mesElement, msg, index);
                // renderFallback:false — never write .mes_text innerHTML here.
                // A fallback write would trigger the chat observer and cause a
                // re-decoration cascade (the flicker users were seeing).
                if (repairType === 'refresh') {
                    await decorateMessageDomFromCurrentRender(index, msg, {
                        queueVerification: false,
                        renderFallback: false,
                        isCurrent: () => isMessageDomTargetCurrent(target),
                    });
                } else if (repairType === 'decorate' && isMessageDomTargetCurrent(target)) {
                    decorateObservedMessages([mesElement], { queueVerification: false });
                }
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
    messageDomRepairTokens.delete(index);
    messageDomRepairSources.delete(index);
}

export function clearMessageDomRepairTimers() {
    for (const timer of runtimeState.messageDomRepairTimers.values()) clearTimeout(timer);
    runtimeState.messageDomRepairTimers.clear();
    messageDomRepairTokens.clear();
    messageDomRepairSources.clear();
    // Also clear all per-message follow-up repair timers.
    for (const timers of messageDomFollowupTimers.values()) timers.forEach(clearTimeout);
    messageDomFollowupTimers.clear();
    healthRefreshAttempts.clear();
}

const messageDomRepairTokens = new Map();
const messageDomRepairSources = new Map();
let nextMessageDomRepairToken = 0;

function clearPendingObservedMessage(index) {
    const pending = runtimeState.pendingObservedMessages;
    if (!pending?.size) return;
    for (const mesElement of pending) {
        if (Number(mesElement?.getAttribute?.('mesid')) === index) pending.delete(mesElement);
    }
    if (!pending.size && runtimeState.chatObserverTimer) {
        clearTimeout(runtimeState.chatObserverTimer);
        runtimeState.chatObserverTimer = null;
        observedDecorationFirstCallTime = 0;
    }
}

export function scheduleMessageDomRepair(mesIndex, options = {}) {
    const index = Number(mesIndex);
    if (!Number.isFinite(index) || index < 0) return false;

    if (isStreamingOwnedMessage(index)) return false;
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return false;
    const target = captureMessageDomTarget(index);
    if (!target || !isDomTargetMessage(target.message)) return false;

    const source = options.source || 'fallback';
    if (source === 'observer' && messageDomRepairSources.has(index)) return false;

    if (source === 'lifecycle') clearPendingObservedMessage(index);

    clearMessageDomRepairTimer(index);

    const token = ++nextMessageDomRepairToken;
    messageDomRepairTokens.set(index, token);
    messageDomRepairSources.set(index, source);
    const isCurrent = () => messageDomRepairTokens.get(index) === token
        && isMessageDomTargetCurrent(target);
    const delay = Math.max(0, Number(options.delay ?? POST_MUTATION_DOM_REPAIR_DELAY_MS) || 0);
    const timer = setTimeout(async () => {
        try {
            if (!settings.enabled || !hasDomTargetMessages()) return;
            if (!isCurrent()) return;

            const msg = target.message;
            if (!msg || !isDomTargetMessage(msg)) return;
            if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;

            await decorateMessageDomFromCurrentRender(index, msg, {
                queueVerification: options.queueVerification !== false,
                timeoutMs: options.timeoutMs ?? 700,
                renderFallback: options.renderFallback,
                isCurrent,
            });

            if (!isCurrent()) return;

            if (isDomEngine() && options.verify !== false) {
                queueAutoAttributionVerificationForMessage(index, {
                    force: options.forceVerify === true,
                    delay: options.verifyDelay ?? AUTO_ATTRIBUTION_VERIFY_DELAY_MS,
                });
            }
        } catch (e) {
            console.warn('[Dialogue Colors] Post-update DOM repair failed:', e);
            if (!isCurrent()) return;
            const mesElement = getMessageElementByIndex(index);
            if (mesElement && options.renderFallback !== false) {
                decorateObservedMessages([mesElement], { queueVerification: options.queueVerification !== false });
            }
        } finally {
            if (runtimeState.messageDomRepairTimers.get(index) === timer) {
                runtimeState.messageDomRepairTimers.delete(index);
                messageDomRepairTokens.delete(index);
                messageDomRepairSources.delete(index);
            }
        }
    }, delay);
    runtimeState.messageDomRepairTimers.set(index, timer);
    return true;
}

// ===== DOM coloring engine (non-destructive) =====
export const OVERRIDES_METADATA_KEY = 'dialogue_colors_overrides';

export let decorateAllTimer = null;

export let isDecoratingDom = false;

export let decorateAllFirstCallTime = 0;

export let observedDecorationFirstCallTime = 0;

export const DECORATE_ALL_MAX_WAIT = 500;

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

// The streaming painter owns exactly one message and repaints it inside the
// host's own write frame. Every other scheduler must leave that index alone,
// or its clear->rebuild pass lands a frame later and shows uncoloured text.
export function isStreamingOwnedMessage(mesIndex) {
    return streamingSession.active && Number(mesIndex) === streamingSession.mesIndex;
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

let lastSavedChatMetadataScope = null;
let lastSavedChatMetadataBinding = null;
let dirtyChatMetadataScope = null;
let dirtyChatMetadataBinding = null;
let pendingChatMetadataSave = null;

function captureChatMetadataBinding(metadata = getChatMetadataStore(), ctx = getContext()) {
    return {
        chatGeneration: attributionChatGeneration,
        chat: ctx?.chat,
        contextIdentity: getChatContextIdentity(ctx),
        metadata,
    };
}

function chatMetadataBindingsEqual(left, right) {
    return !!left && !!right
        && left.chatGeneration === right.chatGeneration
        && left.chat === right.chat
        && left.contextIdentity === right.contextIdentity
        && left.metadata === right.metadata;
}

function isChatMetadataBindingCurrent(binding) {
    return chatMetadataBindingsEqual(binding, captureChatMetadataBinding());
}

export function saveChatMetadata() {
    const ctx = getContext();
    const metadata = getChatMetadataStore();
    const scope = snapshotChatMetadataScope(metadata);
    const binding = captureChatMetadataBinding(metadata, ctx);
    dirtyChatMetadataScope = scope;
    dirtyChatMetadataBinding = binding;
    let result;
    let debounced = false;
    try {
        // The host debounce is cancellable and returns no settlement signal;
        // bind durable attribution writes to this chat's immediate save instead.
        if (typeof ctx?.saveMetadata === 'function') {
            result = ctx.saveMetadata();
        } else if (typeof ctx?.saveMetadataDebounced === 'function') {
            debounced = true;
            result = ctx.saveMetadataDebounced();
        } else {
            return null;
        }
    } catch (error) {
        console.warn('[Dialogue Colors] Failed to save chat metadata:', error);
        return null;
    }

    const settle = () => {
        if (!isChatMetadataBindingCurrent(binding) || snapshotChatMetadataScope(metadata) !== scope) return;
        lastSavedChatMetadataScope = scope;
        lastSavedChatMetadataBinding = binding;
        if (chatMetadataBindingsEqual(dirtyChatMetadataBinding, binding) && dirtyChatMetadataScope === scope) {
            dirtyChatMetadataScope = null;
            dirtyChatMetadataBinding = null;
        }
    };

    if (result && typeof result.then === 'function') {
        const pending = { binding, scope };
        pendingChatMetadataSave = pending;
        Promise.resolve(result).then(value => {
            if (value !== false && pendingChatMetadataSave === pending) settle();
        }, error => {
            console.warn('[Dialogue Colors] Failed to save chat metadata:', error);
        }).finally(() => {
            if (pendingChatMetadataSave === pending) pendingChatMetadataSave = null;
        });
    } else if ((!debounced && result !== false) || result === true) {
        // A synchronous saveMetadata call has settled on return. Debounced
        // hosts must explicitly confirm; undefined can mean the call was folded
        // into or cancelled by another debounce.
        settle();
    }
    return result;
}

// A chat metadata save is a full rewrite of the chat file - the host stores
// chat_metadata in the file header - so a write that changes nothing still
// deletes and recreates the user's chat on disk. Everything this module writes
// lives under two keys, so serialising just those before and after a mutation
// is enough to tell a real edit from a no-op.
export function snapshotChatMetadataScope(metadata = getChatMetadataStore()) {
    if (!metadata) return null;
    try {
        return JSON.stringify([
            metadata[OVERRIDES_METADATA_KEY] ?? null,
            metadata[ATTRIBUTION_REVIEW_METADATA_KEY] ?? null,
        ]);
    } catch (_) {
        return null;
    }
}

// Saves only when the snapshot changed or an earlier attempt is still dirty.
// Callers without a before-snapshot compare against the last confirmed save;
// unknown snapshots save so serialization failures cannot drop a real edit.
export function saveChatMetadataIfChanged(before, metadata = getChatMetadataStore()) {
    const after = snapshotChatMetadataScope(metadata);
    const binding = captureChatMetadataBinding(metadata);
    const savedScope = chatMetadataBindingsEqual(lastSavedChatMetadataBinding, binding)
        ? lastSavedChatMetadataScope
        : null;
    const pendingSameScope = pendingChatMetadataSave
        && chatMetadataBindingsEqual(pendingChatMetadataSave.binding, binding)
        && pendingChatMetadataSave.scope === after;
    const dirtySameScope = chatMetadataBindingsEqual(dirtyChatMetadataBinding, binding)
        && dirtyChatMetadataScope === after;
    const baseline = before === null || before === undefined ? savedScope : before;
    const changed = baseline === null || baseline === undefined || after === null || baseline !== after;
    if (!changed && !dirtySameScope) return false;
    if (pendingSameScope) return false;
    dirtyChatMetadataScope = after;
    dirtyChatMetadataBinding = binding;
    saveChatMetadata();
    return true;
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

export function setStreamingAttributionOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
    const entry = getStreamingAttributionOverrideEntry(mesIndex, msg, true);
    if (!entry) return false;
    entry.segments[String(segmentIndex)] = String(speakerName);
    entry.sources[String(segmentIndex)] = options.source || 'llm';
    streamingSession.assignments.clear();
    return true;
}

export function clearStreamingAttributionOverrides(mesIndex = null) {
    if (mesIndex === null || mesIndex === undefined) streamingAttributionOverrides.clear();
    else streamingAttributionOverrides.delete(String(mesIndex));
}

function getStoredMessageFingerprint(entry) {
    let fingerprint = typeof entry?.messageFingerprint === 'string' ? entry.messageFingerprint.trim() : '';
    if (isPlainObject(entry?.records)) {
        for (const record of Object.values(entry.records)) {
            const recordFingerprint = typeof record?.messageFingerprint === 'string' ? record.messageFingerprint.trim() : '';
            if (!recordFingerprint) continue;
            if (fingerprint && fingerprint !== recordFingerprint) return null;
            fingerprint = recordFingerprint;
        }
    }
    return fingerprint;
}

function isLegacyMessageQuoteOverrideEntry(entry, msg) {
    if (!msg || getStoredMessageFingerprint(entry) === null) return false;
    const identity = getMessageAttributionIdentity(msg);
    return isLegacyAttributionOverrideEntry(entry, {
        messageHash: identity.hash,
        textLength: identity.textLength,
    });
}

function getMessageAttributionIdentity(msg) {
    const text = getMessageText(msg);
    return {
        hash: hashMessageText(text),
        messageId: getStableMessageId(msg),
        messageFingerprint: createMessageFingerprint({ name: getMessageSpeaker(msg), mes: text }),
        textLength: text.length,
    };
}

function messageQuoteOverrideEntryMatches(entry, msg) {
    if (!isPlainObject(entry) || !msg) return false;
    const identity = getMessageAttributionIdentity(msg);
    if (entry.hash !== identity.hash) return false;
    if (isLegacyMessageQuoteOverrideEntry(entry, msg)) return true;
    const storedMessageId = getStableMessageId({ id: entry.messageId });
    if ((storedMessageId || identity.messageId)
        && (!storedMessageId || !identity.messageId || storedMessageId !== identity.messageId)) return false;
    const storedFingerprint = getStoredMessageFingerprint(entry);
    if (storedFingerprint === null) return false;
    if (storedFingerprint && storedFingerprint !== identity.messageFingerprint) return false;
    const storedLength = Number(entry.textLength);
    const hasStoredLength = Number.isInteger(storedLength) && storedLength >= 0;
    if (hasStoredLength && storedLength !== identity.textLength) return false;
    // ID-less records are safe only when they carry the stronger text+speaker
    // fingerprint and explicit text length introduced by the provenance store.
    if (!storedMessageId && !identity.messageId && (!storedFingerprint || !hasStoredLength)) return false;
    return true;
}

function applyMessageAttributionIdentity(entry, msg) {
    const identity = getMessageAttributionIdentity(msg);
    entry.hash = identity.hash;
    entry.messageFingerprint = identity.messageFingerprint;
    entry.textLength = identity.textLength;
    if (identity.messageId) entry.messageId = identity.messageId;
    else delete entry.messageId;
    return entry;
}

function migrateLegacyMessageQuoteOverrideEntry(entry, msg) {
    if (!isLegacyMessageQuoteOverrideEntry(entry, msg)) return false;
    applyMessageAttributionIdentity(entry, msg);
    return true;
}

function createMessageQuoteOverrideEntry(msg) {
    return applyMessageAttributionIdentity({ segments: {} }, msg);
}

export function getMessageQuoteOverrideEntry(mesIndex, msg, create = false) {
    const index = Number(mesIndex);
    if (!Number.isInteger(index) || index < 0 || !msg) return null;
    const map = getQuoteOverridesMap(create);
    if (!map) return null;
    const key = String(index);
    let entry = map[key];
    if (!messageQuoteOverrideEntryMatches(entry, msg)) {
        if (!create) return null;
        entry = createMessageQuoteOverrideEntry(msg);
        map[key] = entry;
    }
    const migrated = migrateLegacyMessageQuoteOverrideEntry(entry, msg);
    if (!isPlainObject(entry.segments)) {
        if (!create) return null;
        entry.segments = {};
    }
    if (migrated) saveChatMetadata();
    return entry;
}

export function getMessageAttributionFreezeSegments(mesIndex, msg, targetSegmentIndex = -1) {
    if (!msg) return {};
    const target = Number(targetSegmentIndex);
    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex,
    });
    const frozen = {};
    for (const segment of attribution.segments) {
        if (segment.index === target) continue;
        frozen[String(segment.index)] = segment.assignment?.name || segment.assignment?.key || null;
    }
    return frozen;
}

export function setMessageQuoteOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
    const index = Number(mesIndex);
    const normalizedSegmentIndex = Number(segmentIndex);
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(normalizedSegmentIndex)
        || normalizedSegmentIndex < 0 || !msg) return false;
    const normalizedOptions = isPlainObject(options) ? options : {};
    let speaker;
    let source;
    let confidence;
    let reviewId = '';
    let evidence;
    try {
        speaker = String(speakerName ?? '').trim();
        if (!speaker) return false;
        source = normalizeAttributionSource(normalizedOptions.source, ATTRIBUTION_SOURCE.MANUAL);
        if (normalizedOptions.confidence !== undefined) {
            confidence = normalizeAttributionConfidence(normalizedOptions.confidence);
        }
        if (normalizedOptions.reviewId !== undefined && normalizedOptions.reviewId !== null) {
            reviewId = String(normalizedOptions.reviewId).trim().slice(0, 96);
        }
        if (normalizedOptions.evidence !== undefined) {
            evidence = Array.isArray(normalizedOptions.evidence)
                ? normalizedOptions.evidence.slice()
                : [normalizedOptions.evidence];
        }
    } catch (_) {
        return false;
    }

    const metadata = getChatMetadataStore();
    if (!metadata) return false;
    const metadataBefore = snapshotChatMetadataScope(metadata);
    const existingMap = isPlainObject(metadata[OVERRIDES_METADATA_KEY]) ? metadata[OVERRIDES_METADATA_KEY] : null;
    const messageKey = String(index);
    const segmentKey = String(normalizedSegmentIndex);
    const existingEntry = existingMap?.[messageKey];
    if (messageQuoteOverrideEntryMatches(existingEntry, msg)) {
        migrateLegacyMessageQuoteOverrideEntry(existingEntry, msg);
    }
    const entryIsNew = !messageQuoteOverrideEntryMatches(existingEntry, msg);
    const baseEntry = entryIsNew ? createMessageQuoteOverrideEntry(msg) : existingEntry;
    const entry = { ...baseEntry };
    for (const mapName of ['segments', 'sources', 'confidences', 'reviewIds', 'records']) {
        if (isPlainObject(baseEntry[mapName])) entry[mapName] = { ...baseEntry[mapName] };
    }
    const identity = getMessageAttributionIdentity(msg);
    const review = {
        messageIndex: index,
        segmentIndex: normalizedSegmentIndex,
        proposedSpeaker: speaker,
        source,
        messageId: identity.messageId,
        messageHash: identity.hash,
        messageFingerprint: identity.messageFingerprint,
        ...(confidence === undefined ? {} : { confidence }),
        ...(evidence === undefined ? {} : { evidence }),
    };
    const hasFreezeSegments = Object.prototype.hasOwnProperty.call(normalizedOptions, 'freezeSegments');
    const freezeSegments = hasFreezeSegments
        ? { ...getMessageAttributionFreezeSegments(index, msg, normalizedSegmentIndex), ...(isPlainObject(normalizedOptions.freezeSegments) ? normalizedOptions.freezeSegments : {}) }
        : undefined;
    const requestedStatus = Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(normalizedOptions.verificationStatus)
        ? normalizedOptions.verificationStatus
        : Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(entry.verificationStatus)
            ? undefined
            : source === ATTRIBUTION_SOURCE.LLM
                ? ATTRIBUTION_VERIFICATION_STATUS.AUTO_APPLIED
                : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
    const workingMap = { [messageKey]: entry };
    const applied = setAttributionOverrideRecord(workingMap, review, {
        message: msg,
        speaker,
        source,
        ...(confidence === undefined ? {} : { confidence }),
        ...(evidence === undefined ? {} : { evidence }),
        ...(reviewId ? { reviewId } : {}),
        ...(requestedStatus ? { verificationStatus: requestedStatus } : {}),
        freezeSegments,
        clearTargetMetadata: source === ATTRIBUTION_SOURCE.MANUAL,
        markUnverified: normalizedOptions.markUnverified === true,
        verifiedVersion: ATTRIBUTION_VERIFIER_VERSION,
        extended: evidence !== undefined,
    });
    if (!applied) return false;
    const nextEntry = applyMessageAttributionIdentity(workingMap[messageKey], msg);
    try {
        if (existingMap) existingMap[messageKey] = nextEntry;
        else metadata[OVERRIDES_METADATA_KEY] = { [messageKey]: nextEntry };
    } catch (_) {
        return false;
    }
    streamingSession.assignments.clear();
    saveChatMetadataIfChanged(metadataBefore, metadata);
    return true;
}

export function deleteMessageQuoteOverride(mesIndex, msg, segmentIndex) {
    const map = getQuoteOverridesMap(false);
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    const metadataBefore = snapshotChatMetadataScope();
    if (!map || !entry || !deleteAttributionOverrideRecord(map, mesIndex, segmentIndex)) return false;
    // Frozen siblings only exist to protect a real override. Once the last
    // non-frozen override on a message is gone, drop them so the message
    // returns to fully automatic attribution.
    const sources = isPlainObject(entry.sources) ? entry.sources : {};
    const hasRealOverride = Object.keys(isPlainObject(entry.segments) ? entry.segments : {})
        .some(key => sources[key] !== ATTRIBUTION_SOURCE.FROZEN);
    if (!hasRealOverride) {
        for (const key of Object.keys(entry.segments || {})) {
            if (sources[key] === ATTRIBUTION_SOURCE.FROZEN) deleteAttributionOverrideRecord(map, mesIndex, key);
        }
    }
    streamingSession.assignments.clear();
    saveChatMetadataIfChanged(metadataBefore);
    return true;
}

export function restoreMessageQuoteOverrideEntry(mesIndex, snapshot) {
    const metadataBefore = snapshotChatMetadataScope();
    const map = getQuoteOverridesMap(true);
    if (!map) return false;
    const key = String(mesIndex);
    if (snapshot && isPlainObject(snapshot)) map[key] = JSON.parse(JSON.stringify(snapshot));
    else delete map[key];
    streamingSession.assignments.clear();
    saveChatMetadataIfChanged(metadataBefore);
    return true;
}

// The host renumbers mesid values after deletion while this metadata remains
// index-keyed. Rebuild the map from the stored message identity before a later
// main.js deletion hook starts using it.
export function reconcileMessageQuoteOverridesAfterDeletion(chat = getContext()?.chat, options = {}) {
    const messages = Array.isArray(chat) ? chat : null;
    const map = getQuoteOverridesMap(false);
    if (!messages || !map) return false;
    const next = {};
    const pending = [];
    for (const [key, entry] of Object.entries(map)) {
        if (!isPlainObject(entry)) {
            pending.push([key, entry]);
            continue;
        }
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && messageQuoteOverrideEntryMatches(entry, messages[index])) {
            next[key] = entry;
        } else {
            pending.push([key, entry]);
        }
    }
    if (options.deletion === false) return false;
    for (const [, entry] of pending) {
        if (!isPlainObject(entry)) continue;
        const matches = [];
        for (let index = 0; index < messages.length; index++) {
            if (messageQuoteOverrideEntryMatches(entry, messages[index])) matches.push(index);
        }
        if (!matches.length) continue;
        const targetKey = String(matches[0]);
        // Ambiguous identity is safer left inert at its old key than erased or
        // attached to an arbitrary duplicate.
        if (matches.length !== 1 || Object.prototype.hasOwnProperty.call(next, targetKey)) return false;
        next[targetKey] = entry;
    }
    const currentKeys = Object.keys(map);
    const nextKeys = Object.keys(next);
    const unchanged = currentKeys.length === nextKeys.length
        && nextKeys.every(key => map[key] === next[key]);
    if (unchanged) return false;
    const metadataBefore = snapshotChatMetadataScope();
    for (const key of currentKeys) delete map[key];
    Object.assign(map, next);
    streamingSession.assignments.clear();
    saveChatMetadataIfChanged(metadataBefore);
    return true;
}

// Verdicts the local pass re-derives for free are remembered here instead of in
// chat metadata. Cleared whenever the chat changes; an edited message misses on
// its own because the key carries the message's text hash and fingerprint.
const sessionVerifiedMessages = new Map();

function getSessionVerificationKey(msg) {
    const identity = getMessageAttributionIdentity(msg);
    return `${identity.hash}|${identity.messageFingerprint}|${identity.textLength}`;
}

function hasSessionAttributionVerification(mesIndex, msg) {
    if (!msg) return false;
    const stored = sessionVerifiedMessages.get(String(mesIndex));
    return !!stored && stored === getSessionVerificationKey(msg);
}

export function clearSessionAttributionVerifications() {
    sessionVerifiedMessages.clear();
    // The saved-scope baseline describes the chat we are leaving; keeping it
    // could let an unrelated chat's identical-looking metadata skip a real save.
    lastSavedChatMetadataScope = null;
    lastSavedChatMetadataBinding = null;
    dirtyChatMetadataScope = null;
    dirtyChatMetadataBinding = null;
    pendingChatMetadataSave = null;
}

export function markMessageAttributionVerified(mesIndex, msg, verificationStatus = ATTRIBUTION_VERIFICATION_STATUS.CLEAN, options = {}) {
    const status = Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(verificationStatus)
        ? verificationStatus
        : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
    const index = Number(mesIndex);
    if (!Number.isInteger(index) || index < 0 || !msg) return false;
    // A clean verdict that cost no LLM call and covers a message with no stored
    // attribution data is not worth a chat file rewrite - the next load
    // recomputes it locally in microseconds. Remember it for this session only.
    if (options.persist === false && status === ATTRIBUTION_VERIFICATION_STATUS.CLEAN
        && !getMessageQuoteOverrideEntry(index, msg, false)) {
        sessionVerifiedMessages.set(String(index), getSessionVerificationKey(msg));
        return true;
    }
    const metadataBefore = snapshotChatMetadataScope();
    const entry = getMessageQuoteOverrideEntry(index, msg, true);
    if (!entry) return false;
    applyMessageAttributionIdentity(entry, msg);
    // Re-verifying a message that already holds this exact verdict must leave
    // the entry byte-identical, or the save below has something to write on
    // every single pass.
    const alreadyVerified = entry.verifiedHash === entry.hash
        && entry.verifiedVersion === ATTRIBUTION_VERIFIER_VERSION
        && entry.verificationStatus === status;
    if (!alreadyVerified) {
        entry.verifiedHash = entry.hash;
        entry.verifiedAt = Date.now();
        entry.verifiedVersion = ATTRIBUTION_VERIFIER_VERSION;
        entry.verificationStatus = status;
    }
    sessionVerifiedMessages.delete(String(index));
    saveChatMetadataIfChanged(metadataBefore);
    return true;
}

export function isMessageAttributionVerified(mesIndex, msg) {
    if (hasSessionAttributionVerification(mesIndex, msg)) return true;
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
    if (!entry || !messageQuoteOverrideEntryMatches(entry, msg)) return false;
    const hash = hashMessageText(getMessageText(msg));
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
        // The store notifies after mutating, so there is no "before" to pass;
        // fall back to the last confirmed or pending scope so an identical
        // re-upsert does not queue another chat rewrite.
        saveMetadata: metadata => saveChatMetadataIfChanged(null, metadata),
        extendedOverrides: true,
        getFreezeSegments(review, message) {
            return getMessageAttributionFreezeSegments(review?.messageIndex, message, review?.segmentIndex);
        },
        validateAcceptance(review, operationOptions) {
            const requestedSpeaker = String(operationOptions?.speaker ?? review?.proposedSpeaker ?? '').trim();
            const key = resolveCharacterKeyByNameOrAlias(requestedSpeaker);
            if (!key || !Object.prototype.hasOwnProperty.call(characterColors, key) || !characterColors[key]) return false;
            return String(characterColors[key].name || '').trim() || false;
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
    const decision = getAttributionReviewAdapter().accept(id, options);
    if (decision?.status === ATTRIBUTION_REVIEW_STATUS.ACCEPTED) {
        streamingSession.assignments.clear();
        markAttributionReviewDecisionStatus(decision);
    }
    return decision;
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

// Attribution is the expensive half of a decorate pass, and decorateAllMessages
// runs it over the whole chat. A single chat change fires that pass roughly ten
// times (the refresh series, the settle series, and the initial scan), so on a
// long chat the same messages were re-attributed from scratch every time.
//
// A message's counts depend only on its text, speaker, index and saved overrides,
// plus the attribution inputs the whole chat shares: the registry identities and
// the configured thought delimiters. Colors are excluded deliberately - they never
// decide which speaker key a segment resolves to.
const dialogueCountCache = new Map();
let dialogueCountInputsSignature = null;

function getDialogueCountInputsSignature() {
    const registry = Object.entries(characterColors)
        .map(([key, entry]) => `${key}\u0001${entry?.name ?? ''}\u0001${(entry?.aliases || []).join('\u0002')}`)
        .sort()
        .join('\u0003');
    return `${settings.thoughtSymbols ?? ''}\u0004${registry}`;
}

export function clearDialogueCountCache() {
    dialogueCountCache.clear();
    dialogueCountInputsSignature = null;
}

function getMessageDialogueCounts(msg, mesIndex, liveKeys) {
    const overrideOptions = getMessageQuoteOverrideOptions(mesIndex, msg);
    const cacheKey = [
        mesIndex,
        hashMessageText(getMessageText(msg)),
        getMessageSpeaker(msg),
        JSON.stringify(overrideOptions),
    ].join('\u0001');
    liveKeys.add(cacheKey);
    const cached = dialogueCountCache.get(cacheKey);
    if (cached) return cached;

    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: true,
        ...overrideOptions,
        mesIndex,
    });
    const counts = new Map();
    for (const seg of attribution.segments) {
        const key = seg.assignment?.key;
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    // autoAddMessageSpeaker can create a character, which changes the registry and
    // therefore the signature, so this entry is dropped before it could be re-read.
    const entry = { counts, createdCharacters: attribution.createdCharacters };
    dialogueCountCache.set(cacheKey, entry);
    return entry;
}

export function refreshDomDialogueCounts(chat = getContext()?.chat || []) {
    const nextCounts = {};
    let createdCharacters = false;

    let fontColorLookup = null;

    const inputsSignature = getDialogueCountInputsSignature();
    if (inputsSignature !== dialogueCountInputsSignature) {
        dialogueCountCache.clear();
        dialogueCountInputsSignature = inputsSignature;
    }
    const liveKeys = new Set();

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || isHostSystemOrToolMessage(msg) || !msg.mes) continue;
        // Font-tagged messages are never decorated, but their saved tags still
        // say who spoke; count them from the tags instead of dropping the whole
        // message out of the statistics. Left uncached: this branch resolves by
        // rendered color, which the signature above deliberately ignores.
        if (collectFontColorsFromText(msg.mes).size) {
            if (!fontColorLookup) fontColorLookup = buildUniqueKnownColorStatsLookup();
            for (const [color, count] of countFontColorOccurrencesFromText(msg.mes)) {
                const key = fontColorLookup.get(color)?.key;
                if (!key || !characterColors[key]) continue;
                nextCounts[key] = (nextCounts[key] || 0) + count;
            }
            continue;
        }
        const message = getMessageDialogueCounts(msg, i, liveKeys);
        if (message.createdCharacters) createdCharacters = true;
        for (const [key, count] of message.counts) {
            if (!characterColors[key]) continue;
            nextCounts[key] = (nextCounts[key] || 0) + count;
        }
    }

    // Bound the cache to the chat that is actually loaded, so edited, swiped and
    // deleted messages cannot accumulate.
    for (const key of dialogueCountCache.keys()) {
        if (!liveKeys.has(key)) dialogueCountCache.delete(key);
    }

    // dialogueCount is a statistic about the chat that happens to be rendered,
    // but the table holding it is shared by every chat on the card (and by every
    // card under the global scope). Treating a recount as a storage change made
    // each chat switch rewrite the user's settings for data that is recomputed
    // on load anyway, so counts only ask for a list refresh now.
    let countsChanged = false;
    for (const [key, entry] of Object.entries(characterColors)) {
        const nextCount = nextCounts[key] || 0;
        if ((entry.dialogueCount || 0) !== nextCount) {
            entry.dialogueCount = nextCount;
            countsChanged = true;
        }
    }

    return { changed: createdCharacters, countsChanged, createdCharacters };
}

export function matchSegmentsToElements(segments, elements, getTargetText, onMatch, options = {}) {
    // Exact matches claim their element, so the optional second pass can only
    // ever fill the gaps they leave behind.
    const claimed = new Array(elements.length).fill(false);
    const unmatched = [];
    let elementIndex = 0;

    for (const seg of segments) {
        const target = getTargetText(seg);
        if (elementIndex >= elements.length) {
            unmatched.push({ seg, target, after: elementIndex });
            continue;
        }
        let foundIndex = -1;
        for (let i = elementIndex; i < elements.length; i++) {
            if (normalizeSegmentText(elements[i].textContent) === target) { foundIndex = i; break; }
        }
        if (foundIndex === -1) {
            unmatched.push({ seg, target, after: elementIndex });
            continue;
        }
        claimed[foundIndex] = true;
        onMatch(seg, elements[foundIndex]);
        // An empty target still consumes its element. Skipping it left every
        // later segment matching one element too early.
        elementIndex = foundIndex + 1;
    }

    if (options.allowAnchoredFallback !== true || !unmatched.length) return;

    for (const pending of unmatched) {
        if (!pending.target) continue;
        // Bound the search to the unclaimed run starting where this segment
        // would have sat, stopping at the next element an exact match claimed.
        let lower = pending.after;
        while (lower < elements.length && claimed[lower]) lower++;
        let chosen = -1;
        let candidates = 0;
        for (let i = lower; i < elements.length && !claimed[i]; i++) {
            candidates++;
            if (chosen !== -1) continue;
            if (isApproximateSegmentTextMatch(pending.target, normalizeSegmentText(elements[i].textContent))) chosen = i;
        }
        // A single unclaimed element between two anchors can only belong to
        // this segment, so accept it even when the text was rewritten wholesale.
        if (chosen === -1 && candidates === 1 && unmatched.filter(other => other.after === pending.after).length === 1) {
            chosen = lower < elements.length && !claimed[lower] ? lower : -1;
        }
        if (chosen === -1) continue;
        claimed[chosen] = true;
        onMatch(pending.seg, elements[chosen]);
    }
}

// Containment with a length floor: entity decoding, macro expansion and regex
// scripts change a quote's rendered text without changing which quote it is.
export function isApproximateSegmentTextMatch(target, rendered) {
    if (!target || !rendered) return false;
    const longer = rendered.length >= target.length ? rendered : target;
    const shorter = rendered.length >= target.length ? target : rendered;
    if (!longer.includes(shorter)) return false;
    return shorter.length / longer.length >= 0.6;
}

export function resolveDomSegmentIndexForElement(segmentEl, mesIndex, msg) {
    if (!segmentEl || !msg) return NaN;
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
    // No ordinal fallback: when this extension's segmentation disagrees with
    // SillyTavern's rendered quotes, positional mapping can hand two different
    // elements the same segment index, and an override written against it would
    // recolour a quote the user never clicked. Refusing to guess is safer.
    return resolvedIndex;
}

function setAttributeIfChanged(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

const SEGMENT_COLOR_STATE_ATTRIBUTE = 'data-dc-color-state';
const SEGMENT_HIGHLIGHT_STATE_ATTRIBUTE = 'data-dc-highlight-state';
const SEGMENT_FONT_STATE_ATTRIBUTE = 'data-dc-font';

function readOwnedStyleState(el, attribute) {
    try {
        const state = JSON.parse(el.getAttribute(attribute) || '');
        if (!state || typeof state !== 'object' || typeof state.applied !== 'string') return null;
        return {
            value: typeof state.value === 'string' ? state.value : '',
            priority: typeof state.priority === 'string' ? state.priority : '',
            applied: state.applied,
            appliedPriority: typeof state.appliedPriority === 'string' ? state.appliedPriority : '',
            requested: typeof state.requested === 'string' ? state.requested : null,
        };
    } catch (_) {
        return null;
    }
}

function applyOwnedStyle(el, property, value, attribute, legacyOwned = false) {
    const currentValue = el.style.getPropertyValue(property);
    const currentPriority = el.style.getPropertyPriority(property);
    let state = readOwnedStyleState(el, attribute);
    const ownsCurrent = !!state
        && currentValue === state.applied
        && currentPriority === state.appliedPriority;
    if (!ownsCurrent) {
        state = {
            value: legacyOwned ? '' : currentValue,
            priority: legacyOwned ? '' : currentPriority,
            applied: '',
            appliedPriority: '',
            requested: null,
        };
    }
    let changed = false;
    if (!ownsCurrent || state.requested !== value) {
        el.style.setProperty(property, value);
        changed = currentValue !== el.style.getPropertyValue(property)
            || currentPriority !== el.style.getPropertyPriority(property);
    }
    state.requested = value;
    state.applied = el.style.getPropertyValue(property);
    state.appliedPriority = el.style.getPropertyPriority(property);
    const encoded = JSON.stringify(state);
    if (el.getAttribute(attribute) !== encoded) {
        el.setAttribute(attribute, encoded);
        changed = true;
    }
    return changed;
}

function clearOwnedStyle(el, property, attribute, legacyOwned = false) {
    if (!el.hasAttribute(attribute)) {
        if (!legacyOwned || !el.style.getPropertyValue(property)) return false;
        el.style.removeProperty(property);
        return true;
    }
    const state = readOwnedStyleState(el, attribute);
    if (state && el.style.getPropertyValue(property) === state.applied
        && el.style.getPropertyPriority(property) === state.appliedPriority) {
        if (state.value) el.style.setProperty(property, state.value, state.priority);
        else el.style.removeProperty(property);
    } else if (!state && legacyOwned) {
        el.style.removeProperty(property);
    }
    el.removeAttribute(attribute);
    return true;
}

function readOwnedAttributeState(el, attribute) {
    try {
        const state = JSON.parse(el.getAttribute(attribute) || '');
        if (!state || typeof state !== 'object' || typeof state.applied !== 'string') return null;
        return {
            hadValue: state.hadValue === true,
            value: typeof state.value === 'string' ? state.value : '',
            applied: state.applied,
        };
    } catch (_) {
        return null;
    }
}

function applyOwnedAriaLabel(el, value) {
    const marker = 'data-dc-aria-label';
    const hasValue = el.hasAttribute('aria-label');
    const currentValue = el.getAttribute('aria-label') || '';
    let state = readOwnedAttributeState(el, marker);
    if (!state && el.hasAttribute(marker) && currentValue) {
        state = { hadValue: false, value: '', applied: currentValue };
    }
    if (!state) {
        if (hasValue) return false;
        state = { hadValue: false, value: '', applied: value };
    } else if (!hasValue || currentValue !== state.applied) {
        // Another owner changed ARIA after us; relinquish it rather than
        // replacing accessibility text we do not own.
        el.removeAttribute(marker);
        return false;
    } else {
        state.applied = value;
    }
    let changed = false;
    if (!hasValue || currentValue !== value) {
        el.setAttribute('aria-label', value);
        changed = true;
    }
    const encoded = JSON.stringify(state);
    if (el.getAttribute(marker) !== encoded) {
        el.setAttribute(marker, encoded);
        changed = true;
    }
    return changed;
}

function clearOwnedAriaLabel(el) {
    const marker = 'data-dc-aria-label';
    if (!el.hasAttribute(marker)) return false;
    const state = readOwnedAttributeState(el, marker);
    if (state && el.hasAttribute('aria-label') && el.getAttribute('aria-label') === state.applied) {
        if (state.hadValue) el.setAttribute('aria-label', state.value);
        else el.removeAttribute('aria-label');
    } else if (!state) {
        el.removeAttribute('aria-label');
    }
    el.removeAttribute(marker);
    return true;
}

// Writes only what differs. Streaming paints run without a preceding clear pass,
// so a no-op repaint must not touch the DOM at all - re-setting the gradient
// classes restarts the animation and re-setting attributes wakes the observers.
export function applySegmentDecoration(seg, el) {
    setAttributeIfChanged(el, 'data-dc-seg', String(seg.index));
    if (!seg.assignment) {
        clearSegmentDecoration(el, { preserveSegment: true });
        return false;
    }
    const legacyOwned = el.hasAttribute('data-dc-colored') && !el.hasAttribute(SEGMENT_COLOR_STATE_ATTRIBUTE);
    const entryKey = characterColors[seg.assignment.key]
        ? seg.assignment.key
        : resolveCharacterKeyByNameOrAlias(seg.assignment.name || seg.assignment.key);
    const entry = entryKey ? characterColors[entryKey] : null;
    const displayVisual = getVisualRenderState(entry || { color: seg.assignment.color, baseColor: seg.assignment.color }, { target: 'chat' });
    applyOwnedStyle(el, 'color', displayVisual.fallbackColor, SEGMENT_COLOR_STATE_ATTRIBUTE, legacyOwned);
    applyTextStyle(el, entry?.style);
    const font = entry?.font || seg.assignment.font;
    const family = getGoogleFontFamily(font);
    if (family) {
        loadGoogleFont(font);
        applyOwnedStyle(el, 'font-family', family, SEGMENT_FONT_STATE_ATTRIBUTE, legacyOwned);
    } else clearOwnedStyle(el, 'font-family', SEGMENT_FONT_STATE_ATTRIBUTE, legacyOwned);
    const highlightColor = settings.highlightMode ? `${displayVisual.fallbackColor}26` : '';
    const gradientResult = applyGradientText(el, entry, { highlightColor, target: 'chat' });
    if (settings.highlightMode && !gradientResult.applied) {
        applyOwnedStyle(el, 'background-color', highlightColor, SEGMENT_HIGHLIGHT_STATE_ATTRIBUTE, legacyOwned);
    } else clearOwnedStyle(el, 'background-color', SEGMENT_HIGHLIGHT_STATE_ATTRIBUTE, legacyOwned);
    setAttributeIfChanged(el, 'data-dc-colored', '1');
    setAttributeIfChanged(el, 'data-dc-confidence', getAttributionConfidenceBand(seg.confidence));
    setAttributeIfChanged(el, 'data-dc-speaker', seg.assignment.key);
    const speakerName = entry?.name || seg.assignment.name || seg.assignment.key;
    setAttributeIfChanged(el, 'data-dc-speaker-name', speakerName);
    applyOwnedAriaLabel(el, `${speakerName}: ${el.textContent.trim()}`);
    return true;
}

export function clearSegmentDecoration(el, options = {}) {
    const legacyOwned = el.hasAttribute('data-dc-colored') && !el.hasAttribute(SEGMENT_COLOR_STATE_ATTRIBUTE);
    clearGradientText(el);
    clearTextStyle(el);
    clearOwnedStyle(el, 'color', SEGMENT_COLOR_STATE_ATTRIBUTE, legacyOwned);
    clearOwnedStyle(el, 'background-color', SEGMENT_HIGHLIGHT_STATE_ATTRIBUTE, legacyOwned);
    clearOwnedStyle(el, 'font-family', SEGMENT_FONT_STATE_ATTRIBUTE, legacyOwned);
    if (!el.getAttribute('style')) el.removeAttribute('style');
    el.removeAttribute('data-dc-colored');
    el.removeAttribute('data-dc-confidence');
    el.removeAttribute('data-dc-speaker');
    el.removeAttribute('data-dc-speaker-name');
    el.removeAttribute('data-dc-font');
    if (options.preserveSegment !== true) el.removeAttribute('data-dc-seg');
    clearOwnedAriaLabel(el);
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
        if (options.preserveFontTags !== true) clearCustomFontsFromFontTags(mesText);
        if (options.preserveNarrator !== true) clearNarratorTextSpans(mesText);
    }
    // Tear down the external-rebuild watcher so it doesn't re-decorate
    // a message we've intentionally undecorated.
    if (options.clearWatcher !== false) clearDecoratedWatcher(mesElement);
    if (options.clearWatcher !== false) unregisterGradientAnimationRoot(mesElement);
}

function decorateTrackedPersonaFontTags(mesText, msg) {
    const key = resolveCharacterKeyByNameOrAlias(getMessageSpeaker(msg).trim());
    const entry = key ? characterColors[key] : null;
    if (!entry) return false;
    const assignment = { key, name: entry.name, color: entry.color, font: entry.font };
    let decorated = false;
    mesText.querySelectorAll('font[color]').forEach((fontElement, index) => {
        applySegmentDecoration({ index: `font:${index}`, assignment }, fontElement);
        decorated = true;
    });
    return decorated;
}

export function decorateMessageDom(mesElement, msg, mesIndex) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText) return { decorated: false, createdCharacters: false, needsRetry: isDomTargetMessage(msg) };
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return { decorated: false, createdCharacters: false, needsRetry: false };
    const manageDecoration = isDomEngine() || msg?.is_user === true;
    const targetMessage = isDomTargetMessage(msg);
    if (manageDecoration) {
        undecorateMessageDom(mesElement, {
            clearWatcher: !isDomEngine() && !targetMessage,
            preserveNarrator: true,
            preserveFontTags: !isDomEngine(),
        });
    }
    if (!settings.enabled || !msg || isHostSystemOrToolMessage(msg)) {
        clearNarratorTextSpans(mesText);
        return { decorated: false, createdCharacters: false };
    }
    if (!targetMessage) {
        if (msg.is_user) clearNarratorTextSpans(mesText);
        return { decorated: false, createdCharacters: false };
    }
    const hasPersistedFontColors = mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size;
    if (hasPersistedFontColors && !isHybridPersonaMessage(msg)) {
        clearNarratorTextSpans(mesText);
        applyCustomFontsToFontTags(mesText, msg.mes);
        clearDecoratedWatcher(mesElement);
        return { decorated: false, createdCharacters: false };
    }

    const attribution = attributeDialogueSegments(msg.mes, msg.name, {
        autoAddMessageSpeaker: true,
        ...getMessageQuoteOverrideOptions(mesIndex, msg),
        mesIndex: mesIndex,
    });

    let decorated = false;
    if (isHybridPersonaMessage(msg) && hasPersistedFontColors) {
        decorated = decorateTrackedPersonaFontTags(mesText, msg) || decorated;
    }
    const applyDecoration = (seg, el) => {
        decorated = applySegmentDecoration(seg, el) || decorated;
    };

    const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
    const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
    const qElements = Array.from(mesText.querySelectorAll('q'));
    const emElements = Array.from(mesText.querySelectorAll('em'));
    const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
    let matchedDecorations = 0;

    matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), applyDecoration, { allowAnchoredFallback: true });
    matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), applyDecoration, { allowAnchoredFallback: true });
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

function clearMessageSettleObservers() {
    for (const { observer, fallbackTimer, retryTimers } of runtimeState.messageSettleObservers.values()) {
        try { observer?.disconnect?.(); } catch (_) { /* ignored */ }
        clearTimeout(fallbackTimer);
        retryTimers?.forEach?.(clearTimeout);
    }
    runtimeState.messageSettleObservers.clear();
    pendingDomSettleRefreshKey = '';
    pendingDomSettleRefreshCount = 0;
}

// Maximum time to wait for a message's DOM to settle before giving up.
export const MESSAGE_SETTLE_MAX_WAIT_MS = 3000;

/**
 * Attach a self-terminating MutationObserver to a single .mes element.
 * Queues a coalesced repair whenever child nodes change inside the message.
 * Disconnects after MESSAGE_SETTLE_MAX_WAIT_MS.
 */

export function attachMessageSettleObserver(mesElement, mesIndex) {
    if (!mesElement?.isConnected) return;
    if (isStreamingOwnedMessage(mesIndex)) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    if (!isDomTargetMessage(getContext()?.chat?.[Number(mesIndex)])) return;
    // Keep the original deadline bounded. Reattaching after every failed
    // decoration would restart the timeout forever on permanently mismatched
    // markup.
    const existing = runtimeState.messageSettleObservers.get(mesElement);
    if (existing) return;

    let retryTimers = [];

    const cleanup = () => {
        const entry = runtimeState.messageSettleObservers.get(mesElement);
        if (!entry) return;
        try { entry.observer.disconnect(); } catch (_) { /* ignored */ }
        clearTimeout(entry.fallbackTimer);
        entry.retryTimers?.forEach?.(clearTimeout);
        runtimeState.messageSettleObservers.delete(mesElement);
    };

    const queueAttempt = () => queueObservedMessageDecoration(mesElement);
    const observer = new MutationObserver(queueAttempt);
    observer.observe(mesElement, { childList: true, subtree: true });

    retryTimers = DOM_RETRY_REFRESH_DELAYS
        .filter(delay => Number(delay) > 0 && Number(delay) < MESSAGE_SETTLE_MAX_WAIT_MS)
        .map(delay => setTimeout(queueAttempt, Number(delay)));

    const fallbackTimer = setTimeout(() => {
        cleanup();
    }, MESSAGE_SETTLE_MAX_WAIT_MS);

    runtimeState.messageSettleObservers.set(mesElement, { observer, fallbackTimer, retryTimers });
}

/**
 * Attach a long-lived MutationObserver that watches for external re-renders
 * of an already-decorated message (e.g. a post-gen agent editing msg.mes and
 * calling updateMessageBlock(), which rebuilds .mes_text innerHTML, wiping DC
 * inline styles). When .mes_text childList changes and its decoration health
 * no longer matches the message, queue a repair after the DOM settles.
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
    if (isStreamingOwnedMessage(mesIndex)) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    if (!isDomTargetMessage(getContext()?.chat?.[Number(mesIndex)])) return;
    // Tear down any existing watcher for this element first.
    clearDecoratedWatcher(mesElement);

    const initialMesText = mesElement.querySelector('.mes_text');
    if (!initialMesText) return;

    const observer = new MutationObserver(() => {
        if (!mesElement.isConnected || !settings.enabled || !hasDomTargetMessages()) {
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
        const msg = getContext()?.chat?.[repairIndex];
        if (!msg || !isDomTargetMessage(msg)) return;
        if (!getMessageDomHealthRepairType(mesElement, msg, repairIndex, { bootstrap: true })
            && !currentMesText.querySelector('font[color]')
            && !collectFontColorsFromText(msg.mes).size) return;
        queueObservedMessageDecoration(mesElement);
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

export function getMessageDomHealthRepairType(mesElement, msg, mesIndex, options = {}) {
    const mesText = mesElement?.querySelector?.('.mes_text');
    if (!mesText || !msg || !isDomTargetMessage(msg)) return '';
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return '';
    const hasPersistedFontColors = mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size;
    if (hasPersistedFontColors && !isHybridPersonaMessage(msg)) return '';
    const readiness = getMessageDomReadiness(mesElement, msg, mesIndex);
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    const narratorMissing = narrator && !mesText.querySelector('[data-dc-narrator]')
        && hasNarratorTextNodesToDecorate(mesText);
    if (isHybridPersonaMessage(msg) && hasPersistedFontColors
        && !mesText.querySelector('font[data-dc-colored]')) return 'decorate';
    if (readiness.totalSegments === 0) {
        return narratorMissing ? 'decorate' : '';
    }
    // A message whose segments can never text-match the rendered markup (e.g.
    // **bold** inside a quote) is never "ready", and a refresh repair cannot
    // fix it. Once the caller has spent its refresh budget it asks for
    // allowPartial so we fall through to the best-effort decorate decision
    // below instead of leaving the message permanently undecorated.
    if (!readiness.ready && options.allowPartial !== true) return 'refresh';
    if (options.bootstrap === true && readiness.expectedDecorations === 0
        && !mesText.querySelector('[data-dc-seg]')) return 'decorate';
    return readiness.expectedDecorations > readiness.correctDecorations || narratorMissing ? 'decorate' : '';
}

export function runDomHealthCheck() {
    if (!settings.enabled || !hasDomTargetMessages()) {
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
        if (isStreamingOwnedMessage(repairIndex)) continue;
        if (suspendMessageDomWorkForEdit(mesElement, repairIndex)) continue;
        if (!isDomTargetMessage(chat[repairIndex])) {
            if (!isDomEngine() && chat[repairIndex]?.is_user) undecorateMessageDom(mesElement, { preserveFontTags: true });
            continue;
        }
        if (watcher?.mesText !== currentMesText) {
            clearDecoratedWatcher(mesElement);
            // The host replaced .mes_text, so any decorations are gone. Reset
            // the refresh budget too, otherwise a message that had settled on a
            // best-effort pass can never be decorated again.
            healthRefreshAttempts.delete(`${repairIndex}:${hashMessageText(chat[repairIndex]?.mes)}`);
            scheduleMessageDomRepair(repairIndex, {
                delay: 0,
                source: 'observer',
                verify: false,
                renderFallback: false,
            });
        }
    }

    for (const mesElement of collectDomHealthCheckMessages()) {
        const mesIndex = Number(mesElement.getAttribute('mesid'));
        if (!Number.isFinite(mesIndex) || mesIndex < 0) continue;
        if (runtimeState.messageDomRepairTimers.has(mesIndex)) continue;
        const msg = chat[mesIndex];
        if (!isDomTargetMessage(msg)) {
            if (!isDomEngine() && msg?.is_user) undecorateMessageDom(mesElement, { preserveFontTags: true });
            continue;
        }
        if (isStreamingOwnedMessage(mesIndex)) continue;
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
        const attemptsKey = `${mesIndex}:${hashMessageText(msg?.mes)}`;
        const attempts = healthRefreshAttempts.get(attemptsKey) || 0;
        // Past the ceiling the best-effort decorate below has already run for
        // this message text. Repeating it every tick would reintroduce the
        // flicker the cap was added to stop.
        if (attempts > DOM_HEALTH_REFRESH_MAX_ATTEMPTS) continue;
        const exhausted = attempts === DOM_HEALTH_REFRESH_MAX_ATTEMPTS;
        const repairType = getMessageDomHealthRepairType(mesElement, msg, mesIndex, { allowPartial: exhausted });
        if (repairType === 'refresh') {
            // Back off after a few consecutive failures: if a segment can never
            // match the rendered DOM (e.g. **bold** rendered as <strong>), an
            // unbounded refresh loop re-renders innerHTML every tick (flicker).
            healthRefreshAttempts.set(attemptsKey, attempts + 1);
            // renderFallback:false — the health check must never rewrite
            // .mes_text innerHTML; that retriggers the observer cascade.
            scheduleMessageDomRepair(mesIndex, { delay: 0, verify: false, renderFallback: false });
            continue;
        }
        // Settle after the single best-effort pass an exhausted message gets;
        // a genuinely repairable message resets its budget instead.
        if (exhausted) healthRefreshAttempts.set(attemptsKey, attempts + 1);
        else healthRefreshAttempts.delete(attemptsKey);
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
    if (!settings.enabled || !hasDomTargetMessages() || runtimeState.domHealthCheckTimer) return;
    runtimeState.domHealthCheckTimer = setInterval(runDomHealthCheck, DOM_HEALTH_CHECK_INTERVAL_MS);
}

export function stopDomHealthCheck() {
    if (runtimeState.domHealthCheckTimer) {
        clearInterval(runtimeState.domHealthCheckTimer);
        runtimeState.domHealthCheckTimer = null;
    }
    clearMessageDomRepairTimers();
    clearMessageSettleObservers();
    // Font repair uses this observer in both engines. DOM-health teardown may
    // keep it while enabled, but full extension teardown and stale targets may not.
    if (!settings.enabled || !runtimeState.chatObserverTarget) disconnectChatObserver();
    clearTimeout(decorateAllTimer);
    decorateAllTimer = null;
    decorateAllFirstCallTime = 0;
    pendingDeferredMutations = false;
    if (runtimeState.chatRootObserverTimer) clearTimeout(runtimeState.chatRootObserverTimer);
    runtimeState.chatRootObserverTimer = null;
}

/**
 * Bounded fallback pass series for races where ST/external agents update
 * msg.mes before the rendered .mes_text has caught up. Per-message observers
 * handle the common path; these delayed passes keep verification/overrides
 * from requiring a full chat reload when the live DOM is briefly stale.
 */

export function scheduleDomSettleRefresh(delays = DOM_RETRY_REFRESH_DELAYS, reason = 'settle') {
    if (!settings.enabled || !hasDomTargetMessages()) {
        clearDomSettleRefreshes();
        return;
    }
    startDomHealthCheck();
    const refreshDelays = Array.isArray(delays) && delays.length ? delays : [400];
    const context = getContext();
    const chat = context?.chat;
    const contextIdentity = getChatContextIdentity(context);
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
            if (!settings.enabled || !hasDomTargetMessages()) return;
            if (chatGeneration !== attributionChatGeneration) return;
            const currentContext = getContext();
            if (currentContext?.chat !== chat || getChatContextIdentity(currentContext) !== contextIdentity) return;
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
    if (!settings.enabled) return;
    if (!hasDomTargetMessages()) {
        if (!isDomEngine()) scheduleDecorateAll(delay, true);
        return;
    }
    startDomHealthCheck();
    scheduleDecorateAll(delay);
}

export function decorateAllMessages() {
    const previousDecoratingState = isDecoratingDom;
    isDecoratingDom = true;
    try {
        if (!settings.enabled) {
            stopDomHealthCheck();
            undecorateAllMessages();
            return;
        }
        const ctx = getContext();
        const chat = ctx?.chat || [];
        if (!hasDomTargetMessages(chat)) {
            document.querySelectorAll('#chat .mes[mesid]').forEach(mesElement => {
                const mesIndex = Number(mesElement.getAttribute('mesid'));
                if (chat[mesIndex]?.is_user) undecorateMessageDom(mesElement, { preserveFontTags: true });
            });
            return;
        }
        const countResult = isDomEngine()
            ? refreshDomDialogueCounts(chat)
            : { changed: false, countsChanged: false };
        let changedColorData = countResult.changed;
        document.querySelectorAll('#chat .mes[mesid]').forEach(mesElement => {
            const mesIndex = Number(mesElement.getAttribute('mesid'));
            const msg = chat[mesIndex];
            if (!msg) return;
            if (isStreamingOwnedMessage(mesIndex)) return;
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
            // Decoration discovered new characters. Persist via the debounced
            // color-state saver instead of a synchronous heavy
            // saveData()+updateCharList() on every render pass.
            queueColorStateSave({ history: false, injectPrompt: false });
        } else if (countResult.countsChanged) {
            // Only the per-chat dialogue tallies moved: refresh what the list
            // shows without writing anything to disk.
            queueColorStateSave({ data: false, history: false, injectPrompt: false });
        }
        updateLegend();
        if (isDomEngine()) queueAutoAttributionVerificationForRenderedMessages();
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
    if (!settings.enabled || !hasDomTargetMessages() || !elements?.length) return;
    const previousDecoratingState = isDecoratingDom;
    isDecoratingDom = true;
    let createdCharacters = false;
    const verificationElements = [];
    try {
        for (const mesElement of elements) {
            if (!mesElement?.isConnected) continue;
            const mesIndex = Number(mesElement.getAttribute('mesid'));
            if (isStreamingOwnedMessage(mesIndex)) continue;
            if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
            const msg = getContext()?.chat?.[mesIndex];
            if (!isDomTargetMessage(msg)) {
                if (!isDomEngine() && msg?.is_user) undecorateMessageDom(mesElement, { preserveFontTags: true });
                continue;
            }
            if (isDomEngine()) verificationElements.push(mesElement);
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
    if (isDomEngine() && options.queueVerification !== false) queueAutoAttributionVerificationForElements(verificationElements);
}

export function scheduleDecorateAll(delay = 100, allowEmpty = false) {
    if (!settings.enabled || (!allowEmpty && !hasDomTargetMessages())) return;
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
    if (!mesElement?.isConnected || !settings.enabled) return;
    const mesIndex = Number(mesElement.getAttribute('mesid'));
    if (isStreamingOwnedMessage(mesIndex)) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
    const msg = getContext()?.chat?.[mesIndex];
    if (!isDomTargetMessage(msg)) return;
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
        if (!settings.enabled || !hasDomTargetMessages()) return;
        for (const pendingElement of pending) {
            if (!pendingElement?.isConnected) continue;
            const pendingIndex = Number(pendingElement?.getAttribute?.('mesid'));
            if (!Number.isFinite(pendingIndex) || pendingIndex < 0) continue;
            const msg = getContext()?.chat?.[pendingIndex];
            const mesText = pendingElement?.querySelector?.('.mes_text');
            if (!mesText || !msg || !isDomTargetMessage(msg)) continue;
            if (!isHybridPersonaMessage(msg) && (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size)) {
                applyCustomFontsToFontTags(mesText, msg.mes);
                continue;
            }
            if (!getMessageDomHealthRepairType(pendingElement, msg, pendingIndex, { bootstrap: true })) continue;
            scheduleMessageDomRepair(pendingIndex, {
                delay: 0,
                source: 'observer',
                verify: false,
                queueVerification: false,
                renderFallback: false,
            });
        }
    }, effectiveDelay);
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
        const observed = new Set();
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
                if (isDomTargetMessage(getContext()?.chat?.[mesIndex])) observed.add(mesElement);
            }
        }
        if (!isDomEngine()) {
            applyCustomFontsToMessageElements(fontTargets);
            if (settings.completePartialColorize && fontTargets.size > 0) onNewMessage();
        }
        for (const mesElement of observed) queueObservedMessageDecoration(mesElement);
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
