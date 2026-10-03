const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const readline = require('readline');

// ==========================================
// ⚙️ الإعدادات والمعلومات الخاصة بيك
// ==========================================
const TELEGRAM_BOT_TOKEN = 'ضع_هنا_TOKEN_ديال_تيليغرام'; 
const TELEGRAM_CHAT_ID = 'ضع_هنا_CHAT_ID_ديال_تيليغرام';   

// رقم هاتفك المربوط بواتساب (بدون رمز +) مثلاً: 212600000000
const MY_PHONE_NUMBER = '212600000000'; 

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

const blacklist = new Set();
const userMessageTracker = new Map();
const SPAM_THRESHOLD = 4;            // أقسى عدد رسائل فـ 8 ثواني
const SPAM_TIME_FRAME = 8000;        

const SCAM_WORDS = ['صيفط الكود', 'send code', 'كود التفعيل', 'ارسل الرمز', 'المبلغ', 'ربحت معنا'];
const PHISHING_PATTERNS = [/https?:\/\/[^\s]+/g, /wa\.me\/settings/i];

async function sendTelegramAlert(message) {
    try {
        await tgBot.sendMessage(TELEGRAM_CHAT_ID, `🤖 *[FIGO ANTI-BAN MAX V3]*\n\n${message}`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار تيليغرام:', error.message);
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // تم إيقاف الـ QR كود
        auth: state,
        // 🛡️ وضع الشبح الأقصى: التظاهر بأنك متصفح رسمي لتفادي خوارزميات الباند
        browser: ['Ubuntu', 'Chrome', '110.0.5563.64']
    });

    // 🔑 طريقة الربط بالكود (Pairing Code) بدل QR Code
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(MY_PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n==================================================');
                console.log(`🔑 كود الربط الخاص بك هو: \x1b[32m${code}\x1b[0m`);
                console.log('📱 افتح واتساب -> الأجهزة المرتبطة -> الربط برقم الهاتف وادخل الكود أعلاه.');
                console.log('==================================================\n');

                sendTelegramAlert(`🔑 *كود الربط الجديد:* \`${code}\``);
            } catch (err) {
                console.error('❌ خطأ في طلب كود الربط:', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('⚠️ تم قطع الاتصال. إعادة الاتصال:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ [FIGO BOT] متصل بنجاح ومحمّي ضد التغرات والبلاغات!');
            sendTelegramAlert('✅ البوت شغال دابا ومحمّي بنجاح!');
        }
    });

    // 📩 استقبال ومعالجة الرسائل بالحماية الفائقة
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const isGroup = sender.endsWith('@g.us');
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

            // 🛡️ 1. الحماية من رسائل التغرات والـ Bugs (Anti-Crash)
            // التغرات غالباً كتكون فيها أسطر ورموز غربية طويلة جداً كتبلوك الحساب
            if (text.length > 4000 || /[\u0610-\u061A\u064B-\u065F\u0670\u0D80-\u0DFF]{100,}/.test(text)) {
                console.log(`🚨 [تغرة تبنيد/كرش] تم كشف محاولة إسقاط الحساب من: ${sender}`);
                blacklist.add(sender);
                await sendTelegramAlert(`🚨 *محاولة تبنيد بتغرة (Bug Text)!*\nتم حظر الرقم أوتوماتيكياً:\n\`${sender}\``);
                if (!isGroup) await sock.updateBlockStatus(sender, 'block');
                return;
            }

            if (blacklist.has(sender)) return;

            // 🛡️ 2. الحماية من البلاغات والسبام (Anti-Report & Anti-Spam)
            const now = Date.now();
            const userData = userMessageTracker.get(sender) || { count: 0, lastMsgTime: now };

            if (now - userData.lastMsgTime < SPAM_TIME_FRAME) {
                userData.count += 1;
            } else {
                userData.count = 1;
                userData.lastMsgTime = now;
            }
            userMessageTracker.set(sender, userData);

            if (userData.count > SPAM_THRESHOLD) {
                blacklist.add(sender);
                console.log(`🚨 [حظر أوتوماتيكي] هجوم سبام من: ${sender}`);
                await sendTelegramAlert(`🚨 *هجوم سبام كيهدد الحساب!*\nتم حظر الرقم:\n\`${sender}\``);
                if (!isGroup) await sock.updateBlockStatus(sender, 'block');
                return;
            }

            // 🛡️ 3. كشف الشفارة والروابط الخبيثة
            const isScamWord = SCAM_WORDS.some(word => text.toLowerCase().includes(word));
            const isPhishingLink = PHISHING_PATTERNS.some(pattern => pattern.test(text));

            if (isScamWord || isPhishingLink) {
                blacklist.add(sender);
                await sendTelegramAlert(`⚠️ *محاولة احتيال!*\n*من:* \`${sender}\`\n*الرسالة:* ${text}`);
                if (!isGroup) {
                    await sock.sendMessage(sender, { text: '❌ تم حظرك تلقائياً.' });
                    await sock.updateBlockStatus(sender, 'block');
                }
                return;
            }

            // 🕒 التأخير الذكي لمنع خوارزميات واتساب من كشف البوت (Smart Delay)
            const smartDelayTime = Math.floor(Math.random() * 2500) + 2000; // بين 2 و 4.5 ثواني

            // 1. التفاعل فالخاص
            if (!isGroup) {
                const cleanText = text.trim().toLowerCase();
                if (cleanText === '+' || cleanText === 'سلام' || cleanText === 'salam') {
                    await delay(smartDelayTime);
                    await sock.sendMessage(sender, { 
                        text: 'وعليكم السلام! 👋 أنا بوت شغال فبلاصت مول الحساب، غايجاوبك فاش يرجع.' 
                    }, { quoted: msg });

                    sendTelegramAlert(`💬 *محادثة جديدة فالخاص*\n*من:* \`${sender}\`\n*الرسالة:* ${text}`);
                }
            }

            // 2. التفاعل فالمجموعات
            if (isGroup) {
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const mentionedJidList = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const isMentioned = mentionedJidList.includes(botNumber);
                const isCalled = text.toLowerCase().includes('فينك');

                if (isMentioned || isCalled) {
                    await delay(smartDelayTime);
                    await sock.sendMessage(sender, { 
                        text: 'أنا مشغول حالياً، البوت كيرد فبلاصتي! 🤖' 
                    }, { quoted: msg });

                    sendTelegramAlert(`👥 *تاغ فجروب*\n*المجموعة:* \`${sender}\`\n*النص:* ${text}`);
                }
            }

        } catch (err) {
            console.error('❌ خطأ في معالجة الرسالة:', err);
        }
    });

    // 👁️ مضاد الحذف (Anti-Delete)
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update.message === null) {
                sendTelegramAlert(`🗑️ *رسالة ممسوحة (Anti-Delete)*\n\n*من:* \`${update.key.remoteJid}\`\n*ID:* \`${update.key.id}\``);
            }
        }
    });
}

startBot();
