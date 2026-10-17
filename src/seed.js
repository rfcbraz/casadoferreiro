// src/seed.js
// Popula a base de dados com dados iniciais
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

const prisma = require('./lib/prismaClient').createPrismaClient();

async function main() {
  console.log('🌱 A popular a base de dados...');

  // Admin
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 12 caracteres) antes de correr o seed.');
  }
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const admin = await prisma.admin.upsert({
    where: { email: process.env.ADMIN_EMAIL },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL,
      password: hashedPassword,
      name: process.env.ADMIN_NAME || 'Administrador',
    },
  });
  console.log(`✓ Admin criado: ${admin.email}`);

  // Unidades
  const rooms = [
    {
      name: 'T2 Serra',
      type: 'T2',
      description: 'Apartamento T2 com duas zonas de descanso, cozinha equipada, varanda e uma atmosfera acolhedora para escapadas e estadias familiares curtas.',
      pricePerNight: 160,
      capacity: 6,
      sizeSqm: 90,
      bedrooms: 2,
      beds: 3,
      amenities: ['Quartos para não fumadores', 'Quartos familiares', 'Frente à praia', 'Estacionamento gratuito', 'Acesso Wi-Fi gratuito'],
      images: [],
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
    },
    {
      name: 'T3 Bosque',
      type: 'T3',
      description: 'Unidade T3 ampla e funcional, perfeita para famílias ou grupos, com área de praia privada, estacionamento gratuito e várias comodidades para uma estadia confortável.',
      pricePerNight: 220,
      capacity: 8,
      sizeSqm: 120,
      bedrooms: 3,
      beds: 4,
      amenities: ['Quartos para não fumadores', 'Quartos familiares', 'Frente à praia', 'Estacionamento gratuito', 'Acesso Wi-Fi gratuito', 'Área de praia privada'],
      images: [],
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
    },
  ];

  for (const room of rooms) {
    const created = await prisma.room.upsert({
      where: { name: room.name },
      update: { capacity: room.capacity },
      create: room,
    });
    console.log(`✓ Unidade criada: ${created.name} (€${created.pricePerNight}/noite)`);
  }

  console.log('\n✅ Base de dados populada com sucesso!');
  console.log(`\n🔑 Login admin:`);
  console.log(`   Email: ${process.env.ADMIN_EMAIL}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
