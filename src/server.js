import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { notificationService } from './services/notificationService.js';
import { telephonyService } from './services/telephonyService.js';
import { emailService } from './services/emailService.js';
import { startSmtpServer } from './smtp/smtpServer.js';
import { imapSyncService } from './services/imapSyncService.js';

import authRoutes from './routes/authRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import twilioRoutes from './routes/twilioRoutes.js';
import { dbOps } from './database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

// Pass Socket.IO instance to services for real-time notifications & streaming
notificationService.setSocketIO(io);
telephonyService.setSocketIO(io);
emailService.setSocketIO(io);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route for Hostinger reverse proxy
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Root route: Automatically route to real Mobile or Desktop app based on client device
app.get('/', (req, res) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = /mobile|iphone|android|ipad|phone/i.test(ua);
  res.redirect(isMobile ? '/mobile/' : '/desktop/');
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', emailRoutes);
app.use('/api/twilio', twilioRoutes);

// Socket.IO event handler
io.on('connection', (socket) => {
  console.log(`⚡ [SOCKET CONNECTED] ID: ${socket.id}`);
  
  socket.on('join:user', (phone) => {
    const clean = String(phone).replace(/\D/g, '').slice(-10);
    socket.join(`user:${clean}`);
    console.log(`👤 Client joined room: user:${clean}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 [SOCKET DISCONNECTED] ID: ${socket.id}`);
  });
});

// Start Inbound SMTP Server (only in local dev or if explicitly enabled)
if (config.enableSmtp || !config.isProduction) {
  try {
    startSmtpServer();
  } catch (err) {
    console.warn('SMTP Server startup notice:', err.message);
  }
}

// Clean up any historical duplicate emails in database on startup
dbOps.pruneDuplicateEmails().catch((err) => {
  console.warn('Initial duplicate emails pruning note:', err.message);
});

// Consolidate legacy fragmented conversations on startup (WhatsApp contact grouping)
dbOps.consolidateConversations().catch((err) => {
  console.warn('Initial conversation consolidation note:', err.message);
});

// Start Hostinger IMAP Inbound Auto-Sync Worker (fetches incoming mail every 20s)
try {
  imapSyncService.startAutoSync(20);
} catch (err) {
  console.warn('IMAP sync worker startup notice:', err.message);
}

// Start HTTP & WebSocket Server (supports TCP port, 0.0.0.0, and Phusion Passenger sockets)
const rawPort = config.port;
if (typeof rawPort === 'string' && !/^\d+$/.test(rawPort)) {
  // Named pipe or Phusion Passenger unix socket
  server.listen(rawPort, () => {
    console.log(`🚀 PhoneMail Server running on Passenger socket: ${rawPort}`);
  });
} else {
  // Standard TCP port
  const numericPort = Number(rawPort) || 3000;
  server.listen(numericPort, config.host, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 PhoneMail Production Server is running!`);
    console.log(`🌐 Live URL: http://${config.host}:${numericPort}`);
    console.log(`💻 Desktop Webmail: http://${config.host}:${numericPort}/desktop/`);
    console.log(`📱 Mobile Spike Webmail: http://${config.host}:${numericPort}/mobile/`);
    if (config.enableSmtp || !config.isProduction) {
      console.log(`📧 Inbound SMTP Server: port ${config.smtpPort}`);
    }
    console.log(`======================================================\n`);
  });
}

export { app, server, io };
