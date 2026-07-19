// storage.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { saveHistory, showUndoToast } from './history.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit } from './live-colors.js';
import { CUSTOM_PALETTE_KEY, CUSTOM_PALETTE_META_KEY, applyThemeReadabilityAndBrightness, deriveBaseColorFromEffectiveColor, getBaseColor, invalidateThemeCache, normalizeCustomPalettes, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt } from './prompts.js';
import { extension_settings, getCharacters, getContext, getRequestHeaders, saveCharacterDebounced, saveSettings, saveSettingsDebounced } from './st-api.js';
import { ACTIVE_SETTING_KEYS, AUTO_SYNC_SAVE_TIMEOUT_MS, COLOR_SCHEMA_VERSION, GLOBAL_SETTINGS_V2_KEY, GLOBAL_SETTINGS_V2_KEYS, GLOBAL_VISUAL_KEYS, LEGACY_AUTO_SYNC_ENABLED_KEY, LEGACY_GLOBAL_SETTINGS_KEY, LEGEND_POSITION_KEY, MODULE_NAME, PRESETS_KEY, TOGGLE_SETTING_DEFAULTS, autoSyncEnabled, autoSyncInterval, autoSyncLastTimestamp, autoSyncPendingRecord, autoSyncSaveTimeout, autoSyncSequence, autoSyncStatusError, characterColors, colorHistory, historyIndex, immediateSettingsSaveInFlight, immediateSettingsSaveQueued, lastProcessedMessageSignature, setAutoSyncEnabled, setAutoSyncInterval, setAutoSyncLastTimestamp, setAutoSyncPendingRecord, setAutoSyncSaveTimeout, setAutoSyncSequence, setAutoSyncStatusError, setCharacterColors, setColorHistory, setHistoryIndex, setImmediateSettingsSaveInFlight, setImmediateSettingsSaveQueued, setLastProcessedMessageSignature, settings } from './state.js';
import { syncUIWithSettings, updateCharList } from './ui.js';
import { normalizeBoolean, normalizeCharacterColors, normalizeHexColor, toast } from './utils.js';

export function normalizeToggleSettings() {
    pruneInactiveSettings();
    for (const [key, fallback] of Object.entries(TOGGLE_SETTING_DEFAULTS)) {
        settings[key] = normalizeBoolean(settings[key], fallback);
    }
    settings.coloringEngine = settings.coloringEngine === 'dom' ? 'dom' : 'llm';
}

export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseStorageObject(key) {
    try {
        const parsed = JSON.parse(getLegacyLocalStorageValue(key));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function getLegacyLocalStorageValue(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function applySettingsSubset(source, keys) {
    if (!source || typeof source !== 'object') return;
    for (const key of keys) {
        if (source[key] !== undefined) settings[key] = source[key];
    }
}

export function buildSettingsSubset(keys) {
    const subset = {};
    for (const key of keys) subset[key] = settings[key];
    return subset;
}

export function pruneInactiveSettings() {
    if (!settings || typeof settings !== 'object') return;
    for (const key of Object.keys(settings)) {
        if (!ACTIVE_SETTING_KEYS.includes(key)) delete settings[key];
    }
}

export function buildFullSettingsSnapshot() {
    const snapshot = {};
    for (const key of ACTIVE_SETTING_KEYS) {
        if (settings[key] !== undefined) snapshot[key] = settings[key];
    }
    snapshot.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    return snapshot;
}

export function normalizeStoredSettings(source) {
    if (!isPlainObject(source)) return {};
    const normalized = {};
    for (const key of ACTIVE_SETTING_KEYS) {
        if (source[key] !== undefined) normalized[key] = source[key];
    }
    if (source.colorSchemaVersion !== undefined) normalized.colorSchemaVersion = source.colorSchemaVersion;
    return normalized;
}

export function applyStoredSettingsSnapshot(source, { includeColorSchemaVersion = true } = {}) {
    const normalized = normalizeStoredSettings(source);
    if (!includeColorSchemaVersion) delete normalized.colorSchemaVersion;
    if (!Object.keys(normalized).length) return false;
    Object.assign(settings, normalized);
    normalizeToggleSettings();
    return true;
}

export function buildSettingsSubsetFromSource(source, keys) {
    const subset = {};
    if (!isPlainObject(source)) return subset;
    for (const key of keys) {
        if (source[key] !== undefined) subset[key] = source[key];
    }
    return subset;
}

export function getLegacyAutoSyncEnabledPreference() {
    const legacy = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY);
    if (legacy === 'true') return true;
    if (legacy === 'false') return false;
    return true;
}

export function cleanupLegacyAutoSyncPreference() {
    // localStorage is now read-only legacy input; do not write back to browser storage.
}

export function buildAutoSyncRecord(source = {}) {
    const settingsSource = isPlainObject(source?.settings) ? source.settings : {};
    const normalizedSettings = buildSettingsSubsetFromSource(settingsSource, GLOBAL_SETTINGS_V2_KEYS);
    const parsedVersion = Number(source?.version);
    const parsedSequence = Number(source?.sequence);
    return {
        version: Number.isFinite(parsedVersion) ? parsedVersion : COLOR_SCHEMA_VERSION,
        timestamp: typeof source?.timestamp === 'string' ? source.timestamp : '',
        sequence: Number.isFinite(parsedSequence) ? parsedSequence : 0,
        autoSyncEnabled: typeof source?.autoSyncEnabled === 'boolean' ? source.autoSyncEnabled : getLegacyAutoSyncEnabledPreference(),
        settings: normalizedSettings,
        globalSettings: normalizeStoredSettings(source?.globalSettings),
        colorData: isPlainObject(source?.colorData) ? source.colorData : {},
        presets: isPlainObject(source?.presets) ? source.presets : {},
        customPalettes: isPlainObject(source?.customPalettes) ? source.customPalettes : {},
        customPaletteMeta: isPlainObject(source?.customPaletteMeta) ? source.customPaletteMeta : {},
        ui: isPlainObject(source?.ui) ? source.ui : {},
        legacyLocalStorageMigrated: !!source?.legacyLocalStorageMigrated,
    };
}

export function mergeIncomingAutoSyncRecord(source) {
    const current = getAutoSyncRecord(true);
    const incoming = buildAutoSyncRecord(source);
    return buildAutoSyncRecord({
        ...current,
        ...incoming,
        settings: Object.keys(incoming.settings || {}).length ? incoming.settings : current.settings,
        globalSettings: Object.keys(incoming.globalSettings || {}).length ? incoming.globalSettings : current.globalSettings,
        colorData: Object.keys(incoming.colorData || {}).length ? incoming.colorData : current.colorData,
        presets: Object.keys(incoming.presets || {}).length ? incoming.presets : current.presets,
        customPalettes: Object.keys(incoming.customPalettes || {}).length ? incoming.customPalettes : current.customPalettes,
        customPaletteMeta: Object.keys(incoming.customPaletteMeta || {}).length ? incoming.customPaletteMeta : current.customPaletteMeta,
        ui: Object.keys(incoming.ui || {}).length ? incoming.ui : current.ui,
        legacyLocalStorageMigrated: current.legacyLocalStorageMigrated || incoming.legacyLocalStorageMigrated,
    });
}

export function queueImmediateSettingsSave() {
    if (typeof saveSettings !== 'function') {
        saveSettingsDebounced?.();
        return;
    }
    setImmediateSettingsSaveQueued(true);
    if (immediateSettingsSaveInFlight) return;

    const run = () => {
        if (!immediateSettingsSaveQueued) return;
        setImmediateSettingsSaveQueued(false);
        setImmediateSettingsSaveInFlight(true);
        saveSettings()
            .catch(err => {
                console.warn('[Dialogue Colors] Immediate settings save failed; falling back to debounced save:', err);
                saveSettingsDebounced?.();
            })
            .finally(() => {
                setImmediateSettingsSaveInFlight(false);
                if (immediateSettingsSaveQueued) run();
            });
    };
    run();
}

export function persistModuleStore(record, { debounce = true, immediate = false } = {}) {
    const normalized = buildAutoSyncRecord(record || getAutoSyncRecord(true));
    extension_settings[MODULE_NAME] = normalized;
    if (immediate) queueImmediateSettingsSave();
    else if (debounce) saveSettingsDebounced?.();
    return normalized;
}

export function getAutoSyncRecord(create = false) {
    const existing = extension_settings[MODULE_NAME];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const normalized = buildAutoSyncRecord(existing);
        extension_settings[MODULE_NAME] = normalized;
        return normalized;
    }
    if (!create) return null;
    const created = buildAutoSyncRecord({});
    extension_settings[MODULE_NAME] = created;
    return created;
}

export function hasAutoSyncSettingsPayload(record) {
    return !!record && Object.keys(record.settings || {}).length > 0;
}

export function areSettingsSubsetsEqual(left, right) {
    for (const key of GLOBAL_SETTINGS_V2_KEYS) {
        if (left?.[key] !== right?.[key]) return false;
    }
    return true;
}

export function doAutoSyncMarkersMatch(left, right) {
    if (!left || !right) return false;
    return (left.timestamp || '') === (right.timestamp || '') && (left.sequence || 0) === (right.sequence || 0);
}

export function getLatestKnownAutoSyncMarker() {
    return autoSyncPendingRecord || { timestamp: autoSyncLastTimestamp || '', sequence: autoSyncSequence || 0 };
}

export function isIncomingAutoSyncRecordNewer(record) {
    const normalized = buildAutoSyncRecord(record);
    const known = getLatestKnownAutoSyncMarker();
    if (!normalized.timestamp && !normalized.sequence) return false;
    if (!known.timestamp && !known.sequence) return true;
    if (normalized.timestamp > (known.timestamp || '')) return true;
    if (normalized.timestamp === (known.timestamp || '') && normalized.sequence > (known.sequence || 0)) return true;
    return false;
}

export function clearAutoSyncSaveTimeout() {
    if (autoSyncSaveTimeout) {
        clearTimeout(autoSyncSaveTimeout);
        setAutoSyncSaveTimeout(null);
    }
}

export function setAutoSyncError(message = '') {
    setAutoSyncStatusError(message);
    updateAutoSyncUI();
}

export function clearAutoSyncError() {
    if (!autoSyncStatusError) return;
    setAutoSyncStatusError('');
    updateAutoSyncUI();
}

export function clearAutoSyncPending({ timedOut = false } = {}) {
    clearAutoSyncSaveTimeout();
    setAutoSyncPendingRecord(null);
    if (timedOut) setAutoSyncStatusError('Save failed');
    updateAutoSyncUI();
}

export function markAutoSyncPending(record) {
    setAutoSyncStatusError('');
    setAutoSyncPendingRecord({
        timestamp: record?.timestamp || '',
        sequence: record?.sequence || 0,
    });
    clearAutoSyncSaveTimeout();
    setAutoSyncSaveTimeout(setTimeout(() => {
        console.warn('[Dialogue Colors] Auto-sync settings save timed out before confirmation.');
        clearAutoSyncPending({ timedOut: true });
    }, AUTO_SYNC_SAVE_TIMEOUT_MS));
    updateAutoSyncUI();
}

export function confirmAutoSyncRecord(record) {
    const normalized = mergeIncomingAutoSyncRecord(record);
    setAutoSyncLastTimestamp(normalized.timestamp || null);
    setAutoSyncSequence(Number.isFinite(normalized.sequence) ? normalized.sequence : 0);
    setAutoSyncEnabled(normalized.autoSyncEnabled);
    persistModuleStore(normalized, { debounce: false });
    setAutoSyncPendingRecord(null);
    setAutoSyncStatusError('');
    clearAutoSyncSaveTimeout();
    updateAutoSyncUI();
    return normalized;
}

export function syncAutoSyncPolling() {
    if (autoSyncEnabled) {
        startAutoSyncPolling();
    } else {
        stopAutoSyncPolling();
    }
}

export function applyAutoSyncRecord(record, { force = false } = {}) {
    const normalized = mergeIncomingAutoSyncRecord(record);
    const matchesPending = doAutoSyncMarkersMatch(normalized, autoSyncPendingRecord);
    const shouldAcceptRecord = force || matchesPending || isIncomingAutoSyncRecordNewer(normalized);
    const previousAutoSyncEnabled = autoSyncEnabled;

    if (!shouldAcceptRecord) {
        updateAutoSyncUI();
        cleanupLegacyAutoSyncPreference();
        return;
    }

    persistModuleStore(normalized, { debounce: false });
    setAutoSyncEnabled(normalized.autoSyncEnabled);

    if (force) applyStoredSettingsSnapshot(normalized.globalSettings);

    if (hasAutoSyncSettingsPayload(normalized)) {
        let changed = false;
        for (const key of GLOBAL_SETTINGS_V2_KEYS) {
            if (normalized.settings[key] !== undefined && settings[key] !== normalized.settings[key]) {
                settings[key] = normalized.settings[key];
                changed = true;
            }
        }
        normalizeToggleSettings();
        if (changed) {
            saveData({ skipAutoSync: true });
        } else {
            saveGlobalSettingsSnapshot();
        }
        syncUIWithSettings();
        updateCharList();
        injectPrompt();
    }

    confirmAutoSyncRecord(normalized);

    if (autoSyncEnabled !== previousAutoSyncEnabled) {
        syncAutoSyncPolling();
    }
    cleanupLegacyAutoSyncPreference();
}

export async function fetchAutoSyncRecordFromServer() {
    const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.result === 'file not find' || !data.settings) return null;

    let parsedSettings = null;
    try {
        parsedSettings = JSON.parse(data.settings);
    } catch {
        throw new Error('Invalid settings payload');
    }

    const record = parsedSettings?.extension_settings?.[MODULE_NAME];
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    return buildAutoSyncRecord(record);
}

export function saveGlobalSettingsSnapshot(options = {}) {
    const record = getAutoSyncRecord(true);
    record.globalSettings = buildFullSettingsSnapshot();
    record.settings = buildSettingsSubset(GLOBAL_SETTINGS_V2_KEYS);
    persistModuleStore(record, options);
}

// Phase 2B: Legacy key for migration (old behavior: avatar || characterId)

// Phase 2B: Prefer characterId over avatar, use ?? for 0-safety
export function getCharKey() {
    try {
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        return char?.characterId ?? char?.avatar ?? ctx?.characterId ?? null;
    } catch { return null; }
}

// Phase 2B: Legacy key for migration (old behavior: avatar || characterId)
export function getLegacyCharKey() {
    try {
        const ctx = getContext();
        return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null;
    } catch { return null; }
}

export function getStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getCharKey() || 'default'}`; }

export function getLegacyStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getLegacyCharKey() || 'default'}`; }

export function getStorageLabelForKey(key) {
    return key === 'dc_global' ? 'Global shared colors' : String(key || '').replace(/^dc_char_/, '');
}

export function normalizeColorDataEntry(source) {
    if (!isPlainObject(source)) return null;
    const colors = normalizeCharacterColors(source.colors || {});
    const storedSettings = normalizeStoredSettings(source.settings);
    return {
        colors,
        settings: storedSettings,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
    };
}

export function getUserColorDataStore() {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.colorData)) record.colorData = {};
    return record.colorData;
}

export function getStoredColorData(key) {
    return normalizeColorDataEntry(getUserColorDataStore()[key]);
}

export function setStoredColorData(key, colors, storedSettings = settings, options = {}) {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.colorData)) record.colorData = {};
    record.colorData[key] = {
        colors: normalizeCharacterColors(colors || {}),
        settings: normalizeStoredSettings(storedSettings),
        updatedAt: new Date().toISOString(),
    };
    persistModuleStore(record, options);
}

export function removeStoredColorData(key) {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.colorData) || !Object.prototype.hasOwnProperty.call(record.colorData, key)) return false;
    delete record.colorData[key];
    persistModuleStore(record);
    return true;
}

export function getUiState() {
    const record = getAutoSyncRecord(true);
    if (!isPlainObject(record.ui)) record.ui = {};
    return record.ui;
}

export function getLegendPosition() {
    const position = getUiState().legendPosition;
    return isPlainObject(position) ? position : {};
}

export function saveLegendPosition(position) {
    const record = getAutoSyncRecord(true);
    const nextPosition = isPlainObject(position) ? position : {};
    record.ui = { ...(isPlainObject(record.ui) ? record.ui : {}), legendPosition: nextPosition };
    persistModuleStore(record);
}

// Extract dominant color from avatar image

export function migrateLegacyLocalStorageIfNeeded() {
    const record = getAutoSyncRecord(true);
    if (record.legacyLocalStorageMigrated) return;

    if (!isPlainObject(record.globalSettings) || !Object.keys(record.globalSettings).length) {
        const legacyGlobal = parseStorageObject(LEGACY_GLOBAL_SETTINGS_KEY);
        const globalV2 = parseStorageObject(GLOBAL_SETTINGS_V2_KEY);
        if (hasAutoSyncSettingsPayload(record)) applySettingsSubset(record.settings, GLOBAL_SETTINGS_V2_KEYS);
        applySettingsSubset(legacyGlobal, GLOBAL_VISUAL_KEYS);
        if (globalV2) applySettingsSubset(globalV2, GLOBAL_SETTINGS_V2_KEYS);
        record.globalSettings = buildFullSettingsSnapshot();
    }

    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });

    for (const key of [PRESETS_KEY, CUSTOM_PALETTE_KEY, CUSTOM_PALETTE_META_KEY, LEGEND_POSITION_KEY]) {
        const value = parseStorageObject(key);
        if (!value) continue;
        if (key === PRESETS_KEY && !Object.keys(record.presets || {}).length) {
            record.presets = isPlainObject(value) ? value : {};
        } else if (key === CUSTOM_PALETTE_KEY && !Object.keys(record.customPalettes || {}).length) {
            record.customPalettes = normalizeCustomPalettes(value);
        } else if (key === CUSTOM_PALETTE_META_KEY && !Object.keys(record.customPaletteMeta || {}).length) {
            record.customPaletteMeta = isPlainObject(value) ? value : {};
        } else if (key === LEGEND_POSITION_KEY && !isPlainObject(record.ui?.legendPosition)) {
            record.ui = { ...(isPlainObject(record.ui) ? record.ui : {}), legendPosition: value };
        }
    }

    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !(key.startsWith('dc_char_') || key === 'dc_global')) continue;
            if (record.colorData?.[key]) continue;
            const value = parseStorageObject(key);
            const normalized = normalizeColorDataEntry(value);
            if (!normalized) continue;
            if (!isPlainObject(record.colorData)) record.colorData = {};
            record.colorData[key] = normalized;
        }
    } catch {
        // Browser storage is a best-effort legacy migration source only.
    }

    record.legacyLocalStorageMigrated = true;
    persistModuleStore(record);
}

export function saveData(options = {}) {
    normalizeToggleSettings();
    setCharacterColors(normalizeCharacterColors(characterColors));
    settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    syncAllEffectiveColors();
    try {
        setStoredColorData(getStorageKey(), characterColors, settings, { debounce: false });
        saveGlobalSettingsSnapshot(options.immediate === false ? {} : { immediate: true });
        // Trigger auto-sync if enabled
        if (autoSyncEnabled && !options.skipAutoSync) {
            saveSettingsToStore({ force: true });
        }
    } catch (e) {
        console.warn('[Dialogue Colors] Failed to save user settings:', e);
        toast.warning('Could not save color data to your user settings.');
    }
}

export function migrateColorSchemaIfNeeded() {
    const currentVersion = Number(settings.colorSchemaVersion);
    const needsMigration = !Number.isFinite(currentVersion) || currentVersion < COLOR_SCHEMA_VERSION;
    let changed = false;
    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        const normalizedColor = normalizeHexColor(entry.color, null);
        if (needsMigration) {
            if (normalizedColor) {
                entry.color = normalizedColor;
                entry.baseColor = deriveBaseColorFromEffectiveColor(normalizedColor);
            } else {
                entry.baseColor = getBaseColor(entry);
                entry.color = applyThemeReadabilityAndBrightness(entry.baseColor);
            }
            changed = true;
        } else {
            const normalizedBase = normalizeHexColor(entry.baseColor, normalizedColor ? deriveBaseColorFromEffectiveColor(normalizedColor) : getBaseColor(entry));
            if (normalizeHexColor(entry.baseColor, '') !== normalizedBase) {
                entry.baseColor = normalizedBase;
                changed = true;
            }
            if (normalizedColor) {
                if (normalizeHexColor(entry.color) !== normalizedColor) changed = true;
                entry.color = normalizedColor;
                continue;
            }
        }
        const effective = applyThemeReadabilityAndBrightness(getBaseColor(entry));
        if (normalizeHexColor(entry.color) !== effective) changed = true;
        entry.color = effective;
    }
    if (settings.colorSchemaVersion !== COLOR_SCHEMA_VERSION) {
        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        changed = true;
    }
    return changed;
}

// Legacy localStorage fallback is intentionally read-only and only seeds user settings.

export function applyStoredColorData(data) {
    if (!data) return false;
    if (data.colors) setCharacterColors(normalizeCharacterColors(data.colors));
    if (data.settings) {
        applyStoredSettingsSnapshot(data.settings);
        if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
    } else if (data.colors) {
        settings.colorSchemaVersion = 0;
    }
    return !!data.colors;
}

// Legacy localStorage fallback is intentionally read-only and only seeds user settings.
export function loadData() {
    setCharacterColors({});
    clearSpeakerRegexCache();
    const record = getAutoSyncRecord(true);
    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });
    const primaryKey = getStorageKey();
    let loaded = false;

    loaded = applyStoredColorData(getStoredColorData(primaryKey));
    if (!loaded) {
        const legacyData = parseStorageObject(primaryKey);
        if (legacyData) loaded = applyStoredColorData(normalizeColorDataEntry(legacyData));
        if (loaded) setStoredColorData(primaryKey, characterColors, settings);
    }
    if (!loaded) {
        const legacyKey = getLegacyStorageKey();
        if (legacyKey !== primaryKey) {
            const legacyData = parseStorageObject(legacyKey);
            if (legacyData) loaded = applyStoredColorData(normalizeColorDataEntry(legacyData));
            if (loaded) setStoredColorData(primaryKey, characterColors, settings);
        }
    }
    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });
    normalizeToggleSettings();
    if (migrateColorSchemaIfNeeded()) {
        saveData();
    }
    setColorHistory([JSON.stringify(characterColors)]); setHistoryIndex(0);
    setLastProcessedMessageSignature('');
}

export function exportColors() {
    const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importColors(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const d = JSON.parse(e.target.result);
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            if (d.colors) setCharacterColors(normalizeCharacterColors(d.colors));
            if (d.settings) {
                applyStoredSettingsSnapshot(d.settings);
                if (d.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
            } else if (d.colors) {
                settings.colorSchemaVersion = 0;
            }
            normalizeToggleSettings();
            invalidateThemeCache();
            migrateColorSchemaIfNeeded();
            syncAllEffectiveColors();
            applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
            commit();
            toast.success('Imported!');
        } catch {
            toast.error('Invalid file');
        }
    };
    reader.readAsText(file);
}

export function exportSettings() {
    const settingsData = {};
    GLOBAL_SETTINGS_V2_KEYS.forEach(key => {
        if (settings[key] !== undefined) settingsData[key] = settings[key];
    });
    const exportObj = {
        version: COLOR_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        settings: settingsData
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dc-settings-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success('Settings exported!');
}

export function importSettings(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const d = JSON.parse(e.target.result);
            if (!d.settings || typeof d.settings !== 'object') {
                toast.error('Invalid settings file');
                return;
            }
            // Merge settings
            Object.keys(d.settings).forEach(key => {
                if (GLOBAL_SETTINGS_V2_KEYS.includes(key)) {
                    settings[key] = d.settings[key];
                }
            });
            normalizeToggleSettings();
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            invalidateThemeCache();
            syncAllEffectiveColors();
            applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors), { saveImmediately: true });
            saveData();
            saveGlobalSettingsSnapshot();
            updateCharList();
            injectPrompt();
            toast.success('Settings imported!');
        } catch {
            toast.error('Invalid settings file');
        }
    };
    reader.readAsText(file);
}

export function applySettingsSnapshotWithRefresh(snapshot) {
    const keys = Object.keys(characterColors);
    const colorSnapshot = captureEffectiveColorSnapshot(keys);
    pruneInactiveSettings();
    applyStoredSettingsSnapshot(snapshot);
    invalidateThemeCache();
    syncAllEffectiveColors();
    applyLiveColorChangesFromSnapshot(colorSnapshot, keys, { saveImmediately: true });
    saveData();
    saveGlobalSettingsSnapshot();
    syncUIWithSettings();
    updateCharList();
    injectPrompt();
}

// Auto-sync functions

export function restoreAllSettingsToDefaults() {
    const confirmed = confirm(
        'Restore all settings to defaults?\n\n' +
        'This will reset:\n' +
        '- All toggle settings (auto-scan, auto-lock, etc.)\n' +
        '- Visual settings (theme, palette, brightness)\n' +
        '- Narrator color\n' +
        '- Thought symbols\n' +
        '- Prompt settings (depth, role, mode)\n' +
        '- Sort mode\n' +
        '- LLM profile\n\n' +
        'Character colors and presets will NOT be affected.\n\n' +
        'This action can be undone from the undo toast.'
    );

    if (!confirmed) return;

    const previousSettings = buildFullSettingsSnapshot();

    Object.entries(TOGGLE_SETTING_DEFAULTS).forEach(([key, defaultValue]) => {
        settings[key] = defaultValue;
    });

    settings.themeMode = 'auto';
    settings.colorTheme = 'pastel';
    settings.brightness = 0;
    settings.thoughtSymbols = '*';
    settings.narratorColor = '';
    settings.promptDepth = 1;
    settings.promptRole = 'system';
    settings.promptMode = 'inject';
    settings.sortMode = 'name';
    settings.coloringEngine = 'llm';
    settings.llmConnectionProfile = null;
    settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;

    applySettingsSnapshotWithRefresh(settings);
    showUndoToast('All settings restored to defaults.', () => {
        applySettingsSnapshotWithRefresh(previousSettings);
        toast.success('Previous settings restored.');
    });
}

// Auto-sync functions
export async function loadSettingsFromServer() {
    try {
        const record = await fetchAutoSyncRecordFromServer();
        clearAutoSyncError();
        if (!record) return;
        applyAutoSyncRecord(record);
    } catch (e) {
        console.warn('[Dialogue Colors] Auto-sync settings refresh failed:', e);
        setAutoSyncError('Read failed');
    }
}

export function saveSettingsToStore(options = {}) {
    const { force = false } = options;
    const currentRecord = getAutoSyncRecord(true);
    const settingsData = buildSettingsSubset(GLOBAL_SETTINGS_V2_KEYS);
    const settingsChanged = !areSettingsSubsetsEqual(currentRecord.settings, settingsData);
    const enabledChanged = currentRecord.autoSyncEnabled !== autoSyncEnabled;

    if (!force && (!autoSyncEnabled || (!settingsChanged && !enabledChanged))) return false;

    const nextRecord = buildAutoSyncRecord({
        ...currentRecord,
        version: COLOR_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        sequence: (Number.isFinite(currentRecord.sequence) ? currentRecord.sequence : 0) + 1,
        autoSyncEnabled,
        settings: settingsData,
    });

    persistModuleStore(nextRecord, { debounce: false });
    markAutoSyncPending(nextRecord);
    saveSettingsDebounced?.();
    cleanupLegacyAutoSyncPreference();
    return true;
}

export function enableAutoSync() {
    setAutoSyncEnabled(true);
    startAutoSyncPolling();
    saveSettingsToStore({ force: true });
    toast.success('Auto-sync enabled! Settings will sync across devices.');
}

export function disableAutoSync() {
    setAutoSyncEnabled(false);
    stopAutoSyncPolling();
    saveSettingsToStore({ force: true });
    toast.info('Auto-sync disabled');
}

export function startAutoSyncPolling() {
    if (autoSyncInterval) return;
    const pollInterval = document.hidden ? 30000 : 5000;
    setAutoSyncInterval(setInterval(() => {
        void loadSettingsFromServer();
    }, pollInterval));
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

export function stopAutoSyncPolling() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        setAutoSyncInterval(null);
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
}

export function handleVisibilityChange() {
    if (autoSyncEnabled) {
        stopAutoSyncPolling();
        startAutoSyncPolling();
        void loadSettingsFromServer();
    }
}

export function updateAutoSyncUI() {
    const setupBtn = document.getElementById('dc-setup-autosync');
    const disableBtn = document.getElementById('dc-disable-autosync');
    const status = document.getElementById('dc-autosync-status');
    if (!setupBtn || !disableBtn || !status) return;

    if (autoSyncEnabled) {
        setupBtn.style.display = 'none';
        disableBtn.style.display = 'block';
    } else {
        setupBtn.style.display = 'block';
        disableBtn.style.display = 'none';
    }

    if (autoSyncStatusError) {
        status.textContent = autoSyncStatusError;
        status.style.color = 'var(--SmartThemeErrorColor, #ff6b6b)';
    } else if (autoSyncPendingRecord) {
        status.textContent = 'Saving...';
        status.style.color = 'var(--SmartThemeQuoteColor)';
    } else if (autoSyncEnabled) {
        status.textContent = '✓ Active';
        status.style.color = 'var(--SmartThemeQuoteColor)';
    } else {
        status.textContent = '';
        status.style.color = '';
    }
}

// Phase 7: Removed debug console.log statements

export function initAutoSync() {
    const hadLegacyPreference = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY) !== null;
    const record = getAutoSyncRecord(true);
    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });
    applyAutoSyncRecord(record, { force: true });
    cleanupLegacyAutoSyncPreference();

    if (autoSyncEnabled && (hadLegacyPreference || !record.timestamp || !hasAutoSyncSettingsPayload(record))) {
        saveSettingsToStore({ force: true });
    }

    if (autoSyncEnabled) {
        startAutoSyncPolling();
        void loadSettingsFromServer();
    }
}

// Phase 7: Removed debug console.log statements
export function ensureRegexScript() {
    try {
        if (!extension_settings || typeof extension_settings !== 'object') return;
        if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];

        const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });

        if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Font Colors')) {
            extension_settings.regex.push({
                id: uuidv4(),
                scriptName: 'Trim Font Colors',
                findRegex: '/<\\/?font[^>]*>/gi',
                replaceString: '',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            });
            saveSettingsDebounced?.();
        }

        if (!extension_settings.regex.some(r => r?.scriptName === 'Trim Color Blocks')) {
            extension_settings.regex.push({
                id: uuidv4(),
                scriptName: 'Trim Color Blocks',
                findRegex: '/\\[COLORS?:[^\\]]*\\]/gi',
                replaceString: '',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: true,
                promptOnly: true,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            });
            saveSettingsDebounced?.();
        }

        const cssEffectsTrimRegex = '/<span[^>]*style=["\'][^"\']*(?:transform|skew|rotate|scale|opacity|filter|text-shadow|translate)[^"\']*["\'][^>]*>(.*?)<\\/span>/gi';
        const cssEffectsTrim = extension_settings.regex.find(r => r?.scriptName === 'Trim CSS Effects (Prompt)');
        if (cssEffectsTrim) {
            if (cssEffectsTrim.findRegex !== cssEffectsTrimRegex || cssEffectsTrim.replaceString !== '$1') {
                cssEffectsTrim.findRegex = cssEffectsTrimRegex;
                cssEffectsTrim.replaceString = '$1';
                saveSettingsDebounced?.();
            }
        } else {
            extension_settings.regex.push({
                id: uuidv4(),
                scriptName: 'Trim CSS Effects (Prompt)',
                findRegex: cssEffectsTrimRegex,
                replaceString: '$1',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            });
            saveSettingsDebounced?.();
        }
    } catch (e) {
        console.error('[Dialogue Colors] Failed to import regex scripts:', e);
    }
}

export function saveToCard() {
    try {
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        if (!char) { toast.error('No character loaded'); return; }
        if (!char.data) char.data = {};
        if (!char.data.extensions) char.data.extensions = {};
        char.data.extensions.dialogueColors = { colors: normalizeCharacterColors(characterColors), settings };
        saveData();
        saveCharacterDebounced?.();
        toast.success('Saved to card');
    } catch { toast.error('Failed to save to card'); }
}

export function loadFromCard() {
    try {
        const ctx = getContext();
        const charId = ctx?.characterId;
        if (charId === undefined) { toast.error('No character loaded'); return; }

        getCharacters?.().then(() => {
            const char = ctx?.characters?.[charId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) {
                const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                setCharacterColors(normalizeCharacterColors(data.colors));
                if (data.settings) {
                    Object.assign(settings, data.settings);
                    if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
                } else {
                    settings.colorSchemaVersion = 0;
                }
                normalizeToggleSettings();
                invalidateThemeCache();
                migrateColorSchemaIfNeeded();
                syncAllEffectiveColors();
                applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
                commit();
                toast.success('Loaded from card');
            } else {
                toast.info('No saved colors in card');
            }
        }).catch(() => toast.error('Failed to reload character'));
    } catch { toast.error('Failed to load from card'); }
}

export function tryLoadFromCard() {
    try {
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        const data = char?.data?.extensions?.dialogueColors;
        if (data?.colors) {
            setCharacterColors(normalizeCharacterColors(data.colors));
            if (data.settings) {
                Object.assign(settings, data.settings);
                if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
            } else {
                settings.colorSchemaVersion = 0;
            }
            normalizeToggleSettings();
            migrateColorSchemaIfNeeded();
            saveHistory(); saveData();
        }
    } catch { }
}
