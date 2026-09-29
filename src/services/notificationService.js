import { dbOps } from '../database/db.js';
import { config } from '../config.js';
import { textbeeService } from './textbeeService.js';

let ioInstance = null;

export const notificationService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  /**
   * Evaluates recipient and sends real-time SMS notification via TextBee
   * Triggered whenever any user receives a new incoming internal or external email
   */
  async checkAndNotify(email, recipientUser) {
    if (!recipientUser) return;

    const rawPhone = String(recipientUser.phone_number || '').trim();
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length !== 10) return;

    const senderDisplay = email.sender_name && !/^User\s*\d+/i.test(email.sender_name)
      ? email.sender_name
      : (email.sender_email || 'INAI Contact');
    const subjectDisplay = email.subject ? email.subject.trim() : '(No Subject)';
    const domain = config.domainName || 'alphastack.wwisvnr.com';
    const smsBody = `INAI: New email received from ${senderDisplay}. Subject: ${subjectDisplay.slice(0, 50)}. View: https://${domain}`;

    console.log(`📱 [NEW MAIL SMS DISPATCH] To: ${cleanPhone} | Body: "${smsBody}"`);

    // 1. Primary Dispatch via TextBee Indian SMS Gateway
    let textbeeResult = null;
    try {
      textbeeResult = await textbeeService.sendSms(cleanPhone, smsBody);
    } catch (tbErr) {
      console.warn('TextBee notification SMS error:', tbErr.message);
    }

    // 2. Secondary dispatch via Twilio if configured
    if (config.twilio.accountSid && config.twilio.authToken) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
        const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');
        const formattedTo = rawPhone.startsWith('+') 
          ? rawPhone 
          : `+91${cleanPhone}`;

        const params = new URLSearchParams({
          To: formattedTo,
          From: config.twilio.phoneNumber,
          Body: smsBody
        });

        const twilioRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        const twilioResult = await twilioRes.json();
        console.log(`📱 [TWILIO LIVE SMS STATUS] Sent to ${formattedTo}:`, twilioResult.sid || twilioResult.message || twilioResult);
      } catch (err) {
        console.warn('Twilio live SMS dispatch notice:', err.message);
      }
    }

    return textbeeResult;
  }
};
