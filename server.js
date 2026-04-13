'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const chalk      = require('chalk');
const { validateConfig } = require('./src/config');
const { FlipBot }        = require('./src/engine/bot');
const log                = require('./src/logger');

// ── Validate config before anything starts ─────────────────────────
const config = validateConfig();

// ── Express + HTTP server ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src/dashboard')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'src/dashboard/index.html'))
);

app.get('/api/status', (req, res) =>
  res.json(bot.getStatus())
);

app.post('/api/pause', (req, res) => {
  bot.pause();
  res.json({ paused: true });
});

app.post('/api/resume', (req, res) => {
  bot.resume();
  res.json({ paused: false });
});

// ── WebSocket server ───────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  log.info(`Dashboard connected from ${ip}`);

  // Send full current state to new client
  ws.send(JSON.stringify({ type: 'init', data: bot.getState() }));

  ws.on('message', raw => {
    try {
      const { action } = JSON.parse(raw);
      if (action === 'pause')  bot.pause();
      if (action === 'resume') bot.resume();
    } catch (_) {}
  });

  ws.on('close', () => log.info('Dashboard disconnected'));
});

// ── Init bot ───────────────────────────────────────────────────────
const bot = new FlipBot(config, broadcast);

// ── Start server ───────────────────────────────────────────────────
server.listen(config.port, () => {
  console.log('');
  console.log(chalk.greenBright('  ██████  FlipBot Pro'));
  console.log(chalk.green  ('  ██ ██   v1.0.0'));
  console.log('');
  console.log(chalk.gray('  Dashboard  →'), chalk.cyan(`http://localhost:${config.port}`));
  console.log(chalk.gray('  Mode       →'), config.ebaySandbox ? chalk.yellow('Sandbox (no real listings)') : chalk.green('Production'));
  console.log(chalk.gray('  Keywords   →'), config.keywords.join(', '));
  console.log(chalk.gray('  Scan every →'), `${config.scanIntervalSec}s`);
  console.log(chalk.gray('  Min margin →'), `${config.minMarginPct}%`);
  console.log('');

  // Start the bot
  bot.start();
});
