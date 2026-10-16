const mk = require('./mackolik');
const engine = require('./engine');
const intel = require('./intel');

let cachedModel = null;
let cachedModelDate = null;
let modelBuildPromise = null;

// Türkçe karakter duyarsız arama normalizasyonu
const normTr = (s) => String(s || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

const dayAnalysisCache = new Map();

// Sınırlı eşzamanlılıkla (concurrency) asenkron görev çalıştırıcı
async function runWithConcurrency(list, limit, fn) {
    const out = new Array(list.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
        while (idx < list.length) {
            const cur = idx++;
            try {
                out[cur] = await fn(list[cur], cur);
            } catch (_) {
                out[cur] = null;
            }
        }
    });
    await Promise.all(workers);
    return out;
}

// Modeli önbelleğe alır: Concurrency=10 ile tam 75 günlük geçmişi (~0.9 sn) paralel çekip tam kapasiteli modeli hazırlar.
async function getWarmModel(asOf = mk.trToday()) {
    if (cachedModel && cachedModelDate === asOf) return cachedModel;
    if (modelBuildPromise) return modelBuildPromise;

    modelBuildPromise = (async () => {
        try {
            const toIso = mk.addDays(asOf, -1);
            const fromIso = mk.addDays(asOf, -75);
            console.log(`[Football Engine] Tam 75 günlük bağımsız model hazırlanıyor (${fromIso} -> ${toIso})...`);
            const fullHist = await mk.getRange(fromIso, toIso);
            const fullModel = engine.buildModel(fullHist, asOf);
            cachedModel = fullModel;
            cachedModelDate = asOf;
            console.log(`[Football Engine] Tam 75 günlük bağımsız model hazır! Toplam: ${fullHist.length} maç, ${fullModel.teams.size} takım.`);
            return fullModel;
        } finally {
            modelBuildPromise = null;
        }
    })();

    return modelBuildPromise;
}

// Öncelikli İddaa maçlarını dış istihbarat (Hava durumu, Stadyum, Gol kralları, Puan durumu, H2H) ile zenginleştirir
async function enrichPriorityMatches(matches, maxCount = 32) {
    const nowMs = Date.now();
    const candidates = matches
        .filter(m => m.state === 'pre' && m.inBulletin && new Date(m.kickoff).getTime() > nowMs)
        .sort((a, b) => {
            const aMain = engine.isMainstreamMatch(a) ? 0 : 1;
            const bMain = engine.isMainstreamMatch(b) ? 0 : 1;
            if (aMain !== bMain) return aMain - bMain;
            if ((a.mbs || 3) !== (b.mbs || 3)) return (a.mbs || 3) - (b.mbs || 3);
            return (a.order || 999) - (b.order || 999);
        })
        .slice(0, maxCount);

    await runWithConcurrency(candidates, 8, async (m) => {
        const minsToKickoff = (new Date(m.kickoff).getTime() - nowMs) / 60000;
        const info = await intel.enrichMatch(m, {
            fetchDeepSummary: m.mbs <= 2,
            fetchLineup: minsToKickoff <= 75 && minsToKickoff >= -10
        });
        m.intel = info;
    });
}

async function getAnalyzedDay(date = mk.trToday()) {
    const now = Date.now();
    const hit = dayAnalysisCache.get(date);
    const isToday = date === mk.trToday();
    const ttl = isToday ? 45e3 : 15 * 60e3;
    if (hit && now - hit.t < ttl) return hit.data;

    // 75 günlük model ile günün maçları + dış istihbarat (hava, stadyum, liderler) paralel çalışır
    const [model, matches] = await Promise.all([
        getWarmModel(date),
        (async () => {
            const mList = await mk.getDay(date);
            await enrichPriorityMatches(mList, 32);
            return mList;
        })()
    ]);

    const items = [];
    for (const m of matches) {
        try {
            const an = engine.analyze(model, m, { facts: true, intel: m.intel });
            items.push({ m, an });
        } catch (_) {}
    }

    // Gece saatlerinde bugünün oynanabilir İddaa maçı azaldıysa (< 8 maç), yarının İddaa bültenini otomatik dahil et
    let couponItems = items;
    if (isToday) {
        const playableToday = items.filter(it => engine.qualifies(it.m, it.an, 'C'));
        if (playableToday.length < 8) {
            try {
                const tomorrowIso = mk.addDays(date, 1);
                const tomMatches = await mk.getDay(tomorrowIso);
                await enrichPriorityMatches(tomMatches, 24);
                const tomItems = [];
                for (const tm of tomMatches) {
                    try {
                        const mCopy = { ...tm, time: `Yarın ${tm.time}` };
                        const an = engine.analyze(model, mCopy, { facts: true, intel: mCopy.intel });
                        tomItems.push({ m: mCopy, an });
                    } catch (_) {}
                }
                couponItems = [...items, ...tomItems];
            } catch (_) {}
        }
    }

    const coupons = engine.buildCoupons(couponItems, model);

    // Seçilen kupon maçlarında eksik derin özet (H2H / Puan durumu) varsa tamamla ve gerekçeyi güncelle
    const selectedPicks = [
        ...(coupons.banko?.matches || []),
        ...(coupons.surprise?.matches || [])
    ];
    await runWithConcurrency(selectedPicks, 6, async (pick) => {
        if (!pick.m.intel || (!pick.m.intel.standings && !pick.m.intel.espnH2H)) {
            const deepIntel = await intel.enrichMatch(pick.m, { fetchDeepSummary: true });
            pick.m.intel = deepIntel;
            pick.an = engine.analyze(model, pick.m, { facts: true, intel: deepIntel });
            pick.rationale = engine.generateRationale(pick, pick.m, pick.an);
        }
    });

    const data = { date, model, matches, items, couponItems, coupons };
    dayAnalysisCache.set(date, { t: now, data });
    return data;
}

// Maç listesi sorgusu (Sadece İddaa bültenindekiler veya tümü)
async function listMatches({ date = mk.trToday(), filter = 'all', search = '', category = 'all' }) {
    const day = await getAnalyzedDay(date);
    let list = day.items.filter(x => x.m.inBulletin);

    if (filter === 'pre') list = list.filter(x => x.m.state === 'pre');
    else if (filter === 'live') list = list.filter(x => x.m.state === 'live');
    else if (filter === 'post') list = list.filter(x => x.m.state === 'post');

    if (category === 'youth') list = list.filter(x => x.m.youth);
    else if (category === 'women') list = list.filter(x => x.m.women);
    else if (category === 'standard') list = list.filter(x => !x.m.youth && !x.m.women);

    if (search && search.trim()) {
        const q = normTr(search.trim());
        list = list.filter(x => 
            normTr(x.m.home).includes(q) ||
            normTr(x.m.away).includes(q) ||
            normTr(x.m.league.full).includes(q)
        );
    }

    const bulletinMatches = day.matches.filter(x => x.inBulletin);
    return {
        date,
        counts: {
            total: bulletinMatches.length,
            pre: bulletinMatches.filter(x => x.state === 'pre').length,
            live: bulletinMatches.filter(x => x.state === 'live').length,
            post: bulletinMatches.filter(x => x.state === 'post').length,
            filtered: list.length
        },
        matches: list.map(({ m, an }) => ({
            id: m.id,
            home: m.home,
            away: m.away,
            league: m.league,
            time: m.time,
            kickoff: m.kickoff,
            state: m.state,
            label: m.label,
            score: m.score,
            ht: m.ht,
            youth: m.youth,
            women: m.women,
            inBulletin: m.inBulletin,
            quality: an.quality,
            lh: +an.lh.toFixed(2),
            la: +an.la.toFixed(2),
            probs: {
                ms1: Math.round(an.p.ms1 * 100),
                msx: Math.round(an.p.msx * 100),
                ms2: Math.round(an.p.ms2 * 100),
                ust25: Math.round(an.p.ust25 * 100),
                alt25: Math.round(an.p.alt25 * 100),
                kgv: Math.round(an.p.kgv * 100),
                iy1: Math.round(an.p.iy1 * 100),
                iyust05: Math.round(an.p.iyust05 * 100)
            },
            topScores: an.topScores.slice(0, 2)
        }))
    };
}

// Kuponlar sorgusu
async function getCoupons(date = mk.trToday()) {
    const day = await getAnalyzedDay(date);
    const bulletinMatches = day.matches.filter(x => x.inBulletin);
    return {
        date,
        totalMatches: bulletinMatches.length,
        preMatches: bulletinMatches.filter(x => x.state === 'pre').length,
        liveMatches: bulletinMatches.filter(x => x.state === 'live').length,
        banko: day.coupons.banko,
        surprise: day.coupons.surprise
    };
}

// Tek maç detay analizi
async function getMatchDetail(matchId, date = mk.trToday()) {
    const day = await getAnalyzedDay(date);
    const pool = day.couponItems || day.items;
    const item = pool.find(x => String(x.m.id) === String(matchId));
    if (!item) return null;

    if (!item.m.intel || !item.m.intel.standings) {
        item.m.intel = await intel.enrichMatch(item.m, { fetchDeepSummary: true, fetchLineup: true });
        item.an = engine.analyze(day.model, item.m, { facts: true, intel: item.m.intel });
    }

    const { m, an } = item;
    const formatProbs = {};
    for (const [k, v] of Object.entries(an.p)) {
        formatProbs[k] = {
            raw: v,
            pct: Math.round(v * 100),
            label: engine.LABEL[k] || (k.startsWith('htft_') ? 'İY/MS ' + k.slice(5) : k)
        };
    }

    return {
        match: m,
        analysis: {
            quality: an.quality,
            expectedGoals: {
                home: +an.lh.toFixed(2),
                away: +an.la.toFixed(2),
                total: +(an.lh + an.la).toFixed(2)
            },
            momentum: { home: an.momH, away: an.momA },
            h2hSummary: an.h2hSummary || null,
            commonSummary: an.commonSummary || null,
            intel: an.intel || null,
            marketUsed: an.marketUsed,
            sampleSizes: { home: an.nh, away: an.na, league: an.leagueN },
            topScores: an.topScores.slice(0, 5),
            topHtScores: an.topHtScores.slice(0, 3),
            probabilities: formatProbs,
            facts: an.facts || null
        }
    };
}

// Tek bir maçın çok katmanlı derin özet satırını oluşturur
function formatDeepMatchDetails(m, an) {
    const parts = [];
    const hf = an.facts?.home;
    const af = an.facts?.away;

    if (hf && af) {
        const hHomeStr = hf.homeGf !== null ? `Evde ${hf.homeGf} atıp ${hf.homeGa} yiyor` : `Genel ${hf.gf} atıp ${hf.ga} yiyor`;
        const aAwayStr = af.awayGf !== null ? `Dep'te ${af.awayGf} atıp ${af.awayGa} yiyor` : `Genel ${af.gf} atıp ${af.ga} yiyor`;
        parts.push(`Ev/Dep Karnesi: ${m.home} (${hHomeStr}, Form:${hf.formStr || '-'}) | ${m.away} (${aAwayStr}, Form:${af.formStr || '-'})`);

        const scen = [];
        if (hf.leadHoldPct !== null) scen.push(`${m.home} İY öndeyken %${hf.leadHoldPct} koruyor`);
        if (af.comebackPct !== null) scen.push(`${m.away} İY gerideyken %${af.comebackPct} puan çıkarıyor`);
        if (scen.length) parts.push(`Senaryo Direnci: ${scen.join(' | ')}`);
    }

    if (an.commonSummary) parts.push(`Ortak Rakipler: ${an.commonSummary}`);
    if (an.h2hSummary) parts.push(`Aradaki Maçlar: ${an.h2hSummary}`);

    if (an.intel) {
        if (an.intel.weather) {
            const st = an.intel.stadium ? `${an.intel.stadium} (${an.intel.weather.city})` : an.intel.weather.city;
            parts.push(`Saha & Hava: ${st} -> ${an.intel.weather.temp}°C, ${an.intel.weather.condition}, Yağış:%${an.intel.weather.rainProb}, Rüzgar:${an.intel.weather.wind}km/s`);
        }
        if (an.intel.standings && (an.intel.standings.home || an.intel.standings.away)) {
            const sh = an.intel.standings.home;
            const sa = an.intel.standings.away;
            const sStr = [
                sh ? `${m.home}: ${sh.rank ? sh.rank + '. sıra ' : ''}${sh.points}p (${sh.gp} maç)` : null,
                sa ? `${m.away}: ${sa.rank ? sa.rank + '. sıra ' : ''}${sa.points}p (${sa.gp} maç)` : null
            ].filter(Boolean).join(' vs ');
            if (sStr) parts.push(`Puan Tablosu: ${sStr}`);
        }
        const leaders = [];
        if (an.intel.homeLeaders?.length) leaders.push(`${m.home}: ${an.intel.homeLeaders.join(', ')}`);
        if (an.intel.awayLeaders?.length) leaders.push(`${m.away}: ${an.intel.awayLeaders.join(', ')}`);
        if (leaders.length) parts.push(`Kilit Oyuncular: ${leaders.join(' | ')}`);

        if (an.intel.lineup && an.intel.lineup.hasLineup) {
            parts.push(`Resmi İlk 11 Açıklandı: Ev (${an.intel.lineup.homeXi.slice(0, 5).join(', ')}...) | Dep (${an.intel.lineup.awayXi.slice(0, 5).join(', ')}...)`);
        }
    }

    return parts.length ? '   • Detay: ' + parts.join(' || ') : '';
}

// AI Sohbeti için %100 bağımsız derin analiz, güncel İddaa bülteni ve kupon bağlamı
async function buildAiSportsContext(userMessage = '', opts = {}) {
    const isCompact = Boolean(opts.compact);
    const today = mk.trToday();
    const day = await getAnalyzedDay(today);
    const qNorm = normTr(userMessage).trim();

    // Kullanıcı sadece kısa selamlaşma yazdıysa (örn: "merhaba", "selam", "naber") gereksiz token harcama
    const isPureGreeting = qNorm.length <= 22 && /^(merhaba|selam|slm|sa|as|naber|nasilsin|hey|hi|hello|knk|kanka|tesekkurler|eyvallah|iyi gunler|iyi aksamlar)[?!.\s]*$/.test(qNorm);
    if (isPureGreeting) {
        return `[YUSUF AI DURUMU]: Bugün resmi İddaa bülteninde ${day.matches.filter(x => x.inBulletin).length} maç analiz edildi. Günün Banko Kuponu (%${day.coupons.banko?.confidence || 85} güven) ve Sürpriz Kuponu (${day.coupons.surprise?.avgLift || '2.0'}x değer) hazır. Kullanıcıya kısa, samimi yanıt ver ve isterse Günün Banko Kuponunu, Sürpriz Kuponu veya istediği bir maçın derin analizini çıkarabileceğini söyle.`;
    }

    // Kullanıcı "yarın" diye sorarsa veya bugünün maçları azaldıysa yarını da havuza kat
    let activePool = day.couponItems || day.items;
    if (qNorm.includes('yarin') && activePool.length === day.items.length) {
        try {
            const tomorrowDay = await getAnalyzedDay(mk.addDays(today, 1));
            const tomMapped = tomorrowDay.items.map(({ m, an }) => ({
                m: { ...m, time: `Yarın ${m.time}` },
                an
            }));
            activePool = [...day.items, ...tomMapped];
        } catch (_) {}
    }

    // 1. Kuponlar özeti
    let bankoSummary = 'Günün %100 Bağımsız Model Banko Kuponu (Resmi İddaa Bülteni):\n';
    if (day.coupons.banko && day.coupons.banko.matches.length) {
        day.coupons.banko.matches.forEach((b, i) => {
            bankoSummary += `${i + 1}. [${b.m.time}] ${b.m.home} - ${b.m.away} (${b.m.league.full}) | Tercih: ${b.label} (Model Güveni: %${Math.round(b.p * 100)})\n   Gerekçe: ${b.rationale}\n`;
            if (!isCompact) {
                const deepLine = formatDeepMatchDetails(b.m, b.an);
                if (deepLine) bankoSummary += `${deepLine}\n`;
            }
        });
        bankoSummary += `Strateji: ${day.coupons.banko.instruction}\n`;
    } else {
        bankoSummary += 'Şu an yaklaşan uygun banko maç bulunamadı.\n';
    }

    let surpSummary = 'Günün %100 Bağımsız Sürpriz Kuponu (Resmi İddaa Bülteni):\n';
    if (day.coupons.surprise && day.coupons.surprise.matches.length) {
        day.coupons.surprise.matches.forEach((s, i) => {
            surpSummary += `${i + 1}. [${s.m.time}] ${s.m.home} - ${s.m.away} (${s.m.league.full}) | Tercih: ${s.label} (Model Olasılığı: %${Math.round(s.p * 100)}, Değer Katı: ${s.lift ? s.lift.toFixed(1) + 'x' : '1.5x'})\n   Gerekçe: ${s.rationale}\n`;
            if (!isCompact) {
                const deepLine = formatDeepMatchDetails(s.m, s.an);
                if (deepLine) surpSummary += `${deepLine}\n`;
            }
        });
        surpSummary += `Strateji: ${day.coupons.surprise.instruction}\n`;
    } else {
        surpSummary += 'Şu an yaklaşan uygun sürpriz maç bulunamadı.\n';
    }

    // 2. Yalnızca İddaa Bülteninde Yer Alan, Başlamamış ve Ana Bülten Öncelikli Maç Havuzu
    const nowMs = Date.now();
    const qOrder = { A: 0, B: 1, C: 2 };
    const preBulletin = activePool
        .filter(({ m, an }) => m.state === 'pre' && m.inBulletin && an.marketUsed && new Date(m.kickoff).getTime() > nowMs + 5 * 60000)
        .sort((a, b) => {
            const aMain = engine.isMainstreamMatch(a.m) ? 0 : 1;
            const bMain = engine.isMainstreamMatch(b.m) ? 0 : 1;
            if (aMain !== bMain) return aMain - bMain;
            if ((a.m.mbs || 3) !== (b.m.mbs || 3)) return (a.m.mbs || 3) - (b.m.mbs || 3);
            if (qOrder[a.an.quality] !== qOrder[b.an.quality]) return qOrder[a.an.quality] - qOrder[b.an.quality];
            return (a.m.order || 999) - (b.m.order || 999);
        });

    const poolLimit = isCompact ? 10 : 18;
    let upcomingPoolSummary = `\n[RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU - NESİNE & MAÇKOLİK ONAYLI (${preBulletin.length} aktif maçtan en kaliteli ${Math.min(poolLimit, preBulletin.length)} maç)]:\n`;
    preBulletin.slice(0, poolLimit).forEach(({ m, an }, i) => {
        const topSc = an.topScores && an.topScores[0] ? `${an.topScores[0].s}(%${Math.round(an.topScores[0].p * 100)})` : '1-1';
        const topHtSc = an.topHtScores && an.topHtScores[0] ? `${an.topHtScores[0].s}(%${Math.round(an.topHtScores[0].p * 100)})` : '0-0';
        const hf = an.facts?.home, af = an.facts?.away;
        const splitMini = (hf && af && hf.homeGf !== null && af.awayGf !== null)
            ? ` | Ev:${hf.homeGf}/${hf.homeGa}(${hf.formStr || '-'}) Dep:${af.awayGf}/${af.awayGa}(${af.formStr || '-'})`
            : '';
        const wMini = an.intel?.weather ? ` | 🌤️${an.intel.weather.temp}°C` : '';
        const lMini = (an.intel?.homeLeaders?.[0] || an.intel?.awayLeaders?.[0])
            ? ` | ⭐${[an.intel?.homeLeaders?.[0], an.intel?.awayLeaders?.[0]].filter(Boolean).join('/')}`
            : '';
        const surpCands = [
            { l: 'MS1&KG', p: an.p.ms1_kgv || 0 },
            { l: 'MS2&KG', p: an.p.ms2_kgv || 0 },
            { l: 'MSX&KG', p: an.p.msx_kgv || 0 },
            { l: 'MS1&2.5Ü', p: an.p.ms1_ust25 || 0 },
            { l: 'MS2&2.5Ü', p: an.p.ms2_ust25 || 0 },
            { l: '2.5Ü&KG', p: an.p.ust25_kgv || 0 },
            { l: 'İYKG', p: an.p.iykgv || 0 },
            { l: '2YKG', p: an.p.y2kgv || 0 },
            { l: 'İY1.5Ü', p: an.p.iyust15 || 0 },
            { l: 'HMS1(-1)', p: an.p.hms1 || 0 },
            { l: 'HMS2(-1)', p: an.p.hms2 || 0 },
            { l: '4-6Gol', p: an.p.tg46 || 0 }
        ].sort((a, b) => b.p - a.p).slice(0, 4).map(x => `${x.l}:%${Math.round(x.p * 100)}`).join(' ');
        const surpMini = ` | Sürpriz:[${surpCands} İYSkor:${topHtSc} MSSkor:${topSc}]`;

        upcomingPoolSummary += `${i + 1}. [${m.time}] ${m.home}-${m.away} (${m.league.full}) | xG:${an.lh.toFixed(2)}-${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)}${surpMini}${splitMini}${wMini}${lMini}\n`;
    });

    // 3. Kullanıcının sorduğu spesifik bir takım veya lig varsa (Türkçe karakter duyarsız eşleştirme + anlık derin istihbarat)
    let relevantMatches = '';
    const stopWords = new Set(['mac', 'maci', 'maclar', 'maclari', 'kupon', 'kuponu', 'analiz', 'bugun', 'bugunku', 'yarin', 'icin', 'nasil', 'olur', 'bana', 'yap', 'ver', 'ust', 'alt', 'gol', 'ilk', 'yari', 'ikinci', 'gunun', 'banko', 'surpriz', 'yuksek', 'oranli', 'deger', 'resmi', 'iddaa', 'nesine', 'bulteninden', 'oranlardan', 'bagimsiz', 'deplasman', 'karnesi', 'son', 'formu', 'ortak', 'rakipler', 'saha', 'hava', 'sartlari', 'kilit', 'oyuncularini', 'inceleyerek', 'guvendigin', 'maclik', 'tablolu', 'grafik', 'barli', 'olarak', 'cikar', 'hazirla', 'devre', 'karakteri', 'firsati', 'firsatlari', 'sistem', 'kombine', 'oynamaliyim', 'detayli', 'kesin', 'skor', 'handikap']);
    const words = qNorm.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !stopWords.has(w));
    if (words.length > 0) {
        const matchedItems = activePool.filter(({ m }) => {
            const target = normTr(`${m.home} ${m.away} ${m.league.full} ${m.league.country}`);
            return words.some(w => target.includes(w));
        });

        if (matchedItems.length > 0) {
            const topMatched = matchedItems.slice(0, isCompact ? 3 : 5);
            await runWithConcurrency(topMatched, 5, async (item) => {
                if (!item.m.intel || !item.m.intel.standings) {
                    item.m.intel = await intel.enrichMatch(item.m, { fetchDeepSummary: true, fetchLineup: true });
                    item.an = engine.analyze(day.model, item.m, { facts: true, intel: item.m.intel });
                }
            });

            relevantMatches = '\n[KULLANICININ SORDUĞU TAKIM/LİG İÇİN DERİN İNCELEME SONUÇLARI]:\n';
            topMatched.forEach(({ m, an }) => {
                const bTag = m.inBulletin ? 'Resmi İddaa Bülteninde Var' : 'İddaa Dışı';
                relevantMatches += `- [${m.time}] ${m.home} - ${m.away} (${m.league.full} | ${bTag}) | Durum: ${m.state === 'live' ? 'CANLI ' + m.label : m.state === 'post' ? 'MS ' + (m.score ? m.score.h + '-' + m.score.a : '') : 'Başlamadı'}\n`;
                relevantMatches += `  Bağımsız xG: Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} | 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)}\n`;
                relevantMatches += `  Yüksek Oranlı Nesine Pazarları: MS1&KG:%${Math.round((an.p.ms1_kgv || 0) * 100)} | MS2&KG:%${Math.round((an.p.ms2_kgv || 0) * 100)} | MS1&2.5Ü:%${Math.round((an.p.ms1_ust25 || 0) * 100)} | MS2&2.5Ü:%${Math.round((an.p.ms2_ust25 || 0) * 100)} | 2.5Ü&KG:%${Math.round((an.p.ust25_kgv || 0) * 100)} | İY KG Var:%${Math.round((an.p.iykgv || 0) * 100)} | 2.Yarı KG Var:%${Math.round((an.p.y2kgv || 0) * 100)} | İY 1.5 Üst:%${Math.round((an.p.iyust15 || 0) * 100)} | 4-6 Gol:%${Math.round((an.p.tg46 || 0) * 100)}\n`;
                if (an.topScores && an.topScores.length) {
                    relevantMatches += `  Olası MS Skorlar: ${an.topScores.slice(0, 3).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')} | Olası İY Skorlar: ${(an.topHtScores || []).slice(0, 2).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')}\n`;
                }
                const deepLine = formatDeepMatchDetails(m, an);
                if (deepLine) relevantMatches += `${deepLine}\n`;
            });
        }
    }

    const totalBulletinCount = day.matches.filter(x => x.inBulletin).length;

    return `
[YUSUF AI %100 BAĞIMSIZ DERİN FUTBOL ANALİZ MOTORU - ${today}]
Bugün Resmi İddaa Bülteninde (Nesine / Maçkolik) Yer Alan Maç Sayısı: ${totalBulletinCount}
NOT: Aşağıdaki tüm xG ve olasılık yüzdeleri İddaa/bahis oranlarından veya dış yorumculardan TAMAMEN BAĞIMSIZDIR. Motorumuz her takımın kendi ev/deplasman karnesini, son 5 maç form ivmesini, ortak rakiplere karşı performansını, aralarındaki geçmiş maçları (H2H), maç saati hava/saha durumunu, puan tablosunu ve kilit oyuncu verilerini kendi inceleyerek hesaplamıştır.

${bankoSummary}
${surpSummary}
${upcomingPoolSummary}
${relevantMatches}
ÖNEMLİ KURALLAR (MOBİL ÖNCELİKLİ, KISA, ÖZ, GRAFİKLİ VE KENDİ DERİN ANALİZİNİ YANSITAN FORMAT):
1. KULLANICI TELEFONDAN TAKİP ETMEKTEDİR: Açıklamaları kesinlikle UZUN TUTMA. Uzun paragraf yazmak Yasaktır; ancak her maçın tek satırlık gerekçesinde kendi incelediğin SOMUT VERİLERİ (ev/dep gol ortalaması, ortak rakipler, H2H, hava durumu, form veya gol kralı) net biçimde belirt.
2. ÇIKTI FORMATI STANDARDI (BUNA KESİNLİKLE UYULACAK):
   a) Başlık: Kupon Adı ve Strateji (örn: 🎯 **Günün Bağımsız Banko Kuponu** • *Düz 4'lü Kombine* veya 🚀 **Günün Yüksek Değerli Sürpriz Kuponu** • *3-4-5 Sistem / Kombine*)
   b) Kompakt Grafik Tablo:
      | # | Saat | Maç | Tercih | Güven / Değer İbresi |
      (Güven İbresi sütununda görsel ilerleme barı kullan: örn. 🟩 %84 [████████░░] veya Sürpriz kuponda ⭐ %28 • 2.4x Değer [█████░░░░░])
   c) Derin Analiz Gerekçeleri (Maç başına 1-2 satırlık somut veri özeti):
      - **Ev - Deplasman:** 📊 Bağımsız xG: 2.14 - 0.88 • Ev sahibi iç sahada maç başı 2.2 gol atıyor, 3 ortak rakipte +1.4 averaj üstünlüğü var (🌤️ 16°C Açık).
   d) Tek Cümlelik Oynanış Notu.
3. SÜRPRİZ KUPON ÇEŞİTLİLİĞİ KURALI (ÇOK ÖNEMLİ): Sürpriz kupon hazırlarken ASLA sadece İY/MS veya İY 1/2 seçme! Nesine bültenindeki yüksek oranlı özel pazarları çeşitlendirerek kullan: **MS 1 & KG Var**, **MS 2 & KG Var**, **MS X & KG Var**, **MS 1 & 2,5 Üst**, **MS 2 & 2,5 Üst**, **2,5 Üst & KG Var**, **İlk Yarı KG Var**, **2. Yarı KG Var**, **İlk Yarı 1,5 Üst**, **Handikaplı MS (-1)**, **Toplam 4-6 Gol**, **İY Kesin Skor (1-1, 1-0, 0-1)**, **MS Kesin Skor (2-1, 1-2, 2-2)** ve **İY/MS**. Her maçta hangi yüksek oranlı seçenek takımın karakterine ve derin istatistiğine en çok uyuyorsa onu seç.
4. ASLA bahis oranları (1.85, 2.40 vb.) veya TL kazanç rakamları VERME. Yalnızca kendi bağımsız model yüzdelerini, değer katını (örn: 2.3x Değer), xG değerlerini, ev/dep istatistiklerini ve saha/hava verilerini belirt.
5. KESİN KURAL (HALÜSİNASYON YASAĞI): Yalnızca yukarıdaki [RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU] içinde yazılı olan maçları kullan! Bu listede olmayan hiçbir maçı ASLA uydurma.
`;
}

module.exports = {
    getWarmModel,
    getAnalyzedDay,
    listMatches,
    getCoupons,
    getMatchDetail,
    buildAiSportsContext
};
