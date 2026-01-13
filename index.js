(() => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let currentChatId = null;
    let settings = { 
        enabled: true,
        colorThoughts: true,
        themeMode: 'auto'
    };

    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+/g);
        if (m) {
            const brightness = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getStorageKey() {
        return `cc_${currentChatId}`;
    }

    function saveData() {
        if (currentChatId) {
            localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors }));
        }
    }

    function loadData() {
        if (currentChatId) {
            try {
                const data = JSON.parse(localStorage.getItem(getStorageKey()));
                if (data?.colors) {
                    characterColors = data.colors;
                }
            } catch (e) {}
        }
    }

    function getChatId() {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            return ctx.chatId || ctx.chatID || null;
        }
        return null;
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' 
            ? 'Use LIGHT/PASTEL colors (high lightness 60-75%) for dark background.' 
            : 'Use DARK/MUTED colors (low lightness 30-45%) for light background.';
        
        const colorList = Object.entries(characterColors).length > 0
            ? `Established character colors: ${Object.entries(characterColors).map(([k, v]) => `${v.name}: ${v.color}`).join(', ')}. `
            : '';
        
        return `[IMPORTANT: Wrap all character dialogue ("speech") and inner thoughts (*thoughts*) in <font color=#RRGGBB> tags. ${themeHint}
${colorList}
Assign a UNIQUE color to each named character/speaker. When a character speaks, ALWAYS use the same color for them. 
REUSE existing colors for established characters. Only generate NEW colors for characters not in the established list.
Format: <font color=#abc123>"Dialogue here"</font> <font color=#def456>*Thought here*</font>
The color should be a hex code like #RRGGBB (6 characters). Each character must have their own consistent color.]`;
    }

    function injectPrompt() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            return;
        }
        const ctx = SillyTavern.getContext();
        if (!ctx.setExtensionPrompt) {
            return;
        }

        const prompt = settings.enabled ? buildPromptInstruction() : '';
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 0, false, 0);
    }

    function extractColorsFromHTML(html) {
        const colorRegex = /<font\s+color="#([a-fA-F0-9]{6})"[^>]*>/g;
        const colors = [];
        let match;
        while ((match = colorRegex.exec(html)) !== null) {
            if (!colors.includes(match[1])) {
                colors.push(match[1]);
            }
        }
        return colors;
    }

    function detectCharacterFromContext(mesBlock, color) {
        const nameEl = mesBlock.querySelector('.name_text');
        if (nameEl) {
            return nameEl.textContent.trim();
        }
        return null;
    }

    function scanMessagesForColors() {
        document.querySelectorAll('.mes').forEach(mesBlock => {
            const mesText = mesBlock.querySelector('.mes_text');
            if (!mesText) return;
            
            const colors = extractColorsFromHTML(mesText.innerHTML);
            const charName = mesBlock.querySelector('.name_text')?.textContent?.trim();
            
            if (charName && colors.length > 0) {
                const key = charName.toLowerCase();
                if (!characterColors[key]) {
                    characterColors[key] = { 
                        color: colors[0], 
                        name: charName 
                    };
                    updateCharList();
                }
            }
        });
        
        saveData();
    }

    function updateCharList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        const entries = Object.entries(characterColors);
        list.innerHTML = entries.length ? entries.map(([k, v]) =>
            `<div class="cc-char-item" style="display:flex;align-items:center;gap:5px;margin:2px 0;">
                <input type="color" value="${v.color}" data-key="${k}" style="width:24px;height:24px;padding:0;border:none;">
                <span style="color:${v.color};font-weight:bold;flex:1">${v.name}</span>
                <button class="cc-del menu_button" data-key="${k}" style="padding:2px 6px;font-size:0.8em;">×</button>
            </div>`
        ).join('') : '<small>No characters yet</small>';
        
        list.querySelectorAll('input[type="color"]').forEach(i => {
            i.oninput = () => { 
                characterColors[i.dataset.key].color = i.value; 
                i.nextElementSibling.style.color = i.value;
                saveData();
                injectPrompt();
            };
        });
        
        list.querySelectorAll('.cc-del').forEach(btn => {
            btn.onclick = () => {
                delete characterColors[btn.dataset.key];
                saveData();
                injectPrompt();
                updateCharList();
            };
        });
    }

    function addInputButton() {
        if (document.getElementById('cc-input-btn')) return;
        const rightArea = document.getElementById('rightSendForm') || document.querySelector('#send_form .right_menu_buttons');
        if (!rightArea) return;
        
        const btn = document.createElement('div');
        btn.id = 'cc-input-btn';
        btn.className = 'fa-solid fa-droplet interactable';
        btn.title = 'Scan Messages for Colors';
        btn.style.cssText = 'cursor:pointer;padding:5px;font-size:1.2em;opacity:0.7;';
        btn.onclick = () => {
            scanMessagesForColors();
            injectPrompt();
            toastr?.success?.('Colors scanned and prompt updated!');
        };
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
                <label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>Enable color injection</span></label>
                <div class="cc-row">
                    <label>Theme Mode</label>
                    <select id="cc-theme">
                        <option value="auto">Auto</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                    </select>
                </div>
                <label class="checkbox_label"><input type="checkbox" id="cc-thoughts"><span>Color thoughts (*text*)</span></label>
                <hr>
                <div style="display:flex;gap:5px;">
                    <button id="cc-clear" class="menu_button" style="flex:1">Clear Colors</button>
                    <button id="cc-scan" class="menu_button" style="flex:1">Scan</button>
                </div>
                <small>Characters (per chat):</small>
                <div id="cc-char-list" style="max-height:100px;overflow-y:auto;"></div>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        const enabledCheck = document.getElementById('cc-enabled');
        enabledCheck.checked = settings.enabled;
        enabledCheck.onchange = e => { 
            settings.enabled = e.target.checked; 
            saveData();
            injectPrompt();
        };
        
        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.themeMode;
        themeSelect.onchange = e => { 
            settings.themeMode = e.target.value; 
            saveData();
            injectPrompt();
        };
        
        const thoughtsCheck = document.getElementById('cc-thoughts');
        thoughtsCheck.checked = settings.colorThoughts;
        thoughtsCheck.onchange = e => { 
            settings.colorThoughts = e.target.checked; 
            saveData();
        };
        
        document.getElementById('cc-clear').onclick = () => {
            characterColors = {};
            saveData();
            injectPrompt();
            updateCharList();
        };
        
        document.getElementById('cc-scan').onclick = () => {
            scanMessagesForColors();
            injectPrompt();
        };
        
        updateCharList();
    }

    function init() {
        currentChatId = getChatId();
        loadData();
        
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                createUI();
                setTimeout(injectPrompt, 500);
            }
        }, 500);
        
        const btnWait = setInterval(() => {
            if (document.getElementById('send_form')) {
                clearInterval(btnWait);
                addInputButton();
            }
        }, 500);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                injectPrompt();
            });
            
            if (event_types.GENERATE_BEFORE_COMBINE_PROMPTS) {
                eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
                    injectPrompt();
                });
            }
            
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                setTimeout(scanMessagesForColors, 500);
            });
            
            eventSource.on(event_types.CHAT_CHANGED, () => {
                currentChatId = getChatId();
                characterColors = {};
                loadData();
                updateCharList();
                setTimeout(injectPrompt, 500);
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
