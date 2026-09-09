// js/app.js — central state, persistence, wiring

import { initEngine, exec, introspect, resetDatabase, loadSample, importSql, importBinary, exportBinary, exportSql, getCurrentDatabase, getPersistMethod, SAMPLE_SQL, translateSQL } from './engine.js';
import { createPool, createConnection, setLatency } from './driver.js';
import { initSchema, renderSchema } from './schema.js';
import { initEditors, initTabs, renderResults, getCurrentStatement, getAllSql, setSqlValue, setAppValue, getSqlEditor, getAppEditor, showToast, renderTree, renderHistory, renderDataGrid, appendConsole, clearConsole, initSnippetTabs, formatSQL, getCurrentResults, getActiveResult } from './ui.js';

// State
const state = {
  history: JSON.parse(localStorage.getItem('mysql-playground-history')||'[]'),
  scripts: JSON.parse(localStorage.getItem('mysql-playground-scripts')||'{}'),
  lessonProgress: JSON.parse(localStorage.getItem('mysql-playground-lessons')||'{}'),
  challengeProgress: JSON.parse(localStorage.getItem('mysql-playground-challenges')||'{}'),
  currentDataTable: null,
  selectedRow: null,
};

// DOM refs for schema
const schemaEls = {
  canvas: document.getElementById('schemaCanvas'),
  svg: document.getElementById('schemaSvg'),
  cards: document.getElementById('schemaCards'),
  searchInput: document.getElementById('schemaSearch'),
  meta: document.getElementById('schemaMeta'),
  empty: document.getElementById('schemaEmpty'),
  inspector: document.getElementById('schemaInspector'),
  inspectorTitle: document.getElementById('inspectorTitle'),
  inspectorContent: document.getElementById('inspectorContent'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnResetZoom: document.getElementById('btnResetZoom'),
  btnFit: document.getElementById('btnFitSchema'),
  btnAutoLayout: document.getElementById('btnAutoLayout'),
  toggleGrid: document.getElementById('toggleGrid'),
  toggleLabels: document.getElementById('toggleLabels'),
  btnCloseInspector: document.getElementById('btnCloseInspector'),
  btnInspectorSelect: document.getElementById('btnInspectorSelect'),
  btnInspectorInsert: document.getElementById('btnInspectorInsert'),
  btnInspectorDrop: document.getElementById('btnInspectorDrop'),
};

// Sample snippets for SQL editor
const sqlSnippets = [
  { label: 'Show tables', sql: 'SHOW TABLES;' },
  { label: 'Describe customers', sql: 'DESCRIBE customers;' },
  { label: 'Select with JOIN', sql: "SELECT c.name AS customer, p.name AS product, o.total\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nJOIN order_items oi ON oi.order_id = o.id\nJOIN products p ON p.id = oi.product_id\nLIMIT 10;" },
  { label: 'Group by status', sql: "SELECT status, COUNT(*) AS cnt, SUM(total) AS revenue\nFROM orders\nGROUP BY status\nHAVING SUM(total) > 100\nORDER BY revenue DESC;" },
  { label: 'Insert transaction', sql: "BEGIN;\nINSERT INTO customers (name, email, city) VALUES ('Test User','test@example.com','Berlin');\nINSERT INTO orders (customer_id, total, status) VALUES (last_insert_rowid(), 199.99, 'paid');\nCOMMIT;\nSELECT * FROM orders ORDER BY id DESC LIMIT 3;" },
  { label: 'EXPLAIN query plan', sql: "EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = 1;" },
  { label: 'Window function', sql: "SELECT name, price, AVG(price) OVER (PARTITION BY category_id) AS avg_cat_price\nFROM products;" },
  { label: 'FK violation demo', sql: "INSERT INTO orders (customer_id, total) VALUES (9999, 10.00);" },
  { label: 'CREATE TABLE demo', sql: "CREATE TABLE IF NOT EXISTS demo (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  title VARCHAR(100) NOT NULL,\n  score INT DEFAULT 0 CHECK (score >= 0)\n);" },
  { label: 'ON DUPLICATE KEY UPDATE', sql: "INSERT INTO customers (id, name, email) VALUES (1, 'Ada Updated', 'ada@example.com')\nON DUPLICATE KEY UPDATE name='Ada Updated';" },
];

// Reference snippets for app code language tabs
const referenceSnippets = {
  node: `// Node.js — mysql2/promise (this playground's driver)
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: 'localhost', user: 'root', password: 'secret',
  database: 'shop', waitForConnections: true, connectionLimit: 10
});

// Prepared INSERT + SELECT with error handling
try {
  const [res] = await pool.execute(
    'INSERT INTO customers (name, email) VALUES (?, ?)',
    ['Ada Lovelace', 'ada@example.com']
  );
  console.log('Inserted id:', res.insertId, 'affected:', res.affectedRows);

  const [rows] = await pool.query(
    'SELECT * FROM customers WHERE email = ?', ['ada@example.com']
  );
  console.table(rows);
} catch (e) {
  console.error(e.code, e.sqlMessage);
} finally {
  await pool.end();
}`,
  php: `<?php
// PHP — PDO with prepared statements
$pdo = new PDO('mysql:host=localhost;dbname=shop;charset=utf8mb4','root','secret',[
  PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
]);
try {
  $stmt = $pdo->prepare('INSERT INTO customers (name, email) VALUES (:name, :email)');
  $stmt->execute(['name'=>'Ada Lovelace','email'=>'ada@example.com']);
  echo "Inserted id: " . $pdo->lastInsertId() . "\\n";

  $stmt = $pdo->prepare('SELECT * FROM customers WHERE email = :email');
  $stmt->execute(['email'=>'ada@example.com']);
  print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
} catch (PDOException $e) {
  echo "Error: " . $e->getMessage();
}
?>`,
  python: `# Python — mysql-connector-python
import mysql.connector
cnx = mysql.connector.connect(host='localhost', user='root', password='secret', database='shop')
cursor = cnx.cursor(dictionary=True)
try:
  cursor.execute("INSERT INTO customers (name, email) VALUES (%s, %s)", ("Ada Lovelace","ada@example.com"))
  cnx.commit()
  print("Inserted id:", cursor.lastrowid)

  cursor.execute("SELECT * FROM customers WHERE email = %s", ("ada@example.com",))
  for row in cursor.fetchall():
    print(row)
except mysql.connector.Error as err:
  print(err)
  cnx.rollback()
finally:
  cursor.close()
  cnx.close()`,
  java: `// Java — JDBC
import java.sql.*;
public class Demo {
  public static void main(String[] args) throws Exception {
    String url = "jdbc:mysql://localhost/shop";
    try (Connection cnx = DriverManager.getConnection(url,"root","secret")) {
      try (PreparedStatement ps = cnx.prepareStatement(
          "INSERT INTO customers (name, email) VALUES (?, ?)",
          Statement.RETURN_GENERATED_KEYS)) {
        ps.setString(1,"Ada Lovelace");
        ps.setString(2,"ada@example.com");
        ps.executeUpdate();
        ResultSet keys = ps.getGeneratedKeys();
        if(keys.next()) System.out.println("Inserted id: "+keys.getLong(1));
      }
      try (PreparedStatement ps = cnx.prepareStatement("SELECT * FROM customers WHERE email=?")) {
        ps.setString(1,"ada@example.com");
        ResultSet rs = ps.executeQuery();
        while(rs.next()) System.out.println(rs.getString("name")+" "+rs.getString("email"));
      }
    }
  }
}`,
  go: `// Go — database/sql
package main
import (
  "database/sql"
  "log"
  _ "github.com/go-sql-driver/mysql"
)
func main(){
  db, _ := sql.Open("mysql","root:secret@tcp(localhost:3306)/shop")
  defer db.Close()
  res, err := db.Exec("INSERT INTO customers (name, email) VALUES (?, ?)", "Ada Lovelace","ada@example.com")
  if err != nil { log.Fatal(err) }
  id, _ := res.LastInsertId()
  log.Println("Inserted id:", id)
  rows, _ := db.Query("SELECT name, email FROM customers WHERE email=?","ada@example.com")
  defer rows.Close()
  for rows.Next(){
    var name, email string
    rows.Scan(&name,&email)
    log.Println(name,email)
  }
}`
};

// Lessons data
const lessons = [
  { id:'what-is-db', title:'What is a database / table / row / column', level:'Beginner', sql:`SHOW TABLES;\nDESCRIBE customers;\nSELECT * FROM customers LIMIT 3;`, content:`<h2>What is a database?</h2><p>A <strong>database</strong> is a container for <strong>tables</strong>. A <strong>table</strong> has <strong>columns</strong> (schema) and <strong>rows</strong> (data).</p><ul><li><code>customers</code> has columns <code>id, name, email, city</code></li><li>Each row is one customer.</li></ul><p>Run the SQL on the right to explore. The ER diagram shows tables as cards.</p>` },
  { id:'create-types', title:'CREATE TABLE and data types', level:'Beginner', sql:`DROP TABLE IF EXISTS demo_types;\nCREATE TABLE demo_types (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  title VARCHAR(100) NOT NULL,\n  price DECIMAL(10,2) DEFAULT 0.00,\n  active BOOLEAN DEFAULT TRUE,\n  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n  status ENUM('draft','published') DEFAULT 'draft'\n) ENGINE=InnoDB;\nSHOW CREATE TABLE demo_types;\nSELECT sql FROM sqlite_master WHERE name='demo_types';`, content:`<h2>CREATE TABLE</h2><p>Choose types that fit the data. MySQL types are mapped to SQLite for execution — check the Compatibility panel.</p><ul><li><code>INT AUTO_INCREMENT PRIMARY KEY</code> → auto-numbered identifier</li><li><code>VARCHAR(100)</code> → short text</li><li><code>DECIMAL</code> → exact money</li><li><code>ENUM</code> becomes <code>TEXT CHECK</code></li></ul>` },
  { id:'crud', title:'INSERT, UPDATE, DELETE (CRUD)', level:'Beginner', sql:`INSERT INTO customers (name, email, city) VALUES ('Newbie','newbie@example.com','Oslo');\nSELECT * FROM customers ORDER BY id DESC LIMIT 2;\nUPDATE customers SET city='Bergen' WHERE email='newbie@example.com';\nSELECT * FROM customers WHERE email='newbie@example.com';\nDELETE FROM customers WHERE email='newbie@example.com';\nSELECT COUNT(*) AS remaining FROM customers;`, content:`<h2>CRUD</h2><p><strong>C</strong>reate <code>INSERT</code>, <strong>R</strong>ead <code>SELECT</code>, <strong>U</strong>pdate <code>UPDATE</code>, <strong>D</strong>elete <code>DELETE</code>.</p><p>Try the script: it inserts, updates, then cleans up.</p>` },
  { id:'pk-autoinc', title:'Primary keys and AUTO_INCREMENT', level:'Beginner', sql:`DESCRIBE customers;\nINSERT INTO customers (name, email) VALUES ('No City','nocity@example.com');\nSELECT id, name FROM customers ORDER BY id DESC LIMIT 3;\n-- The id was generated automatically`, content:`<h2>Primary Keys</h2><p>A PK uniquely identifies a row. <code>AUTO_INCREMENT</code> ( → <code>AUTOINCREMENT</code> in SQLite) generates the next id. Never reuse ids; deletions leave gaps.</p>` },
  { id:'fk', title:'Foreign keys and referential integrity', level:'Intermediate', sql:`-- This succeeds (customer 1 exists)\nINSERT INTO orders (customer_id, total, status) VALUES (1, 59.99, 'pending');\n-- This FAILS with FK error (customer 9999 does not exist)\nINSERT INTO orders (customer_id, total, status) VALUES (9999, 10.00, 'pending');`, content:`<h2>Foreign Keys</h2><p><code>orders.customer_id → customers.id</code> guarantees every order belongs to a real customer. <code>PRAGMA foreign_keys=ON</code> enforces it — invalid inserts fail.</p><p>Run the two inserts. The second shows <code>ERROR 1452</code> with a fix hint.</p>` },
  { id:'junction', title:'One-to-many and many-to-many', level:'Intermediate', sql:`-- One customer → many orders\nSELECT c.name, o.id, o.total FROM customers c JOIN orders o ON o.customer_id=c.id WHERE c.id=1;\n-- Many-to-many via junction order_items\nSELECT o.id, p.name, oi.quantity, oi.unit_price\nFROM orders o\nJOIN order_items oi ON oi.order_id=o.id\nJOIN products p ON p.id=oi.product_id\nWHERE o.id=1;`, content:`<h2>Relationships</h2><p><strong>One-to-many:</strong> one customer has many orders (<code>customer_id</code> FK).<br><strong>Many-to-many:</strong> orders ↔ products via <code>order_items</code> junction (two FKs, plus <code>quantity</code>).</p>` },
  { id:'select', title:'SELECT + WHERE + ORDER BY + LIMIT', level:'Beginner', sql:`SELECT * FROM products WHERE price BETWEEN 20 AND 120 ORDER BY price DESC LIMIT 3;\nSELECT DISTINCT city FROM customers ORDER BY city;\nSELECT * FROM products WHERE name LIKE 'Laptop%' LIMIT 5;`, content:`<h2>Filtering & Sorting</h2><p><code>WHERE</code> filters rows, <code>ORDER BY</code> sorts, <code>LIMIT</code> paginates. <code>BETWEEN</code>, <code>LIKE</code>, <code>IN</code> are predicates.</p>` },
  { id:'joins', title:'INNER JOIN vs LEFT JOIN', level:'Intermediate', sql:`-- INNER: only customers WITH orders\nSELECT c.name, COUNT(o.id) AS orders FROM customers c INNER JOIN orders o ON o.customer_id=c.id GROUP BY c.id;\n-- LEFT: ALL customers, even without orders\nSELECT c.name, COUNT(o.id) AS orders FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id;`, content:`<h2>JOINs</h2><p><strong>INNER</strong> keeps only matches. <strong>LEFT</strong> keeps all left rows + <code>NULL</code> for missing right rows. Row counts differ.</p><div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:8px"><strong>Visual:</strong> Venn — INNER = overlap; LEFT = left circle fully.</div>` },
  { id:'group', title:'GROUP BY, HAVING, and aggregates', level:'Intermediate', sql:`SELECT category_id, COUNT(*) AS cnt, AVG(price) AS avg_price\nFROM products GROUP BY category_id HAVING COUNT(*) > 1;\nSELECT status, SUM(total) AS revenue FROM orders GROUP BY status HAVING SUM(total) > 200;`, content:`<h2>Aggregation</h2><p><code>COUNT/SUM/AVG/MIN/MAX</code> collapse rows per group. <code>WHERE</code> filters before grouping; <code>HAVING</code> after.</p>` },
  { id:'subqueries', title:'Subqueries', level:'Intermediate', sql:`SELECT * FROM products WHERE price > (SELECT AVG(price) FROM products);\nSELECT name FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE total > 500);\nSELECT * FROM orders WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id=orders.customer_id AND c.city='London');`, content:`<h2>Subqueries</h2><p>Queries inside queries. <code>IN</code> and <code>EXISTS</code> test membership. They can be rewritten as JOINs but are clearer for “has at least one”.</p>` },
  { id:'indexes', title:'Indexes and performance', level:'Advanced', sql:`EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id=1;\nCREATE INDEX idx_orders_customer ON orders(customer_id);\nEXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id=1;`, content:`<h2>Indexes</h2><p>An index is a sorted copy of a column for fast lookup. <code>EXPLAIN QUERY PLAN</code> shows “SCAN” (slow, reads all rows) vs “SEARCH USING INDEX” (fast). The second plan after creating the index should show SEARCH.</p>` },
  { id:'transactions', title:'Transactions, COMMIT and ROLLBACK', level:'Advanced', sql:`BEGIN;\nINSERT INTO customers (name, email) VALUES ('Tx Test','tx@example.com');\nSELECT * FROM customers WHERE email='tx@example.com';\nROLLBACK;\nSELECT * FROM customers WHERE email='tx@example.com'; -- gone\n\nBEGIN;\nINSERT INTO customers (name, email) VALUES ('Tx2','tx2@example.com');\nCOMMIT;\nSELECT * FROM customers WHERE email='tx2@example.com'; -- stays`, content:`<h2>Transactions</h2><p><code>BEGIN … COMMIT</code> makes multiple writes atomic. <code>ROLLBACK</code> undoes. Use for money moves: either all succeed or none.</p>` },
  { id:'normalization', title:'Normalization 1NF/2NF/3NF', level:'Advanced', sql:`-- 1NF: atomic values (no CSV in a column)\n-- Bad: orders.products = '1,4,5'  Good: order_items rows\nSELECT * FROM order_items LIMIT 5;\n-- 2NF: no partial dependency — order_items has its own PK, not just order_id\n-- 3NF: no transitive — product price lives in products, not repeated in orders (unit_price is intentional denormalization for history)`, content:`<h2>Normalization</h2><p><strong>1NF</strong> atomic, <strong>2NF</strong> no partial, <strong>3NF</strong> no transitive. Our shop is ~3NF: <code>order_items</code> is the junction, prices are not duplicated except <code>unit_price</code> to freeze history.</p>` },
];

const challenges = [
  { id:'c1', title:'Insert a customer + first order (transaction)', task:'In one transaction, insert customer "Mina Lee" (mina@example.com, city=Seoul) and an order for 42.00 status pending. Use last_insert_rowid() or a SELECT to link.', check: async ()=>{
      const rs = await exec("SELECT id FROM customers WHERE email='mina@example.com'");
      if(!rs[0].success || rs[0].rows.length===0) return {pass:false, hint:'Customer not found. Did you insert mina@example.com?'};
      const cid=rs[0].rows[0].id;
      const rs2= await exec(`SELECT * FROM orders WHERE customer_id=${cid} AND total=42 AND status='pending'`);
      if(!rs2[0].rows.length) return {pass:false, hint:'Order not found with total 42 pending for that customer.'};
      return {pass:true};
    }, hint:'BEGIN; INSERT customer; INSERT orders with that customer_id; COMMIT;' },
  { id:'c2', title:'Top 3 products by revenue', task:"List top 3 products by revenue (SUM(quantity*unit_price)) with columns product and revenue, ordered DESC.", sqlHint:`SELECT p.name AS product, SUM(oi.quantity * oi.unit_price) AS revenue\nFROM products p JOIN order_items oi ON oi.product_id=p.id\nGROUP BY p.id ORDER BY revenue DESC LIMIT 3;`, check: async ()=>{
      const expected = await exec(`SELECT p.name AS product, SUM(oi.quantity * oi.unit_price) AS revenue FROM products p JOIN order_items oi ON oi.product_id=p.id GROUP BY p.id ORDER BY revenue DESC LIMIT 3;`);
      return {pass:true, details: expected[0].rows};
    }, hint:'Join products → order_items, GROUP BY, ORDER BY revenue desc, LIMIT 3' },
  { id:'c3', title:'Customers without orders (LEFT JOIN)', task:'Find customers who have never ordered (use LEFT JOIN + WHERE o.id IS NULL).', check: async ()=>{
      const rs=await exec("SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE o.id IS NULL");
      if(!rs[0].success) return {pass:false, hint: rs[0].error.hint};
      if(rs[0].rows.length===0) return {pass:false, hint:'Query returned 0 rows — need LEFT JOIN where order is null. Check sample data, maybe all have orders; create a new customer without order to test.'};
      return {pass:true};
    }},
  { id:'c4', title:'Add a CHECK constraint', task:'Create table tasks (id INT PK AUTO_INCREMENT, title VARCHAR(100) NOT NULL, priority INT CHECK(priority BETWEEN 1 AND 5)) and insert a row with priority 3. Verify it rejects priority 9.', check: async ()=>{
      const rs=await exec("SELECT name FROM sqlite_master WHERE name='tasks'");
      if(!rs[0].rows.length) return {pass:false, hint:'Table tasks not found.'};
      const ins=await exec("INSERT INTO tasks (title, priority) VALUES ('test check', 9)");
      if(ins[0].success) return {pass:false, hint:'CHECK did not reject priority 9 — constraint missing? It should be CHECK(priority BETWEEN 1 AND 5)'};
      return {pass:true};
    }},
  { id:'c5', title:'Fix FK error', task:'Demonstrate FK enforcement: try to insert order with invalid customer_id 9999, catch the error (it must fail). Then insert valid.', check: async ()=>{ const rs=await exec("INSERT INTO orders (customer_id, total) VALUES (9999, 1)"); if(rs[0].success) return {pass:false, hint:'Invalid FK insert succeeded — FKs not enforced? Expect ERROR 1452.'}; return {pass:true}; }},
  { id:'c6', title:'Update stock via JOIN logic', task:'Increase stock of all "Accessories" products by 10 (UPDATE products SET stock = stock+10 WHERE category_id = (SELECT id FROM categories WHERE name="Accessories")). Verify.', check: async ()=>{ const rs=await exec("SELECT stock FROM products WHERE category_id=(SELECT id FROM categories WHERE name='Accessories') LIMIT 1"); if(!rs[0].rows.length) return {pass:false, hint:'Accessories category not found'}; return {pass: rs[0].rows[0].stock >=10 }; }},
  { id:'c7', title:'Create a VIEW', task:'CREATE VIEW active_products AS SELECT * FROM products WHERE status="active"; then SELECT * FROM active_products LIMIT 2', check: async ()=>{ const rs=await exec("SELECT name FROM sqlite_master WHERE type='view' AND name='active_products'"); if(!rs[0].rows.length) return {pass:false, hint:'View active_products not found'}; return {pass:true}; }},
  { id:'c8', title:'Use a subquery with IN', task:'Select customers who bought "Mechanical Keyboard" using IN + subquery on order_items/products.', check: async ()=>{ const rs=await exec("SELECT DISTINCT c.name FROM customers c WHERE c.id IN (SELECT o.customer_id FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id WHERE p.name='Mechanical Keyboard')"); if(!rs[0].rows.length) return {pass:false, hint:'No rows. Check product name spelling.'}; return {pass:true}; }},
  { id:'c9', title:'Transaction rollback', task:'BEGIN; INSERT INTO customers (name,email) VALUES ("RollbackMe","rollback@example.com"); ROLLBACK; Verify rollback@example.com does NOT exist.', check: async ()=>{ const rs=await exec("SELECT * FROM customers WHERE email='rollback@example.com'"); if(rs[0].rows.length>0) return {pass:false, hint:'Row still exists — ROLLBACK did not happen or you COMMITed.'}; return {pass:true}; }},
  { id:'c10', title:'Add index and EXPLAIN', task:'Create index on products(category_id) if not exists, then EXPLAIN QUERY PLAN SELECT * FROM products WHERE category_id=2 must show SEARCH USING INDEX.', check: async ()=>{ const rs=await exec("EXPLAIN QUERY PLAN SELECT * FROM products WHERE category_id=2"); const txt=JSON.stringify(rs[0].rows).toLowerCase(); if(txt.includes('scan')) return {pass:false, hint:'Still scanning. Need index on category_id. Current plan: '+txt}; if(txt.includes('index')) return {pass:true}; return {pass:false, hint:'No index usage detected. Plan: '+txt}; }},
];

// App init
let sqlEditor, appEditor;
let historyRenderTimer=null;

async function init(){
  // Theme
  const savedTheme = localStorage.getItem('mysql-playground-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('themeToggle')?.addEventListener('click', ()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    const next=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mysql-playground-theme', next);
    // update CodeMirror themes
    [sqlEditor, appEditor].forEach(ed=>{
      if(ed && ed.setOption) ed.setOption('theme', next==='light' ? 'eclipse' : 'material-darker');
    });
  });

  // Badge init
  updateBadges();

  // Init engine
  try{
    await initEngine();
    document.getElementById('engineBadge').innerHTML='<span class="dot dot-ok"></span> SQLite WASM ready — FK ON • '+getPersistMethod();
  }catch(e){
    document.getElementById('engineBadge').innerHTML='<span class="dot dot-err"></span> Engine failed: '+e.message;
    showToast('Engine failed: '+e.message,'error',5000);
  }

  // Editors
  const editors = initEditors({ onRun: handleRun, onRunAll: ()=>handleRun('all'), onAppRun: handleAppRun });
  sqlEditor=editors.sqlEditor; appEditor=editors.appEditor;
  initTabs();
  initSnippetTabs(referenceSnippets);
  initSchema(schemaEls);

  // Populate snippet select
  const sel=document.getElementById('snippetSelect');
  sqlSnippets.forEach((s,i)=>{
    const o=document.createElement('option');
    o.value=i; o.textContent=s.label;
    sel.appendChild(o);
  });
  sel.addEventListener('change', ()=>{
    if(sel.value==='') return;
    const s=sqlSnippets[sel.value];
    const cur=sqlEditor.getValue();
    const toInsert = s.sql;
    // Insert at cursor if editor has selection? Replace selection if exists else append with newline
    const cursor = sqlEditor.getCursor ? sqlEditor.getCursor() : null;
    if(cursor && sqlEditor.replaceSelection){
      sqlEditor.replaceSelection((cur && !cur.endsWith('\n') ? '\n' : '') + toInsert + '\n');
    } else {
      setSqlValue(cur + '\n' + toInsert);
    }
    sel.value='';
    showToast('Inserted snippet: '+s.label,'success',2000);
  });

  // Default SQL
  if(!sqlEditor.getValue().trim()){
    setSqlValue(`-- Welcome to MySQL Playground Studio\n-- Real SQL via SQLite WASM + MySQL compatibility\n-- Try: SHOW TABLES;  DESCRIBE customers;  SELECT * FROM customers;\n\nSHOW TABLES;\n\nSELECT c.name, COUNT(o.id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nGROUP BY c.id\nORDER BY orders DESC;`);
  }
  // Default App code
  if(!appEditor.getValue().trim()){
    setAppValue(`// App Code Playground — mysql2/promise style over the SAME browser DB
// This code REALLY runs. It uses a fake mysql2 driver backed by sql.js.

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'secret',
  database: 'shop',
  waitForConnections: true,
  connectionLimit: 10
});

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();

  const [res] = await conn.execute(
    'INSERT INTO customers (name, email) VALUES (?, ?)',
    ['Ada Lovelace', 'ada@example.com']
  );
  console.log('Inserted id:', res.insertId, 'affected:', res.affectedRows);

  await conn.execute(
    'INSERT INTO orders (customer_id, total, status) VALUES (?, ?, ?)',
    [res.insertId, 149.99, 'paid']
  );

  await conn.commit();
  console.log('Transaction committed');
} catch (e) {
  await conn.rollback();
  console.error('Rolled back:', e.code, e.sqlMessage);
} finally {
  conn.release();
}

const [rows] = await pool.query('SELECT * FROM customers ORDER BY id DESC LIMIT 5');
console.table(rows);
console.log('Done — check the Data tab or run SELECT above to see inserts.');

await pool.end();
`);
  }

  // Wire toolbar SQL
  document.getElementById('btnRun')?.addEventListener('click', ()=> handleRun('current'));
  document.getElementById('btnRunAll')?.addEventListener('click', ()=> handleRun('all'));
  document.getElementById('btnStop')?.addEventListener('click', ()=>{
    // No real stop for sync exec, but toast
    showToast('Stop: current SQLite exec is synchronous; long queries are limited by WASM. Use smaller scripts.','warn',4000);
  });
  document.getElementById('btnFormat')?.addEventListener('click', ()=>{
    const v=sqlEditor.getValue();
    setSqlValue(formatSQL(v));
    showToast('Formatted SQL','success',1500);
  });
  document.getElementById('btnClearEditor')?.addEventListener('click', ()=>{ setSqlValue(''); showToast('Cleared editor','info',1500); });
  document.getElementById('btnSaveScript')?.addEventListener('click', saveScript);
  document.getElementById('btnLoadScript')?.addEventListener('click', loadScriptPrompt);
  document.getElementById('btnExportCsv')?.addEventListener('click', exportCsv);
  document.getElementById('btnExportJson')?.addEventListener('click', exportJson);
  document.getElementById('btnCopyMarkdown')?.addEventListener('click', copyMarkdown);
  document.getElementById('btnCopyInserts')?.addEventListener('click', copyInserts);
  document.getElementById('btnExplain')?.addEventListener('click', explainCurrent);
  document.getElementById('btnCloseExplain')?.addEventListener('click', ()=> document.getElementById('explainPanel').classList.add('hidden'));
  document.getElementById('btnDismissCompat')?.addEventListener('click', ()=> document.getElementById('compatPanel').classList.add('hidden'));

  // App code toolbar
  document.getElementById('btnRunApp')?.addEventListener('click', handleAppRun);
  document.getElementById('btnStopApp')?.addEventListener('click', stopAppRun);
  document.getElementById('btnClearApp')?.addEventListener('click', ()=>{ setAppValue(''); clearConsole(); });
  document.getElementById('btnFormatApp')?.addEventListener('click', ()=>{
    // simple: try js-beautify? just trim
    const v=appEditor.getValue();
    // naive indent? skip
    showToast('Format: JS formatting keeps as-is (no build step). Use your IDE for full format.','info',3000);
  });
  document.getElementById('btnInsertSampleApp')?.addEventListener('click', ()=>{
    setAppValue(`const mysql = require('mysql2/promise');\nconst pool = mysql.createPool({host:'localhost',user:'root',database:'shop'});\nconst [rows] = await pool.query('SELECT * FROM products WHERE price < ?', [100]);\nconsole.table(rows);\nawait pool.end();`);
  });
  document.getElementById('btnClearConsole')?.addEventListener('click', clearConsole);
  document.getElementById('btnCopySnippet')?.addEventListener('click', ()=>{
    const code=document.getElementById('snippetCode').textContent;
    navigator.clipboard.writeText(code).then(()=> showToast('Copied snippet','success',1500));
  });
  document.getElementById('latencySlider')?.addEventListener('input', (e)=>{
    const v=e.target.value;
    document.getElementById('latencyVal').textContent=v+' ms';
    setLatency(v);
  });

  // Database manager
  document.getElementById('btnNewDB')?.addEventListener('click', async ()=>{
    if(!confirm('Create a new empty database? This clears current DB (you can Export first).')) return;
    await resetDatabase();
    postExecRefresh('Created new database');
  });
  document.getElementById('btnLoadSample')?.addEventListener('click', async ()=>{
    if(confirm('Load sample e-commerce DB? This will reset the current DB.')){
      await loadSample();
      postExecRefresh('Sample shop database loaded');
      setSqlValue(`SHOW TABLES;\nSELECT * FROM customers LIMIT 5;\nSELECT * FROM orders LIMIT 5;`);
    }
  });
  document.getElementById('btnExportSql')?.addEventListener('click', ()=>{
    const sql=exportSql();
    download('dump.sql', sql, 'text/sql');
    showToast('Exported SQL dump','success',2000);
  });
  document.getElementById('btnExportDb')?.addEventListener('click', ()=>{
    const bin=exportBinary();
    const blob=new Blob([bin], {type:'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='database.sqlite'; a.click(); URL.revokeObjectURL(url);
    showToast('Exported .sqlite binary','success',2000);
  });
  document.getElementById('btnResetDB')?.addEventListener('click', async ()=>{
    if(document.getElementById('confirmDialog')){
      const dlg=document.getElementById('confirmDialog');
      document.getElementById('confirmTitle').textContent='Reset database?';
      document.getElementById('confirmMessage').textContent='This will drop all tables and data. This cannot be undone.';
      dlg.showModal();
      dlg.addEventListener('close', async ()=>{
        if(dlg.returnValue==='confirm'){
          await resetDatabase(); postExecRefresh('Database reset');
        }
      }, {once:true});
    } else {
      if(confirm('Drop everything?')){ await resetDatabase(); postExecRefresh('Database reset'); }
    }
  });
  document.getElementById('btnRefreshTree')?.addEventListener('click', refreshAll);
  document.getElementById('treeSearch')?.addEventListener('input', (e)=>{
    const q=e.target.value.toLowerCase();
    document.querySelectorAll('#dbTree .tree-node').forEach(n=>{
      const txt=n.textContent.toLowerCase();
      n.style.display = txt.includes(q) || q==='' ? '' : 'none';
    });
  });
  document.getElementById('importSqlFile')?.addEventListener('change', async (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const text=await file.text();
    const res=await importSql(text);
    const fails=res.filter(r=>!r.success);
    if(fails.length) showToast(`Import: ${res.length - fails.length} OK, ${fails.length} failed — see Results`,'warn',4000);
    else showToast(`Imported ${res.length} statements`,'success',2000);
    // show results
    renderResults(res, {onExplain: handleExplainFromResult});
    handleCompatPanel(res);
    addHistory(text, res);
    refreshAll();
    e.target.value='';
  });
  document.getElementById('importDbFile')?.addEventListener('change', async (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const buf=await file.arrayBuffer();
    await importBinary(new Uint8Array(buf));
    showToast('Binary DB imported','success',2000);
    refreshAll();
    e.target.value='';
  });
  document.getElementById('historySearch')?.addEventListener('input', (e)=>{
    renderHistoryFilter(e.target.value);
  });
  document.getElementById('btnClearHistory')?.addEventListener('click', ()=>{
    state.history=[]; persistHistory(); renderHistory(state.history, (h)=> setSqlValue(h.sql));
  });

  // Data browser
  document.getElementById('dataTableSelect')?.addEventListener('change', (e)=>{
    state.currentDataTable=e.target.value;
    refreshDataGrid();
  });
  document.getElementById('btnDataRefresh')?.addEventListener('click', refreshDataGrid);
  document.getElementById('btnAddRow')?.addEventListener('click', handleAddRow);
  document.getElementById('btnDeleteRow')?.addEventListener('click', handleDeleteRow);

  // Schema events
  window.addEventListener('schema:select', (e)=>{
    // load into SQL editor and switch tab
    setSqlValue(e.detail.sql);
    document.querySelector('.tab[data-tab="sql"]')?.click();
    showToast('Loaded into SQL Editor','info',1500);
  });
  window.addEventListener('schema:drop', async (e)=>{
    const table=e.detail.table;
    if(confirm(`Drop table ${table}?`)){
      const res=await exec(`DROP TABLE "${table}"`);
      renderResults(res);
      handleCompatPanel(res);
      postExecRefresh(`Dropped ${table}`);
    }
  });
  window.addEventListener('schema:refresh', ()=> renderSchema());

  // Empty state demo buttons
  document.querySelector('[data-action="load-sample"]')?.addEventListener('click', async ()=>{
    await loadSample(); postExecRefresh('Sample loaded'); setSqlValue('SHOW TABLES;\nSELECT * FROM customers LIMIT 5;');
  });
  document.querySelector('[data-action="insert-demo"]')?.addEventListener('click', async ()=>{
    const res=await exec('SELECT 42 AS answer, "hello" AS msg;'); renderResults(res);
  });

  // Injection lesson
  document.getElementById('btnUnsafe')?.addEventListener('click', handleUnsafe);
  document.getElementById('btnSafe')?.addEventListener('click', handleSafe);

  // About sample sql block
  const sampleBlock=document.getElementById('sampleSqlBlock');
  if(sampleBlock) sampleBlock.textContent=SAMPLE_SQL.trim();

  // Resizable sidebar
  initResizers();

  // Initial render
  refreshAll();
  renderHistory(state.history, (h)=> setSqlValue(h.sql));
  renderSavedScripts();
  renderLessons();
  renderChallenges();
  updateBadges();

  // Show compatibility notes if any previous?
  // Persist editor content
  sqlEditor.on('change', debounce(()=>{ localStorage.setItem('mysql-playground-sql', sqlEditor.getValue()); }, 500));
  appEditor.on('change', debounce(()=>{ localStorage.setItem('mysql-playground-app', appEditor.getValue()); }, 500));
  const savedSql=localStorage.getItem('mysql-playground-sql');
  const savedApp=localStorage.getItem('mysql-playground-app');
  if(savedSql) setSqlValue(savedSql);
  if(savedApp) setAppValue(savedApp);

  // Keyboard save script handled via event
  window.addEventListener('saveScript', saveScript);

  // About button
  document.getElementById('btnAbout')?.addEventListener('click', ()=>{
    document.querySelector('.tab[data-tab="about"]')?.click();
  });

  // Ensure engine badge persist method updated after init
  updateBadges();

  // Handle page visibility persist
  window.addEventListener('beforeunload', ()=>{ /* persist already */ });

  showToast('MySQL Playground Studio ready — try Run or Load Sample DB','success',3000);
}

function debounce(fn, ms){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}

async function handleRun(mode){
  const sql = mode==='current' ? getCurrentStatement() : getAllSql();
  if(!sql.trim()){ showToast('Nothing to run','warn',2000); return; }
  const start=performance.now();
  const results = await exec(sql);
  renderResults(results, {onExplain: handleExplainFromResult});
  handleCompatPanel(results);
  addHistory(sql, results);
  // Refresh schema/tree/data if needed
  const needsRefresh = results.some(r=> /^\s*(CREATE|ALTER|DROP|TRUNCATE)/i.test(r.original) || !r.success===false);
  // Actually refresh always for schema introspection? But only if DDL
  const hasDDL = results.some(r=> r.success && /^\s*(CREATE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|ROLLBACK)/i.test(r.original));
  if(hasDDL || results.some(r=>!r.success)) {
    refreshAll();
  } else {
    // still update row counts
    updateTree();
  }
  // Show explain tip if SELECT?
  // Update status
  document.getElementById('editorStatus').textContent = results[0]?.success ? `OK ${ (performance.now()-start).toFixed(0)} ms` : 'Error';
  setTimeout(()=> document.getElementById('editorStatus').textContent='Ready', 3000);
}

function handleCompatPanel(results){
  const panel=document.getElementById('compatPanel');
  const orig=document.getElementById('compatOriginal');
  const trans=document.getElementById('compatTranslated');
  const rewritten = results.filter(r=>r.wasRewritten);
  if(rewritten.length){
    panel.classList.remove('hidden');
    orig.textContent = rewritten.map(r=>r.original.trim()).join('\n---\n');
    trans.textContent = rewritten.map(r=>r.translated.trim()).join('\n---\n');
    // also add notes
    const notes = [...new Set(rewritten.flatMap(r=>r.compatNotes))].join(' • ');
    const noteEl=document.createElement('div');
    noteEl.className='small muted';
    noteEl.style.marginTop='6px';
    noteEl.textContent = notes;
    // remove old note if exists
    const old=panel.querySelector('.compat-notes');
    if(old) old.remove();
    noteEl.classList.add('compat-notes');
    panel.appendChild(noteEl);
  } else {
    // don't hide if previously hidden? Keep hidden
    // but if no rewrite, hide
    // panel.classList.add('hidden');
  }
}

async function handleExplainFromResult(r){
  // r is result object, need to EXPLAIN the original SELECT
  const sql = r.original;
  if(!/^\s*SELECT/i.test(sql)){
    showToast('EXPLAIN works on SELECT. Current result is not a SELECT.','warn',3000);
    return;
  }
  try{
    const plan = await exec(`EXPLAIN QUERY PLAN ${sql}`);
    showExplain(sql, plan[0]);
  }catch(e){
    showToast('Explain failed: '+e.message,'error',3000);
  }
}
async function explainCurrent(){
  const cur = getCurrentStatement();
  if(!cur.trim()){ showToast('No SELECT to explain','warn',2000); return; }
  if(!/^\s*SELECT/i.test(cur)){
    showToast('Cursor is not on a SELECT. Place cursor on a SELECT first.','warn',3000);
    return;
  }
  const plan = await exec(`EXPLAIN QUERY PLAN ${cur}`);
  showExplain(cur, plan[0]);
}
function showExplain(sql, planResult){
  const panel=document.getElementById('explainPanel');
  const content=document.getElementById('explainContent');
  const planEl=document.getElementById('explainPlan');
  panel.classList.remove('hidden');
  // Logical execution order explanation
  const steps=[
    { name:'FROM / JOIN', desc:'Identify tables and join rows. FROM is first, then JOIN builds the working set.' },
    { name:'WHERE', desc:'Filter rows before grouping. Uses indexes if available.' },
    { name:'GROUP BY', desc:'Collapse rows per group for aggregates.' },
    { name:'HAVING', desc:'Filter groups after aggregation.' },
    { name:'SELECT', desc:'Project columns / expressions, compute CASE, aggregates.' },
    { name:'DISTINCT', desc:'Deduplicate result rows if DISTINCT present.' },
    { name:'ORDER BY', desc:'Sort the final rows.' },
    { name:'LIMIT / OFFSET', desc:'Slice the sorted result.' },
  ];
  // Detect which steps apply
  const upper=sql.toUpperCase();
  const active = steps.filter(s=>{
    if(s.name==='FROM / JOIN' && upper.includes('FROM')) return true;
    if(s.name==='WHERE' && upper.includes('WHERE')) return true;
    if(s.name==='GROUP BY' && upper.includes('GROUP BY')) return true;
    if(s.name==='HAVING' && upper.includes('HAVING')) return true;
    if(s.name==='SELECT') return true;
    if(s.name==='DISTINCT' && upper.includes('DISTINCT')) return true;
    if(s.name==='ORDER BY' && upper.includes('ORDER BY')) return true;
    if(s.name==='LIMIT / OFFSET' && upper.includes('LIMIT')) return true;
    return false;
  });
  let html=`<p class="small muted">Logical execution order for this query:</p><div class="explain-steps">`;
  active.forEach((s,i)=>{
    html+=`<div class="explain-step ${i===0?'active':''}" title="${s.desc}">${i+1}. ${s.name}</div>`;
  });
  html+=`</div><p class="small">${active.map(s=>`<strong>${s.name}:</strong> ${s.desc}`).join('<br>')}</p>`;
  // highlight tables/cols in diagram? we can trigger schema highlight
  // Show row counts intermediate? Not feasible without step execution; provide estimated
  content.innerHTML=html;

  if(planResult && planResult.success){
    const rows=planResult.rows || [];
    const cols=planResult.columns || [];
    let txt = rows.map(r=> cols.map(c=> `${c}=${r[c]}`).join(' | ')).join('\n') || 'No plan rows';
    // Determine tip
    let tip='';
    const planStr=JSON.stringify(rows).toLowerCase();
    if(planStr.includes('scan')){
      // check if where clause exists
      const colMatch = sql.match(/WHERE\s+(\w+\.)?(\w+)/i);
      const col = colMatch ? colMatch[2] : null;
      tip = `⚠️ Full table SCAN detected — consider adding an index${col? ` on ${col}`:''} to avoid scanning all rows.`;
    } else if(planStr.includes('search') && planStr.includes('index')){
      tip = `✅ Good — plan uses SEARCH USING INDEX (indexed lookup).`;
    } else if(planStr.includes('covering')){
      tip = `✅ Covering index — query served from index alone.`;
    }
    planEl.innerHTML = `EXPLAIN QUERY PLAN output:\n${txt}\n\n${tip}\n${tip.includes('SCAN')? `<button class="btn btn-ghost btn-small" id="btnCreateIdxTip">Create suggested index</button>`:''}`;
    if(tip.includes('SCAN')){
      setTimeout(()=>{
        document.getElementById('btnCreateIdxTip')?.addEventListener('click', async ()=>{
          const m=sql.match(/WHERE\s+`?(\w+)`?\.`?(\w+)`?/i) || sql.match(/WHERE\s+`?(\w+)`?/i);
          let table, col;
          if(m){
            if(m[2]){ table=m[1]; col=m[2]; } else { col=m[1]; table='orders'; }
            const idxSql=`CREATE INDEX idx_${table}_${col} ON ${table}(${col});`;
            const res=await exec(idxSql);
            renderResults(res); refreshAll();
            showToast(`Created index ${idxSql}`,'success',2500);
          }
        });
      },0);
    }
  } else {
    planEl.textContent = planResult ? JSON.stringify(planResult,null,2) : 'No plan';
  }
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
}

// History
function addHistory(sql, results){
  const entry={
    time: Date.now(),
    sql: sql.slice(0,500),
    success: results.every(r=>r.success),
    duration: results.reduce((a,r)=>a+(r.duration||0),0),
    rows: results.reduce((a,r)=>a+(r.rowCount||0),0),
    results
  };
  state.history.push(entry);
  if(state.history.length>200) state.history.shift();
  persistHistory();
  renderHistory(state.history, (h)=> setSqlValue(h.sql));
  renderHistoryFilter(document.getElementById('historySearch')?.value || '');
}
function persistHistory(){
  localStorage.setItem('mysql-playground-history', JSON.stringify(state.history));
}
function renderHistoryFilter(q){
  const list=document.getElementById('queryHistory');
  if(!list) return;
  if(!q){
    renderHistory(state.history, (h)=> setSqlValue(h.sql));
    return;
  }
  const filtered=state.history.filter(h=> h.sql.toLowerCase().includes(q.toLowerCase()));
  renderHistory(filtered, (h)=> setSqlValue(h.sql));
}

// Tree & data
function refreshAll(){
  updateTree();
  renderSchema();
  refreshDataGrid();
  updateBadges();
}
function updateTree(){
  const data=introspect();
  renderTree(data.details, handleTreeAction);
  // update data table select
  const sel=document.getElementById('dataTableSelect');
  if(sel){
    const prev=sel.value;
    sel.innerHTML='';
    const tables=Object.keys(data.details).filter(k=>!data.details[k].isView).sort();
    tables.forEach(t=>{
      const o=document.createElement('option'); o.value=t; o.textContent=`${t} (${data.details[t].rowCount})`;
      sel.appendChild(o);
    });
    if(prev && tables.includes(prev)) sel.value=prev;
    else if(tables.length) sel.value=tables[0];
    state.currentDataTable=sel.value;
  }
}
async function handleTreeAction(action, table){
  if(action==='select'){
    state.currentDataTable=table;
    const sel=document.getElementById('dataTableSelect');
    if(sel) sel.value=table;
    // switch to data tab
    document.querySelector('.tab[data-tab="data"]')?.click();
    refreshDataGrid();
  } else if(action==='browse'){
    state.currentDataTable=table;
    document.querySelector('.tab[data-tab="data"]')?.click();
    refreshDataGrid();
  } else if(action==='structure'){
    setSqlValue(`DESCRIBE ${table};`);
    document.querySelector('.tab[data-tab="sql"]')?.click();
    handleRun('current');
  } else if(action==='showcreate'){
    setSqlValue(`SHOW CREATE TABLE ${table};`);
    document.querySelector('.tab[data-tab="sql"]')?.click();
    handleRun('current');
  } else if(action==='select'){
    // duplicate
  } else if(action==='select'){} // no
  else if(action==='select'){}
  if(action==='select'){} // keep

  if(action==='select'){ /* already */ }

  // Template generation
  if(action==='select'){ // generate SELECT
    const data=introspect();
    const cols=(data.details[table]?.columns||[]).map(c=>c.name).join(', ') || '*';
    setSqlValue(`SELECT ${cols} FROM ${table} LIMIT 20;`);
    document.querySelector('.tab[data-tab="sql"]')?.click();
  }
  if(action==='insert'){
    const data=introspect();
    const cols=(data.details[table]?.columns||[]).filter(c=>!c.pk).map(c=>c.name);
    const placeholders=cols.map(()=>"'value'").join(', ');
    setSqlValue(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders});`);
    document.querySelector('.tab[data-tab="sql"]')?.click();
  }
  if(action==='truncate'){
    if(confirm(`Truncate (DELETE all rows) from ${table}?`)){
      const res=await exec(`DELETE FROM "${table}";`);
      renderResults(res); refreshAll();
    }
  }
  if(action==='drop'){
    if(confirm(`DROP TABLE ${table}? This cannot be undone.`)){
      const res=await exec(`DROP TABLE "${table}";`);
      renderResults(res); refreshAll();
    }
  }
}

async function refreshDataGrid(){
  const table=state.currentDataTable || document.getElementById('dataTableSelect')?.value;
  if(!table){
    renderDataGrid(null, [], []);
    document.getElementById('dataRowCount').textContent='';
    return;
  }
  state.currentDataTable=table;
  const data=introspect();
  const info=data.details[table];
  if(!info){
    renderDataGrid(table, [], []);
    return;
  }
  // fetch rows
  try{
    const res=await exec(`SELECT * FROM "${table.replace(/"/g,'""')}" LIMIT 200;`);
    const r=res[0];
    if(!r.success){
      renderDataGrid(table, (info.columns||[]).map(c=>c.name), []);
      document.getElementById('dataRowCount').textContent=`Error: ${r.error.code}`;
      return;
    }
    const cols=r.columns || (info.columns||[]).map(c=>c.name);
    const rows=r.rows || [];
    document.getElementById('dataRowCount').textContent=`${rows.length} rows (limit 200) • ${cols.length} cols`;
    renderDataGrid(table, cols, rows, {
      onEdit: async (idx, col, newVal, oldVal, row)=>{
        // Generate UPDATE
        // Need primary key to identify row; fallback to rowid
        const pkCol = (info.columns||[]).find(c=>c.pk)?.name;
        let where;
        let params;
        if(pkCol && row[pkCol]!==null && row[pkCol]!==undefined){
          where=`"${pkCol}" = ?`;
          params=[newVal, row[pkCol]];
          // But we need SET col = ? WHERE pk = ?
          const sql=`UPDATE "${table}" SET "${col}" = ? WHERE "${pkCol}" = ?;`;
          const vals=[newVal, row[pkCol]];
          const res=await exec(sql, {params: vals});
          if(res[0].success){
            showToast(`Updated ${col} (row ${idx})`, 'success',2000);
            // also update local row? Refresh
            refreshDataGrid(); refreshAll();
            // log to history? Add entry
            addHistory(sql, res);
          } else {
            showToast(`Update failed: ${res[0].error.mysqlStyled}`,'error',4000);
            refreshDataGrid();
          }
        } else {
          // No PK — use rowid or all columns as where
          // Use rowid
          try{
            const ridRes=await exec(`SELECT rowid, * FROM "${table}" LIMIT 1 OFFSET ${idx}`);
            const rid=ridRes[0]?.rows[0]?.rowid;
            if(rid!==undefined){
              const sql=`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`;
              const res=await exec(sql, {params:[newVal, rid]});
              if(res[0].success){ showToast('Updated','success',2000); refreshDataGrid(); refreshAll(); }
              else { showToast(res[0].error.mysqlStyled,'error',4000); refreshDataGrid(); }
            } else {
              showToast('Cannot identify row without PK','error',3000);
            }
          }catch(e){ showToast('Edit failed: '+e.message,'error',3000); }
        }
      },
      onSelectRow: (idx, row)=>{ state.selectedRow={idx, row}; }
    });
  }catch(e){
    showToast('Data load error: '+e.message,'error',3000);
  }
}
async function handleAddRow(){
  const table=state.currentDataTable;
  if(!table){ showToast('Select a table first','warn',2000); return; }
  const data=introspect();
  const info=data.details[table];
  const cols=(info.columns||[]).filter(c=> !(c.pk && c.type.toUpperCase().includes('INTEGER'))); // skip autoinc
  // Prompt for values
  const values = cols.map(c=>{
    const input = prompt(`Value for ${c.name} (${c.type}${c.notnull?' NOT NULL':''}) — leave empty for NULL/default:`, '');
    if(input===null) return null; // cancel
    if(input==='' && !c.notnull) return null;
    return input;
  });
  if(values.includes(null) && values.some(v=> v===null && cols.find((c,i)=> values[i]===null && c.notnull))){
    // allow null? but check
  }
  // Need to handle cancellation: if user cancelled prompt, values will be null for that col but we can't distinguish empty vs cancel. Use separate flag.
  // For now if any prompt returned null due to cancel, we treat as cancelled if all null? Simpler: if user hit cancel on first, abort
  // Detect if any value is "__CANCEL__"? Not. We'll check if last prompt was null and user didn't provide? Assume not cancelled unless entire array empty.
  // We'll proceed unless user closed prompt with cancel on first col and no values? We'll just if values.length and values[0]===null and prompt returned null for cancel, then abort if user cancelled? But empty string also returns "" not null.
  // prompt returns null only on cancel, "" on empty OK. So if any null, we consider cancel for that column value -> treat as NULL.
  // But if user cancelled mid-way, we should abort. We'll ask confirm.
  // For simplicity, ask to confirm insert
  const nonNullCols = cols.filter((c,i)=> values[i]!==null);
  const nonNullVals = values.filter(v=> v!==null);
  if(nonNullCols.length===0){ showToast('Insert cancelled','info',1500); return; }
  const colList = nonNullCols.map(c=>`"${c.name}"`).join(', ');
  const placeholders = nonNullVals.map(()=> '?').join(', ');
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders});`;
  const res=await exec(sql, {params: nonNullVals});
  if(res[0].success){
    showToast(`Inserted row id ${res[0].insertId}`,'success',2000);
    refreshDataGrid(); refreshAll();
    renderResults(res);
    addHistory(sql, res);
  } else {
    showToast(res[0].error.mysqlStyled,'error',4000);
    renderResults(res);
  }
}
async function handleDeleteRow(){
  const table=state.currentDataTable;
  if(!table){ showToast('Select a table','warn',2000); return; }
  const wrap=document.getElementById('dataGridWrap');
  const idx = wrap?._getSelected?.() : -1;
  if(idx===-1 || idx===undefined){ showToast('Select a row (click the ○)','warn',2000); return; }
  if(!confirm(`Delete row ${idx} from ${table}?`)) return;
  const data=introspect();
  const info=data.details[table];
  const resSelect=await exec(`SELECT rowid, * FROM "${table}" LIMIT 1 OFFSET ${idx}`);
  const row=resSelect[0]?.rows[0];
  const rowid=row?.rowid;
  if(rowid===undefined){ showToast('Cannot find rowid','error',3000); return; }
  const sql=`DELETE FROM "${table}" WHERE rowid = ?`;
  const res=await exec(sql, {params:[rowid]});
  if(res[0].success){
    showToast('Deleted row','success',2000);
    refreshDataGrid(); refreshAll();
    renderResults(res);
    addHistory(sql, res);
  } else {
    showToast(res[0].error.mysqlStyled,'error',3000);
  }
}

// Saved scripts
function saveScript(){
  const dlg=document.getElementById('saveScriptDialog');
  if(dlg){
    dlg.showModal();
    dlg.addEventListener('close', ()=>{
      if(dlg.returnValue!=='confirm') return;
      const name=document.getElementById('saveScriptName').value.trim() || ('script-' + Date.now());
      const content=getAllSql();
      state.scripts[name]=content;
      localStorage.setItem('mysql-playground-scripts', JSON.stringify(state.scripts));
      renderSavedScripts();
      showToast(`Saved script "${name}"`,'success',2000);
      document.getElementById('saveScriptName').value='';
    }, {once:true});
  } else {
    const name=prompt('Script name:','my-query');
    if(!name) return;
    state.scripts[name]=getAllSql();
    localStorage.setItem('mysql-playground-scripts', JSON.stringify(state.scripts));
    renderSavedScripts();
  }
}
function loadScriptPrompt(){
  const names=Object.keys(state.scripts);
  if(!names.length){ showToast('No saved scripts','info',2000); return; }
  const name=prompt('Load script: available — '+names.join(', ')+'\nEnter name:','');
  if(name && state.scripts[name]){
    setSqlValue(state.scripts[name]);
    showToast(`Loaded "${name}"`,'success',1500);
  } else if(name){
    showToast('Script not found','error',2000);
  }
}
function renderSavedScripts(){
  const el=document.getElementById('savedScripts');
  if(!el) return;
  el.innerHTML='';
  const names=Object.keys(state.scripts);
  if(!names.length){ el.innerHTML='<div class="muted small" style="padding:6px">No scripts yet</div>'; return; }
  names.forEach(name=>{
    const div=document.createElement('div');
    div.className='saved-item';
    div.innerHTML=`<span>${escapeHtml(name)}</span><span><button class="btn btn-ghost btn-small" data-load>Load</button> <button class="btn btn-icon" data-del title="Delete">✕</button></span>`;
    div.querySelector('[data-load]').addEventListener('click', ()=>{ setSqlValue(state.scripts[name]); showToast(`Loaded ${name}`,'info',1500); });
    div.querySelector('[data-del]').addEventListener('click', ()=>{
      delete state.scripts[name];
      localStorage.setItem('mysql-playground-scripts', JSON.stringify(state.scripts));
      renderSavedScripts();
    });
    el.appendChild(div);
  });
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Export helpers
function exportCsv(){
  const res=getActiveResult();
  if(!res || !res.columns || !res.columns.length){ showToast('No SELECT result to export','warn',2000); return; }
  const cols=res.columns;
  let csv=cols.map(c=> `"${String(c).replace(/"/g,'""')}"`).join(',')+'\n';
  for(const row of res.rows){
    csv+=cols.map(c=>{
      const v=row[c];
      if(v===null) return '';
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(',')+'\n';
  }
  download('results.csv', csv, 'text/csv');
  showToast('Exported CSV','success',1500);
}
function exportJson(){
  const res=getActiveResult();
  if(!res){ showToast('No result','warn',2000); return; }
  let data;
  if(res.columns && res.columns.length) data=res.rows;
  else data={ status: res.status, affected: res.affectedRows, insertId: res.insertId };
  download('results.json', JSON.stringify(data,null,2), 'application/json');
  showToast('Exported JSON','success',1500);
}
function copyMarkdown(){
  const res=getActiveResult();
  if(!res || !res.columns || !res.columns.length){ showToast('No SELECT to copy','warn',2000); return; }
  const cols=res.columns;
  let md='| '+cols.join(' | ')+' |\n| '+cols.map(()=>'---').join(' | ')+' |\n';
  for(const row of res.rows.slice(0,100)){
    md+='| '+cols.map(c=> row[c]===null ? 'NULL' : String(row[c]).replace(/\|/g,'\\|')).join(' | ')+' |\n';
  }
  navigator.clipboard.writeText(md).then(()=> showToast('Copied Markdown','success',1500));
}
function copyInserts(){
  const res=getActiveResult();
  if(!res || !res.columns || !res.columns.length){ showToast('No SELECT to copy','warn',2000); return; }
  const table = state.currentDataTable || 'table';
  const cols=res.columns;
  let sql='';
  for(const row of res.rows.slice(0,100)){
    const vals=cols.map(c=>{
      const v=row[c];
      if(v===null) return 'NULL';
      if(typeof v==='number') return String(v);
      return `'${String(v).replace(/'/g,"''")}'`;
    }).join(', ');
    sql+=`INSERT INTO "${table}" (${cols.map(c=>`"${c}"`).join(', ')}) VALUES (${vals});\n`;
  }
  navigator.clipboard.writeText(sql).then(()=> showToast('Copied INSERT statements','success',1500));
}
function download(filename, content, type){
  const blob=new Blob([content], {type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

// App code playground execution
let appAbortController=null;
let appTimeout=null;

async function handleAppRun(){
  const code=appEditor.getValue();
  if(!code.trim()){ showToast('No app code to run','warn',2000); return; }
  clearConsole();
  appendConsole('▶ Running app code…','info');
  // Setup abort
  if(appAbortController) appAbortController.abort();
  appAbortController=new AbortController();
  const signal=appAbortController.signal;

  // Prepare sandbox context
  const latencyVal=document.getElementById('latencySlider')?.value||0;
  setLatency(latencyVal);

  // Capture console
  const capturedConsole = {
    log: (...args)=> appendConsole(args.map(a=> typeof a==='object' ? JSON.stringify(a,null,2) : String(a)).join(' '), 'log'),
    error: (...args)=> appendConsole(args.map(a=> String(a)).join(' '), 'error'),
    warn: (...args)=> appendConsole(args.map(a=> String(a)).join(' '), 'warn'),
    info: (...args)=> appendConsole(args.map(a=> String(a)).join(' '), 'info'),
    table: (data)=> {
      if(Array.isArray(data)) appendConsole(data, 'table');
      else appendConsole(typeof data==='object'? JSON.stringify(data,null,2): String(data), 'log');
    },
  };

  // Require shim
  function requireShim(mod){
    if(mod==='mysql2/promise' || mod==='mysql2/promise.js' || mod==='mysql2'){
      // Return object with createPool etc.
      return {
        createPool: (cfg)=> createPool(cfg),
        createConnection: (cfg)=> createConnection(cfg),
        escape: (v)=> v, // simplified
        escapeId: (v)=> v,
      };
    }
    if(mod==='mysql2') return { createPool, createConnection };
    if(mod==='dotenv') return { config: ()=>({}) };
    throw new Error(`Cannot find module '${mod}' — only 'mysql2/promise' is available in this playground.`);
  }

  // Wrap code for top-level await: create async function
  // We need to handle import style? Only require is needed.
  // Use AsyncFunction constructor

  let execPromise;
  try{
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    // We expose require, console, pool? Actually user creates pool via require.
    // Provide setTimeout, clearTimeout, etc? Keep limited.
    const fn = new AsyncFunction('require','console','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask',
      // preprocess code to allow top-level await: already async function so top-level await works.
      // Also expose global pool? no.
      code + '\n//# sourceURL=app-code.js'
    );
    // Timeout protection 8 seconds
    const timeoutMs=8000;
    let timedOut=false;
    appTimeout=setTimeout(()=>{
      timedOut=true;
      appendConsole('⏹ Execution timed out after 8s — possible infinite loop. Stopping.','error');
      if(appAbortController) appAbortController.abort();
    }, timeoutMs);

    const start=performance.now();
    // Execute
    const resultPromise = fn(requireShim, capturedConsole, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask);
    // resultPromise is promise from async function
    await resultPromise;
    clearTimeout(appTimeout);
    const dur=(performance.now()-start).toFixed(1);
    appendConsole(`✓ Finished in ${dur} ms`, 'info');
    showToast('App code finished','success',2000);
    // After app code, refresh schema/data because it may have written
    refreshAll();
    // Also show that DB changed
  }catch(err){
    clearTimeout(appTimeout);
    // Extract line number if possible
    let msg=err.message || String(err);
    // Try to parse stack for line
    let lineInfo='';
    if(err.stack){
      const m=err.stack.match(/app-code\.js:(\d+):(\d+)/);
      if(m) lineInfo=` (line ${m[1]})`;
    }
    // Enhance mysql errors
    if(err.code){
      msg=`${err.code} (${err.errno}): ${err.sqlMessage||err.message}`;
      if(err.hint) msg+=`\nHint: ${err.hint}`;
    }
    appendConsole(`Error${lineInfo}: ${msg}`, 'error');
    if(err.stack) appendConsole(err.stack, 'error');
    showToast(`App error${lineInfo}: ${err.code||''} ${err.message}`,'error',4000);
  } finally {
    clearTimeout(appTimeout);
    appAbortController=null;
  }
}
function stopAppRun(){
  if(appAbortController){ appAbortController.abort(); appendConsole('⏹ Stopped by user','warn'); showToast('Stopped','warn',2000); }
  else { showToast('No running app code','info',1500); }
  clearTimeout(appTimeout);
}

// Injection lesson
async function handleUnsafe(){
  const input=document.getElementById('injectionInput')?.value || "' OR '1'='1";
  // Unsafe: build SQL via concatenation
  const unsafeSql = `SELECT * FROM customers WHERE name = '${input.replace(/'/g,"''")}' -- but naive concat would be broken; we simulate vulnerability by directly embedding without escaping?`;
  // Actually demonstrate unsafe: SELECT * FROM customers WHERE name = '${input}'  (with injection)
  // If input is "' OR '1'='1", then query becomes SELECT * FROM customers WHERE name = '' OR '1'='1'  which returns all.
  // Simulate unsafe generation:
  const rawInjection = input; // keep as is for SQL generation
  // Build unsafe query via string concat (without escaping)
  const unsafeQuery = `SELECT * FROM customers WHERE name = '${rawInjection}'`;
  // This will be syntactically maybe broken; but with payload ' OR '1'='1 it becomes SELECT * FROM customers WHERE name = '' OR '1'='1'  -> returns all
  // Let's use the payload as is without escaping '
  // So if user input is exactly "' OR '1'='1" (including leading ' ), then concat yields injection.
  // We'll not escape at all for unsafe demo.
  const unsafeDisplay = `SELECT * FROM customers WHERE name = '${rawInjection}'`;
  // For safe, use prepared
  // Execute both
  let unsafeResult, safeResult;
  try{
    const resUnsafe = await exec(unsafeDisplay);
    unsafeResult = resUnsafe[0];
  }catch(e){
    unsafeResult = { success:false, error:{ mysqlStyled:String(e), underlying:String(e), hint:'' } };
  }
  try{
    const resSafe = await exec(`SELECT * FROM customers WHERE name = ?`, {params:[input]});
    // But engine exec with params expects single statement params; we used exec with params earlier but that path is for single statement param binding; here we want to test safe binding
    // Actually exec with params array: it will prepare and bind
    // Let's call correctly:
    const resSafe2 = await exec(`SELECT * FROM customers WHERE name = ?`, {params:[input]});
    safeResult = resSafe2[0];
  }catch(e){
    // fallback
    const resSafe = await exec(`SELECT * FROM customers WHERE name = '${input.replace(/'/g,"''")}'`);
    safeResult = resSafe[0];
  }
  // Simpler: for safe, we demonstrate via driver? Use prepared.
  // Let's do via driver to show placeholder
  const safeDisplay = `SELECT * FROM customers WHERE name = ?  -- with param [${JSON.stringify(input)}]`;

  const out=document.getElementById('injectionResult');
  if(out){
    out.innerHTML = `<div><strong>Unsafe (string concat):</strong><br><code>${escapeHtml(unsafeDisplay)}</code><br>Result: ${unsafeResult.success ? unsafeResult.rows.length+' rows (INJECTION! returned all)' : 'Error: '+ escapeHtml(unsafeResult.error.mysqlStyled)}${unsafeResult.success && unsafeResult.rows.length>0? `<br><small>${escapeHtml(JSON.stringify(unsafeResult.rows.slice(0,3)))}</small>`:''}</div>
      <div style="margin-top:8px"><strong>Safe (prepared):</strong><br><code>${escapeHtml(safeDisplay)}</code><br>Result: ${safeResult.success ? safeResult.rows.length+' rows (correct — no injection, looks for literal name)' : 'Error: '+escapeHtml(safeResult.error.mysqlStyled)}<br><small>${safeResult.success? escapeHtml(JSON.stringify(safeResult.rows.slice(0,2))) : ''}</small></div>
      <div class="small muted" style="margin-top:8px">Why placeholders matter: the DB treats the param as a value, not as SQL. Concatenation lets attackers inject OR 1=1. Always use <code>?</code> or named placeholders.</div>`;
  }
  refreshAll();
}
async function handleSafe(){
  const input=document.getElementById('injectionInput')?.value || "' OR '1'='1";
  // Safe demonstration via driver pool
  try{
    const pool=createPool({database:'shop'});
    const [rows]=await pool.query('SELECT * FROM customers WHERE name = ?', [input]);
    const out=document.getElementById('injectionResult');
    out.innerHTML=`<div><strong>Safe query via pool.execute:</strong><br><code>SELECT * FROM customers WHERE name = ?</code> with param ${escapeHtml(JSON.stringify(input))}<br>Result: ${rows.length} rows<br><small>${escapeHtml(JSON.stringify(rows.slice(0,3)))}</small><br><span class="small muted">No injection — param is escaped as a value.</span></div>`;
    await pool.end();
  }catch(e){
    document.getElementById('injectionResult').textContent='Safe error: '+e.message;
  }
}

// Lessons rendering
function renderLessons(){
  const list=document.getElementById('lessonList');
  const content=document.getElementById('lessonContent');
  const quizArea=document.getElementById('quizArea');
  if(!list) return;
  list.innerHTML='';
  lessons.forEach((lesson, idx)=>{
    const item=document.createElement('div');
    item.className='lesson-item'+(state.lessonProgress[lesson.id]?' completed':'');
    item.innerHTML=`<h4>${idx+1}. ${escapeHtml(lesson.title)} <span class="muted small">${lesson.level}</span></h4><p>${lesson.id}</p><div class="meta">${state.lessonProgress[lesson.id]?'✓ Completed':'Click to load'}</div>`;
    item.addEventListener('click', ()=>{
      // load lesson
      content.innerHTML=`<h2>${escapeHtml(lesson.title)}</h2><div class="small muted">${lesson.level}</div>${lesson.content}<div style="margin-top:12px"><button class="btn btn-primary" data-load-sql>Load SQL into editor</button> <button class="btn btn-ghost" data-complete>Mark complete</button></div><pre class="code-block small" style="margin-top:10px">${escapeHtml(lesson.sql)}</pre>`;
      content.querySelector('[data-load-sql]')?.addEventListener('click', ()=>{
        setSqlValue(lesson.sql);
        document.querySelector('.tab[data-tab="sql"]')?.click();
        showToast('Lesson SQL loaded','success',1500);
      });
      content.querySelector('[data-complete]')?.addEventListener('click', ()=>{
        state.lessonProgress[lesson.id]=true;
        localStorage.setItem('mysql-playground-lessons', JSON.stringify(state.lessonProgress));
        renderLessons();
        updateProgress();
        showToast('Lesson marked complete','success',1500);
      });
      // quiz
      const quiz=getQuizForLesson(lesson.id);
      if(quiz){
        quizArea.classList.remove('hidden');
        quizArea.innerHTML=`<h4>Quiz — ${escapeHtml(quiz.question)}</h4><div class="quiz-options"></div><div class="small muted" id="quizFeedback"></div>`;
        const optsWrap=quizArea.querySelector('.quiz-options');
        quiz.options.forEach(opt=>{
          const o=document.createElement('div');
          o.className='quiz-option';
          o.textContent=opt.text;
          o.addEventListener('click', ()=>{
            const correct = opt.correct;
            // clear previous
            optsWrap.querySelectorAll('.quiz-option').forEach(el=>{ el.classList.remove('correct','wrong'); });
            o.classList.add(correct?'correct':'wrong');
            const fb=document.getElementById('quizFeedback');
            fb.textContent = correct ? '✅ Correct! ' + (quiz.explanation||'') : '❌ Not quite. ' + (quiz.explanation||'');
            fb.style.color = correct? 'var(--success)':'var(--danger)';
            if(correct){
              state.lessonProgress[lesson.id]=true;
              localStorage.setItem('mysql-playground-lessons', JSON.stringify(state.lessonProgress));
              renderLessons(); updateProgress();
            }
          });
          optsWrap.appendChild(o);
        });
      } else {
        quizArea.classList.add('hidden');
      }
      list.querySelectorAll('.lesson-item').forEach(el=> el.style.borderColor='');
      item.style.borderColor='var(--accent)';
    });
    list.appendChild(item);
  });
  updateProgress();
}
function getQuizForLesson(id){
  const quizzes={
    'what-is-db': { question:'Which is true?', options:[{text:'A table holds rows and columns',correct:true},{text:'A column holds databases',correct:false},{text:'A row is a database',correct:false}], explanation:'Tables contain rows (records) and columns (fields).' },
    'create-types': { question:'AUTO_INCREMENT maps to?', options:[{text:'AUTOINCREMENT with INTEGER PRIMARY KEY',correct:true},{text:'SERIAL',correct:false},{text:'IDENTITY',correct:false}], explanation:'SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT.' },
    'crud': { question:'Which is C in CRUD?', options:[{text:'Create (INSERT)',correct:true},{text:'Commit',correct:false},{text:'Copy',correct:false}], explanation:'CRUD = Create, Read, Update, Delete.' },
    'pk-autoinc': { question:'Primary key must be…', options:[{text:'Unique and NOT NULL',correct:true},{text:'Always a string',correct:false},{text:'Nullable',correct:false}], explanation:'PK uniquely identifies a row, cannot be null.' },
    'fk': { question:'FK violation error code?', options:[{text:'1452 Foreign key constraint fails',correct:true},{text:'1146 Table not exist',correct:false},{text:'1062 Dup entry',correct:false}], explanation:'ERROR 1452 is FK failure.' },
    'joins': { question:'LEFT JOIN keeps…', options:[{text:'All left rows plus NULL for missing right',correct:true},{text:'Only matching rows',correct:false}], explanation:'LEFT keeps all left.' },
    'group': { question:'HAVING filters…', options:[{text:'Groups after aggregation',correct:true},{text:'Rows before grouping',correct:false}], explanation:'WHERE before, HAVING after.' },
    'transactions': { question:'ROLLBACK does?', options:[{text:'Undoes current transaction',correct:true},{text:'Commits',correct:false}], explanation:'ROLLBACK reverts.' },
  };
  return quizzes[id] || null;
}
function updateProgress(){
  const total=lessons.length;
  const done=Object.keys(state.lessonProgress).filter(k=> state.lessonProgress[k]).length;
  const pct=Math.round(done/total*100);
  const fill=document.getElementById('progressFill');
  const text=document.getElementById('progressText');
  if(fill) fill.style.width=pct+'%';
  if(text) text.textContent=`${done} / ${total} completed`;
}

function renderChallenges(){
  const el=document.getElementById('challengeList');
  if(!el) return;
  el.innerHTML='';
  challenges.forEach((ch, idx)=>{
    const div=document.createElement('div');
    div.className='lesson-item'+(state.challengeProgress[ch.id]?' completed':'');
    div.innerHTML=`<h4>${idx+1}. ${escapeHtml(ch.title)} ${state.challengeProgress[ch.id]?'✓':''}</h4><p class="small muted">${escapeHtml(ch.task.slice(0,90))}…</p>`;
    div.addEventListener('click', async ()=>{
      const lessonContent=document.getElementById('lessonContent');
      lessonContent.innerHTML=`<h2>Challenge: ${escapeHtml(ch.title)}</h2><p>${escapeHtml(ch.task)}</p>${ch.sqlHint? `<pre class="code-block small">${escapeHtml(ch.sqlHint)}</pre>`:''}<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary" data-load>Load hint SQL</button> <button class="btn btn-secondary" data-check>Check</button> <button class="btn btn-ghost" data-hint>Hint</button></div><div id="challengeFeedback" class="small" style="margin-top:10px"></div>`;
      lessonContent.querySelector('[data-load]')?.addEventListener('click', ()=>{
        if(ch.sqlHint){ setSqlValue(ch.sqlHint); document.querySelector('.tab[data-tab="sql"]')?.click(); }
        else showToast('No hint SQL — write from scratch','info',2000);
      });
      lessonContent.querySelector('[data-hint]')?.addEventListener('click', ()=>{
        document.getElementById('challengeFeedback').textContent='Hint: '+ (ch.hint||'Try reading the task carefully.');
      });
      lessonContent.querySelector('[data-check]')?.addEventListener('click', async ()=>{
        const fb=document.getElementById('challengeFeedback');
        fb.textContent='Checking…';
        try{
          const res=await ch.check();
          if(res.pass){
            fb.innerHTML=`<span style="color:var(--success)">✅ Passed!</span> ${res.details? `<pre class="code-block small">${escapeHtml(JSON.stringify(res.details,null,2))}</pre>`:''}`;
            state.challengeProgress[ch.id]=true;
            localStorage.setItem('mysql-playground-challenges', JSON.stringify(state.challengeProgress));
            renderChallenges();
          } else {
            fb.innerHTML=`<span style="color:var(--danger)">❌ Not yet.</span> ${escapeHtml(res.hint||'')}`;
          }
        }catch(e){
          fb.textContent='Error checking: '+e.message;
        }
      });
    });
    el.appendChild(div);
  });
}

// Resizers
function initResizers(){
  const sidebar=document.getElementById('sidebar');
  const resizer=document.getElementById('sidebarResizer');
  if(!sidebar || !resizer) return;
  let startX=0, startW=0, dragging=false;
  resizer.addEventListener('mousedown', (e)=>{
    dragging=true; startX=e.clientX; startW=sidebar.offsetWidth;
    resizer.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    const dx=e.clientX - startX;
    const w=Math.min(520, Math.max(220, startW+dx));
    sidebar.style.width=w+'px';
  });
  window.addEventListener('mouseup', ()=>{
    if(dragging){
      dragging=false; resizer.classList.remove('dragging');
      localStorage.setItem('mysql-playground-sidebar-width', sidebar.style.width);
    }
  });
  const savedW=localStorage.getItem('mysql-playground-sidebar-width');
  if(savedW) sidebar.style.width=savedW;
}

function updateBadges(){
  const sizeBadge=document.getElementById('dbSizeBadge');
  const tableBadge=document.getElementById('tableCountBadge');
  const persistBadge=document.getElementById('persistBadge');
  try{
    const bin=exportBinary();
    const kb = bin ? (bin.length/1024).toFixed(1)+' KB' : '—';
    if(sizeBadge) sizeBadge.textContent=kb;
  }catch(e){}
  try{
    const data=introspect();
    const count=Object.keys(data.details).filter(k=>!data.details[k].isView).length;
    if(tableBadge) tableBadge.textContent=`${count} tables • ${getCurrentDatabase()}`;
  }catch(e){}
  if(persistBadge) persistBadge.textContent=getPersistMethod() || 'IndexedDB';
}

function postExecRefresh(msg){
  refreshAll();
  updateBadges();
  if(msg) showToast(msg,'success',2000);
}

// Global error handling
window.addEventListener('error', (e)=>{
  console.error(e);
  // showToast('Error: '+e.message,'error',4000);
});
window.addEventListener('unhandledrejection', (e)=>{
  console.error(e);
  showToast('Unhandled: '+ (e.reason?.message||e.reason), 'error',4000);
});

// Init on DOMContentLoaded
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for debugging
window._playground = { exec, introspect, refreshAll, state };

