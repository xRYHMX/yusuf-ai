// Sohbet Verileri ve Durum
let chats = JSON.parse(localStorage.getItem('ai_chats') || '[]');
let currentChatId = null;
let savedApiKey = localStorage.getItem('groq_api_key') || '';
let currentTheme = localStorage.getItem('app_theme') || 'dark';
let attachedFiles = []; // { name, type, isImage, dataUrl, textContent }

// DOM Elemanları (Sohbet)
const emptyState = document.getElementById('emptyState');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const newChatBtn = document.getElementById('newChatBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const historyList = document.getElementById('historyList');
const suggestionCards = document.querySelectorAll('.suggestion-card');
const setApiKeyBtn = document.getElementById('setApiKeyBtn');
const apiKeyBtnText = document.getElementById('apiKeyBtnText');

const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeBtnText = document.getElementById('themeBtnText');

const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const filePreviewContainer = document.getElementById('filePreviewContainer');
const dropOverlay = document.getElementById('dropOverlay');
const chatMain = document.getElementById('chatMain');

const apiKeyModal = document.getElementById('apiKeyModal');
const apiKeyModalInput = document.getElementById('apiKeyModalInput');
const apiKeyProviderInfo = document.getElementById('apiKeyProviderInfo');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const saveModalBtn = document.getElementById('saveModalBtn');

const imageLightbox = document.getElementById('imageLightbox');
const lightboxImg = document.getElementById('lightboxImg');
const closeLightboxBtn = document.getElementById('closeLightboxBtn');

const clearHistoryModal = document.getElementById('clearHistoryModal');
const closeClearModalBtn = document.getElementById('closeClearModalBtn');
const cancelClearBtn = document.getElementById('cancelClearBtn');
const confirmClearBtn = document.getElementById('confirmClearBtn');

const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
const sidebar = document.querySelector('.sidebar');
const appLayout = document.querySelector('.app-layout');

// DOM Elemanları (Navigasyon ve Sekmeler)
const navTabs = document.querySelectorAll('.nav-tab');
const viewPanels = {
    chat: document.getElementById('chatView'),
    coupons: document.getElementById('couponsView')
};

// DOM Elemanları (Kuponlar Görünümü)
const couponsLoading = document.getElementById('couponsLoading');
const couponsContent = document.getElementById('couponsContent');
const refreshCouponsBtn = document.getElementById('refreshCouponsBtn');
const bankoTitle = document.getElementById('bankoTitle');
const bankoStrategy = document.getElementById('bankoStrategy');
const bankoConfidenceVal = document.getElementById('bankoConfidenceVal');
const bankoInstruction = document.getElementById('bankoInstruction');
const bankoMatchesList = document.getElementById('bankoMatchesList');
const surpriseTitle = document.getElementById('surpriseTitle');
const surpriseStrategy = document.getElementById('surpriseStrategy');
const surpriseLiftVal = document.getElementById('surpriseLiftVal');
const surpriseInstruction = document.getElementById('surpriseInstruction');
const surpriseMatchesList = document.getElementById('surpriseMatchesList');
const askAiBankoBtn = document.getElementById('askAiBankoBtn');
const askAiSurpriseBtn = document.getElementById('askAiSurpriseBtn');

// Modül Durum Değişkenleri
let currentTab = 'chat';
let couponsLoaded = false;

// Başlat
init();

function init() {
    initTheme();
    initSidebar();
    renderHistory();
    bindEvents();
    bindDragAndDrop();
    bindLightbox();
    bindFootballModule();
    updateView();
    updateApiKeyButtonState();
}

function initSidebar() {
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const isMobile = window.innerWidth <= 768;
    const isCollapsed = isMobile ? true : (localStorage.getItem('sidebar_collapsed') === 'true');

    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        appLayout.classList.add('sidebar-collapsed');
    } else {
        sidebar.classList.remove('collapsed');
        appLayout.classList.remove('sidebar-collapsed');
    }

    function closeSidebar() {
        sidebar.classList.add('collapsed');
        appLayout.classList.add('sidebar-collapsed');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
        if (window.innerWidth > 768) localStorage.setItem('sidebar_collapsed', 'true');
    }

    function openSidebar() {
        sidebar.classList.remove('collapsed');
        appLayout.classList.remove('sidebar-collapsed');
        if (sidebarBackdrop && window.innerWidth <= 768) {
            sidebarBackdrop.classList.add('active');
        }
        if (window.innerWidth > 768) localStorage.setItem('sidebar_collapsed', 'false');
    }

    sidebarCollapseBtn.addEventListener('click', closeSidebar);
    sidebarExpandBtn.addEventListener('click', openSidebar);

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', closeSidebar);
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && sidebarBackdrop) {
            sidebarBackdrop.classList.remove('active');
        }
    });
}

function bindLightbox() {
    imageLightbox.addEventListener('click', () => {
        closeLightbox();
    });

    closeLightboxBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLightbox();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (imageLightbox.classList.contains('active')) closeLightbox();
        }
    });
}

function openLightbox(src) {
    lightboxImg.src = src;
    imageLightbox.classList.add('active');
}

function closeLightbox() {
    imageLightbox.classList.remove('active');
    lightboxImg.src = '';
}

// Tema Yönetimi
function initTheme() {
    applyTheme(currentTheme);
}

function applyTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('app_theme', theme);

    if (theme === 'light') {
        document.body.classList.remove('theme-dark');
        document.body.classList.add('theme-light');
        themeBtnText.textContent = 'Açık Tema';
        themeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
    } else {
        document.body.classList.remove('theme-light');
        document.body.classList.add('theme-dark');
        themeBtnText.textContent = 'Karanlık Tema';
        themeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    }
}

function toggleTheme() {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
}

function inspectKeyProvider(key) {
    const clean = (key || '').trim();
    if (!clean) {
        return {
            name: 'Dahili Ücretsiz AI',
            badge: '🟢 Dahili Ücretsiz AI Aktif (Anahtarsız • 0 TL • Otomatik)',
            btn: '🟢 Ücretsiz AI (Aktif)'
        };
    }
    if (clean.startsWith('AIza')) {
        return {
            name: 'Google Gemini Free',
            badge: '🟢 Google Gemini 2.5 Flash (%100 Ücretsiz • 1 Milyon Token & Görsel Okuma)',
            btn: '🟢 Gemini Free (1M)'
        };
    }
    if (clean.startsWith('sk-or-')) {
        return {
            name: 'OpenRouter Free',
            badge: '🟢 OpenRouter Ücretsiz Modeller (Gemini / DeepSeek / Llama)',
            btn: '🟢 OpenRouter Aktif'
        };
    }
    if (clean.startsWith('sk-')) {
        return {
            name: 'OpenAI (ChatGPT)',
            badge: '🟢 OpenAI ChatGPT (GPT-4o Vision & 4096 Token)',
            btn: '🟢 OpenAI (GPT-4o)'
        };
    }
    if (clean.startsWith('gsk_')) {
        return {
            name: 'Groq',
            badge: '🟢 Groq Ücretsiz AI (Llama-4-Scout 500K Token & Llama-3.3)',
            btn: '🟢 Groq Free Aktif'
        };
    }
    return {
        name: 'Özel API',
        badge: '🟢 API Anahtarı Tanımlı (Limit Dolarsa Otomatik Ücretsiz AI Devrede)',
        btn: '🟢 API Kayıtlı'
    };
}

function updateApiKeyProviderInfo(key) {
    if (!apiKeyProviderInfo) return;
    const p = inspectKeyProvider(key);
    apiKeyProviderInfo.style.display = 'block';
    apiKeyProviderInfo.textContent = p.badge;
}

function updateApiKeyButtonState() {
    const p = inspectKeyProvider(savedApiKey);
    apiKeyBtnText.textContent = p.btn;
}

function bindEvents() {
    themeToggleBtn.addEventListener('click', toggleTheme);

    setApiKeyBtn.addEventListener('click', () => {
        apiKeyModalInput.value = savedApiKey;
        updateApiKeyProviderInfo(savedApiKey);
        apiKeyModal.classList.add('active');
        apiKeyModalInput.focus();
    });

    apiKeyModalInput.addEventListener('input', () => {
        updateApiKeyProviderInfo(apiKeyModalInput.value);
    });

    closeModalBtn.addEventListener('click', () => { apiKeyModal.classList.remove('active'); });
    cancelModalBtn.addEventListener('click', () => { apiKeyModal.classList.remove('active'); });

    saveModalBtn.addEventListener('click', () => {
        savedApiKey = apiKeyModalInput.value.trim();
        localStorage.setItem('groq_api_key', savedApiKey);
        updateApiKeyButtonState();
        apiKeyModal.classList.remove('active');
    });

    apiKeyModal.addEventListener('click', (e) => {
        if (e.target === apiKeyModal) apiKeyModal.classList.remove('active');
    });

    attachBtn.addEventListener('click', () => { fileInput.click(); });
    fileInput.addEventListener('change', handleFileSelect);

    newChatBtn.addEventListener('click', () => {
        switchTab('chat');
        currentChatId = null;
        chatMessages.innerHTML = '';
        messageInput.value = '';
        clearAttachedFiles();
        updateSendButtonState();
        updateView();
        updateActiveHistoryItem();
        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
            appLayout.classList.add('sidebar-collapsed');
            const backdrop = document.getElementById('sidebarBackdrop');
            if (backdrop) backdrop.classList.remove('active');
        }
        messageInput.focus();
    });

    clearAllBtn.addEventListener('click', () => {
        if (chats.length === 0) return;
        clearHistoryModal.classList.add('active');
    });

    closeClearModalBtn.addEventListener('click', () => { clearHistoryModal.classList.remove('active'); });
    cancelClearBtn.addEventListener('click', () => { clearHistoryModal.classList.remove('active'); });

    clearHistoryModal.addEventListener('click', (e) => {
        if (e.target === clearHistoryModal) clearHistoryModal.classList.remove('active');
    });

    confirmClearBtn.addEventListener('click', () => {
        chats = [];
        currentChatId = null;
        saveChats();
        renderHistory();
        chatMessages.innerHTML = '';
        updateView();
        clearHistoryModal.classList.remove('active');
    });

    // Öneri Kartları
    suggestionCards.forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            switchTab('chat');
            messageInput.value = prompt;
            adjustTextarea();
            updateSendButtonState();
            submitCurrentMessage();
        });
    });

    // Textarea Olayları
    messageInput.addEventListener('input', () => {
        adjustTextarea();
        updateSendButtonState();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (messageInput.value.trim() || attachedFiles.length > 0) {
                submitCurrentMessage();
            }
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitCurrentMessage();
    });
}

function bindDragAndDrop() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            dropOverlay.classList.add('active');
        }
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropOverlay.classList.remove('active');
        }
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.classList.remove('active');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(Array.from(e.dataTransfer.files));
        }
    });

    // Panodan (Ctrl+V / Mobil Yapıştır) doğrudan ekran görüntüsü yapıştırma desteği
    window.addEventListener('paste', (e) => {
        if (!e.clipboardData || !e.clipboardData.items) return;
        const pastedFiles = [];
        for (const item of e.clipboardData.items) {
            if (item.type && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length > 0) {
            processFiles(pastedFiles);
        }
    });
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    processFiles(files);
    fileInput.value = '';
}

// Görselleri Vision motoru için netliğini bozmadan optimize eder (max 1280px, JPEG 0.84)
function compressImageDataUrl(rawDataUrl, maxDim = 1280, quality = 0.84) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w >= h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (_) {
                resolve(rawDataUrl);
            }
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
    });
}

function processFiles(files) {
    files.forEach(file => {
        const isImage = file.type.startsWith('image/');
        const reader = new FileReader();

        if (isImage) {
            reader.onload = async (event) => {
                const optimizedUrl = await compressImageDataUrl(event.target.result);
                attachedFiles.push({
                    name: file.name || 'ekran_goruntusu.jpg',
                    type: 'image/jpeg',
                    isImage: true,
                    dataUrl: optimizedUrl,
                    textContent: null
                });
                renderFilePreviews();
                updateSendButtonState();
            };
            reader.readAsDataURL(file);
        } else {
            reader.onload = (event) => {
                attachedFiles.push({
                    name: file.name,
                    type: file.type,
                    isImage: false,
                    dataUrl: null,
                    textContent: event.target.result
                });
                renderFilePreviews();
                updateSendButtonState();
            };
            reader.readAsText(file);
        }
    });
}

function renderFilePreviews() {
    filePreviewContainer.innerHTML = '';
    attachedFiles.forEach((item, index) => {
        const chip = document.createElement('div');
        chip.className = 'preview-chip';

        if (item.isImage) {
            const img = document.createElement('img');
            img.src = item.dataUrl;
            chip.appendChild(img);
        } else {
            const docIcon = document.createElement('span');
            docIcon.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            chip.appendChild(docIcon);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'preview-name';
        nameSpan.textContent = item.name;
        chip.appendChild(nameSpan);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file-btn';
        removeBtn.type = 'button';
        removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        removeBtn.addEventListener('click', () => {
            attachedFiles.splice(index, 1);
            renderFilePreviews();
            updateSendButtonState();
        });
        chip.appendChild(removeBtn);

        filePreviewContainer.appendChild(chip);
    });
}

function clearAttachedFiles() {
    attachedFiles = [];
    filePreviewContainer.innerHTML = '';
}

function adjustTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
}

function updateSendButtonState() {
    sendButton.disabled = !(messageInput.value.trim() || attachedFiles.length > 0);
}

function updateView() {
    const hasMessages = chatMessages.children.length > 0;
    if (hasMessages) {
        emptyState.style.display = 'none';
        chatMessages.classList.add('has-messages');
    } else {
        emptyState.style.display = 'flex';
        chatMessages.classList.remove('has-messages');
    }
}

async function submitCurrentMessage() {
    const text = messageInput.value.trim();
    if ((!text && attachedFiles.length === 0) || sendButton.disabled) return;

    const currentFiles = [...attachedFiles];

    if (!currentChatId) {
        currentChatId = 'chat_' + Date.now();
        const titleText = text || (currentFiles[0] ? currentFiles[0].name : 'Görsel Analizi');
        const newChat = {
            id: currentChatId,
            title: titleText.length > 26 ? titleText.slice(0, 26) + '...' : titleText,
            messages: []
        };
        chats.unshift(newChat);
        saveChats();
        renderHistory();
    }

    appendMessage('user', text, currentFiles);
    saveMessageToCurrentChat('user', text, currentFiles);

    messageInput.value = '';
    clearAttachedFiles();
    adjustTextarea();
    updateSendButtonState();
    updateView();
    if (window.innerWidth <= 768) {
        messageInput.blur();
    }

    sendButton.disabled = true;
    await streamAiResponse();
}

async function streamAiResponse() {
    const bubbleWrapper = appendMessage('ai', '', []);
    const bubble = bubbleWrapper.querySelector('.msg-bubble');
    const activeChat = chats.find(c => c.id === currentChatId);

    const conversationHistory = (activeChat ? activeChat.messages : []).map(m => {
        let content = m.text || '';
        const images = [];
        if (m.attachments && m.attachments.length > 0) {
            m.attachments.forEach(att => {
                if (att.textContent) {
                    content += `\n\n[Ekli Dosya: ${att.name}]\n${att.textContent}`;
                } else if (att.isImage && att.dataUrl) {
                    images.push(att.dataUrl);
                }
            });
        }
        return {
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: content,
            images: images
        };
    });

    try {
        let fullAiText = '';
        let currentMessages = [...conversationHistory];
        let autoContinueCount = 0;

        while (autoContinueCount <= 2) {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: currentMessages,
                    apiKey: savedApiKey
                })
            });

            if (!response.ok) {
                if (fullAiText) break;
                const errData = await response.text();
                bubble.textContent = `Hata (${response.status}): ${errData}`;
                saveMessageToCurrentChat('ai', bubble.textContent, []);
                sendButton.disabled = false;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let streamBuffer = '';
            let finishReason = null;

            const processLine = (line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') return;
                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.slice(6).trim();
                    try {
                        const parsed = JSON.parse(dataStr);
                        const choice = parsed.choices && parsed.choices[0];
                        if (choice?.finish_reason) {
                            finishReason = choice.finish_reason;
                        }
                        const token = choice?.delta?.content || '';
                        if (token) {
                            fullAiText += token;
                            const cleanText = fullAiText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '');
                            if (cleanText.trim()) {
                                if (window.marked) {
                                    bubble.innerHTML = renderMarkdown(cleanText);
                                } else {
                                    bubble.textContent = cleanText;
                                }
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            }
                        }
                    } catch (_) {}
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    streamBuffer += decoder.decode();
                    if (streamBuffer.trim()) {
                        streamBuffer.split('\n').forEach(processLine);
                    }
                    break;
                }

                streamBuffer += decoder.decode(value, { stream: true });
                const lines = streamBuffer.split('\n');
                streamBuffer = lines.pop();
                lines.forEach(processLine);
            }

            fullAiText = fullAiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            // Mesaj token limitinden (length) veya tablo ortasında kesildiyse otomatik olarak kaldığı yerden tamamla
            const lastLine = (fullAiText.split('\n').pop() || '').trim();
            const isHalfTableRow = lastLine.startsWith('|') && !lastLine.endsWith('|');
            const isCutOff = finishReason === 'length' || isHalfTableRow;

            if (isCutOff && fullAiText.length > 0 && autoContinueCount < 2) {
                autoContinueCount++;
                currentMessages = [
                    ...conversationHistory,
                    { role: 'assistant', content: fullAiText },
                    { role: 'user', content: 'Mesajın yarıda kesildi. Hiçbir başlığı veya yazdığın kısmı tekrarlamadan, tam kaldığın kelimeden/tablo satırından doğrudan devam et ve analizi tamamla.' }
                ];
                fullAiText += (isHalfTableRow ? ' ' : '\n');
                continue;
            }
            break;
        }

        if (window.marked && fullAiText) {
            bubble.innerHTML = renderMarkdown(fullAiText);
        }
        saveMessageToCurrentChat('ai', fullAiText, []);
        addCopyAction(bubbleWrapper, fullAiText);

    } catch (err) {
        bubble.textContent = `Bağlantı hatası: ${err.message}`;
        saveMessageToCurrentChat('ai', bubble.textContent, []);
    } finally {
        sendButton.disabled = false;
    }
}

function addCopyAction(wrapper, text) {
    if (wrapper.querySelector('.msg-actions')) return;

    const actionDiv = document.createElement('div');
    actionDiv.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-msg-btn';
    copyBtn.type = 'button';
    copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Kopyala</span>
    `;

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
            const span = copyBtn.querySelector('span');
            span.textContent = 'Kopyalandı!';
            setTimeout(() => {
                span.textContent = 'Kopyala';
            }, 1800);
        });
    });

    actionDiv.appendChild(copyBtn);
    wrapper.appendChild(actionDiv);
}

function renderHistory() {
    historyList.innerHTML = '';
    chats.forEach(chat => {
        const row = document.createElement('div');
        row.className = 'history-row';
        if (chat.id === currentChatId) {
            row.classList.add('active');
        }

        const itemBtn = document.createElement('button');
        itemBtn.className = 'history-item';
        itemBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>${escapeHtml(chat.title)}</span>
        `;
        itemBtn.addEventListener('click', () => {
            switchTab('chat');
            loadChat(chat.id);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-chat-btn';
        deleteBtn.title = 'Sil';
        deleteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChat(chat.id);
        });

        row.appendChild(itemBtn);
        row.appendChild(deleteBtn);
        historyList.appendChild(row);
    });
}

function updateActiveHistoryItem() {
    const rows = historyList.querySelectorAll('.history-row');
    chats.forEach((chat, idx) => {
        if (rows[idx]) {
            rows[idx].classList.toggle('active', chat.id === currentChatId);
        }
    });
}

function loadChat(id) {
    currentChatId = id;
    chatMessages.innerHTML = '';
    updateActiveHistoryItem();

    if (window.innerWidth <= 768) {
        sidebar.classList.add('collapsed');
        appLayout.classList.add('sidebar-collapsed');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (backdrop) backdrop.classList.remove('active');
    }

    const activeChat = chats.find(c => c.id === id);
    if (!activeChat) return;

    activeChat.messages.forEach(msg => {
        const wrapper = appendMessage(msg.sender, msg.text, msg.attachments || []);
        if (msg.sender === 'ai' && msg.text) {
            addCopyAction(wrapper, msg.text);
        }
    });

    updateView();
}

function deleteChat(id) {
    chats = chats.filter(c => c.id !== id);
    saveChats();
    if (currentChatId === id) {
        currentChatId = null;
        chatMessages.innerHTML = '';
    }
    renderHistory();
    updateView();
}

function saveMessageToCurrentChat(sender, text, attachments = []) {
    const activeChat = chats.find(c => c.id === currentChatId);
    if (activeChat) {
        activeChat.messages.push({ sender, text, attachments });
        saveChats();
    }
}

function appendMessage(sender, text, attachments = []) {
    const row = document.createElement('div');
    row.className = `message-row ${sender}`;

    if (sender === 'ai') {
        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
        `;
        row.appendChild(avatar);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-bubble-wrapper';

    if (attachments && attachments.length > 0) {
        const attachGallery = document.createElement('div');
        attachGallery.className = 'msg-attachments-gallery';

        attachments.forEach(att => {
            if (att.isImage && att.dataUrl) {
                const img = document.createElement('img');
                img.src = att.dataUrl;
                img.className = 'msg-attachment-img';
                img.title = 'Büyütmek için tıklayın';
                img.addEventListener('click', () => {
                    openLightbox(att.dataUrl);
                });
                attachGallery.appendChild(img);
            } else {
                const docBadge = document.createElement('div');
                docBadge.className = 'msg-attachment-doc';
                docBadge.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    <span>${escapeHtml(att.name)}</span>
                `;
                attachGallery.appendChild(docBadge);
            }
        });

        wrapper.appendChild(attachGallery);
    }

    if (text || sender === 'ai') {
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';

        if (sender === 'ai' && window.marked && text) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderMarkdown(text);
            while (tempDiv.firstChild) {
                bubble.appendChild(tempDiv.firstChild);
            }
        } else if (text) {
            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            bubble.appendChild(textSpan);
        } else if (sender === 'ai') {
            bubble.innerHTML = `<div class="typing-wave" aria-label="Yanıt hazırlanıyor"><span></span><span></span><span></span></div>`;
        }

        wrapper.appendChild(bubble);
    }

    row.appendChild(wrapper);
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return wrapper;
}

function renderMarkdown(rawText) {
    if (!rawText) return '';
    if (!window.marked) return escapeHtml(rawText);
    let html = marked.parse(rawText);
    // Tablo kaymalarını ve dar sütun kırılmalarını önlemek için responsive kapsayıcı ekle
    if (html.includes('<table>') && !html.includes('table-responsive')) {
        html = html.replace(/<table>/gi, '<div class="table-responsive"><table>');
        html = html.replace(/<\/table>/gi, '</table></div>');
    }
    return html;
}

function saveChats() {
    localStorage.setItem('ai_chats', JSON.stringify(chats));
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ==========================================================================
   FUTBOL VE KUPON MODÜLÜ MANTIĞI
   ========================================================================== */

function bindFootballModule() {
    // Sekme Değiştirme
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });

    // Kupon Butonları
    if (refreshCouponsBtn) {
        refreshCouponsBtn.addEventListener('click', loadCoupons);
    }

    if (askAiBankoBtn) {
        askAiBankoBtn.addEventListener('click', () => {
            const prompt = 'Günün Banko Kuponunu ev/deplasman karnesi, son 5 maç formu, ortak rakipler, saha/hava şartları ve kilit oyuncularıyla tablolu ve grafik barlı olarak analiz et.';
            askAiDirectly(prompt);
        });
    }

    if (askAiSurpriseBtn) {
        askAiSurpriseBtn.addEventListener('click', () => {
            const prompt = 'Günün Sürpriz Kuponunu (MS & KG Var, MS & 2,5 Üst, İY / 2. Yarı KG Var, Kesin Skor, Handikap, 4-6 Gol ve İY/MS tercihlerini) ev/deplasman karnesi, H2H, ortak rakipler ve hava şartlarıyla tablolu ve grafik barlı olarak analiz et. Sistem mi yoksa kombine mi oynamalıyım?';
            askAiDirectly(prompt);
        });
    }
}

function switchTab(tabName) {
    currentTab = tabName;
    navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

    Object.keys(viewPanels).forEach(key => {
        if (viewPanels[key]) {
            viewPanels[key].classList.toggle('active-view', key === tabName);
        }
    });

    if (tabName === 'coupons' && !couponsLoaded) {
        loadCoupons();
    }
}

function askAiDirectly(prompt) {
    switchTab('chat');
    messageInput.value = prompt;
    adjustTextarea();
    updateSendButtonState();
    submitCurrentMessage();
}

// ---------------- Kuponları Yükle & Render Et ----------------
async function loadCoupons() {
    couponsLoading.style.display = 'flex';
    couponsContent.style.display = 'none';

    try {
        const res = await fetch('/api/football/coupons');
        if (!res.ok) throw new Error('Kupon verisi alınamadı');
        const data = await res.json();

        couponsLoaded = true;
        renderCoupons(data);
    } catch (err) {
        console.error('Kupon yükleme hatası:', err);
        couponsLoading.innerHTML = `<span>Kuponlar yüklenirken hata oluştu: ${escapeHtml(err.message)}</span>`;
    }
}

function renderCoupons(data) {
    couponsLoading.style.display = 'none';
    couponsContent.style.display = 'grid';

    // 1. BANKO KUPONU
    const banko = data.banko;
    if (banko) {
        bankoTitle.textContent = banko.title || 'Günün Banko Kuponu';
        bankoStrategy.textContent = banko.strategy || 'Bağımsız Derin Analiz • Yüksek Güven Kombinesi';
        bankoConfidenceVal.textContent = `%${banko.confidence || 85}`;
        bankoInstruction.textContent = banko.instruction || 'Düz 4 maçlık kombine kupon olarak oynanması tavsiye edilir.';

        bankoMatchesList.innerHTML = '';
        if (banko.matches && banko.matches.length) {
            banko.matches.forEach(item => {
                const el = createCouponMatchElement(item, false);
                bankoMatchesList.appendChild(el);
            });
        } else {
            bankoMatchesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Bugün için güven kriterlerini karşılayan yaklaşan banko maç bulunamadı.</div>';
        }
    }

    // 2. SÜRPRİZ KUPONU
    const surp = data.surprise;
    if (surp) {
        surpriseTitle.textContent = surp.title || 'Sürpriz Kupon';
        surpriseStrategy.textContent = surp.strategy || 'Nesine Yüksek Oranlı Özel Pazarlar (MS&KG, MS&Üst, Devre KG, Skor, İY/MS)';
        surpriseLiftVal.textContent = `${surp.avgLift || '2.0'}x`;
        surpriseInstruction.textContent = surp.instruction || 'Sistem (3-4-5) veya sürpriz kombine olarak oynanması tavsiye edilir.';

        surpriseMatchesList.innerHTML = '';
        if (surp.matches && surp.matches.length) {
            surp.matches.forEach(item => {
                const el = createCouponMatchElement(item, true);
                surpriseMatchesList.appendChild(el);
            });
        } else {
            surpriseMatchesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Bugün için yüksek değer kriterlerini karşılayan sürpriz maç bulunamadı.</div>';
        }
    }
}

function createCouponMatchElement(item, isSurprise) {
    const m = item.m;
    const an = item.an || {};
    const div = document.createElement('div');
    div.className = 'coupon-match-item';

    const probPct = Math.round(item.p * 100);
    const liftTag = item.lift ? `<span class="match-pick-conf lift-tag">${item.lift.toFixed(1)}x Değer</span>` : '';

    // 10 katmanlı derin analiz rozetleri (xG, Ev/Dep Form, Taktik DNA, Yorgunluk/İstikrar, Hava Durumu, Gol Kralı)
    const chips = [];
    if (typeof an.lh === 'number' && typeof an.la === 'number') {
        chips.push(`<span class="intel-chip">📊 xG: ${an.lh.toFixed(2)} - ${an.la.toFixed(2)}</span>`);
    }
    if (an.tactical?.homeTags?.[0] || an.tactical?.awayTags?.[0]) {
        chips.push(`<span class="intel-chip">🧬 ${escapeHtml(an.tactical.homeTags[0] || '')} / ${escapeHtml(an.tactical.awayTags[0] || '')}</span>`);
    }
    if (an.facts?.home?.formStr || an.facts?.away?.formStr) {
        chips.push(`<span class="intel-chip">🔥 Form: ${escapeHtml(an.facts?.home?.formStr || '-')} / ${escapeHtml(an.facts?.away?.formStr || '-')}</span>`);
    }
    if (an.restH?.isFatigued || an.restA?.isFatigued) {
        const fatStr = an.restH?.isFatigued ? `${m.home}: ${an.restH.restDays}g dinlenme` : `${m.away}: ${an.restA.restDays}g dinlenme`;
        chips.push(`<span class="intel-chip">⏱️ ${escapeHtml(fatStr)}</span>`);
    } else if (!isSurprise && an.avgConsistency) {
        chips.push(`<span class="intel-chip">🛡️ İstikrar: %${an.avgConsistency}</span>`);
    }
    if (an.intel?.weather) {
        const w = an.intel.weather;
        chips.push(`<span class="intel-chip">🌤️ ${escapeHtml(w.city)}: ${w.temp}°C ${escapeHtml(w.condition)}</span>`);
    }
    const topLeader = an.intel?.homeLeaders?.[0] || an.intel?.awayLeaders?.[0];
    if (topLeader) {
        chips.push(`<span class="intel-chip">⭐ ${escapeHtml(topLeader)}</span>`);
    }
    const chipsHtml = chips.length
        ? `<div class="match-intel-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin:6px 0 4px 0;">${chips.join('')}</div>`
        : '';

    div.innerHTML = `
        <div class="match-item-top">
            <span class="match-item-time">${m.time} | ${escapeHtml(m.league.full)}</span>
            ${m.youth ? '<span class="team-tags tag-youth">Gençlik / U</span>' : ''}
            ${m.women ? '<span class="team-tags tag-women">Kadın</span>' : ''}
        </div>
        <div class="match-item-teams">
            ${escapeHtml(m.home)} <span style="color:var(--text-muted);font-weight:400;">vs</span> ${escapeHtml(m.away)}
        </div>
        <div class="match-item-pick-row">
            <span class="match-pick-badge ${isSurprise ? 'gold-badge' : ''}">${escapeHtml(item.label)}</span>
            <div style="display:flex;align-items:center;gap:6px;">
                <span class="match-pick-conf">%${probPct} Güven</span>
                ${liftTag}
            </div>
        </div>
        ${chipsHtml}
        <div class="match-item-rationale">${escapeHtml(item.rationale)}</div>
        <div class="match-item-actions">
            <button type="button" class="btn-item-action btn-ai-action" style="flex: 1;">AI ile Derin Analiz Et</button>
        </div>
    `;

    div.querySelector('.btn-ai-action').addEventListener('click', () => {
        const prompt = `${m.home} vs ${m.away} (${m.league.full}) maçını ev/deplasman karnesi, ortak rakipler, geçmiş maçlar, hava şartları ve kilit oyuncularıyla derinlemesine analiz et.`;
        askAiDirectly(prompt);
    });

    return div;
}

