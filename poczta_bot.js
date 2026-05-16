const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ================= SAFE FETCH =================
async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);

            if (!res.ok) {
                throw new Error("HTTP " + res.status);
            }

            return await res.json();

        } catch (err) {
            console.log(`Retry ${i + 1}/${retries}:`, err.message);

            if (i === retries - 1) {
                throw err;
            }

            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

// ================= TRACKING =================
async function trackPocztaPolska(trackingNumber) {
    try {
        const data = await fetchWithRetry(
            "https://uss.poczta-polska.pl/uss/v1.1/tracking/checkmailex",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "API_KEY": process.env.PP_API_KEY
                },
                body: JSON.stringify({
                    language: "PL",
                    number: trackingNumber,
                    addPostOfficeInfo: true
                })
            }
        );

        if (!data?.mailInfo) {
            return {
                ok: false,
                error: "Посылка не найдена"
            };
        }

        const info = data.mailInfo;

        return {
            ok: true,
            number: info.number,
            status: info.status || "unknown",
            sendDate: info.dispatchDate,
            deliveryDate: info.deliveryDate,
            events: (info.events || []).slice(0, 6).map(e => ({
                name: e.name,
                time: e.time,
                place: e.postOffice?.name
            }))
        };

    } catch (err) {
        console.log("TRACK ERROR:", err.message);

        return {
            ok: false,
            error: "Сервис временно недоступен"
        };
    }
}

// ================= FORMAT =================
function formatResult(data, tracking) {
    if (!data.ok) {
        return `❌ ${tracking}\n${data.error}`;
    }

    let msg = `📦 Poczta Polska\n`;
    msg += `🔢 ${data.number}\n\n`;
    msg += `🚚 Статус: ${data.status}\n`;

    if (data.sendDate) {
        msg += `📅 Отправка: ${data.sendDate.split("T")[0]}\n`;
    }

    if (data.deliveryDate) {
        msg += `✅ Доставка: ${data.deliveryDate.split("T")[0]}\n`;
    }

    msg += `\n📋 События:\n`;

    if (!data.events.length) {
        msg += "Нет данных";
    } else {
        data.events.forEach(e => {
            msg += `• ${e.name}\n`;
            if (e.time) msg += `  ⏱ ${e.time.replace("T", " ").slice(0, 16)}\n`;
            if (e.place) msg += `  📍 ${e.place}\n`;
        });
    }

    return msg;
}

// ================= BOT =================
bot.start((ctx) => {
    ctx.reply("📦 Отправь номер посылки Poczta Polska");
});

bot.on("text", async (ctx) => {
    const tracking = ctx.message.text.trim();

    await ctx.reply("🔍 Проверяю...");

    try {
        const data = await trackPocztaPolska(tracking);
        const msg = formatResult(data, tracking);

        await ctx.reply(msg);

    } catch (err) {
        console.error("BOT ERROR:", err.message);
        await ctx.reply("⚠️ Ошибка сервера, попробуй позже");
    }
});

// ================= SAFE LAUNCH =================
bot.launch({
    dropPendingUpdates: true
});

console.log("BOT STARTED");

// ================= GRACEFUL STOP =================
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
