// src/routes/contact.js
const express = require('express');
const router = express.Router();
const { validateEmail, normalizePhoneNumber } = require('../lib/contactValidation');
const { sendContactMessage } = require('../services/email');
const { verifyTurnstile, TURNSTILE_ERROR } = require('../lib/turnstile');

// POST /api/contact — formulário de contacto do site
router.post('/', async (req, res) => {
  const { name, email, phone, message, website, turnstileToken } = req.body || {};

  // Campo escondido anti-spam: pessoas não o preenchem, bots sim
  if (website) return res.json({ message: 'Mensagem enviada.' });

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  if (!trimmedName || trimmedName.length > 100) {
    return res.status(400).json({ error: 'Indique o seu nome.' });
  }
  const emailResult = validateEmail(email);
  if (!emailResult.success) {
    return res.status(400).json({ error: 'Introduza um endereço de email válido.' });
  }
  if (trimmedMessage.length < 10 || trimmedMessage.length > 5000) {
    return res.status(400).json({ error: 'A mensagem deve ter entre 10 e 5000 caracteres.' });
  }
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;
  if (phone && !normalizedPhone) {
    return res.status(400).json({ error: 'Número de telefone inválido.' });
  }

  const turnstile = await verifyTurnstile(turnstileToken, req.ip);
  if (!turnstile.success) return res.status(403).json({ error: TURNSTILE_ERROR });

  try {
    await sendContactMessage({
      name: trimmedName,
      email: emailResult.data,
      phone: normalizedPhone,
      message: trimmedMessage,
    });
    res.json({ message: 'Mensagem enviada. Responderemos com a maior brevidade possível.' });
  } catch (err) {
    console.error('Erro ao enviar mensagem de contacto:', err);
    res.status(500).json({ error: 'Não foi possível enviar a mensagem. Tente novamente mais tarde.' });
  }
});

module.exports = router;
