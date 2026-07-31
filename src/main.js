// main.js - extracted from index.js (mechanical split)
import { clearDomCache } from './attribution.js';
import { scanAllMessages, stripColorBlocksFromDisplay } from './color-blocks.js';
import { setupContextMenu } from './context-menu.js';
import { DOM_RETRY_REFRESH_DELAYS, POST_MUTATION_DOM_REPAIR_DELAY_MS, clearDecoratedWatchers, clearDialogueCountCache, clearSessionAttributionVerifications, decorateAllMessages, scheduleDomRefreshSeries, scheduleDomSettleRefresh, scheduleMessageDomRepair, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { redo, undo } from './history.js';
import { commit, onNewMessage, resumePendingChatSave } from './live-colors.js';
import { consumeMainAiQuietGenerationEnd, populateProfileDropdown } from './llm.js';
import { detectTheme, getReadableSurfaceSignature, invalidateThemeCache } from './palettes.js';
import { buildMinimalPromptInstruction, injectPrompt } from './prompts.js';
import { eventSource, event_types, getContext } from './st-api.js';
import { attributionChatGeneration, autoSyncPendingRecord, characterColors, expandedCharacterRows, isDomEngine, isStreamingGenerationActive, lastCharKey, lastProcessedMessageSignature, pendingAttributionVerifications, runtimeState, selectedCharacterKeys, setAttributionChatGeneration, setIsStreamingGenerationActive, setLastCharKey, setLastProcessedMessageSignature, setPendingAttributionVerifications, setSwapMode, settings, swapMode } from './state.js';
import { beginStreamingPaint, endStreamingPaint } from './streaming-paint.js';
import { confirmAutoSyncRecord, doAutoSyncMarkersMatch, ensureRegexScript, getAutoSyncRecord, getCharKey, getStorageKey, initAutoSync, loadData, migrateLegacyLocalStorageIfNeeded, migrateRenamedCharacterStorage, tryLoadFromCard, updateAutoSyncUI } from './storage.js';
import { applyRestoredPersonaColor, applyThemeOrBrightnessChange, clearAutoColorizeIndicators, createUI, ensurePersonaCharacter, renamePersonaCharacter, syncUIWithSettings, updateCharList } from './ui.js';
import { cancelStreamingAttributionVerification, captureLoadedAttributionMessageBaseline, clearAutoAttributionVerificationQueue, queueAutoAttributionVerificationForRenderedMessages, scheduleStreamingAttributionVerification } from './verify.js';

let lastAppliedAutoTheme = null;
let lastAppliedAutoSurface = null;
let themeRefreshTimer = null;
let loudGenerationActive = false;

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
    setLastProcessedMessageSignature('');

    let changed = false;
    for (const entry of Object.values(characterColors)) {
        if (!entry || typeof entry !== 'object') continue;
        if ((Number(entry.dialogueCount) || 0) === 0) continue;
        entry.dialogueCount = 0;
        changed = true;
    }

    if (changed) commit({ history: false });
}

export function handleChatChanged() {
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
    // A disabled extension has nothing to load, scan or paint, and it must not
    // write: getCharKey() and getStorageKey() resolve a chat-scope ID that gets
    // stamped into chat metadata under the "Per chat" scope, and saving chat
    // metadata rewrites the user's whole chat file. Tear down and stop here.
    if (!settings.enabled) {
        updateCharList();
        injectPrompt();
        decorateAllMessages();
        return;
    }
    const currentCharKey = getCharKey();
    if (currentCharKey !== lastCharKey) {
        expandedCharacterRows.clear();
        setSwapMode(null);
        loadData();
        if (!Object.keys(characterColors).length) tryLoadFromCard();
        setLastCharKey(currentCharKey);
        setLastProcessedMessageSignature('');
        syncUIWithSettings();
    }
    if (settings.autoPersonaCharacter === true) ensurePersonaCharacter({ silent: true });
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
        setupChatObserver();
        startDomHealthCheck();
        decorateAllMessages();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        scheduleCustomFontRefresh(0);
    });
    clearTimeout(runtimeState.chatChangedSettleTimer);
    runtimeState.chatChangedSettleTimer = setTimeout(() => {
        runtimeState.chatChangedSettleTimer = null;
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

export function handleMessageUpdated(mesIndex) {
    // A swipe reuses the same mesid with an entirely different body, so the
    // frozen streaming assignments and the cached target must both be dropped.
    endStreamingPaint();
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

export function registerEventHandlers() {
    if (runtimeState.eventsRegistered) return;
    runtimeState.eventHandlers = {
        generationStarted: (type, _options, dryRun) => {
            if (dryRun) return;
            if (type !== 'quiet') loudGenerationActive = true;
        },
        generationAfterCommands: () => injectPrompt(),
        characterMessageRendered: () => { onNewMessage(); scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
        messageRendered: () => { scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
        messageUpdated: handleMessageUpdated,
        // No timers here: beginStreamingPaint installs a MutationObserver so the
        // repaint lands in the same frame as the host's .mes_text rewrite.
        streamToken: () => { setIsStreamingGenerationActive(true); beginStreamingPaint(); scheduleStreamingAttributionVerification(); },
        generationEnded: () => {
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
            queueAutoAttributionVerificationForRenderedMessages({ delay: 300 });
        },
        chatCreated: resetDialogueCountsForNewChat,
        chatChanged: handleChatChanged,
        characterRenamed: (oldValue, newValue) => {
            void migrateRenamedCharacterStorage(oldValue, newValue)
                .then(result => {
                    if (!result?.ok) console.warn('[Dialogue Colors] Character storage rename migration was not persisted.', result);
                })
                .catch(error => console.warn('[Dialogue Colors] Character storage rename migration failed.', error));
        },
        personaChanged: () => {
            // Each persona keeps its own pinned color, so a switch has to swap the pin in
            // before anything repaints, whether or not the persona entry is auto-created.
            // applyRestoredPersonaColor persists and repaints the swap; the settings list
            // alone would leave the chat showing the previous persona's color.
            const restored = applyRestoredPersonaColor();
            if (settings.autoPersonaCharacter === true) ensurePersonaCharacter({ silent: true });
            else if (!restored) return;
            updateCharList();
        },
        personaRenamed: payload => {
            if (renamePersonaCharacter(payload?.oldName, payload?.newName)) updateCharList();
        },
        settingsUpdated: () => {
            clearTimeout(themeRefreshTimer);
            themeRefreshTimer = setTimeout(() => {
                invalidateThemeCache();
                const currentTheme = settings.themeMode === 'auto' ? detectTheme() : null;
                const currentSurface = settings.themeMode === 'auto' ? getReadableSurfaceSignature() : null;
                const themeChanged = lastAppliedAutoTheme && currentTheme && (
                    currentTheme !== lastAppliedAutoTheme || currentSurface !== lastAppliedAutoSurface
                );
                lastAppliedAutoTheme = currentTheme;
                lastAppliedAutoSurface = currentSurface;
                if (themeChanged) applyThemeOrBrightnessChange(() => {}, { saveImmediately: true });
            }, 80);
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
    if (event_types.STREAM_TOKEN_RECEIVED) eventSource.on(event_types.STREAM_TOKEN_RECEIVED, runtimeState.eventHandlers.streamToken);
    if (event_types.SMOOTH_STREAM_TOKEN_RECEIVED) eventSource.on(event_types.SMOOTH_STREAM_TOKEN_RECEIVED, runtimeState.eventHandlers.streamToken);
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, runtimeState.eventHandlers.generationEnded);
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

export function init() {
    migrateLegacyLocalStorageIfNeeded();
    loadData();
    captureLoadedAttributionMessageBaseline();
    invalidateThemeCache();
    lastAppliedAutoTheme = settings.themeMode === 'auto' ? detectTheme() : null;
    lastAppliedAutoSurface = settings.themeMode === 'auto' ? getReadableSurfaceSignature() : null;
    if (lastAppliedAutoTheme) applyThemeOrBrightnessChange(() => {}, { saveImmediately: true });
    initAutoSync();
    setTimeout(() => ensureRegexScript(), 1000);
    setupContextMenu();
    registerDialogueColorsMacro();

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
            console.warn('[Dialogue Colors] #extensions_settings never appeared after 30s; the settings panel was not created. Reload SillyTavern to retry.');
        }
    }, 500);
}

// External generation interceptor called by SillyTavern during prompt generation.
globalThis.DialogueColorsInterceptor = async function (chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled && !isDomEngine()) injectPrompt(); };
