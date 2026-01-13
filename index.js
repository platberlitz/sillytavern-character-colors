(() => {
    'use strict';

    let characterColors = {};
    let settings = { colorThoughts: true };

    function generateColor(index) {
        const hue = (index * 137.508) % 360;
        return `hsl(${Math.round(hue)}, 75%, 65%)`;
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateColor(Object.keys(characterColors).length), displayName: name };
            saveData();
            updateCharacterList();
        }
        return characterColors[key].color;
    }

    function saveData() {
        localStorage.setItem('cc_colors', JSON.stringify(characterColors));
        localStorage.setItem('cc_settings', JSON.stringify(settings));
    }

    function loadData() {
        try {
            const c = localStorage.getItem('cc_colors');
            const s = localStorage.getItem('cc_settings');
            if (c) characterColors = JSON.parse(c);
            if (s) settings = { ...settings, ...JSON.parse(s) };
        } catch (e) {}
    }

    // Convert <color=Name>text</color> tags to colored spans
    function processColorTags(mesText) {
        if (mesText.dataset.ccProcessed) return;
        mesText.dataset.ccProcessed = '1';
        
        const html = mesText.innerHTML;
        // Match <color=CharacterName>dialogue</color>
        const newHtml = html.replace(/<color=([^>]+)>([^<]*)<\/color>/gi, (match, name, text) => {
            const color = getCharacterColor(name);
            return `<span class="cc-dialogue" style="color:${color}">${text}</span>`;
        });
        
        if (newHtml !== html) {
            mesText.innerHTML = newHtml;
        }
    }

    function processAll() {
        document.querySelectorAll('.mes_text:not([data-cc-processed])').forEach(processColorTags);
    }

    function reprocess() {
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccProcessed;
        });
        processAll();
    }

    function clearColors() {
        characterColors = {};
        saveData();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        const entries = Object.entries(characterColors);
        if (!entries.length) {
            list.innerHTML = '<small>No characters yet. Colors are assigned when the AI uses color tags.</small>';
            return;
        }
        
        list.innerHTML = entries.map(([k, v]) =>
            `<div class="cc-char-item">
                <span style="color:${v.color};font-weight:bold">${v.displayName}</span>
                <input type="color" value="${v.color.startsWith('hsl')?'#888888':v.color}" data-key="${k}">
            </div>`
        ).join('');
        
        list.querySelectorAll('input').forEach(i => {
            i.oninput = () => {
                characterColors[i.dataset.key].color = i.value;
                saveData();
                reprocess();
            };
        });
    }

    function getAuthorNoteText() {
        return `[System: Wrap all spoken dialogue in color tags using the format <color=CharacterName>dialogue here</color>. Use the character's name who is speaking. For inner thoughts, use <color=CharacterName>*thought here*</color>. Example: <color=John>"Hello!"</color> he said. <color=Mary>"Hi there,"</color> Mary replied. <color=John>*She seems nice.*</color>]`;
    }

    function copyAuthorNote() {
        navigator.clipboard.writeText(getAuthorNoteText()).then(() => {
            toastr?.success?.('Author\'s Note copied to clipboard!') || alert('Copied!');
        });
    }

    function getRegexScript() {
        return {
            scriptName: "Dialogue Color Tags",
            findRegex: "/<color=([^>]+)>([^<]*)<\\/color>/gi",
            replaceString: "{{match}}",
            trimStrings: ["<color=", "</color>"],
            placement: [1], // AI Response
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0
        };
    }

    function createUI() {
        if (document.getElementById('cc-ext')) return;
        
        const html = `
        <div id="cc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dialogue Colors</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:10px;">
                <div style="background:var(--SmartThemeBlurTintColor);padding:10px;border-radius:5px;font-size:0.85em;">
                    <b>Setup Instructions:</b><br>
                    1. Click "Copy Author's Note" below<br>
                    2. Paste it into your Author's Note (depth 4 recommended)<br>
                    3. The AI will add color tags to dialogue<br>
                    4. Colors appear automatically!
                </div>
                <button id="cc-copy-note" class="menu_button">📋 Copy Author's Note</button>
                <button id="cc-refresh" class="menu_button">🔄 Refresh Colors</button>
                <button id="cc-clear" class="menu_button">🗑️ Clear All Characters</button>
                <hr>
                <label style="font-weight:bold">Character Colors:</label>
                <div id="cc-char-list" style="max-height:150px;overflow-y:auto;"></div>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        document.getElementById('cc-copy-note').onclick = copyAuthorNote;
        document.getElementById('cc-refresh').onclick = reprocess;
        document.getElementById('cc-clear').onclick = clearColors;
        
        updateCharacterList();
    }

    function init() {
        loadData();
        
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                createUI();
            }
        }, 500);
        
        // Process color tags periodically (lightweight, no LLM calls)
        setInterval(processAll, 1000);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(processAll, 100));
            eventSource.on(event_types.CHAT_CHANGED, () => {
                characterColors = {};
                saveData();
                updateCharacterList();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
