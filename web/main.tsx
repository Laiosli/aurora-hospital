import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  LayoutDashboard,
  Users,
  HeartPulse,
  Receipt,
  BriefcaseMedical,
  Stethoscope,
  Package,
  Search,
  Bell,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ArrowUpRight,
  ShieldCheck,
  LogOut,
  Star,
  Clock,
  Building2,
  Check,
  AlertTriangle,
  X,
  SlidersHorizontal,
  ArrowRight,
  LockKeyhole,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { navigation, livePermissions, serviceNames } from "./navigation";
import "./style.css";
import "./accessibility.css";
import { OperationsView, OperationalMetrics } from "./operations";
import { ClinicalView } from "./clinical";
import { BackupView } from "./backups";

let activeUnit = "";
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api(url: string, options: RequestInit = {}) {
  const res = await fetch("/api" + url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Aurora",
      ...(activeUnit ? { "X-Unit-Id": activeUnit } : {}),
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    if (res.status === 401 && activeUnit && !url.includes("login"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(body.message || "Operação indisponível.", res.status);
  }
  return body;
}
const write = (
  url: string,
  body: any,
  method = "POST",
  key = crypto.randomUUID(),
) =>
  api(url, {
    method,
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": key },
  });
const icons = [
  LayoutDashboard,
  Users,
  HeartPulse,
  Receipt,
  BriefcaseMedical,
  Stethoscope,
  Package,
];
const date = (value: any) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(String(value).slice(0, 10) + "T12:00:00Z"),
      )
    : "Não informado";
const timestamp = (v: string, tz = "America/Sao_Paulo") =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(v));
function Notice({ message }: { message: string }) {
  return message ? (
    <div className="notice" role="alert">
      <AlertTriangle size={17} />
      {message}
    </div>
  ) : null;
}
function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,[tabindex="0"]',
          ) || [],
        ).filter((el) => !el.hasAttribute("disabled"));
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Fechar" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [mfaRequired, setMfaRequired] = useState(true);
  useEffect(() => {
    api("/health")
      .then((r) => setMfaRequired(r.tiMfaRequired !== false))
      .catch(() => {});
  }, []);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await write("/auth/login", {
        email: f.get("email"),
        password: f.get("password"),
        otp: f.get("otp") || undefined,
      });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">GESTÃO QUE CONECTA O CUIDADO</span>
          <h1>
            Mais clareza.
            <br />
            Mais tempo
            <br />
            <em>para cuidar.</em>
          </h1>
          <p>
            Uma base integrada para as pessoas, os processos e os próximos
            passos da sua instituição.
          </p>
        </div>
        <span>Plataforma hospitalar · Recepção e registro clínico</span>
      </section>
      <section className="login-form">
        <Badge tone="amber">Ambiente de demonstração</Badge>
        <h2>Bem-vindo ao Aurora</h2>
        <p>Entre com sua conta individual para continuar.</p>
        <form onSubmit={submit}>
          <label>
            E-mail institucional
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="recepcao@demo.local"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {mfaRequired && (
            <label>
              Código MFA <small>Obrigatório para administração técnica</small>
              <input
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6 dígitos"
              />
            </label>
          )}
          <Notice message={error} />
          <button className="primary full" disabled={busy}>
            {busy ? "Validando acesso…" : "Entrar na plataforma"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="security-note">
          <LockKeyhole size={16} /> Acesso restrito e auditado. Utilize somente
          dados fictícios.
        </p>
        <details>
          <summary>Primeiro acesso à demonstração</summary>
          <p>
            A senha é definida pelo operador durante a instalação. Não há senha
            padrão. Consulte o README e o manual entregues com o sistema.
          </p>
        </details>
      </section>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Activity size={25} />
      </span>
      <div>
        aurora<span>GESTÃO HOSPITALAR</span>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false);
  const [unit, setUnit] = useState(""),
    [sector, setSector] = useState(""),
    [sectors, setSectors] = useState<any[]>([]),
    [page, setPage] = useState("Painel gerencial"),
    [group, setGroup] = useState(0),
    [collapsed, setCollapsed] = useState(false),
    [prefs, setPrefs] = useState<any>({}),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState("");
  const [health, setHealth] = useState<any>(null),
    [refresh, setRefresh] = useState(0),
    [remaining, setRemaining] = useState(30);
  const can = (p: string) => me?.permissions.includes(p);
  async function load() {
    try {
      const user = await api("/auth/me");
      setMe(user);
      setUnit(user.unitId);
      activeUnit = user.unitId;
      setPage("");
      setGroup(user.permissions.includes("patients.read") ? 1 : 0);
      setPrefs(await api("/preferences"));
      setExpired(false);
    } catch (e) {
      if ((e as ApiError).status !== 401) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const onExpire = () => {
      setMe(null);
      activeUnit = "";
      setExpired(true);
    };
    window.addEventListener("session-expired", onExpire);
    return () => window.removeEventListener("session-expired", onExpire);
  }, []);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    activeUnit = unit;
    setSectors([]);
    api("/sectors")
      .then((v) => {
        if (alive) {
          setSectors(v);
          setSector(v[0]?.id || "");
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [unit, me?.id, refresh]);
  useEffect(() => {
    if (!me) return;
    const run = () => {
      setRemaining(
        Math.max(
          0,
          Math.ceil((new Date(me.expires_at).getTime() - Date.now()) / 60000),
        ),
      );
      api("/health")
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    run();
    const t = setInterval(run, 30000);
    return () => clearInterval(t);
  }, [me]);
  async function savePrefs(value: any) {
    try {
      await write("/preferences", value, "PATCH");
      setPrefs((old: any) => ({ ...old, ...value }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(item: string, index?: number) {
    setPage(item);
    if (index !== undefined) setGroup(index);
    setError("");
    savePrefs({
      recent: [
        item,
        ...(prefs.recent || []).filter((v: string) => v !== item),
      ].slice(0, 6),
    });
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  function openPatientSearch(value: string) {
    setQuery(value);
    navigate("Cadastro de pacientes", 1);
    setSearch("");
  }
  if (loading) return <div className="loading">Carregando ambiente…</div>;
  if (!me)
    return (
      <>
        {expired && (
          <div className="session-banner" role="alert">
            Sua sessão expirou ou foi revogada. Entre novamente.
          </div>
        )}
        <Notice message={error} />
        <Login onLogin={load} />
      </>
    );
  const favorites = prefs.favorites || [];
  const unitName = me.units.find((u: any) => u.id === unit)?.name;
  const timezone = me.units.find((u: any) => u.id === unit)?.timezone;
  const groupIndex = page ? navigation.findIndex((n) => n.items.includes(page)) : group;
  function openModule(index: number) {
    setGroup(index); setPage(""); setError("");
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  const isLive = Boolean(livePermissions[page]);
  const authorized = isLive && can(livePermissions[page]);
  return (
    <div className={"shell " + (collapsed ? "collapsed" : "")}>
      <a href="#main" className="skip">
        Pular para o conteúdo
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace">
          <span className="workspace-icon">
            <Building2 size={20} />
          </span>
          <div>
            <strong>Instituição Aurora</strong>
            <small>Hospital demonstrativo</small>
          </div>
        </div>
        <div className="nav-label">ÁREA DE TRABALHO</div>
        <nav aria-label="Módulos principais">
          {navigation.map((module, i) => {
            const Icon = icons[i];
            return (
              <div key={module.name}>
                <button
                  className={"nav-module " + (group === i ? "active" : "")}
                  onClick={() => openModule(i)}
                  aria-current={group === i ? "page" : undefined}
                  title={module.name}
                >
                  <Icon size={26} />
                  <span>{module.name}</span>
                  <ChevronRight size={16} />
                </button>

              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure">
            <ShieldCheck size={18} />
            <span>
              Ambiente controlado<small>Somente dados fictícios</small>
            </span>
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="collapse-button"
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <>
                <PanelLeftClose size={18} />
                Recolher menu
              </>
            )}
          </button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="contexts">
            <label>
              <span>UNIDADE ATIVA</span>
              <select
                aria-label="Unidade ativa"
                value={unit}
                onChange={(e) => {
                  activeUnit = e.target.value;
                  setUnit(e.target.value);
                  setQuery("");
                  setRefresh((v) => v + 1);
                }}
              >
                {me.units.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sector">
              <span>SETOR</span>
              <select
                aria-label="Setor ativo"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                {sectors.length ? (
                  sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                ) : (
                  <option value="">Sem setor cadastrado</option>
                )}
              </select>
            </label>
          </div>
          <div className="header-actions">
            <Badge tone="amber">
              {health?.environment === "homologacao"
                ? "Homologação"
                : "Demonstração"}
            </Badge>
            <button
              className="icon"
              aria-label="Notificações"
              onClick={() => setModal("notifications")}
            >
              <Bell size={19} />
            </button>
            <button
              className="icon"
              aria-label="Ajuda contextual"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={19} />
            </button>
            <button
              className="avatar"
              aria-label="Abrir perfil"
              onClick={() => setModal("profile")}
            >
              {me.name.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="utility">
            <div className="breadcrumbs">
              Aurora <ChevronRight size={13} />
              <button className="module-back" onClick={() => openModule(groupIndex)}>{navigation[groupIndex]?.name}</button>
              {page && <><ChevronRight size={13} /><strong>{page}</strong></>}
            </div>
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="Busca global"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar páginas ou pacientes…"
              />
              {search && (
                <div className="search-results">
                  {Object.keys(livePermissions)
                    .filter(
                      (v) =>
                        can(livePermissions[v]) &&
                        v.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((v) => (
                      <button
                        key={v}
                        onClick={() => {
                          navigate(
                            v,
                            navigation.findIndex((n) => n.items.includes(v)),
                          );
                          setSearch("");
                        }}
                      >
                        {v}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  {can("patients.read") && (
                    <button onClick={() => openPatientSearch(search)}>
                      Buscar pacientes na unidade
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {remaining <= 5 && (
            <Notice
              message={`Sua sessão termina em aproximadamente ${remaining} minuto(s). Salve as alterações antes de entrar novamente.`}
            />
          )}
          <Notice message={error} />
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {navigation[groupIndex]?.name.toUpperCase()}
              </div>
              <h1>{page || navigation[groupIndex]?.name}</h1>
              <p>
                {!page ? "Selecione uma opção abaixo para abrir sua área de trabalho." : page === "Painel gerencial"
                  ? "Uma visão clara da base operacional da sua unidade."
                  : page === "Cadastro de pacientes"
                    ? "Identificação segura. Um cadastro para cada pessoa."
                    : "Informações e ações da unidade ativa, conforme seu perfil."}
              </p>
            </div>
            {page && <button
              className={
                "favorite " + (favorites.includes(page) ? "chosen" : "")
              }
              onClick={() =>
                savePrefs({
                  favorites: favorites.includes(page)
                    ? favorites.filter((v: string) => v !== page)
                    : [...favorites, page].slice(0, 20),
                })
              }
            >
              <Star
                size={17}
                fill={favorites.includes(page) ? "currentColor" : "none"}
              />
              {favorites.includes(page) ? "Favorito" : "Favoritar"}
            </button>}
          </div>
          {(favorites.length > 0 || prefs.recent?.length > 0) && (
            <div className="shortcuts">
              <span>
                <Clock size={13} /> Acesso rápido
              </span>
              {[...new Set<string>([...favorites, ...(prefs.recent || [])])]
                .filter((v) => v !== page && can(livePermissions[v]))
                .slice(0, 4)
                .map((v) => (
                  <button
                    key={v}
                    onClick={() =>
                      navigate(
                        v,
                        navigation.findIndex((n) => n.items.includes(v)),
                      )
                    }
                  >
                    {v}
                  </button>
                ))}
            </div>
          )}
          {!page ? (
            <section className="panel module-sheet" aria-label={"Opções de " + navigation[groupIndex]?.name}>
              <div className="module-tiles">
                {navigation[groupIndex]?.items.map((item) => {
                  const Icon = icons[groupIndex];
                  const permission = livePermissions[item];
                  const restricted = Boolean(permission) && !can(permission);
                  return <button key={item} className="module-tile" disabled={restricted} onClick={() => navigate(item, groupIndex)}>
                    <span className="module-tile-icon"><Icon size={36} aria-hidden="true" /></span>
                    <strong>{item}</strong>
                    <small>{!permission ? "Planejado · Não implementado" : restricted ? "Sem permissão" : "Abrir"}</small>
                  </button>;
                })}
              </div>
            </section>
          ) : !isLive ? (
            <div className="panel future">
              <span className="future-icon">
                <LockKeyhole size={30} />
              </span>
              <Badge tone="neutral">Planejado · Não implementado</Badge>
              <h2>{page}</h2>
              <p>
                Este fluxo pertence às próximas etapas. A navegação está
                mapeada, mas ainda não há operações disponíveis nesta versão.
              </p>
              <p>
                Consulte a matriz de requisitos e o plano de evolução entregues
                com o código.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  navigate(
                    can("patients.read")
                      ? "Cadastro de pacientes"
                      : "Unidades e setores",
                    can("patients.read") ? 1 : 0,
                  )
                }
              >
                Voltar às funcionalidades disponíveis
                <ArrowRight size={16} />
              </button>
            </div>
          ) : !authorized ? (
            <div className="panel future">
              <ShieldCheck size={32} />
              <h2>Acesso restrito ao seu perfil</h2>
              <p>
                Solicite ao responsável institucional a revisão das permissões,
                se necessário.
              </p>
            </div>
          ) : (
            <React.Fragment key={unit + page + refresh}>
              {["Prontuário", "Evoluções"].includes(page) && (
                <ClinicalView
                  api={api}
                  write={write}
                  Modal={Modal}
                  timezone={timezone}
                  self={me.id}
                  fullAccess={me.demoFullAccess}
                  can={can}
                />
              )}
              {[
                "Agendamentos",
                "Recepção e check-in",
                "Filas",
                "Atendimentos",
                "Internações e movimentações",
                "Leitos",
              ].includes(page) && (
                <OperationsView
                  page={page}
                  can={can}
                  sectors={sectors}
                  timezone={timezone}
                  api={api}
                  write={write}
                  Modal={Modal}
                />
              )}
              {(page === "Painel gerencial" ||
                page === "Indicadores assistenciais e operacionais") && (
                <Dashboard
                  navigate={navigate}
                  can={can}
                  unitName={unitName}
                  timezone={timezone}
                />
              )}
              {page === "Cadastro de pacientes" && (
                <Patients
                  query={query}
                  can={can}
                  prefs={prefs}
                  savePrefs={savePrefs}
                />
              )}
              {page === "Unidades e setores" && (
                <Structure
                  me={me}
                  sectors={sectors}
                  can={can}
                  onRefresh={() => {
                    api("/auth/me").then(setMe);
                    setRefresh((v) => v + 1);
                  }}
                />
              )}
              {page === "Usuários e permissões" && <UsersPage self={me.id} />}
              {page === "Configurações" && (
                <Settings editable={can("settings.write")} />
              )}
              {page === "Auditoria" && <Audit timezone={timezone} />}
              {page === "Gestão de backups" && (
                <BackupView api={api} write={write} timezone={timezone} />
              )}
              {page === "Integrações" && <Integrations />}
              {page === "Monitoramento operacional" && (
                <div className="panel">
                  <h2>Disponibilidade da aplicação</h2>
                  <p>
                    <Badge tone={health ? "green" : "red"}>
                      {health ? "API respondendo" : "API indisponível"}
                    </Badge>
                  </p>
                  <p>
                    Versão {health?.version || "indisponível"} · verificação a
                    cada 30 segundos.
                  </p>
                  <p>
                    Consulte Gestão de backups para criar cópias protegidas e
                    verificar restaurações isoladas. Monitoramento de disco e
                    rotinas automáticas ainda exige configuração operacional.
                  </p>
                  <button
                    className="secondary"
                    onClick={() =>
                      api("/health")
                        .then(setHealth)
                        .catch(() => setHealth(null))
                    }
                  >
                    <RefreshCw size={16} />
                    Verificar API
                  </button>
                </div>
              )}
            </React.Fragment>
          )}
          <footer className="page-footer">
            <span>
              <span className={"status-dot " + (!health ? "offline" : "")} />
              {health ? "API disponível" : "API indisponível"}
              <span className="separator">·</span>Integrações externas não
              configuradas
            </span>
            <span>Aurora v0.4 · Base de demonstração</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === "help"
              ? "Ajuda · " + page
              : modal === "profile"
                ? "Seu acesso"
                : "Central de notificações"
          }
          onClose={() => setModal("")}
        >
          {modal === "help" ? (
            <div className="modal-body">
              <h3>Trabalhando com segurança</h3>
              <p>
                Confirme a unidade ativa antes de consultar ou gravar dados. No
                cadastro, use nome completo e data de nascimento para
                diferenciar homônimos.
              </p>
              <p>
                Identificações provisórias permitem cadastro sem documentação. A
                edição exige justificativa e mantém a versão para detectar
                conflitos.
              </p>
              <p>
                Somente as ações autorizadas no servidor são permitidas. Os
                itens marcados como planejados ainda não estão disponíveis.
              </p>
              <p>
                Esta demonstração não oferece atendimento clínico, assinatura
                digital ou integrações externas. Consulte o manual em
                docs/03-operacao.md.
              </p>
            </div>
          ) : modal === "profile" ? (
            <div className="modal-body">
              <h3>{me.name}</h3>
              <p>{me.email}</p>
              <Badge>{me.role_name}</Badge>
              <p>Sessão válida até {timestamp(me.expires_at, timezone)}.</p>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await write("/auth/logout", {});
                    setMe(null);
                    activeUnit = "";
                    setModal("");
                  } catch (e) {
                    setError((e as Error).message);
                    setModal("");
                  }
                }}
              >
                <LogOut size={16} />
                Sair da sessão
              </button>
            </div>
          ) : (
            <div className="modal-body">
              <p>Nenhum evento assistencial é gerado nesta etapa.</p>
              <div className="notification">
                <ShieldCheck />
                <div>
                  <strong>Confira seu contexto de trabalho</strong>
                  <p>
                    Revise a unidade e o setor antes de iniciar os cadastros.
                  </p>
                  <button
                    onClick={() => {
                      setModal("");
                      navigate("Unidades e setores", 0);
                    }}
                  >
                    Consultar estrutura <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              <div className="notification">
                <Activity />
                <div>
                  <strong>Integrações não configuradas</strong>
                  <p>Não há envio de informações a sistemas externos.</p>
                  <button
                    onClick={() => {
                      setModal("");
                      navigate("Integrações", 0);
                    }}
                  >
                    Ver dependências <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Dashboard({ navigate, can, unitName, timezone }: any) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="hero">
        <div>
          <Badge tone="light">BASE OPERACIONAL</Badge>
          <h2>
            Cada informação conectada.
            <br />
            Cada acesso com responsabilidade.
          </h2>
          <p>Estrutura, cadastros e governança em um único lugar.</p>
          <button
            onClick={() =>
              navigate(
                can("patients.read")
                  ? "Cadastro de pacientes"
                  : "Unidades e setores",
                can("patients.read") ? 1 : 0,
              )
            }
          >
            {can("patients.read") ? "Acessar pacientes" : "Consultar estrutura"}
            <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="cross">
            <Activity size={62} strokeWidth={1.25} />
          </div>
          <span className="orbit-label one">
            <ShieldCheck size={16} />
            Acesso por perfil
          </span>
          <span className="orbit-label two">
            <CheckCircle2 size={16} />
            Dados persistidos
          </span>
        </div>
      </div>
      <div className="section-heading">
        <h2>Retrato da unidade</h2>
        <span>{unitName} · Todos os cadastros</span>
      </div>
      <Notice message={error} />
      <div className="stats">
        {[
          { key: "patients", title: "Pacientes cadastrados", icon: Users },
          {
            key: "provisional",
            title: "Identificações provisórias",
            icon: ShieldCheck,
          },
          { key: "sectors", title: "Setores ativos", icon: Building2 },
        ].map(({ key, title, icon: Icon }) => (
          <article className="stat" key={key}>
            <div>
              <span>{title}</span>
              <Icon size={19} />
            </div>
            <strong>{data ? data[key].toLocaleString("pt-BR") : "—"}</strong>
            <p>
              {data?.definitions[key] || "Aguardando consulta ao servidor."}
            </p>
          </article>
        ))}
      </div>
      <OperationalMetrics api={api} timezone={timezone} />
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Seu próximo passo</h2>
            <Badge>Fundação disponível</Badge>
          </div>
          {[
            {
              name: "Unidades e setores",
              text: "Organize os contextos de trabalho.",
              i: 0,
              permission: "structure.read",
              icon: Building2,
            },
            {
              name: "Cadastro de pacientes",
              text: "Consulte, cadastre e confira identificadores.",
              i: 1,
              permission: "patients.read",
              icon: Users,
            },
            {
              name: "Usuários e permissões",
              text: "Gerencie acessos e revogue sessões.",
              i: 0,
              permission: "users.read",
              icon: ShieldCheck,
            },
          ]
            .filter((v) => can(v.permission))
            .map(({ name, text, i, icon: Icon }) => (
              <button
                className="action-row"
                key={name}
                onClick={() => navigate(name, i)}
              >
                <span className="action-icon">
                  <Icon size={21} />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{text}</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
        </section>
        <section className="panel roadmap">
          <div className="eyebrow">CONSTRUÇÃO RESPONSÁVEL</div>
          <h2>Uma base para evoluir.</h2>
          <p>
            O fluxo assistencial completo será desenvolvido nas próximas etapas,
            com validação de cada área.
          </p>
          <div>
            <CheckCircle2 size={18} />
            <span>01 · Fundação e cadastros</span>
            <Badge>Atual</Badge>
          </div>
          <div>
            <span className="step-number">2</span>
            <span>Recepção, agendas e leitos</span>
            <Badge>Operação disponível</Badge>
          </div>
          <div>
            <span className="step-number">3</span>
            <span>Prontuário e assistência</span>
          </div>
          <div>
            <span className="step-number">4+</span>
            <span>Farmácia, contas e integrações</span>
          </div>
        </section>
      </div>
      <p className="data-source">
        Origem: {data?.source || "aguardando consulta"} · {data?.period} ·
        Atualização: {data ? timestamp(data.updatedAt, timezone) : "—"}.
        Indicadores clínicos e financeiros ainda não implementados.
      </p>
    </>
  );
}

const emptyPatient = {
  name: "",
  social_name: "",
  birth_date: "",
  provisional: false,
  cpf: "",
  cns: "",
  phone: "",
  mother_name: "",
  emergency_contact: "",
  accessibility: "",
};
function Patients({ query, can, prefs, savePrefs }: any) {
  const [q, setQ] = useState(query),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("name"),
    [direction, setDirection] = useState("asc"),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<any>(null),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [showColumns, setShowColumns] = useState(false),
    [success, setSuccess] = useState("");
  const columns = prefs.columns || ["birth", "status", "id"];
  useEffect(() => {
    setQ(query);
    setPage(1);
  }, [query]);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = setTimeout(
      () =>
        api(
          `/patients?q=${encodeURIComponent(q)}&page=${page}&sort=${sort}&direction=${direction}`,
        )
          .then((v) => {
            if (alive) {
              setResult(v);
              setError("");
            }
          })
          .catch((e) => {
            if (alive) setError(e.message);
          })
          .finally(() => {
            if (alive) setBusy(false);
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, page, sort, direction, refresh]);
  async function open(id: string) {
    try {
      setEditor(await api("/patients/" + id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Buscar pacientes"
              placeholder="Nome, identificador, CPF ou CNS"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="toolbar-actions">
            <select
              aria-label="Ordenar pacientes"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">Nome</option>
              <option value="created_at">Data de cadastro</option>
            </select>
            <button
              className="secondary compact"
              aria-label="Alternar ordem"
              onClick={() =>
                setDirection((v) => (v === "asc" ? "desc" : "asc"))
              }
            >
              {direction === "asc" ? "↑ A–Z" : "↓ Z–A"}
            </button>
            <button
              className="secondary"
              onClick={() => setShowColumns(!showColumns)}
            >
              <SlidersHorizontal size={16} />
              Colunas
            </button>
            {can("patients.create") && (
              <button
                className="primary"
                onClick={() => {
                  setSuccess("");
                  setEditor({});
                }}
              >
                <Plus size={17} />
                Novo paciente
              </button>
            )}
          </div>
        </div>
        {showColumns && (
          <div className="column-options">
            {[
              ["birth", "Nascimento"],
              ["status", "Identificação"],
              ["id", "Identificador"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={columns.includes(key)}
                  onChange={() =>
                    savePrefs({
                      columns: columns.includes(key)
                        ? columns.filter((c: string) => c !== key)
                        : [...columns, key],
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <Notice message={error} />
        {success && (
          <div className="success" role="status">
            <CheckCircle2 size={17} />
            {success}
          </div>
        )}
        <div className="table-wrap" aria-busy={busy}>
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                {columns.includes("birth") && <th>Nascimento</th>}
                {columns.includes("id") && <th>Identificador interno</th>}
                {columns.includes("status") && <th>Identificação</th>}
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!busy &&
                result?.rows.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="patient-cell">
                        <span className="patient-avatar">
                          {p.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          {p.social_name && (
                            <small>Nome social: {p.social_name}</small>
                          )}
                          {p.homonym && (
                            <small className="homonym">
                              <AlertTriangle size={12} />
                              Homônimo · confira nascimento e ID
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    {columns.includes("birth") && <td>{date(p.birth_date)}</td>}
                    {columns.includes("id") && (
                      <td className="mono">
                        {p.id.slice(0, 8)}
                        <small title={p.id}>
                          Identificador completo no cadastro
                        </small>
                      </td>
                    )}
                    {columns.includes("status") && (
                      <td>
                        <Badge tone={p.provisional ? "amber" : "green"}>
                          {p.provisional ? "Provisória" : "Identificada"}
                        </Badge>
                      </td>
                    )}
                    <td>
                      <button className="table-link" onClick={() => open(p.id)}>
                        Consultar
                        <ArrowUpRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {busy ? (
            <div className="empty" role="status">
              Consultando registros…
            </div>
          ) : result?.rows.length === 0 ? (
            <div className="empty">
              <Users size={28} />
              <h3>Nenhum paciente encontrado</h3>
              <p>Ajuste os filtros ou cadastre uma pessoa nesta unidade.</p>
            </div>
          ) : null}
        </div>
        <div className="pagination">
          <span>{result?.total ?? 0} registros · 10 por página</span>
          <div>
            <button
              className="secondary compact"
              disabled={page === 1 || busy}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              className="secondary compact"
              disabled={busy || page * 10 >= (result?.total || 0)}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
      <div className="info-strip">
        <ShieldCheck size={19} />
        <p>
          <strong>Confirme a pessoa, não apenas o nome.</strong> Identificações
          provisórias são permitidas. CPF e CNS não são obrigatórios para o
          cadastro.
        </p>
      </div>
      {editor && (
        <PatientEditor
          patient={editor}
          editable={editor.id ? can("patients.update") : can("patients.create")}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRefresh((v) => v + 1);
            setSuccess("Cadastro salvo e auditado no servidor.");
          }}
        />
      )}
    </>
  );
}
function PatientEditor({ patient, editable, onClose, onSaved }: any) {
  const [form, setForm] = useState<any>({
      ...emptyPatient,
      ...patient,
      birth_date: patient.birth_date
        ? String(patient.birth_date).slice(0, 10)
        : "",
      cpf: patient.cpf || "",
      cns: patient.cns || "",
    }),
    [reason, setReason] = useState(""),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const key = useRef(crypto.randomUUID());
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
  const close = React.useCallback(() => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, busy, onClose]);
  function update(k: string, v: any) {
    setDirty(true);
    key.current = crypto.randomUUID();
    setForm((f: any) => ({ ...f, [k]: v }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const b: any = {};
    for (const k of Object.keys(emptyPatient)) b[k] = form[k];
    b.birth_date = b.birth_date || null;
    b.cpf = b.cpf || null;
    b.cns = b.cns || null;
    if (patient.id) {
      b.version = patient.version;
      b.reason = reason;
    }
    try {
      await write(
        "/patients" + (patient.id ? "/" + patient.id : ""),
        b,
        patient.id ? "PATCH" : "POST",
        key.current,
      );
      setDirty(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={patient.id ? "Cadastro do paciente" : "Novo paciente"}
      onClose={close}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-caption">
            <Badge tone="amber">Dados fictícios · Demonstração</Badge>
            {patient.id && (
              <span className="mono">
                ID: {patient.id} · v{patient.version}
              </span>
            )}
          </div>
          <h3>Identificação</h3>
          <p className="muted">
            Confira nome completo e nascimento antes de salvar.
          </p>
          <div className="form-grid">
            <label className="span2">
              Nome completo ou identificação provisória *
              <input
                autoFocus
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                minLength={3}
                maxLength={160}
                disabled={!editable}
              />
            </label>
            <label>
              Nome social
              <input
                value={form.social_name}
                onChange={(e) => update("social_name", e.target.value)}
                maxLength={160}
                disabled={!editable}
              />
            </label>
            <label>
              Data de nascimento{!form.provisional ? " *" : ""}
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => update("birth_date", e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                required={!form.provisional}
                disabled={!editable}
              />
            </label>
            <label className="checkbox span2">
              <input
                type="checkbox"
                checked={form.provisional}
                onChange={(e) => update("provisional", e.target.checked)}
                disabled={!editable}
              />
              Identificação provisória — dados ainda não confirmados
            </label>
            <label>
              CPF <small>Opcional</small>
              <input
                value={form.cpf}
                onChange={(e) => update("cpf", e.target.value)}
                inputMode="numeric"
                maxLength={18}
                disabled={!editable}
              />
            </label>
            <label>
              CNS <small>Opcional</small>
              <input
                value={form.cns}
                onChange={(e) => update("cns", e.target.value)}
                inputMode="numeric"
                maxLength={20}
                disabled={!editable}
              />
            </label>
            <label className="span2">
              Filiação — nome da mãe
              <input
                value={form.mother_name}
                onChange={(e) => update("mother_name", e.target.value)}
                maxLength={160}
                disabled={!editable}
              />
            </label>
          </div>
          <h3>Contato e acessibilidade</h3>
          <div className="form-grid">
            <label>
              Telefone
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                maxLength={30}
                disabled={!editable}
              />
            </label>
            <label>
              Contato de emergência
              <input
                value={form.emergency_contact}
                onChange={(e) => update("emergency_contact", e.target.value)}
                maxLength={200}
                disabled={!editable}
              />
            </label>
            <label className="span2">
              Necessidades de acessibilidade
              <textarea
                value={form.accessibility}
                onChange={(e) => update("accessibility", e.target.value)}
                maxLength={500}
                disabled={!editable}
              />
            </label>
            {patient.id && editable && (
              <label className="span2">
                Justificativa da alteração *
                <input
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setDirty(true);
                    key.current = crypto.randomUUID();
                  }}
                  required
                  minLength={5}
                  maxLength={300}
                  placeholder="Descreva o motivo, sem informações clínicas desnecessárias"
                />
              </label>
            )}
          </div>
          <Notice message={error} />
          {confirmClose && (
            <div className="notice">
              <div>
                <strong>Há alterações não salvas.</strong>
                <p>Deseja descartar o que foi digitado?</p>
                <button type="button" className="danger" onClick={onClose}>
                  Descartar alterações
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmClose(false)}
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
            Fechar
          </button>
          {editable && (
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Salvar cadastro"}
              <Check size={17} />
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}

function Structure({ me, sectors, can, onRefresh }: any) {
  const [kind, setKind] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await write(
        kind === "Unidade" ? "/units" : "/sectors",
        kind === "Unidade"
          ? { name: f.get("name"), timezone: f.get("timezone") }
          : { name: f.get("name") },
      );
      setKind("");
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="structure-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Unidades autorizadas</h2>
            {can("structure.write") && (
              <button
                className="secondary"
                onClick={() => {
                  setError("");
                  setKind("Unidade");
                }}
              >
                <Plus size={16} />
                Unidade
              </button>
            )}
          </div>
          {me.units.map((u: any) => (
            <div className="structure-card" key={u.id}>
              <Building2 size={22} />
              <div>
                <strong>{u.name}</strong>
                <small>{u.timezone}</small>
              </div>
              <Badge>Ativa</Badge>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Setores da unidade ativa</h2>
            {can("structure.write") && (
              <button
                className="secondary"
                onClick={() => {
                  setError("");
                  setKind("Setor");
                }}
              >
                <Plus size={16} />
                Setor
              </button>
            )}
          </div>
          {sectors.length ? (
            sectors.map((s: any) => (
              <div className="structure-card" key={s.id}>
                <span className="action-icon">
                  <BriefcaseMedical size={19} />
                </span>
                <strong>{s.name}</strong>
                <Badge>Ativo</Badge>
              </div>
            ))
          ) : (
            <p>Nenhum setor cadastrado.</p>
          )}
        </section>
      </div>
      {kind && (
        <Modal
          title={"Cadastrar " + kind.toLowerCase()}
          onClose={() => !busy && setKind("")}
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              <label>
                Nome *
                <input name="name" required minLength={3} maxLength={100} />
              </label>
              {kind === "Unidade" && (
                <label>
                  Fuso horário IANA *
                  <input
                    name="timezone"
                    defaultValue="America/Sao_Paulo"
                    required
                  />
                </label>
              )}
              <Notice message={error} />
            </div>
            <footer className="modal-footer">
              <button className="primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar " + kind.toLowerCase()}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function UsersPage({ self }: { self: string }) {
  const [users, setUsers] = useState<any[]>([]),
    [roles, setRoles] = useState<any[]>([]),
    [editor, setEditor] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = () =>
    Promise.all([api("/users"), api("/roles")])
      .then(([u, r]) => {
        setUsers(u);
        setRoles(r);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (editor.revoke)
        await write(`/users/${editor.id}/revoke`, { reason: f.get("reason") });
      else if (editor.id)
        await write(
          "/users/" + editor.id,
          {
            active: f.get("active") === "on",
            role_id: f.get("role_id"),
            reason: f.get("reason"),
          },
          "PATCH",
        );
      else
        await write("/users", {
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password"),
          role_id: f.get("role_id"),
        });
      setEditor(null);
      setNotice(
        "Operação confirmada e auditada. Alterações de acesso revogam as sessões existentes.",
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel table-panel">
        <div className="table-toolbar">
          <h2>Contas individuais</h2>
          <button
            className="primary"
            onClick={() => {
              setError("");
              setEditor({});
            }}
          >
            <Plus size={16} />
            Novo usuário
          </button>
        </div>
        {!editor && <Notice message={error} />}
        <p className="inset muted">
          O perfil técnico administra acessos, sem permissão para consultar
          pacientes ou prontuários.
        </p>
        {notice && (
          <div className="success" role="status">
            {notice}
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Perfil</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </td>
                  <td>{roles.find((r) => r.id === u.role_id)?.name}</td>
                  <td>
                    <Badge tone={u.active ? "green" : "neutral"}>
                      {u.active ? "Ativo" : "Desativado"}
                    </Badge>
                  </td>
                  <td>
                    <div className="inline-actions">
                      {u.id !== self && u.role_id !== "ti" && (
                        <button
                          className="table-link"
                          onClick={() => {
                            setError("");
                            setEditor(u);
                          }}
                        >
                          Alterar acesso
                        </button>
                      )}
                      <button
                        className="table-link"
                        onClick={() => {
                          setError("");
                          setEditor({ ...u, revoke: true });
                        }}
                      >
                        Revogar sessões
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <section className="panel spaced">
        <h2>Permissões efetivas dos perfis</h2>
        <p className="muted">
          Códigos verificados pelo servidor. Fluxos futuros não recebem
          permissões antecipadas.
        </p>
        <div className="role-list">
          {roles.map((r) => (
            <div key={r.id}>
              <strong>{r.name}</strong>
              <small>{r.permissions.join(" · ")}</small>
            </div>
          ))}
        </div>
      </section>
      {editor && (
        <Modal
          title={
            editor.revoke
              ? "Revogar sessões"
              : editor.id
                ? "Alterar acesso"
                : "Novo usuário"
          }
          onClose={() => !busy && setEditor(null)}
        >
          <form onSubmit={submit}>
            <div className="modal-body">
              {editor.revoke ? (
                <p>
                  Todas as sessões de <strong>{editor.name}</strong> serão
                  encerradas. A ação será auditada.
                </p>
              ) : (
                <>
                  {!editor.id && (
                    <>
                      <label>
                        Nome *
                        <input
                          name="name"
                          minLength={3}
                          maxLength={160}
                          required
                        />
                      </label>
                      <label>
                        E-mail *<input name="email" type="email" required />
                      </label>
                      <label>
                        Senha inicial *
                        <input
                          name="password"
                          type="password"
                          minLength={14}
                          maxLength={128}
                          autoComplete="new-password"
                          required
                        />
                        <small>
                          Mínimo de 14 caracteres. Transmita por canal
                          institucional seguro.
                        </small>
                      </label>
                    </>
                  )}
                  <label>
                    Perfil *
                    <select
                      name="role_id"
                      defaultValue={editor.role_id || "recepcao"}
                    >
                      {roles
                        .filter((r) => r.id !== "ti")
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {editor.id && (
                    <label className="checkbox">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={editor.active}
                      />
                      Acesso ativo
                    </label>
                  )}
                </>
              )}
              {editor.id && (
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
              <Notice message={error} />
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Confirmando…" : "Confirmar operação"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function Settings({ editable }: { editable: boolean }) {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  useEffect(() => {
    api("/settings")
      .then(setValue)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuccess("");
    try {
      setValue(
        await write(
          "/settings",
          { services: value.services, version: value.version, reason },
          "PATCH",
        ),
      );
      setReason("");
      setSuccess("Serviços configurados e alteração auditada.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Serviços oferecidos pela instituição</h2>
      <p className="muted">
        Configuração da unidade ativa. Marcar um serviço não implementa o
        respectivo fluxo. Cadastros, agendas e movimentações operacionais estão
        disponíveis; prontuário e demais recursos assistenciais ainda dependem
        das próximas etapas.
      </p>
      <Notice message={error} />
      {success && (
        <div className="success" role="status">
          {success}
        </div>
      )}
      {value ? (
        <form onSubmit={submit}>
          <div className="service-grid">
            {Object.entries(serviceNames).map(([id, name]) => (
              <label className="service" key={id}>
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={value.services.includes(id)}
                  onChange={() => {
                    setValue({
                      ...value,
                      services: value.services.includes(id)
                        ? value.services.filter((v: string) => v !== id)
                        : [...value.services, id],
                    });
                    setSuccess("");
                  }}
                />
                <span>
                  <strong>{name}</strong>
                  <small>
                    {[
                      "recepcao",
                      "ambulatorio",
                      "internacao",
                      "pronto_atendimento",
                    ].includes(id)
                      ? "Cadastro e fluxo operacional disponíveis; assistência clínica pendente"
                      : "Fluxo operacional em etapa futura"}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {editable && (
            <>
              <label>
                Motivo da configuração *
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={5}
                  maxLength={300}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Salvando…" : "Salvar configuração"}
              </button>
            </>
          )}
        </form>
      ) : (
        <p>Carregando configuração…</p>
      )}
    </section>
  );
}
function Audit({ timezone }: { timezone: string }) {
  const [data, setData] = useState<any>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    api("/audit?page=" + page)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [page]);
  return (
    <div className="panel table-panel">
      <div className="table-toolbar">
        <h2>Eventos da unidade</h2>
        <Badge>
          <ShieldCheck size={13} />
          Trilha somente de inclusão
        </Badge>
      </div>
      <p className="inset muted">
        Eventos com autoria, recurso, correlação e hash encadeado. A proteção
        externa contra alterações por administradores do banco depende da
        infraestrutura.
      </p>
      <Notice message={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data / hora</th>
              <th>Responsável</th>
              <th>Ação e recurso</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((a: any) => (
              <tr key={a.id}>
                <td>{timestamp(a.created_at, timezone)}</td>
                <td>{a.actor || "Sistema"}</td>
                <td>
                  <strong>{a.action}</strong>
                  <small className="mono">{a.resource}</small>
                  <details>
                    <summary>Rastreabilidade</summary>
                    <small>
                      Correlação: {a.correlation_id}
                      <br />
                      Hash: {a.hash}
                      <br />
                      Justificativa: {a.reason || "Não aplicável"}
                    </small>
                  </details>
                </td>
                <td>
                  <Badge tone={a.result === "success" ? "green" : "amber"}>
                    {a.result === "success" ? "Concluído" : "Negado"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && <div className="empty">Carregando eventos…</div>}
      </div>
      <div className="pagination">
        <span>{data?.total || 0} eventos</span>
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
            disabled={!data || page * 10 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
function Integrations() {
  return (
    <div className="panel">
      <h2>Conectores externos</h2>
      <p className="muted">
        Nenhuma integração externa foi configurada, simulada ou homologada. Não
        há transmissão de dados.
      </p>
      <div className="integration-grid">
        {[
          "Laboratório / LIS",
          "Imagem / PACS / RIS",
          "Operadoras / TISS",
          "Produção SUS",
          "Contabilidade",
          "Identidade / SSO",
          "Mensageria",
          "Impressão e identificação",
        ].map((name) => (
          <div key={name}>
            <span className="action-icon">
              <Activity size={19} />
            </span>
            <h3>{name}</h3>
            <Badge tone="neutral">Não configurado</Badge>
            <p>
              Depende de contrato, especificação, credenciais e testes de
              homologação.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
