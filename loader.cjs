// loader.cjs - Universal CommonJS & ES Module bootstrap for Hostinger
(async () => {
  try {
    console.log('🚀 [Hostinger Bootstrap] Initializing PhoneMail...');
    await import('./src/server.js');
  } catch (err) {
    console.error('❌ [Hostinger Bootstrap Error]:', err);
    process.exit(1);
  }
})();
