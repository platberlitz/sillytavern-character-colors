// ui.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { resolveCharacterKeyByNameOrAlias, scanAllMessages } from './color-blocks.js';
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, scheduleDomRefreshSeries, scheduleDomSettleRefresh, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck, undecorateAllMessages } from './dom-engine.js';
import { loadGoogleFont, scheduleCustomFontRefresh } from './fonts.js';
import { getGradientRenderState } from './gradient-rendering.js';
import { BUILTIN_GRADIENT_PRESETS, DEFAULT_GRADIENT_ANGLE, DEFAULT_GRADIENT_DURATION, DEFAULT_GRADIENT_POSITION, MAX_GRADIENT_STOPS, buildGradientCss, cloneGradient, getBuiltInGradientPreset, getGradientSignature, normalizeGradient, normalizeGradientPresetName } from './gradients.js';
import { createRestoreSnapshot, redo, saveHistory, showUndoToast, undo } from './history.js';
import { applyFastColorUiUpdates, applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, colorizeMessages, commit, flushChatSave, flushColorStateSave, queueColorStateSave, recolorAllMessages, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { registerKeyboardShortcuts } from './main.js';
import { applyGradientPreset, autoResolveConflicts, buildCharacterEntry, collectDuplicateColorKeys, createRandomGradient, deleteColorPreset, deleteCustomPalette, detectTheme, flipColorsForTheme, generateCustomPaletteFromWords, getBaseColor, getEntryEffectiveColor, getNextColor, getPresets, invalidateThemeCache, loadColorPreset, refreshPaletteDropdown, refreshPresetDropdown, regenerateAllColors, removeCharacterKeys, saveColorPreset, saveCustomPalette, setEntryFromBaseColor, setEntryGradient, showHarmonyPopup, suggestColorForName, swapEntryColorData, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt, updateSystemPromptDisplay } from './prompts.js';
import { escapeHtml, getContext } from './st-api.js';
import { autoRecolorHintShown, characterColors, expandedCharacterRows, isDomEngine, legendListeners, searchTerm, setAutoRecolorHintShown, setCharacterColors, setLegendListeners, setSearchTerm, setSwapMode, settings, swapMode } from './state.js';
import { analyzeColorImport, analyzeSettingsImport, applyCardData, applyColorImport, applySettingsImport, archiveStoredColorData, deleteCustomGradientPreset, disableAutoSync, enableAutoSync, exportColors, exportSettings, getArchivedColorData, getCurrentStorageScope, getCustomGradientPresets, getLegendPosition, getStorageKey, getStorageLabelForKey, getStorageScopeDescriptor, getUserColorDataStore, normalizeColorDataEntry, normalizeToggleSettings, readCardData, renameCustomGradientPreset, restoreAllSettingsToDefaults, restoreArchivedColorData, saveCustomGradientPreset, saveData, saveLegendPosition, saveToCard, switchColorStorageScope, updateAutoSyncUI } from './storage.js';
import { escapeAttr, getGoogleFontFamily, htmlToNode, normalizeGoogleFontName, normalizeHexColor, normalizeManualColorInput, toast } from './utils.js';
import { cancelStreamingAttributionVerification, clearAutoAttributionVerificationQueue, queueAutoAttributionVerificationForRenderedMessages, runAttributionVerification, verifyLatestAttributionsWithLLM, verifyVisibleAttributionsWithLLM } from './verify.js';

export const DYNAMIC_CONTROL_HELP_TEXT = Object.freeze({
    '.dc-color-dot': 'Click to open the color picker for this character.',
    '.dc-color-input': 'Pick this character’s primary color.',
    '.dc-gradient-toggle': 'Enable or remove this character gradient.',
    '.dc-gradient-randomize': 'Create a new random gradient while keeping this character’s primary color.',
    '.dc-gradient-animation-enabled': 'Continuously drift the gradient colors across dialogue and labels. Your device’s Reduce Motion setting pauses the effect.',
    '.dc-gradient-preview': 'Live preview of this character gradient.',
    '.dc-gradient-add-stop': 'Add another gradient color stop.',
    '.dc-gradient-apply-preset': 'Apply the selected built-in or custom gradient preset.',
    '.dc-keep': 'Pinned characters survive Clear and bulk delete tools.',
    '.dc-lock': 'Lock this character color so reset/regen tools do not change it.',
    '.dc-more': 'Open or close this character’s editing controls.',
    '.dc-swap': 'Choose two characters in sequence to swap their colors.',
    '.dc-harmony': 'Open accessible harmony suggestions for this character color.',
    '.dc-alias': 'Add an alternate name that maps to this character.',
    '.dc-group': 'Assign this character to a group label.',
    '.dc-del': 'Delete this character from the list. Turn off Keep first if pinned.',
    '.dc-alias-remove': 'Remove this alias from the character.'
});

const GRADIENT_DIRECTIONS = Object.freeze([
    { value: 0, label: 'Up' },
    { value: 45, label: 'Up right' },
    { value: 90, label: 'Right' },
    { value: 135, label: 'Down right' },
    { value: 180, label: 'Down' },
    { value: 225, label: 'Down left' },
    { value: 270, label: 'Left' },
    { value: 315, label: 'Up left' },
]);

// Details state lives outside persisted character data but survives row reconciliation.
const expandedGradientAdvancedRows = new Set();
let lastLegendSignature = '';
let closeActiveUiDialog = null;

function getDialogFocusables(dialog) {
    return [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden && element.getClientRects().length > 0);
}

function openDecisionDialog({ title, description = '', detailsHtml = '', choices = [], checkbox = null, opener = document.activeElement }) {
    if (closeActiveUiDialog) closeActiveUiDialog(null, { restoreFocus: false });
    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'dc-dialog-backdrop';
        const titleId = `dc-dialog-title-${Date.now()}`;
        const descriptionId = description ? `${titleId}-description` : '';
        backdrop.innerHTML = `
            <div class="dc-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}"${descriptionId ? ` aria-describedby="${descriptionId}"` : ''}>
                <h2 id="${titleId}" class="dc-dialog-title">${escapeHtml(title)}</h2>
                ${description ? `<p id="${descriptionId}" class="dc-dialog-description">${escapeHtml(description)}</p>` : ''}
                ${detailsHtml ? `<div class="dc-dialog-details">${detailsHtml}</div>` : ''}
                ${checkbox ? `<label class="checkbox_label dc-dialog-checkbox"><input type="checkbox" class="dc-dialog-checkbox-input"><span>${escapeHtml(checkbox.label)}</span></label>` : ''}
                <div class="dc-dialog-actions">
                    ${choices.map(choice => `<button type="button" class="menu_button${choice.primary ? ' dc-primary-button' : ''}${choice.danger ? ' dc-danger-button' : ''}" data-dialog-value="${escapeAttr(choice.value)}"${choice.initial ? ' data-dialog-initial="true"' : ''}>${escapeHtml(choice.label)}</button>`).join('')}
                </div>
            </div>`;
        document.body.appendChild(backdrop);
        const dialog = backdrop.querySelector('.dc-dialog');
        const inertSiblings = [...document.body.children]
            .filter(element => element !== backdrop && !element.inert)
            .map(element => { element.inert = true; return element; });
        let closed = false;
        const close = (value, { restoreFocus = true } = {}) => {
            if (closed) return;
            closed = true;
            const checked = !!dialog.querySelector('.dc-dialog-checkbox-input')?.checked;
            const selected = [...dialog.querySelectorAll('.dc-dialog-select:checked')].map(input => input.dataset.value);
            document.removeEventListener('keydown', onKeyDown, true);
            inertSiblings.forEach(element => { element.inert = false; });
            backdrop.remove();
            if (closeActiveUiDialog === close) closeActiveUiDialog = null;
            if (restoreFocus && opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
            resolve({ value, checked, selected });
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(null);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusables = getDialogFocusables(dialog);
            if (!focusables.length) { event.preventDefault(); return; }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        closeActiveUiDialog = close;
        document.addEventListener('keydown', onKeyDown, true);
        backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) close(null); });
        dialog.querySelectorAll('[data-dialog-value]').forEach(button => {
            button.addEventListener('click', () => close(button.dataset.dialogValue));
        });
        (dialog.querySelector('[data-dialog-initial]') || dialog.querySelector('.dc-primary-button') || getDialogFocusables(dialog)[0])?.focus({ preventScroll: true });
    });
}

async function confirmReviewedAction({ title, description, detailsHtml = '', confirmLabel = 'Continue', danger = false, opener }) {
    const decision = await openDecisionDialog({
        title,
        description,
        detailsHtml,
        opener,
        choices: danger
            ? [
                { value: 'cancel', label: 'Cancel', initial: true },
                { value: 'confirm', label: confirmLabel, danger },
            ]
            : [
                { value: 'confirm', label: confirmLabel, primary: true, initial: true },
                { value: 'cancel', label: 'Cancel' },
            ],
    });
    return decision.value === 'confirm';
}

function formatScopeName(scope) {
    if (scope === 'chat') return 'Per chat';
    if (scope === 'global') return 'Global';
    return 'Per card';
}

function formatDate(value) {
    if (!value) return 'Not saved yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

function getGradientPresentation(entry) {
    const gradient = normalizeGradient(entry?.gradient);
    const state = getGradientRenderState(entry);
    if (!gradient || !state) return null;
    return {
        gradient,
        ...state,
        classes: `dc-has-gradient dc-gradient-${gradient.type}${state.animationEnabled ? ' dc-gradient-animated' : ''}${gradient.animation.reverse ? ' dc-gradient-reverse' : ''}`,
        dataAttributes: `data-dc-gradient="${state.type}" data-dc-gradient-animation="${state.animationEnabled ? 'on' : 'off'}" data-dc-gradient-reverse="${state.reverse}" data-gradient="${state.type}" data-gradient-type="${state.type}" data-gradient-animated="${state.animationEnabled}" data-gradient-reverse="${state.reverse}"`,
    };
}

function buildGradientSurfaceStyle(entry, { text = false } = {}) {
    const color = getEntryEffectiveColor(entry);
    const presentation = getGradientPresentation(entry);
    if (!presentation) return text ? `color:${color};` : `background-color:${color};`;
    const animationProperties = `--dc-text-gradient:${presentation.css};--dc-gradient:${presentation.css};--dc-gradient-fallback:${presentation.fallbackColor};--dc-gradient-animation-enabled:${presentation.animationEnabled ? 1 : 0};--dc-gradient-duration:${presentation.durationSeconds}s;--dc-gradient-reverse:${presentation.reverse ? 1 : 0};--dc-gradient-direction:${presentation.reverse ? 'alternate-reverse' : 'alternate'};`;
    if (text) {
        return `color:${color};${animationProperties}background-image:${presentation.css};background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;`;
    }
    return `background-color:${color};${animationProperties}background-image:${presentation.css};`;
}

function setGradientPresentation(element, entry, { text = false } = {}) {
    if (!element) return;
    const color = getEntryEffectiveColor(entry);
    const presentation = getGradientPresentation(entry);
    element.classList.toggle('dc-gradient-surface', !!presentation && !text);
    element.classList.toggle('dc-gradient-text', !!presentation && text);
    element.classList.toggle('dc-has-gradient', !!presentation);
    element.classList.toggle('dc-gradient-linear', presentation?.gradient.type === 'linear');
    element.classList.toggle('dc-gradient-radial', presentation?.gradient.type === 'radial');
    element.classList.toggle('dc-gradient-animated', !!presentation?.animationEnabled);
    element.classList.toggle('dc-gradient-reverse', !!presentation?.gradient.animation.reverse);
    element.style.color = color;
    element.style.backgroundColor = text ? '' : color;
    if (!presentation) {
        delete element.dataset.gradient;
        delete element.dataset.gradientType;
        delete element.dataset.gradientAnimated;
        delete element.dataset.gradientReverse;
        element.removeAttribute('data-dc-gradient');
        element.removeAttribute('data-dc-gradient-animation');
        element.removeAttribute('data-dc-gradient-reverse');
        element.style.removeProperty('--dc-text-gradient');
        element.style.removeProperty('--dc-gradient');
        element.style.removeProperty('--dc-gradient-fallback');
        element.style.removeProperty('--dc-gradient-animation-enabled');
        element.style.removeProperty('--dc-gradient-duration');
        element.style.removeProperty('--dc-gradient-reverse');
        element.style.removeProperty('--dc-gradient-direction');
        element.style.backgroundImage = '';
        if (text) {
            element.style.backgroundClip = '';
            element.style.webkitBackgroundClip = '';
            element.style.webkitTextFillColor = '';
        }
        return;
    }
    element.dataset.gradient = presentation.gradient.type;
    element.dataset.gradientType = presentation.gradient.type;
    element.dataset.gradientAnimated = String(presentation.animationEnabled);
    element.dataset.gradientReverse = String(presentation.gradient.animation.reverse);
    element.setAttribute('data-dc-gradient', presentation.type);
    element.setAttribute('data-dc-gradient-animation', presentation.animationEnabled ? 'on' : 'off');
    element.setAttribute('data-dc-gradient-reverse', String(presentation.reverse));
    element.style.setProperty('--dc-text-gradient', presentation.css);
    element.style.setProperty('--dc-gradient', presentation.css);
    element.style.setProperty('--dc-gradient-fallback', presentation.fallbackColor);
    element.style.setProperty('--dc-gradient-animation-enabled', presentation.animationEnabled ? '1' : '0');
    element.style.setProperty('--dc-gradient-duration', `${presentation.durationSeconds}s`);
    element.style.setProperty('--dc-gradient-reverse', presentation.reverse ? '1' : '0');
    element.style.setProperty('--dc-gradient-direction', presentation.reverse ? 'alternate-reverse' : 'alternate');
    element.style.backgroundImage = presentation.css;
    if (text) {
        element.style.backgroundClip = 'text';
        element.style.webkitBackgroundClip = 'text';
        element.style.webkitTextFillColor = 'transparent';
    }
}

function getGradientCanvasStops(entry) {
    const gradient = normalizeGradient(entry?.gradient);
    if (!gradient) return null;
    return {
        gradient,
        stops: [
            { color: getEntryEffectiveColor(entry), position: gradient.primaryPosition },
            ...gradient.stops.map(stop => ({ color: stop.color, position: stop.position })),
        ].sort((left, right) => left.position - right.position),
    };
}

export function createCanvasGradientFill(ctx, entry, bounds) {
    const data = getGradientCanvasStops(entry);
    if (!data || !ctx || !bounds) return getEntryEffectiveColor(entry);
    const x = Number(bounds.x) || 0;
    const y = Number(bounds.y) || 0;
    const width = Math.max(1, Number(bounds.width) || 1);
    const height = Math.max(1, Number(bounds.height) || 1);
    let fill;
    if (data.gradient.type === 'radial') {
        const originX = x + width * data.gradient.x / 100;
        const originY = y + height * data.gradient.y / 100;
        const radius = Math.max(
            Math.hypot(originX - x, originY - y),
            Math.hypot(originX - (x + width), originY - y),
            Math.hypot(originX - x, originY - (y + height)),
            Math.hypot(originX - (x + width), originY - (y + height))
        );
        fill = ctx.createRadialGradient(originX, originY, 0, originX, originY, Math.max(1, radius));
    } else {
        const radians = data.gradient.angle * Math.PI / 180;
        const dx = Math.sin(radians);
        const dy = -Math.cos(radians);
        const halfLength = Math.abs(width * dx) / 2 + Math.abs(height * dy) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        fill = ctx.createLinearGradient(
            centerX - dx * halfLength,
            centerY - dy * halfLength,
            centerX + dx * halfLength,
            centerY + dy * halfLength
        );
    }
    data.stops.forEach(stop => fill.addColorStop(Math.max(0, Math.min(1, stop.position / 100)), stop.color));
    return fill;
}

// Phase 6B: Group sorting support
export function getSortedEntries() {
    const needle = searchTerm.trim().toLowerCase();
    const entries = Object.entries(characterColors).filter(([, entry]) => {
        if (!needle) return true;
        return [entry.name, entry.group, entry.font, ...(entry.aliases || []), entry.keep ? 'kept pinned' : '', entry.locked ? 'locked' : '']
            .some(value => String(value || '').toLowerCase().includes(needle));
    });
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
        ctx.fillStyle = createCanvasGradientFill(ctx, v, { x: padding, y: y - dotSize / 2, width: dotSize, height: dotSize });
        ctx.fill();
        ctx.font = '14px sans-serif';
        const textX = padding + dotSize + 8;
        const textWidth = Math.max(1, ctx.measureText(v.name).width);
        ctx.fillStyle = createCanvasGradientFill(ctx, v, { x: textX, y: y - 12, width: textWidth, height: 17 }) || safeColor;
        ctx.fillText(v.name, textX, y + 5);
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

        legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:180px;max-height:60vh;overflow-y:auto;display:none;user-select:none;`;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const onMouseDown = (e) => {
            if (!e.target.closest('.dc-legend-handle') || e.target.closest('button, input')) return;
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

        const clampPosition = () => {
            if (legend.style.display === 'none') return;
            const rect = legend.getBoundingClientRect();
            const viewportWidth = window.visualViewport?.width || window.innerWidth;
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            const left = Math.max(0, Math.min(viewportWidth - rect.width, rect.left));
            const top = Math.max(0, Math.min(viewportHeight - rect.height, rect.top));
            legend.style.right = 'auto';
            legend.style.left = `${left}px`;
            legend.style.top = `${top}px`;
        };

        legend.__dcClampPosition = clampPosition;
        legend.addEventListener('click', event => {
            if (event.target.closest('.dc-legend-hide')) {
                settings.showLegend = false;
                const checkbox = document.getElementById('dc-legend');
                if (checkbox) checkbox.checked = false;
                saveData();
                legend.style.display = 'none';
            }
            if (event.target.closest('.dc-legend-reset')) {
                legend.style.right = '10px';
                legend.style.left = 'auto';
                legend.style.top = '60px';
                saveLegendPosition({ top: 60, right: 10 });
            }
        });
        legend.addEventListener('keydown', event => {
            if (!event.target.closest('.dc-legend-handle') || !event.key.startsWith('Arrow')) return;
            event.preventDefault();
            const rect = legend.getBoundingClientRect();
            const step = event.shiftKey ? 20 : 5;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            legend.style.right = 'auto';
            legend.style.left = `${rect.left + dx}px`;
            legend.style.top = `${rect.top + dy}px`;
            clampPosition();
            const nextRect = legend.getBoundingClientRect();
            saveLegendPosition({ top: nextRect.top, left: nextRect.left });
        });
        window.addEventListener('resize', clampPosition);
        window.visualViewport?.addEventListener('resize', clampPosition);

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
    const signature = JSON.stringify({
        visible: !!settings.showLegend,
        driftAll: settings.driftAllGradientColors === true,
        entries: entries.map(([key, entry]) => [
            key,
            entry.name,
            entry.dialogueCount || 0,
            getEntryEffectiveColor(entry),
            normalizeGoogleFontName(entry.font),
            getGradientSignature(entry),
        ]),
    });
    if (!entries.length || !settings.showLegend) {
        legend.style.display = 'none';
        lastLegendSignature = signature;
        return;
    }
    if (signature === lastLegendSignature && legend.style.display === 'block') return;
    lastLegendSignature = signature;
    legend.innerHTML = '<div class="dc-legend-handle" tabindex="0" role="toolbar" aria-label="Move character legend with arrow keys"><strong>Characters</strong><span><button type="button" class="dc-legend-reset" aria-label="Reset legend position" title="Reset position">↺</button><button type="button" class="dc-legend-hide" aria-label="Hide character legend" title="Hide legend">×</button></span></div>' +
        entries.map(([, v]) => {
            const presentation = getGradientPresentation(v);
            const fontFamily = getGoogleFontFamily(v.font);
            if (fontFamily) loadGoogleFont(v.font);
            const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
            const gradientClasses = presentation ? ` dc-gradient-legend-item ${presentation.classes}` : '';
            const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
            return `<div class="dc-legend-character${gradientClasses}"${gradientAttributes} style="display:flex;align-items:center;gap:4px;"><span class="dc-legend-swatch${presentation ? ' dc-gradient-surface' : ''}"${gradientAttributes} style="width:8px;height:8px;border-radius:50%;${escapeAttr(buildGradientSurfaceStyle(v))}"></span><span class="dc-legend-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(v, { text: true }))}${fontStyle}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`;
        }).join('');
    legend.style.display = settings.showLegend ? 'block' : 'none';
    if (settings.showLegend) requestAnimationFrame(() => legend.__dcClampPosition?.());
}

export function getDialogueStats() {
    const entries = Object.entries(characterColors);
    const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
    return entries.map(([, v]) => ({
        name: v.name,
        count: v.dialogueCount || 0,
        pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0,
        color: getEntryEffectiveColor(v),
        font: normalizeGoogleFontName(v.font),
        baseColor: getBaseColor(v),
        gradient: cloneGradient(v.gradient),
        gradientCss: buildGradientCss(v),
    })).sort((a, b) => b.count - a.count);
}

export async function showStatsPopup() {
    const stats = getDialogueStats();
    if (!stats.length) { toast.info('No dialogue data'); return; }
    const maxCount = Math.max(...stats.map(s => s.count), 1);
    let html = stats.map(s => {
        const statEntry = { color: s.color, baseColor: s.baseColor, gradient: s.gradient };
        const fontFamily = getGoogleFontFamily(s.font);
        if (fontFamily) loadGoogleFont(s.font);
        const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
        const presentation = getGradientPresentation(statEntry);
        const gradientClasses = presentation ? ` ${presentation.classes}` : '';
        const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
        return `<div class="dc-stats-character${gradientClasses}"${gradientAttributes}><span class="dc-stats-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(statEntry, { text: true }))}${fontStyle}">${escapeHtml(s.name)}</span><div class="dc-stats-track" aria-hidden="true"><div class="dc-stats-bar${presentation ? ' dc-gradient-surface' : ''}"${gradientAttributes} style="width:${s.count / maxCount * 100}%;${escapeAttr(buildGradientSurfaceStyle(statEntry))}"></div></div><span class="dc-stats-value">${s.count} (${s.pct}%)</span></div>`;
    }).join('');
    await openDecisionDialog({
        title: 'Dialogue activity',
        description: 'Counts represent attributed dialogue segments and can differ by coloring engine.',
        detailsHtml: `<div class="dc-stats-list">${html}</div>`,
        choices: [{ value: 'close', label: 'Close', primary: true }],
    });
}

export async function showStorageManager() {
    const currentKey = getStorageKey();
    const colorData = getUserColorDataStore();
    const keys = Object.keys(colorData).filter(k => k.startsWith('dc_char_') || k.startsWith('dc_chat_') || k === 'dc_global');
    const archived = getArchivedColorData();
    if (!keys.length && !archived) { toast.info('No stored color data found'); return; }

    const entries = keys.map(k => {
        const entry = normalizeColorDataEntry(colorData[k]) || { colors: {} };
        const raw = JSON.stringify(entry);
        const size = new Blob([raw]).size;
        const colors = entry.colors || {};
        const colorCount = Object.keys(colors).length;
        const names = Object.values(colors).map(v => v.name).filter(Boolean).slice(0, 3);
        const isCurrent = k === currentKey;
        const scope = k === 'dc_global' ? 'Global' : k.startsWith('dc_chat_') ? 'Per chat' : 'Per card';
        const identity = names.length ? names.join(', ') + (colorCount > 3 ? ` (+${colorCount - 3})` : '') : getStorageLabelForKey(k);
        const label = `${scope}: ${identity}`;
        const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
        return { key: k, label, colorCount, sizeStr, size, isCurrent, updatedAt: entry.updatedAt || '' };
    });
    entries.sort((a, b) => a.isCurrent ? -1 : b.isCurrent ? 1 : a.key.localeCompare(b.key));

    const rows = entries.map(e => {
        const tag = e.isCurrent ? '<span class="dc-current-badge">Active</span>' : '';
        return `<label class="dc-storage-row${e.isCurrent ? ' dc-storage-current' : ''}"><input type="checkbox" class="dc-dialog-select" data-value="${escapeAttr(e.key)}"${e.isCurrent ? ' disabled' : ''}><span class="dc-storage-entry"><strong>${escapeHtml(e.label)} ${tag}</strong><small>${e.colorCount} characters, ${escapeHtml(e.sizeStr)}, ${escapeHtml(formatDate(e.updatedAt))}</small></span></label>`;
    }).join('');
    const decision = await openDecisionDialog({
        title: 'Storage manager',
        description: 'Select inactive color tables to archive. The active table is managed from the main panel.',
        detailsHtml: rows ? `<div class="dc-storage-list">${rows}</div>` : '<p>No active stored tables.</p>',
        choices: [
            { value: 'archive', label: 'Archive selected', danger: true },
            ...(archived ? [{ value: 'restore', label: `Restore last archive (${archived.count})` }] : []),
            { value: 'close', label: 'Close', primary: true },
        ],
    });
    if (decision.value === 'restore') {
        const result = await restoreArchivedColorData();
        if (result.ok) toast.success(`Restored ${result.count} stored color table${result.count === 1 ? '' : 's'}.${result.skipped ? ` Skipped ${result.skipped} key${result.skipped === 1 ? '' : 's'} that now exist.` : ''}`);
        else if (result.error && result.rollbackPersisted === false) toast.error('Restore failed, and its recovery could not be saved reliably. Export your colors before reloading.');
        else if (result.error) toast.error('The archived tables could not be restored safely.');
        else toast.info('No archived color tables could be restored.');
        return;
    }
    if (decision.value !== 'archive') return;
    const selected = decision.selected.filter(key => key && key !== currentKey);
    if (!selected.length) { toast.info('Select at least one inactive table.'); return; }
    const labels = entries.filter(entry => selected.includes(entry.key)).map(entry => entry.label);
    const confirmed = await confirmReviewedAction({
        title: `Archive ${selected.length} stored color table${selected.length === 1 ? '' : 's'}?`,
        description: 'This replaces any previous storage archive. You can restore this batch from Storage Manager until another batch is archived.',
        detailsHtml: `<p class="dc-review-names">${labels.map(escapeHtml).join('<br>')}</p>`,
        confirmLabel: 'Archive selected',
        danger: true,
    });
    if (!confirmed) return;
    const result = await archiveStoredColorData(selected);
    if (result.ok) toast.success(`Archived ${result.count} stored color table${result.count === 1 ? '' : 's'}.`);
    else if (result.rollbackPersisted === false) toast.error('Archive failed, and its recovery could not be saved reliably. Export your colors before reloading.');
    else toast.error('The selected tables could not be archived safely.');
}

function syncProcessControlState() {
    document.querySelectorAll('#dc-ext .dc-process-grid button, #dc-ext .dc-process-grid select').forEach(control => {
        control.disabled = !settings.enabled || control.getAttribute('aria-busy') === 'true';
    });
}

export function setRecolorButtonBusy(isBusyState) {
    const button = document.getElementById('dc-recolor');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Recolor';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Recoloring...';
        return;
    }
    button.removeAttribute('aria-busy');
    const label = isDomEngine() ? 'Refresh rendered dialogue' : 'Recolor entire chat';
    button.dataset.defaultLabel = label;
    button.textContent = label;
    syncProcessControlState();
}

export function setColorizeButtonBusy(isBusyState) {
    const button = document.getElementById('dc-colorize');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Colorize';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Colorizing...';
        return;
    }
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.defaultLabel || 'Colorize';
    syncProcessControlState();
}

export function setVerifyAttributionButtonBusy(isBusyState) {
    const button = document.getElementById('dc-verify-attr');
    if (!button) return;
    if (isBusyState) {
        if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Verify Colors (LLM)';
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Verifying...';
        return;
    }
    button.removeAttribute('aria-busy');
    button.textContent = button.dataset.defaultLabel || 'Verify Colors (LLM)';
    syncProcessControlState();
}

export function showAutoColorizeIndicator(mesElement) {
    if (!mesElement) return;
    let indicator = mesElement.querySelector('.dc-auto-colorize-indicator');
    if (indicator) return;
    indicator = document.createElement('div');
    indicator.className = 'dc-auto-colorize-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
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
    // Names with [COLORS:] block delimiters or control characters cannot
    // round-trip through ingest and would corrupt the prompt block.
    if (/[\r\n\t\[\]=,()]/.test(name.trim())) {
        toast.error('Character names cannot contain brackets, commas, equals signs, parentheses, or line breaks.');
        return;
    }
    const key = resolveCharacterKeyByNameOrAlias(name) || name.trim().toLowerCase();
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    let needsDomRepaint = false;
    if (characterColors[key]) {
        if (color === undefined || color === null || color === '') {
            setSearchTerm('');
            const search = document.getElementById('dc-search');
            if (search) search.value = '';
            expandedCharacterRows.add(key);
            updateCharList();
            requestAnimationFrame(() => {
                const row = document.querySelector(`.dc-char[data-key="${CSS.escape(key)}"]`);
                row?.scrollIntoView({ block: 'nearest' });
                row?.querySelector('.dc-more')?.focus({ preventScroll: true });
            });
            toast.info(`${escapeHtml(characterColors[key].name)} is already in the list.`);
            return { added: false, existing: true, key };
        }
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
    return { added: true, existing: false, key };
}

export function swapColors(key1, key2) {
    if (!characterColors[key1] || !characterColors[key2]) return;
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    if (!swapEntryColorData(characterColors[key1], characterColors[key2])) return;
    applyLiveColorChangesFromSnapshot(snapshot, [key1, key2]);
    commit();
    repaintDomAfterCharacterDataChange(0);
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
    refreshGradientVisualSurfaces(keys);
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
    refreshGradientVisualSurfaces(keys);
    if (options.saveImmediately) saveData({ preserveEffectiveColors: true });
}

function formatGradientPresetName(name) {
    return String(name || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function buildGradientPresetOptionsHtml({ customOnly = false } = {}) {
    const customPresets = getCustomGradientPresets();
    const customNames = Object.keys(customPresets).sort((left, right) => left.localeCompare(right));
    let html = '<option value="">-- Select gradient --</option>';
    if (!customOnly) {
        const builtInOptions = Object.keys(BUILTIN_GRADIENT_PRESETS).map(name =>
            `<option value="builtin:${escapeAttr(name)}">${escapeHtml(formatGradientPresetName(name))}</option>`
        ).join('');
        if (builtInOptions) html += `<optgroup label="Built-in">${builtInOptions}</optgroup>`;
    }
    if (customNames.length) {
        html += `<optgroup label="Custom">${customNames.map(name => `<option value="custom:${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('')}</optgroup>`;
    }
    return html;
}

function buildGradientDirectionOptions(angle) {
    const selectedDirection = GRADIENT_DIRECTIONS.find(direction => direction.value === angle);
    const customOption = selectedDirection ? '' : `<option value="" selected>Custom (${Number(angle.toFixed(1))}°)</option>`;
    return customOption + GRADIENT_DIRECTIONS.map(direction =>
        `<option value="${direction.value}"${selectedDirection?.value === direction.value ? ' selected' : ''}>${direction.label}</option>`
    ).join('');
}

function buildGradientEditorHtml(key, entry) {
    const safeKey = escapeAttr(key);
    const safeName = escapeAttr(entry.name);
    const gradient = normalizeGradient(entry.gradient);
    const presentation = getGradientPresentation(entry);
    const previewClasses = presentation ? ` ${presentation.classes}` : '';
    const previewAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
    const presetOptions = buildGradientPresetOptionsHtml();
    const presetControls = `
        <div class="dc-gradient-presets dc-gradient-compact-presets">
            <label>Preset
                <select class="dc-gradient-preset-picker text_pole" data-key="${safeKey}" aria-label="Gradient preset for ${safeName}">${presetOptions}</select>
            </label>
            <button type="button" class="dc-gradient-apply-preset menu_button" data-key="${safeKey}" data-focus-id="gradient-preset-apply">Apply</button>
            <button type="button" class="dc-gradient-randomize menu_button" data-key="${safeKey}" data-focus-id="gradient-randomize" aria-label="Randomize gradient for ${safeName}">Randomize</button>
        </div>`;
    if (!gradient) {
        return `
            <section class="dc-gradient-editor" data-key="${safeKey}" data-gradient-enabled="false">
                <div class="dc-gradient-compact">
                    <button type="button" class="dc-gradient-toggle menu_button" data-key="${safeKey}" data-focus-id="gradient-toggle">Enable Gradient</button>
                    <div class="dc-gradient-preview" role="img" aria-label="Solid color preview for ${safeName}" style="${escapeAttr(buildGradientSurfaceStyle(entry))}"></div>
                    ${presetControls}
                </div>
            </section>`;
    }

    const primaryBaseColor = getBaseColor(entry);
    const secondStop = gradient.stops[0];
    const stopRows = [
        `<div class="dc-gradient-stop dc-gradient-stop-primary" data-stop-index="0" data-gradient-primary="true">
            <span class="dc-gradient-stop-label">Stop 1 (primary)</span>
            <label>Color <input type="color" class="dc-gradient-primary-color" data-key="${safeKey}" value="${primaryBaseColor}" aria-label="Primary gradient color for ${safeName}"></label>
            <label>Position <input type="number" class="dc-gradient-primary-position text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${gradient.primaryPosition}" aria-label="Primary gradient position for ${safeName}">%</label>
        </div>`,
        ...gradient.stops.map((stop, index) => `
        <div class="dc-gradient-stop" data-stop-index="${index + 1}" data-gradient-secondary="true">
            <span class="dc-gradient-stop-label">Stop ${index + 2}</span>
            <label>Color <input type="color" class="dc-gradient-stop-color" data-key="${safeKey}" value="${stop.baseColor}" aria-label="Gradient stop ${index + 2} color for ${safeName}"></label>
            <label>Position <input type="number" class="dc-gradient-stop-position text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${stop.position}" aria-label="Gradient stop ${index + 2} position for ${safeName}">%</label>
            <button type="button" class="dc-gradient-remove-stop menu_button dc-danger-button" data-key="${safeKey}" aria-label="Remove gradient stop ${index + 2}"${gradient.stops.length === 1 ? ' disabled' : ''}>Remove</button>
        </div>`),
    ].join('');
    const geometryControls = gradient.type === 'linear'
        ? `<div class="dc-gradient-geometry dc-gradient-linear-controls">
                <label>Exact angle <input type="number" class="dc-gradient-angle text_pole" data-key="${safeKey}" min="0" max="360" step="0.1" value="${gradient.angle}" aria-label="Exact linear gradient angle for ${safeName}">°</label>
            </div>`
        : `<div class="dc-gradient-geometry dc-gradient-radial-controls">
                <label>Origin X <input type="number" class="dc-gradient-origin-x text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${gradient.x}" aria-label="Radial gradient horizontal origin for ${safeName}">%</label>
                <label>Origin Y <input type="number" class="dc-gradient-origin-y text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${gradient.y}" aria-label="Radial gradient vertical origin for ${safeName}">%</label>
            </div>`;
    const customPresetOptions = buildGradientPresetOptionsHtml({ customOnly: true });
    return `
        <section class="dc-gradient-editor ${presentation.classes}" data-key="${safeKey}" data-gradient-enabled="true" ${presentation.dataAttributes}>
            <div class="dc-gradient-compact">
                <button type="button" class="dc-gradient-toggle menu_button dc-danger-button" data-key="${safeKey}" data-focus-id="gradient-toggle">Remove Gradient</button>
                <div class="dc-gradient-compact-colors">
                    <label>Primary <input type="color" class="dc-gradient-primary-color" data-key="${safeKey}" value="${primaryBaseColor}" aria-label="Primary gradient color for ${safeName}"></label>
                    <label>Second <input type="color" class="dc-gradient-secondary-color" data-key="${safeKey}" value="${secondStop.baseColor}" aria-label="Second gradient color for ${safeName}"></label>
                </div>
                <label>Type
                    <select class="dc-gradient-type text_pole" data-key="${safeKey}" data-focus-id="gradient-type" aria-label="Gradient type for ${safeName}">
                        <option value="linear"${gradient.type === 'linear' ? ' selected' : ''}>Linear</option>
                        <option value="radial"${gradient.type === 'radial' ? ' selected' : ''}>Radial</option>
                    </select>
                </label>
                ${gradient.type === 'linear' ? `<label>Direction <select class="dc-gradient-direction text_pole" data-key="${safeKey}" aria-label="Linear gradient direction for ${safeName}">${buildGradientDirectionOptions(gradient.angle)}</select></label>` : ''}
                <label class="checkbox_label dc-gradient-animation-toggle"><input type="checkbox" class="dc-gradient-animation-enabled" data-key="${safeKey}"${gradient.animation.enabled ? ' checked' : ''}><span>Drift colors</span><span class="dc-gradient-motion-paused">Paused by Reduce Motion</span></label>
                <div class="dc-gradient-preview dc-gradient-surface${previewClasses}" role="img" aria-label="Live gradient preview for ${safeName}"${previewAttributes} style="${escapeAttr(buildGradientSurfaceStyle(entry))}"></div>
                ${presetControls}
            </div>
            <details class="dc-gradient-advanced" data-key="${safeKey}"${expandedGradientAdvancedRows.has(key) ? ' open' : ''}>
                <summary>Advanced Gradient</summary>
                <div class="dc-gradient-stops-advanced">
                    ${stopRows}
                    <button type="button" class="dc-gradient-add-stop menu_button" data-key="${safeKey}" data-focus-id="gradient-add-stop"${gradient.stops.length + 1 >= MAX_GRADIENT_STOPS ? ' disabled' : ''}>Add Stop (${gradient.stops.length + 1}/${MAX_GRADIENT_STOPS})</button>
                </div>
                ${geometryControls}
                <div class="dc-gradient-animation-controls">
                    <label>Animation duration <input type="number" class="dc-gradient-animation-duration text_pole" data-key="${safeKey}" min="0.5" max="120" step="0.5" value="${gradient.animation.duration}" aria-label="Gradient animation duration for ${safeName}"> seconds</label>
                    <label class="checkbox_label"><input type="checkbox" class="dc-gradient-animation-reverse" data-key="${safeKey}"${gradient.animation.reverse ? ' checked' : ''}><span>Reverse animation</span></label>
                </div>
                <div class="dc-gradient-custom-presets">
                    <label>Preset name <input type="text" class="dc-gradient-preset-name text_pole" data-key="${safeKey}" maxlength="80" placeholder="Gradient preset name" aria-label="New custom gradient preset name for ${safeName}"></label>
                    <button type="button" class="dc-gradient-save-custom-preset menu_button" data-key="${safeKey}">Save Current</button>
                    <label>Custom preset <select class="dc-gradient-custom-preset text_pole" data-key="${safeKey}" aria-label="Custom gradient preset for ${safeName}">${customPresetOptions}</select></label>
                    <button type="button" class="dc-gradient-apply-custom-preset menu_button" data-key="${safeKey}">Apply Custom</button>
                    <label>New name <input type="text" class="dc-gradient-preset-rename text_pole" data-key="${safeKey}" maxlength="80" placeholder="Rename selected preset" aria-label="New custom gradient preset name for ${safeName}"></label>
                    <button type="button" class="dc-gradient-rename-custom-preset menu_button" data-key="${safeKey}">Rename</button>
                    <button type="button" class="dc-gradient-delete-custom-preset menu_button dc-danger-button" data-key="${safeKey}">Delete</button>
                </div>
            </details>
        </section>`;
}

function refreshGradientVisualSurfaces(keys = Object.keys(characterColors)) {
    const list = document.getElementById('dc-char-list');
    const keyList = Array.isArray(keys) ? keys : [keys];
    keyList.forEach(key => {
        const entry = characterColors[key];
        if (!entry || !list) return;
        const row = list.querySelector(`.dc-char[data-key="${CSS.escape(key)}"]`);
        if (!row) return;
        const presentation = getGradientPresentation(entry);
        row.classList.toggle('dc-has-gradient', !!presentation);
        row.classList.toggle('dc-gradient-linear', presentation?.gradient.type === 'linear');
        row.classList.toggle('dc-gradient-radial', presentation?.gradient.type === 'radial');
        row.classList.toggle('dc-gradient-animated', !!presentation?.animationEnabled);
        row.classList.toggle('dc-gradient-reverse', !!presentation?.gradient.animation.reverse);
        if (presentation) {
            row.dataset.gradient = presentation.gradient.type;
            row.dataset.gradientType = presentation.gradient.type;
            row.dataset.gradientAnimated = String(presentation.animationEnabled);
            row.dataset.gradientReverse = String(presentation.gradient.animation.reverse);
            row.setAttribute('data-dc-gradient', presentation.type);
            row.setAttribute('data-dc-gradient-animation', presentation.animationEnabled ? 'on' : 'off');
            row.setAttribute('data-dc-gradient-reverse', String(presentation.reverse));
        } else {
            delete row.dataset.gradient;
            delete row.dataset.gradientType;
            delete row.dataset.gradientAnimated;
            delete row.dataset.gradientReverse;
            row.removeAttribute('data-dc-gradient');
            row.removeAttribute('data-dc-gradient-animation');
            row.removeAttribute('data-dc-gradient-reverse');
        }
        setGradientPresentation(row.querySelector('.dc-color-dot'), entry);
        setGradientPresentation(row.querySelector('.dc-char-name'), entry, { text: true });
        setGradientPresentation(row.querySelector('.dc-gradient-preview'), entry);
        row.querySelectorAll('.dc-gradient-primary-color').forEach(input => {
            const baseColor = getBaseColor(entry);
            if (input.value !== baseColor) input.value = baseColor;
        });
        const editor = row.querySelector('.dc-gradient-editor');
        if (editor) {
            editor.dataset.gradientEnabled = String(!!presentation);
            editor.classList.toggle('dc-has-gradient', !!presentation);
            editor.classList.toggle('dc-gradient-animated', !!presentation?.animationEnabled);
            editor.classList.toggle('dc-gradient-reverse', !!presentation?.gradient.animation.reverse);
            if (presentation) {
                editor.dataset.gradient = presentation.gradient.type;
                editor.dataset.gradientType = presentation.gradient.type;
                editor.dataset.gradientAnimated = String(presentation.animationEnabled);
                editor.dataset.gradientReverse = String(presentation.gradient.animation.reverse);
                editor.setAttribute('data-dc-gradient', presentation.type);
                editor.setAttribute('data-dc-gradient-animation', presentation.animationEnabled ? 'on' : 'off');
                editor.setAttribute('data-dc-gradient-reverse', String(presentation.reverse));
            } else {
                delete editor.dataset.gradient;
                delete editor.dataset.gradientType;
                delete editor.dataset.gradientAnimated;
                delete editor.dataset.gradientReverse;
                editor.removeAttribute('data-dc-gradient');
                editor.removeAttribute('data-dc-gradient-animation');
                editor.removeAttribute('data-dc-gradient-reverse');
            }
        }
    });
    updateLegend();
}

export function buildCharRowHtml(k, v) {
    const safeKey = escapeAttr(k);
    const safeColor = getEntryEffectiveColor(v);
    const pickerColor = getBaseColor(v, safeColor);
    const gradientPresentation = getGradientPresentation(v);
    const gradientClasses = gradientPresentation ? ` ${gradientPresentation.classes}` : '';
    const gradientAttributes = gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : '';
    const rowExpanded = expandedCharacterRows.has(k);
    const styleLabel = v.style || 'Normal';
    const fontName = normalizeGoogleFontName(v.font);
    const fontFamily = getGoogleFontFamily(fontName);
    if (fontFamily) loadGoogleFont(fontName);
    const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
    const statusBadges = [
        v.locked ? '<span class="dc-status-chip dc-status-chip-lock">Locked</span>' : '',
        v.group ? `<span class="dc-status-chip">${escapeHtml(v.group)}</span>` : '',
        v.style ? `<span class="dc-status-chip">${escapeHtml(styleLabel)}</span>` : '',
        fontName ? `<span class="dc-status-chip" style="${fontStyle}">${escapeHtml(fontName)}</span>` : '',
        getBadge(v.dialogueCount || 0) ? `<span class="dc-status-chip">${getBadge(v.dialogueCount || 0)}</span>` : ''
    ].filter(Boolean).join('');
    const aliasChips = (v.aliases || []).map(a =>
        `<span class="dc-alias-chip">${escapeHtml(a)}<button type="button" class="dc-alias-remove" data-key="${safeKey}" data-alias="${escapeAttr(a)}" aria-label="Remove alias ${escapeAttr(a)} from ${escapeAttr(v.name)}">&times;</button></span>`
    ).join('');
    return `
        <article class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${v.keep ? 'dc-char-kept' : ''}${gradientClasses}" data-key="${safeKey}" role="listitem" aria-label="${escapeAttr(v.name)}"${gradientAttributes}>
            <div class="dc-char-main">
                <span class="dc-color-swatch">
                    <span class="dc-color-dot${gradientPresentation ? ' dc-gradient-surface' : ''}"${gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : ''} style="${escapeAttr(buildGradientSurfaceStyle(v))}"></span>
                    <input type="color" value="${pickerColor}" data-key="${safeKey}" class="dc-color-input" aria-label="Color for ${escapeAttr(v.name)}">
                </span>
                <div class="dc-char-name-wrap" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}${fontName ? '\nFont: ' + escapeHtml(fontName) : ''}">
                    <div class="dc-char-name${gradientPresentation ? ' dc-gradient-text' : ''}"${gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : ''} style="${escapeAttr(buildGradientSurfaceStyle(v, { text: true }))}${fontStyle}">${escapeHtml(v.name)}</div>
                    <div class="dc-char-meta">
                        <span class="dc-char-count">${v.dialogueCount || 0} dialogue segment${v.dialogueCount === 1 ? '' : 's'}</span>
                        ${statusBadges}
                    </div>
                </div>
                <button type="button" class="dc-keep menu_button ${v.keep ? 'dc-toggle-active' : ''}" data-key="${safeKey}" data-focus-id="keep" aria-pressed="${v.keep ? 'true' : 'false'}">${v.keep ? 'Kept' : 'Keep'}</button>
                <button type="button" class="dc-more menu_button" data-key="${safeKey}" data-focus-id="more" aria-expanded="${rowExpanded ? 'true' : 'false'}">${rowExpanded ? 'Close' : 'Edit'}</button>
            </div>
            ${aliasChips ? `<div class="dc-alias-list">${aliasChips}</div>` : ''}
            ${rowExpanded ? `
            <div class="dc-char-advanced">
                <div class="dc-field-row dc-character-color-row">
                    <label class="dc-inline-label" for="dc-color-${safeKey}">Primary color</label>
                    <input id="dc-color-${safeKey}" type="text" value="${escapeAttr(pickerColor)}" data-key="${safeKey}" class="dc-color-hex text_pole" inputmode="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="7" aria-label="Hex color for ${escapeAttr(v.name)}">
                    <button type="button" class="dc-harmony menu_button" data-key="${safeKey}" data-focus-id="harmony">Harmony</button>
                </div>
                <div class="dc-inline-toolbar">
                    <button type="button" class="dc-lock menu_button ${v.locked ? 'dc-toggle-active' : ''}" data-key="${safeKey}" data-focus-id="lock" aria-pressed="${v.locked ? 'true' : 'false'}">${v.locked ? 'Locked' : 'Lock'}</button>
                    <button type="button" class="dc-swap menu_button" data-key="${safeKey}" data-focus-id="swap">Swap</button>
                    <label class="dc-compact-label">Style <select class="dc-style-select text_pole" data-key="${safeKey}" data-focus-id="style" aria-label="Dialogue style for ${escapeAttr(v.name)}"><option value=""${!v.style ? ' selected' : ''}>Normal</option><option value="bold"${v.style === 'bold' ? ' selected' : ''}>Bold</option><option value="italic"${v.style === 'italic' ? ' selected' : ''}>Italic</option><option value="bold italic"${v.style === 'bold italic' ? ' selected' : ''}>Bold italic</option></select></label>
                    <button type="button" class="dc-font menu_button" data-key="${safeKey}" data-focus-id="font">${fontName ? 'Edit Font' : 'Set Font'}</button>
                    <button type="button" class="dc-alias menu_button" data-key="${safeKey}" data-focus-id="alias">Add Alias</button>
                    <button type="button" class="dc-group menu_button" data-key="${safeKey}" data-focus-id="group">${v.group ? 'Edit Group' : 'Set Group'}</button>
                    <button type="button" class="dc-del menu_button dc-danger-button" data-key="${safeKey}" data-focus-id="delete">Delete</button>
                </div>
                ${buildGradientEditorHtml(k, v)}
            </div>` : ''}
        </article>`;
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
        settings.driftAllGradientColors ? 1 : 0,
        getGradientSignature(v),
        (v.aliases || []).join('\u0001'),
        v.name || ''
    ].join('\u0002');
}

export function applyColorInputForElement(i, options = {}) {
    const c = characterColors[i.dataset.key];
    if (!c) return false;
    if (applyCharacterBaseColor(i.dataset.key, normalizeHexColor(i.value, getBaseColor(c)), options)) {
        queueColorStateSave({ updateList: !c.gradient });
        if (c.gradient) refreshGradientVisualSurfaces([i.dataset.key]);
        return true;
    }
    return false;
}

function previewCharacterSurfaces(key, entry) {
    const row = document.querySelector(`.dc-char[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    setGradientPresentation(row.querySelector('.dc-color-dot'), entry);
    setGradientPresentation(row.querySelector('.dc-char-name'), entry, { text: true });
    setGradientPresentation(row.querySelector('.dc-gradient-preview'), entry);
}

function previewColorInputForElement(input) {
    const entry = characterColors[input.dataset.key];
    if (!entry) return;
    const nextColor = normalizeHexColor(input.value, getBaseColor(entry));
    const previewEntry = JSON.parse(JSON.stringify(entry));
    setEntryFromBaseColor(previewEntry, nextColor);
    const hexInput = input.closest('.dc-char')?.querySelector('.dc-color-hex');
    if (hexInput) hexInput.value = nextColor;
    previewCharacterSurfaces(input.dataset.key, previewEntry);
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
    if (applyCharacterBaseColor(i.dataset.key, nextColor, options)) {
        queueColorStateSave({ updateList: !c.gradient });
        if (c.gradient) refreshGradientVisualSurfaces([i.dataset.key]);
    }
    return true;
}

// Phase 5B: Alias chips, Phase 6B: Group headers, Phase 5D: Harmony on dblclick

// Event delegation: handlers are installed once on the list container, so
// re-rendering rows never needs to rebind per-row listeners.
function handleColorDotClick(dotEl) {
    const input = dotEl.nextElementSibling;
    if (input?.classList.contains('dc-color-input')) input.click();
}

function handleMoreClick(moreBtn) {
    toggleCharacterRowExpansion(moreBtn.dataset.key);
    updateCharList();
}

function focusCharacterControl(key, focusId) {
    requestAnimationFrame(() => {
        document.querySelector(`.dc-char[data-key="${CSS.escape(key)}"] [data-focus-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    });
}

async function handleDeleteClick(delBtn) {
    const key = delBtn.dataset.key;
    const name = characterColors[key]?.name || 'this character';
    const rows = [...(delBtn.closest('.dc-char-list')?.querySelectorAll('.dc-char') || [])];
    const rowIndex = rows.indexOf(delBtn.closest('.dc-char'));
    const fallbackKey = rows[rowIndex + 1]?.dataset.key || rows[rowIndex - 1]?.dataset.key || '';
    const result = await confirmCharacterRemoval([key], {
        title: `Delete ${name}?`,
        actionLabel: 'Deleted',
        emptyMessage: 'Character already removed.',
        blockedMessage: 'Turn off Keep before deleting this character.',
        opener: delBtn,
    });
    if (result?.removed) {
        if (fallbackKey && characterColors[fallbackKey]) focusCharacterControl(fallbackKey, 'more');
        else requestAnimationFrame(() => document.getElementById('dc-search')?.focus({ preventScroll: true }));
    }
}

function handleKeepClick(keepBtn) {
    const key = keepBtn.dataset.key;
    if (!characterColors[key]) return;
    characterColors[key].keep = !characterColors[key].keep;
    saveHistory();
    saveData();
    updateCharList();
    toast.info(characterColors[key].keep ? `${escapeHtml(characterColors[key].name)} will now survive Clear and bulk delete.` : `${escapeHtml(characterColors[key].name)} can now be cleared or deleted normally.`);
}

function handleLockClick(lockBtn) {
    const key = lockBtn.dataset.key;
    if (!characterColors[key]) return;
    characterColors[key].locked = !characterColors[key].locked;
    saveHistory();
    saveData(); updateCharList();
}

function handleSwapClick(swapBtn) {
    if (!swapMode) { setSwapMode(swapBtn.dataset.key); updateCharList(); toast.info('Click another character to swap'); }
    else if (swapMode === swapBtn.dataset.key) { setSwapMode(null); updateCharList(); }
    else {
        const firstKey = swapMode;
        setSwapMode(null);
        swapColors(firstKey, swapBtn.dataset.key);
    }
}

function handleStyleSelect(styleSelect) {
    const key = styleSelect.dataset.key;
    if (!characterColors[key]) return;
    characterColors[key].style = ['', 'bold', 'italic', 'bold italic'].includes(styleSelect.value) ? styleSelect.value : '';
    commit();
    repaintDomAfterCharacterDataChange(0);
}

function handleAliasRemoveClick(e, aliasRemoveBtn) {
    e.stopPropagation();
    const key = aliasRemoveBtn.dataset.key;
    const alias = aliasRemoveBtn.dataset.alias;
    if (characterColors[key]?.aliases) {
        const nextAliases = characterColors[key].aliases.filter(a => a !== alias);
        if (nextAliases.length !== characterColors[key].aliases.length) {
            characterColors[key].aliases = nextAliases;
            commit();
            repaintDomAfterCharacterDataChange(0);
            focusCharacterControl(key, 'alias');
        }
    }
}

function handleAliasClick(aliasBtn) {
    const row = aliasBtn.closest('.dc-char');
    const existing = row.querySelector('.dc-inline-input');
    if (existing) { existing.remove(); return; }
    const inputRow = document.createElement('div');
    inputRow.className = 'dc-inline-input';
    const key = aliasBtn.dataset.key;
    const inputId = `dc-alias-input-${key}`;
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Alias for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Alias name"><button type="button" class="menu_button dc-inline-submit">Add</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'alias'); };
    const submit = () => {
        const alias = inp.value.trim();
        if (alias) {
            const existingKey = resolveCharacterKeyByNameOrAlias(alias);
            if (existingKey && existingKey !== key) {
                inp.setAttribute('aria-invalid', 'true');
                toast.warning(`${escapeHtml(alias)} already belongs to another character.`);
                return;
            }
            const aliases = characterColors[key].aliases = characterColors[key].aliases || [];
            if (!aliases.includes(alias)) {
                aliases.push(alias);
                commit();
                repaintDomAfterCharacterDataChange(0);
                focusCharacterControl(key, 'alias');
            } else {
                close();
            }
        }
        else close();
    };
    inputRow.querySelector('.dc-inline-submit').onclick = submit;
    inputRow.querySelector('.dc-inline-cancel').onclick = close;
    inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') close(); };
}

function handleFontClick(fontBtn) {
    const row = fontBtn.closest('.dc-char');
    const existing = row.querySelector('.dc-inline-input');
    if (existing) { existing.remove(); return; }
    const key = fontBtn.dataset.key;
    const current = normalizeGoogleFontName(characterColors[key]?.font);
    const inputRow = document.createElement('div');
    inputRow.className = 'dc-inline-input';
    const inputId = `dc-font-input-${key}`;
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Google Font for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Google Font name" value="${escapeAttr(current)}"><button type="button" class="menu_button dc-inline-submit">Set</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    inp.select();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'font'); };
    const submit = () => {
        if (!characterColors[key]) { close(); return; }
        const nextFont = normalizeGoogleFontName(inp.value);
        if ((normalizeGoogleFontName(characterColors[key].font)) !== nextFont) {
            characterColors[key].font = nextFont;
            if (nextFont) loadGoogleFont(nextFont);
            commit();
            repaintDomAfterCharacterDataChange(0);
            focusCharacterControl(key, 'font');
        } else {
            close();
        }
    };
    inputRow.querySelector('.dc-inline-submit').onclick = submit;
    inputRow.querySelector('.dc-inline-cancel').onclick = close;
    inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') close(); };
}

function handleGroupClick(groupBtn) {
    const row = groupBtn.closest('.dc-char');
    const existing = row.querySelector('.dc-inline-input');
    if (existing) { existing.remove(); return; }
    const key = groupBtn.dataset.key;
    const current = characterColors[key]?.group || '';
    const inputRow = document.createElement('div');
    inputRow.className = 'dc-inline-input';
    const inputId = `dc-group-input-${key}`;
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Group for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Group name" value="${escapeAttr(current)}"><button type="button" class="menu_button dc-inline-submit">Set</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    inp.select();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'group'); };
    const submit = () => {
        const nextGroup = inp.value.trim();
        if ((characterColors[key]?.group || '') !== nextGroup) {
            characterColors[key].group = nextGroup;
            saveHistory();
            saveData(); updateCharList();
            focusCharacterControl(key, 'group');
        } else {
            close();
        }
    };
    inputRow.querySelector('.dc-inline-submit').onclick = submit;
    inputRow.querySelector('.dc-inline-cancel').onclick = close;
    inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') close(); };
}

function getGradientEditorContext(control) {
    const editor = control?.closest?.('.dc-gradient-editor');
    const key = control?.dataset?.key || editor?.dataset?.key;
    const entry = key ? characterColors[key] : null;
    return { editor, key, entry };
}

function readGradientNumber(editor, selector, fallback) {
    const rawValue = editor?.querySelector(selector)?.value;
    if (rawValue === '' || rawValue === undefined) return fallback;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : fallback;
}

function synchronizeGradientColorControls(control, editor) {
    if (control.classList.contains('dc-gradient-secondary-color')) {
        const advancedSecond = editor.querySelector('.dc-gradient-stop[data-stop-index="1"] .dc-gradient-stop-color');
        if (advancedSecond) advancedSecond.value = control.value;
    } else if (control.classList.contains('dc-gradient-stop-color') && control.closest('.dc-gradient-stop')?.dataset.stopIndex === '1') {
        const compactSecond = editor.querySelector('.dc-gradient-secondary-color');
        if (compactSecond) compactSecond.value = control.value;
    }
}

function readGradientFromEditor(editor, entry) {
    const current = cloneGradient(entry?.gradient);
    if (!editor || !current) return null;
    const type = editor.querySelector('.dc-gradient-type')?.value === 'radial' ? 'radial' : 'linear';
    const stops = [...editor.querySelectorAll('.dc-gradient-stop[data-gradient-secondary="true"]')].map((row, index) => {
        const fallback = current.stops[index] || current.stops[current.stops.length - 1];
        const baseColor = normalizeHexColor(row.querySelector('.dc-gradient-stop-color')?.value, fallback?.baseColor || getBaseColor(entry));
        return {
            baseColor,
            color: baseColor,
            position: readGradientNumber(row, '.dc-gradient-stop-position', fallback?.position ?? DEFAULT_GRADIENT_POSITION),
        };
    });
    return {
        ...current,
        type,
        angle: readGradientNumber(editor, '.dc-gradient-angle', current.angle),
        x: readGradientNumber(editor, '.dc-gradient-origin-x', current.x),
        y: readGradientNumber(editor, '.dc-gradient-origin-y', current.y),
        primaryPosition: readGradientNumber(editor, '.dc-gradient-primary-position', current.primaryPosition),
        stops,
        animation: {
            enabled: !!editor.querySelector('.dc-gradient-animation-enabled')?.checked,
            duration: readGradientNumber(editor, '.dc-gradient-animation-duration', current.animation.duration),
            reverse: !!editor.querySelector('.dc-gradient-animation-reverse')?.checked,
        },
    };
}

function synchronizeGradientEditorFromEntry(editor, entry) {
    const gradient = normalizeGradient(entry?.gradient);
    if (!editor || !gradient) return;
    const primaryPosition = editor.querySelector('.dc-gradient-primary-position');
    if (primaryPosition) primaryPosition.value = String(gradient.primaryPosition);
    const secondaryRows = [...editor.querySelectorAll('.dc-gradient-stop[data-gradient-secondary="true"]')];
    secondaryRows.forEach((row, index) => {
        const stop = gradient.stops[index];
        if (!stop) return;
        const colorInput = row.querySelector('.dc-gradient-stop-color');
        const positionInput = row.querySelector('.dc-gradient-stop-position');
        if (colorInput) colorInput.value = stop.baseColor;
        if (positionInput) positionInput.value = String(stop.position);
    });
    const compactSecond = editor.querySelector('.dc-gradient-secondary-color');
    if (compactSecond && gradient.stops[0]) compactSecond.value = gradient.stops[0].baseColor;
    const angleInput = editor.querySelector('.dc-gradient-angle');
    if (angleInput) angleInput.value = String(gradient.angle);
    const directionSelect = editor.querySelector('.dc-gradient-direction');
    if (directionSelect) {
        const isFriendlyDirection = GRADIENT_DIRECTIONS.some(direction => direction.value === gradient.angle);
        const customOption = [...directionSelect.options].find(option => option.value === '');
        if (customOption) customOption.textContent = `Custom (${Number(gradient.angle.toFixed(1))}°)`;
        directionSelect.value = isFriendlyDirection ? String(gradient.angle) : '';
    }
    const originX = editor.querySelector('.dc-gradient-origin-x');
    const originY = editor.querySelector('.dc-gradient-origin-y');
    if (originX) originX.value = String(gradient.x);
    if (originY) originY.value = String(gradient.y);
    const duration = editor.querySelector('.dc-gradient-animation-duration');
    if (duration) duration.value = String(gradient.animation.duration);
}

function applyGradientValue(key, gradient, { commitImmediately = false, saveImmediately = false } = {}) {
    const entry = characterColors[key];
    if (!entry) return false;
    const previousStructure = `${entry.gradient?.type || 'none'}:${entry.gradient?.stops?.length || 0}`;
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    setEntryGradient(entry, gradient);
    const nextStructure = `${entry.gradient?.type || 'none'}:${entry.gradient?.stops?.length || 0}`;
    applyLiveColorChangesFromSnapshot(snapshot, [key], { saveImmediately });
    repaintDomAfterCharacterDataChange(0);
    if (commitImmediately) commit();
    else queueColorStateSave({ updateList: false });
    if (previousStructure !== nextStructure) updateCharList();
    else refreshGradientVisualSurfaces([key]);
    return true;
}

function handleGradientPrimaryInput(control, final = false) {
    const { editor, key, entry } = getGradientEditorContext(control);
    if (!editor || !entry) return;
    const nextColor = normalizeHexColor(control.value, getBaseColor(entry));
    if (!final) {
        const previewEntry = JSON.parse(JSON.stringify(entry));
        setEntryFromBaseColor(previewEntry, nextColor);
        editor.querySelectorAll('.dc-gradient-primary-color').forEach(input => { input.value = nextColor; });
        previewCharacterSurfaces(key, previewEntry);
        return;
    }
    if (!applyCharacterBaseColor(key, nextColor, { saveImmediately: final })) return;
    editor.querySelectorAll('.dc-gradient-primary-color').forEach(input => { input.value = getBaseColor(characterColors[key]); });
    queueColorStateSave({ updateList: false });
    refreshGradientVisualSurfaces([key]);
    if (final) {
        flushColorStateSave();
        maybeAutoRecolorAfterColorChange();
    }
}

function handleGradientEditorMutation(control, { commitImmediately = false, final = false } = {}) {
    const { editor, key, entry } = getGradientEditorContext(control);
    if (!editor || !entry?.gradient) return;
    if (control.type === 'number' && control.value !== '') {
        const value = Number(control.value);
        const minimum = Number(control.min);
        const maximum = Number(control.max);
        if (Number.isFinite(value)) control.value = String(Math.max(minimum, Math.min(maximum, value)));
    }
    synchronizeGradientColorControls(control, editor);
    if (control.classList.contains('dc-gradient-direction') && control.value !== '') {
        const angleInput = editor.querySelector('.dc-gradient-angle');
        if (angleInput) angleInput.value = control.value;
    } else if (control.classList.contains('dc-gradient-angle')) {
        const directionSelect = editor.querySelector('.dc-gradient-direction');
        if (directionSelect) {
            const angle = Number(control.value);
            directionSelect.value = GRADIENT_DIRECTIONS.some(direction => direction.value === angle) ? String(angle) : '';
        }
    }
    const gradient = readGradientFromEditor(editor, entry);
    if (!gradient) return;
    if (!final && !commitImmediately) {
        const previewEntry = JSON.parse(JSON.stringify(entry));
        setEntryGradient(previewEntry, gradient);
        previewCharacterSurfaces(key, previewEntry);
        return;
    }
    applyGradientValue(key, gradient, { commitImmediately, saveImmediately: final });
    if (final && !commitImmediately) synchronizeGradientEditorFromEntry(editor, characterColors[key]);
    if (final && !commitImmediately) flushColorStateSave();
}

function createDefaultGradient(entry) {
    const secondaryBaseColor = normalizeHexColor(getNextColor(), getBaseColor(entry));
    return {
        type: 'linear',
        angle: DEFAULT_GRADIENT_ANGLE,
        x: DEFAULT_GRADIENT_POSITION,
        y: DEFAULT_GRADIENT_POSITION,
        primaryPosition: 0,
        stops: [{ baseColor: secondaryBaseColor, color: secondaryBaseColor, position: 100 }],
        animation: { enabled: false, duration: DEFAULT_GRADIENT_DURATION, reverse: false },
    };
}

function handleGradientToggle(toggleButton) {
    const key = toggleButton.dataset.key;
    const entry = characterColors[key];
    if (!entry) return;
    applyGradientValue(key, entry.gradient ? null : createDefaultGradient(entry), { commitImmediately: true, saveImmediately: true });
}

function handleGradientRandomize(button) {
    const key = button.dataset.key;
    const entry = characterColors[key];
    if (!entry) return;
    const gradient = createRandomGradient(entry);
    if (!gradient) return;
    applyGradientValue(key, gradient, { commitImmediately: true, saveImmediately: true });
}

function getNewGradientStopPosition(gradient) {
    const positions = [0, gradient.primaryPosition, ...gradient.stops.map(stop => stop.position), 100]
        .sort((left, right) => left - right);
    let bestStart = positions[0];
    let bestEnd = positions[1];
    for (let index = 1; index < positions.length - 1; index++) {
        if (positions[index + 1] - positions[index] > bestEnd - bestStart) {
            bestStart = positions[index];
            bestEnd = positions[index + 1];
        }
    }
    return Number(((bestStart + bestEnd) / 2).toFixed(1));
}

function handleGradientAddStop(button) {
    const { editor, key, entry } = getGradientEditorContext(button);
    const gradient = readGradientFromEditor(editor, entry);
    if (!gradient || gradient.stops.length + 1 >= MAX_GRADIENT_STOPS) return;
    const baseColor = normalizeHexColor(getNextColor(), getBaseColor(entry));
    gradient.stops.push({ baseColor, color: baseColor, position: getNewGradientStopPosition(gradient) });
    applyGradientValue(key, gradient, { commitImmediately: true, saveImmediately: true });
}

function handleGradientRemoveStop(button) {
    const { editor, key, entry } = getGradientEditorContext(button);
    const gradient = readGradientFromEditor(editor, entry);
    const stopIndex = Number(button.closest('.dc-gradient-stop')?.dataset.stopIndex) - 1;
    if (!gradient || gradient.stops.length <= 1 || !Number.isInteger(stopIndex) || stopIndex < 0) return;
    gradient.stops.splice(stopIndex, 1);
    applyGradientValue(key, gradient, { commitImmediately: true, saveImmediately: true });
}

function resolveGradientPreset(value) {
    if (value?.startsWith('builtin:')) return getBuiltInGradientPreset(value.slice(8));
    if (value?.startsWith('custom:')) return getCustomGradientPresets()[value.slice(7)] || null;
    return null;
}

function applySelectedGradientPreset(key, value) {
    const entry = characterColors[key];
    const preset = resolveGradientPreset(value);
    if (!entry || !preset) {
        toast.warning('Select a gradient preset first');
        return false;
    }
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    if (!applyGradientPreset(entry, preset)) {
        toast.error('Gradient preset is invalid');
        return false;
    }
    setEntryGradient(entry, entry.gradient);
    applyLiveColorChangesFromSnapshot(snapshot, [key], { saveImmediately: true });
    applyFastColorUiUpdates([key]);
    commit();
    refreshGradientVisualSurfaces([key]);
    repaintDomAfterCharacterDataChange(0);
    maybeAutoRecolorAfterColorChange();
    toast.success('Gradient preset applied');
    return true;
}

function handleGradientPresetApply(button) {
    const { editor, key } = getGradientEditorContext(button);
    applySelectedGradientPreset(key, editor?.querySelector('.dc-gradient-preset-picker')?.value);
}

function handleCustomGradientPresetApply(button) {
    const { editor, key } = getGradientEditorContext(button);
    applySelectedGradientPreset(key, editor?.querySelector('.dc-gradient-custom-preset')?.value);
}

export function refreshGradientPresetControls(preferredCustomName = '') {
    const generalOptions = buildGradientPresetOptionsHtml();
    const customOptions = buildGradientPresetOptionsHtml({ customOnly: true });
    document.querySelectorAll('.dc-gradient-preset-picker').forEach(select => {
        const previous = preferredCustomName ? `custom:${preferredCustomName}` : select.value;
        select.innerHTML = generalOptions;
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
    document.querySelectorAll('.dc-gradient-custom-preset').forEach(select => {
        const previous = preferredCustomName ? `custom:${preferredCustomName}` : select.value;
        select.innerHTML = customOptions;
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
}

async function handleSaveCustomGradientPreset(button) {
    const { editor, entry } = getGradientEditorContext(button);
    const nameInput = editor?.querySelector('.dc-gradient-preset-name');
    const name = normalizeGradientPresetName(nameInput?.value);
    if (!entry?.gradient || !name) {
        toast.warning('Enter a preset name first');
        return;
    }
    const overwrite = Object.prototype.hasOwnProperty.call(getCustomGradientPresets(), name);
    if (overwrite && !await confirmReviewedAction({
        title: 'Replace gradient preset?',
        description: `“${name}” already exists. Its saved gradient will be replaced.`,
        confirmLabel: 'Replace preset',
        danger: true,
        opener: button,
    })) return;
    if (!saveCustomGradientPreset(name, entry, { immediate: true, overwrite })) {
        toast.error('Could not save gradient preset');
        return;
    }
    nameInput.value = '';
    refreshGradientPresetControls(name);
    toast.success(`Gradient preset "${escapeHtml(name)}" saved`);
}

function handleRenameCustomGradientPreset(button) {
    const { editor } = getGradientEditorContext(button);
    const selected = editor?.querySelector('.dc-gradient-custom-preset')?.value || '';
    const currentName = selected.startsWith('custom:') ? selected.slice(7) : '';
    const nextInput = editor?.querySelector('.dc-gradient-preset-rename');
    const nextName = normalizeGradientPresetName(nextInput?.value);
    if (!currentName || !nextName) {
        toast.warning('Select a custom preset and enter its new name');
        return;
    }
    if (!renameCustomGradientPreset(currentName, nextName, { immediate: true })) {
        toast.warning('That preset could not be renamed. The new name may already exist.');
        return;
    }
    nextInput.value = '';
    refreshGradientPresetControls(nextName);
    toast.success(`Gradient preset renamed to "${escapeHtml(nextName)}"`);
}

async function handleDeleteCustomGradientPreset(button) {
    const { editor } = getGradientEditorContext(button);
    const selected = editor?.querySelector('.dc-gradient-custom-preset')?.value || '';
    const name = selected.startsWith('custom:') ? selected.slice(7) : '';
    if (!name) {
        toast.warning('Select a custom gradient preset first');
        return;
    }
    if (!await confirmReviewedAction({
        title: 'Delete gradient preset?',
        description: `“${name}” will be removed. Characters already using it are not changed.`,
        confirmLabel: 'Delete preset',
        danger: true,
        opener: button,
    })) return;
    if (!deleteCustomGradientPreset(name, { immediate: true })) {
        toast.error('Could not delete gradient preset');
        return;
    }
    refreshGradientPresetControls();
    toast.success(`Gradient preset "${escapeHtml(name)}" deleted`);
}

function handleCharListClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;

    const dotEl = t.closest('.dc-color-dot');
    if (dotEl) { handleColorDotClick(dotEl); return; }
    const gradientToggle = t.closest('.dc-gradient-toggle');
    if (gradientToggle) { handleGradientToggle(gradientToggle); return; }
    const gradientRandomize = t.closest('.dc-gradient-randomize');
    if (gradientRandomize) { handleGradientRandomize(gradientRandomize); return; }
    const gradientAddStop = t.closest('.dc-gradient-add-stop');
    if (gradientAddStop) { handleGradientAddStop(gradientAddStop); return; }
    const gradientRemoveStop = t.closest('.dc-gradient-remove-stop');
    if (gradientRemoveStop) { handleGradientRemoveStop(gradientRemoveStop); return; }
    const gradientPresetApply = t.closest('.dc-gradient-apply-preset');
    if (gradientPresetApply) { handleGradientPresetApply(gradientPresetApply); return; }
    const customGradientPresetApply = t.closest('.dc-gradient-apply-custom-preset');
    if (customGradientPresetApply) { handleCustomGradientPresetApply(customGradientPresetApply); return; }
    const saveCustomGradientPresetButton = t.closest('.dc-gradient-save-custom-preset');
    if (saveCustomGradientPresetButton) { handleSaveCustomGradientPreset(saveCustomGradientPresetButton); return; }
    const renameCustomGradientPresetButton = t.closest('.dc-gradient-rename-custom-preset');
    if (renameCustomGradientPresetButton) { handleRenameCustomGradientPreset(renameCustomGradientPresetButton); return; }
    const deleteCustomGradientPresetButton = t.closest('.dc-gradient-delete-custom-preset');
    if (deleteCustomGradientPresetButton) { handleDeleteCustomGradientPreset(deleteCustomGradientPresetButton); return; }
    const moreBtn = t.closest('.dc-more');
    if (moreBtn) { handleMoreClick(moreBtn); return; }
    const delBtn = t.closest('.dc-del');
    if (delBtn) { handleDeleteClick(delBtn); return; }
    const keepBtn = t.closest('.dc-keep');
    if (keepBtn) { handleKeepClick(keepBtn); return; }
    const lockBtn = t.closest('.dc-lock');
    if (lockBtn) { handleLockClick(lockBtn); return; }
    const swapBtn = t.closest('.dc-swap');
    if (swapBtn) { handleSwapClick(swapBtn); return; }
    const harmonyBtn = t.closest('.dc-harmony');
    if (harmonyBtn) { showHarmonyPopup(harmonyBtn.dataset.key, harmonyBtn); return; }
    const aliasRemoveBtn = t.closest('.dc-alias-remove');
    if (aliasRemoveBtn) { handleAliasRemoveClick(e, aliasRemoveBtn); return; }
    const aliasBtn = t.closest('.dc-alias');
    if (aliasBtn) { handleAliasClick(aliasBtn); return; }
    const fontBtn = t.closest('.dc-font');
    if (fontBtn) { handleFontClick(fontBtn); return; }
    const groupBtn = t.closest('.dc-group');
    if (groupBtn) { handleGroupClick(groupBtn); return; }
}

export function installCharListDelegation(list) {
    if (list.__dcDelegated) return;
    list.__dcDelegated = true;

    list.addEventListener('input', (e) => {
        const t = e.target;
        if (!t.classList) return;
        if (t.classList.contains('dc-gradient-primary-color')) {
            handleGradientPrimaryInput(t);
        } else if (
            t.classList.contains('dc-gradient-secondary-color') ||
            t.classList.contains('dc-gradient-stop-color') ||
            t.classList.contains('dc-gradient-primary-position') ||
            t.classList.contains('dc-gradient-stop-position') ||
            t.classList.contains('dc-gradient-angle') ||
            t.classList.contains('dc-gradient-origin-x') ||
            t.classList.contains('dc-gradient-origin-y') ||
            t.classList.contains('dc-gradient-animation-duration')
        ) {
            handleGradientEditorMutation(t);
        } else if (t.classList.contains('dc-color-input')) {
            previewColorInputForElement(t);
        }
    });

    list.addEventListener('change', (e) => {
        const t = e.target;
        if (!t.classList) return;
        if (t.classList.contains('dc-gradient-type')) {
            handleGradientEditorMutation(t, { commitImmediately: true, final: true });
        } else if (t.classList.contains('dc-gradient-primary-color')) {
            handleGradientPrimaryInput(t, true);
        } else if (
            t.classList.contains('dc-gradient-secondary-color') ||
            t.classList.contains('dc-gradient-stop-color') ||
            t.classList.contains('dc-gradient-primary-position') ||
            t.classList.contains('dc-gradient-stop-position') ||
            t.classList.contains('dc-gradient-angle') ||
            t.classList.contains('dc-gradient-origin-x') ||
            t.classList.contains('dc-gradient-origin-y') ||
            t.classList.contains('dc-gradient-animation-duration') ||
            t.classList.contains('dc-gradient-direction') ||
            t.classList.contains('dc-gradient-animation-enabled') ||
            t.classList.contains('dc-gradient-animation-reverse')
        ) {
            handleGradientEditorMutation(t, { final: true });
        } else if (t.classList.contains('dc-color-input')) {
            applyColorInputForElement(t, { saveImmediately: true });
            maybeAutoRecolorAfterColorChange();
        } else if (t.classList.contains('dc-color-hex')) {
            if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
        } else if (t.classList.contains('dc-style-select')) {
            handleStyleSelect(t);
        }
    });

    list.addEventListener('keydown', (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('dc-color-hex') && e.key === 'Enter') {
            e.preventDefault();
            if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
            t.blur();
        } else if (t.classList?.contains('dc-gradient-preset-name') && e.key === 'Enter') {
            e.preventDefault();
            t.closest('.dc-gradient-editor')?.querySelector('.dc-gradient-save-custom-preset')?.click();
        } else if (t.classList?.contains('dc-gradient-preset-rename') && e.key === 'Enter') {
            e.preventDefault();
            t.closest('.dc-gradient-editor')?.querySelector('.dc-gradient-rename-custom-preset')?.click();
        }
    });

    list.addEventListener('dblclick', (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('dc-color-input')) {
            e.preventDefault();
            showHarmonyPopup(t.dataset.key, t);
        }
    });

    list.addEventListener('click', handleCharListClick);
    list.addEventListener('toggle', (e) => {
        const details = e.target;
        if (!details.classList?.contains('dc-gradient-advanced')) return;
        if (details.open) expandedGradientAdvancedRows.add(details.dataset.key);
        else expandedGradientAdvancedRows.delete(details.dataset.key);
    }, true);
}

// Phase 5B: Alias chips, Phase 6B: Group headers, Phase 5D: Harmony on dblclick
export function updateCharList() {
    const list = document.getElementById('dc-char-list'); if (!list) return;
    installCharListDelegation(list);
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Tracked characters');
    const activeElement = document.activeElement;
    const focusedControl = activeElement?.closest?.('.dc-char[data-key] [data-focus-id]');
    const focusState = focusedControl ? {
        key: focusedControl.closest('.dc-char')?.dataset.key,
        id: focusedControl.dataset.focusId,
    } : null;
    const entries = getSortedEntries();
    const countEl = document.getElementById('dc-count');
    if (countEl) countEl.textContent = Object.keys(characterColors).length;

    if (!entries.length) {
        list.innerHTML = searchTerm
            ? '<div class="dc-empty-state"><strong>No matching characters</strong><button type="button" class="menu_button" id="dc-clear-search">Clear search</button></div>'
            : '<div class="dc-empty-state"><strong>No characters yet</strong><span>Scan the chat or add a character above.</span></div>';
        list.querySelector('#dc-clear-search')?.addEventListener('click', () => {
            setSearchTerm('');
            const search = document.getElementById('dc-search');
            if (search) search.value = '';
            updateCharList();
            search?.focus();
        });
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
                desired.push({ blockKey: '__group__:' + g, sig: 'h:' + g, html: `<div class="dc-group-header" role="listitem"><span role="heading" aria-level="3">${escapeHtml(g)}</span></div>` });
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
    let cursor = list.firstElementChild;
    for (const item of desired) {
        let node = existing.get(item.blockKey);
        const containsActiveEditor = !!node?.contains(activeElement)
            && !!activeElement?.matches?.('input[type="text"], input[type="search"], input[type="number"], input[type="range"], input[type="color"], textarea');
        if (!(node && (node.getAttribute('data-dc-sig') === item.sig || containsActiveEditor))) {
            node = htmlToNode(item.html);
            node.setAttribute('data-dc-block', item.blockKey);
            node.setAttribute('data-dc-sig', item.sig);
        }
        if (node !== cursor) list.insertBefore(node, cursor);
        cursor = node.nextElementSibling;
        used.add(node);
    }
    for (const node of Array.from(list.children)) {
        if (!used.has(node)) node.remove();
    }

    applyControlHelpText(list);
    updateLegend();
    if (focusState?.key && focusState.id) {
        list.querySelector(`.dc-char[data-key="${CSS.escape(focusState.key)}"] [data-focus-id="${CSS.escape(focusState.id)}"]`)?.focus({ preventScroll: true });
    }
}

export function setControlHelp(element, text) {
    if (!element || !text) return;
    element.title = text;
    if (!element.hasAttribute('aria-label') && !element.textContent.trim() && !element.closest('label')) element.setAttribute('aria-label', text);
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
    if (recolorButton && recolorButton.getAttribute('aria-busy') !== 'true') {
        const label = domMode ? 'Refresh rendered dialogue' : 'Recolor entire chat';
        recolorButton.textContent = label;
        recolorButton.dataset.defaultLabel = label;
    }
    updateSystemPromptDisplay();
}

export function autoAssignFromCard() {
    try {
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        const name = char?.name?.trim();
        const key = name ? resolveCharacterKeyByNameOrAlias(name) : null;
        if (name && !key) {
            const result = addCharacter(name);
            if (result?.added) toast.success(`Added ${escapeHtml(name)}`);
        }
    } catch { }
}

export function updateStorageScopeStatus() {
    const scope = getCurrentStorageScope();
    const descriptor = getStorageScopeDescriptor(scope);
    const characterCount = Object.keys(characterColors).length;
    const select = document.getElementById('dc-storage-scope');
    const status = document.getElementById('dc-scope-status');
    if (select) select.value = scope;
    if (status) {
        status.textContent = `${formatScopeName(scope)}: ${characterCount} character${characterCount === 1 ? '' : 's'}${descriptor.updatedAt ? `, saved ${formatDate(descriptor.updatedAt)}` : ''}.`;
    }
}

async function handleStorageScopeChange(select) {
    const previousScope = getCurrentStorageScope();
    const nextScope = select.value;
    if (nextScope === previousScope) return;
    const source = getStorageScopeDescriptor(previousScope);
    const target = getStorageScopeDescriptor(nextScope);
    const detailsHtml = `<dl class="dc-review-list"><div><dt>Current</dt><dd>${escapeHtml(formatScopeName(previousScope))}, ${source.characterCount} characters</dd></div><div><dt>Destination</dt><dd>${escapeHtml(formatScopeName(nextScope))}, ${target.characterCount} characters</dd></div><div><dt>Last saved</dt><dd>${escapeHtml(formatDate(target.updatedAt))}</dd></div></dl><p class="dc-section-note">If Auto-recolor is enabled, changing assignments can also update saved LLM font tags.</p>`;
    const targetIsEmpty = !target.exists || target.characterCount === 0;
    const decision = await openDecisionDialog({
        title: `Switch to ${formatScopeName(nextScope)} colors?`,
        description: targetIsEmpty
            ? 'This destination has no assignments. Choose what should appear there.'
            : 'This destination already has assignments. Choose how to handle them.',
        detailsHtml,
        opener: select,
        choices: targetIsEmpty ? [
            { value: 'copy', label: 'Copy current', primary: true },
            { value: 'empty', label: 'Start empty' },
            { value: 'cancel', label: 'Cancel' },
        ] : [
            { value: 'switch', label: 'Use destination', primary: true },
            { value: 'merge', label: 'Merge current into it' },
            { value: 'replace', label: 'Replace it with current', danger: true },
            { value: 'cancel', label: 'Cancel' },
        ],
    });
    if (!decision.value || decision.value === 'cancel') {
        select.value = previousScope;
        return;
    }
    select.disabled = true;
    const result = await switchColorStorageScope(nextScope, decision.value);
    select.disabled = false;
    select.focus({ preventScroll: true });
    if (!result.ok) {
        select.value = previousScope;
        toast.error(result.message || 'Could not switch color storage.');
        return;
    }
    updateStorageScopeStatus();
    toast.success(result.message);
}

function buildImportReviewDetails(preview) {
    const rows = [];
    if (Number.isFinite(preview.characterCount)) rows.push(`<div><dt>Characters</dt><dd>${preview.characterCount}</dd></div>`);
    if (preview.settingsPresent) rows.push(`<div><dt>Settings</dt><dd>${preview.settingsCount} recognized values</dd></div>`);
    if (preview.customGradientPresetCount) rows.push(`<div><dt>Gradient presets</dt><dd>${preview.customGradientPresetCount}</dd></div>`);
    if (preview.requestedStorageScope) rows.push(`<div><dt>Saved scope</dt><dd>${escapeHtml(formatScopeName(preview.requestedStorageScope))}</dd></div>`);
    const presetNote = preview.customGradientPresetCount
        ? '<p class="dc-section-note">Gradient presets are merged; existing presets with the same name are kept.</p>'
        : '';
    return `<dl class="dc-review-list">${rows.join('')}</dl>${presetNote}`;
}

async function reviewAndApplyImport(analysis, kind, opener) {
    if (!analysis.ok) {
        toast.error(analysis.message || 'The selected data is not recognized.');
        return analysis;
    }
    const isSettings = kind === 'settings';
    const hasRequestedScope = !!analysis.preview.requestedStorageScope;
    const requestedScope = analysis.preview.requestedStorageScope;
    const destination = hasRequestedScope ? getStorageScopeDescriptor(requestedScope) : null;
    const scopeDetails = destination
        ? `<p class="dc-import-scope-warning">Switching storage first loads the ${escapeHtml(formatScopeName(requestedScope))} table, which currently has ${destination.characterCount} character${destination.characterCount === 1 ? '' : 's'}. Any imported colors are then applied to that table.</p>`
        : '';
    const decision = await openDecisionDialog({
        title: kind === 'card' ? 'Review card data' : `Review ${isSettings ? 'settings' : 'color'} import`,
        description: isSettings
            ? 'Apply the recognized settings values. Assignments stay unchanged unless you also switch storage below.'
            : analysis.preview.characterCount === 0
                ? 'This source contains 0 characters. Merge keeps current assignments; Replace clears the current character table.'
                : 'Merge keeps current entries when names conflict. Replace uses only the incoming character table.',
        detailsHtml: `${buildImportReviewDetails(analysis.preview)}${scopeDetails}${isSettings ? '' : '<p class="dc-section-note">If Auto-recolor is enabled, changed assignments can also update saved LLM font tags.</p>'}`,
        checkbox: hasRequestedScope ? { label: `Switch to ${formatScopeName(requestedScope)} first (${destination.characterCount} characters)` } : null,
        opener,
        choices: isSettings ? [
            { value: 'merge', label: 'Apply included values', primary: true },
            { value: 'cancel', label: 'Cancel' },
        ] : [
            { value: 'merge', label: 'Merge', primary: true },
            { value: 'replace', label: analysis.preview.characterCount === 0 ? 'Replace and clear current' : 'Replace current', danger: true },
            { value: 'cancel', label: 'Cancel' },
        ],
    });
    if (!decision.value || decision.value === 'cancel') return { ok: false, cancelled: true };
    const apply = kind === 'settings' ? applySettingsImport : kind === 'card' ? applyCardData : applyColorImport;
    const result = await apply(analysis.payload, { mode: decision.value, applyScope: decision.checked });
    if (result.ok) {
        updateStorageScopeStatus();
        toast.success(kind === 'card' ? 'Card data applied.' : `${isSettings ? 'Settings' : 'Colors'} imported.`);
    } else toast.error(result.message || 'The reviewed data could not be applied.');
    return result;
}

async function confirmCharacterRemoval(keys, options = {}) {
    const candidates = [...new Set(keys)].filter(key => characterColors[key]);
    const pinned = candidates.filter(key => characterColors[key]?.keep);
    const removable = candidates.filter(key => !characterColors[key]?.keep);
    if (!candidates.length) { toast.info(options.emptyMessage || 'No matching characters.'); return false; }
    if (!removable.length) { toast.info(options.blockedMessage || 'All matching characters are pinned.'); return false; }
    const confirmed = await confirmReviewedAction({
        title: options.title || 'Delete characters?',
        description: `${removable.length} character${removable.length === 1 ? '' : 's'} will be deleted. ${pinned.length ? `${pinned.length} pinned ${pinned.length === 1 ? 'entry is' : 'entries are'} protected.` : 'No pinned entries are affected.'}`,
        detailsHtml: `<p class="dc-review-names">${removable.slice(0, 8).map(key => escapeHtml(characterColors[key].name)).join(', ')}${removable.length > 8 ? `, and ${removable.length - 8} more` : ''}</p>`,
        confirmLabel: options.confirmLabel || 'Delete',
        danger: true,
        opener: options.opener,
    });
    if (!confirmed) return false;
    return removeCharacterKeys(candidates, options);
}

export function syncUIWithSettings() {
    const $ = id => document.getElementById(id);
    normalizeToggleSettings();
    if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
    if ($('dc-highlight')) $('dc-highlight').checked = settings.highlightMode;
    if ($('dc-autoscan')) $('dc-autoscan').checked = settings.autoScanOnLoad !== false;
    if ($('dc-autoscan-new')) $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false;
    if ($('dc-auto-lock')) $('dc-auto-lock').checked = settings.autoLockDetected !== false;
    if ($('dc-auto-random-gradients')) $('dc-auto-random-gradients').checked = settings.autoRandomNpcGradients === true;
    if ($('dc-auto-random-all-gradients')) $('dc-auto-random-all-gradients').checked = settings.autoRandomAllGradients === true;
    if ($('dc-auto-random-gradients')) $('dc-auto-random-gradients').disabled = settings.autoRandomAllGradients === true;
    if ($('dc-drift-all-gradients')) $('dc-drift-all-gradients').checked = settings.driftAllGradientColors === true;
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
    if ($('dc-narrator')) $('dc-narrator').disabled = settings.disableNarration !== false;
    syncProcessControlState();
    refreshPresetDropdown();
    refreshPaletteDropdown();
    updateSystemPromptDisplay();
    updateEngineVisibility();
    updateAutoSyncUI();
    updateStorageScopeStatus();
    applyControlHelpText();
}

function buildSettingsPanelHtml() {
    return `
    <div id="dc-ext" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content dc-panel-content">
            <details class="dc-section" open>
                <summary>Current setup</summary>
                <div class="dc-stack">
                    <div class="dc-setup-strip">
                        <label class="checkbox_label dc-enable-toggle"><input type="checkbox" id="dc-enabled"><span>Enabled</span></label>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-storage-scope">Colors saved</label><select id="dc-storage-scope" class="text_pole"><option value="chat">Per chat</option><option value="card">Per card</option><option value="global">Global</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-engine">Engine</label><select id="dc-engine" class="text_pole"><option value="llm">LLM</option><option value="dom">Local (DOM-only)</option></select></div>
                    </div>
                    <p id="dc-scope-status" class="dc-status-line"></p>
                    <small class="dc-engine-note dc-dom-only" style="display:none;">Local mode colors rendered dialogue without editing chat text. Manual quote assignments are saved in chat metadata.</small>
                    <small class="dc-engine-note dc-llm-only">LLM mode stores ordinary font colors in chat text; gradients remain a local visual enhancement.</small>
                </div>
            </details>
            <details class="dc-section" open>
                <summary>Process chat</summary>
                <p class="dc-section-note">Each action names exactly what it changes.</p>
                <div class="dc-process-grid">
                    <div class="dc-action-block"><span><strong>Discover</strong><small>Read the entire chat and update tracked speakers.</small></span><button id="dc-scan" class="menu_button">Scan entire chat</button></div>
                    <div class="dc-action-block dc-llm-only"><span><strong>Colorize missing</strong><small>Add font tags only where dialogue is uncolored.</small></span><div class="dc-action-control"><select id="dc-colorize-target" class="text_pole" aria-label="Colorize target"><option value="last">Latest message</option><option value="all">Entire chat</option></select><button id="dc-colorize" class="menu_button">Colorize</button></div></div>
                    <div class="dc-action-block dc-dom-only" style="display:none;"><span><strong>Verify attribution</strong><small>Ask the selected LLM profile to review local assignments.</small></span><div class="dc-action-control"><select id="dc-verify-target" class="text_pole" aria-label="Verification target"><option value="latest">Latest message</option><option value="visible">Visible messages</option></select><button id="dc-verify-attr" class="menu_button">Verify</button></div></div>
                    <div class="dc-action-block"><span><strong class="dc-llm-only">Recolor saved tags</strong><strong class="dc-dom-only" style="display:none;">Refresh local colors</strong><small class="dc-llm-only">Rewrite existing color tags across the entire chat.</small><small class="dc-dom-only" style="display:none;">Reapply current styles to rendered dialogue.</small></span><button id="dc-recolor" class="menu_button">Recolor entire chat</button></div>
                    <div class="dc-action-block"><span><strong>List tools</strong><small>Inspect activity or clear every unpinned entry.</small></span><div class="dc-action-control"><button id="dc-stats" class="menu_button">Statistics</button><button id="dc-clear" class="menu_button dc-danger-button">Clear unpinned</button></div></div>
                </div>
            </details>
            <details class="dc-section" open>
                <summary>Characters</summary>
                <p class="dc-section-note">Keep pins important entries. Edit reveals color, lock, type, aliases, and gradients.</p>
                <div class="dc-stack">
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-search">Search characters</label><input type="search" id="dc-search" placeholder="Search names, aliases, groups…" class="text_pole"><select id="dc-sort" class="text_pole" aria-label="Character sort"><option value="name">Sort: Name</option><option value="count">Sort: Dialogue activity</option><option value="group">Sort: Group</option></select></div>
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-add-name">New character name</label><input type="text" id="dc-add-name" placeholder="Character name" class="text_pole" aria-describedby="dc-add-error"><button id="dc-add-btn" class="menu_button">Add</button><button id="dc-card" class="menu_button">Add current card</button><button id="dc-avatar-color" class="menu_button">Avatar color</button><span id="dc-add-error" class="dc-field-error" aria-live="polite"></span></div>
                    <small><span id="dc-count">0</span> tracked characters</small>
                    <div id="dc-char-list" class="dc-char-list"></div>
                </div>
            </details>
            <details class="dc-section">
                <summary>Appearance</summary>
                <div class="dc-stack">
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-theme">Target surface</label><select id="dc-theme" class="text_pole"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-palette">New-color palette</label><select id="dc-palette" class="text_pole"></select></div>
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-brightness">Current color brightness</label><input type="range" id="dc-brightness" min="-100" max="100" value="0"><span id="dc-bright-val" class="dc-inline-value">0</span></div>
                    <small>The value previews while dragging; colors update when released.</small>
                    <div class="dc-toggle-grid"><label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight dialogue</span></label><label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-recolor"><span>Auto-recolor after changes</span></label></div>
                </div>
            </details>
            <details class="dc-section">
                <summary>Engine settings</summary>
                <div class="dc-stack">
                    <div class="dc-llm-only dc-stack">
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-llm-profile">Colorize profile</label><select id="dc-llm-profile" class="text_pole"><option value="">Use main chat AI</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-depth">Prompt depth</label><input type="number" id="dc-prompt-depth" min="0" max="99" value="1" class="text_pole"></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-role">Prompt role</label><select id="dc-prompt-role" class="text_pole"><option value="system">System</option><option value="user">User</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-mode">Prompt mode</label><select id="dc-prompt-mode" class="text_pole"><option value="inject">Inject automatically</option><option value="macro">Use macro manually</option></select></div>
                        <div id="dc-system-prompt-container" style="display:none;"><label for="dc-system-prompt-text" class="dc-inline-label">Macro text</label><textarea id="dc-system-prompt-text" readonly class="text_pole dc-macro-text">{{dialoguecolors}}</textarea><button id="dc-copy-system-prompt" class="menu_button">Copy macro</button></div>
                    </div>
                    <div class="dc-dom-only dc-stack" style="display:none;">
                        <label class="checkbox_label"><input type="checkbox" id="dc-stealth-colors"><span>Ask for hidden speaker color blocks</span></label><label class="checkbox_label"><input type="checkbox" id="dc-llm-attr-check"><span>Verify attribution automatically</span></label><label class="checkbox_label"><input type="checkbox" id="dc-llm-attr-parallel"><span>Verify during streaming pauses</span></label><label class="checkbox_label"><input type="checkbox" id="dc-attr-conservative"><span>Only fill unknown attribution</span></label>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-attr-profile">Verify profile</label><select id="dc-attr-profile" class="text_pole"><option value="">Use main chat AI</option></select></div><div class="dc-field-row"><label class="dc-inline-label" for="dc-attr-max-tokens">Verify token limit</label><input type="number" id="dc-attr-max-tokens" min="256" max="32768" value="4096" class="text_pole"></div>
                    </div>
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-narrator">Narrator color</label><input type="color" id="dc-narrator" value="#888888"><button id="dc-narrator-clear" class="menu_button">Use default</button></div>
                    <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration"><span>Disable narration coloring</span></label>
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-inline-label" for="dc-thought-symbols">Thought delimiters</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole"><button id="dc-thought-clear" class="menu_button">Clear</button></div>
                </div>
            </details>
            <details class="dc-section">
                <summary>Automation</summary>
                <div class="dc-toggle-grid"><label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Scan when the character list is empty</span></label><label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new"><span>Scan new messages</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-lock"><span>Lock new characters</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-random-gradients"><span>Random gradients for new NPCs</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-random-all-gradients"><span>Random gradients for every new character</span></label><label class="checkbox_label"><input type="checkbox" id="dc-drift-all-gradients"><span>Drift every gradient color</span></label><label class="checkbox_label dc-llm-only"><input type="checkbox" id="dc-auto-colorize"><span>Colorize missing tags automatically</span></label><label class="checkbox_label"><input type="checkbox" id="dc-right-click"><span>Manual dialogue reassignment</span></label><label class="checkbox_label"><input type="checkbox" id="dc-disable-toasts"><span>Reduce routine notifications</span></label></div>
            </details>
            <details class="dc-section">
                <summary>Style library</summary>
                <div class="dc-stack">
                    <details class="dc-subsection"><summary>Assignment presets</summary><div class="dc-stack"><div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-preset-name">Preset name</label><input type="text" id="dc-preset-name" placeholder="Preset name" class="text_pole"><button id="dc-save-preset" class="menu_button">Save current</button></div><div class="dc-field-row dc-field-row-wrap"><select id="dc-preset-select" class="text_pole" aria-label="Assignment preset"><option value="">Select preset</option></select><button id="dc-load-preset" class="menu_button">Load</button><button id="dc-delete-preset" class="menu_button dc-danger-button">Delete</button></div></div></details>
                    <details class="dc-subsection"><summary>Custom palettes</summary><div class="dc-stack"><div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-palette-name-input">Palette name</label><input type="text" id="dc-palette-name-input" placeholder="Palette name" class="text_pole"><label class="dc-visually-hidden" for="dc-palette-notes-input">Palette notes</label><input type="text" id="dc-palette-notes-input" placeholder="Notes or mood words" class="text_pole"></div><label class="checkbox_label"><input type="checkbox" id="dc-overwrite-existing"><span>Allow replacing an existing palette</span></label><div class="dc-button-row"><button id="dc-gen-palette" class="menu_button">Generate</button><button id="dc-save-palette" class="menu_button">Save current colors</button><button id="dc-del-palette" class="menu_button dc-danger-button">Delete selected</button></div></div></details>
                </div>
            </details>
            <details class="dc-section">
                <summary>Storage & transfer</summary>
                <div class="dc-stack">
                    <div class="dc-button-row"><button id="dc-export" class="menu_button">Export colors</button><button id="dc-import" class="menu_button">Import colors</button><button id="dc-export-settings" class="menu_button">Export settings</button><button id="dc-import-settings" class="menu_button">Import settings</button><button id="dc-export-png" class="menu_button">Export legend image</button></div>
                    <input type="file" id="dc-import-file" accept=".json,application/json" hidden><input type="file" id="dc-import-settings-file" accept=".json,application/json" hidden>
                    <div class="dc-button-row"><button id="dc-save-card" class="menu_button">Save to card</button><button id="dc-load-card" class="menu_button">Review card data</button><button id="dc-storage" class="menu_button">Storage manager</button></div>
                    <div class="dc-button-row"><button id="dc-setup-autosync" class="menu_button">Enable auto-sync</button><button id="dc-disable-autosync" class="menu_button" style="display:none;">Disable auto-sync</button></div><span id="dc-autosync-status" class="dc-status-text" role="status" aria-live="polite"></span>
                </div>
            </details>
            <details class="dc-section">
                <summary>Maintenance</summary>
                <div class="dc-stack"><div class="dc-button-row"><button id="dc-undo" class="menu_button">Undo</button><button id="dc-redo" class="menu_button">Redo</button><button id="dc-fix-conflicts" class="menu_button">Fix similar colors</button></div><div class="dc-button-row"><button id="dc-regen" class="menu_button">Regenerate unlocked</button><button id="dc-flip-theme" class="menu_button">Flip for theme</button><button id="dc-restore-defaults" class="menu_button dc-danger-button">Restore setting defaults</button></div></div>
            </details>
            <details class="dc-section dc-danger-zone">
                <summary>Danger zone</summary>
                <p class="dc-section-note">Deletion tools review the target count first and always skip pinned characters.</p>
                <div class="dc-stack">
                    <div class="dc-button-row"><button id="dc-lock-all" class="menu_button">Lock all</button><button id="dc-unlock-all" class="menu_button">Unlock all</button><button id="dc-reset" class="menu_button dc-danger-button">Reset unlocked colors</button></div>
                    <div class="dc-button-row"><button id="dc-del-locked" class="menu_button dc-danger-button">Delete locked</button><button id="dc-del-unlocked" class="menu_button dc-danger-button">Delete unlocked</button></div>
                    <div class="dc-field-row dc-field-row-wrap"><label for="dc-del-least-threshold">Minimum dialogue segments to keep</label><input type="number" id="dc-del-least-threshold" min="0" value="3" class="text_pole"><button id="dc-del-least" class="menu_button dc-danger-button">Delete below threshold</button></div>
                    <button id="dc-del-dupes" class="menu_button dc-danger-button">Delete duplicate colors</button>
                </div>
            </details>
            <div id="dc-prompt-preview" class="dc-prompt-preview"></div>
        </div>
    </div>`;
}

function bindSettingsPanelControls($) {
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
        syncProcessControlState();
    };
    $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
    $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
    $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
    $('dc-auto-random-gradients').onchange = e => { settings.autoRandomNpcGradients = e.target.checked; saveData(); };
    $('dc-auto-random-all-gradients').onchange = e => {
        settings.autoRandomAllGradients = e.target.checked;
        $('dc-auto-random-gradients').disabled = e.target.checked;
        saveData();
    };
    $('dc-drift-all-gradients').onchange = e => {
        settings.driftAllGradientColors = e.target.checked;
        saveData();
        refreshGradientVisualSurfaces();
        repaintDomAfterCharacterDataChange(0);
    };
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
    $('dc-attr-max-tokens').oninput = e => {
        // Clamp to the input's declared range; sub-minimum values truncate the
        // verifier's JSON output and make every verification fail parsing.
        const parsed = parseInt(e.target.value, 10) || 4096;
        settings.attributionMaxTokens = Math.min(32768, Math.max(256, parsed));
        saveData();
    };
    $('dc-stealth-colors').onchange = e => { settings.domStealthColors = e.target.checked; saveData(); injectPrompt(); };
    $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
    $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
    $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; $('dc-narrator').disabled = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-storage-scope').onchange = e => { handleStorageScopeChange(e.target); };
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
        updateCharList(); injectPrompt(); flushChatSave();
    };
    $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); injectPrompt(); };
    $('dc-brightness').oninput = e => {
        const brightness = parseInt(e.target.value, 10) || 0;
        $('dc-bright-val').textContent = String(brightness);
    };
    $('dc-brightness').onchange = e => {
        const brightness = parseInt(e.target.value, 10) || 0;
        applyThemeOrBrightnessChange(() => { settings.brightness = brightness; }, { saveImmediately: true });
        flushColorStateSave();
        flushChatSave();
    };
    $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
    $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
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
    $('dc-clear').onclick = async e => {
        const allKeys = Object.keys(characterColors);
        await confirmCharacterRemoval(allKeys, {
            title: 'Clear unpinned characters?',
            confirmLabel: 'Clear unpinned',
            actionLabel: 'Cleared',
            itemLabel: 'character',
            emptyMessage: 'No characters to clear.',
            blockedMessage: 'Only pinned characters remain.',
            opener: e.currentTarget,
        });
    };
    $('dc-stats').onclick = showStatsPopup;
    $('dc-recolor').onclick = async e => {
        if (isDomEngine()) { scheduleDomRefreshSeries(0); scheduleCustomFontRefresh(0); return; }
        const confirmed = await confirmReviewedAction({
            title: 'Recolor the entire chat?',
            description: 'Existing saved font-color tags will be rewritten to match current assignments. Message wording is not changed.',
            confirmLabel: 'Recolor entire chat',
            opener: e.currentTarget,
        });
        if (confirmed) recolorAllMessages();
    };
    $('dc-colorize').onclick = async e => {
        const target = $('dc-colorize-target').value === 'all' ? 'all' : 'last';
        if (target === 'last') { colorizeMessages('last'); return; }
        const confirmed = await confirmReviewedAction({
            title: 'Colorize missing dialogue across the chat?',
            description: 'Font-color tags will be added only to dialogue that is currently uncolored.',
            confirmLabel: 'Colorize entire chat',
            opener: e.currentTarget,
        });
        if (confirmed) colorizeMessages('all');
    };
    $('dc-verify-attr').onclick = () => {
        const target = $('dc-verify-target').value;
        const verify = target === 'visible' ? verifyVisibleAttributionsWithLLM : verifyLatestAttributionsWithLLM;
        runAttributionVerification(() => verify({ manual: true }), { manual: true });
    };
    $('dc-fix-conflicts').onclick = autoResolveConflicts;
    $('dc-regen').onclick = async e => {
        const unlockedCount = Object.values(characterColors).filter(entry => !entry.locked).length;
        if (!unlockedCount) { toast.info('No unlocked colors to regenerate'); return; }
        const confirmed = await confirmReviewedAction({
            title: 'Regenerate unlocked colors?',
            description: `${unlockedCount} character color${unlockedCount === 1 ? '' : 's'} will change. Locked colors remain unchanged.`,
            confirmLabel: 'Regenerate colors',
            danger: true,
            opener: e.currentTarget,
        });
        if (confirmed) regenerateAllColors();
    };
    $('dc-flip-theme').onclick = flipColorsForTheme;
    $('dc-restore-defaults').onclick = async e => {
        if (await confirmReviewedAction({
            title: 'Restore setting defaults?',
            description: 'Extension settings will return to defaults. Character assignments are preserved, and the previous settings can be restored from the recovery notice.',
            confirmLabel: 'Restore defaults',
            danger: true,
            opener: e.currentTarget,
        })) restoreAllSettingsToDefaults();
    };
    $('dc-save-preset').onclick = async e => {
        const name = $('dc-preset-name').value.trim();
        if (name && Object.prototype.hasOwnProperty.call(getPresets(), name)) {
            const replace = await confirmReviewedAction({
                title: 'Replace assignment preset?',
                description: `“${name}” already exists. Its saved character assignments will be replaced.`,
                confirmLabel: 'Replace preset',
                danger: true,
                opener: e.currentTarget,
            });
            if (!replace) return;
        }
        saveColorPreset();
    };
    $('dc-load-preset').onclick = loadColorPreset;
    $('dc-delete-preset').onclick = async e => {
        const name = $('dc-preset-select').value;
        if (!name) { toast.warning('Select a preset first.'); return; }
        if (await confirmReviewedAction({ title: 'Delete assignment preset?', description: `“${name}” will be removed. Character assignments are not changed.`, confirmLabel: 'Delete preset', danger: true, opener: e.currentTarget })) deleteColorPreset();
    };
    $('dc-gen-palette').onclick = async () => { await generateCustomPaletteFromWords(); };
    $('dc-save-palette').onclick = saveCustomPalette;
    $('dc-palette-name-input').onkeypress = e => { if (e.key === 'Enter') $('dc-gen-palette').click(); };
    $('dc-palette-notes-input').onkeypress = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('dc-gen-palette').click(); };
    $('dc-del-palette').onclick = async e => {
        const value = $('dc-palette').value;
        if (!value?.startsWith('custom:')) { toast.warning('Select a custom palette in Appearance first.'); return; }
        const name = value.slice(7);
        if (await confirmReviewedAction({ title: 'Delete custom palette?', description: `“${name}” will be removed. Existing character colors are not changed.`, confirmLabel: 'Delete palette', danger: true, opener: e.currentTarget })) deleteCustomPalette();
    };
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
            toast.success(`Set ${escapeHtml(char.name)} to ${color}`);
        } catch {
            toast.error('Failed to extract avatar color');
        }
    };
    $('dc-save-card').onclick = async e => {
        const existing = await readCardData();
        if (existing.ok) {
            const count = existing.preview?.characterCount ?? 0;
            const confirmed = await confirmReviewedAction({
                title: 'Replace saved card data?',
                description: `This card already stores ${count} character${count === 1 ? '' : 's'}. Its saved Dialogue Colors payload will be replaced with the current table.`,
                confirmLabel: 'Replace card data',
                danger: true,
                opener: e.currentTarget,
            });
            if (!confirmed) return;
        } else if (existing.error !== 'no_card_data') {
            toast.error(existing.message || 'The current card could not be reviewed.');
            return;
        }
        saveToCard();
    };
    $('dc-load-card').onclick = async e => reviewAndApplyImport(await readCardData(), 'card', e.currentTarget);
    $('dc-undo').onclick = undo;
    $('dc-redo').onclick = redo;
    $('dc-export').onclick = exportColors;
    $('dc-import').onclick = () => $('dc-import-file').click();
    $('dc-export-png').onclick = exportLegendPng;
    $('dc-import-file').onchange = async e => {
        const file = e.target.files[0];
        if (file) await reviewAndApplyImport(await analyzeColorImport(file), 'colors', $('dc-import'));
        e.target.value = '';
    };
    $('dc-export-settings').onclick = exportSettings;
    $('dc-import-settings').onclick = () => $('dc-import-settings-file').click();
    $('dc-import-settings-file').onchange = async e => {
        const file = e.target.files[0];
        if (file) await reviewAndApplyImport(await analyzeSettingsImport(file), 'settings', $('dc-import-settings'));
        e.target.value = '';
    };
    $('dc-setup-autosync').onclick = () => { enableAutoSync(); updateAutoSyncUI(); };
    $('dc-disable-autosync').onclick = () => { disableAutoSync(); updateAutoSyncUI(); };
    $('dc-del-locked').onclick = e => {
        confirmCharacterRemoval(Object.keys(characterColors).filter(k => characterColors[k]?.locked), {
            title: 'Delete locked characters?',
            actionLabel: 'Deleted',
            itemLabel: 'locked character',
            emptyMessage: 'No locked characters to delete',
            blockedMessage: 'Only pinned locked characters remain.',
            opener: e.currentTarget,
        });
    };
    $('dc-del-unlocked').onclick = e => {
        confirmCharacterRemoval(Object.keys(characterColors).filter(k => characterColors[k] && !characterColors[k].locked), {
            title: 'Delete unlocked characters?',
            actionLabel: 'Deleted',
            itemLabel: 'unlocked character',
            emptyMessage: 'No unlocked characters to delete',
            blockedMessage: 'Only pinned unlocked characters remain.',
            opener: e.currentTarget,
        });
    };
    $('dc-del-least').onclick = e => {
        const min = parseInt($('dc-del-least-threshold')?.value || '3', 10);
        if (isNaN(min) || min < 0) { toast.warning('Invalid threshold'); return; }
        confirmCharacterRemoval(Object.keys(characterColors).filter(k => (characterColors[k]?.dialogueCount || 0) < min), {
            title: `Delete characters below ${min} dialogue segments?`,
            actionLabel: 'Deleted',
            itemLabel: 'low-dialogue character',
            emptyMessage: `No characters below ${min} dialogues`,
            blockedMessage: 'Only pinned low-dialogue characters remain.',
            opener: e.currentTarget,
        });
    };
    $('dc-del-dupes').onclick = e => {
        confirmCharacterRemoval(collectDuplicateColorKeys(), {
            title: 'Delete duplicate primary colors?',
            actionLabel: 'Deleted',
            itemLabel: 'duplicate-color character',
            emptyMessage: 'No duplicate colors found',
            blockedMessage: 'Only pinned duplicate-color characters remain.',
            opener: e.currentTarget,
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
    $('dc-reset').onclick = async e => {
        const unlockedCount = Object.values(characterColors).filter(entry => !entry.locked).length;
        if (!unlockedCount) { toast.info('No unlocked colors to reset'); return; }
        const confirmed = await confirmReviewedAction({
            title: 'Reset unlocked colors?',
            description: `${unlockedCount} character color${unlockedCount === 1 ? '' : 's'} will be regenerated. Locked colors remain unchanged.`,
            confirmLabel: 'Reset colors',
            danger: true,
            opener: e.currentTarget,
        });
        if (!confirmed) return;
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
    let searchFrame = 0;
    $('dc-search').oninput = e => {
        setSearchTerm(e.target.value);
        cancelAnimationFrame(searchFrame);
        searchFrame = requestAnimationFrame(updateCharList);
    };
    $('dc-sort').onchange = e => { settings.sortMode = e.target.value; saveData(); updateCharList(); };
    $('dc-add-btn').onclick = () => {
        const input = $('dc-add-name');
        const error = $('dc-add-error');
        const result = addCharacter(input.value);
        if (result?.added || result?.existing) {
            input.value = '';
            input.removeAttribute('aria-invalid');
            if (error) error.textContent = '';
        } else {
            input.setAttribute('aria-invalid', 'true');
            if (error) error.textContent = input.value.trim()
                ? 'Use a name without brackets, commas, equals signs, parentheses, or line breaks.'
                : 'Enter a character name.';
            input.focus({ preventScroll: true });
        }
    };
    $('dc-add-name').oninput = e => {
        e.target.removeAttribute('aria-invalid');
        if ($('dc-add-error')) $('dc-add-error').textContent = '';
    };
    $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };

}

export function createUI() {
    if (document.getElementById('dc-ext')) return;
    document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', buildSettingsPanelHtml());

    const $ = id => document.getElementById(id);

    syncUIWithSettings();
    bindSettingsPanelControls($);

    registerKeyboardShortcuts();
    applyControlHelpText();
    updateCharList();
    injectPrompt();
}
