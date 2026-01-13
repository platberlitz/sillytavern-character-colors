(() => {
    'use strict';

    const extensionName = 'character-colors';
    let characterColors = {};
    let settings = { colorThoughts: true };
    let isProcessing = false;

    function generateRandomColor() {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 80%, 65%)`;
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateRandomColor(), displayName: name };
            saveColors();
            updateCharacterList();
        }
        return characterColors[key].color;
    }

    function saveColors() {
        localStorage.setItem('cc_character_colors', JSON.stringify(characterColors));
    }

    function loadColors() {
        try {
            const saved = localStorage.getItem('cc_character_colors');
            if (saved) characterColors = JSON.parse(saved);
        } catch (e) {}
    }

    // Use SillyTavern's generateRaw to ask LLM for character names AND their dialogue
    async function extractCharactersWithLLM(text) {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            console.log('CC: SillyTavern context not available');
            return null;
        }

        const context = SillyTavern.getContext();
        if (!context.generateRaw) {
            console.log('CC: generateRaw not available');
            return null;
        }

        const prompt = `Analyze this roleplay text and identify which character speaks each piece of dialogue (in quotes).

Return a JSON object mapping each dialogue quote to the character who said it.
Format: {"dialogue text": "character name", ...}

Only include actual spoken dialogue in "quotes", not thoughts in 『』 or *asterisks*.

Text:
${text.substring(0, 2000)}

JSON:`;

        try {
            const response = await context.generateRaw(prompt, null, false, false, '', 200);
            console.log('CC: LLM response:', response);
            
            // Extract JSON object from response
            const match = response.match(/\{[\s\S]*?\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {
            console.log('CC: LLM extraction failed:', e);
        }
        
        return null;
    }

    // Fallback: simple pattern-based extraction
    function extractCharactersFallback(text) {
        const names = new Set();
        const patterns = [
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|whispered|replied|called|shouted|murmured|added|continued)/gi,
            /(?:said|asked|whispered|replied)\s+([A-Z][a-z]{2,})\b/gi,
            /\b([A-Z][a-z]{2,})'s\s+voice\b/gi,
        ];
        
        const exclude = ['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Just', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'God', 'Yes', 'Now', 'Good'];
        
        for (const p of patterns) {
            let m;
            while ((m = p.exec(text)) !== null) {
                if (m[1] && !exclude.includes(m[1])) names.add(m[1]);
            }
        }
        return [...names];
    }

    function applyColorsToElement(mesText, dialogueMap) {
        const walk = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walk.nextNode()) textNodes.push(walk.currentNode);

        // Get main character for thoughts
        const mesBlock = mesText.closest('.mes');
        let mainChar = null;
        if (mesBlock) {
            const nameEl = mesBlock.querySelector('.name_text');
            if (nameEl) mainChar = nameEl.textContent.trim();
        }

        for (const node of textNodes) {
            const nodeText = node.nodeValue;
            if (!nodeText.match(/[""]|『|\*/)) continue;

            const parts = nodeText.split(/("[^"]*"|"[^"]*"|『[^』]*』|\*[^\*]+\*)/g);
            if (parts.length <= 1) continue;

            const frag = document.createDocumentFragment();
            
            for (const part of parts) {
                if (!part) continue;
                
                const isQuote = /^[""][^""]*[""]$/.test(part);
                const isJpQuote = /^『[^』]*』$/.test(part);
                const isThought = /^\*[^\*]+\*$/.test(part);

                if (isQuote) {
                    // Find speaker from dialogueMap
                    const innerText = part.slice(1, -1);
                    let speaker = null;
                    
                    if (dialogueMap) {
                        // Look for matching dialogue in map
                        for (const [dialogue, char] of Object.entries(dialogueMap)) {
                            if (innerText.includes(dialogue.substring(0, 20)) || dialogue.includes(innerText.substring(0, 20))) {
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
                } else if ((isJpQuote || isThought) && settings.colorThoughts && mainChar) {
                    // Thoughts use main character (message sender) color
                    const color = getCharacterColor(mainChar);
                    const span = document.createElement('span');
                    span.className = 'cc-thought';
                    span.style.color = color;
                    span.style.opacity = '0.85';
                    span.textContent = part;
                    frag.appendChild(span);
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
            dialogueMap = await extractCharactersWithLLM(text);
            console.log('CC: LLM dialogue map:', dialogueMap);
        }
        
        if (!dialogueMap) {
            // Fallback: use pattern matching to build a simple map
            const characters = extractCharactersFallback(text);
            console.log('CC: Fallback found characters:', characters);
            if (characters.length) {
                dialogueMap = {};
                // Simple fallback: attribute all dialogue to first found character
                const quotes = text.match(/"[^"]+"|"[^"]+"/g) || [];
                quotes.forEach(q => dialogueMap[q.slice(1,-1)] = characters[0]);
            }
        }

        if (dialogueMap && Object.keys(dialogueMap).length) {
            applyColorsToElement(mesText, dialogueMap);
        }
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
        saveColors();
        reprocessAll();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        list.innerHTML = '';
        const entries = Object.entries(characterColors);
        
        if (!entries.length) {
            list.innerHTML = '<div style="color:#888;font-style:italic">No characters yet</div>';
            return;
        }
        
        for (const [key, data] of entries) {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0';
            div.innerHTML = `
                <span style="color:${data.color};font-weight:bold">${data.displayName}</span>
                <input type="color" value="${data.color.startsWith('hsl') ? '#888' : data.color}" data-key="${key}" style="width:30px;height:24px">
            `;
            list.appendChild(div);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(inp => {
            inp.oninput = () => {
                characterColors[inp.dataset.key].color = inp.value;
                saveColors();
                reprocessAll();
            };
        });
    }

    function createUI() {
        if (document.getElementById('cc-panel')) return;
        
        const html = `
        <div id="cc-panel" class="cc-settings" style="margin:10px 0;padding:10px;border:1px solid #444;border-radius:5px">
            <h4 style="margin:0 0 10px 0">Character Dialogue Colors</h4>
            <label style="display:block;margin:5px 0">
                <input type="checkbox" id="cc-thoughts" checked> Color thoughts
            </label>
            <div style="margin:10px 0">
                <button id="cc-clear" style="margin-right:5px">Clear</button>
                <button id="cc-refresh">Refresh (LLM)</button>
            </div>
            <div id="cc-char-list" style="max-height:150px;overflow-y:auto"></div>
        </div>`;
        
        const target = document.getElementById('extensions_settings');
        if (target) {
            target.insertAdjacentHTML('beforeend', html);
            document.getElementById('cc-clear').onclick = clearColors;
            document.getElementById('cc-refresh').onclick = () => reprocessAll();
            document.getElementById('cc-thoughts').onchange = (e) => {
                settings.colorThoughts = e.target.checked;
                reprocessAll();
            };
            updateCharacterList();
        }
    }

    function init() {
        console.log('CC: Character Dialogue Colors extension loaded');
        loadColors();

        // Wait for extensions panel
        const uiCheck = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(uiCheck);
                createUI();
            }
        }, 500);

        // Hook into SillyTavern events if available
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            console.log('CC: Hooking into SillyTavern events');
            
            // Process new messages
            eventSource.on(event_types.MESSAGE_RECEIVED, async (messageId) => {
                console.log('CC: MESSAGE_RECEIVED event', messageId);
                setTimeout(() => processAllMessages(true), 500);
            });
            
            // Clear on chat change
            eventSource.on(event_types.CHAT_CHANGED, () => {
                console.log('CC: CHAT_CHANGED event');
                characterColors = {};
                saveColors();
                updateCharacterList();
            });
        } else {
            console.log('CC: SillyTavern events not available, using polling');
        }

        // Fallback: periodic processing
        setInterval(() => processAllMessages(false), 2000);
        
        // Initial processing
        setTimeout(() => processAllMessages(false), 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
