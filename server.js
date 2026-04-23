const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const sim = {
  trafficLevel: 2,
  serverStates: ['InService', 'InService', 'Stopped'],
  rrIndex: 0,
};

const servers = [
  {
    id: 1,
    name: 'Server 1',
    ip: '10.0.1.10',
    az: 'Availability Zone A',
    meta: 'EC2 instance ready to receive traffic',
  },
  {
    id: 2,
    name: 'Server 2',
    ip: '10.0.2.10',
    az: 'Availability Zone B',
    meta: 'EC2 instance ready to receive traffic',
  },
  {
    id: 3,
    name: 'Server 3',
    ip: '10.0.3.10',
    az: 'Availability Zone C',
    meta: 'Available capacity for scale-out',
  },
];

function activeServerIndexes() {
  return sim.serverStates
    .map((s, i) => (s === 'InService' ? i : -1))
    .filter((i) => i >= 0);
}

function trafficText(level) {
  return level === 1 ? 'Low' : level === 2 ? 'Medium' : 'High';
}

function requestsPerSec(level) {
  return level === 1 ? 2 : level === 2 ? 4 : 8;
}

function healthyTargets() {
  return sim.serverStates.filter((s) => s === 'InService').length;
}

function chooseAssignedServer() {
  const active = activeServerIndexes();
  if (!active.length) return null;
  const idx = active[sim.rrIndex % active.length];
  sim.rrIndex = (sim.rrIndex + 1) % active.length;
  return servers[idx];
}

function snapshot() {
  return {
    trafficLevel: sim.trafficLevel,
    trafficLabel: trafficText(sim.trafficLevel),
    requestsPerSec: requestsPerSec(sim.trafficLevel),
    healthyTargets: healthyTargets(),
    serverStates: sim.serverStates.map((state, i) => ({
      ...servers[i],
      state,
    })),
  };
}

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/api/state', (_req, res) => {
  res.json(snapshot());
});

async function getImdsToken() {
  const res = await fetch('http://169.254.169.254/latest/api/token', {
    method: 'PUT',
    headers: {
      'X-aws-ec2-metadata-token-ttl-seconds': '21600'
    }
  });

  return res.text();
}

async function meta(path, token) {
  const res = await fetch(`http://169.254.169.254/latest/meta-data/${path}`, {
    headers: {
      'X-aws-ec2-metadata-token': token
    }
  });

  return res.text();
}

app.get('/api/server-info', async (_req, res) => {
  try {
    const token = await getImdsToken();

    const [instanceId, privateIp, az] = await Promise.all([
      meta('instance-id', token),
      meta('local-ipv4', token),
      meta('placement/availability-zone', token)
    ]);

    let assignedServerId = 1;
    let assignedServerName = 'Server 1';

    if (privateIp === '172.31.39.162') {
      assignedServerId = 2;
      assignedServerName = 'Server 2';
    }

    if (privateIp === '172.31.40.97') {
      assignedServerId = 3;
      assignedServerName = 'Server 3';
    }

    res.json({
      assignedServerId,
      assignedServerName,
      instanceId,
      privateIp,
      availabilityZone: az
    });

  } catch (err) {
    // Fallback for local development - simulate EC2 metadata
    console.log('EC2 metadata not available, using fallback for local development');
    
    // Simulate different private IPs for round-robin testing
    const simulatedIps = ['10.0.1.10', '10.0.2.10', '10.0.3.10'];
    const randomIp = simulatedIps[Math.floor(Math.random() * simulatedIps.length)];
    
    let assignedServerId = 1;
    let assignedServerName = 'Server 1';
    
    if (randomIp === '10.0.2.10') {
      assignedServerId = 2;
      assignedServerName = 'Server 2';
    }
    
    if (randomIp === '10.0.3.10') {
      assignedServerId = 3;
      assignedServerName = 'Server 3';
    }

    res.json({
      assignedServerId,
      assignedServerName,
      instanceId: 'i-' + Math.random().toString(36).substr(2, 8),
      privateIp: randomIp,
      availabilityZone: 'us-east-1a'
    });
  }
});

app.post('/api/traffic/increase', (_req, res) => {
  if (sim.trafficLevel < 3) sim.trafficLevel += 1;

  if (sim.trafficLevel >= 2 && sim.serverStates[1] === 'Stopped') {
    sim.serverStates[1] = 'InService';
  }

  if (sim.trafficLevel === 3 && sim.serverStates[2] === 'Stopped') {
    sim.serverStates[2] = 'Launching';
    setTimeout(() => {
      sim.serverStates[2] = 'InService';
    }, 2200);
  }

  res.json(snapshot());
});

app.post('/api/traffic/reduce', (_req, res) => {
  if (sim.trafficLevel > 1) sim.trafficLevel -= 1;

  if (sim.trafficLevel === 2 && sim.serverStates[2] === 'InService') {
    sim.serverStates[2] = 'Draining';
    setTimeout(() => {
      sim.serverStates[2] = 'Stopped';
    }, 2200);
  } else if (sim.trafficLevel === 1 && sim.serverStates[1] === 'InService') {
    sim.serverStates[1] = 'Draining';
    setTimeout(() => {
      sim.serverStates[1] = 'Stopped';
    }, 2200);
  }

  res.json(snapshot());
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AWS ELB + ASG Demo</title>
  <style>
    :root {
      --bg: #f5f7fc;
      --panel: rgba(255,255,255,0.9);
      --text: #1f2940;
      --muted: #6d7890;
      --purple: #6f52ed;
      --purple-dark: #5738d7;
      --line: #826de0;
      --green: #22a447;
      --green-soft: #e9f8ee;
      --orange: #ef9418;
      --orange-soft: #fff2e2;
      --blue: #2384f5;
      --blue-soft: #e9f3ff;
      --red: #df4f55;
      --red-soft: #ffe9eb;
      --gray: #7d879d;
      --gray-soft: #eef1f6;
      --navy: #202846;
      --shadow: 0 14px 34px rgba(35, 45, 78, 0.08);
      --shadow-soft: 0 10px 22px rgba(35, 45, 78, 0.06);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, Arial, sans-serif;
      background: radial-gradient(circle at top left, rgba(111,82,237,0.08), transparent 24%), var(--bg);
      color: var(--text);
    }

    .page {
      max-width: 1560px;
      margin: 0 auto;
      padding: 14px;
    }

    .frame {
      background: rgba(255,255,255,0.76);
      border: 1px solid #dde3f0;
      border-radius: 30px;
      box-shadow: var(--shadow);
      padding: 18px 18px 20px;
      backdrop-filter: blur(8px);
    }

    .topbar {
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
      align-items: center;
      justify-items: center;
      margin-bottom: 22px;
      padding-top: 2px;
    }

    .title-block {
      text-align: center;
      padding-bottom: 14px;
    }

    .title-block h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: -0.03em;
      font-weight: 900;
    }

    .title-block p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 15px;
    }

    .toolbar {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      flex-wrap: wrap;
    }

    .top-controls {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .traffic-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border-radius: 999px;
      padding: 12px 16px;
      font-weight: 800;
      box-shadow: var(--shadow-soft);
      background: white;
      border: 1px solid #e2e7f2;
    }

    .traffic-pill .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 6px rgba(34,164,71,0.12);
    }

    .btn {
      border: 1px solid #dfe4ef;
      background: #fff;
      color: #2a3454;
      border-radius: 16px;
      min-width: 154px;
      height: 54px;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 900;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: var(--shadow-soft);
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, background .18s ease, color .18s ease, border-color .18s ease;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 26px rgba(35, 46, 79, 0.12);
      border-color: #cfd8eb;
    }

    .btn:active { transform: translateY(0); }

    .btn.primary {
      min-width: 230px;
      background: linear-gradient(135deg, #7d58f0, #5a38d4);
      color: #fff;
      border: 0;
    }

    .btn.primary:hover {
      box-shadow: 0 16px 30px rgba(90, 56, 212, 0.28);
      filter: brightness(1.03);
    }

    .btn-icon { font-size: 20px; line-height: 1; }

    .canvas {
      position: relative;
      width: 100%;
      max-width: 1480px;
      height: 600px;
      margin: 0 auto 16px;
      display: grid;
      grid-template-columns: 220px 320px 1fr;
      align-items: center;
      column-gap: 46px;
      padding: 14px 12px 0;
    }

    .left-col, .center-col, .right-col {
      position: relative;
      z-index: 2;
    }

    .left-col, .center-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .left-col { gap: 14px; padding-top: 40px; }
    .center-col { gap: 18px; }
    .right-col { display: flex; justify-content: flex-end; align-items: center; }

    .speech {
      width: 332px;
      background: white;
      border: 3px solid #7a5cf8;
      border-radius: 22px;
      padding: 16px 18px;
      text-align: center;
      font-size: 18px;
      line-height: 1.2;
      box-shadow: var(--shadow-soft);
      position: relative;
    }

    .speech::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -10px;
      width: 20px;
      height: 20px;
      background: white;
      border-right: 3px solid #7a5cf8;
      border-bottom: 3px solid #7a5cf8;
      transform: translateX(-50%) rotate(45deg);
    }

    .user-wrap { width: 160px; text-align: center; }

    .user-circle {
      width: 118px;
      height: 118px;
      margin: 0 auto;
      border-radius: 50%;
      background: white;
      border: 5px solid var(--purple);
      box-shadow: var(--shadow-soft);
      position: relative;
    }

    .user-circle::before {
      content: '';
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--purple);
      left: 50%;
      top: 26px;
      transform: translateX(-50%);
    }

    .user-circle::after {
      content: '';
      position: absolute;
      width: 72px;
      height: 42px;
      background: var(--purple);
      left: 50%;
      bottom: 26px;
      transform: translateX(-50%);
      border-radius: 42px 42px 16px 16px;
    }

    .entity-label {
      margin-top: 12px;
      font-size: 21px;
      font-weight: 900;
      color: #28385d;
      letter-spacing: -0.02em;
      text-align: center;
    }

    .small-metric {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: white;
      border: 1px solid #e4e9f4;
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
      box-shadow: var(--shadow-soft);
    }

    .small-metric strong { color: var(--text); }

    .lb-wrap { width: 260px; text-align: center; }

    .lb-box {
      width: 188px;
      height: 188px;
      margin: 0 auto;
      border-radius: 32px;
      background: linear-gradient(135deg, #8b69ff, #6039da);
      box-shadow: 0 22px 42px rgba(111,82,237,0.24), inset 0 2px 0 rgba(255,255,255,0.14);
      display: grid;
      place-items: center;
      position: relative;
    }

    .lb-box::after {
      content: '';
      position: absolute;
      inset: 8px;
      border-radius: 26px;
      box-shadow: inset 0 0 0 2px rgba(255,255,255,0.06);
    }

    .lb-icon { width: 92px; height: 92px; position: relative; z-index: 1; }
    .lb-square, .lb-node { position: absolute; background: white; box-shadow: 0 4px 8px rgba(255,255,255,0.14); }
    .lb-square { width: 26px; height: 26px; left: 33px; top: 0; border-radius: 6px; }
    .lb-node { width: 26px; height: 26px; border-radius: 50%; top: 54px; }
    .lb-node.left { left: 0; }
    .lb-node.mid { left: 33px; }
    .lb-node.right { right: 0; }
    .lb-line { position: absolute; background: white; border-radius: 999px; }
    .lb-line.v { left: 43px; top: 19px; width: 6px; height: 44px; }
    .lb-line.h1 { left: 10px; top: 64px; width: 38px; height: 6px; }
    .lb-line.h2 { left: 44px; top: 64px; width: 38px; height: 6px; }

    .lb-subtext {
      margin-top: 10px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.35;
    }

    .cloud-wrap {
      width: 560px;
      background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(249,246,255,0.98));
      border: 3px solid #d9cdfb;
      border-radius: 28px;
      box-shadow: var(--shadow-soft);
      padding: 18px 18px 18px;
      justify-self: end;
    }

    .cloud-title {
      text-align: center;
      font-size: 30px;
      font-weight: 900;
      margin-bottom: 14px;
      letter-spacing: -0.03em;
    }

    .server-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .server-card {
      position: relative;
      min-height: 132px;
      border-radius: 24px;
      background: rgba(255,255,255,0.98);
      box-shadow: 0 12px 24px rgba(35, 46, 79, 0.06);
      padding: 18px 18px 14px;
      display: flex;
      align-items: center;
      gap: 18px;
      transition: transform .24s ease, box-shadow .24s ease, opacity .24s ease, background .24s ease, border-color .24s ease;
      opacity: 1;
      border: 3px solid var(--navy);
    }

    .server-card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 24px;
      padding: 3px;
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    .server-card.green::before, .server-card.orange::before, .server-card.blue::before {
      background: linear-gradient(90deg, #202846, rgba(32,40,70,0.18));
    }
    .server-card.gray::before, .server-card.stopped::before { background: linear-gradient(90deg, #b9c0cf, rgba(185,192,207,0.30)); }
    .server-card.purple::before { background: linear-gradient(90deg, #7b5df8, rgba(123,93,248,0.30)); }
    .server-card.assigned::before { background: linear-gradient(90deg, #21a53e, rgba(33,165,62,0.45)); }
    .server-card.draining::before { background: linear-gradient(90deg, #df4f55, rgba(223,79,85,0.42)); }

    .server-card.active {
      transform: translateY(-1px) scale(1.008);
      box-shadow: 0 0 0 7px rgba(114,81,235,0.09), 0 16px 30px rgba(35, 46, 79, 0.10);
    }

    .server-card.assigned {
      background: linear-gradient(135deg, #f4fff7, #ebfff1);
      border-color: var(--green);
      box-shadow: 0 0 0 8px rgba(34,164,71,0.12), 0 16px 30px rgba(35, 46, 79, 0.10);
    }

    .server-card.launching { background: linear-gradient(135deg, #ffffff, #faf7ff); border-color: #7b5df8; }
    .server-card.draining { background: linear-gradient(135deg, #fff4f4, #ffe9e9); border-color: var(--red); }
    .server-card.stopped { border-color: #b9c0cf; }
    .server-card.hidden-slot { opacity: 0.36; filter: saturate(0.1); }

    .state-badge, .az-badge {
      position: absolute;
      top: 10px;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.03em;
    }

    .az-badge { left: 16px; }
    .state-badge { right: 16px; }

    .server-card.green .az-badge, .server-card.green .state-badge,
    .server-card.orange .az-badge, .server-card.orange .state-badge,
    .server-card.blue .az-badge, .server-card.blue .state-badge { background: #f3f5fa; color: var(--navy); }
    .server-card.purple .az-badge, .server-card.purple .state-badge { background: #efeaff; color: var(--purple); }
    .server-card.gray .az-badge, .server-card.gray .state-badge,
    .server-card.stopped .az-badge, .server-card.stopped .state-badge { background: var(--gray-soft); color: var(--gray); }
    .server-card.assigned .az-badge, .server-card.assigned .state-badge { background: var(--green-soft); color: var(--green); }
    .server-card.draining .az-badge, .server-card.draining .state-badge { background: var(--red-soft); color: var(--red); }

    .server-visual {
      width: 132px;
      flex: 0 0 132px;
      margin-top: 22px;
    }

    .server-unit {
      width: 132px;
      height: 82px;
      border-radius: 20px;
      background: radial-gradient(circle at top left, #34415c, #171d29 72%);
      box-shadow: inset 0 0 0 6px rgba(255,255,255,0.05), 0 12px 20px rgba(21,27,39,0.16);
      position: relative;
      overflow: hidden;
    }

    .blade {
      position: absolute;
      left: 12px;
      right: 12px;
      height: 20px;
      border-radius: 14px;
      background: linear-gradient(180deg, #0f1420, #1b2432);
      box-shadow: inset 0 0 0 2px rgba(255,255,255,0.04);
    }

    .blade.one { top: 7px; }
    .blade.two { top: 31px; }
    .blade.three { top: 55px; }

    .blade::before {
      content: '';
      position: absolute;
      left: 14px;
      top: 5px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 21px 0 0 currentColor, 42px 0 0 currentColor;
      animation: blink 1.5s infinite ease-in-out;
    }

    .blade::after {
      content: '';
      position: absolute;
      right: 14px;
      top: 4px;
      width: 28px;
      height: 11px;
      border-radius: 10px;
      background: rgba(255,255,255,0.08);
    }

    .server-card.green .blade,
    .server-card.orange .blade,
    .server-card.blue .blade,
    .server-card.purple .blade,
    .server-card.gray .blade { color: #ffffff; }
    .server-card.assigned .blade { color: #1ce557; }
    .server-card.draining .blade { color: #ff7e86; }
    .server-card.stopped .blade { color: #d8deea; }

    .server-glow {
      width: 100px;
      height: 7px;
      margin: 7px auto 0;
      border-radius: 999px;
      filter: blur(1px);
      opacity: 0.95;
    }

    .server-card.green .server-glow,
    .server-card.orange .server-glow,
    .server-card.blue .server-glow,
    .server-card.purple .server-glow { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent); }
    .server-card.gray .server-glow,
    .server-card.stopped .server-glow { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent); }
    .server-card.assigned .server-glow { background: linear-gradient(90deg, transparent, rgba(34,166,62,0.8), transparent); }
    .server-card.draining .server-glow { background: linear-gradient(90deg, transparent, rgba(223,79,85,0.85), transparent); }

    .server-copy { flex: 1; margin-top: 10px; }

    .server-name {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }

    .server-card.green .server-name,
    .server-card.orange .server-name,
    .server-card.blue .server-name { color: var(--navy); }
    .server-card.purple .server-name { color: var(--purple); }
    .server-card.gray .server-name,
    .server-card.stopped .server-name { color: var(--gray); }
    .server-card.assigned .server-name { color: var(--green); }
    .server-card.draining .server-name { color: var(--red); }

    .server-ip {
      font-size: 16px;
      font-weight: 800;
      color: #5a6781;
      margin-bottom: 6px;
    }

    .server-meta {
      font-size: 12px;
      color: var(--muted);
      font-weight: 700;
    }

    .flow-layer {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
    }

    .path-svg {
      position: absolute;
      pointer-events: none;
      overflow: visible;
    }

    .packet {
      position: absolute;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #9a7cff, #6a43e6 70%);
      border: 3px solid rgba(255,255,255,0.98);
      box-shadow: 0 6px 16px rgba(114,81,235,0.26);
      opacity: 0;
      z-index: 4;
      pointer-events: none;
    }

    .packet::before {
      content: '';
      position: absolute;
      inset: -7px;
      border-radius: 50%;
      border: 2px solid rgba(114,81,235,0.16);
    }

    .bottom-row { display: block; margin-top: 20px; }

    .status-card {
      min-height: 112px;
      border-radius: 22px;
      background: rgba(255,255,255,0.92);
      border: 1px solid #dddff4;
      box-shadow: var(--shadow-soft);
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      text-align: center;
      width: 100%;
      margin-top: 6px;
    }

    .status-icon-wrap {
      width: 82px;
      height: 82px;
      border-radius: 50%;
      background: rgba(114,81,235,0.12);
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }

    .status-icon {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: linear-gradient(135deg, #8c66ff, #6a44e6);
      color: white;
      display: grid;
      place-items: center;
      font-size: 28px;
      font-weight: 900;
      box-shadow: 0 8px 20px rgba(114,81,235,0.24);
    }

    .status-copy {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .status-main {
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .status-main .green { color: var(--green); }
    .status-main .orange { color: var(--orange); }
    .status-main .blue { color: var(--blue); }
    .status-main .purple { color: var(--purple); }
    .status-main .gray { color: var(--gray); }

    .status-sub {
      font-size: 15px;
      color: var(--muted);
      line-height: 1.4;
      max-width: 760px;
    }

    @keyframes blink {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }

    @media (max-width: 1480px) {
      .frame { overflow-x: auto; }
      .canvas, .bottom-row, .topbar, .toolbar { width: 1480px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="frame">
      <div class="topbar">
        <div class="title-block">
          <h1>Scalable Web Application on AWS</h1>
          <p>Visualizing Elastic Load Balancing and Auto Scaling Group behavior</p>
        </div>
        <div class="toolbar">
          <div class="top-controls">
            <button class="btn primary" id="sendRequest"><span class="btn-icon">✈</span>Send Request</button>
            <button class="btn" id="autoDemo"><span class="btn-icon">▶</span>Auto Demo</button>
            <button class="btn" id="stopDemo"><span class="btn-icon">■</span>Stop</button>
            <button class="btn" id="increaseTraffic"><span class="btn-icon">⬆</span>Increase Traffic</button>
            <button class="btn" id="reduceTraffic"><span class="btn-icon">⬇</span>Reduce Traffic</button>
          </div>
          <div class="traffic-pill" id="trafficPill">
            <span class="dot" id="trafficDot"></span>
            <span>Traffic Level: <strong id="trafficLevelText">Medium</strong></span>
          </div>
        </div>
      </div>

      <div class="canvas" id="canvas">
        <div class="flow-layer">
          <svg class="path-svg" id="pathUser"></svg>
          <svg class="path-svg" id="pathS1"></svg>
          <svg class="path-svg" id="pathS2"></svg>
          <svg class="path-svg" id="pathS3"></svg>
          <div class="packet" id="packet1"></div>
          <div class="packet" id="packet2"></div>
        </div>

        <div class="left-col">
          <div class="user-wrap">
            <div class="user-circle"></div>
            <div class="entity-label">User</div>
            <div class="small-metric">Requests/sec: <strong id="rpsLabel">4</strong></div>
          </div>
        </div>

        <div class="center-col">
          <div class="speech">Which server<br>should receive this request?</div>
          <div class="lb-wrap">
            <div class="lb-box">
              <div class="lb-icon">
                <div class="lb-square"></div>
                <div class="lb-node left"></div>
                <div class="lb-node mid"></div>
                <div class="lb-node right"></div>
                <div class="lb-line v"></div>
                <div class="lb-line h1"></div>
                <div class="lb-line h2"></div>
              </div>
            </div>
            <div class="entity-label">Load Balancer</div>
            <div class="lb-subtext">Application Load Balancer<br>Healthy Targets: <strong id="healthyTargetsLabel">2</strong></div>
          </div>
        </div>

        <div class="right-col">
          <div class="cloud-wrap">
            <div class="cloud-title">☁ AWS Cloud</div>
            <div class="server-list">
              <div class="server-card green" id="server1Card">
                <div class="az-badge">Availability Zone A</div>
                <div class="state-badge" id="server1State">InService</div>
                <div class="server-visual">
                  <div class="server-unit">
                    <div class="blade one"></div>
                    <div class="blade two"></div>
                    <div class="blade three"></div>
                  </div>
                  <div class="server-glow"></div>
                </div>
                <div class="server-copy">
                  <div class="server-name">Server 1</div>
                  <div class="server-ip">10.0.1.10</div>
                  <div class="server-meta">EC2 instance ready to receive traffic</div>
                </div>
              </div>

              <div class="server-card orange" id="server2Card">
                <div class="az-badge">Availability Zone B</div>
                <div class="state-badge" id="server2State">InService</div>
                <div class="server-visual">
                  <div class="server-unit">
                    <div class="blade one"></div>
                    <div class="blade two"></div>
                    <div class="blade three"></div>
                  </div>
                  <div class="server-glow"></div>
                </div>
                <div class="server-copy">
                  <div class="server-name">Server 2</div>
                  <div class="server-ip">10.0.2.10</div>
                  <div class="server-meta">EC2 instance ready to receive traffic</div>
                </div>
              </div>

              <div class="server-card gray hidden-slot" id="server3Card">
                <div class="az-badge">Availability Zone C</div>
                <div class="state-badge" id="server3State">Stopped</div>
                <div class="server-visual">
                  <div class="server-unit">
                    <div class="blade one"></div>
                    <div class="blade two"></div>
                    <div class="blade three"></div>
                  </div>
                  <div class="server-glow"></div>
                </div>
                <div class="server-copy">
                  <div class="server-name">Server 3</div>
                  <div class="server-ip">10.0.3.10</div>
                  <div class="server-meta">Available capacity for scale-out</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bottom-row">
        <div class="status-card">
          <div class="status-icon-wrap"><div class="status-icon">✓</div></div>
          <div class="status-copy">
            <div class="status-main" id="statusMain">Ready to demonstrate <span class="purple">Load Balancing</span></div>
            <div class="status-sub" id="statusSub">Requests flow from the user to the Application Load Balancer, then to healthy EC2 instances managed by the Auto Scaling Group.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('canvas');
    const packet1 = document.getElementById('packet1');
    const packet2 = document.getElementById('packet2');
    const sendBtn = document.getElementById('sendRequest');
    const autoBtn = document.getElementById('autoDemo');
    const stopBtn = document.getElementById('stopDemo');
    const incBtn = document.getElementById('increaseTraffic');
    const decBtn = document.getElementById('reduceTraffic');
    const statusMain = document.getElementById('statusMain');
    const statusSub = document.getElementById('statusSub');
    const healthyTargetsLabel = document.getElementById('healthyTargetsLabel');
    const trafficLevelText = document.getElementById('trafficLevelText');
    const trafficDot = document.getElementById('trafficDot');
    const rpsLabel = document.getElementById('rpsLabel');

    const serverCards = [
      document.getElementById('server1Card'),
      document.getElementById('server2Card'),
      document.getElementById('server3Card')
    ];

    const serverStateEls = [
      document.getElementById('server1State'),
      document.getElementById('server2State'),
      document.getElementById('server3State')
    ];

    const pathSvgs = {
      user: document.getElementById('pathUser'),
      s1: document.getElementById('pathS1'),
      s2: document.getElementById('pathS2'),
      s3: document.getElementById('pathS3')
    };

    const state = {
      autoTimer: null,
      busy: false,
      currentIndex: 0,
      trafficLevel: 2,
      serverStates: ['InService', 'InService', 'Stopped'],
      points: {}
    };

    function pointOnRightCenter(el, offset) {
      const parent = canvas.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return { x: rect.left - parent.left + rect.width + offset, y: rect.top - parent.top + rect.height / 2 };
    }

    function pointOnLeftCenter(el, offset) {
      const parent = canvas.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return { x: rect.left - parent.left - offset, y: rect.top - parent.top + rect.height / 2 };
    }

    function drawSvgCurve(svgEl, from, to, bendX, refX = 10) {
      const left = Math.min(from.x, to.x) - 36;
      const top = Math.min(from.y, to.y) - 36;
      const width = Math.abs(to.x - from.x) + 96;
      const height = Math.abs(to.y - from.y) + 86;
      const startX = from.x - left;
      const startY = from.y - top;
      const endX = to.x - left;
      const endY = to.y - top;
      const controlX1 = startX + bendX;
      const controlY1 = startY;
      const controlX2 = endX - bendX;
      const controlY2 = endY;

      svgEl.setAttribute('width', width);
      svgEl.setAttribute('height', height);
      svgEl.style.left = left + 'px';
      svgEl.style.top = top + 'px';
      svgEl.innerHTML = '';

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      const markerId = 'arrow-' + Math.random().toString(36).slice(2, 8);
      marker.setAttribute('id', markerId);
      marker.setAttribute('viewBox', '0 0 20 20');
      marker.setAttribute('refX', String(refX));
      marker.setAttribute('refY', '10');
      marker.setAttribute('markerWidth', '18');
      marker.setAttribute('markerHeight', '18');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'userSpaceOnUse');

      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrow.setAttribute('d', 'M 0 0 L 20 10 L 0 20 z');
      arrow.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--line').trim());
      marker.appendChild(arrow);
      defs.appendChild(marker);
      svgEl.appendChild(defs);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M ' + startX + ' ' + startY + ' C ' + controlX1 + ' ' + controlY1 + ', ' + controlX2 + ' ' + controlY2 + ', ' + endX + ' ' + endY);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--line').trim());
      path.setAttribute('stroke-width', '5');
      path.setAttribute('stroke-dasharray', '11 10');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('marker-end', 'url(#' + markerId + ')');
      svgEl.appendChild(path);
    }

    function setupPaths() {
      const user = pointOnRightCenter(document.querySelector('.user-circle'), 14);
      const lbIn = pointOnLeftCenter(document.querySelector('.lb-box'), 14);
      const lbOut = pointOnRightCenter(document.querySelector('.lb-box'), 14);
      const s1 = pointOnLeftCenter(document.getElementById('server1Card'), 28);
      const s2 = pointOnLeftCenter(document.getElementById('server2Card'), 28);
      const s3 = pointOnLeftCenter(document.getElementById('server3Card'), 28);

      state.points = {
        user, lbIn,
        out1: { x: lbOut.x, y: lbOut.y - 52 },
        out2: { x: lbOut.x, y: lbOut.y },
        out3: { x: lbOut.x, y: lbOut.y + 52 },
        s1, s2, s3
      };

      drawSvgCurve(pathSvgs.user, user, lbIn, 62, 12);
      drawSvgCurve(pathSvgs.s1, state.points.out1, s1, 88, 9);
      drawSvgCurve(pathSvgs.s2, state.points.out2, s2, 88, 9);
      drawSvgCurve(pathSvgs.s3, state.points.out3, s3, 88, 9);
    }

    function movePacket(packet, from, to, duration) {
      return new Promise((resolve) => {
        packet.style.opacity = '1';
        packet.style.left = (from.x - 11) + 'px';
        packet.style.top = (from.y - 11) + 'px';
        packet.style.transition = 'none';
        void packet.offsetWidth;
        packet.style.transition = 'left ' + duration + 'ms linear, top ' + duration + 'ms linear, opacity 180ms ease';
        packet.style.left = (to.x - 11) + 'px';
        packet.style.top = (to.y - 11) + 'px';
        setTimeout(resolve, duration + 35);
      });
    }

    function clearPacket(packet) { packet.style.opacity = '0'; }
    function trafficText(level) { return level === 1 ? 'Low' : level === 2 ? 'Medium' : 'High'; }
    function rpsForLevel(level) { return level === 1 ? 2 : level === 2 ? 4 : 8; }

    function updateTrafficUI() {
      trafficLevelText.textContent = trafficText(state.trafficLevel);
      trafficDot.style.background = state.trafficLevel === 1 ? 'var(--green)' : state.trafficLevel === 2 ? 'var(--orange)' : 'var(--red)';
      trafficDot.style.boxShadow = state.trafficLevel === 1
        ? '0 0 0 6px rgba(34,164,71,0.12)'
        : state.trafficLevel === 2
          ? '0 0 0 6px rgba(239,148,24,0.12)'
          : '0 0 0 6px rgba(223,79,85,0.12)';
      rpsLabel.textContent = String(rpsForLevel(state.trafficLevel));
    }

    function renderServers() {
      const classMap = state.serverStates.map((s, i) => {
        if (s === 'InService') return i === 0 ? 'green' : i === 1 ? 'orange' : 'blue';
        if (s === 'Launching') return 'purple';
        if (s === 'Draining') return 'draining';
        return 'stopped';
      });

      serverCards.forEach((card, i) => {
        card.className = 'server-card';
        card.classList.add(classMap[i]);
        if (state.serverStates[i] === 'Launching') card.classList.add('launching');
        if (state.serverStates[i] === 'Draining') card.classList.add('draining');
        if (state.serverStates[i] === 'Stopped') {
          card.classList.add('stopped');
          card.classList.add('hidden-slot');
        }
        serverStateEls[i].textContent = state.serverStates[i];
      });

      healthyTargetsLabel.textContent = String(state.serverStates.filter(s => s === 'InService').length);
    }

    function activeServerIndexes() {
      return state.serverStates.map((s, i) => s === 'InService' ? i : -1).filter(i => i >= 0);
    }

    function activateServer(index) {
      serverCards.forEach(card => {
        card.classList.remove('active');
        card.classList.remove('assigned');
      });
      if (index >= 0 && serverCards[index]) {
        serverCards[index].classList.add('active');
        serverCards[index].classList.add('assigned');
      }
    }

    function colorClass(index) {
      return index === 0 ? 'green' : index === 1 ? 'orange' : 'blue';
    }

    async function sendRequest(targetIndex) {
      if (state.busy) return;
      const active = activeServerIndexes();
      if (!active.length) return;
      state.busy = true;

      const idx = typeof targetIndex === 'number' ? targetIndex : active[state.currentIndex % active.length];
      state.currentIndex = (state.currentIndex + 1) % active.length;

      activateServer(-1);
      statusMain.innerHTML = 'User sends request to <span class="purple">Load Balancer</span>';
      statusSub.textContent = 'The Application Load Balancer first receives the incoming request.';
      await movePacket(packet1, state.points.user, state.points.lbIn, 720);
      clearPacket(packet1);

      const out = state.points['out' + (idx + 1)];
      const target = state.points['s' + (idx + 1)];
      statusMain.innerHTML = 'Load Balancer forwards request to <span class="' + colorClass(idx) + '">Server ' + (idx + 1) + '</span>';
      statusSub.textContent = 'It selects one healthy EC2 instance from the target group.';
      await movePacket(packet2, out, target, 760);
      clearPacket(packet2);

      activateServer(idx);
      statusMain.innerHTML = 'Request delivered to <span class="' + colorClass(idx) + '">Server ' + (idx + 1) + '</span>';
      statusSub.textContent = 'This backend server now handles the request and returns the response.';
      setTimeout(() => { state.busy = false; }, 220);
    }

    async function requestAssignedServerAndAnimate() {
      if (state.busy) return;

      try {
        const res = await fetch('/api/server-info');
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to get server info');
        }

        const ipToIndex = {
          '10.0.1.10': 0,
          '10.0.2.10': 1,
          '10.0.3.10': 2,
        };

        const assignedIndex = ipToIndex[data.privateIp];

        if (assignedIndex === undefined) {
          statusMain.textContent = 'Unknown backend server';
          statusSub.textContent = 'Received response from ' + data.instanceId + ' (' + data.privateIp + ') in ' + data.availabilityZone + ', but no UI card matches that IP yet.';
          return;
        }

        await sendRequest(assignedIndex);
      } catch (err) {
        console.error(err);
        statusMain.textContent = 'Request failed';
        statusSub.textContent = 'Could not get assigned server information from the real EC2 instance.';
      }
    }

    async function scaleOutToThree() {
      if (state.serverStates[2] === 'InService' || state.serverStates[2] === 'Launching') return;
      state.serverStates[2] = 'Launching';
      renderServers();
      statusMain.innerHTML = 'High traffic detected — <span class="purple">ASG scaling out</span>';
      statusSub.textContent = 'Auto Scaling is launching a new EC2 instance in Availability Zone C.';
      await new Promise(r => setTimeout(r, 2200));
      state.serverStates[2] = 'InService';
      renderServers();
      statusMain.innerHTML = 'Server 3 is now <span class="blue">InService</span>';
      statusSub.textContent = 'The new instance is healthy and can now receive requests from the load balancer.';
    }

    async function scaleInStep() {
      if (state.trafficLevel === 2 && state.serverStates[2] === 'InService') {
        state.serverStates[2] = 'Draining';
        renderServers();
        statusMain.innerHTML = 'Traffic reduced — <span class="orange">Server 3 draining</span>';
        statusSub.textContent = 'Server 3 will stop receiving new requests and be removed by the Auto Scaling Group.';
        await new Promise(r => setTimeout(r, 2200));
        state.serverStates[2] = 'Stopped';
        renderServers();
        statusMain.innerHTML = 'Scale-in complete — <span class="gray">Server 3 stopped</span>';
        statusSub.textContent = 'The extra capacity has been removed while keeping two healthy targets.';
        return;
      }

      if (state.trafficLevel === 1 && state.serverStates[1] === 'InService') {
        state.serverStates[1] = 'Draining';
        renderServers();
        statusMain.innerHTML = 'Traffic is low — <span class="orange">Server 2 draining</span>';
        statusSub.textContent = 'The Auto Scaling Group is scaling in further and removing another backend server.';
        await new Promise(r => setTimeout(r, 2200));
        state.serverStates[1] = 'Stopped';
        renderServers();
        statusMain.innerHTML = 'Further scale-in complete — <span class="gray">Server 2 stopped</span>';
        statusSub.textContent = 'Only the minimum required capacity remains in service.';
      }
    }

    function stopAutoDemo() {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }

    function startAutoDemo() {
      if (state.autoTimer) return;
      requestAssignedServerAndAnimate();
      state.autoTimer = setInterval(() => {
        requestAssignedServerAndAnimate();
      }, state.trafficLevel === 3 ? 1200 : state.trafficLevel === 2 ? 1800 : 2500);
    }

    incBtn.addEventListener('click', async () => {
      if (state.trafficLevel < 3) state.trafficLevel += 1;

      try {
        await fetch('/api/traffic/increase', { method: 'POST' });
      } catch (e) {}

      if (state.trafficLevel >= 2 && state.serverStates[1] === 'Stopped') {
        state.serverStates[1] = 'InService';
      }
      if (state.trafficLevel === 3) await scaleOutToThree();

      updateTrafficUI();
      renderServers();

      if (state.autoTimer) {
        stopAutoDemo();
        startAutoDemo();
      }
    });

    decBtn.addEventListener('click', async () => {
      if (state.trafficLevel > 1) state.trafficLevel -= 1;

      try {
        await fetch('/api/traffic/reduce', { method: 'POST' });
      } catch (e) {}

      updateTrafficUI();
      await scaleInStep();
      renderServers();

      if (state.autoTimer) {
        stopAutoDemo();
        startAutoDemo();
      }
    });

    sendBtn.addEventListener('click', requestAssignedServerAndAnimate);
    autoBtn.addEventListener('click', startAutoDemo);
    stopBtn.addEventListener('click', () => {
      stopAutoDemo();
      statusMain.innerHTML = 'Auto demo <span class="purple">stopped</span>';
      statusSub.textContent = 'Use Send Request, Increase Traffic, or Auto Demo to continue the simulation.';
    });

    window.addEventListener('load', async () => {
      setupPaths();
      renderServers();
      updateTrafficUI();
      activateServer(-1);
      await requestAssignedServerAndAnimate();
    });

    window.addEventListener('resize', setupPaths);
  </script>
</body>
</html>`);
});

app.listen(3000, '0.0.0.0', () => {
  console.log('AWS ELB + ASG demo listening on port 3000');
});