var ControlUI = (function () {
  var defaults = {
    mesh: { speed:1, sensitivity:2.5, amplitude:1, bloom:0.7, density:200, idle_motion:0.6, symmetry:true,
      color_near:'#ee0090', color_mid:'#ef05ff', color_far:'#0001ff', color_sunset:'#ff5505', color_wave:'#ffffff' },
    ribbon: JSON.parse(JSON.stringify(WE_Ribbon.params)),
    scene: { cameraOrbit:true, cameraSpeed:0.002, cameraJump:true, cameraJumpInterval:8, cameraJumpDuration:1, cameraRadius:11, cameraHeight:4.8 }
  };
  var initial = JSON.parse(JSON.stringify(defaults));
  var active = 'mesh';
  var controlRoot = document.getElementById('controls');
  var schema = {
    mesh: [
      ['波场', [['speed','波动速度',.1,4,.1],['sensitivity','音频灵敏度',.5,6,.1],['amplitude','波动幅度',.2,3,.1],['idle_motion','待机运动',0,1,.1],['symmetry','镜像对称','bool']]],
      ['渲染', [['bloom','辉光强度',0,1.5,.0005],['density','渲染分辨率 %',50,250,10]]],
      ['配色', [['color_near','近景颜色','color'],['color_mid','中景颜色','color'],['color_far','远景颜色','color'],['color_sunset','地平线雾色','color'],['color_wave','波峰闪光','color']]]
    ],
    ribbon: [
      ['运动', [['animate','启用动画','bool'],['ribbonSpeed','自动游走速度',0,.01,.00005],['ribbonLength','丝带长度',100,1200,25],['seed','随机种子',0,10000,.1]]],
      ['材质', [['visible','显示丝带','bool'],['wireframe','线框模式','bool'],['confettiCount','彩片数量',0,300,5]]],
      ['音频响应', [['audioSync','丝带音频同步','bool'],['audioMotionThreshold','音频能量下限（阈值）',0,5,.01],['audioEnergyMax','音频能量上限',.01,20,.01],['audioSpeedMin','映射速度下限',0,.01,.00005],['audioSpeedMax','映射速度上限',0,.01,.00005],['listenStrength','音频监听强度',.01,3,.005],['rgbShift','色差偏移','bool'],['rgbShiftSensitivity','推拉 / 色差能量下限',0,10,.01],['sharedTriggerMax','推拉 / 色差能量上限',.01,20,.01],['rgbShiftScale','色差映射上限',0,8,.05],['glow','丝带发光','bool'],['glowSizeScale','发光尺寸幅度',0,1.5,.0005],['glowAmountScale','发光强度幅度',0,.6,.0005],['tiltAudio','倾斜响应','bool'],['tiltScale','倾斜幅度',.01,2,.01],['noiseEnabled','噪点','bool'],['noiseScale','噪点幅度',.01,1,.01],['bloomAudio','灯光响应','bool'],['bloomScale','灯光幅度',.05,1.5,.005],['starsAudio','星辰能量响应','bool'],['starEnergyThreshold','星辰能量下限（全黑）',0,1,.005],['starEnergyMax','星辰能量上限（最亮）',.01,1,.005],['cameraDrop','镜头推拉','bool'],['cameraDropScale','推拉幅度',0,3,.025],['cameraDropSpeed','推拉速度',.25,12,.05]]],
      ['构图', [['spread','分布范围',.45,1,.01],['scale','整体缩放',.004,.03,.001],['starCenterRadius','星辰中心稀疏半径',0,500,5],['starCenterDensity','星辰中心密度',0,1,.01],['positionX','X 位置',-30,30,.1],['positionY','Y 位置',-10,25,.1],['positionZ','Z 位置',-35,10,.1]]]
    ],
    scene: [['镜头运动', [['cameraOrbit','慢速环绕','bool'],['cameraSpeed','环绕速度',0,.005,.0001],['cameraJump','自动切换角度','bool'],['cameraJumpInterval','切换间隔',4,20,.5],['cameraJumpDuration','切换时长',.25,2,.05],['cameraRadius','环绕半径',4,24,.1],['cameraHeight','镜头高度',0.1,15,.1]]]]
  };

  function hexToRgb(hex) { var n=parseInt(hex.slice(1),16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; }
  function setMesh(key, value) {
    if (key.indexOf('color_') === 0) {
      var c=hexToRgb(value), setters={color_near:'setNearColor',color_mid:'setMidColor',color_far:'setFarColor',color_sunset:'setSunsetColor',color_wave:'setWaveColor'};
      WE_Terrain[setters[key]](c[0],c[1],c[2]);
    } else {
      window.WE_Props[key]=value;
      if (key === 'density') WE_Scene.setRenderScale(value/100);
    }
  }
  function update(key, value) {
    if (active === 'mesh') { defaults.mesh[key]=value; setMesh(key,value); }
    else if (active === 'ribbon') { WE_Ribbon.params[key]=value; WE_Ribbon.applyParams(); if (key === 'seed' || key === 'spread' || key === 'ribbonLength' || key === 'confettiCount' || key === 'starCenterRadius' || key === 'starCenterDensity') WE_Ribbon.rebuild(); }
    else defaults.scene[key]=value;
  }
  function fill(range) { range.style.setProperty('--fill', ((range.value-range.min)/(range.max-range.min)*100)+'%'); }
  function makeControl(item) {
    var key=item[0], label=item[1], type=item[2], value=active==='ribbon'?WE_Ribbon.params[key]:defaults[active][key];
    if (type === 'bool') {
      var row=document.createElement('label'); row.className='switch-line'; row.innerHTML='<span>'+label+'</span><span class="switch"><input type="checkbox" '+(value?'checked':'')+'><span></span></span>';
      row.querySelector('input').addEventListener('change',function(e){update(key,e.target.checked);}); return row;
    }
    if (type === 'color') {
      var color=document.createElement('label'); color.className='color-line'; color.innerHTML='<span>'+label+'</span><input type="color" value="'+value+'">';
      color.querySelector('input').addEventListener('input',function(e){update(key,e.target.value);}); return color;
    }
    var wrap=document.createElement('div'); wrap.className='control';
    wrap.innerHTML='<div class="control-line"><label>'+label+'</label><input class="value" type="number" min="'+type+'" max="'+item[3]+'" step="'+item[4]+'" value="'+value+'"></div><input type="range" min="'+type+'" max="'+item[3]+'" step="'+item[4]+'" value="'+value+'">';
    var number=wrap.querySelector('.value'), range=wrap.querySelector('input[type=range]'); fill(range);
    function commit(v){
      v=parseFloat(v); if(isNaN(v))return;
      v=Math.max(parseFloat(range.min),Math.min(parseFloat(range.max),v));
      number.value=v; range.value=v; fill(range); update(key,v);
    }
    range.addEventListener('input',function(){commit(this.value);}); number.addEventListener('change',function(){commit(this.value);}); return wrap;
  }
  function render() {
    controlRoot.innerHTML='';
    schema[active].forEach(function(group){var el=document.createElement('section'); el.className='group'; el.innerHTML='<h2 class="group-title">'+group[0]+'</h2>'; group[1].forEach(function(item){el.appendChild(makeControl(item));}); controlRoot.appendChild(el);});
  }
  function makePreset() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      mesh: JSON.parse(JSON.stringify(defaults.mesh)),
      ribbon: JSON.parse(JSON.stringify(WE_Ribbon.params)),
      scene: JSON.parse(JSON.stringify(defaults.scene))
    };
  }
  function applyPreset(preset) {
    if (!preset || typeof preset !== 'object') throw new Error('预设内容无效');
    if (preset.mesh && typeof preset.mesh === 'object') {
      Object.keys(defaults.mesh).forEach(function(k){
        if (Object.prototype.hasOwnProperty.call(preset.mesh,k)) {
          defaults.mesh[k]=preset.mesh[k]; setMesh(k,preset.mesh[k]);
        }
      });
    }
    if (preset.ribbon && typeof preset.ribbon === 'object') {
      Object.keys(WE_Ribbon.params).forEach(function(k){
        if (Object.prototype.hasOwnProperty.call(preset.ribbon,k)) WE_Ribbon.params[k]=preset.ribbon[k];
      });
      WE_Ribbon.rebuild();
    }
    if (preset.scene && typeof preset.scene === 'object') {
      Object.keys(defaults.scene).forEach(function(k){
        if (Object.prototype.hasOwnProperty.call(preset.scene,k)) defaults.scene[k]=preset.scene[k];
      });
    }
    render();
  }

 return {state:defaults, makePreset:makePreset, applyPreset:applyPreset, schema:schema, set:function(section,key,value){active=section;update(key,value);}};
})();
