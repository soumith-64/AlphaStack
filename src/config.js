import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  smtpPort: parseInt(process.env.SMTP_PORT || '2525', 10),
  enableSmtp: process.env.ENABLE_SMTP === 'true',
  domainName: process.env.DOMAIN_NAME || 'phonemail.com',
  jwtSecret: process.env.JWT_SECRET || 'phonemail-secret-key-alpha-buildathon-2026',
  textbee: {
    apiKey: process.env.TEXTBEE_API_KEY || '',
    deviceId: process.env.TEXTBEE_DEVICE_ID || '',
  },
  phoneEmailClientId: process.env.PHONE_EMAIL_CLIENT_ID || '13185767641328082743',
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
