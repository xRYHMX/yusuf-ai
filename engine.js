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
                last: []
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

        h.last.push({ date: m.date, oppId: m.awayId, opp: m.away, home: true, gf: m.score.h, ga: m.score.a, ht: m.ht });
        a.last.push({ date: m.date, oppId: m.homeId, opp: m.home, home: false, gf: m.score.a, ga: m.score.h, ht: { h: m.ht.a, a: m.ht.h } });
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

    // Nesine yüksek oranlı kombinasyon ve özel sürpriz pazarları
    if (gh > ga && tot >= 3) k.push('ms1_ust25');
    if (ga > gh && tot >= 3) k.push('ms2_ust25');
    if (gh > ga && gh > 0 && ga > 0) k.push('ms1_kgv');
    if (ga > gh && gh > 0 && ga > 0) k.push('ms2_kgv');
    if (gh === ga && gh > 0) k.push('msx_kgv');
    if (tot >= 3 && gh > 0 && ga > 0) k.push('ust25_kgv');
    if (gh - ga >= 2) k.push('hms1');
    if (ga - gh >= 2) k.push('hms2');
    if (tot >= 4 && tot <= 6) k.push('tg46');

    // İlk yarı ve maç sonucu kesin skor pazarları
    if (h1 <= 2 && a1 <= 2) k.push(`iyskor_${h1}_${a1}`);
    if (gh <= 3 && ga <= 3) k.push(`msskor_${gh}_${ga}`);

    return k;
}

// ---------------- Etiketler ve gruplar ----------------
const LABEL = {
    ms1: 'MS 1', msx: 'MS X', ms2: 'MS 2', dc1x: 'Çifte Şans 1-X', dcx2: 'Çifte Şans X-2', dc12: 'Çifte Şans 1-2',
    ust15: '1,5 Üst', alt15: '1,5 Alt', ust25: '2,5 Üst', alt25: '2,5 Alt', ust35: '3,5 Üst', alt35: '3,5 Alt',
    kgv: 'KG Var', kgy: 'KG Yok',
    iy1: 'İY 1', iyx: 'İY X', iy2: 'İY 2', iyust05: 'İY 0,5 Üst', iyalt05: 'İY 0,5 Alt', iyust15: 'İlk Yarı 1,5 Üst', iyalt15: 'İY 1,5 Alt',
    iykgv: 'İlk Yarı KG Var', y2kgv: '2. Yarı KG Var', ikiyari_gol: 'Her İki Yarıda Gol',
    y2ust05: '2. Yarı 0,5 Üst', y2ust15: '2. Yarı 1,5 Üst',
    yari1: 'Daha Çok Gol: 1. Yarı', yari2: 'Daha Çok Gol: 2. Yarı', yarix: 'Daha Çok Gol: Eşit',
    ms1_ust25: 'MS 1 & 2,5 Üst', ms2_ust25: 'MS 2 & 2,5 Üst',
    ms1_kgv: 'MS 1 & KG Var', ms2_kgv: 'MS 2 & KG Var', msx_kgv: 'MS X & KG Var',
    ust25_kgv: '2,5 Üst & KG Var',
    hms1: 'Handikaplı MS 1 (-1)', hms2: 'Handikaplı MS 2 (-1)',
    tg46: 'Toplam 4-6 Gol',
    iyskor_1_0: 'İY Skor 1-0', iyskor_0_1: 'İY Skor 0-1', iyskor_1_1: 'İY Skor 1-1', iyskor_2_0: 'İY Skor 2-0', iyskor_0_2: 'İY Skor 0-2',
    msskor_2_1: 'MS Skor 2-1', msskor_1_2: 'MS Skor 1-2', msskor_2_2: 'MS Skor 2-2', msskor_3_1: 'MS Skor 3-1', msskor_1_3: 'MS Skor 1-3'
};
const GROUP = {
    ms1: 'ms', msx: 'msx', ms2: 'ms', dc1x: 'dc', dcx2: 'dc', dc12: 'dc',
    ust15: 'ou', alt15: 'ou', ust25: 'ou', alt25: 'ou', ust35: 'ou', alt35: 'ou', kgv: 'kg', kgy: 'kg',
    iy1: 'iy', iyx: 'iy', iy2: 'iy', iyust05: 'iyou', iyalt05: 'iyou', iyust15: 'iy_ust', iyalt15: 'iyou',
    iykgv: 'iy_kg', y2kgv: 'y2_kg', ikiyari_gol: 'iki_yari',
    y2ust05: 'y2', y2ust15: 'y2_ust', yari1: 'yari', yari2: 'yari', yarix: 'yari',
    ms1_ust25: 'ms_ou', ms2_ust25: 'ms_ou',
    ms1_kgv: 'ms_kg', ms2_kgv: 'ms_kg', msx_kgv: 'ms_kg',
    ust25_kgv: 'ou_kg',
    hms1: 'hms', hms2: 'hms',
    tg46: 'tg',
    iyskor_1_0: 'iyskor', iyskor_0_1: 'iyskor', iyskor_1_1: 'iyskor', iyskor_2_0: 'iyskor', iyskor_0_2: 'iyskor',
    msskor_2_1: 'msskor', msskor_1_2: 'msskor', msskor_2_2: 'msskor', msskor_3_1: 'msskor', msskor_1_3: 'msskor'
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
    const p = {};
    let w = 0, d = 0, a = 0, ov = [0, 0, 0], kg = 0;
    let ms1Ust25 = 0, ms2Ust25 = 0, ms1Kgv = 0, ms2Kgv = 0, msxKgv = 0, ust25Kgv = 0;
    let hms1 = 0, hms2 = 0, tg46 = 0;
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
        if (t > 1) ov[0] += q; if (t > 2) ov[1] += q; if (t > 3) ov[2] += q;
        if (i > 0 && j > 0) {
            kg += q;
            if (t >= 3) ust25Kgv += q;
        }
        if (t >= 4 && t <= 6) tg46 += q;
        scores.push({ s: i + '-' + j, p: q });
    }
    p.ms1 = w; p.msx = d; p.ms2 = a; p.dc1x = w + d; p.dcx2 = d + a; p.dc12 = w + a;
    p.ust15 = ov[0]; p.alt15 = 1 - ov[0]; p.ust25 = ov[1]; p.alt25 = 1 - ov[1]; p.ust35 = ov[2]; p.alt35 = 1 - ov[2];
    p.kgv = kg; p.kgy = 1 - kg;

    // Nesine yüksek oranlı kombinasyon pazarları
    p.ms1_ust25 = ms1Ust25; p.ms2_ust25 = ms2Ust25;
    p.ms1_kgv = ms1Kgv; p.ms2_kgv = ms2Kgv; p.msx_kgv = msxKgv;
    p.ust25_kgv = ust25Kgv;
    p.hms1 = hms1; p.hms2 = hms2;
    p.tg46 = tg46;

    // MS kesin skor pazarları
    p.msskor_2_1 = G[2][1]; p.msskor_1_2 = G[1][2]; p.msskor_2_2 = G[2][2];
    p.msskor_3_1 = G[3][1]; p.msskor_1_3 = G[1][3];

    // Devreler (bağımsız Poisson)
    const pt1 = pmfArr(L1, 14), pt2 = pmfArr(L2, 14);
    p.iyalt05 = pt1[0]; p.iyust05 = 1 - pt1[0]; p.iyalt15 = pt1[0] + pt1[1]; p.iyust15 = 1 - p.iyalt15;
    p.iykgv = (1 - Math.exp(-lh1)) * (1 - Math.exp(-la1));
    p.y2kgv = (1 - Math.exp(-lh2)) * (1 - Math.exp(-la2));
    p.y2ust05 = 1 - pt2[0]; p.y2ust15 = 1 - pt2[0] - pt2[1];
    p.ikiyari_gol = p.iyust05 * p.y2ust05;

    let y1 = 0, y2 = 0, yx = 0;
    for (let i = 0; i <= 14; i++) for (let j = 0; j <= 14; j++) { const q = pt1[i] * pt2[j]; if (i > j) y1 += q; else if (i < j) y2 += q; else yx += q; }
    p.yari1 = y1; p.yari2 = y2; p.yarix = yx;

    // İY sonucu, İY kesin skorlar ve İY/MS (2. yarı farkı Skellam ile)
    const N1 = 8, P1 = pmfArr(lh1, N1), Q1 = pmfArr(la1, N1);
    const P2 = pmfArr(lh2, N1), Q2 = pmfArr(la2, N1);
    p.iyskor_1_0 = P1[1] * Q1[0]; p.iyskor_0_1 = P1[0] * Q1[1]; p.iyskor_1_1 = P1[1] * Q1[1];
    p.iyskor_2_0 = P1[2] * Q1[0]; p.iyskor_0_2 = P1[0] * Q1[2];

    const D2 = {};
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) D2[i - j] = (D2[i - j] || 0) + P2[i] * Q2[j];
    const htft = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], htScores = [];
    const iyo = [0, 0, 0];
    for (let i = 0; i <= N1; i++) for (let j = 0; j <= N1; j++) {
        const q = P1[i] * Q1[j], ho = outcome3(i - j);
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
    return { p, topScores: scores.slice(0, 3), topHtScores: htScores.slice(0, 2), lh1, la1, lh2, la2 };
}

// ---------------- Derin Takım Özeti (Ev/Dep Karnesi & Maç Senaryosu) ----------------
function teamFacts(t) {
    if (!t) return null;
    const last = t.last.slice(0, 10);
    const homeGames = t.last.filter(x => x.home).slice(0, 6);
    const awayGames = t.last.filter(x => !x.home).slice(0, 6);

    const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
    const r1 = (v) => (v === null ? null : Math.round(v * 100) / 100);
    const formStr = (arr, n = 5) => arr.slice(0, n).map(x => (x.gf > x.ga ? 'G' : x.gf === x.ga ? 'B' : 'M')).join('');

    // Senaryo analizi: İlk yarı öndeyken koruma & gerideyken çevirme
    const htLeads = last.filter(x => x.ht && x.ht.h > x.ht.a);
    const leadHoldPct = htLeads.length ? Math.round((htLeads.filter(x => x.gf > x.ga).length / htLeads.length) * 100) : null;
    const htTrails = last.filter(x => x.ht && x.ht.h < x.ht.a);
    const comebackPct = htTrails.length ? Math.round((htTrails.filter(x => x.gf >= x.ga).length / htTrails.length) * 100) : null;
    const cleanSheetPct = last.length ? Math.round((last.filter(x => x.ga === 0).length / last.length) * 100) : 0;

    return {
        n: t.n,
        hn: t.hn,
        an: t.an,
        form: formStr(t.last, 5),
        formStr: formStr(t.last, 5),
        homeForm: formStr(homeGames, 5),
        awayForm: formStr(awayGames, 5),
        gf: r1(avg(last, x => x.gf)),
        ga: r1(avg(last, x => x.ga)),
        homeGf: r1(avg(homeGames, x => x.gf)),
        homeGa: r1(avg(homeGames, x => x.ga)),
        awayGf: r1(avg(awayGames, x => x.gf)),
        awayGa: r1(avg(awayGames, x => x.ga)),
        gf1: r1(avg(last, x => x.ht.h)),
        ga1: r1(avg(last, x => x.ht.a)),
        over25: r1(avg(last, x => (x.gf + x.ga > 2.5 ? 1 : 0))),
        btts: r1(avg(last, x => (x.gf > 0 && x.ga > 0 ? 1 : 0))),
        iyGol: r1(avg(last, x => (x.ht.h + x.ht.a > 0 ? 1 : 0))),
        cleanSheetPct,
        leadHoldPct,
        comebackPct,
        son: t.last.slice(0, 5).map(x => `${x.home ? 'E' : 'D'} ${x.opp} ${x.gf}-${x.ga}`),
        homeSon: homeGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`),
        awaySon: awayGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`)
    };
}

// ---------------- H2H (Aralarındaki Maçlar) & Ortak Rakipler Analizi ----------------
function analyzeH2HAndCommon(th, ta, m, intel) {
    // 1. H2H (Hem 75 günlük veritabanı hem de dış istihbarat geçmiş sezonlar)
    const h2hList = [];
    const seenDates = new Set();

    if (th && ta) {
        for (const g of th.last) {
            if (g.oppId === ta.id) {
                seenDates.add(g.date);
                h2hList.push({
                    date: g.date,
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
            if (seenDates.has(eh.date)) continue;
            seenDates.add(eh.date);
            const isThHome = eh.home && m.home && eh.home.toLowerCase().slice(0, 4) === m.home.toLowerCase().slice(0, 4);
            h2hList.push({
                date: eh.date,
                homeTeam: eh.home,
                awayTeam: eh.away,
                homeGoals: eh.gh,
                awayGoals: eh.ga,
                thGoals: isThHome ? eh.gh : eh.ga,
                taGoals: isThHome ? eh.ga : eh.gh
            });
        }
    }

    let h2hModH = 1.0, h2hModA = 1.0, h2hSummary = null;
    if (h2hList.length > 0) {
        let hw = 0, d = 0, aw = 0, totG = 0;
        for (const item of h2hList) {
            if (item.thGoals > item.taGoals) hw++;
            else if (item.thGoals === item.taGoals) d++;
            else aw++;
            totG += item.thGoals + item.taGoals;
        }
        const avgG = (totG / h2hList.length).toFixed(1);
        const diff = (hw - aw) / h2hList.length;
        h2hModH = Math.min(1.07, Math.max(0.93, 1 + 0.06 * diff));
        h2hModA = Math.min(1.07, Math.max(0.93, 1 - 0.06 * diff));
        const scoresText = h2hList.slice(0, 3).map(x => `${x.thGoals}-${x.taGoals}`).join(', ');
        h2hSummary = `Aralarındaki son ${h2hList.length} maç: ${m.home} ${hw}G-${d}B-${aw}M (Ort. ${avgG} gol | Son skorlar: ${scoresText})`;
    }

    // 2. Ortak Rakipler (Common Opponents)
    let commonModH = 1.0, commonModA = 1.0, commonSummary = null;
    if (th && ta && th.last.length && ta.last.length) {
        const mapH = new Map();
        for (const g of th.last) {
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
        for (const g of ta.last) {
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

// Son 5 maçlık form ivmesi (Momentum çarpanı)
function computeFormMomentum(t) {
    if (!t || !t.last || t.last.length < 3) return 1.0;
    const recent = t.last.slice(0, 5);
    let pts = 0, gd = 0;
    for (const g of recent) {
        pts += g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0;
        gd += (g.gf - g.ga);
    }
    const ppg = pts / recent.length; // 0..3, nötr = 1.4
    const gdpg = gd / recent.length;
    const raw = 1 + 0.035 * (ppg - 1.4) + 0.02 * gdpg;
    return Math.min(1.10, Math.max(0.90, raw));
}

// ---------------- %100 Bağımsız Çok Katmanlı Maç Analizi ----------------
function analyze(model, m, opts = {}) {
    const intel = opts.intel || m.intel || null;
    const th = model.teams.get(m.homeId), ta = model.teams.get(m.awayId);
    const L = model.lgStat(m.league.id), g = model.glob;
    const nh = th ? th.n : 0, na = ta ? ta.n : 0;

    // 1. Katman: Genel + Ev/Deplasman Ayrı Hücum ve Savunma Güçleri
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
    const momH = computeFormMomentum(th);
    const momA = computeFormMomentum(ta);
    lh *= momH;
    la *= momA;

    // 3. Katman: H2H (Aralarındaki Maçlar) ve Ortak Rakipler Kıyaslaması
    const h2hCommon = analyzeH2HAndCommon(th, ta, m, intel);
    lh *= h2hCommon.h2hModH * h2hCommon.commonModH;
    la *= h2hCommon.h2hModA * h2hCommon.commonModA;

    // 4. Katman: Puan Durumu / Sıralama Farkı Etkisi (ESPN Standings varsa)
    if (intel && intel.standings && intel.standings.home && intel.standings.away) {
        const sh = intel.standings.home, sa = intel.standings.away;
        if (sh.gp >= 3 && sa.gp >= 3) {
            const ppgDiff = (sh.points / sh.gp) - (sa.points / sa.gp);
            lh *= Math.min(1.06, Math.max(0.94, 1 + 0.03 * ppgDiff));
            la *= Math.min(1.06, Math.max(0.94, 1 - 0.03 * ppgDiff));
        }
    }

    // 5. Katman: Maç Saati Hava Durumu ve Zemin Şartları Etkisi (Open-Meteo)
    if (intel && intel.weather && intel.weather.xgMod) {
        lh *= intel.weather.xgMod;
        la *= intel.weather.xgMod;
    }

    lh = Math.min(3.75, Math.max(0.25, lh));
    la = Math.min(3.75, Math.max(0.25, la));

    // NOT: İddaa oranları (m.odds) tahmin hesabına KARIŞMAZ (%100 bağımsız kendi analizimiz).
    // Sadece maçın resmi İddaa bülteninde olup olmadığını (inBulletin) doğrulamak için tutulur.
    const inBulletin = Boolean(m.inBulletin);

    // 6. Katman: Devre Gol Payları (İç saha ve dış saha ilk yarı gol karakteri)
    const shHome = (t) => (t ? (t.hgf1 + t.gf1 + 6 * L.s1) / (t.hgf + t.gf + 6) : L.s1);
    const shAway = (t) => (t ? (t.agf1 + t.gf1 + 6 * L.s1) / (t.agf + t.gf + 6) : L.s1);
    const shareH = 0.5 * (shHome(th) + (ta ? (ta.aga1 + ta.ga1 + 6 * L.s1) / (ta.aga + ta.ga + 6) : L.s1));
    const shareA = 0.5 * (shAway(ta) + (th ? (th.hga1 + th.ga1 + 6 * L.s1) / (th.hga + th.ga + 6) : L.s1));
    const clamp = (v) => Math.min(0.62, Math.max(0.28, v));
    const mkts = computeMarkets(lh, la, clamp(shareH), clamp(shareA));

    // Veri kalitesi: Takımların oynadığı maç sayısına ve İddaa bülteninde yer almasına göre
    const quality = inBulletin && Math.min(nh, na) >= 6 && L.n >= 20
        ? 'A'
        : inBulletin && Math.min(nh, na) >= 3
            ? 'B'
            : 'C';

    const homeFacts = opts.facts ? teamFacts(th) : undefined;
    const awayFacts = opts.facts ? teamFacts(ta) : undefined;

    return {
        lh, la, quality,
        marketUsed: inBulletin,
        p: mkts.p,
        topScores: mkts.topScores,
        topHtScores: mkts.topHtScores,
        nh, na, leagueN: L.n,
        momH: +momH.toFixed(2),
        momA: +momA.toFixed(2),
        h2hSummary: h2hCommon.h2hSummary,
        commonSummary: h2hCommon.commonSummary,
        intel: intel || null,
        facts: opts.facts ? { home: homeFacts, away: awayFacts } : undefined
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

const BANKO_PRIMARY_KEYS = new Set(['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05']);
const BANKO_KEYS = ['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05', 'ust15', 'dc1x', 'dcx2', 'alt35'];
const SURPRISE_GROUPS = ['ms_kg', 'ms_ou', 'iy_kg', 'y2_kg', 'iy_ust', 'iyskor', 'msskor', 'hms', 'tg', 'htft', 'ou_kg', 'iki_yari'];

function qualifies(match, an, minQ = 'B') {
    if (match.state !== 'pre') return false;
    if (!match.inBulletin) return false; // Yalnızca resmi İddaa bültenindeki maçlar
    if (new Date(match.kickoff).getTime() < Date.now() + 5 * 60000) return false;
    if (minQ === 'A') return an.quality === 'A';
    if (minQ === 'B') return an.quality === 'A' || an.quality === 'B';
    return true;
}

function generateRationale(pk, m, an) {
    const totG = (an.lh + an.la).toFixed(2);
    const pStr = '%' + (pk.p * 100).toFixed(0);
    const liftStr = pk.lift ? pk.lift.toFixed(1) + ' kat' : '';

    const hf = an.facts?.home;
    const af = an.facts?.away;
    const splitNote = (hf && af && hf.homeGf !== null && af.awayGf !== null)
        ? ` Ev sahibi iç sahada maç başı ${hf.homeGf} gol (yediği ${hf.homeGa}), deplasman dış sahada ${af.awayGf} gol (yediği ${af.awayGa}) ortalamasında.`
        : '';
    const extraNote = an.commonSummary
        ? ` [${an.commonSummary}]`
        : an.h2hSummary
            ? ` [${an.h2hSummary}]`
            : '';
    const weatherNote = an.intel?.weather
        ? ` 🌤️ ${an.intel.weather.city}: ${an.intel.weather.temp}°C (${an.intel.weather.condition}).`
        : '';

    // Yüksek oranlı Nesine Sürpriz Pazarları gerekçeleri
    if (pk.key === 'ms1_kgv' || pk.key === 'ms2_kgv') {
        const fav = pk.key === 'ms1_kgv' ? m.home : m.away;
        const dog = pk.key === 'ms1_kgv' ? m.away : m.home;
        return `${fav} hücum gücüyle galibiyete yakın (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG), ancak ${dog} da skor üretebilen yapıda (2-1 / 3-1 senaryosu, ${pStr} olasılık, ${liftStr} değer).${splitNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'msx_kgv') {
        return `İki takımın hücum ve savunma dengesi birbirine çok yakın (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). Gollü beraberlik (1-1 / 2-2) senaryosu normalin ${liftStr} üzerinde (${pStr} olasılık).${splitNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'ms1_ust25' || pk.key === 'ms2_ust25') {
        const fav = pk.key === 'ms1_ust25' ? m.home : m.away;
        return `${fav} yüksek hücum temposuyla maçı üst barajına taşıyarak kazanmaya aday (Toplam ${totG} xG, ${pStr} olasılık, ${liftStr} değer).${splitNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'ust25_kgv') {
        return `İki takım da açık futbol oynuyor (Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)}, toplam ${totG} xG). Hem KG Var hem 2,5 Üst birleşimi ${pStr} olasılıkla öne çıkıyor.${splitNote}${weatherNote}`;
    }
    if (pk.key === 'iykgv') {
        return `Her iki takım da maça hızlı başlayan ve ilk yarılarda açık veren karakterde. İlk yarıdan karşılıklı gol (İY KG Var) olasılığı ${pStr} (normalin ${liftStr} üzerinde).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'y2kgv') {
        return `İkinci yarılarda savunma disiplini düşen ve skoru çift taraflı üreten iki ekip. 2. Yarı KG Var olasılığı ${pStr} (${liftStr} istatistiksel değer).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'iyust15') {
        return `İlk yarı gol beklentisi çok yüksek; devre bitmeden en az 2 gol (İY 1,5 Üst) çıkma ihtimali ${pStr} (${liftStr} değer).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'ikiyari_gol') {
        return `Maçın her iki devresinde de yüksek gol temposu bekleniyor (Toplam ${totG} xG, Her İki Yarıda Gol: ${pStr}).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'hms1' || pk.key === 'hms2') {
        const fav = pk.key === 'hms1' ? m.home : m.away;
        return `${fav} rakibine karşı net güç ve xG üstünlüğüne sahip (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). En az 2 farklı handikaplı galibiyet olasılığı ${pStr} (${liftStr} değer).${extraNote}${weatherNote}`;
    }
    if (pk.key === 'tg46') {
        return `Yüksek tempolu ve gollü geçmeye aday karşılaşma (${totG} toplam xG). Maçta toplam 4-6 gol aralığı ${pStr} olasılık ve ${liftStr} değer taşıyor.${splitNote}${weatherNote}`;
    }
    if (pk.key.startsWith('iyskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `İlk yarı devre matrisinde ${sc} kesin skoru yüksek yoğunlukta (${pStr} olasılık, normal dağılımın ${liftStr} üzerinde).${splitNote}${weatherNote}`;
    }
    if (pk.key.startsWith('msskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `Bağımsız Dixon-Coles skor matrisinde ${sc} maç skoru en değerli yüksek oranlı hedef olarak öne çıkıyor (${pStr} olasılık, ${liftStr} değer).${splitNote}${extraNote}`;
    }

    // Banko & klasik pazar gerekçeleri
    if (pk.key === 'ust15') {
        return `Bağımsız xG modeli toplam ${totG} gol (Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)}) hesapladı (${pStr} güven).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'iyust05') {
        return `İlk yarı gol temposu yüksek; model devre bitmeden en az 1 gol olasılığını ${pStr} olarak hesapladı.${splitNote}${weatherNote}`;
    }
    if (pk.key === 'alt25' || pk.key === 'alt35') {
        return `Savunma direnci yüksek eşleşme; toplam beklenen gol ${totG} seviyesinde (${pStr} güven).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'ust25') {
        return `Yüksek hücum temposu; ${totG} beklenen gol ile model ${pStr} olasılıkla 2,5 Üst öngörüyor.${splitNote}${weatherNote}`;
    }
    if (pk.key === 'kgv') {
        return `Ev (${an.lh.toFixed(2)} xG) ve deplasman (${an.la.toFixed(2)} xG) karşılıklı üretime çok uygun (${pStr} güven).${splitNote}${weatherNote}`;
    }
    if (pk.key === 'dc1x') {
        return `${m.home} iç saha formunda çok dirençli (${an.lh.toFixed(2)} xG). Yenilmeme ihtimali ${pStr}.${extraNote}${weatherNote}`;
    }
    if (pk.key === 'dcx2') {
        return `${m.away} dış saha performansıyla üstün (${an.la.toFixed(2)} xG). Puan alma olasılığı ${pStr}.${extraNote}${weatherNote}`;
    }
    if (pk.key === 'ms1') {
        return `${m.home} iç saha gücü ve form ivmesiyle önde (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG, ${pStr} olasılık).${splitNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'ms2') {
        return `${m.away} deplasman karnesi ve hücum kalitesiyle üstün (${an.la.toFixed(2)} xG, ${pStr} olasılık).${splitNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'msx') {
        return `İki takımın iç/dış saha güçleri dengeli (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). Beraberlik olasılığı ${pStr} (${liftStr} değer).${extraNote}`;
    }
    if (pk.key.startsWith('iy1') || pk.key.startsWith('iy2')) {
        const team = pk.key === 'iy1' ? m.home : m.away;
        return `${team} ilk yarılarda yüksek gol yüzdesine sahip. Devreyi önde kapatma ihtimali ${pStr} (${liftStr} istatistiksel değer).${splitNote}${weatherNote}`;
    }
    if (pk.key.startsWith('htft_')) {
        const sub = pk.key.slice(5);
        return `Bağımsız devre modelinde yüksek değerli İY/MS (${sub}) senaryosu: ${pStr} olasılık (normal dağılımın ${liftStr} üzerinde).${extraNote}${weatherNote}`;
    }
    if (pk.key === 'yari1' || pk.key === 'yari2') {
        const half = pk.key === 'yari1' ? '1. yarıda' : '2. yarıda';
        return `Takımların devre karakteristiğine göre gollerin ${half} yoğunlaşması bekleniyor (${pStr} olasılık, ${liftStr} değer).${weatherNote}`;
    }
    return `Bağımsız modelin ${pStr} olasılık ve ${liftStr || 'yüksek güven'} ile öne çıkardığı istatistiksel tercih.${splitNote}${weatherNote}`;
}

function isMainstreamMatch(m) {
    return (m.mbs <= 2 || (m.order !== undefined && m.order < 55)) && !m.youth && !m.women && !m.reserve;
}

// Yüksek oranlı Nesine Sürpriz pazarlarının taktiksel uygunluk ve değer puanlaması
function scoreSurpriseCandidate(pk, m, an, model) {
    if (!SURPRISE_GROUPS.includes(pk.group)) return null;
    const baseRate = model.base[pk.key] || 0.05;
    const lift = pk.p / baseRate;
    if (lift < 1.25) return null;

    const tot = an.lh + an.la;
    const diff = an.lh - an.la;
    const hf = an.facts?.home, af = an.facts?.away;
    let tacticalMult = 1.0;

    // Pazara özel taktiksel filtre ve sağlam analiz doğrulaması
    if (pk.key === 'ms1_kgv') {
        if (an.lh < 1.55 || an.la < 0.82 || pk.p < 0.16) return null;
        tacticalMult = 1.22;
    } else if (pk.key === 'ms2_kgv') {
        if (an.la < 1.55 || an.lh < 0.82 || pk.p < 0.16) return null;
        tacticalMult = 1.22;
    } else if (pk.key === 'msx_kgv') {
        if (Math.abs(diff) > 0.28 || an.lh < 1.15 || an.la < 1.15 || pk.p < 0.13) return null;
        tacticalMult = 1.28;
    } else if (pk.key === 'ms1_ust25') {
        if (an.lh < 1.75 || tot < 2.85 || pk.p < 0.28 || pk.p > 0.54) return null;
        tacticalMult = 1.15;
    } else if (pk.key === 'ms2_ust25') {
        if (an.la < 1.75 || tot < 2.85 || pk.p < 0.28 || pk.p > 0.54) return null;
        tacticalMult = 1.15;
    } else if (pk.key === 'ust25_kgv') {
        if (an.lh < 1.25 || an.la < 1.15 || tot < 2.95 || pk.p < 0.32 || pk.p > 0.55) return null;
        tacticalMult = 1.14;
    } else if (pk.key === 'iykgv') {
        if (an.lh < 1.20 || an.la < 1.10 || tot < 2.80 || pk.p < 0.16) return null;
        if (hf?.iyGol >= 0.7 && af?.iyGol >= 0.7) tacticalMult *= 1.12;
        tacticalMult *= 1.26;
    } else if (pk.key === 'y2kgv') {
        if (an.lh < 1.20 || an.la < 1.10 || tot < 2.75 || pk.p < 0.22 || pk.p > 0.48) return null;
        tacticalMult = 1.20;
    } else if (pk.key === 'iyust15') {
        if (tot < 2.95 || pk.p < 0.28 || pk.p > 0.52) return null;
        tacticalMult = 1.16;
    } else if (pk.key === 'ikiyari_gol') {
        if (tot < 3.05 || pk.p < 0.35 || pk.p > 0.55) return null;
        tacticalMult = 1.10;
    } else if (pk.key === 'hms1') {
        if (diff < 0.75 || pk.p < 0.24 || pk.p > 0.50) return null;
        tacticalMult = 1.18;
    } else if (pk.key === 'hms2') {
        if (-diff < 0.75 || pk.p < 0.24 || pk.p > 0.50) return null;
        tacticalMult = 1.18;
    } else if (pk.key === 'tg46') {
        if (tot < 3.10 || pk.p < 0.26 || pk.p > 0.48) return null;
        tacticalMult = 1.20;
    } else if (pk.group === 'iyskor') {
        if (pk.p < 0.14 || pk.p > 0.32 || lift < 1.32) return null;
        if (pk.key === 'iyskor_1_1' && (an.lh < 1.15 || an.la < 1.15)) return null;
        tacticalMult = 1.32;
    } else if (pk.group === 'msskor') {
        if (pk.p < 0.085 || pk.p > 0.22 || lift < 1.35) return null;
        tacticalMult = 1.45;
    } else if (pk.group === 'htft') {
        if (pk.p < 0.14 || pk.p > 0.48) return null;
        const sub = pk.key.slice(5);
        if (sub === 'X/1' || sub === 'X/2') tacticalMult = 1.24;
        else if (sub === '2/1' || sub === '1/2') {
            if (pk.p < 0.05) return null;
            tacticalMult = 1.30;
        } else {
            tacticalMult = 1.02;
        }
    } else {
        if (pk.p < 0.18 || pk.p > 0.52) return null;
    }

    const mbsMult = m.mbs === 1 ? 1.14 : m.mbs === 2 ? 1.07 : 1.0;
    const qMult = an.quality === 'A' ? 1.10 : an.quality === 'B' ? 1.04 : 0.96;
    // Farklı olasılık bantlarındaki yüksek oranlı pazarları adil kıyaslamak için karekök ağırlıklı skor
    const score = Math.pow(pk.p, 0.62) * Math.min(lift, 3.2) * tacticalMult * mbsMult * qMult;
    return { ...pk, lift, score, m, an };
}

function buildCoupons(items, model, opts = {}) {
    const bankoN = opts.bankoN || 4, surpN = opts.surpN || 5;
    
    // BANKO: Önce ana bülten (MBS 1-2, bilinen profesyonel ligler) A/B kalitesi, yetmezse genel İddaa bülteni
    let cands = items.filter(it => qualifies(it.m, it.an, 'B') && isMainstreamMatch(it.m));
    if (cands.length < bankoN * 2) {
        cands = items.filter(it => qualifies(it.m, it.an, 'C') && isMainstreamMatch(it.m));
    }
    if (cands.length < bankoN) {
        cands = items.filter(it => qualifies(it.m, it.an, 'A'));
    }
    if (cands.length < bankoN) {
        cands = items.filter(it => qualifies(it.m, it.an, 'B'));
    }
    if (cands.length < bankoN) {
        cands = items.filter(it => qualifies(it.m, it.an, 'C'));
    }

    const bankoPool = [];
    for (const it of cands) {
        const allBankoPicks = picksOf(it.m, it.an).filter(p => BANKO_KEYS.includes(p.key));
        let playable = allBankoPicks.filter(p => p.p >= 0.66 && p.p <= 0.88);
        if (!playable.length) playable = allBankoPicks.filter(p => p.p >= 0.62 && p.p <= 0.91);
        if (!playable.length) playable = allBankoPicks;

        const mbsBonus = it.m.mbs === 1 ? 0.04 : it.m.mbs === 2 ? 0.02 : 0;
        playable.sort((a, b) => {
            const scoreA = a.p + (BANKO_PRIMARY_KEYS.has(a.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0);
            const scoreB = b.p + (BANKO_PRIMARY_KEYS.has(b.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0);
            return scoreB - scoreA;
        });

        const best = playable[0];
        if (best) {
            const rankScore = best.p + (BANKO_PRIMARY_KEYS.has(best.key) ? 0.05 : 0) + (it.an.quality === 'A' ? 0.04 : 0) + mbsBonus;
            bankoPool.push({
                ...best,
                rankScore,
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

    // SÜRPRİZ: Nesine'deki Çoklu Yüksek Oranlı Pazarlardan (MS&KG, MS&Üst, İY KG, 2Y KG, İY/MS Skor, Handikap, 4-6 Gol, İY/MS)
    // Her maçta farklı bir yüksek oranlı pazar kategorisi seçen sağlam analiz motoru
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
        // Her maç için her farklı yüksek oranlı pazardan en iyi adayı çıkar
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
            surpPool.push({
                ...cand,
                rationale: generateRationale(cand, cand.m, cand.an)
            });
        }
    }
    surpPool.sort((a, b) => b.score - a.score);

    const surprise = [];
    const usedSurpMatches = new Set();
    const usedSurpGroups = new Set();

    // 1. Geçiş: 5 maçın 5'i de FARKLI yüksek oranlı pazar grubundan (MS&KG, İY KG, 2Y KG, MS&Üst, İY/MS Skor, Handikap, 4-6 Gol, İY/MS) olsun
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

    const bankoConfidence = banko.length ? Math.round((banko.reduce((s, x) => s + x.p, 0) / banko.length) * 100) : 0;
    const minBankoPct = banko.length ? Math.round(Math.min(...banko.map(x => x.p)) * 100) : 0;
    const surpAvgLift = surprise.length ? (surprise.reduce((s, x) => s + x.lift, 0) / surprise.length).toFixed(1) : '1.0';

    const bankoInstruction = banko.length
        ? `İddaa oranlarından bağımsız; ev/deplasman karnesi, form ivmesi, ortak rakipler ve hava şartları incelenerek seçilen bu ${banko.length} maç, modelde en düşük %${minBankoPct} ve ortalama %${bankoConfidence} güven değerine sahiptir.`
        : 'Şu an bültende kriterlere uygun yaklaşan banko maç bulunamadı.';

    const surpInstruction = surprise.length
        ? `Nesine'deki yüksek oranlı pazarlar (MS & KG Var, MS & 2,5 Üst, İlk Yarı / 2. Yarı KG Var, İY & MS Kesin Skor, Handikaplı MS, 4-6 Gol ve İY/MS) taranarak her maça en uygun yüksek değerli senaryo seçilmiştir (Ort. ${surpAvgLift}x istatistiksel değer). Sistem (3-4-5) veya sürpriz kombine olarak değerlendirilebilir.`
        : 'Şu an bültende kriterlere uygun yaklaşan sürpriz maç bulunamadı.';

    return {
        banko: {
            title: 'Günün Banko Kuponu',
            type: 'banko',
            strategy: 'Bağımsız Derin Analiz • Yüksek Güven Kombinesi',
            instruction: bankoInstruction,
            confidence: bankoConfidence,
            matches: banko
        },
        surprise: {
            title: 'Sürpriz Kupon',
            type: 'surprise',
            strategy: 'Yüksek Oranlı Çoklu Pazar • MS&KG, Devre KG, Skor & Kombinasyonlar',
            instruction: surpInstruction,
            avgLift: surpAvgLift,
            matches: surprise
        }
    };
}

module.exports = { buildModel, analyze, picksOf, buildCoupons, outcomeKeys, teamFacts, LABEL, qualifies, generateRationale, isMainstreamMatch };



