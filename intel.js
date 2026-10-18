// Canlı Dış İstihbarat & Gerçek Maç İstatistikleri Katmanı
// (Maçkolik Arşiv İstatistik/Kadro + ESPN Boxscore/Last5Games + Open-Meteo Hava Durumu)
// Gerçek son 5/10 maç korner ortalamaları, gerçek şut/isabetli şut ortalamaları,
// cezalı/sakat/eksik oyuncular ve muhtemel/resmi ilk 11 verilerini toplar.

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.cache');
const REAL_STATS_FILE = path.join(CACHE_DIR, 'real_match_stats.json');

let realStatsDiskCache = {};
try {
    if (fs.existsSync(REAL_STATS_FILE)) {
        realStatsDiskCache = JSON.parse(fs.readFileSync(REAL_STATS_FILE, 'utf8')) || {};
    }
} catch (_) {
    realStatsDiskCache = {};
}

let diskSaveTimer = null;
function scheduleSaveRealStats() {
    if (diskSaveTimer) return;
    diskSaveTimer = setTimeout(() => {
        diskSaveTimer = null;
        try {
            if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(REAL_STATS_FILE, JSON.stringify(realStatsDiskCache), 'utf8');
        } catch (_) {}
    }, 2500);
}

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://arsiv.mackolik.com/'
};

const normName = (s) => String(s || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ä/g, 'a')
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
    .replace(/\b(fc|fk|sk|sc|ac|as|cf|cd|ud|sd|rc|rcd|sv|tsv|vfb|vfl|bsc|fsv|1\.|jk|if|bk|ik|nk|hsk|kvc|kv|rsc|kaa|krc|afc)\b/g, ' ')
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
    if (wa.length > 0 && wb.length > 0 && wa[0] === wb[0]) {
        // Manchester United vs Manchester City gibi çakışmaları önle
        if ((a.includes('united') && b.includes('city')) || (a.includes('city') && b.includes('united'))) return false;
        if ((a.includes('real') && b.includes('atletico')) || (a.includes('atletico') && b.includes('real'))) return false;
        return true;
    }
    return wa.some(w => w.length >= 4 && !['united', 'city', 'real', 'club', 'sporting', 'atletico', 'borussia', 'dinamo', 'dynamo'].includes(w) && wb.includes(w));
}

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
        const res = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextWithTimeout(url, headers = {}, timeoutMs = 3500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.text();
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

        const targetHour = String(kickoffIso).slice(0, 13);
        let idx = wj.hourly.time.findIndex(t => t.startsWith(targetHour));
        if (idx < 0) idx = 18;

        const temp = Math.round(wj.hourly.temperature_2m[idx] ?? 15);
        const rainProb = Math.round(wj.hourly.precipitation_probability[idx] ?? 0);
        const rainMm = +(wj.hourly.precipitation[idx] ?? 0).toFixed(1);
        const wind = Math.round(wj.hourly.windspeed_10m[idx] ?? 8);

        let condition = 'İdeal Futbol Havası';
        let xgMod = 1.0;
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

// 2. Maçkolik tamamlanmış maç arşivinden gerçek korner, şut, isabetli şut, kart ve ilk 11 çekimi
async function getMackolikArchivedMatchData(matchId) {
    if (!matchId) return null;
    const key = `mk_${matchId}`;
    if (realStatsDiskCache[key]) return realStatsDiskCache[key];

    const [html, dtl] = await Promise.all([
        fetchTextWithTimeout(`https://arsiv.mackolik.com/Match/Default.aspx?id=${matchId}`, {}, 3200),
        fetchJsonWithTimeout(`https://arsiv.mackolik.com/Match/MatchData.aspx?t=dtl&id=${matchId}&s=0`, {}, 2800)
    ]);

    const statsMap = {};
    if (html) {
        const re = /team-1-statistics-text[^>]*>\s*([^<]+?)\s*<\/div>\s*<div[^>]*statistics-title-text[^>]*>\s*([^<]+?)\s*<\/div>\s*<div[^>]*team-2-statistics-text[^>]*>\s*([^<]+?)\s*<\/div>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            statsMap[m[2].trim()] = [m[1].trim(), m[3].trim()];
        }
    }

    const parseNum = (v) => {
        if (v === undefined || v === null) return null;
        const clean = String(v).replace('%', '').trim();
        const n = parseFloat(clean);
        return isFinite(n) ? n : null;
    };

    const corners = statsMap['Korner'] ? [parseNum(statsMap['Korner'][0]), parseNum(statsMap['Korner'][1])] : null;
    const shots = statsMap['Toplam Şut'] ? [parseNum(statsMap['Toplam Şut'][0]), parseNum(statsMap['Toplam Şut'][1])] : null;
    const sot = statsMap['İsabetli Şut'] ? [parseNum(statsMap['İsabetli Şut'][0]), parseNum(statsMap['İsabetli Şut'][1])] : null;
    const poss = statsMap['Topla Oynama'] ? [parseNum(statsMap['Topla Oynama'][0]), parseNum(statsMap['Topla Oynama'][1])] : null;

    const homeXI = Array.isArray(dtl?.h) ? dtl.h.slice(0, 11).map(p => p[1]).filter(Boolean) : [];
    const awayXI = Array.isArray(dtl?.a) ? dtl.a.slice(0, 11).map(p => p[1]).filter(Boolean) : [];
    const homeSquad = Array.isArray(dtl?.h) ? dtl.h.map(p => p[1]).filter(Boolean) : [];
    const awaySquad = Array.isArray(dtl?.a) ? dtl.a.map(p => p[1]).filter(Boolean) : [];

    const events = Array.isArray(dtl?.e) ? dtl.e : [];
    const ycH = events.filter(e => e[0] === 1 && e[4] === 2).length;
    const ycA = events.filter(e => e[0] === 2 && e[4] === 2).length;
    const rcHPlayers = events.filter(e => e[0] === 1 && e[4] === 3).map(e => e[3]).filter(Boolean);
    const rcAPlayers = events.filter(e => e[0] === 2 && e[4] === 3).map(e => e[3]).filter(Boolean);
    const goalsHPlayers = events.filter(e => e[0] === 1 && e[4] === 1).map(e => e[3]).filter(Boolean);
    const goalsAPlayers = events.filter(e => e[0] === 2 && e[4] === 1).map(e => e[3]).filter(Boolean);

    const hasAnyData = Boolean(corners || shots || homeXI.length > 0 || awayXI.length > 0);
    if (!hasAnyData) return null;

    const record = {
        id: matchId,
        corners,
        shots,
        sot,
        poss,
        yc: [ycH, ycA],
        rcPlayers: [rcHPlayers, rcAPlayers],
        goalPlayers: [goalsHPlayers, goalsAPlayers],
        homeXI,
        awayXI,
        homeSquad,
        awaySquad
    };

    realStatsDiskCache[key] = record;
    scheduleSaveRealStats();
    return record;
}

// 3. ESPN tamamlanmış maç özetinden gerçek korner, şut, isabetli şut, kart ve ilk 11 çekimi
async function getEspnArchivedMatchData(eventId) {
    if (!eventId) return null;
    const key = `espn_${eventId}`;
    if (realStatsDiskCache[key]) return realStatsDiskCache[key];

    const s = await fetchJsonWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${eventId}`, {}, 3200);
    if (!s || !s.boxscore || !Array.isArray(s.boxscore.teams)) return null;

    const teamsData = {};
    for (const tb of s.boxscore.teams) {
        const tId = String(tb.team?.id || '');
        const tName = tb.team?.displayName || '';
        const stObj = {};
        for (const st of (tb.statistics || [])) {
            stObj[st.name] = parseFloat(st.displayValue ?? st.value);
        }
        teamsData[tId] = {
            teamId: tId,
            teamName: tName,
            corners: isFinite(stObj.wonCorners) ? stObj.wonCorners : null,
            shots: isFinite(stObj.totalShots) ? stObj.totalShots : null,
            sot: isFinite(stObj.shotsOnTarget) ? stObj.shotsOnTarget : null,
            poss: isFinite(stObj.possessionPct) ? stObj.possessionPct : null,
            yc: isFinite(stObj.yellowCards) ? stObj.yellowCards : 0,
            rc: isFinite(stObj.redCards) ? stObj.redCards : 0
        };
    }

    const rostersData = {};
    if (Array.isArray(s.rosters)) {
        for (const r of s.rosters) {
            const tId = String(r.team?.id || '');
            const formation = r.formation || null;
            const starters = [];
            const fullSquad = [];
            const rcPlayers = [];
            const goalPlayers = [];
            for (const p of (r.roster || [])) {
                const name = p.athlete?.displayName;
                if (!name) continue;
                fullSquad.push(name);
                if (p.starter) starters.push(name);
                for (const st of (p.stats || [])) {
                    if (st.name === 'redCards' && Number(st.value) > 0) rcPlayers.push(name);
                    if (st.name === 'totalGoals' && Number(st.value) > 0) goalPlayers.push(name);
                }
            }
            rostersData[tId] = { formation, starters, fullSquad, rcPlayers, goalPlayers };
        }
    }

    const record = { eventId, teamsData, rostersData };
    realStatsDiskCache[key] = record;
    scheduleSaveRealStats();
    return record;
}

// 4. Bir takımın son 5/10 gerçek maçından Korner, Şut, İsabetli Şut ortalamalarını + Muhtemel 11 & Eksik/Cezalı oyuncuları hesaplar
async function buildTeamRealProfile(teamName, teamId, pastMkMatches = [], espnTeamBlock = null, espnInjuries = [], officialTodayXi = []) {
    const cornerForList = [];
    const cornerAgainstList = [];
    const shotForList = [];
    const shotAgainstList = [];
    const sotForList = [];
    const sotAgainstList = [];
    const possList = [];
    const cardsList = [];

    const recentXIs = []; // En yeniden en eskiye ilk 11'ler
    const recentSquads = [];
    let lastMatchRedCards = [];
    const goalScorerCounts = new Map();
    let formation = null;

    // A) Önce varsa ESPN lastFiveGames (Son 5 maç gerçek boxscore + kadro)
    if (espnTeamBlock && Array.isArray(espnTeamBlock.events) && espnTeamBlock.events.length > 0) {
        const espnTeamId = String(espnTeamBlock.team?.id || '');
        const pastEvents = espnTeamBlock.events.slice(0, 5);
        const espnResults = await Promise.all(pastEvents.map(ev => getEspnArchivedMatchData(ev.id)));

        for (let i = 0; i < espnResults.length; i++) {
            const rec = espnResults[i];
            if (!rec) continue;
            const teamIds = Object.keys(rec.teamsData || {});
            const myKey = teamIds.find(k => k === espnTeamId) || teamIds.find(k => teamsMatch(teamName, rec.teamsData[k]?.teamName));
            const oppKey = teamIds.find(k => k !== myKey);
            if (myKey && rec.teamsData[myKey]) {
                const mySt = rec.teamsData[myKey];
                const oppSt = oppKey ? rec.teamsData[oppKey] : null;
                if (mySt.corners !== null && oppSt && oppSt.corners !== null) {
                    cornerForList.push(mySt.corners);
                    cornerAgainstList.push(oppSt.corners);
                }
                if (mySt.shots !== null && oppSt && oppSt.shots !== null) {
                    shotForList.push(mySt.shots);
                    shotAgainstList.push(oppSt.shots);
                }
                if (mySt.sot !== null && oppSt && oppSt.sot !== null) {
                    sotForList.push(mySt.sot);
                    sotAgainstList.push(oppSt.sot);
                }
                if (mySt.poss !== null) possList.push(mySt.poss);
                cardsList.push((mySt.yc || 0) + (mySt.rc || 0));
            }
            const rData = myKey ? rec.rostersData?.[myKey] : null;
            if (rData) {
                if (!formation && rData.formation) formation = rData.formation;
                if (rData.starters?.length >= 11) recentXIs.push(rData.starters.slice(0, 11));
                if (rData.fullSquad?.length > 0) recentSquads.push(rData.fullSquad);
                if (i === 0 && rData.rcPlayers?.length > 0) {
                    lastMatchRedCards.push(...rData.rcPlayers);
                }
                for (const gp of (rData.goalPlayers || [])) {
                    goalScorerCounts.set(gp, (goalScorerCounts.get(gp) || 0) + 1);
                }
            }
        }
    }

    // B) Maçkolik son 5-8 tamamlanmış maçtan gerçek Korner, Şut, İsabetli Şut ve İlk 11/Kart verisi (ESPN'de eksikse veya tamamlayıcı olarak)
    if (Array.isArray(pastMkMatches) && pastMkMatches.length > 0 && (cornerForList.length < 4 || shotForList.length < 4 || recentXIs.length < 2)) {
        const recentMk = pastMkMatches.slice(-6).reverse(); // En yeniden eskiye
        const mkResults = await Promise.all(recentMk.map(pm => getMackolikArchivedMatchData(pm.id)));

        for (let i = 0; i < mkResults.length; i++) {
            const rec = mkResults[i];
            const pm = recentMk[i];
            if (!rec || !pm) continue;
            const isHome = pm.isHome;
            const myIdx = isHome ? 0 : 1;
            const oppIdx = isHome ? 1 : 0;

            if (cornerForList.length < 8 && rec.corners && rec.corners[myIdx] !== null && rec.corners[oppIdx] !== null) {
                cornerForList.push(rec.corners[myIdx]);
                cornerAgainstList.push(rec.corners[oppIdx]);
            }
            if (shotForList.length < 8 && rec.shots && rec.shots[myIdx] !== null && rec.shots[oppIdx] !== null) {
                shotForList.push(rec.shots[myIdx]);
                shotAgainstList.push(rec.shots[oppIdx]);
            }
            if (sotForList.length < 8 && rec.sot && rec.sot[myIdx] !== null && rec.sot[oppIdx] !== null) {
                sotForList.push(rec.sot[myIdx]);
                sotAgainstList.push(rec.sot[oppIdx]);
            }
            if (rec.poss && rec.poss[myIdx] !== null) possList.push(rec.poss[myIdx]);
            if (rec.yc) {
                const rcCount = (rec.rcPlayers?.[myIdx] || []).length;
                cardsList.push((rec.yc[myIdx] || 0) + rcCount);
            }

            const myXI = isHome ? rec.homeXI : rec.awayXI;
            const mySquad = isHome ? rec.homeSquad : rec.awaySquad;
            const myRc = rec.rcPlayers?.[myIdx] || [];
            const myGoals = rec.goalPlayers?.[myIdx] || [];

            if (myXI && myXI.length >= 11 && recentXIs.length < 5) {
                recentXIs.push(myXI.slice(0, 11));
            }
            if (mySquad && mySquad.length > 0 && recentSquads.length < 5) {
                recentSquads.push(mySquad);
            }
            if (i === 0 && myRc.length > 0 && lastMatchRedCards.length === 0) {
                lastMatchRedCards.push(...myRc);
            }
            for (const gp of myGoals) {
                goalScorerCounts.set(gp, (goalScorerCounts.get(gp) || 0) + 1);
            }
        }
    }

    const avg = (arr) => arr.length > 0 ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

    const cornersForAvg = avg(cornerForList);
    const cornersAgainstAvg = avg(cornerAgainstList);
    const totalCornersAvg = (cornersForAvg !== null && cornersAgainstAvg !== null)
        ? +(cornersForAvg + cornersAgainstAvg).toFixed(1)
        : null;

    const shotsForAvg = avg(shotForList);
    const shotsAgainstAvg = avg(shotAgainstList);
    const sotForAvg = avg(sotForList);
    const sotAgainstAvg = avg(sotAgainstList);
    const possessionAvg = avg(possList);
    const cardsForAvg = avg(cardsList);

    // C) Eksik / Sakat / Cezalı Oyuncuların Tespiti
    const missingSet = new Map(); // playerName -> reason
    for (const inj of (espnInjuries || [])) {
        const cleanName = inj.split('(')[0].trim();
        if (cleanName) missingSet.set(cleanName, inj);
    }
    for (const rcPlayer of lastMatchRedCards) {
        if (!missingSet.has(rcPlayer)) {
            missingSet.set(rcPlayer, `${rcPlayer} (Kırmızı Kart Cezalısı)`);
        }
    }

    // Önceki maçlarda düzenli ilk 11 başlayıp (en az 2 maç) son maçın 21 kişilik kadrosunda yer almayan as oyuncular
    if (recentXIs.length >= 3 && recentSquads.length >= 1) {
        const latestSquadSet = new Set(recentSquads[0]);
        const starterFreq = new Map();
        for (let i = 1; i < recentXIs.length; i++) {
            for (const p of recentXIs[i]) {
                starterFreq.set(p, (starterFreq.get(p) || 0) + 1);
            }
        }
        for (const [pName, count] of starterFreq.entries()) {
            if (count >= 2 && !latestSquadSet.has(pName) && !missingSet.has(pName)) {
                const isScorer = (goalScorerCounts.get(pName) || 0) >= 1;
                missingSet.set(pName, `${pName} (${isScorer ? 'Önemli Hücum Eksiği / Kadro Dışı' : 'Sakat / Kadro Dışı - As Oyuncu'})`);
            }
        }
    }

    // Eğer bugünün resmi ilk 11'i açıklandıysa, son maçların as oyuncularından bugün ilk 11'de olmayanları tespit et
    const hasOfficialToday = Array.isArray(officialTodayXi) && officialTodayXi.length >= 11;
    if (hasOfficialToday && recentXIs.length >= 2) {
        const todaySet = new Set(officialTodayXi);
        const coreFreq = new Map();
        for (const xi of recentXIs.slice(0, 3)) {
            for (const p of xi) coreFreq.set(p, (coreFreq.get(p) || 0) + 1);
        }
        for (const [pName, count] of coreFreq.entries()) {
            if (count >= 2 && !todaySet.has(pName) && !missingSet.has(pName)) {
                missingSet.set(pName, `${pName} (Resmi İlk 11'de Yok)`);
            }
        }
    }

    const missingPlayers = Array.from(missingSet.values()).slice(0, 5);

    // D) Muhtemel İlk 11 veya Resmi İlk 11 Oluşturulması
    let activeXI = [];
    let lineupType = 'Veri Yok';
    if (hasOfficialToday) {
        activeXI = officialTodayXi.slice(0, 11);
        lineupType = 'Resmi İlk 11';
    } else if (recentXIs.length > 0) {
        // Son maçın ilk 11'ini baz al, kırmızı kart cezalısı veya sakat varsa önceki maçların en sık oynayan oyuncusuyla tamamla
        const bannedNames = new Set(Array.from(missingSet.keys()));
        const baseXI = recentXIs[0].filter(p => !bannedNames.has(p));
        if (baseXI.length < 11 && recentXIs.length > 1) {
            const freq = new Map();
            for (let i = 1; i < recentXIs.length; i++) {
                for (const p of recentXIs[i]) {
                    if (!bannedNames.has(p) && !baseXI.includes(p)) {
                        freq.set(p, (freq.get(p) || 0) + 1);
                    }
                }
            }
            const replacements = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]);
            for (const rep of replacements) {
                if (baseXI.length >= 11) break;
                baseXI.push(rep);
            }
        }
        activeXI = baseXI.slice(0, 11);
        lineupType = 'Muhtemel İlk 11';
    }

    return {
        hasRealCorners: cornerForList.length >= 2,
        cornerSample: cornerForList.length,
        cornersForAvg,
        cornersAgainstAvg,
        totalCornersAvg,
        recentCorners: cornerForList.slice(0, 5),
        hasRealShots: shotForList.length >= 2,
        shotSample: shotForList.length,
        shotsForAvg,
        shotsAgainstAvg,
        sotForAvg,
        sotAgainstAvg,
        possessionAvg,
        cardsForAvg,
        missingPlayers,
        activeXI,
        lineupType,
        formation
    };
}

// 5. ESPN Günlük Bülten (Stadyum, Form, Gol/Asist Liderleri)
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

// 6. ESPN Maç Özeti (Puan Durumu, Çok Sezonlu H2H, Kadro/Sakatlık ve LastFiveGames)
async function getEspnEventSummary(eventId) {
    if (!eventId) return null;
    const hit = espnSummaryCache.get(eventId);
    if (hit && Date.now() - hit.t < 15 * 60e3) return hit.data;

    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${eventId}`;
    const s = await fetchJsonWithTimeout(url, {}, 3500);
    if (!s) return null;

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
                    const reason = x.type?.description || x.details?.type || 'Sakat';
                    return pName ? `${pName} (${reason})` : null;
                }).filter(Boolean);
                if (tName && list.length) injuriesMap[tName] = list;
            }
        }
    } catch (_) {}

    const lastFiveGames = Array.isArray(s.lastFiveGames) ? s.lastFiveGames : [];

    const data = { h2hGames, standingsMap, referee, injuriesMap, lastFiveGames };
    espnSummaryCache.set(eventId, { t: Date.now(), data });
    return data;
}

// 7. Maçkolik Kadro ve Maç Önü Detayı (Açıklandığında Resmi İlk 11'ler)
async function getMackolikLineup(matchId) {
    const hit = mkLineupCache.get(matchId);
    if (hit && Date.now() - hit.t < 5 * 60e3) return hit.data;

    const url = `https://arsiv.mackolik.com/Match/MatchData.aspx?t=dtl&id=${matchId}&s=0`;
    const j = await fetchJsonWithTimeout(url, { 'Referer': 'https://arsiv.mackolik.com/' }, 2500);
    if (!j) return null;

    const homeXi = Array.isArray(j.h) ? j.h.slice(0, 11).map(p => p[1] || p[0]).filter(Boolean) : [];
    const awayXi = Array.isArray(j.a) ? j.a.slice(0, 11).map(p => p[1] || p[0]).filter(Boolean) : [];
    const data = {
        hasLineup: homeXi.length >= 11 && awayXi.length >= 11,
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

// Ana Zenginleştirme Fonksiyonu: Bir maç için tüm dış istihbaratı + gerçek korner/şut/kadro verisini birleştirir
async function enrichMatch(m, { fetchDeepSummary = false, fetchLineup = false, homePastMatches = [], awayPastMatches = [] } = {}) {
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
    let espnHomeBlock = null, espnAwayBlock = null;

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

                if (Array.isArray(sum.lastFiveGames)) {
                    for (const blk of sum.lastFiveGames) {
                        if (teamsMatch(m.home, blk.team?.displayName)) espnHomeBlock = blk;
                        else if (teamsMatch(m.away, blk.team?.displayName)) espnAwayBlock = blk;
                    }
                }
            }
        }
    }

    const [weather, officialLineup] = await Promise.all([
        getWeatherForMatch(city, m.league?.country, m.kickoff),
        (fetchLineup || fetchDeepSummary) ? getMackolikLineup(m.id) : Promise.resolve(null)
    ]);

    // Madde 1, 2 ve 4: Gerçek Son 5/10 Maç Korner & Şut İstatistikleri + Eksik Oyuncular & Muhtemel/Resmi İlk 11
    let realHomeProfile = null;
    let realAwayProfile = null;
    if (fetchDeepSummary || homePastMatches.length > 0 || awayPastMatches.length > 0) {
        [realHomeProfile, realAwayProfile] = await Promise.all([
            buildTeamRealProfile(m.home, m.homeId, homePastMatches, espnHomeBlock, homeInjuries, officialLineup?.homeXi || []),
            buildTeamRealProfile(m.away, m.awayId, awayPastMatches, espnAwayBlock, awayInjuries, officialLineup?.awayXi || [])
        ]);
        if (realHomeProfile?.missingPlayers?.length) homeInjuries = realHomeProfile.missingPlayers;
        if (realAwayProfile?.missingPlayers?.length) awayInjuries = realAwayProfile.missingPlayers;
    }

    const squad = (realHomeProfile || realAwayProfile || officialLineup?.hasLineup) ? {
        lineupType: officialLineup?.hasLineup
            ? 'Resmi İlk 11'
            : (realHomeProfile?.activeXI?.length || realAwayProfile?.activeXI?.length)
                ? 'Muhtemel İlk 11 (Son Maç İskeleti)'
                : 'Henüz Açıklanmadı',
        isOfficial: Boolean(officialLineup?.hasLineup),
        homeXI: officialLineup?.hasLineup ? officialLineup.homeXi : (realHomeProfile?.activeXI || []),
        awayXI: officialLineup?.hasLineup ? officialLineup.awayXi : (realAwayProfile?.activeXI || []),
        homeFormation: realHomeProfile?.formation || null,
        awayFormation: realAwayProfile?.formation || null,
        homeMissing: homeInjuries,
        awayMissing: awayInjuries
    } : null;

    const realStats = (realHomeProfile || realAwayProfile) ? {
        home: realHomeProfile,
        away: realAwayProfile
    } : null;

    return {
        FetchedAt: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' }),
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
        lineup: officialLineup,
        squad,
        realStats
    };
}

module.exports = {
    enrichMatch,
    getWeatherForMatch,
    getEspnDayEvents,
    getMackolikLineup,
    getMackolikArchivedMatchData,
    teamsMatch
};
