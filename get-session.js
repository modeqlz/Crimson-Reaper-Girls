/**
 * get-session.js — запусти один раз локально.
 * Введи данные в консоль, скопируй SESSION_STRING и вставь в Render.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

(async () => {
    const apiIdStr = await ask('API_ID: ');
    const apiHash = await ask('API_HASH: ');
    const apiId = parseInt(apiIdStr.trim());

    if (!apiId || !apiHash.trim()) {
        console.error('❌ API_ID и API_HASH обязательны.');
        rl.close(); process.exit(1);
    }

    const client = new TelegramClient(new StringSession(''), apiId, apiHash.trim(), { connectionRetries: 5 });

    await client.start({
        phoneNumber: async () => (await ask('📱 Номер телефона (с +): ')).trim(),
        phoneCode: async () => (await ask('💬 Код из Telegram: ')).trim(),
        password: async () => (await ask('🔐 Пароль 2FA (если нет — Enter): ')).trim() || undefined,
        onError: (err) => console.error('Ошибка:', err.message),
    });

    const sessionStr = client.session.save();
    console.log('\n✅ Готово! Вставь это в SESSION_STRING на Render:\n');
    console.log(sessionStr);
    console.log('\nПосле сохранения нажми "Save, rebuild and deploy".');

    await client.disconnect();
    rl.close();
})();
