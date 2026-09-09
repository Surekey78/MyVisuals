// js/schema.js — introspection + diagram rendering

import { introspect, getCurrentDatabase } from './engine.js';

const STORAGE_LAYOUT = 'mysql-playground-layout-v1';

let state = {
  zoom: 1,
  pan: {x:0, y:0},
  selected: null,
  layout: {}, // table -> {x,y}
  showLabels: true,
  showGrid: true,
  isDragging: false,
  dragTarget: null,
  dragOffset: {x:0, y:0}
};

let els = {};
let introspectionCache = null;

export function initSchema(dom){
  els = dom; // { canvas, svg, cards, searchInput, meta, inspector, inspectorTitle, inspectorContent, etc }

  // Load saved layout
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_LAYOUT)||'{}');
    if(saved.layout) state.layout = saved.layout;
    if(saved.zoom) state.zoom = saved.zoom;
  }catch(e){}

  // Pan handling: drag background
  let isPanning=false, startX=0, startY=0, startPan={x:0,y:0};

  els.canvas.addEventListener('mousedown', (e)=>{
    if(e.target === els.canvas || e.target === els.svg || e.target.classList.contains('schema-cards')){
      isPanning=true;
      startX=e.clientX; startY=e.clientY;
      startPan={...state.pan};
      els.canvas.style.cursor='grabbing';
    }
  });
  window.addEventListener('mousemove', (e)=>{
    if(isPanning){
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      state.pan.x = startPan.x + dx;
      state.pan.y = startPan.y + dy;
      applyTransform();
    }
    if(state.isDragging && state.dragTarget){
      const rect = els.canvas.getBoundingClientRect();
      // account for zoom/pan? For simplicity we store positions relative to cards container unscaled
      const x = (e.clientX - rect.left - state.pan.x)/state.zoom - state.dragOffset.x;
      const y = (e.clientY - rect.top - state.pan.y)/state.zoom - state.dragOffset.y;
      state.layout[state.dragTarget] = { x: Math.max(0,x), y: Math.max(0,y) };
      const card = els.cards.querySelector(`[data-table="${CSS.escape(state.dragTarget)}"]`);
      if(card){
        card.style.left = state.layout[state.dragTarget].x + 'px';
        card.style.top = state.layout[state.dragTarget].y + 'px';
      }
      drawLines();
    }
  });
  window.addEventListener('mouseup', ()=>{
    if(isPanning) { isPanning=false; els.canvas.style.cursor=''; }
    if(state.isDragging){
      state.isDragging=false;
      state.dragTarget=null;
      saveLayout();
    }
  });

  // Zoom via wheel with ctrl?
  els.canvas.addEventListener('wheel', (e)=>{
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      const delta = e.deltaY >0 ? 0.9 : 1.1;
      state.zoom = Math.min(2.5, Math.max(0.4, state.zoom * delta));
      applyTransform();
      saveLayout();
    }
  }, { passive:false });

  // Controls
  if(els.btnZoomIn) els.btnZoomIn.addEventListener('click', ()=>{ state.zoom=Math.min(2.5, state.zoom+0.1); applyTransform(); saveLayout(); });
  if(els.btnZoomOut) els.btnZoomOut.addEventListener('click', ()=>{ state.zoom=Math.max(0.4, state.zoom-0.1); applyTransform(); saveLayout(); });
  if(els.btnResetZoom) els.btnResetZoom.addEventListener('click', ()=>{ state.zoom=1; state.pan={x:0,y:0}; applyTransform(); saveLayout(); });
  if(els.btnFit) els.btnFit.addEventListener('click', fitToScreen);
  if(els.btnAutoLayout) els.btnAutoLayout.addEventListener('click', ()=>{ autoLayout(true); });
  if(els.toggleGrid) els.toggleGrid.addEventListener('change', (e)=>{
    state.showGrid = e.target.checked;
    els.canvas.classList.toggle('grid-hidden', !state.showGrid);
  });
  if(els.toggleLabels) els.toggleLabels.addEventListener('change', (e)=>{
    state.showLabels = e.target.checked;
    drawLines();
  });
  if(els.searchInput){
    els.searchInput.addEventListener('input', ()=>{
      const q=els.searchInput.value.toLowerCase().trim();
      filterHighlight(q);
    });
  }
  if(els.btnCloseInspector) els.btnCloseInspector.addEventListener('click', ()=>{ hideInspector(); });

  // initial transform
  applyTransform();
}

function applyTransform(){
  if(!els.cards || !els.svg) return;
  els.cards.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  els.cards.style.transformOrigin = '0 0';
  els.svg.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  els.svg.style.transformOrigin = '0 0';
}

function saveLayout(){
  try{
    localStorage.setItem(STORAGE_LAYOUT, JSON.stringify({ layout: state.layout, zoom: state.zoom, pan: state.pan }));
  }catch(e){}
}

function fitToScreen(){
  // reset pan/zoom to fit
  state.pan={x:0,y:0};
  state.zoom=1;
  applyTransform();
  // after layout, could try to center
  // simple: if many tables, scale down
  const count = Object.keys(state.layout).length || (introspectionCache?.tables.length||1);
  if(count>6) state.zoom=0.85;
  if(count>10) state.zoom=0.7;
  applyTransform();
  saveLayout();
}

function autoLayout(animate=false){
  const tables = introspectionCache?.tables || [];
  const cols = Math.ceil(Math.sqrt(tables.length)) || 1;
  const cardW=240, cardH=220, gapX=40, gapY=40;
  tables.forEach((t,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    const x=20 + col*(cardW+gapX);
    const y=20 + row*(cardH+gapY);
    state.layout[t.name]={x,y};
  });
  renderCards();
  saveLayout();
}

export function renderSchema(force=false){
  const data = introspect();
  introspectionCache = data;
  const { tables, indexes, details } = data;
  if(els.meta){
    els.meta.textContent = `${tables.length} tables, ${Object.keys(details).filter(k=>!details[k].isView).length} detail, ${indexes.length} indexes • DB: ${getCurrentDatabase()}`;
  }
  if(tables.length===0){
    if(els.empty) els.empty.style.display='flex';
    if(els.cards) els.cards.innerHTML='';
    if(els.svg) els.svg.innerHTML='';
    return;
  }
  if(els.empty) els.empty.style.display='none';

  // Ensure layout entries for new tables
  tables.forEach(t=>{
    if(!state.layout[t.name]){
      // place in next free spot
      const count = Object.keys(state.layout).length;
      const cols=3;
      const cardW=240,gapX=40,gapY=40, cardH=220;
      const col=count%cols, row=Math.floor(count/cols);
      state.layout[t.name]={x:20+col*(cardW+gapX), y:20+row*(cardH+gapY)};
    }
  });
  // Remove layout for deleted tables
  for(const k of Object.keys(state.layout)){
    if(!tables.some(t=>t.name===k) && !data.views.some(v=>v.name===k)){
      delete state.layout[k];
    }
  }

  renderCards();
}

function renderCards(){
  if(!els.cards) return;
  const data = introspectionCache;
  if(!data) return;
  const { tables, views, details } = data;
  const all = [...tables, ...views];
  // Clear?
  els.cards.innerHTML='';
  for(const t of all){
    const info = details[t.name] || {};
    const isView = !!info.isView;
    const card = document.createElement('div');
    card.className='schema-card';
    if(state.selected===t.name) card.classList.add('selected');
    card.dataset.table=t.name;
    const pos = state.layout[t.name] || {x:20,y:20};
    card.style.left=pos.x+'px';
    card.style.top=pos.y+'px';
    card.setAttribute('tabindex','0');
    card.setAttribute('role','button');
    card.setAttribute('aria-label', `Table ${t.name}, ${info.rowCount||0} rows`);

    // Handle drag start
    const header = document.createElement('div');
    header.className='schema-card-header';
    header.innerHTML=`<h4>${isView? '👁':'▭'} ${escapeHtml(t.name)} ${isView?'<span style="font-weight:400;font-size:11px;color:var(--text-3)">VIEW</span>':''}</h4><span class="rowcount">${info.rowCount ?? 0} rows</span>`;
    header.style.cursor='grab';
    // Drag events
    header.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      state.isDragging=true;
      state.dragTarget=t.name;
      const cardRect = card.getBoundingClientRect();
      const canvasRect = els.canvas.getBoundingClientRect();
      // offset within card
      state.dragOffset.x = (e.clientX - cardRect.left)/state.zoom;
      state.dragOffset.y = (e.clientY - cardRect.top)/state.zoom;
      card.style.zIndex=10;
    });
    header.addEventListener('mouseup', ()=>{
      card.style.zIndex='';
    });

    card.appendChild(header);

    const colsWrap = document.createElement('div');
    colsWrap.className='schema-columns';
    const cols = info.columns || [];
    if(cols.length===0){
      const empty = document.createElement('div');
      empty.className='schema-col';
      empty.innerHTML='<span class="col-name" style="color:var(--text-3)">No columns or view</span>';
      colsWrap.appendChild(empty);
    } else {
      for(const c of cols){
        const row = document.createElement('div');
        row.className='schema-col';
        // determine pk/fk
        const isPk = !!c.pk;
        const isFk = (info.fks||[]).some(fk=>fk.from===c.name);
        const isUnique = (info.indexes||[]).some(ix=>ix.unique && ix.columns?.includes(c.name));
        const isIndexed = (info.indexes||[]).some(ix=>ix.columns?.includes(c.name));
        if(isPk) row.classList.add('pk');
        else if(isFk) row.classList.add('fk');
        row.innerHTML=`
          <span class="col-name">${escapeHtml(c.name)}</span>
          <span class="col-type">${escapeHtml(c.type||'TEXT')}</span>
          <span class="icons">
            ${isPk?'<span title="PK">🔑</span>':''}
            ${isFk?'<span title="FK">↗</span>':''}
            ${isUnique?'<span title="Unique">◆</span>':''}
            ${c.notnull?'<span title="NOT NULL">●</span>':''}
            ${isIndexed && !isUnique?'<span title="Indexed">▤</span>':''}
          </span>
        `;
        // search highlight?
        row.dataset.col=c.name.toLowerCase();
        colsWrap.appendChild(row);
      }
    }
    card.appendChild(colsWrap);

    // Click to inspect + highlight
    card.addEventListener('click', (e)=>{
      if(state.isDragging) return;
      selectTable(t.name);
    });
    card.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){
        e.preventDefault(); selectTable(t.name);
      }
    });

    els.cards.appendChild(card);
  }
  // After cards rendered, draw lines
  requestAnimationFrame(drawLines);
}

function selectTable(name){
  state.selected = name;
  // Update card selection UI
  els.cards.querySelectorAll('.schema-card').forEach(c=>{
    c.classList.toggle('selected', c.dataset.table===name);
  });
  highlightRelated(name);
  showInspector(name);
  drawLines();
}

function highlightRelated(name){
  const info = introspectionCache.details[name];
  if(!info) return;
  const related = new Set();
  related.add(name);
  // FK outgoing
  (info.fks||[]).forEach(fk=> related.add(fk.table));
  // FK incoming: find tables that reference this
  for(const [t, det] of Object.entries(introspectionCache.details)){
    if((det.fks||[]).some(fk=>fk.table===name)) related.add(t);
  }
  // apply dim? For now highlight cards
  els.cards.querySelectorAll('.schema-card').forEach(c=>{
    const isRel = related.has(c.dataset.table);
    c.style.opacity = isRel ? '1' : '0.55';
  });
  // if no selection, reset opacity
  if(!name){
    els.cards.querySelectorAll('.schema-card').forEach(c=> c.style.opacity='1');
  }
}

function showInspector(name){
  if(!els.inspector) return;
  const info = introspectionCache.details[name];
  if(!info){ hideInspector(); return; }
  els.inspector.classList.remove('hidden');
  if(els.inspectorTitle) els.inspectorTitle.textContent = name + (info.isView ? ' (VIEW)' : '');
  const content = [];
  content.push(`<div class="small muted">Rows: ${info.rowCount} • ${info.columns?.length||0} cols</div>`);
  content.push(`<h5 style="margin:8px 0 4px">Columns</h5>`);
  content.push(`<table class="mini-table"><thead><tr><th>Name</th><th>Type</th><th>Null</th><th>Key</th></tr></thead><tbody>`);
  for(const c of (info.columns||[])){
    const key = c.pk ? 'PRI' : ((info.fks||[]).some(f=>f.from===c.name)?'FK':'');
    content.push(`<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.type)}</td><td>${c.notnull?'NO':'YES'}</td><td>${key}</td></tr>`);
  }
  content.push(`</tbody></table>`);
  if((info.fks||[]).length){
    content.push(`<h5 style="margin:8px 0 4px">Foreign Keys</h5><ul class="small">`);
    for(const fk of info.fks){
      content.push(`<li>${escapeHtml(fk.from)} → ${escapeHtml(fk.table)}.${escapeHtml(fk.to)} <span class="muted">ON DELETE ${fk.on_delete} ON UPDATE ${fk.on_update}</span></li>`);
    }
    content.push(`</ul>`);
  }
  if((info.indexes||[]).length){
    content.push(`<h5 style="margin:8px 0 4px">Indexes</h5><ul class="small">`);
    for(const ix of info.indexes){
      content.push(`<li>${escapeHtml(ix.name)} ${ix.unique?'(UNIQUE)':''} → ${ (ix.columns||[]).map(escapeHtml).join(', ')}</li>`);
    }
    content.push(`</ul>`);
  }
  content.push(`<h5 style="margin:8px 0 4px">SHOW CREATE TABLE</h5><pre class="code-block small">${escapeHtml(info.sql||'')}</pre>`);
  if(els.inspectorContent) els.inspectorContent.innerHTML = content.join('');
  // wire actions
  if(els.btnInspectorSelect) els.btnInspectorSelect.onclick = ()=>{
    const ev = new CustomEvent('schema:select', { detail:{sql:`SELECT * FROM "${name}" LIMIT 100;`} });
    window.dispatchEvent(ev);
  };
  if(els.btnInspectorInsert) els.btnInspectorInsert.onclick = ()=>{
    // generate INSERT with sample
    const cols = (info.columns||[]).filter(c=>!c.pk || c.type.toUpperCase().includes('INTEGER')===false); // crude
    // Provide sample values based on type
    const sampleCols = (info.columns||[]).slice(0,3).map(c=>c.name);
    const sampleVals = sampleCols.map((_,i)=> `'sample${i+1}'`).join(', ');
    const sql = `INSERT INTO "${name}" (${sampleCols.map(c=>`"${c}"`).join(', ')}) VALUES (${sampleVals});`;
    const ev = new CustomEvent('schema:select', {detail:{sql}});
    window.dispatchEvent(ev);
  };
  if(els.btnInspectorDrop) els.btnInspectorDrop.onclick = ()=>{
    const ev = new CustomEvent('schema:drop', {detail:{table:name}});
    window.dispatchEvent(ev);
  };
}
function hideInspector(){
  if(els.inspector) els.inspector.classList.add('hidden');
  state.selected=null;
  if(els.cards){
    els.cards.querySelectorAll('.schema-card').forEach(c=>{ c.classList.remove('selected'); c.style.opacity='1'; });
  }
  drawLines();
}

function drawLines(){
  if(!els.svg || !introspectionCache) return;
  const svg = els.svg;
  // Clear
  svg.innerHTML='';
  // Need dimensions: cards container size may be larger than visible
  // Use layout positions to compute lines between cards
  const details = introspectionCache.details;
  // Build map table -> rect center
  const rects = {};
  els.cards.querySelectorAll('.schema-card').forEach(card=>{
    const name=card.dataset.table;
    const x=parseFloat(card.style.left)||0;
    const y=parseFloat(card.style.top)||0;
    const w=card.offsetWidth;
    const h=card.offsetHeight;
    rects[name]={x,y,w,h, cx:x+w/2, cy:y+h/2, left:x, right:x+w, top:y, bottom:y+h};
  });

  svg.setAttribute('width', '2000');
  svg.setAttribute('height', '1400');
  svg.style.width='2000px';
  svg.style.height='1400px';

  const lines=[];
  for(const [t, info] of Object.entries(details)){
    for(const fk of (info.fks||[])){
      const from = t;
      const to = fk.table;
      if(!rects[from] || !rects[to]) continue;
      lines.push({from, to, fromCol: fk.from, toCol: fk.to});
    }
  }

  for(const line of lines){
    const a=rects[line.from], b=rects[line.to];
    // Determine best connection side: closest edges
    // Compute vector
    // Simple: from center to target center, intersect with card borders
    // For now use bezier between centers offset to edges
    let x1, y1, x2, y2;
    // Choose which side is closer: if a.left > b.right etc.
    // Horizontal?
    if(Math.abs(a.cx - b.cx) > Math.abs(a.cy - b.cy)){
      // horizontal connection
      if(a.cx < b.cx){
        x1=a.right; y1=a.cy;
        x2=b.left; y2=b.cy;
      } else {
        x1=a.left; y1=a.cy;
        x2=b.right; y2=b.cy;
      }
    } else {
      if(a.cy < b.cy){
        x1=a.cx; y1=a.bottom;
        x2=b.cx; y2=b.top;
      } else {
        x1=a.cx; y1=a.top;
        x2=b.cx; y2=b.bottom;
      }
    }
    const isSelected = state.selected && (state.selected===line.from || state.selected===line.to);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    const dx = Math.abs(x2-x1)*0.5;
    const d = `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', isSelected? 'var(--accent)' : '#3b82f6');
    path.setAttribute('stroke-width', isSelected? '2.5' : '1.6');
    path.setAttribute('stroke-dasharray', '');
    path.setAttribute('opacity', isSelected? '1' : (state.selected? '0.25':'0.75'));
    path.setAttribute('marker-end','url(#arrow)');
    svg.appendChild(path);

    // Label at midpoint
    if(state.showLabels){
      const mx=(x1+x2)/2, my=(y1+y2)/2;
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
      const text=document.createElementNS('http://www.w3.org/2000/svg','text');
      const label='1 : N';
      text.textContent=label;
      text.setAttribute('x', mx);
      text.setAttribute('y', my);
      text.setAttribute('text-anchor','middle');
      text.setAttribute('dominant-baseline','middle');
      text.setAttribute('font-size','10');
      text.setAttribute('fill','var(--text-2)');
      text.setAttribute('font-family','var(--mono)');
      // need bbox? approximate
      const w=34, h=14;
      rect.setAttribute('x', mx-w/2);
      rect.setAttribute('y', my-h/2);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('rx', '7');
      rect.setAttribute('fill', 'var(--panel)');
      rect.setAttribute('stroke', 'var(--border)');
      rect.setAttribute('opacity', isSelected? '1' : (state.selected? '0.4':'0.9'));
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    }
  }
  // defs for arrow
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)"></path></marker>`;
  svg.insertBefore(defs, svg.firstChild);

  // Also draw selection highlight thicker
}

function filterHighlight(q){
  if(!els.cards) return;
  const cards=els.cards.querySelectorAll('.schema-card');
  if(!q){
    cards.forEach(c=>{ c.style.outline=''; c.style.opacity='1';
      c.querySelectorAll('.schema-col').forEach(row=>{ row.style.background=''; row.style.fontWeight=''; });
    });
    return;
  }
  cards.forEach(card=>{
    const table=card.dataset.table.toLowerCase();
    let matched = table.includes(q);
    let colMatched=false;
    card.querySelectorAll('.schema-col').forEach(row=>{
      const col=row.dataset.col||'';
      const hit = col.includes(q);
      if(hit){ row.style.background='rgba(59,130,246,0.15)'; row.style.fontWeight='600'; colMatched=true; }
      else { row.style.background=''; row.style.fontWeight=''; }
    });
    matched = matched || colMatched;
    card.style.outline = matched ? '2px solid var(--accent)' : '';
    card.style.opacity = matched ? '1' : '0.35';
  });
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function getLayout(){ return state.layout; }
export function setLayout(layout){ state.layout=layout; saveLayout(); renderCards(); }

