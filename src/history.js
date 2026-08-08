// history.js - extracted from index.js (mechanical split)
import { normalizeGroupProfiles } from './group-profiles.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, refreshEffectiveColorsAfterRestore } from './live-colors.js';
import { normalizeNarratorStyle, setNarratorStyle } from './narrator-style.js';
import { characterColors, colorHistory, expandedCharacterRows, groupProfiles, historyIndex, lastCharKey, selectedCharacterKeys, setCharacterColors, setColorHistory, setExpandedCharacterRows, setGroupProfiles, setHistoryIndex, setSwapMode, settings, swapMode } from './state.js';

export function createHistorySnapshot(colors = characterColors, profiles = groupProfiles, narratorSource = settings) {
    const narratorStyle = normalizeNarratorStyle(narratorSource?.narratorStyle ?? narratorSource, { legacy: narratorSource });
    return JSON.stringify({ version: 3, colors, groupProfiles: profiles, narratorStyle });
}

export function parseHistorySnapshot(snapshot) {
    let parsed;
    try {
        parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    } catch {
        parsed = {};
    }
    if (parsed && typeof parsed.colors === 'object' && parsed.colors !== null && !Array.isArray(parsed.colors)) {
        return {
            version: parsed.version || 1,
            colors: parsed.colors,
            groupProfiles: normalizeGroupProfiles(parsed.groupProfiles),
            narratorStyle: (parsed.version === 3 || parsed.narratorStyle) ? normalizeNarratorStyle(parsed.narratorStyle) : null,
        };
    }
    return {
        version: 1,
        colors: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
        groupProfiles: {},
        narratorStyle: null,
    };
}

function pruneRuntimeCharacterState() {
    for (const key of selectedCharacterKeys) {
        if (!characterColors[key]) selectedCharacterKeys.delete(key);
    }
    setExpandedCharacterRows(new Set([...expandedCharacterRows].filter(key => characterColors[key])));
    if (swapMode && !characterColors[swapMode]) setSwapMode(null);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function restoreAppliedChanges(base, applied, current) {
    const baseObject = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    const appliedObject = applied && typeof applied === 'object' && !Array.isArray(applied) ? applied : {};
    const currentObject = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const restored = cloneJson(currentObject);
    for (const key of new Set([...Object.keys(baseObject), ...Object.keys(appliedObject)])) {
        const baseHas = Object.prototype.hasOwnProperty.call(baseObject, key);
        const appliedHas = Object.prototype.hasOwnProperty.call(appliedObject, key);
        const currentHas = Object.prototype.hasOwnProperty.call(currentObject, key);
        if (baseHas === appliedHas && (!baseHas || jsonEqual(baseObject[key], appliedObject[key]))) continue;
        if (currentHas === appliedHas && (!currentHas || jsonEqual(currentObject[key], appliedObject[key]))) {
            if (baseHas) restored[key] = cloneJson(baseObject[key]);
            else delete restored[key];
        } else if (appliedHas && currentHas
            && appliedObject[key] && typeof appliedObject[key] === 'object' && !Array.isArray(appliedObject[key])
            && (!baseHas || (baseObject[key] && typeof baseObject[key] === 'object' && !Array.isArray(baseObject[key])))) {
            restored[key] = restoreAppliedChanges(baseObject[key], appliedObject[key], currentObject[key]);
        }
    }
    return restored;
}

function restoreHistorySnapshot(snapshot, { history = false, expanded = null, swap = undefined } = {}) {
    const previousColors = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const previousKeys = Object.keys(characterColors);
    const parsed = parseHistorySnapshot(snapshot);
    setCharacterColors(JSON.parse(JSON.stringify(parsed.colors)));
    setGroupProfiles(parsed.groupProfiles);
    if (parsed.narratorStyle) setNarratorStyle(settings, parsed.narratorStyle);
    if (expanded) setExpandedCharacterRows(new Set(expanded));
    if (swap !== undefined) setSwapMode(swap);
    pruneRuntimeCharacterState();
    refreshEffectiveColorsAfterRestore();
    const renderKeys = [...new Set([...previousKeys, ...Object.keys(characterColors)])];
    applyLiveColorChangesFromSnapshot(previousColors, renderKeys, { saveImmediately: true, repaintStyles: true });
    commit({ history });
}

export function saveHistory() {
    setColorHistory(colorHistory.slice(0, historyIndex + 1));
    colorHistory.push(createHistorySnapshot());
    if (colorHistory.length > 20) colorHistory.shift();
    setHistoryIndex(colorHistory.length - 1);
}

export function undo() {
    if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        restoreHistorySnapshot(colorHistory[historyIndex]);
    }
}

export function redo() {
    if (historyIndex < colorHistory.length - 1) {
        setHistoryIndex(historyIndex + 1);
        restoreHistorySnapshot(colorHistory[historyIndex]);
    }
}

export function createRestoreSnapshot() {
    const scopeFingerprint = `${settings.colorStorageScope}\u0000${lastCharKey ?? ''}`;
    const base = {
        ...parseHistorySnapshot(createHistorySnapshot()),
        expanded: [...expandedCharacterRows],
        swap: swapMode,
    };
    let applied = null;
    const capture = () => {
        if (applied) return;
        applied = {
            ...parseHistorySnapshot(createHistorySnapshot()),
            expanded: [...expandedCharacterRows],
            swap: swapMode,
        };
    };
    const restore = function() {
        if (`${settings.colorStorageScope}\u0000${lastCharKey ?? ''}` !== scopeFingerprint) return false;
        capture();
        const current = parseHistorySnapshot(createHistorySnapshot());
        const colors = restoreAppliedChanges(base.colors, applied.colors, current.colors);
        const profiles = restoreAppliedChanges(base.groupProfiles, applied.groupProfiles, current.groupProfiles);
        const narratorStyle = restoreAppliedChanges(base.narratorStyle, applied.narratorStyle, current.narratorStyle);
        const currentExpanded = [...expandedCharacterRows];
        restoreHistorySnapshot(createHistorySnapshot(colors, profiles, { narratorStyle }), {
            history: true,
            expanded: jsonEqual(currentExpanded, applied.expanded) ? base.expanded : currentExpanded,
            swap: jsonEqual(swapMode, applied.swap) ? base.swap : swapMode,
        });
        return true;
    };
    restore.capture = capture;
    queueMicrotask(capture);
    return restore;
}

export function showUndoToast(message, restoreFn) {
    if (settings.disableToasts) return;
    if (!toastr?.info) return;
    restoreFn?.capture?.();
    toastr.info(`${message} Click this toast to undo.`, 'Undo Available', {
        closeButton: true,
        tapToDismiss: false,
        timeOut: 7000,
        extendedTimeOut: 3000,
        onclick: typeof restoreFn === 'function' ? restoreFn : () => undo()
    });
}
