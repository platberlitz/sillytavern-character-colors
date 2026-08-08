import assert from 'node:assert/strict';
import test from 'node:test';

function createEventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type) {
            for (const listener of [...(listeners.get(type) || [])]) listener({ type });
        },
        listenerCount(type) {
            return listeners.get(type)?.size || 0;
        },
    };
}

function createClassList(initial = []) {
    const values = new Set(initial);
    const calls = { add: new Map(), remove: new Map() };
    return {
        add(value) { calls.add.set(value, (calls.add.get(value) || 0) + 1); values.add(value); },
        remove(value) { calls.remove.set(value, (calls.remove.get(value) || 0) + 1); values.delete(value); },
        contains(value) { return values.has(value); },
        callCount(action, value) { return calls[action].get(value) || 0; },
    };
}

test('scroll refreshes auto-animation visibility without IntersectionObserver and destroy removes listeners', async () => {
    const originalDescriptors = new Map(['document', 'window', 'innerWidth', 'innerHeight', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']
        .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const documentTarget = createEventTarget();
    const viewportTarget = createEventTarget();
    const visualViewportTarget = createEventTarget();
    const fakeDocument = Object.assign(documentTarget, {
        hidden: false,
        documentElement: { clientWidth: 800, clientHeight: 600 },
    });
    const fakeWindow = Object.assign(viewportTarget, { visualViewport: visualViewportTarget });
    let rect = { top: 10, bottom: 50, left: 10, right: 50 };
    const animatedElement = {
        classList: createClassList(['dc-gradient-animated', 'dc-gradient-text']),
        isConnected: true,
    };
    const root = {
        classList: createClassList(['mes']),
        isConnected: true,
        contains: element => element === animatedElement,
        getBoundingClientRect: () => rect,
        matches: selector => selector === '.mes',
        querySelectorAll: () => [animatedElement],
    };
    let controller;

    try {
        Object.defineProperties(globalThis, {
            document: { configurable: true, writable: true, value: fakeDocument },
            window: { configurable: true, writable: true, value: fakeWindow },
            innerWidth: { configurable: true, writable: true, value: 800 },
            innerHeight: { configurable: true, writable: true, value: 600 },
            IntersectionObserver: { configurable: true, writable: true, value: undefined },
            requestAnimationFrame: { configurable: true, writable: true, value: undefined },
            cancelAnimationFrame: { configurable: true, writable: true, value: undefined },
            matchMedia: { configurable: true, writable: true, value: undefined },
        });
        controller = await import(new URL('../src/animation-controller.js?ui-fallback-test', import.meta.url));
        const { settings } = await import('../src/state.js');
        settings.gradientAnimationMode = 'auto';

        controller.registerGradientAnimationRoot(root);
        assert.equal(controller.getGradientAnimationState().observerEnabled, false);
        assert.equal(controller.getGradientAnimationState().fallbackVisibilityEnabled, true);
        assert.equal(animatedElement.classList.contains('dc-gradient-running'), true);
        assert.equal(documentTarget.listenerCount('scroll'), 1);
        assert.equal(viewportTarget.listenerCount('resize'), 1);

        rect = { top: 2000, bottom: 2040, left: 10, right: 50 };
        documentTarget.dispatch('scroll');
        assert.equal(animatedElement.classList.contains('dc-gradient-running'), false);

        rect = { top: 10, bottom: 50, left: 10, right: 50 };
        documentTarget.dispatch('scroll');
        const runningAdds = animatedElement.classList.callCount('add', 'dc-gradient-running');
        const runningRemoves = animatedElement.classList.callCount('remove', 'dc-gradient-running');
        controller.refreshGradientAnimationState();
        assert.equal(animatedElement.classList.callCount('add', 'dc-gradient-running'), runningAdds);
        assert.equal(animatedElement.classList.callCount('remove', 'dc-gradient-running'), runningRemoves);

        controller.unregisterGradientAnimationRoot(root);
        assert.equal(controller.getGradientAnimationState().rootCount, 0);
        assert.equal(controller.getGradientAnimationState().fallbackVisibilityEnabled, false);
        assert.equal(documentTarget.listenerCount('scroll'), 0);
        assert.equal(viewportTarget.listenerCount('resize'), 0);

        const descendants = Array.from({ length: 2049 }, () => ({ matches: () => false }));
        fakeDocument.createTreeWalker = () => {
            let index = 0;
            return { nextNode: () => descendants[index++] || null };
        };
        const oversizedEmptyRoot = {
            classList: createClassList(['mes']),
            isConnected: true,
            matches: selector => selector === '.mes',
            querySelector: () => null,
            getBoundingClientRect: () => ({ top: 10, bottom: 50, left: 10, right: 50 }),
        };
        controller.registerGradientAnimationRoot(oversizedEmptyRoot);
        assert.equal(controller.getGradientAnimationState().rootCount, 0);
        assert.equal(controller.getGradientAnimationState().fallbackVisibilityEnabled, false);

        controller.destroyGradientAnimationController();
        assert.equal(documentTarget.listenerCount('scroll'), 0);
        assert.equal(documentTarget.listenerCount('visibilitychange'), 0);
        assert.equal(viewportTarget.listenerCount('scroll'), 0);
        assert.equal(viewportTarget.listenerCount('resize'), 0);
        assert.equal(visualViewportTarget.listenerCount('scroll'), 0);
        assert.equal(visualViewportTarget.listenerCount('resize'), 0);
    } finally {
        controller?.destroyGradientAnimationController();
        for (const [name, descriptor] of originalDescriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});
