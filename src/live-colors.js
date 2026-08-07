// live-colors.js - extracted from index.js (mechanical split)
import { attributeDialogueSegments, clearSpeakerRegexCache, colorizeMessageText, ensureCharacterEntry } from './attribution.js';
import { collectFontColorsFromText, countFontColorStatsFromKnownColors, parseColorAssignmentsFromText, parseNamedColorAssignmentsFromText, processColorBlocksInText, refreshTransientNarratorCount, resolveCharacterKeyByNameOrAlias, stripColorBlockFromElement } from './color-blocks.js';
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, refreshMessageDom, scheduleDomRefreshSeries, scheduleDomSettleRefresh } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { saveHistory } from './history.js';
import { callLLMWithProfile, classifyLlmRequestError } from './llm.js';
import { getNarratorVisual } from './narrator-style.js';
import { applyThemeReadabilityAndBrightness, getBaseColor, getEntryEffectiveColor, getPersonaName, invalidateThemeCache, syncAllEffectiveColors } from './palettes.js';
import { buildColorMetadataPromptLines, buildLLMColorizeRules, buildThoughtSymbolColorPromptRule, getThoughtDelimiterSymbols, injectPrompt } from './prompts.js';
import { generateQuietPrompt, getContext } from './st-api.js';
import { COLOR_STATE_SAVE_DELAY_MS, LIVE_CHAT_SAVE_DELAY_MS, attributionChatGeneration, characterColors, colorStateSaveTimer, isAutoColorizing, isColorizing, isDomEngine, isRecoloring, lastProcessedMessageSignature, liveChatSaveTimer, pendingColorStateHistory, pendingColorStateInjectPrompt, pendingColorStateSaveData, pendingColorStateUpdateList, setColorStateSaveTimer, setIsAutoColorizing, setIsColorizing, setIsRecoloring, setLastProcessedMessageSignature, setLiveChatSaveTimer, setPendingColorStateHistory, setPendingColorStateInjectPrompt, setPendingColorStateSaveData, setPendingColorStateUpdateList, setPendingLiveChatSave, settings } from './state.js';
import { getStorageKey, saveData } from './storage.js';
import { clearAutoColorizeIndicators, hideAutoColorizeIndicator, setColorizeButtonBusy, setRecolorButtonBusy, showAutoColorizeIndicator, updateCharList, updateLegend, updateStorageScopeStatus } from './ui.js';
import { hashMessageText, isCompositeSpeakerLabel, isToolCallMessage, normalizeHexColor, toast } from './utils.js';

let pendingAutoColorizeRetry = false;
let chatSaveInFlight = null;
let colorizeRunSequence = 0;
let activeColorizeRun = null;

const chatSaveRecords = new Set();
const CHAT_SAVE_MAX_AUTO_RETRIES = 2;
const CHAT_SAVE_RETRY_BASE_DELAY_MS = 1000;
const CHAT_SAVE_OPERATION_TIMEOUT_MS = 15000;
const CHAT_SAVE_UNCERTAIN_RETRY_DELAY_MS = 30000;
const COLORIZE_BATCH_MAX_MESSAGES = 6;
const COLORIZE_BATCH_MAX_CHARACTERS = 6000;
const COLORIZE_BATCH_MAX_ATTEMPTS = 2;
const COLORIZE_MAX_INDIVIDUAL_LLM_FALLBACKS = 2;
const COLORIZE_RUN_MAX_LLM_REQUESTS = 4;
const COLORIZE_RUN_MAX_LLM_RETRIES = 1;

// The LLM engine rewrites message text in place, so user-authored messages are normally
// left alone. When persona coloring is switched on the user has opted into having their
// own lines tagged, but only their own: any other user message stays untouched.
//
// The tool-call test has to come first: a tool-call message is not a user message, so without
// it the !msg.is_user tier below returns true and the engine treats a JSON payload as dialogue.
export function isColorableMessage(msg) {
    if (!msg) return false;
    if (isToolCallMessage(msg)) return false;
    if (!msg.is_user) return true;
    if (settings.autoPersonaCharacter !== true) return false;
    const personaName = getPersonaName();
    if (!personaName) return false;
    const personaKey = resolveCharacterKeyByNameOrAlias(personaName);
    const messageKey = resolveCharacterKeyByNameOrAlias(String(msg.name ?? '').trim());
    return !!personaKey && personaKey === messageKey;
}

function normalizeContextId(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

export function captureChatBinding(context = getContext()) {
    const chat = context?.chat;
    if (!Array.isArray(chat)) return null;
    let chatId = normalizeContextId(context?.chatId) ?? normalizeContextId(context?.chat_id);
    if (chatId === null && typeof context?.getCurrentChatId === 'function') {
        try { chatId = normalizeContextId(context.getCurrentChatId()); } catch { /* unavailable on older hosts */ }
    }
    const groupId = normalizeContextId(context?.groupId) ?? normalizeContextId(context?.group_id);
    const characterIndex = context?.characterId ?? context?.character_id;
    const character = groupId === null ? context?.characters?.[characterIndex] : null;
    const ownerId = groupId === null
        ? normalizeContextId(character?.avatar ?? character?.characterId ?? character?.character_id ?? characterIndex)
        : null;
    const durableId = chatId !== null && (groupId !== null || ownerId !== null)
        ? `chat:${chatId}\u0000group:${groupId ?? ''}\u0000owner:${ownerId ?? ''}`
        : null;
    return {
        chat,
        chatId,
        groupId,
        ownerId,
        durableId,
    };
}

export function areChatBindingsEqual(left, right) {
    if (!left || !right) return false;
    if (left.durableId || right.durableId) {
        return !!left.durableId && left.durableId === right.durableId;
    }
    return left.chat === right.chat
        && left.chatId === right.chatId
        && left.groupId === right.groupId
        && left.ownerId === right.ownerId;
}

function isChatBindingCurrent(binding, context = getContext()) {
    return areChatBindingsEqual(binding, captureChatBinding(context));
}

function isCapturedChatBindingCurrent(binding, context = getContext()) {
    const current = captureChatBinding(context);
    return areChatBindingsEqual(binding, current) && binding?.chat === current?.chat;
}

function syncPendingChatSaveState() {
    setPendingLiveChatSave([...chatSaveRecords].some(record => record.dirty));
}

function clearChatSaveTimer() {
    if (!liveChatSaveTimer) return;
    clearTimeout(liveChatSaveTimer);
    setLiveChatSaveTimer(null);
}

function scheduleChatSave(record, delay = LIVE_CHAT_SAVE_DELAY_MS) {
    clearChatSaveTimer();
    const numericDelay = Number(delay);
    if (!Number.isFinite(numericDelay)) return;
    const wait = Math.max(0, numericDelay || 0);
    setLiveChatSaveTimer(setTimeout(() => {
        setLiveChatSaveTimer(null);
        void saveChatRecord(record, false);
    }, wait));
}

export function resumePendingChatSave(context = getContext()) {
    clearChatSaveTimer();
    const binding = captureChatBinding(context);
    if (!binding) return false;
    const record = [...chatSaveRecords].find(candidate => candidate.dirty
        && areChatBindingsEqual(candidate.binding, binding));
    if (!record) {
        syncPendingChatSaveState();
        return false;
    }
    // A host may replace the chat array when reactivating the same durable
    // chat. Rebind only after its stable identity matches the current context.
    record.binding = binding;
    const dueAt = Math.max(record.nextAttemptAt || 0, record.uncertainUntil || 0);
    if (Number.isFinite(dueAt)) scheduleChatSave(record, Math.max(0, dueAt - Date.now()));
    syncPendingChatSaveState();
    return true;
}

function createColorizeRequestBudget() {
    return { requests: 0, retries: 0, stopped: false };
}

function reserveColorizeRequest(budget, { retry = false } = {}) {
    if (!budget || budget.stopped || budget.requests >= COLORIZE_RUN_MAX_LLM_REQUESTS) return false;
    if (retry && budget.retries >= COLORIZE_RUN_MAX_LLM_RETRIES) return false;
    budget.requests++;
    if (retry) budget.retries++;
    return true;
}

function recordColorizeRequestFailure(budget, errorOrClassification) {
    const classification = errorOrClassification
        && typeof errorOrClassification.retryable === 'boolean'
        && typeof errorOrClassification.category === 'string'
        ? errorOrClassification
        : classifyLlmRequestError(errorOrClassification);
    if (!classification.retryable) budget.stopped = true;
    return classification;
}

function markChatDirty(binding = captureChatBinding()) {
    if (!binding) return null;
    let record = [...chatSaveRecords].find(candidate => areChatBindingsEqual(candidate.binding, binding));
    if (!record) {
        record = {
            binding,
            version: 0,
            dirty: false,
            failureCount: 0,
            nextAttemptAt: 0,
            uncertainUntil: 0,
            completedVersion: 0,
            unsettledOperations: new Set(),
        };
        chatSaveRecords.add(record);
    }
    record.binding = binding;
    record.version++;
    record.dirty = true;
    const now = Date.now();
    if (!record.unsettledOperations.size && !Number.isFinite(record.nextAttemptAt)) {
        record.failureCount = 0;
        record.uncertainUntil = 0;
    }
    record.nextAttemptAt = Math.max(
        now + LIVE_CHAT_SAVE_DELAY_MS,
        record.uncertainUntil || 0,
        record.failureCount > 0 ? record.nextAttemptAt : 0,
    );
    syncPendingChatSaveState();
    return record;
}

function classifyHostSaveResult(value, asynchronous) {
    if (value === false || value?.ok === false || value?.saved === false) {
        return { accepted: false, confirmed: false, uncertain: false, error: new Error('Host reported that the chat was not saved.') };
    }
    if (value === true || value?.ok === true || value?.saved === true) {
        return { accepted: true, confirmed: true, uncertain: false };
    }
    if (asynchronous) {
        // SillyTavern's public saveChat Promise resolves void and does not
        // expose durable success. Settlement confirms dispatch completion only.
        return { accepted: true, confirmed: false, uncertain: false };
    }
    return { accepted: false, confirmed: false, uncertain: true, error: new Error('Host saveChat returned without a completion confirmation.') };
}

function finishChatSaveRecordIfClean(record) {
    if (!record.dirty && !record.unsettledOperations.size) chatSaveRecords.delete(record);
    syncPendingChatSaveState();
}

function completeChatSaveOperation(record, operation) {
    record.completedVersion = Math.max(record.completedVersion || 0, operation.savedVersion);
    record.failureCount = 0;
    if (!record.unsettledOperations.size) record.uncertainUntil = 0;
    if (record.version === operation.savedVersion
        && areChatBindingsEqual(record.binding, operation.binding)) {
        record.dirty = false;
        record.nextAttemptAt = 0;
    } else if (record.dirty && !record.unsettledOperations.size) {
        record.nextAttemptAt = Date.now() + LIVE_CHAT_SAVE_DELAY_MS;
        if (isChatBindingCurrent(record.binding)) scheduleChatSave(record, LIVE_CHAT_SAVE_DELAY_MS);
    }
    finishChatSaveRecordIfClean(record);
}

function deferUnconfirmedChatSave(record, operation, outcome) {
    if (operation.failureRecorded || (record.completedVersion || 0) >= operation.savedVersion) return;
    operation.failureRecorded = true;
    record.dirty = true;
    record.failureCount++;
    const retryDelay = outcome.uncertain
        ? CHAT_SAVE_UNCERTAIN_RETRY_DELAY_MS
        : CHAT_SAVE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, record.failureCount - 1));
    if (outcome.uncertain) record.uncertainUntil = Math.max(record.uncertainUntil || 0, Date.now() + retryDelay);
    if (record.failureCount <= CHAT_SAVE_MAX_AUTO_RETRIES) {
        record.nextAttemptAt = Math.max(Date.now() + retryDelay, record.uncertainUntil || 0);
        if (isChatBindingCurrent(record.binding)) scheduleChatSave(record, record.nextAttemptAt - Date.now());
    } else {
        record.nextAttemptAt = Number.POSITIVE_INFINITY;
    }
    if (outcome.uncertain) {
        console.warn('[Dialogue Colors] Failed to confirm chat save; changes remain queued:', outcome.error);
    } else {
        console.error('[Dialogue Colors] Failed to confirm chat save; changes remain queued:', outcome.error);
    }
    syncPendingChatSaveState();
}

async function saveChatRecord(record, forceRetry) {
    if (!record?.dirty) return true;

    if (chatSaveInFlight) {
        await chatSaveInFlight;
        return saveChatRecord(record, forceRetry);
    }

    const saveBinding = record.binding;
    const context = getContext();
    if (!isChatBindingCurrent(saveBinding, context) || typeof context?.saveChat !== 'function') {
        syncPendingChatSaveState();
        return false;
    }

    const now = Date.now();
    if (record.uncertainUntil > now) {
        scheduleChatSave(record, record.uncertainUntil - now);
        return false;
    }
    if ((!forceRetry || record.failureCount > 0) && record.nextAttemptAt > now) {
        if (!Number.isFinite(record.nextAttemptAt)) return false;
        scheduleChatSave(record, record.nextAttemptAt - now);
        return false;
    }

    const savedVersion = record.version;
    const operation = {
        binding: saveBinding,
        savedVersion,
        failureRecorded: false,
    };
    record.unsettledOperations.add(operation);
    let releaseGlobalGate;
    const globalGate = new Promise(resolve => { releaseGlobalGate = resolve; });
    chatSaveInFlight = globalGate;

    const hostSettlement = new Promise(resolve => {
        const saveContext = getContext();
        if (!isChatBindingCurrent(saveBinding, saveContext) || typeof saveContext?.saveChat !== 'function') {
            resolve({ accepted: false, confirmed: false, uncertain: false, error: new Error('Captured chat is no longer current.') });
            return;
        }
        try {
            const result = saveContext.saveChat.call(saveContext);
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).then(
                    value => resolve(classifyHostSaveResult(value, true)),
                    error => resolve({ accepted: false, confirmed: false, uncertain: false, error }),
                );
            } else {
                resolve(classifyHostSaveResult(result, false));
            }
        } catch (error) {
            resolve({ accepted: false, confirmed: false, uncertain: false, error });
        }
    });
    hostSettlement.then(outcome => {
        record.unsettledOperations.delete(operation);
        if (outcome.accepted) completeChatSaveOperation(record, operation);
        else deferUnconfirmedChatSave(record, operation, outcome);
        finishChatSaveRecordIfClean(record);
    });

    let timeoutId = null;
    const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve({
            accepted: false,
            confirmed: false,
            uncertain: true,
            timeout: true,
            error: new Error(`Host saveChat did not settle within ${CHAT_SAVE_OPERATION_TIMEOUT_MS}ms.`),
        }), CHAT_SAVE_OPERATION_TIMEOUT_MS);
    });
    let outcome;
    try {
        outcome = await Promise.race([hostSettlement, timeout]);
        if (outcome.timeout) deferUnconfirmedChatSave(record, operation, outcome);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        releaseGlobalGate();
        if (chatSaveInFlight === globalGate) chatSaveInFlight = null;
    }
    if (outcome?.accepted && record.dirty
        && areChatBindingsEqual(record.binding, saveBinding)
        && isChatBindingCurrent(saveBinding)) {
        return saveChatRecord(record, false);
    }
    return outcome?.accepted === true && !record.dirty;
}

function queueCapturedChatSave(binding, { immediate = true } = {}) {
    const record = markChatDirty(binding);
    if (!record) return Promise.resolve(false);
    if (immediate) {
        clearChatSaveTimer();
        return saveChatRecord(record, true);
    }
    scheduleChatSave(record, LIVE_CHAT_SAVE_DELAY_MS);
    return Promise.resolve(true);
}

export function normalizeColorReplacementMap(replacements) {
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

export function normalizeNameColorMap(nameToNewColor) {
    const normalized = {};
    if (!nameToNewColor || typeof nameToNewColor !== 'object') return normalized;
    for (const [name, color] of Object.entries(nameToNewColor)) {
        const nameKey = String(name ?? '').trim().toLowerCase();
        const nextColor = normalizeHexColor(color, null);
        if (nameKey && nextColor) normalized[nameKey] = nextColor;
    }
    return normalized;
}

export function updateTextColorReferences(rawText, replacements) {
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

export function updateVisibleMessageColors(messageIndex, replacements) {
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

export function queueChatSave() {
    void queueCapturedChatSave(captureChatBinding());
}

export function flushChatSave() {
    clearChatSaveTimer();
    const binding = captureChatBinding();
    const record = binding
        ? [...chatSaveRecords].find(candidate => areChatBindingsEqual(candidate.binding, binding))
        : null;
    return record ? saveChatRecord(record, true) : Promise.resolve(false);
}

export function buildGlobalColorAssignmentLookup(chat) {
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

export function buildMessageLiveReplacements(rawText, fallbackReplacements, nameToNewColor, globalAssignments) {
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

export function applyLiveColorReplacements(replacements, options = {}) {
    const fallbackReplacements = normalizeColorReplacementMap(replacements);
    const nameToNewColor = normalizeNameColorMap(options.nameToNewColor);
    if (!Object.keys(fallbackReplacements).length && !Object.keys(nameToNewColor).length) return 0;
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const chatBinding = captureChatBinding(ctx);
    const globalAssignments = Object.keys(nameToNewColor).length ? buildGlobalColorAssignmentLookup(chat) : null;
    let changedCount = 0;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!isColorableMessage(msg)) continue;
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
        void queueCapturedChatSave(chatBinding, { immediate: true });
    }
    return changedCount;
}

export function captureEffectiveColorSnapshot(keys = Object.keys(characterColors)) {
    const snapshot = {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        const entry = characterColors[key];
        if (!entry) continue;
        snapshot[key] = getEntryEffectiveColor(entry);
    }
    return snapshot;
}

export function buildColorReplacementsFromSnapshot(snapshot, keys = Object.keys(snapshot || {})) {
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

export function buildNameToCurrentColorForKeys(keys = Object.keys(characterColors)) {
    const nameToNewColor = {};
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        const entry = characterColors[key];
        if (!entry) continue;
        const color = getEntryEffectiveColor(entry);
        nameToNewColor[entry.name] = color;
        for (const alias of entry.aliases || []) nameToNewColor[alias] = color;
    }
    const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
    if (narrator) nameToNewColor.Narrator = narrator.color;
    return nameToNewColor;
}

export function applyFastColorUiUpdates(keys = Object.keys(characterColors)) {
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

export function applyLiveColorChangesFromSnapshot(snapshot, keys = Object.keys(snapshot || {}), options = {}) {
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
    if (options.repaintStyles) scheduleDomRefreshSeries(options.saveImmediately ? 0 : 120);
    scheduleCustomFontRefresh(options.saveImmediately ? 0 : 120);
    if (!settings.autoRecolor && !options.force) return 0;
    const list = Array.isArray(keys) ? keys : [keys];
    const changedCount = applyLiveColorReplacements(buildColorReplacementsFromSnapshot(snapshot, list), {
        nameToNewColor: buildNameToCurrentColorForKeys(list),
        saveImmediately: options.saveImmediately,
    });
    return changedCount;
}

export function repaintDomAfterCharacterDataChange(delay = 0) {
    if (isDomEngine()) scheduleDomRefreshSeries(delay);
    scheduleCustomFontRefresh(delay);
}

export function refreshEffectiveColorsAfterRestore() {
    clearSpeakerRegexCache();
    invalidateThemeCache();
    syncAllEffectiveColors();
}

export function queueColorStateSave(options = {}) {
    // `data: false` queues the UI half only, for callers whose change is
    // display-only and must not write anything to disk. A pending real save
    // already queued by another caller still wins.
    setPendingColorStateSaveData(pendingColorStateSaveData || options.data !== false);
    setPendingColorStateHistory(pendingColorStateHistory || options.history !== false);
    setPendingColorStateUpdateList(pendingColorStateUpdateList || options.updateList !== false);
    setPendingColorStateInjectPrompt(pendingColorStateInjectPrompt || options.injectPrompt !== false);
    if (colorStateSaveTimer) clearTimeout(colorStateSaveTimer);
    setColorStateSaveTimer(setTimeout(() => flushColorStateSave(), COLOR_STATE_SAVE_DELAY_MS));
}

// Synchronous commit of a character/color mutation. Replaces the repeated
// `commit();` quartet.
// Pass `false` for any step to opt out (e.g. commit({ history: false })).

export function flushColorStateSave() {
    if (colorStateSaveTimer) {
        clearTimeout(colorStateSaveTimer);
        setColorStateSaveTimer(null);
    }
    if (!pendingColorStateSaveData && !pendingColorStateHistory && !pendingColorStateUpdateList && !pendingColorStateInjectPrompt) return;
    const shouldSaveHistory = pendingColorStateHistory;
    const shouldSaveData = pendingColorStateSaveData;
    const shouldUpdateList = pendingColorStateUpdateList;
    const shouldInjectPrompt = pendingColorStateInjectPrompt;
    setPendingColorStateSaveData(false);
    setPendingColorStateHistory(false);
    setPendingColorStateUpdateList(false);
    setPendingColorStateInjectPrompt(false);
    if (shouldSaveHistory) saveHistory();
    if (shouldSaveData) {
        saveData();
        updateStorageScopeStatus();
    }
    if (shouldInjectPrompt) injectPrompt();
    if (shouldUpdateList) updateCharList();
    if (!shouldUpdateList || !document.getElementById('dc-char-list')) updateLegend();
}

// Synchronous commit of a character/color mutation. Replaces the repeated
// `commit();` quartet.
// Pass `false` for any step to opt out (e.g. commit({ history: false })).
export function commit(options = {}) {
    if (options.history !== false) saveHistory();
    if (options.data !== false) {
        saveData();
        updateStorageScopeStatus();
    }
    if (options.inject !== false) injectPrompt();
    const shouldUpdateList = options.updateList !== false;
    if (shouldUpdateList) updateCharList();
    if (options.legend !== false && (!shouldUpdateList || !document.getElementById('dc-char-list'))) updateLegend();
}

export function normalizeColorizedTextForComparison(text) {
    const source = stripLLMColorMetadata(text);
    return parseCanonicalFontMarkup(source)?.projection ?? source;
}

function stripLLMColorMetadata(text) {
    return String(text ?? '').replace(/(?:\r\n?|\n)?\[COLORS?:[^\]\r\n]*\][ \t]*(?:\r\n?|\n)?$/i, '');
}

function unwrapLLMColorizeResponse(text) {
    const source = String(text ?? '');
    const match = source.match(/^[ \t]*```(?:html|xml|markdown|md|text|txt)?[ \t]*(?:\r\n?|\n)([\s\S]*?)(?:\r\n?|\n)```[ \t]*(?:\r\n?|\n)?$/i);
    return match ? match[1] : source;
}

function parseCanonicalFontMarkup(text) {
    const source = String(text ?? '');
    const colors = [];
    const spans = [];
    let canonicalText = '';
    let projection = '';
    let openColor = null;
    let openProjectionLength = 0;
    let sawFont = false;
    let cursor = 0;

    while (cursor < source.length) {
        const tagStart = source.indexOf('<', cursor);
        if (tagStart === -1) {
            const remainder = source.slice(cursor);
            canonicalText += remainder;
            projection += remainder;
            break;
        }

        const plainText = source.slice(cursor, tagStart);
        canonicalText += plainText;
        projection += plainText;
        const remainder = source.slice(tagStart);
        const isOpeningFont = /^<font(?=\s|>|$)/i.test(remainder);
        const isClosingFont = /^<\/font(?=\s|>|$)/i.test(remainder);

        if (isOpeningFont || isClosingFont) {
            const tagEnd = source.indexOf('>', tagStart + 1);
            if (tagEnd === -1) return null;
            const tag = source.slice(tagStart, tagEnd + 1);

            if (isOpeningFont) {
                if (openColor) return null;
                const match = tag.match(/^<font color="(#[0-9a-fA-F]{6})">$/);
                if (!match) return null;
                openColor = match[1].toLowerCase();
                openProjectionLength = projection.length;
                canonicalText += `<font color="${openColor}">`;
                colors.push(openColor);
                sawFont = true;
            } else {
                if (!openColor || tag !== '</font>' || projection.length === openProjectionLength) return null;
                canonicalText += '</font>';
                spans.push({ start: openProjectionLength, end: projection.length, color: openColor });
                openColor = null;
            }

            cursor = tagEnd + 1;
            continue;
        }

        // Every non-font byte, including existing source markup, belongs to the
        // projection and must compare exactly with the original message.
        canonicalText += '<';
        projection += '<';
        cursor = tagStart + 1;
    }

    if (openColor) return null;
    return { canonicalText, projection, colors, spans, sawFont };
}

function getSafeMetadataName(value) {
    const name = String(value ?? '').trim();
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\[\]=,()<>]/.test(name)) return '';
    return name;
}

function getValidatedAssignmentsForColors(colors, narratorColor = null) {
    const candidatesByColor = new Map();
    const register = (name, color) => {
        const safeName = getSafeMetadataName(name);
        const safeColor = normalizeHexColor(color, null);
        if (!safeName || !safeColor) return;
        if (!candidatesByColor.has(safeColor)) candidatesByColor.set(safeColor, new Map());
        candidatesByColor.get(safeColor).set(safeName.toLowerCase(), { name: safeName, color: safeColor });
    };

    for (const entry of Object.values(characterColors)) {
        if (!entry) continue;
        register(entry.name, getEntryEffectiveColor(entry));
    }
    if (narratorColor) register('Narrator', narratorColor);

    const assignments = [];
    const seenColors = new Set();
    for (const rawColor of colors || []) {
        const color = normalizeHexColor(rawColor, null);
        if (!color || seenColors.has(color)) continue;
        seenColors.add(color);
        const candidates = [...(candidatesByColor.get(color)?.values() || [])];
        if (candidates.length === 1) assignments.push(candidates[0]);
    }
    return assignments;
}

function formatValidatedColorMetadata(assignments) {
    return (assignments || []).map(({ name, color }) => {
        const safeName = getSafeMetadataName(name);
        const safeColor = normalizeHexColor(color, null);
        return safeName && safeColor ? `${safeName}=${safeColor}` : '';
    }).filter(Boolean).join(',');
}

export function detectLLMQuoteArtifacts(originalText, candidateText) {
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

export function extractUsedAssignmentsFromColorizedText(text, narratorColor = null) {
    const parsed = parseCanonicalFontMarkup(stripLLMColorMetadata(text));
    return parsed ? getValidatedAssignmentsForColors(parsed.colors, narratorColor) : [];
}

export function finalizeLLMColorizedText(rawText, responseText, narratorColor = null, options = {}) {
    if (!responseText || typeof responseText !== 'string') return null;

    const cleaned = unwrapLLMColorizeResponse(responseText);
    const candidateWithoutMetadata = stripLLMColorMetadata(cleaned);
    const parsedCandidate = parseCanonicalFontMarkup(candidateWithoutMetadata);
    if (!parsedCandidate) {
        if (!options.silent) console.warn('[Dialogue Colors] Rejected malformed LLM colorize markup.');
        return null;
    }

    const originalWithoutMetadata = stripLLMColorMetadata(rawText);
    const parsedOriginal = parseCanonicalFontMarkup(originalWithoutMetadata);
    if (!parsedOriginal) return null;
    const quoteIssues = detectLLMQuoteArtifacts(parsedOriginal.projection, parsedCandidate.projection);
    if (quoteIssues.length || parsedCandidate.projection !== parsedOriginal.projection) {
        if (!options.silent) {
            console.warn('[Dialogue Colors] Rejected LLM colorize output due to text drift:', {
                issues: quoteIssues,
                originalSample: parsedOriginal.projection.slice(0, 200),
                candidateSample: parsedCandidate.projection.slice(0, 200),
            });
        }
        return null;
    }

    if (!parsedCandidate.sawFont) {
        if (candidateWithoutMetadata !== originalWithoutMetadata) return null;
        return { updatedText: rawText, changed: false, colorized: false, usedAssignments: [] };
    }

    const usedAssignments = getValidatedAssignmentsForColors(parsedCandidate.colors, narratorColor);
    const metadata = formatValidatedColorMetadata(usedAssignments);
    const finalText = `${parsedCandidate.canonicalText}${metadata ? `\n[COLORS:${metadata}]` : ''}`;

    return {
        updatedText: finalText,
        changed: finalText !== rawText,
        colorized: true,
        usedAssignments,
    };
}

// Completes a message the model colored only partially: dialogue the existing font
// spans already cover is left byte-identical, the rest is attributed and wrapped
// locally. Declines non-canonical markup (never guess) and fully uncolored messages
// (those belong to the autoColorize path).
export function fillUncoloredDialogueGaps(rawText, messageSpeakerName = '', options = {}) {
    const source = String(rawText ?? '');
    const noChange = { updatedText: source, changed: false, createdCharacters: false, filledCount: 0 };
    const parsed = parseCanonicalFontMarkup(stripLLMColorMetadata(source));
    if (!parsed || !parsed.sawFont) return noChange;

    // Attribution runs on the projection, not the raw text: font attribute quotes
    // (color="#...") would otherwise match as dialogue, and alternation should read
    // the whole clean text, covered segments included.
    const { segments, createdCharacters } = attributeDialogueSegments(parsed.projection, messageSpeakerName, options);
    const gaps = segments.filter(seg => seg.assignment
        && !parsed.spans.some(span => seg.start < span.end && seg.end > span.start));
    if (!gaps.length) return { ...noChange, createdCharacters };

    // Existing spans regenerate byte-identically (the parser accepts only the
    // canonical form), so one back-to-front insertion pass rebuilds everything.
    const inserts = [
        ...parsed.spans,
        ...gaps.map(seg => ({ start: seg.start, end: seg.end, color: seg.assignment.color })),
    ].sort((a, b) => b.start - a.start);
    let updatedText = parsed.projection;
    for (const { start, end, color } of inserts) {
        updatedText = `${updatedText.slice(0, start)}<font color="${color}">${updatedText.slice(start, end)}</font>${updatedText.slice(end)}`;
    }

    const narratorColor = getNarratorVisual(settings, applyThemeReadabilityAndBrightness)?.color || null;
    const metadata = formatValidatedColorMetadata(getValidatedAssignmentsForColors(parseCanonicalFontMarkup(updatedText)?.colors, narratorColor));
    if (metadata && !/\[COLORS?:([^\]]*)\]/i.test(updatedText)) updatedText += `\n[COLORS:${metadata}]`;
    return {
        updatedText,
        changed: updatedText !== source,
        createdCharacters,
        filledCount: gaps.length,
    };
}

// Post-LLM completion: a colorized result may still have gaps the model skipped.
function completeLLMResultGaps(result, speakerName) {
    if (!result || result.colorized !== true) return result;
    const completed = fillUncoloredDialogueGaps(result.updatedText, speakerName, { autoAddMessageSpeaker: true });
    if (!completed.changed) return result;
    return {
        ...result,
        updatedText: completed.updatedText,
        changed: true,
        createdCharacters: completed.createdCharacters || result.createdCharacters === true,
        usedAssignments: extractUsedAssignmentsFromColorizedText(completed.updatedText,
            getNarratorVisual(settings, applyThemeReadabilityAndBrightness)?.color || null),
    };
}

// One-shot repair for chats damaged before isColorableMessage learned to skip tool calls.
//
// The LLM engine's only edits to a message are the insertion of <font color="#rrggbb"> ...
// </font> around exact substrings and one trailing [COLORS:] line, so parseCanonicalFontMarkup
// is that edit's exact inverse: its projection hands back every non-font byte unchanged and it
// returns null the moment it meets a tag this extension did not write. That makes the reversal
// provable rather than a guess, which is why nothing here uses the blunt stripFontTags and
// stripColorBlocks helpers, and why nothing rebuilds the message from extra.tool_invocations:
// ToolManager's formatter is a private static, it is not reachable through st-api.js, and
// reimplementing it would rewrite bytes that were never damaged.
export function restoreColorizedToolCallText(rawText) {
    const parsed = parseCanonicalFontMarkup(stripLLMColorMetadata(rawText));
    if (!parsed || !parsed.sawFont) return null;
    return parsed.projection;
}

// A name that survives only inside a tool-call message's color block was created by the bug, not
// by the chat. Resolved by name rather than against a hardcoded "SillyTavern System" so this
// stays correct on hosts that label the system user differently.
function removeUnreferencedCharacterEntries(candidateNames, chat) {
    const referencedKeys = new Set();
    const referencedColors = new Set();
    for (const msg of chat) {
        const text = msg?.mes || '';
        if (!text) continue;
        for (const { name } of parseNamedColorAssignmentsFromText(text)) {
            const key = resolveCharacterKeyByNameOrAlias(name);
            if (key) referencedKeys.add(key);
        }
        for (const color of collectFontColorsFromText(text)) referencedColors.add(color);
    }

    const removed = [];
    for (const name of candidateNames) {
        const key = resolveCharacterKeyByNameOrAlias(name);
        const entry = key ? characterColors[key] : null;
        // Keep is the user's explicit "protect this entry" flag. Deliberately not gated on
        // locked: processColorPairs creates a detected entry with
        // locked: settings.autoLockDetected !== false, which defaults to true, so a lock guard
        // would refuse to clean up every entry the bug made.
        if (!entry || entry.keep === true) continue;
        if (referencedKeys.has(key)) continue;
        if (referencedColors.has(normalizeHexColor(getEntryEffectiveColor(entry), null))) continue;
        delete characterColors[key];
        removed.push(key);
    }
    if (removed.length) clearSpeakerRegexCache();
    return removed;
}

export function repairColorizedToolCallMessages(chat = getContext()?.chat) {
    const report = { repairedIndices: [], removedCharacterKeys: [] };
    if (!Array.isArray(chat) || !chat.length) return report;

    const candidateNames = new Set();
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!isToolCallMessage(msg)) continue;
        const rawText = msg.mes || '';
        // Cheap reject: an untouched tool-call message carries neither marker.
        if (!/<\/font\s*>/i.test(rawText) && !/\[COLORS?:/i.test(rawText)) continue;
        const restored = restoreColorizedToolCallText(rawText);
        if (restored === null || restored === rawText) continue;

        // Read the names off the block before it is dropped. msg.name is the host's system user,
        // which the speaker pre-registration loops registered separately.
        for (const { name } of parseNamedColorAssignmentsFromText(rawText)) candidateNames.add(name);
        if (msg.name) candidateNames.add(msg.name);
        msg.mes = restored;
        report.repairedIndices.push(i);
    }
    if (!report.repairedIndices.length) return report;

    report.removedCharacterKeys = removeUnreferencedCharacterEntries(candidateNames, chat);
    return report;
}

export async function applyToolCallMessageRepair(options = {}) {
    const chat = getContext()?.chat;
    // Synchronous, so the registry is final before the first await and updateCharList and
    // injectPrompt downstream of the caller both see the cleaned-up list.
    const report = repairColorizedToolCallMessages(chat);
    const count = report.repairedIndices.length;
    if (!count) {
        if (!options.silent) toast.info('No tool-call messages needed repair.');
        return report;
    }

    commit();
    queueChatSave();
    console.info('[Dialogue Colors] Restored tool-call messages this extension had colorized.', report);
    toast.info(`Restored ${count} tool-call message${count === 1 ? '' : 's'} this extension had colorized.`);
    for (const index of report.repairedIndices) await refreshMessageDom(index, chat[index]);
    return report;
}

export function shouldUseLocalColorizeFallback(llmResult) {
    return !llmResult || llmResult.colorized !== true;
}

export async function colorizeMessageWithLLM(rawText, messageSpeakerName = '') {
    if (typeof generateQuietPrompt !== 'function') return null;
    if (String(rawText ?? '').length > COLORIZE_BATCH_MAX_CHARACTERS) return null;

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
    const narratorColor = getNarratorVisual(settings, applyThemeReadabilityAndBrightness)?.color || null;
    if (narratorColor) charList.push(`Narrator=${narratorColor}`);
    if (!charList.length) return null;

    if (!defaultSpeakerColor && trimmedSpeaker) {
        const ensured = ensureCharacterEntry(trimmedSpeaker);
        if (ensured?.entry) {
            defaultSpeakerColor = getEntryEffectiveColor(ensured.entry);
            charList.push(`${ensured.entry.name}=${defaultSpeakerColor}`);
        }
    }

    const thoughtSymbols = getThoughtDelimiterSymbols();

    const lines = [
        '[Dialogue Colors — colorize existing message]',
        'Add <font color="#RRGGBB">...</font> tags to the dialogue and inner-thought spans in the message below.',
    ];
    lines.push(...buildLLMColorizeRules('- Return the complete message with color tags added. No commentary.'));
    lines.push('');
    lines.push(`Known speakers and colors: ${charList.join(', ')}`);
    lines.push(...buildColorMetadataPromptLines());
    if (thoughtSymbols.length) lines.push(`- ${buildThoughtSymbolColorPromptRule(thoughtSymbols)}`);
    if (narratorColor) lines.push(`- Narrator text: <font color="${narratorColor}">...</font>.`);
    if (trimmedSpeaker && defaultSpeakerColor) lines.push(`- Default speaker (message author): ${trimmedSpeaker}=${defaultSpeakerColor}.`);
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
        throw e;
    }
    if (typeof response !== 'string' || response.length > String(rawText ?? '').length * 4 + 4096) {
        console.warn('[Dialogue Colors] Rejected oversized LLM colorize response.');
        return null;
    }

    return finalizeLLMColorizedText(rawText, response, narratorColor);
}

function finalizeBatchColorizedBlock(rawText, blockText, narratorColor) {
    const candidates = new Set([String(blockText ?? '')]);
    for (const candidate of [...candidates]) {
        const leadingBreak = candidate.match(/^(?:\r\n?|\n)/)?.[0];
        if (leadingBreak) candidates.add(candidate.slice(leadingBreak.length));
    }
    for (const candidate of [...candidates]) {
        let withoutTrailingBreak = candidate;
        for (let count = 0; count < 2; count++) {
            const trailingBreak = withoutTrailingBreak.match(/(?:\r\n?|\n)$/)?.[0];
            if (!trailingBreak) break;
            withoutTrailingBreak = withoutTrailingBreak.slice(0, -trailingBreak.length);
            candidates.add(withoutTrailingBreak);
        }
    }
    for (const candidate of candidates) {
        const finalized = finalizeLLMColorizedText(rawText, candidate, narratorColor, { silent: true });
        if (finalized) return finalized;
    }
    return null;
}

function createBatchColorizeResult(results, status, details = {}) {
    Object.defineProperties(results, {
        status: { value: status, enumerable: false },
        ...(details.error ? { error: { value: details.error, enumerable: false } } : {}),
        ...(details.errorClassification ? {
            errorClassification: { value: details.errorClassification, enumerable: false },
        } : {}),
    });
    return results;
}

export async function colorizeMultipleMessagesWithLLM(messageBatch) {
    // messageBatch = [{ rawText, speakerName, msgIndex }, ...]
    if (!Array.isArray(messageBatch) || !messageBatch.length || typeof generateQuietPrompt !== 'function') {
        return createBatchColorizeResult([], 'invalid-input');
    }
    const inputCharacterCount = messageBatch.reduce((total, entry) => total + String(entry?.rawText ?? '').length, 0);
    if (messageBatch.length > COLORIZE_BATCH_MAX_MESSAGES
        || inputCharacterCount > COLORIZE_BATCH_MAX_CHARACTERS
        || messageBatch.some(entry => String(entry?.rawText ?? '').length > COLORIZE_BATCH_MAX_CHARACTERS)) {
        return createBatchColorizeResult([], 'invalid-input');
    }

    // Build character-color list
    const charList = [];
    for (const entry of Object.values(characterColors)) {
        const color = getEntryEffectiveColor(entry);
        charList.push(`${entry.name}=${color}`);
    }
    const narratorColor = getNarratorVisual(settings, applyThemeReadabilityAndBrightness)?.color || null;
    if (narratorColor) charList.push(`Narrator=${narratorColor}`);
    if (!charList.length) return createBatchColorizeResult([], 'invalid-input');

    const thoughtSymbols = getThoughtDelimiterSymbols();

    // Build instruction
    const lines = [
        '[Dialogue Colors — colorize existing messages]',
        'Add <font color="#RRGGBB">...</font> tags to the dialogue and inner-thought spans in each [MSG:N] block below.',
    ];
    lines.push(...buildLLMColorizeRules('- Preserve every [MSG:N] marker and return all messages in order. Do not combine messages.'));
    lines.push('');
    lines.push(`Known speakers and colors: ${charList.join(', ')}`);
    lines.push(...buildColorMetadataPromptLines());
    if (thoughtSymbols.length) lines.push(`- ${buildThoughtSymbolColorPromptRule(thoughtSymbols)}`);
    if (narratorColor) lines.push(`- Narrator text: <font color="${narratorColor}">...</font>.`);
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
        return createBatchColorizeResult([], 'request-error', {
            error: e,
            errorClassification: classifyLlmRequestError(e),
        });
    }

    if (!response || typeof response !== 'string') return createBatchColorizeResult([], 'validation-error');
    const maxResponseCharacters = inputCharacterCount * 4 + messageBatch.length * 1024 + 4096;
    if (response.length > maxResponseCharacters) {
        console.warn('[Dialogue Colors] Rejected oversized batch colorize response.');
        return createBatchColorizeResult([], 'validation-error');
    }

    // Parse marker lines as framing only; message content is validated separately.
    const results = [];
    const cleanedResponse = unwrapLLMColorizeResponse(response);
    const markerRegex = /^\[MSG:(\d+)\][ \t]*\r?$/gm;
    const markers = [...cleanedResponse.matchAll(markerRegex)];
    if (markers.length !== messageBatch.length || cleanedResponse.slice(0, markers[0]?.index ?? 0).trim()) {
        return createBatchColorizeResult([], 'validation-error');
    }

    for (let i = 0; i < markers.length; i++) {
        const msgIdx = Number.parseInt(markers[i][1], 10);
        if (msgIdx !== i) return createBatchColorizeResult([], 'validation-error');
        const blockStart = markers[i].index + markers[i][0].length;
        const blockEnd = i + 1 < markers.length ? markers[i + 1].index : cleanedResponse.length;
        const colorizedText = cleanedResponse.slice(blockStart, blockEnd);
        const finalized = finalizeBatchColorizedBlock(messageBatch[msgIdx].rawText, colorizedText, narratorColor);
        if (!finalized) return createBatchColorizeResult([], 'validation-error');

        results.push({
            msgIndex: messageBatch[msgIdx].msgIndex,
            updatedText: finalized.updatedText,
            changed: finalized.changed,
            colorized: finalized.colorized,
        });
    }

    return createBatchColorizeResult(results, 'valid');
}

export async function recolorAllMessages() {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    const chatBinding = captureChatBinding(ctx);
    if (!chat.length) { toast.info('No messages to recolor.'); return; }
    if (isDomEngine()) {
        syncAllEffectiveColors();
        decorateAllMessages();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        toast.info('Refreshed DOM colors without editing chat text.');
        return;
    }
    if (isRecoloring) { toast.info('Recolor is already running.'); return; }
    setIsRecoloring(true);
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
        const narrator = getNarratorVisual(settings, applyThemeReadabilityAndBrightness);
        if (narrator) nameToNewColor.narrator = narrator.color;

        // Step 3: Process each colorable message
        let recoloredCount = 0;
        let ambiguousSkippedCount = 0;
        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!isColorableMessage(msg)) continue;
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
            const saved = await queueCapturedChatSave(chatBinding, { immediate: true });
            if (isCapturedChatBindingCurrent(chatBinding)) {
                if (saved) toast.info(`Recolored ${recoloredCount} message${recoloredCount !== 1 ? 's' : ''}.`);
                else toast.warning(`Recolored ${recoloredCount} message${recoloredCount !== 1 ? 's' : ''}; saving is pending.`);
            }
        } else if (ambiguousSkippedCount > 0) {
            toast.info(`No messages recolored; skipped ${ambiguousSkippedCount} ambiguous legacy color mapping${ambiguousSkippedCount !== 1 ? 's' : ''}.`);
        } else {
            toast.info('No messages needed recoloring.');
        }
    } finally {
        setIsRecoloring(false);
        setRecolorButtonBusy(false);
    }
}

function partitionColorizeEntries(entries) {
    const batches = [];
    const directFallback = [];
    let batch = [];
    let batchCharacters = 0;

    for (const entry of entries) {
        const characterCount = String(entry.rawText ?? '').length;
        if (characterCount > COLORIZE_BATCH_MAX_CHARACTERS) {
            directFallback.push(entry);
            continue;
        }
        if (batch.length && (batch.length >= COLORIZE_BATCH_MAX_MESSAGES
            || batchCharacters + characterCount > COLORIZE_BATCH_MAX_CHARACTERS)) {
            batches.push(batch);
            batch = [];
            batchCharacters = 0;
        }
        batch.push(entry);
        batchCharacters += characterCount;
    }
    if (batch.length) batches.push(batch);
    return { batches, directFallback };
}

function isColorizeRunCurrent(run) {
    return activeColorizeRun === run
        && run?.chatGeneration === attributionChatGeneration
        && isCapturedChatBindingCurrent(run?.binding);
}

function isColorizeMessageCurrent(chat, entry, expectedText = entry.rawText) {
    const message = chat?.[entry.msgIndex];
    return message === entry.message
        && message?.mes === expectedText
        && hashMessageText(message?.mes) === (expectedText === entry.rawText ? entry.messageHash : hashMessageText(expectedText))
        && message?.name === entry.speakerName
        && (message?.id ?? null) === entry.messageId
        && (message?.send_date ?? null) === entry.sendDate
        && (message?.swipe_id ?? null) === entry.swipeId
        && entry.chatGeneration === attributionChatGeneration;
}

export async function colorizeMessages(targetMode = 'all') {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    if (!chat.length) { toast.info('No messages to colorize.'); return; }
    if (isDomEngine()) {
        decorateAllMessages();
        scheduleDomSettleRefresh(DOM_RETRY_REFRESH_DELAYS);
        toast.info('Refreshed DOM colors without editing chat text.');
        return;
    }
    if (isColorizing && (!activeColorizeRun || isColorizeRunCurrent(activeColorizeRun))) {
        toast.info('Colorize is already running.');
        return;
    }
    const run = {
        id: ++colorizeRunSequence,
        binding: captureChatBinding(ctx),
        chatGeneration: attributionChatGeneration,
    };
    if (!run.binding) return;
    activeColorizeRun = run;
    setIsColorizing(true);
    setColorizeButtonBusy(true);

    try {
        syncAllEffectiveColors();
        let createdCharacters = false;

        // Pre-register all unique colorable speaker names so attribution can find them
        const allSpeakers = new Set();
        for (const msg of chat) {
            if (isColorableMessage(msg) && msg.name) allSpeakers.add(msg.name.trim());
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
        const updatedMessages = new Map();
        const eligibleEntries = [];
        const partialEntries = [];
        for (let i = startIdx; i < chat.length; i++) {
            const msg = chat[i];
            if (!isColorableMessage(msg)) continue;
            const rawText = msg.mes || '';
            if (!rawText) continue;
            const entry = {
                rawText,
                speakerName: msg.name,
                msgIndex: i,
                message: msg,
                messageHash: hashMessageText(rawText),
                messageId: msg.id ?? null,
                sendDate: msg.send_date ?? null,
                swipeId: msg.swipe_id ?? null,
                chatGeneration: run.chatGeneration,
            };
            const existingFontColors = collectFontColorsFromText(rawText);
            if (existingFontColors.size > 0) partialEntries.push(entry);
            else eligibleEntries.push(entry);
        }
        // Messages the model already touched are completed locally, segment by
        // segment — the fully-covered ones fall out as no-ops. Free, so the manual
        // button honors its "only where dialogue is uncolored" promise regardless
        // of the automation toggle.
        for (const entry of partialEntries) {
            if (!isColorizeRunCurrent(run)) return;
            if (!isColorizeMessageCurrent(chat, entry)) continue;
            const completion = fillUncoloredDialogueGaps(entry.rawText, entry.speakerName, { autoAddMessageSpeaker: true });
            if (completion.createdCharacters) createdCharacters = true;
            if (!completion.changed) continue;
            entry.message.mes = completion.updatedText;
            colorizedCount++;
            updatedMessages.set(entry.msgIndex, { message: entry.message, text: completion.updatedText });
            void queueCapturedChatSave(run.binding);
        }
        if (eligibleEntries.length > 0) {
            toast.info(`Colorizing ${eligibleEntries.length} message${eligibleEntries.length !== 1 ? 's' : ''} in batches...`, '', { timeOut: 3000 });
            const { batches, directFallback } = partitionColorizeEntries(eligibleEntries);
            const fallbackEntries = [...directFallback];
            const skipIndividualLlm = new Set(directFallback);
            const llmBudget = createColorizeRequestBudget();

            for (const batch of batches) {
                if (!isColorizeRunCurrent(run)) return;
                const resultsByIndex = new Map();
                let pendingBatch = batch;
                let deterministicValidationFailure = false;
                let permanentRequestFailure = llmBudget.stopped;

                for (let attempt = 0; attempt < COLORIZE_BATCH_MAX_ATTEMPTS && pendingBatch.length; attempt++) {
                    if (!reserveColorizeRequest(llmBudget, { retry: attempt > 0 })) break;
                    let batchResults = [];
                    let thrownRequestFailure = null;
                    try {
                        batchResults = await colorizeMultipleMessagesWithLLM(pendingBatch);
                    } catch (error) {
                        console.warn('[Dialogue Colors] Batch colorize failed:', error);
                        thrownRequestFailure = recordColorizeRequestFailure(llmBudget, error);
                    }
                    if (!isColorizeRunCurrent(run)) return;
                    if (thrownRequestFailure) {
                        if (!thrownRequestFailure.retryable) {
                            permanentRequestFailure = true;
                            break;
                        }
                        continue;
                    }

                    if (batchResults?.status === 'validation-error' || batchResults?.status === 'invalid-input') {
                        deterministicValidationFailure = true;
                        llmBudget.stopped = true;
                        break;
                    }
                    if (batchResults?.status === 'request-error') {
                        const classification = recordColorizeRequestFailure(
                            llmBudget,
                            batchResults.errorClassification || batchResults.error,
                        );
                        if (!classification.retryable) {
                            permanentRequestFailure = true;
                            break;
                        }
                        continue;
                    }
                    if (batchResults?.status !== 'valid') {
                        deterministicValidationFailure = true;
                        llmBudget.stopped = true;
                        break;
                    }

                    const pendingIndices = new Set(pendingBatch.map(entry => entry.msgIndex));
                    for (const result of batchResults) {
                        if (typeof result?.changed === 'boolean'
                            && typeof result.updatedText === 'string'
                            && pendingIndices.has(result.msgIndex)
                            && !resultsByIndex.has(result.msgIndex)) {
                            resultsByIndex.set(result.msgIndex, result);
                        }
                    }
                    pendingBatch = pendingBatch.filter(entry => !resultsByIndex.has(entry.msgIndex)
                        && isColorizeMessageCurrent(chat, entry));
                }

                for (const entry of batch) {
                    const result = completeLLMResultGaps(resultsByIndex.get(entry.msgIndex), entry.speakerName);
                    if (!result) {
                        fallbackEntries.push(entry);
                        if (deterministicValidationFailure || permanentRequestFailure || llmBudget.stopped) {
                            skipIndividualLlm.add(entry);
                        }
                        continue;
                    }
                    if (result.colorized !== true) {
                        // A byte-identical no-font response is valid syntax but
                        // did not complete colorization. Use local attribution
                        // directly; another paid request cannot improve certainty.
                        fallbackEntries.push(entry);
                        skipIndividualLlm.add(entry);
                        continue;
                    }
                    if (result.createdCharacters) createdCharacters = true;
                    if (!result.changed) continue;
                    if (!isColorizeRunCurrent(run)) return;
                    const target = chat[entry.msgIndex];
                    if (!isColorizeMessageCurrent(chat, entry)) continue;
                    target.mes = result.updatedText;
                    colorizedCount++;
                    updatedMessages.set(entry.msgIndex, { message: target, text: result.updatedText });
                    void queueCapturedChatSave(run.binding);
                }
            }

            let individualLLMFallbacks = 0;
            for (const entry of fallbackEntries) {
                if (!isColorizeRunCurrent(run)) return;
                if (!isColorizeMessageCurrent(chat, entry)) continue;

                let llmResult = null;
                let attemptedIndividualLlm = false;
                if (entry.rawText.length <= COLORIZE_BATCH_MAX_CHARACTERS
                    && individualLLMFallbacks < COLORIZE_MAX_INDIVIDUAL_LLM_FALLBACKS
                    && !skipIndividualLlm.has(entry)
                    && reserveColorizeRequest(llmBudget)) {
                    attemptedIndividualLlm = true;
                    individualLLMFallbacks++;
                    try {
                        llmResult = await colorizeMessageWithLLM(entry.rawText, entry.speakerName);
                    } catch (error) {
                        console.warn('[Dialogue Colors] Individual LLM colorize failed:', error);
                        recordColorizeRequestFailure(llmBudget, error);
                    }
                    if (!isColorizeRunCurrent(run)) return;
                    if (!isColorizeMessageCurrent(chat, entry)) continue;
                }
                if (attemptedIndividualLlm && llmResult === null) llmBudget.stopped = true;

                let result = completeLLMResultGaps(llmResult, entry.speakerName);
                if (shouldUseLocalColorizeFallback(llmResult)) {
                    if (!isColorizeRunCurrent(run)
                        || !isColorizeMessageCurrent(chat, entry)) continue;
                    result = colorizeMessageText(entry.rawText, entry.speakerName, { autoAddMessageSpeaker: true });
                }
                if (result.createdCharacters) createdCharacters = true;

                if (!result.changed) {
                    if (result.hadDialogueMatches && !result.hadResolvableSpeaker) skippedNoColor++;
                    continue;
                }
                if (!isColorizeRunCurrent(run)
                    || !isColorizeMessageCurrent(chat, entry)) continue;

                entry.message.mes = result.updatedText;
                colorizedCount++;
                updatedMessages.set(entry.msgIndex, { message: entry.message, text: result.updatedText });
                void queueCapturedChatSave(run.binding);
            }
        }

        if (!isColorizeRunCurrent(run)) return;
        if (createdCharacters) commit();

        // Persist and refresh only the affected message DOM nodes.
        if (colorizedCount > 0) {
            const saved = await queueCapturedChatSave(run.binding, { immediate: true });
            if (!isColorizeRunCurrent(run)) return;
            for (const [index, updated] of updatedMessages) {
                if (!isColorizeRunCurrent(run)) return;
                if (chat[index] !== updated.message || updated.message.mes !== updated.text) continue;
                await refreshMessageDom(index, updated.message);
            }
            if (!isColorizeRunCurrent(run)) return;
            refreshTransientNarratorCount(chat);
            scheduleCustomFontRefresh(0);
            updateLegend();
            const suffix = skippedNoColor > 0 ? ` (${skippedNoColor} skipped - no speaker/color match)` : '';
            if (saved) toast.info(`Colorized ${colorizedCount} message${colorizedCount !== 1 ? 's' : ''}${suffix}.`);
            else toast.warning(`Colorized ${colorizedCount} message${colorizedCount !== 1 ? 's' : ''}${suffix}; saving is pending.`);
        } else if (skippedNoColor > 0) {
            toast.info(`No uncolored dialogue found; ${skippedNoColor} message${skippedNoColor !== 1 ? 's' : ''} skipped (no known speaker/color could be resolved).`);
        } else {
            toast.info('No uncolored messages found.');
        }
    } finally {
        if (activeColorizeRun === run) {
            activeColorizeRun = null;
            setIsColorizing(false);
            setColorizeButtonBusy(false);
        }
    }
}

export function onNewMessage() {
    if (!settings.enabled || !settings.autoScanNewMessages) return;
    const scheduledContext = getContext();
    const scheduledChat = scheduledContext?.chat;
    const scheduledStorageKey = getStorageKey();
    const scheduledChatGeneration = attributionChatGeneration;
    setTimeout(async () => {
        const ctx = getContext();
        if (!settings.enabled || !settings.autoScanNewMessages
            || ctx?.chat !== scheduledChat || getStorageKey() !== scheduledStorageKey
            || scheduledChatGeneration !== attributionChatGeneration) return;
        const chat = ctx?.chat || [];
        if (!chat.length) return;
        const chatBinding = captureChatBinding(ctx);
        const lastMsg = chat[chat.length - 1];
        const text = lastMsg?.mes || '';
        const sigId = lastMsg?.id ?? lastMsg?.send_date ?? '';
        const signature = `${chat.length}|${sigId}|${text}`;
        if (signature === lastProcessedMessageSignature) {
            stripColorBlockFromElement(document.querySelector('.mes:last-child .mes_text'));
            scheduleDomRefreshSeries();
            return;
        }
        if (settings.autoColorize && isColorableMessage(lastMsg) && isAutoColorizing && !/\[COLORS?:[^\]]*\]/i.test(text)) {
            pendingAutoColorizeRetry = true;
            setLastProcessedMessageSignature('');
            return;
        }
        setLastProcessedMessageSignature(signature);
        const colorStats = processColorBlocksInText(text);
        countFontColorStatsFromKnownColors(text, colorStats.countedKeys);
        refreshTransientNarratorCount(chat);
        const foundColorBlock = colorStats.foundColorBlock;
        const hadRemapping = colorStats.hadRemapping;
        const remappedAssignments = colorStats.remappedAssignments;
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
                    setLastProcessedMessageSignature(`${chat.length}|${sigId}|${lastMsg.mes}`);
                    latestRemapChanged = true;
                    void queueCapturedChatSave(chatBinding);
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
        if (latestRemapChanged) {
            await queueCapturedChatSave(chatBinding, { immediate: true });
        }

        // The model colored some dialogue but not all of it: finish the message
        // locally. Mutually exclusive with the auto-colorize fallback below, which
        // only ever runs on messages carrying no font colors at all.
        if (settings.completePartialColorize && !isAutoColorizing && isColorableMessage(lastMsg)) {
            const completionInput = lastMsg.mes || text;
            if (collectFontColorsFromText(completionInput).size > 0) {
                const completionEntry = {
                    rawText: completionInput,
                    speakerName: lastMsg.name,
                    message: lastMsg,
                    msgIndex: chat.length - 1,
                    messageHash: hashMessageText(completionInput),
                    messageId: lastMsg.id ?? null,
                    sendDate: lastMsg.send_date ?? null,
                    swipeId: lastMsg.swipe_id ?? null,
                    chatGeneration: attributionChatGeneration,
                };
                const completion = fillUncoloredDialogueGaps(completionInput, lastMsg.name, { autoAddMessageSpeaker: true });
                if (completion.createdCharacters) commit();
                if (completion.changed
                    && isCapturedChatBindingCurrent(chatBinding)
                    && isColorizeMessageCurrent(chat, completionEntry)) {
                    lastMsg.mes = completion.updatedText;
                    setLastProcessedMessageSignature(`${chat.length}|${sigId}|${lastMsg.mes}`);
                    await queueCapturedChatSave(chatBinding, { immediate: true });
                    if (isCapturedChatBindingCurrent(chatBinding)
                        && isColorizeMessageCurrent(chat, completionEntry, completion.updatedText)) {
                        await refreshMessageDom(chat.length - 1, lastMsg);
                    }
                    updateCharList();
                }
            }
        }

        // Auto-colorize fallback: if model produced no color output at all
        if (!foundColorBlock && settings.autoColorize && isColorableMessage(lastMsg) && isAutoColorizing) {
            pendingAutoColorizeRetry = true;
            setLastProcessedMessageSignature('');
            return;
        }
        if (!foundColorBlock && settings.autoColorize && isColorableMessage(lastMsg)) {
            const hasExistingColors = collectFontColorsFromText(text).size > 0;
            if (!hasExistingColors) {
                setIsAutoColorizing(true);
                const lastMesEl = document.querySelector('.mes:last-child');
                clearAutoColorizeIndicators();
                showAutoColorizeIndicator(lastMesEl);
                // Capture identity + current text so we can revalidate after the LLM await
                // (the user may swipe/edit/regenerate, or a new message may arrive, mid-call).
                const mesIndex = chat.length - 1;
                const capturedChat = chat;
                const colorizeInput = lastMsg.mes || text;
                const autoColorizeBinding = chatBinding;
                const autoColorizeEntry = {
                    rawText: colorizeInput,
                    speakerName: lastMsg.name,
                    msgIndex: mesIndex,
                    message: lastMsg,
                    messageHash: hashMessageText(colorizeInput),
                    messageId: lastMsg.id ?? null,
                    sendDate: lastMsg.send_date ?? null,
                    swipeId: lastMsg.swipe_id ?? null,
                    chatGeneration: attributionChatGeneration,
                };
                try {
                    syncAllEffectiveColors();
                    // Pre-register all unique colorable speaker names for attribution
                    for (const msg of chat) {
                        if (isColorableMessage(msg) && msg.name) {
                            const speakerName = msg.name.trim();
                            if (speakerName && !isCompositeSpeakerLabel(speakerName)) {
                                ensureCharacterEntry(speakerName);
                            }
                        }
                    }
                    // Try LLM path first, fall back to regex
                    let result = null;
                    try {
                        result = await colorizeMessageWithLLM(colorizeInput, lastMsg.name);
                    } catch (e) {
                        console.warn('[Dialogue Colors] LLM auto-colorize failed, falling back to regex:', e);
                    }
                    if (settings.completePartialColorize) result = completeLLMResultGaps(result, lastMsg.name);
                    if (shouldUseLocalColorizeFallback(result)) {
                        const currentContext = getContext();
                        if (!isCapturedChatBindingCurrent(autoColorizeBinding, currentContext)
                            || !isColorizeMessageCurrent(capturedChat, autoColorizeEntry)) return;
                        result = colorizeMessageText(colorizeInput, lastMsg.name, { autoAddMessageSpeaker: true });
                    }
                    if (result.createdCharacters) {
                        commit();
                    }
                    if (result.changed) {
                        // Revalidate: bail out rather than clobber a swiped/edited message
                        // or render into a DOM node that now belongs to a different message.
                        const ctx2 = getContext();
                        if (!isCapturedChatBindingCurrent(autoColorizeBinding, ctx2)
                            || !isColorizeMessageCurrent(capturedChat, autoColorizeEntry)) {
                            return;
                        }
                        lastMsg.mes = result.updatedText;
                        setLastProcessedMessageSignature(`${capturedChat.length}|${sigId}|${lastMsg.mes}`);
                        const saved = await queueCapturedChatSave(autoColorizeBinding, { immediate: true });
                        if (!isCapturedChatBindingCurrent(autoColorizeBinding)
                            || !isColorizeMessageCurrent(capturedChat, autoColorizeEntry, result.updatedText)) return;
                        await refreshMessageDom(mesIndex, lastMsg);
                        if (saved) toast.info('Auto-colorized latest message.');
                        else toast.warning('Auto-colorized latest message; saving is pending.');
                    }
                } finally {
                    setIsAutoColorizing(false);
                    hideAutoColorizeIndicator(lastMesEl);
                    clearAutoColorizeIndicators();
                    if (pendingAutoColorizeRetry) {
                        pendingAutoColorizeRetry = false;
                        onNewMessage();
                    }
                }
            }
        }
    }, 600);
}
