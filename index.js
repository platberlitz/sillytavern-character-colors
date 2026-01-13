(() => {
    'use strict';

    const extensionName = 'character-colors';
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
        const body = document.body;
        const bg = getComputedStyle(body).backgroundColor;
        const rgb = bg.match(/\d+/g);
        if (rgb) {
            const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
            return brightness < 128 ? 'dark' : 'light';
        }
        return 'dark';
    }

    function getThemeColors() {
        if (settings.theme === 'custom' && settings.customColors.length > 0) {
            return settings.customColors;
        }
        const theme = settings.theme === 'auto' ? detectTheme() : settings.theme;
        return themeColors[theme] || themeColors.dark;
    }

    function getCharacterColor(name) {
        if (!characterColors[name]) {
            const colors = getThemeColors();
            characterColors[name] = colors[colorIndex % colors.length];
            colorIndex++;
            saveCharacterColors();
            updateCharacterList();
        }
        return characterColors[name];
    }

    function setCharacterColor(name, color) {
        characterColors[name] = color;
        saveCharacterColors();
        reprocessAllMessages();
        updateCharacterList();
    }

    function saveCharacterColors() {
        localStorage.setItem('cc_character_colors', JSON.stringify(characterColors));
    }

    function loadCharacterColors() {
        const saved = localStorage.getItem('cc_character_colors');
        if (saved) {
            characterColors = JSON.parse(saved);
            colorIndex = Object.keys(characterColors).length;
        }
    }

    function saveSettings() {
        localStorage.setItem('cc_settings', JSON.stringify(settings));
    }

    function loadSettings() {
        const saved = localStorage.getItem('cc_settings');
        if (saved) {
            settings = { ...settings, ...JSON.parse(saved) };
        }
    }

    function applyColorToElement(element, color) {
        element.style.setProperty('color', color, 'important');
        element.style.setProperty('font-weight', 'bold', 'important');
        element.classList.add('cc-colored');
    }

    function colorizeMessage(messageElement) {
        if (messageElement.hasAttribute('data-cc-processed')) return;
        
        let html = messageElement.innerHTML;
        if (!html) return;

        // Dialogue attribution patterns: "said John", "John said", "John asked", "whispered Mary", etc.
        const dialogueVerbs = 'said|says|asked|asks|replied|replies|whispered|whispers|shouted|shouts|muttered|mutters|exclaimed|exclaims|answered|answers|called|calls|cried|cries|murmured|murmurs|growled|growls|sighed|sighs|laughed|laughs|smiled|smiles|grinned|grins|nodded|nods|spoke|speaks|added|adds|continued|continues|began|begins|started|starts|finished|finishes|responded|responds|questioned|questions|demanded|demands|pleaded|pleads|begged|begs|offered|offers|suggested|suggests|admitted|admits|agreed|agrees|announced|announces|declared|declares|explained|explains|insisted|insists|mentioned|mentions|noted|notes|observed|observes|pointed|points|promised|promises|reassured|reassures|recalled|recalls|remarked|remarks|repeated|repeats|reported|reports|revealed|reveals|stated|states|thought|thinks|warned|warns|wondered|wonders';
        
        // Pattern: "Name said" or "said Name" or "Name, said" etc.
        const namePattern = new RegExp(`\\b([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s+(?:${dialogueVerbs})|(?:${dialogueVerbs})\\s+([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\b`, 'g');
        
        const foundNames = new Set();
        let match;
        while ((match = namePattern.exec(html)) !== null) {
            const name = match[1] || match[2];
            if (name) foundNames.add(name);
        }
        
        // Color each found name throughout the message
        for (const name of foundNames) {
            const color = getCharacterColor(name);
            const nameRegex = new RegExp(`\\b(${name})\\b`, 'g');
            html = html.replace(nameRegex, `<span class="cc-name" style="color: ${color} !important; font-weight: bold !important;">$1</span>`);
        }
        
        // Color thoughts if enabled and we found at least one character
        if (settings.colorThoughts && foundNames.size > 0) {
            const firstChar = [...foundNames][0];
            const color = getCharacterColor(firstChar);
            
            // *asterisk thoughts*
            html = html.replace(
                /\*([^*]+)\*/g,
                `<span class="cc-thought" style="color: ${color} !important; opacity: 0.85 !important;">*$1*</span>`
            );
            // 『Japanese thoughts』
            html = html.replace(
                /『([^』]+)』/g,
                `<span class="cc-thought" style="color: ${color} !important; opacity: 0.85 !important;">『$1』</span>`
            );
        }
        
        messageElement.innerHTML = html;
        messageElement.setAttribute('data-cc-processed', 'true');
    }

    function processAllMessages() {
        document.querySelectorAll('.mes_text, .mes_block .mes_text').forEach(msg => {
            colorizeMessage(msg);
        });
    }

    function reprocessAllMessages() {
        document.querySelectorAll('[data-cc-processed]').forEach(el => {
            el.removeAttribute('data-cc-processed');
        });
        processAllMessages();
    }

    function clearAllColors() {
        characterColors = {};
        colorIndex = 0;
        saveCharacterColors();
        reprocessAllMessages();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-character-list');
        if (!list) return;
        
        list.innerHTML = '';
        
        if (Object.keys(characterColors).length === 0) {
            list.innerHTML = '<div class="cc-no-chars">No characters detected yet</div>';
            return;
        }
        
        for (const [name, color] of Object.entries(characterColors)) {
            const item = document.createElement('div');
            item.className = 'cc-char-item';
            item.innerHTML = `
                <span class="cc-char-name" style="color: ${color} !important;">${name}</span>
                <input type="color" class="cc-color-picker" value="${color}" data-name="${name}">
                <span class="cc-hex-display">${color}</span>
            `;
            list.appendChild(item);
        }
        
        list.querySelectorAll('.cc-color-picker').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const name = e.target.dataset.name;
                const newColor = e.target.value.toUpperCase();
                setCharacterColor(name, newColor);
                e.target.nextElementSibling.textContent = newColor;
                e.target.previousElementSibling.style.setProperty('color', newColor, 'important');
            });
        });
    }

    function createSettingsUI() {
        const html = `
            <div class="character-colors-settings">
                <div class="cc-header">
                    <h3>Character Dialogue Colors</h3>
                </div>
                
                <div class="cc-section">
                    <label class="cc-label">Color Theme</label>
                    <select id="cc-theme">
                        <option value="auto">Auto-detect</option>
                        <option value="dark">Dark Mode Colors</option>
                        <option value="light">Light Mode Colors</option>
                        <option value="custom">Custom Palette</option>
                    </select>
                </div>
                
                <div id="cc-custom-section" class="cc-section" style="display: none;">
                    <label class="cc-label">Custom Colors (comma-separated hex)</label>
                    <input type="text" id="cc-custom-input" placeholder="#FF0000, #00FF00, #0000FF">
                </div>
                
                <div class="cc-section">
                    <label class="cc-checkbox-label">
                        <input type="checkbox" id="cc-color-thoughts">
                        <span>Color inner thoughts (*text* and 『text』)</span>
                    </label>
                </div>
                
                <div class="cc-section">
                    <label class="cc-label">Character Colors</label>
                    <div class="cc-char-list-header">
                        <span>Click color to change</span>
                        <button id="cc-clear-all" class="cc-btn">Clear All</button>
                    </div>
                    <div id="cc-character-list" class="cc-character-list"></div>
                </div>
            </div>
        `;
        
        const container = document.getElementById('extensions_settings');
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }
        
        // Theme selector
        const themeSelect = document.getElementById('cc-theme');
        themeSelect.value = settings.theme;
        themeSelect.addEventListener('change', (e) => {
            settings.theme = e.target.value;
            document.getElementById('cc-custom-section').style.display = 
                e.target.value === 'custom' ? 'block' : 'none';
            saveSettings();
        });
        
        if (settings.theme === 'custom') {
            document.getElementById('cc-custom-section').style.display = 'block';
        }
        
        // Custom colors input
        const customInput = document.getElementById('cc-custom-input');
        customInput.value = settings.customColors.join(', ');
        customInput.addEventListener('change', (e) => {
            settings.customColors = e.target.value
                .split(',')
                .map(c => c.trim().toUpperCase())
                .filter(c => /^#[0-9A-F]{6}$/.test(c));
            saveSettings();
        });
        
        // Thoughts checkbox
        const thoughtsCheck = document.getElementById('cc-color-thoughts');
        thoughtsCheck.checked = settings.colorThoughts;
        thoughtsCheck.addEventListener('change', (e) => {
            settings.colorThoughts = e.target.checked;
            saveSettings();
            reprocessAllMessages();
        });
        
        // Clear all button
        document.getElementById('cc-clear-all').addEventListener('click', clearAllColors);
        
        updateCharacterList();
    }

    function init() {
        loadSettings();
        loadCharacterColors();
        
        // Create settings UI when extensions panel exists
        const checkUI = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(checkUI);
                createSettingsUI();
            }
        }, 500);
        
        // Process messages
        processAllMessages();
        
        // Watch for new messages
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldProcess = true;
                    break;
                }
            }
            if (shouldProcess) {
                setTimeout(processAllMessages, 100);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Reprocess on chat load
        if (typeof eventSource !== 'undefined') {
            eventSource.on('chatLoaded', () => {
                clearAllColors();
            });
        }
        
        // Periodic check for unprocessed messages
        setInterval(processAllMessages, 2000);
    }

    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
