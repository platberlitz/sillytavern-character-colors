// animation-controller.js - bounds gradient animation work without redecorating content.
import { settings } from './state.js';

export const GRADIENT_ANIMATION_MODES = Object.freeze(['auto', 'full', 'static']);
export const AUTO_MESSAGE_ROOT_LIMIT = 8;
export const AUTO_ANIMATED_ELEMENT_LIMIT = 32;
export const ANIMATION_ROOT_MARGIN = 200;

const roots = new Set();
const visibleRoots = new Set();
let observer = null;
let refreshFrame = 0;
let reducedMotionQuery = null;

function normalizeMode(value) {
    return GRADIENT_ANIMATION_MODES.includes(value) ? value : 'auto';
}

function collectRequestedElements(root) {
    const elements = [];
    const selector = '.dc-gradient-animated.dc-gradient-text, .dc-gradient-animated.dc-gradient-surface';
    if (root?.matches?.(selector)) elements.push(root);
    root?.querySelectorAll?.(selector).forEach(element => elements.push(element));
    return elements;
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

function clearRunningState(root) {
    if (root?.matches?.('.dc-gradient-running')) root.classList.remove('dc-gradient-running');
    root?.querySelectorAll?.('.dc-gradient-running').forEach(element => element.classList.remove('dc-gradient-running'));
}

function getAutoRoots() {
    const connected = [...roots].filter(root => root.isConnected);
    const nonMessages = connected.filter(root => !root.matches?.('.mes'));
    const messages = connected.filter(root => root.matches?.('.mes'));
    const visibleMessages = messages.filter(root => visibleRoots.has(root));
    if (!observer) return [...nonMessages.filter(isNearViewport), ...messages.slice(-3)];
    visibleMessages.sort((left, right) => {
        const leftRect = left.getBoundingClientRect?.();
        const rightRect = right.getBoundingClientRect?.();
        const leftDistance = Math.abs((leftRect?.top || 0) - ((globalThis.innerHeight || 0) / 2));
        const rightDistance = Math.abs((rightRect?.top || 0) - ((globalThis.innerHeight || 0) / 2));
        return leftDistance - rightDistance;
    });
    return [
        ...nonMessages.filter(root => visibleRoots.has(root) || isNearViewport(root)),
        ...visibleMessages.slice(0, AUTO_MESSAGE_ROOT_LIMIT),
    ];
}

function applyRunningState() {
    refreshFrame = 0;
    for (const root of [...roots]) {
        if (!root.isConnected) {
            observer?.unobserve(root);
            roots.delete(root);
            visibleRoots.delete(root);
            continue;
        }
        clearRunningState(root);
    }

    const mode = normalizeMode(settings.gradientAnimationMode);
    const reduced = reducedMotionQuery?.matches === true;
    if (document.hidden || reduced || mode === 'static') return;

    const activeRoots = mode === 'full' ? [...roots] : getAutoRoots();
    let remaining = mode === 'auto' ? AUTO_ANIMATED_ELEMENT_LIMIT : Number.POSITIVE_INFINITY;
    for (const root of activeRoots) {
        if (remaining <= 0) break;
        const requested = collectRequestedElements(root);
        for (const element of requested) {
            if (remaining <= 0) break;
            element.classList.add('dc-gradient-running');
            remaining--;
        }
    }
}

export function refreshGradientAnimationState() {
    if (refreshFrame || typeof document === 'undefined') return;
    if (typeof requestAnimationFrame === 'function') refreshFrame = requestAnimationFrame(applyRunningState);
    else applyRunningState();
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
                if (entry.isIntersecting) visibleRoots.add(entry.target);
                else visibleRoots.delete(entry.target);
            });
            refreshGradientAnimationState();
        }, { rootMargin: `${ANIMATION_ROOT_MARGIN}px` });
    }
    if (!document.__dcGradientAnimationVisibilityBound) {
        document.__dcGradientAnimationVisibilityBound = true;
        document.addEventListener('visibilitychange', refreshGradientAnimationState);
    }
}

export function registerGradientAnimationRoot(root) {
    if (!root?.classList) return null;
    ensureController();
    if (!roots.has(root)) {
        roots.add(root);
        if (isNearViewport(root)) visibleRoots.add(root);
        observer?.observe(root);
    }
    refreshGradientAnimationState();
    return root;
}

export function registerGradientAnimationElement(element) {
    return registerGradientAnimationRoot(resolveAnimationRoot(element));
}

export function unregisterGradientAnimationRoot(root) {
    if (!root || !roots.has(root)) return false;
    observer?.unobserve(root);
    clearRunningState(root);
    roots.delete(root);
    visibleRoots.delete(root);
    refreshGradientAnimationState();
    return true;
}

export function setGradientAnimationMode(value) {
    settings.gradientAnimationMode = normalizeMode(value);
    refreshGradientAnimationState();
    return settings.gradientAnimationMode;
}

export function getGradientAnimationState() {
    return {
        mode: normalizeMode(settings.gradientAnimationMode),
        hidden: typeof document !== 'undefined' && document.hidden,
        reducedMotion: reducedMotionQuery?.matches === true,
        rootCount: roots.size,
        activeRootCount: [...roots].filter(root => collectRequestedElements(root)
            .some(element => element.classList.contains('dc-gradient-running'))).length,
        runningElementCount: [...roots].reduce((count, root) => count + collectRequestedElements(root)
            .filter(element => element.classList.contains('dc-gradient-running')).length, 0),
        observerEnabled: !!observer,
    };
}

export function destroyGradientAnimationController() {
    if (refreshFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(refreshFrame);
    refreshFrame = 0;
    observer?.disconnect();
    observer = null;
    roots.forEach(root => {
        clearRunningState(root);
    });
    roots.clear();
    visibleRoots.clear();
}
