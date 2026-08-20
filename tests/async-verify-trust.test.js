import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/verify.js', import.meta.url), 'utf8');
let moduleSequence = 0;

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('Timed out waiting for verifier request.');
}

async function loadVerifier(overrides = {}) {
    const importPattern = /^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];\s*$/gm;
    const names = new Set();
    for (const match of source.matchAll(importPattern)) {
        for (const rawName of match[1].split(',')) names.add(rawName.trim());
    }

    const request = deferred();
    let requestStarted = false;
    let marked = 0;
    let cleared = 0;
    let provenanceMethod = 'message-speaker';
    const preceding = { id: 'm0', name: 'Alice', mes: 'Alice spoke first.', is_user: false, is_system: false, swipe_id: 0, extra: {} };
    const target = { id: 'm1', name: 'Bob', mes: '"Hello."', is_user: false, is_system: false, swipe_id: 0, extra: {} };
    const context = { chat: [preceding, target], chatMetadata: {}, name1: 'User', name2: 'Bob' };
    const settings = {
        enabled: true,
        coloringEngine: 'dom',
        attributionConnectionProfile: null,
        attributionConservativeOnly: false,
        attributionReviewPolicy: 'review',
        attributionMaxTokens: 4096,
        attributionVerifyPasses: 1,
        llmAttributionCheck: true,
        llmAttributionParallel: false,
        autoScanOnLoad: true,
    };
    const segment = () => ({
        index: 0,
        start: 0,
        end: 8,
        text: '"Hello."',
        delimiter: '"',
        assignment: { key: 'bob', name: 'Bob', color: '#112233' },
        confidence: 0.7,
        provenance: { source: 'message-speaker', method: provenanceMethod },
        evidence: [{ type: 'message-speaker' }],
    });
    const isHostSystemOrToolMessage = message => Array.isArray(message?.extra?.tool_invocations)
        || (message?.is_system === true && message?.extra?.type === 'generic');
    const key = `__dcAsyncVerifyStubs_${++moduleSequence}`;
    globalThis[key] = {
        ATTRIBUTION_SOURCE: { LLM: 'llm', FROZEN: 'frozen' },
        ATTRIBUTION_VERIFICATION_STATUS: { CLEAN: 'clean', PENDING_REVIEW: 'pending-review', AUTO_APPLIED: 'auto-applied' },
        isHostSystemOrToolMessage,
        normalizeAttributionConfidence: value => value,
        attributeDialogueSegments: () => ({ segments: [segment()] }),
        clearSpeakerRegexCache() {},
        ensureCharacterEntry: () => ({ created: false }),
        buildNameColorLookup: () => new Map([['bob', { key: 'bob', name: 'Bob', color: '#112233' }]]),
        collectFontColorsFromText: () => new Set(),
        parseNamedColorAssignmentsFromText: () => [],
        resolveCharacterKeyByNameOrAlias: name => String(name).toLowerCase() === 'bob' ? 'bob' : '',
        cancelMessageDomFollowupRepairs() {},
        clearMessageDomRepairTimer() {},
        clearStreamingAttributionOverrides() { cleared++; },
        decorateMessageDomFromCurrentRender: async () => false,
        decorateObservedMessages() {},
        getMessageAttributionFreezeSegments: () => [],
        getMessageQuoteOverrideEntry: () => null,
        getMessageQuoteOverrideOptions: () => ({}),
        isMessageAttributionVerified: () => false,
        markMessageAttributionVerified() { marked++; return true; },
        refreshAndDecorateMessageDom: async () => false,
        scheduleMessageDomFollowupRepair() {},
        setMessageQuoteOverride: () => false,
        setStreamingAttributionOverride: () => false,
        suspendMessageDomWorkForEdit: () => false,
        upsertAttributionReview: () => null,
        normalizeRegistryIdentityName(value, maximum = 120) {
            const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
            return name && name.length <= maximum && !/[<>{}]/.test(name) ? name : '';
        },
        callLLMWithProfile: async () => { requestStarted = true; return request.promise; },
        classifyLlmRequestError: () => ({ category: 'unknown', retryable: false, status: null }),
        hasAttributionVerifierBallotQuorum: valid => valid > 0,
        isSpeakerNamePresentInText: () => false,
        normalizeAttributionVerifyPasses: () => 1,
        reduceAttributionVerifierBallots: ballots => ballots[0] || [],
        commit() {},
        repaintDomAfterCharacterDataChange() {},
        formatPromptLiteralSymbol: value => String(value),
        getThoughtDelimiterSymbols: () => [],
        getContext: () => context,
        getMessageElementByIndex: () => null,
        hashMessageText: value => String(value),
        isCompositeSpeakerLabel: () => false,
        toast: { info() {}, warning() {}, error() {} },
        setVerifyAttributionButtonBusy() {},
        isDomEngine: () => true,
        settings,
        characterColors: { bob: { name: 'Bob', color: '#112233', aliases: [] } },
        attributionChatGeneration: 0,
        attributionVerificationEpoch: 0,
        streamingAttributionGeneration: 0,
        isStreamingGenerationActive: false,
        isVerifyingAttribution: false,
        pendingAttributionVerifications: [],
        pendingAutoAttributionVerifyIndices: new Map(),
        recentAutoAttributionVerifyAttempts: new Map(),
        autoAttributionVerifyTimer: null,
        autoAttributionVerifyTimerDue: 0,
        lastStreamingAttributionVerifyKey: '',
        streamingAttributionVerifyTimer: null,
        AUTO_ATTRIBUTION_VERIFY_DELAY_MS: 10,
        AUTO_ATTRIBUTION_VERIFY_RENDERED_LIMIT: 10,
        AUTO_ATTRIBUTION_VERIFY_RETRY_DELAY_MS: 10,
        AUTO_ATTRIBUTION_VERIFY_STABLE_RETRY_DELAY_MS: 10,
        MAX_PENDING_AUTO_ATTRIBUTION_VERIFICATIONS: 10,
        STREAMING_ATTRIBUTION_VERIFY_DELAY_MS: 10,
        setAttributionVerificationEpoch() {},
        setAutoAttributionVerifyTimer() {},
        setAutoAttributionVerifyTimerDue() {},
        setIsVerifyingAttribution() {},
        setLastStreamingAttributionVerifyKey() {},
        setStreamingAttributionGeneration() {},
        setStreamingAttributionVerifyTimer() {},
        filterPromptCharacterEntries: entries => entries,
        ...overrides,
    };
    const transformed = `const { ${[...names].join(', ')} } = globalThis[${JSON.stringify(key)}];\n${source.replace(importPattern, '')}`;
    try {
        const verify = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#${moduleSequence}`);
        return {
            verify,
            context,
            preceding,
            target,
            request,
            requestStarted: () => requestStarted,
            marked: () => marked,
            cleared: () => cleared,
            changeProvenance: value => { provenanceMethod = value; },
        };
    } finally {
        delete globalThis[key];
    }
}

globalThis.document ??= { querySelector: () => null, querySelectorAll: () => [] };

test('attribution verifier uses the filtered known-speaker table', async () => {
    const fixture = await loadVerifier({
        characterColors: {
            active: { name: 'Active', color: '#123456', aliases: [] },
            retired: { name: 'Retired', color: '#654321', aliases: ['Old'] },
        },
        filterPromptCharacterEntries: entries => entries
            .filter(entry => entry.name !== 'Retired')
            .map(entry => entry.name === 'Active' ? { ...entry, aliases: [] } : entry),
    });
    const prompt = fixture.verify.buildAttributionVerifierPrompt(
        fixture.target,
        1,
        [{ index: 0, start: 0, end: 8, text: '"Hello."', delimiter: '"', assignment: { name: 'Active' } }],
        new Map(),
    );
    assert.match(prompt, /Active/);
    assert.doesNotMatch(prompt, /Retired|Old/);
});

test('verifier performs no post-await writes when submitted context or target provenance becomes stale', async () => {
    const mutations = [
        fixture => { fixture.preceding.mes = 'Edited context.'; },
        fixture => { fixture.target.name = 'Carol'; },
        fixture => { fixture.target.is_user = true; },
        fixture => { fixture.target.swipe_id = 1; },
        fixture => { fixture.changeProvenance('changed-provenance'); },
    ];

    for (const mutate of mutations) {
        const fixture = await loadVerifier();
        const run = fixture.verify.verifyAttributionsWithLLM(1);
        await waitFor(fixture.requestStarted);
        mutate(fixture);
        fixture.request.resolve('{"corrections":[]}');
        assert.deepEqual(await run, { checked: false, corrections: 0, createdCharacters: false });
        assert.equal(fixture.marked(), 0);
        assert.equal(fixture.cleared(), 0);
    }
});

test('an unchanged verifier target can be marked clean after the request', async () => {
    const fixture = await loadVerifier();
    const run = fixture.verify.verifyAttributionsWithLLM(1);
    await waitFor(fixture.requestStarted);
    fixture.request.resolve('{"corrections":[]}');
    assert.equal((await run).checked, true);
    assert.equal(fixture.marked(), 1);
});
