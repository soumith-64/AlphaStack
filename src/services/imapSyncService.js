import tls from 'tls';
import { simpleParser } from 'mailparser';
import { emailService } from './emailService.js';
import { dbOps } from '../database/db.js';

let isSyncing = false;
const processedMessageIds = new Set();

/**
 * Service to sync incoming emails directly from Hostinger IMAP server
 */
export const imapSyncService = {
  host: process.env.HOSTINGER_IMAP_HOST || 'imap.hostinger.com',
  port: parseInt(process.env.HOSTINGER_IMAP_PORT || '993', 10),
  user: process.env.HOSTINGER_IMAP_USER || 'admin@alphastack.wwisvnr.com',
  pass: process.env.HOSTINGER_IMAP_PASS || 'Alphastack@2026',

  async syncHostingerMailbox() {
    if (isSyncing) return { status: 'already_syncing' };
    isSyncing = true;

    return new Promise((resolve) => {
      let socket = null;
      let buffer = '';
      let tagCount = 0;
      let currentCommand = '';
      let messagesToFetch = [];
      let currentFetchIndex = 0;
      let rawEmailBuffer = '';
      let isCapturingEmail = false;

      const getNextTag = () => `a${++tagCount}`;

      const finish = (result) => {
        isSyncing = false;
        try {
          if (socket) {
            socket.write(`${getNextTag()} LOGOUT\r\n`);
            setTimeout(() => socket.destroy(), 500);
          }
        } catch (e) {}
        resolve(result);
      };

      try {
        socket = tls.connect(this.port, this.host, { rejectUnauthorized: false }, () => {
          // Connected, wait for server greeting
        });

        socket.on('data', async (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\r\n');
          buffer = lines.pop(); // keep last incomplete line

          for (const line of lines) {
            // Check greeting
            if (line.startsWith('* OK') && tagCount === 0) {
              const tag = getNextTag();
              currentCommand = tag;
              socket.write(`${tag} LOGIN ${this.user} ${this.pass}\r\n`);
              continue;
            }

            // Check login response
            if (line.startsWith(currentCommand) && line.includes('OK') && line.includes('Logged in')) {
              const tag = getNextTag();
              currentCommand = tag;
              socket.write(`${tag} SELECT INBOX\r\n`);
              continue;
            }

            // Check select inbox response
            if (line.startsWith(currentCommand) && line.includes('OK') && line.includes('Select completed')) {
              const tag = getNextTag();
              currentCommand = tag;
              // Fetch search of all messages
              socket.write(`${tag} SEARCH ALL\r\n`);
              continue;
            }

            // Parse search all IDs - only inspect the 15 most recent messages
            if (line.startsWith('* SEARCH')) {
              const parts = line.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean);
              messagesToFetch = parts.slice(-15);
              continue;
            }

            // Check search completed
            if (line.startsWith(currentCommand) && line.includes('OK') && line.includes('Search completed')) {
              if (messagesToFetch.length === 0) {
                return finish({ success: true, count: 0 });
              }
              // Fetch each message full body
              currentFetchIndex = 0;
              fetchNextMessage();
              continue;
            }

            // Handle FETCH body streaming
            if (line.includes('FETCH (BODY[]') || line.includes('FETCH (RFC822')) {
              isCapturingEmail = true;
              rawEmailBuffer = '';
              continue;
            }

            if (isCapturingEmail) {
              if (line === ')' || (line.startsWith(currentCommand) && line.includes('OK Fetch completed'))) {
                isCapturingEmail = false;
                // Parse email with mailparser
                await processRawEmail(rawEmailBuffer);
                rawEmailBuffer = '';
                currentFetchIndex++;
                if (currentFetchIndex < messagesToFetch.length) {
                  fetchNextMessage();
                } else {
                  return finish({ success: true, count: messagesToFetch.length });
                }
              } else {
                rawEmailBuffer += line + '\r\n';
              }
            }
          }
        });

        const fetchNextMessage = () => {
          const msgNum = messagesToFetch[currentFetchIndex];
          if (!msgNum) return finish({ success: true, count: currentFetchIndex });
          const tag = getNextTag();
          currentCommand = tag;
          socket.write(`${tag} FETCH ${msgNum} (BODY.PEEK[])\r\n`);
        };

        const processRawEmail = async (raw) => {
          if (!raw || raw.length < 10) return;
          try {
            const parsed = await simpleParser(raw);
            const msgId = parsed.messageId || `${parsed.date?.getTime()}_${parsed.subject}`;
            if (processedMessageIds.has(msgId)) return;
            processedMessageIds.add(msgId);

            const toAddress = (parsed.to && (parsed.to.text || (parsed.to.value && parsed.to.value[0]?.address))) || '';
            const fromAddress = (parsed.from && (parsed.from.text || (parsed.from.value && parsed.from.value[0]?.address))) || '';
            
            const fromMatch = String(fromAddress || '').match(/<([^>]+)>/);
            const cleanFrom = (fromMatch ? fromMatch[1] : String(fromAddress || '')).toLowerCase().trim();
            const cleanSub = (parsed.subject || '(No Subject)').trim();
            const cleanText = (parsed.text || '').trim();
            const textSnippet = cleanText.substring(0, 50);

            // Check persistent deleted list (never re-download emails deleted by user)
            const wasDeleted = await dbOps.isEmailDeleted(cleanFrom, cleanSub);
            if (wasDeleted) {
              // Delete permanently from remote Hostinger mailbox to prevent wasted bandwidth
              try {
                if (socket) socket.write(`${getNextTag()} STORE ${messagesToFetch[currentFetchIndex]} +FLAGS (\\Deleted)\r\n`);
              } catch(e) {}
              return;
            }

            // Also check if this email already exists anywhere (INBOX, TRASH, ARCHIVE, etc.)
            const existing = await dbOps.queryOne(`
              SELECT id, folder FROM emails 
              WHERE (sender_email = ? OR sender_email LIKE ?) 
                AND subject = ? 
                AND (body_text = ? OR (LENGTH(?) > 0 AND body_text LIKE ?))
              LIMIT 1
            `, [cleanFrom, `%${cleanFrom}%`, cleanSub, cleanText, textSnippet, `${textSnippet}%`]);

            if (existing) {
              return;
            }

            // Suppress recurring Hostinger automated onboarding/forwarder verification if not wanted
            const isHostingerAutomated = cleanFrom.includes('hostinger.com') && 
              (cleanSub.toLowerCase().includes('business email') || cleanSub.toLowerCase().includes('forwarder request') || cleanSub.toLowerCase().includes('welcome'));
            if (isHostingerAutomated) {
              const alreadySeenHostinger = await dbOps.queryOne(`
                SELECT id FROM emails WHERE sender_email LIKE '%hostinger.com%' AND subject = ? LIMIT 1
              `, [cleanSub]);
              if (alreadySeenHostinger) return;
            }

            console.log(`📥 [IMAP SYNC] Processing message: "${parsed.subject}" to "${toAddress}" from "${fromAddress}"`);

            await emailService.processInboundEmail({
              from: fromAddress || 'unknown@external.com',
              to: toAddress || 'admin@alphastack.wwisvnr.com',
              subject: parsed.subject || '(No Subject)',
              text: parsed.text || '',
              html: parsed.html || parsed.textAsHtml || parsed.text || '',
              attachments: (parsed.attachments || []).map(a => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size
              }))
            });
          } catch (e) {
            console.error('Failed to parse IMAP email raw:', e.message);
          }
        };

        socket.on('error', (err) => {
          console.error('Hostinger IMAP sync error:', err.message);
          finish({ success: false, error: err.message });
        });

        setTimeout(() => {
          finish({ success: false, timeout: true });
        }, 15000);

      } catch (err) {
        finish({ success: false, error: err.message });
      }
    });
  },

  startAutoSync(intervalSeconds = 20) {
    console.log(`🔄 Hostinger IMAP Auto-Sync Worker started (every ${intervalSeconds}s)...`);
    // Run initial sync after 3 seconds
    setTimeout(() => {
      this.syncHostingerMailbox().catch(e => console.warn('Initial IMAP sync note:', e.message));
    }, 3000);

    setInterval(() => {
      this.syncHostingerMailbox().catch(e => console.warn('Interval IMAP sync note:', e.message));
    }, intervalSeconds * 1000);
  }
};
