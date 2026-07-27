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
