import express from 'express';
import { dbOps } from '../database/db.js';
import { telephonyService } from '../services/telephonyService.js';
import { emailService } from '../services/emailService.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * Get recent telephony and SMS logs
 */
router.get('/logs', async (req, res) => {
  try {
    const logs = await dbOps.queryAll(`
      SELECT * FROM telephony_logs 
      ORDER BY created_at DESC 
      LIMIT 30
    `);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simulate Inbound Voice Call
 */
router.post('/call', async (req, res) => {
  try {
    const { fromNumber } = req.body;
    const cleanNumber = String(fromNumber || '9811223344').replace(/\D/g, '').slice(-10);
    const twiml = await telephonyService.handleIncomingCall(cleanNumber);

    res.json({
      success: true,
      message: 'Call connected',
      fromNumber: cleanNumber,
      prompt: 'Welcome to PhoneMail. Press 1 to create an email account with this phone number. Press 2 to listen to your unread emails.',
      twiml
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simulate Keypad Input
 */
router.post('/keypad', async (req, res) => {
  try {
    const { digit, fromNumber } = req.body;
    const cleanNumber = String(fromNumber || '9811223344').replace(/\D/g, '').slice(-10);
    const twiml = await telephonyService.handleGather(String(digit), cleanNumber);

    res.json({
      success: true,
      digit,
      twiml
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simulate Inbound SMS
 */
router.post('/send-sms', async (req, res) => {
  try {
    const { fromNumber, message } = req.body;
    const cleanNumber = String(fromNumber || '9811223344').replace(/\D/g, '').slice(-10);
    const twiml = await telephonyService.handleIncomingSMS(cleanNumber, message || 'REGISTER');

    res.json({
      success: true,
      twiml
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Simulate Inbound Email
 */
router.post('/send-email', async (req, res) => {
  try {
    const { from, to, subject, body } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'Sender and recipient are required' });
    }

    const email = await emailService.processInboundEmail({
      from,
      to,
      subject: subject || 'Test Email from Judge Simulator',
      text: body || 'This is a test email sent from the PhoneMail Judge Evaluation Lab.',
      html: `<p>${body || 'This is a test email sent from the PhoneMail Judge Evaluation Lab.'}</p>`
    });

    res.json({
      success: true,
      message: 'Email ingested into local parser successfully',
      email
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
