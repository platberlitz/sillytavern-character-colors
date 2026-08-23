import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/live-colors.js', import.meta.url), 'utf8');
let moduleSequence = 0;

// updateVisibleMessageColors is module-internal, so it cannot be stubbed through the import
// rewrite below. It only repaints already-rendered font tags; finding nothing is the right
// answer here, where the assertions are about the chat array rather than the DOM.
globalThis.document ??= {
    querySelector: () => null,
    querySelectorAll: () => [],
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
        await delay(2);
    }
}

async function loadLiveColorsModule(overrides = {}) {
    const importPattern = /^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];\s*$/gm;
    const names = new Set();
    for (const match of source.matchAll(importPattern)) {
        for (const rawName of match[1].split(',')) names.add(rawName.trim());
    }
    const key = `__dcAsyncLiveColorStubs_${++moduleSequence}`;
    globalThis[key] = {
        LIVE_CHAT_SAVE_DELAY_MS: 15,
        COLOR_STATE_SAVE_DELAY_MS: 15,
        CHAT_SAVE_OPERATION_TIMEOUT_MS: 50,
        liveChatSaveTimer: null,
        colorStateSaveTimer: null,
        characterColors: {},
        settings: { enabled: true, coloringEngine: 'llm' },
        attributionChatGeneration: 0,
        setLiveChatSaveTimer() {},
        setPendingLiveChatSave() {},
        normalizeHexColor(value, fallback = null) {
            const color = String(value ?? '').toLowerCase();
            return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
        },
        normalizeRegistryIdentityName(value) {
            const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
            return name && !/[<>{}]/.test(name) ? name : '';
        },
        formatColorBlockPair(name, color) {
            const safeName = typeof name === 'string' && !/[\[\]=,()<>{}]/.test(name) ? name.trim() : '';
            const safeColor = /^#[0-9a-f]{6}$/i.test(String(color ?? '')) ? String(color).toLowerCase() : '';
            return safeName && safeColor ? `${safeName}=${safeColor}` : '';
        },
        parseTrailingColorMetadata(text) {
            const source = String(text ?? '');
            const match = /(^|\r\n?|\n)([ \t]*)\[(COLORS?):([^\]\r\n]*)\][ \t]*((?:\r\n?|\n)?[ \t]*)$/i.exec(source);
            if (!match) return null;
            const start = match.index + match[1].length + match[2].length;
            const pairsStart = start + source.slice(start).indexOf(':') + 1;
            return { source, label: match[3].toUpperCase(), pairs: match[4], pairsStart, pairsEnd: pairsStart + match[4].length, removeStart: match.index };
        },
        parseColorMetadataPairs(text) {
            return String(text ?? '').split(',').flatMap(pair => {
                const match = pair.match(/^([^=\[\]()<>{}]+)=((?:#[0-9a-f]{6}))$/i);
                return match ? [{ name: match[1].trim(), aliases: [], color: match[2].toLowerCase() }] : [];
            });
        },
        stripTrailingColorMetadata(text) {
            const source = String(text ?? '');
            const match = /(^|\r\n?|\n)[ \t]*\[COLORS?:[^\]\r\n]*\][ \t]*(?:(?:\r\n?|\n)?[ \t]*)$/i.exec(source);
            return match ? source.slice(0, match.index) : source;
        },
        getEntryEffectiveColor: entry => entry?.color,
        filterPromptCharacterEntries: entries => entries,
        classifyLlmRequestError: error => ({ category: 'unknown', retryable: false, status: error?.status ?? null }),
        // Mirrors the real predicate rather than stubbing it out, so the write paths under test
        // skip tool-call messages here exactly as they do in the host.
        isToolCallMessage: msg => Array.isArray(msg?.extra?.tool_invocations),
        // Mirrored from utils.js for the same reason: these two decide whether a color span
        // would be spliced into an element's markup, and a stub that always says "safe" would
        // hide exactly the breakage the LLM finalizer is supposed to drop.
        findHtmlTagRanges(text) {
            const ranges = [];
            const tagRegex = /<[^>]+>/g;
            let match;
            while ((match = tagRegex.exec(String(text ?? ''))) !== null) {
                ranges.push({ start: match.index, end: match.index + match[0].length });
            }
            return ranges;
        },
        splitsHtmlTag: (start, end, ranges) => (ranges || []).some(range => (start > range.start && start < range.end)
            || (end > range.start && end < range.end)),
        // Same reason again: these three decide where a color span is allowed to end, and a
        // stub that never finds dialogue would hide the re-scoping the finalizer is meant to do.
        DIALOGUE_SKIP_GROUP: 'dcSkip',
        buildDialogueRegex: () => /(?<dcSkip>```[\s\S]*?```)|("[^"\n\r]*")/g,
        maskHtmlTagQuotes: text => String(text ?? '').replace(/<[^>]+>/g, tag => tag.replace(/["']/g, '\u0000')),
        ...overrides,
    };
    const importedNames = [...names].join(', ');
    const transformed = `const { ${importedNames} } = globalThis[${JSON.stringify(key)}];\n${source.replace(importPattern, '')}`;
    try {
        return await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#${moduleSequence}`);
    } finally {
        delete globalThis[key];
    }
}

function chatContext(chatId, chat, saveChat = async () => true) {
    return {
        chatId,
        chat,
        characterId: 0,
        groupId: null,
        characters: [{ avatar: 'owner.png' }],
        saveChat,
    };
}

function bulkColorizeStubs(chat, callLLMWithProfile, onLocalFallback = () => {}) {
    const entry = { name: 'Alice', color: '#123456', aliases: [] };
    return {
        getContext: () => chatContext('chat-a', chat),
        settings: { enabled: true, coloringEngine: 'llm' },
        characterColors: { alice: entry },
        generateQuietPrompt() {},
        callLLMWithProfile,
        classifyLlmRequestError(error) {
            const status = error?.status ?? null;
            return status === 401
                ? { category: 'authentication', retryable: false, status }
                : { category: 'unknown', retryable: false, status };
        },
        isDomEngine: () => false,
        setIsColorizing() {},
        setColorizeButtonBusy() {},
        syncAllEffectiveColors() {},
        collectFontColorsFromText: () => new Set(),
        ensureCharacterEntry: () => ({ created: false, entry }),
        isCompositeSpeakerLabel: () => false,
        getEntryEffectiveColor: value => value.color,
        getNarratorVisual: () => null,
        getThoughtDelimiterSymbols: () => [],
        attributeDialogueSegments: () => ({ segments: [], createdCharacters: false }),
        buildLLMColorizeRules: () => [],
        formatColorBlockPair: (name, color) => `${name}=${color}`,
        hashMessageText: value => String(value),
        colorizeMessageText(rawText) {
            onLocalFallback(rawText);
            return {
                updatedText: rawText,
                changed: false,
                createdCharacters: false,
                hadDialogueMatches: false,
                hadResolvableSpeaker: false,
            };
        },
        toast: { info() {}, warning() {} },
    };
}

test('durable chat bindings survive host array replacement without matching another chat', async () => {
    let context = chatContext('chat-a', []);
    const live = await loadLiveColorsModule({ getContext: () => context });
    const first = live.captureChatBinding(context);
    const replacement = live.captureChatBinding(chatContext('chat-a', []));
    const other = live.captureChatBinding(chatContext('chat-b', []));

    assert.notEqual(first.chat, replacement.chat);
    assert.equal(live.areChatBindingsEqual(first, replacement), true);
    assert.equal(live.areChatBindingsEqual(first, other), false);

    context = { chat: [] };
    const transientFirst = live.captureChatBinding(context);
    const transientOther = live.captureChatBinding({ chat: [] });
    assert.equal(live.areChatBindingsEqual(transientFirst, transientOther), false);
});

test('queued chat saves dispatch immediately before a chat switch', async () => {
    let savedA = 0;
    let savedB = 0;
    let context = chatContext('chat-a', [{ mes: 'changed' }], async () => { savedA++; return true; });
    const live = await loadLiveColorsModule({ getContext: () => context });

    live.queueChatSave();
    await waitFor(() => savedA === 1);
    context = chatContext('chat-b', [], async () => { savedB++; return true; });
    assert.equal(live.resumePendingChatSave(context), false);
    await delay(30);
    assert.equal(savedA, 1);
    assert.equal(savedB, 0);
});

test('a save waiting behind the global gate resumes only for its durable chat', async () => {
    let releaseBlocker;
    const blocker = new Promise(resolve => { releaseBlocker = resolve; });
    let savedA = 0;
    let savedB = 0;
    let context = chatContext('chat-blocker', [{ mes: 'blocker' }], () => blocker);
    const live = await loadLiveColorsModule({ getContext: () => context });

    live.queueChatSave();
    context = chatContext('chat-a', [{ mes: 'changed' }], async () => { savedA++; return true; });
    live.queueChatSave();
    context = chatContext('chat-b', [], async () => { savedB++; return true; });
    releaseBlocker(true);
    await delay(20);
    assert.equal(savedA, 0);
    assert.equal(savedB, 0);

    context = chatContext('chat-a', [{ mes: 'changed' }], async () => { savedA++; return true; });
    assert.equal(live.resumePendingChatSave(context), true);
    await waitFor(() => savedA === 1);
    assert.equal(savedB, 0);
});

test('a fulfilled void host save is accepted and never warned as failed', async () => {
    let saves = 0;
    let pending = null;
    const chat = [{ mes: 'changed' }];
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', chat, async () => { saves++; }),
        setPendingLiveChatSave: value => { pending = value; },
    });

    live.queueChatSave();
    assert.equal(await live.flushChatSave(), true);
    assert.equal(saves, 1);
    assert.equal(pending, false, 'an accepted unconfirmed save must not remain queued forever');
    assert.equal(await live.flushChatSave(), true);
    await delay(30);
    assert.equal(saves, 1, 'void settlement must not trigger an endless confirmation retry');
});

test('a host save that resolves no usable verdict is treated as confirmed for toasts', async () => {
    let saves = 0;
    const chat = [{ mes: 'changed' }];
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', chat, () => { saves++; }),
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        live.queueChatSave();
        assert.equal(await live.flushChatSave(), true, 'an uncertain save must not warn the user');
    } finally {
        console.warn = originalWarn;
    }
    assert.ok(saves >= 1, 'the uncertain save is retried by the background queue');
});

test('a hard host rejection still surfaces as an unconfirmed save', async () => {
    let saves = 0;
    const chat = [{ mes: 'changed' }];
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', chat, () => { saves++; return false; }),
    });
    const originalError = console.error;
    console.error = () => {};
    try {
        live.queueChatSave();
        assert.equal(await live.flushChatSave(), false);
    } finally {
        console.error = originalError;
    }
    assert.ok(saves >= 1);
});

test('unchanged no-font LLM output is valid but not completed colorization', async () => {
    const live = await loadLiveColorsModule({ getContext: () => ({ chat: [] }) });
    const dialogue = 'Alice said, "Hello."';
    const unchanged = live.finalizeLLMColorizedText(dialogue, dialogue);

    assert.deepEqual(unchanged, {
        updatedText: dialogue,
        changed: false,
        colorized: false,
        usedAssignments: [],
    });
    assert.equal(live.shouldUseLocalColorizeFallback(unchanged), true);

    const colored = live.finalizeLLMColorizedText('"Hello."', '<font color="#123456">"Hello."</font>');
    assert.equal(colored.colorized, true);
    assert.equal(live.shouldUseLocalColorizeFallback(colored), false);

    const noDialogue = live.finalizeLLMColorizedText('No dialogue here.', 'No dialogue here.');
    assert.equal(noDialogue.colorized, false);
    assert.equal(noDialogue.changed, false);
});

test('bulk colorization stops the run after one permanent provider failure', async () => {
    const chat = Array.from({ length: 8 }, (_, index) => ({ name: 'Alice', mes: `"Line ${index}"` }));
    let requests = 0;
    let localFallbacks = 0;
    const live = await loadLiveColorsModule(bulkColorizeStubs(
        chat,
        async () => {
            requests++;
            const error = new Error('HTTP 401 Unauthorized');
            error.status = 401;
            throw error;
        },
        () => { localFallbacks++; },
    ));

    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await live.colorizeMessages('all');
    } finally {
        console.warn = originalWarn;
    }
    assert.equal(requests, 1);
    assert.equal(localFallbacks, chat.length);
});

test('bulk unchanged LLM output uses local fallback without a second request', async () => {
    const chat = [{ name: 'Alice', mes: '"Hello."' }];
    let requests = 0;
    let localFallbacks = 0;
    const live = await loadLiveColorsModule(bulkColorizeStubs(
        chat,
        async () => {
            requests++;
            return '[MSG:0]\n"Hello."';
        },
        () => { localFallbacks++; },
    ));

    await live.colorizeMessages('all');
    assert.equal(requests, 1);
    assert.equal(localFallbacks, 1);
});

test('LLM colorization skips tracked persona user messages without changing text or calling the provider', async () => {
    const message = { name: 'Alice', is_user: true, mes: 'Alice says "Hello."' };
    let requests = 0;
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', [message]),
        characterColors: { alice: { name: 'Alice', color: '#123456', aliases: [] } },
        isDomEngine: () => false,
        setIsColorizing() {},
        setColorizeButtonBusy() {},
        syncAllEffectiveColors() {},
        callLLMWithProfile: async () => { requests++; return ''; },
    });

    const original = message.mes;
    await live.colorizeMessages('all');
    assert.equal(requests, 0);
    assert.equal(message.mes, original);
});

test('individual and batch LLM colorization use one filtered speaker table', async () => {
    const requests = [];
    const stubs = bulkColorizeStubs([], async instruction => {
        requests.push(instruction);
        return instruction.includes('[MSG:0]')
            ? '[MSG:0]\n<font color="#123456">"Hello."</font>'
            : '<font color="#123456">"Hello."</font>';
    });
    Object.assign(stubs, {
        generateQuietPrompt() {},
        characterColors: {
            dawn: { name: 'Dawn', color: '#123456', aliases: [] },
            kris: { name: 'Kris', color: '#654321', aliases: ['Old'] },
        },
        filterPromptCharacterEntries: entries => entries
            .filter(entry => entry.name !== 'Kris')
            .map(entry => entry.name === 'Dawn' ? { ...entry, aliases: [] } : entry),
    });
    const live = await loadLiveColorsModule(stubs);

    await live.colorizeMessageWithLLM('"Hello."', 'Dawn');
    await live.colorizeMultipleMessagesWithLLM([{ rawText: '"Hello."', speakerName: 'Dawn', msgIndex: 0 }]);

    assert.equal(requests.length, 2);
    for (const request of requests) {
        assert.match(request, /Known speakers and colors: Dawn=#123456/);
        assert.equal((request.match(/Known speakers and colors:/g) || []).length, 1);
        assert.equal((request.match(/Known colors:/g) || []).length, 0);
        assert.doesNotMatch(request, /Kris|Old/);
    }
});

test('bulk colorization rechecks tool eligibility after the provider await', async () => {
    const request = deferred();
    const chat = [{ name: 'Alice', is_user: false, extra: {}, mes: '"Hello."' }];
    let started = false;
    const live = await loadLiveColorsModule(bulkColorizeStubs(chat, () => {
        started = true;
        return request.promise;
    }));

    const run = live.colorizeMessages('all');
    await waitFor(() => started);
    chat[0].extra.tool_invocations = [];
    request.resolve('[MSG:0]\n<font color="#123456">"Hello."</font>');
    await run;

    assert.equal(chat[0].mes, '"Hello."');
});

test('effective narrator changes invalidate an in-flight colorize run without registry entries', async () => {
    const request = deferred();
    const settings = {
        enabled: true,
        coloringEngine: 'llm',
        highlightMode: false,
        narratorStyle: { enabled: true, baseColor: '#111111', gradient: null },
    };
    const chat = [{ name: 'Narrator', is_user: false, extra: {}, mes: 'Narration' }];
    let started = false;
    const stubs = bulkColorizeStubs(chat, () => {
        started = true;
        return request.promise;
    });
    Object.assign(stubs, {
        settings,
        characterColors: {},
        ensureCharacterEntry: () => ({ created: false, entry: null }),
        getNarratorVisual: sourceSettings => ({
            name: 'Narrator',
            color: sourceSettings.highlightMode ? '#222222' : '#111111',
            gradient: null,
        }),
    });
    const live = await loadLiveColorsModule(stubs);

    const run = live.colorizeMessages('all');
    await waitFor(() => started);
    settings.highlightMode = true;
    request.resolve('[MSG:0]\n<font color="#111111">Narration</font>');
    await run;

    assert.equal(chat[0].mes, 'Narration');
});

function toolCallMessage(mes) {
    return { name: 'SillyTavern System', is_system: true, is_user: false, mes, extra: { tool_invocations: [{ name: 'DiceRoll' }] } };
}

test('a color remap skips tool-call messages but still rewrites ordinary ones', async () => {
    const toolText = '<details><summary>Tool calls: DiceRoll</summary><font color="#aaaaaa">"result"</font></details>';
    const chat = [
        { name: 'Alice', is_user: false, extra: {}, mes: '<font color="#aaaaaa">"Hello."</font>' },
        toolCallMessage(toolText),
    ];
    let saves = 0;
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', chat, async () => { saves++; return true; }),
        characterColors: {},
        updateVisibleMessageColors() {},
    });

    assert.equal(live.applyLiveColorReplacements({ '#aaaaaa': '#bbbbbb' }), 1);
    assert.equal(chat[0].mes, '<font color="#bbbbbb">"Hello."</font>');
    assert.equal(chat[1].mes, toolText, 'the tool-call payload must be byte-identical');
    await waitFor(() => saves === 1);
});

test('a chat of only tool-call messages is never saved', async () => {
    const toolText = '<details><summary>Tool calls: DiceRoll</summary><font color="#aaaaaa">"result"</font></details>';
    const chat = [toolCallMessage(toolText)];
    let saves = 0;
    const live = await loadLiveColorsModule({
        getContext: () => chatContext('chat-a', chat, async () => { saves++; return true; }),
        characterColors: {},
        updateVisibleMessageColors() {},
    });

    assert.equal(live.applyLiveColorReplacements({ '#aaaaaa': '#bbbbbb' }), 0);
    assert.equal(chat[0].mes, toolText);
    await delay(40);
    assert.equal(saves, 0);
});

// Reported from SillyBunny: the tracked line counts sat at the right-looking number until an
// in-chat agent touched the message, then jumped by four or five. The agent only emitted
// MESSAGE_UPDATED; what jumped was the first honest recount after ingest had counted the
// model's raw reply and local completion had quietly added more font tags to it.
function completionStubs(chat, onSync) {
    const entry = { name: 'Alice', color: '#123456', aliases: [] };
    const context = chatContext('chat-a', chat);
    return {
        getContext: () => context,
        settings: {
            enabled: true,
            coloringEngine: 'llm',
            autoScanNewMessages: true,
            completePartialColorize: true,
            autoColorize: false,
        },
        characterColors: { alice: entry },
        isDomEngine: () => false,
        getStorageKey: () => 'chat:chat-a',
        isHostSystemOrToolMessage: () => false,
        processColorBlocksInText: () => ({
            foundColorBlock: true,
            foundNew: false,
            hadRemapping: false,
            remappedAssignments: [],
            narratorSeen: false,
        }),
        syncDialogueCounts: syncedChat => { onSync(syncedChat[0].mes); return false; },
        collectFontColorsFromText: text => new Set((String(text).match(/#123456/g) || [])),
        attributeDialogueSegments: text => ({
            segments: ['"One."', '"Two."'].flatMap(quote => {
                const start = text.indexOf(quote);
                return start < 0 ? [] : [{ start, end: start + quote.length, assignment: { key: 'alice', name: 'Alice', color: '#123456' } }];
            }),
            createdCharacters: false,
        }),
        getNarratorVisual: () => null,
        getEntryEffectiveColor: value => value.color,
        ensureCharacterEntry: () => ({ created: false, entry }),
        isCompositeSpeakerLabel: () => false,
        hashMessageText: value => String(value),
        getMessageElementByIndex: () => null,
        stripColorBlockFromElement: () => false,
        getEffectivePromptMode: () => 'inject',
        setLastProcessedMessageSignature() {},
        refreshMessageDom: async () => {},
        scheduleDomRefreshSeries() {},
        updateCharList() {},
        injectPrompt() {},
        saveHistory() {},
        toast: { info() {}, warning() {} },
    };
}

test('the dialogue tally is taken after local completion rewrites the message, not before', async () => {
    const message = { name: 'Alice', is_user: false, extra: {}, mes: '<font color="#123456">"One."</font> He paused. "Two."' };
    const chat = [message];
    const synced = [];
    const live = await loadLiveColorsModule(completionStubs(chat, text => synced.push(text)));

    live.onNewMessage(0, message, chat);
    await waitFor(() => message.mes.split('<font').length - 1 === 2, 2000);
    await waitFor(() => synced.at(-1) === message.mes, 2000);

    assert.ok(synced.length >= 2, 'ingest and completion each ask for a recount');
    assert.equal(synced.at(-1), message.mes);
    assert.equal(synced.at(-1).split('<font').length - 1, 2, 'the locally completed line is counted too');
});

test('profile prompt mode colorizes each reply through the colorize profile', async () => {
    const message = { name: 'Alice', is_user: false, extra: {}, mes: 'Alice said "Hello."' };
    const chat = [message];
    const requests = [];
    const stubs = completionStubs(chat, () => {});
    Object.assign(stubs, {
        settings: { ...stubs.settings, autoColorize: false, completePartialColorize: false },
        // Inject mode would have had the reply model color as it wrote; in profile mode nothing
        // is asked of it, so the reply arrives plain and this second request is the only coloring.
        getEffectivePromptMode: () => 'profile',
        processColorBlocksInText: () => ({
            foundColorBlock: false,
            foundNew: false,
            hadRemapping: false,
            remappedAssignments: [],
            narratorSeen: false,
        }),
        collectFontColorsFromText: () => new Set(),
        generateQuietPrompt: async () => '',
        callLLMWithProfile: async instruction => { requests.push(instruction); return ''; },
        setIsAutoColorizing() {},
        showAutoColorizeIndicator() {},
        hideAutoColorizeIndicator() {},
        clearAutoColorizeIndicators() {},
        syncAllEffectiveColors() {},
        buildLLMColorizeRules: () => [],
        getThoughtDelimiterSymbols: () => [],
        formatColorBlockPair: (name, color) => `${name}=${color}`,
        colorizeMessageText: rawText => ({ updatedText: rawText, changed: false, createdCharacters: false, hadDialogueMatches: false, hadResolvableSpeaker: false }),
    });
    const live = await loadLiveColorsModule(stubs);

    live.onNewMessage(0, message, chat);
    await waitFor(() => requests.length === 1, 2000);
    assert.equal(requests.length, 1);
});
