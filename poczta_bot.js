const { Telegraf } = require('telegraf');
const https = require('https');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ================= HTTP GET =================
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                ...headers
            }
        };
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
        });
        req.on('error', reject);
        req.end();
    });
}

// ================= HTTP POST =================
function httpPost(url, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body),
                ...headers
            }
        };
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, headers: res.headers, body: raw }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ================= ТРЕКИНГ =================
async function trackPackage(trackingNumber) {
    // Шаг 1: заходим на emonitoring чтобы получить куки и API ключ
    const homePage = await httpGet('https://emonitoring.poczta-polska.pl/', {
        'Accept-Language': 'pl-PL,pl;q=0.9'
    });

    // Достаём куки
    const cookies = homePage.headers['set-cookie']
        ? homePage.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
        : '';

    // Достаём API ключ из HTML
    const apiKeyMatch = homePage.body.match(/['"]([\w+=/]{40,})['"]/);
    const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;

    console.log('Куки:', cookies.slice(0, 50));
    console.log('API Key найден:', !!apiKey);
    if (apiKey) console.log('API Key:', apiKey.slice(0, 20) + '...');

    // Шаг 2: делаем запрос к API
    const result = await httpPost(
        'https://uss.poczta-polska.pl/uss/v1.1/tracking/checkmailex',
        { language: 'PL', number: trackingNumber, addPostOfficeInfo: false },
        {
            'API_KEY': apiKey || '',
            'Origin': 'https://emonitoring.poczta-polska.pl',
            'Referer': 'https://emonitoring.poczta-polska.pl/',
            'Cookie': cookies,
            'Accept-Language': 'pl'
        }
    );

    console.log('Статус API:', result.status);
    console.log('Ответ:', JSON.stringify(result.body).slice(0, 200));

    return result.body;
}

// ================= ФОРМАТИРОВАНИЕ =================
function formatResult(data, trackingNumber) {
    if (!data || !data.mailInfo) {
        return `❌ Посылка ${trackingNumber} не найдена.`;
    }
    const info = data.mailInfo;
    let message = '';
    if (info.number) message += `📦 Номер: ${info.number}\n`;
    if (info.dispatchDate) message += `📅 Отправлена: ${info.dispatchDate.split('T')[0]}\n`;
    if (info.dispatchCountryName) message += `🌍 Откуда: ${info.dispatchCountryName}\n`;
    if (info.deliveryDate) message += `✅ Доставлена: ${info.deliveryDate.split('T')[0]}\n`;
    const events = info.events || [];
    if (events.length > 0) {
        message += '\n📋 События:\n\n';
        events.slice(0, 10).forEach(event => {
            const date = event.time ? event.time.replace('T', ' ').slice(0, 16) : '';
            const name = event.name || '';
            const office = event.postOffice?.name || '';
            message += `• ${name}`;
            if (date) message += ` — ${date}`;
            if (office) message += `\n  📍 ${office}`;
            message += '\n\n';
        });
    } else {
        message += '\nНет данных о движении посылки.';
    }
    return message.trim();
}

// ================= NORMALIZE =================
function normalizeTrackingNumber(t) {
    return t.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ================= BOT =================
bot.start((ctx) => ctx.reply('Привет! Отправь номер отслеживания посылки.'));

bot.on('text', async (ctx) => {
    const trackingNumber = normalizeTrackingNumber(ctx.message.text.trim());
    if (trackingNumber.length < 8) {
        return ctx.reply('Введи корректный номер отслеживания');
    }
    await ctx.reply(`🔍 Ищу: ${trackingNumber}...`);
    try {
        const data = await trackPackage(trackingNumber);
        await ctx.reply(formatResult(data, trackingNumber));
    } catch (err) {
        console.error('Ошибка:', err.message);
        await ctx.reply(`❌ Ошибка при поиске: ${trackingNumber}`);
    }
});

bot.launch();
console.log('BOT STARTED');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
