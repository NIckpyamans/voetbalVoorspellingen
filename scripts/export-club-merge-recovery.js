#!/usr/bin/env node
import fs from "fs"; import path from "path"; import {getSql,loadLocalEnv} from "../shared/database.js";
loadLocalEnv(process.cwd());const sql=getSql();if(!sql)process.exit(2);
const audits=await sql.query("select * from club_merge_audit order by club_merge_audit_id");
const file=path.join(process.cwd(),"database","backfills","club-merge-recovery.json");
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({generatedAt:new Date().toISOString(),audits},null,2)+"\n");
console.log(JSON.stringify({file,audits:audits.length},null,2));
