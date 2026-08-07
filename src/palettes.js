// palettes.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { simulateColorVision } from './color-vision.js';
import { applyGradientPresetToEntry, cloneGradient, colorDistanceOklab, mapGradientStops, normalizeGradient, serializeGradient, synchronizeGradientEffectiveColors } from './gradients.js';
import { MAX_REGISTRY_IDENTITY_LENGTH, applyGroupProfile, migrateLegacyRegistryEntries, normalizeGroupName, normalizeGroupProfiles, normalizeRegistryIdentity, normalizeRegistryIdentityName, resolveGroupAutomation, resolveGroupProfile } from './group-profiles.js';
import { createRestoreSnapshot, showUndoToast } from './history.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, repaintDomAfterCharacterDataChange } from './live-colors.js';
import { callLLMWithProfile } from './llm.js';
import { injectPrompt } from './prompts.js';
import { createPerceptualConflictReport } from './perceptual-conflicts.js';
import { NARRATOR_VISUAL_ID, getNarratorVisual, setNarratorStyle } from './narrator-style.js';
import { GRADIENT_GENERATOR_ALGORITHM, advanceGradientGenerator, generateSeededGradient, normalizeGradientGenerator } from './seeded-gradient-generator.js';
import { escapeHtml, generateQuietPrompt, getContext, power_user } from './st-api.js';
import { characterColors, expandedCharacterRows, groupProfiles, setCharacterColors, setExpandedCharacterRows, setGroupProfiles, setSwapMode, settings, swapMode } from './state.js';
import { getAutoSyncRecord, isPlainObject, persistModuleStore, saveData, saveGlobalSettingsSnapshot } from './storage.js';
import { ASSIGNED_COLOR_MIN_DELTA_E, VALID_STYLES, colorDistance, hexToHsl, hslToHex, normalizeAliases, normalizeCharacterEntry, normalizeEntryGradientGenerator, normalizeGoogleFontName, normalizeHexColor, toast } from './utils.js';

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

let cachedThemeCheckedAt = 0;
let cachedContrastSurface = null;
let cachedContrastSurfaceCheckedAt = 0;
let closeActiveHarmonyPopup = null;

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

// A palette slot counts as taken when the color it would actually render as is already
// on screen. Comparing raw ladder values against stored base colors does not work: the
// stored value has been through a lossy readability pass, so it never matches and the
// ladder hands out its first slot forever.
function isPaletteSlotTaken(candidateColor, reservedColors) {
    return isAssignedColorConflict(applyThemeReadabilityAndBrightness(candidateColor), reservedColors);
}

const PALETTE_JITTER_ATTEMPTS = 12;

// Phase 5C: Handle custom palettes in getNextColor
export function getNextColor() {
    const reservedColors = collectReservedGradientColors();
    if (settings.colorTheme?.startsWith('custom:')) {
        const paletteName = settings.colorTheme.slice(7);
        const customs = getCustomPalettes();
        const palette = customs[paletteName];
        if (palette) {
            for (const color of palette) {
                const normalizedColor = normalizeHexColor(color);
                if (!isPaletteSlotTaken(normalizedColor, reservedColors)) return normalizedColor;
            }
            const jitterCustomSlot = () => {
                const base = palette[Math.floor(Math.random() * palette.length)];
                const [h, s, l] = hexToHsl(base);
                return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, l);
            };
            for (let attempt = 0; attempt < PALETTE_JITTER_ATTEMPTS; attempt++) {
                const jittered = jitterCustomSlot();
                if (!isPaletteSlotTaken(jittered, reservedColors)) return jittered;
            }
            return jitterCustomSlot();
        }
    }
    const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
    const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
    const isDark = mode === 'dark';
    for (const [h, s, l] of theme) {
        const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
        const color = hslToHex(h, s, adjustedL);
        if (!isPaletteSlotTaken(color, reservedColors)) return color;
    }
    const jitterThemeSlot = () => {
        const [h, s] = theme[Math.floor(Math.random() * theme.length)];
        return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, isDark ? 75 : 40);
    };
    for (let attempt = 0; attempt < PALETTE_JITTER_ATTEMPTS; attempt++) {
        const jittered = jitterThemeSlot();
        if (!isPaletteSlotTaken(jittered, reservedColors)) return jittered;
    }
    return jitterThemeSlot();
}

// Pre-compiled color name mapping for faster lookups

// Phase 3B: Optimized conflict check with pre-computed HSL and early-out
export function checkColorConflicts() {
    const report = getPerceptualConflictReport();
    const seen = new Set();
    return report.conflicts.filter(conflict => conflict.type !== 'readability').filter(conflict => {
        const key = [conflict.left.id, conflict.right.id].sort().join('\u0000');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(conflict => [conflict.left.label, conflict.right.label]);
}

function getConflictSurfaceColor() {
    return getContrastSurfaceColor();
}

export function getPerceptualConflictReport(options = {}) {
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    const conflictVisuals = narrator ? [narrator] : [];
    const characterKeys = Object.keys(characterColors).sort((left, right) => left.localeCompare(right));
    for (const key of characterKeys) {
        const entry = characterColors[key] && typeof characterColors[key] === 'object' ? characterColors[key] : {};
        conflictVisuals.push({ ...entry, id: key, label: entry.name || key, kind: 'character' });
    }
    const report = createPerceptualConflictReport(conflictVisuals, {
        modes: options.modes,
        cvdSeverity: options.cvdSeverity ?? 1,
        sampleCount: options.sampleCount,
        conflictDeltaE: options.conflictDeltaE,
        strongConflictDeltaE: options.strongConflictDeltaE,
        comparisonLimit: options.comparisonLimit,
        conflictLimit: options.conflictLimit,
        signal: options.signal,
    });
    const surface = getConflictSurfaceColor();
    report.modes.forEach(mode => {
        const modeSurface = simulateColorVision(surface, mode);
        mode.readability = mode.items.map(item => {
            let minimumRatio = Number.POSITIVE_INFINITY;
            let minimumSample = item.samples[0] || { color: '#888888', position: 0, offset: 0 };
            for (const sample of item.samples) {
                const ratio = getContrastRatio(sample.color, modeSurface);
                if (ratio < minimumRatio) {
                    minimumRatio = ratio;
                    minimumSample = sample;
                }
            }
            return {
                id: item.id,
                label: item.label,
                kind: item.kind,
                minimumRatio: Number(minimumRatio.toFixed(2)),
                level: minimumRatio >= 4.5 ? 'pass' : minimumRatio >= 3 ? 'large-text-only' : 'low',
                sample: { ...minimumSample },
            };
        });
        const readabilityById = new Map(mode.readability.map(item => [item.id, item]));
        mode.conflicts.forEach(conflict => {
            conflict.readability = {
                left: readabilityById.get(conflict.left.id),
                right: readabilityById.get(conflict.right.id),
            };
            const gradientOverlap = conflict.samples.left.position !== 0 || conflict.samples.right.position !== 0;
            conflict.reasons = [
                `${conflict.level === 'strong' ? 'Very small' : 'Small'} perceptual distance (Delta E ${conflict.deltaE}).`,
                gradientOverlap
                    ? `Closest gradient samples occur near ${Math.round(conflict.samples.left.position)}% and ${Math.round(conflict.samples.right.position)}%.`
                    : 'Primary colors are perceptually close.',
            ];
        });
        const readabilityIssues = [];
        for (const readability of mode.readability) {
            if (readability.level === 'pass') continue;
            if (readabilityIssues.length >= report.limits.conflictLimit) {
                mode.truncated.readabilityIssues = true;
                report.truncated.readabilityIssues = true;
                continue;
            }
            readabilityIssues.push({
                type: 'readability',
                left: { id: readability.id, label: readability.label, kind: readability.kind },
                right: { id: '__dc_chat_surface__', label: 'Chat surface', kind: 'surface' },
                level: readability.level === 'low' ? 'strong' : 'potential',
                deltaE: null,
                samples: {
                    left: { ...readability.sample },
                    right: { offset: 0, position: 0, color: modeSurface },
                },
                narration: `${readability.label} does not meet normal-text contrast under ${mode.mode === 'none' ? 'normal color vision' : `${mode.mode} simulation`} (${readability.minimumRatio}:1).`,
                readability: { left: readability, right: null },
                reasons: [`Minimum text contrast is ${readability.minimumRatio}:1; normal text requires 4.5:1.`],
            });
        }
        mode.readabilityIssues = readabilityIssues;
    });
    report.conflicts = [];
    report.readabilityIssues = [];
    for (const mode of report.modes) {
        for (const conflict of mode.conflicts) {
            report.conflicts.push({ mode: mode.mode, severity: mode.severity, ...conflict });
        }
        for (const issue of mode.readabilityIssues) {
            report.readabilityIssues.push({ mode: mode.mode, severity: mode.severity, ...issue });
        }
    }
    report.issues = [...report.conflicts, ...report.readabilityIssues];
    report.partial = Object.values(report.truncated).some(Boolean);
    return report;
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

// Ascending dialogue count means the most-seen characters are generated last, when the
// reserved set is largest, so they are the ones pushed furthest from everyone else.
export function regenerateAllGradients() {
    const sortedEntries = Object.entries(characterColors)
        .filter(([, entry]) => entry.gradient && !entry.locked)
        .sort((a, b) => (a[1].dialogueCount || 0) - (b[1].dialogueCount || 0));
    const changedKeys = [];
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));

    for (const [key, entry] of sortedEntries) {
        const gradient = createRandomGradient(entry);
        if (!gradient) continue;
        setEntryGradient(entry, gradient, { preserveGenerator: true });
        changedKeys.push(key);
    }
    applyLiveColorChangesFromSnapshot(snapshot, changedKeys);
    commit();
    toast.success(`Re-randomized ${changedKeys.length} gradient${changedKeys.length === 1 ? '' : 's'}`);
    return changedKeys;
}

// Phase 4B: Improved conflict resolution feedback listing pairs
export function autoResolveConflicts() {
    const result = repairPerceptualConflicts();
    if (result.partialAnalysis) toast.warning('Conflict repair was not run because the bounded analysis is partial. Review the report or reduce the active character set.');
    else if (!result.initialConflictCount) toast.info('No conflicts found');
    else if (!result.changedKeys.length) toast.warning(`No safe repair was found; ${result.unresolvedCount} conflict${result.unresolvedCount === 1 ? '' : 's'} remain.`);
    else toast.success(`Recolored ${result.changedKeys.length} character${result.changedKeys.length === 1 ? '' : 's'}; ${result.unresolvedCount} conflict${result.unresolvedCount === 1 ? '' : 's'} remain.`);
    return result;
}

function hashRepairValue(value) {
    let hash = 2166136261;
    for (const character of String(value ?? '')) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function buildRepairColor(entry, key, attempt) {
    const [hue, saturation] = hexToHsl(getBaseColor(entry));
    const { minLightness, maxLightness } = getThemeLightnessBounds();
    const hash = hashRepairValue(`${key}:${attempt}`);
    const nextHue = (hue + 47 + ((attempt + 1) * 137.508) + (hash % 31)) % 360;
    const nextSaturation = Math.max(48, Math.min(92, (saturation || 64) + ((hash % 19) - 9)));
    const span = Math.max(1, maxLightness - minLightness);
    const nextLightness = minLightness + ((hash + (attempt * 23)) % (span + 1));
    return hslToHex(nextHue, nextSaturation, nextLightness);
}

function scoreConflictReport(report) {
    return getPerceptualIssues(report).reduce((score, conflict) => {
        if (conflict.type === 'readability') {
            const ratio = Number(conflict.readability?.left?.minimumRatio) || 0;
            return score + 1 + (Math.max(0, 4.5 - ratio) * 4) + (conflict.level === 'strong' ? 4.5 : 0);
        }
        const deficit = Math.max(0, report.thresholds.conflictDeltaE - conflict.deltaE);
        return score + 1 + deficit + (conflict.level === 'strong' ? report.thresholds.conflictDeltaE : 0);
    }, 0);
}

function getPerceptualIssues(report) {
    if (Array.isArray(report?.issues)) return report.issues;
    return [...(report?.conflicts || []), ...(report?.readabilityIssues || [])];
}

function isPartialConflictReport(report) {
    return report?.partial === true || Object.values(report?.truncated || {}).some(Boolean);
}

function canRepairConflictEntry(key) {
    const entry = characterColors[key];
    return !!entry && !entry.locked && !entry.keep && String(entry.name || key).trim().toLowerCase() !== 'narrator';
}

export function repairPerceptualConflicts(options = {}) {
    let report = getPerceptualConflictReport(options);
    const initialConflictCount = getPerceptualIssues(report).length;
    if (isPartialConflictReport(report)) {
        return {
            changedKeys: [],
            initialConflictCount,
            unresolvedCount: initialConflictCount,
            candidateEvaluations: 0,
            iterations: 0,
            budgetExhausted: false,
            cancelled: report.truncated?.cancelled === true,
            partialAnalysis: true,
            report,
        };
    }
    const changedKeys = new Set();
    const blockedPairs = new Set();
    const repairKeys = (report.modes[0]?.items || []).map(item => item.id).filter(key => characterColors[key]);
    const snapshot = captureEffectiveColorSnapshot(repairKeys);
    const maxIterations = Math.max(1, Math.min(16, Number(options.maxIterations) || Math.min(12, Math.max(4, repairKeys.length))));
    const candidateLimit = Math.max(2, Math.min(8, Number(options.candidateLimit) || 6));
    const candidateBudget = Math.max(1, Math.min(48, Number(options.candidateBudget) || 24));
    let candidateEvaluations = 0;
    let iterations = 0;
    let cancelled = options.signal?.aborted === true;

    repairLoop:
    for (let iteration = 0; iteration < maxIterations && getPerceptualIssues(report).length && candidateEvaluations < candidateBudget; iteration++) {
        if (options.signal?.aborted) {
            cancelled = true;
            break;
        }
        iterations++;
        const conflict = getPerceptualIssues(report).find(item => {
            const identities = [item.left, item.right].filter(Boolean);
            const pairKey = [...identities.map(identity => identity.id), item.mode, item.type || 'similarity'].sort().join('\u0000');
            const involvesNarrator = identities.some(identity => identity.kind === 'narrator' || identity.id === NARRATOR_VISUAL_ID);
            return !involvesNarrator && !blockedPairs.has(pairKey)
                && identities.some(identity => canRepairConflictEntry(identity.id));
        });
        if (!conflict) break;
        const identities = [conflict.left, conflict.right].filter(Boolean);
        const pairKey = [...identities.map(identity => identity.id), conflict.mode, conflict.type || 'similarity'].sort().join('\u0000');
        const candidates = identities.map(identity => identity.id)
            .filter(canRepairConflictEntry)
            .sort((left, right) => (characterColors[left].dialogueCount || 0) - (characterColors[right].dialogueCount || 0)
                || characterColors[left].name.localeCompare(characterColors[right].name));
        const key = candidates[0];
        if (!key) {
            blockedPairs.add(pairKey);
            continue;
        }

        const entry = characterColors[key];
        const original = JSON.parse(JSON.stringify(entry));
        const currentScore = scoreConflictReport(report);
        let best = null;
        for (let attempt = 0; attempt < candidateLimit && candidateEvaluations < candidateBudget; attempt++) {
            if (options.signal?.aborted) {
                cancelled = true;
                Object.keys(entry).forEach(property => delete entry[property]);
                Object.assign(entry, original);
                break repairLoop;
            }
            Object.assign(entry, JSON.parse(JSON.stringify(original)));
            setEntryFromBaseColor(entry, buildRepairColor(original, key, attempt));
            candidateEvaluations++;
            const candidateReport = getPerceptualConflictReport(options);
            if (isPartialConflictReport(candidateReport)) continue;
            const candidateScore = scoreConflictReport(candidateReport);
            if (!best || candidateScore < best.score) {
                best = { score: candidateScore, entry: JSON.parse(JSON.stringify(entry)), report: candidateReport };
            }
        }
        if (!best || best.score >= currentScore) {
            Object.keys(entry).forEach(property => delete entry[property]);
            Object.assign(entry, original);
            blockedPairs.add(pairKey);
            continue;
        }
        Object.keys(entry).forEach(property => delete entry[property]);
        Object.assign(entry, best.entry);
        changedKeys.add(key);
        report = best.report;
    }

    const changed = [...changedKeys];
    if (changed.length) {
        applyLiveColorChangesFromSnapshot(snapshot, changed, { saveImmediately: true, repaintStyles: true });
        commit({ data: false });
        saveData({ preserveEffectiveColors: true });
        repaintDomAfterCharacterDataChange(0);
    }
    return {
        changedKeys: changed,
        initialConflictCount,
        unresolvedCount: getPerceptualIssues(report).length,
        candidateEvaluations,
        iterations,
        budgetExhausted: !cancelled && getPerceptualIssues(report).length > 0 && candidateEvaluations >= candidateBudget,
        cancelled,
        partialAnalysis: false,
        report,
    };
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

// Presets are persisted through the registry-identity normalizer, so a name it
// rejects (reserved word, over-length, control characters) or rewrites (collapsed
// whitespace) would be reported as saved and then never appear in the dropdown.
// Resolve the stored name up front so callers can refuse the input instead.
export function resolveColorPresetName(rawName) {
    return normalizeRegistryIdentityName(String(rawName ?? ''), MAX_REGISTRY_IDENTITY_LENGTH);
}

// Phase 5A: Preset management with dropdown UI
export function saveColorPreset() {
    const nameInput = document.getElementById('dc-preset-name');
    const name = resolveColorPresetName(nameInput?.value);
    if (!name) {
        toast.warning(String(nameInput?.value ?? '').trim()
            ? `Preset names must be at most ${MAX_REGISTRY_IDENTITY_LENGTH} characters and cannot be a reserved word or contain control characters.`
            : 'Enter a preset name');
        return;
    }
    const presets = getPresets();
    presets[name] = {
        version: 2,
        entries: Object.entries(characterColors).map(([, v]) => ({
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
            gradientGenerator: normalizeEntryGradientGenerator(v.gradientGenerator, v.gradient),
        })),
        groupProfiles: normalizeGroupProfiles(groupProfiles),
    };
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
    const presetValue = presets[name];
    const presetData = Array.isArray(presetValue) ? presetValue : presetValue?.entries;
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
    if (!Array.isArray(presetValue)) {
        const nextProfiles = normalizeGroupProfiles({ ...groupProfiles, ...presetValue.groupProfiles });
        if (JSON.stringify(nextProfiles) !== JSON.stringify(groupProfiles)) {
            setGroupProfiles(nextProfiles);
            changed = true;
        }
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
    const migrated = migrateLegacyRegistryEntries(raw, { maximum: 120, fallback: 'Custom palette' });
    const cleaned = Object.create(null);
    for (const [name, colors] of Object.entries(migrated.registry)) {
        const palette = Array.isArray(colors)
            ? colors.map(c => normalizeHexColor(c, null)).filter(Boolean)
            : [];
        if (palette.length) cleaned[String(name)] = [...new Set(palette)];
    }
    return cleaned;
}

function resolveCustomPaletteName(customs, rawName) {
    const name = normalizeRegistryIdentityName(rawName, 120);
    const identity = normalizeRegistryIdentity(name, 120);
    if (!name || !identity) return { name: '', existingName: '' };
    const existingName = Object.keys(customs).find(candidate => normalizeRegistryIdentity(candidate, 120) === identity) || '';
    return { name: existingName || name, existingName };
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
    const customs = getCustomPalettes();
    const { name, existingName } = resolveCustomPaletteName(customs, inputName || inlineInputs.name || '');
    if (!name) {
        toast.warning('Enter a palette name first');
        return;
    }
    const notes = String(inputNotes || inlineInputs.notes || '');
    if (existingName && !shouldOverwritePalette()) {
        toast.warning(`Custom palette "${escapeHtml(name)}" exists. Enable "Allow replacing an existing palette" to replace it.`);
        return;
    }
    const originalPalette = existingName ? JSON.stringify(customs[existingName]) : null;

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

    const latestCustoms = getCustomPalettes();
    const latestResolution = resolveCustomPaletteName(latestCustoms, name);
    if ((!existingName && latestResolution.existingName)
        || (existingName && (!latestResolution.existingName
            || JSON.stringify(latestCustoms[latestResolution.existingName]) !== originalPalette))) {
        toast.warning(`Custom palette "${escapeHtml(name)}" changed while it was being generated. Review it and try again.`);
        return;
    }
    const targetName = latestResolution.existingName || latestResolution.name;
    latestCustoms[targetName] = finalPalette;
    saveCustomPalettes(latestCustoms);
    setCustomPaletteMetaEntry(targetName, { source, notes: notes.trim(), createdAt: Date.now() });
    refreshPaletteDropdown();
    const label = source === 'llm' ? 'LLM-enhanced' : (source === 'hybrid-fallback' ? 'local fallback' : 'local');
    toast.success(`Custom palette "${escapeHtml(targetName)}" saved (${label})`);
}

export function saveCustomPalette() {
    const { name: rawName } = getInlinePaletteInputs();
    const customs = getCustomPalettes();
    const { name, existingName } = resolveCustomPaletteName(customs, rawName);
    if (!name) {
        toast.warning('Enter a palette name first');
        return;
    }
    const colors = [...new Set(Object.values(characterColors).map(c => normalizeHexColor(getEntryEffectiveColor(c), null)).filter(Boolean))];
    if (!colors.length) { toast.warning('No characters to save palette from'); return; }
    if (existingName && !shouldOverwritePalette()) {
        toast.warning(`Custom palette "${escapeHtml(name)}" exists. Enable "Allow replacing an existing palette" to replace it.`);
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
    closeActiveHarmonyPopup?.({ restoreFocus: false });
    const char = characterColors[key];
    if (!char) return;
    const suggestions = getHarmonySuggestions(getBaseColor(char));
    const popup = document.createElement('div');
    popup.id = 'dc-harmony-popup';
    popup.className = 'dc-harmony-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-label', `Color harmony suggestions for ${char.name}`);
    const rect = anchorEl.getBoundingClientRect();
    popup.style.left = '0px';
    popup.style.top = '0px';
    popup.innerHTML = suggestions.map(s => `<button type="button" class="dc-harmony-swatch" data-color="${s.color}" aria-label="Use ${s.label} color ${s.color}" title="${s.label}: ${s.color}" style="--dc-harmony-color:${s.color};"><span>${s.label}</span></button>`).join('');
    const popupHost = anchorEl.closest('#dc-ext') || document.body;
    popupHost.appendChild(popup);
    const originRect = popup.getBoundingClientRect();
    popup.style.left = `${rect.left - originRect.left}px`;
    popup.style.top = `${rect.bottom + 4 - originRect.top}px`;
    const popupRect = popup.getBoundingClientRect();
    const vpWidth = window.visualViewport?.width || window.innerWidth;
    const vpHeight = window.visualViewport?.height || window.innerHeight;
    if (popupRect.right > vpWidth - 8) {
        popup.style.left = `${parseFloat(popup.style.left) - (popupRect.right - vpWidth + 8)}px`;
    }
    if (popupRect.bottom > vpHeight - 8) {
        popup.style.top = `${parseFloat(popup.style.top) - (popupRect.bottom - vpHeight + 8)}px`;
    }
    const finalRect = popup.getBoundingClientRect();
    if (finalRect.left < 8) {
        popup.style.left = `${parseFloat(popup.style.left) + (8 - finalRect.left)}px`;
    }
    if (finalRect.top < 8) {
        popup.style.top = `${parseFloat(popup.style.top) + (8 - finalRect.top)}px`;
    }
    let closed = false;
    const close = ({ restoreFocus = true } = {}) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        document.removeEventListener('keydown', onKeyDown, true);
        popup.remove();
        if (closeActiveHarmonyPopup === close) closeActiveHarmonyPopup = null;
        if (restoreFocus && anchorEl?.isConnected) anchorEl.focus({ preventScroll: true });
    };
    closeActiveHarmonyPopup = close;
    const onOutsidePointer = event => { if (!popup.contains(event.target) && event.target !== anchorEl) close({ restoreFocus: false }); };
    const onKeyDown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const swatches = [...popup.querySelectorAll('.dc-harmony-swatch')];
        if (!swatches.length) return;
        const first = swatches[0];
        const last = swatches[swatches.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    popup.querySelectorAll('.dc-harmony-swatch').forEach(swatch => {
        swatch.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const nextColor = swatch.dataset.color;
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            setEntryFromBaseColor(char, nextColor);
            applyLiveColorChangesFromSnapshot(snapshot, [key]);
            commit();
            const restoreKeyboardFocus = event.detail === 0;
            close({ restoreFocus: false });
            if (restoreKeyboardFocus) {
                requestAnimationFrame(() => {
                    document.querySelector(`.dc-char[data-key="${CSS.escape(key)}"] .dc-harmony`)?.focus({ preventScroll: true });
                });
            }
        };
    });
    setTimeout(() => {
        document.addEventListener('pointerdown', onOutsidePointer, true);
        document.addEventListener('keydown', onKeyDown, true);
    }, 0);
    popup.querySelector('.dc-harmony-swatch')?.focus({ preventScroll: true });
}

export function detectTheme() {
    const now = Date.now();
    if (cachedTheme && now - cachedThemeCheckedAt < 250) return cachedTheme;
    const background = getComputedStyle(document.body).backgroundColor || '';
    cachedThemeCheckedAt = now;
    if (cachedTheme && background === cachedThemeBackground) return cachedTheme;
    const bodyColor = parseCssColor(background);
    // A transparent body means the visible backdrop is whatever layers sit above it,
    // composited over the browser's white default canvas — judging the raw rgba(0,0,0,0)
    // used to read every image/overlay theme as dark.
    const surface = bodyColor && bodyColor.a > 0
        ? bodyColor
        : compositeSurfaceOver({ r: 255, g: 255, b: 255, a: 1 });
    cachedTheme = (surface.r * 299 + surface.g * 587 + surface.b * 114) / 1000 < 128 ? 'dark' : 'light';
    cachedThemeBackground = background;
    return cachedTheme;
}

export function invalidateThemeCache() {
    cachedTheme = null;
    cachedThemeBackground = null;
    cachedThemeCheckedAt = 0;
    cachedContrastSurface = null;
    cachedContrastSurfaceCheckedAt = 0;
}

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

function parseCssColor(value) {
    const normalizedHex = normalizeHexColor(value, null);
    if (normalizedHex) {
        return {
            r: parseInt(normalizedHex.slice(1, 3), 16),
            g: parseInt(normalizedHex.slice(3, 5), 16),
            b: parseInt(normalizedHex.slice(5, 7), 16),
            a: 1,
        };
    }
    const match = String(value || '').match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (!match) return null;
    const alpha = match[4]?.endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4] ?? 1);
    return {
        r: Math.max(0, Math.min(255, Number(match[1]))),
        g: Math.max(0, Math.min(255, Number(match[2]))),
        b: Math.max(0, Math.min(255, Number(match[3]))),
        a: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
    };
}

function rgbToHex({ r, g, b }) {
    const channel = value => Math.round(value).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function compositeSurfaceOver(base) {
    const target = document.querySelector('#chat .mes_text, .mes_text') || document.body;
    const ancestors = [];
    for (let element = target; element; element = element.parentElement) ancestors.push(element);
    let surface = base;
    for (const element of ancestors.reverse()) {
        const layer = parseCssColor(getComputedStyle(element).backgroundColor);
        if (!layer || layer.a <= 0) continue;
        surface = {
            r: layer.r * layer.a + surface.r * (1 - layer.a),
            g: layer.g * layer.a + surface.g * (1 - layer.a),
            b: layer.b * layer.a + surface.b * (1 - layer.a),
            a: 1,
        };
    }
    return surface;
}

export function getContrastSurfaceColor() {
    // A forced theme mode pins the readability target too; otherwise a misdetected
    // page surface silently drags every color back toward the wrong pole.
    if (typeof document === 'undefined' || settings.themeMode !== 'auto') {
        return settings.themeMode === 'dark' ? '#202328' : '#f5f5f5';
    }
    const now = Date.now();
    if (cachedContrastSurface && now - cachedContrastSurfaceCheckedAt < 250) return cachedContrastSurface;
    const fallback = detectTheme() === 'dark'
        ? { r: 32, g: 35, b: 40, a: 1 }
        : { r: 245, g: 245, b: 245, a: 1 };
    cachedContrastSurface = rgbToHex(compositeSurfaceOver(fallback));
    cachedContrastSurfaceCheckedAt = now;
    return cachedContrastSurface;
}

function relativeLuminance(hexColor) {
    const color = parseCssColor(hexColor) || { r: 0, g: 0, b: 0 };
    const linear = channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return linear(color.r) * 0.2126 + linear(color.g) * 0.7152 + linear(color.b) * 0.0722;
}

export function getContrastRatio(foreground, background) {
    const first = relativeLuminance(normalizeHexColor(foreground));
    const second = relativeLuminance(normalizeHexColor(background));
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

export function ensureReadableContrast(hexColor, surfaceColor = null, minimumRatio = 4.5) {
    const normalized = normalizeHexColor(hexColor);
    const surface = normalizeHexColor(surfaceColor, null) || getContrastSurfaceColor();
    if (getContrastRatio(normalized, surface) >= minimumRatio) return normalized;
    const [hue, saturation, lightness] = hexToHsl(normalized);
    const towardLight = getContrastRatio('#ffffff', surface) >= getContrastRatio('#000000', surface);
    const end = towardLight ? 100 : 0;
    const direction = towardLight ? 1 : -1;
    for (let nextLightness = lightness + direction; towardLight ? nextLightness <= end : nextLightness >= end; nextLightness += direction) {
        const candidate = hslToHex(hue, saturation, nextLightness);
        if (getContrastRatio(candidate, surface) >= minimumRatio) return candidate;
    }
    return towardLight ? '#ffffff' : '#000000';
}

export function getReadableSurfaceSignature() {
    return getContrastSurfaceColor();
}

// The slider walks a share of the distance to the theme lightness bound instead of adding raw
// lightness points. A -100..100 offset against a band only ~47 wide pushed every color onto the
// same lightness, and characters became indistinguishable. Stopping short of the bound keeps
// distinct inputs mapping to distinct outputs even at the extremes.
export const BRIGHTNESS_HEADROOM_SHARE = 0.85;

// Base lightness never reaches 0 or 100, where hue and saturation stop existing and every
// character would round-trip to the same black or white.
const MIN_BASE_LIGHTNESS = 8;
const MAX_BASE_LIGHTNESS = 92;

// HSL chroma is (1 - |2L - 1|) * S, so lifting lightness drains color even when saturation
// is untouched. This is the factor that has to be defended when brightness moves.
function chromaFactor(lightness) {
    return 1 - Math.abs((2 * lightness / 100) - 1);
}

// The slider always walks a share of the distance to one bound; only which bound changes with
// its sign. Both directions read this one pair, so the inverse cannot fall out of step with the
// pass it undoes.
function getBrightnessTravel() {
    const { minLightness, maxLightness } = getThemeLightnessBounds();
    const share = (getBrightnessOffset() / 100) * BRIGHTNESS_HEADROOM_SHARE;
    return {
        amount: Math.abs(share),
        bound: share >= 0 ? maxLightness : minLightness,
        minLightness,
        maxLightness,
    };
}

// The lightness band colors actually land in once brightness is applied. The prompt builders
// describe this to the model, which reads a raw slider value as an instruction to go white.
export function getBrightnessTargetLightnessRange() {
    const { amount, bound, minLightness, maxLightness } = getBrightnessTravel();
    const travel = lightness => Math.round(lightness + (amount * (bound - lightness)));
    return { minLightness: travel(minLightness), maxLightness: travel(maxLightness) };
}

// Repairing a flattened base color cannot recover the lightness that was thrown away, so it
// re-homes the color inside this window instead. Staying clear of the theme's own bounds is
// what stops a repaired color from coming back sitting on the rail it was flattened onto.
export function getRepairedBaseLightnessWindow() {
    const { minLightness, maxLightness } = getThemeLightnessBounds();
    const margin = Math.round((maxLightness - minLightness) * 0.25);
    return { floor: minLightness + margin, ceiling: maxLightness - margin };
}

function compensateSaturation(saturation, fromLightness, toLightness) {
    const toFactor = chromaFactor(toLightness);
    if (toFactor <= 0) return saturation;
    // Only ever raise saturation: darkening already gains chroma, and pulling it down there
    // would wash colors out from the other end.
    return Math.max(saturation, Math.min(100, saturation * chromaFactor(fromLightness) / toFactor));
}

export function applyThemeReadabilityAndBrightness(hexColor) {
    const normalized = normalizeHexColor(hexColor);
    const [h, s, l] = hexToHsl(normalized);
    const { amount, bound, minLightness, maxLightness } = getBrightnessTravel();
    const adjustedL = Math.max(minLightness, Math.min(maxLightness, l + (amount * (bound - l))));
    return ensureReadableContrast(hslToHex(h, compensateSaturation(s, l, adjustedL), adjustedL));
}

export function deriveBaseColorFromEffectiveColor(hexColor) {
    const normalized = normalizeHexColor(hexColor);
    const [h, s, l] = hexToHsl(normalized);
    const { amount, bound } = getBrightnessTravel();
    // Inverse of the travel above. The headroom cap keeps 1 - amount at or above 0.15, so the
    // division stays well conditioned at both ends of the slider.
    const baseL = Math.max(MIN_BASE_LIGHTNESS, Math.min(MAX_BASE_LIGHTNESS, (l - (amount * bound)) / (1 - amount)));
    // Saturation was raised on the way out, so lower it by the same ratio. Hue is never touched
    // in either direction.
    const baseS = Math.max(0, Math.min(100, s * chromaFactor(l) / chromaFactor(baseL)));
    return hslToHex(h, Math.min(s, baseS), baseL);
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
    const normalizedEffective = ensureReadableContrast(normalizeHexColor(effectiveColor, getEntryEffectiveColor(entry)));
    // Store the pair syncAllEffectiveColors() would settle on rather than the requested color
    // verbatim. Every saveData() regenerates color from baseColor, and deriving a base is lossy,
    // so keeping the raw pick made the entry drift on the very next save - away from the color
    // already written into the chat text, which is the key that text is decorated by. The quote
    // the user had just recolored then matched no character and lost its gradient, font and style.
    return setEntryFromBaseColor(entry, deriveBaseColorFromEffectiveColor(normalizedEffective));
}

export function setEntryGradient(entry, gradient, options = {}) {
    if (!entry) return null;
    entry.gradient = synchronizeGradientEffectiveColors(normalizeGradient(gradient), applyThemeReadabilityAndBrightness);
    if (options.preserveGenerator !== true) entry.gradientGenerator = null;
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

export function canonicalizeGradientCharacterName(name) {
    return String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function createGradientRandomMasterSeed() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID().slice(0, 128);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const values = new Uint32Array(4);
        globalThis.crypto.getRandomValues(values);
        return [...values].map(value => value.toString(16).padStart(8, '0')).join('').slice(0, 128);
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`.slice(0, 128);
}

export function ensureGradientRandomMasterSeed() {
    const current = String(settings.gradientRandomMasterSeed ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128);
    if (current) {
        settings.gradientRandomMasterSeed = current;
        return current;
    }
    settings.gradientRandomMasterSeed = createGradientRandomMasterSeed();
    saveGlobalSettingsSnapshot({ immediate: true });
    return settings.gradientRandomMasterSeed;
}

// Every color other characters already display, so a new gradient can be pushed away
// from them. Rendered colors are used because that is what a reader actually compares.
export function collectReservedGradientColors(excludeName = '') {
    const excluded = canonicalizeGradientCharacterName(excludeName);
    const colors = new Set();
    for (const entry of Object.values(characterColors)) {
        if (!entry || canonicalizeGradientCharacterName(entry.name) === excluded) continue;
        const baseColor = normalizeHexColor(getEntryEffectiveColor(entry), null);
        if (baseColor) colors.add(baseColor);
        for (const stop of entry.gradient?.stops || []) {
            const stopColor = normalizeHexColor(stop.color || stop.baseColor, null);
            if (stopColor) colors.add(stopColor);
        }
    }
    return [...colors];
}

export function createRandomGradient(entry, options = {}) {
    if (!entry) return null;
    const animation = options.preserveAnimation === false ? null : normalizeGradient(entry.gradient)?.animation;
    const masterSeed = ensureGradientRandomMasterSeed();
    const seed = `${masterSeed}\u001f${canonicalizeGradientCharacterName(entry.name)}`;
    const existing = normalizeEntryGradientGenerator(entry.gradientGenerator, entry.gradient);
    let generator = normalizeGradientGenerator({ algorithm: GRADIENT_GENERATOR_ALGORITHM, seed, iteration: 0 });
    if (Number.isFinite(Number(options.iteration))) {
        generator.iteration = Math.max(0, Math.floor(Number(options.iteration)));
    } else if (options.initial !== true && existing?.seed === seed) {
        generator = advanceGradientGenerator(existing);
    }
    const generated = generateSeededGradient(getBaseColor(entry), generator, {
        palette: getActiveGradientPaletteColors(),
        animation: animation || undefined,
        totalStops: options.totalStops,
        transformColor: applyThemeReadabilityAndBrightness,
        hueSpread: true,
        reservedColors: collectReservedGradientColors(entry.name),
    });
    entry.gradientGenerator = generated.generator;
    return synchronizeGradientEffectiveColors(generated.gradient, applyThemeReadabilityAndBrightness);
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

// SillyTavern resolves the persona label the same way: the per-avatar name when one
// is set, otherwise the active user name.
export function getPersonaName() {
    try {
        const context = getContext();
        const avatarName = power_user?.personas?.[context?.userAvatar];
        return normalizeRegistryIdentityName(avatarName || context?.name1 || '');
    } catch {
        return '';
    }
}

function isPrimaryConversationIdentity(name) {
    const normalizedName = String(name ?? '').trim().toLowerCase();
    if (!normalizedName) return false;
    try {
        const context = getContext();
        const currentCharacter = context?.characters?.[context?.characterId];
        const primaryNames = [
            getPersonaName(),
            context?.name1,
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

export function shouldAutoRandomizeGradient(name) {
    return settings.autoRandomAllGradients === true || shouldAutoRandomizeNpcGradient(name);
}

export function applyGradientPreset(entry, preset) {
    const applied = applyGradientPresetToEntry(entry, preset, applyThemeReadabilityAndBrightness);
    if (!applied) return null;
    entry.baseColor = applied.baseColor;
    entry.color = applied.color;
    entry.gradient = applied.gradient;
    entry.gradientGenerator = null;
    return entry.gradient;
}

export function swapEntryColorData(firstEntry, secondEntry) {
    if (!firstEntry || !secondEntry) return false;
    const first = {
        baseColor: getBaseColor(firstEntry),
        color: getEntryEffectiveColor(firstEntry),
        gradient: cloneGradient(firstEntry.gradient),
        gradientGenerator: normalizeEntryGradientGenerator(firstEntry.gradientGenerator, firstEntry.gradient),
    };
    const second = {
        baseColor: getBaseColor(secondEntry),
        color: getEntryEffectiveColor(secondEntry),
        gradient: cloneGradient(secondEntry.gradient),
        gradientGenerator: normalizeEntryGradientGenerator(secondEntry.gradientGenerator, secondEntry.gradient),
    };
    Object.assign(firstEntry, second);
    Object.assign(secondEntry, first);
    return true;
}

export function syncAllEffectiveColors() {
    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        const baseColor = getBaseColor(entry);
        if (baseColor) {
            setEntryFromBaseColor(entry, baseColor);
        }
    }
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
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

// Distinctness is only guaranteed at the brightness the colors were assigned under: two bases
// that render far apart at one slider position can render close together at another. Checking
// the base colors as well keeps characters apart wherever the slider ends up.
export function collectAssignedBaseColors(excludeKeys = []) {
    const excluded = new Set((Array.isArray(excludeKeys) ? excludeKeys : [excludeKeys])
        .map(key => String(key ?? '').trim().toLowerCase())
        .filter(Boolean));
    const colors = [];
    for (const [key, entry] of Object.entries(characterColors)) {
        if (!entry || excluded.has(key)) continue;
        const color = normalizeHexColor(getBaseColor(entry), null);
        if (color && !colors.includes(color)) colors.push(color);
    }
    return colors;
}

// How far a candidate sits from the nearest color already in use. Only meaningful for ranking
// candidates that all collide; use isAssignedColorConflict to decide whether one is acceptable.
export function assignedColorSeparation(candidateColor, reservedColors = []) {
    const normalizedCandidate = normalizeHexColor(candidateColor, null);
    if (!normalizedCandidate || !reservedColors.length) return Infinity;
    return reservedColors.reduce(
        (closest, existing) => Math.min(closest, colorDistanceOklab(existing, normalizedCandidate)),
        Infinity
    );
}

export function isAssignedColorConflict(candidateColor, reservedColors = []) {
    const normalizedCandidate = normalizeHexColor(candidateColor, null);
    if (!normalizedCandidate) return true;
    return reservedColors.some(existing => existing === normalizedCandidate
        || colorDistanceOklab(existing, normalizedCandidate) < ASSIGNED_COLOR_MIN_DELTA_E
        || colorDistance(existing, normalizedCandidate));
}

// Candidates carry the base color they were rendered from wherever that is known, so the caller
// never has to run a lossy pass backwards to recover it. options.baseColor is the base the
// preferred color came from.
export function resolveUniqueAssignedColor(preferredColor, excludeKeys = [], options = {}) {
    const reservedColors = collectAssignedColors(excludeKeys);
    const reservedBaseColors = collectAssignedBaseColors(excludeKeys);
    const normalizedPreferred = normalizeHexColor(preferredColor, null);
    const preferredBaseColor = normalizeHexColor(options.baseColor, null);
    const resolveBaseColor = (candidate, knownBaseColor) => knownBaseColor || deriveBaseColorFromEffectiveColor(candidate);
    if (normalizedPreferred && !isAssignedColorConflict(normalizedPreferred, reservedColors)) {
        const baseColor = resolveBaseColor(normalizedPreferred, preferredBaseColor);
        if (!isAssignedColorConflict(baseColor, reservedBaseColors)) {
            return { color: normalizedPreferred, baseColor, remapped: false };
        }
    }

    // Replacement candidates are built in base space and rendered to be tested. Building them in
    // rendered space instead lets the search settle on a color no base can reproduce, and the
    // entry's two halves then disagree the next time effective colors are synchronized.
    const candidateBaseColors = [];
    const variantBaseColor = preferredBaseColor
        || (normalizedPreferred ? deriveBaseColorFromEffectiveColor(normalizedPreferred) : null);
    if (variantBaseColor) {
        const [h, s, l] = hexToHsl(variantBaseColor);
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
                candidateBaseColors.push(hslToHex(
                    (h + hueOffset + 360) % 360,
                    // A palette with no color in it stays that way. Flooring saturation here
                    // turns a deliberately grey palette into brown the moment the ladder runs
                    // out of slots.
                    s <= 0 ? 0 : Math.max(35, Math.min(100, s)),
                    Math.max(MIN_BASE_LIGHTNESS, Math.min(MAX_BASE_LIGHTNESS, Math.round(lightness)))
                ));
            }
        }
        // Rotating the hue does nothing to a color that has none, so a greyscale palette has
        // only lightness left to tell characters apart. Sweeping the band keeps its eighth grey
        // from coming back as a repeat of its third.
        for (let lightness = MIN_BASE_LIGHTNESS; lightness <= MAX_BASE_LIGHTNESS; lightness += 5) {
            candidateBaseColors.push(hslToHex(h, s, lightness));
        }
    }

    for (let i = 0; i < 24; i++) {
        const seededBaseColor = getNextColor();
        const [seedH, seedS, seedL] = hexToHsl(seededBaseColor);
        candidateBaseColors.push(seededBaseColor);
        candidateBaseColors.push(hslToHex((seedH + ((i + 1) * 17)) % 360, seedS, seedL));
    }

    let widestApart = null;
    for (const candidateBaseColor of candidateBaseColors) {
        const rendered = applyThemeReadabilityAndBrightness(candidateBaseColor);
        if (!isAssignedColorConflict(rendered, reservedColors)
            && !isAssignedColorConflict(candidateBaseColor, reservedBaseColors)) {
            return { color: rendered, baseColor: candidateBaseColor, remapped: true };
        }
        // Once the cast outgrows the palette every candidate collides with something. Keep the
        // one that sits furthest from what is already on screen, so the last resort is the best
        // separation available rather than an unchecked draw. An exact repeat is never it: two
        // characters sharing a color outright is worse than two that merely look alike.
        if (reservedColors.includes(rendered) || reservedBaseColors.includes(candidateBaseColor)) continue;
        const separation = Math.min(
            assignedColorSeparation(rendered, reservedColors),
            assignedColorSeparation(candidateBaseColor, reservedBaseColors)
        );
        if (!widestApart || separation > widestApart.separation) {
            widestApart = { color: rendered, baseColor: candidateBaseColor, separation };
        }
    }

    if (widestApart) {
        return { color: widestApart.color, baseColor: widestApart.baseColor, remapped: widestApart.color !== normalizedPreferred };
    }

    const fallbackBaseColor = getNextColor();
    const rendered = applyThemeReadabilityAndBrightness(fallbackBaseColor);
    const fallback = normalizeHexColor(rendered, normalizedPreferred || '#888888');
    return {
        color: fallback,
        baseColor: resolveBaseColor(fallback, fallback === rendered ? fallbackBaseColor : null),
        remapped: fallback !== normalizedPreferred,
    };
}

// Phase 2B: Prefer characterId over avatar, use ?? for 0-safety

export function buildCharacterEntry(name, options = {}) {
    // Key on the same normalized identity the registry uses, otherwise the entry is
    // re-keyed or dropped by normalizeCharacterColors and recreated on the next pass.
    const trimmedName = normalizeRegistryIdentityName(String(name ?? ''));
    if (!trimmedName || trimmedName.toLowerCase() === 'narrator') return { key: '', entry: null, remapped: false };

    const key = normalizeRegistryIdentity(trimmedName);
    const colorMode = options.colorMode === 'effective' ? 'effective' : 'base';
    const normalizedSourceColor = normalizeHexColor(options.color, null);
    const fallbackBaseColor = normalizeHexColor(suggestColorForName(trimmedName) || getNextColor());
    const preferredAssignedColor = colorMode === 'effective'
        ? normalizeHexColor(normalizedSourceColor, applyThemeReadabilityAndBrightness(fallbackBaseColor))
        : applyThemeReadabilityAndBrightness(normalizedSourceColor || fallbackBaseColor);
    // The base the preferred color was rendered from, when it is known. Only an effective color
    // handed in from outside leaves it unknown.
    const preferredBaseColor = colorMode === 'effective'
        ? (normalizedSourceColor ? null : fallbackBaseColor)
        : (normalizedSourceColor || fallbackBaseColor);
    const assignment = options.avoidConflicts === false
        ? { color: normalizeHexColor(preferredAssignedColor, '#888888'), baseColor: preferredBaseColor, remapped: false }
        : resolveUniqueAssignedColor(preferredAssignedColor, [key], { baseColor: preferredBaseColor });
    const { color: assignedColor, remapped } = assignment;
    const baseColor = normalizeHexColor(assignment.baseColor, deriveBaseColorFromEffectiveColor(assignedColor));
    const suppliedGradient = synchronizeGradientEffectiveColors(normalizeGradient(options.gradient), applyThemeReadabilityAndBrightness);

    const origin = String(options.origin ?? 'runtime').trim().toLowerCase();
    const bypassAutomation = ['import', 'preset', 'undo'].includes(origin);
    const group = normalizeGroupName(options.group);
    const profile = bypassAutomation ? null : resolveGroupProfile(groupProfiles, group);
    const locked = resolveGroupAutomation(profile, 'autoLock', {
        hasExplicit: Object.prototype.hasOwnProperty.call(options, 'locked'),
        explicit: options.locked === true,
        globalValue: bypassAutomation ? undefined : settings.autoLockDetected !== false,
        defaultValue: false,
    });
    const randomGradient = resolveGroupAutomation(profile, 'randomGradient', {
        hasExplicit: Object.prototype.hasOwnProperty.call(options, 'randomGradient'),
        explicit: options.randomGradient === true,
        globalValue: bypassAutomation ? undefined : shouldAutoRandomizeGradient(trimmedName),
        defaultValue: false,
    });
    const applyStyleOnCreate = !!profile && resolveGroupAutomation(profile, 'applyStyleOnCreate', {
        hasExplicit: Object.prototype.hasOwnProperty.call(options, 'applyStyleOnCreate'),
        explicit: options.applyStyleOnCreate === true,
        defaultValue: false,
    });

    const entry = {
        color: assignedColor,
        baseColor,
        name: trimmedName,
        locked,
        keep: !!options.keep,
        aliases: normalizeAliases(options.aliases),
        style: VALID_STYLES.has(options.style) ? options.style : '',
        dialogueCount: Number.isFinite(options.dialogueCount) && options.dialogueCount > 0 ? Math.floor(options.dialogueCount) : 0,
        group,
        font: normalizeGoogleFontName(options.font),
        gradient: suppliedGradient,
        gradientGenerator: normalizeEntryGradientGenerator(options.gradientGenerator, suppliedGradient),
    };
    if (applyStyleOnCreate) {
        const changedFields = applyGroupProfile(entry, profile);
        if (changedFields.includes('baseColor')) setEntryFromBaseColor(entry, getBaseColor(entry));
        else if (changedFields.includes('gradient')) setEntryGradient(entry, entry.gradient);
    }
    if (!entry.gradient && randomGradient) {
        entry.gradient = createRandomGradient(entry, { preserveAnimation: false, initial: true });
    }

    return {
        key,
        remapped,
        entry,
    };
}
