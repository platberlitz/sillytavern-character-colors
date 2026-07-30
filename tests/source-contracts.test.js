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
    'streaming-paint.js',
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

test('applied verifier corrections always reach the rendered DOM in one pass', () => {
    const verifyOne = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');

    // The optimistic no-render decoration must never be the only attempt: a
    // message whose segments cannot text-match the rendered markup would keep
    // its corrections invisible until a later verify pass repainted them.
    assert.match(verifyOne, /!repainted && !useTransientOverrides && isCurrent\(\)[\s\S]*?refreshAndDecorateMessageDom\(mesIndex, msg, \{ queueVerification: false \}\)/);
    // The follow-up repair schedules on a 0ms first tick when nothing was
    // repainted, so it must not be gated behind a successful repaint.
    assert.match(verifyOne, /if \(isCurrent\(\)\) scheduleMessageDomFollowupRepair\(mesIndex, repainted\)/);
    assert.doesNotMatch(verifyOne, /if \(repainted &&/);
    // Neither post-verify decoration may re-queue verification for a message
    // that was just verified.
    assert.match(verifyOne, /decorateObservedMessages\(\[mesElement\], \{ queueVerification: false \}\)/);
    assert.doesNotMatch(verifyOne, /decorateObservedMessages\(\[mesElement\]\)/);
});

test('a stale verification target reports the corrections it already wrote', () => {
    const verifyOne = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');

    // Bailing with `unchecked` after overrides were written hid them from the
    // caller's toast and left the message unverified, so automatic
    // verification kept re-spending LLM calls on it.
    assert.match(verifyOne, /const abortedResult = \(\) => \(\{[\s\S]*?corrections: appliedCorrections,[\s\S]*?aborted: true,/);
    assert.match(verifyOne, /staleTarget = true; break;/);
    assert.match(verifyOne, /if \(staleTarget\) return abortedResult\(\)/);
    const correctionLoop = /for \(const correction of validCorrections\) \{[\s\S]*?\n {4}\}/.exec(verifyOne);
    assert.ok(correctionLoop, 'missing verifier correction loop');
    assert.doesNotMatch(correctionLoop[0], /return unchecked/);
});

test('manual verification queues behind an in-flight run instead of being dropped', () => {
    const runVerification = functionSection(sources['verify.js'], 'runAttributionVerification');

    assert.match(runVerification, /const shouldQueue = options\.queue !== false/);
    // A fixed key collapses repeated clicks into one pending run.
    assert.match(runVerification, /automatic \? '' : 'manual'/);
    assert.match(runVerification, /return \{[^}]*queued: shouldQueue/);
});

test('unmatchable messages get a bounded best-effort decoration', () => {
    const repairType = functionSection(sources['dom-engine.js'], 'getMessageDomHealthRepairType');
    const healthCheck = functionSection(sources['dom-engine.js'], 'runDomHealthCheck');

    // Without allowPartial, a never-ready message short-circuits to 'refresh'
    // forever and the 'decorate' branch below is unreachable.
    assert.match(repairType, /!readiness\.ready && options\.allowPartial !== true\) return 'refresh'/);
    assert.match(healthCheck, /const exhausted = attempts === DOM_HEALTH_REFRESH_MAX_ATTEMPTS/);
    assert.match(healthCheck, /getMessageDomHealthRepairType\(mesElement, msg, mesIndex, \{ allowPartial: exhausted \}\)/);
    // One best-effort pass only - repeating it every tick brings back flicker.
    assert.match(healthCheck, /if \(attempts > DOM_HEALTH_REFRESH_MAX_ATTEMPTS\) continue/);
    assert.match(healthCheck, /if \(exhausted\) healthRefreshAttempts\.set\(attemptsKey, attempts \+ 1\);\s*\n\s*else healthRefreshAttempts\.delete\(attemptsKey\)/);
    // A host re-render wipes decorations, so the budget must reset with them.
    assert.match(healthCheck, /clearDecoratedWatcher\(mesElement\);[\s\S]*?healthRefreshAttempts\.delete\(`\$\{repairIndex\}/);
});

test('the streaming painter owns its message alone', () => {
    // Every timer-driven scheduler repaints a frame or more after the host has
    // already rewritten .mes_text, which is the flicker. While a paint session
    // is armed they must all skip that one index.
    for (const name of ['scheduleMessageDomRepair', 'scheduleMessageDomFollowupRepair', 'queueObservedMessageDecoration', 'attachMessageSettleObserver', 'watchDecoratedMessage', 'runDomHealthCheck', 'decorateAllMessages', 'decorateObservedMessages']) {
        assert.match(functionSection(sources['dom-engine.js'], name), /isStreamingOwnedMessage\(/, `${name} must stand down for the streaming painter`);
    }

    const paint = functionSection(sources['streaming-paint.js'], 'paintStreamingMessage');
    // A clear pass is what makes the text visibly flash: it lands as its own
    // mutation, and the host may paint before the re-apply half runs.
    assert.doesNotMatch(paint, /undecorateMessageDom|clearSegmentDecoration|clearNarratorTextSpans/);
    // Re-entrancy has to be blocked synchronously; our own writes re-trigger the
    // observer, and isDecoratingDom is already restored by then.
    assert.match(paint, /if \(!streamingSession\.active \|\| streamingSession\.painting\) return false/);
    assert.match(paint, /streamingSession\.painting = true;[\s\S]*?finally \{\s*streamingSession\.painting = false;/);
    // The flag alone is not enough: mutation records queued by our own writes
    // are delivered in a later microtask, once painting is already false. The
    // observer has to be detached across the write and reattached after it, or
    // every paint schedules the next one and the message never settles.
    assert.match(paint, /streamingSession\.observer\?\.disconnect\(\);[\s\S]*?try \{/);
    assert.match(paint, /finally \{[\s\S]*?observeStreamingTarget\(\);\s*\}/);

    // No timers in the token handler: the repaint has to run inside the host's
    // own write frame, and only a MutationObserver gets us there.
    const register = functionSection(sources['main.js'], 'registerEventHandlers');
    const streamToken = /streamToken: \(\) => \{[^}]*\}/.exec(register);
    assert.ok(streamToken, 'missing stream-token handler');
    assert.match(streamToken[0], /beginStreamingPaint\(\)/);
    assert.doesNotMatch(streamToken[0], /schedule(DecorateLast|CustomFontRefresh|DomRefreshSeries)/);
    assert.match(functionSection(sources['streaming-paint.js'], 'beginStreamingPaint'), /new MutationObserver/);

    // Frozen assignments describe one specific message body, so a swipe, a chat
    // change and the end of generation must all drop them.
    assert.match(functionSection(sources['main.js'], 'handleMessageUpdated'), /endStreamingPaint\(\)/);
    assert.match(functionSection(sources['main.js'], 'handleChatChanged'), /endStreamingPaint\(\)/);
    assert.match(register, /setIsStreamingGenerationActive\(false\);\s*\n\s*endStreamingPaint\(\)/);
});

test('override targeting never uses the approximate element fallback', () => {
    const resolveSegment = functionSection(sources['dom-engine.js'], 'resolveDomSegmentIndexForElement');
    const readiness = functionSection(sources['dom-engine.js'], 'getMessageDomReadiness');
    const decorate = functionSection(sources['dom-engine.js'], 'decorateMessageDom');

    // Decoration may guess which <q> a segment became, because the worst case
    // is a miscoloured quote the user can right-click. Resolving the segment
    // index behind an override must not: a wrong index writes a persisted
    // override against a quote the user never clicked.
    assert.doesNotMatch(resolveSegment, /allowAnchoredFallback/);
    // Readiness has to score with the same rules decoration applies, or a
    // fallback-decorated message reads as unready and re-renders forever.
    assert.match(readiness, /allowAnchoredFallback: true/);
    assert.match(decorate, /allowAnchoredFallback: true/);
});

test('every settings page section has a matching nav tab', () => {
    const source = sources['ui.js'];
    const navSlugs = [...source.matchAll(/\{ slug: '([a-z]+)', label: '[^']+' \}/g)].map(m => m[1]);
    assert.ok(navSlugs.length >= 2, 'expected a populated SETTINGS_PAGE_SECTIONS list');

    // The nav is the only disclosure now, so a section without a tab is
    // unreachable and a tab without a section shows an empty page.
    const panelSlugs = [...source.matchAll(/data-dc-page="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual([...panelSlugs].sort(), [...navSlugs].sort());

    for (const slug of navSlugs) {
        // Attribute order is not the contract; presence on the one tag is.
        const tag = new RegExp(`<details[^>]*\\bid="dc-page-${slug}"[^>]*>`).exec(source);
        assert.ok(tag, `no panel tag for ${slug}`);
        for (const attribute of [
            `data-dc-page="${slug}"`,
            `data-dc-disclosure="${slug}"`,
            'role="tabpanel"',
            `aria-labelledby="dc-tab-${slug}"`,
        ]) {
            assert.ok(tag[0].includes(attribute), `${slug} panel is missing ${attribute}`);
        }
        assert.match(source, new RegExp(`id="dc-tab-\\$\\{slug\\}" data-dc-tab="\\$\\{slug\\}" aria-controls="dc-page-\\$\\{slug\\}"`));
    }
});

test('the settings panel stays in the extensions tab and flows freely', async () => {
    const createUI = functionSection(sources['ui.js'], 'createUI');

    assert.match(createUI, /getElementById\('extensions_settings'\)\?\.insertAdjacentHTML\('beforeend', buildSettingsPanelHtml\(\)\)/);
    assert.doesNotMatch(createUI, /document\.body\.insertAdjacentHTML/);

    // The capped inner scroller is what boxed every section into a sliver of
    // the panel; the extensions tab must remain the only scroller.
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const drawerContent = /#dc-ext \.inline-drawer-content \{([^}]*)\}/.exec(css);
    assert.ok(drawerContent, 'missing #dc-ext .inline-drawer-content rule');
    const declarations = drawerContent[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(declarations, /max-height|overflow-y/);
});

test('fullscreen is opt-in and reversible', () => {
    const source = sources['ui.js'];
    const enter = functionSection(source, 'enterSettingsFullscreen');
    const exit = functionSection(source, 'exitSettingsFullscreen');
    const bind = functionSection(source, 'bindSettingsPage');
    const show = functionSection(source, 'showSettingsPageSection');

    // Default is the drawer: nothing may add the fullscreen class at build or
    // bind time, only the explicit toggle.
    assert.doesNotMatch(source, /class="[^"]*dc-fullscreen(?![-\w])/);
    assert.match(bind, /toggle\.addEventListener\('click', \(\) => toggleSettingsFullscreen\(toggle\)\)/);
    assert.match(enter, /classList\.add\('dc-fullscreen'\)/);
    assert.match(enter, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(exit, /classList\.remove\('dc-fullscreen'\)/);
    assert.match(exit, /removeAttribute\('aria-modal'\)/);
    assert.match(exit, /opener\?\.offsetParent\) opener\.focus\(\)/);
    assert.match(bind, /e\.key === 'Escape'/);

    // Sections may only be hidden in fullscreen; in the tab they are an
    // accordion list and hiding one would make it unreachable.
    assert.match(show, /toggleAttribute\('hidden', fullscreen && section\.dataset\.dcPage !== target\)/);
});

test('verification samples the model and applies only what the samples agree on', () => {
    const verifyOne = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');

    // Each pass must be a fresh request, and a single unparseable sample must
    // not throw away the passes that did come back.
    assert.match(verifyOne, /for \(let pass = 0; pass < passes; pass\+\+\)/);
    assert.match(verifyOne, /ballots\.push\(validated\)/);
    assert.match(verifyOne, /if \(!ballots\.length\)/);
    assert.match(verifyOne, /reduceAttributionVerifierBallots\(ballots\)/);
    // Distinct quietName per pass, or the host can collide the requests.
    assert.match(verifyOne, /quietName: `\$\{[^`]*\}_\$\{mesIndex\}_\$\{pass\}_/);
});

test('auto-created speakers must appear in the text they came from', () => {
    const verifyOne = functionSection(sources['verify.js'], 'verifyAttributionsWithLLM');

    // Accept-all removes the human review step, not the evidence requirement:
    // ensureCharacterEntry is irreversible from the user's side.
    assert.match(verifyOne, /policy === 'legacy-auto'\s*\n\s*&& isVerifierSpeakerGroundedInChat\(correction\.speaker, msg, mesIndex, chat\)\) \{\s*\n\s*const created = ensureCharacterEntry/);
});

test('consensus logic stays free of SillyTavern imports', async () => {
    // The module is the one piece of verification that can be unit tested, and
    // it only stays that way while it imports nothing host-bound.
    const consensus = await readFile(new URL('../src/verify-consensus.js', import.meta.url), 'utf8');
    const imports = [...consensus.matchAll(/^import .*?from '([^']+)';/gm)].map(m => m[1]);
    assert.deepEqual(imports, []);
});

test('scroll preservation reaches the host scroller, not just the panel', async () => {
    const capture = functionSection(sources['ui.js'], 'captureScrollPositions');

    // The panel is no longer its own scroller, so a boundary that stops at it
    // captures nothing and a list re-render silently loses the user's place.
    assert.doesNotMatch(capture, /closest\?\.\('#dc-ext \.dc-panel-content'\)/);
    assert.match(capture, /isScrollableElement\(current\)/);
    assert.match(capture, /if \(!current\.closest\('#dc-ext'\)\) break/);

    // Declared overflow decides, not size alone: plenty of `overflow: visible`
    // boxes report scrollHeight > clientHeight and hold no scroll position.
    const scrollable = functionSection(sources['ui.js'], 'isScrollableElement');
    assert.match(scrollable, /\(auto\|scroll\|overlay\)/);
});

test('anchor suppression targets whichever ancestor actually scrolls', async () => {
    const bind = functionSection(sources['ui.js'], 'bindSettingsDrawerState');
    const find = functionSection(sources['ui.js'], 'findScrollableAncestor');

    // Forks relocate the extensions container, so #rm_extensions_block is not
    // reliably the scroller; on SillyBunny it is an overflow: visible wrapper.
    // Comments are stripped first: the contract is the code, and the comment
    // explaining this fix necessarily names the selector it removed.
    const bindCode = bind.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(bindCode, /#rm_extensions_block/);
    assert.match(bind, /findScrollableAncestor\(panel\)/);
    assert.match(bind, /getHostScroller\(\)\?\.classList/);
    // Resolve on declared overflow so the container that will scroll once the
    // panel expands is found before it has anything to scroll.
    assert.match(find, /\(auto\|scroll\|overlay\)/);

    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /#rm_extensions_block\.dc-dialogue-colors-expanded/);
    assert.match(css, /^\.dc-dialogue-colors-expanded \{[^}]*overflow-anchor: none/m);
});

test('the host scroll offset is re-asserted when the page returns', () => {
    const source = sources['ui.js'];
    const stability = functionSection(source, 'bindHostScrollStability');
    const bind = functionSection(source, 'bindSettingsPage');

    assert.match(bind, /bindHostScrollStability\(panel\)/);
    // A hidden momentum-scrolling container reports a scrambled offset, so only
    // offsets seen while the page is on screen may be recorded.
    assert.match(stability, /if \(scroller && isRendered\(\)\) savedScrollTop = scroller\.scrollTop/);
    assert.match(stability, /new ResizeObserver/);
    assert.match(stability, /rendered && !wasRendered/);
    // Clamp, or a stale offset taller than the current content scrolls to the
    // bottom, which is the very failure being corrected.
    assert.match(stability, /Math\.min\(savedScrollTop, Math\.max\(0, host\.scrollHeight - host\.clientHeight\)\)/);
    // Re-assert after the frame: iOS re-arms momentum scrolling on show.
    assert.match(stability, /requestAnimationFrame\(\(\) => \{[\s\S]*?host\.scrollTop = target/);
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
