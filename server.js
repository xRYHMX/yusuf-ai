const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const football = require('./football');

const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB maksimum istek boyutu sınırı
const modelCooldowns = new Map(); // 429/404 dönen modelleri hafızada tutar, her mesajda boşa beklemez
const rateLimitMap = new Map(); // IP bazlı hız sınırlandırma (Rate Limiting)
const serverErrorLogs = []; // Sunucu hata kayıtları tamponu

// Yerel geliştirme ortamında .env dosyası varsa ortam değişkenlerine yükle (GitHub'a .env asla yüklenmez)
(function loadLocalEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const k = trimmed.slice(0, eqIdx).trim();
                    const v = trimmed.slice(eqIdx + 1).trim();
                    if (k && !process.env[k]) process.env[k] = v;
                }
            }
        }
    } catch (_) {}
})();

const ALLOWED_ORIGINS = new Set([
    'https://yusuf-ai-opb0.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : [])
]);

// ---------------- Kapsamlı Sistem, Hata & Olay Log Günlüğü (Diagnostics Logger) ----------------
const systemLogs = [];
const MAX_SYSTEM_LOGS = 400;

function addSystemLog({ level = 'info', category = 'server', scope = 'Sistem', message = '', details = null }) {
    const now = new Date();
    const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        timeIso: now.toISOString(),
        timeStr: now.toLocaleTimeString('tr-TR'),
        level, // 'error', 'warn', 'info', 'success'
        category, // 'ai', 'football', 'nesine', 'data', 'server', 'client'
        scope,
        message: String(message || ''),
        details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null
    };
    systemLogs.push(entry);
    if (systemLogs.length > MAX_SYSTEM_LOGS) systemLogs.shift();
    serverErrorLogs.push({ time: entry.timeIso, scope, message: entry.message });
    if (serverErrorLogs.length > 100) serverErrorLogs.shift();

    if (level === 'error') {
        console.error(`[${entry.timeStr}] [${category.toUpperCase()}] [${scope}] ${entry.message}`);
    } else if (level === 'warn') {
        console.warn(`[${entry.timeStr}] [${category.toUpperCase()}] [${scope}] ${entry.message}`);
    } else {
        console.log(`[${entry.timeStr}] [${category.toUpperCase()}] [${scope}] ${entry.message}`);
    }
    return entry;
}

global.addSystemLog = addSystemLog;

function logServerError(scope, err, category = 'server', level = 'error') {
    const msg = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? err.stack : null;
    return addSystemLog({
        level,
        category,
        scope,
        message: msg,
        details: stack
    });
}

function checkRateLimit(ip, bucket = 'api', maxPerMin = 120) {
    const now = Date.now();
    const key = `${ip}:${bucket}`;
    let rec = rateLimitMap.get(key);
    if (!rec || now - rec.windowStart > 60000) {
        rec = { windowStart: now, count: 0 };
        rateLimitMap.set(key, rec);
    }
    rec.count += 1;
    return rec.count <= maxPerMin;
}

// Bellek temizliği (her 5 dakikada eski IP kayıtlarını temizle)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap.entries()) {
        if (now - v.windowStart > 120000) rateLimitMap.delete(k);
    }
}, 5 * 60 * 1000);

// Sunucu kalktığında model ve günün İddaa bülteni arka planda ısınsın, her 2.5 dakikada bir taze kalsın
football.getAnalyzedDay().catch(err => logServerError('FootballEngineInit', err));
setInterval(() => {
    football.getAnalyzedDay().catch(() => {});
}, 150 * 1000);

const server = http.createServer(async (req, res) => {
    const reqOrigin = req.headers.origin;
    if (reqOrigin && ALLOWED_ORIGINS.has(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self';"
    );

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    if (pathname.startsWith('/api/')) {
        const isChatRoute = pathname === '/api/chat';
        const allowed = checkRateLimit(clientIp, isChatRoute ? 'chat' : 'api', isChatRoute ? 30 : 120);
        if (!allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Çok fazla istek gönderildi. Lütfen birkaç saniye bekleyip tekrar deneyin.' }));
            return;
        }
    }

    // ---------------- Futbol API: Maç Listesi ----------------
    if (pathname === '/api/football/matches' && req.method === 'GET') {
        try {
            const data = await football.listMatches({
                date: query.date,
                filter: query.filter || 'all',
                search: query.search || '',
                category: query.category || 'all'
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (err) {
            logServerError('MatchesAPI', err, 'football');
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Maçlar çekilirken hata oluştu: ' + err.message }));
        }
        return;
    }

    // ---------------- Futbol API: Kuponlar (Banko & Sürpriz) ----------------
    if (pathname === '/api/football/coupons' && req.method === 'GET') {
        try {
            const data = await football.getCoupons(query.date);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (err) {
            logServerError('CouponsAPI', err, 'football');
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Kuponlar oluşturulurken hata oluştu: ' + err.message }));
        }
        return;
    }

    // ---------------- Futbol API: Tek Maç Derin Analizi ----------------
    if (pathname === '/api/football/match' && req.method === 'GET') {
        try {
            const matchId = query.id;
            if (!matchId) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Maç ID (id) parametresi zorunludur.' }));
                return;
            }
            const data = await football.getMatchDetail(matchId, query.date);
            if (!data) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Maç bulunamadı.' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (err) {
            logServerError('MatchDetailAPI', err, 'football');
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Maç detayı alınırken hata oluştu: ' + err.message }));
        }
        return;
    }

    // ---------------- Sistem & Hata Log Günlüğü API (GET /api/logs) ----------------
    if (pathname === '/api/logs' && req.method === 'GET') {
        const stats = {
            total: systemLogs.length,
            errors: systemLogs.filter(l => l.level === 'error').length,
            warnings: systemLogs.filter(l => l.level === 'warn').length,
            info: systemLogs.filter(l => l.level === 'info').length,
            aiIssues: systemLogs.filter(l => l.category === 'ai' && (l.level === 'error' || l.level === 'warn')).length,
            dataIssues: systemLogs.filter(l => (l.category === 'football' || l.category === 'nesine' || l.category === 'data') && (l.level === 'error' || l.level === 'warn')).length,
            lastUpdated: new Date().toLocaleTimeString('tr-TR')
        };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ logs: systemLogs.slice().reverse(), stats }));
        return;
    }

    // ---------------- İstemci (Browser) Hata Raporlama API (POST /api/logs/client) ----------------
    if (pathname === '/api/logs/client' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 50000) req.destroy(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body || '{}');
                addSystemLog({
                    level: data.level || 'error',
                    category: data.category || 'client',
                    scope: data.scope || 'Browser',
                    message: data.message || 'Bilinmeyen istemci hatası',
                    details: data.details || null
                });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // ---------------- Log Günlüğü Temizleme API (POST /api/logs/clear) ----------------
    if (pathname === '/api/logs/clear' && req.method === 'POST') {
        systemLogs.length = 0;
        addSystemLog({ level: 'info', category: 'server', scope: 'Logs', message: 'Log günlüğü sıfırlandı.' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // ---------------- AI Çıkarım Köprüsü (AI Analizci) ----------------
    if (pathname === '/api/chat' && req.method === 'POST') {
        let body = '';
        let bodyBytes = 0;
        let abortedLarge = false;
        req.on('data', chunk => {
            if (abortedLarge) return;
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_BODY_BYTES) {
                abortedLarge = true;
                res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'İstek boyutu çok büyük (Maksimum 8 MB).' }));
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', async () => {
            if (abortedLarge) return;
            try {
                const { messages } = JSON.parse(body);
                // API anahtarı yalnızca sunucu ortam değişkeninden (Render Environment Variables veya yerel .env) okunur; kaynak kodda anahtar tutulmaz
                const activeKey = (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim();

                const isGemini = activeKey.startsWith('AIza') || activeKey.startsWith('AQ.');
                const isOpenRouter = activeKey.startsWith('sk-or-');
                const isOpenAi = activeKey.startsWith('sk-') && !isOpenRouter;
                const isGroq = activeKey.startsWith('gsk_');
                const isKeyless = !activeKey;

                let providerName = 'Google Gemini 3.8 Flash';
                let providerBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';

                if (!isGemini) {
                    if (isOpenRouter) {
                        providerName = 'OpenRouter';
                        providerBaseUrl = 'https://openrouter.ai/api/v1';
                    } else if (isOpenAi) {
                        providerName = 'OpenAI';
                        providerBaseUrl = 'https://api.openai.com/v1';
                    } else if (isGroq) {
                        providerName = 'Groq';
                        providerBaseUrl = 'https://api.groq.com/openai/v1';
                    }
                }

                // Kullanıcının son mesajını ve varsa eklediği görselleri (base64 dataUrl) al
                const userMessages = (messages || []).filter(m => m.role === 'user');
                const lastUserObj = userMessages.length ? userMessages[userMessages.length - 1] : null;
                const lastUserMessage = lastUserObj ? String(lastUserObj.content || '') : '';
                const latestImages = (lastUserObj && Array.isArray(lastUserObj.images))
                    ? lastUserObj.images.filter(img => typeof img === 'string' && img.startsWith('data:image/')).slice(0, 3)
                    : [];
                const hasImages = latestImages.length > 0;

                // AŞAMA 1: Sadece yerel vision desteği olmayan yedek sağlayıcılar için ön-OCR (Gemini ve OpenAI doğrudan tek aşamada görseli okur, 10 sn kazandırır)
                let visionExtractedText = '';
                if (hasImages && !isKeyless && !isGemini && !isOpenAi) {
                    const rawVisionModels = [
                        'meta-llama/llama-4-scout-17b-16e-instruct',
                        'meta-llama/llama-4-maverick-17b-128e-instruct'
                    ];
                    const visionModels = rawVisionModels.filter(m => !(modelCooldowns.get(m) > Date.now()));
                    const visionContent = [
                        {
                            type: 'text',
                            text: `Görseldeki verileri hızlı ve net maddeler halinde çıkar:
- Kupon/bülten ise: Tüm maçları (Ev - Dep), tercihleri (MS 1, 2.5 Üst, KG Var vb.) ve oranları listele.
- Canlı istatistik/kadro ise: Takım adlarını, skoru, dakikayı ve tüm istatistik rakamlarını yaz.
- Genel görsel ise: İçeriği net betimle.
Kullanıcı notu: "${lastUserMessage || 'Görseli analiz et'}"`
                        },
                        ...latestImages.map(urlStr => ({
                            type: 'image_url',
                            image_url: { url: urlStr }
                        }))
                    ];

                    for (const vModel of visionModels) {
                        try {
                            console.log(`[Vision Engine - ${providerName}] Görsel okunuyor (${vModel})...`);
                            const vReqBody = {
                                model: vModel,
                                messages: [{ role: 'user', content: visionContent }],
                                max_tokens: 450,
                                temperature: 0.1,
                                stream: false
                            };

                            const vRes = await fetch(`${providerBaseUrl}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${activeKey}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(vReqBody)
                            });
                            if (vRes.ok) {
                                const vJson = await vRes.json();
                                visionExtractedText = (vJson.choices?.[0]?.message?.content || '').trim();
                                if (visionExtractedText) {
                                    console.log(`[Vision Engine - ${providerName}] Görsel başarıyla okundu (${visionExtractedText.length} karakter).`);
                                    break;
                                }
                            } else {
                                const vErr = await vRes.text();
                                if (vRes.status === 429 || vRes.status === 404) {
                                    modelCooldowns.set(vModel, Date.now() + 30 * 60 * 1000);
                                }
                                console.log(`[Vision Engine - ${providerName}] ${vModel} hata (${vRes.status}):`, vErr.slice(0, 160));
                            }
                        } catch (ve) {
                            console.log(`[Vision Engine - ${providerName}] ${vModel} bağlantı hatası:`, ve.message);
                        }
                    }
                }

                // AŞAMA 2: Aktif sohbet geçmişindeki tüm mesajları ve maçları tarayarak 10 katmanlı derin futbol analiz bağlamını oluştur
                let sportsContext = '';
                const previousTurns = (messages || []).slice(0, -1);
                const previousHistoryText = previousTurns.map(m => String(m.content || '')).join('\n');
                const combinedSearchQuery = visionExtractedText
                    ? `${lastUserMessage}\n${visionExtractedText}`
                    : lastUserMessage;
                try {
                    sportsContext = await football.buildAiSportsContext(combinedSearchQuery, {
                        compact: isKeyless,
                        hasImage: hasImages,
                        historyText: previousHistoryText
                    });
                } catch (e) {
                    console.error('Futbol bağlamı üretme hatası:', e.message);
                }

                // Aktif Sohbet Hafıza Özeti (Kullanıcı önceki mesajlarda konuştuğu maçlara/kuponlara referans verdiğinde şıp diye hatırlaması için)
                let chatMemoryBlock = '';
                if (previousTurns.length > 0) {
                    const memoryLines = previousTurns.slice(-14).map((m, i) => {
                        const speaker = m.role === 'user' ? 'KULLANICI' : 'YUSUF AI';
                        const cleanTxt = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 650);
                        return `${i + 1}. [${speaker}]: ${cleanTxt}`;
                    });
                    chatMemoryBlock = `\n\n[AKTİF SOHBET HAFIZASI - BU SOHBETTE ŞU ANA KADAR KONUŞULANLAR (${previousTurns.length} önceki mesaj)]:\n${memoryLines.join('\n')}\nÖNEMLİ HAFIZA TALİMATI: Kullanıcı "sana bir şey demiştim", "şu maçlar vardı demiştim onlarla sürpriz yapar mısın", "az önceki maçlar", "ilk söylediğim takımlar" gibi ifadeler kullandığında YUKARIDAKİ AKTİF SOHBET HAFIZASINDA geçen maçları ve konuşmaları doğrudan baz al, hangi maçlardan bahsettiğini ismen söyle ("Az önce bahsettiğin X, Y, Z maçlarıyla...") ve isteğini eksiksiz yerine getir!`;
                }

                // Sistem Yönergesi
                let systemContent = `Sen Yusuf AI - Google Gemini 3.8 Flash Vision mimarisi üzerinde çalışan, %100 bağımsız, 10 katmanlı kendi derin veri analizini (Ev/Dep Karnesi, Form İvmesi, Ortak Rakipler, H2H, Dinamik Dixon-Coles ρ, Fikstür Yorgunluğu/Dinlenme Günü, Taktik DNA Çarpışması, Kadro/Sakatlık, Saha/Hava Durumu ve Canlı Kalan Süre Motoru) yapan üst düzey yapay zekâ futbol analisti ve görsel kupon denetçisisin.
KİMLİK KURALI: Kullanıcı "sen hangi modelsin" diye sorarsa "Ben Google Gemini 3.8 Flash Vision destekli, 10 katmanlı bağımsız Yusuf AI Futbol ve Kupon Analiz Motoruyum" diye yanıtla.
BAĞIMSIZ ANALİZ İLKESİ: İddaa oranlarına veya dış yorumculara ASLA bakmazsın; her maçı kendi motorunun incelediği 10 katmanlı somut verilerle değerlendirirsin.
GÖRSEL ANALİZ YETENEĞİ: Kullanıcının gönderdiği kupon ekran görüntülerini, canlı maç istatistiklerini, kadroları veya genel fotoğrafları doğrudan kendi gözünle okur ve derin veri motorunla çarpıştırarak röntgenini çekersin. ASLA "görseli göremiyorum" deme; görseldeki her maçı (Ev Sahibi - Deplasman), oynanan tercihi ve istatistikleri doğrudan okuyup tek tek analiz et.
AKTİF SOHBET HAFIZASI KURALI: Bulunduğun sohbetteki tüm geçmiş mesajları, kullanıcının daha önce söylediği maçları/takımları ve kendi verdiğin önceki kuponları/analizleri tam olarak hatırlarsın. Kullanıcı geçmiş mesajdaki maçlara atıf yaptığında ("sana bişi demiştim şu maçlar vardı demiştim onlarla sürpriz yapar mısın" vb.) o maçları şıp diye hatırlayıp doğrudan onlarla istediğini yaparsın.
ÖNEMLİ KURAL: Kullanıcı telefondan takip ettiği için yanıtların KISA, ÖZ, NET VE TABLOLU olmalıdır. Tablodaki Güven İbresi sütununda ASLA [████░░] gibi metin blokları kullanma; sadece %88 veya %28 • 2.4x Değer yaz (arayüz otomatik neon bar çizecektir).
ASLA uzun paragraflar, edebiyat veya laf kalabalığı yazma; her maçın gerekçesinde incelediğin somut verileri (ev/dep gol ortalaması, ortak rakipler, taktik DNA, dinlenme günü, hava durumu, form, kilit oyuncu) 1-2 satırda net olarak yaz.
GENEL KUPON KURALI: Kullanıcı özel maçlar belirtmediyse [RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU] listesindeki maçları kullan; ancak kullanıcı bu mesajda veya önceki mesajlarda belirli maçları söylediyse doğrudan kullanıcının o maçlarını kullan!`;

                const recentHistory = (messages || []).slice(-24).map((m, idx, arr) => {
                    const isLastUser = (idx === arr.length - 1) && m.role === 'user';
                    let textContent = String(m.content || '').slice(0, 3200);
                    if (isLastUser && visionExtractedText) {
                        textContent = `${textContent || 'Görseli incele ve analiz et.'}\n\n[GÖRSELDEN OKUNAN DETAYLI VERİLER]:\n${visionExtractedText}`;
                    }
                    return {
                        role: m.role === 'user' ? 'user' : 'assistant',
                        content: textContent,
                        images: isLastUser ? latestImages : []
                    };
                });

                const buildFinalMessages = (ctxStr, histArr, useMultimodal = false) => {
                    let sys = systemContent;
                    if (ctxStr) sys += `\n\n${ctxStr}`;
                    if (chatMemoryBlock) sys += chatMemoryBlock;
                    sys += `\nKullanıcı futbol dışı bir görsel veya konu sorarsa da doğrudan, kısa, net ve profesyonel şekilde yanıt ver.`;
                    const mappedHist = histArr.map(h => {
                        if (useMultimodal && h.role === 'user' && Array.isArray(h.images) && h.images.length > 0) {
                            return {
                                role: 'user',
                                content: [
                                    { type: 'text', text: h.content || 'Görseli analiz et.' },
                                    ...h.images.map(u => ({ type: 'image_url', image_url: { url: u } }))
                                ]
                            };
                        }
                        return { role: h.role, content: h.content };
                    });
                    return [
                        { role: 'system', content: sys },
                        ...mappedHist
                    ];
                };

                let currentContextStr = sportsContext;
                let compactFallbacked = isKeyless;

                // Modellerin belirlenmesi (Google Gemini Free Turbo, OpenRouter Free, Groq Free, OpenAI veya Anahtarsız Bedava)
                let candidateModels = [];
                if (isKeyless) {
                    candidateModels = ['openai-fast'];
                } else if (isGemini) {
                    // Google AI Studio (%100 Ücretsiz, 1.000.000 TPM Limit, ~1.2sn Turbo Yanıt)
                    const allGemini = [
                        'gemini-3.5-flash',
                        'gemini-3.1-flash-lite',
                        'gemini-3.6-flash',
                        'gemini-3.7-flash',
                        'gemini-3.8-flash',
                        'gemini-3.5-flash-lite',
                        'gemini-flash-lite-latest'
                    ];
                    candidateModels = allGemini.filter(m => !(modelCooldowns.get(m) > Date.now()));
                    if (candidateModels.length === 0) candidateModels = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
                } else if (isOpenRouter) {
                    candidateModels = hasImages
                        ? [
                            'google/gemini-2.0-flash-exp:free',
                            'qwen/qwen-2.5-vl-72b-instruct:free',
                            'meta-llama/llama-3.2-11b-vision-instruct:free'
                        ]
                        : [
                            'google/gemini-2.0-flash-exp:free',
                            'deepseek/deepseek-chat-v3-0324:free',
                            'meta-llama/llama-3.3-70b-instruct:free',
                            'qwen/qwen-2.5-vl-72b-instruct:free'
                        ];
                } else if (isOpenAi) {
                    candidateModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
                } else {
                    candidateModels = hasImages
                        ? [
                            'meta-llama/llama-4-scout-17b-16e-instruct',
                            'meta-llama/llama-4-maverick-17b-128e-instruct',
                            'llama-3.3-70b-versatile',
                            'llama-3.1-8b-instant'
                        ]
                        : [
                            'meta-llama/llama-4-scout-17b-16e-instruct',
                            'llama-3.3-70b-versatile',
                            'meta-llama/llama-4-maverick-17b-128e-instruct',
                            'qwen/qwen3-32b',
                            'openai/gpt-oss-120b',
                            'openai/gpt-oss-20b',
                            'llama-3.1-8b-instant',
                            'allam-2-7b'
                        ];
                }

                // Modelleri sırayla dene
                let success = false;
                let lastApiError = '';
                for (const modelToTry of candidateModels) {
                    console.log(`Deneniyor [${providerName}]: ${modelToTry}...`);
                    const isReasoningModel = modelToTry.includes('gpt-oss') || modelToTry.includes('qwen3') || modelToTry.includes('deepseek') || modelToTry.startsWith('o1') || modelToTry.startsWith('o3');
                    const isNativeVision = isGemini || isOpenAi || modelToTry.includes('llama-4-scout') || modelToTry.includes('llama-4-maverick') || modelToTry.includes('vl') || modelToTry.includes('gemini');
                    const activeHist = compactFallbacked ? recentHistory.slice(-10) : recentHistory;
                    
                    // Aşama 1'de görsel zaten metne döküldüyse Aşama 2'de görseli tekrar base64 olarak yükleyip 2 kat süre harcama
                    const sendRawImageInStage2 = hasImages && isNativeVision && !visionExtractedText;
                    const finalMessages = buildFinalMessages(currentContextStr, activeHist, sendRawImageInStage2);

                    const reqPayload = {
                        model: modelToTry,
                        messages: finalMessages,
                        stream: true
                    };

                    if (modelToTry.startsWith('o1') || modelToTry.startsWith('o3')) {
                        reqPayload.max_completion_tokens = 4096;
                    } else if (isGemini) {
                        reqPayload.max_tokens = 4096;
                        if (!modelToTry.includes('3.5-flash-lite') && !modelToTry.includes('flash-lite-latest')) {
                            reqPayload.reasoning_effort = 'none';
                        }
                    } else if (isOpenAi || isOpenRouter || isKeyless) {
                        reqPayload.max_tokens = 4096;
                    } else {
                        reqPayload.max_tokens = isReasoningModel ? 4096 : 3200;
                        if (isReasoningModel && isGroq) {
                            reqPayload.reasoning_effort = 'low';
                        }
                    }

                    const headers = { 'Content-Type': 'application/json' };
                    if (activeKey) {
                        headers['Authorization'] = `Bearer ${activeKey}`;
                    }

                    const chatRes = await fetch(`${providerBaseUrl}/chat/completions`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(reqPayload),
                        signal: AbortSignal.timeout(25000)
                    });

                    if (chatRes.ok) {
                        console.log(`BAŞARILI! Çalışan Sağlayıcı: ${providerName} | Model: ${modelToTry}`);
                        res.writeHead(200, {
                            'Content-Type': 'text/event-stream; charset=utf-8',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        });

                        const reader = chatRes.body.getReader();
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            res.write(value);
                        }
                        res.end();
                        success = true;
                        break;
                    } else {
                        const errText = await chatRes.text();
                        lastApiError = errText;
                        if (chatRes.status === 429 || chatRes.status === 404) {
                            modelCooldowns.set(modelToTry, Date.now() + 30 * 60 * 1000);
                        }
                        logServerError(`${providerName}:${modelToTry}:${chatRes.status}`, errText.slice(0, 200), 'ai', 'warn');

                        // Boyut limiti (413) yaşanırsa bağlamı otomatik kompakt moda küçült
                        if (!compactFallbacked && (chatRes.status === 413 || (!isGemini && chatRes.status === 429) || errText.includes('too large'))) {
                            compactFallbacked = true;
                            try {
                                currentContextStr = await football.buildAiSportsContext(combinedSearchQuery, { compact: true, hasImage: hasImages, historyText: previousHistoryText });
                            } catch (_) {
                                currentContextStr = '';
                            }
                        }
                    }
                }

                // YEDEK MOTOR: Kullanıcının anahtarı yoksa, süresi dolmuşsa veya tüm modelleri limit yediyse otomatik olarak Dahili Anahtarsız Ücretsiz AI Motoruna düş!
                if (!success) {
                    console.log('[Fallback Engine] Anahtarsız Ücretsiz AI Motoru devreye giriyor...');
                    addSystemLog({
                        level: 'warn',
                        category: 'ai',
                        scope: 'AIFallback',
                        message: 'Ana modeller yanıt vermedi, dahili ücretsiz yedek motor devreye giriyor.'
                    });
                    try {
                        if (!compactFallbacked) {
                            currentContextStr = await football.buildAiSportsContext(combinedSearchQuery, { compact: true, hasImage: hasImages, historyText: previousHistoryText });
                        }
                    } catch (_) {}

                    const fallbackMessages = buildFinalMessages(currentContextStr, recentHistory.slice(-10), false);
                    for (let attempt = 1; attempt <= 2; attempt++) {
                        try {
                            const fbRes = await fetch('https://text.pollinations.ai/openai/chat/completions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    model: 'openai-fast',
                                    messages: fallbackMessages,
                                    stream: true
                                }),
                                signal: AbortSignal.timeout(25000)
                            });
                            if (fbRes.ok) {
                                console.log('BAŞARILI! Dahili Anahtarsız Ücretsiz AI Motoru yanıt veriyor.');
                                res.writeHead(200, {
                                    'Content-Type': 'text/event-stream; charset=utf-8',
                                    'Cache-Control': 'no-cache',
                                    'Connection': 'keep-alive'
                                });
                                const reader = fbRes.body.getReader();
                                while (true) {
                                    const { done, value } = await reader.read();
                                    if (done) break;
                                    res.write(value);
                                }
                                res.end();
                                success = true;
                                break;
                            } else if (fbRes.status === 402 && attempt === 1) {
                                // Ücretsiz IP hız sınırı varsa kısa bekleyip tekrar dene
                                await new Promise(r => setTimeout(r, 6000));
                            } else {
                                lastApiError = await fbRes.text();
                            }
                        } catch (fbErr) {
                            lastApiError = fbErr.message;
                        }
                    }
                }

                if (!success) {
                    addSystemLog({
                        level: 'error',
                        category: 'ai',
                        scope: 'AIEngine',
                        message: `${providerName} yanıt hatası: ` + (lastApiError ? lastApiError.slice(0, 240) : 'Kullanılabilir açık sohbet modeli bulunamadı.'),
                        details: lastApiError || null
                    });
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: `${providerName} yanıt hatası: ` + (lastApiError ? lastApiError.slice(0, 240) : 'Kullanılabilir açık sohbet modeli bulunamadı.') }));
                }

            } catch (err) {
                logServerError('ChatRoute', err, 'ai', 'error');
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // ---------------- Statik Dosyaları Sunma (Sadece Güvenli Ön Yüz Dosyaları) ----------------
    const cleanRoute = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
    const allowedStatic = new Set(['/index.html', '/style.css', '/script.js']);
    if (!allowedStatic.has(cleanRoute)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Bulunamadı');
        return;
    }

    const filePath = path.join(__dirname, cleanRoute);
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8'
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Bulunamadı');
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Yusuf AI sunucusu aktif: port ${PORT}`);
});
