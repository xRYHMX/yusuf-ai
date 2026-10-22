// Günün Sürpriz Kuponu - Sadece Sürpriz Kupon, Maçlar ve Anlık Veriler
let currentTheme = localStorage.getItem('app_theme') || 'dark';

// DOM Elemanları
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeBtnText = document.getElementById('themeBtnText');
const refreshCouponsBtn = document.getElementById('refreshCouponsBtn');
const couponsLoading = document.getElementById('couponsLoading');
const couponsContent = document.getElementById('couponsContent');
const nesineLiveStatusBar = document.getElementById('nesineLiveStatusBar');

const surpriseTitle = document.getElementById('surpriseTitle');
const surpriseMatchesList = document.getElementById('surpriseMatchesList');

// Başlat
init();

function init() {
    initTheme();
    bindEvents();
    loadCoupons(false);
    
    // Anlık verileri her 45 saniyede bir otomatik yenile (canlı skorlar & taze oranlar)
    setInterval(() => {
        loadCoupons(true);
    }, 45000);
}

function initTheme() {
    document.body.className = currentTheme === 'light' ? 'theme-light' : 'theme-dark';
    updateThemeButtonDisplay();
}

function updateThemeButtonDisplay() {
    if (!themeIcon || !themeBtnText) return;
    if (currentTheme === 'light') {
        themeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        themeBtnText.textContent = 'Aydınlık';
    } else {
        themeIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        themeBtnText.textContent = 'Karanlık';
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('app_theme', currentTheme);
    initTheme();
}

function bindEvents() {
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }
    if (refreshCouponsBtn) {
        refreshCouponsBtn.addEventListener('click', () => loadCoupons(false));
    }
}

async function loadCoupons(isSilent = false) {
    if (!isSilent) {
        if (couponsLoading) couponsLoading.style.display = 'flex';
        if (couponsContent) couponsContent.style.display = 'none';
    }
    try {
        const res = await fetch('/api/football/coupons');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderNesineStatus(data.nesineStatus);
        renderCoupons(data);
    } catch (err) {
        console.error('Kupon yükleme hatası:', err);
        if (!isSilent && couponsLoading) {
            couponsLoading.innerHTML = `<div style="color:#ef4444;font-size:0.9rem;">Veriler yüklenirken hata oluştu: ${escapeHtml(err.message)}</div>`;
        }
    } finally {
        if (!isSilent) {
            if (couponsLoading) couponsLoading.style.display = 'none';
            if (couponsContent) couponsContent.style.display = 'grid';
        }
    }
}

function renderNesineStatus(status) {
    if (!nesineLiveStatusBar) return;
    if (!status) {
        nesineLiveStatusBar.style.display = 'none';
        return;
    }
    const isFresh = Boolean(status.isFresh);
    nesineLiveStatusBar.style.display = 'flex';
    nesineLiveStatusBar.className = `nesine-status-bar ${isFresh ? 'live' : 'stale'}`;
    
    const dotHtml = `<span class="nesine-st-dot" style="background:${isFresh ? '#10b981' : '#ef4444'}"></span>`;
    const textHtml = `<strong>Nesine Canlı Oranlar:</strong> ${status.activeMatchCount || 0} maç bültende • Son veri: ${status.updatedAt || 'Bilinmiyor'} (${status.ageSeconds ?? 0}s önce)`;
    nesineLiveStatusBar.innerHTML = `<div class="nesine-st-pill">${dotHtml}<span>${textHtml}</span></div>`;
}

function renderCoupons(data) {
    const surp = data.surprise;
    if (!surp || !surpriseMatchesList) return;

    if (surpriseTitle) {
        surpriseTitle.textContent = surp.title || 'Sürpriz Kupon';
    }
    
    const hasSurpMatches = Array.isArray(surp.matches) && surp.matches.length > 0;
    if (hasSurpMatches) {
        surpriseMatchesList.innerHTML = '';
        surp.matches.forEach(item => {
            surpriseMatchesList.appendChild(createMatchItem(item, true));
        });
    } else {
        surpriseMatchesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px;">Bugün için sürpriz kriterlerini karşılayan maç bulunamadı.</div>';
    }
}

function createMatchItem(item, isSurprise) {
    const m = item.m || {};
    const div = document.createElement('div');
    div.className = 'coupon-match-item';

    // 1. Anlık Maç Durumu ve Canlı Skor
    let statusClass = 'upcoming';
    let statusText = '⏳ Başlamadı';
    let scoreHtml = '';

    if (m.state === 'live') {
        statusClass = 'live';
        statusText = `🔴 CANLI ${m.label || ''}`.trim();
        if (m.score) {
            scoreHtml = `<span class="match-score-badge live-score">${m.score.h} - ${m.score.a}</span>`;
        }
    } else if (m.state === 'post') {
        statusClass = 'finished';
        statusText = '🏁 Bitti';
        if (m.score) {
            scoreHtml = `<span class="match-score-badge">${m.score.h} - ${m.score.a}</span>`;
        }
    }

    // 2. Anlık Oran & Olasılık & EV
    const probPct = Math.round((item.p || 0) * 100);
    const hasRealOdd = Boolean(item.hasRealOdd && typeof item.realOdd === 'number' && item.realOdd > 1.01);
    const isValueBet = Boolean(hasRealOdd && item.isValueBet && typeof item.evPct === 'number' && item.evPct > 0);

    const oddDisplay = hasRealOdd
        ? `Nesine: <strong>${item.realOdd.toFixed(2)}</strong>`
        : `<span style="color:var(--text-muted);">Oran Bekleniyor</span>`;

    const oddTimeDisplay = hasRealOdd && item.oddsUpdatedAt
        ? `${item.oddsUpdatedAt} ${item.oddsFresh ? '• Canlı' : ''}`
        : '';

    const evDisplay = isValueBet
        ? `<span class="match-ev-badge">+%${item.evPct} EV</span>`
        : '';

    div.innerHTML = `
        <div class="match-item-top">
            <span class="match-item-time">${formatMatchDateTime(m)} • 🏆 ${escapeHtml(m.league?.full || m.league?.name || '')}</span>
            <span class="match-live-tag ${statusClass}">${statusText}</span>
        </div>
        <div class="match-item-teams">
            <span class="team-names">${escapeHtml(m.home || '')} <span class="vs-label">vs</span> ${escapeHtml(m.away || '')}</span>
            ${scoreHtml}
        </div>
        <div class="match-item-pick-row">
            <div class="pick-left">
                <span class="match-pick-badge ${isSurprise ? 'gold-badge' : ''}">${escapeHtml(item.label || '')}</span>
                <span class="match-prob">%${probPct} Olasılık</span>
            </div>
            <div class="pick-right">
                <span class="match-real-odd">${oddDisplay}</span>
                ${evDisplay}
                ${oddTimeDisplay ? `<span class="match-odd-time">${escapeHtml(oddTimeDisplay)}</span>` : ''}
            </div>
        </div>
    `;

    return div;
}

function formatMatchDateTime(m) {
    if (!m) return '';
    const dateStr = m.date || '';
    const timeStr = m.time || '';
    if (timeStr.includes('Yarın')) return timeStr;
    if (dateStr) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]} ${timeStr}`.trim();
        }
    }
    return timeStr;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
