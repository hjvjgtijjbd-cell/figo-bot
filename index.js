const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys')
const pino = require('pino')
const fs = require('fs')

let config = fs.existsSync('./config.json')? JSON.parse(fs.readFileSync('./config.json')) : { mode: null }

async function getAIReply(text, name){
  const key = process.env.GEMINI_API_KEY
  if(!key) return null
  try{
    const prompt = `انت مساعد مغربي ذكي، سميتك FIGO. كتهضر بدارجة مغربية زوينة ومحترمة وقصيرة. واحد سميتو ${name} قال ليك: "${text}". جاوبو كأنك مول النمرة الحقيقي مشغول، بذكاء وبدون ما تقول انك بوت. جاوب في سطر او سطرين فقط.`
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({contents:[{parts:[{text:prompt}]}]})
    })
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null
  }catch(e){ console.log("AI Error", e.message); return null }
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: pino({level:'silent'}), markOnlineOnConnect:false })
  if (!state.creds.registered){
    const num = process.argv[2]
    if(num){ await delay(2000); console.log("كود الربط:", await sock.requestPairingCode(num)) }
  }
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u)=>{
    if(u.connection==='open' &&!config.mode){
      const owner = sock.user.id.split(':')[0]+'@s.whatsapp.net'
      await sock.sendMessage(owner,{text:`🤖 *FIGO V3.2 AI*\n\nاختار المود:\n1 - 🛡️ حماية\n2 - 🧠 ذكاء اصطناعي\n3 - 👻 شبح + مضاد الحذف\n4 - 🔥 كلشي\n\nصيفط رقم`})
    }
    if(u.connection==='close' && u.lastDisconnect?.error?.output?.statusCode!==DisconnectReason.loggedOut) startBot()
  })

  sock.ev.on('messages.upsert', async ({messages})=>{
    for(const msg of messages){
      if(!msg.message) continue
      const from = msg.key.remoteJid
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
      const sender = msg.key.participant || from
      const owner = sock.user.id? sock.user.id.split(':')[0]+'@s.whatsapp.net':null
      const name = msg.pushName || "الصديق"

      if(msg.key.fromMe && owner && from===owner && ['1','2','3','4'].includes(text.trim())){
        config.mode=text.trim(); fs.writeFileSync('./config.json', JSON.stringify(config));
        await sock.sendMessage(from,{text:`✅ تم تفعيل المود ${config.mode} - البوت دابا ذكي 🧠`}); continue
      }
      if(!config.mode || msg.key.fromMe) continue

      if(config.mode==='2' || config.mode==='4'){
        const isGroup = from.endsWith('@g.us')
        const shouldReply =!isGroup || msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sock.user.id) || text.toLowerCase().includes('فيجو')
        if(shouldReply && text.length>0){
          await sock.sendPresenceUpdate('composing', from)
          const ai = await getAIReply(text, name)
          await delay(1000)
          if(ai) await sock.sendMessage(from,{text: ai, mentions: isGroup? [sender]:[]})
        }
      }
    }
  })
}
startBot()
