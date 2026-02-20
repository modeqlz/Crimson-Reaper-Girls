const express = require('express');
const cors = require('cors');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не указан! Добавь его в Variables на Railway.');
  process.exit(1);
}

// ── Бот ──
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ── База пользователей (файл) ──
const DB_FILE = path.join(__dirname, 'users.json');
const users = new Map();

function loadUsers() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      data.forEach(u => users.set(u.id, u));
      console.log(`✅ Загружено ${users.size} пользователей`);
    } catch (e) {}
  }
}
function saveUsers() {
  fs.writeFileSync(DB_FILE, JSON.stringify([...users.values()], null, 2));
}
loadUsers();

// ── Команды бота ──
bot.onText(/\/start/, (msg) => {
  const { id, first_name, last_name, username } = msg.from;
  const name = [first_name, last_name].filter(Boolean).join(' ');
  if (!users.has(id)) {
    users.set(id, { id, name, username: username || null, date: new Date().toISOString() });
    saveUsers();
    console.log(`👤 Новый: ${name} (${id})`);
  }
  bot.sendMessage(id, `👋 Привет, ${first_name}!\n\nТы подписан на рассылку. Будем присылать важные новости и предложения.`);
});

bot.onText(/\/stop/, (msg) => {
  const { id, first_name } = msg.from;
  users.delete(id);
  saveUsers();
  bot.sendMessage(id, `👋 ${first_name}, ты отписан от рассылки.`);
});

bot.onText(/\/count/, (msg) => {
  if (String(msg.from.id) === String(ADMIN_ID)) {
    bot.sendMessage(msg.from.id, `📊 Подписчиков: *${users.size}*`, { parse_mode: 'Markdown' });
  }
});

// ── Middleware ──
app.use(cors());
app.use(express.json());

// Загрузка файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Раздача Mini App ──
app.use(express.static(path.join(__dirname, 'miniapp')));

// ── API ──
app.get('/api/status', (req, res) => {
  res.json({ ok: true, users: users.size });
});

app.get('/api/users', (req, res) => {
  const list = [...users.values()].map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    date: u.date,
    initials: u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
  }));
  res.json({ ok: true, count: list.length, users: list });
});

app.post('/api/blast', upload.array('files', 10), async (req, res) => {
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
          await bot.sendMessage(uid, text, { parse_mode: 'HTML' });
        } else {
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const caption = i === 0 ? (text || '') : '';
            if (f.mimetype.startsWith('image/')) {
              await bot.sendPhoto(uid, f.path, { caption, parse_mode: 'HTML' });
            } else {
              await bot.sendDocument(uid, f.path, { caption, parse_mode: 'HTML' });
            }
          }
        }
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        failed++;
        console.warn(`⚠️ Ошибка ${uid}: ${e.message}`);
      }
    }

    files.forEach(f => fs.unlink(f.path, () => {}));
    console.log(`📤 Отправлено: ${sent}, ошибок: ${failed}`);
    res.json({ ok: true, sent, failed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 BlastSend запущен на порту ${PORT}`);
  console.log(`👥 Пользователей: ${users.size}\n`);
});
