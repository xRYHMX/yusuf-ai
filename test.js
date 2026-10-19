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
        logLoss: 0.550 // <= 1.150
    }))
};

const mockUnverifiedTable = {
    walkForwardRecords: Array.from({ length: 35 }, (_, i) => ({
        id: `mock_u_${i}`,
        matchId: 800000 + i,
        won: i < 28, // %80.0 başarı fakat N=35 (< 50)
        brier: 0.185,
        logLoss: 0.520
    }))
};

// Jack Kontrol 3: 60 sonuçlanmış maç var ama sadece 10 tanesinde Brier ve LogLoss var (eksik kayıt denetimi)
const mockIncompleteMetricsTable = {
    walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
        id: `mock_inc_${i}`,
        matchId: 700000 + i,
        won: i < 45,
        brier: i < 10 ? 0.190 : null,
        logLoss: i < 10 ? 0.550 : null
    }))
};

// Jack Kontrol 3: 60 kayıt var ama 30 maç tekrarlanmış (bağımsız olmayan maç denetimi)
const mockDuplicateMatchesTable = {
    walkForwardRecords: Array.from({ length: 60 }, (_, i) => ({
        id: `mock_dup_${i}`,
        matchId: 600000 + (i % 30), // Yalnızca 30 tekil maç!
        won: i < 45,
        brier: 0.190,
        logLoss: 0.550
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
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: false, void: true }, // Nesine İptal/Erteleme: Oran 1.00
            { matchId: 105, won: false, settledOdd: 2.30 } // Kaybetti
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
                an: { quality: 'B', lh: 1.20, la: 1.20, p: { msx: 0.32 } }
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
                an: { quality: 'B', lh: 1.20, la: 1.20, p: { msx: 0.32 } }
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
            { matchId: 101, won: true, settledOdd: 3.20 },
            { matchId: 102, won: true, settledOdd: 3.40 },
            { matchId: 103, won: true, settledOdd: 3.10 },
            { matchId: 104, won: false, cancelled: true }, // Kesinleşmiş iptal: Oran 1.00
            { matchId: 105, won: false, settledOdd: 2.30 }
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
            { matchId: 101, won: true, settledOdd: 3.50 },
            { matchId: 102, won: true, settledOdd: 3.60 },
            { matchId: 103, won: true, settledOdd: 3.30 },
            { matchId: 104, won: true, settledOdd: 2.20 },
            { matchId: 105, won: true, settledOdd: 2.40 }
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
            { matchId: 101, won: true },
            { matchId: 102, won: true },
            { matchId: 103, won: true },
            { matchId: 104, won: true },
            { matchId: 105, won: true }
        ];

        const settlement = engine.settleSystem345(sys, matchResults, { placedCoupon: fetched });
        assert.strictEqual(settlement.isSettled, true);
        assert.strictEqual(settlement.totalCost, 160);
        assert.strictEqual(settlement.costPerColumn, 10);
        assert.strictEqual(settlement.wonColumnsCount, 16);
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
