// animation-controller.js - bounds gradient animation work without redecorating content.
import { settings } from './state.js';

export const GRADIENT_ANIMATION_MODES = Object.freeze(['auto', 'full', 'static']);
export const AUTO_MESSAGE_ROOT_LIMIT = 8;
export const AUTO_ANIMATED_ELEMENT_LIMIT = 32;
export const ANIMATION_ROOT_MARGIN = 200;
const AUTO_ROOT_INSPECTION_LIMIT = 64;
const AUTO_ELEMENT_SCAN_LIMIT = 2048;
const ROOT_MAINTENANCE_LIMIT = 24;
const REQUESTED_SELECTOR = '.dc-gradient-animated.dc-gradient-text, .dc-gradient-animated.dc-gradient-surface';

const roots = new Set();
const visibleRoots = new Set();
const runningElements = new Set();
let observer = null;
let refreshFrame = 0;
let reducedMotionQuery = null;
let maintenanceIterator = null;
let fallbackVisibilityIterator = null;
let visibilityListenerBound = false;
let fallbackVisibilityListenersBound = false;
let fallbackDocumentTarget = null;
let fallbackViewportTarget = null;
let fallbackVisualViewportTarget = null;

function normalizeMode(value) {
    return GRADIENT_ANIMATION_MODES.includes(value) ? value : 'auto';
}

function collectRequestedElements(root, { limit = Number.POSITIVE_INFINITY, scanLimit = Number.POSITIVE_INFINITY } = {}) {
    const elements = [];
    if (!root) return { elements, complete: true };
    if (root.matches?.(REQUESTED_SELECTOR)) {
        elements.push(root);
        if (elements.length >= limit) return { elements, complete: false };
    }
    if (typeof document?.createTreeWalker !== 'function') {
        const matches = root.querySelectorAll?.(REQUESTED_SELECTOR) || [];
        for (let index = 0; index < matches.length && elements.length < limit; index++) elements.push(matches[index]);
        return { elements, complete: matches.length <= elements.length };
    }

    const walker = document.createTreeWalker(root, globalThis.NodeFilter?.SHOW_ELEMENT ?? 1);
    let scanned = 0;
    let element;
    while ((element = walker.nextNode())) {
        if (scanned >= scanLimit) return { elements, complete: false };
        scanned++;
        if (!element.matches?.(REQUESTED_SELECTOR)) continue;
        elements.push(element);
        if (elements.length >= limit) return { elements, complete: false };
    }
    return { elements, complete: true };
}

function resolveAnimationRoot(element) {
    if (!element?.closest) return null;
    return element.closest('.mes, #dc-ext, #dc-legend-float, .dc-dialog, .group_member, .character_select');
}

function isNearViewport(root) {
    const rect = root?.getBoundingClientRect?.();
    if (!rect) return true;
    const width = globalThis.innerWidth || document.documentElement?.clientWidth || 0;
    const height = globalThis.innerHeight || document.documentElement?.clientHeight || 0;
    return rect.bottom >= -ANIMATION_ROOT_MARGIN
        && rect.top <= height + ANIMATION_ROOT_MARGIN
        && rect.right >= -ANIMATION_ROOT_MARGIN
        && rect.left <= width + ANIMATION_ROOT_MARGIN;
}

function clearRunningElements() {
    runningElements.forEach(element => element.classList?.remove('dc-gradient-running'));
    runningElements.clear();
}

function removeRoot(root) {
    if (!root || !roots.has(root)) return false;
    observer?.unobserve(root);
    roots.delete(root);
    visibleRoots.delete(root);
    if (!roots.size) {
        fallbackVisibilityIterator = null;
        removeFallbackVisibilityListeners();
    }
    for (const element of runningElements) {
        if (element === root || root.contains?.(element)) {
            element.classList?.remove('dc-gradient-running');
            runningElements.delete(element);
        }
    }
    return true;
}

function refreshFallbackRootVisibility() {
    if (observer || !roots.size) {
        fallbackVisibilityIterator = null;
        return;
    }
    if (!fallbackVisibilityIterator) fallbackVisibilityIterator = roots.values();
    let inspected = 0;
    while (inspected < AUTO_ROOT_INSPECTION_LIMIT) {
        const next = fallbackVisibilityIterator.next();
        if (next.done) {
            fallbackVisibilityIterator = null;
            break;
        }
        inspected++;
        const root = next.value;
        if (!root.isConnected) {
            removeRoot(root);
            continue;
        }
        if (isNearViewport(root)) visibleRoots.add(root);
        else visibleRoots.delete(root);
    }
}

function maintainRegisteredRoots() {
    if (!roots.size) {
        maintenanceIterator = null;
        return;
    }
    if (!maintenanceIterator) maintenanceIterator = roots.values();
    let inspected = 0;
    while (inspected < ROOT_MAINTENANCE_LIMIT) {
        const next = maintenanceIterator.next();
        if (next.done) {
            maintenanceIterator = null;
            break;
        }
        inspected++;
        const root = next.value;
        if (!root.isConnected) {
            removeRoot(root);
            continue;
        }
        const requested = collectRequestedElements(root, { limit: 1, scanLimit: AUTO_ELEMENT_SCAN_LIMIT });
        if (!requested.elements.length && (requested.complete || !root.querySelector?.(REQUESTED_SELECTOR))) removeRoot(root);
    }
}

function getAutoRoots() {
    const nonMessages = [];
    const messages = [];
    const seen = new Set();
    let inspected = 0;
    const collect = collection => {
        for (const root of collection) {
            if (inspected >= AUTO_ROOT_INSPECTION_LIMIT) break;
            if (seen.has(root)) continue;
            seen.add(root);
            inspected++;
            if (!root.isConnected) {
                removeRoot(root);
                continue;
            }
            const nearViewport = observer ? visibleRoots.has(root) || isNearViewport(root) : isNearViewport(root);
            if (!observer) {
                if (nearViewport) visibleRoots.add(root);
                else visibleRoots.delete(root);
            }
            if (!nearViewport) continue;
            if (root.matches?.('.mes')) {
                if (messages.length < AUTO_MESSAGE_ROOT_LIMIT * 2) messages.push(root);
            } else {
                nonMessages.push(root);
            }
        }
    };
    collect(visibleRoots);
    if (inspected < AUTO_ROOT_INSPECTION_LIMIT) collect(roots);
    messages.sort((left, right) => {
        const leftRect = left.getBoundingClientRect?.();
        const rightRect = right.getBoundingClientRect?.();
        const leftDistance = Math.abs((leftRect?.top || 0) - ((globalThis.innerHeight || 0) / 2));
        const rightDistance = Math.abs((rightRect?.top || 0) - ((globalThis.innerHeight || 0) / 2));
        return leftDistance - rightDistance;
    });
    return [
        ...nonMessages,
        ...messages.slice(0, AUTO_MESSAGE_ROOT_LIMIT),
    ];
}

function applyRunningState() {
    refreshFrame = 0;
    maintainRegisteredRoots();
    const desiredElements = new Set();
    const mode = normalizeMode(settings.gradientAnimationMode);
    const reduced = reducedMotionQuery?.matches === true;
    if (!document.hidden && !reduced && mode !== 'static') {
        if (mode === 'auto' && !observer) refreshFallbackRootVisibility();
        const activeRoots = mode === 'full' ? roots : getAutoRoots();
        let remaining = mode === 'auto' ? AUTO_ANIMATED_ELEMENT_LIMIT : Number.POSITIVE_INFINITY;
        for (const root of activeRoots) {
            if (remaining <= 0) break;
            if (!root.isConnected) {
                removeRoot(root);
                continue;
            }
            const result = collectRequestedElements(root, {
                limit: remaining,
                scanLimit: mode === 'auto' ? AUTO_ELEMENT_SCAN_LIMIT : Number.POSITIVE_INFINITY,
            });
            if (!result.elements.length && result.complete) {
                removeRoot(root);
                continue;
            }
            for (const element of result.elements) {
                if (remaining <= 0) break;
                if (desiredElements.has(element)) continue;
                desiredElements.add(element);
                remaining--;
            }
        }
    }
    for (const element of runningElements) {
        if (element.isConnected && desiredElements.has(element)) continue;
        element.classList?.remove('dc-gradient-running');
        runningElements.delete(element);
    }
    for (const element of desiredElements) {
        if (runningElements.has(element)) continue;
        element.classList?.add('dc-gradient-running');
        runningElements.add(element);
    }
}

export function refreshGradientAnimationState() {
    if (refreshFrame || typeof document === 'undefined') return;
    if (typeof requestAnimationFrame === 'function') refreshFrame = requestAnimationFrame(applyRunningState);
    else applyRunningState();
}

function handleFallbackViewportChange() {
    if (normalizeMode(settings.gradientAnimationMode) === 'auto') refreshGradientAnimationState();
}

function removeFallbackVisibilityListeners() {
    if (!fallbackVisibilityListenersBound) return;
    fallbackDocumentTarget?.removeEventListener?.('scroll', handleFallbackViewportChange, true);
    fallbackViewportTarget?.removeEventListener?.('scroll', handleFallbackViewportChange);
    fallbackViewportTarget?.removeEventListener?.('resize', handleFallbackViewportChange);
    fallbackVisualViewportTarget?.removeEventListener?.('scroll', handleFallbackViewportChange);
    fallbackVisualViewportTarget?.removeEventListener?.('resize', handleFallbackViewportChange);
    fallbackDocumentTarget = null;
    fallbackViewportTarget = null;
    fallbackVisualViewportTarget = null;
    fallbackVisibilityListenersBound = false;
}

function ensureFallbackVisibilityListeners() {
    if (observer || fallbackVisibilityListenersBound || typeof document === 'undefined') return;
    fallbackDocumentTarget = document;
    fallbackViewportTarget = globalThis.window || globalThis;
    fallbackVisualViewportTarget = fallbackViewportTarget.visualViewport || null;
    fallbackDocumentTarget.addEventListener?.('scroll', handleFallbackViewportChange, { capture: true, passive: true });
    fallbackViewportTarget.addEventListener?.('scroll', handleFallbackViewportChange, { passive: true });
    fallbackViewportTarget.addEventListener?.('resize', handleFallbackViewportChange, { passive: true });
    fallbackVisualViewportTarget?.addEventListener?.('scroll', handleFallbackViewportChange, { passive: true });
    fallbackVisualViewportTarget?.addEventListener?.('resize', handleFallbackViewportChange, { passive: true });
    fallbackVisibilityListenersBound = true;
}

function ensureController() {
    if (typeof document === 'undefined') return;
    if (!reducedMotionQuery && typeof matchMedia === 'function') {
        reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
        if (typeof reducedMotionQuery.addEventListener === 'function') reducedMotionQuery.addEventListener('change', refreshGradientAnimationState);
        else reducedMotionQuery.addListener?.(refreshGradientAnimationState);
    }
    if (!observer && typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!roots.has(entry.target)) return;
                if (entry.isIntersecting) visibleRoots.add(entry.target);
                else visibleRoots.delete(entry.target);
            });
            refreshGradientAnimationState();
        }, { rootMargin: `${ANIMATION_ROOT_MARGIN}px` });
    }
    if (observer) removeFallbackVisibilityListeners();
    else ensureFallbackVisibilityListeners();
    if (!visibilityListenerBound) {
        // A reloaded module gets a fresh refreshGradientAnimationState reference, so the
        // previous instance's listener is tracked on the document and removed by identity
        // rather than gated behind a boolean this instance can no longer act on.
        const previous = document.__dcGradientAnimationVisibilityHandler;
        if (typeof previous === 'function') document.removeEventListener('visibilitychange', previous);
        document.addEventListener('visibilitychange', refreshGradientAnimationState);
        document.__dcGradientAnimationVisibilityHandler = refreshGradientAnimationState;
        visibilityListenerBound = true;
    }
}

export function registerGradientAnimationRoot(root) {
    if (!root?.classList) return null;
    ensureController();
    if (!roots.has(root)) {
        roots.add(root);
        if (isNearViewport(root)) visibleRoots.add(root);
        observer?.observe(root);
        refreshGradientAnimationState();
    }
    return root;
}

export function registerGradientAnimationElement(element) {
    return registerGradientAnimationRoot(resolveAnimationRoot(element));
}

export function unregisterGradientAnimationRoot(root) {
    if (!removeRoot(root)) return false;
    refreshGradientAnimationState();
    return true;
}

export function setGradientAnimationMode(value) {
    settings.gradientAnimationMode = normalizeMode(value);
    refreshGradientAnimationState();
    return settings.gradientAnimationMode;
}

export function getGradientAnimationState() {
    const activeRoots = new Set();
    let runningElementCount = 0;
    runningElements.forEach(element => {
        if (!element.isConnected || !element.classList.contains('dc-gradient-running')) return;
        runningElementCount++;
        const root = resolveAnimationRoot(element);
        if (root) activeRoots.add(root);
    });
    return {
        mode: normalizeMode(settings.gradientAnimationMode),
        hidden: typeof document !== 'undefined' && document.hidden,
        reducedMotion: reducedMotionQuery?.matches === true,
        rootCount: roots.size,
        activeRootCount: activeRoots.size,
        runningElementCount,
        observerEnabled: !!observer,
        fallbackVisibilityEnabled: fallbackVisibilityListenersBound,
    };
}

export function destroyGradientAnimationController() {
    if (refreshFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(refreshFrame);
    refreshFrame = 0;
    observer?.disconnect();
    observer = null;
    removeFallbackVisibilityListeners();
    clearRunningElements();
    if (reducedMotionQuery) {
        if (typeof reducedMotionQuery.removeEventListener === 'function') reducedMotionQuery.removeEventListener('change', refreshGradientAnimationState);
        else reducedMotionQuery.removeListener?.(refreshGradientAnimationState);
        reducedMotionQuery = null;
    }
    if (visibilityListenerBound && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', refreshGradientAnimationState);
        if (document.__dcGradientAnimationVisibilityHandler === refreshGradientAnimationState) {
            document.__dcGradientAnimationVisibilityHandler = null;
        }
        visibilityListenerBound = false;
    }
    roots.clear();
    visibleRoots.clear();
    maintenanceIterator = null;
    fallbackVisibilityIterator = null;
}
