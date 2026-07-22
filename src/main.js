// main.js - extracted from index.js (mechanical split)
import { clearDomCache } from './attribution.js';
import { scanAllMessages, stripColorBlocksFromDisplay } from './color-blocks.js';
import { setupContextMenu } from './context-menu.js';
import { DOM_RETRY_REFRESH_DELAYS, POST_MUTATION_DOM_REPAIR_DELAY_MS, clearDecoratedWatchers, decorateAllMessages, hasMessageQuoteOverridesForLatestMessage, scheduleDecorateLast, scheduleDomRefreshSeries, scheduleDomSettleRefresh, scheduleMessageDomRepair, setupChatObserver, setupChatRootObserver, startDomHealthCheck, stopDomHealthCheck } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { redo, undo } from './history.js';
import { commit, onNewMessage } from './live-colors.js';
import { populateProfileDropdown } from './llm.js';
import { detectTheme, getReadableSurfaceSignature, invalidateThemeCache } from './palettes.js';
import { buildMinimalPromptInstruction, injectPrompt } from './prompts.js';
import { eventSource, event_types, getContext } from './st-api.js';
import { attributionChatGeneration, autoSyncPendingRecord, characterColors, expandedCharacterRows, isDomEngine, isStreamingGenerationActive, lastCharKey, lastProcessedMessageSignature, pendingAttributionVerifications, runtimeState, selectedCharacterKeys, setAttributionChatGeneration, setIsStreamingGenerationActive, setLastCharKey, setLastProcessedMessageSignature, setPendingAttributionVerifications, setSwapMode, settings, streamingHeuristicCache, swapMode } from './state.js';
import { confirmAutoSyncRecord, doAutoSyncMarkersMatch, ensureRegexScript, getAutoSyncRecord, getCharKey, getStorageKey, initAutoSync, loadData, migrateLegacyLocalStorageIfNeeded, migrateRenamedCharacterStorage, tryLoadFromCard, updateAutoSyncUI } from './storage.js';
import { applyThemeOrBrightnessChange, clearAutoColorizeIndicators, createUI, syncUIWithSettings, updateCharList } from './ui.js';
import { cancelStreamingAttributionVerification, clearAutoAttributionVerificationQueue, queueAutoAttributionVerificationForRenderedMessages, scheduleStreamingAttributionVerification } from './verify.js';

let lastAppliedAutoTheme = null;
let lastAppliedAutoSurface = null;
let themeRefreshTimer = null;

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
    selectedCharacterKeys.clear();
    setAttributionChatGeneration(attributionChatGeneration + 1);
    setIsStreamingGenerationActive(false);
    cancelStreamingAttributionVerification({ clearOverrides: true });
    streamingHeuristicCache.clear();
    setPendingAttributionVerifications([]);
    clearAutoAttributionVerificationQueue({ clearCooldown: true });
    clearAutoColorizeIndicators();
    clearDomCache();
    stopDomHealthCheck();
    const currentCharKey = getCharKey();
    clearDecoratedWatchers();
    if (currentCharKey !== lastCharKey) {
        expandedCharacterRows.clear();
        setSwapMode(null);
        loadData();
        if (!Object.keys(characterColors).length) tryLoadFromCard();
        setLastCharKey(currentCharKey);
        setLastProcessedMessageSignature('');
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
    const shouldInitialScan = settings.enabled
        && settings.autoScanOnLoad !== false
        && !Object.keys(characterColors).length;
    const scanGeneration = attributionChatGeneration;
    const scanStorageKey = getStorageKey();
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

export function registerEventHandlers() {
    if (runtimeState.eventsRegistered) return;
    runtimeState.eventHandlers = {
        generationAfterCommands: () => injectPrompt(),
        characterMessageRendered: () => { onNewMessage(); scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
        messageRendered: () => { scheduleDomRefreshSeries(120); scheduleCustomFontRefresh(120); },
        messageUpdated: handleMessageUpdated,
        streamToken: () => { setIsStreamingGenerationActive(true); scheduleDecorateLast(hasMessageQuoteOverridesForLatestMessage() ? 0 : 80); scheduleCustomFontRefresh(120); scheduleStreamingAttributionVerification(); },
        generationEnded: () => {
            setIsStreamingGenerationActive(false);
            streamingHeuristicCache.clear();
            cancelStreamingAttributionVerification();
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
        }
    }, 500);
}

// External generation interceptor called by SillyTavern during prompt generation.
globalThis.DialogueColorsInterceptor = async function (chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled && !isDomEngine()) injectPrompt(); };
