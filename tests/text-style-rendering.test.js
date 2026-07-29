import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTextStyle, clearTextStyle } from '../src/text-style-rendering.js';
import { settings } from '../src/state.js';

// The applier only needs setProperty/getPropertyValue plus attribute access, so a
// stub keeps these tests free of a DOM implementation.
function createElement() {
    const attributes = new Map();
    const properties = new Map();
    return {
        attributes,
        style: {
            setProperty(name, value) { properties.set(name, value); },
            removeProperty(name) { properties.delete(name); },
            getPropertyValue(name) { return properties.get(name) || ''; },
            getPropertyPriority() { return ''; },
        },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        hasAttribute(name) { return attributes.has(name); },
        weight() { return properties.get('font-weight') || ''; },
        fontStyle() { return properties.get('font-style') || ''; },
    };
}

test.afterEach(() => { settings.forceBoldText = false; });

test('per-character styles are unchanged while the bold override is off', () => {
    settings.forceBoldText = false;
    assert.equal(applyTextStyle(createElement(), '').style, '');
    assert.equal(applyTextStyle(createElement(), 'italic').style, 'italic');
    assert.equal(applyTextStyle(createElement(), 'bold').style, 'bold');
    assert.equal(applyTextStyle(createElement(), 'bold italic').style, 'bold italic');
});

test('the bold override bolds unstyled text and keeps italic', () => {
    settings.forceBoldText = true;
    assert.equal(applyTextStyle(createElement(), '').style, 'bold');
    assert.equal(applyTextStyle(createElement(), 'bold').style, 'bold');
    assert.equal(applyTextStyle(createElement(), 'italic').style, 'bold italic');
    assert.equal(applyTextStyle(createElement(), 'bold italic').style, 'bold italic');
});

test('the override reads the style off an entry as well as a raw string', () => {
    settings.forceBoldText = true;
    assert.equal(applyTextStyle(createElement(), { style: 'italic' }).style, 'bold italic');
    assert.equal(applyTextStyle(createElement(), { style: 'nonsense' }).style, 'bold');
});

test('turning the override off restores the weight it replaced', () => {
    const element = createElement();
    element.style.setProperty('font-weight', '300');

    settings.forceBoldText = true;
    applyTextStyle(element, '');
    assert.equal(element.weight(), 'bold');

    settings.forceBoldText = false;
    applyTextStyle(element, '');
    assert.equal(element.weight(), '300');
    assert.equal(element.getAttribute('data-dc-text-style'), null);
});

test('the override never leaves an italic the character did not ask for', () => {
    const element = createElement();
    settings.forceBoldText = true;
    applyTextStyle(element, 'italic');
    assert.equal(element.fontStyle(), 'italic');
    applyTextStyle(element, 'bold');
    assert.equal(element.fontStyle(), '');
    assert.equal(element.weight(), 'bold');
    clearTextStyle(element);
    assert.equal(element.weight(), '');
});
