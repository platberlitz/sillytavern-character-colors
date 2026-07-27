import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    createLatestRequestGate,
    getAutoSyncRecordDisposition,
    preserveLocalRemoteFontConsent,
} from '../src/state.js';

const storageSource = await readFile(new URL('../src/storage.js', import.meta.url), 'utf8');

test('unchanged verified auto-sync records confirm without applying', () => {
    assert.equal(getAutoSyncRecordDisposition({
        serverVerified: true,
        hasPending: false,
        matchesCurrent: true,
    }), 'confirm');
    assert.equal(getAutoSyncRecordDisposition({
        serverVerified: true,
        hasPending: false,
        matchesCurrent: false,
    }), 'apply');
    assert.equal(getAutoSyncRecordDisposition({
        serverVerified: true,
        hasPending: true,
        matchesPending: false,
    }), 'conflict');

    const confirmBranch = storageSource.indexOf("if (disposition === 'confirm')");
    const runtimeSnapshot = storageSource.indexOf('captureEffectiveColorSnapshot', confirmBranch);
    const confirmReturn = storageSource.indexOf('return disposition;', confirmBranch);
    assert.ok(confirmBranch >= 0 && confirmReturn > confirmBranch);
    assert.ok(runtimeSnapshot < 0 || confirmReturn < runtimeSnapshot);
});

test('latest-request gate rejects superseded completions', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    assert.equal(gate.isCurrent(first), false);
    assert.equal(gate.isCurrent(second), true);
    gate.supersede();
    assert.equal(gate.isCurrent(second), false);
    assert.match(storageSource, /if \(!autoSyncRequestGate\.isCurrent\(request\)\) return \{ ok: false, superseded: true \}/);
    assert.match(storageSource, /if \(autoSyncPollPromise\) return autoSyncPollPromise/);
});

test('remote auto-sync application yields to local queued persistence', () => {
    assert.match(storageSource, /let moduleSettingsActivityEpoch = 0/);
    assert.match(storageSource, /function queueDebouncedModuleSettingsSave[\s\S]*?moduleSettingsActivityEpoch\+\+/);
    assert.match(storageSource, /function queueImmediateSettingsSave[\s\S]*?moduleSettingsActivityEpoch\+\+/);
    assert.match(storageSource, /moduleSettingsDebounceTimer \|\| ordinaryModuleSaveQueued/);
    assert.match(storageSource, /deferred\.options\.activityEpoch !== moduleSettingsActivityEpoch/);
    assert.match(storageSource, /deferred\.options\.request[\s\S]*?autoSyncRequestGate\.isCurrent/);
    assert.match(storageSource, /function stopAutoSyncPolling[\s\S]*?deferredAutoSyncApplication = null/);
});

test('imports and remote records preserve local remote-font consent', () => {
    const remote = { allowRemoteFonts: true, themeMode: 'dark' };
    const denied = preserveLocalRemoteFontConsent(remote, false);
    const allowed = preserveLocalRemoteFontConsent({ allowRemoteFonts: false }, true);

    assert.equal(denied.allowRemoteFonts, false);
    assert.equal(denied.themeMode, 'dark');
    assert.equal(allowed.allowRemoteFonts, true);
    assert.equal(remote.allowRemoteFonts, true);
    assert.equal(Object.getPrototypeOf(denied), null);
    assert.match(storageSource, /function normalizeImportSettings[\s\S]*?delete normalized\.allowRemoteFonts;/);
    assert.match(storageSource, /if \(key === 'allowRemoteFonts'\) continue/);
    assert.match(storageSource, /const normalized = preserveRemoteFontConsentInRecord/);
    assert.match(storageSource, /LOCAL_REMOTE_FONT_CONSENT_KEY/);
    assert.match(storageSource, /persistLocalRemoteFontConsent\(settings\.allowRemoteFonts === true\)/);
    assert.match(storageSource, /normalized\.allowRemoteFonts = getLocalRemoteFontConsent\(\)/);
});
