# API v1 — fontes de captação + núcleo (Fase 3A)

Esse documento cobre o que a Fase 3A adicionou sobre a base descrita
em [`docs/public-api.md`](./public-api.md) (autenticação por chave,
envelope de resposta, rate limit, `GET /api/v1/me`): o webhook público
de captação de leads e os endpoints núcleo de contatos, conversas,
mensagens, negócios e tags.

Tudo aqui segue o mesmo envelope `{ data: ... }` / `{ error: { code,
message } }` e a mesma autenticação por `Authorization: Bearer
wacrm_live_xxx` descrita no documento base — exceto o webhook de
captação, que é público (o token vai na própria URL).

## 1. Webhook de captação de leads

Cada **fonte de captação** (Configurações → Fontes de captação, gate
`hasAPI` / plano Business) tem sua própria URL pública e imprevisível:

```
POST /api/v1/webhooks/in/<token>
```

Sem `Authorization` — o token na URL é a única credencial. Aceita
`application/json` **ou** `application/x-www-form-urlencoded`
(a maioria dos form builders usa o segundo). Campos aceitos (PT-BR e
EN são sinônimos — útil pra RD Station, Elementor, HubSpot etc.):

| Campo       | Aliases aceitos      | Obrigatório |
| ----------- | --------------------- | ----------- |
| telefone    | `phone`, `telefone`, `whatsapp`, `celular` | sim |
| nome        | `name`, `nome`         | não |
| email       | `email`, `e-mail`      | não |
| empresa     | `company`, `empresa`   | não |

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks/in/SEU_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"telefone": "+55 11 99999-0000", "nome": "Maria Lima", "email": "maria@exemplo.com"}'
```

```bash
# application/x-www-form-urlencoded (padrão de formulários HTML)
curl -X POST https://your-crm.example.com/api/v1/webhooks/in/SEU_TOKEN \
  -d "telefone=5511999990000&nome=Maria+Lima"
```

Resposta (`201`):

```json
{
  "data": {
    "contact": { "id": "…", "outcome": "created" },
    "deal": { "id": "…", "outcome": "created" }
  }
}
```

- `contact.outcome`: `created` (telefone novo) ou `matched` (já
  existia um contato com esse telefone — mesma regra de dedup usada
  no webhook do WhatsApp, no formulário manual e na importação CSV).
- `deal.outcome`: `created`, ou `skipped_duplicate` se o contato já
  tinha um negócio aberto (não cria um segundo).

Erros seguem o envelope padrão: token inválido/inativo → `404
not_found` (não distinguimos "token nunca existiu" de "token
desativado"); plano sem `hasAPI` → `403 forbidden`; telefone ausente
→ `400 bad_request`; limite de taxa → `429 rate_limited` (30
requisições/minuto por token — ver `RATE_LIMITS.leadWebhookIn`).

Cada recebimento (sucesso ou erro) fica registrado em "Últimos
recebimentos" na tela de Configurações — payload resumido, nunca o
corpo bruto da requisição.

## 2. Paginação por cursor

Todo endpoint de listagem usa paginação por chave composta
(`created_at`, `id`), não por página — mais seguro sob inserções
concorrentes:

```
GET /api/v1/contacts?limit=25
GET /api/v1/contacts?limit=25&cursor=<opaco, vem da resposta anterior>
```

```json
{ "data": { "items": [ /* … */ ], "nextCursor": "b3B..." } }
```

`nextCursor: null` significa que não há mais páginas. `limit` aceita
1–100 (padrão 25); um `cursor` malformado retorna `400 bad_request`.

## 3. Escopos novos

Além dos escopos listados em `docs/public-api.md`:

| Escopo         | Permite                              |
| -------------- | ------------------------------------- |
| `deals:read`   | Listar e ler negócios                 |
| `deals:write`  | Criar e atualizar negócios            |
| `tags:read`    | Listar etiquetas                      |
| `tags:write`   | Criar etiquetas e vincular a contatos |

## 4. Contatos

### `GET /api/v1/contacts`

Escopo `contacts:read`. Filtros opcionais: `phone`, `email`,
`status_id`, `lead_origin_id`.

```bash
curl "https://your-crm.example.com/api/v1/contacts?phone=5511999990000" \
  -H "Authorization: Bearer wacrm_live_xxx"
```

### `POST /api/v1/contacts`

Escopo `contacts:write`. Cria ou casa por telefone (mesma regra de
dedup de todo o app) — resposta `201` se criou, `200` se já existia.

```bash
curl -X POST https://your-crm.example.com/api/v1/contacts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+5511999990000", "name": "Maria Lima", "email": "maria@exemplo.com"}'
```

```json
{ "data": { "contact": { "id": "…", "name": "Maria Lima", "...": "..." }, "outcome": "created" } }
```

### `GET /api/v1/contacts/{id}` · `PATCH /api/v1/contacts/{id}`

Escopos `contacts:read` / `contacts:write`. `PATCH` aceita qualquer
subconjunto de `name`, `phone`, `email`, `company`, `statusId`,
`leadOriginId`.

```bash
curl -X PATCH https://your-crm.example.com/api/v1/contacts/CONTACT_ID \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"company": "Acme Ltda"}'
```

## 5. Conversas e mensagens (somente leitura)

### `GET /api/v1/conversations`

Escopo `conversations:read`. Filtros: `contact_id`, `status`
(`open`/`pending`/`closed`).

```bash
curl "https://your-crm.example.com/api/v1/conversations?status=open" \
  -H "Authorization: Bearer wacrm_live_xxx"
```

### `GET /api/v1/conversations/{id}`

Escopo `conversations:read`.

### `GET /api/v1/conversations/{id}/messages`

Escopo `messages:read`. Mensagens apagadas (soft-delete) não
aparecem.

```bash
curl "https://your-crm.example.com/api/v1/conversations/CONV_ID/messages" \
  -H "Authorization: Bearer wacrm_live_xxx"
```

> Fase 3A não inclui envio de mensagens pela API v1 — isso permanece
> no roadmap de `docs/public-api.md` (`messages:send`).

## 6. Negócios

### `GET /api/v1/deals`

Escopo `deals:read`. Filtros: `pipeline_id`, `stage_id`,
`contact_id`, `status` (`open`/`won`/`lost`).

### `POST /api/v1/deals`

Escopo `deals:write`. `pipelineId` e `stageId` são obrigatórios (a
etapa precisa pertencer ao pipeline, e o pipeline à sua conta).
`value`/`currency`/`notes`/`contactId`/`expectedCloseDate` são
opcionais; sem `currency`, usa a moeda padrão da conta.

```bash
curl -X POST https://your-crm.example.com/api/v1/deals \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"pipelineId": "...", "stageId": "...", "contactId": "...", "title": "Plano anual", "value": 1200}'
```

### `GET /api/v1/deals/{id}` · `PATCH /api/v1/deals/{id}`

Escopos `deals:read` / `deals:write`. `PATCH` aceita qualquer
subconjunto de `title`, `value`, `currency`, `notes`, `status`,
`contactId`, `pipelineId`+`stageId` (sempre juntos),
`expectedCloseDate`. Mover de etapa ou marcar `status: "won"`/`"lost"`
aciona os mesmos gatilhos do banco que o drag-and-drop do funil usa
(`won_at`/`lost_at`, auto-marcação de etapa ganha).

```bash
curl -X PATCH https://your-crm.example.com/api/v1/deals/DEAL_ID \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"stageId": "...", "pipelineId": "..."}'
```

## 7. Tags

### `GET /api/v1/tags` · `POST /api/v1/tags`

Escopos `tags:read` / `tags:write`. `POST` aceita `name` (obrigatório)
e `color` (hex, opcional — padrão `#3b82f6`).

```bash
curl -X POST https://your-crm.example.com/api/v1/tags \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "Cliente VIP", "color": "#22c55e"}'
```

### `GET /api/v1/contacts/{id}/tags`

Escopo `tags:read`. Lista as tags vinculadas ao contato.

### `POST /api/v1/contacts/{id}/tags`

Escopo `tags:write`. Vincula — body `{ "tagId": "..." }`. Vincular
uma tag já vinculada não dá erro (o estado final já é o pedido).

### `DELETE /api/v1/contacts/{id}/tags/{tagId}`

Escopo `tags:write`. Desvincula (também sem erro se já não estava
vinculada).

```bash
curl -X POST https://your-crm.example.com/api/v1/contacts/CONTACT_ID/tags \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"tagId": "TAG_ID"}'
```
