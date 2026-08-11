import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [main, prompts, colorBlocks, ui] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/prompts.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/color-blocks.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
]);

function functionSection(source, name) {
    const start = source.search(new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, 'm'));
    assert.ok(start >= 0, `missing ${name}`);
    const rest = source.slice(start + 1);
    const next = rest.search(/^(?:export\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m);
    return source.slice(start, next < 0 ? source.length : start + 1 + next);
}

test('disabled lifecycle stops before automatic storage and host work', () => {
    const start = functionSection(main, 'startAutomaticRuntime');
    const guard = start.indexOf('if (!settings.enabled || automaticRuntimeActive) return false;');
    for (const call of ['migrateLegacyLocalStorageIfNeeded()', 'loadData()', 'initAutoSync()']) {
        assert.ok(start.indexOf(call) > guard, `${call} must follow the enabled guard`);
    }

    const changed = functionSection(main, 'handleChatChanged');
    assert.ok(changed.indexOf('if (!settings.enabled)') < changed.indexOf('resumePendingChatSave()'));
    assert.ok(changed.indexOf('if (!settings.enabled)') < changed.indexOf('getCharKey()'));

    const init = functionSection(main, 'init');
    assert.match(init, /loadData\(\{ persistPrevious: false, persistMigrations: false, allowMetadataPersistence: false \}\)/);
    assert.ok(init.indexOf('createUI()') < init.indexOf('if (settings.enabled)'));

    const stop = functionSection(main, 'stopAutomaticRuntime');
    for (const call of ['clearAutoAttributionVerificationQueue(', 'undecorateAllMessages()', 'destroyGradientAnimationController()', 'flushPromptInjection()']) {
        assert.match(stop, new RegExp(call.replace(/[()]/g, '\\$&')));
    }
});

test('enablement synchronously resumes the current context before saving', () => {
    const sync = functionSection(main, 'syncAutomaticRuntime');
    assert.ok(sync.indexOf('startAutomaticRuntime()') < sync.indexOf('handleChatChanged()'));
    assert.ok(sync.indexOf('handleChatChanged()') < sync.indexOf('setupContextMenu()'));

    const enabledStart = ui.indexOf("$('dc-enabled').onchange = e => {");
    const enabledEnd = ui.indexOf("$('dc-highlight').onchange", enabledStart);
    const enabled = ui.slice(enabledStart, enabledEnd);
    assert.ok(enabled.indexOf('synchronizeEnabledLifecycle()') < enabled.indexOf('saveData()'));

    const changed = functionSection(main, 'handleChatChanged');
    assert.ok(changed.indexOf('reconcileMessageQuoteOverridesAfterDeletion()') < changed.indexOf('setupChatRootObserver()'));
});

test('chat seeding and transient reset preserve scoped state', () => {
    const changed = functionSection(main, 'handleChatChanged');
    assert.match(changed, /!Object\.keys\(characterColors\)\.length && !Object\.keys\(groupProfiles\)\.length/);
    assert.match(changed, /tryLoadFromCard\(\{ colorsOnly: true \}\)/);

    const reset = functionSection(main, 'resetDialogueCountsForNewChat');
    assert.match(reset, /settings\.clearUnpinnedOnNewChat === true/);
    assert.match(reset, /if \(removed\) \{[\s\S]*?commit\(\)/);
    assert.match(reset, /else if \(changed\) updateCharList\(\)/);
});

test('host event wiring deduplicates aliases, flushes prompts, and reconciles deletions', () => {
    const register = functionSection(main, 'registerEventHandlers');
    assert.match(register, /new Set\(\[event_types\.STREAM_TOKEN_RECEIVED, event_types\.SMOOTH_STREAM_TOKEN_RECEIVED\]\.filter\(Boolean\)\)/);
    assert.match(register, /generationAfterCommands:[\s\S]*?flushPromptInjection\(\)/);
    assert.match(register, /event_types\.MESSAGE_DELETED[\s\S]*?eventHandlers\.messageDeleted/);

    const deleted = functionSection(main, 'handleMessageDeleted');
    assert.match(deleted, /reconcileMessageQuoteOverridesAfterDeletion\(\)/);
    assert.match(deleted, /refreshDomDialogueCounts\(\)/);
    assert.match(deleted, /recountDialogueCountsFromChat\(\)/);
    assert.match(main, /DialogueColorsInterceptor[\s\S]*?flushPromptInjection\(\)/);
});

test('prompt UI updates stay debounced while generation can flush synchronously', () => {
    const inject = functionSection(prompts, 'injectPrompt');
    const flush = functionSection(prompts, 'flushPromptInjection');
    assert.match(inject, /setTimeout\(flushPromptInjection, 50\)/);
    assert.doesNotMatch(inject, /setExtensionPrompt\(/);
    assert.match(flush, /injectDebouncedTimer = null/);
    assert.match(flush, /setExtensionPrompt\(/);
});

test('color-block scans share host-system eligibility and match uppercase style tags', () => {
    assert.match(colorBlocks, /import \{ isHostSystemOrToolMessage \} from '\.\/attribution-store\.js'/);
    assert.match(functionSection(colorBlocks, 'scanAllMessages'), /if \(isHostSystemOrToolMessage\(msg\)\) continue/);
    assert.match(functionSection(colorBlocks, 'refreshTransientNarratorCount'), /if \(isHostSystemOrToolMessage\(msg\)\) continue/);
    assert.match(functionSection(colorBlocks, 'buildDialogueRegex'), /new RegExp\([\s\S]*, 'gi'\)/);
});
