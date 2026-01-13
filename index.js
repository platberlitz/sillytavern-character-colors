(() => {
    'use strict';

    let characterColors = {};
    let settings = { colorThoughts: true, themeMode: 'auto' };

    function generateColor(index) {
        const hue = (index * 137.508) % 360; // Golden angle
        const isDark = settings.themeMode === 'dark' || 
            (settings.themeMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const lightness = isDark ? 65 : 40;
        return `hsl(${Math.round(hue)}, 75%, ${lightness}%)`;
    }

    function getCharacterColor(name) {
        const key = name.toLowerCase().trim();
        if (!characterColors[key]) {
            characterColors[key] = { color: generateColor(Object.keys(characterColors).length), displayName: name };
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
            const c = localStorage.getItem('cc_colors');
            const s = localStorage.getItem('cc_settings');
            if (c) characterColors = JSON.parse(c);
            if (s) settings = { ...settings, ...JSON.parse(s) };
        } catch (e) {}
    }

    function isGenerationInProgress() {
        // Check SillyTavern's generation state
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            if (ctx.is_send_press || ctx.isGenerating?.()) return true;
        }
        // Also check global
        if (typeof is_send_press !== 'undefined' && is_send_press) return true;
        if (typeof isGenerating !== 'undefined' && isGenerating()) return true;
        return false;
    }

    async function extractDialogueMap(text) {
        // Don't run if generation is in progress
        if (isGenerationInProgress()) {
            console.log('CC: Skipping LLM - generation in progress');
            return null;
        }
        
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) return null;
        const ctx = SillyTavern.getContext();
        if (!ctx.generateRaw) return null;

        try {
            const prompt = `List characters who speak dialogue in this text. Return JSON: {"quote": "speaker"}\nText: ${text.substring(0, 1500)}\nJSON:`;
            const resp = await ctx.generateRaw(prompt, null, false, false, '', 200);
            const match = resp.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch (e) {}
        return null;
    }

    function applyColors(mesText, dialogueMap) {
        const mesBlock = mesText.closest('.mes');
        const mainChar = mesBlock?.querySelector('.name_text')?.textContent?.trim();

        // Color thoughts in em/i tags (『...』 and *...*)
        if (settings.colorThoughts && mainChar) {
            const color = getCharacterColor(mainChar);
            mesText.querySelectorAll('em, i').forEach(el => {
                if (!el.dataset.ccDone) {
                    el.style.color = color;
                    el.style.opacity = '0.85';
                    el.dataset.ccDone = '1';
                }
            });
        }

        // Color dialogue in quotes (only if we have dialogueMap from LLM)
        if (!dialogueMap) return;
        
        const walk = document.createTreeWalker(mesText, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walk.nextNode()) nodes.push(walk.currentNode);

        for (const node of nodes) {
            const text = node.nodeValue;
            if (!/"/.test(text) && !/"/.test(text)) continue;

            const parts = text.split(/("[^"]+"|"[^"]+")/g);
            if (parts.length <= 1) continue;

            const frag = document.createDocumentFragment();
            for (const part of parts) {
                if (!part) continue;
                if (/^[""][^""]+[""]$/.test(part)) {
                    const inner = part.slice(1, -1).toLowerCase();
                    let speaker = null;
                    for (const [d, c] of Object.entries(dialogueMap)) {
                        if (inner.includes(d.toLowerCase().substring(0, 12)) || d.toLowerCase().includes(inner.substring(0, 12))) {
                            speaker = c;
                            break;
                        }
                    }
                    if (speaker) {
                        const span = document.createElement('span');
                        span.className = 'cc-dialogue';
                        span.style.color = getCharacterColor(speaker);
                        span.textContent = part;
                        frag.appendChild(span);
                        continue;
                    }
                }
                frag.appendChild(document.createTextNode(part));
            }
            node.parentNode.replaceChild(frag, node);
        }
    }

    async function processMessage(el, useLLM) {
        if (el.dataset.ccProcessed && !useLLM) return;
        el.dataset.ccProcessed = '1';
        const map = useLLM ? await extractDialogueMap(el.textContent) : null;
        applyColors(el, map);
    }

    function processAll(useLLM = false) {
        document.querySelectorAll('.mes_text').forEach(el => {
            if (useLLM || !el.dataset.ccProcessed) {
                processMessage(el, useLLM);
            }
        });
    }

    async function reprocess() {
        // Don't reprocess if generation is in progress
        if (isGenerationInProgress()) {
            console.log('CC: Cannot reprocess - generation in progress');
            return;
        }
        
        document.querySelectorAll('.mes_text').forEach(el => {
            delete el.dataset.ccProcessed;
            el.querySelectorAll('[data-cc-done]').forEach(e => { e.style.color = ''; e.style.opacity = ''; delete e.dataset.ccDone; });
            el.querySelectorAll('.cc-dialogue').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
        });
        
        for (const el of document.querySelectorAll('.mes_text')) {
            await processMessage(el, true);
        }
    }

    function clearColors() {
        characterColors = {};
        saveData();
        reprocess();
    }

    function updateCharacterList() {
        const list = document.getElementById('cc-char-list');
        if (!list) return;
        list.innerHTML = Object.entries(characterColors).map(([k, v]) =>
            `<div class="cc-char-item"><span style="color:${v.color}">${v.displayName}</span><input type="color" value="${v.color.startsWith('hsl')?'#888':v.color}" data-key="${k}"></div>`
        ).join('') || '<small>No characters yet</small>';
        list.querySelectorAll('input').forEach(i => i.oninput = () => { characterColors[i.dataset.key].color = i.value; saveData(); reprocess(); });
    }

    function createUI() {
        if (document.getElementById('cc-ext')) return;
        const html = `<div id="cc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="cc-thoughts" ${settings.colorThoughts?'checked':''}><span>Color thoughts (『』/*text*)</span></label>
                <select id="cc-theme"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
                <div><button id="cc-refresh" class="menu_button">Refresh</button><button id="cc-clear" class="menu_button">Clear</button></div>
                <div id="cc-char-list"></div>
            </div></div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);
        document.getElementById('cc-thoughts').onchange = e => { settings.colorThoughts = e.target.checked; saveData(); reprocess(); };
        document.getElementById('cc-theme').value = settings.themeMode;
        document.getElementById('cc-theme').onchange = e => { settings.themeMode = e.target.value; saveData(); };
        document.getElementById('cc-refresh').onclick = reprocess;
        document.getElementById('cc-clear').onclick = clearColors;
        updateCharacterList();
    }

    function init() {
        loadData();
        const wait = setInterval(() => { if (document.getElementById('extensions_settings')) { clearInterval(wait); createUI(); } }, 500);
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            // Only color thoughts automatically, NOT dialogue (to avoid interrupting generation)
            eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(() => processAll(false), 500));
            eventSource.on(event_types.CHAT_CHANGED, () => { characterColors = {}; saveData(); updateCharacterList(); });
        }
        // Auto-process thoughts only (no LLM)
        setInterval(() => processAll(false), 3000);
        setTimeout(() => processAll(false), 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
