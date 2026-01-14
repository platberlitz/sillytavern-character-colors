(() => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let currentChatId = null;
    let settings = { enabled: true, themeMode: 'auto' };
    let isEstablished = false;

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+/g);
        if (m) {
            const brightness = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getStorageKey() { return `cc_${currentChatId}`; }

    function saveData() {
        if (currentChatId) localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, established: isEstablished }));
    }

    function loadData() {
        characterColors = {};
        isEstablished = false;
        if (currentChatId) {
            try {
                const data = JSON.parse(localStorage.getItem(getStorageKey()));
                if (data?.colors) characterColors = data.colors;
                if (data?.established) isEstablished = data.established;
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

    function ensureRegexScript() {
        const SCRIPT_NAME = 'Trim Font Colors';
        
        const tryInstall = () => {
            if (typeof extension_settings === 'undefined') return false;
            if (!extension_settings.regex) extension_settings.regex = [];
            if (!Array.isArray(extension_settings.regex)) return false;
            
            if (extension_settings.regex.some(r => r.scriptName === SCRIPT_NAME)) {
                return true;
            }
            
            const newScript = {
                id: typeof uuidv4 === 'function' ? uuidv4() : crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9),
                scriptName: SCRIPT_NAME,
                findRegex: '</?font[^>]*>',
                replaceString: '',
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            };
            
            extension_settings.regex.push(newScript);
            if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
            console.log('Dialogue Colors: Regex "' + SCRIPT_NAME + '" installed');
            return true;
        };
        
        if (tryInstall()) return;
        
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (tryInstall() || attempts >= 30) clearInterval(interval);
        }, 500);
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use light pastel colors (#RRGGBB with high lightness).' : 'Use dark muted colors (#RRGGBB with low lightness).';
        const colorList = Object.entries(characterColors).length > 0
            ? `ASSIGNED COLORS (use exactly): ${Object.entries(characterColors).map(([k, v]) => `${v.name}=${v.color}`).join(', ')}. `
            : '';
        return `[Font Color Rule: Wrap ALL dialogue in <font color=#RRGGBB> tags. Includes: "quotes", 'single', 「Japanese」, 『brackets』, «guillemets», *thoughts*. ${themeHint} ${colorList}Each character has ONE consistent color. New characters get new unique colors.]`;
    }

    function injectPrompt() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return;
        const ctx = SillyTavern.getContext();
        if (!ctx.setExtensionPrompt) return;
        const prompt = settings.enabled ? buildPromptInstruction() : '';
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 0);
        updatePromptPreview(prompt);
    }

    function updatePromptPreview(prompt) {
        const preview = document.getElementById('cc-prompt-preview');
        if (preview) preview.textContent = prompt || '(disabled)';
    }

    function scanForColors(element) {
        const mesText = element.querySelector ? element.querySelector('.mes_text') : element;
        if (!mesText) return false;
        
        const html = mesText.innerHTML;
        // Match font tags with colors
        const fontRegex = /<font\s+color=["']?#([a-fA-F0-9]{6})["']?[^>]*>([\s\S]*?)<\/font>/gi;
        let match, foundNew = false;
        
        while ((match = fontRegex.exec(html)) !== null) {
            const color = '#' + match[1];
            const content = match[2];
            
            // Look for speaker attribution after the closing tag
            const afterTag = html.substring(match.index + match[0].length, match.index + match[0].length + 150);
            
            // Pattern: "dialogue," Name said/says/etc
            const attrPattern = /^[^<]*?[,.]?\s*["'"」』»]?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(said|says|replied|replies|asked|asks|whispered|whispers|yelled|yells|shouted|shouts|exclaimed|exclaims|murmured|murmurs|muttered|mutters|answered|answers|added|adds|called|calls|cried|cries|demanded|demands|groaned|groans|growled|growls|hissed|hisses|laughed|laughs|moaned|moans|mumbled|mumbles|purred|purrs|screamed|screams|sighed|sighs|smiled|smiles|snapped|snaps|sobbed|sobs|spoke|speaks|stammered|stammers|stated|states|stuttered|stutters|teased|teases|thought|thinks|warned|warns|whimpered|whimpers)/i;
            
            const attrMatch = afterTag.match(attrPattern);
            if (attrMatch) {
                const speaker = attrMatch[1];
                const key = speaker.toLowerCase();
                if (!characterColors[key]) {
                    characterColors[key] = { color, name: speaker };
                    foundNew = true;
                    console.log('Dialogue Colors: Found character:', speaker, color);
                }
            }
        }
        return foundNew;
    }

    function scanAllMessages() {
        console.log('Dialogue Colors: Scanning all messages...');
        const messages = document.querySelectorAll('.mes');
        console.log('Dialogue Colors: Found', messages.length, 'messages');
        
        let totalFound = 0;
        messages.forEach((m, i) => {
            const found = scanForColors(m);
            if (found) totalFound++;
        });
        
        console.log('Dialogue Colors: Scan complete. Characters:', Object.keys(characterColors));
        saveData();
        updateCharList();
        injectPrompt();
        
        if (typeof toastr !== 'undefined') {
            toastr.info(`Found ${Object.keys(characterColors).length} characters`);
        }
    }

    function scanLastMessage() {
        const messages = document.querySelectorAll('.mes');
        if (messages.length === 0) return;
        const foundNew = scanForColors(messages[messages.length - 1]);
        if (foundNew) { saveData(); updateCharList(); }
        injectPrompt();
    }

    function onNewMessage() {
        if (!settings.enabled) return;
        setTimeout(() => {
            const messages = document.querySelectorAll('.mes');
            if (messages.length === 0) return;
            
            const foundNew = scanForColors(messages[messages.length - 1]);
            if (foundNew) {
                console.log('Dialogue Colors: New character found in last message');
                saveData();
                updateCharList();
            }
            injectPrompt();
        }, 600);
    }

    function updateCharList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        const entries = Object.entries(characterColors);
        list.innerHTML = entries.length ? entries.map(([k, v]) =>
            `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
                <input type="color" value="${v.color}" data-key="${k}" style="width:24px;height:24px;padding:0;border:none;">
                <span style="flex:1;color:${v.color}">${v.name}</span>
                <button class="cc-del menu_button" data-key="${k}" style="padding:2px 6px;font-size:0.8em;">×</button>
            </div>`
        ).join('') : '<small>No characters yet</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => {
            i.oninput = () => { characterColors[i.dataset.key].color = i.value; saveData(); injectPrompt(); updateCharList(); };
        });
        list.querySelectorAll('.cc-del').forEach(btn => {
            btn.onclick = () => { delete characterColors[btn.dataset.key]; saveData(); injectPrompt(); updateCharList(); };
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
                <label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>Enable</span></label>
                <div class="cc-row"><label>Theme</label>
                    <select id="cc-theme"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                </div>
                <div style="display:flex;gap:5px;">
                    <button id="cc-clear" class="menu_button" style="flex:1">Clear</button>
                    <button id="cc-scan" class="menu_button" style="flex:1">Scan All</button>
                </div>
                <small>Characters:</small>
                <div id="cc-char-list" style="max-height:120px;overflow-y:auto;"></div>
                <hr>
                <small>Prompt:</small>
                <div id="cc-prompt-preview" style="font-size:0.7em;max-height:60px;overflow-y:auto;padding:4px;background:var(--SmartThemeBlurTintColor);border-radius:4px;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        document.getElementById('cc-enabled').checked = settings.enabled;
        document.getElementById('cc-enabled').onchange = e => { settings.enabled = e.target.checked; injectPrompt(); };
        document.getElementById('cc-theme').value = settings.themeMode;
        document.getElementById('cc-theme').onchange = e => { settings.themeMode = e.target.value; injectPrompt(); };
        document.getElementById('cc-clear').onclick = () => { characterColors = {}; isEstablished = false; saveData(); injectPrompt(); updateCharList(); };
        document.getElementById('cc-scan').onclick = () => { isEstablished = false; scanAllMessages(); };
        updateCharList();
        updatePromptPreview(buildPromptInstruction());
    }

    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) {
        if (type === 'quiet') return;
        if (!settings.enabled) return;
        injectPrompt();
    };

    function init() {
        console.log('Dialogue Colors: Initializing...');
        currentChatId = getChatId();
        loadData();
        ensureRegexScript();

        const waitForUI = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(waitForUI);
                createUI();
                injectPrompt();
            }
        }, 500);

        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
            eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
            eventSource.on(event_types.CHAT_CHANGED, () => {
                currentChatId = getChatId();
                loadData();
                updateCharList();
                injectPrompt();
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
