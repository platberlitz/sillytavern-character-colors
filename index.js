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
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            const colors = getThemeColors();
            characterColors[key] = {
                color: colors[colorIndex % colors.length],
                displayName: name
            };
            colorIndex++;
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
            colorIndex = Object.keys(characterColors).length;
        } catch (e) {}
    }

    function extractNames(text) {
        const names = new Set();
        const patterns = [
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|demanded|offered|suggested|admitted|agreed|announced|declared|explained|insisted|mentioned|noted|remarked|stated|thought|warned|wondered)\b/g,
            /\b(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|demanded|offered|suggested|admitted|agreed|announced|declared|explained|insisted|mentioned|noted|remarked|stated|thought|warned|wondered)\s+([A-Z][a-z]{2,})\b/g,
            /\b([A-Z][a-z]{2,})'s\s+(?:voice|words|tone|grip|hand|eyes|face|lips|mouth|thumb|fingers|head)\b/g,
            /\b([A-Z][a-z]{2,})\s+(?:shrugs|nods|smiles|grins|laughs|sighs|looks|turns|moves|steps|reaches|grabs|holds|pulls|pushes|tilts|doesn't|doesn't)\b/g
        ];
        
        const exclude = ['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Just', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'God', 'Yes', 'Now', 'Good', 'Shy'];
        
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

    function applyColorsToMessage(messageElement) {
        if (messageElement.hasAttribute('data-cc-done')) return;
        messageElement.setAttribute('data-cc-done', 'true');
        
        const text = messageElement.textContent;
        if (!text || text.length < 10) return;
        
        const names = extractNames(text);
        if (!names.length) return;
        
        // Build a map of which character is "active" at each position
        // by finding action verbs associated with names
        const activeRanges = [];
        const actionPatterns = [
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|shrugs|nods|smiles|grins|laughs|sighs|looks|turns|moves|steps|tilts|doesn't)\b/gi,
            /\b([A-Z][a-z]{2,})'s\s+(?:voice|words|tone|grip|hand|eyes|face|lips|mouth|thumb|fingers|head)\b/gi,
            /\bHe\s+(?:shrugs|said|says|asked|tilts|doesn't|looks|turns|smiles|grins|nods)/gi,
            /\bShe\s+(?:shrugs|said|says|asked|tilts|doesn't|looks|turns|smiles|grins|nods)/gi,
            /\bHis\s+(?:voice|words|tone|grip|hand|eyes|face|lips|thumb|fingers)/gi,
            /\bHer\s+(?:voice|words|tone|grip|hand|eyes|face|lips|thumb|fingers)/gi
        ];
        
        // Find the primary speaker for this message block
        let primarySpeaker = null;
        for (const name of names) {
            const pattern = new RegExp(`\\b${name}\\b.*?(?:said|says|asked|shrugs|nods|smiles|tilts)|\\b${name}'s\\s+voice`, 'i');
            if (pattern.test(text)) {
                primarySpeaker = name;
                break;
            }
        }
        
        // If we find "He/His" actions, attribute to the primary male character mentioned
        if (!primarySpeaker && /\b(?:He|His)\s+/i.test(text) && names.length > 0) {
            primarySpeaker = names[0];
        }
        
        if (!primarySpeaker && names.length > 0) {
            primarySpeaker = names[0];
        }
        
        // Work with text nodes directly
        const walker = document.createTreeWalker(
            messageElement,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes('"')) {
                textNodes.push(node);
            }
        }
        
        for (const textNode of textNodes) {
            const content = textNode.textContent;
            const parts = [];
            let lastIndex = 0;
            const regex = /"([^"]+)"/g;
            let match;
            
            while ((match = regex.exec(content)) !== null) {
                if (match.index > lastIndex) {
                    parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
                }
                
                // Use primary speaker for all dialogue in this message
                const speaker = primarySpeaker || names[0];
                
                parts.push({ 
                    type: 'dialogue', 
                    content: match[1], 
                    color: getCharacterColor(speaker)
                });
                
                lastIndex = match.index + match[0].length;
            }
            
            if (lastIndex < content.length) {
                parts.push({ type: 'text', content: content.substring(lastIndex) });
            }
            
            if (parts.some(p => p.type === 'dialogue')) {
                const fragment = document.createDocumentFragment();
                for (const part of parts) {
                    if (part.type === 'text') {
                        fragment.appendChild(document.createTextNode(part.content));
                    } else {
                        fragment.appendChild(document.createTextNode('"'));
                        const span = document.createElement('span');
                        span.className = 'cc-dialogue';
                        span.style.cssText = `color: ${part.color} !important;`;
                        span.textContent = part.content;
                        fragment.appendChild(span);
                        fragment.appendChild(document.createTextNode('"'));
                    }
                }
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        }
        
        // Color thoughts if enabled
        if (settings.colorThoughts && names.length > 0) {
            const color = getCharacterColor(primarySpeaker || names[0]);
            colorThoughts(messageElement, color);
        }
    }
    
    function colorThoughts(element, color) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.match(/\*[^*]+\*|『[^』]+』/)) {
                textNodes.push(node);
            }
        }
        
        for (const textNode of textNodes) {
            const content = textNode.textContent;
            const parts = [];
            let lastIndex = 0;
            const regex = /(\*[^*]+\*|『[^』]+』)/g;
            let match;
            
            while ((match = regex.exec(content)) !== null) {
                if (match.index > lastIndex) {
                    parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
                }
                parts.push({ type: 'thought', content: match[1] });
                lastIndex = match.index + match[0].length;
            }
            
            if (lastIndex < content.length) {
                parts.push({ type: 'text', content: content.substring(lastIndex) });
            }
            
            if (parts.some(p => p.type === 'thought')) {
                const fragment = document.createDocumentFragment();
                for (const part of parts) {
                    if (part.type === 'text') {
                        fragment.appendChild(document.createTextNode(part.content));
                    } else {
                        const span = document.createElement('span');
                        span.className = 'cc-thought';
                        span.style.cssText = `color: ${color} !important; opacity: 0.85 !important;`;
                        span.textContent = part.content;
                        fragment.appendChild(span);
                    }
                }
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        }
    }

    function processAllMessages() {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(applyColorsToMessage);
    }

    function reprocessAll() {
        document.querySelectorAll('[data-cc-done]').forEach(el => el.removeAttribute('data-cc-done'));
        document.querySelectorAll('.cc-dialogue, .cc-thought').forEach(el => {
            el.replaceWith(document.createTextNode(el.textContent));
        });
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
