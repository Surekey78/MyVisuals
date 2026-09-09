// js/engine.js — sql.js bootstrap + MySQL compatibility layer
// Single DB instance, all access through this module.

export const SAMPLE_SQL = `
-- MySQL Playground Studio — Sample E-Commerce Database (shop)
-- Customers, Categories, Products, Orders, Order Items

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS customers;

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  city VARCHAR(80) DEFAULT 'Unknown',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  stock INT DEFAULT 0,
  status ENUM('active','discontinued') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_price ON products(price);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE VIEW order_summary AS
SELECT o.id AS order_id, c.name AS customer, o.total, o.status, o.created_at
FROM orders o JOIN customers c ON c.id = o.customer_id;

INSERT INTO customers (name, email, city) VALUES
('Ada Lovelace','ada@example.com','London'),
('Grace Hopper','grace@example.com','New York'),
('Alan Turing','alan@example.com','Cambridge'),
('Barbara Liskov','barbara@example.com','Boston'),
('Linus Torvalds','linus@example.com','Helsinki');

INSERT INTO categories (name, description) VALUES
('Computers','Desktops and laptops'),
('Accessories','Keyboards, mice, cables'),
('Software','Licenses and subscriptions');

INSERT INTO products (category_id, name, price, stock, status) VALUES
(1, 'Laptop Pro 14"', 1299.00, 25, 'active'),
(1, 'Desktop Mini', 799.50, 12, 'active'),
(2, 'Mechanical Keyboard', 89.99, 100, 'active'),
(2, 'Wireless Mouse', 29.99, 200, 'active'),
(2, 'USB-C Hub', 49.50, 60, 'active'),
(3, 'IDE License (1yr)', 149.00, 999, 'active'),
(3, 'Cloud Storage 1TB', 99.00, 999, 'active'),
(1, 'Old CRT Monitor', 49.99, 2, 'discontinued');

INSERT INTO orders (customer_id, total, status) VALUES
(1, 1388.99, 'paid'),
(2, 119.98, 'pending'),
(3, 179.00, 'shipped'),
(1, 99.00, 'paid'),
(4, 848.99, 'paid'),
(5, 29.99, 'cancelled');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 1299.00),
(1, 3, 1, 89.99),
(2, 3, 1, 89.99),
(2, 4, 1, 29.99),
(3, 6, 1, 149.00),
(3, 5, 1, 49.50),
(4, 7, 1, 99.00),
(5, 2, 1, 799.50),
(5, 5, 1, 49.50),
(6, 4, 1, 29.99);
`;

const DB_KEY = 'mysql-playground-db-v1';
const IDB_NAME = 'MySQLPlaygroundStudio';
const IDB_STORE = 'kv';
const META_TABLE = '_mysql_meta'; // stores original MySQL types etc.

let SQL = null;
let db = null;
let currentDatabase = 'shop';
const knownDatabases = new Set(['shop', 'test', 'information_schema']);
let isReady = false;
let readyPromise = null;
let persistTimer = null;
let lastPersistMethod = 'indexedDB';

function log(...args){ /* console.debug('[engine]', ...args) */ }

// ---------- Persistence ----------
function openIDB(){
  return new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbGet(key){
  const idb = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = idb.transaction(IDB_STORE,'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbSet(key, val){
  const idb = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = idb.transaction(IDB_STORE,'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(val, key);
    req.onsuccess = ()=> resolve();
    req.onerror = ()=> reject(req.error);
  });
}
async function idbDel(key){
  const idb = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = idb.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).delete(key).onsuccess = ()=> resolve();
    tx.objectStore(IDB_STORE).delete(key).onerror = ()=> reject(tx.error);
  });
}

function toBase64(u8){
  let binary = '';
  const chunk = 8192;
  for(let i=0;i<u8.length;i+=chunk){
    binary += String.fromCharCode(...u8.subarray(i,i+chunk));
  }
  return btoa(binary);
}
function fromBase64(b64){
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) u8[i]=binary.charCodeAt(i);
  return u8;
}

async function persist(){
  if(!db) return;
  try{
    const data = db.export(); // Uint8Array
    try{
      await idbSet(DB_KEY, data);
      lastPersistMethod = 'indexedDB';
      // also clear fallback
      localStorage.removeItem(DB_KEY+'-b64');
    }catch(e){
      // fallback to localStorage
      log('IDB persist failed, fallback localStorage', e);
      try{
        localStorage.setItem(DB_KEY+'-b64', toBase64(data));
        lastPersistMethod = 'localStorage';
      }catch(e2){
        lastPersistMethod = 'none';
        throw e2;
      }
    }
    // also store currentDatabase
    localStorage.setItem(DB_KEY+'-currentDB', currentDatabase);
  }catch(e){
    console.warn('persist failed', e);
    throw e;
  }
}
function schedulePersist(){
  clearTimeout(persistTimer);
  persistTimer = setTimeout(()=>{ persist().catch(()=>{}); }, 300);
}

async function restore(){
  // try IDB
  let data = null;
  try{
    data = await idbGet(DB_KEY);
    if(data) {
      lastPersistMethod = 'indexedDB';
    }
  }catch(e){ /* ignore */ }
  if(!data){
    const b64 = localStorage.getItem(DB_KEY+'-b64');
    if(b64){
      try{ data = fromBase64(b64); lastPersistMethod='localStorage'; }catch(e){}
    }
  }
  const savedDB = localStorage.getItem(DB_KEY+'-currentDB');
  if(savedDB) { currentDatabase = savedDB; knownDatabases.add(savedDB); }
  if(data && data.length){
    try{
      db = new SQL.Database(data);
      // ensure FK on
      db.exec("PRAGMA foreign_keys = ON;");
      ensureMeta();
      isReady = true;
      return true;
    }catch(e){
      console.warn('restore failed, creating fresh', e);
    }
  }
  // fresh
  db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON;");
  ensureMeta();
  isReady = true;
  await persist();
  return false;
}

function ensureMeta(){
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS "${META_TABLE}" (k TEXT PRIMARY KEY, v TEXT);`);
    // store db name meta?
  }catch(e){ console.warn(e) }
}

// ---------- MySQL Compatibility ----------
function translateSQL(original){
  let sql = original;
  const notes = [];
  const was = {};

  // Trim
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  // Intercept meta commands FIRST (do not translate)
  // We'll handle them in exec layer, but here we detect to avoid mangling.
  const isMeta = /^(SHOW\s+DATABASES|SHOW\s+TABLES|SHOW\s+CREATE\s+TABLE|SHOW\s+COLUMNS|SHOW\s+INDEX|DESCRIBE\s+|DESC\s+|EXPLAIN\s+|USE\s+)/i.test(trimmed);
  if(isMeta){
    // still do minimal backtick handling for table names in SHOW etc, but not full translation
    return { original, translated: sql, wasRewritten:false, notes: ['Meta command emulated via PRAGMA/sqlite_master'], meta:true };
  }

  let translated = sql;

  // 1. Strip ENGINE, CHARSET, COLLATE, etc.
  const beforeStrip = translated;
  translated = translated.replace(/\s*ENGINE\s*=\s*\w+/gi, '');
  translated = translated.replace(/\s*DEFAULT\s+CHARSET\s*=?\s*\w+/gi, '');
  translated = translated.replace(/\s*DEFAULT\s+CHARACTER\s+SET\s*=?\s*\w+/gi, '');
  translated = translated.replace(/\s*CHARSET\s*=?\s*\w+/gi, '');
  translated = translated.replace(/\s*COLLATE\s*=?\s*[\w_]+/gi, '');
  translated = translated.replace(/\s*ROW_FORMAT\s*=\s*\w+/gi, '');
  translated = translated.replace(/\s*AUTO_INCREMENT\s*=\s*\d+/gi, ''); // table option
  if(translated !== beforeStrip) notes.push('Stripped MySQL table options (ENGINE, CHARSET, COLLATE, AUTO_INCREMENT=n)');

  // 2. Backticks -> double quotes
  if(/`/.test(translated)){
    translated = translated.replace(/`([^`]+)`/g, '"$1"');
    notes.push('Converted backtick identifiers to quoted identifiers');
  }

  // 3. Types
  // We keep track if type replacement happened
  const typeMap = [
    { re:/\bTINYINT\s*\(\s*\d+\s*\)/gi, to:'INTEGER' },
    { re:/\bTINYINT\b/gi, to:'INTEGER' },
    { re:/\bSMALLINT\b/gi, to:'INTEGER' },
    { re:/\bMEDIUMINT\b/gi, to:'INTEGER' },
    { re:/\bINT\s*\(\s*\d+\s*\)/gi, to:'INTEGER' },
    { re:/\bINT\b/gi, to:'INTEGER' },
    { re:/\bBIGINT\b/gi, to:'INTEGER' },
    { re:/\bUNSIGNED\b/gi, to:'' },
    { re:/\bVARCHAR\s*\(\s*\d+\s*\)/gi, to:'TEXT' },
    { re:/\bCHAR\s*\(\s*\d+\s*\)/gi, to:'TEXT' },
    { re:/\bVARCHAR\b/gi, to:'TEXT' },
    { re:/\bCHARACTER\s+VARYING\s*\(\s*\d+\s*\)/gi, to:'TEXT' },
    { re:/\bDECIMAL\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, to:'REAL' },
    { re:/\bDECIMAL\s*\(\s*\d+\s*\)/gi, to:'REAL' },
    { re:/\bNUMERIC\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, to:'REAL' },
    { re:/\bFLOAT\b/gi, to:'REAL' },
    { re:/\bDOUBLE\b/gi, to:'REAL' },
    { re:/\bDATETIME\b/gi, to:'TEXT' },
    { re:/\bTIMESTAMP\b/gi, to:'TEXT' },
    { re:/\bDATE\b/gi, to:'TEXT' },
    { re:/\bBOOLEAN\b/gi, to:'INTEGER' },
    { re:/\bBOOL\b/gi, to:'INTEGER' },
  ];
  let typeChanged=false;
  for(const m of typeMap){
    if(m.re.test(translated)){
      translated = translated.replace(m.re, m.to);
      typeChanged=true;
    }
    // reset lastIndex for global
    m.re.lastIndex=0;
  }
  if(typeChanged) notes.push('Mapped MySQL types to SQLite affinities (INT→INTEGER, VARCHAR→TEXT, DECIMAL/FLOAT→REAL, DATETIME→TEXT, BOOLEAN→INTEGER)');

  // ENUM handling: ENUM('a','b') -> TEXT CHECK (col IN ('a','b'))
  // This is tricky because we need column name. We'll do heuristic: find ENUM(...) and replace with TEXT + CHECK
  // Pattern: "colName" TEXT ... maybe we captured after type mapping? Actually ENUM still present until now, we map ENUM after typeMap? We didn't map ENUM yet.
  // Find ENUM occurrences
  if(/ENUM\s*\(/i.test(translated)){
    // Replace ENUM('a','b') with TEXT and add CHECK if possible
    // Approach: regex to capture column definition: "col" TEXT? But we haven't converted ENUM yet.
    // Let's do replacement that injects CHECK immediately after TEXT.
    translated = translated.replace(/ENUM\s*\(([^)]+)\)/gi, (match, inside)=>{
      // keep values as is for CHECK
      // We'll produce TEXT CHECK ("__col__" IN (...)) but we don't know col name here, so fallback to TEXT with comment
      // Instead produce TEXT -- ENUM values replaced; add note
      notes.push(`ENUM converted to TEXT + CHECK IN (${inside})`);
      // We will later try to inject CHECK with correct column by post-processing column defs? For now simple TEXT
      // To properly add CHECK, we need to find preceding identifier.
      // We'll return TEXT and rely on next step to wrap?
      return `TEXT CHECK (value IN (${inside}))`.replace('value','"enum_check"'); // placeholder, will be heuristic
    });
    // More accurate: if we can detect column name before ENUM, we did not. So we keep generic and later fix placeholder?
    // Simpler: just convert to TEXT and note enum values; the CHECK placeholder will be wrong but we can clean it: remove it if not accurate.
    // Remove placeholder CHECK if not inside CREATE TABLE column context properly? We'll strip placeholder and just leave TEXT.
    translated = translated.replace(/TEXT CHECK \("enum_check" IN \(([^)]+)\)\)/gi, 'TEXT');
    // Actually note enum lost; but we at least preserved as TEXT. Add proper CHECK by detecting column name via second pass:
    // Find pattern: "col" TEXT, with original ENUM values? We lost values. So we need to preserve original ENUM string before replacement.
    // Let's do better: re-parse original for ENUM columns and patch translated.
    try{
      const enumCols = [...original.matchAll(/`?(\w+)`?\s+ENUM\s*\(([^)]+)\)/gi)];
      for(const ec of enumCols){
        const col = ec[1];
        const vals = ec[2];
        // In translated, find "\"col\" TEXT" and add CHECK
        const colRe = new RegExp(`"${col}"\\s+TEXT`, 'i');
        if(colRe.test(translated)){
          translated = translated.replace(colRe, `"${col}" TEXT CHECK ("${col}" IN (${vals}))`);
        } else {
          // fallback: find col TEXT
          const colRe2 = new RegExp(`\\b${col}\\b\\s+TEXT`, 'i');
          if(colRe2.test(translated)){
            translated = translated.replace(colRe2, `${col} TEXT CHECK ("${col}" IN (${vals}))`);
          }
        }
      }
    }catch(e){}
    if(!notes.some(n=>n.includes('ENUM'))){
      notes.push('ENUM → TEXT (+ CHECK constraint when column detectable)');
    }
  }

  // 4. Functions
  if(/\bNOW\s*\(\s*\)/i.test(translated)){
    translated = translated.replace(/\bNOW\s*\(\s*\)/gi, "CURRENT_TIMESTAMP");
    notes.push('NOW() → CURRENT_TIMESTAMP');
  }
  // CURRENT_TIMESTAMP is natively supported by SQLite — keep as is (no rewrite needed)
  // but ensure DEFAULT CURRENT_TIMESTAMP stays valid (SQLite requires literal or parenthesized expr)
  if(/\bCURDATE\s*\(\s*\)/i.test(translated)){
    translated = translated.replace(/\bCURDATE\s*\(\s*\)/gi, "CURRENT_DATE");
    notes.push('CURDATE() → CURRENT_DATE');
  }
  // Normalize bare datetime('now') used as DEFAULT (SQLite requires DEFAULT (expr) for function calls)
  // If user wrote DEFAULT datetime('now'), wrap it
  translated = translated.replace(/\bDEFAULT\s+datetime\('now'\)/gi, "DEFAULT (datetime('now'))");
  translated = translated.replace(/\bDEFAULT\s+date\('now'\)/gi, "DEFAULT (date('now'))");
  // Also handle CURRENT_TIMESTAMP vs datetime('now') consistency: keep CURRENT_TIMESTAMP
  // IFNULL is supported as IFNULL or COALESCE -> keep
  // CONCAT(a,b,c) -> (a || b || c)
  if(/\bCONCAT\s*\(/i.test(translated)){
    translated = translated.replace(/\bCONCAT\s*\(([^)]+)\)/gi, (m, args)=>{
      // split args by commas outside quotes (simple)
      const parts = splitArgs(args);
      return '(' + parts.join(' || ') + ')';
    });
    notes.push('CONCAT(a,b) → (a || b)');
  }
  // YEAR(col) -> CAST(strftime('%Y', col) AS INTEGER)
  if(/\bYEAR\s*\(/i.test(translated)){
    translated = translated.replace(/\bYEAR\s*\(\s*([^)]+)\s*\)/gi, "CAST(strftime('%Y', $1) AS INTEGER)");
    notes.push('YEAR(x) → CAST(strftime(\'%Y\', x) AS INTEGER)');
  }
  if(/\bMONTH\s*\(/i.test(translated)){
    translated = translated.replace(/\bMONTH\s*\(\s*([^)]+)\s*\)/gi, "CAST(strftime('%m', $1) AS INTEGER)");
    notes.push('MONTH(x) → CAST(strftime(\'%m\', x) AS INTEGER)');
  }
  if(/\bDAY\s*\(/i.test(translated)){
    translated = translated.replace(/\bDAY\s*\(\s*([^)]+)\s*\)/gi, "CAST(strftime('%d', $1) AS INTEGER)");
    notes.push('DAY(x) → CAST(strftime…');
  }
  // DATE_FORMAT(col, '%Y-%m-%d') -> strftime
  if(/\bDATE_FORMAT\s*\(/i.test(translated)){
    translated = translated.replace(/\bDATE_FORMAT\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi, (m, col, fmt)=>{
      // fmt is like '%Y-%m-%d' — map directly to strftime first arg
      return `strftime(${fmt}, ${col})`;
    });
    notes.push("DATE_FORMAT(x, fmt) → strftime(fmt, x)");
  }

  // LIMIT x, y  -> LIMIT y OFFSET x
  const limitRe = /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi;
  if(limitRe.test(translated)){
    translated = translated.replace(limitRe, 'LIMIT $2 OFFSET $1');
    notes.push('LIMIT x, y → LIMIT y OFFSET x');
  }

  // ON DUPLICATE KEY UPDATE -> ON CONFLICT DO UPDATE SET
  if(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(translated)){
    translated = translated.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, 'ON CONFLICT DO UPDATE SET');
    // Need to handle that SQLite needs conflict target; if original had no specification, this generic will work for most simple cases where PK collision.
    // For more accurate, we could extract the update assignments and keep.
    notes.push('ON DUPLICATE KEY UPDATE → ON CONFLICT DO UPDATE SET (SQLite UPSERT)');
  }

  // REPLACE -> INSERT OR REPLACE ?
  // SQLite supports REPLACE as alias for INSERT OR REPLACE, keep but note
  if(/^\s*REPLACE\s+INTO/i.test(translated)){
    // keep as is, SQLite supports REPLACE
    notes.push('REPLACE INTO kept (SQLite treats as INSERT OR REPLACE)');
  }

  // AUTO_INCREMENT -> AUTOINCREMENT handling
  if(/AUTO_INCREMENT/i.test(sql) || /AUTOINCREMENT/i.test(translated)){
    // Already converted INT etc, now normalize AUTOINCREMENT placement
    // Ensure we have replaced
    translated = translated.replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT');
    // Fix common pattern: INTEGER ... AUTOINCREMENT PRIMARY KEY  -> INTEGER PRIMARY KEY AUTOINCREMENT
    translated = translated.replace(/INTEGER\s+AUTOINCREMENT\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    translated = translated.replace(/AUTOINCREMENT\s+INTEGER\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    // If column is INTEGER AUTOINCREMENT without PRIMARY KEY, SQLite requires INTEGER PRIMARY KEY; add it
    // Heuristic: if line has AUTOINCREMENT but no PRIMARY KEY, add PRIMARY KEY
    // Find occurrences: "col" INTEGER AUTOINCREMENT -> "col" INTEGER PRIMARY KEY AUTOINCREMENT
    translated = translated.replace(/INTEGER\s+AUTOINCREMENT(?!\s+PRIMARY\s+KEY)/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    // Also handle case: INTEGER PRIMARY KEY not yet but AUTOINCREMENT alone -> already handled
    // Also enforce that AUTOINCREMENT columns are INTEGER PRIMARY KEY ; if still "TEXT ... AUTOINCREMENT" (wrong type) -> force INTEGER
    // This is already mostly correct because type mapping made INT -> INTEGER.
    if(!notes.some(n=>n.includes('AUTOINCREMENT'))) notes.push('AUTO_INCREMENT → AUTOINCREMENT (requires INTEGER PRIMARY KEY)');
  }

  // Remove UNSIGNED already done
  // Handle BOOLEAN default TRUE/FALSE -> 1/0?
  // SQLite accepts TRUE as 1? But we map: DEFAULT TRUE -> DEFAULT 1
  if(/\bDEFAULT\s+TRUE\b/i.test(translated)){
    translated = translated.replace(/\bDEFAULT\s+TRUE\b/gi, 'DEFAULT 1');
    notes.push('DEFAULT TRUE → DEFAULT 1');
  }
  if(/\bDEFAULT\s+FALSE\b/i.test(translated)){
    translated = translated.replace(/\bDEFAULT\s+FALSE\b/gi, 'DEFAULT 0');
    notes.push('DEFAULT FALSE → DEFAULT 0');
  }

  // Clean double spaces, trailing commas before ) etc.
  translated = translated.replace(/\s+,/g, ',');
  translated = translated.replace(/,\s*\)/g, ')');
  translated = translated.replace(/\s+;/g, ';');
  translated = translated.replace(/\s{2,}/g, ' ');

  const wasRewritten = translated.trim() !== original.trim();
  if(wasRewritten && notes.length===0) notes.push('Minor MySQL → SQLite normalization');

  return { original, translated, wasRewritten, notes, meta:false };
}

function splitArgs(argStr){
  // split by commas not inside single/double quotes or parentheses
  const args=[];
  let cur='';
  let inS=false, inD=false, depth=0;
  for(let i=0;i<argStr.length;i++){
    const c=argStr[i];
    if(c==="'" && !inD){ inS=!inS; cur+=c; continue; }
    if(c==='"' && !inS){ inD=!inD; cur+=c; continue; }
    if(!inS && !inD){
      if(c==='(') depth++;
      else if(c===')') depth--;
      else if(c===',' && depth===0){ args.push(cur.trim()); cur=''; continue; }
    }
    cur+=c;
  }
  if(cur.trim()) args.push(cur.trim());
  return args;
}

// ---------- Statement splitting ----------
export function splitStatements(sql){
  const stmts=[];
  let cur='';
  let inSingle=false, inDouble=false, inBacktick=false;
  let inLineComment=false, inBlockComment=false;
  let prev='';
  for(let i=0;i<sql.length;i++){
    const c=sql[i];
    const next=sql[i+1]||'';
    // handle comments when not in strings
    if(!inSingle && !inDouble && !inBacktick){
      if(!inBlockComment && !inLineComment){
        if(c==='-' && next==='-' && (sql[i+2]===' ' || sql[i+2]==='\t' || sql[i+2]==='\n' || sql[i+2]==='\r')){
          inLineComment=true;
          cur+=c; continue;
        }
        if(c==='/' && next==='*'){
          inBlockComment=true;
          cur+=c; continue;
        }
      } else if(inLineComment){
        cur+=c;
        if(c==='\n') { inLineComment=false; }
        continue;
      } else if(inBlockComment){
        cur+=c;
        if(c==='*' && next==='/'){
          cur+=next; i++; inBlockComment=false;
        }
        continue;
      }
    }
    // handle strings
    if(!inLineComment && !inBlockComment){
      if(c==="'" && !inDouble && !inBacktick){
        // handle escaped '' inside single quotes
        if(inSingle && next==="'"){
          cur+=c+next; i++; continue;
        }
        inSingle=!inSingle;
      } else if(c==='"' && !inSingle && !inBacktick){
        if(inDouble && next==='"'){
          cur+=c+next; i++; continue;
        }
        inDouble=!inDouble;
      } else if(c==='`' && !inSingle && !inDouble){
        inBacktick=!inBacktick;
      }
      // semicolon splits when not in string/comment
      if(c===';' && !inSingle && !inDouble && !inBacktick && !inLineComment && !inBlockComment){
        cur+=c;
        const trimmed=cur.trim();
        if(trimmed && trimmed!==';') stmts.push(cur.trim());
        cur='';
        continue;
      }
    }
    cur+=c;
  }
  const t=cur.trim();
  if(t) stmts.push(t);
  // filter out empty or comment-only
  return stmts.filter(s=>{
    const noComments=s.replace(/--.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').trim();
    return noComments.length>0;
  });
}

// ---------- Exec helpers ----------
function formatMySQLError(sqliteErr, originalSql){
  const msg = sqliteErr.message || String(sqliteErr);
  // Map common
  let code='ER_UNKNOWN', errno=1105, sqlState='HY000';
  let hint='';
  const lower=msg.toLowerCase();
  if(lower.includes('no such table')){
    const m=msg.match(/no such table: (\S+)/i);
    const tbl=m?m[1]:'unknown';
    code='ER_NO_SUCH_TABLE'; errno=1146; sqlState='42S02';
    hint=`Table '${tbl}' doesn't exist. Check spelling, or run SHOW TABLES. Did you use the correct database? Current DB is '${currentDatabase}'.`;
  } else if(lower.includes('no such column')){
    code='ER_BAD_FIELD_ERROR'; errno=1054; sqlState='42S22';
    hint='Column not found. Run DESCRIBE <table> or SHOW COLUMNS FROM <table> to see available columns.';
  } else if(lower.includes('unique constraint failed') || lower.includes('unique')){
    code='ER_DUP_ENTRY'; errno=1062; sqlState='23000';
    hint='Duplicate entry for a UNIQUE or PRIMARY KEY. The value already exists.';
  } else if(lower.includes('foreign key constraint failed')){
    code='ER_NO_REFERENCED_ROW_2'; errno=1452; sqlState='23000';
    hint='Foreign key violation. You referenced an id that does not exist in the parent table, or ON DELETE restriction blocked you. Insert the parent row first.';
  } else if(lower.includes('syntax error')){
    code='ER_PARSE_ERROR'; errno=1064; sqlState='42000';
    hint='SQL syntax error. Check commas, parentheses, quotes. MySQL vs SQLite differences are noted in the compatibility panel.';
  } else if(lower.includes('not null constraint failed')){
    code='ER_BAD_NULL_ERROR'; errno=1048; sqlState='23000';
    hint='NOT NULL violation — you tried to insert NULL into a NOT NULL column.';
  } else if(lower.includes('check constraint failed')){
    code='ER_CHECK_CONSTRAINT_VIOLATED'; errno=3819; sqlState='HY000';
    hint='CHECK constraint failed — value does not satisfy the column CHECK (e.g., ENUM or range).';
  } else if(lower.includes('no such index')){
    code='ER_CANT_DROP_FIELD_OR_KEY'; errno=1091; sqlState='42000';
    hint='Index does not exist.';
  } else if(lower.includes('table') && lower.includes('already exists')){
    code='ER_TABLE_EXISTS_ERROR'; errno=1050; sqlState='42S01';
    hint='Table already exists. Use CREATE TABLE IF NOT EXISTS or DROP first.';
  } else if(lower.includes('cannot start a transaction within a transaction') || lower.includes('cannot commit')){
    code='ER_CANT_DO_THIS_DURING_AN_TRANSACTION'; errno=1568; sqlState='25001';
    hint='Transaction error — you may have nested BEGIN. Use COMMIT/ROLLBACK before starting a new transaction.';
  }
  const mysqlStyled = `ERROR ${errno} (${sqlState}): ${code}: ${msg}`;
  return { mysqlStyled, underlying: msg, code, errno, sqlState, hint, originalSql };
}

function execMeta(original){
  const sql = original.trim().replace(/;$/, '').trim();
  const upper = sql.toUpperCase();
  // SHOW DATABASES
  if(/^SHOW\s+DATABASES/i.test(sql)){
    const rows = Array.from(knownDatabases).map(d=>({ Database: d }));
    // also include current
    return { columns: ['Database'], rows, meta:true };
  }
  // SHOW TABLES [FROM db]
  if(/^SHOW\s+TABLES/i.test(sql)){
    // ignore FROM db for now (logical)
    const rs = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_mysql_%' ORDER BY name;");
    const cols = rs[0]?.columns || ['Tables_in_'+currentDatabase];
    const values = rs[0]?.values || [];
    // Map to expected column name
    const columnName = `Tables_in_${currentDatabase}`;
    const rows = values.map(v=>({ [columnName]: v[0] }));
    return { columns:[columnName], rows, meta:true, raw:rs };
  }
  // SHOW CREATE TABLE tbl
  if(/^SHOW\s+CREATE\s+TABLE\s+/i.test(sql)){
    const m = sql.match(/SHOW\s+CREATE\s+TABLE\s+[`"]?(\w+)`?/i);
    const tbl = m?m[1]:null;
    if(!tbl) throw new Error('Syntax: SHOW CREATE TABLE table_name');
    const rs = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tbl.replace(/'/g,"''")}'`);
    if(!rs[0] || !rs[0].values.length) throw new Error(`Table '${currentDatabase}.${tbl}' doesn't exist`);
    const createSql = rs[0].values[0][0];
    return { columns:['Table','Create Table'], rows:[{ Table: tbl, 'Create Table': createSql }], meta:true };
  }
  // DESCRIBE / DESC
  if(/^(DESCRIBE|DESC)\s+/i.test(sql)){
    const m = sql.match(/^(?:DESCRIBE|DESC)\s+[`"]?(\w+)`?/i);
    const tbl = m?m[1]:null;
    if(!tbl) throw new Error('Syntax: DESCRIBE table');
    // verify table exists
    const exists = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tbl.replace(/'/g,"''")}'`);
    if(!exists[0] || !exists[0].values.length) throw new Error(`Table '${currentDatabase}.${tbl}' doesn't exist`);
    const pragma = db.exec(`PRAGMA table_info("${tbl.replace(/"/g,'""')}")`);
    if(!pragma[0]) throw new Error(`No columns for ${tbl}`);
    // Columns: cid, name, type, notnull, dflt_value, pk
    const cols = ['Field','Type','Null','Key','Default','Extra'];
    const rows = pragma[0].values.map(v=>{
      const [cid, name, type, notnull, dflt, pk] = v;
      return {
        Field: name,
        Type: type || 'TEXT',
        Null: notnull? 'NO':'YES',
        Key: pk? (pk===1?'PRI':'MUL') : '',
        Default: dflt,
        Extra: pk? 'PRIMARY KEY' : ''
      };
    });
    // Add FK info
    return { columns: cols, rows, meta:true };
  }
  // SHOW COLUMNS FROM tbl
  if(/^SHOW\s+COLUMNS\s+FROM\s+/i.test(sql)){
    const m = sql.match(/SHOW\s+COLUMNS\s+FROM\s+[`"]?(\w+)`?/i);
    const tbl=m?m[1]:null;
    if(!tbl) throw new Error('Syntax: SHOW COLUMNS FROM table');
    return execMeta(`DESCRIBE ${tbl}`);
  }
  // SHOW INDEX FROM tbl
  if(/^SHOW\s+INDEX\s+FROM\s+/i.test(sql)){
    const m = sql.match(/SHOW\s+INDEX\s+FROM\s+[`"]?(\w+)`?/i);
    const tbl=m?m[1]:null;
    if(!tbl) throw new Error('Syntax: SHOW INDEX FROM table');
    const idxList = db.exec(`PRAGMA index_list("${tbl.replace(/"/g,'""')}")`);
    if(!idxList[0] || !idxList[0].values.length){
      return { columns:['Table','Non_unique','Key_name','Seq_in_index','Column_name'], rows:[], meta:true };
    }
    const rows=[];
    for(const r of idxList[0].values){
      // seq, name, unique, origin, partial
      const [seq, name, unique, origin, partial] = r;
      const info = db.exec(`PRAGMA index_info("${name.replace(/"/g,'""')}")`);
      const cols = info[0]?.values || [];
      for(const c of cols){
        // seqno, cid, name
        rows.push({
          Table: tbl,
          Non_unique: unique?0:1,
          Key_name: name,
          Seq_in_index: c[0]+1,
          Column_name: c[2],
          Collation: 'A',
          Cardinality: null,
          Sub_part: null
        });
      }
    }
    return { columns:['Table','Non_unique','Key_name','Seq_in_index','Column_name','Collation'], rows, meta:true };
  }
  // USE db
  if(/^USE\s+/i.test(sql)){
    const m = sql.match(/^USE\s+[`"]?(\w+)`?/i);
    const dbName = m?m[1]:null;
    if(!dbName) throw new Error('Syntax: USE database');
    currentDatabase = dbName;
    knownDatabases.add(dbName);
    localStorage.setItem(DB_KEY+'-currentDB', currentDatabase);
    return { columns:[], rows:[], status:`Database changed to ${dbName}`, meta:true };
  }
  // EXPLAIN <query> — we handle separately but fallback
  if(/^EXPLAIN\s+/i.test(sql)){
    // let SQLite handle EXPLAIN QUERY PLAN? SHOW raw
    // We'll return empty and let caller do EXPLAIN QUERY PLAN
    // But we can emulate by running EXPLAIN QUERY PLAN
    const inner = sql.replace(/^EXPLAIN\s+/i,'');
    const plan = db.exec(`EXPLAIN QUERY PLAN ${inner}`);
    if(!plan[0]) return { columns:[], rows:[], meta:true };
    const cols = plan[0].columns;
    const rows = plan[0].values.map(v=>{
      const obj={};
      cols.forEach((c,i)=> obj[c]=v[i]);
      return obj;
    });
    return { columns: cols, rows, meta:true, isExplain:true };
  }
  return null;
}

// ---------- Public API ----------
export async function initEngine(){
  if(readyPromise) return readyPromise;
  readyPromise = (async()=>{
    // Load sql.js
    const SQLConfig = {
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    };
    // window.initSqlJs is global from sql-wasm.js
    // It may not be loaded yet if script tag not done? We load dynamically if needed.
    if(!window.initSqlJs){
      await new Promise((resolve, reject)=>{
        const s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
        s.onload=resolve;
        s.onerror=()=>reject(new Error('Failed to load sql.js'));
        document.head.appendChild(s);
      });
    }
    SQL = await window.initSqlJs(SQLConfig);
    await restore();
    // Ensure FK
    try{ db.exec("PRAGMA foreign_keys = ON;"); }catch(e){}
    isReady = true;
    return db;
  })();
  return readyPromise;
}

export function getDB(){ return db; }
export function getCurrentDatabase(){ return currentDatabase; }
export function getDatabases(){ return Array.from(knownDatabases); }
export function getPersistMethod(){ return lastPersistMethod; }

export function isEngineReady(){ return isReady; }

export async function resetDatabase(){
  if(!SQL) await initEngine();
  db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON;");
  ensureMeta();
  currentDatabase='shop';
  knownDatabases.clear(); knownDatabases.add('shop');
  localStorage.removeItem(DB_KEY+'-currentDB');
  await persist();
  return db;
}

export async function loadSample(){
  await resetDatabase();
  await importSql(SAMPLE_SQL);
  return db;
}

// Core exec: executes any SQL (DDL/DML/DQL/multi). Returns array of results per statement.
export async function exec(sqlText, { params = null } = {}){
  if(!isReady) await initEngine();
  const statements = splitStatements(sqlText);
  if(statements.length===0) return [];
  const results=[];
  for(let idx=0; idx<statements.length; idx++){
    const stmtOriginal = statements[idx];
    const trimmed = stmtOriginal.trim();
    if(!trimmed) continue;
    const start = performance.now();
    let translatedInfo = null;
    let metaHandled = false;
    try{
      // Check meta first (SHOW etc)
      const metaResult = (()=>{ try{ return execMeta(trimmed); }catch(e){ throw e; } })();
      if(metaResult){
        // metaResult is our synthetic
        const duration = performance.now()-start;
        results.push({
          index: idx,
          original: stmtOriginal,
          translated: stmtOriginal,
          wasRewritten:false,
          compatNotes: metaResult.meta? ['Emulated MySQL meta command'] : [],
          success:true,
          duration,
          columns: metaResult.columns,
          rows: metaResult.rows,
          rowCount: metaResult.rows.length,
          status: metaResult.status || `OK, ${metaResult.rows.length} rows`,
          meta:true
        });
        continue;
      }

      // Translate
      translatedInfo = translateSQL(stmtOriginal);
      const toExec = translatedInfo.translated;
      // Decide if SELECT or other
      const isSelect = /^\s*SELECT\b/i.test(toExec) || /^\s*WITH\b/i.test(toExec) || /^\s*EXPLAIN\s+QUERY\s+PLAN/i.test(toExec) || /^\s*PRAGMA\b/i.test(toExec) || /^\s*SHOW\b/i.test(toExec);
      const isExplain = /^\s*EXPLAIN\s+/i.test(toExec);

      if(params && (Array.isArray(params) || typeof params==='object')){
        // Prepared execution path — use db.prepare
        // Only for single statement with params; for multi, params applies to this stmt
        // Detect placeholder count? We'll just bind.
        // For simplicity, handle ? placeholders
        // If params is array, bind sequentially; if object, named :name
        const stmt = db.prepare(toExec);
        try{
          if(Array.isArray(params)){
            stmt.bind(params);
          } else {
            // named params: SQLite expects $name or :name
            const named = {};
            for(const [k,v] of Object.entries(params)){
              named[':'+k]=v;
              named['$'+k]=v;
              named['@'+k]=v;
              named[k]=v;
            }
            stmt.bind(named);
          }
          const cols = stmt.getColumnNames();
          const rows=[];
          while(stmt.step()){
            const row = stmt.getAsObject();
            rows.push(row);
          }
          const duration = performance.now()-start;
          results.push({
            index: idx,
            original: stmtOriginal,
            translated: toExec,
            wasRewritten: translatedInfo.wasRewritten,
            compatNotes: translatedInfo.notes,
            success:true,
            duration,
            columns: cols,
            rows,
            rowCount: rows.length,
            status: `Query OK, ${rows.length} rows`,
          });
        } finally {
          stmt.free();
        }
        // Persist if not SELECT? Actually prepared could be write; need to detect
        const isWrite = !isSelect && !isExplain;
        if(isWrite) await persist();
        continue;
      }

      // Non-prepared path
      // Use db.exec for SELECT, db.run for others? sql.js exec works for all but we need affected rows.
      // For writes, we can use db.exec and then get changes()
      if(isSelect || isExplain){
        const rs = db.exec(toExec);
        const duration = performance.now()-start;
        if(!rs || rs.length===0){
          results.push({
            index: idx,
            original: stmtOriginal,
            translated: toExec,
            wasRewritten: translatedInfo.wasRewritten,
            compatNotes: translatedInfo.notes,
            success:true,
            duration,
            columns: [],
            rows: [],
            rowCount: 0,
            status: 'OK, 0 rows'
          });
        } else {
          // db.exec returns [{columns, values}]
          // Could be multiple result sets? For now take first
          // But for multi-SELECT? each statement is separate
          const columns = rs[0].columns;
          const rows = rs[0].values.map(v=>{
            const obj={};
            columns.forEach((c,i)=> obj[c]=v[i]);
            return obj;
          });
          results.push({
            index: idx,
            original: stmtOriginal,
            translated: toExec,
            wasRewritten: translatedInfo.wasRewritten,
            compatNotes: translatedInfo.notes,
            success:true,
            duration,
            columns,
            rows,
            rowCount: rows.length,
            status: `OK, ${rows.length} rows`
          });
        }
      } else {
        // Write / DDL
        // For multi statements inside toExec? Already split, but translated may still contain multiple? treat as one.
        // Use db.exec which can handle multiple but we want lastInsertRowid and changes
        const beforeChanges = db.getRowsModified ? db.getRowsModified() : 0;
        db.exec(toExec);
        // Get changes via SELECT changes() and last_insert_rowid()
        let affected = 0;
        let insertId = null;
        try{
          const ch = db.exec("SELECT changes() AS c, last_insert_rowid() AS id");
          if(ch[0] && ch[0].values[0]){
            affected = ch[0].values[0][0];
            insertId = ch[0].values[0][1];
            if(insertId===0) insertId=null;
          }
        }catch(e){}
        const duration = performance.now()-start;
        // For DDL, affected may be 0 but still success
        const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(toExec);
        let status;
        if(isDDL){
          status = `Query OK, 0 rows affected`;
        } else {
          status = `Query OK, ${affected} row${affected!==1?'s':''} affected`;
          if(insertId) status += `, lastInsertId=${insertId}`;
        }
        results.push({
          index: idx,
          original: stmtOriginal,
          translated: toExec,
          wasRewritten: translatedInfo.wasRewritten,
          compatNotes: translatedInfo.notes,
          success:true,
          duration,
          columns: [],
          rows: [],
          rowCount: affected,
          affectedRows: affected,
          insertId,
          status
        });
        // persist after write
        await persist();
      }
    }catch(err){
      const duration = performance.now()-start;
      const formatted = formatMySQLError(err, stmtOriginal);
      results.push({
        index: idx,
        original: stmtOriginal,
        translated: translatedInfo?translatedInfo.translated:stmtOriginal,
        wasRewritten: translatedInfo?translatedInfo.wasRewritten:false,
        compatNotes: translatedInfo?translatedInfo.notes:[],
        success:false,
        duration,
        error: formatted,
        rawError: err
      });
      // Stop on error? MySQL continues? We'll stop after error for transaction safety, but not necessarily. We'll continue to next? For now continue but mark.
      // If transaction, sqlite will be in error; we keep going.
    }
  }
  return results;
}

export async function execSingle(sql, params=null){
  const res = await exec(sql, { params });
  return res[0] || null;
}

// Introspection helpers
export function introspect(){
  if(!db) return { tables:[], views:[], indexes:[] };
  const tables=[];
  const views=[];
  const indexes=[];
  try{
    const rs = db.exec("SELECT name, sql, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_mysql_%' ORDER BY name;");
    if(rs[0]){
      const cols= rs[0].columns;
      const nameIdx=cols.indexOf('name');
      const sqlIdx=cols.indexOf('sql');
      const typeIdx=cols.indexOf('type');
      for(const row of rs[0].values){
        const name=row[nameIdx], sql=row[sqlIdx], type=row[typeIdx];
        if(type==='table') tables.push({ name, sql });
        else views.push({ name, sql });
      }
    }
    const idxRs = db.exec("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql NOT NULL ORDER BY name;");
    if(idxRs[0]){
      for(const row of idxRs[0].values){
        indexes.push({ name:row[0], table:row[1], sql:row[2] });
      }
    }
  }catch(e){ console.warn(e) }

  const details = {};
  for(const t of tables){
    try{
      const colRs = db.exec(`PRAGMA table_info("${t.name.replace(/"/g,'""')}")`);
      const fkRs = db.exec(`PRAGMA foreign_key_list("${t.name.replace(/"/g,'""')}")`);
      const idxList = db.exec(`PRAGMA index_list("${t.name.replace(/"/g,'""')}")`);
      const cntRs = db.exec(`SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g,'""')}"`);
      const count = cntRs[0]?.values[0][0] ?? 0;
      const columns = colRs[0] ? colRs[0].values.map(v=>({
        cid: v[0], name: v[1], type: v[2], notnull: !!v[3], dflt: v[4], pk: !!v[5]
      })) : [];
      const fks = fkRs[0] ? fkRs[0].values.map(v=>({
        id: v[0], seq: v[1], table: v[2], from: v[3], to: v[4], on_update: v[5], on_delete: v[6], match: v[7]
      })) : [];
      const idxs = idxList[0] ? idxList[0].values.map(v=>({
        seq: v[0], name: v[1], unique: !!v[2], origin: v[3], partial: v[4]
      })) : [];
      // enrich idx with columns
      for(const idx of idxs){
        try{
          const info = db.exec(`PRAGMA index_info("${idx.name.replace(/"/g,'""')}")`);
          idx.columns = info[0] ? info[0].values.map(v=>v[2]) : [];
        }catch(e){ idx.columns=[] }
      }
      details[t.name] = { ...t, columns, fks, indexes: idxs, rowCount: count };
    }catch(e){
      details[t.name]={ ...t, columns:[], fks:[], indexes:[], rowCount:0, error:String(e) };
    }
  }
  // views details: add row count?
  for(const v of views){
    try{
      const cnt = db.exec(`SELECT COUNT(*) AS c FROM "${v.name.replace(/"/g,'""')}"`);
      details[v.name] = { ...v, columns:[], fks:[], indexes:[], rowCount: cnt[0]?.values[0][0] ?? 0, isView:true };
    }catch(e){
      details[v.name] = { ...v, columns:[], rowCount:0, isView:true };
    }
  }
  return { tables, views, indexes, details, currentDatabase };
}

export async function importSql(sqlText){
  const results = await exec(sqlText);
  // exec already persists
  return results;
}
export async function importBinary(u8){
  if(!SQL) await initEngine();
  db = new SQL.Database(u8);
  db.exec("PRAGMA foreign_keys = ON;");
  ensureMeta();
  await persist();
}
export function exportBinary(){
  if(!db) return null;
  return db.export();
}
export function exportSql(){
  // Generate MySQL-flavored dump
  const { details } = introspect();
  let out = `-- MySQL Playground Studio dump\n-- Database: ${currentDatabase}\n-- Generated: ${new Date().toISOString()}\n\n`;
  out += `PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n`;
  for(const [name, info] of Object.entries(details)){
    if(info.isView){
      out += `${info.sql};\n\n`;
      continue;
    }
    // Keep original CREATE TABLE sql but ensure MySQL flavor? The stored sql is SQLite version. Try to generate MySQL-ish.
    // We'll use stored sql, but convert back minimally: INTEGER PRIMARY KEY AUTOINCREMENT -> INT AUTO_INCREMENT PRIMARY KEY
    let create = info.sql;
    // reverse translation for readability
    create = create.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'INT AUTO_INCREMENT PRIMARY KEY');
    create = create.replace(/INTEGER PRIMARY KEY/gi, 'INT PRIMARY KEY');
    create = create.replace(/TEXT/gi, 'TEXT');
    create = create.replace(/REAL/gi, 'DECIMAL(10,2)');
    out += `${create};\n`;
    // indexes already in create? separate indexes where sql exists but not in table sql
    // export data
    try{
      const rs = db.exec(`SELECT * FROM "${name.replace(/"/g,'""')}"`);
      if(rs[0] && rs[0].values.length){
        const cols = rs[0].columns;
        out += `\n-- Data for ${name}\n`;
        // batch inserts 100 rows
        const rows = rs[0].values;
        for(let i=0;i<rows.length;i++){
          const vals = rows[i].map(v=>{
            if(v===null) return 'NULL';
            if(typeof v==='number') return String(v);
            // escape single quotes
            return `'${String(v).replace(/'/g,"''")}'`;
          }).join(', ');
          out += `INSERT INTO "${name}" (${cols.map(c=>`"${c}"`).join(', ')}) VALUES (${vals});\n`;
        }
        out += '\n';
      }
    }catch(e){}
  }
  out += `COMMIT;\n`;
  return out;
}

// Helpers for UI
export function getRowCounts(){
  const { details } = introspect();
  const map={};
  for(const [k,v] of Object.entries(details)) map[k]=v.rowCount;
  return map;
}

export { translateSQL, formatMySQLError, persist, restore };

