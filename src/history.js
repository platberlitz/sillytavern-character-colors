// history.js - extracted from index.js (mechanical split)
import { normalizeGroupProfiles } from './group-profiles.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit, refreshEffectiveColorsAfterRestore } from './live-colors.js';
import { normalizeNarratorStyle, setNarratorStyle } from './narrator-style.js';
import { characterColors, colorHistory, expandedCharacterRows, groupProfiles, historyIndex, selectedCharacterKeys, setCharacterColors, setColorHistory, setExpandedCharacterRows, setGroupProfiles, setHistoryIndex, setSwapMode, settings, swapMode } from './state.js';

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
    const dataSnapshot = createHistorySnapshot();
    const expandedSnapshot = [...expandedCharacterRows];
    const swapSnapshot = swapMode;
    return function() {
        restoreHistorySnapshot(dataSnapshot, { history: true, expanded: expandedSnapshot, swap: swapSnapshot });
    };
}

export function showUndoToast(message, restoreFn) {
    if (settings.disableToasts) return;
    if (!toastr?.info) return;
    toastr.info(`${message} Click this toast to undo.`, 'Undo Available', {
        closeButton: true,
        tapToDismiss: false,
        timeOut: 7000,
        extendedTimeOut: 3000,
        onclick: typeof restoreFn === 'function' ? restoreFn : () => undo()
    });
}
