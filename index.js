// Dialogue Colors - SillyTavern extension.
// Bootstrap only; all logic lives in src/ modules.
import { RUNTIME_GUARD_KEY, runtimeState } from './src/state.js';
import { install } from './src/main.js';

if (globalThis[RUNTIME_GUARD_KEY]?.initializing || globalThis[RUNTIME_GUARD_KEY]?.initialized) {
    console.warn('[Dialogue Colors] Runtime already initializing or initialized; skipping duplicate script execution.');
} else {
    runtimeState.initializing = true;
    runtimeState.initialized = false;
    globalThis[RUNTIME_GUARD_KEY] = runtimeState;
    const fail = error => {
        runtimeState.initializing = false;
        runtimeState.initialized = false;
        if (globalThis[RUNTIME_GUARD_KEY] === runtimeState) delete globalThis[RUNTIME_GUARD_KEY];
        console.error('[Dialogue Colors] Runtime initialization failed:', error);
    };
    try {
        Promise.resolve(install()).then(() => {
            runtimeState.initializing = false;
            runtimeState.initialized = true;
        }, fail);
    } catch (error) {
        fail(error);
    }
}
