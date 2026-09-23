import { dbOps } from '../database/db.js';
import { config } from '../config.js';

let ioInstance = null;

export const telephonyService = {
  setSocketIO(io) {
    ioInstance = io;
  },

  /**
   * Generates initial TwiML for incoming toll-free calls
   */
  handleIncomingCall(fromNumber) {
    const cleanNumber = (fromNumber || 'Unknown').replace(/\D/g, '');
    console.log(`📞 [INCOMING CALL] From: ${cleanNumber}`);

    const logId = dbOps.logTelephony(
      cleanNumber,
      'INCOMING_CALL_IVR',
      `Inbound phone call connected. Playing PhoneMail IVR menu.`
    );

    if (ioInstance) {
      ioInstance.emit('telephony:log', {
        id: logId,
        phone_number: cleanNumber,
        type: 'INCOMING_CALL_IVR',
        content: `Inbound call connected. Playing PhoneMail IVR menu.`,
        provider: 'VIRTUAL_SIMULATOR',
        status: 'CONNECTED',
        created_at: new Date().toISOString()
      });
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="/api/twilio/voice-gather" method="POST" timeout="10">
    <Say voice="Polly.Joanna">Welcome to PhoneMail. Press 1 to create an email account with this phone number. Press 2 to listen to your unread emails.</Say>
  </Gather>
  <Say voice="Polly.Joanna">We did not receive any input. Goodbye.</Say>
  <Hangup/>
</Response>`;
  },

  /**
   * Processes DTMF digit pressed by caller
   */
  handleGather(digits, fromNumber) {
    const cleanNumber = (fromNumber || '9876543210').replace(/\D/g, '').slice(-10);
    console.log(`📞 [IVR GATHER] Digits: ${digits} | From: ${cleanNumber}`);

    if (digits === '1') {
      // Create user if not exists
      let user = dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
      if (!user) {
        const userId = 'user_' + Date.now();
        const email = `${cleanNumber}@${config.domainName}`;
        dbOps.execute(`
          INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
          VALUES (?, ?, ?, ?, 'IVR', 0)
        `, [userId, cleanNumber, email, `User ${cleanNumber}`]);
        user = { id: userId, phone_number: cleanNumber, email_address: email };
      }

      const welcomeMsg = `Welcome to PhoneMail! Your email address is ${cleanNumber}@${config.domainName}. You will receive SMS alerts for new emails.`;
      const logId = dbOps.logTelephony(cleanNumber, 'OUTGOING_NOTIFICATION_SMS', welcomeMsg);

      if (ioInstance) {
        ioInstance.emit('telephony:log', {
          id: logId,
          phone_number: cleanNumber,
          type: 'OUTGOING_NOTIFICATION_SMS',
          content: welcomeMsg,
          provider: 'VIRTUAL_SIMULATOR',
          status: 'DELIVERED',
          created_at: new Date().toISOString()
        });
      }

      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Success! Your PhoneMail email address is ${cleanNumber.split('').join(' ')} at ${config.domainName}. We have sent you a confirmation text. Thank you for using PhoneMail.</Say>
  <Hangup/>
</Response>`;
    } else if (digits === '2') {
      // Audio mailbox readout
      const user = dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
      if (!user) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">No account found for this number. Press 1 to create an account.</Say>
  <Hangup/>
</Response>`;
      }

      const unreadEmails = dbOps.queryAll(`
        SELECT * FROM emails 
        WHERE recipient_emails LIKE ? AND is_read = 0 
        ORDER BY created_at DESC LIMIT 3
      `, [`%${cleanNumber}%`]);

      if (unreadEmails.length === 0) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hello! You have no unread emails at this time. Goodbye.</Say>
  <Hangup/>
</Response>`;
      }

      const latest = unreadEmails[0];
      const speech = `You have ${unreadEmails.length} unread email. Latest message from ${latest.sender_email}. Subject: ${latest.subject || 'No Subject'}. Message body: ${latest.body_text || 'No content'}.`;

      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${speech}</Say>
  <Hangup/>
</Response>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Invalid option selected. Goodbye.</Say>
  <Hangup/>
</Response>`;
  },

  /**
   * Handles incoming SMS registration
   */
  handleIncomingSMS(fromNumber, body) {
    const cleanNumber = (fromNumber || '').replace(/\D/g, '').slice(-10);
    console.log(`💬 [INCOMING SMS] From: ${cleanNumber} | Body: ${body}`);

    let user = dbOps.queryOne('SELECT * FROM users WHERE phone_number = ?', [cleanNumber]);
    if (!user) {
      const userId = 'user_' + Date.now();
      const email = `${cleanNumber}@${config.domainName}`;
      dbOps.execute(`
        INSERT INTO users (id, phone_number, email_address, display_name, registration_channel, has_mobile_app)
        VALUES (?, ?, ?, ?, 'SMS', 0)
      `, [userId, cleanNumber, email, `User ${cleanNumber}`]);
    }

    const replyMsg = `Welcome to PhoneMail! Your email address is ${cleanNumber}@${config.domainName}. Send and receive emails easily.`;
    const logId = dbOps.logTelephony(cleanNumber, 'OUTGOING_NOTIFICATION_SMS', replyMsg);

    if (ioInstance) {
      ioInstance.emit('telephony:log', {
        id: logId,
        phone_number: cleanNumber,
        type: 'OUTGOING_NOTIFICATION_SMS',
        content: replyMsg,
        provider: 'VIRTUAL_SIMULATOR',
        status: 'DELIVERED',
        created_at: new Date().toISOString()
      });
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyMsg}</Message>
</Response>`;
  }
};
