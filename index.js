(() => {
    'use strict';

    let characterColors = {};
    let settings = { 
        colorThoughts: true,
        themeMode: 'auto' // 'auto', 'dark', 'light', 'custom'
    };
    let detectedThemeColor = null;

    function detectThemeColor() {
        // Try to detect the main theme color from SillyTavern
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        
        // Try various ST theme variables
        const themeColor = styles.getPropertyValue('--SmartThemeBodyColor') ||
                          styles.getPropertyValue('--ac-color') ||
                          styles.getPropertyValue('--mes-bg') ||
                          '#1a1a2e';
        
        detectedThemeColor = themeColor.trim();
        
        // Detect if dark or light
        const bg = getComputedStyle(document.body).backgroundColor;
        const rgb = bg.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function generateColor(index) {
        const mode = settings.themeMode === 'auto' ? detectThemeColor() : settings.themeMode;
        const isDark = mode === 'dark' || mode === 'auto';
        
        // Generate colors that work well with the theme
        const goldenRatio = 0.618033988749895;
        const hue = ((index * goldenRatio) % 1) * 360;
        const saturation = 70 + (index % 3) * 10;
        const lightness = isDark ? 60 + (index % 4) * 5 : 35 + (index % 4) * 5;
        
        return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            const index = Object.keys(characterColors).length;
            characterColors[key] = { 
                color: generateColor(index), 
                displayName: name 
            };
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
            const colors = localStorage.getItem('cc_colors');
            const saved = localStorage.getItem('cc_settings');
            if (colors) characterColors = JSON.parse(colors);
            if (saved) settings = { ...settings, ...JSON.parse(saved) };
        } catch (e) {}
    }

    async function extractDialogueMapWithLLM(text) {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return null;
        const context = SillyTavern.getContext();
        if (!context.generateRaw) return null;

        const prompt = `Analyze this roleplay text. For each piece of dialogue in "quotes", identify who said it.

Return JSON: {"dialogue text": "character name", ...}
Only include spoken dialogue in quotes, not thoughts.

Text:
${text.substring(0, 2000)}

JSON:`;

        try {
            const response = await context.generateRaw(prompt, null, false, false, '', 250);
            const match = response.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch (e) {
            console.log('CC: LLM failed:', e);
        }
        return null;
    }

    function applyColorsToElement(mesText, dialogueMap) {
        // Get main character for thoughts
        const mesBlock = mesText.closest('.mes');
        let mainChar = null;
        if (mesBlock) {
            const nameEl = mesBlock.querySelector('.name_text');
            if (nameEl) mainChar = nameEl.textContent.trim();
        }

        console.log('CC: Processing message, mainChar:', mainChar);

        // First pass: color Japanese quotes and asterisks (they might be in <em> tags)
        if (settings.colorThoughts && mainChar) {
            const color = getCharacterColor(mainChar);
            
            // Find all text containing 『』
            mesText.querySelectorAll('em, i').forEach(el => {
                if (el.textContent.includes('『') || el.textContent.includes('』')) {
                    console.log('CC: Found thought in em/i tag:', el.textContent);
                    el.style.color = color;
                    el.classList.add('cc-thought');
                }
            });
            
            // Also check direct text nodes for 『』
            const allText = mesText.innerHTML;
            if (allText.includes('『')) {
                console.log('CC: Found 『 in message');
                mesText.innerHTML = allText.replace(/(『[^』]*』)/g, `<span class="cc-thought" style="color:${color};opacity:0.8">$1</span>`);
            }
        }

        // Second pass: color dialogue quotes
        const walk = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walk.nextNode()) textNodes.push(walk.currentNode);

        for (const node of textNodes) {
            const nodeText = node.nodeValue;
            
            if (!/"/.test(nodeText) && !/"/.test(nodeText)) continue;

            const regex = /("[^"]*"|"[^"]*")/g;
            const parts = nodeText.split(regex);
            
            if (parts.length <= 1) continue;

            const frag = document.createDocumentFragment();
            
            for (const part of parts) {
                if (!part) continue;
                
                const isQuote = /^"[^"]*"$/.test(part) || /^"[^"]*"$/.test(part);

                if (isQuote) {
                    const innerText = part.slice(1, -1);
                    let speaker = null;
                    
                    if (dialogueMap) {
                        for (const [dialogue, char] of Object.entries(dialogueMap)) {
                            const d = dialogue.toLowerCase();
                            const i = innerText.toLowerCase();
                            if (i.includes(d.substring(0, 15)) || d.includes(i.substring(0, 15))) {
                                speaker = char;
                                break;
                            }
                        }
                    }
                    
                    if (speaker) {
                        const color = getCharacterColor(speaker);
                        const span = document.createElement('span');
                        span.className = 'cc-dialogue';
                        span.style.color = color;
                        span.textContent = part;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(part));
                    }
                } else {
                    frag.appendChild(document.createTextNode(part));
                }
            }
            
            node.parentNode.replaceChild(frag, node);
        }
    }

    async function processMessage(mesText, useLLM = false) {
        if (mesText.dataset.ccDone) return;
        mesText.dataset.ccDone = 'true';

        const text = mesText.textContent;
        if (!text || text.length < 20) return;

        let dialogueMap = null;
        
        if (useLLM) {
            dialogueMap = await extractDialogueMapWithLLM(text);
            console.log('CC: Dialogue map:', dialogueMap);
        }

        applyColorsToElement(mesText, dialogueMap);
    }

    function processAllMessages(useLLM = false) {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(el => {
            processMessage(el, useLLM);
        });
    }

    function reprocessAll() {
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccDone;
            el.querySelectorAll('.cc-dialogue, .cc-thought').forEach(span => {
                span.replaceWith(document.createTextNode(span.textContent));
            });
            el.normalize();
        });
        processAllMessages(true);
    }

    function clearColors() {
        characterColors = {};
        saveData();
        reprocessAll();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        list.innerHTML = '';
        const entries = Object.entries(characterColors);
        
        if (!entries.length) {
            list.innerHTML = '<small style="color:var(--SmartThemeEmColor)">No characters detected yet</small>';
            return;
        }
        
        for (const [key, data] of entries) {
            const div = document.createElement('div');
            div.className = 'cc-char-item';
            div.innerHTML = `
                <span class="cc-char-name" style="color:${data.color}">${data.displayName}</span>
                <input type="color" value="${data.color.startsWith('hsl') ? '#888888' : data.color}" data-key="${key}">
                <span class="cc-char-hex">${data.color}</span>
            `;
            list.appendChild(div);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(inp => {
            inp.oninput = () => {
                characterColors[inp.dataset.key].color = inp.value;
                saveData();
                reprocessAll();
            };
        });
    }

    function createUI() {
        if (document.getElementById('cc-extension')) return;
        
        const html = `
        <div id="cc-extension" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Character Dialogue Colors</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="cc-setting">
                    <label>Color Mode</label>
                    <select id="cc-theme-mode">
                        <option value="auto">Auto (detect theme)</option>
                        <option value="dark">Dark Mode</option>
                        <option value="light">Light Mode</option>
                    </select>
                </div>
                <div class="cc-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="cc-thoughts">
                        <span>Color inner thoughts (『』 and *asterisks*)</span>
                    </label>
                </div>
                <div class="cc-setting cc-buttons">
                    <input type="button" id="cc-refresh" class="menu_button" value="Refresh (LLM)">
                    <input type="button" id="cc-clear" class="menu_button" value="Clear All">
                </div>
                <hr>
                <div class="cc-setting">
                    <label>Detected Characters</label>
                    <div id="cc-char-list" class="cc-char-list"></div>
                </div>
            </div>
        </div>`;
        
        const target = document.getElementById('extensions_settings');
        if (target) {
            target.insertAdjacentHTML('beforeend', html);
            
            // Theme mode
            const themeSelect = document.getElementById('cc-theme-mode');
            themeSelect.value = settings.themeMode;
            themeSelect.onchange = (e) => {
                settings.themeMode = e.target.value;
                saveData();
            };
            
            // Thoughts checkbox
            const thoughtsCheck = document.getElementById('cc-thoughts');
            thoughtsCheck.checked = settings.colorThoughts;
            thoughtsCheck.onchange = (e) => {
                settings.colorThoughts = e.target.checked;
                saveData();
                reprocessAll();
            };
            
            // Buttons
            document.getElementById('cc-refresh').onclick = reprocessAll;
            document.getElementById('cc-clear').onclick = clearColors;
            
            updateCharacterList();
        }
    }

    function init() {
        console.log('CC: Character Dialogue Colors loaded');
        loadData();
        detectThemeColor();

        const uiCheck = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(uiCheck);
                createUI();
            }
        }, 500);

        // Hook into ST events
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                setTimeout(() => processAllMessages(true), 500);
            });
            eventSource.on(event_types.CHAT_CHANGED, () => {
                characterColors = {};
                saveData();
                updateCharacterList();
            });
        }

        setInterval(() => processAllMessages(false), 2000);
        setTimeout(() => processAllMessages(false), 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
