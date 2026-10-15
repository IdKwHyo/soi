export const MAX_WORKSPACE_BYTES = 1_500_000;
const MAX_RECORDS=1500,MAX_RECORD_BYTES=8_000_000,MAX_RAW_ARCHIVE_BYTES=32_000_000,MAX_MUTATIONS=1500;
const COLLECTIONS = {datasets:'dataset',imports:'import',memories:'memory',runs:'run',campaigns:'campaign',results:'result',receipts:'receipt',receiptUploads:'receipt-upload'};
const MAX_CACHE_ENTRIES=700,MAX_CACHE_BYTES=8_000_000;
const json = value => JSON.stringify(value);

export class RevisionConflict extends Error {
  constructor() { super('This workspace changed in another tab. Reload it before trying again.'); this.name='RevisionConflict'; }
}
class StorageUnavailable extends Error {
  constructor(){super('Workspace storage is temporarily unavailable. Try again.');this.status=503;}
}
export class WorkspaceLimitError extends Error {
  constructor(){super('This workspace has reached its saved-history capacity. Export it before adding more history.');this.status=422;}
}

// This adapter is the only place that knows the D1 schema and private R2 keys.
// The test adapter executes these same SQL statements against real SQLite.
export function createStorage(env) {
  if (!env.DB || !env.BUCKET) return null;
  const db=env.DB;
  const prepare=(sql,...values)=>db.prepare(sql).bind(...values);
  const ownedQuery=`SELECT w.business_id, w.revision, w.payload FROM workspaces w
    JOIN memberships m ON m.business_id=w.business_id WHERE m.user_id=? AND m.role='owner'`;
  async function load(userId, createWorkspace) {
    let row=await prepare(ownedQuery,userId).first();
    if(!row) {
      const id=crypto.randomUUID(),now=new Date().toISOString(),state=createWorkspace();
      state.id=id; state.revision=0;
      const payload=json(state);
      const initial=[
        prepare('INSERT OR IGNORE INTO businesses(id,owner_user_id,created_at) VALUES(?,?,?)',id,userId,now),
        prepare("INSERT OR IGNORE INTO memberships(user_id,business_id,role) SELECT ?,id,'owner' FROM businesses WHERE owner_user_id=?",userId,userId),
        prepare(`INSERT OR IGNORE INTO workspaces(business_id,revision,payload,last_mutation,updated_at)
          SELECT id,0,?,'initial',? FROM businesses WHERE owner_user_id=?`,payload,now,userId)
      ];
      for(const [field,kind] of Object.entries(COLLECTIONS))for(const item of state[field]||[])initial.push(prepare(`INSERT OR IGNORE INTO records(business_id,kind,record_id,revision,payload,created_at)
        SELECT ?,?,?,0,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE business_id=? AND last_mutation='initial')`,id,kind,item.id,json(item),item.createdAt||item.updatedAt||now,id));
      await db.batch(initial);
      row=await prepare(ownedQuery,userId).first();
    }
    if(!row)throw Error('Workspace storage is temporarily unavailable.');
    const state=JSON.parse(row.payload);state.id=row.business_id;state.revision=row.revision;
    return {businessId:row.business_id,state};
  }
  async function assertFits(businessId,state,previousState) {
    if(new TextEncoder().encode(json(state)).byteLength>MAX_WORKSPACE_BYTES)throw new WorkspaceLimitError();
    let addedCount=0,addedBytes=0,addedRawBytes=0;
    for(const field of Object.keys(COLLECTIONS)) {
      const old=new Set((previousState?.[field]||[]).map(item=>item.id));
      for(const item of state[field]||[])if(!old.has(item.id)) {
        addedCount++;addedBytes+=new TextEncoder().encode(json(item)).byteLength;
        if(field==='imports')addedRawBytes+=item.rawArchive?.rawBytes||item.rawGzip?.rawBytes||0;
        if(field==='receiptUploads')addedRawBytes+=item.bytes||0;
      }
    }
    const existing=await prepare(`SELECT count(*) AS records,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes,
      coalesce(sum(CASE WHEN kind='import' THEN json_extract(payload,'$.rawArchive.rawBytes') WHEN kind='receipt-upload' THEN json_extract(payload,'$.bytes') ELSE 0 END),0) AS raw_bytes
      FROM records WHERE business_id=?`,businessId).first();
    const audit=await prepare('SELECT count(*) AS mutations FROM mutation_audit WHERE business_id=?',businessId).first();
    if(existing.records+addedCount>MAX_RECORDS||existing.bytes+addedBytes>MAX_RECORD_BYTES||existing.raw_bytes+addedRawBytes>MAX_RAW_ARCHIVE_BYTES||audit.mutations>=MAX_MUTATIONS)throw new WorkspaceLimitError();
  }
  async function archive(businessId, imported,state,previousState) {
    if(!imported.rawGzip || imported.rawGzip.encoding!=='gzip-base64')throw Error('Lossless compression is unavailable for this upload.');
    const archive=imported.rawGzip;
    const bytes=Uint8Array.from(atob(archive.data),char=>char.charCodeAt(0));
    if(bytes.length!==archive.gzipBytes||!/^[a-f0-9]{64}$/.test(archive.sha256))throw Error('The upload archive metadata is invalid.');
    const key=`${businessId}/originals/${imported.id}-${archive.sha256}.csv.gz`;
    // Original files never have a public URL. The key is scoped to the owner.
    imported.rawArchive={key,encoding:'gzip',sha256:archive.sha256,rawBytes:archive.rawBytes,gzipBytes:archive.gzipBytes};
    delete imported.rawGzip;
    await assertFits(businessId,state,previousState);
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:'application/gzip'},customMetadata:{sha256:archive.sha256,rawBytes:String(archive.rawBytes)}});
    return key;
  }
  async function releaseArchive(businessId,key) {
    if(!key?.startsWith(`${businessId}/originals/`))return false;
    try {
      const referenced=await prepare("SELECT 1 AS found FROM records WHERE business_id=? AND kind='import' AND json_extract(payload,'$.rawArchive.key')=? LIMIT 1",businessId,key).first();
      if(referenced)return false;
      await env.BUCKET.delete(key);return true;
    } catch{return false;} // Ambiguous commits retain the file for reconciliation.
  }
  async function archiveReceipt(businessId,upload,bytes,state,previousState) {
    if(!upload.key?.startsWith(`${businessId}/receipts/`)||!(bytes instanceof Uint8Array)||bytes.byteLength!==upload.bytes)throw Error('The receipt source metadata is invalid.');
    await assertFits(businessId,state,previousState);
    await env.BUCKET.put(upload.key,bytes,{httpMetadata:{contentType:upload.contentType},customMetadata:{sha256:upload.sha256}});
    return upload.key;
  }
  async function releaseReceipt(businessId,key) {
    if(!key?.startsWith(`${businessId}/receipts/`))return false;
    try {
      const referenced=await prepare("SELECT 1 AS found FROM records WHERE business_id=? AND kind='receipt-upload' AND json_extract(payload,'$.key')=? LIMIT 1",businessId,key).first();
      if(referenced)return false;
      await env.BUCKET.delete(key);return true;
    } catch{return false;}
  }
  async function cached(businessId,key) {
    const row=await prepare('SELECT payload FROM model_cache WHERE business_id=? AND cache_key=? AND expires_at>?',businessId,key,new Date().toISOString()).first();
    return row?JSON.parse(row.payload):null;
  }
  async function cachedMany(businessId,keys) {
    const values=new Map(),now=new Date().toISOString();
    for(let offset=0;offset<keys.length;offset+=80) {
      const part=keys.slice(offset,offset+80);if(!part.length)continue;
      const result=await prepare(`SELECT cache_key,payload FROM model_cache WHERE business_id=? AND expires_at>? AND cache_key IN (${part.map(()=>'?').join(',')})`,businessId,now,...part).all();
      for(const row of result.results||[])values.set(row.cache_key,JSON.parse(row.payload));
    }
    return values;
  }
  async function save(userId,businessId,state,expectedRevision,action,{cache,caches=[],previousState}={}) {
    const revision=expectedRevision+1,mutation=crypto.randomUUID(),now=new Date().toISOString();
    state.id=businessId;state.revision=revision;
    const payload=json(state);
    await assertFits(businessId,state,previousState);
    const statements=[prepare(`UPDATE workspaces SET revision=?,payload=?,last_mutation=?,updated_at=?
      WHERE business_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE user_id=? AND business_id=? AND role='owner')`,
      revision,payload,mutation,now,businessId,expectedRevision,userId,businessId)];
    const guard='EXISTS(SELECT 1 FROM workspaces WHERE business_id=? AND last_mutation=?)';
    statements.push(prepare(`INSERT INTO mutation_audit(id,business_id,revision,action,created_at) SELECT ?,?,?,?,? WHERE ${guard}`,mutation,businessId,revision,action,now,businessId,mutation));
    for(const [field,kind] of Object.entries(COLLECTIONS)) {
      const previousIds=new Set((previousState?.[field]||[]).map(item=>item.id));
      for(const item of state[field]||[]) {
        if(previousIds.has(item.id))continue;
        if(typeof item.id!=='string')throw Error('A historical record has no identifier.');
        statements.push(prepare(`INSERT OR IGNORE INTO records(business_id,kind,record_id,revision,payload,created_at)
          SELECT ?,?,?,?,?,? WHERE ${guard}`,businessId,kind,item.id,revision,json(item),item.createdAt||item.updatedAt||now,businessId,mutation));
      }
    }
    // Caches are disposable accelerators. They must never stop a valid owner
    // mutation or ask the merchant to export business history.
    const proposed=[...new Map([...caches,...(cache?[cache]:[])].map(entry=>[entry.key,entry])).values()];
    const entries=[];let incomingBytes=0;
    for(const entry of proposed) {
      if(typeof entry.key!=='string'||entry.key.length>150)continue;
      const bytes=new TextEncoder().encode(json(entry.value)).byteLength;
      if(bytes>100_000||incomingBytes+bytes>MAX_CACHE_BYTES||entries.length>=MAX_CACHE_ENTRIES)continue;
      entries.push({...entry,bytes});incomingBytes+=bytes;
    }
    if(entries.length) {
      const existing=await prepare('SELECT cache_key,length(CAST(payload AS BLOB)) AS bytes FROM model_cache WHERE business_id=? AND expires_at>? ORDER BY expires_at,cache_key',businessId,now).all();
      const incomingKeys=new Set(entries.map(entry=>entry.key)),older=(existing.results||[]).filter(row=>!incomingKeys.has(row.cache_key));
      let count=older.length+entries.length,bytes=older.reduce((sum,row)=>sum+row.bytes,0)+incomingBytes;
      const evicted=[];
      for(const row of older) {
        if(count<=MAX_CACHE_ENTRIES&&bytes<=MAX_CACHE_BYTES)break;
        evicted.push(row.cache_key);count--;bytes-=row.bytes;
      }
      for(let offset=0;offset<evicted.length;offset+=80) {
        const keys=evicted.slice(offset,offset+80);
        statements.push(prepare(`DELETE FROM model_cache WHERE business_id=? AND cache_key IN (${keys.map(()=>'?').join(',')}) AND ${guard}`,businessId,...keys,businessId,mutation));
      }
    }
    for(const entry of entries)statements.push(prepare(`INSERT INTO model_cache(business_id,cache_key,payload,expires_at)
      SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(business_id,cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,
      businessId,entry.key,json(entry.value),entry.expiresAt,businessId,mutation));
    statements.push(prepare(`DELETE FROM model_cache WHERE business_id=? AND expires_at<=? AND ${guard}`,businessId,now,businessId,mutation));
    // D1 executes a batch transactionally. Child writes are guarded by the
    // successful CAS mutation token, so a stale update cannot leak records.
    const result=await db.batch(statements);
    if(result[0]?.meta?.changes!==1)throw new RevisionConflict();
    return state;
  }
  const protectedCall=fn=>async(...args)=>{
    try{return await fn(...args);}
    catch(error){if(error instanceof RevisionConflict||error instanceof WorkspaceLimitError)throw error;throw new StorageUnavailable();}
  };
  return {load:protectedCall(load),archive:protectedCall(archive),releaseArchive,archiveReceipt:protectedCall(archiveReceipt),releaseReceipt,cached:protectedCall(cached),cachedMany:protectedCall(cachedMany),save:protectedCall(save)};
}
