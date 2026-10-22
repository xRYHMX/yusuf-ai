// Maçkolik veri katmanı: vd.mackolik.com/livedata (sitenin kendi halka açık veri kaynağı)
// Satır şeması (doğrulandı): 0 maçId, 1 evId, 2 ev, 3 depId, 4 dep, 5 durum kodu, 6 dakika/etiket, 7 İY skoru "a-b",
// 12-13 skor, 16 saat (TR), 18-22 oranlar (yalnızca iç hesapta), 35 tarih GG/AA/YYYY, 36 lig dizisi (son alan: spor 1=futbol).
const fs = require('fs');
const path = require('path');

const DAY_DIR = path.join(__dirname, 'cache', 'days');
fs.mkdirSync(DAY_DIR, { recursive: true });

const HEAD = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://www.mackolik.com/',
    'Origin': 'https://www.mackolik.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const trToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const isoToMk = (iso) => iso.split('-').reverse().join('/');
const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

async function rawFetch(iso, customFetch = null) {
    const fetchFn = customFetch || fetch;
    for (let i = 0; i < 4; i++) {
        try {
            const r = await fetchFn('https://vd.mackolik.com/livedata?date=' + isoToMk(iso), { headers: HEAD });
            if (r && r.ok) {
                const t = await r.text();
                // Jack Kontrol 1: Boş yanıt veya salt boşluk kesinlikle null hata sonucu dönmeli, geçerli boş maç listesi sayılmamalı
                if (!t || !t.trim()) {
                    continue;
                }
                let j;
                try {
                    j = JSON.parse(t);
                } catch (_) {
                    // Geçersiz JSON veya HTML hata sayfası null hata sonucu olarak ayrılmalı
                    continue;
                }
                // Beklenen şema doğrulaması: j bir nesne ve j.m bir dizi olmalıdır
                if (j && typeof j === 'object' && Array.isArray(j.m)) {
                    return j.m; // Maç yoksa geçerli j.m = [] döner, maç varsa satır dizisi döner
                }
                // Şema bozuksa veya m alanı dizi değilse hata sayılır
                continue;
            }
        } catch (_) { /* tekrar dene */ }
        if (!customFetch) await sleep(600 * (i + 1));
    }
    return null;
}

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n >= 1.01 ? n : null; };

// Resmi Nesine Bülteni (cdnbulten.nesine.com) 25+ Bahis Pazarı Gerçek Oran Katmanı
let nesineCache = { t: 0, map: new Map() };
let nesineInFlight = null;

function parseNesineMarkets(maList) {
    const out = {};
    if (!Array.isArray(maList)) return out;

    const getO = (oca, n) => {
        if (!Array.isArray(oca)) return null;
        const found = oca.find(x => x.N === n);
        return found ? num(found.O) : null;
    };

    const setIf = (k, val) => {
        if (val !== null && val > 1.01) out[k] = val;
    };

    for (const mk of maList) {
        const mtid = mk.MTID;
        const sov = Number(mk.SOV || 0);
        const oca = mk.OCA;
        if (!Array.isArray(oca)) continue;

        if (mtid === 1) {
            setIf('ms1', getO(oca, 1)); setIf('h', getO(oca, 1));
            setIf('msx', getO(oca, 2)); setIf('d', getO(oca, 2));
            setIf('ms2', getO(oca, 3)); setIf('a', getO(oca, 3));
        } else if (mtid === 3) {
            setIf('dc1x', getO(oca, 1));
            setIf('dc12', getO(oca, 2));
            setIf('dcx2', getO(oca, 3));
        } else if (mtid === 7) {
            setIf('iy1', getO(oca, 1));
            setIf('iyx', getO(oca, 2));
            setIf('iy2', getO(oca, 3));
        } else if (mtid === 5) {
            const htftMap = { 1: '1/1', 2: '1/X', 3: '1/2', 4: 'X/1', 5: 'X/X', 6: 'X/2', 7: '2/1', 8: '2/X', 9: '2/2' };
            for (const [nStr, code] of Object.entries(htftMap)) {
                setIf('htft_' + code, getO(oca, Number(nStr)));
            }
        } else if (mtid === 11 && sov === 1.5) {
            setIf('alt15', getO(oca, 1));
            setIf('ust15', getO(oca, 2));
        } else if (mtid === 12 && sov === 2.5) {
            setIf('alt25', getO(oca, 1));
            setIf('ust25', getO(oca, 2));
        } else if (mtid === 13 && sov === 3.5) {
            setIf('alt35', getO(oca, 1));
            setIf('ust35', getO(oca, 2));
        } else if (mtid === 212 && sov === 0.5) {
            setIf('iyalt05', getO(oca, 1));
            setIf('iyust05', getO(oca, 2));
        } else if (mtid === 14 && sov === 1.5) {
            setIf('iyalt15', getO(oca, 1));
            setIf('iyust15', getO(oca, 2));
        } else if (mtid === 209 && sov === 0.5) {
            setIf('y2ust05', getO(oca, 2));
        } else if (mtid === 256 && sov === 0.5) {
            setIf('y2ust15', getO(oca, 1));
        } else if (mtid === 38) {
            setIf('kgv', getO(oca, 1));
            setIf('kgy', getO(oca, 2));
        } else if (mtid === 452) {
            setIf('iykgv', getO(oca, 1));
            setIf('iykgy', getO(oca, 2));
        } else if (mtid === 590 || mtid === 591) {
            setIf('y2kgv', getO(oca, 1));
            setIf('y2kgy', getO(oca, 2));
        } else if (mtid === 592) {
            setIf('ikiyari_kgv', getO(oca, 1));
            setIf('ikiyari_kgy', getO(oca, 2));
        } else if (mtid === 528) {
            setIf('ikiyari_gol', getO(oca, 1));
        } else if (mtid === 455 && sov === 0.5) {
            setIf('ev_ust05', getO(oca, 2));
        } else if (mtid === 20 && sov === 1.5) {
            setIf('ev_ust15', getO(oca, 2));
        } else if (mtid === 328 && sov === 2.5) {
            setIf('ev_ust25', getO(oca, 2));
        } else if (mtid === 457 && sov === 0.5) {
            setIf('dep_ust05', getO(oca, 2));
        } else if (mtid === 29 && sov === 1.5) {
            setIf('dep_ust15', getO(oca, 2));
        } else if (mtid === 326 && sov === 2.5) {
            setIf('dep_ust25', getO(oca, 2));
        } else if (mtid === 268) {
            if (sov === -1) setIf('hms1', getO(oca, 1));
            else if (sov === 1) setIf('hms2', getO(oca, 3));
        } else if (mtid === 798) {
            if (sov === -1.5) setIf('ah_h_15', getO(oca, 1));
            else if (sov === 1.5) setIf('ah_a_15', getO(oca, 2));
        } else if (mtid === 414) {
            setIf('ms1_kgv', getO(oca, 1));
            setIf('ms1_kgy', getO(oca, 2));
            setIf('msx_kgv', getO(oca, 3));
            setIf('msx_kgy', getO(oca, 4));
            setIf('ms2_kgv', getO(oca, 5));
            setIf('ms2_kgy', getO(oca, 6));
        } else if (mtid === 343 && sov === 2.5) {
            setIf('ms1_ust25', getO(oca, 2));
            setIf('ms2_ust25', getO(oca, 6));
        } else if (mtid === 446 && sov === 2.5) {
            setIf('ust25_kgv', getO(oca, 2));
        } else if (mtid === 43) {
            setIf('tg01', getO(oca, 1));
            setIf('tg23', getO(oca, 2));
            setIf('tg46', getO(oca, 3));
            setIf('tg7p', getO(oca, 4));
        } else if (mtid === 9) {
            setIf('yari1', getO(oca, 1));
            setIf('yari2', getO(oca, 3));
        } else if (mtid === 216) {
            if (sov === 8.5) setIf('korner_ust85', getO(oca, 2));
            else if (sov === 9.5) setIf('korner_ust95', getO(oca, 2));
            else if (sov === 10.5) setIf('korner_ust105', getO(oca, 2));
        } else if (mtid === 218 && sov === 4.5) {
            setIf('iy_korner_ust45', getO(oca, 2));
        } else if (mtid === 601 && (sov === 3.5 || sov === 4.5)) {
            if (sov === 3.5) setIf('kart_ust35', getO(oca, 2));
            else setIf('kart_ust45', getO(oca, 2));
        } else if (mtid === 602 && (sov === 3.5 || sov === 4.5)) {
            if (sov === 3.5) setIf('kart_ust35', getO(oca, 2));
            else setIf('kart_ust45', getO(oca, 2));
        } else if (mtid === 777) {
            for (const item of oca) {
                if (item.ON && item.ON.includes(':')) {
                    const scKey = 'msskor_' + item.ON.trim().replace(':', '_');
                    setIf(scKey, num(item.O));
                }
            }
        } else if (mtid === 779) {
            for (const item of oca) {
                if (item.ON && item.ON.includes(':')) {
                    const scKey = 'iyskor_' + item.ON.trim().replace(':', '_');
                    setIf(scKey, num(item.O));
                }
            }
        }
    }
    return out;
}

const NESINE_TTL_MS = 2 * 60e3; // 2 dakika tazelik süresi

async function getNesineOddsMap() {
    const now = Date.now();
    if (nesineCache.isFresh && nesineCache.map.size > 0 && now - nesineCache.t < NESINE_TTL_MS) {
        return nesineCache.map;
    }
    if (nesineInFlight) return nesineInFlight;

    nesineInFlight = (async () => {
        let refreshed = false;
        let lastErr = null;

        // Render ve uzak sunucu gecikmeleri için 18 saniye timeout ve 2 deneme hakkı
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const res = await fetch('https://cdnbulten.nesine.com/api/bulten/getprebultenfull', {
                    headers: { 'User-Agent': HEAD['User-Agent'], 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(18000)
                });
                if (res.ok) {
                    const json = await res.json();
                    const ea = json?.sg?.EA;
                    if (Array.isArray(ea)) {
                        const newMap = new Map();
                        for (const ev of ea) {
                            if (ev.C && Array.isArray(ev.MA) && ev.MA.length > 0) {
                                const parsedOdds = parseNesineMarkets(ev.MA);
                                if (Object.keys(parsedOdds).length > 0) {
                                    newMap.set(Number(ev.C), parsedOdds);
                                }
                            }
                        }
                        if (newMap.size > 0) {
                            const nowDate = new Date();
                            const timeStr = nowDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' });
                            nesineCache = {
                                t: Date.now(),
                                updatedAt: timeStr,
                                updatedIso: nowDate.toISOString(),
                                isFresh: true,
                                error: null,
                                map: newMap
                            };
                            refreshed = true;
                            if (global.addSystemLog) {
                                global.addSystemLog({
                                    level: 'info',
                                    category: 'nesine',
                                    scope: 'NesineCDN',
                                    message: `Nesine canlı bülteni güncellendi (${newMap.size} maçın oranları taze).`
                                });
                            }
                            break;
                        }
                    }
                }
            } catch (err) {
                lastErr = err;
                if (attempt === 1) {
                    await sleep(1000);
                }
            }
        }

        if (!refreshed && lastErr && global.addSystemLog) {
            global.addSystemLog({
                level: 'warn',
                category: 'nesine',
                scope: 'NesineCDN',
                message: 'Nesine canlı bülten bağlantı hatası: ' + lastErr.message,
                details: lastErr.stack || null
            });
        }
        nesineInFlight = null;
        // Kesin Kural (Madde 3 & Jack Kontrol 1): Oran yenilenemediğinde eski oranı ASLA kullanma; önbelleği temizle, son güncelleme zamanını koru
        if (!refreshed) {
            const preservedUpdatedAt = nesineCache.updatedAt || null;
            const preservedUpdatedIso = nesineCache.updatedIso || null;
            nesineCache = {
                t: 0,
                updatedAt: preservedUpdatedAt,
                updatedIso: preservedUpdatedIso,
                isFresh: false,
                error: 'Nesine canlı oran servisi yenilenemedi; eski oranlar devre dışı bırakıldı.',
                map: new Map()
            };
            if (global.addSystemLog) {
                global.addSystemLog({
                    level: 'warn',
                    category: 'nesine',
                    scope: 'NesineCDN',
                    message: 'Nesine canlı oranlar yenilenemediği için eski oranlar temizlendi.'
                });
            }
        }
        return nesineCache.map;
    })();

    return nesineInFlight;
}

function getNesineStatus() {
    const ageSeconds = nesineCache.isFresh && nesineCache.t > 0
        ? Math.max(0, Math.round((Date.now() - nesineCache.t) / 1000))
        : null;
    const isCurrentlyFresh = Boolean(nesineCache.isFresh && nesineCache.map.size > 0 && ageSeconds !== null && ageSeconds * 1000 < NESINE_TTL_MS * 1.5);
    return {
        isFresh: isCurrentlyFresh,
        updatedAt: isCurrentlyFresh ? nesineCache.updatedAt : null,
        updatedIso: isCurrentlyFresh ? nesineCache.updatedIso : null,
        ageSeconds,
        activeMatchCount: isCurrentlyFresh ? nesineCache.map.size : 0,
        error: isCurrentlyFresh ? null : (nesineCache.error || 'Güncel Nesine oranı henüz çekilemedi.')
    };
}

function parseRow(r, idx = 999) {
    const lg = r[36];
    if (!lg || lg[11] !== 1) return null;               // yalnızca futbol
    const code = r[5], txt = String(r[6] || '');
    let state;
    if (code === 0) state = 'pre';
    else if (code === 4 || code === 8 || txt === 'MS' || txt === 'Pen') state = 'post';
    else if (code === 9) state = 'ppd';
    else if (code === 11) state = 'abd';
    else state = 'live';

    const [dd, mm, yy] = String(r[35]).split('/');
    const iso = `${yy}-${mm}-${dd}`;
    const ht = /^(\d+)-(\d+)$/.exec(String(r[7] || ''));
    const hasScore = state !== 'pre' && state !== 'ppd';
    const names = `${r[2]} ${r[4]} ${lg[1]} ${lg[3]}`;

    let minute = null;
    if (state === 'live') minute = code === 2 ? 'İY' : /^\d+$/.test(txt) ? txt + "'" : txt;

    const hOdd = num(r[18]), dOdd = num(r[19]), aOdd = num(r[20]);
    const histOdds = {
        h: hOdd, d: dOdd, a: aOdd,
        ms1: hOdd, msx: dOdd, ms2: aOdd,
        alt25: num(r[21]), ust25: num(r[22])
    };
    const iddaaCode = Number(r[14]) > 0 ? Number(r[14]) : null;
    const mbs = parseInt(r[34], 10) || 3;
    const inBulletin = Boolean(iddaaCode && hOdd && dOdd && aOdd);
    const youth = /\bU(15|16|17|18|19|20|21|23)\b/i.test(names) || /gençlik|youth|reserve/i.test(names);
    const women = /\(K\)|kad[ıi]n|women|\bW\b/i.test(names);
    const reserve = /\bII\b|Bölgesel|[34]\.\s*Lig| Amateur|Amatör/i.test(names);

    return {
        id: r[0],
        iddaaCode,
        mbs,
        order: idx,
        homeId: r[1], home: r[2],
        awayId: r[3], away: r[4],
        league: { id: lg[2], country: lg[1], name: lg[3], full: (lg[1] + ' ' + lg[3]).trim(), code: lg[9] },
        date: iso,
        time: r[16],
        kickoff: `${iso}T${r[16]}:00+03:00`,
        state, label: state === 'live' ? minute : txt,
        score: hasScore ? { h: r[12], a: r[13] } : null,
        ht: hasScore && ht ? { h: +ht[1], a: +ht[2] } : null,
        youth,
        women,
        reserve,
        inBulletin,
        // Geçmişte tamamlanmış maçlarda istatistiksel baz kalibrasyon için histOdds saklanır,
        // ancak güncel/gelecek maçlarda yalnızca canlı Nesine oranı yenilendiyse doldurulur.
        odds: state === 'post' ? histOdds : {},
        oddsFresh: false,
        oddsUpdatedAt: null,
        oddsAgeSeconds: null,
        nesineMarketsCount: 0
    };
}

const memCache = new Map();
async function getDay(iso, customFetch = null) {
    const today = trToday();
    const file = path.join(DAY_DIR, iso + '.json');
    const mem = memCache.get(iso);
    const ttl = iso === today ? 45e3 : iso > today ? 90e3 : 30 * 60e3;
    if (mem && Date.now() - mem.t < ttl && !customFetch) {
        // Bugün/yarın için önbellekteki maçların oran tazeliğini kontrol et
        if (iso < today || (nesineCache.isFresh && Date.now() - nesineCache.t < NESINE_TTL_MS)) {
            return mem.matches;
        }
    }

    // 3+ gün öncesi artık değişmez: diskten kalıcı oku
    if (iso < addDays(today, -3) && fs.existsSync(file) && !customFetch) {
        try {
            const c = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(c) && (c.length === 0 || 'mbs' in c[0])) {
                memCache.set(iso, { t: Date.now() + 1e12, matches: c });
                return c;
            }
        } catch (_) {}
    }

    const [rows, nesineMap] = await Promise.all([
        rawFetch(iso, customFetch),
        iso >= today ? getNesineOddsMap() : Promise.resolve(new Map())
    ]);
    if (rows === null) {
        if (!mem) return [];
        if (iso >= today) {
            // Jack Kontrol 1: Veri kaynağı yenilenemediğinde eski oranları geçersiz işaretle. oddsFresh = false yap, oranları boşalt, son güncelleme zamanını koru.
            return mem.matches.map(m => ({
                ...m,
                oddsFresh: false,
                odds: {},
                oddsUpdatedAt: m.oddsUpdatedAt || nesineCache.updatedAt || null,
                oddsAgeSeconds: null,
                nesineMarketsCount: 0
            }));
        }
        return mem.matches;
    }
    const isNesineFresh = Boolean(iso >= today && nesineCache.isFresh && nesineCache.updatedAt && nesineMap && nesineMap.size > 0);
    const ageSec = isNesineFresh ? Math.max(0, Math.round((Date.now() - nesineCache.t) / 1000)) : null;

    const matches = rows.map((r, i) => {
        const m = parseRow(r, i);
        if (!m) return null;
        if (iso >= today) {
            // Madde 3 & Jack Kontrol 1: Yalnızca canlı Nesine oranı başarıyla yenilendiyse gerçek oranları ata;
            // yenilenemediyse eski/yedek oranı ASLA kullanma; oranları boşalt ve son güncelleme zamanını koru!
            if (isNesineFresh && m.iddaaCode && nesineMap.has(m.iddaaCode)) {
                m.odds = { ...nesineMap.get(m.iddaaCode) };
                m.oddsFresh = true;
                m.oddsUpdatedAt = nesineCache.updatedAt;
                m.oddsAgeSeconds = ageSec;
            } else {
                m.odds = {};
                m.oddsFresh = false;
                m.oddsUpdatedAt = nesineCache.updatedAt || m.oddsUpdatedAt || null;
                m.oddsAgeSeconds = null;
            }
        }
        m.nesineMarketsCount = Object.entries(m.odds || {}).filter(([k, v]) => !['h', 'd', 'a'].includes(k) && typeof v === 'number' && v > 1.01).length;
        return m;
    }).filter(Boolean);
    memCache.set(iso, { t: Date.now(), matches });
    if (iso < addDays(today, -3)) {
        try { fs.writeFileSync(file, JSON.stringify(matches)); } catch (_) {}
    }
    return matches;
}

async function getRange(fromIso, toIso, concurrency = 10) {
    const days = [];
    for (let d = fromIso; d <= toIso; d = addDays(d, 1)) days.push(d);
    const out = [];
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (true) {
            const i = next++;
            if (i >= days.length) return;
            out.push(...await getDay(days[i]));
        }
    }));
    return out;
}

module.exports = { getDay, getRange, getNesineOddsMap, getNesineStatus, trToday, addDays, rawFetch, memCache, parseNesineMarkets };

