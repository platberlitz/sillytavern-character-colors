(() => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
    const REGEX_SCRIPT_NAME = 'Strip Font Color Tags';
    let characterColors = {};
    let currentChatId = null;
    let settings = { enabled: true, colorThoughts: true, themeMode: 'auto' };
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

    function ensureRegexScriptInstalled() {
        try {
            fetch('scripts/extensions/third-party/sillytavern-character-colors/regex-script.json')
                .then(r => r.ok ? r.json() : fetch('regex-script.json').then(r2 => r2.json()))
                .then(regexData => {
                    if (typeof extension_settings !== 'undefined' && Array.isArray(extension_settings.regex)) {
                        if (!extension_settings.regex.some(r => r.scriptName === REGEX_SCRIPT_NAME)) {
                            extension_settings.regex.push({
                                id: crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => (Math.random() * 16 | 0).toString(16)),
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
                            });
                            saveSettingsDebounced();
                        }
                    }
                })
                .catch(() => {});
        } catch (e) {}
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use light pastel colors (#RRGGBB with high lightness).' : 'Use dark muted colors (#RRGGBB with low lightness).';
        const colorList = Object.entries(characterColors).length > 0
            ? `ASSIGNED COLORS (use exactly): ${Object.entries(characterColors).map(([k, v]) => `${v.name}=${v.color}`).join(', ')}. `
            : '';
        return `<font color rule: Wrap ALL dialogue in <font color=#RRGGBB> tags. This includes: "quotes", 'single quotes', 「Japanese brackets」, 『double brackets』, «guillemets», and *thoughts/actions*. ${themeHint} ${colorList}Each character MUST have ONE consistent color throughout. New characters get new colors.>`;
    }

    function injectPrompt() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return;
        const ctx = SillyTavern.getContext();
        if (!ctx.setExtensionPrompt) return;
        const prompt = settings.enabled ? buildPromptInstruction() : '';
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 0, false, 0);
        updatePromptPreview(prompt);
    }

    function updatePromptPreview(prompt) {
        const preview = document.getElementById('cc-prompt-preview');
        if (preview) preview.textContent = prompt || '(disabled)';
    }

    function detectSpeakerFromText(text, tagStart, tagEnd) {
        const afterTag = text.substring(tagEnd, Math.min(text.length, tagEnd + 200));
        const pattern = /,\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(said|says|replied|replies|answered|asked|whispered|whispers|yelled|yells|shouted|exclaimed|exclaims|added|murmured|muttered|mutters)\s*[,.]?\s*$/i;
        const matches = [...afterTag.matchAll(new RegExp(pattern.source, 'i'))];
        return matches.length > 0 ? matches[0][1] : null;
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
                } else if (characterColors[key].color !== color) {
                    characterColors[key].color = color;
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
        const last = messages[messages.length - 1];
        const foundNew = scanForColors(last);
        if (foundNew) {
            saveData();
            updateCharList();
        }
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
                <input type="text" value="${v.name}" data-key="${k}" style="flex:1;padding:2px 5px;border:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor);border-radius:4px;">
                <button class="cc-del menu_button" data-key="${k}" style="padding:2px 6px;font-size:0.8em;">×</button>
            </div>`
        ).join('') : '<small>No characters yet</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => {
            i.oninput = () => { characterColors[i.dataset.key].color = i.value; saveData(); injectPrompt(); };
        });
        list.querySelectorAll('input[type="text"]').forEach(i => {
            i.onchange = () => {
                const oldKey = i.dataset.key, newName = i.value.trim();
                if (newName && newName !== characterColors[oldKey]?.name) {
                    const oldColor = characterColors[oldKey]?.color || '#ffffff';
                    delete characterColors[oldKey];
                    characterColors[newName.toLowerCase()] = { color: oldColor, name: newName };
                    saveData(); injectPrompt(); updateCharList();
                }
            };
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
                <label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>Enable color injection</span></label>
                <div class="cc-row"><label>Theme Mode</label>
                    <select id="cc-theme"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                </div>
                <hr>
                <div style="display:flex;gap:5px;">
                    <button id="cc-clear" class="menu_button" style="flex:1">Clear All</button>
                    <button id="cc-scan" class="menu_button" style="flex:1">Full Scan</button>
                </div>
                <small>Characters (this chat only):</small>
                <div id="cc-char-list" style="max-height:120px;overflow-y:auto;"></div>
                <hr>
                <small>Prompt preview:</small>
                <div id="cc-prompt-preview" style="font-size:0.75em;color:var(--SmartThemeBodyColor);max-height:80px;overflow-y:auto;padding:5px;background:var(--SmartThemeBlurTintColor);border-radius:4px;"></div>
            </div>
        </div>`;
        const container = document.getElementById('extensions_settings');
        if (!container) return;
        container.insertAdjacentHTML('beforeend', html);

        const enabledCheck = document.getElementById('cc-enabled');
        enabledCheck.checked = settings.enabled;
        enabledCheck.onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };

        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.themeMode;
        themeSelect.onchange = e => { settings.themeMode = e.target.value; saveData(); injectPrompt(); };

        document.getElementById('cc-clear').onclick = () => { characterColors = {}; isEstablished = false; saveData(); injectPrompt(); updateCharList(); };
        document.getElementById('cc-scan').onclick = () => { isEstablished = false; scanAllMessages(); };
        updateCharList();
        updatePromptPreview(buildPromptInstruction());
    }

    function init() {
        currentChatId = getChatId();
        loadData();
        ensureRegexScriptInstalled();

        const waitForUI = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(waitForUI);
                createUI();
                injectPrompt();
            }
        }, 500);

        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.GENERATION_STARTED, () => injectPrompt());
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, () => injectPrompt());
            eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
            eventSource.on(event_types.CHAT_CHANGED, () => {
                currentChatId = getChatId();
                loadData();
                updateCharList();
                setTimeout(injectPrompt, 300);
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
