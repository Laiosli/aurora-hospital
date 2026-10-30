import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Inject,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Database, SQL } from "./db";
import { Permit } from "./auth";
import { audit } from "./audit";
import { mutation } from "./controllers";

const id = z.uuid(),
  reason = z.string().trim().min(5).max(300),
  instant = z.iso.datetime({ offset: true });
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(10),
  q: z.string().max(160).default(""),
  status: z.string().max(30).optional(),
});
const activeStates = [
  "opened",
  "checked_in",
  "triage",
  "waiting",
  "in_care",
  "observation",
  "admitted",
];
const transitions: Record<string, Record<string, string>> = {
  opened: { checked_in: "encounters.route", cancelled: "encounters.cancel" },
  checked_in: {
    triage: "encounters.route",
    waiting: "encounters.route",
    cancelled: "encounters.cancel",
  },
  triage: { waiting: "encounters.triage", cancelled: "encounters.cancel" },
  waiting: { in_care: "encounters.attend", cancelled: "encounters.cancel" },
  in_care: {
    observation: "encounters.attend",
    discharged: "encounters.discharge",
  },
  observation: {
    in_care: "encounters.attend",
    discharged: "encounters.discharge",
  },
  admitted: { discharged: "encounters.discharge" },
};
async function service(q: SQL, unit: string, name: string) {
  if (
    !(
      await q.query("SELECT services FROM settings WHERE unit_id=$1", [unit])
    ).rows[0]?.services.includes(name)
  )
    throw new ConflictException(
      "Serviço não habilitado na unidade. Configure antes de abrir novas operações.",
    );
}
async function get(
  q: SQL,
  table: "patients" | "schedules" | "appointments" | "encounters" | "beds",
  resource: string,
  unit: string,
  lock = false,
) {
  id.parse(resource);
  const row = (
    await q.query(
      `SELECT * FROM ${table} WHERE id=$1 AND unit_id=$2${lock ? " FOR UPDATE" : ""}`,
      [resource, unit],
    )
  ).rows[0];
  if (!row)
    throw new NotFoundException(
      "Registro não encontrado na unidade autorizada.",
    );
  return row;
}
async function event(
  q: SQL,
  req: any,
  type: string,
  entity: string,
  action: string,
  from: string | null,
  to: string | null,
  why: string,
  details: any = {},
) {
  await q.query(
    "INSERT INTO operational_events(id,unit_id,entity_type,entity_id,action,from_state,to_state,reason,actor_id,correlation_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      randomUUID(),
      req.actor.unitId,
      type,
      entity,
      action,
      from,
      to,
      why,
      req.actor.id,
      req.correlation,
      JSON.stringify(details),
    ],
  );
  await audit(q, req.actor, `${type}.${action}`, entity, req.correlation, why);
}
async function releaseBed(q: SQL, req: any, encounterId: string, why: string) {
  const allocations = (
    await q.query(
      "SELECT * FROM bed_allocations WHERE encounter_id=$1 AND unit_id=$2 AND status IN ('reserved','occupied') FOR UPDATE",
      [encounterId, req.actor.unitId],
    )
  ).rows;
  for (const a of allocations) {
    const next = a.status === "occupied" ? "cleaning" : "available";
    await q.query(
      "UPDATE bed_allocations SET status='ended',ended_at=now() WHERE id=$1",
      [a.id],
    );
    await q.query("UPDATE beds SET state=$1,version=version+1 WHERE id=$2", [
      next,
      a.bed_id,
    ]);
    await event(q, req, "bed", a.bed_id, "release", a.status, next, why, {
      encounterId,
    });
  }
}

@ApiTags("Recepção, agendas e leitos")
@Controller("api")
export class OperationsController {
  constructor(@Inject(Database) private db: Database) {}
  @Permit("overview.read") @Get("operations/metrics") async metrics(
    @Req() req: any,
  ) {
    return this.db.transaction(async (q) => {
      const e = (
        await q.query(
          "SELECT count(*) AS total,count(*) FILTER(WHERE ended_at IS NULL) AS active,count(*) FILTER(WHERE status IN ('checked_in','triage','waiting')) AS waiting FROM encounters WHERE unit_id=$1",
          [req.actor.unitId],
        )
      ).rows[0];
      const b = (
        await q.query(
          "SELECT count(*) FILTER(WHERE state<>'blocked') AS usable,count(*) FILTER(WHERE state='occupied') AS occupied FROM beds WHERE unit_id=$1",
          [req.actor.unitId],
        )
      ).rows[0];
      return {
        encounters: Number(e.total),
        active: Number(e.active),
        waiting: Number(e.waiting),
        usableBeds: Number(b.usable),
        occupiedBeds: Number(b.occupied),
        occupancy: Number(b.usable)
          ? (Number(b.occupied) / Number(b.usable)) * 100
          : null,
        updatedAt: new Date().toISOString(),
        period: "Todos os episódios; fila e ocupação no instante da consulta",
        source: "encounters / beds — unidade ativa",
        definitions: {
          encounters:
            "Contagem de episódios abertos na unidade, inclusive encerrados.",
          active: "Episódios sem horário de encerramento.",
          waiting: "Episódios em check-in, encaminhamento à triagem ou espera.",
          occupancy:
            "Leitos ocupados ÷ leitos não bloqueados × 100. Sem denominador, não se calcula taxa.",
        },
      };
    });
  }
  @Permit("schedules.read") @Get("resources") async resources(@Req() req: any) {
    return {
      rooms: (
        await this.db.query(
          "SELECT r.*,s.name AS sector_name FROM rooms r JOIN sectors s ON s.id=r.sector_id WHERE r.unit_id=$1 ORDER BY r.name",
          [req.actor.unitId],
        )
      ).rows,
      professionals: (
        await this.db.query(
          "SELECT u.id,u.name FROM users u JOIN user_units uu ON uu.user_id=u.id WHERE uu.unit_id=$1 AND u.active=true AND u.role_id IN ('medico','enfermagem') ORDER BY u.name",
          [req.actor.unitId],
        )
      ).rows,
    };
  }
  @Permit("schedules.write") @Post("rooms") async room(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({ name: z.string().trim().min(2).max(100), sector_id: id })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const row = (
        await q.query(
          "INSERT INTO rooms(id,unit_id,sector_id,name) VALUES($1,$2,$3,$4) RETURNING *",
          [randomUUID(), req.actor.unitId, b.sector_id, b.name],
        )
      ).rows[0];
      await audit(q, req.actor, "rooms.create", row.id, req.correlation);
      return row;
    });
  }
  @Permit("schedules.read") @Get("schedules") async schedules(
    @Query() query: any,
    @Req() req: any,
  ) {
    const p = paging.parse(query);
    const rows = (
      await this.db.query(
        "SELECT s.*,r.name AS room_name,u.name AS professional_name FROM schedules s JOIN rooms r ON r.id=s.room_id JOIN users u ON u.id=s.professional_id WHERE s.unit_id=$1 ORDER BY s.starts_at DESC LIMIT $2 OFFSET $3",
        [req.actor.unitId, p.size, (p.page - 1) * p.size],
      )
    ).rows;
    return {
      rows,
      total: Number(
        (
          await this.db.query(
            "SELECT count(*) AS n FROM schedules WHERE unit_id=$1",
            [req.actor.unitId],
          )
        ).rows[0].n,
      ),
      page: p.page,
      size: p.size,
    };
  }
  @Permit("schedules.write") @Post("schedules") async schedule(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        name: z.string().trim().min(3).max(100),
        specialty: z.string().trim().min(2).max(100),
        room_id: id,
        professional_id: id,
        slot_minutes: z.number().int().min(5).max(240),
        starts_at: instant,
        ends_at: instant,
      })
      .strict()
      .refine(
        (v) => Date.parse(v.ends_at) > Date.parse(v.starts_at),
        "Término deve ser posterior ao início.",
      )
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const professional = (
        await q.query(
          "SELECT u.id FROM users u JOIN user_units uu ON uu.user_id=u.id WHERE u.id=$1 AND uu.unit_id=$2 AND u.active=true AND u.role_id IN ('medico','enfermagem')",
          [b.professional_id, req.actor.unitId],
        )
      ).rows[0];
      if (!professional)
        throw new BadRequestException(
          "Profissional sem vínculo ativo e categoria habilitada.",
        );
      const row = (
        await q.query(
          "INSERT INTO schedules(id,unit_id,room_id,professional_id,name,specialty,slot_minutes,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            req.actor.unitId,
            b.room_id,
            b.professional_id,
            b.name,
            b.specialty,
            b.slot_minutes,
            b.starts_at,
            b.ends_at,
          ],
        )
      ).rows[0];
      await event(
        q,
        req,
        "schedule",
        row.id,
        "create",
        null,
        "active",
        "Criação de disponibilidade",
      );
      return row;
    });
  }
  @Permit("schedules.read") @Get("schedules/:id/blocks") async blocks(
    @Param("id") resource: string,
    @Req() req: any,
  ) {
    await get(this.db, "schedules", resource, req.actor.unitId);
    return (
      await this.db.query(
        "SELECT * FROM schedule_blocks WHERE schedule_id=$1 AND unit_id=$2 ORDER BY starts_at",
        [resource, req.actor.unitId],
      )
    ).rows;
  }
  @Permit("schedules.write") @Post("schedules/:id/blocks") async block(
    @Param("id") resource: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    id.parse(resource);
    const b = z
      .object({ starts_at: instant, ends_at: instant, reason })
      .strict()
      .refine(
        (v) => Date.parse(v.ends_at) > Date.parse(v.starts_at),
        "Intervalo inválido.",
      )
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const s = await get(q, "schedules", resource, req.actor.unitId);
      await q.query("SELECT id FROM units WHERE id=$1 FOR UPDATE", [
        req.actor.unitId,
      ]);
      if (
        Date.parse(b.starts_at) < Date.parse(s.starts_at) ||
        Date.parse(b.ends_at) > Date.parse(s.ends_at)
      )
        throw new BadRequestException(
          "Bloqueio deve estar dentro da disponibilidade.",
        );
      if (
        (
          await q.query(
            "SELECT a.id FROM appointments a JOIN schedules s ON s.id=a.schedule_id WHERE a.unit_id=$1 AND a.status NOT IN ('cancelled','no_show') AND a.starts_at<$2 AND a.ends_at>$3 AND (s.room_id=$4 OR s.professional_id=$5) LIMIT 1",
            [
              req.actor.unitId,
              b.ends_at,
              b.starts_at,
              s.room_id,
              s.professional_id,
            ],
          )
        ).rows.length
      )
        throw new ConflictException(
          "Há agendamentos no intervalo. Reagende ou cancele com justificativa antes de bloquear.",
        );
      const row = (
        await q.query(
          "INSERT INTO schedule_blocks(id,unit_id,schedule_id,starts_at,ends_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            req.actor.unitId,
            resource,
            b.starts_at,
            b.ends_at,
            b.reason,
            req.actor.id,
          ],
        )
      ).rows[0];
      await event(
        q,
        req,
        "schedule",
        resource,
        "block",
        "active",
        "blocked_interval",
        b.reason,
        { blockId: row.id },
      );
      return row;
    });
  }
  @Permit("appointments.read") @Get("appointments") async appointments(
    @Query() query: any,
    @Req() req: any,
  ) {
    const p = paging.parse(query);
    const params = [
      req.actor.unitId,
      "%" + p.q.toLowerCase() + "%",
      p.status || null,
    ];
    const where =
      "a.unit_id=$1 AND (lower(p.name) LIKE $2 OR a.id::text LIKE $2) AND ($3::text IS NULL OR a.status=$3)";
    return this.db.transaction(async (q) => {
      const rows = (
        await q.query(
          `SELECT a.*,p.name AS patient_name,p.birth_date,s.name AS schedule_name,s.specialty FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN schedules s ON s.id=a.schedule_id WHERE ${where} ORDER BY a.starts_at DESC,a.id LIMIT $4 OFFSET $5`,
          [...params, p.size, (p.page - 1) * p.size],
        )
      ).rows;
      const total = Number(
        (
          await q.query(
            `SELECT count(*) AS n FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE ${where}`,
            params,
          )
        ).rows[0].n,
      );
      await audit(
        q,
        req.actor,
        "appointments.read",
        "appointments",
        req.correlation,
      );
      return { rows, total, page: p.page, size: p.size };
    });
  }
  @Permit("appointments.write") @Post("appointments") async appointment(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        patient_id: id,
        confirmed_patient_id: id,
        schedule_id: id,
        starts_at: instant,
      })
      .strict()
      .refine(
        (v) => v.patient_id === v.confirmed_patient_id,
        "Confirme a identificação do paciente.",
      )
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      await service(q, req.actor.unitId, "ambulatorio");
      await get(q, "patients", b.patient_id, req.actor.unitId);
      const s = await get(q, "schedules", b.schedule_id, req.actor.unitId);
      if (Date.parse(b.starts_at) < Date.now())
        throw new BadRequestException("Agendamento precisa de horário futuro.");
      const end = new Date(
        Date.parse(b.starts_at) + s.slot_minutes * 60000,
      ).toISOString();
      const row = (
        await q.query(
          "INSERT INTO appointments(id,unit_id,patient_id,schedule_id,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            req.actor.unitId,
            b.patient_id,
            b.schedule_id,
            b.starts_at,
            end,
            req.actor.id,
          ],
        )
      ).rows[0];
      await event(
        q,
        req,
        "appointment",
        row.id,
        "create",
        null,
        "scheduled",
        "Agendamento com identificação conferida",
      );
      return row;
    });
  }
  @Permit("appointments.write")
  @Patch("appointments/:id")
  async changeAppointment(
    @Param("id") resource: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    id.parse(resource);
    const b = z
      .object({
        action: z.enum(["confirm", "cancel", "no_show", "reschedule"]),
        version: z.number().int().positive(),
        reason,
        starts_at: instant.optional(),
        schedule_id: id.optional(),
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const old = await get(
        q,
        "appointments",
        resource,
        req.actor.unitId,
        true,
      );
      if (old.version !== b.version)
        throw new ConflictException("Agendamento alterado. Recarregue.");
      if (!["scheduled", "confirmed"].includes(old.status))
        throw new ConflictException(
          "Este agendamento não aceita essa alteração.",
        );
      let state = {
          confirm: "confirmed",
          cancel: "cancelled",
          no_show: "no_show",
          reschedule: "scheduled",
        }[b.action],
        start = old.starts_at,
        end = old.ends_at,
        scheduleId = old.schedule_id;
      if (b.action === "no_show" && Date.parse(old.ends_at) > Date.now())
        throw new ConflictException(
          "Não é possível registrar falta antes do término previsto.",
        );
      if (b.action === "reschedule") {
        if (!b.starts_at || Date.parse(b.starts_at) < Date.now())
          throw new BadRequestException("Informe novo horário futuro.");
        scheduleId = b.schedule_id || old.schedule_id;
        const s = await get(q, "schedules", scheduleId, req.actor.unitId);
        start = b.starts_at;
        end = new Date(
          Date.parse(start) + s.slot_minutes * 60000,
        ).toISOString();
      }
      const row = (
        await q.query(
          "UPDATE appointments SET status=$1,starts_at=$2,ends_at=$3,schedule_id=$4,version=version+1 WHERE id=$5 RETURNING *",
          [state, start, end, scheduleId, resource],
        )
      ).rows[0];
      await event(
        q,
        req,
        "appointment",
        resource,
        b.action,
        old.status,
        state,
        b.reason,
        {
          previousStart: old.starts_at,
          previousEnd: old.ends_at,
          previousSchedule: old.schedule_id,
          newStart: start,
          newSchedule: scheduleId,
        },
      );
      return row;
    });
  }
  @Permit("encounters.read") @Get("encounters") async encounters(
    @Query() query: any,
    @Req() req: any,
  ) {
    const p = paging.parse(query);
    const params = [
      req.actor.unitId,
      "%" + p.q.toLowerCase() + "%",
      p.status || null,
    ];
    const where =
      "e.unit_id=$1 AND (lower(p.name) LIKE $2 OR e.id::text LIKE $2) AND ($3::text IS NULL OR ($3='active' AND e.ended_at IS NULL) OR e.status=$3)";
    return this.db.transaction(async (q) => {
      const rows = (
        await q.query(
          `SELECT e.*,p.name AS patient_name,p.social_name,p.birth_date,p.provisional,s.name AS sector_name FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN sectors s ON s.id=e.sector_id WHERE ${where} ORDER BY e.stage_at,e.id LIMIT $4 OFFSET $5`,
          [...params, p.size, (p.page - 1) * p.size],
        )
      ).rows;
      const total = Number(
        (
          await q.query(
            `SELECT count(*) AS n FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE ${where}`,
            params,
          )
        ).rows[0].n,
      );
      await audit(
        q,
        req.actor,
        "encounters.read",
        "encounters",
        req.correlation,
      );
      return { rows, total, page: p.page, size: p.size };
    });
  }
  @Permit("encounters.create") @Post("encounters") async encounter(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({
        patient_id: id,
        confirmed_patient_id: id,
        appointment_id: id.optional(),
        sector_id: id,
        modality: z.enum(["ambulatorio", "pronto_atendimento", "internacao"]),
      })
      .strict()
      .refine(
        (v) => v.patient_id === v.confirmed_patient_id,
        "Confirme o paciente pelo identificador.",
      )
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      await service(q, req.actor.unitId, b.modality);
      await get(q, "patients", b.patient_id, req.actor.unitId);
      let status = "opened";
      if (b.appointment_id) {
        const a = await get(
          q,
          "appointments",
          b.appointment_id,
          req.actor.unitId,
          true,
        );
        if (
          a.patient_id !== b.patient_id ||
          !["scheduled", "confirmed"].includes(a.status) ||
          b.modality !== "ambulatorio"
        )
          throw new ConflictException(
            "Agendamento incompatível com paciente, modalidade ou estado.",
          );
        await q.query(
          "UPDATE appointments SET status='checked_in',version=version+1 WHERE id=$1",
          [a.id],
        );
        await event(
          q,
          req,
          "appointment",
          a.id,
          "check_in",
          a.status,
          "checked_in",
          "Check-in e abertura de episódio",
        );
        status = "checked_in";
      }
      const row = (
        await q.query(
          "INSERT INTO encounters(id,unit_id,patient_id,appointment_id,sector_id,modality,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            req.actor.unitId,
            b.patient_id,
            b.appointment_id || null,
            b.sector_id,
            b.modality,
            status,
            req.actor.id,
          ],
        )
      ).rows[0];
      await event(
        q,
        req,
        "encounter",
        row.id,
        "open",
        null,
        status,
        "Identificação conferida na abertura",
      );
      return row;
    });
  }
  @Permit("encounters.read")
  @Post("encounters/:id/transition")
  async transition(
    @Param("id") resource: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    id.parse(resource);
    const b = z
      .object({
        to: z.enum([
          "checked_in",
          "triage",
          "waiting",
          "in_care",
          "observation",
          "discharged",
          "cancelled",
        ]),
        version: z.number().int().positive(),
        reason,
        sector_id: id.optional(),
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const old = await get(q, "encounters", resource, req.actor.unitId, true);
      const permission = transitions[old.status]?.[b.to];
      if (!permission)
        throw new ConflictException(
          "Transição não permitida a partir do estado atual.",
        );
      if (!req.actor.permissions.includes(permission))
        throw new ForbiddenException(
          "Seu perfil não pode executar esta transição.",
        );
      if (old.version !== b.version)
        throw new ConflictException("Atendimento alterado. Recarregue.");
      if (["discharged", "cancelled"].includes(b.to))
        await releaseBed(q, req, resource, b.reason);
      const row = (
        await q.query(
          "UPDATE encounters SET status=$1,sector_id=$2,version=version+1,stage_at=now(),ended_at=CASE WHEN $1 IN ('discharged','cancelled') THEN now() ELSE NULL END WHERE id=$3 RETURNING *",
          [b.to, b.sector_id || old.sector_id, resource],
        )
      ).rows[0];
      await event(
        q,
        req,
        "encounter",
        resource,
        "transition",
        old.status,
        b.to,
        b.reason,
        { previousSector: old.sector_id, newSector: row.sector_id },
      );
      return row;
    });
  }
  @Permit("encounters.read") @Get("operations/:type/:id/history") async history(
    @Param("type") type: string,
    @Param("id") resource: string,
    @Query() query: any,
    @Req() req: any,
  ) {
    z.enum(["encounter", "appointment"]).parse(type);
    await get(
      this.db,
      type === "encounter" ? "encounters" : "appointments",
      resource,
      req.actor.unitId,
    );
    const p = paging.parse(query);
    return this.db.transaction(async (q) => {
      await audit(
        q,
        req.actor,
        "operations.history",
        resource,
        req.correlation,
      );
      return {
        rows: (
          await q.query(
            "SELECT e.*,u.name AS actor_name FROM operational_events e JOIN users u ON u.id=e.actor_id WHERE e.unit_id=$1 AND e.entity_type=$2 AND e.entity_id=$3 ORDER BY e.created_at DESC,e.id LIMIT $4 OFFSET $5",
            [req.actor.unitId, type, resource, p.size, (p.page - 1) * p.size],
          )
        ).rows,
        total: Number(
          (
            await q.query(
              "SELECT count(*) AS n FROM operational_events WHERE unit_id=$1 AND entity_type=$2 AND entity_id=$3",
              [req.actor.unitId, type, resource],
            )
          ).rows[0].n,
        ),
      };
    });
  }
  @Permit("beds.read") @Get("beds") async beds(
    @Query() query: any,
    @Req() req: any,
  ) {
    const p = paging.parse(query);
    const sensitive = req.actor.permissions.includes("encounters.read");
    return this.db.transaction(async (q) => {
      const rows = (
        await q.query(
          `SELECT b.*,s.name AS sector_name${sensitive ? ",a.encounter_id,p.name AS patient_name,p.birth_date" : ""} FROM beds b JOIN sectors s ON s.id=b.sector_id ${sensitive ? "LEFT JOIN bed_allocations a ON a.bed_id=b.id AND a.status IN ('reserved','occupied') LEFT JOIN encounters e ON e.id=a.encounter_id LEFT JOIN patients p ON p.id=e.patient_id" : ""} WHERE b.unit_id=$1 AND ($2::text IS NULL OR b.state=$2) ORDER BY b.code LIMIT $3 OFFSET $4`,
          [req.actor.unitId, p.status || null, p.size, (p.page - 1) * p.size],
        )
      ).rows;
      await audit(q, req.actor, "beds.read", "beds", req.correlation);
      return {
        rows,
        total: Number(
          (
            await q.query(
              "SELECT count(*) AS n FROM beds WHERE unit_id=$1 AND ($2::text IS NULL OR state=$2)",
              [req.actor.unitId, p.status || null],
            )
          ).rows[0].n,
        ),
      };
    });
  }
  @Permit("beds.configure") @Post("beds") async addBed(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const b = z
      .object({ code: z.string().trim().min(1).max(50), sector_id: id })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const row = (
        await q.query(
          "INSERT INTO beds(id,unit_id,sector_id,code) VALUES($1,$2,$3,$4) RETURNING *",
          [randomUUID(), req.actor.unitId, b.sector_id, b.code],
        )
      ).rows[0];
      await event(
        q,
        req,
        "bed",
        row.id,
        "create",
        null,
        "available",
        "Cadastro de leito",
      );
      return row;
    });
  }
  @Permit("beds.allocate") @Post("beds/:id/allocate") async allocate(
    @Param("id") resource: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    id.parse(resource);
    const b = z
      .object({
        encounter_id: id,
        mode: z.enum(["reserve", "occupy", "transfer"]),
        version: z.number().int().positive(),
        reason,
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      await service(q, req.actor.unitId, "internacao");
      const bed = await get(q, "beds", resource, req.actor.unitId, true),
        enc = await get(
          q,
          "encounters",
          b.encounter_id,
          req.actor.unitId,
          true,
        );
      if (bed.version !== b.version)
        throw new ConflictException("Leito alterado. Recarregue.");
      if (!activeStates.includes(enc.status))
        throw new ConflictException("Atendimento já encerrado.");
      if (
        b.mode !== "reserve" &&
        !["in_care", "observation", "admitted"].includes(enc.status)
      )
        throw new ConflictException(
          "Ocupação exige atendimento em assistência, observação ou internação.",
        );
      const previous = (
        await q.query(
          "SELECT * FROM bed_allocations WHERE encounter_id=$1 AND status IN ('reserved','occupied') FOR UPDATE",
          [enc.id],
        )
      ).rows[0];
      let allocationId = randomUUID();
      if (b.mode === "transfer") {
        if (
          !previous ||
          previous.status !== "occupied" ||
          previous.bed_id === resource
        )
          throw new ConflictException(
            "Transferência exige ocupação em outro leito.",
          );
        if (bed.state !== "available")
          throw new ConflictException("Destino indisponível.");
        await releaseBed(q, req, enc.id, b.reason);
      } else if (previous) {
        if (
          !(
            b.mode === "occupy" &&
            previous.status === "reserved" &&
            previous.bed_id === resource
          )
        )
          throw new ConflictException(
            "Atendimento já possui reserva ou ocupação.",
          );
        allocationId = previous.id;
      }
      if (
        bed.state !== "available" &&
        !(
          b.mode === "occupy" &&
          previous?.bed_id === resource &&
          previous.status === "reserved"
        )
      )
        throw new ConflictException("Leito indisponível.");
      const state = b.mode === "reserve" ? "reserved" : "occupied";
      if (allocationId === previous?.id)
        await q.query(
          "UPDATE bed_allocations SET status='occupied' WHERE id=$1",
          [allocationId],
        );
      else
        await q.query(
          "INSERT INTO bed_allocations(id,unit_id,bed_id,encounter_id,status,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            allocationId,
            req.actor.unitId,
            resource,
            enc.id,
            state,
            req.actor.id,
          ],
        );
      await q.query("UPDATE beds SET state=$1,version=version+1 WHERE id=$2", [
        state,
        resource,
      ]);
      if (state === "occupied") {
        await q.query(
          "UPDATE encounters SET status='admitted',sector_id=$2,version=version+1,stage_at=now() WHERE id=$1",
          [enc.id,bed.sector_id],
        );
        await event(
          q,
          req,
          "encounter",
          enc.id,
          b.mode,
          enc.status,
          "admitted",
          b.reason,
          { bedId: resource, previousBed: previous?.bed_id || null, previousSector:enc.sector_id,newSector:bed.sector_id },
        );
      }
      await event(q, req, "bed", resource, b.mode, bed.state, state, b.reason, {
        encounterId: enc.id,
        allocationId,
      });
      return {
        id: resource,
        state,
        version: bed.version + 1,
        allocation_id: allocationId,
      };
    });
  }
  @Permit("beds.read") @Post("beds/:id/state") async bedState(
    @Param("id") resource: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    id.parse(resource);
    const b = z
      .object({
        action: z.enum(["block", "unblock", "clean", "cancel_reservation"]),
        version: z.number().int().positive(),
        reason,
      })
      .strict()
      .parse(body);
    const permission =
      b.action === "clean"
        ? "beds.clean"
        : b.action === "cancel_reservation"
          ? "beds.allocate"
          : "beds.configure";
    if (!req.actor.permissions.includes(permission))
      throw new ForbiddenException("Permissão insuficiente para esta ação.");
    return mutation(this.db, req, b, async (q) => {
      const bed = await get(q, "beds", resource, req.actor.unitId, true);
      if (bed.version !== b.version)
        throw new ConflictException("Leito alterado.");
      const expected = {
        block: "available",
        unblock: "blocked",
        clean: "cleaning",
        cancel_reservation: "reserved",
      }[b.action];
      if (bed.state !== expected)
        throw new ConflictException("Estado do leito incompatível com ação.");
      if (b.action === "cancel_reservation")
        await q.query(
          "UPDATE bed_allocations SET status='cancelled',ended_at=now() WHERE bed_id=$1 AND status='reserved'",
          [resource],
        );
      const state = b.action === "block" ? "blocked" : "available";
      const row = (
        await q.query(
          "UPDATE beds SET state=$1,version=version+1 WHERE id=$2 RETURNING *",
          [state, resource],
        )
      ).rows[0];
      await event(
        q,
        req,
        "bed",
        resource,
        b.action,
        bed.state,
        state,
        b.reason,
      );
      return row;
    });
  }
}
