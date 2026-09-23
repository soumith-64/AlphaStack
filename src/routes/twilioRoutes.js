import express from 'express';
import { telephonyService } from '../services/telephonyService.js';

const router = express.Router();

/**
 * Twilio Inbound Voice Webhook
 */
router.post('/voice', (req, res) => {
  const fromNumber = req.body.From || req.query.From;
  const twiml = telephonyService.handleIncomingCall(fromNumber);
  res.type('text/xml').send(twiml);
});

/**
 * Twilio Voice Gather (Keypad press) Webhook
 */
router.post('/voice-gather', (req, res) => {
  const digits = req.body.Digits || req.query.Digits;
  const fromNumber = req.body.From || req.query.From;
  const twiml = telephonyService.handleGather(digits, fromNumber);
  res.type('text/xml').send(twiml);
});

/**
 * Twilio Inbound SMS Webhook
 */
router.post('/sms', (req, res) => {
  const fromNumber = req.body.From || req.query.From;
  const body = req.body.Body || req.query.Body;
  const twiml = telephonyService.handleIncomingSMS(fromNumber, body);
  res.type('text/xml').send(twiml);
});

export default router;
