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
    let pendingMessages = new Set();

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
        if (!characterColors[name]) {
            const colors = getThemeColors();
            characterColors[name] = colors[colorIndex % colors.length];
            colorIndex++;
            saveData();
            updateCharacterList();
        }
        return characterColors[name];
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

    async function extractNamesWithLLM(text) {
        const prompt = `Extract ONLY character names (proper nouns of people/characters) from this text. Return as JSON array of strings. If none found, return []. Text:\n\n${text.substring(0, 2000)}`;
        
        try {
            const response = await fetch('/api/backends/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 100,
                    temperature: 0
                })
            });
            
            if (!response.ok) throw new Error('API failed');
            
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '[]';
            const match = content.match(/\[.*?\]/s);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {
            console.log('CC: LLM extraction failed, using fallback');
        }
        
        // Fallback: simple capitalized word detection
        const names = [];
        const pattern = /\b([A-Z][a-z]{2,})\b/g;
        let m;
        while ((m = pattern.exec(text)) !== null) {
            const word = m[1];
            if (!['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Has', 'Had', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'He'].includes(word)) {
                names.push(word);
            }
        }
        return [...new Set(names)];
    }

    function applyColorsToMessage(messageElement, names) {
        if (!names.length) return;
        
        let html = messageElement.innerHTML;
        
        for (const name of names) {
            const color = getCharacterColor(name);
            const regex = new RegExp(`\\b(${name})\\b`, 'g');
            html = html.replace(regex, `<span class="cc-name" style="color:${color}!important;font-weight:bold!important">$1</span>`);
        }
        
        if (settings.colorThoughts) {
            const color = getCharacterColor(names[0]);
            html = html.replace(/\*([^*]+)\*/g, `<span class="cc-thought" style="color:${color}!important;opacity:0.85!important">*$1*</span>`);
            html = html.replace(/『([^』]+)』/g, `<span class="cc-thought" style="color:${color}!important;opacity:0.85!important">『$1』</span>`);
        }
        
        messageElement.innerHTML = html;
        messageElement.setAttribute('data-cc-done', 'true');
    }

    async function processMessage(messageElement) {
        if (messageElement.hasAttribute('data-cc-done')) return;
        
        const text = messageElement.textContent;
        if (!text || text.length < 10) return;
        
        const msgId = messageElement.closest('.mes')?.getAttribute('mesid');
        if (msgId && pendingMessages.has(msgId)) return;
        if (msgId) pendingMessages.add(msgId);
        
        const names = await extractNamesWithLLM(text);
        applyColorsToMessage(messageElement, names);
        
        if (msgId) pendingMessages.delete(msgId);
    }

    function processAllMessages() {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(msg => {
            processMessage(msg);
        });
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
        if (!Object.keys(characterColors).length) {
            list.innerHTML = '<div class="cc-empty">No characters detected yet</div>';
            return;
        }
        
        for (const [name, color] of Object.entries(characterColors)) {
            const item = document.createElement('div');
            item.className = 'cc-item';
            item.innerHTML = `
                <span class="cc-name-display" style="color:${color}!important">${name}</span>
                <input type="color" value="${color}" data-name="${name}">
                <span class="cc-hex">${color}</span>
            `;
            list.appendChild(item);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const name = e.target.dataset.name;
                const color = e.target.value.toUpperCase();
                characterColors[name] = color;
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
        theme.value = settings.theme;
        theme.onchange = (e) => {
            settings.theme = e.target.value;
            document.getElementById('cc-custom-row').style.display = e.target.value === 'custom' ? 'block' : 'none';
            saveData();
        };
        if (settings.theme === 'custom') document.getElementById('cc-custom-row').style.display = 'block';
        
        const custom = document.getElementById('cc-custom');
        custom.value = settings.customColors.join(', ');
        custom.onchange = (e) => {
            settings.customColors = e.target.value.split(',').map(c => c.trim().toUpperCase()).filter(c => /^#[0-9A-F]{6}$/.test(c));
            saveData();
        };
        
        const thoughts = document.getElementById('cc-thoughts');
        thoughts.checked = settings.colorThoughts;
        thoughts.onchange = (e) => {
            settings.colorThoughts = e.target.checked;
            saveData();
            reprocessAll();
        };
        
        document.getElementById('cc-clear').onclick = clearColors;
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
        
        // Process on new messages
        const observer = new MutationObserver(() => setTimeout(processAllMessages, 200));
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Initial + periodic processing
        setTimeout(processAllMessages, 1000);
        setInterval(processAllMessages, 3000);
        
        // Clear on new chat
        $(document).on('chatLoaded', clearColors);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
