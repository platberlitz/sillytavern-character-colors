// palettes.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { applyGradientPresetToEntry, buildRandomGradient, cloneGradient, mapGradientStops, normalizeGradient, serializeGradient, synchronizeGradientEffectiveColors } from './gradients.js';
import { createRestoreSnapshot, showUndoToast } from './history.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { callLLMWithProfile } from './llm.js';
import { injectPrompt } from './prompts.js';
import { escapeHtml, generateQuietPrompt, getContext } from './st-api.js';
import { characterColors, expandedCharacterRows, setCharacterColors, setExpandedCharacterRows, setSwapMode, settings, swapMode } from './state.js';
import { getAutoSyncRecord, isPlainObject, persistModuleStore, saveData } from './storage.js';
import { COLOR_CONFLICT_HUE_THRESHOLD, COLOR_CONFLICT_LIGHTNESS_THRESHOLD, VALID_STYLES, colorDistance, hexToHsl, hslToHex, normalizeAliases, normalizeCharacterEntry, normalizeGoogleFontName, normalizeHexColor, toast } from './utils.js';

export const COLOR_THEMES = {
    pastel: [[340, 70, 75], [200, 70, 75], [120, 50, 70], [45, 80, 70], [280, 60, 75], [170, 60, 70], [20, 80, 75], [240, 60, 75]],
    neon: [[320, 100, 60], [180, 100, 50], [90, 100, 50], [45, 100, 55], [270, 100, 60], [150, 100, 45], [0, 100, 60], [210, 100, 55]],
    earth: [[25, 50, 55], [45, 40, 50], [90, 30, 45], [150, 35, 45], [180, 30, 50], [30, 60, 60], [60, 35, 55], [120, 25, 50]],
    jewel: [[340, 70, 45], [200, 80, 40], [150, 70, 40], [45, 80, 50], [280, 70, 45], [170, 70, 40], [0, 75, 50], [220, 75, 45]],
    muted: [[350, 30, 60], [200, 30, 55], [120, 25, 55], [45, 35, 60], [280, 25, 55], [170, 30, 55], [20, 35, 60], [240, 25, 55]],
    jade: [[170, 60, 55], [150, 55, 50], [160, 65, 45], [165, 50, 60], [155, 70, 40], [140, 45, 55], [175, 55, 50], [130, 60, 45]],
    forest: [[120, 50, 50], [90, 45, 45], [100, 55, 40], [110, 40, 55], [80, 50, 35], [130, 45, 50], [95, 60, 45], [85, 55, 40]],
    ocean: [[200, 70, 60], [190, 65, 55], [180, 60, 65], [210, 55, 60], [170, 75, 50], [220, 50, 65], [195, 80, 45], [205, 60, 70]],
    sunset: [[15, 85, 60], [35, 90, 55], [25, 80, 65], [40, 75, 70], [30, 95, 50], [20, 70, 75], [45, 85, 55], [10, 80, 60]],
    aurora: [[280, 50, 70], [300, 55, 65], [260, 45, 75], [290, 60, 60], [270, 65, 55], [310, 40, 80], [285, 70, 50], [275, 55, 70]],
    warm: [[20, 70, 65], [35, 75, 60], [45, 65, 70], [30, 80, 55], [40, 85, 50], [25, 90, 60], [50, 60, 75], [15, 75, 65]],
    cool: [[210, 60, 70], [240, 55, 65], [200, 65, 75], [225, 70, 60], [190, 75, 55], [250, 50, 80], [215, 80, 50], [235, 60, 75]],
    berry: [[330, 70, 60], [350, 65, 55], [320, 60, 70], [340, 75, 50], [360, 80, 45], [310, 55, 75], [345, 85, 40], [325, 70, 65]],
    monochrome: [[0, 0, 30], [0, 0, 40], [0, 0, 50], [0, 0, 60], [0, 0, 70], [0, 0, 80], [0, 0, 90], [0, 0, 20]],
    protanopia: [[45, 80, 60], [200, 80, 55], [270, 60, 65], [30, 90, 55], [180, 70, 50], [300, 50, 60], [60, 70, 55], [220, 70, 60]],
    deuteranopia: [[45, 80, 60], [220, 80, 55], [280, 60, 65], [30, 90, 55], [200, 70, 50], [320, 50, 60], [60, 70, 55], [240, 70, 60]],
    tritanopia: [[0, 70, 60], [180, 70, 55], [330, 60, 65], [20, 80, 55], [200, 60, 50], [350, 50, 60], [160, 70, 55], [10, 70, 60]]
};

export let cachedTheme = null;

export let cachedThemeBackground = null;

export let cachedIsDark = null;

export function getPresets() {
    const presets = getAutoSyncRecord(true).presets;
    return isPlainObject(presets) ? presets : {};
}

export function persistPresets(presets) {
    try {
        const record = getAutoSyncRecord(true);
        record.presets = isPlainObject(presets) ? presets : {};
        persistModuleStore(record);
        return true;
    } catch {
        toast.warning('Could not save presets to your user settings.');
        return false;
    }
}

export function getInlinePaletteInputs() {
    const name = document.getElementById('dc-palette-name-input')?.value?.trim() || '';
    const notes = document.getElementById('dc-palette-notes-input')?.value || '';
    return { name, notes };
}

export function isKeptCharacter(key) {
    return !!characterColors[key]?.keep;
}

export function getKeptKeys(keys = Object.keys(characterColors)) {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.filter(key => isKeptCharacter(key));
}

export function buildKeepAwareRemovalMessage(actionLabel, removedCount, keptCount, itemLabel = 'character') {
    const removedText = `${actionLabel} ${removedCount} ${itemLabel}${removedCount !== 1 ? 's' : ''}`;
    if (!keptCount) return `${removedText}.`;
    return `${removedText}, kept ${keptCount} pinned character${keptCount !== 1 ? 's' : ''}.`;
}

export function pruneExpandedCharacterRows() {
    setExpandedCharacterRows(new Set([...expandedCharacterRows].filter(key => characterColors[key])));
}

export function removeCharacterKeys(keys, { actionLabel, itemLabel = 'character', emptyMessage, blockedMessage, onComplete } = {}) {
    const candidates = [...new Set((Array.isArray(keys) ? keys : [keys]).map(key => String(key ?? '').trim().toLowerCase()).filter(Boolean))]
        .filter(key => characterColors[key]);
    if (!candidates.length) {
        if (emptyMessage) toast.info(emptyMessage);
        return { removed: 0, kept: 0, skipped: [], removedKeys: [] };
    }

    const keptKeys = getKeptKeys(candidates);
    const removedKeys = candidates.filter(key => !keptKeys.includes(key));
    if (!removedKeys.length) {
        toast.info(blockedMessage || 'Pinned characters stay until you turn off Keep.');
        return { removed: 0, kept: keptKeys.length, skipped: keptKeys, removedKeys: [] };
    }

    const restore = createRestoreSnapshot();
    removedKeys.forEach(key => {
        delete characterColors[key];
        expandedCharacterRows.delete(key);
        if (swapMode === key) setSwapMode(null);
    });
    clearSpeakerRegexCache();
    pruneExpandedCharacterRows();
    commit();
    repaintDomAfterCharacterDataChange(0);
    if (typeof onComplete === 'function') onComplete({ removedKeys, keptKeys });
    showUndoToast(buildKeepAwareRemovalMessage(actionLabel || 'Removed', removedKeys.length, keptKeys.length, itemLabel), restore);
    return { removed: removedKeys.length, kept: keptKeys.length, skipped: keptKeys, removedKeys };
}

export function collectDuplicateColorKeys() {
    const duplicateKeys = [];
    const colorGroups = {};
    Object.entries(characterColors).forEach(([k, v]) => {
        const color = getEntryEffectiveColor(v).toLowerCase();
        if (!colorGroups[color]) colorGroups[color] = [];
        colorGroups[color].push({ key: k, count: v.dialogueCount || 0, keep: !!v.keep });
    });
    Object.values(colorGroups).forEach(group => {
        if (group.length < 2) return;
        group.sort((a, b) => Number(b.keep) - Number(a.keep) || b.count - a.count);
        group.slice(1).forEach(({ key }) => duplicateKeys.push(key));
    });
    return duplicateKeys;
}

export function keepCharacterKeysOnly(keysToKeep) {
    const keepSet = new Set((Array.isArray(keysToKeep) ? keysToKeep : [keysToKeep]).map(key => String(key ?? '').trim().toLowerCase()).filter(Boolean));
    const nextColors = {};
    for (const [key, entry] of Object.entries(characterColors)) {
        if (keepSet.has(key)) nextColors[key] = entry;
        else {
            expandedCharacterRows.delete(key);
            if (swapMode === key) setSwapMode(null);
        }
    }
    setCharacterColors(nextColors);
    pruneExpandedCharacterRows();
}

// Phase 5C: Handle custom palettes in getNextColor

export function shouldOverwritePalette() {
    return !!document.getElementById('dc-overwrite-existing')?.checked;
}

// Phase 3B: Optimized conflict check with pre-computed HSL and early-out

// Phase 5C: Handle custom palettes in getNextColor
export function getNextColor() {
    if (settings.colorTheme?.startsWith('custom:')) {
        const paletteName = settings.colorTheme.slice(7);
        const customs = getCustomPalettes();
        const palette = customs[paletteName];
        if (palette) {
            const usedColors = Object.values(characterColors).map(c => getBaseColor(c));
            for (const color of palette) {
                const normalizedColor = normalizeHexColor(color);
                if (!usedColors.includes(normalizedColor)) return normalizedColor;
            }
            const base = palette[Math.floor(Math.random() * palette.length)];
            const [h, s, l] = hexToHsl(base);
            return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, l);
        }
    }
    const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
    const usedColors = Object.values(characterColors).map(c => getBaseColor(c));
    const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
    const isDark = mode === 'dark';
    cachedIsDark = isDark;
    for (const [h, s, l] of theme) {
        const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
        const color = hslToHex(h, s, adjustedL);
        if (!usedColors.includes(color)) return color;
    }
    const [h, s, l] = theme[Math.floor(Math.random() * theme.length)];
    return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, isDark ? 75 : 40);
}

// Pre-compiled color name mapping for faster lookups

// Phase 3B: Optimized conflict check with pre-computed HSL and early-out
export function checkColorConflicts() {
    const colors = Object.entries(characterColors);
    if (colors.length > 50) return [];
    const conflicts = [];
    const hslCache = colors.map(([, v]) => ({ name: v.name, hsl: hexToHsl(getEntryEffectiveColor(v)) }));
    for (let i = 0; i < hslCache.length - 1; i++) {
        for (let j = i + 1; j < hslCache.length; j++) {
            const [h1, , l1] = hslCache[i].hsl;
            const [h2, , l2] = hslCache[j].hsl;
            const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
            if (hDiff < COLOR_CONFLICT_HUE_THRESHOLD && Math.abs(l1 - l2) < COLOR_CONFLICT_LIGHTNESS_THRESHOLD) {
                conflicts.push([hslCache[i].name, hslCache[j].name]);
            }
        }
    }
    return conflicts;
}

// Pre-compiled color name mapping for faster lookups
export const COLOR_NAME_MAP = new Map([
    ['red', 0], ['rose', 340], ['pink', 340], ['magenta', 330],
    ['purple', 280], ['violet', 270], ['blue', 220], ['cyan', 180],
    ['teal', 170], ['green', 120], ['lime', 90], ['yellow', 50],
    ['gold', 45], ['orange', 30], ['brown', 25], ['grey', 0], ['gray', 0]
]);

export function suggestColorForName(name) {
    const n = name.toLowerCase();
    for (const [colorName, hue] of COLOR_NAME_MAP) {
        if (n.includes(colorName)) return hslToHex(hue, 70, 50);
    }
    return null;
}

// Phase 4B: Improved conflict resolution feedback listing pairs

export function regenerateAllColors() {
    invalidateThemeCache();
    const sortedEntries = Object.entries(characterColors)
        .sort((a, b) => (a[1].dialogueCount || 0) - (b[1].dialogueCount || 0));
    const changedKeys = [];
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));

    for (const [key, char] of sortedEntries) {
        if (!char.locked) {
            setEntryFromBaseColor(char, suggestColorForName(char.name) || getNextColor());
            changedKeys.push(key);
        }
    }
    applyLiveColorChangesFromSnapshot(snapshot, changedKeys);
    commit();
    toast.success('Colors regenerated');
}

// Phase 4B: Improved conflict resolution feedback listing pairs
export function autoResolveConflicts() {
    const conflicts = checkColorConflicts();
    if (!conflicts.length) { toast.info('No conflicts found'); return; }
    const fixedPairs = [];
    const changedKeys = [];
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    conflicts.forEach(([name1, name2]) => {
        const key1 = name1.toLowerCase(), key2 = name2.toLowerCase();
        if (characterColors[key1] && !characterColors[key1].locked) {
            setEntryFromBaseColor(characterColors[key1], getNextColor());
            changedKeys.push(key1);
            fixedPairs.push(`${name1} & ${name2} (changed ${name1})`);
        } else if (characterColors[key2] && !characterColors[key2].locked) {
            setEntryFromBaseColor(characterColors[key2], getNextColor());
            changedKeys.push(key2);
            fixedPairs.push(`${name1} & ${name2} (changed ${name2})`);
        }
    });
    applyLiveColorChangesFromSnapshot(snapshot, changedKeys);
    commit();
    toast.success(`Fixed: ${fixedPairs.map(escapeHtml).join('; ')}`);
}

// Phase 5A: Preset management with dropdown UI

export function flipColorsForTheme() {
    const entries = Object.entries(characterColors);
    if (!entries.length) { toast.info('No characters to flip'); return; }
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const flipEffectiveColor = color => {
        const [h, s, l] = hexToHsl(color);
        return hslToHex(h, s, Math.max(25, Math.min(85, 100 - l)));
    };
    for (const [, char] of entries) {
        const flippedGradient = mapGradientStops(char.gradient, stop => {
            const color = flipEffectiveColor(stop.color);
            return { ...stop, baseColor: deriveBaseColorFromEffectiveColor(color), color };
        });
        setEntryFromEffectiveColor(char, flipEffectiveColor(getEntryEffectiveColor(char)));
        char.gradient = flippedGradient;
    }
    applyLiveColorChangesFromSnapshot(snapshot, entries.map(([key]) => key));
    commit();
    toast.success('Colors flipped for theme switch');
}

// Phase 5A: Preset management with dropdown UI
export function saveColorPreset() {
    const nameInput = document.getElementById('dc-preset-name');
    const name = nameInput?.value?.trim();
    if (!name) { toast.warning('Enter a preset name'); return; }
    const presets = getPresets();
    presets[name] = Object.entries(characterColors).map(([, v]) => ({
        name: String(v.name ?? '').trim(),
        color: getEntryEffectiveColor(v),
        baseColor: getBaseColor(v),
        style: VALID_STYLES.has(v.style) ? v.style : '',
        font: normalizeGoogleFontName(v.font),
        aliases: normalizeAliases(v.aliases),
        group: String(v.group ?? '').trim(),
        locked: !!v.locked,
        keep: !!v.keep,
        gradient: serializeGradient(v.gradient),
    }));
    if (!persistPresets(presets)) return;
    nameInput.value = '';
    refreshPresetDropdown();
    toast.success(`Preset "${escapeHtml(name)}" saved`);
}

export function loadColorPreset() {
    const select = document.getElementById('dc-preset-select');
    const name = select?.value;
    if (!name) { toast.warning('Select a preset first'); return; }
    const presets = getPresets();
    if (!presets[name]) { toast.error('Preset not found'); return; }
    const presetData = presets[name];
    if (!Array.isArray(presetData)) { toast.error('Preset is invalid'); return; }
    let changed = false;
    const changedKeys = [];
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    for (const p of presetData) {
        const normalized = normalizeCharacterEntry(p, p?.name);
        if (!normalized) continue;
        const key = normalized.name.toLowerCase();
        const existing = characterColors[key];
        characterColors[key] = {
            ...normalized,
            dialogueCount: existing?.dialogueCount || 0
        };
        if (!characterColors[key].locked) setEntryFromBaseColor(characterColors[key], getBaseColor(characterColors[key]));
        changedKeys.push(key);
        changed = true;
    }
    if (changed) applyLiveColorChangesFromSnapshot(snapshot, changedKeys);
    commit({ history: changed });
    toast.success(`Preset "${escapeHtml(name)}" loaded`);
}

export function deleteColorPreset() {
    const select = document.getElementById('dc-preset-select');
    const name = select?.value;
    if (!name) { toast.warning('Select a preset first'); return; }
    const presets = getPresets();
    if (!Object.prototype.hasOwnProperty.call(presets, name)) {
        toast.error('Preset not found');
        return;
    }
    delete presets[name];
    if (!persistPresets(presets)) return;
    refreshPresetDropdown();
    toast.success(`Preset "${escapeHtml(name)}" deleted`);
}

// Phase 5C: Custom palettes

export function refreshPresetDropdown() {
    const select = document.getElementById('dc-preset-select');
    if (!select) return;
    const previousValue = select.value;
    const presets = getPresets();
    const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
    select.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select Preset --';
    select.appendChild(placeholder);
    for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    }
    if (previousValue && names.includes(previousValue)) select.value = previousValue;
}

// Phase 5C: Custom palettes
export const CUSTOM_PALETTE_KEY = 'dc_custom_palettes';

export const CUSTOM_PALETTE_META_KEY = 'dc_custom_palette_meta';

export const CUSTOM_PALETTE_SIZE = 8;

export function normalizeCustomPalettes(raw) {
    if (!isPlainObject(raw)) return {};
    const cleaned = {};
    for (const [name, colors] of Object.entries(raw)) {
        const palette = Array.isArray(colors)
            ? colors.map(c => normalizeHexColor(c, null)).filter(Boolean)
            : [];
        if (palette.length) cleaned[String(name)] = [...new Set(palette)];
    }
    return cleaned;
}

export const PALETTE_STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'with', 'for', 'in', 'on', 'at', 'from', 'by',
    'style', 'theme', 'vibe', 'tones', 'tone', 'colors', 'color', 'palette', 'pal', 'like', 'as'
]);

export const PALETTE_KEYWORDS = {
    psychedelic: { hueSeeds: [300, 200, 120, 30], sat: [80, 100], light: [45, 70], contrast: 'high' },
    trippy: { hueSeeds: [300, 190, 90, 30], sat: [80, 100], light: [45, 70], contrast: 'high' },
    neon: { hueSeeds: [320, 180, 90, 45], sat: [85, 100], light: [50, 65], contrast: 'high' },
    vibrant: { sat: [70, 100], light: [45, 70], contrast: 'high' },
    vivid: { sat: [75, 100], light: [45, 70], contrast: 'high' },
    pastel: { sat: [20, 50], light: [70, 85], contrast: 'low' },
    soft: { sat: [20, 45], light: [65, 85], contrast: 'low' },
    muted: { sat: [15, 40], light: [35, 65], contrast: 'low' },
    desaturated: { sat: [10, 35], light: [35, 65], contrast: 'low' },
    warm: { hueSeeds: [10, 30, 45, 0], sat: [50, 85] },
    cool: { hueSeeds: [180, 200, 220, 260], sat: [45, 80] },
    forest: { hueSeeds: [90, 110, 130, 150], sat: [35, 65], light: [30, 55] },
    ocean: { hueSeeds: [180, 200, 220], sat: [45, 75], light: [35, 65] },
    sunset: { hueSeeds: [10, 25, 40, 330], sat: [55, 90], light: [45, 70] },
    sunrise: { hueSeeds: [10, 25, 40, 330], sat: [55, 90], light: [50, 75] },
    aurora: { hueSeeds: [260, 290, 170, 200], sat: [45, 80], light: [55, 80] },
    noir: { hueSeeds: [210, 240, 280], sat: [15, 45], light: [15, 35], contrast: 'high' },
    gothic: { hueSeeds: [280, 320, 220], sat: [20, 55], light: [15, 40], contrast: 'high' },
    dark: { sat: [15, 55], light: [15, 40], contrast: 'high' },
    light: { light: [65, 85], sat: [40, 80], contrast: 'low' },
    bright: { light: [60, 85], sat: [60, 95], contrast: 'high' },
    earthy: { hueSeeds: [20, 35, 60, 90], sat: [20, 55], light: [30, 60] },
    jewel: { hueSeeds: [300, 220, 150, 30], sat: [55, 85], light: [30, 55] },
    berry: { hueSeeds: [330, 350, 310], sat: [55, 85], light: [40, 60] },
    sepia: { hueSeeds: [30, 35, 45], sat: [20, 50], light: [40, 70] },
    vintage: { sat: [20, 50], light: [45, 70] },
    retro: { hueSeeds: [20, 140, 200, 340], sat: [35, 70], light: [40, 70] },
    cyberpunk: { hueSeeds: [300, 190, 90], sat: [80, 100], light: [45, 65], contrast: 'high' },
    vaporwave: { hueSeeds: [300, 330, 190], sat: [60, 90], light: [55, 75] },
    cottagecore: { hueSeeds: [20, 40, 90, 140], sat: [25, 55], light: [65, 85], contrast: 'low' },
    monochrome: { monochrome: true, sat: [0, 5], light: [15, 85] },
    grayscale: { monochrome: true, sat: [0, 5], light: [15, 85] },
    greyscale: { monochrome: true, sat: [0, 5], light: [15, 85] }
};

export function getCustomPalettes() {
    return normalizeCustomPalettes(getAutoSyncRecord(true).customPalettes);
}

export function getCustomPaletteMeta() {
    const meta = getAutoSyncRecord(true).customPaletteMeta;
    return isPlainObject(meta) ? meta : {};
}

export function saveCustomPaletteMeta(meta) {
    const record = getAutoSyncRecord(true);
    record.customPaletteMeta = isPlainObject(meta) ? meta : {};
    persistModuleStore(record);
}

export function saveCustomPalettes(customs) {
    const record = getAutoSyncRecord(true);
    record.customPalettes = normalizeCustomPalettes(customs);
    persistModuleStore(record);
}

export function setCustomPaletteMetaEntry(name, entry) {
    const meta = getCustomPaletteMeta();
    meta[String(name)] = entry;
    saveCustomPaletteMeta(meta);
}

export function deleteCustomPaletteMetaEntry(name) {
    const meta = getCustomPaletteMeta();
    delete meta[String(name)];
    saveCustomPaletteMeta(meta);
}

export function tokenizePalettePrompt(name, notes) {
    const text = `${name || ''} ${notes || ''}`.toLowerCase();
    const tokens = text.match(/[a-z0-9]+/g) || [];
    return tokens.filter(t => t.length > 1 && !PALETTE_STOPWORDS.has(t));
}

export function mergeRange(base, next) {
    if (!next) return base;
    if (!base) return [next[0], next[1]];
    const low = Math.max(base[0], next[0]);
    const high = Math.min(base[1], next[1]);
    if (low <= high) return [low, high];
    return [Math.min(base[0], next[0]), Math.max(base[1], next[1])];
}

export function clampRange(range, min = 0, max = 100) {
    if (!range) return null;
    const lo = Math.max(min, Math.min(max, range[0]));
    const hi = Math.max(min, Math.min(max, range[1]));
    if (lo === hi) return [lo, hi];
    return lo < hi ? [lo, hi] : [hi, lo];
}

export function applyProfileHint(profile, hint) {
    if (hint.hueSeeds?.length) profile.hueSeeds.push(...hint.hueSeeds);
    if (hint.sat) profile.satRange = clampRange(mergeRange(profile.satRange, hint.sat));
    if (hint.light) profile.lightRange = clampRange(mergeRange(profile.lightRange, hint.light));
    if (hint.contrast === 'high') profile.contrast = Math.max(profile.contrast, 2);
    if (hint.contrast === 'low') profile.contrast = Math.min(profile.contrast, 0);
    if (hint.monochrome) profile.monochrome = true;
}

export function derivePaletteProfile(tokens) {
    const profile = {
        hueSeeds: [],
        satRange: [45, 85],
        lightRange: [35, 70],
        contrast: 1,
        monochrome: false,
        hueSpread: 28
    };

    for (const token of tokens) {
        if (COLOR_NAME_MAP.has(token)) profile.hueSeeds.push(COLOR_NAME_MAP.get(token));
        const hint = PALETTE_KEYWORDS[token];
        if (hint) applyProfileHint(profile, hint);
    }

    if (profile.monochrome) {
        profile.hueSeeds = [0];
        profile.satRange = [0, 5];
    }

    if (!profile.hueSeeds.length) {
        if (tokens.includes('warm')) profile.hueSeeds = [10, 30, 45, 0];
        else if (tokens.includes('cool')) profile.hueSeeds = [180, 200, 220, 260];
        else profile.hueSeeds = [0, 30, 60, 120, 180, 210, 270, 330];
    }

    if (profile.contrast === 2) {
        profile.lightRange = clampRange([profile.lightRange[0] - 10, profile.lightRange[1] + 10], 5, 95);
    } else if (profile.contrast === 0) {
        const mid = (profile.lightRange[0] + profile.lightRange[1]) / 2;
        const spread = Math.max(6, (profile.lightRange[1] - profile.lightRange[0]) / 2 - 6);
        profile.lightRange = clampRange([mid - spread, mid + spread], 10, 90);
    }

    return profile;
}

export function isColorTooClose(color, palette) {
    return palette.some(existing => colorDistance(existing, color));
}

export function buildPaletteFromProfile(profile, count = CUSTOM_PALETTE_SIZE) {
    const palette = [];
    const attemptsLimit = count * 40;
    let attempts = 0;

    if (profile.monochrome) {
        for (let i = 0; i < count; i++) {
            const t = (i + 1) / (count + 1);
            const l = profile.lightRange[0] + (profile.lightRange[1] - profile.lightRange[0]) * t;
            palette.push(hslToHex(0, 0, Math.round(l)));
        }
        return palette;
    }

    const seeds = profile.hueSeeds.slice();
    while (palette.length < count && attempts < attemptsLimit) {
        const idx = palette.length % seeds.length;
        const baseHue = seeds[idx];
        const hue = (baseHue + (Math.random() * 2 - 1) * profile.hueSpread + 360) % 360;
        const sat = profile.satRange[0] + Math.random() * (profile.satRange[1] - profile.satRange[0]);
        const light = profile.lightRange[0] + Math.random() * (profile.lightRange[1] - profile.lightRange[0]);
        const color = hslToHex(hue, Math.round(sat), Math.round(light));
        if (!isColorTooClose(color, palette)) palette.push(color);
        attempts++;
    }

    return palette;
}

export function sanitizeGeneratedPalette(colors, profile, count = CUSTOM_PALETTE_SIZE) {
    const cleaned = [];
    for (const c of Array.isArray(colors) ? colors : []) {
        const raw = String(c ?? '').trim();
        const candidate = /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : raw;
        const normalized = normalizeHexColor(candidate, null);
        if (normalized && !cleaned.includes(normalized)) cleaned.push(normalized);
    }

    let attempts = 0;
    while (cleaned.length < count && attempts < count * 40) {
        const extra = buildPaletteFromProfile(profile, count);
        for (const color of extra) {
            if (!cleaned.includes(color) && !isColorTooClose(color, cleaned)) cleaned.push(color);
            if (cleaned.length >= count) break;
        }
        attempts++;
    }

    if (cleaned.length < count) {
        const fallback = COLOR_THEMES.pastel.map(([h, s, l]) => hslToHex(h, s, l));
        for (const color of fallback) {
            if (!cleaned.includes(color)) cleaned.push(color);
            if (cleaned.length >= count) break;
        }
    }

    return cleaned.slice(0, count);
}

export function generateHeuristicPalette(name, notes, count = CUSTOM_PALETTE_SIZE) {
    const tokens = tokenizePalettePrompt(name, notes);
    const profile = derivePaletteProfile(tokens);
    const base = buildPaletteFromProfile(profile, count);
    const palette = sanitizeGeneratedPalette(base, profile, count);
    return { palette, profile, tokens };
}

export async function enhancePaletteWithLLM(name, notes, basePalette, profile, count = CUSTOM_PALETTE_SIZE) {
    if (typeof generateQuietPrompt !== 'function') return null;

    const promptNotes = notes?.trim() ? notes.trim() : 'None';
    const instruction = [
        'Generate a color palette as a JSON array of hex strings.',
        `Theme: "${name}".`,
        `Notes: "${promptNotes}".`,
        `Return exactly ${count} colors.`,
        'Each item must be a string in "#RRGGBB" format.',
        `Base palette for inspiration (optional): ${JSON.stringify(basePalette)}.`,
        'Return ONLY the JSON array. No commentary, no code fence, no extra text.'
    ].join(' ');

    const jsonSchema = {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: { type: 'string', pattern: '^#?[0-9a-fA-F]{6}$' }
    };

    let response = '';
    try {
        response = await callLLMWithProfile(instruction, {
            quietName: `PaletteGen_${Date.now()}`,
            jsonSchema,
        });
    } catch (e) {
        console.warn('[Dialogue Colors] LLM palette generation failed:', e);
        return null;
    }

    if (!response || typeof response !== 'string') return null;
    let jsonText = response.trim();
    if (!jsonText.startsWith('[')) {
        const match = jsonText.match(/\[[\s\S]*\]/);
        if (!match) return null;
        jsonText = match[0];
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    const sanitized = sanitizeGeneratedPalette(parsed, profile, count);
    return sanitized.length ? sanitized : null;
}

export async function generateCustomPaletteFromWords(inputName = '', inputNotes = '') {
    const inlineInputs = getInlinePaletteInputs();
    const name = String(inputName || inlineInputs.name || '').trim();
    if (!name) {
        toast.warning('Enter a palette name first');
        return;
    }
    const notes = String(inputNotes || inlineInputs.notes || '');
    const customs = getCustomPalettes();
    if (customs[name] && !shouldOverwritePalette()) {
        toast.warning(`Custom palette "${escapeHtml(name)}" exists. Enable "Overwrite existing" to replace it.`);
        return;
    }

    const { palette: basePalette, profile } = generateHeuristicPalette(name, notes);
    let finalPalette = basePalette;
    let source = 'heuristic';

    const enhanced = await enhancePaletteWithLLM(name, notes, basePalette, profile, CUSTOM_PALETTE_SIZE);
    if (enhanced) {
        finalPalette = enhanced;
        source = 'llm';
    } else {
        source = 'hybrid-fallback';
        toast.info('LLM enhancement unavailable, used local palette');
    }

    customs[name] = finalPalette;
    saveCustomPalettes(customs);
    setCustomPaletteMetaEntry(name, { source, notes: notes.trim(), createdAt: Date.now() });
    refreshPaletteDropdown();
    const label = source === 'llm' ? 'LLM-enhanced' : (source === 'hybrid-fallback' ? 'local fallback' : 'local');
    toast.success(`Custom palette "${escapeHtml(name)}" saved (${label})`);
}

export function saveCustomPalette() {
    const { name } = getInlinePaletteInputs();
    if (!name) {
        toast.warning('Enter a palette name first');
        return;
    }
    const colors = [...new Set(Object.values(characterColors).map(c => normalizeHexColor(getEntryEffectiveColor(c), null)).filter(Boolean))];
    if (!colors.length) { toast.warning('No characters to save palette from'); return; }
    const customs = getCustomPalettes();
    if (customs[name] && !shouldOverwritePalette()) {
        toast.warning(`Custom palette "${escapeHtml(name)}" exists. Enable "Overwrite existing" to replace it.`);
        return;
    }
    customs[name] = colors;
    saveCustomPalettes(customs);
    setCustomPaletteMetaEntry(name, { source: 'heuristic', notes: '', createdAt: Date.now() });
    refreshPaletteDropdown();
    toast.success(`Custom palette "${escapeHtml(name)}" saved`);
}

export function deleteCustomPalette() {
    const select = document.getElementById('dc-palette');
    if (!select?.value?.startsWith('custom:')) { toast.warning('Select a custom palette first'); return; }
    const paletteName = select.value.slice(7);
    const customs = getCustomPalettes();
    delete customs[paletteName];
    saveCustomPalettes(customs);
    deleteCustomPaletteMetaEntry(paletteName);
    settings.colorTheme = 'pastel';
    saveData();
    invalidateThemeCache();
    refreshPaletteDropdown();
    injectPrompt();
    toast.success(`Custom palette "${escapeHtml(paletteName)}" deleted`);
}

// Phase 5D: Color harmony suggestions

export function refreshPaletteDropdown() {
    const select = document.getElementById('dc-palette');
    if (!select) return;
    const previousValue = select.value;
    select.textContent = '';
    const builtinKeys = Object.keys(COLOR_THEMES);
    for (const key of builtinKeys) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        select.appendChild(option);
    }
    const customs = getCustomPalettes();
    const customNames = Object.keys(customs).sort((a, b) => a.localeCompare(b));
    if (customNames.length) {
        const customGroup = document.createElement('optgroup');
        customGroup.label = 'Custom';
        for (const name of customNames) {
            const option = document.createElement('option');
            option.value = `custom:${name}`;
            option.textContent = name;
            customGroup.appendChild(option);
        }
        select.appendChild(customGroup);
    }
    select.value = settings.colorTheme;
    if (select.value !== settings.colorTheme) {
        if (previousValue && [...select.options].some(o => o.value === previousValue)) {
            select.value = previousValue;
            settings.colorTheme = previousValue;
            return;
        }
        settings.colorTheme = 'pastel';
        select.value = 'pastel';
    }
}

// Phase 5D: Color harmony suggestions
export function getHarmonySuggestions(hex) {
    const [h, s, l] = hexToHsl(hex);
    return [
        { label: 'Complementary', color: hslToHex((h + 180) % 360, s, l) },
        { label: 'Triadic 1', color: hslToHex((h + 120) % 360, s, l) },
        { label: 'Triadic 2', color: hslToHex((h + 240) % 360, s, l) },
        { label: 'Analogous +', color: hslToHex((h + 30) % 360, s, l) },
        { label: 'Analogous -', color: hslToHex((h + 330) % 360, s, l) }
    ];
}

// Phase 6B: Group sorting support

export function showHarmonyPopup(key, anchorEl) {
    const existing = document.getElementById('dc-harmony-popup');
    if (existing) existing.remove();
    const char = characterColors[key];
    if (!char) return;
    const suggestions = getHarmonySuggestions(getBaseColor(char));
    const popup = document.createElement('div');
    popup.id = 'dc-harmony-popup';
    const rect = anchorEl.getBoundingClientRect();
    popup.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;background:var(--SmartThemeBlurTintColor, #1a1a2e);border:1px solid var(--SmartThemeBorderColor, #4a4a6a);border-radius:6px;padding:8px;z-index:10001;display:flex;gap:6px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    popup.innerHTML = suggestions.map(s => `<div class="dc-harmony-swatch" data-color="${s.color}" title="${s.label}: ${s.color}" style="width:24px;height:24px;border-radius:4px;background:${s.color};cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;"></div>`).join('');
    document.body.appendChild(popup);
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) popup.style.left = (window.innerWidth - popupRect.width - 8) + 'px';
    if (popupRect.bottom > window.innerHeight) popup.style.top = (window.innerHeight - popupRect.height - 8) + 'px';
    popup.querySelectorAll('.dc-harmony-swatch').forEach(swatch => {
        swatch.onmouseenter = () => { swatch.style.borderColor = '#fff'; };
        swatch.onmouseleave = () => { swatch.style.borderColor = 'transparent'; };
        swatch.onclick = () => {
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            setEntryFromBaseColor(char, swatch.dataset.color);
            applyLiveColorChangesFromSnapshot(snapshot, [key]);
            commit();
            popup.remove();
        };
    });
    const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
    setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
}

export function detectTheme() {
    const background = getComputedStyle(document.body).backgroundColor || '';
    if (cachedTheme && cachedThemeBackground === background) return cachedTheme;
    const m = background.match(/\d+/g);
    cachedTheme = m && m.length >= 3 && (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000 < 128 ? 'dark' : 'light';
    cachedThemeBackground = background;
    return cachedTheme;
}

export function invalidateThemeCache() { cachedTheme = null; cachedThemeBackground = null; cachedIsDark = null; }

export function getThemeLightnessBounds() {
    const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
    return mode === 'dark'
        ? { mode, minLightness: 45, maxLightness: 92 }
        : { mode, minLightness: 12, maxLightness: 65 };
}

export function getBrightnessOffset() {
    const brightness = Number(settings.brightness);
    return Number.isFinite(brightness) ? Math.max(-100, Math.min(100, brightness)) : 0;
}

export function applyThemeReadabilityAndBrightness(hexColor) {
    const normalized = normalizeHexColor(hexColor);
    const [h, s, l] = hexToHsl(normalized);
    const offset = getBrightnessOffset();
    const { minLightness, maxLightness } = getThemeLightnessBounds();
    const adjustedL = Math.max(minLightness, Math.min(maxLightness, l + offset));
    return hslToHex(h, s, adjustedL);
}

export function deriveBaseColorFromEffectiveColor(hexColor) {
    const normalized = normalizeHexColor(hexColor);
    const [h, s, l] = hexToHsl(normalized);
    const offset = getBrightnessOffset();
    const baseL = Math.max(0, Math.min(100, l - offset));
    return hslToHex(h, s, baseL);
}

export function getBaseColor(entry, fallback = '#888888') {
    const colorFallback = normalizeHexColor(entry?.color, fallback);
    return normalizeHexColor(entry?.baseColor, colorFallback);
}

export function getEntryEffectiveColor(entry) {
    return normalizeHexColor(entry?.color, applyThemeReadabilityAndBrightness(getBaseColor(entry)));
}

export function setEntryFromBaseColor(entry, baseColor) {
    if (!entry) return '#888888';
    entry.baseColor = normalizeHexColor(baseColor, getBaseColor(entry));
    entry.color = applyThemeReadabilityAndBrightness(getBaseColor(entry));
    entry.gradient = synchronizeGradientEffectiveColors(entry.gradient, applyThemeReadabilityAndBrightness);
    return entry.color;
}

export function setEntryFromEffectiveColor(entry, effectiveColor) {
    if (!entry) return '#888888';
    const normalizedEffective = normalizeHexColor(effectiveColor, getEntryEffectiveColor(entry));
    entry.baseColor = deriveBaseColorFromEffectiveColor(normalizedEffective);
    entry.color = normalizedEffective;
    entry.gradient = synchronizeGradientEffectiveColors(entry.gradient, applyThemeReadabilityAndBrightness);
    return entry.color;
}

export function setEntryGradient(entry, gradient) {
    if (!entry) return null;
    entry.gradient = synchronizeGradientEffectiveColors(normalizeGradient(gradient), applyThemeReadabilityAndBrightness);
    return entry.gradient;
}

function getActiveGradientPaletteColors() {
    if (settings.colorTheme?.startsWith('custom:')) {
        const customPalette = getCustomPalettes()[settings.colorTheme.slice(7)];
        if (customPalette?.length) return customPalette;
    }
    return (COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel)
        .map(([hue, saturation, lightness]) => hslToHex(hue, saturation, lightness));
}

export function createRandomGradient(entry, options = {}) {
    if (!entry) return null;
    const animation = options.preserveAnimation === false ? null : normalizeGradient(entry.gradient)?.animation;
    const gradient = buildRandomGradient(getBaseColor(entry), {
        palette: getActiveGradientPaletteColors(),
        animation: animation || undefined,
        totalStops: options.totalStops,
        transformColor: applyThemeReadabilityAndBrightness,
    }, options.random);
    return synchronizeGradientEffectiveColors(gradient, applyThemeReadabilityAndBrightness);
}

function getCurrentGroupCharacterNames(context) {
    const characters = Array.isArray(context?.characters)
        ? context.characters
        : Object.values(context?.characters || {});
    const groups = Array.isArray(context?.groups) ? context.groups : [];
    const currentGroup = context?.group
        || groups.find(group => String(group?.id ?? group?.groupId ?? '') === String(context?.groupId ?? ''));
    const members = [
        ...(Array.isArray(currentGroup?.members) ? currentGroup.members : []),
        ...(Array.isArray(context?.groupMembers) ? context.groupMembers : []),
    ];
    const names = [];
    for (const member of members) {
        const memberName = typeof member === 'object' ? member?.name : '';
        const memberRef = typeof member === 'object'
            ? member?.avatar ?? member?.id ?? member?.characterId
            : member;
        const character = characters.find(candidate => [candidate?.avatar, candidate?.id, candidate?.characterId, candidate?.name]
            .some(value => value !== undefined && String(value) === String(memberRef)));
        const name = memberName || character?.name;
        if (name) names.push(name);
    }
    return names;
}

function isPrimaryConversationIdentity(name) {
    const normalizedName = String(name ?? '').trim().toLowerCase();
    if (!normalizedName) return false;
    try {
        const context = getContext();
        const currentCharacter = context?.characters?.[context?.characterId];
        const primaryNames = [
            context?.name1,
            context?.userName,
            context?.user_name,
            context?.name2,
            currentCharacter?.name,
            ...getCurrentGroupCharacterNames(context),
        ].map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
        return primaryNames.includes(normalizedName);
    } catch {
        return false;
    }
}

export function shouldAutoRandomizeNpcGradient(name) {
    return settings.autoRandomNpcGradients === true && !isPrimaryConversationIdentity(name);
}

export function applyGradientPreset(entry, preset) {
    const applied = applyGradientPresetToEntry(entry, preset, applyThemeReadabilityAndBrightness);
    if (!applied) return null;
    entry.baseColor = applied.baseColor;
    entry.color = applied.color;
    entry.gradient = applied.gradient;
    return entry.gradient;
}

export function swapEntryColorData(firstEntry, secondEntry) {
    if (!firstEntry || !secondEntry) return false;
    const first = {
        baseColor: getBaseColor(firstEntry),
        color: getEntryEffectiveColor(firstEntry),
        gradient: cloneGradient(firstEntry.gradient),
    };
    const second = {
        baseColor: getBaseColor(secondEntry),
        color: getEntryEffectiveColor(secondEntry),
        gradient: cloneGradient(secondEntry.gradient),
    };
    Object.assign(firstEntry, second);
    Object.assign(secondEntry, first);
    return true;
}

export function syncAllEffectiveColors() {
    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        if (entry.locked) continue;
        const baseColor = getBaseColor(entry);
        if (baseColor) {
            setEntryFromBaseColor(entry, baseColor);
        }
    }
}

export function collectAssignedColors(excludeKeys = []) {
    const excluded = new Set((Array.isArray(excludeKeys) ? excludeKeys : [excludeKeys])
        .map(key => String(key ?? '').trim().toLowerCase())
        .filter(Boolean));
    const colors = [];
    for (const [key, entry] of Object.entries(characterColors)) {
        if (!entry || excluded.has(key)) continue;
        const color = normalizeHexColor(getEntryEffectiveColor(entry), null);
        if (color && !colors.includes(color)) colors.push(color);
    }
    return colors;
}

export function isAssignedColorConflict(candidateColor, reservedColors = []) {
    const normalizedCandidate = normalizeHexColor(candidateColor, null);
    if (!normalizedCandidate) return true;
    return reservedColors.some(existing => existing === normalizedCandidate || colorDistance(existing, normalizedCandidate));
}

export function resolveUniqueAssignedColor(preferredColor, excludeKeys = []) {
    const reservedColors = collectAssignedColors(excludeKeys);
    const normalizedPreferred = normalizeHexColor(preferredColor, null);
    if (normalizedPreferred && !isAssignedColorConflict(normalizedPreferred, reservedColors)) {
        return { color: normalizedPreferred, remapped: false };
    }

    const candidates = [];
    if (normalizedPreferred) {
        const [h, s, l] = hexToHsl(normalizedPreferred);
        const { minLightness, maxLightness } = getThemeLightnessBounds();
        const lightVariants = [
            l,
            l + 18,
            l - 18,
            l + 30,
            l - 30,
            minLightness,
            maxLightness,
            Math.round((minLightness + maxLightness) / 2),
        ];
        const hueOffsets = [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
        for (const hueOffset of hueOffsets) {
            for (const lightness of lightVariants) {
                candidates.push(hslToHex(
                    (h + hueOffset + 360) % 360,
                    Math.max(35, Math.min(100, s)),
                    Math.max(minLightness, Math.min(maxLightness, Math.round(lightness)))
                ));
            }
        }
    }

    for (let i = 0; i < 24; i++) {
        const seededCandidate = applyThemeReadabilityAndBrightness(getNextColor());
        const [seedH, seedS, seedL] = hexToHsl(seededCandidate);
        candidates.push(seededCandidate);
        candidates.push(hslToHex((seedH + ((i + 1) * 17)) % 360, seedS, seedL));
    }

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeHexColor(candidate, null);
        if (!normalizedCandidate) continue;
        if (!isAssignedColorConflict(normalizedCandidate, reservedColors)) {
            return { color: normalizedCandidate, remapped: true };
        }
    }

    const fallback = normalizeHexColor(applyThemeReadabilityAndBrightness(getNextColor()), normalizedPreferred || '#888888');
    return { color: fallback, remapped: fallback !== normalizedPreferred };
}

// Phase 2B: Prefer characterId over avatar, use ?? for 0-safety

export function buildCharacterEntry(name, options = {}) {
    const trimmedName = String(name ?? '').trim();
    if (!trimmedName) return { key: '', entry: null, remapped: false };

    const key = trimmedName.toLowerCase();
    const colorMode = options.colorMode === 'effective' ? 'effective' : 'base';
    const normalizedSourceColor = normalizeHexColor(options.color, null);
    const fallbackBaseColor = normalizeHexColor(suggestColorForName(trimmedName) || getNextColor());
    const preferredAssignedColor = colorMode === 'effective'
        ? normalizeHexColor(normalizedSourceColor, applyThemeReadabilityAndBrightness(fallbackBaseColor))
        : applyThemeReadabilityAndBrightness(normalizedSourceColor || fallbackBaseColor);
    const { color: assignedColor, remapped } = options.avoidConflicts === false
        ? { color: normalizeHexColor(preferredAssignedColor, '#888888'), remapped: false }
        : resolveUniqueAssignedColor(preferredAssignedColor, [key]);
    const baseColor = colorMode === 'base' && normalizedSourceColor && !remapped
        ? normalizedSourceColor
        : deriveBaseColorFromEffectiveColor(assignedColor);
    const suppliedGradient = synchronizeGradientEffectiveColors(normalizeGradient(options.gradient), applyThemeReadabilityAndBrightness);

    const entry = {
        color: assignedColor,
        baseColor,
        name: trimmedName,
        locked: !!options.locked,
        keep: !!options.keep,
        aliases: normalizeAliases(options.aliases),
        style: VALID_STYLES.has(options.style) ? options.style : '',
        dialogueCount: Number.isFinite(options.dialogueCount) && options.dialogueCount > 0 ? Math.floor(options.dialogueCount) : 0,
        group: String(options.group ?? '').trim(),
        font: normalizeGoogleFontName(options.font),
        gradient: suppliedGradient,
    };
    if (!entry.gradient && options.randomGradient !== false
        && (options.randomGradient === true || shouldAutoRandomizeNpcGradient(trimmedName))) {
        entry.gradient = createRandomGradient(entry, { preserveAnimation: false });
    }

    return {
        key,
        remapped,
        entry,
    };
}
