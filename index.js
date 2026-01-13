(() => {
    'use strict';

    let characterColors = {};
    let settings = { theme: 'auto', colorThoughts: true };

    function generateRandomColor() {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 80%, 65%)`;
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateRandomColor(), displayName: name };
            localStorage.setItem('cc_colors', JSON.stringify(characterColors));
            updateCharacterList();
        }
        return characterColors[key].color;
    }

    function findSpeakerForQuote(text, quoteStart) {
        // Look backwards and forwards from the quote to find who said it
        const before = text.substring(Math.max(0, quoteStart - 150), quoteStart);
        const after = text.substring(quoteStart, Math.min(text.length, quoteStart + 200));
        
        // Patterns: "Name said", "said Name", "Name's voice", "Name whispered", etc.
        const patterns = [
            // Before quote: Name said, "
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|whispered|whispers|murmured|replied|called|shouted|added|continued|answered)\s*[,.]?\s*$/i,
            // Before quote: Name's voice
            /\b([A-Z][a-z]{2,})'s\s+voice\b/i,
            // After quote: " said Name
            /^[^"]*[""]?\s*(?:said|says|asked|asks|whispered|murmured|replied)\s+([A-Z][a-z]{2,})\b/i,
        ];
        
        // Check before
        for (const p of patterns.slice(0, 2)) {
            const m = before.match(p);
            if (m && m[1]) return m[1];
        }
        
        // Check after
        const afterMatch = after.match(patterns[2]);
        if (afterMatch && afterMatch[1]) return afterMatch[1];
        
        // Look for nearest name with action in surrounding context
        const context = before + after;
        const nameActions = /\b([A-Z][a-z]{2,})(?:'s)?\s+(?:voice|lips|eyes|gaze|smile|smirk|fingers|thumb|grip|hand)\b/gi;
        const names = [];
        let m;
        while ((m = nameActions.exec(context)) !== null) {
            if (!['The', 'This', 'That', 'His', 'Her', 'They'].includes(m[1])) {
                names.push(m[1]);
            }
        }
        
        return names[0] || null;
    }

    function processMessage(mesText) {
        if (mesText.dataset.ccProcessed) return;
        mesText.dataset.ccProcessed = 'true';

        const fullText = mesText.textContent;
        
        // Get the main character (message sender) as fallback
        const mesBlock = mesText.closest('.mes');
        let mainChar = null;
        if (mesBlock) {
            const nameEl = mesBlock.querySelector('.name_text');
            if (nameEl) mainChar = nameEl.textContent.trim();
        }

        // Find and process text nodes
        const walk = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walk.nextNode()) textNodes.push(walk.currentNode);

        for (const node of textNodes) {
            const text = node.nodeValue;
            // Match: "...", "...", 『...』, *...*
            const parts = text.split(/("[^"]*"|"[^"]*"|『[^』]*』|\*[^\*]+\*)/g);
            
            if (parts.length <= 1) continue;

            const frag = document.createDocumentFragment();
            let pos = 0;
            
            for (const part of parts) {
                if (!part) continue;
                
                const isQuote = /^[""][^""]*[""]$/.test(part);
                const isJpQuote = /^『[^』]*』$/.test(part);
                const isThought = /^\*[^\*]+\*$/.test(part);

                if (isQuote) {
                    // Find who said this quote
                    const quotePos = fullText.indexOf(part);
                    let speaker = findSpeakerForQuote(fullText, quotePos);
                    if (!speaker) speaker = mainChar;
                    
                    if (speaker) {
                        const color = getCharacterColor(speaker);
                        console.log('CC: Quote by', speaker, ':', part.substring(0, 30) + '...');
                        const span = document.createElement('span');
                        span.style.color = color;
                        span.textContent = part;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(part));
                    }
                } else if ((isJpQuote || isThought) && settings.colorThoughts) {
                    // Thoughts use main character color
                    if (mainChar) {
                        const color = getCharacterColor(mainChar);
                        const span = document.createElement('span');
                        span.style.color = color;
                        span.style.opacity = '0.85';
                        span.textContent = part;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(part));
                    }
                } else {
                    frag.appendChild(document.createTextNode(part));
                }
                
                pos += part.length;
            }
            node.parentNode.replaceChild(frag, node);
        }
    }

    function processAll() {
        document.querySelectorAll('.mes_text:not([data-cc-processed])').forEach(processMessage);
    }

    function reprocessAll() {
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccProcessed;
            el.querySelectorAll('span[style*="color"]').forEach(span => {
                if (span.closest('.cc-settings')) return;
                span.replaceWith(document.createTextNode(span.textContent));
            });
            el.normalize();
        });
        processAll();
    }

    function clearColors() {
        characterColors = {};
        localStorage.setItem('cc_colors', '{}');
        reprocessAll();
        updateCharacterList();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-character-list');
        if (!list) return;
        list.innerHTML = '';
        
        for (const [key, data] of Object.entries(characterColors)) {
            const div = document.createElement('div');
            div.className = 'cc-item';
            div.innerHTML = `<span style="color:${data.color}">${data.displayName}</span> <input type="color" value="${data.color.startsWith('hsl') ? '#888888' : data.color}" data-key="${key}"> <small>${data.color}</small>`;
            list.appendChild(div);
        }
        
        list.querySelectorAll('input[type="color"]').forEach(inp => {
            inp.oninput = () => {
                characterColors[inp.dataset.key].color = inp.value;
                localStorage.setItem('cc_colors', JSON.stringify(characterColors));
                reprocessAll();
            };
        });
    }

    function createUI() {
        if (document.getElementById('cc-settings-panel')) return;
        
        const html = `<div id="cc-settings-panel" class="cc-settings">
            <h4>Character Dialogue Colors</h4>
            <div><label><input type="checkbox" id="cc-thoughts" checked> Color thoughts</label></div>
            <div><button id="cc-clear">Clear</button> <button id="cc-refresh">Refresh</button></div>
            <div id="cc-character-list"></div>
        </div>`;
        
        const target = document.getElementById('extensions_settings');
        if (target) {
            target.insertAdjacentHTML('beforeend', html);
            document.getElementById('cc-clear').onclick = clearColors;
            document.getElementById('cc-refresh').onclick = reprocessAll;
            document.getElementById('cc-thoughts').onchange = (e) => {
                settings.colorThoughts = e.target.checked;
                reprocessAll();
            };
            updateCharacterList();
        }
    }

    function init() {
        console.log('CC: Character Colors extension loaded');
        
        try {
            const saved = localStorage.getItem('cc_colors');
            if (saved) characterColors = JSON.parse(saved);
        } catch(e) {}

        const uiInterval = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(uiInterval);
                createUI();
            }
        }, 500);

        setInterval(processAll, 1000);
        
        new MutationObserver(() => setTimeout(processAll, 200))
            .observe(document.body, { childList: true, subtree: true });

        setTimeout(processAll, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
