// context-menu.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments } from './attribution.js';
import { cancelMessageDomFollowupRepairs, clearMessageDomRepairTimer, clearStreamingAttributionOverrides, decorateMessageDomFromCurrentRender, getMessageIndexFromElement, markMessageAttributionVerified, matchSegmentsToElements, refreshMessageDom, resolveDomSegmentIndexForElement, scheduleMessageDomFollowupRepair, setMessageQuoteOverride } from './dom-engine.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, flushChatSave, queueChatSave, updateTextColorReferences, updateVisibleMessageColors } from './live-colors.js';
import { buildCharacterEntry, getEntryEffectiveColor, setEntryFromEffectiveColor } from './palettes.js';
import { escapeHtml, getContext, power_user } from './st-api.js';
import { characterColors, isDomEngine, runtimeState, settings } from './state.js';
import { getSortedEntries, updateLegend } from './ui.js';
import { escapeAttr, normalizeHexColor, normalizeSegmentText, toast } from './utils.js';

// Right-click and long-press context menu for messages
function showMenu(e, fontTag, qElement = null) {
    e.preventDefault();
    const existingMenu = document.getElementById('dc-context-menu');
    if (existingMenu) existingMenu.remove();
    const isDomSegment = isDomEngine() && !fontTag && !!qElement;
    const isBareQuote = !isDomSegment && !fontTag && !!qElement;
    const targetEl = (isDomSegment || isBareQuote) ? qElement : fontTag;
    const domSpeakerKey = isDomSegment ? targetEl.getAttribute('data-dc-speaker') : '';
    const domSpeakerColor = domSpeakerKey && characterColors[domSpeakerKey] ? getEntryEffectiveColor(characterColors[domSpeakerKey]) : null;
    const quoteFallbackColor = normalizeHexColor(power_user.quote_text_color, '#888888');
    const color = isDomSegment
        ? normalizeHexColor(domSpeakerColor, quoteFallbackColor)
        : isBareQuote ? quoteFallbackColor : normalizeHexColor(fontTag.getAttribute('color'));
    const text = targetEl.textContent.substring(0, 30) + (targetEl.textContent.length > 30 ? '...' : '');

    // Build character list for datalist
    const charList = getSortedEntries()
        .map(([k, v]) => ({ key: k, name: v.name }));
    const datalistOptions = charList.map(c => `<option value="${escapeAttr(c.name)}">`).join('');

    const menu = document.createElement('div');
    menu.id = 'dc-context-menu';
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 100;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 100;
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    menu.innerHTML = `
        <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">${isDomSegment ? '<em style="font-size:0.9em;">(DOM override)</em><br>' : isBareQuote ? '<em style="font-size:0.9em;">(uncolored quote)</em><br>' : ''}"${escapeHtml(text)}"</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
            <input type="color" id="dc-ctx-color" value="${color}" style="width:24px;height:20px;border:none;">
            <input type="text" id="dc-ctx-name" list="dc-ctx-chars" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
            <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
        </div>
        <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign to Character</button>
        <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
    `;
    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
    if (menuRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
    menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();

    const nameInput = menu.querySelector('#dc-ctx-name');
    const colorInput = menu.querySelector('#dc-ctx-color');
    if (isDomSegment && domSpeakerKey && characterColors[domSpeakerKey]) {
        nameInput.value = characterColors[domSpeakerKey].name;
    }

    nameInput.addEventListener('input', () => {
        const name = nameInput.value.trim();
        const key = name.toLowerCase();
        if (characterColors[key]) {
            const existingColor = getEntryEffectiveColor(characterColors[key]);
            colorInput.value = existingColor;
        }
    });

    menu.querySelector('#dc-ctx-assign').onclick = async () => {
        const nameInput = menu.querySelector('#dc-ctx-name');
        const colorInput = menu.querySelector('#dc-ctx-color');
        const name = nameInput.value.trim();
        const pickerColor = normalizeHexColor(colorInput.value, color);
        if (name) {
            const key = name.toLowerCase();
            let finalColor = pickerColor;
            let textUpdated = false;
            let existingColorChanged = false;
            const existingSnapshot = characterColors[key]
                ? captureEffectiveColorSnapshot(Object.keys(characterColors))
                : null;
            const originalFontColor = fontTag
                ? normalizeHexColor(fontTag.getAttribute('color'), null)
                : null;

            if (characterColors[key]) {
                const existingColor = getEntryEffectiveColor(characterColors[key]);
                if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                    setEntryFromEffectiveColor(characterColors[key], pickerColor);
                    existingColorChanged = true;
                }
                finalColor = getEntryEffectiveColor(characterColors[key]);
            } else {
                const built = buildCharacterEntry(name, {
                    color: pickerColor,
                    colorMode: 'effective',
                    locked: false,
                    dialogueCount: 1
                });
                if (!built.entry) return;
                characterColors[key] = built.entry;
            }

            if (existingColorChanged) {
                applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
            }

            if (isDomSegment) {
                const mesIndex = getMessageIndexFromElement(targetEl);
                const ctx = getContext();
                const msg = ctx?.chat?.[mesIndex];
                const segmentIndex = resolveDomSegmentIndexForElement(targetEl, mesIndex, msg);
                if (!msg || !Number.isFinite(segmentIndex)) {
                    toast.error('Could not map this dialogue segment.');
                    menu.remove();
                    return;
                }
                if (!setMessageQuoteOverride(mesIndex, msg, segmentIndex, name, { source: 'manual' })) {
                    toast.error('Could not save quote override.');
                    menu.remove();
                    return;
                }
                clearMessageDomRepairTimer(mesIndex);
                cancelMessageDomFollowupRepairs(mesIndex);
                markMessageAttributionVerified(mesIndex, msg);
                clearStreamingAttributionOverrides(mesIndex);
                // Override-only change: the visible DOM is already rendered by
                // SillyTavern, so decorate in place without an innerHTML fallback
                // write (which would trigger an observer re-decoration cascade).
                const repainted = await decorateMessageDomFromCurrentRender(mesIndex, msg, { queueVerification: false, renderFallback: false });
                scheduleMessageDomFollowupRepair(mesIndex, repainted);
            } else if (isBareQuote) {
                textUpdated = wrapQElementWithFontTag(qElement, finalColor);
            } else {
                fontTag.setAttribute('color', finalColor);
                textUpdated = updateMessageTextForFontTag(fontTag, originalFontColor, finalColor);
                if (textUpdated) {
                    // updateTextColorReferences rewrites every same-colored span in
                    // msg.mes; sync the rest of the rendered DOM to match right away.
                    updateVisibleMessageColors(mesIndex, { [originalFontColor]: finalColor });
                }
            }

            commit();

            if (isDomSegment) {
                updateLegend();
            } else if (textUpdated) {
                queueChatSave();
                flushChatSave();
            }

            toast.success(`Assigned to ${escapeHtml(name)}`);
        }
        menu.remove();
    };
    const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
    setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
}

function showSelectionMenu(e, selection, range, selectedText, mesEl) {
    e.preventDefault();
    const existingMenu = document.getElementById('dc-context-menu');
    if (existingMenu) existingMenu.remove();

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
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 100;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 100;
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    menu.innerHTML = `
        <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;"><em style="font-size:0.9em;">(selected text)</em><br>"${escapeHtml(preview)}"</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span id="dc-ctx-color-dot" style="width:12px;height:12px;border-radius:50%;background:#888888;"></span>
            <input type="color" id="dc-ctx-color" value="#888888" style="width:24px;height:20px;border:none;">
            <input type="text" id="dc-ctx-name" list="dc-ctx-chars" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
            <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
        </div>
        <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign to Character</button>
        <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
    `;
    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
    if (menuRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
    menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();

    const nameInput = menu.querySelector('#dc-ctx-name');
    const colorInput = menu.querySelector('#dc-ctx-color');
    const colorDot = menu.querySelector('#dc-ctx-color-dot');

    colorInput.addEventListener('input', () => { colorDot.style.background = colorInput.value; });

    nameInput.addEventListener('input', () => {
        const name = nameInput.value.trim();
        const key = name.toLowerCase();
        if (characterColors[key]) {
            const existingColor = getEntryEffectiveColor(characterColors[key]);
            colorInput.value = existingColor;
            colorDot.style.background = existingColor;
        }
    });

    menu.querySelector('#dc-ctx-assign').onclick = () => {
        const name = nameInput.value.trim();
        const pickerColor = normalizeHexColor(colorInput.value, '#888888');
        if (!name) { menu.remove(); return; }

        const key = name.toLowerCase();
        let finalColor = pickerColor;

        const existingSnapshot = characterColors[key]
            ? captureEffectiveColorSnapshot(Object.keys(characterColors))
            : null;

        let existingColorChanged = false;
        if (characterColors[key]) {
            const existingColor = getEntryEffectiveColor(characterColors[key]);
            if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                setEntryFromEffectiveColor(characterColors[key], pickerColor);
                existingColorChanged = true;
            }
            finalColor = getEntryEffectiveColor(characterColors[key]);
        } else {
            const built = buildCharacterEntry(name, {
                color: pickerColor,
                colorMode: 'effective',
                locked: false,
                dialogueCount: 1
            });
            if (!built.entry) { menu.remove(); return; }
            characterColors[key] = built.entry;
        }

        if (existingColorChanged) {
            applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
        }

        // Capture rendered offsets BEFORE mutating the DOM with surroundContents.
        const mesTextEl = mesEl.querySelector('.mes_text');
        // The message may have re-rendered (streaming, MESSAGE_UPDATED, another
        // agent) since the menu opened. A detached or out-of-message range would
        // produce garbage offsets and wrap the wrong occurrence in msg.mes.
        if (!range.startContainer?.isConnected
            || !mesTextEl?.contains(range.startContainer)
            || !mesTextEl?.contains(range.endContainer)) {
            toast.error('Selection is no longer valid — the message was re-rendered. Please re-select the text.');
            menu.remove();
            return;
        }
        const renderedCharOffset = getRenderedCharOffset(mesTextEl, range);
        const renderedLen = mesTextEl ? mesTextEl.textContent.length : 0;

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
                menu.remove();
                return;
            }
        }

        selection.removeAllRanges();

        const textUpdated = replaceMessageSelectionWithFontTag(msg, selectedText, finalColor, renderedCharOffset, renderedLen);
        if (textUpdated) {
            queueChatSave();
            flushChatSave();
            commit();
            toast.success(`Assigned to ${escapeHtml(name)}`);
        } else {
            // The rendered selection was not found verbatim in msg.mes (markdown
            // constructs consumed). Re-render to undo the visual wrap rather than
            // report a success that would silently vanish on the next render.
            commit();
            toast.error('Could not locate the selection in the message source — nothing was colored.');
            refreshMessageDom(msgIndex, msg);
        }
        menu.remove();
    };

    const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
    setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
}

export function setupContextMenu() {
    if (runtimeState.contextMenuSetup) return;
    runtimeState.contextMenuSetup = true;
    let longPressTimer = null;
    let longPressTarget = null;


    document.addEventListener('contextmenu', e => {
        if (!settings.enableRightClick) return;
        const mesText = e.target.closest('.mes_text');
        if (!mesText) return;
        if (isDomEngine()) {
            const segmentEl = e.target.closest('[data-dc-seg], q, em');
            if (segmentEl && mesText.contains(segmentEl) && !segmentEl.closest('font[color]')) {
                showMenu(e, null, segmentEl);
            }
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
        const fontTag = e.target.closest('font[color]');
        if (fontTag) { showMenu(e, fontTag, null); return; }
        const qEl = e.target.closest('q');
        if (qEl && !qEl.closest('font[color]')) { showMenu(e, null, qEl); return; }
    });

    document.addEventListener('touchstart', e => {
        if (!settings.enableRightClick) return;
        const mesText = e.target.closest('.mes_text');
        if (!mesText) return;
        if (isDomEngine()) {
            const segmentEl = e.target.closest('[data-dc-seg], q, em');
            if (segmentEl && mesText.contains(segmentEl) && !segmentEl.closest('font[color]')) {
                longPressTarget = segmentEl;
                longPressTimer = setTimeout(() => showMenu(e, null, segmentEl), 500);
            }
            return;
        }
        const fontTag = e.target.closest('font[color]');
        if (fontTag) {
            longPressTarget = fontTag;
            longPressTimer = setTimeout(() => showMenu(e, fontTag, null), 500);
            return;
        }
        const qEl = e.target.closest('q');
        if (qEl && !qEl.closest('font[color]')) {
            longPressTarget = qEl;
            longPressTimer = setTimeout(() => showMenu(e, null, qEl), 500);
        }
    }, { passive: true });

    document.addEventListener('touchend', () => { clearTimeout(longPressTimer); longPressTimer = null; });
    document.addEventListener('touchmove', () => { clearTimeout(longPressTimer); longPressTimer = null; });
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
