UPDATE roles SET permissions=array_append(permissions,'backups.manage') WHERE id='ti' AND NOT ('backups.manage'=ANY(permissions));
