window.sourceVisual = {
  apply: value => ControlUI.applyPreset(value),
  snapshot: () => ControlUI.makePreset(),
  set: (section,key,value) => ControlUI.set(section,key,value),
  rotate: (deltaX, deltaY) => {
    const offset = WE_Scene.camera.position.clone().sub(orbitControls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * 0.005;
    spherical.phi = Math.max(0.08, Math.min(Math.PI * 0.49, spherical.phi + deltaY * 0.005));
    cameraJump.active = false;
    cameraJump.elapsed = 0;
    WE_Scene.camera.position.copy(orbitControls.target).add(offset.setFromSpherical(spherical));
    WE_Scene.camera.lookAt(orbitControls.target);
    orbitControls.update();
  },
  audio: frame => {
    const data = frame.frequencyData || [];
    const spectrum = new Float32Array(128);
    for (let i=0;i<64;i++) {
      const start=Math.floor(i*data.length/64), end=Math.max(start+1,Math.floor((i+1)*data.length/64));
      let sum=0; for(let j=start;j<end;j++) sum+=data[j]||0;
      spectrum[i]=spectrum[i+64]=frame.playing ? sum/(end-start)/255 : 0;
    }
    window.__audioListeners.forEach(listener=>listener(spectrum));
  }
};
parent.dispatchEvent(new CustomEvent('source-visual-ready',{detail:'cyber'}));
