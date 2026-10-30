# Modelo de dados e política de evolução

> Modelo da primeira entrega preservado para rastreabilidade. Salas, agendas, consultas, episódios e leitos passaram a ter esquema físico na migração 002; consulte a tabela física atual em `06-recepcao-agendas-leitos.md`. Os demais modelos lógicos continuam pendentes.

## Modelo físico implementado — migração 001
Todas as referências abaixo são FKs reais. As datas de evento são `timestamptz`; nascimento é `date`. UUIDs são gerados pelo servidor. O seed é executado somente em demonstração e banco vazio.

| Entidade / tabela | Campos e relacionamentos | Índices / restrições | Estado e retenção |
|---|---|---|---|
|Instituição / institutions|id, name|PK id|Uma instituição inicial; sem exclusão pela API|
|Unidade / units|id, institution_id, name, timezone, active|FK instituição; UNIQUE instituição/nome|Ativa; cadastro sem exclusão pela API|
|Setor / sectors|id, unit_id, name, active|FK unidade; UNIQUE unidade/nome|Ativo; sem exclusão pela API|
|Perfil / roles|id, name, permissions text[]|PK textual|14 perfis de base; composição alterável via migração revisada|
|Usuário / users|id, email, name, password_hash, role_id, active, created_at|UNIQUE email; FK perfil|Ativo/desativado; sem remoção que quebre autoria|
|Vínculo / user_units|user_id, unit_id|PK composta; FKs usuário/unidade|Escopo obrigatório por unidade|
|Sessão / sessions|token_hash, user_id, expires_at, created_at|PK hash; índice usuário|Válida até expiração; removida em logout/revogação|
|Tentativas / login_attempts|key hash, attempts, until_at|PK key|Janela de 15 minutos; sem e-mail/IP em claro|
|MFA / used_totp|user_id, step|PK composta|Impede reutilização do mesmo passo TOTP|
|Paciente / patients|id, unit_id, name, social_name, birth_date, provisional, cpf, cns, phone, mother_name, emergency_contact, accessibility, version, created_at, updated_at|UNIQUE unidade/CPF e unidade/CNS, nulos aceitos; índices unidade/nome e unidade/data; checks formato/nascimento|Identificado/provisório; atualização otimista; sem exclusão ou mesclagem pela API|
|Configuração / settings|unit_id, services[], version|PK/FK unidade|Atualização por versão e justificativa auditada|
|Preferências / preferences|user_id, value JSONB validado|PK/FK usuário|Favoritos/recentes/colunas, sem dados clínicos|
|Idempotência / idempotency|user_id, key, request_hash, response JSONB, created_at|PK usuário/chave|Resposta persistida na mesma transação; retenção sem expurgo automático nesta versão|
|Auditoria / audit|id sequencial, user_id, role_id efetivo, unit_id, action, resource, result, reason, correlation_id, created_at, previous_hash, hash|PK; índice unidade/data; triggers impedem UPDATE/DELETE|Append-only via DML; sem expurgo automático|

Não há limpeza automática de dados pessoais nesta etapa. A instituição deve definir prazos e rotinas para sessões expiradas, tentativas, idempotência, evidências e cadastros antes de usar dados reais. Isso é uma limitação explícita, não uma política de retenção legal validada. Os históricos clínicos futuros não poderão usar a atualização direta do cadastro como modelo de versionamento.

## Modelo lógico das etapas seguintes — NÃO migrado nem implementado
Convenções: toda entidade operacional inclui UUID, unidade, criação UTC, autoria e versão quando mutável. Referências a paciente/atendimento devem garantir mesma unidade por FK composta. Valores monetários usam `numeric(18,2)`, quantidades `numeric(18,6)`. A retenção de prontuários, imagens, prescrições, documentos fiscais e registros trabalhistas depende de validação institucional; não se define prazo jurídico fictício.

| Entidade | Campos e relações principais | Índices / invariantes planejados | Estados / ciclo de vida |
|---|---|---|---|
|Sala|unidade, setor, nome, recursos|UNIQUE unidade/nome|ativa/inativa; preservar agenda histórica|
|Leito|setor, sala, código, categoria|UNIQUE unidade/código|livre/reservado/ocupado/bloqueado/higienização; sem exclusão referenciada|
|Profissional|usuário, categoria, conselho, registro, UF|índice conselho/registro/UF|credencial validada/revogada; manter autoria|
|Vínculo profissional|profissional, unidade, setor, início/fim|índice profissional/vigência|ativo/encerrado|
|Permissão customizada|perfil, ação, domínio, unidade/contexto|UNIQUE composição; negação por padrão|versionada, revisão institucional|
|Identificador de paciente|paciente, tipo, emissor, valor, validade|UNIQUE tipo/emissor/valor conforme escopo validado|vigente/substituído; reconciliação rastreada|
|Responsável / contato|paciente, nome, vínculo, meios de contato, preferência|índice paciente|ativo/inativo; finalidade/retencão validadas|
|Convênio / plano|operadora, registro, produto, abrangência|índice operadora/plano|ativo/inativo; não apagar contas históricas|
|Contrato|partes, vigência, versão, regras, centro de custo|índice parte/vigência|rascunho/vigente/encerrado|
|Tabela versionada|contrato, versão, itens, valores, início/fim|UNIQUE tabela/versão/item|publicada imutável; contas congelam referência e valores|
|Agenda|profissional, especialidade, sala, unidade, disponibilidade|índices por recurso/data|ativa/bloqueada|
|Agendamento|agenda, paciente, início/fim, duração, motivo|exclusão de intervalos conflitantes; exceção autorizada|agendado/confirmado/check-in/cancelado/falta|
|Atendimento|paciente, modalidade, origem, convênio, horários|índice unidade/status/data; FK paciente/unidade|aberto/check-in/triagem/espera/em atendimento/observação/internado/finalizado/cancelado|
|Internação|atendimento, solicitação, previsão, alta|índice unidade/status|solicitada/autorizada/ativa/alta/cancelada|
|Movimentação de leito|internação, leito, início/fim, motivo|índice exclusivo leito ocupado com fim nulo; exclusão temporal|evento imutável, correção compensatória|
|Triagem / sinais vitais|atendimento, profissional habilitado, protocolo/versão, medidas/unidades/horários|índice atendimento/hora|rascunho/finalizada/retificada; sem risco automático inventado|
|Documento clínico|atendimento, tipo, categoria, autor, conteúdo, versão, documento anterior|UNIQUE documento/versão|rascunho/finalizado/retificado/cancelado; assinado só com mecanismo validado|
|Diagnóstico|atendimento, terminologia/versão, código, hipótese/confirmação|índice atendimento/código|ativo/resolvido/retificado|
|Alergia|paciente, substância, reação, fonte, autor, estado da investigação|índice paciente|registrada/negada/não investigada/indisponível; nunca equivalentes|
|Prescrição / item|atendimento, autor, medicamento, dose/unidade, via, frequência, início/fim, diluição|FK produto e documento/versão|rascunho/emitida/suspensa/substituída; preservar versões|
|Validação farmacêutica|item prescrição, profissional, parecer, horário|índice item/versão|validada/pendente/recusada; distinta de dispensação|
|Dispensação / itens|prescrição, lote, local, quantidade, destinatário|idempotência por comando; débito transacional|solicitada/dispensada/devolvida parcial/total|
|Administração|ordem vigente, dose, via, previsto/realizado, profissional, dupla checagem|índice ordem/horário; evitar duplicidade de execução|administrada/omitida/recusa/intercorrência; não inferida de estoque|
|Exame / solicitação|atendimento, procedimento, solicitante, prioridade|índice atendimento/status|solicitado/coleta/processamento/liberado/cancelado|
|Amostra|exame, código, coletor, recebido, rejeição, motivo, recoleta|UNIQUE identificação; FK solicitação|coletada/recebida/rejeitada/processada|
|Resultado / laudo|exame, versão, autor, conteúdo, comunicação crítica|UNIQUE exame/versão|rascunho/liberado/retificado; original imutável|
|Procedimento realizado|atendimento, catálogo/versão, executor, hora, quantidade|índice atendimento/item|realizado/cancelado por evento compensatório|
|Produto / unidade de medida|código, descrição, categoria, unidades, conversão, código de barras, controle especial|UNIQUE código; conversões autorizadas|ativo/inativo; sem conversão clínica inventada|
|Lote / local de estoque|produto, fabricante, lote, validade, localização, saldo|UNIQUE produto/local/lote; CHECK saldo>=0 salvo política explícita|liberado/quarentena/recolhido/vencido|
|Reserva / movimentação|lote, origem/destino, quantidade, atendimento, motivo, responsável|lock linha + débito condicional; idempotência de evento|reserva/entrada/transferência/dispensação/devolução/perda/ajuste; imutável|
|Compra / pedido / recebimento|requisição, aprovador, cotação, fornecedor, itens, quantidade recebida|índice pedido/item; impedir recebimento excessivo sem autorização|solicitada/aprovada/cotada/pedida/parcial/recebida/cancelada|
|Fornecedor|identificadores, contatos, dados contratuais|UNIQUE identificação conforme escopo|ativo/inativo; validação cadastral|
|Conta hospitalar / item|atendimento, regime, procedimento/material, quantidade, origem, tabela e valor congelados|índice atendimento/status; UNIQUE evento faturável|aberta/conferida/fechada/reaberta/estornada|
|Guia / lote de faturamento|conta, autorizações, versão do formato, protocolo|UNIQUE chave envio/versão|validado local/gerado/transmitido/recebido/aceito; pago separado|
|Glosa / recurso|item, motivo, valor, prazo, evidência, decisão|índice conta/prazo|aberta/em recurso/deferida/indeferida|
|Título / pagamento / conciliação|origem, centro de custo, competência, vencimento, valor, saldo, conta bancária, aprovadores|check saldo; idempotência; segregação de pessoas|pendente/aprovado/parcial/liquidado/estornado; eventos imutáveis|
|Documento / versão / anexo|domínio, dono, versão, hash, chave privada, tamanho, MIME, antivírus|UNIQUE documento/versão; FK escopo|quarentena/disponível/retido; links temporários auditados|
|Mensagem / processamento|conector/versão, chave externa, payload cifrado, tentativas, próximo retry, erro sanitizado|UNIQUE conector/chave; índice status/próxima tentativa|pendente/processando/sucesso/falha/revisão; outbox na transação de origem|

## Contratos externos previstos
Envelope interno futuro: `messageId`, `schemaVersion`, `integrationId`, `unitId`, `correlationId`, `idempotencyKey`, `occurredAt`, `externalIdentifiers`, `payload`. O payload só será definido após obter especificação oficial/fornecedor. Autenticação por conector; TLS; timeout; retry exponencial com limite; dead-letter para revisão; resposta autenticada; histórico de tentativas; nenhum sucesso presumido após transmissão. HL7/FHIR/DICOM são candidatos a avaliar, não conectores já implementados.

## Concorrência e evolução
A etapa 1 serializa escritas idempotentes e a cadeia de auditoria com locks transacionais; isso prioriza consistência em volume demonstrativo e precisará avaliação de contenção. PGlite tem fila única. Leitos e estoque precisam testes adicionais em PostgreSQL multiprocesso, não podem reutilizar uma checagem apenas na UI. Migrações futuras devem ser incrementais (002, 003...), com checksum, trava de execução e procedimento de recuperação antes da homologação. O executor atual conhece somente a migração 001 e exige bootstrap de instância única.
