// Analiz motoru: takım gücü -> beklenen goller -> tüm pazarların olasılığı -> kupon seçimi.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mk = require('./mackolik');

const WINDOW = 75;        // gün
const HALF_LIFE = 35;     // gün: yakın maçlar daha ağırlıklı
const K = 4;              // küçülme (az veri -> ortalamaya çek)
const MAXN = 10;

const pmfArr = (l, n = MAXN) => { const p = [Math.exp(-l)]; for (let k = 1; k <= n; k++) p.push(p[k - 1] * l / k); return p; };
const outcome3 = (d) => (d > 0 ? 0 : d === 0 ? 1 : 2);   // 0: ev, 1: beraberlik, 2: deplasman

// ---------------- Hızlı λ uydurma ızgarası (piyasa kalibrasyonu için) ----------------
const GRID = []; for (let x = 0.3; x <= 3.801; x += 0.1) GRID.push(+x.toFixed(2));
const GP = GRID.map(l => pmfArr(l));
const GC = GP.map(p => { let s = 0; return p.map(v => (s += v)); });

function fitLambda(p1, pX, p2, pO, lh0, la0) {
    let best = [lh0, la0], bestE = Infinity;
    for (let a = 0; a < GRID.length; a++) {
        const ph = GP[a];
        for (let b = 0; b < GRID.length; b++) {
            const pa = GP[b], ca = GC[b];
            let w = 0, d = 0;
            for (let i = 0; i <= MAXN; i++) { w += ph[i] * (i > 0 ? ca[i - 1] : 0); d += ph[i] * pa[i]; }
            const tot = GRID[a] + GRID[b];
            const over = 1 - Math.exp(-tot) * (1 + tot + tot * tot / 2);
            let e = (w - p1) ** 2 + (d - pX) ** 2 + ((1 - w - d) - p2) ** 2;
            if (pO !== null) e += 1.5 * (over - pO) ** 2;
            e += 0.004 * ((GRID[a] - lh0) ** 2 + (GRID[b] - la0) ** 2);
            if (e < bestE) { bestE = e; best = [GRID[a], GRID[b]]; }
        }
    }
    return best;
}

// ---------------- Kronolojik Zaman Damgası & Sıralama Yardımcıları ----------------
function getMatchTimestamp(g) {
    if (!g) return null;
    if (typeof g === 'number' && !isNaN(g)) return g;
    if (typeof g === 'string') {
        if (g.includes('T')) {
            const ms = new Date(g).getTime();
            return isNaN(ms) ? null : ms;
        }
        const mDateMatch = g.match(/^\d{4}-\d{2}-\d{2}/);
        if (mDateMatch) {
            const ms = new Date(mDateMatch[0] + 'T12:00:00Z').getTime();
            return isNaN(ms) ? null : ms;
        }
    }
    if (g.kickoff) {
        const ms = new Date(g.kickoff).getTime();
        if (!isNaN(ms)) return ms;
    }
    const d = g.date;
    if (!d) return null;
    const t = g.time ? (g.time.length === 5 ? g.time + ':00' : g.time) : null;
    if (t) {
        const ms = new Date(`${d}T${t}Z`).getTime();
        if (!isNaN(ms)) return ms;
    }
    const ms = new Date(`${d}T12:00:00Z`).getTime();
    return isNaN(ms) ? null : ms;
}

// Bir geçmiş maçın, hedef maçtan KESİNLİKLE ÖNCE oynanıp tamamlandığını doğrular
function isMatchStrictlyPrior(pastMatch, targetMatchOrCutoff) {
    if (!pastMatch) return false;
    if (!targetMatchOrCutoff) return true; // Hedef belirtilmemişse filtre uygulanmaz

    // 1. Hedef maçın kendisi ASLA geçmiş veri olamaz!
    if (typeof targetMatchOrCutoff === 'object' && targetMatchOrCutoff.id && pastMatch.id) {
        if (String(pastMatch.id) === String(targetMatchOrCutoff.id)) return false;
    }

    // Hedef zamanı belirle
    let targetKickoffMs = null;
    let targetDateStr = null;

    if (typeof targetMatchOrCutoff === 'number') {
        targetKickoffMs = targetMatchOrCutoff;
    } else if (typeof targetMatchOrCutoff === 'string') {
        if (targetMatchOrCutoff.includes('T')) {
            const ms = new Date(targetMatchOrCutoff).getTime();
            if (!isNaN(ms)) targetKickoffMs = ms;
        }
        const mDateMatch = targetMatchOrCutoff.match(/^\d{4}-\d{2}-\d{2}/);
        if (mDateMatch) targetDateStr = mDateMatch[0];
    } else if (typeof targetMatchOrCutoff === 'object') {
        targetDateStr = targetMatchOrCutoff.date || null;
        if (targetMatchOrCutoff.kickoff) {
            const ms = new Date(targetMatchOrCutoff.kickoff).getTime();
            if (!isNaN(ms)) targetKickoffMs = ms;
        }
        if (!targetKickoffMs && targetMatchOrCutoff.date && targetMatchOrCutoff.time) {
            const t = targetMatchOrCutoff.time.length === 5 ? targetMatchOrCutoff.time + ':00' : targetMatchOrCutoff.time;
            const ms = new Date(`${targetMatchOrCutoff.date}T${t}Z`).getTime();
            if (!isNaN(ms)) targetKickoffMs = ms;
        }
    }

    // Geçmiş maçın zamanını belirle
    let pastKickoffMs = null;
    if (pastMatch.kickoff) {
        const ms = new Date(pastMatch.kickoff).getTime();
        if (!isNaN(ms)) pastKickoffMs = ms;
    }
    if (!pastKickoffMs && pastMatch.date && pastMatch.time) {
        const t = pastMatch.time.length === 5 ? pastMatch.time + ':00' : pastMatch.time;
        const ms = new Date(`${pastMatch.date}T${t}Z`).getTime();
        if (!isNaN(ms)) pastKickoffMs = ms;
    }
    const pastDateStr = pastMatch.date || null;

    // KURAL 1: Hem geçmiş maçın hem de hedef maçın gerçek başlama saati/kickoff zamanı varsa:
    if (targetKickoffMs !== null && pastKickoffMs !== null) {
        // Hedef maçtan önce başlamış olan maç kesinlikle geçmiş maçtır (aynı gün olsa dahi dahil edilir)
        return pastKickoffMs < targetKickoffMs;
    }

    // KURAL 2: Kickoff bilgisi eksik veya geçersizse GÜVENLİ DAVRAN:
    // Hedef maçın kickoff saati bilinmiyorsa, aynı günkü maçların hedef maçtan önce mi sonra mı olduğu bilinemez.
    // Gelecekteki verilerin sızmaması için aynı gün ve sonraki tüm maçlar dışlanır (yalnızca pastDate < targetDate)
    if (targetDateStr && pastDateStr) {
        if (pastDateStr < targetDateStr) return true;
        return false;
    }

    if (targetKickoffMs !== null && pastDateStr) {
        const pastDayEndMs = new Date(pastDateStr + 'T23:59:59Z').getTime();
        if (pastDayEndMs < targetKickoffMs) return true;
        return false;
    }

    return false;
}

function getSortedMatchesDesc(list) {
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.slice().sort((a, b) => {
        const tA = getMatchTimestamp(a) || 0;
        const tB = getMatchTimestamp(b) || 0;
        if (tA !== tB) return tB - tA; // En yeni maç en başta (index 0)
        return String(b.id || '').localeCompare(String(a.id || ''));
    });
}

// ---------------- Model kurulumu (yalnızca asOf / kickoff öncesindeki maçlarla) ----------------
function buildModel(hist, asOf, opts = {}) {
    const asOfStr = String(asOf || '');
    const asOfT = new Date(asOfStr.includes('T') ? asOfStr : asOfStr + 'T00:00:00Z').getTime();
    const maxKickoffMs = opts.maxKickoff ? new Date(opts.maxKickoff).getTime() : (asOfStr.includes('T') ? asOfT : null);
    const rows = [];
    for (const m of hist) {
        if (m.state !== 'post' || !m.score || !m.ht) continue;
        // Kesin kural: Yalnızca test/tahmin tarih ve saatinden ÖNCEKİ maçları kullan (veri sızıntısını engelle)
        if (maxKickoffMs !== null) {
            const kMs = getMatchTimestamp(m);
            if (!kMs || !(kMs < maxKickoffMs)) continue;
        } else if (m.date >= asOfStr.slice(0, 10)) {
            continue;
        }
        const mTimeMs = getMatchTimestamp(m) || new Date(m.date + 'T00:00:00Z').getTime();
        const days = (asOfT - mTimeMs) / 86400000;
        if (days > WINDOW || days < 0) continue;
        rows.push({ m, w: Math.pow(0.5, days / HALF_LIFE) });
    }

    // Kronolojik sıralama (eskiden yeniye)
    rows.sort((a, b) => {
        if (a.m.date !== b.m.date) return a.m.date < b.m.date ? -1 : 1;
        return String(a.m.time || '').localeCompare(String(b.m.time || ''));
    });

    // Geçiş 1: lig ortalamaları
    const leagues = new Map();
    const glob = { w: 0, gh: 0, ga: 0, g1: 0, g: 0 };
    for (const { m, w } of rows) {
        const lg = leagues.get(m.league.id) || { w: 0, n: 0, gh: 0, ga: 0, g1: 0, g: 0 };
        const tot = m.score.h + m.score.a, t1 = m.ht.h + m.ht.a;
        lg.w += w; lg.n++; lg.gh += w * m.score.h; lg.ga += w * m.score.a; lg.g1 += w * t1; lg.g += w * tot;
        leagues.set(m.league.id, lg);
        glob.w += w; glob.gh += w * m.score.h; glob.ga += w * m.score.a; glob.g1 += w * t1; glob.g += w * tot;
    }
    glob.muH = glob.w > 0 ? glob.gh / glob.w : 1.45;
    glob.muA = glob.w > 0 ? glob.ga / glob.w : 1.15;
    glob.s1 = glob.g > 0 ? glob.g1 / glob.g : 0.44;
    glob.homeAdv = +(glob.muH / Math.max(0.5, glob.muA)).toFixed(2);
    const lgStat = (id) => {
        const lg = leagues.get(id);
        if (!lg || lg.n < 25) return { muH: glob.muH, muA: glob.muA, s1: glob.s1, homeAdv: glob.homeAdv, n: lg ? lg.n : 0 };
        const k = 12;  // lig ortalamasını globale doğru küçült
        const muH = (lg.gh + k * glob.muH) / (lg.w + k);
        const muA = (lg.ga + k * glob.muA) / (lg.w + k);
        return {
            muH,
            muA,
            s1: (lg.g1 + 8 * glob.s1) / (lg.g + 8),
            homeAdv: +(muH / Math.max(0.5, muA)).toFixed(2),
            n: lg.n
        };
    };

    // Geçiş 2: takım istatistikleri (Genel + İç Saha / Dış Saha Ayrı)
    const teams = new Map();
    const T = (id, name) => {
        let t = teams.get(id);
        if (!t) {
            t = {
                id, name,
                n: 0, w: 0, gf: 0, bgf: 0, ga: 0, bga: 0, gf1: 0, ga1: 0,
                hn: 0, hw: 0, hgf: 0, hbgf: 0, hga: 0, hbga: 0, hgf1: 0, hga1: 0,
                an: 0, aw: 0, agf: 0, abgf: 0, aga: 0, abga: 0, agf1: 0, aga1: 0,
                last: [],
                homeLast: [],
                awayLast: []
            };
            teams.set(id, t);
        }
        t.name = name;
        return t;
    };
    for (const { m, w } of rows) {
        const L = lgStat(m.league.id);
        const h = T(m.homeId, m.home), a = T(m.awayId, m.away);

        // Ev sahibi (genel + iç saha)
        h.n++; h.w += w; h.gf += w * m.score.h; h.bgf += w * L.muH; h.ga += w * m.score.a; h.bga += w * L.muA; h.gf1 += w * m.ht.h; h.ga1 += w * m.ht.a;
        h.hn++; h.hw += w; h.hgf += w * m.score.h; h.hbgf += w * L.muH; h.hga += w * m.score.a; h.hbga += w * L.muA; h.hgf1 += w * m.ht.h; h.hga1 += w * m.ht.a;

        // Deplasman (genel + dış saha)
        a.n++; a.w += w; a.gf += w * m.score.a; a.bgf += w * L.muA; a.ga += w * m.score.h; a.bga += w * L.muH; a.gf1 += w * m.ht.a; a.ga1 += w * m.ht.h;
        a.an++; a.aw += w; a.agf += w * m.score.a; a.abgf += w * L.muA; a.aga += w * m.score.h; a.abga += w * L.muH; a.agf1 += w * m.ht.a; a.aga1 += w * m.ht.h;

        const hMatch = { id: m.id, isHome: true, date: m.date, time: m.time, kickoff: m.kickoff, oppId: m.awayId, opp: m.away, home: true, gf: m.score.h, ga: m.score.a, ht: m.ht };
        const aMatch = { id: m.id, isHome: false, date: m.date, time: m.time, kickoff: m.kickoff, oppId: m.homeId, opp: m.home, home: false, gf: m.score.a, ga: m.score.h, ht: { h: m.ht.a, a: m.ht.h } };

        h.last.push(hMatch);
        h.homeLast.push(hMatch);

        a.last.push(aMatch);
        a.awayLast.push(aMatch);
    }
    // Tüm takımların son maçlarını KESİNLİKLE en yeniden en eskiye sırala (index 0 = en yeni maç)
    for (const t of teams.values()) {
        t.last = getSortedMatchesDesc(t.last);
        t.homeLast = getSortedMatchesDesc(t.homeLast);
        t.awayLast = getSortedMatchesDesc(t.awayLast);
    }

    // Temel oranlar (lift hesabı için): geçmiş maçlarda her pazarın gerçekleşme sıklığı
    const base = {}; let nb = 0;
    for (const { m } of rows) {
        nb++;
        for (const k of outcomeKeys(m.score.h, m.score.a, m.ht.h, m.ht.a)) base[k] = (base[k] || 0) + 1;
    }
    if (nb > 0) {
        for (const k of Object.keys(base)) base[k] /= nb;
    }

    return {
        asOf,
        teams,
        glob,
        lgStat,
        base,
        nRows: rows.length,
        recentRows: rows.slice(-450),
        rawHistory: opts.skipRawHistory ? null : rows.map(r => r.m)
    };
}

// ---------------- Gerçekleşen sonuçtan pazar anahtarları ----------------
function outcomeKeys(gh, ga, h1, a1) {
    const k = [], tot = gh + ga, t1 = h1 + a1, t2 = tot - t1;
    const gh2 = gh - h1, ga2 = ga - a1;
    const ft = ['1', 'X', '2'][outcome3(gh - ga)], ht = ['1', 'X', '2'][outcome3(h1 - a1)];
    k.push('ms' + ft.toLowerCase());
    if (ft !== '2') k.push('dc1x'); if (ft !== '1') k.push('dcx2'); if (ft !== 'X') k.push('dc12');
    k.push(tot > 1.5 ? 'ust15' : 'alt15', tot > 2.5 ? 'ust25' : 'alt25', tot > 3.5 ? 'ust35' : 'alt35');
    k.push(gh > 0 && ga > 0 ? 'kgv' : 'kgy');
    k.push('iy' + ht.toLowerCase());
    k.push(t1 > 0.5 ? 'iyust05' : 'iyalt05', t1 > 1.5 ? 'iyust15' : 'iyalt15');
    if (h1 > 0 && a1 > 0) k.push('iykgv');
    if (gh2 > 0 && ga2 > 0) k.push('y2kgv');
    if (t1 > 0 && t2 > 0) k.push('ikiyari_gol');
    if (t2 > 0.5) k.push('y2ust05'); if (t2 > 1.5) k.push('y2ust15');
    k.push(t1 > t2 ? 'yari1' : t1 < t2 ? 'yari2' : 'yarix');
    k.push('htft_' + ht + '/' + ft);

    // Takım Gol Alt/Üst
    if (gh >= 1) k.push('ev_ust05');
    if (gh >= 2) k.push('ev_ust15');
    if (gh >= 3) k.push('ev_ust25');
    if (ga >= 1) k.push('dep_ust05');
    if (ga >= 2) k.push('dep_ust15');
    if (ga >= 3) k.push('dep_ust25');

    // Gol Aralığı
    if (tot <= 1) k.push('tg01');
    if (tot >= 2 && tot <= 3) k.push('tg23');
    if (tot >= 4 && tot <= 6) k.push('tg46');
    if (tot >= 7) k.push('tg7p');

    // Nesine yüksek oranlı kombinasyon ve özel sürpriz pazarları
    if (gh > ga && tot >= 3) k.push('ms1_ust25');
    if (ga > gh && tot >= 3) k.push('ms2_ust25');
    if (gh > ga && gh > 0 && ga > 0) k.push('ms1_kgv');
    if (ga > gh && gh > 0 && ga > 0) k.push('ms2_kgv');
    if (gh === ga && gh > 0) k.push('msx_kgv');
    if (tot >= 3 && gh > 0 && ga > 0) k.push('ust25_kgv');
    if (gh - ga >= 2) { k.push('hms1'); k.push('ah_h_15'); }
    if (ga - gh >= 2) { k.push('hms2'); k.push('ah_a_15'); }

    // İlk yarı ve maç sonucu kesin skor pazarları
    if (h1 <= 2 && a1 <= 2) k.push(`iyskor_${h1}_${a1}`);
    if (gh <= 3 && ga <= 3) k.push(`msskor_${gh}_${ga}`);

    return k;
}

// ---------------- Etiketler ve gruplar (Tam Kapsamlı Nesine Pazar Altyapısı) ----------------
const LABEL = {
    ms1: 'MS 1', msx: 'MS X', ms2: 'MS 2', dc1x: 'Çifte Şans 1-X', dcx2: 'Çifte Şans X-2', dc12: 'Çifte Şans 1-2',
    ust15: '1,5 Üst', alt15: '1,5 Alt', ust25: '2,5 Üst', alt25: '2,5 Alt', ust35: '3,5 Üst', alt35: '3,5 Alt',
    ev_ust05: 'Ev 0,5 Üst', ev_ust15: 'Ev 1,5 Üst', ev_ust25: 'Ev 2,5 Üst',
    dep_ust05: 'Dep 0,5 Üst', dep_ust15: 'Dep 1,5 Üst', dep_ust25: 'Dep 2,5 Üst',
    kgv: 'KG Var', kgy: 'KG Yok',
    iy1: 'İY 1', iyx: 'İY X', iy2: 'İY 2', iyust05: 'İY 0,5 Üst', iyalt05: 'İY 0,5 Alt', iyust15: 'İlk Yarı 1,5 Üst', iyalt15: 'İY 1,5 Alt',
    iykgv: 'İlk Yarı KG Var', y2kgv: '2. Yarı KG Var', ikiyari_gol: 'Her İki Yarıda Gol',
    y2ust05: '2. Yarı 0,5 Üst', y2ust15: '2. Yarı 1,5 Üst',
    yari1: 'Daha Çok Gol: 1. Yarı', yari2: 'Daha Çok Gol: 2. Yarı', yarix: 'Daha Çok Gol: Eşit',
    ms1_ust25: 'MS 1 & 2,5 Üst', ms2_ust25: 'MS 2 & 2,5 Üst',
    ms1_kgv: 'MS 1 & KG Var', ms2_kgv: 'MS 2 & KG Var', msx_kgv: 'MS X & KG Var',
    ust25_kgv: '2,5 Üst & KG Var',
    hms1: 'Handikaplı MS 1 (-1)', hms2: 'Handikaplı MS 2 (-1)',
    ah_h_15: 'Asya Handikap Ev (-1.5)', ah_a_15: 'Asya Handikap Dep (-1.5)',
    tg01: 'Toplam 0-1 Gol', tg23: 'Toplam 2-3 Gol', tg46: 'Toplam 4-6 Gol', tg7p: 'Toplam 7+ Gol',
    korner_ust85: 'Korner 8,5 Üst', korner_ust95: 'Korner 9,5 Üst', korner_ust105: 'Korner 10,5 Üst', iy_korner_ust45: 'İY Korner 4,5 Üst',
    kart_ust35: 'Kart 3,5 Üst', kart_ust45: 'Kart 4,5 Üst',
    iyskor_0_0: 'İY Skor 0-0', iyskor_1_0: 'İY Skor 1-0', iyskor_0_1: 'İY Skor 0-1', iyskor_1_1: 'İY Skor 1-1', iyskor_2_0: 'İY Skor 2-0', iyskor_0_2: 'İY Skor 0-2',
    msskor_1_0: 'MS Skor 1-0', msskor_2_0: 'MS Skor 2-0', msskor_2_1: 'MS Skor 2-1', msskor_1_1: 'MS Skor 1-1', msskor_0_1: 'MS Skor 0-1', msskor_0_2: 'MS Skor 0-2', msskor_1_2: 'MS Skor 1-2', msskor_2_2: 'MS Skor 2-2', msskor_3_1: 'MS Skor 3-1', msskor_1_3: 'MS Skor 1-3'
};
const GROUP = {
    ms1: 'ms', msx: 'msx', ms2: 'ms', dc1x: 'dc', dcx2: 'dc', dc12: 'dc',
    ust15: 'ou', alt15: 'ou', ust25: 'ou', alt25: 'ou', ust35: 'ou', alt35: 'ou',
    ev_ust05: 'team_ou', ev_ust15: 'team_ou', ev_ust25: 'team_ou', dep_ust05: 'team_ou', dep_ust15: 'team_ou', dep_ust25: 'team_ou',
    kgv: 'kg', kgy: 'kg',
    iy1: 'iy', iyx: 'iy', iy2: 'iy', iyust05: 'iyou', iyalt05: 'iyou', iyust15: 'iy_ust', iyalt15: 'iyou',
    iykgv: 'iy_kg', y2kgv: 'y2_kg', ikiyari_gol: 'iki_yari',
    y2ust05: 'y2', y2ust15: 'y2_ust', yari1: 'yari', yari2: 'yari', yarix: 'yari',
    ms1_ust25: 'ms_ou', ms2_ust25: 'ms_ou',
    ms1_kgv: 'ms_kg', ms2_kgv: 'ms_kg', msx_kgv: 'ms_kg',
    ust25_kgv: 'ou_kg',
    hms1: 'hms', hms2: 'hms', ah_h_15: 'hms', ah_a_15: 'hms',
    tg01: 'tg_band', tg23: 'tg_band', tg46: 'tg', tg7p: 'tg_band',
    korner_ust85: 'korner', korner_ust95: 'korner', korner_ust105: 'korner', iy_korner_ust45: 'korner',
    kart_ust35: 'kart', kart_ust45: 'kart',
    iyskor_0_0: 'iyskor', iyskor_1_0: 'iyskor', iyskor_0_1: 'iyskor', iyskor_1_1: 'iyskor', iyskor_2_0: 'iyskor', iyskor_0_2: 'iyskor',
    msskor_1_0: 'msskor', msskor_2_0: 'msskor', msskor_2_1: 'msskor', msskor_1_1: 'msskor', msskor_0_1: 'msskor', msskor_0_2: 'msskor', msskor_1_2: 'msskor', msskor_2_2: 'msskor', msskor_3_1: 'msskor', msskor_1_3: 'msskor'
};
const HTFT = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];

// ---------------- Bir maç için tüm pazar olasılıkları ----------------
function dcGrid(lh, la, N = 9, rho = -0.06) {
    const ph = pmfArr(lh, N), pa = pmfArr(la, N), G = []; let s = 0;
    for (let i = 0; i <= N; i++) {
        G.push([]);
        for (let j = 0; j <= N; j++) {
            let p = ph[i] * pa[j];
            if (i === 0 && j === 0) p *= 1 - lh * la * rho;
            else if (i === 0 && j === 1) p *= 1 + lh * rho;
            else if (i === 1 && j === 0) p *= 1 + la * rho;
            else if (i === 1 && j === 1) p *= 1 - rho;
            G[i].push(p); s += p;
        }
    }
    for (const r of G) for (let j = 0; j < r.length; j++) r[j] /= s;
    return G;
}

// Dinamik Dixon-Coles korelasyon parametresi (ρ): Düşük skorlu/kilitli maçlarda beraberlik ve 1-0/0-1 yapışkanlığını artırır
function computeDynamicRho(lh, la, homeFacts, awayFacts) {
    const tot = lh + la;
    const diff = Math.abs(lh - la);
    let rho = -0.075;
    if (tot < 2.25) rho -= 0.045;
    else if (tot > 3.15) rho += 0.035;
    if (diff < 0.25) rho -= 0.025;
    if (homeFacts && awayFacts) {
        if ((homeFacts.cleanSheetPct || 0) >= 40 && (awayFacts.cleanSheetPct || 0) >= 40) rho -= 0.025;
        if ((homeFacts.btts || 0) >= 0.68 && (awayFacts.btts || 0) >= 0.68) rho += 0.02;
    }
    return Math.max(-0.16, Math.min(-0.02, rho));
}

function computeMarkets(lh, la, sh, sa, rho = -0.08) {
    const lh1 = lh * sh, la1 = la * sa, lh2 = Math.max(0.05, lh - lh1), la2 = Math.max(0.05, la - la1);
    const L1 = lh1 + la1, L2 = lh2 + la2;
    const N = 9, G = dcGrid(lh, la, N, rho);
    const p = {};
    let w = 0, d = 0, a = 0, ov = [0, 0, 0], kg = 0;
    let ms1Ust25 = 0, ms2Ust25 = 0, ms1Kgv = 0, ms2Kgv = 0, msxKgv = 0, ust25Kgv = 0;
    let hms1 = 0, hms2 = 0, tg01 = 0, tg23 = 0, tg46 = 0, tg7p = 0;
    let evUst05 = 0, evUst15 = 0, evUst25 = 0, depUst05 = 0, depUst15 = 0, depUst25 = 0;
    const scores = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const q = G[i][j];
        const t = i + j;
        if (i > j) {
            w += q;
            if (t >= 3) ms1Ust25 += q;
            if (i > 0 && j > 0) ms1Kgv += q;
            if (i - j >= 2) hms1 += q;
        } else if (i === j) {
            d += q;
            if (i > 0) msxKgv += q;
        } else {
            a += q;
            if (t >= 3) ms2Ust25 += q;
            if (i > 0 && j > 0) ms2Kgv += q;
            if (j - i >= 2) hms2 += q;
        }
        if (i >= 1) evUst05 += q;
        if (i >= 2) evUst15 += q;
        if (i >= 3) evUst25 += q;
        if (j >= 1) depUst05 += q;
        if (j >= 2) depUst15 += q;
        if (j >= 3) depUst25 += q;

        if (t > 1) ov[0] += q; if (t > 2) ov[1] += q; if (t > 3) ov[2] += q;
        if (i > 0 && j > 0) {
            kg += q;
            if (t >= 3) ust25Kgv += q;
        }
        if (t <= 1) tg01 += q;
        else if (t <= 3) tg23 += q;
        else if (t <= 6) tg46 += q;
        else tg7p += q;
        scores.push({ s: i + '-' + j, p: q });
    }
    p.ms1 = w; p.msx = d; p.ms2 = a; p.dc1x = w + d; p.dcx2 = d + a; p.dc12 = w + a;
    p.ust15 = ov[0]; p.alt15 = 1 - ov[0]; p.ust25 = ov[1]; p.alt25 = 1 - ov[1]; p.ust35 = ov[2]; p.alt35 = 1 - ov[2];
    p.ev_ust05 = evUst05; p.ev_ust15 = evUst15; p.ev_ust25 = evUst25;
    p.dep_ust05 = depUst05; p.dep_ust15 = depUst15; p.dep_ust25 = depUst25;
    p.kgv = kg; p.kgy = 1 - kg;

    // Nesine yüksek oranlı kombinasyon, handikap ve gol aralığı pazarları
    p.ms1_ust25 = ms1Ust25; p.ms2_ust25 = ms2Ust25;
    p.ms1_kgv = ms1Kgv; p.ms2_kgv = ms2Kgv; p.msx_kgv = msxKgv;
    p.ust25_kgv = ust25Kgv;
    p.hms1 = hms1; p.hms2 = hms2;
    p.ah_h_15 = hms1; p.ah_a_15 = hms2;
    p.tg01 = tg01; p.tg23 = tg23; p.tg46 = tg46; p.tg7p = tg7p;

    // MS kesin skor pazarları
    p.msskor_1_0 = G[1][0]; p.msskor_2_0 = G[2][0]; p.msskor_2_1 = G[2][1];
    p.msskor_1_1 = G[1][1]; p.msskor_0_1 = G[0][1]; p.msskor_0_2 = G[0][2];
    p.msskor_1_2 = G[1][2]; p.msskor_2_2 = G[2][2];
    p.msskor_3_1 = G[3][1]; p.msskor_1_3 = G[1][3];

    // Devreler (1. yarı Dixon-Coles kalibrasyonlu matris + 2. yarı matrisi)
    const pt1 = pmfArr(L1, 14), pt2 = pmfArr(L2, 14);
    const N1 = 7;
    const G1 = dcGrid(lh1, la1, N1, rho * 0.65);
    const P2 = pmfArr(lh2, N1), Q2 = pmfArr(la2, N1);

    p.iyalt05 = G1[0][0]; p.iyust05 = 1 - G1[0][0];
    p.iyalt15 = G1[0][0] + G1[1][0] + G1[0][1]; p.iyust15 = 1 - p.iyalt15;

    let iyKg = 0;
    for (let i = 1; i <= N1; i++) for (let j = 1; j <= N1; j++) iyKg += G1[i][j];
    p.iykgv = iyKg;
    p.y2kgv = (1 - Math.exp(-lh2)) * (1 - Math.exp(-la2));
    p.y2ust05 = 1 - pt2[0]; p.y2ust15 = 1 - pt2[0] - pt2[1];
    p.ikiyari_gol = p.iyust05 * p.y2ust05;

    let y1 = 0, y2 = 0, yx = 0;
    for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) { const q = pt1[i] * pt2[j]; if (i > j) y1 += q; else if (i < j) y2 += q; else yx += q; }
    p.yari1 = y1; p.yari2 = y2; p.yarix = yx;

    // İY kesin skorlar (Dixon-Coles 1. yarı matrisinden)
    p.iyskor_0_0 = G1[0][0]; p.iyskor_1_0 = G1[1][0]; p.iyskor_0_1 = G1[0][1];
    p.iyskor_1_1 = G1[1][1]; p.iyskor_2_0 = G1[2][0]; p.iyskor_0_2 = G1[0][2];

    const D2 = {};
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) D2[i - j] = (D2[i - j] || 0) + P2[i] * Q2[j];
    const htft = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], htScores = [];
    const iyo = [0, 0, 0];
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) {
        const q = G1[i][j], ho = outcome3(i - j);
        iyo[ho] += q; htScores.push({ s: i + '-' + j, p: q });
        for (const dk of Object.keys(D2)) htft[ho][outcome3(i - j + +dk)] += q * D2[dk];
    }
    const ftTarget = [w, d, a];
    for (let fo = 0; fo < 3; fo++) {
        const colSum = htft[0][fo] + htft[1][fo] + htft[2][fo];
        if (colSum > 0) for (let ho = 0; ho < 3; ho++) htft[ho][fo] *= ftTarget[fo] / colSum;
    }
    const nm = ['1', 'X', '2'];
    for (let ho = 0; ho < 3; ho++) for (let fo = 0; fo < 3; fo++) p['htft_' + nm[ho] + '/' + nm[fo]] = htft[ho][fo];
    const si = iyo[0] + iyo[1] + iyo[2];
    p.iy1 = iyo[0] / si; p.iyx = iyo[1] / si; p.iy2 = iyo[2] / si;

    scores.sort((x, y) => y.p - x.p); htScores.sort((x, y) => y.p - x.p);
    return { p, topScores: scores.slice(0, 3), topHtScores: htScores.slice(0, 2), lh1, la1, lh2, la2, rho: +rho.toFixed(3) };
}

// ---------------- Derin Takım Özeti (Son 10 Maç, Son 5 Maç, Ev/Dep Karnesi, 1Y/2Y Dağılımı & İstikrar) ----------------
function teamFacts(t, targetMatchOrCutoff = null) {
    if (!t) return null;
    let pool = Array.isArray(t.last) ? t.last : [];
    if (targetMatchOrCutoff !== null) {
        pool = pool.filter(g => isMatchStrictlyPrior(g, targetMatchOrCutoff));
    }
    const sorted = getSortedMatchesDesc(pool);
    const last = sorted.slice(0, 10);
    const last5 = sorted.slice(0, 5);

    let homePool = (t.homeLast && Array.isArray(t.homeLast) && t.homeLast.length > 0)
        ? t.homeLast
        : sorted.filter(x => x.home || x.isHome);
    if (targetMatchOrCutoff !== null) {
        homePool = homePool.filter(g => isMatchStrictlyPrior(g, targetMatchOrCutoff));
    }
    const homeMatches = getSortedMatchesDesc(homePool);
    const homeGames = homeMatches.slice(0, 6);

    let awayPool = (t.awayLast && Array.isArray(t.awayLast) && t.awayLast.length > 0)
        ? t.awayLast
        : sorted.filter(x => !x.home && !x.isHome);
    if (targetMatchOrCutoff !== null) {
        awayPool = awayPool.filter(g => isMatchStrictlyPrior(g, targetMatchOrCutoff));
    }
    const awayMatches = getSortedMatchesDesc(awayPool);
    const awayGames = awayMatches.slice(0, 6);

    const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
    const r1 = (v) => (v === null ? null : Math.round(v * 100) / 100);
    const formStr = (arr, n = 5) => arr.slice(0, n).map(x => (x.gf > x.ga ? 'G' : x.gf === x.ga ? 'B' : 'M')).join('');

    // Senaryo analizi: İlk yarı öndeyken koruma & gerideyken çevirme
    const htLeads = last.filter(x => x.ht && x.ht.h > x.ht.a);
    const leadHoldPct = htLeads.length ? Math.round((htLeads.filter(x => x.gf > x.ga).length / htLeads.length) * 100) : null;
    const htTrails = last.filter(x => x.ht && x.ht.h < x.ht.a);
    const comebackPct = htTrails.length ? Math.round((htTrails.filter(x => x.gf >= x.ga).length / htTrails.length) * 100) : null;
    const cleanSheetPct = last.length ? Math.round((last.filter(x => x.ga === 0).length / last.length) * 100) : 0;

    // 1. Yarı ve 2. Yarı gol üretimi, yeme ortalamaları ve yüzde dağılımı
    const gf1Val = r1(avg(last, x => (x.ht ? x.ht.h : 0))) || 0;
    const ga1Val = r1(avg(last, x => (x.ht ? x.ht.a : 0))) || 0;
    const gf2 = r1(avg(last, x => Math.max(0, x.gf - (x.ht ? x.ht.h : 0)))) || 0;
    const ga2 = r1(avg(last, x => Math.max(0, x.ga - (x.ht ? x.ht.a : 0)))) || 0;
    const totGf = Math.max(0.1, gf1Val + gf2);
    const htGoalSharePct = Math.round((gf1Val / totGf) * 100);
    const h2GoalSharePct = 100 - htGoalSharePct;

    // Son 10 maç puan ortalaması
    const last10Pts = r1(avg(last, x => (x.gf > x.ga ? 3 : x.gf === x.ga ? 1 : 0)));

    // İstikrar / Varyans Endeksi
    let consistencyPct = 70;
    let volatilityPct = 30;
    if (last.length >= 4) {
        const meanGd = avg(last, x => x.gf - x.ga) || 0;
        const meanTot = avg(last, x => x.gf + x.ga) || 2.5;
        const varGd = avg(last, x => Math.pow((x.gf - x.ga) - meanGd, 2)) || 1.5;
        const varTot = avg(last, x => Math.pow((x.gf + x.ga) - meanTot, 2)) || 2.0;
        const stdCombined = Math.sqrt(0.6 * varGd + 0.4 * varTot);
        consistencyPct = Math.round(Math.max(35, Math.min(94, 98 - stdCombined * 18)));
        volatilityPct = 100 - consistencyPct;
    }

    return {
        n: t.n,
        hn: t.hn,
        an: t.an,
        form: formStr(sorted, 5),
        formStr: formStr(sorted, 5),
        form10Str: formStr(sorted, 10),
        last10Pts,
        homeForm: formStr(homeMatches, 5),
        awayForm: formStr(awayMatches, 5),
        gf: r1(avg(last, x => x.gf)),
        ga: r1(avg(last, x => x.ga)),
        last5Gf: r1(avg(last5, x => x.gf)),
        last5Ga: r1(avg(last5, x => x.ga)),
        homeGf: r1(avg(homeGames, x => x.gf)),
        homeGa: r1(avg(homeGames, x => x.ga)),
        awayGf: r1(avg(awayGames, x => x.gf)),
        awayGa: r1(avg(awayGames, x => x.ga)),
        gf1: gf1Val,
        ga1: ga1Val,
        gf2,
        ga2,
        htGoalSharePct,
        h2GoalSharePct,
        over25: r1(avg(last, x => (x.gf + x.ga > 2.5 ? 1 : 0))),
        btts: r1(avg(last, x => (x.gf > 0 && x.ga > 0 ? 1 : 0))),
        iyGol: r1(avg(last, x => (((x.ht?.h || 0) + (x.ht?.a || 0)) > 0 ? 1 : 0))),
        cleanSheetPct,
        leadHoldPct,
        comebackPct,
        consistencyPct,
        volatilityPct,
        son: sorted.slice(0, 5).map(x => `${x.home ? 'E' : 'D'} ${x.opp} ${x.gf}-${x.ga}`),
        son10Count: last.length,
        homeSon: homeGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`),
        awaySon: awayGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`)
    };
}

// ---------------- Fikstür Yorgunluğu & Dinlenme Günü Analizi ----------------
function computeRestAndFatigue(t, targetMatchOrCutoff) {
    if (!t || !t.last || !t.last.length || !targetMatchOrCutoff) {
        return { restDays: null, restHours: null, gamesLast10d: 0, isFatigued: false, isFresh: false, attMod: 1.0, dfnMod: 1.0, shMod: 0, label: 'Normal Fikstür' };
    }

    // Hedef maçtan kesinlikle ÖNCE oynanmış maçları al (aynı gün önceki maçlar dahil, gelecek veya maçın kendisi hariç)
    const validMatches = getSortedMatchesDesc(t.last.filter(g => isMatchStrictlyPrior(g, targetMatchOrCutoff)));

    if (!validMatches.length) {
        return { restDays: null, restHours: null, gamesLast10d: 0, isFatigued: false, isFresh: false, attMod: 1.0, dfnMod: 1.0, shMod: 0, label: 'Normal Fikstür' };
    }

    const targetKickoffMs = getMatchTimestamp(targetMatchOrCutoff);
    const lastMatch = validMatches[0];
    const lastKickoffMs = getMatchTimestamp(lastMatch);

    let restHours = null;
    let restDays = null;

    if (targetKickoffMs && lastKickoffMs && targetKickoffMs > lastKickoffMs) {
        const diffMs = targetKickoffMs - lastKickoffMs;
        restHours = +(diffMs / 3600000).toFixed(1);
        restDays = Math.max(0, Math.round(diffMs / 86400000));
    } else {
        const dTargetStr = (typeof targetMatchOrCutoff === 'object' ? targetMatchOrCutoff.date : targetMatchOrCutoff) || '1970-01-01';
        const dTarget = new Date(dTargetStr.slice(0, 10) + 'T12:00:00Z').getTime();
        const dLast = new Date(lastMatch.date + 'T12:00:00Z').getTime();
        restDays = Math.max(1, Math.round((dTarget - dLast) / 86400000));
        restHours = restDays * 24;
    }

    let gamesLast10d = 0;
    if (targetKickoffMs) {
        for (const g of validMatches) {
            const gMs = getMatchTimestamp(g);
            if (gMs) {
                const diffMs = targetKickoffMs - gMs;
                const d = diffMs / 86400000;
                if (d > 0 && d <= 10) gamesLast10d++;
            }
        }
    } else {
        const dTargetStr = (typeof targetMatchOrCutoff === 'object' ? targetMatchOrCutoff.date : targetMatchOrCutoff) || '1970-01-01';
        const dTarget = new Date(dTargetStr.slice(0, 10) + 'T12:00:00Z').getTime();
        for (const g of validMatches) {
            const d = Math.round((dTarget - new Date(g.date + 'T12:00:00Z').getTime()) / 86400000);
            if (d > 0 && d <= 10) gamesLast10d++;
        }
    }

    let attMod = 1.0, dfnMod = 1.0, shMod = 0;
    let isFatigued = false, isFresh = false;
    let label = restHours !== null && restHours < 48
        ? `${restHours} saat dinlenme`
        : `${restDays} gün dinlenme`;

    if ((restDays !== null && restDays <= 3) || (restHours !== null && restHours < 76) || gamesLast10d >= 3) {
        isFatigued = true;
        attMod = (restHours !== null && restHours < 48) || restDays <= 2 ? 0.94 : 0.965;
        dfnMod = (restHours !== null && restHours < 48) || restDays <= 2 ? 1.07 : 1.045; // Yorgun savunma özellikle 2. yarıda daha çok pozisyon verir
        shMod = -0.025; // Gollerin 2. yarıya kayması
        label = gamesLast10d >= 3
            ? `⚠️ Sıkışık Fikstür (10 günde ${gamesLast10d} maç, son maç ${label} önce)`
            : (restHours !== null && restHours < 48)
                ? `⚠️ Aşırı Yorgunluk Riski (Son maç yalnızca ${restHours} saat önce)`
                : `⚠️ Yorgunluk Riski (Son maç ${restDays} gün önce)`;
    } else if (restDays >= 6 && restDays <= 9 && gamesLast10d <= 1) {
        isFresh = true;
        attMod = 1.02;
        dfnMod = 0.985;
        label = `🔋 Dinç Kadro (${label})`;
    }

    return { restDays, restHours, gamesLast10d, isFatigued, isFresh, attMod, dfnMod, shMod, label };
}

// ---------------- Takım Taktik Kimliği (Tactical DNA) & Eşleşme Çarpışması ----------------
function computeTacticalDNA(t, facts, isHomeTeam) {
    if (!t || !facts) return { tags: ['Dengeli'], codes: new Set() };
    const tags = [];
    const codes = new Set();

    const splitGf = isHomeTeam ? (facts.homeGf ?? facts.gf) : (facts.awayGf ?? facts.gf);
    const splitGa = isHomeTeam ? (facts.homeGa ?? facts.ga) : (facts.awayGa ?? facts.ga);

    if ((facts.gf1 || 0) >= 0.80 || ((facts.iyGol || 0) >= 0.78 && (facts.gf1 || 0) >= 0.65)) {
        tags.push('⚡ Erken Baskıcı');
        codes.add('early_press');
    }
    if ((facts.btts || 0) >= 0.65 && (facts.gf || 0) >= 1.30 && (facts.ga || 0) >= 1.25) {
        tags.push('🔥 Açık Savunma (Atıp Yiyen)');
        codes.add('glass_cannon');
    }
    if ((facts.ga || 0) <= 0.92 || (facts.cleanSheetPct || 0) >= 44) {
        tags.push('🧱 Kilitli Savunma');
        codes.add('low_block');
    }
    if ((facts.gf2 || 0) >= 1.05 && (facts.gf2 || 0) > (facts.gf1 || 0) * 1.45) {
        tags.push('🚀 2. Yarı Açılan');
        codes.add('second_half_surge');
    }
    if (isHomeTeam && (splitGf || 0) >= 1.95) {
        tags.push('👑 İç Saha Dominant');
        codes.add('home_fortress');
    } else if (!isHomeTeam && (splitGf || 0) >= 1.55) {
        tags.push('🗡️ Deplasman Tehlikesi');
        codes.add('away_threat');
    }
    if ((facts.leadHoldPct || 0) >= 82) {
        tags.push('🛡️ Skoru Koruyan');
        codes.add('lead_holder');
    } else if ((facts.comebackPct || 0) >= 45) {
        tags.push('🔄 Geri Dönüşçü');
        codes.add('comeback_king');
    }
    if ((facts.ga1 || 0) >= 0.75) {
        codes.add('early_conceder');
    }
    if ((facts.ga2 || 0) >= 1.0) {
        codes.add('late_conceder');
    }

    if (!tags.length) tags.push('⚖️ Dengeli Oyun');
    return { tags: tags.slice(0, 3), codes, splitGf, splitGa };
}

function analyzeTacticalClash(m, dnaH, dnaA, restH, restA) {
    const boosts = {};
    const notes = [];

    // 1. İki açık savunmalı / atıp yiyen takım çarpışması
    if (dnaH.codes.has('glass_cannon') && dnaA.codes.has('glass_cannon')) {
        boosts.ust25_kgv = 1.18;
        boosts.ms1_kgv = 1.15;
        boosts.ms2_kgv = 1.15;
        boosts.tg46 = 1.16;
        boosts.iykgv = 1.14;
        notes.push('İki takım da "Açık Savunma (Atıp Yiyen)" kimliğinde -> KG Var & Üst / Gollü Kombinasyonlara ekstra uygun');
    }

    // 2. Erken baskıcı takım vs İlk yarıda gol yiyen takım
    if (dnaH.codes.has('early_press') && (dnaA.codes.has('early_conceder') || dnaA.codes.has('glass_cannon'))) {
        boosts.iyust15 = 1.15;
        boosts.htft_1_1 = 1.14;
        boosts.iyskor_1_0 = 1.14;
        notes.push(`${m.home} maça hızlı başlıyor, ${m.away} ilk devrede açık veriyor -> İlk yarı gol / İY 1 fırsatı`);
    } else if (dnaA.codes.has('early_press') && (dnaH.codes.has('early_conceder') || dnaH.codes.has('glass_cannon'))) {
        boosts.iyust15 = 1.15;
        boosts.htft_2_2 = 1.14;
        boosts.iyskor_0_1 = 1.14;
        notes.push(`${m.away} deplasmanda erken baskı kuruyor -> İlk yarı sürpriz gol fırsatı`);
    }

    // 3. Her iki takım da erken baskıcıysa -> İlk Yarı KG Var & İY 1,5 Üst
    if (dnaH.codes.has('early_press') && dnaA.codes.has('early_press')) {
        boosts.iykgv = 1.20;
        boosts.iyust15 = 1.18;
        boosts.iyskor_1_1 = 1.18;
        notes.push('İki takım da "Erken Baskıcı" -> İlk Yarı KG Var ve İY 1,5 Üst potansiyeli çok yüksek');
    }

    // 4. 2. Yarı açılan takımlar veya yorgun rakip -> 2. Yarı KG Var / İY X
    if (dnaH.codes.has('second_half_surge') || dnaA.codes.has('second_half_surge') || restH.isFatigued || restA.isFatigued) {
        boosts.y2kgv = 1.16;
        boosts.htft_X_1 = 1.12;
        boosts.htft_X_2 = 1.12;
        if (restH.isFatigued && !restA.isFatigued) {
            notes.push(`${m.home} sıkışık fikstürden geliyor (${restH.restDays}g dinlenme), 2. yarıda oyundan düşebilir`);
        } else if (restA.isFatigued && !restH.isFatigued) {
            notes.push(`${m.away} yorgun fikstürde (${restA.restDays}g dinlenme), ${m.home} 2. yarıda kilidi açmaya aday`);
        } else {
            notes.push('Takımların gol üretimi 2. yarıda patlama yapıyor -> 2. Yarı gol / KG seçenekleri değerli');
        }
    }

    // 5. İki kilitli savunma
    if (dnaH.codes.has('low_block') && dnaA.codes.has('low_block')) {
        boosts.alt25 = 1.12;
        boosts.kgy = 1.12;
        notes.push('İki "Kilitli Savunma" karşı karşıya -> Düşük tempo ve kontrollü oyun');
    }

    return {
        homeTags: dnaH.tags,
        awayTags: dnaA.tags,
        boosts,
        clashSummary: notes.length ? notes.join(' | ') : `${m.home} [${dnaH.tags.join(', ')}] vs ${m.away} [${dnaA.tags.join(', ')}]`
    };
}

// ---------------- Kadro, Gol Dağılımı, Muhtemel/Resmi İlk 11 & Sakat/Cezalı Oyuncu Etkisi ----------------
function computeRosterImpact(m, intel, homeFacts, awayFacts) {
    let modH = 1.0, modA = 1.0;
    const notes = [];
    let lineupSummary = null;
    if (!intel) return { modH, modA, summary: null, lineupSummary: null, squad: null };

    const hInj = intel.squad?.homeMissing || intel.homeInjuries || [];
    const aInj = intel.squad?.awayMissing || intel.awayInjuries || [];

    if (hInj.length >= 1) {
        modH *= Math.max(0.90, 1 - hInj.length * 0.022);
        notes.push(`${m.home} eksik/cezalı: ${hInj.slice(0, 3).join(', ')}`);
    }
    if (aInj.length >= 1) {
        modA *= Math.max(0.90, 1 - aInj.length * 0.022);
        notes.push(`${m.away} eksik/cezalı: ${aInj.slice(0, 3).join(', ')}`);
    }

    const homeXI = intel.squad?.homeXI || intel.lineup?.homeXi || [];
    const awayXI = intel.squad?.awayXI || intel.lineup?.awayXi || [];
    const isOfficial = Boolean(intel.squad?.isOfficial || intel.lineup?.hasLineup);

    // Gol kralı bağımlılığı ve kadro kontrolü
    if (intel.homeTopScorer && intel.homeTopGoals >= 3) {
        const scorerLast = intel.homeTopScorer.toLowerCase().split(' ').pop();
        const isInjured = hInj.some(x => x.toLowerCase().includes(scorerLast));
        const isOutXi = homeXI.length >= 11 && !homeXI.some(p => p.toLowerCase().includes(scorerLast));
        if (isInjured || (isOfficial && isOutXi)) {
            modH *= 0.91;
            notes.push(`⚠️ ${m.home} golcüsü ${intel.homeTopScorer} (${intel.homeTopGoals} gol) kadroda/ilk 11'de yok!`);
        }
    }
    if (intel.awayTopScorer && intel.awayTopGoals >= 3) {
        const scorerLast = intel.awayTopScorer.toLowerCase().split(' ').pop();
        const isInjured = aInj.some(x => x.toLowerCase().includes(scorerLast));
        const isOutXi = awayXI.length >= 11 && !awayXI.some(p => p.toLowerCase().includes(scorerLast));
        if (isInjured || (isOfficial && isOutXi)) {
            modA *= 0.91;
            notes.push(`⚠️ ${m.away} golcüsü ${intel.awayTopScorer} (${intel.awayTopGoals} gol) kadroda/ilk 11'de yok!`);
        }
    }

    if (homeXI.length > 0 || awayXI.length > 0) {
        const lType = isOfficial ? 'Resmi İlk 11' : 'Muhtemel İlk 11';
        const hXiStr = homeXI.length ? `${m.home}: ${homeXI.slice(0, 11).join(', ')}` : '';
        const aXiStr = awayXI.length ? `${m.away}: ${awayXI.slice(0, 11).join(', ')}` : '';
        lineupSummary = `${lType} -> ${[hXiStr, aXiStr].filter(Boolean).join(' | ')}`;
    }

    return {
        modH,
        modA,
        summary: notes.length ? notes.join(' | ') : 'Önemli bir sakat/cezalı eksiği tespit edilmedi',
        lineupSummary,
        squad: {
            lineupType: isOfficial ? 'Resmi İlk 11' : (homeXI.length || awayXI.length) ? 'Muhtemel İlk 11' : 'Henüz Açıklanmadı',
            isOfficial,
            homeXI,
            awayXI,
            homeFormation: intel.squad?.homeFormation || null,
            awayFormation: intel.squad?.awayFormation || null,
            homeMissing: hInj,
            awayMissing: aInj
        }
    };
}

// ---------------- Canlı Maç (In-Play) Kalan Süre & Baskı Motoru ----------------
function analyzeLiveState(m, preLh, preLa) {
    if (!m || m.state !== 'live' || !m.score) return null;
    const gh = m.score.h || 0, ga = m.score.a || 0;
    const rawLabel = String(m.label || '').trim();
    let minute = 45;
    if (/^\d+/.test(rawLabel)) {
        minute = Math.min(89, Math.max(1, parseInt(rawLabel, 10)));
    } else if (rawLabel.toUpperCase().includes('İY') || rawLabel.toUpperCase().includes('HT')) {
        minute = 45;
    }

    const remFraction = Math.max(0.06, (90 - minute) / 90);
    // Skor durumuna göre kalan süredeki aciliyet (geride olan favori baskıyı artırır)
    let urgH = 1.0, urgA = 1.0;
    if (gh < ga && preLh > preLa) urgH = 1.24;
    else if (ga < gh && preLa > preLh) urgA = 1.24;
    else if (gh === ga && minute >= 60) {
        if (preLh > preLa * 1.3) urgH = 1.15;
        if (preLa > preLh * 1.3) urgA = 1.15;
    }

    const remLh = Math.max(0.04, preLh * Math.pow(remFraction, 0.92) * urgH);
    const remLa = Math.max(0.04, preLa * Math.pow(remFraction, 0.92) * urgA);
    const remTot = remLh + remLa;

    const remOver05 = 1 - Math.exp(-remTot);
    const remOver15 = 1 - Math.exp(-remTot) * (1 + remTot);
    const nextGoalHome = remOver05 * (remLh / remTot);
    const nextGoalAway = remOver05 * (remLa / remTot);

    // Kalan süre skor dağılımından maç sonu canlı olasılıkları
    const ph = pmfArr(remLh, 6), pa = pmfArr(remLa, 6);
    let lw = 0, ld = 0, la = 0, lkg = 0;
    for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 6; j++) {
            const q = ph[i] * pa[j];
            const fh = gh + i, fa = ga + j;
            if (fh > fa) lw += q;
            else if (fh === fa) ld += q;
            else la += q;
            if (fh > 0 && fa > 0) lkg += q;
        }
    }

    let bestLivePick = `Kalan Sürede +0,5 Gol (${Math.round(remOver05 * 100)}%)`;
    if (remOver05 >= 0.72) {
        bestLivePick = `🔥 Canlı Sıradaki Gol Var / +0,5 Üst (%${Math.round(remOver05 * 100)})`;
    } else if (gh < ga && lw + ld >= 0.52) {
        bestLivePick = `⚡ ${m.home} Çifte Şans 1X / Geri Dönüş (%${Math.round((lw + ld) * 100)})`;
    } else if (lw >= 0.68 && gh === ga) {
        bestLivePick = `🎯 Canlı MS 1 (${m.home} Kazanır %${Math.round(lw * 100)})`;
    } else if (la >= 0.68 && gh === ga) {
        bestLivePick = `🎯 Canlı MS 2 (${m.away} Kazanır %${Math.round(la * 100)})`;
    }

    return {
        minute,
        currentScore: `${gh}-${ga}`,
        remLh: +remLh.toFixed(2),
        remLa: +remLa.toFixed(2),
        remOver05: Math.round(remOver05 * 100),
        remOver15: Math.round(remOver15 * 100),
        nextGoalHome: Math.round(nextGoalHome * 100),
        nextGoalAway: Math.round(nextGoalAway * 100),
        liveMs1: Math.round(lw * 100),
        liveMsX: Math.round(ld * 100),
        liveMs2: Math.round(la * 100),
        liveKgv: Math.round(lkg * 100),
        bestLivePick
    };
}

// ---------------- H2H (Aralarındaki Maçlar) & Ortak Rakipler Analizi ----------------
function analyzeH2HAndCommon(th, ta, m, intel) {
    // 1. H2H (Hem 75 günlük veritabanı hem de dış istihbarat geçmiş sezonlar)
    const h2hList = [];
    const seenDates = new Set();
    const matchKickoffMs = m ? getMatchTimestamp(m) : null;
    const matchDateStr = m ? m.date : null;

    if (th && ta && Array.isArray(th.last)) {
        for (const g of th.last) {
            // Gelecek maç veya maçın kendisi sızamaz!
            if (m && !isMatchStrictlyPrior(g, m)) continue;

            if (g.oppId === ta.id) {
                seenDates.add(g.date);
                h2hList.push({
                    date: g.date,
                    time: g.time,
                    kickoff: g.kickoff,
                    homeTeam: g.home ? th.name : ta.name,
                    awayTeam: g.home ? ta.name : th.name,
                    homeGoals: g.home ? g.gf : g.ga,
                    awayGoals: g.home ? g.ga : g.gf,
                    thGoals: g.gf,
                    taGoals: g.ga
                });
            }
        }
    }

    if (intel && Array.isArray(intel.espnH2H)) {
        for (const eh of intel.espnH2H) {
            if (m && !isMatchStrictlyPrior(eh, m)) continue;
            if (seenDates.has(eh.date)) continue;
            seenDates.add(eh.date);
            const isThHome = eh.home && m.home && eh.home.toLowerCase().slice(0, 4) === m.home.toLowerCase().slice(0, 4);
            h2hList.push({
                date: eh.date,
                time: eh.time,
                kickoff: eh.kickoff,
                homeTeam: eh.home,
                awayTeam: eh.away,
                homeGoals: eh.gh,
                awayGoals: eh.ga,
                thGoals: isThHome ? eh.gh : eh.ga,
                taGoals: isThHome ? eh.ga : eh.gh
            });
        }
    }

    // H2H maçlarını KESİNLİKLE en yeniden en eskiye sırala!
    h2hList.sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a));

    let h2hModH = 1.0, h2hModA = 1.0, h2hSummary = null;
    if (h2hList.length > 0) {
        let hw = 0, d = 0, aw = 0, totG = 0;
        let weightedDiff = 0, totalH2hW = 0;
        for (let i = 0; i < h2hList.length; i++) {
            const item = h2hList[i];
            if (item.thGoals > item.taGoals) hw++;
            else if (item.thGoals === item.taGoals) d++;
            else aw++;
            totG += item.thGoals + item.taGoals;

            // En son H2H maçlarına daha yüksek ağırlık ver (kronolojik ağırlıklandırma)
            const w = Math.max(1, h2hList.length - i);
            const outcomeVal = item.thGoals > item.taGoals ? 1 : item.thGoals < item.taGoals ? -1 : 0;
            weightedDiff += w * outcomeVal;
            totalH2hW += w;
        }
        const avgG = (totG / h2hList.length).toFixed(1);
        const diff = totalH2hW > 0 ? (weightedDiff / totalH2hW) : ((hw - aw) / h2hList.length);
        h2hModH = Math.min(1.07, Math.max(0.93, 1 + 0.06 * diff));
        h2hModA = Math.min(1.07, Math.max(0.93, 1 - 0.06 * diff));
        const scoresText = h2hList.slice(0, 3).map(x => `${x.thGoals}-${x.taGoals}`).join(', ');
        h2hSummary = `Aralarındaki son ${h2hList.length} maç: ${m.home} ${hw}G-${d}B-${aw}M (Ort. ${avgG} gol | Son skorlar: ${scoresText})`;
    }

    // 2. Ortak Rakipler (Common Opponents)
    let commonModH = 1.0, commonModA = 1.0, commonSummary = null;
    if (th && ta && th.last && th.last.length && ta.last && ta.last.length) {
        const validTh = getSortedMatchesDesc(th.last.filter(g => isMatchStrictlyPrior(g, m)));
        const validTa = getSortedMatchesDesc(ta.last.filter(g => isMatchStrictlyPrior(g, m)));

        const mapH = new Map();
        for (const g of validTh) {
            if (!g.oppId || g.oppId === ta.id) continue;
            const cur = mapH.get(g.oppId) || { name: g.opp, n: 0, gd: 0, pts: 0, gf: 0, ga: 0 };
            cur.n++;
            cur.gd += (g.gf - g.ga);
            cur.gf += g.gf;
            cur.ga += g.ga;
            cur.pts += g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0;
            mapH.set(g.oppId, cur);
        }

        const mapA = new Map();
        for (const g of validTa) {
            if (!g.oppId || g.oppId === th.id) continue;
            const cur = mapA.get(g.oppId) || { name: g.opp, n: 0, gd: 0, pts: 0, gf: 0, ga: 0 };
            cur.n++;
            cur.gd += (g.gf - g.ga);
            cur.gf += g.gf;
            cur.ga += g.ga;
            cur.pts += g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0;
            mapA.set(g.oppId, cur);
        }

        const commonIds = [...mapH.keys()].filter(id => mapA.has(id));
        if (commonIds.length > 0) {
            let hPts = 0, aPts = 0, hGd = 0, aGd = 0;
            const names = [];
            for (const cid of commonIds) {
                const ch = mapH.get(cid), ca = mapA.get(cid);
                hPts += ch.pts / ch.n;
                aPts += ca.pts / ca.n;
                hGd += ch.gd / ch.n;
                aGd += ca.gd / ca.n;
                if (names.length < 3) names.push(ch.name);
            }
            const avgGdDiff = (hGd - aGd) / commonIds.length;
            commonModH = Math.min(1.08, Math.max(0.92, 1 + 0.035 * avgGdDiff));
            commonModA = Math.min(1.08, Math.max(0.92, 1 - 0.035 * avgGdDiff));
            const hGdStr = (hGd >= 0 ? '+' : '') + hGd.toFixed(1);
            const aGdStr = (aGd >= 0 ? '+' : '') + aGd.toFixed(1);
            commonSummary = `${commonIds.length} Ortak Rakip (${names.join(', ')}): ${m.home} maç başı ${(hPts / commonIds.length).toFixed(1)}p (${hGdStr} av), ${m.away} ${(aPts / commonIds.length).toFixed(1)}p (${aGdStr} av)`;
        }
    }

    return { h2hModH, h2hModA, h2hSummary, commonModH, commonModA, commonSummary };
}

// Son 5 maçlık form ivmesi (Momentum çarpanı) - Kronolojik Ağırlıklı (Recency-Weighted)
function computeFormMomentum(t, targetMatchOrCutoff = null) {
    if (!t || !t.last || !Array.isArray(t.last) || t.last.length < 3) return 1.0;

    let pool = t.last;
    if (targetMatchOrCutoff !== null) {
        pool = pool.filter(g => isMatchStrictlyPrior(g, targetMatchOrCutoff));
        if (pool.length < 3) return 1.0;
    }

    // Her koşulda kronolojik olarak en yeni maçları al
    const sorted = getSortedMatchesDesc(pool);
    const recent = sorted.slice(0, 5);

    // Kronolojik sıra ağırlıklandırması: En yeni maç (index 0) en yüksek ağırlığa (5, 4, 3, 2, 1) sahiptir
    let weightedPts = 0, weightedGd = 0, totalW = 0;
    for (let i = 0; i < recent.length; i++) {
        const g = recent[i];
        const w = recent.length - i;
        const pts = g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0;
        const gd = g.gf - g.ga;
        weightedPts += w * pts;
        weightedGd += w * gd;
        totalW += w;
    }

    const ppg = totalW > 0 ? (weightedPts / totalW) : 1.4;
    const gdpg = totalW > 0 ? (weightedGd / totalW) : 0;
    const raw = 1 + 0.035 * (ppg - 1.4) + 0.02 * gdpg;
    return Math.min(1.10, Math.max(0.90, raw));
}

// ---------------- Korner, Kart, Şut/İsabetli Şut, xG/xGA ve Motivasyon Projeksiyonu ----------------
function poissonOver(lambda, line) {
    const kMax = Math.floor(line);
    const pmf = pmfArr(lambda, Math.max(16, kMax + 2));
    let cdf = 0;
    for (let k = 0; k <= kMax; k++) cdf += pmf[k] || 0;
    return Math.max(0.02, Math.min(0.98, 1 - cdf));
}

function computeAdvancedProjections(m, lh, la, homeFacts, awayFacts, intel, restH, restA) {
    const rh = intel?.realStats?.home || null;
    const ra = intel?.realStats?.away || null;

    // 1. GERÇEK ŞUT VE İSABETLİ ŞUT İSTATİSTİKLERİ (Madde 2: Son 5/10 maç gerçek takım verileriyle desteklenir)
    const modelShotsH = Math.max(6.5, Math.min(21.5, 6.2 + lh * 4.4 + ((homeFacts?.homeGf || 1.3) - 1.2) * 1.1));
    const modelShotsA = Math.max(5.0, Math.min(18.5, 5.1 + la * 4.2 + ((awayFacts?.awayGf || 1.1) - 1.0) * 1.0));
    const modelSotH = Math.max(2.2, Math.min(9.8, modelShotsH * 0.36 + lh * 0.55));
    const modelSotA = Math.max(1.8, Math.min(8.6, modelShotsA * 0.34 + la * 0.50));

    const hasRealShotsH = Boolean(rh?.hasRealShots && rh.shotsForAvg !== null);
    const hasRealShotsA = Boolean(ra?.hasRealShots && ra.shotsForAvg !== null);
    const hasRealShots = hasRealShotsH || hasRealShotsA;

    let rawShotsH = modelShotsH;
    if (hasRealShotsH && ra?.shotsAgainstAvg !== null && ra?.shotsAgainstAvg !== undefined) {
        rawShotsH = 0.58 * rh.shotsForAvg + 0.42 * ra.shotsAgainstAvg;
    } else if (hasRealShotsH) {
        rawShotsH = 0.78 * rh.shotsForAvg + 0.22 * modelShotsH;
    }

    let rawShotsA = modelShotsA;
    if (hasRealShotsA && rh?.shotsAgainstAvg !== null && rh?.shotsAgainstAvg !== undefined) {
        rawShotsA = 0.58 * ra.shotsForAvg + 0.42 * rh.shotsAgainstAvg;
    } else if (hasRealShotsA) {
        rawShotsA = 0.78 * ra.shotsForAvg + 0.22 * modelShotsA;
    }

    let rawSotH = modelSotH;
    if (hasRealShotsH && rh.sotForAvg !== null) {
        const oppSotAg = (ra?.sotAgainstAvg !== null && ra?.sotAgainstAvg !== undefined) ? ra.sotAgainstAvg : rh.sotForAvg;
        rawSotH = 0.60 * rh.sotForAvg + 0.40 * oppSotAg;
    }

    let rawSotA = modelSotA;
    if (hasRealShotsA && ra.sotForAvg !== null) {
        const oppSotAg = (rh?.sotAgainstAvg !== null && rh?.sotAgainstAvg !== undefined) ? rh.sotAgainstAvg : ra.sotForAvg;
        rawSotA = 0.60 * ra.sotForAvg + 0.40 * oppSotAg;
    }

    const shotsH = +Math.max(4.0, Math.min(24.0, rawShotsH)).toFixed(1);
    const shotsA = +Math.max(3.5, Math.min(22.0, rawShotsA)).toFixed(1);
    const sotH = +Math.max(1.2, Math.min(shotsH, rawSotH)).toFixed(1);
    const sotA = +Math.max(1.0, Math.min(shotsA, rawSotA)).toFixed(1);

    // 2. GERÇEK KORNER İSTATİSTİKLERİ (Madde 1: Takımların son 5 veya 10 maçtaki gerçek korner ortalamaları kullanılır)
    const modelCornersH = Math.max(2.8, Math.min(8.4, 2.7 + shotsH * 0.22 + (lh > 1.6 ? 0.55 : 0)));
    const modelCornersA = Math.max(2.2, Math.min(7.2, 2.1 + shotsA * 0.21 + (la > 1.4 ? 0.45 : 0)));

    const hasRealCornersH = Boolean(rh?.hasRealCorners && rh.cornersForAvg !== null);
    const hasRealCornersA = Boolean(ra?.hasRealCorners && ra.cornersForAvg !== null);
    const hasRealCorners = hasRealCornersH || hasRealCornersA;

    let rawCornersH = modelCornersH;
    if (hasRealCornersH && ra?.cornersAgainstAvg !== null && ra?.cornersAgainstAvg !== undefined) {
        rawCornersH = 0.58 * rh.cornersForAvg + 0.42 * ra.cornersAgainstAvg;
    } else if (hasRealCornersH) {
        rawCornersH = 0.80 * rh.cornersForAvg + 0.20 * modelCornersH;
    }

    let rawCornersA = modelCornersA;
    if (hasRealCornersA && rh?.cornersAgainstAvg !== null && rh?.cornersAgainstAvg !== undefined) {
        rawCornersA = 0.58 * ra.cornersForAvg + 0.42 * rh.cornersAgainstAvg;
    } else if (hasRealCornersA) {
        rawCornersA = 0.80 * ra.cornersForAvg + 0.20 * modelCornersA;
    }

    const cornersH = +Math.max(1.8, Math.min(10.5, rawCornersH)).toFixed(1);
    const cornersA = +Math.max(1.5, Math.min(9.5, rawCornersA)).toFixed(1);
    const totalCorners = +(cornersH + cornersA).toFixed(1);
    const htCorners = +(totalCorners * 0.46).toFixed(1);

    // 3. Sarı ve Kırmızı Kart İstatistikleri (Gerçek son maç kart ortalaması + maç gerilimi)
    const closeness = Math.max(0, 1 - Math.abs(lh - la) * 0.45);
    const fatigueBump = (restH?.isFatigued ? 0.25 : 0) + (restA?.isFatigued ? 0.25 : 0);
    const baseCardsH = 1.65 + closeness * 0.45 + (restH?.isFatigued ? 0.22 : 0);
    const baseCardsA = 1.90 + closeness * 0.50 + (restA?.isFatigued ? 0.22 : 0);
    const cardsH = +(rh?.cardsForAvg !== null && rh?.cardsForAvg !== undefined ? (0.65 * rh.cardsForAvg + 0.35 * baseCardsH) : baseCardsH).toFixed(1);
    const cardsA = +(ra?.cardsForAvg !== null && ra?.cardsForAvg !== undefined ? (0.65 * ra.cardsForAvg + 0.35 * baseCardsA) : baseCardsA).toFixed(1);
    const totalCards = +(cardsH + cardsA + fatigueBump * 0.2).toFixed(1);

    // 4. Maçın Önemi ve Motivasyon Analizi (Puan Tablosundan)
    let motivation = 'Standart Lig Mücadelesi';
    if (intel?.standings?.home && intel?.standings?.away) {
        const sh = intel.standings.home, sa = intel.standings.away;
        const ptsDiff = Math.abs((sh.points || 0) - (sa.points || 0));
        if (sh.rank <= 3 && sa.rank <= 4) {
            motivation = '🔥 Zirve / Şampiyonluk Yarışı (Çok Yüksek Motivasyon)';
        } else if (sh.rank <= 5 || sa.rank <= 5) {
            motivation = '🏆 Üst Sıralar / Avrupa Potası Mücadelesi';
        } else if (sh.rank >= 15 && sa.rank >= 15) {
            motivation = '⚠️ Kümede Kalma / 6 Puanlık Kritik Maç (Yüksek Kart & Sertlik)';
        } else if (ptsDiff <= 3) {
            motivation = '⚔️ Puan Tablosunda Doğrudan Sıralama Maçı';
        }
    }

    const cornerSampleH = rh?.cornerSample || 0;
    const cornerSampleA = ra?.cornerSample || 0;
    const shotSampleH = rh?.shotSample || 0;
    const shotSampleA = ra?.shotSample || 0;

    return {
        xgH: +lh.toFixed(2),
        xgA: +la.toFixed(2),
        xgaH: +la.toFixed(2),
        xgaA: +lh.toFixed(2),
        shotsH,
        shotsA,
        sotH,
        sotA,
        hasRealShots,
        shotSampleH,
        shotSampleA,
        realShotsHFor: rh?.shotsForAvg ?? null,
        realShotsHAgainst: rh?.shotsAgainstAvg ?? null,
        realSotHFor: rh?.sotForAvg ?? null,
        realSotHAgainst: rh?.sotAgainstAvg ?? null,
        realShotsAFor: ra?.shotsForAvg ?? null,
        realShotsAAgainst: ra?.shotsAgainstAvg ?? null,
        realSotAFor: ra?.sotForAvg ?? null,
        realSotAAgainst: ra?.sotAgainstAvg ?? null,
        shotDataSource: (hasRealShotsH && hasRealShotsA)
            ? `Gerçek Takım Şut Verisi (Son ${shotSampleH}/${shotSampleA} Maç Ort.)`
            : hasRealShots
                ? 'Kısmi Gerçek Şut Verisi'
                : 'Model xG Şut Hesaplaması',
        cornersH,
        cornersA,
        totalCorners,
        htCorners,
        hasRealCorners,
        cornerSampleH,
        cornerSampleA,
        realCornersHFor: rh?.cornersForAvg ?? null,
        realCornersHAgainst: rh?.cornersAgainstAvg ?? null,
        realCornersHTotal: rh?.totalCornersAvg ?? null,
        realCornersAFor: ra?.cornersForAvg ?? null,
        realCornersAAgainst: ra?.cornersAgainstAvg ?? null,
        realCornersATotal: ra?.totalCornersAvg ?? null,
        cornerDataSource: (hasRealCornersH && hasRealCornersA)
            ? `Gerçek Son Maç Korner Verisi (Son ${cornerSampleH}/${cornerSampleA} Maç Ort.)`
            : hasRealCorners
                ? 'Kısmi Gerçek Korner Verisi'
                : 'Tempo Korner Hesaplaması',
        cardsH,
        cardsA,
        totalCards,
        motivation,
        cornerOver85: poissonOver(totalCorners, 8.5),
        cornerOver95: poissonOver(totalCorners, 9.5),
        cornerOver105: poissonOver(totalCorners, 10.5),
        htCornerOver45: poissonOver(htCorners, 4.5),
        cardOver35: poissonOver(totalCards, 3.5),
        cardOver45: poissonOver(totalCards, 4.5)
    };
}

// ---------------- Madde 7: Veri Güven Puanı (Her Maç İçin Veri Yeterliliği ve Veri Güncelliğinin Ayrı Puanlanması) ----------------
function computeDataTrustMetrics(m, nh, na, homeFacts, awayFacts, intel, L, restH, restA, projections, rosterImpact) {
    const rh = intel?.realStats?.home || null;
    const ra = intel?.realStats?.away || null;

    // 1. VERİ YETERLİLİĞİ PUANI (0 - 100): Örneklem büyüklüğü, iç/dış saha ayrımı, gerçek korner/şut verisi, kadro, H2H ve pazar derinliği
    const matchSamplePts = Math.min(25, Math.round((Math.min(nh, 10) + Math.min(na, 10)) * 1.25));
    const splitSamplePts = Math.min(15, Math.round(((homeFacts?.hn || 0) + (awayFacts?.an || 0)) * 1.5));
    const cornerSamplePts = Math.min(13, Math.round(((rh?.cornerSample || 0) + (ra?.cornerSample || 0)) * 1.6));
    const shotSamplePts = Math.min(12, Math.round(((rh?.shotSample || 0) + (ra?.shotSample || 0)) * 1.5));
    const hasHomeXI = (rosterImpact?.squad?.homeXI?.length || 0) >= 11;
    const hasAwayXI = (rosterImpact?.squad?.awayXI?.length || 0) >= 11;
    const squadPts = (hasHomeXI ? 6 : 0) + (hasAwayXI ? 6 : 0) + (intel ? 3 : 0);
    const contextPts = (intel?.standings ? 4 : 0) + ((intel?.espnH2H?.length || 0) > 0 ? 3 : 0) + (L?.n >= 20 ? 3 : 1);
    const marketDepthPts = Math.min(10, Math.round((m.nesineMarketsCount || 0) / 5));

    let sufficiencyScore = Math.max(15, Math.min(100,
        matchSamplePts + splitSamplePts + cornerSamplePts + shotSamplePts + squadPts + contextPts + marketDepthPts
    ));

    const minTeamHistory = Math.min(nh, na);
    const isSparseHistory = minTeamHistory < 5;
    const isVerySparseHistory = minTeamHistory < 3;

    // Eksik geçmiş verisi olan takımlara yüksek güven puanı verilmesini engelle
    if (isVerySparseHistory) {
        sufficiencyScore = Math.min(38, sufficiencyScore);
    } else if (isSparseHistory) {
        sufficiencyScore = Math.min(52, sufficiencyScore);
    }

    // 2. VERİ GÜNCELLİĞİ PUANI (0 - 100): Nesine oranlarının anlık tazeliği, son maç yakınlığı, kadro ve hava durumu senkronizasyonu
    let oddsFreshPts = 0;
    if (m.oddsFresh && m.oddsUpdatedAt) {
        const ageSec = typeof m.oddsAgeSeconds === 'number' ? m.oddsAgeSeconds : 30;
        if (ageSec <= 60) oddsFreshPts = 40;
        else if (ageSec <= 120) oddsFreshPts = 37;
        else if (ageSec <= 240) oddsFreshPts = 32;
        else oddsFreshPts = 24;
    }

    const rDaysH = restH?.restDays ?? 7;
    const rDaysA = restA?.restDays ?? 7;
    const recentMatchPts = (rDaysH <= 12 ? 10 : rDaysH <= 21 ? 7 : 3) + (rDaysA <= 12 ? 10 : rDaysA <= 21 ? 7 : 3);

    const squadFreshPts = rosterImpact?.squad?.isOfficial
        ? 20
        : (hasHomeXI && hasAwayXI)
            ? 16
            : (hasHomeXI || hasAwayXI)
                ? 10
                : 4;

    const liveIntelPts = (intel?.FetchedAt ? 10 : 0) + (intel?.weather ? 10 : 4);
    const freshnessScore = Math.max(10, Math.min(100,
        oddsFreshPts + recentMatchPts + squadFreshPts + liveIntelPts
    ));

    // 3. BİRLEŞİK VERİ GÜVEN PUANI
    let overallScore = Math.round(0.55 * sufficiencyScore + 0.45 * freshnessScore);
    if (isVerySparseHistory) {
        overallScore = Math.min(48, overallScore); // Asla 'Orta' veya 'Yüksek' Veri Güveni olamaz (max 48: Sınırlı)
    } else if (isSparseHistory) {
        overallScore = Math.min(59, overallScore); // Asla 'Yüksek Veri Güveni' olamaz (max 59: Sınırlı)
    }

    const sufficiencyLabel = isVerySparseHistory
        ? 'Çok Yetersiz Geçmiş'
        : isSparseHistory
            ? 'Yetersiz Geçmiş'
            : (sufficiencyScore >= 80 ? 'Çok Yüksek' : sufficiencyScore >= 62 ? 'Yüksek' : sufficiencyScore >= 45 ? 'Orta' : 'Sınırlı');

    const overallLabel = isVerySparseHistory
        ? 'Düşük Güven (Çok Yetersiz Geçmiş)'
        : isSparseHistory
            ? 'Sınırlı Veri Güveni (Yetersiz Geçmiş)'
            : (overallScore >= 80 ? 'Yüksek Veri Güveni' : overallScore >= 60 ? 'Orta Veri Güveni' : 'Sınırlı Veri Güveni');

    return {
        sufficiencyScore,
        freshnessScore,
        overallScore,
        sufficiencyLabel,
        freshnessLabel: !m.oddsFresh
            ? 'Oran Yenilenemedi'
            : freshnessScore >= 82
                ? 'Anlık Canlı'
                : freshnessScore >= 65
                    ? 'Güncel'
                    : 'Kısmi Güncel',
        overallLabel,
        oddsFresh: Boolean(m.oddsFresh),
        oddsUpdatedAt: m.oddsFresh ? m.oddsUpdatedAt : null,
        hasRealCorners: Boolean(projections?.hasRealCorners),
        hasRealShots: Boolean(projections?.hasRealShots),
        hasSquadData: Boolean(hasHomeXI || hasAwayXI),
        lineupType: rosterImpact?.squad?.lineupType || 'Veri Yok'
    };
}

// ---------------- %100 Bağımsız 10+ Katmanlı Derin Maç Analizi & Hibrit Kalibrasyon ----------------
function analyze(model, m, opts = {}) {
    const intel = opts.intel || m.intel || null;
    const th = model.teams.get(m.homeId), ta = model.teams.get(m.awayId);
    const L = model.lgStat(m.league.id), g = model.glob;
    const nh = th ? th.n : 0, na = ta ? ta.n : 0;

    const homeFacts = teamFacts(th, m);
    const awayFacts = teamFacts(ta, m);

    // 1. Katman: Genel + Ev/Deplasman Ayrı Hücum ve Savunma Güçleri (Lig Bazlı Ev Sahibi Avantajı Dahil)
    const K_GEN = 4, K_SPLIT = 3;
    const attGen = (t) => (t ? (t.gf + K_GEN * g.muH) / (t.bgf + K_GEN * g.muH) : 1);
    const dfnGen = (t) => (t ? (t.ga + K_GEN * g.muH) / (t.bga + K_GEN * g.muH) : 1);

    const attHome = (t) => (t && t.hn > 0 ? (t.hgf + K_SPLIT * L.muH) / (t.hbgf + K_SPLIT * L.muH) : attGen(t));
    const dfnHome = (t) => (t && t.hn > 0 ? (t.hga + K_SPLIT * L.muA) / (t.hbga + K_SPLIT * L.muA) : dfnGen(t));

    const attAway = (t) => (t && t.an > 0 ? (t.agf + K_SPLIT * L.muA) / (t.abgf + K_SPLIT * L.muA) : attGen(t));
    const dfnAway = (t) => (t && t.an > 0 ? (t.aga + K_SPLIT * L.muH) / (t.abga + K_SPLIT * L.muH) : dfnGen(t));

    // Ev sahibinin iç saha gücü (%65) + genel gücü (%35)
    const effAttH = 0.65 * attHome(th) + 0.35 * attGen(th);
    const effDfnA = 0.65 * dfnAway(ta) + 0.35 * dfnGen(ta);
    const effAttA = 0.65 * attAway(ta) + 0.35 * attGen(ta);
    const effDfnH = 0.65 * dfnHome(th) + 0.35 * dfnGen(th);

    let lh = L.muH * effAttH * effDfnA;
    let la = L.muA * effAttA * effDfnH;

    // 2. Katman: Son 5 Maç Form İvmesi (Momentum)
    const momH = computeFormMomentum(th, m);
    const momA = computeFormMomentum(ta, m);
    lh *= momH;
    la *= momA;

    // 3. Katman: H2H (Aralarındaki Maçlar) ve Ortak Rakipler Kıyaslaması
    const h2hCommon = analyzeH2HAndCommon(th, ta, m, intel);
    lh *= h2hCommon.h2hModH * h2hCommon.commonModH;
    la *= h2hCommon.h2hModA * h2hCommon.commonModA;

    // 4. Katman: Fikstür Yorgunluğu ve Dinlenme Günleri (Rest Days & Congestion)
    const restH = computeRestAndFatigue(th, m);
    const restA = computeRestAndFatigue(ta, m);
    lh *= restH.attMod * restA.dfnMod;
    la *= restA.attMod * restH.dfnMod;

    // 5. Katman: Kadro, Gol Kralı Bağımlılığı, Muhtemel/Resmi İlk 11 ve Sakat/Eksik Oyuncu Etkisi
    const rosterImpact = computeRosterImpact(m, intel, homeFacts, awayFacts);
    lh *= rosterImpact.modH;
    la *= rosterImpact.modA;

    // 6. Katman: Puan Durumu / Sıralama Farkı Etkisi (ESPN Standings varsa)
    if (intel && intel.standings && intel.standings.home && intel.standings.away) {
        const sh = intel.standings.home, sa = intel.standings.away;
        if (sh.gp >= 3 && sa.gp >= 3) {
            const ppgDiff = (sh.points / sh.gp) - (sa.points / sa.gp);
            lh *= Math.min(1.06, Math.max(0.94, 1 + 0.03 * ppgDiff));
            la *= Math.min(1.06, Math.max(0.94, 1 - 0.03 * ppgDiff));
        }
    }

    // 7. Katman: Maç Saati Hava Durumu ve Zemin Şartları Etkisi (Open-Meteo)
    if (intel && intel.weather && intel.weather.xgMod) {
        lh *= intel.weather.xgMod;
        la *= intel.weather.xgMod;
    }

    // 7.5 Katman: Piyasa Oran Kalibrasyonu (Yalnızca güncel/geçerli oran mevcutsa %10 hibrit kalibrasyon)
    let calibratedWithOdds = false;
    if (m.odds && (m.state === 'post' || m.oddsFresh) && m.odds.ms1 > 1 && m.odds.msx > 1 && m.odds.ms2 > 1) {
        const inv1 = 1 / m.odds.ms1, invX = 1 / m.odds.msx, inv2 = 1 / m.odds.ms2;
        const sum1X2 = inv1 + invX + inv2;
        const p1 = inv1 / sum1X2, pX = invX / sum1X2, p2 = inv2 / sum1X2;
        let pO = null;
        if (m.odds.ust25 > 1 && m.odds.alt25 > 1) {
            const invO = 1 / m.odds.ust25, invU = 1 / m.odds.alt25;
            pO = invO / (invO + invU);
        }
        const [mktLh, mktLa] = fitLambda(p1, pX, p2, pO, lh, la);
        lh = 0.90 * lh + 0.10 * mktLh;
        la = 0.90 * la + 0.10 * mktLa;
        calibratedWithOdds = true;
    }

    lh = Math.min(3.75, Math.max(0.25, lh));
    la = Math.min(3.75, Math.max(0.25, la));

    const inBulletin = Boolean(m.inBulletin);

    // 8. Katman: Devre Gol Payları + Yorgunluk Kayması + Dinamik Dixon-Coles (ρ)
    const shHome = (t) => (t ? (t.hgf1 + t.gf1 + 6 * L.s1) / (t.hgf + t.gf + 6) : L.s1);
    const shAway = (t) => (t ? (t.agf1 + t.gf1 + 6 * L.s1) / (t.agf + t.gf + 6) : L.s1);
    const shareH = 0.5 * (shHome(th) + (ta ? (ta.aga1 + ta.ga1 + 6 * L.s1) / (ta.aga + ta.ga + 6) : L.s1)) + restA.shMod;
    const shareA = 0.5 * (shAway(ta) + (th ? (th.hga1 + th.ga1 + 6 * L.s1) / (th.hga + th.ga + 6) : L.s1)) + restH.shMod;
    const clamp = (v) => Math.min(0.62, Math.max(0.28, v));
    const dynRho = computeDynamicRho(lh, la, homeFacts, awayFacts);
    const mkts = computeMarkets(lh, la, clamp(shareH), clamp(shareA), dynRho);

    // 8.5 Katman: Gerçek Verili Korner, Kart, Şut/İsabetli Şut, xG/xGA ve Motivasyon Projeksiyonları
    const projections = computeAdvancedProjections(m, lh, la, homeFacts, awayFacts, intel, restH, restA);
    mkts.p.korner_ust85 = projections.cornerOver85;
    mkts.p.korner_ust95 = projections.cornerOver95;
    mkts.p.korner_ust105 = projections.cornerOver105;
    mkts.p.iy_korner_ust45 = projections.htCornerOver45;
    mkts.p.kart_ust35 = projections.cardOver35;
    mkts.p.kart_ust45 = projections.cardOver45;

    // 9. Katman: Takım Taktik Kimliği (Tactical DNA) ve Eşleşme Çarpışması
    const dnaH = computeTacticalDNA(th, homeFacts, true);
    const dnaA = computeTacticalDNA(ta, awayFacts, false);
    const tactical = analyzeTacticalClash(m, dnaH, dnaA, restH, restA);

    // 10. Katman: Canlı Maç (In-Play) Motoru (Maç oynanıyorsa)
    const liveState = m.state === 'live' ? analyzeLiveState(m, lh, la) : null;

    // 11. Katman: Veri Güven Puanı (Veri Yeterliliği ve Veri Güncelliği ayrı ayrı puanlanır)
    const dataTrust = computeDataTrustMetrics(m, nh, na, homeFacts, awayFacts, intel, L, restH, restA, projections, rosterImpact);

    const quality = inBulletin && Math.min(nh, na) >= 6 && L.n >= 20
        ? 'A'
        : inBulletin && Math.min(nh, na) >= 3
            ? 'B'
            : 'C';

    const avgConsistency = (homeFacts && awayFacts)
        ? Math.round((homeFacts.consistencyPct + awayFacts.consistencyPct) / 2)
        : 70;

    return {
        lh, la, quality,
        rho: mkts.rho,
        marketUsed: inBulletin,
        calibratedWithOdds,
        leagueHomeAdv: L.homeAdv,
        p: mkts.p,
        projections,
        dataTrust,
        topScores: mkts.topScores,
        topHtScores: mkts.topHtScores,
        nh, na, leagueN: L.n,
        momH: +momH.toFixed(2),
        momA: +momA.toFixed(2),
        restH,
        restA,
        tactical,
        rosterSummary: rosterImpact.summary,
        lineupSummary: rosterImpact.lineupSummary,
        squad: rosterImpact.squad,
        avgConsistency,
        liveState,
        h2hSummary: h2hCommon.h2hSummary,
        commonSummary: h2hCommon.commonSummary,
        intel: intel || null,
        facts: opts.facts ? { home: homeFacts, away: awayFacts } : undefined
    };
}

// ---------------- Gerçek Value Bet (Beklenen Değer - EV) & Kalibrasyon Shrinkage ----------------
// Ham EV = (Model olasılığı × Gerçek Nesine oranı) - 1
// Jack'in 2. Kontrolü: Yüksek EV tek başına iyi tahmin anlamına gelmez; uç sapmaları önlemek için
// 1X2 pazarında 3 oranın toplamından, Alt/Üst veya KG pazarında 2 oranın toplamından gerçek marjsız (vig-free)
// overround hesaplanır ve Bayesyen Shrinkage (kalibrasyon düzeltmesi) uygulanır.
const MARKET_COMPANIONS = {
    ms1: ['ms1', 'msx', 'ms2'],
    msx: ['ms1', 'msx', 'ms2'],
    ms2: ['ms1', 'msx', 'ms2'],
    h: ['ms1', 'msx', 'ms2'],
    d: ['ms1', 'msx', 'ms2'],
    a: ['ms1', 'msx', 'ms2'],
    iy1: ['iy1', 'iyx', 'iy2'],
    iyx: ['iy1', 'iyx', 'iy2'],
    iy2: ['iy1', 'iyx', 'iy2'],
    alt15: ['alt15', 'ust15'],
    ust15: ['alt15', 'ust15'],
    alt25: ['alt25', 'ust25'],
    ust25: ['alt25', 'ust25'],
    alt35: ['alt35', 'ust35'],
    ust35: ['alt35', 'ust35'],
    iyalt05: ['iyalt05', 'iyust05'],
    iyust05: ['iyalt05', 'iyust05'],
    iyalt15: ['iyalt15', 'iyust15'],
    iyust15: ['iyalt15', 'iyust15'],
    kgv: ['kgv', 'kgy'],
    kgy: ['kgv', 'kgy'],
    tg01: ['tg01', 'tg23', 'tg46', 'tg7p'],
    tg23: ['tg01', 'tg23', 'tg46', 'tg7p'],
    tg46: ['tg01', 'tg23', 'tg46', 'tg7p'],
    tg7p: ['tg01', 'tg23', 'tg46', 'tg7p']
};

function computeExpectedValue(modelProb, realOdd, marketKey = null, matchOdds = null) {
    const p = Number(modelProb);
    const odd = Number(realOdd);
    if (!isFinite(p) || !isFinite(odd) || p <= 0 || odd <= 1.0) {
        return { ev: null, evPct: null, rawEvPct: null, calibratedProb: null, overround: null };
    }
    const rawEv = (p * odd) - 1;
    const rawEvPct = +(rawEv * 100).toFixed(1);

    // Jack Kontrolü: Çifte şans pazarında (dc1x, dc12, dcx2) seçenekler birbirini dışlamaz (toplam olasılık 2.0'dır).
    // Basit toplamla marjdan arındırma yapılamaz; uygun bir model geliştirilene kadar EV hesabı devre dışıdır.
    if (marketKey && marketKey.startsWith('dc')) {
        return {
            ev: null,
            evPct: null,
            rawEvPct,
            calibratedProb: null,
            overround: null,
            reason: 'Çifte şans pazarında seçenekler birbirini dışlamadığı için (sum(P)=2.0) klasik marjdan arındırma yapılamaz; EV hesabı devre dışıdır.'
        };
    }

    // Jack Kontrol 1: Her pazar için yalnızca kendi tamamlayıcı oranları aranır.
    // Başka bir pazarın (ör. 1X2 veya 2.5 Alt/Üst) marjı ASLA başka bir pazara çapraz uygulanamaz!
    let overround = null;
    if (matchOdds && typeof matchOdds === 'object' && marketKey) {
        const companions = MARKET_COMPANIONS[marketKey];
        if (companions && companions.length >= 2 && companions.every(k => typeof matchOdds[k] === 'number' && matchOdds[k] > 1.01)) {
            overround = companions.reduce((sum, k) => sum + (1 / matchOdds[k]), 0);
        }
    }

    // Jack Kontrol 2 Kuralı: Diğer pazar oranları yoksa gerçek overround ölçülemez;
    // Tahmini/sabit 1.08 ile sahte marjsız olasılık HESAPLANMAZ, EV hesabı doğrudan geçersiz sayılır!
    if (!overround || !isFinite(overround) || overround < 1.01 || overround > 1.45) {
        return {
            ev: null,
            evPct: null,
            rawEvPct,
            calibratedProb: null,
            overround: null,
            reason: 'Tamamlayıcı pazar oranları eksik olduğu için marjsız overround hesaplanamadı.'
        };
    }

    // Piyasa marjsız (vig-free) zımni olasılık
    const impliedMktProb = Math.max(0.02, Math.min(0.95, (1 / odd) / overround));
    // %35 piyasa konsensüsüne Bayesyen çekim (Shrinkage) ile aşırı şişik sapmaları kalibre et
    const calibratedProb = 0.65 * p + 0.35 * impliedMktProb;
    const calibratedEv = (calibratedProb * odd) - 1;
    const evPct = +(calibratedEv * 100).toFixed(1);

    return {
        ev: +calibratedEv.toFixed(4),
        evPct,
        rawEvPct,
        calibratedProb: +calibratedProb.toFixed(3),
        overround: +overround.toFixed(4)
    };
}

// ---------------- Pick listesi (Model Olasılığı + Güncel Gerçek Nesine Oranı + Son Güncelleme Zamanı + EV Kontrolü) ----------------
function picksOf(match, an) {
    const out = [];
    const isOddsFresh = match.state === 'post' ? true : Boolean(match.oddsFresh);
    for (const [key, pv] of Object.entries(an.p)) {
        let label, group;
        if (key.startsWith('htft_')) { label = 'İY/MS ' + key.slice(5); group = 'htft'; }
        else { label = LABEL[key]; group = GROUP[key]; }
        if (!label) continue;
        // Madde 3: Yalnızca oranlar güncel (oddsFresh) ve bu pazar için gerçek Nesine oranı varsa kullan; yenilenemediyse eski oranı kullanma!
        const hasRealOdd = Boolean(isOddsFresh && match.odds && typeof match.odds[key] === 'number' && isFinite(match.odds[key]) && match.odds[key] > 1.01);
        const realOdd = hasRealOdd ? +match.odds[key].toFixed(2) : null;
        const oddsUpdatedAt = hasRealOdd ? (match.oddsUpdatedAt || null) : null;
        const evData = hasRealOdd ? computeExpectedValue(pv, realOdd, key, match.odds) : { ev: null, evPct: null, rawEvPct: null, calibratedProb: null, overround: null };
        const { ev, evPct, rawEvPct, calibratedProb, overround } = evData;
        const isValueBet = Boolean(hasRealOdd && typeof ev === 'number' && ev > 0);
        const oddStatusText = hasRealOdd
            ? `${realOdd.toFixed(2)}`
            : !isOddsFresh
                ? 'Oran yenilenemedi (eski oran kullanılmıyor)'
                : 'Bu pazar için gerçek Nesine oranı bulunamadı';
        const evStatusText = (hasRealOdd && evPct !== null)
            ? `${evPct >= 0 ? '+' : ''}%${evPct}${isValueBet ? ' (Value Bet)' : ''}`
            : 'Gerçek/güncel oran bulunamadığı için EV hesaplanamadı';

        out.push({
            key,
            label,
            group,
            p: pv,
            modelProbPct: Math.round(pv * 100),
            hasRealOdd,
            realOdd,
            oddsFresh: isOddsFresh,
            oddsUpdatedAt,
            ev,
            evPct,
            rawEvPct,
            overround,
            isValueBet,
            oddStatusText,
            evStatusText,
            dataTrust: an.dataTrust || null,
            matchId: match.id
        });
    }
    return out;
}

const BANKO_PRIMARY_KEYS = new Set(['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05', 'ev_ust15', 'dep_ust15']);
const BANKO_KEYS = ['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05', 'ust15', 'dc1x', 'dcx2', 'alt35', 'ev_ust15', 'dep_ust15', 'korner_ust85'];
const SURPRISE_GROUPS = ['ms', 'msx', 'dc', 'iy', 'ms_kg', 'ms_ou', 'iy_kg', 'y2_kg', 'iy_ust', 'iyskor', 'msskor', 'tg', 'htft', 'ou_kg', 'korner', 'kart'];

function qualifies(match, an, minQ = 'B') {
    if (match.state !== 'pre') return false;
    if (!match.inBulletin) return false;
    if (new Date(match.kickoff).getTime() < Date.now() + 5 * 60000) return false;
    if (minQ === 'A') return an.quality === 'A';
    if (minQ === 'B') return an.quality === 'A' || an.quality === 'B';
    return true;
}

function generateRationale(pk, m, an) {
    const lhNum = (typeof an.lh === 'number' && isFinite(an.lh)) ? an.lh : 1.45;
    const laNum = (typeof an.la === 'number' && isFinite(an.la)) ? an.la : 1.15;
    const totG = (lhNum + laNum).toFixed(2);
    const lhStr = lhNum.toFixed(2);
    const laStr = laNum.toFixed(2);
    const pStr = '%' + (pk.p * 100).toFixed(0);
    const liftStr = pk.lift ? pk.lift.toFixed(1) + ' kat' : '';

    const hf = an.facts?.home;
    const af = an.facts?.away;
    const splitNote = (hf && af && hf.homeGf !== null && af.awayGf !== null)
        ? ` Ev sahibi iç sahada maç başı ${hf.homeGf} gol (yediği ${hf.homeGa}, Son 10: ${hf.form10Str || hf.formStr}), deplasman dış sahada ${af.awayGf} gol (yediği ${af.awayGa}, Son 10: ${af.form10Str || af.formStr}) ortalamasında.`
        : '';

    const pr = an.projections;
    let projNote = '';
    if (pr) {
        const realCornerInfo = (pr.realCornersHFor !== null && pr.realCornersAFor !== null)
            ? `Gerçek Son Maç Korner Ort: Ev ${pr.realCornersHFor} / Dep ${pr.realCornersAFor} (Beklenti: ${pr.totalCorners})`
            : `Korner: ${pr.totalCorners}`;
        const realShotInfo = (pr.realShotsHFor !== null && pr.realShotsAFor !== null)
            ? `Gerçek Şut/İsabet Ort: Ev ${pr.realShotsHFor}/${pr.realSotHFor} - Dep ${pr.realShotsAFor}/${pr.realSotAFor}`
            : `İsabetli Şut: ${pr.sotH}-${pr.sotA}`;
        projNote = ` [🎯 ${realShotInfo} | 🚩 ${realCornerInfo} | 🟨 Kart: ${pr.totalCards}]`;
    }

    const squadNote = an.rosterSummary && !an.rosterSummary.includes('tespit edilmedi')
        ? ` [🏥 Kadro/Eksik: ${an.rosterSummary}]`
        : '';
    const extraNote = an.commonSummary
        ? ` [${an.commonSummary}]`
        : an.h2hSummary
            ? ` [${an.h2hSummary}]`
            : '';
    const dnaNote = an.tactical
        ? ` 🧬 Kimlik: ${m.home} (${an.tactical.homeTags[0]}) vs ${m.away} (${an.tactical.awayTags[0]}).`
        : '';
    const fatigueNote = (an.restH?.isFatigued || an.restA?.isFatigued)
        ? ` ⏱️ ${an.restH?.isFatigued ? m.home + ' ' + an.restH.label : m.away + ' ' + an.restA.label}.`
        : '';
    const weatherNote = an.intel?.weather
        ? ` 🌤️ ${an.intel.weather.city}: ${an.intel.weather.temp}°C (${an.intel.weather.condition}).`
        : '';
    const trustNote = an.dataTrust
        ? ` [🛡️ Veri Yeterliliği: %${an.dataTrust.sufficiencyScore} | Güncellik: %${an.dataTrust.freshnessScore}]`
        : '';
    const evNote = (pk.hasRealOdd && pk.realOdd && pk.evPct !== null && pk.evPct !== undefined)
        ? ` [Gerçek Nesine Oranı: ${pk.realOdd.toFixed(2)} (Son Güncelleme: ${pk.oddsUpdatedAt || 'Canlı'}) | EV: ${pk.evPct >= 0 ? '+' : ''}%${pk.evPct}${pk.isValueBet ? ' • Value Bet' : ''}]`
        : !pk.oddsFresh
            ? ` [Nesine Oranı: Oran yenilenemedi (eski oran kullanılmıyor) | EV: Hesaplanamadı]`
            : ` [Nesine Oranı: Bu pazar için gerçek oran bulunamadı | EV: Hesaplanamadı]`;
    const contrarianPrefix = pk.contrarianThesis ? `⚡ ${pk.contrarianThesis} ` : '';
    const tailNotes = `${evNote}${splitNote}${projNote}${squadNote}${dnaNote}${fatigueNote}${extraNote}${weatherNote}${trustNote}`;

    if (pk.key === 'ms1_kgv' || pk.key === 'ms2_kgv') {
        const side = pk.key === 'ms1_kgv' ? m.home : m.away;
        const other = pk.key === 'ms1_kgv' ? m.away : m.home;
        return `${contrarianPrefix}${side} hücum üretimiyle skoru lehine çevirmeye aday (${lhStr} - ${laStr} xG), ancak ${other} da gol bulabilecek istatistiğe sahip (2-1 / 3-1 senaryosu, ${pStr} olasılık, ${liftStr} sıklık çarpanı).${tailNotes}`;
    }
    if (pk.key === 'msx_kgv') {
        return `${contrarianPrefix}İki takımın hücum ve savunma dengesi birbirine çok yakın (${lhStr} - ${laStr} xG). Gollü beraberlik (1-1 / 2-2) senaryosu normalin ${liftStr} üzerinde (${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'ms1_ust25' || pk.key === 'ms2_ust25') {
        const side = pk.key === 'ms1_ust25' ? m.home : m.away;
        return `${contrarianPrefix}${side} yüksek hücum temposuyla maçı üst barajına taşıyarak kazanmaya aday (Toplam ${totG} xG, ${pStr} olasılık, ${liftStr} sıklık çarpanı).${tailNotes}`;
    }
    if (pk.key === 'ust25_kgv') {
        return `${contrarianPrefix}İki takım da açık futbol oynuyor (Ev ${lhStr} - Dep ${laStr}, toplam ${totG} xG). Hem KG Var hem 2,5 Üst birleşimi ${pStr} olasılıkla öne çıkıyor.${tailNotes}`;
    }
    if (pk.key === 'iykgv') {
        return `${contrarianPrefix}Her iki takım da maça hızlı başlayan ve ilk yarılarda açık veren karakterde. İlk yarıdan karşılıklı gol (İY KG Var) olasılığı ${pStr} (normalin ${liftStr} üzerinde).${tailNotes}`;
    }
    if (pk.key === 'y2kgv') {
        return `${contrarianPrefix}İkinci yarılarda savunma disiplini düşen ve skoru çift taraflı üreten iki ekip. 2. Yarı KG Var olasılığı ${pStr} (${liftStr} istatistiksel çarpan).${tailNotes}`;
    }
    if (pk.key === 'iyust15') {
        return `${contrarianPrefix}İlk yarı gol beklentisi çok yüksek; devre bitmeden en az 2 gol (İY 1,5 Üst) çıkma ihtimali ${pStr} (${liftStr} çarpan).${tailNotes}`;
    }
    if (pk.key === 'tg46') {
        return `${contrarianPrefix}Yüksek tempolu ve gollü geçmeye aday karşılaşma (${totG} toplam xG). Maçta toplam 4-6 gol aralığı ${pStr} olasılık ve ${liftStr} çarpan taşıyor.${tailNotes}`;
    }
    if (pk.key.startsWith('korner_')) {
        return `${contrarianPrefix}Takımların son maçlardaki gerçek korner ortalamaları yüksek barajı destekliyor (Toplam korner beklentisi: ${pr?.totalCorners || '-'}, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key.startsWith('kart_')) {
        return `${contrarianPrefix}Maçın puan tablosu gerilimi ve takımların kart ortalamaları yüksek kart barajını destekliyor (Beklenen kart: ${pr?.totalCards || '-'}, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key.startsWith('iyskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `${contrarianPrefix}İlk yarı Dixon-Coles devre matrisinde ${sc} kesin skoru yüksek yoğunlukta (${pStr} olasılık, normal dağılımın ${liftStr} üzerinde).${tailNotes}`;
    }
    if (pk.key.startsWith('msskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `${contrarianPrefix}Bağımsız Dixon-Coles skor matrisinde ${sc} maç skoru yüksek oranlı hedef olarak öne çıkıyor (${pStr} olasılık, ${liftStr} çarpan).${tailNotes}`;
    }
    if (pk.key === 'ust15') {
        return `Bağımsız xG modeli toplam ${totG} gol (Ev ${lhStr} - Dep ${laStr}) hesapladı (${pStr} güven, İstikrar: %${an.avgConsistency || 75}).${tailNotes}`;
    }
    if (pk.key === 'iyust05') {
        return `İlk yarı gol temposu yüksek; model devre bitmeden en az 1 gol olasılığını ${pStr} olarak hesapladı (İstikrar: %${an.avgConsistency || 75}).${tailNotes}`;
    }
    if (pk.key === 'alt25' || pk.key === 'alt35') {
        return `Savunma direnci yüksek eşleşme; toplam beklenen gol ${totG} seviyesinde (${pStr} güven, Dixon-Coles ρ:${an.rho || -0.09}).${tailNotes}`;
    }
    if (pk.key === 'ust25') {
        return `Yüksek hücum temposu; ${totG} beklenen gol ile model ${pStr} olasılıkla 2,5 Üst öngörüyor.${tailNotes}`;
    }
    if (pk.key === 'kgv') {
        return `Ev (${lhStr} xG) ve deplasman (${laStr} xG) karşılıklı üretime çok uygun (${pStr} güven).${tailNotes}`;
    }
    if (pk.key === 'dc1x') {
        return `${contrarianPrefix}${m.home} iç saha direnci ve form ivmesiyle puan çıkarmaya çok yakın (${lhStr} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'dcx2') {
        return `${contrarianPrefix}${m.away} deplasman performansı ve form ivmesiyle yenilmemeye aday (${laStr} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'ms1') {
        return `${contrarianPrefix}${m.home} iç saha gücü ve form ivmesiyle öne çıkıyor (${lhStr} - ${laStr} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'ms2') {
        return `${contrarianPrefix}${m.away} deplasman karnesi ve hücum kalitesiyle öne çıkıyor (${laStr} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'msx') {
        return `${contrarianPrefix}İki takımın iç/dış saha güçleri dengeli (${lhStr} - ${laStr} xG). Beraberlik olasılığı ${pStr} (${liftStr} çarpan).${tailNotes}`;
    }
    if (pk.key.startsWith('iy1') || pk.key.startsWith('iy2')) {
        const team = pk.key === 'iy1' ? m.home : m.away;
        return `${contrarianPrefix}${team} ilk yarılarda yüksek gol yüzdesine sahip. Devreyi önde kapatma ihtimali ${pStr} (${liftStr} istatistiksel çarpan).${tailNotes}`;
    }
    if (pk.key.startsWith('htft_')) {
        const sub = pk.key.slice(5);
        return `${contrarianPrefix}Bağımsız devre modelinde yüksek değerli İY/MS (${sub}) ters/dönüş senaryosu: ${pStr} olasılık (normal dağılımın ${liftStr} üzerinde).${tailNotes}`;
    }
    return `${contrarianPrefix}Bağımsız modelin ${pStr} olasılık ve ${liftStr || 'yüksek güven'} ile öne çıkardığı istatistiksel tercih.${tailNotes}`;
}

function isMainstreamMatch(m) {
    return (m.mbs <= 2 || (m.order !== undefined && m.order < 55)) && !m.youth && !m.women && !m.reserve;
}

// ---------------- Madde 6: Sürpriz Kupon Algoritması (Favori Takımlar Yerine Yüksek Oranlı, İstatistiksel Ters Sonuçlar) ----------------
function scoreSurpriseCandidate(pk, m, an, model) {
    if (!SURPRISE_GROUPS.includes(pk.group)) return null;
    const baseRate = (model && model.base && model.base[pk.key]) || 0.08;
    const lift = pk.p / baseRate;

    const hasRealOdd = Boolean(pk.hasRealOdd && typeof pk.realOdd === 'number' && pk.realOdd > 1.01 && typeof pk.ev === 'number');
    // Sürpriz kuponda düşük oranlı (< 2.05) düz seçimleri kesinlikle ele
    if (hasRealOdd && pk.realOdd < 2.05) return null;
    if (hasRealOdd && pk.ev < -0.02) return null;
    if (!hasRealOdd && lift < 1.32) return null;

    // Piyasanın (Nesine oranlarının) favori gördüğü tarafı tespit et
    const odd1 = (m.oddsFresh && m.odds?.ms1 > 1.01) ? m.odds.ms1 : null;
    const odd2 = (m.oddsFresh && m.odds?.ms2 > 1.01) ? m.odds.ms2 : null;
    const homeIsMarketFav = (odd1 !== null && odd2 !== null) ? (odd1 < odd2 - 0.25 && odd1 < 1.95) : (an.lh - an.la > 0.40);
    const awayIsMarketFav = (odd1 !== null && odd2 !== null) ? (odd2 < odd1 - 0.25 && odd2 < 1.95) : (an.la - an.lh > 0.40);

    // KESİN KURAL (Madde 6): Favori takımların düz/beklenen galibiyetlerini Sürpriz Kupona ASLA alma!
    // Ev sahibi piyasa favorisiyse düz ev sahibi tercihlerini ele:
    if (homeIsMarketFav && ['ms1', 'dc1x', 'iy1', 'ms1_ust25', 'hms1', 'ah_h_15', 'htft_1/1'].includes(pk.key)) {
        return null;
    }
    // Deplasman piyasa favorisiyse düz deplasman tercihlerini ele:
    if (awayIsMarketFav && ['ms2', 'dcx2', 'iy2', 'ms2_ust25', 'hms2', 'ah_a_15', 'htft_2/2'].includes(pk.key)) {
        return null;
    }

    const tot = an.lh + an.la;
    const diff = an.lh - an.la;
    const hf = an.facts?.home, af = an.facts?.away;
    let tacticalMult = 1.0;
    let contrarianType = null;
    let contrarianThesis = null;

    // 1. TERS TARAF GALİBİYETİ (Underdog / Piyasa Sürprizi: MS 1 veya MS 2 Yüksek Oranlı Ters Sonuç)
    if (pk.key === 'ms1' || pk.key === 'ms2') {
        const isUnderdogHome = pk.key === 'ms1' && (awayIsMarketFav || (hasRealOdd && pk.realOdd >= 2.45));
        const isUnderdogAway = pk.key === 'ms2' && (homeIsMarketFav || (hasRealOdd && pk.realOdd >= 2.45));
        if (!isUnderdogHome && !isUnderdogAway) return null;
        if (pk.p < 0.24 || pk.p > 0.52) return null;
        if (hasRealOdd && pk.ev < 0.04) return null;
        const dogTeam = pk.key === 'ms1' ? m.home : m.away;
        const favTeam = pk.key === 'ms1' ? m.away : m.home;
        tacticalMult = 1.52;
        contrarianType = 'Ters Taraf Sürprizi (Underdog Value)';
        contrarianThesis = `[Ters Sonuç Analizi]: Piyasa ${favTeam} tarafını favori fiyatlasa da, ${dogTeam} son maç form ivmesi, ortak rakipler karnesi ve saha içi üretimle (${pk.realOdd ? pk.realOdd.toFixed(2) + ' oranda ' : ''}+%${pk.evPct || Math.round((lift - 1) * 100)} değer farkı) istatistiksel ters sonuç fırsatı veriyor.`;
    }
    // 2. FAVORİYE KARŞI SÜRPRİZ ÇİFTE ŞANS (Underdog 1X / X2 Direnci)
    else if (pk.key === 'dc1x' || pk.key === 'dcx2') {
        const isDog1X = pk.key === 'dc1x' && awayIsMarketFav;
        const isDogX2 = pk.key === 'dcx2' && homeIsMarketFav;
        if (!isDog1X && !isDogX2) return null;
        if (!hasRealOdd || pk.realOdd < 2.05 || pk.ev < 0.04) return null;
        const dogTeam = pk.key === 'dc1x' ? m.home : m.away;
        const favTeam = pk.key === 'dc1x' ? m.away : m.home;
        tacticalMult = 1.44;
        contrarianType = 'Favoriye Karşı Sürpriz Direnç (Ters Çifte Şans)';
        contrarianThesis = `[Favoriye Karşı Ters Direnç]: Piyasa favorisi ${favTeam} karşısında ${dogTeam} yüksek savunma direnci ve form istikrarıyla yenilmeme (%${Math.round(pk.p * 100)}) değerine sahip.`;
    }
    // 3. YÜKSEK ORANLI DENGE / GOLLÜ BERABERLİK SÜRPRİZİ (MS X ve MS X & KG Var)
    else if (pk.key === 'msx' || pk.key === 'msx_kgv') {
        if (Math.abs(diff) > 0.28 || pk.p < 0.14) return null;
        if (pk.key === 'msx_kgv' && (an.lh < 1.12 || an.la < 1.12)) return null;
        tacticalMult = pk.key === 'msx_kgv' ? 1.42 : 1.35;
        contrarianType = 'Yüksek Oranlı Denge / Beraberlik Sürprizi';
        contrarianThesis = `[Ters Denge Sürprizi]: Taraf bahislerinin aksine iki takımın güç, form ve xG dengesi (${an.lh.toFixed(2)} - ${an.la.toFixed(2)}) yüksek oranlı beraberlik senaryosunu öne çıkarıyor.`;
    }
    // 4. DEVRE SÜRPRİZİ & GERİ DÖNÜŞLER (İY/MS X/1, X/2, 2/1, 1/2 ve Ters İlk Yarı)
    else if (pk.group === 'htft' || pk.group === 'iy') {
        if (pk.group === 'htft') {
            const sub = pk.key.slice(5);
            if (sub === '1/1' || sub === '2/2' || sub === 'X/X') return null; // Düz favori devre/maç sonuçlarını ele
            if (sub === '2/1' || sub === '1/2') {
                if (pk.p < 0.045) return null;
                tacticalMult = 1.46;
                contrarianType = 'İY/MS Geri Dönüş Sürprizi (1/2 - 2/1)';
                contrarianThesis = `[Ters Devre / Geri Dönüş]: İlk yarı ve ikinci yarı gol dağılım karakterleri zıt olan iki takımda devre arası skor dönüşü (${sub}) yüksek istatistiksel çarpan taşıyor.`;
            } else {
                // X/1 veya X/2 (İlk yarı kilitli beraberlik, 2. yarı patlama)
                if (pk.p < 0.13 || pk.p > 0.38) return null;
                tacticalMult = 1.34;
                contrarianType = 'İlk Yarı Kilitli / 2. Yarı Çözülme Sürprizi';
                contrarianThesis = `[Devre Karakteri Farkı]: İlk yarıda dengeli/kilitli başlayan oyunun 2. yarı gol payı üstünlüğüyle (${sub}) çözülmesi bekleniyor.`;
            }
        } else {
            // iy1 veya iy2: Sadece piyasa favorisi OLMAYAN takımın ilk yarı sürprizi
            const isDogIy1 = pk.key === 'iy1' && !homeIsMarketFav && (hasRealOdd ? pk.realOdd >= 2.60 : pk.p >= 0.24);
            const isDogIy2 = pk.key === 'iy2' && !awayIsMarketFav && (hasRealOdd ? pk.realOdd >= 2.60 : pk.p >= 0.24);
            if (!isDogIy1 && !isDogIy2) return null;
            const dogTeam = pk.key === 'iy1' ? m.home : m.away;
            tacticalMult = 1.36;
            contrarianType = 'İlk Yarı Sürpriz Taraf Üstünlüğü';
            contrarianThesis = `[İlk Yarı Ters Sonuç]: ${dogTeam} maça erken baskıyla başlayan yapısı sayesinde ilk devreyi sürpriz şekilde önde kapatmaya aday.`;
        }
    }
    // 5. SÜRPRİZ TARAF + KG VAR / ÜST KOMBİNASYONLARI (Ağır favori olmayan eşleşmelerde)
    else if (pk.key === 'ms1_kgv' || pk.key === 'ms2_kgv') {
        if (pk.key === 'ms1_kgv' && homeIsMarketFav && odd1 && odd1 < 1.60) return null;
        if (pk.key === 'ms2_kgv' && awayIsMarketFav && odd2 && odd2 < 1.60) return null;
        if (an.lh < 1.15 || an.la < 1.05 || pk.p < 0.15) return null;
        tacticalMult = 1.32;
        contrarianType = 'Çift Taraflı Skor & Sürpriz Galibiyet';
        contrarianThesis = `[Yüksek Oranlı Kombinasyon]: Savunmaların açık verdiği eşleşmede hem karşılıklı gol hem taraf galibiyeti yüksek değer üretiyor.`;
    }
    else if (pk.key === 'ms1_ust25' || pk.key === 'ms2_ust25') {
        // Yalnızca sürpriz/dengeli tarafın (oran >= 2.50) üstlü galibiyetini kabul et
        if (hasRealOdd && pk.realOdd < 2.50) return null;
        if (tot < 2.85 || pk.p < 0.22 || pk.p > 0.45) return null;
        tacticalMult = 1.24;
        contrarianType = 'Yüksek Oranlı Tempo & Taraf Sürprizi';
        contrarianThesis = `[Yüksek Oranlı Tempo Sürprizi]: Piyasa beklentisinin üzerinde açık geçmeye aday maçta yüksek oranlı galibiyet + 2.5 Üst fırsatı.`;
    }
    // 6. İLK YARI KG VAR / 2. YARI KG VAR / 4-6 GOL / KESİN SKOR / GERÇEK KORNER & KArt ÜST
    else if (pk.key === 'iykgv') {
        if (an.lh < 1.18 || an.la < 1.08 || tot < 2.75 || pk.p < 0.16) return null;
        tacticalMult = 1.34;
        contrarianType = 'İlk Yarı Karşılıklı Gol Sürprizi';
        contrarianThesis = `[İlk Yarı Tempo Sürprizi]: İki takımın da ilk 45 dakikadaki yüksek gol yüzdesi İY KG Var seçeneğinde pozitif değer yaratıyor.`;
    } else if (pk.key === 'y2kgv') {
        if (an.lh < 1.18 || an.la < 1.08 || tot < 2.70 || pk.p < 0.22 || pk.p > 0.46) return null;
        tacticalMult = 1.28;
        contrarianType = '2. Yarı Karşılıklı Gol Sürprizi';
        contrarianThesis = `[2. Yarı Çözülme Sürprizi]: İkinci devrelerde savunma disiplini düşen iki takımda 2. Yarı KG Var yüksek değer taşıyor.`;
    } else if (pk.key === 'ust25_kgv' || pk.key === 'iyust15' || pk.key === 'tg46') {
        if (hasRealOdd && pk.realOdd < 2.25) return null;
        if (tot < 2.95 || pk.p < 0.24 || pk.p > 0.46) return null;
        tacticalMult = 1.25;
        contrarianType = 'Yüksek Baraj Gol Sürprizi';
        contrarianThesis = `[Yüksek Gol Barajı Sürprizi]: Hücum verimliliği piyasa barajının üzerinde olan iki takımın eşleşmesinde yüksek gol çarpanı.`;
    } else if (pk.group === 'korner') {
        if (!an.projections?.hasRealCorners) return null;
        if (pk.key !== 'korner_ust105' && pk.key !== 'korner_ust95' && pk.key !== 'iy_korner_ust45') return null;
        if (hasRealOdd && pk.realOdd < 2.05) return null;
        if (pk.p < 0.32 || pk.p > 0.62) return null;
        tacticalMult = 1.32;
        contrarianType = 'Gerçek Korner Ortalaması Destekli Sürpriz';
        contrarianThesis = `[Gerçek Korner Verisi Fırsatı]: Takımların son maçlardaki gerçek korner ortalamaları (${an.projections.realCornersHFor || '-'} ve ${an.projections.realCornersAFor || '-'}) yüksek korner barajını destekliyor.`;
    } else if (pk.group === 'kart') {
        if (pk.key !== 'kart_ust45' && pk.key !== 'kart_ust35') return null;
        if (hasRealOdd && pk.realOdd < 2.05) return null;
        if (pk.p < 0.30 || pk.p > 0.62) return null;
        tacticalMult = 1.26;
        contrarianType = 'Yüksek Kart & Sertlik Sürprizi';
        contrarianThesis = `[Yüksek Kart Beklentisi]: Sıralama stresi ve takımların son maç kart ortalamaları üst barajını öne çıkarıyor.`;
    } else if (pk.group === 'iyskor' || pk.group === 'msskor') {
        if (pk.p < 0.09 || pk.p > 0.28 || lift < 1.35) return null;
        tacticalMult = 1.38;
        contrarianType = 'Dixon-Coles Kesin Skor Sürprizi';
        contrarianThesis = `[Kesin Skor Yoğunlaşması]: Bağımsız olasılık matrisinde bu skor kümesi piyasa oranının üzerinde yoğunlaşıyor.`;
    } else {
        return null;
    }

    const dnaKey = pk.key.replace('/', '_');
    const dnaBoost = an.tactical?.boosts?.[dnaKey] || an.tactical?.boosts?.[pk.key] || 1.0;
    tacticalMult *= dnaBoost;

    // Gerçek Nesine oranı olan, oranı >= 2.15 olan ve EV > 0 (Value Bet) olan ters sonuçlara en yüksek ağırlığı ver
    const evMult = hasRealOdd && pk.ev > 0
        ? Math.min(2.15, 1.35 + pk.ev * 1.15)
        : hasRealOdd
            ? 0.95
            : 0.75;
    const oddBonus = hasRealOdd && pk.realOdd >= 2.40 ? 1.15 : 1.0;
    const mbsMult = m.mbs === 1 ? 1.14 : m.mbs === 2 ? 1.07 : 1.0;
    const trustMult = an.dataTrust && an.dataTrust.overallScore >= 70 ? 1.08 : 1.0;
    const score = Math.pow(pk.p, 0.58) * Math.min(lift, 3.4) * tacticalMult * evMult * oddBonus * mbsMult * trustMult;
    return { ...pk, lift, score, contrarianType, contrarianThesis, m, an };
}

// ---------------- Jack Kontrol 1, 3 & 4: Delta Yöntemi ile Kombine Güven Aralığı Hesaplayıcı ----------------
// J = prod(p_i) için Delta Yöntemi: Var(ln J) = sum((1 - p_i) / (n_eff * p_i))
// Z = 1.645 (%90 Güven Aralığı): J_low = J * exp(-Z * SE), J_high = J * exp(+Z * SE)
// Jack Kontrol 3: n_eff sabit 20 değil, modelin gerçek doğrulanmış test örneklem büyüklüğünden (N) türetilir
// ---------------- Jack Kontrol 1, 2, 3 & 4: Delta Yöntemi ile Kombine Güven Aralığı Hesaplayıcı ----------------
// J = prod(p_i) için Delta Yöntemi: Var(ln J) = sum((1 - p_i) / (n_eff * p_i))
// Z = 1.645 (%90 Güven Aralığı): J_low = J * exp(-Z * SE), J_high = J * exp(+Z * SE)
// Jack Kontrol 3 & 4: n_eff sabit 20 değil, modelin gerçek doğrulanmış test örneklem büyüklüğünden (N) türetilir.
// customTable parametresi ile test ortamında sentetik fixture verisi enjekte edilebilir.
function computeJointConfidenceInterval(probs, nEff = null, z = 1.645, customTable = null) {
    if (!Array.isArray(probs) || probs.length === 0) return { jointPct: null, lowPct: null, highPct: null, seLnJ: null, nEff: null, isEmpirical: false, verificationReason: 'Veri yok' };
    const validProbs = probs.map(Number).filter(p => isFinite(p) && p > 0.001 && p < 0.999);
    if (validProbs.length === 0) return { jointPct: null, lowPct: null, highPct: null, seLnJ: null, nEff: null, isEmpirical: false, verificationReason: 'Geçerli olasılık yok' };

    // Jack Kontrol 2: isEmpirical YALNIZCA modelin bağımsız test metrikleri getModelVerificationMetrics()
    // tarafından tam olarak doğrulandığında true olabilir!
    // Fonksiyona dışarıdan elle nEff verilmesi ampirik doğrulama sayılamaz (sadece teorik varyans simülasyonudur).
    const metrics = getModelVerificationMetrics(customTable);
    const isManualOverride = typeof nEff === 'number' && nEff > 0;
    const effectiveN = isManualOverride ? nEff : (metrics.nEff || 20);
    const isEmpirical = !isManualOverride && Boolean(metrics.isVerified);

    let verificationReason = '';
    if (isManualOverride) {
        verificationReason = `Manuel parametre N=${effectiveN} kullanıldı (teorik simülasyondur, ampirik doğrulama sayılmaz).`;
    } else {
        verificationReason = metrics.reason;
    }

    const joint = validProbs.reduce((acc, p) => acc * p, 1);
    const varLnJ = validProbs.reduce((sum, p) => sum + ((1 - p) / (effectiveN * p)), 0);
    const seLnJ = Math.sqrt(Math.max(0, varLnJ));

    const lowProb = Math.max(0.01, joint * Math.exp(-z * seLnJ));
    const highProb = Math.min(0.99, joint * Math.exp(z * seLnJ));

    return {
        jointPct: +(joint * 100).toFixed(1),
        lowPct: +(lowProb * 100).toFixed(1),
        highPct: +(highProb * 100).toFixed(1),
        seLnJ: +seLnJ.toFixed(4),
        nEff: effectiveN,
        isEmpirical,
        verificationReason
    };
}

// Jack Kontrol 4: Katı Model Doğrulama (En az 50 bağımsız maç, %70+ isabet, Brier Score <= 0.220, Log Loss <= 1.150)
// customTable ile izole test fixture'ı enjekte edilebilir, yerel disk dosyasına bağımlılık ortadan kalkar.
function getModelVerificationMetrics(customTable = null) {
    try {
        const table = customTable || loadPredictionTestTable();
        const records = (table && Array.isArray(table.walkForwardRecords)) ? table.walkForwardRecords : [];
        const resolved = records.filter(r => r && typeof r.won === 'boolean');
        const count = resolved.length;

        if (count < 50) {
            return {
                isVerified: false,
                sampleCount: count,
                hitRatePct: count > 0 ? +((resolved.filter(r => r.won).length / count) * 100).toFixed(1) : 0,
                brierScore: null,
                logLoss: null,
                nEff: Math.max(10, count),
                reason: `Yetersiz geçmiş örneklem (${count}/50 maç). Güvenilir doğrulama için en az 50 bağımsız maç gereklidir.`
            };
        }

        // Jack Kontrolü: 1. Bağımsız maç kontrolü (tekil matchId / id doğrulaması)
        // Tekrarlanan veya kopyalanmış maç kayıtları bağımsız örneklem sayılamaz!
        const uniqueMatchKeys = new Set(resolved.map(r => String(r.matchId || r.id || '')));
        if (uniqueMatchKeys.size < count) {
            return {
                isVerified: false,
                sampleCount: uniqueMatchKeys.size,
                hitRatePct: +((resolved.filter(r => r.won).length / count) * 100).toFixed(1),
                brierScore: null,
                logLoss: null,
                nEff: Math.max(10, uniqueMatchKeys.size),
                reason: `Örneklemde tekrarlanan maç kayıtları tespit edildi (${uniqueMatchKeys.size} tekil / ${count} toplam). Tüm maçlar bağımsız olmalıdır.`
            };
        }

        // Jack Kontrolü: 2. Eksiksiz metrik kontrolü (Tüm sonuçlanmış kayıtlarda geçerli Brier ve LogLoss zorunludur)
        const validBrierRecords = resolved.filter(r => typeof r.brier === 'number' && isFinite(r.brier));
        const validLogLossRecords = resolved.filter(r => typeof r.logLoss === 'number' && isFinite(r.logLoss));
        if (validBrierRecords.length !== count || validLogLossRecords.length !== count) {
            return {
                isVerified: false,
                sampleCount: count,
                hitRatePct: +((resolved.filter(r => r.won).length / count) * 100).toFixed(1),
                brierScore: null,
                logLoss: null,
                nEff: Math.max(10, count),
                reason: `Eksik kalibrasyon verisi: ${count} sonucun yalnızca Brier:${validBrierRecords.length}, LogLoss:${validLogLossRecords.length} adedinde metrik mevcut. Tüm kayıtlarda eksiksiz kalibrasyon puanı bulunmalıdır.`
            };
        }

        // Jack Kontrolü: 3. Zamanlama Bütünlüğü Kontrolü (Kickoff & Kayıt Zamanı Kontrolü)
        let missingTimingCount = 0;
        let timingViolations = 0;
        const invalidTimingRecords = [];

        for (const r of resolved) {
            const hasValidIso = Boolean(r.recordedBeforeKickoffAt && typeof r.recordedBeforeKickoffAt === 'string' && !isNaN(Date.parse(r.recordedBeforeKickoffAt)));
            const hasValidKickoff = Boolean(r.kickoff && !isNaN(Date.parse(r.kickoff)));
            if (!hasValidIso || !hasValidKickoff) {
                missingTimingCount++;
                invalidTimingRecords.push({ matchId: r.matchId || r.id, reason: 'Eksik veya geçersiz zaman damgası' });
            } else {
                const recTime = new Date(r.recordedBeforeKickoffAt).getTime();
                const kickTime = new Date(r.kickoff).getTime();
                if (recTime > kickTime) {
                    timingViolations++;
                    invalidTimingRecords.push({ matchId: r.matchId || r.id, reason: 'Kayıt zamanı kickoff sonrasında' });
                }
            }
        }

        if (missingTimingCount > 0 || timingViolations > 0) {
            return {
                isVerified: false,
                sampleCount: count,
                hitRatePct: +((resolved.filter(r => r.won).length / count) * 100).toFixed(1),
                brierScore: null,
                logLoss: null,
                nEff: Math.max(10, count),
                missingTimingCount,
                timingViolations,
                invalidTimingRecords,
                reason: `Eksik veya geçersiz zaman bilgisi: ${count} maçın ${missingTimingCount} tanesinde kayıt/kickoff zamanı eksik, ${timingViolations} tanesinde zamanlama ihlali tespit edildi. Yalnızca kickoff öncesinde kilitlenen tahminler kalibrasyona dahil edilebilir.`
            };
        }

        const hits = resolved.filter(r => r.won).length;
        const hitRatePct = +((hits / count) * 100).toFixed(1);

        const brierList = validBrierRecords.map(r => r.brier);
        const avgBrier = +(brierList.reduce((a, b) => a + b, 0) / brierList.length).toFixed(3);

        const logLossList = validLogLossRecords.map(r => r.logLoss);
        const avgLogLoss = +(logLossList.reduce((a, b) => a + b, 0) / logLossList.length).toFixed(3);

        const isVerified = (count >= 50) && (hitRatePct >= 70.0) && (avgBrier <= 0.220) && (avgLogLoss <= 1.150);

        // Jack Kuralı 2: Pazar bazında performansı ayır (Market Breakdown)
        const marketStats = {};
        for (const r of resolved) {
            const mKey = r.pickKey || (r.pick ? String(r.pick).toLowerCase() : 'other');
            if (!marketStats[mKey]) {
                marketStats[mKey] = { key: mKey, label: r.pick || mKey, hits: 0, total: 0, brierSum: 0, logLossSum: 0 };
            }
            marketStats[mKey].total++;
            if (r.won) marketStats[mKey].hits++;
            if (typeof r.brier === 'number' && isFinite(r.brier)) marketStats[mKey].brierSum += r.brier;
            if (typeof r.logLoss === 'number' && isFinite(r.logLoss)) marketStats[mKey].logLossSum += r.logLoss;
        }

        const marketBreakdown = {};
        for (const [k, v] of Object.entries(marketStats)) {
            marketBreakdown[k] = {
                key: v.key,
                label: v.label,
                hits: v.hits,
                total: v.total,
                ratePct: +( (v.hits / v.total) * 100 ).toFixed(1),
                brierScore: +(v.brierSum / v.total).toFixed(3),
                logLoss: +(v.logLossSum / v.total).toFixed(3)
            };
        }

        return {
            isVerified,
            sampleCount: count,
            hitRatePct,
            brierScore: avgBrier,
            logLoss: avgLogLoss,
            nEff: count,
            missingTimingCount: 0,
            timingViolations: 0,
            invalidTimingRecords: [],
            marketBreakdown,
            reason: isVerified
                ? `Model geçmiş ${count} bağımsız maçta başarıyla doğrulandı (İsabet: %${hitRatePct}, Brier: ${avgBrier}, LogLoss: ${avgLogLoss}, 0 zamanlama ihlali).`
                : `Model eşik şartlarını karşılamadı (İsabet: %${hitRatePct}/%70, Brier: ${avgBrier}/0.220, LogLoss: ${avgLogLoss}/1.150).`
        };
    } catch (_) {
        return { isVerified: false, sampleCount: 0, hitRatePct: 0, brierScore: null, logLoss: null, nEff: 20, reason: 'Test tablosu okunamadı.' };
    }
}

function isModelPerformanceVerified(customTable = null) {
    return getModelVerificationMetrics(customTable).isVerified;
}

function buildCoupons(items, model, opts = {}) {
    const bankoN = opts.bankoN || 4, surpN = opts.surpN || 5;
    const nowTimeStr = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' });

    // BANKO: Yalnızca A ve B kalitesindeki maçlar kabul edilir; C kalite maçlara ASLA geçilmez (Madde 3 & Jack Kontrolü)
    let cands = items.filter(it => qualifies(it.m, it.an, 'B') && isMainstreamMatch(it.m));
    if (cands.length < bankoN) {
        cands = items.filter(it => qualifies(it.m, it.an, 'B'));
    }

    const bankoPool = [];
    for (const it of cands) {
        // Jack Kontrol 3: Yalnızca güncel gerçek oranı olan ve oddsFresh = true olan tercihler bankoya girebilir!
        const allBankoPicks = picksOf(it.m, it.an).filter(p => BANKO_KEYS.includes(p.key) && p.hasRealOdd && p.oddsFresh);
        if (!allBankoPicks.length) continue;

        let playable = allBankoPicks.filter(p => p.p >= 0.66 && p.p <= 0.88);
        if (!playable.length) playable = allBankoPicks.filter(p => p.p >= 0.62 && p.p <= 0.91);
        if (!playable.length) playable = allBankoPicks;

        const mbsBonus = it.m.mbs === 1 ? 0.04 : it.m.mbs === 2 ? 0.02 : 0;
        const consistencyBonus = ((it.an.avgConsistency || 70) - 68) * 0.0018;
        const trustBonus = ((it.an.dataTrust?.overallScore || 65) - 65) * 0.001;
        playable.sort((a, b) => {
            const scoreA = a.p + (BANKO_PRIMARY_KEYS.has(a.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0) + 0.03;
            const scoreB = b.p + (BANKO_PRIMARY_KEYS.has(b.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0) + 0.03;
            return scoreB - scoreA;
        });

        const best = playable[0];
        if (best) {
            const rankScore = best.p + (BANKO_PRIMARY_KEYS.has(best.key) ? 0.05 : 0) + (it.an.quality === 'A' ? 0.04 : 0) + mbsBonus + consistencyBonus + trustBonus + 0.02;
            const modelVerified = isModelPerformanceVerified(opts.customTable || null);
            const isSparse = (it.an.nh < 5 || it.an.na < 5);
            let confidenceLevel;
            if (isSparse) {
                confidenceLevel = 'Düşük Güven (Yetersiz Geçmiş Verisi)';
            } else if (best.isValueBet) {
                confidenceLevel = `Value Bet (+%${best.evPct} EV • Kalibre Edildi)`;
            } else if (modelVerified && best.p >= 0.80) {
                confidenceLevel = 'Çok Yüksek Güven (Doğrulanmış Model)';
            } else if (modelVerified) {
                confidenceLevel = 'Yüksek Güven (Doğrulanmış Model)';
            } else if (best.p >= 0.80) {
                confidenceLevel = 'Yüksek Model Olasılığı (Tarihsel Doğrulama Bekliyor)';
            } else {
                confidenceLevel = 'Dengeli Model Olasılığı (Tarihsel Doğrulama Bekliyor)';
            }

            bankoPool.push({
                ...best,
                rankScore,
                confidenceLevel,
                riskLevel: best.p >= 0.80 ? 'Düşük Risk' : 'Kontrollü Düşük Risk',
                updatedAt: best.oddsUpdatedAt || null,
                rationale: generateRationale(best, it.m, it.an),
                m: it.m,
                an: it.an
            });
        }
    }
    bankoPool.sort((a, b) => b.rankScore - a.rankScore);

    // Pazar çeşitliliği: aynı tercih türünden en fazla 2 maç
    const banko = [];
    const bankoKeyCounts = {};
    for (const cand of bankoPool) {
        if (banko.length >= bankoN) break;
        const cnt = bankoKeyCounts[cand.key] || 0;
        if (cnt >= 2) continue;
        banko.push(cand);
        bankoKeyCounts[cand.key] = cnt + 1;
    }
    if (banko.length < bankoN) {
        for (const cand of bankoPool) {
            if (banko.length >= bankoN) break;
            if (!banko.some(x => x.matchId === cand.matchId)) banko.push(cand);
        }
    }

    // SÜRPRİZ: Favori takımları seçmek yerine yüksek oranlı, istatistiksel olarak anlamlı ters sonuçlar (Madde 6)
    const used = new Set(banko.map(b => b.matchId));
    let surpCands = items.filter(x => qualifies(x.m, x.an, 'B') && isMainstreamMatch(x.m));
    if (surpCands.length < surpN * 3) {
        surpCands = items.filter(x => qualifies(x.m, x.an, 'C') && isMainstreamMatch(x.m));
    }
    if (surpCands.length < surpN * 2) {
        surpCands = items.filter(x => qualifies(x.m, x.an, 'B'));
    }
    if (surpCands.length < surpN) {
        surpCands = items.filter(x => qualifies(x.m, x.an, 'C'));
    }

    const surpPool = [];
    for (const it of surpCands) {
        if (used.has(it.m.id)) continue;
        const bestByGroup = new Map();
        for (const pk of picksOf(it.m, it.an)) {
            const scored = scoreSurpriseCandidate(pk, it.m, it.an, model);
            if (!scored) continue;
            const prev = bestByGroup.get(scored.group);
            if (!prev || scored.score > prev.score) {
                bestByGroup.set(scored.group, scored);
            }
        }
        for (const cand of bestByGroup.values()) {
            const confLabel = cand.isValueBet
                ? `${cand.contrarianType || 'Ters Sonuç Value Bet'} (+%${cand.evPct} EV)`
                : cand.hasRealOdd
                    ? `${cand.contrarianType || 'Yüksek Oranlı Ters Seçim'} (Oran: ${cand.realOdd.toFixed(2)})`
                    : `${cand.contrarianType || 'İstatistiksel Ters Seçim'} (Oran Verisi Yok)`;
            surpPool.push({
                ...cand,
                confidenceLevel: confLabel,
                riskLevel: cand.p >= 0.30 ? 'Orta-Yüksek Sürpriz Risk (Ters Sonuç)' : 'Yüksek Sürpriz Risk (Sistem 3-4-5 Önerilir)',
                updatedAt: cand.oddsUpdatedAt || null,
                rationale: generateRationale(cand, cand.m, cand.an)
            });
        }
    }
    surpPool.sort((a, b) => b.score - a.score);

    const surprise = [];
    const usedSurpMatches = new Set();
    const usedSurpGroups = new Set();

    // 1. Geçiş: 5 maçın 5'i de FARKLI yüksek oranlı ters/sürpriz pazar grubundan olsun
    for (const cand of surpPool) {
        if (surprise.length >= surpN) break;
        if (used.has(cand.matchId) || usedSurpMatches.has(cand.matchId)) continue;
        if (usedSurpGroups.has(cand.group)) continue;
        surprise.push(cand);
        usedSurpMatches.add(cand.matchId);
        usedSurpGroups.add(cand.group);
    }

    // 2. Geçiş: Eğer 5 farklı grup dolmadıysa farklı anahtarlarla tamamla
    if (surprise.length < surpN) {
        const keyCounts = {};
        for (const s of surprise) keyCounts[s.key] = (keyCounts[s.key] || 0) + 1;
        for (const cand of surpPool) {
            if (surprise.length >= surpN) break;
            if (used.has(cand.matchId) || usedSurpMatches.has(cand.matchId)) continue;
            if ((keyCounts[cand.key] || 0) >= 1) continue;
            surprise.push(cand);
            usedSurpMatches.add(cand.matchId);
            keyCounts[cand.key] = (keyCounts[cand.key] || 0) + 1;
        }
    }

    const bankoProbs = banko.map(x => x.p);
    const bankoCI = computeJointConfidenceInterval(bankoProbs, null, 1.645, opts.customTable || null);
    const bankoConfidence = banko.length ? Math.round((banko.reduce((s, x) => s + x.p, 0) / banko.length) * 100) : null;
    const bankoJointConfidence = bankoCI.jointPct;
    const minBankoPct = banko.length ? Math.round(Math.min(...banko.map(x => x.p)) * 100) : null;
    const bankoVarLow = bankoCI.lowPct;
    const bankoVarHigh = bankoCI.highPct;

    const surpProbs = surprise.map(x => x.p);
    const surpCI = computeJointConfidenceInterval(surpProbs, null, 1.645, opts.customTable || null);
    const surpAvgLift = surprise.length ? (surprise.reduce((s, x) => s + x.lift, 0) / surprise.length).toFixed(1) : null;
    const surpJointConfidence = surpCI.jointPct;
    const surpValueBetCount = surprise.filter(x => x.isValueBet).length;
    const surpAvgOdd = surprise.filter(x => x.hasRealOdd).length
        ? +(surprise.filter(x => x.hasRealOdd).reduce((s, x) => s + x.realOdd, 0) / surprise.filter(x => x.hasRealOdd).length).toFixed(2)
        : null;

    // Gerçek Sistem 3-4-5 Kuponu (16 Kolon, simülasyon yok, oynanabilir kolon listesi)
    const system345 = (surprise.length === 5) ? buildSystem345(surprise, opts.minBetAmount || 50) : null;

    // Jack'in Kontrol 1, 3 & 4 Tespiti: Kombine olasılığı bağımsızlık varsayımına dayanır; Delta Yöntemi ile asimptotik varyans aralığı hesaplanır
    const lastBankoOddsUpdate = banko.find(b => b.oddsUpdatedAt)?.oddsUpdatedAt || 'Bilinmiyor';
    const lastSurpOddsUpdate = surprise.find(s => s.oddsUpdatedAt)?.oddsUpdatedAt || 'Bilinmiyor';

    let bankoCiNote = bankoCI.isEmpirical
        ? `Delta Yöntemi asimptotik %90 güven aralığı [%${bankoVarLow} - %${bankoVarHigh}] seviyesindedir (${(bankoCI.verificationReason || '').replace(/\.$/, '')}; maçların korelasyonsuzluk varsayımına dayalı teorik aralıktır, kesin kazanç garantisi taşımaz).`
        : `Delta Yöntemi teorik %90 güven aralığı [%${bankoVarLow} - %${bankoVarHigh}] seviyesindedir (Doğrulanamadı: ${(bankoCI.verificationReason || '').replace(/\.$/, '')}; maçların bağımsızlık varsayımına dayalı ön simülasyondur, kesin başarı garantisi taşımaz).`;

    const bankoInstruction = banko.length
        ? `Bu ${banko.length} maçın tekil ortalama güveni %${bankoConfidence} (en düşük %${minBankoPct}). Maçların bağımsızlık varsayımı ile birlikte gelme olasılığı (Kombine: p1×p2×p3×p4) %${bankoJointConfidence} olup, ${bankoCiNote} Son veri çekilme zamanı (Son oran kontrolü: ${lastBankoOddsUpdate}).`
        : 'Şu an bültende kriterlere uygun (A/B kalite, güncel gerçek oranlı) banko maç bulunamadı.';

    const sysTxt = system345
        ? ` | [GERÇEK SİSTEM 3-4-5: 16 Kolon (10 Üçlü, 5 Dörtlü, 1 Beşli) • Nesine Taban Tutarı: 50 TL • Kolon başı 50 TL: 800 TL / Kupon tabanı 50 TL: Kolon başı ~3.13 TL. Maçlar sonuçlanmadan sanal/tahmini kazanç hesaplanmaz.]`
        : '';

    let surpCiNote = surpCI.isEmpirical
        ? `[Delta CI: %${surpCI.lowPct} - %${surpCI.highPct}, ${surpCI.verificationReason} (bağımsızlık varsayımı)]`
        : `[Delta CI: %${surpCI.lowPct} - %${surpCI.highPct}, doğrulanamadı: ${surpCI.verificationReason}]`;

    const surpInstruction = surprise.length
        ? `Piyasa favorileri elenerek yüksek oranlı, istatistiksel olarak anlamlı ters sonuçlardan seçilen ${surprise.length} maçın sıklık çarpanı ortalama ${surpAvgLift}x${surpAvgOdd ? ` (Ortalama Gerçek Nesine Oranı: ${surpAvgOdd})` : ''} seviyesindedir (${surpValueBetCount}/${surprise.length} seçimde gerçek Nesine oranı ile pozitif EV / Value Bet doğrulandı; 5'li düz kombine olasılığı %${surpJointConfidence} ${surpCiNote} olduğu için Sistem 3-4-5 önerilir).${sysTxt} Son veri çekilme zamanı (Son oran kontrolü: ${lastSurpOddsUpdate}).`
        : 'Şu an bültende kriterlere uygun yaklaşan sürpriz maç bulunamadı.';

    return {
        banko: {
            title: 'Günün Banko Kuponu',
            type: 'banko',
            strategy: 'Bağımsız Derin Analiz • Yüksek Güven Kombinesi',
            instruction: bankoInstruction,
            confidence: bankoConfidence,
            jointConfidence: bankoJointConfidence,
            jointVarianceBand: { low: bankoVarLow, high: bankoVarHigh },
            updatedAt: lastBankoOddsUpdate,
            matches: banko
        },
        surprise: {
            title: 'Sürpriz Kupon',
            type: 'surprise',
            strategy: 'İstatistiksel Ters Sonuçlar (Underdog & Yüksek Oran Value Bet)',
            instruction: surpInstruction,
            avgLift: surpAvgLift,
            avgOdd: surpAvgOdd,
            jointConfidence: surpJointConfidence,
            jointVarianceBand: { low: surpCI.lowPct, high: surpCI.highPct },
            valueBetCount: surpValueBetCount,
            system345,
            updatedAt: lastSurpOddsUpdate,
            matches: surprise
        }
    };
}

// ---------------- Gerçek Sistem 3-4-5 Kolon Üretici (16 Kolon, Sanal Simülasyon Yok) ----------------
function buildSystem345(matches, minBetAmount = 50) {
    if (!Array.isArray(matches) || matches.length !== 5) return null;

    const defaultMinBet = 50;
    const effectiveMinBet = (typeof minBetAmount === 'number' && minBetAmount > 0) ? minBetAmount : defaultMinBet;

    const comb3 = [];
    for (let i = 0; i < 5; i++) {
        for (let j = i + 1; j < 5; j++) {
            for (let k = j + 1; k < 5; k++) {
                comb3.push([i, j, k]);
            }
        }
    }

    const comb4 = [];
    for (let i = 0; i < 5; i++) {
        for (let j = i + 1; j < 5; j++) {
            for (let k = j + 1; k < 5; k++) {
                for (let l = k + 1; l < 5; l++) {
                    comb4.push([i, j, k, l]);
                }
            }
        }
    }

    const mapMatch = (m, idx) => ({
        index: idx + 1,
        matchId: m.matchId || m.id || m.m?.id || (idx + 1),
        home: m.home || m.m?.home || 'Ev Sahibi',
        away: m.away || m.m?.away || 'Deplasman',
        league: m.league?.full || m.league?.name || m.m?.league?.full || '',
        label: m.label || m.key || 'Tercih',
        key: m.key,
        p: m.p,
        hasRealOdd: Boolean(m.hasRealOdd),
        odd: (m.hasRealOdd && typeof m.realOdd === 'number') ? m.realOdd : null,
        oddsFresh: Boolean(m.oddsFresh),
        date: m.m?.date || m.date || null,
        time: m.m?.time || m.time || null
    });

    const mappedMatches = matches.map(mapMatch);

    const columns = [];
    let colIdx = 1;

    // Her maç için hem hasRealOdd hem oddsFresh zorunludur (Madde 4)
    const isOddValidAndFresh = (m) => Boolean(m.hasRealOdd && m.oddsFresh && typeof m.odd === 'number' && m.odd > 1.0);

    // 10 Adet Üçlü Kolon
    for (const c of comb3) {
        const colMatches = [mappedMatches[c[0]], mappedMatches[c[1]], mappedMatches[c[2]]];
        const allFreshRealOdds = colMatches.every(isOddValidAndFresh);
        const totalOdd = allFreshRealOdds
            ? +(colMatches[0].odd * colMatches[1].odd * colMatches[2].odd).toFixed(2)
            : null;
        columns.push({
            columnIndex: colIdx++,
            type: '3-lü Kombinasyon',
            systemType: 3,
            matchIndices: [c[0] + 1, c[1] + 1, c[2] + 1],
            matches: colMatches,
            totalOdd
        });
    }

    // 5 Adet Dörtlü Kolon
    for (const c of comb4) {
        const colMatches = [mappedMatches[c[0]], mappedMatches[c[1]], mappedMatches[c[2]], mappedMatches[c[3]]];
        const allFreshRealOdds = colMatches.every(isOddValidAndFresh);
        const totalOdd = allFreshRealOdds
            ? +(colMatches[0].odd * colMatches[1].odd * colMatches[2].odd * colMatches[3].odd).toFixed(2)
            : null;
        columns.push({
            columnIndex: colIdx++,
            type: '4-lü Kombinasyon',
            systemType: 4,
            matchIndices: [c[0] + 1, c[1] + 1, c[2] + 1, c[3] + 1],
            matches: colMatches,
            totalOdd
        });
    }

    // 1 Adet Beşli Kolon
    {
        const colMatches = mappedMatches;
        const allFreshRealOdds = colMatches.every(isOddValidAndFresh);
        const totalOdd = allFreshRealOdds
            ? +(colMatches.reduce((acc, m) => acc * m.odd, 1)).toFixed(2)
            : null;
        columns.push({
            columnIndex: colIdx++,
            type: '5-li Kombinasyon',
            systemType: 5,
            matchIndices: [1, 2, 3, 4, 5],
            matches: colMatches,
            totalOdd
        });
    }

    const allMatchesHaveRealOdds = mappedMatches.every(isOddValidAndFresh);

    // Jack Kontrol 3: Yuvarlama nedeniyle toplam tutar ile kolon tutarları çelişmemelidir.
    // 50 TL / 16 = 3.125 TL net. 16 * 3.125 = 50.00 TL (sıfır kuruş çelişkisi).
    const exactPerColumnForTotal = +(effectiveMinBet / 16).toFixed(4); // 3.125
    const exactSumCouponTotal = +(16 * exactPerColumnForTotal).toFixed(2); // 50.00
    const exactSumColumnStake = +(16 * effectiveMinBet).toFixed(2); // 800.00
    const roundedDisplay = +(effectiveMinBet / 16).toFixed(2); // 3.13

    return {
        systemName: 'Sistem 3-4-5',
        totalColumns: 16,
        tripleCount: 10,
        quadrupleCount: 5,
        quintupleCount: 1,
        matches: mappedMatches,
        allMatchesHaveRealOdds,
        columns,
        costAnalysis: {
            totalColumns: 16,
            minBetAmount: effectiveMinBet,
            isVerifiedByNesineScreen: false,
            unverifiedNotice: 'Gerçek Nesine kupon onay ekranındaki Misli / Kolon Bedeli teyit edilmeden kesin toplam maliyet veya ödeme belirlenemez.',
            couponTotalRule: {
                scenarioName: 'Kupon Tabanı Kuralı',
                totalCost: effectiveMinBet,
                costPerColumn: exactPerColumnForTotal,
                exactCostPerColumn: exactPerColumnForTotal,
                roundedDisplay,
                sumOfColumns: exactSumCouponTotal,
                roundingDiscrepancy: +(exactSumCouponTotal - effectiveMinBet).toFixed(4),
                isPlayableAmount: false,
                playableStatus: 'Oynanamaz (Teorik Bölüm)',
                playableNote: '3.125 TL teorik bir matematiksel bölümdür (50 TL / 16 Kolon). Nesine ve İddaa sisteminde 1 kuruşun altında (0.005 TL) yarım kuruşlu kolon bahsi oynanamaz. Kupon onay ekranında yalnızca tam kuruş / tam misli tutarları geçerlidir.',
                label: `Kupon Tabanı ${effectiveMinBet} TL (16 kolon için kolon başı net ${exactPerColumnForTotal} TL - Teorik Bölüm, Oynanamaz)`,
                description: `Kupon taban tutarı ${effectiveMinBet} TL uygulandığında 16 kolonun her birine net ${exactPerColumnForTotal} TL teorik pay düşer; 16 kolonun toplamı (${exactSumCouponTotal} TL) kupon taban tutarıyla birebir uyuşur ancak tekil kolon olarak oynanamaz.`
            },
            columnStakeRule: {
                scenarioName: 'Kolon Başı Tutar Kuralı',
                totalCost: exactSumColumnStake,
                costPerColumn: effectiveMinBet,
                sumOfColumns: exactSumColumnStake,
                roundingDiscrepancy: 0,
                isPlayableAmount: true,
                playableStatus: 'Oynanabilir (Misli / Kolon Tutarı)',
                playableNote: 'Nesine kupon onay ekranında her kolon için tam tutar belirlendiğinde uygulanabilen geçerli bahis kuralıdır.',
                label: `Kolon Başı ${effectiveMinBet} TL (16 kolon için toplam ${exactSumColumnStake} TL - Oynanabilir)`,
                description: `Kolon başına ${effectiveMinBet} TL oynandığında 16 kolonun toplam maliyeti tam ${exactSumColumnStake} TL eder.`
            },
            couponTotalScenario: {
                scenarioName: 'Kupon Tabanı Kuralı',
                totalCost: effectiveMinBet,
                costPerColumn: exactPerColumnForTotal,
                exactCostPerColumn: exactPerColumnForTotal,
                roundedDisplay,
                sumOfColumns: exactSumCouponTotal,
                roundingDiscrepancy: +(exactSumCouponTotal - effectiveMinBet).toFixed(4),
                isPlayableAmount: false,
                playableStatus: 'Oynanamaz (Teorik Bölüm)',
                playableNote: '3.125 TL teorik matematiksel bir bölümdür (50 TL / 16 Kolon). Nesine ve İddaa sisteminde 1 kuruşun altında (0.005 TL) yarım kuruşlu kolon bahsi oynanamaz. Kupon onay ekranında yalnızca tam kuruş / tam misli tutarları geçerlidir.',
                label: `Kupon Tabanı ${effectiveMinBet} TL (16 kolon için kolon başı net ${exactPerColumnForTotal} TL - Teorik Bölüm, Oynanamaz)`
            },
            columnStakeScenario: {
                scenarioName: 'Kolon Başı Tutar Kuralı',
                totalCost: exactSumColumnStake,
                costPerColumn: effectiveMinBet,
                sumOfColumns: exactSumColumnStake,
                roundingDiscrepancy: 0,
                isPlayableAmount: true,
                playableStatus: 'Oynanabilir (Misli / Kolon Tutarı)',
                playableNote: 'Nesine kupon onay ekranında her kolon için tam tutar belirlendiğinde uygulanabilen geçerli bahis kuralıdır.',
                label: `Kolon Başı ${effectiveMinBet} TL (16 kolon için toplam ${exactSumColumnStake} TL - Oynanabilir)`
            },
            note: `Nesine'de tek bir doğrulanmış taban kuralı varsayılmamalıdır. Kolon başı ${effectiveMinBet} TL oynandığında toplam maliyet ${exactSumColumnStake} TL (oynanabilir); kupon toplamı minimum ${effectiveMinBet} TL tabanıyla oynandığında kolon başı net ${exactPerColumnForTotal} TL (16 x ${exactPerColumnForTotal} = ${exactSumCouponTotal} TL) olmaktadır ancak 3.125 TL tek başına oynanabilir bir tutar değildir. Gerçek kupon bedeli Nesine kupon onay ekranındaki seçiminize göre doğrulanmalıdır.`
        },
        settlement: {
            isSettled: false,
            message: 'Maçlar tamamlanmadan gerçek kazanç veya ödeme hesaplanamaz. Maçlar bittikten sonra gerçek oranlar ve yatırılan tutarla kesin ödeme hesaplanır.'
        }
    };
}

// ---------------- Jack Kontrol 4: Seçilen Bahis Türüne Göre Matematiksel Sonuçlandırma ----------------
function evaluateBetOutcome(marketKey, score, htScore = null, stats = null) {
    if (!marketKey || !score || typeof score.h !== 'number' || typeof score.a !== 'number') {
        return null; // Skor yoksa değerlendirilemez
    }

    const h = Number(score.h);
    const a = Number(score.a);
    const totalGoals = h + a;

    const htH = (htScore && typeof htScore.h === 'number') ? Number(htScore.h) : null;
    const htA = (htScore && typeof htScore.a === 'number') ? Number(htScore.a) : null;
    const htGoals = (htH !== null && htA !== null) ? (htH + htA) : null;

    const normKey = String(marketKey).toLowerCase().trim();

    switch (normKey) {
        // Maç Sonucu (1X2)
        case 'ms1':
        case 'h':
            return h > a;
        case 'msx':
        case 'd':
            return h === a;
        case 'ms2':
        case 'a':
            return h < a;

        // Çifte Şans
        case 'dc1x':
            return h >= a;
        case 'dc12':
            return h !== a;
        case 'dcx2':
            return h <= a;

        // Toplam Gol Alt / Üst
        case 'alt05':
            return totalGoals < 0.5;
        case 'ust05':
            return totalGoals > 0.5;
        case 'alt15':
            return totalGoals < 1.5;
        case 'ust15':
            return totalGoals > 1.5;
        case 'alt25':
            return totalGoals < 2.5;
        case 'ust25':
            return totalGoals > 2.5;
        case 'alt35':
            return totalGoals < 3.5;
        case 'ust35':
            return totalGoals > 3.5;
        case 'alt45':
            return totalGoals < 4.5;
        case 'ust45':
            return totalGoals > 4.5;

        // Karşılıklı Gol (KG)
        case 'kgv':
            return h > 0 && a > 0;
        case 'kgy':
            return h === 0 || a === 0;

        // İlk Yarı Sonucu (İY 1X2)
        case 'iy1':
            return htH !== null && htA !== null ? htH > htA : null;
        case 'iyx':
            return htH !== null && htA !== null ? htH === htA : null;
        case 'iy2':
            return htH !== null && htA !== null ? htH < htA : null;

        // İlk Yarı Gol Alt / Üst
        case 'iyalt05':
            return htGoals !== null ? htGoals < 0.5 : null;
        case 'iyust05':
            return htGoals !== null ? htGoals > 0.5 : null;
        case 'iyalt15':
            return htGoals !== null ? htGoals < 1.5 : null;
        case 'iyust15':
            return htGoals !== null ? htGoals > 1.5 : null;

        // Ev Sahibi Gol Alt / Üst
        case 'ev_alt05':
            return h < 0.5;
        case 'ev_ust05':
            return h > 0.5;
        case 'ev_alt15':
            return h < 1.5;
        case 'ev_ust15':
            return h > 1.5;

        // Deplasman Gol Alt / Üst
        case 'dep_alt05':
            return a < 0.5;
        case 'dep_ust05':
            return a > 0.5;
        case 'dep_alt15':
            return a < 1.5;
        case 'dep_ust15':
            return a > 1.5;

        // Toplam Gol Aralığı
        case 'tg01':
            return totalGoals <= 1;
        case 'tg23':
            return totalGoals >= 2 && totalGoals <= 3;
        case 'tg46':
            return totalGoals >= 4 && totalGoals <= 6;
        case 'tg7p':
            return totalGoals >= 7;

        // Kombine Pazarlar
        case 'ms1_kgv':
            return h > a && h > 0 && a > 0;
        case 'ms2_kgv':
            return h < a && h > 0 && a > 0;
        case 'msx_kgv':
            return h === a && h > 0 && a > 0;
        case 'ms1_ust25':
            return h > a && totalGoals > 2.5;
        case 'ms2_ust25':
            return h < a && totalGoals > 2.5;
        case 'ust25_kgv':
            return totalGoals > 2.5 && h > 0 && a > 0;

        // İstatistiksel Pazarlar (Korner & Kart)
        case 'korner_ust95':
            return (stats && typeof stats.corners === 'number') ? stats.corners > 9.5 : null;
        case 'kart_ust35':
            return (stats && typeof stats.cards === 'number') ? stats.cards > 3.5 : null;

        default:
            return null; // Bilinmeyen pazar için null döner, caller fallback'i yönetir
    }
}

// ---------------- Jack Kontrol 2: Oynanan Nesine Kupon Kayıt & Doğrulama Katmanı (Upstash Redis Entegrasyonu) ----------------
const PLACED_COUPONS_FILE = path.join(__dirname, '.cache', 'placed_coupons.json');
const UPSTASH_COUPONS_KEY = 'yusuf_ai:placed_coupons';

let _upstashMockTransport = null;

function setUpstashTransportForTesting(mockFn) {
    _upstashMockTransport = mockFn;
}

function executeUpstashCommandSync(command, args = []) {
    if (typeof _upstashMockTransport === 'function') {
        return _upstashMockTransport(command, args);
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        return { ok: false, error: 'Upstash environment variables not configured' };
    }

    try {
        const cleanUrl = url.replace(/\/+$/, '');
        const payload = JSON.stringify([command, ...args]);
        const res = spawnSync('curl', [
            '-s',
            '-X', 'POST',
            cleanUrl,
            '-H', `Authorization: Bearer ${token}`,
            '-H', 'Content-Type: application/json',
            '-d', payload,
            '--max-time', '4'
        ], { encoding: 'utf8', timeout: 5000 });

        if (res.error) {
            return { ok: false, error: res.error.message };
        }
        if (res.status !== 0) {
            return { ok: false, error: `curl status ${res.status}: ${(res.stderr || '').trim()}` };
        }

        const parsed = JSON.parse(res.stdout || '{}');
        if (parsed.error) {
            return { ok: false, error: parsed.error };
        }
        return { ok: true, result: parsed.result };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function executeUpstashCommandAsync(command, args = []) {
    if (typeof _upstashMockTransport === 'function') {
        return _upstashMockTransport(command, args);
    }
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        return { ok: false, error: 'Upstash environment variables not configured' };
    }

    try {
        const cleanUrl = url.replace(/\/+$/, '');
        const res = await fetch(cleanUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([command, ...args]),
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) {
            const errText = await res.text();
            return { ok: false, error: `HTTP ${res.status}: ${errText}` };
        }
        const json = await res.json();
        if (json.error) {
            return { ok: false, error: json.error };
        }
        return { ok: true, result: json.result };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function loadPlacedCoupons() {
    const hasUpstashEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    if (hasUpstashEnv) {
        const redisRes = executeUpstashCommandSync('GET', [UPSTASH_COUPONS_KEY]);
        if (!redisRes || !redisRes.ok) {
            const errDetail = redisRes && redisRes.error ? redisRes.error : 'Redis yanıt vermedi veya bağlantı başarısız';
            throw new Error(`Upstash Redis GET başarısız oldu: ${errDetail}`);
        }
        if (redisRes.result === null || redisRes.result === undefined) {
            return [];
        }
        try {
            const parsed = typeof redisRes.result === 'string' ? JSON.parse(redisRes.result) : redisRes.result;
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.coupons)) return parsed.coupons;
            return [];
        } catch (err) {
            throw new Error(`Upstash Redis verisi bozuk JSON: ${err.message}`);
        }
    }

    try {
        if (fs.existsSync(PLACED_COUPONS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(PLACED_COUPONS_FILE, 'utf8'));
            if (Array.isArray(raw)) return raw;
            if (raw && typeof raw === 'object' && Array.isArray(raw.coupons)) return raw.coupons;
        }
    } catch (_) {}
    return [];
}

let _lastSavePlacedResult = null;

function savePlacedCoupons(coupons) {
    let localSuccess = false;
    try {
        const dir = path.dirname(PLACED_COUPONS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PLACED_COUPONS_FILE, JSON.stringify({ coupons, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        localSuccess = true;
    } catch (_) {
        localSuccess = false;
    }

    const hasUpstashEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    let redisSuccess = false;
    let redisError = null;

    if (hasUpstashEnv) {
        const redisRes = executeUpstashCommandSync('SET', [UPSTASH_COUPONS_KEY, JSON.stringify(coupons)]);
        if (redisRes && redisRes.ok && redisRes.result === 'OK') {
            redisSuccess = true;
        } else {
            redisError = redisRes ? (redisRes.error || (redisRes.result ? `Beklenmeyen Redis SET sonucu: ${redisRes.result}` : 'Redis yanıt vermedi')) : 'Redis yanıt vermedi';
        }
    }

    const isPersistent = redisSuccess;
    const storageBackend = redisSuccess ? 'upstash_redis' : 'local_ephemeral_file';

    let storageWarning = null;
    if (!isPersistent) {
        if (hasUpstashEnv) {
            storageWarning = `UYARI: Upstash Redis bağlantısı başarısız oldu (${redisError || 'Bilinmeyen hata'}). Kupon yalnızca yerel geçici diskte (.cache/placed_coupons.json) tutulmaktadır ve Render ortamında yeniden başlatma sonrasında silinecektir.`;
        } else {
            storageWarning = 'UYARI: Upstash Redis bağlantısı henüz yapılandırılmadı. Bu kupon yalnızca yerel geçici diskte (.cache/placed_coupons.json) tutulmaktadır ve Render ortamında yeniden başlatma (restart) veya yeni dağıtım (deploy) sonrasında silinecektir. Kalıcı saklama için UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN tanımlanmalıdır.';
        }
    }

    const overallSuccess = localSuccess || redisSuccess;
    _lastSavePlacedResult = {
        ok: overallSuccess,
        isPersistent,
        storageBackend,
        storageWarning,
        redisError
    };

    return overallSuccess;
}

function recordPlacedCoupon(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('Geçersiz kupon verisi');
    }

    const nesineRefCode = String(input.nesineRefCode || input.receiptId || input.couponId || '').trim();
    if (!nesineRefCode) {
        throw new Error('Gerçek Nesine kupon referans kodu (barkod / kupon no) zorunludur');
    }

    if (input.totalCost === undefined || input.totalCost === null) {
        throw new Error('Kupon toplam tutarı (totalCost) açıkça girilmelidir.');
    }
    const totalCost = Number(input.totalCost);
    if (!isFinite(totalCost) || totalCost <= 0) {
        throw new Error('Kupon toplam tutarı pozitif bir sayı olmalıdır');
    }

    // Jack Kuralı 2: Gerçek oynanan kolon tutarı açıkça girilmeden totalCost / 16 üzerinden otomatik gerçek tutar üretilmesin
    if (input.costPerColumn === undefined || input.costPerColumn === null) {
        throw new Error('Gerçek oynanan kolon başına tutar (costPerColumn) açıkça girilmelidir; totalCost / 16 üzerinden otomatik türetilemez.');
    }
    const costPerColumn = Number(input.costPerColumn);
    if (!isFinite(costPerColumn) || costPerColumn <= 0) {
        throw new Error('Kolon başına tutar geçerli ve pozitif bir sayı olmalıdır');
    }

    // Jack Kuralı 3: Para hesaplamalarını kuruş bazında tam sayı kullanarak yap. 0.01 TL toleransla tutarsız kupon kabul etme.
    const totalCostCents = Math.round(totalCost * 100);
    const costPerColumnCents = Math.round(costPerColumn * 100);
    if (!Number.isInteger(totalCostCents) || totalCostCents <= 0 || !Number.isInteger(costPerColumnCents) || costPerColumnCents <= 0) {
        throw new Error('Kupon toplam tutarı ve kolon başı tutar geçerli pozitif para birimi olmalıdır.');
    }
    const expectedTotalCents = 16 * costPerColumnCents;
    if (expectedTotalCents !== totalCostCents) {
        const expectedTotalTL = (expectedTotalCents / 100).toFixed(2);
        const actualTotalTL = (totalCostCents / 100).toFixed(2);
        throw new Error(`Kuruş bazında tutarsızlık ve yuvarlama çelişkisi: 16 kolon x ${(costPerColumnCents / 100).toFixed(2)} TL = ${expectedTotalTL} TL eder, fakat kupon toplamı ${actualTotalTL} TL olarak girilmiş. 0.01 TL toleransla tutarsız kupon kabul edilemez.`);
    }

    // Jack Kuralı 1: recordPlacedCoupon() tam olarak 5 maç kabul etsin. 4 veya 6+ maç reddedilsin.
    const matches = Array.isArray(input.matches) ? input.matches : [];
    if (matches.length !== 5) {
        throw new Error(`Sistem 3-4-5 kupon kaydı için tam olarak 5 maç gereklidir (Girilen maç sayısı: ${matches.length}).`);
    }

    // Jack Kuralı 1: Eksik/fallback matchId kullanılmasın.
    const verifiedMatches = matches.map((m, idx) => {
        const matchId = (m.matchId !== undefined && m.matchId !== null && String(m.matchId).trim() !== '')
            ? m.matchId
            : ((m.id !== undefined && m.id !== null && String(m.id).trim() !== '') ? m.id : null);
        if (matchId === null) {
            throw new Error(`Maç #${idx + 1} için geçerli matchId bilgisi zorunludur; eksik veya varsayılan matchId kullanılamaz.`);
        }

        // Jack Kuralı 1: m.odd fallback'i tamamen kaldırıldı. Yalnızca açıkça girilmiş placedOdd kabul edilir.
        if (m.placedOdd === undefined || m.placedOdd === null) {
            throw new Error(`Maç #${matchId} için onaylanan gerçek Nesine oranı (placedOdd) zorunludur; öneri oranı veya m.odd kabul edilemez.`);
        }
        const placedOdd = Number(m.placedOdd);
        if (!isFinite(placedOdd) || placedOdd <= 1.0) {
            throw new Error(`Maç #${matchId} için onaylanan gerçek Nesine oranı geçersiz`);
        }
        const key = String(m.key || '').trim().toLowerCase();
        if (!key) {
            throw new Error(`Maç #${matchId} için bahis tercih anahtarı (key) zorunludur.`);
        }

        return {
            matchId,
            home: m.home || '',
            away: m.away || '',
            key,
            label: m.label || '',
            placedOdd
        };
    });

    const now = new Date();
    const placedDate = input.placedDate || now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    const placedTime = input.placedTime || now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' });
    const placedAt = input.placedAt || `${placedDate}T${placedTime}:00+03:00`;

    const record = {
        id: `placed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        nesineRefCode,
        totalCost: totalCostCents / 100,
        costPerColumn: costPerColumnCents / 100,
        totalCostCents,
        costPerColumnCents,
        placedDate,
        placedTime,
        placedAt,
        matches: verifiedMatches,
        isVerified: true,
        createdAt: new Date().toISOString()
    };

    const existing = loadPlacedCoupons();
    const filtered = existing.filter(c => c.nesineRefCode !== nesineRefCode);
    filtered.push(record);

    const saveSuccess = savePlacedCoupons(filtered);
    if (!saveSuccess) {
        throw new Error('Kupon dosyaya kaydedilemedi (dosya yazma / disk hatası).');
    }

    const saveMeta = _lastSavePlacedResult || {};
    record.isPersistent = Boolean(saveMeta.isPersistent);
    record.storageBackend = saveMeta.storageBackend || 'local_ephemeral_file';
    record.storageWarning = saveMeta.storageWarning || null;

    return record;
}

function getPlacedCoupon(refCode) {
    if (!refCode) return null;
    const all = loadPlacedCoupons();
    return all.find(c => c.nesineRefCode === refCode || c.id === refCode) || null;
}

// ---------------- Gerçek Maç Sonuçlarıyla Kesin Ödeme Hesaplayıcı (Sanal/Varsayımsal Getiri Yok) ----------------
function settleSystem345(system345, results, actualStake = {}) {
    if (!system345 || !Array.isArray(system345.columns)) {
        return { isSettled: false, error: 'Geçersiz Sistem 3-4-5 nesnesi' };
    }

    // Jack Kontrol 2 & 3: Kullanıcının gerçek oynanan onaylı kupon kaydı (placedCoupon veya nesineRefCode)
    const placedCoupon = actualStake.placedCoupon
        || (actualStake.nesineRefCode ? getPlacedCoupon(actualStake.nesineRefCode) : null);

    // Jack Kuralı 5: Kuponun kayıtlı 5 maçının ID ve market anahtarları, sonuçlandırılan system345.matches ile birebir eşleşsin.
    if (placedCoupon) {
        if (!Array.isArray(placedCoupon.matches) || placedCoupon.matches.length !== system345.matches.length) {
            return {
                isSettled: false,
                settlementStatus: 'Kupon maçları uyuşmuyor',
                reason: `Kayıtlı kupondaki maç adedi (${placedCoupon?.matches?.length || 0}) ile sistem kuponu maç adedi (${system345.matches.length}) uyuşmuyor.`,
                settledPayout: null
            };
        }

        for (const sm of system345.matches) {
            const smKey = String(sm.key || '').trim().toLowerCase();
            const pm = placedCoupon.matches.find(m => String(m.matchId) === String(sm.matchId));
            if (!pm) {
                return {
                    isSettled: false,
                    settlementStatus: 'Kupon maçları uyuşmuyor',
                    reason: `Sistem kuponundaki #${sm.matchId} (${sm.home} - ${sm.away}) maçı kayıtlı kuponda bulunamadı. Başka kuponun verileri kullanılamaz.`,
                    settledPayout: null
                };
            }
            const pmKey = String(pm.key || '').trim().toLowerCase();
            if (pmKey !== smKey) {
                return {
                    isSettled: false,
                    settlementStatus: 'Kupon maçları uyuşmuyor',
                    reason: `Maç #${sm.matchId} için kayıtlı kupondaki bahis tercihi ('${pm.key}') ile sistem kuponundaki tercih ('${sm.key}') uyuşmuyor. Başka kuponun oranı veya sonucu yanlışlıkla kullanılamaz.`,
                    settledPayout: null
                };
            }
        }
    }

    // Jack Kuralı 2: Gerçek oynanan kolon tutarı açıkça girilmeden totalCost / 16 üzerinden otomatik gerçek tutar üretilmesin
    const explicitCostPerColumn = (typeof actualStake.costPerColumn === 'number' && actualStake.costPerColumn > 0)
        ? actualStake.costPerColumn
        : (placedCoupon && typeof placedCoupon.costPerColumn === 'number' && placedCoupon.costPerColumn > 0
            ? placedCoupon.costPerColumn
            : null);

    const explicitTotalCost = (typeof actualStake.totalCost === 'number' && actualStake.totalCost > 0)
        ? actualStake.totalCost
        : (placedCoupon && typeof placedCoupon.totalCost === 'number' && placedCoupon.totalCost > 0
            ? placedCoupon.totalCost
            : (explicitCostPerColumn ? +(explicitCostPerColumn * 16).toFixed(2) : null));

    if (explicitCostPerColumn === null || explicitTotalCost === null) {
        return {
            isSettled: false,
            settlementStatus: 'Gerçek ödeme hesaplanamıyor',
            reason: 'Kullanıcının fiilen oynadığı kolon başına tutar (costPerColumn) açıkça girilmelidir; totalCost / 16 üzerinden otomatik tutar türetilemez.',
            settledPayout: null,
            totalCost: explicitTotalCost,
            sumOfColumns: explicitTotalCost
        };
    }

    const costPerColumn = explicitCostPerColumn;
    const totalCost = explicitTotalCost;

    // Jack Kuralı 3: Para hesaplamalarını kuruş bazında tam sayı kullanarak yap. 0.01 TL toleransla tutarsız kupon kabul etme.
    const totalCostCents = Math.round(totalCost * 100);
    const costPerColumnCents = Math.round(costPerColumn * 100);
    const calculatedColumnsSum = (16 * costPerColumnCents) / 100;

    if (16 * costPerColumnCents !== totalCostCents) {
        return {
            isSettled: false,
            settlementStatus: 'Gerçek ödeme hesaplanamıyor',
            reason: `Kuruş bazında tutarsızlık: 16 kolon x ${(costPerColumnCents / 100).toFixed(2)} TL = ${(16 * costPerColumnCents / 100).toFixed(2)} TL eder, fakat kupon maliyeti ${(totalCostCents / 100).toFixed(2)} TL olarak girilmiş. 0.01 TL toleransla tutarsız kupon kabul edilemez.`,
            settledPayout: null,
            totalCost,
            sumOfColumns: (16 * costPerColumnCents) / 100
        };
    }

    const resultMap = new Map();
    if (results instanceof Map) {
        for (const [k, v] of results.entries()) resultMap.set(String(k), v);
    } else if (Array.isArray(results)) {
        for (const r of results) {
            const id = String(r.matchId || r.id);
            resultMap.set(id, r);
        }
    } else if (results && typeof results === 'object') {
        for (const [k, v] of Object.entries(results)) resultMap.set(String(k), v);
    }

    const matches = system345.matches || [];

    // 1. Ertelenen ve henüz kesinleşmemiş maç kontrolü (Madde 2)
    // Postponed durumu otomatik void (1.00) kabul EDİLEMEZ.
    // Yalnızca resmi iptal/geçersiz (void/cancelled) kararı kesinleşmiş maçlar 1.00 oran alır.
    const pendingMatches = matches.filter(m => {
        const res = resultMap.get(String(m.matchId));
        if (!res) return true; // Sonuç kaydı yok

        const isFinalVoid = Boolean(res.void || res.cancelled || res.isVoid || res.isCancelled || res.state === 'canc');
        if (isFinalVoid) return false; // Kesinleşmiş iptal, beklenmez (oranı 1.00 kabul edilir)

        // Ertelenmiş (postponed / ppd) ve henüz iptal/geçersiz kesinleşmemiş maç
        const isPostponed = Boolean(res.postponed || res.state === 'ppd');
        if (isPostponed) return true; // Karar bekliyor

        // Canlı veya henüz başlamamış maçlar
        if (res.state === 'live' || res.state === 'pre') return true;

        return false;
    });

    if (pendingMatches.length > 0) {
        return {
            isSettled: false,
            settlementStatus: 'Maçlar henüz tamamlanmadı',
            pendingMatchesCount: pendingMatches.length,
            settledPayout: null,
            message: 'Ertelenen veya sonucu henüz kesinleşmeyen maçlar bulunmaktadır. İptal/geçersiz kararı kesinleşmeden veya ertelenen maç oynanmadan kupon sonuçlandırılamaz.'
        };
    }

    // 2. Gerçek oynanan oran kontrolü (Madde 1 & 3)
    // Kullanıcının gerçekten oynadığı ve kaydedilmiş oran zorunludur.
    // Öneri anındaki m.odd değerine ASLA geri dönülmez (fallback yapılmaz).
    const missingPlayedOdds = matches.filter(m => {
        const res = resultMap.get(String(m.matchId));
        const isFinalVoid = Boolean(res && (res.void || res.cancelled || res.isVoid || res.isCancelled || res.state === 'canc'));
        if (isFinalVoid) return false; // İptal maçta oran 1.00'e sabitlenir, oynanan orana gerek kalmaz

        const placedFromCoupon = placedCoupon?.matches?.find(pm => String(pm.matchId) === String(m.matchId))?.placedOdd;
        const playedOdd = (res && typeof res.settledOdd === 'number')
            ? res.settledOdd
            : (res && typeof res.playedOdd === 'number')
                ? res.playedOdd
                : (res && typeof res.actualOdd === 'number')
                    ? res.actualOdd
                    : (placedFromCoupon || (actualStake.placedOdds && typeof actualStake.placedOdds[String(m.matchId)] === 'number' ? actualStake.placedOdds[String(m.matchId)] : null));

        return typeof playedOdd !== 'number' || playedOdd <= 1.0;
    });

    if (missingPlayedOdds.length > 0) {
        return {
            isSettled: false,
            settlementStatus: 'Gerçek ödeme hesaplanamıyor',
            reason: 'Kullanıcının oynadığı gerçek Nesine oranı kayıtlı değil veya eksik (eski öneri oranı ödeme hesabında kullanılamaz).',
            settledPayout: null
        };
    }

    // 3. Bahis türüne göre kesin matematiksel sonuç doğrulaması (Madde 4: skor olmadan res.won ASLA kullanılmaz!)
    const matchOutcomeMap = new Map();
    for (const m of matches) {
        const res = resultMap.get(String(m.matchId));
        const isFinalVoid = Boolean(res && (res.void || res.cancelled || res.isVoid || res.isCancelled || res.state === 'canc'));
        if (isFinalVoid) {
            matchOutcomeMap.set(String(m.matchId), { isVoid: true, isWon: false });
            continue;
        }

        // Jack Kuralı 4: Skor verisi ZORUNLUDUR. res.won fallback'i tamamen kaldırıldı!
        if (!res || !res.score || typeof res.score.h !== 'number' || typeof res.score.a !== 'number') {
            return {
                isSettled: false,
                settlementStatus: 'Sonuçlandırma doğrulanamadı',
                reason: `Maç #${m.matchId} (${m.home} - ${m.away}) için gerçek skor bilgisi bulunamadı. Skor olmadan 'won' bayrağı veya varsayımla sonuçlandırma yapılamaz.`,
                unverifiedMatchId: m.matchId,
                settledPayout: null
            };
        }

        const evalOutcome = evaluateBetOutcome(m.key, res.score, res.ht, res.stats);
        if (evalOutcome === null) {
            // Bilinmeyen veya istatistik verisi eksik olan market
            return {
                isSettled: false,
                settlementStatus: 'Sonuçlandırma doğrulanamadı',
                reason: `Maç #${m.matchId} (${m.home} - ${m.away}) için '${m.key}' bahis türü skor veya istatistik verisiyle doğrulanamadı. Desteklenmeyen veya eksik market verisi tespit edildi. Gerçek ödeme hesaplanamaz.`,
                unverifiedMatchId: m.matchId,
                marketKey: m.key,
                settledPayout: null
            };
        }
        matchOutcomeMap.set(String(m.matchId), { isVoid: false, isWon: evalOutcome });
    }

    // 4. Kolonların sonuçlandırılması (Kuruş bazında tam sayı hesaplama)
    let settledPayoutCents = 0;
    let wonColumnsCount = 0;
    const settledColumns = system345.columns.map(col => {
        let colWon = true;
        let colMultiplier = 1;
        const colMatchDetails = [];

        for (const m of col.matches) {
            const res = resultMap.get(String(m.matchId));
            const isFinalVoid = Boolean(res && (res.void || res.cancelled || res.isVoid || res.isCancelled || res.state === 'canc'));
            const outcomeInfo = matchOutcomeMap.get(String(m.matchId));
            const isWon = outcomeInfo ? outcomeInfo.isWon : false;

            // Gerçek oynanan oran: m.odd fallback'i KESİNLİKLE YOKTUR!
            const placedFromCoupon = placedCoupon?.matches?.find(pm => String(pm.matchId) === String(m.matchId))?.placedOdd;
            const effectiveOdd = isFinalVoid
                ? 1.00
                : ((res && typeof res.settledOdd === 'number')
                    ? res.settledOdd
                    : ((res && typeof res.playedOdd === 'number')
                        ? res.playedOdd
                        : ((res && typeof res.actualOdd === 'number')
                            ? res.actualOdd
                            : (placedFromCoupon || (actualStake.placedOdds && actualStake.placedOdds[String(m.matchId)])))));

            colMatchDetails.push({
                matchId: m.matchId,
                home: m.home,
                away: m.away,
                key: m.key,
                isVoid: isFinalVoid,
                won: isWon,
                odd: effectiveOdd
            });

            if (!isFinalVoid && !isWon) {
                colWon = false;
            } else {
                colMultiplier *= effectiveOdd;
            }
        }

        const colMultiplierRounded = +colMultiplier.toFixed(2);
        const colPayoutCents = colWon ? Math.round(colMultiplierRounded * costPerColumnCents) : 0;
        const colPayout = +(colPayoutCents / 100).toFixed(2);
        if (colWon) {
            wonColumnsCount++;
            settledPayoutCents += colPayoutCents;
        }

        return {
            ...col,
            settled: true,
            won: colWon,
            multiplier: colMultiplierRounded,
            payout: colPayout,
            matchDetails: colMatchDetails
        };
    });

    const settledPayout = +(settledPayoutCents / 100).toFixed(2);
    const netProfit = +((settledPayoutCents - totalCostCents) / 100).toFixed(2);

    return {
        isSettled: true,
        settlementStatus: 'Sonuçlandı',
        nesineRefCode: placedCoupon?.nesineRefCode || actualStake.nesineRefCode || null,
        totalColumns: 16,
        wonColumnsCount,
        lostColumnsCount: 16 - wonColumnsCount,
        totalCost,
        costPerColumn,
        sumOfColumns: calculatedColumnsSum,
        settledPayout,
        netProfit,
        columns: settledColumns,
        message: `${wonColumnsCount}/16 kolon kazandı. Gerçek ödeme: ${settledPayout} TL (Yatırılan: ${totalCost} TL, Net: ${netProfit >= 0 ? '+' : ''}${netProfit} TL).`
    };
}

// ---------------- Ayrı Tahmin Kayıt & Kronolojik Walk-Forward Test Tablosu (.cache/prediction_test_table.json) ----------------
const PREDICTION_TABLE_FILE = path.join(__dirname, '.cache', 'prediction_test_table.json');

function loadPredictionTestTable() {
    try {
        if (fs.existsSync(PREDICTION_TABLE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(PREDICTION_TABLE_FILE, 'utf8'));
            if (raw && typeof raw === 'object') {
                return {
                    preMatchRecords: raw.preMatchRecords || {},
                    walkForwardRecords: Array.isArray(raw.walkForwardRecords) ? raw.walkForwardRecords : [],
                    lastWalkForwardDate: raw.lastWalkForwardDate || null
                };
            }
        }
    } catch (_) {}
    return { preMatchRecords: {}, walkForwardRecords: [], lastWalkForwardDate: null };
}

function savePredictionTestTable(table) {
    try {
        const dir = path.dirname(PREDICTION_TABLE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PREDICTION_TABLE_FILE, JSON.stringify(table, null, 2), 'utf8');
    } catch (_) {}
}

function selectTopPreMatchPick(m, an) {
    const cands = [
        { key: 'ust15', label: '1,5 Üst', p: an.p.ust15 },
        { key: 'iyust05', label: 'İY 0,5 Üst', p: an.p.iyust05 },
        { key: 'ms1', label: 'MS 1', p: an.p.ms1 },
        { key: 'ms2', label: 'MS 2', p: an.p.ms2 },
        { key: 'ust25', label: '2,5 Üst', p: an.p.ust25 },
        { key: 'kgv', label: 'KG Var', p: an.p.kgv },
        { key: 'dc1x', label: 'ÇŞ 1-X', p: an.p.dc1x },
        { key: 'dcx2', label: 'ÇŞ X-2', p: an.p.dcx2 }
    ].filter(x => x.p >= 0.68 && x.p <= 0.90).sort((a, b) => b.p - a.p);

    const top = cands[0];
    if (!top) return null;
    // Jack Kontrol 5: oddsFresh kontrolü zorunludur; bayat/yenilenemeyen oranlar tabloya ve EV'ye yazılamaz!
    const isOddsFresh = Boolean(m.oddsFresh);
    const hasRealOdd = Boolean(isOddsFresh && m.odds && typeof m.odds[top.key] === 'number' && m.odds[top.key] > 1.01);
    const realOdd = hasRealOdd ? +m.odds[top.key].toFixed(2) : null;
    const { evPct } = hasRealOdd ? computeExpectedValue(top.p, realOdd, top.key, m.odds) : { evPct: null };
    return {
        ...top,
        hasRealOdd,
        realOdd,
        oddsFresh: isOddsFresh,
        oddsUpdatedAt: hasRealOdd ? (m.oddsUpdatedAt || null) : null,
        evPct
    };
}

// ---------------- Model Performans, Kalibrasyon (Brier Score / Log Loss) & Kronolojik Out-of-Sample Doğrulama Motoru ----------------
function evaluateModelPerformance(model, dayItems = []) {
    const table = loadPredictionTestTable();
    let tableDirty = false;
    const nowIso = new Date().toISOString();

    // 1. ADIM: Maç başlamadan önce (state === 'pre') tahminleri kaydet (Pre-Match Prediction Locking)
    const upcomingToday = (dayItems || []).filter(it =>
        it.m && it.m.state === 'pre' && it.m.inBulletin && new Date(it.m.kickoff).getTime() > Date.now()
    );
    for (const it of upcomingToday) {
        const m = it.m;
        const mKey = String(m.id);
        if (!table.preMatchRecords[mKey]) {
            const topPick = selectTopPreMatchPick(m, it.an);
            if (topPick && typeof topPick.p === 'number' && Number.isFinite(topPick.p) && topPick.p > 0 && topPick.p < 1) {
                const kickoffIso = m.kickoff
                    ? (m.kickoff.includes('T') ? m.kickoff : new Date(m.kickoff).toISOString())
                    : (m.date && m.time ? `${m.date}T${m.time}:00.000Z` : null);

                table.preMatchRecords[mKey] = {
                    matchId: m.id,
                    date: m.date,
                    time: m.time,
                    kickoff: kickoffIso || m.kickoff,
                    league: m.league?.full || 'Diğer',
                    match: `${m.home} - ${m.away}`,
                    pickKey: topPick.key,
                    pick: topPick.label,
                    probPct: Math.round(topPick.p * 100),
                    predictedProb: +(topPick.p).toFixed(4),
                    p1: +(it.an.p.ms1 || 0.33).toFixed(4),
                    pX: +(it.an.p.msx || 0.33).toFixed(4),
                    p2: +(it.an.p.ms2 || 0.33).toFixed(4),
                    realOdd: topPick.realOdd,
                    oddsUpdatedAt: topPick.oddsUpdatedAt,
                    evPct: topPick.evPct,
                    recordedBeforeKickoffAt: nowIso,
                    testMethod: 'Maç Öncesi Kayıt (Pre-Match)',
                    status: 'Beklemede',
                    won: null,
                    score: null,
                    verifiedAt: null
                };
                tableDirty = true;
            }
        }
    }

    // 2. ADIM: Maç başlamadan kaydedilen tahminlerin maç bittiğinde (state === 'post') sonuçlarını otomatik karşılaştır
    const finishedMap = new Map();
    if (Array.isArray(model.rawHistory)) {
        for (const m of model.rawHistory) {
            if (m && m.state === 'post' && m.score && m.ht) finishedMap.set(String(m.id), m);
        }
    }
    for (const it of (dayItems || [])) {
        if (it.m && it.m.state === 'post' && it.m.score && it.m.ht) {
            finishedMap.set(String(it.m.id), it.m);
        }
    }

    for (const [mKey, rec] of Object.entries(table.preMatchRecords)) {
        if (rec.won === null && finishedMap.has(mKey)) {
            const fm = finishedMap.get(mKey);
            const actualKeys = new Set(outcomeKeys(fm.score.h, fm.score.a, fm.ht.h, fm.ht.a));
            const won = actualKeys.has(rec.pickKey);
            rec.won = won;
            rec.status = won ? 'Kazandı' : 'Kaybetti';
            rec.score = `${fm.score.h}-${fm.score.a} (İY ${fm.ht.h}-${fm.ht.a})`;
            rec.verifiedAt = new Date().toISOString();

            // Gerçek maç öncesi tahmin olasılığı ve başlama saati (kickoff) karşılaştırması
            // predictedProb eksikse veya başlama sonrası kaydedilmişse kalibrasyon yapılmaz (sıfır 0.70 varsayımı)
            const hasValidProb = typeof rec.predictedProb === 'number' &&
                Number.isFinite(rec.predictedProb) &&
                rec.predictedProb > 0 &&
                rec.predictedProb < 1;

            const recTime = rec.recordedBeforeKickoffAt ? new Date(rec.recordedBeforeKickoffAt).getTime() : NaN;
            const kickTime = rec.kickoff ? new Date(rec.kickoff).getTime() : NaN;
            const isTimingValid = (!isNaN(recTime) && !isNaN(kickTime)) ? recTime <= kickTime : false;

            if (hasValidProb && isTimingValid) {
                const p = rec.predictedProb;
                const y = won ? 1 : 0;
                const brier = +((p - y) ** 2).toFixed(4);
                const pClamped = Math.max(0.01, Math.min(0.99, won ? p : (1 - p)));
                const logLoss = +(-Math.log(pClamped)).toFixed(4);
                rec.brier = brier;
                rec.logLoss = logLoss;
            } else {
                rec.brier = null;
                rec.logLoss = null;
                if (!hasValidProb) {
                    rec.calibrationReason = 'Eksik veya geçersiz maç öncesi tahmin olasılığı (Brier ve Log Loss hesaplanmadı)';
                } else if (!isTimingValid) {
                    rec.calibrationReason = 'Tahmin başlama saatinden sonra kaydedildiği veya zaman damgası geçersiz olduğu için kalibrasyona dahil edilmedi';
                }
            }
            tableDirty = true;
        }
    }

    // 3. ADIM: Geçmiş maçları KRONOLOJİK SIRAYLA ve YALNIZCA MAÇTAN ÖNCEKİ VERİLERLE (Out-of-Sample Walk-Forward) test et
    // Modelin öğrendiği maçlar kendi testinde ASLA kullanılmaz: testDate günündeki her maç yalnızca (m.date < testDate) verisiyle kurulan priorModel ile tahmin edilir.
    const rawHistory = Array.isArray(model.rawHistory) ? model.rawHistory : [];
    const distinctDates = [...new Set(rawHistory.filter(m => m.inBulletin).map(m => m.date))].sort();
    const testDates = distinctDates.slice(-6); // Son 6 bülten günü kronolojik sırayla

    let walkForwardRecords = [];
    if (testDates.length > 0) {
        const latestTestDate = testDates[testDates.length - 1];
        if (table.lastWalkForwardDate === latestTestDate && table.walkForwardRecords.length >= 10) {
            walkForwardRecords = table.walkForwardRecords;
        } else {
            const newWf = [];
            for (const testDate of testDates) {
                // Yalnızca testDate tarihinden ÖNCEKİ maçlarla (m.date < testDate) kurulan noktasal model (Sıfır veri sızıntısı)
                const priorModel = buildModel(rawHistory, testDate, { skipRawHistory: true });
                if (priorModel.nRows < 40) continue;

                const dayMatches = rawHistory
                    .filter(m => m.date === testDate && m.inBulletin && m.state === 'post' && m.score && m.ht)
                    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

                for (const m of dayMatches) {
                    const an = analyze(priorModel, m, { facts: false });
                    const actualKeys = new Set(outcomeKeys(m.score.h, m.score.a, m.ht.h, m.ht.a));
                    const topPick = selectTopPreMatchPick(m, an);
                    if (!topPick) continue;

                    const won = actualKeys.has(topPick.key);
                    const pickP = topPick.p;
                    const y = won ? 1 : 0;
                    const brier = +((pickP - y) ** 2).toFixed(4);
                    const pClamped = Math.max(0.01, Math.min(0.99, won ? pickP : (1 - pickP)));
                    const logLoss = +(-Math.log(pClamped)).toFixed(4);

                    const act1 = m.score.h > m.score.a ? 1 : 0;
                    const actX = m.score.h === m.score.a ? 1 : 0;
                    const act2 = m.score.h < m.score.a ? 1 : 0;
                    const p1 = Math.max(0.02, Math.min(0.96, an.p.ms1 || 0.33));
                    const pX = Math.max(0.02, Math.min(0.96, an.p.msx || 0.33));
                    const p2 = Math.max(0.02, Math.min(0.96, an.p.ms2 || 0.33));
                    const brier1x2 = +(((p1 - act1) ** 2 + (pX - actX) ** 2 + (p2 - act2) ** 2) / 3).toFixed(4);
                    const pActual1x2 = act1 ? p1 : actX ? pX : p2;
                    const logLoss1x2 = +(-Math.log(pActual1x2)).toFixed(4);

                    newWf.push({
                        matchId: m.id,
                        date: m.date,
                        time: m.time,
                        kickoff: m.kickoff || `${m.date}T${m.time || '00:00'}:00Z`,
                        league: m.league?.full || 'Diğer',
                        match: `${m.home} - ${m.away}`,
                        score: `${m.score.h}-${m.score.a} (İY ${m.ht.h}-${m.ht.a})`,
                        brier,
                        logLoss,
                        brier1x2,
                        logLoss1x2,
                        pickKey: topPick.key,
                        pick: topPick.label,
                        predictedProb: +pickP.toFixed(4),
                        probPct: Math.round(pickP * 100),
                        realOdd: topPick.realOdd,
                        evPct: topPick.evPct,
                        won,
                        status: won ? 'Kazandı' : 'Kaybetti',
                        testMethod: `Kronolojik Out-of-Sample (< ${testDate} verisi)`,
                        modelAsOfDate: testDate
                    });
                }
            }

            // Bugünün tamamlanan maçlarını da bugünün maç öncesi modeliyle (asOf = today, yani sadece dün ve öncesiyle eğitilmiş modelle) ekle
            const finishedToday = (dayItems || [])
                .filter(it => it.m && it.m.state === 'post' && it.m.inBulletin && it.m.score && it.m.ht)
                .sort((a, b) => String(a.m.time || '').localeCompare(String(b.m.time || '')));
            for (const it of finishedToday) {
                const m = it.m;
                const an = it.an || analyze(model, m, { facts: false });
                const actualKeys = new Set(outcomeKeys(m.score.h, m.score.a, m.ht.h, m.ht.a));
                const topPick = selectTopPreMatchPick(m, an);
                if (!topPick) continue;

                const won = actualKeys.has(topPick.key);
                const pickP = topPick.p;
                const y = won ? 1 : 0;
                const brier = +((pickP - y) ** 2).toFixed(4);
                const pClamped = Math.max(0.01, Math.min(0.99, won ? pickP : (1 - pickP)));
                const logLoss = +(-Math.log(pClamped)).toFixed(4);

                const act1 = m.score.h > m.score.a ? 1 : 0;
                const actX = m.score.h === m.score.a ? 1 : 0;
                const act2 = m.score.h < m.score.a ? 1 : 0;
                const p1 = Math.max(0.02, Math.min(0.96, an.p.ms1 || 0.33));
                const pX = Math.max(0.02, Math.min(0.96, an.p.msx || 0.33));
                const p2 = Math.max(0.02, Math.min(0.96, an.p.ms2 || 0.33));
                const brier1x2 = +(((p1 - act1) ** 2 + (pX - actX) ** 2 + (p2 - act2) ** 2) / 3).toFixed(4);
                const pActual1x2 = act1 ? p1 : actX ? pX : p2;
                const logLoss1x2 = +(-Math.log(pActual1x2)).toFixed(4);

                newWf.push({
                    matchId: m.id,
                    date: m.date,
                    time: m.time,
                    kickoff: m.kickoff || `${m.date}T${m.time || '00:00'}:00Z`,
                    league: m.league?.full || 'Diğer',
                    match: `${m.home} - ${m.away}`,
                    score: `${m.score.h}-${m.score.a} (İY ${m.ht.h}-${m.ht.a})`,
                    brier,
                    logLoss,
                    brier1x2,
                    logLoss1x2,
                    pickKey: topPick.key,
                    pick: topPick.label,
                    predictedProb: +pickP.toFixed(4),
                    probPct: Math.round(pickP * 100),
                    realOdd: topPick.realOdd,
                    evPct: topPick.evPct,
                    won,
                    status: won ? 'Kazandı' : 'Kaybetti',
                    testMethod: `Maç Öncesi Model (< ${m.date} verisi)`,
                    modelAsOfDate: m.date
                });
            }

            walkForwardRecords = newWf;
            table.walkForwardRecords = newWf.slice(-200);
            table.lastWalkForwardDate = latestTestDate;
            tableDirty = true;
        }
    }

    if (tableDirty) {
        savePredictionTestTable(table);
    }

    // 4. ADIM: Metrikleri yalnızca Out-of-Sample Walk-Forward ve Maç Öncesi Kayıt verilerinden hesapla
    let brierSum = 0, logLossSum = 0, count = 0;
    let bankoHits = 0, bankoTotal = 0;
    let missingTimingCount = 0;
    let timingViolations = 0;
    const invalidTimingRecords = [];
    const marketStats = {
        ust15: { key: 'ust15', label: '1,5 Üst', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 },
        iyust05: { key: 'iyust05', label: 'İY 0,5 Üst', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 },
        ms_fav: { key: 'ms_fav', label: 'MS Favori (1/2)', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 },
        kgv: { key: 'kgv', label: 'KG Var', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 },
        ust25: { key: 'ust25', label: '2,5 Üst', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 },
        dc: { key: 'dc', label: 'Çifte Şans', hits: 0, total: 0, brierSum: 0, logLossSum: 0, probSum: 0 }
    };
    const leagueMap = new Map();

    for (const rec of walkForwardRecords) {
        // Gerçek maç öncesi tahmin olasılığı kontrolü (0.70 varsayımı tamamen kaldırıldı)
        const hasValidProb = typeof rec.predictedProb === 'number' &&
            Number.isFinite(rec.predictedProb) &&
            rec.predictedProb > 0 &&
            rec.predictedProb < 1;

        // Katı zaman damgası doğrulaması: eksik veya geçersizse ASLA true kabul edilemez!
        const hasValidIso = Boolean(rec.recordedBeforeKickoffAt && typeof rec.recordedBeforeKickoffAt === 'string' && !isNaN(Date.parse(rec.recordedBeforeKickoffAt)));
        const hasValidKickoff = Boolean(rec.kickoff && !isNaN(Date.parse(rec.kickoff)));
        const recTime = hasValidIso ? new Date(rec.recordedBeforeKickoffAt).getTime() : NaN;
        const kickTime = hasValidKickoff ? new Date(rec.kickoff).getTime() : NaN;
        const isTimingValid = Boolean(hasValidIso && hasValidKickoff && recTime <= kickTime);

        if (!hasValidIso || !hasValidKickoff) {
            missingTimingCount++;
            invalidTimingRecords.push({
                matchId: rec.matchId,
                reason: !hasValidIso && !hasValidKickoff
                    ? 'recordedBeforeKickoffAt ve kickoff zaman damgaları eksik veya geçersiz'
                    : (!hasValidIso ? 'recordedBeforeKickoffAt eksik veya geçersiz ISO tarih' : 'kickoff eksik veya geçersiz tarih')
            });
        } else if (recTime > kickTime) {
            timingViolations++;
            invalidTimingRecords.push({
                matchId: rec.matchId,
                reason: `Zamanlama ihlali: kayıt zamanı (${rec.recordedBeforeKickoffAt}) kickoff (${rec.kickoff}) sonrasında`
            });
        }

        if (hasValidProb && isTimingValid && typeof rec.brier === 'number' && typeof rec.logLoss === 'number') {
            brierSum += rec.brier;
            logLossSum += rec.logLoss;
            count++;
        }
        if (rec.pickKey && typeof rec.won === 'boolean') {
            bankoTotal++;
            if (rec.won) bankoHits++;

            const mktKey = (rec.pickKey === 'ms1' || rec.pickKey === 'ms2') ? 'ms_fav'
                : (rec.pickKey === 'dc1x' || rec.pickKey === 'dcx2') ? 'dc'
                : rec.pickKey;
            if (marketStats[mktKey]) {
                const mst = marketStats[mktKey];
                mst.total++;
                if (rec.won) mst.hits++;
                if (hasValidProb && isTimingValid && typeof rec.brier === 'number' && typeof rec.logLoss === 'number') {
                    mst.brierSum += rec.brier;
                    mst.logLossSum += rec.logLoss;
                    mst.probSum += rec.predictedProb;
                    mst.calibratedCount = (mst.calibratedCount || 0) + 1;
                }
            }

            const lgName = rec.league || 'Diğer';
            const lgObj = leagueMap.get(lgName) || { league: lgName, hits: 0, total: 0 };
            lgObj.total++;
            if (rec.won) lgObj.hits++;
            leagueMap.set(lgName, lgObj);
        }
    }

    // KESİN KURAL (Madde 6): Veri yoksa asla 0.192, 0.565, %78 gibi varsayılan değerler döndürme!
    const hasSufficientData = count >= 5 && bankoTotal >= 5;
    const brierScore = hasSufficientData ? +(brierSum / count).toFixed(3) : null;
    const logLoss = hasSufficientData ? +(logLossSum / count).toFixed(3) : null;
    const hitRatePct = hasSufficientData ? Math.round((bankoHits / bankoTotal) * 100) : null;

    // Jack Kuralı 2: Pazar bazında performansı ayır
    const marketsReport = hasSufficientData
        ? Object.values(marketStats)
            .filter(x => x.total >= 1)
            .map(x => ({
                key: x.key,
                label: x.label,
                hits: x.hits,
                total: x.total,
                ratePct: Math.round((x.hits / x.total) * 100),
                brierScore: x.calibratedCount ? +(x.brierSum / x.calibratedCount).toFixed(3) : null,
                logLoss: x.calibratedCount ? +(x.logLossSum / x.calibratedCount).toFixed(3) : null,
                avgProbPct: x.calibratedCount ? Math.round((x.probSum / x.calibratedCount) * 100) : null
            }))
        : [];

    const leaguesReport = hasSufficientData
        ? [...leagueMap.values()]
            .filter(x => x.total >= 3)
            .sort((a, b) => (b.hits / b.total) - (a.hits / a.total))
            .slice(0, 6)
            .map(x => ({
                league: x.league,
                hits: x.hits,
                total: x.total,
                ratePct: Math.round((x.hits / x.total) * 100)
            }))
        : [];

    // Sonuçlanan maçlar (Önce maç başlamadan kaydedilip sonuçlananlar, ardından kronolojik walk-forward test kayıtları)
    const verifiedPreMatch = Object.values(table.preMatchRecords)
        .filter(r => r.won !== null)
        .sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time)));

    const pendingPreMatch = Object.values(table.preMatchRecords)
        .filter(r => r.won === null)
        .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))
        .slice(0, 8);

    const verifiedWalkForward = walkForwardRecords
        .filter(r => r.pick && typeof r.won === 'boolean')
        .slice(-12)
        .reverse();

    const verifiedMatches = [...verifiedPreMatch, ...verifiedWalkForward].slice(0, 10);

    return {
        hasSufficientData,
        statusMessage: hasSufficientData
            ? 'Kronolojik Out-of-Sample Walk-Forward Test (Her maç yalnızca kendisinden önceki verilerle test edilmiştir)'
            : 'Henüz yeterli veri yok',
        evaluatedMatches: count,
        brierScore,
        logLoss,
        hitRatePct,
        bankoHits,
        bankoTotal,
        marketBreakdown: marketStats,
        marketsReport,
        leaguesReport,
        verifiedMatches,
        pendingPreMatch,
        allPreMatch: table.preMatchRecords,
        missingTimingCount,
        timingViolations,
        invalidTimingRecords
    };
}

// Jack Kuralı 2: Walk-Forward Denetim & Veri Sızıntısı Doğrulayıcı
function verifyWalkForwardIntegrity(records = []) {
    let leaksDetected = 0;
    let brierMismatches = 0;
    let invalidProbabilities = 0;
    let timingViolations = 0;
    let missingTimingCount = 0;

    for (const rec of records) {
        // 1. Veri sızıntısı kontrolü: modelAsOfDate > rec.date olamaz!
        if (rec.modelAsOfDate && rec.date && rec.modelAsOfDate > rec.date) {
            leaksDetected++;
        }
        // 2. Pre-match zamanlama kontrolü: recordedBeforeKickoffAt ve kickoff gerçek ISO formatında olmalı ve recTime <= kickTime olmalı
        const hasValidIso = Boolean(rec.recordedBeforeKickoffAt && typeof rec.recordedBeforeKickoffAt === 'string' && !isNaN(Date.parse(rec.recordedBeforeKickoffAt)));
        const hasValidKickoff = Boolean(rec.kickoff && !isNaN(Date.parse(rec.kickoff)));
        if (!hasValidIso || !hasValidKickoff) {
            missingTimingCount++;
            timingViolations++;
        } else {
            const recTime = new Date(rec.recordedBeforeKickoffAt).getTime();
            const kickTime = new Date(rec.kickoff).getTime();
            if (recTime > kickTime) {
                timingViolations++;
            }
        }
        // 3. Olasılık kontrolü: predictedProb gerçek sayı ve (0, 1) aralığında olmalı (0.70 veya varsayım kabul edilmez)
        const p = typeof rec.predictedProb === 'number' && Number.isFinite(rec.predictedProb) ? rec.predictedProb : null;
        if (p === null || p <= 0 || p >= 1) {
            invalidProbabilities++;
        }
        // 4. Brier Score formül doğrulaması: brier === (p - y)^2
        if (typeof p === 'number' && typeof rec.won === 'boolean' && typeof rec.brier === 'number') {
            const expectedBrier = (p - (rec.won ? 1 : 0)) ** 2;
            if (Math.abs(expectedBrier - rec.brier) > 0.01) {
                brierMismatches++;
            }
        }
    }

    return {
        isValid: leaksDetected === 0 && brierMismatches === 0 && invalidProbabilities === 0 && timingViolations === 0 && missingTimingCount === 0,
        totalChecked: records.length,
        leaksDetected,
        brierMismatches,
        invalidProbabilities,
        timingViolations,
        missingTimingCount
    };
}

// ---------------- Yusuf AI – Veriye Dayalı Analiz + Bağımsız Futbol Yorumu ----------------
function generateMatchCommentary(m, an, opts = {}) {
    if (!m) m = { home: 'Ev Sahibi', away: 'Deplasman', league: { full: 'Lig' } };
    if (!an) an = { lh: 1.35, la: 1.10, p: { ms1: 0.45, msx: 0.28, ms2: 0.27, ust25: 0.50, alt25: 0.50, kgv: 0.52, kgy: 0.48, dc1x: 0.73, dcx2: 0.55 }, topScores: [{ s: '1-1', p: 0.12 }] };

    const hf = an.facts?.home || null;
    const af = an.facts?.away || null;
    const homeName = m.home || 'Ev Sahibi';
    const awayName = m.away || 'Deplasman';
    const leagueName = m.league?.full || m.league?.name || 'Lig';

    const pMs1 = Math.round((an.p?.ms1 || 0.40) * 100);
    const pMsX = Math.round((an.p?.msx || 0.30) * 100);
    const pMs2 = Math.round((an.p?.ms2 || 0.30) * 100);
    const pUst25 = Math.round((an.p?.ust25 || 0.50) * 100);
    const pAlt25 = Math.round((an.p?.alt25 || 0.50) * 100);
    const pKgv = Math.round((an.p?.kgv || 0.50) * 100);
    const pKgy = Math.round((an.p?.kgy || 0.50) * 100);
    const pDc1x = Math.round((an.p?.dc1x || 0.70) * 100);
    const pDcx2 = Math.round((an.p?.dcx2 || 0.60) * 100);

    const lhVal = typeof an.lh === 'number' ? an.lh : 1.35;
    const laVal = typeof an.la === 'number' ? an.la : 1.10;
    const totalXg = +(lhVal + laVal).toFixed(2);

    // 1. Veriye Dayalı Analiz Özeti (Matematiksel İstatistik Katmanı)
    const hasSquadData = Boolean(an.squad && (
        (Array.isArray(an.squad.homeMissing) && an.squad.homeMissing.length > 0) ||
        (Array.isArray(an.squad.awayMissing) && an.squad.awayMissing.length > 0) ||
        an.squad.isOfficial
    ));

    const squadStatus = hasSquadData
        ? 'Resmi/Doğrulanmış kadro ve eksik verisi mevcut'
        : 'Resmi sakatlık ve ceza verisi doğrulanmadı / güvenilir veri yok (uydurma sakatlık girilmez)';

    const hasFreshOdds = Boolean(m.oddsFresh && m.odds && Object.keys(m.odds).length > 0);
    const oddsStatus = hasFreshOdds
        ? `Güncel Nesine Oranları (Son Veri: ${m.oddsUpdatedAt || 'Bilinmiyor'})`
        : 'Güncel piyasa oranı bültende bulunamadı / oran verisi bekleniyor';

    const statisticalSummary = {
        matchInfo: {
            home: homeName,
            away: awayName,
            league: leagueName,
            kickoff: m.kickoff || null,
            date: m.date || null,
            time: m.time || null
        },
        expectedGoals: {
            home: +lhVal.toFixed(2),
            away: +laVal.toFixed(2),
            total: totalXg
        },
        formAndPoints: {
            home: {
                last5: hf?.formStr || '-',
                last10: hf?.form10Str || '-',
                ppgLast10: hf?.last10Pts ?? null,
                momentum: +(an.momH || 1.0).toFixed(2),
                recentResults: hf?.son || []
            },
            away: {
                last5: af?.formStr || '-',
                last10: af?.form10Str || '-',
                ppgLast10: af?.last10Pts ?? null,
                momentum: +(an.momA || 1.0).toFixed(2),
                recentResults: af?.son || []
            }
        },
        splits: {
            homeAtHome: {
                matchesPlayed: hf?.hn ?? null,
                goalsForAvg: hf?.homeGf ?? hf?.gf ?? null,
                goalsAgainstAvg: hf?.homeGa ?? hf?.ga ?? null,
                form: hf?.homeForm || '-'
            },
            awayAtAway: {
                matchesPlayed: af?.an ?? null,
                goalsForAvg: af?.awayGf ?? af?.gf ?? null,
                goalsAgainstAvg: af?.awayGa ?? af?.ga ?? null,
                form: af?.awayForm || '-'
            }
        },
        goalDistributions: {
            over25Pct: pUst25,
            under25Pct: pAlt25,
            bttsPct: pKgv,
            htGoalSharePct: {
                home: hf?.htGoalSharePct ?? 45,
                away: af?.htGoalSharePct ?? 45
            },
            topScores: (an.topScores || []).slice(0, 3).map(s => `${s.s} (%${Math.round(s.p * 100)})`)
        },
        h2h: an.h2hSummary || 'Aralarında son dönemde kayıtlı maç bulunmuyor',
        commonOpponents: an.commonSummary || 'Ortak rakip karşılaştırması için yeterli veri yok',
        restAndFatigue: {
            home: {
                restHours: an.restH?.restHours ?? null,
                restDays: an.restH?.restDays ?? null,
                isFatigued: Boolean(an.restH?.isFatigued),
                label: an.restH?.label || 'Normal Fikstür'
            },
            away: {
                restHours: an.restA?.restHours ?? null,
                restDays: an.restA?.restDays ?? null,
                isFatigued: Boolean(an.restA?.isFatigued),
                label: an.restA?.label || 'Normal Fikstür'
            }
        },
        squadAndInjuries: {
            hasVerifiedData: hasSquadData,
            status: squadStatus,
            homeMissing: an.squad?.homeMissing || [],
            awayMissing: an.squad?.awayMissing || [],
            lineupType: an.squad?.lineupType || 'Veri Yok'
        },
        marketOdds: {
            available: hasFreshOdds,
            status: oddsStatus,
            oddsUpdatedAt: m.oddsFresh ? m.oddsUpdatedAt : null,
            odds: m.odds || null
        },
        dataTrust: an.dataTrust || null
    };

    // En mantıklı tercihi ve matematiksel dayanağını belirle
    const candidates = [
        { key: 'ms1', p: an.p?.ms1 || 0.40, label: LABEL.ms1 || 'MS 1' },
        { key: 'ms2', p: an.p?.ms2 || 0.30, label: LABEL.ms2 || 'MS 2' },
        { key: 'dc1x', p: an.p?.dc1x || 0.70, label: LABEL.dc1x || 'Çifte Şans 1-X' },
        { key: 'dcx2', p: an.p?.dcx2 || 0.60, label: LABEL.dcx2 || 'Çifte Şans X-2' },
        { key: 'ust25', p: an.p?.ust25 || 0.50, label: LABEL.ust25 || '2,5 Üst' },
        { key: 'alt25', p: an.p?.alt25 || 0.50, label: LABEL.alt25 || '2,5 Alt' },
        { key: 'kgv', p: an.p?.kgv || 0.50, label: LABEL.kgv || 'KG Var' },
        { key: 'kgy', p: an.p?.kgy || 0.50, label: LABEL.kgy || 'KG Yok' }
    ];

    let bestCandidate = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
        const odd = (hasFreshOdds && m.odds && typeof m.odds[c.key] === 'number') ? m.odds[c.key] : null;
        const ev = odd ? (c.p * odd - 1) : 0;
        let score = c.p * 100;
        if (ev > 0.05) score += ev * 35;
        if (c.p >= 0.55) score += 15;
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = { ...c, odd, ev: odd ? +(ev * 100).toFixed(1) : null };
        }
    }

    const pickProbPct = Math.round(bestCandidate.p * 100);
    const mathRationale = bestCandidate.odd
        ? `Modelimiz bu seçenek için %${pickProbPct} olasılık ve ${lhVal.toFixed(2)}-${laVal.toFixed(2)} xG projeksiyonu tespit etti. Piyasa ${bestCandidate.odd.toFixed(2)} oranı açarak ${bestCandidate.ev >= 0 ? '+' : ''}%${bestCandidate.ev} matematiksel beklenen değer (EV) sunuyor.`
        : `Modelimiz bu tercih için %${pickProbPct} gerçekleşme olasılığı ve ${lhVal.toFixed(2)}-${laVal.toFixed(2)} xG projeksiyonu ile istatistiksel üstünlük saptadı.`;

    // Risk ve Güven seviyeleri
    const minSample = Math.min(an.nh || 0, an.na || 0);
    let riskLevel = 'Orta Risk';
    if (minSample < 5 || (an.dataTrust && an.dataTrust.sufficiencyScore < 50)) {
        riskLevel = 'Yüksek Risk';
    } else if (pickProbPct >= 65 && (!an.dataTrust || an.dataTrust.overallScore >= 65) && !an.restH?.isFatigued && !an.restA?.isFatigued) {
        riskLevel = 'Düşük Risk';
    } else if (pickProbPct < 48) {
        riskLevel = 'Yüksek Risk';
    }

    let confidenceLevel = 'Orta Güven';
    if (minSample < 5 || (an.dataTrust && an.dataTrust.sufficiencyScore < 50)) {
        confidenceLevel = 'Düşük Güven (Sınırlı Veri)';
    } else if (an.dataTrust && an.dataTrust.overallScore >= 75) {
        confidenceLevel = 'Yüksek Güven';
    }

    // 2. Yusuf AI'ın Bağımsız Futbol Yorumu (6 Soruya Net Yanıtlar)
    // Soru 1: Maçın genel gidişatı ve temposu nasıl bekleniyor?
    let flowAndTempo = '';
    if (totalXg >= 2.90) {
        flowAndTempo = `Karşılaşmada yüksek tempolu, hücum hatlarının savunma arkasına sarkacağı ve geçiş oyunlarının belirleyici olacağı açık bir mücadele bekleniyor. Modelin toplam xG beklentisi ${totalXg} olup, her iki takımın son maçlardaki üretkenliği maçın erken dakikalarda hareketleneceğine işaret ediyor.`;
    } else if (totalXg <= 2.20) {
        flowAndTempo = `Taktiksel disiplinin ön planda olduğu, orta saha bloklarının birbirini kilitlediği ve düşük riskle oynanacak kontrollü bir maç temposu bekleniyor. Toplam xG beklentisinin ${totalXg} seviyesinde kalması, ilk golü atan tarafın skoru korumaya çekileceğini gösteriyor.`;
    } else {
        flowAndTempo = `Dengeli ve temkinli bir ilk yarı temposunun ardından 2. yarıda risklerin artacağı bir oyun bekleniyor. Toplam ${totalXg} xG projeksiyonu, maçın tek farklı galibiyet veya karşılıklı 1-2 gol sınırında seyredeceğine işaret ediyor.`;
    }
    if (an.tactical?.clashSummary) {
        flowAndTempo += ` Taktik eşleşmede: ${an.tactical.clashSummary}.`;
    }

    // Soru 2: Hangi takım neden avantajlı?
    let teamAdvantage = '';
    if (lhVal >= laVal + 0.35) {
        teamAdvantage = `${homeName}, iç saha baskısı, seyirci desteği ve ${lhVal.toFixed(2)} gol beklentisiyle sahaya avantajlı çıkan taraf.`;
        if (hf?.homeGf !== null && hf?.homeGf !== undefined) {
            teamAdvantage += ` Evinde maç başı ${hf.homeGf} gol ortalaması yakalayan ev sahibi, son 10 maçlık periyotta ${hf.last10Pts || '-'} puan ortalamasıyla daha istikrarlı bir grafik çiziyor.`;
        }
        if (an.restH?.restHours && an.restA?.restHours && an.restH.restHours > an.restA.restHours + 24) {
            teamAdvantage += ` Ayrıca ${homeName} dinlenme süresi bakımından rakibine göre daha dinç (${an.restH.label}).`;
        }
    } else if (laVal >= lhVal + 0.35) {
        teamAdvantage = `${awayName}, form ivmesi (${(an.momA || 1.0).toFixed(2)} çarpan) ve ${laVal.toFixed(2)} xG üretkenliğiyle deplasmanda olmasına rağmen avantajı elinde tutuyor.`;
        if (af?.awayGf !== null && af?.awayGf !== undefined) {
            teamAdvantage += ` Dış sahada maç başı ${af.awayGf} gol bulan konuk ekip, ev sahibinin savunma zaaflarını değerlendirmeye aday.`;
        }
    } else {
        teamAdvantage = `İki takım arasında belirgin bir güç farkı bulunmuyor; kadro kaliteleri ve form momentumları birbirine oldukça yakın (${homeName} ${(an.momH || 1.0).toFixed(2)}x vs ${awayName} ${(an.momA || 1.0).toFixed(2)}x). Maçın kaderini duran toplar veya bireysel savunma hataları belirleyecek.`;
    }

    // Soru 3: İstatistikler ile piyasa oranları arasında çelişki var mı?
    let statsVsMarket = '';
    if (hasFreshOdds) {
        const marketOdd = bestCandidate.odd;
        if (marketOdd) {
            const impliedProb = Math.round((1 / marketOdd) * 100);
            if (bestCandidate.ev && bestCandidate.ev > 4.0) {
                statsVsMarket = `İstatistiksel model ile piyasa oranları arasında kayda değer bir arbitraj (Value Bet) tespit edildi. Piyasa ${bestCandidate.label} tercihine ${marketOdd.toFixed(2)} oran açarak yalnızca %${impliedProb} şans tanırken, modelimizin bağımsız hesaplaması %${pickProbPct} olasılık gösteriyor (%${bestCandidate.ev} EV avantajı).`;
            } else {
                statsVsMarket = `Piyasa oranları ile modelin olasılık hesapları büyük oranda paralellik gösteriyor. Piyasanın ${marketOdd.toFixed(2)} oranı (%${impliedProb} ima edilen olasılık) modelin %${pickProbPct} projeksiyonu ile dengede; fahiş bir oran sapması bulunmuyor.`;
            }
        } else {
            statsVsMarket = `Piyasa temel 1-X-2 oranlarında dengeli görünürken, yan pazarlarda model beklentisine kıyasla ufak değer fırsatları barındırıyor.`;
        }
    } else {
        statsVsMarket = `Piyasada oranlar henüz kesinleşmediği veya bültende taze veri bulunmadığı için oran-olasılık makası matematiksel olarak teyit edilemedi; analiz saf maç içi ve geçmiş form metrikleriyle yürütülüyor.`;
    }

    // Soru 4: Beraberlik veya sürpriz ihtimali ne durumda?
    let drawAndSurprise = '';
    if (pMsX >= 28) {
        drawAndSurprise = `Beraberlik ihtimali %${pMsX} ile yabana atılmayacak bir seviyede. İki takımın kilit açma zorluğu ve skor koruma refleksleri, maçın 1-1 veya 0-0 gibi skorlara kilitlenme riskini artırıyor.`;
    } else {
        drawAndSurprise = `Beraberlik olasılığı %${pMsX} seviyesinde kalarak ikincil planda kalıyor; oyunun iki taraftan birinin lehine çözülmesi daha olası.`;
    }
    const underdog = pMs1 < pMs2 ? { name: homeName, p: pMs1, label: 'Ev Sahibi Sürprizi' } : { name: awayName, p: pMs2, label: 'Deplasman Sürprizi' };
    if (underdog.p >= 25 && underdog.p <= 38) {
        drawAndSurprise += ` Sürpriz arayanlar için ${underdog.name} lehine açılan yüksek oran (%${underdog.p} olasılık) değerlendirilebilir bir risk faktörü taşıyor.`;
    }

    // Soru 5: Maç için en mantıklı tercih nedir ve matematiksel dayanağı nedir?
    const bestPickEditorial = `Bu karşılaşma için en rasyonel tercih "${bestCandidate.label}". Matematiksel gerekçe: ${mathRationale} En olası skor projeksiyonları: ${(an.topScores || []).slice(0, 2).map(x => x.s).join(' ve ')}.`;

    // Soru 6: Karşılaşmanın ana risk faktörü nedir?
    let primaryRisk = '';
    if (an.restH?.isFatigued || an.restA?.isFatigued) {
        const fatiguedTeam = an.restH?.isFatigued ? homeName : awayName;
        const fatigueRest = an.restH?.isFatigued ? (an.restH.restHours ? `${an.restH.restHours} saat` : `${an.restH.restDays} gün`) : (an.restA.restHours ? `${an.restA.restHours} saat` : `${an.restA.restDays} gün`);
        primaryRisk = `Ana risk unsuru fikstür yorgunluğudur. ${fatiguedTeam} son maçından sonra yalnızca ${fatigueRest} dinlenebilmiştir; maçın son 30 dakikasında yaşanabilecek fiziksel düşüş ve savunma hataları oyun planını bozabilir.`;
    } else if (minSample < 5) {
        primaryRisk = `Ana risk faktörü geçmiş veri hacminin sınırlı olmasıdır (Minimum takım örneklemi: ${minSample} maç). Veri derinliği azaldıkça istatistiksel varyans artar; bu nedenle kupon payı ölçülü tutulmalıdır.`;
    } else if (hf && hf.cleanSheetPct <= 20 && af && af.cleanSheetPct <= 20) {
        primaryRisk = `Ana risk faktörü her iki takımın da kalesini gole kapatma oranının çok düşük olmasıdır (%${hf.cleanSheetPct} ve %${af.cleanSheetPct}). Erken yenilebilecek bir şok gol tüm oyun dengesini tersyüz edebilir.`;
    } else {
        primaryRisk = `Ana risk faktörü ilk yarıda gelebilecek erken kırmızı kart veya duran top golünün taktik disiplini erken bozma ihtimalidir.`;
    }
    if (!hasSquadData) {
        primaryRisk += ` Ayrıca resmi sakatlık ve kadro listesi henüz teyit edilmemiştir; son dakika ilk 11 değişiklikleri dikkate alınmalıdır.`;
    }

    // Tam metin (Markdown birleşik görünüm)
    const fullText = `### ⚽ Yusuf AI Maç Yorumu: ${homeName} vs ${awayName}
**1. Maçın Genel Gidişatı ve Temposu:**
${flowAndTempo}

**2. Takım Avantajı ve Gerekçesi:**
${teamAdvantage}

**3. İstatistikler ile Piyasa Oranları Arasındaki Durum:**
${statsVsMarket}

**4. Beraberlik ve Sürpriz İhtimali:**
${drawAndSurprise}

**5. En Mantıklı Tercih ve Matematiksel Dayanak:**
${bestPickEditorial}

**6. Karşılaşmanın Ana Risk Faktörü:**
${primaryRisk}`;

    const yusufAiEditorial = {
        question1_flowAndTempo: flowAndTempo,
        question2_teamAdvantage: teamAdvantage,
        question3_statsVsOdds: statsVsMarket,
        question4_drawAndSurprise: drawAndSurprise,
        question5_bestPick: bestPickEditorial,
        question6_riskFactor: primaryRisk,
        fullText
    };

    // 3. Nihai Değerlendirme (4-5 Zorunlu Alan)
    const finalAssessment = {
        statisticalOutcome: `xG: ${lhVal.toFixed(2)} - ${laVal.toFixed(2)} | Model: MS1 %${pMs1}, MSX %${pMsX}, MS2 %${pMs2} | 2.5Üst %${pUst25}, KGVar %${pKgv}`,
        yusufAiVerdict: `${homeName} - ${awayName} mücadelesinde matematiksel veriler "${bestCandidate.label}" tercihini (%${pickProbPct} olasılık) öne çıkarıyor. ${riskLevel} kategorisinde bir eşleşme.`,
        bestPick: {
            selection: bestCandidate.label,
            marketKey: bestCandidate.key,
            probabilityPct: pickProbPct,
            odd: bestCandidate.odd || null,
            valueBet: Boolean(bestCandidate.ev && bestCandidate.ev > 3.0),
            rationale: mathRationale
        },
        riskLevel,
        confidenceLevel
    };

    return {
        statisticalSummary,
        yusufAiEditorial,
        finalAssessment
    };
}

async function generateAiCommentaryAsync(m, an, opts = {}) {
    const base = generateMatchCommentary(m, an, opts);
    const activeKey = (opts.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim();

    if (!activeKey || opts.forceDeterministic === true) {
        return base;
    }

    try {
        const isGemini = activeKey.startsWith('AIza') || activeKey.startsWith('AQ.');
        const isOpenRouter = activeKey.startsWith('sk-or-');
        const isOpenAi = activeKey.startsWith('sk-') && !isOpenRouter;
        const isGroq = activeKey.startsWith('gsk_');

        let baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
        let modelName = 'gemini-2.5-flash';
        if (isOpenRouter) {
            baseUrl = 'https://openrouter.ai/api/v1';
            modelName = 'google/gemini-2.5-flash';
        } else if (isOpenAi) {
            baseUrl = 'https://api.openai.com/v1';
            modelName = 'gpt-4o-mini';
        } else if (isGroq) {
            baseUrl = 'https://api.groq.com/openai/v1';
            modelName = 'llama-3.3-70b-versatile';
        }

        const prompt = `Aşağıdaki doğrulanmış futbol istatistiklerini baz alarak akıcı bir Yusuf AI futbol yorumu oluştur.
KURALLAR:
1. Kesinlikle uydurma sakatlık, oyuncu veya veri ekleme.
2. Sırasıyla şu 6 soruya cevap ver:
   1. Maçın genel gidişatı ve temposu nasıl bekleniyor?
   2. Hangi takım neden avantajlı?
   3. İstatistikler ile piyasa oranları arasında çelişki var mı?
   4. Beraberlik veya sürpriz ihtimali ne durumda?
   5. Maç için en mantıklı tercih nedir ve matematiksel dayanağı nedir?
   6. Karşılaşmanın ana risk faktörü nedir?
3. Yanıtı markdown formatında ver.

VERİLER:
${JSON.stringify(base.statisticalSummary, null, 2)}
MEVCUT YORUM:
${base.yusufAiEditorial.fullText}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${activeKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: 'Sen Yusuf AI futbol yorumcususun. Verilere sadık, analitik ve doğal futbol yorumları yaparsın.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1000
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const json = await response.json();
            const aiText = json.choices?.[0]?.message?.content?.trim();
            if (aiText && aiText.length > 100) {
                return {
                    ...base,
                    yusufAiEditorial: {
                        ...base.yusufAiEditorial,
                        fullText: aiText,
                        enhancedByLlm: true
                    }
                };
            }
        }
    } catch (_) {
        // Fallback to deterministic commentary
    }

    return base;
}

module.exports = {
    buildModel,
    analyze,
    picksOf,
    computeExpectedValue,
    buildCoupons,
    outcomeKeys,
    teamFacts,
    LABEL,
    qualifies,
    generateRationale,
    isMainstreamMatch,
    evaluateModelPerformance,
    selectTopPreMatchPick,
    buildSystem345,
    settleSystem345,
    computeJointConfidenceInterval,
    MARKET_COMPANIONS,
    isModelPerformanceVerified,
    getModelVerificationMetrics,
    evaluateBetOutcome,
    recordPlacedCoupon,
    getPlacedCoupon,
    loadPlacedCoupons,
    savePlacedCoupons,
    setUpstashTransportForTesting,
    executeUpstashCommandSync,
    executeUpstashCommandAsync,
    verifyWalkForwardIntegrity,
    computeFormMomentum,
    computeRestAndFatigue,
    analyzeH2HAndCommon,
    computeDataTrustMetrics,
    getSortedMatchesDesc,
    getMatchTimestamp,
    isMatchStrictlyPrior,
    generateMatchCommentary,
    generateAiCommentaryAsync
};





