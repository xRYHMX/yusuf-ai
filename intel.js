// Canlı Dış İstihbarat Katmanı (ESPN + Open-Meteo Hava Durumu + Maçkolik Kadro/Detay)
// Takım liderleri, puan durumu, çok sezonlu H2H, stadyum ve maç saati hava durumunu toplar.

const normName = (s) => String(s || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/\bcologne\b/g, 'koln')
    .replace(/\bmunich\b/g, 'munchen')
    .replace(/\bnuremberg\b/g, 'nurnberg')
    .replace(/\bflorence\b/g, 'fiorentina')
    .replace(/\bnaples\b/g, 'napoli')
    .replace(/\bcopenhagen\b/g, 'kopenhag')
    .replace(/\bvienna\b/g, 'wien')
    .replace(/\bprague\b/g, 'praha')
    .replace(/\bmoscow\b/g, 'moskva')
    .replace(/\b(fc|fk|sk|sc|ac|as|cf|cd|ud|sd|rc|rcd|sv|tsv|vfb|vfl|bsc|fsv|1\.|jk|if|bk|ik|nk|hsk|kvc|kv|rsc|kaa|krc|st|saint|real|club|deportivo|sporting|atletico|borussia|olympique|dinamo|dynamo|lokomotiv|spartak|cska|zenit|bodo|glimt|united|city|town|rovers|wanderers|county|athletic|albion)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// İki takım isminin benzerlik kontrolü
function teamsMatch(mkName, espnName) {
    const a = normName(mkName);
    const b = normName(espnName);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const wa = a.split(' ').filter(w => w.length >= 3);
    const wb = b.split(' ').filter(w => w.length >= 3);
    return wa.some(w => wb.includes(w));
}

// Ülke -> Başkent / Merkez koordinat yedek tablosu (Stadyum şehri bulunamazsa)
const COUNTRY_COORDS = {
    'Türkiye': { lat: 41.01, lon: 28.97, city: 'İstanbul' },
    'Almanya': { lat: 50.11, lon: 8.68, city: 'Frankfurt' },
    'İngiltere': { lat: 51.50, lon: -0.12, city: 'Londra' },
    'İspanya': { lat: 40.41, lon: -3.70, city: 'Madrid' },
    'İtalya': { lat: 45.46, lon: 9.19, city: 'Milano' },
    'Fransa': { lat: 48.85, lon: 2.35, city: 'Paris' },
    'Hollanda': { lat: 52.36, lon: 4.90, city: 'Amsterdam' },
    'Belçika': { lat: 50.85, lon: 4.35, city: 'Brüksel' },
    'Portekiz': { lat: 38.72, lon: -9.13, city: 'Lizbon' },
    'Avusturya': { lat: 48.20, lon: 16.37, city: 'Viyana' },
    'İskoçya': { lat: 55.86, lon: -4.25, city: 'Glasgow' },
    'İrlanda': { lat: 53.34, lon: -6.26, city: 'Dublin' },
    'İsveç': { lat: 59.32, lon: 18.06, city: 'Stockholm' },
    'Norveç': { lat: 59.91, lon: 10.75, city: 'Oslo' },
    'Danimarka': { lat: 55.67, lon: 12.56, city: 'Kopenhag' },
    'Polonya': { lat: 52.22, lon: 21.01, city: 'Varşova' },
    'Romanya': { lat: 44.42, lon: 26.10, city: 'Bükreş' },
    'Hırvatistan': { lat: 45.81, lon: 15.98, city: 'Zagreb' },
    'Çek Cumhuriyeti': { lat: 50.07, lon: 14.43, city: 'Prag' }
};

const geoCache = new Map();
const weatherCache = new Map();
const espnDayCache = new Map();
const espnSummaryCache = new Map();
const mkLineupCache = new Map();

async function fetchJsonWithTimeout(url, headers = {}, timeoutMs = 3500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// 1. Şehir koordinatı ve maç saati hava durumu (Open-Meteo)
async function getWeatherForMatch(city, country, kickoffIso) {
    const cacheKey = `${city || country}|${String(kickoffIso).slice(0, 13)}`;
    if (weatherCache.has(cacheKey)) return weatherCache.get(cacheKey);

    try {
        let coords = null;
        if (city) {
            if (geoCache.has(city)) {
                coords = geoCache.get(city);
            } else {
                const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`;
                const gj = await fetchJsonWithTimeout(geoUrl, {}, 2500);
                if (gj && gj.results && gj.results[0]) {
                    coords = { lat: gj.results[0].latitude, lon: gj.results[0].longitude, city: gj.results[0].name };
                    geoCache.set(city, coords);
                }
            }
        }
        if (!coords && country && COUNTRY_COORDS[country]) {
            coords = COUNTRY_COORDS[country];
        }
        if (!coords) return null;

        const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m&forecast_days=2&timezone=Europe%2FIstanbul`;
        const wj = await fetchJsonWithTimeout(wUrl, {}, 2500);
        if (!wj || !wj.hourly || !Array.isArray(wj.hourly.time)) return null;

        const targetHour = String(kickoffIso).slice(0, 13); // "2026-10-16T21"
        let idx = wj.hourly.time.findIndex(t => t.startsWith(targetHour));
        if (idx < 0) idx = 18;

        const temp = Math.round(wj.hourly.temperature_2m[idx] ?? 15);
        const rainProb = Math.round(wj.hourly.precipitation_probability[idx] ?? 0);
        const rainMm = +(wj.hourly.precipitation[idx] ?? 0).toFixed(1);
        const wind = Math.round(wj.hourly.windspeed_10m[idx] ?? 8);

        let condition = 'İdeal Futbol Havası';
        let xgMod = 1.0; // Hava şartlarının gol beklentisine etkisi
        if (rainProb >= 70 || rainMm >= 2.0) {
            condition = 'Yağışlı / Ağır Zemin';
            xgMod -= 0.06;
        } else if (rainProb >= 45) {
            condition = 'Parçalı Bulutlu / Hafif Yağış İhtimali';
            xgMod -= 0.02;
        }
        if (wind >= 32) {
            condition = 'Sert Rüzgarlı (Uzun Top / Duran Top Etkisi)';
            xgMod -= 0.05;
        } else if (temp <= 2) {
            condition = 'Soğuk Hava / Sert Zemin';
            xgMod -= 0.03;
        } else if (temp >= 12 && temp <= 23 && rainProb < 25 && wind < 20) {
            xgMod += 0.02;
        }

        const out = {
            city: coords.city,
            temp,
            rainProb,
            rainMm,
            wind,
            condition,
            xgMod: +xgMod.toFixed(3),
            summary: `${coords.city}: ${temp}°C, Yağış %${rainProb}, Rüzgar ${wind} km/s (${condition})`
        };
        weatherCache.set(cacheKey, out);
        return out;
    } catch (_) {
        return null;
    }
}

// 2. ESPN Günlük Bülten (Stadyum, Form, Gol/Asist Liderleri)
async function getEspnDayEvents(isoDate) {
    const hit = espnDayCache.get(isoDate);
    if (hit && Date.now() - hit.t < 10 * 60e3) return hit.events;

    const ymd = isoDate.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${ymd}&limit=300`;
    const j = await fetchJsonWithTimeout(url, {}, 4000);
    const events = (j && Array.isArray(j.events)) ? j.events : [];
    espnDayCache.set(isoDate, { t: Date.now(), events });
    return events;
}

// 3. ESPN Maç Özeti (Puan Durumu, Çok Sezonlu H2H, Kadro/Sakatlık)
async function getEspnEventSummary(eventId) {
    if (!eventId) return null;
    const hit = espnSummaryCache.get(eventId);
    if (hit && Date.now() - hit.t < 15 * 60e3) return hit.data;

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${eventId}`;
    const s = await fetchJsonWithTimeout(url, {}, 3500);
    if (!s) return null;

    // H2H (Geçmiş sezonlar dahil aralarındaki maçlar)
    const h2hGames = [];
    if (Array.isArray(s.seasonseries)) {
        for (const ser of s.seasonseries) {
            if (Array.isArray(ser.events)) {
                for (const ev of ser.events.slice(0, 5)) {
                    const comps = ev.competitors || [];
                    if (comps.length === 2) {
                        const h = comps.find(c => c.homeAway === 'home') || comps[0];
                        const a = comps.find(c => c.homeAway === 'away') || comps[1];
                        if (h.score !== undefined && a.score !== undefined) {
                            h2hGames.push({
                                date: String(ev.date || '').slice(0, 10),
                                home: h.team ? h.team.displayName : '',
                                away: a.team ? a.team.displayName : '',
                                gh: parseInt(h.score, 10) || 0,
                                ga: parseInt(a.score, 10) || 0
                            });
                        }
                    }
                }
            }
        }
    }

    // Puan durumu
    const standingsMap = {};
    try {
        const entries = s.standings?.groups?.[0]?.standings?.entries || [];
        for (const ent of entries) {
            const tName = ent.team || '';
            const stObj = {};
            for (const st of (ent.stats || [])) {
                stObj[st.name] = st.displayValue ?? st.value;
            }
            standingsMap[tName] = {
                rank: parseInt(stObj.rank, 10) || null,
                points: parseInt(stObj.points, 10) || 0,
                gp: parseInt(stObj.gamesPlayed, 10) || 0,
                w: parseInt(stObj.wins, 10) || 0,
                d: parseInt(stObj.ties, 10) || 0,
                l: parseInt(stObj.losses, 10) || 0,
                gd: stObj.pointDifferential || '0'
            };
        }
    } catch (_) {}

    // Hakem ve Sakat/Cezalı Oyuncular
    let referee = null;
    try {
        if (s.gameInfo?.officials?.length) {
            referee = s.gameInfo.officials[0].displayName || s.gameInfo.officials[0].fullName || null;
        }
    } catch (_) {}

    const injuriesMap = {};
    try {
        if (Array.isArray(s.injuries)) {
            for (const teamInj of s.injuries) {
                const tName = teamInj.team?.displayName || '';
                const list = (teamInj.injuries || []).map(x => {
                    const pName = x.athlete?.displayName || '';
                    const reason = x.type?.description || x.details?.type || 'Eksik';
                    return pName ? `${pName} (${reason})` : null;
                }).filter(Boolean);
                if (tName && list.length) injuriesMap[tName] = list;
            }
        }
    } catch (_) {}

    const data = { h2hGames, standingsMap, referee, injuriesMap };
    espnSummaryCache.set(eventId, { t: Date.now(), data });
    return data;
}

// 4. Maçkolik Kadro ve Maç Önü Detayı (Açıklandığında İlk 11'ler)
async function getMackolikLineup(matchId) {
    const hit = mkLineupCache.get(matchId);
    if (hit && Date.now() - hit.t < 10 * 60e3) return hit.data;

    const url = `https://arsiv.mackolik.com/Match/MatchData.aspx?t=dtl&id=${matchId}&s=0`;
    const j = await fetchJsonWithTimeout(url, { 'Referer': 'https://arsiv.mackolik.com/' }, 2500);
    if (!j) return null;

    const homeXi = Array.isArray(j.h) ? j.h.slice(0, 11).map(p => p[1] || p[0]).filter(Boolean) : [];
    const awayXi = Array.isArray(j.a) ? j.a.slice(0, 11).map(p => p[1] || p[0]).filter(Boolean) : [];
    const data = {
        hasLineup: homeXi.length > 0 && awayXi.length > 0,
        homeXi,
        awayXi
    };
    mkLineupCache.set(matchId, { t: Date.now(), data });
    return data;
}

function extractTeamLeaders(comp) {
    if (!comp || !Array.isArray(comp.leaders)) return { list: [], topGoals: 0, topScorerName: null };
    const out = [];
    const seen = new Set();
    let topGoals = 0;
    let topScorerName = null;
    for (const lGroup of comp.leaders) {
        const top = lGroup.leaders && lGroup.leaders[0];
        if (top && top.athlete && top.athlete.displayName) {
            const key = top.athlete.displayName;
            if (seen.has(key)) continue;
            seen.add(key);
            const isAssist = lGroup.name.toLowerCase().includes('assist');
            const statLabel = isAssist ? 'Asist' : 'Gol';
            const val = Number(top.value) || 0;
            if (val > 0) {
                out.push(`${top.athlete.displayName} (${val} ${statLabel})`);
                if (!isAssist && val > topGoals) {
                    topGoals = val;
                    topScorerName = top.athlete.displayName;
                }
            }
        }
    }
    return { list: out, topGoals, topScorerName };
}

// Ana Zenginleştirme Fonksiyonu: Bir maç için tüm dış istihbaratı birleştirir
async function enrichMatch(m, { fetchDeepSummary = false, fetchLineup = false } = {}) {
    const events = await getEspnDayEvents(m.date);
    let matchedEv = null;
    let homeComp = null, awayComp = null;

    for (const ev of events) {
        const comp = ev.competitions && ev.competitions[0];
        if (!comp || !Array.isArray(comp.competitors)) continue;
        const cHome = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
        const cAway = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];
        if (
            teamsMatch(m.home, cHome?.team?.displayName) &&
            teamsMatch(m.away, cAway?.team?.displayName)
        ) {
            matchedEv = ev;
            homeComp = cHome;
            awayComp = cAway;
            break;
        }
    }

    let stadium = null, city = null, referee = null;
    let homeLeaders = [], awayLeaders = [];
    let homeTopGoals = 0, awayTopGoals = 0;
    let homeTopScorer = null, awayTopScorer = null;
    let homeInjuries = [], awayInjuries = [];
    let homeRecord = null, awayRecord = null;
    let standings = null, espnH2H = [];

    if (matchedEv) {
        const comp = matchedEv.competitions[0];
        if (comp.venue) {
            stadium = comp.venue.fullName || null;
            city = comp.venue.address?.city || null;
        }
        const hLead = extractTeamLeaders(homeComp);
        const aLead = extractTeamLeaders(awayComp);
        homeLeaders = hLead.list;
        awayLeaders = aLead.list;
        homeTopGoals = hLead.topGoals;
        awayTopGoals = aLead.topGoals;
        homeTopScorer = hLead.topScorerName;
        awayTopScorer = aLead.topScorerName;

        homeRecord = homeComp?.records?.[0]?.summary || null;
        awayRecord = awayComp?.records?.[0]?.summary || null;

        if (fetchDeepSummary) {
            const sum = await getEspnEventSummary(matchedEv.id);
            if (sum) {
                espnH2H = sum.h2hGames || [];
                referee = sum.referee || null;
                const stEntries = Object.entries(sum.standingsMap || {});
                let hSt = null, aSt = null;
                for (const [tName, stVal] of stEntries) {
                    if (teamsMatch(m.home, tName)) hSt = stVal;
                    if (teamsMatch(m.away, tName)) aSt = stVal;
                }
                if (hSt || aSt) standings = { home: hSt, away: aSt };

                for (const [tName, injList] of Object.entries(sum.injuriesMap || {})) {
                    if (teamsMatch(m.home, tName)) homeInjuries = injList;
                    if (teamsMatch(m.away, tName)) awayInjuries = injList;
                }
            }
        }
    }

    // Hava durumu (stadyum şehri veya ülke merkezi) ve varsa açıklanan ilk 11
    const [weather, lineup] = await Promise.all([
        getWeatherForMatch(city, m.league?.country, m.kickoff),
        fetchLineup ? getMackolikLineup(m.id) : Promise.resolve(null)
    ]);

    return {
        stadium,
        city: city || weather?.city || null,
        referee,
        weather,
        homeLeaders,
        awayLeaders,
        homeTopGoals,
        awayTopGoals,
        homeTopScorer,
        awayTopScorer,
        homeInjuries,
        awayInjuries,
        homeRecord,
        awayRecord,
        standings,
        espnH2H,
        lineup
    };
}

module.exports = {
    enrichMatch,
    getWeatherForMatch,
    getEspnDayEvents,
    getMackolikLineup,
    teamsMatch
};
