CREATE TABLE care_links(
 encounter_id uuid NOT NULL, unit_id uuid NOT NULL, user_id uuid NOT NULL,
 sector_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason)>=5),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(encounter_id,user_id),
 FOREIGN KEY(encounter_id,unit_id) REFERENCES encounters(id,unit_id),
 FOREIGN KEY(user_id,unit_id) REFERENCES user_units(user_id,unit_id),
 FOREIGN KEY(sector_id,unit_id) REFERENCES sectors(id,unit_id)
);
CREATE TABLE clinical_documents(
 id uuid PRIMARY KEY, encounter_id uuid NOT NULL, unit_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id), category text NOT NULL CHECK(category IN ('medico','enfermagem')),
 kind text NOT NULL CHECK(kind IN ('evolucao','anamnese','alta')),
 status text NOT NULL CHECK(status IN ('draft','finalized','rectified','cancelled')),
 content text NOT NULL CHECK(length(content) BETWEEN 5 AND 20000),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
 UNIQUE(id,unit_id), FOREIGN KEY(encounter_id,unit_id) REFERENCES encounters(id,unit_id)
);
CREATE INDEX clinical_encounter ON clinical_documents(unit_id,encounter_id,created_at DESC);
CREATE TABLE clinical_revisions(
 id uuid PRIMARY KEY, document_id uuid NOT NULL, unit_id uuid NOT NULL,
 version integer NOT NULL, status text NOT NULL, content text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), actor_role text NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,version), FOREIGN KEY(document_id,unit_id) REFERENCES clinical_documents(id,unit_id)
);
CREATE TRIGGER clinical_revision_immutable BEFORE UPDATE OR DELETE ON clinical_revisions FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE FUNCTION protect_clinical_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Documento não pode ser excluído'; END IF;
 IF NEW.author_id<>OLD.author_id OR NEW.encounter_id<>OLD.encounter_id OR NEW.unit_id<>OLD.unit_id OR NEW.kind<>OLD.kind OR NEW.category<>OLD.category OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Identidade ou versão clínica inválida'; END IF;
 IF OLD.status='cancelled' OR (OLD.status IN ('finalized','rectified') AND NEW.status NOT IN ('rectified','cancelled')) THEN RAISE EXCEPTION 'Estado clínico imutável'; END IF;
 IF OLD.status IN ('finalized','rectified') AND NEW.status='cancelled' AND NEW.content<>OLD.content THEN RAISE EXCEPTION 'Cancelamento deve preservar conteúdo'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clinical_document_protection BEFORE UPDATE OR DELETE ON clinical_documents FOR EACH ROW EXECUTE FUNCTION protect_clinical_document();
CREATE TRIGGER care_links_immutable BEFORE UPDATE OR DELETE ON care_links FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE TABLE allergy_assessments(
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, encounter_id uuid NOT NULL, unit_id uuid NOT NULL,
 version integer NOT NULL, state text NOT NULL CHECK(state IN ('not_investigated','unavailable','none_known','recorded')),
 entries jsonb NOT NULL DEFAULT '[]', reason text NOT NULL, author_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(patient_id,version),
 FOREIGN KEY(patient_id,unit_id) REFERENCES patients(id,unit_id),
 FOREIGN KEY(encounter_id,unit_id) REFERENCES encounters(id,unit_id),
 CHECK(jsonb_typeof(entries)='array'),
 CHECK((state='recorded' AND jsonb_array_length(entries)>0) OR (state<>'recorded' AND jsonb_array_length(entries)=0))
);
CREATE INDEX allergy_patient ON allergy_assessments(unit_id,patient_id,version DESC);
CREATE TRIGGER allergy_immutable BEFORE UPDATE OR DELETE ON allergy_assessments FOR EACH ROW EXECUTE FUNCTION protect_audit();
CREATE TABLE vital_observations(
 id uuid PRIMARY KEY, encounter_id uuid NOT NULL, unit_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id), observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK(kind IN ('temperature','heart_rate','respiratory_rate','saturation','systolic','diastolic','weight','height')),
 value numeric(12,3) NOT NULL,
 measurement_unit text NOT NULL,
 note text NOT NULL DEFAULT '',
 replaces_id uuid UNIQUE REFERENCES vital_observations(id), reason text NOT NULL,
 FOREIGN KEY(encounter_id,unit_id) REFERENCES encounters(id,unit_id),
 CHECK((kind='temperature' AND measurement_unit='°C') OR (kind='heart_rate' AND measurement_unit='bpm') OR (kind='respiratory_rate' AND measurement_unit='irpm') OR (kind='saturation' AND measurement_unit='%') OR (kind IN ('systolic','diastolic') AND measurement_unit='mmHg') OR (kind='weight' AND measurement_unit='kg') OR (kind='height' AND measurement_unit='cm'))
);
CREATE INDEX vitals_encounter ON vital_observations(unit_id,encounter_id,observed_at DESC);
CREATE TRIGGER vitals_immutable BEFORE UPDATE OR DELETE ON vital_observations FOR EACH ROW EXECUTE FUNCTION protect_audit();
UPDATE roles SET permissions=permissions || ARRAY['clinical.read','clinical.join','clinical.create','clinical.update','clinical.finalize','clinical.rectify','clinical.cancel'] WHERE id IN ('medico','enfermagem');
