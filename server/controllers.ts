import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  Inject,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiHeader } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, SQL } from "./db";
import { Permit } from "./auth";
import { audit } from "./audit";
import { digest, hashPassword, validCPF, validCNS } from "./security";

const uuid = z.uuid();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return (
      !isNaN(+d) &&
      d.toISOString().slice(0, 10) === v &&
      v <= new Date().toISOString().slice(0, 10) &&
      v >= "1850-01-01"
    );
  }, "Data de nascimento inválida ou futura.");
const patientSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    social_name: z.string().trim().max(160).default(""),
    birth_date: date.nullable(),
    provisional: z.boolean(),
    cpf: z
      .string()
      .nullable()
      .transform((v) => v?.replace(/\D/g, "") || null)
      .refine((v) => !v || validCPF(v), "CPF inválido."),
    cns: z
      .string()
      .nullable()
      .transform((v) => v?.replace(/\D/g, "") || null)
      .refine((v) => !v || validCNS(v), "CNS inválido."),
    phone: z.string().max(30).default(""),
    mother_name: z.string().max(160).default(""),
    emergency_contact: z.string().max(200).default(""),
    accessibility: z.string().max(500).default(""),
  })
  .strict()
  .refine(
    (v) => v.provisional || v.birth_date !== null,
    "Informe nascimento ou marque identificação provisória.",
  );
const pageSchema = z.object({
  q: z.string().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(["name", "created_at"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
export async function mutation(
  db: Database,
  req: any,
  body: unknown,
  run: (q: SQL) => Promise<any>,
) {
  const key = z.string().min(16).max(80).parse(req.headers["idempotency-key"]);
  const hash = digest(
    req.method + req.path + req.actor.unitId + JSON.stringify(body),
  );
  return db.transaction(async (q) => {
    await q.query("LOCK TABLE idempotency IN EXCLUSIVE MODE");
    const old = (
      await q.query("SELECT * FROM idempotency WHERE user_id=$1 AND key=$2", [
        req.actor.id,
        key,
      ])
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash)
        throw new ConflictException(
          "Chave de repetição usada com outro conteúdo.",
        );
      return old.response;
    }
    const result = await run(q);
    await q.query(
      "INSERT INTO idempotency(user_id,key,request_hash,response) VALUES($1,$2,$3,$4)",
      [req.actor.id, key, hash, JSON.stringify(result)],
    );
    return result;
  });
}
@ApiHeader({
  name: "X-Unit-Id",
  required: false,
  description: "Unidade ativa, sempre validada contra os vínculos do usuário",
})
@ApiTags("Cadastros de pacientes")
@Controller("api/patients")
export class PatientsController {
  constructor(@Inject(Database) private db: Database) {}
  @Permit("patients.read")
  @Get()
  @ApiOperation({
    summary: "Busca paginada no servidor por nome, UUID, CPF ou CNS",
  })
  async list(@Query() query: any, @Req() req: any) {
    const p = pageSchema.parse(query);
    const values = [req.actor.unitId, "%" + p.q.toLowerCase() + "%"];
    const filter =
      "unit_id=$1 AND (lower(name) LIKE $2 OR lower(social_name) LIKE $2 OR id::text LIKE $2 OR cpf LIKE $2 OR cns LIKE $2)";
    return this.db.transaction(async (q) => {
      const total = Number(
        (
          await q.query(
            `SELECT count(*) AS n FROM patients WHERE ${filter}`,
            values,
          )
        ).rows[0].n,
      );
      const rows = (
        await q.query(
          `SELECT id,name,social_name,birth_date,provisional,version,created_at,(SELECT count(*) FROM patients other WHERE other.unit_id=p.unit_id AND lower(other.name)=lower(p.name))>1 AS homonym FROM patients p WHERE ${filter} ORDER BY ${p.sort} ${p.direction},id LIMIT $3 OFFSET $4`,
          [...values, p.size, (p.page - 1) * p.size],
        )
      ).rows;
      await audit(q, req.actor, "patients.search", "patients", req.correlation);
      return { rows, total, page: p.page, size: p.size };
    });
  }
  @Permit("patients.read") @Get(":id") async get(
    @Param("id") id: string,
    @Req() req: any,
  ) {
    uuid.parse(id);
    return this.db.transaction(async (q) => {
      const patient = (
        await q.query("SELECT * FROM patients WHERE id=$1 AND unit_id=$2", [
          id,
          req.actor.unitId,
        ])
      ).rows[0];
      if (!patient)
        throw new NotFoundException("Cadastro não encontrado nesta unidade.");
      await audit(q, req.actor, "patients.read", id, req.correlation);
      return patient;
    });
  }
  @Permit("patients.create")
  @Post()
  @ApiOperation({
    summary: "Cadastrar paciente; exige Idempotency-Key; documentos opcionais",
  })
  async create(@Body() body: unknown, @Req() req: any) {
    const p = patientSchema.parse(body);
    return mutation(this.db, req, p, async (q) => {
      const id = randomUUID();
      const row = (
        await q.query(
          "INSERT INTO patients(id,unit_id,name,social_name,birth_date,provisional,cpf,cns,phone,mother_name,emergency_contact,accessibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
          [
            id,
            req.actor.unitId,
            p.name,
            p.social_name,
            p.birth_date,
            p.provisional,
            p.cpf,
            p.cns,
            p.phone,
            p.mother_name,
            p.emergency_contact,
            p.accessibility,
          ],
        )
      ).rows[0];
      await audit(q, req.actor, "patients.create", id, req.correlation);
      return row;
    });
  }
  @Permit("patients.update") @Patch(":id") async update(
    @Param("id") id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    uuid.parse(id);
    const { version, reason, ...values } = body;
    z.number().int().positive().parse(version);
    z.string().trim().min(5).max(300).parse(reason);
    const p = patientSchema.parse(values);
    return mutation(this.db, req, body, async (q) => {
      const row = (
        await q.query(
          "UPDATE patients SET name=$1,social_name=$2,birth_date=$3,provisional=$4,cpf=$5,cns=$6,phone=$7,mother_name=$8,emergency_contact=$9,accessibility=$10,version=version+1,updated_at=now() WHERE id=$11 AND unit_id=$12 AND version=$13 RETURNING *",
          [
            p.name,
            p.social_name,
            p.birth_date,
            p.provisional,
            p.cpf,
            p.cns,
            p.phone,
            p.mother_name,
            p.emergency_contact,
            p.accessibility,
            id,
            req.actor.unitId,
            version,
          ],
        )
      ).rows[0];
      if (!row)
        throw new ConflictException(
          "Cadastro alterado por outra pessoa ou indisponível. Recarregue antes de editar.",
        );
      await audit(q, req.actor, "patients.update", id, req.correlation, reason);
      return row;
    });
  }
}

@ApiTags("Estrutura e governança")
@Controller("api")
export class StructureController {
  constructor(@Inject(Database) private db: Database) {}
  @Permit("structure.read") @Get("units") units(@Req() req: any) {
    return req.actor.units;
  }
  @Permit("structure.write") @Post("units") async addUnit(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        name: z.string().trim().min(3).max(100),
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat("pt-BR", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, "Fuso IANA inválido."),
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const inst = (
        await q.query("SELECT institution_id FROM units WHERE id=$1", [
          req.actor.unitId,
        ])
      ).rows[0].institution_id;
      const id = randomUUID();
      await q.query(
        "INSERT INTO units(id,institution_id,name,timezone) VALUES($1,$2,$3,$4)",
        [id, inst, b.name, b.timezone],
      );
      await q.query("INSERT INTO settings(unit_id) VALUES($1)", [id]);
      await q.query("INSERT INTO user_units VALUES($1,$2)", [req.actor.id, id]);
      await audit(q, req.actor, "units.create", id, req.correlation);
      return { id, ...b };
    });
  }
  @Permit("structure.read") @Get("sectors") async sectors(@Req() req: any) {
    return (
      await this.db.query(
        "SELECT * FROM sectors WHERE unit_id=$1 ORDER BY name",
        [req.actor.unitId],
      )
    ).rows;
  }
  @Permit("structure.write") @Post("sectors") async addSector(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({ name: z.string().trim().min(3).max(100) })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const row = (
        await q.query(
          "INSERT INTO sectors(id,unit_id,name) VALUES($1,$2,$3) RETURNING *",
          [randomUUID(), req.actor.unitId, b.name],
        )
      ).rows[0];
      await audit(q, req.actor, "sectors.create", row.id, req.correlation);
      return row;
    });
  }
  @Permit("structure.read") @Get("settings") async settings(@Req() req: any) {
    return (
      await this.db.query("SELECT * FROM settings WHERE unit_id=$1", [
        req.actor.unitId,
      ])
    ).rows[0];
  }
  @Permit("settings.write") @Patch("settings") async set(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        services: z
          .array(
            z.enum([
              "recepcao",
              "ambulatorio",
              "pronto_atendimento",
              "internacao",
              "laboratorio",
              "imagem",
              "farmacia",
              "cirurgia",
            ]),
          )
          .max(8),
        version: z.number().int().positive(),
        reason: z.string().min(5).max(300),
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const row = (
        await q.query(
          "UPDATE settings SET services=$1,version=version+1 WHERE unit_id=$2 AND version=$3 RETURNING *",
          [[...new Set(b.services)], req.actor.unitId, b.version],
        )
      ).rows[0];
      if (!row)
        throw new ConflictException("Configuração mudou. Recarregue a página.");
      await audit(
        q,
        req.actor,
        "settings.update",
        "services",
        req.correlation,
        b.reason,
      );
      return row;
    });
  }
  @Permit("overview.read") @Get("overview") async overview(@Req() req: any) {
    const counts = (
      await this.db.query(
        "SELECT count(*) AS patients,count(*) FILTER(WHERE provisional) AS provisional FROM patients WHERE unit_id=$1",
        [req.actor.unitId],
      )
    ).rows[0];
    return {
      patients: Number(counts.patients),
      provisional: Number(counts.provisional),
      sectors: Number(
        (
          await this.db.query(
            "SELECT count(*) AS n FROM sectors WHERE unit_id=$1 AND active=true",
            [req.actor.unitId],
          )
        ).rows[0].n,
      ),
      updatedAt: new Date().toISOString(),
      source: "patients / sectors",
      period: "Cadastros atuais da unidade",
      definitions: {
        patients:
          "COUNT de cadastros vinculados à unidade ativa; não é número de atendimentos.",
        provisional: "COUNT de cadastros com identificação provisória.",
        sectors: "COUNT de setores ativos da unidade.",
      },
    };
  }
  @Permit("audit.read") @Get("audit") async events(
    @Query() query: any,
    @Req() req: any,
  ) {
    const p = pageSchema.parse(query);
    return this.db.transaction(async (q) => {
      await audit(q, req.actor, "audit.read", "audit", req.correlation);
      return {
        rows: (
          await q.query(
            "SELECT a.id,a.action,a.resource,a.result,a.reason,a.created_at,a.correlation_id,a.hash,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.unit_id=$1 ORDER BY a.id DESC LIMIT $2 OFFSET $3",
            [req.actor.unitId, p.size, (p.page - 1) * p.size],
          )
        ).rows,
        total: Number(
          (
            await q.query("SELECT count(*) AS n FROM audit WHERE unit_id=$1", [
              req.actor.unitId,
            ])
          ).rows[0].n,
        ),
      };
    });
  }
  @Permit("session") @Get("preferences") async prefs(@Req() req: any) {
    return (
      (
        await this.db.query("SELECT value FROM preferences WHERE user_id=$1", [
          req.actor.id,
        ])
      ).rows[0]?.value || {}
    );
  }
  @Permit("session") @Patch("preferences") async savePrefs(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        favorites: z.array(z.string().max(100)).max(20).optional(),
        recent: z.array(z.string().max(100)).max(10).optional(),
        columns: z
          .array(z.enum(["birth", "status", "id"]))
          .max(3)
          .optional(),
      })
      .strict()
      .parse(body);
    await this.db.query(
      "INSERT INTO preferences(user_id,value) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET value=preferences.value || EXCLUDED.value",
      [req.actor.id, JSON.stringify(b)],
    );
    return { ok: true };
  }
  @Permit("users.read") @Get("roles") async roles() {
    return (await this.db.query("SELECT * FROM roles ORDER BY name")).rows;
  }
  @Permit("users.read") @Get("users") async users(@Req() req: any) {
    return (
      await this.db.query(
        "SELECT u.id,u.name,u.email,u.role_id,u.active FROM users u JOIN user_units uu ON uu.user_id=u.id WHERE uu.unit_id=$1 ORDER BY u.name",
        [req.actor.unitId],
      )
    ).rows;
  }
  @Permit("users.write") @Post("users") async createUser(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        name: z.string().trim().min(3).max(160),
        email: z.email().max(160),
        password: z.string().min(14).max(128),
        role_id: z.string().max(30),
      })
      .strict()
      .parse(body);
    if (b.role_id === "ti")
      throw new BadRequestException(
        "Novos administradores técnicos exigem provisionamento individual de MFA; não disponível nesta etapa.",
      );
    return mutation(
      this.db,
      req,
      { ...b, password: digest(b.password) },
      async (q) => {
        const id = randomUUID();
        await q.query(
          "INSERT INTO users(id,name,email,password_hash,role_id) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            b.name,
            b.email.toLowerCase(),
            hashPassword(b.password),
            b.role_id,
          ],
        );
        await q.query("INSERT INTO user_units VALUES($1,$2)", [
          id,
          req.actor.unitId,
        ]);
        await audit(q, req.actor, "users.create", id, req.correlation);
        return { id };
      },
    );
  }
  @Permit("users.write") @Patch("users/:id") async changeUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    uuid.parse(id);
    const b = z
      .object({
        active: z.boolean(),
        role_id: z.string().max(30),
        reason: z.string().min(5).max(300),
      })
      .strict()
      .parse(body);
    if (id === req.actor.id)
      throw new ForbiddenException("Você não pode alterar seu próprio acesso.");
    if (b.role_id === "ti")
      throw new BadRequestException(
        "Promoção técnica exige provisionamento de MFA.",
      );
    return mutation(this.db, req, b, async (q) => {
      const target = (
        await q.query(
          "SELECT u.id,u.role_id FROM users u JOIN user_units uu ON uu.user_id=u.id WHERE u.id=$1 AND uu.unit_id=$2",
          [id, req.actor.unitId],
        )
      ).rows[0];
      if (!target) throw new NotFoundException();
      if (target.role_id === "ti")
        throw new ForbiddenException(
          "Administrador técnico protegido nesta etapa.",
        );
      await q.query("UPDATE users SET active=$1,role_id=$2 WHERE id=$3", [
        b.active,
        b.role_id,
        id,
      ]);
      await q.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(
        q,
        req.actor,
        "users.access_changed",
        id,
        req.correlation,
        b.reason,
      );
      return { ok: true };
    });
  }
  @Permit("users.write") @Post("users/:id/revoke") async revoke(
    @Param("id") id: string,
    @Req() req: any,
    @Body() body: unknown,
  ) {
    uuid.parse(id);
    const b = z
      .object({ reason: z.string().min(5).max(300) })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      if (
        !(
          await q.query(
            "SELECT user_id FROM user_units WHERE user_id=$1 AND unit_id=$2",
            [id, req.actor.unitId],
          )
        ).rows.length
      )
        throw new NotFoundException();
      await q.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(
        q,
        req.actor,
        "sessions.revoke",
        id,
        req.correlation,
        b.reason,
      );
      return { ok: true };
    });
  }
}
