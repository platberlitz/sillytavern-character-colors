(async () => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
    const REGEX_SCRIPT_NAME = 'Strip Font Color Tags';
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

    async function ensureRegexScriptInstalled() {
        try {
            const regexData = await (await fetch(chrome?.runtime?.getURL('regex-script.json') || 'regex-script.json')).json();
            
            if (typeof extension_settings !== 'undefined' && Array.isArray(extension_settings.regex)) {
                const exists = extension_settings.regex.some(r => r.scriptName === REGEX_SCRIPT_NAME);
                
                if (!exists) {
                    const generateUUID = () => {
                        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                            return crypto.randomUUID();
                        }
                        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                            const r = Math.random() * 16 | 0;
                            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                        });
                    };
                    
                    const newRegexScript = {
                        id: generateUUID(),
                        scriptName: REGEX_SCRIPT_NAME,
                        findRegex: regexData.findRegex,
                        replaceString: regexData.replaceString,
                        trimStrings: regexData.trimStrings || [],
                        placement: regexData.placement || [2],
                        disabled: regexData.disabled || false,
                        markdownOnly: regexData.markdownOnly || false,
                        promptOnly: regexData.promptOnly || true,
                        runOnEdit: regexData.runOnEdit || false,
                        substituteRegex: regexData.substituteRegex || false,
                        minDepth: regexData.minDepth || null,
                        maxDepth: regexData.maxDepth || null
                    };
                    
                    extension_settings.regex.push(newRegexScript);
                    saveSettingsDebounced();
                    console.log('Dialogue Colors: Regex script auto-installed');
                }
            }
        } catch (e) {
            console.warn('Dialogue Colors: Could not auto-install regex script', e);
        }
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' 
            ? 'Use light pastel colors (#RRGGBB with high lightness).' 
            : 'Use dark muted colors (#RRGGBB with low lightness).';
        
        const colorList = Object.entries(characterColors).length > 0
            ? `Use these colors: ${Object.entries(characterColors).map(([k, v]) => `${v.name}=${v.color}`).join(', ')}. `
            : '';
        
        return `<font color rule: Wrap ALL dialogue ("text") and thoughts (*text*) in <font color=#RRGGBB> tags. ${themeHint} ${colorList}Keep the SAME color for each character. Use novel-style narrative format (e.g., "<font color=#abc123>Hello,</font> John said). Do NOT use "Name:" format before dialogue.`;
    }

    function injectPrompt() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            console.log('CC: SillyTavern not available');
            return;
        }
        const ctx = SillyTavern.getContext();
        if (!ctx.setExtensionPrompt) {
            console.log('CC: setExtensionPrompt not available');
            return;
        }

        const prompt = settings.enabled ? buildPromptInstruction() : '';
        console.log('CC: Injecting prompt:', prompt);
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 0, false, 0);
        updatePromptPreview(prompt);
    }

    function updatePromptPreview(prompt) {
        const preview = document.getElementById('cc-prompt-preview');
        if (preview) {
            preview.textContent = prompt || '(disabled)';
        }
    }

    function detectSpeakerFromText(text, tagStart, tagEnd) {
        const maxLookback = 200;
        const maxLookahead = 200;
        
        const beforeTag = text.substring(Math.max(0, tagStart - maxLookback), tagStart);
        const afterTag = text.substring(tagEnd, Math.min(text.length, tagEnd + maxLookahead));
        
        const afterPatterns = [
            /,\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(said|says|replied|replies|answered|asked|asked|whispered|whispers|yelled|yells|shouted|exclaimed|exclaims|added|murmured|murmured|muttered|mutters)\s*[,.]?\s*$/i
        ];
        
        for (const pattern of afterPatterns) {
            const matches = [...afterTag.matchAll(new RegExp(pattern.source, pattern.flags || 'i'))];
            if (matches.length > 0) {
                const firstMatch = matches[0];
                return firstMatch[1];
            }
        }
        
        return null;
    }
 
    function scanMessagesForColors() {
        document.querySelectorAll('.mes').forEach(mesBlock => {
            const mesText = mesBlock.querySelector('.mes_text');
            if (!mesText) return;
            
            const html = mesText.innerHTML;
            const fontRegex = /<font\s+color="#([a-fA-F0-9]{6})"[^>]*>/g;
            let match;
            
            while ((match = fontRegex.exec(html)) !== null) {
                const color = match[1];
                const tagStart = match.index;
                const tagEnd = tagStart + match[0].length;
                const speaker = detectSpeakerFromText(html, tagStart, tagEnd);
                
                if (speaker) {
                    const key = speaker.toLowerCase();
                    if (!characterColors[key]) {
                        characterColors[key] = { 
                            color: color, 
                            name: speaker 
                        };
                        updateCharList();
                    } else if (characterColors[key].color !== color) {
                        characterColors[key].color = color;
                        updateCharList();
                    }
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

    function hookSendButton() {
        const observer = new MutationObserver(() => {
            const sendBtn = document.getElementById('send_but') || document.querySelector('#send_form button[type="submit"]');
            if (sendBtn && !sendBtn.dataset.ccHooked) {
                sendBtn.dataset.ccHooked = 'true';
                sendBtn.addEventListener('click', () => {
                    console.log('CC: Send button clicked, injecting prompt');
                    injectPrompt();
                }, { capture: true });
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
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
                    <button id="cc-refresh" class="menu_button" style="flex:1">Re-inject</button>
                </div>
                <small>Characters (per chat):</small>
                <div id="cc-char-list" style="max-height:100px;overflow-y:auto;"></div>
                <hr>
                <small>Current prompt preview:</small>
                <div id="cc-prompt-preview" style="font-size:0.8em;color:var(--SmartThemeBodyColor);max-height:100px;overflow-y:auto;padding:5px;background:var(--SmartThemeBlurTintColor);border-radius:4px;"></div>
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
        updatePromptPreview(buildPromptInstruction());
        
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

        document.getElementById('cc-refresh').onclick = () => {
            injectPrompt();
            toastr?.info?.('Prompt re-injected!');
        };
        
        updateCharList();
    }

    function init() {
        currentChatId = getChatId();
        loadData();
        ensureRegexScriptInstalled();
        
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
                hookSendButton();
            }
        }, 500);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                console.log('CC: GENERATION_STARTED event');
                injectPrompt();
            });
            
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
                console.log('CC: GENERATE_BEFORE_COMBINE_PROMPTS event');
                injectPrompt();
            });
            
            if (event_types.GENERATE_AFTER_INJECT) {
                eventSource.on(event_types.GENERATE_AFTER_INJECT, () => {
                    console.log('CC: GENERATE_AFTER_INJECT event');
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
            
            eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
                if (settings.enabled) setTimeout(applyDisplayColors, 300);
            });
        }
        
        setInterval(() => {
            if (settings.enabled) applyDisplayColors();
        }, 3000);
        
        setInterval(() => {
            if (settings.enabled && typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                injectPrompt();
            }
        }, 5000);
    }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
