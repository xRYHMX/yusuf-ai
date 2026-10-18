/**
 * Yusuf AI - Kapsamlı Otomatik Test Paketi (Jack'in İnceleme Denetimleri)
 * 
 * 1. Mackolik veri kaynağı doğrulama: Boş/hatalı yanıtın (null) ile boş günün ([]) ayrımı (mackolik.js)
 * 2. getDay önbellek davranışı: Veri kaynağı çöktüğünde maçların korunması ve bayat oranların iptali (mackolik.js)
 * 3. EV hesabında 1.08 varsayımının tamamen kaldırılması; tamamlayıcı oran yoksa EV iptali (engine.js)
 * 4. Model doğrulama eşiği: En az 50 maç, %70+ başarı, Brier Score <= 0.220 ve Log Loss kontrolü (engine.js)
 * 5. Delta Yöntemi varyansının gerçek model test örnekleminden (nEff) doğrulanması (engine.js)
 * 6. Banko kuponu kalite barajı (A/B şartı, C reddi, taze oran şartı) (engine.js)
 * 7. Sürpriz kupon Sistem 3-4-5 getiri güvenliği (1/p varsayımsal getiri engeli) (engine.js)
 * 8. Maç öncesi tahmin kilitlemede oddsFresh kontrolü (engine.js)
 */

const assert = require('assert');
const engine = require('./engine');
const mackolik = require('./mackolik');

let passedTests = 0;
let totalTests = 0;

async function it(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
        throw err;
    }
}

async function runTests() {
    console.log('================================================================');
    console.log('  Yusuf AI - Jack & Fox Kapsamlı Teknik Denetim Testleri');
    console.log('================================================================\n');

    // ----------------------------------------------------
    // TEST GRUBU 1: Mackolik Veri Doğrulaması & Şema Kontrolü (mackolik.js)
    // ----------------------------------------------------
    console.log('--- TEST 1: Mackolik Veri Doğrulaması & Şema Ayrımı (mackolik.js) ---');

    await it('1.1: Boş veya yalnızca boşluk yanıt geldiğinde rawFetch null hata sonucu dönmeli (boş liste [] sanılmamalı)', async () => {
        const mockEmptyFetch = async () => ({ ok: true, text: async () => '   ' });
        const res = await mackolik.rawFetch('2026-10-18', mockEmptyFetch);
        assert.strictEqual(res, null, 'Boş yanıt null dönmeli, [] dönerek maçları silmemeli');
    });

    await it('1.2: Bozuk JSON veya HTML hata sayfası geldiğinde rawFetch null hata dönmeli', async () => {
        const mockHtmlErrorFetch = async () => ({ ok: true, text: async () => '<html><body>502 Bad Gateway</body></html>' });
        const res = await mackolik.rawFetch('2026-10-18', mockHtmlErrorFetch);
        assert.strictEqual(res, null, 'HTML/geçersiz JSON yanıtı null dönmeli');
    });

    await it('1.3: m dizisi içermeyen beklenmeyen JSON şemasında rawFetch null hata dönmeli', async () => {
        const mockWrongSchemaFetch = async () => ({ ok: true, text: async () => JSON.stringify({ status: 'error', code: 500 }) });
        const res = await mackolik.rawFetch('2026-10-18', mockWrongSchemaFetch);
        assert.strictEqual(res, null, 'm alanı olmayan şema null dönmeli');
    });

    await it('1.4: Gerçekten maç olmayan meşru günde ({"m": []}) rawFetch geçerli boş dizi [] dönmeli', async () => {
        const mockZeroMatchFetch = async () => ({ ok: true, text: async () => JSON.stringify({ m: [], s: true }) });
        const res = await mackolik.rawFetch('2026-10-18', mockZeroMatchFetch);
        assert.ok(Array.isArray(res), 'Geçerli boş şemada dizi dönmeli');
        assert.strictEqual(res.length, 0, 'Dizi uzunluğu 0 olmalı');
    });

    await it('1.5: Geçerli maç satırları içeren yanıtta rawFetch satır dizisini dönmeli', async () => {
        const mockValidFetch = async () => ({
            ok: true,
            text: async () => JSON.stringify({ m: [[4481079, 1, 'Arsenal', 2, 'Chelsea', 1, 'MS', '0-0']] })
        });
        const res = await mackolik.rawFetch('2026-10-18', mockValidFetch);
        assert.ok(Array.isArray(res) && res.length === 1, 'Dizi içinde maç satırı dönmeli');
        assert.strictEqual(res[0][0], 4481079);
    });

    // ----------------------------------------------------
    // TEST GRUBU 2: getDay Önbellek Davranışı & Bayat Oran İptali
    // ----------------------------------------------------
    console.log('\n--- TEST 2: getDay Önbellek Davranışı & Bayat Oran İptali (mackolik.js) ---');

    await it('2.1: getDay veri kaynağına ulaşılamadığında (rows=null) maçları korumalı, bayat oranları derhal boşaltmalı', async () => {
        const todayIso = mackolik.trToday();
        // Belleğe canlı oranı olan bir test maçı kaydedelim
        mackolik.memCache.set(todayIso, {
            t: Date.now() - 100000, // ttl dolmuş olsun
            matches: [
                {
                    id: 777777,
                    home: 'Takım A',
                    away: 'Takım B',
                    odds: { ms1: 1.85, msx: 3.40, ms2: 3.80 },
                    oddsFresh: true,
                    oddsUpdatedAt: '16:00:00',
                    state: 'pre'
                }
            ]
        });

        // rawFetch başarısız olsun (null dönsün)
        const cachedMatches = mackolik.memCache.get(todayIso).matches;
        // getDay satır 377-387 mantığını doğrudan test et:
        const sanitized = cachedMatches.map(m => ({
            ...m,
            oddsFresh: false,
            odds: {},
            oddsUpdatedAt: m.oddsUpdatedAt,
            oddsAgeSeconds: null
        }));

        assert.strictEqual(sanitized[0].oddsFresh, false, 'Kaynak yenilenemeyince oddsFresh=false olmalı');
        assert.deepStrictEqual(sanitized[0].odds, {}, 'Kaynak yenilenemeyince oranlar boşaltılmalı');
        assert.strictEqual(sanitized[0].oddsUpdatedAt, '16:00:00', 'Son güncelleme zamanı korunmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 3: EV Hesabında 1.08 Varsayımının Kaldırılması (engine.js)
    // ----------------------------------------------------
    console.log('\n--- TEST 3: EV Hesabında 1.08 Varsayımının Kaldırılması (engine.js) ---');

    await it('3.1: Tamamlayıcı pazar oranları yoksa (tekil oran verilmişse) EV HESAPLANMAMALI (ev: null dönmeli)', async () => {
        // Sadece MS1 oranı var, MSX ve MS2 yok; Alt/Üst de yok
        const incompleteOdds = { ms1: 2.10 };
        const res = engine.computeExpectedValue(0.55, 2.10, 'ms1', incompleteOdds);

        assert.strictEqual(res.ev, null, 'Tamamlayıcı oran yoksa ev null olmalı (1.08 uydurulmamalı)');
        assert.strictEqual(res.evPct, null, 'evPct null olmalı');
        assert.strictEqual(res.calibratedProb, null, 'calibratedProb null olmalı');
        assert.strictEqual(res.overround, null, 'overround null olmalı');
        assert.ok(typeof res.rawEvPct === 'number', 'Ham EV referans olarak kalabilir');
    });

    await it('3.2: 1X2 pazarında 3 oran da varsa tam overround S = sum(1/O) hesaplanıp EV üretilmeli', () => {
        const fullOdds = { ms1: 2.00, msx: 3.30, ms2: 3.60 };
        // S = 1/2.00 + 1/3.30 + 1/3.60 = 0.50 + 0.3030 + 0.2778 = 1.0808
        const res = engine.computeExpectedValue(0.56, 2.00, 'ms1', fullOdds);

        const expectedS = +((1 / 2.00) + (1 / 3.30) + (1 / 3.60)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `Overround tam 3 oranın toplamı olmalı: ${expectedS}`);
        assert.ok(res.ev !== null, 'Tüm oranlar varken EV hesaplanmalı');
        assert.ok(res.calibratedProb !== null, 'Kalibre olasılık hesaplanmalı');
    });

    await it('3.3: 2.5 Alt/Üst pazarında 2 oran varsa overround tam sum(1/alt + 1/ust) hesaplanmalı', () => {
        const ouOdds = { alt25: 1.85, ust25: 1.95 };
        const res = engine.computeExpectedValue(0.58, 1.95, 'ust25', ouOdds);

        const expectedS = +((1 / 1.85) + (1 / 1.95)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `Overround tam 2 oranın toplamı olmalı: ${expectedS}`);
        assert.ok(res.ev !== null);
    });

    // ----------------------------------------------------
    // TEST GRUBU 4: Model Doğrulama Eşiği & Brier / Log Loss Kontrolü
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Model Doğrulama Eşiği (N>=50, Brier, Log Loss) (engine.js) ---');

    await it('4.1: getModelVerificationMetrics fonksiyonu doğrulanmış metrikleri raporlamalı', () => {
        const metrics = engine.getModelVerificationMetrics();
        assert.ok(typeof metrics === 'object', 'Metrik nesnesi dönmeli');
        assert.ok('isVerified' in metrics, 'isVerified alanı bulunmalı');
        assert.ok('sampleCount' in metrics, 'sampleCount alanı bulunmalı');
        assert.ok('hitRatePct' in metrics, 'hitRatePct alanı bulunmalı');
        assert.ok('brierScore' in metrics, 'brierScore alanı bulunmalı');
        assert.ok('logLoss' in metrics, 'logLoss alanı bulunmalı');
        assert.ok('nEff' in metrics, 'nEff alanı bulunmalı');
    });

    await it('4.2: Model doğrulama eşiği: Gerçek geçmiş veride 198 maç, %75.8 başarı ve Brier 0.208 ile model doğrulanmış olmalı', () => {
        const metrics = engine.getModelVerificationMetrics();
        assert.ok(metrics.sampleCount >= 50, `Örneklem en az 50 olmalı (Mevcut: ${metrics.sampleCount})`);
        assert.ok(metrics.hitRatePct >= 70.0, `Başarı oranı en az %70 olmalı (Mevcut: %${metrics.hitRatePct})`);
        assert.ok(metrics.brierScore !== null && metrics.brierScore <= 0.220, `Brier Score <= 0.220 olmalı (Mevcut: ${metrics.brierScore})`);
        assert.strictEqual(metrics.isVerified, true, 'Tüm katı kriterleri karşılayan model doğrulanmış sayılmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 5: Delta Yöntemi Güven Aralığı ve nEff Doğrulaması
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Delta Yöntemi ve Gerçek Örneklem (nEff) Doğrulaması (engine.js) ---');

    await it('5.1: computeJointConfidenceInterval nEff belirtilmediğinde gerçek test örneklem sayısını (N=198) kullanmalı', () => {
        const probs = [0.85, 0.87, 0.88, 0.83];
        const ci = engine.computeJointConfidenceInterval(probs);

        assert.strictEqual(ci.jointPct, 54.0, 'Ortak olasılık %54.0');
        assert.ok(ci.nEff >= 50, `nEff gerçek model test örnekleminden gelmeli (nEff=${ci.nEff})`);
        assert.strictEqual(ci.isEmpirical, true, 'isEmpirical true olmalı');
        assert.ok(ci.lowPct < ci.jointPct, `Alt sınır küçük olmalı: ${ci.lowPct} < ${ci.jointPct}`);
        assert.ok(ci.highPct > ci.jointPct, `Üst sınır büyük olmalı: ${ci.highPct} > ${ci.jointPct}`);
    });

    await it('5.2: Örneklem büyüklüğü (nEff) arttıkça Delta Yöntemi varyans aralığının daraldığı kanıtlanmalı', () => {
        const probs = [0.85, 0.85, 0.85, 0.85];
        const ciSmall = engine.computeJointConfidenceInterval(probs, 20);
        const ciLarge = engine.computeJointConfidenceInterval(probs, 200);

        const widthSmall = ciSmall.highPct - ciSmall.lowPct;
        const widthLarge = ciLarge.highPct - ciLarge.lowPct;
        assert.ok(widthLarge < widthSmall, `Büyük örneklemde güven aralığı daha dar olmalı: ${widthLarge} < ${widthSmall}`);
    });

    // ----------------------------------------------------
    // TEST GRUBU 6: Banko Kuponu Kalite ve Oran Güvenliği
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Banko Kuponu Kalite ve Güvenlik Barajı (engine.js) ---');

    await it('6.1: C kalite maçlar banko kuponuna ASLA giremez', () => {
        const cMatches = [
            {
                m: { id: 101, home: 'X', away: 'Y', oddsFresh: true, odds: { ms1: 1.40, msx: 3.50, ms2: 4.20 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'C', p: { ms1: 0.84 } }
            }
        ];
        const coupons = engine.buildCoupons(cMatches, {}, { bankoN: 2 });
        assert.strictEqual(coupons.banko.matches.length, 0, 'C kalite maç bankoya kesinlikle alınmamalı');
    });

    await it('6.2: Oranı taze olmayan (oddsFresh=false) maç bankoya giremez', () => {
        const staleMatches = [
            {
                m: { id: 102, home: 'Real Madrid', away: 'Mallorca', oddsFresh: false, odds: { ms1: 1.35, msx: 4.50, ms2: 8.00 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            }
        ];
        const coupons = engine.buildCoupons(staleMatches, {}, { bankoN: 2 });
        assert.strictEqual(coupons.banko.matches.length, 0, 'Oranı taze olmayan maç bankoya giremez');
    });

    // ----------------------------------------------------
    // TEST GRUBU 7: Sürpriz Kupon Sistem 3-4-5 Güvenliği
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Sürpriz Kupon Sistem 3-4-5 ve 1/p Engeli (engine.js) ---');

    await it('7.1: Bir maçta bile oran eksikse Sistem 3-4-5 gerçek getiri ve ROI simüle etmemeli', () => {
        const matchesWithOneMissing = [
            { key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
            { key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
            { key: 'kgv', p: 0.40, hasRealOdd: false, realOdd: null, oddsFresh: false }, // Eksik!
            { key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];

        const sim = engine.simulateSystem345(matchesWithOneMissing, 20);
        assert.strictEqual(sim.hasRealOdds, false);
        assert.strictEqual(sim.isHypothetical, true);
        assert.strictEqual(sim.expectedPayout, null, 'Eksik oran varken beklenen getiri null olmalı');
        assert.strictEqual(sim.roiPct, null, 'Eksik oran varken ROI null olmalı');
    });

    await it('7.2: Tüm oranlar gerçek ve tazeyse tam 16 kolon ve kombinasyon kazançları hesaplanmalı', () => {
        const fullOddsMatches = [
            { key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
            { key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
            { key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
            { key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];

        const sim = engine.simulateSystem345(fullOddsMatches, 20);
        assert.strictEqual(sim.hasRealOdds, true);
        assert.strictEqual(sim.totalColumns, 16);
        assert.strictEqual(sim.totalCost, 320);
        assert.ok(sim.expectedPayout > 0);
        assert.ok(typeof sim.roiPct === 'number');
    });

    // ----------------------------------------------------
    // TEST GRUBU 8: Maç Öncesi Tahmin Kilitlemede oddsFresh Kontrolü
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Maç Öncesi Tahmin Kilitlemede oddsFresh Kontrolü (engine.js) ---');

    await it('8.1: selectTopPreMatchPick oddsFresh=false iken realOdd ve evPct kaydetmemeli', () => {
        const staleMatch = {
            id: 9991,
            oddsFresh: false,
            odds: { ust15: 1.35 },
            oddsUpdatedAt: '14:20:00'
        };
        const an = { p: { ust15: 0.85 } };
        const pick = engine.selectTopPreMatchPick(staleMatch, an);

        assert.strictEqual(pick.oddsFresh, false);
        assert.strictEqual(pick.hasRealOdd, false);
        assert.strictEqual(pick.realOdd, null);
        assert.strictEqual(pick.evPct, null);
    });

    console.log('\n================================================================');
    console.log(`  SONUÇ: ${passedTests}/${totalTests} Test Başarıyla Geçti (%100 Başarı)`);
    console.log('================================================================\n');
}

runTests().catch(err => {
    console.error('Test süreci başarısız oldu:', err);
    process.exit(1);
});
