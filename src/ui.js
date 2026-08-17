// ui.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments, clearSpeakerRegexCache } from './attribution.js';
import { ATTRIBUTION_REVIEW_STATUS, createMessageFingerprint, createSegmentFingerprint } from './attribution-store.js';
import { refreshGradientAnimationState, registerGradientAnimationElement, registerGradientAnimationRoot, setGradientAnimationMode, unregisterGradientAnimationRoot } from './animation-controller.js';
import { DEFAULT_CHARACTER_STYLE_FIELD_MASK, applyGroupProfileToKeys, clearCharacterSelection, copyCharacterStyle, deleteCharacterKeys, executeSelectedCharacterMutation, getCharacterKeysForGroup, getCharacterStyleClipboard, getSelectedCharacterKeys, pasteCharacterStyle, randomizeCharacterColors, selectCharacterKeys, setCharacterGroup, setCharacterKeep, setCharacterLock, setCharacterSelected } from './character-operations.js';
import { CHARACTER_STYLE_FIELD_MASKS, captureCharacterStyle } from './character-style.js';
import { resolveCharacterKeyByNameOrAlias, scanAllMessages } from './color-blocks.js';
import { DOM_RETRY_REFRESH_DELAYS, acceptAttributionReview, cancelMessageDomFollowupRepairs, clearMessageDomRepairTimer, clearStreamingAttributionOverrides, decorateAllMessages, decorateMessageDomFromCurrentRender, dismissAttributionReview, getMessageQuoteOverrideOptions, listAttributionReviews, pruneAttributionReviews, refreshAndDecorateMessageDom, rejectAttributionReview, scheduleDomRefreshSeries, scheduleDomSettleRefresh, scheduleMessageDomFollowupRepair, setMessageQuoteOverride, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck, undecorateAllMessages } from './dom-engine.js';
import { loadGoogleFont, scheduleCustomFontRefresh, syncRemoteFontLoadingPolicy } from './fonts.js';
import { getColorVisionSimulationForTarget, getGradientRenderState, getVisualRenderState } from './gradient-rendering.js';
import { BUILTIN_GRADIENT_PRESETS, DEFAULT_GRADIENT_ANGLE, DEFAULT_GRADIENT_DURATION, DEFAULT_GRADIENT_POSITION, GRADIENT_TYPES, MAX_GRADIENT_STOPS, cloneGradient, getBuiltInGradientPreset, getGradientSignature, normalizeGradient, normalizeGradientPresetName } from './gradients.js';
import { GROUP_PROFILE_AUTOMATION_KEYS, deleteGroupProfile, getGroupProfile, isReservedCharacterIdentity, normalizeGroupKey, normalizeGroupName, normalizeRegistryIdentity, normalizeRegistryIdentityName, renameGroupProfile, setGroupProfile } from './group-profiles.js';
import { createRestoreSnapshot, redo, saveHistory, showUndoToast, undo } from './history.js';
import { applyFastColorUiUpdates, applyLiveColorChangesFromSnapshot, applyToolCallMessageRepair, areChatBindingsEqual, captureChatBinding, captureEffectiveColorSnapshot, colorizeMessages, commit, flushChatSave, flushColorStateSave, queueColorStateSave, recolorAllMessages, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { populateProfileDropdown } from './llm.js';
import { getTransientNarratorCount, getNarratorVisual, normalizeNarratorStyle, setNarratorStyle } from './narrator-style.js';
import { applyGradientPreset, applyThemeReadabilityAndBrightness, buildCharacterEntry, collectDuplicateColorKeys, createGradientRandomMasterSeed, createRandomGradient, deleteColorPreset, deleteCustomPalette, detectTheme, flipColorsForTheme, generateCustomPaletteFromWords, getBaseColor, getCustomPaletteMeta, getCustomPalettes, getEntryEffectiveColor, getNextColor, getPerceptualConflictReport, getPersonaName, getPresets, invalidateThemeCache, loadColorPreset, refreshPaletteDropdown, refreshPresetDropdown, regenerateAllColors, regenerateAllGradients, removeCharacterKeys, repairPerceptualConflicts, resolveColorPresetName, saveColorPreset, saveCustomPalette, setEntryFromBaseColor, setEntryGradient, showHarmonyPopup, suggestColorForName, swapEntryColorData, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt, updateSystemPromptDisplay } from './prompts.js';
import { escapeHtml, eventSource, event_types, getContext } from './st-api.js';
import { autoRecolorHintShown, characterColors, expandedCharacterRows, groupProfiles, isDomEngine, searchTerm, selectedCharacterKeys, setAutoRecolorHintShown, setCharacterColors, setGroupProfiles, setSearchTerm, setSwapMode, settings, swapMode, synchronizeEnabledLifecycle } from './state.js';
import { analyzeColorImport, analyzeSettingsImport, analyzeStylePackImport, applyCardData, applyColorImport, applySettingsImport, applyStylePackImport, archiveStoredColorData, deleteCustomGradientPreset, disableAutoSync, enableAutoSync, exportColors, exportSettings, getArchivedColorData, getCurrentStorageScope, getCustomGradientPresets, getLegendPosition, getStorageKey, getStorageKeyForScope, getStorageLabelForKey, getStorageScopeDescriptor, getStylePackRegistry, getUserColorDataStore, markCurrentPersonaKept, normalizeColorDataEntry, normalizeToggleSettings, pinCurrentPersonaColor, readCardData, removePinnedCharacterKey, renameCustomGradientPreset, renamePinnedPersonaColor, restoreAllSettingsToDefaults, restoreArchivedColorData, restorePinnedPersonaColor, saveCustomGradientPreset, saveData, saveLegendPosition, saveToCard, switchColorStorageScope, updateAutoSyncUI } from './storage.js';
import { buildStylePackEnvelope } from './style-pack-adapter.js';
import { escapeAttr, getGoogleFontFamily, htmlToNode, normalizeEntryGradientGenerator, normalizeGoogleFontName, normalizeHexColor, normalizeManualColorInput, toast } from './utils.js';
import { AUTO_HIGH_ATTRIBUTION_CONFIDENCE, cancelStreamingAttributionVerification, clearAutoAttributionVerificationQueue, getAttributionVerifyPasses, queueAutoAttributionVerificationForRenderedMessages, runAttributionVerification, verifyLatestAttributionsWithLLM, verifyVisibleAttributionsWithLLM } from './verify.js';

export const DYNAMIC_CONTROL_HELP_TEXT = Object.freeze({
    '.dc-char-select': 'Select this character for bulk actions.',
    '.dc-color-dot': 'Click to open the color picker for this character.',
    '.dc-color-input': 'Pick this character’s primary color.',
    '.dc-gradient-toggle': 'Enable or remove this character gradient.',
    '.dc-gradient-randomize': 'Create a new random gradient while keeping this character’s primary color.',
    '.dc-gradient-animation-enabled': 'Continuously drift the gradient colors across dialogue and labels. Your device’s Reduce Motion setting pauses the effect.',
    '.dc-gradient-preview': 'Live preview of this character gradient.',
    '.dc-gradient-add-stop': 'Add another gradient color stop.',
    '.dc-gradient-apply-preset': 'Apply the selected built-in or custom gradient preset.',
    '.dc-keep': 'Pinned characters survive Clear and bulk delete tools, and follow you into every chat with this character or group when colors are stored per chat.',
    '.dc-lock': 'Lock this character color so reset/regen tools do not change it.',
    '.dc-more': 'Open or close this character’s editing controls.',
    '.dc-swap': 'Choose two characters in sequence to swap their colors.',
    '.dc-harmony': 'Open accessible harmony suggestions for this character color.',
    '.dc-rename': 'Change this character’s primary name.',
    '.dc-alias': 'Add an alternate name that maps to this character.',
    '.dc-group': 'Assign this character to a group label.',
    '.dc-del': 'Delete this character from the list. Turn off Keep first if pinned.',
    '.dc-alias-remove': 'Remove this alias from the character.'
});

function buildCharacterControlId(prefix, key) {
    const token = Array.from(String(key ?? '')).map(character => /[A-Za-z0-9_-]/.test(character)
        ? character
        : `_${character.codePointAt(0).toString(16)}_`).join('');
    return `${prefix}-${token || 'character'}`;
}

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
let copiedGradientGenerator = null;
let selectedGradientGalleryPreset = '';
let gradientGallerySearch = '';
let gradientGalleryFilter = 'all';
let gradientGalleryMotionActive = false;
let lastColorVisionPreviewSignature = '';
const STYLE_PACK_COPY_LIMIT = 100 * 1024;
const STYLE_PACK_FILE_LIMIT = 1024 * 1024;
const CHARACTER_LIST_RENDER_LIMIT = 500;
const FLOATING_LEGEND_RENDER_LIMIT = 200;
const DIALOG_LIST_RENDER_LIMIT = 500;
const LEGEND_CANVAS_ENTRY_LIMIT = 500;
const STYLE_PACK_OVERRIDE_DIAGNOSTIC_LIMIT = 12;

function captureUiMutationContext() {
    const scope = getCurrentStorageScope();
    return {
        scope,
        storageKey: getStorageKeyForScope(scope, { persistMetadata: false }),
        cardKey: getStorageKeyForScope('card'),
        colors: characterColors,
        profiles: groupProfiles,
    };
}

function isUiMutationContextCurrent(binding) {
    const scope = getCurrentStorageScope();
    return !!binding
        && binding.scope === scope
        && binding.storageKey === getStorageKeyForScope(scope, { persistMetadata: false })
        && binding.cardKey === getStorageKeyForScope('card')
        && binding.colors === characterColors
        && binding.profiles === groupProfiles;
}

function isUiChatBindingCurrent(binding) {
    const current = captureChatBinding();
    return areChatBindingsEqual(binding, current) && binding?.chat === current?.chat;
}

function notifyUiContextChanged(message = 'The active chat, card, or color table changed. Review the action again.') {
    const result = { ok: false, error: 'context_changed', message };
    toast.info(message);
    return result;
}

function getEffectiveNarratorVisual() {
    return getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
}

function getTypographyStyle(entry) {
    const fontName = normalizeGoogleFontName(entry?.font);
    const fontFamily = getGoogleFontFamily(fontName);
    if (fontFamily) loadGoogleFont(fontName);
    const textStyle = ['', 'bold', 'italic', 'bold italic'].includes(entry?.style) ? entry.style : '';
    const bold = settings.forceBoldText === true || textStyle.includes('bold');
    return `${fontFamily ? `font-family:${fontFamily};` : ''}${bold ? 'font-weight:bold;' : ''}${textStyle.includes('italic') ? 'font-style:italic;' : ''}`;
}

function applyPreviewTypography(element, entry) {
    if (!element) return;
    const fontName = normalizeGoogleFontName(entry?.font);
    const fontFamily = getGoogleFontFamily(fontName);
    if (fontFamily) loadGoogleFont(fontName);
    const textStyle = ['', 'bold', 'italic', 'bold italic'].includes(entry?.style) ? entry.style : '';
    element.style.fontFamily = fontFamily;
    element.style.fontWeight = settings.forceBoldText === true || textStyle.includes('bold') ? 'bold' : '';
    element.style.fontStyle = textStyle.includes('italic') ? 'italic' : '';
}

function getDialogFocusables(dialog) {
    return [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden && element.getClientRects().length > 0);
}

function openDecisionDialog({ title, description = '', detailsHtml = '', choices = [], checkbox = null, input = null, formHtml = '', opener = document.activeElement }) {
    if (closeActiveUiDialog) closeActiveUiDialog(null, { restoreFocus: false });
    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'dc-dialog-backdrop';
        const titleId = `dc-dialog-title-${Date.now()}`;
        const descriptionId = description ? `${titleId}-description` : '';
        const inputId = input ? `${titleId}-input` : '';
        const inputListId = input?.options?.length ? `${inputId}-options` : '';
        backdrop.innerHTML = `
            <div class="dc-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}"${descriptionId ? ` aria-describedby="${descriptionId}"` : ''}>
                <h2 id="${titleId}" class="dc-dialog-title">${escapeHtml(title)}</h2>
                ${description ? `<p id="${descriptionId}" class="dc-dialog-description">${escapeHtml(description)}</p>` : ''}
                ${detailsHtml ? `<div class="dc-dialog-details">${detailsHtml}</div>` : ''}
                ${checkbox ? `<label class="checkbox_label dc-dialog-checkbox"><input type="checkbox" class="dc-dialog-checkbox-input"><span>${escapeHtml(checkbox.label)}</span></label>` : ''}
                ${input ? `<label class="dc-dialog-input" for="${inputId}"><span>${escapeHtml(input.label)}</span><input id="${inputId}" class="text_pole dc-dialog-text-input" type="text" value="${escapeAttr(input.value || '')}"${inputListId ? ` list="${inputListId}"` : ''} autocomplete="off">${input.help ? `<small>${escapeHtml(input.help)}</small>` : ''}</label>${inputListId ? `<datalist id="${inputListId}">${input.options.map(option => `<option value="${escapeAttr(option)}"></option>`).join('')}</datalist>` : ''}` : ''}
                ${formHtml}
                <div class="dc-dialog-actions">
                    ${choices.map(choice => `<button type="button" class="menu_button${choice.primary ? ' dc-primary-button' : ''}${choice.danger ? ' dc-danger-button' : ''}" data-dialog-value="${escapeAttr(choice.value)}"${choice.initial ? ' data-dialog-initial="true"' : ''}${choice.disabled ? ' disabled' : ''}>${escapeHtml(choice.label)}</button>`).join('')}
                </div>
            </div>`;
        (document.body || document.documentElement).appendChild(backdrop);
        const dialog = backdrop.querySelector('.dc-dialog');
        registerGradientAnimationRoot(dialog);
        const inertSiblings = [...((document.body?.children) ? document.body.children : [])]
            .filter(element => element !== backdrop && !element.inert)
            .map(element => { element.inert = true; return element; });
        let closed = false;
        const close = (value, { restoreFocus = true } = {}) => {
            if (closed) return;
            closed = true;
            const checked = !!dialog.querySelector('.dc-dialog-checkbox-input')?.checked;
            const selected = [...dialog.querySelectorAll('.dc-dialog-select:checked')].map(input => input.dataset.value);
            const inputValue = dialog.querySelector('.dc-dialog-text-input')?.value ?? '';
            const formValues = {};
            dialog.querySelectorAll('[data-dialog-field]').forEach(field => {
                if (!field.dataset.dialogField) return;
                formValues[field.dataset.dialogField] = field.type === 'checkbox' ? field.checked : field.value;
            });
            document.removeEventListener('keydown', onKeyDown, true);
            inertSiblings.forEach(element => { element.inert = false; });
            unregisterGradientAnimationRoot(dialog);
            backdrop.remove();
            if (closeActiveUiDialog === close) closeActiveUiDialog = null;
            if (restoreFocus && opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
            resolve({ value, checked, selected, inputValue, formValues });
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
        (dialog.querySelector('[data-dialog-autofocus]') || dialog.querySelector('.dc-dialog-text-input') || dialog.querySelector('[data-dialog-initial]') || dialog.querySelector('.dc-primary-button') || getDialogFocusables(dialog)[0])?.focus({ preventScroll: true });
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

function getGradientPresentation(entry, options = {}) {
    const gradient = normalizeGradient(entry?.gradient);
    const state = getGradientRenderState(entry, { target: options.target || 'ui', allowAnimation: options.allowAnimation });
    if (!gradient || !state) return null;
    return {
        gradient,
        ...state,
        classes: `dc-has-gradient dc-gradient-${gradient.type}${state.animationEnabled ? ' dc-gradient-animated' : ''}${gradient.animation.reverse ? ' dc-gradient-reverse' : ''}`,
        dataAttributes: `data-dc-gradient="${state.type}" data-dc-gradient-animation="${state.animationEnabled ? 'on' : 'off'}" data-dc-gradient-reverse="${state.reverse}" data-gradient="${state.type}" data-gradient-type="${state.type}" data-gradient-animated="${state.animationEnabled}" data-gradient-reverse="${state.reverse}"`,
    };
}

function buildGradientSurfaceStyle(entry, { text = false, target = 'ui', allowAnimation } = {}) {
    const color = getVisualRenderState(entry, { target }).fallbackColor;
    const presentation = getGradientPresentation(entry, { target, allowAnimation });
    if (!presentation) return text ? `color:${color};` : `background-color:${color};`;
    const animationProperties = `--dc-text-gradient:${presentation.css};--dc-gradient:${presentation.css};--dc-gradient-fallback:${presentation.fallbackColor};--dc-gradient-animation-enabled:${presentation.animationEnabled ? 1 : 0};--dc-gradient-duration:${presentation.durationSeconds}s;--dc-gradient-reverse:${presentation.reverse ? 1 : 0};--dc-gradient-direction:${presentation.reverse ? 'alternate-reverse' : 'alternate'};`;
    if (text) {
        return `color:${color};${animationProperties}background-image:${presentation.css};background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;`;
    }
    return `background-color:${color};${animationProperties}background-image:${presentation.css};`;
}

function setGradientPresentation(element, entry, { text = false, target = 'ui', allowAnimation } = {}) {
    if (!element) return;
    const color = getVisualRenderState(entry, { target }).fallbackColor;
    const presentation = getGradientPresentation(entry, { target, allowAnimation });
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
        refreshGradientAnimationState();
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
    registerGradientAnimationElement(element);
    refreshGradientAnimationState();
}

function getGradientCanvasStops(entry, options = {}) {
    const gradient = normalizeGradient(entry?.gradient);
    if (!gradient) return null;
    const visual = getVisualRenderState(entry, {
        target: options.target || 'ui',
        colorVision: options.colorVision,
    });
    return {
        gradient,
        stops: visual.canvasStops.map(stop => ({ color: stop.color, position: stop.offset * 100 })),
        fallbackColor: visual.fallbackColor,
    };
}

export function createCanvasGradientFill(ctx, entry, bounds, options = {}) {
    const data = getGradientCanvasStops(entry, options);
    if (!data || !ctx || !bounds) return getVisualRenderState(entry, {
        target: options.target || 'ui',
        colorVision: options.colorVision,
    }).fallbackColor;
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
    } else if (data.gradient.type === 'conic' && typeof ctx.createConicGradient === 'function') {
        const originX = x + width * data.gradient.x / 100;
        const originY = y + height * data.gradient.y / 100;
        fill = ctx.createConicGradient((data.gradient.angle - 90) * Math.PI / 180, originX, originY);
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
function matchesPersonaIdentity(entry, personaIdentity) {
    if (!entry) return false;
    if (normalizeRegistryIdentity(entry.name) === personaIdentity) return true;
    return (entry.aliases || []).some(alias => normalizeRegistryIdentity(alias) === personaIdentity);
}

// The persona is easy to lose among detected NPCs, so it is flagged and floated to
// the top of the list. Matching by identity keeps aliases working.
export function isPersonaEntry(entry) {
    const personaIdentity = normalizeRegistryIdentity(getPersonaName());
    return !!personaIdentity && matchesPersonaIdentity(entry, personaIdentity);
}

export function getSortedEntries() {
    const needle = searchTerm.trim().toLowerCase();
    const entries = Object.entries(characterColors).filter(([, entry]) => {
        if (!needle) return true;
        return [entry.name, entry.group, entry.font, ...(entry.aliases || []), entry.keep ? 'kept pinned' : '', entry.locked ? 'locked' : '']
            .some(value => String(value || '').toLowerCase().includes(needle));
    });
    const personaIdentity = normalizeRegistryIdentity(getPersonaName());
    const isPersona = entry => !!personaIdentity && matchesPersonaIdentity(entry, personaIdentity);
    entries.sort((a, b) => {
        if (settings.sortMode === 'group') {
            const leftGroup = normalizeGroupKey(a[1].group);
            const rightGroup = normalizeGroupKey(b[1].group);
            const groupComparison = !leftGroup && rightGroup ? 1
                : leftGroup && !rightGroup ? -1
                    : leftGroup.localeCompare(rightGroup);
            if (groupComparison) return groupComparison;
            if (isPersona(a[1]) !== isPersona(b[1])) return isPersona(b[1]) ? 1 : -1;
            if (!!b[1].keep !== !!a[1].keep) return Number(b[1].keep) - Number(a[1].keep);
            return a[1].name.localeCompare(b[1].name);
        }
        if (isPersona(a[1]) !== isPersona(b[1])) return isPersona(b[1]) ? 1 : -1;
        if (!!b[1].keep !== !!a[1].keep) return Number(b[1].keep) - Number(a[1].keep);
        if (settings.sortMode === 'count') return (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0) || a[1].name.localeCompare(b[1].name);
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
export async function exportLegendPng() {
    const characterCount = Object.keys(characterColors).length;
    if (characterCount > LEGEND_CANVAS_ENTRY_LIMIT) {
        toast.warning(`Legend image export is limited to ${LEGEND_CANVAS_ENTRY_LIMIT} characters; narrow the active table first.`);
        return;
    }
    const characterEntries = Object.values(characterColors).map(entry => ({ entry, label: entry.name, kind: 'character' }));
    const narrator = getEffectiveNarratorVisual();
    const entries = [...characterEntries, ...(narrator ? [{ entry: narrator, label: 'Narration', kind: 'narrator' }] : [])];
    if (!entries.length) { toast.info('No character or narration visuals to export'); return; }
    const activePreview = settings.colorVisionPreviewMode !== 'none'
        && Number(settings.colorVisionPreviewSeverity) > 0
        && ['ui', 'all'].includes(settings.colorVisionPreviewTarget);
    let colorVision = { mode: 'none', severity: 0 };
    if (activePreview) {
        const decision = await openDecisionDialog({
            title: 'Export legend appearance',
            description: 'Choose whether the image uses stored colors or the current color-vision preview.',
            choices: [
                { value: 'normal', label: 'Normal colors', primary: true, initial: true },
                { value: 'preview', label: 'Current preview' },
                { value: 'cancel', label: 'Cancel' },
            ],
        });
        if (!decision.value || decision.value === 'cancel') return;
        if (decision.value === 'preview') colorVision = getColorVisionSimulationForTarget('ui');
    }
    const renderedEntries = entries.map(item => {
        const fontName = normalizeGoogleFontName(item.entry.font);
        const fontFamily = getGoogleFontFamily(fontName);
        const textStyle = String(item.entry.style || '');
        return {
            ...item,
            fontName,
            canvasFont: `${textStyle.includes('italic') ? 'italic ' : ''}${settings.forceBoldText || textStyle.includes('bold') ? 'bold ' : ''}14px ${fontFamily || 'sans-serif'}`,
        };
    });
    await Promise.all(renderedEntries
        .filter(item => item.fontName)
        .map(item => loadGoogleFont(item.fontName, { wait: true })));
    if (document.fonts?.load) {
        await Promise.all(renderedEntries.filter(item => item.fontName).map(async item => {
            try { await document.fonts.load(item.canvasFont); } catch { /* Canvas falls back to an available family. */ }
        }));
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const lineHeight = 24, padding = 16, dotSize = 10;
    canvas.width = 300;
    const narrationGap = narrator && characterEntries.length ? 10 : 0;
    canvas.height = renderedEntries.length * lineHeight + narrationGap + padding * 2;
    const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
    ctx.fillStyle = mode === 'dark' ? '#1a1a2e' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let rowY = padding + lineHeight / 2;
    renderedEntries.forEach(({ entry: v, label, kind, canvasFont }) => {
        if (kind === 'narrator' && characterEntries.length) {
            ctx.strokeStyle = mode === 'dark' ? '#596070' : '#c4c7ce';
            ctx.beginPath();
            ctx.moveTo(padding, rowY - lineHeight / 2 + 2);
            ctx.lineTo(canvas.width - padding, rowY - lineHeight / 2 + 2);
            ctx.stroke();
            rowY += narrationGap;
        }
        const y = rowY;
        const safeColor = getVisualRenderState(v, { target: 'ui', colorVision }).fallbackColor;
        ctx.beginPath();
        ctx.arc(padding + dotSize / 2, y, dotSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = createCanvasGradientFill(ctx, v, { x: padding, y: y - dotSize / 2, width: dotSize, height: dotSize }, { colorVision });
        ctx.fill();
        ctx.font = canvasFont;
        const textX = padding + dotSize + 8;
        const count = kind === 'narrator' ? getTransientNarratorCount(getContext()?.chat) : null;
        const text = kind === 'narrator' && count !== null ? `${label} (${count})` : label;
        const textWidth = Math.max(1, ctx.measureText(text).width);
        ctx.fillStyle = createCanvasGradientFill(ctx, v, { x: textX, y: y - 12, width: textWidth, height: 17 }, { colorVision }) || safeColor;
        ctx.fillText(text, textX, y + 5);
        rowY += lineHeight;
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

        legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:99998;font-size:0.8em;max-width:180px;max-height:60vh;overflow-y:auto;display:none;user-select:none;`;

        let isDragging = false;
        let activePointerId = null;
        let startX, startY, startLeft, startTop;

        const onPointerDown = (e) => {
            if (!e.target.closest('.dc-legend-handle') || e.target.closest('button, input')) return;
            if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
            const rect = legend.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            if (startX == null || startY == null) return;
            isDragging = true;
            activePointerId = e.pointerId;
            startLeft = rect.left;
            startTop = rect.top;
            legend.style.right = 'auto';
            legend.style.left = startLeft + 'px';
            legend.setPointerCapture?.(activePointerId);
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!isDragging || e.pointerId !== activePointerId) return;
            const clientX = e.clientX;
            const clientY = e.clientY;
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

        const onPointerEnd = (e) => {
            if (!isDragging || e.pointerId !== activePointerId) return;
            isDragging = false;
            const pointerId = activePointerId;
            activePointerId = null;
            const rect = legend.getBoundingClientRect();
            saveLegendPosition({ top: rect.top, left: rect.left });
            if (legend.hasPointerCapture?.(pointerId)) legend.releasePointerCapture(pointerId);
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

        legend.addEventListener('pointerdown', onPointerDown);
        legend.addEventListener('pointermove', onPointerMove);
        legend.addEventListener('pointerup', onPointerEnd);
        legend.addEventListener('pointercancel', onPointerEnd);
        legend.addEventListener('lostpointercapture', onPointerEnd);

        document.body.appendChild(legend);
        registerGradientAnimationRoot(legend);
    }
    return legend;
}

export function updateLegend() {
    const legend = createLegend();
    const allEntries = Object.entries(characterColors);
    const entries = allEntries.slice(0, FLOATING_LEGEND_RENDER_LIMIT);
    const omittedEntryCount = allEntries.length - entries.length;
    const narrator = getEffectiveNarratorVisual();
    const narratorCount = getTransientNarratorCount(getContext()?.chat);
    const signature = JSON.stringify({
        visible: !!settings.showLegend,
        remoteFonts: settings.allowRemoteFonts === true,
        forceBold: settings.forceBoldText === true,
        driftAll: settings.driftAllGradientColors === true,
        omittedEntryCount,
        colorVision: getColorVisionSimulationForTarget('ui'),
        entries: entries.map(([key, entry]) => [
            key,
            entry.name,
            entry.dialogueCount || 0,
            getVisualRenderState(entry, { target: 'ui' }).fallbackColor,
            normalizeGoogleFontName(entry.font),
            entry.style || '',
            getGradientSignature(entry),
        ]),
        narrator: narrator ? [narratorCount, getVisualRenderState(narrator, { target: 'ui' }).fallbackColor, getGradientSignature(narrator), narrator.font, narrator.style] : null,
    });
    if ((!allEntries.length && !narrator) || !settings.showLegend) {
        legend.style.display = 'none';
        lastLegendSignature = signature;
        return;
    }
    if (signature === lastLegendSignature && legend.style.display === 'block') return;
    lastLegendSignature = signature;
    const focusedLegendControl = legend.contains(document.activeElement)
        ? document.activeElement.closest('.dc-legend-reset, .dc-legend-hide, .dc-legend-handle')
        : null;
    const focusSelector = focusedLegendControl?.classList.contains('dc-legend-reset')
        ? '.dc-legend-reset'
        : focusedLegendControl?.classList.contains('dc-legend-hide')
            ? '.dc-legend-hide'
            : focusedLegendControl ? '.dc-legend-handle' : '';
    legend.innerHTML = '<div class="dc-legend-handle" tabindex="0" role="toolbar" aria-label="Move character legend with arrow keys"><strong>Characters</strong><span><button type="button" class="dc-legend-reset" aria-label="Reset legend position" title="Reset position">↺</button><button type="button" class="dc-legend-hide" aria-label="Hide character legend" title="Hide legend">×</button></span></div>' +
        entries.map(([, v]) => {
             const presentation = getGradientPresentation(v, { target: 'ui' });
            const gradientClasses = presentation ? ` dc-gradient-legend-item ${presentation.classes}` : '';
            const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
            return `<div class="dc-legend-character${gradientClasses}"${gradientAttributes} style="display:flex;align-items:center;gap:4px;"><span class="dc-legend-swatch${presentation ? ' dc-gradient-surface' : ''}"${gradientAttributes} style="width:8px;height:8px;border-radius:50%;${escapeAttr(buildGradientSurfaceStyle(v))}"></span><span class="dc-legend-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(v, { text: true }) + getTypographyStyle(v))}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`;
        }).join('') + (narrator ? (() => {
            const presentation = getGradientPresentation(narrator, { target: 'ui' });
            const gradientClasses = presentation ? ` dc-gradient-legend-item ${presentation.classes}` : '';
            const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
            const countLabel = narratorCount === null ? 'Visual only' : String(narratorCount);
            return `<div class="dc-legend-section-label">Narration</div><div class="dc-legend-character dc-legend-narration${gradientClasses}"${gradientAttributes} style="display:flex;align-items:center;gap:4px;"><span class="dc-legend-swatch${presentation ? ' dc-gradient-surface' : ''}"${gradientAttributes} style="width:8px;height:8px;border-radius:50%;${escapeAttr(buildGradientSurfaceStyle(narrator))}"></span><span class="dc-legend-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(narrator, { text: true }) + getTypographyStyle(narrator))}">Narration</span><span style="opacity:0.5;font-size:0.8em;">${escapeHtml(countLabel)}</span></div>`;
        })() : '') + (omittedEntryCount
        ? `<p class="dc-list-limit">${omittedEntryCount} additional character${omittedEntryCount === 1 ? '' : 's'} omitted from the floating legend.</p>`
        : '');
    legend.style.display = settings.showLegend ? 'block' : 'none';
    if (focusSelector && settings.showLegend) legend.querySelector(focusSelector)?.focus({ preventScroll: true });
    if (settings.showLegend) requestAnimationFrame(() => legend.__dcClampPosition?.());
    registerGradientAnimationRoot(legend);
    refreshGradientAnimationState();
}

export function getDialogueStats(limit = Number.POSITIVE_INFINITY) {
    const entries = Object.entries(characterColors);
    const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
    entries.sort(([, left], [, right]) => (right.dialogueCount || 0) - (left.dialogueCount || 0));
    const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : entries.length;
    return entries.slice(0, boundedLimit).map(([, v]) => ({
        name: v.name,
        count: v.dialogueCount || 0,
        pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0,
        color: getEntryEffectiveColor(v),
        font: normalizeGoogleFontName(v.font),
        baseColor: getBaseColor(v),
        gradient: cloneGradient(v.gradient),
        gradientCss: getVisualRenderState(v, { target: 'ui' }).gradientCss,
    }));
}

export async function showStatsPopup() {
    const totalStatsCount = Object.keys(characterColors).length;
    const stats = getDialogueStats(DIALOG_LIST_RENDER_LIMIT);
    const omittedCount = totalStatsCount - stats.length;
    const narrator = getEffectiveNarratorVisual();
    if (!stats.length && !narrator) { toast.info('No dialogue or narration data'); return; }
    let maxCount = 1;
    for (const stat of stats) maxCount = Math.max(maxCount, stat.count);
    const dialogueHtml = stats.map(s => {
        const statEntry = { color: s.color, baseColor: s.baseColor, gradient: s.gradient };
        const fontFamily = getGoogleFontFamily(s.font);
        if (fontFamily) loadGoogleFont(s.font);
        const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
        const presentation = getGradientPresentation(statEntry);
        const gradientClasses = presentation ? ` ${presentation.classes}` : '';
        const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
        return `<div class="dc-stats-character${gradientClasses}"${gradientAttributes}><span class="dc-stats-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(statEntry, { text: true }))}${fontStyle}">${escapeHtml(s.name)}</span><div class="dc-stats-track" aria-hidden="true"><div class="dc-stats-bar${presentation ? ' dc-gradient-surface' : ''}"${gradientAttributes} style="width:${s.count / maxCount * 100}%;${escapeAttr(buildGradientSurfaceStyle(statEntry))}"></div></div><span class="dc-stats-value">${s.count} (${s.pct}%)</span></div>`;
    }).join('');
    const narratorCount = getTransientNarratorCount(getContext()?.chat);
    const narrationHtml = narrator ? (() => {
        const presentation = getGradientPresentation(narrator);
        const gradientClasses = presentation ? ` ${presentation.classes}` : '';
        const gradientAttributes = presentation ? ` ${presentation.dataAttributes}` : '';
        const value = narratorCount === null ? 'Visual only; no reliable count available' : `${narratorCount} tagged narration span${narratorCount === 1 ? '' : 's'}`;
        return `<div class="dc-stats-narration${gradientClasses}"${gradientAttributes}><span class="dc-stats-name${presentation ? ' dc-gradient-text' : ''}"${gradientAttributes} style="${escapeAttr(buildGradientSurfaceStyle(narrator, { text: true }) + getTypographyStyle(narrator))}">Narration</span><span class="dc-stats-value">${escapeHtml(value)}</span></div>`;
    })() : '';
    const html = `${dialogueHtml}${narrationHtml ? `<div class="dc-stats-section-label">Narration</div>${narrationHtml}` : ''}`;
    await openDecisionDialog({
        title: 'Dialogue activity',
        description: 'Dialogue percentages exclude narration. Narration is shown separately and counted only when saved tags identify it safely.',
        detailsHtml: `<div class="dc-stats-list">${html}</div>${omittedCount ? `<p class="dc-list-limit">${omittedCount} additional character${omittedCount === 1 ? '' : 's'} omitted from this bounded view.</p>` : ''}`,
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
        const groupProfileCount = Object.keys(entry.groupProfiles || {}).length;
        const names = Object.values(colors).map(v => v.name).filter(Boolean).slice(0, 3);
        const isCurrent = k === currentKey;
        const scope = k === 'dc_global' ? 'Global' : k.startsWith('dc_chat_') ? 'Per chat' : 'Per card';
        const identity = names.length ? names.join(', ') + (colorCount > 3 ? ` (+${colorCount - 3})` : '') : getStorageLabelForKey(k);
        const label = `${scope}: ${identity}`;
        const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
        return { key: k, label, colorCount, groupProfileCount, sizeStr, size, isCurrent, updatedAt: entry.updatedAt || '' };
    });
    entries.sort((a, b) => a.isCurrent ? -1 : b.isCurrent ? 1 : a.key.localeCompare(b.key));

    const rows = entries.map(e => {
        const tag = e.isCurrent ? '<span class="dc-current-badge">Active</span>' : '';
        return `<label class="dc-storage-row${e.isCurrent ? ' dc-storage-current' : ''}"><input type="checkbox" class="dc-dialog-select" data-value="${escapeAttr(e.key)}"${e.isCurrent ? ' disabled' : ''}><span class="dc-storage-entry"><strong>${escapeHtml(e.label)} ${tag}</strong><small>${e.colorCount} characters, ${e.groupProfileCount} group profiles, ${escapeHtml(e.sizeStr)}, ${escapeHtml(formatDate(e.updatedAt))}</small></span></label>`;
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
    refreshAttributionReviewStatus();
}

function formatAttributionSource(source) {
    const labels = {
        llm: 'LLM verifier',
        review: 'Reviewed suggestion',
        manual: 'Manual assignment',
        override: 'Saved override',
        'explicit-mention': 'Explicit mention',
        'streaming-cache': 'Streaming cache',
        'paragraph-subject': 'Paragraph subject',
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

function formatAttributionConfidence(value) {
    const confidence = Math.max(0, Math.min(1, Number(value) || 0));
    const label = confidence >= AUTO_HIGH_ATTRIBUTION_CONFIDENCE
        ? 'High'
        : confidence >= 0.5 ? 'Medium' : 'Low';
    return `${label} (${Math.round(confidence * 100)}%)`;
}

function getPendingAttributionReviews() {
    return listAttributionReviews({
        status: ATTRIBUTION_REVIEW_STATUS.PENDING,
        oldestFirst: true,
    });
}

export function refreshAttributionReviewStatus() {
    const count = getPendingAttributionReviews().length;
    const button = document.getElementById('dc-review-attr');
    const status = document.getElementById('dc-review-attr-status');
    if (button) button.textContent = `Review suggestions (${count})`;
    if (status) status.textContent = `${count} review suggestion${count === 1 ? '' : 's'}.`;
    return count;
}

function getKnownReviewSpeakerName(name) {
    const key = resolveCharacterKeyByNameOrAlias(String(name || '').trim());
    return key && characterColors[key] ? characterColors[key].name : '';
}

function getKnownReviewSpeakerOptions() {
    const names = new Set();
    Object.values(characterColors).forEach(entry => {
        if (!entry?.name) return;
        names.add(entry.name);
        (entry.aliases || []).forEach(alias => names.add(alias));
    });
    return [...names].sort((left, right) => left.localeCompare(right));
}

function getReviewMessage(review) {
    const chat = getContext()?.chat || [];
    const expectedId = String(review.messageId || '');
    const matchesId = message => !expectedId || String(message?.id ?? message?.send_date ?? '') === expectedId;
    const indexed = Number.isInteger(review.messageIndex) ? chat[review.messageIndex] : null;
    if (indexed && matchesId(indexed)) {
        return { message: indexed, index: review.messageIndex };
    }
    const byId = expectedId ? chat.find(message => matchesId(message)) : null;
    if (byId) return { message: byId, index: chat.indexOf(byId) };
    const byFingerprint = chat.find(message => createMessageFingerprint(message) === review.messageFingerprint);
    return byFingerprint ? { message: byFingerprint, index: chat.indexOf(byFingerprint) } : { message: null, index: -1 };
}

function getAttributionReviewPresentation(review) {
    const resolved = getReviewMessage(review);
    const message = resolved.message;
    if (!message) {
        return {
            review,
            message: null,
            messageIndex: -1,
            excerpt: '',
            currentSpeaker: review.currentSpeaker || 'Unassigned',
            stale: true,
            staleReason: 'Message is no longer in this chat.',
        };
    }

    const messageFingerprint = createMessageFingerprint(message);
    if (messageFingerprint !== review.messageFingerprint) {
        return {
            review,
            message,
            messageIndex: resolved.index,
            excerpt: String(message.mes || '').slice(0, 280),
            currentSpeaker: review.currentSpeaker || 'Unassigned',
            stale: true,
            staleReason: 'Message text changed.',
        };
    }

    const attribution = attributeDialogueSegments(message.mes, message.name, {
        autoAddMessageSpeaker: false,
        ...getMessageQuoteOverrideOptions(resolved.index, message),
        mesIndex: resolved.index,
    });
    const segment = attribution.segments.find(item => item.index === review.segmentIndex);
    const segmentMatches = !!segment
        && createSegmentFingerprint(segment, messageFingerprint) === review.segmentFingerprint;
    const excerpt = segment?.text
        || (Number.isInteger(review.segmentStart) && Number.isInteger(review.segmentEnd)
            ? String(message.mes || '').slice(review.segmentStart, review.segmentEnd)
            : String(message.mes || '').slice(0, 280));
    return {
        review,
        message,
        messageIndex: resolved.index,
        segment,
        excerpt,
        currentSpeaker: segment?.assignment?.name || review.currentSpeaker || 'Unassigned',
        stale: !segmentMatches,
        staleReason: segmentMatches ? '' : 'Dialogue segment changed.',
    };
}

function buildAttributionReviewDetails(presentation) {
    const { review } = presentation;
    const excerpt = presentation.excerpt || 'No matching dialogue excerpt is available.';
    return `<article class="dc-attribution-review-item${presentation.stale ? ' dc-attribution-review-stale' : ''}">
        <dl class="dc-review-list dc-attribution-review-list">
            <div><dt>Message index</dt><dd>${presentation.messageIndex >= 0 ? presentation.messageIndex : review.messageIndex ?? 'Unknown'}</dd></div>
            <div><dt>Excerpt</dt><dd><q class="dc-attribution-review-excerpt">${escapeHtml(excerpt)}</q></dd></div>
            <div><dt>Current speaker</dt><dd>${escapeHtml(presentation.currentSpeaker)}</dd></div>
            <div><dt>Proposed speaker</dt><dd>${escapeHtml(review.proposedSpeaker)}</dd></div>
            <div><dt>Source</dt><dd>${escapeHtml(formatAttributionSource(review.source))}</dd></div>
            <div><dt>Confidence</dt><dd>${escapeHtml(formatAttributionConfidence(review.confidence))}</dd></div>
            <div><dt>Status</dt><dd><strong>${presentation.stale ? 'Stale' : 'Current'}</strong>${presentation.staleReason ? `: ${escapeHtml(presentation.staleReason)}` : ''}</dd></div>
        </dl>
    </article>`;
}

function jumpToAttributionReviewMessage(presentation) {
    if (!Number.isInteger(presentation.messageIndex) || presentation.messageIndex < 0) {
        toast.info('This message is no longer available.');
        return;
    }
    const messageElement = document.querySelector(`#chat .mes[mesid="${presentation.messageIndex}"]`)
        || document.querySelectorAll('#chat .mes[mesid]')[presentation.messageIndex];
    if (!messageElement) {
        toast.info('This message is not currently rendered.');
        return;
    }
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    messageElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const target = messageElement.querySelector(`[data-dc-seg="${presentation.review.segmentIndex}"]`) || messageElement.querySelector('.mes_text') || messageElement;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
}

async function repaintAcceptedAttributionReview(decision) {
    const messageIndex = Number(decision?.messageIndex);
    const message = Number.isInteger(messageIndex) ? getContext()?.chat?.[messageIndex] : null;
    if (!message) return false;
    clearMessageDomRepairTimer(messageIndex);
    cancelMessageDomFollowupRepairs(messageIndex);
    clearStreamingAttributionOverrides(messageIndex);
    let repainted = await decorateMessageDomFromCurrentRender(messageIndex, message, {
        queueVerification: false,
        renderFallback: false,
    });
    if (!repainted) repainted = await refreshAndDecorateMessageDom(messageIndex, message, { queueVerification: false });
    if (repainted) scheduleMessageDomFollowupRepair(messageIndex, repainted);
    return repainted;
}

async function editAndAcceptAttributionReview(review, opener) {
    const options = getKnownReviewSpeakerOptions();
    let editedName = review.proposedSpeaker;
    while (true) {
        const decision = await openDecisionDialog({
            title: 'Edit suggested speaker',
            description: 'Use a configured canonical speaker or alias. This is a reviewed assignment, not a new-character action.',
            detailsHtml: `<p class="dc-section-note">Suggested: ${escapeHtml(review.proposedSpeaker)}</p>`,
            input: {
                label: 'Known speaker or alias',
                value: editedName,
                options,
                help: 'Only known speakers and aliases can be accepted here.',
            },
            opener,
            choices: [
                { value: 'accept', label: 'Edit and accept', primary: true, initial: true },
                { value: 'cancel', label: 'Cancel' },
            ],
        });
        if (decision.value !== 'accept') return '';
        editedName = decision.inputValue;
        const canonicalName = getKnownReviewSpeakerName(editedName);
        if (canonicalName) return canonicalName;
        toast.warning('Choose a known canonical speaker or alias. Direct manual assignment is available from the dialogue context menu.');
    }
}

async function acceptAttributionReviewFromUi(presentation, speakerName = '', options = {}) {
    const review = presentation.review;
    const acceptedName = getKnownReviewSpeakerName(speakerName || review.proposedSpeaker);
    if (!acceptedName) {
        toast.warning('The proposed speaker is not configured. Edit the suggestion to a known speaker or reject it.');
        return false;
    }
    const decision = acceptAttributionReview(review.id, { speaker: acceptedName });
    if (!decision || decision.status !== ATTRIBUTION_REVIEW_STATUS.ACCEPTED) {
        toast.info('This suggestion is no longer current. Dismiss the stale suggestion instead.');
        return false;
    }
    try {
        await repaintAcceptedAttributionReview(decision);
    } catch (error) {
        console.error('[Dialogue Colors] Accepted attribution review could not repaint:', error);
        toast.warning('The suggestion was accepted, but its message could not refresh immediately.');
    }
    if (!options.quiet) toast.success(`Accepted ${escapeHtml(acceptedName)}.`);
    return true;
}

async function acceptAllHighConfidenceAttributionReviews(opener) {
    const candidates = getPendingAttributionReviews()
        .map(getAttributionReviewPresentation)
        .filter(presentation => !presentation.stale
            && Number(presentation.review.confidence) >= AUTO_HIGH_ATTRIBUTION_CONFIDENCE
            && !!getKnownReviewSpeakerName(presentation.review.proposedSpeaker));
    if (!candidates.length) {
        toast.info(`No current known-speaker suggestions meet the ${Math.round(AUTO_HIGH_ATTRIBUTION_CONFIDENCE * 100)}% threshold.`);
        return 0;
    }
    const confirmed = await confirmReviewedAction({
        title: `Accept ${candidates.length} high-confidence suggestion${candidates.length === 1 ? '' : 's'}?`,
        description: `Each suggestion is at least ${Math.round(AUTO_HIGH_ATTRIBUTION_CONFIDENCE * 100)}% confident and targets an existing speaker. This keeps the default review-all policy unchanged.`,
        detailsHtml: `<p class="dc-review-names">${candidates.slice(0, 12).map(presentation => `Message ${presentation.messageIndex}: ${escapeHtml(getKnownReviewSpeakerName(presentation.review.proposedSpeaker))}`).join('<br>')}${candidates.length > 12 ? `<br>and ${candidates.length - 12} more` : ''}</p>`,
        confirmLabel: 'Accept high-confidence',
        opener,
    });
    if (!confirmed) return 0;
    let accepted = 0;
    for (const presentation of candidates) {
        if (await acceptAttributionReviewFromUi(presentation, '', { quiet: true })) accepted++;
    }
    if (accepted > 1) toast.success(`Accepted ${accepted} high-confidence suggestions.`);
    return accepted;
}

async function acceptAllProposedAttributionReviews(opener) {
    const candidates = getPendingAttributionReviews()
        .map(getAttributionReviewPresentation)
        .filter(presentation => !presentation.stale
            && !!getKnownReviewSpeakerName(presentation.review.proposedSpeaker));
    if (!candidates.length) {
        toast.info('No current known-speaker suggestions to accept.');
        return 0;
    }
    const confirmed = await confirmReviewedAction({
        title: `Accept all ${candidates.length} proposed suggestion${candidates.length === 1 ? '' : 's'}?`,
        description: 'All pending proposed suggestions for known speakers will be applied to local dialogue colors.',
        detailsHtml: `<p class="dc-review-names">${candidates.slice(0, 12).map(presentation => `Message ${presentation.messageIndex}: ${escapeHtml(getKnownReviewSpeakerName(presentation.review.proposedSpeaker))}`).join('<br>')}${candidates.length > 12 ? `<br>and ${candidates.length - 12} more` : ''}</p>`,
        confirmLabel: 'Accept all proposed',
        opener,
    });
    if (!confirmed) return 0;
    let accepted = 0;
    for (const presentation of candidates) {
        if (await acceptAttributionReviewFromUi(presentation, '', { quiet: true })) accepted++;
    }
    if (accepted > 0) toast.success(`Accepted ${accepted} proposed suggestion${accepted !== 1 ? 's' : ''}.`);
    return accepted;
}

async function showAttributionReviewDialog(opener) {
    let nextReviewId = '';
    while (true) {
        const reviews = getPendingAttributionReviews();
        if (!reviews.length) {
            await openDecisionDialog({
                title: 'Review suggestions',
                description: 'No pending attribution suggestions.',
                opener,
                choices: [{ value: 'close', label: 'Close', primary: true, initial: true }],
            });
            break;
        }
        const reviewIndex = Math.max(0, reviews.findIndex(review => review.id === nextReviewId));
        const review = reviews[reviewIndex];
        const presentation = getAttributionReviewPresentation(review);
        const canAccept = !presentation.stale && !!getKnownReviewSpeakerName(review.proposedSpeaker);
        const decision = await openDecisionDialog({
            title: `Review suggestion ${reviewIndex + 1} of ${reviews.length}`,
            description: canAccept
                ? 'Review the proposed attribution before applying it.'
                : presentation.stale
                    ? 'This suggestion no longer matches the current chat.'
                    : 'The proposed speaker is not a configured character or alias.',
            detailsHtml: buildAttributionReviewDetails(presentation),
            opener,
            choices: [
                { value: 'accept', label: 'Accept', primary: canAccept, disabled: !canAccept },
                { value: 'edit', label: 'Edit and accept', disabled: presentation.stale },
                { value: 'reject', label: 'Keep current/reject', disabled: presentation.stale },
                { value: 'jump', label: 'Jump to message', disabled: presentation.messageIndex < 0 },
                { value: 'next', label: 'Next' },
                { value: 'accept-all', label: 'Accept all proposed' },
                { value: 'accept-high', label: 'Accept all high-confidence' },
                ...(presentation.stale ? [{ value: 'dismiss', label: 'Dismiss stale', primary: true }] : []),
                { value: 'close', label: 'Close', initial: !canAccept && !presentation.stale },
            ],
        });
        if (!decision.value || decision.value === 'close') break;
        if (decision.value === 'jump') {
            jumpToAttributionReviewMessage(presentation);
            break;
        }
        if (decision.value === 'next') {
            nextReviewId = reviews[reviewIndex + 1]?.id || reviews[0]?.id || '';
            continue;
        }
        if (decision.value === 'accept-all') {
            await acceptAllProposedAttributionReviews(opener);
            nextReviewId = reviews[reviewIndex + 1]?.id || '';
            continue;
        }
        if (decision.value === 'accept-high') {
            await acceptAllHighConfidenceAttributionReviews(opener);
            nextReviewId = reviews[reviewIndex + 1]?.id || '';
            continue;
        }
        if (decision.value === 'edit') {
            const editedSpeaker = await editAndAcceptAttributionReview(review, opener);
            if (editedSpeaker) await acceptAttributionReviewFromUi(presentation, editedSpeaker);
        } else if (decision.value === 'accept') {
            await acceptAttributionReviewFromUi(presentation);
        } else if (decision.value === 'reject') {
            rejectAttributionReview(review.id);
            toast.info('Kept the current speaker.');
        } else if (decision.value === 'dismiss') {
            dismissAttributionReview(review.id, { reason: 'dismissed-in-review' });
            pruneAttributionReviews();
            toast.info('Dismissed stale suggestion.');
        }
        nextReviewId = reviews[reviewIndex + 1]?.id || '';
    }
    refreshAttributionReviewStatus();
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

export function addCharacter(name, color, options = {}) {
    if (!name.trim()) return;
    if (isReservedCharacterIdentity(name)) {
        toast.info('Use the dedicated Narration editor instead of adding Narrator as a character.');
        return;
    }
    // Names with [COLORS:] block delimiters or control characters cannot
    // round-trip through ingest and would corrupt the prompt block.
    if (/[\r\n\t\[\]=,()]/.test(name.trim())) {
        toast.error('Character names cannot contain brackets, commas, equals signs, parentheses, or line breaks.');
        return;
    }
    // Never derive a registry key by lowercasing raw input: buildCharacterEntry keys
    // on the normalized identity, so a name needing NFKC or whitespace collapse would
    // be stored under a key that does not match its own entry.
    let key = resolveCharacterKeyByNameOrAlias(name);
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    let needsDomRepaint = false;
    if (key && characterColors[key]) {
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
            ...options,
            color,
            colorMode: 'base',
            origin: options.origin || 'manual',
            dialogueCount: 0
        });
        if (!built.entry) return;
        key = built.key;
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
    const generator = normalizeEntryGradientGenerator(entry.gradientGenerator, gradient);
    const generatorStatus = generator
        ? `<span class="dc-gradient-generator-status" title="Deterministic gradient variation ${generator.iteration}">Seeded ${generator.iteration}</span>`
        : '';
    const presetControls = `
        <div class="dc-gradient-presets dc-gradient-compact-presets">
            <label>Preset
                <select class="dc-gradient-preset-picker text_pole" data-key="${safeKey}" aria-label="Gradient preset for ${safeName}">${presetOptions}</select>
            </label>
            <button type="button" class="dc-gradient-apply-preset menu_button" data-key="${safeKey}" data-focus-id="gradient-preset-apply">Apply</button>
            <button type="button" class="dc-gradient-randomize menu_button" data-key="${safeKey}" data-focus-id="gradient-randomize" aria-label="Randomize gradient for ${safeName}">Randomize</button>
            ${generatorStatus}
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
    // Conic is the only type that uses both: the angle starts the sweep and the
    // origin is the pivot it sweeps around.
    const angleControl = `<label>${gradient.type === 'conic' ? 'Start angle' : 'Exact angle'} <input type="number" class="dc-gradient-angle text_pole" data-key="${safeKey}" min="0" max="360" step="0.1" value="${gradient.angle}" aria-label="${gradient.type === 'conic' ? 'Conic gradient start angle' : 'Exact linear gradient angle'} for ${safeName}">°</label>`;
    const originControls = `<label>Origin X <input type="number" class="dc-gradient-origin-x text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${gradient.x}" aria-label="Gradient horizontal origin for ${safeName}">%</label>
                <label>Origin Y <input type="number" class="dc-gradient-origin-y text_pole" data-key="${safeKey}" min="0" max="100" step="0.1" value="${gradient.y}" aria-label="Gradient vertical origin for ${safeName}">%</label>`;
    const geometryControls = gradient.type === 'linear'
        ? `<div class="dc-gradient-geometry dc-gradient-linear-controls">
                ${angleControl}
            </div>`
        : gradient.type === 'conic'
            ? `<div class="dc-gradient-geometry dc-gradient-conic-controls">
                ${angleControl}
                ${originControls}
            </div>`
            : `<div class="dc-gradient-geometry dc-gradient-radial-controls">
                ${originControls}
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
                        <option value="conic"${gradient.type === 'conic' ? ' selected' : ''}>Conic</option>
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
    const colorControlId = buildCharacterControlId('dc-color', k);
    const safeColor = getVisualRenderState(v, { target: 'ui' }).fallbackColor;
    const pickerColor = getBaseColor(v, safeColor);
    const gradientPresentation = getGradientPresentation(v);
    const gradientClasses = gradientPresentation ? ` ${gradientPresentation.classes}` : '';
    const gradientAttributes = gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : '';
    const rowExpanded = expandedCharacterRows.has(k);
    const rowSelected = selectedCharacterKeys.has(k);
    const styleLabel = v.style || 'Normal';
    const fontName = normalizeGoogleFontName(v.font);
    const fontFamily = getGoogleFontFamily(fontName);
    if (fontFamily) loadGoogleFont(fontName);
    const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
    const statusBadges = [
        isPersonaEntry(v) ? '<span class="dc-status-chip dc-status-chip-persona" title="Your active persona">You</span>' : '',
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
        <article class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${v.keep ? 'dc-char-kept' : ''} ${rowSelected ? 'dc-char-selected' : ''}${gradientClasses}" data-key="${safeKey}" role="listitem" aria-label="${escapeAttr(v.name)}"${gradientAttributes}>
            <div class="dc-char-main">
                <label class="checkbox_label dc-char-select-control" title="Select ${escapeAttr(v.name)} for bulk actions">
                    <input type="checkbox" class="dc-char-select" data-key="${safeKey}" data-focus-id="select" aria-label="Select ${escapeAttr(v.name)} for bulk actions"${rowSelected ? ' checked' : ''}>
                    <span class="dc-visually-hidden">Select ${escapeHtml(v.name)}</span>
                </label>
                <span class="dc-color-swatch">
                    <span class="dc-color-dot${gradientPresentation ? ' dc-gradient-surface' : ''}"${gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : ''} style="${escapeAttr(buildGradientSurfaceStyle(v))}"></span>
                    <input type="color" value="${pickerColor}" data-key="${safeKey}" class="dc-color-input" aria-label="Color for ${escapeAttr(v.name)}">
                </span>
                <div class="dc-char-name-wrap" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}${fontName ? '\nFont: ' + escapeHtml(fontName) : ''}">
                    <div class="dc-char-name${gradientPresentation ? ' dc-gradient-text' : ''}"${gradientPresentation ? ` ${gradientPresentation.dataAttributes}` : ''} style="${escapeAttr(buildGradientSurfaceStyle(v, { text: true }))}${fontStyle}">${escapeHtml(v.name)}</div>
                    <div class="dc-char-meta">
                        <span class="dc-char-count">${v.dialogueCount || 0} line${v.dialogueCount === 1 ? '' : 's'}</span>
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
                    <label class="dc-inline-label" for="${escapeAttr(colorControlId)}">Primary color</label>
                    <input id="${escapeAttr(colorControlId)}" type="text" value="${escapeAttr(pickerColor)}" data-key="${safeKey}" class="dc-color-hex text_pole" inputmode="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="7" aria-label="Hex color for ${escapeAttr(v.name)}">
                    <button type="button" class="dc-harmony menu_button" data-key="${safeKey}" data-focus-id="harmony">Harmony</button>
                </div>
                <div class="dc-inline-toolbar">
                    <button type="button" class="dc-lock menu_button ${v.locked ? 'dc-toggle-active' : ''}" data-key="${safeKey}" data-focus-id="lock" aria-pressed="${v.locked ? 'true' : 'false'}">${v.locked ? 'Locked' : 'Lock'}</button>
                    <button type="button" class="dc-swap menu_button" data-key="${safeKey}" data-focus-id="swap">Swap</button>
                    <label class="dc-compact-label">Style <select class="dc-style-select text_pole" data-key="${safeKey}" data-focus-id="style" aria-label="Dialogue style for ${escapeAttr(v.name)}"><option value=""${!v.style ? ' selected' : ''}>Normal</option><option value="bold"${v.style === 'bold' ? ' selected' : ''}>Bold</option><option value="italic"${v.style === 'italic' ? ' selected' : ''}>Italic</option><option value="bold italic"${v.style === 'bold italic' ? ' selected' : ''}>Bold italic</option></select></label>
                    <button type="button" class="dc-font menu_button" data-key="${safeKey}" data-focus-id="font">${fontName ? 'Edit Font' : 'Set Font'}</button>
                    <button type="button" class="dc-rename menu_button" data-key="${safeKey}" data-focus-id="rename">Rename</button>
                    <button type="button" class="dc-alias menu_button" data-key="${safeKey}" data-focus-id="alias">Add Alias</button>
                    <button type="button" class="dc-group menu_button" data-key="${safeKey}" data-focus-id="group">${v.group ? 'Edit Group' : 'Set Group'}</button>
                    <button type="button" class="dc-del menu_button dc-danger-button" data-key="${safeKey}" data-focus-id="delete">Delete</button>
                </div>
                ${buildGradientEditorHtml(k, v)}
            </div>` : ''}
        </article>`;
}

export function buildCharRowSignature(k, v) {
    const safeColor = getVisualRenderState(v, { target: 'ui' }).fallbackColor;
    return [
        safeColor,
        getBaseColor(v, safeColor),
        expandedCharacterRows.has(k) ? 1 : 0,
        selectedCharacterKeys.has(k) ? 1 : 0,
        v.keep ? 1 : 0,
        v.locked ? 1 : 0,
        isPersonaEntry(v) ? 1 : 0,
        v.group || '',
        v.style || '',
        normalizeGoogleFontName(v.font),
        settings.allowRemoteFonts === true ? 1 : 0,
        v.dialogueCount || 0,
        swapMode === k ? 1 : 0,
        settings.driftAllGradientColors ? 1 : 0,
        settings.colorVisionPreviewMode || 'none',
        settings.colorVisionPreviewSeverity ?? 100,
        settings.colorVisionPreviewTarget || 'all',
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
    const carries = characterColors[key].keep && getCurrentStorageScope() === 'chat';
    toast.info(characterColors[key].keep
        ? `${escapeHtml(characterColors[key].name)} will now survive Clear and bulk delete${carries ? ', and joins every chat with this character' : ''}.`
        : `${escapeHtml(characterColors[key].name)} can now be cleared or deleted normally.`);
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
    const inputId = buildCharacterControlId('dc-alias-input', key);
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Alias for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Alias name"><button type="button" class="menu_button dc-inline-submit">Add</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'alias'); };
    const submit = () => {
        const rawAlias = inp.value.trim();
        const alias = normalizeRegistryIdentityName(rawAlias);
        if (rawAlias && !alias) {
            inp.setAttribute('aria-invalid', 'true');
            toast.warning('Use an alias without reserved words, control characters, or more than 120 characters.');
            return;
        }
        if (alias) {
            if (isReservedCharacterIdentity(alias)) {
                inp.setAttribute('aria-invalid', 'true');
                toast.warning('Narrator identities are reserved for the Narration editor.');
                return;
            }
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

function handleRenameClick(renameBtn) {
    const row = renameBtn.closest('.dc-char');
    const existing = row.querySelector('.dc-inline-input');
    if (existing) { existing.remove(); return; }
    const key = renameBtn.dataset.key;
    const currentName = characterColors[key]?.name;
    if (!currentName) return;
    const inputRow = document.createElement('div');
    inputRow.className = 'dc-inline-input';
    const inputId = buildCharacterControlId('dc-rename-input', key);
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">New name for ${escapeHtml(currentName)}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" value="${escapeAttr(currentName)}"><button type="button" class="menu_button dc-inline-submit">Rename</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    inp.select();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'rename'); };
    const submit = () => {
        if (inp.value.trim() === currentName) { close(); return; }
        const nextKey = normalizeRegistryIdentity(inp.value);
        if (!renameCharacter(key, inp.value, { notify: true })) {
            inp.setAttribute('aria-invalid', 'true');
            inp.focus({ preventScroll: true });
            return;
        }
        inputRow.remove();
        focusCharacterControl(nextKey, 'rename');
    };
    inputRow.querySelector('.dc-inline-submit').onclick = submit;
    inputRow.querySelector('.dc-inline-cancel').onclick = close;
    inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') close(); };
}

function readValidatedGroupInput(input) {
    const rawValue = String(input?.value ?? '').trim();
    const group = normalizeGroupName(rawValue);
    if (rawValue && !group) {
        input?.setAttribute('aria-invalid', 'true');
        input?.focus({ preventScroll: true });
        toast.warning('Group labels must be at most 80 characters and cannot be reserved words or contain control characters.');
        return null;
    }
    input?.removeAttribute('aria-invalid');
    return group;
}

function handleFontClick(fontBtn) {
    const row = fontBtn.closest('.dc-char');
    const existing = row.querySelector('.dc-inline-input');
    if (existing) { existing.remove(); return; }
    const key = fontBtn.dataset.key;
    const current = normalizeGoogleFontName(characterColors[key]?.font);
    const inputRow = document.createElement('div');
    inputRow.className = 'dc-inline-input';
    const inputId = buildCharacterControlId('dc-font-input', key);
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Font family for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Font family name" value="${escapeAttr(current)}" aria-describedby="dc-remote-fonts-note"><button type="button" class="menu_button dc-inline-submit">Set</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
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
    const inputId = buildCharacterControlId('dc-group-input', key);
    inputRow.innerHTML = `<label class="dc-visually-hidden" for="${escapeAttr(inputId)}">Group for ${escapeHtml(characterColors[key]?.name || '')}</label><input id="${escapeAttr(inputId)}" type="text" class="text_pole" placeholder="Group name" value="${escapeAttr(current)}"><button type="button" class="menu_button dc-inline-submit">Set</button><button type="button" class="menu_button dc-inline-cancel">Cancel</button>`;
    row.appendChild(inputRow);
    const inp = inputRow.querySelector('input');
    inp.focus();
    inp.select();
    const close = () => { inputRow.remove(); focusCharacterControl(key, 'group'); };
    const submit = () => {
        const nextGroup = readValidatedGroupInput(inp);
        if (nextGroup === null) return;
        if ((characterColors[key]?.group || '') === nextGroup) { close(); return; }
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const result = setCharacterGroup([key], nextGroup);
        if (!result.changedKeys.length) { close(); return; }
        applyLiveColorChangesFromSnapshot(snapshot, result.changedKeys, { saveImmediately: true, repaintStyles: true });
        commit();
        focusCharacterControl(key, 'group');
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
    const selectedType = editor.querySelector('.dc-gradient-type')?.value;
    const type = GRADIENT_TYPES.includes(selectedType) ? selectedType : 'linear';
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

function applyGradientValue(key, gradient, { commitImmediately = false, saveImmediately = false, preserveGenerator = false, gradientGenerator = null } = {}) {
    const entry = characterColors[key];
    if (!entry) return false;
    const previousStructure = `${entry.gradient?.type || 'none'}:${entry.gradient?.stops?.length || 0}`;
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    setEntryGradient(entry, gradient, { preserveGenerator });
    if (preserveGenerator) entry.gradientGenerator = normalizeEntryGradientGenerator(gradientGenerator || entry.gradientGenerator, entry.gradient);
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

function getNarratorPreviewVisual(style = normalizeNarratorStyle(settings.narratorStyle, { legacy: settings })) {
    return getNarratorVisual({ narratorStyle: { ...style, enabled: true } }, applyThemeReadabilityAndBrightness);
}

function previewNarratorStyle(style) {
    const preview = document.getElementById('dc-narrator-preview');
    if (!preview) return;
    const visual = getNarratorPreviewVisual(style);
    setGradientPresentation(preview, visual);
    applyPreviewTypography(preview, visual);
}

function commitNarratorStyle(style) {
    const before = JSON.stringify(settings.narratorStyle);
    setNarratorStyle(settings, style, applyThemeReadabilityAndBrightness);
    if (before === JSON.stringify(settings.narratorStyle)) {
        renderNarratorEditor();
        return false;
    }
    applyLiveColorChangesFromSnapshot({}, [], { saveImmediately: true, repaintStyles: true });
    saveHistory();
    saveData({ preserveEffectiveColors: true });
    injectPrompt();
    scheduleDomRefreshSeries(0);
    scheduleCustomFontRefresh(0);
    updateLegend();
    renderNarratorEditor();
    return true;
}

function updateNarratorGradientFromControl(style, control) {
    const gradient = cloneGradient(style.gradient);
    if (!gradient) return style;
    const number = Number(control.value);
    if (control.id === 'dc-narrator-gradient-type') gradient.type = GRADIENT_TYPES.includes(control.value) ? control.value : 'linear';
    else if (control.id === 'dc-narrator-gradient-angle' && Number.isFinite(number)) gradient.angle = number;
    else if (control.id === 'dc-narrator-gradient-x' && Number.isFinite(number)) gradient.x = number;
    else if (control.id === 'dc-narrator-gradient-y' && Number.isFinite(number)) gradient.y = number;
    else if (control.id === 'dc-narrator-gradient-primary-position' && Number.isFinite(number)) gradient.primaryPosition = number;
    else if (control.id === 'dc-narrator-gradient-animation') gradient.animation.enabled = control.checked;
    else if (control.classList.contains('dc-narrator-stop-color')) {
        const stop = gradient.stops[Number(control.dataset.stopIndex)];
        if (stop) stop.baseColor = stop.color = normalizeHexColor(control.value, stop.baseColor);
    } else if (control.classList.contains('dc-narrator-stop-position') && Number.isFinite(number)) {
        const stop = gradient.stops[Number(control.dataset.stopIndex)];
        if (stop) stop.position = number;
    }
    return { ...style, gradient, gradientGenerator: null };
}

function bindNarratorEditorControls(host) {
    const currentStyle = () => normalizeNarratorStyle(settings.narratorStyle, { legacy: settings });
    host.querySelector('#dc-narrator-enabled')?.addEventListener('change', event => {
        commitNarratorStyle({ ...currentStyle(), enabled: event.target.checked });
    });
    const colorInput = host.querySelector('#dc-narrator-color');
    colorInput?.addEventListener('input', event => {
        previewNarratorStyle({ ...currentStyle(), baseColor: normalizeHexColor(event.target.value, '#888888'), gradientGenerator: null });
    });
    colorInput?.addEventListener('change', event => {
        commitNarratorStyle({ ...currentStyle(), baseColor: normalizeHexColor(event.target.value, '#888888'), gradientGenerator: null });
    });
    host.querySelector('#dc-narrator-style')?.addEventListener('change', event => {
        commitNarratorStyle({ ...currentStyle(), style: event.target.value });
    });
    host.querySelector('#dc-narrator-font')?.addEventListener('change', event => {
        commitNarratorStyle({ ...currentStyle(), font: normalizeGoogleFontName(event.target.value) });
    });
    host.querySelector('#dc-narrator-gradient-toggle')?.addEventListener('click', () => {
        const style = currentStyle();
        const entry = getNarratorPreviewVisual(style);
        commitNarratorStyle({ ...style, gradient: style.gradient ? null : createDefaultGradient(entry), gradientGenerator: null });
    });
    host.querySelector('#dc-narrator-gradient-randomize')?.addEventListener('click', () => {
        const style = currentStyle();
        const entry = getNarratorPreviewVisual(style);
        const gradient = createRandomGradient(entry);
        if (!gradient) return;
        commitNarratorStyle({ ...style, gradient, gradientGenerator: entry.gradientGenerator });
        const seedInput = document.getElementById('dc-gradient-master-seed');
        if (seedInput) seedInput.value = settings.gradientRandomMasterSeed;
    });
    host.querySelector('#dc-narrator-gradient-apply-preset')?.addEventListener('click', () => {
        const preset = resolveGradientPreset(host.querySelector('#dc-narrator-gradient-preset')?.value || '');
        if (!preset) { toast.warning('Select a gradient preset first'); return; }
        const style = currentStyle();
        const entry = getNarratorPreviewVisual(style);
        if (!applyGradientPreset(entry, preset)) { toast.error('Gradient preset is invalid'); return; }
        commitNarratorStyle({ ...style, baseColor: entry.baseColor, gradient: entry.gradient, gradientGenerator: null });
    });
    host.querySelector('#dc-narrator-gradient-add-stop')?.addEventListener('click', () => {
        const style = currentStyle();
        const gradient = cloneGradient(style.gradient);
        if (!gradient || gradient.stops.length + 1 >= MAX_GRADIENT_STOPS) return;
        const baseColor = normalizeHexColor(getNextColor(), style.baseColor);
        gradient.stops.push({ baseColor, color: baseColor, position: getNewGradientStopPosition(gradient) });
        commitNarratorStyle({ ...style, gradient, gradientGenerator: null });
    });
    host.querySelectorAll('.dc-narrator-gradient-remove-stop').forEach(button => {
        button.addEventListener('click', () => {
            const style = currentStyle();
            const gradient = cloneGradient(style.gradient);
            const index = Number(button.dataset.stopIndex);
            if (!gradient || gradient.stops.length <= 1 || !Number.isInteger(index)) return;
            gradient.stops.splice(index, 1);
            commitNarratorStyle({ ...style, gradient, gradientGenerator: null });
        });
    });
    const gradientControls = host.querySelectorAll('#dc-narrator-gradient-type, #dc-narrator-gradient-angle, #dc-narrator-gradient-x, #dc-narrator-gradient-y, #dc-narrator-gradient-primary-position, #dc-narrator-gradient-animation, .dc-narrator-stop-color, .dc-narrator-stop-position');
    gradientControls.forEach(control => {
        if (control.type === 'color' || control.type === 'number') {
            control.addEventListener('input', () => previewNarratorStyle(updateNarratorGradientFromControl(currentStyle(), control)));
        }
        control.addEventListener('change', () => commitNarratorStyle(updateNarratorGradientFromControl(currentStyle(), control)));
    });
}

// An element only holds a scroll position if its overflow actually scrolls;
// scrollHeight alone is true of plenty of `overflow: visible` boxes.
function isScrollableElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const style = getComputedStyle(element);
    const scrollsY = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const scrollsX = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    return scrollsY || scrollsX;
}

export function findScrollableAncestor(element) {
    let current = element?.parentElement;
    while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        // Test the declared overflow, not the current size: the container that
        // will scroll once our panel expands does not scroll yet.
        if (/(auto|scroll|overlay)/.test(style.overflowY)) return current;
        current = current.parentElement;
    }
    return null;
}

function captureScrollPositions(container) {
    const positions = [];
    let current = container;
    // The panel used to be its own scroller, so stopping at it was enough.
    // It now flows at natural height inside the host's scroller, and that
    // outer element is the one a list re-render actually disturbs, so the
    // walk has to reach it or nothing gets restored at all.
    while (current && current !== document.documentElement) {
        if (isScrollableElement(current)) {
            positions.push({ element: current, top: current.scrollTop, left: current.scrollLeft });
            // Stop at the first scroller outside the panel: that is the host's
            // own, and nothing above it is ours to restore.
            if (!current.closest('#dc-ext')) break;
        }
        current = current.parentElement;
    }
    return positions;
}

function restoreScrollPositions(positions) {
    if (!positions || !positions.length) return;
    for (const pos of positions) {
        if (pos.element && pos.element.isConnected) {
            pos.element.scrollTop = pos.top;
            pos.element.scrollLeft = pos.left;
        }
    }
}

function renderNarratorEditor() {
    const host = document.getElementById('dc-narrator-editor');
    if (!host) return;
    const scrollPositions = captureScrollPositions(host);
    const style = normalizeNarratorStyle(settings.narratorStyle, { legacy: settings });
    const visual = getNarratorPreviewVisual(style);
    const gradient = normalizeGradient(style.gradient);
    const disabled = style.enabled ? '' : ' disabled';
    const generator = normalizeEntryGradientGenerator(style.gradientGenerator, gradient);
    const generatorStatus = generator ? `Seeded variation ${generator.iteration}` : 'Manual gradient';
    const fontName = normalizeGoogleFontName(style.font);
    const narratorAngle = gradient ? `<label>${gradient.type === 'conic' ? 'Start angle' : 'Angle'} <input id="dc-narrator-gradient-angle" type="number" class="text_pole" min="0" max="360" step="0.1" value="${gradient.angle}"${disabled}>°</label>` : '';
    const narratorOrigin = gradient ? `<label>Origin X <input id="dc-narrator-gradient-x" type="number" class="text_pole" min="0" max="100" step="0.1" value="${gradient.x}"${disabled}>%</label><label>Origin Y <input id="dc-narrator-gradient-y" type="number" class="text_pole" min="0" max="100" step="0.1" value="${gradient.y}"${disabled}>%</label>` : '';
    const geometry = gradient?.type === 'radial'
        ? narratorOrigin
        : gradient?.type === 'conic'
            ? `${narratorAngle}${narratorOrigin}`
            : narratorAngle;
    const stopRows = gradient ? gradient.stops.map((stop, index) => `<div class="dc-narrator-stop"><label>Stop ${index + 2} <input type="color" class="dc-narrator-stop-color" data-stop-index="${index}" value="${stop.baseColor}"${disabled}></label><label>Position <input type="number" class="dc-narrator-stop-position text_pole" data-stop-index="${index}" min="0" max="100" step="0.1" value="${stop.position}"${disabled}>%</label><button type="button" class="dc-narrator-gradient-remove-stop menu_button dc-danger-button" data-stop-index="${index}"${disabled}${gradient.stops.length === 1 ? ' disabled' : ''}>Remove</button></div>`).join('') : '';
    host.innerHTML = `
        <label class="checkbox_label dc-narrator-enable"><input type="checkbox" id="dc-narrator-enabled"${style.enabled ? ' checked' : ''}><span>Color narration</span></label>
        <div class="dc-narrator-compact">
            <label>Primary <input type="color" id="dc-narrator-color" value="${style.baseColor}"${disabled}></label>
            <label>Style <select id="dc-narrator-style" class="text_pole"${disabled}><option value=""${!style.style ? ' selected' : ''}>Normal</option><option value="bold"${style.style === 'bold' ? ' selected' : ''}>Bold</option><option value="italic"${style.style === 'italic' ? ' selected' : ''}>Italic</option><option value="bold italic"${style.style === 'bold italic' ? ' selected' : ''}>Bold italic</option></select></label>
            <label>Font <input type="text" id="dc-narrator-font" class="text_pole" maxlength="80" value="${escapeAttr(fontName)}" placeholder="Font family" aria-describedby="dc-remote-fonts-note"${disabled}></label>
            <button type="button" id="dc-narrator-gradient-toggle" class="menu_button${gradient ? ' dc-danger-button' : ''}"${disabled}>${gradient ? 'Remove gradient' : 'Enable gradient'}</button>
            <button type="button" id="dc-narrator-gradient-randomize" class="menu_button"${disabled}>Randomize</button>
            <label>Preset <select id="dc-narrator-gradient-preset" class="text_pole"${disabled}>${buildGradientPresetOptionsHtml()}</select></label>
            <button type="button" id="dc-narrator-gradient-apply-preset" class="menu_button"${disabled}>Apply</button>
            <div id="dc-narrator-preview" class="dc-narrator-preview${gradient ? ' dc-gradient-surface' : ''}" role="img" aria-label="Narration visual preview" style="${escapeAttr(buildGradientSurfaceStyle(visual))}"></div>
        </div>
        ${gradient ? `<div class="dc-narrator-gradient-controls"><label>Type <select id="dc-narrator-gradient-type" class="text_pole"${disabled}><option value="linear"${gradient.type === 'linear' ? ' selected' : ''}>Linear</option><option value="radial"${gradient.type === 'radial' ? ' selected' : ''}>Radial</option><option value="conic"${gradient.type === 'conic' ? ' selected' : ''}>Conic</option></select></label>${geometry}<label>Primary position <input id="dc-narrator-gradient-primary-position" type="number" class="text_pole" min="0" max="100" step="0.1" value="${gradient.primaryPosition}"${disabled}>%</label><label class="checkbox_label"><input type="checkbox" id="dc-narrator-gradient-animation"${gradient.animation.enabled ? ' checked' : ''}${disabled}><span>Drift colors</span></label><span class="dc-gradient-generator-status">${escapeHtml(generatorStatus)}</span></div><div class="dc-narrator-stops">${stopRows}<button type="button" id="dc-narrator-gradient-add-stop" class="menu_button"${disabled}${gradient.stops.length + 1 >= MAX_GRADIENT_STOPS ? ' disabled' : ''}>Add stop (${gradient.stops.length + 1}/${MAX_GRADIENT_STOPS})</button></div>` : ''}`;
    setGradientPresentation(host.querySelector('#dc-narrator-preview'), visual);
    applyPreviewTypography(host.querySelector('#dc-narrator-preview'), visual);
    host.dataset.narratorSignature = JSON.stringify(style);
    bindNarratorEditorControls(host);
    restoreScrollPositions(scrollPositions);
    requestAnimationFrame(() => restoreScrollPositions(scrollPositions));
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
    const gradientGenerator = normalizeEntryGradientGenerator(entry.gradientGenerator, gradient);
    applyGradientValue(key, gradient, { commitImmediately: true, saveImmediately: true, preserveGenerator: true, gradientGenerator });
    const masterSeedInput = document.getElementById('dc-gradient-master-seed');
    if (masterSeedInput) masterSeedInput.value = settings.gradientRandomMasterSeed;
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
    renderGradientPresetGallery(preferredCustomName ? `custom:${preferredCustomName}` : '');
    renderNarratorEditor();
}

function getReadableGradientPresetPreview(preset) {
    const preview = {};
    if (!applyGradientPreset(preview, preset)) return preset;
    return { baseColor: preview.baseColor, color: preview.color, gradient: preview.gradient };
}

function getGradientPresetCatalog() {
    const builtIns = Object.entries(BUILTIN_GRADIENT_PRESETS).map(([name, preset]) => ({
        id: `builtin:${name}`,
        name: formatGradientPresetName(name),
        source: 'builtin',
        preset: getReadableGradientPresetPreview(preset),
    }));
    const customs = Object.entries(getCustomGradientPresets())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([name, preset]) => ({ id: `custom:${name}`, name, source: 'custom', preset: getReadableGradientPresetPreview(preset) }));
    return [...builtIns, ...customs];
}

function describeGradientGeometry(gradient) {
    if (gradient.type === 'radial') return `Radial at ${gradient.x}%, ${gradient.y}%`;
    // Conic is defined by both numbers, so naming only one of them would
    // describe a different gradient than the one being previewed.
    if (gradient.type === 'conic') return `Conic from ${gradient.angle} degrees at ${gradient.x}%, ${gradient.y}%`;
    return `Linear ${gradient.angle} degrees`;
}

function formatGradientMotion(preset) {
    const animation = preset.gradient.animation;
    if (!animation.enabled && settings.driftAllGradientColors) return 'Static preset; global drift active';
    return animation.enabled
        ? `${animation.duration}s ${animation.reverse ? 'reverse drift' : 'drift'}`
        : 'Static';
}

function getGradientGalleryTargets() {
    return Object.entries(characterColors)
        .sort((left, right) => left[1].name.localeCompare(right[1].name))
        .slice(0, DIALOG_LIST_RENDER_LIMIT);
}

function focusGradientGalleryControl(focusId) {
    requestAnimationFrame(() => document.querySelector(`#dc-gradient-gallery [data-gallery-focus="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true }));
}

export function renderGradientPresetGallery(preferredPreset = '', focusId = '') {
    const host = document.getElementById('dc-gradient-gallery');
    if (!host) return;
    const catalog = getGradientPresetCatalog();
    if (preferredPreset && catalog.some(item => item.id === preferredPreset)) selectedGradientGalleryPreset = preferredPreset;
    if (!catalog.some(item => item.id === selectedGradientGalleryPreset)) selectedGradientGalleryPreset = catalog[0]?.id || '';
    const query = gradientGallerySearch.trim().toLowerCase();
    const visible = catalog.filter(item => (gradientGalleryFilter === 'all' || item.source === gradientGalleryFilter)
        && (!query || item.name.toLowerCase().includes(query)));
    const selectedIsVisible = visible.some(item => item.id === selectedGradientGalleryPreset);
    const selected = catalog.find(item => item.id === selectedGradientGalleryPreset) || null;
    const selectedGradient = selected?.preset?.gradient;
    const selectedPresentation = selected ? getGradientPresentation(selected.preset, {
        target: 'ui',
        allowAnimation: gradientGalleryMotionActive,
    }) : null;
    const selectedClasses = selectedPresentation ? ` dc-gradient-surface ${selectedPresentation.classes}` : '';
    const targetOptions = getGradientGalleryTargets().map(([key, entry]) =>
        `<option value="character:${escapeAttr(key)}">${escapeHtml(entry.name)}</option>`).join('');
    const selectedCount = getSelectedCharacterKeys().length;
    host.innerHTML = `
        <div class="dc-gradient-gallery-tools">
            <label class="dc-visually-hidden" for="dc-gradient-gallery-search">Search gradient presets</label>
            <input type="search" id="dc-gradient-gallery-search" class="text_pole" data-gallery-focus="search" value="${escapeAttr(gradientGallerySearch)}" placeholder="Search gradients">
            <label class="dc-visually-hidden" for="dc-gradient-gallery-filter">Gradient preset source</label>
            <select id="dc-gradient-gallery-filter" class="text_pole" data-gallery-focus="filter"><option value="all"${gradientGalleryFilter === 'all' ? ' selected' : ''}>All presets</option><option value="builtin"${gradientGalleryFilter === 'builtin' ? ' selected' : ''}>Built-in</option><option value="custom"${gradientGalleryFilter === 'custom' ? ' selected' : ''}>Custom</option></select>
        </div>
        <div class="dc-gradient-gallery-list" role="listbox" aria-label="Gradient presets">
            ${visible.length ? visible.map((item, index) => {
                const gradient = item.preset.gradient;
                const itemSelected = item.id === selectedGradientGalleryPreset;
                return `<button type="button" class="dc-gradient-gallery-item${itemSelected ? ' dc-gradient-gallery-item-selected' : ''}" role="option" aria-selected="${itemSelected}" tabindex="${itemSelected || (!selectedIsVisible && index === 0) ? '0' : '-1'}" data-gradient-gallery-preset="${escapeAttr(item.id)}" data-gallery-focus="preset:${escapeAttr(item.id)}"><span class="dc-gradient-gallery-sample dc-gradient-surface" aria-hidden="true" style="${escapeAttr(buildGradientSurfaceStyle(item.preset, { allowAnimation: false }))}"></span><span><strong>${escapeHtml(item.name)}</strong><small>${item.source === 'builtin' ? 'Built-in' : 'Custom'} · ${gradient.stops.length + 1} stops · ${escapeHtml(formatGradientMotion(item.preset))}</small></span></button>`;
            }).join('') : '<p class="dc-empty-state">No matching gradient presets.</p>'}
        </div>
        ${selected ? `<div class="dc-gradient-gallery-preview">
            <div class="dc-gradient-gallery-preview-sample${selectedClasses}" role="img" aria-label="${escapeAttr(selected.name)} preview in the current color-vision preview" style="${escapeAttr(buildGradientSurfaceStyle(selected.preset, { allowAnimation: gradientGalleryMotionActive }))}"></div>
            <div class="dc-gradient-gallery-details"><strong>${escapeHtml(selected.name)}</strong><span>${describeGradientGeometry(selectedGradient)} · ${selectedGradient.stops.length + 1} stops · ${escapeHtml(formatGradientMotion(selected.preset))}</span></div>
            <button type="button" id="dc-gradient-gallery-motion" class="menu_button" data-gallery-focus="motion" aria-pressed="${gradientGalleryMotionActive}"${selectedGradient.animation.enabled || settings.driftAllGradientColors ? '' : ' disabled'}>${gradientGalleryMotionActive ? 'Pause preview' : 'Play motion'}</button>
        </div>
        <div class="dc-gradient-gallery-apply">
            <label for="dc-gradient-gallery-target">Apply to</label><select id="dc-gradient-gallery-target" class="text_pole"><option value="selected">Selected rows (${selectedCount})</option>${targetOptions}</select>
            <button type="button" id="dc-gradient-gallery-apply" class="menu_button dc-primary-button" data-gallery-focus="apply">Apply colors and gradient</button>
        </div>
        ${selected.source === 'custom' ? `<div class="dc-gradient-gallery-custom"><label class="dc-visually-hidden" for="dc-gradient-gallery-rename">New custom preset name</label><input type="text" id="dc-gradient-gallery-rename" class="text_pole" maxlength="80" value="${escapeAttr(selected.name)}"><button type="button" id="dc-gradient-gallery-rename-button" class="menu_button" data-gallery-focus="rename">Rename</button><button type="button" id="dc-gradient-gallery-delete" class="menu_button dc-danger-button" data-gallery-focus="delete">Delete</button></div>` : ''}` : '<p class="dc-empty-state">No gradient presets available.</p>'}`;

    const searchInput = host.querySelector('#dc-gradient-gallery-search');
    searchInput?.addEventListener('input', event => {
        gradientGallerySearch = event.target.value;
        renderGradientPresetGallery('', 'search');
        const nextSearch = document.getElementById('dc-gradient-gallery-search');
        nextSearch?.focus({ preventScroll: true });
        nextSearch?.setSelectionRange(gradientGallerySearch.length, gradientGallerySearch.length);
    });
    host.querySelector('#dc-gradient-gallery-filter')?.addEventListener('change', event => {
        gradientGalleryFilter = event.target.value;
        renderGradientPresetGallery('', 'filter');
    });
    host.querySelectorAll('[data-gradient-gallery-preset]').forEach(button => {
        button.addEventListener('click', () => {
            selectedGradientGalleryPreset = button.dataset.gradientGalleryPreset;
            gradientGalleryMotionActive = false;
            renderGradientPresetGallery(selectedGradientGalleryPreset, `preset:${selectedGradientGalleryPreset}`);
        });
        button.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const options = [...host.querySelectorAll('[data-gradient-gallery-preset]')];
            const currentIndex = options.indexOf(button);
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? options.length - 1
                    : event.key === 'ArrowDown' ? Math.min(options.length - 1, currentIndex + 1)
                        : Math.max(0, currentIndex - 1);
            options[nextIndex]?.click();
        });
    });
    host.querySelector('#dc-gradient-gallery-motion')?.addEventListener('click', () => {
        gradientGalleryMotionActive = !gradientGalleryMotionActive;
        renderGradientPresetGallery('', 'motion');
    });
    host.querySelector('#dc-gradient-gallery-apply')?.addEventListener('click', applyGradientGalleryPreset);
    host.querySelector('#dc-gradient-gallery-rename-button')?.addEventListener('click', renameGradientGalleryPreset);
    host.querySelector('#dc-gradient-gallery-delete')?.addEventListener('click', deleteGradientGalleryPreset);
    registerGradientAnimationRoot(document.getElementById('dc-ext'));
    refreshGradientAnimationState();
    if (focusId) focusGradientGalleryControl(focusId);
}

function applyGradientGalleryPreset() {
    const preset = resolveGradientPreset(selectedGradientGalleryPreset);
    if (!preset) { toast.warning('Choose a gradient preset.'); return; }
    const target = document.getElementById('dc-gradient-gallery-target')?.value || 'selected';
    const keys = target === 'selected'
        ? getSelectedCharacterKeys()
        : [target.startsWith('character:') ? target.slice(10) : ''].filter(key => characterColors[key]);
    if (!keys.length) { toast.info('Select rows or choose a character target.'); return; }
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const changedKeys = [];
    keys.forEach(key => {
        const entry = characterColors[key];
        if (!entry) return;
        const before = JSON.stringify([entry.baseColor, entry.color, entry.gradient, entry.gradientGenerator]);
        if (!applyGradientPreset(entry, preset)) return;
        if (before !== JSON.stringify([entry.baseColor, entry.color, entry.gradient, entry.gradientGenerator])) changedKeys.push(key);
    });
    if (!changedKeys.length) { toast.info('The target already uses those colors and gradient.'); return; }
    applyLiveColorChangesFromSnapshot(snapshot, changedKeys, { saveImmediately: true, repaintStyles: true });
    commit();
    repaintDomAfterCharacterDataChange(0);
    renderGradientPresetGallery('', 'apply');
    toast.success(`Applied colors and gradient to ${changedKeys.length} character${changedKeys.length === 1 ? '' : 's'}.`);
}

function renameGradientGalleryPreset() {
    if (!selectedGradientGalleryPreset.startsWith('custom:')) return;
    const currentName = selectedGradientGalleryPreset.slice(7);
    const nextName = normalizeGradientPresetName(document.getElementById('dc-gradient-gallery-rename')?.value);
    if (!nextName) { toast.warning('Enter a preset name.'); return; }
    if (!renameCustomGradientPreset(currentName, nextName, { immediate: true })) {
        toast.warning('That preset could not be renamed. The new name may already exist.');
        return;
    }
    selectedGradientGalleryPreset = `custom:${nextName}`;
    refreshGradientPresetControls(nextName);
    focusGradientGalleryControl('rename');
    toast.success(`Gradient preset renamed to "${escapeHtml(nextName)}"`);
}

async function deleteGradientGalleryPreset(event) {
    if (!selectedGradientGalleryPreset.startsWith('custom:')) return;
    const name = selectedGradientGalleryPreset.slice(7);
    const binding = captureUiMutationContext();
    const reviewedPreset = JSON.stringify(getCustomGradientPresets()[name] ?? null);
    if (!await confirmReviewedAction({
        title: 'Delete gradient preset?',
        description: `“${name}” will be removed. Characters already using it are not changed.`,
        confirmLabel: 'Delete preset',
        danger: true,
        opener: event.currentTarget,
    })) return;
    if (!isUiMutationContextCurrent(binding)
        || selectedGradientGalleryPreset !== `custom:${name}`
        || JSON.stringify(getCustomGradientPresets()[name] ?? null) !== reviewedPreset) {
        return notifyUiContextChanged('The active target or gradient preset changed. Review the deletion again.');
    }
    const catalog = getGradientPresetCatalog();
    const currentIndex = catalog.findIndex(item => item.id === selectedGradientGalleryPreset);
    if (!deleteCustomGradientPreset(name, { immediate: true })) { toast.error('Could not delete gradient preset'); return; }
    const nextCatalog = getGradientPresetCatalog();
    selectedGradientGalleryPreset = nextCatalog[Math.min(currentIndex, nextCatalog.length - 1)]?.id || '';
    refreshGradientPresetControls();
    focusGradientGalleryControl(selectedGradientGalleryPreset ? `preset:${selectedGradientGalleryPreset}` : 'search');
    toast.success(`Gradient preset "${escapeHtml(name)}" deleted`);
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
    const binding = captureUiMutationContext();
    const reviewedEntry = entry;
    const reviewedGradient = getGradientSignature(entry);
    const reviewedPreset = JSON.stringify(getCustomGradientPresets()[name] ?? null);
    if (overwrite && !await confirmReviewedAction({
        title: 'Replace gradient preset?',
        description: `“${name}” already exists. Its saved gradient will be replaced.`,
        confirmLabel: 'Replace preset',
        danger: true,
        opener: button,
    })) return;
    if (overwrite && (!isUiMutationContextCurrent(binding)
        || getGradientEditorContext(button).entry !== reviewedEntry
        || getGradientSignature(reviewedEntry) !== reviewedGradient
        || normalizeGradientPresetName(nameInput?.value) !== name
        || JSON.stringify(getCustomGradientPresets()[name] ?? null) !== reviewedPreset)) {
        return notifyUiContextChanged('The active target or saved preset changed. Review the replacement again.');
    }
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
    const binding = captureUiMutationContext();
    const reviewedPreset = JSON.stringify(getCustomGradientPresets()[name] ?? null);
    if (!await confirmReviewedAction({
        title: 'Delete gradient preset?',
        description: `“${name}” will be removed. Characters already using it are not changed.`,
        confirmLabel: 'Delete preset',
        danger: true,
        opener: button,
    })) return;
    if (!isUiMutationContextCurrent(binding)
        || editor?.querySelector('.dc-gradient-custom-preset')?.value !== `custom:${name}`
        || JSON.stringify(getCustomGradientPresets()[name] ?? null) !== reviewedPreset) {
        return notifyUiContextChanged('The active target or gradient preset changed. Review the deletion again.');
    }
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
    const renameBtn = t.closest('.dc-rename');
    if (renameBtn) { handleRenameClick(renameBtn); return; }
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
        if (t.classList.contains('dc-char-select')) {
            setCharacterSelected(t.dataset.key, t.checked);
            t.closest('.dc-char')?.classList.toggle('dc-char-selected', t.checked);
            updateBulkToolbar(getVisibleCharacterEntries());
        } else if (t.classList.contains('dc-gradient-type')) {
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
function getGroupProfileFieldMask() {
    return (document.getElementById('dc-group-profile-primary')?.checked ? CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR : 0)
        | (document.getElementById('dc-group-profile-gradient')?.checked ? CHARACTER_STYLE_FIELD_MASKS.GRADIENT : 0)
        | (document.getElementById('dc-group-profile-font')?.checked ? CHARACTER_STYLE_FIELD_MASKS.FONT : 0)
        | (document.getElementById('dc-group-profile-text')?.checked ? CHARACTER_STYLE_FIELD_MASKS.STYLE : 0);
}

function getGroupProfileEditorName() {
    return normalizeGroupName(document.getElementById('dc-group-profile-name')?.value);
}

function setGroupProfileAutomationControls(profile) {
    for (const key of GROUP_PROFILE_AUTOMATION_KEYS) {
        const control = document.getElementById(`dc-group-profile-${key}`);
        if (!control) continue;
        const value = profile?.automation?.[key];
        control.value = value === true ? 'true' : value === false ? 'false' : 'null';
    }
}

function syncGroupProfileEditor() {
    const profile = getGroupProfile(groupProfiles, getGroupProfileEditorName());
    const fields = profile?.style?.fields ?? DEFAULT_CHARACTER_STYLE_FIELD_MASK;
    const fieldControls = [
        ['dc-group-profile-primary', CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR],
        ['dc-group-profile-gradient', CHARACTER_STYLE_FIELD_MASKS.GRADIENT],
        ['dc-group-profile-font', CHARACTER_STYLE_FIELD_MASKS.FONT],
        ['dc-group-profile-text', CHARACTER_STYLE_FIELD_MASKS.STYLE],
    ];
    fieldControls.forEach(([id, field]) => {
        const control = document.getElementById(id);
        if (control) control.checked = !!(fields & field);
    });
    setGroupProfileAutomationControls(profile);
    const source = document.getElementById('dc-group-profile-source');
    if (source) source.value = '';
    const renameInput = document.getElementById('dc-group-profile-rename');
    if (renameInput) renameInput.value = '';
    refreshGroupProfileControls();
}

export function refreshGroupProfileControls() {
    const nameInput = document.getElementById('dc-group-profile-name');
    const datalist = document.getElementById('dc-group-profile-labels');
    const sourceSelect = document.getElementById('dc-group-profile-source');
    if (!nameInput || !datalist || !sourceSelect) return;

    const labels = new Map();
    Object.values(groupProfiles).forEach(profile => labels.set(normalizeGroupKey(profile.name), profile.name));
    Object.values(characterColors).forEach(entry => {
        const name = normalizeGroupName(entry?.group);
        if (name && !labels.has(normalizeGroupKey(name))) labels.set(normalizeGroupKey(name), name);
    });
    const visibleGroupNames = [...labels.values()]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, DIALOG_LIST_RENDER_LIMIT);
    datalist.innerHTML = visibleGroupNames
        .map(name => `<option value="${escapeAttr(name)}"></option>`)
        .join('');

    const bulkGroupSelect = document.getElementById('dc-bulk-group-select');
    if (bulkGroupSelect) {
        const previousBulkGroup = bulkGroupSelect.value;
        bulkGroupSelect.innerHTML = '<option value="">Group selected…</option>' + visibleGroupNames
            .map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
            .join('');
        if (previousBulkGroup && labels.has(normalizeGroupKey(previousBulkGroup))) {
            bulkGroupSelect.value = previousBulkGroup;
        }
    }

    const previousSource = sourceSelect.value;
    const visibleSources = Object.entries(characterColors)
        .sort((left, right) => left[1].name.localeCompare(right[1].name))
        .slice(0, DIALOG_LIST_RENDER_LIMIT);
    if (previousSource && characterColors[previousSource] && !visibleSources.some(([key]) => key === previousSource)) {
        visibleSources.push([previousSource, characterColors[previousSource]]);
    }
    sourceSelect.innerHTML = '<option value="">Keep saved style</option>' + visibleSources
        .map(([key, entry]) => `<option value="${escapeAttr(key)}">${escapeHtml(entry.name)}</option>`)
        .join('');
    if (previousSource && characterColors[previousSource]) sourceSelect.value = previousSource;

    const name = getGroupProfileEditorName();
    const profile = getGroupProfile(groupProfiles, name);
    const targetCount = getCharacterKeysForGroup(name).length;
    const status = document.getElementById('dc-group-profile-status');
    const saveButton = document.getElementById('dc-group-profile-save');
    const applyButton = document.getElementById('dc-group-profile-apply');
    const renameButton = document.getElementById('dc-group-profile-rename-button');
    const deleteButton = document.getElementById('dc-group-profile-delete');
    if (status) status.textContent = profile
        ? `Saved profile; ${targetCount} current group member${targetCount === 1 ? '' : 's'}.`
        : name ? `No saved profile; ${targetCount} current group member${targetCount === 1 ? '' : 's'}.` : 'Choose or enter a group label.';
    if (saveButton) saveButton.textContent = profile ? 'Save profile' : 'Create profile';
    if (applyButton) {
        applyButton.textContent = `Apply to existing (${targetCount})`;
        applyButton.disabled = !profile || targetCount === 0;
    }
    if (renameButton) renameButton.disabled = !profile;
    if (deleteButton) deleteButton.disabled = !profile;
}

function saveGroupProfileFromEditor() {
    const nameInput = document.getElementById('dc-group-profile-name');
    const name = readValidatedGroupInput(nameInput);
    if (name === null) return;
    if (!name) { toast.warning('Enter a group label.'); return; }
    const existing = getGroupProfile(groupProfiles, name);
    const sourceKey = document.getElementById('dc-group-profile-source')?.value || '';
    const source = characterColors[sourceKey];
    if (!source && !existing) {
        toast.warning('Choose a character whose current style should be saved.');
        return;
    }
    const fields = getGroupProfileFieldMask();
    const style = captureCharacterStyle(source || existing.style, fields);
    const automation = {};
    for (const key of GROUP_PROFILE_AUTOMATION_KEYS) {
        const value = document.getElementById(`dc-group-profile-${key}`)?.value;
        automation[key] = value === 'true' ? true : value === 'false' ? false : null;
    }
    setGroupProfiles(setGroupProfile(groupProfiles, name, { name, style, automation }));
    saveHistory();
    saveData();
    refreshGroupProfileControls();
    toast.success(`Group profile "${escapeHtml(name)}" saved.`);
}

function renameGroupProfileFromEditor() {
    const currentName = getGroupProfileEditorName();
    const nextName = readValidatedGroupInput(document.getElementById('dc-group-profile-rename'));
    if (nextName === null) return;
    if (!currentName || !nextName) { toast.warning('Choose a profile and enter its new group label.'); return; }
    const renamed = renameGroupProfile(groupProfiles, currentName, nextName);
    if (!renamed) { toast.warning('That profile cannot be renamed. The destination may already exist.'); return; }
    setGroupProfiles(renamed);
    saveHistory();
    saveData();
    document.getElementById('dc-group-profile-name').value = nextName;
    syncGroupProfileEditor();
    toast.success(`Group profile renamed to "${escapeHtml(nextName)}".`);
}

async function deleteGroupProfileFromEditor(opener) {
    const name = getGroupProfileEditorName();
    const profile = getGroupProfile(groupProfiles, name);
    if (!profile) { toast.info('Choose a saved group profile.'); return; }
    const binding = captureUiMutationContext();
    const reviewedProfile = JSON.stringify(profile);
    if (!await confirmReviewedAction({
        title: 'Delete group profile?',
        description: `“${profile.name}” will be removed. Existing character styles and group labels will not change.`,
        confirmLabel: 'Delete profile',
        danger: true,
        opener,
    })) return;
    if (!isUiMutationContextCurrent(binding)
        || getGroupProfileEditorName() !== name
        || JSON.stringify(getGroupProfile(groupProfiles, name) ?? null) !== reviewedProfile) {
        return notifyUiContextChanged('The active target or group profile changed. Review the deletion again.');
    }
    setGroupProfiles(deleteGroupProfile(groupProfiles, name));
    saveHistory();
    saveData();
    syncGroupProfileEditor();
    document.getElementById('dc-group-profile-name')?.focus({ preventScroll: true });
    toast.success(`Group profile "${escapeHtml(profile.name)}" deleted.`);
}

async function applyGroupProfileToExisting(opener) {
    const name = getGroupProfileEditorName();
    const profile = getGroupProfile(groupProfiles, name);
    const keys = getCharacterKeysForGroup(name);
    if (!profile || !keys.length) { toast.info('This saved profile has no current group members.'); return; }
    const binding = captureUiMutationContext();
    const reviewedProfile = JSON.stringify(profile);
    const reviewedMembers = JSON.stringify(keys.map(key => [key, characterColors[key]?.group ?? '']));
    const confirmed = await confirmReviewedAction({
        title: `Apply profile to ${keys.length} character${keys.length === 1 ? '' : 's'}?`,
        description: `The selected fields from “${profile.name}” will be copied into every current member of that group. Later profile edits will not alter them.`,
        detailsHtml: `<p class="dc-review-names">${keys.slice(0, 12).map(key => escapeHtml(characterColors[key].name)).join(', ')}${keys.length > 12 ? `, and ${keys.length - 12} more` : ''}</p>`,
        confirmLabel: 'Apply profile',
        opener,
    });
    if (!confirmed) return;
    const currentKeys = getCharacterKeysForGroup(name);
    if (!isUiMutationContextCurrent(binding)
        || JSON.stringify(getGroupProfile(groupProfiles, name) ?? null) !== reviewedProfile
        || JSON.stringify(currentKeys.map(key => [key, characterColors[key]?.group ?? ''])) !== reviewedMembers) {
        return notifyUiContextChanged('The active target, group profile, or reviewed members changed. Review the action again.');
    }
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const result = applyGroupProfileToKeys(keys, profile);
    if (!result.changedKeys.length) { toast.info('All group members already match the saved fields.'); return; }
    applyLiveColorChangesFromSnapshot(snapshot, result.changedKeys, { saveImmediately: true, repaintStyles: true });
    commit();
    toast.success(`Applied the profile to ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`);
}

function getBulkStyleFieldMask() {
    const primary = document.getElementById('dc-bulk-style-primary');
    const gradient = document.getElementById('dc-bulk-style-gradient');
    const font = document.getElementById('dc-bulk-style-font');
    const textStyle = document.getElementById('dc-bulk-style-text');
    if (!primary && !gradient && !font && !textStyle) return DEFAULT_CHARACTER_STYLE_FIELD_MASK;
    return (primary?.checked ? CHARACTER_STYLE_FIELD_MASKS.BASE_COLOR : 0)
        | (gradient?.checked ? CHARACTER_STYLE_FIELD_MASKS.GRADIENT : 0)
        | (font?.checked ? CHARACTER_STYLE_FIELD_MASKS.FONT : 0)
        | (textStyle?.checked ? CHARACTER_STYLE_FIELD_MASKS.STYLE : 0);
}

function updateBulkToolbar(visibleEntries = getVisibleCharacterEntries()) {
    const toolbar = document.getElementById('dc-bulk-toolbar');
    if (!toolbar) return;
    const selectedKeys = getSelectedCharacterKeys();
    const visibleKeys = visibleEntries.map(([key]) => key);
    const visibleSet = new Set(visibleKeys);
    const hiddenCount = selectedKeys.filter(key => !visibleSet.has(key)).length;
    const selectionCount = toolbar.querySelector('#dc-selection-count');
    const selectVisible = toolbar.querySelector('#dc-select-visible');
    const clearSelection = toolbar.querySelector('#dc-clear-selection');
    const clipboardStatus = toolbar.querySelector('#dc-style-clipboard-status');
    const clipboard = getCharacterStyleClipboard();
    toolbar.hidden = Object.keys(characterColors).length === 0;
    if (selectionCount) selectionCount.textContent = `${selectedKeys.length} selected${hiddenCount ? ` (${hiddenCount} hidden)` : ''}`;
    if (selectVisible) {
        selectVisible.disabled = visibleKeys.length === 0;
        selectVisible.textContent = `Select visible (${visibleKeys.length})`;
    }
    if (clearSelection) clearSelection.disabled = selectedKeys.length === 0;
    toolbar.querySelectorAll('[data-dc-selection-required]').forEach(control => {
        control.disabled = selectedKeys.length === 0;
    });
    const actionSelect = toolbar.querySelector('#dc-bulk-action-select');
    if (actionSelect) {
        const copyOpt = actionSelect.querySelector('option[value="copy"]');
        const pasteOpt = actionSelect.querySelector('option[value="paste"]');
        const styleFieldMask = getBulkStyleFieldMask();
        if (copyOpt) copyOpt.disabled = selectedKeys.length !== 1 || styleFieldMask === 0;
        if (pasteOpt) pasteOpt.disabled = !selectedKeys.length || !clipboard || styleFieldMask === 0;
    }
    if (clipboardStatus) clipboardStatus.textContent = clipboard
        ? `Style copied from ${clipboard.sourceName}`
        : 'No style copied';
    const gallerySelectedTarget = document.querySelector('#dc-gradient-gallery-target option[value="selected"]');
    if (gallerySelectedTarget) gallerySelectedTarget.textContent = `Selected rows (${selectedKeys.length})`;
}

function getVisibleCharacterEntries() {
    return getSortedEntries().slice(0, CHARACTER_LIST_RENDER_LIMIT);
}

export function updateCharList() {
    const list = document.getElementById('dc-char-list'); if (!list) return;
    const narratorEditor = document.getElementById('dc-narrator-editor');
    const narratorSignature = JSON.stringify(normalizeNarratorStyle(settings.narratorStyle, { legacy: settings }));
    if (narratorEditor && narratorEditor.dataset.narratorSignature !== narratorSignature) renderNarratorEditor();
    const scrollPositions = captureScrollPositions(list);
    const masterSeedInput = document.getElementById('dc-gradient-master-seed');
    if (masterSeedInput) masterSeedInput.value = settings.gradientRandomMasterSeed || 'Generated on first randomization';
    installCharListDelegation(list);
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Tracked characters');
    const activeElement = document.activeElement;
    const focusedControl = activeElement?.closest?.('.dc-char[data-key] [data-focus-id]');
    const focusState = focusedControl ? {
        key: focusedControl.closest('.dc-char')?.dataset.key,
        id: focusedControl.dataset.focusId,
    } : null;
    const matchingEntries = getSortedEntries();
    const entries = matchingEntries.slice(0, CHARACTER_LIST_RENDER_LIMIT);
    const omittedEntryCount = matchingEntries.length - entries.length;
    const countEl = document.getElementById('dc-count');
    if (countEl) countEl.textContent = Object.keys(characterColors).length;
    updateBulkToolbar(entries);
    refreshGroupProfileControls();

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
        if (!document.getElementById('dc-gradient-gallery')?.contains(document.activeElement)) renderGradientPresetGallery();
        registerGradientAnimationRoot(document.getElementById('dc-ext'));
        refreshGradientAnimationState();
        restoreScrollPositions(scrollPositions);
        requestAnimationFrame(() => restoreScrollPositions(scrollPositions));
        return;
    }

    // Build the desired ordered sequence of keyed blocks (optional group
    // headers interleaved with character rows).
    const desired = [];
    let lastGroup = null;
    for (const [k, v] of entries) {
        if (settings.sortMode === 'group') {
            const groupValue = normalizeGroupName(v.group);
            const g = groupValue || '(ungrouped)';
            const groupKey = groupValue ? `named:${normalizeGroupKey(groupValue)}` : 'ungrouped';
            if (groupKey !== lastGroup) {
                lastGroup = groupKey;
                desired.push({ blockKey: `__group__:${groupKey}`, sig: `h:${groupKey}`, html: `<div class="dc-group-header" role="listitem"><span role="heading" aria-level="3">${escapeHtml(g)}</span></div>` });
            }
        }
        desired.push({ blockKey: 'row:' + k, sig: buildCharRowSignature(k, v), html: buildCharRowHtml(k, v) });
    }
    if (omittedEntryCount) {
        desired.push({
            blockKey: '__render_limit__',
            sig: `limit:${omittedEntryCount}:${searchTerm}`,
            html: `<p class="dc-list-limit" role="listitem">Showing the first ${CHARACTER_LIST_RENDER_LIMIT} matches. Refine the character search to reach ${omittedEntryCount} more.</p>`,
        });
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
    registerGradientAnimationRoot(document.getElementById('dc-ext'));
    refreshGradientAnimationState();
    if (!document.getElementById('dc-gradient-gallery')?.contains(document.activeElement)) renderGradientPresetGallery();
    if (focusState?.key && focusState.id) {
        list.querySelector(`.dc-char[data-key="${CSS.escape(focusState.key)}"] [data-focus-id="${CSS.escape(focusState.id)}"]`)?.focus({ preventScroll: true });
    }
    restoreScrollPositions(scrollPositions);
    requestAnimationFrame(() => restoreScrollPositions(scrollPositions));
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
    } catch (error) {
        console.warn('[Dialogue Colors] Could not auto-add the active character from its card.', error);
    }
}

// Adds the active persona to the registry so the user can color their own dialogue.
// Silent mode is the automatic path and stays quiet; the button path reports back and
// falls through to addCharacter's reveal behaviour when the entry already exists.
export function ensurePersonaCharacter({ silent = false } = {}) {
    try {
        const name = getPersonaName();
        if (!name || isReservedCharacterIdentity(name)) {
            if (!silent) toast.info('No active persona to add.');
            return;
        }
        if (resolveCharacterKeyByNameOrAlias(name)) {
            if (markCurrentPersonaKept()) saveData();
            if (!silent) addCharacter(name);
            return;
        }
        const result = addCharacter(name, undefined, { origin: 'persona', keep: settings.keepPersonaCharacter === true });
        if (result?.added && !silent) toast.success(`Added ${escapeHtml(name)}`);
    } catch (error) {
        console.warn('[Dialogue Colors] Could not add the active persona.', error);
    }
}

// Swaps the pinned look for the active persona into the live registry.
//
// loadData() runs the same restore during a scope load and persists it itself, so
// this is the runtime path only: a persona switch mutates (or creates) an entry in
// an already-loaded table, which has to be saved and repainted like every other
// color mutation rather than only refreshed in the settings list.
export function applyRestoredPersonaColor() {
    const previousKeys = Object.keys(characterColors);
    const snapshot = captureEffectiveColorSnapshot(previousKeys);
    if (!restorePinnedPersonaColor()) return false;
    clearSpeakerRegexCache();
    applyLiveColorChangesFromSnapshot(
        snapshot,
        [...new Set([...previousKeys, ...Object.keys(characterColors)])],
        { saveImmediately: true },
    );
    saveHistory();
    saveData({ preserveEffectiveColors: true });
    updateStorageScopeStatus();
    injectPrompt();
    repaintDomAfterCharacterDataChange(0);
    return true;
}

export function renameCharacter(oldNameOrKey, newName, { notify = false, renamePersonaPin = false } = {}) {
    const previousKey = Object.prototype.hasOwnProperty.call(characterColors, oldNameOrKey)
        ? oldNameOrKey
        : resolveCharacterKeyByNameOrAlias(oldNameOrKey);
    const entry = characterColors[previousKey];
    const rawName = String(newName ?? '').trim();
    const nextName = normalizeRegistryIdentityName(rawName);
    const nextKey = normalizeRegistryIdentity(nextName);
    if (!entry) {
        if (notify) toast.warning('That character is no longer in the list.');
        return false;
    }
    if (!rawName || !nextName || !nextKey || /[\r\n\t\[\]=,()]/.test(rawName)) {
        if (notify) toast.warning('Character names cannot contain brackets, commas, equals signs, parentheses, line breaks, reserved words, or more than 120 characters.');
        return false;
    }
    if (isReservedCharacterIdentity(nextName)) {
        if (notify) toast.warning('Narrator identities are reserved for the Narration editor.');
        return false;
    }
    const existingKey = resolveCharacterKeyByNameOrAlias(nextName);
    if (existingKey && existingKey !== previousKey) {
        if (notify) toast.warning(`${escapeHtml(nextName)} already belongs to another character.`);
        return false;
    }
    if (previousKey === nextKey && entry.name === nextName) return false;

    entry.name = nextName;
    if (previousKey !== nextKey) {
        characterColors[nextKey] = entry;
        delete characterColors[previousKey];
        if (expandedCharacterRows.delete(previousKey)) expandedCharacterRows.add(nextKey);
        if (selectedCharacterKeys.delete(previousKey)) selectedCharacterKeys.add(nextKey);
        if (swapMode === previousKey) setSwapMode(nextKey);
        removePinnedCharacterKey(previousKey);
    }
    if (renamePersonaPin) renamePinnedPersonaColor(oldNameOrKey, nextName);
    clearSpeakerRegexCache();
    commit();
    repaintDomAfterCharacterDataChange(0);
    return true;
}

// Follows a persona rename so the color the user picked stays with them, rather than
// stranding the old entry and auto-assigning a fresh color to the new name.
export function renamePersonaCharacter(oldName, newName) {
    return renameCharacter(oldName, newName, { renamePersonaPin: true });
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
    const binding = captureUiMutationContext();
    const source = getStorageScopeDescriptor(previousScope);
    const target = getStorageScopeDescriptor(nextScope);
    const targetFingerprint = JSON.stringify(target);
    const detailsHtml = `<dl class="dc-review-list"><div><dt>Current</dt><dd>${escapeHtml(formatScopeName(previousScope))}, ${source.characterCount} characters, ${source.groupProfileCount || 0} group profiles</dd></div><div><dt>Destination</dt><dd>${escapeHtml(formatScopeName(nextScope))}, ${target.characterCount} characters, ${target.groupProfileCount || 0} group profiles</dd></div><div><dt>Last saved</dt><dd>${escapeHtml(formatDate(target.updatedAt))}</dd></div></dl><p class="dc-section-note">If Auto-recolor is enabled, changing assignments can also update saved LLM font tags.</p>`;
    const targetIsEmpty = !target.exists || (target.characterCount === 0 && (target.groupProfileCount || 0) === 0);
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
        select.value = getCurrentStorageScope();
        return;
    }
    if (!isUiMutationContextCurrent(binding)
        || JSON.stringify(getStorageScopeDescriptor(nextScope)) !== targetFingerprint) {
        select.value = getCurrentStorageScope();
        notifyUiContextChanged('The source or destination color table changed. Review the scope switch again.');
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
    if (Number.isFinite(preview.groupProfileCount)) rows.push(`<div><dt>Group profiles</dt><dd>${preview.groupProfileCount}</dd></div>`);
    if (preview.settingsPresent) rows.push(`<div><dt>Settings</dt><dd>${preview.settingsCount} recognized values</dd></div>`);
    if (preview.customGradientPresetCount) rows.push(`<div><dt>Gradient presets</dt><dd>${preview.customGradientPresetCount}</dd></div>`);
    if (preview.requestedStorageScope) rows.push(`<div><dt>Saved scope</dt><dd>${escapeHtml(formatScopeName(preview.requestedStorageScope))}</dd></div>`);
    const presetNote = preview.customGradientPresetCount
        ? '<p class="dc-section-note">Gradient presets are merged; existing presets with the same name are kept.</p>'
        : '';
    return `<dl class="dc-review-list">${rows.join('')}</dl>${presetNote}`;
}

function getImportAnalysisError(analysis, kind) {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        return `The ${kind} analyzer returned no usable review data.`;
    }
    if (analysis.ok !== true) return analysis.message || `The selected ${kind} data is not recognized.`;
    const preview = analysis.preview;
    const payload = analysis.payload;
    const expectedKind = kind === 'settings' ? 'settings' : kind === 'card' ? 'card' : 'colors';
    const validScope = preview?.requestedStorageScope === undefined
        || ['chat', 'card', 'global'].includes(preview.requestedStorageScope);
    const validPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        && payload.kind === expectedKind
        && (expectedKind === 'settings'
            ? payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
            : payload.colors && typeof payload.colors === 'object' && !Array.isArray(payload.colors));
    const validPreview = preview && typeof preview === 'object' && !Array.isArray(preview)
        && Number.isFinite(preview.characterCount)
        && Number.isFinite(preview.settingsCount)
        && validScope;
    if (!validPreview || !validPayload) {
        return `The ${kind} analyzer returned malformed review data; nothing was changed.`;
    }
    return '';
}

async function runImportAnalysis(task, label, onError = null) {
    try {
        return await task();
    } catch (error) {
        const message = `${label} could not be analyzed; nothing was changed.`;
        if (typeof onError === 'function') onError(message);
        toast.error(message);
        console.warn(`[Dialogue Colors] ${label} analysis failed:`, error);
        return null;
    }
}

function buildRemoteFontImportDisclosure() {
    const currentState = settings.allowRemoteFonts === true ? 'enabled' : 'disabled';
    return `<p class="dc-import-font-disclosure">Reviewing or applying this import cannot grant remote-font permission. Remote Google Fonts are currently ${currentState}; saved family names can make capped requests only after “Allow remote Google Fonts” is enabled separately. Otherwise names are preserved and only locally available fonts are used.</p>`;
}

async function reviewAndApplyImport(analysis, kind, opener) {
    const analysisError = getImportAnalysisError(analysis, kind);
    if (analysisError) {
        toast.error(analysisError);
        return analysis && typeof analysis === 'object' ? analysis : { ok: false, message: analysisError };
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
        detailsHtml: `${buildImportReviewDetails(analysis.preview)}${scopeDetails}${buildRemoteFontImportDisclosure()}${isSettings ? '' : '<p class="dc-section-note">If Auto-recolor is enabled, changed assignments can also update saved LLM font tags.</p>'}`,
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
    let result;
    try {
        result = await apply(analysis.payload, { mode: decision.value, applyScope: decision.checked });
    } catch (error) {
        console.error('[Dialogue Colors] Reviewed import failed before returning a result:', error);
        result = { ok: false, message: 'The reviewed data could not be applied safely.' };
    }
    if (!result || typeof result !== 'object') result = { ok: false, message: 'The reviewed import returned an invalid result.' };
    if (result.ok) {
        updateStorageScopeStatus();
        toast.success(kind === 'card' ? 'Card data applied.' : `${isSettings ? 'Settings' : 'Colors'} imported.`);
    } else toast.error(result.message || 'The reviewed data could not be applied.');
    return result;
}

function announceStylePack(message) {
    const status = document.getElementById('dc-style-pack-status');
    if (status) status.textContent = message;
}

function stylePackCheckbox(value, label, checked = false, note = '') {
    return `<label class="checkbox_label dc-style-pack-choice"><input type="checkbox" class="dc-dialog-select" data-value="${escapeAttr(value)}"${checked ? ' checked' : ''}><span>${escapeHtml(label)}${note ? ` <small>${escapeHtml(note)}</small>` : ''}</span></label>`;
}

function selectedStylePackNames(selected, category) {
    const prefix = `${category}:`;
    return selected
        .filter(value => typeof value === 'string' && value.startsWith(prefix))
        .map(value => value.slice(prefix.length));
}

function downloadStylePackJson(json, filename) {
    const blob = new Blob([json], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    return blob;
}

async function deliverStylePack(pack, opener) {
    const json = JSON.stringify(pack, null, 2);
    const filename = `dialogue-colors-style-pack-${Date.now()}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const navigatorApi = globalThis.navigator;
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
    const canShare = !!file && typeof navigatorApi?.canShare === 'function'
        && navigatorApi.canShare({ files: [file] });
    const canCopy = json.length <= STYLE_PACK_COPY_LIMIT && typeof navigatorApi?.clipboard?.writeText === 'function';
    const decision = await openDecisionDialog({
        title: 'Style pack ready',
        description: `${(new Blob([json])).size.toLocaleString()} bytes. It contains only the selections you reviewed.`,
        detailsHtml: `<p class="dc-section-note">Style packs are local JSON. No upload, remote lookup, CSS, or font file is included.</p>${json.length > STYLE_PACK_COPY_LIMIT ? `<p class="dc-section-note">Copy JSON is unavailable above ${(STYLE_PACK_COPY_LIMIT / 1024).toFixed(0)} KiB.</p>` : ''}`,
        opener,
        choices: [
            { value: 'download', label: 'Download JSON', primary: true },
            ...(canShare ? [{ value: 'share', label: 'Share file' }] : []),
            ...(canCopy ? [{ value: 'copy', label: 'Copy JSON' }] : []),
            { value: 'cancel', label: 'Close' },
        ],
    });
    if (decision.value === 'download') {
        downloadStylePackJson(json, filename);
        announceStylePack('Style pack downloaded.');
        toast.success('Style pack downloaded.');
    } else if (decision.value === 'share') {
        try {
            await navigatorApi.share({ files: [file], title: pack.metadata.name });
            announceStylePack('Style pack shared.');
            toast.success('Style pack shared.');
        } catch {
            downloadStylePackJson(json, filename);
            announceStylePack('Sharing was unavailable, so the style pack was downloaded.');
            toast.info('Sharing was unavailable, so the style pack was downloaded.');
        }
    } else if (decision.value === 'copy') {
        try {
            await navigatorApi.clipboard.writeText(json);
            announceStylePack('Style pack JSON copied.');
            toast.success('Style pack JSON copied.');
        } catch {
            toast.error('Could not copy the style pack JSON. Download it instead.');
        }
    }
}

async function buildStylePackExport(opener) {
    const palettes = getCustomPalettes();
    const gradients = getCustomGradientPresets();
    const assignments = getPresets();
    const paletteChoices = Object.keys(palettes).sort((left, right) => left.localeCompare(right));
    const gradientChoices = Object.keys(gradients).sort((left, right) => left.localeCompare(right));
    const assignmentChoices = Object.keys(assignments).sort((left, right) => left.localeCompare(right));
    const selectionHtml = `
        <fieldset class="dc-style-pack-selection"><legend>Include</legend>
            <div class="dc-style-pack-choice-list">
                ${paletteChoices.length ? paletteChoices.map(name => stylePackCheckbox(`palettes:${name}`, `Palette: ${name}`, true)).join('') : '<p class="dc-section-note">No custom palettes saved.</p>'}
                ${gradientChoices.length ? gradientChoices.map(name => stylePackCheckbox(`gradientPresets:${name}`, `Gradient preset: ${name}`, true)).join('') : '<p class="dc-section-note">No custom gradient presets saved.</p>'}
                ${stylePackCheckbox('appearance:current', 'Appearance: theme, palette, brightness, narration color, highlights, legend, and gradient drift', true)}
                ${assignmentChoices.length ? assignmentChoices.map(name => stylePackCheckbox(`assignmentPresets:${name}`, `Assignment preset: ${name}`, false, 'Optional, may include character names and font family names.')).join('') : '<p class="dc-section-note">No assignment presets saved.</p>'}
            </div>
        </fieldset>`;
    const formHtml = `
        <div class="dc-style-pack-form">
            <label>Pack name <input class="text_pole" type="text" maxlength="120" data-dialog-field="name" data-dialog-autofocus value="My Dialogue Colors" required></label>
            <label>Identifier <input class="text_pole" type="text" maxlength="120" data-dialog-field="id" placeholder="Optional"></label>
            <label>Version <input class="text_pole" type="text" maxlength="80" data-dialog-field="version" placeholder="Optional"></label>
            <label>Author <input class="text_pole" type="text" maxlength="160" data-dialog-field="author" placeholder="Optional"></label>
            <label>License <input class="text_pole" type="text" maxlength="160" data-dialog-field="license" placeholder="Optional"></label>
            <label class="dc-style-pack-form-wide">Description <textarea class="text_pole" maxlength="4000" data-dialog-field="description" placeholder="Optional"></textarea></label>
        </div>`;
    const decision = await openDecisionDialog({
        title: 'Build a style pack',
        description: 'Choose library items to share. Assignment presets are intentionally unchecked.',
        detailsHtml: `${selectionHtml}<p class="dc-style-pack-privacy">Font family names can reveal preferences. Packs contain names only, never font files, URLs, CSS, storage scopes, connection IDs, prompts, automation, or UI positions.</p>`,
        formHtml,
        opener,
        choices: [
            { value: 'build', label: 'Build pack', primary: true },
            { value: 'cancel', label: 'Cancel' },
        ],
    });
    if (decision.value !== 'build') return;
    const name = String(decision.formValues.name || '').trim();
    if (!name) {
        announceStylePack('A style-pack name is required.');
        toast.warning('Enter a style-pack name.');
        return;
    }
    try {
        const selectedPalettes = selectedStylePackNames(decision.selected, 'palettes');
        const selectedGradients = selectedStylePackNames(decision.selected, 'gradientPresets');
        const selectedAssignments = selectedStylePackNames(decision.selected, 'assignmentPresets');
        const includeAppearance = decision.selected.includes('appearance:current');
        const pack = buildStylePackEnvelope({
            customPalettes: palettes,
            customPaletteMeta: getCustomPaletteMeta(),
            customGradientPresets: gradients,
            presets: assignments,
            settings,
        }, {
            metadata: {
                name,
                id: decision.formValues.id,
                version: decision.formValues.version,
                author: decision.formValues.author,
                license: decision.formValues.license,
                description: decision.formValues.description,
            },
            selectedPalettes,
            selectedGradientPresets: selectedGradients,
            selectedAssignmentPresets: selectedAssignments,
            includeAssignmentPresets: selectedAssignments.length > 0,
            includeAppearance,
        });
        await deliverStylePack(pack, opener);
    } catch (error) {
        console.warn('[Dialogue Colors] Could not build style pack:', error);
        toast.error(error?.message || 'Could not build the style pack. Select at least one item.');
    }
}

function stylePackConflictSummary(analysis, category) {
    const result = analysis.conflicts?.categories?.[category];
    if (!result) return 'No items';
    if (!Array.isArray(result.conflicts) || !Array.isArray(result.additions)) return 'Summary unavailable';
    const identityResolutions = category === 'assignmentPresets' && Array.isArray(result.identityResolutions)
        ? result.identityResolutions.length
        : 0;
    const overrideSummary = identityResolutions
        ? `, ${identityResolutions} cross-preset identity resolution${identityResolutions === 1 ? '' : 's'}`
        : '';
    return `${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'}, ${result.additions.length} new${overrideSummary}`;
}

function buildStylePackAssignmentOverrideDetails(analysis) {
    const resolutions = analysis.conflicts?.categories?.assignmentPresets?.identityResolutions;
    if (!Array.isArray(resolutions) || !resolutions.length) return '';
    const visible = resolutions.slice(0, STYLE_PACK_OVERRIDE_DIAGNOSTIC_LIMIT);
    const rows = visible.map(diagnostic => {
        const identities = Array.isArray(diagnostic.identities) && diagnostic.identities.length
            ? diagnostic.identities.join(', ')
            : 'unspecified identity';
        const previous = `${diagnostic.previousAssignment || 'unnamed assignment'} in ${diagnostic.previousPreset || 'an earlier preset'}`;
        const current = `${diagnostic.overridingAssignment || 'an unnamed assignment'} in ${diagnostic.overridingPreset || 'a later preset'}`;
        const action = diagnostic.resolution === 'replace-assignment'
            ? `${previous} is replaced by ${current}`
            : diagnostic.resolution === 'reassign-alias'
                ? `${previous} cedes that alias to ${current}`
                : diagnostic.resolution === 'remove-previous-alias'
                    ? `${previous} drops that alias because ${current} uses it as a canonical name`
                    : `${current} drops that alias because ${previous} already uses it as a canonical name`;
        const description = `Identity/alias ${identities}: ${action}.`;
        return `<li>${escapeHtml(description)}</li>`;
    }).join('');
    const omitted = resolutions.length - visible.length;
    return `<section class="dc-style-pack-overrides"><h3>Cross-preset identity resolutions</h3><p>Later presets take precedence; canonical-name collisions replace assignments, while alias collisions reassign or drop only the alias.</p><ul>${rows}</ul>${omitted ? `<p>${omitted} additional resolution${omitted === 1 ? '' : 's'} omitted from this bounded review.</p>` : ''}</section>`;
}

function buildStylePackImportDetails(analysis) {
    const { pack, catalog, source } = analysis;
    const metadata = pack.metadata || {};
    const rows = [
        ['Format', `${pack.format} v${pack.formatVersion}`],
        ['Name', metadata.name || 'Unnamed'],
        ['Author', metadata.author || 'Not provided'],
        ['Digest', analysis.digest],
        ['Source', `${Number(source?.byteLength || 0).toLocaleString()} bytes`],
        ['Palettes', `${catalog.totals.palettes} (${stylePackConflictSummary(analysis, 'palettes')})`],
        ['Gradient presets', `${catalog.totals.gradientPresets} (${stylePackConflictSummary(analysis, 'gradientPresets')})`],
        ['Assignment presets', `${catalog.totals.assignmentPresets} (${stylePackConflictSummary(analysis, 'assignmentPresets')})`],
        ['Appearance values', String(catalog.totals.appearanceSettings)],
        ['Unknown/dropped fields', analysis.droppedFields.length ? analysis.droppedFields.slice(0, 8).join(', ') : 'None'],
    ];
    const fontNote = analysis.fontNames.length
        ? `Font family names: ${analysis.fontNames.join(', ')}. Installing this reviewed pack cannot grant remote-font permission. Applying assignments can make capped Google Fonts requests only after “Allow remote Google Fonts” is enabled separately; otherwise these names remain local-only data.`
        : 'No font family names were found.';
    return `<dl class="dc-review-list dc-style-pack-review">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${buildStylePackAssignmentOverrideDetails(analysis)}<p class="dc-style-pack-privacy">${escapeHtml(fontNote)} No URLs, CSS, profile IDs, storage scope, auto-sync, prompts, automation, attribution settings, or UI positions are accepted from a style pack.</p>`;
}

async function reviewAndApplyStylePack(analysis, opener, binding = captureUiMutationContext()) {
    const totals = analysis?.catalog?.totals;
    const validTotals = totals && ['palettes', 'gradientPresets', 'assignmentPresets', 'appearanceSettings']
        .every(key => Number.isFinite(totals[key]) && totals[key] >= 0);
    const conflictCategories = analysis?.conflicts?.categories;
    const validConflicts = conflictCategories && ['palettes', 'gradientPresets', 'assignmentPresets']
        .every(category => Array.isArray(conflictCategories[category]?.conflicts)
            && Array.isArray(conflictCategories[category]?.additions))
        && Array.isArray(conflictCategories.assignmentPresets?.overrides)
        && Array.isArray(conflictCategories.assignmentPresets?.identityResolutions)
        && Array.isArray(conflictCategories.assignmentPresets?.presetOrder)
        && conflictCategories.assignmentPresets.presetOrder.every(name => typeof name === 'string');
    const validShape = analysis && typeof analysis === 'object' && !Array.isArray(analysis)
        && analysis.ok === true
        && analysis.pack && typeof analysis.pack === 'object' && !Array.isArray(analysis.pack)
        && validTotals
        && validConflicts
        && typeof analysis.catalogFingerprint === 'string' && analysis.catalogFingerprint.length > 0
        && typeof analysis.digest === 'string' && analysis.digest.length > 0
        && Array.isArray(analysis.droppedFields)
        && analysis.droppedFields.every(field => typeof field === 'string')
        && Array.isArray(analysis.fontNames)
        && analysis.fontNames.every(font => typeof font === 'string');
    if (!validShape) {
        const message = analysis?.ok === false && analysis.message
            ? analysis.message
            : 'The style-pack analyzer returned malformed review data; nothing was changed.';
        announceStylePack(message);
        toast.error(message);
        return analysis && typeof analysis === 'object' ? analysis : { ok: false, message };
    }
    const hasAssignments = analysis.catalog.totals.assignmentPresets > 0;
    const hasAppearance = analysis.catalog.totals.appearanceSettings > 0;
    const reviewedState = JSON.stringify([
        analysis.digest,
        analysis.catalogFingerprint,
        analysis.conflicts.categories.assignmentPresets.presetOrder,
    ]);
    const strategySelect = (category, label) => `<label>${escapeHtml(label)}<select class="text_pole" data-dialog-field="strategy-${category}"><option value="keep">Keep existing (default)</option><option value="rename">Rename imported</option><option value="replace">Replace existing</option></select></label>`;
    const formHtml = `
        <fieldset class="dc-style-pack-selection"><legend>Conflict handling</legend>
            <div class="dc-style-pack-strategies">
                ${strategySelect('palettes', `Palettes, ${stylePackConflictSummary(analysis, 'palettes')}`)}
                ${strategySelect('gradientPresets', `Gradient presets, ${stylePackConflictSummary(analysis, 'gradientPresets')}`)}
                ${hasAssignments ? strategySelect('assignmentPresets', `Assignment presets, ${stylePackConflictSummary(analysis, 'assignmentPresets')}`) : ''}
            </div>
        </fieldset>
        <div class="dc-style-pack-apply-options">
            ${hasAssignments ? '<label class="checkbox_label"><input type="checkbox" data-dialog-field="installAssignments"><span>Install assignment presets into the library</span></label><label class="checkbox_label"><input type="checkbox" data-dialog-field="applyAssignments"><span>Also apply imported assignments to the active color table</span></label><label>Assignment apply mode <select class="text_pole" data-dialog-field="assignmentApplyMode"><option value="merge">Keep current same-name assignments</option><option value="replace">Replace table with selected preset entries</option></select></label>' : ''}
            ${hasAppearance ? '<label class="checkbox_label"><input type="checkbox" data-dialog-field="applyAppearance"><span>Apply appearance to the active color scope</span></label>' : ''}
        </div>`;
    const decision = await openDecisionDialog({
        title: 'Review style pack',
        description: 'Nothing changes until you choose Install. Library-only installation does not need the active chat or card.',
        detailsHtml: buildStylePackImportDetails(analysis),
        formHtml,
        opener,
        choices: [
            { value: 'install', label: 'Install reviewed pack', primary: true },
            { value: 'cancel', label: 'Cancel' },
        ],
    });
    if (decision.value !== 'install') return { ok: false, cancelled: true };
    const fields = decision.formValues;
    const needsScope = fields.applyAssignments === true || fields.applyAppearance === true;
    if ((needsScope && !isUiMutationContextCurrent(binding))
        || reviewedState !== JSON.stringify([
            analysis.digest,
            analysis.catalogFingerprint,
            analysis.conflicts.categories.assignmentPresets.presetOrder,
        ])) {
        return notifyUiContextChanged('The active style-pack target or reviewed state changed. Review the pack again.');
    }
    let result;
    try {
        result = await applyStylePackImport(analysis, {
            categoryStrategies: {
                palettes: fields['strategy-palettes'],
                gradientPresets: fields['strategy-gradientPresets'],
                assignmentPresets: fields['strategy-assignmentPresets'],
            },
            installAssignmentPresets: fields.installAssignments === true,
            applyAssignments: fields.applyAssignments === true,
            assignmentApplyMode: fields.assignmentApplyMode,
            applyAppearance: fields.applyAppearance === true,
        });
    } catch (error) {
        console.error('[Dialogue Colors] Reviewed style-pack install failed before returning a result:', error);
        result = { ok: false, message: 'The reviewed style pack could not be installed safely.' };
    }
    if (!result || typeof result !== 'object') result = { ok: false, message: 'The style-pack install returned an invalid result.' };
    if (result.ok) {
        renderStylePackRegistry();
        const message = result.unchanged
            ? 'No library items changed because existing conflicts were kept.'
            : `Installed ${result.installed} style-library item${result.installed === 1 ? '' : 's'}.`;
        announceStylePack(message);
        toast.success(message);
    } else {
        announceStylePack(result.message || 'The reviewed style pack could not be installed.');
        toast.error(result.message || 'The reviewed style pack could not be installed.');
    }
    return result;
}

export function renderStylePackRegistry() {
    const host = document.getElementById('dc-style-pack-registry');
    if (!host) return;
    const entries = Object.entries(getStylePackRegistry()).sort(([left], [right]) => left.localeCompare(right));
    host.innerHTML = entries.length
        ? entries.map(([key, entry]) => {
            const mapped = Object.values(entry.itemMappings || {}).reduce((count, values) => count + Object.keys(values).length, 0);
            return `<div class="dc-style-pack-registry-entry"><strong>${escapeHtml(key)}</strong><small>${escapeHtml(formatDate(entry.installedAt))}, ${mapped} mapped item${mapped === 1 ? '' : 's'}</small></div>`;
        }).join('')
        : '<p class="dc-section-note">No style packs have been installed.</p>';
}

async function confirmCharacterRemoval(keys, options = {}) {
    const getCandidates = () => [...new Set(typeof options.getCandidates === 'function' ? options.getCandidates() : keys)]
        .filter(key => characterColors[key]);
    const candidates = getCandidates();
    const pinned = candidates.filter(key => characterColors[key]?.keep);
    const removable = candidates.filter(key => !characterColors[key]?.keep);
    if (!candidates.length) { toast.info(options.emptyMessage || 'No matching characters.'); return false; }
    if (!removable.length) { toast.info(options.blockedMessage || 'All matching characters are pinned.'); return false; }
    const binding = captureUiMutationContext();
    const reviewedEntries = new Map(candidates.map(key => [key, characterColors[key]]));
    const reviewedKeep = new Map(candidates.map(key => [key, characterColors[key].keep === true]));
    const confirmed = await confirmReviewedAction({
        title: options.title || 'Delete characters?',
        description: `${removable.length} character${removable.length === 1 ? '' : 's'} will be deleted. ${pinned.length ? `${pinned.length} pinned ${pinned.length === 1 ? 'entry is' : 'entries are'} protected.` : 'No pinned entries are affected.'}`,
        detailsHtml: `<p class="dc-review-names">${removable.slice(0, 8).map(key => escapeHtml(characterColors[key].name)).join(', ')}${removable.length > 8 ? `, and ${removable.length - 8} more` : ''}</p>`,
        confirmLabel: options.confirmLabel || 'Delete',
        danger: true,
        opener: options.opener,
    });
    if (!confirmed) return false;
    const currentCandidates = getCandidates();
    const reviewedCandidateSet = new Set(candidates);
    if (!isUiMutationContextCurrent(binding)
        || currentCandidates.length !== candidates.length
        || currentCandidates.some(key => !reviewedCandidateSet.has(key))
        || candidates.some(key => characterColors[key] !== reviewedEntries.get(key)
            || (characterColors[key]?.keep === true) !== reviewedKeep.get(key))) {
        return notifyUiContextChanged('The active color table or reviewed characters changed. Review the deletion again.');
    }
    return removeCharacterKeys(candidates, options);
}

function runSelectedCharacterMutation(mutator, options = {}) {
    const result = executeSelectedCharacterMutation(mutator);
    if (result.noSelection) {
        toast.info('Select at least one character.');
        return result;
    }
    if (!result.applied) {
        if (options.noChangeMessage) toast.info(options.noChangeMessage);
        return result;
    }
    const message = typeof options.successMessage === 'function'
        ? options.successMessage(result)
        : options.successMessage;
    if (message) toast.success(message);
    return result;
}

async function deleteSelectedCharacters(opener) {
    const selectedKeys = getSelectedCharacterKeys();
    const keptKeys = selectedKeys.filter(key => characterColors[key]?.keep);
    const removableKeys = selectedKeys.filter(key => characterColors[key] && !characterColors[key].keep);
    if (!selectedKeys.length) { toast.info('Select at least one character.'); return; }
    if (!removableKeys.length) { toast.info('All selected characters are kept. Unkeep them before deleting.'); return; }
    const binding = captureUiMutationContext();
    const reviewedEntries = new Map(selectedKeys.map(key => [key, characterColors[key]]));
    const reviewedKeep = new Map(selectedKeys.map(key => [key, characterColors[key]?.keep === true]));
    const confirmed = await confirmReviewedAction({
        title: `Delete ${removableKeys.length} selected character${removableKeys.length === 1 ? '' : 's'}?`,
        description: `${removableKeys.length} selected character${removableKeys.length === 1 ? '' : 's'} will be deleted. ${keptKeys.length ? `${keptKeys.length} kept ${keptKeys.length === 1 ? 'character is' : 'characters are'} protected.` : 'No kept characters are affected.'}`,
        detailsHtml: `<p class="dc-review-names">${removableKeys.slice(0, 12).map(key => escapeHtml(characterColors[key].name)).join(', ')}${removableKeys.length > 12 ? `, and ${removableKeys.length - 12} more` : ''}</p>`,
        confirmLabel: 'Delete selected',
        danger: true,
        opener,
    });
    if (!confirmed) return;
    const currentSelection = getSelectedCharacterKeys();
    if (!isUiMutationContextCurrent(binding)
        || currentSelection.length !== selectedKeys.length
        || currentSelection.some((key, index) => key !== selectedKeys[index])
        || selectedKeys.some(key => characterColors[key] !== reviewedEntries.get(key)
            || (characterColors[key]?.keep === true) !== reviewedKeep.get(key))) {
        return notifyUiContextChanged('The active color table or selected characters changed. Review the deletion again.');
    }
    const restore = createRestoreSnapshot();
    const result = runSelectedCharacterMutation(deleteCharacterKeys);
    if (!result.removedKeys?.length) return;
    const keptText = result.keptKeys.length
        ? ` Kept ${result.keptKeys.length} pinned character${result.keptKeys.length === 1 ? '' : 's'}.`
        : '';
    showUndoToast(`Deleted ${result.removedKeys.length} selected character${result.removedKeys.length === 1 ? '' : 's'}.${keptText}`, restore);
    requestAnimationFrame(() => document.getElementById('dc-select-visible')?.focus({ preventScroll: true }));
}

export function syncUIWithSettings() {
    const $ = id => document.getElementById(id);
    normalizeToggleSettings();
    if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
    if ($('dc-highlight')) $('dc-highlight').checked = settings.highlightMode;
    if ($('dc-autoscan')) $('dc-autoscan').checked = settings.autoScanOnLoad !== false;
    if ($('dc-autoscan-new')) $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false;
    if ($('dc-auto-lock')) $('dc-auto-lock').checked = settings.autoLockDetected !== false;
    if ($('dc-auto-persona')) $('dc-auto-persona').checked = settings.autoPersonaCharacter === true;
    if ($('dc-keep-persona')) $('dc-keep-persona').checked = settings.keepPersonaCharacter === true;
    if ($('dc-persist-persona-color')) $('dc-persist-persona-color').checked = settings.persistPersonaColor === true;
    if ($('dc-clear-unpinned-new-chat')) $('dc-clear-unpinned-new-chat').checked = settings.clearUnpinnedOnNewChat === true;
    if ($('dc-auto-random-gradients')) $('dc-auto-random-gradients').checked = settings.autoRandomNpcGradients === true;
    if ($('dc-auto-random-all-gradients')) $('dc-auto-random-all-gradients').checked = settings.autoRandomAllGradients === true;
    if ($('dc-auto-random-gradients')) $('dc-auto-random-gradients').disabled = settings.autoRandomAllGradients === true;
    if ($('dc-drift-all-gradients')) $('dc-drift-all-gradients').checked = settings.driftAllGradientColors === true;
    if ($('dc-force-bold')) $('dc-force-bold').checked = settings.forceBoldText === true;
    if ($('dc-allow-remote-fonts')) $('dc-allow-remote-fonts').checked = settings.allowRemoteFonts === true;
    if ($('dc-auto-recolor')) $('dc-auto-recolor').checked = settings.autoRecolor !== false;
    if ($('dc-auto-colorize')) $('dc-auto-colorize').checked = settings.autoColorize || false;
    if ($('dc-complete-partial')) $('dc-complete-partial').checked = settings.completePartialColorize !== false;
    if ($('dc-llm-attr-check')) $('dc-llm-attr-check').checked = settings.llmAttributionCheck || false;
    if ($('dc-llm-attr-parallel')) $('dc-llm-attr-parallel').checked = settings.llmAttributionParallel || false;
    if ($('dc-attr-accept-all')) $('dc-attr-accept-all').checked = settings.attributionReviewPolicy === 'legacy-auto';
    if ($('dc-attr-conservative')) $('dc-attr-conservative').checked = settings.attributionConservativeOnly || false;
    if ($('dc-attr-max-tokens')) $('dc-attr-max-tokens').value = Number.isFinite(settings.attributionMaxTokens) && settings.attributionMaxTokens > 0 ? settings.attributionMaxTokens : 4096;
    if ($('dc-attr-passes')) $('dc-attr-passes').value = getAttributionVerifyPasses();
    if ($('dc-stealth-colors')) $('dc-stealth-colors').checked = settings.domStealthColors !== false;
    if ($('dc-mark-uncertain')) $('dc-mark-uncertain').checked = settings.markUncertainDialogue === true;
    document.body?.classList?.toggle('dc-mark-uncertain', settings.markUncertainDialogue === true);
    if ($('dc-right-click')) $('dc-right-click').checked = settings.enableRightClick;
    if ($('dc-legend')) $('dc-legend').checked = settings.showLegend;
    if ($('dc-disable-toasts')) $('dc-disable-toasts').checked = settings.disableToasts || false;
    if ($('dc-engine')) $('dc-engine').value = settings.coloringEngine || 'llm';
    if ($('dc-llm-profile')) $('dc-llm-profile').value = settings.llmConnectionProfile || '';
    if ($('dc-attr-profile')) $('dc-attr-profile').value = settings.attributionConnectionProfile || '';
    if ($('dc-theme')) $('dc-theme').value = settings.themeMode;
    if ($('dc-palette')) $('dc-palette').value = settings.colorTheme || 'pastel';
    if ($('dc-brightness')) $('dc-brightness').value = settings.brightness || 0;
    if ($('dc-bright-val')) $('dc-bright-val').textContent = settings.brightness || 0;
    if ($('dc-cvd-mode')) $('dc-cvd-mode').value = settings.colorVisionPreviewMode || 'none';
    if ($('dc-cvd-severity')) $('dc-cvd-severity').value = settings.colorVisionPreviewSeverity ?? 100;
    if ($('dc-cvd-severity-value')) $('dc-cvd-severity-value').textContent = `${settings.colorVisionPreviewSeverity ?? 100}%`;
    if ($('dc-cvd-target')) $('dc-cvd-target').value = settings.colorVisionPreviewTarget || 'all';
    if ($('dc-gradient-animation-mode')) $('dc-gradient-animation-mode').value = settings.gradientAnimationMode || 'auto';
    if ($('dc-gradient-master-seed')) $('dc-gradient-master-seed').value = settings.gradientRandomMasterSeed || 'Generated on first randomization';
    if ($('dc-thought-symbols')) $('dc-thought-symbols').value = settings.thoughtSymbols || '';
    if ($('dc-prompt-depth')) $('dc-prompt-depth').value = settings.promptDepth ?? 1;
    if ($('dc-prompt-role')) $('dc-prompt-role').value = settings.promptRole || 'system';
    if ($('dc-prompt-mode')) $('dc-prompt-mode').value = settings.promptMode || 'inject';
    if ($('dc-auto-prompt-mode')) $('dc-auto-prompt-mode').checked = settings.autoPromptMode !== false;
    if ($('dc-sort')) $('dc-sort').value = settings.sortMode || 'name';
    syncProcessControlState();
    refreshAttributionReviewStatus();
    refreshPresetDropdown();
    refreshPaletteDropdown();
    refreshGradientPresetControls();
    renderStylePackRegistry();
    refreshGroupProfileControls();
    renderNarratorEditor();
    updateSystemPromptDisplay();
    updateEngineVisibility();
    updateAutoSyncUI();
    updateStorageScopeStatus();
    updateColorVisionPreviewStatus();
    syncRemoteFontLoadingPolicy();
    setGradientAnimationMode(settings.gradientAnimationMode);
    const previewSignature = getColorVisionPreviewSignature();
    if (lastColorVisionPreviewSignature && previewSignature !== lastColorVisionPreviewSignature) {
        scheduleDomRefreshSeries(0);
        scheduleCustomFontRefresh(0);
        updateLegend();
        renderGradientPresetGallery();
    }
    lastColorVisionPreviewSignature = previewSignature;
    applyControlHelpText();
}

function formatColorVisionMode(mode) {
    if (mode === 'none') return 'None';
    return String(mode || '').charAt(0).toUpperCase() + String(mode || '').slice(1);
}

function updateColorVisionPreviewStatus() {
    const status = document.getElementById('dc-cvd-preview-status');
    if (!status) return;
    const severity = Math.max(0, Math.min(100, Number(settings.colorVisionPreviewSeverity) || 0));
    const active = settings.colorVisionPreviewMode !== 'none' && severity > 0;
    status.classList.toggle('dc-preview-active', active);
    status.textContent = active
        ? `Preview: ${formatColorVisionMode(settings.colorVisionPreviewMode)}, ${severity}%, ${settings.colorVisionPreviewTarget === 'ui' ? 'extension only' : settings.colorVisionPreviewTarget === 'chat' ? 'chat and cards only' : 'extension and chat'}`
        : 'Preview off (stored colors are unchanged)';
}

function getColorVisionPreviewSignature() {
    return JSON.stringify([
        settings.colorVisionPreviewMode,
        settings.colorVisionPreviewSeverity,
        settings.colorVisionPreviewTarget,
    ]);
}

function refreshColorVisionPreview() {
    lastColorVisionPreviewSignature = getColorVisionPreviewSignature();
    updateColorVisionPreviewStatus();
    updateCharList();
    updateLegend();
    renderGradientPresetGallery();
    renderNarratorEditor();
    scheduleDomRefreshSeries(0);
    scheduleCustomFontRefresh(0);
}

function formatConflictMode(mode, severity) {
    return mode === 'none' ? 'Normal color vision' : `${formatColorVisionMode(mode)} at ${Math.round(severity * 100)}%`;
}

function getConflictReportIssues(report) {
    if (Array.isArray(report?.issues)) return report.issues;
    return [...(report?.conflicts || []), ...(report?.readabilityIssues || [])];
}

function isConflictReportPartial(report) {
    return report?.partial === true || Object.values(report?.truncated || {}).some(Boolean);
}

function describeConflictReportLimits(report, unexaminedPairs) {
    const reasons = [];
    if (unexaminedPairs > 0) reasons.push(`${unexaminedPairs} visual pair${unexaminedPairs === 1 ? '' : 's'} per mode remain unexamined`);
    if (report.truncated?.modes) reasons.push('requested viewing modes were omitted');
    if (report.truncated?.conflicts || report.truncated?.readabilityIssues) reasons.push('the finding limit was reached');
    if (report.truncated?.cancelled) reasons.push('analysis was cancelled');
    const omittedItems = Math.max(0, Number(report.omittedItemCount) || 0);
    if (omittedItems > 0) reasons.push(`${omittedItems} visual${omittedItems === 1 ? ' was' : 's were'} omitted`);
    else if (report.truncated?.items) reasons.push('visuals were omitted');
    return reasons.join('; ') || 'an analysis limit was reached';
}

function buildConflictReportHtml(report) {
    const issues = getConflictReportIssues(report);
    const partial = isConflictReportPartial(report);
    const possiblePairs = Number(report.possibleComparisonCountPerMode) || 0;
    const evaluatedPairs = Number(report.comparisonCountPerMode) || 0;
    const unexaminedPairs = Math.max(0, Number(report.unexaminedComparisonCountPerMode) || (possiblePairs - evaluatedPairs));
    const limitDescription = describeConflictReportLimits(report, unexaminedPairs);
    if (!issues.length) {
        if (partial) {
            return `<p class="dc-conflict-empty">The bounded analysis found no reportable issues in ${evaluatedPairs} of ${possiblePairs} visual pairs per mode. This result is partial because ${escapeHtml(limitDescription)}.</p>`;
        }
        return `<p class="dc-conflict-empty">No similarity or readability conflicts were found across ${report.itemCount} active visuals and all evaluated color-vision modes.</p>`;
    }
    const visibleConflicts = issues.slice(0, 120);
    const rows = visibleConflicts.map(conflict => {
        const isReadability = conflict.type === 'readability';
        const leftReadability = conflict.readability?.left;
        const rightReadability = conflict.readability?.right;
        const readability = isReadability && leftReadability
            ? `${conflict.left.label} ${leftReadability.minimumRatio}:1 (${leftReadability.level})`
            : leftReadability && rightReadability
            ? `${conflict.left.label} ${leftReadability.minimumRatio}:1 (${leftReadability.level}); ${conflict.right.label} ${rightReadability.minimumRatio}:1 (${rightReadability.level})`
            : 'Readability not available';
        const identities = [conflict.left, conflict.right].filter(Boolean);
        const repairable = identities.map(item => item.id).filter(key => {
            const entry = characterColors[key];
            return entry && !entry.locked && !entry.keep && String(entry.name || key).toLowerCase() !== 'narrator';
        }).map(key => characterColors[key].name);
        const involvesNarrator = identities.some(item => item.kind === 'narrator');
        const repairStatus = involvesNarrator
            ? 'Unresolved; change Narration explicitly in Engine settings'
            : repairable.length ? `Can recolor ${repairable.join(' or ')}` : 'Protected by Lock or Keep';
        const heading = isReadability
            ? `${conflict.left.label} readability`
            : `${conflict.left.label} and ${conflict.right.label}`;
        const severity = `${conflict.level === 'strong' ? 'Strong' : 'Potential'}${isReadability ? '' : ` (Delta E ${conflict.deltaE})`}`;
        return `<article class="dc-conflict-row"><h3>${escapeHtml(heading)}</h3><dl><div><dt>Severity</dt><dd>${escapeHtml(severity)}</dd></div><div><dt>Mode</dt><dd>${escapeHtml(formatConflictMode(conflict.mode, conflict.severity))}</dd></div><div><dt>Reason</dt><dd>${(conflict.reasons || [conflict.narration]).map(escapeHtml).join(' ')}</dd></div><div><dt>Readability</dt><dd>${escapeHtml(readability)}</dd></div><div><dt>Repair</dt><dd>${escapeHtml(repairStatus)}</dd></div></dl></article>`;
    }).join('');
    const omitted = issues.length - visibleConflicts.length;
    const bounded = partial
        ? ` This report is partial: ${escapeHtml(limitDescription)}.`
        : '';
    return `<p class="dc-conflict-summary">${report.conflicts.length} similarity pair${report.conflicts.length === 1 ? '' : 's'} and ${(report.readabilityIssues || []).length} readability issue${(report.readabilityIssues || []).length === 1 ? '' : 's'} across modes, from ${evaluatedPairs} of ${possiblePairs} visual pairs per mode.${bounded}</p><div class="dc-conflict-list">${rows}</div>${omitted ? `<p>${omitted} additional results omitted from this view.</p>` : ''}`;
}

export async function showColorConflictReport(report = getPerceptualConflictReport(), options = {}) {
    const binding = captureUiMutationContext();
    const reviewedTable = JSON.stringify(characterColors);
    const issues = getConflictReportIssues(report);
    const partial = isConflictReportPartial(report);
    const canRepair = !partial && issues.some(conflict => {
        const identities = [conflict.left, conflict.right].filter(Boolean);
        if (identities.some(item => item.kind === 'narrator')) return false;
        return identities.some(item => {
            const entry = characterColors[item.id];
            return entry && !entry.locked && !entry.keep && String(entry.name || item.id).toLowerCase() !== 'narrator';
        });
    });
    const decision = await openDecisionDialog({
        title: options.afterRepair ? 'Conflict repair result' : 'Perceptual color conflicts',
        description: options.afterRepair
            ? `${options.changedCount} character${options.changedCount === 1 ? '' : 's'} recolored in one saved change. Locked, kept, and Narration visuals were not modified; Narration conflicts remain unresolved.`
            : partial
                ? 'Analysis uses deterministic item, sample, and pair limits. The report identifies omitted visuals and unexamined pairs; partial reports are review-only and are never auto-repaired.'
                : 'Active primary colors and gradients are sampled under normal vision and four color-vision simulations. Readability is measured against the current chat surface.',
        detailsHtml: buildConflictReportHtml(report),
        choices: [
            ...(!options.afterRepair && issues.length && canRepair ? [{ value: 'repair', label: 'Repair safe targets', primary: true }] : []),
            { value: 'close', label: 'Close', primary: !issues.length || options.afterRepair || partial },
        ],
    });
    if (decision.value !== 'repair') return report;
    if (!isUiMutationContextCurrent(binding) || JSON.stringify(characterColors) !== reviewedTable) {
        notifyUiContextChanged('The active color table changed. Run the conflict report again.');
        return report;
    }
    const result = repairPerceptualConflicts();
    await showColorConflictReport(result.report, { afterRepair: true, changedCount: result.changedKeys.length });
    return result.report;
}

// Settings open as a full-window page rather than an inline drawer, so the
// section list doubles as the page navigation. Order here is the nav order.
const SETTINGS_PAGE_SECTIONS = [
    { slug: 'setup', label: 'Current setup' },
    { slug: 'process', label: 'Process chat' },
    { slug: 'characters', label: 'Characters' },
    { slug: 'appearance', label: 'Appearance' },
    { slug: 'engine', label: 'Engine settings' },
    { slug: 'automation', label: 'Automation' },
    { slug: 'library', label: 'Style library' },
    { slug: 'storage', label: 'Storage & transfer' },
    { slug: 'maintenance', label: 'Maintenance' },
    { slug: 'danger', label: 'Danger zone' },
];

const DEFAULT_SETTINGS_PAGE_SLUG = SETTINGS_PAGE_SECTIONS[0].slug;

function buildSettingsPageNavHtml() {
    return SETTINGS_PAGE_SECTIONS.map(({ slug, label }) => `
                <button type="button" role="tab" class="dc-page-tab" id="dc-tab-${slug}" data-dc-tab="${slug}" aria-controls="dc-page-${slug}" aria-selected="false" tabindex="-1">${label}</button>`).join('');
}

function buildSettingsPanelHtml() {
    return `
    <div id="dc-ext" class="inline-drawer">
        <button type="button" id="dc-panel-toggle" class="inline-drawer-toggle inline-drawer-header" aria-expanded="false" aria-controls="dc-panel-content"><b>Dialogue Colors</b><span class="inline-drawer-icon fa-solid fa-circle-chevron-down down" aria-hidden="true"></span></button>
        <div id="dc-panel-content" class="inline-drawer-content dc-panel-content" aria-labelledby="dc-panel-toggle">
            <div class="dc-panel-toolbar">
                <span class="dc-panel-toolbar-title" aria-hidden="true">Dialogue Colors</span>
                <button type="button" id="dc-fullscreen-toggle" class="menu_button dc-fullscreen-toggle" aria-pressed="false"><span class="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></span><span class="dc-fullscreen-label">Fullscreen</span></button>
            </div>
            <nav id="dc-page-nav" class="dc-page-nav" role="tablist" aria-orientation="vertical" aria-label="Dialogue Colors sections">${buildSettingsPageNavHtml()}
            </nav>
            <details class="dc-section dc-section-primary" id="dc-page-setup" data-dc-page="setup" data-dc-disclosure="setup" role="tabpanel" aria-labelledby="dc-tab-setup" tabindex="-1" open>
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
            <details class="dc-section dc-section-primary" id="dc-page-process" data-dc-page="process" data-dc-disclosure="process" role="tabpanel" aria-labelledby="dc-tab-process" tabindex="-1" open>
                <summary>Process chat</summary>
                <p class="dc-section-note">Each action names exactly what it changes.</p>
                <div class="dc-process-grid">
                    <div class="dc-action-block"><span><strong>Discover</strong><small>Read the entire chat and update tracked speakers.</small></span><button id="dc-scan" class="menu_button dc-primary-button">Scan entire chat</button></div>
                    <div class="dc-action-block dc-llm-only"><span><strong>Colorize missing</strong><small>Add font tags only where dialogue is uncolored.</small></span><div class="dc-action-control"><select id="dc-colorize-target" class="text_pole" aria-label="Colorize target"><option value="last">Latest message</option><option value="all">Entire chat</option></select><button id="dc-colorize" class="menu_button dc-primary-button">Colorize</button></div></div>
                    <div class="dc-action-block dc-dom-only" style="display:none;"><span><strong>Verify attribution</strong><small>Ask the selected LLM profile to review local assignments.</small></span><div class="dc-action-control"><select id="dc-verify-target" class="text_pole" aria-label="Verification target"><option value="latest">Latest message</option><option value="visible">Visible messages</option></select><button id="dc-verify-attr" class="menu_button dc-primary-button">Verify</button></div></div>
                    <div class="dc-action-block dc-dom-only" style="display:none;"><span><strong>Review suggestions</strong><small>Review verifier changes one dialogue segment at a time.</small></span><div class="dc-action-control"><button id="dc-review-attr" class="menu_button">Review suggestions (0)</button><span id="dc-review-attr-status" class="dc-visually-hidden" role="status" aria-live="polite">0 review suggestions.</span></div></div>
                    <div class="dc-action-block"><span><strong class="dc-llm-only">Recolor saved tags</strong><strong class="dc-dom-only" style="display:none;">Refresh local colors</strong><small class="dc-llm-only">Rewrite existing color tags across the entire chat.</small><small class="dc-dom-only" style="display:none;">Reapply current styles to rendered dialogue.</small></span><button id="dc-recolor" class="menu_button dc-primary-button">Recolor entire chat</button></div>
                    <div class="dc-action-block"><span><strong>Repair tool calls</strong><small>Undo color tags older versions added to tool-call messages.</small></span><button id="dc-repair-tool-calls" class="menu_button dc-primary-button">Repair</button></div>
                    <div class="dc-action-block"><span><strong>List tools</strong><small>Inspect activity or clear every unpinned entry.</small></span><div class="dc-action-control"><button id="dc-stats" class="menu_button">Statistics</button><button id="dc-clear" class="menu_button dc-danger-button">Clear unpinned</button></div></div>
                </div>
            </details>
            <details class="dc-section dc-section-primary" id="dc-page-characters" data-dc-page="characters" data-dc-disclosure="characters" role="tabpanel" aria-labelledby="dc-tab-characters" tabindex="-1" open>
                <summary>Characters</summary>
                <p class="dc-section-note">Use row checkboxes for bulk actions. Keep pins important entries; Edit reveals color, lock, type, aliases, and gradients.</p>
                <div class="dc-stack">
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-search">Search characters</label><input type="search" id="dc-search" placeholder="Search names, aliases, groups…" class="text_pole"><select id="dc-sort" class="text_pole" aria-label="Character sort"><option value="name">Sort: Name</option><option value="count">Sort: Dialogue activity</option><option value="group">Sort: Group</option></select></div>
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-add-name">New character name</label><input type="text" id="dc-add-name" placeholder="Character name" class="text_pole" aria-describedby="dc-add-error"><button id="dc-add-btn" class="menu_button dc-primary-button">Add</button><span id="dc-add-error" class="dc-field-error" aria-live="polite"></span></div>
                    <details class="dc-advanced-add" data-dc-disclosure="characters-advanced">
                        <summary>Advanced</summary>
                        <div class="dc-field-row dc-field-row-wrap" style="margin-top: 6px;">
                            <label class="dc-visually-hidden" for="dc-add-group">Initial group</label><input type="text" id="dc-add-group" placeholder="Initial group (optional)" class="text_pole" list="dc-group-profile-labels" maxlength="80">
                            <button id="dc-card" class="menu_button">Add current card</button>
                            <button id="dc-avatar-color" class="menu_button">Avatar color</button>
                            <button id="dc-add-persona" class="menu_button">Add my persona</button>
                        </div>
                    </details>
                    <small><span id="dc-count">0</span> tracked characters</small>
                    <div id="dc-char-list" class="dc-char-list"></div>
                    <section id="dc-bulk-toolbar" class="dc-bulk-toolbar" aria-label="Selected character actions" hidden>
                        <div class="dc-bulk-toolbar-head">
                            <output id="dc-selection-count" role="status" aria-live="polite">0 selected</output>
                            <div class="dc-bulk-selection-actions"><button type="button" id="dc-select-visible" class="menu_button" aria-controls="dc-char-list">Select visible (0)</button><button type="button" id="dc-clear-selection" class="menu_button" aria-controls="dc-char-list" disabled>Clear selection</button></div>
                        </div>
                        <div class="dc-bulk-actions" role="group" aria-label="Bulk state actions">
                            <label class="dc-visually-hidden" for="dc-bulk-action-select">Bulk action</label><select id="dc-bulk-action-select" class="text_pole" data-dc-selection-required><option value="">Bulk action…</option><option value="lock">Lock</option><option value="unlock">Unlock</option><option value="keep">Keep</option><option value="unkeep">Unkeep</option><option value="randomize">Randomize colors</option><option value="copy">Copy style</option><option value="paste">Paste style</option><option value="delete">Delete</option></select><button type="button" id="dc-bulk-apply-action" class="menu_button" data-dc-selection-required>Apply</button><span id="dc-style-clipboard-status" class="dc-status-text" role="status" aria-live="polite">No style copied</span>
                        </div>
                        <div class="dc-bulk-group-actions" role="group" aria-label="Bulk group actions">
                            <label class="dc-visually-hidden" for="dc-bulk-group-select">Group for selected characters</label><select id="dc-bulk-group-select" class="text_pole" data-dc-selection-required><option value="">Group selected…</option></select><button type="button" id="dc-bulk-set-group" class="menu_button" data-dc-selection-required>Set group</button><button type="button" id="dc-bulk-clear-group" class="menu_button" data-dc-selection-required>Clear group</button>
                        </div>
                        <details class="dc-bulk-style-fields" data-dc-disclosure="characters-bulk-style"><summary>Style fields for copy/paste</summary><div class="dc-bulk-style-options"><label class="checkbox_label"><input type="checkbox" id="dc-bulk-style-primary"><span>Primary color</span></label><label class="checkbox_label"><input type="checkbox" id="dc-bulk-style-gradient" checked><span>Gradient</span></label><label class="checkbox_label"><input type="checkbox" id="dc-bulk-style-font" checked><span>Font</span></label><label class="checkbox_label"><input type="checkbox" id="dc-bulk-style-text" checked><span>Text style</span></label></div></details>
                    </section>
                </div>
            </details>
            <details class="dc-section" id="dc-page-appearance" data-dc-page="appearance" data-dc-disclosure="appearance" role="tabpanel" aria-labelledby="dc-tab-appearance" tabindex="-1">
                <summary>Appearance</summary>
                <div class="dc-stack">
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-theme">Color brightness</label><select id="dc-theme" class="text_pole" data-help="Auto follows the detected chat surface. Forcing a mode sets both the color range and the readability target, ignoring what the page looks like."><option value="auto">Auto (match theme)</option><option value="dark">Bright (for dark themes)</option><option value="light">Dark (for light themes)</option></select></div>
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-palette">New-color palette</label><select id="dc-palette" class="text_pole"></select></div>
                    <div class="dc-field-row"><label class="dc-inline-label" for="dc-brightness">Current color brightness</label><input type="range" id="dc-brightness" min="-100" max="100" value="0"><span id="dc-bright-val" class="dc-inline-value">0</span></div>
                    <small>The value previews while dragging; colors update when released.</small>
                    <div class="dc-appearance-grid">
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-cvd-mode">Color-vision preview</label><select id="dc-cvd-mode" class="text_pole"><option value="none">None</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option><option value="achromatopsia">Achromatopsia</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-cvd-severity">Severity</label><input type="range" id="dc-cvd-severity" min="0" max="100" value="100"><span id="dc-cvd-severity-value" class="dc-inline-value">100%</span></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-cvd-target">Preview target</label><select id="dc-cvd-target" class="text_pole"><option value="all">Extension and chat</option><option value="ui">Extension only</option><option value="chat">Chat and cards only</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-gradient-animation-mode">Gradient motion</label><select id="dc-gradient-animation-mode" class="text_pole"><option value="auto">Auto (visible only)</option><option value="full">Full</option><option value="static">Static</option></select></div>
                    </div>
                    <div id="dc-cvd-preview-status" class="dc-preview-status" role="status" aria-live="polite">Preview off</div>
                    <div class="dc-field-row dc-gradient-seed-control"><label class="dc-inline-label" for="dc-gradient-master-seed">Random gradient seed</label><input id="dc-gradient-master-seed" class="text_pole" type="text" readonly aria-describedby="dc-gradient-seed-note"><button type="button" id="dc-gradient-new-seed" class="menu_button">New seed</button><small id="dc-gradient-seed-note">Changes future deterministic randomizations; current gradients stay unchanged.</small></div>
                    <div class="dc-remote-font-policy"><label class="checkbox_label"><input type="checkbox" id="dc-allow-remote-fonts" aria-describedby="dc-remote-fonts-note"><span>Allow remote Google Fonts</span></label><small id="dc-remote-fonts-note">Off by default. Saved font names always remain; when enabled, only used names can make capped requests to Google. Otherwise, fonts resolve locally.</small></div>
                    <div class="dc-toggle-grid"><label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight dialogue</span></label><label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-recolor"><span>Auto-recolor after changes</span></label><label class="checkbox_label"><input type="checkbox" id="dc-force-bold" data-help="Renders every colored dialogue, narrator and font-tag segment in bold. Per-character italic is kept."><span>Bold all colored text</span></label></div>
                </div>
            </details>
            <details class="dc-section" id="dc-page-engine" data-dc-page="engine" data-dc-disclosure="engine" role="tabpanel" aria-labelledby="dc-tab-engine" tabindex="-1">
                <summary>Engine settings</summary>
                <div class="dc-stack">
                    <div class="dc-llm-only dc-stack">
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-llm-profile">Colorize profile</label><select id="dc-llm-profile" class="text_pole"><option value="">Use main chat AI</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-depth">Prompt depth</label><input type="number" id="dc-prompt-depth" min="0" max="99" value="1" class="text_pole"></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-role">Prompt role</label><select id="dc-prompt-role" class="text_pole"><option value="system">System</option><option value="user">User</option></select></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-prompt-mode">Prompt mode</label><select id="dc-prompt-mode" class="text_pole"><option value="inject">Inject automatically</option><option value="macro">Use macro manually</option></select></div>
                        <label class="checkbox_label"><input type="checkbox" id="dc-auto-prompt-mode" aria-describedby="dc-auto-prompt-mode-note"><span>Switch to macro when detected</span></label><small id="dc-auto-prompt-mode-note">On by default: when <code>{{dialoguecolors}}</code> appears in your preset prompts, system prompt, story string, or author's note, the instructions travel through the macro instead of also being injected. Disabled preset prompts and <code>{{// }}</code> comments do not count.</small>
                        <div id="dc-system-prompt-container" style="display:none;"><label for="dc-system-prompt-text" class="dc-inline-label">Macro text</label><textarea id="dc-system-prompt-text" readonly class="text_pole dc-macro-text">{{dialoguecolors}}</textarea><button id="dc-copy-system-prompt" class="menu_button">Copy macro</button></div>
                    </div>
                    <div class="dc-dom-only dc-stack" style="display:none;">
                        <label class="checkbox_label"><input type="checkbox" id="dc-stealth-colors"><span>Ask for hidden speaker color blocks</span></label><label class="checkbox_label"><input type="checkbox" id="dc-llm-attr-check"><span>Verify attribution automatically</span></label><label class="checkbox_label"><input type="checkbox" id="dc-llm-attr-parallel"><span>Verify during streaming pauses</span></label><label class="checkbox_label"><input type="checkbox" id="dc-attr-accept-all" aria-describedby="dc-attr-review-policy-note"><span>Accept proposed corrections automatically</span></label><small id="dc-attr-review-policy-note">Off by default: verifier suggestions wait for human review. Explicit legacy-auto settings keep this enabled.</small><label class="checkbox_label"><input type="checkbox" id="dc-attr-conservative"><span>Only fill unknown attribution</span></label><label class="checkbox_label"><input type="checkbox" id="dc-mark-uncertain" aria-describedby="dc-mark-uncertain-note"><span>Underline uncertain dialogue</span></label><small id="dc-mark-uncertain-note">Marks locally attributed quotes the heuristics were least sure about with a dotted underline. Right-click a marked quote to reassign it.</small>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-attr-profile">Verify profile</label><select id="dc-attr-profile" class="text_pole"><option value="">Use main chat AI</option></select></div><div class="dc-field-row"><label class="dc-inline-label" for="dc-attr-max-tokens">Verify token limit</label><input type="number" id="dc-attr-max-tokens" min="256" max="32768" value="4096" class="text_pole"></div>
                        <div class="dc-field-row"><label class="dc-inline-label" for="dc-attr-passes">Agreement passes</label><input type="number" id="dc-attr-passes" min="1" max="5" value="1" class="text_pole" aria-describedby="dc-attr-passes-note"></div><small id="dc-attr-passes-note">Verify each message this many times and keep only the corrections most passes agree on. Raise this for fast models that answer differently each run; it multiplies tokens per verification.</small>
                    </div>
                    <section id="dc-narrator-editor" class="dc-narrator-editor" aria-label="Narration style"></section>
                    <div class="dc-field-row dc-field-row-wrap"><label class="dc-inline-label" for="dc-thought-symbols">Thought delimiters</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole"><button id="dc-thought-clear" class="menu_button">Clear</button></div>
                    <div id="dc-prompt-preview" class="dc-prompt-preview"></div>
                </div>
            </details>
            <details class="dc-section" id="dc-page-automation" data-dc-page="automation" data-dc-disclosure="automation" role="tabpanel" aria-labelledby="dc-tab-automation" tabindex="-1">
                <summary>Automation</summary>
                <div class="dc-toggle-grid"><label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Scan when the character list is empty</span></label><label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new"><span>Scan new messages</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-lock"><span>Lock new characters</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-persona" data-help="Adds your active persona to the character list automatically. Your own dialogue is colored locally when your persona has a color, without an LLM call."><span>Add my persona automatically</span></label><label class="checkbox_label"><input type="checkbox" id="dc-keep-persona" data-help="Marks an already tracked active persona as Keep and marks future manual or automatic persona entries as Kept. It does not add a persona or assign a color by itself."><span>Keep my persona entry</span></label><label class="checkbox_label"><input type="checkbox" id="dc-persist-persona-color" data-help="Keeps your persona's color the same in every new chat, even when colors are stored per chat or per card."><span>Keep my persona's color everywhere</span></label><label class="checkbox_label"><input type="checkbox" id="dc-clear-unpinned-new-chat" data-help="Clears the character list when a new chat starts. Only characters marked Keep survive."><span>Clear all but Keep characters on new chat</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-random-gradients"><span>Random gradients for new NPCs</span></label><label class="checkbox_label"><input type="checkbox" id="dc-auto-random-all-gradients"><span>Random gradients for every new character</span></label><label class="checkbox_label"><input type="checkbox" id="dc-drift-all-gradients"><span>Drift every gradient color</span></label><label class="checkbox_label dc-llm-only"><input type="checkbox" id="dc-auto-colorize"><span>Colorize missing tags automatically</span></label><label class="checkbox_label dc-llm-only"><input type="checkbox" id="dc-complete-partial" data-help="When the model colors only some of a message's dialogue, the uncolored lines are attributed and colored locally. No extra LLM request is made."><span>Complete partly colored messages</span></label><label class="checkbox_label"><input type="checkbox" id="dc-right-click"><span>Manual dialogue reassignment</span></label><label class="checkbox_label"><input type="checkbox" id="dc-disable-toasts"><span>Reduce routine notifications</span></label></div>
            </details>
            <details class="dc-section" id="dc-page-library" data-dc-page="library" data-dc-disclosure="library" role="tabpanel" aria-labelledby="dc-tab-library" tabindex="-1">
                <summary>Style library</summary>
                <div class="dc-stack">
                    <details class="dc-subsection" data-dc-disclosure="library-group-profiles" open><summary>Group profiles</summary><div class="dc-group-profile-manager dc-stack"><p class="dc-section-note">Profiles are scoped with the active color table. Applying one copies its selected fields; later profile edits do not change characters.</p><div class="dc-field-row"><label class="dc-inline-label" for="dc-group-profile-name">Group label</label><input type="text" id="dc-group-profile-name" class="text_pole" list="dc-group-profile-labels" maxlength="80" autocomplete="off" placeholder="Choose or enter a group"><datalist id="dc-group-profile-labels"></datalist></div><div class="dc-field-row"><label class="dc-inline-label" for="dc-group-profile-source">Copy style from</label><select id="dc-group-profile-source" class="text_pole"><option value="">Keep saved style</option></select></div><fieldset class="dc-profile-fieldset"><legend>Saved style fields</legend><div class="dc-profile-options"><label class="checkbox_label"><input type="checkbox" id="dc-group-profile-primary"><span>Primary color</span></label><label class="checkbox_label"><input type="checkbox" id="dc-group-profile-gradient" checked><span>Gradient</span></label><label class="checkbox_label"><input type="checkbox" id="dc-group-profile-font" checked><span>Font</span></label><label class="checkbox_label"><input type="checkbox" id="dc-group-profile-text" checked><span>Text style</span></label></div></fieldset><fieldset class="dc-profile-fieldset"><legend>Automation</legend><div class="dc-profile-automation"><label>Style on assignment<select id="dc-group-profile-applyStyleOnAssign" class="text_pole"><option value="null">Default (off)</option><option value="true">On</option><option value="false">Off</option></select></label><label>Style on creation<select id="dc-group-profile-applyStyleOnCreate" class="text_pole"><option value="null">Default (off)</option><option value="true">On</option><option value="false">Off</option></select></label><label>Lock on creation<select id="dc-group-profile-autoLock" class="text_pole"><option value="null">Use global</option><option value="true">On</option><option value="false">Off</option></select></label><label>Random gradient on creation<select id="dc-group-profile-randomGradient" class="text_pole"><option value="null">Use global</option><option value="true">On</option><option value="false">Off</option></select></label></div></fieldset><div class="dc-button-row"><button type="button" id="dc-group-profile-save" class="menu_button">Create profile</button><button type="button" id="dc-group-profile-apply" class="menu_button" disabled>Apply to existing (0)</button><button type="button" id="dc-group-profile-delete" class="menu_button dc-danger-button" disabled>Delete</button></div><div class="dc-field-row"><label class="dc-visually-hidden" for="dc-group-profile-rename">New group label</label><input type="text" id="dc-group-profile-rename" class="text_pole" maxlength="80" placeholder="New group label"><button type="button" id="dc-group-profile-rename-button" class="menu_button" disabled>Rename profile</button></div><span id="dc-group-profile-status" class="dc-status-text" role="status" aria-live="polite">Choose or enter a group label.</span></div></details>
                    <details class="dc-subsection" data-dc-disclosure="library-gradient-presets" open><summary>Gradient presets</summary><div id="dc-gradient-gallery" class="dc-gradient-gallery" aria-label="Gradient preset gallery"></div></details>
                    <details class="dc-subsection" data-dc-disclosure="library-assignment-presets"><summary>Assignment presets</summary><div class="dc-stack"><div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-preset-name">Preset name</label><input type="text" id="dc-preset-name" placeholder="Preset name" class="text_pole"><button id="dc-save-preset" class="menu_button dc-primary-button">Save current</button></div><div class="dc-field-row dc-field-row-wrap"><select id="dc-preset-select" class="text_pole" aria-label="Assignment preset"><option value="">Select preset</option></select><button id="dc-load-preset" class="menu_button">Load</button><button id="dc-delete-preset" class="menu_button dc-danger-button">Delete</button></div></div></details>
                    <details class="dc-subsection" data-dc-disclosure="library-custom-palettes"><summary>Custom palettes</summary><div class="dc-stack"><div class="dc-field-row dc-field-row-wrap"><label class="dc-visually-hidden" for="dc-palette-name-input">Palette name</label><input type="text" id="dc-palette-name-input" placeholder="Palette name" class="text_pole"><label class="dc-visually-hidden" for="dc-palette-notes-input">Palette notes</label><input type="text" id="dc-palette-notes-input" placeholder="Notes or mood words" class="text_pole"></div><label class="checkbox_label"><input type="checkbox" id="dc-overwrite-existing"><span>Allow replacing an existing palette</span></label><div class="dc-button-row"><button id="dc-gen-palette" class="menu_button dc-primary-button">Generate</button><button id="dc-save-palette" class="menu_button">Save current colors</button><button id="dc-del-palette" class="menu_button dc-danger-button">Delete selected</button></div></div></details>
                    <details class="dc-subsection" data-dc-disclosure="library-style-packs"><summary>Style packs</summary><div class="dc-stack dc-style-pack-library"><p class="dc-section-note">Portable format: dialogue-colors-style-pack v1. Builds stay local and import always opens a review.</p><div class="dc-button-row"><button type="button" id="dc-style-pack-export" class="menu_button">Build style pack</button><button type="button" id="dc-style-pack-import" class="menu_button">Import style pack</button></div><input type="file" id="dc-style-pack-file" accept=".json,application/json" hidden><span id="dc-style-pack-status" class="dc-status-text" role="status" aria-live="polite"></span><div id="dc-style-pack-registry" class="dc-style-pack-registry" aria-live="polite"></div></div></details>
                </div>
            </details>
            <details class="dc-section" id="dc-page-storage" data-dc-page="storage" data-dc-disclosure="storage" role="tabpanel" aria-labelledby="dc-tab-storage" tabindex="-1">
                <summary>Storage & transfer</summary>
                <div class="dc-stack">
                    <div class="dc-button-row"><button id="dc-export" class="menu_button">Export colors</button><button id="dc-import" class="menu_button">Import colors</button><button id="dc-export-settings" class="menu_button">Export settings</button><button id="dc-import-settings" class="menu_button">Import settings</button><button id="dc-export-png" class="menu_button">Export legend image</button></div>
                    <input type="file" id="dc-import-file" accept=".json,application/json" hidden><input type="file" id="dc-import-settings-file" accept=".json,application/json" hidden>
                    <div class="dc-button-row"><button id="dc-save-card" class="menu_button">Save to card</button><button id="dc-load-card" class="menu_button">Review card data</button><button id="dc-storage" class="menu_button">Storage manager</button></div>
                    <div class="dc-button-row"><button id="dc-setup-autosync" class="menu_button">Enable auto-sync</button><button id="dc-disable-autosync" class="menu_button" style="display:none;">Disable auto-sync</button></div><span id="dc-autosync-status" class="dc-status-text" role="status" aria-live="polite"></span>
                </div>
            </details>
            <details class="dc-section" id="dc-page-maintenance" data-dc-page="maintenance" data-dc-disclosure="maintenance" role="tabpanel" aria-labelledby="dc-tab-maintenance" tabindex="-1">
                <summary>Maintenance</summary>
                <div class="dc-stack"><div class="dc-button-row"><button id="dc-undo" class="menu_button">Undo</button><button id="dc-redo" class="menu_button">Redo</button><button id="dc-fix-conflicts" class="menu_button">Check color conflicts</button></div><div class="dc-button-row"><button id="dc-regen" class="menu_button">Regenerate unlocked</button><button id="dc-rerandom-gradients" class="menu_button">Re-randomize gradients</button><button id="dc-flip-theme" class="menu_button">Flip for theme</button><button id="dc-restore-defaults" class="menu_button dc-danger-button">Restore setting defaults</button></div></div>
            </details>
            <details class="dc-section dc-danger-zone" id="dc-page-danger" data-dc-page="danger" data-dc-disclosure="danger" role="tabpanel" aria-labelledby="dc-tab-danger" tabindex="-1">
                <summary>Danger zone</summary>
                <p class="dc-section-note">Deletion tools review the target count first and always skip pinned characters.</p>
                <div class="dc-stack">
                    <div class="dc-button-row"><button id="dc-lock-all" class="menu_button">Lock all</button><button id="dc-unlock-all" class="menu_button">Unlock all</button><button id="dc-reset" class="menu_button dc-danger-button">Reset unlocked colors</button></div>
                    <div class="dc-button-row"><button id="dc-del-locked" class="menu_button dc-danger-button">Delete locked</button><button id="dc-del-unlocked" class="menu_button dc-danger-button">Delete unlocked</button></div>
                    <div class="dc-field-row dc-field-row-wrap"><label for="dc-del-least-threshold">Minimum lines to keep</label><input type="number" id="dc-del-least-threshold" min="0" value="3" class="text_pole"><button id="dc-del-least" class="menu_button dc-danger-button">Delete below threshold</button></div>
                    <button id="dc-del-dupes" class="menu_button dc-danger-button">Delete duplicate colors</button>
                </div>
            </details>
        </div>
    </div>`;
}

const FOCUSABLE_PAGE_SELECTOR = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

// Which panel drawers the user left open. This is per-browser UI state, so it
// lives in localStorage rather than in settings: exports, style packs, and
// auto-sync deliberately carry no UI positions.
const PANEL_DISCLOSURE_KEY = 'dc_panel_disclosure_v1';

// Sections that are open on a fresh install. Everything else starts closed so
// the panel opens short rather than as one long wall of controls.
const DEFAULT_OPEN_DISCLOSURES = Object.freeze([
    'setup', 'process', 'characters', 'library-group-profiles', 'library-gradient-presets',
]);

let panelDisclosureState = null;

function readPanelDisclosureState() {
    if (panelDisclosureState) return panelDisclosureState;
    panelDisclosureState = {};
    try {
        const parsed = JSON.parse(localStorage.getItem(PANEL_DISCLOSURE_KEY) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === 'boolean') panelDisclosureState[key] = value;
            }
        }
    } catch {
        // Unreadable or corrupt state just means defaults for this session.
    }
    return panelDisclosureState;
}

function writePanelDisclosureState() {
    try {
        localStorage.setItem(PANEL_DISCLOSURE_KEY, JSON.stringify(panelDisclosureState || {}));
    } catch {
        // The in-memory state still holds for this session when storage is full
        // or blocked; losing it on reload is better than breaking the toggle.
    }
}

function isDisclosureOpenByDefault(id) {
    return DEFAULT_OPEN_DISCLOSURES.includes(id);
}

export function applyPanelDisclosureState(root = document) {
    const saved = readPanelDisclosureState();
    for (const element of root.querySelectorAll('[data-dc-disclosure]')) {
        const id = element.dataset.dcDisclosure;
        const open = Object.prototype.hasOwnProperty.call(saved, id) ? saved[id] : isDisclosureOpenByDefault(id);
        element.open = open;
    }
}

function bindPanelDisclosurePersistence(panel) {
    // `toggle` does not bubble, so capture it instead of delegating.
    panel.addEventListener('toggle', e => {
        const element = e.target;
        const id = element?.dataset?.dcDisclosure;
        if (!id) return;
        // Fullscreen forces the selected section open and the rest hidden; that
        // is navigation, not the user collapsing a drawer, so it must not
        // overwrite what they chose in the tab.
        if (isSettingsFullscreen() && element.hasAttribute('data-dc-page')) return;
        const saved = readPanelDisclosureState();
        if (saved[id] === element.open) return;
        saved[id] = element.open;
        writePanelDisclosureState();
    }, true);
}

// The panel lives in SillyTavern's extensions tab and flows at its natural
// height there, so the tab is the only scroller. Fullscreen is an opt-in mode
// on the same element: it fixes the panel to the viewport and swaps the
// stacked accordions for the section nav, which only earns its space once
// there is space to earn.
let activeSettingsPageSlug = DEFAULT_SETTINGS_PAGE_SLUG;
let fullscreenOpener = null;

function getSettingsPageTabs() {
    return Array.from(document.querySelectorAll('#dc-page-nav .dc-page-tab'));
}

export function isSettingsFullscreen() {
    return document.getElementById('dc-ext')?.classList.contains('dc-fullscreen') === true;
}

export function showSettingsPageSection(slug, { focusTab = false } = {}) {
    const target = SETTINGS_PAGE_SECTIONS.some(section => section.slug === slug) ? slug : DEFAULT_SETTINGS_PAGE_SLUG;
    activeSettingsPageSlug = target;
    const fullscreen = isSettingsFullscreen();
    for (const tab of getSettingsPageTabs()) {
        const selected = tab.dataset.dcTab === target;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        // Roving tabindex: only the selected tab is in the tab order, so Tab
        // leaves the nav instead of walking ten buttons.
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focusTab) tab.focus();
    }
    for (const section of document.querySelectorAll('#dc-panel-content > [data-dc-page]')) {
        // Drawer mode is a plain accordion list: every section stays in the
        // flow and keeps its own summary. Only fullscreen hides the inactive
        // ones, because only fullscreen has a nav to reach them again.
        section.toggleAttribute('hidden', fullscreen && section.dataset.dcPage !== target);
        if (fullscreen && section.dataset.dcPage === target) section.setAttribute('open', '');
    }
    if (fullscreen) {
        const content = document.getElementById('dc-panel-content');
        if (content) {
            content.scrollTop = 0;
            content.scrollLeft = 0;
        }
    }
}

function moveSettingsPageSelection(step) {
    const index = SETTINGS_PAGE_SECTIONS.findIndex(section => section.slug === activeSettingsPageSlug);
    const count = SETTINGS_PAGE_SECTIONS.length;
    const next = (((index < 0 ? 0 : index) + step) % count + count) % count;
    showSettingsPageSection(SETTINGS_PAGE_SECTIONS[next].slug, { focusTab: true });
}

export function enterSettingsFullscreen(opener = document.activeElement) {
    const panel = document.getElementById('dc-ext');
    const toggle = document.getElementById('dc-fullscreen-toggle');
    if (!panel || panel.classList.contains('dc-fullscreen')) return;
    fullscreenOpener = opener instanceof HTMLElement ? opener : null;
    panel.classList.add('dc-fullscreen');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Dialogue Colors settings');
    document.body.classList.add('dc-fullscreen-open');
    toggle?.setAttribute('aria-pressed', 'true');
    showSettingsPageSection(activeSettingsPageSlug);
    document.querySelector('#dc-page-nav .dc-page-tab[aria-selected="true"]')?.focus();
}

export function exitSettingsFullscreen() {
    const panel = document.getElementById('dc-ext');
    const toggle = document.getElementById('dc-fullscreen-toggle');
    if (!panel || !panel.classList.contains('dc-fullscreen')) return;
    panel.classList.remove('dc-fullscreen');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-label');
    document.body.classList.remove('dc-fullscreen-open');
    toggle?.setAttribute('aria-pressed', 'false');
    // Reveal every section again before focus moves, so the accordion list is
    // whole the moment the panel is back in the tab, then hand the sections
    // back the open/closed state the user actually chose.
    showSettingsPageSection(activeSettingsPageSlug);
    applyPanelDisclosureState(panel);
    const opener = fullscreenOpener?.isConnected ? fullscreenOpener : toggle;
    fullscreenOpener = null;
    if (opener?.offsetParent) opener.focus();
}

export function toggleSettingsFullscreen(opener) {
    if (isSettingsFullscreen()) exitSettingsFullscreen();
    else enterSettingsFullscreen(opener);
}

// SillyTavern's own drawer handler animates the panel but never reports its
// state, so mirror it onto the toggle for assistive technology and suppress
// scroll anchoring on the host tab while the height changes.
function bindSettingsDrawerState(panel) {
    const drawerToggle = panel.querySelector(':scope > .inline-drawer-toggle');
    const content = panel.querySelector(':scope > .dc-panel-content');
    if (!drawerToggle || !content) return;

    // Resolved on demand rather than hardcoded to #rm_extensions_block. Hosts
    // relocate the extensions container: SillyBunny embeds it in its settings
    // shell, where #rm_extensions_block is a plain `overflow: visible` wrapper
    // and the real scroller is an ancestor of it. Suppressing anchoring on the
    // wrapper did nothing, which is how a tall panel could still yank the tab.
    let cachedScroller = null;
    const getHostScroller = () => {
        if (cachedScroller?.isConnected && cachedScroller.contains(panel)) return cachedScroller;
        cachedScroller = findScrollableAncestor(panel);
        return cachedScroller;
    };

    const isExpanded = () => !content.hidden
        && content.getAttribute('aria-hidden') !== 'true'
        && getComputedStyle(content).display !== 'none';
    const sync = () => {
        const expanded = isSettingsFullscreen() || isExpanded();
        drawerToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        getHostScroller()?.classList.toggle('dc-dialogue-colors-expanded', expanded);
    };

    drawerToggle.addEventListener('click', () => {
        // Runs before SillyTavern starts slideToggle, so anchoring is already
        // suppressed by the time the height starts moving.
        getHostScroller()?.classList.add('dc-dialogue-colors-expanded');
        requestAnimationFrame(sync);
    });
    if (typeof MutationObserver === 'function') {
        new MutationObserver(sync).observe(content, {
            attributes: true,
            attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
        });
    }
    sync();
}

/**
 * Re-assert the host scroller's offset when the extensions page comes back.
 *
 * iOS gives that scroller `-webkit-overflow-scrolling: touch`, and a momentum
 * container that is display:none'd and shown again loses its offset, landing
 * at the bottom when the content is tall. Our panel is only tall while its
 * drawer is open, which is exactly when the jump was reported and why a closed
 * drawer looked fine. The property is inert off iOS, so on every other engine
 * this restores the value the scroller already had.
 */
function bindHostScrollStability(panel) {
    if (typeof ResizeObserver !== 'function') return;
    let scroller = null;
    let savedScrollTop = 0;
    const isRendered = () => panel.getClientRects().length > 0;

    function onScroll() {
        // Only trust offsets observed while the page is actually on screen; a
        // scrambled offset from a hidden container must not be recorded.
        if (scroller && isRendered()) savedScrollTop = scroller.scrollTop;
    }

    const resolveScroller = () => {
        if (scroller?.isConnected && scroller.contains(panel)) return scroller;
        scroller?.removeEventListener('scroll', onScroll);
        scroller = findScrollableAncestor(panel);
        scroller?.addEventListener('scroll', onScroll, { passive: true });
        return scroller;
    };

    let wasRendered = isRendered();
    new ResizeObserver(() => {
        const rendered = isRendered();
        if (rendered && !wasRendered) {
            const host = resolveScroller();
            if (host) {
                const target = Math.min(savedScrollTop, Math.max(0, host.scrollHeight - host.clientHeight));
                host.scrollTop = target;
                // The offset can be clobbered again once momentum scrolling is
                // re-armed, so re-assert after the frame the show happened in.
                requestAnimationFrame(() => {
                    if (host.isConnected && isRendered()) host.scrollTop = target;
                });
            }
        }
        wasRendered = rendered;
    }).observe(panel);

    resolveScroller();
}

function bindSettingsPage() {
    const panel = document.getElementById('dc-ext');
    const nav = document.getElementById('dc-page-nav');
    const toggle = document.getElementById('dc-fullscreen-toggle');
    if (!panel || !nav || !toggle) return;

    bindSettingsDrawerState(panel);
    bindHostScrollStability(panel);
    bindPanelDisclosurePersistence(panel);
    applyPanelDisclosureState(panel);
    toggle.addEventListener('click', () => toggleSettingsFullscreen(toggle));

    nav.addEventListener('click', e => {
        // No focusTab here: the click already focuses the button, and forcing
        // it again makes the browser treat it as keyboard focus and paint a
        // focus ring on a plain mouse click.
        const tab = e.target.closest?.('.dc-page-tab');
        if (tab) showSettingsPageSection(tab.dataset.dcTab);
    });

    nav.addEventListener('keydown', e => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (e.key in keys) {
            e.preventDefault();
            moveSettingsPageSelection(keys[e.key]);
            return;
        }
        if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const section = e.key === 'Home'
                ? SETTINGS_PAGE_SECTIONS[0]
                : SETTINGS_PAGE_SECTIONS[SETTINGS_PAGE_SECTIONS.length - 1];
            showSettingsPageSection(section.slug, { focusTab: true });
        }
    });

    panel.addEventListener('keydown', e => {
        if (!isSettingsFullscreen()) return;
        if (e.key === 'Escape' && !e.defaultPrevented) {
            // Let a dialog, popup, or open dropdown inside the panel consume
            // Escape first; only leave fullscreen when nothing else claimed it.
            if (document.activeElement?.closest('.dc-dialog, dialog[open]')) return;
            e.preventDefault();
            exitSettingsFullscreen();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusable = Array.from(panel.querySelectorAll(FOCUSABLE_PAGE_SELECTOR))
            .filter(el => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
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
    });

    showSettingsPageSection(DEFAULT_SETTINGS_PAGE_SLUG);
}

function bindSettingsPanelControls($) {
    $('dc-enabled').onchange = e => {
        settings.enabled = e.target.checked;
        synchronizeEnabledLifecycle();
        saveData();
        syncProcessControlState();
    };
    $('dc-highlight').onchange = e => {
        applyThemeOrBrightnessChange(() => { settings.highlightMode = e.target.checked; }, { saveImmediately: true });
        renderNarratorEditor();
        updateLegend();
        injectPrompt();
        scheduleDomRefreshSeries(0);
    };
    $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
    $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
    $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
    $('dc-auto-persona').onchange = e => {
        settings.autoPersonaCharacter = e.target.checked;
        saveData();
        if (e.target.checked) ensurePersonaCharacter({ silent: true });
        updateCharList();
    };
    $('dc-keep-persona').onchange = e => {
        settings.keepPersonaCharacter = e.target.checked;
        markCurrentPersonaKept();
        saveData();
        updateCharList();
    };
    $('dc-persist-persona-color').onchange = e => {
        settings.persistPersonaColor = e.target.checked;
        // Pin whatever the persona looks like right now, so enabling the option keeps the
        // color the user is already seeing instead of waiting for the next edit.
        if (e.target.checked) pinCurrentPersonaColor();
        saveData();
    };
    $('dc-clear-unpinned-new-chat').onchange = e => { settings.clearUnpinnedOnNewChat = e.target.checked; saveData(); };
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
        renderNarratorEditor();
        repaintDomAfterCharacterDataChange(0);
    };
    $('dc-force-bold').onchange = e => {
        settings.forceBoldText = e.target.checked;
        saveData();
        updateLegend();
        renderNarratorEditor();
        scheduleDomRefreshSeries(0);
        scheduleCustomFontRefresh(0);
    };
    $('dc-allow-remote-fonts').onchange = e => {
        const enabled = e.target.checked === true;
        settings.allowRemoteFonts = enabled;
        saveData({ preserveEffectiveColors: true });
        syncRemoteFontLoadingPolicy();
        if (enabled) {
            updateCharList();
            updateLegend();
            scheduleCustomFontRefresh(0);
        }
    };
    $('dc-auto-recolor').onchange = e => { settings.autoRecolor = e.target.checked; saveData(); };
    $('dc-auto-colorize').onchange = e => { settings.autoColorize = e.target.checked; saveData(); };
    $('dc-complete-partial').onchange = e => { settings.completePartialColorize = e.target.checked; saveData(); };
    $('dc-llm-attr-check').onchange = e => {
        settings.llmAttributionCheck = e.target.checked;
        if (settings.llmAttributionCheck) queueAutoAttributionVerificationForRenderedMessages({ force: true, includeLoaded: true, delay: 0 });
        else if (!settings.llmAttributionParallel) clearAutoAttributionVerificationQueue({ clearCooldown: true });
        saveData();
    };
    $('dc-llm-attr-parallel').onchange = e => {
        settings.llmAttributionParallel = e.target.checked;
        if (settings.llmAttributionParallel) queueAutoAttributionVerificationForRenderedMessages({ force: true, includeLoaded: true, delay: 0 });
        else {
            cancelStreamingAttributionVerification({ clearOverrides: true });
            if (!settings.llmAttributionCheck) clearAutoAttributionVerificationQueue({ clearCooldown: true });
            scheduleDomRefreshSeries(0);
        }
        saveData();
    };
    if ($('dc-attr-accept-all')) {
        $('dc-attr-accept-all').onchange = e => {
            settings.attributionReviewPolicy = e.target.checked ? 'legacy-auto' : 'review';
            if (settings.attributionReviewPolicy === 'legacy-auto' && settings.llmAttributionCheck) {
                queueAutoAttributionVerificationForRenderedMessages({ force: true, includeLoaded: true, delay: 0 });
            }
            saveData();
        };
    }
    $('dc-attr-conservative').onchange = e => { settings.attributionConservativeOnly = e.target.checked; saveData(); };
    $('dc-attr-max-tokens').oninput = e => {
        // Clamp to the input's declared range; sub-minimum values truncate the
        // verifier's JSON output and make every verification fail parsing.
        const parsed = parseInt(e.target.value, 10);
        settings.attributionMaxTokens = Number.isNaN(parsed) ? 4096 : Math.min(32768, Math.max(256, parsed));
        saveData();
    };
    $('dc-attr-passes').oninput = e => {
        const parsed = parseInt(e.target.value, 10);
        settings.attributionVerifyPasses = Number.isNaN(parsed) ? 1 : Math.min(5, Math.max(1, parsed));
        saveData();
    };
    $('dc-stealth-colors').onchange = e => { settings.domStealthColors = e.target.checked; saveData(); injectPrompt(); };
    $('dc-mark-uncertain').onchange = e => {
        settings.markUncertainDialogue = e.target.checked;
        document.body.classList.toggle('dc-mark-uncertain', e.target.checked);
        saveData();
    };
    $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
    $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
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
            scheduleDomRefreshSeries(0);
            scheduleCustomFontRefresh(0);
        }
    };
    $('dc-llm-profile').onchange = e => { settings.llmConnectionProfile = e.target.value || null; saveData(); };
    $('dc-attr-profile').onchange = e => { settings.attributionConnectionProfile = e.target.value || null; saveData(); };
    $('dc-theme').onchange = e => {
        applyThemeOrBrightnessChange(() => { settings.themeMode = e.target.value; }, { saveImmediately: true });
        updateCharList(); renderNarratorEditor(); injectPrompt(); flushChatSave();
    };
    $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); injectPrompt(); };
    $('dc-brightness').oninput = e => {
        const brightness = parseInt(e.target.value, 10) || 0;
        $('dc-bright-val').textContent = String(brightness);
    };
    $('dc-brightness').onchange = e => {
        const brightness = parseInt(e.target.value, 10) || 0;
        applyThemeOrBrightnessChange(() => { settings.brightness = brightness; }, { saveImmediately: true });
        renderNarratorEditor();
        flushColorStateSave();
        flushChatSave();
    };
    $('dc-cvd-mode').onchange = e => {
        settings.colorVisionPreviewMode = e.target.value;
        saveData({ preserveEffectiveColors: true });
        refreshColorVisionPreview();
    };
    $('dc-cvd-severity').oninput = e => {
        $('dc-cvd-severity-value').textContent = `${Math.max(0, Math.min(100, Number(e.target.value) || 0))}%`;
    };
    $('dc-cvd-severity').onchange = e => {
        settings.colorVisionPreviewSeverity = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
        saveData({ preserveEffectiveColors: true });
        refreshColorVisionPreview();
    };
    $('dc-cvd-target').onchange = e => {
        settings.colorVisionPreviewTarget = e.target.value;
        saveData({ preserveEffectiveColors: true });
        refreshColorVisionPreview();
    };
    $('dc-gradient-animation-mode').onchange = e => {
        setGradientAnimationMode(e.target.value);
        saveData({ preserveEffectiveColors: true });
        renderNarratorEditor();
    };
    $('dc-gradient-new-seed').onclick = async e => {
        const binding = captureUiMutationContext();
        const reviewedState = JSON.stringify([
            characterColors,
            settings.gradientRandomMasterSeed,
            settings.narratorStyle,
        ]);
        const confirmed = await confirmReviewedAction({
            title: 'Start a new gradient sequence?',
            description: 'Existing gradients stay exactly as shown. Their generator links are cleared, and each future randomization starts at variation 0 using a new master seed.',
            confirmLabel: 'Use new seed',
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiMutationContextCurrent(binding)
            || JSON.stringify([
                characterColors,
                settings.gradientRandomMasterSeed,
                settings.narratorStyle,
            ]) !== reviewedState) {
            notifyUiContextChanged('The active color table or gradient state changed. Review the new seed again.');
            return;
        }
        settings.gradientRandomMasterSeed = createGradientRandomMasterSeed();
        Object.values(characterColors).forEach(entry => { entry.gradientGenerator = null; });
        setNarratorStyle(settings, { ...normalizeNarratorStyle(settings.narratorStyle, { legacy: settings }), gradientGenerator: null }, applyThemeReadabilityAndBrightness);
        saveHistory();
        saveData({ preserveEffectiveColors: true });
        $('dc-gradient-master-seed').value = settings.gradientRandomMasterSeed;
        updateCharList();
        renderNarratorEditor();
        toast.success('New deterministic gradient seed is active.');
    };
    $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
    $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
    $('dc-prompt-depth').oninput = e => {
        // Typing bypasses the input's min/max, and the depth goes straight to
        // setExtensionPrompt, so clamp to the declared range here as well.
        const parsed = parseInt(e.target.value, 10);
        settings.promptDepth = Number.isNaN(parsed) ? 0 : Math.min(99, Math.max(0, parsed));
        saveData();
        injectPrompt();
    };
    $('dc-prompt-role').onchange = e => { settings.promptRole = e.target.value; saveData(); injectPrompt(); };
    $('dc-prompt-mode').onchange = e => { settings.promptMode = e.target.value; saveData(); injectPrompt(); };
    $('dc-auto-prompt-mode').onchange = e => { settings.autoPromptMode = e.target.checked; saveData(); injectPrompt(); };
    $('dc-copy-system-prompt').onclick = () => {
        const textarea = $('dc-system-prompt-text');
        if (!textarea) return;
        textarea.select();
        document.execCommand('copy');
        $('dc-copy-system-prompt').textContent = 'Copied!';
        setTimeout(() => { $('dc-copy-system-prompt').textContent = 'Copy macro'; }, 1500);
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
    $('dc-select-visible').onclick = () => {
        selectCharacterKeys(getVisibleCharacterEntries().map(([key]) => key));
        updateCharList();
        $('dc-clear-selection').focus({ preventScroll: true });
    };
    $('dc-clear-selection').onclick = () => {
        clearCharacterSelection();
        updateCharList();
        $('dc-select-visible').focus({ preventScroll: true });
    };
    $('dc-bulk-apply-action').onclick = e => {
        const action = $('dc-bulk-action-select')?.value;
        if (!action) {
            toast.info('Choose a bulk action first.');
            return;
        }
        if (action === 'lock') {
            runSelectedCharacterMutation(keys => setCharacterLock(keys, true), {
                noChangeMessage: 'All selected characters are already locked.',
                successMessage: result => `Locked ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
            });
        } else if (action === 'unlock') {
            runSelectedCharacterMutation(keys => setCharacterLock(keys, false), {
                noChangeMessage: 'All selected characters are already unlocked.',
                successMessage: result => `Unlocked ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
            });
        } else if (action === 'keep') {
            runSelectedCharacterMutation(keys => setCharacterKeep(keys, true), {
                noChangeMessage: 'All selected characters are already kept.',
                successMessage: result => `Kept ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
            });
        } else if (action === 'unkeep') {
            runSelectedCharacterMutation(keys => setCharacterKeep(keys, false), {
                noChangeMessage: 'All selected characters are already unkept.',
                successMessage: result => `Unkept ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
            });
        } else if (action === 'randomize') {
            runSelectedCharacterMutation(randomizeCharacterColors, {
                noChangeMessage: 'No selected colors changed. Locked characters were skipped.',
                successMessage: result => `Randomized ${result.changedKeys.length} unlocked color${result.changedKeys.length === 1 ? '' : 's'}${result.skippedLockedKeys.length ? `; skipped ${result.skippedLockedKeys.length} locked` : ''}.`,
            });
        } else if (action === 'delete') {
            deleteSelectedCharacters(e.currentTarget);
        } else if (action === 'copy') {
            const selectedKeys = getSelectedCharacterKeys();
            if (selectedKeys.length !== 1) { toast.info('Select exactly one character to copy a style.'); return; }
            const fieldMask = getBulkStyleFieldMask();
            if (!fieldMask) { toast.info('Choose at least one style field.'); return; }
            const copied = copyCharacterStyle(selectedKeys[0], fieldMask);
            if (!copied) return;
            copiedGradientGenerator = fieldMask & CHARACTER_STYLE_FIELD_MASKS.GRADIENT
                ? normalizeEntryGradientGenerator(characterColors[selectedKeys[0]]?.gradientGenerator, characterColors[selectedKeys[0]]?.gradient)
                : null;
            updateBulkToolbar();
            toast.success(`Copied style from ${escapeHtml(copied.sourceName)}.`);
        } else if (action === 'paste') {
            const fieldMask = getBulkStyleFieldMask();
            if (!fieldMask) { toast.info('Choose at least one paste field.'); return; }
            runSelectedCharacterMutation(keys => {
                const result = pasteCharacterStyle(keys, fieldMask);
                if (!(fieldMask & CHARACTER_STYLE_FIELD_MASKS.GRADIENT)) return result;
                const changedKeys = new Set(result.changedKeys || []);
                keys.forEach(key => {
                    const entry = characterColors[key];
                    if (!entry) return;
                    const nextGenerator = copiedGradientGenerator ? { ...copiedGradientGenerator } : null;
                    if (JSON.stringify(entry.gradientGenerator ?? null) === JSON.stringify(nextGenerator)) return;
                    entry.gradientGenerator = nextGenerator;
                    changedKeys.add(key);
                });
                return { ...result, changedKeys: [...changedKeys] };
            }, {
                noChangeMessage: 'The selected characters already match the copied style fields.',
                successMessage: result => `Pasted style to ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
            });
        }
    };
    const setSelectedGroup = () => {
        const group = readValidatedGroupInput($('dc-bulk-group-select'));
        if (group === null) return;
        if (!group) { toast.info('Choose a group label, or use Clear group.'); return; }
        runSelectedCharacterMutation(keys => setCharacterGroup(keys, group), {
            noChangeMessage: 'All selected characters already use that group.',
            successMessage: result => `Set group for ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}${result.profileAppliedKeys.length ? `; applied its profile to ${result.profileAppliedKeys.length}` : ''}.`,
        });
    };
    $('dc-bulk-set-group').onclick = setSelectedGroup;
    $('dc-bulk-clear-group').onclick = () => runSelectedCharacterMutation(keys => setCharacterGroup(keys, ''), {
        noChangeMessage: 'The selected characters do not have a group.',
        successMessage: result => `Cleared group for ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}.`,
    });
    ['dc-bulk-style-primary', 'dc-bulk-style-gradient', 'dc-bulk-style-font', 'dc-bulk-style-text'].forEach(id => {
        $(id).onchange = () => updateBulkToolbar();
    });
    $('dc-stats').onclick = showStatsPopup;
    // Deliberately not dc-llm-only: a chat damaged while the LLM engine was selected stays
    // damaged after switching to the DOM engine, so the button has to be reachable in both.
    $('dc-repair-tool-calls').onclick = async e => {
        const button = e.currentTarget;
        button.disabled = true;
        try {
            await applyToolCallMessageRepair();
        } catch (error) {
            console.error('[Dialogue Colors] Tool-call repair failed:', error);
            toast.error('Could not repair tool-call messages. See the browser console for details.');
        } finally {
            button.disabled = false;
        }
    };
    $('dc-recolor').onclick = async e => {
        if (isDomEngine()) { scheduleDomRefreshSeries(0); scheduleCustomFontRefresh(0); return; }
        const chatBinding = captureChatBinding();
        const confirmed = await confirmReviewedAction({
            title: 'Recolor the entire chat?',
            description: 'Existing saved font-color tags will be rewritten to match current assignments. Message wording is not changed.',
            confirmLabel: 'Recolor entire chat',
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiChatBindingCurrent(chatBinding) || isDomEngine()) {
            notifyUiContextChanged('The active chat or color engine changed. Review recoloring again.');
            return;
        }
        recolorAllMessages();
    };
    $('dc-colorize').onclick = async e => {
        const target = $('dc-colorize-target').value === 'all' ? 'all' : 'last';
        if (target === 'last') { colorizeMessages('last'); return; }
        const chatBinding = captureChatBinding();
        const confirmed = await confirmReviewedAction({
            title: 'Colorize missing dialogue across the chat?',
            description: 'Font-color tags will be added only to dialogue that is currently uncolored.',
            confirmLabel: 'Colorize entire chat',
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiChatBindingCurrent(chatBinding) || isDomEngine()) {
            notifyUiContextChanged('The active chat or color engine changed. Review colorization again.');
            return;
        }
        colorizeMessages('all');
    };
    $('dc-verify-attr').onclick = () => {
        const target = $('dc-verify-target').value;
        const verify = target === 'visible' ? verifyVisibleAttributionsWithLLM : verifyLatestAttributionsWithLLM;
        runAttributionVerification(() => verify({ manual: true }), { manual: true });
    };
    $('dc-review-attr').onclick = e => { void showAttributionReviewDialog(e.currentTarget); };
    $('dc-fix-conflicts').onclick = () => { void showColorConflictReport(); };
    $('dc-regen').onclick = async e => {
        const unlockedCount = Object.values(characterColors).filter(entry => !entry.locked).length;
        if (!unlockedCount) { toast.info('No unlocked colors to regenerate'); return; }
        const binding = captureUiMutationContext();
        const reviewedTable = JSON.stringify(characterColors);
        const confirmed = await confirmReviewedAction({
            title: 'Regenerate unlocked colors?',
            description: `${unlockedCount} character color${unlockedCount === 1 ? '' : 's'} will change. Locked colors remain unchanged.`,
            confirmLabel: 'Regenerate colors',
            danger: true,
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiMutationContextCurrent(binding) || JSON.stringify(characterColors) !== reviewedTable) {
            return notifyUiContextChanged('The active color table changed. Review regeneration again.');
        }
        regenerateAllColors();
    };
    $('dc-rerandom-gradients').onclick = async e => {
        const targetCount = Object.values(characterColors).filter(entry => entry.gradient && !entry.locked).length;
        if (!targetCount) { toast.info('No unlocked gradients to re-randomize'); return; }
        const binding = captureUiMutationContext();
        const reviewedTable = JSON.stringify(characterColors);
        const confirmed = await confirmReviewedAction({
            title: 'Re-randomize gradients?',
            description: `${targetCount} gradient${targetCount === 1 ? '' : 's'} will change. Locked characters and characters without a gradient are skipped.`,
            confirmLabel: 'Re-randomize gradients',
            danger: true,
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiMutationContextCurrent(binding) || JSON.stringify(characterColors) !== reviewedTable) {
            return notifyUiContextChanged('The active color table changed. Review gradient randomization again.');
        }
        regenerateAllGradients();
        updateCharList();
        repaintDomAfterCharacterDataChange(0);
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
    $('dc-group-profile-name').onchange = syncGroupProfileEditor;
    $('dc-group-profile-save').onclick = saveGroupProfileFromEditor;
    $('dc-group-profile-rename-button').onclick = renameGroupProfileFromEditor;
    $('dc-group-profile-delete').onclick = e => { deleteGroupProfileFromEditor(e.currentTarget); };
    $('dc-group-profile-apply').onclick = e => { applyGroupProfileToExisting(e.currentTarget); };
    $('dc-group-profile-rename').onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        renameGroupProfileFromEditor();
    };
    $('dc-save-preset').onclick = async e => {
        // Resolved, not raw: storage normalizes the name, so testing the raw input
        // would miss an overwrite whenever normalization changes it.
        const name = resolveColorPresetName($('dc-preset-name').value);
        const presets = getPresets();
        if (name && Object.prototype.hasOwnProperty.call(presets, name)) {
            const binding = captureUiMutationContext();
            const reviewedTable = JSON.stringify([characterColors, groupProfiles]);
            const reviewedPreset = JSON.stringify(presets[name]);
            const replace = await confirmReviewedAction({
                title: 'Replace assignment preset?',
                description: `“${name}” already exists. Its saved character assignments will be replaced.`,
                confirmLabel: 'Replace preset',
                danger: true,
                opener: e.currentTarget,
            });
            if (!replace) return;
            if (!isUiMutationContextCurrent(binding)
                || resolveColorPresetName($('dc-preset-name').value) !== name
                || JSON.stringify([characterColors, groupProfiles]) !== reviewedTable
                || JSON.stringify(getPresets()[name] ?? null) !== reviewedPreset) {
                return notifyUiContextChanged('The preset name, active color table, or saved preset changed. Review replacement again.');
            }
        }
        saveColorPreset();
    };
    $('dc-load-preset').onclick = loadColorPreset;
    $('dc-delete-preset').onclick = async e => {
        const name = $('dc-preset-select').value;
        if (!name) { toast.warning('Select a preset first.'); return; }
        const binding = captureUiMutationContext();
        const reviewedPreset = JSON.stringify(getPresets()[name] ?? null);
        if (!await confirmReviewedAction({ title: 'Delete assignment preset?', description: `“${name}” will be removed. Character assignments are not changed.`, confirmLabel: 'Delete preset', danger: true, opener: e.currentTarget })) return;
        if (!isUiMutationContextCurrent(binding)
            || $('dc-preset-select').value !== name
            || JSON.stringify(getPresets()[name] ?? null) !== reviewedPreset) {
            notifyUiContextChanged('The active target or assignment preset changed. Review the deletion again.');
            return;
        }
        deleteColorPreset(name);
    };
    $('dc-gen-palette').onclick = async () => { await generateCustomPaletteFromWords(); };
    $('dc-save-palette').onclick = saveCustomPalette;
    $('dc-palette-name-input').onkeypress = e => { if (e.key === 'Enter') $('dc-gen-palette').click(); };
    $('dc-palette-notes-input').onkeypress = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('dc-gen-palette').click(); };
    $('dc-del-palette').onclick = async e => {
        const value = $('dc-palette').value;
        if (!value?.startsWith('custom:')) { toast.warning('Select a custom palette in Appearance first.'); return; }
        const name = value.slice(7);
        const binding = captureUiMutationContext();
        const reviewedPalette = JSON.stringify(getCustomPalettes()[name] ?? null);
        if (!await confirmReviewedAction({ title: 'Delete custom palette?', description: `“${name}” will be removed. Existing character colors are not changed.`, confirmLabel: 'Delete palette', danger: true, opener: e.currentTarget })) return;
        if (!isUiMutationContextCurrent(binding)
            || $('dc-palette').value !== value
            || JSON.stringify(getCustomPalettes()[name] ?? null) !== reviewedPalette) {
            notifyUiContextChanged('The active target or custom palette changed. Review the deletion again.');
            return;
        }
        deleteCustomPalette(name);
    };
    $('dc-style-pack-export').onclick = e => { void buildStylePackExport(e.currentTarget); };
    $('dc-style-pack-import').onclick = () => $('dc-style-pack-file').click();
    $('dc-style-pack-file').onchange = async e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (Number.isFinite(file.size) && file.size > STYLE_PACK_FILE_LIMIT) {
            announceStylePack('Style packs are limited to 1 MiB. The file was not read.');
            toast.error('Style packs are limited to 1 MiB.');
            return;
        }
        const analysis = await runImportAnalysis(
            () => analyzeStylePackImport(file),
            'Style pack',
            announceStylePack,
        );
        if (!analysis) return;
        await reviewAndApplyStylePack(analysis, $('dc-style-pack-import'));
    };
    $('dc-card').onclick = autoAssignFromCard;
    $('dc-add-persona').onclick = () => ensurePersonaCharacter();
    $('dc-avatar-color').onclick = async () => {
        try {
            const binding = captureUiMutationContext();
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (!char?.avatar) { toast.info('No avatar found'); return; }
            const reviewedCharacterId = ctx.characterId;
            const reviewedName = char.name;
            const reviewedAvatar = char.avatar;
            const avatarUrl = `/characters/${encodeURIComponent(char.avatar)}`;
            const color = await extractAvatarColor(avatarUrl);
            if (!color) { toast.error('Could not extract color'); return; }
            const currentContext = getContext();
            const currentCharacter = currentContext?.characters?.[currentContext?.characterId];
            if (!isUiMutationContextCurrent(binding)
                || currentContext?.characterId !== reviewedCharacterId
                || currentCharacter !== char
                || currentCharacter?.name !== reviewedName
                || currentCharacter?.avatar !== reviewedAvatar) {
                return notifyUiContextChanged('The active card changed while its avatar color was extracted. Try again on the current card.');
            }
            // Resolve through the registry rather than lowercasing the card name, so an
            // existing entry is recolored instead of shadowed by a mismatched key.
            const existingKey = resolveCharacterKeyByNameOrAlias(char.name);
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            let needsDomRepaint = false;
            if (existingKey && characterColors[existingKey]) {
                setEntryFromBaseColor(characterColors[existingKey], color);
                applyLiveColorChangesFromSnapshot(snapshot, [existingKey]);
            } else {
                const built = buildCharacterEntry(char.name, { color, colorMode: 'base', origin: 'avatar', dialogueCount: 0 });
                if (!built.entry) return;
                characterColors[built.key] = built.entry;
                clearSpeakerRegexCache();
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
        const binding = captureUiMutationContext();
        const existing = await runImportAnalysis(() => readCardData(), 'Card data');
        if (!existing) return;
        if (!isUiMutationContextCurrent(binding)) {
            return notifyUiContextChanged('The active card or color table changed while card data was reviewed. Review it again.');
        }
        const reviewedContext = getContext();
        const reviewedCharacterId = reviewedContext?.characterId;
        const reviewedCard = reviewedContext?.characters?.[reviewedCharacterId];
        const reviewedCardData = JSON.stringify(reviewedCard?.data?.extensions?.dialogueColors ?? null);
        const reviewedSource = JSON.stringify([characterColors, groupProfiles, settings]);
        if (existing.ok) {
            const analysisError = getImportAnalysisError(existing, 'card');
            if (analysisError) {
                toast.error(analysisError);
                return;
            }
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
        const currentContext = getContext();
        const currentCard = currentContext?.characters?.[currentContext?.characterId];
        if (!isUiMutationContextCurrent(binding)
            || currentContext?.characterId !== reviewedCharacterId
            || currentCard !== reviewedCard
            || JSON.stringify(currentCard?.data?.extensions?.dialogueColors ?? null) !== reviewedCardData
            || JSON.stringify([characterColors, groupProfiles, settings]) !== reviewedSource) {
            return notifyUiContextChanged('The active card, color table, or reviewed card data changed. Review the save again.');
        }
        return saveToCard();
    };
    $('dc-load-card').onclick = async e => {
        const analysis = await runImportAnalysis(() => readCardData(), 'Card data');
        if (analysis) await reviewAndApplyImport(analysis, 'card', e.currentTarget);
    };
    $('dc-undo').onclick = undo;
    $('dc-redo').onclick = redo;
    $('dc-export').onclick = exportColors;
    $('dc-import').onclick = () => $('dc-import-file').click();
    $('dc-export-png').onclick = exportLegendPng;
    $('dc-import-file').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const analysis = await runImportAnalysis(() => analyzeColorImport(file), 'Color import');
        if (analysis) await reviewAndApplyImport(analysis, 'colors', $('dc-import'));
    };
    $('dc-export-settings').onclick = exportSettings;
    $('dc-import-settings').onclick = () => $('dc-import-settings-file').click();
    $('dc-import-settings-file').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const analysis = await runImportAnalysis(() => analyzeSettingsImport(file), 'Settings import');
        if (analysis) await reviewAndApplyImport(analysis, 'settings', $('dc-import-settings'));
    };
    $('dc-setup-autosync').onclick = () => { enableAutoSync(); updateAutoSyncUI(); };
    $('dc-disable-autosync').onclick = () => { disableAutoSync(); updateAutoSyncUI(); };
    $('dc-del-locked').onclick = e => {
        confirmCharacterRemoval(Object.keys(characterColors).filter(k => characterColors[k]?.locked), {
            getCandidates: () => Object.keys(characterColors).filter(k => characterColors[k]?.locked),
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
            getCandidates: () => Object.keys(characterColors).filter(k => characterColors[k] && !characterColors[k].locked),
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
            getCandidates: () => Object.keys(characterColors).filter(k => (characterColors[k]?.dialogueCount || 0) < min),
            title: `Delete characters below ${min} lines?`,
            actionLabel: 'Deleted',
            itemLabel: 'low-dialogue character',
            emptyMessage: `No characters below ${min} dialogues`,
            blockedMessage: 'Only pinned low-dialogue characters remain.',
            opener: e.currentTarget,
        });
    };
    $('dc-del-dupes').onclick = e => {
        confirmCharacterRemoval(collectDuplicateColorKeys(), {
            getCandidates: collectDuplicateColorKeys,
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
        if (!count) { toast.info('Every character is already locked.'); return; }
        saveHistory();
        saveData(); updateCharList(); toast.info(`Locked ${count} character${count === 1 ? '' : 's'}.`);
    };
    $('dc-unlock-all').onclick = () => {
        let count = 0;
        Object.keys(characterColors).forEach(k => {
            if (characterColors[k].locked) {
                characterColors[k].locked = false;
                count++;
            }
        });
        if (!count) { toast.info('Every character is already unlocked.'); return; }
        saveHistory();
        saveData(); updateCharList(); toast.info(`Unlocked ${count} character${count === 1 ? '' : 's'}.`);
    };
    $('dc-reset').onclick = async e => {
        const unlockedCount = Object.values(characterColors).filter(entry => !entry.locked).length;
        if (!unlockedCount) { toast.info('No unlocked colors to reset'); return; }
        const binding = captureUiMutationContext();
        const reviewedTable = JSON.stringify(characterColors);
        const confirmed = await confirmReviewedAction({
            title: 'Reset unlocked colors?',
            description: `${unlockedCount} character color${unlockedCount === 1 ? '' : 's'} will be regenerated. Locked colors remain unchanged.`,
            confirmLabel: 'Reset colors',
            danger: true,
            opener: e.currentTarget,
        });
        if (!confirmed) return;
        if (!isUiMutationContextCurrent(binding) || JSON.stringify(characterColors) !== reviewedTable) {
            return notifyUiContextChanged('The active color table changed. Review the reset again.');
        }
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
        const groupInput = $('dc-add-group');
        const group = readValidatedGroupInput(groupInput);
        if (group === null) return;
        const result = addCharacter(input.value, undefined, { group, origin: 'manual' });
        if (result?.added || result?.existing) {
            input.value = '';
            if (groupInput) groupInput.value = '';
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

function bindConnectionProfileRefresh() {
    const refresh = () => populateProfileDropdown();
    for (const type of new Set([
        event_types.CONNECTION_PROFILE_LOADED,
        event_types.CONNECTION_PROFILE_CREATED,
        event_types.CONNECTION_PROFILE_UPDATED,
        event_types.CONNECTION_PROFILE_DELETED,
    ].filter(Boolean))) {
        eventSource.on(type, refresh);
    }
}

export function createUI() {
    if (document.getElementById('dc-ext')) return;
    document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', buildSettingsPanelHtml());

    const $ = id => document.getElementById(id);

    bindSettingsPage();
    syncUIWithSettings();
    bindSettingsPanelControls($);
    bindConnectionProfileRefresh();

    applyControlHelpText();
    updateCharList();
    injectPrompt();
}
