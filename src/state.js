// state.js - extracted from index.js (mechanical split)

import { normalizeRegistryIdentity } from './group-profiles.js';

export const RUNTIME_GUARD_KEY = '__dialogueColorsRuntime_v1';

export const runtimeState = {
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
    chatChangedSettleTimer: null,
    // Per-message self-terminating observers that replace the old polling settle timers.
    // Keyed by the .mes element; value is { observer, fallbackTimer }.
    messageSettleObservers: new Map(),
    // Long-lived observers on decorated messages that re-decorate when an
    // external agent (e.g. Prose Polisher) rebuilds .mes_text innerHTML.
    // Keyed by the .mes element; value is { observer, mesText }.
    decoratedWatchers: new Map(),
    // Coalesced post-mutation repairs keyed by message index. Host lifecycle
    // events supersede observer repairs so stale callbacks cannot redecorate.
    messageDomRepairTimers: new Map(),
    pendingObservedMessages: new Set(),
};

export function isDomEngine() {
    return settings.coloringEngine === 'dom';
}

export const MODULE_NAME = 'dialogue-colors';

export const COLOR_SCHEMA_VERSION = 9;

export const COLOR_STORAGE_SCOPES = Object.freeze(['chat', 'card', 'global']);

export const DEFAULT_COLOR_STORAGE_SCOPE = 'card';

export const LEGACY_GLOBAL_SETTINGS_KEY = 'dc_global_settings';

export const GLOBAL_SETTINGS_V2_KEY = 'dc_global_settings_v2';

export const PRESETS_KEY = 'dc_presets';

export const LEGEND_POSITION_KEY = 'dc_legend_position';

export let characterColors = Object.create(null);

export let groupProfiles = Object.create(null);

export const loadedGoogleFonts = new Set();

export let colorHistory = [];

export let historyIndex = -1;

export let swapMode = null;

export let searchTerm = '';

export let expandedCharacterRows = new Set();

// Runtime-only selection for character list bulk actions.
export const selectedCharacterKeys = new Set();

export let settings = { enabled: true, themeMode: 'auto', narratorStyle: { enabled: false, baseColor: '#888888', gradient: null, gradientGenerator: null }, narratorColor: '#888888', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, thoughtSymbols: '*', disableNarration: true, colorStorageScope: DEFAULT_COLOR_STORAGE_SCOPE, autoScanNewMessages: true, autoLockDetected: true, autoPersonaCharacter: false, autoRandomNpcGradients: false, autoRandomAllGradients: false, driftAllGradientColors: false, gradientRandomMasterSeed: '', colorVisionPreviewMode: 'none', colorVisionPreviewSeverity: 100, colorVisionPreviewTarget: 'all', gradientAnimationMode: 'auto', forceBoldText: false, enableRightClick: false, promptDepth: 1, autoRecolor: true, autoColorize: false, llmAttributionCheck: false, llmAttributionParallel: false, attributionConservativeOnly: false, attributionReviewPolicy: 'review', attributionMaxTokens: 4096, attributionVerifyPasses: 1, allowRemoteFonts: false, domStealthColors: true, markUncertainDialogue: false, disableToasts: false, llmConnectionProfile: null, attributionConnectionProfile: null, colorSchemaVersion: COLOR_SCHEMA_VERSION, promptMode: 'inject', promptRole: 'system', sortMode: 'name', coloringEngine: 'llm' };

export const TOGGLE_SETTING_DEFAULTS = Object.freeze({
    enabled: true,
    highlightMode: false,
    autoScanOnLoad: true,
    showLegend: false,
    disableNarration: true,
    autoScanNewMessages: true,
    autoLockDetected: true,
    autoPersonaCharacter: false,
    autoRandomNpcGradients: false,
    autoRandomAllGradients: false,
    driftAllGradientColors: false,
    forceBoldText: false,
    enableRightClick: false,
    autoRecolor: true,
    autoColorize: false,
    llmAttributionCheck: false,
    llmAttributionParallel: false,
    attributionConservativeOnly: false,
    allowRemoteFonts: false,
    domStealthColors: true,
    markUncertainDialogue: false,
    disableToasts: false,
});

export const GLOBAL_TOGGLE_KEYS = Object.freeze(Object.keys(TOGGLE_SETTING_DEFAULTS));

export const GLOBAL_VISUAL_KEYS = Object.freeze(['thoughtSymbols', 'themeMode', 'colorTheme', 'brightness', 'promptDepth', 'promptRole', 'promptMode', 'coloringEngine', 'gradientRandomMasterSeed', 'colorVisionPreviewMode', 'colorVisionPreviewSeverity', 'colorVisionPreviewTarget', 'gradientAnimationMode']);

export const GLOBAL_SETTINGS_V2_KEYS = Object.freeze([...new Set([...GLOBAL_VISUAL_KEYS, ...GLOBAL_TOGGLE_KEYS, 'narratorStyle', 'narratorColor', 'colorStorageScope', 'attributionReviewPolicy'])]);

export const ACTIVE_SETTING_KEYS = Object.freeze([...new Set([...GLOBAL_SETTINGS_V2_KEYS, 'llmConnectionProfile', 'attributionConnectionProfile', 'attributionConservativeOnly', 'attributionReviewPolicy', 'attributionMaxTokens', 'attributionVerifyPasses', 'colorSchemaVersion', 'sortMode'])]);

export const LEGACY_AUTO_SYNC_ENABLED_KEY = 'dc_autosync_enabled';

export const AUTO_SYNC_SAVE_TIMEOUT_MS = 15000;

export let lastCharKey = null;

// Phase 3A: Legend event listener cleanup
export let lastProcessedMessageSignature = '';

// Phase 3A: Legend event listener cleanup
export let legendListeners = null;

export let autoRecolorHintShown = false;

export let isRecoloring = false;

export let isColorizing = false;

export let isAutoColorizing = false;

export let isVerifyingAttribution = false;

export let pendingAttributionVerifications = [];

export const ATTRIBUTION_VERIFIER_VERSION = 4;

export const AUTO_ATTRIBUTION_VERIFY_DELAY_MS = 300;

export const AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS = 500;

export const AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS = 3000;

export const AUTO_ATTRIBUTION_VERIFY_RENDERED_LIMIT = 3;

export const MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS = 50;

export const STREAMING_ATTRIBUTION_VERIFY_DELAY_MS = 1000;

export let autoAttributionVerifyTimer = null;

export let autoAttributionVerifyTimerDue = 0;

export const pendingAutoAttributionVerifyIndices = new Map();

export const recentAutoAttributionVerifyAttempts = new Map();

export let isStreamingGenerationActive = false;

export let streamingAttributionVerifyTimer = null;

export let streamingAttributionGeneration = 0;

export let lastStreamingAttributionVerifyKey = '';

export let attributionChatGeneration = 0;

export let attributionVerificationEpoch = 0;

export const streamingAttributionOverrides = new Map();

// Streaming paints run inside SillyTavern's own write frame, so this holds the
// live message target plus the assignments already shown to the user. Freezing
// them is what stops visible text from changing colour mid-stream.
export const streamingSession = {
    active: false,
    mesIndex: -1,
    assignments: new Map(),
    mesElement: null,
    mesText: null,
    observer: null,
    painting: false,
};

export const LIVE_CHAT_SAVE_DELAY_MS = 350;

export const COLOR_STATE_SAVE_DELAY_MS = 180;

export let liveChatSaveTimer = null;

export let colorStateSaveTimer = null;

export let pendingLiveChatSave = false;

export let pendingColorStateSaveData = false;

export let pendingColorStateHistory = false;

export let pendingColorStateUpdateList = false;

// Auto-sync state
export let pendingColorStateInjectPrompt = false;

// Auto-sync state
export let autoSyncEnabled = false;

export let autoSyncInterval = null;

export let autoSyncLastTimestamp = null;

export let autoSyncLastWriterId = '';

export let autoSyncSequence = 0;

export let autoSyncPendingRecord = null;

export let autoSyncSaveTimeout = null;

export let autoSyncStatusError = '';

export let immediateSettingsSaveInFlight = false;

export let immediateSettingsSaveQueued = false;

export function createLatestRequestGate() {
    let latest = 0;
    return Object.freeze({
        begin() { return ++latest; },
        supersede() { return ++latest; },
        isCurrent(request) { return request === latest; },
    });
}

export function getAutoSyncRecordDisposition(options = {}) {
    if (options.serverVerified && options.hasPending && !options.matchesPending) return 'conflict';
    if (options.serverVerified && options.matchesCurrent) return 'confirm';
    if (options.force
        || options.matchesPending
        || (options.serverVerified && !options.hasPending)
        || (!options.serverVerified && options.isNewer)) return 'apply';
    return 'ignore';
}

export function preserveLocalRemoteFontConsent(source, localConsent) {
    const next = Object.assign(
        Object.create(null),
        source && typeof source === 'object' && !Array.isArray(source) ? source : {},
    );
    next.allowRemoteFonts = localConsent === true;
    return next;
}

function toNullPrototypeNameMap(value, maximum, validateAliases = false) {
    const map = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return map;
    for (const [key, entry] of Object.entries(value)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const rawName = Object.prototype.hasOwnProperty.call(entry, 'name') ? entry.name : key;
        const identity = normalizeRegistryIdentity(rawName, maximum);
        if (!identity) continue;
        if (validateAliases && Object.prototype.hasOwnProperty.call(entry, 'aliases')) {
            if (!Array.isArray(entry.aliases)
                || entry.aliases.some(alias => !normalizeRegistryIdentity(alias))) continue;
        }
        map[identity] = entry;
    }
    return map;
}

export function setAttributionChatGeneration(value) { attributionChatGeneration = value; return value; }
export function setAttributionVerificationEpoch(value) { attributionVerificationEpoch = value; return value; }
export function setAutoAttributionVerifyTimer(value) { autoAttributionVerifyTimer = value; return value; }
export function setAutoAttributionVerifyTimerDue(value) { autoAttributionVerifyTimerDue = value; return value; }
export function setAutoRecolorHintShown(value) { autoRecolorHintShown = value; return value; }
export function setAutoSyncEnabled(value) { autoSyncEnabled = value; return value; }
export function setAutoSyncInterval(value) { autoSyncInterval = value; return value; }
export function setAutoSyncLastTimestamp(value) { autoSyncLastTimestamp = value; return value; }
export function setAutoSyncLastWriterId(value) { autoSyncLastWriterId = value; return value; }
export function setAutoSyncPendingRecord(value) { autoSyncPendingRecord = value; return value; }
export function setAutoSyncSaveTimeout(value) { autoSyncSaveTimeout = value; return value; }
export function setAutoSyncSequence(value) { autoSyncSequence = value; return value; }
export function setAutoSyncStatusError(value) { autoSyncStatusError = value; return value; }
export function setCharacterColors(value) { characterColors = toNullPrototypeNameMap(value, 120, true); return characterColors; }
export function setGroupProfiles(value) { groupProfiles = toNullPrototypeNameMap(value, 80); return groupProfiles; }
export function setColorHistory(value) { colorHistory = value; return value; }
export function setColorStateSaveTimer(value) { colorStateSaveTimer = value; return value; }
export function setExpandedCharacterRows(value) { expandedCharacterRows = value; return value; }
export function setHistoryIndex(value) { historyIndex = value; return value; }
export function setImmediateSettingsSaveInFlight(value) { immediateSettingsSaveInFlight = value; return value; }
export function setImmediateSettingsSaveQueued(value) { immediateSettingsSaveQueued = value; return value; }
export function setIsAutoColorizing(value) { isAutoColorizing = value; return value; }
export function setIsColorizing(value) { isColorizing = value; return value; }
export function setIsRecoloring(value) { isRecoloring = value; return value; }
export function setIsStreamingGenerationActive(value) { isStreamingGenerationActive = value; return value; }
export function resetStreamingSession() {
    streamingSession.observer?.disconnect?.();
    streamingSession.active = false;
    streamingSession.mesIndex = -1;
    streamingSession.assignments.clear();
    streamingSession.mesElement = null;
    streamingSession.mesText = null;
    streamingSession.observer = null;
    streamingSession.painting = false;
}
export function setIsVerifyingAttribution(value) { isVerifyingAttribution = value; return value; }
export function setLastCharKey(value) { lastCharKey = value; return value; }
export function setLastProcessedMessageSignature(value) { lastProcessedMessageSignature = value; return value; }
export function setLastStreamingAttributionVerifyKey(value) { lastStreamingAttributionVerifyKey = value; return value; }
export function setLegendListeners(value) { legendListeners = value; return value; }
export function setLiveChatSaveTimer(value) { liveChatSaveTimer = value; return value; }
export function setPendingAttributionVerifications(value) { pendingAttributionVerifications = value; return value; }
export function setPendingColorStateHistory(value) { pendingColorStateHistory = value; return value; }
export function setPendingColorStateInjectPrompt(value) { pendingColorStateInjectPrompt = value; return value; }
export function setPendingColorStateSaveData(value) { pendingColorStateSaveData = value; return value; }
export function setPendingColorStateUpdateList(value) { pendingColorStateUpdateList = value; return value; }
export function setPendingLiveChatSave(value) { pendingLiveChatSave = value; return value; }
export function setSearchTerm(value) { searchTerm = value; return value; }
export function setStreamingAttributionGeneration(value) { streamingAttributionGeneration = value; return value; }
export function setStreamingAttributionVerifyTimer(value) { streamingAttributionVerifyTimer = value; return value; }
export function setSwapMode(value) { swapMode = value; return value; }
