import { clearSpeakerRegexCache } from './attribution.js';
import { CHARACTER_STYLE_FIELD_MASKS, applyCharacterStyle, captureCharacterStyle } from './character-style.js';
import { applyGroupProfile, normalizeGroupKey, normalizeGroupName, resolveGroupAutomation, resolveGroupProfile } from './group-profiles.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit } from './live-colors.js';
import { getBaseColor, getNextColor, setEntryFromBaseColor, setEntryGradient } from './palettes.js';
import { characterColors, expandedCharacterRows, groupProfiles, selectedCharacterKeys, setSwapMode, swapMode } from './state.js';

export const DEFAULT_CHARACTER_STYLE_FIELD_MASK = CHARACTER_STYLE_FIELD_MASKS.GRADIENT
    | CHARACTER_STYLE_FIELD_MASKS.FONT
    | CHARACTER_STYLE_FIELD_MASKS.STYLE;

let characterStyleClipboard = null;
let characterStyleClipboardSource = '';

function normalizeExistingKeys(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return [...new Set(list.map(key => String(key ?? '').trim().toLowerCase()).filter(key => characterColors[key]))];
}

function createMutationResult(changedKeys, extra = {}) {
    return { changedKeys: [...new Set(changedKeys)], ...extra };
}

export function getSelectedCharacterKeys() {
    for (const key of selectedCharacterKeys) {
        if (!characterColors[key]) selectedCharacterKeys.delete(key);
    }
    return [...selectedCharacterKeys];
}

export function setCharacterSelected(key, selected) {
    const normalizedKey = String(key ?? '').trim().toLowerCase();
    if (!characterColors[normalizedKey]) return false;
    if (selected) selectedCharacterKeys.add(normalizedKey);
    else selectedCharacterKeys.delete(normalizedKey);
    return true;
}

export function selectCharacterKeys(keys) {
    normalizeExistingKeys(keys).forEach(key => selectedCharacterKeys.add(key));
    return getSelectedCharacterKeys();
}

export function clearCharacterSelection() {
    selectedCharacterKeys.clear();
}

export function executeSelectedCharacterMutation(mutator) {
    const selectedKeys = getSelectedCharacterKeys();
    if (!selectedKeys.length) return { changedKeys: [], noSelection: true, applied: false };
    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    const result = mutator(selectedKeys) || { changedKeys: [] };
    const changedKeys = [...new Set(result.changedKeys || [])];
    if (!changedKeys.length) return { ...result, changedKeys, applied: false };
    applyLiveColorChangesFromSnapshot(snapshot, changedKeys, { saveImmediately: true, repaintStyles: true });
    commit();
    return { ...result, changedKeys, applied: true };
}

export function setCharacterLock(keys, locked) {
    const nextValue = locked === true;
    const changedKeys = [];
    for (const key of normalizeExistingKeys(keys)) {
        if (characterColors[key].locked === nextValue) continue;
        characterColors[key].locked = nextValue;
        changedKeys.push(key);
    }
    return createMutationResult(changedKeys);
}

export function setCharacterKeep(keys, keep) {
    const nextValue = keep === true;
    const changedKeys = [];
    for (const key of normalizeExistingKeys(keys)) {
        if (characterColors[key].keep === nextValue) continue;
        characterColors[key].keep = nextValue;
        changedKeys.push(key);
    }
    return createMutationResult(changedKeys);
}

export function setCharacterGroup(keys, group, options = {}) {
    const nextGroup = normalizeGroupName(group);
    const changedKeys = [];
    const profile = nextGroup ? resolveGroupProfile(groupProfiles, nextGroup) : null;
    const profileAppliedKeys = [];
    const changedFieldsByKey = {};
    const shouldApplyStyle = !!profile && resolveGroupAutomation(profile, 'applyStyleOnAssign', {
        hasExplicit: Object.prototype.hasOwnProperty.call(options, 'applyStyleOnAssign'),
        explicit: options.applyStyleOnAssign === true,
        defaultValue: false,
    });
    for (const key of normalizeExistingKeys(keys)) {
        if ((characterColors[key].group || '') === nextGroup) continue;
        characterColors[key].group = nextGroup;
        if (shouldApplyStyle) {
            const changedFields = applyGroupProfile(characterColors[key], profile);
            if (changedFields.includes('baseColor')) setEntryFromBaseColor(characterColors[key], getBaseColor(characterColors[key]));
            else if (changedFields.includes('gradient')) setEntryGradient(characterColors[key], characterColors[key].gradient);
            if (changedFields.length) {
                profileAppliedKeys.push(key);
                changedFieldsByKey[key] = changedFields;
            }
        }
        changedKeys.push(key);
    }
    return createMutationResult(changedKeys, { profileAppliedKeys, changedFieldsByKey });
}

export function applyGroupProfileToKeys(keys, profile) {
    const changedKeys = [];
    const changedFieldsByKey = {};
    for (const key of normalizeExistingKeys(keys)) {
        const entry = characterColors[key];
        const before = JSON.stringify(entry);
        const changedFields = applyGroupProfile(entry, profile);
        if (changedFields.includes('baseColor')) setEntryFromBaseColor(entry, getBaseColor(entry));
        else if (changedFields.includes('gradient')) setEntryGradient(entry, entry.gradient);
        if (before === JSON.stringify(entry)) continue;
        changedKeys.push(key);
        changedFieldsByKey[key] = changedFields;
    }
    return createMutationResult(changedKeys, { changedFieldsByKey });
}

export function getCharacterKeysForGroup(group) {
    const groupKey = normalizeGroupKey(group);
    if (!groupKey) return [];
    return Object.entries(characterColors)
        .filter(([, entry]) => normalizeGroupKey(entry?.group) === groupKey)
        .map(([key]) => key);
}

export function randomizeCharacterColors(keys) {
    const changedKeys = [];
    const skippedLockedKeys = [];
    for (const key of normalizeExistingKeys(keys)) {
        const entry = characterColors[key];
        if (entry.locked) {
            skippedLockedKeys.push(key);
            continue;
        }
        const before = JSON.stringify([entry.baseColor, entry.color, entry.gradient]);
        setEntryFromBaseColor(entry, getNextColor());
        if (before !== JSON.stringify([entry.baseColor, entry.color, entry.gradient])) changedKeys.push(key);
    }
    return createMutationResult(changedKeys, { skippedLockedKeys });
}

export function copyCharacterStyle(key, fieldMask = DEFAULT_CHARACTER_STYLE_FIELD_MASK) {
    const [sourceKey] = normalizeExistingKeys([key]);
    if (!sourceKey) return null;
    characterStyleClipboard = captureCharacterStyle(characterColors[sourceKey], fieldMask);
    characterStyleClipboardSource = characterColors[sourceKey].name;
    return getCharacterStyleClipboard();
}

export function getCharacterStyleClipboard() {
    if (!characterStyleClipboard) return null;
    return {
        sourceName: characterStyleClipboardSource,
        fields: characterStyleClipboard.fields,
    };
}

export function pasteCharacterStyle(keys, fieldMask = DEFAULT_CHARACTER_STYLE_FIELD_MASK) {
    if (!characterStyleClipboard) return createMutationResult([], { clipboardEmpty: true });
    const changedKeys = [];
    const changedFieldsByKey = {};
    for (const key of normalizeExistingKeys(keys)) {
        const entry = characterColors[key];
        const before = JSON.stringify(entry);
        const changedFields = applyCharacterStyle(entry, characterStyleClipboard, fieldMask);
        if (changedFields.includes('baseColor')) setEntryFromBaseColor(entry, getBaseColor(entry));
        else if (changedFields.includes('gradient')) setEntryGradient(entry, entry.gradient);
        if (before === JSON.stringify(entry)) continue;
        changedKeys.push(key);
        changedFieldsByKey[key] = changedFields;
    }
    return createMutationResult(changedKeys, { changedFieldsByKey });
}

export function deleteCharacterKeys(keys) {
    const candidates = normalizeExistingKeys(keys);
    const keptKeys = candidates.filter(key => characterColors[key].keep);
    const removedKeys = candidates.filter(key => !characterColors[key].keep);
    for (const key of removedKeys) {
        delete characterColors[key];
        expandedCharacterRows.delete(key);
        selectedCharacterKeys.delete(key);
        if (swapMode === key) setSwapMode(null);
    }
    if (removedKeys.length) clearSpeakerRegexCache();
    return createMutationResult(removedKeys, { keptKeys, removedKeys });
}
