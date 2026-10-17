const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// Sessão do painel: token válido, administrador existente e emitido depois da última mudança de password
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'JWT_SECRET não está configurado no servidor.' });
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Sessão expirada. Inicie sessão novamente.' });
  }
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: payload.id },
      select: { id: true, passwordChangedAt: true },
    });
    const changedAt = admin?.passwordChangedAt ? Math.floor(admin.passwordChangedAt.getTime() / 1000) : 0;
    if (!admin || payload.iat < changedAt) {
      return res.status(401).json({ error: 'Sessão expirada. Inicie sessão novamente.' });
    }
    req.admin = payload;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
