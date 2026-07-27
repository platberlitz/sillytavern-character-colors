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

async function loadLlmModule(generateQuietPrompt) {
    const key = `__dcAsyncLlmStubs_${++moduleSequence}`;
    globalThis[key] = {
        generateQuietPrompt,
        getContext: () => ({}),
        settings: { llmConnectionProfile: null },
    };
    const transformed = source
        .replace(
            "import { generateQuietPrompt, getContext } from './st-api.js';",
            `const { generateQuietPrompt, getContext } = globalThis[${JSON.stringify(key)}];`,
        )
        .replace(
            "import { settings } from './state.js';",
            `const { settings } = globalThis[${JSON.stringify(key)}];`,
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
