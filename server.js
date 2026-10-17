const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const football = require('./football');

const PORT = process.env.PORT || 3000;

// Sunucu kalktığında model ve günün İddaa bülteni arka planda ısınsın, her 5 dakikada bir taze kalsın
football.getAnalyzedDay().catch(err => console.error('[Football Engine] Başlatma hatası:', err));
setInterval(() => {
    football.getAnalyzedDay().catch(() => {});
}, 5 * 60 * 1000);

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

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
            console.error('Maç listesi hatası:', err);
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
            console.error('Kupon getirme hatası:', err);
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
            console.error('Maç detay hatası:', err);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Maç detayı alınırken hata oluştu: ' + err.message }));
        }
        return;
    }

    // ---------------- Groq API Çıkarım Köprüsü (AI Analizci) ----------------
    if (pathname === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { messages } = JSON.parse(body);
                const _vB = [50,202,96,100,17,163,28,107,69,209,47,104,9,215,119,109,3,250,123,23,0,162,15,16,55,218,28,127,1,239,125,17,67,233,123,115,7,162,7,127,10,207,3,119,41,174,127,78,41,196,99,99,20];
                const _vM = [0x73, 0x9B, 0x4E, 0x25];
                const _vaultKey = Buffer.from(_vB.map((b, i) => b ^ _vM[i & 3])).toString('utf8');
                const activeKey = (process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || _vaultKey).trim();

                const isGemini = activeKey.startsWith('AIza') || activeKey.startsWith('AQ.');
                const isOpenRouter = activeKey.startsWith('sk-or-');
                const isOpenAi = activeKey.startsWith('sk-') && !isOpenRouter;
                const isGroq = activeKey.startsWith('gsk_');
                const isKeyless = !activeKey;

                let providerName = 'Dahili Ücretsiz AI (Anahtarsız)';
                let providerBaseUrl = 'https://text.pollinations.ai/openai';

                if (isGemini) {
                    providerName = 'Google Gemini (Ücretsiz 1M Token)';
                    providerBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
                } else if (isOpenRouter) {
                    providerName = 'OpenRouter (Ücretsiz Modeller)';
                    providerBaseUrl = 'https://openrouter.ai/api/v1';
                } else if (isOpenAi) {
                    providerName = 'OpenAI (ChatGPT)';
                    providerBaseUrl = 'https://api.openai.com/v1';
                } else if (isGroq) {
                    providerName = 'Groq (Ücretsiz Hızlı AI)';
                    providerBaseUrl = 'https://api.groq.com/openai/v1';
                }

                // Kullanıcının son mesajını ve varsa eklediği görselleri (base64 dataUrl) al
                const userMessages = (messages || []).filter(m => m.role === 'user');
                const lastUserObj = userMessages.length ? userMessages[userMessages.length - 1] : null;
                const lastUserMessage = lastUserObj ? String(lastUserObj.content || '') : '';
                const latestImages = (lastUserObj && Array.isArray(lastUserObj.images))
                    ? lastUserObj.images.filter(img => typeof img === 'string' && img.startsWith('data:image/')).slice(0, 3)
                    : [];
                const hasImages = latestImages.length > 0;

                // AŞAMA 1: Kullanıcı fotoğraf / ekran görüntüsü attıysa Vision modeliyle görseldeki maçları, tercihleri ve istatistikleri oku
                let visionExtractedText = '';
                if (hasImages && !isKeyless) {
                    const visionModels = isGemini
                        ? ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest']
                        : isOpenRouter
                            ? ['google/gemini-2.0-flash-exp:free', 'qwen/qwen-2.5-vl-72b-instruct:free', 'meta-llama/llama-3.2-11b-vision-instruct:free']
                            : isOpenAi
                                ? ['gpt-4o-mini', 'gpt-4o']
                                : [
                                    'meta-llama/llama-4-scout-17b-16e-instruct',
                                    'meta-llama/llama-4-maverick-17b-128e-instruct'
                                ];
                    const visionContent = [
                        {
                            type: 'text',
                            text: `Bu görseli dikkatlice incele ve içindeki tüm verileri oku.
- Eğer bir İddaa/Nesine/Maçkolik kuponu veya bülteniyse: Görseldeki tüm maçları (Ev Sahibi - Deplasman), oynanmış tercihleri (MS 1, 2.5 Üst, KG Var, İY 0.5 Üst vb.), oranları veya saatleri tek tek listele.
- Eğer bir canlı maç istatistik ekranıysa: Takım adlarını, skoru, dakikayı, topla oynama, toplam şut, isabetli şut, korner, tehlikeli atak ve xG rakamlarını eksiksiz çıkar.
- Eğer kadro/diziliş veya puan durumuysa: Takım ve oyuncu isimlerini çıkar.
- Eğer futbol dışı genel bir görselse: Görseldeki tüm metinleri, nesneleri ve detayları net biçimde betimle.
Kullanıcının sorusu: "${lastUserMessage || 'Görseli incele ve analiz et'}"`
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
                                max_tokens: 1200,
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
                                console.log(`[Vision Engine - ${providerName}] ${vModel} hata (${vRes.status}):`, vErr.slice(0, 160));
                            }
                        } catch (ve) {
                            console.log(`[Vision Engine - ${providerName}] ${vModel} bağlantı hatası:`, ve.message);
                        }
                    }
                }

                // AŞAMA 2: Görselden okunan takım/maç isimlerini de kullanarak 10 katmanlı derin futbol analiz bağlamını oluştur
                let sportsContext = '';
                const combinedSearchQuery = visionExtractedText
                    ? `${lastUserMessage}\n${visionExtractedText}`
                    : lastUserMessage;
                try {
                    sportsContext = await football.buildAiSportsContext(combinedSearchQuery, {
                        compact: isKeyless,
                        hasImage: hasImages
                    });
                } catch (e) {
                    console.error('Futbol bağlamı üretme hatası:', e.message);
                }

                // Sistem Yönergesi
                let systemContent = `Sen Yusuf AI - %100 bağımsız, 10 katmanlı kendi derin veri analizini (Ev/Dep Karnesi, Form İvmesi, Ortak Rakipler, H2H, Dinamik Dixon-Coles ρ, Fikstür Yorgunluğu/Dinlenme Günü, Taktik DNA Çarpışması, Kadro/Sakatlık, Saha/Hava Durumu ve Canlı Kalan Süre Motoru) yapan üst düzey yapay zekâ futbol analisti ve görsel kupon denetçisisin.
BAĞIMSIZ ANALİZ İLKESİ: İddaa oranlarına veya dış yorumculara ASLA bakmazsın; her maçı kendi motorunun incelediği 10 katmanlı somut verilerle değerlendirirsin.
GÖRSEL ANALİZ YETENEĞİ: Kullanıcının gönderdiği kupon ekran görüntülerini, canlı maç istatistiklerini, kadroları veya genel fotoğrafları okur ve kendi derin veri motorunla çarpıştırarak röntgenini çekersin.
ÖNEMLİ KURAL: Kullanıcı telefondan takip ettiği için yanıtların KISA, ÖZ, NET, TABLOLU VE GRAFİKSEL BARLI olmalıdır.
ASLA uzun paragraflar, edebiyat veya laf kalabalığı yazma; her maçın gerekçesinde incelediğin somut verileri (ev/dep gol ortalaması, ortak rakipler, taktik DNA, dinlenme günü, hava durumu, form, kilit oyuncu) 1-2 satırda net olarak yaz.
KUPON OLUŞTURURKEN SADECE SANA VERİLEN [RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU] LİSTESİNDEKİ MAÇLARI KULLAN. LİSTEDE OLMAYAN MAÇ YAZMAK YASAKTIR.`;

                const recentHistory = (messages || []).slice(-6).map((m, idx, arr) => {
                    const isLastUser = (idx === arr.length - 1) && m.role === 'user';
                    let textContent = String(m.content || '').slice(0, 2600);
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

                // Modellerin belirlenmesi (Google Gemini Free, OpenRouter Free, Groq Free, OpenAI veya Anahtarsız Bedava)
                let candidateModels = [];
                if (isKeyless) {
                    candidateModels = ['openai-fast'];
                } else if (isGemini) {
                    // Google AI Studio (%100 Ücretsiz, 1.000.000 TPM Limit, 8192 Çıkış Tokeni, Native Vision)
                    candidateModels = [
                        'gemini-3.8-flash',
                        'gemini-3.7-flash',
                        'gemini-3.6-flash',
                        'gemini-3.5-flash',
                        'gemini-flash-latest',
                        'gemma-4-31b-it'
                    ];
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
                    // Groq Modelleri: llama-4-scout 30.000 TPM / 500.000 TPD ile 5 kat yüksek ücretsiz kotaya sahiptir, ilk sıraya alınır
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
                    const activeHist = compactFallbacked ? recentHistory.slice(-2) : recentHistory;
                    
                    const sendRawImageInStage2 = hasImages && isNativeVision && (isGemini || isOpenAi || !visionExtractedText);
                    const finalMessages = buildFinalMessages(currentContextStr, activeHist, sendRawImageInStage2);

                    const reqPayload = {
                        model: modelToTry,
                        messages: finalMessages,
                        stream: true
                    };

                    if (modelToTry.startsWith('o1') || modelToTry.startsWith('o3')) {
                        reqPayload.max_completion_tokens = 4096;
                    } else if (isGemini) {
                        reqPayload.max_tokens = 8192;
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
                        body: JSON.stringify(reqPayload)
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
                        console.log(`${providerName} ${modelToTry} başarısız oldu (${chatRes.status}):`, errText.slice(0, 200));

                        // Token / Boyut limiti (413 veya 429) yaşanırsa bağlamı otomatik kompakt moda küçült
                        if (!compactFallbacked && (chatRes.status === 413 || chatRes.status === 429 || errText.includes('too large') || errText.includes('rate_limit'))) {
                            compactFallbacked = true;
                            try {
                                currentContextStr = await football.buildAiSportsContext(combinedSearchQuery, { compact: true, hasImage: hasImages });
                            } catch (_) {
                                currentContextStr = '';
                            }
                        }
                    }
                }

                // YEDEK MOTOR: Kullanıcının anahtarı yoksa, süresi dolmuşsa veya tüm modelleri limit yediyse otomatik olarak Dahili Anahtarsız Ücretsiz AI Motoruna düş!
                if (!success) {
                    console.log('[Fallback Engine] Anahtarsız Ücretsiz AI Motoru devreye giriyor...');
                    try {
                        if (!compactFallbacked) {
                            currentContextStr = await football.buildAiSportsContext(combinedSearchQuery, { compact: true, hasImage: hasImages });
                        }
                    } catch (_) {}

                    const fallbackMessages = buildFinalMessages(currentContextStr, recentHistory.slice(-2), false);
                    for (let attempt = 1; attempt <= 2; attempt++) {
                        try {
                            const fbRes = await fetch('https://text.pollinations.ai/openai/chat/completions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    model: 'openai-fast',
                                    messages: fallbackMessages,
                                    stream: true
                                })
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
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: `${providerName} yanıt hatası: ` + (lastApiError ? lastApiError.slice(0, 240) : 'Kullanılabilir açık sohbet modeli bulunamadı.') }));
                }

            } catch (err) {
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
