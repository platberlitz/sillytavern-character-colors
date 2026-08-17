import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [uiSource, paletteSource] = await Promise.all([
    readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/palettes.js', import.meta.url), 'utf8'),
]);

function functionSection(source, name) {
    const declaration = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
    const match = declaration.exec(source);
    assert.ok(match, `missing ${name}`);
    const rest = source.slice(match.index + match[0].length);
    const next = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(rest);
    return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

test('character control IDs cannot collide with escaped-looking keys', () => {
    const start = uiSource.indexOf('function buildCharacterControlId(');
    const end = uiSource.indexOf('\n}', start) + 2;
    const buildId = new Function(`${uiSource.slice(start, end)}; return buildCharacterControlId;`)();
    const keys = ['', '/', '_2f_', '-', '_2d_', 'é', 'e\u0301', 'character'];
    const ids = keys.map(key => buildId('dc-control', key));

    assert.equal(new Set(ids).size, keys.length);
});

test('modal inert ownership follows the panel branch and restores only claimed nodes', () => {
    const claim = functionSection(uiSource, 'claimOutsideInert');
    const release = functionSection(uiSource, 'releaseOwnedInert');
    const makeNode = (inert = false) => ({ inert, children: [], parentElement: null });
    const body = makeNode();
    const branch = makeNode();
    const outside = makeNode();
    const preInert = makeNode(true);
    const panel = makeNode();
    const branchSibling = makeNode();
    const append = (parent, ...children) => {
        parent.children.push(...children);
        children.forEach(child => { child.parentElement = parent; });
    };
    append(body, branch, outside, preInert);
    append(branch, panel, branchSibling);
    const helpers = new Function('document', `${claim}\n${release}; return { claimOutsideInert, releaseOwnedInert };`)({ body });

    const owned = helpers.claimOutsideInert(panel);
    assert.deepEqual(owned, [branchSibling, outside]);
    assert.equal(preInert.inert, true);
    helpers.releaseOwnedInert(owned);
    assert.equal(branchSibling.inert, false);
    assert.equal(outside.inert, false);
    assert.equal(preInert.inert, true);

    const enter = functionSection(uiSource, 'enterSettingsFullscreen');
    const exit = functionSection(uiSource, 'exitSettingsFullscreen');
    assert.match(enter, /inertElements:\s*claimOutsideInert\(panel\)/);
    assert.match(exit, /releaseOwnedInert\(modalState\.inertElements\)/);
    assert.match(exit, /panel\.getAttribute\(name\) !== applied/);
    assert.match(exit, /modalState\.bodyClassOwned/);
});

test('fullscreen restores pre-existing attributes, focus, body class, and inert state', () => {
    const claim = functionSection(uiSource, 'claimOutsideInert');
    const release = functionSection(uiSource, 'releaseOwnedInert');
    const enter = functionSection(uiSource, 'enterSettingsFullscreen').replace(/^export\s+/, '');
    const exit = functionSection(uiSource, 'exitSettingsFullscreen').replace(/^export\s+/, '');
    class Element {}
    const classList = () => {
        const values = new Set();
        return {
            add: value => values.add(value),
            remove: value => values.delete(value),
            contains: value => values.has(value),
        };
    };
    const node = () => ({ inert: false, children: [], parentElement: null });
    const body = { ...node(), classList: classList() };
    const branch = node();
    const outside = node();
    const preInert = { ...node(), inert: true };
    const attributes = new Map([['role', 'region'], ['aria-label', 'Existing label']]);
    const panel = {
        ...node(),
        classList: classList(),
        getAttribute: name => attributes.get(name) ?? null,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        removeAttribute: name => attributes.delete(name),
    };
    const opener = Object.assign(new Element(), { isConnected: true, offsetParent: {}, focused: false, focus() { this.focused = true; } });
    const toggle = { setAttribute() {} };
    const tab = { focus() {} };
    const append = (parent, ...children) => {
        parent.children.push(...children);
        children.forEach(child => { child.parentElement = parent; });
    };
    append(body, branch, outside, preInert);
    append(branch, panel);
    const document = {
        body,
        activeElement: opener,
        getElementById: id => id === 'dc-ext' ? panel : id === 'dc-fullscreen-toggle' ? toggle : null,
        querySelector: () => tab,
    };
    const api = new Function(
        'document',
        'HTMLElement',
        'showSettingsPageSection',
        'applyPanelDisclosureState',
        `${claim}\n${release}\nlet activeSettingsPageSlug = 'setup';\nlet fullscreenOpener = null;\nlet fullscreenModalState = null;\n${enter}\n${exit}\nreturn { enterSettingsFullscreen, exitSettingsFullscreen };`,
    )(document, Element, () => {}, () => {});

    api.enterSettingsFullscreen(opener);
    assert.equal(outside.inert, true);
    assert.equal(preInert.inert, true);
    assert.equal(attributes.get('role'), 'dialog');
    assert.equal(attributes.get('aria-modal'), 'true');
    assert.equal(body.classList.contains('dc-fullscreen-open'), true);

    api.exitSettingsFullscreen();
    assert.equal(outside.inert, false);
    assert.equal(preInert.inert, true);
    assert.equal(attributes.get('role'), 'region');
    assert.equal(attributes.has('aria-modal'), false);
    assert.equal(attributes.get('aria-label'), 'Existing label');
    assert.equal(body.classList.contains('dc-fullscreen-open'), false);
    assert.equal(opener.focused, true);
});

test('successful inline editors leave edit mode before committing', () => {
    for (const [name, mutation] of [
        ['handleAliasClick', 'aliases.push(alias);'],
        ['handleFontClick', 'characterColors[key].font = nextFont;'],
        ['handleGroupClick', 'const result = setCharacterGroup([key], nextGroup);'],
    ]) {
        const source = functionSection(uiSource, name);
        const mutationIndex = source.indexOf(mutation);
        const closeIndex = source.indexOf('inputRow.remove();', mutationIndex);
        const commitIndex = source.indexOf('commit();', mutationIndex);
        assert.ok(mutationIndex >= 0 && closeIndex > mutationIndex && commitIndex > closeIndex, `${name} commits before closing`);
    }
});

test('floating placements track visual viewport offsets and scroll', () => {
    const legend = functionSection(uiSource, 'createLegend');
    const harmony = functionSection(paletteSource, 'showHarmonyPopup');

    for (const source of [legend, harmony]) {
        assert.match(source, /offsetLeft/);
        assert.match(source, /offsetTop/);
        assert.match(source, /visualViewport\?\.addEventListener\('scroll'/);
    }
    assert.match(harmony, /visualViewport\?\.removeEventListener\('scroll'/);
});

test('resource waits and temporary focus state have bounded cleanup', () => {
    const stylesheet = functionSection(uiSource, 'waitForStylesheet');
    const avatar = functionSection(uiSource, 'extractAvatarColor');
    const exportPng = functionSection(uiSource, 'exportLegendPng');
    const jump = functionSection(uiSource, 'jumpToAttributionReviewMessage');

    assert.match(stylesheet, /setTimeout\(finish, timeoutMs\)/);
    assert.match(stylesheet, /removeEventListener\?\.\('load', finish\)/);
    assert.match(stylesheet, /removeEventListener\?\.\('error', finish\)/);
    assert.match(avatar, /AVATAR_IMAGE_WAIT_TIMEOUT_MS/);
    assert.match(avatar, /img\.onload = null/);
    assert.match(avatar, /catch \{\s*finish\(null\)/);
    assert.match(exportPng, /settleWithin\(document\.fonts\.load\(canvasFont\)\)/);
    assert.doesNotMatch(exportPng, /loadGoogleFont\([^\n]+wait:\s*true/);
    assert.match(jump, /const ownsTabIndex = !target\.hasAttribute\('tabindex'\)/);
    assert.match(jump, /addEventListener\('blur', releaseTabIndex, \{ once: true \}\)/);
    assert.match(jump, /ownsTabIndex && target\.getAttribute\('tabindex'\) === '-1'/);
});

test('share cancellation cannot fall through to a download', () => {
    const deliver = functionSection(uiSource, 'deliverStylePack');
    const abort = deliver.indexOf("error?.name === 'AbortError'");
    const cancellationReturn = deliver.indexOf('return;', abort);
    const fallbackDownload = deliver.indexOf('downloadStylePackJson(json, filename);', abort);

    assert.ok(abort >= 0 && cancellationReturn > abort && fallbackDownload > cancellationReturn);
});
