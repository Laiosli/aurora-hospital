import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  RefreshCw,
  CalendarDays,
  Search,
  ArrowRight,
  History,
  CheckCircle2,
} from "lucide-react";
import { unitInstant, unitLocal } from "./time";
import "./operations.css";

const names: Record<string, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  checked_in: "Check-in realizado",
  cancelled: "Cancelado",
  no_show: "Falta",
  opened: "Aberto",
  triage: "Encaminhado à triagem",
  waiting: "Aguardando atendimento",
  in_care: "Em atendimento",
  observation: "Em observação",
  admitted: "Internado",
  discharged: "Alta operacional",
  available: "Disponível",
  reserved: "Reservado",
  occupied: "Ocupado",
  blocked: "Bloqueado",
  cleaning: "Em higienização",
};
const transitions: Record<string, [string, string][]> = {
  opened: [
    ["checked_in", "encounters.route"],
    ["cancelled", "encounters.cancel"],
  ],
  checked_in: [
    ["triage", "encounters.route"],
    ["waiting", "encounters.route"],
    ["cancelled", "encounters.cancel"],
  ],
  triage: [
    ["waiting", "encounters.triage"],
    ["cancelled", "encounters.cancel"],
  ],
  waiting: [
    ["in_care", "encounters.attend"],
    ["cancelled", "encounters.cancel"],
  ],
  in_care: [
    ["observation", "encounters.attend"],
    ["discharged", "encounters.discharge"],
  ],
  observation: [
    ["in_care", "encounters.attend"],
    ["discharged", "encounters.discharge"],
  ],
  admitted: [["discharged", "encounters.discharge"]],
};
type Props = {
  page: string;
  can: (permission: string) => boolean;
  sectors: any[];
  timezone: string;
  api: (url: string) => Promise<any>;
  write: (url: string, body: any, method?: string, key?: any) => Promise<any>;
  Modal: any;
};
const format = (v: string, tz: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(v));
const birth = (v: string) =>
  v
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(v.slice(0, 10) + "T12:00:00Z"),
      )
    : "Não informado";
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (["cancelled", "blocked", "cleaning", "reserved", "triage"].includes(
          value,
        )
          ? "amber"
          : "green")
      }
    >
      {names[value] || value}
    </span>
  );
}
export function OperationalMetrics({
  api,
  timezone,
}: {
  api: Props["api"];
  timezone: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api("/operations/metrics")
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="operational-metrics">
      <div className="section-heading">
        <h2>Fluxo operacional</h2>
        <span>Situação atual da unidade</span>
      </div>
      <ErrorNotice message={error} />
      <div className="stats">
        {[
          ["encounters", "Episódios de atendimento"],
          ["waiting", "Pessoas na fila operacional"],
          ["occupancy", "Ocupação dos leitos (%)"],
        ].map(([key, label]) => (
          <article className="stat" key={key}>
            <div>{label}</div>
            <strong>
              {!data
                ? "—"
                : data[key] === null
                  ? "Sem leitos"
                  : Number(data[key]).toLocaleString("pt-BR", {
                      maximumFractionDigits: 1,
                    })}
            </strong>
            <p>{data?.definitions[key]}</p>
          </article>
        ))}
      </div>
      {data && (
        <p className="data-source">
          Origem: {data.source}. {data.period}. Atualização:{" "}
          {format(data.updatedAt, timezone)}.
        </p>
      )}
    </section>
  );
}
function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice" role="alert">
      {message}
    </div>
  ) : null;
}
function Pager({ page, setPage, total }: any) {
  return (
    <div className="pagination">
      <span>{total} registros · 10 por página</span>
      <div>
        <button
          className="secondary compact"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          className="secondary compact"
          disabled={page * 10 >= total}
          onClick={() => setPage(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

export function OperationsView(props: Props) {
  const { page: screen, can, sectors, timezone, api, write, Modal } = props;
  const bedScreen = ["Leitos", "Internações e movimentações"].includes(screen),
    scheduleScreen = screen === "Agendamentos";
  const [data, setData] = useState<any>({ rows: [], total: 0 }),
    [schedules, setSchedules] = useState<any>({ rows: [], total: 0 }),
    [schedulePage, setSchedulePage] = useState(1),
    [resources, setResources] = useState<any>({ rooms: [], professionals: [] }),
    [q, setQ] = useState(""),
    [state, setState] = useState(screen === "Filas" ? "active" : ""),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [editor, setEditor] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [historyPage, setHistoryPage] = useState(1),
    [events, setEvents] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        if (scheduleScreen) {
          const [s, r] = await Promise.all([
            api(`/schedules?page=${schedulePage}`),
            api("/resources"),
          ]);
          if (alive) {
            setSchedules(s);
            setResources(r);
          }
        }
        if (!scheduleScreen || can("appointments.read")) {
          const url = bedScreen
            ? "/beds"
            : scheduleScreen
              ? "/appointments"
              : "/encounters";
          const result = await api(
            `${url}?page=${page}&q=${encodeURIComponent(q)}${state ? "&status=" + state : ""}`,
          );
          if (alive) setData(result);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [screen, page, schedulePage, q, state, refresh]);
  useEffect(() => {
    if (!history) return;
    let alive = true;
    setEvents(null);
    api(`/operations/${history.type}/${history.id}/history?page=${historyPage}`)
      .then((v) => {
        if (alive) setEvents(v);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [history, historyPage]);
  function open(kind: string, row?: any) {
    setError("");
    setSuccess("");
    setEditor({ kind, row });
  }
  const inspect = (type: string, row: any) => {
    setHistoryPage(1);
    setHistory({ type, id: row.id, name: row.patient_name });
  };
  return (
    <>
      <div className="info-strip">
        <CalendarDays size={20} />
        <p>
          {scheduleScreen
            ? "Agendas por profissional e sala, com duração definida e conflito verificado no servidor."
            : bedScreen
              ? "Ocupação, transferência e liberação são transacionais. Leitos liberados após uso passam por higienização."
              : "Fluxo operacional do atendimento. Encaminhar à triagem não registra classificação de risco nem substitui avaliação clínica."}{" "}
          Horários: <strong>{timezone}</strong>.
        </p>
      </div>
      <ErrorNotice message={error} />
      {success && (
        <div className="success" role="status">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}
      {scheduleScreen && (
        <section className="panel spaced">
          <div className="section-heading">
            <h2>Disponibilidades de agenda</h2>
            <div className="inline-actions">
              {can("schedules.write") && (
                <>
                  <button className="secondary" onClick={() => open("room")}>
                    <Plus size={15} />
                    Sala
                  </button>
                  <button className="primary" onClick={() => open("schedule")}>
                    <Plus size={15} />
                    Agenda
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="muted">
            Uma disponibilidade delimita o período e a duração de cada consulta.
            Bloqueios atingem a mesma sala ou profissional, inclusive em outra
            agenda.
          </p>
          <div className="schedule-grid">
            {schedules.rows.map((s: any) => (
              <article key={s.id}>
                <h3>{s.name}</h3>
                <p>
                  {s.specialty} · {s.professional_name}
                  <br />
                  {s.room_name} · {s.slot_minutes} minutos
                </p>
                <p>
                  {format(s.starts_at, timezone)} —{" "}
                  {format(s.ends_at, timezone)}
                </p>
                <div className="inline-actions">
                  {can("appointments.write") && (
                    <button
                      className="secondary"
                      onClick={() => open("appointment", s)}
                    >
                      Agendar paciente
                    </button>
                  )}
                  {can("schedules.write") && (
                    <button
                      className="secondary"
                      onClick={() => open("block", s)}
                    >
                      Bloquear intervalo
                    </button>
                  )}
                  <button
                    className="table-link"
                    onClick={() => open("blocks", s)}
                  >
                    Ver bloqueios
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!schedules.rows.length && !busy && (
            <div className="empty">
              Nenhuma disponibilidade cadastrada. A administração técnica deve
              cadastrar sala e agenda.
            </div>
          )}
          <Pager
            page={schedulePage}
            setPage={setSchedulePage}
            total={schedules.total}
          />
        </section>
      )}
      {(!scheduleScreen || can("appointments.read")) && (
        <section className="panel table-panel spaced">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Buscar registros operacionais"
                placeholder={
                  bedScreen
                    ? "Filtro de leitos pelo estado"
                    : "Nome do paciente ou identificador do registro"
                }
                value={q}
                disabled={bedScreen}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="toolbar-actions">
              <select
                aria-label="Filtrar estado"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos os estados</option>
                {!bedScreen && !scheduleScreen && (
                  <option value="active">Atendimentos ativos</option>
                )}
                {(bedScreen
                  ? ["available", "reserved", "occupied", "blocked", "cleaning"]
                  : scheduleScreen
                    ? [
                        "scheduled",
                        "confirmed",
                        "checked_in",
                        "cancelled",
                        "no_show",
                      ]
                    : Object.keys(transitions).concat("discharged", "cancelled")
                ).map((v) => (
                  <option key={v} value={v}>
                    {names[v]}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                aria-label="Atualizar registros"
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw size={16} />
              </button>
              {bedScreen && can("beds.configure") && (
                <button className="primary" onClick={() => open("bed")}>
                  <Plus size={16} />
                  Novo leito
                </button>
              )}
              {!bedScreen && !scheduleScreen && can("encounters.create") && (
                <button className="primary" onClick={() => open("encounter")}>
                  <Plus size={16} />
                  Abrir atendimento
                </button>
              )}
            </div>
          </div>
          <div className="table-wrap" aria-busy={busy}>
            <table>
              <thead>
                <tr>
                  <th>
                    {bedScreen ? "Leito / setor" : "Paciente / identificação"}
                  </th>
                  <th>
                    {bedScreen
                      ? "Paciente autorizado"
                      : scheduleScreen
                        ? "Agendamento"
                        : "Episódio / setor"}
                  </th>
                  <th>Estado</th>
                  <th>
                    {bedScreen
                      ? "Versão"
                      : scheduleScreen
                        ? "Horário previsto"
                        : "Entrada na etapa"}
                  </th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {!busy &&
                  data.rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{bedScreen ? r.code : r.patient_name}</strong>
                        <small>
                          {bedScreen
                            ? r.sector_name
                            : "Nascimento: " + birth(r.birth_date)}
                        </small>
                        {!bedScreen && (
                          <small className="mono">
                            Paciente: {r.patient_id}
                          </small>
                        )}
                      </td>
                      <td>
                        {bedScreen
                          ? can("encounters.read")
                            ? r.patient_name || "Sem ocupação / reserva"
                            : "Identidade restrita ao perfil"
                          : scheduleScreen
                            ? r.schedule_name
                            : r.sector_name}
                        <small className="mono">
                          {bedScreen ? r.encounter_id || "" : r.id}
                        </small>
                      </td>
                      <td>
                        <Status value={r.state || r.status} />
                      </td>
                      <td>
                        {bedScreen
                          ? "v" + r.version
                          : format(
                              scheduleScreen ? r.starts_at : r.stage_at,
                              timezone,
                            )}
                      </td>
                      <td>
                        <div className="operation-actions">
                          {bedScreen ? (
                            <>
                              {can("beds.allocate") &&
                                r.state === "available" && (
                                  <button
                                    className="table-link"
                                    onClick={() => open("allocation", r)}
                                  >
                                    Reservar / ocupar / transferir
                                  </button>
                                )}
                              {can("beds.allocate") &&
                                r.state === "reserved" && (
                                  <>
                                    <button
                                      className="table-link"
                                      onClick={() => open("allocation", r)}
                                    >
                                      Ocupar reserva
                                    </button>
                                    <button
                                      className="table-link"
                                      onClick={() =>
                                        open("cancel_reservation", r)
                                      }
                                    >
                                      Cancelar reserva
                                    </button>
                                  </>
                                )}
                              {can("beds.configure") &&
                                ["available", "blocked"].includes(r.state) && (
                                  <button
                                    className="table-link"
                                    onClick={() =>
                                      open(
                                        r.state === "available"
                                          ? "block_bed"
                                          : "unblock",
                                        r,
                                      )
                                    }
                                  >
                                    {r.state === "available"
                                      ? "Bloquear"
                                      : "Desbloquear"}
                                  </button>
                                )}
                              {can("beds.clean") && r.state === "cleaning" && (
                                <button
                                  className="table-link"
                                  onClick={() => open("clean", r)}
                                >
                                  Concluir higienização
                                </button>
                              )}
                            </>
                          ) : scheduleScreen ? (
                            <>
                              {["scheduled", "confirmed"].includes(r.status) &&
                                can("appointments.write") && (
                                  <>
                                    <button
                                      className="table-link"
                                      onClick={() =>
                                        open("change_appointment", r)
                                      }
                                    >
                                      Alterar / confirmar
                                    </button>
                                    {can("encounters.create") && (
                                      <button
                                        className="table-link"
                                        onClick={() => open("checkin", r)}
                                      >
                                        Fazer check-in
                                      </button>
                                    )}
                                  </>
                                )}
                              {can("encounters.read") && (
                                <button
                                  className="table-link"
                                  onClick={() => inspect("appointment", r)}
                                >
                                  <History size={13} />
                                  Histórico
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {(transitions[r.status] || []).some(([, perm]) =>
                                can(perm),
                              ) && (
                                <button
                                  className="table-link"
                                  onClick={() => open("transition", r)}
                                >
                                  Mudar etapa
                                  <ArrowRight size={13} />
                                </button>
                              )}
                              <button
                                className="table-link"
                                onClick={() => inspect("encounter", r)}
                              >
                                <History size={13} />
                                Histórico
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {busy ? (
              <div className="empty" role="status">
                Consultando o servidor…
              </div>
            ) : !data.rows.length ? (
              <div className="empty">
                Nenhum registro para os filtros da unidade.
              </div>
            ) : null}
          </div>
          <Pager page={page} setPage={setPage} total={data.total} />
        </section>
      )}
      {editor && (
        <OperationForm
          {...props}
          editor={editor}
          resources={resources}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRefresh((v) => v + 1);
            setSuccess("Operação persistida e auditada no servidor.");
          }}
        />
      )}
      {history && (
        <Modal title="Histórico operacional" onClose={() => setHistory(null)}>
          <div className="modal-body">
            <h3>{history.name}</h3>
            <p className="mono">{history.id}</p>
            {events?.rows.map((e: any) => (
              <article className="history-event" key={e.id}>
                <strong>
                  {e.action} · {names[e.from_state] || e.from_state || "Início"}{" "}
                  → {names[e.to_state] || e.to_state}
                </strong>
                <p>{e.reason}</p>
                <small>
                  {e.actor_name} · {format(e.created_at, timezone)}
                </small>
                <details>
                  <summary>Detalhes da alteração</summary>
                  <pre>{JSON.stringify(e.details, null, 2)}</pre>
                  <small>Correlação: {e.correlation_id}</small>
                </details>
              </article>
            )) || <p>Carregando histórico…</p>}
            {events && (
              <Pager
                page={historyPage}
                setPage={setHistoryPage}
                total={events.total}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function PatientPicker({ api, onPick, selected }: any) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (query.trim().length < 2) {
        setRows([]);
        return;
      }
      api("/patients?q=" + encodeURIComponent(query) + "&size=10")
        .then((v: any) => {
          if (alive) {
            setRows(v.rows);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);
  return (
    <div className="patient-picker">
      <label>
        Localizar paciente para conferir a identidade
        <input
          aria-label="Localizar paciente"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onPick(null);
          }}
          placeholder="Digite ao menos dois caracteres do nome ou identificador"
        />
      </label>
      <ErrorNotice message={error} />
      {!selected &&
        rows.map((p) => (
          <button
            type="button"
            key={p.id}
            className="patient-choice"
            onClick={() => onPick(p)}
          >
            <strong>{p.name}</strong>
            <span>
              Nascimento: {birth(p.birth_date)} {p.homonym ? "· Homônimo" : ""}
            </span>
            <small>{p.id}</small>
          </button>
        ))}
      {selected && (
        <div className="selected-patient">
          <strong>{selected.name}</strong>
          <p>Nascimento: {birth(selected.birth_date)}</p>
          <small>{selected.id}</small>
        </div>
      )}
    </div>
  );
}

function OperationForm({
  editor,
  resources,
  api,
  write,
  Modal,
  sectors,
  timezone,
  can,
  onClose,
  onSaved,
}: Props & {
  editor: any;
  resources: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { kind, row } = editor;
  const [patient, setPatient] = useState<any>(
      kind === "checkin"
        ? {
            id: row.patient_id,
            name: row.patient_name,
            birth_date: row.birth_date,
          }
        : null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [options, setOptions] = useState<any[]>([]),
    [lookup, setLookup] = useState(""),
    [action, setAction] = useState("confirm");
  const key = useRef(crypto.randomUUID());
  const touch = () => {
    setDirty(true);
    key.current = crypto.randomUUID();
  };
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    let alive = true;
    let url = "";
    if (kind === "allocation")
      url = "/encounters?status=active&size=50&q=" + encodeURIComponent(lookup);
    if (kind === "blocks") url = `/schedules/${row.id}/blocks`;
    if (url) {
      const t = setTimeout(
        () =>
          api(url)
            .then((v) => {
              if (alive) setOptions(v.rows || v);
            })
            .catch((e) => {
              if (alive) setError(e.message);
            }),
        180,
      );
      return () => {
        alive = false;
        clearTimeout(t);
      };
    }
  }, [lookup, kind]);
  const close = useCallback(() => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  }, [busy, dirty, onClose]);
  const titles: Record<string, string> = {
    room: "Cadastrar sala",
    schedule: "Cadastrar disponibilidade de agenda",
    appointment: "Agendar paciente",
    block: "Bloquear intervalo da agenda",
    blocks: "Bloqueios da agenda",
    encounter: "Abrir atendimento",
    checkin: "Conferência e check-in",
    change_appointment: "Alterar agendamento",
    transition: "Transição do atendimento",
    bed: "Cadastrar leito",
    allocation: "Movimentar leito",
    cancel_reservation: "Cancelar reserva",
    block_bed: "Bloquear leito",
    unblock: "Desbloquear leito",
    clean: "Concluir higienização",
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget),
      s = (name: string) => String(f.get(name) || ""),
      why = s("reason");
    try {
      let url = "",
        method = "POST",
        body: any = {};
      if (kind === "room") {
        url = "/rooms";
        body = { name: s("name"), sector_id: s("sector_id") };
      }
      if (kind === "schedule") {
        url = "/schedules";
        body = {
          name: s("name"),
          specialty: s("specialty"),
          room_id: s("room_id"),
          professional_id: s("professional_id"),
          slot_minutes: Number(s("slot_minutes")),
          starts_at: unitInstant(s("starts_at"), timezone),
          ends_at: unitInstant(s("ends_at"), timezone),
        };
      }
      if (kind === "block") {
        url = `/schedules/${row.id}/blocks`;
        body = {
          starts_at: unitInstant(s("starts_at"), timezone),
          ends_at: unitInstant(s("ends_at"), timezone),
          reason: why,
        };
      }
      if (["appointment", "encounter", "checkin"].includes(kind)) {
        if (!patient || f.get("confirmation") !== "on")
          throw new Error(
            "Selecione o paciente e confirme nome, nascimento e identificador.",
          );
        if (kind === "appointment") {
          url = "/appointments";
          body = {
            patient_id: patient.id,
            confirmed_patient_id: patient.id,
            schedule_id: row.id,
            starts_at: unitInstant(s("starts_at"), timezone),
          };
        } else {
          url = "/encounters";
          body = {
            patient_id: patient.id,
            confirmed_patient_id: patient.id,
            sector_id: s("sector_id"),
            modality: kind === "checkin" ? "ambulatorio" : s("modality"),
            ...(kind === "checkin" ? { appointment_id: row.id } : {}),
          };
        }
      }
      if (kind === "change_appointment") {
        url = "/appointments/" + row.id;
        method = "PATCH";
        body = {
          action,
          version: row.version,
          reason: why,
          ...(action === "reschedule"
            ? { starts_at: unitInstant(s("starts_at"), timezone) }
            : {}),
        };
      }
      if (kind === "transition") {
        url = `/encounters/${row.id}/transition`;
        body = {
          to: s("to"),
          version: row.version,
          reason: why,
          sector_id: s("sector_id"),
        };
      }
      if (kind === "bed") {
        url = "/beds";
        body = { code: s("code"), sector_id: s("sector_id") };
      }
      if (kind === "allocation") {
        url = `/beds/${row.id}/allocate`;
        body = {
          encounter_id: s("encounter_id"),
          mode: s("mode"),
          version: row.version,
          reason: why,
        };
      }
      if (
        ["cancel_reservation", "block_bed", "unblock", "clean"].includes(kind)
      ) {
        url = `/beds/${row.id}/state`;
        body = {
          action: kind === "block_bed" ? "block" : kind,
          version: row.version,
          reason: why,
        };
      }
      await write(url, body, method, key.current);
      setDirty(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sectorInput = (
    <label>
      Setor *
      <select
        name="sector_id"
        defaultValue={row?.sector_id || sectors[0]?.id || ""}
        required
      >
        <option value="" disabled>
          Selecione
        </option>
        {sectors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
  const startInput = (
    <label>
      Início no fuso {timezone} *
      <input
        name="starts_at"
        type="datetime-local"
        defaultValue={
          row?.starts_at ? unitLocal(row.starts_at, timezone) : undefined
        }
        required
      />
    </label>
  );
  return (
    <Modal title={titles[kind]} onClose={close}>
      {kind === "blocks" ? (
        <div className="modal-body">
          <h3>{row.name}</h3>
          {options.length ? (
            options.map((b) => (
              <article className="history-event" key={b.id}>
                <strong>
                  {format(b.starts_at, timezone)} —{" "}
                  {format(b.ends_at, timezone)}
                </strong>
                <p>{b.reason}</p>
              </article>
            ))
          ) : (
            <p>Nenhum bloqueio encontrado.</p>
          )}
          <ErrorNotice message={error} />
        </div>
      ) : (
        <form onSubmit={submit} onChange={touch}>
          <div className="modal-body">
            <span className="badge amber">Demonstração · Dados fictícios</span>
            {row && (
              <div className="selected-patient">
                <strong>{row.patient_name || row.code || row.name}</strong>
                {row.birth_date && <p>Nascimento: {birth(row.birth_date)}</p>}
                <small className="mono">
                  Registro: {row.id}
                  {row.patient_id ? " · Paciente: " + row.patient_id : ""}
                </small>
              </div>
            )}
            {kind === "room" && (
              <>
                <label>
                  Nome da sala *
                  <input name="name" minLength={2} maxLength={100} required />
                </label>
                {sectorInput}
              </>
            )}
            {kind === "schedule" && (
              <div className="form-grid">
                <label>
                  Nome da agenda *
                  <input name="name" minLength={3} maxLength={100} required />
                </label>
                <label>
                  Especialidade *
                  <input
                    name="specialty"
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  Sala *
                  <select name="room_id" required>
                    <option value="">Selecione</option>
                    {resources.rooms.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Profissional *
                  <select name="professional_id" required>
                    <option value="">Selecione</option>
                    {resources.professionals.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Duração em minutos *
                  <input
                    name="slot_minutes"
                    type="number"
                    min={5}
                    max={240}
                    defaultValue={30}
                    required
                  />
                </label>
                {startInput}
                <label>
                  Término no fuso {timezone} *
                  <input name="ends_at" type="datetime-local" required />
                </label>
              </div>
            )}
            {["appointment", "encounter"].includes(kind) && (
              <PatientPicker
                api={api}
                selected={patient}
                onPick={(v: any) => {
                  setPatient(v);
                  touch();
                }}
              />
            )}
            {["appointment", "encounter", "checkin"].includes(kind) && (
              <label className="checkbox spaced">
                <input type="checkbox" name="confirmation" required />
                Conferi nome, nascimento e identificador da pessoa selecionada.
              </label>
            )}
            {kind === "appointment" && (
              <>
                {startInput}
                <p>
                  A duração é de {row.slot_minutes} minutos. O servidor verifica
                  paciente, sala, profissional e bloqueios.
                </p>
              </>
            )}
            {kind === "block" && (
              <div className="form-grid">
                {startInput}
                <label>
                  Término *
                  <input name="ends_at" type="datetime-local" required />
                </label>
              </div>
            )}
            {["encounter", "checkin"].includes(kind) && (
              <>
                {sectorInput}
                {kind === "encounter" && (
                  <label>
                    Modalidade *
                    <select name="modality" required>
                      <option value="ambulatorio">Ambulatório</option>
                      <option value="pronto_atendimento">
                        Pronto atendimento
                      </option>
                      <option value="internacao">Internação</option>
                    </select>
                    <small>
                      A modalidade deve estar habilitada em Configurações.
                    </small>
                  </label>
                )}
              </>
            )}
            {kind === "change_appointment" && (
              <>
                <label>
                  Ação *
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="confirm">Confirmar</option>
                    <option value="reschedule">
                      Reagendar na mesma agenda
                    </option>
                    <option value="cancel">Cancelar</option>
                    <option value="no_show">Registrar falta</option>
                  </select>
                </label>
                {action === "reschedule" && startInput}
                <p>
                  Cancelamento e falta mantêm o histórico. Falta só é permitida
                  depois do horário final previsto.
                </p>
              </>
            )}
            {kind === "transition" && (
              <>
                <label>
                  Próxima etapa *
                  <select name="to" required>
                    {(transitions[row.status] || [])
                      .filter(([, perm]) => can(perm))
                      .map(([to]) => (
                        <option key={to} value={to}>
                          {names[to]}
                        </option>
                      ))}
                  </select>
                </label>
                {sectorInput}
                <p>
                  Esta é uma mudança operacional. Alta operacional encerra o
                  episódio e coloca o leito usado em higienização; não emite
                  resumo clínico de alta.
                </p>
              </>
            )}
            {kind === "bed" && (
              <>
                <label>
                  Código do leito *<input name="code" maxLength={50} required />
                </label>
                {sectorInput}
              </>
            )}
            {kind === "allocation" && (
              <>
                <label>
                  Buscar atendimento ativo
                  <input
                    value={lookup}
                    onChange={(e) => setLookup(e.target.value)}
                    placeholder="Nome ou identificador do atendimento"
                  />
                </label>
                <label>
                  Atendimento *
                  <select
                    name="encounter_id"
                    defaultValue={row.encounter_id || ""}
                    required
                  >
                    <option value="">Selecione e confira o atendimento</option>
                    {options.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.patient_name} · {birth(e.birth_date)} · {e.id} ·{" "}
                        {names[e.status]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ação *
                  <select
                    name="mode"
                    defaultValue={
                      row.state === "reserved" ? "occupy" : "reserve"
                    }
                  >
                    {row.state === "available" && (
                      <option value="reserve">Reservar</option>
                    )}
                    <option value="occupy">Ocupar</option>
                    {row.state === "available" && (
                      <option value="transfer">
                        Transferir de outro leito
                      </option>
                    )}
                  </select>
                </label>
                <p>
                  Ocupação exige episódio em atendimento ou observação.
                  Transferência deixa o leito anterior em higienização. As
                  operações não substituem decisão clínica de internação.
                </p>
              </>
            )}
            {[
              "block",
              "change_appointment",
              "transition",
              "allocation",
              "cancel_reservation",
              "block_bed",
              "unblock",
              "clean",
            ].includes(kind) && (
              <label>
                Justificativa *
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={300}
                  required
                />
              </label>
            )}
            <ErrorNotice message={error} />
            {discard && (
              <div className="notice">
                <div>
                  <strong>Existem alterações não salvas.</strong>
                  <p>Descartar somente este formulário?</p>
                  <button type="button" className="danger" onClick={onClose}>
                    Descartar formulário
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setDiscard(false)}
                  >
                    Continuar editando
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={busy}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Confirmando no servidor…" : "Confirmar operação"}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
