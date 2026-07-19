// ui.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { scanAllMessages } from './color-blocks.js';
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, scheduleDomRefreshSeries, scheduleDomSettleRefresh, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck, undecorateAllMessages } from './dom-engine.js';
import { loadGoogleFont, scheduleCustomFontRefresh } from './fonts.js';
import { createRestoreSnapshot, redo, saveHistory, showUndoToast, undo } from './history.js';
import { applyFastColorUiUpdates, applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, colorizeMessages, commit, flushChatSave, flushColorStateSave, queueColorStateSave, recolorAllMessages, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { registerKeyboardShortcuts } from './main.js';
import { autoResolveConflicts, buildCharacterEntry, buildKeepAwareRemovalMessage, collectDuplicateColorKeys, deleteColorPreset, deleteCustomPalette, detectTheme, flipColorsForTheme, generateCustomPaletteFromWords, getBaseColor, getEntryEffectiveColor, getKeptKeys, getNextColor, invalidateThemeCache, keepCharacterKeysOnly, loadColorPreset, refreshPaletteDropdown, refreshPresetDropdown, regenerateAllColors, removeCharacterKeys, saveColorPreset, saveCustomPalette, setEntryFromBaseColor, setEntryFromEffectiveColor, showHarmonyPopup, suggestColorForName, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt, updateSystemPromptDisplay } from './prompts.js';
import { escapeHtml, getContext } from './st-api.js';
import { autoRecolorHintShown, characterColors, expandedCharacterRows, isDomEngine, legendListeners, searchTerm, setAutoRecolorHintShown, setCharacterColors, setLegendListeners, setSearchTerm, setSwapMode, settings, swapMode } from './state.js';
import { disableAutoSync, enableAutoSync, exportColors, exportSettings, getLegendPosition, getStorageKey, getStorageLabelForKey, getUserColorDataStore, importColors, importSettings, loadData, loadFromCard, normalizeColorDataEntry, normalizeToggleSettings, removeStoredColorData, restoreAllSettingsToDefaults, saveData, saveLegendPosition, saveToCard, updateAutoSyncUI } from './storage.js';
import { escapeAttr, getGoogleFontFamily, htmlToNode, normalizeGoogleFontName, normalizeHexColor, normalizeManualColorInput, toast } from './utils.js';
import { cancelStreamingAttributionVerification, clearAutoAttributionVerificationQueue, queueAutoAttributionVerificationForRenderedMessages, runAttributionVerification, verifyLatestAttributionsWithLLM, verifyVisibleAttributionsWithLLM } from './verify.js';

export const DYNAMIC_CONTROL_HELP_TEXT = Object.freeze({
    '.dc-color-dot': 'Click to open the color picker for this character.',
    '.dc-color-input': 'Pick a color directly. Double-click for harmony suggestions.',
    '.dc-keep': 'Pinned characters survive Clear and bulk delete tools.',
    '.dc-lock': 'Lock this character color so reset/regen tools do not change it.',
    '.dc-more': 'Show less common row tools like alias, group, style, and swap.',
    '.dc-swap': 'Choose two characters in sequence to swap their colors.',
    '.dc-style': 'Cycle style: none, bold, italic, then bold italic.',
    '.dc-alias': 'Add an alternate name that maps to this character.',
    '.dc-group': 'Assign this character to a group label.',
    '.dc-del': 'Delete this character from the list. Turn off Keep first if pinned.',
    '.dc-alias-remove': 'Remove this alias from the character.'
});

// Phase 6B: Group sorting support
export function getSortedEntries() {
    const entries = Object.entries(characterColors).filter(([, v]) => !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase()));
    entries.sort((a, b) => {
        if (!!b[1].keep !== !!a[1].keep) return Number(b[1].keep) - Number(a[1].keep);
        if (settings.sortMode === 'count') return (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0) || a[1].name.localeCompare(b[1].name);
        if (settings.sortMode === 'group') return (a[1].group || '').localeCompare(b[1].group || '') || a[1].name.localeCompare(b[1].name);
        return a[1].name.localeCompare(b[1].name);
    });
    return entries;
}

export function getBadge(count) {
    if (count >= 100) return '💎';
    if (count >= 50) return '⭐';
    return '';
}

// Phase 4A: Theme-aware PNG export

// Extract dominant color from avatar image
export async function extractAvatarColor(imgSrc) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 128) continue;
                r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
            }
            if (count === 0) { resolve(null); return; }
            r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
            resolve(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
        };
        img.onerror = () => resolve(null);
        img.src = imgSrc;
    });
}

// Right-click and long-press context menu for messages

// Phase 4A: Theme-aware PNG export
export function exportLegendPng() {
    const entries = Object.entries(characterColors);
    if (!entries.length) { toast.info('No characters to export'); return; }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const lineHeight = 24, padding = 16, dotSize = 10;
    canvas.width = 300;
    canvas.height = entries.length * lineHeight + padding * 2;
    const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
    ctx.fillStyle = mode === 'dark' ? '#1a1a2e' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    entries.forEach(([, v], i) => {
        const y = padding + i * lineHeight + lineHeight / 2;
        const safeColor = getEntryEffectiveColor(v);
        ctx.beginPath();
        ctx.arc(padding + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = safeColor;
        ctx.fill();
        ctx.fillStyle = safeColor;
        ctx.font = '14px sans-serif';
        ctx.fillText(v.name, padding + dotSize + 8, y + 5);
    });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `dialogue-colors-legend-${Date.now()}.png`;
    a.click();
    toast.success('Legend exported');
}

// Phase 3A: Legend with event listener cleanup
export function createLegend() {
    let legend = document.getElementById('dc-legend-float');
    if (!legend) {
        legend = document.createElement('div');
        legend.id = 'dc-legend-float';

        const savedPos = getLegendPosition();
        const top = Number.isFinite(savedPos.top) ? savedPos.top : 60;
        const left = Number.isFinite(savedPos.left) ? savedPos.left : undefined;
        const right = Number.isFinite(savedPos.right) ? savedPos.right : 10;

        legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;max-height:60vh;overflow-y:auto;display:none;cursor:move;user-select:none;`;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const onMouseDown = (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            isDragging = true;
            const rect = legend.getBoundingClientRect();
            startX = e.clientX ?? e.touches?.[0]?.clientX;
            startY = e.clientY ?? e.touches?.[0]?.clientY;
            if (startX == null || startY == null) return;
            startLeft = rect.left;
            startTop = rect.top;
            legend.style.right = 'auto';
            legend.style.left = startLeft + 'px';
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const clientX = e.clientX ?? e.touches?.[0]?.clientX;
            const clientY = e.clientY ?? e.touches?.[0]?.clientY;
            if (clientX == null || clientY == null) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            let newLeft = startLeft + dx;
            let newTop = startTop + dy;
            const rect = legend.getBoundingClientRect();
            newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));
            legend.style.left = newLeft + 'px';
            legend.style.top = newTop + 'px';
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                const rect = legend.getBoundingClientRect();
                saveLegendPosition({ top: rect.top, left: rect.left });
            }
        };

        // Remove old document-level listeners before adding new ones
        if (legendListeners) {
            document.removeEventListener('mousemove', legendListeners.onMouseMove);
            document.removeEventListener('touchmove', legendListeners.onMouseMove);
            document.removeEventListener('mouseup', legendListeners.onMouseUp);
            document.removeEventListener('touchend', legendListeners.onMouseUp);
        }

        legend.addEventListener('mousedown', onMouseDown);
        legend.addEventListener('touchstart', onMouseDown, { passive: false });
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchend', onMouseUp);

        setLegendListeners({ onMouseMove, onMouseUp });

        document.body.appendChild(legend);
    }
    return legend;
}

export function updateLegend() {
    const legend = createLegend();
    const entries = Object.entries(characterColors);
    if (!entries.length || !settings.showLegend) { legend.style.display = 'none'; return; }
    legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;cursor:grab;">⋮⋮ Characters</div>' +
        entries.map(([, v]) => {
            const safeColor = getEntryEffectiveColor(v);
            const fontFamily = getGoogleFontFamily(v.font);
            if (fontFamily) loadGoogleFont(v.font);
            const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
            return `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${safeColor};"></span><span style="color:${safeColor};${fontStyle}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`;
        }).join('');
    legend.style.display = settings.showLegend ? 'block' : 'none';
}

export function getDialogueStats() {
    const entries = Object.entries(characterColors);
    const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
    return entries.map(([, v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: getEntryEffectiveColor(v), font: normalizeGoogleFontName(v.font) })).sort((a, b) => b.count - a.count);
}

export function showStatsPopup() {
    const stats = getDialogueStats();
    if (!stats.length) { toast.info('No dialogue data'); return; }
    const maxCount = Math.max(...stats.map(s => s.count), 1);
    let html = stats.map(s => {
        const fontFamily = getGoogleFontFamily(s.font);
        if (fontFamily) loadGoogleFont(s.font);
        const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
        return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:60px;color:${s.color};${fontStyle}">${escapeHtml(s.name)}</span><div style="flex:1;height:12px;background:var(--SmartThemeBlurTintColor);border-radius:3px;overflow:hidden;"><div style="width:${s.count / maxCount * 100}%;height:100%;background:${s.color};"></div></div><span style="width:40px;text-align:right;font-size:0.8em;">${s.count} (${s.pct}%)</span></div>`;
    }).join('');
    const popup = document.createElement('div');
    popup.id = 'dc-stats-popup';
    popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Dialogue Statistics</div>${html}<button class="dc-close-popup menu_button" style="margin-top:10px;width:100%;">Close</button>`;
    popup.querySelector('.dc-close-popup').onclick = () => popup.remove();
    document.body.appendChild(popup);
    const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
    setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
}

export function showStorageManager() {
    const currentKey = getStorageKey();
    const colorData = getUserColorDataStore();
    const keys = Object.keys(colorData).filter(k => k.startsWith('dc_char_') || k === 'dc_global');
    if (!keys.length) { toast.info('No stored color data found'); return; }

    const entries = keys.map(k => {
        const entry = normalizeColorDataEntry(colorData[k]) || { colors: {} };
        const raw = JSON.stringify(entry);
        const size = new Blob([raw]).size;
        const colors = entry.colors || {};
        const colorCount = Object.keys(colors).length;
        const names = Object.values(colors).map(v => v.name).filter(Boolean).slice(0, 3);
        const isCurrent = k === currentKey;
        const label = names.length ? names.join(', ') + (colorCount > 3 ? ` (+${colorCount - 3})` : '') : getStorageLabelForKey(k);
        const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
        return { key: k, label, colorCount, sizeStr, size, isCurrent };
    });
    entries.sort((a, b) => a.isCurrent ? -1 : b.isCurrent ? 1 : a.key.localeCompare(b.key));

    const rows = entries.map(e => {
        const highlight = e.isCurrent ? 'background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 4px;' : 'padding:2px 4px;';
        const tag = e.isCurrent ? ' <span style="font-size:0.75em;opacity:0.6;">(current)</span>' : '';
        return `<label style="display:flex;align-items:center;gap:6px;${highlight}cursor:pointer;"><input type="checkbox" class="dc-storage-check" data-key="${escapeHtml(e.key)}" ${e.isCurrent ? '' : 'checked'}><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.label)}${tag}</span><span style="font-size:0.75em;opacity:0.6;white-space:nowrap;">${e.colorCount} colors · ${e.sizeStr}</span></label>`;
    }).join('');

    const popup = document.createElement('div');
    popup.id = 'dc-storage-popup';
    popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Storage Manager</div>${rows}<div style="display:flex;gap:4px;margin-top:10px;flex-wrap:wrap;"><button class="dc-storage-all menu_button" style="flex:1;">Select All</button><button class="dc-storage-none menu_button" style="flex:1;">Deselect All</button></div><div style="display:flex;gap:4px;margin-top:4px;"><button class="dc-storage-clear menu_button" style="flex:1;">Clear Selected</button><button class="dc-storage-close menu_button" style="flex:1;">Close</button></div>`;

    const checks = () => popup.querySelectorAll('.dc-storage-check');
    popup.querySelector('.dc-storage-all').onclick = () => checks().forEach(c => c.checked = true);
    popup.querySelector('.dc-storage-none').onclick = () => checks().forEach(c => c.checked = false);
    popup.querySelector('.dc-storage-close').onclick = () => { popup.remove(); document.removeEventListener('mousedown', closePopup); };
    popup.querySelector('.dc-storage-clear').onclick = () => {
        const selected = [...checks()].filter(c => c.checked).map(c => c.dataset.key);
        if (!selected.length) { toast.info('Nothing selected'); return; }
        const entryWord = selected.length === 1 ? 'entry' : 'entries';
        const clearingCurrent = selected.includes(currentKey);
        const keptCurrentKeys = clearingCurrent ? getKeptKeys() : [];
        const keptCurrentCount = keptCurrentKeys.length;
        const confirmMessage = keptCurrentCount
            ? `Clear ${selected.length} stored color data ${entryWord}? Pinned characters in the current chat will be kept.`
            : `Clear ${selected.length} stored color data ${entryWord}?`;
        if (!confirm(confirmMessage)) return;

        selected.forEach(k => {
            if (k !== currentKey) removeStoredColorData(k);
        });
        popup.remove();
        document.removeEventListener('mousedown', closePopup);
        if (clearingCurrent) {
            if (keptCurrentCount) {
                keepCharacterKeysOnly(keptCurrentKeys);
                saveHistory();
                saveData();
            } else {
                removeStoredColorData(currentKey);
                setCharacterColors({});
                expandedCharacterRows.clear();
                setSwapMode(null);
                saveHistory();
            }
            updateCharList();
            injectPrompt();
        }

        const summary = keptCurrentCount
            ? `Cleared ${selected.length} ${entryWord}. Current chat kept ${keptCurrentCount} pinned character${keptCurrentCount !== 1 ? 's' : ''}.`
            : `Cleared ${selected.length} ${entryWord}.`;
        toast.success(summary);
    };

    document.body.appendChild(popup);
    const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
    setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
}

export function setRecolorButtonBusy(isBusyState) {
    const button = document.getElementById('dc-recolor');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Recolor';
        button.disabled = true;
        button.textContent = 'Recoloring...';
        return;
    }
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || 'Recolor';
}

export function setColorizeButtonBusy(isBusyState) {
    const button = document.getElementById('dc-colorize');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Colorize';
        button.disabled = true;
        button.textContent = 'Colorizing...';
        return;
    }
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || 'Colorize';
}

export function setVerifyAttributionButtonBusy(isBusyState) {
    const button = document.getElementById('dc-verify-attr');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Verify Colors (LLM)';
        button.disabled = true;
        button.textContent = 'Verifying...';
        return;
    }
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || 'Verify Colors (LLM)';
}

export function showAutoColorizeIndicator(mesElement) {
    if (!mesElement) return;
    let indicator = mesElement.querySelector('.dc-auto-colorize-indicator');
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.className = 'dc-auto-colorize-indicator';
    indicator.textContent = 'Auto-colorizing…';
    mesElement.style.position = mesElement.style.position || 'relative';
    mesElement.appendChild(indicator);
}

export function clearAutoColorizeIndicators() {
    document.querySelectorAll('.dc-auto-colorize-indicator').forEach(indicator => indicator.remove());
}

export function hideAutoColorizeIndicator(mesElement) {
    if (!mesElement) return;
    const indicator = mesElement.querySelector('.dc-auto-colorize-indicator');
    if (indicator) indicator.remove();
}

export function addCharacter(name, color) {
    if (!name.trim()) return;
    const key = name.trim().toLowerCase();
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    let needsDomRepaint = false;
    if (characterColors[key]) {
        setEntryFromBaseColor(characterColors[key], normalizeHexColor(color, suggestColorForName(name) || getNextColor()));
        applyLiveColorChangesFromSnapshot(snapshot, [key]);
    } else {
        const built = buildCharacterEntry(name.trim(), {
            color,
            colorMode: 'base',
            locked: false,
            dialogueCount: 0
        });
        if (!built.entry) return;
        characterColors[key] = built.entry;
        clearSpeakerRegexCache();
        needsDomRepaint = true;
    }
    commit();
    if (needsDomRepaint) repaintDomAfterCharacterDataChange(0);
}

export function swapColors(key1, key2) {
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const color1 = getEntryEffectiveColor(characterColors[key1]);
    const color2 = getEntryEffectiveColor(characterColors[key2]);
    setEntryFromEffectiveColor(characterColors[key1], color2);
    setEntryFromEffectiveColor(characterColors[key2], color1);
    applyLiveColorChangesFromSnapshot(snapshot, [key1, key2]);
    commit();
}

export function toggleCharacterRowExpansion(key) {
    if (!key) return;
    if (expandedCharacterRows.has(key)) expandedCharacterRows.delete(key);
    else expandedCharacterRows.add(key);
}

export function applyCharacterBaseColor(key, color, options = {}) {
    const entry = characterColors[key];
    const nextColor = normalizeHexColor(color, null);
    if (!entry || !nextColor) return false;
    const keys = [key];
    entry.aliases?.forEach(alias => {
        const aliasKey = alias.toLowerCase();
        if (characterColors[aliasKey] && !keys.includes(aliasKey)) keys.push(aliasKey);
    });
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    setEntryFromBaseColor(entry, nextColor);
    keys.slice(1).forEach(aliasKey => setEntryFromBaseColor(characterColors[aliasKey], nextColor));
    applyLiveColorChangesFromSnapshot(snapshot, keys, { saveImmediately: options.saveImmediately === true });
    applyFastColorUiUpdates(keys);
    return true;
}

export function maybeAutoRecolorAfterColorChange() {
    flushColorStateSave();
    flushChatSave();
    if (!settings.autoRecolor) return;
    if (!autoRecolorHintShown) {
        setAutoRecolorHintShown(true);
        toast.info('Auto-recolor is enabled; color changes will update chat automatically.');
    }
}

export function applyThemeOrBrightnessChange(mutator, options = {}) {
    const keys = Object.keys(characterColors);
    const snapshot = captureEffectiveColorSnapshot(keys);
    mutator();
    invalidateThemeCache();
    syncAllEffectiveColors();
    applyLiveColorChangesFromSnapshot(snapshot, keys, { saveImmediately: options.saveImmediately });
    applyFastColorUiUpdates(keys);
}

export function buildCharRowHtml(k, v) {
    const safeKey = escapeAttr(k);
    const safeColor = getEntryEffectiveColor(v);
    const pickerColor = getBaseColor(v, safeColor);
    const rowExpanded = expandedCharacterRows.has(k);
    const styleLabel = v.style || 'Normal';
    const fontName = normalizeGoogleFontName(v.font);
    const fontFamily = getGoogleFontFamily(fontName);
    if (fontFamily) loadGoogleFont(fontName);
    const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
    const statusBadges = [
        v.keep ? '<span class="dc-status-chip dc-status-chip-keep">Kept</span>' : '',
        v.locked ? '<span class="dc-status-chip dc-status-chip-lock">Locked</span>' : '',
        v.group ? `<span class="dc-status-chip">${escapeHtml(v.group)}</span>` : '',
        v.style ? `<span class="dc-status-chip">${escapeHtml(styleLabel)}</span>` : '',
        fontName ? `<span class="dc-status-chip" style="${fontStyle}">${escapeHtml(fontName)}</span>` : '',
        getBadge(v.dialogueCount || 0) ? `<span class="dc-status-chip">${getBadge(v.dialogueCount || 0)}</span>` : ''
    ].filter(Boolean).join('');
    const aliasChips = (v.aliases || []).map(a =>
        `<span class="dc-alias-chip">${escapeHtml(a)}<span class="dc-alias-remove" data-key="${safeKey}" data-alias="${escapeAttr(a)}" title="Remove alias">&times;</span></span>`
    ).join('');
    return `
        <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${v.keep ? 'dc-char-kept' : ''}" data-key="${safeKey}">
            <div class="dc-char-main">
                <span class="dc-color-swatch">
                    <span class="dc-color-dot" style="background:${safeColor};"></span>
                    <input type="color" value="${pickerColor}" data-key="${safeKey}" class="dc-color-input">
                </span>
                <input type="text" value="${escapeAttr(pickerColor)}" data-key="${safeKey}" class="dc-color-hex text_pole" inputmode="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="7" aria-label="Hex color for ${escapeAttr(v.name)}" title="Enter a hex color like #ff66cc">
                <div class="dc-char-name-wrap" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}${fontName ? '\nFont: ' + escapeHtml(fontName) : ''}">
                    <div class="dc-char-name" style="color:${safeColor};${fontStyle}">${escapeHtml(v.name)}</div>
                    <div class="dc-char-meta">
                        <span class="dc-char-count">${v.dialogueCount || 0} lines</span>
                        ${statusBadges}
                    </div>
                </div>
                <button class="dc-keep menu_button ${v.keep ? 'dc-toggle-active' : ''}" data-key="${safeKey}" title="Keep this character even when clearing or bulk deleting">${v.keep ? 'Kept' : 'Keep'}</button>
                <button class="dc-lock menu_button ${v.locked ? 'dc-toggle-active' : ''}" data-key="${safeKey}" title="Lock color">${v.locked ? 'Locked' : 'Lock'}</button>
                <button class="dc-del menu_button dc-danger-button" data-key="${safeKey}" title="Delete character">Delete</button>
                <button class="dc-more menu_button" data-key="${safeKey}" title="Show more tools">${rowExpanded ? 'Less' : 'More'}</button>
            </div>
            ${aliasChips ? `<div class="dc-alias-list">${aliasChips}</div>` : ''}
            ${rowExpanded ? `
            <div class="dc-char-advanced">
                <div class="dc-inline-toolbar">
                    <button class="dc-swap menu_button" data-key="${safeKey}" title="Swap colors">Swap</button>
                    <button class="dc-style menu_button" data-key="${safeKey}" title="Cycle text style">Style: ${escapeHtml(styleLabel)}</button>
                    <button class="dc-font menu_button" data-key="${safeKey}" title="Set Google Font">${fontName ? 'Edit Font' : 'Set Font'}</button>
                    <button class="dc-alias menu_button" data-key="${safeKey}" title="Add alias">Add Alias</button>
                    <button class="dc-group menu_button" data-key="${safeKey}" title="Assign group">${v.group ? 'Edit Group' : 'Set Group'}</button>
                </div>
            </div>` : ''}
        </div>`;
}

export function buildCharRowSignature(k, v) {
    const safeColor = getEntryEffectiveColor(v);
    return [
        safeColor,
        getBaseColor(v, safeColor),
        expandedCharacterRows.has(k) ? 1 : 0,
        v.keep ? 1 : 0,
        v.locked ? 1 : 0,
        v.group || '',
        v.style || '',
        normalizeGoogleFontName(v.font),
        v.dialogueCount || 0,
        swapMode === k ? 1 : 0,
        (v.aliases || []).join('\u0001'),
        v.name || ''
    ].join('\u0002');
}

export function applyColorInputForElement(i, options = {}) {
    const c = characterColors[i.dataset.key];
    if (!c) return false;
    if (applyCharacterBaseColor(i.dataset.key, normalizeHexColor(i.value, getBaseColor(c)), options)) {
        queueColorStateSave();
        return true;
    }
    return false;
}

// Event delegation: handlers are installed once on the list container, so
// re-rendering rows never needs to rebind per-row listeners.

export function applyHexInputForElement(i, options = {}) {
    const c = characterColors[i.dataset.key];
    if (!c) return false;
    const nextColor = normalizeManualColorInput(i.value, null);
    if (!nextColor) {
        i.value = getBaseColor(c);
        toast.warning('Enter a hex color like #ff66cc.');
        return false;
    }
    if (applyCharacterBaseColor(i.dataset.key, nextColor, options)) queueColorStateSave();
    return true;
}

// Phase 5B: Alias chips, Phase 6B: Group headers, Phase 5D: Harmony on dblclick

// Event delegation: handlers are installed once on the list container, so
// re-rendering rows never needs to rebind per-row listeners.
export function installCharListDelegation(list) {
    if (list.__dcDelegated) return;
    list.__dcDelegated = true;

    const stopPropagation = e => e.stopPropagation();
    list.addEventListener('touchstart', stopPropagation, { passive: true });
    list.addEventListener('touchmove', stopPropagation, { passive: true });
    list.addEventListener('touchend', stopPropagation, { passive: true });
    list.addEventListener('wheel', stopPropagation, { passive: true });

    list.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('dc-color-input')) {
            applyColorInputForElement(t);
        }
    });

    list.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.classList) return;
        if (t.classList.contains('dc-color-input')) {
            applyColorInputForElement(t, { saveImmediately: true });
            maybeAutoRecolorAfterColorChange();
        } else if (t.classList.contains('dc-color-hex')) {
            if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
        }
    });

    list.addEventListener('keydown', (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('dc-color-hex') && e.key === 'Enter') {
            e.preventDefault();
            if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
            t.blur();
        }
    });

    list.addEventListener('dblclick', (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('dc-color-input')) {
            e.preventDefault();
            showHarmonyPopup(t.dataset.key, t);
        }
    });

    list.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;

        const dotEl = t.closest('.dc-color-dot');
        if (dotEl) {
            const input = dotEl.nextElementSibling;
            if (input?.classList.contains('dc-color-input')) input.click();
            return;
        }
        const moreBtn = t.closest('.dc-more');
        if (moreBtn) {
            toggleCharacterRowExpansion(moreBtn.dataset.key);
            updateCharList();
            return;
        }
        const delBtn = t.closest('.dc-del');
        if (delBtn) {
            removeCharacterKeys([delBtn.dataset.key], {
                actionLabel: 'Deleted',
                emptyMessage: 'Character already removed.',
                blockedMessage: 'Turn off Keep before deleting this character.'
            });
            return;
        }
        const keepBtn = t.closest('.dc-keep');
        if (keepBtn) {
            const key = keepBtn.dataset.key;
            if (!characterColors[key]) return;
            characterColors[key].keep = !characterColors[key].keep;
            saveHistory();
            saveData();
            updateCharList();
            toast.info(characterColors[key].keep ? `${characterColors[key].name} will now survive Clear and bulk delete.` : `${characterColors[key].name} can now be cleared or deleted normally.`);
            return;
        }
        const lockBtn = t.closest('.dc-lock');
        if (lockBtn) {
            const key = lockBtn.dataset.key;
            if (!characterColors[key]) return;
            const wasLocked = !!characterColors[key].locked;
            characterColors[key].locked = !characterColors[key].locked;
            saveHistory();
            saveData(); updateCharList();
            if (!wasLocked && characterColors[key]?.locked) {
                const duplicateKeys = collectDuplicateColorKeys();
                if (duplicateKeys.length) {
                    removeCharacterKeys(duplicateKeys, {
                        actionLabel: 'Auto-cleared',
                        itemLabel: 'duplicate-color character',
                        blockedMessage: 'Only pinned duplicate-color characters remain. Turn off Keep first.'
                    });
                }
            }
            return;
        }
        const swapBtn = t.closest('.dc-swap');
        if (swapBtn) {
            if (!swapMode) { setSwapMode(swapBtn.dataset.key); updateCharList(); toast.info('Click another character to swap'); }
            else if (swapMode === swapBtn.dataset.key) { setSwapMode(null); updateCharList(); }
            else { swapColors(swapMode, swapBtn.dataset.key); setSwapMode(null); }
            return;
        }
        const styleBtn = t.closest('.dc-style');
        if (styleBtn) {
            const key = styleBtn.dataset.key;
            if (!characterColors[key]) return;
            const styles = ['', 'bold', 'italic', 'bold italic'];
            const curr = characterColors[key].style || '';
            characterColors[key].style = styles[(styles.indexOf(curr) + 1) % styles.length];
            commit();
            repaintDomAfterCharacterDataChange(0);
            return;
        }
        const aliasRemoveBtn = t.closest('.dc-alias-remove');
        if (aliasRemoveBtn) {
            e.stopPropagation();
            const key = aliasRemoveBtn.dataset.key;
            const alias = aliasRemoveBtn.dataset.alias;
            if (characterColors[key]?.aliases) {
                const nextAliases = characterColors[key].aliases.filter(a => a !== alias);
                if (nextAliases.length !== characterColors[key].aliases.length) {
                    characterColors[key].aliases = nextAliases;
                    commit();
                    repaintDomAfterCharacterDataChange(0);
                }
            }
            return;
        }
        const aliasBtn = t.closest('.dc-alias');
        if (aliasBtn) {
            const row = aliasBtn.closest('.dc-char');
            const existing = row.querySelector('.dc-inline-input');
            if (existing) { existing.remove(); return; }
            const inputRow = document.createElement('div');
            inputRow.className = 'dc-inline-input';
            inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
            inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Alias name..." style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Add</button>`;
            row.appendChild(inputRow);
            const inp = inputRow.querySelector('input');
            inp.focus();
            const submit = () => {
                const alias = inp.value.trim();
                if (alias) {
                    const aliases = characterColors[aliasBtn.dataset.key].aliases = characterColors[aliasBtn.dataset.key].aliases || [];
                    if (!aliases.includes(alias)) {
                        aliases.push(alias);
                        commit();
                        repaintDomAfterCharacterDataChange(0);
                    } else {
                        inputRow.remove();
                    }
                }
                else inputRow.remove();
            };
            inputRow.querySelector('button').onclick = submit;
            inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
            return;
        }
        const fontBtn = t.closest('.dc-font');
        if (fontBtn) {
            const row = fontBtn.closest('.dc-char');
            const existing = row.querySelector('.dc-inline-input');
            if (existing) { existing.remove(); return; }
            const key = fontBtn.dataset.key;
            const current = normalizeGoogleFontName(characterColors[key]?.font);
            const inputRow = document.createElement('div');
            inputRow.className = 'dc-inline-input';
            inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
            inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Google Font name..." value="${escapeAttr(current)}" style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Set</button>`;
            row.appendChild(inputRow);
            const inp = inputRow.querySelector('input');
            inp.focus();
            inp.select();
            const submit = () => {
                if (!characterColors[key]) { inputRow.remove(); return; }
                const nextFont = normalizeGoogleFontName(inp.value);
                if ((normalizeGoogleFontName(characterColors[key].font)) !== nextFont) {
                    characterColors[key].font = nextFont;
                    if (nextFont) loadGoogleFont(nextFont);
                    commit();
                    repaintDomAfterCharacterDataChange(0);
                } else {
                    inputRow.remove();
                }
            };
            inputRow.querySelector('button').onclick = submit;
            inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
            return;
        }
        const groupBtn = t.closest('.dc-group');
        if (groupBtn) {
            const row = groupBtn.closest('.dc-char');
            const existing = row.querySelector('.dc-inline-input');
            if (existing) { existing.remove(); return; }
            const key = groupBtn.dataset.key;
            const current = characterColors[key]?.group || '';
            const inputRow = document.createElement('div');
            inputRow.className = 'dc-inline-input';
            inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
            inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Group name..." value="${escapeHtml(current)}" style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Set</button>`;
            row.appendChild(inputRow);
            const inp = inputRow.querySelector('input');
            inp.focus();
            inp.select();
            const submit = () => {
                const nextGroup = inp.value.trim();
                if ((characterColors[key]?.group || '') !== nextGroup) {
                    characterColors[key].group = nextGroup;
                    saveHistory();
                    saveData(); updateCharList();
                } else {
                    inputRow.remove();
                }
            };
            inputRow.querySelector('button').onclick = submit;
            inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
            return;
        }
    });
}

// Phase 5B: Alias chips, Phase 6B: Group headers, Phase 5D: Harmony on dblclick
export function updateCharList() {
    const list = document.getElementById('dc-char-list'); if (!list) return;
    installCharListDelegation(list);
    const entries = getSortedEntries();
    const countEl = document.getElementById('dc-count');
    if (countEl) countEl.textContent = Object.keys(characterColors).length;

    if (!entries.length) {
        list.innerHTML = `<small style="opacity:0.6;">${searchTerm ? 'No matches' : 'No characters'}</small>`;
        applyControlHelpText(list);
        updateLegend();
        return;
    }

    // Build the desired ordered sequence of keyed blocks (optional group
    // headers interleaved with character rows).
    const desired = [];
    let lastGroup = null;
    for (const [k, v] of entries) {
        if (settings.sortMode === 'group') {
            const g = v.group || '(ungrouped)';
            if (g !== lastGroup) {
                lastGroup = g;
                desired.push({ blockKey: '__group__:' + g, sig: 'h:' + g, html: `<div class="dc-group-header">${escapeHtml(g)}</div>` });
            }
        }
        desired.push({ blockKey: 'row:' + k, sig: buildCharRowSignature(k, v), html: buildCharRowHtml(k, v) });
    }

    // Index currently-managed nodes by their block key; drop anything stray
    // (e.g. a leftover empty-state message).
    const existing = new Map();
    for (const node of Array.from(list.children)) {
        const bk = node.getAttribute('data-dc-block');
        if (bk !== null) existing.set(bk, node);
        else node.remove();
    }

    // Reconcile in order: reuse unchanged nodes (preserving open inline
    // inputs and avoiding handler churn), rebuild changed ones, append new.
    const used = new Set();
    for (const item of desired) {
        let node = existing.get(item.blockKey);
        if (!(node && node.getAttribute('data-dc-sig') === item.sig)) {
            node = htmlToNode(item.html);
            node.setAttribute('data-dc-block', item.blockKey);
            node.setAttribute('data-dc-sig', item.sig);
        }
        list.appendChild(node);
        used.add(node);
    }
    for (const node of Array.from(list.children)) {
        if (!used.has(node)) node.remove();
    }

    applyControlHelpText(list);
    updateLegend();
}

export function setControlHelp(element, text) {
    if (!element || !text) return;
    element.title = text;
    element.setAttribute('aria-label', text);
}

export function applyControlHelpText(root = document) {
    root.querySelectorAll('[data-help]').forEach(el => setControlHelp(el, el.dataset.help));
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    for (const [selector, text] of Object.entries(DYNAMIC_CONTROL_HELP_TEXT)) {
        scope.querySelectorAll(selector).forEach(el => setControlHelp(el, text));
    }
}

export function updateEngineVisibility() {
    const domMode = isDomEngine();
    document.querySelectorAll('#dc-ext .dc-llm-only').forEach(el => {
        el.style.display = domMode ? 'none' : '';
    });
    document.querySelectorAll('#dc-ext .dc-dom-only').forEach(el => {
        el.style.display = domMode ? '' : 'none';
    });
    const recolorButton = document.getElementById('dc-recolor');
    if (recolorButton && !recolorButton.disabled) {
        recolorButton.textContent = domMode ? 'Refresh DOM Colors' : 'Recolor Chat';
    }
    updateSystemPromptDisplay();
}

export function autoAssignFromCard() {
    try {
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        const key = char?.name?.toLowerCase();
        if (key && !characterColors[key]) {
            addCharacter(char.name);
            toast.success(`Added ${char.name}`);
        }
    } catch { }
}

export function syncUIWithSettings() {
    const $ = id => document.getElementById(id);
    normalizeToggleSettings();
    if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
    if ($('dc-highlight')) $('dc-highlight').checked = settings.highlightMode;
    if ($('dc-autoscan')) $('dc-autoscan').checked = settings.autoScanOnLoad !== false;
    if ($('dc-autoscan-new')) $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false;
    if ($('dc-auto-lock')) $('dc-auto-lock').checked = settings.autoLockDetected !== false;
    if ($('dc-auto-recolor')) $('dc-auto-recolor').checked = settings.autoRecolor !== false;
    if ($('dc-auto-colorize')) $('dc-auto-colorize').checked = settings.autoColorize || false;
    if ($('dc-llm-attr-check')) $('dc-llm-attr-check').checked = settings.llmAttributionCheck || false;
    if ($('dc-llm-attr-parallel')) $('dc-llm-attr-parallel').checked = settings.llmAttributionParallel || false;
    if ($('dc-attr-conservative')) $('dc-attr-conservative').checked = settings.attributionConservativeOnly || false;
    if ($('dc-attr-max-tokens')) $('dc-attr-max-tokens').value = Number.isFinite(settings.attributionMaxTokens) && settings.attributionMaxTokens > 0 ? settings.attributionMaxTokens : 4096;
    if ($('dc-stealth-colors')) $('dc-stealth-colors').checked = settings.domStealthColors !== false;
    if ($('dc-right-click')) $('dc-right-click').checked = settings.enableRightClick;
    if ($('dc-legend')) $('dc-legend').checked = settings.showLegend;
    if ($('dc-disable-narration')) $('dc-disable-narration').checked = settings.disableNarration !== false;
    if ($('dc-share-global')) $('dc-share-global').checked = settings.shareColorsGlobally || false;
    if ($('dc-css-effects')) $('dc-css-effects').checked = settings.cssEffects || false;
    if ($('dc-disable-toasts')) $('dc-disable-toasts').checked = settings.disableToasts || false;
    if ($('dc-engine')) $('dc-engine').value = settings.coloringEngine || 'llm';
    if ($('dc-llm-profile')) $('dc-llm-profile').value = settings.llmConnectionProfile || '';
    if ($('dc-attr-profile')) $('dc-attr-profile').value = settings.attributionConnectionProfile || '';
    if ($('dc-theme')) $('dc-theme').value = settings.themeMode;
    if ($('dc-palette')) $('dc-palette').value = settings.colorTheme || 'pastel';
    if ($('dc-brightness')) $('dc-brightness').value = settings.brightness || 0;
    if ($('dc-bright-val')) $('dc-bright-val').textContent = settings.brightness || 0;
    if ($('dc-narrator')) $('dc-narrator').value = settings.narratorColor || '#888888';
    if ($('dc-thought-symbols')) $('dc-thought-symbols').value = settings.thoughtSymbols || '';
    if ($('dc-prompt-depth')) $('dc-prompt-depth').value = settings.promptDepth ?? 1;
    if ($('dc-prompt-role')) $('dc-prompt-role').value = settings.promptRole || 'system';
    if ($('dc-prompt-mode')) $('dc-prompt-mode').value = settings.promptMode || 'inject';
    if ($('dc-sort')) $('dc-sort').value = settings.sortMode || 'name';
    refreshPresetDropdown();
    refreshPaletteDropdown();
    updateSystemPromptDisplay();
    updateEngineVisibility();
    updateAutoSyncUI();
    applyControlHelpText();
}

export function createUI() {
    if (document.getElementById('dc-ext')) return;
    const html = `
    <div id="dc-ext" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content" style="padding:10px;font-size:0.9em;">
            <details class="dc-section" open>
                <summary>Basic</summary>
                <p class="dc-section-note">The everyday controls live here. Clear keeps any character marked with Keep.</p>
                <div class="dc-stack">
                    <div class="dc-field-row">
                        <label class="dc-inline-label" for="dc-engine">Coloring engine</label>
                        <select id="dc-engine" class="text_pole" data-help="Choose LLM prompt-based coloring or local DOM-only coloring that never edits chat text."><option value="llm">LLM</option><option value="dom">Local (DOM-only)</option></select>
                        <small class="dc-dom-only" style="display:none;opacity:0.72;flex-basis:100%;">DOM mode colors rendered quotes locally, stores quote overrides in chat metadata, and can optionally use the selected LLM profile to verify attribution after generation.</small>
                    </div>
                    <div class="dc-button-row dc-button-row-3">
                        <button id="dc-scan" class="menu_button" data-help="Scan the current chat for characters and colors.">Scan Chat</button>
                        <button id="dc-clear" class="menu_button dc-danger-button" data-help="Clear tracked characters, but keep anything pinned with Keep.">Clear Non-Kept</button>
                        <button id="dc-recolor" class="menu_button" data-help="Rewrite message colors to match the current character assignments.">Recolor Chat</button>
                    </div>
                    <div class="dc-button-row dc-button-row-3">
                        <button id="dc-colorize" class="menu_button dc-llm-only" data-help="Colorize uncolored messages. Shift-click for only the latest message.">Colorize Missing</button>
                        <button id="dc-verify-attr" class="menu_button dc-dom-only" style="display:none;" data-help="Verify DOM quote attribution with the selected LLM profile. Shift-click scans visible unverified messages.">Verify Colors (LLM)</button>
                        <button id="dc-stats" class="menu_button" data-help="Open dialogue statistics for tracked characters.">Show Stats</button>
                    </div>
                    <div class="dc-field-row">
                        <label class="dc-inline-label" for="dc-theme">Theme</label>
                        <select id="dc-theme" class="text_pole" data-help="Choose Auto, Dark, or Light targeting for generated color readability."><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                    </div>
                    <div class="dc-field-row">
                        <label class="dc-inline-label" for="dc-palette">Palette</label>
                        <select id="dc-palette" class="text_pole" data-help="Pick the color palette used for new or regenerated character colors."></select>
                    </div>
                    <div class="dc-field-row">
                        <label class="dc-inline-label" for="dc-brightness">Brightness</label>
                        <input type="range" id="dc-brightness" min="-100" max="100" value="0" data-help="Bias newly generated colors lighter or darker.">
                        <span id="dc-bright-val" class="dc-inline-value">0</span>
                    </div>
                    <div class="dc-toggle-grid">
                        <label class="checkbox_label"><input type="checkbox" id="dc-enabled" data-help="Enable or disable Dialogue Colors."><span>Enable Dialogue Colors</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-highlight" data-help="Add background highlights behind colored dialogue."><span>Highlight dialogue</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-legend" data-help="Show a floating legend of active character colors."><span>Show floating legend</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-css-effects" data-help="Allow transform-based CSS effects for dramatic dialogue."><span>Enable CSS effects</span></label>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-recolor" data-help="Automatically recolor chat after color changes."><span>Auto-recolor after changes</span></label>
                        <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-stealth-colors" data-help="In DOM mode, inject a slim instruction for the model to include [COLORS:Name=#RRGGBB] for new speakers."><span>Stealth colors block</span></label>
                        <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-llm-attr-check" data-help="In DOM mode, automatically ask the selected LLM profile to verify rendered unverified messages and save metadata corrections."><span>LLM attribution check</span></label>
                        <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-llm-attr-parallel" data-help="During streaming in DOM mode, verify quote attribution after 2-second pauses so corrections can appear before generation fully ends."><span>LLM streaming attribution</span></label>
                        <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-attr-conservative" data-help="In DOM mode, the LLM verifier will only fill Uncolored/Unknown segments and will not overwrite existing colors."><span>Conservative verify</span></label>
                    </div>
                    <div class="dc-field-row dc-dom-only">
                        <label class="dc-inline-label" for="dc-attr-profile">Verify profile</label>
                        <select id="dc-attr-profile" class="text_pole" data-help="Connection profile to use for LLM attribution verification."><option value="">-- Use main chat AI --</option></select>
                    </div>
                    <div class="dc-field-row dc-dom-only">
                        <label class="dc-inline-label" for="dc-attr-max-tokens">Verify tokens</label>
                        <input type="number" id="dc-attr-max-tokens" min="256" max="32768" value="4096" class="text_pole" data-help="Maximum tokens for the LLM verifier. Increase for reasoning models that think before outputting JSON.">
                    </div>
                    <div class="dc-field-row dc-llm-only">
                        <label class="dc-inline-label" for="dc-prompt-depth">Depth</label>
                        <input type="number" id="dc-prompt-depth" min="0" max="99" value="1" class="text_pole" data-help="How far from the chat end the prompt is injected.">
                    </div>
                    <div class="dc-field-row dc-llm-only">
                        <label class="dc-inline-label" for="dc-prompt-role">Role</label>
                        <select id="dc-prompt-role" class="text_pole" data-help="Inject the prompt as a system or user message."><option value="system">System</option><option value="user">User</option></select>
                    </div>
                    <div class="dc-field-row dc-llm-only">
                        <label class="dc-inline-label" for="dc-prompt-mode">Mode</label>
                        <select id="dc-prompt-mode" class="text_pole" data-help="Inject automatically or use the macro manually."><option value="inject">Inject</option><option value="macro">Macro</option></select>
                    </div>
                </div>
            </details>
            <details class="dc-section" open>
                <summary>Characters</summary>
                <p class="dc-section-note">Keep marks main characters so they survive Clear and all bulk delete tools.</p>
                <div class="dc-stack">
                    <div class="dc-field-row dc-field-row-wrap">
                        <input type="text" id="dc-search" placeholder="Search characters..." class="text_pole" data-help="Filter characters by name.">
                        <select id="dc-sort" class="text_pole" data-help="Sort by name, dialogue count, or group. This preference is saved and restored across sessions."><option value="name">Sort: Name</option><option value="count">Sort: Dialogue Count</option><option value="group">Sort: Group</option></select>
                    </div>
                    <div class="dc-field-row dc-field-row-wrap">
                        <input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" data-help="Type a new character name to add manually.">
                        <button id="dc-add-btn" class="menu_button" data-help="Add the typed character with a suggested color.">Add Character</button>
                    </div>
                    <small>Characters: <span id="dc-count">0</span> (⭐=50+, 💎=100+)</small>
                    <div id="dc-char-list" class="dc-char-list"></div>
                </div>
            </details>
            <details class="dc-section">
                <summary>Advanced</summary>
                <p class="dc-section-note">Less common tools live here so the main workflow stays simple.</p>
                <div class="dc-stack">
                    <details class="dc-subsection">
                        <summary>Automation</summary>
                        <div class="dc-stack">
                            <div class="dc-toggle-grid">
                                <label class="checkbox_label"><input type="checkbox" id="dc-autoscan" data-help="Automatically scan existing chat messages after chat load."><span>Auto-scan on chat load</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new" data-help="Automatically scan newly arriving messages for speakers/colors."><span>Auto-scan new messages</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-auto-lock" data-help="Automatically lock newly detected characters."><span>Auto-lock new characters</span></label>
                                <label class="checkbox_label dc-llm-only"><input type="checkbox" id="dc-auto-colorize" data-help="Automatically colorize messages when the model skips color tags."><span>Auto-colorize fallback</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-right-click" data-help="Enable right-click or long-press reassignment on dialogue."><span>Enable right-click reassignment</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration" data-help="Skip narrator color instructions."><span>Disable narration coloring</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-share-global" data-help="Use one shared color table across all chats."><span>Share colors across chats</span></label>
                                <label class="checkbox_label"><input type="checkbox" id="dc-disable-toasts" data-help="Suppress non-error toast notifications."><span>Reduce toast popups</span></label>
                            </div>
                            <div class="dc-field-row dc-llm-only">
                                <label class="dc-inline-label" for="dc-llm-profile">LLM Profile</label>
                                <select id="dc-llm-profile" class="text_pole" data-help="Connection profile to use for LLM colorization."><option value="">-- Use main chat AI --</option></select>
                            </div>
                        </div>
                    </details>
                    <details class="dc-subsection">
                        <summary>Prompt & narration</summary>
                        <div class="dc-stack">
                            <div class="dc-field-row">
                                <label class="dc-inline-label" for="dc-narrator">Narrator</label>
                                <input type="color" id="dc-narrator" value="#888888" data-help="Set narrator fallback color.">
                                <button id="dc-narrator-clear" class="menu_button" data-help="Reset narrator color to default.">Reset Narrator</button>
                            </div>
                            <div class="dc-field-row dc-field-row-wrap">
                                <label class="dc-inline-label" for="dc-thought-symbols">Thoughts</label>
                                <input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" data-help="Symbols used to detect inner-thought dialogue.">
                                <button id="dc-thought-add" class="menu_button" data-help="Append another thought symbol.">Add Symbol</button>
                                <button id="dc-thought-clear" class="menu_button" data-help="Remove all thought symbols.">Clear Symbols</button>
                            </div>
                            <div id="dc-system-prompt-container" class="dc-llm-only" style="display:none;">
                                <label style="font-weight:bold;margin-bottom:4px;display:block;">Add to your system prompt:</label>
                                <textarea id="dc-system-prompt-text" readonly class="text_pole" style="width:100%;min-height:60px;font-size:0.75em;font-family:monospace;resize:vertical;">{{dialoguecolors}}</textarea>
                                <button id="dc-copy-system-prompt" class="menu_button" style="margin-top:4px;width:100%;">Copy Macro</button>
                            </div>
                        </div>
                    </details>
                    <details class="dc-subsection">
                        <summary>Palette tools</summary>
                        <div class="dc-stack">
                            <div class="dc-field-row dc-field-row-wrap">
                                <input type="text" id="dc-palette-name-input" placeholder="Palette name..." class="text_pole" data-help="Name used when creating or saving a custom palette.">
                                <input type="text" id="dc-palette-notes-input" placeholder="Palette notes (optional)" class="text_pole" data-help="Optional notes for generated palettes.">
                            </div>
                            <label class="checkbox_label"><input type="checkbox" id="dc-overwrite-existing" data-help="Allow replacing an existing custom palette with the same name."><span>Overwrite existing custom palette</span></label>
                            <div class="dc-button-row dc-button-row-3">
                                <button id="dc-gen-palette" class="menu_button" data-help="Generate a custom palette from the name and notes fields.">Generate Palette</button>
                                <button id="dc-save-palette" class="menu_button" data-help="Save current character colors as a custom palette.">Save Current As Palette</button>
                                <button id="dc-del-palette" class="menu_button dc-danger-button" data-help="Delete the currently selected custom palette.">Delete Selected Palette</button>
                            </div>
                        </div>
                    </details>
                    <details class="dc-subsection">
                        <summary>Presets & import/export</summary>
                        <div class="dc-stack">
                            <div class="dc-button-row dc-button-row-1">
                                <button id="dc-restore-defaults" class="menu_button dc-danger-button" data-help="Reset all settings to their default values. Character colors are preserved.">Restore All Settings to Defaults</button>
                            </div>
                            <hr style="margin:8px 0;opacity:0.2;">
                            <div class="dc-field-row dc-field-row-wrap">
                                <input type="text" id="dc-preset-name" placeholder="Preset name..." class="text_pole" data-help="Preset name used when saving current assignments.">
                                <button id="dc-save-preset" class="menu_button" data-help="Save current assignments into a named preset.">Save Preset</button>
                            </div>
                            <div class="dc-field-row dc-field-row-wrap">
                                <select id="dc-preset-select" class="text_pole" data-help="Select a preset to load or delete."><option value="">-- Select Preset --</option></select>
                                <button id="dc-load-preset" class="menu_button" data-help="Load the selected preset into the current character list.">Load Preset</button>
                                <button id="dc-delete-preset" class="menu_button dc-danger-button" data-help="Delete the selected preset.">Delete Preset</button>
                            </div>
                            <div class="dc-button-row dc-button-row-3">
                                <button id="dc-export" class="menu_button" data-help="Export colors and settings to JSON.">Export Colors</button>
                                <button id="dc-import" class="menu_button" data-help="Import colors and settings from JSON.">Import Colors</button>
                                <button id="dc-export-png" class="menu_button" data-help="Export the floating legend as an image.">Export Legend PNG</button>
                            </div>
                            <div class="dc-button-row dc-button-row-2">
                                <button id="dc-export-settings" class="menu_button" data-help="Export only settings to JSON.">Export Settings</button>
                                <button id="dc-import-settings" class="menu_button" data-help="Import settings without overwriting local colors.">Import Settings</button>
                            </div>
                            <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                            <input type="file" id="dc-import-settings-file" accept=".json" style="display:none;">
                        </div>
                    </details>
                    <details class="dc-subsection">
                        <summary>Card & sync</summary>
                        <div class="dc-stack">
                            <div class="dc-button-row dc-button-row-2">
                                <button id="dc-card" class="menu_button" data-help="Add the current card character if missing.">Add Current Card</button>
                                <button id="dc-avatar-color" class="menu_button" data-help="Use the current avatar's dominant color.">Use Avatar Color</button>
                            </div>
                            <div class="dc-button-row dc-button-row-2">
                                <button id="dc-save-card" class="menu_button" data-help="Save this chat color data into the character card.">Save To Card</button>
                                <button id="dc-load-card" class="menu_button" data-help="Load saved color data from the character card.">Load From Card</button>
                            </div>
                            <div class="dc-button-row dc-button-row-2">
                                <button id="dc-setup-autosync" class="menu_button" data-help="Enable automatic settings sync across devices.">Enable Auto-Sync</button>
                                <button id="dc-disable-autosync" class="menu_button" style="display:none;" data-help="Disable automatic settings synchronization.">Disable Auto-Sync</button>
                            </div>
                            <span id="dc-autosync-status" class="dc-status-text"></span>
                        </div>
                    </details>
                    <details class="dc-subsection">
                        <summary>Maintenance</summary>
                        <div class="dc-stack">
                            <div class="dc-button-row dc-button-row-3">
                                <button id="dc-undo" class="menu_button" data-help="Undo the last color-table change.">Undo</button>
                                <button id="dc-redo" class="menu_button" data-help="Redo the last undone change.">Redo</button>
                                <button id="dc-fix-conflicts" class="menu_button" data-help="Auto-resolve colors that are too similar.">Fix Similar Colors</button>
                            </div>
                            <div class="dc-button-row dc-button-row-3">
                                <button id="dc-regen" class="menu_button" data-help="Regenerate colors for unlocked characters.">Regenerate Unlocked</button>
                                <button id="dc-flip-theme" class="menu_button" data-help="Flip color lightness for theme switching.">Flip For Theme</button>
                                <button id="dc-storage" class="menu_button" data-help="Browse and clear stored color data across chats.">Storage Manager</button>
                            </div>
                        </div>
                    </details>
                </div>
            </details>
            <details class="dc-section dc-danger-zone">
                <summary>Danger Zone</summary>
                <p class="dc-section-note">Pinned characters are protected here too. Turn off Keep first if you really want to remove them.</p>
                <div class="dc-stack">
                    <div class="dc-button-row dc-button-row-3">
                        <button id="dc-lock-all" class="menu_button" data-help="Lock every tracked character color.">Lock All</button>
                        <button id="dc-unlock-all" class="menu_button" data-help="Unlock every tracked character color.">Unlock All</button>
                        <button id="dc-reset" class="menu_button dc-danger-button" data-help="Reassign random palette colors to all unlocked characters.">Reset Unlocked Colors</button>
                    </div>
                    <div class="dc-button-row dc-button-row-2">
                        <button id="dc-del-locked" class="menu_button dc-danger-button" data-help="Delete all locked characters except kept ones.">Delete Locked</button>
                        <button id="dc-del-unlocked" class="menu_button dc-danger-button" data-help="Delete all unlocked characters except kept ones.">Delete Unlocked</button>
                    </div>
                    <div class="dc-field-row dc-field-row-wrap">
                        <input type="number" id="dc-del-least-threshold" min="0" value="3" class="text_pole" data-help="Minimum dialogue count to keep when using the threshold delete tool.">
                        <button id="dc-del-least" class="menu_button dc-danger-button" data-help="Delete characters below the dialogue threshold, except kept ones.">Delete Below Threshold</button>
                    </div>
                    <div class="dc-button-row dc-button-row-1">
                        <button id="dc-del-dupes" class="menu_button dc-danger-button" data-help="Delete duplicate-color characters, keeping the highest dialogue count and any kept characters.">Delete Duplicate Colors</button>
                    </div>
                </div>
            </details>
            <hr style="margin:8px 0 4px;opacity:0.2;">
            <small>Preview:</small>
            <div id="dc-prompt-preview" style="font-size:0.75em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;"></div>
        </div>
    </div>`;
    document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

    const $ = id => document.getElementById(id);

    syncUIWithSettings();

    $('dc-enabled').onchange = e => {
        settings.enabled = e.target.checked;
        if (!settings.enabled) {
            stopDomHealthCheck();
            clearAutoAttributionVerificationQueue({ clearCooldown: true });
        }
        saveData();
        injectPrompt();
        scheduleDomRefreshSeries(0);
        scheduleCustomFontRefresh(0);
    };
    $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
    $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
    $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
    $('dc-auto-recolor').onchange = e => { settings.autoRecolor = e.target.checked; saveData(); };
    $('dc-auto-colorize').onchange = e => { settings.autoColorize = e.target.checked; saveData(); };
    $('dc-llm-attr-check').onchange = e => {
        settings.llmAttributionCheck = e.target.checked;
        if (settings.llmAttributionCheck) queueAutoAttributionVerificationForRenderedMessages({ force: true, delay: 0 });
        else if (!settings.llmAttributionParallel) clearAutoAttributionVerificationQueue({ clearCooldown: true });
        saveData();
    };
    $('dc-llm-attr-parallel').onchange = e => {
        settings.llmAttributionParallel = e.target.checked;
        if (settings.llmAttributionParallel) queueAutoAttributionVerificationForRenderedMessages({ force: true, delay: 0 });
        else {
            cancelStreamingAttributionVerification({ clearOverrides: true });
            if (!settings.llmAttributionCheck) clearAutoAttributionVerificationQueue({ clearCooldown: true });
            scheduleDomRefreshSeries(0);
        }
        saveData();
    };
    $('dc-attr-conservative').onchange = e => { settings.attributionConservativeOnly = e.target.checked; saveData(); };
    $('dc-attr-max-tokens').oninput = e => { settings.attributionMaxTokens = parseInt(e.target.value, 10) || 4096; saveData(); };
    $('dc-stealth-colors').onchange = e => { settings.domStealthColors = e.target.checked; saveData(); injectPrompt(); };
    $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
    $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
    $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-share-global').onchange = e => { settings.shareColorsGlobally = e.target.checked; saveData(); loadData(); updateCharList(); injectPrompt(); scheduleCustomFontRefresh(0); };
    $('dc-css-effects').onchange = e => { settings.cssEffects = e.target.checked; saveData(); injectPrompt(); };
    $('dc-disable-toasts').onchange = e => { settings.disableToasts = e.target.checked; saveData(); };
    $('dc-engine').onchange = e => {
        const wasDomEngine = isDomEngine();
        settings.coloringEngine = e.target.value === 'dom' ? 'dom' : 'llm';
        saveData();
        injectPrompt();
        updateEngineVisibility();
        if (isDomEngine()) {
            setupChatRootObserver();
            setupChatObserver();
            startDomHealthCheck();
            decorateAllMessages();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            scheduleCustomFontRefresh(0);
        }
        else if (wasDomEngine) {
            stopDomHealthCheck();
            clearAutoAttributionVerificationQueue({ clearCooldown: true });
            cancelStreamingAttributionVerification({ clearOverrides: true });
            undecorateAllMessages();
            scheduleCustomFontRefresh(0);
        }
    };
    $('dc-llm-profile').onchange = e => { settings.llmConnectionProfile = e.target.value || null; saveData(); };
    $('dc-attr-profile').onchange = e => { settings.attributionConnectionProfile = e.target.value || null; saveData(); };
    $('dc-theme').onchange = e => {
        applyThemeOrBrightnessChange(() => { settings.themeMode = e.target.value; }, { saveImmediately: true });
        saveData(); updateCharList(); injectPrompt(); flushChatSave();
    };
    $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); injectPrompt(); };
    $('dc-brightness').oninput = e => {
        const brightness = parseInt(e.target.value, 10) || 0;
        $('dc-bright-val').textContent = String(brightness);
        applyThemeOrBrightnessChange(() => { settings.brightness = brightness; });
        queueColorStateSave({ history: false });
    };
    $('dc-brightness').onchange = () => { flushColorStateSave(); flushChatSave(); };
    $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
    $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
    $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); } };
    $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-prompt-depth').oninput = e => { settings.promptDepth = parseInt(e.target.value, 10) || 0; saveData(); injectPrompt(); };
    $('dc-prompt-role').onchange = e => { settings.promptRole = e.target.value; saveData(); injectPrompt(); };
    $('dc-prompt-mode').onchange = e => { settings.promptMode = e.target.value; saveData(); injectPrompt(); };
    $('dc-copy-system-prompt').onclick = () => {
        const textarea = $('dc-system-prompt-text');
        if (!textarea) return;
        textarea.select();
        document.execCommand('copy');
        $('dc-copy-system-prompt').textContent = 'Copied!';
        setTimeout(() => { $('dc-copy-system-prompt').textContent = 'Copy Macro'; }, 1500);
    };
    $('dc-scan').onclick = scanAllMessages;
    $('dc-clear').onclick = () => {
        const allKeys = Object.keys(characterColors);
        const keptKeys = getKeptKeys(allKeys);
        if (!allKeys.length) { toast.info('No characters to clear'); return; }
        if (keptKeys.length === allKeys.length) {
            toast.info('Only pinned characters remain. Turn off Keep to clear them.');
            return;
        }
        const restore = createRestoreSnapshot();
        keepCharacterKeysOnly(keptKeys);
        commit();
        repaintDomAfterCharacterDataChange(0);
        showUndoToast(buildKeepAwareRemovalMessage('Cleared', allKeys.length - keptKeys.length, keptKeys.length), restore);
    };
    $('dc-stats').onclick = showStatsPopup;
    $('dc-recolor').onclick = () => {
        if (confirm('Recolor all messages with current color assignments?')) recolorAllMessages();
    };
    $('dc-colorize').onclick = (e) => {
        if (e.shiftKey) colorizeMessages('last');
        else if (confirm('Colorize all uncolored messages with known character colors?')) colorizeMessages('all');
    };
    $('dc-verify-attr').onclick = (e) => {
        if (e.shiftKey) runAttributionVerification(() => verifyVisibleAttributionsWithLLM({ manual: true }), { manual: true });
        else runAttributionVerification(() => verifyLatestAttributionsWithLLM({ manual: true }), { manual: true });
    };
    $('dc-fix-conflicts').onclick = autoResolveConflicts;
    $('dc-regen').onclick = regenerateAllColors;
    $('dc-flip-theme').onclick = flipColorsForTheme;
    $('dc-restore-defaults').onclick = restoreAllSettingsToDefaults;
    $('dc-save-preset').onclick = saveColorPreset;
    $('dc-load-preset').onclick = loadColorPreset;
    $('dc-delete-preset').onclick = deleteColorPreset;
    $('dc-gen-palette').onclick = async () => { await generateCustomPaletteFromWords(); };
    $('dc-save-palette').onclick = saveCustomPalette;
    $('dc-palette-name-input').onkeypress = e => { if (e.key === 'Enter') $('dc-gen-palette').click(); };
    $('dc-palette-notes-input').onkeypress = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('dc-gen-palette').click(); };
    $('dc-del-palette').onclick = deleteCustomPalette;
    $('dc-card').onclick = autoAssignFromCard;
    $('dc-avatar-color').onclick = async () => {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (!char?.avatar) { toast.info('No avatar found'); return; }
            const avatarUrl = `/characters/${encodeURIComponent(char.avatar)}`;
            const color = await extractAvatarColor(avatarUrl);
            if (!color) { toast.error('Could not extract color'); return; }
            const key = char.name.toLowerCase();
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            let needsDomRepaint = false;
            if (characterColors[key]) {
                setEntryFromBaseColor(characterColors[key], color);
                applyLiveColorChangesFromSnapshot(snapshot, [key]);
            } else {
                const built = buildCharacterEntry(char.name, { color, colorMode: 'base', locked: false, dialogueCount: 0 });
                if (!built.entry) return;
                characterColors[key] = built.entry;
                needsDomRepaint = true;
            }
            commit();
            if (needsDomRepaint) repaintDomAfterCharacterDataChange(0);
            toast.success(`Set ${char.name} to ${color}`);
        } catch {
            toast.error('Failed to extract avatar color');
        }
    };
    $('dc-save-card').onclick = saveToCard;
    $('dc-load-card').onclick = loadFromCard;
    $('dc-undo').onclick = undo;
    $('dc-redo').onclick = redo;
    $('dc-export').onclick = exportColors;
    $('dc-import').onclick = () => $('dc-import-file').click();
    $('dc-export-png').onclick = exportLegendPng;
    $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
    $('dc-export-settings').onclick = exportSettings;
    $('dc-import-settings').onclick = () => $('dc-import-settings-file').click();
    $('dc-import-settings-file').onchange = e => { if (e.target.files[0]) importSettings(e.target.files[0]); };
    $('dc-setup-autosync').onclick = () => { enableAutoSync(); updateAutoSyncUI(); };
    $('dc-disable-autosync').onclick = () => { disableAutoSync(); updateAutoSyncUI(); };
    $('dc-del-locked').onclick = () => {
        removeCharacterKeys(Object.keys(characterColors).filter(k => characterColors[k]?.locked), {
            actionLabel: 'Deleted',
            itemLabel: 'locked character',
            emptyMessage: 'No locked characters to delete',
            blockedMessage: 'Only pinned locked characters remain. Turn off Keep first.'
        });
    };
    $('dc-del-unlocked').onclick = () => {
        removeCharacterKeys(Object.keys(characterColors).filter(k => characterColors[k] && !characterColors[k].locked), {
            actionLabel: 'Deleted',
            itemLabel: 'unlocked character',
            emptyMessage: 'No unlocked characters to delete',
            blockedMessage: 'Only pinned unlocked characters remain. Turn off Keep first.'
        });
    };
    $('dc-del-least').onclick = () => {
        const min = parseInt($('dc-del-least-threshold')?.value || '3', 10);
        if (isNaN(min) || min < 0) { toast.warning('Invalid threshold'); return; }
        removeCharacterKeys(Object.keys(characterColors).filter(k => (characterColors[k]?.dialogueCount || 0) < min), {
            actionLabel: 'Deleted',
            itemLabel: 'low-dialogue character',
            emptyMessage: `No characters below ${min} dialogues`,
            blockedMessage: 'Only pinned low-dialogue characters remain. Turn off Keep first.'
        });
    };
    $('dc-del-dupes').onclick = () => {
        removeCharacterKeys(collectDuplicateColorKeys(), {
            actionLabel: 'Deleted',
            itemLabel: 'duplicate-color character',
            emptyMessage: 'No duplicate colors found',
            blockedMessage: 'Only pinned duplicate-color characters remain. Turn off Keep first.'
        });
    };
    $('dc-storage').onclick = showStorageManager;
    $('dc-lock-all').onclick = () => {
        let count = 0;
        Object.keys(characterColors).forEach(k => {
            if (!characterColors[k].locked) {
                characterColors[k].locked = true;
                count++;
            }
        });
        if (count) saveHistory();
        saveData(); updateCharList(); toast.info(`Locked ${count} characters`);
    };
    $('dc-unlock-all').onclick = () => {
        let count = 0;
        Object.keys(characterColors).forEach(k => {
            if (characterColors[k].locked) {
                characterColors[k].locked = false;
                count++;
            }
        });
        if (count) saveHistory();
        saveData(); updateCharList(); toast.info(`Unlocked ${count} characters`);
    };
    $('dc-reset').onclick = () => {
        if (!confirm('Reset all colors?')) return;
        const restore = createRestoreSnapshot();
        let changed = 0;
        const changedKeys = [];
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        Object.entries(characterColors).forEach(([key, c]) => {
            if (!c.locked) {
                setEntryFromBaseColor(c, getNextColor());
                changedKeys.push(key);
                changed++;
            }
        });
        if (!changed) { toast.info('No unlocked colors to reset'); return; }
        applyLiveColorChangesFromSnapshot(snapshot, changedKeys);
        commit();
        showUndoToast(`Reset ${changed} unlocked color${changed !== 1 ? 's' : ''}.`, restore);
    };
    $('dc-search').oninput = e => { setSearchTerm(e.target.value); updateCharList(); };
    $('dc-sort').onchange = e => { settings.sortMode = e.target.value; saveData(); updateCharList(); };
    $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
    $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };

    registerKeyboardShortcuts();
    applyControlHelpText();
    updateCharList();
    injectPrompt();
}
