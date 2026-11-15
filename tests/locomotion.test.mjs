import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import * as THREE from 'three';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run the browser modules with real Three.js geometry/math and no WebGL or canvas.
function loadModule(file, globals, expose) {
  const filename = path.resolve(__dirname, '..', file);
  const source = readFileSync(filename, 'utf8')
    .replace(/^import .+ from .+;\r?$/gm, '')
    .replace(/^export /gm, '')
    .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href));
  const context = vm.createContext({ THREE, console, URL, Event, ...globals });
  vm.runInContext(`${source}\n${expose}`, context, { filename });
  return context.result;
}

const sharedWorld = loadModule('public/ship3d/world.js', {}, 'globalThis.result = { BRIDGE, ORBIT, buildBridge, createStarfield };');

function createShip() {
  const speeds = [];
  let steps = 0;
  const window = { GameState: { isOver: false }, innerWidth: 1280, innerHeight: 720, dispatchEvent() {} };
  const document = {
    activeElement: null,
    pointerLockElement: null,
    createElement: () => ({ getContext: () => null }),
    getElementById: () => null,
    exitPointerLock() { this.pointerLockElement = null; },
  };
  const renders = [];
  const ship = loadModule('public/ship3d.js', {
    BRIDGE: sharedWorld.BRIDGE,
    ORBIT: sharedWorld.ORBIT,
    window,
    document,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    recordSpeed: (speed) => speeds.push(speed),
    recordStep: () => steps++,
    recordRender: (scene) => renders.push(scene),
  }, `
    const realUpdateCamera = updateCamera;
    updateCamera = updateAim = updateHud = () => {};
    clock = { elapsedTime: 0, getDelta: () => 1 / 60 };
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    renderer = {
      domElement: { style: {}, requestPointerLock() { throw Error('unexpected pointer lock'); } },
      setScissorTest() {}, setViewport() {}, setScissor() {}, clear() {},
      clearDepth() { recordRender('depth'); }, render: recordRender,
    };
    astronaut = new THREE.Group();
    headlamp = new THREE.SpotLight();
    emu = { animate(dt, speed) { recordSpeed(speed); return true; } };
    props = { obstacles: [], update: () => [] };
    panels = { update() {}, release: () => false, pick() { throw Error('unexpected world click'); } };
    sfx = { step: recordStep, update() {}, strike() {} };
    helmet = { setFirstPerson() {}, setHandPad() {}, update() {}, flashStrike() {} };
    handpad = {
      open: false, visible: false, update() {}, key: () => false, releaseInput() {},
      setOpen(v) { this.open = v; }, setVisible(v) { this.visible = v; },
    };
    for (const room of STATION_ROOMS) {
      stations[room.key] = {
        marker: new THREE.Mesh(), drawScreen() {},
      };
      roomLights[room.key] = {};
      alarmLights[room.key] = {};
    }
    alarmLights.hub = {};
    globalThis.result = {
      update, player, keys, touch, onKeyDown, onKeyUp, onPointerDown, onPointerUp, clearInput, frame,
      canStand, maxJumpHeight, ROOMS, CORRIDORS, camera, astronaut, headlamp, resetPlayer,
      start() { running = true; },
      setPadOpen(on) { handpad.open = on; },
      updateCamera: realUpdateCamera,
      setBridge(value) { bridge = value; },
      setCameraMode, toggleHandPad,
      setInput(on) { inputEnabled = on; },
      startFirstPerson(pad) { handpad = pad; running = true; setCameraMode('first'); },
      setAnimator(animate) { emu.animate = animate; },
    };
  `);
  return { ...ship, window, document, renders, speeds, get steps() { return steps; } };
}

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('walking speed stays constant over time and becomes zero when released', () => {
  const ship = createShip();
  ship.keys.add('KeyW');
  for (let i = 0; i < 600; i++) {
    // Keep the test away from walls while advancing the real update loop.
    Object.assign(ship.player, { x: -3, z: 3 });
    ship.update(1 / 60);
    close(ship.speeds.at(-1), 2);
  }
  ship.keys.clear();
  const previousSteps = ship.steps;
  for (let i = 0; i < 120; i++) ship.update(1 / 60);
  close(ship.speeds.at(-1), 0);
  assert.equal(ship.steps, previousSteps);
});

test('sprint, diagonal and touch input pass actual speed to the model', () => {
  const ship = createShip();
  Object.assign(ship.player, { x: -3, z: 3 });
  ship.keys.add('KeyW');
  ship.keys.add('KeyD');
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 2);
  ship.keys.add('ShiftLeft');
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 3.4);
  ship.keys.clear();
  ship.touch.vec.y = 0.5;
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 1);
});

test('a wall stops the gait and wall sliding uses only the allowed displacement', () => {
  const ship = createShip();
  Object.assign(ship.player, { x: 5.64, z: 3 });
  ship.keys.add('KeyD');
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 0);
  assert.equal(ship.steps, 0);
  ship.keys.add('KeyW');
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 2 / Math.sqrt(2));
});

test('disabled input, game over and a zero-length frame stay still', () => {
  const ship = createShip();
  Object.assign(ship.player, { x: -3, z: 3 });
  ship.keys.add('KeyW');
  ship.update(0);
  close(ship.speeds.at(-1), 0);
  ship.setInput(false);
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 0);
  ship.setInput(true);
  ship.window.GameState.isOver = true;
  ship.update(1 / 60);
  close(ship.speeds.at(-1), 0);
  assert.equal(ship.steps, 0);
});

test('footstep sounds follow the model contact pulse', () => {
  const ship = createShip();
  Object.assign(ship.player, { x: -3, z: 3 });
  ship.keys.add('KeyW');
  ship.setAnimator(() => false);
  ship.update(1 / 60);
  assert.equal(ship.steps, 0);
  ship.setAnimator(() => true);
  ship.update(1 / 60);
  assert.equal(ship.steps, 1);
});

function keyEvent(code, repeat = false, typing = false) {
  return { code, repeat, preventDefault() {}, target: { closest: () => typing } };
}

test('Space produces a slow ballistic jump and a stable landing at different frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const ship = createShip();
    ship.start();
    ship.onKeyDown(keyEvent('Space'));
    ship.update(0);
    close(ship.player.y, 0);
    assert.equal(ship.player.grounded, true);
    for (let i = 0; i < fps / 2; i++) ship.update(1 / fps);
    close(ship.player.y, 1.8 * 0.5 - 0.5 * 1.62 * 0.5 ** 2);
    close(ship.player.vy, 1.8 - 1.62 * 0.5);
    assert.equal(ship.player.grounded, false);
    let peak = ship.player.y;
    let flightTime = 0.5;
    while (!ship.player.grounded && flightTime < 3) {
      ship.update(1 / fps);
      flightTime += 1 / fps;
      peak = Math.max(peak, ship.player.y);
    }
    assert.ok(peak > 0.99 && peak <= 1.000001);
    assert.ok(flightTime > 2.2 && flightTime < 2.3);
    close(ship.player.y, 0);
    close(ship.player.vy, 0);
    assert.equal(ship.player.grounded, true);
    // Holding the key never triggers another jump after landing.
    for (let i = 0; i < fps; i++) {
      ship.onKeyDown(keyEvent('Space', true));
      ship.update(1 / fps);
    }
    close(ship.player.y, 0);
    ship.onKeyUp(keyEvent('Space'));
    ship.onKeyDown(keyEvent('Space'));
    ship.update(1 / fps);
    assert.ok(ship.player.y > 0);
  }
});

test('pressing Space again in the air does not add impulse or queue another jump', () => {
  const ship = createShip();
  ship.start();
  ship.onKeyDown(keyEvent('Space'));
  for (let i = 0; i < 30; i++) ship.update(1 / 60);
  ship.onKeyUp(keyEvent('Space'));
  ship.onKeyDown(keyEvent('Space'));
  ship.update(1 / 60);
  const t = 31 / 60;
  close(ship.player.y, 1.8 * t - 0.5 * 1.62 * t * t);
  close(ship.player.vy, 1.8 - 1.62 * t);
  for (let i = 0; i < 180; i++) ship.update(1 / 60);
  close(ship.player.y, 0);
  assert.equal(ship.player.grounded, true);
});

test('typing, inactive controls, a wrist panel or game over cannot start a jump', () => {
  for (const block of [
    (ship) => ship.setInput(false),
    (ship) => ship.setPadOpen(true),
    (ship) => { ship.window.GameState.isOver = true; },
    (ship) => { ship.document.activeElement = { closest: () => true }; },
  ]) {
    const ship = createShip();
    ship.start();
    block(ship);
    ship.onKeyDown(keyEvent('Space'));
    ship.update(1 / 60);
    close(ship.player.y, 0);
    assert.equal(ship.player.grounded, true);
  }
  const ship = createShip();
  ship.onKeyDown(keyEvent('Space'));
  ship.update(1 / 60);
  close(ship.player.y, 0);
  ship.start();
  ship.onKeyDown(keyEvent('Space', false, true));
  ship.update(1 / 60);
  close(ship.player.y, 0);
});

test('clearing input cancels pending jumps and blocking input still allows a landing', () => {
  const ship = createShip();
  ship.start();
  ship.onKeyDown(keyEvent('Space'));
  ship.clearInput();
  ship.update(1 / 60);
  close(ship.player.y, 0);
  ship.onKeyDown(keyEvent('Space'));
  for (let i = 0; i < 30; i++) ship.update(1 / 60);
  assert.ok(ship.player.y > 0);
  ship.setInput(false);
  ship.clearInput();
  for (let i = 0; i < 180; i++) ship.update(1 / 60);
  close(ship.player.y, 0);
  close(ship.player.vy, 0);
  assert.equal(ship.player.grounded, true);
});

test('airborne movement lifts the suit and headlamp without footsteps or a walking gait', () => {
  const ship = createShip();
  ship.start();
  ship.keys.add('KeyW');
  ship.onKeyDown(keyEvent('Space'));
  for (let i = 0; i < 45; i++) ship.update(1 / 60);
  assert.ok(ship.player.z < 2);
  assert.ok(ship.player.y > 0);
  close(ship.astronaut.position.y, ship.player.y);
  close(ship.headlamp.position.y, ship.player.y + 1.85 + Math.sin(ship.player.pitch) * 0.25);
  assert.equal(ship.steps, 0);
  assert.ok(ship.speeds.every((speed) => speed === 0));
  ship.setCameraMode('first');
  ship.updateCamera(1 / 60);
  close(ship.camera.position.y, ship.player.y + 1.68);
  for (const mode of ['third', 'cinematic', 'wide']) {
    ship.setCameraMode(mode);
    ship.updateCamera(1 / 60);
    const raisedY = ship.camera.position.y;
    ship.player.y = 0;
    ship.updateCamera(1 / 60);
    assert.ok(raisedY > ship.camera.position.y);
    ship.player.y = 0.8;
  }
});

test('ceilings and doorway lintels stop upward motion and block entry while too high', () => {
  for (const [x, z] of [[0, 6], [0, -6], [6, 0], [-6, 0], [0, 12], [0, -12], [12, 0], [-12, 0]]) {
    const ship = createShip();
    ship.start();
    Object.assign(ship.player, { x, z });
    ship.onKeyDown(keyEvent('Space'));
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      ship.update(1 / 60);
      peak = Math.max(peak, ship.player.y);
      assert.ok(ship.player.y <= ship.maxJumpHeight(x, z));
    }
    assert.ok(peak > 0.3 && peak < 0.4);
    assert.equal(ship.player.grounded, true);
    ship.player.y = 0.8;
    assert.equal(ship.canStand(x, z), false);
  }
  const ship = createShip();
  Object.assign(ship.player, { y: 0.99, vy: 1.8, grounded: false });
  ship.update(1 / 60);
  close(ship.player.y, ship.maxJumpHeight(ship.player.x, ship.player.z));
  close(ship.player.vy, 0);
});

test('resetting the astronaut clears vertical motion and any pending jump', () => {
  const ship = createShip();
  ship.start();
  ship.onKeyDown(keyEvent('Space'));
  ship.update(0.1);
  assert.ok(ship.player.y > 0);
  ship.resetPlayer();
  close(ship.player.y, 0);
  close(ship.player.vy, 0);
  assert.equal(ship.player.grounded, true);
  ship.onKeyDown(keyEvent('Space'));
  ship.resetPlayer();
  ship.update(1 / 60);
  close(ship.player.y, 0);
});

function createAstronaut() {
  const { buildAstronaut } = loadModule('public/ship3d/astronaut.js', {
    suitFabric: () => ({ map: new THREE.Texture(), normalMap: new THREE.Texture() }),
    canvasTex: () => new THREE.Texture(),
  }, 'globalThis.result = { buildAstronaut };');
  return buildAstronaut();
}

test('the procedural fallback settles after stopping', () => {
  const astronaut = createAstronaut();
  for (let i = 0; i < 180; i++) astronaut.animate(1 / 60, 4.2);
  for (let i = 0; i < 180; i++) astronaut.animate(1 / 60, 0);
  const rig = astronaut.root.children[0];
  const hips = rig.children.filter((part) => part.isGroup && part.position.y === 0.93);
  assert.equal(hips.length, 2);
  hips.forEach((hip) => close(hip.rotation.x, 0));
  for (let i = 0; i < 60; i++) assert.equal(astronaut.animate(1 / 60, 0), false);
});

test('the bundled mocap keeps the model finite, grounded and responsive to speed', () => {
  const { createMocapRig } = loadModule('public/ship3d/mocap.js', {},
    'globalThis.result = { createMocapRig };');
  const data = JSON.parse(readFileSync(path.join(__dirname, '../public/ship3d/mocap.json'), 'utf8'));
  const mocap = createMocapRig(data);
  for (const name of ['walk', 'run']) {
    assert.ok(Number.isFinite(mocap.clips[name].speed) && mocap.clips[name].speed > 0);
  }
  const astronaut = createAstronaut();
  astronaut.setMocap(mocap);
  const soles = [];
  astronaut.root.traverse((part) => {
    if (part.type === 'Object3D' && part.position.y === -0.118) soles.push(part);
  });
  assert.equal(soles.length, 4);
  const point = new THREE.Vector3();
  for (const speed of [0, 2, 3.4, 0, 1, 0]) {
    let contacts = 0;
    for (let i = 0; i < 180; i++) {
      contacts += Number(astronaut.animate(1 / 60, speed));
      astronaut.root.updateMatrixWorld(true);
      astronaut.root.traverse((part) => {
        assert.ok(part.matrixWorld.elements.every(Number.isFinite));
      });
      close(Math.min(...soles.map((sole) => sole.getWorldPosition(point).y)), 0, 1e-6);
    }
    close(astronaut.root.position.x, 0);
    close(astronaut.root.position.z, 0);
    if (speed > 0) assert.ok(contacts > 0, 'movement must produce foot contacts');
    close(mocap.state.move, speed > 0 ? 1 : 0, 1e-6);
  }
});

function createPad() {
  const calls = [];
  const state = { radio: 'ready', talking: false, chatOpen: false, voice: true, music: true, sound: true };
  const comms = {
    radio: () => ({ state: state.radio, talking: state.talking, talkers: [] }),
    chat: () => ({ available: true, open: state.chatOpen, unread: 0, messages: [] }),
    setTalking(on) { state.talking = on; calls.push(['talking', on]); },
    enableRadio() { calls.push(['enableRadio']); },
    setChatOpen(on) { state.chatOpen = on; },
    get voiceOn() { return state.voice; },
    toggleVoice() { state.voice = !state.voice; },
    get musicOn() { return state.music; },
    toggleMusic() { state.music = !state.music; },
  };
  const g = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: text.length * 12 }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  const window = { innerWidth: 1280, innerHeight: 720, AetherComms: comms };
  const { createHandPad } = loadModule('public/ship3d/handpad.js', {
    window,
    document: { createElement: () => ({ getContext: () => g }) },
    performance: { now: () => 0 },
  }, 'globalThis.result = { createHandPad };');
  const materials = createAstronaut().materials;
  const pad = createHandPad({
    materials, environment: null,
    isSoundEnabled: () => state.sound,
    toggleSound() { state.sound = !state.sound; },
  });
  const sourceCamera = new THREE.PerspectiveCamera(108, 2, 0.05, 1000);
  sourceCamera.position.set(3, 1.68, -4);
  sourceCamera.rotation.set(0.2, 1.3, 0, 'YXZ');
  const tick = () => pad.update(1, sourceCamera, 0, { timeLeft: 90, strikes: 0 });
  function tilePoint(i) {
    const screen = pad.scene.getObjectsByProperty('type', 'Mesh')
      .find((mesh) => mesh.geometry.type === 'PlaneGeometry');
    const tileW = (1024 - 72 - 32) / 3;
    const tileH = (330 - 16) / 2;
    const px = 36 + (i % 3) * (tileW + 16) + tileW / 2;
    const py = 128 + Math.floor(i / 3) * (tileH + 16) + tileH / 2;
    const point = screen.localToWorld(new THREE.Vector3((px / 1024 - 0.5) * 0.28, (0.5 - py / 640) * 0.175, 0));
    point.project(pad.camera);
    return [(point.x + 1) * window.innerWidth / 2, (1 - point.y) * window.innerHeight / 2];
  }
  return { pad, window, state, calls, tick, tilePoint };
}

test('first-person hands remain inside the view when the panel is lowered', () => {
  const { pad, tick, window } = createPad();
  pad.setVisible(true);
  const hands = pad.scene.children.find((part) => part.isGroup).children[0].children.filter((part) => part.isGroup);
  assert.equal(hands.length, 2);
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    window.innerWidth = width;
    window.innerHeight = height;
    tick();
    for (const hand of hands) {
      const point = hand.getWorldPosition(new THREE.Vector3()).project(pad.camera);
      assert.ok(Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.8 && Math.abs(point.z) < 1);
    }
  }
});

test('the wrist panel shares chat, voice, sound and music controls', () => {
  const { pad, state, tick } = createPad();
  pad.setVisible(true);
  pad.setOpen(true);
  tick();
  for (const code of ['Digit2', 'Digit3', 'Digit4', 'Numpad5']) assert.equal(pad.key(code, true), true);
  assert.equal(state.chatOpen, true);
  assert.equal(state.voice, false);
  assert.equal(state.sound, false);
  assert.equal(state.music, false);
  pad.key('Digit6', true);
  assert.equal(pad.open, false);
});

test('panel buttons receive clicks after rotation and resizing', () => {
  const fixture = createPad();
  const { pad, state, tick, tilePoint, window } = fixture;
  pad.setVisible(true);
  pad.setOpen(true);
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    window.innerWidth = width;
    window.innerHeight = height;
    tick();
    assert.equal(pad.pointerDown(...tilePoint(2)), true);
    pad.pointerUp();
    assert.equal(state.voice, width === 720);
  }
  assert.equal(pad.pointerDown(0, 0), false);
});

test('radio transmission is released on keyup, closing, hiding or loss of focus', () => {
  const { pad, state, tick } = createPad();
  pad.setVisible(true);
  for (const release of [
    () => pad.key('Digit1', false),
    () => pad.setOpen(false),
    () => pad.setVisible(false),
    () => pad.releaseInput(),
  ]) {
    pad.setVisible(true);
    pad.setOpen(true);
    tick();
    pad.key('Digit1', true);
    assert.equal(state.talking, true);
    release();
    assert.equal(state.talking, false);
  }
});

test('Q opens once, typing is ignored and panel clicks do not reach the ship', () => {
  const ship = createShip();
  const { pad, tick, tilePoint, state } = createPad();
  ship.startFirstPerson(pad);
  assert.equal(pad.visible, true);
  const key = (code, repeat = false, typing = false) => ({
    code, repeat, preventDefault() {}, target: { closest: () => typing },
  });
  ship.onKeyDown(key('KeyQ'));
  ship.onKeyDown(key('KeyQ', true));
  assert.equal(pad.open, true);
  ship.onKeyDown(key('Digit3', false, true));
  assert.equal(state.voice, true);
  tick();
  const [clientX, clientY] = tilePoint(2);
  ship.onPointerDown({ button: 0, pointerType: 'mouse', clientX, clientY });
  assert.equal(state.voice, false);
  ship.onPointerDown({ button: 0, pointerType: 'mouse', clientX: 0, clientY: 0 });
  ship.onKeyDown(key('Digit1'));
  ship.clearInput();
  assert.equal(state.talking, false);
  ship.setCameraMode('third');
  assert.equal(pad.open, false);
  assert.equal(pad.visible, false);
});

test('the frame renders first-person hands after the ship with fresh depth', () => {
  const ship = createShip();
  const { pad } = createPad();
  ship.startFirstPerson(pad);
  ship.frame();
  assert.equal(ship.renders.length, 3);
  assert.equal(ship.renders[1], 'depth');
  assert.equal(ship.renders[2], pad.scene);
  ship.renders.length = 0;
  ship.setCameraMode('third');
  ship.frame();
  assert.equal(ship.renders.length, 1);
});
