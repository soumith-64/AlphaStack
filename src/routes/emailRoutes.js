import express from 'express';
import { dbOps } from '../database/db.js';
import { emailService } from '../services/emailService.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * List conversations for Mobile Spike Mail View
 */
router.get('/conversations', (req, res) => {
  const userPhone = req.query.phone || '9876543210';
  const cleanPhone = String(userPhone).replace(/\D/g, '').slice(-10);

  const conversations = dbOps.queryAll(`
    SELECT c.*, 
      (SELECT body_text FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT sender_email FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_sender,
      (SELECT created_at FROM emails WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_time,
      (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id AND is_read = 0) as unread_count,
      (SELECT COUNT(*) FROM emails WHERE conversation_id = c.id) as message_count
    FROM conversations c
    ORDER BY c.updated_at DESC
  `);

  res.json({ conversations });
});

/**
 * Get message thread for a conversation
 */
router.get('/conversations/:id', (req, res) => {
  const { id } = req.params;
  const conversation = dbOps.queryOne('SELECT * FROM conversations WHERE id = ?', [id]);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = dbOps.queryAll(`
    SELECT * FROM emails 
    WHERE conversation_id = ? 
    ORDER BY created_at ASC
  `, [id]);

  // Mark all unread messages in this conversation as read
  dbOps.execute(`UPDATE emails SET is_read = 1 WHERE conversation_id = ?`, [id]);

  res.json({ conversation, messages });
});

/**
 * List flat emails for Desktop Gmail View
 */
router.get('/emails', (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const userPhone = req.query.phone || '9876543210';

  let emails;
  if (folder.toUpperCase() === 'SENT') {
    emails = dbOps.queryAll(`
      SELECT * FROM emails 
      WHERE sender_email LIKE ? 
      ORDER BY created_at DESC
    `, [`%${userPhone}%`]);
  } else if (folder.toUpperCase() === 'STARRED') {
    emails = dbOps.queryAll(`
      SELECT * FROM emails 
      WHERE is_starred = 1 
      ORDER BY created_at DESC
    `);
  } else {
    emails = dbOps.queryAll(`
      SELECT * FROM emails 
      WHERE folder = ? 
      ORDER BY created_at DESC
    `, [folder.toUpperCase()]);
  }

  res.json({ emails });
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
router.post('/emails/:id/star', (req, res) => {
  const { id } = req.params;
  const email = dbOps.queryOne('SELECT * FROM emails WHERE id = ?', [id]);
  if (!email) return res.status(404).json({ error: 'Email not found' });

  const newStarred = email.is_starred === 1 ? 0 : 1;
  dbOps.execute('UPDATE emails SET is_starred = ? WHERE id = ?', [newStarred, id]);
  res.json({ success: true, is_starred: newStarred });
});

/**
 * Move to Folder (e.g. TRASH, SPAM, INBOX)
 */
router.post('/emails/:id/move', (req, res) => {
  const { id } = req.params;
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'Target folder is required' });

  dbOps.execute('UPDATE emails SET folder = ? WHERE id = ?', [folder.toUpperCase(), id]);
  res.json({ success: true, folder: folder.toUpperCase() });
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
 * Aliases Management
 */
router.get('/aliases', (req, res) => {
  const phone = req.query.phone || '9876543210';
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const user = dbOps.queryOne('SELECT id FROM users WHERE phone_number = ?', [cleanPhone]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const aliases = dbOps.queryAll('SELECT * FROM aliases WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
  res.json({ aliases });
});

router.post('/aliases', (req, res) => {
  const { phone, aliasTag, label } = req.body;
  if (!phone || !aliasTag) {
    return res.status(400).json({ error: 'Phone and alias tag are required' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const cleanTag = String(aliasTag).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const user = dbOps.queryOne('SELECT id FROM users WHERE phone_number = ?', [cleanPhone]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const fullAlias = `${cleanPhone}.${cleanTag}@${config.domainName}`;
  const id = 'alias_' + Date.now();

  try {
    dbOps.execute(`INSERT INTO aliases (id, user_id, alias_email, label) VALUES (?, ?, ?, ?)`,
      [id, user.id, fullAlias, label || cleanTag]);
    res.json({ success: true, alias: { id, alias_email: fullAlias, label } });
  } catch (err) {
    res.status(400).json({ error: 'Alias already exists' });
  }
});

export default router;
