// Sohbet Verileri ve Durum
let chats = JSON.parse(localStorage.getItem('ai_chats') || '[]');
let currentChatId = null;
localStorage.removeItem('groq_api_key');
localStorage.removeItem('gemini_aq_migrated');
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

const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeBtnText = document.getElementById('themeBtnText');

const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const filePreviewContainer = document.getElementById('filePreviewContainer');
const dropOverlay = document.getElementById('dropOverlay');
const chatMain = document.getElementById('chatMain');

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
let isGenerating = false;
const defaultInputPlaceholder = messageInput ? messageInput.placeholder : 'Maç, kupon veya görsel analizi sor...';

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
    bindSystemLogs();
    updateView();
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

function bindEvents() {
    themeToggleBtn.addEventListener('click', toggleTheme);

    attachBtn.addEventListener('click', () => {
        if (isGenerating) return;
        fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);

    newChatBtn.addEventListener('click', () => {
        if (isGenerating) return;
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
        if (isGenerating || chats.length === 0) return;
        clearHistoryModal.classList.add('active');
    });

    closeClearModalBtn.addEventListener('click', () => { clearHistoryModal.classList.remove('active'); });
    cancelClearBtn.addEventListener('click', () => { clearHistoryModal.classList.remove('active'); });

    clearHistoryModal.addEventListener('click', (e) => {
        if (e.target === clearHistoryModal) clearHistoryModal.classList.remove('active');
    });

    confirmClearBtn.addEventListener('click', () => {
        if (isGenerating) return;
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
            if (isGenerating) return;
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
            if (isGenerating) return;
            if (messageInput.value.trim() || attachedFiles.length > 0) {
                submitCurrentMessage();
            }
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (isGenerating) return;
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

// Görselleri Vision motoru için netliğini bozmadan hızlandırır (max 960px, JPEG 0.78)
function compressImageDataUrl(rawDataUrl, maxDim = 960, quality = 0.78) {
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
    const hasContent = Boolean(messageInput.value.trim() || attachedFiles.length > 0);
    sendButton.disabled = isGenerating || !hasContent;
    if (attachBtn) attachBtn.disabled = isGenerating;
    if (messageInput) {
        messageInput.placeholder = isGenerating
            ? 'Yusuf AI yanıt veriyor, lütfen bekleyin...'
            : defaultInputPlaceholder;
    }
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
    if (isGenerating) return;
    const text = messageInput.value.trim();
    if (!text && attachedFiles.length === 0) return;

    isGenerating = true;
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

    await streamAiResponse();
}

async function streamAiResponse() {
    const bubbleWrapper = appendMessage('ai', '', []);
    const bubble = bubbleWrapper.querySelector('.msg-bubble');
    const activeChat = chats.find(c => c.id === currentChatId);

    // Aktif sohbetteki tüm geçmişi (son 30 mesaja kadar) koru ki AI önceki mesajlarda konuşulan maçları eksiksiz hatırlasın
    const recentMsgs = (activeChat ? activeChat.messages : []).slice(-30);
    const conversationHistory = recentMsgs.map((m, idx) => {
        let content = m.text || '';
        const images = [];
        const isLatestMsg = idx === recentMsgs.length - 1;
        if (m.attachments && m.attachments.length > 0) {
            m.attachments.forEach(att => {
                if (att.textContent) {
                    content += `\n\n[Ekli Dosya: ${att.name}]\n${att.textContent}`;
                } else if (att.isImage && att.dataUrl) {
                    if (isLatestMsg) {
                        images.push(att.dataUrl);
                    } else if (!content.includes('[Bu mesajda kupon/maç görseli paylaşıldı]')) {
                        content = `${content ? content + '\n' : ''}[Bu mesajda kupon/maç görseli paylaşıldı]`;
                    }
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
                    messages: currentMessages
                })
            });

            if (!response.ok) {
                if (fullAiText) break;
                const errData = await response.text();
                bubble.textContent = `Hata (${response.status}): ${errData}`;
                saveMessageToCurrentChat('ai', bubble.textContent, []);
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
        isGenerating = false;
        updateSendButtonState();
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
    if (isGenerating) return;
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
    if (isGenerating) return;
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

function buildConfMeterHtml(rawPct, liftLabel = '', rawContext = '', isInline = false) {
    const pct = Math.max(6, Math.min(100, rawPct));
    const isSurpriseValue = Boolean(liftLabel) || rawContext.includes('⭐') || /değer|sürpriz/i.test(rawContext);
    const isDanger = rawContext.includes('🟥') || (!isSurpriseValue && pct < 45);
    const isWarn = rawContext.includes('🟨') || (!isSurpriseValue && !isDanger && pct < 68);
    const tierClass = isSurpriseValue ? 'gold' : isDanger ? 'danger' : isWarn ? 'warn' : 'high';
    const barFillWidth = isSurpriseValue ? Math.max(pct, Math.min(94, pct + 30)) : pct;
    const badgeHtml = liftLabel
        ? `<span class="ai-conf-lift">${escapeHtml(liftLabel)}</span>`
        : '';

    return `<div class="ai-conf-meter${isInline ? ' ai-conf-inline' : ''}"><div class="ai-conf-top"><span class="ai-conf-pct ${tierClass}">%${rawPct}</span>${badgeHtml}</div><div class="ai-conf-track"><div class="ai-conf-fill ${tierClass}" style="width:${barFillWidth}%"></div></div></div>`;
}

function renderMarkdown(rawText) {
    if (!rawText) return '';
    // Çirkin ASCII blok karakterlerini ([████████░░] vb.) tamamen temizle
    const cleanedRaw = String(rawText)
        .replace(/\[\s*[█▓▒░■□▪▫▬▭▮▯=#\-.\s]{2,}\s*\]?/g, '')
        .replace(/[█▓▒░]{2,}/g, '');

    if (!window.marked) return escapeHtml(cleanedRaw);
    let html = marked.parse(cleanedRaw);

    // Tablo hücrelerindeki (%88, 🟩 %87, ⭐ %28 • 2.4x Değer vb.) güven/değer yüzdelerini modern neon grafik bara dönüştür
    html = html.replace(/<td>([\s\S]*?)<\/td>/gi, (fullMatch, inner) => {
        const plain = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const pctMatch = plain.match(/(?:%\s*(\d{1,3})|(\d{1,3})\s*%)/);
        if (pctMatch && plain.length <= 56) {
            const rawPct = parseInt(pctMatch[1] || pctMatch[2], 10);
            if (!isNaN(rawPct) && rawPct >= 1 && rawPct <= 100) {
                const liftMatch = plain.match(/(\d+(?:[.,]\d+)?x(?:\s*Değer)?)/i);
                const liftLabel = liftMatch ? liftMatch[1].replace(/\s+/g, ' ').trim() : '';
                return `<td class="ai-conf-cell">${buildConfMeterHtml(rawPct, liftLabel, plain, false)}</td>`;
            }
        }
        return fullMatch;
    });

    // Tablo kapsayıcısı
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
            const prompt = 'Günün Banko Kuponunu ev/deplasman karnesi, son 5 ve 10 maç formu, ortak rakipler, saha/hava şartları ve kilit oyuncularıyla tablolu ve grafik barlı olarak analiz et.';
            askAiDirectly(prompt);
        });
    }

    if (askAiSurpriseBtn) {
        askAiSurpriseBtn.addEventListener('click', () => {
            const prompt = 'Günün Sürpriz Kuponunu (MS & KG Var, MS & 2,5 Üst, İY / 2. Yarı KG Var, Kesin Skor, Handikap, Korner, Kart, 4-6 Gol ve İY/MS tercihlerini) ev/deplasman karnesi, H2H, ortak rakipler ve gerçek Nesine oranlarıyla tablolu ve grafik barlı olarak analiz et. Sistem mi yoksa kombine mi oynamalıyım?';
            askAiDirectly(prompt);
        });
    }

    // Sayfa açılır açılmaz canlı kupon hesaplamalarını arka planda çekip sabit metin yerine gerçek verileri yerleştir
    loadCoupons();
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
    if (isGenerating) return;
    switchTab('chat');
    messageInput.value = prompt;
    adjustTextarea();
    updateSendButtonState();
    submitCurrentMessage();
}

// ---------------- Kuponları Yükle & Render Et ----------------
async function loadCoupons() {
    couponsLoading.style.display = 'flex';
    couponsLoading.innerHTML = `
        <div class="spinner"></div>
        <span>Canlı bülten, gerçek Nesine oranları ve model olasılıkları yükleniyor...</span>
    `;
    couponsContent.style.display = 'none';
    const perfSec = document.getElementById('modelPerfSection');
    if (perfSec) perfSec.style.display = 'none';

    const topBadge = document.getElementById('couponBadge');
    const homeBankoEl = document.getElementById('homeBankoCardTitle');
    const homeSurpEl = document.getElementById('homeSurpriseCardTitle');
    if (topBadge) topBadge.textContent = 'Yükleniyor...';
    if (homeBankoEl) homeBankoEl.textContent = 'Günün Banko Kuponu (Yükleniyor...)';
    if (homeSurpEl) homeSurpEl.textContent = 'Sürpriz Kupon (Yükleniyor...)';
    if (bankoConfidenceVal) bankoConfidenceVal.textContent = 'Yükleniyor...';
    if (surpriseLiftVal) surpriseLiftVal.textContent = 'Yükleniyor...';

    try {
        const res = await fetch('/api/football/coupons');
        if (!res.ok) throw new Error(`Sunucu yanıt hatası (HTTP ${res.status})`);
        const data = await res.json();

        couponsLoaded = true;
        renderCoupons(data);
    } catch (err) {
        console.error('Kupon yükleme hatası:', err);
        couponsLoaded = false;
        couponsContent.style.display = 'none';
        if (perfSec) perfSec.style.display = 'none';
        if (topBadge) topBadge.textContent = 'Veri Hatası';
        if (homeBankoEl) homeBankoEl.textContent = 'Günün Banko Kuponu (Canlı Veri Alınamadı)';
        if (homeSurpEl) homeSurpEl.textContent = 'Sürpriz Kupon (Canlı Veri Alınamadı)';
        if (bankoConfidenceVal) bankoConfidenceVal.textContent = 'Veri Alınamadı';
        if (surpriseLiftVal) surpriseLiftVal.textContent = 'Veri Alınamadı';

        couponsLoading.style.display = 'flex';
        couponsLoading.innerHTML = `
            <div style="text-align:center;max-width:460px;display:flex;flex-direction:column;align-items:center;gap:10px;">
                <span style="color:#ef4444;font-weight:700;font-size:0.95rem;">⚠️ Canlı Kupon ve Oran Verisi Alınamadı</span>
                <span style="color:var(--text-secondary);font-size:0.82rem;">API bağlantısı kurulamadığı için eski veya sabit veriler gösterilmemektedir (${escapeHtml(err.message)}).</span>
                <button type="button" id="retryCouponsBtn" class="btn-refresh" style="margin-top:4px;">Tekrar Dene</button>
            </div>
        `;
        const retryBtn = document.getElementById('retryCouponsBtn');
        if (retryBtn) retryBtn.addEventListener('click', loadCoupons);
    }
}

function renderCoupons(data) {
    couponsLoading.style.display = 'none';
    couponsContent.style.display = 'grid';

    const homeBankoEl = document.getElementById('homeBankoCardTitle');
    const homeSurpEl = document.getElementById('homeSurpriseCardTitle');
    const topBadge = document.getElementById('couponBadge');

    // 0. NESİNE CANLI BÜLTEN & ORAN SENKRONİZASYON DURUMU (Item 3)
    const statusBar = document.getElementById('nesineLiveStatusBar');
    if (statusBar) {
        if (data.nesineStatus && data.nesineStatus.updatedAt) {
            statusBar.style.display = 'flex';
            if (data.nesineStatus.isFresh) {
                const timeStr = new Date(data.nesineStatus.updatedAt).toLocaleTimeString('tr-TR');
                statusBar.className = 'nesine-status-bar live';
                statusBar.innerHTML = `
                    <div class="nesine-st-pill live">
                        <span class="nesine-st-dot"></span>
                        <span class="nesine-st-title">Nesine Canlı Bülten:</span>
                        <strong class="nesine-st-time">${timeStr}</strong>
                        <span class="nesine-st-age">(${data.nesineStatus.ageSeconds || 0} sn önce güncellendi • %100 Canlı Oranlar)</span>
                    </div>
                    <div class="nesine-st-note">
                        <span>⚡ Kural: Oran yenilenemediğinde veya bültende kapalı olduğunda eski oran asla kullanılmaz.</span>
                    </div>
                `;
            } else {
                statusBar.className = 'nesine-status-bar stale';
                statusBar.innerHTML = `
                    <div class="nesine-st-pill stale">
                        <span class="nesine-st-dot red"></span>
                        <span class="nesine-st-title">Nesine Canlı Oran Durumu:</span>
                        <span class="nesine-st-age">Oran yenilenemediği için eski oranlar silindi. Yalnızca taze oranlı maçlar değerlenir.</span>
                    </div>
                `;
            }
        } else {
            statusBar.style.display = 'none';
        }
    }

    // 1. BANKO KUPONU
    const banko = data.banko;
    if (banko) {
        bankoTitle.textContent = banko.title || 'Günün Banko Kuponu';
        bankoStrategy.textContent = banko.strategy || 'Canlı Model Hesaplaması • Birleşik Olasılık Analizi';
        const hasBankoMatches = Array.isArray(banko.matches) && banko.matches.length > 0 && banko.confidence !== null;
        if (hasBankoMatches) {
            const bSingle = banko.confidence;
            const bJoint = banko.jointConfidence;
            bankoConfidenceVal.textContent = `Tekil %${bSingle} • Kombine %${bJoint}`;
            bankoInstruction.textContent = banko.instruction;
            if (homeBankoEl) {
                homeBankoEl.textContent = `Günün Banko Kuponu (Canlı: %${bSingle} • Kombine %${bJoint})`;
            }
            bankoMatchesList.innerHTML = '';
            banko.matches.forEach(item => {
                const el = createCouponMatchElement(item, false);
                bankoMatchesList.appendChild(el);
            });
        } else {
            bankoConfidenceVal.textContent = 'Henüz yeterli veri yok';
            bankoInstruction.textContent = banko.instruction || 'Şu an bültende kriterlere uygun yaklaşan banko maç bulunamadı.';
            if (homeBankoEl) homeBankoEl.textContent = 'Günün Banko Kuponu (Aktif Maç Yok)';
            bankoMatchesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Bugün için güven kriterlerini karşılayan yaklaşan banko maç bulunamadı.</div>';
        }
    }

    // 2. SÜRPRİZ KUPONU
    const surp = data.surprise;
    if (surp) {
        surpriseTitle.textContent = surp.title || 'Sürpriz Kupon';
        surpriseStrategy.textContent = surp.strategy || '25+ Nesine Pazarı • Gerçek Oran & Value Bet (EV) Kontrolü';
        const hasSurpMatches = Array.isArray(surp.matches) && surp.matches.length > 0 && surp.avgLift !== null;
        if (hasSurpMatches) {
            const sLift = surp.avgLift;
            const sJoint = surp.jointConfidence;
            surpriseLiftVal.textContent = `${sLift}x Çarpan • Kombine %${sJoint}`;
            if (surp.systemSimulation) {
                const sim = surp.systemSimulation;
                surpriseInstruction.innerHTML = `
                    <div class="system-sim-box">
                        <div class="sys-sim-hdr">
                            <strong>🎲 Sistem 3-4-5 Maliyet & Getiri Analizi</strong>
                            <span class="sys-col-tag">16 Kolon • Kupon Maliyeti: ${sim.totalCost} TL (20 TL/kolon)</span>
                        </div>
                        <div class="sys-sim-grid">
                            <div class="sys-cell">
                                <span class="sys-lbl">En Az 3 Maç Tutma Olasılığı</span>
                                <strong class="sys-val highlight-emerald">%${sim.pAtLeast3WinPct}</strong>
                            </div>
                            <div class="sys-cell">
                                <span class="sys-lbl">Min 3 Maç Tutarsa Getiri</span>
                                <strong class="sys-val">${sim.min3Payout} TL</strong>
                            </div>
                            <div class="sys-cell">
                                <span class="sys-lbl">5 Maç Tamamı Tutarsa</span>
                                <strong class="sys-val highlight-gold">${sim.all5Payout} TL</strong>
                            </div>
                            <div class="sys-cell">
                                <span class="sys-lbl">Beklenen Getiri / ROI</span>
                                <strong class="sys-val highlight-emerald">${sim.expectedPayout} TL (+%${sim.roiPct})</strong>
                            </div>
                        </div>
                        <p class="sys-sim-note">💡 Düz 5'li kombine olasılığı (%${sJoint}) riskli olduğu için 16 kolonluk Sistem 3-4-5 oynandığında 3 maç tutsa dahi kupon bedeli amorti edilmekte ve beklenen getiri pozitif olmaktadır.</p>
                    </div>
                `;
            } else {
                surpriseInstruction.textContent = surp.instruction;
            }
            if (homeSurpEl) {
                homeSurpEl.textContent = `Sürpriz Kupon (Canlı Çarpan: ${sLift}x • Sistem 3-4-5)`;
            }
            if (topBadge && banko && banko.confidence !== null) {
                topBadge.textContent = `%${banko.confidence} • ${sLift}x`;
            } else if (topBadge) {
                topBadge.textContent = `${sLift}x Canlı`;
            }
            surpriseMatchesList.innerHTML = '';
            surp.matches.forEach(item => {
                const el = createCouponMatchElement(item, true);
                surpriseMatchesList.appendChild(el);
            });
        } else {
            surpriseLiftVal.textContent = 'Henüz yeterli veri yok';
            surpriseInstruction.textContent = surp.instruction || 'Şu an bültende kriterlere uygun yaklaşan sürpriz maç bulunamadı.';
            if (homeSurpEl) homeSurpEl.textContent = 'Sürpriz Kupon (Aktif Maç Yok)';
            if (topBadge) {
                topBadge.textContent = (banko && banko.confidence !== null) ? `%${banko.confidence} Canlı` : 'Veri Bekleniyor';
            }
            surpriseMatchesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Bugün için yüksek değer kriterlerini karşılayan sürpriz maç bulunamadı.</div>';
        }
    }

    // 3. MODEL DOĞRULAMA & KALİBRASYON RAPORU (Kronolojik Out-of-Sample Walk-Forward Test & Maç Öncesi Kayıt Tablosu)
    renderModelPerformance(data.performance);
}

function renderModelPerformance(perf) {
    const container = document.getElementById('modelPerfSection');
    if (!container) return;
    container.style.display = 'block';

    const sampleCount = (perf && typeof perf.evaluatedMatches === 'number') ? perf.evaluatedMatches : 0;
    const hasData = Boolean(perf && perf.hasSufficientData && sampleCount > 0 && perf.hitRatePct !== null && perf.brierScore !== null && perf.logLoss !== null);

    if (!hasData) {
        container.innerHTML = `
            <div class="perf-report-card">
                <div class="perf-report-header">
                    <div>
                        <h3>📊 Model Kalibrasyon, Brier Score & Kronolojik Out-of-Sample Doğrulama Raporu</h3>
                        <p>Model performansı yalnızca maçtan önceki verilerle (Out-of-Sample) kronolojik olarak ölçülür. Varsayılan veya tahmini başarı oranı gösterilmez.</p>
                    </div>
                    <span class="perf-updated-tag">Veri Bekleniyor</span>
                </div>
                <div class="perf-verified-box" style="text-align:center;padding:18px;">
                    <strong style="color:var(--text-primary);font-size:0.9rem;">Henüz yeterli veri yok</strong>
                    <span style="color:var(--text-secondary);font-size:0.8rem;">Kronolojik Out-of-Sample test ve maç öncesi kayıt doğrulaması için yeterli sayıda tamamlanmış bülten maçı biriktiğinde gerçek sonuçlar burada listelenecektir.</span>
                </div>
            </div>
        `;
        return;
    }

    const mktPills = (perf.marketsReport && perf.marketsReport.length)
        ? perf.marketsReport.map(mk =>
            `<div class="perf-mini-pill"><span>${escapeHtml(mk.label || mk.market)}</span><strong>%${mk.ratePct ?? mk.accuracyPct}</strong><small>(${mk.hits}/${mk.total} isabet)</small></div>`
        ).join('')
        : '<span style="color:var(--text-muted);font-size:0.78rem;">Henüz yeterli veri yok</span>';

    const lgPills = (perf.leaguesReport && perf.leaguesReport.length)
        ? perf.leaguesReport.slice(0, 6).map(lg =>
            `<div class="perf-mini-pill"><span>${escapeHtml(lg.league)}</span><strong>%${lg.ratePct ?? lg.accuracyPct}</strong><small>(${lg.hits}/${lg.total} isabet)</small></div>`
        ).join('')
        : '<span style="color:var(--text-muted);font-size:0.78rem;">Henüz yeterli veri yok</span>';

    const verifiedRows = (perf.verifiedMatches || []).slice(0, 8).map(v => {
        const badgeClass = v.won ? 'perf-status-won' : 'perf-status-lost';
        const badgeIcon = v.won ? '✅ Kazandı' : '❌ Kaybetti';
        const methodTag = v.testMethod ? `<span style="color:var(--accent-sky);font-weight:600;">[${escapeHtml(v.testMethod)}]</span>` : '';
        return `
            <div class="perf-verified-row">
                <div class="perf-v-top">
                    <span class="perf-v-league">${escapeHtml(v.date || '')} ${escapeHtml(v.time || '')} • ${escapeHtml(v.league)} ${methodTag}</span>
                    <span class="perf-v-badge ${badgeClass}">${badgeIcon}</span>
                </div>
                <div class="perf-v-teams">${escapeHtml(v.match)}</div>
                <div class="perf-v-bottom">
                    <span class="perf-v-score">⚽ Skor: <strong>${escapeHtml(v.score || '-')}</strong></span>
                    <span class="perf-v-pick">🎯 ${escapeHtml(v.pick)} <strong>(%${v.probPct})</strong></span>
                </div>
            </div>
        `;
    }).join('');

    const pendingRows = (perf.pendingPreMatch || []).slice(0, 6).map(p => {
        const oddTxt = p.realOdd ? `Nesine Oranı: ${p.realOdd.toFixed(2)}` : 'Oran bulunamadı';
        return `
            <div class="perf-verified-row">
                <div class="perf-v-top">
                    <span class="perf-v-league">${escapeHtml(p.date || '')} ${escapeHtml(p.time || '')} • ${escapeHtml(p.league)}</span>
                    <span class="perf-v-badge" style="background:rgba(56,189,248,0.14);color:var(--accent-sky);border:1px solid rgba(56,189,248,0.35);">⏳ Maç Öncesi Kaydedildi</span>
                </div>
                <div class="perf-v-teams">${escapeHtml(p.match)}</div>
                <div class="perf-v-bottom">
                    <span class="perf-v-score">🕒 Kayıt: <strong>${escapeHtml(p.recordedBeforeKickoffAt || '-')}</strong></span>
                    <span class="perf-v-pick">🎯 ${escapeHtml(p.pick)} <strong>(%${p.probPct})</strong> • ${escapeHtml(oddTxt)}</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="perf-report-card">
            <div class="perf-report-header">
                <div>
                    <h3>📊 Kronolojik Out-of-Sample (Walk-Forward) Model Performans & Doğrulama Raporu</h3>
                    <p>Her maç yalnızca kendisinden önceki tarihsel verilerle eğitilen modelle kronolojik sırayla test edilmiştir (Eğitim verisi testte tekrar kullanılmaz • ${sampleCount} doğrulanan maç)</p>
                </div>
                <span class="perf-updated-tag">Out-of-Sample Doğrulama</span>
            </div>

            <div class="perf-metrics-grid">
                <div class="perf-metric-box">
                    <span class="perf-m-label">Out-of-Sample İsabet Oranı</span>
                    <span class="perf-m-val highlight-emerald">%${perf.hitRatePct}</span>
                    <span class="perf-m-sub">${perf.bankoHits}/${perf.bankoTotal} maç öncesi tahmin tuttu</span>
                </div>
                <div class="perf-metric-box">
                    <span class="perf-m-label">Brier Kalibrasyon Skoru</span>
                    <span class="perf-m-val">${perf.brierScore}</span>
                    <span class="perf-m-sub">Yalnızca maç öncesi verilerle hesaplandı</span>
                </div>
                <div class="perf-metric-box">
                    <span class="perf-m-label">Log Loss (Entropi Kaybı)</span>
                    <span class="perf-m-val">${perf.logLoss}</span>
                    <span class="perf-m-sub">Kronolojik Walk-Forward test kaybı</span>
                </div>
                <div class="perf-metric-box">
                    <span class="perf-m-label">Kronolojik Test Havuzu</span>
                    <span class="perf-m-val">${sampleCount} Maç</span>
                    <span class="perf-m-sub">Sıfır veri sızıntısı (Out-of-Sample)</span>
                </div>
            </div>

            <div class="perf-splits-row">
                <div class="perf-split-col">
                    <h4>🎯 Bahis Pazarı Bazında Başarı Oranı (Out-of-Sample)</h4>
                    <div class="perf-pills-wrap">${mktPills}</div>
                </div>
                <div class="perf-split-col">
                    <h4>🏆 Lig Bazında Başarı Oranı (Out-of-Sample)</h4>
                    <div class="perf-pills-wrap">${lgPills}</div>
                </div>
            </div>

            <div class="perf-verified-box">
                <h4>📋 Kronolojik Out-of-Sample Test Sonuçları (Her Maç Yalnızca Önceki Verilerle Test Edildi)</h4>
                ${verifiedRows ? `<div class="perf-verified-list">${verifiedRows}</div>` : '<span style="color:var(--text-muted);font-size:0.8rem;">Henüz yeterli veri yok</span>'}
            </div>

            ${pendingRows ? `
            <div class="perf-verified-box">
                <h4>🔒 Maç Başlamadan Kaydedilen Bekleyen Tahminler Tablosu (Maç Bittiğinde Otomatik Karşılaştırılır)</h4>
                <div class="perf-verified-list">${pendingRows}</div>
            </div>
            ` : ''}
        </div>
    `;
}

function formatMatchDateTimeDisplay(m) {
    if (!m) return '';
    let dStr = '';
    if (m.date) {
        const p = m.date.split('-');
        dStr = (p.length === 3) ? `${p[2]}.${p[1]}.${p[0]}` : m.date;
    }
    const tStr = m.time || '';
    if (tStr.includes('Yarın')) {
        return dStr ? `📅 ${dStr} (${tStr})` : `🕒 ${tStr}`;
    }
    return dStr ? `📅 ${dStr} ${tStr}` : `🕒 ${tStr}`;
}

function createCouponMatchElement(item, isSurprise) {
    const m = item.m;
    const an = item.an || {};
    const pr = an.projections || null;
    const div = document.createElement('div');
    div.className = 'coupon-match-item';

    const probPct = Math.round(item.p * 100);
    const hasRealOdd = Boolean(item.hasRealOdd && typeof item.realOdd === 'number' && item.realOdd > 1.01);
    const isValueBet = Boolean(hasRealOdd && item.isValueBet && typeof item.evPct === 'number' && item.evPct > 0);

    // Üst rozetler: Gerçek oran gelmeyen tahminler asla Value Bet olarak etiketlenmez
    const oddBadge = hasRealOdd
        ? `<span class="match-pick-conf">Gerçek Nesine Oranı: ${item.realOdd.toFixed(2)}</span>`
        : `<span class="match-pick-conf" style="color:var(--text-muted);">Nesine Oranı Bulunamadı</span>`;
    const valueBadge = isValueBet
        ? `<span class="match-pick-conf lift-tag">⭐ Value Bet (EV: +%${item.evPct})</span>`
        : (hasRealOdd && item.evPct !== null && item.evPct !== undefined)
            ? `<span class="match-pick-conf" style="color:var(--text-secondary);">EV: ${item.evPct >= 0 ? '+' : ''}%${item.evPct}</span>`
            : `<span class="match-pick-conf" style="color:var(--text-muted);">EV Hesaplanamadı (Oran Yok)</span>`;

    // Sürpriz Kupon için İstatistiksel Ters Sonuç Tipi Rozeti (Item 6)
    const contrarianBadge = item.contrarianType
        ? `<span class="match-pick-badge contrarian-badge" title="Favori yerine yüksek oranlı istatistiksel ters sonuç">⚡ ${escapeHtml(item.contrarianType)}</span>`
        : '';

    // Her tahminde 4 ayrı bilgiyi açıkça gösteren şeffaflık tablosu (Item 3)
    const oddDisplayVal = hasRealOdd
        ? item.realOdd.toFixed(2)
        : 'Oran bulunamadı (Bu pazar bültende kapalı)';
    const oddTimeDisplayVal = hasRealOdd && item.oddsUpdatedAt
        ? `${item.oddsUpdatedAt} ${item.oddsFresh ? '🟢 Canlı' : '⚠️ Yenilenemedi'}`
        : 'Oran yenilenemedi (Eski oran kullanılmadı)';
    const evDisplayVal = (hasRealOdd && item.evPct !== null && item.evPct !== undefined)
        ? `${item.evPct >= 0 ? '+' : ''}%${item.evPct}${isValueBet ? ' (Value Bet)' : ' (Negatif EV)'}`
        : 'Gerçek oran bulunamadığı için hesaplanamadı';

    const transparencyGridHtml = `
        <div class="match-ev-transparency-grid">
            <div class="ev-t-cell">
                <span class="ev-t-label">Model Olasılığı</span>
                <strong class="ev-t-val highlight-emerald">%${probPct}</strong>
            </div>
            <div class="ev-t-cell">
                <span class="ev-t-label">Gerçek Nesine Oranı</span>
                <strong class="ev-t-val">${escapeHtml(oddDisplayVal)}</strong>
            </div>
            <div class="ev-t-cell">
                <span class="ev-t-label">Oran Güncelleme Zamanı</span>
                <strong class="ev-t-val">${escapeHtml(oddTimeDisplayVal)}</strong>
            </div>
            <div class="ev-t-cell">
                <span class="ev-t-label">Beklenen Değer (EV)</span>
                <strong class="ev-t-val ${isValueBet ? 'highlight-gold' : ''}">${escapeHtml(evDisplayVal)}</strong>
            </div>
        </div>
    `;

    // Veri Güven Puanı: Veri Yeterliliği & Veri Güncelliği Ayrı Ayrı (Item 7)
    let dataTrustHtml = '';
    const dt = an.dataTrust || item.dataTrust;
    if (dt && typeof dt.sufficiencyScore === 'number') {
        const suffClass = dt.sufficiencyScore >= 75 ? 'trust-high' : dt.sufficiencyScore >= 50 ? 'trust-med' : 'trust-low';
        const freshClass = dt.freshnessScore >= 75 ? 'trust-high' : dt.freshnessScore >= 50 ? 'trust-med' : 'trust-low';
        const overallClass = dt.overallScore >= 75 ? 'trust-high' : dt.overallScore >= 50 ? 'trust-med' : 'trust-low';

        dataTrustHtml = `
            <div class="match-data-trust-bar">
                <div class="trust-badge-pill sufficiency ${suffClass}" title="Kadro, form, xG, H2H, korner ve şut geçmişi yeterlilik seviyesi">
                    <span class="trust-lbl">📋 Veri Yeterliliği:</span>
                    <strong class="trust-val">%${dt.sufficiencyScore}</strong>
                </div>
                <div class="trust-badge-pill freshness ${freshClass}" title="Nesine canlı oran tazeliği ve anlık veri güncelleme durumu">
                    <span class="trust-lbl">🕒 Veri Güncelliği:</span>
                    <strong class="trust-val">%${dt.freshnessScore}</strong>
                </div>
                <div class="trust-badge-pill overall ${overallClass}" title="Ağırlıklı toplam veri güven skoru">
                    <span class="trust-lbl">🛡️ Veri Güven Puanı:</span>
                    <strong class="trust-val">%${dt.overallScore}</strong>
                </div>
            </div>
        `;
    }

    // Gerçek Korner ve Gerçek Şut / İsabetli Şut Ortalamaları (Item 1 & Item 2)
    let realStatsHtml = '';
    if (pr) {
        const hCorn = (pr.realCornersHFor !== null && pr.realCornersHFor !== undefined) ? pr.realCornersHFor.toFixed(1) : null;
        const aCorn = (pr.realCornersAFor !== null && pr.realCornersAFor !== undefined) ? pr.realCornersAFor.toFixed(1) : null;
        const hShots = (pr.realShotsHFor !== null && pr.realShotsHFor !== undefined) ? pr.realShotsHFor.toFixed(1) : null;
        const aShots = (pr.realShotsAFor !== null && pr.realShotsAFor !== undefined) ? pr.realShotsAFor.toFixed(1) : null;
        const hSot = (pr.realSotHFor !== null && pr.realSotHFor !== undefined) ? pr.realSotHFor.toFixed(1) : null;
        const aSot = (pr.realSotAFor !== null && pr.realSotAFor !== undefined) ? pr.realSotAFor.toFixed(1) : null;

        const cornerLine = (hCorn !== null && aCorn !== null)
            ? `<div class="real-stat-box">
                <div class="real-stat-hdr">🚩 Gerçek Korner Ortalaması <small>(${escapeHtml(pr.cornerDataSource || 'Geçmiş Maçlar')})</small></div>
                <div class="real-stat-vals">
                    <span><strong>${escapeHtml(m.home)}:</strong> ${hCorn}</span>
                    <span class="stat-sep">•</span>
                    <span><strong>${escapeHtml(m.away)}:</strong> ${aCorn}</span>
                    <span class="stat-sep">•</span>
                    <span class="stat-proj">Model Beklentisi: <strong>${pr.totalCorners}</strong></span>
                </div>
               </div>`
            : `<div class="real-stat-box">
                <div class="real-stat-hdr">🚩 Korner Beklentisi</div>
                <div class="real-stat-vals"><span class="stat-proj">Model Beklentisi: <strong>${pr.totalCorners} korner</strong></span></div>
               </div>`;

        const shotLine = (hShots !== null && aShots !== null)
            ? `<div class="real-stat-box">
                <div class="real-stat-hdr">🎯 Gerçek Şut & İsabet Ortalaması <small>(${escapeHtml(pr.shotDataSource || 'Geçmiş Maçlar')})</small></div>
                <div class="real-stat-vals">
                    <span><strong>${escapeHtml(m.home)}:</strong> ${hShots} şut <em>(${hSot} isabet)</em></span>
                    <span class="stat-sep">•</span>
                    <span><strong>${escapeHtml(m.away)}:</strong> ${aShots} şut <em>(${aSot} isabet)</em></span>
                </div>
               </div>`
            : `<div class="real-stat-box">
                <div class="real-stat-hdr">🎯 Şut Beklentisi</div>
                <div class="real-stat-vals"><span class="stat-proj">Model: <strong>${pr.sotH} - ${pr.sotA} isabetli şut</strong></span></div>
               </div>`;

        realStatsHtml = `<div class="match-real-stats-row">${cornerLine}${shotLine}</div>`;
    }

    // Sakatlık, Cezalı Oyuncular ve İlk 11 Kadrosu (Item 4)
    let squadHtml = '';
    const sq = an.squad || (m.intel && m.intel.squad);
    if (sq) {
        const homeMiss = (sq.homeMissing && sq.homeMissing.length) ? sq.homeMissing : [];
        const awayMiss = (sq.awayMissing && sq.awayMissing.length) ? sq.awayMissing : [];
        const hasMissing = homeMiss.length > 0 || awayMiss.length > 0;

        const homeXI = (sq.homeXI && sq.homeXI.length) ? sq.homeXI : [];
        const awayXI = (sq.awayXI && sq.awayXI.length) ? sq.awayXI : [];
        const hasXI = homeXI.length > 0 || awayXI.length > 0;

        if (hasMissing || hasXI) {
            let missRow = '';
            if (hasMissing) {
                const hMissStr = homeMiss.length ? homeMiss.slice(0, 3).map(p => escapeHtml(p.name || p)).join(', ') : 'Eksik bildirilmedi';
                const aMissStr = awayMiss.length ? awayMiss.slice(0, 3).map(p => escapeHtml(p.name || p)).join(', ') : 'Eksik bildirilmedi';
                missRow = `
                    <div class="squad-sub-row squad-missing">
                        <span class="squad-sub-lbl">🏥 Eksik/Cezalı:</span>
                        <div class="squad-sub-content">
                            <span><strong>${escapeHtml(m.home)}:</strong> ${hMissStr}</span>
                            <span class="stat-sep">•</span>
                            <span><strong>${escapeHtml(m.away)}:</strong> ${aMissStr}</span>
                        </div>
                    </div>
                `;
            }

            let xiRow = '';
            if (hasXI) {
                const hXiStr = homeXI.slice(0, 4).map(p => escapeHtml(p.name || p)).join(', ') + (homeXI.length > 4 ? '...' : '');
                const aXiStr = awayXI.slice(0, 4).map(p => escapeHtml(p.name || p)).join(', ') + (awayXI.length > 4 ? '...' : '');
                xiRow = `
                    <div class="squad-sub-row squad-xi">
                        <span class="squad-sub-lbl">👥 ${escapeHtml(sq.lineupType || 'İlk 11')}:</span>
                        <div class="squad-sub-content">
                            <span><strong>${escapeHtml(m.home)}:</strong> ${hXiStr}</span>
                            <span class="stat-sep">•</span>
                            <span><strong>${escapeHtml(m.away)}:</strong> ${aXiStr}</span>
                        </div>
                    </div>
                `;
            }

            squadHtml = `
                <div class="match-squad-intel-block">
                    <div class="squad-hdr">
                        <span class="squad-type-badge">${escapeHtml(sq.lineupType || 'Kadro Verisi')}</span>
                        ${(sq.homeFormation || sq.awayFormation) ? `<span class="squad-formation-tag">Diziliş: ${escapeHtml(sq.homeFormation || '-')} vs ${escapeHtml(sq.awayFormation || '-')}</span>` : ''}
                    </div>
                    ${missRow}
                    ${xiRow}
                </div>
            `;
        }
    }

    // 10 katmanlı derin analiz rozetleri (xG, Son 5/10 Form, Taktik DNA, Risk Seviyesi, Hava Durumu, Gol Kralı)
    const chips = [];
    if (typeof an.lh === 'number' && typeof an.la === 'number') {
        chips.push(`<span class="intel-chip">📊 xG: ${an.lh.toFixed(2)} - ${an.la.toFixed(2)}</span>`);
    }
    if (an.tactical?.homeTags?.[0] || an.tactical?.awayTags?.[0]) {
        chips.push(`<span class="intel-chip">🧬 ${escapeHtml(an.tactical.homeTags[0] || '')} / ${escapeHtml(an.tactical.awayTags[0] || '')}</span>`);
    }
    if (an.facts?.home?.formStr || an.facts?.away?.formStr) {
        const h10 = an.facts?.home?.last10Pts !== undefined ? ` (10M:${an.facts.home.last10Pts}p)` : '';
        const a10 = an.facts?.away?.last10Pts !== undefined ? ` (10M:${an.facts.away.last10Pts}p)` : '';
        chips.push(`<span class="intel-chip">🔥 Form: ${escapeHtml(an.facts?.home?.formStr || '-')}${h10} / ${escapeHtml(an.facts?.away?.formStr || '-')}${a10}</span>`);
    }
    if (item.confidenceLevel) {
        chips.push(`<span class="intel-chip">🏷️ ${escapeHtml(item.confidenceLevel)}</span>`);
    }
    if (item.riskLevel) {
        chips.push(`<span class="intel-chip">⚖️ ${escapeHtml(item.riskLevel)}</span>`);
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
        ? `<div class="match-intel-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin:4px 0;">${chips.join('')}</div>`
        : '';

    div.innerHTML = `
        <div class="match-item-top">
            <span class="match-item-time">${formatMatchDateTimeDisplay(m)} | 🏆 ${escapeHtml(m.league.full)}</span>
            ${m.youth ? '<span class="team-tags tag-youth">Gençlik / U</span>' : ''}
            ${m.women ? '<span class="team-tags tag-women">Kadın</span>' : ''}
        </div>
        <div class="match-item-teams">
            ${escapeHtml(m.home)} <span style="color:var(--text-muted);font-weight:400;">vs</span> ${escapeHtml(m.away)}
        </div>
        <div class="match-item-pick-row">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="match-pick-badge ${isSurprise ? 'gold-badge' : ''}">${escapeHtml(item.label)}</span>
                ${contrarianBadge}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="match-pick-conf">%${probPct} Model Olasılığı</span>
                ${oddBadge}
                ${valueBadge}
            </div>
        </div>
        ${dataTrustHtml}
        ${transparencyGridHtml}
        ${realStatsHtml}
        ${squadHtml}
        ${chipsHtml}
        <div class="match-item-rationale">${escapeHtml(item.rationale)}</div>
        <div class="match-item-actions">
            <button type="button" class="btn-item-action btn-ai-action" style="flex: 1;">AI ile Derin Analiz Et</button>
        </div>
    `;

    div.querySelector('.btn-ai-action').addEventListener('click', () => {
        const prompt = `${m.home} vs ${m.away} (${m.league.full}) maçını xG/xGA, gerçek şut ve korner ortalamaları, sakatlık/ilk 11 durumu, son 10 maç formu, ortak rakipler, H2H, hava şartları ve 25+ Nesine pazarıyla derinlemesine analiz et.`;
        askAiDirectly(prompt);
    });

    return div;
}

/* ==========================================================================
   SİSTEM VE HATA LOG GÜNLÜĞÜ (DIAGNOSTICS & ERROR CONSOLE)
   ========================================================================== */
function bindSystemLogs() {
    const systemLogsBtn = document.getElementById('systemLogsBtn');
    const systemLogsModal = document.getElementById('systemLogsModal');
    const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
    const closeLogsFooterBtn = document.getElementById('closeLogsFooterBtn');
    const refreshLogsBtn = document.getElementById('refreshLogsBtn');
    const copyLogsBtn = document.getElementById('copyLogsBtn');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const logsSearchInput = document.getElementById('logsSearchInput');
    const logsLevelFilter = document.getElementById('logsLevelFilter');
    const logsCategoryFilter = document.getElementById('logsCategoryFilter');
    const systemLogsList = document.getElementById('systemLogsList');
    const logErrorBadge = document.getElementById('logErrorBadge');

    const logStatTotal = document.getElementById('logStatTotal');
    const logStatErrors = document.getElementById('logStatErrors');
    const logStatWarnings = document.getElementById('logStatWarnings');
    const logStatAi = document.getElementById('logStatAi');
    const logStatData = document.getElementById('logStatData');
    const logsAutoStatusText = document.getElementById('logsAutoStatusText');

    let cachedLogs = [];
    let isFetchingLogs = false;

    // 1. İstemci (Browser) Hatalarını Otomatik Sunucuya ve Konsola Kaydet
    function reportClientLog(level, category, scope, message, details = null) {
        try {
            fetch('/api/logs/client', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level, category, scope, message, details })
            }).then(() => pollLogsBadge()).catch(() => {});
        } catch (_) {}
    }

    window.addEventListener('error', (e) => {
        reportClientLog('error', 'client', 'WindowError', e.message || 'Bilinmeyen script hatası', {
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno,
            stack: e.error ? e.error.stack : null
        });
    });

    window.addEventListener('unhandledrejection', (e) => {
        const msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled Promise Rejection';
        reportClientLog('error', 'client', 'UnhandledRejection', msg, {
            stack: e.reason && e.reason.stack ? e.reason.stack : null
        });
    });

    // 2. Logları API'den Çek ve Render Et
    async function fetchLogs(showSpinner = false) {
        if (isFetchingLogs) return;
        isFetchingLogs = true;
        if (showSpinner && systemLogsList) {
            systemLogsList.innerHTML = `
                <div class="logs-loading-state">
                    <div class="spinner"></div>
                    <span>Sistem logları yükleniyor...</span>
                </div>
            `;
        }

        try {
            const res = await fetch('/api/logs');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            cachedLogs = Array.isArray(data.logs) ? data.logs : [];
            const stats = data.stats || {};

            // İstatistikleri güncelle
            if (logStatTotal) logStatTotal.textContent = stats.total ?? cachedLogs.length;
            if (logStatErrors) logStatErrors.textContent = stats.errors ?? 0;
            if (logStatWarnings) logStatWarnings.textContent = stats.warnings ?? 0;
            if (logStatAi) logStatAi.textContent = stats.aiIssues ?? 0;
            if (logStatData) logStatData.textContent = stats.dataIssues ?? 0;

            updateErrorBadge(stats.errors || 0);

            if (logsAutoStatusText) {
                logsAutoStatusText.textContent = `Son güncelleme: ${stats.lastUpdated || new Date().toLocaleTimeString('tr-TR')} • Canlı izleme aktif`;
            }

            renderLogs();
        } catch (err) {
            console.error('Log çekme hatası:', err);
            if (systemLogsList) {
                systemLogsList.innerHTML = `
                    <div class="logs-empty-state">
                        <span style="color:#ef4444;font-weight:700;">⚠️ Loglar yüklenemedi</span>
                        <span>${escapeHtml(err.message)}</span>
                    </div>
                `;
            }
        } finally {
            isFetchingLogs = false;
        }
    }

    // Sol menüdeki buton rozetini güncelle
    function updateErrorBadge(errorCount) {
        if (!logErrorBadge) return;
        if (errorCount > 0) {
            logErrorBadge.style.display = 'inline-flex';
            logErrorBadge.textContent = errorCount > 99 ? '99+' : String(errorCount);
        } else {
            logErrorBadge.style.display = 'none';
        }
    }

    async function pollLogsBadge() {
        try {
            const res = await fetch('/api/logs');
            if (res.ok) {
                const data = await res.json();
                const errCount = data.stats?.errors || 0;
                updateErrorBadge(errCount);
            }
        } catch (_) {}
    }

    // Log Listesini Filtreleyerek Render Et
    function renderLogs() {
        if (!systemLogsList) return;
        const q = (logsSearchInput ? logsSearchInput.value : '').trim().toLowerCase();
        const levelFilter = logsLevelFilter ? logsLevelFilter.value : 'all';
        const catFilter = logsCategoryFilter ? logsCategoryFilter.value : 'all';

        let list = cachedLogs.filter(log => {
            if (levelFilter !== 'all' && log.level !== levelFilter) return false;
            if (catFilter !== 'all' && log.category !== catFilter) return false;
            if (q) {
                const txt = `${log.message} ${log.scope} ${log.category} ${log.timeStr} ${log.details || ''}`.toLowerCase();
                if (!txt.includes(q)) return false;
            }
            return true;
        });

        if (list.length === 0) {
            systemLogsList.innerHTML = `
                <div class="logs-empty-state">
                    <span>Kriterlere uygun olay veya hata kaydı bulunamadı.</span>
                    <small style="color:var(--text-muted);font-size:0.7rem;">Sistem şu an sağlıklı çalışıyor.</small>
                </div>
            `;
            return;
        }

        systemLogsList.innerHTML = list.map(log => {
            const lvlClass = `level-${log.level || 'info'}`;
            const lvlBadgeText = (log.level || 'info').toUpperCase();
            const catLabel = getCategoryLabel(log.category);
            const hasDetails = Boolean(log.details && String(log.details).trim());

            const detailsHtml = hasDetails ? `
                <details class="log-details-toggle">
                    <summary>🔍 Detayları & Stack Trace Göster</summary>
                    <pre class="log-details-content">${escapeHtml(log.details)}</pre>
                </details>
            ` : '';

            return `
                <div class="log-terminal-row ${lvlClass}">
                    <div class="log-row-header">
                        <span class="log-time-tag">${escapeHtml(log.timeStr || '')}</span>
                        <span class="log-badge-tag ${lvlClass}">${lvlBadgeText}</span>
                        <span class="log-cat-tag">${escapeHtml(catLabel)}</span>
                        <span class="log-scope-tag">[${escapeHtml(log.scope || 'App')}]</span>
                    </div>
                    <div class="log-row-msg">${escapeHtml(log.message || '')}</div>
                    ${detailsHtml}
                </div>
            `;
        }).join('');
    }

    function getCategoryLabel(cat) {
        switch (cat) {
            case 'ai': return '🤖 AI & LLM';
            case 'nesine': return '🟢 Nesine Oran';
            case 'football': return '⚽ Futbol/Bülten';
            case 'data': return '📊 Arşiv/Veri';
            case 'server': return '🌐 Sunucu';
            case 'client': return '💻 Tarayıcı';
            default: return '⚙️ Sistem';
        }
    }

    // Modal Aç / Kapa
    function openLogsModal() {
        if (systemLogsModal) {
            systemLogsModal.classList.add('active');
            fetchLogs(true);
        }
    }

    function closeLogsModal() {
        if (systemLogsModal) {
            systemLogsModal.classList.remove('active');
        }
    }

    // Event Dinleyicileri
    if (systemLogsBtn) {
        systemLogsBtn.addEventListener('click', openLogsModal);
    }
    if (closeLogsModalBtn) closeLogsModalBtn.addEventListener('click', closeLogsModal);
    if (closeLogsFooterBtn) closeLogsFooterBtn.addEventListener('click', closeLogsModal);

    if (systemLogsModal) {
        systemLogsModal.addEventListener('click', (e) => {
            if (e.target === systemLogsModal) closeLogsModal();
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && systemLogsModal && systemLogsModal.classList.contains('active')) {
            closeLogsModal();
        }
    });

    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', () => fetchLogs(true));
    }

    if (logsSearchInput) {
        logsSearchInput.addEventListener('input', renderLogs);
    }
    if (logsLevelFilter) {
        logsLevelFilter.addEventListener('change', renderLogs);
    }
    if (logsCategoryFilter) {
        logsCategoryFilter.addEventListener('change', renderLogs);
    }

    if (copyLogsBtn) {
        copyLogsBtn.addEventListener('click', () => {
            if (!cachedLogs.length) return;
            const textToCopy = cachedLogs.map(l => 
                `[${l.timeStr}] [${(l.level || 'info').toUpperCase()}] [${l.category || ''}] [${l.scope || ''}] ${l.message} ${l.details ? '\n' + l.details : ''}`
            ).join('\n---\n');

            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalHtml = copyLogsBtn.innerHTML;
                copyLogsBtn.innerHTML = '<span>✅ Kopyalandı!</span>';
                setTimeout(() => { copyLogsBtn.innerHTML = originalHtml; }, 1800);
            }).catch(() => {
                alert('Loglar panoya kopyalanamadı.');
            });
        });
    }

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            if (!confirm('Tüm sistem log günlüğü temizlensin mi?')) return;
            try {
                await fetch('/api/logs/clear', { method: 'POST' });
                await fetchLogs(true);
            } catch (_) {}
        });
    }

    // İlk açılışta ve her 25 saniyede bir rozet kontrolü
    pollLogsBadge();
    setInterval(pollLogsBadge, 25000);
}
