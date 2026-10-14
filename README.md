# AutoPainel

Painel para revenda de veículos: estoque, publicação em marketplaces e e-commerce, CRM com kanban, agenda, financeiro e avaliação (FIPE + mercado).

**Stack:** Angular 19 (nginx) · Node.js 22 + Express 5 · MySQL 8 · Docker Compose.

## Subir

```bash
cp .env.example .env        # edite JWT_SECRET, senhas e as chaves que for usar
docker compose up --build -d
```

- Painel: http://localhost:8080 (porta `WEB_PORT`)
- Login inicial: `ADMIN_EMAIL` / `ADMIN_PASSWORD` (padrão `admin@autopainel.local` / `admin123`). Troque a senha em **Integrações → Configurações**.
- MySQL exposto no host em `MYSQL_HOST_PORT` (padrão 3307).

Depois de editar o `.env`, rode `docker compose restart api`.

Testes da API: `cd api && npm install && npm test`.

## Integrações (`.env`)

Integrações sem chave ficam como "Não configurado" e são ignoradas. O status e os logs aparecem em **Integrações**.

| Integração | Variáveis |
|---|---|
| Mercado Livre (OAuth) | `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_SITE_ID`, `ML_CATEGORY_ID`, `ML_LISTING_TYPE` |
| OLX (OAuth) | `OLX_CLIENT_ID`, `OLX_CLIENT_SECRET`, `OLX_API_URL`, `OLX_AUTH_URL`, `OLX_WEBHOOK_TOKEN` |
| Tray | `TRAY_CONSUMER_KEY`, `TRAY_CONSUMER_SECRET`, `TRAY_API_ADDRESS`, `TRAY_CODE` |
| Nuvemshop | `NUVEMSHOP_CLIENT_ID`, `NUVEMSHOP_CLIENT_SECRET`, `NUVEMSHOP_STORE_ID`, `NUVEMSHOP_ACCESS_TOKEN` |
| Shopify | `SHOPIFY_SHOP`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION` |
| WooCommerce | `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` |
| Loja Integrada | `LOJA_INTEGRADA_API_KEY`, `LOJA_INTEGRADA_APP_KEY` |
| Site próprio | `SITE_WEBHOOK_URL`, `SITE_WEBHOOK_SECRET` |
| RD Station | `RDSTATION_CRM_TOKEN`, `RDSTATION_MARKETING_API_KEY` |
| HubSpot | `HUBSPOT_ACCESS_TOKEN` |
| Pipedrive | `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_COMPANY_DOMAIN` |
| Salesforce | `SALESFORCE_LOGIN_URL`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_USERNAME`, `SALESFORCE_PASSWORD`, `SALESFORCE_SECURITY_TOKEN` |
| Bitrix24 | `BITRIX24_WEBHOOK_URL` |
| Zoho CRM | `ZOHO_ACCOUNTS_URL`, `ZOHO_API_DOMAIN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` |
| Ploomes | `PLOOMES_USER_KEY` |
| Agendor | `AGENDOR_API_TOKEN` |
| WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` |
| E-mail (contador) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ACCOUNTANT_EMAIL` |
| FIPE | `FIPE_API_URL`, `FIPE_TOKEN` (opcional) |
| Consulta de placa | `PLATE_API_URL`, `PLATE_API_TOKEN` |

Leads novos ou alterados são enviados automaticamente para todos os CRMs configurados.

## URLs para cadastrar nos serviços

Em produção, defina `PUBLIC_URL` com um domínio **HTTPS** público. Mercado Livre, OLX e Meta exigem HTTPS. Para testar localmente, use um túnel como ngrok ou cloudflared.

**Redirect OAuth**
- Mercado Livre: `{PUBLIC_URL}/api/integrations/mercadolivre/callback`
- OLX: `{PUBLIC_URL}/api/integrations/olx/callback`

**Webhooks**
- Mercado Livre: `{PUBLIC_URL}/api/webhooks/mercadolivre`
- OLX (leads): `{PUBLIC_URL}/api/webhooks/olx?token={OLX_WEBHOOK_TOKEN}`
- WhatsApp: `{PUBLIC_URL}/api/webhooks/whatsapp`. O verify token é `WHATSAPP_VERIFY_TOKEN`.

**Site próprio**
- Formulário de leads: `POST {PUBLIC_URL}/api/public/leads` com JSON `{"name","phone","email","message","vehicle_id"}`. O header `X-AutoPainel-Signature` é opcional e contém o HMAC-SHA256 do corpo com `SITE_WEBHOOK_SECRET`. Se o header for enviado e `SITE_WEBHOOK_SECRET` estiver definido, a assinatura é validada. Alterações no estoque também são enviadas por POST assinado para `SITE_WEBHOOK_URL`.
- Estoque público: `GET {PUBLIC_URL}/api/public/vehicles` (JSON) e `{PUBLIC_URL}/api/public/feed.xml` (XML para portais).

## Estrutura

```
api/   Express + mysql2 (rotas em src/routes, integrações em src/integrations)
web/   Angular 19 standalone (src/app/pages)
db/    init.sql (schema + dados de exemplo)
```
