const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const client = new Client({ intents: [GatewayIntentBits.DirectMessages] });

// Configurazione
const CONFIG = {
  TOKEN: '',
  CLIENT_ID: '1468393153303416906',
  USER_ID: '1228667533930926131',
  TEMP_THRESHOLD: 85, // Celsius
  CHECK_INTERVAL: 30000, // 30 secondi
  STATE_FILE: path.join(__dirname, '.bot_state.json')
};

// Stato per evitare spam
let lastState = {
  cpu_high: false,
  temp_high: false,
  power_high: false,
  baseline_power: null
};

// Leggi stato salvato
function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE)) {
      const data = fs.readFileSync(CONFIG.STATE_FILE, 'utf8');
      lastState = JSON.parse(data);
    }
  } catch (err) {
    console.log('Stato non trovato, creazione nuovo...');
  }
}

// Salva stato
function saveState() {
  try {
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(lastState, null, 2));
  } catch (err) {
    console.error('Errore nel salvataggio dello stato:', err);
  }
}

// Ottieni temperatura CPU (Linux)
function getCPUTemp() {
  try {
    // Prova /sys/class/thermal (funziona in VM Proxmox)
    const thermalPath = '/sys/class/thermal/thermal_zone0/temp';
    if (fs.existsSync(thermalPath)) {
      const temp = parseInt(fs.readFileSync(thermalPath, 'utf8')) / 1000;
      return Math.round(temp * 10) / 10;
    }
    
    // Fallback: leggi da /proc/cpuinfo se disponibile
    return null;
  } catch (err) {
    console.error('Errore lettura temperatura:', err.message);
    return null;
  }
}

// Ottieni uso CPU (percentuale)
function getCPUUsage() {
  try {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    
    cpus.forEach(cpu => {
      for (type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const usage = 100 - ~~(100 * totalIdle / totalTick);
    return usage;
  } catch (err) {
    return null;
  }
}

// Ottieni uso memoria
function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    percentage: Math.round((used / total) * 100),
    used: Math.round(used / 1024 / 1024), // MB
    total: Math.round(total / 1024 / 1024)
  };
}

// Ottieni consumo energia (approssimativo da /sys)
function getPowerConsumption() {
  try {
    const powerPath = '/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj';
    if (fs.existsSync(powerPath)) {
      const energy = parseInt(fs.readFileSync(powerPath, 'utf8'));
      return energy / 1000000; // Microjoule to Joule
    }
    
    // Alternativa: stima da CPU usage e memoria
    const cpuUsage = getCPUUsage();
    const memUsage = getMemoryUsage().percentage;
    const estimated = (cpuUsage * 0.6 + memUsage * 0.4) * 1.5; // Stima grossolana
    return Math.round(estimated);
  } catch (err) {
    return null;
  }
}

// Invia alert DM
async function sendAlert(title, description, color = 0xff6b6b) {
  try {
    const user = await client.users.fetch(CONFIG.USER_ID);
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`ðŸš¨ ALERT PROXMOX - ${title}`)
      .setDescription(description)
      .setTimestamp()
      .setFooter({ text: 'Bot Monitor Proxmox' });
    
    await user.send({ embeds: [embed] });
    console.log(`[ALERT] ${title}: ${description}`);
  } catch (err) {
    console.error('Errore invio DM:', err.message);
  }
}

// Invia status report
async function sendStatusReport(temp, cpu, mem, power) {
  try {
    const user = await client.users.fetch(CONFIG.USER_ID);
    const embed = new EmbedBuilder()
      .setColor(0x51cf66)
      .setTitle('ðŸ“Š Status Proxmox')
      .setDescription('Report sistema in tempo reale')
      .addFields(
        { name: 'ðŸŒ¡ï¸ Temperatura CPU', value: temp ? `${temp}Â°C` : 'N/A', inline: true },
        { name: 'âš™ï¸ CPU Usage', value: `${cpu}%`, inline: true },
        { name: 'ðŸ’¾ Memoria', value: `${mem.percentage}% (${mem.used}/${mem.total} MB)`, inline: true },
        { name: 'âš¡ Consumo stimato', value: power ? `${power}W` : 'N/A', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Bot Monitor Proxmox' });
    
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error('Errore invio status:', err.message);
  }
}

// Monitor principale
async function monitor() {
  try {
    const temp = getCPUTemp();
    const cpu = getCPUUsage();
    const mem = getMemoryUsage();
    const power = getPowerConsumption();
    
    // Controlla temperatura
    if (temp && temp > CONFIG.TEMP_THRESHOLD && !lastState.temp_high) {
      lastState.temp_high = true;
      await sendAlert(
        'TEMPERATURA ALTA',
        `âš ï¸ CPU temperatura: **${temp}Â°C** (Soglia: ${CONFIG.TEMP_THRESHOLD}Â°C)`,
        0xff6b6b
      );
    } else if (temp && temp <= CONFIG.TEMP_THRESHOLD && lastState.temp_high) {
      lastState.temp_high = false;
      await sendAlert(
        'TEMPERATURA NORMALE',
        `âœ… CPU temperatura rientrata a livelli normali: ${temp}Â°C`,
        0x51cf66
      );
    }
    
    // Controlla CPU
    if (cpu > 80 && !lastState.cpu_high) {
      lastState.cpu_high = true;
      await sendAlert(
        'CPU ALTA',
        `âš ï¸ CPU usage: **${cpu}%** (Soglia: 80%)`,
        0xffa94d
      );
    } else if (cpu <= 80 && lastState.cpu_high) {
      lastState.cpu_high = false;
      await sendAlert(
        'CPU NORMALE',
        `âœ… CPU usage rientrato a livelli normali: ${cpu}%`,
        0x51cf66
      );
    }
    
    // Controlla consumo energetico
    if (!lastState.baseline_power && power) {
      lastState.baseline_power = power;
      console.log(`[INFO] Baseline power impostato a ${power}W`);
    }
    
    if (power && lastState.baseline_power) {
      const increase = ((power - lastState.baseline_power) / lastState.baseline_power) * 100;
      if (increase > 30 && !lastState.power_high) {
        lastState.power_high = true;
        await sendAlert(
          'CONSUMO ALTO',
          `âš ï¸ Consumo energetico: **${power}W** (+${Math.round(increase)}% da baseline ${lastState.baseline_power}W)`,
          0xff922b
        );
      } else if (increase <= 30 && lastState.power_high) {
        lastState.power_high = false;
        await sendAlert(
          'CONSUMO NORMALE',
          `âœ… Consumo energetico rientrato a livelli normali`,
          0x51cf66
        );
      }
    }
    
    console.log(`[CHECK] Temp: ${temp}Â°C | CPU: ${cpu}% | Mem: ${mem.percentage}% | Power: ${power}W`);
    
  } catch (err) {
    console.error('Errore nel monitor:', err.message);
  }
  
  saveState();
}

// Bot events
client.on('ready', () => {
  console.log(`âœ… Bot loggato come ${client.user.tag}`);
  console.log(`ðŸ“ User Target: ${CONFIG.USER_ID}`);
  console.log(`ðŸ”„ Check interval: ${CONFIG.CHECK_INTERVAL}ms`);
  
  // Invia messaggio di avvio
  client.users.fetch(CONFIG.USER_ID).then(user => {
    user.send('âœ… **Bot Monitor Proxmox ONLINE**\n\nInizia monitoraggio...');
  });
  
  // Avvia il monitor
  loadState();
  monitor();
  setInterval(monitor, CONFIG.CHECK_INTERVAL);
});

client.on('error', err => {
  console.error('Errore bot:', err);
});

client.on('messageCreate', msg => {
  if (msg.author.id !== CONFIG.USER_ID || msg.author.bot) return;
  
  // Comandi semplici
  if (msg.content === '!status') {
    const temp = getCPUTemp();
    const cpu = getCPUUsage();
    const mem = getMemoryUsage();
    const power = getPowerConsumption();
    sendStatusReport(temp, cpu, mem, power);
  }
});

// Login
client.login(CONFIG.TOKEN);
