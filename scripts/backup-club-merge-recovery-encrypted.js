#!/usr/bin/env node
import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const secret = process.env.CLUB_MERGE_BACKUP_KEY;
if (!secret || secret.length < 32) throw new Error("CLUB_MERGE_BACKUP_KEY must contain at least 32 characters");
const audits = await sql.query("select * from club_merge_audit order by club_merge_audit_id");
const clubs = await sql.query("select * from clubs order by club_id");
const aliases = await sql.query("select * from club_aliases order by club_id,normalized_alias");
const payload = Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), audits, clubs, aliases }));
const key = crypto.createHash("sha256").update(secret).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
const authTag = cipher.getAuthTag();
const backupId = `club_merge_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
await sql.query(`insert into encrypted_database_backups(backup_id,backup_type,algorithm,key_reference,iv,auth_tag,ciphertext,record_count,metadata)
  values($1,'club_merge_recovery','aes-256-gcm','CLUB_MERGE_BACKUP_KEY',$2,$3,$4,$5,$6::jsonb) on conflict(backup_id) do nothing`,
[backupId, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64"), audits.length + clubs.length + aliases.length, JSON.stringify({ formatVersion: 2, plaintextStored: false, auditRows: audits.length, clubRows: clubs.length, aliasRows: aliases.length })]);
console.log(JSON.stringify({ backupId, records: audits.length + clubs.length + aliases.length, audits: audits.length, clubs: clubs.length, aliases: aliases.length, algorithm: "aes-256-gcm", plaintextStored: false }, null, 2));
