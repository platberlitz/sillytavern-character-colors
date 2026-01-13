(() => {
    'use strict';

    let characterColors = {};
    let settings = { 
        colorThoughts: true, 
        themeMode: 'auto',
        useCustomModel: false,
        customModel: '',
        autoRefresh: true
    };

    // Generate truly random color based on theme
    function generateRandomColor() {
        const hue = Math.random() * 360;
        const saturation = 65 + Math.random() * 20; // 65-85%
        
        let lightness;
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        if (mode === 'dark') {
            lightness = 60 + Math.random() * 15; // 60-75% for dark
        } else {
            lightness = 35 + Math.random() * 15; // 35-50% for light
        }
        
        return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    }

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const match = bg.match(/\d+/g);
        if (match) {
            const brightness = (parseInt(match[0]) * 299 + parseInt(match[1]) * 587 + parseInt(match[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateRandomColor(), displayName: name };
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

    async function extractDialogueMap(text) {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return null;
        const ctx = SillyTavern.getContext();
        
        // First, check if we can match all dialogue with known characters
        const knownNames = Object.values(characterColors).map(c => c.displayName);
        if (knownNames.length > 0) {
            const simpleMap = tryMatchWithKnownCharacters(text, knownNames);
            if (simpleMap) {
                console.log('CC: Using known characters, no LLM needed');
                return simpleMap;
            }
        }
        
        // Need LLM to identify new characters
        console.log('CC: Calling LLM to identify characters');
        const prompt = `Analyze this roleplay text. For each quoted dialogue, identify the speaker.
Return JSON mapping dialogue to speaker: {"quote text": "character name", ...}
Only include spoken dialogue in "quotes", not thoughts.

Text:
${text.substring(0, 2000)}

JSON:`;

        try {
            let resp;
            if (settings.useCustomModel && settings.customModel) {
                console.log('CC: Using custom model:', settings.customModel);
                resp = await callCustomModel(prompt);
            }
            
            if (!resp && ctx.generateRaw) {
                console.log('CC: Using default generateRaw');
                resp = await ctx.generateRaw(prompt, null, false, false, '', 500);
            }
            
            if (!resp) return null;
            
            console.log('CC: Response received, length:', resp.length);
            const match = resp.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch (e) {
            console.log('CC: LLM extraction failed:', e);
        }
        return null;
    }

    function tryMatchWithKnownCharacters(text, knownNames) {
        // Try to match dialogue with known characters using proximity
        const quotes = text.match(/"[^"]+"|"[^"]+"/g);
        if (!quotes) return null;
        
        const dialogueMap = {};
        let allMatched = true;
        
        for (const quote of quotes) {
            const inner = quote.slice(1, -1);
            const quoteIdx = text.indexOf(quote);
            const context = text.substring(Math.max(0, quoteIdx - 150), quoteIdx + quote.length + 150);
            
            let foundSpeaker = null;
            for (const name of knownNames) {
                // Check if name appears near this quote
                const nameRegex = new RegExp(`\\b${name}\\b`, 'i');
                if (nameRegex.test(context)) {
                    foundSpeaker = name;
                    break;
                }
            }
            
            if (foundSpeaker) {
                dialogueMap[inner] = foundSpeaker;
            } else {
                // Unknown speaker - need LLM
                allMatched = false;
                break;
            }
        }
        
        return allMatched ? dialogueMap : null;
    }

    async function callCustomModel(prompt) {
        // Use generateRaw but try to override model via SillyTavern's context
        try {
            const ctx = SillyTavern.getContext();
            
            // Check if we can use generateQuietPrompt with model override
            if (ctx.generateQuietPrompt) {
                console.log('CC: Trying generateQuietPrompt');
                const resp = await ctx.generateQuietPrompt(prompt, false, false, '', settings.customModel, 500);
                return resp;
            }
            
            // Try direct API call
            const response = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    model: settings.customModel,
                    max_tokens: 250,
                    temperature: 0
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('CC: Direct API response:', data);
                return data.choices?.[0]?.message?.content || data.content || '';
            }
            
            console.log('CC: Direct API failed, status:', response.status);
            return null;
        } catch (e) {
            console.log('CC: Custom model error:', e);
            return null;
        }
    }

    function applyColors(mesText, dialogueMap) {
        const mesBlock = mesText.closest('.mes');
        const mainChar = mesBlock?.querySelector('.name_text')?.textContent?.trim();

        // Color thoughts in em/i tags
        if (settings.colorThoughts && mainChar) {
            const color = getCharacterColor(mainChar);
            mesText.querySelectorAll('em, i').forEach(el => {
                if (!el.dataset.ccDone) {
                    el.style.color = color;
                    el.style.opacity = '0.85';
                    el.dataset.ccDone = '1';
                }
            });
        }

        if (!dialogueMap || Object.keys(dialogueMap).length === 0) return;

        const walk = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);

        for (const node of nodes) {
            const text = node.nodeValue;
            if (!/"/.test(text) && !/"/.test(text)) continue;

            const parts = text.split(/("[^"]+"|"[^"]+")/g);
            if (parts.length <= 1) continue;

            const frag = document.createDocumentFragment();
            for (const part of parts) {
                if (!part) continue;
                if (/^[""][^""]+[""]$/.test(part)) {
                    const inner = part.slice(1, -1);
                    const innerLower = inner.toLowerCase();
                    let speaker = null;
                    
                    // Try exact match first
                    for (const [d, c] of Object.entries(dialogueMap)) {
                        if (d.toLowerCase() === innerLower) {
                            speaker = c;
                            break;
                        }
                    }
                    
                    // Try partial match
                    if (!speaker) {
                        for (const [d, c] of Object.entries(dialogueMap)) {
                            const dl = d.toLowerCase();
                            // Match if either contains a significant portion of the other
                            if (innerLower.length > 10 && (innerLower.includes(dl.substring(0, 20)) || dl.includes(innerLower.substring(0, 20)))) {
                                speaker = c;
                                break;
                            } else if (innerLower.length <= 10 && (innerLower.includes(dl) || dl.includes(innerLower))) {
                                speaker = c;
                                break;
                            }
                        }
                    }
                    
                    if (speaker) {
                        const span = document.createElement('span');
                        span.className = 'cc-dialogue';
                        span.style.color = getCharacterColor(speaker);
                        span.textContent = part;
                        frag.appendChild(span);
                        continue;
                    }
                }
                frag.appendChild(document.createTextNode(part));
            }
            node.parentNode.replaceChild(frag, node);
        }
    }

    async function processMessage(el, useLLM) {
        if (el.dataset.ccLlmDone && useLLM) return;
        if (el.dataset.ccProcessed && !useLLM) return;
        
        el.dataset.ccProcessed = '1';
        
        const text = el.textContent;
        if (!text || text.length < 20) return;
        
        const map = useLLM ? await extractDialogueMap(text) : null;
        if (useLLM && map) el.dataset.ccLlmDone = '1';
        
        applyColors(el, map);
    }

    function processAll(useLLM = false) {
        document.querySelectorAll('.mes_text').forEach(el => {
            if (useLLM && !el.dataset.ccLlmDone) {
                processMessage(el, true);
            } else if (!useLLM && !el.dataset.ccProcessed) {
                processMessage(el, false);
            }
        });
    }

    async function reprocess() {
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccProcessed;
            delete el.dataset.ccLlmDone;
            el.querySelectorAll('[data-cc-done]').forEach(e => { e.style.color = ''; e.style.opacity = ''; delete e.dataset.ccDone; });
            el.querySelectorAll('.cc-dialogue').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
        });
        for (const el of document.querySelectorAll('.mes_text')) {
            await processMessage(el, true);
        }
    }

    function clearColors() {
        characterColors = {};
        saveData();
        reprocess();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        const entries = Object.entries(characterColors);
        list.innerHTML = entries.length ? entries.map(([k, v]) =>
            `<div class="cc-char-item"><span style="color:${v.color};font-weight:bold">${v.displayName}</span><input type="color" value="${v.color.startsWith('hsl')?'#888':v.color}" data-key="${k}"></div>`
        ).join('') : '<small>No characters yet</small>';
        
        list.querySelectorAll('input').forEach(i => {
            i.oninput = () => { characterColors[i.dataset.key].color = i.value; saveData(); reprocess(); };
        });
    }

    function addInputButton() {
        if (document.getElementById('cc-input-btn')) return;
        
        // Find the right side area with hamburger/wand buttons
        const rightArea = document.getElementById('rightSendForm') || document.querySelector('#send_form .right_menu_buttons');
        
        if (!rightArea) return;
        
        const btn = document.createElement('div');
        btn.id = 'cc-input-btn';
        btn.className = 'fa-solid fa-droplet interactable';
        btn.title = 'Refresh Dialogue Colors';
        btn.style.cssText = 'cursor:pointer;padding:5px;font-size:1.2em;opacity:0.7;';
        btn.onclick = () => {
            btn.style.opacity = '0.3';
            reprocess().then(() => {
                btn.style.opacity = '0.7';
                toastr?.success?.('Dialogue colors refreshed!');
            });
        };
        
        // Insert at the beginning of right area
        rightArea.insertBefore(btn, rightArea.firstChild);
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
                <div class="cc-row">
                    <label>Theme Mode</label>
                    <select id="cc-theme">
                        <option value="auto">Auto</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                    </select>
                </div>
                <label class="checkbox_label"><input type="checkbox" id="cc-thoughts"><span>Color thoughts (『』/*text*)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="cc-auto-refresh"><span>Auto-refresh after generation</span></label>
                <hr>
                <label class="checkbox_label"><input type="checkbox" id="cc-custom-model"><span>Use custom model for detection</span></label>
                <div id="cc-model-row" style="display:none;">
                    <input type="text" id="cc-model-name" placeholder="Model name (e.g. gpt-4o-mini)" style="width:100%;padding:5px;">
                </div>
                <hr>
                <div style="display:flex;gap:5px;">
                    <button id="cc-refresh" class="menu_button" style="flex:1">🔄 Refresh</button>
                    <button id="cc-clear" class="menu_button">Clear</button>
                </div>
                <small>Characters:</small>
                <div id="cc-char-list" style="max-height:100px;overflow-y:auto;"></div>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        // Theme
        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.themeMode;
        themeSelect.onchange = e => { settings.themeMode = e.target.value; saveData(); };
        
        // Thoughts
        const thoughtsCheck = document.getElementById('cc-thoughts');
        thoughtsCheck.checked = settings.colorThoughts;
        thoughtsCheck.onchange = e => { settings.colorThoughts = e.target.checked; saveData(); reprocess(); };
        
        // Auto-refresh
        const autoRefreshCheck = document.getElementById('cc-auto-refresh');
        autoRefreshCheck.checked = settings.autoRefresh;
        autoRefreshCheck.onchange = e => { settings.autoRefresh = e.target.checked; saveData(); };
        
        // Custom model
        const customCheck = document.getElementById('cc-custom-model');
        const modelRow = document.getElementById('cc-model-row');
        const modelInput = document.getElementById('cc-model-name');
        
        customCheck.checked = settings.useCustomModel;
        modelInput.value = settings.customModel || '';
        modelRow.style.display = settings.useCustomModel ? 'block' : 'none';
        
        customCheck.onchange = e => {
            settings.useCustomModel = e.target.checked;
            modelRow.style.display = e.target.checked ? 'block' : 'none';
            saveData();
        };
        modelInput.onchange = e => { settings.customModel = e.target.value; saveData(); };
        
        // Buttons
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
        
        // Add input button
        const btnWait = setInterval(() => {
            if (document.getElementById('send_form') || document.getElementById('form_sheld')) {
                clearInterval(btnWait);
                addInputButton();
            }
        }, 500);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            // Try multiple event types for generation end
            const genEndEvents = [
                event_types.GENERATION_ENDED,
                event_types.GENERATION_STOPPED,
                event_types.MESSAGE_RECEIVED,
                event_types.MESSAGE_SENT
            ].filter(Boolean);
            
            console.log('CC: Available generation events:', genEndEvents);
            
            // Use MESSAGE_RECEIVED as it's most reliable
            eventSource.on(event_types.MESSAGE_RECEIVED, (msgId) => {
                if (settings.autoRefresh) {
                    console.log('CC: MESSAGE_RECEIVED, auto-refresh triggered');
                    const btn = document.getElementById('cc-input-btn');
                    if (btn) btn.style.color = 'orange';
                    
                    setTimeout(() => {
                        processAll(true);
                        if (btn) btn.style.color = '';
                    }, 1500);
                    setTimeout(() => processAll(true), 3000);
                    setTimeout(() => processAll(true), 5000);
                }
            });
            
            eventSource.on(event_types.CHAT_CHANGED, () => { 
                console.log('CC: Chat changed, clearing colors');
                characterColors = {}; 
                saveData(); 
                updateCharacterList();
                document.querySelectorAll('.mes_text').forEach(el => {
                    delete el.dataset.ccProcessed;
                    delete el.dataset.ccLlmDone;
                });
            });
            console.log('CC: Event listeners registered');
        } else {
            console.log('CC: eventSource not available');
        }
        
        setInterval(() => processAll(false), 2000);
        setTimeout(() => processAll(false), 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
