import './style.css';
import { browserRequest, exportProjectZip, openProject, recoverDraft, starterProject } from './runtime';
const token = new URLSearchParams(location.search).get('token') || '';
const $ = (id:string):any => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const apiHeaders = {'Content-Type':'application/json', 'X-SpriteBuilder-Token':token};

const state:any = {
  doc:null, sourceHash:'', summary:null, part:null, color:null, tool:'pencil', mode:'part',
  dirty:false, valid:false, error:null, errorInfo:null, history:[], future:[], drawing:false, previewTimer:null,
  validateTimer:null, previewUrl:null, rigUrl:null, playing:null, workspace:'parts', selectedBone:null,
  selectedChain:null, selectedClip:null, selectedTrack:'rotation', overlay:null
};

function rows(view) { return state.doc.parts[state.part][view].replace(/^\n|\n$/g,'').split('\n'); }
function setRows(view, value) { state.doc.parts[state.part][view] = value.join('\n'); }
function paletteHex(value) {
  if (typeof value === 'string') return value.slice(0,7);
  return '#' + value.slice(0,3).map(v => Number(v).toString(16).padStart(2,'0')).join('');
}
function selectedSpec() { return state.doc.parts[state.part]; }

async function request(path, options:any={}) {
  if (!token) return browserRequest(path, options);
  const response = await fetch(path, {...options, headers:{...apiHeaders,...(options.headers||{})}});
  if (!response.ok) {
    let body={error:{message:`Request failed (${response.status})`}};
    try { body=await response.json(); } catch (_) {}
    const error:any = new Error(body.error?.message || 'Request failed'); error.body=body; error.status=response.status; throw error;
  }
  return response;
}

async function load() {
  try {
    const payload = await (await request('/api/project')).json();
    state.doc=payload.document; state.sourceHash=payload.source_hash; state.summary=payload.summary;
    state.part=Object.keys(state.doc.parts)[0]; state.color=Object.keys(state.doc.palette)[0];
    state.selectedBone=Object.keys(state.doc.rig.bones)[0]; state.selectedClip=Object.keys(state.doc.animations)[0];
    $('filePath').textContent=payload.summary.path;
    renderAll(); await validateAndPreview();
  } catch (error) { showError(error.message); }
}

function checkpoint() {
  state.history.push({doc:clone(state.doc),part:state.part,color:state.color,bone:state.selectedBone,chain:state.selectedChain,clip:state.selectedClip});
  if (state.history.length>100) state.history.shift();
  state.future=[];
}
function restore(snapshot) { state.doc=snapshot.doc; state.part=snapshot.part; state.color=snapshot.color; state.selectedBone=snapshot.bone||Object.keys(state.doc.rig.bones)[0];state.selectedChain=snapshot.chain;state.selectedClip=snapshot.clip||Object.keys(state.doc.animations)[0];changed(false); }
function snapshot(){return {doc:clone(state.doc),part:state.part,color:state.color,bone:state.selectedBone,chain:state.selectedChain,clip:state.selectedClip};}
function undo() { if (!state.history.length) return; state.future.push(snapshot()); restore(state.history.pop()); }
function redo() { if (!state.future.length) return; state.history.push(snapshot()); restore(state.future.pop()); }
function changed(render=true) {
  state.dirty=true; if(render) renderAll(); else {renderAll();}
  $('status').textContent='Unsaved changes'; $('saveButton').disabled=true;
  clearTimeout(state.validateTimer); state.validateTimer=setTimeout(validateAndPreview,180);
}

function renderAll() { renderParts(); renderPalette(); renderDimensions(); renderCanvases(); renderPreviewControls(); renderExportSettings(); renderRig(); updateButtons(); }
function renderParts() {
  const list=$('partList'); list.replaceChildren();
  Object.keys(state.doc.parts).forEach(name=>{
    const button=document.createElement('button'); button.className='part-item'+(name===state.part?' active':''); button.textContent=name;
    button.onclick=()=>{state.part=name; renderAll(); schedulePreview();}; list.append(button);
  });
}
function renderPalette() {
  const list=$('paletteList'); list.replaceChildren();
  Object.entries(state.doc.palette).forEach(([char,value])=>{
    const item=document.createElement('div'); item.className='swatch'+(char===state.color?' active':'');
    const color=document.createElement('input'); color.type='color'; color.value=paletteHex(value); color.title='Change color';
    color.onpointerdown=()=>checkpoint();
    color.oninput=()=>{state.doc.palette[char]=color.value;renderCanvases();changedPreviewOnly();};
    color.onchange=()=>renderPalette();
    const symbol=document.createElement('button'); symbol.className='icon swatch-char'; symbol.textContent=char; symbol.onclick=()=>{state.color=char;renderPalette();};
    const rename=document.createElement('button'); rename.className='icon'; rename.textContent='✎'; rename.title='Rename symbol'; rename.onclick=()=>renameColor(char);
    const remove=document.createElement('button'); remove.className='icon'; remove.textContent='×'; remove.title='Delete color'; remove.onclick=()=>deleteColor(char);
    item.append(color,symbol,rename,remove); item.onclick=e=>{if(e.target===item){state.color=char;renderPalette();}}; list.append(item);
  });
}
function renderDimensions() {
  const front=rows('front'),side=rows('side'); $('partWidth').value=front[0].length; $('partHeight').value=front.length; $('partDepth').value=side[0].length;
}
function renderCanvases() { ['front','side','back'].forEach(drawCanvas); }
function drawCanvas(view) {
  const canvas=$(view+'Canvas'), grid=rows(view), cols=grid[0].length;
  const cell=Math.max(8,Math.min(24,Math.floor(300/Math.max(cols,grid.length))));
  canvas.width=cols*cell; canvas.height=grid.length*cell; canvas.dataset.cell=cell;
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#0e1015';ctx.fillRect(0,0,canvas.width,canvas.height);
  grid.forEach((row,y)=>[...row].forEach((char,x)=>{
    if(char!=='.'){ctx.fillStyle=paletteHex(state.doc.palette[char]||'#ff00ff');ctx.fillRect(x*cell+1,y*cell+1,cell-2,cell-2);}
    ctx.strokeStyle='#303543';ctx.lineWidth=1;ctx.strokeRect(x*cell+.5,y*cell+.5,cell,cell);
  }));
  const info=state.errorInfo,path=`parts.${state.part}.${view}`;
  if(info?.path===path&&info.row&&info.column){ctx.strokeStyle='#ff5964';ctx.lineWidth=3;ctx.strokeRect((info.column-1)*cell+1.5,(info.row-1)*cell+1.5,cell-3,cell-3);}
}
function renderPreviewControls() {
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
  $('animationControls').classList.toggle('hidden',state.mode!=='character');
  const clip=$('clip'), old=clip.value; clip.replaceChildren();
  Object.entries(state.doc.animations||{}).forEach(([name,spec])=>{const o=document.createElement('option');o.value=name;o.textContent=name;clip.append(o);});
  if([...clip.options].some(o=>o.value===old)) clip.value=old;
  const spec=state.doc.animations?.[clip.value]; if(spec){$('frame').max=spec.frames-1;if(+$('frame').value>=spec.frames)$('frame').value=0;$('frameValue').value=$('frame').value;}
  $('yawValue').value=$('yaw').value+'°';
}
function updateButtons() { $('undoButton').disabled=!state.history.length;$('redoButton').disabled=!state.future.length;$('undoButtonRig').disabled=!state.history.length;$('redoButtonRig').disabled=!state.future.length;$('saveButton').disabled=!state.dirty||!state.valid; }

function ensureExportSettings(){state.doc.export??={};state.doc.export.directions??=[0,45,90,135,180,225,270,315];return state.doc.export;}
function selectedExportAnimations(){return ensureExportSettings().animations||Object.keys(state.doc.animations);}
function renderExportSettings(){const animations=$('exportAnimations'),directions=$('exportDirections');if(!animations||!directions)return;const settings=ensureExportSettings();animations.replaceChildren();const ah=document.createElement('h3');ah.textContent='Animations';animations.append(ah);const selected=selectedExportAnimations();Object.keys(state.doc.animations).forEach(name=>{const label=document.createElement('label');label.className='export-choice';const input=document.createElement('input');input.type='checkbox';input.checked=selected.includes(name);input.onchange=()=>{const current=selectedExportAnimations().slice();if(!input.checked&&current.length===1){input.checked=true;return alert('Select at least one animation for export.');}checkpoint();settings.animations=input.checked?[...current,name].filter((v,i,a)=>a.indexOf(v)===i):current.filter(v=>v!==name);changed();};label.append(input,document.createTextNode(name));animations.append(label);});directions.replaceChildren();const dh=document.createElement('h3');dh.textContent='Directions (yaw)';directions.append(dh);const list=document.createElement('div');list.className='direction-list';settings.directions.forEach((angle,index)=>{const chip=document.createElement('span');chip.className='direction-chip';chip.append(document.createTextNode(`${angle}°`));const remove=document.createElement('button');remove.textContent='×';remove.title='Remove direction';remove.onclick=()=>{if(settings.directions.length===1)return alert('Select at least one export direction.');checkpoint();settings.directions.splice(index,1);changed();};chip.append(remove);list.append(chip);});directions.append(list);}
function addExportDirection(){const raw=prompt('Yaw angle in degrees','0');if(raw===null)return;const value=Number(raw);if(!Number.isFinite(value))return alert('Direction must be a number.');const angle=((value%360)+360)%360,settings=ensureExportSettings();if(settings.directions.some(v=>((v%360)+360)%360===angle))return alert('That direction is already selected.');checkpoint();settings.directions.push(angle);changed();}

function canvasCell(event,canvas) {
  const rect=canvas.getBoundingClientRect(),cell=+canvas.dataset.cell;
  return [Math.floor((event.clientX-rect.left)*canvas.width/rect.width/cell),Math.floor((event.clientY-rect.top)*canvas.height/rect.height/cell)];
}
function writeCell(view,x,y,char) {
  const grid=rows(view); if(y<0||y>=grid.length||x<0||x>=grid[0].length)return false;
  const line=[...grid[y]], previous=line[x]; if(previous===char)return false; line[x]=char;grid[y]=line.join('');setRows(view,grid);
  if(view==='front'||view==='back'){
    const other=view==='front'?'back':'front',og=rows(other),ol=[...og[y]];
    if(char==='.') ol[x]='.'; else if(ol[x]==='.') ol[x]=state.color;
    og[y]=ol.join('');setRows(other,og);
  }
  return true;
}
function flood(view,x,y,char) {
  const grid=rows(view),old=grid[y]?.[x];if(old===undefined||old===char)return;
  const stack=[[x,y]],seen=new Set();while(stack.length){const [cx,cy]=stack.pop(),key=cx+','+cy;if(seen.has(key)||cy<0||cy>=grid.length||cx<0||cx>=grid[0].length||rows(view)[cy][cx]!==old)continue;seen.add(key);writeCell(view,cx,cy,char);stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);}
}
function applyTool(view,x,y) {
  if(state.tool==='eyedropper'){const char=rows(view)[y]?.[x];if(char&&char!=='.'&&state.doc.palette[char]){state.color=char;state.tool='pencil';renderAll();}return;}
  const char=state.tool==='eraser'?'.':state.color;
  if(state.tool==='fill') flood(view,x,y,char); else writeCell(view,x,y,char);
  renderCanvases(); changedPreviewOnly();
}
function changedPreviewOnly(){state.dirty=true;$('status').textContent='Unsaved changes';$('saveButton').disabled=true;clearTimeout(state.validateTimer);state.validateTimer=setTimeout(validateAndPreview,180);}

function bindCanvas(view){const canvas=$(view+'Canvas');canvas.onpointerdown=e=>{checkpoint();state.drawing=true;canvas.setPointerCapture(e.pointerId);const [x,y]=canvasCell(e,canvas);applyTool(view,x,y);if(state.tool==='fill'||state.tool==='eyedropper')state.drawing=false;};canvas.onpointermove=e=>{if(!state.drawing)return;const [x,y]=canvasCell(e,canvas);applyTool(view,x,y);};canvas.onpointerup=()=>{state.drawing=false;updateButtons();};}

function validName(name){return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);}
function uniqueName(base){let name=base,n=2;while(state.doc.parts[name])name=base+'_'+n++;return name;}
function addPart(){const name=prompt('New part name',uniqueName('part'));if(!name)return;if(!validName(name)||state.doc.parts[name])return alert('Use a unique name containing letters, numbers, _ or -.');checkpoint();const c=state.color,w=8,h=8,d=8;const blank=(n)=>'.'.repeat(n);const f=Array(h).fill(0).map(()=>blank(w)),s=Array(h).fill(0).map(()=>blank(d));f[h-1]=f[h-1].slice(0,Math.floor(w/2))+c+f[h-1].slice(Math.floor(w/2)+1);s[h-1]=s[h-1].slice(0,Math.floor(d/2))+c+s[h-1].slice(Math.floor(d/2)+1);state.doc.parts[name]={pivot:[(w-1)/2,0,(d-1)/2],front:f.join('\n'),back:f.join('\n'),side:s.join('\n')};state.part=name;changed();}
function duplicatePart(){const name=prompt('Duplicate part as',uniqueName(state.part));if(!name)return;if(!validName(name)||state.doc.parts[name])return alert('Choose a unique valid name.');checkpoint();state.doc.parts[name]=clone(selectedSpec());state.part=name;changed();}
function renamePart(){const old=state.part,name=prompt('Rename part',old);if(!name||name===old)return;if(!validName(name)||state.doc.parts[name])return alert('Choose a unique valid name.');checkpoint();const replaced={};Object.entries(state.doc.parts).forEach(([key,value])=>replaced[key===old?name:key]=value);state.doc.parts=replaced;Object.values(state.doc.rig?.bones||{}).forEach(b=>{if(b.part===old)b.part=name;});state.part=name;changed();}
function deletePart(){if(Object.keys(state.doc.parts).length===1)return alert('A project must contain at least one part.');const refs=Object.entries(state.doc.rig?.bones||{}).filter(([,b])=>b.part===state.part).map(([n])=>n);const detail=refs.length?` It will detach bones: ${refs.join(', ')}.`:'';if(!confirm(`Delete ${state.part}?${detail}`))return;checkpoint();refs.forEach(n=>delete state.doc.rig.bones[n].part);delete state.doc.parts[state.part];state.part=Object.keys(state.doc.parts)[0];changed();}

function resizeGrid(grid,newW,newH,offsetX,offsetY){const out=Array.from({length:newH},()=>Array(newW).fill('.'));grid.forEach((row,y)=>[...row].forEach((c,x)=>{const nx=x+offsetX,ny=y+offsetY;if(nx>=0&&nx<newW&&ny>=0&&ny<newH)out[ny][nx]=c;}));return out.map(r=>r.join(''));}
function resizePart(){const nw=+$('partWidth').value,nh=+$('partHeight').value,nd=+$('partDepth').value;if([nw,nh,nd].some(n=>!Number.isInteger(n)||n<1||n>64))return alert('Dimensions must be integers from 1 to 64.');const f=rows('front'),s=rows('side'),ow=f[0].length,oh=f.length,od=s[0].length;if(nw===ow&&nh===oh&&nd===od)return;checkpoint();const ox=Math.floor((nw-ow)/2),oz=Math.floor((nd-od)/2),oy=nh-oh;setRows('front',resizeGrid(f,nw,nh,ox,oy));setRows('back',resizeGrid(rows('back'),nw,nh,ox,oy));setRows('side',resizeGrid(s,nd,nh,oz,oy));const p=selectedSpec().pivot||[(ow-1)/2,0,(od-1)/2];selectedSpec().pivot=[+p[0]+ox,+p[1],+p[2]+oz];changed();}

function addColor(){const char=prompt('Palette character (one character)');if(!char)return;if(char.length!==1||char==='.'||state.doc.palette[char]!==undefined)return alert('Choose one unused character other than .');checkpoint();state.doc.palette[char]='#ffffff';state.color=char;changed();}
function renameColor(old){const char=prompt('Rename palette character',old);if(!char||char===old)return;if(char.length!==1||char==='.'||state.doc.palette[char]!==undefined)return alert('Choose one unused character other than .');checkpoint();const palette={};Object.entries(state.doc.palette).forEach(([k,v])=>palette[k===old?char:k]=v);state.doc.palette=palette;Object.values(state.doc.parts).forEach(part=>['front','back','side'].forEach(view=>part[view]=part[view].split(old).join(char)));state.color=char;changed();}
function deleteColor(char){const used=Object.values(state.doc.parts).some(part=>['front','back','side'].some(view=>part[view].includes(char)));if(used)return alert(`Color ${char} is still used by a part. Erase or replace it first.`);if(Object.keys(state.doc.palette).length===1)return alert('A project needs at least one color.');if(!confirm(`Delete palette color ${char}?`))return;checkpoint();delete state.doc.palette[char];if(state.color===char)state.color=Object.keys(state.doc.palette)[0];changed();}

function showError(message,info=null){state.error=message;state.errorInfo=info;$('errorBanner').textContent=message;$('errorBanner').classList.remove('hidden');if(state.doc)renderCanvases();}
function clearError(){state.error=null;state.errorInfo=null;$('errorBanner').classList.add('hidden');if(state.doc)renderCanvases();}
async function validateAndPreview(){
  try{await request('/api/validate',{method:'POST',body:JSON.stringify({document:state.doc})});state.valid=true;clearError();$('saveButton').disabled=!state.dirty;schedulePreview(0);}
  catch(error){state.valid=false;showError(error.message,error.body?.error);$('saveButton').disabled=true;}
  updateButtons();
}
function schedulePreview(delay=120){clearTimeout(state.previewTimer);state.previewTimer=setTimeout(updatePreview,delay);}
async function updatePreview(){if(!state.valid)return;const stage=document.querySelector('.preview-stage');stage.classList.add('busy');const payload={document:state.doc,mode:state.mode,part:state.part,direction:+$('yaw').value,clip:$('clip').value,frame:+$('frame').value};try{const response=await request('/api/preview',{method:'POST',body:JSON.stringify(payload)});const blob=await response.blob();if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=URL.createObjectURL(blob);$('previewImage').src=state.previewUrl;clearError();}catch(error){showError(error.message);}finally{stage.classList.remove('busy');}}
async function save(){if(!state.valid)return;try{const payload=await(await request('/api/project',{method:'PUT',body:JSON.stringify({document:state.doc,source_hash:state.sourceHash})})).json();state.sourceHash=payload.source_hash;state.dirty=false;$('status').textContent='Saved';updateButtons();}catch(error){showError(error.message);if(error.status===409)$('status').textContent='File changed externally';}}
async function newProject(){if(state.dirty&&!confirm('Discard unsaved changes and create a new project?'))return;let filename=prompt('New project filename','untitled.yaml');if(!filename)return;if(!/^[A-Za-z0-9_.-]+\.ya?ml$/i.test(filename))return alert('Use a .yaml or .yml filename without folders.');try{const payload=await(await request('/api/project/new',{method:'POST',body:JSON.stringify({filename})})).json();state.doc=payload.document;state.sourceHash=payload.source_hash;state.summary=payload.summary;state.part=Object.keys(state.doc.parts)[0];state.color=Object.keys(state.doc.palette)[0];state.selectedBone=Object.keys(state.doc.rig.bones)[0];state.selectedChain=null;state.selectedClip=Object.keys(state.doc.animations)[0];state.history=[];state.future=[];state.dirty=false;state.valid=true;$('filePath').textContent=payload.summary.path;$('status').textContent='Created';setWorkspace('parts');renderAll();await validateAndPreview();}catch(error){showError(error.message);}}

function setWorkspace(name){state.workspace=name;document.querySelectorAll<HTMLElement>('[data-workspace]').forEach(b=>b.classList.toggle('active',b.dataset.workspace===name));document.querySelectorAll('[data-pane=parts]').forEach(e=>e.classList.toggle('hidden',name!=='parts'));document.querySelectorAll('[data-pane=rigging]').forEach(e=>e.classList.toggle('hidden',name==='parts'));$('rigBonesSection').classList.toggle('hidden',name==='animate');$('clipSection').classList.toggle('hidden',name!=='animate');$('timeline').classList.toggle('hidden',name!=='animate');$('rigModeTitle').textContent=name==='animate'?'Animate':'Rest pose';renderRig();schedulePreview(0);}
function boneChildren(name){return Object.entries(state.doc.rig.bones).filter(([,b])=>b.parent===name).map(([n])=>n);}
function appendBoneTree(parent,container,depth=0){Object.entries(state.doc.rig.bones).filter(([,b])=>(b.parent||null)===(parent||null)).forEach(([name])=>{const b=document.createElement('button');b.style.paddingLeft=(10+depth*14)+'px';b.textContent=name;b.classList.toggle('active',name===state.selectedBone);b.onclick=()=>{state.selectedBone=name;state.selectedChain=null;renderRig();schedulePreview(0);};container.append(b);appendBoneTree(name,container,depth+1);});}
function vecEditor(title,value,onchange){const wrap=document.createElement('div');wrap.className='vec';const label=document.createElement('span');label.textContent=title;wrap.append(label);['X','Y','Z'].forEach((axis,i)=>{const input=document.createElement('input');input.type='number';input.step='0.1';input.title=axis;input.value=String(Number(value?.[i]||0));input.onchange=()=>onchange(i,+input.value);wrap.append(input);});return wrap;}
function authoredTrack(){const clip=state.doc.animations[state.selectedClip];if(!clip)return null;if(state.selectedChain)return clip.ik?.[state.selectedChain]?.[state.selectedTrack]||null;return clip.bones?.[state.selectedBone]?.[state.selectedTrack]||null;}
function keyAtFrame(){return authoredTrack()?.find(k=>k.frame===+$('frame').value)||null;}
function sampleKeys(keys,frame,fallback){if(!keys?.length)return clone(fallback);const exact=keys.find(k=>k.frame===frame);if(exact)return clone(exact.value);const left=[...keys].reverse().find(k=>k.frame<frame),right=keys.find(k=>k.frame>frame);if(!left)return clone(right.value);if(!right||left.interpolation==='step')return clone(left.value);let t=(frame-left.frame)/(right.frame-left.frame);if(left.interpolation==='smooth')t=t*t*(3-2*t);if(Array.isArray(left.value))return left.value.map((v,i)=>v*(1-t)+right.value[i]*t);return left.value*(1-t)+right.value*t;}
function putKey(group,name,track,value){const clip=state.doc.animations[state.selectedClip],bucket=(clip[group]??={})[name]??={};const keys=bucket[track]??=[];const frame=+$('frame').value,index=keys.findIndex(k=>k.frame===frame);const key={frame,value,interpolation:index>=0?(keys[index].interpolation||'linear'):'linear'};if(index>=0)keys[index]=key;else keys.push(key);keys.sort((a,b)=>a.frame-b.frame);}
function renderRig(){if(!state.doc)return;const tree=$('boneTree');tree.replaceChildren();appendBoneTree(null,tree);const chains=$('chainList');chains.replaceChildren();Object.entries(state.doc.rig.ik_chains||{}).forEach(([name,c])=>{const b=document.createElement('button');b.textContent=`${name}: ${c.root} → ${c.mid} → ${c.end}`;b.classList.toggle('active',name===state.selectedChain);b.onclick=()=>{state.selectedChain=name;state.selectedTrack='target';renderRig();};chains.append(b);});const clips=$('clipList');clips.replaceChildren();Object.keys(state.doc.animations).forEach(name=>{const b=document.createElement('button');b.textContent=name;b.classList.toggle('active',name===state.selectedClip);b.onclick=()=>{state.selectedClip=name;$('clip').value=name;$('frame').value=0;renderAll();schedulePreview(0);};clips.append(b);});renderBoneInspector();renderClipTiming();renderTimeline();if(state.workspace!=='parts'&&state.valid)updateRigPreview();}
function renderBoneInspector(){const box=$('boneInspector');box.replaceChildren();const name=state.selectedBone,spec=state.doc.rig.bones[name];if(!spec)return;const heading=document.createElement('h3');heading.textContent=name;box.append(heading);const editVec=(path,label,animationTrack=null)=>{let shown=path.reduce((v,k)=>v?.[k],spec)||[0,0,0];if(state.workspace==='animate'&&animationTrack){const keys=state.doc.animations[state.selectedClip]?.bones?.[name]?.[animationTrack];const sampled=sampleKeys(keys,+$('frame').value,[0,0,0]);shown=animationTrack==='translation'?(spec.translation||[0,0,0]).map((v,i)=>+v+sampled[i]):sampled;}box.append(vecEditor(label,shown,(i,value)=>{checkpoint();if(state.workspace==='animate'&&animationTrack){const base=animationTrack==='translation'?(spec.translation||[0,0,0]):[0,0,0],keys=state.doc.animations[state.selectedClip]?.bones?.[name]?.[animationTrack];const current=sampleKeys(keys,+$('frame').value,[0,0,0]);current[i]=value-(animationTrack==='translation'?+base[i]:0);putKey('bones',name,animationTrack,current);state.selectedTrack=animationTrack;}else{let target=spec;path.slice(0,-1).forEach(k=>target=target[k]??={});const key=path[path.length-1];target[key]=(target[key]||[0,0,0]).slice();target[key][i]=value;}changed();}));};editVec(['translation'],'T', 'translation');editVec(['rotation'],'R°','rotation');if(state.workspace==='rig'){const partLabel=document.createElement('label');partLabel.textContent='Attached part ';const select=document.createElement('select');select.append(new Option('None',''));Object.keys(state.doc.parts).forEach(p=>select.append(new Option(p,p)));select.value=spec.part||'';select.onchange=()=>{checkpoint();if(select.value)spec.part=select.value;else delete spec.part;changed();};partLabel.append(select);box.append(partLabel);spec.attachment??={};editVec(['attachment','translation'],'AT');editVec(['attachment','rotation'],'AR°');if(spec.part){const pivot=state.doc.parts[spec.part].pivot||[0,0,0];box.append(vecEditor('Pivot',pivot,(i,value)=>{checkpoint();const p=state.doc.parts[spec.part];p.pivot=(p.pivot||[0,0,0]).slice();p.pivot[i]=value;changed();}));}}renderKeyInspector();}
function renderKeyInspector(){const box=$('keyInspector');box.replaceChildren();if(state.workspace!=='animate')return;box.className='inspector';const key=keyAtFrame(),p=document.createElement('p');p.textContent=key?'Authored key':'Sampled value — no authored key';p.className=key?'authored':'sampled';box.append(p);if(state.selectedChain){if(state.selectedTrack==='weight'){const label=document.createElement('label');label.textContent='Weight ';const input=document.createElement('input');input.type='number';input.min='0';input.max='1';input.step='0.05';input.value=String(key?.value??1);input.onchange=()=>{const value=Math.max(0,Math.min(1,+input.value));checkpoint();putKey('ik',state.selectedChain,'weight',value);changed();};label.append(input);box.append(label);}else{const fallback=state.selectedTrack==='pole'?[0,0,1]:[0,0,0];box.append(vecEditor(state.selectedTrack,key?.value||fallback,(i,value)=>{const current=(keyAtFrame()?.value||fallback).slice();current[i]=value;checkpoint();putKey('ik',state.selectedChain,state.selectedTrack,current);changed();}));}}if(key){const select=document.createElement('select');['linear','smooth','step'].forEach(v=>select.append(new Option(v,v)));select.value=key.interpolation||'linear';select.onchange=()=>{checkpoint();key.interpolation=select.value;changed();};box.append(select);}}
function renderClipTiming(){const box=$('clipTiming');box.replaceChildren();const clip=state.doc.animations[state.selectedClip];if(!clip)return;[['Frames','frames',1],['FPS','fps',.1]].forEach(([label,key,step])=>{const l=document.createElement('label');l.textContent=label+' ';const input=document.createElement('input');input.type='number';input.min=String(step);input.step=String(step);input.value=String(clip[key]);input.onchange=()=>{let value=key==='frames'?Math.floor(+input.value):+input.value;if(value<=0)return renderClipTiming();if(key==='frames'&&value<clip.frames){const count=countKeysAfter(clip,value);if(count&&!confirm(`Remove ${count} key(s) beyond frame ${value-1}?`))return renderClipTiming();}checkpoint();if(key==='frames'&&value<clip.frames)trimClip(clip,value);clip[key]=value;changed();};l.append(input);box.append(l);});const loop=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.checked=clip.loop!==false;check.onchange=()=>{checkpoint();clip.loop=check.checked;changed();};loop.append(check,' Looping');box.append(loop);}
function allTracks(clip){return [...Object.values(clip.bones||{}),...Object.values(clip.ik||{})].flatMap(Object.values);}
function countKeysAfter(clip,frames){return allTracks(clip).reduce((n,t)=>n+t.filter(k=>k.frame>=frames).length,0);}
function trimClip(clip,frames){allTracks(clip).forEach(t=>{for(let i=t.length-1;i>=0;i--)if(t[i].frame>=frames)t.splice(i,1);});}
function renderTimeline(){const timeline=$('timeline');timeline.replaceChildren();if(state.workspace!=='animate')return;const clip=state.doc.animations[state.selectedClip];if(!clip)return;const tracks=state.selectedChain?['target','pole','weight']:['translation','rotation'];tracks.forEach(track=>{const row=document.createElement('div');row.className='track-row';row.style.setProperty('--frames',clip.frames);const label=document.createElement('button');label.textContent=track;label.classList.toggle('active',state.selectedTrack===track);label.onclick=()=>{state.selectedTrack=track;renderRig();};row.append(label);const keys=(state.selectedChain?clip.ik?.[state.selectedChain]:clip.bones?.[state.selectedBone])?.[track]||[];for(let f=0;f<clip.frames;f++){const b=document.createElement('button');b.textContent=keys.some(k=>k.frame===f)?'◆':'';b.classList.toggle('key',!!b.textContent);b.classList.toggle('current',f===+$('frame').value);b.onclick=()=>{$('frame').value=f;$('frameValue').value=f;state.selectedTrack=track;renderRig();schedulePreview(0);};row.append(b);}timeline.append(row);});}
function uniqueObjectName(map,base){let n=base,i=2;while(map[n])n=base+'_'+i++;return n;}
function renameMapKey(map,old,name){const out={};Object.entries(map).forEach(([k,v])=>out[k===old?name:k]=v);return out;}
function addBone(){const name=prompt('New bone name',uniqueObjectName(state.doc.rig.bones,'bone'));if(!name||!validName(name)||state.doc.rig.bones[name])return;checkpoint();const spec={translation:[0,1,0]};if(state.selectedBone)spec.parent=state.selectedBone;state.doc.rig.bones[name]=spec;state.selectedBone=name;changed();}
function renameBone(){const old=state.selectedBone,name=prompt('Rename bone',old);if(!name||name===old||!validName(name)||state.doc.rig.bones[name])return;checkpoint();state.doc.rig.bones=renameMapKey(state.doc.rig.bones,old,name);Object.values(state.doc.rig.bones).forEach(b=>{if(b.parent===old)b.parent=name;});Object.values(state.doc.rig.ik_chains||{}).forEach(c=>['root','mid','end'].forEach(k=>{if(c[k]===old)c[k]=name;}));Object.values(state.doc.animations).forEach(c=>{if(c.bones?.[old])c.bones=renameMapKey(c.bones,old,name);});state.selectedBone=name;changed();}
async function reparentBone(){const choices=['(root)',...Object.keys(state.doc.rig.bones).filter(n=>n!==state.selectedBone)].join(', '),answer=prompt(`New parent (${choices})`,state.doc.rig.bones[state.selectedBone].parent||'(root)');if(answer===null)return;const parent=answer==='(root)'||answer===''?null:answer;if(parent&&!state.doc.rig.bones[parent])return alert('Unknown parent.');checkpoint();try{const payload=await(await request('/api/rig/reparent',{method:'POST',body:JSON.stringify({document:state.doc,bone:state.selectedBone,parent})})).json();state.doc=payload.document;changed();}catch(error){state.history.pop();alert(error.message);}}
function deleteBone(){const name=state.selectedBone,children=boneChildren(name),tracks=Object.entries(state.doc.animations).filter(([,c])=>c.bones?.[name]).map(([n])=>n),chains=Object.entries(state.doc.rig.ik_chains||{}).filter(([,c])=>[c.root,c.mid,c.end].includes(name)).map(([n])=>n),blocks=[];if(children.length)blocks.push('children: '+children.join(', '));if(tracks.length)blocks.push('animation tracks: '+tracks.join(', '));if(chains.length)blocks.push('IK chains: '+chains.join(', '));if(blocks.length)return alert(`Cannot delete ${name}; ${blocks.join('; ')}`);if(Object.keys(state.doc.rig.bones).length===1)return alert('At least one bone must remain.');if(!confirm(`Delete ${name}?`))return;checkpoint();delete state.doc.rig.bones[name];state.selectedBone=Object.keys(state.doc.rig.bones)[0];changed();}
function addChain(){const suggestions=Object.keys(state.doc.rig.bones).filter(e=>{const m=state.doc.rig.bones[e].parent;return m&&state.doc.rig.bones[m].parent;});const end=prompt('End bone (valid: '+suggestions.join(', ')+')',suggestions[0]||'');if(!end||!suggestions.includes(end))return alert('Choose a direct three-bone path.');const mid=state.doc.rig.bones[end].parent,root=state.doc.rig.bones[mid].parent,name=prompt(`Chain name for ${root} → ${mid} → ${end}`,uniqueObjectName(state.doc.rig.ik_chains||{},'chain'));if(!name||!validName(name)||state.doc.rig.ik_chains?.[name])return;checkpoint();(state.doc.rig.ik_chains??={})[name]={root,mid,end};state.selectedChain=name;changed();}
function renameChain(){const old=state.selectedChain;if(!old)return;const name=prompt('Rename IK chain',old);if(!name||name===old||!validName(name)||state.doc.rig.ik_chains[name])return;checkpoint();state.doc.rig.ik_chains=renameMapKey(state.doc.rig.ik_chains,old,name);Object.values(state.doc.animations).forEach(c=>{if(c.ik?.[old])c.ik=renameMapKey(c.ik,old,name);});state.selectedChain=name;changed();}
function deleteChain(){const name=state.selectedChain;if(!name)return;const refs=Object.entries(state.doc.animations).filter(([,c])=>c.ik?.[name]).map(([n])=>n);if(refs.length)return alert('Remove IK tracks first: '+refs.join(', '));checkpoint();delete state.doc.rig.ik_chains[name];state.selectedChain=null;changed();}
function addClip(){const name=prompt('New clip name',uniqueObjectName(state.doc.animations,'clip'));if(!name||!validName(name)||state.doc.animations[name])return;checkpoint();const hadExplicit=Array.isArray(state.doc.export.animations);state.doc.animations[name]={frames:8,fps:10,loop:true,bones:{},ik:{}};if(hadExplicit)state.doc.export.animations.push(name);state.selectedClip=name;changed();}
function duplicateClip(){const old=state.selectedClip,name=prompt('Duplicate clip as',uniqueObjectName(state.doc.animations,old));if(!name||!validName(name)||state.doc.animations[name])return;checkpoint();state.doc.animations[name]=clone(state.doc.animations[old]);state.selectedClip=name;changed();}
function renameClip(){const old=state.selectedClip,name=prompt('Rename clip',old);if(!name||name===old||!validName(name)||state.doc.animations[name])return;checkpoint();state.doc.animations=renameMapKey(state.doc.animations,old,name);if(state.doc.export.animations)state.doc.export.animations=state.doc.export.animations.map(v=>v===old?name:v);state.selectedClip=name;changed();}
function deleteClip(){if(Object.keys(state.doc.animations).length===1)return alert('At least one clip must remain.');if(!confirm(`Delete ${state.selectedClip}?`))return;checkpoint();const removed=state.selectedClip;delete state.doc.animations[removed];if(state.doc.export.animations){state.doc.export.animations=state.doc.export.animations.filter(v=>v!==removed);if(!state.doc.export.animations.length)state.doc.export.animations=[Object.keys(state.doc.animations)[0]];}state.selectedClip=Object.keys(state.doc.animations)[0];changed();}
function deleteCurrentKey(){const keys=authoredTrack(),frame=+$('frame').value;if(!keys)return;const i=keys.findIndex(k=>k.frame===frame);if(i<0)return;checkpoint();keys.splice(i,1);changed();}
function navigateKey(direction){const keys=authoredTrack()||[],frame=+$('frame').value,candidates=keys.map(k=>k.frame).filter(f=>direction<0?f<frame:f>frame);if(!candidates.length)return;const next=direction<0?Math.max(...candidates):Math.min(...candidates);$('frame').value=next;$('frameValue').value=next;renderRig();schedulePreview(0);}
async function updateRigPreview(redraw=true){if(!state.valid||state.workspace==='parts')return;const payload={document:state.doc,mode:state.workspace==='animate'?'animate':'rest',clip:state.selectedClip,frame:+$('frame').value,direction:+$('yaw').value};try{const body=await(await request('/api/rig/preview',{method:'POST',body:JSON.stringify(payload)})).json();$('rigImage').src='data:image/png;base64,'+body.png;state.overlay=body.overlay;if(redraw)drawOverlay();}catch(error){$('rigErrorBanner').textContent=error.message;$('rigErrorBanner').classList.remove('hidden');}}
function drawOverlay(){const svg=$('rigOverlay'),g=state.overlay;if(!g)return;svg.setAttribute('viewBox',`0 0 ${g.width} ${g.height}`);svg.replaceChildren();const byName=Object.fromEntries(g.bones.map(b=>[b.name,b])),chainLinks={};g.chains.forEach(c=>{chainLinks[c.mid]=c.color;chainLinks[c.end]=c.color;});g.bones.forEach(b=>{if(!b.parent)return;const p=byName[b.parent],line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',p.x);line.setAttribute('y1',p.y);line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);line.setAttribute('class','rig-link'+(chainLinks[b.name]?' chain':''));if(chainLinks[b.name])line.setAttribute('stroke',chainLinks[b.name]);svg.append(line);});g.chains.forEach(c=>{[c.target,c.pole].forEach((h,i)=>{if(!h)return;const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx',h.x);circle.setAttribute('cy',h.y);circle.setAttribute('r',String(i?2:2.5));circle.setAttribute('fill',c.color);circle.setAttribute('class','rig-handle');circle.onclick=()=>{state.selectedChain=c.name;state.selectedTrack=i?'pole':'target';renderRig();};bindRigDrag(circle,i?'pole':'target',c.name,h.depth);svg.append(circle);});});g.bones.forEach(b=>{const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx',b.x);circle.setAttribute('cy',b.y);circle.setAttribute('r',String(b.name===state.selectedBone?2.3:1.7));circle.setAttribute('class','rig-joint'+(b.name===state.selectedBone?' selected':''));circle.onclick=()=>{state.selectedBone=b.name;state.selectedChain=null;renderRig();};bindRigDrag(circle,'joint',b.name,b.depth);svg.append(circle);const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x',b.x+2.5);text.setAttribute('y',b.y-2);text.setAttribute('class','rig-label');text.textContent=b.name;svg.append(text);});}
function bindRigDrag(element,kind,name,depth){element.onpointerdown=e=>{e.preventDefault();e.stopPropagation();checkpoint();const pointerId=e.pointerId;element.setPointerCapture(pointerId);let pending=false,latest=null;const apply=async()=>{if(pending||!latest)return;pending=true;const screen=latest;latest=null;try{const body=await(await request('/api/rig/drag',{method:'POST',body:JSON.stringify({document:state.doc,kind,name,screen,depth,direction:+$('yaw').value,mode:state.workspace==='animate'?'animate':'rest',clip:state.selectedClip,frame:+$('frame').value})})).json();state.doc=body.document;state.dirty=true;state.valid=true;renderBoneInspector();renderTimeline();await updateRigPreview(false);}catch(error){showError(error.message);}finally{pending=false;if(latest)apply();}};element.onpointermove=move=>{if(!element.hasPointerCapture(move.pointerId))return;const rect=$('rigOverlay').getBoundingClientRect(),screen=[(move.clientX-rect.left)*state.overlay.width/rect.width,(move.clientY-rect.top)*state.overlay.height/rect.height];latest=screen;element.setAttribute('cx',screen[0]);element.setAttribute('cy',screen[1]);apply();};const finish=async()=>{element.onpointermove=null;element.onpointerup=null;element.onpointercancel=null;if(element.hasPointerCapture(pointerId))element.releasePointerCapture(pointerId);while(pending||latest)await new Promise(resolve=>setTimeout(resolve,10));changed();await updateRigPreview(true);};element.onpointerup=finish;element.onpointercancel=finish;};}

document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button=>button.onclick=()=>{state.tool=button.dataset.tool;document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b=>b.classList.toggle('active',b===button));});
document.querySelectorAll<HTMLElement>('[data-mode]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.mode;renderPreviewControls();schedulePreview(0);});
document.querySelectorAll<HTMLElement>('[data-workspace]').forEach(button=>button.onclick=()=>setWorkspace(button.dataset.workspace));
['front','side','back'].forEach(bindCanvas);
$('addPart').onclick=addPart;$('duplicatePart').onclick=duplicatePart;$('renamePart').onclick=renamePart;$('deletePart').onclick=deletePart;$('resizePart').onclick=resizePart;$('addColor').onclick=addColor;
$('undoButton').onclick=undo;$('redoButton').onclick=redo;$('saveButton').onclick=save;
$('newProjectButton').onclick=newProject;
$('addExportDirection').onclick=addExportDirection;
$('exportZipButton').onclick=async()=>{if(!state.valid)return;try{$('status').textContent='Exporting…';await exportProjectZip(state.doc,p=>{$('status').textContent=`Exporting ${p}%`;});$('status').textContent='Export ready';}catch(error){showError(error.message);}};
$('undoButtonRig').onclick=undo;$('redoButtonRig').onclick=redo;$('addBone').onclick=addBone;$('renameBone').onclick=renameBone;$('reparentBone').onclick=reparentBone;$('deleteBone').onclick=deleteBone;$('addChain').onclick=addChain;$('renameChain').onclick=renameChain;$('deleteChain').onclick=deleteChain;$('addClip').onclick=addClip;$('duplicateClip').onclick=duplicateClip;$('renameClip').onclick=renameClip;$('deleteClip').onclick=deleteClip;$('deleteKey').onclick=deleteCurrentKey;$('previousKey').onclick=()=>navigateKey(-1);$('nextKey').onclick=()=>navigateKey(1);$('viewFront').onclick=()=>{$('yaw').value=0;$('yaw').dispatchEvent(new Event('input'));};$('viewSide').onclick=()=>{$('yaw').value=90;$('yaw').dispatchEvent(new Event('input'));};
$('yaw').oninput=()=>{$('yawValue').value=$('yaw').value+'°';schedulePreview();if(state.workspace!=='parts')updateRigPreview();};$('clip').onchange=()=>{state.selectedClip=$('clip').value;renderPreviewControls();renderRig();schedulePreview(0);};$('frame').oninput=()=>{$('frameValue').value=$('frame').value;renderTimeline();renderBoneInspector();schedulePreview();if(state.workspace!=='parts')updateRigPreview();};
$('play').onclick=()=>{if(state.playing){clearInterval(state.playing);state.playing=null;$('play').textContent='Play';return;}const spec=state.doc.animations[$('clip').value];$('play').textContent='Pause';state.playing=setInterval(()=>{$('frame').value=(+$('frame').value+1)%spec.frames;$('frameValue').value=$('frame').value;schedulePreview(0);},1000/spec.fps);};
window.addEventListener('keydown',event=>{if(['INPUT','SELECT','TEXTAREA'].includes((event.target as HTMLElement).tagName))return;const key=event.key.toLowerCase();if((event.ctrlKey||event.metaKey)&&key==='s'){event.preventDefault();save();}else if((event.ctrlKey||event.metaKey)&&key==='z'){event.preventDefault();event.shiftKey?redo():undo();}else if((event.ctrlKey||event.metaKey)&&key==='y'){event.preventDefault();redo();}else {const map={p:'pencil',e:'eraser',f:'fill',i:'eyedropper'};if(map[key])document.querySelector<HTMLElement>(`[data-tool=${map[key]}]`)?.click();}});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});

const welcome=$('welcome');
$('welcomeNew').onclick=()=>{sessionStorage.setItem('impossibru-project',JSON.stringify(starterProject('untitled')));welcome.classList.add('hidden');location.reload();};
$('welcomeOpen').onclick=async()=>{const opened=await openProject();if(opened)location.reload();};
$('welcomeRecover').onclick=async()=>{if(await recoverDraft())location.reload();};
$('welcomeExample').onclick=async()=>{const text=await (await fetch('./example.yaml')).text();sessionStorage.setItem('impossibru-yaml',text);location.reload();};
if(token||sessionStorage.getItem('impossibru-project')||sessionStorage.getItem('impossibru-yaml'))welcome.classList.add('hidden');

load();
