import React, { useEffect, useRef, useState } from "react";
type Props = {
  api: (url: string) => Promise<any>;
  write: (url: string, body: any, method?: string, key?: any) => Promise<any>;
  timezone: string;
};
export function BackupView({ api, write, timezone }: Props) {
  const [data, setData] = useState<any>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const load = () =>
    api("/backups")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const stamp = (v: string) =>
    v
      ? new Intl.DateTimeFormat("pt-BR", {
          timeZone: timezone,
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(v))
      : "—";
  async function run(id?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await write(
        id ? `/backups/${id}/verify` : "/backups",
        { reason },
        "POST",
        key.current,
      );
      key.current = crypto.randomUUID();
      setMessage(
        id
          ? "Restauração isolada verificada. O banco em uso foi preservado."
          : "Cópia criptografada criada. Verifique a restauração para validar seu conteúdo.",
      );
      await load();
    } catch (e: any) {
      setError(e.message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <h2>Cópias protegidas e restauração</h2>
      <p>
        Esta rotina cria uma cópia integral da base de demonstração,
        criptografada e guardada no servidor. A verificação restaura em um banco
        isolado e compara todas as tabelas. Não substitui a base em uso.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>Consultando cópias…</p>
      ) : (
        <>
          <p>{data.scope}</p>
          {!data.configured && (
            <p className="notice">
              A operação precisa configurar a chave de backup antes da primeira
              cópia. Consulte o manual de continuidade.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <label>
              Justificativa da rotina
              <input
                value={reason}
                minLength={5}
                maxLength={300}
                required
                onChange={(e) => {
                  setReason(e.target.value);
                  key.current = crypto.randomUUID();
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || data.busy || !data.configured}
            >
              {busy ? "Processando com segurança…" : "Criar cópia protegida"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Atualizar lista
            </button>
          </form>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Criação / identificação</th>
                  <th>Estado</th>
                  <th>Restauração</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      {stamp(m.createdAt)}
                      <br />
                      {m.id.slice(0, 12)}
                    </td>
                    <td>
                      {{
                        preparing: "Em preparação",
                        complete: "Cópia criada",
                        failed: "Falhou",
                      }[m.status as string] || m.status}
                      <br />
                      {m.bytes
                        ? `${new Intl.NumberFormat("pt-BR").format(m.bytes)} bytes`
                        : ""}
                    </td>
                    <td>
                      {m.verification?.status === "verified"
                        ? `Verificada em ${stamp(m.verification.verifiedAt)}`
                        : m.verification?.status === "failed"
                          ? "Verificação falhou"
                          : "Ainda não verificada"}
                    </td>
                    <td>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          m.status !== "complete" ||
                          reason.trim().length < 5
                        }
                        onClick={() => void run(m.id)}
                      >
                        Verificar restauração isolada
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.rows.length && (
            <p>
              Nenhuma cópia registrada nesta unidade. Informe uma justificativa
              para criar a primeira.
            </p>
          )}
          <p>
            As cópias incluem informações sensíveis e não são disponibilizadas
            por link público. Restauração definitiva é realizada pela operação
            em um diretório novo, seguindo o manual.
          </p>
        </>
      )}
    </div>
  );
}
