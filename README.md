# Casa do Ferreiro

Site e sistema de reservas da Casa do Ferreiro: duas casas de férias (T2 e T3) em Venda Nova, Montalegre.

| Parte | Onde está | Publicação |
|---|---|---|
| Site público | [`index.html`](index.html) + [`assets/`](assets/) | GitHub Pages, automático em cada push para `main` |
| Painel de gestão | [`admin.html`](admin.html) | GitHub Pages (mesmo workflow) |
| API e base de dados | [`src/`](src/), Prisma + PostgreSQL | Railway, automático em cada push para `main` |

- Site: <https://casadoferreirovn.pt> (o endereço antigo `rfcbraz.github.io/casadoferreiro` redireciona para aqui)
- Painel: <https://casadoferreirovn.pt/admin.html> (também pelo ⚙ no rodapé do site)
- API: <https://casadaserra-production.up.railway.app/api>

---

## Como funciona uma reserva

1. O hóspede escolhe as datas no calendário (só aparecem como livres as datas reserváveis) e envia o pedido com as idades das pessoas.
2. O pedido fica **pendente** e o proprietário recebe um email.
3. No painel, o proprietário **aceita** ou **recusa**. Ao aceitar, o hóspede recebe um link de pagamento Stripe, válido 24 horas. Durante esse tempo as datas ficam reservadas para ele.
4. Quando o Stripe confirma o pagamento, a reserva passa a **paga** e ambos recebem confirmação.

Regras principais:
- Estadia mínima de 2 noites; check-in a partir das 16:00, check-out até às 11:00.
- Reservas para o próprio dia até às 22:00 (hora de Portugal).
- O mesmo dia pode ter a saída de uma reserva e a entrada de outra. Um dia **bloqueado no painel** fica fechado o dia inteiro (sem entradas nem saídas).
- Datas ocupadas no Booking.com/Airbnb são importadas por iCal (de 15 em 15 minutos) e bloqueiam as noites correspondentes. Os calendários são lidos de novo no momento de aprovar (a aprovação é recusada se as datas já estiverem ocupadas lá) e depois de cada pagamento (se houver conflito, o proprietário recebe o aviso "Possível reserva duplicada"). O email "Reserva paga" lembra o proprietário de fechar as datas no Booking/Airbnb, que só leem o calendário do site de poucas em poucas horas.

## Preços

Calculados no servidor ([`src/lib/pricing.js`](src/lib/pricing.js)) e configurados no separador **Preços** do painel:

- Preço de cada noite: **feriado** → **época** (com preço de fim de semana às sextas e sábados) → **preço base** da unidade.
- Pessoas incluídas no preço (T2: 4, T3: 6). Por pessoa a menos aplica-se um desconto em %; por pessoa a mais um valor por noite.
- Crianças dos 3 aos 6 anos contam como meia pessoa; bebés (0–2) pagam só o berço por noite.
- **Promoções**: desconto em % nas noites abrangidas, com mínimo de noites; vale a de maior desconto. Quando há promoções ativas, o site mostra um aviso ao abrir.

## Painel de gestão

Entrar em `admin.html` com o email e a password do administrador (`ADMIN_EMAIL` / `ADMIN_PASSWORD` no Railway). A página não aparece nos motores de busca e a sessão dura no máximo 12 horas; mudar a password termina todas as sessões abertas.

| Separador | Para quê |
|---|---|
| Reservas | Aceitar, recusar, cancelar e apagar pedidos; resumo do mês |
| Quartos | Dados de cada unidade e links iCal do Booking.com/Airbnb |
| Disponibilidade | Bloquear ou desbloquear dias (um ou vários intervalos, de hoje em diante) |
| Preços | Preço base, pessoas, épocas, feriados, promoções e simulador |
| Estatísticas | Receita e ocupação do mês, próximas chegadas |

Ocupação do mês = noites ocupadas (reservas + Booking.com/Airbnb) ÷ noites disponíveis das unidades ativas. Receita do mês = valor das noites de estadia que caem nesse mês (não a data do pedido).

---

## Variáveis de ambiente (Railway → Variables)

Nunca colocar valores reais neste repositório: é público. O modelo está em [`.env.example`](.env.example).

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | Gerada pelo Railway (PostgreSQL) |
| `JWT_SECRET` | sim | Assina as sessões do painel e os links de cancelamento de pagamento. Texto longo e aleatório |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | sim | Conta do painel (password com 12+ caracteres). Criada no arranque se não existir |
| `RESEND_API_KEY` | sim | Envio de emails pela API do Resend (o Railway bloqueia SMTP) |
| `EMAIL_FROM` | sim | Remetente, com o domínio verificado no Resend (ex.: `Casa do Ferreiro <reservas@casadoferreirovn.pt>`) |
| `NOTIFICATION_EMAIL` | não | Quem recebe pedidos e mensagens de contacto (por omissão `reservas@casadoferreirovn.pt`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | sim | Pagamentos. Webhook em `/webhooks/stripe` com `payment_intent.succeeded` e `checkout.session.expired` |
| `TURNSTILE_SECRET_KEY` | sim | Verificação anti-robô (Cloudflare Turnstile) nos formulários |
| `FRONTEND_URL` | sim | Endereço do site, usado nos links de pagamento e nos emails |
| `ALLOWED_ORIGINS` | não | Sites autorizados a usar a API (por omissão: GitHub Pages, `casadoferreirovn.pt` e `localhost:5500`) |
| `CHECKOUT_LINK_SECRET` | não | Chave própria para os links de cancelamento (por omissão usa `JWT_SECRET`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | não | Alternativa ao Resend, só fora do Railway |
| `NODE_ENV` | sim | `production` |

---

## Publicação

**Site e painel (GitHub Pages)** — o workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) copia `index.html`, `admin.html` e `assets/` em cada push para `main`.

**API (Railway)** — deploy automático em cada push para `main`. Requer Node 22.12 ou mais recente (Prisma 7). O endereço da base de dados é lido de `DATABASE_URL` em [`prisma.config.mjs`](prisma.config.mjs) e a ligação usa o driver `pg` ([`src/lib/prismaClient.js`](src/lib/prismaClient.js)). O arranque ([`start.js`](start.js)) corre [`setup-db.js`](setup-db.js), que cria ou atualiza as tabelas e colunas necessárias; não é preciso correr migrações à mão.

### Domínio `casadoferreirovn.pt`

O site é servido pelo GitHub Pages com domínio próprio (Settings → Pages → Custom domain, HTTPS obrigatório; certificado renovado automaticamente pelo GitHub). Zona DNS na Amen:

| Nome | Tipo | Valor |
|---|---|---|
| `casadoferreirovn.pt` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `www.casadoferreirovn.pt` | CNAME | `rfcbraz.github.io.` |

Os registos de email (MX, SPF, DKIM da securemail e do Resend, `send`) são independentes e não devem ser alterados. No Railway, `FRONTEND_URL` deve ser `https://casadoferreirovn.pt`.

---

## Avaliações

- No dia seguinte à saída (a partir das 10:00), cada reserva paga recebe um email de agradecimento no idioma do hóspede, com um link pessoal e assinado para avaliar a estadia (`avaliacao.html`). Só é enviado uma vez e só para estadias terminadas há menos de 14 dias.
- O hóspede dá 1–5 estrelas (e, opcionalmente, limpeza, conforto e localização), escreve um comentário e escolhe se autoriza a publicação com o nome abreviado ("Maria S."). Uma avaliação por reserva.
- O proprietário recebe um email a cada avaliação nova e decide no painel (**Avaliações**): publicar, ocultar, responder ou apagar. Só as autorizadas podem ser publicadas.
- O site mostra a secção "A opinião dos nossos hóspedes" (média, número e comentários) apenas quando há avaliações publicadas.

## Cópias da base de dados

O workflow [`.github/workflows/db-backup.yml`](.github/workflows/db-backup.yml) faz **todos os dias às 03:30 UTC** uma cópia completa da base de dados (`pg_dump`), **encriptada com password** (AES-256, GnuPG), e guarda-a 90 dias como *artifact* do GitHub Actions. O repositório é público: sem a password as cópias não se abrem.

Configuração (uma vez), em GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Segredo | Valor |
|---|---|
| `BACKUP_DATABASE_URL` | `DATABASE_PUBLIC_URL` do serviço Postgres no Railway (separador Variables) |
| `BACKUP_PASSWORD` | Password longa para encriptar as cópias. **Guardar num local seguro: sem ela nenhuma cópia pode ser aberta.** |

- Fazer uma cópia já: separador **Actions → Cópia da base de dados → Run workflow**.
- Descarregar uma cópia: abrir uma execução concluída e descarregar o *artifact* (`casa-ferreiro-AAAA-MM-DD_HHMM`), que contém o ficheiro `.dump.gpg`.
- Sempre que a cópia ou a reposição mudam, um autoteste cria uma base temporária, copia, encripta, repõe e compara.
- O GitHub suspende tarefas agendadas em repositórios sem atividade durante 60 dias; se isso acontecer, reativar em **Actions**.

**Repor uma cópia** (substitui os dados da base de destino; precisa de Docker e gpg, por exemplo no Git Bash):

```bash
DATABASE_URL="postgresql://…" BACKUP_PASSWORD="…" bash scripts/db-restore.sh casa-ferreiro-AAAA-MM-DD_HHMM.dump.gpg
```

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env   # preencher com valores de teste
npm run db:check       # testa a ligação à base de dados
npm run dev            # API em http://localhost:3001 (reinicia ao gravar ficheiros)
node --test src/lib/*.test.js
```

Para abrir o site localmente, usar um servidor em `http://localhost:5500` (por exemplo, a extensão Live Server do VS Code). Abrir o `index.html` diretamente no browser (`file://`) não funciona: a API só aceita pedidos dos endereços autorizados.

## Booking.com

A disponibilidade é sincronizada por iCal (importação e exportação em `/ical/:roomId.ics`). A sincronização de preços e reservas em tempo real exige acesso à Connectivity API da Booking.com ou um channel manager.
