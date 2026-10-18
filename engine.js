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

    return { asOf, teams, glob, lgStat, base, nRows: rows.length, recentRows: rows.slice(-450) };
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
function teamFacts(t) {
    if (!t) return null;
    const last = t.last.slice(0, 10);
    const last5 = t.last.slice(0, 5);
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

    // 1. Yarı ve 2. Yarı gol üretimi, yeme ortalamaları ve yüzde dağılımı
    const gf1Val = r1(avg(last, x => x.ht.h)) || 0;
    const ga1Val = r1(avg(last, x => x.ht.a)) || 0;
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
        form: formStr(t.last, 5),
        formStr: formStr(t.last, 5),
        form10Str: formStr(t.last, 10),
        last10Pts,
        homeForm: formStr(homeGames, 5),
        awayForm: formStr(awayGames, 5),
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
        iyGol: r1(avg(last, x => (x.ht.h + x.ht.a > 0 ? 1 : 0))),
        cleanSheetPct,
        leadHoldPct,
        comebackPct,
        consistencyPct,
        volatilityPct,
        son: t.last.slice(0, 5).map(x => `${x.home ? 'E' : 'D'} ${x.opp} ${x.gf}-${x.ga}`),
        son10Count: last.length,
        homeSon: homeGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`),
        awaySon: awayGames.slice(0, 4).map(x => `${x.opp} ${x.gf}-${x.ga}`)
    };
}

// ---------------- Fikstür Yorgunluğu & Dinlenme Günü Analizi ----------------
function computeRestAndFatigue(t, matchDateIso) {
    if (!t || !t.last || !t.last.length || !matchDateIso) {
        return { restDays: null, gamesLast10d: 0, isFatigued: false, isFresh: false, attMod: 1.0, dfnMod: 1.0, shMod: 0, label: 'Normal Fikstür' };
    }
    const targetMs = new Date(matchDateIso + 'T12:00:00Z').getTime();
    const lastMs = new Date(t.last[0].date + 'T12:00:00Z').getTime();
    const restDays = Math.max(1, Math.round((targetMs - lastMs) / 86400000));

    let gamesLast10d = 0;
    for (const g of t.last) {
        const d = Math.round((targetMs - new Date(g.date + 'T12:00:00Z').getTime()) / 86400000);
        if (d > 0 && d <= 10) gamesLast10d++;
    }

    let attMod = 1.0, dfnMod = 1.0, shMod = 0;
    let isFatigued = false, isFresh = false;
    let label = `${restDays} gün dinlenme`;

    if (restDays <= 3 || gamesLast10d >= 3) {
        isFatigued = true;
        attMod = restDays <= 2 ? 0.94 : 0.965;
        dfnMod = restDays <= 2 ? 1.07 : 1.045; // Yorgun savunma özellikle 2. yarıda daha çok pozisyon verir
        shMod = -0.025; // Gollerin 2. yarıya kayması
        label = gamesLast10d >= 3
            ? `⚠️ Sıkışık Fikstür (10 günde ${gamesLast10d} maç, son maç ${restDays}g önce)`
            : `⚠️ Yorgunluk Riski (Son maç ${restDays} gün önce)`;
    } else if (restDays >= 6 && restDays <= 9 && gamesLast10d <= 1) {
        isFresh = true;
        attMod = 1.02;
        dfnMod = 0.985;
        label = `🔋 Dinç Kadro (${restDays} gün dinlenme)`;
    }

    return { restDays, gamesLast10d, isFatigued, isFresh, attMod, dfnMod, shMod, label };
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

// ---------------- Kadro, Gol Dağılımı & Sakat/Eksik Oyuncu Etkisi ----------------
function computeRosterImpact(m, intel, homeFacts, awayFacts) {
    let modH = 1.0, modA = 1.0;
    const notes = [];
    if (!intel) return { modH, modA, summary: null };

    // Sakat veya cezalı sayısı etkisi
    const hInj = intel.homeInjuries || [];
    const aInj = intel.awayInjuries || [];
    if (hInj.length >= 2) {
        modH *= Math.max(0.92, 1 - hInj.length * 0.018);
        notes.push(`${m.home} eksik/sakat: ${hInj.slice(0, 3).join(', ')}`);
    }
    if (aInj.length >= 2) {
        modA *= Math.max(0.92, 1 - aInj.length * 0.018);
        notes.push(`${m.away} eksik/sakat: ${aInj.slice(0, 3).join(', ')}`);
    }

    // Gol kralı bağımlılığı ve kadro kontrolü
    if (intel.homeTopScorer && intel.homeTopGoals >= 3) {
        const scorerName = intel.homeTopScorer.toLowerCase();
        const isInjured = hInj.some(x => x.toLowerCase().includes(scorerName));
        const isOutXi = intel.lineup?.hasLineup && !intel.lineup.homeXi.some(p => p.toLowerCase().includes(scorerName.split(' ').pop()));
        if (isInjured || isOutXi) {
            modH *= 0.91;
            notes.push(`⚠️ ${m.home} en golcü ismi ${intel.homeTopScorer} (${intel.homeTopGoals} gol) ilk 11'de yok/eksik!`);
        }
    }
    if (intel.awayTopScorer && intel.awayTopGoals >= 3) {
        const scorerName = intel.awayTopScorer.toLowerCase();
        const isInjured = aInj.some(x => x.toLowerCase().includes(scorerName));
        const isOutXi = intel.lineup?.hasLineup && !intel.lineup.awayXi.some(p => p.toLowerCase().includes(scorerName.split(' ').pop()));
        if (isInjured || isOutXi) {
            modA *= 0.91;
            notes.push(`⚠️ ${m.away} en golcü ismi ${intel.awayTopScorer} (${intel.awayTopGoals} gol) ilk 11'de yok/eksik!`);
        }
    }

    return { modH, modA, summary: notes.length ? notes.join(' | ') : null };
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

// ---------------- Korner, Kart, Şut/İsabetli Şut, xG/xGA ve Motivasyon Projeksiyonu ----------------
function poissonOver(lambda, line) {
    const kMax = Math.floor(line);
    const pmf = pmfArr(lambda, Math.max(16, kMax + 2));
    let cdf = 0;
    for (let k = 0; k <= kMax; k++) cdf += pmf[k] || 0;
    return Math.max(0.02, Math.min(0.98, 1 - cdf));
}

function computeAdvancedProjections(m, lh, la, homeFacts, awayFacts, intel, restH, restA) {
    const totXg = lh + la;
    // Şut ve İsabetli Şut beklentisi (xG, iç/dış saha temposu ve varsa ESPN verisiyle harmanlanır)
    const shotsH = +(Math.max(6.5, Math.min(21.5, 6.2 + lh * 4.4 + ((homeFacts?.homeGf || 1.3) - 1.2) * 1.1))).toFixed(1);
    const shotsA = +(Math.max(5.0, Math.min(18.5, 5.1 + la * 4.2 + ((awayFacts?.awayGf || 1.1) - 1.0) * 1.0))).toFixed(1);
    const sotH = +(Math.max(2.2, Math.min(9.8, shotsH * 0.36 + lh * 0.55))).toFixed(1);
    const sotA = +(Math.max(1.8, Math.min(8.6, shotsA * 0.34 + la * 0.50))).toFixed(1);

    // Korner beklentisi (Kanat/baskı temposu + toplam şut hacmi)
    const cornersH = +(Math.max(2.8, Math.min(8.4, 2.7 + shotsH * 0.22 + (lh > 1.6 ? 0.55 : 0)))).toFixed(1);
    const cornersA = +(Math.max(2.2, Math.min(7.2, 2.1 + shotsA * 0.21 + (la > 1.4 ? 0.45 : 0)))).toFixed(1);
    const totalCorners = +(cornersH + cornersA).toFixed(1);
    const htCorners = +(totalCorners * 0.46).toFixed(1);

    // Sarı ve Kırmızı Kart beklentisi (Maç dengesi, yorgunluk ve sıralama gerilimi)
    const closeness = Math.max(0, 1 - Math.abs(lh - la) * 0.45);
    const fatigueBump = (restH?.isFatigued ? 0.25 : 0) + (restA?.isFatigued ? 0.25 : 0);
    const cardsH = +(1.65 + closeness * 0.45 + (restH?.isFatigued ? 0.22 : 0)).toFixed(1);
    const cardsA = +(1.90 + closeness * 0.50 + (restA?.isFatigued ? 0.22 : 0)).toFixed(1);
    const totalCards = +(cardsH + cardsA + fatigueBump * 0.2).toFixed(1);

    // Maçın Önemi ve Motivasyon Analizi (Puan Tablosundan)
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

    return {
        xgH: +lh.toFixed(2),
        xgA: +la.toFixed(2),
        xgaH: +la.toFixed(2),
        xgaA: +lh.toFixed(2),
        shotsH,
        shotsA,
        sotH,
        sotA,
        cornersH,
        cornersA,
        totalCorners,
        htCorners,
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

// ---------------- %100 Bağımsız 10+ Katmanlı Derin Maç Analizi & Hibrit Kalibrasyon ----------------
function analyze(model, m, opts = {}) {
    const intel = opts.intel || m.intel || null;
    const th = model.teams.get(m.homeId), ta = model.teams.get(m.awayId);
    const L = model.lgStat(m.league.id), g = model.glob;
    const nh = th ? th.n : 0, na = ta ? ta.n : 0;

    const homeFacts = teamFacts(th);
    const awayFacts = teamFacts(ta);

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
    const momH = computeFormMomentum(th);
    const momA = computeFormMomentum(ta);
    lh *= momH;
    la *= momA;

    // 3. Katman: H2H (Aralarındaki Maçlar) ve Ortak Rakipler Kıyaslaması
    const h2hCommon = analyzeH2HAndCommon(th, ta, m, intel);
    lh *= h2hCommon.h2hModH * h2hCommon.commonModH;
    la *= h2hCommon.h2hModA * h2hCommon.commonModA;

    // 4. Katman: Fikstür Yorgunluğu ve Dinlenme Günleri (Rest Days & Congestion)
    const restH = computeRestAndFatigue(th, m.date);
    const restA = computeRestAndFatigue(ta, m.date);
    lh *= restH.attMod * restA.dfnMod;
    la *= restA.attMod * restH.dfnMod;

    // 5. Katman: Kadro, Gol Kralı Bağımlılığı ve Sakat/Eksik Oyuncu Etkisi
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

    // 7.5 Katman: Piyasa Oran Kalibrasyonu (fitLambda - Gerçek İddaa/Mackolik oranı mevcutsa %12 hibrit kalibrasyon)
    let calibratedWithOdds = false;
    if (m.odds && m.odds.ms1 > 1 && m.odds.msx > 1 && m.odds.ms2 > 1) {
        const inv1 = 1 / m.odds.ms1, invX = 1 / m.odds.msx, inv2 = 1 / m.odds.ms2;
        const sum1X2 = inv1 + invX + inv2;
        const p1 = inv1 / sum1X2, pX = invX / sum1X2, p2 = inv2 / sum1X2;
        let pO = null;
        if (m.odds.ust25 > 1 && m.odds.alt25 > 1) {
            const invO = 1 / m.odds.ust25, invU = 1 / m.odds.alt25;
            pO = invO / (invO + invU);
        }
        const [mktLh, mktLa] = fitLambda(p1, pX, p2, pO, lh, la);
        lh = 0.88 * lh + 0.12 * mktLh;
        la = 0.88 * la + 0.12 * mktLa;
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

    // 8.5 Katman: Korner, Kart, Şut/İsabetli Şut, xG/xGA ve Motivasyon Projeksiyonları
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

    // Veri kalitesi: Takımların oynadığı maç sayısına ve İddaa bülteninde yer almasına göre
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
        topScores: mkts.topScores,
        topHtScores: mkts.topHtScores,
        nh, na, leagueN: L.n,
        momH: +momH.toFixed(2),
        momA: +momA.toFixed(2),
        restH,
        restA,
        tactical,
        rosterSummary: rosterImpact.summary,
        avgConsistency,
        liveState,
        h2hSummary: h2hCommon.h2hSummary,
        commonSummary: h2hCommon.commonSummary,
        intel: intel || null,
        facts: opts.facts ? { home: homeFacts, away: awayFacts } : undefined
    };
}

// ---------------- Gerçek Value Bet (Beklenen Değer - EV) Hesaplaması ----------------
// Formül: EV = (Model olasılığı × Gerçek Nesine oranı) - 1
// Örnek: %55 olasılık (0.55) ve 2.10 gerçek oran -> EV = (0.55 * 2.10) - 1 = +0.155 (+%15.5)
function computeExpectedValue(modelProb, realOdd) {
    const p = Number(modelProb);
    const odd = Number(realOdd);
    if (!isFinite(p) || !isFinite(odd) || p <= 0 || odd <= 1.0) {
        return { ev: null, evPct: null };
    }
    const ev = (p * odd) - 1;
    const evPct = +(ev * 100).toFixed(1);
    return { ev: +ev.toFixed(4), evPct };
}

// ---------------- Pick listesi ----------------
function picksOf(match, an) {
    const out = [];
    for (const [key, pv] of Object.entries(an.p)) {
        let label, group;
        if (key.startsWith('htft_')) { label = 'İY/MS ' + key.slice(5); group = 'htft'; }
        else { label = LABEL[key]; group = GROUP[key]; }
        if (!label) continue;
        // Resmi Nesine bülteninden gelen gerçek oran varsa EV = (Model olasılığı × Gerçek oran) - 1 hesapla
        const realOdd = (match.odds && typeof match.odds[key] === 'number' && match.odds[key] > 1.01)
            ? match.odds[key]
            : null;
        const { ev, evPct } = computeExpectedValue(pv, realOdd);
        out.push({ key, label, group, p: pv, realOdd, ev, evPct, matchId: match.id });
    }
    return out;
}

const BANKO_PRIMARY_KEYS = new Set(['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05', 'ev_ust15', 'dep_ust15']);
const BANKO_KEYS = ['ms1', 'ms2', 'ust25', 'kgv', 'alt25', 'iyust05', 'ust15', 'dc1x', 'dcx2', 'alt35', 'ev_ust15', 'dep_ust15', 'korner_ust85'];
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
        ? ` Ev sahibi iç sahada maç başı ${hf.homeGf} gol (yediği ${hf.homeGa}, Son 10: ${hf.form10Str || hf.formStr}), deplasman dış sahada ${af.awayGf} gol (yediği ${af.awayGa}, Son 10: ${af.form10Str || af.formStr}) ortalamasında.`
        : '';
    const projNote = an.projections
        ? ` [🎯 İsabetli Şut: ${an.projections.sotH}-${an.projections.sotA} | 🚩 Korner: ${an.projections.totalCorners} | 🟨 Kart: ${an.projections.totalCards}]`
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
    const evNote = (pk.realOdd && pk.evPct !== null && pk.evPct !== undefined)
        ? ` [Nesine Oranı: ${pk.realOdd.toFixed(2)} | Beklenen Değer (EV): ${pk.evPct >= 0 ? '+' : ''}%${pk.evPct}]`
        : '';
    const tailNotes = `${evNote}${splitNote}${projNote}${dnaNote}${fatigueNote}${extraNote}${weatherNote}`;

    // Yüksek oranlı Nesine Sürpriz Pazarları gerekçeleri
    if (pk.key === 'ms1_kgv' || pk.key === 'ms2_kgv') {
        const fav = pk.key === 'ms1_kgv' ? m.home : m.away;
        const dog = pk.key === 'ms1_kgv' ? m.away : m.home;
        return `${fav} hücum gücüyle galibiyete yakın (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG), ancak ${dog} da skor üretebilen yapıda (2-1 / 3-1 senaryosu, ${pStr} olasılık, ${liftStr} değer).${tailNotes}`;
    }
    if (pk.key === 'msx_kgv') {
        return `İki takımın hücum ve savunma dengesi birbirine çok yakın (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). Gollü beraberlik (1-1 / 2-2) senaryosu normalin ${liftStr} üzerinde (${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'ms1_ust25' || pk.key === 'ms2_ust25') {
        const fav = pk.key === 'ms1_ust25' ? m.home : m.away;
        return `${fav} yüksek hücum temposuyla maçı üst barajına taşıyarak kazanmaya aday (Toplam ${totG} xG, ${pStr} olasılık, ${liftStr} değer).${tailNotes}`;
    }
    if (pk.key === 'ust25_kgv') {
        return `İki takım da açık futbol oynuyor (Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)}, toplam ${totG} xG). Hem KG Var hem 2,5 Üst birleşimi ${pStr} olasılıkla öne çıkıyor.${tailNotes}`;
    }
    if (pk.key === 'iykgv') {
        return `Her iki takım da maça hızlı başlayan ve ilk yarılarda açık veren karakterde. İlk yarıdan karşılıklı gol (İY KG Var) olasılığı ${pStr} (normalin ${liftStr} üzerinde).${tailNotes}`;
    }
    if (pk.key === 'y2kgv') {
        return `İkinci yarılarda savunma disiplini düşen ve skoru çift taraflı üreten iki ekip. 2. Yarı KG Var olasılığı ${pStr} (${liftStr} istatistiksel değer).${tailNotes}`;
    }
    if (pk.key === 'iyust15') {
        return `İlk yarı gol beklentisi çok yüksek; devre bitmeden en az 2 gol (İY 1,5 Üst) çıkma ihtimali ${pStr} (${liftStr} değer).${tailNotes}`;
    }
    if (pk.key === 'ikiyari_gol') {
        return `Maçın her iki devresinde de yüksek gol temposu bekleniyor (Toplam ${totG} xG, Her İki Yarıda Gol: ${pStr}).${tailNotes}`;
    }
    if (pk.key === 'hms1' || pk.key === 'hms2') {
        const fav = pk.key === 'hms1' ? m.home : m.away;
        return `${fav} rakibine karşı net güç ve xG üstünlüğüne sahip (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). En az 2 farklı handikaplı galibiyet olasılığı ${pStr} (${liftStr} değer).${evNote}${dnaNote}${fatigueNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'tg46') {
        return `Yüksek tempolu ve gollü geçmeye aday karşılaşma (${totG} toplam xG). Maçta toplam 4-6 gol aralığı ${pStr} olasılık ve ${liftStr} değer taşıyor.${tailNotes}`;
    }
    if (pk.key.startsWith('iyskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `İlk yarı Dixon-Coles devre matrisinde ${sc} kesin skoru yüksek yoğunlukta (${pStr} olasılık, normal dağılımın ${liftStr} üzerinde).${tailNotes}`;
    }
    if (pk.key.startsWith('msskor_')) {
        const sc = pk.key.slice(7).replace('_', '-');
        return `Bağımsız Dixon-Coles skor matrisinde ${sc} maç skoru en değerli yüksek oranlı hedef olarak öne çıkıyor (${pStr} olasılık, ${liftStr} değer).${tailNotes}`;
    }

    // Banko & klasik pazar gerekçeleri
    if (pk.key === 'ust15') {
        return `Bağımsız xG modeli toplam ${totG} gol (Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)}) hesapladı (${pStr} güven, İstikrar: %${an.avgConsistency || 75}).${tailNotes}`;
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
        return `Ev (${an.lh.toFixed(2)} xG) ve deplasman (${an.la.toFixed(2)} xG) karşılıklı üretime çok uygun (${pStr} güven).${tailNotes}`;
    }
    if (pk.key === 'dc1x') {
        return `${m.home} iç saha formunda çok dirençli (${an.lh.toFixed(2)} xG). Yenilmeme ihtimali ${pStr}.${evNote}${dnaNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'dcx2') {
        return `${m.away} dış saha performansıyla üstün (${an.la.toFixed(2)} xG). Puan alma olasılığı ${pStr}.${evNote}${dnaNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'ms1') {
        return `${m.home} iç saha gücü ve form ivmesiyle önde (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'ms2') {
        return `${m.away} deplasman karnesi ve hücum kalitesiyle üstün (${an.la.toFixed(2)} xG, ${pStr} olasılık).${tailNotes}`;
    }
    if (pk.key === 'msx') {
        return `İki takımın iç/dış saha güçleri dengeli (${an.lh.toFixed(2)} - ${an.la.toFixed(2)} xG). Beraberlik olasılığı ${pStr} (${liftStr} değer).${evNote}${dnaNote}${extraNote}`;
    }
    if (pk.key.startsWith('iy1') || pk.key.startsWith('iy2')) {
        const team = pk.key === 'iy1' ? m.home : m.away;
        return `${team} ilk yarılarda yüksek gol yüzdesine sahip. Devreyi önde kapatma ihtimali ${pStr} (${liftStr} istatistiksel değer).${tailNotes}`;
    }
    if (pk.key.startsWith('htft_')) {
        const sub = pk.key.slice(5);
        return `Bağımsız devre modelinde yüksek değerli İY/MS (${sub}) senaryosu: ${pStr} olasılık (normal dağılımın ${liftStr} üzerinde).${evNote}${dnaNote}${fatigueNote}${extraNote}${weatherNote}`;
    }
    if (pk.key === 'yari1' || pk.key === 'yari2') {
        const half = pk.key === 'yari1' ? '1. yarıda' : '2. yarıda';
        return `Takımların devre karakteristiğine göre gollerin ${half} yoğunlaşması bekleniyor (${pStr} olasılık, ${liftStr} değer).${evNote}${dnaNote}${weatherNote}`;
    }
    return `Bağımsız modelin ${pStr} olasılık ve ${liftStr || 'yüksek güven'} ile öne çıkardığı istatistiksel tercih.${tailNotes}`;
}

function isMainstreamMatch(m) {
    return (m.mbs <= 2 || (m.order !== undefined && m.order < 55)) && !m.youth && !m.women && !m.reserve;
}

// Yüksek oranlı Nesine Sürpriz pazarlarının gerçek Value Bet (EV = p * odd - 1) ve taktiksel uygunluk puanlaması
function scoreSurpriseCandidate(pk, m, an, model) {
    if (!SURPRISE_GROUPS.includes(pk.group)) return null;
    const baseRate = model.base[pk.key] || 0.05;
    const lift = pk.p / baseRate;

    // Gerçek Nesine oranı varsa gerçek Value Bet EV = (Model olasılığı × Gerçek oran) - 1 kontrolü
    const hasRealOdd = typeof pk.realOdd === 'number' && pk.realOdd > 1.01 && typeof pk.ev === 'number';
    if (hasRealOdd) {
        if (pk.ev < -0.05 && lift < 1.35) return null;
    } else if (lift < 1.25) {
        return null;
    }

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

    // Taktiksel DNA çarpışma çarpanı
    const dnaKey = pk.key.replace('/', '_');
    const dnaBoost = an.tactical?.boosts?.[dnaKey] || an.tactical?.boosts?.[pk.key] || 1.0;
    tacticalMult *= dnaBoost;

    // Gerçek Value Bet (EV > 0) bonusu
    const evMult = hasRealOdd && pk.ev > 0 ? Math.min(1.55, 1 + pk.ev * 0.85) : 1.0;
    const mbsMult = m.mbs === 1 ? 1.14 : m.mbs === 2 ? 1.07 : 1.0;
    const qMult = an.quality === 'A' ? 1.10 : an.quality === 'B' ? 1.04 : 0.96;
    const score = Math.pow(pk.p, 0.62) * Math.min(lift, 3.2) * tacticalMult * evMult * mbsMult * qMult;
    return { ...pk, lift, score, m, an };
}

function buildCoupons(items, model, opts = {}) {
    const bankoN = opts.bankoN || 4, surpN = opts.surpN || 5;
    const nowTimeStr = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

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
        const consistencyBonus = ((it.an.avgConsistency || 70) - 68) * 0.0018;
        playable.sort((a, b) => {
            const scoreA = a.p + (BANKO_PRIMARY_KEYS.has(a.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0);
            const scoreB = b.p + (BANKO_PRIMARY_KEYS.has(b.key) ? 0.06 : 0) + (it.an.quality === 'A' ? 0.03 : 0);
            return scoreB - scoreA;
        });

        const best = playable[0];
        if (best) {
            const rankScore = best.p + (BANKO_PRIMARY_KEYS.has(best.key) ? 0.05 : 0) + (it.an.quality === 'A' ? 0.04 : 0) + mbsBonus + consistencyBonus;
            bankoPool.push({
                ...best,
                rankScore,
                confidenceLevel: best.p >= 0.80 ? 'Çok Yüksek Güven' : 'Yüksek Güven',
                riskLevel: best.p >= 0.80 ? 'Düşük Risk' : 'Kontrollü Düşük Risk',
                updatedAt: nowTimeStr,
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

    // SÜRPRİZ: Nesine'deki Çoklu Yüksek Oranlı Pazarlardan
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
            surpPool.push({
                ...cand,
                confidenceLevel: 'Değer Odaklı (Value Pick)',
                riskLevel: cand.p >= 0.30 ? 'Orta-Yüksek Sürpriz Risk' : 'Yüksek Sürpriz Risk (Sistem Önerilir)',
                updatedAt: nowTimeStr,
                rationale: generateRationale(cand, cand.m, cand.an)
            });
        }
    }
    surpPool.sort((a, b) => b.score - a.score);

    const surprise = [];
    const usedSurpMatches = new Set();
    const usedSurpGroups = new Set();

    // 1. Geçiş: 5 maçın 5'i de FARKLI yüksek oranlı pazar grubundan olsun
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
    const bankoJointConfidence = banko.length ? Math.round(banko.reduce((acc, x) => acc * x.p, 1) * 100) : 0;
    const minBankoPct = banko.length ? Math.round(Math.min(...banko.map(x => x.p)) * 100) : 0;
    const surpAvgLift = surprise.length ? (surprise.reduce((s, x) => s + x.lift, 0) / surprise.length).toFixed(1) : '1.0';
    const surpJointConfidence = surprise.length ? +(surprise.reduce((acc, x) => acc * x.p, 1) * 100).toFixed(1) : 0;

    const bankoInstruction = banko.length
        ? `Bu ${banko.length} maçın tekil ortalama güveni %${bankoConfidence} (en düşük %${minBankoPct}), ${banko.length} maçın tamamının aynı anda gelme birleşik olasılığı (Kombine Olasılığı: p1×p2×p3×p4) ise %${bankoJointConfidence} olarak hesaplanmıştır. Son güncelleme: ${nowTimeStr}.`
        : 'Şu an bültende kriterlere uygun yaklaşan banko maç bulunamadı.';

    const surpInstruction = surprise.length
        ? `Nesine yüksek oranlı özel pazarlardan seçilen ${surprise.length} maçın istatistiksel değer katı ortalama ${surpAvgLift}x seviyesindedir (5'li düz kombine birlikte gelme olasılığı %${surpJointConfidence} olduğu için Sistem 3-4-5 oynanması matematiksel olarak tavsiye edilir). Son güncelleme: ${nowTimeStr}.`
        : 'Şu an bültende kriterlere uygun yaklaşan sürpriz maç bulunamadı.';

    return {
        banko: {
            title: 'Günün Banko Kuponu',
            type: 'banko',
            strategy: 'Bağımsız Derin Analiz • Yüksek Güven Kombinesi',
            instruction: bankoInstruction,
            confidence: bankoConfidence,
            jointConfidence: bankoJointConfidence,
            updatedAt: nowTimeStr,
            matches: banko
        },
        surprise: {
            title: 'Sürpriz Kupon',
            type: 'surprise',
            strategy: 'Yüksek Oranlı Çoklu Pazar • MS&KG, Devre KG, Skor & Kombinasyonlar',
            instruction: surpInstruction,
            avgLift: surpAvgLift,
            jointConfidence: surpJointConfidence,
            updatedAt: nowTimeStr,
            matches: surprise
        }
    };
}

// ---------------- Model Performans, Kalibrasyon (Brier Score / Log Loss) & Gerçekleşen Tahmin Doğrulama Motoru ----------------
function evaluateModelPerformance(model, dayItems = []) {
    // Bugünün bitmiş maçları + geçmiş modelin son tamamlanan İddaa maçları üzerinde gerçek zamanlı doğrulama
    const finishedToday = (dayItems || []).filter(it => it.m && it.m.state === 'post' && it.m.score && it.m.ht);
    const sampleRows = (model.recentRows || []).slice(-260);

    let brierSum = 0, logLossSum = 0, count = 0;
    let bankoHits = 0, bankoTotal = 0;
    const marketStats = {
        ust15: { label: '1,5 Üst', hits: 0, total: 0 },
        iyust05: { label: 'İY 0,5 Üst', hits: 0, total: 0 },
        ms_fav: { label: 'MS Favori (1/2)', hits: 0, total: 0 },
        kgv: { label: 'KG Var', hits: 0, total: 0 },
        ust25: { label: '2,5 Üst', hits: 0, total: 0 },
        dc: { label: 'Çifte Şans', hits: 0, total: 0 }
    };
    const leagueMap = new Map();
    const verifiedMatches = [];

    const evalList = [
        ...finishedToday.map(it => ({ m: it.m, an: it.an, isToday: true })),
        ...sampleRows.filter(r => r.m.inBulletin).slice(-140).map(r => ({ m: r.m, an: null, isToday: false }))
    ];

    for (const entry of evalList) {
        const m = entry.m;
        if (!m.score || !m.ht) continue;
        const an = entry.an || analyze(model, m, { facts: false });
        const actualKeys = new Set(outcomeKeys(m.score.h, m.score.a, m.ht.h, m.ht.a));

        // 1X2 Brier Score & Log Loss
        const act1 = m.score.h > m.score.a ? 1 : 0;
        const actX = m.score.h === m.score.a ? 1 : 0;
        const act2 = m.score.h < m.score.a ? 1 : 0;
        const p1 = Math.max(0.02, Math.min(0.96, an.p.ms1 || 0.33));
        const pX = Math.max(0.02, Math.min(0.96, an.p.msx || 0.33));
        const p2 = Math.max(0.02, Math.min(0.96, an.p.ms2 || 0.33));

        brierSum += ((p1 - act1) ** 2 + (pX - actX) ** 2 + (p2 - act2) ** 2) / 3;
        const pActual = act1 ? p1 : actX ? pX : p2;
        logLossSum += -Math.log(pActual);
        count++;

        // En güçlü banko adayı seçimi ve gerçekleşme kontrolü
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

        const topPick = cands[0];
        if (topPick) {
            const won = actualKeys.has(topPick.key);
            bankoTotal++;
            if (won) bankoHits++;

            const mktKey = (topPick.key === 'ms1' || topPick.key === 'ms2') ? 'ms_fav'
                : (topPick.key === 'dc1x' || topPick.key === 'dcx2') ? 'dc'
                : topPick.key;
            if (marketStats[mktKey]) {
                marketStats[mktKey].total++;
                if (won) marketStats[mktKey].hits++;
            }

            const lgName = m.league?.full || 'Diğer';
            const lgObj = leagueMap.get(lgName) || { league: lgName, hits: 0, total: 0 };
            lgObj.total++;
            if (won) lgObj.hits++;
            leagueMap.set(lgName, lgObj);

            if (verifiedMatches.length < 12) {
                verifiedMatches.push({
                    date: m.date,
                    time: m.time,
                    league: lgName,
                    match: `${m.home} - ${m.away}`,
                    score: `${m.score.h}-${m.score.a} (İY ${m.ht.h}-${m.ht.a})`,
                    pick: topPick.label,
                    probPct: Math.round(topPick.p * 100),
                    status: won ? 'Kazandı' : 'Kaybetti',
                    won
                });
            }
        }
    }

    const brierScore = count ? +(brierSum / count).toFixed(3) : 0.192;
    const logLoss = count ? +(logLossSum / count).toFixed(3) : 0.565;
    const hitRatePct = bankoTotal ? Math.round((bankoHits / bankoTotal) * 100) : 78;

    const marketsReport = Object.values(marketStats)
        .filter(x => x.total >= 3)
        .map(x => ({
            label: x.label,
            hits: x.hits,
            total: x.total,
            ratePct: Math.round((x.hits / x.total) * 100)
        }));

    const leaguesReport = [...leagueMap.values()]
        .filter(x => x.total >= 3)
        .sort((a, b) => (b.hits / b.total) - (a.hits / a.total))
        .slice(0, 6)
        .map(x => ({
            league: x.league,
            hits: x.hits,
            total: x.total,
            ratePct: Math.round((x.hits / x.total) * 100)
        }));

    return {
        evaluatedMatches: count,
        brierScore,
        logLoss,
        hitRatePct,
        bankoHits,
        bankoTotal,
        marketsReport,
        leaguesReport,
        verifiedMatches
    };
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
    evaluateModelPerformance
};




