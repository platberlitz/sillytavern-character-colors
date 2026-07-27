import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { settings } from '../src/state.js';

const sourceNames = [
    'dom-engine.js',
    'fonts.js',
    'live-colors.js',
    'llm.js',
    'main.js',
    'palettes.js',
    'storage.js',
    'ui.js',
    'utils.js',
    'verify.js',
];
const sourceEntries = await Promise.all(sourceNames.map(async name => [
    name,
    await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'),
]));
const sources = Object.fromEntries(sourceEntries);

function functionSection(source, name) {
    const declaration = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
    const match = declaration.exec(source);
    assert.ok(match, `missing named function ${name}`);
    const remainderStart = match.index + match[0].length;
    const remainder = source.slice(remainderStart);
    const nextFunction = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(remainder);
    const end = nextFunction ? remainderStart + nextFunction.index : source.length;
    return source.slice(match.index, end);
}

test('review policy defaults remain consistently fail-closed', () => {
    assert.equal(settings.attributionReviewPolicy, 'review');

    const toggleNormalization = functionSection(sources['storage.js'], 'normalizeToggleSettings');
    const storedNormalization = functionSection(sources['storage.js'], 'normalizeStoredSettings');
    const restoreDefaults = functionSection(sources['storage.js'], 'restoreAllSettingsToDefaults');
    const reviewPolicy = functionSection(sources['verify.js'], 'getAttributionReviewPolicy');

    assert.match(toggleNormalization, /settings\.attributionReviewPolicy\s*=\s*\[[^\]]*['"]review['"][^\]]*\]\.includes\([^)]+\)\s*\?[^:]+:\s*['"]review['"]/s);
    assert.match(storedNormalization, /normalized\.attributionReviewPolicy\s*=\s*\[[^\]]*['"]review['"][^\]]*\]\.includes\([^)]+\)\s*\?[^:]+:\s*['"]review['"]/s);
    assert.match(restoreDefaults, /settings\.attributionReviewPolicy\s*=\s*['"]review['"]/);
    assert.match(reviewPolicy, /return\s+\[[^\]]*['"]review['"][^\]]*\]\.includes\(policy\)\s*\?\s*policy\s*:\s*['"]review['"]/s);
});

test('explicit null profile selection routes to the main AI', () => {
    assert.equal(settings.llmConnectionProfile, null);
    assert.equal(settings.attributionConnectionProfile, null);

    const callWithProfile = functionSection(sources['llm.js'], 'callLLMWithProfile');
    const verifyAttributions = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');
    const restoreDefaults = functionSection(sources['storage.js'], 'restoreAllSettingsToDefaults');

    assert.match(callWithProfile, /Object\.prototype\.hasOwnProperty\.call\(options,\s*['"]profileId['"]\)/);
    assert.match(callWithProfile, /hasExplicitProfile\s*\?\s*options\.profileId\s*:\s*settings\.llmConnectionProfile/);
    assert.match(callWithProfile, /if\s*\(\s*!profileId\s*\)\s*\{?\s*return\s+callMainAi\(/s);
    assert.match(verifyAttributions, /profileId\s*:\s*settings\.attributionConnectionProfile/);
    assert.match(restoreDefaults, /settings\.llmConnectionProfile\s*=\s*null/);
    assert.match(restoreDefaults, /settings\.attributionConnectionProfile\s*=\s*null/);
});

test('legacy DOM overrides migrate only after current-message identity validation', () => {
    const lookup = functionSection(sources['dom-engine.js'], 'getMessageQuoteOverrideEntry');
    const matches = functionSection(sources['dom-engine.js'], 'messageQuoteOverrideEntryMatches');
    const migrate = functionSection(sources['dom-engine.js'], 'migrateLegacyMessageQuoteOverrideEntry');

    assert.match(lookup, /messageQuoteOverrideEntryMatches\(entry,\s*msg\)/);
    assert.match(lookup, /migrateLegacyMessageQuoteOverrideEntry\(entry,\s*msg\)/);
    assert.match(lookup, /if\s*\(migrated\)\s*saveChatMetadata\(\)/);
    for (const identityField of ['hash', 'messageId', 'messageFingerprint', 'textLength']) {
        assert.match(matches, new RegExp(identityField));
    }
    assert.match(matches, /isLegacyMessageQuoteOverrideEntry\(entry,\s*msg\)/);
    assert.match(sources['dom-engine.js'], /isLegacyAttributionOverrideEntry\(entry,[\s\S]*?messageHash:\s*identity\.hash,[\s\S]*?textLength:\s*identity\.textLength/);
    assert.match(migrate, /applyMessageAttributionIdentity\(entry,\s*msg\)/);
});

test('LLM colorization accepts only canonical font wrappers with unchanged text', () => {
    const parser = functionSection(sources['live-colors.js'], 'parseCanonicalFontMarkup');
    const finalize = functionSection(sources['live-colors.js'], 'finalizeLLMColorizedText');

    assert.match(parser, /tag\.match\(\/\^<font color=/);
    assert.match(parser, /tag\s*!==\s*['"]<\/font>['"]/);
    assert.match(parser, /if\s*\(openColor\)\s*return null/);
    assert.match(parser, /projection\.length\s*===\s*openProjectionLength/);
    assert.match(finalize, /parseCanonicalFontMarkup\(candidateWithoutMetadata\)/);
    assert.match(finalize, /parsedCandidate\.projection\s*!==\s*parsedOriginal\.projection/);
    assert.match(finalize, /if\s*\(\s*!parsedCandidate\.sawFont\s*\)/);
    assert.match(finalize, /colorized:\s*false/);
    assert.match(finalize, /colorized:\s*true/);
});

test('chat saves stay bound to the captured chat identity', () => {
    const capture = functionSection(sources['live-colors.js'], 'captureChatBinding');
    const equality = functionSection(sources['live-colors.js'], 'areChatBindingsEqual');
    const save = functionSection(sources['live-colors.js'], 'saveChatRecord');
    const queue = functionSection(sources['live-colors.js'], 'queueChatSave');
    const resume = functionSection(sources['live-colors.js'], 'resumePendingChatSave');
    const chatChanged = functionSection(sources['main.js'], 'handleChatChanged');

    for (const identityField of ['chat', 'chatId', 'groupId', 'ownerId']) {
        assert.match(capture, new RegExp(`\\b${identityField}\\b`));
        assert.match(equality, new RegExp(`\\.${identityField}\\b`));
    }
    assert.match(save, /const\s+saveBinding\s*=\s*record\.binding/);
    assert.match(save, /isChatBindingCurrent\(saveBinding,\s*saveContext\)/);
    assert.match(save, /saveContext\.saveChat\.call\(saveContext\)/);
    assert.match(queue, /queueCapturedChatSave\(captureChatBinding\(\)\)/);
    assert.match(capture, /durableId/);
    assert.match(equality, /left\.durableId/);
    assert.match(resume, /areChatBindingsEqual\(candidate\.binding,\s*binding\)/);
    assert.match(resume, /record\.binding\s*=\s*binding/);
    assert.match(chatChanged, /resumePendingChatSave\(\)/);
});

test('generation lifecycle prioritizes real loud starts and ignores dry runs', () => {
    const register = functionSection(sources['main.js'], 'registerEventHandlers');
    const started = register.indexOf('generationStarted: (type, _options, dryRun)');
    const dryRunGuard = register.indexOf('if (dryRun) return', started);
    const loudStart = register.indexOf("if (type !== 'quiet') loudGenerationActive = true", started);
    const loudEnd = register.indexOf('if (loudGenerationActive) loudGenerationActive = false');
    const quietGuard = register.indexOf('consumeMainAiQuietGenerationEnd()');
    const streamingMutation = register.indexOf('setIsStreamingGenerationActive(false)', quietGuard);
    const streamingCancel = register.indexOf('cancelStreamingAttributionVerification()', quietGuard);
    const sweep = register.indexOf('queueAutoAttributionVerificationForRenderedMessages', quietGuard);

    assert.ok(started >= 0);
    assert.ok(dryRunGuard > started && loudStart > dryRunGuard);
    assert.ok(loudEnd >= 0 && loudEnd < quietGuard, 'a tracked loud end must take priority over a quiet request');
    assert.ok(quietGuard >= 0, 'generation-ended handler must consume extension quiet events');
    assert.ok(streamingMutation > quietGuard);
    assert.ok(streamingCancel > quietGuard);
    assert.ok(sweep > quietGuard);

    const streamingVerify = functionSection(sources['verify.js'], 'runStreamingAttributionVerification');
    assert.match(streamingVerify, /if\s*\(\s*!isStreamingGenerationActive\s*\)\s*return/);
});

test('verification propagates provider failures into bounded automatic loops', () => {
    const verifyOne = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');
    const drainAutomatic = functionSection(sources['verify.js'], 'drainAutoAttributionVerificationQueue');
    const verifyVisible = functionSection(sources['verify.js'], 'verifyVisibleAttributionsWithLLM');
    const verifyStreaming = functionSection(sources['verify.js'], 'runStreamingAttributionVerification');

    assert.match(verifyOne, /providerFailure:\s*classifyLlmRequestError\(e\)/);
    assert.match(drainAutomatic, /let retryableProviderFailures = 0/);
    assert.match(drainAutomatic, /!result\.providerFailure\.retryable \|\| \+\+retryableProviderFailures >= 2/);
    assert.match(drainAutomatic, /if \(isVerifyingAttribution\)[\s\S]*?queued\.slice\(i\)[\s\S]*?scheduleAutoAttributionVerificationDrain/);
    assert.match(drainAutomatic, /automatic: true, queue: false/);
    assert.match(verifyVisible, /result\.providerFailure/);
    assert.match(verifyVisible, /retryableProviderFailures\s*>=\s*2/);
    assert.match(verifyStreaming, /blockedStreamingProviderGeneration\s*=\s*generation/);
    assert.match(verifyStreaming, /MAX_STREAMING_PROVIDER_FAILURES/);
});

test('edited attribution review acceptance stays atomic', () => {
    const acceptFromUi = functionSection(sources['ui.js'], 'acceptAttributionReviewFromUi');

    assert.match(acceptFromUi, /acceptAttributionReview\(review\.id, \{ speaker: acceptedName \}\)/);
    assert.doesNotMatch(acceptFromUi, /setMessageQuoteOverride/);
});

test('style-pack application is bound to reviewed options and catalogs', () => {
    const analyze = functionSection(sources['storage.js'], 'analyzeStylePackImport');
    const apply = functionSection(sources['storage.js'], 'applyStylePackImport');
    const applyInternal = functionSection(sources['storage.js'], 'applyStylePackImportInternal');

    assert.match(analyze, /catalogFingerprint:\s*getStylePackCatalogFingerprint\(current\)/);
    const snapshotIndex = apply.indexOf('snapshotStylePackApplyOptions(options)');
    const bindingIndex = apply.indexOf('captureActiveStorageBinding()');
    const awaitIndex = apply.indexOf('await digestStylePackEnvelope');
    assert.ok(snapshotIndex >= 0 && awaitIndex > snapshotIndex, 'apply options must be snapshotted before the first await');
    assert.ok(bindingIndex > snapshotIndex && awaitIndex > bindingIndex, 'the reviewed storage target must be captured before the first await');
    assert.match(apply, /reviewedCatalogFingerprint/);
    const fingerprintIndex = applyInternal.indexOf('getStylePackCatalogFingerprint(record) !== reviewedCatalogFingerprint');
    const planIndex = applyInternal.indexOf('buildStylePackInstallationPlan');
    assert.ok(fingerprintIndex >= 0 && planIndex > fingerprintIndex, 'catalog staleness must be checked before planning mutations');
    assert.match(sources['storage.js'], /function getStylePackCatalogFingerprint[\s\S]*?customPaletteMeta:\s*normalized\.customPaletteMeta/);
});

test('custom palette names resolve canonical collisions before mutation', () => {
    const normalize = functionSection(sources['palettes.js'], 'normalizeCustomPalettes');
    const resolve = functionSection(sources['palettes.js'], 'resolveCustomPaletteName');
    const save = functionSection(sources['palettes.js'], 'saveCustomPalette');

    assert.match(normalize, /migrateLegacyRegistryEntries\(raw/);
    assert.match(resolve, /normalizeRegistryIdentity\(name, 120\)/);
    assert.match(resolve, /Object\.keys\(customs\)\.find/);
    assert.match(save, /const \{ name, existingName \} = resolveCustomPaletteName/);
    assert.match(save, /if \(existingName && !shouldOverwritePalette\(\)\)/);
    const generate = functionSection(sources['palettes.js'], 'generateCustomPaletteFromWords');
    assert.match(generate, /const latestCustoms = getCustomPalettes\(\)/);
    assert.match(generate, /JSON\.stringify\(latestCustoms\[latestResolution\.existingName\]\) !== originalPalette/);
    assert.match(generate, /saveCustomPalettes\(latestCustoms\)/);
});

test('bulk colorization caps paid calls and falls back locally after unchanged output', () => {
    const colorize = functionSection(sources['live-colors.js'], 'colorizeMessages');
    const individual = functionSection(sources['live-colors.js'], 'colorizeMessageWithLLM');

    assert.match(sources['live-colors.js'], /COLORIZE_RUN_MAX_LLM_REQUESTS\s*=\s*\d+/);
    assert.match(sources['live-colors.js'], /COLORIZE_RUN_MAX_LLM_RETRIES\s*=\s*\d+/);
    assert.match(colorize, /reserveColorizeRequest\(llmBudget/);
    assert.match(colorize, /recordColorizeRequestFailure\(/);
    assert.match(colorize, /result\.colorized\s*!==\s*true/);
    assert.match(colorize, /shouldUseLocalColorizeFallback\(llmResult\)/);
    assert.match(individual, /throw e/);
});

test('remote font loading remains an explicit opt-in', () => {
    assert.equal(settings.allowRemoteFonts, false);

    const syncPolicy = functionSection(sources['fonts.js'], 'syncRemoteFontLoadingPolicy');
    const loadFont = functionSection(sources['fonts.js'], 'loadGoogleFont');
    const gateIndex = loadFont.indexOf('settings.allowRemoteFonts !== true');
    const requestIndex = loadFont.indexOf("document.createElement('link')");

    assert.match(sources['fonts.js'], /export const REMOTE_FONT_REQUEST_LIMIT\s*=\s*\d+/);
    assert.match(syncPolicy, /settings\.allowRemoteFonts\s*===\s*true/);
    assert.ok(gateIndex >= 0, 'loadGoogleFont must check the opt-in setting');
    assert.ok(requestIndex > gateIndex, 'the opt-in gate must precede link creation');
    assert.match(loadFont, /remoteFontRequests\.size\s*>=\s*REMOTE_FONT_REQUEST_LIMIT/);
});

test('browser-bound character normalization keeps a safe dictionary contract', () => {
    const normalizeCharacters = functionSection(sources['utils.js'], 'normalizeCharacterColors');

    assert.match(normalizeCharacters, /Object\.create\(null\)/);
    assert.match(normalizeCharacters, /normalizeCharacterEntry\(entry,\s*rawKey\)/);
    assert.match(normalizeCharacters, /normalizeRegistryIdentity\(normalizedEntry\.name\)/);
    assert.match(normalizeCharacters, /Object\.prototype\.hasOwnProperty\.call\(normalized,\s*key\)/);
});

test('browser-bound perceptual enrichment keeps readability findings separate', () => {
    const report = functionSection(sources['palettes.js'], 'getPerceptualConflictReport');

    assert.match(report, /report\.conflicts\s*=\s*\[\]/);
    assert.match(report, /report\.readabilityIssues\s*=\s*\[\]/);
    assert.match(report, /report\.conflicts\.push/);
    assert.match(report, /report\.readabilityIssues\.push/);
    assert.match(report, /report\.issues\s*=\s*\[\.\.\.report\.conflicts,\s*\.\.\.report\.readabilityIssues\]/);
});
