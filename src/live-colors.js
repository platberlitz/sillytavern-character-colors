// live-colors.js - extracted from index.js (mechanical split)
import { colorizeMessageText, ensureCharacterEntry } from './attribution.js';
import { collectFontColorsFromText, countFontColorStatsFromKnownColors, parseColorAssignmentsFromText, processColorBlocksInText, stripColorBlockFromElement } from './color-blocks.js';
import { DOM_RETRY_REFRESH_DELAYS, decorateAllMessages, refreshMessageDom, scheduleDomRefreshSeries, scheduleDomSettleRefresh } from './dom-engine.js';
import { scheduleCustomFontRefresh } from './fonts.js';
import { saveHistory } from './history.js';
import { callLLMWithProfile } from './llm.js';
import { applyThemeReadabilityAndBrightness, getBaseColor, getEntryEffectiveColor, syncAllEffectiveColors } from './palettes.js';
import { buildColorMetadataPromptLines, buildLLMColorizeRules, buildThoughtSymbolColorPromptRule, formatColorBlockPair, getThoughtDelimiterSymbols, injectPrompt } from './prompts.js';
import { generateQuietPrompt, getContext } from './st-api.js';
import { COLOR_STATE_SAVE_DELAY_MS, LIVE_CHAT_SAVE_DELAY_MS, characterColors, colorStateSaveTimer, isAutoColorizing, isColorizing, isDomEngine, isRecoloring, lastProcessedMessageSignature, liveChatSaveTimer, pendingColorStateHistory, pendingColorStateInjectPrompt, pendingColorStateSaveData, pendingColorStateUpdateList, pendingLiveChatSave, setColorStateSaveTimer, setIsAutoColorizing, setIsColorizing, setIsRecoloring, setLastProcessedMessageSignature, setLiveChatSaveTimer, setPendingColorStateHistory, setPendingColorStateInjectPrompt, setPendingColorStateSaveData, setPendingColorStateUpdateList, setPendingLiveChatSave, settings } from './state.js';
import { saveData } from './storage.js';
import { clearAutoColorizeIndicators, hideAutoColorizeIndicator, setColorizeButtonBusy, setRecolorButtonBusy, showAutoColorizeIndicator, updateCharList, updateLegend } from './ui.js';
import { isCompositeSpeakerLabel, normalizeHexColor, stripColorBlocks, stripFontTags, toast, unwrapCodeFence } from './utils.js';

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
    setPendingLiveChatSave(true);
    if (liveChatSaveTimer) clearTimeout(liveChatSaveTimer);
    setLiveChatSaveTimer(setTimeout(() => {
        setLiveChatSaveTimer(null);
        if (!pendingLiveChatSave) return;
        setPendingLiveChatSave(false);
        const ctx = getContext();
        if (typeof ctx?.saveChat === 'function') {
            ctx.saveChat().catch(err => console.error('[Dialogue Colors] Failed to save chat:', err));
        }
    }, LIVE_CHAT_SAVE_DELAY_MS));
}

export function flushChatSave() {
    if (liveChatSaveTimer) {
        clearTimeout(liveChatSaveTimer);
        setLiveChatSaveTimer(null);
    }
    if (!pendingLiveChatSave) return;
    setPendingLiveChatSave(false);
    const ctx = getContext();
    if (typeof ctx?.saveChat === 'function') {
        ctx.saveChat().catch(err => console.error('[Dialogue Colors] Failed to save chat:', err));
    }
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
        setPendingLiveChatSave(true);
        if (options.saveImmediately) flushChatSave();
        else queueChatSave();
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
    if (settings.narratorColor) {
        nameToNewColor.Narrator = applyThemeReadabilityAndBrightness(settings.narratorColor);
    }
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
    if (!settings.autoRecolor && !options.force) return 0;
    const list = Array.isArray(keys) ? keys : [keys];
    const changedCount = applyLiveColorReplacements(buildColorReplacementsFromSnapshot(snapshot, list), {
        nameToNewColor: buildNameToCurrentColorForKeys(list),
        saveImmediately: options.saveImmediately,
    });
    scheduleCustomFontRefresh(options.saveImmediately ? 0 : 120);
    return changedCount;
}

export function repaintDomAfterCharacterDataChange(delay = 0) {
    if (isDomEngine()) scheduleDomRefreshSeries(delay);
    scheduleCustomFontRefresh(delay);
}

export function queueColorStateSave(options = {}) {
    setPendingColorStateSaveData(true);
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
    if (shouldSaveData) saveData();
    if (shouldInjectPrompt) injectPrompt();
    if (shouldUpdateList) updateCharList();
    updateLegend();
}

// Synchronous commit of a character/color mutation. Replaces the repeated
// `commit();` quartet.
// Pass `false` for any step to opt out (e.g. commit({ history: false })).
export function commit(options = {}) {
    if (options.history !== false) saveHistory();
    if (options.data !== false) saveData();
    if (options.inject !== false) injectPrompt();
    if (options.updateList !== false) updateCharList();
    if (options.legend !== false) updateLegend();
}

export function normalizeColorizedTextForComparison(text) {
    return stripColorBlocks(stripFontTags(String(text ?? '').replace(/\r\n?/g, '\n'))).trim();
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

export function finalizeLLMColorizedText(rawText, responseText, narratorColor = null) {
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

export async function colorizeMessageWithLLM(rawText, messageSpeakerName = '') {
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
    const narratorColor = settings.narratorColor ? applyThemeReadabilityAndBrightness(settings.narratorColor) : null;

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
        return null;
    }

    return finalizeLLMColorizedText(rawText, response, narratorColor);
}

export async function colorizeMultipleMessagesWithLLM(messageBatch) {
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
    const narratorColor = settings.narratorColor ?
        applyThemeReadabilityAndBrightness(settings.narratorColor) : null;

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

export async function recolorAllMessages() {
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
        setIsRecoloring(false);
        setRecolorButtonBusy(false);
    }
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
    if (isColorizing) { toast.info('Colorize is already running.'); return; }
    setIsColorizing(true);
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
        setIsColorizing(false);
        setColorizeButtonBusy(false);
    }
}

export function onNewMessage() {
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
        setLastProcessedMessageSignature(signature);
        const colorStats = processColorBlocksInText(text);
        countFontColorStatsFromKnownColors(text, colorStats.countedKeys);
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
                setIsAutoColorizing(true);
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
                        setLastProcessedMessageSignature(`${chat.length}|${sigId}|${lastMsg.mes}`);

                        const ctx2 = getContext();
                        if (typeof ctx2?.saveChat === 'function') {
                            await ctx2.saveChat();
                        }

                        await refreshMessageDom(chat.length - 1, lastMsg);
                        toast.info('Auto-colorized latest message.');
                    }
                } finally {
                    setIsAutoColorizing(false);
                    hideAutoColorizeIndicator(lastMesEl);
                    clearAutoColorizeIndicators();
                }
            }
        }
    }, 600);
}
