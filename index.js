const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Конфиг из переменных окружения ──
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const SESSION_STRING = process.env.SESSION_STRING || '';
const PHONE = process.env.PHONE;

if (!API_ID || !API_HASH) {
  console.error('❌ Укажи API_ID и API_HASH в Variables на Render/Railway!');
  process.exit(1);
}

// ── Telegram клиент ──
const session = new StringSession(SESSION_STRING);
const client = new TelegramClient(session, API_ID, API_HASH, {
  connectionRetries: 5,
});

let isConnected = false;
let pendingCode = null;
let resolveCode = null;
let pendingPassword = null;
let resolvePassword = null;

// ── Подключение к Telegram ──
async function connectClient() {
  if (isConnected) return;
  try {
    await client.start({
      phoneNumber: async () => PHONE,
      phoneCode: async () => {
        console.log('📱 Ожидаем код из Telegram...');
        return new Promise((resolve) => { resolveCode = resolve; });
      },
      password: async () => {
        console.log('🔐 Ожидаем пароль 2FA...');
        return new Promise((resolve) => { resolvePassword = resolve; });
      },
      onError: (err) => console.error('Ошибка авторизации:', err),
    });
    isConnected = true;
    const sessionStr = client.session.save();
    console.log('✅ Подключён к Telegram!');
    console.log('💾 SESSION_STRING (сохрани в Variables):', sessionStr);
  } catch (err) {
    console.error('❌ Ошибка подключения:', err.message);
    isConnected = false;
  }
}

// ── Middleware ──
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Раздаём Mini App ──
app.use(express.static(path.join(__dirname, 'miniapp')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'miniapp', 'index.html'));
});

// ── API: статус подключения ──
app.get('/api/status', (req, res) => {
  res.json({ ok: true, connected: isConnected });
});

// ── API: ввод кода из Telegram ──
app.post('/api/auth/code', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ ok: false, error: 'Нет кода' });
  if (resolveCode) {
    resolveCode(code);
    resolveCode = null;
    res.json({ ok: true, message: 'Код принят' });
  } else {
    res.status(400).json({ ok: false, error: 'Код не ожидается' });
  }
});

// ── API: ввод пароля 2FA ──
app.post('/api/auth/password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ ok: false, error: 'Нет пароля' });
  if (resolvePassword) {
    resolvePassword(password);
    resolvePassword = null;
    res.json({ ok: true, message: 'Пароль принят' });
  } else {
    res.status(400).json({ ok: false, error: 'Пароль не ожидается' });
  }
});

// ── API: получить контакты ──
app.get('/api/contacts', async (req, res) => {
  if (!isConnected) return res.status(403).json({ ok: false, error: 'Не подключён' });
  try {
    const result = await client.getContacts();
    const contacts = result
      .filter(c => c.id && c.firstName)
      .map(c => ({
        id: c.id.toString(),
        name: [c.firstName, c.lastName].filter(Boolean).join(' '),
        username: c.username || null,
        phone: c.phone || null,
        initials: [c.firstName, c.lastName].filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2),
        source: 'contact',
      }));
    res.json({ ok: true, count: contacts.length, users: contacts });
  } catch (err) {
    console.error('Ошибка получения контактов:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: получить последние диалоги ──
app.get('/api/dialogs', async (req, res) => {
  if (!isConnected) return res.status(403).json({ ok: false, error: 'Не подключён' });
  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    const users = dialogs
      .filter(d => d.isUser && d.entity && !d.entity.bot && d.entity.firstName)
      .map(d => {
        const e = d.entity;
        return {
          id: e.id.toString(),
          name: [e.firstName, e.lastName].filter(Boolean).join(' '),
          username: e.username || null,
          lastMessage: d.message?.message?.slice(0, 50) || '',
          date: d.date ? new Date(d.date * 1000).toISOString() : null,
          initials: [e.firstName, e.lastName].filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2),
          source: 'dialog',
        };
      });
    res.json({ ok: true, count: users.length, users });
  } catch (err) {
    console.error('Ошибка получения диалогов:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: рассылка ──
app.post('/api/blast', upload.array('files', 10), async (req, res) => {
  if (!isConnected) return res.status(403).json({ ok: false, error: 'Не подключён' });
  try {
    const { text, recipients } = req.body;
    const files = req.files || [];
    let recipientIds;
    try { recipientIds = JSON.parse(recipients); } catch { return res.status(400).json({ ok: false, error: 'Неверный формат' }); }
    if (!recipientIds?.length) return res.status(400).json({ ok: false, error: 'Нет получателей' });
    if (!text && !files.length) return res.status(400).json({ ok: false, error: 'Нет сообщения' });

    let sent = 0, failed = 0;
    for (const uid of recipientIds) {
      try {
        if (files.length === 0) {
          await client.sendMessage(uid, { message: text });
        } else {
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const caption = i === 0 ? (text || '') : '';
            await client.sendFile(uid, {
              file: f.path,
              caption,
            });
          }
        }
        sent++;
        await new Promise(r => setTimeout(r, 1000)); // 1 сек между отправками
      } catch (e) {
        failed++;
        console.warn(`⚠️ Ошибка ${uid}: ${e.message}`);
      }
    }

    files.forEach(f => fs.unlink(f.path, () => {}));
    console.log(`📤 Отправлено: ${sent}, ошибок: ${failed}`);
    res.json({ ok: true, sent, failed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Запуск ──
app.listen(PORT, async () => {
  console.log(`🚀 BlastSend UserBot запущен на порту ${PORT}`);
  await connectClient();
});
