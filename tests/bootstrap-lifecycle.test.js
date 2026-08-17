import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('bootstrap publishes success, blocks overlap, and permits retry after failure', async () => {
    const guardKey = '__dialogueColorsBootstrapTest';
    const runtime = { initializing: false, initialized: false };
    let installs = 0;
    let mode = 'pending';
    let resolveInstall;

    globalThis.__dcBootstrapGuardKey = guardKey;
    globalThis.__dcBootstrapRuntime = runtime;
    globalThis.__dcBootstrapInstall = () => {
        installs++;
        if (mode === 'reject') return Promise.reject(new Error('test install failure'));
        if (mode === 'resolve') return Promise.resolve();
        return new Promise(resolve => { resolveInstall = resolve; });
    };

    const stateUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        export const RUNTIME_GUARD_KEY = globalThis.__dcBootstrapGuardKey;
        export const runtimeState = globalThis.__dcBootstrapRuntime;
    `)}`;
    const mainUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        export const install = () => globalThis.__dcBootstrapInstall();
    `)}`;
    const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === './src/state.js') return { url: stateUrl, shortCircuit: true };
            if (specifier === './src/main.js') return { url: mainUrl, shortCircuit: true };
            return nextResolve(specifier, context);
        },
    });
    const previousWarn = console.warn;
    const previousError = console.error;
    console.warn = () => {};
    console.error = () => {};

    try {
        await import(`../index.js?bootstrap-test=first`);
        assert.equal(globalThis[guardKey], runtime);
        assert.equal(runtime.initializing, true);
        assert.equal(runtime.initialized, false);
        assert.equal(installs, 1);

        await import(`../index.js?bootstrap-test=duplicate`);
        assert.equal(installs, 1);

        resolveInstall();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(runtime.initializing, false);
        assert.equal(runtime.initialized, true);

        delete globalThis[guardKey];
        runtime.initializing = false;
        runtime.initialized = false;
        mode = 'reject';
        await import(`../index.js?bootstrap-test=failure`);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(globalThis[guardKey], undefined);
        assert.equal(runtime.initializing, false);
        assert.equal(runtime.initialized, false);

        mode = 'resolve';
        await import(`../index.js?bootstrap-test=retry`);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(globalThis[guardKey], runtime);
        assert.equal(runtime.initialized, true);
        assert.equal(installs, 3);
    } finally {
        hooks.deregister();
        console.warn = previousWarn;
        console.error = previousError;
        delete globalThis[guardKey];
        delete globalThis.__dcBootstrapGuardKey;
        delete globalThis.__dcBootstrapRuntime;
        delete globalThis.__dcBootstrapInstall;
    }
});
