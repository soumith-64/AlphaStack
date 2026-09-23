import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  host: process.env.HOST || '0.0.0.0',
  smtpPort: parseInt(process.env.SMTP_PORT || '2525', 10),
  enableSmtp: process.env.ENABLE_SMTP === 'true',
  domainName: process.env.DOMAIN_NAME || 'phonemail.com',
  jwtSecret: process.env.JWT_SECRET || 'phonemail-secret-key-alpha-buildathon-2026',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+12055550199',
  },
  dbPath: process.env.DB_PATH || './data/phonemail.db',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
  },
  isProduction: process.env.NODE_ENV === 'production'
};
