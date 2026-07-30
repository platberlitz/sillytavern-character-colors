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
import { applyCustomFontsToFontTags } from './fonts.js';
import { collectFontColorsFromText } from './color-blocks.js';
import { applySegmentDecoration, decorateNarratorTextNodes, getMessageQuoteOverrideOptions, matchSegmentsToElements } from './dom-engine.js';
import { getNarratorVisual } from './narrator-style.js';
import { applyThemeReadabilityAndBrightness } from './palettes.js';
import { getContext } from './st-api.js';
import { isDomEngine, resetStreamingSession, settings, streamingSession } from './state.js';
import { normalizeSegmentText } from './utils.js';

function resolveStreamingTarget() {
    if (streamingSession.mesText?.isConnected && streamingSession.mesElement?.isConnected) return true;
    // The host re-queries its own cached nodes after chat-window pruning, so we
    // have to as well or we keep painting a detached element.
    const mesElement = document.querySelector(`#chat .mes[mesid="${streamingSession.mesIndex}"]`);
    const mesText = mesElement?.querySelector?.('.mes_text');
    streamingSession.mesElement = mesElement || null;
    streamingSession.mesText = mesText || null;
    return !!mesText;
}

export function paintStreamingMessage() {
    if (!streamingSession.active || streamingSession.painting) return false;
    if (!settings.enabled || !isDomEngine()) return false;
    if (!resolveStreamingTarget()) return false;

    const msg = getContext()?.chat?.[streamingSession.mesIndex];
    if (!msg || msg.is_system) return false;

    const mesText = streamingSession.mesText;
    streamingSession.painting = true;
    try {
        if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) {
            applyCustomFontsToFontTags(mesText, msg.mes);
            return true;
        }

        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            streaming: true,
            mesIndex: streamingSession.mesIndex,
            autoAddMessageSpeaker: true,
            ...getMessageQuoteOverrideOptions(streamingSession.mesIndex, msg),
        });

        const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
        const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
        matchSegmentsToElements(quoteSegments, Array.from(mesText.querySelectorAll('q')), seg => normalizeSegmentText(seg.text), applySegmentDecoration, { allowAnchoredFallback: true });
        matchSegmentsToElements(emphasisSegments, Array.from(mesText.querySelectorAll('em')), seg => normalizeSegmentText(seg.text.slice(1, -1)), applySegmentDecoration, { allowAnchoredFallback: true });

        // Narrator spans only ever get added here. Unwrapping them mid-stream is
        // a childList mutation that would re-enter this observer and make the
        // narration blink between its own colour and the default.
        const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        if (narrator) decorateNarratorTextNodes(mesText, narrator);

        applyCustomFontsToFontTags(mesText, msg.mes);
        return true;
    } finally {
        streamingSession.painting = false;
    }
}

export function beginStreamingPaint() {
    if (!settings.enabled || !isDomEngine()) return false;
    const chat = getContext()?.chat;
    const mesIndex = Array.isArray(chat) ? chat.length - 1 : -1;
    if (mesIndex < 0) return false;

    // Both STREAM_TOKEN_RECEIVED and SMOOTH_STREAM_TOKEN_RECEIVED fire per
    // token, so this runs constantly and must stay a cheap no-op once armed.
    if (streamingSession.active && streamingSession.mesIndex === mesIndex) {
        if (!streamingSession.observer) return false;
        paintStreamingMessage();
        return true;
    }

    resetStreamingSession();
    streamingSession.active = true;
    streamingSession.mesIndex = mesIndex;
    if (!resolveStreamingTarget()) {
        // The message element has not been inserted yet; the next token retries.
        streamingSession.active = false;
        streamingSession.mesIndex = -1;
        return false;
    }

    streamingSession.observer = new MutationObserver(() => paintStreamingMessage());
    streamingSession.observer.observe(streamingSession.mesText, { childList: true, subtree: true, characterData: true });
    paintStreamingMessage();
    return true;
}

export function endStreamingPaint() {
    resetStreamingSession();
}
