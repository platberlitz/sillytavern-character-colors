// history.js - extracted from index.js (mechanical split)
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit } from './live-colors.js';
import { characterColors, colorHistory, expandedCharacterRows, historyIndex, setCharacterColors, setColorHistory, setExpandedCharacterRows, setHistoryIndex, setSwapMode, settings, swapMode } from './state.js';

export function saveHistory() {
    setColorHistory(colorHistory.slice(0, historyIndex + 1));
    colorHistory.push(JSON.stringify(characterColors));
    if (colorHistory.length > 20) colorHistory.shift();
    setHistoryIndex(colorHistory.length - 1);
}

export function undo() {
    if (historyIndex > 0) {
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        setHistoryIndex(historyIndex - 1);
        setCharacterColors(JSON.parse(colorHistory[historyIndex]));
        applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
        commit({ history: false });
    }
}

export function redo() {
    if (historyIndex < colorHistory.length - 1) {
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        setHistoryIndex(historyIndex + 1);
        setCharacterColors(JSON.parse(colorHistory[historyIndex]));
        applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
        commit({ history: false });
    }
}

export function createRestoreSnapshot() {
    const colorsSnapshot = JSON.stringify(characterColors);
    const expandedSnapshot = [...expandedCharacterRows];
    const swapSnapshot = swapMode;
    return function() {
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        setCharacterColors(JSON.parse(colorsSnapshot));
        setExpandedCharacterRows(new Set(expandedSnapshot));
        setSwapMode(swapSnapshot);
        applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
        commit();
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
