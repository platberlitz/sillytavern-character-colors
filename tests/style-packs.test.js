import assert from 'node:assert/strict';
import test from 'node:test';

import {
    STYLE_PACK_FORMAT,
    STYLE_PACK_FORMAT_VERSION,
    StylePackError,
    analyzeStylePackConflicts,
    buildStylePackInstallationPlan,
    flattenStylePackAssignmentPresets,
    normalizeStylePack,
} from '../src/style-packs.js';

function assignment(name, color, aliases = []) {
    return { name, color, aliases };
}

test('v1 assignment presets deterministically resolve ambiguous identities', () => {
    const pack = {
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Collision test' },
        assignmentPresets: {
            Cast: [
                assignment('Alice', '#112233', ['Bobby', 'Ａｌ', 'Al']),
                assignment(' bobby ', '#445566'),
                assignment('Ａlice', '#778899'),
            ],
        },
    };

    const normalized = normalizeStylePack(pack, { includeAssignmentPresets: true });
    assert.deepEqual(normalized.assignmentPresets.Cast.map(entry => [entry.name, entry.aliases]), [
        ['Alice', ['Al']],
        ['Alice (2)', []],
        ['bobby', []],
    ]);
});

test('later selected presets deterministically replace overlapping characters', () => {
    const baseAlice = assignment('Alice', '#111111', ['Al']);
    const baseBob = assignment('Bob', '#222222');
    const overrideAlice = assignment(' alice ', '#abcdef', ['Ally']);
    const selection = ['01 Base', '02 Override'];

    const first = flattenStylePackAssignmentPresets({
        '02 Override': [overrideAlice],
        '01 Base': [baseAlice, baseBob],
    }, selection);
    const second = flattenStylePackAssignmentPresets({
        '01 Base': [baseAlice, baseBob],
        '02 Override': [overrideAlice],
    }, selection);

    assert.deepEqual(first.assignments.map(item => [item.name, item.color]), [
        ['Bob', '#222222'],
        [' alice ', '#abcdef'],
    ]);
    assert.deepEqual(first, second);
    assert.equal(first.overrides.length, 1);
    assert.deepEqual(first.overrides[0].identities, ['alice']);
    assert.equal(first.overrides[0].previousPreset, '01 Base');
    assert.equal(first.overrides[0].overridingPreset, '02 Override');
    assert.equal(first.overrides[0].previousAssignment, 'Alice');
    assert.equal(first.overrides[0].overridingAssignment, ' alice ');
    assert.equal(first.overrides[0].kind, 'primary-replacement');
    assert.equal(first.overrides[0].resolution, 'replace-assignment');
});

test('explicit assignment preset order controls precedence', () => {
    const base = assignment('Alice', '#111111');
    const override = assignment('Alice', '#abcdef');
    const result = flattenStylePackAssignmentPresets({ Base: [base], Override: [override] }, ['Override', 'Base']);

    assert.deepEqual(result.assignments.map(entry => entry.color), ['#111111']);
    assert.equal(result.overrides[0].previousPreset, 'Override');
    assert.equal(result.overrides[0].overridingPreset, 'Base');
});

test('alias-only cross-preset collisions fail closed', () => {
    const alice = assignment('Alice', '#111111', ['Shared']);
    const bob = assignment('Bob', '#222222');
    const carol = assignment('Carol', '#333333', ['Shared']);
    const result = flattenStylePackAssignmentPresets({ Base: [alice, bob], Later: [carol] }, ['Base', 'Later']);

    assert.deepEqual(result.assignments.map(entry => [entry.name, entry.aliases]), [
        ['Alice', []],
        ['Bob', []],
        ['Carol', []],
    ]);
    assert.equal(result.overrides.length, 0);
    assert.equal(result.aliasResolutions.length, 1);
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual({ ...result.aliasResolutions[0] }, {
        kind: 'alias-ambiguity',
        resolution: 'drop-ambiguous-alias',
        identities: ['shared'],
        previousPreset: 'Base',
        previousAssignment: 'Alice',
        previousAssignmentIndex: 0,
        overridingPreset: 'Later',
        overridingAssignment: 'Carol',
        overridingAssignmentIndex: 0,
    });
});

test('assignment conflict review reports the selected-order alias resolution', () => {
    const pack = {
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Diagnostics' },
        assignmentPresets: {
            First: [assignment('Alice', '#111111', ['Shared'])],
            Second: [assignment('Carol', '#222222', ['Shared'])],
        },
    };
    const conflicts = analyzeStylePackConflicts(pack, {}, {
        includeAssignmentPresets: true,
        selected: { assignmentPresets: ['Second', 'First'] },
    });

    assert.equal(conflicts.totalOverrides, 0);
    assert.equal(conflicts.totalAliasResolutions, 1);
    assert.equal(conflicts.categories.assignmentPresets.aliasResolutions[0].previousPreset, 'Second');
    assert.equal(conflicts.categories.assignmentPresets.aliasResolutions[0].overridingPreset, 'First');
    assert.equal(conflicts.categories.assignmentPresets.aliasResolutions[0].resolution, 'drop-ambiguous-alias');
    assert.deepEqual(conflicts.categories.assignmentPresets.identityResolutions, conflicts.categories.assignmentPresets.aliasResolutions);
    assert.deepEqual(conflicts.categories.assignmentPresets.presetOrder, ['Second', 'First']);
});

test('assignment groups use the shared bounded and reserved-name rules', () => {
    const withGroup = group => ({
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Group validation' },
        assignmentPresets: {
            Cast: [{ ...assignment('Alice', '#112233'), group }],
        },
    });

    const valid = normalizeStylePack(withGroup('Team Alpha'), { includeAssignmentPresets: true });
    assert.equal(valid.assignmentPresets.Cast[0].group, 'Team Alpha');
    assert.throws(
        () => normalizeStylePack(withGroup('x'.repeat(81)), { includeAssignmentPresets: true }),
        error => error instanceof StylePackError && error.code === 'string_too_long',
    );
    assert.throws(
        () => normalizeStylePack(withGroup('constructor'), { includeAssignmentPresets: true }),
        error => error instanceof StylePackError && error.code === 'reserved_key',
    );
});

test('assignment imports reserve narrator identities and reject ambiguous aliases', () => {
    const packWith = assignments => ({
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Identity validation' },
        assignmentPresets: { Cast: assignments },
    });

    for (const name of ['Narrator', '__narrator__']) {
        assert.throws(
            () => normalizeStylePack(packWith([assignment(name, '#112233')]), { includeAssignmentPresets: true }),
            error => error instanceof StylePackError && error.code === 'reserved_key',
        );
    }
    assert.throws(
        () => normalizeStylePack(packWith([
            assignment('Alice', '#112233', ['Shared']),
            assignment('Bob', '#445566', ['Ｓｈａｒｅｄ']),
        ]), { includeAssignmentPresets: true }),
        error => error instanceof StylePackError && error.code === 'duplicate_assignment_identity',
    );
});

test('palette conflicts use normalized identities and bounded rename targets', () => {
    const longName = 'x'.repeat(80);
    const pack = {
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Conflict identity' },
        palettes: { [longName]: ['#112233'] },
    };
    const installedName = `Ｘ${'x'.repeat(79)}`;
    const conflicts = analyzeStylePackConflicts(pack, { customPalettes: { [installedName]: ['#445566'] } });
    assert.equal(conflicts.categories.palettes.conflicts.length, 1);

    const plan = buildStylePackInstallationPlan(pack, { customPalettes: { [installedName]: ['#445566'] } }, {
        conflictStrategy: 'rename',
    });
    assert.equal(plan.operations[0].action, 'rename');
    assert.ok(plan.operations[0].targetName.length <= 80);
    assert.match(plan.operations[0].targetName, /\(2\)$/);
});

test('installed catalogs accept their storage name limits while packs stay bounded', () => {
    const localName = 'L'.repeat(120);
    const pack = {
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Storage limits' },
        palettes: { Incoming: ['#112233'] },
        assignmentPresets: { Cast: [] },
    };
    const installed = {
        customPalettes: { [localName]: ['#445566'] },
        presets: { [localName]: { version: 2, entries: [] } },
    };

    const conflicts = analyzeStylePackConflicts(pack, installed, { includeAssignmentPresets: true });
    assert.ok(conflicts.categories.palettes.existing.includes(localName));
    assert.ok(conflicts.categories.assignmentPresets.existing.includes(localName));
    assert.doesNotThrow(() => buildStylePackInstallationPlan(pack, installed, { includeAssignmentPresets: true }));
    assert.throws(
        () => normalizeStylePack({ ...pack, palettes: { ['P'.repeat(81)]: ['#112233'] } }),
        error => error instanceof StylePackError && error.code === 'string_too_long',
    );
});

test('renamed palette references are remapped in appearance', () => {
    const pack = {
        format: STYLE_PACK_FORMAT,
        formatVersion: STYLE_PACK_FORMAT_VERSION,
        metadata: { name: 'Appearance remap' },
        palettes: { Ocean: ['#112233'] },
        appearance: { colorTheme: 'custom:Ｏｃｅａｎ' },
    };
    const plan = buildStylePackInstallationPlan(pack, { customPalettes: { ocean: ['#445566'] } }, {
        conflictStrategy: 'rename',
    });
    assert.equal(plan.install.appearance.colorTheme, 'custom:Ocean (2)');
});

test('unresolved appearance palette references are rejected', () => {
    assert.throws(
        () => normalizeStylePack({
            format: STYLE_PACK_FORMAT,
            formatVersion: STYLE_PACK_FORMAT_VERSION,
            metadata: { name: 'Broken appearance' },
            appearance: { colorTheme: 'custom:Missing' },
        }),
        error => error instanceof StylePackError && error.code === 'unresolved_appearance_reference',
    );
});
