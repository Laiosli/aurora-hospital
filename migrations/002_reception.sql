ALTER TABLE patients ADD CONSTRAINT patients_id_unit UNIQUE(id,unit_id);
ALTER TABLE sectors ADD CONSTRAINT sectors_id_unit UNIQUE(id,unit_id);
CREATE TABLE rooms(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),sector_id uuid NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true,UNIQUE(unit_id,name),UNIQUE(id,unit_id),FOREIGN KEY(sector_id,unit_id) REFERENCES sectors(id,unit_id));
CREATE TABLE schedules(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),room_id uuid NOT NULL,professional_id uuid NOT NULL,name text NOT NULL,specialty text NOT NULL,slot_minutes integer NOT NULL CHECK(slot_minutes BETWEEN 5 AND 240),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true,CHECK(ends_at>starts_at),UNIQUE(id,unit_id),FOREIGN KEY(room_id,unit_id) REFERENCES rooms(id,unit_id),FOREIGN KEY(professional_id,unit_id) REFERENCES user_units(user_id,unit_id));
CREATE INDEX schedules_time ON schedules(unit_id,starts_at,ends_at);
CREATE TABLE schedule_blocks(id uuid PRIMARY KEY,unit_id uuid NOT NULL,schedule_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),CHECK(ends_at>starts_at),FOREIGN KEY(schedule_id,unit_id) REFERENCES schedules(id,unit_id));
CREATE TABLE appointments(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),patient_id uuid NOT NULL,schedule_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','checked_in','cancelled','no_show')),version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES users(id),CHECK(ends_at>starts_at),UNIQUE(id,unit_id),FOREIGN KEY(patient_id,unit_id) REFERENCES patients(id,unit_id),FOREIGN KEY(schedule_id,unit_id) REFERENCES schedules(id,unit_id));
CREATE INDEX appointments_schedule ON appointments(schedule_id,starts_at,ends_at) WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX appointments_patient ON appointments(unit_id,patient_id,starts_at);
CREATE TABLE encounters(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),patient_id uuid NOT NULL,appointment_id uuid UNIQUE,sector_id uuid NOT NULL,modality text NOT NULL CHECK(modality IN ('ambulatorio','pronto_atendimento','internacao')),status text NOT NULL DEFAULT 'opened' CHECK(status IN ('opened','checked_in','triage','waiting','in_care','observation','admitted','discharged','cancelled')),version integer NOT NULL DEFAULT 1,opened_at timestamptz NOT NULL DEFAULT now(),stage_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),UNIQUE(id,unit_id),FOREIGN KEY(patient_id,unit_id) REFERENCES patients(id,unit_id),FOREIGN KEY(appointment_id,unit_id) REFERENCES appointments(id,unit_id),FOREIGN KEY(sector_id,unit_id) REFERENCES sectors(id,unit_id));
CREATE INDEX encounters_queue ON encounters(unit_id,status,stage_at);
CREATE TABLE beds(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),sector_id uuid NOT NULL,code text NOT NULL,state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','reserved','occupied','blocked','cleaning')),version integer NOT NULL DEFAULT 1,UNIQUE(unit_id,code),UNIQUE(id,unit_id),FOREIGN KEY(sector_id,unit_id) REFERENCES sectors(id,unit_id));
CREATE TABLE bed_allocations(id uuid PRIMARY KEY,unit_id uuid NOT NULL,bed_id uuid NOT NULL,encounter_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('reserved','occupied','ended','cancelled')),started_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),FOREIGN KEY(bed_id,unit_id) REFERENCES beds(id,unit_id),FOREIGN KEY(encounter_id,unit_id) REFERENCES encounters(id,unit_id));
CREATE UNIQUE INDEX bed_one_active ON bed_allocations(bed_id) WHERE status IN ('reserved','occupied');
CREATE UNIQUE INDEX encounter_one_bed ON bed_allocations(encounter_id) WHERE status IN ('reserved','occupied');
CREATE TABLE operational_events(id uuid PRIMARY KEY,unit_id uuid NOT NULL REFERENCES units(id),entity_type text NOT NULL,entity_id uuid NOT NULL,action text NOT NULL,from_state text,to_state text,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),correlation_id uuid NOT NULL,details jsonb NOT NULL DEFAULT '{}');
CREATE INDEX operational_history ON operational_events(unit_id,entity_type,entity_id,created_at);
CREATE TRIGGER operational_no_change BEFORE UPDATE OR DELETE ON operational_events FOR EACH ROW EXECUTE FUNCTION protect_audit();

-- A schema trigger serializes capacity checks even if two application workers race.
CREATE FUNCTION check_appointment_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen schedules%ROWTYPE;
BEGIN
  IF NEW.status IN ('cancelled','no_show') THEN RETURN NEW; END IF;
  PERFORM 1 FROM units WHERE id=NEW.unit_id FOR UPDATE;
  SELECT * INTO chosen FROM schedules WHERE id=NEW.schedule_id AND unit_id=NEW.unit_id;
  IF NOT EXISTS(SELECT 1 FROM users u JOIN user_units uu ON uu.user_id=u.id WHERE u.id=chosen.professional_id AND uu.unit_id=NEW.unit_id AND u.active AND u.role_id IN ('medico','enfermagem')) OR NOT EXISTS(SELECT 1 FROM rooms r WHERE r.id=chosen.room_id AND r.active) THEN RAISE EXCEPTION 'Profissional ou sala indisponível' USING ERRCODE='23514'; END IF;
  IF NOT chosen.active OR NEW.starts_at<chosen.starts_at OR NEW.ends_at>chosen.ends_at THEN RAISE EXCEPTION 'Fora da disponibilidade da agenda' USING ERRCODE='23514'; END IF;
  IF NEW.ends_at-NEW.starts_at <> make_interval(mins=>chosen.slot_minutes) THEN RAISE EXCEPTION 'Duração incompatível com agenda' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM schedule_blocks b JOIN schedules s ON s.id=b.schedule_id WHERE b.unit_id=NEW.unit_id AND (s.professional_id=chosen.professional_id OR s.room_id=chosen.room_id) AND b.starts_at<NEW.ends_at AND b.ends_at>NEW.starts_at) THEN RAISE EXCEPTION 'Horário bloqueado' USING ERRCODE='23P01'; END IF;
  IF EXISTS(SELECT 1 FROM appointments a JOIN schedules s ON s.id=a.schedule_id WHERE a.unit_id=NEW.unit_id AND a.id<>NEW.id AND a.status NOT IN ('cancelled','no_show') AND a.starts_at<NEW.ends_at AND a.ends_at>NEW.starts_at AND (s.professional_id=chosen.professional_id OR s.room_id=chosen.room_id OR a.patient_id=NEW.patient_id)) THEN RAISE EXCEPTION 'Conflito de horário' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_capacity BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION check_appointment_capacity();

UPDATE roles SET permissions=permissions || ARRAY['schedules.read','schedules.write','beds.read','beds.configure'] WHERE id='ti';
UPDATE roles SET permissions=permissions || ARRAY['schedules.read','beds.read'] WHERE id='gestao';
UPDATE roles SET permissions=permissions || ARRAY['schedules.read','appointments.read','appointments.write','encounters.read','encounters.create','encounters.route','encounters.cancel','beds.read','beds.allocate'] WHERE id='recepcao';
UPDATE roles SET permissions=permissions || ARRAY['schedules.read','appointments.read','encounters.read','encounters.triage','encounters.attend','encounters.discharge','beds.read','beds.allocate','beds.clean'] WHERE id IN ('medico','enfermagem');
