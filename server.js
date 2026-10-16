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
                const activeKey = (apiKey && apiKey.trim()) ? apiKey.trim() : (process.env.GROQ_API_KEY || '').trim();

                if (!activeKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ 
                        error: 'API anahtarı bulunamadı. Sol menünün altındaki "API Anahtarı Yapıştır" butonuna tıklayıp Groq API anahtarınızı (gsk_...) kaydedin veya Render ayarlarından GROQ_API_KEY değişkeni olarak ekleyin.' 
                    }));
                    return;
                }

                // Kullanıcının son mesajını al ve her sohbette canlı İddaa bülteni bağlamını hazırla
                // ("başka ver", "değiştir", "3 maçlık yap" gibi kısa mesajlarda bile bağlam kopmaz ve halüsinasyon olmaz)
                const userMessages = (messages || []).filter(m => m.role === 'user');
                const lastUserMessage = userMessages.length ? String(userMessages[userMessages.length - 1].content || '') : '';

                let sportsContext = '';
                try {
                    sportsContext = await football.buildAiSportsContext(lastUserMessage);
                } catch (e) {
                    console.error('Futbol bağlamı üretme hatası:', e.message);
                }

                // Sistem Yönergesi
                let systemContent = `Sen Yusuf AI - %100 bağımsız, çok katmanlı kendi derin veri analizini yapan yapay zekâ futbol analisti ve kupon motorusun.
BAĞIMSIZ ANALİZ İLKESİ: İddaa oranlarına veya dış yorumculara ASLA bakmazsın; her maçı kendi motorunun incelediği Ev/Deplasman gol karnesi, son 5 maç form ivmesi, ortak rakipler kıyaslaması, geçmiş H2H maçları, maç saati hava/zemin şartları, puan tablosu ve kilit oyuncu istatistikleriyle değerlendirirsin.
ÖNEMLİ KURAL: Kullanıcı telefondan takip ettiği için yanıtların KISA, ÖZ, NET, TABLOLU VE GRAFİKSEL BARLI olmalıdır.
ASLA uzun paragraflar, edebiyat veya laf kalabalığı yazma; her maçın gerekçesinde incelediğin somut verileri (ev/dep gol ortalaması, ortak rakipler, hava durumu, form, kilit oyuncu) 1-2 satırda net olarak yaz.
KESİNLİKLE SADECE SANA VERİLEN [RESMİ İDDAA BÜLTENİ DERİN ANALİZ MAÇ HAVUZU] LİSTESİNDEKİ MAÇLARI KULLAN. LİSTEDE OLMAYAN MAÇ YAZMAK YASAKTIR.`;

                if (sportsContext) {
                    systemContent += `\n\n${sportsContext}`;
                }
                systemContent += `\nKullanıcı futbol dışı bir konu sorarsa da doğrudan, kısa, net ve profesyonel şekilde yanıt ver.`;

                const finalMessages = [
                    { role: 'system', content: systemContent },
                    ...(messages || [])
                ];

                // Modelleri listele
                let candidateModels = [
                    'qwen/qwen3.8-27b',
                    'openai/gpt-oss-120b',
                    'openai/gpt-oss-20b',
                    'allam-2-7b',
                    'llama-3.3-70b-versatile',
                    'llama-3.1-8b-instant'
                ];

                try {
                    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
                        headers: { 'Authorization': `Bearer ${activeKey}` }
                    });
                    if (modelsRes.ok) {
                        const modelsJson = await modelsRes.json();
                        const modelIds = (modelsJson.data || []).map(m => m.id);
                        
                        const cleanChatModels = modelIds.filter(id => 
                            !id.includes('whisper') && 
                            !id.includes('guard') && 
                            !id.startsWith('canopylabs')
                        );

                        if (cleanChatModels.length > 0) {
                            const sorted = [
                                ...candidateModels.filter(m => cleanChatModels.includes(m)),
                                ...cleanChatModels.filter(m => !candidateModels.includes(m))
                            ];
                            candidateModels = sorted;
                        }
                    }
                } catch (e) {
                    console.log('Model sorgusu atlandı:', e.message);
                }

                // Modelleri sırayla dene
                let success = false;
                for (const modelToTry of candidateModels) {
                    console.log(`Deneniyor: ${modelToTry}...`);
                    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${activeKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: modelToTry,
                            messages: finalMessages,
                            max_tokens: 2800,
                            stream: true
                        })
                    });

                    if (groqRes.ok) {
                        console.log(`BAŞARILI! Çalışan Model: ${modelToTry}`);
                        res.writeHead(200, {
                            'Content-Type': 'text/event-stream; charset=utf-8',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        });

                        const reader = groqRes.body.getReader();
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            res.write(value);
                        }
                        res.end();
                        success = true;
                        break;
                    } else {
                        const errText = await groqRes.text();
                        console.log(`${modelToTry} başarısız oldu:`, errText);
                    }
                }

                if (!success) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'Kullanılabilir açık sohbet modeli bulunamadı.' }));
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
