const puppeteer = require('puppeteer');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);

const logPath = path.join(__dirname, 'bot.log');

function logToFile(message) {
    const timestamp = new Date().toISOString();
    fs.appendFile(logPath, `[${timestamp}] ${message}\n`, () => {});
}

// ================= NORMALIZE =================
function normalizeTrackingNumber(trackingNumber) {
    return trackingNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ================= TRACK PACKAGE =================
async function trackPackage(trackingNumber) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-http2',
                '--disable-blink-features=AutomationControlled',
            ]
        });

        const page = await browser.newPage();

        // ✅ Скрываем что это headless-браузер
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );

        await page.setViewport({ width: 1366, height: 768 });

        console.log('Открываем сайт...');

        await page.goto('https://www.poczta-polska.pl/sledzenie-przesylek/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // ✅ Скриншот сразу после загрузки — смотрим что видит браузер
        await page.screenshot({ path: 'debug_start.png', fullPage: true });
        console.log('Скриншот сохранён: debug_start.png');

        // ✅ Закрываем попап с куками если есть
        const cookieSelectors = [
            '#CybotCookiebotDialogBodyButtonAccept',
            '#onetrust-accept-btn-handler',
            '.cookie-accept',
            'button[id*="accept"]',
            'button[class*="accept"]',
        ];

        for (const sel of cookieSelectors) {
            try {
                await page.waitForSelector(sel, { timeout: 3000 });
                await page.click(sel);
                console.log(`Куки приняты (${sel})`);
                await new Promise(r => setTimeout(r, 1000));
                break;
            } catch {
                // этот селектор не найден — пробуем следующий
            }
        }

        // ✅ Скриншот после закрытия попапа
        await page.screenshot({ path: 'debug_after_cookie.png', fullPage: true });

        // ================= INPUT =================
        console.log(`Ищем поле ввода...`);

        // ✅ Пробуем разные варианты селектора
        const inputSelectors = [
            'input[type="text"]',
            'input[name*="track"]',
            'input[id*="track"]',
            'input[placeholder*="numer"]',
            'input[placeholder*="przesył"]',
            'input',
        ];

        let inputHandle = null;

        for (const sel of inputSelectors) {
            try {
                await page.waitForSelector(sel, { visible: true, timeout: 5000 });
                inputHandle = await page.$(sel);
                if (inputHandle) {
                    console.log(`Поле найдено по селектору: ${sel}`);
                    break;
                }
            } catch {
                // не найдено — пробуем следующий
            }
        }

        if (!inputHandle) {
            await page.screenshot({ path: 'debug_fail.png', fullPage: true });
            throw new Error('Поле ввода не найдено — смотри debug_fail.png');
        }

        await inputHandle.click({ clickCount: 3 });
        await inputHandle.type(trackingNumber, { delay: 80 });

        logToFile(`Tracking: ${trackingNumber}`);
        console.log(`Введён номер: ${trackingNumber}`);

        // ================= SUBMIT =================
        await page.waitForSelector('#trackShipmentSubmit', { visible: true, timeout: 15000 });
        await page.click('#trackShipmentSubmit');

        console.log('Форма отправлена, ждём результат...');

        // ================= WAIT FOR RESULT =================
        try {
            await page.waitForFunction(() => {
                const text = document.body.innerText;
                return (
                    text.includes('Status przesyłki') ||
                    text.includes('Nadana') ||
                    text.includes('Doręczona') ||
                    text.includes('W drodze') ||
                    text.includes('Przyjęta') ||
                    text.includes('Brak informacji')
                );
            }, { timeout: 30000 });
        } catch {
            await page.screenshot({ path: 'debug_result.png', fullPage: true });
            throw new Error('Результат не появился — смотри debug_result.png');
        }

        await new Promise(r => setTimeout(r, 2000));

        await page.screenshot({ path: 'debug_result.png', fullPage: true });

        // ================= INFO =================
        const shipmentInfo = await page.evaluate(() => {
            const rows = document.querySelectorAll('.table-shipment-info__row');
            let info = '';
            rows.forEach(row => {
                const label = row.querySelector('.label');
                const value = row.querySelector('.value');
                if (label && value) {
                    info += `${label.textContent.trim()}: ${value.textContent.trim()}\n`;
                }
            });
            return info;
        });

        // ================= EVENTS =================
        const trackingEvents = await page.evaluate(() => {
            const events = [];
            const rows = document.querySelectorAll('.table-tracking-container__row');
            rows.forEach(row => {
                if (!row.classList.contains('head')) {
                    const event = row.querySelector('.events');
                    const dateTime = row.querySelector('.date-and-time');
                    const postOffice = row.querySelector('.post-office');
                    if (event && dateTime) {
                        let text = `${event.textContent.trim()} - ${dateTime.textContent.trim()}`;
                        if (postOffice) {
                            text += `\nОтделение: ${postOffice.textContent.trim()}`;
                        }
                        events.push(text);
                    }
                }
            });
            return events;
        });

        return { shipmentInfo, trackingEvents };

    } catch (err) {
        console.error('trackPackage error:', err.message);
        throw err;
    } finally {
        if (browser) await browser.close();
    }
}

// ================= BOT =================
bot.start((ctx) => {
    ctx.reply('Привет! Отправь номер отслеживания посылки.');
});

bot.on('text', async (ctx) => {
    const trackingNumber = normalizeTrackingNumber(ctx.message.text.trim());

    if (!/[A-Z]/.test(trackingNumber) || !/\d/.test(trackingNumber) || trackingNumber.length < 5) {
        return ctx.reply('Введи корректный номер отслеживания');
    }

    await ctx.reply(`🔍 Ищу: ${trackingNumber}...`);

    try {
        const { shipmentInfo, trackingEvents } = await trackPackage(trackingNumber);

        let message = '';

        if (shipmentInfo) {
            message += shipmentInfo + '\n';
        }

        message += '\n📦 События:\n\n';

        if (trackingEvents.length > 0) {
            message += trackingEvents.join('\n\n');
        } else {
            message += 'Нет данных о движении посылки.';
        }

        await ctx.reply(message);

    } catch (err) {
        await ctx.reply(`❌ Ошибка при поиске: ${trackingNumber}\nСмотри скриншоты debug_*.png для диагностики`);
    }
});

// ================= LAUNCH =================
bot.launch();
console.log('BOT STARTED');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
