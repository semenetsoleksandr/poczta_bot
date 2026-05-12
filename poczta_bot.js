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

function normalizeTrackingNumber(trackingNumber) {
    return trackingNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function trackPackage(trackingNumber) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-http2',
                '--disable-blink-features=AutomationControlled',
            ]
        });

        const page = await browser.newPage();

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );

        await page.setViewport({ width: 1366, height: 768 });

        await page.goto('https://www.poczta-polska.pl/sledzenie-przesylek/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // ✅ Закрываем куки и опрос параллельно
        await Promise.all([
            page.waitForSelector('#CybotCookiebotDialogBodyButtonAccept', { timeout: 3000 })
                .then(el => el.click())
                .catch(() => {}),
            page.waitForSelector('.btn-close', { timeout: 3000 })
                .then(el => el.click())
                .catch(() => {}),
        ]);

        // ✅ Ждём поле ввода и вводим номер
        await page.waitForSelector('input[name*="track"]', { visible: true, timeout: 15000 });
        const input = await page.$('input[name*="track"]');
        await input.click({ clickCount: 3 });
        await input.type(trackingNumber, { delay: 30 });

        logToFile(`Tracking: ${trackingNumber}`);

        // ✅ Кликаем и ждём результат — без waitForNavigation (сайт использует AJAX)
        await page.click('#trackShipmentSubmit');

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
        }, { timeout: 30000, polling: 300 });

        // ✅ Собираем данные параллельно
        const [shipmentInfo, trackingEvents] = await Promise.all([
            page.evaluate(() => {
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
            }),
            page.evaluate(() => {
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
            }),
        ]);

        return { shipmentInfo, trackingEvents };

    } catch (err) {
        console.error('trackPackage error:', err.message);
        throw err;
    } finally {
        if (browser) await browser.close();
    }
}

bot.start((ctx) => {
    ctx.reply('Привет! Отправь номер отслеживания посылки.');
});

bot.on('text', async (ctx) => {
    const trackingNumber = normalizeTrackingNumber(ctx.message.text.trim());

    // ✅ Принимаем номера только из цифр ИЛИ буквы+цифры, минимум 8 символов
    if (trackingNumber.length < 8) {
        return ctx.reply('Введи корректный номер отслеживания');
    }

    await ctx.reply(`🔍 Ищу: ${trackingNumber}...`);

    try {
        const { shipmentInfo, trackingEvents } = await trackPackage(trackingNumber);

        let message = '';
        if (shipmentInfo) message += shipmentInfo + '\n';
        message += '\n📦 События:\n\n';
        message += trackingEvents.length > 0
            ? trackingEvents.join('\n\n')
            : 'Нет данных о движении посылки.';

        await ctx.reply(message);

    } catch (err) {
        await ctx.reply(`❌ Ошибка при поиске: ${trackingNumber}`);
    }
});

bot.launch();
console.log('BOT STARTED');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
