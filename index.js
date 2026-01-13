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

    function extractSpeaker(text, mesElement) {
        // First, try to get the character name from the message element itself
        const mesBlock = mesElement?.closest('.mes');
        if (mesBlock) {
            const nameEl = mesBlock.querySelector('.name_text');
            if (nameEl) {
                const charName = nameEl.textContent.trim();
                if (charName && charName.length > 0) {
                    return charName;
                }
            }
        }
        
        // Fallback: Look for patterns that indicate who is SPEAKING
        const speechPatterns = [
            /\b([A-Z][a-z]{2,})'s\s+voice\b/i,
            /\b([A-Z][a-z]{2,})\s+(?:said|says|asked|asks|whispered|whispers|murmured|murmurs)\b/i,
        ];
        
        for (const p of speechPatterns) {
            const m = text.match(p);
            if (m && m[1]) return m[1];
        }
        
        return null;
    }

    function processMessage(mesText) {
        if (mesText.dataset.ccProcessed) return;
        mesText.dataset.ccProcessed = 'true';

        const fullText = mesText.textContent;
        const speaker = extractSpeaker(fullText, mesText);
        if (!speaker) return;

        const color = getCharacterColor(speaker);
        console.log('CC: Found speaker', speaker, 'with color', color);

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
            for (const part of parts) {
                if (!part) continue;
                
                const isQuote = /^[""][^""]*[""]$/.test(part);
                const isJpQuote = /^『[^』]*』$/.test(part);
                const isThought = /^\*[^\*]+\*$/.test(part);

                if (isQuote || isJpQuote || (isThought && settings.colorThoughts)) {
                    const span = document.createElement('span');
                    span.style.color = color;
                    span.textContent = part;
                    if (isThought || isJpQuote) span.style.opacity = '0.85';
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode(part));
                }
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
            // Remove colored spans
            el.querySelectorAll('span[style*="color"]').forEach(span => {
                if (span.closest('.cc-settings')) return;
                span.replaceWith(document.createTextNode(span.textContent));
            });
            // Normalize text nodes
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

        // Wait for UI
        const uiInterval = setInterval(() => {
            if (document.getElementById('extensions_settings')) {
                clearInterval(uiInterval);
                createUI();
            }
        }, 500);

        // Process messages
        setInterval(processAll, 1000);
        
        // Observe for new messages
        new MutationObserver(() => setTimeout(processAll, 200))
            .observe(document.body, { childList: true, subtree: true });

        // Initial process
        setTimeout(processAll, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
