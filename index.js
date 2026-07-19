// Dialogue Colors - SillyTavern extension.
// Bootstrap only; all logic lives in src/ modules.
import { RUNTIME_GUARD_KEY, runtimeState } from './src/state.js';
import { registerEventHandlers, init } from './src/main.js';

if (globalThis[RUNTIME_GUARD_KEY]?.initialized) {
    console.warn('[Dialogue Colors] Runtime already initialized; skipping duplicate script execution.');
} else {
    globalThis[RUNTIME_GUARD_KEY] = runtimeState;
    registerEventHandlers();
    setTimeout(init, 100);
}
