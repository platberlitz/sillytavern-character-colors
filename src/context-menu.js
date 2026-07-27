// context-menu.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { resolveCharacterKeyByNameOrAlias } from './color-blocks.js';
import { cancelMessageDomFollowupRepairs, clearMessageDomRepairTimer, clearStreamingAttributionOverrides, decorateMessageDomFromCurrentRender, deleteMessageQuoteOverride, getMessageIndexFromElement, getMessageQuoteOverrideEntry, getMessageQuoteOverrideOptions, matchSegmentsToElements, refreshAndDecorateMessageDom, refreshMessageDom, resolveDomSegmentIndexForElement, restoreMessageQuoteOverrideEntry, scheduleMessageDomFollowupRepair, setMessageQuoteOverride } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, flushChatSave, queueChatSave, updateTextColorReferences, updateVisibleMessageColors } from './live-colors.js';
import { buildCharacterEntry, getEntryEffectiveColor, setEntryFromEffectiveColor } from './palettes.js';
import { escapeHtml, eventSource, event_types, getContext, power_user } from './st-api.js';
import { characterColors, isDomEngine, runtimeState, settings } from './state.js';
import { getSortedEntries, updateLegend } from './ui.js';
import { escapeAttr, hashMessageText, normalizeHexColor, normalizeSegmentText, toast } from './utils.js';

const INVALID_CHARACTER_NAME_RE = /[\r\n\t\[\]=,()]/;
const CONTEXT_FOCUS_ATTRIBUTE = 'data-dc-context-focus';
const CONTEXT_CHARACTER_OPTION_LIMIT = 200;
let closeActiveAssignmentSurface = null;

function readCharacterName(nameInput) {
    const name = nameInput.value.trim();
    if (!name) return '';
    if (INVALID_CHARACTER_NAME_RE.test(name)) {
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.focus({ preventScroll: true });
        toast.error('Character names cannot contain brackets, commas, equals signs, parentheses, or line breaks.');
        return null;
    }
    nameInput.removeAttribute('aria-invalid');
    return name;
}

function formatAttributionSource(source) {
    const labels = {
        llm: 'LLM verifier',
        review: 'Reviewed suggestion',
        manual: 'Manual assignment',
        override: 'Saved override',
        'explicit-mention': 'Explicit mention',
        'streaming-cache': 'Streaming cache',
        'paragraph-carry': 'Paragraph carry',
        alternation: 'Speaker alternation',
        'message-speaker': 'Message speaker',
        'color-block': 'Color block',
        heuristic: 'Heuristic',
        imported: 'Imported',
        unknown: 'Unknown',
    };
    return labels[source] || String(source || 'Unknown').replace(/-/g, ' ');
}

function getCharacterSuggestionMarkup() {
    const entries = getSortedEntries();
    const datalistOptions = entries
        .slice(0, CONTEXT_CHARACTER_OPTION_LIMIT)
        .map(([, entry]) => `<option value="${escapeAttr(entry.name)}">`)
        .join('');
    const omittedCount = Math.max(0, entries.length - CONTEXT_CHARACTER_OPTION_LIMIT);
    const truncationNote = omittedCount
        ? `<p class="dc-context-note" role="note">Suggestions show the first ${CONTEXT_CHARACTER_OPTION_LIMIT} of ${entries.length} characters. Type an exact existing name or alias to select one of the ${omittedCount} omitted entries.</p>`
        : '';
    return { datalistOptions, truncationNote };
}

function getDomAttributionDetails(targetEl) {
    const messageIndex = getMessageIndexFromElement(targetEl);
    const message = getContext()?.chat?.[messageIndex];
    if (!message || !Number.isInteger(messageIndex) || messageIndex < 0) return null;
    const segmentIndex = resolveDomSegmentIndexForElement(targetEl, messageIndex, message);
    if (!Number.isFinite(segmentIndex)) return null;
    const attribution = attributeDialogueSegments(message.mes, message.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(messageIndex, message),
        mesIndex: messageIndex,
    });
    const segment = attribution.segments.find(item => item.index === segmentIndex);
    if (!segment) return null;
    const override = getMessageQuoteOverrideEntry(messageIndex, message, false);
    return {
        messageIndex,
        message,
        segmentIndex,
        source: segment?.provenance?.source || '',
        confidence: Number(segment?.confidence),
        hasOverride: !!override?.segments && Object.prototype.hasOwnProperty.call(override.segments, String(segmentIndex)),
        segmentText: segment.text,
        segmentDelimiter: segment.delimiter,
        speakerKey: segment.assignment?.key || '',
        speakerColor: segment.assignment?.color || null,
    };
}

function getDomAssignmentMessageId(message) {
    const id = message?.id ?? message?.send_date ?? '';
    return id === null || id === undefined ? '' : String(id);
}

function captureDomAssignmentTarget(targetEl, details) {
    if (!targetEl?.isConnected || !details?.message || !Number.isInteger(details.messageIndex)
        || !Number.isFinite(details.segmentIndex)) return null;
    return {
        element: targetEl,
        messageIndex: details.messageIndex,
        message: details.message,
        messageId: getDomAssignmentMessageId(details.message),
        messageHash: hashMessageText(details.message.mes),
        segmentIndex: details.segmentIndex,
        segmentText: details.segmentText,
        segmentDelimiter: details.segmentDelimiter,
        speakerKey: details.speakerKey,
        elementText: normalizeSegmentText(targetEl.textContent),
        tagName: targetEl.tagName,
    };
}

function isDomAssignmentSourceCurrent(target) {
    if (!target) return false;
    const message = getContext()?.chat?.[target.messageIndex];
    if (message !== target.message || getDomAssignmentMessageId(message) !== target.messageId
        || hashMessageText(message?.mes) !== target.messageHash) return false;
    const attribution = attributeDialogueSegments(message.mes, message.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(target.messageIndex, message),
        mesIndex: target.messageIndex,
    });
    const segment = attribution.segments.find(item => item.index === target.segmentIndex);
    return !!segment && segment.text === target.segmentText && segment.delimiter === target.segmentDelimiter;
}

function isDomAssignmentTargetCurrent(target) {
    if (!isDomAssignmentSourceCurrent(target) || !target.element?.isConnected
        || target.element.tagName !== target.tagName
        || normalizeSegmentText(target.element.textContent) !== target.elementText) return false;
    if (getMessageIndexFromElement(target.element) !== target.messageIndex) return false;
    const message = getContext()?.chat?.[target.messageIndex];
    if (resolveDomSegmentIndexForElement(target.element, target.messageIndex, message) !== target.segmentIndex) return false;
    if (target.element.getAttribute('data-dc-seg') !== String(target.segmentIndex)) return false;
    if (target.speakerKey && target.element.getAttribute('data-dc-speaker') !== target.speakerKey) return false;
    return true;
}

function getMenuPosition(e, targetEl) {
    if (e?.type !== 'keydown') {
        const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
        if (Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY)) {
            return { x: point.clientX, y: point.clientY };
        }
    }

    const rect = targetEl?.getBoundingClientRect?.();
    return rect
        ? { x: rect.left, y: rect.bottom }
        : { x: 100, y: 100 };
}

function mountAssignmentSurface(menu, opener) {
    if (closeActiveAssignmentSurface) closeActiveAssignmentSurface({ restoreFocus: false });
    const openerMessage = opener?.closest?.('.mes[mesid]');
    const openerMessageId = openerMessage?.getAttribute('mesid') || '';
    const openerSegmentIndex = openerMessage
        ? [...openerMessage.querySelectorAll(getManagedDialogueSelector())].indexOf(opener)
        : -1;
    document.body.appendChild(menu);
    const inertSiblings = [...document.body.children]
        .filter(element => element !== menu && !element.inert)
        .map(element => { element.inert = true; return element; });

    const clampToVisualViewport = () => {
        const viewport = window.visualViewport;
        const leftEdge = viewport?.offsetLeft || 0;
        const topEdge = viewport?.offsetTop || 0;
        const rightEdge = leftEdge + (viewport?.width || window.innerWidth);
        const bottomEdge = topEdge + (viewport?.height || window.innerHeight);
        const rect = menu.getBoundingClientRect();
        const currentLeft = Number.parseFloat(menu.style.left) || rect.left;
        const currentTop = Number.parseFloat(menu.style.top) || rect.top;
        menu.style.left = `${Math.max(leftEdge + 8, Math.min(currentLeft, rightEdge - rect.width - 8))}px`;
        menu.style.top = `${Math.max(topEdge + 8, Math.min(currentTop, bottomEdge - rect.height - 8))}px`;
    };
    clampToVisualViewport();

    let closed = false;
    const close = ({ restoreFocus = true } = {}) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', handleOutsidePointer, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        window.visualViewport?.removeEventListener('resize', clampToVisualViewport);
        window.visualViewport?.removeEventListener('scroll', clampToVisualViewport);
        inertSiblings.forEach(element => { element.inert = false; });
        menu.remove();
        if (closeActiveAssignmentSurface === close) closeActiveAssignmentSurface = null;
        if (restoreFocus) {
            let focusTarget = opener?.isConnected ? opener : null;
            if (!focusTarget && openerMessageId) {
                const message = document.querySelector(`#chat .mes[mesid="${CSS.escape(openerMessageId)}"]`);
                const messageText = message?.querySelector('.mes_text');
                const targets = getMessageDialogueTargets(messageText);
                focusTarget = openerSegmentIndex >= 0 ? targets[openerSegmentIndex] || targets[0] : messageText;
                if (focusTarget && !focusTarget.hasAttribute('tabindex')) {
                    focusTarget.setAttribute('tabindex', openerSegmentIndex >= 0 ? '0' : '-1');
                    if (openerSegmentIndex >= 0) {
                        focusTarget.setAttribute('aria-keyshortcuts', 'Shift+F10');
                        focusTarget.setAttribute(CONTEXT_FOCUS_ATTRIBUTE, 'tabindex');
                    }
                }
            }
            if (typeof focusTarget?.focus === 'function') focusTarget.focus({ preventScroll: true });
        }
    };
    const handleOutsidePointer = e => {
        if (!menu.contains(e.target)) close();
    };
    const handleKeyDown = e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusable = [...menu.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(element => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    closeActiveAssignmentSurface = close;
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.visualViewport?.addEventListener('resize', clampToVisualViewport);
    window.visualViewport?.addEventListener('scroll', clampToVisualViewport);
    menu.querySelector('#dc-ctx-name')?.focus({ preventScroll: true });
    setTimeout(clampToVisualViewport, 0);
    return close;
}

// Right-click and long-press context menu for messages
function showMenu(e, fontTag, qElement = null) {
    e.preventDefault?.();
    const isDomSegment = isDomEngine() && !fontTag && !!qElement;
    const isBareQuote = !isDomSegment && !fontTag && !!qElement;
    const targetEl = (isDomSegment || isBareQuote) ? qElement : fontTag;
    const opener = e.type === 'keydown' ? targetEl : document.activeElement;
    const attributionDetails = isDomSegment ? getDomAttributionDetails(targetEl) : null;
    const domSpeakerKey = isDomSegment
        ? targetEl.getAttribute('data-dc-speaker') || attributionDetails?.speakerKey || ''
        : '';
    const domSpeakerColor = domSpeakerKey && characterColors[domSpeakerKey]
        ? getEntryEffectiveColor(characterColors[domSpeakerKey])
        : attributionDetails?.speakerColor;
    const quoteFallbackColor = normalizeHexColor(power_user.quote_text_color, '#888888');
    const color = isDomSegment
        ? normalizeHexColor(domSpeakerColor, quoteFallbackColor)
        : isBareQuote ? quoteFallbackColor : normalizeHexColor(fontTag.getAttribute('color'));
    const text = targetEl.textContent.substring(0, 30) + (targetEl.textContent.length > 30 ? '...' : '');
    const domAssignmentTarget = isDomSegment ? captureDomAssignmentTarget(targetEl, attributionDetails) : null;
    const attributionStatus = attributionDetails?.source
        ? `<div class="dc-context-attribution">Source: ${escapeHtml(formatAttributionSource(attributionDetails.source))}${Number.isFinite(attributionDetails.confidence) ? `; Confidence: ${Math.round(Math.max(0, Math.min(1, attributionDetails.confidence)) * 100)}%` : ''}</div>`
        : '';
    const automaticAttributionAction = attributionDetails?.hasOverride
        ? '<button id="dc-ctx-use-automatic" class="menu_button" style="width:100%;margin-bottom:4px;">Use automatic attribution</button>'
        : '';

    const { datalistOptions, truncationNote } = getCharacterSuggestionMarkup();

    const menu = document.createElement('div');
    menu.id = 'dc-context-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    menu.setAttribute('aria-labelledby', 'dc-ctx-title');
    menu.setAttribute('aria-describedby', 'dc-ctx-preview');
    const { x, y } = getMenuPosition(e, targetEl);
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:999999;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    menu.innerHTML = `
        <div id="dc-ctx-title" style="font-weight:600;margin-bottom:4px;">Assign dialogue manually</div>
        <div id="dc-ctx-preview" style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">${isDomSegment ? '<em style="font-size:0.9em;">(DOM override)</em><br>' : isBareQuote ? '<em style="font-size:0.9em;">(uncolored quote)</em><br>' : ''}"${escapeHtml(text)}"</div>
        ${attributionStatus}
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span aria-hidden="true" style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
            <input type="color" id="dc-ctx-color" value="${color}" aria-label="Character color" style="width:24px;height:20px;border:none;">
            <input type="text" id="dc-ctx-name" list="dc-ctx-chars" aria-label="Character name" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
            <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
        </div>
        ${truncationNote}
        <p class="dc-context-note">Direct manual assignment may create a character only from the name you enter.</p>
        <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign manually</button>
        ${automaticAttributionAction}
        <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
    `;
    const closeMenu = mountAssignmentSurface(menu, opener);
    menu.querySelector('#dc-ctx-close').onclick = () => closeMenu();

    menu.querySelector('#dc-ctx-use-automatic')?.addEventListener('click', async () => {
        try {
            if (!isDomAssignmentSourceCurrent(domAssignmentTarget)) {
                toast.warning('Message changed; reopen the assignment menu.');
                return;
            }
            const recoverDom = !isDomAssignmentTargetCurrent(domAssignmentTarget);
            const messageIndex = domAssignmentTarget.messageIndex;
            const segmentIndex = domAssignmentTarget.segmentIndex;
            const message = domAssignmentTarget.message;
            if (!message || !Number.isFinite(segmentIndex)) {
                toast.error('Could not map this dialogue segment.');
                return;
            }
            if (!deleteMessageQuoteOverride(messageIndex, message, segmentIndex)) {
                toast.info('This dialogue segment is already using automatic attribution.');
                return;
            }
            clearMessageDomRepairTimer(messageIndex);
            cancelMessageDomFollowupRepairs(messageIndex);
            clearStreamingAttributionOverrides(messageIndex);
            const repainted = recoverDom
                ? await refreshAndDecorateMessageDom(messageIndex, message, { queueVerification: false })
                : await decorateMessageDomFromCurrentRender(messageIndex, message, {
                    queueVerification: false,
                    renderFallback: false,
                });
            scheduleMessageDomFollowupRepair(messageIndex, repainted);
            updateLegend();
            toast.success('Automatic attribution restored.');
        } catch (error) {
            toast.error('Could not restore automatic attribution.');
            console.error('[Dialogue Colors] Failed to clear dialogue override:', error);
        } finally {
            closeMenu();
        }
    });

    const nameInput = menu.querySelector('#dc-ctx-name');
    const colorInput = menu.querySelector('#dc-ctx-color');
    if (isDomSegment && domSpeakerKey && characterColors[domSpeakerKey]) {
        nameInput.value = characterColors[domSpeakerKey].name;
    }

    nameInput.addEventListener('input', () => {
        nameInput.removeAttribute('aria-invalid');
        const name = nameInput.value.trim();
        const key = resolveCharacterKeyByNameOrAlias(name) || name.toLowerCase();
        if (characterColors[key]) {
            const existingColor = getEntryEffectiveColor(characterColors[key]);
            colorInput.value = existingColor;
        }
    });

    menu.querySelector('#dc-ctx-assign').onclick = async () => {
        const assignButton = menu.querySelector('#dc-ctx-assign');
        const targetMesIndex = isDomSegment ? domAssignmentTarget?.messageIndex : getMessageIndexFromElement(targetEl);
        const targetMessage = getContext()?.chat?.[targetMesIndex];
        const originalMessageText = targetMessage?.mes;
        let installedKey = null;
        let previousEntry = null;
        let overrideRollback = null;
        let assignmentPersisted = false;
        let domRepaintTarget = null;
        assignButton.disabled = true;
        try {
            const nameInput = menu.querySelector('#dc-ctx-name');
            const colorInput = menu.querySelector('#dc-ctx-color');
            const name = readCharacterName(nameInput);
            if (name === null) return;
            const pickerColor = normalizeHexColor(colorInput.value, color);
            if (name) {
            const key = resolveCharacterKeyByNameOrAlias(name) || name.toLowerCase();
            let finalColor = pickerColor;
            let textUpdated = false;
            let assignmentSucceeded = false;
            let existingColorChanged = false;
            const existingEntry = characterColors[key];
            const existingSnapshot = existingEntry
                ? captureEffectiveColorSnapshot(Object.keys(characterColors))
                : null;
            const originalFontColor = fontTag
                ? normalizeHexColor(fontTag.getAttribute('color'), null)
                : null;

            let nextEntry = null;
            if (existingEntry) {
                nextEntry = JSON.parse(JSON.stringify(existingEntry));
                const existingColor = getEntryEffectiveColor(nextEntry);
                if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                    setEntryFromEffectiveColor(nextEntry, pickerColor);
                    existingColorChanged = true;
                }
                finalColor = getEntryEffectiveColor(nextEntry);
            } else {
                const built = buildCharacterEntry(name, {
                    color: pickerColor,
                    colorMode: 'effective',
                    locked: false,
                    dialogueCount: 1
                });
                if (!built.entry) { closeMenu(); return; }
                nextEntry = built.entry;
            }

            if (isDomSegment) {
                if (!isDomAssignmentSourceCurrent(domAssignmentTarget)) {
                    toast.warning('Message changed; reopen the assignment menu.');
                    closeMenu();
                    return;
                }
                const recoverDom = !isDomAssignmentTargetCurrent(domAssignmentTarget);
                const mesIndex = domAssignmentTarget.messageIndex;
                const msg = domAssignmentTarget.message;
                const segmentIndex = domAssignmentTarget.segmentIndex;
                overrideRollback = {
                    mesIndex,
                    snapshot: JSON.parse(JSON.stringify(getMessageQuoteOverrideEntry(mesIndex, msg, false) || null)),
                };
                if (!setMessageQuoteOverride(mesIndex, msg, segmentIndex, name, { source: 'manual' })) {
                    toast.error('Could not save quote override.');
                    closeMenu();
                    return;
                }
                clearMessageDomRepairTimer(mesIndex);
                cancelMessageDomFollowupRepairs(mesIndex);
                clearStreamingAttributionOverrides(mesIndex);
                assignmentSucceeded = true;
                domRepaintTarget = { mesIndex, msg, recoverDom };
            } else if (isBareQuote) {
                textUpdated = wrapQElementWithFontTag(qElement, finalColor);
                assignmentSucceeded = textUpdated;
            } else {
                const mesIndex = getMessageIndexFromElement(fontTag);
                textUpdated = updateMessageTextForFontTag(fontTag, originalFontColor, finalColor);
                if (textUpdated) {
                    fontTag.setAttribute('color', finalColor);
                    // updateTextColorReferences rewrites every same-colored span in
                    // msg.mes; sync the rest of the rendered DOM to match right away.
                    updateVisibleMessageColors(mesIndex, { [originalFontColor]: finalColor });
                }
                assignmentSucceeded = textUpdated;
            }

            if (!assignmentSucceeded) {
                toast.error('Could not map this dialogue to the saved message; nothing was changed.');
                closeMenu();
                return;
            }

            installedKey = key;
            previousEntry = existingEntry ? JSON.parse(JSON.stringify(existingEntry)) : null;
            characterColors[key] = nextEntry;
            assignmentPersisted = true;

            let refreshPending = false;
            // Both semantic mutations are now installed. Persistence and UI
            // failures are recoverable and must not unwind the assignment.
            try {
                commit({ history: false, inject: false, updateList: false, legend: false });
            } catch (error) {
                refreshPending = true;
                console.warn('[Dialogue Colors] Assignment installed, but immediate persistence failed:', error);
            }
            try {
                commit({ data: false });
            } catch (error) {
                refreshPending = true;
                console.warn('[Dialogue Colors] Assignment saved, but panel refresh failed:', error);
            }
            try {
                if (existingColorChanged) {
                    applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
                }
                scheduleCustomFontRefresh(0);
            } catch (error) {
                refreshPending = true;
                console.warn('[Dialogue Colors] Assignment saved, but global color refresh failed:', error);
            }

            if (domRepaintTarget) {
                let repainted = false;
                try {
                    repainted = domRepaintTarget.recoverDom
                        ? await refreshAndDecorateMessageDom(domRepaintTarget.mesIndex, domRepaintTarget.msg, { queueVerification: false })
                        : await decorateMessageDomFromCurrentRender(domRepaintTarget.mesIndex, domRepaintTarget.msg, {
                            queueVerification: false,
                            renderFallback: false,
                        });
                } catch (error) {
                    refreshPending = true;
                    console.warn('[Dialogue Colors] Assignment saved, but immediate DOM repaint failed:', error);
                }
                if (!repainted) refreshPending = true;
                try {
                    scheduleMessageDomFollowupRepair(domRepaintTarget.mesIndex, repainted);
                    updateLegend();
                } catch (error) {
                    refreshPending = true;
                    console.warn('[Dialogue Colors] Assignment saved, but follow-up DOM refresh failed:', error);
                }
            } else if (textUpdated) {
                try {
                    queueChatSave();
                    flushChatSave();
                } catch (error) {
                    refreshPending = true;
                    console.warn('[Dialogue Colors] Assignment saved, but chat save scheduling failed:', error);
                }
            }

            if (refreshPending) toast.warning(`Assigned to ${escapeHtml(name)}; visual refresh is pending.`);
            else toast.success(`Assigned to ${escapeHtml(name)}`);
            }
        } catch (error) {
            if (assignmentPersisted) {
                try {
                    if (domRepaintTarget) scheduleMessageDomFollowupRepair(domRepaintTarget.mesIndex, false);
                    toast.warning('The assignment was saved, but visual refresh is pending.');
                } catch (refreshError) {
                    console.error('[Dialogue Colors] Failed to schedule post-assignment repair:', refreshError);
                }
                console.error('[Dialogue Colors] Post-assignment refresh failed:', error);
                return;
            }
            if (overrideRollback) {
                clearMessageDomRepairTimer(overrideRollback.mesIndex);
                cancelMessageDomFollowupRepairs(overrideRollback.mesIndex);
            }
            if (installedKey) {
                if (previousEntry) characterColors[installedKey] = previousEntry;
                else delete characterColors[installedKey];
            }
            if (overrideRollback) restoreMessageQuoteOverrideEntry(overrideRollback.mesIndex, overrideRollback.snapshot);
            if (targetMessage && originalMessageText !== undefined) targetMessage.mes = originalMessageText;
            try {
                if (installedKey) commit({ history: false });
                scheduleCustomFontRefresh(0);
                if (overrideRollback && targetMessage) {
                    const repainted = await decorateMessageDomFromCurrentRender(overrideRollback.mesIndex, targetMessage, {
                        queueVerification: false,
                        renderFallback: false,
                    });
                    scheduleMessageDomFollowupRepair(overrideRollback.mesIndex, repainted);
                }
            } catch (rollbackError) {
                console.error('[Dialogue Colors] Failed to refresh the rolled-back assignment:', rollbackError);
            }
            toast.error('The dialogue assignment failed and was rolled back.');
            console.error('[Dialogue Colors] Failed to assign dialogue:', error);
        } finally {
            closeMenu();
        }
    };
}

function showSelectionMenu(e, selection, range, selectedText, mesEl) {
    e.preventDefault?.();
    const opener = document.activeElement;
    if (closeActiveAssignmentSurface) closeActiveAssignmentSurface({ restoreFocus: false });

    const msgIndex = getMessageIndexFromElement(mesEl);
    if (msgIndex === -1) return;

    const ctx = getContext();
    const chat = ctx?.chat || [];
    const msg = chat[msgIndex];
    if (!msg || msg.is_user) return;
    const sourceMessageHash = hashMessageText(msg.mes);
    const selectedRangeText = range.toString();
    const capturedMesText = mesEl.querySelector('.mes_text');
    const renderedStartOffset = getRenderedCharOffset(capturedMesText, range);
    const capturedSourceSpan = mapRenderedSelectionToSourceSpan(
        msg.mes,
        capturedMesText?.textContent || '',
        selectedText,
        renderedStartOffset,
    );
    if (!capturedSourceSpan) {
        toast.error('The selection could not be mapped safely to plain message source. Please re-select it.');
        return;
    }

    const { datalistOptions, truncationNote } = getCharacterSuggestionMarkup();

    const preview = selectedText.substring(0, 30) + (selectedText.length > 30 ? '...' : '');

    const menu = document.createElement('div');
    menu.id = 'dc-context-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    menu.setAttribute('aria-labelledby', 'dc-ctx-title');
    menu.setAttribute('aria-describedby', 'dc-ctx-preview');
    const { x, y } = getMenuPosition(e, mesEl);
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:999999;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    menu.innerHTML = `
        <div id="dc-ctx-title" style="font-weight:600;margin-bottom:4px;">Assign selected dialogue manually</div>
        <div id="dc-ctx-preview" style="font-size:0.8em;opacity:0.7;margin-bottom:6px;"><em style="font-size:0.9em;">(selected text)</em><br>"${escapeHtml(preview)}"</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span id="dc-ctx-color-dot" aria-hidden="true" style="width:12px;height:12px;border-radius:50%;background:#888888;"></span>
            <input type="color" id="dc-ctx-color" value="#888888" aria-label="Character color" style="width:24px;height:20px;border:none;">
            <input type="text" id="dc-ctx-name" list="dc-ctx-chars" aria-label="Character name" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
            <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
        </div>
        ${truncationNote}
        <p class="dc-context-note">Direct manual assignment may create a character only from the name you enter.</p>
        <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign manually</button>
        <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
    `;
    const closeMenu = mountAssignmentSurface(menu, opener);
    menu.querySelector('#dc-ctx-close').onclick = () => closeMenu();

    const nameInput = menu.querySelector('#dc-ctx-name');
    const colorInput = menu.querySelector('#dc-ctx-color');
    const colorDot = menu.querySelector('#dc-ctx-color-dot');

    colorInput.addEventListener('input', () => { colorDot.style.background = colorInput.value; });

    nameInput.addEventListener('input', () => {
        nameInput.removeAttribute('aria-invalid');
        const name = nameInput.value.trim();
        const key = resolveCharacterKeyByNameOrAlias(name) || name.toLowerCase();
        if (characterColors[key]) {
            const existingColor = getEntryEffectiveColor(characterColors[key]);
            colorInput.value = existingColor;
            colorDot.style.background = existingColor;
        }
    });

    menu.querySelector('#dc-ctx-assign').onclick = () => {
        const name = readCharacterName(nameInput);
        if (name === null) return;
        const pickerColor = normalizeHexColor(colorInput.value, '#888888');
        if (!name) { closeMenu(); return; }

        // Validate the saved range before changing character state.
        // Streaming can replace the message while this dialog is open.
        const mesTextEl = mesEl.querySelector('.mes_text');
        if (getContext()?.chat?.[msgIndex] !== msg
            || hashMessageText(msg.mes) !== sourceMessageHash
            || !range.startContainer?.isConnected
            || !mesTextEl?.contains(range.startContainer)
            || !mesTextEl?.contains(range.endContainer)
            || range.toString() !== selectedRangeText) {
            toast.error('Selection is no longer valid; the message changed. Please re-select the text.');
            closeMenu();
            return;
        }

        const key = resolveCharacterKeyByNameOrAlias(name) || name.toLowerCase();
        let finalColor = pickerColor;

        const existingSnapshot = characterColors[key]
            ? captureEffectiveColorSnapshot(Object.keys(characterColors))
            : null;

        let existingColorChanged = false;
        let nextEntry = null;
        if (characterColors[key]) {
            nextEntry = JSON.parse(JSON.stringify(characterColors[key]));
            const existingColor = getEntryEffectiveColor(nextEntry);
            if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                setEntryFromEffectiveColor(nextEntry, pickerColor);
                existingColorChanged = true;
            }
            finalColor = getEntryEffectiveColor(nextEntry);
        } else {
            const built = buildCharacterEntry(name, {
                color: pickerColor,
                colorMode: 'effective',
                locked: false,
                dialogueCount: 1
            });
            if (!built.entry) { closeMenu(); return; }
            nextEntry = built.entry;
        }

        const textUpdated = replaceMessageSelectionWithFontTag(msg, selectedText, finalColor, {
            sourceStart: capturedSourceSpan.start,
            sourceEnd: capturedSourceSpan.end,
        });
        if (textUpdated) {
            selection.removeAllRanges();
            characterColors[key] = nextEntry;
            if (existingColorChanged) {
                applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
            }
            queueChatSave();
            flushChatSave();
            commit();
            refreshMessageDom(msgIndex, msg);
            toast.success(`Assigned to ${escapeHtml(name)}`);
        } else {
            toast.error('The selection could not be mapped unambiguously to plain message source; nothing was changed.');
        }
        closeMenu();
    };
}

function getEventElement(target) {
    return target?.closest ? target : target?.parentElement;
}

function getManagedDialogueSelector() {
    return isDomEngine()
        ? '.mes_text [data-dc-seg], .mes_text q, .mes_text em'
        : '.mes_text font[color], .mes_text q';
}

function clearManagedTabStop(element) {
    if (element.getAttribute(CONTEXT_FOCUS_ATTRIBUTE) !== 'tabindex') return;
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-keyshortcuts');
    element.removeAttribute(CONTEXT_FOCUS_ATTRIBUTE);
}

function getMessageDialogueTargets(mesText) {
    if (!mesText) return [];
    const selector = isDomEngine() ? '[data-dc-seg], q, em' : 'font[color], q';
    return [...mesText.querySelectorAll(selector)].filter(element => resolveDialogueAssignmentTarget(element)?.targetEl === element);
}

function syncManagedDialogueTabStops(messageRoots = null) {
    const roots = messageRoots
        ? [...messageRoots].filter(root => root?.isConnected)
        : [...document.querySelectorAll('#chat .mes_text')];
    const managed = messageRoots
        ? roots.flatMap(root => [...root.querySelectorAll(`[${CONTEXT_FOCUS_ATTRIBUTE}]`)])
        : [...document.querySelectorAll(`[${CONTEXT_FOCUS_ATTRIBUTE}]`)];
    if (!settings.enableRightClick) {
        managed.forEach(clearManagedTabStop);
        if (closeActiveAssignmentSurface) closeActiveAssignmentSurface();
        return;
    }

    const selector = getManagedDialogueSelector();
    managed.forEach(element => {
        if (!element.matches(selector) || resolveDialogueAssignmentTarget(element)?.targetEl !== element) clearManagedTabStop(element);
    });
    roots.forEach(mesText => {
        const targets = getMessageDialogueTargets(mesText);
        const activeTarget = targets.includes(document.activeElement) ? document.activeElement : null;
        const existingTarget = targets.find(element => element.getAttribute(CONTEXT_FOCUS_ATTRIBUTE) === 'tabindex' && element.getAttribute('tabindex') === '0');
        const tabTarget = activeTarget || existingTarget || targets[0];
        targets.forEach(element => {
            if (element.hasAttribute('tabindex') && element.getAttribute(CONTEXT_FOCUS_ATTRIBUTE) !== 'tabindex') return;
            element.setAttribute('tabindex', element === tabTarget ? '0' : '-1');
            element.setAttribute('aria-keyshortcuts', 'Shift+F10');
            element.setAttribute(CONTEXT_FOCUS_ATTRIBUTE, 'tabindex');
        });
    });
}

function resolveDialogueAssignmentTarget(source) {
    const target = getEventElement(source);
    const mesText = target?.closest('.mes_text');
    if (!mesText) return null;

    if (isDomEngine()) {
        const segmentEl = target.closest('[data-dc-seg], q, em');
        if (!segmentEl || !mesText.contains(segmentEl) || segmentEl.closest('font[color]')) return null;
        return { targetEl: segmentEl, fontTag: null, qElement: segmentEl };
    }

    const fontTag = target.closest('font[color]');
    if (fontTag && mesText.contains(fontTag)) {
        return { targetEl: fontTag, fontTag, qElement: null };
    }
    const qElement = target.closest('q');
    if (qElement && mesText.contains(qElement) && !qElement.closest('font[color]')) {
        return { targetEl: qElement, fontTag: null, qElement };
    }
    return null;
}

export function setupContextMenu() {
    if (runtimeState.contextMenuSetup) return;
    runtimeState.contextMenuSetup = true;
    let longPressState = null;
    let consumeTouchEnd = false;
    let suppressedContextTarget = null;
    let suppressContextUntil = 0;
    let focusSyncQueued = false;
    let forceFullFocusSync = false;
    const pendingFocusRoots = new Set();
    let activeTouchListeners = false;
    const activeTouchOptions = { passive: false, capture: true };

    const removeActiveTouchListeners = () => {
        if (!activeTouchListeners) return;
        activeTouchListeners = false;
        document.removeEventListener('touchmove', handleTouchMove, activeTouchOptions);
        document.removeEventListener('touchend', handleTouchEnd, activeTouchOptions);
        document.removeEventListener('touchcancel', handleTouchCancel, activeTouchOptions);
    };

    const clearLongPressState = () => {
        if (longPressState) {
            longPressState.cancelled = true;
            clearTimeout(longPressState.timer);
            longPressState = null;
        }
    };

    const finishTouchGesture = () => {
        clearLongPressState();
        consumeTouchEnd = false;
        removeActiveTouchListeners();
    };

    const handleTouchMove = e => {
        if (consumeTouchEnd) {
            e.preventDefault();
            return;
        }
        if (!longPressState || e.touches.length !== 1) {
            finishTouchGesture();
            return;
        }
        const touch = e.touches[0];
        if (Math.hypot(touch.clientX - longPressState.startX, touch.clientY - longPressState.startY) > 10) {
            finishTouchGesture();
        }
    };

    const handleTouchEnd = e => {
        if (consumeTouchEnd) e.preventDefault();
        finishTouchGesture();
    };

    const handleTouchCancel = () => {
        finishTouchGesture();
    };

    const attachActiveTouchListeners = () => {
        if (activeTouchListeners) return;
        activeTouchListeners = true;
        document.addEventListener('touchmove', handleTouchMove, activeTouchOptions);
        document.addEventListener('touchend', handleTouchEnd, activeTouchOptions);
        document.addEventListener('touchcancel', handleTouchCancel, activeTouchOptions);
    };

    const queueFocusSync = mutations => {
        if (!Array.isArray(mutations)) {
            forceFullFocusSync = true;
        } else {
            const collectClosestRoot = node => {
                if (!(node instanceof Element)) return;
                const closest = node.matches('.mes_text') ? node : node.closest('.mes_text');
                if (closest) pendingFocusRoots.add(closest);
            };
            const collectAddedRoots = node => {
                if (!(node instanceof Element)) return;
                collectClosestRoot(node);
                node.querySelectorAll?.('.mes_text').forEach(root => pendingFocusRoots.add(root));
            };
            mutations.forEach(mutation => {
                collectClosestRoot(mutation.target);
                mutation.addedNodes.forEach(collectAddedRoots);
            });
        }
        if (focusSyncQueued) return;
        focusSyncQueued = true;
        queueMicrotask(() => {
            focusSyncQueued = false;
            const roots = forceFullFocusSync ? null : new Set(pendingFocusRoots);
            forceFullFocusSync = false;
            pendingFocusRoots.clear();
            syncManagedDialogueTabStops(roots);
        });
    };

    syncManagedDialogueTabStops();
    const focusObserver = new MutationObserver(queueFocusSync);
    let observedChatRoot = null;
    const observeChatRoot = () => {
        const chatRoot = document.getElementById('chat');
        if (chatRoot === observedChatRoot) return;
        focusObserver.disconnect();
        observedChatRoot = chatRoot;
        if (chatRoot) {
            focusObserver.observe(chatRoot, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['data-dc-seg', 'color'],
            });
        }
        queueFocusSync();
    };
    const rootObserver = new MutationObserver(observeChatRoot);
    if (document.body) rootObserver.observe(document.body, { childList: true, subtree: true });
    observeChatRoot();

    document.addEventListener('change', e => {
        if (getEventElement(e.target)?.id === 'dc-right-click') syncManagedDialogueTabStops();
    });
    let previousFocusMode = `${settings.enableRightClick}:${isDomEngine()}`;
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        const nextFocusMode = `${settings.enableRightClick}:${isDomEngine()}`;
        if (!settings.enableRightClick) finishTouchGesture();
        if (nextFocusMode === previousFocusMode) return;
        previousFocusMode = nextFocusMode;
        queueFocusSync();
    });
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(observeChatRoot, 0));

    document.addEventListener('keydown', e => {
        const focusedTarget = getEventElement(e.target);
        if (settings.enableRightClick && focusedTarget?.getAttribute?.(CONTEXT_FOCUS_ATTRIBUTE) === 'tabindex'
            && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            const targets = getMessageDialogueTargets(focusedTarget.closest('.mes_text'));
            const currentIndex = targets.indexOf(focusedTarget);
            if (currentIndex >= 0 && targets.length > 1) {
                e.preventDefault();
                const offset = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
                const nextTarget = targets[(currentIndex + offset + targets.length) % targets.length];
                targets.forEach(element => {
                    if (element.getAttribute(CONTEXT_FOCUS_ATTRIBUTE) === 'tabindex') element.setAttribute('tabindex', element === nextTarget ? '0' : '-1');
                });
                nextTarget.focus({ preventScroll: true });
                return;
            }
        }
        const opensContextMenu = e.key === 'ContextMenu'
            || e.code === 'ContextMenu'
            || (e.shiftKey && e.key === 'F10');
        if (!opensContextMenu || e.repeat || !settings.enableRightClick) return;

        syncManagedDialogueTabStops();
        const assignmentTarget = resolveDialogueAssignmentTarget(e.target);
        if (!assignmentTarget) return;
        showMenu(e, assignmentTarget.fontTag, assignmentTarget.qElement);
    });

    document.addEventListener('contextmenu', e => {
        if (!settings.enableRightClick) return;
        const eventElement = getEventElement(e.target);
        if (suppressedContextTarget && Date.now() <= suppressContextUntil
            && (suppressedContextTarget === eventElement || suppressedContextTarget.contains(eventElement))) {
            e.preventDefault();
            suppressedContextTarget = null;
            suppressContextUntil = 0;
            return;
        }
        suppressedContextTarget = null;
        suppressContextUntil = 0;

        const mesText = eventElement?.closest('.mes_text');
        if (!mesText) return;
        if (isDomEngine()) {
            const assignmentTarget = resolveDialogueAssignmentTarget(eventElement);
            if (assignmentTarget) showMenu(e, assignmentTarget.fontTag, assignmentTarget.qElement);
            return;
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && mesText.contains(sel.anchorNode) && mesText.contains(sel.focusNode)) {
            const range = sel.getRangeAt(0).cloneRange();
            const selectedText = sel.toString();
            if (selectedText.trim() && mesText.closest('.mes')) {
                showSelectionMenu(e, sel, range, selectedText, mesText.closest('.mes'));
                return;
            }
        }
        const assignmentTarget = resolveDialogueAssignmentTarget(eventElement);
        if (assignmentTarget) showMenu(e, assignmentTarget.fontTag, assignmentTarget.qElement);
    });

    document.addEventListener('touchstart', e => {
        finishTouchGesture();
        if (!settings.enableRightClick) return;
        if (e.touches.length !== 1) return;
        const assignmentTarget = resolveDialogueAssignmentTarget(e.target);
        if (!assignmentTarget) return;

        const touch = e.touches[0];
        const press = {
            ...assignmentTarget,
            clientX: touch.clientX,
            clientY: touch.clientY,
            startX: touch.clientX,
            startY: touch.clientY,
            cancelled: false,
            timer: null,
        };
        press.timer = setTimeout(() => {
            if (longPressState !== press || press.cancelled || !press.targetEl.isConnected || !settings.enableRightClick) {
                finishTouchGesture();
                return;
            }
            consumeTouchEnd = true;
            suppressedContextTarget = press.targetEl;
            suppressContextUntil = Date.now() + 1200;
            showMenu({ type: 'longpress', clientX: press.clientX, clientY: press.clientY }, press.fontTag, press.qElement);
        }, 500);
        longPressState = press;
        attachActiveTouchListeners();
    }, { passive: true });
}

/**
 * Computes the character offset of a range's start boundary within rootEl's
 * rendered textContent. Must be called BEFORE any DOM mutation of the range.
 */

export function getRenderedCharOffset(rootEl, range) {
    if (!rootEl || !range || !rootEl.contains?.(range.startContainer)) return -1;
    try {
        const prefix = document.createRange();
        prefix.selectNodeContents(rootEl);
        prefix.setEnd(range.startContainer, range.startOffset);
        return prefix.toString().length;
    } catch (_) {
        // Fall through for older hosts with incomplete Range support.
    }
    let charOffset = 0;
    const tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while ((textNode = tw.nextNode()) !== null) {
        if (textNode === range.startContainer) {
            return charOffset + range.startOffset;
        }
        charOffset += textNode.textContent.length;
    }
    return -1;
}

function getRenderedTextForRange(range) {
    if (!range || typeof window === 'undefined' || typeof window.getSelection !== 'function') return range?.toString?.() || '';
    const selection = window.getSelection();
    if (!selection) return range.toString();
    const savedRanges = [];
    for (let index = 0; index < selection.rangeCount; index++) savedRanges.push(selection.getRangeAt(index).cloneRange());
    try {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
        return selection.toString();
    } catch (_) {
        return range.toString();
    } finally {
        selection.removeAllRanges();
        for (const savedRange of savedRanges) {
            try {
                selection.addRange(savedRange);
            } catch (_) {
                break;
            }
        }
    }
}

function overlapsSourceRange(start, end, matchStart, matchEnd) {
    return start < matchEnd && end > matchStart;
}

function mergeSourceRanges(ranges) {
    const sorted = ranges
        .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
    }
    return merged;
}

function overlapsAnySourceRange(ranges, start, end) {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (ranges[middle].end <= start) low = middle + 1;
        else high = middle;
    }
    const range = ranges[low];
    return !!range && overlapsSourceRange(start, end, range.start, range.end);
}

function collectRawHtmlRanges(rawText) {
    const ranges = [];
    for (let index = 0; index < rawText.length; index++) {
        if (rawText[index] !== '<') continue;
        if (rawText.startsWith('<!--', index)) {
            const close = rawText.indexOf('-->', index + 4);
            const end = close < 0 ? rawText.length : close + 3;
            ranges.push({ start: index, end });
            index = end - 1;
            continue;
        }
        if (!/[A-Za-z!/?]/.test(rawText[index + 1] || '')) continue;
        let quote = '';
        let end = index + 1;
        for (; end < rawText.length; end++) {
            const character = rawText[end];
            if (quote) {
                if (character === quote) quote = '';
                continue;
            }
            if (character === '"' || character === "'") quote = character;
            else if (character === '>') { end++; break; }
        }
        ranges.push({ start: index, end: Math.min(end, rawText.length) });
        index = Math.max(index, end - 1);
    }
    const rawElementPattern = /<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    let rawElement;
    while ((rawElement = rawElementPattern.exec(rawText)) !== null) {
        ranges.push({ start: rawElement.index, end: rawElement.index + rawElement[0].length });
    }
    return ranges;
}

function collectMarkdownDestinationRanges(rawText) {
    const ranges = [];
    const definition = /^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*(?:\r?\n|$)/gm;
    let match;
    while ((match = definition.exec(rawText)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    const referenceDestination = /\[[^\]\r\n]+\](\[[^\]\r\n]*\])/g;
    while ((match = referenceDestination.exec(rawText)) !== null) {
        const destinationStart = match.index + match[0].length - match[1].length;
        ranges.push({ start: destinationStart, end: match.index + match[0].length });
    }
    const findOpeningBracket = closeIndex => {
        const lineStart = Math.max(rawText.lastIndexOf('\n', closeIndex), rawText.lastIndexOf('\r', closeIndex)) + 1;
        let depth = 1;
        for (let cursor = closeIndex - 1; cursor >= lineStart; cursor--) {
            if (isEscapedSourceCharacter(rawText, cursor)) continue;
            if (rawText[cursor] === ']') depth++;
            else if (rawText[cursor] === '[' && --depth === 0) return cursor;
        }
        return -1;
    };
    for (let index = 0; index < rawText.length - 1; index++) {
        if (rawText[index] !== ']' || rawText[index + 1] !== '(') continue;
        if (findOpeningBracket(index) < 0) continue;
        let depth = 1;
        let end = index + 2;
        let escaped = false;
        for (; end < rawText.length; end++) {
            const character = rawText[end];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === '\\') {
                escaped = true;
                continue;
            }
            if (character === '(') depth++;
            else if (character === ')' && --depth === 0) { end++; break; }
            else if ((character === '\r' || character === '\n') && depth > 0) break;
        }
        ranges.push({ start: index, end: Math.min(end, rawText.length) });
        index = Math.max(index, end - 1);
    }
    const image = /!\[[^\]\r\n]*\](?:\([^\r\n)]*\)|\[[^\]\r\n]*\])/g;
    while ((match = image.exec(rawText)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
}

function isEscapedSourceCharacter(rawText, index) {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && rawText[cursor] === '\\'; cursor--) backslashes++;
    return backslashes % 2 === 1;
}

function collectMarkdownMarkerRanges(rawText, excludedRanges = []) {
    const ranges = [];
    const linkedLabel = /\[([^\]\r\n]+)\](?=\(|\[[^\]\r\n]*\])/g;
    let match;
    while ((match = linkedLabel.exec(rawText)) !== null) {
        ranges.push({ start: match.index, end: match.index + 1 });
        ranges.push({ start: match.index + match[0].length - 1, end: match.index + match[0].length });
    }
    const openings = new Map();
    for (let index = 0; index < rawText.length; index++) {
        const character = rawText[index];
        if (character === '\r' || character === '\n') {
            openings.clear();
            continue;
        }
        if (character !== '*' && character !== '_' && character !== '~') continue;
        let end = index + 1;
        while (rawText[end] === character) end++;
        if (isEscapedSourceCharacter(rawText, index)
            || overlapsAnySourceRange(excludedRanges, index, end)) {
            openings.clear();
            index = end - 1;
            continue;
        }
        const length = end - index;
        const marker = character === '~'
            ? length === 2 ? '~~' : ''
            : length <= 3 ? character.repeat(length) : '';
        if (!marker) {
            index = end - 1;
            continue;
        }
        const opening = openings.get(marker);
        if (opening && index > opening.end && !/\s/.test(rawText[index - 1])) {
            if (character === '_') {
                const before = rawText[opening.start - 1] || '';
                const after = rawText[end] || '';
                if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) {
                    index = end - 1;
                    continue;
                }
            }
            ranges.push({ start: opening.start, end: opening.end });
            ranges.push({ start: index, end });
            openings.delete(marker);
        } else if (!/\s/.test(rawText[end] || '')) {
            openings.set(marker, { start: index, end });
        }
        index = end - 1;
    }
    return ranges;
}

function collectMarkdownCodeSyntax(rawText) {
    const unsafe = [];
    const nonVisible = [];
    const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
    let opening;
    while ((opening = fencePattern.exec(rawText)) !== null) {
        const marker = opening[1];
        let end = rawText.length;
        let closingRange = null;
        let closing;
        while ((closing = fencePattern.exec(rawText)) !== null) {
            if (closing[1][0] !== marker[0] || closing[1].length < marker.length) continue;
            end = closing.index + closing[0].length;
            closingRange = { start: closing.index, end };
            break;
        }
        unsafe.push({ start: opening.index, end });
        nonVisible.push({ start: opening.index, end: opening.index + opening[0].length });
        if (closingRange) nonVisible.push(closingRange);
        fencePattern.lastIndex = end;
    }
    const fencedRanges = mergeSourceRanges(unsafe);
    const backticks = /`+/g;
    let inlineOpening = null;
    let match;
    while ((match = backticks.exec(rawText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (overlapsAnySourceRange(fencedRanges, start, end)) continue;
        if (!inlineOpening) {
            inlineOpening = match;
            continue;
        }
        if (inlineOpening[0].length !== match[0].length) continue;
        unsafe.push({ start: inlineOpening.index, end });
        nonVisible.push({ start: inlineOpening.index, end: inlineOpening.index + inlineOpening[0].length });
        nonVisible.push({ start, end });
        inlineOpening = null;
    }
    const indentedCode = /^(?: {4}|\t)[^\r\n]*(?:\r?\n|$)/gm;
    while ((match = indentedCode.exec(rawText)) !== null) {
        const end = match.index + match[0].length;
        if (overlapsAnySourceRange(fencedRanges, match.index, end)) continue;
        unsafe.push({ start: match.index, end });
        nonVisible.push({ start: match.index, end: match.index + (match[0][0] === '\t' ? 1 : 4) });
    }
    return {
        unsafe: mergeSourceRanges(unsafe),
        nonVisible: mergeSourceRanges(nonVisible),
    };
}

function getRawSelectionSyntax(rawText) {
    const code = collectMarkdownCodeSyntax(rawText);
    const outsideCode = ranges => ranges.filter(range => !overlapsAnySourceRange(code.unsafe, range.start, range.end));
    const html = outsideCode(collectRawHtmlRanges(rawText));
    const destinations = outsideCode(collectMarkdownDestinationRanges(rawText));
    const markers = outsideCode(collectMarkdownMarkerRanges(rawText, code.unsafe));
    const entities = [];
    let hasUnknownEntity = false;
    const entityPattern = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/gi;
    let entity;
    while ((entity = entityPattern.exec(rawText)) !== null) {
        const range = { start: entity.index, end: entity.index + entity[0].length, text: decodeHtmlEntityToken(entity[0]) };
        if (!range.text) hasUnknownEntity = true;
        if (!overlapsAnySourceRange(code.unsafe, range.start, range.end)) entities.push(range);
    }
    const escapedSyntax = [];
    const escapeIntroducers = [];
    const escapePattern = /\\[^\r\n]/g;
    let escaped;
    while ((escaped = escapePattern.exec(rawText)) !== null) {
        const range = { start: escaped.index, end: escaped.index + escaped[0].length };
        if (overlapsAnySourceRange(code.unsafe, range.start, range.end)) continue;
        escapedSyntax.push(range);
        escapeIntroducers.push({ start: escaped.index, end: escaped.index + 1 });
    }
    return {
        nonVisible: mergeSourceRanges([
            ...html,
            ...destinations,
            ...markers,
            ...escapeIntroducers,
            ...code.nonVisible,
        ]),
        unsafe: mergeSourceRanges([...html, ...destinations, ...markers, ...entities, ...escapedSyntax, ...code.unsafe]),
        visibleReplacements: entities.filter(range => range.text),
        unsupportedProjection: hasUnknownEntity
            || /!\[/.test(rawText)
            || /<(?:[a-z][a-z\d+.-]*:[^>\r\n]+|[^<>\s@]+@[^<>\s@]+)>/i.test(rawText),
    };
}

function decodeHtmlEntityToken(token) {
    const body = String(token ?? '').slice(1, -1);
    if (/^#\d+$/.test(body)) {
        const codePoint = Number(body.slice(1));
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
            && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            && !(codePoint >= 0x80 && codePoint <= 0x9f)
            ? String.fromCodePoint(codePoint)
            : '';
    }
    if (/^#x[\da-f]+$/i.test(body)) {
        const codePoint = Number.parseInt(body.slice(2), 16);
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
            && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            && !(codePoint >= 0x80 && codePoint <= 0x9f)
            ? String.fromCodePoint(codePoint)
            : '';
    }
    const known = ({ amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' })[body.toLowerCase()];
    if (known) return known;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = token;
        return textarea.value !== token ? textarea.value : '';
    }
    return '';
}

function getOverlappingOccurrenceOrdinal(text, selection, offset) {
    if (!Number.isInteger(offset) || offset < 0 || text.slice(offset, offset + selection.length) !== selection) return -1;
    let ordinal = 0;
    let searchStart = 0;
    while (searchStart <= offset) {
        const occurrence = text.indexOf(selection, searchStart);
        if (occurrence < 0 || occurrence > offset) return -1;
        if (occurrence === offset) return ordinal;
        ordinal++;
        searchStart = occurrence + 1;
    }
    return -1;
}

function getVisibleSourceOccurrenceSpans(rawText, sourceSelection, syntax) {
    const projection = [];
    const sourceMap = [];
    const nonVisible = syntax.nonVisible || [];
    const replacements = [...(syntax.visibleReplacements || [])].sort((left, right) => left.start - right.start);
    let hiddenIndex = 0;
    let replacementIndex = 0;
    for (let cursor = 0; cursor < rawText.length;) {
        while (hiddenIndex < nonVisible.length && nonVisible[hiddenIndex].end <= cursor) hiddenIndex++;
        while (replacementIndex < replacements.length && replacements[replacementIndex].end <= cursor) replacementIndex++;
        const replacement = replacements[replacementIndex];
        if (replacement?.start === cursor) {
            for (let index = 0; index < replacement.text.length; index++) {
                projection.push(replacement.text[index]);
                sourceMap.push({ start: replacement.start, end: replacement.end });
            }
            cursor = replacement.end;
            continue;
        }
        const hidden = nonVisible[hiddenIndex];
        if (hidden && cursor >= hidden.start && cursor < hidden.end) {
            cursor = hidden.end;
            continue;
        }
        projection.push(rawText[cursor]);
        sourceMap.push({ start: cursor, end: cursor + 1 });
        cursor++;
    }
    const visibleText = projection.join('');
    const spans = [];
    let searchStart = 0;
    while (searchStart <= visibleText.length - sourceSelection.length) {
        const start = visibleText.indexOf(sourceSelection, searchStart);
        if (start < 0) break;
        const end = start + sourceSelection.length;
        const first = sourceMap[start];
        const last = sourceMap[end - 1];
        if (first && last) spans.push({ start: first.start, end: last.end });
        searchStart = start + 1;
    }
    return spans;
}

/** Resolve one rendered selection to the corresponding exact source substring. */
export function mapRenderedSelectionToSourceSpan(rawValue, renderedValue, selectedValue, renderedStartOffset) {
    const rawText = String(rawValue ?? '');
    const renderedText = String(renderedValue ?? '');
    const sourceSelection = String(selectedValue ?? '');
    if (!rawText || !sourceSelection) return null;
    const ordinal = getOverlappingOccurrenceOrdinal(renderedText, sourceSelection, renderedStartOffset);
    if (ordinal < 0) return null;
    const syntax = getRawSelectionSyntax(rawText);
    if (syntax.unsupportedProjection) return null;
    const span = getVisibleSourceOccurrenceSpans(rawText, sourceSelection, syntax)[ordinal];
    if (!span || rawText.slice(span.start, span.end) !== sourceSelection
        || overlapsAnySourceRange(syntax.unsafe, span.start, span.end)) return null;
    return span;
}

export function getRenderedOccurrenceOrdinal(rootEl, range, selectedText) {
    const selection = String(selectedText ?? '');
    if (!selection || !rootEl?.contains?.(range?.startContainer) || !rootEl.contains(range.endContainer)) return -1;
    const renderedSelection = getRenderedTextForRange(range);
    if (renderedSelection !== selection) return -1;
    const offset = getRenderedCharOffset(rootEl, range);
    const renderedText = rootEl?.textContent || '';
    return getOverlappingOccurrenceOrdinal(renderedText, selection, offset);
}

/**
 * Wraps the rendered occurrence that maps to exact source text. Raw HTML,
 * entities, code, and link destinations fail closed rather than being moved
 * into newly active markup.
 */
export function replaceMessageSelectionWithFontTag(msg, selectedText, hexColor, mapping = {}) {
    const rawText = typeof msg?.mes === 'string' ? msg.mes : '';
    const sourceSelection = String(selectedText ?? '');
    const normalizedColor = normalizeHexColor(hexColor, null);
    if (!sourceSelection || !sourceSelection.trim() || !rawText || !normalizedColor) return false;

    const syntax = getRawSelectionSyntax(rawText);
    if (syntax.unsupportedProjection) return false;
    const spans = getVisibleSourceOccurrenceSpans(rawText, sourceSelection, syntax);
    const requestedStart = Number.isInteger(mapping?.sourceStart) ? mapping.sourceStart : null;
    const requestedEnd = Number.isInteger(mapping?.sourceEnd) ? mapping.sourceEnd : null;
    const requestedOrdinal = Number.isInteger(mapping?.occurrenceOrdinal) && mapping.occurrenceOrdinal >= 0
        ? mapping.occurrenceOrdinal
        : null;
    let span = null;
    if (requestedStart !== null) {
        span = spans.find(candidate => candidate.start === requestedStart
            && (requestedEnd === null || candidate.end === requestedEnd)) || null;
    } else if (typeof mapping?.renderedText === 'string' && Number.isInteger(mapping?.renderedStartOffset)) {
        span = mapRenderedSelectionToSourceSpan(
            rawText,
            mapping.renderedText,
            sourceSelection,
            mapping.renderedStartOffset,
        );
    } else if (requestedOrdinal !== null) {
        span = spans[requestedOrdinal] || null;
    } else if (spans.length === 1) {
        [span] = spans;
    }
    if (!span) return false;
    const { start, end } = span;
    const exactSourceText = rawText.slice(start, end);
    if (exactSourceText !== sourceSelection || overlapsAnySourceRange(syntax.unsafe, start, end)) return false;

    msg.mes = `${rawText.slice(0, start)}<font color="${normalizedColor}">${escapeHtml(exactSourceText)}</font>${rawText.slice(end)}`;
    return true;
}

export function wrapQElementWithFontTag(qElement, color) {
    const msgIndex = getMessageIndexFromElement(qElement);
    if (msgIndex === -1) return false;

    const ctx = getContext();
    const chat = ctx?.chat || [];
    const msg = chat[msgIndex];
    if (!msg || msg.is_user) return false;

    const newHex = normalizeHexColor(color);
    if (!newHex) return false;

    const mesEl = qElement.closest('.mes');
    if (!mesEl) return false;
    const mesText = mesEl.querySelector('.mes_text');
    if (!mesText) return false;

    // Re-run attribution to get precise source offsets for each quote/emphasis segment.
    // This avoids the fragile converter.makeMarkdown round-trip used previously.
    const attribution = attributeDialogueSegments(msg.mes, msg.name);
    const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
    const qElements = Array.from(mesText.querySelectorAll('q'));

    let targetSegment = null;
    matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), (seg, el) => {
        if (el === qElement) targetSegment = seg;
    });

    if (!targetSegment) return false;

    // Splice using exact source offsets — no regex, no HTML serialization.
    msg.mes = `${msg.mes.slice(0, targetSegment.start)}<font color="${newHex}">${msg.mes.slice(targetSegment.start, targetSegment.end)}</font>${msg.mes.slice(targetSegment.end)}`;

    // Re-render the full message block canonically.
    refreshMessageDom(msgIndex, msg);
    return true;
}

export function updateMessageTextForFontTag(fontTag, oldColor, newColor) {
    const msgIndex = getMessageIndexFromElement(fontTag);
    if (msgIndex === -1) return false;

    const ctx = getContext();
    const chat = ctx?.chat || [];
    const msg = chat[msgIndex];
    if (!msg || msg.is_user) return false;

    const oldHex = normalizeHexColor(oldColor, null);
    const newHex = normalizeHexColor(newColor, null);
    if (!oldHex || !newHex || oldHex === newHex) return false;

    const { updatedText: updated } = updateTextColorReferences(msg.mes, { [oldHex]: newHex });

    if (updated !== msg.mes) {
        msg.mes = updated;
        return true;
    }
    return false;
}
