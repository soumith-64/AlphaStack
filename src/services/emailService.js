import { dbOps } from '../database/db.js';
import { notificationService } from './notificationService.js';
import { config } from '../config.js';

let ioInstance = null;

export const emailService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  /**
   * Normalizes an email address or raw phone number into a 10-digit phone and optional alias
   */
  parseAddress(input) {
    if (!input) return { phone: '', alias: '', full: '' };
    const raw = String(input).trim().toLowerCase();
    
    // Check if it has an @
    let localPart = raw;
    if (raw.includes('@')) {
      localPart = raw.split('@')[0];
    }

    // Check for alias dot/hyphen: e.g. 9876543210.work or 9876543210-1
    let phonePart = localPart;
    let aliasPart = '';
    if (localPart.includes('.')) {
      const parts = localPart.split('.');
      phonePart = parts[0];
      aliasPart = parts.slice(1).join('.');
    } else if (localPart.includes('-') && /\d{10}-/.test(localPart)) {
      const parts = localPart.split('-');
      phonePart = parts[0];
      aliasPart = parts.slice(1).join('-');
    }

    const digitsOnly = phonePart.replace(/\D/g, '').slice(-10);
    return {
      phone: digitsOnly,
      alias: aliasPart,
      full: digitsOnly ? `${digitsOnly}${aliasPart ? '.' + aliasPart : ''}@${config.domainName}` : raw
    };
  },

  /**
   * Processes an inbound email from SMTP parser or webhook
   */
  async processInboundEmail({ from, to, subject, text, html, attachments = [] }) {
    console.log(`📬 [INBOUND EMAIL] From: ${from} | To: ${to} | Subject: ${subject}`);

    const recipientParsed = this.parseAddress(to);
    const recipientPhone = recipientParsed.phone;

    if (!recipientPhone) {
      console.warn(`Could not resolve valid phone number for recipient: ${to}`);
      return null;
    }

    // Lookup recipient user
    let user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [recipientPhone]);
    if (!user) {
      // Auto-provision user on first inbound email
      const newUserId = 'user_' + Date.now();
      const newEmail = `${recipientPhone}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, 'INBOUND_EMAIL', 0)
      `, [newUserId, recipientPhone, newEmail, `User ${recipientPhone}`]);
      user = await dbOps.queryOne('SELECT * FROM users WHERE id = ?', [newUserId]);
    }

    // Find or create conversation for this sender and recipient
    const cleanSender = String(from).toLowerCase().trim();
    let conversation = await dbOps.queryOne(`
      SELECT c.* FROM conversations c
      JOIN conversation_participants cp ON c.id = cp.conversation_id
      WHERE cp.phone_number = ? AND c.is_group = 0
    `, [cleanSender]);

    let conversationId;
    if (conversation) {
      conversationId = conversation.id;
      await dbOps.execute(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [conversationId]);
    } else {
      conversationId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await dbOps.execute(`
        INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
        VALUES (?, 0, ?, ?, CURRENT_TIMESTAMP)
      `, [conversationId, subject || 'New Conversation', cleanSender]);

      // Add participants
      await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
        [conversationId, null, cleanSender]);
      await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
        [conversationId, user.id, recipientPhone]);
    }

    // Insert email
    const emailId = 'email_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, body_html, is_read, folder)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'INBOX')
    `, [
      emailId,
      conversationId,
      cleanSender,
      JSON.stringify([recipientParsed.full]),
      subject || '(No Subject)',
      text || '',
      html || text || ''
    ]);

    const savedEmail = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [emailId]);

    // Broadcast via WebSockets for real-time inbox/chat updates
    if (ioInstance) {
      ioInstance.emit('email:new', {
        email: savedEmail,
        conversationId,
        recipientPhone
      });
    }

    // Check and trigger targeted SMS notification if user has no mobile app
    await notificationService.checkAndNotify(savedEmail, user);

    return savedEmail;
  },

  /**
   * Sends an outbound email or reply
   */
  async sendOutboundEmail({ senderPhone, toRecipients, subject, bodyText, replyToId = null, conversationId = null }) {
    const sender = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [senderPhone]);
    const senderEmail = sender ? sender.email_address : `${senderPhone}@${config.domainName}`;

    // Normalize all recipient addresses
    const normalizedRecipients = (Array.isArray(toRecipients) ? toRecipients : [toRecipients]).map(r => this.parseAddress(r).full);

    let targetConvId = conversationId;

    // Check single-reply constraint
    if (replyToId) {
      const parent = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [replyToId]);
      if (parent) {
        if (parent.has_replied === 1) {
          throw new Error('This message has already been replied to. Each message can be replied to only once.');
        }
        await dbOps.execute('UPDATE emails SET has_replied = 1 WHERE id = ?', [replyToId]);
        targetConvId = parent.conversation_id;
      }
    }

    // If new conversation, determine if 1-to-1 or Group Chat
    if (!targetConvId) {
      const isGroup = normalizedRecipients.length >= 2;
      targetConvId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      
      await dbOps.execute(`
        INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [targetConvId, isGroup ? 1 : 0, subject || 'Conversation', normalizedRecipients[0]]);

      // Add participants
      await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
        [targetConvId, sender ? sender.id : null, senderPhone]);
      for (const rec of normalizedRecipients) {
        await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
          [targetConvId, null, rec]);
      }
    } else {
      await dbOps.execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [targetConvId]);
    }

    // Insert email
    const emailId = 'email_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, reply_to_id, has_replied, is_read, folder)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 'INBOX')
    `, [
      emailId,
      targetConvId,
      senderEmail,
      JSON.stringify(normalizedRecipients),
      subject || '',
      bodyText,
      replyToId
    ]);

    const sentEmail = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [emailId]);

    // Real-time broadcast
    if (ioInstance) {
      ioInstance.emit('email:sent', {
        email: sentEmail,
        conversationId: targetConvId,
        senderPhone
      });
    }

    // Process delivery to any internal PhoneMail users
    for (const rec of normalizedRecipients) {
      const parsed = this.parseAddress(rec);
      if (parsed.phone && parsed.phone !== senderPhone) {
        const internalUser = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [parsed.phone]);
        if (internalUser) {
          await notificationService.checkAndNotify(sentEmail, internalUser);
        }
      }
    }

    return sentEmail;
  }
};
