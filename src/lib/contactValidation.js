const { z } = require('zod');

const emailSchema = z.string().trim().max(254).pipe(z.email());

function validateEmail(email) {
  return emailSchema.safeParse(email);
}

function normalizePhoneNumber(phone) {
  if (typeof phone !== 'string') return null;
  const trimmedPhone = phone.trim();
  if (!trimmedPhone) return null;

  const normalizedPhone = trimmedPhone.replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{6,14}$/.test(normalizedPhone)) return null;
  return normalizedPhone;
}

module.exports = { validateEmail, normalizePhoneNumber };
