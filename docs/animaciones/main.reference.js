import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// --- CONFIGURACIÓN BASE ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x282828);

scene.fog = new THREE.FogExp2(0x22272b, 0.02
);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const initialCameraPos = { x: -7, y: 7, z: 4 };
camera.position.set(initialCameraPos.x, initialCameraPos.y, initialCameraPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 8;
controls.maxDistance = 15;
controls.zoomSpeed = 0.5; // <-- AÑADE ESTA LÍNEA PARA SUAVIZAR EL ZOOM

// --- ILUMINACIÓN ARTÍSTICA ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 6.0);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.0001;
scene.add(dirLight);

const pointLight = new THREE.PointLight(0xffffff, 30, 30);
pointLight.position.set(-5, 4, -2);
scene.add(pointLight);

// --- CONFIGURACIÓN DE DRACO DECODER ---
const dracoLoader = new DRACOLoader();
// Apuntamos al CDN oficial de Three.js para descargar los decodificadores WebAssembly automáticamente
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// --- CONFIGURACIÓN DE ANIMACIONES ---
const mixers = [];

const animConfigs = {
  'glb/Cangrejo_Ani.glb': [
    { name: 'Idle', loops: 6 },
    { name: 'Walk', loops: 4 }
  ],
  'glb/Pava_Ani.glb': [
    { name: 'Idle', loops: 1 },
    { name: 'Sing', loops: 1 }
  ],
  'glb/Tortuga_Ani.glb': [
    { name: 'Swin', loops: 4 }, 
    { name: 'Idle', loops: 6 }
  ],
  'glb/Ballena_Ani.glb': [
    { name: 'Swin', loops: 2 }, 
    { name: 'Jump', loops: 1 }
  ]
};

// --- RUTA Y CONFIGURACIÓN DE TUS MODELOS GLB ---
const projectsData = [
  {
    file: 'glb/Tortuga_Ani.glb',
    scale: 60,
    position: { x: 0, y: 0, z: 0 },
    name: 'Tortuga' // NUEVO
  },
  {
    file: 'glb/Cangrejo_Ani.glb',
    scale: 25,
    position: { x: 0, y: 0, z: 0 },
    name: 'Cangrejo' // NUEVO
  },
  {
    file: 'glb/Pava_Ani.glb',
    scale: 36,
    position: { x: 0, y: 0, z: 0 },
    name: 'Pava' // NUEVO
  },
  {
    file: 'glb/Ballena_Ani.glb',
    scale: 17,
    position: { x: 0, y: 0, z: 0 },
    name: 'Ballena' // NUEVO
  }
];

// Aseguramos el orden exacto de los modelos para la navegación
const interactiveObjects = new Array(projectsData.length);

projectsData.forEach((data, index) => {
  gltfLoader.load(
    data.file,
    (gltf) => {
      const model = gltf.scene;

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      model.scale.setScalar(data.scale);
      model.position.set(data.position.x, data.position.y, data.position.z);
      
      model.userData = { ...data, initialY: data.position.y, animIndex: index };

      // OCULTAR TODOS EXCEPTO EL PRIMERO AL CARGAR
      model.visible = (index === 0);

      scene.add(model);
      interactiveObjects[index] = model; // Guardarlo en su posición exacta

      // --- LÓGICA DE CONTROL DE ANIMACIONES ---
      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        mixers.push(mixer);

        const config = animConfigs[data.file];
        if (config) {
          const actions = config.map(cfg => {
            const clip = gltf.animations.find(a => a.name === cfg.name);
            return clip ? { clip, action: mixer.clipAction(clip), loops: cfg.loops } : null;
          }).filter(a => a !== null);

          if (actions.length > 0) {
            let currentIdx = 0;
            let loopCount = 0;

            actions[currentIdx].action.play();

            // NUEVO: Guardar la animación actual y actualizar UI si el modelo es visible
            model.userData.currentAnimation = actions[currentIdx].clip.name;
            if (model.visible) {
              document.getElementById('character-name').innerText = data.name;
              document.getElementById('animation-name').innerText = model.userData.currentAnimation;
            }

            mixer.addEventListener('loop', (e) => {
              if (e.action === actions[currentIdx].action) {
                loopCount++;
                
                if (loopCount >= actions[currentIdx].loops) {
                  loopCount = 0;
                  const prevAction = actions[currentIdx].action;
                  currentIdx = (currentIdx + 1) % actions.length;
                  const nextAction = actions[currentIdx].action;

                  // NUEVO: Guardar la nueva animación y actualizar UI solo si el personaje está en pantalla
                  const nextAnimName = actions[currentIdx].clip.name;
                  model.userData.currentAnimation = nextAnimName;
                  if (model.visible) {
                    document.getElementById('animation-name').innerText = nextAnimName;
                  }
                  
                  nextAction.reset();
                  nextAction.play();
                  prevAction.crossFadeTo(nextAction, 0.5, false);
                }
              }
            });
          }
        }
      }
    },
    (xhr) => {
      console.log(`Cargando ${data.file}: ${(xhr.loaded / xhr.total) * 100}%`);
    },
    (error) => {
      console.error(`Error al cargar ${data.file}:`, error);
    }
  );
});

// --- RAYCASTING E INTERACCIÓN ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredObject = null;

function selectProject(model) {
  const data = model.userData;

  document.getElementById('project-tag').innerText = data.category;
  document.getElementById('project-title').innerText = data.title;
  document.getElementById('project-desc').innerText = data.desc;
  document.getElementById('info-panel').classList.add('active');

  gsap.to(camera.position, {
    x: model.position.x + 2.5,
    y: model.position.y + 1.8,
    z: model.position.z + 3.5,
    duration: 1.5,
    ease: 'power3.inOut'
  });

  gsap.to(controls.target, {
    x: model.position.x,
    y: model.position.y + 0.5,
    z: model.position.z,
    duration: 1.5,
    ease: 'power3.inOut'
  });
}

document.getElementById('close-panel').addEventListener('click', () => {
  document.getElementById('info-panel').classList.remove('active');
  resetCamera();
});

window.focusSection = function (section) {
  document.getElementById('info-panel').classList.remove('active');
  if (section === 'overview' || section === 'projects') {
    resetCamera();
  } else if (section === 'about') {
    gsap.to(camera.position, { x: 0, y: 8, z: 0.1, duration: 2, ease: 'power3.inOut' });
    gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 2, ease: 'power3.inOut' });
  }
};

function resetCamera() {
  gsap.to(camera.position, {
    x: initialCameraPos.x,
    y: initialCameraPos.y,
    z: initialCameraPos.z,
    duration: 1.5,
    ease: 'power3.inOut'
  });
  gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.5, ease: 'power3.inOut' });
}

// --- BUCLE DE ANIMACIÓN ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  mixers.forEach(mixer => mixer.update(delta));
  
  controls.update();
  renderer.render(scene, camera);
}

animate();

// --- LÓGICA DE NAVEGACIÓN DE PERSONAJES (CARRUSEL) ---
let currentModelIndex = 0;

function showModel(index) {
  // Recorremos todos los modelos y solo dejamos visible el correspondiente
  interactiveObjects.forEach((model, i) => {
    if (model) {
      model.visible = (i === index);
    }
  });
  
  // NUEVO: Actualizar los textos de la interfaz al cambiar de personaje
  const currentData = projectsData[index];
  const currentModel = interactiveObjects[index];
  
  document.getElementById('character-name').innerText = currentData.name;
  
  // Si el modelo actual ya tiene una animación cargada, la mostramos; si no, ponemos "..."
  if (currentModel && currentModel.userData.currentAnimation) {
    document.getElementById('animation-name').innerText = currentModel.userData.currentAnimation;
  } else {
    document.getElementById('animation-name').innerText = "...";
  }
  
  // Opcional: Reiniciar la posición de la cámara al cambiar de personaje
  resetCamera();
}

document.getElementById('btn-next').addEventListener('click', () => {
  // Verificamos si los modelos ya terminaron de cargar
  if (!interactiveObjects[0]) return; 
  
  currentModelIndex = (currentModelIndex + 1) % interactiveObjects.length;
  showModel(currentModelIndex);
});

document.getElementById('btn-prev').addEventListener('click', () => {
  if (!interactiveObjects[0]) return;
  
  // Fórmula para restar en un bucle (evita números negativos)
  currentModelIndex = (currentModelIndex - 1 + interactiveObjects.length) % interactiveObjects.length;
  showModel(currentModelIndex);
});

// --- RESPONSIVIDAD Y AJUSTE DE CÁMARA 3D ---
function updateResponsiveCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;

  // Si la pantalla es vertical (móvil portrait), alejamos la cámara para abarcar todo el escenario
  if (aspect < 1) {
    camera.position.z = initialCameraPos.z * (1 / aspect) * 0.65;
  } else {
    camera.position.z = initialCameraPos.z;
  }

  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Ejecutar al cambiar el tamaño de ventana
window.addEventListener('resize', updateResponsiveCamera);

// Ejecutar una vez al inicio para detectar si entra directamente desde un celular
updateResponsiveCamera();