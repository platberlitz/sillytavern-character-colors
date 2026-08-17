// main.js - extracted from index.js (mechanical split)
import { clearDomCache } from './attribution.js';
import { destroyGradientAnimationController } from './animation-controller.js';
import { recountDialogueCountsFromChat, refreshTransientNarratorCount, scanAllMessages, stripColorBlocksFromDisplay } from './color-blocks.js';
import { deleteCharacterKeys } from './character-operations.js';
import { setupContextMenu } from './context-menu.js';
import { DOM_RETRY_REFRESH_DELAYS, POST_MUTATION_DOM_REPAIR_DELAY_MS, clearDecoratedWatchers, clearDialogueCountCache, clearSessionAttributionVerifications, decorateAllMessages, reconcileMessageQuoteOverridesAfterDeletion, refreshDomDialogueCounts, scheduleDomRefreshSeries, scheduleDomSettleRefresh, scheduleMessageDomRepair, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck, undecorateAllMessages } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { redo, undo } from './history.js';
import { applyHtmlBreakingSpanRepair, applyToolCallMessageRepair, commit, onNewMessage, repaintDomAfterCharacterDataChange, resumePendingChatSave } from './live-colors.js';
import { consumeMainAiQuietGenerationEnd, populateProfileDropdown } from './llm.js';
import { detectTheme, getReadableSurfaceSignature, invalidateThemeCache } from './palettes.js';
import { buildMinimalPromptInstruction, flushPromptInjection, injectPrompt } from './prompts.js';
import { eventSource, event_types, getContext } from './st-api.js';
import { attributionChatGeneration, autoSyncPendingRecord, characterColors, expandedCharacterRows, groupProfiles, isDomEngine, isStreamingGenerationActive, lastCharKey, lastProcessedMessageSignature, pendingAttributionVerifications, runtimeState, selectedCharacterKeys, setAttributionChatGeneration, setEnabledLifecycleSynchronizer, setIsStreamingGenerationActive, setLastCharKey, setLastProcessedMessageSignature, setPendingAttributionVerifications, setSwapMode, settings, swapMode } from './state.js';
import { beginStreamingPaint, endStreamingPaint } from './streaming-paint.js';
import { confirmAutoSyncRecord, doAutoSyncMarkersMatch, ensureRegexScript, getAutoSyncRecord, getCharKey, getStorageKey, initAutoSync, loadData, markCurrentPersonaKept, migrateLegacyLocalStorageIfNeeded, migrateRenamedCharacterStorage, saveData, stopAutoSyncPolling, syncAutoSyncPolling, tryLoadFromCard, updateAutoSyncUI } from './storage.js';
import { applyRestoredPersonaColor, applyThemeOrBrightnessChange, clearAutoColorizeIndicators, createUI, ensurePersonaCharacter, renamePersonaCharacter, syncUIWithSettings, updateCharList, updateLegend } from './ui.js';
import { cancelStreamingAttributionVerification, captureLoadedAttributionMessageBaseline, clearAutoAttributionVerificationQueue, queueAutoAttributionVerificationForRenderedMessages, scheduleStreamingAttributionVerification } from './verify.js';

let lastAppliedAutoTheme = null;
let lastAppliedAutoSurface = null;
let themeRefreshTimers = [];
let loudGenerationActive = false;
let automaticRuntimeActive = false;
let enabledStorageInitialized = false;
let regexInstallTimer = null;
let dialogueColorsMacroRegistered = false;

// The host repaints its theme at an unknown time after SETTINGS_UPDATED (CSS variables,
// transitions, background images), so a single early probe reads the old surface and
// concludes nothing changed. A short series catches the settle whenever it lands; once a
// probe repaints, the refreshed baselines make every later probe a no-op.
const THEME_SETTLE_PROBE_DELAYS_MS = [100, 400, 1200, 2500];

function scheduleAutoThemeProbes() {
    for (const timer of themeRefreshTimers) clearTimeout(timer);
    themeRefreshTimers = [];
    if (!settings.enabled) return;
    themeRefreshTimers = THEME_SETTLE_PROBE_DELAYS_MS.map(delay => setTimeout(() => {
        if (!settings.enabled || settings.themeMode !== 'auto') return;
        invalidateThemeCache();
        const currentTheme = detectTheme();
        const currentSurface = getReadableSurfaceSignature();
        const themeChanged = lastAppliedAutoTheme
            && (currentTheme !== lastAppliedAutoTheme || currentSurface !== lastAppliedAutoSurface);
        lastAppliedAutoTheme = currentTheme;
        lastAppliedAutoSurface = currentSurface;
        if (themeChanged) applyThemeOrBrightnessChange(() => {}, { saveImmediately: true });
    }, delay));
}

function scheduleRegexScriptInstall() {
    clearTimeout(regexInstallTimer);
    regexInstallTimer = setTimeout(() => {
        regexInstallTimer = null;
        if (settings.enabled) ensureRegexScript();
    }, 1000);
}

function startAutomaticRuntime() {
    if (!settings.enabled || automaticRuntimeActive) return false;
    if (!enabledStorageInitialized) {
        const requestedEnabled = settings.enabled;
        try {
            migrateLegacyLocalStorageIfNeeded();
            loadData();
            settings.enabled = requestedEnabled;
            initAutoSync();
        } finally {
            // The click that starts this runtime is newer than the persisted
            // disabled snapshot loaded above.
            settings.enabled = requestedEnabled;
        }
        enabledStorageInitialized = true;
        syncUIWithSettings();
    } else {
        syncAutoSyncPolling();
    }
    automaticRuntimeActive = true;
    return true;
}

function stopAutomaticRuntime() {
    automaticRuntimeActive = false;
    for (const timer of themeRefreshTimers) clearTimeout(timer);
    themeRefreshTimers = [];
    clearTimeout(regexInstallTimer);
    regexInstallTimer = null;
    stopAutoSyncPolling();
    loudGenerationActive = false;
    setIsStreamingGenerationActive(false);
    clearAutoAttributionVerificationQueue({ clearCooldown: true });
    cancelStreamingAttributionVerification({ clearOverrides: true });
    endStreamingPaint();
    if (runtimeState.chatChangedRafId) cancelAnimationFrame(runtimeState.chatChangedRafId);
    runtimeState.chatChangedRafId = null;
    clearTimeout(runtimeState.chatChangedSettleTimer);
    runtimeState.chatChangedSettleTimer = null;
    clearTimeout(runtimeState.dialogueRecountTimer);
    runtimeState.dialogueRecountTimer = null;
    stopDomHealthCheck();
    clearDecoratedWatchers();
    undecorateAllMessages();
    setupContextMenu();
    runtimeState.chatRootObserver?.disconnect();
    runtimeState.chatRootObserver = null;
    clearTimeout(runtimeState.chatRootObserverTimer);
    runtimeState.chatRootObserverTimer = null;
    destroyGradientAnimationController();
    scheduleCustomFontRefresh(0);
    flushPromptInjection();
    updateLegend();
}

export function syncAutomaticRuntime() {
    if (!settings.enabled) {
        stopAutomaticRuntime();
        return false;
    }
    const activated = startAutomaticRuntime();
    scheduleRegexScriptInstall();
    registerDialogueColorsMacro();
    if (!activated) return false;

    // A chat/card may have changed while disabled. Load and reconcile that
    // context before any activation repaint or observer can use the old table.
    handleChatChanged();
    setupContextMenu();
    invalidateThemeCache();
    lastAppliedAutoTheme = settings.themeMode === 'auto' ? detectTheme() : null;
    lastAppliedAutoSurface = settings.themeMode === 'auto' ? getReadableSurfaceSignature() : null;
    if (lastAppliedAutoTheme) applyThemeOrBrightnessChange(() => {}, { saveImmediately: true });
    return true;
}

export function registerKeyboardShortcuts() {
    if (runtimeState.keyboardSetup) return;
    document.addEventListener('keydown', e => {
        const eventTarget = e.target?.closest ? e.target : e.target?.parentElement;
        const isEditing = eventTarget?.isContentEditable
            || eventTarget?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false" i])');
        if (isEditing) return;

        const key = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
    });
    runtimeState.keyboardSetup = true;
}

export function resetDialogueCountsForNewChat() {
    loudGenerationActive = false;
    clearTimeout(runtimeState.dialogueRecountTimer);
    runtimeState.dialogueRecountTimer = null;
    if (!settings.enabled || !automaticRuntimeActive) return;
    setLastProcessedMessageSignature('');

    const removed = settings.clearUnpinnedOnNewChat === true
        && deleteCharacterKeys(Object.keys(characterColors)).removedKeys.length > 0;
    let changed = false;
    for (const entry of Object.values(characterColors)) {
        if (!entry || typeof entry !== 'object') continue;
        if ((Number(entry.dialogueCount) || 0) === 0) continue;
        entry.dialogueCount = 0;
        changed = true;
    }

    if (removed) {
        commit();
        repaintDomAfterCharacterDataChange(0);
    } else if (changed) updateCharList();
}

export function handleChatChanged() {
    loudGenerationActive = false;
    clearTimeout(runtimeState.dialogueRecountTimer);
    runtimeState.dialogueRecountTimer = null;
    if (!settings.enabled) {
        stopAutomaticRuntime();
        return;
    }
    if (!automaticRuntimeActive) return;
    resumePendingChatSave();
    selectedCharacterKeys.clear();
    setAttributionChatGeneration(attributionChatGeneration + 1);
    setIsStreamingGenerationActive(false);
    cancelStreamingAttributionVerification({ clearOverrides: true });
    endStreamingPaint();
    setPendingAttributionVerifications([]);
    clearAutoAttributionVerificationQueue({ clearCooldown: true });
    captureLoadedAttributionMessageBaseline();
    clearAutoColorizeIndicators();
    clearDomCache();
    clearDialogueCountCache();
    clearSessionAttributionVerifications();
    stopDomHealthCheck();
    clearDecoratedWatchers();
    const currentCharKey = getCharKey();
    if (currentCharKey !== lastCharKey) {
        expandedCharacterRows.clear();
        setSwapMode(null);
        loadData();
        if (!Object.keys(characterColors).length && !Object.keys(groupProfiles).length) {
            tryLoadFromCard({ colorsOnly: true });
        }
        setLastCharKey(currentCharKey);
        setLastProcessedMessageSignature('');
        syncUIWithSettings();
    }
    // A bare reconcileMessageQuoteOverridesAfterDeletion() is reserved for an
    // actual deletion; activation must not discard ambiguous ID-less records.
    reconcileMessageQuoteOverridesAfterDeletion(undefined, { deletion: false });
    // Undo the damage older versions did to tool-call messages, before stripColorBlocksFromDisplay
    // hides the block it looks for and before the deferred scanAllMessages below re-ingests it.
    // Not gated on a setting: the guard in isColorableMessage is its own gate, so once a chat is
    // repaired the condition can never be true again, and this writes only when it changed something.
    void applyToolCallMessageRepair({ silent: true })
        .catch(error => console.error('[Dialogue Colors] Tool-call repair failed:', error));
    // Same shape, same reason: undo the font tags older versions spliced into HTML elements
    // before the display strip and the deferred rescan read the message text.
    void applyHtmlBreakingSpanRepair({ silent: true })
        .catch(error => console.error('[Dialogue Colors] HTML markup repair failed:', error));
    if (settings.autoPersonaCharacter === true) ensurePersonaCharacter({ silent: true });
    const chat = getContext()?.chat || [];
    if (!isDomEngine()) recountDialogueCountsFromChat(chat);
    else refreshTransientNarratorCount(chat);
    updateCharList();
    injectPrompt();
    stripColorBlocksFromDisplay();
    setupChatRootObserver();
    setupChatObserver();
    startDomHealthCheck();
    scheduleDomRefreshSeries(150);
    scheduleCustomFontRefresh(150);
    const scanGeneration = attributionChatGeneration;
    const scanStorageKey = getStorageKey();
    if (runtimeState.chatChangedRafId) cancelAnimationFrame(runtimeState.chatChangedRafId);
    runtimeState.chatChangedRafId = requestAnimationFrame(() => {
        runtimeState.chatChangedRafId = null;
        if (!settings.enabled) return;
        setupChatObserver();
        startDomHealthCheck();
        decorateAllMessages();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        scheduleCustomFontRefresh(0);
    });
    clearTimeout(runtimeState.chatChangedSettleTimer);
    runtimeState.chatChangedSettleTimer = setTimeout(() => {
        runtimeState.chatChangedSettleTimer = null;
        if (!settings.enabled) return;
        if (scanGeneration !== attributionChatGeneration || scanStorageKey !== getStorageKey()) return;
        setupChatObserver();
        startDomHealthCheck();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        scheduleCustomFontRefresh(0);
    }, 250);
    const shouldInitialScan = settings.enabled
        && settings.autoScanOnLoad !== false
        && !Object.keys(characterColors).length;
    if (shouldInitialScan) {
        setTimeout(() => {
            if (!settings.enabled || settings.autoScanOnLoad === false) return;
            if (scanGeneration !== attributionChatGeneration || scanStorageKey !== getStorageKey()) return;
            if (document.querySelectorAll('.mes').length) scanAllMessages();
            stripColorBlocksFromDisplay();
            setupChatObserver();
            startDomHealthCheck();
            scheduleDomRefreshSeries(0);
            scheduleCustomFontRefresh(0);
        }, 1000);
    }
}

function scheduleExactDialogueRecount(chat) {
    if (!Array.isArray(chat)) return;
    clearTimeout(runtimeState.dialogueRecountTimer);
    runtimeState.dialogueRecountTimer = setTimeout(() => {
        runtimeState.dialogueRecountTimer = null;
        if (!settings.enabled || !automaticRuntimeActive || getContext()?.chat !== chat) return;
        let countsChanged;
        if (isDomEngine()) {
            const result = refreshDomDialogueCounts(chat);
            countsChanged = result.changed || result.countsChanged;
            refreshTransientNarratorCount(chat);
        } else {
            countsChanged = recountDialogueCountsFromChat(chat);
        }
        if (countsChanged) updateCharList();
        updateLegend();
    }, 100);
}

export function handleCharacterMessageRendered(mesIndex) {
    if (!settings.enabled || !automaticRuntimeActive) return;
    const chat = getContext()?.chat;
    const index = Number(mesIndex);
    const message = Array.isArray(chat) && Number.isInteger(index) && index >= 0 ? chat[index] : null;
    if (message) {
        scheduleMessageDomRepair(index, {
            delay: 0,
            source: 'lifecycle',
            forceVerify: true,
            verifyDelay: 250,
            renderFallback: false,
        });
        onNewMessage(index, message, chat);
    } else {
        onNewMessage();
    }
    scheduleDomRefreshSeries(120);
    scheduleCustomFontRefresh(120);
}

export function handleMessageUpdated(mesIndex) {
    if (!settings.enabled || !automaticRuntimeActive) return;
    // A swipe reuses the same mesid with an entirely different body, so the
    // frozen streaming assignments and the cached target must both be dropped.
    cancelStreamingAttributionVerification();
    endStreamingPaint();
    scheduleExactDialogueRecount(getContext()?.chat);
    const index = Number(mesIndex);
    if (Number.isFinite(index) && index >= 0) {
        scheduleMessageDomRepair(index, {
            delay: 0,
            source: 'lifecycle',
            forceVerify: true,
            verifyDelay: 250,
            renderFallback: false,
        });
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

export function handleMessageDeleted() {
    if (!settings.enabled || !automaticRuntimeActive) return;
    clearTimeout(runtimeState.dialogueRecountTimer);
    runtimeState.dialogueRecountTimer = null;
    cancelStreamingAttributionVerification();
    endStreamingPaint();
    reconcileMessageQuoteOverridesAfterDeletion();
    clearDialogueCountCache();
    const chat = getContext()?.chat || [];
    let countsChanged;
    if (isDomEngine()) {
        const result = refreshDomDialogueCounts(chat);
        countsChanged = result.changed || result.countsChanged;
        refreshTransientNarratorCount(chat);
    } else {
        countsChanged = recountDialogueCountsFromChat(chat);
    }
    if (countsChanged) updateCharList();
    updateLegend();
    scheduleDomRefreshSeries(0);
    scheduleCustomFontRefresh(0);
}

export function registerEventHandlers() {
    if (runtimeState.eventsRegistered) return;
    runtimeState.eventHandlers = {
        generationStarted: (type, _options, dryRun) => {
            if (!settings.enabled || !automaticRuntimeActive) return;
            if (dryRun) return;
            if (type !== 'quiet') loudGenerationActive = true;
        },
        generationAfterCommands: (_type, _options, dryRun) => {
            if (settings.enabled && automaticRuntimeActive && !dryRun) flushPromptInjection();
        },
        characterMessageRendered: handleCharacterMessageRendered,
        messageRendered: () => { if (settings.enabled && automaticRuntimeActive) { scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); } },
        messageUpdated: handleMessageUpdated,
        messageDeleted: handleMessageDeleted,
        // No timers here: beginStreamingPaint installs a MutationObserver so the
        // repaint lands in the same frame as the host's .mes_text rewrite.
        streamToken: () => { if (settings.enabled && automaticRuntimeActive) { setIsStreamingGenerationActive(true); beginStreamingPaint(); scheduleStreamingAttributionVerification(); } },
        generationEnded: () => {
            if (!settings.enabled || !automaticRuntimeActive) return;
            // GENERATION_ENDED has no type payload. A preceding non-quiet start
            // takes priority over an overlapping extension quiet request.
            let isQuietEnd = false;
            if (loudGenerationActive) loudGenerationActive = false;
            else isQuietEnd = consumeMainAiQuietGenerationEnd();
            // Streaming teardown runs even for quiet ends, or the frozen
            // assignments get replayed onto a different message body.
            setIsStreamingGenerationActive(false);
            endStreamingPaint();
            cancelStreamingAttributionVerification();
            if (isQuietEnd) return;
            // Frozen mid-stream guesses are corrected here, in one pass, once
            // the full text (and its trailing speech tags) is available.
            scheduleDomRefreshSeries(0);
            scheduleCustomFontRefresh(0);
            // Run post-generation verification sweep for unverified rendered messages.
            if (isDomEngine()) queueAutoAttributionVerificationForRenderedMessages({ delay: 300 });
        },
        generationInterrupted: () => { loudGenerationActive = false; },
        chatCreated: resetDialogueCountsForNewChat,
        chatChanged: handleChatChanged,
        characterRenamed: (oldValue, newValue) => {
            if (!settings.enabled || !automaticRuntimeActive) return;
            void migrateRenamedCharacterStorage(oldValue, newValue)
                .then(result => {
                    if (!result?.ok) console.warn('[Dialogue Colors] Character storage rename migration was not persisted.', result);
                })
                .catch(error => console.warn('[Dialogue Colors] Character storage rename migration failed.', error));
        },
        personaChanged: () => {
            if (!settings.enabled || !automaticRuntimeActive) return;
            // Each persona keeps its own pinned color, so a switch has to swap the pin in
            // before anything repaints, whether or not the persona entry is auto-created.
            // applyRestoredPersonaColor persists and repaints the swap; the settings list
            // alone would leave the chat showing the previous persona's color.
            const autoPersona = settings.autoPersonaCharacter === true;
            const restored = applyRestoredPersonaColor();
            if (autoPersona) ensurePersonaCharacter({ silent: true });
            const kept = markCurrentPersonaKept();
            if (kept) saveData();
            if (!isDomEngine()) decorateAllMessages();
            if (!autoPersona && !restored && !kept) return;
            updateCharList();
        },
        personaRenamed: payload => {
            if (!settings.enabled || !automaticRuntimeActive) return;
            if (renamePersonaCharacter(payload?.oldName, payload?.newName)) updateCharList();
        },
        settingsUpdated: () => {
            syncAutomaticRuntime();
            if (!settings.enabled) return;
            scheduleAutoThemeProbes();
            const record = getAutoSyncRecord(false);
            if (!record) return;
            if (!autoSyncPendingRecord || doAutoSyncMarkersMatch(record, autoSyncPendingRecord)) {
                confirmAutoSyncRecord(record);
            }
        },
    };
    lastAppliedAutoTheme = null;
    if (event_types.GENERATION_STARTED) eventSource.on(event_types.GENERATION_STARTED, runtimeState.eventHandlers.generationStarted);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, runtimeState.eventHandlers.generationAfterCommands);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, runtimeState.eventHandlers.characterMessageRendered);
    if (event_types.USER_MESSAGE_RENDERED) eventSource.on(event_types.USER_MESSAGE_RENDERED, runtimeState.eventHandlers.messageRendered);
    if (event_types.MESSAGE_UPDATED) eventSource.on(event_types.MESSAGE_UPDATED, runtimeState.eventHandlers.messageUpdated);
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, runtimeState.eventHandlers.messageUpdated);
    if (event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, runtimeState.eventHandlers.messageDeleted);
    for (const eventName of new Set([event_types.STREAM_TOKEN_RECEIVED, event_types.SMOOTH_STREAM_TOKEN_RECEIVED].filter(Boolean))) {
        eventSource.on(eventName, runtimeState.eventHandlers.streamToken);
    }
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, runtimeState.eventHandlers.generationEnded);
    for (const eventName of new Set([
        event_types.GENERATION_STOPPED,
        event_types.GENERATION_ERROR,
        event_types.GENERATION_FAILED,
        event_types.CHAT_RESET,
    ].filter(Boolean))) {
        eventSource.on(eventName, runtimeState.eventHandlers.generationInterrupted);
    }
    if (event_types.CHAT_CREATED) eventSource.on(event_types.CHAT_CREATED, runtimeState.eventHandlers.chatCreated);
    if (event_types.GROUP_CHAT_CREATED) eventSource.on(event_types.GROUP_CHAT_CREATED, runtimeState.eventHandlers.chatCreated);
    eventSource.on(event_types.CHAT_CHANGED, runtimeState.eventHandlers.chatChanged);
    if (event_types.CHARACTER_RENAMED) eventSource.on(event_types.CHARACTER_RENAMED, runtimeState.eventHandlers.characterRenamed);
    if (event_types.PERSONA_CHANGED) eventSource.on(event_types.PERSONA_CHANGED, runtimeState.eventHandlers.personaChanged);
    if (event_types.PERSONA_UPDATED) eventSource.on(event_types.PERSONA_UPDATED, runtimeState.eventHandlers.personaChanged);
    if (event_types.PERSONA_RENAMED) eventSource.on(event_types.PERSONA_RENAMED, runtimeState.eventHandlers.personaRenamed);
    eventSource.on(event_types.SETTINGS_UPDATED, runtimeState.eventHandlers.settingsUpdated);
    eventSource.on(event_types.CHAT_CHANGED, () => populateProfileDropdown());
    runtimeState.eventsRegistered = true;
}

export function registerDialogueColorsMacro() {
    if (!settings.enabled || dialogueColorsMacroRegistered) return;
    try {
        const context = getContext();
        const macroCallback = () => {
            if (!settings.enabled || isDomEngine()) return '';
            return buildMinimalPromptInstruction();
        };

        if (context && context.registerMacro) {
            context.registerMacro('dialoguecolors', macroCallback);
            dialogueColorsMacroRegistered = true;
            console.log('[Dialogue Colors] Macro registered: {{dialoguecolors}}');
        } else {
            console.warn('[Dialogue Colors] registerMacro not available - macro mode will not work');
        }
    } catch (e) {
        console.error('[Dialogue Colors] Failed to register macro:', e);
    }
}

export async function install() {
    setEnabledLifecycleSynchronizer(syncAutomaticRuntime);
    globalThis.DialogueColorsInterceptor = async function (_chat, _contextSize, _abort, type) {
        if (type !== 'quiet' && settings.enabled && automaticRuntimeActive && !isDomEngine()) flushPromptInjection();
    };
    registerEventHandlers();
    await new Promise(resolve => setTimeout(resolve, 100));
    init();
}

export function init() {
    // Load enough state to render the settings UI, but do not migrate or persist
    // anything until the stored enabled flag is known.
    loadData({ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false });
    syncAutomaticRuntime();

    let waitAttempts = 0;
    const waitUI = setInterval(() => {
        waitAttempts++;
        if (document.getElementById('extensions_settings')) {
            clearInterval(waitUI);
            createUI();
            registerKeyboardShortcuts();
            updateAutoSyncUI();
            populateProfileDropdown();
            if (settings.enabled) {
                clearDomCache();
                injectPrompt();
                setupChatRootObserver();
                setupChatObserver();
                startDomHealthCheck();
                scheduleDomRefreshSeries(150);
                scheduleCustomFontRefresh(150);
            }
        } else if (waitAttempts > 60) {
            clearInterval(waitUI);
            console.warn('[Dialogue Colors] #extensions_settings never appeared after 30s; the settings panel was not created. Reload SillyTavern to retry.');
        }
    }, 500);
}
