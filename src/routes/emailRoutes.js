import express from 'express';
import { dbOps } from '../database/db.js';
import { emailService } from '../services/emailService.js';
import { imapSyncService } from '../services/imapSyncService.js';
import { textbeeService } from '../services/textbeeService.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * List conversations for Mobile Spike Mail View (isolated per user)
 */
router.get('/conversations', async (req, res) => {
  try {
    const userPhone = req.query.phone;
    if (!userPhone) return res.json({ conversations: [] });
    const cleanPhone = String(userPhone).replace(/\D/g, '').slice(-10);

    const primaryUser = await dbOps.queryOne('SELECT phone_number FROM users ORDER BY created_at ASC LIMIT 1');
    const isPrimary = (primaryUser && primaryUser.phone_number === cleanPhone) || cleanPhone === '8667611163';

    const whereClause = isPrimary 
      ? `(cp.phone_number = ? OR cp.phone_number LIKE ? OR cp.phone_number LIKE '%admin%')`
      : `(cp.phone_number = ? OR cp.phone_number LIKE ?)`;

    const conversations = await dbOps.queryAll(`
      SELECT DISTINCT c.id, c.is_group, c.subject, c.created_at, c.updated_at,
        COALESCE(
          (SELECT phone_number FROM conversation_participants WHERE conversation_id = c.id AND phone_number NOT LIKE ? LIMIT 1),
          c.participant_phone
        ) as participant_phone,
        (SELECT body_text FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT sender_email FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_sender,
        (SELECT subject FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_subject,
        (SELECT created_at FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_time,
        (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id AND is_read = 0 AND sender_email NOT LIKE ?) as unread_count,
        (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id) as message_count,
        (SELECT MAX(is_starred) FROM emails WHERE conversation_id = c.id) as is_starred,
        (SELECT MAX(is_important) FROM emails WHERE conversation_id = c.id) as is_important,
        (SELECT folder FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as folder
      FROM conversations c
      JOIN conversation_participants cp ON c.id = cp.conversation_id
      WHERE ${whereClause}
      ORDER BY c.updated_at DESC
    `, [`%${cleanPhone}%`, `%${cleanPhone}%`, cleanPhone, `%${cleanPhone}%`]);

    // Enrich conversations with registered participant display names and avatars
    try {
      const userRows = await dbOps.queryAll('SELECT phone_number, display_name, avatar_url FROM users');
      const userMap = {};
      const avatarMap = {};
      for (const u of (userRows || [])) {
        if (u.phone_number) {
          if (u.display_name && !/^User\s*\d+/i.test(u.display_name)) {
            userMap[u.phone_number] = u.display_name;
          }
          if (u.avatar_url) {
            avatarMap[u.phone_number] = u.avatar_url;
          }
        }
      }
      for (const c of conversations) {
        const digits = (c.participant_phone || '').replace(/\D/g, '').slice(-10);
        if (digits && userMap[digits]) {
          c.participant_name = userMap[digits];
        }
        if (digits && avatarMap[digits]) {
          c.participant_avatar = avatarMap[digits];
        }
      }
    } catch (uErr) {}

    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get message thread for a conversation
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userPhone = req.query.phone;
    const conversation = await dbOps.queryOne('SELECT * FROM conversations WHERE id = ?', [id]);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (userPhone) {
      const cleanPhone = String(userPhone).replace(/\D/g, '').slice(-10);
      const otherPart = await dbOps.queryOne(`
        SELECT phone_number FROM conversation_participants 
        WHERE conversation_id = ? AND phone_number NOT LIKE ? 
        LIMIT 1
      `, [id, `%${cleanPhone}%`]);
      if (otherPart && otherPart.phone_number) {
        conversation.participant_phone = otherPart.phone_number;
      }
    }

    const messages = await dbOps.queryAll(`
      SELECT * FROM emails 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `, [id]);

    // Mark unread messages in this conversation as read
    await dbOps.execute(`UPDATE emails SET is_read = 1 WHERE conversation_id = ?`, [id]);

    // Enrich messages and conversation with display names, avatars, and quoted reply details
    try {
      const userRows = await dbOps.queryAll('SELECT phone_number, display_name, avatar_url FROM users');
      const userMap = {};
      const avatarMap = {};
      for (const u of (userRows || [])) {
        if (u.phone_number) {
          if (u.display_name && !/^User\s*\d+/i.test(u.display_name)) {
            userMap[u.phone_number] = u.display_name;
          }
          if (u.avatar_url) {
            avatarMap[u.phone_number] = u.avatar_url;
          }
        }
      }

      const msgMap = {};
      for (const m of messages) {
        msgMap[m.id] = m;
        const digits = (m.sender_email || '').replace(/\D/g, '').slice(-10);
        if (digits && userMap[digits]) {
          m.sender_name = userMap[digits];
        }
        if (digits && avatarMap[digits]) {
          m.sender_avatar = avatarMap[digits];
        }
      }

      // Quoted reply enrichment
      for (const m of messages) {
        if (m.reply_to_id) {
          const parent = msgMap[m.reply_to_id];
          if (parent) {
            m.quoted_sender = parent.sender_name || parent.sender_email;
            m.quoted_text = (parent.body_text || '').substring(0, 120);
            m.quoted_subject = parent.subject || '';
          }
        }
      }

      const convDigits = (conversation.participant_phone || '').replace(/\D/g, '').slice(-10);
      if (convDigits && userMap[convDigits]) {
        conversation.participant_name = userMap[convDigits];
      }
      if (convDigits && avatarMap[convDigits]) {
        conversation.participant_avatar = avatarMap[convDigits];
      }
    } catch (uErr) {}

    res.json({ conversation, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * List flat emails for Desktop View (strictly isolated per user & folder)
 */
router.get('/emails', async (req, res) => {
  try {
    const folder = (req.query.folder || 'INBOX').toUpperCase();
    const userPhone = req.query.phone;
    if (!userPhone) return res.json({ emails: [] });
    const cleanPhone = String(userPhone).replace(/\D/g, '').slice(-10);

    const primaryUser = await dbOps.queryOne('SELECT phone_number FROM users ORDER BY created_at ASC LIMIT 1');
    const isPrimary = (primaryUser && primaryUser.phone_number === cleanPhone) || cleanPhone === '8667611163';

    let emails;
    if (folder === 'ALL') {
      // Show ALL emails: inbound, outbound sent, and alias/sub-number mails (excluding TRASH, SPAM, DRAFTS)
      const sql = isPrimary
        ? `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ? OR recipient_emails LIKE '%admin@%') 
             AND folder != 'TRASH' AND folder != 'SPAM' AND folder != 'DRAFTS'
           ORDER BY is_important DESC, created_at DESC`
        : `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
             AND folder != 'TRASH' AND folder != 'SPAM' AND folder != 'DRAFTS'
           ORDER BY is_important DESC, created_at DESC`;
      emails = await dbOps.queryAll(sql, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'IMPORTANT') {
      const sql = isPrimary
        ? `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ? OR recipient_emails LIKE '%admin@%') 
             AND is_important = 1 AND folder != 'TRASH'
           ORDER BY created_at DESC`
        : `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
             AND is_important = 1 AND folder != 'TRASH'
           ORDER BY created_at DESC`;
      emails = await dbOps.queryAll(sql, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'STARRED') {
      const sql = isPrimary
        ? `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ? OR recipient_emails LIKE '%admin@%') 
             AND is_starred = 1 AND folder != 'TRASH'
           ORDER BY created_at DESC`
        : `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
             AND is_starred = 1 AND folder != 'TRASH'
           ORDER BY created_at DESC`;
      emails = await dbOps.queryAll(sql, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'SENT') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE sender_email LIKE ? AND folder != 'TRASH'
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`]);
    } else if (folder === 'DRAFTS') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (sender_email LIKE ? OR recipient_emails LIKE ?) AND folder = 'DRAFTS'
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'ARCHIVE') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) AND folder = 'ARCHIVE'
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'TRASH' || folder === 'SPAM') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
          AND folder = ? 
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`, folder]);
    } else {
      // Default: INBOX (prioritize important items)
      const sql = isPrimary
        ? `SELECT * FROM emails 
           WHERE (recipient_emails LIKE ? OR recipient_emails LIKE '%admin@%') AND (folder = 'INBOX' OR folder IS NULL)
           ORDER BY is_important DESC, created_at DESC`
        : `SELECT * FROM emails 
           WHERE recipient_emails LIKE ? AND (folder = 'INBOX' OR folder IS NULL)
           ORDER BY is_important DESC, created_at DESC`;
      emails = await dbOps.queryAll(sql, [`%${cleanPhone}%`]);
    }

    // Enrich emails with registered sender display names
    try {
      const userRows = await dbOps.queryAll('SELECT phone_number, display_name FROM users');
      const userMap = {};
      for (const u of (userRows || [])) {
        if (u.phone_number && u.display_name && !/^User\s*\d+/i.test(u.display_name)) {
          userMap[u.phone_number] = u.display_name;
        }
      }
      for (const e of emails) {
        const digits = (e.sender_email || '').replace(/\D/g, '').slice(-10);
        if (digits && userMap[digits]) {
          e.sender_name = userMap[digits];
        }
        // Also enrich recipient name for outbound & sent mails
        let rList = [];
        try {
          rList = JSON.parse(e.recipient_emails || '[]');
        } catch (_) {
          rList = [e.recipient_emails];
        }
        if (Array.isArray(rList) && rList.length > 0) {
          const rStr = String(rList[0]).trim();
          const angleMatch = rStr.match(/^(?:"?([^"@<]+)"?\s*)?<([^>]+)>/);
          if (angleMatch && angleMatch[1]) {
            e.recipient_name = angleMatch[1].trim();
          }
          const rDigits = rStr.replace(/\D/g, '').slice(-10);
          if (rDigits && userMap[rDigits]) {
            e.recipient_name = userMap[rDigits];
          }
        }
      }
    } catch (uErr) {}

    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Global Mailbox Folder Stats & Counts
 */
router.get('/emails/stats', async (req, res) => {
  try {
    const userPhone = req.query.phone;
    if (!userPhone) return res.json({ inbox_unread: 0, inbox_total: 0, all_unread: 0, all_total: 0, drafts_total: 0, sent_total: 0 });
    const cleanPhone = String(userPhone).replace(/\D/g, '').slice(-10);

    const primaryUser = await dbOps.queryOne('SELECT phone_number FROM users ORDER BY created_at ASC LIMIT 1');
    const isPrimary = (primaryUser && primaryUser.phone_number === cleanPhone) || cleanPhone === '8667611163';

    // 1. INBOX stats
    const inboxSql = isPrimary
      ? `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread 
         FROM emails 
         WHERE (recipient_emails LIKE ? OR recipient_emails LIKE '%admin@%') 
           AND (folder = 'INBOX' OR folder IS NULL) AND folder != 'TRASH' AND folder != 'SPAM'`
      : `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread 
         FROM emails 
         WHERE recipient_emails LIKE ? 
           AND (folder = 'INBOX' OR folder IS NULL) AND folder != 'TRASH' AND folder != 'SPAM'`;
    const inboxStats = await dbOps.queryOne(inboxSql, [`%${cleanPhone}%`]);

    // 2. ALL Mail stats (excludes TRASH, SPAM, DRAFTS; unread counts received unread items)
    const allSql = isPrimary
      ? `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN is_read = 0 AND (recipient_emails LIKE ? OR recipient_emails LIKE '%admin@%') THEN 1 ELSE 0 END) as unread 
         FROM emails 
         WHERE (recipient_emails LIKE ? OR sender_email LIKE ? OR recipient_emails LIKE '%admin@%') 
           AND folder != 'TRASH' AND folder != 'SPAM' AND folder != 'DRAFTS'`
      : `SELECT 
           COUNT(*) as total, 
           SUM(CASE WHEN is_read = 0 AND recipient_emails LIKE ? THEN 1 ELSE 0 END) as unread 
         FROM emails 
         WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
           AND folder != 'TRASH' AND folder != 'SPAM' AND folder != 'DRAFTS'`;
    const allStats = await dbOps.queryOne(allSql, [`%${cleanPhone}%`, `%${cleanPhone}%`]);

    // 3. DRAFTS stats
    const draftsStats = await dbOps.queryOne(`
      SELECT COUNT(*) as total FROM emails 
      WHERE (sender_email LIKE ? OR recipient_emails LIKE ?) AND folder = 'DRAFTS'
    `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);

    // 4. SENT stats
    const sentStats = await dbOps.queryOne(`
      SELECT COUNT(*) as total FROM emails 
      WHERE sender_email LIKE ? AND folder != 'TRASH'
    `, [`%${cleanPhone}%`]);

    // 5. STARRED & IMPORTANT
    const starStats = await dbOps.queryOne(`
      SELECT COUNT(*) as total FROM emails 
      WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) AND is_starred = 1 AND folder != 'TRASH'
    `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);

    const impStats = await dbOps.queryOne(`
      SELECT COUNT(*) as total FROM emails 
      WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) AND is_important = 1 AND folder != 'TRASH'
    `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);

    res.json({
      inbox_unread: Number(inboxStats?.unread || 0),
      inbox_total: Number(inboxStats?.total || 0),
      all_unread: Number(allStats?.unread || 0),
      all_total: Number(allStats?.total || 0),
      drafts_total: Number(draftsStats?.total || 0),
      sent_total: Number(sentStats?.total || 0),
      starred_total: Number(starStats?.total || 0),
      important_total: Number(impStats?.total || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Block Sender and Move Their Emails to Spam
 */
router.post('/emails/block', async (req, res) => {
  try {
    const rawUserPhone = req.body.userPhone || req.body.user_phone;
    const rawSender = req.body.sender || req.body.senderEmail || req.body.sender_email;
    if (!rawUserPhone || !rawSender) {
      return res.status(400).json({ error: 'userPhone and sender are required' });
    }

    const cleanUserPhone = String(rawUserPhone).replace(/\D/g, '').slice(-10);
    const cleanSender = String(rawSender).trim();
    const senderPhoneDigits = cleanSender.replace(/\D/g, '').slice(-10);

    // 1. Insert into blocked_senders table
    await dbOps.execute(`
      INSERT INTO blocked_senders (user_phone, blocked_sender) 
      VALUES (?, ?) 
      ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP
    `, [cleanUserPhone, cleanSender]).catch(async () => {
      // SQLite fallback
      await dbOps.execute(`
        INSERT OR REPLACE INTO blocked_senders (user_phone, blocked_sender)
        VALUES (?, ?)
      `, [cleanUserPhone, cleanSender]).catch(() => {});
    });

    if (senderPhoneDigits && senderPhoneDigits.length === 10 && senderPhoneDigits !== cleanSender) {
      await dbOps.execute(`
        INSERT INTO blocked_senders (user_phone, blocked_sender) 
        VALUES (?, ?) 
        ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP
      `, [cleanUserPhone, senderPhoneDigits]).catch(() => {});
    }

    // 2. Move existing emails from this sender to SPAM for this user
    const pattern = senderPhoneDigits ? `%${senderPhoneDigits}%` : `%${cleanSender}%`;
    await dbOps.execute(`
      UPDATE emails 
      SET folder = 'SPAM' 
      WHERE (sender_email LIKE ? OR sender_email = ?) 
        AND recipient_emails LIKE ? 
        AND folder != 'TRASH'
    `, [pattern, cleanSender, `%${cleanUserPhone}%`]);

    console.log(`🚫 [BLOCKED SENDER] User ${cleanUserPhone} blocked ${cleanSender}`);
    res.json({ success: true, message: `Sender ${cleanSender} blocked and moved to Spam.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Save or Update a Draft Email
 */
router.post('/emails/draft', async (req, res) => {
  try {
    const rawSender = req.body.senderPhone || req.body.sender_phone;
    const cleanPhone = String(rawSender || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone) return res.status(400).json({ error: 'Sender phone required' });

    const rawTo = req.body.toRecipients || req.body.to || req.body.recipients || '';
    const subject = req.body.subject || '';
    const bodyText = req.body.bodyText || req.body.body || '';
    const draftId = req.body.draftId || req.body.draft_id;

    const senderEmail = `${cleanPhone}@${config.domainName || 'alphastack.wwisvnr.com'}`;
    const user = await dbOps.queryOne('SELECT display_name FROM users WHERE phone_number = ?', [cleanPhone]);
    const senderName = user ? user.display_name : `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`;
    const recipientsJson = typeof rawTo === 'string' ? JSON.stringify([rawTo]) : JSON.stringify(rawTo || []);

    if (draftId) {
      const existing = await dbOps.queryOne('SELECT id FROM emails WHERE id = ?', [draftId]);
      if (existing) {
        await dbOps.execute(`
          UPDATE emails 
          SET recipient_emails = ?, subject = ?, body_text = ?, body_html = ? 
          WHERE id = ?
        `, [recipientsJson, subject, bodyText, bodyText.replace(/\n/g, '<br>'), draftId]);
        return res.json({ success: true, draftId, message: 'Draft updated successfully' });
      }
    }

    const newId = 'draft_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const convId = 'conv_draft_' + Date.now();
    await dbOps.execute(`
      INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, body_html, folder, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFTS', 1, NOW())
    `, [newId, convId, senderEmail, recipientsJson, subject, bodyText, bodyText.replace(/\n/g, '<br>')]).catch(async () => {
      await dbOps.execute(`
        INSERT INTO emails (id, conversation_id, sender_email, recipient_emails, subject, body_text, body_html, folder, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFTS', 1, datetime('now'))
      `, [newId, convId, senderEmail, recipientsJson, subject, bodyText, bodyText.replace(/\n/g, '<br>')]);
    });

    res.json({ success: true, draftId: newId, message: 'Draft saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete a Draft Email
 */
router.delete('/emails/draft/:id', async (req, res) => {
  try {
    const draftId = req.params.id;
    if (!draftId) return res.status(400).json({ error: 'Draft ID required' });
    await dbOps.execute('DELETE FROM emails WHERE id = ?', [draftId]);
    res.json({ success: true, message: 'Draft deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send outbound email or reply (with optional TextBee SMS notification for unregistered users)
 */
router.post('/emails/send', async (req, res) => {
  try {
    const rawSender = req.body.senderPhone || req.body.sender_phone;
    const rawRecipients = req.body.toRecipients || req.body.to || req.body.recipients;
    const subject = req.body.subject || '';
    let bodyText = req.body.bodyText || req.body.body || req.body.message || '';
    const bodyHtml = req.body.bodyHtml || req.body.body_html || req.body.html || null;
    const images = Array.isArray(req.body.images) ? req.body.images : (req.body.image ? [req.body.image] : []);
    const voiceMail = req.body.voiceMail || req.body.voicemail || req.body.audio || null;
    const replyToId = req.body.replyToId || req.body.reply_to_id || null;
    const conversationId = req.body.conversationId || req.body.conversation_id || null;
    const sendSmsRequested = Boolean(req.body.send_sms || req.body.sendSmsNotification || req.body.sendSms);

    let voiceMailDataUrl = null;
    let voiceMailDuration = '0:00';
    let voiceMailTranscript = '';

    if (voiceMail) {
      if (typeof voiceMail === 'object' && voiceMail.dataUrl) {
        voiceMailDataUrl = voiceMail.dataUrl;
        voiceMailDuration = voiceMail.duration || '0:00';
        voiceMailTranscript = voiceMail.transcription || voiceMail.transcript || '';
      } else if (typeof voiceMail === 'string') {
        voiceMailDataUrl = voiceMail;
        voiceMailDuration = req.body.duration || '0:00';
        voiceMailTranscript = req.body.transcription || req.body.transcript || '';
      }
    }

    if (!bodyText && (images.length > 0 || voiceMailDataUrl)) {
      if (voiceMailDataUrl) {
        bodyText = `🎙️ Voice Mail (${voiceMailDuration})${voiceMailTranscript ? `\n\n"${voiceMailTranscript}"` : ''}`;
      } else {
        bodyText = '[Photo attached]';
      }
    }

    if (!rawSender || !rawRecipients || (!bodyText && images.length === 0 && !voiceMailDataUrl)) {
      return res.status(400).json({ error: 'Sender phone, recipient(s), and message body or voice note are required' });
    }

    let cleanSender = '';
    if (String(rawSender).includes('@')) {
      const localPart = String(rawSender).split('@')[0];
      cleanSender = localPart.replace(/\D/g, '').slice(-10);
    } else {
      cleanSender = String(rawSender).replace(/\D/g, '').slice(-10);
    }

    if (!cleanSender || cleanSender.length !== 10) {
      return res.status(400).json({ error: 'Valid 10-digit sender phone number is required' });
    }

    // Build final HTML with inline images or voice mail if present
    let finalBodyHtml = bodyHtml;

    if (voiceMailDataUrl) {
      const voiceMailHtml = `
        <div class="inai-voicemail-player" data-duration="${voiceMailDuration}" data-audio-src="${voiceMailDataUrl}" style="margin: 12px 0; padding: 14px 18px; border-radius: 14px; background: linear-gradient(135deg, #064e3b 0%, #046a38 100%); color: #ffffff; max-width: 440px; box-shadow: 0 4px 14px rgba(4,106,56,0.22); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 20px;">🎙️</span>
              <div>
                <div style="font-weight: 800; font-size: 14px; letter-spacing: 0.2px;">INAI Voice Mail</div>
                <div style="font-size: 11px; opacity: 0.85;">Duration: ${voiceMailDuration}</div>
              </div>
            </div>
            <span style="background: rgba(255,255,255,0.22); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase;">Voice Note</span>
          </div>
          <audio controls src="${voiceMailDataUrl}" preload="metadata" style="width: 100%; height: 38px; border-radius: 8px; outline: none; margin-top: 4px;"></audio>
          ${voiceMailTranscript ? `<div class="voicemail-transcript-box" style="margin-top: 10px; padding: 8px 10px; background: rgba(0,0,0,0.22); border-radius: 8px; font-size: 12px; line-height: 1.4;"><strong style="opacity: 0.9;">📝 AI Transcription:</strong><br><span style="font-style: italic;">"${voiceMailTranscript.replace(/"/g, '&quot;')}"</span></div>` : ''}
        </div>
      `;
      if (finalBodyHtml) {
        finalBodyHtml = `${voiceMailHtml}${finalBodyHtml}`;
      } else {
        const textPart = bodyText ? `<div>${String(bodyText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>` : '';
        finalBodyHtml = `${voiceMailHtml}${textPart}`;
      }
    }

    if (images.length > 0) {
      const imagesHtml = images.map(img => `
        <div style="margin: 12px 0;">
          <img src="${img}" alt="Attached Photo" style="max-width: 100%; height: auto; border-radius: 10px; display: block; box-shadow: 0 3px 10px rgba(0,0,0,0.12);" />
        </div>
      `).join('');

      if (finalBodyHtml) {
        finalBodyHtml += imagesHtml;
      } else {
        const textPart = bodyText ? `<div>${String(bodyText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>` : '';
        finalBodyHtml = `${textPart}${imagesHtml}`;
      }
    }

    const email = await emailService.sendOutboundEmail({
      senderPhone: cleanSender,
      toRecipients: rawRecipients,
      subject: subject || (voiceMailDataUrl ? `🎙️ Voice Mail (${voiceMailDuration})` : ''),
      bodyText,
      bodyHtml: finalBodyHtml,
      images,
      voiceMail: voiceMailDataUrl ? { dataUrl: voiceMailDataUrl, duration: voiceMailDuration, transcript: voiceMailTranscript } : null,
      replyToId: replyToId || null,
      conversationId: conversationId || null
    });

    let smsDispatched = false;
    let smsDetails = null;

    // If SMS preview requested for unregistered recipient, dispatch via TextBee asynchronously in background
    if (sendSmsRequested) {
      setImmediate(async () => {
        try {
          const rawRecList = Array.isArray(rawRecipients) ? rawRecipients : [rawRecipients];
          for (const rec of rawRecList) {
            const parsed = emailService.parseAddress(rec);
            const recPhone = parsed.phone || (String(rec).replace(/\D/g, '').slice(-10));
            if (recPhone && recPhone.length === 10 && recPhone !== cleanSender) {
              const registeredUser = await dbOps.queryOne('SELECT id FROM users WHERE phone_number LIKE ?', [`%${recPhone}%`]);

              if (!registeredUser) {
                const senderUser = await dbOps.queryOne('SELECT display_name FROM users WHERE phone_number LIKE ?', [`%${cleanSender}%`]);
                const senderName = (senderUser && senderUser.display_name && !/^User\s*\d+/i.test(senderUser.display_name))
                  ? senderUser.display_name
                  : `+91 ${cleanSender.slice(0, 5)} ${cleanSender.slice(5)}`;
                
                const cleanSnippet = (bodyText || '').replace(/<[^>]+>/g, '').trim().slice(0, 90);
                const domain = config.domainName || 'alphastack.wwisvnr.com';
                const smsText = `INAI: ${senderName} sent you a message: "${subject ? subject + ' - ' : ''}${cleanSnippet}". Read & reply at https://${domain}`;

                await textbeeService.sendSms(recPhone, smsText).catch(e => console.warn('TextBee invite notice:', e.message));
              }
            }
          }
        } catch (smsErr) {
          console.warn('Background SMS trigger error:', smsErr.message);
        }
      });
    }

    res.json({ success: true, email, message: 'Message sent immediately' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Direct TextBee SMS dispatch endpoint
 */
router.post('/sms/send-textbee', async (req, res) => {
  try {
    const to = req.body.to || req.body.phone || req.body.recipient;
    const message = req.body.message || req.body.body || req.body.text;
    if (!to || !message) {
      return res.status(400).json({ error: 'Recipient phone number and message are required' });
    }
    const result = await textbeeService.sendSms(to, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Update or save person/contact info (name, email, avatar, bio, sub-number alias)
 */
router.post('/contacts/update', async (req, res) => {
  try {
    const { phone, name, email, bio, avatar_url, alias_tag } = req.body;
    const target = (phone || email || '').trim();
    if (!target) {
      return res.status(400).json({ error: 'Phone or email is required' });
    }
    const cleanPhone = String(target).replace(/\D/g, '').slice(-10);
    const targetEmail = (email || (target.includes('@') ? target : '')).toLowerCase().trim();

    // Guard: Prevent editing other users' info!
    const callerPhone = String(req.body.caller_phone || req.body.callerPhone || '').replace(/\D/g, '').slice(-10);
    if (callerPhone && cleanPhone && cleanPhone !== callerPhone) {
      return res.status(403).json({ error: 'Forbidden: You can only edit your own Digital ID profile' });
    }

    let user = null;
    if (cleanPhone && cleanPhone.length === 10) {
      user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanPhone]);
    }
    if (!user && targetEmail) {
      user = await dbOps.queryOne('SELECT * FROM users WHERE email_address = ?', [targetEmail]);
    }

    if (user) {
      await dbOps.execute(`
        UPDATE users 
        SET display_name = COALESCE(?, display_name),
            email_address = COALESCE(?, email_address),
            bio = COALESCE(?, bio),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `, [name || null, targetEmail || null, bio || null, avatar_url || null, user.id]);
    } else {
      const newId = 'user_' + Date.now();
      const finalPhone = (cleanPhone && cleanPhone.length === 10) ? cleanPhone : ('ext_' + Date.now());
      const defaultEmail = targetEmail || `${finalPhone}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, bio, avatar_url, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, ?, ?, 'WEB_CLIENT', 0)
      `, [newId, finalPhone, defaultEmail, name || (targetEmail ? targetEmail.split('@')[0] : `User ${finalPhone}`), bio || '', avatar_url || '']);
      user = { id: newId, phone_number: finalPhone, email_address: defaultEmail };
    }

    if (alias_tag && cleanPhone && cleanPhone.length === 10) {
      const cleanTag = alias_tag.replace(/^\.+/, '').trim().toLowerCase();
      if (cleanTag) {
        const aliasEmail = `${cleanPhone}.${cleanTag}@${config.domainName}`;
        const existingAlias = await dbOps.queryOne('SELECT id FROM aliases WHERE alias_email = ?', [aliasEmail]);
        if (!existingAlias) {
          await dbOps.execute(`
            INSERT INTO aliases (id, user_id, alias_email, label, is_active)
            VALUES (?, ?, ?, ?, 1)
          `, ['alias_' + Date.now(), user.id, aliasEmail, cleanTag]);
        }
      }
    }

    const updatedUser = await dbOps.queryOne('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json({ success: true, contact: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get contact profile and ID card details
 */
router.get('/contacts/detail/:phone', async (req, res) => {
  try {
    const rawTarget = decodeURIComponent(req.params.phone || '');
    const cleanPhone = String(rawTarget).replace(/\D/g, '').slice(-10);
    let user = null;
    if (cleanPhone && cleanPhone.length === 10) {
      user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanPhone]);
    }
    if (!user && rawTarget.includes('@')) {
      user = await dbOps.queryOne('SELECT * FROM users WHERE email_address = ?', [rawTarget.toLowerCase().trim()]);
    }
    
    // Check aliases
    let aliases = [];
    if (user) {
      aliases = await dbOps.queryAll('SELECT * FROM aliases WHERE user_id = ? AND is_active = 1', [user.id]);
    }

    // Message stats
    const statsTarget = user ? user.phone_number : (cleanPhone || rawTarget);
    const stats = await dbOps.queryOne(`
      SELECT COUNT(*) as total_messages 
      FROM emails 
      WHERE sender_email LIKE ? OR recipient_emails LIKE ?
    `, [`%${statsTarget}%`, `%${statsTarget}%`]);

    res.json({
      success: true,
      contact: user || {
        phone_number: (cleanPhone && cleanPhone.length === 10) ? cleanPhone : rawTarget,
        display_name: user ? user.display_name : (rawTarget.includes('@') ? rawTarget.split('@')[0] : `User ${cleanPhone}`),
        email_address: user ? user.email_address : (rawTarget.includes('@') ? rawTarget : `${cleanPhone}@${config.domainName}`),
        avatar_url: user ? user.avatar_url : '',
        bio: user ? user.bio : ''
      },
      aliases: aliases || [],
      total_messages: stats ? stats.total_messages : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Toggle Star
 */
router.post('/emails/:id/star', async (req, res) => {
  try {
    const { id } = req.params;
    const email = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [id]);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const newStarred = email.is_starred === 1 ? 0 : 1;
    await dbOps.execute('UPDATE emails SET is_starred = ? WHERE id = ?', [newStarred, id]);
    res.json({ success: true, is_starred: newStarred });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Toggle Important / Priority
 */
router.post('/emails/:id/important', async (req, res) => {
  try {
    const { id } = req.params;
    const email = await dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [id]);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const newImportant = email.is_important === 1 ? 0 : 1;
    await dbOps.execute('UPDATE emails SET is_important = ? WHERE id = ?', [newImportant, id]);
    res.json({ success: true, is_important: newImportant });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk action on emails (delete, archive, read, unread, star, important, move)
 */
/**
 * Bulk action on emails (delete, archive, read, unread, star, important, move)
 */
router.post('/emails/bulk', async (req, res) => {
  try {
    const rawIds = req.body.ids || req.body.emailIds;
    const ids = Array.isArray(rawIds) ? rawIds : (rawIds ? [rawIds] : []);
    const { action, targetFolder, folder } = req.body;
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Email IDs required' });
    }
    const placeholders = ids.map(() => '?').join(',');

    if (action === 'delete') {
      // Record in persistent deleted signatures so IMAP sync never resurrects them
      try {
        const emailsToDelete = await dbOps.queryAll(`SELECT id, sender_email, subject FROM emails WHERE id IN (${placeholders})`, ids);
        for (const em of emailsToDelete) {
          await dbOps.recordDeletedEmail(em);
        }
      } catch (e) {}

      if (folder === 'TRASH') {
        await dbOps.execute(`DELETE FROM emails WHERE id IN (${placeholders})`, ids);
      } else {
        await dbOps.execute(`UPDATE emails SET folder = 'TRASH' WHERE id IN (${placeholders})`, ids);
      }
    } else if (action === 'archive') {
      await dbOps.execute(`UPDATE emails SET folder = 'ARCHIVE' WHERE id IN (${placeholders})`, ids);
    } else if (action === 'read') {
      await dbOps.execute(`UPDATE emails SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);
    } else if (action === 'unread') {
      await dbOps.execute(`UPDATE emails SET is_read = 0, read_at = NULL WHERE id IN (${placeholders})`, ids);
    } else if (action === 'star') {
      await dbOps.execute(`UPDATE emails SET is_starred = 1 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'important') {
      await dbOps.execute(`UPDATE emails SET is_important = 1 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'spam' || action === 'report') {
      await dbOps.execute(`UPDATE emails SET folder = 'SPAM' WHERE id IN (${placeholders})`, ids);
    } else if (action === 'move' && targetFolder) {
      await dbOps.execute(`UPDATE emails SET folder = ? WHERE id IN (${placeholders})`, [targetFolder.toUpperCase(), ...ids]);
    }
    res.json({ success: true, count: ids.length, action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Mark single email as read
 */
router.post('/emails/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await dbOps.execute('UPDATE emails SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    res.json({ success: true, id, is_read: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Mark single email as unread
 */
router.post('/emails/:id/unread', async (req, res) => {
  try {
    const { id } = req.params;
    await dbOps.execute('UPDATE emails SET is_read = 0, read_at = NULL WHERE id = ?', [id]);
    res.json({ success: true, id, is_read: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Mark all messages in a conversation as read
 */
router.post('/conversations/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await dbOps.execute('UPDATE emails SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE conversation_id = ?', [id]);
    res.json({ success: true, conversation_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get / Set Read Receipts Settings
 */
router.get('/settings/read-receipts', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ success: true, enabled: true });
    const clean = phone.replace(/\D/g, '').slice(-10);
    const user = await dbOps.queryOne('SELECT read_receipts_enabled FROM users WHERE phone_number LIKE ? LIMIT 1', [`%${clean}%`]);
    res.json({ success: true, enabled: user ? user.read_receipts_enabled === 1 : true });
  } catch (err) {
    res.json({ success: true, enabled: true });
  }
});

router.post('/settings/read-receipts', async (req, res) => {
  try {
    const { phone, enabled } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const clean = phone.replace(/\D/g, '').slice(-10);
    await dbOps.execute('UPDATE users SET read_receipts_enabled = ? WHERE phone_number LIKE ?', [enabled ? 1 : 0, `%${clean}%`]);
    res.json({ success: true, enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete single email
 */
router.delete('/emails/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const email = await dbOps.queryOne('SELECT id, folder, sender_email, subject FROM emails WHERE id = ?', [id]);
    if (!email) return res.json({ success: true, message: 'Already deleted' });
    
    // Record into persistent deleted list so IMAP sync never resurrects it
    await dbOps.recordDeletedEmail(email);

    if (email.folder === 'TRASH') {
      await dbOps.execute('DELETE FROM emails WHERE id = ?', [id]);
    } else {
      await dbOps.execute("UPDATE emails SET folder = 'TRASH' WHERE id = ?", [id]);
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Move to Folder (e.g. TRASH, SPAM, INBOX)
 */
router.post('/emails/:id/move', async (req, res) => {
  try {
    const { id } = req.params;
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ error: 'Target folder is required' });

    await dbOps.execute('UPDATE emails SET folder = ? WHERE id = ?', [folder.toUpperCase(), id]);
    res.json({ success: true, folder: folder.toUpperCase() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Inbound Email Webhook (for Hostinger Catch-All email forwarding)
 */
router.post('/email/inbound', async (req, res) => {
  try {
    const { from, to, subject, text, html, attachments } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to fields are required' });
    }

    const email = await emailService.processInboundEmail({
      from,
      to,
      subject,
      text,
      html,
      attachments
    });

    res.json({ success: true, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger immediate sync from Hostinger IMAP mailbox
 */
router.post('/emails/sync', async (req, res) => {
  try {
    const result = await imapSyncService.syncHostingerMailbox();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Auto-heal truncated emails and re-sync full LONGTEXT from Hostinger IMAP
 */
router.post('/emails/heal-truncated', async (req, res) => {
  try {
    if (mysqlPool) {
      try {
        await mysqlPool.execute('ALTER TABLE emails MODIFY COLUMN body_text LONGTEXT');
        await mysqlPool.execute('ALTER TABLE emails MODIFY COLUMN body_html LONGTEXT');
        await mysqlPool.execute('ALTER TABLE emails MODIFY COLUMN recipient_emails LONGTEXT');
      } catch (e) {}
    }
    await dbOps.execute('DELETE FROM emails WHERE LENGTH(body_html) = 65535');
    const result = await imapSyncService.syncHostingerMailbox();
    res.json({ success: true, message: 'Truncated emails healed and re-synced successfully', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * User Network Contacts (Returns registered INAI users and past email contacts for instant autocomplete)
 */
router.get('/contacts', async (req, res) => {
  try {
    const currentPhone = req.query.phone || '';
    const cleanPhone = String(currentPhone).replace(/\D/g, '').slice(-10);
    const q = (req.query.q || '').trim();

    if (q.length >= 1) {
      // User is typing phone or name in compose
      const searchPattern = `%${q}%`;
      const contacts = await dbOps.queryAll(`
        SELECT id, phone_number, email_address, display_name, registration_channel
        FROM users 
        WHERE phone_number != ? 
          AND (phone_number LIKE ? OR display_name LIKE ? OR email_address LIKE ?)
        ORDER BY created_at DESC LIMIT 15
      `, [cleanPhone, searchPattern, searchPattern, searchPattern]);

      return res.json({ contacts, isSearch: true });
    }

    // Default: Return all registered users for instant autocomplete dropdown
    const contacts = await dbOps.queryAll(`
      SELECT id, phone_number, email_address, display_name, registration_channel
      FROM users 
      WHERE phone_number != ?
      ORDER BY created_at DESC LIMIT 30
    `, [cleanPhone]);

    res.json({ contacts, isRecent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Filter device contact numbers to return ONLY those registered with PhoneMail
 */
router.post('/contacts/filter-phonemail', async (req, res) => {
  try {
    const { phoneNumbers = [] } = req.body;
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.json({ registeredContacts: [] });
    }

    const cleanNumbers = phoneNumbers
      .map(p => String(p).replace(/\D/g, '').slice(-10))
      .filter(p => p.length === 10);

    if (cleanNumbers.length === 0) {
      return res.json({ registeredContacts: [] });
    }

    // De-duplicate queried numbers
    const uniqueNumbers = Array.from(new Set(cleanNumbers));
    
    // Find all matching registered users across all channels (handle clean 10-digit, prefix, and email)
    const conditions = uniqueNumbers.map(() => `(phone_number LIKE ? OR email_address LIKE ?)`).join(' OR ');
    const params = [];
    uniqueNumbers.forEach(num => {
      params.push(`%${num}%`, `%${num}@%`);
    });

    const registered = await dbOps.queryAll(`
      SELECT id, phone_number, email_address, display_name, registration_channel
      FROM users 
      WHERE ${conditions}
    `, params);

    // Auto-discover any numbers from past emails and auto-register them in users
    for (const num of uniqueNumbers) {
      const alreadyFound = registered.some(r => String(r.phone_number || '').replace(/\D/g, '').slice(-10) === num);
      if (!alreadyFound) {
        try {
          const em = await dbOps.queryOne(`
            SELECT recipient_emails, sender_email FROM emails 
            WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
            ORDER BY created_at DESC LIMIT 1
          `, [`%${num}%`, `%${num}%`]);

          if (em) {
            let discoveredName = `User ${num}`;
            const fullStr = `${em.recipient_emails || ''} ${em.sender_email || ''}`;
            const match = fullStr.match(/"([^"]+)"\s*<[^>]*[0-9]{10}/) || 
                          fullStr.match(/([A-Za-z\s]{3,30})\s*\(\+?91\s*[0-9]{5}\s*[0-9]{5}\)/) ||
                          fullStr.match(/([A-Za-z\s]{3,30})\s*<[^>]*[0-9]{10}/);
            if (match && match[1] && !/^User\s*\d+/i.test(match[1])) {
              discoveredName = match[1].trim();
            }

            const newUserId = 'user_' + num;
            const newEmail = `${num}@${config.domainName || 'alphastack.wwisvnr.com'}`;
            await dbOps.execute(`
              INSERT INTO users (id, phone_number, email_address, display_name, language, registration_channel, has_mobile_app)
              VALUES (?, ?, ?, ?, 'en', 'WEB_CLIENT', 1)
              ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
            `, [newUserId, num, newEmail, discoveredName]).catch(async () => {
              await dbOps.execute(`
                INSERT OR REPLACE INTO users (id, phone_number, email_address, display_name, language, registration_channel, has_mobile_app)
                VALUES (?, ?, ?, ?, 'en', 'WEB_CLIENT', 1)
              `, [newUserId, num, newEmail, discoveredName]).catch(() => {});
            });

            registered.push({
              id: newUserId,
              phone_number: num,
              email_address: newEmail,
              display_name: discoveredName,
              registration_channel: 'WEB_CLIENT'
            });
          }
        } catch (autoErr) {}
      }
    }

    // Normalize phone numbers in output to 10 digits
    const normalized = (registered || []).map(u => ({
      ...u,
      phone_number: String(u.phone_number || '').replace(/\D/g, '').slice(-10)
    }));

    res.json({ registeredContacts: normalized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Aliases Management
 */
router.get('/aliases', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.json({ aliases: [] });
    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    const user = await dbOps.queryOne('SELECT id FROM users WHERE phone_number = ?', [cleanPhone]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const aliases = await dbOps.queryAll('SELECT * FROM aliases WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    res.json({ aliases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/aliases', async (req, res) => {
  try {
    const { phone, aliasTag, label } = req.body;
    if (!phone || !aliasTag) {
      return res.status(400).json({ error: 'Phone and alias tag are required' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    const cleanTag = String(aliasTag).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const user = await dbOps.queryOne('SELECT id FROM users WHERE phone_number = ?', [cleanPhone]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const fullAlias = `${cleanPhone}.${cleanTag}@${config.domainName}`;
    const id = 'alias_' + Date.now();

    await dbOps.execute(`INSERT INTO aliases (id, user_id, alias_email, label) VALUES (?, ?, ?, ?)`,
      [id, user.id, fullAlias, label || cleanTag]);
    res.json({ success: true, alias: { id, alias_email: fullAlias, label } });
  } catch (err) {
    res.status(400).json({ error: 'Alias already exists' });
  }
});

/**
 * Smart Language Translation API
 * Translates text safely via backend with error handling and original text fallback.
 */
router.post('/translate', async (req, res) => {
  try {
    const { text = '', targetLang = 'en', sourceLang = 'auto' } = req.body;
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      return res.json({ success: true, translatedText: '', originalText: '', targetLang });
    }

    const tl = String(targetLang || 'en').toLowerCase();
    const sl = String(sourceLang || 'auto').toLowerCase();

    const doTranslate = async (q, from, to) => {
      const transUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(q.substring(0, 3000))}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const r = await fetch(transUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!r.ok) return null;
        const d = await r.json();
        let resText = '';
        if (Array.isArray(d) && Array.isArray(d[0])) {
          resText = d[0].map(item => item[0]).join('');
        }
        return { text: resText, detectedLang: d && d[2] ? d[2] : from };
      } catch (e) {
        clearTimeout(timeout);
        return null;
      }
    };

    let result = await doTranslate(cleanText, sl, tl);
    let translatedText = (result && result.text) ? result.text : cleanText;
    let detectedSource = (result && result.detectedLang) ? result.detectedLang : sl;

    // Check if transliteration fallback is needed (e.g. Romanized Indian languages / Tanglish / Hinglish)
    const isLatinScript = /^[A-Za-z0-9\s.,!?'"()\-]+$/.test(cleanText);
    if (isLatinScript && (translatedText.trim().toLowerCase() === cleanText.trim().toLowerCase() || detectedSource !== 'en')) {
      const candidateLangs = [detectedSource, 'ta', 'hi', 'te', 'kn', 'bn'].filter(l => l && l !== 'en' && l !== 'auto');
      const uniqueLangs = Array.from(new Set(candidateLangs));

      for (const lang of uniqueLangs) {
        try {
          const itcUrl = `https://inputtools.google.com/request?text=${encodeURIComponent(cleanText)}&itc=${lang}-t-i0-und&num=1`;
          const itcRes = await fetch(itcUrl);
          if (itcRes.ok) {
            const itcData = await itcRes.json();
            if (itcData && itcData[0] === 'SUCCESS' && itcData[1] && itcData[1][0] && itcData[1][0][1] && itcData[1][0][1][0]) {
              const nativeText = itcData[1][0][1][0];
              if (nativeText && nativeText !== cleanText) {
                const nativeTrans = await doTranslate(nativeText, lang, tl);
                if (nativeTrans && nativeTrans.text && nativeTrans.text.trim().toLowerCase() !== nativeText.trim().toLowerCase()) {
                  translatedText = nativeTrans.text;
                  detectedSource = lang;
                  break;
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    res.json({
      success: true,
      translatedText: translatedText || cleanText,
      originalText: cleanText,
      targetLang: tl,
      detectedSourceLang: detectedSource
    });
  } catch (err) {
    console.warn('Translation warning (falling back to original):', err.message);
    res.json({
      success: false,
      translatedText: String(req.body.text || ''),
      originalText: String(req.body.text || ''),
      targetLang: req.body.targetLang || 'en',
      error: 'Translation temporarily unavailable. Showing original message.'
    });
  }
});

export default router;

