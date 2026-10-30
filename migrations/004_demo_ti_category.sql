ALTER TABLE clinical_documents DROP CONSTRAINT clinical_documents_category_check;
ALTER TABLE clinical_documents ADD CONSTRAINT clinical_documents_category_check CHECK(category IN ('medico','enfermagem','ti_demo'));
