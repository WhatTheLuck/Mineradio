'use strict';
// Original renderers run in an isolated same-origin canvas to preserve their Three.js,
// camera, postprocessing and WebGL versions independently of the lyric stage.
var MineradioExternalVisuals = (function () {
  var catalog, values={}, frames={}, active='', ready={}, panels={}, pending={};
  var base='vendor/source-visuals/';
  var starfieldTriggerDefaults={triggerMode:'bass-threshold',rmsSensitivity:1,rmsMinThreshold:.008,rmsFloorMultiplier:1.34,rmsCrestRatio:.34,rmsCooldown:.14,rmsPeakWindow:.22,rmsDecay:7.2,rmsInputMin:.5,rmsInputMax:.8};
  ['pointermove','pointerdown','pointerleave'].forEach(function(type){window.addEventListener(type,function(event){var api=visualApi(active);if(active!=='space'||!api||!api.pointer)return;var blocked=event.target.closest&&event.target.closest('button,input,select,#fx-panel,#bottom-bar,.modal-mask');var box=frames.space.getBoundingClientRect();api.pointer(blocked||type==='pointerleave'?'leave':type==='pointerdown'?'down':'move',{clientX:event.clientX-box.left,clientY:event.clientY-box.top,preventDefault:function(){}});},{passive:true});});
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function visualApi(kind){return frames[kind]&&frames[kind].contentWindow.sourceVisual;}
  function snapshot(kind){return visualApi(kind)?visualApi(kind).snapshot():values[kind];}
  function apply(kind,value){values[kind]=complete(kind,value);if(visualApi(kind))visualApi(kind).apply(values[kind]);renderBody(kind);}
  function complete(kind,value){var result=clone(value);if(kind==='space'){result.visual=Object.assign({},catalog.defaults.space.visual,result.visual);result.audio=Object.assign({},catalog.defaults.space.audio,result.audio);result.starfield=Object.assign({},starfieldTriggerDefaults,result.starfield);}return result;}
  function sampleBand(data,sampleRate,fftSize,from,to){var lo=Math.max(0,Math.floor(from*fftSize/sampleRate)),hi=Math.min(data.length-1,Math.ceil(to*fftSize/sampleRate)),sum=0;for(var i=lo;i<=hi;i++)sum+=data[i]||0;return sum/Math.max(1,hi-lo+1)/255;}
  function ensure(kind){
    if(frames[kind])return;
    var frame=document.createElement('iframe');frame.title=kind==='cyber'?'赛博丝带':'磁流体';frame.className='source-visual-frame';frame.src=base+kind+'/index.html';frame.setAttribute('aria-hidden','true');
    document.getElementById('canvas-container').prepend(frame);frames[kind]=frame;
  }
  window.addEventListener('source-visual-ready',function(event){var kind=event.detail;if(!frames[kind]||!visualApi(kind))return;ready[kind]=true;visualApi(kind).apply(values[kind]);renderBody(kind);});
  function setParameter(kind,key,value){
    var parts=key.split('.'),state=snapshot(kind),section=parts[0],field=parts[1];
    if(!state[section])state[section]={};state[section][field]=value;values[kind]=state;
    if(visualApi(kind))visualApi(kind).set(section,field,value);
  }
  function syncControl(kind,key,value){var panel=panels[kind];if(!panel)return;panel.querySelectorAll('[data-external-parameter="'+key+'"] input').forEach(function(input){input.value=value;});}
  function control(kind,item){
    var parts=item[0].split('.'),state=values[kind],value=(state[parts[0]]||{})[parts[1]];
    if(value===undefined)return null;
    var row=document.createElement('label');row.className='external-range-control';row.setAttribute('data-external-parameter',item[0]);var title=document.createElement('span');title.textContent=item[1];row.append(title);
    var input=document.createElement('input');input.setAttribute('aria-label',item[1]);
    if(item[2]==='bool'){input.type='checkbox';input.checked=!!value;input.onchange=function(){setParameter(kind,item[0],input.checked);};}
    else if(item[2]==='select'){input=document.createElement('select');input.setAttribute('aria-label',item[1]);input.style.gridColumn='1 / -1';input.style.width='100%';(item[3]||[]).forEach(function(option){input.append(new Option(option[1],option[0]));});input.value=String(value);input.onchange=function(){setParameter(kind,item[0],input.value);};}
    else if(item[2]==='color'){input.type='color';input.value=Array.isArray(value)?'#'+value.map(function(v){return Math.round(v*255).toString(16).padStart(2,'0');}).join(''):value;input.oninput=function(){var v=input.value;setParameter(kind,item[0],Array.isArray(value)?[1,3,5].map(function(i){return parseInt(v.slice(i,i+2),16)/255;}):v);};}
    else {input.type='range';input.min=item[2];input.max=item[3];input.step=item[4];input.value=value;var number=document.createElement('input');number.type='number';number.className='external-number';number.min=input.min;number.max=input.max;number.step=input.step;number.value=value;number.setAttribute('aria-label',item[1]+'数值');
      function commit(raw){if(!isFinite(Number(raw)))return;var v=Math.max(Number(input.min),Math.min(Number(input.max),Number(raw)));input.value=number.value=v;setParameter(kind,item[0],v);}
      input.oninput=function(){commit(input.value);};number.onchange=function(){commit(number.value);};row.append(number);
    }
    row.append(input);return row;
  }
  function renderBody(kind){
    if(!panels[kind])return;var body=panels[kind].querySelector('.external-visual-body');var open=Array.from(body.querySelectorAll('details')).map(function(d){return d.open;});body.textContent='';
    catalog.schema[kind].forEach(function(group,index){var details=document.createElement('details');details.className='external-visual-group';details.open=open[index]===undefined?index===0:open[index];var summary=document.createElement('summary');summary.textContent=group[0];details.append(summary);var content=document.createElement('div');content.className='external-visual-group-body';group[1].forEach(function(item){var node=control(kind,item);if(node)content.append(node);});details.append(content);body.append(details);});
  }
  function status(kind,text){panels[kind].querySelector('[role=status]').textContent=text;}
  function sourcePresetNames(kind){return catalog&&Array.isArray(catalog[kind])?catalog[kind].map(function(item){return item.name;}):[];}
  function applySourcePreset(kind,index){
    if(!catalog||!Array.isArray(catalog[kind]))return '';
    var preset=catalog[kind][Number(index)];if(!preset)return '';
    var value=clone(preset.value);if(kind==='space')value.starfield=clone(values.space.starfield);
    apply(kind,value);
    var original=panels[kind]&&panels[kind].querySelector('[data-original]');if(original)original.value=String(index);
    if(panels[kind])status(kind,'已加载'+(kind==='space'?'磁流体预设':'彩带预设')+'：'+preset.name);
    window.dispatchEvent(new CustomEvent('mineradio-external-preset-change',{detail:{kind:kind,index:Number(index),name:preset.name}}));
    return preset.name;
  }
  async function list(kind,autoLoadLatest){
    var bridge=window.desktopWindow;
    if(!bridge||!bridge.visualPresets){status(kind,'文件保存需要桌面版');return;}
    var result=await bridge.visualPresets('list',kind);if(!result.ok)throw new Error(result.error);
    var select=panels[kind].querySelector('[data-saved]');select.textContent='';
    var placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=result.items&&result.items.length?'选择后直接加载':'暂无已保存参数';select.append(placeholder);
    (result.items||[]).forEach(function(item){var option=document.createElement('option');option.value=item.name;option.textContent=item.name;select.append(option);});
    select.disabled=!(result.items&&result.items.length);
    if(autoLoadLatest&&result.items&&result.items.length){select.value=result.items[0].name;await load(kind);status(kind,'已自动加载最新参数：'+result.items[0].name);}
    else if(autoLoadLatest)status(kind,'暂无已保存参数，使用内置默认值');
  }
  async function load(kind){var name=panels[kind].querySelector('[data-saved]').value;if(!name)return;var result=await window.desktopWindow.visualPresets('read',kind,name);if(!result.ok)throw new Error(result.error);apply(kind,result.value);status(kind,'已加载：'+name);}
  function panel(kind){
    var shell=document.createElement('details');shell.className='external-visual-panel';
    shell.id='external-'+kind+'-panel';
    shell.open=true;
    var heading=document.createElement('summary');heading.textContent=kind==='cyber'?'丝带参数':'磁流体参数';shell.append(heading);
    var el=document.createElement('section');el.className='external-visual-column';panels[kind]=el;
    var sourceLabel=kind==='cyber'?'彩带预设':'磁流体预设';
    el.innerHTML='<label>'+sourceLabel+'<select data-original aria-label="'+sourceLabel+'"></select></label><div class="external-save-block"><label for="external-'+kind+'-preset-name">保存当前参数的名称</label><div class="external-save-row"><input id="external-'+kind+'-preset-name" data-name maxlength="64" placeholder="输入名称"><button type="button" class="fx-mini-btn" data-save>保存参数</button></div></div><label>已保存参数<select data-saved aria-label="已保存参数"></select></label><div role="status" class="external-visual-status"></div><div class="external-visual-body"></div>';
    shell.append(el);
    var select=el.querySelector('[data-original]');catalog[kind].forEach(function(p,index){var option=document.createElement('option');option.value=index;option.textContent=p.name;select.append(option);});
    select.value=catalog[kind].findIndex(function(p){return p.name===(kind==='cyber'?'4':'Venom');});
    select.onchange=function(){applySourcePreset(kind,select.value);};
    el.querySelector('[data-saved]').onchange=function(){if(!this.value)return;load(kind).catch(function(e){status(kind,'加载失败：'+e.message);});};
    el.querySelector('[data-save]').onclick=async function(){var button=this;button.disabled=true;try{if(!window.desktopWindow||!window.desktopWindow.visualPresets)throw new Error('请在桌面版保存');var result=await window.desktopWindow.visualPresets('save',kind,el.querySelector('[data-name]').value,snapshot(kind));if(!result.ok)throw new Error(result.error);await list(kind,false);status(kind,'已保存到 '+result.directory);}catch(e){status(kind,'保存失败：'+e.message);}finally{button.disabled=false;}};
    return shell;
  }
  var slots={};
  ['cyber','space'].forEach(function(kind){var slot=document.createElement('div');slot.id='external-'+kind+'-controls';slot.className='external-visual-controls';document.getElementById('fx-panel').append(slot);slots[kind]=slot;});
  Promise.all([
    fetch(base+'catalog.json').then(function(r){if(!r.ok)throw new Error('无法加载原始预设');return r.json();}),
    fetch(base+'software-defaults.json').then(function(r){if(!r.ok)throw new Error('无法加载软件默认参数');return r.json();})
  ]).then(async function(result){
    var data=result[0],softwareDefaults=result[1]||{};
    var starfieldGroup=data.schema.space.find(function(group){return group[0]==='低频星域';});
    if(starfieldGroup)starfieldGroup[1].unshift(
      ['starfield.triggerMode','星空触发模式','select',[['bass-threshold','低频阈值'],['rms-peak','RMS 峰值']]],
      ['starfield.rmsSensitivity','RMS 峰值灵敏度',.4,2.5,.05],
      ['starfield.rmsMinThreshold','RMS 最低触发阈值',0,.2,.001],
      ['starfield.rmsFloorMultiplier','RMS 动态底噪倍率',.5,3,.01],
      ['starfield.rmsCrestRatio','RMS 历史峰值比例',.05,1,.01],
      ['starfield.rmsCooldown','RMS 触发冷却（秒）',.04,1,.01],
      ['starfield.rmsPeakWindow','RMS 峰值确认窗口（秒）',.05,1,.01],
      ['starfield.rmsDecay','RMS 峰值衰减速度',.5,20,.1],
      ['starfield.rmsInputMin','RMS 强度映射下限',0,1,.001],
      ['starfield.rmsInputMax','RMS 强度映射上限',0,1,.001]
    );
    catalog=data;values.cyber=clone(softwareDefaults.cyber||data.cyber.find(function(p){return p.name==='4';}).value);
    values.space=complete('space',softwareDefaults.space||data.space.find(function(p){return p.name==='Venom';}).value);
    values.space.starfield=Object.assign({},starfieldTriggerDefaults,clone((softwareDefaults.space&&softwareDefaults.space.starfield)||(data.stars.find(function(p){return p.name==='Star';})||data.stars[0]).value.starfield));
    slots.cyber.append(panel('cyber'));slots.space.append(panel('space'));renderBody('cyber');renderBody('space');
    window.dispatchEvent(new CustomEvent('mineradio-external-presets-ready'));
    await Promise.all(['cyber','space'].map(function(kind){return list(kind,true).catch(function(e){status(kind,'自动加载失败：'+e.message);});}));
  }).catch(function(e){console.error('Visual presets:',e.message);});
  var lastAudio=0,waveform,visualAnalyser,visualSource,bins;
  window.addEventListener('wheel',function(event){
    if(active!=='space'||!values.space||!values.space.visual)return;
    if(event.target&&event.target.closest&&event.target.closest('button,input,select,textarea,#fx-panel,#bottom-bar,.modal-mask,#playlist-panel'))return;
    var current=Number(values.space.visual.cameraDistance)||6.54;
    var next=Math.max(.1,Math.min(20,current*Math.exp(Number(event.deltaY||0)*.0012)));
    setParameter('space','visual.cameraDistance',next);
    syncControl('space','visual.cameraDistance',Math.round(next*100)/100);
    status('space','滚轮缩放 · '+Math.round((6.54/next)*100)+'%');
    event.preventDefault();
  },{passive:false});
  function update(dt,frame){
    if(!catalog)return;var kind=Number(frame.fx.preset)===13?'cyber':Number(frame.fx.preset)===14?'space':'';
    if(kind!==active){if(active&&frames[active]){values[active]=snapshot(active);frames[active].remove();delete frames[active];delete ready[active];}active=kind;if(kind)ensure(kind);}
    if(!kind||!ready[kind]||(kind==='cyber'&&performance.now()-lastAudio<1000/30))return;lastAudio=performance.now();
    var level=0;
    if(typeof audioCtx!=='undefined'&&audioCtx&&typeof source!=='undefined'&&source){
      if(visualSource!==source){if(visualSource&&visualAnalyser){try{visualSource.disconnect(visualAnalyser);}catch(e){}}visualAnalyser=audioCtx.createAnalyser();visualAnalyser.smoothingTimeConstant=0;visualSource=source;source.connect(visualAnalyser);}
      var requested=kind==='space'?Number((values.space.audio||{}).fftSize)||2048:2048;
      if(visualAnalyser.fftSize!==requested)visualAnalyser.fftSize=requested;
      if(!bins||bins.length!==visualAnalyser.frequencyBinCount)bins=new Uint8Array(visualAnalyser.frequencyBinCount);
      visualAnalyser.getByteFrequencyData(bins);frame.frequencyData=bins;frame.fftSize=visualAnalyser.fftSize;
    }
    var meter=visualAnalyser||(typeof analyser!=='undefined'?analyser:null);
    if(meter){if(!waveform||waveform.length!==meter.fftSize)waveform=new Uint8Array(meter.fftSize);meter.getByteTimeDomainData(waveform);for(var i=0;i<waveform.length;i++)level+=Math.pow((waveform[i]-128)/128,2);level=Math.sqrt(level/waveform.length);}
    visualApi(kind).audio({frequencyData:frame.frequencyData,sampleRate:frame.sampleRate,fftSize:frame.fftSize,playing:frame.playing,level:level});
  }
  function rotate(dx,dy){var api=visualApi(active);if(!api||!api.rotate)return false;api.rotate(Number(dx)||0,Number(dy)||0);return true;}
  function invalidateAudioSource(){
    if(visualSource&&visualAnalyser){try{visualSource.disconnect(visualAnalyser);}catch(e){}}
    visualSource=null;visualAnalyser=null;bins=null;waveform=null;lastAudio=0;
  }
  return {update:update,rotate:rotate,invalidateAudioSource:invalidateAudioSource,setParameter:setParameter,sourcePresetNames:sourcePresetNames,applySourcePreset:applySourcePreset,sampleBand:sampleBand,mapLinearClamped:function(v,a,b,c,d){return c+(d-c)*Math.max(0,Math.min(1,(v-a)/(b-a)));}};
})();
