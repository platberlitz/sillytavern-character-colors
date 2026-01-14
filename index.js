(() => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
    const REGEX_SCRIPT_NAME = 'Dialogue Colors - Strip Tags from AI Context';
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
        if (typeof extension_settings === 'undefined' || !Array.isArray(extension_settings.regex)) return;
        if (extension_settings.regex.some(r => r.scriptName === REGEX_SCRIPT_NAME)) return;
        
        extension_settings.regex.push({
            id: crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9),
            scriptName: REGEX_SCRIPT_NAME,
            findRegex: '<\\/?font[^>]*>',
            replaceString: '',
            trimStrings: [],
            placement: [2, 3, 4],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: true,
            substituteRegex: false,
            minDepth: null,
            maxDepth: null
        });
        if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();
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
        // extension_prompt_types: IN_PROMPT = 0, IN_CHAT = 1, BEFORE_PROMPT = 2, AFTER_PROMPT = 3
        // Use IN_CHAT with depth 0 to inject at the end of chat (right before generation)
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 0);
        updatePromptPreview(prompt);
        console.log('Dialogue Colors: Prompt injected:', prompt.substring(0, 50) + '...');
    }

    function updatePromptPreview(prompt) {
        const preview = document.getElementById('cc-prompt-preview');
        if (preview) preview.textContent = prompt || '(disabled)';
    }

    function detectSpeakerFromText(text, tagStart, tagEnd) {
        const afterTag = text.substring(tagEnd, Math.min(text.length, tagEnd + 200));
        const pattern = /,\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(said|says|replied|replies|answered|asked|whispered|whispers|yelled|yells|shouted|exclaimed|exclaims|added|murmured|muttered|mutters)/i;
        const match = afterTag.match(pattern);
        return match ? match[1] : null;
    }

    function scanForColors(element) {
        const mesText = element.querySelector ? element.querySelector('.mes_text') : element;
        if (!mesText) return false;
        const html = mesText.innerHTML;
        const fontRegex = /<font\s+color=["']?#([a-fA-F0-9]{6})["']?[^>]*>/gi;
        let match, foundNew = false;
        while ((match = fontRegex.exec(html)) !== null) {
            const color = '#' + match[1];
            const speaker = detectSpeakerFromText(html, match.index, match.index + match[0].length);
            if (speaker) {
                const key = speaker.toLowerCase();
                if (!characterColors[key]) {
                    characterColors[key] = { color, name: speaker };
                    foundNew = true;
                }
            }
        }
        return foundNew;
    }

    function scanAllMessages() {
        document.querySelectorAll('.mes').forEach(m => scanForColors(m));
        saveData();
        updateCharList();
        injectPrompt();
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
            if (isEstablished) {
                scanLastMessage();
            } else {
                scanAllMessages();
                if (Object.keys(characterColors).length >= 2) {
                    isEstablished = true;
                    saveData();
                }
            }
        }, 500);
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

    // Generate interceptor - called before each generation
    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) {
        if (type === 'quiet') return;
        if (!settings.enabled) return;
        console.log('Dialogue Colors: Interceptor called, injecting prompt');
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
            // These events fire before generation
            eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
                console.log('Dialogue Colors: GENERATION_AFTER_COMMANDS');
                injectPrompt();
            });
            
            // Scan after message received
            eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
            
            // Handle chat switch
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
