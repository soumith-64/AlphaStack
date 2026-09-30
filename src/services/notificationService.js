import { dbOps } from '../database/db.js';
import { config } from '../config.js';
import { textbeeService } from './textbeeService.js';

let ioInstance = null;

export const notificationService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  /**
   * On inbound mail reception:
   * Per user requirement, do NOT send SMS immediately.
   * SMS is only dispatched if the user has NOT viewed the email for 4 hours.
   */
  async checkAndNotify(email, recipientUser) {
    if (!recipientUser) return;
    const cleanPhone = String(recipientUser.phone_number || '').replace(/\D/g, '').slice(-10);
    console.log(`⏱️ [4-HR DELAYED SMS QUEUED] Email ID: ${email.id} for ${cleanPhone}. Will dispatch SMS if unviewed after 4 hours.`);
  },

  /**
   * Dispatches SMS with SUBJECT ONLY to users who have unread email older than 4 hours
   */
  async dispatchSubjectOnlySms(phone, subject) {
    const cleanPhone = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length !== 10) return null;

    const domain = config.domainName || 'alphastack.wwisvnr.com';
    const cleanSubject = String(subject || '(No Subject)').trim();
    // Subject only message per user specification
    const smsBody = `You have received a new email: "${cleanSubject}". View at: https://${domain}`;

    console.log(`📱 [4-HR UNVIEWED EMAIL SMS DISPATCH] To: ${cleanPhone} | Body: "${smsBody}"`);

    // 1. Primary TextBee Gateway
    let textbeeResult = null;
    try {
      textbeeResult = await textbeeService.sendSms(cleanPhone, smsBody);
    } catch (tbErr) {
      console.warn('TextBee 4-hr delayed SMS error:', tbErr.message);
    }

    // 2. Fallback Twilio if configured
    if (config.twilio.accountSid && config.twilio.authToken) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
        const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
        const formattedTo = `+91${cleanPhone}`;

        const params = new URLSearchParams({
          To: formattedTo,
          From: config.twilio.phoneNumber,
          Body: smsBody
        });

        await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
      } catch (err) {
        console.warn('Twilio 4-hr delayed SMS error:', err.message);
      }
    }

    return textbeeResult;
  },

  /**
   * Periodic scanner for emails unviewed/unread for >= 4-5 hours
   */
  async checkDelayedUnreadEmails() {
    try {
      const delayHours = parseInt(process.env.UNREAD_SMS_DELAY_HOURS || '4', 10);

      // Find unread emails created at least delayHours ago (4 or 5+ hours) where sms_delayed_notified = 0
      let unreadEmails = [];
      try {
        unreadEmails = await dbOps.queryAll(`
          SELECT id, recipient_emails, subject, created_at 
          FROM emails 
          WHERE is_read = 0 
            AND (sms_delayed_notified = 0 OR sms_delayed_notified IS NULL)
            AND folder NOT IN ('TRASH', 'SPAM', 'DRAFTS')
            AND created_at <= (NOW() - INTERVAL ${delayHours} HOUR)
        `);
      } catch (mysqlErr) {
        // Fallback for SQLite
        try {
          unreadEmails = await dbOps.queryAll(`
            SELECT id, recipient_emails, subject, created_at 
            FROM emails 
            WHERE is_read = 0 
              AND (sms_delayed_notified = 0 OR sms_delayed_notified IS NULL)
              AND folder NOT IN ('TRASH', 'SPAM', 'DRAFTS')
              AND created_at <= datetime('now', '-${delayHours} hours')
          `);
        } catch (sqliteErr) {}
      }

      if (!unreadEmails || unreadEmails.length === 0) return;

      console.log(`⏱️ [DELAYED UNREAD CHECK] Found ${unreadEmails.length} unread email(s) >= ${delayHours} hours old. Dispatching SMS reminders...`);

      for (const email of unreadEmails) {
        // Mark notified first to prevent duplicate sends
        await dbOps.execute('UPDATE emails SET sms_delayed_notified = 1 WHERE id = ?', [email.id]);

        let recipients = [];
        try {
          recipients = typeof email.recipient_emails === 'string' ? JSON.parse(email.recipient_emails) : email.recipient_emails;
        } catch (e) {
          recipients = [email.recipient_emails];
        }

        if (!Array.isArray(recipients)) recipients = [recipients];

        for (const rec of recipients) {
          const digits = String(rec).replace(/\D/g, '').slice(-10);
          if (digits && digits.length === 10) {
            await this.dispatchSubjectOnlySms(digits, email.subject);
          }
        }
      }
    } catch (scanErr) {
      console.warn('Error in checkDelayedUnreadEmails scan:', scanErr.message);
    }
  },

  /**
   * Starts background worker to monitor 4-hour unviewed emails
   */
  startDelayedSmsWorker(intervalMs = 60000) {
    console.log(`⏱️ [4-Hour Unread SMS Worker] Started (scanning every ${intervalMs / 1000}s)`);
    // Run initial scan
    setTimeout(() => this.checkDelayedUnreadEmails(), 5000);
    // Recurring interval
    setInterval(() => this.checkDelayedUnreadEmails(), intervalMs);
  }
};
