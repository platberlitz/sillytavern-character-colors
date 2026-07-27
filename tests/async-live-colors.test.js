import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/live-colors.js', import.meta.url), 'utf8');
let moduleSequence = 0;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        settings: {},
        attributionChatGeneration: 0,
        setLiveChatSaveTimer() {},
        setPendingLiveChatSave() {},
        normalizeHexColor(value, fallback = null) {
            const color = String(value ?? '').toLowerCase();
            return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
        },
        getEntryEffectiveColor: entry => entry?.color,
        classifyLlmRequestError: error => ({ category: 'unknown', retryable: false, status: error?.status ?? null }),
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
        settings: {},
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
        buildLLMColorizeRules: () => [],
        buildColorMetadataPromptLines: () => [],
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
