import express from 'express';
import { dbOps } from '../database/db.js';
import { config } from '../config.js';

const router = express.Router();

// In-memory OTP storage for rapid verification
const otpStore = new Map();

/**
 * Request OTP for a phone number
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const cleanNumber = String(phoneNumber).replace(/\D/g, '').slice(-10);
    const otp = '123456'; // Default demo OTP; in production random 6-digit
    otpStore.set(cleanNumber, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

    await dbOps.logTelephony(cleanNumber, 'OUTGOING_OTP', `Your PhoneMail verification code is ${otp}`);

    console.log(`🔑 [OTP ISSUED] Phone: ${cleanNumber} | OTP: ${otp}`);
    res.json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber: cleanNumber
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Verify OTP and authenticate/create user
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp, clientType = 'WEB_CLIENT', displayName } = req.body;
    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }

    const cleanNumber = String(phoneNumber).replace(/\D/g, '').slice(-10);
    const record = otpStore.get(cleanNumber);

    // Accept demo OTP '123456' or valid memory OTP
    if (otp !== '123456' && (!record || record.otp !== otp)) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Lookup or create user
    let user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
    const isMobile = clientType === 'MOBILE_CLIENT' || clientType === 'MOBILE_APP';

    if (!user) {
      const userId = 'user_' + Date.now();
      const email = `${cleanNumber}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [userId, cleanNumber, email, displayName || `User ${cleanNumber}`, clientType, isMobile ? 1 : 0]);
      user = await dbOps.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    } else if (isMobile && user.has_mobile_app === 0) {
      // Upgrade user to mobile client
      await dbOps.execute('UPDATE users SET has_mobile_app = 1 WHERE id = ?', [user.id]);
      user.has_mobile_app = 1;
    }

    otpStore.delete(cleanNumber);

    res.json({
      success: true,
      user,
      token: `token_${user.id}_${Date.now()}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Rapid 2-field portal registration (auto-resets)
 */
router.post('/portal-register', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }

    const cleanNumber = String(phoneNumber).replace(/\D/g, '').slice(-10);
    if (otp !== '123456') {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    let user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
    if (!user) {
      const userId = 'user_' + Date.now();
      const email = `${cleanNumber}@${config.domainName}`;
      await dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, 'WEB_PORTAL', 0)
      `, [userId, cleanNumber, email, `User ${cleanNumber}`]);
      user = await dbOps.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    }

    await dbOps.logTelephony(cleanNumber, 'OUTGOING_NOTIFICATION_SMS', `Welcome to PhoneMail! Your account has been registered via Web Portal.`);

    res.json({
      success: true,
      message: `Account created for ${user.email_address}`,
      emailAddress: user.email_address
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get current profile info
 */
router.get('/me', async (req, res) => {
  try {
    const phone = req.query.phone || '9876543210';
    const cleanNumber = String(phone).replace(/\D/g, '').slice(-10);
    const user = await dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const aliases = await dbOps.queryAll('SELECT * FROM aliases WHERE user_id = ?', [user.id]);
    res.json({ user, aliases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
