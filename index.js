(() => {
    'use strict';

    let characterColors = new Map();
    let settings = {
        theme: 'auto', // auto, dark, light, custom
        customColors: []
    };

    const themeColors = {
        dark: ['#FF6B35', '#FF1493', '#00CED1', '#32CD32', '#FFD700', '#FF69B4', '#8A2BE2', '#FF4500'],
        light: ['#CC4400', '#CC0066', '#006699', '#228B22', '#B8860B', '#C71585', '#6A1B9A', '#D2691E'],
        auto: [] // Will be set based on detected theme
    };

    let colorIndex = 0;
    let currentChatId = null;

    function detectTheme() {
        const isDark = document.body.classList.contains('dark') || 
                      getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)' ||
                      window.matchMedia('(prefers-color-scheme: dark)').matches;
        return isDark ? 'dark' : 'light';
    }

    function getThemeColors() {
        if (settings.theme === 'custom' && settings.customColors.length > 0) {
            return settings.customColors;
        }
        if (settings.theme === 'auto') {
            return themeColors[detectTheme()];
        }
        return themeColors[settings.theme] || themeColors.dark;
    }

    function saveCharacterColor(charName, color) {
        if (window.characters && window.this_chid !== undefined) {
            const char = window.characters[window.this_chid];
            if (char) {
                if (!char.data.extensions) char.data.extensions = {};
                if (!char.data.extensions.character_colors) char.data.extensions.character_colors = {};
                char.data.extensions.character_colors[charName] = color;
                window.saveCharacterDebounced();
            }
        }
    }

    function loadCharacterColor(charName) {
        if (window.characters && window.this_chid !== undefined) {
            const char = window.characters[window.this_chid];
            if (char?.data?.extensions?.character_colors?.[charName]) {
                return char.data.extensions.character_colors[charName];
            }
        }
        return null;
    }

    function getCharacterColor(name) {
        if (!characterColors.has(name)) {
            let color = loadCharacterColor(name);
            if (!color) {
                const colors = getThemeColors();
                color = colors[colorIndex % colors.length];
                colorIndex++;
                saveCharacterColor(name, color);
            }
            characterColors.set(name, color);
        }
        return characterColors.get(name);
    }

    function resetColorsForNewChat() {
        const newChatId = window.selected_group || window.this_chid;
        if (newChatId !== currentChatId) {
            characterColors.clear();
            colorIndex = 0;
            currentChatId = newChatId;
            // Re-process all messages
            document.querySelectorAll('.mes_text[data-colored]').forEach(el => {
                el.removeAttribute('data-colored');
            });
            processMessages();
        }
    }

    function colorizeMessage(messageElement) {
        const textContent = messageElement.textContent || messageElement.innerText;
        if (!textContent) return;

        const namePattern = /^([A-Za-z][A-Za-z0-9\s]*?)(?:\s*[:]\s*)/;
        const match = textContent.match(namePattern);
        
        if (match) {
            const characterName = match[1].trim();
            const color = getCharacterColor(characterName);
            
            const innerHTML = messageElement.innerHTML;
            const coloredHTML = innerHTML.replace(
                new RegExp(`^(${characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'),
                `<span style="color: ${color}; font-weight: bold;">$1</span>`
            );
            messageElement.innerHTML = coloredHTML;
        }
    }

    function processMessages() {
        resetColorsForNewChat();
        const messages = document.querySelectorAll('.mes_text:not([data-colored])');
        messages.forEach(msg => {
            colorizeMessage(msg);
            msg.setAttribute('data-colored', 'true');
        });
    }

    function loadSettings() {
        const saved = localStorage.getItem('character_colors_settings');
        if (saved) {
            settings = { ...settings, ...JSON.parse(saved) };
        }
    }

    function saveSettings() {
        localStorage.setItem('character_colors_settings', JSON.stringify(settings));
    }

    function createSettingsUI() {
        const html = `
            <div class="character-colors-settings">
                <h3>Character Dialogue Colors</h3>
                <div class="setting-group">
                    <label>Theme:</label>
                    <select id="cc-theme">
                        <option value="auto">Auto-detect</option>
                        <option value="dark">Dark Mode</option>
                        <option value="light">Light Mode</option>
                        <option value="custom">Custom Colors</option>
                    </select>
                </div>
                <div id="cc-custom-colors" style="display: none;">
                    <label>Custom Colors (hex codes, comma-separated):</label>
                    <input type="text" id="cc-custom-input" placeholder="#FF0000, #00FF00, #0000FF">
                </div>
            </div>
        `;
        
        $('#extensions_settings').append(html);
        
        $('#cc-theme').val(settings.theme).on('change', function() {
            settings.theme = this.value;
            $('#cc-custom-colors').toggle(this.value === 'custom');
            saveSettings();
            characterColors.clear();
            colorIndex = 0;
            processMessages();
        });
        
        $('#cc-custom-input').val(settings.customColors.join(', ')).on('input', function() {
            const colors = this.value.split(',').map(c => c.trim()).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c));
            settings.customColors = colors;
            saveSettings();
        });
        
        if (settings.theme === 'custom') {
            $('#cc-custom-colors').show();
        }
    }

    function init() {
        loadSettings();
        createSettingsUI();
        currentChatId = window.selected_group || window.this_chid;
        
        processMessages();
        
        const observer = new MutationObserver(() => {
            processMessages();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Listen for chat changes
        $(document).on('chat_changed', resetColorsForNewChat);
    }

    jQuery(() => {
        init();
    });
})();
