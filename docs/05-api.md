# API v1 — contrato da primeira etapa

> Contratos da fundação preservados. Rotas de agenda, check-in, episódios, leitos e métricas foram acrescentadas sem remover essas rotas; a documentação adicional está em `06-recepcao-agendas-leitos.md`.

Base `/api`. As rotas estão estabilizadas como contrato inicial v1; o prefixo de versão explícito será introduzido antes de mudanças incompatíveis. OpenAPI gerado por NestJS em `GET /api/openapi.json` contém inventário de rotas e permissões de cabeçalho. Os esquemas detalhados abaixo complementam o documento gerado; DTOs Zod são a fonte da validação executada.

## Sessão e cabeçalhos
`POST /auth/login`: `{email,password,otp?}`. Retorna `{ok:true}` e cookie `aurora_session` HttpOnly, SameSite Strict, Secure na homologação. Código TOTP obrigatório para `ti`, seis dígitos, SHA-1, 30s, tolerância ±1 passo e bloqueio de replay.

Todas as escritas exigem `Origin` igual a `APP_ORIGIN` e `X-Requested-With: Aurora`. Rotas de negócio com criação/alteração exigem `Idempotency-Key` (16–80 caracteres). A chave cobre usuário, unidade, método, caminho e corpo. Repetição idêntica retorna a resposta original; outro corpo retorna 409. Autorizações são reavaliadas antes de recuperar resposta idempotente.

`X-Unit-Id` seleciona uma unidade vinculada ao usuário; ausência usa primeira unidade autorizada. Cookie e escopo são validados a cada chamada. Não há token persistido em localStorage.

## Rotas
| Método / caminho | Entrada | Saída / permissão |
|---|---|---|
|GET /health|—|status, ambiente, versão, productionReady:false; apenas liveness, não readiness do banco|
|POST /auth/login|email, password, otp?|cookie de sessão; 8 tentativas/conta e 40/IP por janela de 15min|
|GET /auth/me|cookie|id, nome, perfil, permissões, unidades e expiração|
|POST /auth/logout|{}|revoga sessão corrente|
|GET /units|—|unidades autorizadas / structure.read|
|POST /units|name, timezone|nova unidade e vínculo do autor / structure.write|
|GET /sectors|unidade ativa|setores / structure.read|
|POST /sectors|name|novo setor / structure.write|
|GET /patients|q, page>=1, size 1–50, sort=name ou created_at, direction=asc ou desc|rows, total, page, size / patients.read|
|GET /patients/:id|UUID|cadastro completo somente na unidade / patients.read|
|POST /patients|corpo abaixo|cadastro persistido / patients.create|
|PATCH /patients/:id|corpo + version + reason (5–300)|cadastro com versão incrementada / patients.update|
|GET /overview|unidade ativa|contagens, definições, fonte, período e atualização / overview.read|
|GET /settings|unidade ativa|services, version / structure.read|
|PATCH /settings|services[], version, reason|configuração atualizada / settings.write|
|GET /users|unidade ativa|contas sem hashes / users.read|
|GET /roles|—|perfis e códigos de permissão / users.read|
|POST /users|name, email, password 14–128, role_id|id / users.write; bloqueia novo técnico|
|PATCH /users/:id|active, role_id, reason|revoga sessões e atualiza acesso / users.write; bloqueia autoalteração e técnico|
|POST /users/:id/revoke|reason|revoga sessões do usuário na unidade / users.write|
|GET /preferences|—|favoritos/recentes/colunas do usuário|
|PATCH /preferences|favorites? (até 20), recent? (até 10), columns? [birth,status,id]|mescla somente campos permitidos|
|GET /audit|page, size|eventos da unidade e total / audit.read|

### Corpo de paciente
```json
{
  "name": "Pessoa Fictícia",
  "social_name": "",
  "birth_date": null,
  "provisional": true,
  "cpf": null,
  "cns": null,
  "phone": "",
  "mother_name": "",
  "emergency_contact": "",
  "accessibility": ""
}
```
Nascimento exige data civil válida, não futura, quando identificação não é provisória. CPF/CNS aceitam máscara, são opcionais e passam validação de dígitos. Unicidade no banco é por unidade nesta fase; a reconciliação institucional entre unidades permanece futura. Campos adicionais são recusados. Nome tem 3–160 caracteres. Telefone 30, filiação 160, contato de emergência 200, acessibilidade 500. A API não aceita conteúdo clínico nesse cadastro.

### Erros
`{statusCode,message,correlationId}`: 400 validação; 401 sessão/credenciais; 403 permissão/origem; 404 registro fora do escopo ou inexistente; 409 duplicidade/versão/idempotência; 429 limitação de tentativas; 500 falha interna sem conteúdo do banco. O cabeçalho `X-Correlation-Id` acompanha a resposta. Nenhum erro de gravação produz uma resposta de sucesso.

### Limitações do contrato
Não há endpoints de prontuário, prescrição, estoque, faturamento, recebimento, anexos ou transmissão. Buscas grandes por `LIKE` e locks globais da fundação exigirão otimização medida, não são promessa de escala. Preferências não guardam filtros de pacientes nem consultas contendo identificadores pessoais. Rotinas assíncronas ainda não existem.
