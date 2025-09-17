const PROGRESS_STORAGE_KEY = 'memory-palace-progress-v1';
const SAVED_PALACES_STORAGE_KEY = 'memory-palace-saves-v1';
const STATUS_MAX_LINES = 80;
const PLACEHOLDER_IMAGE_SRC = '#placeholder-image';
const ANCHOR_PANEL_COLOR = '#f8fafc';
const TEXT_FONT_URL = 'https://cdn.jsdelivr.net/gh/etiennepinchon/aframe-fonts@latest/fonts/roboto/Roboto-Regular-msdf.json';
const PANEL_WIDTH = 2.2;
const PANEL_HEIGHT = 2.6;
const IMAGE_WIDTH = 1.8;
const IMAGE_HEIGHT = 1.2;
const IMAGE_DEPTH_OFFSET = 0.05;

const state = {
  config: null,
  selectedFile: null,
  datasetSignature: null,
  rawAnchors: [],
  roomAssignments: new Map(),
  roomPages: new Map(),
  roomEntities: new Map(),
  anchorEntries: new Map(),
  assetRegistry: new Map(),
  currentRoomId: null,
  revealEnglish: false,
  audioQueueActive: false,
  progress: {
    seen: new Set(),
    heard: new Set(),
    signature: null
  },
  currentTSVText: null,
  currentAssetRoot: null,
  currentDatasetLabel: null,
  savedPalaces: [],
  currentSavedId: null
};

const dom = {
  scene: document.querySelector('#scene'),
  assetManager: document.querySelector('#asset-manager'),
  playerRig: document.querySelector('#player-rig'),
  tsvInput: document.querySelector('#tsv-input'),
  assetRootInput: document.querySelector('#asset-root'),
  loadButton: document.querySelector('#load-button'),
  searchInput: document.querySelector('#search-input'),
  toggleReveal: document.querySelector('#toggle-reveal'),
  playRoomAudio: document.querySelector('#play-room-audio'),
  saveNameInput: document.querySelector('#save-name'),
  saveButton: document.querySelector('#save-button'),
  savedList: document.querySelector('#saved-list'),
  statusLog: document.querySelector('#status-log'),
  roomList: document.querySelector('#room-list'),
  miniMap: document.querySelector('#mini-map'),
  pagination: document.querySelector('#room-pagination'),
  prevPage: document.querySelector('#prev-page'),
  nextPage: document.querySelector('#next-page'),
  pageLabel: document.querySelector('#page-label'),
  toast: document.querySelector('#toast'),
  progressSeen: document.querySelector('[data-progress="seen"]'),
  progressHeard: document.querySelector('[data-progress="heard"]')
};

init().catch(err => {
  logStatus(`Fatal error during init: ${err.message}`, 'error');
  console.error(err);
});

async function init() {
  bindUI();

  try {
    const config = await fetchConfig();
    state.config = config;
    if (config && config.assetRoot) {
      dom.assetRootInput.placeholder = config.assetRoot;
    }
    logStatus('Config loaded. Ready for TSV import.');
  } catch (error) {
    logStatus(`Unable to load config.json: ${error.message}`, 'error');
    throw error;
  }

  buildRooms();
  loadStoredProgress();
  updateProgressDisplay();
  loadSavedPalaces();
  renderSavedPalaces();
  updateSaveButtonState();

  if (state.config.roomOrder && state.config.roomOrder.length) {
    setActiveRoom(state.config.roomOrder[0]);
  }
}

function bindUI() {
  dom.tsvInput.addEventListener('change', event => {
    state.selectedFile = event.target.files?.[0] ?? null;
    dom.loadButton.disabled = !state.selectedFile;
    if (state.selectedFile) {
      logStatus(`Selected TSV file: ${state.selectedFile.name}`);
    }
  });

  dom.assetRootInput.addEventListener('input', () => {
    // No immediate action needed; read during load.
  });

  dom.loadButton.addEventListener('click', async () => {
    if (!state.selectedFile) {
      return;
    }
    await buildPalaceFromTSV(state.selectedFile);
  });

  dom.searchInput.addEventListener('input', handleSearch);

  dom.toggleReveal.addEventListener('click', () => {
    state.revealEnglish = !state.revealEnglish;
    dom.toggleReveal.classList.toggle('active', state.revealEnglish);
    dom.toggleReveal.textContent = state.revealEnglish ? 'Hide English' : 'Reveal English';
    updateRevealState();
  });

  dom.playRoomAudio.addEventListener('click', () => {
    if (!state.currentRoomId) {
      return;
    }
    queueRoomAudio(state.currentRoomId).catch(err => {
      logStatus(`Audio queue error: ${err.message}`, 'error');
      console.error(err);
    });
  });

  dom.saveNameInput?.addEventListener('input', () => {
    if (dom.saveNameInput.dataset) {
      dom.saveNameInput.dataset.autofill = 'false';
    }
    updateSaveButtonState();
  });
  dom.saveButton?.addEventListener('click', saveCurrentPalace);

  dom.prevPage.addEventListener('click', () => {
    changeRoomPage(-1);
  });

  dom.nextPage.addEventListener('click', () => {
    changeRoomPage(1);
  });
}

async function fetchConfig() {
  const response = await fetch('config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function buildRooms() {
  clearExistingRooms();
  const { roomOrder, rooms } = state.config;
  if (!Array.isArray(roomOrder)) {
    logStatus('Missing roomOrder in config.json', 'error');
    return;
  }

  roomOrder.forEach(roomId => {
    const roomConfig = rooms?.[roomId];
    if (!roomConfig) {
      logStatus(`Room config missing for id "${roomId}"`, 'error');
      return;
    }

    const roomEntity = document.createElement('a-entity');
    roomEntity.setAttribute('id', `room-${roomId}`);
    roomEntity.setAttribute('position', vecToString(roomConfig.position ?? { x: 0, y: 0, z: 0 }));

    const anchorContainer = document.createElement('a-entity');
    anchorContainer.setAttribute('class', 'anchor-container');
    roomEntity.appendChild(anchorContainer);

    const focusTarget = document.createElement('a-entity');
    focusTarget.setAttribute('id', `room-${roomId}-focus`);
    focusTarget.setAttribute('position', '0 1.6 0');
    roomEntity.appendChild(focusTarget);

    createRoomShell(roomEntity, roomConfig);
    createTeleportHotspot(roomEntity, roomConfig, roomId);
    decorateRoom(roomId, roomEntity, roomConfig);

    dom.scene.appendChild(roomEntity);

    state.roomEntities.set(roomId, {
      entity: roomEntity,
      anchorContainer,
      focusTarget,
      config: roomConfig,
      currentPage: 0
    });
  });

  renderMiniMap();
  renderRoomButtons();
}

function clearExistingRooms() {
  state.roomEntities.forEach(room => {
    room.entity.remove();
  });
  state.roomEntities.clear();
}

function createRoomShell(roomEntity, roomConfig) {
  const { dimensions, theme } = roomConfig;
  const width = dimensions?.width ?? 12;
  const height = dimensions?.height ?? 4;
  const depth = dimensions?.depth ?? 12;

  const defaultFloor = theme === 'exterior' ? '#94d5a8' : '#dfe3f2';
  const defaultWall = theme === 'exterior' ? '#c8e6ff' : '#b8c2dd';
  const defaultCeiling = theme === 'exterior' ? '#f1f5f9' : '#e9ecf7';
  const floorColor = roomConfig.colors?.floor ?? defaultFloor;
  const wallColor = roomConfig.colors?.walls ?? defaultWall;
  const ceilingColor = roomConfig.colors?.ceiling ?? defaultCeiling;

  const floor = document.createElement('a-plane');
  floor.setAttribute('rotation', '-90 0 0');
  floor.setAttribute('width', width);
  floor.setAttribute('height', depth);
  floor.setAttribute('color', floorColor);
  floor.setAttribute('material', 'roughness: 0.75; metalness: 0.0');
  roomEntity.appendChild(floor);

  const ceiling = document.createElement('a-plane');
  ceiling.setAttribute('rotation', '90 0 0');
  ceiling.setAttribute('position', `0 ${height} 0`);
  ceiling.setAttribute('width', width);
  ceiling.setAttribute('height', depth);
  ceiling.setAttribute('color', ceilingColor);
  ceiling.setAttribute('opacity', theme === 'exterior' ? 0 : 1);
  roomEntity.appendChild(ceiling);

  if (theme !== 'exterior') {
    const walls = [
      { pos: `0 ${(height / 2)} ${-(depth / 2)}`, rot: '0 0 0' },
      { pos: `${width / 2} ${(height / 2)} 0`, rot: '0 -90 0' },
      { pos: `0 ${(height / 2)} ${depth / 2}`, rot: '0 180 0' },
      { pos: `${-(width / 2)} ${(height / 2)} 0`, rot: '0 90 0' }
    ];

    walls.forEach(({ pos, rot }) => {
      const wall = document.createElement('a-box');
      wall.setAttribute('width', rot === '0 0 0' || rot === '0 180 0' ? width : 0.25);
      wall.setAttribute('depth', rot === '0 0 0' || rot === '0 180 0' ? 0.25 : depth);
      wall.setAttribute('height', height);
      wall.setAttribute('color', wallColor);
      wall.setAttribute('opacity', 0.98);
      wall.setAttribute('position', pos);
      wall.setAttribute('rotation', rot);
      wall.setAttribute('material', 'side: double; roughness: 0.9');
      roomEntity.appendChild(wall);
    });
  } else {
    const boundary = document.createElement('a-ring');
    boundary.setAttribute('radius-inner', Math.min(width, depth) / 2 - 1);
    boundary.setAttribute('radius-outer', Math.min(width, depth) / 2);
    boundary.setAttribute('rotation', '-90 0 0');
    boundary.setAttribute('color', roomConfig.colors?.walls ?? '#7dc2d6');
    boundary.setAttribute('material', 'opacity: 0.2');
    roomEntity.appendChild(boundary);
  }
}

function createTeleportHotspot(roomEntity, roomConfig, roomId) {
  const pad = document.createElement('a-circle');
  pad.setAttribute('radius', 1.2);
  pad.setAttribute('rotation', '-90 0 0');
  pad.setAttribute('color', '#3bc9db');
  pad.setAttribute('material', 'opacity: 0.35; emissive: #3bc9db; emissiveIntensity: 0.5');
  pad.setAttribute('position', vecToString(roomConfig.spawnOffset ?? { x: 0, y: 0.01, z: 2 }));
  pad.setAttribute('class', 'teleport-pad');
  pad.addEventListener('click', () => {
    setActiveRoom(roomId, true);
  });
  roomEntity.appendChild(pad);
}

function decorateRoom(roomId, roomEntity, roomConfig) {
  switch (roomId) {
    case 'entrance':
      addEntranceDecor(roomEntity, roomConfig);
      break;
    case 'kitchen':
      addKitchenDecor(roomEntity, roomConfig);
      break;
    case 'park':
      addParkDecor(roomEntity, roomConfig);
      break;
    case 'bar':
      addBarDecor(roomEntity, roomConfig);
      break;
    case 'museum':
      addMuseumDecor(roomEntity, roomConfig);
      break;
    case 'living':
      addLivingRoomDecor(roomEntity, roomConfig);
      break;
    case 'clinic':
      addClinicDecor(roomEntity, roomConfig);
      break;
    case 'street':
      addStreetDecor(roomEntity, roomConfig);
      break;
    case 'school':
      addSchoolDecor(roomEntity, roomConfig);
      break;
    default:
      break;
  }
}

function vecToString(vec) {
  const x = Number(vec?.x ?? 0);
  const y = Number(vec?.y ?? 0);
  const z = Number(vec?.z ?? 0);
  return `${x} ${y} ${z}`;
}

function addEntranceDecor(parent, roomConfig) {
  const depth = roomConfig.dimensions?.depth ?? 12;
  const welcome = document.createElement('a-text');
  welcome.setAttribute('value', 'Memory Palace');
  welcome.setAttribute('font', TEXT_FONT_URL);
  welcome.setAttribute('color', '#ffffff');
  welcome.setAttribute('width', 8);
  welcome.setAttribute('align', 'center');
  welcome.setAttribute('position', `0 3.4 ${-(depth / 2) + 0.1}`);
  parent.appendChild(welcome);

  const ring = document.createElement('a-entity');
  ring.setAttribute('geometry', 'primitive: torus; radius: 1.2; radiusTubular: 0.05');
  ring.setAttribute('material', 'color: #3bc9db; emissive: #3bc9db; emissiveIntensity: 0.4');
  ring.setAttribute('rotation', '90 0 0');
  ring.setAttribute('position', '0 0.1 0');
  parent.appendChild(ring);

  const orb = document.createElement('a-sphere');
  orb.setAttribute('radius', 0.5);
  orb.setAttribute('color', '#ffd166');
  orb.setAttribute('position', '0 2.4 0');
  orb.setAttribute('animation', 'property: position; dir: alternate; dur: 4200; easing: easeInOutSine; loop: true; to: 0 2.8 0');
  parent.appendChild(orb);
}

function addKitchenDecor(parent, roomConfig) {
  const island = document.createElement('a-box');
  island.setAttribute('width', 3.6);
  island.setAttribute('height', 1);
  island.setAttribute('depth', 2);
  island.setAttribute('color', '#ffb74d');
  island.setAttribute('position', '0 0.5 0');
  parent.appendChild(island);

  for (let i = -1; i <= 1; i += 2) {
    const stool = document.createElement('a-cylinder');
    stool.setAttribute('radius', 0.35);
    stool.setAttribute('height', 0.6);
    stool.setAttribute('color', '#8d6e63');
    stool.setAttribute('position', `${i * 1.3} 0.3 1.4`);
    parent.appendChild(stool);
  }

  const fridge = document.createElement('a-box');
  fridge.setAttribute('width', 1.2);
  fridge.setAttribute('height', 2.4);
  fridge.setAttribute('depth', 1);
  fridge.setAttribute('color', '#cfd8dc');
  fridge.setAttribute('position', '-4.5 1.2 -3.5');
  parent.appendChild(fridge);
}

function addParkDecor(parent, roomConfig) {
  const width = roomConfig.dimensions?.width ?? 16;
  const depth = roomConfig.dimensions?.depth ?? 14;
  createTree(parent, { x: -width / 4, z: -depth / 4 });
  createTree(parent, { x: width / 4, z: depth / 4 });
  createTree(parent, { x: 0, z: depth / 3 }, 2.4);

  const path = document.createElement('a-plane');
  path.setAttribute('rotation', '-90 0 0');
  path.setAttribute('width', width * 0.6);
  path.setAttribute('height', depth * 0.3);
  path.setAttribute('color', '#d7ccc8');
  path.setAttribute('position', '0 0.02 0');
  parent.appendChild(path);
}

function createTree(parent, offsets, height = 2) {
  const trunk = document.createElement('a-cylinder');
  trunk.setAttribute('radius', 0.25);
  trunk.setAttribute('height', height);
  trunk.setAttribute('color', '#8d5524');
  trunk.setAttribute('position', `${offsets.x ?? 0} ${height / 2} ${offsets.z ?? 0}`);
  parent.appendChild(trunk);

  const canopy = document.createElement('a-sphere');
  canopy.setAttribute('radius', height * 0.6);
  canopy.setAttribute('color', '#58d68d');
  canopy.setAttribute('position', `${offsets.x ?? 0} ${height + height * 0.3} ${offsets.z ?? 0}`);
  parent.appendChild(canopy);
}

function addBarDecor(parent, roomConfig) {
  const counter = document.createElement('a-box');
  counter.setAttribute('width', 4.6);
  counter.setAttribute('height', 1.1);
  counter.setAttribute('depth', 1.2);
  counter.setAttribute('color', '#5e2a2a');
  counter.setAttribute('position', '-3.5 0.55 0');
  parent.appendChild(counter);

  for (let i = 0; i < 3; i += 1) {
    const stool = document.createElement('a-cylinder');
    stool.setAttribute('radius', 0.28);
    stool.setAttribute('height', 0.7);
    stool.setAttribute('color', '#d4a373');
    stool.setAttribute('position', `${-1.8 + i * 1.2} 0.35 1.5`);
    parent.appendChild(stool);
  }

  const lamp = document.createElement('a-entity');
  lamp.setAttribute('geometry', 'primitive: cone; radiusBottom: 0.5; radiusTop: 0.05; height: 1.2');
  lamp.setAttribute('material', 'color: #ffd166; emissive: #ffd166; emissiveIntensity: 0.5');
  lamp.setAttribute('position', '0 2.4 0');
  parent.appendChild(lamp);
}

function addMuseumDecor(parent, roomConfig) {
  const depth = roomConfig.dimensions?.depth ?? 14;
  for (let i = -1; i <= 1; i += 1) {
    const pedestal = document.createElement('a-box');
    pedestal.setAttribute('width', 0.9);
    pedestal.setAttribute('height', 1.2);
    pedestal.setAttribute('depth', 0.9);
    pedestal.setAttribute('color', '#f6f1e4');
    pedestal.setAttribute('position', `${i * 2.4} 0.6 0`);
    parent.appendChild(pedestal);

    const glow = document.createElement('a-sphere');
    glow.setAttribute('radius', 0.45);
    glow.setAttribute('color', '#ffe066');
    glow.setAttribute('position', `${i * 2.4} 1.5 0`);
    glow.setAttribute('material', 'emissive: #ffd43b; emissiveIntensity: 0.7');
    parent.appendChild(glow);
  }

  const skylight = document.createElement('a-plane');
  skylight.setAttribute('width', 5);
  skylight.setAttribute('height', 3);
  skylight.setAttribute('position', `0 ${(roomConfig.dimensions?.height ?? 6) - 0.1} 0`);
  skylight.setAttribute('rotation', '90 0 0');
  skylight.setAttribute('color', '#ffffff');
  skylight.setAttribute('material', 'opacity: 0.4; side: double');
  parent.appendChild(skylight);
}

function addLivingRoomDecor(parent, roomConfig) {
  const sofaBase = document.createElement('a-box');
  sofaBase.setAttribute('width', 3.2);
  sofaBase.setAttribute('height', 0.8);
  sofaBase.setAttribute('depth', 1.4);
  sofaBase.setAttribute('color', '#a29bfe');
  sofaBase.setAttribute('position', '0 0.4 -1.2');
  parent.appendChild(sofaBase);

  const sofaBack = document.createElement('a-box');
  sofaBack.setAttribute('width', 3.2);
  sofaBack.setAttribute('height', 1.2);
  sofaBack.setAttribute('depth', 0.4);
  sofaBack.setAttribute('color', '#6c5ce7');
  sofaBack.setAttribute('position', '0 1 -1.9');
  parent.appendChild(sofaBack);

  const rug = document.createElement('a-plane');
  rug.setAttribute('rotation', '-90 0 0');
  rug.setAttribute('width', 4);
  rug.setAttribute('height', 3);
  rug.setAttribute('color', '#fdcb6e');
  rug.setAttribute('position', '0 0.01 0.8');
  parent.appendChild(rug);
}

function addClinicDecor(parent, roomConfig) {
  const bed = document.createElement('a-box');
  bed.setAttribute('width', 2.6);
  bed.setAttribute('height', 0.5);
  bed.setAttribute('depth', 1);
  bed.setAttribute('color', '#c8e6ff');
  bed.setAttribute('position', '0 0.45 -1.2');
  parent.appendChild(bed);

  const headboard = document.createElement('a-box');
  headboard.setAttribute('width', 2.6);
  headboard.setAttribute('height', 1.2);
  headboard.setAttribute('depth', 0.2);
  headboard.setAttribute('color', '#90caf9');
  headboard.setAttribute('position', '0 1.1 -1.7');
  parent.appendChild(headboard);

  const curtain = document.createElement('a-plane');
  curtain.setAttribute('height', 2.5);
  curtain.setAttribute('width', 0.2);
  curtain.setAttribute('color', '#ffffff');
  curtain.setAttribute('position', '1.4 1.3 0');
  curtain.setAttribute('material', 'opacity: 0.4; side: double');
  parent.appendChild(curtain);

  const monitor = document.createElement('a-plane');
  monitor.setAttribute('width', 1.2);
  monitor.setAttribute('height', 0.8);
  monitor.setAttribute('color', '#0c5b88');
  monitor.setAttribute('position', '-3 1.6 0');
  parent.appendChild(monitor);
}

function addStreetDecor(parent, roomConfig) {
  const width = roomConfig.dimensions?.width ?? 18;
  const road = document.createElement('a-plane');
  road.setAttribute('rotation', '-90 0 0');
  road.setAttribute('width', width * 0.8);
  road.setAttribute('height', (roomConfig.dimensions?.depth ?? 14) * 0.6);
  road.setAttribute('color', '#263238');
  road.setAttribute('position', '0 0.02 0');
  parent.appendChild(road);

  const stripe = document.createElement('a-plane');
  stripe.setAttribute('rotation', '-90 0 0');
  stripe.setAttribute('width', width * 0.7);
  stripe.setAttribute('height', 0.1);
  stripe.setAttribute('color', '#f1f8e9');
  stripe.setAttribute('position', '0 0.03 0');
  parent.appendChild(stripe);

  const car = document.createElement('a-box');
  car.setAttribute('width', 2.4);
  car.setAttribute('height', 1);
  car.setAttribute('depth', 1.2);
  car.setAttribute('color', '#ff6b6b');
  car.setAttribute('position', '-2 0.5 -0.8');
  parent.appendChild(car);

  const carTop = document.createElement('a-box');
  carTop.setAttribute('width', 1.8);
  carTop.setAttribute('height', 0.6);
  carTop.setAttribute('depth', 1);
  carTop.setAttribute('color', '#ffe66d');
  carTop.setAttribute('position', '-2 1.1 -0.8');
  parent.appendChild(carTop);
}

function addSchoolDecor(parent, roomConfig) {
  for (let row = 0; row < 2; row += 1) {
    for (let col = -1; col <= 1; col += 1) {
      const desk = document.createElement('a-box');
      desk.setAttribute('width', 1.2);
      desk.setAttribute('height', 0.8);
      desk.setAttribute('depth', 0.8);
      desk.setAttribute('color', '#f4a261');
      desk.setAttribute('position', `${col * 1.8} 0.4 ${1.5 + row * 1.6}`);
      parent.appendChild(desk);
    }
  }

  const board = document.createElement('a-plane');
  board.setAttribute('width', 5);
  board.setAttribute('height', 2.2);
  board.setAttribute('color', '#264653');
  board.setAttribute('position', `0 2 ${(roomConfig.dimensions?.depth ?? 12) / -2 + 0.2}`);
  parent.appendChild(board);

  const chalk = document.createElement('a-text');
  chalk.setAttribute('value', 'Учитесь с удовольствием!');
  chalk.setAttribute('font', TEXT_FONT_URL);
  chalk.setAttribute('color', '#e9f5db');
  chalk.setAttribute('width', 4.5);
  chalk.setAttribute('align', 'center');
  chalk.setAttribute('position', `0 2.2 ${(roomConfig.dimensions?.depth ?? 12) / -2 + 0.1}`);
  parent.appendChild(chalk);
}

async function buildPalaceFromTSV(file) {
  const text = await readFileText(file);
  const assetRootInput = dom.assetRootInput.value.trim() || state.config.assetRoot || './';
  const assetRoot = sanitizeAssetRoot(assetRootInput);
  const label = file.name ?? 'Imported TSV';
  const loaded = loadDataset({ text, assetRoot, label, rememberAssetInput: false, savedId: null });
  if (loaded) {
    state.selectedFile = null;
    dom.tsvInput.value = '';
    dom.loadButton.disabled = true;
  }
}

function resetAnchorContainers() {
  state.roomEntities.forEach(roomState => {
    roomState.anchorContainer.innerHTML = '';
  });
  state.anchorEntries.clear();
}

function resetDynamicAssets() {
  const keep = new Set(['placeholder-image']);
  Array.from(dom.assetManager.children).forEach(child => {
    if (!keep.has(child.id)) {
      child.remove();
    }
  });
  state.assetRegistry.clear();
}

function sanitizeAssetRoot(input) {
  if (!input) return './';
  if (!input.endsWith('/')) {
    return `${input}/`;
  }
  return input;
}

function loadDataset({ text, assetRoot, label = 'Dataset', rememberAssetInput = true, savedId = null } = {}) {
  const records = parseTSV(text);
  if (!records.length) {
    logStatus('No valid rows found in TSV.', 'error');
    showToast('TSV appears to be empty.');
    return false;
  }

  const sanitizedRoot = sanitizeAssetRoot(assetRoot || state.config.assetRoot || './');
  const datasetSignature = createDatasetSignature(records);

  state.datasetSignature = datasetSignature;
  state.currentTSVText = text;
  state.currentAssetRoot = sanitizedRoot;
  state.currentDatasetLabel = label;
  state.currentSavedId = savedId;

  resetAnchorContainers();
  resetDynamicAssets();

  state.rawAnchors = records.map((rec, index) => ({
    ...rec,
    id: createAnchorId(rec, index),
    assetRoot: sanitizedRoot
  }));

  applyStoredProgressToAnchors(datasetSignature);

  assignAnchorsToRooms();
  renderRoomPages();
  updateRevealState();
  updateProgressDisplay();
  dom.searchInput.value = '';
  applySearchFilter('');

  if (!savedId && dom.saveNameInput) {
    const defaultName = (label || 'Dataset').replace(/\.[^/.]+$/, '');
    if (!dom.saveNameInput.value || dom.saveNameInput.dataset.autofill !== 'false') {
      dom.saveNameInput.value = defaultName;
      dom.saveNameInput.dataset.autofill = 'true';
    }
  }

  if (rememberAssetInput) {
    dom.assetRootInput.value = sanitizedRoot;
  }

  dom.saveButton.disabled = false;
  updateSaveButtonState();
  renderSavedPalaces();

  state.selectedFile = null;
  dom.tsvInput.value = '';
  dom.loadButton.disabled = true;

  logStatus(`Loaded ${state.rawAnchors.length} anchors from ${label}.`);
  showToast(savedId ? `Loaded saved layout “${label}”.` : 'Memory palace rebuilt.');
  return true;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file, 'utf-8');
  });
}

function parseTSV(text) {
  const lines = text.split(/\r?\n/);
  const results = [];
  lines.forEach((line, index) => {
    if (!line || !line.trim()) {
      return;
    }
    const parts = line.split('\t');
    if (parts.length < 4) {
      logStatus(`Skipping row ${index + 1}: expected 4 columns.`, 'warn');
      return;
    }

    const [ru, en, imgHtml, audioTag] = parts.map(chunk => chunk.trim());
    if (!ru && !en) {
      logStatus(`Skipping row ${index + 1}: missing text.`, 'warn');
      return;
    }
    const imageSrc = extractImageSrc(imgHtml);
    const audioSrc = extractAudioSrc(audioTag);

    results.push({
      ru,
      en,
      imageSrc,
      audioSrc,
      rowIndex: index
    });
  });
  return results;
}

function extractImageSrc(htmlSnippet) {
  if (!htmlSnippet) {
    return null;
  }
  const match = htmlSnippet.match(/src\s*=\s*["']([^"']+)["']/i);
  if (match) {
    return decodeHTMLEntities(match[1]);
  }
  return null;
}

function extractAudioSrc(audioTag) {
  if (!audioTag) {
    return null;
  }
  const match = audioTag.match(/\[sound:([^\]]+)\]/i);
  if (match) {
    return decodeHTMLEntities(match[1]);
  }
  return null;
}

function decodeHTMLEntities(str) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

function createDatasetSignature(records) {
  const source = records.map(r => `${r.ru}\u241F${r.en}\u241F${r.imageSrc ?? ''}\u241F${r.audioSrc ?? ''}`).join('\u241E');
  return hashString(source);
}

function createAnchorId(record, index) {
  const composite = `${record.ru}\u241F${record.en}\u241F${index}`;
  return `anchor-${hashString(composite)}`;
}

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function assignAnchorsToRooms() {
  state.roomAssignments.clear();
  state.roomPages.clear();
  state.anchorEntries.clear();

  const rooms = state.config.roomOrder ?? [];
  if (!rooms.length) {
    return;
  }
  const anchors = shuffle([...state.rawAnchors]);

  anchors.forEach((anchor, idx) => {
    const roomId = rooms[idx % rooms.length];
    if (!state.roomAssignments.has(roomId)) {
      state.roomAssignments.set(roomId, []);
    }
    state.roomAssignments.get(roomId).push(anchor);
  });

  rooms.forEach(roomId => {
    const roomAnchors = state.roomAssignments.get(roomId) ?? [];
    const capacity = getRoomCapacity(roomId);
    const pages = paginate(roomAnchors, capacity);
    state.roomPages.set(roomId, pages);
    const roomState = state.roomEntities.get(roomId);
    if (roomState) {
      roomState.currentPage = 0;
    }
  });
}

function getRoomCapacity(roomId) {
  const cap = state.config.roomCap?.[roomId];
  if (typeof cap === 'number' && cap > 0) {
    return cap;
  }
  return state.config.roomCap?.default ?? 12;
}

function paginate(items, perPage) {
  if (perPage <= 0) {
    return [items];
  }
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages.length ? pages : [[]];
}

function renderRoomPages() {
  state.roomEntities.forEach((roomState, roomId) => {
    renderRoomAnchors(roomId);
  });
  updateRoomPageUI();
  applySearchFilter(dom.searchInput.value || '');
}

function renderRoomAnchors(roomId) {
  const roomState = state.roomEntities.get(roomId);
  if (!roomState) {
    return;
  }
  const { anchorContainer, config, currentPage } = roomState;
  anchorContainer.innerHTML = '';

  const pages = state.roomPages.get(roomId) ?? [[]];
  const anchors = pages[currentPage] ?? [];
  let overflowed = false;
  anchors.forEach((anchor, index) => {
    const anchorEntity = buildAnchorEntity(anchor, roomId, index, config);
    if (anchorEntity) {
      anchorContainer.appendChild(anchorEntity);
    } else {
      overflowed = true;
    }
  });

  if (overflowed) {
    logStatus(`Room ${roomId} is out of visible slots; consider increasing tiers or capacity.`, 'warn');
  }
}

function buildAnchorEntity(anchor, roomId, index, roomConfig) {
  const placement = roomConfig.grid ?? state.config.placement ?? { cols: 4, rows: 3, tiers: 2 };
  const cols = placement.cols ?? placement.gridCols ?? 4;
  const rows = placement.rows ?? placement.gridRows ?? 3;
  const tiers = Math.max(placement.tiers ?? 1, 1);
  const cellWidth = placement.cellWidth ?? state.config.placement?.cellWidth ?? 1.8;
  const cellHeight = placement.cellHeight ?? state.config.placement?.cellHeight ?? 1.6;
  const baseHeight = placement.baseHeight ?? state.config.placement?.baseHeight ?? 1.2;
  const depth = roomConfig.dimensions?.depth ?? 12;

  const slotsPerTier = cols * rows;
  const tierIndex = Math.floor(index / slotsPerTier);
  if (tierIndex >= tiers) {
    return null;
  }
  const slot = index % slotsPerTier;
  const row = Math.floor(slot / cols);
  const col = slot % cols;

  const centerX = (col - (cols - 1) / 2) * cellWidth;
  const totalHeight = (rows - 1) * cellHeight;
  const centerY = baseHeight + totalHeight / 2 - row * cellHeight;
  const wallOffset = depth / 2 - 0.4;
  const tierSign = tierIndex % 2 === 0 ? -1 : 1;
  const position = `${centerX} ${centerY} ${tierSign * wallOffset}`;
  const rotation = `0 ${tierSign === -1 ? 0 : 180} 0`;

  const wrapper = document.createElement('a-entity');
  wrapper.setAttribute('class', `anchor ${state.revealEnglish ? 'revealed' : 'anchor-hidden'}`);
  wrapper.setAttribute('id', anchor.id);
  wrapper.setAttribute('position', position);
  wrapper.setAttribute('rotation', rotation);
  wrapper.setAttribute('data-room-id', roomId);
  wrapper.setAttribute('data-anchor-id', anchor.id);

  const panel = document.createElement('a-plane');
  panel.setAttribute('width', PANEL_WIDTH);
  panel.setAttribute('height', PANEL_HEIGHT);
  panel.setAttribute('color', ANCHOR_PANEL_COLOR);
  panel.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.96');
  panel.setAttribute('position', '0 0 0');
  panel.setAttribute('class', 'anchor-backdrop');
  wrapper.appendChild(panel);

  const image = document.createElement('a-plane');
  image.setAttribute('width', IMAGE_WIDTH);
  image.setAttribute('height', IMAGE_HEIGHT);
  image.setAttribute('position', `0 0 ${IMAGE_DEPTH_OFFSET}`);
  image.setAttribute('class', 'anchor-image');

  const imageSrc = buildAssetUrl(anchor.imageSrc, anchor.assetRoot);
  if (imageSrc) {
    const assetId = ensureAsset(imageSrc, 'image');
    if (assetId) {
      image.setAttribute('material', `shader: flat; src: ${assetId}; transparent: true; color: #ffffff`);
    } else {
      image.setAttribute('material', `shader: flat; src: ${PLACEHOLDER_IMAGE_SRC}`);
      wrapper.dataset.missingImage = 'true';
    }
  } else {
    image.setAttribute('material', `shader: flat; src: ${PLACEHOLDER_IMAGE_SRC}`);
    wrapper.dataset.missingImage = 'true';
  }
  wrapper.appendChild(image);

  const ruText = document.createElement('a-text');
  ruText.setAttribute('value', anchor.ru ?? '');
  ruText.setAttribute('color', state.config.text?.ruColor ?? '#111');
  ruText.setAttribute('font', TEXT_FONT_URL);
  ruText.setAttribute('width', PANEL_WIDTH * 1.05);
  ruText.setAttribute('align', 'center');
  ruText.setAttribute('baseline', 'bottom');
  ruText.setAttribute('wrap-count', state.config.text?.wrapChars ?? 40);
  ruText.setAttribute('position', `0 ${(PANEL_HEIGHT / 2) - 0.45} ${IMAGE_DEPTH_OFFSET}`);
  ruText.setAttribute('shader', 'msdf');
  wrapper.appendChild(ruText);

  const enText = document.createElement('a-text');
  enText.setAttribute('value', anchor.en ?? '');
  enText.setAttribute('color', state.config.text?.enColor ?? '#444');
  enText.setAttribute('font', TEXT_FONT_URL);
  enText.setAttribute('width', PANEL_WIDTH * 1.05);
  enText.setAttribute('align', 'center');
  enText.setAttribute('baseline', 'top');
  enText.setAttribute('wrap-count', state.config.text?.wrapChars ?? 40);
  enText.setAttribute('position', `0 ${-(PANEL_HEIGHT / 2) + 0.55} ${IMAGE_DEPTH_OFFSET}`);
  enText.setAttribute('shader', 'msdf');
  enText.classList.add('en-label');
  if (enText.object3D) {
    enText.object3D.visible = state.revealEnglish;
  } else {
    enText.addEventListener('loaded', () => {
      if (enText.object3D) {
        enText.object3D.visible = state.revealEnglish;
      }
    }, { once: true });
  }
  wrapper.appendChild(enText);

  const hitbox = document.createElement('a-box');
  hitbox.setAttribute('width', PANEL_WIDTH + 0.2);
  hitbox.setAttribute('height', PANEL_HEIGHT + 0.3);
  hitbox.setAttribute('depth', 0.6);
  hitbox.setAttribute('material', 'opacity: 0; transparent: true');
  hitbox.setAttribute('position', '0 0 0.15');
  hitbox.setAttribute('class', 'anchor-hitbox');
  wrapper.appendChild(hitbox);

  let audioEntity = null;
  const audioSrc = buildAssetUrl(anchor.audioSrc, anchor.assetRoot);
  if (audioSrc) {
    const audioAssetId = ensureAsset(audioSrc, 'audio');
    if (audioAssetId) {
      audioEntity = document.createElement('a-entity');
      const volume = state.config.audio?.volume ?? 1.0;
      audioEntity.setAttribute('sound', `src: ${audioAssetId}; autoplay: false; positional: false; volume: ${volume}`);
      wrapper.appendChild(audioEntity);
    } else {
      wrapper.dataset.missingAudio = 'true';
    }
  } else {
    wrapper.dataset.missingAudio = 'true';
  }

  if (!audioEntity) {
    const muteIndicator = document.createElement('a-text');
    muteIndicator.setAttribute('value', '[mute]');
    muteIndicator.setAttribute('color', '#888');
    muteIndicator.setAttribute('align', 'center');
    muteIndicator.setAttribute('width', 1.2);
    muteIndicator.setAttribute('position', '0 -1.1 0.02');
    muteIndicator.setAttribute('shader', 'msdf');
    wrapper.appendChild(muteIndicator);
  }

  wrapper.addEventListener('mouseenter', () => {
    markAnchorSeen(anchor.id);
  });

  wrapper.addEventListener('click', () => {
    playAnchorAudio(anchor.id);
  });

  state.anchorEntries.set(anchor.id, {
    item: anchor,
    roomId,
    entity: wrapper,
    panel,
    enText,
    audioEntity
  });

  return wrapper;
}

function buildAssetUrl(path, assetRoot) {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) {
    return path;
  }
  return `${assetRoot || ''}${path}`;
}

function ensureAsset(url, type) {
  if (!url) {
    return null;
  }
  if (state.assetRegistry.has(url)) {
    return state.assetRegistry.get(url);
  }
  const id = `asset-${hashString(url)}`;
  if (dom.assetManager.querySelector(`#${CSS.escape(id)}`)) {
    state.assetRegistry.set(url, `#${id}`);
    return `#${id}`;
  }
  try {
    let assetEl;
    if (type === 'image') {
      assetEl = document.createElement('img');
    } else if (type === 'audio') {
      assetEl = document.createElement('audio');
      assetEl.setAttribute('preload', 'auto');
    } else {
      assetEl = document.createElement('template');
    }
    assetEl.setAttribute('id', id);
    assetEl.setAttribute('crossorigin', 'anonymous');
    assetEl.setAttribute('src', url);
    assetEl.addEventListener('error', () => {
      logStatus(`Failed to load ${type} asset: ${url}`, 'warn');
    });
    dom.assetManager.appendChild(assetEl);
    state.assetRegistry.set(url, `#${id}`);
    return `#${id}`;
  } catch (error) {
    logStatus(`Unable to register asset ${url}: ${error.message}`, 'warn');
    return null;
  }
}

function renderMiniMap() {
  dom.miniMap.innerHTML = '';
  const order = state.config.roomOrder ?? [];
  order.forEach(roomId => {
    const roomConfig = state.config.rooms?.[roomId];
    if (!roomConfig) return;
    const div = document.createElement('div');
    div.className = 'mini-room';
    div.dataset.roomId = roomId;
    div.textContent = roomConfig.label ?? roomId;
    div.addEventListener('click', () => setActiveRoom(roomId, true));
    dom.miniMap.appendChild(div);
  });
  updateMiniMapActive();
}

function renderRoomButtons() {
  dom.roomList.innerHTML = '';
  const order = state.config.roomOrder ?? [];
  order.forEach(roomId => {
    const roomConfig = state.config.rooms?.[roomId];
    if (!roomConfig) return;
    const button = document.createElement('button');
    button.className = 'room-button';
    button.dataset.roomId = roomId;
    button.innerHTML = `${roomConfig.label ?? roomId}<span>${roomId}</span>`;
    button.addEventListener('click', () => setActiveRoom(roomId, true));
    dom.roomList.appendChild(button);
  });
  updateRoomButtonActive();
}

function setActiveRoom(roomId, teleport = false) {
  const roomState = state.roomEntities.get(roomId);
  if (!roomState) {
    logStatus(`Cannot activate unknown room ${roomId}`, 'error');
    return;
  }
  state.currentRoomId = roomId;
  updateMiniMapActive();
  updateRoomButtonActive();
  updateRoomPageUI();

  if (teleport) {
    const spawn = roomState.config.spawnOffset ?? { x: 0, y: 0, z: 0 };
    const roomPos = roomState.config.position ?? { x: 0, y: 0, z: 0 };
    const target = {
      x: (roomPos.x ?? 0) + (spawn.x ?? 0),
      y: (roomPos.y ?? 0) + 1.6,
      z: (roomPos.z ?? 0) + (spawn.z ?? 0)
    };
    dom.playerRig.setAttribute('position', vecToString(target));
    logStatus(`Teleported to ${roomState.config.label ?? roomId}.`);
  }
}

function updateMiniMapActive() {
  const roomId = state.currentRoomId;
  Array.from(dom.miniMap.children).forEach(child => {
    child.classList.toggle('active', child.dataset.roomId === roomId);
  });
}

function updateRoomButtonActive() {
  const roomId = state.currentRoomId;
  Array.from(dom.roomList.children).forEach(child => {
    child.classList.toggle('active', child.dataset.roomId === roomId);
  });
}

function changeRoomPage(delta) {
  if (!state.currentRoomId) return;
  const roomState = state.roomEntities.get(state.currentRoomId);
  if (!roomState) return;
  const pages = state.roomPages.get(state.currentRoomId) ?? [[]];
  const nextIndex = clamp(roomState.currentPage + delta, 0, pages.length - 1);
  if (nextIndex !== roomState.currentPage) {
    roomState.currentPage = nextIndex;
    renderRoomAnchors(state.currentRoomId);
    updateRevealState();
    updateRoomPageUI();
    applySearchFilter(dom.searchInput.value || '');
  }
}

function updateRoomPageUI() {
  if (!state.currentRoomId) {
    dom.pagination.hidden = true;
    return;
  }
  const roomState = state.roomEntities.get(state.currentRoomId);
  const pages = state.roomPages.get(state.currentRoomId) ?? [[]];
  const totalPages = pages.length;
  if (totalPages > 1) {
    dom.pagination.hidden = false;
    dom.pageLabel.textContent = `Page ${roomState.currentPage + 1} / ${totalPages}`;
    dom.prevPage.disabled = roomState.currentPage <= 0;
    dom.nextPage.disabled = roomState.currentPage >= totalPages - 1;
  } else {
    dom.pagination.hidden = true;
  }
}

function handleSearch(event) {
  applySearchFilter(event.target.value);
}

function applySearchFilter(rawQuery = '') {
  const query = rawQuery.trim().toLowerCase();
  let matches = 0;
  state.anchorEntries.forEach(entry => {
    if (!entry?.entity) return;
    if (!query) {
      entry.entity.object3D.visible = true;
      entry.entity.classList.remove('anchor-highlighted');
      if (entry.panel) {
        entry.panel.setAttribute('color', ANCHOR_PANEL_COLOR);
      }
      return;
    }
    const combined = `${entry.item.ru ?? ''} ${entry.item.en ?? ''}`.toLowerCase();
    const match = combined.includes(query);
    entry.entity.object3D.visible = match;
    entry.entity.classList.toggle('anchor-highlighted', match);
    if (entry.panel) {
      entry.panel.setAttribute('color', match ? '#fff4d6' : ANCHOR_PANEL_COLOR);
    }
    if (match) {
      matches += 1;
    }
  });
  if (query) {
    logStatus(`Search matches: ${matches}`);
  }
}

function updateRevealState() {
  state.anchorEntries.forEach(entry => {
    if (!entry?.entity) return;
    entry.entity.classList.toggle('revealed', state.revealEnglish);
    if (entry.enText && entry.enText.object3D) {
      entry.enText.object3D.visible = state.revealEnglish;
    }
  });
}

function playAnchorAudio(anchorId) {
  const entry = state.anchorEntries.get(anchorId);
  if (!entry) {
    logStatus(`Audio request for unknown anchor ${anchorId}`, 'warn');
    return;
  }
  const { audioEntity, entity, panel } = entry;
  if (!audioEntity) {
    showToast('No audio clip available.');
    if (panel) {
      panel.setAttribute('animation__flash', 'property: color; from: #ffe5e5; to: #f8fafc; dur: 160; dir: alternate; loop: 4');
    }
    return;
  }
  const sound = audioEntity.components.sound;
  if (!sound) {
    return;
  }
  sound.stopSound();
  sound.playSound();
  markAnchorHeard(anchorId);
}

async function queueRoomAudio(roomId) {
  if (state.audioQueueActive) {
    return;
  }
  const roomState = state.roomEntities.get(roomId);
  if (!roomState) return;
  const pages = state.roomPages.get(roomId) ?? [[]];
  const anchors = pages[roomState.currentPage] ?? [];
  const playable = anchors
    .map(anchor => state.anchorEntries.get(anchor.id))
    .filter(entry => entry?.audioEntity?.components?.sound);

  if (!playable.length) {
    showToast('No audio available on this page.');
    return;
  }

  state.audioQueueActive = true;
  dom.playRoomAudio.disabled = true;
  logStatus(`Playing ${playable.length} audio clip(s) in sequence.`);

  for (let i = 0; i < playable.length; i += 1) {
    const entry = playable[i];
    await playSoundOnce(entry.audioEntity);
    markAnchorHeard(entry.item.id);
  }

  state.audioQueueActive = false;
  dom.playRoomAudio.disabled = false;
  logStatus('Audio queue finished.');
}

function playSoundOnce(audioEntity) {
  return new Promise(resolve => {
    const sound = audioEntity.components.sound;
    if (!sound) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audioEntity.removeEventListener('sound-ended', finish);
      resolve();
    };
    audioEntity.addEventListener('sound-ended', finish, { once: true });
    sound.stopSound();
    sound.playSound();
    setTimeout(finish, 6000);
  });
}

function markAnchorSeen(anchorId) {
  if (!state.progress.seen.has(anchorId)) {
    state.progress.seen.add(anchorId);
    updateProgressDisplay();
    persistProgress();
  }
}

function markAnchorHeard(anchorId) {
  if (!state.progress.heard.has(anchorId)) {
    state.progress.heard.add(anchorId);
    updateProgressDisplay();
    persistProgress();
  }
}

function updateProgressDisplay() {
  const total = state.rawAnchors.length || 0;
  dom.progressSeen.textContent = `Seen: ${state.progress.seen.size} / ${total}`;
  dom.progressHeard.textContent = `Heard: ${state.progress.heard.size} / ${total}`;
}

function persistProgress() {
  if (!state.datasetSignature) {
    return;
  }
  try {
    const payload = {
      signature: state.datasetSignature,
      seen: Array.from(state.progress.seen),
      heard: Array.from(state.progress.heard)
    };
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    logStatus(`Failed to persist progress: ${error.message}`, 'warn');
  }
}

function loadStoredProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.seen) && Array.isArray(parsed.heard)) {
      state.progress.signature = parsed.signature ?? null;
      state.progress.seen = new Set(parsed.seen);
      state.progress.heard = new Set(parsed.heard);
    }
  } catch (error) {
    logStatus(`Unable to parse stored progress: ${error.message}`, 'warn');
  }
}

function applyStoredProgressToAnchors(signature) {
  if (!signature || state.progress.signature !== signature) {
    state.progress.signature = signature;
    state.progress.seen = new Set();
    state.progress.heard = new Set();
    persistProgress();
  }
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateSaveButtonState() {
  if (!dom.saveButton) return;
  const hasDataset = Boolean(state.currentTSVText);
  const name = dom.saveNameInput?.value.trim() ?? '';
  dom.saveButton.disabled = !(hasDataset && name.length >= 2);
}

function saveCurrentPalace() {
  if (!state.currentTSVText) {
    showToast('Load a TSV before saving.');
    return;
  }
  const name = dom.saveNameInput.value.trim();
  if (name.length < 2) {
    showToast('Name must be at least 2 characters.');
    return;
  }

  const entry = {
    id: `${Date.now()}-${hashString(name + state.datasetSignature)}`,
    name,
    savedAt: Date.now(),
    tsvText: state.currentTSVText,
    assetRoot: state.currentAssetRoot,
    datasetSignature: state.datasetSignature
  };

  state.savedPalaces = [entry, ...state.savedPalaces.filter(item => item.name !== name)].slice(0, 12);
  state.currentSavedId = entry.id;
  persistSavedPalaces();
  renderSavedPalaces();
  if (dom.saveNameInput.dataset) {
    dom.saveNameInput.dataset.autofill = 'false';
  }
  showToast(`Saved layout “${name}”.`);
}

function loadSavedPalaces() {
  try {
    const raw = localStorage.getItem(SAVED_PALACES_STORAGE_KEY);
    if (!raw) {
      state.savedPalaces = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.savedPalaces = parsed.filter(item => typeof item?.tsvText === 'string');
    } else {
      state.savedPalaces = [];
    }
  } catch (error) {
    logStatus(`Unable to read saved layouts: ${error.message}`, 'warn');
    state.savedPalaces = [];
  }
}

function persistSavedPalaces() {
  try {
    localStorage.setItem(SAVED_PALACES_STORAGE_KEY, JSON.stringify(state.savedPalaces));
  } catch (error) {
    logStatus(`Failed to store layouts: ${error.message}`, 'warn');
  }
}

function renderSavedPalaces() {
  if (!dom.savedList) return;
  dom.savedList.innerHTML = '';

  if (!state.savedPalaces.length) {
    const empty = document.createElement('div');
    empty.className = 'saved-empty';
    empty.textContent = 'No saved layouts yet.';
    dom.savedList.appendChild(empty);
    return;
  }

  state.savedPalaces.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    if (state.currentSavedId === entry.id) {
      item.classList.add('active');
    }

    const loadBtn = document.createElement('button');
    loadBtn.className = 'saved-load';
    loadBtn.textContent = entry.name;
    loadBtn.addEventListener('click', () => {
      const loaded = loadDataset({
        text: entry.tsvText,
        assetRoot: entry.assetRoot,
        label: entry.name,
        rememberAssetInput: true,
        savedId: entry.id
      });
      if (loaded) {
        dom.saveNameInput.value = entry.name;
        if (dom.saveNameInput.dataset) {
          dom.saveNameInput.dataset.autofill = 'false';
        }
        updateSaveButtonState();
      }
    });

    const meta = document.createElement('span');
    meta.className = 'saved-meta';
    meta.textContent = new Date(entry.savedAt).toLocaleString();

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'saved-delete';
    deleteBtn.setAttribute('aria-label', `Delete ${entry.name}`);
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      deleteSavedPalace(entry.id);
    });

    item.appendChild(loadBtn);
    item.appendChild(meta);
    item.appendChild(deleteBtn);
    dom.savedList.appendChild(item);
  });
}

function deleteSavedPalace(id) {
  state.savedPalaces = state.savedPalaces.filter(entry => entry.id !== id);
  if (state.currentSavedId === id) {
    state.currentSavedId = null;
  }
  persistSavedPalaces();
  renderSavedPalaces();
  showToast('Deleted saved layout.');
}

function logStatus(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `status-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  dom.statusLog.prepend(entry);
  while (dom.statusLog.children.length > STATUS_MAX_LINES) {
    dom.statusLog.removeChild(dom.statusLog.lastChild);
  }
}

let toastTimeout = null;
function showToast(message, duration = 1800) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    dom.toast.classList.remove('visible');
  }, duration);
}
