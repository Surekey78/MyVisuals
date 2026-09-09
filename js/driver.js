// js/driver.js — fake mysql2/promise driver over sql.js
// Implements createPool / createConnection API with real parameter binding.

import { exec, getDB, getCurrentDatabase } from './engine.js';

let latencyMs = 0;
export function setLatency(ms){ latencyMs = Math.max(0, Number(ms)||0); }
export function getLatency(){ return latencyMs; }

function sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

// Escape helper (very simple)
export function escape(val){
  if(val === null || val === undefined) return 'NULL';
  if(typeof val === 'number') return String(val);
  if(typeof val === 'boolean') return val ? '1' : '0';
  if(val instanceof Date) return `'${val.toISOString().slice(0,19).replace('T',' ')}'`;
  return `'${String(val).replace(/'/g,"''")}'`;
}
export function escapeId(id){
  return `"${String(id).replace(/"/g,'""')}"`;
}

function toMysqlError(formatted, raw){
  const err = new Error(formatted.mysqlStyled);
  err.code = formatted.code;
  err.errno = formatted.errno;
  err.sqlState = formatted.sqlState;
  err.sqlMessage = formatted.underlying;
  err.hint = formatted.hint;
  // also attach underlying
  err.cause = raw;
  return err;
}

function extractFields(columns){
  // mysql2 fields: [{name, type etc}]
  if(!columns) return [];
  return columns.map(name=>({ name, orgName:name, type:0 }));
}

// Connection class
class FakeConnection {
  constructor(config={}){
    this.config = config;
    this.inTransaction = false;
    this.released = false;
    this.id = Math.random().toString(36).slice(2,7);
  }
  async _delay(){
    if(latencyMs>0) await sleep(latencyMs);
  }
  // query: interpolates? In mysql2, query does formatting but we will treat same as execute (prepared)
  async query(sql, params){
    await this._delay();
    // Support params as array or object
    // For mysql2, query can take params array for placeholder replacement via ? (but not prepared on server)
    // We'll delegate to engine exec with binding.
    // Need to handle ? placeholders — engine supports it via prepare binding.
    // For named placeholders :name — engine supports via object.
    // For simple query without params, just exec.
    // For array params, we need to check if sql contains ? count matches.
    const useParams = params !== undefined && params !== null;
    const results = await exec(sql, { params: useParams ? params : null });
    if(!results || results.length===0){
      return [[], []];
    }
    // For query, mysql2 returns [rows, fields] for SELECT, and [result, fields] for write where result is OkPacket
    // If multiple statements? mysql2 doesn't allow multi by default unless multipleStatements:true. We will just return first.
    const r = results[0];
    if(!r.success){
      throw toMysqlError(r.error, r.rawError);
    }
    if(r.columns && r.columns.length>0){
      // SELECT
      const fields = extractFields(r.columns);
      return [r.rows, fields];
    } else {
      // Write
      const ok = {
        fieldCount:0,
        affectedRows: r.affectedRows ?? r.rowCount ?? 0,
        insertId: r.insertId ?? 0,
        info:'',
        serverStatus:0,
        warningStatus:0,
        changedRows: r.affectedRows ?? 0
      };
      return [ok, []];
    }
  }
  async execute(sql, params){
    // In mysql2, execute is prepared statement; behavior similar to query but with server-prepared.
    // For our shim, identical to query (real binding).
    return this.query(sql, params);
  }

  async beginTransaction(){
    await this._delay();
    const res = await exec('BEGIN');
    const r=res[0];
    if(!r.success) throw toMysqlError(r.error, r.rawError);
    this.inTransaction=true;
  }
  async commit(){
    await this._delay();
    const res = await exec('COMMIT');
    const r=res[0];
    if(!r.success) throw toMysqlError(r.error, r.rawError);
    this.inTransaction=false;
  }
  async rollback(){
    await this._delay();
    try{
      const res = await exec('ROLLBACK');
      // ignore error if no transaction
    }catch(e){}
    this.inTransaction=false;
  }
  async ping(){
    await this._delay();
    // no-op
    return;
  }
  async end(){
    this.released=true;
    // nothing to close; if in transaction, rollback?
    if(this.inTransaction){
      try{ await this.rollback(); }catch(e){}
    }
  }
  release(){
    this.released=false; // for pool, release just marks available
    // if pool, it will handle
  }
  // For compatibility with callback style? we only need promise.
  // Escape helpers on connection
  escape(val){ return escape(val); }
  escapeId(val){ return escapeId(val); }
}

// Pool class
class FakePool {
  constructor(config={}){
    this.config = config;
    this.connections=[];
    this.closed=false;
    // config options: connectionLimit, waitForConnections, database, etc. ignored but stored
    this.database = config.database || getCurrentDatabase();
  }
  async getConnection(){
    if(this.closed) throw new Error('Pool is closed');
    await sleep(latencyMs);
    const conn = new FakeConnection(this.config);
    // track
    this.connections.push(conn);
    // patch release to return to pool
    const origRelease = conn.release.bind(conn);
    conn.release = ()=>{
      // mark as released but keep in list
      conn.released=true;
      origRelease();
    };
    return conn;
  }
  async query(sql, params){
    const conn = await this.getConnection();
    try{
      const res = await conn.query(sql, params);
      return res;
    } finally {
      conn.release();
    }
  }
  async execute(sql, params){
    const conn = await this.getConnection();
    try{
      const res = await conn.execute(sql, params);
      return res;
    } finally {
      conn.release();
    }
  }
  async end(){
    this.closed=true;
    for(const c of this.connections){
      try{ await c.end(); }catch(e){}
    }
    this.connections=[];
  }
  // pool also has getConnection alias
  // escape
  escape(v){ return escape(v); }
  escapeId(v){ return escapeId(v); }
  // For mysql2/promise compatibility, pool has promise() that returns itself?
  promise(){ return this; }
}

export function createConnection(config){
  return new FakeConnection(config);
}
export function createPool(config){
  return new FakePool(config);
}
// For require('mysql2/promise')
export const mysqlPromise = {
  createConnection: (cfg)=> Promise.resolve(createConnection(cfg)),
  createPool: (cfg)=> createPool(cfg),
  escape,
  escapeId
};
export const mysql2 = {
  createConnection,
  createPool,
  escape,
  escapeId,
  promise: mysqlPromise
};

// Default export for require shim
export default {
  createConnection,
  createPool,
  createPoolAsync: (cfg)=> Promise.resolve(createPool(cfg)),
  escape,
  escapeId
};

// Helper to expose globally for sandbox
if(typeof window !== 'undefined'){
  window.__mysqlDriver = { createConnection, createPool, escape, escapeId, setLatency };
}
