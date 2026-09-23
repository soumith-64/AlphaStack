// app.js - Root entry point for Hostinger Node.js
(async () => {
  try {
    console.log('🚀 [Hostinger Entry] Starting PhoneMail application...');
    await import('./src/server.js');
  } catch (err) {
    console.error('❌ [Hostinger Startup Error]:', err);
    process.exit(1);
  }
})();
