(async function() {
    'use strict';
    
    const { extension_settings, saveSettingsDebounced, getContext } = await import('../../../extensions.js');
    const { eventSource, event_types, setExtensionPrompt } = await import('../../../../script.js');

    const MODULE_NAME = 'dialogue-colors';
    let characterColors = {};
    let colorHistory = [];
    let historyIndex = -1;
    let swapMode = null;
    let customPatterns = [];
    let potentialCharacters = {};
    let sortMode = 'name';
    let searchTerm = '';
    let lastSpeaker = '';
    let settings = { enabled: true, themeMode: 'auto', narratorColor: '', colorTheme: 'pastel', brightness: 0, highlightMode: false, autoScanOnLoad: true, showLegend: false, minOccurrences: 2, thoughtSymbols: '*', ttsHints: {} };

    const COLOR_THEMES = {
        pastel: [[340,70,75],[200,70,75],[120,50,70],[45,80,70],[280,60,75],[170,60,70],[20,80,75],[240,60,75]],
        neon: [[320,100,60],[180,100,50],[90,100,50],[45,100,55],[270,100,60],[150,100,45],[0,100,60],[210,100,55]],
        earth: [[25,50,55],[45,40,50],[90,30,45],[150,35,45],[180,30,50],[30,60,60],[60,35,55],[120,25,50]],
        jewel: [[340,70,45],[200,80,40],[150,70,40],[45,80,50],[280,70,45],[170,70,40],[0,75,50],[220,75,45]],
        muted: [[350,30,60],[200,30,55],[120,25,55],[45,35,60],[280,25,55],[170,30,55],[20,35,60],[240,25,55]],
        jade: [[170,60,55],[150,55,50],[160,65,45],[165,50,60],[155,70,40],[140,45,55],[175,55,50],[130,60,45]],
        forest: [[120,50,50],[90,45,45],[100,55,40],[110,40,55],[80,50,35],[130,45,50],[95,60,45],[85,55,40]],
        ocean: [[200,70,60],[190,65,55],[180,60,65],[210,55,60],[170,75,50],[220,50,65],[195,80,45],[205,60,70]],
        sunset: [[15,85,60],[35,90,55],[25,80,65],[40,75,70],[30,95,50],[20,70,75],[45,85,55],[10,80,60]],
        aurora: [[280,50,70],[300,55,65],[260,45,75],[290,60,60],[270,65,55],[310,40,80],[285,70,50],[275,55,70]],
        warm: [[20,70,65],[35,75,60],[45,65,70],[30,80,55],[40,85,50],[25,90,60],[50,60,75],[15,75,65]],
        cool: [[210,60,70],[240,55,65],[200,65,75],[225,70,60],[190,75,55],[250,50,80],[215,80,50],[235,60,75]],
        berry: [[330,70,60],[350,65,55],[320,60,70],[340,75,50],[360,80,45],[310,55,75],[345,85,40],[325,70,65]],
        monochrome: [[0,0,30],[0,0,40],[0,0,50],[0,0,60],[0,0,70],[0,0,80],[0,0,90],[0,0,20]],
        protanopia: [[45,80,60],[200,80,55],[270,60,65],[30,90,55],[180,70,50],[300,50,60],[60,70,55],[220,70,60]],
        deuteranopia: [[45,80,60],[220,80,55],[280,60,65],[30,90,55],[200,70,50],[320,50,60],[60,70,55],[240,70,60]],
        tritanopia: [[0,70,60],[180,70,55],[330,60,65],[20,80,55],[200,60,50],[350,50,60],[160,70,55],[10,70,60]]
    };
    const VERBS = 'says?|said|replies?|replied|asks?|asked|whispers?|whispered|yells?|yelled|shouts?|shouted|exclaims?|exclaimed|murmurs?|murmured|mutters?|muttered|answers?|answered|calls?|called|cries?|cried|chirps?|chirped|purrs?|purred|announces?|announced|speaks?|spoke|states?|stated|remarks?|remarked|comments?|commented|explains?|explained|declares?|declared|demands?|demanded|warns?|warned|laughs?|laughed|sighs?|sighed|groans?|groaned|growls?|growled|hisses?|hissed|snaps?|snapped|screams?|screamed|mumbles?|mumbled|breathes?|breathed|gasps?|gasped|huffs?|huffed|scoffs?|scoffed|adds?|added|notes?|noted|continues?|continued|offers?|offered|zips?|zipped|floats?|floated|shoots?|shot';
    const BLOCKLIST = new Set(['she','he','they','it','i','you','we','her','him','them','his','hers','its','their','theirs','one','someone','anyone','everyone','nobody','the','a','an','this','that','what','who','where','when','why','how','something','nothing','everything','anything','dark','light','through','between','around','behind','before','after','during','and','but','or','nor','for','yet','so','if','then','than','because','while','your','my','our','some','any','no','every','each','all','both','few','many','most','other','another','such','only','own','same','well','much','more','less','first','last','next','new','old','good','great','little','big','small','long','short','high','low','right','left','hand','eyes','face','head','voice','door','room','way','time','day','night','world','man','woman','people','thing','place','despite','still','just','even','also','very','too','quite','rather','really','almost','already','always','never','often','sometimes','here','there','now','today','soon','later','again','back','away','down','out','off','let','secret','papers','three','two','being','look','want','need','know','think','see','come','go','get','make','take','give','find','tell','ask','use','seem','leave','call','keep','put','mean','become','begin','feel','try','start','show','hear','play','run','move','live','believe','hold','bring','happen','write','sit','stand','lose','pay','meet','include','continue','set','learn','change','lead','understand','watch','follow','stop','create','speak','read','spend','grow','open','walk','win','teach','offer','remember','consider','appear','buy','wait','serve','die','send','build','stay','fall','cut','reach','kill','remain','suggest','raise','pass','sell','require','report','decide','pull','unlike','personally','actually','obviously','apparently','certainly','probably','possibly','maybe','perhaps','definitely','clearly','simply','basically','essentially','generally','usually','typically','normally','finally','eventually','suddenly','immediately','quickly','slowly','carefully','exactly','completely','entirely','absolutely','totally','fully','partly','mostly','nearly','hardly','barely','merely','yes','no','okay','sure','fine','well','right','wrong','true','false','rubs','nods','sighs','smiles','laughs','grins','shrugs','waves','looks','turns','moves','steps','walks','runs','sits','stands','leans','reaches','pulls','pushes','holds','takes','gives','puts','gets','makes','says','asks','tells','thinks','feels','knows','sees','hears','wants','needs','tries','starts','stops','goes','comes','leaves','stays','returns','enters','exits','opens','closes','touches','grabs','drops','lifts','lowers','raises','points','gestures','blinks','stares','glances','watches','notices','realizes','understands','remembers','forgets','believes','hopes','wishes','fears','loves','hates','likes','enjoys','prefers','accepts','refuses','agrees','disagrees','nope','yeah','yep','hmm','huh','wow','oh','ah','uh','um','err','hey','hello','hi','bye','goodbye','thanks','sorry','please','excuse','pardon']);
    let cachedTheme = null;
    let cachedIsDark = null;
    let injectDebouncedTimer = null;

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
        if (cachedIsDark === null) {
            const mode = settings.themeMode === 'auto' ? detectTheme() : settings.themeMode;
            cachedIsDark = mode === 'dark';
        }
        const isDark = cachedIsDark;
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

    function suggestColorForName(name) {
        const n = name.toLowerCase();
        const colorMap = { red: 0, rose: 340, pink: 340, magenta: 330, purple: 280, violet: 270, blue: 220, cyan: 180, teal: 170, green: 120, lime: 90, yellow: 50, gold: 45, orange: 30, brown: 25, grey: 0, gray: 0 };
        for (const [k, h] of Object.entries(colorMap)) if (n.includes(k)) return hslToHex(h, 70, 50);
        return null;
    }

    function regenerateAllColors() {
        invalidateThemeCache();
        Object.entries(characterColors).sort((a, b) => (a[1].dialogueCount || 0) - (b[1].dialogueCount || 0)).forEach(([, char]) => {
            if (!char.locked) char.color = suggestColorForName(char.name) || getNextColor();
        });
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.('Colors regenerated');
    }

    function autoResolveConflicts() {
        const conflicts = checkColorConflicts();
        if (!conflicts.length) { toastr?.info?.('No conflicts found'); return; }
        let fixed = 0;
        conflicts.forEach(([name1, name2]) => {
            const key1 = name1.toLowerCase(), key2 = name2.toLowerCase();
            if (!characterColors[key1].locked) { characterColors[key1].color = getNextColor(); fixed++; }
            else if (!characterColors[key2].locked) { characterColors[key2].color = getNextColor(); fixed++; }
        });
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        toastr?.success?.(`Fixed ${fixed} conflicts`);
    }

    function saveColorPreset() {
        const name = prompt('Preset name:');
        if (!name?.trim()) return;
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        presets[name] = Object.entries(characterColors).map(([k, v]) => ({ name: v.name, color: v.color, style: v.style }));
        localStorage.setItem('dc_presets', JSON.stringify(presets));
        toastr?.success?.('Preset saved');
    }

    function loadColorPreset() {
        const presets = JSON.parse(localStorage.getItem('dc_presets') || '{}');
        const names = Object.keys(presets);
        if (!names.length) { toastr?.info?.('No presets saved'); return; }
        const name = prompt('Load preset:\n' + names.map(n => `• ${n}`).join('\n'));
        if (name && presets[name]) {
            presets[name].forEach(p => {
                const key = p.name.toLowerCase();
                if (characterColors[key]) { characterColors[key].color = p.color; characterColors[key].style = p.style || ''; }
                else { characterColors[key] = { color: p.color, name: p.name, locked: false, aliases: [], style: p.style || '', dialogueCount: 0 }; }
            });
            saveHistory(); saveData(); updateCharList(); injectPrompt();
            toastr?.success?.('Preset loaded');
        }
    }

    function getSortedEntries() {
        const entries = Object.entries(characterColors).filter(([, v]) => !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase()));
        if (sortMode === 'count') entries.sort((a, b) => (b[1].dialogueCount || 0) - (a[1].dialogueCount || 0));
        else entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
        return entries;
    }

    function getBadge(count) {
        if (count >= 100) return '💎';
        if (count >= 50) return '⭐';
        return '';
    }

    function detectTheme() {
        if (cachedTheme) return cachedTheme;
        const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
        cachedTheme = m && (parseInt(m[0])*299 + parseInt(m[1])*587 + parseInt(m[2])*114) / 1000 < 128 ? 'dark' : 'light';
        return cachedTheme;
    }
    function invalidateThemeCache() { cachedTheme = null; cachedIsDark = null; }

    function getCharKey() { try { const ctx = getContext(); return ctx?.characters?.[ctx?.characterId]?.avatar || ctx?.characterId || null; } catch { return null; } }
    function getStorageKey() { return `dc_char_${getCharKey() || 'default'}`; }
    function saveData() { localStorage.setItem(getStorageKey(), JSON.stringify({ colors: characterColors, settings })); localStorage.setItem('dc_patterns', JSON.stringify(customPatterns)); }
    function loadData() {
        characterColors = {};
        try { const d = JSON.parse(localStorage.getItem(getStorageKey())); if (d?.colors) characterColors = d.colors; if (d?.settings) Object.assign(settings, d.settings); } catch {}
        try { customPatterns = JSON.parse(localStorage.getItem('dc_patterns')) || []; } catch {}
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
        let thoughts = '';
        if (settings.thoughtSymbols) {
            const symbols = settings.thoughtSymbols.split('').map(s => `'${s}'`).join(' or ');
            thoughts = ` Inner thoughts (text wrapped in ${symbols}) should use the current speaker's color.`;
        }
        return `[Font Color Rule: Wrap dialogue in <font color=#RRGGBB> tags. ${themeHint} ${colorList ? `ASSIGNED: ${colorList}.` : ''} ${aliases ? `ALIASES: ${aliases}.` : ''} ${settings.narratorColor ? `Narrator: ${settings.narratorColor}.` : ''} ${thoughts} ${settings.highlightMode ? 'Also add background highlight.' : ''} Consistent colors per character.]`;
    }

    function buildColoredPromptPreview() {
        if (!settings.enabled) return '<span style="opacity:0.5">(disabled)</span>';
        const entries = Object.entries(characterColors);
        if (!entries.length) return '<span style="opacity:0.5">(no characters)</span>';
        return entries.map(([,v]) => `<span style="color:${v.color}">${v.name}</span>`).join(', ');
    }

    function injectPrompt() {
        if (injectDebouncedTimer) clearTimeout(injectDebouncedTimer);
        injectDebouncedTimer = setTimeout(() => {
            setExtensionPrompt(MODULE_NAME, settings.enabled ? buildPromptInstruction() : '', 1, 0);
            const p = document.getElementById('dc-prompt-preview');
            if (p) p.innerHTML = buildColoredPromptPreview();
        }, 50);
    }

    function createLegend() {
        let legend = document.getElementById('dc-legend-float');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'dc-legend-float';
            legend.style.cssText = 'position:fixed;top:60px;right:10px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;z-index:9999;font-size:0.8em;max-width:150px;display:none;';
            document.body.appendChild(legend);
        }
        return legend;
    }

    function updateLegend() {
        const legend = createLegend();
        const entries = Object.entries(characterColors);
        if (!entries.length || !settings.showLegend) { legend.style.display = 'none'; return; }
        legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">Characters</div>' + 
            entries.map(([,v]) => `<div style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${v.color};"></span><span style="color:${v.color}">${v.name}</span><span style="opacity:0.5;font-size:0.8em;">${v.dialogueCount||0}</span></div>`).join('');
        legend.style.display = settings.showLegend ? 'block' : 'none';
    }

    function getDialogueStats() {
        const entries = Object.entries(characterColors);
        const total = entries.reduce((s, [,v]) => s + (v.dialogueCount || 0), 0);
        return entries.map(([,v]) => ({ name: v.name, count: v.dialogueCount || 0, pct: total ? Math.round((v.dialogueCount || 0) / total * 100) : 0, color: v.color })).sort((a,b) => b.count - a.count);
    }

    function showStatsPopup() {
        const stats = getDialogueStats();
        if (!stats.length && !Object.keys(potentialCharacters).length) { toastr?.info?.('No dialogue data'); return; }
        const maxCount = Math.max(...stats.map(s => s.count), 1);
        let html = stats.map(s => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:60px;color:${s.color}">${s.name}</span><div style="flex:1;height:12px;background:var(--SmartThemeBlurTintColor);border-radius:3px;overflow:hidden;"><div style="width:${s.count/maxCount*100}%;height:100%;background:${s.color};"></div></div><span style="width:40px;text-align:right;font-size:0.8em;">${s.count} (${s.pct}%)</span></div>`).join('');
        if (Object.keys(potentialCharacters).length) {
            html += `<hr style="margin:8px 0;opacity:0.2;"><div style="font-weight:bold;margin-bottom:4px;">Pending (${Object.keys(potentialCharacters).length})</div>`;
            html += Object.entries(potentialCharacters).map(([k, v]) => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;opacity:0.7;"><span style="width:60px;">${v.name}</span><span style="flex:1;font-size:0.8em;">${v.count}/${settings.minOccurrences}</span><button class="dc-add-pending menu_button" style="padding:1px 6px;font-size:0.7em;" data-key="${k}">Add</button></div>`).join('');
        }
        const popup = document.createElement('div');
        popup.id = 'dc-stats-popup';
        popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--SmartThemeBodyColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:16px;z-index:10000;min-width:300px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Dialogue Statistics</div>${html}<button class="dc-close-popup menu_button" style="margin-top:10px;width:100%;">Close</button>`;
        popup.querySelector('.dc-close-popup').onclick = () => popup.remove();
        popup.querySelectorAll('.dc-add-pending').forEach(b => { b.onclick = () => { const p = potentialCharacters[b.dataset.key]; if (p) { addCharacter(p.name, [...p.colors].pop()); updateCharList(); popup.remove(); showStatsPopup(); } }; });
        document.body.appendChild(popup);
    }

    function saveToCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            if (!char) { toastr?.error?.('No character loaded'); return; }
            if (!char.data) char.data = {};
            if (!char.data.extensions) char.data.extensions = {};
            char.data.extensions.dialogueColors = { colors: characterColors, settings };
            saveData();
            try { saveSettingsDebounced?.(); } catch {}
            toastr?.success?.('Saved to card');
        } catch { toastr?.error?.('Failed to save to card'); }
    }

    function loadFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) { characterColors = data.colors; if (data.settings) Object.assign(settings, data.settings); saveHistory(); saveData(); updateCharList(); injectPrompt(); toastr?.success?.('Loaded from card'); }
            else toastr?.info?.('No saved colors in card');
        } catch { toastr?.error?.('Failed to load from card'); }
    }

    function tryLoadFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const data = char?.data?.extensions?.dialogueColors;
            if (data?.colors) {
                characterColors = data.colors;
                if (data.settings) Object.assign(settings, data.settings);
                saveHistory();
                saveData();
                console.log('Dialogue Colors: Loaded from card');
            }
        } catch {}
    }

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
            const bv = beforeText.match(new RegExp(`([A-Z][a-z]{2,})\\s+(?:${VERBS})[,.:]*\\s*["'"「『«]?\\s*$`, 'i'));
            if (bv) speaker = bv[1];
            if (!speaker) { const av = afterText.match(new RegExp(`^["'"」』»]?\\s*([A-Z][a-z]{2,})\\s+(?:${VERBS})`, 'i')); if (av) speaker = av[1]; }
            if (!speaker) { const sentences = beforeText.split(/[.!?]+\s*/); for (let i = sentences.length - 1; i >= Math.max(0, sentences.length - 2); i--) { const m = sentences[i].trim().match(/^([A-Z][a-z]{2,})\b/); if (m && !BLOCKLIST.has(m[1].toLowerCase())) { speaker = m[1]; break; } } }
            if (speaker && !BLOCKLIST.has(speaker.toLowerCase())) {
                const key = speaker.toLowerCase();
                lastSpeaker = color;
                if (characterColors[key]?.locked) { characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1; lastSpeaker = characterColors[key].color; continue; }
                for (const [k, v] of Object.entries(characterColors)) { if (v.aliases?.map(a => a.toLowerCase()).includes(key)) { if (!v.locked) { v.color = color; lastSpeaker = v.color; } foundNew = true; break; } }
                if (!characterColors[key]) {
                    potentialCharacters[key] = { name: speaker, colors: (potentialCharacters[key]?.colors || new Set()).add(color), count: (potentialCharacters[key]?.count || 0) + 1 };
                    if (potentialCharacters[key].count >= (settings.minOccurrences || 2)) {
                        characterColors[key] = { color: [...potentialCharacters[key].colors].pop(), name: speaker, locked: false, aliases: [], style: '', dialogueCount: potentialCharacters[key].count };
                        delete potentialCharacters[key];
                        foundNew = true;
                    }
                } else { characterColors[key].dialogueCount = (characterColors[key].dialogueCount || 0) + 1; if (!characterColors[key].locked) { characterColors[key].color = color; lastSpeaker = color; } }
            }
        }
        return foundNew;
    }

    function scanAllMessages() {
        Object.values(characterColors).forEach(c => c.dialogueCount = 0);
        potentialCharacters = {};
        document.querySelectorAll('.mes').forEach(m => scanForColors(m));
        saveHistory(); saveData(); updateCharList(); injectPrompt();
        const conflicts = checkColorConflicts();
        if (conflicts.length) toastr?.warning?.(`Similar: ${conflicts.slice(0,3).map(c => c.join(' & ')).join(', ')}`);
        const pendingCount = Object.keys(potentialCharacters).length;
        let msg = `Found ${Object.keys(characterColors).length} characters`;
        if (pendingCount > 0) msg += ` (${pendingCount} pending, need ${settings.minOccurrences}+ occurrences)`;
        toastr?.info?.(msg);
    }

    function onNewMessage() {
        if (!settings.enabled) return;
        setTimeout(() => { const msgs = document.querySelectorAll('.mes'); if (msgs.length) { scanForColors(msgs[msgs.length - 1]); colorThoughts(msgs[msgs.length - 1]); saveData(); updateCharList(); injectPrompt(); } }, 600);
    }

    function addCharacter(name, color) {
        if (!name.trim()) return;
        const key = name.trim().toLowerCase();
        const suggested = color || suggestColorForName(name) || getNextColor();
        characterColors[key] = { color: suggested, name: name.trim(), locked: false, aliases: [], style: '', dialogueCount: potentialCharacters[key]?.count || 0 };
        delete potentialCharacters[key];
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function addCustomPattern(pattern) {
        try { new RegExp(pattern); customPatterns.push(pattern); saveData(); toastr?.success?.('Pattern added'); }
        catch { toastr?.error?.('Invalid regex'); }
    }

    function swapColors(key1, key2) {
        const tmp = characterColors[key1].color;
        characterColors[key1].color = characterColors[key2].color;
        characterColors[key2].color = tmp;
        saveHistory(); saveData(); updateCharList(); injectPrompt();
    }

    function colorThoughts(element) {
        if (!settings.thoughtSymbols) return;
        const mesText = element.querySelector?.('.mes_text');
        if (!mesText) return;
        const symbols = settings.thoughtSymbols.split('').filter(s => s.trim());
        if (!symbols.length) return;
        symbols.forEach(symbol => {
            const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escaped}([^]*?)${escaped})`, 'g');
            mesText.innerHTML = mesText.innerHTML.replace(regex, `<font color="${lastSpeaker || '#888888'}">$1</font>`);
        });
    }

    function updateCharList() {
        const list = document.getElementById('dc-char-list'); if (!list) return;
        const entries = getSortedEntries();
        document.getElementById('dc-count').textContent = Object.keys(characterColors).length;
        list.innerHTML = entries.length ? entries.map(([k, v]) => `
            <div class="dc-char ${swapMode === k ? 'dc-swap-selected' : ''}" data-key="${k}" style="display:flex;align-items:center;gap:4px;margin:3px 0;padding:2px;border-radius:4px;${swapMode === k ? 'background:var(--SmartThemeQuoteColor);' : ''}">
                <span style="width:8px;height:8px;border-radius:50%;background:${v.color};flex-shrink:0;"></span>
                <input type="color" value="${v.color}" data-key="${k}" style="width:18px;height:18px;padding:0;border:none;cursor:pointer;">
                <span style="flex:1;color:${v.color};font-size:0.85em;" title="Dialogues: ${v.dialogueCount || 0}${v.aliases?.length ? '\nAliases: ' + v.aliases.join(', ') : ''}">${v.name}${v.style ? ` [${v.style[0].toUpperCase()}]` : ''}${getBadge(v.dialogueCount || 0)}</span>
                <span style="font-size:0.7em;opacity:0.6;">${v.dialogueCount || 0}</span>
                <button class="dc-lock menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Lock color">${v.locked ? '🔒' : '🔓'}</button>
                <button class="dc-swap menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Swap colors">⇄</button>
                <button class="dc-style menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Style">S</button>
                <button class="dc-alias menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;" title="Aliases">+</button>
                <button class="dc-del menu_button" data-key="${k}" style="padding:1px 4px;font-size:0.7em;">×</button>
            </div>`).join('') : '<small style="opacity:0.6;">No characters</small>';

        list.querySelectorAll('input[type="color"]').forEach(i => { i.oninput = () => { const c = characterColors[i.dataset.key]; c.color = i.value; c.aliases?.forEach(a => { const ak = a.toLowerCase(); if (characterColors[ak]) characterColors[ak].color = i.value; }); saveHistory(); saveData(); injectPrompt(); updateCharList(); }; });
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
        updateLegend();
    }

    function autoAssignFromCard() {
        try {
            const ctx = getContext();
            const char = ctx?.characters?.[ctx?.characterId];
            const key = char?.name?.toLowerCase();
            if (key && !characterColors[key]) {
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
                <label class="checkbox_label"><input type="checkbox" id="dc-autoscan"><span>Auto-scan on chat load</span></label>
                <label class="checkbox_label"><input type="checkbox" id="dc-legend"><span>Show floating legend</span></label>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Theme:</label><select id="dc-theme" class="text_pole" style="flex:1;"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Palette:</label><select id="dc-palette" class="text_pole" style="flex:1;"><option value="pastel">Pastel</option><option value="neon">Neon</option><option value="earth">Earth</option><option value="jewel">Jewel</option><option value="muted">Muted</option><option value="jade">Jade</option><option value="forest">Forest</option><option value="ocean">Ocean</option><option value="sunset">Sunset</option><option value="aurora">Aurora</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="berry">Berry</option><option value="monochrome">Monochrome</option><option value="protanopia">Protanopia</option><option value="deuteranopia">Deuteranopia</option><option value="tritanopia">Tritanopia</option></select></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;" title="Min dialogues before auto-adding">Min:</label><input type="number" id="dc-min-occ" min="1" max="5" value="2" class="text_pole" style="flex:1;"><small style="opacity:0.6;">occurrences</small></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Bright:</label><input type="range" id="dc-brightness" min="-30" max="30" value="0" style="flex:1;"><span id="dc-bright-val">0</span></div>
                <div style="display:flex;gap:4px;align-items:center;"><label style="width:50px;">Narr:</label><input type="color" id="dc-narrator" value="#888888" style="width:24px;height:20px;"><button id="dc-narrator-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;"><label style="width:50px;" title="Symbols for inner thoughts (*「etc)">Think:</label><input type="text" id="dc-thought-symbols" placeholder="*" class="text_pole" style="width:60px;padding:3px;" readonly><button id="dc-thought-add" class="menu_button" style="padding:2px 6px;font-size:0.8em;">+</button><button id="dc-thought-clear" class="menu_button" style="padding:2px 6px;font-size:0.8em;">Clear</button></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <div style="display:flex;gap:4px;"><button id="dc-scan" class="menu_button" style="flex:1;">Scan</button><button id="dc-clear" class="menu_button" style="flex:1;">Clear</button><button id="dc-stats" class="menu_button" style="flex:1;" title="Dialogue statistics">Stats</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-undo" class="menu_button" style="flex:1;">↶</button><button id="dc-redo" class="menu_button" style="flex:1;">↷</button><button id="dc-fix-conflicts" class="menu_button" style="flex:1;" title="Auto-fix color conflicts">Fix</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-regen" class="menu_button" style="flex:1;" title="Regenerate all colors">Regen</button><button id="dc-save-preset" class="menu_button" style="flex:1;" title="Save color preset">Preset↓</button><button id="dc-load-preset" class="menu_button" style="flex:1;" title="Load color preset">Preset↑</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-export" class="menu_button" style="flex:1;">Export</button><button id="dc-import" class="menu_button" style="flex:1;">Import</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-card" class="menu_button" style="flex:1;" title="Add from card">+Card</button><button id="dc-save-card" class="menu_button" style="flex:1;" title="Save to card">Save→Card</button><button id="dc-load-card" class="menu_button" style="flex:1;" title="Load from card">Card→Load</button></div>
                <div style="display:flex;gap:4px;"><button id="dc-del-locked" class="menu_button" style="flex:1;" title="Delete all locked characters">DelLocked</button><button id="dc-del-unlocked" class="menu_button" style="flex:1;" title="Delete all unlocked characters">DelUnlocked</button><button id="dc-reset" class="menu_button" style="flex:1;" title="Reset to default colors">Reset</button></div>
                <input type="file" id="dc-import-file" accept=".json" style="display:none;">
                <div style="display:flex;gap:4px;"><input type="text" id="dc-search" placeholder="Search characters..." class="text_pole" style="flex:1;padding:3px;"></div>
                <div style="display:flex;gap:4px;align-items:center;"><label>Sort:</label><select id="dc-sort" class="text_pole" style="flex:1;"><option value="name">Name</option><option value="count">Dialogue Count</option></select></div>
                <div style="display:flex;gap:4px;"><input type="text" id="dc-add-name" placeholder="Add character..." class="text_pole" style="flex:1;padding:3px;"><button id="dc-add-btn" class="menu_button" style="padding:3px 8px;">+</button></div>
                <div style="display:flex;gap:4px;"><input type="text" id="dc-pattern" placeholder="Custom regex pattern..." class="text_pole" style="flex:1;padding:3px;font-size:0.8em;"><button id="dc-pattern-btn" class="menu_button" style="padding:3px 6px;font-size:0.8em;">+Pat</button><button id="dc-patterns" class="menu_button" style="padding:3px 6px;font-size:0.8em;">Patterns</button></div>
                <small>Characters: <span id="dc-count">0</span> (⭐=50+, 💎=100+)</small>
                <div id="dc-char-list" style="max-height:150px;overflow-y:auto;"></div>
                <hr style="margin:2px 0;opacity:0.2;">
                <small>Preview:</small>
                <div id="dc-prompt-preview" style="font-size:0.75em;max-height:40px;overflow-y:auto;padding:3px;background:var(--SmartThemeBlurTintColor);border-radius:3px;"></div>
            </div>
        </div>`;
        document.getElementById('extensions_settings')?.insertAdjacentHTML('beforeend', html);

        const $ = id => document.getElementById(id);
        $('dc-enabled').checked = settings.enabled; $('dc-enabled').onchange = e => { settings.enabled = e.target.checked; saveData(); injectPrompt(); };
        $('dc-highlight').checked = settings.highlightMode; $('dc-highlight').onchange = e => { settings.highlightMode = e.target.checked; saveData(); injectPrompt(); };
        $('dc-autoscan').checked = settings.autoScanOnLoad !== false; $('dc-autoscan').onchange = e => { settings.autoScanOnLoad = e.target.checked; saveData(); };
        $('dc-legend').checked = settings.showLegend; $('dc-legend').onchange = e => { settings.showLegend = e.target.checked; saveData(); updateLegend(); };
        $('dc-theme').value = settings.themeMode; $('dc-theme').onchange = e => { settings.themeMode = e.target.value; invalidateThemeCache(); saveData(); injectPrompt(); };
        $('dc-palette').value = settings.colorTheme; $('dc-palette').onchange = e => { settings.colorTheme = e.target.value; saveData(); };
        $('dc-min-occ').value = settings.minOccurrences || 2; $('dc-min-occ').onchange = e => { settings.minOccurrences = parseInt(e.target.value); saveData(); };
        $('dc-brightness').value = settings.brightness || 0; $('dc-bright-val').textContent = settings.brightness || 0;
        $('dc-brightness').oninput = e => { settings.brightness = parseInt(e.target.value); $('dc-bright-val').textContent = e.target.value; saveData(); invalidateThemeCache(); injectPrompt(); };
        $('dc-narrator').value = settings.narratorColor || '#888888'; $('dc-narrator').oninput = e => { settings.narratorColor = e.target.value; saveData(); injectPrompt(); };
        $('dc-narrator-clear').onclick = () => { settings.narratorColor = ''; $('dc-narrator').value = '#888888'; saveData(); injectPrompt(); };
        $('dc-thought-symbols').value = settings.thoughtSymbols || '';
        $('dc-thought-add').onclick = () => { const s = prompt('Add thought symbol (e.g., *, 「, 『):'); if (s?.trim()) { settings.thoughtSymbols = (settings.thoughtSymbols || '') + s.trim(); $('dc-thought-symbols').value = settings.thoughtSymbols; saveData(); injectPrompt(); document.querySelectorAll('.mes').forEach(m => colorThoughts(m)); } };
        $('dc-thought-clear').onclick = () => { settings.thoughtSymbols = ''; $('dc-thought-symbols').value = ''; saveData(); injectPrompt(); };
        $('dc-scan').onclick = scanAllMessages;
        $('dc-clear').onclick = () => { characterColors = {}; saveHistory(); saveData(); injectPrompt(); updateCharList(); };
        $('dc-stats').onclick = showStatsPopup;
        $('dc-fix-conflicts').onclick = autoResolveConflicts;
        $('dc-regen').onclick = regenerateAllColors;
        $('dc-save-preset').onclick = saveColorPreset;
        $('dc-load-preset').onclick = loadColorPreset;
        $('dc-card').onclick = autoAssignFromCard;
        $('dc-save-card').onclick = saveToCard;
        $('dc-load-card').onclick = loadFromCard;
        $('dc-undo').onclick = undo; $('dc-redo').onclick = redo;
        $('dc-export').onclick = exportColors;
        $('dc-import').onclick = () => $('dc-import-file').click();
        $('dc-import-file').onchange = e => { if (e.target.files[0]) importColors(e.target.files[0]); };
        $('dc-del-locked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (characterColors[k].locked) { delete characterColors[k]; count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} locked characters`); };
        $('dc-del-unlocked').onclick = () => { let count = 0; Object.keys(characterColors).forEach(k => { if (!characterColors[k].locked) { delete characterColors[k]; count++; } }); saveHistory(); saveData(); injectPrompt(); updateCharList(); toastr?.info?.(`Deleted ${count} unlocked characters`); };
        $('dc-reset').onclick = () => { if (confirm('Reset all colors?')) { Object.values(characterColors).forEach(c => { if (!c.locked) c.color = getNextColor(); }); saveHistory(); saveData(); updateCharList(); injectPrompt(); } };
        $('dc-search').oninput = e => { searchTerm = e.target.value; updateCharList(); };
        $('dc-sort').onchange = e => { sortMode = e.target.value; updateCharList(); };
        $('dc-add-btn').onclick = () => { addCharacter($('dc-add-name').value); $('dc-add-name').value = ''; };
        $('dc-add-name').onkeypress = e => { if (e.key === 'Enter') $('dc-add-btn').click(); };
        $('dc-pattern-btn').onclick = () => { addCustomPattern($('dc-pattern').value); $('dc-pattern').value = ''; };
        $('dc-patterns').onclick = () => {
            const popup = document.createElement('div');
            popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--SmartThemeBodyColor);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:16px;z-index:10000;min-width:400px;';
            popup.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;">Custom Regex Patterns</div>${customPatterns.length ? customPatterns.map((p, i) => `<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><code style="flex:1;word-break:break-all;font-size:0.8em;">${p}</code><button class="dc-del-pat menu_button" data-idx="${i}" style="padding:1px 6px;font-size:0.7em;">×</button></div>`).join('') : '<small style="opacity:0.6;">No custom patterns</small>'}<button class="menu_button" style="margin-top:10px;width:100%;">Close</button>`;
            popup.querySelector('button').onclick = () => popup.remove();
            popup.querySelectorAll('.dc-del-pat').forEach(b => { b.onclick = () => { customPatterns.splice(b.dataset.idx, 1); popup.remove(); $('dc-patterns').click(); }; });
            document.body.appendChild(popup);
        };
        
        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && document.activeElement?.closest('#dc-ext')) { e.preventDefault(); redo(); }
        });
        
        updateCharList();
        injectPrompt();
    }

    globalThis.DialogueColorsInterceptor = async function(chat, contextSize, abort, type) { if (type !== 'quiet' && settings.enabled) injectPrompt(); };

    console.log('Dialogue Colors: Initializing...');
    loadData(); ensureRegexScript();
    const waitUI = setInterval(() => { if (document.getElementById('extensions_settings')) { clearInterval(waitUI); createUI(); injectPrompt(); } }, 500);
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => injectPrompt());
    eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        loadData();
        if (!Object.keys(characterColors).length) tryLoadFromCard();
        updateCharList();
        injectPrompt();
        if (settings.autoScanOnLoad !== false && !Object.keys(characterColors).length) {
            setTimeout(() => { if (document.querySelectorAll('.mes').length) scanAllMessages(); }, 1000);
        }
        document.querySelectorAll('.mes').forEach(m => colorThoughts(m));
    });
    console.log('Dialogue Colors: Ready!');
})();
