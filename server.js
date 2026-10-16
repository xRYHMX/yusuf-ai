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
                const { messages, apiKey } = JSON.parse(body);
                const activeKey = (apiKey && apiKey.trim()) 
                    ? apiKey.trim() 
                    : (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim();

                if (!activeKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        error: 'API anahtarı bulunamadı. Sol menünün altındaki "API Anahtarı" butonuna tıklayıp OpenAI (sk-...) veya Groq (gsk_...) API anahtarınızı kaydedin veya Render ayarlarından OPENAI_API_KEY / GROQ_API_KEY değişkeni olarak ekleyin.' 
                    }));
                    return;
                }

                const isOpenAi = activeKey.startsWith('sk-');
                const providerName = isOpenAi ? 'OpenAI' : 'Groq';
                const providerBaseUrl = isOpenAi ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1';

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
                if (hasImages) {
                    const visionModels = isOpenAi
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
                    sportsContext = await football.buildAiSportsContext(combinedSearchQuery, { hasImage: hasImages });
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
                let compactFallbacked = false;

                // Modellerin belirlenmesi (OpenAI ChatGPT veya Groq)
                let candidateModels = [];
                if (isOpenAi) {
                    // ChatGPT Modelleri: gpt-4o en zeki ve en güçlü görsel/metin modeli
                    candidateModels = hasImages
                        ? ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
                        : ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
                } else {
                    // Groq Modelleri
                    candidateModels = hasImages
                        ? [
                            'meta-llama/llama-4-scout-17b-16e-instruct',
                            'meta-llama/llama-4-maverick-17b-128e-instruct',
                            'llama-3.3-70b-versatile',
                            'llama-3.1-8b-instant'
                        ]
                        : [
                            'llama-3.3-70b-versatile',
                            'meta-llama/llama-4-scout-17b-16e-instruct',
                            'meta-llama/llama-4-maverick-17b-128e-instruct',
                            'llama-3.1-8b-instant',
                            'qwen/qwen3-32b',
                            'openai/gpt-oss-120b',
                            'openai/gpt-oss-20b',
                            'allam-2-7b'
                        ];

                    try {
                        const modelsRes = await fetch(`${providerBaseUrl}/models`, {
                            headers: { 'Authorization': `Bearer ${activeKey}` }
                        });
                        if (modelsRes.status === 401) {
                            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: `${providerName} API anahtarınız geçersiz veya hatalı (401). Sol alttaki API Anahtarı butonundan anahtarınızı kontrol edin.` }));
                            return;
                        }
                        if (modelsRes.ok) {
                            const modelsJson = await modelsRes.json();
                            const modelIds = (modelsJson.data || []).map(m => m.id);
                            
                            const cleanChatModels = modelIds.filter(id => {
                                const low = id.toLowerCase();
                                return !low.includes('whisper') &&
                                    !low.includes('guard') &&
                                    !low.includes('tts') &&
                                    !low.includes('orpheus') &&
                                    !low.includes('embed') &&
                                    !low.includes('playai') &&
                                    !low.startsWith('canopylabs');
                            });

                            if (cleanChatModels.length > 0) {
                                candidateModels = [
                                    ...candidateModels.filter(m => cleanChatModels.includes(m)),
                                    ...cleanChatModels.filter(m => !candidateModels.includes(m))
                                ];
                            }
                        }
                    } catch (e) {
                        console.log('Model sorgusu atlandı:', e.message);
                    }
                }

                // Modelleri sırayla dene
                let success = false;
                let lastApiError = '';
                for (const modelToTry of candidateModels) {
                    console.log(`Deneniyor [${providerName}]: ${modelToTry}...`);
                    const isReasoningModel = modelToTry.includes('gpt-oss') || modelToTry.includes('qwen3') || modelToTry.includes('deepseek') || modelToTry.startsWith('o1') || modelToTry.startsWith('o3');
                    const isNativeVision = isOpenAi || modelToTry.includes('llama-4-scout') || modelToTry.includes('llama-4-maverick');
                    const activeHist = compactFallbacked ? recentHistory.slice(-2) : recentHistory;
                    
                    // OpenAI gpt-4o'da doğrudan multimodal görsel de iletilir
                    const sendRawImageInStage2 = hasImages && isNativeVision && (isOpenAi || !visionExtractedText);
                    const finalMessages = buildFinalMessages(currentContextStr, activeHist, sendRawImageInStage2);

                    const reqPayload = {
                        model: modelToTry,
                        messages: finalMessages,
                        stream: true
                    };

                    // Token limitleri: OpenAI'da 4096 tam token verilir; kesinti asla yaşanmaz
                    if (modelToTry.startsWith('o1') || modelToTry.startsWith('o3')) {
                        reqPayload.max_completion_tokens = 4096;
                    } else if (isOpenAi) {
                        reqPayload.max_tokens = 4096;
                    } else {
                        reqPayload.max_tokens = isReasoningModel ? 4096 : (compactFallbacked ? 1600 : 2200);
                        if (isReasoningModel) {
                            reqPayload.reasoning_effort = 'low';
                        }
                    }

                    const chatRes = await fetch(`${providerBaseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${activeKey}`,
                            'Content-Type': 'application/json'
                        },
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
                        console.log(`${providerName} ${modelToTry} başarısız oldu (${chatRes.status}):`, errText);

                        if (chatRes.status === 401) {
                            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: `${providerName} API anahtarınız geçersiz veya bakiyesi yetersiz (401). Sol alttaki API Anahtarı butonundan anahtarınızı kontrol edin.` }));
                            return;
                        }

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

    // ---------------- Statik Dosyaları Sunma ----------------
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath.split('?')[0]);

    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
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
