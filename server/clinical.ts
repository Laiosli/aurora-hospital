import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Inject,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, SQL } from "./db";
import { Permit } from "./auth";
import { audit } from "./audit";
import { mutation } from "./controllers";
import {demoFullAccess} from './demo-access';

const reason = z.string().trim().min(5).max(500);
const content = z.string().trim().min(5).max(20000);
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
const active = ["triage", "waiting", "in_care", "observation", "admitted"];
const vitalUnits: Record<string, string> = {
  temperature: "°C",
  heart_rate: "bpm",
  respiratory_rate: "irpm",
  saturation: "%",
  systolic: "mmHg",
  diastolic: "mmHg",
  weight: "kg",
  height: "cm",
};
async function encounter(q: SQL, req: any, eid: string) {
  z.uuid().parse(eid);
  const e = (
    await q.query(
      "SELECT * FROM encounters WHERE id=$1 AND unit_id=$2 FOR UPDATE",
      [eid, req.actor.unitId],
    )
  ).rows[0];
  if (!e)
    throw new NotFoundException(
      "Atendimento não encontrado na unidade autorizada.",
    );
  return e;
}
async function linked(q: SQL, req: any, e: any) {
  if (demoFullAccess(req.actor)) return;
  const link = (
    await q.query(
      "SELECT 1 FROM care_links WHERE encounter_id=$1 AND user_id=$2 AND unit_id=$3",
      [e.id, req.actor.id, req.actor.unitId],
    )
  ).rows[0];
  if (!link)
    throw new ForbiddenException(
      "Vínculo assistencial necessário para consultar este prontuário.",
    );
}
function open(e: any) {
  if (!active.includes(e.status))
    throw new ConflictException(
      "Registro novo exige atendimento em andamento.",
    );
}
async function revision(q: SQL, req: any, d: any, why: string) {
  await q.query(
    "INSERT INTO clinical_revisions(id,document_id,unit_id,version,status,content,actor_id,actor_role,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      d.id,
      d.unit_id,
      d.version,
      d.status,
      d.content,
      req.actor.id,
      req.actor.role_id,
      why,
    ],
  );
  await audit(q, req.actor, `clinical.${d.status}`, d.id, req.correlation, why);
}
@ApiTags("Documentos clínicos — demonstração")
@Controller("api/clinical")
export class ClinicalController {
  constructor(@Inject(Database) private db: Database) {}
  @Post("encounters/:id/join")
  @Permit("clinical.join")
  async join(@Req() req: any, @Param("id") eid: string, @Body() body: any) {
    const b = z
      .object({ confirmed_patient_id: z.uuid(), sector_id: z.uuid(), reason })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const e = await encounter(q, req, eid);
      open(e);
      if (
        e.patient_id !== b.confirmed_patient_id ||
        e.sector_id !== b.sector_id
      )
        throw new ConflictException(
          "Paciente ou setor divergente. Reconfirme o atendimento.",
        );
      if (!["medico", "enfermagem"].includes(req.actor.role_id) && !demoFullAccess(req.actor))
        throw new ForbiddenException(
          "Vínculo reservado a profissional assistencial.",
        );
      await q.query(
        "INSERT INTO care_links(encounter_id,unit_id,user_id,sector_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(encounter_id,user_id) DO NOTHING",
        [e.id, e.unit_id, req.actor.id, b.sector_id, b.reason],
      );
      await audit(
        q,
        req.actor,
        "clinical.join",
        e.id,
        req.correlation,
        b.reason,
      );
      return { linked: true };
    });
  }
  @Get("encounters/:id")
  @Permit("clinical.read")
  async chart(@Req() req: any, @Param("id") eid: string, @Query() query: any) {
    const { page } = pagination.parse(query);
    return this.db.transaction(async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      const p = (
        await q.query(
          "SELECT id,name,social_name,birth_date,provisional FROM patients WHERE id=$1 AND unit_id=$2",
          [e.patient_id, e.unit_id],
        )
      ).rows[0];
      const rows = (
        await q.query(
          "SELECT d.*,u.name AS author_name FROM clinical_documents d JOIN users u ON u.id=d.author_id WHERE d.encounter_id=$1 AND d.unit_id=$2 ORDER BY d.created_at DESC,d.id LIMIT 10 OFFSET $3",
          [eid, e.unit_id, (page - 1) * 10],
        )
      ).rows;
      const total = Number(
        (
          await q.query(
            "SELECT count(*) AS n FROM clinical_documents WHERE encounter_id=$1 AND unit_id=$2",
            [eid, e.unit_id],
          )
        ).rows[0].n,
      );
      await audit(q, req.actor, "clinical.read", eid, req.correlation);
      const allergy = (
        await q.query(
          "SELECT a.*,u.name AS author_name FROM allergy_assessments a JOIN users u ON u.id=a.author_id WHERE patient_id=$1 AND a.unit_id=$2 ORDER BY version DESC LIMIT 1",
          [e.patient_id, e.unit_id],
        )
      ).rows[0] || { version: 0, state: "not_investigated", entries: [] };
      return { encounter: e, patient: p, rows, total, page, allergy };
    });
  }
  @Post("encounters/:id/allergies")
  @Permit("clinical.create")
  async allergies(
    @Req() req: any,
    @Param("id") eid: string,
    @Body() body: any,
  ) {
    const b = z
      .object({
        confirmed_patient_id: z.uuid(),
        version: z.number().int().min(0),
        state: z.enum([
          "not_investigated",
          "unavailable",
          "none_known",
          "recorded",
        ]),
        entries: z
          .array(
            z
              .object({
                substance: z.string().trim().min(1).max(160),
                reaction: z.string().trim().min(1).max(500),
              })
              .strict(),
          )
          .max(50),
        reason,
      })
      .strict()
      .refine(
        (v) =>
          v.state === "recorded"
            ? v.entries.length > 0
            : v.entries.length === 0,
        "Informe alergias e reações apenas quando o estado for alergias registradas.",
      )
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      open(e);
      if (e.patient_id !== b.confirmed_patient_id)
        throw new ConflictException("Identidade do paciente divergente.");
      await q.query("SELECT id FROM patients WHERE id=$1 FOR UPDATE", [
        e.patient_id,
      ]);
      const old = (
        await q.query(
          "SELECT version FROM allergy_assessments WHERE patient_id=$1 ORDER BY version DESC LIMIT 1",
          [e.patient_id],
        )
      ).rows[0];
      if ((old?.version || 0) !== b.version)
        throw new ConflictException(
          "Avaliação de alergias atualizada. Recarregue antes de substituir.",
        );
      const a = (
        await q.query(
          "INSERT INTO allergy_assessments(id,patient_id,encounter_id,unit_id,version,state,entries,reason,author_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            e.patient_id,
            e.id,
            e.unit_id,
            b.version + 1,
            b.state,
            JSON.stringify(b.entries),
            b.reason,
            req.actor.id,
          ],
        )
      ).rows[0];
      await audit(
        q,
        req.actor,
        "clinical.allergies.record",
        a.id,
        req.correlation,
        b.reason,
      );
      return a;
    });
  }
  @Get("encounters/:id/allergies/history")
  @Permit("clinical.read")
  async allergyHistory(
    @Req() req: any,
    @Param("id") eid: string,
    @Query() query: any,
  ) {
    const { page } = pagination.parse(query);
    return this.db.transaction(async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      const rows = (
        await q.query(
          "SELECT a.*,u.name AS author_name FROM allergy_assessments a JOIN users u ON u.id=a.author_id WHERE patient_id=$1 AND a.unit_id=$2 ORDER BY version DESC LIMIT 10 OFFSET $3",
          [e.patient_id, e.unit_id, (page - 1) * 10],
        )
      ).rows;
      const total = Number(
        (
          await q.query(
            "SELECT count(*) AS n FROM allergy_assessments WHERE patient_id=$1 AND unit_id=$2",
            [e.patient_id, e.unit_id],
          )
        ).rows[0].n,
      );
      await audit(
        q,
        req.actor,
        "clinical.allergies.read",
        e.patient_id,
        req.correlation,
      );
      return { rows, total, page };
    });
  }
  @Post("encounters/:id/vitals")
  @Permit("clinical.create")
  async vital(@Req() req: any, @Param("id") eid: string, @Body() body: any) {
    const b = z
      .object({
        confirmed_patient_id: z.uuid(),
        kind: z.enum([
          "temperature",
          "heart_rate",
          "respiratory_rate",
          "saturation",
          "systolic",
          "diastolic",
          "weight",
          "height",
        ]),
        value: z.string().regex(/^-?\d{1,9}(\.\d{1,3})?$/),
        observed_at: z.iso
          .datetime({ offset: true })
          .refine(
            (v) => Date.parse(v) <= Date.now(),
            "Horário da medição não pode ser futuro.",
          ),
        note: z.string().trim().max(500).default(""),
        replaces_id: z.uuid().optional(),
        reason,
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      if (!b.replaces_id) open(e);
      if (e.patient_id !== b.confirmed_patient_id)
        throw new ConflictException("Identidade do paciente divergente.");
      if (
        Date.parse(b.observed_at) <
        Math.floor(new Date(e.opened_at).getTime() / 60000) * 60000
      )
        throw new ConflictException(
          "Medição anterior ao minuto de abertura deste atendimento.",
        );
      if (b.replaces_id) {
        if (!req.actor.permissions.includes("clinical.rectify"))
          throw new ForbiddenException("Retificação não autorizada.");
        const old = (
          await q.query(
            "SELECT * FROM vital_observations WHERE id=$1 AND encounter_id=$2 AND unit_id=$3",
            [b.replaces_id, e.id, e.unit_id],
          )
        ).rows[0];
        if (!old)
          throw new NotFoundException("Medição original não encontrada.");
        if ((!demoFullAccess(req.actor) && old.author_id !== req.actor.id) || old.kind !== b.kind)
          throw new ForbiddenException(
            "Somente o autor pode retificar a mesma categoria de medição.",
          );
        if (
          (
            await q.query(
              "SELECT 1 FROM vital_observations WHERE replaces_id=$1",
              [old.id],
            )
          ).rows.length
        )
          throw new ConflictException("Medição já retificada. Recarregue.");
      }
      const v = (
        await q.query(
          "INSERT INTO vital_observations(id,encounter_id,unit_id,author_id,observed_at,kind,value,measurement_unit,note,replaces_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            randomUUID(),
            e.id,
            e.unit_id,
            req.actor.id,
            b.observed_at,
            b.kind,
            b.value,
            vitalUnits[b.kind],
            b.note,
            b.replaces_id || null,
            b.reason,
          ],
        )
      ).rows[0];
      await audit(
        q,
        req.actor,
        b.replaces_id ? "clinical.vital.rectify" : "clinical.vital.record",
        v.id,
        req.correlation,
        b.reason,
      );
      return v;
    });
  }
  @Get("encounters/:id/vitals")
  @Permit("clinical.read")
  async vitals(@Req() req: any, @Param("id") eid: string, @Query() query: any) {
    const { page } = pagination.parse(query);
    return this.db.transaction(async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      const rows = (
        await q.query(
          "SELECT v.*,u.name AS author_name,EXISTS(SELECT 1 FROM vital_observations newer WHERE newer.replaces_id=v.id) AS superseded FROM vital_observations v JOIN users u ON u.id=v.author_id WHERE v.encounter_id=$1 AND v.unit_id=$2 ORDER BY v.created_at DESC,v.id LIMIT 10 OFFSET $3",
          [e.id, e.unit_id, (page - 1) * 10],
        )
      ).rows;
      const total = Number(
        (
          await q.query(
            "SELECT count(*) AS n FROM vital_observations WHERE encounter_id=$1 AND unit_id=$2",
            [e.id, e.unit_id],
          )
        ).rows[0].n,
      );
      await audit(q, req.actor, "clinical.vitals.read", e.id, req.correlation);
      return { rows, total, page };
    });
  }
  @Post("encounters/:id/documents")
  @Permit("clinical.create")
  async create(@Req() req: any, @Param("id") eid: string, @Body() body: any) {
    const b = z
      .object({
        confirmed_patient_id: z.uuid(),
        kind: z.enum(["evolucao", "anamnese", "alta"]),
        content,
      })
      .strict()
      .parse(body);
    return mutation(this.db, req, b, async (q) => {
      const e = await encounter(q, req, eid);
      await linked(q, req, e);
      open(e);
      if (e.patient_id !== b.confirmed_patient_id)
        throw new ConflictException("Identidade do paciente divergente.");
      if (!["medico", "enfermagem"].includes(req.actor.role_id) && !demoFullAccess(req.actor))
        throw new ForbiddenException();
      const d = (
        await q.query(
          "INSERT INTO clinical_documents(id,encounter_id,unit_id,author_id,category,kind,status,content) VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *",
          [
            randomUUID(),
            eid,
            e.unit_id,
            req.actor.id,
            demoFullAccess(req.actor) ? 'ti_demo' : req.actor.role_id,
            b.kind,
            b.content,
          ],
        )
      ).rows[0];
      await revision(q, req, d, "Criação de rascunho");
      return d;
    });
  }
  @Post("documents/:id/transition")
  @Permit("clinical.read")
  async transition(
    @Req() req: any,
    @Param("id") did: string,
    @Body() body: any,
  ) {
    z.uuid().parse(did);
    const b = z
      .object({
        action: z.enum(["update", "finalize", "rectify", "cancel"]),
        version: z.number().int().positive(),
        confirmed_patient_id: z.uuid(),
        reason,
        content: content.optional(),
      })
      .strict()
      .parse(body);
    const permission = {
      update: "clinical.update",
      finalize: "clinical.finalize",
      rectify: "clinical.rectify",
      cancel: "clinical.cancel",
    }[b.action];
    if (!req.actor.permissions.includes(permission))
      throw new ForbiddenException("Ação clínica não autorizada.");
    return mutation(this.db, req, b, async (q) => {
      // Lock encounter before document to keep the same ordering as discharge and creation.
      const lookup = (
        await q.query(
          "SELECT encounter_id FROM clinical_documents WHERE id=$1 AND unit_id=$2",
          [did, req.actor.unitId],
        )
      ).rows[0];
      if (!lookup) throw new NotFoundException("Documento não encontrado.");
      const e = await encounter(q, req, lookup.encounter_id);
      await linked(q, req, e);
      const d = (
        await q.query(
          "SELECT * FROM clinical_documents WHERE id=$1 FOR UPDATE",
          [did],
        )
      ).rows[0];
      if (!demoFullAccess(req.actor) && (d.author_id !== req.actor.id || d.category !== req.actor.role_id))
        throw new ForbiddenException(
          "Somente o autor na categoria original pode alterar este documento.",
        );
      if (e.patient_id !== b.confirmed_patient_id)
        throw new ConflictException("Identidade do paciente divergente.");
      if (d.version !== b.version)
        throw new ConflictException(
          "Documento atualizado por outra operação. Recarregue.",
        );
      if (d.status === "cancelled")
        throw new ConflictException("Documento cancelado é imutável.");
      if (["update", "finalize"].includes(b.action)) {
        open(e);
        if (d.status !== "draft")
          throw new ConflictException(
            "Documento finalizado exige retificação.",
          );
      }
      if (
        b.action === "rectify" &&
        !["finalized", "rectified"].includes(d.status)
      )
        throw new ConflictException("Finalize o documento antes de retificar.");
      if (["update", "rectify"].includes(b.action) && !b.content)
        throw new ConflictException(
          "Informe o conteúdo completo da nova versão.",
        );
      if (["finalize", "cancel"].includes(b.action) && b.content !== undefined)
        throw new ConflictException("Esta ação preserva o conteúdo existente.");
      const status = {
        update: "draft",
        finalize: "finalized",
        rectify: "rectified",
        cancel: "cancelled",
      }[b.action];
      const next = (
        await q.query(
          "UPDATE clinical_documents SET content=$1,status=$2,version=version+1,updated_at=now(),finalized_at=CASE WHEN $2='finalized' THEN now() ELSE finalized_at END WHERE id=$3 RETURNING *",
          [b.content ?? d.content, status, did],
        )
      ).rows[0];
      await revision(q, req, next, b.reason);
      return next;
    });
  }
  @Get("documents/:id/history")
  @Permit("clinical.read")
  async history(
    @Req() req: any,
    @Param("id") did: string,
    @Query() query: any,
  ) {
    z.uuid().parse(did);
    const { page } = pagination.parse(query);
    return this.db.transaction(async (q) => {
      const d = (
        await q.query(
          "SELECT * FROM clinical_documents WHERE id=$1 AND unit_id=$2",
          [did, req.actor.unitId],
        )
      ).rows[0];
      if (!d) throw new NotFoundException("Documento não encontrado.");
      const e = await encounter(q, req, d.encounter_id);
      await linked(q, req, e);
      await audit(q, req.actor, "clinical.history.read", did, req.correlation);
      return {
        rows: (
          await q.query(
            "SELECT r.*,u.name AS actor_name FROM clinical_revisions r JOIN users u ON u.id=r.actor_id WHERE document_id=$1 AND r.unit_id=$2 ORDER BY version DESC LIMIT 10 OFFSET $3",
            [did, req.actor.unitId, (page - 1) * 10],
          )
        ).rows,
        total: d.version,
        page,
      };
    });
  }
}
