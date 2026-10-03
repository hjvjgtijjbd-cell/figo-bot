const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');

// ==========================================
// ⚙️ الإعدادات والمعلومات الخاصة بك
// ==========================================
const TELEGRAM_BOT_TOKEN = '8897149412:AAE93kWJEJS5cbWXFnD0D4SFWz1H8yvPe0o'; 
const TELEGRAM_CHAT_ID = '8629177824';   

// 📱 اكتب رقم هاتفك الخاص بواتساب هنا بدون (+) (مثال للمغرب: 212600000000)
const MY_PHONE_NUMBER = '212600000000'; 

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

const blacklist = new Set();
const userMessageTracker = new Map();
const SPAM_THRESHOLD = 4;            
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
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '110.0.5563.64']
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(MY_PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n==================================================');
                console.log(`🔑 كود الربط الخاص بك هو: \x1b[32m${code}\x1b[0m`);
                console.log('📱 افتح واتساب -> الأجهزة المرتبطة -> الربط برقم الهاتف وادخل الكود أعلاه.');
                console.log('==================================================\n');

                sendTelegramAlert(`🔑 *كود الربط الجديد:* \`${code}\`\n\nقم بفتح واتساب ثم الأجهزة المرتبطة واختيار الربط برقم الهاتف وإدخال الكود.`);
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

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;
            const isGroup = sender.endsWith('@g.us');
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

            // الحماية من الثغرات والنصوص الملغومة
            if (text.length > 4000 || /[\u0610-\u061A\u064B-\u065F\u0670\u0D80-\u0DFF]{100,}/.test(text)) {
                console.log(`🚨 [تغرة تبنيد/كرش] تم كشف محاولة إسقاط الحساب من: ${sender}`);
                blacklist.add(sender);
                await sendTelegramAlert(`🚨 *محاولة تبنيد بتغرة (Bug Text)!*\nتم حظر الرقم أوتوماتيكياً:\n\`${sender}\``);
                if (!isGroup) await sock.updateBlockStatus(sender, 'block');
                return;
            }

            if (blacklist.has(sender)) return;

            // الحماية من السبام
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

            // كشف عمليات الاحتيال
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

            const smartDelayTime = Math.floor(Math.random() * 2500) + 2000;

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

    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update.message === null) {
                sendTelegramAlert(`🗑️ *رسالة ممسوحة (Anti-Delete)*\n\n*من:* \`${update.key.remoteJid}\`\n*ID:* \`${update.key.id}\``);
            }
        }
    });
}

startBot();
