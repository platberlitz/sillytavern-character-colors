// dom-engine.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { ATTRIBUTION_REVIEW_STATUS, ATTRIBUTION_SOURCE, ATTRIBUTION_VERIFICATION_STATUS, createAttributionStore, createMessageFingerprint, deleteAttributionOverrideRecord, isLegacyAttributionOverrideEntry, normalizeAttributionConfidence, normalizeAttributionSource } from './attribution-store.js';
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
        if (!formatted && typeof converter?.makeHtml === 'function') formatted = converter.makeHtml(rawText);
    } catch (e) {
        console.warn('[Dialogue Colors] Message formatting fallback failed:', e);
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
    if (!target || !isMessageDomWriteTargetCurrent(target)) return false;
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
    if (!target) return false;
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
    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;
    const target = captureMessageDomTarget(index);
    if (!target) return;
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
                if (!settings.enabled || !isDomEngine()) return;
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

    if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return false;
    const target = captureMessageDomTarget(index);
    if (!target) return false;

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
            if (!settings.enabled || !isDomEngine()) return;
            if (!isCurrent()) return;

            const msg = target.message;
            if (!msg || msg.is_system) return;
            if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;

            await decorateMessageDomFromCurrentRender(index, msg, {
                queueVerification: options.queueVerification !== false,
                timeoutMs: options.timeoutMs ?? 700,
                renderFallback: options.renderFallback,
                isCurrent,
            });

            if (!isCurrent()) return;

            if (options.verify !== false) {
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
    try {
        const result = typeof ctx?.saveMetadataDebounced === 'function'
            ? ctx.saveMetadataDebounced()
            : typeof ctx?.saveMetadata === 'function'
                ? ctx.saveMetadata()
                : null;
        result?.catch?.(error => console.warn('[Dialogue Colors] Failed to save chat metadata:', error));
    } catch (error) {
        console.warn('[Dialogue Colors] Failed to save chat metadata:', error);
    }
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
    const existingMap = isPlainObject(metadata[OVERRIDES_METADATA_KEY]) ? metadata[OVERRIDES_METADATA_KEY] : null;
    const messageKey = String(index);
    const segmentKey = String(normalizedSegmentIndex);
    const existingEntry = existingMap?.[messageKey];
    if (messageQuoteOverrideEntryMatches(existingEntry, msg)) {
        migrateLegacyMessageQuoteOverrideEntry(existingEntry, msg);
    }
    const entryIsNew = !messageQuoteOverrideEntryMatches(existingEntry, msg);
    const baseEntry = entryIsNew ? createMessageQuoteOverrideEntry(msg) : existingEntry;
    const entry = {
        ...baseEntry,
        segments: { ...(isPlainObject(baseEntry.segments) ? baseEntry.segments : {}) },
        sources: { ...(isPlainObject(baseEntry.sources) ? baseEntry.sources : {}) },
    };
    // Snapshot the sibling segments' current auto-attribution the first time a
    // message gets an override. Without this, the paragraph-carry and
    // alternation tiers read the new override back and silently re-colour
    // neighbouring quotes that the user never touched. Only seed on a fresh
    // entry, otherwise clearing an override would immediately re-freeze it.
    if (entryIsNew && isPlainObject(normalizedOptions.freezeSegments)) {
        for (const [frozenKey, frozenSpeaker] of Object.entries(normalizedOptions.freezeSegments)) {
            const frozenIndex = Number(frozenKey);
            if (frozenKey === segmentKey || !Number.isInteger(frozenIndex) || frozenIndex < 0) continue;
            const frozenName = String(frozenSpeaker ?? '').trim();
            if (!frozenName) continue;
            entry.segments[frozenKey] = frozenName;
            entry.sources[frozenKey] = ATTRIBUTION_SOURCE.FROZEN;
        }
    }
    entry.segments[segmentKey] = speaker;
    entry.sources[segmentKey] = source;
    if (confidence !== undefined) {
        entry.confidences = { ...(isPlainObject(baseEntry.confidences) ? baseEntry.confidences : {}) };
        entry.confidences[segmentKey] = confidence;
    }
    if (reviewId) {
        entry.reviewIds = { ...(isPlainObject(baseEntry.reviewIds) ? baseEntry.reviewIds : {}) };
        entry.reviewIds[segmentKey] = reviewId;
    }
    if (evidence !== undefined) {
        entry.records = { ...(isPlainObject(baseEntry.records) ? baseEntry.records : {}) };
        entry.records[segmentKey] = {
            speaker,
            source,
            confidence: entry.confidences?.[segmentKey],
            evidence,
            ...(entry.reviewIds?.[segmentKey] ? { reviewId: entry.reviewIds[segmentKey] } : {}),
        };
    }
    applyMessageAttributionIdentity(entry, msg);
    if (Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(normalizedOptions.verificationStatus)) {
        entry.verificationStatus = normalizedOptions.verificationStatus;
    }
    if (normalizedOptions.markUnverified === true) {
        delete entry.verifiedHash;
        delete entry.verifiedAt;
        delete entry.verifiedVersion;
    } else {
        entry.verifiedHash = entry.hash;
        entry.verifiedAt = Date.now();
        entry.verifiedVersion = ATTRIBUTION_VERIFIER_VERSION;
        if (!Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(entry.verificationStatus)) {
            entry.verificationStatus = source === ATTRIBUTION_SOURCE.LLM
                ? ATTRIBUTION_VERIFICATION_STATUS.AUTO_APPLIED
                : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
        }
    }
    try {
        if (existingMap) existingMap[messageKey] = entry;
        else metadata[OVERRIDES_METADATA_KEY] = { [messageKey]: entry };
    } catch (_) {
        return false;
    }
    streamingHeuristicCache.clear();
    saveChatMetadata();
    return true;
}

export function deleteMessageQuoteOverride(mesIndex, msg, segmentIndex) {
    const map = getQuoteOverridesMap(false);
    const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
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
    applyMessageAttributionIdentity(entry, msg);
    entry.verifiedHash = entry.hash;
    entry.verifiedAt = Date.now();
    entry.verifiedVersion = ATTRIBUTION_VERIFIER_VERSION;
    entry.verificationStatus = Object.values(ATTRIBUTION_VERIFICATION_STATUS).includes(verificationStatus)
        ? verificationStatus
        : ATTRIBUTION_VERIFICATION_STATUS.CLEAN;
    saveChatMetadata();
    return true;
}

export function isMessageAttributionVerified(mesIndex, msg) {
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
        saveMetadata: saveChatMetadata,
        extendedOverrides: true,
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
        streamingHeuristicCache.clear();
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
    // No ordinal fallback: when this extension's segmentation disagrees with
    // SillyTavern's rendered quotes, positional mapping can hand two different
    // elements the same segment index, and an override written against it would
    // recolour a quote the user never clicked. Refusing to guess is safer.
    return resolvedIndex;
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
 * Queues a coalesced repair whenever child nodes change inside the message.
 * Disconnects after MESSAGE_SETTLE_MAX_WAIT_MS.
 */

export function attachMessageSettleObserver(mesElement, mesIndex) {
    if (!mesElement?.isConnected) return;
    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
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
        const msg = getContext()?.chat?.[repairIndex];
        if (!msg || msg.is_system) return;
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
            if (!settings.enabled || !isDomEngine()) return;
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
        if (!settings.enabled || !isDomEngine()) return;
        for (const pendingElement of pending) {
            const pendingIndex = Number(pendingElement?.getAttribute?.('mesid'));
            if (!Number.isFinite(pendingIndex) || pendingIndex < 0) continue;
            const msg = getContext()?.chat?.[pendingIndex];
            const mesText = pendingElement?.querySelector?.('.mes_text');
            if (!mesText || !msg || msg.is_system) continue;
            if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) {
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
                if (!isDomEngine()) continue;
                observed.add(mesElement);
            }
        }
        if (!isDomEngine()) {
            applyCustomFontsToMessageElements(fontTargets);
            return;
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
