(async function() {
    'use strict';
    
    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt } = await import('../../../../script.js');

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let colorHistory = [];
    let historyIndex = -1;
    let currentChatId = null;
    let swapMode = null;
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false };

    const COLOR_THEMES = {
        pastel: [[340,70,75],[200,70,75],[120,50,70],[45,80,70],[280,60,75],[170,60,70],[20,80,75],[240,60,75]],
        neon: [[320,100,60],[180,100,50],[90,100,50],[45,100,55],[270,100,60],[150,100,45],[0,100,60],[210,100,55]],
        earth: [[25,50,55],[45,40,50],[90,30,45],[150,35,45],[180,30,50],[30,60,60],[60,35,55],[120,25,50]],
        jewel: [[340,70,45],[200,80,40],[150,70,40],[45,80,50],[280,70,45],[170,70,40],[0,75,50],[220,75,45]],
        muted: [[350,30,60],[200,30,55],[120,25,55],[45,35,60],[280,25,55],[170,30,55],[20,35,60],[240,25,55]],
        protanopia: [[45,80,60],[200,80,55],[270,60,65],[30,90,55],[180,70,50],[300,50,60],[60,70,55],[220,70,60]],
        deuteranopia: [[45,80,60],[220,80,55],[280,60,65],[30,90,55],[200,70,50],[320,50,60],[60,70,55],[240,70,60]],
        tritanopia: [[0,70,60],[180,70,55],[330,60,65],[20,80,55],[200,60,50],[350,50,60],[160,70,55],[10,70,60]]
    };

    function hslToHex(h, s, l) {
        l = Math.max(0, Math.min(100, l + settings.brightness));
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hexToHsl(hex) {
        let r = parseInt(hex.slice(1,3), 16) / 255, g = parseInt(hex.slice(3,5), 16) / 255, b = parseInt(hex.slice(5,7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        }
        return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }

    function saveHistory() {
        colorHistory = colorHistory.slice(0, historyIndex + 1);
        colorHistory.push(JSON.stringify(characterColors));
        if (colorHistory.length > 20) colorHistory.shift();
        historyIndex = colorHistory.length - 1;
    }

    function undo() {
        if (historyIndex > 0) { historyIndex--; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function redo() {
        if (historyIndex < colorHistory.length - 1) { historyIndex++; characterColors = JSON.parse(colorHistory[historyIndex]); saveData(); updateCharList(); injectPrompt(); }
    }

    function getNextColor() {
        const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES.pastel;
        const usedColors = Object.values(characterColors).map(c => c.color);
        const isDark = detectTheme() === 'dark';
        for (const [h, s, l] of theme) {
            const adjustedL = isDark ? Math.min(l + 15, 85) : Math.max(l - 15, 35);
            const color = hslToHex(h, s, adjustedL);
            if (!usedColors.includes(color)) return color;
        }
        const [h, s, l] = theme[Math.floor(Math.random() * theme.length)];
        return hslToHex((h + Math.random() * 60 - 30 + 360) % 360, s, isDark ? 75 : 40);
    }

    function checkColorConflicts() {
        const colors = Object.entries(characterColors), conflicts = [];
        for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
                const [h1,,l1] = hexToHsl(colors[i][1].color), [h2,,l2] = hexToHsl(colors[j][1].color);
                if (Math.min(Math.abs(h1-h2), 360-Math.abs(h1-h2)) < 25 && Math.abs(l1-l2) < 15) conflicts.push([colors[i][1].name, colors[j][1].name]);
            }
        }
        return conflicts;
    }

    function detectTheme() {
        const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
        return m && (parseInt(m[0])*299 + parseInt(m[1])*587 + parseInt(m[2])*114) / 1000 < 128 ? 'dark' : 'light';
    }

    function getStorageKey() { return `dc_${currentChatId}`; }
    function saveData() { if (currentChatId) localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, settings })); }
    function loadData() {
        characterColors = {};
        if (currentChatId) { try { const d = JSON.parse(localStorage.getItem(getStorageKey())); if (d?.colors) characterColors = d.colors; if (d?.settings) Object.assign(settings, d.settings); } catch {} }
        colorHistory = [JSON.stringify(characterColors)]; historyIndex = 0;
    }

    function exportColors() {
        const blob = new Blob([JSON.stringify({ colors: characterColors, settings }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dialogue-colors-${Date.now()}.json`; a.click();
    }

    function importColors(file) {
        const reader = new FileReader();
        reader.onload = e => { try { const d = JSON.parse(e.target.result); if (d.colors) characterColors = d.colors; if (d.settings) Object.assign(settings, d.settings); saveHistory(); saveData(); updateCharList(); injectPrompt(); toastr?.success?.('Imported!'); } catch { toastr?.error?.('Invalid file'); } };
        reader.readAsText(file);
    }

    function getChatId() { try { const ctx = getContext(); return ctx?.chatId || ctx?.chatID || null; } catch { return null; } }

    function ensureRegexScript() {
        if (!extension_settings) return;
        if (!Array.isArray(extension_settings.regex)) extension_settings.regex = [];
        if (extension_settings.regex.some(r => r.scriptName === 'Trim Font Colors')) return;
        extension_settings.regex.push({ id: crypto.randomUUID?.() || Math.random().toString(36).slice(2), scriptName: 'Trim Font Colors', findRegex: '/<\\/?font[^>]*>/gi', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null });
        saveSettingsDebounced();
    }

    function buildPromptInstruction() {
        if (!settings.enabled) return '';
        const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
        const themeHint = mode === 'dark' ? 'Use light colors.' : 'Use dark colors.';
        const colorList = Object.entries(characterColors).filter(([,v]) => !v.locked || v.color).map(([,v]) => `${v.name}=${v.color}${v.style ? ` (${v.style})` : ''}`).join(', ');
        const aliases = Object.entries(characterColors).filter(([,v]) => v.aliases?.length).map(([,v]) => `${v.name}/${v.aliases.join('/')}`).join('; ');
        return `[Font Color Rule: Wrap dialogue in <font color=#RRGGBB> tags. ${themeHint} ${colorList ? `ASSIGNED: ${colorList}.` : ''} ${aliases ? `ALIASES: ${aliases}.` : ''} ${settings.narratorColor ? `Narrator: ${settings.narratorColor}.` : ''} ${settings.highlightMode ? 'Also add background highlight.' : ''} Consistent colors per character.]`;
    }

    function injectPrompt() {
        setExtensionPrompt(MODULE_NAME, settings.enabled ? buildPromptInstruction() : '', 1, 0);
        const p = document.getElementById('dc-prompt-preview'); if (p) p.textContent = buildPromptInstruction() || '(disabled)';
    }

    const blocklist = new Set(['she','he','they','it','i','you','we','her','him','them','his','hers','its','their','theirs','one','someone','anyone','everyone','nobody','the','a','an','this','that','what','who','where','when','why','how','something','nothing','everything','anything','dark','light','through','between','around','behind','before','after','during','and','but','or','nor','for','yet','so','if','then','than','because','while','your','my','our','some','any','no','every','each','all','both','few','many','most','other','another','such','only','own','same','well','much','more','less','first','last','next','new','old','good','great','little','big','small','long','short','high','low','right','left','hand','eyes','face','head','voice','door','room','way','time','day','night','world','man','woman','people','thing','place','despite','still','just','even','also','very','too','quite','rather','really','almost','already','always','never','often','sometimes','here','there','now','today','soon','later','again','back','away','down','out','off','let','secret','papers','three','two','being','look','want','need','know','think','see','come','go','get','make','take','give','find','tell','ask','use','seem','leave','call','keep','put','mean','become','begin','feel','try','start','show','hear','play','run','move','live','believe','hold','bring','happen','write','sit','stand','lose','pay','meet','include','continue','set','learn','change','lead','understand','watch','follow','stop','create','speak','read','spend','grow','open','walk','win','teach','offer','remember','consider','appear','buy','wait','serve','die','send','build','stay','fall','cut','reach','kill','remain','suggest','raise','pass','sell','require','report','decide','pull','unlike','personally','actually','obviously','apparently','certainly','probably','possibly','maybe','perhaps','definitely','clearly','simply','basically','essentially','generally','usually','typically','normally','finally','eventually','suddenly','immediately','quickly','slowly','carefully','exactly','completely','entirely','absolutely','totally','fully','partly','mostly','nearly','hardly','barely','merely','yes','no','okay','sure','fine','well','right','wrong','true','false','rubs','nods','sighs','smiles','laughs','grins','shrugs','waves','looks','turns','moves','steps','walks','runs','sits','stands','leans','reaches','pulls','pushes','holds','takes','gives','puts','gets','makes','says','asks','tells','thinks','feels','knows','sees','hears','wants','needs','tries','starts','stops','goes','comes','leaves','stays','returns','enters','exits','opens','closes','touches','grabs','drops','lifts','lowers','raises','points','gestures','blinks','stares','glances','watches','notices','realizes','understands','remembers','forgets','believes','hopes','wishes','fears','loves','hates','likes','enjoys','prefers','accepts','refuses','agrees','disagrees','nope','yeah','yep','hmm','huh','wow','oh','ah','uh','um','err','hey','hello','hi','bye','goodbye','thanks','sorry','please','excuse','pardon']);

    function scanForColors(element) {
        const mesText = element.querySelector?.('.mes_text') || element;
        if (!mesText) return false;
        const html = mesText.innerHTML;
        const fontRegex = /<font\s+color=["']?#([a-fA-F0-9]{6})["']?[^>]*>([\s\S]*?)<\/font>/gi;
        let match, foundNew = false;
        while ((match = fontRegex.exec(html)) !== null) {
            const color = '#' + match[1], tagStart = match.index, tagEnd = tagStart + match[0].length;
            const beforeText = html.substring(Math.max(0, tagStart - 400), tagStart).replace(/<[^>]+>/g, ' ');
            const afterText = html.substring(tagEnd, Math.min(html.length, tagEnd + 150)).replace(/<[^>]+>/g, ' ');
            let speaker = null;
            const verbs = 'says?|said|replies?|replied|asks?|asked|whispers?|whispered|yells?|yelled|shouts?|shouted|exclaims?|exclaimed|murmurs?|murmured|mutters?|muttered|answers?|answered|calls?|called|cries?|cried|chirps?|chirped|purrs?|purred|announces?|announced|speaks?|spoke|states?|stated|remarks?|remarked|comments?|commented|explains?|explained|declares?|declared|demands?|demanded|warns?|warned|laughs?|laughed|sighs?|sighed|groans?|groaned|growls?|growled|hisses?|hissed|snaps?|snapped|screams?|screamed|mumbles?|mumbled|breathes?|breathed|gasps?|gasped|huffs?|huffed|scoffs?|scoffed|adds?|added|notes?|noted|continues?|continued|offers?|offered|zips?|zipped|floats?|floated|shoots?|shot';
            const bv = beforeText.match(new RegExp(`([A-Z][a-z]{2,})\\s+(?:${verbs})[,.:]*\\s*["'"「『«]?\\s*$`, 'i'));
            if (bv) speaker = bv[1];
            if (!speaker) { const av = afterText.match(new RegExp(`^["'"」』»]?\\s*([A-Z][a-z]{2,})\\s+(?:${verbs})`, 'i')); if (av) speaker = av[1]; }
            if (!speaker) { const sentences = beforeText.split(/[.!?]+\s*/); for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 2); i--) { const m = sentences[i].trim().match(/^([A-Z][a-z]{2,})\b/); if (m && !blocklist.has(m[1].toLowerCase())) { speaker = m[1]; break; } } }
            if (speaker && !blocklist.has(speaker.toLowerCase())) {
                const key = speaker.toLowerCase();
                // Check aliases
                for (const [k, v] of Object.entries(characterColors)) { if (v.aliases?.map(a => a.toLowerCase()).includes(key)) { if (!v.locked) { v.color = color; } foundNew = true; break; } }
                if (!characterColors[key]) { characterColors[key] = { color, name: speaker, locked: false, aliases: [], style: '', dialogueCount: 1 }; foundNew = true; }
                else { characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1; if (!characterColors[key].locked) characterColors[key].color = color; }
            }
        }
        return foundNew;
    }

    function scanAllMessages() {
        Object.values(characterColors).forEach(c => c.dialogueCount = 0);
        document.querySelectorAll('.mes').forEach(m => scanForColors(m));
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        const conflicts = checkColorConflicts();
        if (conflicts.length) toastr?.warning?.(`Similar: ${conflicts.slice(0,3).map(c => c.join(' & ')).join(', ')}`);
        toastr?.info?.(`Found ${Object.keys(characterColors).length} characters`);
    }

    function onNewMessage() {
        if (!settings.enabled) return;
        setTimeout(() => { const msgs = document.querySelectorAll('.mes'); if (msgs.length) { scanForColors(msgs[msgs.length - 1]); saveData(); updateCharList(); injectPrompt(); } }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        characterColors[key] = { color: color || getNextColor(), name: name.trim(), locked: false, aliases: [], style: '', dialogueCount: 0 };
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function swapColors(key1, key2) {
        const tmp = characterColors[key1].color;
        characterColors[key1].color = characterColors[key2].color;
        characterColors[key2].color = tmp;
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        const entries = Object.entries(characterColors);
        list.innerHTML = entries.length ? entries.map(([k, v]) => `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''}" data-key="${k}" style="display:flex;align-items:center;gap:4px;margin:3px 0;padding:2px;border-radius:4px;${swapMode === k ? 'background:var(--SmartThemeQuoteColor);' : ''}">
                <span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0;"></span>
                <input type="color" value="${v.color}" data-key="${k}" style="width:18px;height:18px;padding:0;border:none;cursor:pointer;">
                <span style="flex:1;color:${v.color};font-size:0.85em;" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + v.aliases.join(', ') : ''}">${v.name}${v.style ? ` [${v.style[0].toUpperCase()}]` : ''}</span>
                <span style="font-size:0.7em;opacity:0.6;">${v.dialogueCount || 0}</span>
                <button class="dc-lock menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Lock color">${v.locked ? '🔒' : '🔓'}</button>
                <button class="dc-swap menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Swap colors">⇄</button>
                <button class="dc-style menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Style">S</button>
                <button class="dc-alias menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Aliases">+</button>
                <button class="dc-del menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;">×</button>
            </div>`).join('') : '<small style="opacity:0.6;">No characters</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => { i.oninput = () => { characterColors[i.dataset.key].color = i.value; saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-del').forEach(b => { b.onclick = () => { delete characterColors[b.dataset.key]; saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
        list.querySelectorAll('.dc-lock').forEach(b => { b.onclick = () => { characterColors[b.dataset.key].locked = !characterColors[b.dataset.key].locked; saveData(); updateCharList(); }; });
        list.querySelectorAll('.dc-swap').forEach(b => { b.onclick = () => {
            if (!swapMode) { swapMode = b.dataset.key; updateCharList(); toastr?.info?.('Click another character to swap'); }
            else if (swapMode === b.dataset.key) { swapMode = null; updateCharList(); }
            else { swapColors(swapMode, b.dataset.key); swapMode = null; }
        }; });
        list.querySelectorAll('.dc-style').forEach(b => { b.onclick = () => {
            const styles = ['', 'bold', 'italic', 'bold italic'];
            const curr = characterColors[b.dataset.key].style || '';
            characterColors[b.dataset.key].style = styles[(styles.indexOf(curr) + 1) % styles.length];
            saveData(); injectPrompt(); updateCharList();
        }; });
        list.querySelectorAll('.dc-alias').forEach(b => { b.onclick = () => {
            const alias = prompt('Add alias for ' + characterColors[b.dataset.key].name + ':');
            if (alias?.trim()) { characterColors[b.dataset.key].aliases = characterColors[b.dataset.key].aliases || []; characterColors[b.dataset.key].aliases.push(alias.trim()); saveData(); injectPrompt(); updateCharList(); }
        }; });
    }

    function autoAssignFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (char?.name && !characterColors[char.name.toLowerCase()]) {
                addCharacter(char.name);
                toastr?.success?.(`Added ${char.name}`);
            }
        } catch {}
    }

    function createUI() {
        if (document.getElementById('dc-ext')) return;
        const html = `
        <div id="dc-ext" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>Dialogue Colors</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content" style="padding:10px;display:flex;flex-direction:column;gap:6px;font-size:0.9em;">
                <label class="checkbox_label"><input type="checkbox" id="dc-enabled"><span>Enable</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-highlight"><span>Highlight mode</span></label>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Theme:</label><select id="dc-theme" class="text_pole" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Palette:</label><select id="dc-palette" class="text_pole" style="flex:1;"><option value="pastel">Pastel</option><option value="neon">Neon</option><option value="earth">Earth</option><option value="jewel">Jewel</option><option value="muted">Muted</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Bright:</label><input type="range" id="dc-brightness" min="-30" max="30" value="0" style="flex:1;"><span id="dc-bright-val">0</span></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Narrator:</label><input type="color" id="dc-narrator" value="#888888" style="width:24px;height:20px;"><button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <div style="display:flex;gap:4px;"><button id="dc-scan" class="menu_button" style="flex:1;">Scan</button><button id="dc-clear" class="menu_button" style="flex:1;">Clear</button><button id="dc-card" class="menu_button" style="flex:1;" title="Add from card">Card</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-undo" class="menu_button" style="flex:1;">↶</button><button id="dc-redo" class="menu_button" style="flex:1;">↷</button><button id="dc-export" class="menu_button" style="flex:1;">Export</button><button id="dc-import" class="menu_button" style="flex:1;">Import</button></div>
                <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                <div style="display:flex;gap:4px;"><input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" style="flex:1;padding:3px;"><button id="dc-add-btn" class="menu_button" style="padding:3px 8px;">+</button></div>
                <small>Characters: <span id="dc-count">0</span></small>
                <div id="dc-char-list" style="max-height:150px;overflow-y:auto;"></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <small>Prompt:</small>
                <div id="dc-prompt-preview" style="font-size:0.7em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;opacity:0.7;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        const $ = id => document.getElementById(id);
        $('dc-enabled').checked = settings.enabled; $('dc-enabled').onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        $('dc-highlight').checked = settings.highlightMode; $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); };
        $('dc-theme').value = settings.themeMode; $('dc-theme').onchange = e => { settings.themeMode = e.target.value; saveData(); injectPrompt(); };
        $('dc-palette').value = settings.colorTheme; $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); };
        $('dc-brightness').value = settings.brightness || 0; $('dc-bright-val').textContent = settings.brightness || 0;
        $('dc-brightness').oninput = e => { settings.brightness = parseInt(e.target.value); $('dc-bright-val').textContent = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator').value = settings.narratorColor || '#888888'; $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => { characterColors = {}; saveHistory(); saveData(); injectPrompt(); updateCharList(); };
        $('dc-card').onclick = autoAssignFromCard;
        $('dc-undo').onclick = undo; $('dc-redo').onclick = redo;
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };
        updateCharList();
        $('dc-prompt-preview').textContent = buildPromptInstruction();
        $('dc-count').textContent = Object.keys(characterColors).length;
    }

    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled) injectPrompt(); };

    console.log('Dialogue Colors: Initializing...');
    currentChatId = getChatId(); loadData(); ensureRegexScript();
    const waitUI = setInterval(() => { if (document.getElementById('extensions_settings')) { clearInterval(waitUI); createUI(); injectPrompt(); } }, 500);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.CHAT_CHANGED, () => { currentChatId = getChatId(); loadData(); updateCharList(); injectPrompt(); });
    console.log('Dialogue Colors: Ready!');
})();
