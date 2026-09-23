import express from 'express';
import { telephonyService } from '../services/telephonyService.js';

const router = express.Router();

/**
 * Twilio Inbound Voice Webhook
 */
router.post('/voice', async (req, res) => {
  try {
    const fromNumber = req.body.From || req.query.From;
    const twiml = await telephonyService.handleIncomingCall(fromNumber);
    res.type('text/xml').send(twiml);
  } catch (err) {
    res.status(500).send(`<Response><Say>An error occurred.</Say></Response>`);
  }
});

/**
 * Twilio Voice Gather (Keypad press) Webhook
 */
router.post('/voice-gather', async (req, res) => {
  try {
    const digits = req.body.Digits || req.query.Digits;
    const fromNumber = req.body.From || req.query.From;
    const twiml = await telephonyService.handleGather(digits, fromNumber);
    res.type('text/xml').send(twiml);
  } catch (err) {
    res.status(500).send(`<Response><Say>An error occurred.</Say></Response>`);
  }
});

/**
 * Twilio Inbound SMS Webhook
 */
router.post('/sms', async (req, res) => {
  try {
    const fromNumber = req.body.From || req.query.From;
    const body = req.body.Body || req.query.Body;
    const twiml = await telephonyService.handleIncomingSMS(fromNumber, body);
    res.type('text/xml').send(twiml);
  } catch (err) {
    res.status(500).send(`<Response><Message>An error occurred.</Message></Response>`);
  }
});

export default router;
