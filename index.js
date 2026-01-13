(() => {
    'use strict';

    let characterColors = {};
    let settings = {
        theme: 'auto',
        customColors: [],
        colorThoughts: false
    };

    const themeColors = {
        dark: ['#FF6B35', '#FF1493', '#00CED1', '#32CD32', '#FFD700', '#FF69B4', '#8A2BE2', '#FF4500'],
        light: ['#CC4400', '#CC0066', '#006699', '#228B22', '#B8860B', '#C71585', '#6A1B9A', '#D2691E']
    };

    let colorIndex = 0;

    function detectTheme() {
        const bg = getComputedStyle(document.body).backgroundColor;
        const rgb = bg.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getThemeColors() {
        if (settings.theme === 'custom' && settings.customColors.length > 0) return settings.customColors;
        return themeColors[settings.theme === 'auto' ? detectTheme() : settings.theme] || themeColors.dark;
    }

    function getCharacterColor(name) {
        const normalizedName = name.toLowerCase().trim();
        if (!characterColors[normalizedName]) {
            const colors = getThemeColors();
            characterColors[normalizedName] = {
                color: colors[colorIndex % colors.length],
                displayName: name
            };
            colorIndex++;
            saveData();
            updateCharacterList();
        }
        return characterColors[normalizedName].color;
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
            colorIndex = Object.keys(characterColors).length;
        } catch (e) {}
    }

    function extractNames(text) {
        // Simple extraction: capitalized words that appear near dialogue verbs or quotes
        const names = new Set();
        
        // Pattern: Name + dialogue verb, or dialogue verb + Name
        const patterns = [
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|demanded|offered|suggested|admitted|agreed|announced|declared|explained|insisted|mentioned|noted|remarked|stated|thought|warned|wondered)\b/gi,
            /\b(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|demanded|offered|suggested|admitted|agreed|announced|declared|explained|insisted|mentioned|noted|remarked|stated|thought|warned|wondered)\s+([A-Z][a-z]{2,})\b/gi,
            // Name's (possessive) near action
            /\b([A-Z][a-z]{2,})'s\s+(?:voice|words|tone|grip|hand|eyes|face|lips|mouth)\b/gi,
            // Name + verb (action)
            /\b([A-Z][a-z]{2,})\s+(?:shrugs|nods|smiles|grins|laughs|sighs|looks|turns|moves|steps|reaches|grabs|holds|pulls|pushes)\b/gi
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1];
                if (name && !['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Just', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'God', 'Yes', 'Now'].includes(name)) {
                    names.add(name);
                }
            }
        }
        
        return [...names];
    }

    function applyColorsToMessage(messageElement) {
        if (messageElement.hasAttribute('data-cc-done')) return;
        
        const text = messageElement.textContent;
        if (!text || text.length < 10) return;
        
        const names = extractNames(text);
        if (!names.length) {
            messageElement.setAttribute('data-cc-done', 'true');
            return;
        }
        
        let html = messageElement.innerHTML;
        
        // Find dialogue and associate with nearest character
        const dialoguePattern = /"([^"]+)"/g;
        let match;
        let segments = [];
        
        while ((match = dialoguePattern.exec(html)) !== null) {
            segments.push({
                start: match.index,
                end: match.index + match[0].length,
                full: match[0],
                inner: match[1]
            });
        }
        
        // Process in reverse to preserve indices
        for (const seg of segments.reverse()) {
            // Find nearest character name to this dialogue
            let nearestName = null;
            let nearestDist = Infinity;
            
            const textBefore = html.substring(Math.max(0, seg.start - 200), seg.start);
            const textAfter = html.substring(seg.end, Math.min(html.length, seg.end + 200));
            
            for (const name of names) {
                // Check before
                const beforeIdx = textBefore.lastIndexOf(name);
                if (beforeIdx !== -1) {
                    const dist = textBefore.length - beforeIdx;
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearestName = name;
                    }
                }
                // Check after
                const afterIdx = textAfter.indexOf(name);
                if (afterIdx !== -1 && afterIdx < nearestDist) {
                    nearestDist = afterIdx;
                    nearestName = name;
                }
            }
            
            if (nearestName) {
                const color = getCharacterColor(nearestName);
                const colored = `"<span class="cc-dialogue" style="color:${color}!important">${seg.inner}</span>"`;
                html = html.substring(0, seg.start) + colored + html.substring(seg.end);
            }
        }
        
        // Color thoughts if enabled
        if (settings.colorThoughts && names.length > 0) {
            const color = getCharacterColor(names[0]);
            html = html.replace(/\*([^*]+)\*/g, `<span class="cc-thought" style="color:${color}!important;opacity:0.85!important">*$1*</span>`);
            html = html.replace(/『([^』]+)』/g, `<span class="cc-thought" style="color:${color}!important;opacity:0.85!important">『$1』</span>`);
        }
        
        messageElement.innerHTML = html;
        messageElement.setAttribute('data-cc-done', 'true');
    }

    function processAllMessages() {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(applyColorsToMessage);
    }

    function reprocessAll() {
        document.querySelectorAll('[data-cc-done]').forEach(el => el.removeAttribute('data-cc-done'));
        processAllMessages();
    }

    function clearColors() {
        characterColors = {};
        colorIndex = 0;
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
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div id="cc-custom-row" class="cc-row" style="display:none">
                    <label>Custom Colors</label>
                    <input type="text" id="cc-custom" placeholder="#FF0000, #00FF00">
                </div>
                <div class="cc-row">
                    <label><input type="checkbox" id="cc-thoughts"> Color thoughts (*text* / 『text』)</label>
                </div>
                <div class="cc-row">
                    <label>Characters</label>
                    <button id="cc-clear">Clear All</button>
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
                document.getElementById('cc-custom-row').style.display = e.target.value === 'custom' ? 'block' : 'none';
                saveData();
            };
        }
        if (settings.theme === 'custom') {
            const customRow = document.getElementById('cc-custom-row');
            if (customRow) customRow.style.display = 'block';
        }
        
        const custom = document.getElementById('cc-custom');
        if (custom) {
            custom.value = settings.customColors.join(', ');
            custom.onchange = (e) => {
                settings.customColors = e.target.value.split(',').map(c => c.trim().toUpperCase()).filter(c => /^#[0-9A-F]{6}$/.test(c));
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
        
        setTimeout(processAllMessages, 1000);
        setInterval(processAllMessages, 2000);
        
        $(document).on('chatLoaded', clearColors);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
