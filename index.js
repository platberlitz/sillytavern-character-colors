(() => {
    'use strict';

    let characterColors = {};

    function generateColor(index) {
        const hue = (index * 137.508) % 360;
        const rgb = hslToRgb(hue / 360, 0.75, 0.65);
        return '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [r * 255, g * 255, b * 255];
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateColor(Object.keys(characterColors).length), displayName: name };
            saveData();
            updateCharacterList();
            updateAuthorNote();
        }
        return characterColors[key].color;
    }

    function saveData() {
        localStorage.setItem('cc_colors', JSON.stringify(characterColors));
    }

    function loadData() {
        try {
            const c = localStorage.getItem('cc_colors');
            if (c) characterColors = JSON.parse(c);
        } catch (e) {}
    }

    // Build the instruction for Author's Note
    function buildColorInstruction() {
        const chars = Object.entries(characterColors);
        if (chars.length === 0) {
            return `[Use <font color=#HEX>"dialogue"</font> tags for all spoken dialogue and *inner thoughts*. Assign each character a consistent color.]`;
        }
        
        const colorList = chars.map(([k, v]) => `${v.displayName}: ${v.color}`).join(', ');
        return `[Wrap ALL dialogue and *thoughts* in font color tags. Character colors: ${colorList}. Format: <font color=#HEX>"dialogue"</font> or <font color=#HEX>*thought*</font>. New characters get new colors.]`;
    }

    // Update Author's Note automatically
    function updateAuthorNote() {
        const instruction = buildColorInstruction();
        
        // Try to update via SillyTavern context
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            // Store in extension prompt that gets injected
            if (ctx.setExtensionPrompt) {
                ctx.setExtensionPrompt('dialogue_colors', instruction, 1, 4); // position 1, depth 4
            }
        }
        
        // Update display
        const noteDisplay = document.getElementById('cc-note-preview');
        if (noteDisplay) noteDisplay.textContent = instruction;
    }

    // Process <font color=#hex>text</font> tags
    function processColorTags(mesText) {
        if (mesText.dataset.ccProcessed) return;
        mesText.dataset.ccProcessed = '1';
        
        const html = mesText.innerHTML;
        
        // Match <font color=#HEX> or <font color=HEX> or <font color="HEX">
        const newHtml = html.replace(/<font\s+color=["']?(#?[0-9A-Fa-f]{6})["']?>([^<]*)<\/font>/gi, (match, color, text) => {
            const hexColor = color.startsWith('#') ? color : '#' + color;
            
            // Try to find/register character from context
            const mesBlock = mesText.closest('.mes');
            const charName = mesBlock?.querySelector('.name_text')?.textContent?.trim();
            if (charName && !characterColors[charName.toLowerCase()]) {
                characterColors[charName.toLowerCase()] = { color: hexColor, displayName: charName };
                saveData();
                updateCharacterList();
            }
            
            return `<span class="cc-dialogue" style="color:${hexColor}">${text}</span>`;
        });
        
        if (newHtml !== html) {
            mesText.innerHTML = newHtml;
        }
    }

    function processAll() {
        document.querySelectorAll('.mes_text:not([data-cc-processed])').forEach(processColorTags);
    }

    function reprocess() {
        document.querySelectorAll('.mes_text').forEach(el => delete el.dataset.ccProcessed);
        processAll();
    }

    function clearColors() {
        characterColors = {};
        saveData();
        updateCharacterList();
        updateAuthorNote();
    }

    function addCharacter() {
        const name = prompt('Character name:');
        if (name) {
            getCharacterColor(name);
        }
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        const entries = Object.entries(characterColors);
        if (!entries.length) {
            list.innerHTML = '<small>No characters yet. Add them below or let the AI create them.</small>';
            return;
        }
        
        list.innerHTML = entries.map(([k, v]) =>
            `<div class="cc-char-item">
                <span style="color:${v.color};font-weight:bold">${v.displayName}</span>
                <input type="color" value="${v.color}" data-key="${k}">
                <button data-key="${k}" class="cc-del menu_button">×</button>
            </div>`
        ).join('');
        
        list.querySelectorAll('input[type="color"]').forEach(i => {
            i.oninput = () => {
                characterColors[i.dataset.key].color = i.value.toUpperCase();
                saveData();
                updateAuthorNote();
                reprocess();
            };
        });
        
        list.querySelectorAll('.cc-del').forEach(b => {
            b.onclick = () => {
                delete characterColors[b.dataset.key];
                saveData();
                updateCharacterList();
                updateAuthorNote();
            };
        });
    }

    function createUI() {
        if (document.getElementById('cc-ext')) return;
        
        const html = `
        <div id="cc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dialogue Colors</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:8px;">
                <small>Characters & their colors (auto-injected into prompt):</small>
                <div id="cc-char-list" style="max-height:120px;overflow-y:auto;"></div>
                <div style="display:flex;gap:5px;">
                    <button id="cc-add" class="menu_button" style="flex:1">+ Add Character</button>
                    <button id="cc-clear" class="menu_button">Clear All</button>
                </div>
                <hr>
                <small>Current instruction (auto-injected at depth 4):</small>
                <div id="cc-note-preview" style="font-size:0.8em;background:var(--SmartThemeBlurTintColor);padding:8px;border-radius:4px;max-height:60px;overflow-y:auto;"></div>
                <button id="cc-refresh" class="menu_button">🔄 Refresh Display</button>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        document.getElementById('cc-add').onclick = addCharacter;
        document.getElementById('cc-clear').onclick = clearColors;
        document.getElementById('cc-refresh').onclick = reprocess;
        
        updateCharacterList();
        updateAuthorNote();
    }

    function init() {
        loadData();
        
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                createUI();
                updateAuthorNote();
            }
        }, 500);
        
        setInterval(processAll, 1000);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(processAll, 100));
            eventSource.on(event_types.CHAT_CHANGED, () => {
                setTimeout(updateAuthorNote, 500);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
