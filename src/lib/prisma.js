// Ligação partilhada por todo o servidor
const { createPrismaClient } = require('./prismaClient');
module.exports = createPrismaClient();
