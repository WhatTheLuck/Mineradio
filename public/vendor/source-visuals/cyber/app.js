var paused = false;
var clock = new THREE.Clock();
var prevTime = 0;
var frames = 0;
var fpsTime = performance.now();
var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var cameraTarget = new THREE.Vector3();
var orbitControls = new THREE.OrbitControls(WE_Scene.camera, WE_Scene.renderer.domElement);
var CAMERA_FLOOR_Y = 0.1;
var appliedCamera = { radius: NaN, height: NaN, targetX: NaN, targetY: NaN, targetZ: NaN, scale: 1 };
var cameraTargetDelta = new THREE.Vector3();
var cameraJump = {
  elapsed: 0,
  active: false,
  progress: 0,
  fromDirection: new THREE.Vector3(),
  toDirection: new THREE.Vector3(),
  currentDirection: new THREE.Vector3(),
  targetQuaternion: new THREE.Quaternion(),
  frameQuaternion: new THREE.Quaternion()
};
var identityQuaternion = new THREE.Quaternion();

orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.075;
orbitControls.enablePan = false;
orbitControls.enableZoom = true;
orbitControls.enableRotate = true;
orbitControls.minDistance = 4;
orbitControls.maxDistance = 40;
orbitControls.addEventListener('start', function () {
  // A direct drag is authoritative: do not let an in-flight automatic angle
  // transition overwrite it on the following frame.
  cameraJump.active = false;
  cameraJump.elapsed = 0;
});

document.getElementById('webgl-root').appendChild(WE_Scene.renderer.domElement);

document.addEventListener('visibilitychange', function () { paused = document.hidden; });

function power2InOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) * 0.5;
}

function keepCameraAboveFloor() {
  if (WE_Scene.camera.position.y >= CAMERA_FLOOR_Y) return;
  WE_Scene.camera.position.y = CAMERA_FLOOR_Y;
  WE_Scene.camera.lookAt(orbitControls.target);
}

function startCameraJump(radius) {
  var offset = WE_Scene.camera.position.clone().sub(orbitControls.target);
  cameraJump.fromDirection.copy(offset).normalize();
  var theta = Math.random() * Math.PI * 2 - Math.PI;
  var phi = Math.PI * (0.28 + Math.random() * 0.44);
  cameraJump.toDirection.setFromSpherical(new THREE.Spherical(1, phi, theta));
  cameraJump.targetQuaternion.setFromUnitVectors(cameraJump.fromDirection, cameraJump.toDirection);
  cameraJump.progress = 0;
  cameraJump.active = radius > 0;
}

function updateCameraJump(dt, p) {
  if (!p.cameraJump || reducedMotion) {
    cameraJump.elapsed = 0;
    cameraJump.active = false;
    return;
  }
  cameraJump.elapsed += dt;
  if (!cameraJump.active && cameraJump.elapsed >= p.cameraJumpInterval) {
    cameraJump.elapsed %= p.cameraJumpInterval;
    startCameraJump(WE_Scene.camera.position.distanceTo(orbitControls.target));
  }
  if (!cameraJump.active) return;

  cameraJump.progress = Math.min(1, cameraJump.progress + dt / p.cameraJumpDuration);
  cameraJump.frameQuaternion.copy(identityQuaternion).slerp(cameraJump.targetQuaternion, power2InOut(cameraJump.progress));
  var radius = WE_Scene.camera.position.distanceTo(orbitControls.target);
  cameraJump.currentDirection.copy(cameraJump.fromDirection).applyQuaternion(cameraJump.frameQuaternion).multiplyScalar(radius);
  WE_Scene.camera.position.copy(orbitControls.target).add(cameraJump.currentDirection);
  keepCameraAboveFloor();
  WE_Scene.camera.lookAt(orbitControls.target);
  if (cameraJump.progress >= 1) cameraJump.active = false;
}

function updateCamera(dt) {
  var p=ControlUI.state.scene;
  var ribbonPosition = WE_Ribbon.params;
  if (ribbonPosition.positionX !== appliedCamera.targetX ||
      ribbonPosition.positionY !== appliedCamera.targetY ||
      ribbonPosition.positionZ !== appliedCamera.targetZ) {
    cameraTarget.set(ribbonPosition.positionX, ribbonPosition.positionY, ribbonPosition.positionZ);
    cameraTargetDelta.copy(cameraTarget).sub(orbitControls.target);
    orbitControls.target.copy(cameraTarget);
    WE_Scene.camera.position.add(cameraTargetDelta);
    appliedCamera.targetX = ribbonPosition.positionX;
    appliedCamera.targetY = ribbonPosition.positionY;
    appliedCamera.targetZ = ribbonPosition.positionZ;
  }
  // Ref camera.position.z is 700..1000. Map that trajectory onto the
  // user-selected orbit radius (700 maps to 1x) before OrbitControls updates
  // the view matrix, so position and look direction stay coherent.
  var rawCameraScale = WE_Audio.ribbonCameraZ / 700;
  var cameraScale = WE_Ribbon.params.cameraDrop
    ? 1 + (rawCameraScale - 1) * WE_Ribbon.params.cameraDropScale
    : 1;
  var radiusChanged = p.cameraRadius !== appliedCamera.radius;
  var heightChanged = p.cameraHeight !== appliedCamera.height;
  if (radiusChanged || heightChanged) {
    var offset = WE_Scene.camera.position.clone().sub(orbitControls.target);
    var angle = Math.atan2(offset.x, offset.z);
    var effectiveRadius = p.cameraRadius * cameraScale;
    WE_Scene.camera.position.set(
      orbitControls.target.x + Math.sin(angle) * effectiveRadius,
      Math.max(CAMERA_FLOOR_Y, p.cameraHeight),
      orbitControls.target.z + Math.cos(angle) * effectiveRadius
    );
    appliedCamera.radius = p.cameraRadius;
    appliedCamera.height = p.cameraHeight;
  } else if (cameraScale !== appliedCamera.scale && appliedCamera.scale > 0) {
    // Audio push/pull changes distance only. Preserve the direction selected
    // by mouse orbiting or by an automatic angle switch instead of restoring
    // the configured camera height every audio frame.
    var scaledOffset = WE_Scene.camera.position.clone().sub(orbitControls.target);
    scaledOffset.multiplyScalar(cameraScale / appliedCamera.scale);
    WE_Scene.camera.position.copy(orbitControls.target).add(scaledOffset);
  }
  appliedCamera.scale = cameraScale;
  orbitControls.autoRotate = !!p.cameraOrbit && !reducedMotion;
  orbitControls.autoRotateSpeed = p.cameraSpeed * 25;
  orbitControls.update();
  keepCameraAboveFloor();
  updateCameraJump(dt, p);

  WE_Ribbon.cameraLight.position.copy(WE_Scene.camera.position);
}

function animate() {
  requestAnimationFrame(animate);
  if (paused) return;
  var t=clock.getElapsedTime(), dt=Math.min(t-prevTime,.25); prevTime=t;
  WE_Audio.step(dt);
  updateCamera(dt);
  WE_Terrain.update(clock);
  WE_Ribbon.update(dt);
  WE_PostFX.update(dt);
  WE_PostFX.render();
  frames++;
  var now=performance.now();
  if(now-fpsTime>700){
    var canvas=WE_Scene.renderer.domElement;
    document.getElementById('fps').textContent=Math.round(frames*1000/(now-fpsTime))+' FPS / '+canvas.width+'x'+canvas.height;
    frames=0;fpsTime=now;
  }
}

requestAnimationFrame(animate);
