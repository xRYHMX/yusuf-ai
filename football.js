const mk = require('./mackolik');
const engine = require('./engine');

let cachedModel = null;
let cachedModelDate = null;
let modelBuildPromise = null;

// Modeli önbelleğe alır ve arka planda hazır tutar
async function getWarmModel(asOf = mk.trToday()) {
    if (cachedModel && cachedModelDate === asOf) return cachedModel;
    if (modelBuildPromise) return modelBuildPromise;

    modelBuildPromise = (async () => {
        try {
            console.log(`[Football Engine] Model inşa ediliyor (Geçmiş 30 gün -> ${asOf})...`);
            const fromIso = mk.addDays(asOf, -30);
            const toIso = mk.addDays(asOf, -1);
            const hist = await mk.getRange(fromIso, toIso);
            console.log(`[Football Engine] Geçmiş veri tamam: ${hist.length} maç.`);
            const model = engine.buildModel(hist, asOf);
            cachedModel = model;
            cachedModelDate = asOf;
            console.log(`[Football Engine] Model hazır! Modellenen takım sayısı: ${model.teams.size}`);
            return model;
        } finally {
            modelBuildPromise = null;
        }
    })();

    return modelBuildPromise;
}

const dayAnalysisCache = new Map();

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

    const coupons = engine.buildCoupons(items, model);
    const data = { date, model, matches, items, coupons };
    dayAnalysisCache.set(date, { t: now, data });
    return data;
}

// Maç listesi sorgusu
async function listMatches({ date = mk.trToday(), filter = 'all', search = '', category = 'all' }) {
    const day = await getAnalyzedDay(date);
    let list = day.items;

    // Durum filtresi
    if (filter === 'pre') list = list.filter(x => x.m.state === 'pre');
    else if (filter === 'live') list = list.filter(x => x.m.state === 'live');
    else if (filter === 'post') list = list.filter(x => x.m.state === 'post');

    // Kategori filtresi
    if (category === 'youth') list = list.filter(x => x.m.youth);
    else if (category === 'women') list = list.filter(x => x.m.women);
    else if (category === 'standard') list = list.filter(x => !x.m.youth && !x.m.women);

    // Arama
    if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter(x => 
            x.m.home.toLowerCase().includes(q) ||
            x.m.away.toLowerCase().includes(q) ||
            x.m.league.full.toLowerCase().includes(q)
        );
    }

    return {
        date,
        counts: {
            total: day.matches.length,
            pre: day.matches.filter(x => x.state === 'pre').length,
            live: day.matches.filter(x => x.state === 'live').length,
            post: day.matches.filter(x => x.state === 'post').length,
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
    return {
        date,
        totalMatches: day.matches.length,
        preMatches: day.matches.filter(x => x.state === 'pre').length,
        liveMatches: day.matches.filter(x => x.state === 'live').length,
        banko: day.coupons.banko,
        surprise: day.coupons.surprise
    };
}

// Tek maç detay analizi
async function getMatchDetail(matchId, date = mk.trToday()) {
    const day = await getAnalyzedDay(date);
    const item = day.items.find(x => String(x.m.id) === String(matchId));
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

// AI Sohbeti için güncel bülten ve kupon bağlamı
async function buildAiSportsContext(userMessage = '') {
    const today = mk.trToday();
    const day = await getAnalyzedDay(today);
    const qLower = userMessage.toLowerCase();

    // Kuponlar özeti
    let bankoSummary = 'Günün Banko Kuponu:\n';
    if (day.coupons.banko && day.coupons.banko.matches.length) {
        day.coupons.banko.matches.forEach((b, i) => {
            bankoSummary += `${i + 1}. [${b.m.time}] ${b.m.home} - ${b.m.away} | Tercih: ${b.label} (Güven: %${Math.round(b.p * 100)})\n   Açıklama: ${b.rationale}\n`;
        });
        bankoSummary += `Strateji: ${day.coupons.banko.instruction}\n`;
    } else {
        bankoSummary += 'Şu an yaklaşan uygun banko maç bulunamadı.\n';
    }

    let surpSummary = 'Günün Yüksek Değer Sürpriz Kuponu:\n';
    if (day.coupons.surprise && day.coupons.surprise.matches.length) {
        day.coupons.surprise.matches.forEach((s, i) => {
            surpSummary += `${i + 1}. [${s.m.time}] ${s.m.home} - ${s.m.away} | Tercih: ${s.label} (Model Olasılığı: %${Math.round(s.p * 100)}, Değer Katı: ${s.lift ? s.lift.toFixed(1) + 'x' : '1.5x'})\n   Açıklama: ${s.rationale}\n`;
        });
        surpSummary += `Strateji: ${day.coupons.surprise.instruction}\n`;
    } else {
        surpSummary += 'Şu an yaklaşan uygun sürpriz maç bulunamadı.\n';
    }

    // Yaklaşan diğer maçlar havuzu (Kullanıcı alternatif, farklı veya özel kupon istediğinde seçebileceğin zengin liste)
    let upcomingPoolSummary = 'Yaklaşan Diğer Maçlar Havuzu (Alternatif ve Farklı Kuponlar İçin Seçilebilir):\n';
    const preMatches = day.items.filter(x => x.m.state === 'pre');
    preMatches.slice(0, 20).forEach(({ m, an }, i) => {
        const topSc = an.topScores && an.topScores[0] ? an.topScores[0].s : '';
        const tags = (m.youth ? ' [U Takımı]' : '') + (m.women ? ' [Kadın]' : '');
        upcomingPoolSummary += `${i + 1}. [${m.time}] ${m.home} vs ${m.away} (${m.league.full})${tags} | xG: Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | MS 1: %${Math.round(an.p.ms1 * 100)}, X: %${Math.round(an.p.msx * 100)}, MS 2: %${Math.round(an.p.ms2 * 100)} | 2.5 Üst: %${Math.round(an.p.ust25 * 100)}, KG Var: %${Math.round(an.p.kgv * 100)}, İY 0.5 Üst: %${Math.round(an.p.iyust05 * 100)}, İY 1: %${Math.round(an.p.iy1 * 100)} | Muhtemel Skor: ${topSc}\n`;
    });

    // Kullanıcının sorduğu spesifik bir takım veya lig varsa maçlarını ekle
    let relevantMatches = '';
    const matchedItems = day.items.filter(({ m }) => 
        qLower.includes(m.home.toLowerCase()) || 
        qLower.includes(m.away.toLowerCase()) || 
        qLower.includes(m.league.name.toLowerCase()) ||
        qLower.includes(m.league.country.toLowerCase())
    );

    if (matchedItems.length > 0) {
        relevantMatches = '\nKullanıcının Sorduğu İlgili Maçlar:\n';
        matchedItems.slice(0, 6).forEach(({ m, an }) => {
            relevantMatches += `- [${m.time}] ${m.home} vs ${m.away} (${m.league.full}) | Durum: ${m.state === 'live' ? 'CANLI ' + m.label : m.state === 'post' ? 'MS ' + (m.score ? m.score.h + '-' + m.score.a : '') : m.time}\n`;
            relevantMatches += `  Beklenen Goller: Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | MS 1: %${Math.round(an.p.ms1 * 100)}, X: %${Math.round(an.p.msx * 100)}, MS 2: %${Math.round(an.p.ms2 * 100)} | 2.5 Üst: %${Math.round(an.p.ust25 * 100)}, KG Var: %${Math.round(an.p.kgv * 100)}, İY 0.5 Üst: %${Math.round(an.p.iyust05 * 100)}\n`;
            if (an.topScores && an.topScores.length) {
                relevantMatches += `  En Olası Skorlar: ${an.topScores.slice(0, 3).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')}\n`;
            }
        });
    }

    return `
[CANLI FUTBOL BÜLTENİ VE İSTATİSTİKSEL MODEL BİLGİSİ - ${today}]
Toplam Bugün Oynanan/Oynanacak Maç: ${day.matches.length} (Tüm dünya ligleri, U takımları ve kadın ligleri dahil)

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
      (Güven İbresi sütununda görsel ilerleme barı kullan: örn. 🟩 %92 [█████████░] veya 🟨 %75 [███████░░░] veya ⭐ 1.9x Değer)
   c) Hızlı Taktiksel Gerekçeler (Maç başına SADECE 1 SATIRLIK hap bilgi):
      - **Twente - Thun:** 📊 Toplam xG: 4.14 • İki takımın gol ortalaması 2.0+ • Erken gol baskısı yüksek.
      - **Rennes - OFI:** 🛡️ Rennes evinde namağlup • Modelde %87 yenilmeme güvencesi.
   d) Tek Cümlelik Oynanış Notu: (örn: 💡 *Öneri: Düz 4 maçlık kombine kupon olarak oynanması uygundur.*)
3. ASLA bahis oranları (1.85, 2.40 vb.) veya TL kazanç rakamları VERME. Yalnızca model yüzdelerini ve xG değerlerini belirt.
4. Tüm veriler Maçkolik canlı sisteminden ve Poisson/Dixon-Coles modelinden gelmektedir, asla uydurma maç yazma.
5. KUPON ÇEŞİTLİLİĞİ: Kullanıcı 'başka kupon', 'farklı maçlar', 'ilk yarı gol' istediğinde 'Yaklaşan Diğer Maçlar Havuzu'ndaki zengin maçları (U takımları, Avrupa maçları vb.) kullanarak aynı kısa, grafikli formatta taze kuponlar üret.
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
