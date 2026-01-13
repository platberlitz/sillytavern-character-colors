(() => {
    'use strict';

    const MODULE_NAME = 'dialogue-colors';
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
            updateCharList();
        }
        return characterColors[key].color;
    }

    function detectSpeaker(text, position) {
        const beforeQuote = text.substring(0, position);
        
        const patterns = [
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:/,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(says|said|asks|asked|replied|answers|answered|whispers|whispered|shouted|yelled|exclaimed|murmured|muttered|remarked|noted|commented|added|continued|interrupted)\s*$/i
        ];
        
        for (const pattern of patterns) {
            const matches = [...beforeQuote.matchAll(new RegExp(pattern.source, 'gi'))];
            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1];
                const matchText = text.substring(lastMatch.index, lastMatch.index + lastMatch[0].length);
                const distanceFromQuote = position - lastMatch.index - lastMatch[0].length;
                
                if (distanceFromQuote <= 50) {
                    return matchText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/)[0];
                }
            }
        }
        
        return null;
    }

    function applyDisplayColors() {
        document.querySelectorAll('.mes').forEach(mesBlock => {
            const mesText = mesBlock.querySelector('.mes_text');
            if (!mesText || mesText.dataset.ccDone) return;
            
            const defaultColor = mesBlock.querySelector('.name_text')?.textContent?.trim();
            let processedHTML = mesText.innerHTML;
            
            processedHTML = processedHTML.replace(/(".*?"|'.*?'|«.*?»)/g, (match) => {
                const tempText = processedHTML;
                const matchIndex = tempText.indexOf(match);
                const speaker = detectSpeaker(tempText, matchIndex);
                
                if (speaker) {
                    return `<font color="${getCharColor(speaker)}">${match}</font>`;
                } else if (defaultColor) {
                    return `<font color="${getCharColor(defaultColor)}">${match}</font>`;
                }
                return match;
            });

            if (settings.colorThoughts) {
                processedHTML = processedHTML.replace(/\*([^*]+)\*/g, (match, content) => {
                    if (defaultColor) {
                        return `<font color="${getCharColor(defaultColor)}" style="opacity:0.85;font-style:italic;">*${content}*</font>`;
                    }
                    return match;
                });
            }
            
            mesText.innerHTML = processedHTML;
            mesText.dataset.ccDone = '1';
        });
    }

    function clearDisplayColors() {
        document.querySelectorAll('.mes_text').forEach(el => {
            if (el.dataset.ccDone) {
                el.innerHTML = el.innerHTML.replace(/<font[^>]*color="[^"]*"[^>]*>([^<]*)<\/font>/g, '$1');
                delete el.dataset.ccDone;
            }
        });
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
                clearDisplayColors();
                applyDisplayColors();
            };
        });
        
        list.querySelectorAll('.cc-del').forEach(btn => {
            btn.onclick = () => {
                delete characterColors[btn.dataset.key];
                clearDisplayColors();
                applyDisplayColors();
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
                <label class="checkbox_label"><input type="checkbox" id="cc-enabled"><span>Enable coloring</span></label>
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
                    <button id="cc-refresh" class="menu_button" style="flex:1">Refresh</button>
                </div>
                <small>Characters (session only):</small>
                <div id="cc-char-list" style="max-height:100px;overflow-y:auto;"></div>
            </div>
        </div>`;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        const enabledCheck = document.getElementById('cc-enabled');
        enabledCheck.checked = settings.enabled;
        enabledCheck.onchange = e => { 
            settings.enabled = e.target.checked; 
            if (!settings.enabled) clearDisplayColors();
            else applyDisplayColors();
        };
        
        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.themeMode;
        themeSelect.onchange = e => { 
            settings.themeMode = e.target.value; 
        };
        
        const thoughtsCheck = document.getElementById('cc-thoughts');
        thoughtsCheck.checked = settings.colorThoughts;
        thoughtsCheck.onchange = e => { 
            settings.colorThoughts = e.target.checked; 
            clearDisplayColors();
            applyDisplayColors();
        };
        
        document.getElementById('cc-clear').onclick = () => {
            clearDisplayColors();
            characterColors = {};
            updateCharList();
        };
        
        document.getElementById('cc-refresh').onclick = () => {
            clearDisplayColors();
            applyDisplayColors();
        };
        
        updateCharList();
    }

    function init() {
        const wait = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(wait);
                createUI();
                if (settings.enabled) setTimeout(applyDisplayColors, 500);
            }
        }, 500);
        
        const btnWait = setInterval(() => {
            if (document.getElementById('send_form')) {
                clearInterval(btnWait);
                addInputButton();
            }
        }, 500);
        
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                if (settings.enabled) setTimeout(applyDisplayColors, 300);
            });
            
            eventSource.on(event_types.CHAT_CHANGED, () => {
                clearDisplayColors();
                characterColors = {};
                updateCharList();
                if (settings.enabled) setTimeout(applyDisplayColors, 500);
            });
            
            eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
                if (settings.enabled) setTimeout(applyDisplayColors, 300);
            });
        }
        
        setInterval(() => {
            if (settings.enabled) applyDisplayColors();
        }, 3000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
