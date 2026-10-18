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

// Öncelikli İddaa maçlarını dış istihbarat + gerçek son maç korner/şut/kadro/eksik verileriyle zenginleştirir
async function enrichPriorityMatches(matches, model, maxCount = 24) {
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
        const homePast = (model?.teams?.get(m.homeId)?.last || []).slice(0, 6);
        const awayPast = (model?.teams?.get(m.awayId)?.last || []).slice(0, 6);
        const info = await intel.enrichMatch(m, {
            fetchDeepSummary: m.mbs <= 2,
            fetchLineup: minsToKickoff <= 75 && minsToKickoff >= -10,
            homePastMatches: homePast,
            awayPastMatches: awayPast
        });
        m.intel = info;
    });
}

const dayRefreshInFlight = new Map();

async function _computeAnalyzedDay(date) {
    const isToday = date === mk.trToday();

    // 75 günlük model ile günün maçları paralel çekilir, ardından modeldeki geçmiş maç ID'leriyle gerçek korner/şut/kadro istihbaratı toplanır
    const [model, matches] = await Promise.all([
        getWarmModel(date),
        mk.getDay(date)
    ]);

    await enrichPriorityMatches(matches, model, 20);

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
                await enrichPriorityMatches(tomMatches, model, 16);
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

    // Seçilen kupon maçlarında eksik derin özet (Gerçek Korner/Şut, Kadro/İlk 11, H2H, Puan Durumu) varsa tamamla ve gerekçeyi güncelle
    const selectedPicks = [
        ...(coupons.banko?.matches || []),
        ...(coupons.surprise?.matches || [])
    ];
    await runWithConcurrency(selectedPicks, 6, async (pick) => {
        if (!pick.m.intel || !pick.m.intel.realStats || (!pick.m.intel.standings && !pick.m.intel.espnH2H)) {
            const homePast = (model?.teams?.get(pick.m.homeId)?.last || []).slice(0, 6);
            const awayPast = (model?.teams?.get(pick.m.awayId)?.last || []).slice(0, 6);
            const deepIntel = await intel.enrichMatch(pick.m, {
                fetchDeepSummary: true,
                fetchLineup: true,
                homePastMatches: homePast,
                awayPastMatches: awayPast
            });
            pick.m.intel = deepIntel;
            pick.an = engine.analyze(model, pick.m, { facts: true, intel: deepIntel });
            pick.dataTrust = pick.an.dataTrust;
            pick.rationale = engine.generateRationale(pick, pick.m, pick.an);
        }
    });

    const performance = typeof engine.evaluateModelPerformance === 'function'
        ? engine.evaluateModelPerformance(model, items)
        : null;

    const data = { date, model, matches, items, couponItems, coupons, performance };
    dayAnalysisCache.set(date, { t: Date.now(), data });

    if (global.addSystemLog) {
        const inBullCount = matches.filter(x => x.inBulletin).length;
        global.addSystemLog({
            level: 'info',
            category: 'football',
            scope: 'FixtureEngine',
            message: `${date} fikstürü yüklendi (${matches.length} maç, ${inBullCount} İddaa bülteninde).`
        });
    }

    return data;
}

async function getAnalyzedDay(date = mk.trToday()) {
    const now = Date.now();
    const hit = dayAnalysisCache.get(date);
    const isToday = date === mk.trToday();
    const ttl = isToday ? 2 * 60e3 : 10 * 60e3;

    if (hit) {
        if (now - hit.t >= ttl && !dayRefreshInFlight.has(date)) {
            const p = _computeAnalyzedDay(date).catch(() => {}).finally(() => dayRefreshInFlight.delete(date));
            dayRefreshInFlight.set(date, p);
        }
        return hit.data;
    }

    if (dayRefreshInFlight.has(date)) return dayRefreshInFlight.get(date);
    const p = _computeAnalyzedDay(date).finally(() => dayRefreshInFlight.delete(date));
    dayRefreshInFlight.set(date, p);
    return p;
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
        nesineStatus: mk.getNesineStatus(),
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
            oddsFresh: m.oddsFresh,
            oddsUpdatedAt: m.oddsUpdatedAt,
            quality: an.quality,
            dataTrust: an.dataTrust || null,
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
        nesineStatus: mk.getNesineStatus(),
        totalMatches: bulletinMatches.length,
        preMatches: bulletinMatches.filter(x => x.state === 'pre').length,
        liveMatches: bulletinMatches.filter(x => x.state === 'live').length,
        banko: day.coupons.banko,
        surprise: day.coupons.surprise,
        performance: day.performance || null
    };
}

// Tek maç detay analizi
async function getMatchDetail(matchId, date = mk.trToday()) {
    const day = await getAnalyzedDay(date);
    const pool = day.couponItems || day.items;
    const item = pool.find(x => String(x.m.id) === String(matchId));
    if (!item) return null;

    if (!item.m.intel || !item.m.intel.realStats || !item.m.intel.standings) {
        const homePast = (day.model?.teams?.get(item.m.homeId)?.last || []).slice(0, 6);
        const awayPast = (day.model?.teams?.get(item.m.awayId)?.last || []).slice(0, 6);
        item.m.intel = await intel.enrichMatch(item.m, {
            fetchDeepSummary: true,
            fetchLineup: true,
            homePastMatches: homePast,
            awayPastMatches: awayPast
        });
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
        nesineStatus: mk.getNesineStatus(),
        analysis: {
            quality: an.quality,
            dataTrust: an.dataTrust || null,
            expectedGoals: {
                home: +an.lh.toFixed(2),
                away: +an.la.toFixed(2),
                total: +(an.lh + an.la).toFixed(2)
            },
            projections: an.projections || null,
            squad: an.squad || null,
            rosterSummary: an.rosterSummary || null,
            lineupSummary: an.lineupSummary || null,
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

// Tek bir maçın 10 katmanlı derin özet satırını oluşturur (forCoupon=true ise rationale ile çakışan tekrarları atlar)
function formatDeepMatchDetails(m, an, opts = {}) {
    const forCoupon = Boolean(opts.forCoupon);
    const parts = [];
    const hf = an.facts?.home;
    const af = an.facts?.away;
    const pr = an.projections;

    parts.push(`xG: ${an.lh.toFixed(2)}-${an.la.toFixed(2)} (ρ:${an.rho})`);

    if (pr) {
        const realCornerTxt = (pr.realCornersHFor !== null && pr.realCornersAFor !== null)
            ? `Gerçek Korner Ort(Son ${pr.cornerSampleH}/${pr.cornerSampleA}M): Ev ${pr.realCornersHFor} - Dep ${pr.realCornersAFor} (Beklenti:${pr.totalCorners})`
            : `Korner:${pr.totalCorners}`;
        const realShotTxt = (pr.realShotsHFor !== null && pr.realShotsAFor !== null)
            ? `Gerçek Şut/İsabet Ort: Ev ${pr.realShotsHFor}/${pr.realSotHFor} - Dep ${pr.realShotsAFor}/${pr.realSotAFor}`
            : `Şut/İsabet: ${pr.shotsH}/${pr.sotH} - ${pr.shotsA}/${pr.sotA}`;
        parts.push(`${realShotTxt} | ${realCornerTxt} | Kart: ${pr.totalCards}`);
        if (pr.motivation) parts.push(`Motivasyon: ${pr.motivation}`);
    }

    if (an.dataTrust) {
        parts.push(`Veri Güveni: %${an.dataTrust.overallScore} (Yeterlilik:%${an.dataTrust.sufficiencyScore}, Güncellik:%${an.dataTrust.freshnessScore})`);
    }

    if (hf && af) {
        if (!forCoupon) {
            const hHomeStr = hf.homeGf !== null ? `Evde ${hf.homeGf} atıp ${hf.homeGa} yiyor` : `Genel ${hf.gf} atıp ${hf.ga} yiyor`;
            const aAwayStr = af.awayGf !== null ? `Dep'te ${af.awayGf} atıp ${af.awayGa} yiyor` : `Genel ${af.gf} atıp ${af.ga} yiyor`;
            parts.push(`Ev/Dep & Son 10: ${m.home} (${hHomeStr}, Son5:${hf.formStr || '-'}, Son10:${hf.form10Str || '-'}, 2Y Gol Payı:%${hf.h2GoalSharePct || 55}) | ${m.away} (${aAwayStr}, Son5:${af.formStr || '-'}, Son10:${af.form10Str || '-'}, 2Y Gol Payı:%${af.h2GoalSharePct || 55})`);
        } else {
            parts.push(`Son 5/10 Form: ${m.home}(${hf.formStr || '-'} / 10M:${hf.last10Pts || 0}p) vs ${m.away}(${af.formStr || '-'} / 10M:${af.last10Pts || 0}p)`);
        }

        const scen = [];
        if (hf.leadHoldPct !== null) scen.push(`${m.home} İY öndeyken %${hf.leadHoldPct} koruyor`);
        if (af.comebackPct !== null) scen.push(`${m.away} İY gerideyken %${af.comebackPct} puan çıkarıyor`);
        if (scen.length) parts.push(`Direnç: ${scen.join(' | ')}`);
    }

    if (!forCoupon && an.tactical) {
        parts.push(`Taktik DNA: ${an.tactical.clashSummary}`);
    }

    if (!forCoupon && (an.restH?.restDays || an.restA?.restDays)) {
        parts.push(`Dinlenme/Yoğunluk: ${m.home} (${an.restH?.label || '-'}) | ${m.away} (${an.restA?.label || '-'})`);
    }

    if (!forCoupon && an.commonSummary) parts.push(`Ortak Rakipler: ${an.commonSummary}`);
    if (an.h2hSummary) parts.push(`H2H: ${an.h2hSummary}`);
    if (an.rosterSummary) parts.push(`Kadro/Eksik: ${an.rosterSummary}`);
    if (an.lineupSummary) parts.push(`${an.lineupSummary}`);

    if (an.intel) {
        if (!forCoupon && an.intel.weather) {
            const st = an.intel.stadium ? `${an.intel.stadium} (${an.intel.weather.city})` : an.intel.weather.city;
            parts.push(`Saha/Hava: ${st} ${an.intel.weather.temp}°C, ${an.intel.weather.condition}`);
        }
        if (an.intel.standings && (an.intel.standings.home || an.intel.standings.away)) {
            const sh = an.intel.standings.home;
            const sa = an.intel.standings.away;
            const sStr = [
                sh ? `${m.home}:${sh.rank ? sh.rank + '.' : ''}(${sh.points}p)` : null,
                sa ? `${m.away}:${sa.rank ? sa.rank + '.' : ''}(${sa.points}p)` : null
            ].filter(Boolean).join(' vs ');
            if (sStr) parts.push(`Tablo: ${sStr}`);
        }
        const leaders = [];
        if (an.intel.homeLeaders?.length) leaders.push(`${m.home}: ${an.intel.homeLeaders[0]}`);
        if (an.intel.awayLeaders?.length) leaders.push(`${m.away}: ${an.intel.awayLeaders[0]}`);
        if (leaders.length) parts.push(`Golcü: ${leaders.join(' | ')}`);
    }

    if (an.liveState) {
        const ls = an.liveState;
        parts.push(`CANLI (${ls.minute}', ${ls.currentScore}): Kalan xG ${ls.remLh}-${ls.remLa} | +0,5Ü:%${ls.remOver05} | Öneri:${ls.bestLivePick}`);
    }

    return parts.length ? '   • Ek Veriler: ' + parts.join(' | ') : '';
}

// AI Sohbeti için %100 bağımsız derin analiz, güncel İddaa bülteni ve kupon bağlamı
async function buildAiSportsContext(userMessage = '', opts = {}) {
    const isCompact = Boolean(opts.compact);
    const hasImage = Boolean(opts.hasImage);
    const today = mk.trToday();
    const day = await getAnalyzedDay(today);
    const qNorm = normTr(userMessage).trim();

    // Kullanıcı sadece kısa selamlaşma yazdıysa (ve fotoğraf eklemediyse) gereksiz token harcama
    const isPureGreeting = !hasImage && qNorm.length <= 22 && /^(merhaba|selam|slm|sa|as|naber|nasilsin|hey|hi|hello|knk|kanka|tesekkurler|eyvallah|iyi gunler|iyi aksamlar)[?!.\s]*$/.test(qNorm);
    if (isPureGreeting) {
        const bConfTxt = day.coupons.banko?.confidence ? `%${day.coupons.banko.confidence} tekil güven` : 'canlı hesaplama';
        const sLiftTxt = day.coupons.surprise?.avgLift ? `${day.coupons.surprise.avgLift}x çarpan` : 'canlı hesaplama';
        return `[YUSUF AI DURUMU]: Bugün resmi İddaa bülteninde ${day.matches.filter(x => x.inBulletin).length} maç analiz edildi. Günün Banko Kuponu (${bConfTxt}) ve Sürpriz Kuponu (${sLiftTxt}) hazır. Kullanıcıya kısa, samimi yanıt ver ve isterse Günün Banko Kuponunu, Sürpriz Kuponu, istediği bir maçın derin analizini çıkarabileceğini veya kupon/istatistik ekran görüntüsü atıp inceletebileceğini söyle.`;
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

    const asksOnlyBanko = qNorm.includes('banko') && !qNorm.includes('surpriz');
    const asksOnlySurp = qNorm.includes('surpriz') && !qNorm.includes('banko');

    // 1. Kuponlar özeti
    let bankoSummary = `Günün %100 Bağımsız Model Banko Kuponu (Tekil Ortalama Güven: ${day.coupons.banko?.confidence ? '%' + day.coupons.banko.confidence : 'Yok'} | 4 Maç Birlikte Gelme Kombine Olasılığı: ${day.coupons.banko?.jointConfidence ? '%' + day.coupons.banko.jointConfidence : 'Yok'}):\n`;
    if (day.coupons.banko && day.coupons.banko.matches.length) {
        day.coupons.banko.matches.forEach((b, i) => {
            const bOddStr = b.hasRealOdd && b.realOdd
                ? `, Gerçek Nesine Oranı: ${b.realOdd.toFixed(2)} (Güncelleme: ${b.oddsUpdatedAt || 'Canlı'}), EV: ${b.evPct >= 0 ? '+' : ''}%${b.evPct}${b.isValueBet ? ' [Value Bet]' : ''}`
                : `, Nesine Oranı: Bu pazar için gerçek oran bulunamadı (EV hesaplanamadı)`;
            bankoSummary += `${i + 1}. [${b.m.time}] ${b.m.home} - ${b.m.away} (${b.m.league.full}) | Tercih: ${b.label} (Model Olasılığı: %${Math.round(b.p * 100)}${bOddStr}, Risk: ${b.riskLevel || 'Düşük Risk'}, İstikrar: %${b.an.avgConsistency || 75})\n`;
            if (!asksOnlySurp) {
                bankoSummary += `   Gerekçe: ${b.rationale}\n`;
                if (!isCompact) {
                    const deepLine = formatDeepMatchDetails(b.m, b.an, { forCoupon: true });
                    if (deepLine) bankoSummary += `${deepLine}\n`;
                }
            }
        });
        bankoSummary += `Strateji: ${day.coupons.banko.instruction}\n`;
    } else {
        bankoSummary += 'Şu an yaklaşan uygun banko maç bulunamadı.\n';
    }

    let surpSummary = `Günün %100 Bağımsız Sürpriz Kuponu (Ortalama Sıklık Çarpanı: ${day.coupons.surprise?.avgLift ? day.coupons.surprise.avgLift + 'x' : 'Yok'} | 5 Maç Kombine Olasılığı: ${day.coupons.surprise?.jointConfidence ? '%' + day.coupons.surprise.jointConfidence : 'Yok'}):\n`;
    if (day.coupons.surprise && day.coupons.surprise.matches.length) {
        day.coupons.surprise.matches.forEach((s, i) => {
            const sOddStr = s.hasRealOdd && s.realOdd
                ? `, Gerçek Nesine Oranı: ${s.realOdd.toFixed(2)} (Güncelleme: ${s.oddsUpdatedAt || 'Canlı'}), Gerçek EV: ${s.evPct >= 0 ? '+' : ''}%${s.evPct}${s.isValueBet ? ' [Value Bet]' : ''}`
                : `, Nesine Oranı: Bu pazar için gerçek oran bulunamadı (Value Bet olarak etiketlenmez)`;
            surpSummary += `${i + 1}. [${s.m.time}] ${s.m.home} - ${s.m.away} (${s.m.league.full}) | Tercih: ${s.label} (Model Olasılığı: %${Math.round(s.p * 100)}${sOddStr}, Çarpan: ${s.lift ? s.lift.toFixed(1) + 'x' : '-'
}, Etiket: ${s.confidenceLevel})\n`;
            if (!asksOnlyBanko) {
                surpSummary += `   Gerekçe: ${s.rationale}\n`;
                if (!isCompact) {
                    const deepLine = formatDeepMatchDetails(s.m, s.an, { forCoupon: true });
                    if (deepLine) surpSummary += `${deepLine}\n`;
                }
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

    const poolLimit = isCompact ? 8 : 12;
    let upcomingPoolSummary = `\n[RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU - NESİNE & MAÇKOLİK ONAYLI (${preBulletin.length} aktif maçtan en kaliteli ${Math.min(poolLimit, preBulletin.length)} maç)]:\n`;
    preBulletin.slice(0, poolLimit).forEach(({ m, an }, i) => {
        const topSc = an.topScores && an.topScores[0] ? `${an.topScores[0].s}(%${Math.round(an.topScores[0].p * 100)})` : '1-1';
        const topHtSc = an.topHtScores && an.topHtScores[0] ? `${an.topHtScores[0].s}(%${Math.round(an.topHtScores[0].p * 100)})` : '0-0';
        const hf = an.facts?.home, af = an.facts?.away;
        const pr = an.projections;
        const splitMini = (hf && af && hf.homeGf !== null && af.awayGf !== null)
            ? ` | Ev:${hf.homeGf}/${hf.homeGa}(${hf.formStr || '-'}) Dep:${af.awayGf}/${af.awayGa}(${af.formStr || '-'})`
            : '';
        const projMini = pr ? ` | 🎯İsabetŞut:${pr.sotH}-${pr.sotA} 🚩Korner:${pr.totalCorners}(9.5Ü:%${Math.round((an.p.korner_ust95 || 0) * 100)}) 🟨Kart:${pr.totalCards}(3.5Ü:%${Math.round((an.p.kart_ust35 || 0) * 100)})` : '';
        const dnaMini = an.tactical ? ` | 🧬${an.tactical.homeTags[0]}/${an.tactical.awayTags[0]}` : '';
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
            { l: '4-6Gol', p: an.p.tg46 || 0 },
            { l: 'Korner9.5Ü', p: an.p.korner_ust95 || 0 },
            { l: 'Kart3.5Ü', p: an.p.kart_ust35 || 0 }
        ].sort((a, b) => b.p - a.p).slice(0, 4).map(x => `${x.l}:%${Math.round(x.p * 100)}`).join(' ');
        const surpMini = ` | Sürpriz:[${surpCands} İYSkor:${topHtSc} MSSkor:${topSc}]`;

        upcomingPoolSummary += `${i + 1}. [${m.time}] ${m.home}-${m.away} (${m.league.full}) | xG:${an.lh.toFixed(2)}-${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)}${projMini}${surpMini}${splitMini}${dnaMini}${wMini}${lMini}\n`;
    });

    // 2.5 Canlı Oynanan İddaa Maçları (Canlı Kalan Süre Motoru)
    const liveBulletin = day.items.filter(({ m, an }) => m.state === 'live' && m.inBulletin && an.liveState);
    let liveSummary = '';
    if (liveBulletin.length > 0 && (qNorm.includes('canli') || hasImage || !isCompact)) {
        liveSummary = `\n[CANLI OYNANAN İDDAA MAÇLARI - ANLIK KALAN SÜRE MOTORU (${liveBulletin.length} canlı maç)]:\n`;
        liveBulletin.slice(0, isCompact ? 5 : 10).forEach(({ m, an }, i) => {
            const ls = an.liveState;
            liveSummary += `${i + 1}. [CANLI ${ls.minute}' | Skor: ${ls.currentScore}] ${m.home} - ${m.away} (${m.league.full}) | Kalan xG:${ls.remLh}-${ls.remLa} | Kalan +0.5Ü:%${ls.remOver05} +1.5Ü:%${ls.remOver15} | Sıradaki Gol Ev:%${ls.nextGoalHome} Dep:%${ls.nextGoalAway} | Canlı MS1:%${ls.liveMs1} X:%${ls.liveMsX} MS2:%${ls.liveMs2} | Öneri: ${ls.bestLivePick}\n`;
        });
    }

    // 3. Kullanıcının bu mesajda veya aynı sohbetin önceki mesajlarında konuştuğu / görselden okunan spesifik takımlar ve maçlar
    let relevantMatches = '';
    const historyNorm = normTr(opts.historyText || '');
    const stopWords = new Set(['mac', 'maci', 'maclar', 'maclari', 'kupon', 'kuponu', 'analiz', 'bugun', 'bugunku', 'yarin', 'icin', 'nasil', 'olur', 'bana', 'yap', 'ver', 'ust', 'alt', 'gol', 'ilk', 'yari', 'ikinci', 'gunun', 'banko', 'surpriz', 'yuksek', 'oranli', 'deger', 'resmi', 'iddaa', 'nesine', 'bulteninden', 'oranlardan', 'bagimsiz', 'deplasman', 'karnesi', 'son', 'formu', 'ortak', 'rakipler', 'saha', 'hava', 'sartlari', 'kilit', 'oyuncularini', 'inceleyerek', 'guvendigin', 'maclik', 'tablolu', 'grafik', 'barli', 'olarak', 'cikar', 'hazirla', 'devre', 'karakteri', 'firsati', 'firsatlari', 'sistem', 'kombine', 'oynamaliyim', 'detayli', 'kesin', 'skor', 'handikap', 'resim', 'gorsel', 'fotograf', 'ekran', 'goruntusu', 'tutar', 'gelir', 'yatirir', 'kanka', 'sana', 'bisi', 'birsey', 'demistim', 'vardi', 'onlarla', 'yapar', 'misin', 'bahsettigim', 'soyledigim', 'onceki', 'sohbette']);
    const curWords = qNorm.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !stopWords.has(w));
    const histWords = historyNorm.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !stopWords.has(w));
    const allSearchWords = [...new Set([...curWords, ...histWords])];

    if (allSearchWords.length > 0) {
        const scoredMatches = [];
        for (const item of activePool) {
            const { m } = item;
            const target = normTr(`${m.home} ${m.away} ${m.league.full} ${m.league.country}`);
            let matchScore = 0;
            for (const w of curWords) {
                if (target.includes(w)) matchScore += 10;
            }
            for (const w of histWords) {
                if (target.includes(w)) matchScore += 3;
            }
            if (matchScore > 0) {
                scoredMatches.push({ item, matchScore });
            }
        }
        scoredMatches.sort((a, b) => b.matchScore - a.matchScore);

        if (scoredMatches.length > 0) {
            const maxMatched = isCompact ? 5 : 8;
            const topMatched = scoredMatches.slice(0, maxMatched).map(x => x.item);
            await Promise.race([
                runWithConcurrency(topMatched, 6, async (item) => {
                    if (!item.m.intel || !item.m.intel.standings || !item.m.intel.realStats) {
                        const tH = day.model.teams.get(item.m.home);
                        const tA = day.model.teams.get(item.m.away);
                        item.m.intel = await intel.enrichMatch(item.m, {
                            fetchDeepSummary: true,
                            fetchLineup: true,
                            homePastMatches: tH ? tH.last.slice(0, 10) : [],
                            awayPastMatches: tA ? tA.last.slice(0, 10) : []
                        });
                        item.an = engine.analyze(day.model, item.m, { facts: true, intel: item.m.intel });
                    }
                }),
                new Promise(r => setTimeout(r, 900))
            ]);

            relevantMatches = '\n[KULLANICININ BU SOHBETTE SORDUĞU / BAHSETTİĞİ VEYA GÖRSELDEN OKUNAN MAÇLAR İÇİN 10 KATMANLI DERİN İNCELEME SONUÇLARI]:\n';
            topMatched.forEach(({ m, an }) => {
                const bTag = m.inBulletin ? 'Resmi İddaa Bülteninde Var' : 'İddaa Dışı';
                relevantMatches += `- [${m.time}] ${m.home} - ${m.away} (${m.league.full} | ${bTag}) | Durum: ${m.state === 'live' ? 'CANLI ' + m.label + ' (' + (m.score ? m.score.h + '-' + m.score.a : '') + ')' : m.state === 'post' ? 'MS ' + (m.score ? m.score.h + '-' + m.score.a : '') : 'Başlamadı'}\n`;
                relevantMatches += `  Bağımsız xG (Dixon-Coles ρ:${an.rho}): Ev ${an.lh.toFixed(2)} - Dep ${an.la.toFixed(2)} | MS1:%${Math.round(an.p.ms1 * 100)} X:%${Math.round(an.p.msx * 100)} MS2:%${Math.round(an.p.ms2 * 100)} | 1.5Ü:%${Math.round(an.p.ust15 * 100)} 2.5Ü:%${Math.round(an.p.ust25 * 100)} KGV:%${Math.round(an.p.kgv * 100)} İY0.5Ü:%${Math.round(an.p.iyust05 * 100)}\n`;
                relevantMatches += `  Genişletilmiş 25+ Nesine Pazarları: Ev 1.5Ü:%${Math.round((an.p.ev_ust15 || 0) * 100)} | Dep 1.5Ü:%${Math.round((an.p.dep_ust15 || 0) * 100)} | 2-3 Gol:%${Math.round((an.p.tg23 || 0) * 100)} | 4-6 Gol:%${Math.round((an.p.tg46 || 0) * 100)} | Korner 9.5Ü:%${Math.round((an.p.korner_ust95 || 0) * 100)} | İY Korner 4.5Ü:%${Math.round((an.p.iy_korner_ust45 || 0) * 100)} | Kart 3.5Ü:%${Math.round((an.p.kart_ust35 || 0) * 100)} | Asya Hnd(-1.5):%${Math.round((an.p.ah_h_15 || 0) * 100)}\n`;
                relevantMatches += `  Yüksek Oranlı Özel Pazarlar: MS1&KG:%${Math.round((an.p.ms1_kgv || 0) * 100)} | MS2&KG:%${Math.round((an.p.ms2_kgv || 0) * 100)} | MS1&2.5Ü:%${Math.round((an.p.ms1_ust25 || 0) * 100)} | MS2&2.5Ü:%${Math.round((an.p.ms2_ust25 || 0) * 100)} | 2.5Ü&KG:%${Math.round((an.p.ust25_kgv || 0) * 100)} | İY KG Var:%${Math.round((an.p.iykgv || 0) * 100)} | 2.Yarı KG Var:%${Math.round((an.p.y2kgv || 0) * 100)} | İY 1.5 Üst:%${Math.round((an.p.iyust15 || 0) * 100)}\n`;
                if (an.topScores && an.topScores.length) {
                    relevantMatches += `  Olası MS Skorlar: ${an.topScores.slice(0, 3).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')} | Olası İY Skorlar: ${(an.topHtScores || []).slice(0, 2).map(s => s.s + ' (%' + Math.round(s.p * 100) + ')').join(', ')}\n`;
                }
                const deepLine = formatDeepMatchDetails(m, an);
                if (deepLine) relevantMatches += `${deepLine}\n`;
            });
        }
    }

    const totalBulletinCount = day.matches.filter(x => x.inBulletin).length;
    const perf = day.performance;
    const perfLine = perf
        ? `[MODEL KALİBRASYON & GERÇEK SONUÇ DOĞRULAMA METRİKLERİ]: Brier Score: ${perf.brierScore} | Log Loss: ${perf.logLoss} | Doğrulanan Maç: ${perf.evaluatedMatches} | Genel İsabet Oranı: %${perf.hitRatePct} (${perf.bankoHits}/${perf.bankoTotal})`
        : '';
    const nesineSt = day.nesineStatus || mackolik.getNesineStatus();
    const nesineLine = nesineSt && nesineSt.isFresh && nesineSt.updatedAt
        ? `[NESİNE CANLI ORAN DURUMU]: Güncel (${new Date(nesineSt.updatedAt).toLocaleTimeString('tr-TR')}, ${nesineSt.ageSeconds || 0} sn önce yenilendi)`
        : `[NESİNE CANLI ORAN DURUMU]: Oran yenilenemediği için eski oranlar kullanılmadı.`;

    return `
[YUSUF AI 2.0 - %100 BAĞIMSIZ 10 KATMANLI DERİN FUTBOL ANALİZ VE 25+ PAZAR MOTORU - ${today}]
Bugün Resmi İddaa Bülteninde (Nesine / Maçkolik) Yer Alan Maç Sayısı: ${totalBulletinCount}
${nesineLine}
${perfLine}
NOT: Aşağıdaki tüm xG, xGA, gerçek şut/isabetli şut ortalaması, gerçek korner ortalaması, kart, sakat/cezalı/ilk 11 kadroları ve olasılık yüzdeleri her takımın kendi son 5 ve son 10 maçındaki gerçek istatistiklerinden ve 10 katmanlı modelden hesaplanmıştır. Oran yenilenemediğinde eski oran asla kullanılmaz.

${bankoSummary}
${surpSummary}
${upcomingPoolSummary}
${liveSummary}
${relevantMatches}
ÖNEMLİ KURALLAR (MOBİL ÖNCELİKLİ, KISA, ÖZ, GRAFİKLİ VE KENDİ DERİN ANALİZİNİ YANSITAN FORMAT):
1. KULLANICI TELEFONDAN TAKİP ETMEKTEDİR: Açıklamaları kesinlikle UZUN TUTMA. Uzun paragraf yazmak Yasaktır; ancak her maçın tek satırlık gerekçesinde kendi incelediğin SOMUT VERİLERİ (ev/dep gol ortalaması, son 10 maç, isabetli şut, korner/kart beklentisi, ortak rakipler, H2H, taktik DNA, dinlenme günü, hava durumu, form veya gol kralı) net biçimde belirt.
2. ÇIKTI FORMATI STANDARDI (BUNA KESİNLİKLE UYULACAK):
   a) Başlık: Kupon Adı, Tekil Ortalama Güven ve Kombine Birlikte Gelme Olasılığı (örn: 🎯 **Günün Bağımsız Banko Kuponu** • *Tekil Ort: %86 | 4 Maç Kombine Olasılığı: %55* veya 🚀 **Günün Yüksek Değerli Sürpriz Kuponu** • *3-4-5 Sistem*)
   b) Kompakt Grafik Tablo:
      | # | Saat | Maç | Tercih | Güven / Değer İbresi |
      (Güven İbresi sütununda ASLA köşeli parantezli [████░░] metin barı kullanma; arayüz otomatik grafik bar çizeceği için sadece %88 veya Sürpriz kuponda %28 • 2.4x Değer yaz!)
   c) Derin Analiz Gerekçeleri (Maç başına 1-2 satırlık somut veri özeti):
      - **Ev - Deplasman:** 📊 xG: 2.14 - 0.88 • 🎯 İsabetli Şut: 5.8 - 2.9 • 🚩 Korner: 10.2 • Ev sahibi iç sahada maç başı 2.2 gol atıyor, 🧬 Taktik DNA: ⚡ Erken Baskıcı, 3 ortak rakipte +1.4 averaj üstünlüğü var.
   d) Tek Cümlelik Oynanış Notu.
3. GÖRSEL / FOTOĞRAF ANALİZİ VE KUPON RÖNTGENİ KURALI (KULLANICI RESİM ATTIĞINDA):
   - Kullanıcı bir **Kupon Ekran Görüntüsü / İddaa Kuponu Fotoğrafı** attıysa: Resimdeki her maçı ve oynanan tercihi oku, yukarıdaki bağımsız 10 katmanlı motor verilerimizle karşılaştır ve şu tabloyu çıkar:
     | # | Maç | Kupondaki Tercih | Modelin Yüzdesi | Risk Durumu | Modelin En Sağlam Alternatifi |
     (Risk Durumu sütununda: 🟩 **Sağlam**, 🟨 **Sınırda / Orta Risk**, 🟥 **Tuzak / Yatırır** etiketlerini kullan ve altında kuponun en zayıf halkasını + kombine tutma ihtimalini 1-2 satırla açıkla).
   - Kullanıcı bir **Canlı Maç İstatistik Ekranı** attıysa: Görseldeki şut, isabetli şut, korner, tehlikeli atak, topla oynama ve xG verilerini oku; kendi Canlı Motor verimizle birleştirip en net canlı tercihi ('Sıradaki Gol', 'Kalan Sürede +0,5 Üst', 'Canlı KG Var' vb.) söyle.
   - Kullanıcı **Bülten / Kadro / Farklı Bir Görsel** attıysa: Görseldeki tüm detayları eksiksiz oku ve sorusuna göre doğrudan yanıtla.
4. 25+ NESİNE PAZAR ÇEŞİTLİLİĞİ KURALI: Kupon veya tek maç analizi hazırlarken Nesine'deki tüm pazarları kullanabilirsin: **MS 1X2**, **Çifte Şans**, **İY Sonucu**, **İY/MS**, **Toplam Gol Alt/Üst (1.5, 2.5, 3.5)**, **Ev/Dep Takım Gol Üst (0.5, 1.5)**, **KG Var/Yok**, **İY/2Y Gol Üst**, **İY/2Y KG Var**, **Avrupa & Asya Handikap (-1, -1.5)**, **Korner Alt/Üst (8.5, 9.5, 10.5 & İY 4.5)**, **Kart Alt/Üst (3.5, 4.5)**, **Toplam Gol Aralığı (0-1, 2-3, 4-6)** ve **Kesin Skor**.
5. GERÇEK ORAN PRENSİBİ: Bültende gerçek oranı bulunmayan pazarlar için ASLA uydurma oran tahmin etme; model olasılığı (%), değer katı (x) ve varsa gerçek EV değerini belirt.
6. KESİN KURAL (HALÜSİNASYON YASAĞI): Genel kupon oluştururken yukarıdaki [RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU] listesindeki maçları kullan; ancak kullanıcı kendi mesajında veya sohbetin önceki mesajlarında belirli maçları söylediyse doğrudan kullanıcının o maçlarını baz al!
7. AKTİF SOHBET HAFIZASI KURALI (ÇOK KRİTİK): Bu sohbetteki TÜM önceki mesajları (kullanıcının daha önce söylediği maçları, kuponları, attığı görselleri ve senin önceki cevaplarını) eksiksiz hatırla! Kullanıcı "sana bir şey demiştim", "şu maçlar vardı demiştim onlarla sürpriz yapar mısın", "az önceki maçlardan hangisi sağlam" gibi geçmişe atıf yaptığında, önceki mesajlarda bahsettiği maçları adını vererek ("Az önce bahsettiğin X, Y, Z maçlarını baz alarak...") doğrudan analiz et ve istediğini yap!
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
