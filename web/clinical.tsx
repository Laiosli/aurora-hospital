import React, { useEffect, useRef, useState } from "react";
import { unitInstant, unitLocal } from "./time";

type Props = {
  api: (url: string) => Promise<any>;
  write: (url: string, body: any, method?: string, key?: any) => Promise<any>;
  Modal: any;
  timezone: string;
  self: string;
  fullAccess?: boolean;
  can: (p: string) => boolean;
};
const states: Record<string, string> = {
  draft: "Rascunho",
  finalized: "Finalizado · sem assinatura digital",
  rectified: "Retificado · sem assinatura digital",
  cancelled: "Cancelado",
};
const kinds: Record<string, string> = {
  evolucao: "Evolução",
  anamnese: "Anamnese",
  alta: "Resumo de alta",
};
const active = ["triage", "waiting", "in_care", "observation", "admitted"];
const encounterStates: Record<string, string> = {
  opened: 'Aberto', checked_in: 'Check-in realizado', triage: 'Encaminhado à triagem',
  waiting: 'Aguardando atendimento', in_care: 'Em atendimento', observation: 'Em observação',
  admitted: 'Internado', discharged: 'Alta operacional', cancelled: 'Cancelado',
};
const birthDate = (value: string) => value
  ? String(value).slice(0, 10).split('-').reverse().join('/')
  : 'Não informado';
const allergyStates: Record<string, string> = {
  not_investigated: "Alergias não investigadas",
  unavailable: "Informação de alergias indisponível",
  none_known: "Sem alergias conhecidas",
  recorded: "Alergias registradas",
};
const vitalKinds: Record<string, [string, string]> = {
  temperature: ["Temperatura", "°C"],
  heart_rate: ["Frequência cardíaca", "bpm"],
  respiratory_rate: ["Frequência respiratória", "irpm"],
  saturation: ["Saturação", "%"],
  systolic: ["Pressão sistólica", "mmHg"],
  diastolic: ["Pressão diastólica", "mmHg"],
  weight: ["Peso", "kg"],
  height: ["Altura", "cm"],
};
export function ClinicalView(props: Props) {
  const { api, Modal, timezone, self, can } = props;
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [list, setList] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [chart, setChart] = useState<any>(null),
    [chartPage, setChartPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [tick, setTick] = useState(0),
    [form, setForm] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [historyPage, setHistoryPage] = useState(1),
    [versions, setVersions] = useState<any>(null),
    [notice, setNotice] = useState("");
  const stamp = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(v));
  useEffect(() => {
    let live = true;
    setError("");
    setList(null);
    api("/encounters?page=" + page + "&q=" + encodeURIComponent(query))
      .then((r) => {
        if (live) setList(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [query, page, tick]);
  useEffect(() => {
    let live = true;
    setChart(null);
    setError("");
    if (!selected) return;
    setLoading(true);
    api(`/clinical/encounters/${selected.id}?page=${chartPage}`)
      .then((r) => {
        if (live) setChart(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selected, chartPage, tick]);
  useEffect(() => {
    let live = true;
    setVersions(null);
    if (history)
      api(`/clinical/documents/${history.id}/history?page=${historyPage}`)
        .then((r) => {
          if (live) setVersions(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [history, historyPage]);
  const edit = (action: string, doc?: any) => {
    setNotice("");
    setForm({ action, doc });
  };
  return (
    <>
      <div className="notice">
        Registro clínico demonstrativo por atendimento. Finalização não é
        assinatura digital. Prescrição, exames e classificação de risco
        permanecem pendentes. Não há interpretação automática de sinais vitais
        ou indicação de tratamento.
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!selected ? (
        <div className="panel">
          <label>
            Buscar atendimento por paciente
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {!list ? (
            <p>Consultando atendimentos…</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Paciente / identificação</th>
                    <th>Atendimento / setor</th>
                    <th>Estado operacional</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((e: any) => (
                    <tr key={e.id}>
                      <td>
                        {e.patient_name}
                        <br />
                        {e.birth_date
                          ? birthDate(e.birth_date)
                          : "Nascimento não informado"}
                        <br />
                        <small>{e.patient_id}</small>
                      </td>
                      <td>
                        {stamp(e.opened_at)}
                        <br />
                        {e.sector_name}
                        <br />
                        <small>{e.id}</small>
                      </td>
                      <td>{encounterStates[e.status] || e.status}</td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => {
                            setSelected(e);
                            setChartPage(1);
                          }}
                        >
                          Abrir registro clínico
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.rows.length && (
                <p>
                  Nenhum atendimento encontrado. Abra um atendimento pela
                  Recepção/Pacientes.
                </p>
              )}
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </button>
                <span>
                  Página {page} · {list.total} registros
                </span>
                <button
                  disabled={page * 10 >= list.total}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <button
            className="secondary"
            onClick={() => {
              setSelected(null);
              setChart(null);
              setError("");
              setNotice("");
            }}
          >
            Voltar aos atendimentos
          </button>
          <div className="panel">
            <h2>{selected.patient_name}</h2>
            <p>
              Nascimento:{" "}
              {selected.birth_date
                ? birthDate(selected.birth_date)
                : "Não informado"}{" "}
              · Paciente: {selected.patient_id}
            </p>
            <p>
              Atendimento: {selected.id} · Setor: {selected.sector_name}
            </p>
            <p className="notice">
              {chart
                ? allergyStates[chart.allergy.state]
                : "Alergias: acesso ainda não autorizado — não interprete como ausência de alergias."}
            </p>
            {chart?.allergy.entries.map((a: any, i: number) => (
              <p key={i}>
                <strong>{a.substance}</strong> — reação: {a.reaction}
              </p>
            ))}
            {chart?.allergy.author_name && (
              <small>
                Avaliação por {chart.allergy.author_name} ·{" "}
                {stamp(chart.allergy.created_at)} · v{chart.allergy.version}
              </small>
            )}
          </div>
          {loading ? (
            <p>Consultando registro autorizado…</p>
          ) : !chart ? (
            <div className="panel">
              <p>
                O conteúdo clínico exige vínculo assistencial registrado. A
                adesão identifica você como integrante da equipe deste
                atendimento e é auditada com justificativa.
              </p>
              {active.includes(selected.status) && can("clinical.join") && (
                <button className="primary" onClick={() => edit("join")}>
                  Registrar meu vínculo assistencial
                </button>
              )}
              <button className="secondary" onClick={() => setTick(tick + 1)}>
                Tentar consultar novamente
              </button>
            </div>
          ) : (
            <div className="panel">
              <Observations
                {...props}
                encounter={chart.encounter}
                patientName={selected.patient_name}
                allergy={chart.allergy}
                onSaved={() => {
                  setTick(tick + 1);
                  setNotice("Registro assistencial persistido e auditado.");
                }}
              />
              {active.includes(chart.encounter.status) &&
                can("clinical.create") && (
                  <button className="primary" onClick={() => edit("create")}>
                    Novo documento clínico
                  </button>
                )}
              {!chart.rows.length && (
                <p>Nenhum documento registrado neste atendimento.</p>
              )}
              {chart.rows.map((d: any) => (
                <article key={d.id} className="panel">
                  <h3>
                    {kinds[d.kind]} · {states[d.status]}
                  </h3>
                  <p>
                    {d.author_name} ·{" "}
                    {d.category === "ti_demo" ? "T.I · Demonstração" : d.category === "medico" ? "Médico" : "Enfermagem"} · v
                    {d.version} · {stamp(d.updated_at)}
                  </p>
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {d.content}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setHistory(d);
                      setHistoryPage(1);
                    }}
                  >
                    Histórico de versões
                  </button>
                  {(d.author_id === self || props.fullAccess) && d.status !== "cancelled" && (
                    <>
                      {d.status === "draft" ? (
                        <>
                          {active.includes(chart.encounter.status) && (
                            <>
                              {can("clinical.update") && (
                                <button onClick={() => edit("update", d)}>
                                  Editar rascunho
                                </button>
                              )}
                              {can("clinical.finalize") && (
                                <button onClick={() => edit("finalize", d)}>
                                  Finalizar documento
                                </button>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        can("clinical.rectify") && (
                          <button onClick={() => edit("rectify", d)}>
                            Retificar preservando original
                          </button>
                        )
                      )}
                      {can("clinical.cancel") && (
                        <button onClick={() => edit("cancel", d)}>
                          Cancelar com justificativa
                        </button>
                      )}
                    </>
                  )}
                </article>
              ))}
              <div className="pagination">
                <button
                  disabled={chartPage === 1}
                  onClick={() => setChartPage(chartPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {chartPage} · {chart.total} documentos
                </span>
                <button
                  disabled={chartPage * 10 >= chart.total}
                  onClick={() => setChartPage(chartPage + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {form && (
        <DocumentForm
          {...props}
          encounter={selected}
          form={form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setTick(tick + 1);
            setNotice("Operação clínica persistida e auditada.");
          }}
        />
      )}
      {history && (
        <Modal
          title="Histórico imutável do documento"
          onClose={() => setHistory(null)}
        >
          <div className="modal-body">
            {versions ? (
              versions.rows.map((r: any) => (
                <article key={r.id}>
                  <h3>
                    Versão {r.version} · {states[r.status]}
                  </h3>
                  <p>
                    {r.actor_name} · {stamp(r.created_at)}
                  </p>
                  <p>Justificativa: {r.reason}</p>
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {r.content}
                  </p>
                  <hr />
                </article>
              ))
            ) : (
              <p>Consultando histórico…</p>
            )}
            <button
              disabled={historyPage === 1}
              onClick={() => setHistoryPage(historyPage - 1)}
            >
              Anterior
            </button>
            <span> Página {historyPage} </span>
            <button
              disabled={!versions || historyPage * 10 >= versions.total}
              onClick={() => setHistoryPage(historyPage + 1)}
            >
              Próxima
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Observations(
  props: Props & {
    encounter: any;
    patientName: string;
    allergy: any;
    onSaved: () => void;
  },
) {
  const {
    api,
    write,
    Modal,
    encounter: e,
    allergy,
    onSaved,
    timezone,
    self,
    can,
  } = props;
  const [rows, setRows] = useState<any>(null),
    [page, setPage] = useState(1),
    [mode, setMode] = useState(""),
    [old, setOld] = useState<any>(null),
    [kind, setKind] = useState("temperature"),
    [state, setState] = useState(allergy.state),
    [entries, setEntries] = useState<any[]>(allergy.entries),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [history, setHistory] = useState<any>(null),
    [historyPage, setHistoryPage] = useState(1);
  const key = useRef(crypto.randomUUID());
  const stamp = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(v));
  useEffect(() => {
    let live = true;
    setRows(null);
    api(`/clinical/encounters/${e.id}/vitals?page=${page}`)
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((err) => {
        if (live) setError(err.message);
      });
    return () => {
      live = false;
    };
  }, [page, e.id]);
  useEffect(() => {
    let live = true;
    if (mode === "history") {
      setHistory(null);
      api(`/clinical/encounters/${e.id}/allergies/history?page=${historyPage}`)
        .then((r) => {
          if (live) setHistory(r);
        })
        .catch((err) => {
          if (live) setError(err.message);
        });
    }
    return () => {
      live = false;
    };
  }, [mode, historyPage, e.id]);
  useEffect(() => {
    const h = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const changed = () => {
    setDirty(true);
    key.current = crypto.randomUUID();
  };
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else setMode("");
  };
  const start = (m: string, v?: any) => {
    setError("");
    setMode(m);
    setOld(v || null);
    setKind(v?.kind || "temperature");
    setState(allergy.state);
    setEntries(allergy.entries);
    setDirty(false);
    setDiscard(false);
    key.current = crypto.randomUUID();
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      const base = {
        confirmed_patient_id: e.patient_id,
        reason: f.get("reason"),
      };
      if (mode === "allergy")
        await write(
          `/clinical/encounters/${e.id}/allergies`,
          {
            ...base,
            version: allergy.version,
            state,
            entries: state === "recorded" ? entries : [],
          },
          "POST",
          key.current,
        );
      else
        await write(
          `/clinical/encounters/${e.id}/vitals`,
          {
            ...base,
            kind,
            value: String(f.get("value")).replace(",", "."),
            observed_at: unitInstant(String(f.get("observed_at")), timezone),
            note: String(f.get("note") || ""),
            ...(old ? { replaces_id: old.id } : {}),
          },
          "POST",
          key.current,
        );
      setMode("");
      setDirty(false);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>Alergias e sinais vitais</h3>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {active.includes(e.status) && can("clinical.create") && (
        <>
          <button onClick={() => start("allergy")}>
            Registrar avaliação de alergias
          </button>
          <button onClick={() => start("vital")}>Registrar sinal vital</button>
        </>
      )}
      <button
        onClick={() => {
          setHistoryPage(1);
          start("history");
        }}
      >
        Histórico de alergias
      </button>
      {!rows ? (
        <p>Consultando sinais vitais…</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Medição</th>
                <th>Valor / unidade</th>
                <th>Horário / autor</th>
                <th>Rastreabilidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((v: any) => (
                <tr key={v.id}>
                  <td>{vitalKinds[v.kind][0]}</td>
                  <td>
                    {String(v.value).replace(".", ",")} {v.measurement_unit}
                  </td>
                  <td>
                    {stamp(v.observed_at)}
                    <br />
                    {v.author_name}
                  </td>
                  <td>
                    {v.superseded
                      ? "Retificada — original preservado"
                      : v.replaces_id
                        ? "Retificação vigente"
                        : "Registro vigente"}
                    <br />
                    {v.note}
                    <br />
                    Justificativa: {v.reason}
                    {(v.author_id === self || props.fullAccess) &&
                      !v.superseded &&
                      can("clinical.rectify") && (
                        <button onClick={() => start("vital", v)}>
                          Retificar medição
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.total && <p>Nenhuma medição registrada.</p>}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>
              Página {page} · {rows.total} medições
            </span>
            <button
              disabled={page * 10 >= rows.total}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
      {mode === "history" ? (
        <Modal title="Histórico de avaliações de alergias" onClose={close}>
          <div className="modal-body">
            {history ? (
              history.rows.map((a: any) => (
                <article key={a.id}>
                  <h3>
                    v{a.version} · {allergyStates[a.state]}
                  </h3>
                  <p>
                    {a.author_name} · {stamp(a.created_at)}
                  </p>
                  {a.entries.map((x: any, i: number) => (
                    <p key={i}>
                      {x.substance}: {x.reaction}
                    </p>
                  ))}
                  <p>Justificativa: {a.reason}</p>
                </article>
              ))
            ) : (
              <p>Consultando…</p>
            )}
            <button
              disabled={historyPage === 1}
              onClick={() => setHistoryPage(historyPage - 1)}
            >
              Anterior
            </button>
            <span> Página {historyPage} </span>
            <button
              disabled={!history || historyPage * 10 >= history.total}
              onClick={() => setHistoryPage(historyPage + 1)}
            >
              Próxima
            </button>
          </div>
        </Modal>
      ) : (
        mode && (
          <Modal
            title={
              mode === "allergy"
                ? "Avaliação de alergias"
                : old
                  ? "Retificar medição"
                  : "Registrar sinal vital"
            }
            onClose={close}
          >
            <form onSubmit={submit} onChange={changed}>
              <div className="modal-body">
                <p>
                  <strong>{props.patientName}</strong>
                  <br />
                  Paciente: {e.patient_id}
                  <br />
                  Atendimento: {e.id}
                </p>
                <label>
                  <input type="checkbox" required /> Conferi o paciente e o
                  atendimento
                </label>
                {mode === "allergy" ? (
                  <>
                    <label>
                      Situação de alergias
                      <select
                        value={state}
                        onChange={(ev) => setState(ev.target.value)}
                      >
                        {Object.entries(allergyStates).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {state === "recorded" && (
                      <>
                        {entries.map((a: any, i: number) => (
                          <fieldset key={i}>
                            <legend>Alergia {i + 1}</legend>
                            <label>
                              Substância
                              <input
                                required
                                maxLength={160}
                                value={a.substance}
                                onChange={(ev) =>
                                  setEntries(
                                    entries.map((v: any, n: number) =>
                                      n === i
                                        ? { ...v, substance: ev.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              Reação relatada
                              <input
                                required
                                maxLength={500}
                                value={a.reaction}
                                onChange={(ev) =>
                                  setEntries(
                                    entries.map((v: any, n: number) =>
                                      n === i
                                        ? { ...v, reaction: ev.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setEntries(
                                  entries.filter(
                                    (_: any, n: number) => n !== i,
                                  ),
                                );
                                changed();
                              }}
                            >
                              Remover desta avaliação
                            </button>
                          </fieldset>
                        ))}
                        <button
                          type="button"
                          disabled={entries.length >= 50}
                          onClick={() => {
                            setEntries([
                              ...entries,
                              { substance: "", reaction: "" },
                            ]);
                            changed();
                          }}
                        >
                          Adicionar alergia
                        </button>
                      </>
                    )}
                    <p>
                      Uma nova avaliação substitui a situação vigente; as
                      anteriores permanecem no histórico. Não há alerta
                      farmacológico automático.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Medição
                      <select
                        value={kind}
                        disabled={!!old}
                        onChange={(ev) => setKind(ev.target.value)}
                      >
                        {Object.entries(vitalKinds).map(
                          ([value, [label, unit]]) => (
                            <option key={value} value={value}>
                              {label} ({unit})
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Valor em {vitalKinds[kind][1]}
                      <input
                        name="value"
                        inputMode="decimal"
                        required
                        pattern="-?[0-9]{1,9}([.,][0-9]{1,3})?"
                        defaultValue={
                          old ? String(old.value).replace(".", ",") : ""
                        }
                      />
                    </label>
                    <label>
                      Horário observado ({timezone})
                      <input
                        name="observed_at"
                        type="datetime-local"
                        required
                        defaultValue={unitLocal(
                          old?.observed_at || new Date().toISOString(),
                          timezone,
                        )}
                      />
                    </label>
                    <label>
                      Observação
                      <textarea
                        name="note"
                        maxLength={500}
                        defaultValue={old?.note || ""}
                      />
                    </label>
                    <p>
                      Registro manual sem limites de normalidade, classificação
                      ou recomendação automática.
                    </p>
                  </>
                )}
                <label>
                  Justificativa
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={500}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                {discard && (
                  <div role="alert">
                    <p>Descartar alterações não salvas?</p>
                    <button
                      type="button"
                      onClick={() => {
                        setDirty(false);
                        setMode("");
                      }}
                    >
                      Descartar alterações
                    </button>
                    <button type="button" onClick={() => setDiscard(false)}>
                      Continuar editando
                    </button>
                  </div>
                )}
              </div>
              <footer className="modal-footer">
                <button type="button" disabled={busy} onClick={close}>
                  Fechar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Gravando…" : "Salvar registro assistencial"}
                </button>
              </footer>
            </form>
          </Modal>
        )
      )}
    </section>
  );
}
function DocumentForm({
  write,
  Modal,
  encounter: e,
  form,
  onClose,
  onSaved,
}: Props & {
  encounter: any;
  form: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const key = useRef(crypto.randomUUID());
  const titles: Record<string, string> = {
    join: "Registrar vínculo assistencial",
    create: "Novo documento clínico",
    update: "Editar rascunho",
    finalize: "Finalizar documento",
    rectify: "Retificar documento",
    cancel: "Cancelar documento",
  };
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const action = form.action;
    let url = `/clinical/encounters/${e.id}`,
      body: any = { confirmed_patient_id: e.patient_id };
    if (action === "join") {
      url += "/join";
      body = { ...body, sector_id: e.sector_id, reason: f.get("reason") };
    } else if (action === "create") {
      url += "/documents";
      body = { ...body, kind: f.get("kind"), content: f.get("content") };
    } else {
      url = `/clinical/documents/${form.doc.id}/transition`;
      body = {
        ...body,
        action,
        version: form.doc.version,
        reason: f.get("reason"),
        ...(["update", "rectify"].includes(action)
          ? { content: f.get("content") }
          : {}),
      };
    }
    try {
      await write(url, body, "POST", key.current);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={titles[form.action]} onClose={close}>
      <form
        onSubmit={submit}
        onChange={() => {
          setDirty(true);
          key.current = crypto.randomUUID();
        }}
      >
        <div className="modal-body">
          <p>
            <strong>{e.patient_name}</strong>
            <br />
            Nascimento:{" "}
            {birthDate(e.birth_date)}
            <br />
            Paciente: {e.patient_id}
            <br />
            Atendimento: {e.id}
          </p>
          <label>
            <input type="checkbox" required /> Conferi o paciente e o
            atendimento acima
          </label>
          {form.action === "create" && (
            <label>
              Tipo de documento
              <select name="kind">
                <option value="evolucao">Evolução</option>
                <option value="anamnese">Anamnese</option>
                <option value="alta">
                  Resumo de alta (não encerra o atendimento)
                </option>
              </select>
            </label>
          )}
          {["create", "update", "rectify"].includes(form.action) && (
            <label>
              Conteúdo completo
              <textarea
                name="content"
                rows={10}
                required
                minLength={5}
                maxLength={20000}
                defaultValue={form.doc?.content || ""}
              />
            </label>
          )}
          {form.action !== "create" && (
            <label>
              Justificativa
              <textarea name="reason" required minLength={5} maxLength={500} />
            </label>
          )}
          {form.action === "finalize" && (
            <p>
              A finalização bloqueia edição direta. Correções posteriores exigem
              retificação. Não há assinatura digital nesta versão.
            </p>
          )}
          {form.action === "cancel" && (
            <p>
              O conteúdo e as versões serão preservados. O cancelamento não pode
              ser desfeito.
            </p>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {discard && (
            <div role="alert">
              <p>Descartar as alterações não salvas?</p>
              <button type="button" onClick={onClose}>
                Descartar alterações
              </button>
              <button type="button" onClick={() => setDiscard(false)}>
                Continuar editando
              </button>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={close} disabled={busy}>
            Fechar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Gravando…" : titles[form.action]}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
