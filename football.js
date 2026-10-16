const mk = require('./mackolik');
const engine = require('./engine');

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

// Modeli önbelleğe alır: Render soğuk açılışında önce son 21 günü (0.3 sn) çekip anında yanıt verir,
// ardından arka planda 75 güne tamamlayıp modeli tam kapasiteye yükseltir.
async function getWarmModel(asOf = mk.trToday()) {
    if (cachedModel && cachedModelDate === asOf) return cachedModel;
    if (modelBuildPromise) return modelBuildPromise;

    modelBuildPromise = (async () => {
        try {
            const toIso = mk.addDays(asOf, -1);
            const fastFromIso = mk.addDays(asOf, -21);
            console.log(`[Football Engine] Hızlı başlangıç modeli hazırlanıyor (Son 21 gün -> ${asOf})...`);
            const recentHist = await mk.getRange(fastFromIso, toIso);
            const fastModel = engine.buildModel(recentHist, asOf);
            cachedModel = fastModel;
            cachedModelDate = asOf;
            console.log(`[Football Engine] Hızlı model aktif (${recentHist.length} maç). Arka planda 75 güne genişletiliyor...`);

            // Arka planda kalan günleri (-75 .. -22) çekip modeli tam 75 güne yükselt
            (async () => {
                try {
                    const deepFromIso = mk.addDays(asOf, -75);
                    const deepToIso = mk.addDays(asOf, -22);
                    const olderHist = await mk.getRange(deepFromIso, deepToIso);
                    const fullHist = [...olderHist, ...recentHist];
                    const fullModel = engine.buildModel(fullHist, asOf);
                    cachedModel = fullModel;
                    cachedModelDate = asOf;
                    dayAnalysisCache.clear();
                    console.log(`[Football Engine] Tam 75 günlük model hazır! Toplam: ${fullHist.length} maç, ${fullModel.teams.size} takım.`);
                } catch (e) {
                    console.error('[Football Engine] Arka plan 75 gün genişletme uyarısı:', e.message);
                }
            })();

            return fastModel;
        } finally {
            modelBuildPromise = null;
        }
    })();

    return modelBuildPromise;
}

async function getAnalyzedDay(date = mk.trToday()) {
    const now = Date.now();
    const hit = dayAnalysisCache.get(date);
    const isToday = date === mk.trToday();
    const ttl = isToday ? 35e3 : 15 * 60e3;
    if (hit && now - hit.t < ttl) return hit.data;

    const model = await getWarmModel(date);
    const matches = await mk.getDay(date);
    const items = [];
    for (const m of matches) {
        try {
            const an = engine.analyze(model, m, { facts: true });
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
                const tomItems = [];
                for (const tm of tomMatches) {
                    try {
                        const mCopy = { ...tm, time: `Yarın ${tm.time}` };
                        const an = engine.analyze(model, mCopy, { facts: true });
                        tomItems.push({ m: mCopy, an });
                    } catch (_) {}
                }
                couponItems = [...items, ...tomItems];
            } catch (_) {}
        }
    }

    const coupons = engine.buildCoupons(couponItems, model);
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
            marketUsed: an.marketUsed,
            sampleSizes: { home: an.nh, away: an.na, league: an.leagueN },
            topScores: an.topScores.slice(0, 5),
            topHtScores: an.topHtScores.slice(0, 3),
            probabilities: formatProbs,
            facts: an.facts || null
        }
    };
}

// AI Sohbeti için güncel İddaa bülteni ve kupon bağlamı
async function buildAiSportsContext(userMessage = '') {
    const today = mk.trToday();
    const day = await getAnalyzedDay(today);
    const qNorm = normTr(userMessage);

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
    let bankoSummary = 'Günün Resmi İddaa Banko Kuponu:\n';
    if (day.coupons.banko && day.coupons.banko.matches.length) {
        day.coupons.banko.matches.forEach((b, i) => {
            bankoSummary += `${i + 1}. [${b.m.time}] ${b.m.home} - ${b.m.away} (${b.m.league.full}) | Tercih: ${b.label} (Güven: %${Math.round(b.p * 100)})\n   Gerekçe: ${b.rationale}\n`;
        });
        bankoSummary += `Strateji: ${day.coupons.banko.instruction}\n`;
    } else {
        bankoSummary += 'Şu an yaklaşan uygun banko maç bulunamadı.\n';
    }

    let surpSummary = 'Günün Resmi İddaa Yüksek Değer Sürpriz Kuponu:\n';
    if (day.coupons.surprise && day.coupons.surprise.matches.length) {
        day.coupons.surprise.matches.forEach((s, i) => {
            surpSummary += `${i + 1}. [${s.m.time}] ${s.m.home} - ${s.m.away} (${s.m.league.full}) | Tercih: ${s.label} (Model Olasılığı: %${Math.round(s.p * 100)}, Değer Katı: ${s.lift ? s.lift.toFixed(1) + 'x' : '1.5x'})\n   Gerekçe: ${s.rationale}\n`;
        });
        surpSummary += `Strateji: ${day.coupons.surprise.instruction}\n`;
    } else {
        surpSummary += 'Şu an yaklaşan uygun sürpriz maç bulunamadı.\n';
    }

    // 2. Yalnızca İddaa Bülteninde Yer Alan, Başlamamış ve Ana Bülten Öncelikli Maç Havuzu (45 Maç)
    const nowMs = Date.now();
    const qOrder = { A: 0, B: 1, C: 2 };
    const preBulletin = activePool
        .filter(({ m, an }) => m.state === 'pre' && m.inBulletin && an.marketUsed && new Date(m.kickoff).getTime() > nowMs + 5 * 60000)
        .sort((a, b) => {
            const aMain = (!a.m.youth && !a.m.women && !a.m.reserve) ? 0 : 1;
            const bMain = (!b.m.youth && !b.m.women && !b.m.reserve) ? 0 : 1;
            if (aMain !== bMain) return aMain - bMain;
            if ((a.m.mbs || 3) !== (b.m.mbs || 3)) return (a.m.mbs || 3) - (b.m.mbs || 3);
            if (qOrder[a.an.quality] !== qOrder[b.an.quality]) return qOrder[a.an.quality] - qOrder[b.an.quality];
            return (a.m.order || 999) - (b.m.order || 999);
        });

    let upcomingPoolSummary = `\n[RESMİ İDDAA BÜLTENİ MAÇ HAVUZU - NESİNE & MAÇKOLİK ONAYLI (${preBulletin.length} aktif maçtan en kaliteli ${Math.min(45, preBulletin.length)} maç)]:\n`;
    preBulletin.slice(0, 45).forEach(({ m, an }, i) => {
        const topSc = an.topScores && an.topScores[0] ? an.topScores[0].s : '1-1';
        upcomingPoolSummary += `${i + 1}. [${m.time}] ${m.home} - ${m.away} (${m.league.full}) [Kalite:${an.quality}] | xG:${an.lh.toFixed(2)}-${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} | 1.5Ü:%${Math.round(an.p.ust15 * 100)} 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)} İY1:%${Math.round(an.p.iy1 * 100)} İY2:%${Math.round(an.p.iy2 * 100)} | Skor:${topSc}\n`;
    });

    // 3. Kullanıcının sorduğu spesifik bir takım veya lig varsa (Türkçe karakter duyarsız eşleştirme)
    let relevantMatches = '';
    const words = qNorm.split(/\s+/).filter(w => w.length >= 3 && !['mac', 'maci', 'maclar', 'kupon', 'kuponu', 'analiz', 'bugun', 'yarin', 'icin', 'nasil', 'olur', 'bana', 'yap', 'ver', 'ust', 'alt', 'gol', 'ilk', 'yari'].includes(w));
    if (words.length > 0) {
        const matchedItems = activePool.filter(({ m }) => {
            const target = normTr(`${m.home} ${m.away} ${m.league.full} ${m.league.country}`);
            return words.some(w => target.includes(w));
        });

        if (matchedItems.length > 0) {
            relevantMatches = '\n[KULLANICININ SORDUĞU TAKIM/LİG İLE EŞLEŞEN MAÇLAR]:\n';
            matchedItems.slice(0, 10).forEach(({ m, an }) => {
                const bTag = m.inBulletin ? 'İddaa Bülteninde Var' : 'İddaa Dışı';
                relevantMatches += `- [${m.time}] ${m.home} - ${m.away} (${m.league.full} | ${bTag}) | Durum: ${m.state === 'live' ? 'CANLI ' + m.label : m.state === 'post' ? 'MS ' + (m.score ? m.score.h + '-' + m.score.a : '') : 'Başlamadı'}\n`;
                relevantMatches += `  xG: Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} | 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)}\n`;
                if (an.topScores && an.topScores.length) {
                    relevantMatches += `  Olası Skorlar: ${an.topScores.slice(0, 3).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')}\n`;
                }
            });
        }
    }

    const totalBulletinCount = day.matches.filter(x => x.inBulletin).length;

    return `
[CANLI RESMİ İDDAA BÜLTENİ VE POISSON MODEL VERİSİ - ${today}]
Bugün İddaa Bülteninde Yer Alan Resmi Maç Sayısı: ${totalBulletinCount} (Nesine / Maçkolik İddaa Programı)

${bankoSummary}
${surpSummary}
${upcomingPoolSummary}
${relevantMatches}
ÖNEMLİ KURALLAR (MOBİL ÖNCELİKLİ, KISA, ÖZ VE GRAFİKLİ FORMAT):
1. KULLANICI TELEFONDAN TAKİP ETMEKTEDİR: Açıklamaları kesinlikle UZUN TUTMA. Paragraf yazmak, hikaye anlatmak veya laf kalabalığı yapmak KESİNLİKLE YASAKTIR.
2. ÇIKTI FORMATI STANDARDI (BUNA KESİNLİKLE UYULACAK):
   a) Başlık: Kupon Adı ve Strateji (örn: 🎯 **Günün Banko Kuponu** • *Düz 4'lü Kombine*)
   b) Kompakt Grafik Tablo:
      | # | Saat | Maç | Tercih | Güven İbresi |
      (Güven İbresi sütununda görsel ilerleme barı kullan: örn. 🟩 %84 [████████░░] veya 🟨 %72 [███████░░░] veya ⭐ 2.1x Değer)
   c) Hızlı Taktiksel Gerekçeler (Maç başına SADECE 1 SATIRLIK hap bilgi):
      - **Ev - Deplasman:** 📊 Toplam xG: 3.18 • Ev sahibi iç sahada maç başı 2.1 gol üretiyor.
   d) Tek Cümlelik Oynanış Notu: (örn: 💡 *Öneri: Resmi İddaa bülteninde yer alan bu maçları düz kombine olarak değerlendirebilirsiniz.*)
3. ASLA bahis oranları (1.85, 2.40 vb.) veya TL kazanç rakamları VERME. Yalnızca model yüzdelerini ve xG değerlerini belirt.
4. KESİN KURAL (HALÜSİNASYON YASAĞI): Yalnızca yukarıdaki [RESMİ İDDAA BÜLTENİ MAÇ HAVUZU] içinde yazılı olan maçları kullan! Bu listede olmayan hiçbir maçı ASLA uydurma, hafızandan takım/maç ekleme. Listedeki tüm maçlar Nesine ve Maçkolik'te mevcuttur.
5. KUPON ÇEŞİTLİLİĞİ: Kullanıcı 'başka kupon', 'farklı maçlar', 'ilk yarı gol', '2.5 üst kuponu' istediğinde [RESMİ İDDAA BÜLTENİ MAÇ HAVUZU] listesinden farklı maçlar seçerek aynı kısa, grafikli formatta yeni kuponlar üret.
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

