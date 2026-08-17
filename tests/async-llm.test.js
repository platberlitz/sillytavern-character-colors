import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/llm.js', import.meta.url), 'utf8');
let moduleSequence = 0;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

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

async function loadLlmModule(generateQuietPrompt, overrides = {}) {
    const key = `__dcAsyncLlmStubs_${++moduleSequence}`;
    globalThis[key] = {
        generateQuietPrompt,
        getContext: overrides.getContext || (() => ({})),
        settings: overrides.settings || { llmConnectionProfile: null },
    };
    const transformed = source
        .replace(
            "import { generateQuietPrompt, getContext } from './st-api.js';",
            `const { generateQuietPrompt, getContext } = globalThis[${JSON.stringify(key)}];`,
        )
        .replace(
            "import { MODULE_NAME, settings } from './state.js';",
            `const { settings } = globalThis[${JSON.stringify(key)}]; const MODULE_NAME = 'dialogue-colors';`,
        );
    try {
        return await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#${moduleSequence}`);
    } finally {
        delete globalThis[key];
    }
}

test('main-AI timeout rejects promptly while retaining the host gate and quiet tag', async () => {
    const host = deferred();
    const followerHost = deferred();
    let calls = 0;
    const llm = await loadLlmModule(() => {
        calls++;
        return calls === 1 ? host.promise : followerHost.promise;
    });
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
        const startedAt = Date.now();
        const request = llm.callLLMWithProfile('verify', {
            quietName: 'DC_Attr_Stream_test',
            timeoutMs: 25,
        });
        await waitFor(() => calls === 1);
        await assert.rejects(request, error => error?.name === 'TimeoutError');
        assert.ok(Date.now() - startedAt < 500, 'consumer should not wait for host settlement');
        assert.equal(llm.isMainAiRequestActive('DC_Attr_Stream'), true);
        assert.equal(llm.consumeMainAiQuietGenerationEnd('DC_Attr_Stream'), true);
        assert.equal(llm.consumeMainAiQuietGenerationEnd('DC_Attr_Stream'), false);

        const follower = llm.callLLMWithProfile('follower', {
            quietName: 'DC_follower',
            timeoutMs: 500,
        });
        await delay(20);
        assert.equal(calls, 1, 'timed-out host call must retain the paid-request gate');
        host.reject(new Error('late host failure'));
        await waitFor(() => calls === 2);
        followerHost.resolve('follower result');
        assert.equal(await follower, 'follower result');
        await waitFor(() => !llm.isMainAiRequestActive());
        await delay(10);
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('main-AI timeout includes lock wait and skips the expired queued turn', async () => {
    const firstHost = deferred();
    const calls = [];
    const llm = await loadLlmModule(options => {
        calls.push(options.quietPrompt);
        return firstHost.promise;
    });

    const first = llm.callLLMWithProfile('first', { quietName: 'DC_first', timeoutMs: 500 });
    await waitFor(() => calls.length === 1);
    const queuedAt = Date.now();
    const queued = llm.callLLMWithProfile('expired', { quietName: 'DC_expired', timeoutMs: 25 });
    await assert.rejects(queued, error => error?.name === 'TimeoutError');
    assert.ok(Date.now() - queuedAt < 500);
    assert.equal(calls.length, 1);

    firstHost.resolve('first result');
    assert.equal(await first, 'first result');
    await delay(20);
    assert.equal(calls.length, 1, 'expired queued request must not reach the host');
});

test('cancelled queued main-AI turns are skipped without allowing paid overlap', async () => {
    const firstHost = deferred();
    const thirdHost = deferred();
    const calls = [];
    const llm = await loadLlmModule(options => {
        calls.push(options.quietPrompt);
        return calls.length === 1 ? firstHost.promise : thirdHost.promise;
    });

    const first = llm.callLLMWithProfile('first', { quietName: 'DC_first', timeoutMs: 500 });
    await waitFor(() => calls.length === 1);

    const controller = new AbortController();
    const cancelled = llm.callLLMWithProfile('cancelled', {
        quietName: 'DC_cancelled',
        timeoutMs: 500,
        signal: controller.signal,
    });
    const reason = new Error('cancel queued turn');
    reason.name = 'AbortError';
    controller.abort(reason);
    await assert.rejects(cancelled, error => error === reason);

    const third = llm.callLLMWithProfile('third', { quietName: 'DC_third', timeoutMs: 500 });
    await delay(20);
    assert.equal(calls.length, 1);
    firstHost.resolve('first result');
    assert.equal(await first, 'first result');
    await waitFor(() => calls.length === 2);
    assert.match(calls[1], /third/);
    assert.doesNotMatch(calls[1], /cancelled/);
    thirdHost.resolve('third result');
    assert.equal(await third, 'third result');
});

test('main-AI requests use the host role-isolated raw API when available', async () => {
    let rawOptions = null;
    let quietCalls = 0;
    const context = {
        generateRaw: async options => {
            rawOptions = options;
            return 'raw result';
        },
    };
    const llm = await loadLlmModule(async () => { quietCalls++; return 'quiet result'; }, {
        getContext: () => context,
    });

    assert.equal(await llm.callLLMWithProfile('untrusted data', {
        systemInstruction: 'trusted instruction',
        maxTokens: 321,
        timeoutMs: 500,
    }), 'raw result');
    assert.equal(quietCalls, 0);
    assert.equal(rawOptions.prompt, 'untrusted data');
    assert.equal(rawOptions.systemPrompt, 'trusted instruction');
    assert.equal(rawOptions.responseLength, 321);
});

test('main-AI requests reject untrusted macro delimiters before calling the host', async () => {
    let calls = 0;
    const llm = await loadLlmModule(async () => { calls++; return ''; }, {
        getContext: () => ({ generateRaw: async () => { calls++; return ''; } }),
    });

    await assert.rejects(
        llm.callLLMWithProfile('literal {{char}} macro', { timeoutMs: 100 }),
        /reject macro delimiters/i,
    );
    assert.equal(calls, 0);
});

test('quiet fallback suppresses and restores this extension prompt even on failure', async () => {
    const prompt = { value: 'ambient colors', position: 1, depth: 2, scan: false, role: 0, filter: null };
    const context = {
        extensionPrompts: { 'dialogue-colors': prompt },
        setExtensionPrompt(key, value, position, depth, scan, role, filter) {
            this.extensionPrompts[key] = { value, position, depth, scan, role, filter };
        },
    };
    const llm = await loadLlmModule(async () => {
        assert.equal(context.extensionPrompts['dialogue-colors'].value, '');
        throw new Error('provider failed');
    }, { getContext: () => context });

    await assert.rejects(llm.callLLMWithProfile('safe data', { timeoutMs: 100 }), /provider failed/);
    assert.deepEqual(context.extensionPrompts['dialogue-colors'], prompt);
});

test('LLM request error classification stops permanent provider failures', async () => {
    const llm = await loadLlmModule(async () => 'unused');

    assert.deepEqual(llm.classifyLlmRequestError(new Error('HTTP 401 Unauthorized')), {
        category: 'authentication',
        retryable: false,
        status: 401,
    });
    assert.equal(llm.classifyLlmRequestError(new Error('insufficient quota')).retryable, false);
    assert.equal(llm.classifyLlmRequestError(new Error('HTTP 503 Service Unavailable')).retryable, true);

    const quotaLlm = await loadLlmModule(async () => ({ status: 429, error: 'insufficient quota' }));
    await assert.rejects(
        quotaLlm.callLLMWithProfile('quota', { timeoutMs: 100 }),
        error => error?.llmCategory === 'quota' && error?.retryable === false,
    );
});

test('LLM request error classification walks the complete cause chain', async () => {
    const llm = await loadLlmModule(async () => 'unused');

    const auth = new Error('request wrapper', {
        cause: new Error('provider wrapper', { cause: Object.assign(new Error('denied'), { response: { status: 401 } }) }),
    });
    assert.deepEqual(llm.classifyLlmRequestError(auth), {
        category: 'authentication',
        retryable: false,
        status: 401,
    });

    const abort = new Error('cancelled by caller');
    abort.name = 'AbortError';
    assert.equal(
        llm.classifyLlmRequestError(new Error('outer', { cause: new Error('middle', { cause: abort }) })).category,
        'cancelled',
    );
    assert.equal(
        llm.classifyLlmRequestError(new Error('outer', { cause: new Error('insufficient quota') })).category,
        'quota',
    );

    const cyclic = new Error('network failure');
    cyclic.cause = cyclic;
    assert.equal(llm.classifyLlmRequestError(cyclic).category, 'transient');
});

test('profile refresh keeps a missing selected profile explicit', async () => {
    const llm = await loadLlmModule(async () => '', {
        getContext: () => ({
            ConnectionManagerRequestService: {
                getSupportedProfiles: () => [{ id: 'available', name: 'Available' }],
            },
        }),
    });
    const originalDocument = globalThis.document;
    const select = {
        options: [],
        disabled: true,
        set innerHTML(value) { this.html = value; this.options = []; },
        get innerHTML() { return this.html; },
        appendChild(option) { this.options.push(option); },
    };
    globalThis.document = {
        getElementById: id => id === 'profile' ? select : null,
        createElement: () => ({}),
    };
    try {
        llm.populateProfileSelect('profile', 'deleted-profile');
        const missing = select.options.find(option => option.value === 'deleted-profile');
        assert.ok(missing);
        assert.equal(missing.selected, true);
        assert.equal(missing.disabled, true);
        assert.match(missing.textContent, /Missing profile/);
        assert.equal(select.disabled, false);
    } finally {
        globalThis.document = originalDocument;
    }
});
