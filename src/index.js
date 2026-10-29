// src/index.js
require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const reservationRoutes = require('./routes/reservations');
const roomRoutes = require('./routes/rooms');
const adminRoutes = require('./routes/admin');
const availabilityRoutes = require('./routes/availability');
const icalRoutes = require('./routes/ical');
const webhookRoutes = require('./routes/webhooks');
const contactRoutes = require('./routes/contact');
const reviewRoutes = require('./routes/reviews');
const { sendDueReviewRequests } = require('./services/reviewRequests');
const { syncExternalCalendars } = require('./services/ical');

const app = express();
const PORT = process.env.PORT || 3001;

// O Railway está atrás de um proxy: sem isto, os limites de pedidos contavam o IP do proxy
// (todos os visitantes partilhavam o mesmo limite) em vez do IP de cada visitante
app.set('trust proxy', 1);

// ── Segurança ──────────────────────────────────────────────
app.use(helmet());
// Domínios que podem usar a API a partir do browser (ALLOWED_ORIGINS separa por vírgulas)
const allowedOrigins = (process.env.ALLOWED_ORIGINS
  || 'https://rfcbraz.github.io,https://casadoferreirovn.pt,https://www.casadoferreirovn.pt,http://localhost:5500,http://127.0.0.1:5500')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({
  // Pedidos sem Origin (Stripe, Booking/Airbnb, servidores) não passam pelo browser e não são afetados
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Webhook do Stripe precisa do body em raw antes do JSON parser
app.use('/webhooks', webhookRoutes);

app.use(express.json());

// Pedidos do painel com sessão de administrador válida não contam para o limite geral
// (o painel atualiza as reservas a cada 30 segundos)
function hasValidAdminToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || !process.env.JWT_SECRET) return false;
  try {
    jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

// Rate limiting geral
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  skip: hasValidAdminToken,
  message: { error: 'Demasiados pedidos. Tente novamente mais tarde.' }
}));

// Login do painel: 10 tentativas falhadas por 15 minutos e por IP
app.use('/api/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiadas tentativas de login. Tente novamente dentro de 15 minutos.' }
}));

// Rate limiting mais apertado para criar pedidos de reserva (só POST; o painel lê e altera reservas)
app.use('/api/reservations', rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  skip: req => req.method !== 'POST' || hasValidAdminToken(req),
  message: { error: 'Limite de reservas atingido. Tente novamente em 1 hora.' }
}));

// Avaliações: 10 envios por hora e por IP
app.use('/api/reviews', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skip: req => req.method !== 'POST',
  message: { error: 'Demasiados envios. Tente novamente mais tarde.' }
}));

// Rate limiting para o formulário de contacto
app.use('/api/contact', rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Limite de mensagens atingido. Tente novamente em 1 hora.' }
}));

// ── Rotas ──────────────────────────────────────────────────
app.use('/api/contact', contactRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/ical', icalRoutes);

// Sincronização iCal de unidades importadas
(async () => {
  try {
    await syncExternalCalendars();
  } catch (err) {
    console.error('Erro na sincronização inicial iCal:', err);
  }
  let syncing = false;
  setInterval(async () => {
    if (syncing) return; // a anterior ainda não terminou
    syncing = true;
    try {
      await syncExternalCalendars();
    } catch (err) {
      console.error('Erro na sincronização periódica iCal:', err);
    } finally {
      syncing = false;
    }
  }, 15 * 60 * 1000); // de 15 em 15 minutos
})();

// Email de agradecimento e pedido de avaliação: verificar de hora a hora (e logo ao arrancar)
const runReviewRequests = () => sendDueReviewRequests()
  .catch(err => console.error('Erro nos pedidos de avaliação:', err));
setTimeout(runReviewRequests, 30 * 1000);
setInterval(runReviewRequests, 60 * 60 * 1000);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Error handler global
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  // Só os erros do servidor ficam nos registos com detalhe; respostas previstas (4xx) não são falhas
  if (status >= 500) console.error(err.stack);
  // Erros previstos (4xx) mostram a mensagem; erros internos não revelam detalhes técnicos
  res.status(status).json({
    error: status < 500 ? err.message : 'Ocorreu um erro inesperado. Tente novamente dentro de momentos.'
  });
});

app.listen(PORT, () => {
  console.log(`\n🏡 Casa do Ferreiro API a correr em http://localhost:${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});
