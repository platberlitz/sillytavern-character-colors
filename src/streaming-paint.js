// Streaming colour painting.
//
// SillyTavern rewrites .mes_text on every streaming tick (innerHTML assignment
// or a morphdom patch), which strips every style and data-dc-* attribute we
// wrote. Its flush runs inside requestAnimationFrame, and MutationObserver
// callbacks are delivered at the microtask checkpoint right after that frame
// callback - before the browser paints. So repainting from an observer lands in
// the same frame as the host's write and the user never sees uncoloured text.
//
// The timer-driven schedulers cannot do this: they repaint a frame or more
// later, which is the flicker. While a paint session owns a message index they
// all stand down (see isStreamingOwnedMessage in dom-engine.js).
import { attributeDialogueSegments } from './attribution.js';
import { isHostSystemOrToolMessage } from './attribution-store.js';
import { applyCustomFontsToFontTags } from './fonts.js';
import { collectFontColorsFromText } from './color-blocks.js';
import { applySegmentDecoration, clearSegmentDecoration, decorateNarratorTextNodes, getMessageQuoteOverrideOptions, matchSegmentsToElements } from './dom-engine.js';
import { getNarratorVisual } from './narrator-style.js';
import { applyThemeReadabilityAndBrightness } from './palettes.js';
import { getContext } from './st-api.js';
import { isDomEngine, resetStreamingSession, settings, streamingSession } from './state.js';
import { normalizeSegmentText } from './utils.js';
import { queueColorStateSave } from './live-colors.js';

const MAX_STREAMING_SEGMENT_ASSIGNMENTS = 512;
let streamingIdentity = null;
const stableSegmentAssignments = new Map();

function getStreamingChatIdentity(context) {
    return [
        context?.chatId ?? context?.chat_id ?? '',
        context?.groupId ?? context?.group_id ?? '',
        context?.characterId ?? context?.character_id ?? '',
    ].map(value => String(value ?? '')).join('\u0000');
}

function getStreamingMessageId(message) {
    return String(message?.id ?? message?.send_date ?? '');
}

function getStreamingSwipeId(message) {
    return Object.prototype.hasOwnProperty.call(message || {}, 'swipe_id')
        ? String(message.swipe_id ?? '')
        : null;
}

function clearStreamingIdentity() {
    streamingIdentity = null;
    stableSegmentAssignments.clear();
}

function invalidateStreamingPaint() {
    clearStreamingIdentity();
    resetStreamingSession();
    return false;
}

function captureStreamingIdentity() {
    const context = getContext();
    const chat = context?.chat;
    const index = streamingSession.mesIndex;
    const message = Array.isArray(chat) ? chat[index] : null;
    const chatRoot = document.getElementById?.('chat') || null;
    if (!message || !streamingSession.mesElement || !streamingSession.mesText) return false;
    streamingIdentity = {
        chat,
        chatIdentity: getStreamingChatIdentity(context),
        chatRoot,
        message,
        messageId: getStreamingMessageId(message),
        swipeId: getStreamingSwipeId(message),
        mesIndex: index,
        mesid: streamingSession.mesElement.getAttribute?.('mesid') ?? String(index),
        lastText: String(message.mes ?? ''),
    };
    stableSegmentAssignments.clear();
    return true;
}

function isStreamingIdentityCurrent() {
    if (!streamingIdentity || !streamingSession.active
        || streamingSession.mesIndex !== streamingIdentity.mesIndex) return false;
    const context = getContext();
    const message = context?.chat?.[streamingIdentity.mesIndex];
    if (context?.chat !== streamingIdentity.chat
        || getStreamingChatIdentity(context) !== streamingIdentity.chatIdentity
        || message !== streamingIdentity.message
        || getStreamingMessageId(message) !== streamingIdentity.messageId
        || getStreamingSwipeId(message) !== streamingIdentity.swipeId) return false;
    const text = String(message?.mes ?? '');
    if (!text.startsWith(streamingIdentity.lastText)) stableSegmentAssignments.clear();
    if (streamingIdentity.chatRoot
        && document.getElementById?.('chat') !== streamingIdentity.chatRoot) return false;
    return true;
}

function resolveStreamingTarget() {
    const selector = `.mes[mesid="${streamingSession.mesIndex}"]`;
    const mesElement = streamingIdentity?.chatRoot?.querySelector?.(selector)
        || document.querySelector?.(`#chat ${selector}`)
        || (!streamingIdentity?.chatRoot && streamingSession.mesElement?.isConnected ? streamingSession.mesElement : null);
    const mesText = mesElement?.querySelector?.('.mes_text');
    streamingSession.mesElement = mesElement || null;
    streamingSession.mesText = mesText || null;
    if (!mesText || mesElement.isConnected === false || mesText.isConnected === false) return false;
    const mesid = mesElement.getAttribute?.('mesid');
    if (mesid !== null && mesid !== undefined && Number(mesid) !== streamingSession.mesIndex) return false;
    if (streamingIdentity && mesid !== null && mesid !== undefined
        && String(mesid) !== String(streamingIdentity.mesid)) return false;
    if (streamingIdentity?.chatRoot && !streamingIdentity.chatRoot.contains?.(mesElement)) return false;
    return true;
}

function observeStreamingTarget() {
    if (!streamingSession.active || !streamingSession.observer) return;
    if (!isStreamingIdentityCurrent() || !resolveStreamingTarget()) return;
    streamingSession.observer.observe(streamingSession.mesText, { childList: true, subtree: true, characterData: true });
}

function stabilizeStreamingAssignments(attribution, overrideOptions) {
    const overrides = overrideOptions.overrides;
    for (const segment of attribution.segments.slice(0, MAX_STREAMING_SEGMENT_ASSIGNMENTS)) {
        const key = `${segment.delimiter}:${segment.index}`;
        const overridden = overrides && Object.prototype.hasOwnProperty.call(overrides, String(segment.index));
        if (!overridden && stableSegmentAssignments.has(key)) {
            segment.assignment = { ...stableSegmentAssignments.get(key) };
            segment.provenance = { source: 'streaming-cache', method: 'stable-segment-index' };
            segment.confidence = Math.max(0.8, Number(segment.confidence) || 0);
        } else if (segment.assignment) {
            stableSegmentAssignments.set(key, { ...segment.assignment });
        }
    }
    while (stableSegmentAssignments.size > MAX_STREAMING_SEGMENT_ASSIGNMENTS) {
        stableSegmentAssignments.delete(stableSegmentAssignments.keys().next().value);
    }
}

export function paintStreamingMessage() {
    if (!streamingSession.active || streamingSession.painting) return false;
    if (!settings.enabled || !isDomEngine()) return false;
    if (!streamingIdentity && (!resolveStreamingTarget() || !captureStreamingIdentity())) return false;
    if (!isStreamingIdentityCurrent()) return invalidateStreamingPaint();
    if (!resolveStreamingTarget()) return false;

    const msg = getContext()?.chat?.[streamingSession.mesIndex];
    if (!msg || isHostSystemOrToolMessage(msg)) return false;

    const mesText = streamingSession.mesText;
    streamingSession.painting = true;
    // Our own writes are mutations too, and the callback for them arrives in a
    // later microtask when the painting flag is already back down. Disconnecting
    // drops the pending record queue, so we never repaint in reaction to
    // ourselves - which is what turned a colour refresh into a DOM storm.
    streamingSession.observer?.disconnect();
    try {
        if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) {
            mesText.querySelectorAll('[data-dc-colored], [data-dc-seg]').forEach(clearSegmentDecoration);
            applyCustomFontsToFontTags(mesText, msg.mes);
            return true;
        }

        const overrideOptions = getMessageQuoteOverrideOptions(streamingSession.mesIndex, msg);
        streamingSession.assignments.clear();
        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            streaming: true,
            mesIndex: streamingSession.mesIndex,
            autoAddMessageSpeaker: true,
            ...overrideOptions,
        });
        stabilizeStreamingAssignments(attribution, overrideOptions);
        streamingSession.assignments.clear();
        if (attribution.createdCharacters) queueColorStateSave({ history: false, injectPrompt: false });

        const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
        const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
        const quoteElements = Array.from(mesText.querySelectorAll('q'));
        const emphasisElements = Array.from(mesText.querySelectorAll('em'));
        const matched = new Set();
        const decorate = (segment, element) => {
            matched.add(element);
            applySegmentDecoration(segment, element);
        };
        matchSegmentsToElements(quoteSegments, quoteElements, seg => normalizeSegmentText(seg.text), decorate, { allowAnchoredFallback: true });
        matchSegmentsToElements(emphasisSegments, emphasisElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), decorate, { allowAnchoredFallback: true });
        for (const element of quoteElements.concat(emphasisElements)) {
            if (!matched.has(element)) clearSegmentDecoration(element);
        }

        // Narrator spans only ever get added here. Unwrapping them mid-stream is
        // a childList mutation that would re-enter this observer and make the
        // narration blink between its own colour and the default.
        const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        if (narrator) decorateNarratorTextNodes(mesText, narrator);

        applyCustomFontsToFontTags(mesText, msg.mes);
        return true;
    } finally {
        if (streamingIdentity?.message === msg) streamingIdentity.lastText = String(msg.mes ?? '');
        streamingSession.painting = false;
        observeStreamingTarget();
    }
}

export function beginStreamingPaint() {
    if (!settings.enabled || !isDomEngine()) return false;
    const chat = getContext()?.chat;
    const mesIndex = Array.isArray(chat) ? chat.length - 1 : -1;
    if (mesIndex < 0) return false;
    if (isHostSystemOrToolMessage(chat[mesIndex])) return false;

    // Both STREAM_TOKEN_RECEIVED and SMOOTH_STREAM_TOKEN_RECEIVED fire per
    // token, so this runs constantly and must stay a cheap no-op once armed.
    if (streamingSession.active && streamingSession.mesIndex === mesIndex) {
        if (!streamingSession.observer) return false;
        return paintStreamingMessage();
    }

    resetStreamingSession();
    clearStreamingIdentity();
    streamingSession.active = true;
    streamingSession.mesIndex = mesIndex;
    if (!resolveStreamingTarget()) {
        // The message element has not been inserted yet; the next token retries.
        streamingSession.active = false;
        streamingSession.mesIndex = -1;
        return false;
    }
    if (!captureStreamingIdentity() || !isStreamingIdentityCurrent()) return invalidateStreamingPaint();

    streamingSession.observer = new MutationObserver(() => paintStreamingMessage());
    streamingSession.observer.observe(streamingSession.mesText, { childList: true, subtree: true, characterData: true });
    paintStreamingMessage();
    return true;
}

export function endStreamingPaint() {
    clearStreamingIdentity();
    resetStreamingSession();
}
