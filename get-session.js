/**
 * get-session.js — запусти ОДИН РАЗ локально:
 *   node get-session.js
 *
 * Введи телефон, код из Telegram (и пароль 2FA если есть).
 * Скопируй SESSION_STRING из вывода и вставь в Variables на Render.
 * После этого сервер больше не будет спрашивать код.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const API_ID = parseInt(process.env.API_ID || '');
const API_HASH = process.env.API_HASH || '';

if (!API_ID || !API_HASH) {
    console.error('❌ Запускай так:');
    console.error('   $env:API_ID="123456"; $env:API_HASH="abcdef..."; node get-session.js');
    process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

(async () => {
    const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });

    await client.start({
        phoneNumber: async () => await ask('📱 Номер телефона (с +): '),
        phoneCode: async () => await ask('💬 Код из Telegram: '),
        password: async () => await ask('🔐 Пароль 2FA (если нет — нажми Enter): '),
        onError: (err) => console.error('Ошибка:', err),
    });

    const sessionStr = client.session.save();
    console.log('\n✅ Сессия получена!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SESSION_STRING =', sessionStr);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n👉 Вставь SESSION_STRING в Variables на Render и передеплой.');

    await client.disconnect();
    rl.close();
})();
