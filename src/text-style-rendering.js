export const TEXT_STYLE_MARKER_ATTRIBUTE = 'data-dc-text-style';

const OWNED_PROPERTIES = Object.freeze([
    { property: 'font-weight', attribute: 'data-dc-text-style-font-weight', value: 'bold' },
    { property: 'font-style', attribute: 'data-dc-text-style-font-style', value: 'italic' },
]);

const VALID_STYLES = new Set(['', 'bold', 'italic', 'bold italic']);

function normalizeTextStyle(value) {
    const style = typeof value === 'object' && value !== null ? value.style : value;
    return VALID_STYLES.has(style) ? style : '';
}

function readOwnedState(element, attribute) {
    try {
        const state = JSON.parse(element.getAttribute(attribute) || '');
        if (!state || typeof state !== 'object' || typeof state.applied !== 'string') return null;
        return {
            value: typeof state.value === 'string' ? state.value : '',
            priority: typeof state.priority === 'string' ? state.priority : '',
            applied: state.applied,
            appliedPriority: typeof state.appliedPriority === 'string' ? state.appliedPriority : '',
        };
    } catch (_) {
        return null;
    }
}

function clearOwnedProperty(element, definition) {
    if (!element.hasAttribute(definition.attribute)) return false;
    const state = readOwnedState(element, definition.attribute);
    if (state
        && element.style.getPropertyValue(definition.property) === state.applied
        && element.style.getPropertyPriority(definition.property) === state.appliedPriority) {
        if (state.value) element.style.setProperty(definition.property, state.value, state.priority);
        else element.style.removeProperty(definition.property);
    }
    element.removeAttribute(definition.attribute);
    return true;
}

function applyOwnedProperty(element, definition) {
    const currentValue = element.style.getPropertyValue(definition.property);
    const currentPriority = element.style.getPropertyPriority(definition.property);
    let state = readOwnedState(element, definition.attribute);

    if (!state || currentValue !== state.applied || currentPriority !== state.appliedPriority) {
        state = {
            value: currentValue,
            priority: currentPriority,
            applied: definition.value,
            appliedPriority: '',
        };
    }

    let changed = false;
    if (currentValue !== definition.value || currentPriority) {
        element.style.setProperty(definition.property, definition.value);
        changed = true;
    }
    const encodedState = JSON.stringify(state);
    if (element.getAttribute(definition.attribute) !== encodedState) {
        element.setAttribute(definition.attribute, encodedState);
        changed = true;
    }
    return changed;
}

export function clearTextStyle(element) {
    if (!element) return false;
    let changed = false;
    for (const definition of OWNED_PROPERTIES) {
        if (clearOwnedProperty(element, definition)) changed = true;
    }
    if (element.hasAttribute(TEXT_STYLE_MARKER_ATTRIBUTE)) {
        element.removeAttribute(TEXT_STYLE_MARKER_ATTRIBUTE);
        changed = true;
    }
    if (!element.getAttribute('style')) element.removeAttribute('style');
    return changed;
}

export function applyTextStyle(element, value) {
    const style = normalizeTextStyle(value);
    if (!element || !style) {
        return { applied: false, changed: clearTextStyle(element), style: '' };
    }

    let changed = false;
    for (const definition of OWNED_PROPERTIES) {
        const enabled = style.split(' ').includes(definition.value);
        if (enabled) changed = applyOwnedProperty(element, definition) || changed;
        else changed = clearOwnedProperty(element, definition) || changed;
    }
    if (element.getAttribute(TEXT_STYLE_MARKER_ATTRIBUTE) !== style) {
        element.setAttribute(TEXT_STYLE_MARKER_ATTRIBUTE, style);
        changed = true;
    }
    return { applied: true, changed, style };
}
