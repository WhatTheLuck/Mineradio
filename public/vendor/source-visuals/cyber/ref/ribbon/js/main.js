/* global THREE, SimplexNoise, Stats, Events, dat, window, document, Power2,
requestAnimationFrame, Stars , Confetti , Ribbon , ATUtil , TweenMax , RIBBON_LEN */


/*

	Procedural Ribbons

	(c) @felixturner / www.airtight.cc

*/


var seed = Math.random()* 10000;

//some nice seeds
//seed = 6702.011744602003;
//seed = 8371.247929504061;
//seed = 74.20897096757307
//seed = 7331.417626086938;
//seed = 1666.0390875061482;

console.log('RANDOM SEED:', seed);
Math.seedrandom(seed);

var noise = new SimplexNoise();
var events = new Events();
var BOUNDS = 1000; //bounded space goes from - BOUNDS to +BOUNDS
var ribbons = [];
var ribbonGrpIds = [0,0,0,0,1,1,1,2,3,4]; //GOOD
var RIBBON_COUNT = ribbonGrpIds.length;
var tiltSpeed = 0.0002;
var rotRng = Math.PI ;
var noiseTime = 0;//Math.random()*1000;
var camera, scene, renderer;
var stats, controls;
var lightHolder;
var lights = [];
var stars;
var worldHolder;
var boundsMesh;
var boundsHolder;
var ribbonHolder;
var ppo = {};
var composer;
var guiParams;
var tiltTime = 0;
var outerHolder;
var isDev = false;
var gui;
var canvas;

function init() {

	//isDev = window.location.href.indexOf('?dev') > -1;
	//isDev = true;

	noiseTime = Math.random()*1000;

	initGUI();

	//INIT THREEJS WORLD
	camera = new THREE.PerspectiveCamera( 65, window.innerWidth / window.innerHeight, 1, 10000 );
	camera.position.z = 700;
	scene = new THREE.Scene();

	renderer = new THREE.WebGLRenderer({ antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	document.querySelector('.webgl').appendChild( renderer.domElement );

	outerHolder = new THREE.Group();
	scene.add(outerHolder);

	worldHolder = new THREE.Group();
	outerHolder.add(worldHolder);

	//STATS
	stats = new Stats();
	stats.domElement.style.position = 'absolute';
	stats.domElement.style.top = '0px';
	document.querySelector('.webgl').appendChild( stats.domElement );
	
	
	
	
	
	

	//CONTROLS
	controls = new THREE.OrbitControls( camera, renderer.domElement );
	controls.minDistance = 250;
	controls.maxDistance = 1800;

	//CREATE RIBBONS
	ribbonHolder = new THREE.Group();
	worldHolder.add(ribbonHolder);

	for (var i = 0; i < RIBBON_COUNT; i++) {
		var r = new Ribbon();
		r.init(ribbonHolder,ribbonGrpIds[i]*100 + i + noiseTime);
		ribbons.push(r);
	}

	//do RIBBON_LEN updates to create init ribbons
	for ( i = 0; i < RIBBON_LEN; i ++ ) {
		ribbons.forEach(function(ribbon){
			ribbon.update();
		});
		noiseTime += guiParams.ribbonSpeed;
	}

	//ADD STARS
	stars = new Stars();
	stars.init(worldHolder);

	//ADD CONFETTI
	var confetti = new Confetti();
	confetti.init(worldHolder);

	//ADD BOUNDS BOX
	boundsHolder = new THREE.Group();
	worldHolder.add( boundsHolder );
	var boundsMaterial = new THREE.MeshBasicMaterial( { color: 0xAA0000 , wireframe: true} );
	var boundsGeom  = new THREE.BoxGeometry( BOUNDS*2, BOUNDS*2, BOUNDS*2 );
	boundsMesh = new THREE.Mesh( boundsGeom, boundsMaterial );
	boundsHolder.add( boundsMesh );
	var gridHelper = new THREE.GridHelper( 1000, 10 , 0x00AA00, 0x888888);
	boundsHolder.add( gridHelper );

	addLights();

	initPostprocessing();

	window.addEventListener( 'resize', onResize, false );
	onResize();
	onParamsChange();

	setInterval(doJump,8000);

	//fadeup
	TweenMax.from(ppo.superPass.uniforms.brightness, 2, {value:-1});
	TweenMax.to(document.querySelector('.over'),2,{opacity:1, delay: 1});

	document.querySelector('.big-btn').onclick = function(){
		TweenMax.to(document.querySelector('.over'),0.5,{autoAlpha:0, delay: 0});
	};
	
	canvas = document.getElementById("debugCanvas");
	animate();
}

function initPostprocessing() {

	//create passes
	ppo.renderPass = new THREE.RenderPass( scene, camera );
	ppo.skyPass = new THREE.ShaderPass(THREE.SpaceShader);
	//FXAA smooths out jaggies
	ppo.fxaaPass = new THREE.ShaderPass( THREE.FXAAShader );
	ppo.rgbPass = new THREE.ShaderPass( THREE.CustomRGBShiftShader );
	//SuperPass adds glow and vignette
	ppo.superPass = new THREE.ShaderPass( THREE.SuperShader );
	ppo.noisePass = new THREE.ShaderPass( THREE.NoiseShader );
	ppo.tiltShiftPass = new THREE.ShaderPass( THREE.CustomTiltShiftShader );

	//Add passes to composer
	composer = new THREE.EffectComposer( renderer );

	composer.addPass( ppo.renderPass );
	composer.addPass( ppo.skyPass );
	composer.addPass( ppo.fxaaPass );
	composer.addPass( ppo.tiltShiftPass );
	composer.addPass( ppo.superPass );
	composer.addPass( ppo.rgbPass );
	composer.addPass( ppo.noisePass );

	ppo.noisePass.renderToScreen = true;

	onResize();

}

function addLights(){

	//LIGHTS
	var ambientLight = new THREE.AmbientLight( 0x333333 );
	scene.add( ambientLight );

	lights[ 0 ] = new THREE.PointLight( 0xffffff, 2, 700 ); //origin light
	lights[ 0 ].position.set( 0, 0, 0 );

	lights[ 1 ] = new THREE.PointLight( 0xffffff, 1, 1000 ); //cam light
	lights[ 1 ].position.set( 0, 0,  1000 );

	lights[ 2 ] = new THREE.DirectionalLight( 0xffffff, 1 ); //front light
	lights[ 2 ].position.set( 0, 0, 1 );

	lights[ 3 ] = new THREE.DirectionalLight( 0xffffff, 1 ); //up light
	lights[ 3 ].position.set( 0, 1, 0 );

	lightHolder = new THREE.Object3D();
	worldHolder.add(lightHolder);

	lights.forEach(function(light){
		lightHolder.add( light );
	});

}
var data = {
	fps: 0,
	eTilt: true,
	tiltScale: 1.0,
	eShift: true,
	dubScale: 1.0,
	dubChanSens: 10,
	eBloom: true,
	bloomScale: 1.0,
	eGlow: true,
	glowScale: 1.0,
	glowAmount: 0.3,
	eNoise: true,
	noiseScale: 0.08,
	mScale: 1.0,
	fastR: true,
	rspeed: true,
	rspeedScale: 1.0,
	eStars: true,
	eDrop: true
};
var last = performance.now() / 1000;
var fpsThreshold = 0;

function initGUI(){

	guiParams = {

		animate : true,
		autoRotate: true,
		showBounds: false,
		wireframe: false,
		ribbonSpeed: 0.001,
		usePostProc : true,

		//tiltshift
		tiltPos:	0,
		tiltRange:	1,
		tiltStrength: 0.6,
		tiltOffset: 0.02,

		//super
		glowAmount: 0.3,
		glowSize:2,
		vigOffset:1.3,
		saturation:0,
		contrast:0.0,
		brightness:0,
		rgbShiftAmount: 0.02,

		//noise
		noiseAmount: 0.08,
		noiseSpeed: 0.5,
		skyOpacity: 0.0
	};

	//INIT DAT GUI
	gui = new dat.GUI({autoPlace: isDev});

	var sceneFolder = gui.addFolder('Scene');

	sceneFolder.add(guiParams, 'animate');
	sceneFolder.add(guiParams, 'autoRotate').onChange( onParamsChange );
	sceneFolder.add(guiParams, 'showBounds').onChange( onParamsChange );
	sceneFolder.add(guiParams, 'wireframe').onChange( onParamsChange );
	sceneFolder.add(guiParams, 'ribbonSpeed', 0, 0.01, 0.001);

	var ppoFolder = gui.addFolder('PPO');

	ppoFolder.add(guiParams, 'usePostProc');

	ppoFolder.add( guiParams, 'tiltPos', 0, 1, 0.5 ).onChange( onParamsChange );
	ppoFolder.add( guiParams, 'tiltRange', 0, 1, 1).onChange( onParamsChange );
	ppoFolder.add( guiParams, 'tiltStrength', 0, 1, 0.5 ).onChange( onParamsChange );
	if(!data.eTilt)
		ppoFolder.add( guiParams, 'tiltOffset', 0, 0.1, 0.02 ).onChange( onParamsChange );

	if(!data.eGlow) {
		ppoFolder.add( guiParams, 'glowAmount', 0, 1 ).onChange( onParamsChange );
		ppoFolder.add( guiParams, 'glowSize', 0, 3 ).onChange( onParamsChange );
	}
	
	ppoFolder.add( guiParams, 'vigOffset', 0, 3, 0.5 ).onChange( onParamsChange );
	ppoFolder.add( guiParams, 'saturation', -1, 1, 0 ).onChange( onParamsChange );
	ppoFolder.add( guiParams, 'contrast', 0, 1, 0 ).onChange( onParamsChange );
	ppoFolder.add( guiParams, 'brightness', -1, 1, 0 ).onChange( onParamsChange );
	
	if(!data.eShift)
		ppoFolder.add( guiParams, 'rgbShiftAmount', 0, 0.1, 0 ).onChange( onParamsChange );

	if(!data.eNoise)
		ppoFolder.add( guiParams, 'noiseAmount', 0, 1 ).onChange( onParamsChange );
	
	ppoFolder.add( guiParams, 'noiseSpeed', 0, 1, 0.5 ).onChange( onParamsChange );

	if(!data.eBloom)
		ppoFolder.add( guiParams, 'skyOpacity', 0, 1, 0.1 ).onChange( onParamsChange );

	///////////////////
}

function onParamsChange () {

	boundsHolder.visible = guiParams.showBounds;
	ribbons.forEach(function(ribbon){
		ribbon.meshMaterial.wireframe = guiParams.wireframe;
	});

	if(!data.eTilt) {
		ppo.tiltShiftPass.uniforms.focusPos.value = guiParams.tiltPos;
		ppo.tiltShiftPass.uniforms.range.value = guiParams.tiltRange;
		ppo.tiltShiftPass.uniforms.offset.value = guiParams.tiltOffset;
		ppo.tiltShiftPass.uniforms.strength.value = guiParams.tiltStrength;
	}
	ppo.superPass.uniforms.glowAmount.value = guiParams.glowAmount;
	ppo.superPass.uniforms.glowSize.value = guiParams.glowSize;
	ppo.superPass.uniforms.vigOffset.value = guiParams.vigOffset;
	ppo.superPass.uniforms.saturation.value = guiParams.saturation;
	ppo.superPass.uniforms.contrast.value = guiParams.contrast;
	ppo.superPass.uniforms.brightness.value = guiParams.brightness;

	ppo.rgbPass.uniforms.amount.value = guiParams.rgbShiftAmount;

	ppo.noisePass.uniforms.amount.value = data.eNoise ? data.noiseScale : 0;
	ppo.noisePass.uniforms.speed.value = guiParams.noiseSpeed;

	ppo.skyPass.uniforms.opacity.value = guiParams.skyOpacity;

}


function onResize() {
	var w = window.innerWidth;
	var h = window.innerHeight;
	camera.aspect =  w / h;
	camera.updateProjectionMatrix();
	renderer.setSize( w,h );
	composer.setSize(w ,h );
	ppo.fxaaPass.uniforms.resolution.value = new THREE.Vector2(1/w, 1/h);

}

var TRACKER_SAMPLES = 200, TRACKER_SCALE = 25;
class Tracker {
	constructor(samples,color = 'rgba(255,255,255,0.5)') {
		this.index = 0;
		this.maxSize = samples;
		this.data = new Array(samples);
		this.rgb = color;
	}
	
	append(num) {
		if(this.index + 1 > this.maxSize) {
			var oldData = this.data.slice(1);
			oldData.push(num);
			this.data = oldData;
		} else {
			this.data.push(num);
			this.index++;
		}
	}
}
var trackers = [];
var tracker = new Tracker(TRACKER_SAMPLES);
trackers.push(tracker);

//TODO: finish
class AudioHistory {
	constructor(sampleSize) {
		this.sampleSize = sampleSize;
		this.tracker = new Tracker(sampleSize);
		
	}
	
	append(energy) {
		this.tracker.append(energy);
	}
	
	avgEnergy() {
		var data = this.tracker.data;
		var avgEnergy = 0;
		for(var i=0; i<data.length; i++)
			avgEnergy += data[i];
		return avgEnergy/data.length;
	}
}

/*function instantEnergy(arr) {
	var left = arr.left, right = arr.right;
	var energy = 0;
	for(var i=0; i<left.length; i++) {
		energy+= Math.pow(left[i],2) + Math.pow(right[i],2);
	}
	return energy;
}*/

function instantEnergy(arr) {
	var left = arr.left, right = arr.right;
	var energy = 0;
	for(var i=0; i<left.length; i++) {
		energy+= Math.pow(left[i],2) + Math.pow(right[i],2);
	}
	return energy;
}

function splitArr(arr) {
	return {left: arr.slice(0,63), right: arr.slice(63)};
}

function scale(arr,n) {
	for(var i=0; i<arr.length; i++)
		arr[i]*=n;
}

function avg(arr) {
	var sum = 0.0;
	for(var i = 0; i<arr.length; i++)
		sum+=arr[i];
	return sum/arr.length;
}

function avgNum(a,b) {
	return (Math.abs(a) + Math.abs(b)) / 2.0;
}

function avgArr(arr, arr2) {
	var out = [];
	for(var i = 0; i<arr.length; i++)
		out[i] = avgNum(arr[i],arr2[i]);
	return out;
}

function clamp(a,b,c) {
	return a < b? b: a > c? c : a;
}

function lmhSub(arr) {
	var l = lmh(arr.left), r = lmh(arr.right);
	return {low: {left: l.low, right: r.low},
	med: {left: l.med, right: r.med},
	high: {left: l.high, right: r.high}}
}

function lmh(arr) {
	return {low : arr.slice(0,21), med : arr.slice(21,42), high : arr.slice(42)};
}

function reduce(arr) {
	var out = [];
	for(var i=0; i<arr.length / 2; i++)
		out[i] = avgNum(arr[i],arr[i + 64]);
	return out;
}

function realtime() {
	return new Date().getTime();
}

var cooldown = false;
var CHA = 63;
var maxdub = 0;
var nextdub = 0;
var dub = 0.0;
var fade = 0.07;

//var dubChan = 2;
var dubSens = 1000;
var dubThres = 100;
var dubT = 200;
var dubS = 10;
var dubSN = 80;
var dubMA = 8;
var dubMB = 9;

var hist = new AudioHistory(43);
var histMeed = new AudioHistory(43);
var histHigh = new AudioHistory(3);

var lowTracker = new Tracker(TRACKER_SAMPLES,'rgba(255,0,0,0.5)');
var medTracker = new Tracker(TRACKER_SAMPLES,'rgba(0,255,0,0.5)');
var highTracker = new Tracker(TRACKER_SAMPLES,'rgba(0,0,255,0.5)');
var histTracker = new Tracker(TRACKER_SAMPLES,'rgba(0,255,255,1)');
var histTrackerM = new Tracker(TRACKER_SAMPLES,'rgba(255,255,0,1)');
var histTrackerH = new Tracker(TRACKER_SAMPLES,'rgba(255,0,255,1)');
trackers.push(lowTracker);
trackers.push(medTracker);
trackers.push(highTracker);
trackers.push(histTracker);
trackers.push(histTrackerM);
trackers.push(histTrackerH);


var SENSITIVITY = 1.1;

var camPos = 700;

function audio(audioArray) {
	onParamsChange();
	scale(audioArray,data.mScale);
	var audio = splitArr(audioArray);
	var iE = instantEnergy(audio);
	var lAE = hist.avgEnergy(), 
	lAEM = histMeed.avgEnergy(),
	lAEH = histHigh.avgEnergy();
	
	var lmh2 = lmhSub(audio);
	var lIE = instantEnergy(lmh2.low), 
	mIE = instantEnergy(lmh2.med), 
	hIE = instantEnergy(lmh2.high);
	
	
	
	if(isDev) {
		tracker.append(iE)
		lowTracker.append(lIE);
		medTracker.append(mIE);
		highTracker.append(hIE);
		histTracker.append(lAE);
		histTrackerM.append(lAEM);
		histTrackerH.append(lAEH);
	}
	
	if(data.eShift || data.eDrop)
		if(lIE - lAE > SENSITIVITY) {
			dub += lIE * 0.02 * data.dubScale;
			dub = clamp(dub, 0, 1);
			camPos = clamp((camPos + (camPos * 0.9))/2,700,1000);
			//camera.position.z = clamp(camera.position.z + 100,700,1500);
			//camera.fov = clamp(camera.fov + 20,65,90);
			console.log("beat");
		} else {
			dub = clamp(dub-(data.dubScale * fade),0,999);
			camPos = clamp(camPos + 100,700,1000);
			//camera.position.z = clamp((camera.position.z + (camera.position.z * 0.9))/2,700,1500);
			//camera.fov = clamp(camera.fov - 1,65,90);
		}
	
	hist.append(lIE);
	histMeed.append(mIE);
	histHigh.append(hIE);
	
	var fft = reduce(audioArray);
	var lowMedHigh = lmh(fft);
	var l = avg(lowMedHigh.low), m = avg(lowMedHigh.med), h = avg(lowMedHigh.high);
	
	// -------- DUB -------------
	/*dub = clamp(dub-(data.dubScale * fade),0,999);
	if(data.eShift && audioArray.length > 0) {
		for(var i=0; i<data.dubChanSens; i++) {
			var dubChan = i;
			if(fft[dubChan]*dubSens > maxdub-dubS && realtime() > nextdub && !cooldown && fft[dubChan]*dubSens > dubThres) {
				nextdub = realtime() + dubT;
				dub = data.dubScale * 0.2;
				cooldown = false;
			}   
			if(fft[dubChan]*dubSens > maxdub-dubSN)
				maxdub = (maxdub*dubMA+fft[dubChan]*dubSens)/dubMB;
                   
			if(fft[dubChan]*dubSens < maxdub-dubS || fft[dubChan]*dubSens > maxdub+dubS) cooldown = false;
			if(cooldown)
				break;
		}
    }*/
	
	// BLOOM
	if(data.eBloom) {
		//ppo.skyPass.uniforms.opacity.value = clamp(avg(fft) / 0.2 * data.bloomScale, 0.15,0.3);
		//ppo.skyPass.uniforms.opacity.value = clamp(iE * 0.002 * data.bloomScale, 0.15,0.3);
		//ppo.skyPass.uniforms.opacity.value = iE * data.bloomScale;
		ppo.skyPass.uniforms.opacity.value = clamp(mIE * 0.2 * data.bloomScale, 0.0, 0.3);
	}
	// RGB Shift
	if(data.eShift)
		ppo.rgbPass.uniforms.amount.value =  clamp(dub* 0.4, 0.02, 0.1 * data.dubScale);
		//.rgbPass.uniforms.amount.value =  clamp(mIE * 0.05, 0, 0.1);
	
	// GLOW
	if(data.eGlow) {
		//ppo.superPass.uniforms.glowSize.value = clamp(h / 0.8 * data.glowScale, 2,99);
		//ppo.superPass.uniforms.glowAmount.value = clamp(h / 0.05 * data.glowAmount, 0.3,1);
		//ppo.superPass.uniforms.glowSize.value = 1;
		ppo.superPass.uniforms.glowSize.value = clamp(iE/2 * data.glowScale,0,1);
		ppo.superPass.uniforms.glowAmount.value = clamp(iE * 0.5 * data.glowAmount,0,1);
	}
	
	// DROP
	if(data.eDrop)
		camera.position.z = camPos;
	
	// TILT
	if(data.eTilt) { 
		ppo.tiltShiftPass.uniforms.offset.value = clamp(m / 2 * data.tiltScale, 0, 1);
		//ppo.tiltShiftPass.uniforms.offset.value = clamp(mIE * 0.005 * data.tiltScale,0,1);
	}
	
	if(data.eStars)
		stars.sunGlowMaterial.uniforms.power.value = lAEH/2;
	
	guiParams.ribbonSpeed = data.rspeed ? clamp(iE * 0.0005 * data.rspeedScale, 0, 0.001 * data.rspeedScale) : 0.001;
}

function doJump(){

	if (!guiParams.autoRotate || !data.fastR) return;

	//spin
	TweenMax.to(outerHolder.rotation, 1, {
		x: ATUtil.randomRange(-Math.PI,Math.PI),
		y: ATUtil.randomRange(-Math.PI,Math.PI),
		z: ATUtil.randomRange(-Math.PI,Math.PI),
		ease: Power2.easeInOut});
}

function animate() {

	ppo.skyPass.uniforms.time.value = noiseTime* 20;
	window.requestAnimationFrame( animate );
	
	var now = performance.now() / 1000;
    var dt = Math.min(now - last, 1);
    last = now;
	
	if(data.fps > 0) {
		fpsThreshold += dt;
        if (fpsThreshold < 1.0 / data.fps) {
            return;
        }
        fpsThreshold -= 1.0 / data.fps;
	}

	controls.update();
	stats.update();

	if (guiParams.animate){
		noiseTime += guiParams.ribbonSpeed;
		ppo.noisePass.uniforms.time.value = noiseTime;
		events.emit('update');
	}

	if (guiParams.usePostProc)
		composer.render();
	else
		renderer.render( scene, camera );
	

	//move camlight
	lights[ 1 ].position.copy(camera.position);

	if (guiParams.autoRotate){

		tiltTime += tiltSpeed;
		worldHolder.rotation.x = noise.noise(tiltTime ,0) * rotRng/4;
		worldHolder.rotation.y = noise.noise(tiltTime ,100) * rotRng;
		worldHolder.rotation.z = noise.noise(tiltTime ,200) * rotRng;
	}
	if(isDev) {
		var context = canvas.getContext( '2d' );
		var width = canvas.width, height = canvas.height;
		context.clearRect(0,0,width,height);
		
		for(var j = 0; j<trackers.length; j++) {
			var track = trackers[j];
			var trackerData = track.data;
			var barWidth = width/trackerData.length;
			var x = 0, y = height-(trackerData[0] * TRACKER_SCALE);
	
			context.strokeStyle = track.rgb;
			
			context.beginPath();
			context.moveTo(x,y);
			for(var i=0; i<trackerData.length; i++) {
				x+=barWidth;
				context.lineTo(x,height-(trackerData[i] * TRACKER_SCALE));
			}
			context.stroke();
			context.closePath();
		}
		context.fillStyle = 'rgba(255,255,255,1)';
		context.fillText('Seed: ' + seed, width/2, height/3);
	}
}
window.onload = function() {
	if(!isDev)
		stats.domElement.style.display = "none"; 
	window.wallpaperRegisterAudioListener(audio);
}
//TODO: enable scheme colors
window.wallpaperPropertyListener = {
	applyGeneralProperties: function(properties) {
		if(properties.fps)
			data.fps = properties.fps;
	},
    applyUserProperties: function(properties) {
		// -------- M SCALE -----------
		if(properties.scale)
			data.mScale = properties.scale.value / 100.0;
		
		// -------- BLOOM -------------
		if(properties.bloom) 
			data.eBloom = properties.bloom.value;
		if (properties.bloomscale) 
			data.bloomScale = properties.bloomscale.value / 100.0;
		
		// -------- GLOW -------------
		if(properties.glow)
			data.eGlow = properties.glow.value;
		if(properties.glowscale) 
			data.glowScale = properties.glowscale.value / 100.0;
		if(properties.glowamount)
			data.glowAmount = properties.glowamount.value / 100.0;
		
		// -------- TILT -------------
		if(properties.tilt) 
			data.eTilt = properties.tilt.value;
		if(properties.tiltscale)
			data.tiltScale = properties.tiltscale.value / 100.0;
		
		// -------- RGB SHIFT -------------
		if(properties.rgbshift) 
			data.eShift = properties.rgbshift.value;
		if(properties.rgbshiftchan) 
			data.dubChanSens = SENSITIVITY = properties.rgbshiftchan.value / 100.0;
		if(properties.rgbshiftscale)
			data.dubScale = properties.rgbshiftscale.value;
		
		// --------- DROP ------------
		if(properties.eDrop)
			data.eDrop = properties.eDrop.value;
		
		
		// -------- NOISE -------------
		if(properties.noise) 
			data.eNoise = properties.noise.value;
		if(properties.noisescale)
			data.noiseScale = properties.noisescale.value / 100.0;
		
		// -------- FAST ROTATION ---------
		if(properties.frotate)
			data.fastR = properties.frotate.value;
		
		// -------- STARS ---------
		if(properties.eStars)
			data.eStars = properties.eStars.value;
		
		// -------- RIBBON SYNC ---------
		if(properties.rspeed)
			data.rspeed = properties.rspeed.value;
		if(properties.rspeedScale)
			data.rspeedScale = properties.rspeedScale.value / 100.0;
		// -------- EXTRAS -------------
		if(properties.custom_seed) {
			data.custom_seed = properties.custom_seed.value;			
		}
		if(properties.seed && data.custom_seed) {
			seed = properties.seed.value
			Math.seedrandom(seed);
		}
		if (properties.dev) {
			if(isDev)
				gui.domElement.parentNode.removeChild(gui.domElement);
            isDev = properties.dev.value;
			if (isDev) {
				document.querySelector('.webgl').appendChild( stats.domElement );
				stats.domElement.style.display = "block"; 
				initGUI();
			}
			else {
				stats.domElement.style.display = "none"; 
				gui.domElement.parentNode.removeChild(gui.domElement);
			}
		}
    }
};
init();
