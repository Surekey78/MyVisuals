// js/ui.js — tabs, editors, results grid, toasts, console
import { introspect, splitStatements } from './engine.js';

export function showToast(message, type='info', timeout=3000){
  const container=document.getElementById('toastContainer');
  if(!container) return;
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.textContent=message;
  container.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(8px)'; setTimeout(()=>el.remove(),300); }, timeout);
  // accessibility
  el.setAttribute('role','status');
}

// Editors
let sqlEditor, appEditor;
let currentResults = [];
let activeResultIdx = 0;

export function initEditors({ onRun, onRunAll, onAppRun }){
  // SQL editor
  const taSql = document.getElementById('sqlEditor');
  if(taSql && window.CodeMirror){
    sqlEditor = CodeMirror.fromTextArea(taSql, {
      mode: 'text/x-mysql',
      theme: document.documentElement.getAttribute('data-theme')==='light' ? 'eclipse' : 'material-darker',
      lineNumbers: true,
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      indentWithTabs: false,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Cmd-Space': 'autocomplete',
        'Ctrl-Enter': ()=> onRun && onRun('current'),
        'Cmd-Enter': ()=> onRun && onRun('current'),
        'Ctrl-Shift-Enter': ()=> onRun && onRun('all'),
        'Cmd-Shift-Enter': ()=> onRun && onRun('all'),
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
        'Ctrl-S': ()=> { const ev=new Event('saveScript'); window.dispatchEvent(ev); return false; },
        'Cmd-S': ()=> { const ev=new Event('saveScript'); window.dispatchEvent(ev); return false; }
      },
      hintOptions: {
        tables: {}
      }
    });
    sqlEditor.setSize(null, '100%');
    // placeholder?
    // Autocomplete hook: update tables on focus
    sqlEditor.on('inputRead', (cm, change)=>{
      if(change.text[0]===' ' || change.text[0]==='.' || /[a-zA-Z0-9_]/.test(change.text[0])){
        // don't auto trigger always; only on Ctrl-Space but we can offer via hint
      }
    });
    // Add custom hint
    CodeMirror.commands.autocomplete = (cm)=>{
      const hintData = buildHint(cm);
      cm.showHint({ hint: ()=> hintData });
    };
  } else {
    // fallback textarea
    sqlEditor = {
      getValue: ()=> taSql.value,
      setValue: (v)=> taSql.value=v,
      getCursor: ()=> ({line:0,ch:0}),
      getSelection: ()=> taSql.value.substring(taSql.selectionStart, taSql.selectionEnd),
      focus: ()=> taSql.focus(),
      on: ()=>{},
      refresh: ()=>{}
    };
  }

  // App editor
  const taApp = document.getElementById('appEditor');
  if(taApp && window.CodeMirror){
    appEditor = CodeMirror.fromTextArea(taApp, {
      mode: 'javascript',
      theme: document.documentElement.getAttribute('data-theme')==='light' ? 'eclipse' : 'material-darker',
      lineNumbers: true,
      styleActiveLine: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      extraKeys: {
        'Ctrl-Enter': ()=> onAppRun && onAppRun(),
        'Cmd-Enter': ()=> onAppRun && onAppRun(),
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
      }
    });
    appEditor.setSize(null, '100%');
  } else {
    appEditor = {
      getValue: ()=> taApp.value,
      setValue: (v)=> taApp.value=v,
      getSelection: ()=> taApp.value.substring(taApp.selectionStart, taApp.selectionEnd),
      focus: ()=> taApp.focus(),
      on: ()=>{},
      refresh: ()=>{}
    };
  }

  // Wire toolbar buttons (most wired in app.js, but we expose editors)
  return { sqlEditor, appEditor };
}

function buildHint(cm){
  const cur = cm.getCursor();
  const line = cm.getLine(cur.line);
  const start = cur.ch;
  // find word
  let from = start;
  while(from>0 && /[A-Za-z0-9_\.]/.test(line[from-1])) from--;
  const prefix = line.slice(from, start).toLowerCase();
  // keywords
  const keywords = ["SELECT","FROM","WHERE","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE","TABLE","ALTER","DROP","INDEX","VIEW","PRIMARY","KEY","FOREIGN","REFERENCES","UNIQUE","NOT","NULL","DEFAULT","CHECK","AUTO_INCREMENT","ENGINE","CHARSET","JOIN","INNER","LEFT","RIGHT","OUTER","CROSS","ON","AS","AND","OR","IN","BETWEEN","LIKE","EXISTS","GROUP","BY","HAVING","ORDER","LIMIT","OFFSET","UNION","CASE","WHEN","THEN","ELSE","END","DISTINCT","COUNT","SUM","AVG","MIN","MAX","BEGIN","COMMIT","ROLLBACK","SAVEPOINT","SHOW","DATABASES","TABLES","DESCRIBE","EXPLAIN","USE","TRANSACTION","TRUNCATE"];
  const data = introspect();
  const tables = Object.keys(data.details || {});
  const columns = [];
  tables.forEach(t=>{
    (data.details[t].columns||[]).forEach(c=> columns.push(c.name));
  });
  // also include table.col
  const tableCols = [];
  tables.forEach(t=>{
    (data.details[t].columns||[]).forEach(c=> tableCols.push(`${t}.${c.name}`));
  });

  let list=[];
  // if prefix contains dot, suggest columns of that table
  if(prefix.includes('.')){
    const [tbl, colPref] = prefix.split('.');
    const tblInfo = data.details[tbl];
    if(tblInfo){
      const cols = (tblInfo.columns||[]).map(c=>c.name).filter(n=> n.toLowerCase().startsWith(colPref));
      list = cols;
    }
  } else {
    list = [...keywords, ...tables, ...columns, ...tableCols].filter(w=> w.toLowerCase().startsWith(prefix));
    // unique
    list = [...new Set(list)];
  }
  list = list.slice(0,60);
  return { list, from: CodeMirror.Pos(cur.line, from), to: CodeMirror.Pos(cur.line, start) };
}

export function getSqlEditor(){ return sqlEditor; }
export function getAppEditor(){ return appEditor; }

export function getCurrentStatement(){
  if(!sqlEditor || !sqlEditor.getValue) return sqlEditor.getValue();
  const val = sqlEditor.getValue();
  // If CodeMirror, get cursor statement
  if(sqlEditor.getCursor){
    const cursor = sqlEditor.getCursor();
    const stmts = splitStatements(val);
    // Find statement containing cursor line
    // Need to map line to statement: naive: split by ; and find which contains cursor index
    // Compute offset: count lines up to cursor
    let offset=0;
    const lines = val.split('\n');
    for(let i=0;i<cursor.line;i++) offset += lines[i].length+1;
    offset += cursor.ch;
    let pos=0;
    for(const s of stmts){
      const idx = val.indexOf(s, pos);
      if(idx!==-1 && offset>=idx && offset<= idx+s.length){
        return s;
      }
      pos = idx + s.length;
    }
    // fallback: if selection
    const sel = sqlEditor.getSelection ? sqlEditor.getSelection() : '';
    if(sel && sel.trim()) return sel;
    // otherwise current statement near cursor or first
    return stmts[0]||val;
  }
  return val;
}
export function getAllSql(){
  return sqlEditor ? sqlEditor.getValue() : '';
}
export function setSqlValue(v){
  if(sqlEditor && sqlEditor.setValue) sqlEditor.setValue(v);
  if(sqlEditor && sqlEditor.refresh) setTimeout(()=>sqlEditor.refresh(), 50);
}
export function setAppValue(v){
  if(appEditor && appEditor.setValue) appEditor.setValue(v);
  if(appEditor && appEditor.refresh) setTimeout(()=>appEditor.refresh(), 50);
}

// Results rendering
export function renderResults(results, { onExplain } = {}){
  currentResults = results || [];
  const tabsEl = document.getElementById('resultsTabs');
  const contentEl = document.getElementById('resultsContent');
  const metaEl = document.getElementById('resultsMeta');
  if(!tabsEl || !contentEl) return;
  tabsEl.innerHTML='';
  contentEl.innerHTML='';

  if(!results || results.length===0){
    contentEl.innerHTML=`<div class="empty-state"><p>No results</p></div>`;
    if(metaEl) metaEl.textContent='';
    return;
  }

  // Build tabs
  results.forEach((r,i)=>{
    const tab=document.createElement('button');
    tab.className='results-tab'+(i===activeResultIdx?' active':'');
    const icon = r.success ? (r.columns && r.columns.length? '▭':'✓') : '✕';
    const label = r.success ? (r.columns?.length? `SELECT ${r.rowCount}` : (r.status||'OK')) : 'Error';
    const short = (r.original||'').replace(/\s+/g,' ').slice(0,28);
    tab.innerHTML=`<span>${icon}</span> <span>${escapeHtml(short||'Stmt '+(i+1))}</span> <span class="badge">${r.success? r.rowCount ?? 0 : 'ERR'}</span>`;
    tab.title = r.original||'';
    tab.addEventListener('click', ()=>{ activeResultIdx=i; renderResults(results, {onExplain}); });
    tabsEl.appendChild(tab);
  });

  if(activeResultIdx>=results.length) activeResultIdx=0;
  const r = results[activeResultIdx];
  if(metaEl) metaEl.textContent = `${results.length} statement(s) • ${r.duration? r.duration.toFixed(1)+' ms' : ''} • ${r.success?'OK':'ERROR'}`;

  if(!r.success){
    const errDiv=document.createElement('div');
    errDiv.className='error-block';
    const e=r.error;
    errDiv.innerHTML=`
      <div style="font-weight:700;color:var(--danger)">${escapeHtml(e.mysqlStyled)}</div>
      <div style="margin-top:6px;opacity:0.9">SQLite: ${escapeHtml(e.underlying)}</div>
      ${e.hint? `<div class="hint">💡 ${escapeHtml(e.hint)}</div>`:''}
      <div style="margin-top:8px;font-size:11px;opacity:0.7">Statement: <code>${escapeHtml(r.original)}</code></div>
      ${r.wasRewritten? `<div style="margin-top:6px;font-size:11px">Translated: <code>${escapeHtml(r.translated)}</code></div>`:''}
    `;
    contentEl.appendChild(errDiv);
    return;
  }

  if(r.columns && r.columns.length>0){
    // SELECT result
    const wrap=document.createElement('div');
    wrap.className='grid-wrap';
    const table=document.createElement('table');
    table.className='grid';
    const thead=document.createElement('thead');
    const trh=document.createElement('tr');
    r.columns.forEach(col=>{
      const th=document.createElement('th');
      th.textContent=col;
      th.dataset.col=col;
      th.title='Click to sort';
      // type badge placeholder
      // sortable
      th.addEventListener('click', ()=>{
        const asc = th.dataset.sort!=='asc';
        // sort rows
        const sorted=[...r.rows].sort((a,b)=>{
          const va=a[col], vb=b[col];
          if(va===null && vb===null) return 0;
          if(va===null) return 1;
          if(vb===null) return -1;
          if(typeof va==='number' && typeof vb==='number') return asc ? va-vb : vb-va;
          return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
        r.rows = sorted;
        th.dataset.sort=asc?'asc':'desc';
        // re-render body only
        renderBody();
        // update header icons
        thead.querySelectorAll('th').forEach(h=> h.textContent=h.dataset.col);
        th.textContent = col + (asc?' ▲':' ▼');
      });
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody=document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    contentEl.appendChild(wrap);

    // pagination
    const pageSize=100;
    let page=0;
    const totalPages=Math.max(1, Math.ceil(r.rows.length/pageSize));
    const pag=document.createElement('div');
    pag.className='pagination';
    const info=document.createElement('span');
    const controls=document.createElement('div');
    controls.style.display='flex';
    controls.style.gap='6px';
    const btnPrev=document.createElement('button'); btnPrev.className='btn btn-ghost btn-small'; btnPrev.textContent='‹ Prev';
    const btnNext=document.createElement('button'); btnNext.className='btn btn-ghost btn-small'; btnNext.textContent='Next ›';
    controls.append(btnPrev, btnNext);
    pag.append(info, controls);
    contentEl.appendChild(pag);

    function renderBody(){
      tbody.innerHTML='';
      const start=page*pageSize, end=Math.min(start+pageSize, r.rows.length);
      for(let i=start;i<end;i++){
        const row=r.rows[i];
        const tr=document.createElement('tr');
        r.columns.forEach(col=>{
          const td=document.createElement('td');
          const val=row[col];
          if(val===null){
            td.innerHTML='<span class="null-chip">NULL</span>';
          } else {
            const s=String(val);
            td.textContent=s.length>200 ? s.slice(0,200)+'…' : s;
            if(s.length>40) td.title=s;
            td.style.cursor='pointer';
            td.addEventListener('click', ()=>{
              navigator.clipboard.writeText(s).then(()=> showToast('Copied cell', 'success', 1500));
            });
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      info.textContent=`${r.rows.length} rows • page ${page+1}/${totalPages} • ${r.duration? r.duration.toFixed(1)+' ms':''}`;
      btnPrev.disabled=page===0;
      btnNext.disabled=page>=totalPages-1;
    }
    btnPrev.addEventListener('click', ()=>{ if(page>0){page--; renderBody();}});
    btnNext.addEventListener('click', ()=>{ if(page<totalPages-1){page++; renderBody();}});
    renderBody();

    // Explain button handling? Add tip
    if(onExplain){
      const tip=document.createElement('div');
      tip.className='small muted';
      tip.style.padding='6px 12px';
      tip.innerHTML=`<span>💡 Tip:</span> Run <code>EXPLAIN QUERY PLAN</code> to see if an index is used. <button class="btn btn-ghost btn-small" id="btnExplainInline">Explain</button>`;
      contentEl.appendChild(tip);
      tip.querySelector('#btnExplainInline')?.addEventListener('click', ()=> onExplain(r));
    }

  } else {
    // Write/DDL status
    const status=document.createElement('div');
    status.className='status-line';
    status.innerHTML=`
      <div><strong>${escapeHtml(r.status||'Query OK')}</strong> <span class="muted">(${r.duration? r.duration.toFixed(1)+' ms':''})</span></div>
      <div class="small muted" style="margin-top:4px">Records: ${r.affectedRows??0} • Duplicates: 0 • Warnings: 0${r.insertId? ` • lastInsertId: ${r.insertId}`:''}</div>
      <div class="small muted">Statement: <code>${escapeHtml(r.original)}</code></div>
      ${r.wasRewritten? `<div class="small muted">Translated: <code>${escapeHtml(r.translated)}</code></div>`:''}
    `;
    contentEl.appendChild(status);
  }

  // Update export buttons to use current
}

export function getCurrentResults(){ return currentResults; }
export function getActiveResult(){ return currentResults[activeResultIdx]; }

export function initTabs(){
  const tabs=document.querySelectorAll('.tab');
  const panels=document.querySelectorAll('.tab-panel');
  tabs.forEach(tab=>{
    tab.addEventListener('click', ()=>{
      const target=tab.dataset.tab;
      tabs.forEach(t=>{ t.classList.toggle('active', t===tab); t.setAttribute('aria-selected', t===tab?'true':'false'); });
      panels.forEach(p=> p.classList.toggle('active', p.id===`panel-${target}`));
      // refresh editors when switching to sql/app
      if(target==='sql' && sqlEditor && sqlEditor.refresh) setTimeout(()=>sqlEditor.refresh(), 50);
      if(target==='app' && appEditor && appEditor.refresh) setTimeout(()=>appEditor.refresh(), 50);
      // schema resize
      if(target==='schema'){
        // trigger schema render?
        window.dispatchEvent(new Event('schema:refresh'));
      }
    });
    tab.addEventListener('keydown', (e)=>{
      if(e.key==='ArrowRight' || e.key==='ArrowLeft'){
        e.preventDefault();
        const idx=Array.from(tabs).indexOf(tab);
        const next = e.key==='ArrowRight' ? tabs[(idx+1)%tabs.length] : tabs[(idx-1+tabs.length)%tabs.length];
        next.focus(); next.click();
      }
    });
  });
}

export function initSnippetTabs(snippets){
  const tabs=document.querySelectorAll('.snippet-tab');
  const codeEl=document.getElementById('snippetCode');
  function render(lang){
    if(!codeEl) return;
    const snippet=snippets[lang];
    if(snippet) codeEl.textContent=snippet;
  }
  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.toggle('active', x===t));
      render(t.dataset.lang);
    });
  });
  render('node');
}

// Console helpers for app code
export function appendConsole(line, level='log'){
  const con=document.getElementById('appConsole');
  if(!con) return;
  const div=document.createElement('div');
  div.className=`console-line ${level}`;
  const time=new Date().toLocaleTimeString();
  const timeSpan=document.createElement('span');
  timeSpan.className='console-time';
  timeSpan.textContent=`[${time}]`;
  const text=document.createElement('span');
  if(typeof line === 'object'){
    try{
      if(level==='table' && Array.isArray(line)){
        // render as mini table
        const tbl=document.createElement('table');
        tbl.className='mini-table';
        if(line.length>0){
          const cols=Object.keys(line[0]);
          const thead=document.createElement('thead');
          const trh=document.createElement('tr');
          cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; trh.appendChild(th); });
          thead.appendChild(trh); tbl.appendChild(thead);
          const tbody=document.createElement('tbody');
          line.slice(0,20).forEach(row=>{
            const tr=document.createElement('tr');
            cols.forEach(c=>{ const td=document.createElement('td'); td.textContent= String(row[c] ?? ''); tr.appendChild(td); });
            tbody.appendChild(tr);
          });
          tbl.appendChild(tbody);
        }
        text.appendChild(tbl);
      } else {
        text.textContent = typeof line === 'string' ? line : JSON.stringify(line, null, 2);
      }
    }catch(e){ text.textContent=String(line); }
  } else {
    text.textContent=String(line);
  }
  div.append(timeSpan, text);
  con.appendChild(div);
  con.scrollTop=con.scrollHeight;
}
export function clearConsole(){
  const con=document.getElementById('appConsole');
  if(con) con.innerHTML='';
}

// Tree rendering
export function renderTree(details, onAction){
  const treeEl=document.getElementById('dbTree');
  if(!treeEl) return;
  treeEl.innerHTML='';
  const allTables = Object.keys(details).filter(k=>!details[k].isView);
  const views = Object.keys(details).filter(k=>details[k].isView);
  const indexesCount = Object.values(details).reduce((a,d)=>a+(d.indexes?.length||0),0);

  function makeGroup(title, items, type){
    const group=document.createElement('div');
    group.className='tree-group-wrap';
    const header=document.createElement('div');
    header.className='tree-node';
    header.innerHTML=`<span class="icon">${type==='table'?'▭': type==='view'?'👁':'▤'}</span> <strong>${title}</strong> <span class="muted small">(${items.length})</span>`;
    // no collapse for now
    group.appendChild(header);
    const inner=document.createElement('div');
    inner.className='tree-group';
    items.forEach(name=>{
      const info=details[name];
      const node=document.createElement('div');
      node.className='tree-node';
      node.dataset.table=name;
      const rowCount=info.rowCount ?? 0;
      node.innerHTML=`
        <span class="icon">${type==='table'?'▭':'◈'}</span>
        <span style="flex:1">${escapeHtml(name)}</span>
        <span class="muted small">${rowCount}</span>
        <button class="btn btn-icon" data-action="menu" title="Actions" style="font-size:10px">⋮</button>
      `;
      node.addEventListener('click', (e)=>{
        if(e.target.dataset.action==='menu') return;
        onAction && onAction('select', name);
        treeEl.querySelectorAll('.tree-node').forEach(n=>n.classList.remove('active'));
        node.classList.add('active');
      });
      const menuBtn=node.querySelector('[data-action="menu"]');
      menuBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        // simple prompt menu
        const choice = prompt(`Actions for ${name}:\n1 - Browse Data\n2 - Structure (DESCRIBE)\n3 - SHOW CREATE TABLE\n4 - Generate SELECT\n5 - Generate INSERT\n6 - Truncate\n7 - Drop\nEnter number:`,'1');
        const map={ '1':'browse','2':'structure','3':'showcreate','4':'select','5':'insert','6':'truncate','7':'drop' };
        const action=map[choice];
        if(action) onAction && onAction(action, name);
      });
      // expand columns as subgroup on double click? For now show columns as nested
      const colGroup=document.createElement('div');
      colGroup.className='tree-group';
      colGroup.style.display='none';
      (info.columns||[]).forEach(col=>{
        const cNode=document.createElement('div');
        cNode.className='tree-node small';
        const isPk=!!col.pk;
        const isFk=(info.fks||[]).some(fk=>fk.from===col.name);
        cNode.innerHTML=`<span class="icon">${isPk?'🔑': isFk?'↗':'—'}</span> ${escapeHtml(col.name)} <span class="muted small">${escapeHtml(col.type||'')}</span>`;
        colGroup.appendChild(cNode);
      });
      node.addEventListener('dblclick', ()=>{
        colGroup.style.display=colGroup.style.display==='none' ? 'block' : 'none';
      });
      inner.appendChild(node);
      inner.appendChild(colGroup);
    });
    group.appendChild(inner);
    return group;
  }

  treeEl.appendChild(makeGroup('Tables', allTables.sort(), 'table'));
  if(views.length) treeEl.appendChild(makeGroup('Views', views.sort(), 'view'));
  // Indexes summary
  const idxNode=document.createElement('div');
  idxNode.className='tree-node';
  idxNode.innerHTML=`<span class="icon">▤</span> Indexes <span class="muted small">(${indexesCount})</span>`;
  treeEl.appendChild(idxNode);

  // Database node at top?
  const dbHeader=document.createElement('div');
  dbHeader.className='tree-node';
  dbHeader.style.fontWeight='700';
  dbHeader.style.background='var(--panel-2)';
  dbHeader.style.marginBottom='6px';
  // Will be prepended after groups? Let's prepend
  // Actually insert before first group
  // We'll create overall container with DB header
}

export function renderHistory(history, onClick){
  const el=document.getElementById('queryHistory');
  if(!el) return;
  el.innerHTML='';
  if(!history.length){
    el.innerHTML='<div class="muted small" style="padding:8px;text-align:center">No history yet</div>';
    return;
  }
  history.slice().reverse().forEach((h,i)=>{
    const div=document.createElement('div');
    div.className='history-item';
    div.innerHTML=`
      <div class="h-sql" title="${escapeHtml(h.sql)}">${escapeHtml(h.sql.slice(0,80))}${h.sql.length>80?'…':''}</div>
      <div class="h-meta"><span>${new Date(h.time).toLocaleTimeString()}</span><span>${h.success?'OK':'ERR'} • ${h.duration?h.duration.toFixed(0)+'ms':''} • ${h.rows??''}</span></div>
    `;
    div.addEventListener('click', ()=> onClick && onClick(h));
    el.appendChild(div);
  });
}

// Data browser
export function renderDataGrid(table, columns, rows, { onEdit, onSelectRow } = {}){
  const wrap=document.getElementById('dataGridWrap');
  if(!wrap) return;
  wrap.innerHTML='';
  if(!table){
    wrap.innerHTML='<div class="empty-state"><p>Select a table to browse data. Double-click a cell to edit.</p></div>';
    return;
  }
  if(!columns || columns.length===0){
    wrap.innerHTML=`<div class="empty-state"><p>Table ${escapeHtml(table)} has no columns or is empty.</p></div>`;
    return;
  }
  const tableEl=document.createElement('table');
  tableEl.className='grid';
  const thead=document.createElement('thead');
  const trh=document.createElement('tr');
  // Add selection checkbox column?
  const thSel=document.createElement('th');
  thSel.textContent='☐';
  thSel.style.width='36px';
  trh.appendChild(thSel);
  columns.forEach(col=>{
    const th=document.createElement('th');
    th.textContent=col;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  tableEl.appendChild(thead);
  const tbody=document.createElement('tbody');
  tableEl.appendChild(tbody);
  const gridWrap=document.createElement('div');
  gridWrap.className='grid-wrap';
  gridWrap.appendChild(tableEl);
  wrap.appendChild(gridWrap);

  let selectedRowIdx=-1;
  rows.forEach((row, idx)=>{
    const tr=document.createElement('tr');
    tr.dataset.idx=idx;
    const tdSel=document.createElement('td');
    tdSel.textContent='○';
    tdSel.style.textAlign='center';
    tdSel.style.cursor='pointer';
    tdSel.addEventListener('click', ()=>{
      tbody.querySelectorAll('tr').forEach(r=>r.style.background='');
      tr.style.background='var(--accent-bg)';
      selectedRowIdx=idx;
      if(onSelectRow) onSelectRow(idx, row);
      tdSel.textContent='●';
      setTimeout(()=>{ if(selectedRowIdx===idx) tdSel.textContent='●'; },0);
    });
    tr.appendChild(tdSel);
    columns.forEach(col=>{
      const td=document.createElement('td');
      const val=row[col];
      if(val===null) td.innerHTML='<span class="null-chip">NULL</span>';
      else td.textContent=String(val);
      td.dataset.col=col;
      td.dataset.row=idx;
      // editable
      td.addEventListener('dblclick', ()=>{
        const orig=val;
        const input=document.createElement('input');
        input.className='input input-small';
        input.value= val===null ? '' : String(val);
        input.style.width='100%';
        td.innerHTML='';
        td.appendChild(input);
        input.focus(); input.select();
        let done=false;
        function commit(){
          if(done) return; done=true;
          const newVal=input.value;
          // Determine type? Keep as string; user can type NULL to null
          const parsed = newVal.toUpperCase()==='NULL' ? null : newVal;
          // Call onEdit
          if(onEdit){
            onEdit(idx, col, parsed, orig, row);
          }
          td.textContent = parsed===null ? '' : String(parsed);
          if(parsed===null) td.innerHTML='<span class="null-chip">NULL</span>';
        }
        function cancel(){
          if(done) return; done=true;
          td.textContent = orig===null? '' : String(orig);
          if(orig===null) td.innerHTML='<span class="null-chip">NULL</span>';
        }
        input.addEventListener('keydown', (e)=>{
          if(e.key==='Enter'){ commit(); }
          else if(e.key==='Escape'){ cancel(); }
        });
        input.addEventListener('blur', commit);
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // expose selected
  wrap._getSelected = ()=> selectedRowIdx;
}

// Helpers
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function formatSQL(sql){
  // very simple formatter: uppercase keywords, break lines
  const keywords = ["SELECT","FROM","WHERE","GROUP BY","HAVING","ORDER BY","LIMIT","JOIN","INNER JOIN","LEFT JOIN","RIGHT JOIN","ON","AND","OR","INSERT INTO","VALUES","UPDATE","SET","DELETE FROM","CREATE TABLE","ALTER TABLE","DROP TABLE","BEGIN","COMMIT","ROLLBACK"];
  let out=sql;
  // uppercase keywords
  out = out.replace(/\b(select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|join|inner|left|right|outer|cross|on|and|or|group by|having|order by|limit|offset|union|case|when|then|else|end|distinct|count|sum|avg|min|max|begin|commit|rollback|show|describe|explain|use)\b/gi, (m)=> m.toUpperCase());
  // add newlines before major clauses
  out = out.replace(/\s*(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|JOIN|LEFT JOIN|INNER JOIN|RIGHT JOIN|ON|VALUES|SET)\s+/gi, '\n$1 ');
  out = out.replace(/;\s*/g, ';\n');
  out = out.replace(/\n\s*\n/g, '\n');
  return out.trim();
}
