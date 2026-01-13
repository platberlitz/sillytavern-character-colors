(() => {
    'use strict';

    const MODULE_NAME = 'character-colors';
    let characterColors = {};
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

    function generateColor() {
        const hue = Math.random() * 360;
        const sat = 65 + Math.random() * 20;
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const light = mode === 'dark' ? 60 + Math.random() * 15 : 35 + Math.random() * 15;
        return hslToHex(hue, sat, light);
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

    function getCharColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateColor(), name };
            saveData();
            updateCharList();
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

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use LIGHT/PASTEL colors (high lightness) for dark background.' : 'Use DARK/MUTED colors (low lightness) for light background.';
        
        const colorList = Object.keys(characterColors).length > 0
            ? `Established colors: ${Object.values(characterColors).map(c => `${c.name}: ${c.color}`).join(', ')}. `
            : '';
        
        return `[Wrap all dialogue ("speech") and inner thoughts (*thoughts*) in <font color=#RRGGBB> tags. ${themeHint} ${colorList}Assign distinct color per speaker. Reuse established colors. Example: <font color=#abc123>"Hello!"</font> <font color=#abc123>*thinking*</font>]`;
    }

    function injectPrompt() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return;
        const ctx = SillyTavern.getContext();
        if (!ctx.setExtensionPrompt) return;

        const prompt = settings.enabled ? buildPromptInstruction() : '';
        // IN_CHAT = 1, depth 1 = just before last message, SYSTEM role = 0
        ctx.setExtensionPrompt(MODULE_NAME, prompt, 1, 1, false, 0);
    }

    function applyDisplayColors() {
        document.querySelectorAll('.mes_text').forEach(el => {
            if (el.dataset.ccDone) return;
            
            // Color thoughts in em/i
            if (settings.colorThoughts) {
                const mesBlock = el.closest('.mes');
                const charName = mesBlock?.querySelector('.name_text')?.textContent?.trim();
                if (charName) {
                    const color = getCharColor(charName);
                    el.querySelectorAll('em, i').forEach(em => {
                        if (!em.dataset.ccThought) {
                            em.style.color = color;
                            em.style.opacity = '0.85';
                            em.dataset.ccThought = '1';
                        }
                    });
                }
            }
            el.dataset.ccDone = '1';
        });
    }

    function clearDisplayColors() {
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccDone;
            el.querySelectorAll('[data-cc-thought]').forEach(em => {
                em.style.color = '';
                em.style.opacity = '';
                delete em.dataset.ccThought;
            });
        });
    }

    function updateCharList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        
        const entries = Object.entries(characterColors);
        list.innerHTML = entries.length ? entries.map(([k, v]) =>
            `<div class="cc-char-item"><span style="color:${v.color};font-weight:bold">${v.name}</span><input type="color" value="${v.color}" data-key="${k}"></div>`
        ).join('') : '<small>No characters yet</small>';
        
        list.querySelectorAll('input').forEach(i => {
            i.oninput = () => { 
                characterColors[i.dataset.key].color = i.value; 
                saveData(); 
                injectPrompt();
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
        btn.title = 'Refresh Dialogue Colors';
        btn.style.cssText = 'cursor:pointer;padding:5px;font-size:1.2em;opacity:0.7;';
        btn.onclick = () => {
            clearDisplayColors();
            applyDisplayColors();
            toastr?.success?.('Display colors refreshed!');
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
                <label class="checkbox_label"><input type="checkbox" id="cc-thoughts"><span>Color thoughts (*text*/em)</span></label>
                <hr>
                <div style="display:flex;gap:5px;">
                    <button id="cc-clear" class="menu_button" style="flex:1">Clear Colors</button>
                </div>
                <small>Characters:</small>
                <div id="cc-char-list" style="max-height:100px;overflow-y:auto;"></div>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        const enabledCheck = document.getElementById('cc-enabled');
        enabledCheck.checked = settings.enabled;
        enabledCheck.onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        
        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.themeMode;
        themeSelect.onchange = e => { settings.themeMode = e.target.value; saveData(); };
        
        const thoughtsCheck = document.getElementById('cc-thoughts');
        thoughtsCheck.checked = settings.colorThoughts;
        thoughtsCheck.onchange = e => { settings.colorThoughts = e.target.checked; saveData(); clearDisplayColors(); applyDisplayColors(); };
        
        document.getElementById('cc-clear').onclick = () => {
            characterColors = {};
            saveData();
            injectPrompt();
            updateCharList();
        };
        
        updateCharList();
    }

    function init() {
        loadData();
        
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                createUI();
            }
        }, 500);
        
        const btnWait = setInterval(() => {
            if (document.getElementById('send_form')) {
                clearInterval(btnWait);
                addInputButton();
            }
        }, 500);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            // Inject prompt before generation
            eventSource.on(event_types.GENERATION_STARTED, () => {
                injectPrompt();
            });
            
            // Apply display colors after message received
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                setTimeout(applyDisplayColors, 500);
            });
            
            eventSource.on(event_types.CHAT_CHANGED, () => {
                clearDisplayColors();
            });
        }
        
        setInterval(applyDisplayColors, 2000);
        setTimeout(applyDisplayColors, 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
