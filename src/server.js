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

import authRoutes from './routes/authRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import twilioRoutes from './routes/twilioRoutes.js';
import simulatorRoutes from './routes/simulatorRoutes.js';

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

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', emailRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/simulator', simulatorRoutes);

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

// Start Inbound SMTP Server
try {
  startSmtpServer();
} catch (err) {
  console.warn('SMTP Server startup notice:', err.message);
}

// Start HTTP & WebSocket Server
server.listen(config.port, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 PhoneMail Server is running!`);
  console.log(`🌐 Web Interfaces: http://localhost:${config.port}`);
  console.log(`📱 Mobile (WhatsApp + Spike): http://localhost:${config.port}/mobile`);
  console.log(`💻 Desktop (Gmail): http://localhost:${config.port}/desktop`);
  console.log(`📋 2-Field Portal: http://localhost:${config.port}/portal`);
  console.log(`🧪 Judge Testing Lab: http://localhost:${config.port}/simulator`);
  console.log(`📧 Local Inbound SMTP Port: ${config.smtpPort}`);
  console.log(`======================================================\n`);
});

export { app, server, io };
