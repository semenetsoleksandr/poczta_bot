const { Telegraf } = require("telegraf");
const puppeteer = require("puppeteer");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ================= TRACKING =================
async function trackPocztaPolska(trackingNumber) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
        );

        await page.goto(
            "https://emonitoring.poczta-polska.pl/",
            { waitUntil: "networkidle2" }
        );

        // ввод трека
        await page.type("input", trackingNumber);

        // нажимаем кнопку поиска
        await page.click("button");

        await page.waitForTimeout(4000);

        // читаем результат
        const result = await page.evaluate(() => {
            const status = document.body.innerText;
            return status;
        });

        return {
            ok: true,
            text: result.slice(0, 1500)
        };

    } catch (err) {
        console.error("PUPPETEER ERROR:", err.message);

        return {
            ok: false,
            error: "Ошибка парсинга страницы"
        };

    } finally {
        if (browser) await browser.close();
    }
}

// ================= BOT =================
bot.start((ctx) => {
    ctx.reply("📦 Отправь трек-номер Poczta Polska");
});

bot.on("text", async (ctx) => {
    const track = ctx.message.text.trim();

    await ctx.reply("🔍 Проверяю через сайт...");

    const result = await trackPocztaPolska(track);

    if (!result.ok) {
        return ctx.reply("❌ " + result.error);
    }

    ctx.reply("📦 Результат:\n\n" + result.text);
});

// ================= LAUNCH =================
bot.launch({
    dropPendingUpdates: true
});

console.log("BOT STARTED");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
