// Maçkolik veri katmanı: vd.mackolik.com/livedata (sitenin kendi halka açık veri kaynağı)
// Satır şeması (doğrulandı): 0 maçId, 1 evId, 2 ev, 3 depId, 4 dep, 5 durum kodu, 6 dakika/etiket, 7 İY skoru "a-b",
// 12-13 skor, 16 saat (TR), 18-22 oranlar (yalnızca iç hesapta), 35 tarih GG/AA/YYYY, 36 lig dizisi (son alan: spor 1=futbol).
const fs = require('fs');
const path = require('path');

const DAY_DIR = path.join(__dirname, 'cache', 'days');
fs.mkdirSync(DAY_DIR, { recursive: true });

const HEAD = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Referer': 'https://www.mackolik.com/',
    'Origin': 'https://www.mackolik.com'
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const trToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const isoToMk = (iso) => iso.split('-').reverse().join('/');
const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

async function rawFetch(iso) {
    for (let i = 0; i < 4; i++) {
        try {
            const r = await fetch('https://vd.mackolik.com/livedata?date=' + isoToMk(iso), { headers: HEAD });
            if (r.ok) {
                const t = await r.text();
                if (!t) return [];
                const j = JSON.parse(t);
                return Array.isArray(j.m) ? j.m : [];
            }
        } catch (_) { /* tekrar dene */ }
        await sleep(600 * (i + 1));
    }
    return null;
}

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n >= 1.01 ? n : null; };

function parseRow(r) {
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

    return {
        id: r[0],
        homeId: r[1], home: r[2],
        awayId: r[3], away: r[4],
        league: { id: lg[2], country: lg[1], name: lg[3], full: (lg[1] + ' ' + lg[3]).trim(), code: lg[9] },
        date: iso,
        time: r[16],
        kickoff: `${iso}T${r[16]}:00+03:00`,
        state, label: state === 'live' ? minute : txt,
        score: hasScore ? { h: r[12], a: r[13] } : null,
        ht: hasScore && ht ? { h: +ht[1], a: +ht[2] } : null,
        youth: /\bU(15|16|17|18|19|20|21|23)\b/i.test(names) || /gençlik|youth/i.test(names),
        women: /\(K\)|kad[ıi]n|women|\bW\b/i.test(names),
        odds: { h: num(r[18]), d: num(r[19]), a: num(r[20]), alt25: num(r[21]), ust25: num(r[22]) }   // sadece iç analiz
    };
}

const memCache = new Map();
async function getDay(iso) {
    const today = trToday();
    const file = path.join(DAY_DIR, iso + '.json');
    const mem = memCache.get(iso);
    const ttl = iso === today ? 45e3 : iso > today ? 10 * 60e3 : 30 * 60e3;
    if (mem && Date.now() - mem.t < ttl) return mem.matches;

    // 3+ gün öncesi artık değişmez: diskten kalıcı oku
    if (iso < addDays(today, -3) && fs.existsSync(file)) {
        const c = JSON.parse(fs.readFileSync(file, 'utf8'));
        memCache.set(iso, { t: Date.now() + 1e12, matches: c });
        return c;
    }

    const rows = await rawFetch(iso);
    if (rows === null) return mem ? mem.matches : [];
    const matches = rows.map(parseRow).filter(Boolean);
    memCache.set(iso, { t: Date.now(), matches });
    if (iso < addDays(today, -3)) fs.writeFileSync(file, JSON.stringify(matches));
    return matches;
}

async function getRange(fromIso, toIso, concurrency = 4) {
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

module.exports = { getDay, getRange, trToday, addDays };
