import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  smtpPort: parseInt(process.env.SMTP_PORT || '2525', 10),
  domainName: process.env.DOMAIN_NAME || 'phonemail.com',
  jwtSecret: process.env.JWT_SECRET || 'phonemail-secret-key-alpha-buildathon-2026',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+12055550199',
  },
  dbPath: process.env.DB_PATH || './data/phonemail.db',
  isProduction: process.env.NODE_ENV === 'production'
};
