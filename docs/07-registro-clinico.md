# Registro clínico por atendimento — versão 0.3

## Escopo entregue
Núcleo funcional da etapa 3, integrado aos episódios existentes. Não representa prontuário completo nem conclusão de toda a etapa. As sete abas e a arquitetura anterior foram preservadas. Os submenus **Clínicos > Prontuário** e **Evoluções** abrem o mesmo registro por episódio.

## Como testar
1. Recepção (`recepcao@demo.local`): abrir atendimento, realizar check-in e encaminhar à triagem ou espera em Recepção/Pacientes > Atendimentos.
2. Médico (`medico@demo.local`) ou enfermagem (`enfermagem@demo.local`): acessar Clínicos > Prontuário, conferir nome, nascimento, identificador e episódio.
3. Registrar vínculo assistencial, confirmando identidade/setor e justificando participação. O conteúdo fica bloqueado antes desse vínculo.
4. Registrar avaliação de alergias e sinais vitais; criar documento como rascunho.
5. Finalizar o documento. A edição direta desaparece; retificar cria versão rastreável. Consultar Histórico de versões para recuperar o conteúdo anterior.
6. Cancelamento exige motivo, conserva conteúdo/histórico e é terminal. Resumo de alta é documento; sua criação não encerra automaticamente o episódio.

Credenciais locais preservadas em `ACESSO-LOCAL.md`. Use somente dados fictícios. Existe um exemplo pronto no paciente **Teste de inicialização · FICTÍCIO**, episódio `0ca57714-0830-47ef-a1d9-44564e7c06df`: evolução retificada com três versões, alergia fictícia e duas versões de uma medição de temperatura.

## Modelo e integridade
Migração `003_clinical_documents.sql` aplicada. Não alterar seu conteúdo após aplicação.

| Entidade | Regras |
|---|---|
|care_links|Vínculo por usuário/episódio, unidade, setor no ingresso, justificativa e horário; único e imutável nesta versão.|
|clinical_documents|Documento do autor/categoria, tipo, conteúdo, estado e versão otimista. Identidade imutável; sem DELETE.|
|clinical_revisions|Snapshot integral por versão, autor efetivo, motivo e horário; trigger impede UPDATE/DELETE.|
|allergy_assessments|Avaliação versionada por paciente/unidade, episódio de origem, situação e substância/reação; eventos imutáveis.|
|vital_observations|Medição decimal, categoria/unidade fixa, horário observado, registro, autor, nota e motivo; retificação aponta para original, que permanece imutável.|

Documentos: `draft → finalized → rectified`; rascunhos podem ser atualizados pelo autor; retificações sucessivas mantêm histórico; cancelamento é terminal. Finalização **não é assinatura digital**. Escritas agrupam estado, snapshot e auditoria na mesma transação. Chaves idempotentes evitam repetir gravações; versões impedem sobrescrever alterações concorrentes.

Novos documentos/medições/avaliações e adesão exigem episódio ativo (`triage`, `waiting`, `in_care`, `observation`, `admitted`). Após encerramento, vínculos existentes permitem leitura e retificação justificada; novos registros são bloqueados. A baixa operacional permanece separada de documentos de alta.

Alergias distinguem `not_investigated`, `unavailable`, `none_known` e `recorded`. Apenas o último aceita/exige entradas. A avaliação mais recente da mesma pessoa/unidade aparece no cabeçalho do episódio autorizado. Atualizações concorrentes são serializadas pelo paciente e conferem versão. Histórico não é apagado ao registrar uma nova situação.

Sinais vitais: temperatura (°C), frequências cardíaca (bpm) e respiratória (irpm), saturação (%), pressões sistólica/diastólica (mmHg), peso (kg), altura (cm). A API define a unidade, rejeita campos extras, números malformados e horário futuro. A interface usa precisão de minuto; início é comparado ao minuto da abertura. Limites de normalidade e recomendações não foram inventados. O tipo `numeric(12,3)` limita a representação, não define faixa clínica segura. A retificação mantém categoria e autoria e só pode substituir a versão ainda vigente.

## Permissões e limites de acesso
Médico e enfermagem recebem `clinical.read/join/create/update/finalize/rectify/cancel`. Cada ação é validada no backend, além da unidade e do vínculo ao episódio. Atualização/finalização/retificação/cancelamento de documentos exigem autor e categoria originais. TI, recepção e gestão não recebem permissão clínica. Revogação de perfil/permissões afeta sessões existentes pelo guard da API.

**Limitação explícita:** a adesão à equipe é autodeclarada, restrita aos perfis assistenciais da unidade, com conferência de paciente/setor, motivo e auditoria. Não equivale a escala profissional homologada, atribuição por chefia ou autorização emergencial. A instituição ainda precisa validar essa política e os vínculos profissionais. Setor é conferido na adesão, mas não existe gestão de autorização profissional por escala/setor. A remoção/revogação específica de vínculo, acesso emergencial temporário e revisão posterior continuam pendentes; não há bypass emergencial.

Leituras clínicas autorizadas e mudanças são auditadas. Negativas por perfil são registradas pelo guard; negativas contextuais de vínculo dentro da transação ainda não geram evento de auditoria persistente independente. Conteúdo clínico fica nas tabelas clínicas, não no log operacional; justificativas devem evitar dados clínicos desnecessários.

## Contratos da API
Prefixo `/api/clinical`. Sessão, unidade, origem e proteção CSRF seguem contratos anteriores. Todos os POST exigem `Idempotency-Key`.

| Método/rota | Permissão / conteúdo |
|---|---|
|POST `/encounters/:id/join`|clinical.join; confirmed_patient_id, sector_id, reason|
|GET `/encounters/:id?page=1`|clinical.read + vínculo; cabeçalho, avaliação vigente, documentos paginados|
|POST `/encounters/:id/documents`|clinical.create + vínculo; confirmed_patient_id, kind (evolucao/anamnese/alta), content|
|POST `/documents/:id/transition`|Permissão específica da ação; action (update/finalize/rectify/cancel), version, confirmed_patient_id, reason; content somente em update/rectify|
|GET `/documents/:id/history?page=1`|clinical.read + vínculo; snapshots imutáveis paginados|
|POST `/encounters/:id/allergies`|clinical.create + vínculo; confirmed_patient_id, version, state, entries [{substance,reaction}], reason|
|GET `/encounters/:id/allergies/history?page=1`|clinical.read + vínculo; avaliações anteriores paginadas|
|POST `/encounters/:id/vitals`|clinical.create + vínculo; confirmed_patient_id, kind, value (string decimal), observed_at (ISO com offset), note, reason, replaces_id opcional; retificação exige clinical.rectify|
|GET `/encounters/:id/vitals?page=1`|clinical.read + vínculo; medições e indicação superseded, 10 registros/página|

400: formulário inválido; 403: perfil/vínculo/autoria não autorizados; 404: recurso fora da unidade/inexistente; 409: conflito de versão, identidade ou estado. Erros não produzem mensagem falsa de sucesso.

## Verificação executada
- `npm test`: **61 aprovados, 0 falhas** — 46 anteriores + 15 clínicos, resultado em `testes-clinicos.txt`.
- `npm run build`: TypeScript backend/frontend e Vite aprovados, resultado em `build-clinico.txt`.
- Testes clínicos incluem TI/recepção sem acesso, profissional sem vínculo, identidade/setor divergentes, leituras auditadas, criação idempotente, autoria, duas alterações concorrentes, edição proibida após finalização, original preservado, triggers contra alteração/exclusão, unidade, permissão revogada, estados de alergia, conflito entre avaliações, unidade/horário de sinais vitais, retificação concorrente, encerramento e cancelamento.
- Migração real comparou hashes de todas as linhas anteriores de pacientes/usuários/episódios/agendamentos/leitos e prefixo completo da auditoria. Resultado: preservados 8 pacientes, 14 usuários, 1 episódio, 1 agendamento, 3 leitos e 63 eventos anteriores. Evidência em `migracao-clinica.json`; contagens de ambas as unidades.
- Interface exercitada: recepção → episódio/check-in/triagem → médico/vínculo → rascunho/finalização/retificação/histórico → alergia → sinal vital/retificação. Persistência de documentos e alergia reconfirmada após interrupção e reinício em 30/10/2026. A medição original de 36,5 e a retificação de 36,6 são exclusivamente dados fictícios de teste.

Testes usam PGlite isolado. Não comprovam concorrência multiprocesso no PostgreSQL em rede. Ainda faltam testes de carga, acessibilidade abrangente, assinatura, anexos, restauração da versão clínica completa e validação assistencial/institucional.

## Próxima sequência preservada
Solicitações e resultados com estados por serviço, amostras, liberação e retificação, acesso restrito de laboratório/imagem sem abrir prontuário completo, integração ao episódio e testes. Depois, prescrição, validação farmacêutica, estoque/dispensação/administração e conta financeira como eventos distintos. Permanecem pendentes os demais requisitos do prompt original, inclusive histórico autorizado entre episódios, diagnósticos/problemas, risco validado, anexos, impressão/exportação auditada, cirurgia e homologação.
