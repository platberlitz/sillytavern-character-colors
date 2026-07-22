// storage.js - extracted from index.js (mechanical split)
import { clearSpeakerRegexCache } from './attribution.js';
import { GRADIENT_ANIMATION_MODES } from './animation-controller.js';
import { COLOR_VISION_MODES } from './color-vision.js';
import { createGradientPresetFromEntry, normalizeGradient, normalizeGradientPreset, normalizeGradientPresetName, normalizeGradientPresets, serializeGradient } from './gradients.js';
import { normalizeGroupProfiles } from './group-profiles.js';
import { createHistorySnapshot, parseHistorySnapshot, saveHistory, showUndoToast } from './history.js';
import { applyLiveColorChangesFromSnapshot, captureEffectiveColorSnapshot, commit } from './live-colors.js';
import { normalizeNarratorStyle, setNarratorStyle } from './narrator-style.js';
import { CUSTOM_PALETTE_KEY, CUSTOM_PALETTE_META_KEY, applyThemeReadabilityAndBrightness, deriveBaseColorFromEffectiveColor, getBaseColor, invalidateThemeCache, normalizeCustomPalettes, syncAllEffectiveColors } from './palettes.js';
import { injectPrompt } from './prompts.js';
import { extension_settings, getCharacters, getContext, getRequestHeaders, saveCharacterDebounced, saveMetadata, saveSettings, saveSettingsDebounced } from './st-api.js';
import { ACTIVE_SETTING_KEYS, AUTO_SYNC_SAVE_TIMEOUT_MS, COLOR_SCHEMA_VERSION, COLOR_STORAGE_SCOPES, DEFAULT_COLOR_STORAGE_SCOPE, GLOBAL_SETTINGS_V2_KEY, GLOBAL_SETTINGS_V2_KEYS, GLOBAL_VISUAL_KEYS, LEGACY_AUTO_SYNC_ENABLED_KEY, LEGACY_GLOBAL_SETTINGS_KEY, LEGEND_POSITION_KEY, MODULE_NAME, PRESETS_KEY, TOGGLE_SETTING_DEFAULTS, autoSyncEnabled, autoSyncInterval, autoSyncLastTimestamp, autoSyncPendingRecord, autoSyncSaveTimeout, autoSyncSequence, autoSyncStatusError, characterColors, colorHistory, expandedCharacterRows, groupProfiles, historyIndex, lastCharKey, lastProcessedMessageSignature, selectedCharacterKeys, setAutoSyncEnabled, setAutoSyncInterval, setAutoSyncLastTimestamp, setAutoSyncPendingRecord, setAutoSyncSaveTimeout, setAutoSyncSequence, setAutoSyncStatusError, setCharacterColors, setColorHistory, setExpandedCharacterRows, setGroupProfiles, setHistoryIndex, setLastCharKey, setLastProcessedMessageSignature, setSwapMode, settings, swapMode } from './state.js';
import { AESTHETIC_APPEARANCE_KEYS, analyzeStylePackConflicts, buildStylePackInstallationPlan } from './style-packs.js';
import { analyzeStylePackEnvelopeSource, digestStylePackEnvelope, normalizeStylePackEnvelope } from './style-pack-adapter.js';
import { refreshGradientPresetControls, syncUIWithSettings, updateCharList } from './ui.js';
import { normalizeBoolean, normalizeCharacterColors, normalizeEntryGradientGenerator, normalizeHexColor, toast } from './utils.js';

export function normalizeToggleSettings() {
    normalizeCurrentColorStorageScope();
    pruneInactiveSettings();
    for (const [key, fallback] of Object.entries(TOGGLE_SETTING_DEFAULTS)) {
        settings[key] = normalizeBoolean(settings[key], fallback);
    }
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    settings.coloringEngine = settings.coloringEngine === 'dom' ? 'dom' : 'llm';
    const attributionReviewPolicy = String(settings.attributionReviewPolicy ?? '').trim().toLowerCase();
    settings.attributionReviewPolicy = ['review', 'auto-high', 'legacy-auto'].includes(attributionReviewPolicy)
        ? attributionReviewPolicy
        : 'legacy-auto';
    settings.gradientRandomMasterSeed = String(settings.gradientRandomMasterSeed ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 128);
    settings.colorVisionPreviewMode = COLOR_VISION_MODES.includes(settings.colorVisionPreviewMode)
        ? settings.colorVisionPreviewMode
        : 'none';
    const previewSeverity = Number(settings.colorVisionPreviewSeverity);
    settings.colorVisionPreviewSeverity = Number.isFinite(previewSeverity)
        ? Math.max(0, Math.min(100, Math.round(previewSeverity)))
        : 100;
    settings.colorVisionPreviewTarget = ['ui', 'chat', 'all'].includes(settings.colorVisionPreviewTarget)
        ? settings.colorVisionPreviewTarget
        : 'all';
    settings.gradientAnimationMode = GRADIENT_ANIMATION_MODES.includes(settings.gradientAnimationMode)
        ? settings.gradientAnimationMode
        : 'auto';
}

export function normalizeColorStorageScope(value, legacyShareColorsGlobally = false) {
    return COLOR_STORAGE_SCOPES.includes(value)
        ? value
        : legacyShareColorsGlobally === true ? 'global' : DEFAULT_COLOR_STORAGE_SCOPE;
}

export function normalizeCurrentColorStorageScope() {
    const scope = normalizeColorStorageScope(settings.colorStorageScope, settings.shareColorsGlobally);
    settings.colorStorageScope = scope;
    delete settings.shareColorsGlobally;
    return scope;
}

export function getCurrentStorageScope() {
    return normalizeCurrentColorStorageScope();
}

export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStylePackRegistry(source) {
    if (!isPlainObject(source)) return {};
    const registry = {};
    const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
    const entries = Object.entries(source).slice(0, 256);
    for (const [key, value] of entries) {
        const registryKey = String(key).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 512);
        if (!registryKey || reservedKeys.has(registryKey) || !isPlainObject(value)) continue;
        const installedAt = typeof value.installedAt === 'string' && Number.isFinite(Date.parse(value.installedAt))
            ? new Date(value.installedAt).toISOString()
            : '';
        const itemMappings = {};
        for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
            const mappings = value.itemMappings?.[category];
            if (!isPlainObject(mappings)) continue;
            const cleanMappings = {};
            for (const [sourceName, targetName] of Object.entries(mappings).slice(0, 128)) {
                const sourceKey = String(sourceName).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
                const target = String(targetName).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
                if (sourceKey && target && !reservedKeys.has(sourceKey)) cleanMappings[sourceKey] = target;
            }
            if (Object.keys(cleanMappings).length) itemMappings[category] = cleanMappings;
        }
        registry[registryKey] = { installedAt, itemMappings };
    }
    return registry;
}

function cloneJsonValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function recordsEqual(left, right) {
    return JSON.stringify(buildAutoSyncRecord(left)) === JSON.stringify(buildAutoSyncRecord(right));
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
    if (keys.includes('colorStorageScope') && source.colorStorageScope === undefined && source.shareColorsGlobally !== undefined) {
        settings.colorStorageScope = normalizeColorStorageScope(undefined, source.shareColorsGlobally);
    }
    if (keys.includes('narratorStyle') && (source.narratorStyle !== undefined || source.disableNarration !== undefined || source.narratorColor !== undefined)) {
        const narratorStyle = normalizeNarratorStyle(source.narratorStyle, { legacy: source });
        setNarratorStyle(settings, narratorStyle, applyThemeReadabilityAndBrightness);
    }
    delete settings.shareColorsGlobally;
}

export function buildSettingsSubset(keys) {
    normalizeCurrentColorStorageScope();
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    const subset = {};
    for (const key of keys) subset[key] = cloneJsonValue(settings[key]);
    return subset;
}

export function pruneInactiveSettings() {
    if (!settings || typeof settings !== 'object') return;
    for (const key of Object.keys(settings)) {
        if (!ACTIVE_SETTING_KEYS.includes(key)) delete settings[key];
    }
}

export function buildFullSettingsSnapshot() {
    normalizeCurrentColorStorageScope();
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    const snapshot = {};
    for (const key of ACTIVE_SETTING_KEYS) {
        if (settings[key] !== undefined) snapshot[key] = cloneJsonValue(settings[key]);
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
    normalized.colorStorageScope = normalizeColorStorageScope(source.colorStorageScope, source.shareColorsGlobally);
    if (source.narratorStyle !== undefined || source.disableNarration !== undefined || source.narratorColor !== undefined) {
        normalized.narratorStyle = normalizeNarratorStyle(source.narratorStyle, { legacy: source });
        normalized.disableNarration = !normalized.narratorStyle.enabled;
        normalized.narratorColor = normalized.narratorStyle.baseColor;
    }
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
    const normalizedSource = keys.includes('colorStorageScope') ? normalizeStoredSettings(source) : source;
    for (const key of keys) {
        if (normalizedSource[key] !== undefined) subset[key] = normalizedSource[key];
    }
    return subset;
}

export function getLegacyAutoSyncEnabledPreference() {
    const legacy = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY);
    if (legacy === 'true') return true;
    if (legacy === 'false') return false;
    // Fresh installs default to off — auto-sync must be an explicit opt-in.
    return false;
}

export function normalizeStoredColorPresets(source) {
    if (!isPlainObject(source)) return {};
    const presets = {};
    const normalizeEntries = entries => entries.map(entry => isPlainObject(entry)
        ? { ...entry, gradient: serializeGradient(entry.gradient) }
        : entry);
    for (const [name, value] of Object.entries(source)) {
        if (Array.isArray(value)) {
            presets[name] = normalizeEntries(value);
        } else if (isPlainObject(value) && Array.isArray(value.entries)) {
            presets[name] = {
                version: 2,
                entries: normalizeEntries(value.entries),
                groupProfiles: normalizeGroupProfiles(value.groupProfiles),
            };
        } else {
            presets[name] = value;
        }
    }
    return presets;
}

export function normalizeStoredColorData(source) {
    if (!isPlainObject(source)) return {};
    const colorData = {};
    for (const [key, value] of Object.entries(source)) {
        const normalized = normalizeColorDataEntry(value);
        colorData[key] = normalized || value;
    }
    return colorData;
}

export function cleanupLegacyAutoSyncPreference() {
    // localStorage is now read-only legacy input; do not write back to browser storage.
}

export function buildAutoSyncRecord(source = {}) {
    const settingsSource = isPlainObject(source?.settings) ? source.settings : null;
    const normalizedSettings = settingsSource && Object.keys(settingsSource).length
        ? buildSettingsSubsetFromSource(settingsSource, GLOBAL_SETTINGS_V2_KEYS)
        : {};
    const globalSettingsSource = isPlainObject(source?.globalSettings) ? source.globalSettings : null;
    const parsedVersion = Number(source?.version);
    const parsedSequence = Number(source?.sequence);
    const record = {
        version: Number.isFinite(parsedVersion) ? parsedVersion : COLOR_SCHEMA_VERSION,
        timestamp: typeof source?.timestamp === 'string' ? source.timestamp : '',
        sequence: Number.isFinite(parsedSequence) ? parsedSequence : 0,
        autoSyncEnabled: typeof source?.autoSyncEnabled === 'boolean' ? source.autoSyncEnabled : getLegacyAutoSyncEnabledPreference(),
        settings: normalizedSettings,
        globalSettings: globalSettingsSource && Object.keys(globalSettingsSource).length
            ? normalizeStoredSettings(globalSettingsSource)
            : {},
        colorData: normalizeStoredColorData(source?.colorData),
        presets: normalizeStoredColorPresets(source?.presets),
        customPalettes: isPlainObject(source?.customPalettes) ? source.customPalettes : {},
        customPaletteMeta: isPlainObject(source?.customPaletteMeta) ? source.customPaletteMeta : {},
        customGradientPresets: normalizeGradientPresets(source?.customGradientPresets),
        ui: isPlainObject(source?.ui) ? source.ui : {},
        legacyLocalStorageMigrated: !!source?.legacyLocalStorageMigrated,
    };
    if (hasOwn(source, 'stylePackRegistry')) record.stylePackRegistry = normalizeStylePackRegistry(source.stylePackRegistry);
    return record;
}

export function mergeIncomingAutoSyncRecord(source) {
    const current = getAutoSyncRecord(true);
    const incoming = buildAutoSyncRecord(source);
    return buildAutoSyncRecord({
        ...current,
        ...incoming,
        timestamp: hasOwn(source, 'timestamp') ? incoming.timestamp : current.timestamp,
        sequence: hasOwn(source, 'sequence') ? incoming.sequence : current.sequence,
        autoSyncEnabled: hasOwn(source, 'autoSyncEnabled') ? incoming.autoSyncEnabled : current.autoSyncEnabled,
        settings: hasOwn(source, 'settings') ? incoming.settings : current.settings,
        globalSettings: hasOwn(source, 'globalSettings') ? incoming.globalSettings : current.globalSettings,
        colorData: hasOwn(source, 'colorData') ? incoming.colorData : current.colorData,
        presets: hasOwn(source, 'presets') ? incoming.presets : current.presets,
        customPalettes: hasOwn(source, 'customPalettes') ? incoming.customPalettes : current.customPalettes,
        customPaletteMeta: hasOwn(source, 'customPaletteMeta') ? incoming.customPaletteMeta : current.customPaletteMeta,
        customGradientPresets: Object.prototype.hasOwnProperty.call(source || {}, 'customGradientPresets')
            ? incoming.customGradientPresets
            : current.customGradientPresets,
        ...(hasOwn(source, 'stylePackRegistry')
            ? { stylePackRegistry: incoming.stylePackRegistry }
            : hasOwn(current, 'stylePackRegistry') ? { stylePackRegistry: current.stylePackRegistry } : {}),
        ui: hasOwn(source, 'ui') ? incoming.ui : current.ui,
        legacyLocalStorageMigrated: current.legacyLocalStorageMigrated || incoming.legacyLocalStorageMigrated,
    });
}

let moduleSettingsPersistenceBarrier = Promise.resolve();
let moduleSettingsPersistenceActive = false;
let moduleSettingsPersistenceQueued = 0;
let ordinaryModuleSaveQueued = false;
let ordinaryModuleSaveExpected = null;
let ordinaryModuleSaveExpectedRegex = null;
let ordinaryModuleSaveRetryCount = 0;
let moduleSettingsDebounceTimer = null;
let storageOperationBarrier = Promise.resolve();
let storageOperationActive = false;
let deferredAutoSyncApplication = null;
let metadataPersistenceSuppression = 0;
let autoSyncPendingExpectedRecord = null;

function enqueueModuleSettingsPersistence(task) {
    moduleSettingsPersistenceQueued++;
    const result = moduleSettingsPersistenceBarrier
        .catch(() => undefined)
        .then(async () => {
            moduleSettingsPersistenceActive = true;
            try {
                return await task();
            } finally {
                moduleSettingsPersistenceActive = false;
                moduleSettingsPersistenceQueued = Math.max(0, moduleSettingsPersistenceQueued - 1);
                if (moduleSettingsPersistenceQueued === 0) applyDeferredAutoSyncRecord();
            }
        });
    moduleSettingsPersistenceBarrier = result.catch(() => undefined);
    return result;
}

function applyDeferredAutoSyncRecord() {
    if (storageOperationActive || moduleSettingsPersistenceActive || moduleSettingsPersistenceQueued > 0
        || moduleSettingsDebounceTimer || !deferredAutoSyncApplication) return;
    const deferred = deferredAutoSyncApplication;
    deferredAutoSyncApplication = null;
    applyAutoSyncRecord(deferred.record, deferred.options);
}

function shouldReplaceDeferredAutoSync(record, options = {}) {
    if (!deferredAutoSyncApplication) return true;
    const candidate = buildAutoSyncRecord(record);
    const current = buildAutoSyncRecord(deferredAutoSyncApplication.record);
    if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp;
    if (candidate.sequence !== current.sequence) return candidate.sequence > current.sequence;
    if (options.force && !deferredAutoSyncApplication.options?.force) return true;
    return options.serverVerified === true && deferredAutoSyncApplication.options?.serverVerified !== true;
}

function clearModuleSettingsDebounce() {
    if (!moduleSettingsDebounceTimer) return;
    clearTimeout(moduleSettingsDebounceTimer);
    moduleSettingsDebounceTimer = null;
}

function getModuleRecordSnapshot(source = getAutoSyncRecord(true)) {
    return buildAutoSyncRecord(cloneJsonValue(source));
}

function moduleRecordMatchesSnapshot(expected) {
    return recordsEqual(extension_settings[MODULE_NAME], expected);
}

function queueDebouncedModuleSettingsSave(expectedSource = getAutoSyncRecord(true), options = {}) {
    clearModuleSettingsDebounce();
    const expected = getModuleRecordSnapshot(expectedSource);
    const expectedRegex = cloneJsonValue(extension_settings.regex);
    const delay = Number.isFinite(options.delay) ? options.delay : 250;
    moduleSettingsDebounceTimer = setTimeout(() => {
        moduleSettingsDebounceTimer = null;
        queueImmediateSettingsSave(expected, { retry: options.retry === true, expectedRegex });
    }, delay);
}

export function queueImmediateSettingsSave(expectedSource = getAutoSyncRecord(true), options = {}) {
    clearModuleSettingsDebounce();
    if (!options.retry) ordinaryModuleSaveRetryCount = 0;
    ordinaryModuleSaveExpected = getModuleRecordSnapshot(expectedSource);
    ordinaryModuleSaveExpectedRegex = cloneJsonValue(options.expectedRegex ?? extension_settings.regex);
    if (ordinaryModuleSaveQueued) return;
    ordinaryModuleSaveQueued = true;
    void enqueueModuleSettingsPersistence(async () => {
        ordinaryModuleSaveQueued = false;
        const expected = ordinaryModuleSaveExpected;
        const expectedRegex = ordinaryModuleSaveExpectedRegex;
        ordinaryModuleSaveExpected = null;
        ordinaryModuleSaveExpectedRegex = null;
        if (!expected || !moduleRecordMatchesSnapshot(expected)) return false;
        if (typeof saveSettings !== 'function') {
            saveSettingsDebounced?.();
            return false;
        }
        try {
            await saveSettings();
            const storedSettings = await fetchExtensionSettingsFromServer();
            const stored = storedSettings?.[MODULE_NAME];
            const moduleMatches = !!stored && recordsEqual(buildAutoSyncRecord(stored), expected);
            const regexMatches = JSON.stringify(storedSettings?.regex ?? null) === JSON.stringify(expectedRegex ?? null);
            const matches = moduleMatches && regexMatches;
            if (matches) {
                ordinaryModuleSaveRetryCount = 0;
                confirmAutoSyncRecord(stored, { serverVerified: true });
            } else if (ordinaryModuleSaveRetryCount < 3 && moduleRecordMatchesSnapshot(expected)) {
                ordinaryModuleSaveRetryCount++;
                queueDebouncedModuleSettingsSave(expected, {
                    retry: true,
                    expectedRegex,
                    delay: 250 * (2 ** (ordinaryModuleSaveRetryCount - 1)),
                });
            } else {
                setAutoSyncError('Save could not be verified');
                saveSettingsDebounced?.();
            }
            return matches;
        } catch (error) {
            console.warn('[Dialogue Colors] Immediate settings save failed; falling back to a later save:', error);
            if (ordinaryModuleSaveRetryCount < 3 && moduleRecordMatchesSnapshot(expected)) {
                ordinaryModuleSaveRetryCount++;
                queueDebouncedModuleSettingsSave(expected, {
                    retry: true,
                    expectedRegex,
                    delay: 250 * (2 ** (ordinaryModuleSaveRetryCount - 1)),
                });
            } else {
                setAutoSyncError('Save could not be verified');
                saveSettingsDebounced?.();
            }
            return false;
        }
    });
}

function runStorageOperation(operation) {
    const result = storageOperationBarrier
        .catch(() => undefined)
        .then(async () => {
            storageOperationActive = true;
            try {
                return await operation();
            } finally {
                storageOperationActive = false;
                applyDeferredAutoSyncRecord();
            }
        });
    storageOperationBarrier = result.catch(() => undefined);
    return result;
}

export function persistModuleStore(record, { debounce = true, immediate = false } = {}) {
    const normalized = buildAutoSyncRecord(record || getAutoSyncRecord(true));
    extension_settings[MODULE_NAME] = normalized;
    if (immediate) queueImmediateSettingsSave(normalized);
    else if (debounce) queueDebouncedModuleSettingsSave(normalized);
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

export function getCustomGradientPresets() {
    return normalizeGradientPresets(getAutoSyncRecord(true).customGradientPresets);
}

function persistCustomGradientPresetRecord(record, options = {}) {
    if (!autoSyncEnabled) {
        persistModuleStore(record, options);
        return;
    }
    persistModuleStore(record, { debounce: false });
    if (autoSyncEnabled) saveSettingsToStore({ force: true });
    queueImmediateSettingsSave();
}

export function saveCustomGradientPreset(name, source, options = {}) {
    const normalizedName = normalizeGradientPresetName(name);
    const preset = createGradientPresetFromEntry(source) || normalizeGradientPreset(source);
    if (!normalizedName || !preset) return null;
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = normalizeGradientPresets(record.customGradientPresets);
    if (Object.prototype.hasOwnProperty.call(record.customGradientPresets, normalizedName) && options.overwrite !== true) return null;
    record.customGradientPresets[normalizedName] = preset;
    persistCustomGradientPresetRecord(record, options);
    return normalizeGradientPreset(preset);
}

export function renameCustomGradientPreset(currentName, nextName, options = {}) {
    const current = normalizeGradientPresetName(currentName);
    const next = normalizeGradientPresetName(nextName);
    const presets = getCustomGradientPresets();
    if (!current || !next || !presets[current] || (current !== next && presets[next])) return false;
    if (current !== next) {
        presets[next] = presets[current];
        delete presets[current];
    }
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = presets;
    persistCustomGradientPresetRecord(record, options);
    return true;
}

export function deleteCustomGradientPreset(name, options = {}) {
    const normalizedName = normalizeGradientPresetName(name);
    const presets = getCustomGradientPresets();
    if (!normalizedName || !Object.prototype.hasOwnProperty.call(presets, normalizedName)) return false;
    delete presets[normalizedName];
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = presets;
    persistCustomGradientPresetRecord(record, options);
    return true;
}

export function hasAutoSyncSettingsPayload(record) {
    return !!record && Object.keys(record.settings || {}).length > 0;
}

export function areSettingsSubsetsEqual(left, right) {
    for (const key of GLOBAL_SETTINGS_V2_KEYS) {
        if (!jsonValuesEqual(left?.[key], right?.[key])) return false;
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
    autoSyncPendingExpectedRecord = null;
    if (timedOut) setAutoSyncStatusError('Save failed');
    updateAutoSyncUI();
}

export function markAutoSyncPending(record) {
    setAutoSyncStatusError('');
    autoSyncPendingExpectedRecord = getModuleRecordSnapshot(record);
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

export function confirmAutoSyncRecord(record, { serverVerified = false } = {}) {
    const normalized = buildAutoSyncRecord(cloneJsonValue(record));
    if (!serverVerified) {
        updateAutoSyncUI();
        return normalized;
    }
    if (autoSyncPendingRecord
        && doAutoSyncMarkersMatch(normalized, autoSyncPendingRecord)
        && autoSyncPendingExpectedRecord
        && !recordsEqual(normalized, autoSyncPendingExpectedRecord)) {
        updateAutoSyncUI();
        return normalized;
    }
    if (autoSyncPendingRecord && !doAutoSyncMarkersMatch(normalized, autoSyncPendingRecord)) {
        const isNewerThanPending = normalized.timestamp > (autoSyncPendingRecord.timestamp || '')
            || (normalized.timestamp === (autoSyncPendingRecord.timestamp || '')
                && normalized.sequence > (autoSyncPendingRecord.sequence || 0));
        if (!isNewerThanPending) {
            updateAutoSyncUI();
            return normalized;
        }
    }
    setAutoSyncLastTimestamp(normalized.timestamp || null);
    setAutoSyncSequence(Number.isFinite(normalized.sequence) ? normalized.sequence : 0);
    setAutoSyncEnabled(normalized.autoSyncEnabled);
    setAutoSyncPendingRecord(null);
    autoSyncPendingExpectedRecord = null;
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

export function applyAutoSyncRecord(record, { force = false, serverVerified = false } = {}) {
    if (storageOperationActive || moduleSettingsPersistenceActive) {
        const options = { force, serverVerified };
        if (shouldReplaceDeferredAutoSync(record, options)) {
            deferredAutoSyncApplication = { record: cloneJsonValue(record), options };
        }
        return;
    }
    const hasIncomingColorData = hasOwn(record, 'colorData');
    const ownsIncomingMarker = hasOwn(record, 'timestamp') && hasOwn(record, 'sequence');
    const incoming = buildAutoSyncRecord(cloneJsonValue(record));
    const normalized = mergeIncomingAutoSyncRecord(cloneJsonValue(record));
    const matchesPending = ownsIncomingMarker && doAutoSyncMarkersMatch(normalized, autoSyncPendingRecord)
        && (!autoSyncPendingExpectedRecord || recordsEqual(normalized, autoSyncPendingExpectedRecord));
    const shouldAcceptRecord = force || matchesPending || isIncomingAutoSyncRecordNewer(incoming);
    const previousAutoSyncEnabled = autoSyncEnabled;
    const previousScope = activeStorageScope || getCurrentStorageScope();

    if (!shouldAcceptRecord) {
        updateAutoSyncUI();
        cleanupLegacyAutoSyncPreference();
        return;
    }

    metadataPersistenceSuppression++;
    try {
        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        extension_settings[MODULE_NAME] = normalized;
        setAutoSyncEnabled(normalized.autoSyncEnabled);
        refreshGradientPresetControls();

        if (force) applyStoredSettingsSnapshot(normalized.globalSettings);

        const hasSettingsPayload = hasAutoSyncSettingsPayload(normalized);
        let changed = false;
        if (hasSettingsPayload) {
            for (const key of GLOBAL_SETTINGS_V2_KEYS) {
                if (normalized.settings[key] !== undefined && !jsonValuesEqual(settings[key], normalized.settings[key])) {
                    settings[key] = cloneJsonValue(normalized.settings[key]);
                    changed = true;
                }
            }
        }
        normalizeToggleSettings();
        const scopeChanged = getCurrentStorageScope() !== previousScope;
        const tableReloaded = scopeChanged || hasIncomingColorData;
        if (tableReloaded) {
            loadData({
                persistPrevious: false,
                allowLegacyFallback: !hasIncomingColorData,
                persistMigrations: false,
                allowMetadataPersistence: false,
            });
            changed = true;
        }
        if (hasSettingsPayload || tableReloaded) {
            if (changed) {
                invalidateThemeCache();
                syncAllEffectiveColors();
                applyLiveColorChangesFromSnapshot(
                    colorSnapshot,
                    [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
                    { saveImmediately: true },
                );
            }
            syncUIWithSettings();
            updateCharList();
            injectPrompt();
        }

        confirmAutoSyncRecord(normalized, { serverVerified: serverVerified && ownsIncomingMarker });

        if (autoSyncEnabled !== previousAutoSyncEnabled) {
            syncAutoSyncPolling();
        }
        cleanupLegacyAutoSyncPreference();
    } finally {
        metadataPersistenceSuppression--;
    }
}

async function fetchExtensionSettingsFromServer() {
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

    return parsedSettings?.extension_settings || null;
}

async function fetchModuleRecordFromServer() {
    const extensionSettings = await fetchExtensionSettingsFromServer();
    const record = extensionSettings?.[MODULE_NAME];
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    return record;
}

export async function fetchAutoSyncRecordFromServer() {
    return fetchModuleRecordFromServer();
}

export function saveGlobalSettingsSnapshot(options = {}) {
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.globalSettings = buildFullSettingsSnapshot();
    record.settings = buildSettingsSubset(GLOBAL_SETTINGS_V2_KEYS);
    persistModuleStore(record, options);
}

export const CHAT_SCOPE_METADATA_KEY = 'dialogue_colors_chat_scope_id';

let activeStorageKey = null;
let activeStorageScope = null;
const pendingChatScopeFallbacks = new WeakMap();
const chatScopeMetadataPersistence = new WeakMap();
const transientChatScopes = new WeakMap();
const runtimeContextTokens = new WeakMap();
let nextRuntimeContextToken = 1;

function rememberChatScopeFallback(metadataId, hostStorageKey) {
    if (!metadataId || !hostStorageKey) return;
    const record = getAutoSyncRecord(true);
    record.ui = isPlainObject(record.ui) ? record.ui : {};
    record.ui.chatScopeFallbacks = isPlainObject(record.ui.chatScopeFallbacks) ? record.ui.chatScopeFallbacks : {};
    record.ui.chatScopeFallbacks[metadataId] = hostStorageKey;
    persistModuleStore(record);
}

function getCardIdentity(context = getContext()) {
    try {
        const groupId = getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id);
        if (groupId !== null) return `group_${groupId}`;
        const char = context?.characters?.[context?.characterId];
        return char?.characterId ?? char?.avatar ?? context?.characterId ?? null;
    } catch { return null; }
}

export function getCharKey() {
    if (getCurrentStorageScope() === 'chat') return getStorageKeyForScope('chat');
    return getCardIdentity();
}

export function getLegacyCharKey() {
    try {
        const ctx = getContext();
        return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null;
    } catch { return null; }
}

function hashStorageKeyComponent(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function sanitizeStorageKeyComponent(value, fallback = 'default') {
    const safeFallback = String(fallback || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '') || 'default';
    const raw = String(value ?? '').trim();
    if (!raw) return safeFallback;
    let sanitized = raw.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '');
    if (!sanitized) sanitized = safeFallback;
    if (sanitized === raw && sanitized.length <= 96) return sanitized;
    return `${sanitized.slice(0, 80)}_${hashStorageKeyComponent(raw)}`;
}

function getStringOrNumberId(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

export function getHostProvidedChatId(context = getContext()) {
    return getStringOrNumberId(context?.chatId) ?? getStringOrNumberId(context?.chat_id);
}

function createChatScopeId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${randomPart}`;
}

function persistGeneratedChatScopeId(metadata) {
    try {
        const result = saveMetadata?.();
        if (result && typeof result.catch === 'function') {
            const promise = Promise.resolve(result)
                .then(() => {
                    chatScopeMetadataPersistence.set(metadata, { status: 'completed_unverified', promise: null });
                    return true;
                })
                .catch(error => {
                    chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
                    console.warn('[Dialogue Colors] Failed to persist chat scope metadata:', error);
                    return false;
                });
            chatScopeMetadataPersistence.set(metadata, { status: 'pending', promise });
        } else {
            // A void host API may save synchronously or may only queue a save. Treat it as unverified.
            chatScopeMetadataPersistence.set(metadata, { status: 'unverified', promise: null });
        }
    } catch (error) {
        chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
        console.warn('[Dialogue Colors] Failed to persist chat scope metadata:', error);
    }
}

async function ensureChatScopeMetadataSafety(context = getContext()) {
    const metadata = context?.chatMetadata || context?.chat_metadata;
    if (!metadata || typeof metadata !== 'object') {
        return { safe: getHostProvidedChatId(context) !== null, status: 'unavailable' };
    }
    const persistence = chatScopeMetadataPersistence.get(metadata);
    if (persistence?.promise) await persistence.promise;
    const finalStatus = chatScopeMetadataPersistence.get(metadata)?.status;
    const hasFallback = getHostProvidedChatId(context) !== null;
    const hasStoredId = getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY]) !== null;
    return {
        safe: hasFallback || (hasStoredId && !persistence),
        status: finalStatus || persistence?.status || 'existing',
    };
}

export function getCurrentChatScopeId(context = getContext(), { persist = true } = {}) {
    const metadata = context?.chatMetadata || context?.chat_metadata;
    const storedId = metadata && typeof metadata === 'object'
        ? getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY])
        : null;
    if (storedId !== null) {
        const pendingFallback = metadata && pendingChatScopeFallbacks.get(metadata);
        if (pendingFallback) return pendingFallback;
        return `meta_${sanitizeStorageKeyComponent(storedId)}`;
    }

    const hostId = getHostProvidedChatId(context);
    if (!metadata || typeof metadata !== 'object') {
        if (hostId !== null) return `host_${sanitizeStorageKeyComponent(hostId)}`;
    }

    const transientOwner = metadata && typeof metadata === 'object'
        ? metadata
        : context?.chat && typeof context.chat === 'object' ? context.chat : null;
    const existingTransient = transientOwner ? transientChatScopes.get(transientOwner) : null;
    const generatedId = existingTransient?.id || createChatScopeId();
    const fallbackComponent = hostId !== null
        ? `host_${sanitizeStorageKeyComponent(hostId)}`
        : `meta_${sanitizeStorageKeyComponent(generatedId)}`;
    if (transientOwner && !existingTransient) {
        transientChatScopes.set(transientOwner, { id: generatedId, component: fallbackComponent });
    }
    if (!persist) return existingTransient?.component || fallbackComponent;

    if (metadata && typeof metadata === 'object') {
        try {
            metadata[CHAT_SCOPE_METADATA_KEY] = generatedId;
            pendingChatScopeFallbacks.set(metadata, fallbackComponent);
            if (hostId !== null) {
                const metadataComponent = `meta_${sanitizeStorageKeyComponent(generatedId)}`;
                const hostStorageKey = `dc_chat_${getChatOwnerStorageComponent(context)}_${fallbackComponent}`;
                rememberChatScopeFallback(metadataComponent, hostStorageKey);
            }
            persistGeneratedChatScopeId(metadata);
        } catch (error) {
            chatScopeMetadataPersistence.set(metadata, { status: 'failed', promise: null });
            console.warn('[Dialogue Colors] Could not write the chat scope ID to chat metadata:', error);
            return fallbackComponent;
        }
    }
    return metadata && pendingChatScopeFallbacks.get(metadata)
        ? pendingChatScopeFallbacks.get(metadata)
        : `meta_${sanitizeStorageKeyComponent(generatedId)}`;
}

function getChatOwnerStorageComponent(context = getContext()) {
    const groupId = getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id);
    if (groupId !== null) return `group_${sanitizeStorageKeyComponent(groupId)}`;
    return `card_${sanitizeStorageKeyComponent(getCardIdentity(context))}`;
}

export function getStorageKeyForScope(scope, options = {}) {
    const normalizedScope = normalizeColorStorageScope(scope);
    if (normalizedScope === 'global') return 'dc_global';
    if (normalizedScope === 'chat') {
        const context = getContext();
        const persistMetadata = options.persistMetadata !== false && metadataPersistenceSuppression === 0;
        return `dc_chat_${getChatOwnerStorageComponent(context)}_${getCurrentChatScopeId(context, { persist: persistMetadata })}`;
    }
    return `dc_char_${sanitizeStorageKeyComponent(getCardIdentity())}`;
}

export function getStorageKey() {
    return getStorageKeyForScope(getCurrentStorageScope());
}

function getRuntimeContextToken(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return '';
    if (!runtimeContextTokens.has(value)) runtimeContextTokens.set(value, nextRuntimeContextToken++);
    return runtimeContextTokens.get(value);
}

function captureRuntimeContext() {
    const context = getContext();
    return {
        cardIdentity: getCardIdentity(context),
        characterId: context?.characterId ?? null,
        groupId: getStringOrNumberId(context?.groupId) ?? getStringOrNumberId(context?.group_id),
        hostChatId: getHostProvidedChatId(context),
        chatToken: getRuntimeContextToken(context?.chat),
        metadataToken: getRuntimeContextToken(context?.chatMetadata || context?.chat_metadata),
    };
}

function isRuntimeContextCurrent(captured) {
    if (!captured) return false;
    const current = captureRuntimeContext();
    return current.cardIdentity === captured.cardIdentity
        && current.characterId === captured.characterId
        && current.groupId === captured.groupId
        && current.hostChatId === captured.hostChatId
        && current.chatToken === captured.chatToken
        && current.metadataToken === captured.metadataToken;
}

function captureActiveStorageBinding() {
    const scope = activeStorageScope || getCurrentStorageScope();
    const contextKey = getStorageKeyForScope(scope);
    return {
        scope,
        key: activeStorageKey || contextKey,
        contextKey,
        aligned: !activeStorageKey || activeStorageKey === contextKey,
        context: captureRuntimeContext(),
    };
}

function isActiveStorageBindingCurrent(binding) {
    if (!binding) return false;
    const currentScope = activeStorageScope || getCurrentStorageScope();
    const currentKey = activeStorageKey || getStorageKeyForScope(currentScope);
    const freshContextKey = getStorageKeyForScope(currentScope);
    return binding.aligned === true
        && binding.key === binding.contextKey
        && currentScope === binding.scope
        && currentKey === binding.key
        && currentKey === freshContextKey
        && freshContextKey === binding.contextKey
        && isRuntimeContextCurrent(binding.context);
}

function areScopeStorageKeysCurrent(bindings) {
    return Object.entries(bindings || {}).every(([scope, key]) => getStorageKeyForScope(scope) === key);
}

function contextChangedError(message = 'The active chat or card changed before the operation completed.') {
    return { ok: false, error: 'context_changed', message };
}

function getLegacyCardStorageKeys() {
    const context = getContext();
    const isGroup = getStringOrNumberId(context?.groupId) !== null || getStringOrNumberId(context?.group_id) !== null;
    return [...new Set([getCardIdentity(), getLegacyCharKey(), ...(isGroup ? ['default'] : [])]
        .filter(value => value !== null && value !== undefined && String(value).length)
        .map(value => `dc_char_${String(value)}`))];
}

function getLegacyChatStorageKeys() {
    const hostId = getHostProvidedChatId();
    const metadata = getContext()?.chatMetadata || getContext()?.chat_metadata;
    const storedId = metadata && typeof metadata === 'object'
        ? getStringOrNumberId(metadata[CHAT_SCOPE_METADATA_KEY])
        : null;
    const metadataComponent = storedId !== null ? `meta_${sanitizeStorageKeyComponent(storedId)}` : '';
    const mappedFallback = metadataComponent
        ? getAutoSyncRecord(true).ui?.chatScopeFallbacks?.[metadataComponent]
        : null;
    return [...new Set([
        mappedFallback,
        hostId !== null ? `dc_chat_${getChatOwnerStorageComponent()}_host_${sanitizeStorageKeyComponent(hostId)}` : null,
    ].filter(Boolean))];
}

export function getLegacyStorageKey() {
    if (getCurrentStorageScope() !== 'card') return null;
    return getLegacyCardStorageKeys().find(key => key !== getStorageKeyForScope('card')) || null;
}

export function getStorageLabelForKey(key) {
    const value = String(key || '');
    if (value === 'dc_global') return 'Global shared colors';
    if (value.startsWith('dc_chat_')) return `Chat colors (${value.slice('dc_chat_'.length)})`;
    if (value.startsWith('dc_char_')) return `Card colors (${value.slice('dc_char_'.length)})`;
    return `Stored colors (${value || 'unknown'})`;
}

export function normalizeColorDataEntry(source) {
    if (!isPlainObject(source)) return null;
    const colors = normalizeCharacterColors(source.colors || {});
    const storedSettings = normalizeStoredSettings(source.settings);
    return {
        colors,
        groupProfiles: normalizeGroupProfiles(source.groupProfiles),
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

function findColorDataForScope(scope, primaryKey = getStorageKeyForScope(scope), options = {}) {
    const store = getUserColorDataStore();
    const primaryExists = Object.prototype.hasOwnProperty.call(store, primaryKey);
    const primaryEntry = normalizeColorDataEntry(store[primaryKey]);
    if (primaryEntry) return { entry: primaryEntry, exists: true, sourceKey: primaryKey, legacy: false };
    if (primaryExists) return { entry: null, exists: true, sourceKey: primaryKey, legacy: false };

    if (options.allowLegacyFallback === false || (scope !== 'card' && scope !== 'chat')) {
        return { entry: null, exists: primaryExists, sourceKey: primaryKey, legacy: false };
    }

    const candidates = [...new Set([
        primaryKey,
        ...(scope === 'card' ? getLegacyCardStorageKeys() : getLegacyChatStorageKeys()),
    ])];
    for (const key of candidates) {
        if (key === primaryKey) continue;
        const entry = normalizeColorDataEntry(store[key]);
        if (entry) return { entry, exists: true, sourceKey: key, legacy: true };
    }
    for (const key of candidates) {
        const entry = normalizeColorDataEntry(parseStorageObject(key));
        if (entry) return { entry, exists: true, sourceKey: key, legacy: true };
    }
    return { entry: null, exists: primaryExists, sourceKey: primaryKey, legacy: false };
}

export function getStorageScopeDescriptor(scope = getCurrentStorageScope()) {
    const normalizedScope = normalizeColorStorageScope(scope);
    const key = getStorageKeyForScope(normalizedScope);
    const located = findColorDataForScope(normalizedScope, key);
    const colors = located.entry?.colors || {};
    return {
        scope: normalizedScope,
        key,
        exists: located.exists,
        characterCount: Object.keys(colors).length,
        groupProfileCount: Object.keys(located.entry?.groupProfiles || {}).length,
        updatedAt: located.entry?.updatedAt || '',
        label: getStorageLabelForKey(key),
        sourceKey: located.sourceKey,
        usesLegacyFallback: located.legacy,
    };
}

export function inspectStorageScopes() {
    return COLOR_STORAGE_SCOPES.map(scope => getStorageScopeDescriptor(scope));
}

function collectRenamedCharacterIds(value) {
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (!isPlainObject(value)) return [];
    return [value.oldAvatar, value.old_avatar, value.avatar, value.characterId, value.character_id]
        .map(getStringOrNumberId)
        .filter(Boolean);
}

export function migrateRenamedCharacterStorage(oldValue, newValue) {
    const oldIds = [...new Set(collectRenamedCharacterIds(oldValue))];
    const newIds = [...new Set(collectRenamedCharacterIds(newValue))];
    if (!oldIds.length || !newIds.length) return Promise.resolve({ ok: true, migrated: 0 });
    return runStorageOperation(async () => {
        const baseRecord = getModuleRecordSnapshot();
        const record = getAutoSyncRecord(true);
        record.colorData = isPlainObject(record.colorData) ? record.colorData : {};
        const newCardKey = `dc_char_${sanitizeStorageKeyComponent(newIds[0])}`;
        const oldCardKeys = [...new Set(oldIds.flatMap(id => [
            `dc_char_${sanitizeStorageKeyComponent(id)}`,
            `dc_char_${id}`,
        ]))];
        const activeWasOld = oldCardKeys.includes(activeStorageKey)
            || oldIds.some(id => String(activeStorageKey || '').startsWith(`dc_chat_card_${sanitizeStorageKeyComponent(id)}_`));
        let migrated = 0;
        let fallbackChanged = false;
        if (!hasOwn(record.colorData, newCardKey)) {
            const sourceKey = oldCardKeys.find(key => hasOwn(record.colorData, key));
            if (sourceKey && sourceKey !== newCardKey) {
                record.colorData[newCardKey] = cloneJsonValue(record.colorData[sourceKey]);
                migrated++;
            }
        }

        const newChatPrefix = `dc_chat_card_${sanitizeStorageKeyComponent(newIds[0])}_`;
        const oldChatPrefixes = oldIds.map(id => `dc_chat_card_${sanitizeStorageKeyComponent(id)}_`);
        for (const [key, value] of Object.entries(record.colorData)) {
            const oldPrefix = oldChatPrefixes.find(prefix => key.startsWith(prefix));
            if (!oldPrefix) continue;
            const destinationKey = `${newChatPrefix}${key.slice(oldPrefix.length)}`;
            if (destinationKey === key || hasOwn(record.colorData, destinationKey)) continue;
            record.colorData[destinationKey] = cloneJsonValue(value);
            migrated++;
        }

        const fallbacks = record.ui?.chatScopeFallbacks;
        if (isPlainObject(fallbacks)) {
            for (const [metadataId, key] of Object.entries(fallbacks)) {
                const oldPrefix = oldChatPrefixes.find(prefix => String(key).startsWith(prefix));
                if (oldPrefix) {
                    fallbacks[metadataId] = `${newChatPrefix}${String(key).slice(oldPrefix.length)}`;
                    fallbackChanged = true;
                }
            }
        }
        if (!migrated && !fallbackChanged) {
            if (activeWasOld) {
                activeStorageKey = null;
                activeStorageScope = null;
                reloadCurrentStorageWithoutPersistence();
            }
            return { ok: true, migrated: 0 };
        }

        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        const persisted = await persistSettingsImmediately(expected);
        if (!persisted) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            return { ok: false, error: 'rename_migration_persist_failed', migrated: 0, rollbackPersisted };
        }

        if (activeWasOld) {
            activeStorageKey = null;
            activeStorageScope = null;
            reloadCurrentStorageWithoutPersistence();
        }
        return { ok: true, migrated };
    });
}

export function setStoredColorData(key, colors, storedSettings = settings, options = {}) {
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    if (!isPlainObject(record.colorData)) record.colorData = {};
    record.colorData[key] = {
        colors: normalizeCharacterColors(colors || {}),
        groupProfiles: normalizeGroupProfiles(options.groupProfiles === undefined ? groupProfiles : options.groupProfiles),
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

function prepareExpectedModuleRecord({ refreshAutoSyncSettings = true } = {}) {
    if (autoSyncEnabled) {
        if (refreshAutoSyncSettings) {
            saveSettingsToStore({ force: true, schedule: false });
        } else {
            const current = getAutoSyncRecord(true);
            const next = buildAutoSyncRecord({
                ...current,
                timestamp: new Date().toISOString(),
                sequence: (Number.isFinite(current.sequence) ? current.sequence : 0) + 1,
                autoSyncEnabled,
            });
            persistModuleStore(next, { debounce: false });
            markAutoSyncPending(next);
        }
    }
    return getModuleRecordSnapshot();
}

function reloadCurrentStorageWithoutPersistence() {
    loadData({
        persistPrevious: false,
        persistMigrations: false,
        allowMetadataPersistence: false,
    });
    invalidateThemeCache();
    syncAllEffectiveColors();
    syncUIWithSettings();
    updateCharList();
    injectPrompt();
}

function jsonValuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function restoreAppliedObjectChanges(base, applied, current) {
    const baseObject = isPlainObject(base) ? base : {};
    const appliedObject = isPlainObject(applied) ? applied : {};
    const currentObject = isPlainObject(current) ? current : {};
    const restored = cloneJsonValue(currentObject);
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(appliedObject)]);

    for (const key of keys) {
        const baseHas = hasOwn(baseObject, key);
        const appliedHas = hasOwn(appliedObject, key);
        const currentHas = hasOwn(currentObject, key);
        const baseValue = baseObject[key];
        const appliedValue = appliedObject[key];
        const currentValue = currentObject[key];
        const baseMatchesApplied = baseHas === appliedHas
            && (!baseHas || jsonValuesEqual(baseValue, appliedValue));
        if (baseMatchesApplied) continue;

        const currentMatchesApplied = currentHas === appliedHas
            && (!currentHas || jsonValuesEqual(currentValue, appliedValue));
        if (currentMatchesApplied) {
            if (baseHas) restored[key] = cloneJsonValue(baseValue);
            else delete restored[key];
            continue;
        }

        if (appliedHas && currentHas && isPlainObject(appliedValue) && isPlainObject(currentValue)
            && (!baseHas || isPlainObject(baseValue))) {
            restored[key] = restoreAppliedObjectChanges(baseValue, appliedValue, currentValue);
        }
    }
    return restored;
}

function restoreModuleRecord(baseRecord, appliedRecord) {
    const currentRecord = getModuleRecordSnapshot();
    const restoredRecord = restoreAppliedObjectChanges(baseRecord, appliedRecord, currentRecord);
    restoredRecord.sequence = Math.max(
        Number(restoredRecord.sequence) || 0,
        Number(currentRecord.sequence) || 0,
    );
    persistModuleStore(restoredRecord, { debounce: false });
    return restoredRecord;
}

async function rollbackModuleRecord(baseRecord, appliedRecord) {
    try {
        restoreModuleRecord(baseRecord, appliedRecord);
        const rollbackExpected = prepareExpectedModuleRecord({ refreshAutoSyncSettings: false });
        return await persistSettingsImmediately(rollbackExpected);
    } catch (error) {
        console.error('[Dialogue Colors] Failed to roll back module settings:', error);
        return false;
    }
}

export function archiveStoredColorData(keys) {
    const binding = captureActiveStorageBinding();
    return runStorageOperation(() => archiveStoredColorDataInternal(keys, binding));
}

async function archiveStoredColorDataInternal(keys, binding) {
    if (!isActiveStorageBindingCurrent(binding)) {
        return { ...contextChangedError(), count: 0 };
    }
    const baseRecord = getModuleRecordSnapshot();
    let appliedRecord = baseRecord;
    try {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.colorData)) record.colorData = {};
        const entries = {};
        const currentKey = binding.key;
        for (const key of [...new Set(Array.isArray(keys) ? keys : [])]) {
            if (key === currentKey) continue;
            if (!Object.prototype.hasOwnProperty.call(record.colorData, key)) continue;
            entries[key] = cloneJsonValue(record.colorData[key]);
            delete record.colorData[key];
        }
        const archivedKeys = Object.keys(entries);
        if (!archivedKeys.length) return { ok: false, count: 0 };
        const deletedAt = new Date().toISOString();
        record.ui = {
            ...(isPlainObject(record.ui) ? record.ui : {}),
            storageTrash: { entries, deletedAt },
        };
        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            const currentBinding = captureActiveStorageBinding();
            if (!contextCurrent && archivedKeys.includes(currentBinding.key)) {
                reloadCurrentStorageWithoutPersistence();
            }
            return {
                ...(contextCurrent
                    ? { ok: false, error: 'archive_persist_failed' }
                    : contextChangedError()),
                count: 0,
                rollbackPersisted,
            };
        }
        return { ok: true, count: archivedKeys.length, keys: archivedKeys };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to archive stored color data:', error);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = await rollbackModuleRecord(baseRecord, appliedRecord);
        if (!contextCurrent) reloadCurrentStorageWithoutPersistence();
        return {
            ...(contextCurrent
                ? { ok: false, error: 'archive_failed' }
                : contextChangedError()),
            count: 0,
            rollbackPersisted,
        };
    }
}

export function getArchivedColorData() {
    const trash = getUiState().storageTrash;
    if (!isPlainObject(trash) || !isPlainObject(trash.entries)) return null;
    const keys = Object.keys(trash.entries);
    return keys.length ? { keys, count: keys.length, deletedAt: trash.deletedAt || '' } : null;
}

export function restoreArchivedColorData() {
    const binding = captureActiveStorageBinding();
    return runStorageOperation(() => restoreArchivedColorDataInternal(binding));
}

async function restoreArchivedColorDataInternal(binding) {
    if (!isActiveStorageBindingCurrent(binding)) {
        return { ...contextChangedError(), count: 0, skipped: 0 };
    }
    const baseRecord = getModuleRecordSnapshot();
    let appliedRecord = baseRecord;
    try {
        const record = getAutoSyncRecord(true);
        const trash = cloneJsonValue(record.ui?.storageTrash);
        if (!isPlainObject(trash) || !isPlainObject(trash.entries)) return { ok: false, count: 0 };
        if (!isPlainObject(record.colorData)) record.colorData = {};
        let restored = 0;
        let skipped = 0;
        const restoredKeys = [];
        const remainingEntries = {};
        for (const [key, value] of Object.entries(trash.entries)) {
            if (key === binding.key || Object.prototype.hasOwnProperty.call(record.colorData, key)) {
                remainingEntries[key] = value;
                skipped++;
                continue;
            }
            record.colorData[key] = value;
            restoredKeys.push(key);
            restored++;
        }
        if (!restored) return { ok: false, count: 0, skipped };
        if (Object.keys(remainingEntries).length) record.ui.storageTrash = { ...trash, entries: remainingEntries };
        else delete record.ui.storageTrash;
        persistModuleStore(record, { debounce: false });
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(baseRecord, expected);
            const currentBinding = captureActiveStorageBinding();
            if (!contextCurrent && restoredKeys.includes(currentBinding.key)) {
                reloadCurrentStorageWithoutPersistence();
            }
            return {
                ...(contextCurrent
                    ? { ok: false, error: 'restore_persist_failed' }
                    : contextChangedError()),
                count: 0,
                skipped,
                rollbackPersisted,
            };
        }
        return { ok: restored > 0, count: restored, skipped };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to restore archived color data:', error);
        const contextCurrent = isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = await rollbackModuleRecord(baseRecord, appliedRecord);
        if (!contextCurrent) reloadCurrentStorageWithoutPersistence();
        return {
            ...(contextCurrent
                ? { ok: false, error: 'restore_failed' }
                : contextChangedError()),
            count: 0,
            skipped: 0,
            rollbackPersisted,
        };
    }
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

function persistActiveStorageData(options = {}) {
    if (!activeStorageKey || !activeStorageScope) return false;
    setStoredColorData(activeStorageKey, characterColors, {
        ...settings,
        colorStorageScope: activeStorageScope,
    }, options);
    return true;
}

export function saveData(options = {}) {
    normalizeToggleSettings();
    setCharacterColors(normalizeCharacterColors(characterColors));
    setGroupProfiles(normalizeGroupProfiles(groupProfiles));
    settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
    if (!options.preserveEffectiveColors) syncAllEffectiveColors();
    try {
        let storageKey = getStorageKey();
        if (activeStorageKey && storageKey !== activeStorageKey) {
            persistActiveStorageData({ debounce: false });
            console.warn('[Dialogue Colors] Ignored an unsafe direct storage scope change; use switchColorStorageScope().');
            settings.colorStorageScope = activeStorageScope;
            storageKey = activeStorageKey;
        }
        setStoredColorData(storageKey, characterColors, settings, { debounce: false });
        activeStorageKey = storageKey;
        activeStorageScope = getCurrentStorageScope();
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
    const needsBaseColorMigration = !Number.isFinite(currentVersion) || currentVersion < 4;
    let changed = false;
    const previousNarratorStyle = JSON.stringify(settings.narratorStyle ?? null);
    setNarratorStyle(settings, settings.narratorStyle, applyThemeReadabilityAndBrightness);
    if (previousNarratorStyle !== JSON.stringify(settings.narratorStyle)) changed = true;
    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        const normalizedColor = normalizeHexColor(entry.color, null);
        if (needsBaseColorMigration) {
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
            } else {
                const effective = applyThemeReadabilityAndBrightness(getBaseColor(entry));
                if (normalizeHexColor(entry.color) !== effective) changed = true;
                entry.color = effective;
            }
        }
        const serializedGradient = JSON.stringify(entry.gradient ?? null);
        entry.gradient = normalizeGradient(entry.gradient);
        if (serializedGradient !== JSON.stringify(entry.gradient)) changed = true;
        const serializedGenerator = JSON.stringify(entry.gradientGenerator ?? null);
        entry.gradientGenerator = normalizeEntryGradientGenerator(entry.gradientGenerator, entry.gradient);
        if (serializedGenerator !== JSON.stringify(entry.gradientGenerator)) changed = true;
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
    setGroupProfiles(normalizeGroupProfiles(data.groupProfiles));
    if (data.settings) {
        applyStoredSettingsSnapshot(data.settings);
        if (data.settings.colorSchemaVersion === undefined && settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
    } else if (data.colors && settings.colorSchemaVersion === undefined) {
        settings.colorSchemaVersion = 0;
    }
    return !!data.colors;
}

// Legacy localStorage fallback is intentionally read-only and only seeds user settings.
export function loadData(options = {}) {
    const record = getAutoSyncRecord(true);
    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });
    const scope = getCurrentStorageScope();
    const primaryKey = getStorageKeyForScope(scope, { persistMetadata: options.allowMetadataPersistence !== false });
    if (options.persistPrevious !== false && activeStorageKey && activeStorageKey !== primaryKey) {
        persistActiveStorageData();
    }
    setCharacterColors({});
    setGroupProfiles({});
    selectedCharacterKeys.clear();
    setExpandedCharacterRows(new Set());
    setSwapMode(null);
    clearSpeakerRegexCache();
    const located = findColorDataForScope(scope, primaryKey, options);
    const loaded = applyStoredColorData(located.entry);
    if (loaded && located.sourceKey !== primaryKey && options.persistMigrations !== false) {
        setStoredColorData(primaryKey, characterColors, { ...settings, colorStorageScope: scope });
    }
    applyStoredSettingsSnapshot(record.globalSettings, { includeColorSchemaVersion: false });
    settings.colorStorageScope = scope;
    normalizeToggleSettings();
    activeStorageKey = primaryKey;
    activeStorageScope = scope;
    setLastCharKey(scope === 'chat' ? primaryKey : getCardIdentity());
    if (migrateColorSchemaIfNeeded() && options.persistMigrations !== false) {
        saveData({ preserveEffectiveColors: true });
    }
    setColorHistory([createHistorySnapshot()]); setHistoryIndex(0);
    setLastProcessedMessageSignature('');
    return {
        scope,
        key: primaryKey,
        loaded,
        sourceKey: located.sourceKey,
        usedLegacyFallback: located.legacy,
        characterCount: Object.keys(characterColors).length,
    };
}

function captureStorageTransaction(binding = captureActiveStorageBinding()) {
    return {
        record: getModuleRecordSnapshot(),
        colors: cloneJsonValue(characterColors),
        groupProfiles: cloneJsonValue(groupProfiles),
        settings: cloneJsonValue(settings),
        history: [...colorHistory],
        historyIndex,
        lastCharKey,
        lastProcessedMessageSignature,
        selectedKeys: [...selectedCharacterKeys],
        expandedKeys: [...expandedCharacterRows],
        swapMode,
        binding,
    };
}

function captureStorageRuntimeState() {
    return {
        colors: cloneJsonValue(characterColors),
        groupProfiles: cloneJsonValue(groupProfiles),
        settings: cloneJsonValue(settings),
        history: [...colorHistory],
        historyIndex,
        lastCharKey,
        lastProcessedMessageSignature,
        activeStorageKey,
        activeStorageScope,
        selectedKeys: [...selectedCharacterKeys],
        expandedKeys: [...expandedCharacterRows],
        swapMode,
    };
}

function restoreRuntimeValue(baseValue, appliedValue, currentValue) {
    if (jsonValuesEqual(currentValue, appliedValue)) return cloneJsonValue(baseValue);
    if (isPlainObject(appliedValue) && isPlainObject(currentValue)
        && (!baseValue || isPlainObject(baseValue))) {
        return restoreAppliedObjectChanges(baseValue, appliedValue, currentValue);
    }
    return cloneJsonValue(currentValue);
}

function restoreSettingsState(snapshot) {
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, cloneJsonValue(snapshot));
}

async function rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, contextCurrent) {
    try {
        restoreModuleRecord(transaction.record, appliedRecord || getModuleRecordSnapshot());
        const canRestoreCapturedRuntime = contextCurrent && isRuntimeContextCurrent(transaction.binding.context);
        if (canRestoreCapturedRuntime) {
            const currentRuntime = captureStorageRuntimeState();
            const baseRuntime = {
                colors: transaction.colors,
                groupProfiles: transaction.groupProfiles,
                settings: transaction.settings,
                history: transaction.history,
                historyIndex: transaction.historyIndex,
                lastCharKey: transaction.lastCharKey,
                lastProcessedMessageSignature: transaction.lastProcessedMessageSignature,
                activeStorageKey: transaction.binding.key,
                activeStorageScope: transaction.binding.scope,
                selectedKeys: transaction.selectedKeys,
                expandedKeys: transaction.expandedKeys,
                swapMode: transaction.swapMode,
            };
            const applied = appliedRuntime || currentRuntime;
            restoreSettingsState(restoreRuntimeValue(baseRuntime.settings, applied.settings, currentRuntime.settings));
            activeStorageKey = restoreRuntimeValue(baseRuntime.activeStorageKey, applied.activeStorageKey, currentRuntime.activeStorageKey);
            activeStorageScope = restoreRuntimeValue(baseRuntime.activeStorageScope, applied.activeStorageScope, currentRuntime.activeStorageScope);
            const restoredColors = restoreRuntimeValue(baseRuntime.colors, applied.colors, currentRuntime.colors);
            setCharacterColors(restoredColors);
            const restoredGroupProfiles = restoreRuntimeValue(baseRuntime.groupProfiles, applied.groupProfiles, currentRuntime.groupProfiles);
            setGroupProfiles(normalizeGroupProfiles(restoredGroupProfiles));
            const restoredSelectedKeys = restoreRuntimeValue(baseRuntime.selectedKeys, applied.selectedKeys, currentRuntime.selectedKeys);
            selectedCharacterKeys.clear();
            restoredSelectedKeys.filter(key => characterColors[key]).forEach(key => selectedCharacterKeys.add(key));
            const restoredExpandedKeys = restoreRuntimeValue(baseRuntime.expandedKeys, applied.expandedKeys, currentRuntime.expandedKeys);
            setExpandedCharacterRows(new Set(restoredExpandedKeys.filter(key => characterColors[key])));
            const restoredSwapMode = restoreRuntimeValue(baseRuntime.swapMode, applied.swapMode, currentRuntime.swapMode);
            setSwapMode(restoredSwapMode && characterColors[restoredSwapMode] ? restoredSwapMode : null);
            if (jsonValuesEqual(currentRuntime.history, applied.history)
                && currentRuntime.historyIndex === applied.historyIndex) {
                setColorHistory([...baseRuntime.history]);
                setHistoryIndex(baseRuntime.historyIndex);
            } else {
                const appliedHistory = Array.isArray(applied.history) ? applied.history : [];
                const currentHistory = Array.isArray(currentRuntime.history) ? currentRuntime.history : [];
                const hasAppliedPrefix = appliedHistory.every((snapshot, index) => currentHistory[index] === snapshot);
                const concurrentSuffix = hasAppliedPrefix ? currentHistory.slice(appliedHistory.length) : [];
                const transformedSuffix = concurrentSuffix.map(snapshot => {
                    try {
                        const parsed = parseHistorySnapshot(snapshot);
                        return createHistorySnapshot(
                            restoreAppliedObjectChanges(baseRuntime.colors, applied.colors, parsed.colors),
                            restoreAppliedObjectChanges(baseRuntime.groupProfiles, applied.groupProfiles, parsed.groupProfiles),
                            parsed.narratorStyle || settings,
                        );
                    } catch {
                        return null;
                    }
                }).filter(Boolean);
                const nextHistory = [
                    ...baseRuntime.history,
                    ...transformedSuffix,
                    ...(transformedSuffix.length ? [] : [createHistorySnapshot(restoredColors, restoredGroupProfiles, settings)]),
                ].slice(-20);
                setColorHistory(nextHistory);
                setHistoryIndex(nextHistory.length - 1);
            }
            setLastCharKey(restoreRuntimeValue(baseRuntime.lastCharKey, applied.lastCharKey, currentRuntime.lastCharKey));
            setLastProcessedMessageSignature(restoreRuntimeValue(baseRuntime.lastProcessedMessageSignature, applied.lastProcessedMessageSignature, currentRuntime.lastProcessedMessageSignature));
            clearSpeakerRegexCache();
            invalidateThemeCache();
            syncAllEffectiveColors();
            applyLiveColorChangesFromSnapshot(
                failedSnapshot,
                [...new Set([...Object.keys(failedSnapshot || {}), ...Object.keys(characterColors)])],
                { saveImmediately: true },
            );
            refreshGradientPresetControls();
            syncUIWithSettings();
            updateCharList();
            injectPrompt();
        } else {
            activeStorageKey = null;
            activeStorageScope = null;
            reloadCurrentStorageWithoutPersistence();
            refreshGradientPresetControls();
        }
        const rollbackExpected = prepareExpectedModuleRecord({ refreshAutoSyncSettings: false });
        return await persistSettingsImmediately(rollbackExpected);
    } catch (error) {
        console.error('[Dialogue Colors] Failed to roll back storage transaction:', error);
        return false;
    }
}

async function persistSettingsImmediately(expectedSource = getAutoSyncRecord(true)) {
    const expected = getModuleRecordSnapshot(expectedSource);
    const expectedJson = JSON.stringify(expected);
    clearModuleSettingsDebounce();
    return enqueueModuleSettingsPersistence(async () => {
        if (!moduleRecordMatchesSnapshot(expected)) return false;
        if (typeof saveSettings !== 'function') {
            saveSettingsDebounced?.();
            return false;
        }
        try {
            await saveSettings();
            const stored = await fetchModuleRecordFromServer();
            const matches = !!stored && JSON.stringify(buildAutoSyncRecord(stored)) === expectedJson;
            if (matches) confirmAutoSyncRecord(stored, { serverVerified: true });
            return matches;
        } catch (error) {
            console.warn('[Dialogue Colors] Failed to persist storage scope state:', error);
            return false;
        }
    });
}

export async function switchColorStorageScope(scope, strategy = 'switch') {
    if (!COLOR_STORAGE_SCOPES.includes(scope)) {
        return { ok: false, error: 'invalid_scope', message: `Unknown color storage scope: ${String(scope)}` };
    }
    if (!['switch', 'copy', 'replace', 'merge', 'empty'].includes(strategy)) {
        return { ok: false, error: 'invalid_strategy', message: `Unknown scope switch strategy: ${String(strategy)}` };
    }
    const binding = captureActiveStorageBinding();
    const targetKey = getStorageKeyForScope(scope);
    return runStorageOperation(() => switchColorStorageScopeInternal(scope, strategy, binding, targetKey));
}

async function switchColorStorageScopeInternal(
    scope,
    strategy = 'switch',
    binding = captureActiveStorageBinding(),
    targetKey = getStorageKeyForScope(scope),
) {
    const previousScope = binding.scope;
    const previousKey = binding.key;
    const scopeKeyBindings = { [previousScope]: previousKey, [scope]: targetKey };
    if (!isActiveStorageBindingCurrent(binding) || !areScopeStorageKeysCurrent(scopeKeyBindings)) {
        return { ...contextChangedError(), previousScope, previousKey };
    }
    if (previousScope === 'chat' || scope === 'chat') {
        const metadataSafety = await ensureChatScopeMetadataSafety();
        if (!isActiveStorageBindingCurrent(binding) || !areScopeStorageKeysCurrent(scopeKeyBindings)) {
            return { ...contextChangedError(), previousScope, previousKey };
        }
        if (!metadataSafety.safe) {
            return {
                ok: false,
                error: 'chat_metadata_persist_failed',
                message: 'The per-chat identifier could not be saved and no stable host chat identifier is available.',
                previousScope,
                previousKey,
            };
        }
    }

    let transaction = captureStorageTransaction(binding);
    let appliedRecord = transaction.record;
    let appliedRuntime = captureStorageRuntimeState();
    try {
        const sourceColors = normalizeCharacterColors(characterColors);
        const sourceGroupProfiles = normalizeGroupProfiles(groupProfiles);
        settings.colorStorageScope = previousScope;
        normalizeToggleSettings();
        setStoredColorData(previousKey, sourceColors, { ...settings, colorStorageScope: previousScope }, {
            debounce: false,
            groupProfiles: sourceGroupProfiles,
        });
        const sourceExpected = prepareExpectedModuleRecord();
        appliedRecord = sourceExpected;
        appliedRuntime = captureStorageRuntimeState();
        const sourcePersisted = await persistSettingsImmediately(sourceExpected);
        const sourceContextCurrent = areScopeStorageKeysCurrent(scopeKeyBindings)
            && isActiveStorageBindingCurrent(binding);
        if (!sourcePersisted || !sourceContextCurrent) {
            const rollbackPersisted = await rollbackModuleRecord(transaction.record, sourceExpected);
            if (!sourceContextCurrent) reloadCurrentStorageWithoutPersistence();
            return {
                ok: false,
                error: sourceContextCurrent ? 'source_persist_failed' : 'context_changed',
                message: sourceContextCurrent
                    ? 'The current color table could not be persisted, so the scope was not changed.'
                    : 'The active chat or card changed before the scope switch completed.',
                previousScope,
                previousKey,
                rollbackPersisted,
            };
        }

        // Source persistence is a preflight boundary. Preserve edits made while
        // it was in flight before mutating the destination/runtime scope.
        const latestSourceColors = normalizeCharacterColors(characterColors);
        const latestSourceGroupProfiles = normalizeGroupProfiles(groupProfiles);
        setStoredColorData(previousKey, latestSourceColors, { ...settings, colorStorageScope: previousScope }, {
            debounce: false,
            groupProfiles: latestSourceGroupProfiles,
        });
        transaction = captureStorageTransaction(binding);
        appliedRecord = transaction.record;
        appliedRuntime = captureStorageRuntimeState();

        const target = findColorDataForScope(scope, targetKey);
        const targetExisted = target.exists;
        let destinationWritten = false;
        let nextColors = target.entry?.colors || {};
        let nextGroupProfiles = target.entry?.groupProfiles || {};

        if (strategy === 'copy' || strategy === 'replace') {
            nextColors = latestSourceColors;
            nextGroupProfiles = latestSourceGroupProfiles;
            destinationWritten = true;
        } else if (strategy === 'merge') {
            nextColors = normalizeCharacterColors({ ...(target.entry?.colors || {}), ...latestSourceColors });
            nextGroupProfiles = normalizeGroupProfiles({ ...(target.entry?.groupProfiles || {}), ...latestSourceGroupProfiles });
            destinationWritten = true;
        } else if (strategy === 'empty') {
            nextColors = {};
            nextGroupProfiles = {};
            destinationWritten = true;
        }

        if (destinationWritten) {
            setStoredColorData(targetKey, nextColors, { ...settings, colorStorageScope: scope }, {
                debounce: false,
                groupProfiles: nextGroupProfiles,
            });
        }

        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        settings.colorStorageScope = scope;
        saveGlobalSettingsSnapshot({ debounce: false });
        const loadResult = loadData({ persistPrevious: false });
        invalidateThemeCache();
        syncAllEffectiveColors();
        applyLiveColorChangesFromSnapshot(
            colorSnapshot,
            [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
            { saveImmediately: true },
        );
        syncUIWithSettings();
        updateCharList();
        injectPrompt();

        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        appliedRuntime = captureStorageRuntimeState();
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = areScopeStorageKeysCurrent(scopeKeyBindings)
            && isRuntimeContextCurrent(binding.context)
            && activeStorageScope === scope
            && activeStorageKey === targetKey;
        if (!persisted || !contextCurrent) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = await rollbackStorageTransaction(
                transaction,
                expected,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            );
            return {
                ok: false,
                persisted: false,
                error: contextCurrent ? 'destination_persist_failed' : 'context_changed',
                message: contextCurrent
                    ? rollbackPersisted
                        ? 'The new storage scope could not be saved. The previous scope has been restored.'
                        : 'The scope change and its recovery could not be saved reliably. Export your colors before reloading.'
                    : 'The active chat or card changed before the scope switch completed. The scope change was rolled back.',
                previousScope,
                previousKey,
                rollbackPersisted,
            };
        }
        const descriptor = getStorageScopeDescriptor(scope);
        return {
            ok: true,
            persisted,
            strategy,
            previousScope,
            previousKey,
            scope,
            key: targetKey,
            targetExisted,
            destinationWritten,
            loaded: loadResult.loaded,
            characterCount: descriptor.characterCount,
            descriptor,
            message: descriptor.exists
                ? `${descriptor.label} is active with ${descriptor.characterCount} character${descriptor.characterCount === 1 ? '' : 's'}.`
                : `${descriptor.label} is active with an empty color table.`,
            refresh: { characterState: true, history: true, theme: true, ui: true, prompt: true, render: true, fonts: true },
            rollbackTransaction: transaction,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to switch color storage scope:', error);
        const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const contextCurrent = isRuntimeContextCurrent(binding.context)
            && areScopeStorageKeysCurrent(scopeKeyBindings);
        const rollbackPersisted = await rollbackStorageTransaction(
            transaction,
            appliedRecord,
            appliedRuntime,
            failedSnapshot,
            contextCurrent,
        );
        return {
            ok: false,
            error: contextCurrent ? 'scope_apply_failed' : 'context_changed',
            message: rollbackPersisted
                ? 'The storage scope could not be changed. The previous state was restored.'
                : 'The scope change and its recovery could not be saved reliably. Export your colors before reloading.',
            previousScope,
            previousKey,
            rollbackPersisted,
        };
    }
}

function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function getStylePackRegistryKey(pack, digest) {
    const id = String(pack?.metadata?.id || pack?.metadata?.name || 'unnamed').trim() || 'unnamed';
    const version = String(pack?.metadata?.version || '1').trim() || '1';
    return `${id}@${version}/${digest}`;
}

function getStylePackItemMappings(plan) {
    const itemMappings = {};
    for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
        const mappings = {};
        for (const operation of plan.operations || []) {
            if (operation.category !== category || operation.action === 'keep') continue;
            mappings[operation.sourceName] = operation.targetName;
        }
        if (Object.keys(mappings).length) itemMappings[category] = mappings;
    }
    return itemMappings;
}

function applyStylePackAppearance(appearance) {
    for (const key of AESTHETIC_APPEARANCE_KEYS) {
        if (!hasOwn(appearance, key)) continue;
        if (key === 'narratorColor') {
            setNarratorStyle(settings, {
                ...normalizeNarratorStyle(settings.narratorStyle, { legacy: settings }),
                baseColor: appearance.narratorColor,
            }, applyThemeReadabilityAndBrightness);
        } else {
            settings[key] = cloneJsonValue(appearance[key]);
        }
    }
}

function applyStylePackAssignments(pack, plan, mode) {
    const incoming = {};
    for (const operation of plan.operations || []) {
        if (operation.category !== 'assignmentPresets') continue;
        for (const entry of pack.assignmentPresets?.[operation.sourceName] || []) {
            const name = String(entry?.name || '').trim();
            if (name) incoming[name.toLowerCase()] = entry;
        }
    }
    const incomingColors = normalizeImportedColorsForApply(incoming, COLOR_SCHEMA_VERSION);
    if (!Object.keys(incomingColors).length) return false;
    const mergedColors = { ...incomingColors };
    for (const [key, entry] of Object.entries(characterColors)) {
        const mergeKey = mergedColors[key] ? `existing_${key}` : key;
        mergedColors[mergeKey] = entry;
    }
    setCharacterColors(mode === 'replace'
        ? incomingColors
        : normalizeCharacterColors(mergedColors));
    if (mode === 'replace') {
        selectedCharacterKeys.clear();
        setExpandedCharacterRows(new Set());
        setSwapMode(null);
    }
    clearSpeakerRegexCache();
    setLastProcessedMessageSignature('');
    return true;
}

export function getStylePackRegistry() {
    const record = extension_settings?.[MODULE_NAME];
    return normalizeStylePackRegistry(record?.stylePackRegistry);
}

/** Analyze only local JSON and current library names. This never persists or binds a chat scope. */
export async function analyzeStylePackImport(source) {
    const analysis = await analyzeStylePackEnvelopeSource(source, { includeAssignmentPresets: true });
    if (!analysis.ok) return analysis;
    const current = buildAutoSyncRecord(extension_settings?.[MODULE_NAME] || {});
    const conflicts = analyzeStylePackConflicts(analysis.pack, current, { includeAssignmentPresets: true });
    return {
        ...analysis,
        conflicts,
        registryKey: getStylePackRegistryKey(analysis.pack, analysis.digest),
    };
}

function getStylePackPlanOptions(pack, options, includeAssignmentPresets) {
    const selected = isPlainObject(options?.selected) ? options.selected : {};
    const categoryStrategies = isPlainObject(options?.categoryStrategies) ? options.categoryStrategies : {};
    const decisions = isPlainObject(options?.decisions) ? cloneJsonValue(options.decisions) : {};
    for (const category of ['palettes', 'gradientPresets', 'assignmentPresets']) {
        const strategy = categoryStrategies[category];
        if (!['keep', 'rename', 'replace'].includes(strategy)) continue;
        if (!isPlainObject(decisions[category])) decisions[category] = {};
        for (const name of Object.keys(pack?.[category] || {})) {
            if (decisions[category][name] === undefined) decisions[category][name] = strategy;
        }
    }
    return {
        selected: {
            palettes: selected.palettes,
            gradientPresets: selected.gradientPresets,
            assignmentPresets: includeAssignmentPresets ? selected.assignmentPresets : [],
        },
        includeAssignmentPresets,
        includeAppearance: false,
        conflictStrategy: options?.conflictStrategy || 'keep',
        decisions,
        resolutions: options?.resolutions,
    };
}

async function rollbackStylePackImport({ transaction, baseRecord, appliedRecord, appliedRuntime, needsScope, contextCurrent }) {
    if (!needsScope) return rollbackModuleRecord(baseRecord, appliedRecord || baseRecord);
    const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
    return rollbackStorageTransaction(
        transaction,
        appliedRecord,
        appliedRuntime,
        failedSnapshot,
        contextCurrent,
    );
}

/**
 * Apply a reviewed pack in one verified module-record transaction. Library-only
 * installs do not touch the active color scope; applying appearance or entries does.
 */
export async function applyStylePackImport(reviewed, options = {}) {
    if (!reviewed?.ok || !reviewed?.pack || typeof reviewed.digest !== 'string') {
        return importError('invalid_reviewed_pack', 'Choose a style pack and review it before installing.');
    }

    let normalized;
    let digest;
    try {
        normalized = normalizeStylePackEnvelope(reviewed.pack, { includeAssignmentPresets: true });
        digest = await digestStylePackEnvelope(normalized.pack, { includeAssignmentPresets: true });
    } catch (error) {
        return importError('invalid_reviewed_pack', 'The reviewed style pack is no longer valid.');
    }
    if (digest !== reviewed.digest) {
        return importError('digest_mismatch', 'The style pack changed after review. Analyze it again before installing.');
    }

    const applyAssignments = options.applyAssignments === true;
    const applyAppearance = options.applyAppearance === true;
    const installAssignments = options.installAssignmentPresets === true
        || options.includeAssignmentPresets === true
        || applyAssignments;
    const needsScope = applyAssignments || applyAppearance;
    const binding = needsScope ? captureActiveStorageBinding() : null;
    return runStorageOperation(() => applyStylePackImportInternal(
        normalized,
        digest,
        options,
        { applyAssignments, applyAppearance, installAssignments, needsScope, binding },
    ));
}

async function applyStylePackImportInternal(normalized, digest, options, mode) {
    const { applyAssignments, applyAppearance, installAssignments, needsScope, binding } = mode;
    const baseRecord = getModuleRecordSnapshot();
    const transaction = needsScope ? captureStorageTransaction(binding) : null;
    let appliedRecord = baseRecord;
    let appliedRuntime = needsScope ? captureStorageRuntimeState() : null;
    let mutationStarted = false;

    try {
        if (needsScope && !isActiveStorageBindingCurrent(binding)) {
            return contextChangedError('The active style-pack target changed after review.');
        }
        if (needsScope && binding.scope === 'chat') {
            const metadataSafety = await ensureChatScopeMetadataSafety();
            if (!isActiveStorageBindingCurrent(binding)) {
                return contextChangedError('The active style-pack target changed after review.');
            }
            if (!metadataSafety.safe) {
                return importError('chat_metadata_persist_failed', 'The per-chat identifier could not be saved safely.');
            }
        }

        const record = getAutoSyncRecord(true);
        const plan = buildStylePackInstallationPlan(
            normalized.pack,
            record,
            getStylePackPlanOptions(normalized.pack, options, installAssignments),
        );
        const paletteOperations = plan.operations.filter(operation => operation.category === 'palettes' && operation.action !== 'keep');
        const gradientOperations = plan.operations.filter(operation => operation.category === 'gradientPresets' && operation.action !== 'keep');
        const assignmentOperations = plan.operations.filter(operation => operation.category === 'assignmentPresets' && operation.action !== 'keep');
        const hasLibraryChanges = paletteOperations.length || gradientOperations.length || assignmentOperations.length;
        if (!hasLibraryChanges && !applyAssignments && !applyAppearance) {
            return {
                ok: true,
                digest,
                registryKey: getStylePackRegistryKey(normalized.pack, digest),
                summary: plan.summary,
                installed: 0,
                unchanged: true,
            };
        }

        mutationStarted = true;
        if (paletteOperations.length) {
            record.customPalettes = normalizeCustomPalettes({ ...record.customPalettes, ...plan.install.palettes });
            record.customPaletteMeta = isPlainObject(record.customPaletteMeta) ? { ...record.customPaletteMeta } : {};
            for (const operation of paletteOperations) {
                const metadata = normalized.paletteMetadata[operation.sourceName];
                if (metadata) record.customPaletteMeta[operation.targetName] = metadata;
                else delete record.customPaletteMeta[operation.targetName];
            }
        }
        if (gradientOperations.length) {
            record.customGradientPresets = normalizeGradientPresets({ ...record.customGradientPresets, ...plan.install.gradientPresets });
        }
        if (assignmentOperations.length) {
            record.presets = normalizeStoredColorPresets({ ...record.presets, ...plan.install.assignmentPresets });
        }

        const registryKey = getStylePackRegistryKey(normalized.pack, digest);
        const registry = normalizeStylePackRegistry(record.stylePackRegistry);
        registry[registryKey] = {
            installedAt: new Date().toISOString(),
            itemMappings: getStylePackItemMappings(plan),
        };
        record.stylePackRegistry = registry;
        persistModuleStore(record, { debounce: false });

        let changedRuntime = false;
        if (needsScope) {
            if (!isActiveStorageBindingCurrent(binding)) {
                const rollbackPersisted = await rollbackStylePackImport({
                    transaction,
                    baseRecord,
                    appliedRecord,
                    appliedRuntime,
                    needsScope,
                    contextCurrent: false,
                });
                return { ...contextChangedError(), rollbackPersisted };
            }
            const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            if (applyAppearance && normalized.pack.appearance) {
                applyStylePackAppearance(normalized.pack.appearance);
                changedRuntime = true;
            }
            if (applyAssignments) {
                changedRuntime = applyStylePackAssignments(
                    normalized.pack,
                    plan,
                    options.assignmentApplyMode === 'replace' ? 'replace' : 'merge',
                ) || changedRuntime;
            }
            if (changedRuntime) {
                normalizeToggleSettings();
                invalidateThemeCache();
                syncAllEffectiveColors();
                applyLiveColorChangesFromSnapshot(
                    colorSnapshot,
                    [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])],
                    { saveImmediately: true },
                );
                commit({ history: false });
            }
        }

        refreshGradientPresetControls();
        syncUIWithSettings();
        if (changedRuntime) updateCharList();
        const expected = prepareExpectedModuleRecord();
        appliedRecord = expected;
        appliedRuntime = needsScope ? captureStorageRuntimeState() : null;
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = !needsScope || isActiveStorageBindingCurrent(binding);
        if (!persisted || !contextCurrent) {
            const rollbackPersisted = await rollbackStylePackImport({
                transaction,
                baseRecord,
                appliedRecord,
                appliedRuntime,
                needsScope,
                contextCurrent,
            });
            return {
                ...importError(
                    contextCurrent ? 'style_pack_persist_failed' : 'context_changed',
                    contextCurrent
                        ? rollbackPersisted
                            ? 'The style pack could not be saved. The previous library was restored.'
                            : 'The style-pack install and recovery could not be saved reliably. Export your library before reloading.'
                        : 'The active chat or card changed before the style pack completed. The install was rolled back.',
                ),
                rollbackPersisted,
            };
        }

        if (changedRuntime) saveHistory();
        return {
            ok: true,
            digest,
            registryKey,
            summary: plan.summary,
            installed: paletteOperations.length + gradientOperations.length + assignmentOperations.length,
            appliedAppearance: applyAppearance && !!normalized.pack.appearance,
            appliedAssignments: applyAssignments,
            assignmentPresetsInstalled: assignmentOperations.length,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to apply style pack:', error);
        const contextCurrent = !needsScope || isActiveStorageBindingCurrent(binding);
        const rollbackPersisted = mutationStarted
            ? await rollbackStylePackImport({
                transaction,
                baseRecord,
                appliedRecord,
                appliedRuntime,
                needsScope,
                contextCurrent,
            })
            : true;
        return {
            ...importError(
                'style_pack_apply_failed',
                rollbackPersisted
                    ? 'The style pack could not be applied. The previous library was restored.'
                    : 'The style-pack install and recovery could not be saved reliably. Export your library before reloading.',
            ),
            rollbackPersisted,
        };
    }
}

function importError(error, message) {
    return { ok: false, error, message };
}

async function parseImportSource(source) {
    const isFileLike = typeof source?.text === 'function'
        || (typeof source?.name === 'string' && typeof source?.size === 'number' && typeof source?.slice === 'function');
    if (typeof source !== 'string' && !isFileLike) {
        return { ok: true, value: source };
    }

    let text;
    try {
        if (typeof source === 'string') {
            text = source;
        } else if (typeof source.text === 'function') {
            text = await source.text();
        } else if (typeof FileReader === 'function') {
            text = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = event => resolve(event.target?.result);
                reader.onerror = () => reject(reader.error || new Error('File read failed'));
                reader.readAsText(source);
            });
        } else {
            return importError('read_failed', 'The selected file could not be read.');
        }
    } catch {
        return importError('read_failed', 'The selected file could not be read.');
    }

    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return importError('invalid_json', 'The source is not valid JSON.');
    }
}

function normalizeImportSettings(source, keys) {
    const normalized = normalizeStoredSettings(source);
    if (!hasOwn(source, 'colorStorageScope') && !hasOwn(source, 'shareColorsGlobally')) delete normalized.colorStorageScope;
    for (const key of Object.keys(normalized)) {
        if (!keys.includes(key)) delete normalized[key];
    }
    return normalized;
}

function getExplicitImportScope(source) {
    if (!hasOwn(source, 'colorStorageScope')) {
        if (hasOwn(source, 'shareColorsGlobally')) {
            return { ok: true, requestedStorageScope: source.shareColorsGlobally === true ? 'global' : 'card' };
        }
        return { ok: true };
    }
    if (!COLOR_STORAGE_SCOPES.includes(source.colorStorageScope)) {
        return importError('invalid_storage_scope', `Unknown color storage scope: ${String(source.colorStorageScope)}`);
    }
    return { ok: true, requestedStorageScope: source.colorStorageScope };
}

function buildImportPreview(colors, profiles, importedSettings, customGradientPresets, requestedStorageScope) {
    const preview = {
        characterCount: Object.keys(colors || {}).length,
        groupProfileCount: Object.keys(profiles || {}).length,
        settingsPresent: importedSettings !== null,
        settingsCount: Object.keys(importedSettings || {}).length,
        customGradientPresetCount: Object.keys(customGradientPresets || {}).length,
    };
    if (requestedStorageScope !== undefined) preview.requestedStorageScope = requestedStorageScope;
    return preview;
}

function analyzeColorPayload(source, kind = 'colors') {
    if (!isPlainObject(source) || !hasOwn(source, 'colors') || !isPlainObject(source.colors)) {
        return importError('unrecognized_payload', 'The source does not contain a recognized color payload.');
    }
    if (hasOwn(source, 'settings') && !isPlainObject(source.settings)) {
        return importError('invalid_settings', 'The color payload has invalid settings data.');
    }
    if (hasOwn(source, 'customGradientPresets') && !isPlainObject(source.customGradientPresets)) {
        return importError('invalid_gradient_presets', 'The color payload has invalid custom gradient presets.');
    }
    if (hasOwn(source, 'groupProfiles') && !isPlainObject(source.groupProfiles)) {
        return importError('invalid_group_profiles', 'The color payload has invalid group profile data.');
    }

    const settingsPresent = hasOwn(source, 'settings');
    const importedSettings = settingsPresent ? normalizeImportSettings(source.settings, ACTIVE_SETTING_KEYS) : null;
    const scopeResult = getExplicitImportScope(source.settings);
    if (!scopeResult.ok) return scopeResult;
    const presetsPresent = hasOwn(source, 'customGradientPresets');
    const customGradientPresets = presetsPresent ? normalizeGradientPresets(source.customGradientPresets) : null;
    const colors = normalizeCharacterColors(source.colors);
    const profilesPresent = hasOwn(source, 'groupProfiles');
    const profiles = profilesPresent ? normalizeGroupProfiles(source.groupProfiles) : null;
    const payload = {
        kind,
        colors,
        ...(profilesPresent ? { groupProfiles: profiles } : {}),
        ...(settingsPresent ? { settings: importedSettings } : {}),
        ...(presetsPresent ? { customGradientPresets } : {}),
        ...(scopeResult.requestedStorageScope !== undefined
            ? { requestedStorageScope: scopeResult.requestedStorageScope }
            : {}),
    };
    return {
        ok: true,
        kind,
        payload,
        preview: buildImportPreview(colors, profiles, importedSettings, customGradientPresets, scopeResult.requestedStorageScope),
    };
}

function analyzeSettingsPayload(source) {
    if (!isPlainObject(source) || !hasOwn(source, 'settings') || !isPlainObject(source.settings)) {
        return importError('unrecognized_payload', 'The source does not contain a recognized settings payload.');
    }
    if (hasOwn(source, 'customGradientPresets') && !isPlainObject(source.customGradientPresets)) {
        return importError('invalid_gradient_presets', 'The settings payload has invalid custom gradient presets.');
    }

    const importedSettings = normalizeImportSettings(source.settings, GLOBAL_SETTINGS_V2_KEYS);
    const scopeResult = getExplicitImportScope(source.settings);
    if (!scopeResult.ok) return scopeResult;
    const presetsPresent = hasOwn(source, 'customGradientPresets');
    const customGradientPresets = presetsPresent ? normalizeGradientPresets(source.customGradientPresets) : null;
    if (!Object.keys(importedSettings).length && !Object.keys(customGradientPresets || {}).length) {
        return importError('unrecognized_payload', 'The source contains no recognized settings or custom gradient presets.');
    }

    const payload = {
        kind: 'settings',
        settings: importedSettings,
        ...(presetsPresent ? { customGradientPresets } : {}),
        ...(scopeResult.requestedStorageScope !== undefined
            ? { requestedStorageScope: scopeResult.requestedStorageScope }
            : {}),
    };
    return {
        ok: true,
        kind: 'settings',
        payload,
        preview: buildImportPreview({}, {}, importedSettings, customGradientPresets, scopeResult.requestedStorageScope),
    };
}

function attachImportReviewContext(analysis, binding = captureActiveStorageBinding()) {
    if (!analysis?.ok || !isPlainObject(analysis.payload)) return analysis;
    analysis.payload.reviewedContext = {
        scope: binding.scope,
        key: binding.key,
        cardKey: getStorageKeyForScope('card'),
        context: binding.context,
    };
    return analysis;
}

export async function analyzeColorImport(source) {
    const binding = captureActiveStorageBinding();
    const parsed = await parseImportSource(source);
    if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the file was read.');
    return parsed.ok ? attachImportReviewContext(analyzeColorPayload(parsed.value), binding) : parsed;
}

export async function analyzeSettingsImport(source) {
    const binding = captureActiveStorageBinding();
    const parsed = await parseImportSource(source);
    if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the file was read.');
    return parsed.ok ? attachImportReviewContext(analyzeSettingsPayload(parsed.value), binding) : parsed;
}

export async function analyzeCardData(source) {
    const binding = captureActiveStorageBinding();
    const parsed = await parseImportSource(source);
    if (!isActiveStorageBindingCurrent(binding)) return contextChangedError('The active import target changed while the card data was read.');
    return parsed.ok ? attachImportReviewContext(analyzeColorPayload(parsed.value, 'card'), binding) : parsed;
}

export async function readCardData({ refresh = true } = {}) {
    const binding = captureActiveStorageBinding();
    if (refresh) {
        try {
            await getCharacters?.();
        } catch {
            return importError('card_read_failed', 'The character card could not be reloaded.');
        }
    }
    if (!isActiveStorageBindingCurrent(binding)) {
        return contextChangedError('The active character changed while the card was reloaded.');
    }
    try {
        const context = getContext();
        const characterId = context?.characterId;
        if (characterId === undefined || characterId === null) {
            return importError('no_character', 'No character is loaded.');
        }
        const data = context?.characters?.[characterId]?.data?.extensions?.dialogueColors;
        if (!data) return importError('no_card_data', 'The character card has no saved color data.');
        return await analyzeCardData(data);
    } catch {
        return importError('card_read_failed', 'The character card data could not be read.');
    }
}

function normalizeReviewedPayload(payload, kind) {
    if (!isPlainObject(payload) || payload.kind !== kind) {
        return importError('invalid_reviewed_payload', `Expected a reviewed ${kind} payload.`);
    }
    if (kind === 'settings') return analyzeSettingsPayload(payload);
    return analyzeColorPayload(payload, kind);
}

function applyImportedSettings(importedSettings, activeScope) {
    for (const [key, value] of Object.entries(importedSettings || {})) {
        if (key === 'colorStorageScope' || key === 'colorSchemaVersion') continue;
        settings[key] = value;
    }
    settings.colorStorageScope = activeScope;
}

function normalizeImportedColorsForApply(colors, colorSchemaVersion) {
    const normalized = normalizeCharacterColors(colors);
    const parsedVersion = Number(colorSchemaVersion);
    if (!Number.isFinite(parsedVersion) || parsedVersion < 4) {
        for (const entry of Object.values(normalized)) {
            const effectiveColor = normalizeHexColor(entry.color, null);
            if (effectiveColor) entry.baseColor = deriveBaseColorFromEffectiveColor(effectiveColor);
        }
    }
    return normalized;
}

function applyImportedGradientPresets(payload) {
    if (!hasOwn(payload, 'customGradientPresets')) return false;
    const incoming = normalizeGradientPresets(payload.customGradientPresets);
    const nextPresets = { ...incoming, ...getCustomGradientPresets() };
    const record = getAutoSyncRecord(true);
    record.version = COLOR_SCHEMA_VERSION;
    record.customGradientPresets = nextPresets;
    persistModuleStore(record, { debounce: false });
    return true;
}

function importReviewContextMatches(reviewedContext) {
    if (!isPlainObject(reviewedContext)) return true;
    const binding = captureActiveStorageBinding();
    if (reviewedContext.scope !== binding.scope || reviewedContext.key !== binding.key) return false;
    if (reviewedContext.context && !isRuntimeContextCurrent(reviewedContext.context)) return false;
    return !reviewedContext.cardKey || reviewedContext.cardKey === getStorageKeyForScope('card');
}

async function applyReviewedImport(payload, kind, options = {}) {
    const { mode, applyScope = false } = options || {};
    if (!['merge', 'replace'].includes(mode)) {
        return importError('invalid_mode', 'Import mode must be either merge or replace.');
    }
    const reviewed = normalizeReviewedPayload(payload, kind);
    if (!reviewed.ok) return reviewed;
    const operationBinding = captureActiveStorageBinding();
    const requestedScopeIncluded = hasOwn(reviewed.payload, 'requestedStorageScope');
    const requestedTargetKey = applyScope === true && requestedScopeIncluded
        ? getStorageKeyForScope(reviewed.payload.requestedStorageScope)
        : null;
    return runStorageOperation(() => applyReviewedImportInternal(
        reviewed,
        payload.reviewedContext,
        kind,
        { mode, applyScope },
        operationBinding,
        requestedTargetKey,
    ));
}

async function applyReviewedImportInternal(
    reviewed,
    reviewedContext,
    kind,
    options,
    operationBinding,
    requestedTargetKey,
) {
    const { mode, applyScope } = options;
    const normalized = reviewed.payload;
    const requestedScopeIncluded = hasOwn(normalized, 'requestedStorageScope');
    const contextBindings = { [operationBinding.scope]: operationBinding.contextKey };
    if (applyScope === true && requestedScopeIncluded) {
        contextBindings[normalized.requestedStorageScope] = requestedTargetKey;
    }
    let transaction = null;
    let importBinding = operationBinding;
    let mutationStarted = false;
    let appliedRecord = null;
    let appliedRuntime = null;

    try {
        if (!isActiveStorageBindingCurrent(operationBinding) || !importReviewContextMatches(reviewedContext)) {
            return contextChangedError('The active import target changed after review.');
        }
        transaction = captureStorageTransaction(operationBinding);
        appliedRecord = transaction.record;
        appliedRuntime = captureStorageRuntimeState();
        if (applyScope === true && requestedScopeIncluded && normalized.requestedStorageScope !== getCurrentStorageScope()) {
            mutationStarted = true;
            const switchResult = await switchColorStorageScopeInternal(
                normalized.requestedStorageScope,
                'switch',
                operationBinding,
                requestedTargetKey,
            );
            if (!switchResult.ok) return switchResult;
            transaction = switchResult.rollbackTransaction || transaction;
            appliedRecord = getModuleRecordSnapshot();
            appliedRuntime = captureStorageRuntimeState();
        }
        if (!isRuntimeContextCurrent(operationBinding.context) || !areScopeStorageKeysCurrent(contextBindings)) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = mutationStarted
                ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, false)
                : true;
            return { ...contextChangedError(), rollbackPersisted };
        }

        const activeScope = getCurrentStorageScope();
        importBinding = captureActiveStorageBinding();
        if (activeScope === 'chat') {
            appliedRecord = mutationStarted ? getModuleRecordSnapshot() : appliedRecord;
            const metadataSafety = await ensureChatScopeMetadataSafety();
            if (!isActiveStorageBindingCurrent(importBinding) || !areScopeStorageKeysCurrent(contextBindings)) {
                const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                const rollbackPersisted = mutationStarted
                    ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, false)
                    : true;
                return { ...contextChangedError(), rollbackPersisted };
            }
            if (!metadataSafety.safe) {
                const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                const rollbackPersisted = mutationStarted
                    ? await rollbackStorageTransaction(transaction, appliedRecord, appliedRuntime, failedSnapshot, true)
                    : true;
                return {
                    ...importError('chat_metadata_persist_failed', 'The per-chat identifier could not be saved safely.'),
                    rollbackPersisted,
                };
            }
        }

        if (!mutationStarted) {
            transaction = captureStorageTransaction(importBinding);
            appliedRecord = transaction.record;
            appliedRuntime = captureStorageRuntimeState();
        }

        const colorSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        mutationStarted = true;
        applyImportedSettings(normalized.settings, activeScope);
        normalizeToggleSettings();
        invalidateThemeCache();

        const hasColors = kind !== 'settings';
        if (hasColors) {
            const incomingColors = normalizeImportedColorsForApply(normalized.colors, normalized.settings?.colorSchemaVersion);
            const mergedColors = { ...incomingColors };
            for (const [key, entry] of Object.entries(characterColors)) {
                const mergeKey = mergedColors[key] ? `existing_${key}` : key;
                mergedColors[mergeKey] = entry;
            }
            setCharacterColors(mode === 'merge'
                ? normalizeCharacterColors(mergedColors)
                : incomingColors);
            const incomingProfiles = normalizeGroupProfiles(normalized.groupProfiles);
            setGroupProfiles(mode === 'merge'
                ? normalizeGroupProfiles({ ...incomingProfiles, ...groupProfiles })
                : incomingProfiles);
            if (mode === 'replace') {
                selectedCharacterKeys.clear();
                setExpandedCharacterRows(new Set());
                setSwapMode(null);
            }
            clearSpeakerRegexCache();
            setLastProcessedMessageSignature('');
        }

        settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        migrateColorSchemaIfNeeded();
        syncAllEffectiveColors();
        const renderKeys = [...new Set([...Object.keys(colorSnapshot), ...Object.keys(characterColors)])];
        applyLiveColorChangesFromSnapshot(colorSnapshot, renderKeys, { saveImmediately: true });
        const gradientPresetsChanged = applyImportedGradientPresets(normalized);
        commit({ history: false });
        if (gradientPresetsChanged) refreshGradientPresetControls();
        syncUIWithSettings();

        const expected = getModuleRecordSnapshot();
        appliedRecord = expected;
        appliedRuntime = captureStorageRuntimeState();
        const persisted = await persistSettingsImmediately(expected);
        const contextCurrent = isActiveStorageBindingCurrent(importBinding)
            && areScopeStorageKeysCurrent(contextBindings);
        if (!persisted || !contextCurrent) {
            const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            const rollbackPersisted = await rollbackStorageTransaction(
                transaction,
                appliedRecord,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            );
            return {
                ...importError(
                    contextCurrent ? 'import_persist_failed' : 'context_changed',
                    contextCurrent
                        ? rollbackPersisted
                            ? 'The imported data could not be saved. The previous data was restored.'
                            : 'The import and its recovery could not be saved reliably. Export your colors before reloading.'
                        : 'The active chat or card changed before the import completed. The import was rolled back.',
                ),
                rollbackPersisted,
            };
        }

        saveHistory();
        return {
            ok: true,
            kind,
            mode,
            scope: activeScope,
            scopeApplied: applyScope === true && requestedScopeIncluded,
            characterCount: Object.keys(characterColors).length,
            groupProfileCount: Object.keys(groupProfiles).length,
            settingsCount: reviewed.preview.settingsCount,
            customGradientPresetCount: reviewed.preview.customGradientPresetCount,
        };
    } catch (error) {
        console.error('[Dialogue Colors] Failed to apply reviewed import data:', error);
        const failedSnapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const contextCurrent = isActiveStorageBindingCurrent(importBinding)
            && areScopeStorageKeysCurrent(contextBindings);
        const rollbackPersisted = mutationStarted
            ? await rollbackStorageTransaction(
                transaction,
                appliedRecord,
                appliedRuntime,
                failedSnapshot,
                contextCurrent,
            )
            : true;
        return {
            ...importError(
                'apply_failed',
                rollbackPersisted
                    ? 'The reviewed data could not be applied. The previous data was restored.'
                    : 'The import and its recovery could not be saved reliably. Export your colors before reloading.',
            ),
            rollbackPersisted,
        };
    }
}

export function applyColorImport(payload, options) {
    return applyReviewedImport(payload, 'colors', options);
}

export function applySettingsImport(payload, options) {
    return applyReviewedImport(payload, 'settings', options);
}

export function applyCardData(payload, options) {
    return applyReviewedImport(payload, 'card', options);
}

export function exportColors() {
    const colors = normalizeCharacterColors(characterColors);
    const profiles = normalizeGroupProfiles(groupProfiles);
    const customGradientPresets = getCustomGradientPresets();
    const blob = new Blob([JSON.stringify({ version: COLOR_SCHEMA_VERSION, colors, groupProfiles: profiles, settings: buildFullSettingsSnapshot(), customGradientPresets }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importColors(file) {
    const analysis = await analyzeColorImport(file);
    if (!analysis.ok) {
        toast.error(analysis.message || 'Invalid color file');
        return analysis;
    }
    const result = await applyColorImport(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Imported!');
    else toast.error(result.message || 'Could not import colors');
    return result;
}

export function exportSettings() {
    normalizeCurrentColorStorageScope();
    const settingsData = {};
    GLOBAL_SETTINGS_V2_KEYS.forEach(key => {
        if (settings[key] !== undefined) settingsData[key] = settings[key];
    });
    const exportObj = {
        version: COLOR_SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        settings: settingsData,
        customGradientPresets: getCustomGradientPresets(),
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dc-settings-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success('Settings exported!');
}

export async function importSettings(file) {
    const analysis = await analyzeSettingsImport(file);
    if (!analysis.ok) {
        toast.error(analysis.message || 'Invalid settings file');
        return analysis;
    }
    const result = await applySettingsImport(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Settings imported!');
    else toast.error(result.message || 'Could not import settings');
    return result;
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
    const previousSettings = buildFullSettingsSnapshot();

    Object.entries(TOGGLE_SETTING_DEFAULTS).forEach(([key, defaultValue]) => {
        settings[key] = defaultValue;
    });

    settings.themeMode = 'auto';
    settings.colorTheme = 'pastel';
    settings.brightness = 0;
    settings.thoughtSymbols = '*';
    setNarratorStyle(settings, { enabled: false, baseColor: '#888888', gradient: null, gradientGenerator: null }, applyThemeReadabilityAndBrightness);
    settings.promptDepth = 1;
    settings.promptRole = 'system';
    settings.promptMode = 'inject';
    settings.sortMode = 'name';
    settings.coloringEngine = 'llm';
    settings.gradientRandomMasterSeed = '';
    settings.colorVisionPreviewMode = 'none';
    settings.colorVisionPreviewSeverity = 100;
    settings.colorVisionPreviewTarget = 'all';
    settings.gradientAnimationMode = 'auto';
    settings.llmConnectionProfile = null;
    settings.attributionConnectionProfile = null;
    settings.attributionReviewPolicy = 'legacy-auto';
    settings.attributionMaxTokens = 4096;
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
        applyAutoSyncRecord(record, { serverVerified: true });
    } catch (e) {
        console.warn('[Dialogue Colors] Auto-sync settings refresh failed:', e);
        setAutoSyncError('Read failed');
    }
}

export function saveSettingsToStore(options = {}) {
    const { force = false, schedule = true } = options;
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
    if (schedule) queueImmediateSettingsSave();
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
    // Polling is stopped, so the save echo that would normally confirm the
    // pending record never arrives — clear it now or the 15s timeout paints a
    // spurious "Save failed" status.
    clearAutoSyncPending();
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
        let changed = false;
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
            changed = true;
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
            changed = true;
        }

        const cssEffectsTrimRegex = '/<span[^>]*style=["\'][^"\']*(?:transform|skew|rotate|scale|opacity|filter|text-shadow|translate)[^"\']*["\'][^>]*>(.*?)<\\/span>/gi';
        const cssEffectsTrim = extension_settings.regex.find(r => r?.scriptName === 'Trim CSS Effects (Prompt)');
        if (cssEffectsTrim) {
            if (cssEffectsTrim.findRegex !== cssEffectsTrimRegex || cssEffectsTrim.replaceString !== '$1') {
                cssEffectsTrim.findRegex = cssEffectsTrimRegex;
                cssEffectsTrim.replaceString = '$1';
                changed = true;
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
            changed = true;
        }
        if (changed) queueImmediateSettingsSave();
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
        char.data.extensions.dialogueColors = {
            colors: normalizeCharacterColors(characterColors),
            groupProfiles: normalizeGroupProfiles(groupProfiles),
            settings: buildFullSettingsSnapshot(),
        };
        saveData();
        saveCharacterDebounced?.();
        toast.info('Card save queued.');
    } catch { toast.error('Failed to save to card'); }
}

export async function loadFromCard() {
    const analysis = await readCardData();
    if (!analysis.ok) {
        if (analysis.error === 'no_card_data') toast.info('No saved colors in card');
        else toast.error(analysis.message || 'Failed to load from card');
        return analysis;
    }
    const result = await applyCardData(analysis.payload, { mode: 'merge', applyScope: false });
    if (result.ok) toast.success('Loaded from card');
    else toast.error(result.message || 'Failed to load from card');
    return result;
}

export function tryLoadFromCard() {
    try {
        const currentScope = getCurrentStorageScope();
        const ctx = getContext();
        const char = ctx?.characters?.[ctx?.characterId];
        const data = char?.data?.extensions?.dialogueColors;
        if (data?.colors) {
            setCharacterColors(normalizeImportedColorsForApply(data.colors, data.settings?.colorSchemaVersion));
            setGroupProfiles(normalizeGroupProfiles(data.groupProfiles));
            selectedCharacterKeys.clear();
            setExpandedCharacterRows(new Set());
            setSwapMode(null);
            settings.colorStorageScope = currentScope;
            normalizeToggleSettings();
            settings.colorSchemaVersion = COLOR_SCHEMA_VERSION;
            saveHistory(); saveData();
        }
    } catch { }
}
