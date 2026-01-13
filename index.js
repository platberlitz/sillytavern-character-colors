(() => {
    'use strict';

    let characterColors = {};
    let settings = {
        theme: 'auto',
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
            characterColors[key] = { color: generateRandomColor(), displayName: name };
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
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|replied|whispered|shouted|muttered|exclaimed|answered|called|murmured|growled|sighed|spoke|added|continued|responded|shrugs|nods|smiles|grins|laughs|sighs|looks|turns|moves|steps|tilts|doesn't|leans|towers|lets|drops|gets)\b/gi,
            /\b([A-Z][a-z]{2,})'s\s+(?:voice|words|tone|grip|hand|eyes|face|lips|mouth|thumb|fingers|head|wrist|breath|ear)\b/gi
        ];
        const exclude = ['The', 'This', 'That', 'Then', 'There', 'They', 'What', 'When', 'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Have', 'Just', 'But', 'And', 'For', 'Not', 'You', 'Your', 'His', 'Her', 'Its', 'Our', 'Their', 'She', 'God', 'Yes', 'Now', 'Good', 'Shy', 'Easy', 'Look', 'Someone', 'Quiet'];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                if (match[1] && !exclude.includes(match[1])) names.add(match[1]);
            }
        }
        return [...names];
    }

    function findPrimarySpeaker(text, names) {
        for (const name of names) {
            if (new RegExp(`${name}(?:'s)?\\s+(?:voice|grip|thumb|leans|tilts|towers)|He\\s+(?:tilts|leans|shrugs)`, 'i').test(text)) {
                return name;
            }
        }
        return names[0] || null;
    }

    function processMessage(el) {
        if (el.hasAttribute('data-cc-done')) return;
        
        const text = el.textContent;
        if (!text || text.length < 10) return;
        
        const names = extractNames(text);
        const speaker = findPrimarySpeaker(text, names);
        if (!speaker) return;
        
        const color = getCharacterColor(speaker);
        
        // Walk text nodes only
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        let node;
        while (node = walker.nextNode()) nodes.push(node);
        
        for (const textNode of nodes) {
            const txt = textNode.textContent;
            if (!txt.match(/[""]|『|』|\*/)) continue;
            
            const frag = document.createDocumentFragment();
            let remaining = txt;
            
            // Match quotes and thoughts
            const regex = /("[^"]+"|"[^"]+"|『[^』]+』|\*[^*]+\*)/g;
            let lastIdx = 0;
            let m;
            
            while ((m = regex.exec(txt)) !== null) {
                // Text before match
                if (m.index > lastIdx) {
                    frag.appendChild(document.createTextNode(txt.slice(lastIdx, m.index)));
                }
                
                const matched = m[0];
                const isThought = matched.startsWith('『') || matched.startsWith('*');
                
                if (isThought && !settings.colorThoughts) {
                    frag.appendChild(document.createTextNode(matched));
                } else {
                    // Extract wrapper and inner content
                    let open, close, inner;
                    if (matched.startsWith('"')) { open = '"'; close = '"'; inner = matched.slice(1, -1); }
                    else if (matched.startsWith('"')) { open = '"'; close = '"'; inner = matched.slice(1, -1); }
                    else if (matched.startsWith('『')) { open = '『'; close = '』'; inner = matched.slice(1, -1); }
                    else { open = '*'; close = '*'; inner = matched.slice(1, -1); }
                    
                    frag.appendChild(document.createTextNode(open));
                    const span = document.createElement('span');
                    span.className = isThought ? 'cc-thought' : 'cc-dialogue';
                    span.style.cssText = `color: ${color} !important;` + (isThought ? ' opacity: 0.85 !important;' : '');
                    span.textContent = inner;
                    frag.appendChild(span);
                    frag.appendChild(document.createTextNode(close));
                }
                
                lastIdx = m.index + matched.length;
            }
            
            // Remaining text
            if (lastIdx < txt.length) {
                frag.appendChild(document.createTextNode(txt.slice(lastIdx)));
            }
            
            if (frag.childNodes.length > 0 && lastIdx > 0) {
                textNode.parentNode.replaceChild(frag, textNode);
            }
        }
        
        el.setAttribute('data-cc-done', 'true');
    }

    function processAll() {
        document.querySelectorAll('.mes_text:not([data-cc-done])').forEach(processMessage);
    }

    function reprocessAll() {
        // Remove all our spans and flags
        document.querySelectorAll('.mes_text[data-cc-done]').forEach(el => {
            el.removeAttribute('data-cc-done');
            el.querySelectorAll('.cc-dialogue, .cc-thought').forEach(span => {
                span.replaceWith(document.createTextNode(span.textContent));
            });
        });
        processAll();
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
            item.innerHTML = `<span class="cc-name-display" style="color:${data.color}!important">${data.displayName}</span><input type="color" value="${data.color}" data-key="${key}"><span class="cc-hex">${data.color}</span>`;
            list.appendChild(item);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                const key = e.target.dataset.key;
                characterColors[key].color = e.target.value.toUpperCase();
                saveData();
                e.target.previousElementSibling.style.color = e.target.value;
                e.target.nextElementSibling.textContent = e.target.value.toUpperCase();
                reprocessAll();
            });
        });
    }

    function createUI() {
        const html = `<div class="cc-settings"><h3>Character Dialogue Colors</h3><div class="cc-row"><label>Theme</label><select id="cc-theme"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div><div class="cc-row"><label><input type="checkbox" id="cc-thoughts"> Color thoughts</label></div><div class="cc-row"><label>Characters</label><button id="cc-clear">Clear</button><button id="cc-reprocess">Refresh</button></div><div id="cc-character-list"></div></div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        
        const theme = document.getElementById('cc-theme');
        if (theme) { theme.value = settings.theme; theme.onchange = (e) => { settings.theme = e.target.value; saveData(); }; }
        
        const thoughts = document.getElementById('cc-thoughts');
        if (thoughts) { thoughts.checked = settings.colorThoughts; thoughts.onchange = (e) => { settings.colorThoughts = e.target.checked; saveData(); reprocessAll(); }; }
        
        document.getElementById('cc-clear')?.addEventListener('click', clearColors);
        document.getElementById('cc-reprocess')?.addEventListener('click', reprocessAll);
        updateCharacterList();
    }

    function init() {
        loadData();
        const waitUI = setInterval(() => { if (document.getElementById('extensions_settings')) { clearInterval(waitUI); createUI(); } }, 500);
        
        const observer = new MutationObserver(() => setTimeout(processAll, 150));
        observer.observe(document.body, { childList: true, subtree: true });
        
        setTimeout(processAll, 500);
        setInterval(processAll, 3000);
        
        $(document).on('chatLoaded', () => {
            characterColors = {};
            saveData();
            document.querySelectorAll('.mes_text').forEach(el => {
                el.removeAttribute('data-cc-done');
                el.querySelectorAll('.cc-dialogue, .cc-thought').forEach(span => span.replaceWith(document.createTextNode(span.textContent)));
            });
            setTimeout(processAll, 300);
            updateCharacterList();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
