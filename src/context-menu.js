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
            const focusTarget = opener?.isConnected
                ? opener
                : openerMessageId
                    ? [...document.querySelectorAll(`#chat .mes[mesid="${CSS.escape(openerMessageId)}"] ${getManagedDialogueSelector()}`)]
                        .filter(element => element.hasAttribute(CONTEXT_FOCUS_ATTRIBUTE))[Math.max(0, openerSegmentIndex)]
                        || document.querySelector(`#chat .mes[mesid="${CSS.escape(openerMessageId)}"] [${CONTEXT_FOCUS_ATTRIBUTE}][tabindex="0"]`)
                    : null;
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

    // Build character list for datalist
    const charList = getSortedEntries()
        .map(([k, v]) => ({ key: k, name: v.name }));
    const datalistOptions = charList.map(c => `<option value="${escapeAttr(c.name)}">`).join('');

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
            if (existingColorChanged) {
                applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
            }

            // Persist the character table before any best-effort DOM/UI work.
            // A detached or temporarily unready render must not roll back a
            // valid semantic assignment.
            commit({ inject: false, updateList: false, legend: false });
            assignmentPersisted = true;

            let refreshPending = false;
            try {
                commit({ history: false, data: false });
            } catch (error) {
                refreshPending = true;
                console.warn('[Dialogue Colors] Assignment saved, but panel refresh failed:', error);
            }
            try {
                scheduleCustomFontRefresh(0);
            } catch (error) {
                refreshPending = true;
                console.warn('[Dialogue Colors] Assignment saved, but font refresh failed:', error);
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

    const charList = getSortedEntries()
        .map(([k, v]) => ({ key: k, name: v.name }));
    const datalistOptions = charList.map(c => `<option value="${escapeAttr(c.name)}">`).join('');

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

        // Validate and measure the saved range before changing character state.
        // Streaming can replace the message while this dialog is open.
        const mesTextEl = mesEl.querySelector('.mes_text');
        if (!range.startContainer?.isConnected
            || !mesTextEl?.contains(range.startContainer)
            || !mesTextEl?.contains(range.endContainer)) {
            toast.error('Selection is no longer valid — the message was re-rendered. Please re-select the text.');
            closeMenu();
            return;
        }
        const renderedCharOffset = getRenderedCharOffset(mesTextEl, range);
        const renderedLen = mesTextEl.textContent.length;

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

        try {
            const fontNode = document.createElement('font');
            fontNode.setAttribute('color', finalColor);
            range.surroundContents(fontNode);
        } catch (wrapErr) {
            const fontNode = document.createElement('font');
            fontNode.setAttribute('color', finalColor);
            try {
                const fragment = range.extractContents();
                fontNode.appendChild(fragment);
                range.insertNode(fontNode);
            } catch (fallbackErr) {
                toast.error('Could not wrap selection');
                closeMenu();
                return;
            }
        }

        selection.removeAllRanges();

        const textUpdated = replaceMessageSelectionWithFontTag(msg, selectedText, finalColor, renderedCharOffset, renderedLen);
        if (textUpdated) {
            characterColors[key] = nextEntry;
            if (existingColorChanged) {
                applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
            }
            queueChatSave();
            flushChatSave();
            commit();
            toast.success(`Assigned to ${escapeHtml(name)}`);
        } else {
            // The rendered selection was not found verbatim in msg.mes (markdown
            // constructs consumed). Re-render to undo the visual wrap rather than
            // report a success that would silently vanish on the next render.
            toast.error('Could not locate the selection in the message source — nothing was colored.');
            refreshMessageDom(msgIndex, msg);
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

    const cancelLongPress = () => {
        if (!longPressState) return;
        longPressState.cancelled = true;
        clearTimeout(longPressState.timer);
        longPressState = null;
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
            const range = sel.getRangeAt(0);
            const selectedText = sel.toString().trim();
            if (selectedText && mesText.closest('.mes')) {
                showSelectionMenu(e, sel, range, selectedText, mesText.closest('.mes'));
                return;
            }
        }
        const assignmentTarget = resolveDialogueAssignmentTarget(eventElement);
        if (assignmentTarget) showMenu(e, assignmentTarget.fontTag, assignmentTarget.qElement);
    });

    document.addEventListener('touchstart', e => {
        cancelLongPress();
        consumeTouchEnd = false;
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
            if (longPressState !== press || press.cancelled || !press.targetEl.isConnected || !settings.enableRightClick) return;
            consumeTouchEnd = true;
            suppressedContextTarget = press.targetEl;
            suppressContextUntil = Date.now() + 1200;
            showMenu({ type: 'longpress', clientX: press.clientX, clientY: press.clientY }, press.fontTag, press.qElement);
        }, 500);
        longPressState = press;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (consumeTouchEnd) e.preventDefault();
        if (!longPressState || e.touches.length !== 1) { cancelLongPress(); return; }
        const touch = e.touches[0];
        if (Math.hypot(touch.clientX - longPressState.startX, touch.clientY - longPressState.startY) > 10) cancelLongPress();
    }, { passive: false });
    document.addEventListener('touchend', e => {
        if (consumeTouchEnd) e.preventDefault();
        cancelLongPress();
        consumeTouchEnd = false;
    }, { passive: false });
    document.addEventListener('touchcancel', () => {
        cancelLongPress();
        consumeTouchEnd = false;
    });
}

/**
 * Computes the character offset of a range's start boundary within rootEl's
 * rendered textContent. Must be called BEFORE any DOM mutation of the range.
 */

export function getRenderedCharOffset(rootEl, range) {
    if (!rootEl || !range) return 0;
    let charOffset = 0;
    const tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    let textNode;
    while ((textNode = tw.nextNode()) !== null) {
        if (textNode === range.startContainer) {
            return charOffset + range.startOffset;
        }
        charOffset += textNode.textContent.length;
    }
    return charOffset;
}

/**
 * Replaces a text selection in msg.mes with a <font color> tag.
 *
 * The rendered text differs from msg.mes (markdown syntax chars are consumed),
 * so we cannot reliably use a first-match replace. Instead we map the rendered
 * selection offset proportionally onto msg.mes, then choose the occurrence of
 * selectedText closest to that approximate source offset.
 *
 * renderedCharOffset / renderedLen must be captured BEFORE the DOM is mutated.
 * Returns true when msg.mes was modified.
 */

export function replaceMessageSelectionWithFontTag(msg, selectedText, hexColor, renderedCharOffset, renderedLen) {
    if (!selectedText || !msg?.mes) return false;

    const rawLen = msg.mes.length;
    const approxRawOffset = renderedLen > 0 ? Math.floor((renderedCharOffset / renderedLen) * rawLen) : 0;

    // Collect all occurrences of selectedText in msg.mes.
    const occurrences = [];
    let searchStart = 0;
    while (true) {
        const idx = msg.mes.indexOf(selectedText, searchStart);
        if (idx === -1) break;
        occurrences.push(idx);
        searchStart = idx + 1;
    }
    if (!occurrences.length) return false;

    // Pick the occurrence whose start is closest to approxRawOffset.
    const bestIdx = occurrences.reduce((best, idx) =>
        Math.abs(idx - approxRawOffset) < Math.abs(best - approxRawOffset) ? idx : best,
    occurrences[0]);

    msg.mes = `${msg.mes.slice(0, bestIdx)}<font color="${hexColor}">${selectedText}</font>${msg.mes.slice(bestIdx + selectedText.length)}`;
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
