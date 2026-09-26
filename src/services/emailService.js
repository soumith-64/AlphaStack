import nodemailer from 'nodemailer';
import { dbOps } from '../database/db.js';
import { notificationService } from './notificationService.js';
import { config } from '../config.js';

let ioInstance = null;

const smtpUser = process.env.HOSTINGER_SMTP_USER || process.env.HOSTINGER_IMAP_USER || 'admin@alphastack.wwisvnr.com';
const smtpPass = process.env.HOSTINGER_SMTP_PASS || process.env.HOSTINGER_IMAP_PASS || 'Alphastack@2026';

const smtpTransporter = nodemailer.createTransport({
  host: process.env.HOSTINGER_SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.HOSTINGER_SMTP_PORT || '465', 10),
  secure: true,
  auth: {
    user: smtpUser,
    pass: smtpPass
  }
});

export const emailService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  normalizeSubject(sub) {
    if (!sub) return '';
    return String(sub).replace(/^(\s*(re|fwd|fw|aw|sv)\s*:\s*)+/i, '').trim().toLowerCase();
  },

  /**
   * Normalizes an email address or raw phone number into a 10-digit phone and optional alias,
   * while preserving standard external email addresses (e.g. name@gmail.com) completely intact.
   */
  parseAddress(input) {
    if (!input) return { phone: '', alias: '', full: '', isExternal: false };
    const raw = String(input).trim().toLowerCase();
    
    // Check if it has an @
    let localPart = raw;
    let domainPart = '';
    if (raw.includes('@')) {
      const atParts = raw.split('@');
      localPart = atParts[0];
      domainPart = atParts[1] || '';
    }

    // Check if domain is external (e.g. gmail.com, yahoo.com, outlook.com, etc.)
    const isDomainLocal = !domainPart || 
      domainPart === config.domainName.toLowerCase() || 
      domainPart.includes('alphastack.wwisvnr.com') ||
      domainPart === 'phonemail.com';

    if (domainPart && !isDomainLocal) {
      return {
        phone: '',
        alias: '',
        full: raw,
        isExternal: true
      };
    }

    // Local PhoneMail address
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
    const isValidPhone = digitsOnly && digitsOnly.length === 10;

    return {
      phone: isValidPhone ? digitsOnly : '',
      alias: aliasPart,
      full: isValidPhone ? `${digitsOnly}${aliasPart ? '.' + aliasPart : ''}@${config.domainName}` : raw,
      isExternal: !isValidPhone
    };
  },

  /**
   * Processes an inbound email from SMTP parser or webhook
   */
  async processInboundEmail({ from, to, subject, text, html, attachments = [] }) {
    console.log(`📬 [INBOUND EMAIL] From: ${from} | To: ${to} | Subject: ${subject}`);

    // Extract actual email addresses cleanly
    const fromMatch = String(from || '').match(/<([^>]+)>/);
    const cleanSender = (fromMatch ? fromMatch[1] : String(from || '')).toLowerCase().trim();

    const toMatch = String(to || '').match(/<([^>]+)>/);
    const cleanTo = (toMatch ? toMatch[1] : String(to || '')).toLowerCase().trim();

    const recipientParsed = this.parseAddress(cleanTo || to);
    let recipientPhone = recipientParsed.phone;

    if (!recipientPhone) {
      // 1. Check if recipient local part matches an alias in aliases table
      const localPart = String(cleanTo || to || '').split('@')[0].trim().toLowerCase();
      if (localPart) {
        const aliasRecord = await dbOps.queryOne(`
          SELECT u.phone_number 
          FROM aliases a 
          JOIN users u ON a.user_id = u.id 
          WHERE LOWER(a.label) = ? OR LOWER(a.alias_email) LIKE ?
          LIMIT 1
        `, [localPart, `%${localPart}%`]);
        if (aliasRecord && aliasRecord.phone_number) {
          recipientPhone = aliasRecord.phone_number;
          console.log(`ℹ️ [INBOUND EMAIL] Resolved alias "${localPart}" to phone: ${recipientPhone}`);
        }
      }

      // 2. Fallback for admin or catch-all mailbox (e.g. admin@alphastack.wwisvnr.com)
      if (!recipientPhone) {
        const primaryUser = await dbOps.queryOne('SELECT phone_number FROM users ORDER BY created_at ASC LIMIT 1');
        if (primaryUser && primaryUser.phone_number) {
          recipientPhone = primaryUser.phone_number;
          console.log(`ℹ️ [INBOUND EMAIL] Catch-all routing: directed email for "${to}" to primary user ${recipientPhone}`);
        }
      }
    }

    if (!recipientPhone) {
      console.warn(`Could not resolve valid phone number for recipient: ${to}`);
      return null;
    }

    // Lookup or auto-provision recipient user
    let user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [recipientPhone]);
    if (!user) {
      const newUserId = 'user_' + Date.now();
      const newEmail = `${recipientPhone}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, 'INBOUND_EMAIL', 0)
      `, [newUserId, recipientPhone, newEmail, `User ${recipientPhone}`]);
      user = await dbOps.queryOne('SELECT * FROM users WHERE id = ?', [newUserId]);
    }

    const cleanSubject = String(subject || '(No Subject)').trim();
    const cleanText = String(text || '').trim();
    const textSnippet = cleanText.substring(0, 50);

    const normSub = this.normalizeSubject(cleanSubject);

    // Find or create conversation for this sender and recipient (WhatsApp-style contact grouping)
    let conversation = null;
    const candidateConvs = await dbOps.queryAll(`
      SELECT c.* FROM conversations c
      JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
      JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
      WHERE ((cp1.phone_number = ? OR cp1.phone_number LIKE ?) AND (cp2.phone_number = ? OR cp2.phone_number LIKE ?))
        AND c.is_group = 0
      ORDER BY c.updated_at DESC
      LIMIT 1
    `, [cleanSender, `%${cleanSender}%`, recipientPhone, `%${recipientPhone}%`]);

    if (candidateConvs.length > 0) {
      conversation = candidateConvs[0];
    }

    let conversationId;
    if (conversation) {
      conversationId = conversation.id;
      await dbOps.execute(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, subject = ? WHERE id = ?`, [cleanSubject, conversationId]);
    } else {
      conversationId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await dbOps.execute(`
        INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
        VALUES (?, 0, ?, ?, CURRENT_TIMESTAMP)
      `, [conversationId, cleanSubject || 'New Conversation', cleanSender]);

      // Add participants
      await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
        [conversationId, null, cleanSender]);
      await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
        [conversationId, user.id, recipientPhone]);
    }

    // Deduplication check: prevent identical emails from being re-inserted
    const duplicate = await dbOps.queryOne(`
      SELECT id FROM emails 
      WHERE (sender_email = ? OR sender_email LIKE ?) 
        AND subject = ? 
        AND (body_text = ? OR (LENGTH(?) > 0 AND body_text LIKE ?))
      LIMIT 1
    `, [cleanSender, `%${cleanSender}%`, cleanSubject, cleanText, textSnippet, `${textSnippet}%`]);

    if (duplicate) {
      console.log(`⚠️ [INBOUND DEDUPLICATION] Email already exists in DB (${duplicate.id}). Skipping re-insertion.`);
      return duplicate;
    }

    const recipientEmailsList = [
      `${recipientPhone}@${config.domainName}`
    ];
    if (recipientParsed.full && !recipientEmailsList.includes(recipientParsed.full)) {
      recipientEmailsList.push(recipientParsed.full);
    }
    if (cleanTo && !recipientEmailsList.includes(cleanTo)) {
      recipientEmailsList.push(cleanTo);
    }
    if (to && !recipientEmailsList.includes(to)) {
      recipientEmailsList.push(to);
    }

    // Insert email
    const emailId = 'email_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, body_html, is_read, folder, is_important, is_starred)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'INBOX', 0, 0)
    `, [
      emailId,
      conversationId,
      cleanSender,
      JSON.stringify(recipientEmailsList),
      cleanSubject,
      cleanText,
      html || cleanText || ''
    ]);

    const savedEmail = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [emailId]);

    // Broadcast via WebSockets for real-time inbox/chat updates
    if (ioInstance) {
      ioInstance.emit('email:new', {
        email: savedEmail,
        conversationId,
        recipientPhone
      });
      ioInstance.to(`user:${recipientPhone}`).emit('email:incoming', {
        email: savedEmail,
        conversationId
      });
    }

    // Check and trigger targeted SMS notification if user has no mobile app
    await notificationService.checkAndNotify(savedEmail, user);

    return savedEmail;
  },

  /**
   * Sends an outbound email or reply (True End-to-End User-to-User)
   */
  async sendOutboundEmail({ senderPhone, toRecipients, subject, bodyText, replyToId = null, conversationId = null }) {
    const cleanSenderPhone = String(senderPhone).replace(/\D/g, '').slice(-10);
    let sender = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanSenderPhone]);
    if (!sender) {
      const senderId = 'user_' + Date.now();
      const senderEmail = `${cleanSenderPhone}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, 'WEB_CLIENT', 1)
      `, [senderId, cleanSenderPhone, senderEmail, `User ${cleanSenderPhone}`]);
      sender = { id: senderId, phone_number: cleanSenderPhone, email_address: senderEmail };
    }
    const senderEmail = sender.email_address;

    // Normalize all recipient addresses
    const rawRecipientsList = Array.isArray(toRecipients) ? toRecipients : [toRecipients];
    const normalizedRecipients = rawRecipientsList.map(r => this.parseAddress(r).full);

    // Auto-provision any internal recipients who haven't registered yet
    for (const rec of rawRecipientsList) {
      const parsed = this.parseAddress(rec);
      if (parsed.phone && parsed.phone !== cleanSenderPhone) {
        let recipientUser = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [parsed.phone]);
        if (!recipientUser) {
          const recUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          const recEmail = `${parsed.phone}@${config.domainName}`;
          await dbOps.execute(`
            INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
            VALUES (?, ?, ?, ?, 'INBOUND_EMAIL', 0)
          `, [recUserId, parsed.phone, recEmail, `User ${parsed.phone}`]);
        }
      }
    }

    let targetConvId = conversationId;

    // Check single-reply constraint if this is a reply to an existing email
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
      const cleanSub = String(subject || '').trim();
      const normSub = this.normalizeSubject(cleanSub);

      // If 1-to-1, search for an existing 1-to-1 conversation with this recipient (WhatsApp-style contact grouping)
      if (!isGroup && normalizedRecipients[0]) {
        const otherPhone = this.parseAddress(normalizedRecipients[0]).phone || normalizedRecipients[0];
        const candidateConvs = await dbOps.queryAll(`
          SELECT c.* FROM conversations c
          JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
          JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
          WHERE ((cp1.phone_number = ? OR cp1.phone_number LIKE ?) AND (cp2.phone_number = ? OR cp2.phone_number LIKE ?))
            AND c.is_group = 0
          ORDER BY c.updated_at DESC
          LIMIT 1
        `, [cleanSenderPhone, `%${cleanSenderPhone}%`, otherPhone, `%${otherPhone}%`]);

        if (candidateConvs.length > 0) {
          targetConvId = candidateConvs[0].id;
        }
      }

      if (!targetConvId) {
        targetConvId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        
        await dbOps.execute(`
          INSERT INTO conversations (id, is_group, subject, participant_phone, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [targetConvId, isGroup ? 1 : 0, cleanSub || 'Conversation', normalizedRecipients[0]]);

        // Add sender
        await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
          [targetConvId, sender ? sender.id : null, cleanSenderPhone]);
        
        // Add each recipient
        for (const rec of rawRecipientsList) {
          const parsed = this.parseAddress(rec);
          const pPhone = parsed.phone || rec;
          await dbOps.execute(`INSERT INTO conversation_participants (conversation_id, user_id, phone_number) VALUES (?, ?, ?)`,
            [targetConvId, null, pPhone]);
        }
      } else {
        await dbOps.execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, subject = ? WHERE id = ?', [cleanSub || 'Conversation', targetConvId]);
      }
    } else {
      await dbOps.execute('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [targetConvId]);
    }

    // Insert email
    const emailId = 'email_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, reply_to_id, has_replied, is_read, folder)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'INBOX')
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

    // SEND LIVE OUTBOUND EMAIL VIA HOSTINGER SMTP TO ANY EXTERNAL RECIPIENTS (e.g. Gmail, Yahoo, Outlook, etc.)
    const externalRecipients = rawRecipientsList
      .map(r => this.parseAddress(r))
      .filter(p => p.isExternal && p.full.includes('@'))
      .map(p => p.full);

    if (externalRecipients.length > 0) {
      const senderDisplayName = (sender && sender.display_name && !sender.display_name.startsWith('User ')) 
        ? sender.display_name 
        : `+91 ${cleanSenderPhone}`;

      // Check if read receipts are enabled for sender
      const readReceiptHeaders = (sender && sender.read_receipts_enabled === 0) ? {} : {
        'Disposition-Notification-To': `${cleanSenderPhone}@${config.domainName}`,
        'X-Confirm-Reading-To': `${cleanSenderPhone}@${config.domainName}`,
        'Return-Receipt-To': `${cleanSenderPhone}@${config.domainName}`
      };

      for (const extEmail of externalRecipients) {
        try {
          console.log(`🚀 [Hostinger SMTP] Transmitting live email to ${extEmail}...`);
          const msgUniqueId = `${Date.now()}.${Math.random().toString(36).substring(2, 9)}@alphastack.wwisvnr.com`;
          const emailSubject = subject && subject.trim() ? subject.trim() : `Message from ${senderDisplayName}`;
          const cleanBody = bodyText || '';

          const info = await smtpTransporter.sendMail({
            from: `"${senderDisplayName}" <${smtpUser}>`,
            replyTo: `${cleanSenderPhone}@${config.domainName}`,
            to: extEmail,
            subject: emailSubject,
            messageId: `<${msgUniqueId}>`,
            headers: {
              'X-Mailer': 'PhoneMail WebClient 1.0',
              'Precedence': 'normal',
              'Importance': 'normal',
              ...readReceiptHeaders
            },
            text: cleanBody 
              ? `${cleanBody}\n\n---\nSent by ${senderDisplayName} (+91 ${cleanSenderPhone}) via PhoneMail.\nReply directly to this email to reach my phone mailbox: ${cleanSenderPhone}@${config.domainName}`
              : `Sent by ${senderDisplayName} via PhoneMail.`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                <div style="font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9;">
                  ${String(emailSubject).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                </div>
                <div style="font-size: 15px; line-height: 1.7; color: #1e293b; margin-bottom: 24px; white-space: pre-wrap;">${cleanBody ? String(cleanBody).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</div>
                <div style="border-top: 1px solid #f1f5f9; padding-top: 14px; font-size: 12px; color: #64748b; line-height: 1.6;">
                  Sent by <strong>${senderDisplayName}</strong> (+91 ${cleanSenderPhone}) via PhoneMail.<br>
                  Reply directly to this email to reach this user's PhoneMail inbox: 
                  <a href="mailto:${cleanSenderPhone}@${config.domainName}" style="color: #046A38; font-weight: 600; text-decoration: none;">${cleanSenderPhone}@${config.domainName}</a>
                </div>
              </div>
            `
          });
          console.log(`✅ [Hostinger SMTP SUCCESS] Delivered to ${extEmail} | ID: ${info.messageId}`);
        } catch (smtpErr) {
          console.error(`❌ [Hostinger SMTP ERROR] Failed sending to ${extEmail}:`, smtpErr.message);
        }
      }
    }

    // Real-time broadcast to all participants and specific user rooms
    if (ioInstance) {
      ioInstance.emit('email:new', {
        email: sentEmail,
        conversationId: targetConvId,
        senderPhone: cleanSenderPhone
      });

      ioInstance.emit('email:sent', {
        email: sentEmail,
        conversationId: targetConvId,
        senderPhone: cleanSenderPhone
      });

      // Target each recipient's private room
      for (const rec of rawRecipientsList) {
        const parsed = this.parseAddress(rec);
        if (parsed.phone) {
          ioInstance.to(`user:${parsed.phone}`).emit('email:incoming', {
            email: sentEmail,
            conversationId: targetConvId,
            from: senderEmail
          });
        }
      }
    }

    // Process delivery notifications to any PhoneMail recipients who do NOT have the app open
    for (const rec of rawRecipientsList) {
      const parsed = this.parseAddress(rec);
      if (parsed.phone && parsed.phone !== cleanSenderPhone) {
        const internalUser = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [parsed.phone]);
        if (internalUser) {
          await notificationService.checkAndNotify(sentEmail, internalUser);
        }
      }
    }

    return sentEmail;
  }
};
