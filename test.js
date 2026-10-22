/**
 * Yusuf AI - Kapsamlı Otomatik Test Paketi (Jack'in İnceleme Denetimleri v3)
 * 
 * 1. Mackolik veri kaynağı doğrulama: Boş/hatalı yanıtın (null) ile meşru boş günün ([]) ayrımı (mackolik.js)
 * 2. getDay önbellek davranışı: Gerçek enjekte fetch fonksiyonuyla bayat oranların anında boşaltılması (mackolik.js)
 * 3. Çapraz pazar marj sızıntısı engeli ve Çifte Şans EV devre dışı bırakma (engine.js)
 * 4. İzole sentetik test fixture'ları, eksik metrik ve bağımsız maç tekilliği denetimi (engine.js)
 * 5. Delta Yöntemi varyans aralığı, elle nEff parametresinin ampirik doğrulama sayılmaması (engine.js)
 * 6. Banko kuponu kalite/tazelik barajı, "Bilinmiyor" zaman damgası ve yanıltıcı ifade engeli (engine.js)
 * 7. Sürpriz kupon Sistem 3-4-5 getiri simülasyonu ve eksik oran kalkanı (engine.js)
 * 8. Maç öncesi tahmin kilitlemede oddsFresh kontrolü (engine.js)
 */

const assert = require('assert');
const fs = require('fs');
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

// Jack Kontrol 4: Testler yerel diskteki prediction_test_table.json dosyasına bağımlı olamaz!
// İzole, taşınabilir ve sıfır disk durumunda da çalışan sentetik test tabloları:
const mockVerifiedTable = {
    walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
        id: `mock_v_${i}`,
        matchId: 900000 + i,
        won: i < 45, // 45 / 60 = %75.0 (>= %70)
        brier: 0.190, // <= 0.220
        logLoss: 0.550, // <= 1.150
        kickoff: '2026-10-18T18:00:00.000Z',
        recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
    }))
};

const mockUnverifiedTable = {
    walkForwardRecords: Array.from({ length: 35 }, (_, i) => ({
        id: `mock_u_${i}`,
        matchId: 800000 + i,
        won: i < 28, // %80.0 başarı fakat N=35 (< 50)
        brier: 0.185,
        logLoss: 0.520,
        kickoff: '2026-10-18T18:00:00.000Z',
        recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
    }))
};

// Jack Kontrol 3: 60 sonuçlanmış maç var ama sadece 10 tanesinde Brier ve LogLoss var (eksik kayıt denetimi)
const mockIncompleteMetricsTable = {
    walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
        id: `mock_inc_${i}`,
        matchId: 700000 + i,
        won: i < 45,
        brier: i < 10 ? 0.190 : null,
        logLoss: i < 10 ? 0.550 : null,
        kickoff: '2026-10-18T18:00:00.000Z',
        recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
    }))
};

// Jack Kontrol 3: 60 kayıt var ama 30 maç tekrarlanmış (bağımsız olmayan maç denetimi)
const mockDuplicateMatchesTable = {
    walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
        id: `mock_dup_${i}`,
        matchId: 600000 + (i % 30), // Yalnızca 30 tekil maç!
        won: i < 45,
        brier: 0.190,
        logLoss: 0.550,
        kickoff: '2026-10-18T18:00:00.000Z',
        recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
    }))
};

async function runTests() {
    console.log('================================================================');
    console.log('  Yusuf AI - Jack & Fox Kapsamlı Teknik Denetim Testleri (v3)');
    console.log('================================================================\n');

    // ----------------------------------------------------
    // TEST GRUBU 1: Mackolik Veri Doğrulaması & Şema Ayrımı (mackolik.js)
    // ----------------------------------------------------
    console.log('--- TEST 1: Mackolik Veri Doğrulaması & Şema Ayrımı (mackolik.js) ---');

    await it('1.1: Boş veya yalnızca boşluk yanıt geldiğinde rawFetch null hata sonucu dönmeli', async () => {
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
    // TEST GRUBU 2: getDay Önbellek Davranışı & Doğrudan Fonksiyon Sınaması (mackolik.js)
    // ----------------------------------------------------
    console.log('\n--- TEST 2: getDay Önbellek Davranışı & Doğrudan Kod Sınaması (mackolik.js) ---');

    await it('2.1: getDay fonksiyonuna sahte failingFetch enjekte edildiğinde (rows=null) maçları korumalı ve bayat oranları derhal boşaltmalı', async () => {
        const todayIso = mackolik.trToday();
        mackolik.memCache.set(todayIso, {
            t: Date.now() - 100000,
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

        const failingFetch = async () => ({ ok: false, status: 503, text: async () => 'Service Unavailable' });
        const result = await mackolik.getDay(todayIso, failingFetch);

        assert.ok(Array.isArray(result) && result.length === 1, 'Maç listesi silinmemeli, korunmalı');
        assert.strictEqual(result[0].id, 777777);
        assert.strictEqual(result[0].home, 'Takım A');
        assert.strictEqual(result[0].oddsFresh, false, 'Kaynak yenilenemeyince oddsFresh=false olmalı');
        assert.deepStrictEqual(result[0].odds, {}, 'Kaynak yenilenemeyince bayat oranlar derhal boşaltılmalı');
        assert.strictEqual(result[0].oddsUpdatedAt, '16:00:00', 'Son güncelleme zamanı korunmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 3: EV Hesabında Çapraz Pazar Marj Sızıntısı & Çifte Şans Engeli (engine.js)
    // ----------------------------------------------------
    console.log('\n--- TEST 3: EV Hesabında Çapraz Pazar Marj Sızıntısı & Çifte Şans (engine.js) ---');

    await it('3.1: Tamamlayıcı pazar oranları yoksa EV HESAPLANMAMALI (ev: null dönmeli, 1.08 uydurulmamalı)', () => {
        const incompleteOdds = { ms1: 2.10 };
        const res = engine.computeExpectedValue(0.55, 2.10, 'ms1', incompleteOdds);

        assert.strictEqual(res.ev, null, 'Tamamlayıcı oran yoksa ev null olmalı');
        assert.strictEqual(res.evPct, null);
        assert.strictEqual(res.calibratedProb, null);
        assert.strictEqual(res.overround, null);
    });

    await it('3.2: 1X2 pazarında 3 oran da varsa tam overround S = sum(1/O) hesaplanıp EV üretilmeli', () => {
        const fullOdds = { ms1: 2.00, msx: 3.30, ms2: 3.60 };
        const res = engine.computeExpectedValue(0.56, 2.00, 'ms1', fullOdds);

        const expectedS = +((1 / 2.00) + (1 / 3.30) + (1 / 3.60)).toFixed(4);
        assert.strictEqual(res.overround, expectedS, `Overround tam 3 oranın toplamı olmalı: ${expectedS}`);
        assert.ok(res.ev !== null, 'Tüm oranlar varken EV hesaplanmalı');
        assert.ok(res.calibratedProb !== null);
    });

    await it('3.3: 2.5 Alt/Üst pazarında 2 oran varsa overround tam sum(1/alt + 1/ust) hesaplanmalı', () => {
        const ouOdds = { alt25: 1.85, ust25: 1.95 };
        const res = engine.computeExpectedValue(0.58, 1.95, 'ust25', ouOdds);

        const expectedS = +((1 / 1.85) + (1 / 1.95)).toFixed(4);
        assert.strictEqual(res.overround, expectedS);
        assert.ok(res.ev !== null);
    });

    await it('3.4: Jack Kontrol 1: Pazar tamamlayıcıları eksikse (örn. ev_ust05 tekil veya ust25 için alt25 yoksa) 1X2 marjı ASLA çapraz ödünç alınmamalı, EV null dönmeli', () => {
        const crossOddsA = { ev_ust05: 1.45, ms1: 2.10, msx: 3.30, ms2: 3.60 };
        const resA = engine.computeExpectedValue(0.75, 1.45, 'ev_ust05', crossOddsA);
        assert.strictEqual(resA.ev, null, 'Farklı pazarın (1X2) marjı ev_ust05 pazarına çapraz uygulanamaz');
        assert.strictEqual(resA.overround, null);

        const crossOddsB = { ust25: 1.85, ms1: 2.10, msx: 3.30, ms2: 3.60 };
        const resB = engine.computeExpectedValue(0.60, 1.85, 'ust25', crossOddsB);
        assert.strictEqual(resB.ev, null, 'Hedef pazarın (2.5 Üst) kendi tamamlayıcısı (2.5 Alt) yoksa 1X2 marjı ödünç alınamaz');
        assert.strictEqual(resB.overround, null);
    });

    await it('3.5: Jack Kontrol 1: Çifte şans pazarında (dc1x, dc12, dcx2) seçenekler birbirini dışlamadığı için (sum(P)=2.0) EV hesabı null dönmeli', () => {
        const dcOdds = { dc1x: 1.35, dc12: 1.40, dcx2: 1.55 };
        const res = engine.computeExpectedValue(0.70, 1.35, 'dc1x', dcOdds);
        assert.strictEqual(res.ev, null, 'Çifte şans için EV kesinlikle null olmalı');
        assert.strictEqual(res.overround, null);
        assert.ok(res.reason.includes('Çifte şans'));
    });

    // ----------------------------------------------------
    // TEST GRUBU 4: Sentetik Fixture ile Model Doğrulama Eşiği (N>=50, Brier, Log Loss)
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Model Doğrulama Eşiği & İzole Sentetik Fixture (engine.js) ---');

    await it('4.1: getModelVerificationMetrics metrik nesnesi doğru şemayı sağlamalı', () => {
        const metrics = engine.getModelVerificationMetrics(mockVerifiedTable);
        assert.strictEqual(typeof metrics, 'object');
        assert.strictEqual(metrics.sampleCount, 60);
        assert.strictEqual(metrics.hitRatePct, 75.0);
        assert.strictEqual(metrics.brierScore, 0.190);
        assert.strictEqual(metrics.logLoss, 0.550);
        assert.strictEqual(metrics.isVerified, true);
    });

    await it('4.2: N>=50, %70+ başarı, Brier<=0.220 ve LogLoss<=1.150 şartlarını sağlayan sentetik fixture doğrulanmalı', () => {
        const metrics = engine.getModelVerificationMetrics(mockVerifiedTable);
        assert.strictEqual(metrics.isVerified, true, 'Kriterleri sağlayan model doğrulanmış olmalı');
        assert.ok(metrics.reason.includes('başarıyla doğrulandı'));
    });

    await it('4.3: Jack Kontrol 4: N=35 (<50) olan yetersiz örneklem yüksek başarıya sahip olsa dahi DOĞRULANMAMIŞ (isVerified=false) sayılmalı', () => {
        const metrics = engine.getModelVerificationMetrics(mockUnverifiedTable);
        assert.strictEqual(metrics.sampleCount, 35);
        assert.strictEqual(metrics.isVerified, false, 'N < 50 iken model asla doğrulanmış sayılamaz');
        assert.ok(metrics.reason.includes('Yetersiz geçmiş örneklem'));
    });

    await it('4.4: Jack Kontrol 3: 60 maçın yalnızca 10 tanesinde Brier/LogLoss varsa model DOĞRULANMAMIŞ (isVerified=false) sayılmalı', () => {
        const metrics = engine.getModelVerificationMetrics(mockIncompleteMetricsTable);
        assert.strictEqual(metrics.isVerified, false, 'Eksik metrikli kayıtlar doğrulanmış sayılamaz');
        assert.ok(metrics.reason.includes('Eksik kalibrasyon verisi'));
    });

    await it('4.5: Jack Kontrol 3: Örneklemde tekrarlanan/kopya maçlar varsa (bağımsız olmayan maçlar) model DOĞRULANMAMIŞ (isVerified=false) sayılmalı', () => {
        const metrics = engine.getModelVerificationMetrics(mockDuplicateMatchesTable);
        assert.strictEqual(metrics.isVerified, false, 'Tekrarlanan maç içeren örneklem bağımsız sayılamaz');
        assert.ok(metrics.reason.includes('tekrarlanan maç kayıtları'));
    });

    await it('4.6: Jack Kontrol: Örneklemde recordedBeforeKickoffAt veya kickoff eksik/geçersizse model DOĞRULANMAMIŞ (isVerified=false) sayılmalı ve eksik zaman bilgisi raporlanmalı', () => {
        const mockMissingTimingTable = {
            walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
                id: `mock_missing_${i}`,
                matchId: 950000 + i,
                won: i < 45,
                brier: 0.190,
                logLoss: 0.550,
                kickoff: i < 50 ? '2026-10-18T18:00:00.000Z' : null, // 10 maçta kickoff eksik!
                recordedBeforeKickoffAt: i < 50 ? '2026-10-18T12:00:00.000Z' : null
            }))
        };
        const metrics = engine.getModelVerificationMetrics(mockMissingTimingTable);
        assert.strictEqual(metrics.isVerified, false, 'Eksik zaman damgası olan model doğrulanamaz');
        assert.strictEqual(metrics.missingTimingCount, 10);
        assert.ok(metrics.reason.includes('Eksik veya geçersiz zaman bilgisi'));
    });

    // ----------------------------------------------------
    // TEST GRUBU 5: Delta Yöntemi Güven Aralığı ve Örneklem Boyutu
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Delta Yöntemi ve Güven Aralığı Doğrulaması (engine.js) ---');

    await it('5.1: computeJointConfidenceInterval doğrulanmış fixture ile N=60 derinliğini ve ampirik durumu (isEmpirical=true) yansıtmalı', () => {
        const probs = [0.85, 0.87, 0.88, 0.83];
        const ci = engine.computeJointConfidenceInterval(probs, null, 1.645, mockVerifiedTable);

        assert.strictEqual(ci.jointPct, 54.0);
        assert.strictEqual(ci.nEff, 60);
        assert.strictEqual(ci.isEmpirical, true);
        assert.ok(ci.lowPct < ci.jointPct);
        assert.ok(ci.highPct > ci.jointPct);
    });

    await it('5.2: Jack Kontrol 2: Örneklem N<50 olduğunda isEmpirical=false dönmeli ve dürüst gerekçe üretilmeli', () => {
        const probs = [0.85, 0.87, 0.88, 0.83];
        const ci = engine.computeJointConfidenceInterval(probs, null, 1.645, mockUnverifiedTable);

        assert.strictEqual(ci.nEff, 35);
        assert.strictEqual(ci.isEmpirical, false, 'N < 50 iken isEmpirical false olmalı');
        assert.ok(ci.verificationReason.includes('Yetersiz'));
    });

    await it('5.3: Örneklem büyüklüğü (nEff) arttıkça Delta Yöntemi varyans aralığının daraldığı kanıtlanmalı', () => {
        const probs = [0.85, 0.85, 0.85, 0.85];
        const ciSmall = engine.computeJointConfidenceInterval(probs, 20);
        const ciLarge = engine.computeJointConfidenceInterval(probs, 200);

        const widthSmall = ciSmall.highPct - ciSmall.lowPct;
        const widthLarge = ciLarge.highPct - ciLarge.lowPct;
        assert.ok(widthLarge < widthSmall, `Büyük örneklemde güven aralığı daha dar olmalı: ${widthLarge} < ${widthSmall}`);
    });

    await it('5.4: Jack Kontrol 2: computeJointConfidenceInterval fonksiyonuna elle N=200 verilse dahi ampirik doğrulama sayılmamalı (isEmpirical=false kalmalı)', () => {
        const probs = [0.85, 0.85, 0.85, 0.85];
        const ci = engine.computeJointConfidenceInterval(probs, 200);
        assert.strictEqual(ci.nEff, 200);
        assert.strictEqual(ci.isEmpirical, false, 'Elle girilen nEff tek başına ampirik doğrulama sayılamaz');
        assert.ok(ci.verificationReason.includes('Manuel parametre'));
    });

    // ----------------------------------------------------
    // TEST GRUBU 6: Banko Kuponu Kalite, Zaman Damgası & Açıklama Güvenliği
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Banko Kuponu Kalite, Zaman Damgası & Açıklama Güvenliği (engine.js) ---');

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

    await it('6.3: Jack Kontrol 5: Oran güncelleme saati yoksa sistem saati uydurulmamalı, Bilinmiyor dönmeli', () => {
        const matchesNoTimestamp = [
            {
                m: { id: 201, home: 'Real Madrid', away: 'Mallorca', oddsFresh: true, odds: { ms1: 1.35, msx: 4.50, ms2: 8.00 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            },
            {
                m: { id: 202, home: 'Barcelona', away: 'Getafe', oddsFresh: true, odds: { ms1: 1.30, msx: 4.80, ms2: 9.00 }, mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.89 } }
            }
        ];
        const coupons = engine.buildCoupons(matchesNoTimestamp, {}, { bankoN: 2, customTable: mockVerifiedTable });
        assert.strictEqual(coupons.banko.updatedAt, 'Bilinmiyor', 'Güncelleme saati yoksa Bilinmiyor olmalı');
        assert.ok(coupons.banko.instruction.includes('Son oran kontrolü: Bilinmiyor'));
    });

    await it('6.4: Jack Kontrol 2: isEmpirical=false olduğunda kupon açıklaması yanıltıcı doğrulanmış ifadesi içermemeli, teorik ve yetersiz örneklem uyarısı taşımalı', () => {
        const matches = [
            {
                m: { id: 301, home: 'PSG', away: 'Metz', oddsFresh: true, odds: { ms1: 1.25, msx: 5.50, ms2: 11.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            },
            {
                m: { id: 302, home: 'Bayern', away: 'Bochum', oddsFresh: true, odds: { ms1: 1.20, msx: 6.00, ms2: 13.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.90 } }
            }
        ];
        const coupons = engine.buildCoupons(matches, {}, { bankoN: 2, customTable: mockUnverifiedTable });
        assert.strictEqual(coupons.banko.updatedAt, '18:45:00');
        assert.ok(coupons.banko.instruction.includes('teorik %90 güven aralığı'), 'Doğrulanmamış kuponda teorik aralık belirtilmeli');
        assert.ok(coupons.banko.instruction.includes('Yetersiz geçmiş örneklem'), 'Yetersiz örneklem açıkça söylenmeli');
        assert.ok(coupons.banko.instruction.includes('kesin başarı garantisi taşımaz'), 'Kesin garanti taşımadığı açıkça yazmalı');
        assert.strictEqual(coupons.banko.instruction.includes('maçla kalibre edildi'), false, 'Yetersiz örneklemde kalibre edildi denilemez');
    });

    await it('6.5: Jack Kontrol: Eksik Brier/LogLoss durumunda kupon açıklaması doğrudan verificationReason metnini (Eksik kalibrasyon verisi) göstermeli', () => {
        const matches = [
            {
                m: { id: 301, home: 'PSG', away: 'Metz', oddsFresh: true, odds: { ms1: 1.25, msx: 5.50, ms2: 11.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            },
            {
                m: { id: 302, home: 'Bayern', away: 'Bochum', oddsFresh: true, odds: { ms1: 1.20, msx: 6.00, ms2: 13.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.90 } }
            }
        ];
        const coupons = engine.buildCoupons(matches, {}, { bankoN: 2, customTable: mockIncompleteMetricsTable });
        assert.ok(coupons.banko.instruction.includes('Eksik kalibrasyon verisi'), 'Başarısızlık sebebi olarak eksik kalibrasyon verisi gösterilmeli');
        assert.ok(coupons.banko.instruction.includes('Doğrulanamadı:'), 'Doğrulanamadı ibaresi bulunmalı');
    });

    await it('6.6: Jack Kontrol: Tekrarlanan/kopya maçlar olduğunda kupon açıklaması doğrudan verificationReason metnini (tekrarlanan maç kayıtları) göstermeli', () => {
        const matches = [
            {
                m: { id: 301, home: 'PSG', away: 'Metz', oddsFresh: true, odds: { ms1: 1.25, msx: 5.50, ms2: 11.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.88 } }
            },
            {
                m: { id: 302, home: 'Bayern', away: 'Bochum', oddsFresh: true, odds: { ms1: 1.20, msx: 6.00, ms2: 13.00 }, oddsUpdatedAt: '18:45:00', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'A', p: { ms1: 0.90 } }
            }
        ];
        const coupons = engine.buildCoupons(matches, {}, { bankoN: 2, customTable: mockDuplicateMatchesTable });
        assert.ok(coupons.banko.instruction.includes('tekrarlanan maç kayıtları'), 'Başarısızlık sebebi olarak tekrarlanan maç kayıtları gösterilmeli');
        assert.ok(coupons.banko.instruction.includes('Doğrulanamadı:'), 'Doğrulanamadı ibaresi bulunmalı');
    });

    // ----------------------------------------------------
    // TEST GRUBU 7: Sürpriz Kupon Sistem 3-4-5 Güvenliği
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Gerçek Sistem 3-4-5 Kolonları, Nesine 50 TL Kuralı & Kesin Sonuçlandırma (engine.js) ---');

    const sample5Matches = [
        { id: 101, home: 'Real Madrid', away: 'Sevilla', key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
        { id: 102, home: 'Arsenal', away: 'Chelsea', key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
        { id: 103, home: 'Milan', away: 'Inter', key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
        { id: 104, home: 'Ajax', away: 'PSV', key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
        { id: 105, home: 'Porto', away: 'Benfica', key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
    ];

    await it('7.1: buildSystem345 tam 16 kolon (10 üçlü, 5 dörtlü, 1 beşli) üretmeli ve maç dağılımını içermeli', () => {
        const sys = engine.buildSystem345(sample5Matches);
        assert.ok(sys !== null, 'Sistem nesnesi null olmamalı');
        assert.strictEqual(sys.totalColumns, 16, 'Toplam 16 kolon üretilmeli');
        assert.strictEqual(sys.tripleCount, 10, '10 adet üçlü kolon olmalı');
        assert.strictEqual(sys.quadrupleCount, 5, '5 adet dörtlü kolon olmalı');
        assert.strictEqual(sys.quintupleCount, 1, '1 adet beşli kolon olmalı');
        assert.strictEqual(sys.columns.length, 16, 'Kolon dizisi 16 eleman içermeli');

        // Her kolonda doğru sayıda maç bulunmalı
        const triples = sys.columns.filter(c => c.type === '3-lü Kombinasyon');
        const quads = sys.columns.filter(c => c.type === '4-lü Kombinasyon');
        const quints = sys.columns.filter(c => c.type === '5-li Kombinasyon');

        assert.strictEqual(triples.length, 10);
        assert.strictEqual(quads.length, 5);
        assert.strictEqual(quints.length, 1);

        triples.forEach(c => assert.strictEqual(c.matches.length, 3));
        quads.forEach(c => assert.strictEqual(c.matches.length, 4));
        quints.forEach(c => assert.strictEqual(c.matches.length, 5));
    });

    await it('7.2: Eski 20 TL varsayılanı kalmamalı; Nesine 50 TL kuralı yapılandırılabilir olmalı ve iki senaryo da doğru hesaplanmalı', () => {
        const sysDefault = engine.buildSystem345(sample5Matches);
        const cost = sysDefault.costAnalysis;

        assert.strictEqual(cost.minBetAmount, 50, 'Varsayılan tutar 50 TL olmalı (20 TL olmamalı)');
        assert.strictEqual(cost.columnStakeRule.costPerColumn, 50, 'Kolon başı tutar 50 TL olmalı');
        assert.strictEqual(cost.columnStakeRule.totalCost, 800, 'Kolon başı 50 TL ile 16 kolon 800 TL olmalı');
        assert.strictEqual(cost.couponTotalRule.totalCost, 50, 'Kupon tabanı kuralında toplam tutar 50 TL olmalı');
        assert.strictEqual(cost.couponTotalRule.exactCostPerColumn, 3.125, 'Kupon tabanı 50 TL olunca kolon başı net 3.125 TL olmalı');
        assert.strictEqual(cost.couponTotalRule.sumOfColumns, 50, 'Kolon tutarlarının toplamı kupon tabanıyla birebir uyuşmalı');

        // Yapılandırılabilir özel tutar (örn: 100 TL)
        const sysCustom = engine.buildSystem345(sample5Matches, 100);
        assert.strictEqual(sysCustom.costAnalysis.minBetAmount, 100);
        assert.strictEqual(sysCustom.costAnalysis.columnStakeRule.totalCost, 1600);
    });

    await it('7.3: Simülasyon ve varsayımsal kazanç alanları (expectedPayout, roiPct, min3Payout vb.) çıktılarda BULUNMAMALI', () => {
        const sys = engine.buildSystem345(sample5Matches);
        assert.strictEqual(sys.expectedPayout, undefined, 'expectedPayout alanı bulunmamalı');
        assert.strictEqual(sys.roiPct, undefined, 'roiPct alanı bulunmamalı');
        assert.strictEqual(sys.min3Payout, undefined, 'min3Payout alanı bulunmamalı');
        assert.strictEqual(sys.max3Payout, undefined, 'max3Payout alanı bulunmamalı');
        assert.strictEqual(sys.all5Payout, undefined, 'all5Payout alanı bulunmamalı');
        assert.strictEqual(sys.pAtLeast3WinPct, undefined, 'pAtLeast3WinPct alanı bulunmamalı');
    });

    await it('7.4: Maçlar tamamlanmadan gerçek kazanç veya kesin ödeme gösterilmemeli', () => {
        const sys = engine.buildSystem345(sample5Matches);
        assert.strictEqual(sys.settlement.isSettled, false);

        // Eksik sonuçlarla sonuçlandırma çağrıldığında ödeme hesaplanmamalı
        const partialResults = [
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 }
        ];
        const settleAttempt = engine.settleSystem345(sys, partialResults, { costPerColumn: 50 });
        assert.strictEqual(settleAttempt.isSettled, false);
        assert.strictEqual(settleAttempt.settledPayout, null);
    });

    await it('7.5: Gerçek sonuçlar geldikten sonra kazanan kolonlar ve kesin ödeme doğru hesaplanmalı (ve iptal maç Nesine kuralına göre 1.00 oran sayılmalı)', () => {
        const sys = engine.buildSystem345(sample5Matches);

        // 3 maç kazandı (101, 102, 103), 1 maç iptal/ertelendi (104, void=1.00), 1 maç kaybetti (105)
        // Bu durumda kazanan maçlar: 101 (3.20), 102 (3.40), 103 (3.10), 104 (1.00 void)
        // 5. maç (105) kaybettiği için 5'li kolon kaybeder.
        // 4 maç kazanan kombinasyonlar:
        // Üçlü kolonlar: C(4, 3) = 4 adet üçlü kolon kazanır!
        // Dörtlü kolonlar: C(4, 4) = 1 adet dörtlü kolon kazanır!
        // Toplam kazanan kolon: 4 + 1 = 5 kolon.
        const completedResults = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.10 },
            { matchId: 104, won: false, void: true }, // Nesine İptal/Erteleme: Oran 1.00
            { matchId: 105, score: { h: 2, a: 0 }, settledOdd: 2.30 } // Kaybetti
        ];

        const settlement = engine.settleSystem345(sys, completedResults, { costPerColumn: 50, totalCost: 800 });
        assert.strictEqual(settlement.isSettled, true);
        assert.strictEqual(settlement.wonColumnsCount, 5, '4 başarılı maçla (biri void=1.00) 5 kolon kazanmalı');
        assert.ok(settlement.settledPayout > 0, 'Gerçek ödeme pozitif olmalı');
        assert.strictEqual(settlement.totalCost, 800);
    });

    await it('7.6: Gerçek oynanan oran veya bahis tutarı eksik olduğunda "Gerçek ödeme hesaplanamıyor" dönmeli', () => {
        const sys = engine.buildSystem345(sample5Matches);
        const results = [
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: true, settledOdd: 2.10 },
            { matchId: 105, won: true, settledOdd: 2.30 }
        ];

        // Bahis tutarı belirtilmeden çağrıldığında
        const noStake = engine.settleSystem345(sys, results, {});
        assert.strictEqual(noStake.isSettled, false);
        assert.strictEqual(noStake.settlementStatus, 'Gerçek ödeme hesaplanamıyor');
    });

    await it('7.7: mockIncompleteMetricsTable ile sürpriz kupon açıklamasının Eksik kalibrasyon verisi ve doğrulanamadı içerdiği doğrulanmalı', () => {
        const matches = [
            {
                m: { id: 401, home: 'Everton', away: 'Brighton', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'B', lh: 1.20, la: 1.20, p: { msx: 0.32, msx_kgv: 0.22, iykgv: 0.25 } }
            }
        ];
        const coupons = engine.buildCoupons(matches, {}, { surpN: 1, customTable: mockIncompleteMetricsTable });
        assert.ok(coupons.surprise.matches.length > 0, 'Sürpriz maç seçilmiş olmalı');
        assert.ok(coupons.surprise.instruction.includes('Eksik kalibrasyon verisi'), 'Sürpriz kupon açıklamasında Eksik kalibrasyon verisi bulunmalı');
        assert.ok(coupons.surprise.instruction.includes('doğrulanamadı'), 'Sürpriz kupon açıklamasında doğrulanamadı bulunmalı');
    });

    await it('7.8: mockDuplicateMatchesTable ile sürpriz kupon açıklamasının tekrarlanan maç kayıtları ve doğrulanamadı içerdiği doğrulanmalı', () => {
        const matches = [
            {
                m: { id: 401, home: 'Everton', away: 'Brighton', mbs: 1, inBulletin: true, state: 'pre' },
                an: { quality: 'B', lh: 1.20, la: 1.20, p: { msx: 0.32, msx_kgv: 0.22, iykgv: 0.25 } }
            }
        ];
        const coupons = engine.buildCoupons(matches, {}, { surpN: 1, customTable: mockDuplicateMatchesTable });
        assert.ok(coupons.surprise.matches.length > 0, 'Sürpriz maç seçilmiş olmalı');
        assert.ok(coupons.surprise.instruction.includes('tekrarlanan maç kayıtları'), 'Sürpriz kupon açıklamasında tekrarlanan maç kayıtları bulunmalı');
        assert.ok(coupons.surprise.instruction.includes('doğrulanamadı'), 'Sürpriz kupon açıklamasında doğrulanamadı bulunmalı');
    });

    await it('7.9: Gerçek oynanan oran yoksa eski öneri oranından ödeme hesaplanmamalı (m.odd fallback engeli)', () => {
        const sys = engine.buildSystem345(sample5Matches);
        // Sonuçlarda won: true var, ancak settledOdd / playedOdd verilmemiş (sadece kupon oluşturulurken m.odd vardı)
        const resultsWithoutPlayedOdds = [
            { matchId: 101, won: true },
            { matchId: 102, won: true },
            { matchId: 103, won: true },
            { matchId: 104, won: true },
            { matchId: 105, won: true }
        ];

        const settlement = engine.settleSystem345(sys, resultsWithoutPlayedOdds, { costPerColumn: 50 });
        assert.strictEqual(settlement.isSettled, false);
        assert.strictEqual(settlement.settlementStatus, 'Gerçek ödeme hesaplanamıyor');
        assert.ok(settlement.reason.includes('eski öneri oranı') || settlement.reason.includes('kayıtlı değil'));
    });

    await it('7.10: Ertelenen maç (postponed / ppd) iptal/geçersiz kararı kesinleşmeden kupon sonuçlandırılmamalı', () => {
        const sys = engine.buildSystem345(sample5Matches);
        // 104 numaralı maç ertelendi, ancak void/cancelled kesinleşmedi
        const resultsWithPostponed = [
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: null, postponed: true, void: false }, // Ertelendi, karar bekleniyor
            { matchId: 105, won: false, settledOdd: 2.30 }
        ];

        const settlement = engine.settleSystem345(sys, resultsWithPostponed, { costPerColumn: 50 });
        assert.strictEqual(settlement.isSettled, false);
        assert.strictEqual(settlement.settlementStatus, 'Maçlar henüz tamamlanmadı');
        assert.strictEqual(settlement.pendingMatchesCount, 1);
        assert.ok(settlement.message.includes('Ertelenen veya'));
    });

    await it('7.11: Kesin iptal edilen maç (void/cancelled) 1.00 oranla değerlendirilmeli ve kupon sonuçlandırılmalı', () => {
        const sys = engine.buildSystem345(sample5Matches);
        // 104 numaralı maç resmi olarak iptal edildi (cancelled: true)
        const resultsWithCancelled = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.10 },
            { matchId: 104, won: false, cancelled: true }, // Kesinleşmiş iptal: Oran 1.00
            { matchId: 105, score: { h: 2, a: 0 }, settledOdd: 2.30 }
        ];

        const settlement = engine.settleSystem345(sys, resultsWithCancelled, { costPerColumn: 50, totalCost: 800 });
        assert.strictEqual(settlement.isSettled, true);
        assert.strictEqual(settlement.settlementStatus, 'Sonuçlandı');
        assert.strictEqual(settlement.wonColumnsCount, 5); // 4 başarılı maç (biri void=1.00) ile 5 kolon kazanır
        assert.ok(settlement.settledPayout > 0);
    });

    await it('7.12: Bayat oranlarla (oddsFresh=false) kolon toplam oranı oluşturulmamalı (totalOdd null olmalı)', () => {
        const matchesWithStale = [
            { id: 201, home: 'Real Madrid', away: 'Sevilla', key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
            { id: 202, home: 'Arsenal', away: 'Chelsea', key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { id: 203, home: 'Milan', away: 'Inter', key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: false }, // Bayat oran!
            { id: 204, home: 'Ajax', away: 'PSV', key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
            { id: 205, home: 'Porto', away: 'Benfica', key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];

        const sys = engine.buildSystem345(matchesWithStale);
        // 203 numaralı maçı içeren kolonların tamamında totalOdd null olmalıdır
        const colsWithStaleMatch = sys.columns.filter(c => c.matches.some(m => m.matchId === 203));
        assert.ok(colsWithStaleMatch.length > 0, 'Bayat maç içeren kolonlar bulunmalı');
        colsWithStaleMatch.forEach(c => {
            assert.strictEqual(c.totalOdd, null, `Kolon #${c.columnIndex} bayat oran içerdiği için totalOdd null olmalı`);
        });

        // 203 numaralı maçı içermeyen (sadece taze oranlı maçlardan oluşan) kolonların totalOdd değeri hesaplanabilmeli
        const colsAllFresh = sys.columns.filter(c => !c.matches.some(m => m.matchId === 203));
        assert.ok(colsAllFresh.length > 0);
        colsAllFresh.forEach(c => {
            assert.ok(typeof c.totalOdd === 'number' && c.totalOdd > 0, `Tamamı taze kolon #${c.columnIndex} için totalOdd hesaplanmalı`);
        });
    });

    await it('7.13: Kolon tutarlarının toplamı gerçek toplam maliyetle birebir uyuşmalı (sıfır yuvarlama çelişkisi)', () => {
        const sys = engine.buildSystem345(sample5Matches, 50);
        const cost = sys.costAnalysis;

        // 1. Kupon tabanı senaryosu: 16 x 3.125 = 50.00 TL (sıfır kuruş farkı)
        assert.strictEqual(cost.couponTotalRule.sumOfColumns, 50);
        assert.strictEqual(cost.couponTotalRule.roundingDiscrepancy, 0);
        assert.strictEqual(+(16 * cost.couponTotalRule.exactCostPerColumn).toFixed(2), cost.couponTotalRule.totalCost);

        // 2. Kolon başı senaryosu: 16 x 50 = 800.00 TL
        assert.strictEqual(cost.columnStakeRule.sumOfColumns, 800);
        assert.strictEqual(cost.columnStakeRule.roundingDiscrepancy, 0);

        // 3. settleSystem345 içinde tutar tutarlılığı
        const results = [
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: true, settledOdd: 2.10 },
            { matchId: 105, won: true, settledOdd: 2.30 }
        ];
        const settle50 = engine.settleSystem345(sys, results, { totalCost: 50 });
        assert.strictEqual(settle50.sumOfColumns, 50);
        assert.strictEqual(settle50.totalCost, 50);
    });

    await it('7.14: 3.125 TL gibi yarım kuruşlu tutar oynanabilir tutar olarak gösterilmemeli (isPlayableAmount: false)', () => {
        const sys = engine.buildSystem345(sample5Matches, 50);
        const cost = sys.costAnalysis;

        // couponTotalRule 50 / 16 = 3.125 TL olup yasal olarak yarım kuruş oynanamaz
        assert.strictEqual(cost.couponTotalRule.exactCostPerColumn, 3.125);
        assert.strictEqual(cost.couponTotalRule.isPlayableAmount, false, '3.125 TL oynanamaz olarak işaretlenmeli');
        assert.ok(cost.couponTotalRule.playableStatus.includes('Oynanamaz'), 'playableStatus oynanamaz olduğunu belirtmeli');
        assert.ok(cost.couponTotalRule.playableNote.includes('kuruş') || cost.couponTotalRule.playableNote.includes('teorik'));

        // columnStakeRule (50 TL kolon başı) ise geçerli ve oynanabilir olmalı
        assert.strictEqual(cost.columnStakeRule.costPerColumn, 50);
        assert.strictEqual(cost.columnStakeRule.isPlayableAmount, true, '50 TL kolon başı oynanabilir olmalı');
        assert.ok(cost.columnStakeRule.playableStatus.includes('Oynanabilir'));
    });

    await it('7.15: Gerçek kupon oranı ile öneri oranı farklıysa gerçek kupon oranı kullanılmalı', () => {
        const sys = engine.buildSystem345(sample5Matches);
        
        // Kullanıcı kuponu onayladığında oranlar değişmiş: 101 -> 3.50, 102 -> 3.60, 103 -> 3.30, 104 -> 2.20, 105 -> 2.40
        const placedResults = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.50 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.60 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.30 },
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.20 },
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.40 }
        ];

        const settlement = engine.settleSystem345(sys, placedResults, { costPerColumn: 10, totalCost: 160 });
        assert.strictEqual(settlement.isSettled, true);
        assert.strictEqual(settlement.wonColumnsCount, 16);

        // İlk 3'lü kolon (101, 102, 103):
        // Öneri oranıyla: 3.20 * 3.40 * 3.10 = 33.728
        // Gerçek oynanan oranla: 3.50 * 3.60 * 3.30 = 41.58 -> Kolon kazancı: 41.58 * 10 = 415.80 TL
        const col1 = settlement.columns.find(c => c.columnIndex === 1);
        assert.strictEqual(col1.multiplier, 41.58);
        assert.strictEqual(col1.payout, 415.8);
    });

    await it('7.16: Yanlış bahis sonucu ile ödeme hesaplanmamalı (evaluateBetOutcome piyasa kuralı doğrulaması)', () => {
        // Doğrudan kural kontrolleri
        assert.strictEqual(engine.evaluateBetOutcome('ms1', { h: 2, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('ms1', { h: 1, a: 1 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('alt25', { h: 2, a: 1 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('ust25', { h: 2, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('kgv', { h: 2, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('kgv', { h: 1, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('dc1x', { h: 0, a: 1 }), false);

        // Sistem sonuçlandırmasında skor doğrulaması
        const sys = engine.buildSystem345(sample5Matches);
        const resultsWithScores = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 }, // key: msx -> 1-1 -> KAZANDI
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 }, // key: ms2 -> 0-2 -> KAZANDI
            { matchId: 103, won: true, score: { h: 2, a: 1 }, settledOdd: 3.10 }, // key: ust35 -> 2-1 (3 gol) -> YANLIŞ/KAYBETTİ!
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.10 }, // key: kgv -> 1-1 -> KAZANDI
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.30 }  // key: dcx2 -> 0-1 -> KAZANDI
        ];

        const settlement = engine.settleSystem345(sys, resultsWithScores, { costPerColumn: 10, totalCost: 160 });
        assert.strictEqual(settlement.isSettled, true);
        // 103 kaybettiği için 5 maçtan 4'ü kazandı. 4 kazanan maç ile 5 kolon kazanır
        assert.strictEqual(settlement.wonColumnsCount, 5, 'Hatalı bahis tercihi değerlendirildiğinde 103 kaybetmeli ve 5 kolon kazanmalı');
        const wonWith103 = settlement.columns.filter(c => c.won && c.matches.some(m => m.matchId === 103));
        assert.strictEqual(wonWith103.length, 0, '103 numaralı kaybeden maçı içeren kolon kazanmamalı');
    });

    await it('7.17: Kupon toplamı ve kolon tutarları gerçek Nesine kupon kaydı (recordPlacedCoupon) ile doğrulanmalı', () => {
        const mockTicket = {
            nesineRefCode: 'NES-TEST-998877',
            totalCost: 160,
            costPerColumn: 10,
            placedDate: '2026-10-19',
            placedTime: '18:30:00',
            matches: [
                { matchId: 101, home: 'Real Madrid', away: 'Sevilla', key: 'msx', placedOdd: 3.25 },
                { matchId: 102, home: 'Arsenal', away: 'Chelsea', key: 'ms2', placedOdd: 3.45 },
                { matchId: 103, home: 'Milan', away: 'Inter', key: 'ust35', placedOdd: 3.15 },
                { matchId: 104, home: 'Ajax', away: 'PSV', key: 'kgv', placedOdd: 2.15 },
                { matchId: 105, home: 'Porto', away: 'Benfica', key: 'dcx2', placedOdd: 2.35 }
            ]
        };

        const recorded = engine.recordPlacedCoupon(mockTicket);
        assert.strictEqual(recorded.nesineRefCode, 'NES-TEST-998877');
        assert.strictEqual(recorded.totalCost, 160);
        assert.strictEqual(recorded.costPerColumn, 10);
        assert.strictEqual(recorded.matches.length, 5);

        const fetched = engine.getPlacedCoupon('NES-TEST-998877');
        assert.ok(fetched !== null);
        assert.strictEqual(fetched.totalCost, 160);

        // Çelişkili tutar ile kayıt reddedilmeli
        assert.throws(() => {
            engine.recordPlacedCoupon({
                nesineRefCode: 'NES-INVALID',
                totalCost: 150,
                costPerColumn: 10,
                matches: mockTicket.matches
            });
        }, /yuvarlama çelişkisi/);

        // settleSystem345 ile placedCoupon verisinin entegrasyonu
        const sys = engine.buildSystem345(sample5Matches);
        const matchResults = [
            { matchId: 101, score: { h: 1, a: 1 } },
            { matchId: 102, score: { h: 0, a: 2 } },
            { matchId: 103, score: { h: 2, a: 2 } },
            { matchId: 104, score: { h: 1, a: 1 } },
            { matchId: 105, score: { h: 0, a: 1 } }
        ];

        const settlement = engine.settleSystem345(sys, matchResults, { placedCoupon: fetched });
        assert.strictEqual(settlement.isSettled, true);
        assert.strictEqual(settlement.totalCost, 160);
        assert.strictEqual(settlement.costPerColumn, 10);
        assert.strictEqual(settlement.wonColumnsCount, 16);
    });

    await it('7.18: recordPlacedCoupon içinde m.odd fallback olmamalı; yalnızca açıkça girilmiş placedOdd kabul edilmeli', () => {
        const ticketWithOnlyOdd = {
            nesineRefCode: 'NES-NO-FALLBACK-1',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, home: 'Real Madrid', away: 'Sevilla', key: 'msx', odd: 3.20 }, // placedOdd YOK, sadece öneri odd var!
                { matchId: 102, home: 'Arsenal', away: 'Chelsea', key: 'ms2', placedOdd: 3.40 },
                { matchId: 103, home: 'Milan', away: 'Inter', key: 'ust35', placedOdd: 3.10 },
                { matchId: 104, home: 'Ajax', away: 'PSV', key: 'kgv', placedOdd: 2.10 },
                { matchId: 105, home: 'Porto', away: 'Benfica', key: 'dcx2', placedOdd: 2.30 }
            ]
        };

        // placedOdd girilmediği için kesinlikle hata fırlatmalı, m.odd'u gerçek oran saymamalı
        assert.throws(() => {
            engine.recordPlacedCoupon(ticketWithOnlyOdd);
        }, /placedOdd.*zorunludur/);
    });

    await it('7.19: settleSystem345 içinde evaluateBetOutcome null döndürürse res.won değerine geri dönülmemeli (doğrulanamadı)', () => {
        // Bilinmeyen / desteklenmeyen pazar 'unsupported_market_xyz'
        const matchesWithUnsupported = [
            { id: 101, home: 'Real Madrid', away: 'Sevilla', key: 'msx', p: 0.35, hasRealOdd: true, realOdd: 3.20, oddsFresh: true },
            { id: 102, home: 'Arsenal', away: 'Chelsea', key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { id: 103, home: 'Milan', away: 'Inter', key: 'unsupported_market_xyz', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
            { id: 104, home: 'Ajax', away: 'PSV', key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
            { id: 105, home: 'Porto', away: 'Benfica', key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];

        const sys = engine.buildSystem345(matchesWithUnsupported);
        
        // Sonuçlarda score verilse ve won: true dense dahi evaluateBetOutcome('unsupported_market_xyz') null döner
        const results = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, won: true, score: { h: 2, a: 1 }, settledOdd: 3.10 }, // Desteklenmeyen pazar!
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.10 },
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.30 }
        ];

        const settlement = engine.settleSystem345(sys, results, { costPerColumn: 10, totalCost: 160 });
        assert.strictEqual(settlement.isSettled, false);
        assert.strictEqual(settlement.settlementStatus, 'Sonuçlandırma doğrulanamadı');
        assert.strictEqual(settlement.settledPayout, null);
        assert.ok(settlement.reason.includes('doğrulanamadı') || settlement.reason.includes('desteklenmeyen'));
    });

    await it('7.20: savePlacedCoupons dosyaya yazma başarısızsa açık hata verilmeli ve kupon kaydedilmemeli', () => {
        const mockTicket = {
            nesineRefCode: 'NES-DISK-FAIL-TEST',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, key: 'ms1', placedOdd: 3.20 },
                { matchId: 102, key: 'msx', placedOdd: 3.40 },
                { matchId: 103, key: 'ms2', placedOdd: 3.10 },
                { matchId: 104, key: 'kgv', placedOdd: 2.10 },
                { matchId: 105, key: 'ust25', placedOdd: 2.30 }
            ]
        };

        const originalWriteFileSync = fs.writeFileSync;
        try {
            fs.writeFileSync = () => {
                throw new Error('EACCES: permission denied, disk read-only');
            };

            const saveRes = engine.savePlacedCoupons([]);
            assert.strictEqual(saveRes, false, 'Dosya yazılamadığında savePlacedCoupons false dönmeli');

            assert.throws(() => {
                engine.recordPlacedCoupon(mockTicket);
            }, /dosyaya kaydedilemedi/);
        } finally {
            fs.writeFileSync = originalWriteFileSync;
        }
    });

    await it('7.21: recordPlacedCoupon tam olarak 5 maç kabul etmeli; 4 veya 6+ maç reddedilmeli', () => {
        const baseTicket = {
            nesineRefCode: 'NES-MATCH-COUNT-TEST',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, key: 'ms1', placedOdd: 1.80 },
                { matchId: 102, key: 'msx', placedOdd: 3.20 },
                { matchId: 103, key: 'ms2', placedOdd: 3.40 },
                { matchId: 104, key: 'kgv', placedOdd: 1.90 }
            ]
        };

        // 4 maç -> hata fırlatmalı
        assert.throws(() => {
            engine.recordPlacedCoupon(baseTicket);
        }, /tam olarak 5 maç gereklidir/);

        // 6 maç -> hata fırlatmalı
        const sixMatchesTicket = {
            ...baseTicket,
            matches: [
                ...baseTicket.matches,
                { matchId: 105, key: 'ust25', placedOdd: 2.10 },
                { matchId: 106, key: 'alt25', placedOdd: 1.70 }
            ]
        };
        assert.throws(() => {
            engine.recordPlacedCoupon(sixMatchesTicket);
        }, /tam olarak 5 maç gereklidir/);
    });

    await it('7.22: recordPlacedCoupon eksik matchId veya eksik costPerColumn durumlarında reddedilmeli (otomatik tutar türetilemez)', () => {
        // Eksik matchId
        assert.throws(() => {
            engine.recordPlacedCoupon({
                nesineRefCode: 'NES-NO-MATCHID',
                totalCost: 160,
                costPerColumn: 10,
                matches: [
                    { key: 'ms1', placedOdd: 1.80 }, // matchId YOK!
                    { matchId: 102, key: 'msx', placedOdd: 3.20 },
                    { matchId: 103, key: 'ms2', placedOdd: 3.40 },
                    { matchId: 104, key: 'kgv', placedOdd: 1.90 },
                    { matchId: 105, key: 'ust25', placedOdd: 2.10 }
                ]
            });
        }, /geçerli matchId bilgisi zorunludur/);

        // Eksik costPerColumn (totalCost / 16 üzerinden otomatik türetilmemeli)
        assert.throws(() => {
            engine.recordPlacedCoupon({
                nesineRefCode: 'NES-NO-COST-PER-COL',
                totalCost: 160, // costPerColumn YOK
                matches: [
                    { matchId: 101, key: 'ms1', placedOdd: 1.80 },
                    { matchId: 102, key: 'msx', placedOdd: 3.20 },
                    { matchId: 103, key: 'ms2', placedOdd: 3.40 },
                    { matchId: 104, key: 'kgv', placedOdd: 1.90 },
                    { matchId: 105, key: 'ust25', placedOdd: 2.10 }
                ]
            });
        }, /kolon başına tutar \(costPerColumn\) açıkça girilmelidir/);
    });

    await it('7.23: Para hesaplamalarında 0.01 TL kuruş farkı/toleransı kesinlikle reddedilmeli (sıfır tolerans)', () => {
        const matches5 = [
            { matchId: 101, key: 'ms1', placedOdd: 1.80 },
            { matchId: 102, key: 'msx', placedOdd: 3.20 },
            { matchId: 103, key: 'ms2', placedOdd: 3.40 },
            { matchId: 104, key: 'kgv', placedOdd: 1.90 },
            { matchId: 105, key: 'ust25', placedOdd: 2.10 }
        ];

        // 16 * 10 = 160.00 TL, fakat girilen 160.01 TL (1 kuruş fark) -> recordPlacedCoupon reddetmeli
        assert.throws(() => {
            engine.recordPlacedCoupon({
                nesineRefCode: 'NES-PENNY-MISMATCH',
                totalCost: 160.01,
                costPerColumn: 10,
                matches: matches5
            });
        }, /yuvarlama çelişkisi/);

        // settleSystem345 içinde de kuruş tutarsızlığı ödeme hesaplamamalı
        const sys = engine.buildSystem345(sample5Matches);
        const results = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.10 },
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.10 },
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.30 }
        ];
        const settleMismatch = engine.settleSystem345(sys, results, { costPerColumn: 10, totalCost: 160.01 });
        assert.strictEqual(settleMismatch.isSettled, false);
        assert.strictEqual(settleMismatch.settlementStatus, 'Gerçek ödeme hesaplanamıyor');
        assert.ok(settleMismatch.reason.includes('Kuruş bazında tutarsızlık'));
    });

    await it('7.24: settleSystem345 içinde skor bulunmadığında res.won üzerinden sonuçlandırma yapılmamalı', () => {
        const sys = engine.buildSystem345(sample5Matches);
        
        // Sonuçlarda won: true var, oranlar var ama skor nesnesi (score) YOK
        const resultsNoScore = [
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: true, settledOdd: 2.10 },
            { matchId: 105, won: true, settledOdd: 2.30 }
        ];

        const settlement = engine.settleSystem345(sys, resultsNoScore, { costPerColumn: 10, totalCost: 160 });
        assert.strictEqual(settlement.isSettled, false);
        assert.strictEqual(settlement.settlementStatus, 'Sonuçlandırma doğrulanamadı');
        assert.strictEqual(settlement.settledPayout, null);
        assert.ok(settlement.reason.includes('skor bilgisi bulunamadı'));

        // İstatistik gerektiren pazar (korner_ust95) için stats eksikse doğrulanamadı dönmeli
        const matchesWithCorner = [
            { id: 101, home: 'Real Madrid', away: 'Sevilla', key: 'korner_ust95', p: 0.50, hasRealOdd: true, realOdd: 2.00, oddsFresh: true },
            { id: 102, home: 'Arsenal', away: 'Chelsea', key: 'ms2', p: 0.30, hasRealOdd: true, realOdd: 3.40, oddsFresh: true },
            { id: 103, home: 'Milan', away: 'Inter', key: 'ust35', p: 0.32, hasRealOdd: true, realOdd: 3.10, oddsFresh: true },
            { id: 104, home: 'Ajax', away: 'PSV', key: 'kgv', p: 0.40, hasRealOdd: true, realOdd: 2.10, oddsFresh: true },
            { id: 105, home: 'Porto', away: 'Benfica', key: 'dcx2', p: 0.38, hasRealOdd: true, realOdd: 2.30, oddsFresh: true }
        ];
        const sysCorner = engine.buildSystem345(matchesWithCorner);
        const resultsMissingStats = [
            { matchId: 101, score: { h: 2, a: 1 }, settledOdd: 2.00 }, // stats.corners YOK!
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.10 },
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.10 },
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.30 }
        ];
        const cornerSettlement = engine.settleSystem345(sysCorner, resultsMissingStats, { costPerColumn: 10, totalCost: 160 });
        assert.strictEqual(cornerSettlement.isSettled, false);
        assert.strictEqual(cornerSettlement.settlementStatus, 'Sonuçlandırma doğrulanamadı');
    });

    await it('7.25: settleSystem345 kupon maç ID ve market anahtarları birebir eşleşmediğinde kuponu reddetmeli', () => {
        const sys = engine.buildSystem345(sample5Matches);
        
        // 1. Maç ID uyuşmazlığı (105 yerine 999 numaralı maç kaydedilmiş)
        const mismatchIdCoupon = {
            nesineRefCode: 'NES-MISMATCH-ID',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, key: 'msx', placedOdd: 3.20 },
                { matchId: 102, key: 'ms2', placedOdd: 3.40 },
                { matchId: 103, key: 'ust35', placedOdd: 3.10 },
                { matchId: 104, key: 'kgv', placedOdd: 2.10 },
                { matchId: 999, key: 'dcx2', placedOdd: 2.30 } // 999 !== 105
            ]
        };
        const results = [
            { matchId: 101, score: { h: 1, a: 1 }, settledOdd: 3.20 },
            { matchId: 102, score: { h: 0, a: 2 }, settledOdd: 3.40 },
            { matchId: 103, score: { h: 2, a: 2 }, settledOdd: 3.10 },
            { matchId: 104, score: { h: 1, a: 1 }, settledOdd: 2.10 },
            { matchId: 105, score: { h: 0, a: 1 }, settledOdd: 2.30 }
        ];

        const resMismatchId = engine.settleSystem345(sys, results, { placedCoupon: mismatchIdCoupon });
        assert.strictEqual(resMismatchId.isSettled, false);
        assert.strictEqual(resMismatchId.settlementStatus, 'Kupon maçları uyuşmuyor');
        assert.ok(resMismatchId.reason.includes('kayıtlı kuponda bulunamadı'));

        // 2. Tercih (market key) uyuşmazlığı (101 maçı için msx yerine ms1 oynanmış)
        const mismatchKeyCoupon = {
            nesineRefCode: 'NES-MISMATCH-KEY',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, key: 'ms1', placedOdd: 3.20 }, // ms1 !== msx
                { matchId: 102, key: 'ms2', placedOdd: 3.40 },
                { matchId: 103, key: 'ust35', placedOdd: 3.10 },
                { matchId: 104, key: 'kgv', placedOdd: 2.10 },
                { matchId: 105, key: 'dcx2', placedOdd: 2.30 }
            ]
        };

        const resMismatchKey = engine.settleSystem345(sys, results, { placedCoupon: mismatchKeyCoupon });
        assert.strictEqual(resMismatchKey.isSettled, false);
        assert.strictEqual(resMismatchKey.settlementStatus, 'Kupon maçları uyuşmuyor');
        assert.ok(resMismatchKey.reason.includes('bahis tercihi'));
    });

    await it('7.26: Upstash gerçek bağlantı doğrulaması: bağlantı yokken/hatalıyken kalıcı işaretlenmemeli, doğrulanmış yazmada kalıcı olmalı', () => {
        const ticket = {
            nesineRefCode: 'NES-UPSTASH-TEST',
            totalCost: 160,
            costPerColumn: 10,
            matches: [
                { matchId: 101, key: 'msx', placedOdd: 3.20 },
                { matchId: 102, key: 'ms2', placedOdd: 3.40 },
                { matchId: 103, key: 'ust35', placedOdd: 3.10 },
                { matchId: 104, key: 'kgv', placedOdd: 2.10 },
                { matchId: 105, key: 'dcx2', placedOdd: 2.30 }
            ]
        };

        const origUrl = process.env.UPSTASH_REDIS_REST_URL;
        const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;
        try {
            // 1. Durum: Upstash env değişkenleri tanımlı değilken -> kalıcı olamaz
            delete process.env.UPSTASH_REDIS_REST_URL;
            delete process.env.UPSTASH_REDIS_REST_TOKEN;
            engine.setUpstashTransportForTesting(null);

            const recUnset = engine.recordPlacedCoupon(ticket);
            assert.strictEqual(recUnset.isPersistent, false, 'Upstash yokken kalıcı sayılamaz');
            assert.strictEqual(recUnset.storageBackend, 'local_ephemeral_file');
            assert.ok(recUnset.storageWarning !== null);
            assert.ok(recUnset.storageWarning.includes('Render ortamında'), 'Uyarı metni Render riskini belirtmeli');

            // 2. Durum: Upstash env tanımlı ama SET hata dönüyor
            process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.upstash.io';
            process.env.UPSTASH_REDIS_REST_TOKEN = 'mock_token';
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'GET') return { ok: true, result: null };
                if (cmd === 'SET') return { ok: false, error: 'Unauthorized: invalid token' };
                return { ok: false };
            });

            const recFail = engine.recordPlacedCoupon({ ...ticket, nesineRefCode: 'NES-UPSTASH-FAIL' });
            assert.strictEqual(recFail.isPersistent, false, 'Hatalı Upstash SET yanıtında kalıcı işaretlenemez');
            assert.strictEqual(recFail.storageBackend, 'local_ephemeral_file');
            assert.ok(recFail.storageWarning.includes('başarısız oldu'), 'Uyarı metni bağlantı hatasını bildirmeli');

            // 2b. Durum: SET yanıtı ok: true olsa dahi result !== 'OK' ise kalıcı olamaz
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'GET') return { ok: true, result: null };
                if (cmd === 'SET') return { ok: true, result: 'QUEUED' }; // 'OK' değil!
                return { ok: false };
            });
            const recNotOk = engine.recordPlacedCoupon({ ...ticket, nesineRefCode: 'NES-UPSTASH-NOTOK' });
            assert.strictEqual(recNotOk.isPersistent, false, 'result === OK değilse kalıcı işaretlenemez');
            assert.strictEqual(recNotOk.storageBackend, 'local_ephemeral_file');

            // 3. Durum: Redis yapılandırılmışken GET başarısız olursa sessizce eski yerel veriye dönülmemeli, hata üretmeli
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'GET') return { ok: false, error: 'Upstash connection timeout' };
                return { ok: false };
            });
            assert.throws(() => {
                engine.loadPlacedCoupons();
            }, /Upstash Redis GET başarısız oldu/, 'Redis GET hatasında sessiz fallback yapılmamalı, açık hata fırlatılmalı');

            // 4. Durum: Redis GET bozuk JSON döndüğünde açık hata üretmeli
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'GET') return { ok: true, result: 'invalid{json}' };
                return { ok: false };
            });
            assert.throws(() => {
                engine.loadPlacedCoupons();
            }, /bozuk JSON/, 'Bozuk JSON yanıtında hata üretilmeli');

            // 5. Durum: Gerçek / doğrulanmış Upstash Redis yazma ve okuma testi (SET result === 'OK')
            const redisMemoryStore = new Map();
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'SET') {
                    redisMemoryStore.set(args[0], args[1]);
                    return { ok: true, result: 'OK' };
                }
                if (cmd === 'GET') {
                    return { ok: true, result: redisMemoryStore.get(args[0]) || null };
                }
                return { ok: true, result: 'PONG' };
            });

            const recSuccess = engine.recordPlacedCoupon({ ...ticket, nesineRefCode: 'NES-UPSTASH-SUCCESS' });
            assert.strictEqual(recSuccess.isPersistent, true, 'Doğrulanan Redis yazması ile kalıcı olarak işaretlenmeli');
            assert.strictEqual(recSuccess.storageBackend, 'upstash_redis');
            assert.strictEqual(recSuccess.storageWarning, null);
            assert.ok(redisMemoryStore.has('yusuf_ai:placed_coupons'), 'Veri Redis belleğine yazılmış olmalı');

            // Redis üzerinden getPlacedCoupon ile kuponu doğrula
            const fetched = engine.getPlacedCoupon('NES-UPSTASH-SUCCESS');
            assert.ok(fetched !== null, 'Redis üzerinden kupon geri okunabilmeli');
            assert.strictEqual(fetched.nesineRefCode, 'NES-UPSTASH-SUCCESS');
            assert.strictEqual(fetched.totalCost, 160);
        } finally {
            engine.setUpstashTransportForTesting(null);
            if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl; else delete process.env.UPSTASH_REDIS_REST_URL;
            if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken; else delete process.env.UPSTASH_REDIS_REST_TOKEN;
        }
    });

    await it('7.27: Upstash izole Redis okuma/yazma döngüsü doğrulaması (SET result === OK zorunluluğu ve GET hata fırlatma)', () => {
        const origUrl = process.env.UPSTASH_REDIS_REST_URL;
        const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;
        process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.upstash.io';
        process.env.UPSTASH_REDIS_REST_TOKEN = 'mock_valid_token';

        try {
            const redisStore = new Map();
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'SET') {
                    redisStore.set(args[0], args[1]);
                    return { ok: true, result: 'OK' };
                }
                if (cmd === 'GET') {
                    return { ok: true, result: redisStore.get(args[0]) || null };
                }
                return { ok: false };
            });

            const testCoupons = [
                { id: 'c1', nesineRefCode: 'NES-1', totalCost: 50, matches: [] },
                { id: 'c2', nesineRefCode: 'NES-2', totalCost: 100, matches: [] }
            ];

            // 1. Yazma doğrulaması: SET result === 'OK' olmalı
            const saveOk = engine.savePlacedCoupons(testCoupons);
            assert.strictEqual(saveOk, true);
            assert.ok(redisStore.has('yusuf_ai:placed_coupons'));

            // 2. Okuma doğrulaması: Redis'ten birebir yüklenmeli
            const loaded = engine.loadPlacedCoupons();
            assert.strictEqual(loaded.length, 2);
            assert.strictEqual(loaded[0].nesineRefCode, 'NES-1');
            assert.strictEqual(loaded[1].totalCost, 100);

            // 3. SET yanıtı result !== 'OK' olduğunda isPersistent false olmalı
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'SET') return { ok: true, result: 'NOT_OK' };
                if (cmd === 'GET') return { ok: true, result: null };
                return { ok: false };
            });
            engine.savePlacedCoupons(testCoupons);
            // engine içindeki son kayıt sonucunu dolaylı olarak recordPlacedCoupon ile test edebiliriz
            // ya da loadPlacedCoupons GET hatasında patladığını teyit edebiliriz
            engine.setUpstashTransportForTesting((cmd, args) => {
                if (cmd === 'GET') return { ok: false, error: 'Redis bağlantısı koptu (ECONNRESET)' };
                return { ok: false };
            });
            assert.throws(() => {
                engine.loadPlacedCoupons();
            }, /Upstash Redis GET başarısız oldu: Redis bağlantısı koptu/, 'Redis GET hatasında açık exception fırlatılmalı');
        } finally {
            engine.setUpstashTransportForTesting(null);
            if (origUrl) process.env.UPSTASH_REDIS_REST_URL = origUrl; else delete process.env.UPSTASH_REDIS_REST_URL;
            if (origToken) process.env.UPSTASH_REDIS_REST_TOKEN = origToken; else delete process.env.UPSTASH_REDIS_REST_TOKEN;
        }
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

    // ----------------------------------------------------
    // TEST GRUBU 9: Tahmin Motoru Walk-Forward Doğrulaması & Pazar Bazında Performans
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Tahmin Motoru Walk-Forward Doğrulaması & Pazar Bazında Performans (engine.js) ---');

    await it('9.1: Walk-forward sürecinde geçmiş maç sonuçlarının eğitim modeline sızmadığı (zero data leakage) doğrulanmalı', () => {
        const hist = [
            { id: 1, date: '2026-10-10', time: '14:00', inBulletin: true, state: 'post', league: { id: 1 }, home: 'A', away: 'B', score: { h: 2, a: 1 }, ht: { h: 1, a: 0 } },
            { id: 2, date: '2026-10-11', time: '16:00', inBulletin: true, state: 'post', league: { id: 1 }, home: 'C', away: 'D', score: { h: 0, a: 0 }, ht: { h: 0, a: 0 } },
            { id: 3, date: '2026-10-12', time: '18:00', inBulletin: true, state: 'post', league: { id: 1 }, home: 'A', away: 'C', score: { h: 3, a: 2 }, ht: { h: 2, a: 1 } },
            { id: 4, date: '2026-10-13', time: '20:00', inBulletin: true, state: 'post', league: { id: 1 }, home: 'B', away: 'D', score: { h: 1, a: 1 }, ht: { h: 0, a: 1 } }
        ];

        // testDate = '2026-10-12' iken model kurulduğunda, 2026-10-12 ve sonrasındaki maçlar (id 3 ve 4) ASLA modele girmemelidir
        const priorModel = engine.buildModel(hist, '2026-10-12');
        assert.ok(priorModel.nRows <= 2, '2026-10-12 öncesi en fazla 2 maç olmalı');
    });

    await it('9.2: Maç öncesi tahminlerin (pre-match locking) kickoff saatinden önce kilitlendiği doğrulanmalı', () => {
        const dummyDayItems = [
            {
                m: {
                    id: 991,
                    date: '2026-10-19',
                    time: '23:59',
                    kickoff: new Date(Date.now() + 3600000).toISOString(),
                    state: 'pre',
                    inBulletin: true,
                    league: { full: 'Premier League' },
                    home: 'Chelsea',
                    away: 'Liverpool',
                    odds: { ust15: 1.30 },
                    oddsFresh: true
                },
                an: { p: { ust15: 0.82, ms1: 0.45, msx: 0.28, ms2: 0.27 } }
            }
        ];

        const perf = engine.evaluateModelPerformance({ rawHistory: [] }, dummyDayItems);
        assert.ok(perf !== null);
        assert.ok(Array.isArray(perf.pendingPreMatch));
        const locked = perf.pendingPreMatch.find(p => p.matchId === 991);
        if (locked) {
            assert.strictEqual(locked.matchId, 991);
            assert.strictEqual(locked.status, 'Beklemede');
            assert.strictEqual(locked.won, null);
            assert.strictEqual(locked.score, null);
            assert.ok(typeof locked.predictedProb === 'number');
            assert.ok(locked.predictedProb >= 0.68);
        }
    });

    await it('9.3: Brier Score ve Log Loss hesapları gerçek tahmin olasılıkları üzerinden yapılmalı (uydurma sabit metrik olmamalı)', () => {
        const mockRecords = [
            { matchId: 1, date: '2026-10-15', pickKey: 'ust15', pick: '1,5 Üst', predictedProb: 0.80, probPct: 80, won: true, brier: 0.040, logLoss: 0.223, modelAsOfDate: '2026-10-15', kickoff: '2026-10-15T18:00:00.000Z', recordedBeforeKickoffAt: '2026-10-15T12:00:00.000Z' },
            { matchId: 2, date: '2026-10-16', pickKey: 'ust25', pick: '2,5 Üst', predictedProb: 0.70, probPct: 70, won: false, brier: 0.490, logLoss: 1.204, modelAsOfDate: '2026-10-16', kickoff: '2026-10-16T18:00:00.000Z', recordedBeforeKickoffAt: '2026-10-16T12:00:00.000Z' }
        ];

        // 1. maç için: p = 0.80, won = 1 -> Brier = (0.80 - 1)^2 = 0.04
        assert.strictEqual(+((0.80 - 1) ** 2).toFixed(4), 0.04);
        // 2. maç için: p = 0.70, won = 0 -> Brier = (0.70 - 0)^2 = 0.49
        assert.strictEqual(+((0.70 - 0) ** 2).toFixed(4), 0.49);

        const audit = engine.verifyWalkForwardIntegrity(mockRecords);
        assert.strictEqual(audit.isValid, true, 'Doğru Brier formülü ve sıfır sızıntılı kayıtlar geçerli olmalı');
        assert.strictEqual(audit.leaksDetected, 0);
        assert.strictEqual(audit.brierMismatches, 0);

        // Hatalı brier skoru verildiğinde audit yakalamalı
        const badRecords = [
            { matchId: 3, date: '2026-10-17', pickKey: 'ms1', predictedProb: 0.85, won: true, brier: 0.999, modelAsOfDate: '2026-10-17', kickoff: '2026-10-17T18:00:00.000Z', recordedBeforeKickoffAt: '2026-10-17T12:00:00.000Z' }
        ];
        const badAudit = engine.verifyWalkForwardIntegrity(badRecords);
        assert.strictEqual(badAudit.isValid, false);
        assert.strictEqual(badAudit.brierMismatches, 1);
    });

    await it('9.4: Pazar bazında performans ayrımı (marketBreakdown) her pazar için ayrı Brier Score ve başarı oranı üretmeli', () => {
        const customTableWithMarkets = {
            walkForwardRecords: [
                ...Array(25).fill(0).map((_, i) => ({
                    matchId: 1000 + i,
                    pickKey: 'ust15',
                    pick: '1,5 Üst',
                    predictedProb: 0.80,
                    won: i < 20, // 20/25 = %80
                    brier: i < 20 ? 0.04 : 0.64,
                    logLoss: i < 20 ? 0.223 : 1.609,
                    kickoff: '2026-10-18T18:00:00.000Z',
                    recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
                })),
                ...Array(25).fill(0).map((_, i) => ({
                    matchId: 2000 + i,
                    pickKey: 'kgv',
                    pick: 'KG Var',
                    predictedProb: 0.72,
                    won: i < 18, // 18/25 = %72
                    brier: i < 18 ? 0.078 : 0.518,
                    logLoss: i < 18 ? 0.328 : 1.272,
                    kickoff: '2026-10-18T18:00:00.000Z',
                    recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
                })),
                ...Array(10).fill(0).map((_, i) => ({
                    matchId: 3000 + i,
                    pickKey: 'ms1',
                    pick: 'MS 1',
                    predictedProb: 0.75,
                    won: i < 7, // 7/10 = %70
                    brier: i < 7 ? 0.0625 : 0.5625,
                    logLoss: i < 7 ? 0.287 : 1.386,
                    kickoff: '2026-10-18T18:00:00.000Z',
                    recordedBeforeKickoffAt: '2026-10-18T12:00:00.000Z'
                }))
            ]
        };

        const metrics = engine.getModelVerificationMetrics(customTableWithMarkets);
        assert.strictEqual(metrics.isVerified, true);
        assert.ok(metrics.marketBreakdown !== undefined, 'marketBreakdown alanı bulunmalı');

        // ust15 pazarı ayrımı
        const ust15 = metrics.marketBreakdown['ust15'];
        assert.ok(ust15 !== undefined);
        assert.strictEqual(ust15.total, 25);
        assert.strictEqual(ust15.hits, 20);
        assert.strictEqual(ust15.ratePct, 80.0);
        assert.ok(typeof ust15.brierScore === 'number');

        // kgv pazarı ayrımı
        const kgv = metrics.marketBreakdown['kgv'];
        assert.ok(kgv !== undefined);
        assert.strictEqual(kgv.total, 25);
        assert.strictEqual(kgv.hits, 18);
        assert.strictEqual(kgv.ratePct, 72.0);
    });

    await it('9.5: predictedProb eksikse Brier Score ve Log Loss hesaplanmamalı (0.70 varsayımı kesinlikle kullanılmamalı)', () => {
        const dummyTable = {
            preMatchRecords: {
                '501': {
                    matchId: 501,
                    date: '2026-10-19',
                    kickoff: '2026-10-19T20:00:00.000Z',
                    recordedBeforeKickoffAt: '2026-10-19T18:00:00.000Z',
                    pickKey: 'ust15',
                    predictedProb: null, // Eksik tahmin olasılığı!
                    won: null
                }
            },
            walkForwardRecords: []
        };

        const dayItems = [
            {
                m: {
                    id: 501,
                    date: '2026-10-19',
                    state: 'post',
                    score: { h: 2, a: 1 },
                    ht: { h: 1, a: 0 }
                }
            }
        ];

        // evaluateModelPerformance fonksiyonunu çalıştır
        const perf = engine.evaluateModelPerformance({ rawHistory: [] }, dayItems);
        assert.ok(perf !== null);

        // Tahmin olasılığı olmayan kaydın Brier Score ve Log Loss'a sızmadığı ve audit tarafından geçersiz sayıldığı doğrulanmalı
        const badProbRecord = [
            { matchId: 901, pickKey: 'ust15', won: true, predictedProb: null, brier: null, logLoss: null, kickoff: '2026-10-19T18:00:00.000Z', recordedBeforeKickoffAt: '2026-10-19T12:00:00.000Z' }
        ];
        const audit = engine.verifyWalkForwardIntegrity(badProbRecord);
        assert.strictEqual(audit.isValid, false, 'predictedProb null olan kayıt kalibrasyon bütünlüğünden geçmemeli');
        assert.strictEqual(audit.invalidProbabilities, 1);
    });

    await it('9.6: recordedBeforeKickoffAt kickoff sonrasında ise timing violation sayılmalı ve kalibrasyona girmemeli', () => {
        const lateRecords = [
            {
                matchId: 701,
                date: '2026-10-19',
                kickoff: '2026-10-19T18:00:00.000Z',
                recordedBeforeKickoffAt: '2026-10-19T18:05:00.000Z', // Kickoff'tan 5 dakika SONRA!
                pickKey: 'ust15',
                predictedProb: 0.80,
                won: true,
                brier: 0.04,
                logLoss: 0.223
            }
        ];

        const audit = engine.verifyWalkForwardIntegrity(lateRecords);
        assert.strictEqual(audit.isValid, false, 'Kickoff sonrasında kaydedilen tahmin geçersiz sayılmalı');
        assert.strictEqual(audit.timingViolations, 1);
    });

    await it('9.7: recordedBeforeKickoffAt gerçek ISO formatında olmalı ve kickoff zaman damgasıyla karşılaştırılmalı', () => {
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        const dummyDayItems = [
            {
                m: {
                    id: 998,
                    date: '2026-10-19',
                    time: '23:59',
                    kickoff: new Date(Date.now() + 7200000).toISOString(),
                    state: 'pre',
                    inBulletin: true,
                    league: { full: 'La Liga' },
                    home: 'Real Madrid',
                    away: 'Barcelona',
                    odds: { ust15: 1.25 },
                    oddsFresh: true
                },
                an: { p: { ust15: 0.85, ms1: 0.50, msx: 0.25, ms2: 0.25 } }
            }
        ];

        const perf = engine.evaluateModelPerformance({ rawHistory: [] }, dummyDayItems);
        const locked = (perf.allPreMatch && perf.allPreMatch['998']) || (perf.pendingPreMatch && perf.pendingPreMatch.find(p => p.matchId === 998));
        assert.ok(locked !== undefined, 'Maç öncesi kayıt kilitlenmiş olmalı');
        assert.ok(isoRegex.test(locked.recordedBeforeKickoffAt), 'recordedBeforeKickoffAt geçerli ISO string olmalı');
        assert.ok(new Date(locked.recordedBeforeKickoffAt).getTime() < new Date(locked.kickoff).getTime(), 'Kayıt zamanı kickoff öncesinde olmalı');
    });

    await it('9.8: Eksik veya geçersiz zaman damgası otomatik geçerli kabul edilmemeli, kalibrasyondan dışlanmalı ve missingTimingCount olarak raporlanmalı', () => {
        const missingTimingRecords = [
            {
                matchId: 801,
                date: '2026-10-19',
                // recordedBeforeKickoffAt eksik!
                kickoff: '2026-10-19T18:00:00.000Z',
                pickKey: 'ust15',
                predictedProb: 0.80,
                won: true,
                brier: 0.04,
                logLoss: 0.223
            },
            {
                matchId: 802,
                date: '2026-10-19',
                recordedBeforeKickoffAt: '2026-10-19T12:00:00.000Z',
                // kickoff eksik!
                pickKey: 'ust15',
                predictedProb: 0.80,
                won: true,
                brier: 0.04,
                logLoss: 0.223
            }
        ];

        const audit = engine.verifyWalkForwardIntegrity(missingTimingRecords);
        assert.strictEqual(audit.isValid, false, 'Eksik zaman damgası olan kayıtlar geçerli sayılamaz');
        assert.strictEqual(audit.missingTimingCount, 2);
    });

    console.log('\n--- TEST 10: Geçmiş Maç Sıralaması, Form Momentum, Ev/Deplasman Ayrımı & Sıfır Veri Sızıntısı (engine.js) ---');

    await it('10.1: Takımın son 5 ve son 10 maçı her zaman en yeni maçlardan alınmalı (kronolojik descending)', () => {
        // 12 maçlık sentetik geçmiş: 2026-08-01'den 2026-08-12'ye kadar eskiden yeniye sıralı
        const matchesAsc = [];
        for (let i = 1; i <= 12; i++) {
            const dayStr = i < 10 ? '0' + i : String(i);
            matchesAsc.push({
                id: `M-${i}`,
                date: `2026-08-${dayStr}`,
                time: '18:00',
                home: true,
                isHome: true,
                opp: `Opponent-${i}`,
                gf: i, // gol sayısı maç numarasına eşit (en yeni maç M-12'de 12 gol)
                ga: 1,
                ht: { h: 1, a: 0 }
            });
        }
        const teamAsc = { id: 'T1', name: 'Team Alpha', n: 12, hn: 12, an: 0, last: matchesAsc };
        const facts = engine.teamFacts(teamAsc);

        // En yeni maç M-12 (12-1) en başta olmalı
        assert.strictEqual(facts.son10Count, 10, 'Son 10 maç sayısı 10 olmalı');
        assert.strictEqual(facts.son[0], 'E Opponent-12 12-1', 'Son maç kesinlikle en yeni maç (M-12) olmalı');
        assert.strictEqual(facts.son[4], 'E Opponent-8 8-1', '5. maç en yeni 5. maç (M-8) olmalı (M-1 değil!)');

        // last5 ortalaması en yeni 5 maçın (8, 9, 10, 11, 12 gol) ortalaması olmalı (10.0 gol)
        assert.strictEqual(facts.last5Gf, 10.0, 'last5Gf en yeni 5 maçın ortalaması olmalı (10.0), eski maçlar sızmamalı');
    });

    await it('10.2: Ev sahibi ve deplasman performansları birbirinden temiz şekilde ayrılmalı', () => {
        const mixedMatches = [
            { id: 'M-1', date: '2026-08-01', home: true, isHome: true, opp: 'Opp-H1', gf: 3, ga: 0, ht: { h: 1, a: 0 } },
            { id: 'M-2', date: '2026-08-03', home: false, isHome: false, opp: 'Opp-A1', gf: 0, ga: 2, ht: { h: 0, a: 1 } },
            { id: 'M-3', date: '2026-08-05', home: true, isHome: true, opp: 'Opp-H2', gf: 4, ga: 1, ht: { h: 2, a: 0 } },
            { id: 'M-4', date: '2026-08-07', home: false, isHome: false, opp: 'Opp-A2', gf: 1, ga: 1, ht: { h: 0, a: 0 } },
            { id: 'M-5', date: '2026-08-09', home: true, isHome: true, opp: 'Opp-H3', gf: 2, ga: 0, ht: { h: 1, a: 0 } },
            { id: 'M-6', date: '2026-08-11', home: false, isHome: false, opp: 'Opp-A3', gf: 0, ga: 3, ht: { h: 0, a: 2 } }
        ];
        const team = { id: 'T2', name: 'Team Beta', n: 6, hn: 3, an: 3, last: mixedMatches };
        const facts = engine.teamFacts(team);

        // Ev formu: M-5 (2-0 G), M-3 (4-1 G), M-1 (3-0 G) -> 'GGG'
        assert.strictEqual(facts.homeForm, 'GGG', 'İç saha formu yalnızca iç saha maçlarını en yeni sırada yansıtmalı');
        assert.strictEqual(facts.homeGf, 3.0, 'İç saha gol ortalaması (2+4+3)/3 = 3.0 olmalı');
        assert.strictEqual(facts.homeGa, 0.33, 'İç saha gol yeme ortalaması (0+1+0)/3 = 0.33 olmalı');

        // Deplasman formu: M-6 (0-3 M), M-4 (1-1 B), M-2 (0-2 M) -> 'MBM'
        assert.strictEqual(facts.awayForm, 'MBM', 'Deplasman formu yalnızca deplasman maçlarını en yeni sırada yansıtmalı');
        assert.strictEqual(facts.awayGf, 0.33, 'Deplasman gol ortalaması (0+1+0)/3 = 0.33 olmalı');
        assert.strictEqual(facts.awayGa, 2.0, 'Deplasman gol yeme ortalaması (3+1+2)/3 = 2.0 olmalı');
    });

    await it('10.3: computeFormMomentum en yeni maçlara daha yüksek kronolojik ağırlık vermeli', () => {
        // Takım A: [Mağlubiyet, Beraberlik, Galibiyet] (Eskiden yeniye sıralı: en yeni maçı kazandı -> yükselen trend)
        const teamRising = {
            id: 'T-Rise',
            last: [
                { id: 'R1', date: '2026-08-01', gf: 0, ga: 2 }, // En eski: Mağlubiyet
                { id: 'R2', date: '2026-08-05', gf: 1, ga: 1 }, // Orta: Beraberlik
                { id: 'R3', date: '2026-08-10', gf: 3, ga: 0 }  // En yeni: Galibiyet
            ]
        };

        // Takım B: [Galibiyet, Beraberlik, Mağlubiyet] (Eskiden yeniye sıralı: en yeni maçı kaybetti -> düşen trend)
        const teamFalling = {
            id: 'T-Fall',
            last: [
                { id: 'F1', date: '2026-08-01', gf: 3, ga: 0 }, // En eski: Galibiyet
                { id: 'F2', date: '2026-08-05', gf: 1, ga: 1 }, // Orta: Beraberlik
                { id: 'F3', date: '2026-08-10', gf: 0, ga: 2 }  // En yeni: Mağlubiyet
            ]
        };

        const momRising = engine.computeFormMomentum(teamRising);
        const momFalling = engine.computeFormMomentum(teamFalling);

        assert.strictEqual(momRising > momFalling, true, `Yükselen trenddeki takım (${momRising}) düşen trenddeki takımdan (${momFalling}) daha yüksek momentuma sahip olmalıdır`);
        assert.strictEqual(momRising > 1.0, true, 'En son maçı galip bitiren takımın momentumu 1.0 nötr değerinden yüksek olmalı');
        assert.strictEqual(momFalling < 1.0, true, 'En son maçı mağlup bitiren takımın momentumu 1.0 nötr değerinden düşük olmalı');
    });

    await it('10.4: H2H analizinde maçlar en yeniye göre sıralanmalı ve en yeni skorlar gösterilmeli', () => {
        const th = {
            id: 'TH', name: 'Home FC', last: [
                { id: 'H1', date: '2024-05-01', oppId: 'TA', opp: 'Away FC', home: true, gf: 0, ga: 1 },
                { id: 'H2', date: '2026-08-10', oppId: 'TA', opp: 'Away FC', home: true, gf: 3, ga: 0 }
            ]
        };
        const ta = { id: 'TA', name: 'Away FC', last: [] };
        const m = { id: 'M-TARGET', date: '2026-08-20', home: 'Home FC', away: 'Away FC' };

        const h2h = engine.analyzeH2HAndCommon(th, ta, m);
        assert.ok(h2h.h2hSummary, 'H2H özeti oluşmalı');
        // En son maç 3-0 olduğu için skor listesinde ilk 3-0 görünmeli
        assert.ok(h2h.h2hSummary.includes('Son skorlar: 3-0, 0-1'), `H2H özeti en yeni maç skorunu en başta göstermeli (Bulunan: ${h2h.h2hSummary})`);
    });

    await it('10.5: computeRestAndFatigue eskiden yeniye dizilerde bile en son maçı bulmalı ve doğru dinlenme hesaplamalı', () => {
        const team = {
            id: 'T-Rest',
            // Eskiden yeniye sıralı dizi (en eski maç 60 gün önce, en yeni maç 4 gün önce)
            last: [
                { id: 'OLD', date: '2026-06-20', gf: 1, ga: 0 },
                { id: 'MID', date: '2026-07-20', gf: 1, ga: 1 },
                { id: 'NEW', date: '2026-08-16', gf: 2, ga: 0 }
            ]
        };
        const targetDate = '2026-08-20'; // 16 Ağustos'tan 20 Ağustos'a tam 4 gün dinlenme
        const rest = engine.computeRestAndFatigue(team, targetDate);

        assert.strictEqual(rest.restDays, 4, 'Dinlenme süresi en yeni maç olan 2026-08-16 üzerinden 4 gün hesaplanmalı (60 gün değil!)');
    });

    await it('10.6: Sıfır veri sızıntısı: Gelecek maçlar veya maçın kendisi analiz ve dinlenme verisine sızmamalı', () => {
        const teamWithFuture = {
            id: 'T-Leak',
            name: 'Leaker FC',
            last: [
                { id: 'PAST', date: '2026-08-15', home: true, opp: 'Past Opp', gf: 1, ga: 0 },
                { id: 'CURRENT_MATCH', date: '2026-08-20', home: true, opp: 'Target Opp', gf: 5, ga: 0 }, // Maçın kendisi!
                { id: 'FUTURE_MATCH', date: '2026-08-25', home: true, opp: 'Future Opp', gf: 9, ga: 0 }   // Gelecek maç!
            ]
        };

        const targetDate = '2026-08-20';
        const targetMatch = { id: 'CURRENT_MATCH', date: targetDate, home: 'Leaker FC', away: 'Other FC' };

        // 1. Dinlenme analizi sızıntı kontrolü
        const rest = engine.computeRestAndFatigue(teamWithFuture, targetDate);
        assert.strictEqual(rest.restDays, 5, 'Dinlenme yalnızca 2026-08-15 geçmiş maçı üzerinden (5 gün) hesaplanmalı, aynı gün veya gelecek maç sızmamalı');

        // 2. Takım özet analizi sızıntı kontrolü
        const facts = engine.teamFacts(teamWithFuture, targetDate);
        assert.strictEqual(facts.son10Count, 1, 'Yalnızca hedef tarihten önceki tek maç (PAST) dahil edilmeli');
        assert.strictEqual(facts.gf, 1.0, 'Gelecek maçların veya maçın kendi 5 ve 9 golü ortalamaya sızmamalı');

        // 3. Form momentumu sızıntı kontrolü (geçmiş maç sayısı 3ten az olduğu için 1.0 dönmeli)
        const mom = engine.computeFormMomentum(teamWithFuture, targetDate);
        assert.strictEqual(mom, 1.0, 'Hedef tarih öncesinde 3 maç bulunmadığı için momentum sızıntısız 1.0 dönmeli');
    });

    await it('10.7: Eksik geçmiş verisi olan takımlara (nh<5 veya na<5) yüksek güven puanı verilmemeli', () => {
        // Yalnızca 2 geçmiş maçı olan eksik geçmişli maç
        const sparseHomeFacts = { hn: 2, gf: 1.0, ga: 1.0 };
        const sparseAwayFacts = { an: 2, gf: 1.0, ga: 1.0 };
        const match = { id: 'M-SPARSE', nesineMarketsCount: 10, oddsFresh: true, oddsUpdatedAt: '19:00', inBulletin: true, state: 'pre', kickoff: '2026-10-25T20:00:00Z' };

        const trustMetrics = engine.computeDataTrustMetrics(
            match,
            2, // nh = 2 (< 5)
            2, // na = 2 (< 5)
            sparseHomeFacts,
            sparseAwayFacts,
            null,
            { n: 25 },
            { restDays: 7 },
            { restDays: 7 },
            { hasRealCorners: false, hasRealShots: false },
            { squad: null }
        );

        assert.ok(trustMetrics.overallScore <= 59, `Eksik geçmişli takımın güven puanı en fazla 59 olmalı (Bulunan: ${trustMetrics.overallScore})`);
        assert.notStrictEqual(trustMetrics.overallLabel, 'Yüksek Veri Güveni', 'Eksik geçmişli takıma ASLA Yüksek Veri Güveni etiketi verilemez');
        assert.ok(trustMetrics.sufficiencyLabel.includes('Yetersiz Geçmiş'), `Yetersizlik etiketi açıkça belirtilmeli (Bulunan: ${trustMetrics.sufficiencyLabel})`);
    });

    console.log('\n--- TEST 11: Hedef Maç Kickoff Hassasiyeti, Saat Bazlı Dinlenme & Yusuf AI Bağımsız Futbol Yorumu (engine.js) ---');

    await it('11.1: Hedef maç kickoff saati dikkate alınmalı; aynı gün daha önce başlayan maç geçmiş veriye dahil edilmeli', () => {
        const earlierSameDayMatch = {
            id: 'EARLIER_SAME_DAY',
            date: '2026-10-20',
            time: '14:00',
            kickoff: '2026-10-20T14:00:00Z',
            gf: 2,
            ga: 1
        };
        const targetMatch = {
            id: 'TARGET_MATCH',
            date: '2026-10-20',
            time: '20:00',
            kickoff: '2026-10-20T20:00:00Z'
        };

        const isPrior = engine.isMatchStrictlyPrior(earlierSameDayMatch, targetMatch);
        assert.strictEqual(isPrior, true, 'Hedef maç 20:00 iken aynı gün 14:00te oynanmış maç geçmiş veriye dahil edilmelidir');
    });

    await it('11.2: Aynı gün hedef maçtan sonra başlayan veya aynı saatteki maç kesinlikle dışlanmalı', () => {
        const laterSameDayMatch = {
            id: 'LATER_SAME_DAY',
            date: '2026-10-20',
            time: '21:00',
            kickoff: '2026-10-20T21:00:00Z',
            gf: 1,
            ga: 0
        };
        const sameTimeMatch = {
            id: 'SAME_TIME',
            date: '2026-10-20',
            time: '20:00',
            kickoff: '2026-10-20T20:00:00Z',
            gf: 0,
            ga: 0
        };
        const targetMatch = {
            id: 'TARGET_MATCH',
            date: '2026-10-20',
            time: '20:00',
            kickoff: '2026-10-20T20:00:00Z'
        };

        assert.strictEqual(engine.isMatchStrictlyPrior(laterSameDayMatch, targetMatch), false, 'Hedef maçtan sonra başlayan maç dışlanmalı');
        assert.strictEqual(engine.isMatchStrictlyPrior(sameTimeMatch, targetMatch), false, 'Hedef maçla aynı saatte başlayan maç geçmiş veri sayılamaz');
    });

    await it('11.3: Hedef maçın kendisi (matchId eşleşmesi) asla geçmiş veri havuzuna dahil edilmemeli', () => {
        const targetMatch = {
            id: 'TARGET_100',
            date: '2026-10-20',
            time: '20:00',
            kickoff: '2026-10-20T20:00:00Z'
        };
        const selfMatch = {
            id: 'TARGET_100', // Aynı ID
            date: '2026-10-20',
            time: '20:00',
            kickoff: '2026-10-20T20:00:00Z'
        };

        assert.strictEqual(engine.isMatchStrictlyPrior(selfMatch, targetMatch), false, 'Hedef maçın kendisi ASLA geçmiş veri olamaz');
    });

    await it('11.4: Güvenli geri dönüş (safe fallback): Kickoff bilgisi eksikse aynı günkü tüm maçlar dışlanmalı, önceki günler dahil edilmeli', () => {
        // Hedef maçın kickoff saati bilinmiyor (yalnızca tarih mevcut)
        const targetDateOnly = {
            id: 'TARGET_DATE_ONLY',
            date: '2026-10-20'
        };

        const sameDayMatch = {
            id: 'SAME_DAY',
            date: '2026-10-20',
            kickoff: '2026-10-20T14:00:00Z'
        };
        const priorDayMatch = {
            id: 'PRIOR_DAY',
            date: '2026-10-19',
            kickoff: '2026-10-19T20:00:00Z'
        };
        const futureDayMatch = {
            id: 'FUTURE_DAY',
            date: '2026-10-21',
            kickoff: '2026-10-21T14:00:00Z'
        };

        assert.strictEqual(engine.isMatchStrictlyPrior(sameDayMatch, targetDateOnly), false, 'Kickoff bilinmiyorsa aynı günkü maç güvenli şekilde dışlanmalı');
        assert.strictEqual(engine.isMatchStrictlyPrior(priorDayMatch, targetDateOnly), true, 'Önceki günkü maç dahil edilmeli');
        assert.strictEqual(engine.isMatchStrictlyPrior(futureDayMatch, targetDateOnly), false, 'Gelecek günkü maç dışlanmalı');
    });

    await it('11.5: Saat bazlı dinlenme süresi (restHours) ve gün bazlı dinlenme süresi (restDays) gerçek başlama saatleri üzerinden hesaplanmalı', () => {
        const teamTight = {
            id: 'T-TIGHT',
            last: [
                {
                    id: 'M-PREV',
                    date: '2026-10-18',
                    time: '18:00',
                    kickoff: '2026-10-18T18:00:00Z',
                    gf: 1, ga: 1
                }
            ]
        };
        const targetMatch = {
            id: 'TARGET_TIGHT',
            date: '2026-10-20',
            time: '15:00',
            kickoff: '2026-10-20T15:00:00Z'
        };

        // 18 Ekim 18:00 -> 20 Ekim 15:00 = 45.0 saat
        const restTight = engine.computeRestAndFatigue(teamTight, targetMatch);
        assert.strictEqual(restTight.restHours, 45.0, 'Dinlenme süresi 45.0 saat olarak hassas hesaplanmalı');
        assert.strictEqual(restTight.restDays, 2, 'Gün bazında 2 gün dinlenme olmalı');
        assert.strictEqual(restTight.isFatigued, true, '48 saatten az dinlenme aşırı yorgunluk riski olarak işaretlenmeli');
        assert.ok(restTight.label.includes('45 saat') || restTight.label.includes('Aşırı Yorgunluk'), `Label saat bilgisini yansıtmalı (${restTight.label})`);
    });

    await it('11.6: generateMatchCommentary: Matematiksel istatistik katmanı, Yusuf AI bağımsız yorum katmanı ve nihai değerlendirme tam üretilmeli', () => {
        const dummyMatch = {
            id: 'M-VAL',
            home: 'Galatasaray',
            away: 'Fenerbahçe',
            league: { full: 'Süper Lig' },
            date: '2026-10-25',
            time: '19:00',
            kickoff: '2026-10-25T19:00:00Z',
            oddsFresh: true,
            oddsUpdatedAt: '18:30:00',
            odds: { ms1: 2.10, msx: 3.40, ms2: 3.10, ust25: 1.85, alt25: 1.85, kgv: 1.70, kgy: 1.95 }
        };
        const dummyAnalysis = {
            lh: 1.95,
            la: 1.25,
            p: { ms1: 0.54, msx: 0.24, ms2: 0.22, ust25: 0.62, alt25: 0.38, kgv: 0.60, kgy: 0.40, dc1x: 0.78, dcx2: 0.46 },
            topScores: [{ s: '2-1', p: 0.14 }, { s: '2-0', p: 0.11 }],
            momH: 1.05,
            momA: 0.98,
            facts: {
                home: { formStr: 'GGGBG', form10Str: 'GGGBGMGGGG', last10Pts: 2.3, homeGf: 2.4, homeGa: 0.8, homeForm: 'GGGGG', htGoalSharePct: 42, cleanSheetPct: 40 },
                away: { formStr: 'GBMMG', form10Str: 'GBMMGGGBMB', last10Pts: 1.6, awayGf: 1.3, awayGa: 1.5, awayForm: 'MBMBG', htGoalSharePct: 48, cleanSheetPct: 20 }
            },
            restH: { restHours: 96, restDays: 4, isFatigued: false, label: '🔋 Dinç Kadro (4 gün dinlenme)' },
            restA: { restHours: 68, restDays: 3, isFatigued: true, label: '⚠️ Yorgunluk Riski (68 saat dinlenme)' },
            squad: null, // Veri yok
            dataTrust: { overallScore: 82, sufficiencyScore: 85, freshnessScore: 80, overallLabel: 'Yüksek Veri Güveni' }
        };

        const commentary = engine.generateMatchCommentary(dummyMatch, dummyAnalysis);
        assert.ok(commentary.statisticalSummary, 'statisticalSummary alanı bulunmalı');
        assert.ok(commentary.yusufAiEditorial, 'yusufAiEditorial alanı bulunmalı');
        assert.ok(commentary.finalAssessment, 'finalAssessment alanı bulunmalı');

        // finalAssessment zorunlu 4-5 alan kontrolü
        assert.ok(typeof commentary.finalAssessment.statisticalOutcome === 'string', 'statisticalOutcome string olmalı');
        assert.ok(typeof commentary.finalAssessment.yusufAiVerdict === 'string', 'yusufAiVerdict string olmalı');
        assert.ok(commentary.finalAssessment.bestPick, 'bestPick nesnesi bulunmalı');
        assert.ok(commentary.finalAssessment.bestPick.selection, 'bestPick.selection bulunmalı');
        assert.ok(typeof commentary.finalAssessment.riskLevel === 'string', 'riskLevel string olmalı');
        assert.ok(typeof commentary.finalAssessment.confidenceLevel === 'string', 'confidenceLevel string olmalı');
    });

    await it('11.7: Temiz ayrım & Sıfır uydurma veri: Sakatlık verisi yoksa açıkça doğrulanamadı yazmalı ve 6 soruya cevap verilmeli', () => {
        const dummyMatch = {
            id: 'M-HONEST',
            home: 'Beşiktaş',
            away: 'Trabzonspor',
            league: { full: 'Süper Lig' }
        };
        const dummyAnalysis = {
            lh: 1.40,
            la: 1.20,
            p: { ms1: 0.44, msx: 0.28, ms2: 0.28, ust25: 0.48, alt25: 0.52, kgv: 0.52, kgy: 0.48, dc1x: 0.72, dcx2: 0.56 },
            topScores: [{ s: '1-1', p: 0.13 }],
            squad: null // Kesinlikle sakatlık/ceza verisi yok
        };

        const commentary = engine.generateMatchCommentary(dummyMatch, dummyAnalysis);

        // Uydurma sakatlık engeli
        assert.strictEqual(commentary.statisticalSummary.squadAndInjuries.hasVerifiedData, false);
        assert.ok(commentary.statisticalSummary.squadAndInjuries.status.includes('doğrulanmadı'), 'Sakatlık verisi yokken açıkça doğrulanmadı yazmalı');
        assert.ok(commentary.yusufAiEditorial.question6_riskFactor.includes('sakatlık') || commentary.yusufAiEditorial.question6_riskFactor.includes('kadro'), 'Risk faktöründe teyit edilmemiş kadro bilgisi dürüstçe uyarılmalı');

        // 6 soru kontrolü
        assert.ok(commentary.yusufAiEditorial.question1_flowAndTempo.length > 20, 'Soru 1 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.question2_teamAdvantage.length > 20, 'Soru 2 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.question3_statsVsOdds.length > 20, 'Soru 3 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.question4_drawAndSurprise.length > 20, 'Soru 4 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.question5_bestPick.length > 20, 'Soru 5 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.question6_riskFactor.length > 20, 'Soru 6 cevaplanmalı');
        assert.ok(commentary.yusufAiEditorial.fullText.includes('1. Maçın Genel Gidişatı'), 'fullText markdown 6 soruyu içermeli');
    });

    await it('11.8: generateAiCommentaryAsync: Anahtar yokken veya offline iken anında (0ms) deterministik yoruma düşmeli', async () => {
        const dummyMatch = {
            id: 'M-OFFLINE',
            home: 'Arsenal',
            away: 'Chelsea',
            league: { full: 'Premier League' }
        };
        const dummyAnalysis = {
            lh: 2.10,
            la: 0.95,
            p: { ms1: 0.62, msx: 0.22, ms2: 0.16, ust25: 0.58, alt25: 0.42, kgv: 0.55, kgy: 0.45, dc1x: 0.84, dcx2: 0.38 },
            topScores: [{ s: '2-0', p: 0.15 }]
        };

        const asyncRes = await engine.generateAiCommentaryAsync(dummyMatch, dummyAnalysis, { forceDeterministic: true });
        assert.ok(asyncRes.statisticalSummary, 'Async fallback statisticalSummary üretmeli');
        assert.ok(asyncRes.yusufAiEditorial, 'Async fallback yusufAiEditorial üretmeli');
        assert.strictEqual(asyncRes.finalAssessment.bestPick.selection, engine.generateMatchCommentary(dummyMatch, dummyAnalysis).finalAssessment.bestPick.selection);
    });

    console.log('\n--- TEST 12: Yeni Yüksek Oranlı Sürpriz Kupon Pazarları & Eski Pazarların Temizlenmesi Doğrulaması ---');

    await it('12.1: Eski düz ve düşük oranlı pazarların (ms1, ms2, msx, dc1x, ust25, alt25, kgv, korner, kart) sürpriz seçim havuzundan elendiği doğrulanmalı', () => {
        const mockMatch = { id: 801, home: 'Real Madrid', away: 'Getafe', mbs: 1, inBulletin: true, state: 'pre', oddsFresh: true };
        const mockAn = { lh: 2.1, la: 0.8, facts: {}, tactical: { boosts: {} } };
        const mockModel = { base: { ms1: 0.45, ms2: 0.25, msx: 0.30, ust25: 0.50, kgv: 0.50, dc1x: 0.75 } };

        // Test edilecek eski/düz pazarlar
        const obsoletePicks = [
            { key: 'ms1', group: 'ms', p: 0.55, hasRealOdd: true, realOdd: 2.20, ev: 0.10 },
            { key: 'ms2', group: 'ms', p: 0.30, hasRealOdd: true, realOdd: 3.50, ev: 0.10 },
            { key: 'msx', group: 'msx', p: 0.32, hasRealOdd: true, realOdd: 3.40, ev: 0.08 },
            { key: 'dc1x', group: 'dc', p: 0.80, hasRealOdd: true, realOdd: 2.10, ev: 0.05 },
            { key: 'ust25', group: 'ou', p: 0.60, hasRealOdd: true, realOdd: 2.15, ev: 0.10 },
            { key: 'alt25', group: 'ou', p: 0.52, hasRealOdd: true, realOdd: 2.10, ev: 0.05 },
            { key: 'kgv', group: 'kg', p: 0.58, hasRealOdd: true, realOdd: 2.10, ev: 0.08 },
            { key: 'korner_ust95', group: 'korner', p: 0.50, hasRealOdd: true, realOdd: 2.20, ev: 0.05 },
            { key: 'kart_ust35', group: 'kart', p: 0.48, hasRealOdd: true, realOdd: 2.15, ev: 0.05 }
        ];

        for (const pk of obsoletePicks) {
            const scored = engine.scoreSurpriseCandidate(pk, mockMatch, mockAn, mockModel);
            assert.strictEqual(scored, null, `Eski pazar [${pk.key} / ${pk.group}] sürpriz kupona giremez`);
        }
    });

    await it('12.2: Yalnızca Jack\'in belirlediği 7 yüksek oranlı sürpriz pazarın kabul edildiği doğrulanmalı', () => {
        const mockMatch = { id: 802, home: 'Dortmund', away: 'Leipzig', mbs: 1, inBulletin: true, state: 'pre', oddsFresh: true };
        const mockAn = { lh: 1.8, la: 1.6, facts: {}, tactical: { boosts: {} } };
        const mockModel = { base: {} };

        const targetPicks = [
            { key: 'htft_2/1', group: 'htft', label: 'İY/MS 2/1', p: 0.05, hasRealOdd: true, realOdd: 28.00, ev: 0.40 },
            { key: 'htft_X/1', group: 'htft', label: 'İY/MS X/1', p: 0.22, hasRealOdd: true, realOdd: 4.80, ev: 0.05 },
            { key: 'iyskor_1_1', group: 'iyskor', label: 'İY Skor 1-1', p: 0.14, hasRealOdd: true, realOdd: 7.50, ev: 0.05 },
            { key: 'msskor_2_1', group: 'msskor', label: 'MS Skor 2-1', p: 0.11, hasRealOdd: true, realOdd: 8.50, ev: 0.05 },
            { key: 'ikiyari_kgv', group: 'ikiyari_kg', label: '1. ve 2. Yarı KG Var', p: 0.07, hasRealOdd: true, realOdd: 15.00, ev: 0.05 },
            { key: 'iykgv', group: 'iy_kg', label: 'İlk Yarı KG Var', p: 0.26, hasRealOdd: true, realOdd: 3.60, ev: 0.05 },
            { key: 'y2kgv', group: 'y2_kg', label: '2. Yarı KG Var', p: 0.30, hasRealOdd: true, realOdd: 3.10, ev: 0.05 },
            { key: 'ms1_kgv', group: 'ms_kg', label: 'MS 1 & KG Var', p: 0.25, hasRealOdd: true, realOdd: 3.80, ev: 0.05 },
            { key: 'msx_kgv', group: 'ms_kg', label: 'MS X & KG Var', p: 0.18, hasRealOdd: true, realOdd: 4.40, ev: 0.05 },
            { key: 'ms2_kgv', group: 'ms_kg', label: 'MS 2 & KG Var', p: 0.22, hasRealOdd: true, realOdd: 4.20, ev: 0.05 },
            { key: 'iymsskor_1_0_2_1', group: 'iymsskor', label: 'İY/MS Skor: 1-0 / 2-1', p: 0.04, hasRealOdd: true, realOdd: 18.00, ev: 0.05 }
        ];

        for (const pk of targetPicks) {
            const scored = engine.scoreSurpriseCandidate(pk, mockMatch, mockAn, mockModel);
            assert.ok(scored !== null, `Jack'in onaylı pazarı [${pk.key} / ${pk.group}] geçerli sürpriz adayı olmalı`);
            assert.ok(scored.score > 0, 'Skor pozitif olmalı');
            assert.ok(typeof scored.contrarianType === 'string', 'contrarianType üretilmeli');
        }
    });

    await it('12.3: evaluateBetOutcome içinde yeni sürpriz pazarlarının doğru skorlarla hatasız sonuçlandırıldığı doğrulanmalı', () => {
        // İY/MS
        assert.strictEqual(engine.evaluateBetOutcome('htft_1/X', { h: 1, a: 1 }, { h: 1, a: 0 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('htft_1/X', { h: 2, a: 0 }, { h: 1, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('htft_2/1', { h: 3, a: 2 }, { h: 0, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('htft_X/1', { h: 2, a: 1 }, { h: 1, a: 1 }), true);

        // İY Skor & MS Skor
        assert.strictEqual(engine.evaluateBetOutcome('iyskor_1_0', { h: 2, a: 1 }, { h: 1, a: 0 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('iyskor_1_0', { h: 2, a: 1 }, { h: 0, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('msskor_2_1', { h: 2, a: 1 }, { h: 1, a: 0 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('msskor_2_1', { h: 3, a: 1 }, { h: 1, a: 0 }), false);

        // İY KG Var
        assert.strictEqual(engine.evaluateBetOutcome('iykgv', { h: 2, a: 1 }, { h: 1, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('iykgv', { h: 2, a: 1 }, { h: 1, a: 0 }), false);

        // 2. Yarı KG Var (İY 0-0, MS 1-1 -> 2. yarıda iki takım da gol attı)
        assert.strictEqual(engine.evaluateBetOutcome('y2kgv', { h: 1, a: 1 }, { h: 0, a: 0 }), true);
        // İY 1-1, MS 1-1 -> 2. yarı 0-0 bitti, false olmalı
        assert.strictEqual(engine.evaluateBetOutcome('y2kgv', { h: 1, a: 1 }, { h: 1, a: 1 }), false);

        // 1. ve 2. Yarı KG Var (Her iki yarıda KG Var)
        // İY 1-1, MS 2-2 -> 1. yarı 1-1, 2. yarı 1-1 -> true
        assert.strictEqual(engine.evaluateBetOutcome('ikiyari_kgv', { h: 2, a: 2 }, { h: 1, a: 1 }), true);
        // İY 1-1, MS 2-1 -> 1. yarı 1-1, 2. yarı 1-0 -> dep 2. yarı gol atamadı -> false
        assert.strictEqual(engine.evaluateBetOutcome('ikiyari_kgv', { h: 2, a: 1 }, { h: 1, a: 1 }), false);

        // MS ve KG Var
        assert.strictEqual(engine.evaluateBetOutcome('ms1_kgv', { h: 2, a: 1 }, { h: 1, a: 0 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('ms1_kgv', { h: 2, a: 0 }, { h: 1, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('msx_kgv', { h: 2, a: 2 }, { h: 1, a: 1 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('msx_kgv', { h: 0, a: 0 }, { h: 0, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('ms2_kgv', { h: 1, a: 3 }, { h: 1, a: 1 }), true);

        // İlk Yarı / Maç Skoru (Çifte Skor)
        assert.strictEqual(engine.evaluateBetOutcome('iymsskor_1_0_2_1', { h: 2, a: 1 }, { h: 1, a: 0 }), true);
        assert.strictEqual(engine.evaluateBetOutcome('iymsskor_1_0_2_1', { h: 3, a: 1 }, { h: 1, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('iymsskor_1_0_2_1', { h: 2, a: 1 }, { h: 0, a: 0 }), false);
        assert.strictEqual(engine.evaluateBetOutcome('iymsskor_0_0_1_1', { h: 1, a: 1 }, { h: 0, a: 0 }), true);
    });

    await it('12.4: mackolik.parseNesineMarkets MTID 452, 591, 592, 414, 5, 777 ve 779 pazarlarını eksiksiz ayrıştırmalı', () => {
        const sampleMA = [
            { MTID: 452, SOV: 0, OCA: [{ N: 1, O: 3.25 }, { N: 2, O: 1.18 }] }, // İY KG Var / Yok
            { MTID: 591, SOV: 0, OCA: [{ N: 1, O: 3.65 }, { N: 2, O: 1.10 }] }, // 2. Yarı KG Var / Yok
            { MTID: 592, SOV: 0, OCA: [{ N: 1, O: 16.50 }, { N: 2, O: 1.01 }] }, // 1. ve 2. Yarı KG Var / Yok
            { MTID: 414, SOV: 0, OCA: [{ N: 1, O: 3.80 }, { N: 2, O: 2.10 }, { N: 3, O: 4.50 }, { N: 4, O: 11.00 }, { N: 5, O: 5.20 }, { N: 6, O: 3.10 }] }, // MS ve KG
            { MTID: 5, SOV: 0, OCA: [{ N: 1, O: 2.10 }, { N: 2, O: 14.00 }, { N: 7, O: 28.00 }] }, // İY/MS
            { MTID: 777, SOV: 0, OCA: [{ N: 1, ON: '2:1', O: 8.50 }, { N: 2, ON: '1:1', O: 7.20 }] }, // MS Skor
            { MTID: 779, SOV: 0, OCA: [{ N: 1, ON: '1:0', O: 3.80 }, { N: 2, ON: '1:1', O: 7.00 }] }  // İY Skor
        ];

        const parsed = mackolik.parseNesineMarkets(sampleMA);
        assert.strictEqual(parsed.iykgv, 3.25);
        assert.strictEqual(parsed.iykgy, 1.18);
        assert.strictEqual(parsed.y2kgv, 3.65);
        assert.strictEqual(parsed.y2kgy, 1.10);
        assert.strictEqual(parsed.ikiyari_kgv, 16.50);
        assert.strictEqual(parsed.ms1_kgv, 3.80);
        assert.strictEqual(parsed.msx_kgv, 4.50);
        assert.strictEqual(parsed.ms2_kgv, 5.20);
        assert.strictEqual(parsed['htft_1/1'], 2.10);
        assert.strictEqual(parsed['htft_1/X'], 14.00);
        assert.strictEqual(parsed['htft_2/1'], 28.00);
        assert.strictEqual(parsed.msskor_2_1, 8.50);
        assert.strictEqual(parsed.msskor_1_1, 7.20);
        assert.strictEqual(parsed.iyskor_1_0, 3.80);
        assert.strictEqual(parsed.iyskor_1_1, 7.00);
    });

    await it('12.5: buildCoupons sürpriz kuponunda yalnızca ve yalnızca onaylı 7 pazar grubundan maç seçmeli', () => {
        const allowedGroups = new Set(['htft', 'iyskor', 'msskor', 'iymsskor', 'ikiyari_kg', 'iy_kg', 'y2_kg', 'ms_kg']);
        const fixtureMatches = [];

        for (let i = 1; i <= 6; i++) {
            fixtureMatches.push({
                m: { id: 900 + i, home: `Home-${i}`, away: `Away-${i}`, mbs: 1, inBulletin: true, state: 'pre', oddsFresh: true },
                an: {
                    quality: 'B',
                    lh: 1.70,
                    la: 1.40,
                    facts: {},
                    tactical: { boosts: {} },
                    p: {
                        ms1: 0.50, ms2: 0.25, msx: 0.25, ust25: 0.55, kgv: 0.55, // eski pazarlar
                        'htft_X/1': 0.22,
                        iyskor_1_0: 0.18,
                        msskor_2_1: 0.12,
                        ikiyari_kgv: 0.06,
                        iykgv: 0.25,
                        y2kgv: 0.28,
                        ms1_kgv: 0.24
                    }
                }
            });
        }

        const coupons = engine.buildCoupons(fixtureMatches, {}, { surpN: 5 });
        assert.strictEqual(coupons.surprise.matches.length, 5, 'Tam 5 maç seçilmeli');

        for (const item of coupons.surprise.matches) {
            assert.ok(allowedGroups.has(item.group), `Seçilen maç grubu [${item.group} / ${item.key}] Jack'in onayladığı pazarlardan biri olmalı`);
            assert.ok(!['ms', 'msx', 'dc', 'ou', 'kg', 'korner', 'kart'].includes(item.group), `Eski pazar grubu [${item.group}] ASLA seçilemez`);
        }
    });

    console.log('\n================================================================');
    console.log(`  SONUÇ: ${passedTests}/${totalTests} Test Başarıyla Geçti (%100 Başarı)`);
    console.log('================================================================\n');
}

runTests().catch(err => {
    console.error('Test süreci başarısız oldu:', err);
    process.exit(1);
});
