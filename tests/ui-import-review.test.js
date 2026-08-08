import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const nextFunction = source.indexOf(`function ${nextName}(`, start + 1);
    const end = source.lastIndexOf('\n', nextFunction);
    assert.ok(start >= 0 && nextFunction > start && end > start, `could not isolate ${name}`);
    return source.slice(start, end);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

test('style-pack review shows bounded and escaped cross-preset override diagnostics', () => {
    const helperSource = functionSource('buildStylePackAssignmentOverrideDetails', 'buildStylePackImportDetails');
    const buildDetails = new Function(
        'escapeHtml',
        'STYLE_PACK_OVERRIDE_DIAGNOSTIC_LIMIT',
        `${helperSource}; return buildStylePackAssignmentOverrideDetails;`,
    )(escapeHtml, 3);
    const identityResolutions = Array.from({ length: 5 }, (_, index) => ({
        identities: [index === 0 ? '<alias>' : `alias-${index}`],
        previousAssignment: `Previous ${index}`,
        previousPreset: 'Base',
        overridingAssignment: `Override ${index}`,
        overridingPreset: 'Later',
        resolution: index === 0 ? 'replace-assignment' : 'reassign-alias',
    }));
    const html = buildDetails({
        conflicts: { categories: { assignmentPresets: { identityResolutions } } },
    });

    assert.match(html, /Cross-preset identity resolutions/);
    assert.equal((html.match(/<li>/g) || []).length, 3);
    assert.match(html, /2 additional resolutions? omitted/);
    assert.match(html, /&lt;alias&gt;/);
    assert.doesNotMatch(html, /<alias>/);
});

test('style-pack import validation requires reviewed identity diagnostics and order', () => {
    const reviewStart = source.indexOf('async function reviewAndApplyStylePack(');
    const reviewEnd = source.indexOf('export function renderStylePackRegistry(', reviewStart);
    const reviewSource = source.slice(reviewStart, reviewEnd);

    assert.match(reviewSource, /Array\.isArray\(conflictCategories\.assignmentPresets\?\.identityResolutions\)/);
    assert.match(reviewSource, /Array\.isArray\(conflictCategories\.assignmentPresets\?\.presetOrder\)/);
    assert.match(reviewSource, /presetOrder\.every\(name => typeof name === 'string'\)/);
    assert.match(reviewSource, /typeof analysis\.catalogFingerprint === 'string'/);
    assert.match(reviewSource, /analysis\.catalogFingerprint\.length > 0/);
});

test('auxiliary character options and bulk-visible actions share hard bounds', () => {
    const gallerySource = functionSource('getGradientGalleryTargets', 'focusGradientGalleryControl');
    const groupsSource = functionSource('refreshGroupProfileControls', 'saveGroupProfileFromEditor');
    const toolbarSource = functionSource('updateBulkToolbar', 'getVisibleCharacterEntries');
    const visibleSource = functionSource('getVisibleCharacterEntries', 'updateCharList');

    assert.match(gallerySource, /slice\(0, DIALOG_LIST_RENDER_LIMIT\)/);
    assert.ok((groupsSource.match(/slice\(0, DIALOG_LIST_RENDER_LIMIT\)/g) || []).length >= 2);
    assert.match(toolbarSource, /visibleEntries = getVisibleCharacterEntries\(\)/);
    assert.match(visibleSource, /slice\(0, CHARACTER_LIST_RENDER_LIMIT\)/);
    assert.match(source, /dc-select-visible[\s\S]*?getVisibleCharacterEntries\(\)/);
});

test('import disclosure denies permission changes and row signatures include remote-font policy', () => {
    const disclosureSource = functionSource('buildRemoteFontImportDisclosure', 'reviewAndApplyImport');
    const buildDisclosure = new Function(
        'settings',
        `${disclosureSource}; return buildRemoteFontImportDisclosure;`,
    )({ allowRemoteFonts: false });
    const disclosure = buildDisclosure();
    assert.match(disclosure, /cannot grant remote-font permission/);
    assert.match(disclosure, /enabled separately/);
    assert.doesNotMatch(disclosure, /type="checkbox"/);

    const signatureStart = source.indexOf('export function buildCharRowSignature(');
    const signatureEnd = source.indexOf('export function applyColorInputForElement(', signatureStart);
    const signatureSource = source.slice(signatureStart, signatureEnd);
    assert.match(signatureSource, /settings\.allowRemoteFonts\s*===\s*true/);
});

test('async UI mutations revalidate reviewed bindings before touching live targets', () => {
    const capture = functionSource('captureUiMutationContext', 'isUiMutationContextCurrent');
    const stylePack = functionSource('reviewAndApplyStylePack', 'renderStylePackRegistry');
    const removals = functionSource('confirmCharacterRemoval', 'runSelectedCharacterMutation');
    const avatarStart = source.indexOf("$('dc-avatar-color').onclick = async");
    const avatarEnd = source.indexOf("$('dc-save-card').onclick = async", avatarStart);
    const saveCardEnd = source.indexOf("$('dc-load-card').onclick = async", avatarEnd);
    const avatar = source.slice(avatarStart, avatarEnd);
    const saveCard = source.slice(avatarEnd, saveCardEnd);

    assert.match(capture, /persistMetadata:\s*false/);
    assert.doesNotMatch(capture, /\bgetStorageKey\(\)/);
    assert.ok(stylePack.indexOf('captureUiMutationContext()') < stylePack.indexOf('await openDecisionDialog'));
    assert.ok(stylePack.indexOf('isUiMutationContextCurrent(binding)') < stylePack.indexOf('await applyStylePackImport'));
    assert.ok(removals.indexOf('captureUiMutationContext()') < removals.indexOf('await confirmReviewedAction'));
    assert.ok(removals.indexOf('isUiMutationContextCurrent(binding)') < removals.indexOf('removeCharacterKeys'));
    assert.ok(removals.indexOf('currentCandidates = getCandidates()') < removals.indexOf('removeCharacterKeys'));
    assert.ok(avatar.indexOf('captureUiMutationContext()') < avatar.indexOf('await extractAvatarColor'));
    assert.ok(avatar.indexOf('isUiMutationContextCurrent(binding)') < avatar.indexOf('setEntryFromBaseColor'));
    assert.ok(saveCard.indexOf('captureUiMutationContext()') < saveCard.indexOf('await runImportAnalysis'));
    assert.ok(saveCard.indexOf('isUiMutationContextCurrent(binding)') < saveCard.indexOf('saveToCard()'));
    assert.match(source, /error:\s*'context_changed'/);
});

test('destructive confirmations bind reviewed tables, members, and preset input', () => {
    const controls = functionSource('bindSettingsPanelControls', 'bindConnectionProfileRefresh');
    const regen = controls.slice(controls.indexOf("$('dc-regen').onclick"), controls.indexOf("$('dc-rerandom-gradients').onclick"));
    const gradients = controls.slice(controls.indexOf("$('dc-rerandom-gradients').onclick"), controls.indexOf("$('dc-flip-theme').onclick"));
    const preset = controls.slice(controls.indexOf("$('dc-save-preset').onclick"), controls.indexOf("$('dc-load-preset').onclick"));
    const reset = controls.slice(controls.indexOf("$('dc-reset').onclick"), controls.indexOf('let searchFrame'));
    const group = functionSource('applyGroupProfileToExisting', 'getBulkStyleFieldMask');

    for (const [label, section, mutation] of [
        ['color regeneration', regen, 'regenerateAllColors()'],
        ['gradient regeneration', gradients, 'regenerateAllGradients()'],
        ['color reset', reset, 'createRestoreSnapshot()'],
    ]) {
        assert.ok(section.indexOf('captureUiMutationContext()') < section.indexOf('await confirmReviewedAction'), `${label} must capture before review`);
        assert.ok(section.indexOf('JSON.stringify(characterColors) !== reviewedTable') < section.indexOf(mutation), `${label} must revalidate before mutation`);
    }
    assert.ok(preset.indexOf('reviewedTable') < preset.indexOf('await confirmReviewedAction'));
    assert.ok(preset.indexOf("resolveColorPresetName($('dc-preset-name').value) !== name") < preset.indexOf('saveColorPreset()'));
    assert.ok(preset.indexOf('JSON.stringify([characterColors, groupProfiles]) !== reviewedTable') < preset.indexOf('saveColorPreset()'));
    assert.match(group, /const currentKeys = getCharacterKeysForGroup\(name\)/);
    assert.match(group, /currentKeys\.map\(key => \[key, characterColors\[key\]\?\.group/);
    assert.doesNotMatch(group, /characterColors\[key\] !== reviewedEntries/);
});

test('remaining reviewed chat and table actions reject context drift', () => {
    const scope = functionSource('handleStorageScopeChange', 'buildImportReviewDetails');
    const conflicts = functionSource('showColorConflictReport', 'buildSettingsPageNavHtml');
    const controls = functionSource('bindSettingsPanelControls', 'bindConnectionProfileRefresh');
    const seed = controls.slice(controls.indexOf("$('dc-gradient-new-seed').onclick"), controls.indexOf("$('dc-thought-symbols').oninput"));
    const recolor = controls.slice(controls.indexOf("$('dc-recolor').onclick"), controls.indexOf("$('dc-colorize').onclick"));
    const colorize = controls.slice(controls.indexOf("$('dc-colorize').onclick"), controls.indexOf("$('dc-verify-attr').onclick"));

    assert.ok(scope.indexOf('captureUiMutationContext()') < scope.indexOf('await openDecisionDialog'));
    assert.ok(scope.indexOf('isUiMutationContextCurrent(binding)') < scope.indexOf('await switchColorStorageScope'));
    assert.ok(scope.indexOf('targetFingerprint') < scope.indexOf('await switchColorStorageScope'));
    assert.ok(conflicts.indexOf('captureUiMutationContext()') < conflicts.indexOf('await openDecisionDialog'));
    assert.ok(conflicts.indexOf('isUiMutationContextCurrent(binding)') < conflicts.indexOf('repairPerceptualConflicts()'));
    assert.ok(seed.indexOf('captureUiMutationContext()') < seed.indexOf('await confirmReviewedAction'));
    assert.ok(seed.indexOf('isUiMutationContextCurrent(binding)') < seed.indexOf('createGradientRandomMasterSeed()'));
    assert.ok(recolor.indexOf('captureChatBinding()') < recolor.indexOf('await confirmReviewedAction'));
    assert.ok(recolor.indexOf('isUiChatBindingCurrent(chatBinding)') < recolor.indexOf('recolorAllMessages()'));
    assert.ok(colorize.indexOf('captureChatBinding()') < colorize.indexOf('await confirmReviewedAction'));
    assert.ok(colorize.indexOf('isUiChatBindingCurrent(chatBinding)') < colorize.indexOf("colorizeMessages('all')"));
});

test('style-library installs and force-bold refresh only the state they depend on', () => {
    const stylePack = functionSource('reviewAndApplyStylePack', 'renderStylePackRegistry');
    const controls = functionSource('bindSettingsPanelControls', 'bindConnectionProfileRefresh');
    const forceBold = controls.slice(controls.indexOf("$('dc-force-bold').onchange"), controls.indexOf("$('dc-allow-remote-fonts').onchange"));

    assert.match(stylePack, /const needsScope = fields\.applyAssignments === true \|\| fields\.applyAppearance === true/);
    assert.match(stylePack, /needsScope && !isUiMutationContextCurrent\(binding\)/);
    assert.match(forceBold, /updateLegend\(\)/);
    assert.match(forceBold, /renderNarratorEditor\(\)/);
});

test('UI validation and host refresh hooks use canonical existing APIs', () => {
    const alias = functionSource('handleAliasClick', 'handleFontClick');
    const group = functionSource('readValidatedGroupInput', 'handleGroupClick');
    const galleryPreview = functionSource('getReadableGradientPresetPreview', 'getGradientPresetCatalog');
    const galleryCatalog = functionSource('getGradientPresetCatalog', 'describeGradientGeometry');
    const profileRefresh = functionSource('bindConnectionProfileRefresh', 'createUI');
    const updateList = functionSource('updateCharList', 'setControlHelp');

    assert.ok(alias.indexOf('normalizeRegistryIdentityName(rawAlias)') < alias.indexOf('aliases.push(alias)'));
    assert.ok(alias.indexOf('isReservedCharacterIdentity(alias)') < alias.indexOf('aliases.push(alias)'));
    assert.match(group, /rawValue\s*&&\s*!group/);
    assert.match(galleryPreview, /applyGradientPreset\(preview, preset\)/);
    assert.match(galleryCatalog, /getReadableGradientPresetPreview\(preset\)/);
    assert.match(profileRefresh, /CONNECTION_PROFILE_LOADED/);
    assert.match(profileRefresh, /CONNECTION_PROFILE_CREATED/);
    assert.match(profileRefresh, /CONNECTION_PROFILE_UPDATED/);
    assert.match(profileRefresh, /CONNECTION_PROFILE_DELETED/);
    assert.doesNotMatch(profileRefresh, /setInterval|setTimeout/);
    assert.match(updateList, /narratorEditor\.dataset\.narratorSignature[^\n]*renderNarratorEditor\(\)/);
    assert.match(source, /getCandidates:\s*\(\) => Object\.keys\(characterColors\)\.filter\(k => \(characterColors\[k\]\?\.dialogueCount \|\| 0\) < min\)/);
});
