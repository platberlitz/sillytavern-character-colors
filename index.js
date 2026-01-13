(() => {
    'use strict';

    const characterColors = new Map();
    const defaultColors = ['#FF6B35', '#FF1493', '#00CED1', '#32CD32', '#FFD700', '#FF69B4', '#8A2BE2', '#FF4500'];
    let colorIndex = 0;

    function getCharacterColor(name) {
        if (!characterColors.has(name)) {
            characterColors.set(name, defaultColors[colorIndex % defaultColors.length]);
            colorIndex++;
        }
        return characterColors.get(name);
    }

    function colorizeMessage(messageElement) {
        const textContent = messageElement.textContent || messageElement.innerText;
        if (!textContent) return;

        // Find character names (assuming format: "Name:" or "Name said:" etc.)
        const namePattern = /^([A-Za-z][A-Za-z0-9\s]*?)(?:\s*[:]\s*)/;
        const match = textContent.match(namePattern);
        
        if (match) {
            const characterName = match[1].trim();
            const color = getCharacterColor(characterName);
            
            // Apply color to the character name only
            const innerHTML = messageElement.innerHTML;
            const coloredHTML = innerHTML.replace(
                new RegExp(`^(${characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'),
                `<span style="color: ${color}; font-weight: bold;">$1</span>`
            );
            messageElement.innerHTML = coloredHTML;
        }
    }

    function processMessages() {
        const messages = document.querySelectorAll('.mes_text:not([data-colored])');
        messages.forEach(msg => {
            colorizeMessage(msg);
            msg.setAttribute('data-colored', 'true');
        });
    }

    // Initialize when extension loads
    function init() {
        // Process existing messages
        processMessages();
        
        // Watch for new messages
        const observer = new MutationObserver(() => {
            processMessages();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Register extension
    jQuery(() => {
        init();
    });
})();
