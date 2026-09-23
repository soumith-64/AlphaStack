import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { emailService } from '../services/emailService.js';
import { config } from '../config.js';

export function startSmtpServer() {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH'], // Open reception for inbound external mail
    size: 20 * 1024 * 1024, // 20MB limit

    onConnect(session, callback) {
      console.log(`🔌 [SMTP CONNECT] Client connected: ${session.remoteAddress}`);
      return callback();
    },

    onMailFrom(address, session, callback) {
      return callback(); // Accept all senders
    },

    onRcptTo(address, session, callback) {
      // Validate recipient address
      const rcpt = address.address.toLowerCase();
      console.log(`📬 [SMTP RCPT TO] ${rcpt}`);
      return callback();
    },

    async onData(stream, session, callback) {
      try {
        const parsed = await simpleParser(stream);
        const recipient = session.envelope.rcptTo && session.envelope.rcptTo[0]
          ? session.envelope.rcptTo[0].address
          : (parsed.to ? parsed.to.text : '');

        const sender = session.envelope.mailFrom && session.envelope.mailFrom.address
          ? session.envelope.mailFrom.address
          : (parsed.from ? parsed.from.text : 'unknown@sender.com');

        await emailService.processInboundEmail({
          from: sender,
          to: recipient,
          subject: parsed.subject || '(No Subject)',
          text: parsed.text || '',
          html: parsed.html || parsed.textAsHtml || parsed.text || '',
          attachments: (parsed.attachments || []).map(a => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size
          }))
        });

        return callback(null, 'OK: Message accepted');
      } catch (err) {
        console.error('SMTP stream error:', err);
        return callback(err);
      }
    }
  });

  server.listen(config.smtpPort, () => {
    console.log(`📧 Local Inbound SMTP Server running on port ${config.smtpPort}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.warn(`⚠️ Port ${config.smtpPort} requires root privileges. Using port 2525 for local development.`);
    } else {
      console.error('SMTP Server error:', err.message);
    }
  });

  return server;
}
