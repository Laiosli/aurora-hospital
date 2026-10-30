import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Inject,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { mkdir, writeFile, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { Database } from "./db";
import { Permit } from "./auth";
import { audit } from "./audit";
import { fingerprints } from "./snapshot";

const why = z.string().trim().min(5).max(300);
const digest = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
function directory() {
  return path.resolve(process.env.BACKUP_DIRECTORY || "./private-backups");
}
function key() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY || "";
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(raw) ||
    Buffer.from(raw, "base64").length !== 32
  )
    throw new ServiceUnavailableException(
      "Chave de backup não configurada. Consulte a operação.",
    );
  return Buffer.from(raw, "base64");
}
function permitted(req: any) {
  if (
    req.actor.role_id !== "ti" ||
    process.env.APP_ENV !== "demonstracao" ||
    process.env.DB_MODE === "postgres"
  )
    throw new ForbiddenException(
      "Rotina disponível para T.I na demonstração PGlite. Outros ambientes exigem rotina própria.",
    );
}
async function save(id: string, value: any) {
  const dir = directory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, id + "." + randomUUID() + ".tmp");
  await writeFile(tmp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(tmp, path.join(dir, id + ".json"));
}
async function manifest(id: string) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(id);
  try {
    return JSON.parse(
      await readFile(path.join(directory(), id + ".json"), "utf8"),
    );
  } catch {
    throw new NotFoundException("Cópia não encontrada.");
  }
}
export async function readBackup(id: string) {
  const m = await manifest(id);
  if (m.status !== "complete")
    throw new ConflictException("Cópia ainda não concluída ou com falha.");
  const packed = await readFile(path.join(directory(), id + ".enc"));
  if (digest(packed) !== m.sha256)
    throw new ConflictException(
      "Arquivo de backup alterado; restauração recusada.",
    );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    packed.subarray(0, 12),
  );
  decipher.setAuthTag(packed.subarray(12, 28));
  const sql = Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return { sql, manifest: m };
}
export async function verifyLogicalBackup(id: string) {
  const { sql, manifest: m } = await readBackup(id);
  const restored = new PGlite();
  try {
    await restored.exec(sql);
    const actual = await fingerprints(restored);
    if (JSON.stringify(actual) !== JSON.stringify(m.tables))
      throw new ConflictException(
        "Restauração divergiu do conteúdo registrado.",
      );
    return { tables: actual, verifiedAt: new Date().toISOString() };
  } finally {
    await restored.close();
  }
}
@ApiTags("Backups demonstrativos protegidos")
@Controller("api/backups")
export class BackupsController {
  private busy = false;
  constructor(@Inject(Database) private db: Database) {}
  @Get()
  @Permit("backups.manage")
  async list(@Req() req: any) {
    permitted(req);
    let files: string[] = [];
    try {
      files = await readdir(directory());
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const rows = [];
    for (const file of files.filter((f) => /^[a-f0-9]{64}\.json$/.test(f))) {
      const m = await manifest(file.slice(0, -5));
      if (m.unitId === req.actor.unitId) rows.push(m);
    }
    return {
      rows: rows
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50),
      busy: this.busy,
      configured: !!process.env.BACKUP_ENCRYPTION_KEY,
      scope:
        "Cópia integral do banco demonstrativo, protegida no servidor. Até 50 registros mais recentes.",
    };
  }
  @Post()
  @Permit("backups.manage")
  async create(@Req() req: any, @Body() body: any) {
    permitted(req);
    key();
    const b = z.object({ reason: why }).strict().parse(body);
    const idem = z
      .string()
      .min(16)
      .max(80)
      .parse(req.headers["idempotency-key"]);
    const id = digest(req.actor.id + ":" + req.actor.unitId + ":" + idem),
      hash = digest(JSON.stringify(b));
    let old;
    try {
      old = await manifest(id);
    } catch (e) {
      if (!(e instanceof NotFoundException)) throw e;
    }
    if (old) {
      if (old.requestHash !== hash)
        throw new ConflictException(
          "Chave de repetição usada com outra justificativa.",
        );
      return old;
    }
    if (this.busy)
      throw new ConflictException("Uma rotina de backup já está em andamento.");
    this.busy = true;
    const m: any = {
      id,
      unitId: req.actor.unitId,
      actorId: req.actor.id,
      createdAt: new Date().toISOString(),
      status: "preparing",
      reason: b.reason,
      requestHash: hash,
    };
    try {
      await save(id, m);
      await this.db.transaction((q) =>
        audit(q, req.actor, "backup.started", id, req.correlation, b.reason),
      );
      const { sql, tables } = await this.db.logicalDump();
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key(), iv);
      const encrypted = Buffer.concat([
        cipher.update(sql, "utf8"),
        cipher.final(),
      ]);
      const packed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
      await writeFile(path.join(directory(), id + ".enc"), packed, {
        flag: "wx",
        mode: 0o600,
      });
      Object.assign(m, {
        status: "complete",
        completedAt: new Date().toISOString(),
        bytes: packed.length,
        sha256: digest(packed),
        tables,
      });
      await save(id, m);
      await this.db.transaction((q) =>
        audit(q, req.actor, "backup.completed", id, req.correlation, b.reason),
      );
      return m;
    } catch {
      m.status = "failed";
      m.failure =
        "Rotina interrompida. Nenhuma confirmação de backup válido foi emitida.";
      await save(id, m);
      await this.db.transaction((q) =>
        audit(
          q,
          req.actor,
          "backup.failed",
          id,
          req.correlation,
          b.reason,
          "failed",
        ),
      );
      throw new ServiceUnavailableException(m.failure);
    } finally {
      this.busy = false;
    }
  }
  @Post(":id/verify")
  @Permit("backups.manage")
  async verify(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    permitted(req);
    const b = z.object({ reason: why }).strict().parse(body);
    const m = await manifest(id);
    if (m.unitId !== req.actor.unitId) throw new NotFoundException();
    if (this.busy) throw new ConflictException("Rotina em andamento.");
    this.busy = true;
    try {
      const result = await verifyLogicalBackup(id);
      m.verification = {
        status: "verified",
        verifiedAt: result.verifiedAt,
        tableCount: Object.keys(result.tables).length,
      };
      await save(id, m);
      await this.db.transaction((q) =>
        audit(
          q,
          req.actor,
          "backup.restore.verified",
          id,
          req.correlation,
          b.reason,
        ),
      );
      return m;
    } catch {
      m.verification = {
        status: "failed",
        checkedAt: new Date().toISOString(),
      };
      await save(id, m);
      await this.db.transaction((q) =>
        audit(
          q,
          req.actor,
          "backup.restore.failed",
          id,
          req.correlation,
          b.reason,
          "failed",
        ),
      );
      throw new ConflictException(
        "A cópia não passou na restauração isolada. Consulte a operação.",
      );
    } finally {
      this.busy = false;
    }
  }
}
