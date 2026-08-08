import assert from 'node:assert/strict';
import test from 'node:test';

import { getNarratorVisual, normalizeNarratorStyle } from '../src/narrator-style.js';

test('narrator normalization and visual derivation preserve supported typography', () => {
    const style = normalizeNarratorStyle({
        enabled: true,
        baseColor: '#123456',
        font: '  Noto   Serif  ',
        style: 'bold italic',
    });
    const visual = getNarratorVisual({ narratorStyle: style });

    assert.equal(style.font, 'Noto Serif');
    assert.equal(style.style, 'bold italic');
    assert.equal(visual.font, 'Noto Serif');
    assert.equal(visual.style, 'bold italic');
});

test('unsupported narrator typography is rejected without discarding valid fields', () => {
    const style = normalizeNarratorStyle({
        enabled: true,
        baseColor: '#abcdef',
        font: '<script>Mono</script>',
        style: 'blinking',
    });

    assert.equal(style.font, 'scriptMonoscript');
    assert.equal(style.style, '');
    assert.equal(style.baseColor, '#abcdef');
});
