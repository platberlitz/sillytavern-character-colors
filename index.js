(() => {
    'use strict';

    let characterColors = {};
    let settings = {
        theme: 'auto',
        customColors: [],
        colorThoughts: true
    };

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const rgb = bg.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function generateRandomColor() {
        const isDark = settings.theme === 'dark' || (settings.theme === 'auto' && detectTheme() === 'dark');
        const hue = Math.floor(Math.random() * 360);
        const saturation = 70 + Math.floor(Math.random() * 30);
        const lightness = isDark ? 55 + Math.floor(Math.random() * 25) : 30 + Math.floor(Math.random() * 25);
        return hslToHex(hue, saturation, lightness);
    }
    
    function hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = {
                color: generateRandomColor(),
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

    function extractNames(text) {
        const names = new Set();
        const patterns = [
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|shrugs|nods|smiles|grins|laughs|sighs|looks|turns|moves|steps|tilts|doesn't|doesn't|leans|towers|lets|drops|gets)\b/gi,
            /\b([A-Z][a-z]{2,})'s\s+(?:voice|words|tone|grip|hand|eyes|face|lips|mouth|thumb|fingers|head|wrist|breath|ear)\b/gi,
            /\b([A-Z][a-z]{2,})\s+(?:has|had|is|was|can|could|will|would)\b/gi
        ];
        
        const exclude = ['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Just', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'God', 'Yes', 'Now', 'Good', 'Shy', 'Easy', 'Look', 'Someone', 'Quiet'];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1];
                if (name && !exclude.includes(name)) {
                    names.add(name);
                }
            }
        }
        return [...names];
    }

    function findPrimarySpeaker(text, names) {
        // Look for who is speaking/acting with dialogue
        for (const name of names) {
            // Check if this name is associated with speech actions
            const speechPattern = new RegExp(`${name}(?:'s)?\\s+(?:voice|grip|thumb|leans|tilts|towers)|His\\s+voice|He\\s+(?:tilts|leans|shrugs)`, 'i');
            if (speechPattern.test(text)) {
                return name;
            }
        }
        return names[0] || null;
    }

    function applyColorsToMessage(messageElement) {
        if (messageElement.hasAttribute('data-cc-done')) return;
        messageElement.setAttribute('data-cc-done', 'true');
        
        const text = messageElement.textContent;
        if (!text || text.length < 10) return;
        
        const names = extractNames(text);
        const primarySpeaker = findPrimarySpeaker(text, names);
        
        if (!primarySpeaker) return;
        
        const color = getCharacterColor(primarySpeaker);
        
        // Process the HTML to color dialogue and thoughts
        let html = messageElement.innerHTML;
        
        // Color text in straight quotes "..."
        html = html.replace(/"([^"]+)"/g, (match, inner) => {
            return `"<span class="cc-dialogue" style="color: ${color} !important;">${inner}</span>"`;
        });
        
        // Color text in curly quotes "..."
        html = html.replace(/"([^"]+)"/g, (match, inner) => {
            return `"<span class="cc-dialogue" style="color: ${color} !important;">${inner}</span>"`;
        });
        
        // Color thoughts in 『...』
        if (settings.colorThoughts) {
            html = html.replace(/『([^』]+)』/g, (match, inner) => {
                return `『<span class="cc-thought" style="color: ${color} !important; opacity: 0.85 !important;">${inner}</span>』`;
            });
            
            // Color thoughts in *...*
            html = html.replace(/\*([^*]+)\*/g, (match, inner) => {
                return `*<span class="cc-thought" style="color: ${color} !important; opacity: 0.85 !important;">${inner}</span>*`;
            });
        }
        
        messageElement.innerHTML = html;
    }

    function processAllMessages() {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(applyColorsToMessage);
    }

    function reprocessAll() {
        document.querySelectorAll('[data-cc-done]').forEach(el => el.removeAttribute('data-cc-done'));
        document.querySelectorAll('.cc-dialogue, .cc-thought').forEach(el => {
            const text = el.textContent;
            el.replaceWith(document.createTextNode(text));
        });
        processAllMessages();
    }

    function clearColors() {
        characterColors = {};
        saveData();
        reprocessAll();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-character-list');
        if (!list) return;
        
        list.innerHTML = '';
        const entries = Object.entries(characterColors);
        if (!entries.length) {
            list.innerHTML = '<div class="cc-empty">No characters detected yet</div>';
            return;
        }
        
        for (const [key, data] of entries) {
            const item = document.createElement('div');
            item.className = 'cc-item';
            item.innerHTML = `
                <span class="cc-name-display" style="color:${data.color}!important">${data.displayName}</span>
                <input type="color" value="${data.color}" data-key="${key}">
                <span class="cc-hex">${data.color}</span>
            `;
            list.appendChild(item);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const key = e.target.dataset.key;
                const color = e.target.value.toUpperCase();
                characterColors[key].color = color;
                saveData();
                e.target.previousElementSibling.style.color = color;
                e.target.nextElementSibling.textContent = color;
                reprocessAll();
            });
        });
    }

    function createUI() {
        const html = `
            <div class="cc-settings">
                <h3>Character Dialogue Colors</h3>
                <div class="cc-row">
                    <label>Theme</label>
                    <select id="cc-theme">
                        <option value="auto">Auto</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                    </select>
                </div>
                <div class="cc-row">
                    <label><input type="checkbox" id="cc-thoughts"> Color thoughts (*text* / 『text』)</label>
                </div>
                <div class="cc-row">
                    <label>Characters</label>
                    <button id="cc-clear">Clear All</button>
                    <button id="cc-reprocess">Reprocess</button>
                </div>
                <div id="cc-character-list"></div>
            </div>
        `;
        
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        const theme = document.getElementById('cc-theme');
        if (theme) {
            theme.value = settings.theme;
            theme.onchange = (e) => {
                settings.theme = e.target.value;
                saveData();
            };
        }
        
        const thoughts = document.getElementById('cc-thoughts');
        if (thoughts) {
            thoughts.checked = settings.colorThoughts;
            thoughts.onchange = (e) => {
                settings.colorThoughts = e.target.checked;
                saveData();
                reprocessAll();
            };
        }
        
        document.getElementById('cc-clear')?.addEventListener('click', clearColors);
        document.getElementById('cc-reprocess')?.addEventListener('click', reprocessAll);
        updateCharacterList();
    }

    function init() {
        loadData();
        
        const waitUI = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(waitUI);
                createUI();
            }
        }, 500);
        
        const observer = new MutationObserver(() => setTimeout(processAllMessages, 100));
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Auto-process on load
        setTimeout(() => {
            document.querySelectorAll('[data-cc-done]').forEach(el => el.removeAttribute('data-cc-done'));
            processAllMessages();
        }, 500);
        
        setInterval(processAllMessages, 2000);
        
        $(document).on('chatLoaded', () => {
            characterColors = {};
            saveData();
            document.querySelectorAll('[data-cc-done]').forEach(el => el.removeAttribute('data-cc-done'));
            document.querySelectorAll('.cc-dialogue, .cc-thought').forEach(el => {
                el.replaceWith(document.createTextNode(el.textContent));
            });
            setTimeout(processAllMessages, 300);
            updateCharacterList();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
