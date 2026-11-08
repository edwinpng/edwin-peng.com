// --- 1. DOM ELEMENTS & LAYOUT LOGIC ---
const panels = document.querySelectorAll('.panel');
const travelPanel = document.getElementById('travel');
const travelPreview = travelPanel.querySelector('.panel-preview');

// --- EXPANDED TWEAK CONFIGURATION ---
const CONFIG = {
    tour: {
        idlePauseMs: 6000,          
        inspectionPauseMs: 2000,    
        tourDriftSpeed: 0.0002,     
        manualDriftSpeed: -0.2,     
        camPanSpeed: 0.015,         
        targetPanSpeed: 0.03        
    },
    viewport: {
        fov: 75,                    
        initialZoom: 45,            
        minZoom: 65,                // FIXED: Highest value (furthest we can zoom out)
        maxZoom: 17,                // FIXED: Lowest value (closest we can zoom in)
        damping: 0.05               
    },
    clustering: {
        thresholdDist: 5,           
        baseFocusTime: 3000,        
        timePerCity: 500            
    },
    markers: {
        fadeThreshold: 0.75,        
        baseScale: 1.0,             // NEW: Baseline scale of the node
        zoomScaleFactor: 0.6        // NEW: Reduce node size by up to 60% when fully zoomed out
    }
};

// --- 2. THREE.JS SETUP ---
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.viewport.fov, travelPreview.clientWidth / travelPreview.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg'), antialias: true, alpha: true });
const defaultTarget = new THREE.Vector3(0, 0, 0);

renderer.setSize(travelPreview.clientWidth, travelPreview.clientHeight, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
camera.position.setZ(CONFIG.viewport.initialZoom);

const controls = new THREE.OrbitControls(camera, document.querySelector('.panel-preview'));
controls.enableDamping = true;
controls.dampingFactor = CONFIG.viewport.damping; 
controls.enablePan = false; 

// FIXED: Correctly mapped reversed semantic zoom bounds to OrbitControls distance bounds
controls.minDistance = CONFIG.viewport.maxZoom;   // Closest physical distance
controls.maxDistance = CONFIG.viewport.minZoom;   // Furthest physical distance
controls.enabled = false; 

// --- 2.5 ENGINEERING MODEL SETUP (model) ---
const engPanel = document.getElementById('engineering');
const engPreview = engPanel.querySelector('.panel-preview');

const engScene = new THREE.Scene();
const engCamera = new THREE.PerspectiveCamera(45, engPreview.clientWidth / engPreview.clientHeight, 0.1, 100);
engCamera.position.set(5, 2, 5); // Default camera position for the model

let engReturningHome = false;
const defaultEngTarget = new THREE.Vector3(0, 0, 0);
const defaultEngCameraPos = new THREE.Vector3(5, 2, 5); // NEW: The fixed angle to return to
let engUserInteracted = false; // NEW: Tracks if the user has grabbed the model

const engRenderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#eng-bg'), antialias: true, alpha: true });
engRenderer.setSize(engPreview.clientWidth, engPreview.clientHeight, false);
engRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ==========================================
// --- 1. THE MATERIAL & LIGHTING CONFIG ---
// ==========================================
const MATERIAL_CONFIG = {
    globalRoughness: 0.8,      
    globalEnvIntensity: 0.1,  

    tweaks: {
        'LightSlateGray': { saturationMult: 1, lightnessMult: 0.3, roughness: 0.8 }, // pcb side grey
        'LightGray':      { saturationMult: 1.0, lightnessMult: 0.5, roughness: 0.8 }, // usb metal grey
        'Black':          { saturationMult: 1.0, lightnessMult: 0.3, roughness: 0.8 }, // plastic black
        'BurlyWood':      { saturationMult: 1.0, lightnessMult: 0.3, roughness: 0.5 }, // pin gold
        'DarkSlateGray':  { saturationMult: 100, lightnessMult: 0.2, roughness: 0.8 }, // plastic grey
        'DarkOliveGreen': { saturationMult: 1.0, lightnessMult: 0.3, roughness: 0.8 }, // capacitor brown
        'DarkGray':       { saturationMult: 1.0, lightnessMult: 0.2, roughness: 0.8 }, // pin 1 marker grey
        'DimGray':        { saturationMult: 1.5, lightnessMult: 0.2, roughness: 0.8 }, // pcb green
        'White':          { saturationMult: 1, lightnessMult: 1, roughness: 0.8 }, // silkscreen white
        'Silver':         { saturationMult: 1.0, lightnessMult: 0.9, roughness: 1 }, // solder silver
        'Gold':           { saturationMult: 1, lightnessMult: 1, roughness: 0.8 }, // traces gold
        'Goldenrod':      { saturationMult: 1, lightnessMult: 0.4, roughness: 0.8 }, // tantalum yellow
        'Chocolate':      { saturationMult: 1.0, lightnessMult: 0.4, roughness: 0.8 }, // tantalum marker orange
        'MediumSeaGreen': { saturationMult: 1000, lightnessMult: 0, roughness: 0.8 }, //???
        'Gainsboro':      { saturationMult: 0.2, lightnessMult: 0.5, roughness: 0.8 }, // button metal grey
        'Khaki':          { saturationMult: 0.8, lightnessMult: 0.5, roughness: 0.8 } // button gold
    }
};

// ==========================================
// --- DYNAMIC CLUSTERING ENGINE ---
// ==========================================
const CLUSTER_RADIUS = 30; 

// The Standard X11 / CSS3 Color Dictionary
const STANDARD_COLORS = {
    "Black": {r:0, g:0, b:0}, "DimGray": {r:105, g:105, b:105}, "Gray": {r:128, g:128, b:128},
    "DarkGray": {r:169, g:169, b:169}, "Silver": {r:192, g:192, b:192}, "LightGray": {r:211, g:211, b:211},
    "Gainsboro": {r:220, g:220, b:220}, "WhiteSmoke": {r:245, g:245, b:245}, "White": {r:255, g:255, b:255},
    "DarkSlateGray": {r:47, g:79, b:79}, "SlateGray": {r:112, g:128, b:144}, "LightSlateGray": {r:119, g:136, b:153},
    "Navy": {r:0, g:0, b:128}, "MidnightBlue": {r:25, g:25, b:112}, "DarkBlue": {r:0, g:0, b:139},
    "MediumBlue": {r:0, g:0, b:205}, "Blue": {r:0, g:0, b:255}, "RoyalBlue": {r:65, g:105, b:225},
    "SteelBlue": {r:70, g:130, b:180}, "DodgerBlue": {r:30, g:144, b:255}, "Teal": {r:0, g:128, b:128},
    "DarkCyan": {r:0, g:139, b:139}, "LightSeaGreen": {r:32, g:178, b:170}, "DarkGreen": {r:0, g:100, b:0},
    "Green": {r:0, g:128, b:0}, "ForestGreen": {r:34, g:139, b:34}, "SeaGreen": {r:46, g:139, b:87},
    "MediumSeaGreen": {r:60, g:179, b:113}, "DarkOliveGreen": {r:85, g:107, b:47}, "Olive": {r:128, g:128, b:0},
    "OliveDrab": {r:107, g:142, b:35}, "YellowGreen": {r:154, g:205, b:50}, "LimeGreen": {r:50, g:205, b:50},
    "Lime": {r:0, g:255, b:0}, "Maroon": {r:128, g:0, b:0}, "DarkRed": {r:139, g:0, b:0},
    "Red": {r:255, g:0, b:0}, "Crimson": {r:220, g:20, b:60}, "FireBrick": {r:178, g:34, b:34},
    "Brown": {r:165, g:42, b:42}, "Sienna": {r:160, g:82, b:45}, "SaddleBrown": {r:139, g:69, b:19},
    "Chocolate": {r:210, g:105, b:30}, "Peru": {r:205, g:133, b:63}, "DarkGoldenrod": {r:184, g:134, b:11},
    "Goldenrod": {r:218, g:165, b:32}, "BurlyWood": {r:222, g:184, b:135}, "Tan": {r:210, g:180, b:140},
    "RosyBrown": {r:188, g:143, b:143}, "SandyBrown": {r:244, g:164, b:96}, "Orange": {r:255, g:165, b:0},
    "DarkOrange": {r:255, g:140, b:0}, "Gold": {r:255, g:215, b:0}, "Yellow": {r:255, g:255, b:0},
    "Khaki": {r:240, g:230, b:140}, "DarkKhaki": {r:189, g:183, b:107}, "Purple": {r:128, g:0, b:128},
    "Indigo": {r:75, g:0, b:130}, "DarkSlateBlue": {r:72, g:61, b:139}, "MediumPurple": {r:147, g:112, b:219}
};

function getRgbDistance(rgb1, rgb2) {
    return Math.sqrt(Math.pow(rgb1.r - rgb2.r, 2) + Math.pow(rgb1.g - rgb2.g, 2) + Math.pow(rgb1.b - rgb2.b, 2));
}

function hexToRgb(hexStr) {
    return {
        r: parseInt(hexStr.slice(0, 2), 16),
        g: parseInt(hexStr.slice(2, 4), 16),
        b: parseInt(hexStr.slice(4, 6), 16)
    };
}

function nameThatColor(rgb) {
    let bestName = 'Unknown';
    let minDistance = Infinity;
    for (const [name, targetRgb] of Object.entries(STANDARD_COLORS)) {
        const dist = getRgbDistance(rgb, targetRgb);
        if (dist < minDistance) {
            minDistance = dist;
            bestName = name;
        }
    }
    return bestName;
}

// ==========================================
// --- THE RENDERER & LIGHTING ---
// ==========================================
engRenderer.outputEncoding = THREE.sRGBEncoding;
engRenderer.toneMapping = THREE.ACESFilmicToneMapping;
engRenderer.toneMappingExposure = 1.0;

const pmremGenerator = new THREE.PMREMGenerator(engRenderer);
engScene.environment = pmremGenerator.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose(); // the env map is baked once; free the render targets

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2); 
keyLight.position.set(5, 10, 5);
engScene.add(keyLight);

const fillLight = new THREE.AmbientLight(0xffffff, 0.7); 
engScene.add(fillLight);

const engControls = new THREE.OrbitControls(engCamera, document.querySelector('#eng-bg'));
engControls.enableDamping = true;
engControls.dampingFactor = 0.05;
engControls.enabled = false;
engControls.enablePan = true;
engControls.minDistance = 0.1;
engControls.maxDistance = 15;

// --- NEW: Detect when the user first grabs the model ---
engControls.addEventListener('start', () => {
    engUserInteracted = true;
});

// ==========================================
// --- MODEL LOADING & MATERIAL HACKING ---
// ==========================================
let engModel;
const gltfLoader = new THREE.GLTFLoader();

// The .glb is meshopt-compressed with an uncompressed fallback buffer. Without the
// decoder the loader silently pulls the 5.8 MB fallback .bin on top of the 2.7 MB
// .glb; with it, only the compressed primary buffer is fetched.
if (typeof MeshoptDecoder !== 'undefined') gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });

// --- GEOMETRY BAKING HELPERS ---
// The Fusion export is ~1550 separate primitives. Drawn one by one, each with its own
// material and its own wireframe child, that is ~3100 draw calls per frame. Everything
// below bakes the parts into world space so they can be merged down to one mesh per
// material plus a single LineSegments for the edges.
const NORMALIZED_RANGE = new Map([
    [Int8Array, 127], [Uint8Array, 255],
    [Int16Array, 32767], [Uint16Array, 65535],
    [Int32Array, 2147483647], [Uint32Array, 4294967295]
]);

// KHR_mesh_quantization leaves attributes as normalized ints, and applyMatrix4() would
// happily transform the raw integers. Dequantize to plain float32 first.
function toFloatAttribute(attr) {
    const range = attr.normalized ? NORMALIZED_RANGE.get(attr.array.constructor) : null;
    const readers = [attr.getX, attr.getY, attr.getZ, attr.getW];
    const out = new Float32Array(attr.count * attr.itemSize);

    for (let i = 0; i < attr.count; i++) {
        for (let c = 0; c < attr.itemSize; c++) {
            const raw = readers[c].call(attr, i);
            out[i * attr.itemSize + c] = range ? Math.max(raw / range, -1) : raw;
        }
    }
    return new THREE.BufferAttribute(out, attr.itemSize);
}

// Reduces a primitive to indexed float32 position + normal in world space, which is the
// common shape mergeBufferGeometries() needs across every part of the model.
function bakeGeometry(mesh) {
    const src = mesh.geometry;
    if (!src || !src.attributes.position) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', toFloatAttribute(src.attributes.position));
    if (src.attributes.normal) geo.setAttribute('normal', toFloatAttribute(src.attributes.normal));

    if (src.index) {
        geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
    } else {
        const count = geo.attributes.position.count;
        const index = new Uint32Array(count);
        for (let i = 0; i < count; i++) index[i] = i;
        geo.setIndex(new THREE.BufferAttribute(index, 1));
    }

    geo.applyMatrix4(mesh.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    return geo;
}

// EdgesGeometry across 300k triangles is a multi-second synchronous pass. Spread it over
// frames against a time budget so the model shows up immediately and the page never
// locks, then collapse every part's edges into one LineSegments.
function buildEdgeOverlay(geometries, parent) {
    const BUDGET_MS = 8;
    const chunks = [];
    let cursor = 0;

    function step() {
        const deadline = performance.now() + BUDGET_MS;
        while (cursor < geometries.length && performance.now() < deadline) {
            const edges = new THREE.EdgesGeometry(geometries[cursor++], 15);
            const position = edges.attributes.position;
            if (position && position.count > 0) chunks.push(position.array);
            edges.dispose();
        }

        if (cursor < geometries.length) {
            requestAnimationFrame(step);
            return;
        }

        let total = 0;
        for (const chunk of chunks) total += chunk.length;

        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(merged, 3));
        parent.add(new THREE.LineSegments(geo, edgeMaterial));

        geometries.forEach(g => { if (!g.userData.inUse) g.dispose(); });
        geometries.length = 0;
        chunks.length = 0;
    }

    requestAnimationFrame(step);
}

// Model shown in the engineering panel. null = none; the panel then shows an empty scene.
const ENG_MODEL_URL = null;

if (ENG_MODEL_URL) gltfLoader.load(ENG_MODEL_URL, (gltf) => {
    const source = gltf.scene;
    source.updateMatrixWorld(true);

    // --- PASS 1: SURVEY AND CLUSTER ---
    const buckets = [];
    const hexToBucketMap = {};

    source.traverse((child) => {
        if (child.isMesh && child.material && child.material.color) {
            const hex = child.material.color.getHexString();
            
            if (hexToBucketMap[hex]) return; 

            const rgb = hexToRgb(hex);
            let foundBucket = null;

            for (const bucket of buckets) {
                if (getRgbDistance(rgb, bucket.meanRgb) <= CLUSTER_RADIUS) {
                    foundBucket = bucket;
                    break;
                }
            }

            if (foundBucket) {
                foundBucket.hexCodes.push(hex);
                const count = foundBucket.hexCodes.length;
                foundBucket.meanRgb.r = ((foundBucket.meanRgb.r * (count - 1)) + rgb.r) / count;
                foundBucket.meanRgb.g = ((foundBucket.meanRgb.g * (count - 1)) + rgb.g) / count;
                foundBucket.meanRgb.b = ((foundBucket.meanRgb.b * (count - 1)) + rgb.b) / count;
                hexToBucketMap[hex] = foundBucket;
            } else {
                const newBucket = {
                    meanRgb: { r: rgb.r, g: rgb.g, b: rgb.b },
                    hexCodes: [hex],
                    assignedName: ""
                };
                buckets.push(newBucket);
                hexToBucketMap[hex] = newBucket;
            }
        }
    });

    console.log(`--- DYNAMIC CLUSTERING COMPLETE. FOUND ${buckets.length} BUCKETS ---`);
    buckets.forEach((b, i) => {
        b.assignedName = nameThatColor(b.meanRgb);
        console.log(`Bucket ${i}: Named "${b.assignedName}" (Contains ${b.hexCodes.length} shades)`);
    });

    // --- PASS 2: APPLY MATERIALS AND TWEAKS, THEN MERGE BY MATERIAL ---
    const materialGroups = new Map();
    const bakedGeometries = [];

    source.traverse((child) => {
        if (!child.isMesh) return;

        const baked = bakeGeometry(child);
        if (!baked) return;
        bakedGeometries.push(baked);

        const src = child.material;
        const color = new THREE.Color(src && src.color ? src.color : 0xffffff);
        let roughness = MATERIAL_CONFIG.globalRoughness;

        if (src && src.color) {
            const bucket = hexToBucketMap[src.color.getHexString()];
            const tweak = bucket && MATERIAL_CONFIG.tweaks[bucket.assignedName];
            if (tweak) {
                const hsl = {};
                color.getHSL(hsl);
                color.setHSL(
                    hsl.h,
                    Math.min(1.0, hsl.s * tweak.saturationMult),
                    Math.min(1.0, hsl.l * tweak.lightnessMult)
                );
                roughness = tweak.roughness;
            }
        }

        // Parts that end up the same colour share one material, so ~1550 primitives
        // collapse into roughly as many meshes as there are tweak categories.
        const map = (src && src.map) || null;
        const key = `${color.getHexString()}|${roughness}|${map ? map.uuid : ''}`;

        let group = materialGroups.get(key);
        if (!group) {
            group = {
                material: new THREE.MeshStandardMaterial({
                    color: color,
                    map: map,
                    roughness: roughness,
                    metalness: 0.0,
                    envMapIntensity: MATERIAL_CONFIG.globalEnvIntensity
                }),
                geometries: []
            };
            materialGroups.set(key, group);
        }
        group.geometries.push(baked);
    });

    engModel = new THREE.Group();
    materialGroups.forEach((group) => {
        const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(group.geometries);
        if (merged) {
            engModel.add(new THREE.Mesh(merged, group.material));
        } else {
            // mergeBufferGeometries() bails on incompatible attributes; keep the parts.
            group.geometries.forEach(geo => {
                geo.userData.inUse = true;
                engModel.add(new THREE.Mesh(geo, group.material));
            });
        }
    });

    console.log(`--- MERGED ${bakedGeometries.length} PRIMITIVES INTO ${engModel.children.length} DRAW CALLS ---`);

    // Scale and Center
    const box = new THREE.Box3().setFromObject(engModel);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    engModel.scale.multiplyScalar(4.0 / maxDim);

    const scaledBox = new THREE.Box3().setFromObject(engModel);
    const center = scaledBox.getCenter(new THREE.Vector3());
    engModel.position.sub(center);

    engScene.add(engModel);

    // Edges are built in the background; they inherit the transform above as a child.
    buildEdgeOverlay(bakedGeometries, engModel);
}, undefined, (error) => {
    console.error('Error loading model.glb:', error);
});

// --- 3. STATE MACHINE VARIABLES ---
let tourActive = true; 
let isPanning = true;
let isInspecting = false; // NEW: Tracks if the user is actively reading a box
let idleTimeout; 
let currentClusterIdx = 0;
let stateStartTime = performance.now();
const driftTarget = new THREE.Vector3();
let currentZoom = CONFIG.viewport.initialZoom; 

// --- 4. THE SEAMLESS RESUME LOGIC ---
function resumeTour() {
    clearTimeout(idleTimeout);
    
    const camTheta = Math.atan2(camera.position.z, -camera.position.x);
    let camLon = camTheta * (180 / Math.PI) - 180;
    camLon = ((camLon + 180) % 360 + 360) % 360 - 180; 

    let nextIdx = 0; 
    for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].lon > camLon) {
            nextIdx = i;
            break; 
        }
    }
    
    currentClusterIdx = nextIdx;
    tourActive = true;
    isPanning = true;
    stateStartTime = performance.now();
}

controls.addEventListener('start', () => {
    tourActive = false;
    clearTimeout(idleTimeout);
});

controls.addEventListener('end', () => {
    clearTimeout(idleTimeout);
    currentZoom = camera.position.distanceTo(defaultTarget);
    idleTimeout = setTimeout(resumeTour, CONFIG.tour.idlePauseMs); 
});

// --- NEW: Centralized Return to Overview Logic ---
function returnToOverview() {

    panels.forEach(p => p.classList.remove('expanded', 'hidden'));

    // Globe reset
    controls.enabled = false; 
    currentZoom = CONFIG.viewport.initialZoom; 
    if (!tourActive) resumeTour();

    // Engineering reset
    engControls.enabled = false;
    engReturningHome = true; 
}

// --- NEW: Escape Key Listener ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const isAnyExpanded = Array.from(panels).some(p => p.classList.contains('expanded'));
        if (isAnyExpanded) {
            returnToOverview();
        }
    }
});

// --- UPDATED: Panel Click Logic ---
panels.forEach(panel => {
    panel.addEventListener('click', () => {
        if (panel.classList.contains('expanded')) return;
        
        const isAnyExpanded = Array.from(panels).some(p => p.classList.contains('expanded'));
        if (isAnyExpanded) {
            returnToOverview();
            return; 
        }

        // Standard expansion logic
        panels.forEach(p => p.classList.remove('expanded', 'hidden'));
        panels.forEach(p => { if (p !== panel) p.classList.add('hidden'); });
        panel.classList.add('expanded');
        
        controls.enabled = (panel.id === 'travel');
        engControls.enabled = (panel.id === 'engineering');
        
        if (panel.id === 'travel') {
            tourActive = false;
            clearTimeout(idleTimeout);
        } else if (panel.id === 'engineering') {
            engUserInteracted = false; 
            if (!tourActive) resumeTour();
        } else {
            if (!tourActive) resumeTour();
        }
    });
});

// --- 5. GLOBE, DATA & CLUSTERING ---
const globeGroup = new THREE.Group();
scene.add(globeGroup);

const core = new THREE.Mesh(
    new THREE.SphereGeometry(14.8, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x181818 }) 
);
globeGroup.add(core);

function getCityVector(lat, lon, radius = 15.2) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

// Data Array. `info` is placeholder text until each city gets its real description.
// Photos are self-hosted in assets/images/cities/; sources are credited in impressum.html.
const targetCities = [
    { name: "NYC", lat: 40.7128, lon: -74.0060, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/nyc.jpg" },
    { name: "Washington DC", lat: 38.9072, lon: -77.0369, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/washington-dc.jpg" },
    { name: "London", lat: 51.5074, lon: -0.1278, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/london.jpg" },
    { name: "Dublin", lat: 53.3498, lon: -6.2603, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/dublin.jpg" },
    { name: "Galway", lat: 53.2707, lon: -9.0568, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/galway.jpg" },
    { name: "Madrid", lat: 40.4168, lon: -3.7038, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/madrid.jpg" },
    { name: "Barcelona", lat: 41.3851, lon: 2.1734, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/barcelona.jpg" },
    { name: "Valencia", lat: 39.4699, lon: -0.3774, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/valencia.jpg" },
    { name: "Malaga", lat: 36.7213, lon: -4.4214, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/malaga.jpg" },
    { name: "Bilbao", lat: 43.2630, lon: -2.9350, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/bilbao.jpg" },
    { name: "San Sebastian", lat: 43.3183, lon: -1.9812, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/san-sebastian.jpg" },
    { name: "Porto", lat: 41.1579, lon: -8.6291, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/porto.jpg" },
    { name: "Lisbon", lat: 38.7223, lon: -9.1393, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/lisbon.jpg" },
    { name: "Seville", lat: 37.3891, lon: -5.9845, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/seville.jpg" },
    { name: "Canary Islands", lat: 28.2916, lon: -16.6291, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/canary-islands.jpg" },
    { name: "Rome", lat: 41.9028, lon: 12.4964, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/rome.jpg" },
    { name: "Venice", lat: 45.4408, lon: 12.3155, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/venice.jpg" },
    { name: "Florence", lat: 43.7696, lon: 11.2558, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/florence.jpg" },
    { name: "Munich", lat: 48.1351, lon: 11.5820, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/munich.jpg" },
    { name: "Frankfurt", lat: 50.1109, lon: 8.6821, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/frankfurt.jpg" },
    { name: "Berlin", lat: 52.5200, lon: 13.4050, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/berlin.jpg" },
    { name: "Dresden", lat: 51.0504, lon: 13.7373, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/dresden.jpg" },
    { name: "Vienna", lat: 48.2082, lon: 16.3738, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/vienna.jpg" },
    { name: "Prague", lat: 50.0755, lon: 14.4378, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/prague.jpg" },
    { name: "Bratislava", lat: 48.1486, lon: 17.1077, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/bratislava.jpg" },
    { name: "Budapest", lat: 47.4979, lon: 19.0402, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/budapest.jpg" },
    { name: "Athens", lat: 37.9838, lon: 23.7275, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/athens.jpg" },
    { name: "Istanbul", lat: 41.0082, lon: 28.9784, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/istanbul.jpg" },
    { name: "Marrakesh", lat: 31.6295, lon: -7.9811, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/marrakesh.jpg" },
    { name: "Astana", lat: 51.1694, lon: 71.4491, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/astana.jpg" },
    { name: "Urumqi", lat: 43.8256, lon: 87.6168, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/urumqi.jpg" },
    { name: "Chongqing", lat: 29.5630, lon: 106.5516, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/chongqing.jpg" },
    { name: "Bangkok", lat: 13.7563, lon: 100.5018, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/bangkok.jpg" },
    { name: "Hong Kong", lat: 22.3193, lon: 114.1694, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/hong-kong.jpg" },
    { name: "Taipei", lat: 25.0330, lon: 121.5654, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/taipei.jpg" },
    { name: "Shanghai", lat: 31.2304, lon: 121.4737, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/shanghai.jpg" },
    { name: "Tokyo", lat: 35.6762, lon: 139.6503, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/tokyo.jpg" },
    { name: "Kyoto", lat: 35.0116, lon: 135.7681, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/kyoto.jpg" },
    { name: "Osaka", lat: 34.6937, lon: 135.5023, info: "Lorem ipsum dolor sit amet,<br>consectetur adipiscing elit.", img: "assets/images/cities/osaka.jpg" }
];

targetCities.sort((a, b) => a.lon - b.lon);

function buildClusters(cities, thresholdDist = CONFIG.clustering.thresholdDist) {
    const clusters = [];
    const pool = [...cities];

    while (pool.length > 0) {
        const seed = pool.shift();
        const cluster = { 
            cities: [seed], 
            center: getCityVector(seed.lat, seed.lon),
            lon: seed.lon 
        };
        
        for (let i = pool.length - 1; i >= 0; i--) {
            const candidate = pool[i];
            const candidateVec = getCityVector(candidate.lat, candidate.lon);
            
            if (cluster.center.distanceTo(candidateVec) < thresholdDist) {
                cluster.cities.push(candidate);
                cluster.center.add(candidateVec).multiplyScalar(0.5);
                pool.splice(i, 1);
            }
        }
        
        cluster.focusTime = CONFIG.clustering.baseFocusTime + (cluster.cities.length - 1) * CONFIG.clustering.timePerCity;
        
        // FIXED: Calculate offset angle based on a 144Hz frame duration (1000ms / 144 = ~6.944ms)
        cluster.offsetAngle = ((cluster.focusTime / 2) / 6.944) * CONFIG.tour.tourDriftSpeed;
        
        cluster.lon = cluster.cities.reduce((sum, c) => sum + c.lon, 0) / cluster.cities.length;
        clusters.push(cluster);
    }
    
    clusters.sort((a, b) => a.lon - b.lon);
    return clusters;
}

const clusters = buildClusters(targetCities);

const textureLoader = new THREE.TextureLoader();
const labelsContainer = document.querySelector('#labels-container');
const cityHUDs = [];

Promise.all([
    new Promise(res => textureLoader.load('./assets/images/MODIS_Water_Mask.jpg', res)),
    new Promise(res => textureLoader.load('./assets/images/gebco_08_rev_elev_5400x2700.jpg', res))
]).then(([maskTex, elevTex]) => {
    // Only every `step`-th pixel is ever read, so the maps are downscaled on the way in.
    // Reading back the full 5400x2700 elevation map costs ~58 MB per copy, and there were
    // three copies live at once; at 900x450 the whole pass fits in ~1.6 MB. The sample
    // grid is unchanged, so the resulting point positions are identical.
    const sampleW = Math.floor(elevTex.image.width / 6);
    const sampleH = Math.floor(elevTex.image.height / 6);

    function sampleImage(image, smoothing) {
        const canvas = document.createElement('canvas');
        canvas.width = sampleW;
        canvas.height = sampleH;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = smoothing;
        ctx.drawImage(image, 0, 0, sampleW, sampleH);
        const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

        canvas.width = canvas.height = 0; // drop the backing store right away
        return data;
    }

    // Elevation averages nicely when downscaled; the land/water mask must stay hard-edged.
    const elevData = sampleImage(elevTex.image, true);
    const maskData = sampleImage(maskTex.image, false);

    // Preallocated so the ~130k points never grow a boxed JS array.
    const positions = new Float32Array(sampleW * sampleH * 3);
    const colors = new Float32Array(sampleW * sampleH * 3);
    const baseRadius = 15;
    let count = 0;
    for (let y = 0; y < sampleH; y++) {
        const phi = (y / sampleH) * Math.PI;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        for (let x = 0; x < sampleW; x++) {
            const idx = (y * sampleW + x) * 4;
            if (maskData[idx] >= 128) continue;

            const brightness = elevData[idx];
            const elevation = Math.sqrt(brightness / 255) * 0.25;
            const r = baseRadius + 0.15 + elevation;
            const theta = (x / sampleW) * Math.PI * 2;

            positions[count] = -r * sinPhi * Math.cos(theta);
            positions[count + 1] = r * cosPhi;
            positions[count + 2] = r * sinPhi * Math.sin(theta);

            const c = 0.55 + (brightness / 255) * 0.45;
            colors[count] = c;
            colors[count + 1] = c;
            colors[count + 2] = c;
            count += 3;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, count), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, count), 3));
    globeGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, opacity: 0.8 })));

    // FIXED: Calculate the exact elevation underneath each city!
    targetCities.forEach(city => {
        const y = Math.min(sampleH - 1, Math.floor((90 - city.lat) / 180 * sampleH));
        const x = Math.min(sampleW - 1, Math.floor((city.lon + 180) / 360 * sampleW));

        const brightness = elevData[(y * sampleW + x) * 4];
        const elevation = Math.sqrt(brightness / 255) * 0.25;

        // Match the voxel logic: core + crust + mountain
        const exactHeight = 15.15 + elevation;

        createCityHUD(city, exactHeight);
    });

    // Neither map is used as a GPU texture; release the decoded bitmaps.
    maskTex.dispose();
    elevTex.dispose();
});

// FIXED: Receives the exact terrain height
function createCityHUD(city, exactHeight) {
    const anchorVec = getCityVector(city.lat, city.lon, exactHeight);

    const div = document.createElement('div');
    div.className = 'city-label';
    
    // The photo stays in data-src: 33 labels means 33 image requests at startup
    // for images that are only ever seen on hover. Cities without a photo get none.
    div.innerHTML = `
        <div class="ui-hitbox">
            <div class="ui-node"></div>
        </div>
        <div class="ui-content">
            <span class="ui-city-name">${city.name.toUpperCase()}</span>
            <div class="ui-details">
                ${city.img ? `<img data-src="${city.img}" alt="${city.name}" decoding="async">` : ''}
                <p>${city.info}</p>
            </div>
        </div>
    `;

    // Matches the starting state assumed by updateHUD().
    div.style.opacity = '0';
    div.style.pointerEvents = 'none';
    labelsContainer.appendChild(div);

    cityHUDs.push({
        element: div,
        anchor: anchorVec,
        visible: false,
        opacity: 0,
        zIndex: '',
        scale: NaN,
        x: NaN,
        y: NaN
    });
}

let hoveredHUD = null;

labelsContainer.addEventListener('mouseover', (e) => {
    const label = e.target.closest('.city-label');
    if (label) {
        const img = label.querySelector('img[data-src]');
        if (img) {
            img.src = img.dataset.src;
            delete img.dataset.src;
        }

        hoveredHUD = label;
        isInspecting = true; // Prevents background drift from kicking in
        clearTimeout(idleTimeout);
        tourActive = false; 
    }
});

labelsContainer.addEventListener('mouseout', (e) => {
    const label = e.target.closest('.city-label');
    if (label) {
        hoveredHUD = null;
        isInspecting = false; // Allows drift/tour to resume
        clearTimeout(idleTimeout);
        currentZoom = camera.position.distanceTo(defaultTarget);
        idleTimeout = setTimeout(resumeTour, CONFIG.tour.inspectionPauseMs);
    }
});

// Scratch vectors, reused across frames. Allocating per label per frame was ~4000
// Vector3 a second of pure GC pressure.
const hudPos = new THREE.Vector3();
const hudNormal = new THREE.Vector3();
const camNormal = new THREE.Vector3();

// Takes the preview size from the caller: reading clientWidth here forced a second
// layout flush every frame, on top of the one in animate().
function updateHUD(width, height) {
    const widthHalf = width / 2;
    const heightHalf = height / 2;

    // FIXED: Calculate dynamic scale based on the camera distance
    const zoomRange = CONFIG.viewport.minZoom - CONFIG.viewport.maxZoom;
    const zoomProgress = (currentZoom - CONFIG.viewport.maxZoom) / zoomRange;
    const markerScale = CONFIG.markers.baseScale - (zoomProgress * CONFIG.markers.zoomScaleFactor);

    camNormal.copy(camera.position).normalize();

    for (const hud of cityHUDs) {
        hudPos.copy(hud.anchor).applyMatrix4(globeGroup.matrixWorld);
        const dot = hudNormal.copy(hudPos).normalize().dot(camNormal);

        const fadePercentage = Math.max(0, Math.min(1.0, (dot - CONFIG.markers.fadeThreshold) * 10));
        const style = hud.element.style;

        if (fadePercentage === 0) {
            if (hud.visible) {
                style.opacity = '0';
                style.pointerEvents = 'none';
                hud.visible = false;
                hud.opacity = 0;
            }
            continue;
        }

        // Every write below dirties the label's whole subtree, and there are 33 labels,
        // so nothing is written unless the value actually changed.
        if (!hud.visible) {
            style.pointerEvents = 'auto';
            hud.visible = true;
        }

        // FIXED: Removed all the node dimming logic!
        if (fadePercentage !== hud.opacity) {
            style.opacity = fadePercentage.toString();
            hud.opacity = fadePercentage;
        }

        const zIndex = (hud.element === hoveredHUD) ? '100' : '1';
        if (zIndex !== hud.zIndex) {
            style.zIndex = zIndex;
            hud.zIndex = zIndex;
        }

        // Pipes the javascript zoom scale right into the CSS!
        if (markerScale !== hud.scale) {
            style.setProperty('--dynamic-scale', markerScale.toString());
            hud.scale = markerScale;
        }

        hudPos.project(camera);
        const x = Math.round((hudPos.x * widthHalf) + widthHalf);
        const y = Math.round(-(hudPos.y * heightHalf) + heightHalf);

        if (x !== hud.x || y !== hud.y) {
            style.transform = `translate(${x}px, ${y}px)`;
            hud.x = x;
            hud.y = y;
        }
    }
}

// --- 6. ANIMATION LOOP ---
// applyAxisAngle() never mutates its axis, so one shared vector is enough.
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function animate() {
    requestAnimationFrame(animate);

    // rAF already throttles background tabs, but this also skips the WebGL work on
    // browsers that keep firing it for visible-but-occluded windows.
    if (document.hidden) {
        clock.getDelta();
        return;
    }

    const delta = clock.getDelta();
    const timeScale = delta * 144;

    // --- GLOBE RENDER LOGIC ---
    const width = travelPreview.clientWidth;
    const height = travelPreview.clientHeight;
    
    if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    // --- ENGINEERING RENDER LOGIC ---
    const engWidth = engPreview.clientWidth;
    const engHeight = engPreview.clientHeight;
    
    if (engRenderer.domElement.width !== engWidth || engRenderer.domElement.height !== engHeight) {
        engRenderer.setSize(engWidth, engHeight, false);
        engCamera.aspect = engWidth / engHeight;
        engCamera.updateProjectionMatrix();
    }

    // Clamp panning so the user doesn't get lost
    if (engControls.enabled) {
        const panLimit = 6.0; 
        engControls.target.x = Math.max(-panLimit, Math.min(panLimit, engControls.target.x));
        engControls.target.y = Math.max(-panLimit, Math.min(panLimit, engControls.target.y));
        engControls.target.z = Math.max(-panLimit, Math.min(panLimit, engControls.target.z));
    }

    // --- FIXED: Smoothly return to the fixed home angle ---
    if (engReturningHome) {
        const returnSpeed = 1 - Math.pow(1 - 0.03, timeScale); 
        
        // 1. Smoothly glide the target back to center
        engControls.target.lerp(defaultEngTarget, returnSpeed);
        
        // 2. Smoothly glide the camera back to the exact (5, 2, 5) position
        engCamera.position.lerp(defaultEngCameraPos, returnSpeed);

        // 3. Stop the transition once it settles into place
        if (engCamera.position.distanceTo(defaultEngCameraPos) < 0.1 && engControls.target.distanceTo(defaultEngTarget) < 0.1) {
            engReturningHome = false;
        }
    }

    engControls.update();
    
    // --- FIXED: Rotate if minimized OR if maximized but untouched ---
    if (engModel && (!engControls.enabled || !engUserInteracted)) {
        engModel.rotation.y += 0.005 * timeScale;
    }

    // 2. Update controls BEFORE camera movement to prevent marker lag
    controls.update(); 

    if (tourActive && clusters.length > 0) {
        controls.autoRotate = false; 
        const now = performance.now();
        const activeCluster = clusters[currentClusterIdx];

        if (isPanning) {
            const targetPos = activeCluster.center.clone()
                .normalize()
                .multiplyScalar(currentZoom)
                .applyAxisAngle(Y_AXIS, -activeCluster.offsetAngle);

            // Time-scaled Lerp ensures consistent panning speed across all monitors
            const panFactor = 1 - Math.pow(1 - CONFIG.tour.camPanSpeed, timeScale);
            const targetFactor = 1 - Math.pow(1 - CONFIG.tour.targetPanSpeed, timeScale);

            camera.position.lerp(targetPos, panFactor).normalize().multiplyScalar(currentZoom);
            controls.target.lerp(defaultTarget, targetFactor);

            // Time-scaled Tour Drift
            camera.position.applyAxisAngle(Y_AXIS, CONFIG.tour.tourDriftSpeed * timeScale);

            if (camera.position.distanceTo(targetPos) < 1.0) {
                isPanning = false;
                stateStartTime = now;
                driftTarget.copy(camera.position); 
            }
        } else {
            // Time-scaled Tour Drift
            driftTarget.applyAxisAngle(Y_AXIS, CONFIG.tour.tourDriftSpeed * timeScale);
            camera.position.copy(driftTarget);

            if (now - stateStartTime > activeCluster.focusTime) {
                currentClusterIdx = (currentClusterIdx + 1) % clusters.length;
                isPanning = true;
            }
        }
    } else {
        // --- THE CRITICAL FIX FOR IDLE SLOWDOWN & REVERSE ROTATION ---
        controls.autoRotate = false; 
        
        if (!isInspecting) {
            // FIXED: We now use the exact same variable (tourDriftSpeed) for the idle drift.
            // This guarantees it moves in the same direction (westward) and at the exact 
            // same speed as the tour, completely eliminating the backward jitter.
            const idleDriftScaled = CONFIG.tour.tourDriftSpeed * timeScale;
            
            camera.position.applyAxisAngle(Y_AXIS, idleDriftScaled);
            
            // Sync driftTarget so the camera doesn't snap when the tour resumes
            driftTarget.copy(camera.position); 
        }
    }

    updateHUD(width, height);
    renderer.render(scene, camera);
    engRenderer.render(engScene, engCamera);
}
animate();

/*
TODO
abrupt switch between manual and tour mode
markers lagging behind. markers should be rendered in the same way as voxels, but should never be covered by surrounding voxels
abrupt transition from homing to drift in tour mode (how smoothless transition?)
rotation ccw after opening info box (why? to reach passed cluster? should always home in to closest cluster eastwards instead of closest cluster
remove 'back to overview button', clicking on other tabs should first lead back to overview, tabs can then be selected for detailed view
*/