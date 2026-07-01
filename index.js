import { converter } from '../../../../script.js';
import { power_user } from '/scripts/power-user.js';
import { escapeHtml, escapeRegex } from '/scripts/utils.js';

(async function () {
    'use strict';

    const { extension_settings, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt, saveSettings, saveSettingsDebounced, saveCharacterDebounced, getCharacters, extension_prompt_types, extension_prompt_roles, generateQuietPrompt, registerMacro, getRequestHeaders } = await import('../../../../script.js');
    const RUNTIME_GUARD_KEY = '__dialogueColorsRuntime_v1';
    if (globalThis[RUNTIME_GUARD_KEY]?.initialized) {
        console.warn('[Dialogue Colors] Runtime already initialized; skipping duplicate script execution.');
        return;
    }
    const runtimeState = {
        initialized: true,
        contextMenuSetup: false,
        keyboardSetup: false,
        eventsRegistered: false,
        eventHandlers: null,
        chatObserver: null,
        chatObserverTarget: null,
        chatRootObserver: null,
        chatRootObserverTimer: null,
        chatObserverTimer: null,
        domHealthCheckTimer: null,
        chatChangedRafId: null,
        // Per-message self-terminating observers that replace the old polling settle timers.
        // Keyed by the .mes element; value is { observer, fallbackTimer }.
        messageSettleObservers: new Map(),
        // Long-lived observers on decorated messages that re-decorate when an
        // external agent (e.g. Prose Polisher) rebuilds .mes_text innerHTML.
        // Keyed by the .mes element; value is { observer, mesText }.
        decoratedWatchers: new Map(),
        // Coalesced post-mutation repairs keyed by message index. These force
        // a repaint before decoration when agents rewrite msg.mes after gen.
        messageDomRepairTimers: new Map(),
        pendingObservedMessages: new Set(),
    };
    globalThis[RUNTIME_GUARD_KEY] = runtimeState;

    // Invalidates derived caches (speaker mention regexes). Called on chat change and UI init.
    function clearDomCache() { clearSpeakerRegexCache(); }

    function escapeAttr(s) {
        return escapeHtml(s);
    }

    function normalizeBoolean(value, fallback = false) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
            if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
        }
        return fallback;
    }

    function normalizeToggleSettings() {
        pruneInactiveSettings();
        for (const [key, fallback] of Object.entries(TOGGLE_SETTING_DEFAULTS)) {
            settings[key] = normalizeBoolean(settings[key], fallback);
        }
        settings.coloringEngine = settings.coloringEngine === 'dom' ? 'dom' : 'llm';
    }

    function isDomEngine() {
        return settings.coloringEngine === 'dom';
    }

    function normalizeHexColor(value, fallback = '#888888') {
        const color = String(value ?? '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
    }

    function normalizeManualColorInput(value, fallback = null) {
        const color = String(value ?? '').trim();
        const withHash = color.startsWith('#') ? color : `#${color}`;
        return normalizeHexColor(withHash, fallback);
    }

    const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);

    function normalizeAliases(aliases) {
        if (!Array.isArray(aliases)) return [];
        return [...new Set(aliases.map(a => String(a ?? '').trim()).filter(Boolean))];
    }

    function normalizeGoogleFontName(fontName) {
        const normalized = String(fontName ?? '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        return normalized
            .replace(/[^A-Za-z0-9 .,'&+-]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
    }

    function getGoogleFontFamily(fontName) {
        const normalized = normalizeGoogleFontName(fontName);
        if (!normalized) return '';
        return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", sans-serif`;
    }

    function loadGoogleFont(fontName) {
        const normalized = normalizeGoogleFontName(fontName);
        if (!normalized || typeof document === 'undefined' || !document.head) return normalized;
        const key = normalized.toLowerCase();
        if (loadedGoogleFonts.has(key)) return normalized;
        loadedGoogleFonts.add(key);
        const family = encodeURIComponent(normalized).replace(/%20/g, '+');
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
        link.dataset.dcGoogleFont = key;
        link.onerror = () => {
            const fallback = document.createElement('link');
            fallback.rel = 'stylesheet';
            fallback.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
            fallback.dataset.dcGoogleFontFallback = key;
            document.head.appendChild(fallback);
        };
        document.head.appendChild(link);
        return normalized;
    }

    function normalizeCharacterEntry(entry, fallbackName = '') {
        const name = String(entry?.name ?? fallbackName ?? '').trim();
        if (!name) return null;
        const color = normalizeHexColor(entry?.color);
        const baseColor = normalizeHexColor(entry?.baseColor, color);
        return {
            color,
            baseColor,
            name,
            locked: !!entry?.locked,
            keep: !!entry?.keep,
            aliases: normalizeAliases(entry?.aliases),
            style: VALID_STYLES.has(entry?.style) ? entry.style : '',
            dialogueCount: Number.isFinite(entry?.dialogueCount) && entry.dialogueCount > 0 ? Math.floor(entry.dialogueCount) : 0,
            group: String(entry?.group ?? '').trim(),
            font: normalizeGoogleFontName(entry?.font)
        };
    }

    function normalizeCharacterColors(rawColors, options = {}) {
        if (!rawColors || typeof rawColors !== 'object') return {};
        const normalized = {};
        for (const [rawKey, entry] of Object.entries(rawColors)) {
            const normalizedEntry = normalizeCharacterEntry(entry, rawKey);
            if (!normalizedEntry) continue;
            const key = normalizedEntry.name.toLowerCase();
            if (!normalized[key]) {
                normalized[key] = normalizedEntry;
                continue;
            }
            const existing = normalized[key];
            existing.locked = existing.locked || normalizedEntry.locked;
            existing.keep = existing.keep || normalizedEntry.keep;
            existing.aliases = [...new Set([...existing.aliases, ...normalizedEntry.aliases])];
            existing.dialogueCount = Math.max(existing.dialogueCount || 0, normalizedEntry.dialogueCount || 0);
            if (!existing.group && normalizedEntry.group) existing.group = normalizedEntry.group;
            if (!existing.style && normalizedEntry.style) existing.style = normalizedEntry.style;
            if (!existing.font && normalizedEntry.font) existing.font = normalizedEntry.font;
            if (existing.baseColor === '#888888' && normalizedEntry.baseColor !== '#888888') existing.baseColor = normalizedEntry.baseColor;
            if (existing.color === '#888888' && normalizedEntry.color !== '#888888') existing.color = normalizedEntry.color;
        }
        return options.pruneCompositeEntries === true ? pruneReducibleCompositeEntries(normalized) : normalized;
    }

    const COLOR_CONFLICT_HUE_THRESHOLD = 12;
    const COLOR_CONFLICT_LIGHTNESS_THRESHOLD = 8;

    // Optimized color distance calculation
    function colorDistance(color1, color2) {
        const [h1, , l1] = hexToHsl(color1);
        const [h2, , l2] = hexToHsl(color2);
        const hDiff = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
        return hDiff < COLOR_CONFLICT_HUE_THRESHOLD && Math.abs(l1 - l2) < COLOR_CONFLICT_LIGHTNESS_THRESHOLD;
    }

    const MODULE_NAME = 'dialogue-colors';
    const COLOR_SCHEMA_VERSION = 4;
    const LEGACY_GLOBAL_SETTINGS_KEY = 'dc_global_settings';
    const GLOBAL_SETTINGS_V2_KEY = 'dc_global_settings_v2';
    const PRESETS_KEY = 'dc_presets';
    const LEGEND_POSITION_KEY = 'dc_legend_position';
    let characterColors = {};
    const loadedGoogleFonts = new Set();
    let colorHistory = [];
    let historyIndex = -1;
    let swapMode = null;
    let searchTerm = '';
    let expandedCharacterRows = new Set();
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, thoughtSymbols: '*', disableNarration: true, shareColorsGlobally: false, cssEffects: false, autoScanNewMessages: true, autoLockDetected: true, enableRightClick: false, promptDepth: 1, autoRecolor: true, autoColorize: false, llmAttributionCheck: false, llmAttributionParallel: false, attributionConservativeOnly: false, attributionMaxTokens: 4096, domStealthColors: true, disableToasts: false, llmConnectionProfile: null, attributionConnectionProfile: null, colorSchemaVersion: COLOR_SCHEMA_VERSION, promptMode: 'inject', promptRole: 'user', sortMode: 'name', coloringEngine: 'llm' };
    const TOGGLE_SETTING_DEFAULTS = Object.freeze({
        enabled: true,
        highlightMode: false,
        autoScanOnLoad: true,
        showLegend: false,
        disableNarration: true,
        shareColorsGlobally: false,
        cssEffects: false,
        autoScanNewMessages: true,
        autoLockDetected: true,
        enableRightClick: false,
        autoRecolor: true,
        autoColorize: false,
        llmAttributionCheck: false,
        llmAttributionParallel: false,
        attributionConservativeOnly: false,
        domStealthColors: true,
        disableToasts: false,
    });
    const GLOBAL_TOGGLE_KEYS = Object.freeze(Object.keys(TOGGLE_SETTING_DEFAULTS));
    const GLOBAL_VISUAL_KEYS = Object.freeze(['thoughtSymbols', 'themeMode', 'colorTheme', 'brightness', 'promptDepth', 'promptRole', 'promptMode', 'coloringEngine']);
    const GLOBAL_SETTINGS_V2_KEYS = Object.freeze([...new Set([...GLOBAL_VISUAL_KEYS, ...GLOBAL_TOGGLE_KEYS])]);
    const ACTIVE_SETTING_KEYS = Object.freeze([...new Set([...GLOBAL_SETTINGS_V2_KEYS, 'narratorColor', 'llmConnectionProfile', 'attributionConnectionProfile', 'attributionConservativeOnly', 'attributionMaxTokens', 'colorSchemaVersion', 'sortMode'])]);
    const LEGACY_AUTO_SYNC_ENABLED_KEY = 'dc_autosync_enabled';
    const AUTO_SYNC_SAVE_TIMEOUT_MS = 15000;
    let lastCharKey = null;
    let lastProcessedMessageSignature = '';
    // Phase 3A: Legend event listener cleanup
    let legendListeners = null;
    let autoRecolorHintShown = false;
    let isRecoloring = false;
    let isColorizing = false;
    let isAutoColorizing = false;
    let isVerifyingAttribution = false;
    let pendingAttributionVerifications = [];
    const ATTRIBUTION_VERIFIER_VERSION = 3;
    const AUTO_ATTRIBUTION_VERIFY_DELAY_MS = 300;
    const AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS = 500;
    const AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS = 3000;
    const STREAMING_ATTRIBUTION_VERIFY_DELAY_MS = 1000;
    let autoAttributionVerifyTimer = null;
    let autoAttributionVerifyTimerDue = 0;
    const pendingAutoAttributionVerifyIndices = new Map();
    const recentAutoAttributionVerifyAttempts = new Map();
    let isStreamingGenerationActive = false;
    let streamingAttributionVerifyTimer = null;
    let streamingAttributionGeneration = 0;
    let lastStreamingAttributionVerifyKey = '';
    let attributionChatGeneration = 0;
    const streamingAttributionOverrides = new Map();
    const streamingHeuristicCache = new Map();
    const LIVE_CHAT_SAVE_DELAY_MS = 350;
    const COLOR_STATE_SAVE_DELAY_MS = 180;
    let liveChatSaveTimer = null;
    let colorStateSaveTimer = null;
    let pendingLiveChatSave = false;
    let pendingColorStateSaveData = false;
    let pendingColorStateHistory = false;
    let pendingColorStateUpdateList = false;
    let pendingColorStateInjectPrompt = false;
    // Auto-sync state
    let autoSyncEnabled = false;
    let autoSyncInterval = null;
    let autoSyncLastTimestamp = null;
    let autoSyncSequence = 0;
    let autoSyncPendingRecord = null;
    let autoSyncSaveTimeout = null;
    let autoSyncStatusError = '';
    let immediateSettingsSaveInFlight = false;
    let immediateSettingsSaveQueued = false;

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function parseStorageObject(key) {
        try {
            const parsed = JSON.parse(getLegacyLocalStorageValue(key));
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    function getLegacyLocalStorageValue(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function applySettingsSubset(source, keys) {
        if (!source || typeof source !== 'object') return;
        for (const key of keys) {
            if (source[key] !== undefined) settings[key] = source[key];
        }
    }

    function buildSettingsSubset(keys) {
        const subset = {};
        for (const key of keys) subset[key] = settings[key];
        return subset;
    }

    function pruneInactiveSettings() {
        if (!settings || typeof settings !== 'object') return;
        for (const key of Object.keys(settings)) {
            if (!ACTIVE_SETTING_KEYS.includes(key)) delete settings[key];
        }
    }

    function buildFullSettingsSnapshot() {
        const snapshot = {};
        for (const key of ACTIVE_SETTING_KEYS) {
            if (settings[key] !== undefined) snapshot[key] = settings[key];
        }
        snapshot.colorSchemaVersion = COLOR_SCHEMA_VERSION;
        return snapshot;
    }

    function normalizeStoredSettings(source) {
        if (!isPlainObject(source)) return {};
        const normalized = {};
        for (const key of ACTIVE_SETTING_KEYS) {
            if (source[key] !== undefined) normalized[key] = source[key];
        }
        if (source.colorSchemaVersion !== undefined) normalized.colorSchemaVersion = source.colorSchemaVersion;
        return normalized;
    }

    function applyStoredSettingsSnapshot(source, { includeColorSchemaVersion = true } = {}) {
        const normalized = normalizeStoredSettings(source);
        if (!includeColorSchemaVersion) delete normalized.colorSchemaVersion;
        if (!Object.keys(normalized).length) return false;
        Object.assign(settings, normalized);
        normalizeToggleSettings();
        return true;
    }

    function buildSettingsSubsetFromSource(source, keys) {
        const subset = {};
        if (!isPlainObject(source)) return subset;
        for (const key of keys) {
            if (source[key] !== undefined) subset[key] = source[key];
        }
        return subset;
    }

    function getLegacyAutoSyncEnabledPreference() {
        const legacy = getLegacyLocalStorageValue(LEGACY_AUTO_SYNC_ENABLED_KEY);
        if (legacy === 'true') return true;
        if (legacy === 'false') return false;
        return true;
    }

    function cleanupLegacyAutoSyncPreference() {
        // localStorage is now read-only legacy input; do not write back to browser storage.
    }

    function buildAutoSyncRecord(source = {}) {
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

    function mergeIncomingAutoSyncRecord(source) {
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

    function queueImmediateSettingsSave() {
        if (typeof saveSettings !== 'function') {
            saveSettingsDebounced?.();
            return;
        }
        immediateSettingsSaveQueued = true;
        if (immediateSettingsSaveInFlight) return;

        const run = () => {
            if (!immediateSettingsSaveQueued) return;
            immediateSettingsSaveQueued = false;
            immediateSettingsSaveInFlight = true;
            saveSettings()
                .catch(err => {
                    console.warn('[Dialogue Colors] Immediate settings save failed; falling back to debounced save:', err);
                    saveSettingsDebounced?.();
                })
                .finally(() => {
                    immediateSettingsSaveInFlight = false;
                    if (immediateSettingsSaveQueued) run();
                });
        };
        run();
    }

    function persistModuleStore(record, { debounce = true, immediate = false } = {}) {
        const normalized = buildAutoSyncRecord(record || getAutoSyncRecord(true));
        extension_settings[MODULE_NAME] = normalized;
        if (immediate) queueImmediateSettingsSave();
        else if (debounce) saveSettingsDebounced?.();
        return normalized;
    }

    function getAutoSyncRecord(create = false) {
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

    function hasAutoSyncSettingsPayload(record) {
        return !!record && Object.keys(record.settings || {}).length > 0;
    }

    function areSettingsSubsetsEqual(left, right) {
        for (const key of GLOBAL_SETTINGS_V2_KEYS) {
            if (left?.[key] !== right?.[key]) return false;
        }
        return true;
    }

    function doAutoSyncMarkersMatch(left, right) {
        if (!left || !right) return false;
        return (left.timestamp || '') === (right.timestamp || '') && (left.sequence || 0) === (right.sequence || 0);
    }

    function getLatestKnownAutoSyncMarker() {
        return autoSyncPendingRecord || { timestamp: autoSyncLastTimestamp || '', sequence: autoSyncSequence || 0 };
    }

    function isIncomingAutoSyncRecordNewer(record) {
        const normalized = buildAutoSyncRecord(record);
        const known = getLatestKnownAutoSyncMarker();
        if (!normalized.timestamp && !normalized.sequence) return false;
        if (!known.timestamp && !known.sequence) return true;
        if (normalized.timestamp > (known.timestamp || '')) return true;
        if (normalized.timestamp === (known.timestamp || '') && normalized.sequence > (known.sequence || 0)) return true;
        return false;
    }

    function clearAutoSyncSaveTimeout() {
        if (autoSyncSaveTimeout) {
            clearTimeout(autoSyncSaveTimeout);
            autoSyncSaveTimeout = null;
        }
    }

    function setAutoSyncError(message = '') {
        autoSyncStatusError = message;
        updateAutoSyncUI();
    }

    function clearAutoSyncError() {
        if (!autoSyncStatusError) return;
        autoSyncStatusError = '';
        updateAutoSyncUI();
    }

    function clearAutoSyncPending({ timedOut = false } = {}) {
        clearAutoSyncSaveTimeout();
        autoSyncPendingRecord = null;
        if (timedOut) autoSyncStatusError = 'Save failed';
        updateAutoSyncUI();
    }

    function markAutoSyncPending(record) {
        autoSyncStatusError = '';
        autoSyncPendingRecord = {
            timestamp: record?.timestamp || '',
            sequence: record?.sequence || 0,
        };
        clearAutoSyncSaveTimeout();
        autoSyncSaveTimeout = setTimeout(() => {
            console.warn('[Dialogue Colors] Auto-sync settings save timed out before confirmation.');
            clearAutoSyncPending({ timedOut: true });
        }, AUTO_SYNC_SAVE_TIMEOUT_MS);
        updateAutoSyncUI();
    }

    function confirmAutoSyncRecord(record) {
        const normalized = mergeIncomingAutoSyncRecord(record);
        autoSyncLastTimestamp = normalized.timestamp || null;
        autoSyncSequence = Number.isFinite(normalized.sequence) ? normalized.sequence : 0;
        autoSyncEnabled = normalized.autoSyncEnabled;
        persistModuleStore(normalized, { debounce: false });
        autoSyncPendingRecord = null;
        autoSyncStatusError = '';
        clearAutoSyncSaveTimeout();
        updateAutoSyncUI();
        return normalized;
    }

    function syncAutoSyncPolling() {
        if (autoSyncEnabled) {
            startAutoSyncPolling();
        } else {
            stopAutoSyncPolling();
        }
    }

    function applyAutoSyncRecord(record, { force = false } = {}) {
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
        autoSyncEnabled = normalized.autoSyncEnabled;

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

    async function fetchAutoSyncRecordFromServer() {
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

    function saveGlobalSettingsSnapshot(options = {}) {
        const record = getAutoSyncRecord(true);
        record.globalSettings = buildFullSettingsSnapshot();
        record.settings = buildSettingsSubset(GLOBAL_SETTINGS_V2_KEYS);
        persistModuleStore(record, options);
    }

    const DYNAMIC_CONTROL_HELP_TEXT = Object.freeze({
        '.dc-color-dot': 'Click to open the color picker for this character.',
        '.dc-color-input': 'Pick a color directly. Double-click for harmony suggestions.',
        '.dc-keep': 'Pinned characters survive Clear and bulk delete tools.',
        '.dc-lock': 'Lock this character color so reset/regen tools do not change it.',
        '.dc-more': 'Show less common row tools like alias, group, style, and swap.',
        '.dc-swap': 'Choose two characters in sequence to swap their colors.',
        '.dc-style': 'Cycle style: none, bold, italic, then bold italic.',
        '.dc-alias': 'Add an alternate name that maps to this character.',
        '.dc-group': 'Assign this character to a group label.',
        '.dc-del': 'Delete this character from the list. Turn off Keep first if pinned.',
        '.dc-alias-remove': 'Remove this alias from the character.'
    });

    const COLOR_THEMES = {
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
    let cachedTheme = null;
    let cachedThemeBackground = null;
    let cachedIsDark = null;
    let injectDebouncedTimer = null;

    function hslToHex(h, s, l) {
        l = Math.max(0, Math.min(100, l));
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hexToHsl(hex) {
        if (!hex || typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [0, 0, 50];
        let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        }
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }

    function saveHistory() {
        colorHistory = colorHistory.slice(0, historyIndex + 1);
        colorHistory.push(JSON.stringify(characterColors));
        if (colorHistory.length > 20) colorHistory.shift();
        historyIndex = colorHistory.length - 1;
    }

    function undo() {
        if (historyIndex > 0) {
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            historyIndex--;
            characterColors = JSON.parse(colorHistory[historyIndex]);
            applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
            commit({ history: false });
        }
    }

    function redo() {
        if (historyIndex < colorHistory.length - 1) {
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            historyIndex++;
            characterColors = JSON.parse(colorHistory[historyIndex]);
            applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
            commit({ history: false });
        }
    }

    function createRestoreSnapshot() {
        const colorsSnapshot = JSON.stringify(characterColors);
        const expandedSnapshot = [...expandedCharacterRows];
        const swapSnapshot = swapMode;
        return function() {
            const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
            characterColors = JSON.parse(colorsSnapshot);
            expandedCharacterRows = new Set(expandedSnapshot);
            swapMode = swapSnapshot;
            applyLiveColorChangesFromSnapshot(snapshot, Object.keys(characterColors).filter(key => snapshot[key]), { saveImmediately: true });
            commit();
        };
    }

    function showUndoToast(message, restoreFn) {
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

    const toast = {
        info:    (...a) => !settings.disableToasts && toastr?.info?.(...a),
        success: (...a) => !settings.disableToasts && toastr?.success?.(...a),
        warning: (...a) => !settings.disableToasts && toastr?.warning?.(...a),
        error:   (...a) => toastr?.error?.(...a),
    };

    function getPresets() {
        const presets = getAutoSyncRecord(true).presets;
        return isPlainObject(presets) ? presets : {};
    }

    function persistPresets(presets) {
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

    function getInlinePaletteInputs() {
        const name = document.getElementById('dc-palette-name-input')?.value?.trim() || '';
        const notes = document.getElementById('dc-palette-notes-input')?.value || '';
        return { name, notes };
    }

    function isKeptCharacter(key) {
        return !!characterColors[key]?.keep;
    }

    function getKeptKeys(keys = Object.keys(characterColors)) {
        const list = Array.isArray(keys) ? keys : [keys];
        return list.filter(key => isKeptCharacter(key));
    }

    function buildKeepAwareRemovalMessage(actionLabel, removedCount, keptCount, itemLabel = 'character') {
        const removedText = `${actionLabel} ${removedCount} ${itemLabel}${removedCount !== 1 ? 's' : ''}`;
        if (!keptCount) return `${removedText}.`;
        return `${removedText}, kept ${keptCount} pinned character${keptCount !== 1 ? 's' : ''}.`;
    }

    function pruneExpandedCharacterRows() {
        expandedCharacterRows = new Set([...expandedCharacterRows].filter(key => characterColors[key]));
    }

    function removeCharacterKeys(keys, { actionLabel, itemLabel = 'character', emptyMessage, blockedMessage, onComplete } = {}) {
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
            if (swapMode === key) swapMode = null;
        });
        clearSpeakerRegexCache();
        pruneExpandedCharacterRows();
        commit();
        repaintDomAfterCharacterDataChange(0);
        if (typeof onComplete === 'function') onComplete({ removedKeys, keptKeys });
        showUndoToast(buildKeepAwareRemovalMessage(actionLabel || 'Removed', removedKeys.length, keptKeys.length, itemLabel), restore);
        return { removed: removedKeys.length, kept: keptKeys.length, skipped: keptKeys, removedKeys };
    }

    function collectDuplicateColorKeys() {
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

    function keepCharacterKeysOnly(keysToKeep) {
        const keepSet = new Set((Array.isArray(keysToKeep) ? keysToKeep : [keysToKeep]).map(key => String(key ?? '').trim().toLowerCase()).filter(Boolean));
        const nextColors = {};
        for (const [key, entry] of Object.entries(characterColors)) {
            if (keepSet.has(key)) nextColors[key] = entry;
            else {
                expandedCharacterRows.delete(key);
                if (swapMode === key) swapMode = null;
            }
        }
        characterColors = nextColors;
        pruneExpandedCharacterRows();
    }

    function shouldOverwritePalette() {
        return !!document.getElementById('dc-overwrite-existing')?.checked;
    }

    // Phase 5C: Handle custom palettes in getNextColor
    function getNextColor() {
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

    // Phase 3B: Optimized conflict check with pre-computed HSL and early-out
    function checkColorConflicts() {
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
    const COLOR_NAME_MAP = new Map([
        ['red', 0], ['rose', 340], ['pink', 340], ['magenta', 330],
        ['purple', 280], ['violet', 270], ['blue', 220], ['cyan', 180],
        ['teal', 170], ['green', 120], ['lime', 90], ['yellow', 50],
        ['gold', 45], ['orange', 30], ['brown', 25], ['grey', 0], ['gray', 0]
    ]);

    function suggestColorForName(name) {
        const n = name.toLowerCase();
        for (const [colorName, hue] of COLOR_NAME_MAP) {
            if (n.includes(colorName)) return hslToHex(hue, 70, 50);
        }
        return null;
    }

    function regenerateAllColors() {
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
    function autoResolveConflicts() {
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
        toast.success(`Fixed: ${fixedPairs.join('; ')}`);
    }

    function flipColorsForTheme() {
        const entries = Object.entries(characterColors);
        if (!entries.length) { toast.info('No characters to flip'); return; }
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        for (const [, char] of entries) {
            const [h, s, l] = hexToHsl(getEntryEffectiveColor(char));
            const newL = 100 - l;
            const clampedL = Math.max(25, Math.min(85, newL));
            setEntryFromEffectiveColor(char, hslToHex(h, s, clampedL));
        }
        applyLiveColorChangesFromSnapshot(snapshot, entries.map(([key]) => key));
        commit();
        toast.success('Colors flipped for theme switch');
    }

    // Phase 5A: Preset management with dropdown UI
    function saveColorPreset() {
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
            keep: !!v.keep
        }));
        if (!persistPresets(presets)) return;
        nameInput.value = '';
        refreshPresetDropdown();
        toast.success(`Preset "${name}" saved`);
    }

    function loadColorPreset() {
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
        toast.success(`Preset "${name}" loaded`);
    }

    function deleteColorPreset() {
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
        toast.success(`Preset "${name}" deleted`);
    }

    function refreshPresetDropdown() {
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
    const CUSTOM_PALETTE_KEY = 'dc_custom_palettes';
    const CUSTOM_PALETTE_META_KEY = 'dc_custom_palette_meta';
    const CUSTOM_PALETTE_SIZE = 8;

    function normalizeCustomPalettes(raw) {
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

    const PALETTE_STOPWORDS = new Set([
        'the', 'a', 'an', 'and', 'or', 'of', 'to', 'with', 'for', 'in', 'on', 'at', 'from', 'by',
        'style', 'theme', 'vibe', 'tones', 'tone', 'colors', 'color', 'palette', 'pal', 'like', 'as'
    ]);

    const PALETTE_KEYWORDS = {
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

    function getCustomPalettes() {
        return normalizeCustomPalettes(getAutoSyncRecord(true).customPalettes);
    }

    function getCustomPaletteMeta() {
        const meta = getAutoSyncRecord(true).customPaletteMeta;
        return isPlainObject(meta) ? meta : {};
    }

    function saveCustomPaletteMeta(meta) {
        const record = getAutoSyncRecord(true);
        record.customPaletteMeta = isPlainObject(meta) ? meta : {};
        persistModuleStore(record);
    }

    function saveCustomPalettes(customs) {
        const record = getAutoSyncRecord(true);
        record.customPalettes = normalizeCustomPalettes(customs);
        persistModuleStore(record);
    }

    function setCustomPaletteMetaEntry(name, entry) {
        const meta = getCustomPaletteMeta();
        meta[String(name)] = entry;
        saveCustomPaletteMeta(meta);
    }

    function deleteCustomPaletteMetaEntry(name) {
        const meta = getCustomPaletteMeta();
        delete meta[String(name)];
        saveCustomPaletteMeta(meta);
    }

    function tokenizePalettePrompt(name, notes) {
        const text = `${name || ''} ${notes || ''}`.toLowerCase();
        const tokens = text.match(/[a-z0-9]+/g) || [];
        return tokens.filter(t => t.length > 1 && !PALETTE_STOPWORDS.has(t));
    }

    function mergeRange(base, next) {
        if (!next) return base;
        if (!base) return [next[0], next[1]];
        const low = Math.max(base[0], next[0]);
        const high = Math.min(base[1], next[1]);
        if (low <= high) return [low, high];
        return [Math.min(base[0], next[0]), Math.max(base[1], next[1])];
    }

    function clampRange(range, min = 0, max = 100) {
        if (!range) return null;
        const lo = Math.max(min, Math.min(max, range[0]));
        const hi = Math.max(min, Math.min(max, range[1]));
        if (lo === hi) return [lo, hi];
        return lo < hi ? [lo, hi] : [hi, lo];
    }

    function applyProfileHint(profile, hint) {
        if (hint.hueSeeds?.length) profile.hueSeeds.push(...hint.hueSeeds);
        if (hint.sat) profile.satRange = clampRange(mergeRange(profile.satRange, hint.sat));
        if (hint.light) profile.lightRange = clampRange(mergeRange(profile.lightRange, hint.light));
        if (hint.contrast === 'high') profile.contrast = Math.max(profile.contrast, 2);
        if (hint.contrast === 'low') profile.contrast = Math.min(profile.contrast, 0);
        if (hint.monochrome) profile.monochrome = true;
    }

    function derivePaletteProfile(tokens) {
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

    function isColorTooClose(color, palette) {
        return palette.some(existing => colorDistance(existing, color));
    }

    function buildPaletteFromProfile(profile, count = CUSTOM_PALETTE_SIZE) {
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

    function sanitizeGeneratedPalette(colors, profile, count = CUSTOM_PALETTE_SIZE) {
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

    function generateHeuristicPalette(name, notes, count = CUSTOM_PALETTE_SIZE) {
        const tokens = tokenizePalettePrompt(name, notes);
        const profile = derivePaletteProfile(tokens);
        const base = buildPaletteFromProfile(profile, count);
        const palette = sanitizeGeneratedPalette(base, profile, count);
        return { palette, profile, tokens };
    }

    async function enhancePaletteWithLLM(name, notes, basePalette, profile, count = CUSTOM_PALETTE_SIZE) {
        if (typeof generateQuietPrompt !== 'function') return null;

        const promptNotes = notes?.trim() ? notes.trim() : 'None';
        const instruction = [
            'Generate a color palette as a JSON array of hex colors.',
            `Theme: "${name}".`,
            `Notes: "${promptNotes}".`,
            `Return exactly ${count} colors.`,
            'Each item must be a string like "#RRGGBB".',
            `Base palette (optional inspiration): ${JSON.stringify(basePalette)}.`,
            'Return ONLY the JSON array and nothing else.'
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

    async function callLLMWithProfile(instruction, options = {}) {
        const profileId = options.profileId ?? settings.llmConnectionProfile;
        const quietOptions = {
            skipWIAN: true,
            quietName: options.quietName || `DC_${Date.now()}`,
            quietToLoud: false,
            ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
        };

        if (!profileId) {
            return await generateQuietPrompt({
                quietPrompt: instruction,
                ...quietOptions,
            });
        }

        let CMRS = null;
        try {
            CMRS = getContext().ConnectionManagerRequestService;
        } catch { /* pre-1.15.0 */ }

        if (!CMRS) {
            return await generateQuietPrompt({
                quietPrompt: instruction,
                ...quietOptions,
            });
        }

        try {
            const messages = [{ role: 'user', content: instruction }];
            const response = await CMRS.sendRequest(
                profileId,
                messages,
                options.maxTokens || 2000,
                { extractData: true, includePreset: true, stream: false }
            );
            if (typeof response === 'string') return response;
            return response?.content || response?.toString() || '';
        } catch (e) {
            console.warn('[DC] CMRS request failed, falling back to main AI:', e);
            return await generateQuietPrompt({
                quietPrompt: instruction,
                ...quietOptions,
            });
        }
    }

    function buildThoughtSymbolColorPromptRule(thoughtSymbolList) {
        if (!thoughtSymbolList) return '';
        return `Color thoughts delimited by ${thoughtSymbolList} using active speaker color, delimiters included.`;
    }

    function resolveCharacterKeyByNameOrAlias(rawName) {
        const lookupName = String(rawName ?? '').trim().toLowerCase();
        if (!lookupName) return '';
        if (characterColors[lookupName]) return lookupName;
        for (const [key, entry] of Object.entries(characterColors)) {
            if (!entry) continue;
            if (String(entry.name ?? '').trim().toLowerCase() === lookupName) return key;
            if (normalizeAliases(entry.aliases).some(alias => alias.toLowerCase() === lookupName)) return key;
        }
        return '';
    }

    function formatColorBlockName(entry) {
        const name = String(entry?.name ?? '').trim();
        if (!name) return '';
        const nameKey = name.toLowerCase();
        const aliases = normalizeAliases(entry.aliases)
            .filter(alias => alias.toLowerCase() !== nameKey);
        return `${name}${aliases.map(alias => `(${alias})`).join('')}`;
    }

    function formatColorBlockPair(name, color) {
        const normalizedColor = normalizeHexColor(color, null);
        if (!normalizedColor) return '';
        const key = resolveCharacterKeyByNameOrAlias(name);
        const blockName = key ? formatColorBlockName(characterColors[key]) : String(name ?? '').trim();
        return blockName ? `${blockName}=${normalizedColor}` : '';
    }

    function buildCurrentColorsBlock() {
        const pairs = Object.values(characterColors)
            .map(entry => formatColorBlockPair(entry?.name, getEntryEffectiveColor(entry)))
            .filter(Boolean);
        return pairs.length ? `[COLORS:${pairs.join(',')}]` : '';
    }

    function buildColorMetadataPromptLines() {
        const currentBlock = buildCurrentColorsBlock();
        if (!currentBlock) {
            return ['End with [COLORS:Name=#RRGGBB] line. No code fences.'];
        }
        return [
            `Established: ${currentBlock}`,
            'End with [COLORS:...]. Match canonical names exactly; never separate aliases. No code fences.',
        ];
    }

    function buildLLMColorizeRules(extraRule = '') {
        const rules = [
            '- Wrap dialogue/thought spans (with delimiters) in <font color=#RRGGBB>...</font>.',
            '- Preserve text exactly; only add font tags and [COLORS:] metadata. No code fences.',
        ];
        if (extraRule) rules.push(extraRule);
        return rules;
    }

    function unwrapCodeFence(text) {
        const cleaned = String(text ?? '').trim();
        const match = cleaned.match(/^```(?:html|xml|markdown|md|text|txt)?\s*([\s\S]*?)\s*```$/i);
        return match ? match[1].trim() : cleaned;
    }

    function stripFontTags(text) {
        return String(text ?? '')
            .replace(/<font\b[^>]*>/gi, '')
            .replace(/<\/font>/gi, '');
    }

    function stripColorBlocks(text) {
        return String(text ?? '').replace(/\n?\[COLORS?:[^\]]*\]/gi, '');
    }

    function normalizeColorReplacementMap(replacements) {
        const normalized = {};
        if (!replacements || typeof replacements !== 'object') return normalized;
        for (const [oldColor, newColor] of Object.entries(replacements)) {
            const oldHex = normalizeHexColor(oldColor, null);
            const newHex = normalizeHexColor(newColor, null);
            if (!oldHex || !newHex || oldHex === newHex) continue;
            normalized[oldHex] = newHex;
        }
        return normalized;
    }

    function normalizeNameColorMap(nameToNewColor) {
        const normalized = {};
        if (!nameToNewColor || typeof nameToNewColor !== 'object') return normalized;
        for (const [name, color] of Object.entries(nameToNewColor)) {
            const nameKey = String(name ?? '').trim().toLowerCase();
            const nextColor = normalizeHexColor(color, null);
            if (nameKey && nextColor) normalized[nameKey] = nextColor;
        }
        return normalized;
    }

    function updateTextColorReferences(rawText, replacements) {
        const normalized = normalizeColorReplacementMap(replacements);
        if (!Object.keys(normalized).length) return { updatedText: rawText, changed: false };
        const fontTagRegex = /<font\b[^>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^>]*>/gi;
        const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
        let updated = String(rawText ?? '').replace(fontTagRegex, (match, oldHex) => {
            const replacement = normalized[normalizeHexColor(oldHex, null)];
            if (!replacement) return match;
            return match.replace(/(\bcolor\s*=\s*["']?)(#[0-9a-fA-F]{6})(["']?)/i, `$1${replacement}$3`);
        });
        updated = updated.replace(colorBlockRegex, (fullMatch, pairsStr) => {
            const newPairs = pairsStr.split(',').map(pair => {
                const eqIdx = pair.indexOf('=');
                if (eqIdx === -1) return pair;
                const namePart = pair.substring(0, eqIdx);
                const rawColor = pair.substring(eqIdx + 1).trim();
                const replacement = normalized[normalizeHexColor(rawColor, null)];
                return replacement ? `${namePart}=${replacement}` : pair;
            }).join(',');
            return fullMatch.replace(pairsStr, newPairs);
        });
        return { updatedText: updated, changed: updated !== String(rawText ?? '') };
    }

    function updateVisibleMessageColors(messageIndex, replacements) {
        const normalized = normalizeColorReplacementMap(replacements);
        if (!Object.keys(normalized).length) return false;
        const mesEl = document.querySelector(`.mes[mesid="${messageIndex}"]`) || document.querySelectorAll('.mes')[messageIndex];
        if (!mesEl) return false;
        let changed = false;
        mesEl.querySelectorAll('font[color]').forEach(fontEl => {
            const replacement = normalized[normalizeHexColor(fontEl.getAttribute('color'), null)];
            if (!replacement) return;
            fontEl.setAttribute('color', replacement);
            changed = true;
        });
        return changed;
    }

    function queueChatSave() {
        pendingLiveChatSave = true;
        if (liveChatSaveTimer) clearTimeout(liveChatSaveTimer);
        liveChatSaveTimer = setTimeout(() => {
            liveChatSaveTimer = null;
            if (!pendingLiveChatSave) return;
            pendingLiveChatSave = false;
            const ctx = getContext();
            if (typeof ctx?.saveChat === 'function') {
                ctx.saveChat().catch(err => console.error('[Dialogue Colors] Failed to save chat:', err));
            }
        }, LIVE_CHAT_SAVE_DELAY_MS);
    }

    function flushChatSave() {
        if (liveChatSaveTimer) {
            clearTimeout(liveChatSaveTimer);
            liveChatSaveTimer = null;
        }
        if (!pendingLiveChatSave) return;
        pendingLiveChatSave = false;
        const ctx = getContext();
        if (typeof ctx?.saveChat === 'function') {
            ctx.saveChat().catch(err => console.error('[Dialogue Colors] Failed to save chat:', err));
        }
    }

    function buildGlobalColorAssignmentLookup(chat) {
        const latestByColor = {};
        const namesByColor = {};
        for (const msg of chat || []) {
            const parsed = parseColorAssignmentsFromText(msg?.mes || '');
            for (const [color, name] of Object.entries(parsed.latestByColor)) {
                latestByColor[color] = name;
            }
            for (const [color, names] of Object.entries(parsed.namesByColor)) {
                if (!namesByColor[color]) namesByColor[color] = new Set();
                for (const name of names) namesByColor[color].add(name);
            }
        }
        return { latestByColor, namesByColor };
    }

    function buildMessageLiveReplacements(rawText, fallbackReplacements, nameToNewColor, globalAssignments) {
        const replacements = { ...fallbackReplacements };
        if (!Object.keys(nameToNewColor).length) return replacements;
        const localParsed = parseColorAssignmentsFromText(rawText);
        const fontColorsInMessage = collectFontColorsFromText(rawText);
        const candidateColors = new Set([...fontColorsInMessage, ...Object.keys(localParsed.latestByColor)]);
        for (const oldColor of candidateColors) {
            const oldHex = normalizeHexColor(oldColor, null);
            if (!oldHex) continue;
            let mappedName = '';
            const localNames = localParsed.namesByColor[oldHex];
            if (localNames) {
                if (localNames.size !== 1) { delete replacements[oldHex]; continue; }
                mappedName = localParsed.latestByColor[oldHex];
            } else {
                const globalNames = globalAssignments?.namesByColor?.[oldHex];
                if (!globalNames) continue;
                if (globalNames.size !== 1) { delete replacements[oldHex]; continue; }
                mappedName = globalAssignments.latestByColor[oldHex];
            }
            const newColor = nameToNewColor[mappedName];
            if (newColor && oldHex !== newColor) replacements[oldHex] = newColor;
            else delete replacements[oldHex];
        }
        return replacements;
    }

    function applyLiveColorReplacements(replacements, options = {}) {
        const fallbackReplacements = normalizeColorReplacementMap(replacements);
        const nameToNewColor = normalizeNameColorMap(options.nameToNewColor);
        if (!Object.keys(fallbackReplacements).length && !Object.keys(nameToNewColor).length) return 0;
        const ctx = getContext();
        const chat = ctx?.chat || [];
        const globalAssignments = Object.keys(nameToNewColor).length ? buildGlobalColorAssignmentLookup(chat) : null;
        let changedCount = 0;
        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || msg.is_user) continue;
            const messageReplacements = buildMessageLiveReplacements(msg.mes || '', fallbackReplacements, nameToNewColor, globalAssignments);
            if (!Object.keys(messageReplacements).length) continue;
            const result = updateTextColorReferences(msg.mes || '', messageReplacements);
            if (result.changed) {
                msg.mes = result.updatedText;
                changedCount++;
            }
            updateVisibleMessageColors(i, messageReplacements);
        }
        if (changedCount) {
            pendingLiveChatSave = true;
            if (options.saveImmediately) flushChatSave();
            else queueChatSave();
        }
        return changedCount;
    }

    function captureEffectiveColorSnapshot(keys = Object.keys(characterColors)) {
        const snapshot = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
            const entry = characterColors[key];
            if (!entry) continue;
            snapshot[key] = getEntryEffectiveColor(entry);
        }
        return snapshot;
    }

    function buildColorReplacementsFromSnapshot(snapshot, keys = Object.keys(snapshot || {})) {
        const replacements = {};
        const ambiguous = new Set();
        const targetKeys = new Set(Array.isArray(keys) ? keys : [keys]);
        const snapshotColors = {};
        for (const [key, color] of Object.entries(snapshot || {})) {
            const oldColor = normalizeHexColor(color, null);
            if (!oldColor) continue;
            if (!snapshotColors[oldColor]) snapshotColors[oldColor] = [];
            snapshotColors[oldColor].push(key);
        }
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
            const oldColor = normalizeHexColor(snapshot?.[key], null);
            const newColor = normalizeHexColor(getEntryEffectiveColor(characterColors[key]), null);
            if (!oldColor || !newColor || oldColor === newColor) continue;
            const sharedOldColorKeys = snapshotColors[oldColor] || [];
            if (sharedOldColorKeys.some(snapshotKey => {
                if (!targetKeys.has(snapshotKey)) return true;
                return normalizeHexColor(getEntryEffectiveColor(characterColors[snapshotKey]), null) !== newColor;
            })) {
                ambiguous.add(oldColor);
                continue;
            }
            if (replacements[oldColor] && replacements[oldColor] !== newColor) {
                ambiguous.add(oldColor);
                continue;
            }
            replacements[oldColor] = newColor;
        }
        for (const oldColor of ambiguous) delete replacements[oldColor];
        return replacements;
    }

    function buildNameToCurrentColorForKeys(keys = Object.keys(characterColors)) {
        const nameToNewColor = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
            const entry = characterColors[key];
            if (!entry) continue;
            const color = getEntryEffectiveColor(entry);
            nameToNewColor[entry.name] = color;
            for (const alias of entry.aliases || []) nameToNewColor[alias] = color;
        }
        if (settings.narratorColor) {
            nameToNewColor.Narrator = applyThemeReadabilityAndBrightness(settings.narratorColor);
        }
        return nameToNewColor;
    }

    function applyFastColorUiUpdates(keys = Object.keys(characterColors)) {
        const list = Array.isArray(keys) ? keys : [keys];
        const charList = document.getElementById('dc-char-list');
        for (const key of list) {
            const entry = characterColors[key];
            if (!entry) continue;
            const safeKey = CSS.escape(key);
            const row = charList?.querySelector(`.dc-char[data-key="${safeKey}"]`);
            if (!row) continue;
            const effectiveColor = getEntryEffectiveColor(entry);
            const pickerColor = getBaseColor(entry, effectiveColor);
            const dot = row.querySelector('.dc-color-dot');
            const name = row.querySelector('.dc-char-name');
            const colorInput = row.querySelector('.dc-color-input');
            const hexInput = row.querySelector('.dc-color-hex');
            if (dot) dot.style.background = effectiveColor;
            if (name) name.style.color = effectiveColor;
            if (colorInput && colorInput.value !== pickerColor) colorInput.value = pickerColor;
            if (hexInput && hexInput.value !== pickerColor) hexInput.value = pickerColor;
        }
        updateLegend();
    }

    function applyLiveColorChangesFromSnapshot(snapshot, keys = Object.keys(snapshot || {}), options = {}) {
        if (isDomEngine()) {
            if (options.saveImmediately) {
                decorateAllMessages();
                scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            } else {
                scheduleDomRefreshSeries();
            }
            scheduleCustomFontRefresh(options.saveImmediately ? 0 : 120);
            return 0;
        }
        if (!settings.autoRecolor && !options.force) return 0;
        const list = Array.isArray(keys) ? keys : [keys];
        const changedCount = applyLiveColorReplacements(buildColorReplacementsFromSnapshot(snapshot, list), {
            nameToNewColor: buildNameToCurrentColorForKeys(list),
            saveImmediately: options.saveImmediately,
        });
        scheduleCustomFontRefresh(options.saveImmediately ? 0 : 120);
        return changedCount;
    }

    function repaintDomAfterCharacterDataChange(delay = 0) {
        if (isDomEngine()) scheduleDomRefreshSeries(delay);
        scheduleCustomFontRefresh(delay);
    }

    function queueColorStateSave(options = {}) {
        pendingColorStateSaveData = true;
        pendingColorStateHistory = pendingColorStateHistory || options.history !== false;
        pendingColorStateUpdateList = pendingColorStateUpdateList || options.updateList !== false;
        pendingColorStateInjectPrompt = pendingColorStateInjectPrompt || options.injectPrompt !== false;
        if (colorStateSaveTimer) clearTimeout(colorStateSaveTimer);
        colorStateSaveTimer = setTimeout(() => flushColorStateSave(), COLOR_STATE_SAVE_DELAY_MS);
    }

    function flushColorStateSave() {
        if (colorStateSaveTimer) {
            clearTimeout(colorStateSaveTimer);
            colorStateSaveTimer = null;
        }
        if (!pendingColorStateSaveData && !pendingColorStateHistory && !pendingColorStateUpdateList && !pendingColorStateInjectPrompt) return;
        const shouldSaveHistory = pendingColorStateHistory;
        const shouldSaveData = pendingColorStateSaveData;
        const shouldUpdateList = pendingColorStateUpdateList;
        const shouldInjectPrompt = pendingColorStateInjectPrompt;
        pendingColorStateSaveData = false;
        pendingColorStateHistory = false;
        pendingColorStateUpdateList = false;
        pendingColorStateInjectPrompt = false;
        if (shouldSaveHistory) saveHistory();
        if (shouldSaveData) saveData();
        if (shouldInjectPrompt) injectPrompt();
        if (shouldUpdateList) updateCharList();
        updateLegend();
    }

    // Synchronous commit of a character/color mutation. Replaces the repeated
    // `commit();` quartet.
    // Pass `false` for any step to opt out (e.g. commit({ history: false })).
    function commit(options = {}) {
        if (options.history !== false) saveHistory();
        if (options.data !== false) saveData();
        if (options.inject !== false) injectPrompt();
        if (options.updateList !== false) updateCharList();
        if (options.legend !== false) updateLegend();
    }

    function normalizeColorizedTextForComparison(text) {
        return stripColorBlocks(stripFontTags(String(text ?? '').replace(/\r\n?/g, '\n'))).trim();
    }

    function detectLLMQuoteArtifacts(originalText, candidateText) {
        const issues = [];
        const original = String(originalText ?? '');
        const candidate = String(candidateText ?? '');
        if (!original.includes('\\"') && /\\"/.test(candidate)) issues.push('escaped quotes');

        const originalTrimmed = original.trim();
        const candidateTrimmed = candidate.trim();
        if (!/^"{2,}[\s\S]*"{2,}$/.test(originalTrimmed) && /^"{2,}[\s\S]*"{2,}$/.test(candidateTrimmed)) {
            issues.push('extra wrapper quotes');
        }

        return issues;
    }

    function extractUsedAssignmentsFromColorizedText(text, narratorColor = null) {
        const usedAssignments = [];
        const usedColors = new Set();
        const fontColorRegex = /<font\b[^>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?/gi;
        let match;
        while ((match = fontColorRegex.exec(text)) !== null) {
            const color = match[1].toLowerCase();
            if (usedColors.has(color)) continue;

            usedColors.add(color);
            for (const entry of Object.values(characterColors)) {
                if (getEntryEffectiveColor(entry).toLowerCase() === color) {
                    usedAssignments.push({ name: entry.name, color: getEntryEffectiveColor(entry) });
                    break;
                }
            }
            if (narratorColor && color === narratorColor.toLowerCase() && !usedAssignments.some(a => a.name === 'Narrator')) {
                usedAssignments.push({ name: 'Narrator', color: narratorColor });
            }
        }

        return usedAssignments;
    }

    function finalizeLLMColorizedText(rawText, responseText, narratorColor = null) {
        if (!responseText || typeof responseText !== 'string') return null;

        const cleaned = unwrapCodeFence(responseText);
        if (!cleaned || !/<font\b/i.test(cleaned)) return null;

        const originalBody = normalizeColorizedTextForComparison(rawText);
        const candidateBody = normalizeColorizedTextForComparison(cleaned);
        const quoteIssues = detectLLMQuoteArtifacts(originalBody, candidateBody);
        if (quoteIssues.length || candidateBody !== originalBody) {
            console.warn('[Dialogue Colors] Rejected LLM colorize output due to text drift:', {
                issues: quoteIssues,
                originalSample: originalBody.slice(0, 200),
                candidateSample: candidateBody.slice(0, 200),
            });
            return null;
        }

        const usedAssignments = extractUsedAssignmentsFromColorizedText(cleaned, narratorColor);
        let finalText = cleaned;
        if (usedAssignments.length && !/\[COLORS?:([^\]]*)\]/i.test(finalText)) {
            finalText += `\n[COLORS:${usedAssignments.map(({ name, color }) => formatColorBlockPair(name, color)).filter(Boolean).join(',')}]`;
        }

        return {
            updatedText: finalText,
            changed: finalText !== rawText,
            usedAssignments,
        };
    }

    async function colorizeMessageWithLLM(rawText, messageSpeakerName = '') {
        if (typeof generateQuietPrompt !== 'function') return null;

        // Build character-color list from known entries
        const charList = [];
        const trimmedSpeaker = String(messageSpeakerName ?? '').trim();
        let defaultSpeakerColor = null;
        for (const entry of Object.values(characterColors)) {
            const color = getEntryEffectiveColor(entry);
            charList.push(`${entry.name}=${color}`);
            if (entry.name.toLowerCase() === trimmedSpeaker.toLowerCase()) {
                defaultSpeakerColor = color;
            }
        }
        if (!charList.length) return null;

        if (!defaultSpeakerColor && trimmedSpeaker) {
            const ensured = ensureCharacterEntry(trimmedSpeaker);
            if (ensured?.entry) {
                defaultSpeakerColor = getEntryEffectiveColor(ensured.entry);
                charList.push(`${ensured.entry.name}=${defaultSpeakerColor}`);
            }
        }

        const thoughtSymbols = getThoughtDelimiterSymbols();
        const thoughtSymbolList = thoughtSymbols.map(formatPromptLiteralSymbol).join(', ');
        const narratorColor = settings.narratorColor ? applyThemeReadabilityAndBrightness(settings.narratorColor) : null;

        const lines = [
            'Add <font color=#RRGGBB> tags to dialogue in this roleplay message based on who is speaking.',
        ];
        lines.push(...buildColorMetadataPromptLines());
        if (thoughtSymbolList) lines.push(buildThoughtSymbolColorPromptRule(thoughtSymbolList));
        if (narratorColor) lines.push(`Narrator=${narratorColor} for narration text.`);
        if (trimmedSpeaker && defaultSpeakerColor) lines.push(`Default speaker (message author): ${trimmedSpeaker}=${defaultSpeakerColor}`);
        lines.push('');
        lines.push(...buildLLMColorizeRules('- Return the modified text only, no commentary'));
        lines.push('');
        lines.push(rawText);

        const instruction = lines.join('\n');

        let response = '';
        try {
            response = await callLLMWithProfile(instruction, {
                quietName: `DialogueColorize_${Date.now()}`,
            });
        } catch (e) {
            console.warn('[Dialogue Colors] LLM colorize failed:', e);
            return null;
        }

        return finalizeLLMColorizedText(rawText, response, narratorColor);
    }

    async function colorizeMultipleMessagesWithLLM(messageBatch) {
        // messageBatch = [{ rawText, speakerName, msgIndex }, ...]
        if (!messageBatch.length || typeof generateQuietPrompt !== 'function') return [];

        // Build character-color list
        const charList = [];
        for (const entry of Object.values(characterColors)) {
            const color = getEntryEffectiveColor(entry);
            charList.push(`${entry.name}=${color}`);
        }
        if (!charList.length) return [];

        const thoughtSymbols = getThoughtDelimiterSymbols();
        const thoughtSymbolList = thoughtSymbols.map(formatPromptLiteralSymbol).join(', ');
        const narratorColor = settings.narratorColor ?
            applyThemeReadabilityAndBrightness(settings.narratorColor) : null;

        // Build instruction
        const lines = [
            'Add <font color=#RRGGBB> tags to dialogue in these roleplay messages.',
        ];
        lines.push(...buildColorMetadataPromptLines());
        if (thoughtSymbolList) lines.push(buildThoughtSymbolColorPromptRule(thoughtSymbolList));
        if (narratorColor) lines.push(`Narrator=${narratorColor} for narration text.`);
        lines.push('');
        lines.push(...buildLLMColorizeRules('- Return all messages in order with [MSG:N] markers preserved'));
        lines.push('');

        // Add all messages with markers
        messageBatch.forEach(({ rawText }, idx) => {
            lines.push(`[MSG:${idx}]`);
            lines.push(rawText);
            lines.push('');
        });

        const instruction = lines.join('\n');

        let response = '';
        try {
            response = await callLLMWithProfile(instruction, {
                quietName: `DialogueColorize_Batch_${Date.now()}`,
            });
        } catch (e) {
            console.warn('[Dialogue Colors] Batch LLM colorize failed:', e);
            return [];
        }

        if (!response || typeof response !== 'string') return [];

        // Parse response - split by [MSG:N] markers
        const results = [];
        const msgBlocks = response.split(/\[MSG:(\d+)\]/);

        for (let i = 1; i < msgBlocks.length; i += 2) {
            const msgIdx = parseInt(msgBlocks[i], 10);
            const colorizedText = msgBlocks[i + 1]?.trim();

            if (isNaN(msgIdx) || msgIdx >= messageBatch.length) continue;
            const finalized = finalizeLLMColorizedText(messageBatch[msgIdx].rawText, colorizedText, narratorColor);
            if (!finalized || !finalized.changed) continue;

            results.push({
                msgIndex: messageBatch[msgIdx].msgIndex,
                updatedText: finalized.updatedText,
                changed: finalized.changed,
            });
        }

        return results;
    }

    async function generateCustomPaletteFromWords(inputName = '', inputNotes = '') {
        const inlineInputs = getInlinePaletteInputs();
        const name = String(inputName || inlineInputs.name || '').trim();
        if (!name) {
            toast.warning('Enter a palette name first');
            return;
        }
        const notes = String(inputNotes || inlineInputs.notes || '');
        const customs = getCustomPalettes();
        if (customs[name] && !shouldOverwritePalette()) {
            toast.warning(`Custom palette "${name}" exists. Enable "Overwrite existing" to replace it.`);
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
        toast.success(`Custom palette "${name}" saved (${label})`);
    }

    function saveCustomPalette() {
        const { name } = getInlinePaletteInputs();
        if (!name) {
            toast.warning('Enter a palette name first');
            return;
        }
        const colors = [...new Set(Object.values(characterColors).map(c => normalizeHexColor(getEntryEffectiveColor(c), null)).filter(Boolean))];
        if (!colors.length) { toast.warning('No characters to save palette from'); return; }
        const customs = getCustomPalettes();
        if (customs[name] && !shouldOverwritePalette()) {
            toast.warning(`Custom palette "${name}" exists. Enable "Overwrite existing" to replace it.`);
            return;
        }
        customs[name] = colors;
        saveCustomPalettes(customs);
        setCustomPaletteMetaEntry(name, { source: 'heuristic', notes: '', createdAt: Date.now() });
        refreshPaletteDropdown();
        toast.success(`Custom palette "${name}" saved`);
    }

    function deleteCustomPalette() {
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
        toast.success(`Custom palette "${paletteName}" deleted`);
    }

    function refreshPaletteDropdown() {
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
    function getHarmonySuggestions(hex) {
        const [h, s, l] = hexToHsl(hex);
        return [
            { label: 'Complementary', color: hslToHex((h + 180) % 360, s, l) },
            { label: 'Triadic 1', color: hslToHex((h + 120) % 360, s, l) },
            { label: 'Triadic 2', color: hslToHex((h + 240) % 360, s, l) },
            { label: 'Analogous +', color: hslToHex((h + 30) % 360, s, l) },
            { label: 'Analogous -', color: hslToHex((h + 330) % 360, s, l) }
        ];
    }

    function showHarmonyPopup(key, anchorEl) {
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

    // Phase 6B: Group sorting support
    function getSortedEntries() {
        const entries = Object.entries(characterColors).filter(([, v]) => !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase()));
        entries.sort((a, b) => {
            if (!!b[1].keep !== !!a[1].keep) return Number(b[1].keep) - Number(a[1].keep);
            if (settings.sortMode === 'count') return (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0) || a[1].name.localeCompare(b[1].name);
            if (settings.sortMode === 'group') return (a[1].group || '').localeCompare(b[1].group || '') || a[1].name.localeCompare(b[1].name);
            return a[1].name.localeCompare(b[1].name);
        });
        return entries;
    }

    function getBadge(count) {
        if (count >= 100) return '💎';
        if (count >= 50) return '⭐';
        return '';
    }

    function detectTheme() {
        const background = getComputedStyle(document.body).backgroundColor || '';
        if (cachedTheme && cachedThemeBackground === background) return cachedTheme;
        const m = background.match(/\d+/g);
        cachedTheme = m && m.length >= 3 && (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000 < 128 ? 'dark' : 'light';
        cachedThemeBackground = background;
        return cachedTheme;
    }
    function invalidateThemeCache() { cachedTheme = null; cachedThemeBackground = null; cachedIsDark = null; }

    function getThemeLightnessBounds() {
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        return mode === 'dark'
            ? { mode, minLightness: 45, maxLightness: 92 }
            : { mode, minLightness: 12, maxLightness: 65 };
    }

    function getBrightnessOffset() {
        const brightness = Number(settings.brightness);
        return Number.isFinite(brightness) ? Math.max(-100, Math.min(100, brightness)) : 0;
    }

    function applyThemeReadabilityAndBrightness(hexColor) {
        const normalized = normalizeHexColor(hexColor);
        const [h, s, l] = hexToHsl(normalized);
        const offset = getBrightnessOffset();
        const { minLightness, maxLightness } = getThemeLightnessBounds();
        const adjustedL = Math.max(minLightness, Math.min(maxLightness, l + offset));
        return hslToHex(h, s, adjustedL);
    }

    function deriveBaseColorFromEffectiveColor(hexColor) {
        const normalized = normalizeHexColor(hexColor);
        const [h, s, l] = hexToHsl(normalized);
        const offset = getBrightnessOffset();
        const baseL = Math.max(0, Math.min(100, l - offset));
        return hslToHex(h, s, baseL);
    }

    function getBaseColor(entry, fallback = '#888888') {
        const colorFallback = normalizeHexColor(entry?.color, fallback);
        return normalizeHexColor(entry?.baseColor, colorFallback);
    }

    function getEntryEffectiveColor(entry) {
        return normalizeHexColor(entry?.color, applyThemeReadabilityAndBrightness(getBaseColor(entry)));
    }

    function setEntryFromBaseColor(entry, baseColor) {
        if (!entry) return '#888888';
        entry.baseColor = normalizeHexColor(baseColor, getBaseColor(entry));
        entry.color = applyThemeReadabilityAndBrightness(getBaseColor(entry));
        return entry.color;
    }

    function setEntryFromEffectiveColor(entry, effectiveColor) {
        if (!entry) return '#888888';
        const normalizedEffective = normalizeHexColor(effectiveColor, getEntryEffectiveColor(entry));
        entry.baseColor = deriveBaseColorFromEffectiveColor(normalizedEffective);
        entry.color = normalizedEffective;
        return entry.color;
    }

    function syncAllEffectiveColors() {
        for (const entry of Object.values(characterColors)) {
            if (!entry) continue;
            if (entry.locked) continue;
            const baseColor = getBaseColor(entry);
            if (baseColor) {
                setEntryFromBaseColor(entry, baseColor);
            }
        }
    }

    function collectAssignedColors(excludeKeys = []) {
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

    function isAssignedColorConflict(candidateColor, reservedColors = []) {
        const normalizedCandidate = normalizeHexColor(candidateColor, null);
        if (!normalizedCandidate) return true;
        return reservedColors.some(existing => existing === normalizedCandidate || colorDistance(existing, normalizedCandidate));
    }

    function resolveUniqueAssignedColor(preferredColor, excludeKeys = []) {
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

    function buildCharacterEntry(name, options = {}) {
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

        return {
            key,
            remapped,
            entry: {
                color: assignedColor,
                baseColor,
                name: trimmedName,
                locked: !!options.locked,
                keep: !!options.keep,
                aliases: normalizeAliases(options.aliases),
                style: VALID_STYLES.has(options.style) ? options.style : '',
                dialogueCount: Number.isFinite(options.dialogueCount) && options.dialogueCount > 0 ? Math.floor(options.dialogueCount) : 0,
                group: String(options.group ?? '').trim(),
                font: normalizeGoogleFontName(options.font)
            }
        };
    }

    // Phase 2B: Prefer characterId over avatar, use ?? for 0-safety
    function getCharKey() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            return char?.characterId ?? char?.avatar ?? ctx?.characterId ?? null;
        } catch { return null; }
    }

    // Phase 2B: Legacy key for migration (old behavior: avatar || characterId)
    function getLegacyCharKey() {
        try {
            const ctx = getContext();
            return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null;
        } catch { return null; }
    }

    function getStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getCharKey() || 'default'}`; }
    function getLegacyStorageKey() { return settings.shareColorsGlobally ? 'dc_global' : `dc_char_${getLegacyCharKey() || 'default'}`; }

    function getStorageLabelForKey(key) {
        return key === 'dc_global' ? 'Global shared colors' : String(key || '').replace(/^dc_char_/, '');
    }

    function normalizeColorDataEntry(source) {
        if (!isPlainObject(source)) return null;
        const colors = normalizeCharacterColors(source.colors || {});
        const storedSettings = normalizeStoredSettings(source.settings);
        return {
            colors,
            settings: storedSettings,
            updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
        };
    }

    function getUserColorDataStore() {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.colorData)) record.colorData = {};
        return record.colorData;
    }

    function getStoredColorData(key) {
        return normalizeColorDataEntry(getUserColorDataStore()[key]);
    }

    function setStoredColorData(key, colors, storedSettings = settings, options = {}) {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.colorData)) record.colorData = {};
        record.colorData[key] = {
            colors: normalizeCharacterColors(colors || {}),
            settings: normalizeStoredSettings(storedSettings),
            updatedAt: new Date().toISOString(),
        };
        persistModuleStore(record, options);
    }

    function removeStoredColorData(key) {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.colorData) || !Object.prototype.hasOwnProperty.call(record.colorData, key)) return false;
        delete record.colorData[key];
        persistModuleStore(record);
        return true;
    }

    function getUiState() {
        const record = getAutoSyncRecord(true);
        if (!isPlainObject(record.ui)) record.ui = {};
        return record.ui;
    }

    function getLegendPosition() {
        const position = getUiState().legendPosition;
        return isPlainObject(position) ? position : {};
    }

    function saveLegendPosition(position) {
        const record = getAutoSyncRecord(true);
        const nextPosition = isPlainObject(position) ? position : {};
        record.ui = { ...(isPlainObject(record.ui) ? record.ui : {}), legendPosition: nextPosition };
        persistModuleStore(record);
    }

    function migrateLegacyLocalStorageIfNeeded() {
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

    // Extract dominant color from avatar image
    async function extractAvatarColor(imgSrc) {
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

    // Phase 4A: Theme-aware PNG export
    function exportLegendPng() {
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
            ctx.fillStyle = safeColor;
            ctx.fill();
            ctx.fillStyle = safeColor;
            ctx.font = '14px sans-serif';
            ctx.fillText(v.name, padding + dotSize + 8, y + 5);
        });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `dialogue-colors-legend-${Date.now()}.png`;
        a.click();
        toast.success('Legend exported');
    }

    // Right-click and long-press context menu for messages
    function setupContextMenu() {
        if (runtimeState.contextMenuSetup) return;
        runtimeState.contextMenuSetup = true;
        let longPressTimer = null;
        let longPressTarget = null;

        const showMenu = (e, fontTag, qElement = null) => {
            e.preventDefault();
            const existingMenu = document.getElementById('dc-context-menu');
            if (existingMenu) existingMenu.remove();
            const isDomSegment = isDomEngine() && !fontTag && !!qElement;
            const isBareQuote = !isDomSegment && !fontTag && !!qElement;
            const targetEl = (isDomSegment || isBareQuote) ? qElement : fontTag;
            const domSpeakerKey = isDomSegment ? targetEl.getAttribute('data-dc-speaker') : '';
            const domSpeakerColor = domSpeakerKey && characterColors[domSpeakerKey] ? getEntryEffectiveColor(characterColors[domSpeakerKey]) : null;
            const quoteFallbackColor = normalizeHexColor(power_user.quote_text_color, '#888888');
            const color = isDomSegment
                ? normalizeHexColor(domSpeakerColor, quoteFallbackColor)
                : isBareQuote ? quoteFallbackColor : normalizeHexColor(fontTag.getAttribute('color'));
            const text = targetEl.textContent.substring(0, 30) + (targetEl.textContent.length > 30 ? '...' : '');

            // Build character list for datalist
            const charList = getSortedEntries()
                .map(([k, v]) => ({ key: k, name: v.name }));
            const datalistOptions = charList.map(c => `<option value="${escapeAttr(c.name)}">`).join('');

            const menu = document.createElement('div');
            menu.id = 'dc-context-menu';
            const x = e.clientX ?? e.touches?.[0]?.clientX ?? 100;
            const y = e.clientY ?? e.touches?.[0]?.clientY ?? 100;
            menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
            menu.innerHTML = `
                <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;">${isDomSegment ? '<em style="font-size:0.9em;">(DOM override)</em><br>' : isBareQuote ? '<em style="font-size:0.9em;">(uncolored quote)</em><br>' : ''}"${escapeHtml(text)}"</div>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <span style="width:12px;height:12px;border-radius:50%;background:${color};"></span>
                    <input type="color" id="dc-ctx-color" value="${color}" style="width:24px;height:20px;border:none;">
                    <input type="text" id="dc-ctx-name" list="dc-ctx-chars" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
                    <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
                </div>
                <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign to Character</button>
                <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
            `;
            document.body.appendChild(menu);
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.right > window.innerWidth) menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
            if (menuRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
            menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();

            const nameInput = menu.querySelector('#dc-ctx-name');
            const colorInput = menu.querySelector('#dc-ctx-color');
            if (isDomSegment && domSpeakerKey && characterColors[domSpeakerKey]) {
                nameInput.value = characterColors[domSpeakerKey].name;
            }

            nameInput.addEventListener('input', () => {
                const name = nameInput.value.trim();
                const key = name.toLowerCase();
                if (characterColors[key]) {
                    const existingColor = getEntryEffectiveColor(characterColors[key]);
                    colorInput.value = existingColor;
                }
            });

            menu.querySelector('#dc-ctx-assign').onclick = async () => {
                const nameInput = menu.querySelector('#dc-ctx-name');
                const colorInput = menu.querySelector('#dc-ctx-color');
                const name = nameInput.value.trim();
                const pickerColor = normalizeHexColor(colorInput.value, color);
                if (name) {
                    const key = name.toLowerCase();
                    let finalColor = pickerColor;
                    let textUpdated = false;
                    let existingColorChanged = false;
                    const existingSnapshot = characterColors[key]
                        ? captureEffectiveColorSnapshot(Object.keys(characterColors))
                        : null;
                    const originalFontColor = fontTag
                        ? normalizeHexColor(fontTag.getAttribute('color'), null)
                        : null;

                    if (characterColors[key]) {
                        const existingColor = getEntryEffectiveColor(characterColors[key]);
                        if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                            setEntryFromEffectiveColor(characterColors[key], pickerColor);
                            existingColorChanged = true;
                        }
                        finalColor = getEntryEffectiveColor(characterColors[key]);
                    } else {
                        const built = buildCharacterEntry(name, {
                            color: pickerColor,
                            colorMode: 'effective',
                            locked: false,
                            dialogueCount: 1
                        });
                        if (!built.entry) return;
                        characterColors[key] = built.entry;
                    }

                    if (existingColorChanged) {
                        applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
                    }

                    if (isDomSegment) {
                        const mesIndex = getMessageIndexFromElement(targetEl);
                        const ctx = getContext();
                        const msg = ctx?.chat?.[mesIndex];
                        const segmentIndex = resolveDomSegmentIndexForElement(targetEl, mesIndex, msg);
                        if (!msg || !Number.isFinite(segmentIndex)) {
                            toast.error('Could not map this dialogue segment.');
                            menu.remove();
                            return;
                        }
                        if (!setMessageQuoteOverride(mesIndex, msg, segmentIndex, name, { source: 'manual' })) {
                            toast.error('Could not save quote override.');
                            menu.remove();
                            return;
                        }
                        clearMessageDomRepairTimer(mesIndex);
                        cancelMessageDomFollowupRepairs(mesIndex);
                        markMessageAttributionVerified(mesIndex, msg);
                        clearStreamingAttributionOverrides(mesIndex);
                        // Override-only change: the visible DOM is already rendered by
                        // SillyTavern, so decorate in place without an innerHTML fallback
                        // write (which would trigger an observer re-decoration cascade).
                        const repainted = await decorateMessageDomFromCurrentRender(mesIndex, msg, { queueVerification: false, renderFallback: false });
                        scheduleMessageDomFollowupRepair(mesIndex, repainted);
                    } else if (isBareQuote) {
                        textUpdated = wrapQElementWithFontTag(qElement, finalColor);
                    } else {
                        fontTag.setAttribute('color', finalColor);
                        textUpdated = updateMessageTextForFontTag(fontTag, originalFontColor, finalColor);
                    }

                    commit();

                    if (isDomSegment) {
                        updateLegend();
                    } else if (textUpdated) {
                        queueChatSave();
                        flushChatSave();
                    }

                    toast.success(`Assigned to ${name}`);
                }
                menu.remove();
            };
            const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
            setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
        };

        const showSelectionMenu = (e, selection, range, selectedText, mesEl) => {
            e.preventDefault();
            const existingMenu = document.getElementById('dc-context-menu');
            if (existingMenu) existingMenu.remove();

            const msgIndex = getMessageIndexFromElement(mesEl);
            if (msgIndex === -1) return;

            const ctx = getContext();
            const chat = ctx?.chat || [];
            const msg = chat[msgIndex];
            if (!msg || msg.is_user) return;

            const charList = getSortedEntries()
                .map(([k, v]) => ({ key: k, name: v.name }));
            const datalistOptions = charList.map(c => `<option value="${escapeAttr(c.name)}">`).join('');

            const preview = selectedText.substring(0, 30) + (selectedText.length > 30 ? '...' : '');

            const menu = document.createElement('div');
            menu.id = 'dc-context-menu';
            const x = e.clientX ?? e.touches?.[0]?.clientX ?? 100;
            const y = e.clientY ?? e.touches?.[0]?.clientY ?? 100;
            menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;z-index:10001;min-width:180px;color:var(--SmartThemeTextColor);box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
            menu.innerHTML = `
                <div style="font-size:0.8em;opacity:0.7;margin-bottom:6px;"><em style="font-size:0.9em;">(selected text)</em><br>"${escapeHtml(preview)}"</div>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <span id="dc-ctx-color-dot" style="width:12px;height:12px;border-radius:50%;background:#888888;"></span>
                    <input type="color" id="dc-ctx-color" value="#888888" style="width:24px;height:20px;border:none;">
                    <input type="text" id="dc-ctx-name" list="dc-ctx-chars" placeholder="Character name (type to search)" class="text_pole" style="flex:1;padding:3px;font-size:0.85em;" autocomplete="off">
                    <datalist id="dc-ctx-chars">${datalistOptions}</datalist>
                </div>
                <button id="dc-ctx-assign" class="menu_button" style="width:100%;margin-bottom:4px;">Assign to Character</button>
                <button id="dc-ctx-close" class="menu_button" style="width:100%;">Cancel</button>
            `;
            document.body.appendChild(menu);
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.right > window.innerWidth) menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
            if (menuRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - menuRect.height - 8) + 'px';
            menu.querySelector('#dc-ctx-close').onclick = () => menu.remove();

            const nameInput = menu.querySelector('#dc-ctx-name');
            const colorInput = menu.querySelector('#dc-ctx-color');
            const colorDot = menu.querySelector('#dc-ctx-color-dot');

            colorInput.addEventListener('input', () => { colorDot.style.background = colorInput.value; });

            nameInput.addEventListener('input', () => {
                const name = nameInput.value.trim();
                const key = name.toLowerCase();
                if (characterColors[key]) {
                    const existingColor = getEntryEffectiveColor(characterColors[key]);
                    colorInput.value = existingColor;
                    colorDot.style.background = existingColor;
                }
            });

            menu.querySelector('#dc-ctx-assign').onclick = () => {
                const name = nameInput.value.trim();
                const pickerColor = normalizeHexColor(colorInput.value, '#888888');
                if (!name) { menu.remove(); return; }

                const key = name.toLowerCase();
                let finalColor = pickerColor;

                const existingSnapshot = characterColors[key]
                    ? captureEffectiveColorSnapshot(Object.keys(characterColors))
                    : null;

                let existingColorChanged = false;
                if (characterColors[key]) {
                    const existingColor = getEntryEffectiveColor(characterColors[key]);
                    if (normalizeHexColor(pickerColor) !== normalizeHexColor(existingColor)) {
                        setEntryFromEffectiveColor(characterColors[key], pickerColor);
                        existingColorChanged = true;
                    }
                    finalColor = getEntryEffectiveColor(characterColors[key]);
                } else {
                    const built = buildCharacterEntry(name, {
                        color: pickerColor,
                        colorMode: 'effective',
                        locked: false,
                        dialogueCount: 1
                    });
                    if (!built.entry) { menu.remove(); return; }
                    characterColors[key] = built.entry;
                }

                if (existingColorChanged) {
                    applyLiveColorChangesFromSnapshot(existingSnapshot, [key], { saveImmediately: true });
                }

                // Capture rendered offsets BEFORE mutating the DOM with surroundContents.
                const mesTextEl = mesEl.querySelector('.mes_text');
                const renderedCharOffset = getRenderedCharOffset(mesTextEl, range);
                const renderedLen = mesTextEl ? mesTextEl.textContent.length : 0;

                try {
                    const fontNode = document.createElement('font');
                    fontNode.setAttribute('color', finalColor);
                    range.surroundContents(fontNode);
                } catch (wrapErr) {
                    const fontNode = document.createElement('font');
                    fontNode.setAttribute('color', finalColor);
                    try {
                        const fragment = range.extractContents();
                        fontNode.appendChild(fragment);
                        range.insertNode(fontNode);
                    } catch (fallbackErr) {
                        toast.error('Could not wrap selection');
                        menu.remove();
                        return;
                    }
                }

                selection.removeAllRanges();

                const textUpdated = replaceMessageSelectionWithFontTag(msg, selectedText, finalColor, renderedCharOffset, renderedLen);
                if (textUpdated) {
                    queueChatSave();
                    flushChatSave();
                }

                commit();
                toast.success(`Assigned to ${name}`);
                menu.remove();
            };

            const closeMenu = e2 => { if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu); } };
            setTimeout(() => { document.addEventListener('click', closeMenu); document.addEventListener('touchstart', closeMenu); }, 10);
        };

        document.addEventListener('contextmenu', e => {
            if (!settings.enableRightClick) return;
            const mesText = e.target.closest('.mes_text');
            if (!mesText) return;
            if (isDomEngine()) {
                const segmentEl = e.target.closest('[data-dc-seg], q, em');
                if (segmentEl && mesText.contains(segmentEl) && !segmentEl.closest('font[color]')) {
                    showMenu(e, null, segmentEl);
                }
                return;
            }
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && mesText.contains(sel.anchorNode)) {
                const range = sel.getRangeAt(0);
                const selectedText = sel.toString().trim();
                if (selectedText && mesText.closest('.mes')) {
                    showSelectionMenu(e, sel, range, selectedText, mesText.closest('.mes'));
                    return;
                }
            }
            const fontTag = e.target.closest('font[color]');
            if (fontTag) { showMenu(e, fontTag, null); return; }
            const qEl = e.target.closest('q');
            if (qEl && !qEl.closest('font[color]')) { showMenu(e, null, qEl); return; }
        });

        document.addEventListener('touchstart', e => {
            if (!settings.enableRightClick) return;
            const mesText = e.target.closest('.mes_text');
            if (!mesText) return;
            if (isDomEngine()) {
                const segmentEl = e.target.closest('[data-dc-seg], q, em');
                if (segmentEl && mesText.contains(segmentEl) && !segmentEl.closest('font[color]')) {
                    longPressTarget = segmentEl;
                    longPressTimer = setTimeout(() => showMenu(e, null, segmentEl), 500);
                }
                return;
            }
            const fontTag = e.target.closest('font[color]');
            if (fontTag) {
                longPressTarget = fontTag;
                longPressTimer = setTimeout(() => showMenu(e, fontTag, null), 500);
                return;
            }
            const qEl = e.target.closest('q');
            if (qEl && !qEl.closest('font[color]')) {
                longPressTarget = qEl;
                longPressTimer = setTimeout(() => showMenu(e, null, qEl), 500);
            }
        }, { passive: true });

        document.addEventListener('touchend', () => { clearTimeout(longPressTimer); longPressTimer = null; });
        document.addEventListener('touchmove', () => { clearTimeout(longPressTimer); longPressTimer = null; });
    }

    /**
     * Computes the character offset of a range's start boundary within rootEl's
     * rendered textContent. Must be called BEFORE any DOM mutation of the range.
     */
    function getRenderedCharOffset(rootEl, range) {
        if (!rootEl || !range) return 0;
        let charOffset = 0;
        const tw = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
        let textNode;
        while ((textNode = tw.nextNode()) !== null) {
            if (textNode === range.startContainer) {
                return charOffset + range.startOffset;
            }
            charOffset += textNode.textContent.length;
        }
        return charOffset;
    }

    /**
     * Replaces a text selection in msg.mes with a <font color> tag.
     *
     * The rendered text differs from msg.mes (markdown syntax chars are consumed),
     * so we cannot reliably use a first-match replace. Instead we map the rendered
     * selection offset proportionally onto msg.mes, then choose the occurrence of
     * selectedText closest to that approximate source offset.
     *
     * renderedCharOffset / renderedLen must be captured BEFORE the DOM is mutated.
     * Returns true when msg.mes was modified.
     */
    function replaceMessageSelectionWithFontTag(msg, selectedText, hexColor, renderedCharOffset, renderedLen) {
        if (!selectedText || !msg?.mes) return false;

        const rawLen = msg.mes.length;
        const approxRawOffset = renderedLen > 0 ? Math.floor((renderedCharOffset / renderedLen) * rawLen) : 0;

        // Collect all occurrences of selectedText in msg.mes.
        const occurrences = [];
        let searchStart = 0;
        while (true) {
            const idx = msg.mes.indexOf(selectedText, searchStart);
            if (idx === -1) break;
            occurrences.push(idx);
            searchStart = idx + 1;
        }
        if (!occurrences.length) return false;

        // Pick the occurrence whose start is closest to approxRawOffset.
        const bestIdx = occurrences.reduce((best, idx) =>
            Math.abs(idx - approxRawOffset) < Math.abs(best - approxRawOffset) ? idx : best,
        occurrences[0]);

        msg.mes = `${msg.mes.slice(0, bestIdx)}<font color="${hexColor}">${selectedText}</font>${msg.mes.slice(bestIdx + selectedText.length)}`;
        return true;
    }

    function wrapQElementWithFontTag(qElement, color) {
        const msgIndex = getMessageIndexFromElement(qElement);
        if (msgIndex === -1) return false;

        const ctx = getContext();
        const chat = ctx?.chat || [];
        const msg = chat[msgIndex];
        if (!msg || msg.is_user) return false;

        const newHex = normalizeHexColor(color);
        if (!newHex) return false;

        const mesEl = qElement.closest('.mes');
        if (!mesEl) return false;
        const mesText = mesEl.querySelector('.mes_text');
        if (!mesText) return false;

        // Re-run attribution to get precise source offsets for each quote/emphasis segment.
        // This avoids the fragile converter.makeMarkdown round-trip used previously.
        const attribution = attributeDialogueSegments(msg.mes, msg.name);
        const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
        const qElements = Array.from(mesText.querySelectorAll('q'));

        let targetSegment = null;
        matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), (seg, el) => {
            if (el === qElement) targetSegment = seg;
        });

        if (!targetSegment) return false;

        // Splice using exact source offsets — no regex, no HTML serialization.
        msg.mes = `${msg.mes.slice(0, targetSegment.start)}<font color="${newHex}">${msg.mes.slice(targetSegment.start, targetSegment.end)}</font>${msg.mes.slice(targetSegment.end)}`;

        // Re-render the full message block canonically.
        refreshMessageDom(msgIndex, msg);
        return true;
    }

    function updateMessageTextForFontTag(fontTag, oldColor, newColor) {
        const msgIndex = getMessageIndexFromElement(fontTag);
        if (msgIndex === -1) return false;

        const ctx = getContext();
        const chat = ctx?.chat || [];
        const msg = chat[msgIndex];
        if (!msg || msg.is_user) return false;

        const oldHex = normalizeHexColor(oldColor, null);
        const newHex = normalizeHexColor(newColor, null);
        if (!oldHex || !newHex || oldHex === newHex) return false;

        const { updatedText: updated } = updateTextColorReferences(msg.mes, { [oldHex]: newHex });

        if (updated !== msg.mes) {
            msg.mes = updated;
            return true;
        }
        return false;
    }

    function getMessageElementByIndex(messageIndex) {
        const index = Number(messageIndex);
        if (!Number.isFinite(index) || index < 0) return null;
        return document.querySelector(`#chat .mes[mesid="${index}"]`)
            || document.querySelector(`.mes[mesid="${index}"]`)
            || document.querySelectorAll('#chat .mes[mesid]')[index]
            || document.querySelectorAll('.mes[mesid]')[index]
            || null;
    }

    function renderMessageDomFallback(messageIndex, message, ctx = getContext(), detailsState = null) {
        const mesEl = getMessageElementByIndex(messageIndex);
        const mesText = mesEl?.querySelector?.('.mes_text');
        if (!mesText || !message) return false;
        if (suspendMessageDomWorkForEdit(mesEl, messageIndex)) return false;
        const openDetailsState = detailsState ?? captureOpenDetailsState(mesText);
        const rawText = stripColorBlocks(message.mes || '');
        let formatted = '';
        try {
            if (typeof ctx?.messageFormatting === 'function') {
                formatted = ctx.messageFormatting(rawText, message.name || '', message.is_system || false, message.is_user || false, messageIndex);
            }
        } catch (e) {
            console.warn('[Dialogue Colors] Message formatting fallback failed:', e);
        }
        if (!formatted && typeof converter?.makeHtml === 'function') formatted = converter.makeHtml(rawText);
        try {
            mesText.innerHTML = formatted || escapeHtml(rawText).replace(/\n/g, '<br>');
        } finally {
            restoreOpenDetailsState(mesText, openDetailsState);
        }
        return true;
    }

    async function refreshMessageDom(messageIndex, message) {
        if (!Number.isFinite(messageIndex) || messageIndex < 0) return false;
        const mesElement = getMessageElementByIndex(messageIndex);
        if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
        const openDetailsState = captureMessageOpenDetailsState(mesElement, messageIndex);
        const ctx = getContext();
        if (typeof ctx?.updateMessageBlock === 'function') {
            let timeoutId = null;
            try {
                const updatePromise = Promise.resolve(ctx.updateMessageBlock(messageIndex, message ?? ctx?.chat?.[messageIndex]))
                    .finally(() => restoreMessageOpenDetailsState(mesElement, messageIndex, openDetailsState));
                const status = await Promise.race([
                    updatePromise.then(() => 'updated'),
                    new Promise(resolve => {
                        timeoutId = setTimeout(() => resolve('timeout'), UPDATE_MESSAGE_BLOCK_TIMEOUT_MS);
                    }),
                ]);
                if (status === 'updated') return true;
                console.warn('[Dialogue Colors] updateMessageBlock timed out, using fallback render.');
            } catch (e) {
                console.warn('[Dialogue Colors] updateMessageBlock failed, using fallback render:', e);
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        }
        if (renderMessageDomFallback(messageIndex, message, ctx, openDetailsState)) {
            return true;
        }
        if (typeof eventSource?.emit === 'function' && event_types?.MESSAGE_UPDATED) {
            try {
                await eventSource.emit(event_types.MESSAGE_UPDATED, messageIndex);
                return true;
            } catch (e) {
                console.warn('[Dialogue Colors] MESSAGE_UPDATED fallback emit failed:', e);
            }
        }
        return false;
    }

    function waitForDomFrame(maxWaitMs = 80) {
        return new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve();
            };
            const timeoutId = setTimeout(finish, Math.max(0, Number(maxWaitMs) || 0));
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
            else setTimeout(finish, 0);
        });
    }

    function getMessageDomReadiness(mesElement, msg, mesIndex) {
        const mesText = mesElement?.querySelector?.('.mes_text');
        if (!mesText || !msg || msg.is_system) return { ready: false, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: 0, correctDecorations: 0 };
        if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) {
            return { ready: true, totalSegments: 0, matchedSegments: 0, expectedDecorations: 0, coloredDecorations: 0, correctDecorations: 0 };
        }
        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            autoAddMessageSpeaker: false,
            overrides: getMessageQuoteOverridesForDecoration(mesIndex, msg),
            mesIndex,
        });
        const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
        const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
        const qElements = Array.from(mesText.querySelectorAll('q'));
        const emElements = Array.from(mesText.querySelectorAll('em'));
        const totalSegments = quoteSegments.length + emphasisSegments.length;
        const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
        let matchedSegments = 0;
        let correctDecorations = 0;
        const countMatch = (seg, el) => {
            matchedSegments++;
            if (seg.assignment && el.getAttribute('data-dc-speaker') === seg.assignment.key) correctDecorations++;
        };
        matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), countMatch);
        matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), countMatch);
        return {
            ready: totalSegments === 0 || matchedSegments >= totalSegments,
            totalSegments,
            matchedSegments,
            expectedDecorations,
            coloredDecorations: mesText.querySelectorAll('[data-dc-colored]').length,
            correctDecorations,
        };
    }

    function waitForMessageDomReadyForDecoration(messageIndex, msg, timeoutMs = 1600) {
        if (!msg) return Promise.resolve({ ready: false, mesElement: getMessageElementByIndex(messageIndex), readiness: null });
        return new Promise(resolve => {
            const started = Date.now();
            let observer = null;
            let interval = null;
            let settled = false;

            const cleanup = () => {
                if (observer) {
                    try { observer.disconnect(); } catch (_) { /* ignored */ }
                    observer = null;
                }
                if (interval) {
                    clearInterval(interval);
                    interval = null;
                }
            };

            const finish = result => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };

            const check = () => {
                const mesElement = getMessageElementByIndex(messageIndex);
                if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) {
                    finish({ ready: false, mesElement, readiness: null, edited: true });
                    return;
                }
                const readiness = getMessageDomReadiness(mesElement, msg, messageIndex);
                if (readiness.ready) {
                    finish({ ready: true, mesElement, readiness });
                    return;
                }
                if (Date.now() - started >= timeoutMs) {
                    finish({ ready: false, mesElement, readiness });
                }
            };

            const mesElement = getMessageElementByIndex(messageIndex);
            if (mesElement && typeof MutationObserver === 'function') {
                observer = new MutationObserver(check);
                observer.observe(mesElement, { childList: true, subtree: true, characterData: true });
            }
            interval = setInterval(check, 50);
            check();
        });
    }

    async function refreshAndDecorateMessageDom(messageIndex, message, options = {}) {
        const msg = message ?? getContext()?.chat?.[messageIndex];
        const mesElement = getMessageElementByIndex(messageIndex);
        if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
        await refreshMessageDom(messageIndex, msg);
        let { ready, mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg);
        if (edited) return false;
        if (!ready && renderMessageDomFallback(messageIndex, msg)) {
            await waitForDomFrame();
            ({ mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, 300));
            if (edited) return false;
        }
        const effectiveMesElement = readyMesElement || getMessageElementByIndex(messageIndex);
        if (!effectiveMesElement) return false;
        decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        return true;
    }

    async function decorateMessageDomFromCurrentRender(messageIndex, message, options = {}) {
        const msg = message ?? getContext()?.chat?.[messageIndex];
        const mesElement = getMessageElementByIndex(messageIndex);
        if (suspendMessageDomWorkForEdit(mesElement, messageIndex)) return false;
        let { ready, mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, options.timeoutMs ?? 400);
        if (edited) return false;
        if (!ready && options.renderFallback !== false && renderMessageDomFallback(messageIndex, msg)) {
            await waitForDomFrame();
            ({ mesElement: readyMesElement, edited } = await waitForMessageDomReadyForDecoration(messageIndex, msg, 300));
            if (edited) return false;
        }
        const effectiveMesElement = readyMesElement || getMessageElementByIndex(messageIndex);
        if (!effectiveMesElement) return false;
        decorateObservedMessages([effectiveMesElement], { queueVerification: options.queueVerification !== false });
        return true;
    }

    // Per-message follow-up repair timers so override/verifier repaints can be
    // cancelled when a newer override lands for the same message (prevents
    // stale follow-ups from re-decorating with outdated state).
    const messageDomFollowupTimers = new Map();

    function cancelMessageDomFollowupRepairs(messageIndex) {
        const index = Number(messageIndex);
        if (!Number.isFinite(index) || index < 0) return;
        const timers = messageDomFollowupTimers.get(index);
        if (timers) {
            timers.forEach(clearTimeout);
            messageDomFollowupTimers.delete(index);
        }
    }

    function scheduleMessageDomFollowupRepair(messageIndex, repainted) {
        const index = Number(messageIndex);
        if (!Number.isFinite(index) || index < 0) return;
        if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;
        // Cancel any in-flight follow-ups for this message first so we never
        // stack overlapping repair passes that fight each other.
        cancelMessageDomFollowupRepairs(index);
        const chatGeneration = attributionChatGeneration;
        const delays = repainted ? [120, 900, 3200] : [0, 900, 3200];
        const timers = [];
        for (const delay of delays) {
            const timer = setTimeout(async () => {
                // Remove this timer from the tracked set as soon as it fires.
                const tracked = messageDomFollowupTimers.get(index);
                if (tracked) {
                    const at = tracked.indexOf(timer);
                    if (at >= 0) tracked.splice(at, 1);
                    if (!tracked.length) messageDomFollowupTimers.delete(index);
                }
                try {
                    if (!settings.enabled || !isDomEngine()) return;
                    if (chatGeneration !== attributionChatGeneration) return;
                    const msg = getContext()?.chat?.[index];
                    const mesElement = getMessageElementByIndex(index);
                    if (!msg || !mesElement) return;
                    if (suspendMessageDomWorkForEdit(mesElement, index)) return;
                    const repairType = getMessageDomHealthRepairType(mesElement, msg, index);
                    // renderFallback:false — never write .mes_text innerHTML here.
                    // A fallback write would trigger the chat observer and cause a
                    // re-decoration cascade (the flicker users were seeing).
                    if (repairType === 'refresh') await decorateMessageDomFromCurrentRender(index, msg, { queueVerification: false, renderFallback: false });
                    else if (repairType === 'decorate') decorateObservedMessages([mesElement], { queueVerification: false });
                } catch (e) {
                    console.warn('[Dialogue Colors] Follow-up DOM repair failed:', e);
                }
            }, Math.max(0, Number(delay) || 0));
            timers.push(timer);
        }
        messageDomFollowupTimers.set(index, timers);
    }

    function clearMessageDomRepairTimer(mesIndex) {
        const index = Number(mesIndex);
        if (!Number.isFinite(index) || index < 0) return;
        const timer = runtimeState.messageDomRepairTimers.get(index);
        if (timer) clearTimeout(timer);
        runtimeState.messageDomRepairTimers.delete(index);
    }

    function clearMessageDomRepairTimers() {
        for (const timer of runtimeState.messageDomRepairTimers.values()) clearTimeout(timer);
        runtimeState.messageDomRepairTimers.clear();
        // Also clear all per-message follow-up repair timers.
        for (const timers of messageDomFollowupTimers.values()) timers.forEach(clearTimeout);
        messageDomFollowupTimers.clear();
    }

    function scheduleMessageDomRepair(mesIndex, options = {}) {
        const index = Number(mesIndex);
        if (!Number.isFinite(index) || index < 0) return false;

        if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return false;

        clearMessageDomRepairTimer(index);

        const chatGeneration = attributionChatGeneration;
        const delay = Math.max(0, Number(options.delay ?? POST_MUTATION_DOM_REPAIR_DELAY_MS) || 0);
        const timer = setTimeout(async () => {
            try {
                if (!settings.enabled || !isDomEngine()) return;
                if (chatGeneration !== attributionChatGeneration) return;

                const msg = getContext()?.chat?.[index];
                if (!msg || msg.is_system) return;
                if (suspendMessageDomWorkForEdit(getMessageElementByIndex(index), index)) return;

                await decorateMessageDomFromCurrentRender(index, msg, {
                    queueVerification: options.queueVerification !== false,
                    timeoutMs: options.timeoutMs ?? 700,
                });

                if (chatGeneration !== attributionChatGeneration) return;

                if (options.verify !== false) {
                    queueAutoAttributionVerificationForMessage(index, {
                        force: options.forceVerify === true,
                        delay: options.verifyDelay ?? AUTO_ATTRIBUTION_VERIFY_DELAY_MS,
                    });
                }
            } catch (e) {
                console.warn('[Dialogue Colors] Post-update DOM repair failed:', e);
                const mesElement = getMessageElementByIndex(index);
                if (mesElement) decorateObservedMessages([mesElement], { queueVerification: options.queueVerification !== false });
            } finally {
                if (runtimeState.messageDomRepairTimers.get(index) === timer) {
                    runtimeState.messageDomRepairTimers.delete(index);
                }
            }
        }, delay);
        runtimeState.messageDomRepairTimers.set(index, timer);
        return true;
    }

    function saveData(options = {}) {
        normalizeToggleSettings();
        characterColors = normalizeCharacterColors(characterColors);
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

    function migrateColorSchemaIfNeeded() {
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

    function applyStoredColorData(data) {
        if (!data) return false;
        if (data.colors) characterColors = normalizeCharacterColors(data.colors);
        if (data.settings) {
            applyStoredSettingsSnapshot(data.settings);
            if (data.settings.colorSchemaVersion === undefined) settings.colorSchemaVersion = 0;
        } else if (data.colors) {
            settings.colorSchemaVersion = 0;
        }
        return !!data.colors;
    }

    // Legacy localStorage fallback is intentionally read-only and only seeds user settings.
    function loadData() {
        characterColors = {};
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
        colorHistory = [JSON.stringify(characterColors)]; historyIndex = 0;
        lastProcessedMessageSignature = '';
    }

    function exportColors() {
        const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const d = JSON.parse(e.target.result);
                const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                if (d.colors) characterColors = normalizeCharacterColors(d.colors);
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

    function exportSettings() {
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

    function importSettings(file) {
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

    function applySettingsSnapshotWithRefresh(snapshot) {
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

    function restoreAllSettingsToDefaults() {
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
        settings.promptRole = 'user';
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
    async function loadSettingsFromServer() {
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

    function saveSettingsToStore(options = {}) {
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

    function enableAutoSync() {
        autoSyncEnabled = true;
        startAutoSyncPolling();
        saveSettingsToStore({ force: true });
        toast.success('Auto-sync enabled! Settings will sync across devices.');
    }

    function disableAutoSync() {
        autoSyncEnabled = false;
        stopAutoSyncPolling();
        saveSettingsToStore({ force: true });
        toast.info('Auto-sync disabled');
    }

    function startAutoSyncPolling() {
        if (autoSyncInterval) return;
        const pollInterval = document.hidden ? 30000 : 5000;
        autoSyncInterval = setInterval(() => {
            void loadSettingsFromServer();
        }, pollInterval);
        document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    function stopAutoSyncPolling() {
        if (autoSyncInterval) {
            clearInterval(autoSyncInterval);
            autoSyncInterval = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    }

    function handleVisibilityChange() {
        if (autoSyncEnabled) {
            stopAutoSyncPolling();
            startAutoSyncPolling();
            void loadSettingsFromServer();
        }
    }

    function updateAutoSyncUI() {
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

    function initAutoSync() {
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
    function ensureRegexScript() {
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

    const PALETTE_DESCRIPTIONS = {
        pastel: 'Use soft pastel tones.',
        neon: 'Use vivid neon colors.',
        earth: 'Use earthy, natural tones.',
        jewel: 'Use rich jewel tones.',
        muted: 'Use muted, desaturated tones.',
        jade: 'Use jade/teal greens.',
        forest: 'Use forest/woodland greens.',
        ocean: 'Use ocean/aquatic blues.',
        sunset: 'Use sunset colors (oranges, pinks, golds).',
        aurora: 'Use aurora/northern lights purples and greens.',
        warm: 'Use warm tones (reds, oranges, yellows).',
        cool: 'Use cool tones (blues, teals, purples).',
        berry: 'Use berry/magenta shades.',
        monochrome: 'Use only grayscale.',
        protanopia: 'Use colorblind-safe colors (protanopia type).',
        deuteranopia: 'Use colorblind-safe colors (deuteranopia type).',
        tritanopia: 'Use colorblind-safe colors (tritanopia type).',
    };

    function getThoughtDelimiterSymbols() {
        return [...new Set(String(settings.thoughtSymbols || '').split('').filter(s => s && s.trim()))];
    }

    function formatPromptLiteralSymbol(symbol) {
        return String(symbol ?? '');
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
        const thoughtSymbols = getThoughtDelimiterSymbols();
        const delimiterSymbols = [...new Set(['"', ...thoughtSymbols])];
        const delimiterSymbolList = delimiterSymbols.map(formatPromptLiteralSymbol).join(', ');
        const brightnessOffset = getBrightnessOffset();
        const parts = [
            'Dialogue Colors:',
            `- Color spans with <font color=#RRGGBB>...</font>, delimiters included (${delimiterSymbolList}). Ex: <font color=#aabbcc>"Hello."</font>`,
            '- Preserve text exactly; no quote escaping or commentary.',
            mode === 'dark' ? `- Use readable colors (${minLightness}-${maxLightness}% lightness for dark bg).` : `- Use readable colors (${minLightness}-${maxLightness}% lightness for light bg).`,
        ];
        if (brightnessOffset !== 0) parts.push(`New colors: ${brightnessOffset > 0 ? '+' : ''}${brightnessOffset}% lightness bias.`);
        const customPalettePrompt = buildCustomPalettePrompt();
        if (customPalettePrompt) {
            parts.push(customPalettePrompt);
        } else {
            const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
            if (paletteDesc) parts.push(paletteDesc);
        }
        if (!settings.disableNarration && settings.narratorColor) parts.push(`Narrator=${applyThemeReadabilityAndBrightness(settings.narratorColor)} for narration.`);
        if (thoughtSymbols.length) parts.push(buildThoughtSymbolColorPromptRule(thoughtSymbols.map(formatPromptLiteralSymbol).join(', ')));
        if (settings.highlightMode) parts.push('Add background highlight.');
        if (settings.cssEffects) parts.push('CSS: brief inline <span style="...">...</span> for clear tone shifts.');
        parts.push(...buildColorMetadataPromptLines());
        return parts.join('\n');
    }

    function buildCustomPalettePrompt() {
        if (!settings.colorTheme?.startsWith('custom:')) return '';
        const paletteName = settings.colorTheme.slice(7);
        if (!paletteName) return '';
        const customs = getCustomPalettes();
        const palette = customs[paletteName];
        if (!Array.isArray(palette) || !palette.length) return '';
        const meta = getCustomPaletteMeta();
        const notes = meta?.[paletteName]?.notes?.trim() || '';
        const colors = palette.map(c => normalizeHexColor(c, null)).filter(Boolean).join(', ');
        if (!colors) return '';
        const notesPart = notes ? ` Note: ${notes}.` : '';
        return `Use palette "${paletteName}": ${colors}.${notesPart} Prefer these for new characters.`;
    }

    function buildMinimalPromptInstruction() {
        if (!settings.enabled) return '';
        const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
        const thoughtSymbols = getThoughtDelimiterSymbols();
        const delimiterSymbols = [...new Set(['"', ...thoughtSymbols])];
        const delimiterList = delimiterSymbols.map(formatPromptLiteralSymbol).join(', ');
        const brightnessOffset = getBrightnessOffset();

        const parts = [
            'Dialogue Colors:',
            `Wrap spans (delimiters included: ${delimiterList}) in <font color=#RRGGBB>...</font>. Ex: <font color=#aabbcc>"Hello."</font>`,
            'Preserve text exactly; no extra quotes, commentary, or code fences.',
            mode === 'dark' ? `Use readable colors for dark bg (${minLightness}-${maxLightness}% lightness).` : `Use readable colors for light bg (${minLightness}-${maxLightness}% lightness).`,
        ];
        if (brightnessOffset !== 0) parts.push(`New colors: ${brightnessOffset > 0 ? '+' : ''}${brightnessOffset}% lightness bias.`);

        const customPalettePrompt = buildCustomPalettePrompt();
        if (customPalettePrompt) {
            parts.push(customPalettePrompt);
        } else {
            const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
            if (paletteDesc) parts.push(paletteDesc);
        }

        if (!settings.disableNarration && settings.narratorColor) {
            parts.push(`Narrator=${applyThemeReadabilityAndBrightness(settings.narratorColor)} for narration.`);
        }
        if (thoughtSymbols.length) {
            parts.push(buildThoughtSymbolColorPromptRule(thoughtSymbols.map(formatPromptLiteralSymbol).join(', ')));
        }
        if (settings.highlightMode) parts.push('Add background highlight.');

        parts.push(...buildColorMetadataPromptLines());
        return parts.join('\n');
    }

    function buildDomStealthColorsInstruction() {
        if (!settings.enabled) return '';
        const { mode, minLightness, maxLightness } = getThemeLightnessBounds();
        const thoughtSymbols = getThoughtDelimiterSymbols();
        const thoughtSymbolList = thoughtSymbols.map(formatPromptLiteralSymbol).join(', ');
        const brightnessOffset = getBrightnessOffset();
        const parts = [
            'Dialogue Colors (metadata only): Write reply normally; do not add visible <font> tags or CSS.',
            ...buildColorMetadataPromptLines(),
            'List every active speaker; omit [COLORS:] only if none.'
        ];
        parts.push(mode === 'dark' ? `Use dark bg colors (${minLightness}-${maxLightness}% lightness).` : `Use light bg colors (${minLightness}-${maxLightness}% lightness).`);
        if (brightnessOffset !== 0) parts.push(`New colors: ${brightnessOffset > 0 ? '+' : ''}${brightnessOffset}% lightness bias.`);
        const customPalettePrompt = buildCustomPalettePrompt();
        if (customPalettePrompt) parts.push(customPalettePrompt);
        else {
            const paletteDesc = PALETTE_DESCRIPTIONS[settings.colorTheme];
            if (paletteDesc) parts.push(paletteDesc);
        }
        if (thoughtSymbolList) parts.push(`Track thought delimiters: ${thoughtSymbolList}.`);
        return parts.join('\n');
    }

    function buildColoredPromptPreview() {
        if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
        if (isDomEngine()) {
            if (settings.domStealthColors) return '<span style="opacity:0.5">(local DOM engine + stealth colors block)</span>';
            return '<span style="opacity:0.5">(local DOM engine: no prompt injected)</span>';
        }
        const entries = Object.entries(characterColors);
        if (!entries.length) return '<span style="opacity:0.5">(no characters)</span>';
        return entries.map(([, v]) => `<span style="color:${getEntryEffectiveColor(v)}">${escapeHtml(v.name)}</span>`).join(', ');
    }

    function injectPrompt() {
        if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
        injectDebouncedTimer = setTimeout(() => {
            let promptText = '';
            if (settings.enabled && !isDomEngine() && settings.promptMode !== 'macro') {
                promptText = buildMinimalPromptInstruction();
            } else if (settings.enabled && isDomEngine() && settings.domStealthColors) {
                promptText = buildDomStealthColorsInstruction();
            }
            const role = settings.promptRole === 'user' ? extension_prompt_roles.USER : extension_prompt_roles.SYSTEM;
            setExtensionPrompt(MODULE_NAME, promptText, extension_prompt_types.IN_CHAT, settings.promptDepth, false, role);
            const p = document.getElementById('dc-prompt-preview');
            if (p) p.innerHTML = buildColoredPromptPreview();
            updateSystemPromptDisplay();
        }, 50);
    }

    function updateSystemPromptDisplay() {
        const container = document.getElementById('dc-system-prompt-container');
        if (!container) return;

        if (settings.promptMode === 'macro' && settings.enabled && !isDomEngine()) {
            container.style.display = 'block';
            const textarea = document.getElementById('dc-system-prompt-text');
            if (textarea) textarea.value = '{{dialoguecolors}}';
        } else {
            container.style.display = 'none';
        }
    }

    // Phase 3A: Legend with event listener cleanup
    function createLegend() {
        let legend = document.getElementById('dc-legend-float');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'dc-legend-float';

            const savedPos = getLegendPosition();
            const top = Number.isFinite(savedPos.top) ? savedPos.top : 60;
            const left = Number.isFinite(savedPos.left) ? savedPos.left : undefined;
            const right = Number.isFinite(savedPos.right) ? savedPos.right : 10;

            legend.style.cssText = `position:fixed;top:${top}px;${left !== undefined ? `left:${left}px;` : `right:${right}px;`}background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;max-height:60vh;overflow-y:auto;display:none;cursor:move;user-select:none;`;

            let isDragging = false;
            let startX, startY, startLeft, startTop;

            const onMouseDown = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
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

            legendListeners = { onMouseMove, onMouseUp };

            document.body.appendChild(legend);
        }
        return legend;
    }

    function updateLegend() {
        const legend = createLegend();
        const entries = Object.entries(characterColors);
        if (!entries.length || !settings.showLegend) { legend.style.display = 'none'; return; }
        legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;cursor:grab;">⋮⋮ Characters</div>' +
            entries.map(([, v]) => {
                const safeColor = getEntryEffectiveColor(v);
                const fontFamily = getGoogleFontFamily(v.font);
                if (fontFamily) loadGoogleFont(v.font);
                const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
                return `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${safeColor};"></span><span style="color:${safeColor};${fontStyle}">${escapeHtml(v.name)}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount || 0}</span></div>`;
            }).join('');
        legend.style.display = settings.showLegend ? 'block' : 'none';
    }

    function getDialogueStats() {
        const entries = Object.entries(characterColors);
        const total = entries.reduce((s, [, v]) => s + (v.dialogueCount || 0), 0);
        return entries.map(([, v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: getEntryEffectiveColor(v), font: normalizeGoogleFontName(v.font) })).sort((a, b) => b.count - a.count);
    }

    function showStatsPopup() {
        const stats = getDialogueStats();
        if (!stats.length) { toast.info('No dialogue data'); return; }
        const maxCount = Math.max(...stats.map(s => s.count), 1);
        let html = stats.map(s => {
            const fontFamily = getGoogleFontFamily(s.font);
            if (fontFamily) loadGoogleFont(s.font);
            const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
            return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:60px;color:${s.color};${fontStyle}">${escapeHtml(s.name)}</span><div style="flex:1;height:12px;background:var(--SmartThemeBlurTintColor);border-radius:3px;overflow:hidden;"><div style="width:${s.count / maxCount * 100}%;height:100%;background:${s.color};"></div></div><span style="width:40px;text-align:right;font-size:0.8em;">${s.count} (${s.pct}%)</span></div>`;
        }).join('');
        const popup = document.createElement('div');
        popup.id = 'dc-stats-popup';
        popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Dialogue Statistics</div>${html}<button class="dc-close-popup menu_button" style="margin-top:10px;width:100%;">Close</button>`;
        popup.querySelector('.dc-close-popup').onclick = () => popup.remove();
        document.body.appendChild(popup);
        const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
        setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
    }

    function showStorageManager() {
        const currentKey = getStorageKey();
        const colorData = getUserColorDataStore();
        const keys = Object.keys(colorData).filter(k => k.startsWith('dc_char_') || k === 'dc_global');
        if (!keys.length) { toast.info('No stored color data found'); return; }

        const entries = keys.map(k => {
            const entry = normalizeColorDataEntry(colorData[k]) || { colors: {} };
            const raw = JSON.stringify(entry);
            const size = new Blob([raw]).size;
            const colors = entry.colors || {};
            const colorCount = Object.keys(colors).length;
            const names = Object.values(colors).map(v => v.name).filter(Boolean).slice(0, 3);
            const isCurrent = k === currentKey;
            const label = names.length ? names.join(', ') + (colorCount > 3 ? ` (+${colorCount - 3})` : '') : getStorageLabelForKey(k);
            const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
            return { key: k, label, colorCount, sizeStr, size, isCurrent };
        });
        entries.sort((a, b) => a.isCurrent ? -1 : b.isCurrent ? 1 : a.key.localeCompare(b.key));

        const rows = entries.map(e => {
            const highlight = e.isCurrent ? 'background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 4px;' : 'padding:2px 4px;';
            const tag = e.isCurrent ? ' <span style="font-size:0.75em;opacity:0.6;">(current)</span>' : '';
            return `<label style="display:flex;align-items:center;gap:6px;${highlight}cursor:pointer;"><input type="checkbox" class="dc-storage-check" data-key="${escapeHtml(e.key)}" ${e.isCurrent ? '' : 'checked'}><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.label)}${tag}</span><span style="font-size:0.75em;opacity:0.6;white-space:nowrap;">${e.colorCount} colors · ${e.sizeStr}</span></label>`;
        }).join('');

        const popup = document.createElement('div');
        popup.id = 'dc-storage-popup';
        popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Storage Manager</div>${rows}<div style="display:flex;gap:4px;margin-top:10px;flex-wrap:wrap;"><button class="dc-storage-all menu_button" style="flex:1;">Select All</button><button class="dc-storage-none menu_button" style="flex:1;">Deselect All</button></div><div style="display:flex;gap:4px;margin-top:4px;"><button class="dc-storage-clear menu_button" style="flex:1;">Clear Selected</button><button class="dc-storage-close menu_button" style="flex:1;">Close</button></div>`;

        const checks = () => popup.querySelectorAll('.dc-storage-check');
        popup.querySelector('.dc-storage-all').onclick = () => checks().forEach(c => c.checked = true);
        popup.querySelector('.dc-storage-none').onclick = () => checks().forEach(c => c.checked = false);
        popup.querySelector('.dc-storage-close').onclick = () => { popup.remove(); document.removeEventListener('mousedown', closePopup); };
        popup.querySelector('.dc-storage-clear').onclick = () => {
            const selected = [...checks()].filter(c => c.checked).map(c => c.dataset.key);
            if (!selected.length) { toast.info('Nothing selected'); return; }
            const entryWord = selected.length === 1 ? 'entry' : 'entries';
            const clearingCurrent = selected.includes(currentKey);
            const keptCurrentKeys = clearingCurrent ? getKeptKeys() : [];
            const keptCurrentCount = keptCurrentKeys.length;
            const confirmMessage = keptCurrentCount
                ? `Clear ${selected.length} stored color data ${entryWord}? Pinned characters in the current chat will be kept.`
                : `Clear ${selected.length} stored color data ${entryWord}?`;
            if (!confirm(confirmMessage)) return;

            selected.forEach(k => {
                if (k !== currentKey) removeStoredColorData(k);
            });
            popup.remove();
            document.removeEventListener('mousedown', closePopup);
            if (clearingCurrent) {
                if (keptCurrentCount) {
                    keepCharacterKeysOnly(keptCurrentKeys);
                    saveHistory();
                    saveData();
                } else {
                    removeStoredColorData(currentKey);
                    characterColors = {};
                    expandedCharacterRows.clear();
                    swapMode = null;
                    saveHistory();
                }
                updateCharList();
                injectPrompt();
            }

            const summary = keptCurrentCount
                ? `Cleared ${selected.length} ${entryWord}. Current chat kept ${keptCurrentCount} pinned character${keptCurrentCount !== 1 ? 's' : ''}.`
                : `Cleared ${selected.length} ${entryWord}.`;
            toast.success(summary);
        };

        document.body.appendChild(popup);
        const closePopup = e => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', closePopup); } };
        setTimeout(() => document.addEventListener('mousedown', closePopup), 10);
    }

    function saveToCard() {
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

    function loadFromCard() {
        try {
            const ctx = getContext();
            const charId = ctx?.characterId;
            if (charId === undefined) { toast.error('No character loaded'); return; }

            getCharacters?.().then(() => {
                const char = ctx?.characters?.[charId];
                const data = char?.data?.extensions?.dialogueColors;
                if (data?.colors) {
                    const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
                    characterColors = normalizeCharacterColors(data.colors);
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

    function tryLoadFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) {
                characterColors = normalizeCharacterColors(data.colors);
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

    function parseNameWithNicknames(rawName) {
        const match = rawName.match(/^([^(]+)(.*)$/);
        if (!match) return { name: rawName.trim(), nicknames: [] };
        const name = match[1].trim();
        const nicknames = [...rawName.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).filter(Boolean);
        return { name, nicknames };
    }

    function splitCompositeSpeakerName(rawName) {
        const trimmedName = String(rawName ?? '').trim();
        if (!trimmedName) return [];
        const parts = trimmedName
            .split(/\s*(?:&|\/|\+|,|\band\b)\s*/i)
            .map(part => String(part ?? '').trim())
            .filter(Boolean);
        if (parts.length < 2) return [];
        const seen = new Set();
        return parts.filter(part => {
            const key = part.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function isCompositeSpeakerLabel(rawName) {
        return splitCompositeSpeakerName(rawName).length >= 2;
    }

    function resolveLookupAssignmentByName(lookup, rawName) {
        if (!(lookup instanceof Map)) return null;
        const trimmedName = String(rawName ?? '').trim();
        if (!trimmedName) return null;
        const { name, nicknames } = parseNameWithNicknames(trimmedName);
        const candidates = [];
        const pushCandidate = value => {
            const normalized = String(value ?? '').trim().toLowerCase();
            if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
        };
        pushCandidate(trimmedName);
        pushCandidate(name);
        nicknames.forEach(pushCandidate);
        for (const candidate of candidates) {
            const assignment = lookup.get(candidate);
            if (assignment) return assignment;
        }
        return null;
    }

    function resolveCompositeSpeakerParts(rawName, lookup) {
        const parts = splitCompositeSpeakerName(rawName);
        if (parts.length < 2 || !(lookup instanceof Map)) return [];
        const resolved = [];
        const seenKeys = new Set();
        for (const part of parts) {
            const assignment = resolveLookupAssignmentByName(lookup, part);
            if (!assignment || isCompositeSpeakerLabel(assignment.name)) return [];
            if (seenKeys.has(assignment.key)) continue;
            seenKeys.add(assignment.key);
            resolved.push(assignment);
        }
        return resolved;
    }

    function isReducibleCompositeSpeakerName(rawName, lookup) {
        return resolveCompositeSpeakerParts(rawName, lookup).length >= 2;
    }

    function resolveSingleSpeakerAssignment(rawName, lookup) {
        const trimmedName = String(rawName ?? '').trim();
        if (!trimmedName || !(lookup instanceof Map)) return null;
        const resolvedCompositeParts = resolveCompositeSpeakerParts(trimmedName, lookup);
        if (resolvedCompositeParts.length === 1) return resolvedCompositeParts[0];
        if (resolvedCompositeParts.length >= 2 || isCompositeSpeakerLabel(trimmedName)) return null;
        const directAssignment = resolveLookupAssignmentByName(lookup, trimmedName);
        if (!directAssignment || isCompositeSpeakerLabel(directAssignment.name)) return null;
        return directAssignment;
    }

    function buildSingleSpeakerEntryLookup(rawColors) {
        const lookup = new Map();
        for (const entry of Object.values(rawColors || {})) {
            if (!entry || isCompositeSpeakerLabel(entry.name)) continue;
            registerLookupAssignment(lookup, entry.name, getEntryEffectiveColor(entry), entry.aliases, false, entry.font);
        }
        return lookup;
    }

    function pruneReducibleCompositeEntries(rawColors) {
        if (!rawColors || typeof rawColors !== 'object') return {};
        let removed = false;
        do {
            removed = false;
            const lookup = buildSingleSpeakerEntryLookup(rawColors);
            for (const [key, entry] of Object.entries(rawColors)) {
                if (!entry || !isCompositeSpeakerLabel(entry.name)) continue;
                if (!isReducibleCompositeSpeakerName(entry.name, lookup)) continue;
                delete rawColors[key];
                removed = true;
            }
        } while (removed);
        return rawColors;
    }

    // Phase 1A: Shared color-pair processing — deduplicates parseColorBlock, scanAllMessages, onNewMessage
    // Also fixes auto-lock inconsistency (2A) and adds group field (6B)
    function processColorPairs(pairsString) {
        let foundNew = false;
        let hadRemapping = false;
        const remappedAssignments = [];
        const colorPairs = pairsString.split(',');
        for (const pair of colorPairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) continue;
            const rawName = pair.substring(0, eqIdx).trim();
            const { name, nicknames } = parseNameWithNicknames(rawName);
            const rawColor = pair.substring(eqIdx + 1).trim();
            if (!name || !rawColor || !/^#[a-fA-F0-9]{6}$/i.test(rawColor)) continue;
            const assignedColor = normalizeHexColor(rawColor);
            const existingKey = resolveCharacterKeyByNameOrAlias(name);
            const key = existingKey || name.toLowerCase();
            const canonicalName = existingKey ? characterColors[existingKey].name : name;
            if (characterColors[key]) {
                characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1;
                if (!normalizeHexColor(characterColors[key].color, null)) {
                    setEntryFromEffectiveColor(characterColors[key], assignedColor);
                }
                characterColors[key].baseColor = normalizeHexColor(characterColors[key].baseColor, deriveBaseColorFromEffectiveColor(getEntryEffectiveColor(characterColors[key])));
            } else {
                const built = buildCharacterEntry(canonicalName, {
                    color: assignedColor,
                    colorMode: 'effective',
                    locked: settings.autoLockDetected !== false,
                    dialogueCount: 1
                });
                if (!built.entry) continue;
                characterColors[key] = built.entry;
                foundNew = true;
                if (built.remapped) {
                    const finalColor = normalizeHexColor(getEntryEffectiveColor(built.entry), null);
                    hadRemapping = true;
                    if (finalColor && finalColor !== assignedColor) {
                        remappedAssignments.push({ name: canonicalName, key, oldColor: assignedColor, newColor: finalColor });
                    }
                }
            }
            if (nicknames.length) {
                characterColors[key].aliases = characterColors[key].aliases || [];
                nicknames.forEach(nick => {
                    if (!characterColors[key].aliases.includes(nick)) {
                        characterColors[key].aliases.push(nick);
                    }
                });
            }
        }
        return { foundNew, hadRemapping, remappedAssignments };
    }

    function parseColorBlock(element) {
        const mesText = element.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
        let match, foundNew = false;
        // Parse from textContent for data extraction
        while ((match = colorBlockRegex.exec(mesText.textContent)) !== null) {
            const result = processColorPairs(match[1]);
            if (result.foundNew) foundNew = true;
        }
        stripColorBlockFromElement(mesText);
        return foundNew;
    }

    function stripColorBlockFromElement(element) {
        const mesText = element?.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const openDetailsState = captureOpenDetailsState(mesText);
        const before = mesText.innerHTML;
        const cleaned = before.replace(/\[COLORS?:[^\]]*\]/gi, '');
        if (cleaned === before) return false;
        try {
            mesText.innerHTML = cleaned;
        } finally {
            restoreOpenDetailsState(mesText, openDetailsState);
        }
        return true;
    }

    function stripColorBlocksFromDisplay() {
        let removed = false;
        document.querySelectorAll('.mes_text').forEach(el => {
            if (stripColorBlockFromElement(el)) removed = true;
        });
        return removed;
    }

    function scanAllMessages() {
        Object.values(characterColors).forEach(c => c.dialogueCount = 0);
        const ctx = getContext();
        const chat = ctx?.chat || [];
        const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;

        for (const msg of chat) {
            const text = msg?.mes || '';
            let match;
            while ((match = colorBlockRegex.exec(text)) !== null) {
                processColorPairs(match[1]); // Return value not needed here
            }
        }

        commit();
        stripColorBlocksFromDisplay();
        if (isDomEngine()) {
            decorateAllMessages();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        }
        const conflicts = checkColorConflicts();
        if (conflicts.length) toast.warning(`Similar: ${conflicts.slice(0, 3).map(c => c.join(' & ')).join(', ')}`);
        toast.info(`Found ${Object.keys(characterColors).length} characters`);
    }

    function setRecolorButtonBusy(isBusyState) {
        const button = document.getElementById('dc-recolor');
        if (!button) return;
        if (isBusyState) {
            if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Recolor';
            button.disabled = true;
            button.textContent = 'Recoloring...';
            return;
        }
        button.disabled = false;
        button.textContent = button.dataset.defaultLabel || 'Recolor';
    }

    function setColorizeButtonBusy(isBusyState) {
        const button = document.getElementById('dc-colorize');
        if (!button) return;
        if (isBusyState) {
            if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Colorize';
            button.disabled = true;
            button.textContent = 'Colorizing...';
            return;
        }
        button.disabled = false;
        button.textContent = button.dataset.defaultLabel || 'Colorize';
    }

    function setVerifyAttributionButtonBusy(isBusyState) {
        const button = document.getElementById('dc-verify-attr');
        if (!button) return;
        if (isBusyState) {
            if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || 'Verify Colors (LLM)';
            button.disabled = true;
            button.textContent = 'Verifying...';
            return;
        }
        button.disabled = false;
        button.textContent = button.dataset.defaultLabel || 'Verify Colors (LLM)';
    }

    function showAutoColorizeIndicator(mesElement) {
        if (!mesElement) return;
        let indicator = mesElement.querySelector('.dc-auto-colorize-indicator');
        if (indicator) return;
        indicator = document.createElement('div');
        indicator.className = 'dc-auto-colorize-indicator';
        indicator.textContent = 'Auto-colorizing…';
        mesElement.style.position = mesElement.style.position || 'relative';
        mesElement.appendChild(indicator);
    }

    function clearAutoColorizeIndicators() {
        document.querySelectorAll('.dc-auto-colorize-indicator').forEach(indicator => indicator.remove());
    }

    function hideAutoColorizeIndicator(mesElement) {
        if (!mesElement) return;
        const indicator = mesElement.querySelector('.dc-auto-colorize-indicator');
        if (indicator) indicator.remove();
    }

    function parseColorAssignmentsFromText(text) {
        const latestByColor = {};
        const namesByColor = {};
        const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
        let blockMatch;
        while ((blockMatch = colorBlockRegex.exec(text || '')) !== null) {
            for (const pair of blockMatch[1].split(',')) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx === -1) continue;
                const { name } = parseNameWithNicknames(pair.substring(0, eqIdx).trim());
                const rawColor = pair.substring(eqIdx + 1).trim();
                if (!name || !/^#[0-9a-fA-F]{6}$/.test(rawColor)) continue;
                const colorKey = rawColor.toLowerCase();
                const nameKey = name.toLowerCase();
                latestByColor[colorKey] = nameKey;
                if (!namesByColor[colorKey]) namesByColor[colorKey] = new Set();
                namesByColor[colorKey].add(nameKey);
            }
        }
        return { latestByColor, namesByColor };
    }

    function collectFontColorsFromText(text) {
        const colors = new Set();
        const fontTagRegex = /<font\b[^>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^>]*>/gi;
        let match;
        while ((match = fontTagRegex.exec(text || '')) !== null) {
            colors.add(match[1].toLowerCase());
        }
        return colors;
    }

    function parseNamedColorAssignmentsFromText(text) {
        const assignments = [];
        const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
        let blockMatch;
        while ((blockMatch = colorBlockRegex.exec(text || '')) !== null) {
            for (const pair of blockMatch[1].split(',')) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx === -1) continue;
                const rawName = pair.substring(0, eqIdx).trim();
                const { name, nicknames } = parseNameWithNicknames(rawName);
                const color = normalizeHexColor(pair.substring(eqIdx + 1).trim(), null);
                if (!name || !color) continue;
                assignments.push({ name, aliases: nicknames, color });
            }
        }
        return assignments;
    }

    function buildDialogueRegex() {
        const delimiters = new Set(['"']);
        for (const ch of getThoughtDelimiterSymbols()) {
            delimiters.add(ch);
        }
        
        const ASYMMETRIC_MAP = {
            '『': '』',
            '「': '」',
            '（': '）',
            '《': '》',
            '〈': '〉',
            '【': '】',
            '〔': '〕',
            '〖': '〗',
            '〘': '〙',
            '〚': '〛',
            '(': ')',
            '{': '}',
            '[': ']',
            '<': '>',
        };
        const REVERSE_ASYMMETRIC_MAP = {};
        for (const [open, close] of Object.entries(ASYMMETRIC_MAP)) {
            REVERSE_ASYMMETRIC_MAP[close] = open;
        }

        const patterns = [];
        const processedAsymmetricPairs = new Set();

        for (const delimiter of delimiters) {
            const isOpening = ASYMMETRIC_MAP[delimiter] !== undefined;
            const isClosing = REVERSE_ASYMMETRIC_MAP[delimiter] !== undefined;

            if (isOpening || isClosing) {
                const openChar = isOpening ? delimiter : REVERSE_ASYMMETRIC_MAP[delimiter];
                const closeChar = isOpening ? ASYMMETRIC_MAP[delimiter] : delimiter;
                const pairKey = `${openChar}:${closeChar}`;

                if (processedAsymmetricPairs.has(pairKey)) {
                    continue;
                }
                processedAsymmetricPairs.add(pairKey);

                const escapedOpen = escapeRegex(openChar);
                const escapedClose = escapeRegex(closeChar);
                patterns.push(`${escapedOpen}([^${escapedClose}]+)${escapedClose}`);
            } else {
                const escaped = escapeRegex(delimiter);
                patterns.push(`${escaped}([^${escaped}]+)${escaped}`);
            }
        }
        return patterns.length ? new RegExp(`(${patterns.join('|')})`, 'g') : null;
    }

    function registerLookupAssignment(lookup, name, color, aliases = [], preserveExisting = false, font = '') {
        const normalizedName = String(name ?? '').trim();
        const normalizedColor = normalizeHexColor(color, null);
        if (!normalizedName || !normalizedColor) return;
        const canonicalKey = normalizedName.toLowerCase();
        const assignment = { key: canonicalKey, name: normalizedName, color: normalizedColor, font: normalizeGoogleFontName(font) };
        const lookupNames = [normalizedName, ...normalizeAliases(aliases)];
        for (const lookupName of lookupNames) {
            const lookupKey = lookupName.toLowerCase();
            if (!lookupKey) continue;
            if (preserveExisting && lookup.has(lookupKey)) continue;
            lookup.set(lookupKey, assignment);
        }
    }

    function buildNameColorLookup(extraAssignments = []) {
        const lookup = new Map();
        for (const entry of Object.values(characterColors)) {
            registerLookupAssignment(lookup, entry.name, getEntryEffectiveColor(entry), entry.aliases, false, entry.font);
        }
        if (settings.narratorColor) {
            registerLookupAssignment(lookup, 'Narrator', applyThemeReadabilityAndBrightness(settings.narratorColor));
        }
        const pendingCompositeAssignments = [];
        for (const assignment of Array.isArray(extraAssignments) ? extraAssignments : []) {
            if (!assignment) continue;
            if (isCompositeSpeakerLabel(assignment.name)) {
                pendingCompositeAssignments.push(assignment);
                continue;
            }
            registerLookupAssignment(lookup, assignment.name, assignment.color, assignment.aliases, true);
        }
        for (const assignment of pendingCompositeAssignments) {
            if (isReducibleCompositeSpeakerName(assignment.name, lookup)) continue;
            registerLookupAssignment(lookup, assignment.name, assignment.color, assignment.aliases, true);
        }
        return lookup;
    }

    function setColorFontMapping(colorToFont, ambiguousColors, lockedColors, color, font, options = {}) {
        const normalizedColor = normalizeHexColor(color, null);
        const normalizedFont = normalizeGoogleFontName(font);
        if (!normalizedColor || !normalizedFont) return;
        if (lockedColors.has(normalizedColor) && !options.force) return;
        const existing = colorToFont.get(normalizedColor);
        if (existing && existing !== normalizedFont && !options.force) {
            ambiguousColors.add(normalizedColor);
            return;
        }
        colorToFont.set(normalizedColor, normalizedFont);
        if (options.force) {
            ambiguousColors.delete(normalizedColor);
            lockedColors.add(normalizedColor);
        }
    }

    function buildColorFontLookup(rawText = '') {
        const colorToFont = new Map();
        const ambiguousColors = new Set();
        const lockedColors = new Set();
        const lookup = buildNameColorLookup();
        const parsed = parseColorAssignmentsFromText(rawText);

        for (const [color, names] of Object.entries(parsed.namesByColor || {})) {
            const normalizedColor = normalizeHexColor(color, null);
            if (!normalizedColor) continue;
            lockedColors.add(normalizedColor);
            if (!names || names.size !== 1) {
                colorToFont.delete(normalizedColor);
                continue;
            }
            const [nameKey] = Array.from(names);
            const assignment = lookup.get(nameKey);
            if (assignment?.font) setColorFontMapping(colorToFont, ambiguousColors, lockedColors, normalizedColor, assignment.font, { force: true });
            else colorToFont.delete(normalizedColor);
        }

        for (const entry of Object.values(characterColors)) {
            if (!entry?.font) continue;
            setColorFontMapping(colorToFont, ambiguousColors, lockedColors, getEntryEffectiveColor(entry), entry.font);
        }

        for (const color of ambiguousColors) {
            if (!lockedColors.has(color)) colorToFont.delete(color);
        }
        return colorToFont;
    }

    function makeLengthPreservingSearchText(text) {
        return String(text ?? '')
            .replace(/<[^>]+>/g, match => ' '.repeat(match.length))
            .replace(/&(?:[a-z]+|#[0-9]+|#x[0-9a-f]+);/gi, match => ' '.repeat(match.length))
            .replace(/[*_`~]/g, ' ');
    }

    function buildMaskedDialogueText(text, segments) {
        const raw = String(text ?? '');
        if (!segments.length) return raw;
        let masked = '';
        let cursor = 0;
        for (const seg of segments) {
            masked += raw.slice(cursor, seg.start);
            masked += ' '.repeat(Math.max(0, seg.end - seg.start));
            cursor = seg.end;
        }
        return masked + raw.slice(cursor);
    }

    function getDialogueParagraphRange(text, start, end) {
        const raw = String(text ?? '');
        let rangeStart = 0;
        for (let i = Math.max(0, start) - 1; i >= 0; i--) {
            if (raw[i] === '\n' || raw[i] === '\r') {
                rangeStart = i + 1;
                break;
            }
        }
        let rangeEnd = raw.length;
        for (let i = Math.min(raw.length, end); i < raw.length; i++) {
            if (raw[i] === '\n' || raw[i] === '\r') {
                rangeEnd = i;
                break;
            }
        }
        return { start: rangeStart, end: rangeEnd };
    }

    function isSameDialogueParagraph(left, right) {
        return !!left && !!right && left.start === right.start && left.end === right.end;
    }

    const speakingVerbs = new Set([
        'say', 'says', 'said', 'saying',
        'ask', 'asks', 'asked', 'asking',
        'reply', 'replies', 'replied', 'replying',
        'retort', 'retorts', 'retorted', 'retorting',
        'answer', 'answers', 'answered', 'answering',
        'whisper', 'whispers', 'whispered', 'whispering',
        'yell', 'yells', 'yelled', 'yelling',
        'shout', 'shouts', 'shouted', 'shouting',
        'scream', 'screams', 'screamed', 'screaming',
        'bellow', 'bellows', 'bellowed', 'bellowing',
        'roar', 'roars', 'roared', 'roaring',
        'call', 'calls', 'called', 'calling',
        'cry', 'cries', 'cried', 'crying',
        'whimper', 'whimpers', 'whimpered', 'whimpering',
        'sob', 'sobs', 'sobbed', 'sobbing',
        'sigh', 'sighs', 'sighed', 'sighing',
        'groan', 'groans', 'groaned', 'groaning',
        'gasp', 'gasps', 'gasped', 'gasping',
        'mutter', 'mutters', 'muttered', 'muttering',
        'mumble', 'mumbles', 'mumbled', 'mumbling',
        'murmur', 'murmurs', 'murmured', 'murmuring',
        'sputter', 'sputters', 'sputtered', 'sputtering',
        'stammer', 'stammers', 'stammered', 'stammering',
        'stutter', 'stutters', 'stuttered', 'stuttering',
        'giggle', 'giggles', 'giggled', 'giggling',
        'laugh', 'laughs', 'laughed', 'laughing',
        'chuckle', 'chuckles', 'chuckled', 'chuckling',
        'snicker', 'snickers', 'snickered', 'snivering', 'snickering',
        'smirk', 'smirks', 'smirked', 'smirking',
        'grin', 'grins', 'grinned', 'grinning',
        'smile', 'smiles', 'smiled', 'smiling',
        'nod', 'nods', 'nodded', 'nodding',
        'shrug', 'shrugs', 'shrugged', 'shrugging',
        'frown', 'frowns', 'frowned', 'frowning',
        'pout', 'pouts', 'pouted', 'pouting',
        'sneer', 'sneers', 'sneered', 'sneering',
        'scoff', 'scoffs', 'scoffed', 'scoffing',
        'growl', 'growls', 'growled', 'growling',
        'hiss', 'hisses', 'hissed', 'hissing',
        'snap', 'snaps', 'snapped', 'snapping',
        'bark', 'barks', 'barked', 'barking',
        'rasp', 'rasps', 'rasped', 'rasping',
        'croak', 'croaks', 'croaked', 'croaking',
        'squeak', 'squeaks', 'squeaked', 'squeaking',
        'pipe', 'pipes', 'piped', 'piping',
        'chime', 'chimes', 'chimed', 'chiming',
        'agree', 'agrees', 'agreed', 'agreeing',
        'add', 'adds', 'added', 'adding',
        'continue', 'continues', 'continued', 'continuing',
        'comment', 'comments', 'commented', 'commenting',
        'note', 'notes', 'noted', 'noting',
        'observe', 'observes', 'observed', 'observing',
        'suggest', 'suggests', 'suggested', 'suggesting',
        'insist', 'insists', 'insisted', 'insisting',
        'demand', 'demands', 'demanded', 'demanding',
        'plead', 'pleads', 'pleaded', 'pleading',
        'beg', 'begs', 'begged', 'begging',
        'gesture', 'gestures', 'gestured', 'gesturing',
        'motion', 'motions', 'motioned', 'motioning',
        'wave', 'waves', 'waved', 'waving',
        'point', 'points', 'pointed', 'pointing',
        'turn', 'turns', 'turned', 'turning',
        'snort', 'snorts', 'snorted', 'snorting',
        'quip', 'quips', 'quipped', 'quipping',
        'exclaim', 'exclaims', 'exclaimed', 'exclaiming',
        'interject', 'interjects', 'interjected', 'interjecting',
        'spit', 'spits', 'spat', 'spitting',
        'muse', 'muses', 'mused', 'musing',
        'ponder', 'ponders', 'pondered', 'pondering',
        'think', 'thinks', 'thought', 'thinking',
        'wonder', 'wonders', 'wondered', 'wondering',
        'breathe', 'breathes', 'breathed', 'breathing',
        'snarl', 'snarls', 'snarled', 'snarling',
        'jeer', 'jeers', 'jeered', 'jeering',
        'taunt', 'taunts', 'taunted', 'taunting',
        'tease', 'teases', 'teased', 'teasing',
        'scold', 'scolds', 'scolded', 'scolding',
        'warn', 'warns', 'warned', 'warning',
        'protest', 'protests', 'protested', 'protesting'
    ]);

    const passivePrepositions = new Set([
        'to', 'at', 'with', 'from', 'behind', 'beside', 'next', 'near', 'against', 'toward', 'towards', 'for', 'of', 'about', 'upon', 'on', 'under', 'above', 'by', 'in', 'into', 'onto', 'through', 'across', 'around'
    ]);

    function isBetterSpeakerCandidate(candidate, best) {
        if (!best) return true;
        if (candidate.strength > best.strength) return true;
        if (candidate.strength < best.strength) return false;
        const afterTagWindow = 30;
        const nearTie = 20;
        const candidateAfterTag = candidate.side === 'after' && candidate.distance <= afterTagWindow;
        const bestAfterTag = best.side === 'after' && best.distance <= afterTagWindow;
        if (candidateAfterTag && !bestAfterTag && candidate.distance <= best.distance + nearTie) return true;
        if (bestAfterTag && !candidateAfterTag && best.distance <= candidate.distance + nearTie) return false;
        return candidate.distance < best.distance;
    }

    // Cache compiled per-speaker name-match regexes.  Invalidated when the
    // character list changes (loadData/addCharacter/deleteCharacter/renameCharacter).
    const speakerRegexCache = new Map();
    function clearSpeakerRegexCache() { speakerRegexCache.clear(); }

    function findClosestMentionedSpeakerInContext(maskedText, windowStart, windowEnd, segmentStart, segmentEnd, lookup, sortedLookupKeys, defaultSpeaker = null) {
        const text = String(maskedText ?? '');
        const boundedStart = Math.max(0, Math.min(text.length, windowStart));
        const boundedEnd = Math.max(boundedStart, Math.min(text.length, windowEnd));
        if (boundedStart >= boundedEnd) return null;

        const cleanWindow = makeLengthPreservingSearchText(text.slice(boundedStart, boundedEnd));
        let best = null;

        for (const speakerKey of sortedLookupKeys) {
            const assignment = lookup.get(speakerKey);
            if (!assignment) continue;
            let regex = speakerRegexCache.get(speakerKey);
            if (!regex) {
                regex = new RegExp(`\\b${escapeRegex(speakerKey)}(?:'s?)?\\b`, 'gi');
                speakerRegexCache.set(speakerKey, regex);
            }
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(cleanWindow)) !== null) {
                const matchStart = boundedStart + match.index;
                const matchEnd = matchStart + match[0].length;
                let side = '';
                let distance = Infinity;
                if (matchEnd <= segmentStart) {
                    side = 'before';
                    distance = segmentStart - matchEnd;
                } else if (matchStart >= segmentEnd) {
                    side = 'after';
                    distance = matchStart - segmentEnd;
                } else {
                    continue;
                }

                // --- COMPUTE STRENGTH ---
                const textBefore = text.slice(Math.max(0, matchStart - 30), matchStart);
                const preMatch = textBefore.match(/\b([a-zA-Z]+)\b\s*$/);
                const preWord = preMatch ? preMatch[1].toLowerCase() : '';

                const textAfter = text.slice(matchEnd, Math.min(text.length, matchEnd + 40));
                const postMatch = textAfter.match(/^\s*([a-zA-Z]+)\b/);
                const postWord = postMatch ? postMatch[1].toLowerCase() : '';

                const hasPostColon = /^\s*:/.test(textAfter);

                const isRightBeforeQuote = (matchEnd <= segmentStart) && (segmentStart - matchEnd <= 6) && /^[ \t\r\n:,-]*$/.test(text.slice(matchEnd, segmentStart));
                const isRightAfterQuote = (matchStart >= segmentEnd) && (matchStart - segmentEnd <= 6) && /^[ \t\r\n:,-]*$/.test(text.slice(segmentEnd, matchStart));

                const endsWithPossessive = match[0].endsWith("'s") || match[0].endsWith("'S") || match[0].endsWith("'");
                const isPassivePreposition = passivePrepositions.has(preWord);

                const isPostWordSpeakingVerb = speakingVerbs.has(postWord);
                const isPreWordSpeakingVerb = speakingVerbs.has(preWord);

                const isStrongTag = isRightBeforeQuote || isPostWordSpeakingVerb || isPreWordSpeakingVerb || hasPostColon || (isRightAfterQuote && isPostWordSpeakingVerb);

                let strength = 2; // Moderate (subject of sentence/action)
                if (isStrongTag) {
                    strength = 3; // Strongest (explicit speaking)
                } else if (endsWithPossessive || isPassivePreposition) {
                    strength = 1; // Weak (passive mention or possessive)
                }

                const candidate = { assignment, distance, side, strength };
                if (isBetterSpeakerCandidate(candidate, best)) best = candidate;
            }
        }

        if (best && best.strength <= 1 && defaultSpeaker) {
            return null;
        }

        return best?.assignment || null;
    }

    function ensureCharacterEntry(name, color) {
        const trimmedName = String(name ?? '').trim();
        if (!trimmedName) return { key: '', entry: null, created: false };
        const existingKey = resolveCharacterKeyByNameOrAlias(trimmedName);
        if (existingKey) return { key: existingKey, entry: characterColors[existingKey], created: false };
        const key = trimmedName.toLowerCase();
        if (characterColors[key]) return { key, entry: characterColors[key], created: false };
        const built = buildCharacterEntry(trimmedName, {
            color,
            colorMode: 'base',
            locked: false,
            dialogueCount: 0
        });
        if (!built.entry) return { key, entry: null, created: false };
        characterColors[key] = built.entry;
        return { key, entry: characterColors[key], created: true };
    }

    function attributeDialogueSegments(rawText, messageSpeakerName = '', options = {}) {
        const result = { segments: [], hadDialogueMatches: false, hadResolvableSpeaker: false, createdCharacters: false, usedAssignments: [] };
        const dialogueRegex = buildDialogueRegex();
        if (!dialogueRegex) return result;

        const raw = String(rawText ?? '');
        const localAssignments = parseNamedColorAssignmentsFromText(raw);
        const lookup = buildNameColorLookup(localAssignments);
        const sortedLookupKeys = Array.from(lookup.keys())
            .filter(key => !isCompositeSpeakerLabel(lookup.get(key)?.name || key))
            .sort((left, right) => right.length - left.length);
        const trimmedSpeakerName = String(messageSpeakerName ?? '').trim();
        let defaultSpeaker = resolveSingleSpeakerAssignment(trimmedSpeakerName, lookup);

        if (!defaultSpeaker && localAssignments.length === 1) {
            defaultSpeaker = resolveSingleSpeakerAssignment(localAssignments[0].name, lookup);
        }

        const ensureDefaultSpeaker = () => {
            if (defaultSpeaker || !options.autoAddMessageSpeaker || !trimmedSpeakerName || isCompositeSpeakerLabel(trimmedSpeakerName)) return defaultSpeaker;
            const ensured = ensureCharacterEntry(trimmedSpeakerName);
            if (!ensured?.entry) return null;
            if (ensured.created) result.createdCharacters = true;
            registerLookupAssignment(lookup, ensured.entry.name, getEntryEffectiveColor(ensured.entry), ensured.entry.aliases, false, ensured.entry.font);
            defaultSpeaker = lookup.get(trimmedSpeakerName.toLowerCase()) || lookup.get(ensured.key) || null;
            if (defaultSpeaker && !sortedLookupKeys.includes(ensured.key)) {
                sortedLookupKeys.push(ensured.key);
                sortedLookupKeys.sort((left, right) => right.length - left.length);
            }
            return defaultSpeaker;
        };

        const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : null;
        const usedCanonicalKeys = new Set();
        const recentSpeakerKeys = defaultSpeaker?.key ? [defaultSpeaker.key] : [];
        let lastResolvedSpeakerKey = '';
        let segmentIndex = -1;
        let match;
        const collectedSegments = [];
        dialogueRegex.lastIndex = 0;

        while ((match = dialogueRegex.exec(raw)) !== null) {
            result.hadDialogueMatches = true;
            segmentIndex++;
            const offset = match.index;
            const matchText = match[0];
            collectedSegments.push({
                index: segmentIndex,
                start: offset,
                end: offset + matchText.length,
                text: matchText,
                delimiter: matchText.charAt(0),
                paragraph: getDialogueParagraphRange(raw, offset, offset + matchText.length),
            });
        }

        const maskedText = buildMaskedDialogueText(raw, collectedSegments);
        const rememberSpeaker = assignment => {
            if (!assignment?.key) return;
            const lastKey = recentSpeakerKeys[recentSpeakerKeys.length - 1];
            if (lastKey !== assignment.key) recentSpeakerKeys.push(assignment.key);
            while (recentSpeakerKeys.length > 2) recentSpeakerKeys.shift();
        };
        const getAlternatingAssignment = () => {
            if (!lastResolvedSpeakerKey) return null;
            for (let i = recentSpeakerKeys.length - 2; i >= 0; i--) {
                const key = recentSpeakerKeys[i];
                if (key && key !== lastResolvedSpeakerKey) return lookup.get(key) || null;
            }
            if (defaultSpeaker?.key && defaultSpeaker.key !== lastResolvedSpeakerKey) return defaultSpeaker;
            return null;
        };
        let previousParagraph = null;

        // Determine if we are attributing the active streaming message to check/save cached assignments
        let isStreamingMsg = false;
        if (isStreamingGenerationActive && options.mesIndex !== undefined) {
            const chat = getContext()?.chat || [];
            if (options.mesIndex === chat.length - 1) {
                isStreamingMsg = true;
            }
        }

        for (const segment of collectedSegments) {
            const sameParagraphAsPrevious = isSameDialogueParagraph(segment.paragraph, previousParagraph);
            let assignment = null;

            // Tier 1: explicit per-segment override. Manual/verifier overrides
            // must always beat cached streaming heuristics, otherwise a stale
            // cached speaker can make right-click and Verified DOM corrections
            // appear to do nothing on the latest message.
            const overrideName = overrides ? overrides[segment.index] : undefined;
            if (overrideName) {
                assignment = resolveSingleSpeakerAssignment(String(overrideName), lookup);
            }

            if (!assignment && isStreamingMsg && streamingHeuristicCache.has(segment.start)) {
                assignment = streamingHeuristicCache.get(segment.start);
            }

            // Tier 2: masked, paragraph-scoped proximity near the quote.
            if (!assignment) {
                const windowStart = Math.max(segment.paragraph.start, segment.start - 240);
                const windowEnd = Math.min(segment.paragraph.end, segment.end + 120);
                assignment = findClosestMentionedSpeakerInContext(maskedText, windowStart, windowEnd, segment.start, segment.end, lookup, sortedLookupKeys, defaultSpeaker);
            }

            // Tier 3: carry only within the same paragraph/line.
            if (!assignment && sameParagraphAsPrevious && lastResolvedSpeakerKey) {
                assignment = lookup.get(lastResolvedSpeakerKey) || null;
            }

            // Tier 4: alternate speakers across unattributed new paragraphs.
            if (!assignment && !sameParagraphAsPrevious) {
                assignment = getAlternatingAssignment();
            }

            // Tier 5: default message speaker.
            if (!assignment) {
                assignment = defaultSpeaker || ensureDefaultSpeaker();
            }

            if (isStreamingMsg && assignment) {
                streamingHeuristicCache.set(segment.start, assignment);
            }

            if (assignment) {
                result.hadResolvableSpeaker = true;
                lastResolvedSpeakerKey = assignment.key;
                rememberSpeaker(assignment);
                if (!usedCanonicalKeys.has(assignment.key)) {
                    usedCanonicalKeys.add(assignment.key);
                    result.usedAssignments.push({ name: assignment.name, color: assignment.color });
                }
            }

            result.segments.push({
                index: segment.index,
                start: segment.start,
                end: segment.end,
                text: segment.text,
                delimiter: segment.delimiter,
                assignment: assignment ? { key: assignment.key, name: assignment.name, color: assignment.color, font: assignment.font } : null
            });
            previousParagraph = segment.paragraph;
        }

        return result;
    }

    function colorizeMessageText(rawText, messageSpeakerName = '', options = {}) {
        const { segments, hadDialogueMatches, hadResolvableSpeaker, createdCharacters, usedAssignments } = attributeDialogueSegments(rawText, messageSpeakerName, options);

        let updatedText = rawText;
        for (let i = segments.length - 1; i >= 0; i--) {
            const seg = segments[i];
            if (!seg.assignment) continue;
            updatedText = `${updatedText.slice(0, seg.start)}<font color="${seg.assignment.color}">${seg.text}</font>${updatedText.slice(seg.end)}`;
        }

        let finalText = updatedText;
        if (updatedText !== rawText && usedAssignments.length && !/\[COLORS?:([^\]]*)\]/i.test(finalText)) {
            finalText += `\n[COLORS:${usedAssignments.map(({ name, color }) => formatColorBlockPair(name, color)).filter(Boolean).join(',')}]`;
        }

        return {
            updatedText: finalText,
            changed: finalText !== rawText,
            hadDialogueMatches,
            hadResolvableSpeaker,
            createdCharacters,
            usedAssignments
        };
    }

    // ===== DOM coloring engine (non-destructive) =====
    const OVERRIDES_METADATA_KEY = 'dialogue_colors_overrides';
    let decorateAllTimer = null;
    let decorateLastTimer = null;
    let customFontRefreshTimer = null;
    let isDecoratingDom = false;
    let decorateAllFirstCallTime = 0;
    let decorateLastFirstCallTime = 0;
    let observedDecorationFirstCallTime = 0;
    const DECORATE_ALL_MAX_WAIT = 500;
    const DECORATE_LAST_MAX_WAIT = 250;
    const OBSERVED_DECORATION_MAX_WAIT = 250;
    const DOM_SETTLE_REFRESH_DELAYS = [0, 120, 350, 900, 1800, 3000];
    const DOM_RETRY_REFRESH_DELAYS = [120, 350, 900, 1800, 3000];
    const DOM_HEALTH_CHECK_INTERVAL_MS = 1500;
    const DOM_HEALTH_CHECK_VISIBLE_LIMIT = 40;
    const POST_MUTATION_DOM_REPAIR_DELAY_MS = 700;
    const UPDATE_MESSAGE_BLOCK_TIMEOUT_MS = 1500;
    let pendingDeferredMutations = false;
    const MESSAGE_EDIT_TEXTAREA_SELECTOR = '#curEditTextarea, .edit_textarea, .reasoning_edit_textarea';

    function getEditingMessageElement(mesElement, mesIndex) {
        const resolvedElement = mesElement || (Number.isFinite(Number(mesIndex)) ? getMessageElementByIndex(mesIndex) : null);
        if (!resolvedElement) return null;
        const editTextarea = resolvedElement.matches?.(MESSAGE_EDIT_TEXTAREA_SELECTOR)
            ? resolvedElement
            : resolvedElement.querySelector?.(MESSAGE_EDIT_TEXTAREA_SELECTOR);
        return editTextarea?.closest?.('.mes[mesid]') || null;
    }

    function suspendMessageDomWorkForEdit(mesElement, mesIndex) {
        const editingMesElement = getEditingMessageElement(mesElement, mesIndex);
        if (!editingMesElement) return false;
        const requestedIndex = Number(mesIndex);
        const index = Number.isFinite(requestedIndex) ? requestedIndex : Number(editingMesElement.getAttribute?.('mesid'));
        if (Number.isFinite(index) && index >= 0) {
            clearMessageDomRepairTimer(index);
            cancelMessageDomFollowupRepairs(index);
        }
        runtimeState.pendingObservedMessages?.delete?.(editingMesElement);
        clearMessageObservers(editingMesElement);
        return true;
    }

    function getElementPath(root, element) {
        if (!root || !element) return null;
        const path = [];
        let current = element;
        while (current && current !== root) {
            const parent = current.parentElement;
            if (!parent) return null;
            const index = Array.prototype.indexOf.call(parent.children, current);
            if (index < 0) return null;
            path.unshift(index);
            current = parent;
        }
        return current === root ? path : null;
    }

    function getElementByPath(root, path) {
        if (!root || !Array.isArray(path)) return null;
        let current = root;
        for (const index of path) {
            current = current?.children?.[index];
            if (!current) return null;
        }
        return current;
    }

    function captureOpenDetailsState(root) {
        if (!root?.querySelectorAll) return null;
        const allDetails = Array.from(root.querySelectorAll('details'));
        const detailsState = allDetails.map((detailsElement, index) => ({
            path: getElementPath(root, detailsElement),
            index,
            open: detailsElement.open,
        }));
        return detailsState.length ? detailsState : null;
    }

    function restoreOpenDetailsState(root, state) {
        if (!root || !state?.length) return false;
        const allDetails = Array.from(root.querySelectorAll('details'));
        let restored = false;
        for (const entry of state) {
            let detailsElement = entry?.path ? getElementByPath(root, entry.path) : null;
            if (!detailsElement || detailsElement.tagName !== 'DETAILS') {
                detailsElement = Number.isFinite(entry?.index) ? allDetails[entry.index] : null;
            }
            if (detailsElement?.tagName === 'DETAILS') {
                detailsElement.open = entry.open === true;
                restored = true;
            }
        }
        return restored;
    }

    function getMessageDetailsRoot(mesElement, mesIndex) {
        const resolvedElement = mesElement?.isConnected ? mesElement : getMessageElementByIndex(mesIndex);
        return resolvedElement?.querySelector?.('.mes_text') || null;
    }

    function captureMessageOpenDetailsState(mesElement, mesIndex) {
        return captureOpenDetailsState(getMessageDetailsRoot(mesElement, mesIndex));
    }

    function restoreMessageOpenDetailsState(mesElement, mesIndex, state) {
        return restoreOpenDetailsState(getMessageDetailsRoot(mesElement, mesIndex), state);
    }

    function hashMessageText(text) {
        const str = String(text ?? '');
        let hash = 5381;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        return hash.toString(36);
    }

    function getChatMetadataStore() {
        const ctx = getContext();
        const metadata = ctx?.chatMetadata || ctx?.chat_metadata;
        return isPlainObject(metadata) ? metadata : null;
    }

    function saveChatMetadata() {
        const ctx = getContext();
        if (typeof ctx?.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx?.saveMetadata === 'function') ctx.saveMetadata();
    }

    function getQuoteOverridesMap(create = false) {
        const metadata = getChatMetadataStore();
        if (!metadata) return null;
        if (!isPlainObject(metadata[OVERRIDES_METADATA_KEY])) {
            if (!create) return null;
            metadata[OVERRIDES_METADATA_KEY] = {};
        }
        return metadata[OVERRIDES_METADATA_KEY];
    }

    function getMessageQuoteOverrides(mesIndex, msg) {
        const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
        return entry?.segments || null;
    }

    function getStreamingAttributionMessageId(msg, mesIndex) {
        return String(msg?.id ?? msg?.send_date ?? mesIndex ?? '');
    }

    function getStreamingAttributionOverrideEntry(mesIndex, msg, create = false) {
        const key = String(mesIndex);
        const messageId = getStreamingAttributionMessageId(msg, mesIndex);
        let entry = streamingAttributionOverrides.get(key);
        if (!isPlainObject(entry) || entry.messageId !== messageId) {
            if (!create) return null;
            entry = { messageId, segments: {}, sources: {} };
            streamingAttributionOverrides.set(key, entry);
        }
        if (!isPlainObject(entry.segments)) entry.segments = {};
        if (!isPlainObject(entry.sources)) entry.sources = {};
        return entry;
    }

    function getStreamingAttributionOverrides(mesIndex, msg) {
        const entry = getStreamingAttributionOverrideEntry(mesIndex, msg, false);
        return entry?.segments || null;
    }

    function getMessageQuoteOverridesForDecoration(mesIndex, msg) {
        const persisted = getMessageQuoteOverrides(mesIndex, msg);
        const streaming = getStreamingAttributionOverrides(mesIndex, msg);
        if (!persisted) return streaming;
        if (!streaming) return persisted;
        return { ...streaming, ...persisted };
    }

    function hasMessageQuoteOverridesForDecoration(mesIndex, msg) {
        const overrides = getMessageQuoteOverridesForDecoration(mesIndex, msg);
        return !!overrides && Object.keys(overrides).length > 0;
    }

    function setStreamingAttributionOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
        const entry = getStreamingAttributionOverrideEntry(mesIndex, msg, true);
        if (!entry) return false;
        entry.segments[String(segmentIndex)] = String(speakerName);
        entry.sources[String(segmentIndex)] = options.source || 'llm';
        streamingHeuristicCache.clear();
        return true;
    }

    function clearStreamingAttributionOverrides(mesIndex = null) {
        if (mesIndex === null || mesIndex === undefined) streamingAttributionOverrides.clear();
        else streamingAttributionOverrides.delete(String(mesIndex));
    }

    function hasMessageQuoteOverridesForLatestMessage() {
        const chat = getContext()?.chat || [];
        const mesIndex = chat.length - 1;
        if (mesIndex < 0) return false;
        return hasMessageQuoteOverridesForDecoration(mesIndex, chat[mesIndex]);
    }

    function getMessageQuoteOverrideEntry(mesIndex, msg, create = false) {
        const map = getQuoteOverridesMap(create);
        if (!map) return null;
        const key = String(mesIndex);
        const hash = hashMessageText(msg?.mes);
        let entry = map[key];
        if (!isPlainObject(entry) || entry.hash !== hash) {
            if (!create) return null;
            entry = { hash, segments: {} };
            map[key] = entry;
        }
        if (!isPlainObject(entry.segments)) {
            if (!create) return null;
            entry.segments = {};
        }
        return entry;
    }

    function setMessageQuoteOverride(mesIndex, msg, segmentIndex, speakerName, options = {}) {
        const entry = getMessageQuoteOverrideEntry(mesIndex, msg, true);
        if (!entry) return false;
        entry.segments[String(segmentIndex)] = String(speakerName);
        if (!isPlainObject(entry.sources)) entry.sources = {};
        entry.sources[String(segmentIndex)] = options.source || 'manual';
        streamingHeuristicCache.clear();
        // A manual override means the LLM-verified state is no longer authoritative.
        delete entry.verifiedHash;
        delete entry.verifiedAt;
        delete entry.verifiedVersion;
        saveChatMetadata();
        return true;
    }

    function markMessageAttributionVerified(mesIndex, msg) {
        const entry = getMessageQuoteOverrideEntry(mesIndex, msg, true);
        if (!entry) return false;
        entry.verifiedHash = hashMessageText(msg?.mes);
        entry.verifiedAt = Date.now();
        entry.verifiedVersion = ATTRIBUTION_VERIFIER_VERSION;
        saveChatMetadata();
        return true;
    }

    function isMessageAttributionVerified(mesIndex, msg) {
        const entry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
        const hash = hashMessageText(msg?.mes);
        return !!entry && entry.hash === hash && entry.verifiedHash === hash && entry.verifiedVersion === ATTRIBUTION_VERIFIER_VERSION;
    }

    function getMessageIndexFromElement(el) {
        const mesEl = el?.closest?.('.mes');
        if (!mesEl) return -1;
        const mesId = Number(mesEl.getAttribute('mesid'));
        if (Number.isFinite(mesId) && mesId >= 0) return mesId;
        return Array.from(document.querySelectorAll('.mes')).indexOf(mesEl);
    }

    function refreshDomDialogueCounts(chat = getContext()?.chat || []) {
        const nextCounts = {};
        let createdCharacters = false;

        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || msg.is_system || !msg.mes || collectFontColorsFromText(msg.mes).size) continue;
            const attribution = attributeDialogueSegments(msg.mes, msg.name, {
                autoAddMessageSpeaker: true,
                overrides: getMessageQuoteOverrides(i, msg),
                mesIndex: i,
            });
            if (attribution.createdCharacters) createdCharacters = true;
            for (const seg of attribution.segments) {
                const key = seg.assignment?.key;
                if (!key || !characterColors[key]) continue;
                nextCounts[key] = (nextCounts[key] || 0) + 1;
            }
        }

        let changed = createdCharacters;
        for (const [key, entry] of Object.entries(characterColors)) {
            const nextCount = nextCounts[key] || 0;
            if ((entry.dialogueCount || 0) !== nextCount) {
                entry.dialogueCount = nextCount;
                changed = true;
            }
        }

        return { changed, createdCharacters };
    }

    function normalizeSegmentText(text) {
        return String(text ?? '')
            .replace(/[\u201c\u201d\u00ab\u00bb\u201e]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/\u2026/g, '...')
            .replace(/[*_`~]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function matchSegmentsToElements(segments, elements, getTargetText, onMatch) {
        let elementIndex = 0;
        for (const seg of segments) {
            if (elementIndex >= elements.length) break;
            const target = getTargetText(seg);
            if (!target) continue;
            let foundIndex = -1;
            for (let i = elementIndex; i < elements.length; i++) {
                if (normalizeSegmentText(elements[i].textContent) === target) {
                    foundIndex = i;
                    break;
                }
            }
            if (foundIndex === -1) continue;
            onMatch(seg, elements[foundIndex]);
            elementIndex = foundIndex + 1;
        }
    }

    function resolveDomSegmentIndexForElement(segmentEl, mesIndex, msg) {
        if (!segmentEl || !msg) return NaN;
        if (segmentEl.hasAttribute?.('data-dc-seg')) {
            const directIndex = Number(segmentEl.getAttribute('data-dc-seg'));
            if (Number.isFinite(directIndex)) return directIndex;
        }

        const mesText = segmentEl.closest?.('.mes_text');
        if (!mesText) return NaN;

        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            autoAddMessageSpeaker: true,
            overrides: getMessageQuoteOverridesForDecoration(mesIndex, msg),
            mesIndex,
        });

        const isThoughtElement = segmentEl.matches?.('em');
        const segments = attribution.segments.filter(seg => isThoughtElement
            ? (seg.delimiter === '*' || seg.delimiter === '_')
            : (seg.delimiter !== '*' && seg.delimiter !== '_'));
        const elements = Array.from(mesText.querySelectorAll(isThoughtElement ? 'em' : 'q'));
        let resolvedIndex = NaN;

        matchSegmentsToElements(
            segments,
            elements,
            seg => isThoughtElement ? normalizeSegmentText(seg.text.slice(1, -1)) : normalizeSegmentText(seg.text),
            (seg, el) => {
                if (el === segmentEl) resolvedIndex = seg.index;
            }
        );
        if (Number.isFinite(resolvedIndex)) return resolvedIndex;

        // If SillyTavern's rendered text differs slightly from msg.mes, fall back
        // to ordinal mapping so manual DOM overrides can still recover coloring.
        const ordinal = elements.indexOf(segmentEl);
        return ordinal >= 0 && segments[ordinal] ? segments[ordinal].index : NaN;
    }

    function clearCustomFontTag(fontEl) {
        if (!fontEl?.hasAttribute?.('data-dc-font')) return false;
        fontEl.style.fontFamily = '';
        if (!fontEl.getAttribute('style')) fontEl.removeAttribute('style');
        fontEl.removeAttribute('data-dc-font');
        return true;
    }

    function clearCustomFontsFromFontTags(root = document) {
        let changed = false;
        root?.querySelectorAll?.('font[data-dc-font]').forEach(fontEl => {
            if (clearCustomFontTag(fontEl)) changed = true;
        });
        return changed;
    }

    function applyCustomFontsToFontTags(mesText, rawText = '') {
        const fontTags = Array.from(mesText?.querySelectorAll?.('font[color]') || []);
        if (!fontTags.length) return false;
        const fontByColor = buildColorFontLookup(rawText);
        let changed = false;
        for (const fontEl of fontTags) {
            const color = normalizeHexColor(fontEl.getAttribute('color'), null);
            const font = color ? fontByColor.get(color) : '';
            const family = getGoogleFontFamily(font);
            if (family) {
                loadGoogleFont(font);
                if (fontEl.style.fontFamily !== family) {
                    fontEl.style.fontFamily = family;
                    changed = true;
                }
                if (!fontEl.hasAttribute('data-dc-font')) {
                    fontEl.setAttribute('data-dc-font', '1');
                    changed = true;
                }
            } else if (clearCustomFontTag(fontEl)) {
                changed = true;
            }
        }
        return changed;
    }

    function applyCustomFontsToMessageElement(mesElement, chat = getContext()?.chat || []) {
        const mesText = mesElement?.querySelector?.('.mes_text');
        if (!mesText) return false;
        if (!settings.enabled) return clearCustomFontsFromFontTags(mesText);
        const mesIndex = Number(mesElement.getAttribute?.('mesid'));
        const msg = Number.isFinite(mesIndex) ? chat[mesIndex] : null;
        if (msg?.is_system) return clearCustomFontsFromFontTags(mesText);
        return applyCustomFontsToFontTags(mesText, msg?.mes || mesText.innerHTML || '');
    }

    function applyCustomFontsToMessageElements(elements) {
        const targets = Array.from(new Set(Array.from(elements || []).filter(Boolean)));
        if (!targets.length) return false;
        const chat = getContext()?.chat || [];
        let changed = false;
        for (const mesElement of targets) {
            if (applyCustomFontsToMessageElement(mesElement, chat)) changed = true;
        }
        return changed;
    }

    function applyCustomFontsToRenderedMessages() {
        return applyCustomFontsToMessageElements(document.querySelectorAll('#chat .mes[mesid]'));
    }

    let cardStyleTimer = null;
    function scheduleCardStyle(delay = 50) {
        if (cardStyleTimer) clearTimeout(cardStyleTimer);
        cardStyleTimer = setTimeout(() => {
            cardStyleTimer = null;
            styleAllCharacterCards();
        }, Math.max(0, Number(delay) || 0));
    }

    function clearSingleCharacterCardStyles(card) {
        if (card.hasAttribute('data-dc-card-styled')) {
            const nameEl = card.querySelector('.ch_name');
            if (nameEl) {
                nameEl.style.color = '';
                nameEl.style.fontFamily = '';
            }
            const avatarImg = card.querySelector('.avatar img');
            if (avatarImg) {
                avatarImg.style.boxShadow = '';
                avatarImg.style.borderColor = '';
            }
            card.removeAttribute('data-dc-card-styled');
        }
    }

    function clearAllCharacterCardStyles() {
        const cards = document.querySelectorAll('[data-dc-card-styled]');
        cards.forEach(card => clearSingleCharacterCardStyles(card));
    }

    function styleAllCharacterCards() {
        if (!settings.enabled) {
            clearAllCharacterCardStyles();
            return;
        }
        const cards = document.querySelectorAll('.group_member, .character_select');
        cards.forEach(card => {
            const nameEl = card.querySelector('.ch_name');
            if (!nameEl) return;
            const name = nameEl.textContent.trim();
            if (!name) return;
            const key = resolveCharacterKeyByNameOrAlias(name);
            if (key && characterColors[key]) {
                const entry = characterColors[key];
                const color = getEntryEffectiveColor(entry);
                
                // Apply name color
                nameEl.style.color = color;
                
                // Apply custom font if set
                if (entry.font) {
                    loadGoogleFont(entry.font);
                    nameEl.style.fontFamily = getGoogleFontFamily(entry.font);
                } else {
                    nameEl.style.fontFamily = '';
                }
                
                // Apply avatar border and shadow ring
                const avatarImg = card.querySelector('.avatar img');
                if (avatarImg) {
                    avatarImg.style.borderColor = color;
                    avatarImg.style.boxShadow = `0 0 6px ${color}`;
                }
                
                // Mark with a data attribute so we know it's styled by us
                card.setAttribute('data-dc-card-styled', 'true');
            } else {
                // If it was styled before but no longer has a color, clear it!
                clearSingleCharacterCardStyles(card);
            }
        });
    }

    function scheduleCustomFontRefresh(delay = 0) {
        clearTimeout(customFontRefreshTimer);
        customFontRefreshTimer = setTimeout(() => {
            customFontRefreshTimer = null;
            applyCustomFontsToRenderedMessages();
            scheduleCardStyle(0);
        }, Math.max(0, Number(delay) || 0));
    }

    function clearSegmentDecoration(el) {
        el.style.color = '';
        el.style.backgroundColor = '';
        el.style.fontFamily = '';
        if (!el.getAttribute('style')) el.removeAttribute('style');
        el.removeAttribute('data-dc-colored');
        el.removeAttribute('data-dc-speaker');
        el.removeAttribute('data-dc-font');
        el.removeAttribute('data-dc-seg');
    }

    function undecorateMessageDom(mesElement, options = {}) {
        const mesText = mesElement?.querySelector?.('.mes_text');
        if (mesText) {
            mesText.querySelectorAll('[data-dc-colored], [data-dc-seg]').forEach(clearSegmentDecoration);
            clearCustomFontsFromFontTags(mesText);
            if (mesText.hasAttribute('data-dc-narrator')) {
                mesText.style.color = '';
                if (!mesText.getAttribute('style')) mesText.removeAttribute('style');
                mesText.removeAttribute('data-dc-narrator');
            }
        }
        // Tear down the external-rebuild watcher so it doesn't re-decorate
        // a message we've intentionally undecorated.
        if (options.clearWatcher !== false) clearDecoratedWatcher(mesElement);
    }

    function decorateMessageDom(mesElement, msg, mesIndex) {
        const mesText = mesElement?.querySelector?.('.mes_text');
        if (!mesText) return { decorated: false, createdCharacters: false, needsRetry: !!msg && !msg.is_system };
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return { decorated: false, createdCharacters: false, needsRetry: false };
        undecorateMessageDom(mesElement, { clearWatcher: false });
        if (!settings.enabled || !msg || msg.is_system) {
            return { decorated: false, createdCharacters: false };
        }
        const hasPersistedFontColors = mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size;
        if (hasPersistedFontColors) {
            applyCustomFontsToFontTags(mesText, msg.mes);
            clearDecoratedWatcher(mesElement);
            return { decorated: false, createdCharacters: false };
        }
        if (!isDomEngine()) {
            return { decorated: false, createdCharacters: false };
        }

        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            autoAddMessageSpeaker: true,
            overrides: getMessageQuoteOverridesForDecoration(mesIndex, msg),
            mesIndex: mesIndex,
        });

        let decorated = false;
        const applyDecoration = (seg, el) => {
            el.setAttribute('data-dc-seg', String(seg.index));
            if (!seg.assignment) return;
            el.style.color = seg.assignment.color;
            const family = getGoogleFontFamily(seg.assignment.font);
            if (family) {
                loadGoogleFont(seg.assignment.font);
                el.style.fontFamily = family;
                el.setAttribute('data-dc-font', '1');
            }
            if (settings.highlightMode) el.style.backgroundColor = `${seg.assignment.color}26`;
            el.setAttribute('data-dc-colored', '1');
            el.setAttribute('data-dc-speaker', seg.assignment.key);
            decorated = true;
        };

        const quoteSegments = attribution.segments.filter(seg => seg.delimiter !== '*' && seg.delimiter !== '_');
        const emphasisSegments = attribution.segments.filter(seg => seg.delimiter === '*' || seg.delimiter === '_');
        const qElements = Array.from(mesText.querySelectorAll('q'));
        const emElements = Array.from(mesText.querySelectorAll('em'));
        const expectedDecorations = quoteSegments.filter(seg => seg.assignment).length + emphasisSegments.filter(seg => seg.assignment).length;
        let matchedDecorations = 0;

        matchSegmentsToElements(quoteSegments, qElements, seg => normalizeSegmentText(seg.text), applyDecoration);
        matchSegmentsToElements(emphasisSegments, emElements, seg => normalizeSegmentText(seg.text.slice(1, -1)), applyDecoration);
        matchedDecorations = mesText.querySelectorAll('[data-dc-colored]').length;

        if (!settings.disableNarration && settings.narratorColor) {
            mesText.style.color = settings.narratorColor;
            mesText.setAttribute('data-dc-narrator', '1');
        }

        return {
            decorated,
            createdCharacters: attribution.createdCharacters,
            segments: attribution.segments,
            needsRetry: expectedDecorations > matchedDecorations,
        };
    }

    function undecorateAllMessages() {
        document.querySelectorAll('#chat .mes[mesid]').forEach(undecorateMessageDom);
    }

    function clearDomSettleRefreshes() {
        for (const [key, { observer, fallbackTimer }] of runtimeState.messageSettleObservers.entries()) {
            if (typeof key !== 'string' || !key.startsWith('__settle_fallback_')) continue;
            try { observer.disconnect(); } catch (_) { /* ignored */ }
            clearTimeout(fallbackTimer);
            runtimeState.messageSettleObservers.delete(key);
        }
    }

    // Disconnect every long-lived "decorated message" watcher. Called on chat
    // change and when DOM decoration is disabled wholesale.
    function clearDecoratedWatchers() {
        for (const { observer } of runtimeState.decoratedWatchers.values()) {
            try { observer.disconnect(); } catch (_) { /* ignored */ }
        }
        runtimeState.decoratedWatchers.clear();
    }

    // Disconnect the long-lived decorated watcher for a single .mes element.
    function clearDecoratedWatcher(mesElement) {
        const watcher = runtimeState.decoratedWatchers.get(mesElement);
        if (watcher) {
            try { watcher.observer.disconnect(); } catch (_) { /* ignored */ }
            runtimeState.decoratedWatchers.delete(mesElement);
        }
    }

    // Tear down per-element observers (both the settle observer and the
    // long-lived decorated watcher) for a single .mes element.
    function clearMessageObservers(mesElement) {
        const settle = runtimeState.messageSettleObservers.get(mesElement);
        if (settle) {
            try { settle.observer.disconnect(); } catch (_) { /* ignored */ }
            clearTimeout(settle.fallbackTimer);
            settle.retryTimers?.forEach?.(clearTimeout);
            runtimeState.messageSettleObservers.delete(mesElement);
        }
        const watcher = runtimeState.decoratedWatchers.get(mesElement);
        if (watcher) {
            try { watcher.observer.disconnect(); } catch (_) { /* ignored */ }
            runtimeState.decoratedWatchers.delete(mesElement);
        }
    }

    // Maximum time to wait for a message's DOM to settle before giving up.
    const MESSAGE_SETTLE_MAX_WAIT_MS = 3000;

    /**
     * Attach a self-terminating MutationObserver to a single .mes element.
     * Re-tries decoration whenever child nodes are added or removed inside the
     * message element. Disconnects as soon as decoration succeeds (no
     * needsRetry) or after MESSAGE_SETTLE_MAX_WAIT_MS, whichever comes first.
     */
    function attachMessageSettleObserver(mesElement, mesIndex) {
        if (!mesElement?.isConnected) return;
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
        // Remove any existing watcher for this element.
        const existing = runtimeState.messageSettleObservers.get(mesElement);
        if (existing) {
            try { existing.observer.disconnect(); } catch (_) { /* ignored */ }
            clearTimeout(existing.fallbackTimer);
            existing.retryTimers?.forEach?.(clearTimeout);
            runtimeState.messageSettleObservers.delete(mesElement);
        }

        let retryTimers = [];

        const attempt = () => {
            if (!mesElement.isConnected || !settings.enabled || !isDomEngine()) {
                cleanup();
                return;
            }
            const msg = getContext()?.chat?.[mesIndex];
            if (!msg) { cleanup(); return; }
            if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) { cleanup(); return; }
            const result = decorateMessageDom(mesElement, msg, mesIndex);
            if (result.createdCharacters) {
                queueColorStateSave({ history: false, injectPrompt: false });
            }
            updateLegend();
            if (!result.needsRetry) {
                cleanup();
                // Decoration succeeded: arm the long-lived watcher so a later
                // external re-render (e.g. Prose Polisher) re-decorates.
                if (result.decorated) watchDecoratedMessage(mesElement, mesIndex);
            }
        };

        const cleanup = () => {
            const entry = runtimeState.messageSettleObservers.get(mesElement);
            if (!entry) return;
            try { entry.observer.disconnect(); } catch (_) { /* ignored */ }
            clearTimeout(entry.fallbackTimer);
            entry.retryTimers?.forEach?.(clearTimeout);
            runtimeState.messageSettleObservers.delete(mesElement);
        };

        const observer = new MutationObserver(() => attempt());
        observer.observe(mesElement, { childList: true, subtree: true });

        retryTimers = DOM_RETRY_REFRESH_DELAYS
            .filter(delay => Number(delay) > 0 && Number(delay) < MESSAGE_SETTLE_MAX_WAIT_MS)
            .map(delay => setTimeout(() => attempt(), Number(delay)));

        const fallbackTimer = setTimeout(() => {
            cleanup();
        }, MESSAGE_SETTLE_MAX_WAIT_MS);

        runtimeState.messageSettleObservers.set(mesElement, { observer, fallbackTimer, retryTimers });
    }

    /**
     * Attach a long-lived MutationObserver that watches for external re-renders
     * of an already-decorated message (e.g. a post-gen agent editing msg.mes and
     * calling updateMessageBlock(), which rebuilds .mes_text innerHTML, wiping DC
     * inline styles). When .mes_text childList changes and all data-dc-colored
     * elements have disappeared, we trigger attachMessageSettleObserver so
     * decoration is re-applied once <q>/<em> elements re-appear.
     *
     * Unlike attachMessageSettleObserver (which is self-terminating), this watcher
     * lives for the lifetime of the decorated message and is only torn down when
     * the message is undecorated or the chat changes.
     *
     * DC's own decoration only writes style/attributes (not childList mutations),
     * so this observer will not self-trigger on our own changes.
     */
    function watchDecoratedMessage(mesElement, mesIndex) {
        if (!mesElement?.isConnected) return;
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
        // Tear down any existing watcher for this element first.
        clearDecoratedWatcher(mesElement);

        const initialMesText = mesElement.querySelector('.mes_text');
        if (!initialMesText) return;

        const observer = new MutationObserver(() => {
            if (!mesElement.isConnected || !settings.enabled || !isDomEngine()) {
                clearDecoratedWatcher(mesElement);
                return;
            }
            if (isDecoratingDom) return;
            const repairIndex = Number(mesIndex);
            if (runtimeState.messageDomRepairTimers.has(repairIndex)) return;
            if (suspendMessageDomWorkForEdit(mesElement, repairIndex)) return;
            // Re-query .mes_text: external agents may replace the node entirely.
            const currentMesText = mesElement.querySelector('.mes_text');
            if (!currentMesText || !currentMesText.isConnected) return;
            // Skip messages with LLM-emitted font[color] tags.
            if (currentMesText.querySelector('font[color]')) return;
            // If our decorations are still present, the rebuild didn't wipe them.
            if (currentMesText.querySelector('[data-dc-colored]') || currentMesText.querySelector('[data-dc-narrator]')) return;
            const msg = getContext()?.chat?.[mesIndex];
            if (!msg || msg.is_system) return;
            decorateObservedMessages([mesElement]);
        });

        // Observe mesElement subtree so we catch .mes_text replacement itself.
        observer.observe(mesElement, { childList: true, subtree: true });
        runtimeState.decoratedWatchers.set(mesElement, { observer, mesText: initialMesText });
    }

    function collectDomHealthCheckMessages() {
        const messages = Array.from(document.querySelectorAll('#chat .mes[mesid]'));
        if (messages.length <= DOM_HEALTH_CHECK_VISIBLE_LIMIT) return messages;

        const selected = new Set(messages.slice(-Math.ceil(DOM_HEALTH_CHECK_VISIBLE_LIMIT / 2)));
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 800;
        const minTop = -viewportHeight;
        const maxBottom = viewportHeight * 2;
        for (const mesElement of messages) {
            const rect = mesElement.getBoundingClientRect?.();
            if (!rect) continue;
            if (rect.bottom >= minTop && rect.top <= maxBottom) selected.add(mesElement);
            if (selected.size >= DOM_HEALTH_CHECK_VISIBLE_LIMIT) break;
        }
        return Array.from(selected).slice(0, DOM_HEALTH_CHECK_VISIBLE_LIMIT);
    }

    function getMessageDomHealthRepairType(mesElement, msg, mesIndex) {
        const mesText = mesElement?.querySelector?.('.mes_text');
        if (!mesText || !msg || msg.is_system) return '';
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return '';
        if (mesText.querySelector('font[color]') || collectFontColorsFromText(msg.mes).size) return '';
        const readiness = getMessageDomReadiness(mesElement, msg, mesIndex);
        if (readiness.totalSegments === 0) {
            return !settings.disableNarration && !!settings.narratorColor && !mesText.hasAttribute('data-dc-narrator') ? 'decorate' : '';
        }
        if (!readiness.ready) return 'refresh';
        return readiness.expectedDecorations > readiness.correctDecorations ? 'decorate' : '';
    }

    function runDomHealthCheck() {
        if (!settings.enabled || !isDomEngine()) {
            stopDomHealthCheck();
            return;
        }
        if (isDecoratingDom) return;
        setupChatObserver();

        const chat = getContext()?.chat || [];
        const decorateTargets = new Set();
        for (const [mesElement, watcher] of runtimeState.decoratedWatchers.entries()) {
            const currentMesText = mesElement?.querySelector?.('.mes_text');
            if (!mesElement?.isConnected || !currentMesText?.isConnected) {
                clearDecoratedWatcher(mesElement);
                continue;
            }
            const repairIndex = Number(mesElement.getAttribute('mesid'));
            if (suspendMessageDomWorkForEdit(mesElement, repairIndex)) continue;
            if (watcher?.mesText !== currentMesText) {
                clearDecoratedWatcher(mesElement);
                scheduleMessageDomRepair(repairIndex, { delay: 0, verify: false });
            }
        }

        for (const mesElement of collectDomHealthCheckMessages()) {
            const mesIndex = Number(mesElement.getAttribute('mesid'));
            if (!Number.isFinite(mesIndex) || mesIndex < 0) continue;
            const msg = chat[mesIndex];
            if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
            const repairType = getMessageDomHealthRepairType(mesElement, msg, mesIndex);
            if (repairType === 'refresh') {
                scheduleMessageDomRepair(mesIndex, { delay: 0, verify: false });
                continue;
            }
            if (repairType === 'decorate') {
                decorateTargets.add(mesElement);
                continue;
            }
            const mesText = mesElement.querySelector('.mes_text');
            if (mesText?.querySelector?.('[data-dc-colored], [data-dc-narrator]') && !runtimeState.decoratedWatchers.has(mesElement)) {
                watchDecoratedMessage(mesElement, mesIndex);
            }
        }

        if (decorateTargets.size) decorateObservedMessages(Array.from(decorateTargets));
    }

    function startDomHealthCheck() {
        if (!settings.enabled || !isDomEngine() || runtimeState.domHealthCheckTimer) return;
        runtimeState.domHealthCheckTimer = setInterval(runDomHealthCheck, DOM_HEALTH_CHECK_INTERVAL_MS);
    }

    function stopDomHealthCheck() {
        if (runtimeState.domHealthCheckTimer) {
            clearInterval(runtimeState.domHealthCheckTimer);
            runtimeState.domHealthCheckTimer = null;
        }
        clearMessageDomRepairTimers();
    }

    /**
     * Bounded fallback pass series for races where ST/external agents update
     * msg.mes before the rendered .mes_text has caught up. Per-message observers
     * handle the common path; these delayed passes keep verification/overrides
     * from requiring a full chat reload when the live DOM is briefly stale.
     */
    function scheduleDomSettleRefresh(delays = DOM_RETRY_REFRESH_DELAYS) {
        if (!isDomEngine()) return;
        startDomHealthCheck();
        clearDomSettleRefreshes();
        const refreshDelays = Array.isArray(delays) && delays.length ? delays : [400];
        refreshDelays.forEach((delay, index) => {
            const key = `__settle_fallback_${index}__`;
            const timer = setTimeout(() => {
                runtimeState.messageSettleObservers.delete(key);
                if (!settings.enabled || !isDomEngine()) return;
                setupChatObserver();
                decorateAllMessages();
            }, Math.max(0, Number(delay) || 0));
            runtimeState.messageSettleObservers.set(key, {
                observer: { disconnect: () => {} },
                fallbackTimer: timer,
            });
        });
    }

    function scheduleDomRefreshSeries(delay = 0) {
        startDomHealthCheck();
        scheduleDecorateAll(delay);
    }

    function decorateAllMessages() {
        const previousDecoratingState = isDecoratingDom;
        isDecoratingDom = true;
        try {
            if (!settings.enabled || !isDomEngine()) {
                stopDomHealthCheck();
                undecorateAllMessages();
                return;
            }
            const ctx = getContext();
            const chat = ctx?.chat || [];
            const countResult = refreshDomDialogueCounts(chat);
            let changedColorData = countResult.changed;
            document.querySelectorAll('#chat .mes[mesid]').forEach(mesElement => {
                const mesIndex = Number(mesElement.getAttribute('mesid'));
                const msg = chat[mesIndex];
                if (!msg) return;
                const result = decorateMessageDom(mesElement, msg, mesIndex);
                if (result.createdCharacters) changedColorData = true;
                // If the message's quotes/emphasis have not rendered yet, attach a
                // self-terminating observer that finishes decoration once they appear.
                if (result.needsRetry) {
                    attachMessageSettleObserver(mesElement, mesIndex);
                } else if (result.decorated) {
                    // Fully decorated: watch for external re-renders (e.g. Prose Polisher).
                    watchDecoratedMessage(mesElement, mesIndex);
                }
            });
            if (changedColorData) {
                // Decoration discovered new characters/counts. Persist via the
                // debounced color-state saver instead of a synchronous heavy
                // saveData()+updateCharList() on every render pass.
                queueColorStateSave({ history: false, injectPrompt: false });
            }
            updateLegend();
            queueAutoAttributionVerificationForRenderedMessages();
        } finally {
            isDecoratingDom = previousDecoratingState;
            if (pendingDeferredMutations) {
                pendingDeferredMutations = false;
                scheduleDecorateAll(0);
            }
        }
    }

    function decorateMessageElementByIndex(mesElement, mesIndex) {
        if (!mesElement || !Number.isFinite(mesIndex) || mesIndex < 0) return { decorated: false, createdCharacters: false };
        const msg = getContext()?.chat?.[mesIndex];
        if (!msg) return { decorated: false, createdCharacters: false };
        return decorateMessageDom(mesElement, msg, mesIndex);
    }

    function decorateObservedMessages(elements, options = {}) {
        if (!settings.enabled || !isDomEngine() || !elements?.length) return;
        const previousDecoratingState = isDecoratingDom;
        isDecoratingDom = true;
        let createdCharacters = false;
        const verificationElements = [];
        try {
            for (const mesElement of elements) {
                if (!mesElement?.isConnected) continue;
                const mesIndex = Number(mesElement.getAttribute('mesid'));
                if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
                verificationElements.push(mesElement);
                const result = decorateMessageElementByIndex(mesElement, mesIndex);
                if (result.createdCharacters) createdCharacters = true;
                if (result.needsRetry) {
                    attachMessageSettleObserver(mesElement, mesIndex);
                } else if (result.decorated) {
                    watchDecoratedMessage(mesElement, mesIndex);
                }
            }
        } finally {
            isDecoratingDom = previousDecoratingState;
            if (pendingDeferredMutations) {
                pendingDeferredMutations = false;
                scheduleDecorateAll(0);
            }
        }
        if (createdCharacters) {
            queueColorStateSave({ history: false, injectPrompt: false });
        }
        updateLegend();
        if (options.queueVerification !== false) queueAutoAttributionVerificationForElements(verificationElements);
    }

    function decorateLastMessageDom() {
        if (!settings.enabled || !isDomEngine()) return;
        const messages = document.querySelectorAll('#chat .mes[mesid]');
        const mesElement = messages[messages.length - 1];
        if (!mesElement) return;
        decorateObservedMessages([mesElement]);
    }

    function scheduleDecorateAll(delay = 100) {
        if (!isDomEngine()) return;
        startDomHealthCheck();
        const now = Date.now();
        if (!decorateAllFirstCallTime) decorateAllFirstCallTime = now;
        clearTimeout(decorateAllTimer);
        const effectiveDelay = Math.min(delay, Math.max(0, DECORATE_ALL_MAX_WAIT - (now - decorateAllFirstCallTime)));
        decorateAllTimer = setTimeout(() => {
            decorateAllTimer = null;
            decorateAllFirstCallTime = 0;
            decorateAllMessages();
        }, effectiveDelay);
    }

    function scheduleDecorateLast(delay = 80) {
        if (!settings.enabled || !isDomEngine()) return;
        startDomHealthCheck();
        const now = Date.now();
        if (!decorateLastFirstCallTime) decorateLastFirstCallTime = now;
        clearTimeout(decorateLastTimer);
        const effectiveDelay = Math.min(delay, Math.max(0, DECORATE_LAST_MAX_WAIT - (now - decorateLastFirstCallTime)));
        decorateLastTimer = setTimeout(() => {
            decorateLastTimer = null;
            decorateLastFirstCallTime = 0;
            decorateLastMessageDom();
        }, effectiveDelay);
    }

    function disconnectChatObserver() {
        if (runtimeState.chatObserver) runtimeState.chatObserver.disconnect();
        runtimeState.chatObserver = null;
        runtimeState.chatObserverTarget = null;
        if (runtimeState.chatObserverTimer) clearTimeout(runtimeState.chatObserverTimer);
        runtimeState.chatObserverTimer = null;
        observedDecorationFirstCallTime = 0;
        runtimeState.pendingObservedMessages?.clear?.();
    }

    function queueObservedMessageDecoration(mesElement) {
        if (!mesElement || !settings.enabled || !isDomEngine()) return;
        const mesIndex = Number(mesElement.getAttribute('mesid'));
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return;
        const now = Date.now();
        if (!observedDecorationFirstCallTime) observedDecorationFirstCallTime = now;
        runtimeState.pendingObservedMessages.add(mesElement);
        if (runtimeState.chatObserverTimer) clearTimeout(runtimeState.chatObserverTimer);
        const effectiveDelay = Math.min(80, Math.max(0, OBSERVED_DECORATION_MAX_WAIT - (now - observedDecorationFirstCallTime)));
        runtimeState.chatObserverTimer = setTimeout(() => {
            runtimeState.chatObserverTimer = null;
            observedDecorationFirstCallTime = 0;
            const pending = Array.from(runtimeState.pendingObservedMessages || []);
            runtimeState.pendingObservedMessages.clear();
            decorateObservedMessages(pending);
        }, effectiveDelay);
    }

    function shouldDecorateObservedMessageImmediately(mesElement) {
        if (!mesElement || !settings.enabled || !isDomEngine()) return false;
        const mesIndex = Number(mesElement.getAttribute('mesid'));
        if (!Number.isFinite(mesIndex) || mesIndex < 0) return false;
        if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) return false;
        const msg = getContext()?.chat?.[mesIndex];
        return hasMessageQuoteOverridesForDecoration(mesIndex, msg);
    }

    function collectMutatedMessageElements(mutation) {
        const elements = [];
        const pushMessage = node => {
            if (!node) return;
            const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            const direct = element?.matches?.('.mes[mesid]') ? element : element?.closest?.('.mes[mesid]');
            if (direct) elements.push(direct);
            element?.querySelectorAll?.('.mes[mesid]')?.forEach(mesElement => elements.push(mesElement));
        };
        pushMessage(mutation.target);
        mutation.addedNodes?.forEach(pushMessage);
        return elements;
    }

    function setupChatObserver() {
        const chatEl = document.getElementById('chat');
        if (!chatEl) return;
        if (runtimeState.chatObserver && runtimeState.chatObserverTarget === chatEl) return;
        disconnectChatObserver();
        runtimeState.pendingObservedMessages = new Set();
        runtimeState.chatObserverTarget = chatEl;
        runtimeState.chatObserver = new MutationObserver(mutations => {
            if (!settings.enabled) {
                clearCustomFontsFromFontTags(chatEl);
                return;
            }
            if (isDecoratingDom) { pendingDeferredMutations = true; return; }
            const immediate = new Set();
            const delayed = new Set();
            const fontTargets = new Set();
            for (const mutation of mutations) {
                for (const mesElement of collectMutatedMessageElements(mutation)) {
                    const mesIndex = Number(mesElement?.getAttribute?.('mesid'));
                    if (suspendMessageDomWorkForEdit(mesElement, mesIndex)) continue;
                    fontTargets.add(mesElement);
                    if (!isDomEngine()) continue;
                    if (shouldDecorateObservedMessageImmediately(mesElement)) immediate.add(mesElement);
                    else delayed.add(mesElement);
                }
            }
            if (!isDomEngine()) {
                applyCustomFontsToMessageElements(fontTargets);
                return;
            }
            if (immediate.size) {
                for (const mesElement of immediate) runtimeState.pendingObservedMessages.delete(mesElement);
                decorateObservedMessages(Array.from(immediate));
            }
            for (const mesElement of delayed) queueObservedMessageDecoration(mesElement);
        });
        runtimeState.chatObserver.observe(chatEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'mesid'] });
    }

    function setupChatRootObserver() {
        if (runtimeState.chatRootObserver || !document.body) return;
        const mutationTouchesChatRoot = mutations => {
            if (runtimeState.chatObserverTarget && !runtimeState.chatObserverTarget.isConnected) return true;
            const hasChatNode = node => {
                const element = node?.nodeType === Node.ELEMENT_NODE ? node : null;
                return !!element && (element.id === 'chat' || !!element.querySelector?.('#chat'));
            };
            return mutations.some(mutation => {
                if (mutation.target === runtimeState.chatObserverTarget) return false;
                return Array.from(mutation.addedNodes || []).some(hasChatNode)
                    || Array.from(mutation.removedNodes || []).some(hasChatNode);
            });
        };
        runtimeState.chatRootObserver = new MutationObserver(mutations => {
            scheduleCardStyle(100);
            if (!mutationTouchesChatRoot(mutations)) return;
            if (runtimeState.chatRootObserverTimer) clearTimeout(runtimeState.chatRootObserverTimer);
            runtimeState.chatRootObserverTimer = setTimeout(() => {
                runtimeState.chatRootObserverTimer = null;
                const chatEl = document.getElementById('chat');
                if (!chatEl || runtimeState.chatObserverTarget === chatEl) return;
                setupChatObserver();
                scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
                scheduleCustomFontRefresh(80);
            }, 50);
        });
        runtimeState.chatRootObserver.observe(document.body, { childList: true, subtree: true });
    }

    function isMessageEligibleForAttributionVerification(msg) {
        return !!msg && !msg.is_system && !!msg.mes && !collectFontColorsFromText(msg.mes).size;
    }

    function isAutoAttributionVerificationEnabled() {
        return settings.enabled && isDomEngine() && (settings.llmAttributionCheck || settings.llmAttributionParallel);
    }

    function getAutoAttributionVerifyKey(mesIndex, msg) {
        return `${mesIndex}:${hashMessageText(msg?.mes)}`;
    }

    function getAutoAttributionMessageId(msg) {
        const id = msg?.id ?? msg?.send_date ?? '';
        return id === null || id === undefined ? '' : String(id);
    }

    function pruneRecentAutoAttributionVerifyAttempts(now = Date.now()) {
        const maxAge = AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS * 2;
        for (const [key, timestamp] of recentAutoAttributionVerifyAttempts.entries()) {
            if (now - timestamp > maxAge) recentAutoAttributionVerifyAttempts.delete(key);
        }
    }

    function clearAutoAttributionVerificationQueue(options = {}) {
        clearTimeout(autoAttributionVerifyTimer);
        autoAttributionVerifyTimer = null;
        autoAttributionVerifyTimerDue = 0;
        pendingAutoAttributionVerifyIndices.clear();
        if (options.clearCooldown) recentAutoAttributionVerifyAttempts.clear();
    }

    function shouldQueueAutoAttributionVerification(mesIndex, msg, options = {}) {
        if (!isAutoAttributionVerificationEnabled()) return false;
        if (isStreamingGenerationActive && !options.allowDuringStreaming) return false;
        if (!Number.isFinite(mesIndex) || mesIndex < 0) return false;
        if (suspendMessageDomWorkForEdit(getMessageElementByIndex(mesIndex), mesIndex)) return false;
        if (!isMessageEligibleForAttributionVerification(msg) || isMessageAttributionVerified(mesIndex, msg)) return false;

        if (!options.force) {
            const key = getAutoAttributionVerifyKey(mesIndex, msg);
            const lastAttempt = recentAutoAttributionVerifyAttempts.get(key) || 0;
            if (Date.now() - lastAttempt < AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS) return false;
        }
        return true;
    }

    function scheduleAutoAttributionVerificationDrain(delay = AUTO_ATTRIBUTION_VERIFY_DELAY_MS) {
        if (!isAutoAttributionVerificationEnabled() || !pendingAutoAttributionVerifyIndices.size) return;
        const nextDue = Date.now() + Math.max(0, delay);
        if (autoAttributionVerifyTimer && autoAttributionVerifyTimerDue <= nextDue) return;
        clearTimeout(autoAttributionVerifyTimer);
        autoAttributionVerifyTimerDue = nextDue;
        autoAttributionVerifyTimer = setTimeout(() => {
            autoAttributionVerifyTimer = null;
            autoAttributionVerifyTimerDue = 0;
            drainAutoAttributionVerificationQueue()
                .catch(e => console.warn('[Dialogue Colors] Automatic attribution verification queue failed:', e));
        }, Math.max(0, nextDue - Date.now()));
    }

    function queueAutoAttributionVerificationForMessage(mesIndex, options = {}) {
        const index = Number(mesIndex);
        const msg = getContext()?.chat?.[index];
        if (!shouldQueueAutoAttributionVerification(index, msg, options)) return false;

        const key = getAutoAttributionVerifyKey(index, msg);
        const existing = pendingAutoAttributionVerifyIndices.get(key);
        pendingAutoAttributionVerifyIndices.set(key, {
            key,
            mesIndex: index,
            messageId: getAutoAttributionMessageId(msg),
            chatGeneration: attributionChatGeneration,
            force: options.force === true || existing?.force === true,
        });
        scheduleAutoAttributionVerificationDrain(options.delay ?? AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
        return true;
    }

    function queueAutoAttributionVerificationForElements(elements, options = {}) {
        if (!elements?.length) return false;
        let queued = false;
        for (const mesElement of elements) {
            const mesIndex = Number(mesElement?.getAttribute?.('mesid'));
            if (queueAutoAttributionVerificationForMessage(mesIndex, options)) queued = true;
        }
        return queued;
    }

    function queueAutoAttributionVerificationForRenderedMessages(options = {}) {
        const messages = Array.from(document.querySelectorAll('#chat .mes[mesid]')).reverse();
        return queueAutoAttributionVerificationForElements(messages, options);
    }

    function queueAutoAttributionVerificationAfterCorrections(mesIndex, result, options = {}) {
        if (!result?.checked || !(result.corrections > 0)) return false;
        const index = Number(mesIndex);
        if (!Number.isFinite(index) || index < 0) return false;
        return queueAutoAttributionVerificationForMessage(index, {
            force: true,
            delay: options.delay ?? AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS,
        });
    }

    async function drainAutoAttributionVerificationQueue() {
        if (!pendingAutoAttributionVerifyIndices.size) return;
        if (!isAutoAttributionVerificationEnabled()) {
            pendingAutoAttributionVerifyIndices.clear();
            return;
        }
        if (isStreamingGenerationActive) {
            scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
            return;
        }

        const queued = Array.from(pendingAutoAttributionVerifyIndices.values());
        pendingAutoAttributionVerifyIndices.clear();
        pruneRecentAutoAttributionVerifyAttempts();
        const deferredItems = [];

        for (const item of queued) {
            if (!isAutoAttributionVerificationEnabled()) break;
            if (isStreamingGenerationActive) {
                pendingAutoAttributionVerifyIndices.set(item.key, item);
                scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
                break;
            }
            if (item.chatGeneration !== attributionChatGeneration) continue;

            const msg = getContext()?.chat?.[item.mesIndex];
            if (suspendMessageDomWorkForEdit(getMessageElementByIndex(item.mesIndex), item.mesIndex)) {
                deferredItems.push(item);
                continue;
            }
            if (!isMessageEligibleForAttributionVerification(msg) || isMessageAttributionVerified(item.mesIndex, msg)) continue;
            const currentKey = getAutoAttributionVerifyKey(item.mesIndex, msg);
            if (currentKey !== item.key) continue;
            const currentMessageId = getAutoAttributionMessageId(msg);
            if (item.messageId && currentMessageId && item.messageId !== currentMessageId) continue;

            const now = Date.now();
            const lastAttempt = recentAutoAttributionVerifyAttempts.get(currentKey) || 0;
            if (!item.force && now - lastAttempt < AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS) continue;
            recentAutoAttributionVerifyAttempts.set(currentKey, now);
            pruneRecentAutoAttributionVerifyAttempts(now);

            try {
                await runAttributionVerification(
                    async () => {
                        const result = await verifyAttributionsWithLLM(item.mesIndex, { manual: false, quiet: true });
                        queueAutoAttributionVerificationAfterCorrections(item.mesIndex, result);
                        return result;
                    },
                    { manual: false, queueKey: `auto:${currentKey}` }
                );
            } catch (e) {
                console.warn('[Dialogue Colors] Automatic attribution verification failed:', e);
            }
        }
        if (deferredItems.length) {
            for (const item of deferredItems) pendingAutoAttributionVerifyIndices.set(item.key, item);
            scheduleAutoAttributionVerificationDrain(AUTO_ATTRIBUTION_VERIFY_DELAY_MS);
        }
    }

    function collectJsonObjectCandidates(text) {
        const candidates = [];
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        const source = String(text ?? '');

        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') {
                if (depth === 0) start = i;
                depth++;
                continue;
            }
            if (ch === '}' && depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) {
                    candidates.push(source.slice(start, i + 1));
                    start = -1;
                }
            }
        }

        return candidates;
    }

    function parseAttributionVerifierResponse(responseText) {
        if (!responseText || typeof responseText !== 'string') return null;
        // Strip common reasoning/thinking wrappers so we can find the final JSON.
        let cleaned = responseText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .replace(/### Reasoning:[\s\S]*?(?=###|(?=\{)|$)/gi, '')
            .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
        const fencedBlocks = [];
        cleaned.replace(/```(?:json|javascript|js|text|txt)?\s*([\s\S]*?)\s*```/gi, (_, body) => {
            fencedBlocks.push(String(body ?? '').trim());
            return '';
        });
        cleaned = unwrapCodeFence(cleaned).trim();

        const candidates = [];
        for (const source of [...fencedBlocks, cleaned]) {
            if (!source) continue;
            candidates.push(source);
            const objects = collectJsonObjectCandidates(source);
            for (let i = objects.length - 1; i >= 0; i--) candidates.push(objects[i]);
        }

        const seen = new Set();
        for (const candidate of candidates) {
            const trimmed = String(candidate ?? '').trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            try {
                const parsed = JSON.parse(trimmed);
                const corrections = Array.isArray(parsed) ? parsed : parsed?.corrections;
                return Array.isArray(corrections) ? corrections : [];
            } catch { /* try next candidate */ }
        }
        return null;
    }

    function buildAttributionVerifierPrompt(msg, mesIndex, segments, lookup) {
        const thoughtSymbols = getThoughtDelimiterSymbols();
        const thoughtSymbolList = thoughtSymbols.map(formatPromptLiteralSymbol).join(', ');
        const knownNames = [];
        const seenNames = new Set();
        const addKnownName = name => {
            const trimmed = String(name ?? '').trim();
            const key = trimmed.toLowerCase();
            if (!trimmed || seenNames.has(key) || isCompositeSpeakerLabel(trimmed)) return;
            seenNames.add(key);
            knownNames.push(trimmed);
        };
        for (const entry of Object.values(characterColors)) {
            addKnownName(entry.name);
            for (const alias of entry.aliases || []) addKnownName(alias);
        }
        for (const assignment of lookup.values()) addKnownName(assignment.name);
        addKnownName(msg?.name);

        const quoteList = segments
            .map(seg => `${seg.index}. current=${seg.assignment?.name || 'Uncolored/Unknown'} delimiter=${JSON.stringify(seg.delimiter)} text=${JSON.stringify(seg.text)}`)
            .join('\n');
        const knownList = knownNames.length ? knownNames.join(', ') : '(none)';
        const conservativeLine = settings.attributionConservativeOnly
            ? 'Include a correction only when the current speaker is Uncolored/Unknown and the speaker is clear enough to color it.'
            : 'Include a correction when the current speaker is clearly wrong, or when a segment is Uncolored/Unknown and the speaker is clear enough to color it.';
        const thoughtLine = thoughtSymbolList
            ? `\nConfigured inner-thought delimiters: ${thoughtSymbolList}. Treat those as dialogue segments that also need speaker attribution.`
            : '';

        return `Task: verify speaker attribution for a local DOM-only dialogue colorizer.
Return ONLY valid JSON. No reasoning, no Markdown, no code fence, no extra text.
Schema exactly: {"corrections":[{"index":0,"speaker":"Name"}]}
If there are no corrections, return exactly: {"corrections":[]}

Rules:
1. ${conservativeLine}
2. If the current speaker is already correct, omit that segment.
3. If the speaker is unclear or only a guess, omit that segment.
4. Use one speaker name only, preferably from Known speakers and aliases.
5. Do not invent a speaker unless the full message text explicitly names them.
6. Do not use Unknown, Unclear, None, N/A, Narrator, or a group/composite name as a speaker correction.
7. Correction indexes must match the numbered segment list.

Message index: ${mesIndex}
Message speaker/fallback: ${msg?.name || 'Unknown'}
Known speakers and aliases: ${knownList}${thoughtLine}

Full message text:
${msg?.mes || ''}

Numbered dialogue/thought segments:
${quoteList}`;
    }

    function resolveVerifierSpeakerName(rawName, lookup) {
        const speakerName = String(rawName ?? '').trim();
        if (!speakerName || speakerName.length > 80 || isCompositeSpeakerLabel(speakerName)) return { assignment: null, created: false };
        const normalized = speakerName.toLowerCase();
        if (['unknown', 'unclear', 'narrator', 'none', 'n/a'].includes(normalized)) return { assignment: null, created: false };

        let assignment = resolveSingleSpeakerAssignment(speakerName, lookup);
        if (assignment) return { assignment, created: false };

        const ensured = ensureCharacterEntry(speakerName);
        if (!ensured?.entry) return { assignment: null, created: false };
        registerLookupAssignment(lookup, ensured.entry.name, getEntryEffectiveColor(ensured.entry), ensured.entry.aliases, false, ensured.entry.font);
        assignment = lookup.get(speakerName.toLowerCase()) || lookup.get(ensured.key) || null;
        return { assignment, created: !!ensured.created };
    }

    async function verifyAttributionsWithLLM(mesIndex, options = {}) {
        if (!settings.enabled || !isDomEngine()) return { checked: false, corrections: 0, createdCharacters: false };
        const ctx = getContext();
        const msg = ctx?.chat?.[mesIndex];
        if (suspendMessageDomWorkForEdit(getMessageElementByIndex(mesIndex), mesIndex)) return { checked: false, corrections: 0, createdCharacters: false };
        if (!isMessageEligibleForAttributionVerification(msg)) return { checked: false, corrections: 0, createdCharacters: false };
        const skipMarkVerified = options.skipMarkVerified === true;
        const useTransientOverrides = options.transientOverrides === true;
        const quiet = options.quiet === true;
        if (!options.manual && isMessageAttributionVerified(mesIndex, msg)) return { checked: false, corrections: 0, createdCharacters: false };

        const localAssignments = parseNamedColorAssignmentsFromText(msg.mes);
        const lookup = buildNameColorLookup(localAssignments);
        const existingEntry = getMessageQuoteOverrideEntry(mesIndex, msg, false);
        const attributionOverrides = useTransientOverrides
            ? getMessageQuoteOverridesForDecoration(mesIndex, msg)
            : existingEntry?.segments || null;
        const attribution = attributeDialogueSegments(msg.mes, msg.name, {
            autoAddMessageSpeaker: true,
            overrides: attributionOverrides,
            mesIndex: mesIndex,
        });
        const persistCreatedCharacters = () => {
            if (!attribution.createdCharacters) return;
            saveData();
            updateCharList();
        };
        const segments = attribution.segments;
        if (!segments.length) {
            if (!skipMarkVerified) {
                markMessageAttributionVerified(mesIndex, msg);
                clearStreamingAttributionOverrides(mesIndex);
            }
            persistCreatedCharacters();
            return { checked: true, corrections: 0, createdCharacters: attribution.createdCharacters };
        }

        const jsonSchema = {
            type: 'object',
            properties: {
                corrections: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            index: { type: 'integer' },
                            speaker: { type: 'string' },
                        },
                        required: ['index', 'speaker'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['corrections'],
            additionalProperties: false,
        };

        let corrections = null;
        try {
            const response = await callLLMWithProfile(buildAttributionVerifierPrompt(msg, mesIndex, segments, lookup), {
                profileId: settings.attributionConnectionProfile,
                quietName: `DC_Attr_${mesIndex}_${Date.now()}`,
                jsonSchema,
                maxTokens: Number.isFinite(settings.attributionMaxTokens) && settings.attributionMaxTokens > 0 ? settings.attributionMaxTokens : 4096,
            });
            corrections = parseAttributionVerifierResponse(response);
        } catch (e) {
            console.warn('[Dialogue Colors] LLM attribution verification failed:', e);
            if (!quiet) toast.warning('Color verification failed (see console).');
            persistCreatedCharacters();
            return { checked: false, corrections: 0, createdCharacters: false };
        }

        if (!Array.isArray(corrections)) {
            console.warn('[Dialogue Colors] LLM attribution verification returned invalid JSON.');
            if (!quiet) toast.warning('Color verification failed (see console).');
            persistCreatedCharacters();
            return { checked: false, corrections: 0, createdCharacters: false };
        }

        const segmentByIndex = new Map(segments.map(seg => [seg.index, seg]));
        let appliedCorrections = 0;
        let createdCharacters = !!attribution.createdCharacters;
        for (const correction of corrections) {
            const index = Number(correction?.index);
            if (!Number.isInteger(index) || !segmentByIndex.has(index)) continue;
            const seg = segmentByIndex.get(index);
            // In conservative mode we only fill segments that are currently uncolored/unknown.
            if (settings.attributionConservativeOnly && seg.assignment?.key) continue;
            const { assignment, created } = resolveVerifierSpeakerName(correction?.speaker, lookup);
            if (!assignment || assignment.key === seg.assignment?.key) continue;

            const latestEntry = getMessageQuoteOverrideEntry(mesIndex, msg, !useTransientOverrides);
            const existingOverride = latestEntry?.segments?.[String(index)];
            const existingSource = latestEntry?.sources?.[String(index)];
            if (existingOverride && existingSource !== 'llm' && !options.manual) continue;

            const overrideSource = options.manual ? 'manual' : 'llm';
            const didSetOverride = useTransientOverrides
                ? setStreamingAttributionOverride(mesIndex, msg, index, assignment.name, { source: overrideSource })
                : setMessageQuoteOverride(mesIndex, msg, index, assignment.name, { source: overrideSource });
            if (didSetOverride) {
                appliedCorrections++;
                if (created) createdCharacters = true;
            }
        }

        if (!skipMarkVerified) {
            if (appliedCorrections === 0) markMessageAttributionVerified(mesIndex, msg);
            clearStreamingAttributionOverrides(mesIndex);
        }
        if (appliedCorrections) {
            saveData();
            updateCharList();
        }
        if (appliedCorrections) {
            clearMessageDomRepairTimer(mesIndex);
            cancelMessageDomFollowupRepairs(mesIndex);
            // Verifier corrections only change override metadata; decorate the
            // already-rendered DOM without an innerHTML fallback write.
            const repainted = await decorateMessageDomFromCurrentRender(mesIndex, msg, { queueVerification: false, renderFallback: false });
            if (repainted) scheduleMessageDomFollowupRepair(mesIndex, repainted);
        } else {
            const mesElement = document.querySelector(`#chat .mes[mesid="${mesIndex}"]`) || document.querySelectorAll('#chat .mes[mesid]')[mesIndex];
            if (mesElement) decorateObservedMessages([mesElement]);
        }

        return { checked: true, corrections: appliedCorrections, createdCharacters };
    }

    async function verifyLatestAttributionsWithLLM(options = {}) {
        const chat = getContext()?.chat || [];
        if (!chat.length) {
            if (options.manual) toast.info('No messages to verify.');
            return { checked: false, corrections: 0, createdCharacters: false };
        }
        const lastIdx = chat.length - 1;
        const msg = chat[lastIdx];
        if (!isMessageEligibleForAttributionVerification(msg) || (!options.manual && isMessageAttributionVerified(lastIdx, msg))) {
            if (options.manual) toast.info('Latest message already verified or not eligible.');
            return { checked: false, corrections: 0, createdCharacters: false };
        }
        toast.info('Verifying dialogue colors with LLM...');
        const result = await verifyAttributionsWithLLM(lastIdx, options);
        if (result.checked && result.corrections > 0) toast.info(`Verified DOM colors: applied ${result.corrections} correction${result.corrections !== 1 ? 's' : ''}.`);
        else if (result.checked && result.corrections === 0) toast.info('Verified colors: no corrections needed.');
        return result;
    }

    async function verifyVisibleAttributionsWithLLM(options = {}) {
        const chat = getContext()?.chat || [];
        const indices = Array.from(document.querySelectorAll('#chat .mes[mesid]'))
            .map(el => Number(el.getAttribute('mesid')))
            .filter(index => Number.isInteger(index) && index >= 0)
            .reverse();
        let checked = 0;
        let corrections = 0;
        toast.info('Verifying visible messages with LLM...');
        for (const index of indices) {
            const msg = chat[index];
            if (!isMessageEligibleForAttributionVerification(msg) || (!options.manual && isMessageAttributionVerified(index, msg))) continue;
            const result = await verifyAttributionsWithLLM(index, options);
            if (result.checked) checked++;
            corrections += result.corrections || 0;
        }
        if (corrections > 0) toast.info(`Verified DOM colors: applied ${corrections} correction${corrections !== 1 ? 's' : ''}.`);
        else if (options.manual && !checked) toast.info('No unverified visible DOM messages to check.');
        else if (options.manual && checked) toast.info('Verified visible colors: no corrections needed.');
        return { checked: checked > 0, corrections, createdCharacters: false };
    }

    async function runAttributionVerification(action, options = {}) {
        if (isVerifyingAttribution) {
            if (options.manual) toast.info('Attribution verification is already running.');
            else if (options.queue !== false) {
                const queued = { action, options };
                const queueKey = options.queueKey ? String(options.queueKey) : '';
                const existingIndex = queueKey
                    ? pendingAttributionVerifications.findIndex(item => item.options?.queueKey === queueKey)
                    : -1;
                if (existingIndex >= 0) pendingAttributionVerifications[existingIndex] = queued;
                else pendingAttributionVerifications.push(queued);
            }
            return { checked: false, corrections: 0, createdCharacters: false, queued: !options.manual && options.queue !== false };
        }
        isVerifyingAttribution = true;
        setVerifyAttributionButtonBusy(true);
        try {
            return await action();
        } finally {
            isVerifyingAttribution = false;
            const next = pendingAttributionVerifications.shift();
            if (next) {
                setTimeout(() => {
                    runAttributionVerification(next.action, next.options)
                        .catch(e => console.warn('[Dialogue Colors] Queued attribution verification failed:', e));
                }, 0);
            } else {
                setVerifyAttributionButtonBusy(false);
            }
        }
    }

    function cancelStreamingAttributionVerification(options = {}) {
        clearTimeout(streamingAttributionVerifyTimer);
        streamingAttributionVerifyTimer = null;
        streamingAttributionGeneration++;
        lastStreamingAttributionVerifyKey = '';
        if (options.clearOverrides) clearStreamingAttributionOverrides();
    }

    function scheduleStreamingAttributionVerification() {
        if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return;
        // Continuous loop: do NOT reset an already-scheduled timer on every token.
        // The loop reschedules itself from runStreamingAttributionVerification's finally,
        // so we only arm the timer when nothing is pending.
        if (streamingAttributionVerifyTimer) return;
        const chat = getContext()?.chat || [];
        const mesIndex = chat.length - 1;
        const msg = chat[mesIndex];
        if (!isMessageEligibleForAttributionVerification(msg)) return;

        const generation = streamingAttributionGeneration;
        streamingAttributionVerifyTimer = setTimeout(() => {
            streamingAttributionVerifyTimer = null;
            runStreamingAttributionVerification(mesIndex, generation)
                .catch(e => console.warn('[Dialogue Colors] Streaming attribution verification failed:', e));
        }, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS);
    }

    function rescheduleStreamingAttributionVerification(mesIndex, generation) {
        if (generation !== streamingAttributionGeneration) return;
        if (!isStreamingGenerationActive) return;
        if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return;
        if (streamingAttributionVerifyTimer) return;
        streamingAttributionVerifyTimer = setTimeout(() => {
            streamingAttributionVerifyTimer = null;
            runStreamingAttributionVerification(mesIndex, generation)
                .catch(e => console.warn('[Dialogue Colors] Streaming attribution verification failed:', e));
        }, STREAMING_ATTRIBUTION_VERIFY_DELAY_MS);
    }

    async function runStreamingAttributionVerification(mesIndex, generation) {
        try {
            if (generation !== streamingAttributionGeneration) return { checked: false, corrections: 0, createdCharacters: false };
            if (!settings.enabled || !isDomEngine() || !settings.llmAttributionParallel) return { checked: false, corrections: 0, createdCharacters: false };
            if (isVerifyingAttribution) return { checked: false, corrections: 0, createdCharacters: false };

            const msg = getContext()?.chat?.[mesIndex];
            if (!isMessageEligibleForAttributionVerification(msg)) return { checked: false, corrections: 0, createdCharacters: false };

            const verifyKey = `${mesIndex}:${hashMessageText(msg.mes)}`;
            if (verifyKey !== lastStreamingAttributionVerifyKey) {
                const result = await runAttributionVerification(
                    () => verifyAttributionsWithLLM(mesIndex, { manual: false, skipMarkVerified: true, transientOverrides: true, quiet: true }),
                    { manual: false, queue: false }
                );
                lastStreamingAttributionVerifyKey = result.checked && result.corrections === 0 ? verifyKey : '';
                return result;
            }
            return { checked: false, corrections: 0, createdCharacters: false };
        } finally {
            // Self-perpetuating loop: keep re-checking while streaming is active.
            // New tokens may have arrived since the last run; rescheduling lets us
            // re-verify dialogue attributed in the interim.
            rescheduleStreamingAttributionVerification(mesIndex, generation);
        }
    }

    async function recolorAllMessages() {
        const ctx = getContext();
        const chat = ctx?.chat || [];
        if (!chat.length) { toast.info('No messages to recolor.'); return; }
        if (isDomEngine()) {
            syncAllEffectiveColors();
            decorateAllMessages();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            toast.info('Refreshed DOM colors without editing chat text.');
            return;
        }
        if (isRecoloring) { toast.info('Recolor is already running.'); return; }
        isRecoloring = true;
        setRecolorButtonBusy(true);

        try {
            const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
            const fontTagRegex = /<font\b[^>]*\bcolor\s*=\s*["']?(#[0-9a-fA-F]{6})["']?[^>]*>/gi;
            syncAllEffectiveColors();

            // Step 1: Build global reverse map with ambiguity tracking.
            // Later messages overwrite earlier in latestByColor, but ambiguous colors are tracked in namesByColor.
            const globalLatestByColor = {};
            const globalNamesByColor = {};
            for (const msg of chat) {
                const text = msg?.mes || '';
                const parsed = parseColorAssignmentsFromText(text);
                for (const [color, name] of Object.entries(parsed.latestByColor)) {
                    globalLatestByColor[color] = name;
                }
                for (const [color, names] of Object.entries(parsed.namesByColor)) {
                    if (!globalNamesByColor[color]) globalNamesByColor[color] = new Set();
                    for (const name of names) globalNamesByColor[color].add(name);
                }
            }

            // Step 2: Build current name → newColor lookup from characterColors (including aliases).
            const nameToNewColor = {};
            for (const entry of Object.values(characterColors)) {
                const adjusted = getEntryEffectiveColor(entry);
                nameToNewColor[entry.name.toLowerCase()] = adjusted;
                for (const alias of (entry.aliases || [])) {
                    nameToNewColor[alias.toLowerCase()] = adjusted;
                }
            }
            // Include narrator color if set
            if (settings.narratorColor) {
                nameToNewColor['narrator'] = applyThemeReadabilityAndBrightness(settings.narratorColor);
            }

            // Step 3: Process each non-user message
            let recoloredCount = 0;
            let ambiguousSkippedCount = 0;
            for (let i = 0; i < chat.length; i++) {
                const msg = chat[i];
                if (!msg || msg.is_user) continue;
                const rawText = msg.mes || '';
                if (!rawText) continue;

                const localParsed = parseColorAssignmentsFromText(rawText);
                const localLatestByColor = localParsed.latestByColor;
                const localNamesByColor = localParsed.namesByColor;
                const fontColorsInMessage = collectFontColorsFromText(rawText);
                const candidateColors = new Set([...fontColorsInMessage, ...Object.keys(localLatestByColor)]);

                // Build oldColor → newColor replacement map
                const replacements = {};
                for (const oldColor of candidateColors) {
                    let mappedName = '';
                    const localNames = localNamesByColor[oldColor];
                    if (localNames) {
                        if (localNames.size !== 1) { ambiguousSkippedCount++; continue; }
                        mappedName = localLatestByColor[oldColor];
                    } else {
                        const globalNames = globalNamesByColor[oldColor];
                        if (!globalNames || globalNames.size !== 1) { if (globalNames?.size > 1) ambiguousSkippedCount++; continue; }
                        mappedName = globalLatestByColor[oldColor];
                    }
                    const newColor = nameToNewColor[mappedName];
                    if (newColor && normalizeHexColor(oldColor) !== normalizeHexColor(newColor)) replacements[oldColor] = newColor;
                }

                if (!Object.keys(replacements).length) continue;

                // Replace <font color=X> tags in raw msg.mes text
                let updated = rawText.replace(fontTagRegex, (match, oldHex) => {
                    const key = oldHex.toLowerCase();
                    if (replacements[key]) {
                        return match.replace(/(\bcolor\s*=\s*["']?)(#[0-9a-fA-F]{6})(["']?)/i, `$1${replacements[key]}$3`);
                    }
                    return match;
                });

                // Update [COLORS:] block colors in raw text
                updated = updated.replace(colorBlockRegex, (fullMatch, pairsStr) => {
                    const newPairs = pairsStr.split(',').map(pair => {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) return pair;
                        const namePart = pair.substring(0, eqIdx);
                        const rawColor = pair.substring(eqIdx + 1).trim();
                        const key = rawColor.toLowerCase();
                        if (replacements[key]) return `${namePart}=${replacements[key]}`;
                        return pair;
                    }).join(',');
                    return fullMatch.replace(pairsStr, newPairs);
                });

                if (updated !== rawText) {
                    msg.mes = updated;
                    recoloredCount++;
                }

                // Update DOM font[color] attributes for this message
                updateVisibleMessageColors(i, replacements);
            }

            // Step 4: Persist; DOM font attributes were already updated above.
            if (recoloredCount > 0) {
                if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
                toast.info(`Recolored ${recoloredCount} message${recoloredCount !== 1 ? 's' : ''}.`);
            } else if (ambiguousSkippedCount > 0) {
                toast.info(`No messages recolored; skipped ${ambiguousSkippedCount} ambiguous legacy color mapping${ambiguousSkippedCount !== 1 ? 's' : ''}.`);
            } else {
                toast.info('No messages needed recoloring.');
            }
        } finally {
            isRecoloring = false;
            setRecolorButtonBusy(false);
        }
    }

    function populateProfileSelect(elementId, selectedProfileId) {
        const select = document.getElementById(elementId);
        if (!select) return;
        select.innerHTML = '<option value="">-- Use main chat AI --</option>';
        try {
            const ctx = getContext();
            const CMRS = ctx.ConnectionManagerRequestService;
            if (!CMRS) {
                select.innerHTML += '<option value="" disabled>Requires SillyTavern 1.15.0+</option>';
                return;
            }
            const profiles = CMRS.getSupportedProfiles();
            for (const p of profiles) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name || p.id;
                if (p.id === selectedProfileId) opt.selected = true;
                select.appendChild(opt);
            }
            select.disabled = false;
        } catch (e) {
            console.warn('[DC] Failed to load profiles:', e);
            select.innerHTML += '<option value="" disabled>Error loading profiles</option>';
        }
    }

    function populateProfileDropdown() {
        populateProfileSelect('dc-llm-profile', settings.llmConnectionProfile);
        populateProfileSelect('dc-attr-profile', settings.attributionConnectionProfile);
    }

    async function colorizeMessages(targetMode = 'all') {
        const ctx = getContext();
        const chat = ctx?.chat || [];
        if (!chat.length) { toast.info('No messages to colorize.'); return; }
        if (isDomEngine()) {
            decorateAllMessages();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            toast.info('Refreshed DOM colors without editing chat text.');
            return;
        }
        if (isColorizing) { toast.info('Colorize is already running.'); return; }
        isColorizing = true;
        setColorizeButtonBusy(true);

        try {
            syncAllEffectiveColors();
            let createdCharacters = false;

            // Pre-register all unique non-user speaker names so attribution can find them
            const allSpeakers = new Set();
            for (const msg of chat) {
                if (msg && !msg.is_user && msg.name) allSpeakers.add(msg.name.trim());
            }
            for (const speakerName of allSpeakers) {
                if (!speakerName || isCompositeSpeakerLabel(speakerName)) continue;
                const ensured = ensureCharacterEntry(speakerName);
                if (ensured.created) createdCharacters = true;
            }

            // Determine message range
            const startIdx = targetMode === 'last' ? Math.max(0, chat.length - 1) : 0;

            let colorizedCount = 0;
            let skippedNoColor = 0;
            const updatedMessageIndices = new Set();
            const eligibleIndices = [];
            for (let i = startIdx; i < chat.length; i++) {
                const msg = chat[i];
                if (!msg || msg.is_user) continue;
                const rawText = msg.mes || '';
                if (!rawText) continue;
                const existingFontColors = collectFontColorsFromText(rawText);
                if (existingFontColors.size > 0) continue;
                eligibleIndices.push(i);
            }
            // Batch colorize with LLM first
            if (eligibleIndices.length > 0) {
                const messageBatch = eligibleIndices.map(i => ({
                    rawText: chat[i].mes || '',
                    speakerName: chat[i].name,
                    msgIndex: i
                }));

                toast.info(`Colorizing ${messageBatch.length} message${messageBatch.length !== 1 ? 's' : ''} in batch...`, '', { timeOut: 3000 });

                let batchResults = [];
                try {
                    batchResults = await colorizeMultipleMessagesWithLLM(messageBatch);
                } catch (e) {
                    console.warn('[Dialogue Colors] Batch colorize failed:', e);
                }

                // Apply batch results
                const processedIndices = new Set();
                for (const result of batchResults) {
                    if (result.changed && result.msgIndex != null) {
                        chat[result.msgIndex].mes = result.updatedText;
                        colorizedCount++;
                        processedIndices.add(result.msgIndex);
                        updatedMessageIndices.add(result.msgIndex);
                    }
                }

                // Fallback: process messages that failed in batch individually
                for (let idx = 0; idx < eligibleIndices.length; idx++) {
                    const i = eligibleIndices[idx];
                    if (processedIndices.has(i)) continue;

                    const msg = chat[i];
                    const rawText = msg.mes || '';

                    // Try individual LLM, then regex fallback
                    let result = null;
                    try {
                        result = await colorizeMessageWithLLM(rawText, msg.name);
                    } catch (e) {
                        console.warn('[Dialogue Colors] Individual LLM colorize failed:', e);
                    }

                    if (!result || !result.changed) {
                        result = colorizeMessageText(rawText, msg.name, { autoAddMessageSpeaker: true });
                        if (result.createdCharacters) createdCharacters = true;
                    }

                    if (!result.changed) {
                        if (result.hadDialogueMatches && !result.hadResolvableSpeaker) skippedNoColor++;
                        continue;
                    }

                    msg.mes = result.updatedText;
                    colorizedCount++;
                    updatedMessageIndices.add(i);
                }
            }

            if (createdCharacters) {
                commit();
            }

            // Persist and refresh only the affected message DOM nodes.
            if (colorizedCount > 0) {
                if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
                for (const index of updatedMessageIndices) await refreshMessageDom(index, chat[index]);
                toast.info(`Colorized ${colorizedCount} message${colorizedCount !== 1 ? 's' : ''}${skippedNoColor > 0 ? ` (${skippedNoColor} skipped — no speaker/color match)` : ''}.`);
            } else if (skippedNoColor > 0) {
                toast.info(`No uncolored dialogue found; ${skippedNoColor} message${skippedNoColor !== 1 ? 's' : ''} skipped (no known speaker/color could be resolved).`);
            } else {
                toast.info('No uncolored messages found.');
            }
        } finally {
            isColorizing = false;
            setColorizeButtonBusy(false);
        }
    }

    function onNewMessage() {
        if (!settings.enabled || !settings.autoScanNewMessages) return;
        setTimeout(async () => {
            const ctx = getContext();
            const chat = ctx?.chat || [];
            if (!chat.length) return;
            const lastMsg = chat[chat.length - 1];
            const text = lastMsg?.mes || '';
            const sigId = lastMsg?.id ?? lastMsg?.send_date ?? '';
            const signature = `${chat.length}|${sigId}|${text}`;
            if (signature === lastProcessedMessageSignature) {
                stripColorBlockFromElement(document.querySelector('.mes:last-child .mes_text'));
                scheduleDomRefreshSeries();
                return;
            }
            lastProcessedMessageSignature = signature;
            const colorBlockRegex = /\[COLORS?:([^\]]*)\]/gi;
            let match;
            let foundColorBlock = false;
            let hadRemapping = false;
            const remappedAssignments = [];
            while ((match = colorBlockRegex.exec(text)) !== null) {
                const result = processColorPairs(match[1]);
                foundColorBlock = true;
                if (result.hadRemapping) hadRemapping = true;
                if (Array.isArray(result.remappedAssignments)) remappedAssignments.push(...result.remappedAssignments);
            }
            saveData(); updateCharList(); injectPrompt();

            let latestRemapChanged = false;
            if (remappedAssignments.length) {
                const latestTextForRemap = lastMsg.mes || text;
                const latestParsedAssignments = parseColorAssignmentsFromText(latestTextForRemap);
                const remapReplacements = {};
                const ambiguousRemapColors = new Set();
                for (const assignment of remappedAssignments) {
                    const oldHex = normalizeHexColor(assignment.oldColor, null);
                    const newHex = normalizeHexColor(assignment.newColor, null);
                    if (!oldHex || !newHex || oldHex === newHex) continue;
                    const localNames = latestParsedAssignments.namesByColor[oldHex];
                    if (localNames && localNames.size > 1) {
                        delete remapReplacements[oldHex];
                        ambiguousRemapColors.add(oldHex);
                        continue;
                    }
                    if (remapReplacements[oldHex] && remapReplacements[oldHex] !== newHex) {
                        delete remapReplacements[oldHex];
                        ambiguousRemapColors.add(oldHex);
                        continue;
                    }
                    if (!ambiguousRemapColors.has(oldHex)) remapReplacements[oldHex] = newHex;
                }

                if (Object.keys(remapReplacements).length) {
                    const latestRemap = updateTextColorReferences(latestTextForRemap, remapReplacements);
                    if (latestRemap.changed) {
                        lastMsg.mes = latestRemap.updatedText;
                        lastProcessedMessageSignature = `${chat.length}|${sigId}|${lastMsg.mes}`;
                        latestRemapChanged = true;
                    }
                    updateVisibleMessageColors(chat.length - 1, remapReplacements);
                }
            }
            stripColorBlockFromElement(document.querySelector('.mes:last-child .mes_text'));

            // Keep chat colors in sync when receive-time color conflict remapping happens.
            if (hadRemapping && settings.autoRecolor) {
                if (isDomEngine()) scheduleDomRefreshSeries(0);
                else await recolorAllMessages();
            }

            if (isDomEngine()) {
                scheduleDomRefreshSeries(0);
                return;
            }
            if (latestRemapChanged && typeof ctx?.saveChat === 'function') {
                await ctx.saveChat();
            }

            // Auto-colorize fallback: if model produced no color output at all
            if (!foundColorBlock && settings.autoColorize && !lastMsg.is_user && !isAutoColorizing) {
                const hasExistingColors = collectFontColorsFromText(text).size > 0;
                if (!hasExistingColors) {
                    isAutoColorizing = true;
                    const lastMesEl = document.querySelector('.mes:last-child');
                    clearAutoColorizeIndicators();
                    showAutoColorizeIndicator(lastMesEl);
                    try {
                        syncAllEffectiveColors();
                        // Pre-register all unique non-user speaker names for attribution
                        for (const msg of chat) {
                            if (msg && !msg.is_user && msg.name) {
                                const speakerName = msg.name.trim();
                                if (speakerName && !isCompositeSpeakerLabel(speakerName)) {
                                    ensureCharacterEntry(speakerName);
                                }
                            }
                        }
                        // Try LLM path first, fall back to regex
                        let result = null;
                        try {
                            result = await colorizeMessageWithLLM(text, lastMsg.name);
                        } catch (e) {
                            console.warn('[Dialogue Colors] LLM auto-colorize failed, falling back to regex:', e);
                        }
                        if (!result || !result.changed) {
                            result = colorizeMessageText(text, lastMsg.name, { autoAddMessageSpeaker: true });
                            if (result.createdCharacters) {
                                commit();
                            }
                        }
                        if (result.changed) {
                            lastMsg.mes = result.updatedText;
                            lastProcessedMessageSignature = `${chat.length}|${sigId}|${lastMsg.mes}`;

                            const ctx2 = getContext();
                            if (typeof ctx2?.saveChat === 'function') {
                                await ctx2.saveChat();
                            }

                            await refreshMessageDom(chat.length - 1, lastMsg);
                            toast.info('Auto-colorized latest message.');
                        }
                    } finally {
                        isAutoColorizing = false;
                        hideAutoColorizeIndicator(lastMesEl);
                        clearAutoColorizeIndicators();
                    }
                }
            }
        }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        let needsDomRepaint = false;
        if (characterColors[key]) {
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
    }

    function swapColors(key1, key2) {
        const snapshot = captureEffectiveColorSnapshot(Object.keys(characterColors));
        const color1 = getEntryEffectiveColor(characterColors[key1]);
        const color2 = getEntryEffectiveColor(characterColors[key2]);
        setEntryFromEffectiveColor(characterColors[key1], color2);
        setEntryFromEffectiveColor(characterColors[key2], color1);
        applyLiveColorChangesFromSnapshot(snapshot, [key1, key2]);
        commit();
    }

    function toggleCharacterRowExpansion(key) {
        if (!key) return;
        if (expandedCharacterRows.has(key)) expandedCharacterRows.delete(key);
        else expandedCharacterRows.add(key);
    }

    function applyCharacterBaseColor(key, color, options = {}) {
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
        return true;
    }

    function maybeAutoRecolorAfterColorChange() {
        flushColorStateSave();
        flushChatSave();
        if (!settings.autoRecolor) return;
        if (!autoRecolorHintShown) {
            autoRecolorHintShown = true;
            toast.info('Auto-recolor is enabled; color changes will update chat automatically.');
        }
    }

    function applyThemeOrBrightnessChange(mutator, options = {}) {
        const keys = Object.keys(characterColors);
        const snapshot = captureEffectiveColorSnapshot(keys);
        mutator();
        invalidateThemeCache();
        syncAllEffectiveColors();
        applyLiveColorChangesFromSnapshot(snapshot, keys, { saveImmediately: options.saveImmediately });
        applyFastColorUiUpdates(keys);
    }

    function buildCharRowHtml(k, v) {
        const safeKey = escapeAttr(k);
        const safeColor = getEntryEffectiveColor(v);
        const pickerColor = getBaseColor(v, safeColor);
        const rowExpanded = expandedCharacterRows.has(k);
        const styleLabel = v.style || 'Normal';
        const fontName = normalizeGoogleFontName(v.font);
        const fontFamily = getGoogleFontFamily(fontName);
        if (fontFamily) loadGoogleFont(fontName);
        const fontStyle = fontFamily ? `font-family:${escapeAttr(fontFamily)};` : '';
        const statusBadges = [
            v.keep ? '<span class="dc-status-chip dc-status-chip-keep">Kept</span>' : '',
            v.locked ? '<span class="dc-status-chip dc-status-chip-lock">Locked</span>' : '',
            v.group ? `<span class="dc-status-chip">${escapeHtml(v.group)}</span>` : '',
            v.style ? `<span class="dc-status-chip">${escapeHtml(styleLabel)}</span>` : '',
            fontName ? `<span class="dc-status-chip" style="${fontStyle}">${escapeHtml(fontName)}</span>` : '',
            getBadge(v.dialogueCount || 0) ? `<span class="dc-status-chip">${getBadge(v.dialogueCount || 0)}</span>` : ''
        ].filter(Boolean).join('');
        const aliasChips = (v.aliases || []).map(a =>
            `<span class="dc-alias-chip">${escapeHtml(a)}<span class="dc-alias-remove" data-key="${safeKey}" data-alias="${escapeAttr(a)}" title="Remove alias">&times;</span></span>`
        ).join('');
        return `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''} ${v.keep ? 'dc-char-kept' : ''}" data-key="${safeKey}">
                <div class="dc-char-main">
                    <span class="dc-color-swatch">
                        <span class="dc-color-dot" style="background:${safeColor};"></span>
                        <input type="color" value="${pickerColor}" data-key="${safeKey}" class="dc-color-input">
                    </span>
                    <input type="text" value="${escapeAttr(pickerColor)}" data-key="${safeKey}" class="dc-color-hex text_pole" inputmode="text" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="7" aria-label="Hex color for ${escapeAttr(v.name)}" title="Enter a hex color like #ff66cc">
                    <div class="dc-char-name-wrap" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + escapeHtml(v.aliases.join(', ')) : ''}${v.group ? '\nGroup: ' + escapeHtml(v.group) : ''}${fontName ? '\nFont: ' + escapeHtml(fontName) : ''}">
                        <div class="dc-char-name" style="color:${safeColor};${fontStyle}">${escapeHtml(v.name)}</div>
                        <div class="dc-char-meta">
                            <span class="dc-char-count">${v.dialogueCount || 0} lines</span>
                            ${statusBadges}
                        </div>
                    </div>
                    <button class="dc-keep menu_button ${v.keep ? 'dc-toggle-active' : ''}" data-key="${safeKey}" title="Keep this character even when clearing or bulk deleting">${v.keep ? 'Kept' : 'Keep'}</button>
                    <button class="dc-lock menu_button ${v.locked ? 'dc-toggle-active' : ''}" data-key="${safeKey}" title="Lock color">${v.locked ? 'Locked' : 'Lock'}</button>
                    <button class="dc-del menu_button dc-danger-button" data-key="${safeKey}" title="Delete character">Delete</button>
                    <button class="dc-more menu_button" data-key="${safeKey}" title="Show more tools">${rowExpanded ? 'Less' : 'More'}</button>
                </div>
                ${aliasChips ? `<div class="dc-alias-list">${aliasChips}</div>` : ''}
                ${rowExpanded ? `
                <div class="dc-char-advanced">
                    <div class="dc-inline-toolbar">
                        <button class="dc-swap menu_button" data-key="${safeKey}" title="Swap colors">Swap</button>
                        <button class="dc-style menu_button" data-key="${safeKey}" title="Cycle text style">Style: ${escapeHtml(styleLabel)}</button>
                        <button class="dc-font menu_button" data-key="${safeKey}" title="Set Google Font">${fontName ? 'Edit Font' : 'Set Font'}</button>
                        <button class="dc-alias menu_button" data-key="${safeKey}" title="Add alias">Add Alias</button>
                        <button class="dc-group menu_button" data-key="${safeKey}" title="Assign group">${v.group ? 'Edit Group' : 'Set Group'}</button>
                    </div>
                </div>` : ''}
            </div>`;
    }

    function buildCharRowSignature(k, v) {
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
            (v.aliases || []).join('\u0001'),
            v.name || ''
        ].join('\u0002');
    }

    function htmlToNode(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(html).trim();
        return tpl.content.firstElementChild;
    }

    function applyColorInputForElement(i, options = {}) {
        const c = characterColors[i.dataset.key];
        if (!c) return false;
        if (applyCharacterBaseColor(i.dataset.key, normalizeHexColor(i.value, getBaseColor(c)), options)) {
            queueColorStateSave();
            return true;
        }
        return false;
    }

    function applyHexInputForElement(i, options = {}) {
        const c = characterColors[i.dataset.key];
        if (!c) return false;
        const nextColor = normalizeManualColorInput(i.value, null);
        if (!nextColor) {
            i.value = getBaseColor(c);
            toast.warning('Enter a hex color like #ff66cc.');
            return false;
        }
        if (applyCharacterBaseColor(i.dataset.key, nextColor, options)) queueColorStateSave();
        return true;
    }

    // Event delegation: handlers are installed once on the list container, so
    // re-rendering rows never needs to rebind per-row listeners.
    function installCharListDelegation(list) {
        if (list.__dcDelegated) return;
        list.__dcDelegated = true;

        const stopPropagation = e => e.stopPropagation();
        list.addEventListener('touchstart', stopPropagation, { passive: true });
        list.addEventListener('touchmove', stopPropagation, { passive: true });
        list.addEventListener('touchend', stopPropagation, { passive: true });
        list.addEventListener('wheel', stopPropagation, { passive: true });

        list.addEventListener('input', (e) => {
            const t = e.target;
            if (t.classList && t.classList.contains('dc-color-input')) {
                applyColorInputForElement(t);
            }
        });

        list.addEventListener('change', (e) => {
            const t = e.target;
            if (!t.classList) return;
            if (t.classList.contains('dc-color-input')) {
                applyColorInputForElement(t, { saveImmediately: true });
                maybeAutoRecolorAfterColorChange();
            } else if (t.classList.contains('dc-color-hex')) {
                if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
            }
        });

        list.addEventListener('keydown', (e) => {
            const t = e.target;
            if (t.classList && t.classList.contains('dc-color-hex') && e.key === 'Enter') {
                e.preventDefault();
                if (applyHexInputForElement(t, { saveImmediately: true })) maybeAutoRecolorAfterColorChange();
                t.blur();
            }
        });

        list.addEventListener('dblclick', (e) => {
            const t = e.target;
            if (t.classList && t.classList.contains('dc-color-input')) {
                e.preventDefault();
                showHarmonyPopup(t.dataset.key, t);
            }
        });

        list.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.closest) return;

            const dotEl = t.closest('.dc-color-dot');
            if (dotEl) {
                const input = dotEl.nextElementSibling;
                if (input?.classList.contains('dc-color-input')) input.click();
                return;
            }
            const moreBtn = t.closest('.dc-more');
            if (moreBtn) {
                toggleCharacterRowExpansion(moreBtn.dataset.key);
                updateCharList();
                return;
            }
            const delBtn = t.closest('.dc-del');
            if (delBtn) {
                removeCharacterKeys([delBtn.dataset.key], {
                    actionLabel: 'Deleted',
                    emptyMessage: 'Character already removed.',
                    blockedMessage: 'Turn off Keep before deleting this character.'
                });
                return;
            }
            const keepBtn = t.closest('.dc-keep');
            if (keepBtn) {
                const key = keepBtn.dataset.key;
                if (!characterColors[key]) return;
                characterColors[key].keep = !characterColors[key].keep;
                saveHistory();
                saveData();
                updateCharList();
                toast.info(characterColors[key].keep ? `${characterColors[key].name} will now survive Clear and bulk delete.` : `${characterColors[key].name} can now be cleared or deleted normally.`);
                return;
            }
            const lockBtn = t.closest('.dc-lock');
            if (lockBtn) {
                const key = lockBtn.dataset.key;
                if (!characterColors[key]) return;
                const wasLocked = !!characterColors[key].locked;
                characterColors[key].locked = !characterColors[key].locked;
                saveHistory();
                saveData(); updateCharList();
                if (!wasLocked && characterColors[key]?.locked) {
                    const duplicateKeys = collectDuplicateColorKeys();
                    if (duplicateKeys.length) {
                        removeCharacterKeys(duplicateKeys, {
                            actionLabel: 'Auto-cleared',
                            itemLabel: 'duplicate-color character',
                            blockedMessage: 'Only pinned duplicate-color characters remain. Turn off Keep first.'
                        });
                    }
                }
                return;
            }
            const swapBtn = t.closest('.dc-swap');
            if (swapBtn) {
                if (!swapMode) { swapMode = swapBtn.dataset.key; updateCharList(); toast.info('Click another character to swap'); }
                else if (swapMode === swapBtn.dataset.key) { swapMode = null; updateCharList(); }
                else { swapColors(swapMode, swapBtn.dataset.key); swapMode = null; }
                return;
            }
            const styleBtn = t.closest('.dc-style');
            if (styleBtn) {
                const key = styleBtn.dataset.key;
                if (!characterColors[key]) return;
                const styles = ['', 'bold', 'italic', 'bold italic'];
                const curr = characterColors[key].style || '';
                characterColors[key].style = styles[(styles.indexOf(curr) + 1) % styles.length];
                commit();
                repaintDomAfterCharacterDataChange(0);
                return;
            }
            const aliasRemoveBtn = t.closest('.dc-alias-remove');
            if (aliasRemoveBtn) {
                e.stopPropagation();
                const key = aliasRemoveBtn.dataset.key;
                const alias = aliasRemoveBtn.dataset.alias;
                if (characterColors[key]?.aliases) {
                    const nextAliases = characterColors[key].aliases.filter(a => a !== alias);
                    if (nextAliases.length !== characterColors[key].aliases.length) {
                        characterColors[key].aliases = nextAliases;
                        commit();
                        repaintDomAfterCharacterDataChange(0);
                    }
                }
                return;
            }
            const aliasBtn = t.closest('.dc-alias');
            if (aliasBtn) {
                const row = aliasBtn.closest('.dc-char');
                const existing = row.querySelector('.dc-inline-input');
                if (existing) { existing.remove(); return; }
                const inputRow = document.createElement('div');
                inputRow.className = 'dc-inline-input';
                inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
                inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Alias name..." style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Add</button>`;
                row.appendChild(inputRow);
                const inp = inputRow.querySelector('input');
                inp.focus();
                const submit = () => {
                    const alias = inp.value.trim();
                    if (alias) {
                        const aliases = characterColors[aliasBtn.dataset.key].aliases = characterColors[aliasBtn.dataset.key].aliases || [];
                        if (!aliases.includes(alias)) {
                            aliases.push(alias);
                            commit();
                            repaintDomAfterCharacterDataChange(0);
                        } else {
                            inputRow.remove();
                        }
                    }
                    else inputRow.remove();
                };
                inputRow.querySelector('button').onclick = submit;
                inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
                return;
            }
            const fontBtn = t.closest('.dc-font');
            if (fontBtn) {
                const row = fontBtn.closest('.dc-char');
                const existing = row.querySelector('.dc-inline-input');
                if (existing) { existing.remove(); return; }
                const key = fontBtn.dataset.key;
                const current = normalizeGoogleFontName(characterColors[key]?.font);
                const inputRow = document.createElement('div');
                inputRow.className = 'dc-inline-input';
                inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
                inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Google Font name..." value="${escapeAttr(current)}" style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Set</button>`;
                row.appendChild(inputRow);
                const inp = inputRow.querySelector('input');
                inp.focus();
                inp.select();
                const submit = () => {
                    if (!characterColors[key]) { inputRow.remove(); return; }
                    const nextFont = normalizeGoogleFontName(inp.value);
                    if ((normalizeGoogleFontName(characterColors[key].font)) !== nextFont) {
                        characterColors[key].font = nextFont;
                        if (nextFont) loadGoogleFont(nextFont);
                        commit();
                        repaintDomAfterCharacterDataChange(0);
                    } else {
                        inputRow.remove();
                    }
                };
                inputRow.querySelector('button').onclick = submit;
                inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
                return;
            }
            const groupBtn = t.closest('.dc-group');
            if (groupBtn) {
                const row = groupBtn.closest('.dc-char');
                const existing = row.querySelector('.dc-inline-input');
                if (existing) { existing.remove(); return; }
                const key = groupBtn.dataset.key;
                const current = characterColors[key]?.group || '';
                const inputRow = document.createElement('div');
                inputRow.className = 'dc-inline-input';
                inputRow.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 26px;';
                inputRow.innerHTML = `<input type="text" class="text_pole" placeholder="Group name..." value="${escapeHtml(current)}" style="flex:1;padding:2px 4px;font-size:0.8em;"><button class="menu_button" style="padding:2px 6px;font-size:0.8em;">Set</button>`;
                row.appendChild(inputRow);
                const inp = inputRow.querySelector('input');
                inp.focus();
                inp.select();
                const submit = () => {
                    const nextGroup = inp.value.trim();
                    if ((characterColors[key]?.group || '') !== nextGroup) {
                        characterColors[key].group = nextGroup;
                        saveHistory();
                        saveData(); updateCharList();
                    } else {
                        inputRow.remove();
                    }
                };
                inputRow.querySelector('button').onclick = submit;
                inp.onkeydown = ev => { if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') inputRow.remove(); };
                return;
            }
        });
    }

    // Phase 5B: Alias chips, Phase 6B: Group headers, Phase 5D: Harmony on dblclick
    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        installCharListDelegation(list);
        const entries = getSortedEntries();
        const countEl = document.getElementById('dc-count');
        if (countEl) countEl.textContent = Object.keys(characterColors).length;

        if (!entries.length) {
            list.innerHTML = `<small style="opacity:0.6;">${searchTerm ? 'No matches' : 'No characters'}</small>`;
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
                    desired.push({ blockKey: '__group__:' + g, sig: 'h:' + g, html: `<div class="dc-group-header">${escapeHtml(g)}</div>` });
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
        for (const item of desired) {
            let node = existing.get(item.blockKey);
            if (!(node && node.getAttribute('data-dc-sig') === item.sig)) {
                node = htmlToNode(item.html);
                node.setAttribute('data-dc-block', item.blockKey);
                node.setAttribute('data-dc-sig', item.sig);
            }
            list.appendChild(node);
            used.add(node);
        }
        for (const node of Array.from(list.children)) {
            if (!used.has(node)) node.remove();
        }

        applyControlHelpText(list);
        updateLegend();
    }

    function setControlHelp(element, text) {
        if (!element || !text) return;
        element.title = text;
        element.setAttribute('aria-label', text);
    }

    function applyControlHelpText(root = document) {
        root.querySelectorAll('[data-help]').forEach(el => setControlHelp(el, el.dataset.help));
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        for (const [selector, text] of Object.entries(DYNAMIC_CONTROL_HELP_TEXT)) {
            scope.querySelectorAll(selector).forEach(el => setControlHelp(el, text));
        }
    }

    function updateEngineVisibility() {
        const domMode = isDomEngine();
        document.querySelectorAll('#dc-ext .dc-llm-only').forEach(el => {
            el.style.display = domMode ? 'none' : '';
        });
        document.querySelectorAll('#dc-ext .dc-dom-only').forEach(el => {
            el.style.display = domMode ? '' : 'none';
        });
        const recolorButton = document.getElementById('dc-recolor');
        if (recolorButton && !recolorButton.disabled) {
            recolorButton.textContent = domMode ? 'Refresh DOM Colors' : 'Recolor Chat';
        }
        updateSystemPromptDisplay();
    }

    function autoAssignFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const key = char?.name?.toLowerCase();
            if (key && !characterColors[key]) {
                addCharacter(char.name);
                toast.success(`Added ${char.name}`);
            }
        } catch { }
    }

    function syncUIWithSettings() {
        const $ = id => document.getElementById(id);
        normalizeToggleSettings();
        if ($('dc-enabled')) $('dc-enabled').checked = settings.enabled;
        if ($('dc-highlight')) $('dc-highlight').checked = settings.highlightMode;
        if ($('dc-autoscan')) $('dc-autoscan').checked = settings.autoScanOnLoad !== false;
        if ($('dc-autoscan-new')) $('dc-autoscan-new').checked = settings.autoScanNewMessages !== false;
        if ($('dc-auto-lock')) $('dc-auto-lock').checked = settings.autoLockDetected !== false;
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
        if ($('dc-share-global')) $('dc-share-global').checked = settings.shareColorsGlobally || false;
        if ($('dc-css-effects')) $('dc-css-effects').checked = settings.cssEffects || false;
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
        if ($('dc-prompt-role')) $('dc-prompt-role').value = settings.promptRole || 'user';
        if ($('dc-prompt-mode')) $('dc-prompt-mode').value = settings.promptMode || 'inject';
        if ($('dc-sort')) $('dc-sort').value = settings.sortMode || 'name';
        refreshPresetDropdown();
        refreshPaletteDropdown();
        updateSystemPromptDisplay();
        updateEngineVisibility();
        updateAutoSyncUI();
        applyControlHelpText();
    }

    function createUI() {
        if (document.getElementById('dc-ext')) return;
        const html = `
        <div id="dc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content" style="padding:10px;font-size:0.9em;">
                <details class="dc-section" open>
                    <summary>Basic</summary>
                    <p class="dc-section-note">The everyday controls live here. Clear keeps any character marked with Keep.</p>
                    <div class="dc-stack">
                        <div class="dc-field-row">
                            <label class="dc-inline-label" for="dc-engine">Coloring engine</label>
                            <select id="dc-engine" class="text_pole" data-help="Choose LLM prompt-based coloring or local DOM-only coloring that never edits chat text."><option value="llm">LLM</option><option value="dom">Local (DOM-only)</option></select>
                            <small class="dc-dom-only" style="display:none;opacity:0.72;flex-basis:100%;">DOM mode colors rendered quotes locally, stores quote overrides in chat metadata, and can optionally use the selected LLM profile to verify attribution after generation.</small>
                        </div>
                        <div class="dc-button-row dc-button-row-3">
                            <button id="dc-scan" class="menu_button" data-help="Scan the current chat for characters and colors.">Scan Chat</button>
                            <button id="dc-clear" class="menu_button dc-danger-button" data-help="Clear tracked characters, but keep anything pinned with Keep.">Clear Non-Kept</button>
                            <button id="dc-recolor" class="menu_button" data-help="Rewrite message colors to match the current character assignments.">Recolor Chat</button>
                        </div>
                        <div class="dc-button-row dc-button-row-3">
                            <button id="dc-colorize" class="menu_button dc-llm-only" data-help="Colorize uncolored messages. Shift-click for only the latest message.">Colorize Missing</button>
                            <button id="dc-verify-attr" class="menu_button dc-dom-only" style="display:none;" data-help="Verify DOM quote attribution with the selected LLM profile. Shift-click scans visible unverified messages.">Verify Colors (LLM)</button>
                            <button id="dc-stats" class="menu_button" data-help="Open dialogue statistics for tracked characters.">Show Stats</button>
                        </div>
                        <div class="dc-field-row">
                            <label class="dc-inline-label" for="dc-theme">Theme</label>
                            <select id="dc-theme" class="text_pole" data-help="Choose Auto, Dark, or Light targeting for generated color readability."><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                        </div>
                        <div class="dc-field-row">
                            <label class="dc-inline-label" for="dc-palette">Palette</label>
                            <select id="dc-palette" class="text_pole" data-help="Pick the color palette used for new or regenerated character colors."></select>
                        </div>
                        <div class="dc-field-row">
                            <label class="dc-inline-label" for="dc-brightness">Brightness</label>
                            <input type="range" id="dc-brightness" min="-100" max="100" value="0" data-help="Bias newly generated colors lighter or darker.">
                            <span id="dc-bright-val" class="dc-inline-value">0</span>
                        </div>
                        <div class="dc-toggle-grid">
                            <label class="checkbox_label"><input type="checkbox" id="dc-enabled" data-help="Enable or disable Dialogue Colors."><span>Enable Dialogue Colors</span></label>
                            <label class="checkbox_label"><input type="checkbox" id="dc-highlight" data-help="Add background highlights behind colored dialogue."><span>Highlight dialogue</span></label>
                            <label class="checkbox_label"><input type="checkbox" id="dc-legend" data-help="Show a floating legend of active character colors."><span>Show floating legend</span></label>
                            <label class="checkbox_label"><input type="checkbox" id="dc-css-effects" data-help="Allow transform-based CSS effects for dramatic dialogue."><span>Enable CSS effects</span></label>
                            <label class="checkbox_label"><input type="checkbox" id="dc-auto-recolor" data-help="Automatically recolor chat after color changes."><span>Auto-recolor after changes</span></label>
                            <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-stealth-colors" data-help="In DOM mode, inject a slim instruction for the model to include [COLORS:Name=#RRGGBB] for new speakers."><span>Stealth colors block</span></label>
                            <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-llm-attr-check" data-help="In DOM mode, automatically ask the selected LLM profile to verify rendered unverified messages and save metadata corrections."><span>LLM attribution check</span></label>
                            <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-llm-attr-parallel" data-help="During streaming in DOM mode, verify quote attribution after 2-second pauses so corrections can appear before generation fully ends."><span>LLM streaming attribution</span></label>
                            <label class="checkbox_label dc-dom-only"><input type="checkbox" id="dc-attr-conservative" data-help="In DOM mode, the LLM verifier will only fill Uncolored/Unknown segments and will not overwrite existing colors."><span>Conservative verify</span></label>
                        </div>
                        <div class="dc-field-row dc-dom-only">
                            <label class="dc-inline-label" for="dc-attr-profile">Verify profile</label>
                            <select id="dc-attr-profile" class="text_pole" data-help="Connection profile to use for LLM attribution verification."><option value="">-- Use main chat AI --</option></select>
                        </div>
                        <div class="dc-field-row dc-dom-only">
                            <label class="dc-inline-label" for="dc-attr-max-tokens">Verify tokens</label>
                            <input type="number" id="dc-attr-max-tokens" min="256" max="32768" value="4096" class="text_pole" data-help="Maximum tokens for the LLM verifier. Increase for reasoning models that think before outputting JSON.">
                        </div>
                        <div class="dc-field-row dc-llm-only">
                            <label class="dc-inline-label" for="dc-prompt-depth">Depth</label>
                            <input type="number" id="dc-prompt-depth" min="0" max="99" value="1" class="text_pole" data-help="How far from the chat end the prompt is injected.">
                        </div>
                        <div class="dc-field-row dc-llm-only">
                            <label class="dc-inline-label" for="dc-prompt-role">Role</label>
                            <select id="dc-prompt-role" class="text_pole" data-help="Inject the prompt as a system or user message."><option value="system">System</option><option value="user">User</option></select>
                        </div>
                        <div class="dc-field-row dc-llm-only">
                            <label class="dc-inline-label" for="dc-prompt-mode">Mode</label>
                            <select id="dc-prompt-mode" class="text_pole" data-help="Inject automatically or use the macro manually."><option value="inject">Inject</option><option value="macro">Macro</option></select>
                        </div>
                    </div>
                </details>
                <details class="dc-section" open>
                    <summary>Characters</summary>
                    <p class="dc-section-note">Keep marks main characters so they survive Clear and all bulk delete tools.</p>
                    <div class="dc-stack">
                        <div class="dc-field-row dc-field-row-wrap">
                            <input type="text" id="dc-search" placeholder="Search characters..." class="text_pole" data-help="Filter characters by name.">
                            <select id="dc-sort" class="text_pole" data-help="Sort by name, dialogue count, or group. This preference is saved and restored across sessions."><option value="name">Sort: Name</option><option value="count">Sort: Dialogue Count</option><option value="group">Sort: Group</option></select>
                        </div>
                        <div class="dc-field-row dc-field-row-wrap">
                            <input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" data-help="Type a new character name to add manually.">
                            <button id="dc-add-btn" class="menu_button" data-help="Add the typed character with a suggested color.">Add Character</button>
                        </div>
                        <small>Characters: <span id="dc-count">0</span> (⭐=50+, 💎=100+)</small>
                        <div id="dc-char-list" class="dc-char-list"></div>
                    </div>
                </details>
                <details class="dc-section">
                    <summary>Advanced</summary>
                    <p class="dc-section-note">Less common tools live here so the main workflow stays simple.</p>
                    <div class="dc-stack">
                        <details class="dc-subsection">
                            <summary>Automation</summary>
                            <div class="dc-stack">
                                <div class="dc-toggle-grid">
                                    <label class="checkbox_label"><input type="checkbox" id="dc-autoscan" data-help="Automatically scan existing chat messages after chat load."><span>Auto-scan on chat load</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-autoscan-new" data-help="Automatically scan newly arriving messages for speakers/colors."><span>Auto-scan new messages</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-auto-lock" data-help="Automatically lock newly detected characters."><span>Auto-lock new characters</span></label>
                                    <label class="checkbox_label dc-llm-only"><input type="checkbox" id="dc-auto-colorize" data-help="Automatically colorize messages when the model skips color tags."><span>Auto-colorize fallback</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-right-click" data-help="Enable right-click or long-press reassignment on dialogue."><span>Enable right-click reassignment</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-disable-narration" data-help="Skip narrator color instructions."><span>Disable narration coloring</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-share-global" data-help="Use one shared color table across all chats."><span>Share colors across chats</span></label>
                                    <label class="checkbox_label"><input type="checkbox" id="dc-disable-toasts" data-help="Suppress non-error toast notifications."><span>Reduce toast popups</span></label>
                                </div>
                                <div class="dc-field-row dc-llm-only">
                                    <label class="dc-inline-label" for="dc-llm-profile">LLM Profile</label>
                                    <select id="dc-llm-profile" class="text_pole" data-help="Connection profile to use for LLM colorization."><option value="">-- Use main chat AI --</option></select>
                                </div>
                            </div>
                        </details>
                        <details class="dc-subsection">
                            <summary>Prompt & narration</summary>
                            <div class="dc-stack">
                                <div class="dc-field-row">
                                    <label class="dc-inline-label" for="dc-narrator">Narrator</label>
                                    <input type="color" id="dc-narrator" value="#888888" data-help="Set narrator fallback color.">
                                    <button id="dc-narrator-clear" class="menu_button" data-help="Reset narrator color to default.">Reset Narrator</button>
                                </div>
                                <div class="dc-field-row dc-field-row-wrap">
                                    <label class="dc-inline-label" for="dc-thought-symbols">Thoughts</label>
                                    <input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" data-help="Symbols used to detect inner-thought dialogue.">
                                    <button id="dc-thought-add" class="menu_button" data-help="Append another thought symbol.">Add Symbol</button>
                                    <button id="dc-thought-clear" class="menu_button" data-help="Remove all thought symbols.">Clear Symbols</button>
                                </div>
                                <div id="dc-system-prompt-container" class="dc-llm-only" style="display:none;">
                                    <label style="font-weight:bold;margin-bottom:4px;display:block;">Add to your system prompt:</label>
                                    <textarea id="dc-system-prompt-text" readonly class="text_pole" style="width:100%;min-height:60px;font-size:0.75em;font-family:monospace;resize:vertical;">{{dialoguecolors}}</textarea>
                                    <button id="dc-copy-system-prompt" class="menu_button" style="margin-top:4px;width:100%;">Copy Macro</button>
                                </div>
                            </div>
                        </details>
                        <details class="dc-subsection">
                            <summary>Palette tools</summary>
                            <div class="dc-stack">
                                <div class="dc-field-row dc-field-row-wrap">
                                    <input type="text" id="dc-palette-name-input" placeholder="Palette name..." class="text_pole" data-help="Name used when creating or saving a custom palette.">
                                    <input type="text" id="dc-palette-notes-input" placeholder="Palette notes (optional)" class="text_pole" data-help="Optional notes for generated palettes.">
                                </div>
                                <label class="checkbox_label"><input type="checkbox" id="dc-overwrite-existing" data-help="Allow replacing an existing custom palette with the same name."><span>Overwrite existing custom palette</span></label>
                                <div class="dc-button-row dc-button-row-3">
                                    <button id="dc-gen-palette" class="menu_button" data-help="Generate a custom palette from the name and notes fields.">Generate Palette</button>
                                    <button id="dc-save-palette" class="menu_button" data-help="Save current character colors as a custom palette.">Save Current As Palette</button>
                                    <button id="dc-del-palette" class="menu_button dc-danger-button" data-help="Delete the currently selected custom palette.">Delete Selected Palette</button>
                                </div>
                            </div>
                        </details>
                        <details class="dc-subsection">
                            <summary>Presets & import/export</summary>
                            <div class="dc-stack">
                                <div class="dc-button-row dc-button-row-1">
                                    <button id="dc-restore-defaults" class="menu_button dc-danger-button" data-help="Reset all settings to their default values. Character colors are preserved.">Restore All Settings to Defaults</button>
                                </div>
                                <hr style="margin:8px 0;opacity:0.2;">
                                <div class="dc-field-row dc-field-row-wrap">
                                    <input type="text" id="dc-preset-name" placeholder="Preset name..." class="text_pole" data-help="Preset name used when saving current assignments.">
                                    <button id="dc-save-preset" class="menu_button" data-help="Save current assignments into a named preset.">Save Preset</button>
                                </div>
                                <div class="dc-field-row dc-field-row-wrap">
                                    <select id="dc-preset-select" class="text_pole" data-help="Select a preset to load or delete."><option value="">-- Select Preset --</option></select>
                                    <button id="dc-load-preset" class="menu_button" data-help="Load the selected preset into the current character list.">Load Preset</button>
                                    <button id="dc-delete-preset" class="menu_button dc-danger-button" data-help="Delete the selected preset.">Delete Preset</button>
                                </div>
                                <div class="dc-button-row dc-button-row-3">
                                    <button id="dc-export" class="menu_button" data-help="Export colors and settings to JSON.">Export Colors</button>
                                    <button id="dc-import" class="menu_button" data-help="Import colors and settings from JSON.">Import Colors</button>
                                    <button id="dc-export-png" class="menu_button" data-help="Export the floating legend as an image.">Export Legend PNG</button>
                                </div>
                                <div class="dc-button-row dc-button-row-2">
                                    <button id="dc-export-settings" class="menu_button" data-help="Export only settings to JSON.">Export Settings</button>
                                    <button id="dc-import-settings" class="menu_button" data-help="Import settings without overwriting local colors.">Import Settings</button>
                                </div>
                                <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                                <input type="file" id="dc-import-settings-file" accept=".json" style="display:none;">
                            </div>
                        </details>
                        <details class="dc-subsection">
                            <summary>Card & sync</summary>
                            <div class="dc-stack">
                                <div class="dc-button-row dc-button-row-2">
                                    <button id="dc-card" class="menu_button" data-help="Add the current card character if missing.">Add Current Card</button>
                                    <button id="dc-avatar-color" class="menu_button" data-help="Use the current avatar's dominant color.">Use Avatar Color</button>
                                </div>
                                <div class="dc-button-row dc-button-row-2">
                                    <button id="dc-save-card" class="menu_button" data-help="Save this chat color data into the character card.">Save To Card</button>
                                    <button id="dc-load-card" class="menu_button" data-help="Load saved color data from the character card.">Load From Card</button>
                                </div>
                                <div class="dc-button-row dc-button-row-2">
                                    <button id="dc-setup-autosync" class="menu_button" data-help="Enable automatic settings sync across devices.">Enable Auto-Sync</button>
                                    <button id="dc-disable-autosync" class="menu_button" style="display:none;" data-help="Disable automatic settings synchronization.">Disable Auto-Sync</button>
                                </div>
                                <span id="dc-autosync-status" class="dc-status-text"></span>
                            </div>
                        </details>
                        <details class="dc-subsection">
                            <summary>Maintenance</summary>
                            <div class="dc-stack">
                                <div class="dc-button-row dc-button-row-3">
                                    <button id="dc-undo" class="menu_button" data-help="Undo the last color-table change.">Undo</button>
                                    <button id="dc-redo" class="menu_button" data-help="Redo the last undone change.">Redo</button>
                                    <button id="dc-fix-conflicts" class="menu_button" data-help="Auto-resolve colors that are too similar.">Fix Similar Colors</button>
                                </div>
                                <div class="dc-button-row dc-button-row-3">
                                    <button id="dc-regen" class="menu_button" data-help="Regenerate colors for unlocked characters.">Regenerate Unlocked</button>
                                    <button id="dc-flip-theme" class="menu_button" data-help="Flip color lightness for theme switching.">Flip For Theme</button>
                                    <button id="dc-storage" class="menu_button" data-help="Browse and clear stored color data across chats.">Storage Manager</button>
                                </div>
                            </div>
                        </details>
                    </div>
                </details>
                <details class="dc-section dc-danger-zone">
                    <summary>Danger Zone</summary>
                    <p class="dc-section-note">Pinned characters are protected here too. Turn off Keep first if you really want to remove them.</p>
                    <div class="dc-stack">
                        <div class="dc-button-row dc-button-row-3">
                            <button id="dc-lock-all" class="menu_button" data-help="Lock every tracked character color.">Lock All</button>
                            <button id="dc-unlock-all" class="menu_button" data-help="Unlock every tracked character color.">Unlock All</button>
                            <button id="dc-reset" class="menu_button dc-danger-button" data-help="Reassign random palette colors to all unlocked characters.">Reset Unlocked Colors</button>
                        </div>
                        <div class="dc-button-row dc-button-row-2">
                            <button id="dc-del-locked" class="menu_button dc-danger-button" data-help="Delete all locked characters except kept ones.">Delete Locked</button>
                            <button id="dc-del-unlocked" class="menu_button dc-danger-button" data-help="Delete all unlocked characters except kept ones.">Delete Unlocked</button>
                        </div>
                        <div class="dc-field-row dc-field-row-wrap">
                            <input type="number" id="dc-del-least-threshold" min="0" value="3" class="text_pole" data-help="Minimum dialogue count to keep when using the threshold delete tool.">
                            <button id="dc-del-least" class="menu_button dc-danger-button" data-help="Delete characters below the dialogue threshold, except kept ones.">Delete Below Threshold</button>
                        </div>
                        <div class="dc-button-row dc-button-row-1">
                            <button id="dc-del-dupes" class="menu_button dc-danger-button" data-help="Delete duplicate-color characters, keeping the highest dialogue count and any kept characters.">Delete Duplicate Colors</button>
                        </div>
                    </div>
                </details>
                <hr style="margin:8px 0 4px;opacity:0.2;">
                <small>Preview:</small>
                <div id="dc-prompt-preview" style="font-size:0.75em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        const $ = id => document.getElementById(id);

        syncUIWithSettings();

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
        };
        $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
        $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
        $('dc-autoscan-new').onchange = e => { settings.autoScanNewMessages = e.target.checked; saveData(); };
        $('dc-auto-lock').onchange = e => { settings.autoLockDetected = e.target.checked; saveData(); };
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
        $('dc-attr-max-tokens').oninput = e => { settings.attributionMaxTokens = parseInt(e.target.value, 10) || 4096; saveData(); };
        $('dc-stealth-colors').onchange = e => { settings.domStealthColors = e.target.checked; saveData(); injectPrompt(); };
        $('dc-right-click').onchange = e => { settings.enableRightClick = e.target.checked; saveData(); };
        $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
        $('dc-disable-narration').onchange = e => { settings.disableNarration = e.target.checked; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
        $('dc-share-global').onchange = e => { settings.shareColorsGlobally = e.target.checked; saveData(); loadData(); updateCharList(); injectPrompt(); scheduleCustomFontRefresh(0); };
        $('dc-css-effects').onchange = e => { settings.cssEffects = e.target.checked; saveData(); injectPrompt(); };
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
            saveData(); updateCharList(); injectPrompt(); flushChatSave();
        };
        $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); injectPrompt(); };
        $('dc-brightness').oninput = e => {
            const brightness = parseInt(e.target.value, 10) || 0;
            $('dc-bright-val').textContent = String(brightness);
            applyThemeOrBrightnessChange(() => { settings.brightness = brightness; });
            queueColorStateSave({ history: false });
        };
        $('dc-brightness').onchange = () => { flushColorStateSave(); flushChatSave(); };
        $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); };
        $('dc-thought-symbols').oninput = e => { settings.thoughtSymbols = e.target.value; saveData(); injectPrompt(); scheduleDomRefreshSeries(); };
        $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); scheduleDomRefreshSeries(0); } };
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
        $('dc-clear').onclick = () => {
            const allKeys = Object.keys(characterColors);
            const keptKeys = getKeptKeys(allKeys);
            if (!allKeys.length) { toast.info('No characters to clear'); return; }
            if (keptKeys.length === allKeys.length) {
                toast.info('Only pinned characters remain. Turn off Keep to clear them.');
                return;
            }
            const restore = createRestoreSnapshot();
            keepCharacterKeysOnly(keptKeys);
            commit();
            repaintDomAfterCharacterDataChange(0);
            showUndoToast(buildKeepAwareRemovalMessage('Cleared', allKeys.length - keptKeys.length, keptKeys.length), restore);
        };
        $('dc-stats').onclick = showStatsPopup;
        $('dc-recolor').onclick = () => {
            if (confirm('Recolor all messages with current color assignments?')) recolorAllMessages();
        };
        $('dc-colorize').onclick = (e) => {
            if (e.shiftKey) colorizeMessages('last');
            else if (confirm('Colorize all uncolored messages with known character colors?')) colorizeMessages('all');
        };
        $('dc-verify-attr').onclick = (e) => {
            if (e.shiftKey) runAttributionVerification(() => verifyVisibleAttributionsWithLLM({ manual: true }), { manual: true });
            else runAttributionVerification(() => verifyLatestAttributionsWithLLM({ manual: true }), { manual: true });
        };
        $('dc-fix-conflicts').onclick = autoResolveConflicts;
        $('dc-regen').onclick = regenerateAllColors;
        $('dc-flip-theme').onclick = flipColorsForTheme;
        $('dc-restore-defaults').onclick = restoreAllSettingsToDefaults;
        $('dc-save-preset').onclick = saveColorPreset;
        $('dc-load-preset').onclick = loadColorPreset;
        $('dc-delete-preset').onclick = deleteColorPreset;
        $('dc-gen-palette').onclick = async () => { await generateCustomPaletteFromWords(); };
        $('dc-save-palette').onclick = saveCustomPalette;
        $('dc-palette-name-input').onkeypress = e => { if (e.key === 'Enter') $('dc-gen-palette').click(); };
        $('dc-palette-notes-input').onkeypress = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('dc-gen-palette').click(); };
        $('dc-del-palette').onclick = deleteCustomPalette;
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
                toast.success(`Set ${char.name} to ${color}`);
            } catch {
                toast.error('Failed to extract avatar color');
            }
        };
        $('dc-save-card').onclick = saveToCard;
        $('dc-load-card').onclick = loadFromCard;
        $('dc-undo').onclick = undo;
        $('dc-redo').onclick = redo;
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-export-png').onclick = exportLegendPng;
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        $('dc-export-settings').onclick = exportSettings;
        $('dc-import-settings').onclick = () => $('dc-import-settings-file').click();
        $('dc-import-settings-file').onchange = e => { if (e.target.files[0]) importSettings(e.target.files[0]); };
        $('dc-setup-autosync').onclick = () => { enableAutoSync(); updateAutoSyncUI(); };
        $('dc-disable-autosync').onclick = () => { disableAutoSync(); updateAutoSyncUI(); };
        $('dc-del-locked').onclick = () => {
            removeCharacterKeys(Object.keys(characterColors).filter(k => characterColors[k]?.locked), {
                actionLabel: 'Deleted',
                itemLabel: 'locked character',
                emptyMessage: 'No locked characters to delete',
                blockedMessage: 'Only pinned locked characters remain. Turn off Keep first.'
            });
        };
        $('dc-del-unlocked').onclick = () => {
            removeCharacterKeys(Object.keys(characterColors).filter(k => characterColors[k] && !characterColors[k].locked), {
                actionLabel: 'Deleted',
                itemLabel: 'unlocked character',
                emptyMessage: 'No unlocked characters to delete',
                blockedMessage: 'Only pinned unlocked characters remain. Turn off Keep first.'
            });
        };
        $('dc-del-least').onclick = () => {
            const min = parseInt($('dc-del-least-threshold')?.value || '3', 10);
            if (isNaN(min) || min < 0) { toast.warning('Invalid threshold'); return; }
            removeCharacterKeys(Object.keys(characterColors).filter(k => (characterColors[k]?.dialogueCount || 0) < min), {
                actionLabel: 'Deleted',
                itemLabel: 'low-dialogue character',
                emptyMessage: `No characters below ${min} dialogues`,
                blockedMessage: 'Only pinned low-dialogue characters remain. Turn off Keep first.'
            });
        };
        $('dc-del-dupes').onclick = () => {
            removeCharacterKeys(collectDuplicateColorKeys(), {
                actionLabel: 'Deleted',
                itemLabel: 'duplicate-color character',
                emptyMessage: 'No duplicate colors found',
                blockedMessage: 'Only pinned duplicate-color characters remain. Turn off Keep first.'
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
        $('dc-reset').onclick = () => {
            if (!confirm('Reset all colors?')) return;
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
        $('dc-search').oninput = e => { searchTerm = e.target.value; updateCharList(); };
        $('dc-sort').onchange = e => { settings.sortMode = e.target.value; saveData(); updateCharList(); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };

        registerKeyboardShortcuts();
        applyControlHelpText();
        updateCharList();
        injectPrompt();
    }

    globalThis.DialogueColorsInterceptor = async function (chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled && !isDomEngine()) injectPrompt(); };

    function registerKeyboardShortcuts() {
        if (runtimeState.keyboardSetup) return;
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
        });
        runtimeState.keyboardSetup = true;
    }

    function resetDialogueCountsForNewChat() {
        lastProcessedMessageSignature = '';

        let changed = false;
        for (const entry of Object.values(characterColors)) {
            if (!entry || typeof entry !== 'object') continue;
            if ((Number(entry.dialogueCount) || 0) === 0) continue;
            entry.dialogueCount = 0;
            changed = true;
        }

        if (changed) commit({ history: false });
    }

    function handleChatChanged() {
        attributionChatGeneration++;
        isStreamingGenerationActive = false;
        cancelStreamingAttributionVerification({ clearOverrides: true });
        streamingHeuristicCache.clear();
        pendingAttributionVerifications = [];
        clearAutoAttributionVerificationQueue({ clearCooldown: true });
        clearAutoColorizeIndicators();
        clearDomCache();
        stopDomHealthCheck();
        const currentCharKey = getCharKey();
        clearDecoratedWatchers();
        if (currentCharKey !== lastCharKey) {
            expandedCharacterRows.clear();
            swapMode = null;
            loadData();
            if (!Object.keys(characterColors).length) tryLoadFromCard();
            lastCharKey = currentCharKey;
            lastProcessedMessageSignature = '';
            syncUIWithSettings();
        }
        updateCharList();
        injectPrompt();
        stripColorBlocksFromDisplay();
        setupChatRootObserver();
        setupChatObserver();
        startDomHealthCheck();
        scheduleDomRefreshSeries(150);
        scheduleCustomFontRefresh(150);
        if (runtimeState.chatChangedRafId) cancelAnimationFrame(runtimeState.chatChangedRafId);
        runtimeState.chatChangedRafId = requestAnimationFrame(() => {
            runtimeState.chatChangedRafId = null;
            setupChatObserver();
            startDomHealthCheck();
            decorateAllMessages();
            scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
            scheduleCustomFontRefresh(0);
        });
        setTimeout(() => { setupChatObserver(); startDomHealthCheck(); scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS); scheduleCustomFontRefresh(0); }, 250);
        if (settings.autoScanOnLoad !== false && !Object.keys(characterColors).length) {
            setTimeout(() => {
                if (document.querySelectorAll('.mes').length) scanAllMessages();
                stripColorBlocksFromDisplay();
                setupChatObserver();
                startDomHealthCheck();
                scheduleDomRefreshSeries(0);
                scheduleCustomFontRefresh(0);
            }, 1000);
        }
    }

    function handleMessageUpdated(mesIndex) {
        const index = Number(mesIndex);
        if (Number.isFinite(index) && index >= 0) {
            scheduleMessageDomRepair(index, { forceVerify: true, verifyDelay: 250 });
            scheduleCustomFontRefresh(100);
            return;
        }

        scheduleDomRefreshSeries(200);
        scheduleCustomFontRefresh(200);

        const chatGeneration = attributionChatGeneration;
        setTimeout(() => {
            if (!settings.enabled || !isDomEngine()) return;
            if (chatGeneration !== attributionChatGeneration) return;
            decorateAllMessages();
            queueAutoAttributionVerificationForRenderedMessages({ delay: 250 });
        }, POST_MUTATION_DOM_REPAIR_DELAY_MS);
    }

    function registerEventHandlers() {
        if (runtimeState.eventsRegistered) return;
        runtimeState.eventHandlers = {
            generationAfterCommands: () => injectPrompt(),
            characterMessageRendered: () => { onNewMessage(); scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
            messageRendered: () => { scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
            messageUpdated: handleMessageUpdated,
            streamToken: () => { isStreamingGenerationActive = true; scheduleDecorateLast(hasMessageQuoteOverridesForLatestMessage() ? 0 : 80); scheduleCustomFontRefresh(120); scheduleStreamingAttributionVerification(); },
            generationEnded: () => {
                isStreamingGenerationActive = false;
                streamingHeuristicCache.clear();
                cancelStreamingAttributionVerification();
                scheduleDomRefreshSeries(0);
                scheduleCustomFontRefresh(0);
                // Run post-generation verification sweeps to make absolutely sure everything is verified.
                queueAutoAttributionVerificationForRenderedMessages({ force: true, delay: 300 });
                setTimeout(() => {
                    if (isStreamingGenerationActive) return;
                    queueAutoAttributionVerificationForRenderedMessages({ force: true, delay: 0 });
                }, 1000);
                setTimeout(() => {
                    if (isStreamingGenerationActive) return;
                    queueAutoAttributionVerificationForRenderedMessages({ force: true, delay: 0 });
                }, 2500);
            },
            chatCreated: resetDialogueCountsForNewChat,
            chatChanged: handleChatChanged,
            settingsUpdated: () => {
                const record = getAutoSyncRecord(false);
                if (!record) return;
                if (!autoSyncPendingRecord || doAutoSyncMarkersMatch(record, autoSyncPendingRecord)) {
                    confirmAutoSyncRecord(record);
                }
            },
        };
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, runtimeState.eventHandlers.generationAfterCommands);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, runtimeState.eventHandlers.characterMessageRendered);
        if (event_types.USER_MESSAGE_RENDERED) eventSource.on(event_types.USER_MESSAGE_RENDERED, runtimeState.eventHandlers.messageRendered);
        if (event_types.MESSAGE_UPDATED) eventSource.on(event_types.MESSAGE_UPDATED, runtimeState.eventHandlers.messageUpdated);
        if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, runtimeState.eventHandlers.messageUpdated);
        if (event_types.STREAM_TOKEN_RECEIVED) eventSource.on(event_types.STREAM_TOKEN_RECEIVED, runtimeState.eventHandlers.streamToken);
        if (event_types.SMOOTH_STREAM_TOKEN_RECEIVED) eventSource.on(event_types.SMOOTH_STREAM_TOKEN_RECEIVED, runtimeState.eventHandlers.streamToken);
        if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, runtimeState.eventHandlers.generationEnded);
        if (event_types.CHAT_CREATED) eventSource.on(event_types.CHAT_CREATED, runtimeState.eventHandlers.chatCreated);
        if (event_types.GROUP_CHAT_CREATED) eventSource.on(event_types.GROUP_CHAT_CREATED, runtimeState.eventHandlers.chatCreated);
        eventSource.on(event_types.CHAT_CHANGED, runtimeState.eventHandlers.chatChanged);
        eventSource.on(event_types.SETTINGS_UPDATED, runtimeState.eventHandlers.settingsUpdated);
        eventSource.on(event_types.CHAT_CHANGED, () => populateProfileDropdown());
        runtimeState.eventsRegistered = true;
    }

    function registerDialogueColorsMacro() {
        try {
            const context = getContext();
            const macroCallback = () => {
                if (!settings.enabled || isDomEngine()) return '';
                return buildMinimalPromptInstruction();
            };

            if (context && context.registerMacro) {
                context.registerMacro('dialoguecolors', macroCallback);
                console.log('[Dialogue Colors] Macro registered: {{dialoguecolors}}');
            } else {
                console.warn('[Dialogue Colors] registerMacro not available - macro mode will not work');
            }
        } catch (e) {
            console.error('[Dialogue Colors] Failed to register macro:', e);
        }
    }

    function init() {
        migrateLegacyLocalStorageIfNeeded();
        loadData();
        initAutoSync();
        setTimeout(() => ensureRegexScript(), 1000);
        setupContextMenu();
        registerDialogueColorsMacro();

        // Phase 6C: Inject mobile CSS for larger touch targets
        let mobileStyle = document.getElementById('dc-mobile-style');
        if (!mobileStyle) {
            mobileStyle = document.createElement('style');
            mobileStyle.id = 'dc-mobile-style';
            mobileStyle.textContent = `
            .dc-auto-colorize-indicator {
                position: absolute;
                top: 4px;
                right: 8px;
                font-size: 0.75em;
                color: var(--SmartThemeQuoteColor, #888);
                opacity: 0.8;
                animation: dc-pulse 1.2s ease-in-out infinite;
                pointer-events: none;
                z-index: 1;
            }
            @keyframes dc-pulse {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 1; }
            }
            @media (max-width: 768px) {
                #dc-ext .menu_button { min-height: 36px; min-width: 36px; font-size: 0.85em; }
                #dc-ext input[type="checkbox"] { width: 18px; height: 18px; }
                #dc-ext .dc-char .menu_button { min-height: 30px; min-width: 30px; }
                #dc-ext input[type="color"] { width: 28px !important; height: 28px !important; }
                #dc-ext details summary { padding: 8px 4px; }
                #dc-harmony-popup { flex-wrap: wrap; max-width: 200px; }
                #dc-harmony-popup .dc-harmony-swatch { width: 32px !important; height: 32px !important; }
            }
        `;
            document.head.appendChild(mobileStyle);
        }

        let waitAttempts = 0;
        const waitUI = setInterval(() => {
            waitAttempts++;
            if (document.getElementById('extensions_settings')) {
                clearInterval(waitUI);
                createUI();
                updateAutoSyncUI();
                clearDomCache();
                injectPrompt();
                populateProfileDropdown();
                setupChatRootObserver();
                setupChatObserver();
                startDomHealthCheck();
                scheduleDomRefreshSeries(150);
                scheduleCustomFontRefresh(150);
            } else if (waitAttempts > 60) {
                clearInterval(waitUI);
            }
        }, 500);
    }

    registerEventHandlers();
    setTimeout(init, 100);
})();
