// Analiz motoru: takım gücü -> beklenen goller -> tüm pazarların olasılığı -> kupon seçimi.
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

// ---------------- Model kurulumu (geçmişten takım gücü) ----------------
function buildModel(hist, asOf) {
    const asOfT = new Date(asOf + 'T00:00:00Z').getTime();
    const rows = [];
    for (const m of hist) {
        if (m.state !== 'post' || !m.score || !m.ht || m.date >= asOf) continue;
        const days = (asOfT - new Date(m.date + 'T00:00:00Z').getTime()) / 86400000;
        if (days > WINDOW) continue;
        rows.push({ m, w: Math.pow(0.5, days / HALF_LIFE) });
    }

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
    glob.muH = glob.gh / glob.w; glob.muA = glob.ga / glob.w; glob.s1 = glob.g1 / glob.g;
    const lgStat = (id) => {
        const lg = leagues.get(id);
        if (!lg || lg.n < 25) return { muH: glob.muH, muA: glob.muA, s1: glob.s1, n: lg ? lg.n : 0 };
        const k = 12;  // lig ortalamasını globale doğru küçült
        return {
            muH: (lg.gh + k * glob.muH) / (lg.w + k),
            muA: (lg.ga + k * glob.muA) / (lg.w + k),
            s1: (lg.g1 + 8 * glob.s1) / (lg.g + 8),
            n: lg.n
        };
    };

    // Geçiş 2: takım istatistikleri (beklentiye göre normalize)
    const teams = new Map();
    const T = (id, name) => {
        let t = teams.get(id);
        if (!t) { t = { id, name, n: 0, w: 0, gf: 0, bgf: 0, ga: 0, bga: 0, gf1: 0, ga1: 0, last: [] }; teams.set(id, t); }
        t.name = name; return t;
    };
    for (const { m, w } of rows) {
        const L = lgStat(m.league.id);
        const h = T(m.homeId, m.home), a = T(m.awayId, m.away);
        h.n++; h.w += w; h.gf += w * m.score.h; h.bgf += w * L.muH; h.ga += w * m.score.a; h.bga += w * L.muA; h.gf1 += w * m.ht.h; h.ga1 += w * m.ht.a;
        a.n++; a.w += w; a.gf += w * m.score.a; a.bgf += w * L.muA; a.ga += w * m.score.h; a.bga += w * L.muH; a.gf1 += w * m.ht.a; a.ga1 += w * m.ht.h;
        h.last.push({ date: m.date, opp: m.away, home: true, gf: m.score.h, ga: m.score.a, ht: m.ht });
        a.last.push({ date: m.date, opp: m.home, home: false, gf: m.score.a, ga: m.score.h, ht: { h: m.ht.a, a: m.ht.h } });
    }
    for (const t of teams.values()) t.last.sort((x, y) => (x.date < y.date ? 1 : -1));

    // Temel oranlar (lift hesabı için): geçmiş maçlarda her pazarın gerçekleşme sıklığı
    const base = {}; let nb = 0;
    for (const { m } of rows) {
        nb++;
        for (const k of outcomeKeys(m.score.h, m.score.a, m.ht.h, m.ht.a)) base[k] = (base[k] || 0) + 1;
    }
    for (const k of Object.keys(base)) base[k] /= nb;

    return { asOf, teams, glob, lgStat, base, nRows: rows.length };
}

// ---------------- Gerçekleşen sonuçtan pazar anahtarları ----------------
function outcomeKeys(gh, ga, h1, a1) {
    const k = [], tot = gh + ga, t1 = h1 + a1, t2 = tot - t1;
    const ft = ['1', 'X', '2'][outcome3(gh - ga)], ht = ['1', 'X', '2'][outcome3(h1 - a1)];
    k.push('ms' + ft.toLowerCase());
    if (ft !== '2') k.push('dc1x'); if (ft !== '1') k.push('dcx2'); if (ft !== 'X') k.push('dc12');
    k.push(tot > 1.5 ? 'ust15' : 'alt15', tot > 2.5 ? 'ust25' : 'alt25', tot > 3.5 ? 'ust35' : 'alt35');
    k.push(gh > 0 && ga > 0 ? 'kgv' : 'kgy');
    k.push('iy' + ht.toLowerCase());
    k.push(t1 > 0.5 ? 'iyust05' : 'iyalt05', t1 > 1.5 ? 'iyust15' : 'iyalt15');
    if (h1 > 0 && a1 > 0) k.push('iykgv');
    if (t2 > 0.5) k.push('y2ust05'); if (t2 > 1.5) k.push('y2ust15');
    k.push(t1 > t2 ? 'yari1' : t1 < t2 ? 'yari2' : 'yarix');
    k.push('htft_' + ht + '/' + ft);
    return k;
}

// ---------------- Etiketler ve gruplar ----------------
const LABEL = {
    ms1: 'MS 1', msx: 'MS X', ms2: 'MS 2', dc1x: 'Çifte Şans 1-X', dcx2: 'Çifte Şans X-2', dc12: 'Çifte Şans 1-2',
    ust15: '1,5 Üst', alt15: '1,5 Alt', ust25: '2,5 Üst', alt25: '2,5 Alt', ust35: '3,5 Üst', alt35: '3,5 Alt',
    kgv: 'KG Var', kgy: 'KG Yok',
    iy1: 'İY 1', iyx: 'İY X', iy2: 'İY 2', iyust05: 'İY 0,5 Üst', iyalt05: 'İY 0,5 Alt', iyust15: 'İY 1,5 Üst', iyalt15: 'İY 1,5 Alt', iykgv: 'İY KG Var',
    y2ust05: '2. Yarı 0,5 Üst', y2ust15: '2. Yarı 1,5 Üst',
    yari1: 'Daha Çok Gol: 1. Yarı', yari2: 'Daha Çok Gol: 2. Yarı', yarix: 'Daha Çok Gol: Eşit'
};
const GROUP = {
    ms1: 'ms', msx: 'msx', ms2: 'ms', dc1x: 'dc', dcx2: 'dc', dc12: 'dc',
    ust15: 'ou', alt15: 'ou', ust25: 'ou', alt25: 'ou', ust35: 'ou', alt35: 'ou', kgv: 'kg', kgy: 'kg',
    iy1: 'iy', iyx: 'iy', iy2: 'iy', iyust05: 'iyou', iyalt05: 'iyou', iyust15: 'iyou', iyalt15: 'iyou', iykgv: 'iykg',
    y2ust05: 'y2', y2ust15: 'y2', yari1: 'yari', yari2: 'yari', yarix: 'yari'
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

function computeMarkets(lh, la, sh, sa) {
    const lh1 = lh * sh, la1 = la * sa, lh2 = lh - lh1, la2 = la - la1;
    const L1 = lh1 + la1, L2 = lh2 + la2;
    const N = 9, G = dcGrid(lh, la, N);
    const p = {}; let w = 0, d = 0, a = 0, ov = [0, 0, 0], kg = 0;
    const scores = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const q = G[i][j];
        if (i > j) w += q; else if (i === j) d += q; else a += q;
        const t = i + j; if (t > 1) ov[0] += q; if (t > 2) ov[1] += q; if (t > 3) ov[2] += q;
        if (i > 0 && j > 0) kg += q;
        scores.push({ s: i + '-' + j, p: q });
    }
    p.ms1 = w; p.msx = d; p.ms2 = a; p.dc1x = w + d; p.dcx2 = d + a; p.dc12 = w + a;
    p.ust15 = ov[0]; p.alt15 = 1 - ov[0]; p.ust25 = ov[1]; p.alt25 = 1 - ov[1]; p.ust35 = ov[2]; p.alt35 = 1 - ov[2];
    p.kgv = kg; p.kgy = 1 - kg;

    // Devreler (bağımsız Poisson)
    const pt1 = pmfArr(L1, 14), pt2 = pmfArr(L2, 14);
    p.iyalt05 = pt1[0]; p.iyust05 = 1 - pt1[0]; p.iyalt15 = pt1[0] + pt1[1]; p.iyust15 = 1 - p.iyalt15;
    p.iykgv = (1 - Math.exp(-lh1)) * (1 - Math.exp(-la1));
    p.y2ust05 = 1 - pt2[0]; p.y2ust15 = 1 - pt2[0] - pt2[1];
    let y1 = 0, y2 = 0, yx = 0;
    for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) { const q = pt1[i] * pt2[j]; if (i > j) y1 += q; else if (i < j) y2 += q; else yx += q; }
    p.yari1 = y1; p.yari2 = y2; p.yarix = yx;

    // İY sonucu ve İY/MS (2. yarı farkı Skellam ile)
    const N1 = 8, P1 = pmfArr(lh1, N1), Q1 = pmfArr(la1, N1);
    const P2 = pmfArr(lh2, N1), Q2 = pmfArr(la2, N1);
    const D2 = {};
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) D2[i - j] = (D2[i - j] || 0) + P2[i] * Q2[j];
    const htft = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], htScores = [];
    const iyo = [0, 0, 0];
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) {
        const q = P1[i] * Q1[j], ho = outcome3(i - j);
        iyo[ho] += q; htScores.push({ s: i + '-' + j, p: q });
        for (const dk of Object.keys(D2)) htft[ho][outcome3(i - j + +dk)] += q * D2[dk];
    }
    // FT sonuçlarını DC'li ana dağılımla uyumlu hale getir
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
    return { p, topScores: scores.slice(0, 3), topHtScores: htScores.slice(0, 2), lh1, la1, lh2, la2 };
}

// ---------------- Takım özeti ----------------
function teamFacts(t) {
    if (!t) return null;
    const last = t.last.slice(0, 8);
    const g = (f) => (last.length ? last.reduce((s, x) => s + f(x), 0) / last.length : null);
    const r1 = (v) => (v === null ? null : Math.round(v * 100) / 100);
    const form = t.last.slice(0, 5).map(x => (x.gf > x.ga ? 'G' : x.gf === x.ga ? 'B' : 'M')).join('');
    return {
        n: t.n, form,
        gf: r1(g(x => x.gf)), ga: r1(g(x => x.ga)),
        gf1: r1(g(x => x.ht.h)), ga1: r1(g(x => x.ht.a)),
        over25: r1(g(x => (x.gf + x.ga > 2.5 ? 1 : 0))), btts: r1(g(x => (x.gf > 0 && x.ga > 0 ? 1 : 0))),
        iyGol: r1(g(x => (x.ht.h + x.ht.a > 0 ? 1 : 0))),
        son: t.last.slice(0, 5).map(x => `${x.home ? 'E' : 'D'} ${x.opp} ${x.gf}-${x.ga}`)
    };
}

// ---------------- Maç analizi ----------------
function analyze(model, m, opts = {}) {
    const useMarket = opts.useMarket !== false;
    const th = model.teams.get(m.homeId), ta = model.teams.get(m.awayId);
    const L = model.lgStat(m.league.id), g = model.glob;
    const att = (t) => (t ? (t.gf + K * g.muH) / (t.bgf + K * g.muH) : 1);
    const dfn = (t) => (t ? (t.ga + K * g.muH) / (t.bga + K * g.muH) : 1);
    const lhM = L.muH * att(th) * dfn(ta);
    const laM = L.muA * att(ta) * dfn(th);
    let lh = Math.min(3.8, Math.max(0.25, lhM)), la = Math.min(3.8, Math.max(0.25, laM));

    // Piyasa verisiyle harmanla (piyasa ücretsiz en keskin ön bilgi)
    let market = null, marketUsed = false, lhMk = null, laMk = null;
    const o = m.odds;
    if (o && o.h && o.d && o.a) {
        const inv = [1 / o.h, 1 / o.d, 1 / o.a], s = inv[0] + inv[1] + inv[2];
        const pO = o.alt25 && o.ust25 ? (1 / o.ust25) / (1 / o.ust25 + 1 / o.alt25) : null;
        market = { p1: inv[0] / s, pX: inv[1] / s, p2: inv[2] / s, pO };
        [lhMk, laMk] = fitLambda(market.p1, market.pX, market.p2, pO, lh, la);
        if (useMarket) { lh = 0.4 * lh + 0.6 * lhMk; la = 0.4 * la + 0.6 * laMk; marketUsed = true; }
    }

    // Devre payları
    const sh = (t, f1, f) => (t ? (t[f1] + 6 * L.s1) / (t[f] + 6) : L.s1);
    const shareH = 0.5 * (sh(th, 'gf1', 'gf') + sh(ta, 'ga1', 'ga'));
    const shareA = 0.5 * (sh(ta, 'gf1', 'gf') + sh(th, 'ga1', 'ga'));
    const clamp = (v) => Math.min(0.6, Math.max(0.3, v));
    const mkts = computeMarkets(lh, la, clamp(shareH), clamp(shareA));

    // Veri kalitesi
    const nh = th ? th.n : 0, na = ta ? ta.n : 0;
    const quality = Math.min(nh, na) >= 6 && L.n >= 25 ? 'A' : Math.min(nh, na) >= 3 ? 'B' : 'C';

    return {
        lh, la, quality, marketUsed, market, p: mkts.p, topScores: mkts.topScores, topHtScores: mkts.topHtScores,
        pModel1X2: null, nh, na, leagueN: L.n,
        facts: opts.facts ? { home: teamFacts(th), away: teamFacts(ta) } : undefined
    };
}

// ---------------- Pick listesi ----------------
function picksOf(match, an) {
    const out = [];
    for (const [key, pv] of Object.entries(an.p)) {
        let label, group;
        if (key.startsWith('htft_')) { label = 'İY/MS ' + key.slice(5); group = 'htft'; }
        else { label = LABEL[key]; group = GROUP[key]; }
        if (!label) continue;
        out.push({ key, label, group, p: pv, matchId: match.id });
    }
    return out;
}

const BANKO_KEYS = ['ms1', 'ms2', 'dc1x', 'dcx2', 'dc12', 'ust15', 'alt25', 'alt35', 'kgv', 'kgy', 'ust25'];
const SURPRISE_GROUPS = ['htft', 'msx', 'ms', 'iy', 'iykg', 'yari'];

function qualifies(match, an, minQ) {
    if (match.state !== 'pre') return false;
    if (new Date(match.kickoff).getTime() < Date.now() + 5 * 60000) return false;
    return an.quality === 'A' || (minQ === 'B' && an.quality === 'B');
}

function generateRationale(pk, m, an) {
    const totG = (an.lh + an.la).toFixed(2);
    const pStr = '%' + (pk.p * 100).toFixed(0);
    const liftStr = pk.lift ? pk.lift.toFixed(1) + ' kat' : '';

    if (pk.key === 'ust15') {
        return `Toplam beklenen gol ${totG}. İki takımın hücum aksiyonları güçlü, model ${pStr} olasılıkla en az 2 gol öngörüyor.`;
    }
    if (pk.key === 'alt25' || pk.key === 'alt35') {
        return `Savunma ağırlıklı tempo; beklenen gol ${totG} seviyesinde. ${pk.label} ihtimali ${pStr}.`;
    }
    if (pk.key === 'ust25') {
        return `Hücum tempolu eşleşme; ${totG} beklenen gol ile model ${pStr} güvenle 3 gol barajının aşılmasını bekliyor.`;
    }
    if (pk.key === 'kgv') {
        return `Ev sahibi (${an.lh.toFixed(2)} beklenen gol) ve deplasman (${an.la.toFixed(2)} beklenen gol) üretken. ${pStr} karşılıklı gol beklentisi.`;
    }
    if (pk.key === 'dc1x') {
        return `${m.home} sahasında sağlam. Yenilmeme olasılığı modelde ${pStr} ile en yüksek güven grubunda.`;
    }
    if (pk.key === 'dcx2') {
        return `${m.away} deplasmanda dirençli ve puan alma ihtimali modelde ${pStr} olarak hesaplandı.`;
    }
    if (pk.key === 'ms1') {
        return `${m.home} saha avantajı ve hücum gücüyle öne çıkıyor. Galibiyet olasılığı ${pStr}${pk.lift ? ' (tabanın ' + liftStr + ' üstünde)' : ''}.`;
    }
    if (pk.key === 'ms2') {
        return `${m.away} deplasmanda net bir kalite üstünlüğüne sahip. Galibiyet ihtimali ${pStr}.`;
    }
    if (pk.key === 'msx') {
        return `İki takım denk güçte ve düşük skor eğiliminde. Beraberlik olasılığı ${pStr} (${liftStr} istatistiksel avantaj).`;
    }
    if (pk.key.startsWith('iy1') || pk.key.startsWith('iy2')) {
        const team = pk.key === 'iy1' ? m.home : m.away;
        return `${team} maçlara yoğun pres ve erken hücumla başlıyor. İlk yarıyı önde tamamlama ihtimali ${pStr} (${liftStr} değer potansiyeli).`;
    }
    if (pk.key.startsWith('htft_')) {
        const sub = pk.key.slice(5);
        return `Yüksek değerli İY/MS tercihi (${sub}). Model ${pStr} olasılık öngörüyor; bu oran normal maç dağılımının ${liftStr} üzerinde.`;
    }
    if (pk.key === 'yari2') {
        return `Maçın 2. yarısında açılması bekleniyor. İkinci yarıda daha çok gol olma ihtimali ${pStr}.`;
    }
    return `Modelin ${pStr} olasılık ve ${liftStr || 'yüksek güven'} ile öne çıkardığı istatistiksel tercih.`;
}

function buildCoupons(items, model, opts = {}) {
    const bankoN = opts.bankoN || 4, surpN = opts.surpN || 5;
    
    // BANKO: A kalitesi adaylar azsa B kalitesine genişlet
    let cands = items.filter(it => qualifies(it.m, it.an, 'A'));
    if (cands.length < bankoN) {
        cands = items.filter(it => qualifies(it.m, it.an, 'B'));
    }

    const bankoPool = [];
    for (const it of cands) {
        const best = picksOf(it.m, it.an).filter(p => BANKO_KEYS.includes(p.key)).sort((a, b) => b.p - a.p)[0];
        if (best) {
            bankoPool.push({
                ...best,
                rationale: generateRationale(best, it.m, it.an),
                m: it.m,
                an: it.an
            });
        }
    }
    bankoPool.sort((a, b) => b.p - a.p);
    const banko = bankoPool.slice(0, bankoN);

    // SÜRPRİZ: düşük ihtimalli ama modelin sıradan oranın katbekat üstünde gördüğü seçimler
    const used = new Set(banko.map(b => b.matchId));
    const surpPool = [];
    for (const it of items.filter(x => qualifies(x.m, x.an, 'B'))) {
        let best = null;
        for (const pk of picksOf(it.m, it.an)) {
            if (!SURPRISE_GROUPS.includes(pk.group)) continue;
            if (pk.p < 0.15 || pk.p > 0.55) continue;
            const baseRate = model.base[pk.key] || 0.05;
            const lift = pk.p / baseRate;
            if (lift < 1.25) continue;
            // piyasa varsa: model piyasadan fazla görmeli
            const mkt = it.an.market;
            if (mkt && (pk.key === 'ms1' || pk.key === 'ms2' || pk.key === 'msx')) {
                const mp = pk.key === 'ms1' ? mkt.p1 : pk.key === 'msx' ? mkt.pX : mkt.p2;
                if (pk.p < mp) continue;
            }
            const score = pk.p * Math.min(lift, 3);
            if (!best || score > best.score) best = { ...pk, lift, score, m: it.m, an: it.an };
        }
        if (best) {
            surpPool.push({
                ...best,
                rationale: generateRationale(best, best.m, best.an)
            });
        }
    }
    surpPool.sort((a, b) => b.score - a.score);
    const surprise = surpPool.filter(s => !used.has(s.matchId)).slice(0, surpN);

    const bankoConfidence = banko.length ? Math.round((banko.reduce((s, x) => s + x.p, 0) / banko.length) * 100) : 0;
    const surpAvgLift = surprise.length ? (surprise.reduce((s, x) => s + x.lift, 0) / surprise.length).toFixed(1) : '1.0';

    return {
        banko: {
            title: 'Günün Banko Kuponu',
            type: 'banko',
            strategy: 'Yüksek Güvenilirlikli Kombine',
            instruction: 'Bu maçlar modelde %85+ gerçekleşme ihtimaline sahip en güvenli tercihlerdir. Düz 4 maçlık kombine kupon olarak oynayabilirsiniz.',
            confidence: bankoConfidence,
            matches: banko
        },
        surprise: {
            title: 'Günün Yüksek Değer Sürpriz Kuponu',
            type: 'surprise',
            strategy: 'İstatistiksel Avantajlı Sürpriz (İY/MS & İY Tercihleri)',
            instruction: 'Düşük bütçeli sürpriz denemesi için düz 5 maçlık kombine veya 3-4-5 sistem kuponu şeklinde oynanması tavsiye edilir. İstatistiksel taban beklentisinden katbekat yüksek değer taşıyan maçlardır.',
            avgLift: surpAvgLift,
            matches: surprise
        }
    };
}

module.exports = { buildModel, analyze, picksOf, buildCoupons, outcomeKeys, teamFacts, LABEL, qualifies, generateRationale };

