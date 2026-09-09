# MySQL Playground Studio

**Real SQL in the browser — MySQL syntax, live ER diagram, app-code playground, no server required.**

MySQL Playground Studio is a complete, browser-based SQL IDE that executes real SQL via **SQLite compiled to WebAssembly (sql.js)** behind a **MySQL compatibility layer**. Write any DDL/DML/DQL, watch the schema visualize live, and run realistic `mysql2/promise` Node.js code that writes to the same database — all client-side, persisted in IndexedDB.

![Dark IDE](https://img.shields.io/badge/theme-dark%20%7C%20light-blue) ![No build](https://img.shields.io/badge/build-none-green) ![Engine](https://img.shields.io/badge/engine-sql.js%20SQLite%20WASM-orange) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## ✨ Features

- **Real SQL execution** — every statement runs through `sql.js` (SQLite WASM), not a parser fake. Errors are real SQLite errors remapped to MySQL `ERROR 1146/1452…` with fix hints.
- **MySQL compatibility** — `AUTO_INCREMENT` → `AUTOINCREMENT`, `ENGINE/CHARSET/COLLATE` stripped, backticks → `"`, types mapped, `NOW()`/`CURDATE()`/`CONCAT`/`YEAR()` polyfilled, `ON DUPLICATE KEY UPDATE` → `ON CONFLICT`, `SHOW/DESCRIBE/USE` emulated.
- **Live schema visualizer** — introspects `sqlite_master` + `PRAGMA table_info/foreign_key_list/index_list`; draggable cards, SVG crow’s-foot lines, inspector, pan/zoom, search, auto-layout.
- **App Code playground** — second CodeMirror editor runs real-looking `mysql2/promise` code (`createPool`, `execute` with `?`, `beginTransaction/commit/rollback`) over the *same* DB via a shim. Captures `console.log/table/error`, supports top-level `await`, timeout & latency slider.
- **Results & history** — tabbed per-statement results, sortable/paginated grid, `NULL` chips, copy/export (CSV/JSON/Markdown/INSERTs), persisted history.
- **Data browser** — editable grid (`UPDATE` on cell edit, `INSERT`/`DELETE` rows).
- **Learn** — 13 guided lessons + 10 challenges with validation, Explain panel (logical order + `EXPLAIN QUERY PLAN` + index tip), FK injection demo.

---

## 🚀 How to Run Locally

### Why a static server is required (not `file://`)

`sql.js` loads its `.wasm` binary via `fetch()`. Browsers block `fetch` for `file://` due to CORS and incorrect MIME types, so the WASM will fail to load. You must serve the folder over HTTP so `sql-wasm.wasm` is fetched with `Content-Type: application/wasm`.

Any static server works:

```bash
# Node (no install needed with npx)
npx serve .
# or
npx http-server -p 8080

# Python
python3 -m http.server 8080

# PHP
php -S localhost:8080

# VS Code
# Right-click index.html → “Live Server”
```

Then open `http://localhost:8080` (or the printed URL). No build step, no npm, no backend.

**Browser requirements:** Modern evergreen with WebAssembly + IndexedDB + ES modules — Chrome 90+, Firefox 90+, Safari 15+, Edge 90+. JS must be enabled.

---

## 📁 Files

```
index.html          — Layout, CDN links, tab panels
styles.css          — Dark/light via CSS vars, IDE layout, grids, responsive
js/engine.js        — sql.js bootstrap + MySQL→SQLite translation, persistence
js/driver.js        — fake mysql2/promise pool/connection shim
js/schema.js        — introspection + draggable SVG diagram
js/ui.js            — CodeMirror editors, results grid, toasts, consoles
js/app.js           — Central state, wiring, lessons, challenges
```

Load via `<script type="module" src="js/app.js">`. For a single-file build, concatenate the CSS into `<style>` and the JS modules into one `<script type="module">` (keeping the CDN `sql-wasm.js` fetch). The modular version is preferred for maintainability.

---

## 🧠 Architecture — Engine → Driver → UI

```
sql.js (SQLite 3.x WASM)
  ↑ engine.js — single db instance, exec/run/introspect/persist, MySQL→SQLite translate, PRAGMA foreign_keys=ON, statement splitting
  ↑ driver.js — mysql2/promise shim (createPool/getConnection/query/execute/beginTransaction, ? binding → prepare, [rows,fields], latency)
  ↑ app.js    — central state, IndexedDB/localStorage persistence, lesson/challenge validation, wiring
  ↑ schema.js — introspection → cards + SVG relationships
  ↑ ui.js     — CodeMirror editors, tab system, results virtualisation, console, toasts, explain
         ↕
      index.html + styles.css (IDE shell)
```

*All DB access goes through `engine.js` (`exec(sql,params)`, `introspect()`, `persist()`). The driver is a thin async wrapper that reuses the same `db`.*

**Persistence:** After every successful write, `db.export()` (Uint8Array) is stored in `IndexedDB` (`MySQLPlaygroundStudio/kv`). On reload, the binary is restored. If IndexedDB is blocked, fallback to `localStorage` base64. Export/Import buttons always work.

---

## 🐬 MySQL → SQLite Translation Rules

| MySQL | SQLite | Notes shown in Compatibility panel |
|---|---|---|
| `INT/TINYINT/BIGINT …` | `INTEGER` | Type affinities |
| `VARCHAR(n)/CHAR` | `TEXT` | |
| `DECIMAL/FLOAT/DOUBLE` | `REAL` | |
| `DATETIME/TIMESTAMP/DATE` | `TEXT` | Stored as ISO strings |
| `BOOLEAN/BOOL` | `INTEGER` | 0/1 |
| `ENUM('a','b')` | `TEXT CHECK ("col" IN ('a','b'))` | Adds CHECK per column |
| `AUTO_INCREMENT` | `AUTOINCREMENT` | Forces `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` | *stripped* | Table options removed |
| `` `id` `` | `"id"` | Backticks → quoted identifiers |
| `NOW()/CURRENT_TIMESTAMP` | `CURRENT_TIMESTAMP` | SQLite native |
| `CURDATE()` | `CURRENT_DATE` | |
| `CONCAT(a,b)` | `(a \|\| b)` | |
| `IFNULL` | `IFNULL` | Kept (alias) |
| `YEAR(col)/MONTH(col)` | `CAST(strftime('%Y',col) AS INTEGER)` | |
| `DATE_FORMAT` | `strftime` | Subset |
| `LIMIT 5,10` | `LIMIT 10 OFFSET 5` | MySQL offset,count → SQLite count offset |
| `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE SET` | UPSERT |
| `SHOW DATABASES/TABLES/CREATE/DESCRIBE/INDEX` | Emulated via `sqlite_master` + `PRAGMA` | Synthetic result sets |
| `USE db` | Logical namespace (`shop`, `test`) | `knownDatabases` Set + `currentDatabase` |
| `UNSIGNED` | *stripped* | |
| `DEFAULT TRUE/FALSE` | `DEFAULT 1/0` | |

The side-by-side **Compatibility notes** panel displays `Original MySQL` vs `Executed SQLite` whenever a rewrite occurs.

---

## 📊 Supported vs Unsupported SQL

| Feature | Status | Details |
|---|---|---|
| CREATE TABLE / IF NOT EXISTS / ALTER (ADD COLUMN) / DROP | ✅ | FK, PK, UNIQUE, CHECK, DEFAULT, FK CASCADE |
| CREATE INDEX / UNIQUE / DROP INDEX | ✅ | |
| CREATE VIEW / DROP VIEW | ✅ | |
| INSERT multi-row, INSERT SELECT | ✅ | |
| REPLACE / `ON DUPLICATE KEY UPDATE` | ✅ | → `ON CONFLICT` |
| UPDATE / DELETE | ✅ | |
| SELECT WHERE DISTINCT ORDER BY LIMIT/OFFSET GROUP BY HAVING | ✅ | |
| INNER/LEFT/CROSS JOIN, self-join, aliases | ✅ | |
| UNION / subqueries / EXISTS / IN / BETWEEN / LIKE / CASE WHEN | ✅ | |
| Aggregates `COUNT/SUM/AVG/MIN/MAX`, window functions | ✅ | Where SQLite supports |
| String/date functions | ✅ | Polyfilled subset |
| Transactions `BEGIN/COMMIT/ROLLBACK/SAVEPOINT` | ✅ | |
| `SHOW / DESCRIBE / USE / EXPLAIN` | ✅ emulated | Via PRAGMA |
| `EXPLAIN QUERY PLAN` | ✅ | Real plan + index tip |
| Stored procedures, `CREATE PROCEDURE/TRIGGER` (complex) | ⚠️ limited | SQLite triggers basic only |
| Users, GRANTS, permissions, multiple real DBs | ❌ | SQLite is single-file, no users; `USE` is logical |
| Strict typing | ⚠️ differing | SQLite is dynamic/affinity |

Errors are surfaced as **MySQL-style** (`ERROR 1146 (42S02): Table 'shop.custmers' doesn't exist`) followed by the SQLite message and a plain-English fix hint.

---

## 🛒 Sample Database — `shop` (Load via “Load Sample Database”)

E-commerce schema with FKs, indexes, view, and ~50 rows:

```sql
-- customers, categories, products, orders, order_items
-- (full script in js/engine.js SAMPLE_SQL — also shown in About → Sample Database)
CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  city VARCHAR(80) DEFAULT 'Unknown',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','paid','shipped','cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

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
SELECT o.id AS order_id, c.name AS customer, o.total, o.status
FROM orders o JOIN customers c ON c.id = o.customer_id;
-- plus INSERTs: 5 customers, 3 categories, 8 products, 6 orders, 10 order_items
```

Use **Database Manager → Load Sample Database** to reset to this state, or **Export SQL / Export .sqlite** to save your work.

---

## 🧪 10 Example SQL Snippets (paste into SQL Editor → Run)

```sql
-- 1. Meta
SHOW TABLES;

-- 2. Join + group (customers vs orders)
SELECT c.name, COUNT(o.id) AS orders
FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
GROUP BY c.id ORDER BY orders DESC;

-- 3. Multi-row insert
INSERT INTO customers (name,email) VALUES
  ('Ada Lovelace','ada@example.com'),
  ('Grace Hopper','grace@example.com');

-- 4. Filter + sort
SELECT * FROM products WHERE price BETWEEN 20 AND 100 ORDER BY price DESC LIMIT 5;

-- 5. HAVING
SELECT status, SUM(total) AS revenue FROM orders GROUP BY status HAVING SUM(total) > 100;

-- 6. IN subquery
SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');

-- 7. UPDATE then read
UPDATE products SET stock = stock -1 WHERE id=1; SELECT * FROM products WHERE id=1;

-- 8. Transaction + ROLLBACK
BEGIN; INSERT INTO orders (customer_id,total,status) VALUES (1,99.9,'paid'); ROLLBACK; SELECT * FROM orders;

-- 9. Explain
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id=1;

-- 10. DESCRIBE + SHOW CREATE
DESCRIBE customers; SHOW CREATE TABLE orders;
```

---

## 💻 3 Example App-Code Snippets (App Code tab → Run)

All use the fake `mysql2/promise` driver over the *same* DB:

```js
// 1 — Transactional insert
const mysql = require('mysql2/promise');
const pool = mysql.createPool({host:'localhost',user:'root',database:'shop'});
const conn = await pool.getConnection();
try{
  await conn.beginTransaction();
  const [r] = await conn.execute('INSERT INTO customers (name,email) VALUES (?,?)',['Ada','ada@example.com']);
  await conn.execute('INSERT INTO orders (customer_id,total,status) VALUES (?,?,?)',[r.insertId,149.99,'paid']);
  await conn.commit(); console.log('committed', r.insertId);
}catch(e){ await conn.rollback(); console.error(e.code, e.sqlMessage);} finally{ conn.release(); }
```

```js
// 2 — Prepared SELECT + console.table
const [rows] = await pool.query('SELECT c.name, o.total FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.status=?',['paid']);
console.table(rows);
```

```js
// 3 — Error handling (FK violation)
try{
  await pool.query('INSERT INTO orders (customer_id,total) VALUES (?,?)',[9999, 10]);
}catch(e){
  console.error(e.code, e.sqlMessage); // ER_NO_REFERENCED_ROW_2
}
```

Additional read-only snippets for **PHP PDO**, **Python**, **Java JDBC**, **Go** are in the App Code → reference tabs.

---

## 🎓 Learn & Challenges

Guided lessons (side drawer, progress bar, quiz) and 10 validated challenges, e.g.:

- Insert a customer + first order in one transaction
- List top 3 products by revenue
- Find customers without orders (LEFT JOIN)
- Add an index and prove `EXPLAIN` uses it

All run against the live DB and give pass/fail + hints.

---

## ⚠️ Honesty & Limitations

- **Real SQLite, not MySQL:** The `mysql2` API is a faithful shim; no network, no MySQL server.
- Data lives locally in `IndexedDB` (fallback `localStorage`). Clearing site data erases the DB — export first.
- See **About → Honest Technical Notes** for the full MySQL-vs-SQLite table.

---

## 🛠️ No Build, No Backend

Vanilla HTML/CSS/JS only. `sql.js` is loaded from CDN: `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js` (with `sql-wasm.wasm`). CodeMirror 5 is loaded from CDN for the editors.

All DB calls go through `js/engine.js`:

```js
await exec("SELECT * FROM customers WHERE id = ?", {params:[1]});
introspect(); // → {tables, views, details}
persist(); reset(); importSql(text); exportSql(); exportBinary();
```

---

## 📄 License

MIT — do what you want, but keep the honesty panel.

