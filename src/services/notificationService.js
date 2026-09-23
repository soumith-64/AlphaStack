import { dbOps } from '../database/db.js';
import { config } from '../config.js';

let ioInstance = null;

export const notificationService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  /**
   * Evaluates recipient and sends SMS notification if eligible
   * Spec: Only for users who do NOT have the mobile app (registered via phone call, web portal, or web client)
   */
  async checkAndNotify(email, recipientUser) {
    if (!recipientUser) return;

    // Check if user has mobile app
    if (recipientUser.has_mobile_app === 1) {
      console.log(`ℹ️ User ${recipientUser.phone_number} has mobile app. Skipping SMS notification.`);
      return;
    }

    const senderDisplay = email.sender_email;
    const subjectDisplay = email.subject || '(No Subject)';
    const smsBody = `You have received an email from ${senderDisplay}. Subject: ${subjectDisplay}.`;

    console.log(`📱 [TARGETED SMS DISPATCH] To: ${recipientUser.phone_number} | Body: "${smsBody}"`);

    // Log to audit table
    const logId = await dbOps.logTelephony(
      recipientUser.phone_number,
      'OUTGOING_NOTIFICATION_SMS',
      smsBody,
      config.twilio.accountSid ? 'TWILIO' : 'VIRTUAL_SIMULATOR',
      'DELIVERED'
    );

    const logEntry = {
      id: logId,
      phone_number: recipientUser.phone_number,
      type: 'OUTGOING_NOTIFICATION_SMS',
      content: smsBody,
      provider: config.twilio.accountSid ? 'TWILIO' : 'VIRTUAL_SIMULATOR',
      status: 'DELIVERED',
      created_at: new Date().toISOString()
    };

    // Broadcast in real-time to the Judge Simulator & active clients
    if (ioInstance) {
      ioInstance.emit('telephony:log', logEntry);
    }

    // If real Twilio credentials are provided, dispatch via Twilio API
    if (config.twilio.accountSid && config.twilio.authToken) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
        const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
        const params = new URLSearchParams({
          To: recipientUser.phone_number.startsWith('+') ? recipientUser.phone_number : `+${recipientUser.phone_number}`,
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
        console.warn('Twilio live SMS dispatch notice:', err.message);
      }
    }

    return logEntry;
  }
};
