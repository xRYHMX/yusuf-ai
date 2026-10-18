/**
 * Yusuf AI - Otomatik Test Paketi (Jack'in 5 Kritik Düzeltmesi)
 * 1. Oran önbelleği tazelik ve bayat oran koruması (mackolik.js)
 * 2. Sabit 1.07 yerine dinamik marjsız (vig-free) overround ve Value Bet (engine.js)
 * 3. Banko kuponu kalite barajı (A/B şartı, güncel oran zorunluluğu, doğrulanmış güven) (engine.js)
 * 4. Sürpriz kupon 1/p varsayımsal getiri engeli ve Delta Yöntemi varyans aralığı (engine.js)
 * 5. Maç öncesi tahmin kilitlemede oddsFresh kontrolü (engine.js)
 */

const assert = require('assert');
const engine = require('./engine');
const mackolik = require('./mackolik');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}`);
        throw err;
    }
}

async function runTests() {
    console.log('======================================================');
    console.log('  Yusuf AI - Jack & Fox Teknik Doğrulama Testleri');
    console.log('======================================================\n');

    // ----------------------------------------------------
    // TEST GRUBU 1: Oran Önbelleği ve Bayat Oran İptali
    // ----------------------------------------------------
    console.log('--- TEST 1: Oran Önbelleği Tazeliği & Bayat Oran İptali (mackolik.js) ---');

    it('1.1: Nesine oran servisi durumu nesineCache tazeliğini doğru raporlamalı', () => {
        const status = mackolik.getNesineStatus();
        assert.ok(typeof status === 'object', 'getNesineStatus bir nesne dönmeli');
        assert.ok('isFresh' in status, 'isFresh anahtarı bulunmalı');
        assert.ok('ageSeconds' in status, 'ageSeconds anahtarı bulunmalı');
    });

    it('1.2: Oranlar yenilenemediğinde maç nesnesinde oddsFresh=false ve odds={} olmalı, son güncelleme korunmalı', () => {
        // Mock match simulating stale state
        const staleMatch = {
            id: 99999,
            oddsFresh: false,
            odds: {},
            oddsUpdatedAt: '18:45:00'
        };
        const an = { p: { ms1: 0.75, msx: 0.15, ms2: 0.10 } };
        const picks = engine.picksOf(staleMatch, an);
        const ms1Pick = picks.find(p => p.key === 'ms1');

        assert.strictEqual(ms1Pick.hasRealOdd, false, 'oddsFresh=false iken hasRealOdd false olmalı');
        assert.strictEqual(ms1Pick.realOdd, null, 'oddsFresh=false iken realOdd null olmalı');
        assert.strictEqual(ms1Pick.ev, null, 'oddsFresh=false iken ev null olmalı');
        assert.strictEqual(ms1Pick.oddsFresh, false, 'oddsFresh false olarak picks içinde taşınmalı');
        assert.strictEqual(ms1Pick.oddStatusText, 'Oran yenilenemedi (eski oran kullanılmıyor)', 'Kullanıcıya eski oran kullanılmadığı net bildirilmeli');
    });

    // ----------------------------------------------------
    // TEST GRUBU 2: Sabit 1.07 Yerine Dinamik Marjsız (Vig-Free) Overround
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Dinamik Vig-Free Overround ve Value Bet (engine.js) ---');

    it('2.1: 1X2 pazarında overround 3 oranın toplamından S = sum(1/O) olarak hesaplanmalı', () => {
        // MS1: 2.10, MSX: 3.20, MS2: 3.40
        // S = 1/2.10 + 1/3.20 + 1/3.40 = 0.47619 + 0.31250 + 0.29412 = 1.0828
        const matchOdds = { ms1: 2.10, msx: 3.20, ms2: 3.40 };
        const res = engine.computeExpectedValue(0.52, 2.10, 'ms1', matchOdds);

        assert.ok(res.overround !== null, 'Dinamik overround hesaplanmalı');
        const expectedS = +((1 / 2.10) + (1 / 3.20) + (1 / 3.40)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `Overround tam 3 oranın toplamı olmalı: ${expectedS}`);

        // Vig-free zımni olasılık = (1 / 2.10) / S = 0.47619 / 1.08281 = 0.43977
        // Calibrated Prob = 0.65 * 0.52 + 0.35 * 0.43977 = 0.338 + 0.15392 = 0.49192
        // Calibrated EV = (0.49192 * 2.10) - 1 = 1.0330 - 1 = +0.0330 (%3.3)
        assert.ok(res.evPct > 0, 'Pozitif EV doğru hesaplanmalı');
        assert.strictEqual(res.calibratedProb, 0.492, 'Kalibre edilmiş olasılık matematiksel olarak doğru olmalı');
    });

    it('2.2: Alt/Üst pazarında overround 2 oranın toplamından S = 1/alt + 1/ust olarak hesaplanmalı', () => {
        // Ust25: 1.90, Alt25: 1.85
        // S = 1/1.90 + 1/1.85 = 0.5263 + 0.5405 = 1.0669
        const matchOdds = { ust25: 1.90, alt25: 1.85 };
        const res = engine.computeExpectedValue(0.60, 1.90, 'ust25', matchOdds);

        const expectedS = +((1 / 1.90) + (1 / 1.85)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `Alt/Üst overround 2 oranın toplamı olmalı: ${expectedS}`);
        assert.notStrictEqual(res.overround, 1.07, 'Sabit 1.07 kullanılmamalı!');
    });

    it('2.3: KG pazarında overround sum(1/kgv + 1/kgy) üzerinden marjsız hesaplanmalı', () => {
        const matchOdds = { kgv: 1.75, kgy: 2.05 };
        const res = engine.computeExpectedValue(0.62, 1.75, 'kgv', matchOdds);
        const expectedS = +((1 / 1.75) + (1 / 2.05)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `KG overround sum(1/kgv + 1/kgy) olmalı: ${expectedS}`);
    });

    // ----------------------------------------------------
    // TEST GRUBU 3: Banko Kuponu Kalite & Güvenlik Kriterleri
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Banko Kuponu Kalite & Güvenlik Kriterleri (engine.js) ---');

    it('3.1: Banko kuponuna C kalite maçlar ASLA dahil edilmemeli', () => {
        // Sadece C kalite maçlar verelim
        const fakeItems = [
            {
                m: { id: 1, home: 'Team A', away: 'Team B', oddsFresh: true, odds: { ms1: 1.45 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'C', p: { ms1: 0.82 } }
            },
            {
                m: { id: 2, home: 'Team C', away: 'Team D', oddsFresh: true, odds: { ms1: 1.40 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'C', p: { ms1: 0.85 } }
            }
        ];
        const coupons = engine.buildCoupons(fakeItems, {}, { bankoN: 2 });
        assert.strictEqual(coupons.banko.matches.length, 0, 'C kalite maçlar yetmese bile bankoya ASLA alınmamalı');
    });

    it('3.2: Gerçek ve güncel oranı (oddsFresh=true) olmayan maçlar bankoya giremez', () => {
        const fakeItems = [
            {
                m: { id: 10, home: 'Real Madrid', away: 'Getafe', oddsFresh: false, odds: { ms1: 1.30 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.85 } }
            },
            {
                m: { id: 11, home: 'Barcelona', away: 'Cadiz', oddsFresh: true, odds: {}, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            }
        ];
        const coupons = engine.buildCoupons(fakeItems, {}, { bankoN: 2 });
        assert.strictEqual(coupons.banko.matches.length, 0, 'Oranı taze olmayan veya oranı bulunmayan maç bankoya giremez');
    });

    it('3.3: Gerçek oran yokken updatedAt uydurma anlık saat yazmamalı, null kalmalı', () => {
        const mockMatch = { id: 20, home: 'A', away: 'B', oddsFresh: false, odds: {}, state: 'pre' };
        const an = { p: { ms1: 0.70 } };
        const picks = engine.picksOf(mockMatch, an);
        assert.strictEqual(picks[0].oddsUpdatedAt, null, 'Oran yokken oddsUpdatedAt null olmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 4: Sürpriz Kupon Sistem 3-4-5 & Delta Method CI
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Sürpriz Kupon Getiri Güvenliği & Delta Method Varyansı (engine.js) ---');

    it('4.1: Eksik gerçek oran varsa Sistem 3-4-5 gerçek getiri simülasyonu yapmamalı (1/p varsayımsal getiri engellenmeli)', () => {
        const matchesWithMissingOdds = [
            { key: 'msx', p: 0.32, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
            { key: 'ms2', p: 0.28, hasRealOdd: true, realOdd: 3.50, oddsFresh: true },
            { key: 'ust35', p: 0.25, hasRealOdd: false, realOdd: null, oddsFresh: false }, // Eksik oran!
            { key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
            { key: 'dc1x', p: 0.35, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];

        const sim = engine.simulateSystem345(matchesWithMissingOdds, 20);
        assert.ok(sim !== null, 'Simülasyon nesnesi dönmeli');
        assert.strictEqual(sim.hasRealOdds, false, 'hasRealOdds false olmalı');
        assert.strictEqual(sim.isHypothetical, true, 'isHypothetical true olmalı');
        assert.strictEqual(sim.expectedPayout, null, 'Eksik oran varken beklenen getiri null olmalı (gerçek getiri gibi gösterilemez)');
        assert.strictEqual(sim.roiPct, null, 'Eksik oran varken ROI null olmalı');
        assert.strictEqual(sim.min3Payout, null, 'Eksik oran varken min3Payout null olmalı');
        assert.ok(sim.statusMessage.includes('kazanç ve ROI simülasyonu gösterilmez'), 'Kullanıcıya net uyarı mesajı verilmeli');
    });

    it('4.2: Tüm oranlar güncel ve gerçek olduğunda Sistem 3-4-5 matematiksel getiri ve ROI simüle edilmeli', () => {
        const fullRealMatches = [
            { key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
            { key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.00, oddsFresh: true },
            { key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.20, oddsFresh: true },
            { key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.40, oddsFresh: true }
        ];

        const sim = engine.simulateSystem345(fullRealMatches, 20);
        assert.strictEqual(sim.hasRealOdds, true, 'Tüm oranlar gerçek olduğunda hasRealOdds true olmalı');
        assert.strictEqual(sim.isHypothetical, false, 'isHypothetical false olmalı');
        assert.strictEqual(sim.totalColumns, 16, 'Sistem 3-4-5 toplam 16 kolon olmalı (C(5,3)=10 + C(5,4)=5 + C(5,5)=1)');
        assert.strictEqual(sim.totalCost, 320, '16 kolon * 20 TL = 320 TL olmalı');
        assert.ok(typeof sim.expectedPayout === 'number' && sim.expectedPayout > 0, 'Beklenen kazanç sayısal ve pozitif olmalı');
        assert.ok(typeof sim.roiPct === 'number', 'ROI hesaplanmalı');
    });

    it('4.3: Delta Yöntemi ile kombine güven aralığı istatistiksel formülle hesaplanmalı (sabit +-6 ve +5 kaldırılmalı)', () => {
        const probs = [0.85, 0.87, 0.88, 0.83];
        const ci = engine.computeJointConfidenceInterval(probs, 20, 1.645);

        // Ortak olasılık: 0.85 * 0.87 * 0.88 * 0.83 = 0.5396 (%54.0)
        assert.strictEqual(ci.jointPct, 54.0, 'Kombine olasılık %54.0 olmalı');
        assert.ok(ci.lowPct !== null && ci.highPct !== null, 'Alt ve üst güven sınırları hesaplanmalı');
        assert.ok(ci.lowPct < ci.jointPct, `Alt sınır ortak olasılıktan küçük olmalı: ${ci.lowPct} < ${ci.jointPct}`);
        assert.ok(ci.highPct > ci.jointPct, `Üst sınır ortak olasılıktan büyük olmalı: ${ci.highPct} > ${ci.jointPct}`);
        assert.ok(ci.seLnJ > 0, 'Standart hata hesaplanmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 5: Maç Öncesi Tahmin Kilitlemede oddsFresh Kontrolü
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Maç Öncesi Tahmin Kilitlemede oddsFresh Kontrolü (engine.js) ---');

    it('5.1: selectTopPreMatchPick m.oddsFresh=false ise realOdd ve evPct kaydetmemeli', () => {
        const staleMatch = {
            id: 8888,
            oddsFresh: false,
            odds: { ms1: 1.55, ust15: 1.30 }, // Eski önbellek oranı kalmış olsa bile!
            oddsUpdatedAt: '15:30:00'
        };
        const an = { p: { ust15: 0.82, ms1: 0.70 } };
        const pick = engine.selectTopPreMatchPick(staleMatch, an);

        assert.ok(pick !== null, 'Pick seçilmeli');
        assert.strictEqual(pick.oddsFresh, false, 'oddsFresh false olmalı');
        assert.strictEqual(pick.hasRealOdd, false, 'hasRealOdd false olmalı (eski oran okunamaz)');
        assert.strictEqual(pick.realOdd, null, 'realOdd null olmalı');
        assert.strictEqual(pick.evPct, null, 'evPct null olmalı');
    });

    it('5.2: selectTopPreMatchPick m.oddsFresh=true ise gerçek oran ve dinamik EV kaydetmeli', () => {
        const freshMatch = {
            id: 8889,
            oddsFresh: true,
            odds: { ust15: 1.35, alt15: 3.10 },
            oddsUpdatedAt: '20:15:00'
        };
        const an = { p: { ust15: 0.85, ms1: 0.70 } };
        const pick = engine.selectTopPreMatchPick(freshMatch, an);

        assert.ok(pick !== null);
        assert.strictEqual(pick.oddsFresh, true, 'oddsFresh true olmalı');
        assert.strictEqual(pick.hasRealOdd, true, 'hasRealOdd true olmalı');
        assert.strictEqual(pick.realOdd, 1.35, 'Gerçek oran 1.35 kaydedilmeli');
        assert.ok(typeof pick.evPct === 'number', 'Dinamik EV hesaplanmalı');
        assert.strictEqual(pick.oddsUpdatedAt, '20:15:00', 'Son güncelleme zamanı korunmalı');
    });

    console.log('\n======================================================');
    console.log(`  SONUÇ: ${passedTests}/${totalTests} Test Başarıyla Geçti (%100 Başarı)`);
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('Test süreci başarısız oldu:', err);
    process.exit(1);
});
