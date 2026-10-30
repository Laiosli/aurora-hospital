# Operação, manual e homologação

> Manual da fundação. Para agendas, episódios, leitos e permissões assistenciais operacionais acrescentadas na versão 0.2, utilize também `06-recepcao-agendas-leitos.md`. O ensaio local de cópia/restauração executado na retomada está registrado em `restauracao-local.json`; PostgreSQL em rede e seus backups continuam pendentes.

## Ambientes
| Ambiente | Banco / transporte | Condição |
|---|---|---|
|demonstracao|PGlite local ou PostgreSQL; HTTP somente localhost|Dados fictícios; operação efetivamente implementada|
|homologacao|`DB_MODE=postgres`, `DATABASE_URL`, `APP_ORIGIN=https://...`; cookie Secure|Exige TLS no proxy, credenciais e infraestrutura. Não validado nesta máquina|
|producao|Bloqueado pelo bootstrap|Abertura só após concluir escopo, revisão de segurança e homologação|

Variáveis: `PORT` (3000), `HOST` (127.0.0.1; 0.0.0.0 no container), `APP_ENV`, `APP_ORIGIN` exata, `DB_MODE`, `DATABASE_URL`, `PGLITE_PATH`, `ADMIN_TOTP_SECRET`, `DEMO_PASSWORD` somente seed. Não registrar esses valores em logs. O `.env` local não substitui um cofre de segredos. Não expor a porta HTTP fora do localhost. Logs de erro contêm somente evento/correlação, sem SQL/payload/token. Não foi implantado agregador de logs.

## Manual por perfil
**Recepção:** entre com sua conta, confira unidade e setor. Em Recepção/Pacientes → Cadastro de pacientes, busque nome/UUID/CPF/CNS; a busca é limitada à unidade. Antes de criar, procure possíveis duplicidades. Clique Novo paciente, informe nome e nascimento ou marque provisório. CPF/CNS são opcionais. Os campos de identificação são validados no servidor. Consulte homônimos e confira identificadores. Para corrigir, abra Consultar e informe justificativa. Conflito de versão exige recarregar; a tela não afirma que salvou quando a API falha.

**Administração técnica:** entre em `ti@demo.local` usando MFA. Em Gerenciamento, cadastre unidades/setores; crie usuários comuns na unidade ativa; atribua um dos 14 perfis; desative ou altere acesso; revogue sessões com justificativa. A mudança invalida sessões existentes. Não há consulta a pacientes/prontuário. Novas contas técnicas exigirão provisionamento individual de MFA; criação/promoção pela API é bloqueada. Configurações permite declarar serviços, sem liberar funcionalidades futuras inexistentes. Consulte eventos em Auditoria e dependências em Integrações.

**Gestão hospitalar:** painel mostra contagens reais de cadastros, provisórios e setores. Não confundir com produção assistencial. Cada cartão define o cálculo, fonte, contexto e atualização. Não há lista nominal de pacientes neste perfil.

**Médico e Enfermagem:** apenas consulta cadastral autorizada nesta etapa. Não existem prontuário/prescrição/triagem operacionais. A autorização por vínculo assistencial será implementada antes de disponibilizar documentos clínicos.

**Auditoria:** consulte eventos da unidade, autoria, ação, recurso, justificativa, correlação e hash. A consulta também gera evento. Login e falhas são registrados sem unidade quando ainda não existe contexto selecionado; sua consulta consolidada por instituição ainda não tem tela. Não há permissão de modificar a trilha.

**Farmácia, Laboratório, Imagem, Faturamento, Financeiro, Compras, Almoxarifado e Serviço social:** contas e perfis foram cadastrados, com consulta de estrutura. Operações especializadas não foram implementadas. O menu apresenta o planejamento de forma explícita.

**Recursos comuns:** perfil, saída, notificações e ajuda no cabeçalho. Busca global oferece páginas autorizadas e busca de pacientes somente para perfis habilitados. Favoritos, acessos recentes e colunas ficam no backend por usuário. Aviso de sessão aparece nos últimos cinco minutos. O setor ativo é contexto visual; não representa uma permissão assistencial independente nesta etapa.

## Backup e restauração
**PostgreSQL — procedimento a executar pela TI (não testado aqui):**
1. Definir RPO/RTO com a direção, destino cifrado fora do servidor da aplicação e conta separada de backup.
2. Usar `pg_dump --format=custom --file=aurora.dump` com `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e credencial em mecanismo seguro, sem senha na linha de comando.
3. Calcular SHA-256 do artefato, registrar horário, operador, versão e resultado. Replicar cópia protegida para armazenamento separado. Configurar agendamento e alerta de falha na infraestrutura; isso não está automatizado pela aplicação.
4. Restaurar em banco isolado novo com `pg_restore --exit-on-error --no-owner --dbname=aurora_restore aurora.dump`. Nunca restaurar sobre a base ativa para fazer um teste.
5. Verificar migração 001, contagens, unicidade, FKs e cadeia de auditoria; executar testes de fumaça; comparar tempos com RTO. Expirar sessões restauradas antes de abrir acesso.
6. Registrar evidência datada e aprovação. Um arquivo de dump sem restauração verificada não comprova recuperação.

**Demonstração PGlite:** desligar o processo, aguardar fechamento e copiar integralmente `data/demo/` para diretório protegido; não copiar enquanto há gravações. Para ensaio, apontar `PGLITE_PATH` para uma cópia em novo diretório e verificar os cadastros. A suíte verificou fechamento/reabertura em disco, **não** executou um ensaio de cópia/restauração de backup. Não confundir esses resultados.

## Contingência e incidentes
Esta versão não funciona offline. Em indisponibilidade, informar falha e seguir procedimento externo aprovado pela instituição; não registrar dados reais em ferramentas improvisadas. O fluxo futuro de contingência deverá usar identificadores únicos, horário/origem/autoria e reconciliação assistida. Em incidente, conter acesso, preservar evidências, revogar sessões, acionar TI/encarregado/responsáveis e aplicar o procedimento institucional validado. Não há automação de notificações legais.

## Atualizações e retorno
Salvar backup e evidência de restauração antes de migrar, ensaiar em cópia isolada, manter imagem anterior e compatibilidade de esquema. A migração atual é de criação, sem down destrutivo. Não executar `DROP` como rollback. Se uma atualização de esquema futuro não for reversível, restaurar o backup em ambiente isolado e executar plano de reconciliação aprovado.

## Checklist de homologação pendente
- [ ] Confirmar instituição, unidades, setores, serviços, identificadores, calendários e critérios de duplicidade/mesclagem.
- [ ] Validar perfis por ação, setor, unidade e vínculo assistencial; composição customizada de permissões; acesso excepcional revisado.
- [ ] MFA individual completo, recuperação de acesso, rotação de segredos, monitoramento de abuso e expurgo de metadados de sessão.
- [ ] Revisar autorização em todas as entidades/arquivos, sessões revogadas, CSRF, XSS, SQL injection, limites e uploads.
- [ ] Separar conta migradora/proprietária da conta de runtime; trilha externa protegida contra administrador do banco.
- [ ] Definir finalidades, bases legais, retenção, atendimento a titulares e resposta a incidentes com responsáveis competentes.
- [ ] Validar protocolos assistenciais, formulários, prescrições, medicamentos, alertas, assinatura e fluxos de retificação.
- [ ] Obter tabelas/formatos oficiais vigentes; homologar SUS/operadoras e contabilização com financeiro.
- [ ] Testar leitos/estoque/documentos/recebimentos em concorrência real e fluxo integrado de 16 passos.
- [ ] Homologar conectores, reprocessamento, idempotência, falhas e contingência, sem usar dados reais em destinos não autorizados.
- [ ] Testar cargas e volume declarados, acessibilidade com tecnologia assistiva, tablets autorizados e impressão.
- [ ] Proteger backups, executar restauração isolada, medir RPO/RTO e testar retorno de versão.
- [ ] Aprovações assistencial, operacional, financeira, TI, segurança e privacidade antes de produção.
