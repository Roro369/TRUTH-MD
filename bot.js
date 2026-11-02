require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(process.cwd(), 'session');

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function extractText(message) {
  if (!message) return '';
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentWithCaptionMessage?.message?.caption) return message.documentWithCaptionMessage.message.caption;
  return '';
}

async function sendText(sock, jid, text) {
  if (!jid) return;
  await sock.sendMessage(jid, { text });
}

async function handleCommand(sock, msg, senderJid, text) {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();

  if (!cleaned) return;

  if (lower === '/start' || lower === '!start') {
    await sendText(sock, senderJid, 'Hi! I am your WhatsApp bot.\n\nCommands:\n/start\n/help\n/ping\n/status\n/echo <message>');
    return;
  }

  if (lower === '/help' || lower === '!help' || lower === '/menu') {
    await sendText(sock, senderJid, 'Available commands:\n/start\n/help\n/ping\n/status\n/echo <message>');
    return;
  }

  if (lower === '/ping' || lower === '!ping') {
    await sendText(sock, senderJid, 'Pong! Bot is online.');
    return;
  }

  if (lower === '/status' || lower === '!status') {
    await sendText(sock, senderJid, 'Status: online ✅\nBot is running and ready.');
    return;
  }

  if (lower.startsWith('/echo ')) {
    const echoText = cleaned.slice(6).trim();
    await sendText(sock, senderJid, echoText || 'Please provide a message after /echo');
    return;
  }

  if (lower.startsWith('/')) {
    await sendText(sock, senderJid, 'Unknown command. Send /help to see available commands.');
    return;
  }

  await sendText(sock, senderJid, `You said: ${cleaned}`);
}

async function connectToWhatsApp() {
  ensureSessionDir();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: ['TRUTH-MD', 'Chrome', '1.0.0'],
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Scan this QR code in WhatsApp to connect the bot.');
    }

    if (connection === 'open') {
      console.log('WhatsApp bot connected successfully.');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting...', { shouldReconnect });

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log('Bot logged out. Delete the session folder and run the bot again to re-authenticate.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key?.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      const text = extractText(msg.message);

      if (!text || !senderJid) continue;

      console.log(`Message from ${senderJid}: ${text}`);
      await handleCommand(sock, msg, senderJid, text);
    }
  });
}

connectToWhatsApp().catch((error) => {
  console.error('Failed to start WhatsApp bot:', error);
  process.exit(1);
});
