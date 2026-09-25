import express from 'express';
import { dbOps } from '../database/db.js';
import { emailService } from '../services/emailService.js';
import { imapSyncService } from '../services/imapSyncService.js';
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

    const conversations = await dbOps.queryAll(`
      SELECT DISTINCT c.id, c.is_group, c.subject, c.created_at, c.updated_at,
        COALESCE(
          (SELECT phone_number FROM conversation_participants WHERE conversation_id = c.id AND phone_number NOT LIKE ? LIMIT 1),
          c.participant_phone
        ) as participant_phone,
        (SELECT body_text FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT sender_email FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_sender,
        (SELECT created_at FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_time,
        (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id AND is_read = 0 AND sender_email NOT LIKE ?) as unread_count,
        (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id) as message_count
      FROM conversations c
      JOIN conversation_participants cp ON c.id = cp.conversation_id
      WHERE cp.phone_number = ? OR cp.phone_number LIKE ?
      ORDER BY c.updated_at DESC
    `, [`%${cleanPhone}%`, `%${cleanPhone}%`, cleanPhone, `%${cleanPhone}%`]);

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

    let emails;
    if (folder === 'ALL') {
      // Show ALL emails: inbound, outbound sent, and alias/sub-number mails
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) AND folder != 'TRASH'
        ORDER BY is_important DESC, created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'IMPORTANT') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
          AND is_important = 1 AND folder != 'TRASH'
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
    } else if (folder === 'STARRED') {
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE (recipient_emails LIKE ? OR sender_email LIKE ?) 
          AND is_starred = 1 AND folder != 'TRASH'
        ORDER BY created_at DESC
      `, [`%${cleanPhone}%`, `%${cleanPhone}%`]);
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
      emails = await dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE recipient_emails LIKE ? AND (folder = 'INBOX' OR folder IS NULL)
        ORDER BY is_important DESC, created_at DESC
      `, [`%${cleanPhone}%`]);
    }

    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send outbound email or reply
 */
router.post('/emails/send', async (req, res) => {
  try {
    const { senderPhone, toRecipients, subject, bodyText, replyToId, conversationId } = req.body;
    if (!senderPhone || !toRecipients || !bodyText) {
      return res.status(400).json({ error: 'Sender phone, recipient(s), and message body are required' });
    }

    const email = await emailService.sendOutboundEmail({
      senderPhone: String(senderPhone).replace(/\D/g, '').slice(-10),
      toRecipients,
      subject,
      bodyText,
      replyToId: replyToId || null,
      conversationId: conversationId || null
    });

    res.json({ success: true, email });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
router.post('/emails/bulk', async (req, res) => {
  try {
    const { ids, action, targetFolder } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Email IDs required' });
    }
    const placeholders = ids.map(() => '?').join(',');

    if (action === 'delete') {
      await dbOps.execute(`UPDATE emails SET folder = 'TRASH' WHERE id IN (${placeholders})`, ids);
    } else if (action === 'archive') {
      await dbOps.execute(`UPDATE emails SET folder = 'ARCHIVE' WHERE id IN (${placeholders})`, ids);
    } else if (action === 'read') {
      await dbOps.execute(`UPDATE emails SET is_read = 1 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'unread') {
      await dbOps.execute(`UPDATE emails SET is_read = 0 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'star') {
      await dbOps.execute(`UPDATE emails SET is_starred = 1 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'important') {
      await dbOps.execute(`UPDATE emails SET is_important = 1 WHERE id IN (${placeholders})`, ids);
    } else if (action === 'move' && targetFolder) {
      await dbOps.execute(`UPDATE emails SET folder = ? WHERE id IN (${placeholders})`, [targetFolder.toUpperCase(), ...ids]);
    }
    res.json({ success: true, count: ids.length, action });
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
 * User Network Contacts (Only returns user's actual conversation contacts or searched registered PhoneMail users)
 */
router.get('/contacts', async (req, res) => {
  try {
    const currentPhone = req.query.phone || '';
    const cleanPhone = String(currentPhone).replace(/\D/g, '').slice(-10);
    const q = (req.query.q || '').trim();

    if (q.length >= 2) {
      // User is actively searching by phone or name
      const searchPattern = `%${q}%`;
      const contacts = await dbOps.queryAll(`
        SELECT id, phone_number, email_address, display_name, registration_channel
        FROM users 
        WHERE phone_number != ? 
          AND (phone_number LIKE ? OR display_name LIKE ?)
          AND registration_channel IN ('PHONE_EMAIL', 'WEB_CLIENT', 'MOBILE_APP', 'TELEGRAM', 'WEB_PORTAL')
        ORDER BY created_at DESC LIMIT 8
      `, [cleanPhone, searchPattern, searchPattern]);

      return res.json({ contacts, isSearch: true });
    }

    // Default when opening compose: ONLY return people this user has communicated with
    if (!cleanPhone) {
      return res.json({ contacts: [], isRecent: true });
    }

    const contacts = await dbOps.queryAll(`
      SELECT DISTINCT u.id, u.phone_number, u.email_address, u.display_name, u.registration_channel
      FROM users u
      JOIN conversation_participants cp ON u.phone_number = cp.phone_number
      JOIN conversation_participants my_cp ON cp.conversation_id = my_cp.conversation_id
      WHERE my_cp.phone_number = ? 
        AND u.phone_number != ?
        AND u.registration_channel IN ('PHONE_EMAIL', 'WEB_CLIENT', 'MOBILE_APP', 'TELEGRAM', 'WEB_PORTAL')
      ORDER BY u.created_at DESC LIMIT 15
    `, [cleanPhone, cleanPhone]);

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
    const placeholders = uniqueNumbers.map(() => '?').join(',');

    const registered = await dbOps.queryAll(`
      SELECT id, phone_number, email_address, display_name, registration_channel
      FROM users 
      WHERE phone_number IN (${placeholders})
        AND (registration_channel != 'INBOUND_EMAIL' OR has_mobile_app = 1)
    `, uniqueNumbers);

    res.json({ registeredContacts: registered });
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

export default router;
