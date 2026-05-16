const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// трекинг Poczta Polska
async function track(trackingNumber) {
    const res = await fetch(
        "https://uss.poczta-polska.pl/uss/v1.1/tracking/checkmailex",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "API_KEY": process.env.PP_API_KEY
            },
            body: JSON.stringify({
                language: "PL",
                number: trackingNumber
            })
        }
    );

    const data = await res.json();

    if (!data?.mailInfo) {
        return "❌ Не найдено";
    }

    const info = data.mailInfo;

    return `📦 ${info.number}
🚚 ${info.status || "unknown"}
📍 ${info.events?.[0]?.name || "нет данных"}`;
}

// бот
bot.start((ctx) => ctx.reply("Отправь трек-номер"));

bot.on("text", async (ctx) => {
    const result = await track(ctx.message.text.trim());
    ctx.reply(result);
});

bot.launch();

console.log("BOT STARTED");
