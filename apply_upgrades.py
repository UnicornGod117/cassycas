import sys

def replace_or_fail(content, old, new):
    if old not in content:
        print(f"Error: Could not find snippet starting with:\n{old[:50]}...")
        sys.exit(1)
    return content.replace(old, new, 1)

with open("CAS (new).html", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Algebrite Script
old1 = '<script src="https://cdn.jsdelivr.net/npm/mathlive@0.98.6/dist/mathlive.min.js" crossorigin="anonymous"></script>'
new1 = '<script src="https://cdn.jsdelivr.net/npm/mathlive@0.98.6/dist/mathlive.min.js" crossorigin="anonymous"></script>\n<script src="https://unpkg.com/algebrite@1.4.0/dist/algebrite.bundle-for-browser.js"></script>'
content = replace_or_fail(content, old1, new1)

# 2. LaTeX Export Button
old2 = '''  <button class="icon-btn" title="Export as text" onclick="exportTxt()">
    <svg viewBox="0 0 24 24"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>
  </button>'''
new2 = '''  <button class="icon-btn" title="Export as text" onclick="exportTxt()">
    <svg viewBox="0 0 24 24"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>
  </button>
  <button class="icon-btn" title="Export as LaTeX" onclick="exportLatex()">
    <svg viewBox="0 0 24 24"><text x="12" y="17" font-family="serif" font-size="16" font-weight="bold" text-anchor="middle" fill="currentColor">T</text></svg>
  </button>'''
content = replace_or_fail(content, old2, new2)

# 3. State + Worker Init
old3 = '''const scope = { pi:Math.PI, e:Math.E, phi:(1+Math.sqrt(5))/2, tau:2*Math.PI };
const userFns = {};
let notebookHistory = [];
let curMode = 'algebra';
let inpMode = 'monaco';
let iHist = [], iIdx = -1;
let cellN = 0;
let mon = null, monReady = false;
let acIdx = -1;
let prevTimer = null;
let darkTheme = true;
let exactMode = true;
let angleMode = 'rad';

try {'''
new3 = '''const scope = { pi:Math.PI, e:Math.E, phi:(1+Math.sqrt(5))/2, tau:2*Math.PI };
const userFns = {};
let notebookHistory = [];
let curMode = 'algebra';
let inpMode = 'monaco';
let iHist = [], iIdx = -1;
let cellN = 0;
let mon = null, monReady = false;
let acIdx = -1;
let prevTimer = null;
let darkTheme = true;
let exactMode = true;
let angleMode = 'rad';

// 1. Web Worker Evaluation Kernel & 2. Exact Rational Arithmetic
let evalWorker = null;
let evalMsgMap = new Map();
let evalMsgId = 0;
function initEvalWorker() {
  const code = `
    importScripts("https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.min.js");
    self.math.config({ number: 'Fraction' });
    self.onmessage = (e) => {
      const {id, expr, scopePayload, isExact, userFnsPayload} = e.data;
      self.math.config({ number: isExact ? 'Fraction' : 'number' });
      try {
        const localScope = Object.assign({}, scopePayload);
        if (userFnsPayload) {
          for (let name in userFnsPayload) {
            const {params, body} = userFnsPayload[name];
            const compiled = self.math.compile(body);
            localScope[name] = (...args) => {
              const loc = Object.assign({}, localScope);
              params.forEach((p,i) => loc[p] = args[i]);
              return compiled.evaluate(loc);
            };
          }
        }
        const res = self.math.evaluate(expr, localScope);
        self.postMessage({id, res: res && res.toString ? res.toString() : String(res)});
      } catch(err) {
        self.postMessage({id, error: err.message});
      }
    };
  `;
  const blob = new Blob([code], {type: 'application/javascript'});
  evalWorker = new Worker(URL.createObjectURL(blob));
  evalWorker.onmessage = (e) => {
    if (evalMsgMap.has(e.data.id)) {
      evalMsgMap.get(e.data.id)(e.data);
      evalMsgMap.delete(e.data.id);
    }
  };
}
initEvalWorker();

math.config({ number: 'Fraction' });

async function runInWorker(expr, localScope) {
  return new Promise(resolve => {
    const id = ++evalMsgId;
    evalMsgMap.set(id, resolve);
    const scopePayload = {};
    for (let k in localScope) { if (typeof localScope[k] !== 'function') scopePayload[k] = localScope[k]; }
    const userFnsPayload = {};
    for (let k in userFns) userFnsPayload[k] = {params: userFns[k].params, body: userFns[k].body};
    evalWorker.postMessage({id, expr, scopePayload, isExact: exactMode, userFnsPayload});
  });
}

try {'''
content = replace_or_fail(content, old3, new3)

# 4. toggleExact
old4 = '''function toggleExact(){
  exactMode=!exactMode;
  document.getElementById('tg-exact').classList.toggle('on',exactMode);
  document.getElementById('tg-approx').classList.toggle('on',!exactMode);
  refreshNotebook();
}'''
new4 = '''function toggleExact(){
  exactMode=!exactMode;
  document.getElementById('tg-exact').classList.toggle('on',exactMode);
  document.getElementById('tg-approx').classList.toggle('on',!exactMode);
  math.config({ number: exactMode ? 'Fraction' : 'number' });
  refreshNotebook();
}'''
content = replace_or_fail(content, old4, new4)

# 5. refreshNotebook
old5 = '''function refreshNotebook(){
  notebookHistory.forEach(item => {
    try {
      const res = dispatch(item.expr, item.mode);
      renderCell(item.id, res, item.expr, item.mode);
    } catch(e) {}
  });
}'''
new5 = '''function refreshNotebook(){
  notebookHistory.forEach(async item => {
    try {
      const res = await dispatch(item.expr, item.mode);
      await renderCell(item.id, res, item.expr, item.mode);
    } catch(e) {}
  });
}'''
content = replace_or_fail(content, old5, new5)

# 6. parseDef
old6 = '''function parseDef(expr){
  const fn=expr.match(/^([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*=\s*(.+)$/);
  if(fn){
    const name=fn[1], params=fn[2].split(',').map(s=>s.trim()).filter(Boolean), body=fn[3].trim();
    const compiled=math.compile(body);
    userFns[name]={params,body,compiled};
    scope[name]=(...args)=>{const loc=Object.assign({},scope);params.forEach((p,i)=>loc[p]=args[i]);return compiled.evaluate(loc);};
    return {type:'funcdef',name,params,body};
  }
  const va=expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if(va&&!expr.includes('==')&&!expr.includes('solve(')){
    const name=va[1], val=math.evaluate(va[2],scope);
    scope[name]=val;
    return {type:'vardef',name,value:val};
  }
  return null;
}'''
new6 = '''async function parseDef(expr){
  const fn=expr.match(/^([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*=\s*(.+)$/);
  if(fn){
    const name=fn[1], params=fn[2].split(',').map(s=>s.trim()).filter(Boolean), body=fn[3].trim();
    const compiled=math.compile(body);
    userFns[name]={params,body,compiled};
    scope[name]=(...args)=>{const loc=Object.assign({},scope);params.forEach((p,i)=>loc[p]=args[i]);return compiled.evaluate(loc);};
    return {type:'funcdef',name,params,body};
  }
  const va=expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if(va&&!expr.includes('==')&&!expr.includes('solve(')){
    const name=va[1];
    const workerRes = await runInWorker(va[2], scope);
    if (workerRes.error) throw new Error(workerRes.error);
    const val = math.evaluate(workerRes.res);
    scope[name]=val;
    return {type:'vardef',name,value:val};
  }
  return null;
}'''
content = replace_or_fail(content, old6, new6)

# 7. dispatch
old7 = '''function dispatch(rawExpr, mode){
  const expr = normalise(rawExpr);
  const def=parseDef(expr);
  if(def){renderDefs();return def;}
  if(/\\bto\\b/.test(expr)&&mode!=='calculus') return evalUnits(expr);
  const exprForEval = (mode==='trig'||/\\b(sin|cos|tan|sec|csc|cot)\\s*\\(/.test(expr)) ? wrapTrigForDeg(expr) : expr;
  switch(mode){
    case 'calculus': return evalCalc(exprForEval);
    case 'solve':    return evalSolve(exprForEval);
    case 'matrix':   return evalMatrix(exprForEval);
    case 'stats':    case 'logic': case 'numeric': case 'trig': case 'units':
      return evalGeneric(exprForEval);
    default: return evalAlgebra(exprForEval);
  }
}'''
new7 = '''async function dispatch(rawExpr, mode){
  const expr = normalise(rawExpr);
  const def=await parseDef(expr);
  if(def){renderDefs();return def;}
  if(/\\bto\\b/.test(expr)&&mode!=='calculus') return await evalUnits(expr);
  const exprForEval = (mode==='trig'||/\\b(sin|cos|tan|sec|csc|cot)\\s*\\(/.test(expr)) ? wrapTrigForDeg(expr) : expr;
  switch(mode){
    case 'calculus': return await evalCalc(exprForEval);
    case 'solve':    return await evalSolve(exprForEval);
    case 'matrix':   return await evalMatrix(exprForEval);
    case 'stats':    case 'logic': case 'numeric': case 'trig': case 'units':
      return await evalGeneric(exprForEval);
    default: return await evalAlgebra(exprForEval);
  }
}'''
content = replace_or_fail(content, old7, new7)

# 8. evalAlgebra Top
old8 = '''function evalAlgebra(expr){
  const steps=[];
  if(/^simplify\\s*\\(/.test(expr)){'''
new8 = '''async function evalAlgebra(expr){
  const steps=[];
  if(/^apart\\s*\\(/.test(expr)){
    const inner=xarg(expr,'apart');
    try {
      const res = window.Algebrite ? Algebrite.run(`apart(${inner})`) : "";
      if (!res || res === "" || res.includes('Stop:')) throw new Error('apart failed');
      const s = math.parse(res);
      steps.push({d:'Input', e:inner}, {d:'Partial fractions (Algebrite)', e:res});
      return {type:'sym', out:s.toTex(), plain:res, steps, plot:/\\bx\\b/.test(res)?res:null};
    } catch(err) {
      steps.push({d:'Input', e:inner}, {d:'Error', e:'Could not decompose'});
      return {type:'sym', out:math.parse(inner).toTex(), plain:inner, steps};
    }
  }
  if(/^simplify\\s*\\(/.test(expr)){'''
content = replace_or_fail(content, old8, new8)

# 9. evalAlgebra End
old9 = '''  // General algebra expression — try numeric then fall back to symbolic
  try {
    const result=math.evaluate(expr,scope);
    const plain=fmtR(result);'''
new9 = '''  // General algebra expression — try numeric then fall back to symbolic
  try {
    const workerRes = await runInWorker(expr, scope);
    if (workerRes.error) throw new Error(workerRes.error);
    const result = math.evaluate(workerRes.res);
    const plain=fmtR(result);'''
content = replace_or_fail(content, old9, new9)

# 10. evalCalc Top
old10 = '''function evalCalc(expr){'''
new10 = '''async function evalCalc(expr){'''
content = replace_or_fail(content, old10, new10)

# 11. evalCalc Integral
old11 = '''      const antideriv = symbolicIntegrate(f, v);
      if (antideriv.noForm) {
        steps.push({d:'Pattern match', e:'No closed form found'},{d:'Tip', e:`Use integrate(${f}, ${v}, a, b) for a numerical result`});
        return{type:'sym',out:`\\\\int ${math.parse(f).toTex()} \\\\, d${v} \\\\quad \\\\text{(no closed form)}`,plain:`∫ ${f} d${v} — no closed form. Try integrate(f,x,a,b).`,steps};
      }'''
new11 = '''      const antideriv = symbolicIntegrate(f, v);
      if (antideriv.noForm && window.Algebrite) {
        const algRes = Algebrite.run(`integral(${f}, ${v})`);
        if (algRes && !algRes.includes('Stop:') && !algRes.includes('integral')) {
          steps.push({d:'Integrand', e:f},{d:'Risch Algorithm (Algebrite)', e: algRes + ' + C'});
          try {
            const tex = math.parse(algRes).toTex();
            return {type:'sym',out:`\\\\int ${math.parse(f).toTex()} \\\\, d${v} = ${tex} + C`,plain:`∫ ${f} d${v} = ${algRes} + C`,steps};
          } catch(e) {}
        }
      }
      if (antideriv.noForm) {
        steps.push({d:'Pattern match', e:'No closed form found'},{d:'Tip', e:`Use integrate(${f}, ${v}, a, b) for a numerical result`});
        return{type:'sym',out:`\\\\int ${math.parse(f).toTex()} \\\\, d${v} \\\\quad \\\\text{(no closed form)}`,plain:`∫ ${f} d${v} — no closed form. Try integrate(f,x,a,b).`,steps};
      }'''
content = replace_or_fail(content, old11, new11)

# 12. evalCalc End
old12 = '''  try {
    const r=math.evaluate(expr,scope);
    return{type:'val',out:toTex(r),plain:fmtR(r)};
  } catch(e) { return evalSymbolic(expr); }'''
new12 = '''  try {
    const workerRes = await runInWorker(expr, scope);
    if (workerRes.error) throw new Error(workerRes.error);
    const r = math.evaluate(workerRes.res);
    return{type:'val',out:toTex(r),plain:fmtR(r)};
  } catch(e) { return evalSymbolic(expr); }'''
content = replace_or_fail(content, old12, new12)

# 13. evalSolve and evalMatrix
old13 = '''function evalSolve(expr){'''
new13 = '''async function evalSolve(expr){'''
content = replace_or_fail(content, old13, new13)

old14 = '''function evalMatrix(expr){'''
new14 = '''async function evalMatrix(expr){'''
content = replace_or_fail(content, old14, new14)

# 15. evalGeneric
old15 = '''function evalGeneric(expr){
  try {
    const result=math.evaluate(expr,scope);
    if(result&&result.isComplex){'''
new15 = '''async function evalGeneric(expr){
  try {
    const workerRes = await runInWorker(expr, scope);
    if (workerRes.error) throw new Error(workerRes.error);
    const result = math.evaluate(workerRes.res);

    if(result&&result.isComplex){'''
content = replace_or_fail(content, old15, new15)

# 16. evalUnits
old16 = '''function evalUnits(expr){
  const r=math.evaluate(expr,scope);
  const plain=r&&r.toString?r.toString():fmtR(r);
  return{type:'unit',out:escH(plain),plain};
}'''
new16 = '''async function evalUnits(expr){
  const workerRes = await runInWorker(expr, scope);
  if (workerRes.error) throw new Error(workerRes.error);
  const r = math.evaluate(workerRes.res);
  const plain=r&&r.toString?r.toString():fmtR(r);
  return{type:'unit',out:escH(plain),plain};
}'''
content = replace_or_fail(content, old16, new16)

# 17. evalUnit
old17 = '''function evalUnit(){
  const expr=document.getElementById('uinp').value.trim();
  const el=document.getElementById('ures');
  if(!expr){el.innerHTML='<span class="units-result-empty">Enter a unit expression to convert…</span>';return;}
  try{
    const r=math.evaluate(expr,scope);
    const plain=r&&r.toString?r.toString():fmtR(r);
    el.innerHTML=`<span>${escH(plain)}</span>`;
  }catch(e){el.innerHTML=`<span style="color:var(--rose);font-size:14px;">! ${escH(e.message)}</span>`;}
}'''
new17 = '''async function evalUnit(){
  const expr=document.getElementById('uinp').value.trim();
  const el=document.getElementById('ures');
  if(!expr){el.innerHTML='<span class="units-result-empty">Enter a unit expression to convert…</span>';return;}
  try{
    el.innerHTML='<div class="spin" style="margin-left: 10px;"></div>';
    const workerRes = await runInWorker(expr, scope);
    if (workerRes.error) throw new Error(workerRes.error);
    const r = math.evaluate(workerRes.res);
    const plain=r&&r.toString?r.toString():fmtR(r);
    el.innerHTML=`<span>${escH(plain)}</span>`;
  }catch(e){el.innerHTML=`<span style="color:var(--rose);font-size:14px;">! ${escH(e.message)}</span>`;}
}'''
content = replace_or_fail(content, old17, new17)

# 18. runCell
old18 = '''function runCell(){
  const expr=getCurInput();
  if(!expr) return;
  iHist.unshift(expr); iIdx=-1;
  clrInput(); closeAC();
  const w=document.getElementById('welcome');
  if(w) w.style.display='none';
  cellN++;
  const id='c'+cellN;
  const nb=document.getElementById('notebook');
  const el=document.createElement('div');
  el.className='cell'; el.id=id;
  el.innerHTML=`
    <div class="cin">
      <span class="cprompt"><span class="cprompt-num">${cellN}</span><span class="cprompt-arrow">›</span></span>
      <span class="cexpr" onclick="reload('${esc2(expr)}')" title="Click to load">${escH(expr)}</span>
      <span class="cmeta"><span class="cbadge">${curMode}</span></span>
    </div>
    <div class="cout loading" id="o${id}"><div class="spin"></div></div>
    <div class="steps" id="st${id}"></div>
    <div class="cell-plot" id="pl${id}"></div>
    <div class="cacts" id="ac${id}"></div>`;
  nb.appendChild(el);
  scrollNB();
  const cm=curMode;
  notebookHistory.push({id, expr, mode:cm});
  setTimeout(()=>{
    try{const res=dispatch(expr,cm);renderCell(id,res,expr,cm);}
    catch(e){
      try{const res=evalGeneric(normalise(expr));renderCell(id,res,expr,cm);}
      catch(e2){renderErr(id,e2.message||String(e2));}
    }
    persistScope();
  },30);
}

async function renderCell(id,res,expr,mode){'''
new18 = '''async function runCell(){
  const expr=getCurInput();
  if(!expr) return;
  iHist.unshift(expr); iIdx=-1;
  clrInput(); closeAC();
  const w=document.getElementById('welcome');
  if(w) w.style.display='none';
  cellN++;
  const id='c'+cellN;
  const nb=document.getElementById('notebook');
  const el=document.createElement('div');
  el.className='cell'; el.id=id;
  el.innerHTML=`
    <div class="cin">
      <span class="cprompt"><span class="cprompt-num">${cellN}</span><span class="cprompt-arrow">›</span></span>
      <span class="cexpr" onclick="reload('${esc2(expr)}')" title="Click to load">${escH(expr)}</span>
      <span class="cmeta"><span class="cbadge">${curMode}</span></span>
    </div>
    <div class="cout loading" id="o${id}"><div class="spin"></div></div>
    <div class="steps" id="st${id}"></div>
    <div class="cell-plot" id="pl${id}"></div>
    <div class="cacts" id="ac${id}"></div>`;
  nb.appendChild(el);
  scrollNB();
  const cm=curMode;
  notebookHistory.push({id, expr, mode:cm});
  setTimeout(async ()=>{
    try{const res=await dispatch(expr,cm); await renderCell(id,res,expr,cm);}
    catch(e){
      try{const res=await evalGeneric(normalise(expr)); await renderCell(id,res,expr,cm);}
      catch(e2){renderErr(id,e2.message||String(e2));}
    }
    persistScope();
    const def = await parseDef(normalise(expr));
    if (def) triggerReactive(def.name, id);
  },30);
}

async function triggerReactive(varName, skipId) {
  for (const item of notebookHistory) {
    if (item.id === skipId) continue;
    if (new RegExp(`\\\\b${varName}\\\\b`).test(item.expr) && !item.expr.includes('=')) {
      const oEl = document.getElementById('o'+item.id);
      if(oEl) {
        oEl.classList.add('loading');
        oEl.innerHTML = '<div class="spin"></div>';
      }
      try {
        const res = await dispatch(item.expr, item.mode);
        await renderCell(item.id, res, item.expr, item.mode);
      } catch(e) {}
    }
  }
}

async function renderCell(id,res,expr,mode){'''
content = replace_or_fail(content, old18, new18)

# 19. MODES Algebra
old19 = '''  algebra:{
    label:'Algebra', glyph:'α',
    sub:'Symbolic manipulation, simplification, factoring.',
    sm:['Simplify','Expand','Factor','Collect','GCD','LCM'],
    qr:['x^2','sqrt(x)','abs(x)','floor(x)','ceil(x)','sign(x)','mod(a,b)','gcd(a,b)','lcm(a,b)','factorial(n)','log(x)','log(x,b)'],
    syn:'<span class="kw">simplify</span>(expr)  <span class="kw">expand</span>(expr)\\n<span class="kw">factor</span>(expr)  <span class="kw">collect</span>(expr,<span class="var">x</span>)\\n<span class="var">f</span>(<span class="var">x</span>) = <span class="var">x</span>^2+1   <span class="var">x</span> = 42\\n<span class="kw">gcd</span>(252,198)  <span class="kw">lcm</span>(4,6)','''
new19 = '''  algebra:{
    label:'Algebra', glyph:'α',
    sub:'Symbolic manipulation, simplification, factoring.',
    sm:['Simplify','Expand','Factor','Collect','Apart','GCD','LCM'],
    qr:['x^2','sqrt(x)','abs(x)','floor(x)','ceil(x)','sign(x)','mod(a,b)','gcd(a,b)','lcm(a,b)','factorial(n)','log(x)','log(x,b)'],
    syn:'<span class="kw">simplify</span>(expr)  <span class="kw">expand</span>(expr)\\n<span class="kw">factor</span>(expr)  <span class="kw">collect</span>(expr,<span class="var">x</span>)\\n<span class="kw">apart</span>(expr)\\n<span class="var">f</span>(<span class="var">x</span>) = <span class="var">x</span>^2+1   <span class="var">x</span> = 42\\n<span class="kw">gcd</span>(252,198)  <span class="kw">lcm</span>(4,6)','''
content = replace_or_fail(content, old19, new19)

# 20. insertSM Map
old20 = '''  const map={
    'Simplify':'simplify(','Expand':'expand(','Factor':'factor(','Collect':'collect(',
    'GCD':'gcd(','LCM':'lcm(','Derive':'derivative(','Integrate':'integrate(','Limit':'limit(','''
new20 = '''  const map={
    'Simplify':'simplify(','Expand':'expand(','Factor':'factor(','Collect':'collect(','Apart':'apart(',
    'GCD':'gcd(','LCM':'lcm(','Derive':'derivative(','Integrate':'integrate(','Limit':'limit(','''
content = replace_or_fail(content, old20, new20)

# 21. exportLatex implementation
old21 = '''function exportTxt(){
  const lines=[];
  document.querySelectorAll('.cell').forEach(cell=>{
    const ex=cell.querySelector('.cexpr'),ou=cell.querySelector('.cout'),tx=cell.querySelector('.text-cell-edit');
    if(tx) lines.push('## '+tx.value);
    else if(ex) lines.push(`>> ${ex.textContent}\\n   ${ou?ou.innerText:''}`);
  });
  const blob=new Blob([lines.join('\\n\\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cas-export.txt';a.click();
}'''
new21 = '''function exportLatex(){
  const lines=["\\\\documentclass{article}", "\\\\usepackage{amsmath,amssymb}", "\\\\begin{document}", "\\\\title{CassyCAS Session}", "\\\\maketitle"];
  document.querySelectorAll('.cell').forEach(cell=>{
    const ex=cell.querySelector('.cexpr'), ou=cell.querySelector('.cout'), tx=cell.querySelector('.text-cell-edit');
    if(tx) lines.push(`\\\\section*{${tx.value}}`);
    else if(ex) {
      lines.push(`\\\\begin{verbatim}\\nIn: ${ex.textContent}\\n\\\\end{verbatim}`);
      if(ou && ou.querySelector('.mjrender')) lines.push(ou.querySelector('.mjrender').innerText);
      else if(ou) lines.push(`\\\\begin{verbatim}\\nOut: ${ou.innerText}\\n\\\\end{verbatim}`);
    }
  });
  lines.push("\\\\end{document}");
  const blob=new Blob([lines.join('\\n\\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cas-export.tex';a.click();
}
function exportTxt(){
  const lines=[];
  document.querySelectorAll('.cell').forEach(cell=>{
    const ex=cell.querySelector('.cexpr'),ou=cell.querySelector('.cout'),tx=cell.querySelector('.text-cell-edit');
    if(tx) lines.push('## '+tx.value);
    else if(ex) lines.push(`>> ${ex.textContent}\\n   ${ou?ou.innerText:''}`);
  });
  const blob=new Blob([lines.join('\\n\\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cas-export.txt';a.click();
}'''
content = replace_or_fail(content, old21, new21)

with open("CAS (new).html", "w", encoding="utf-8") as f:
    f.write(content)

print("Successfully applied all upgrades!")
