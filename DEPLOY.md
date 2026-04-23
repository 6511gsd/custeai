# CusteAi — Deploy em Produção

## Visão Geral

O sistema inteiro (frontend + backend) roda em **um único servidor Node.js**.  
Banco de dados hospedado no **Supabase** (já configurado).  
Deploy no **Railway** (gratuito para começar).

---

## PASSO 1 — Supabase: Rodar o Schema

1. Acesse [supabase.com](https://supabase.com) → seu projeto `idwtvgzbzluvzhzttclj`
2. Menu lateral → **SQL Editor**
3. Clique em **New query**
4. Copie TODO o conteúdo do arquivo `schema.sql` e cole no editor
5. Clique em **Run** (F5)
6. Aguarde a mensagem "Success. No rows returned"

> Se aparecer erros de "already exists", o schema já foi rodado — pode ignorar.

---

## PASSO 2 — GitHub: Subir o Código

```bash
# No terminal, dentro da pasta do projeto:
git add .
git commit -m "chore: preparar deploy produção"
git remote add origin https://github.com/SEU_USUARIO/custeai.git
git push -u origin master
```

> Se não tiver repositório: acesse [github.com/new](https://github.com/new) e crie um.

---

## PASSO 3 — Railway: Deploy

1. Acesse [railway.app](https://railway.app) e crie uma conta (gratuito)
2. Clique em **New Project → Deploy from GitHub repo**
3. Selecione o repositório `custeai`
4. Railway detecta o `railway.json` e inicia o deploy automaticamente

---

## PASSO 4 — Railway: Configurar Variáveis de Ambiente

No painel do Railway → seu projeto → aba **Variables** → clique em **Raw Editor**  
Cole o conteúdo abaixo (substitua os valores marcados com `COLOQUE_AQUI`):

```
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://custeai.com.br,https://www.custeai.com.br,https://app.custeai.com.br
DB_HOST=aws-1-sa-east-1.pooler.supabase.com
DB_PORT=6543
DB_USER=postgres.idwtvgzbzluvzhzttclj
DB_PASSWORD=1284910330194821
DB_NAME=postgres
DATABASE_URL=postgresql://postgres.idwtvgzbzluvzhzttclj:1284910330194821@aws-1-sa-east-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://idwtvgzbzluvzhzttclj.supabase.co
JWT_SECRET=b91ad720a6bf83621eeadf77d548c39e923a16ab0b8af0a14a3eca6189b9283f7b0de47183efae1b15b20fd957fea6720fae3af1a9ffcd616bab4d0149100c06
JWT_EXPIRES=15m
REFRESH_EXPIRES=30d
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=5
APP_URL=https://custeai.com.br
LOGO_URL=https://custeai.com.br/logo.png
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@custeai.com.br
EMAIL_FROM_NAME=CusteAi
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=COLOQUE_SEU_EMAIL_GMAIL
SMTP_PASS=COLOQUE_SENHA_APP_GMAIL
PAYMENT_GATEWAY=stripe
STRIPE_SECRET_KEY=sk_live_COLOQUE_AQUI
STRIPE_PUBLISHABLE_KEY=pk_live_COLOQUE_AQUI
STRIPE_WEBHOOK_SECRET=whsec_COLOQUE_AQUI
```

Clique em **Update Variables** — o Railway reinicia automaticamente.

---

## PASSO 5 — Railway: Domínio Personalizado

1. Aba **Settings → Networking → Custom Domain**
2. Adicione: `custeai.com.br`
3. Railway mostra um registro `CNAME` — algo como:
   ```
   CNAME  @  xxxx.up.railway.app
   ```
4. No painel da **Hostinger → DNS Zone Editor**, adicione esse CNAME.

> O SSL é ativado automaticamente pelo Railway após o domínio propagar.

---

## PASSO 6 — Verificar se está funcionando

```
https://custeai.com.br/health
```
Deve retornar:
```json
{ "status": "ok", "version": "1.0.0" }
```

---

## Status do Checklist

- [x] CORS configurado para `custeai.com.br`
- [x] `railway.json` e `Procfile` prontos
- [x] Schema do banco completo
- [x] Variáveis de ambiente documentadas
- [ ] Schema rodado no Supabase
- [ ] Código no GitHub
- [ ] Deploy no Railway
- [ ] Variáveis configuradas no Railway
- [ ] Domínio personalizado no Railway
- [ ] DNS atualizado na Hostinger
- [ ] Gateway de pagamento (Stripe) configurado
- [ ] E-mail configurado (Gmail App Password)
