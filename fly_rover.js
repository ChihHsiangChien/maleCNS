/**
 * 3D Fruit Fly Autonomous Rover Simulation Controller (Three.js)
 * Full 3D Volumetric Avoidance & LC10 STMD Food Pursuit & Foraging Engine
 */

class FlyRoverApp {
    constructor() {
        this.container = document.getElementById('canvasContainer');
        this.canvas = document.getElementById('canvas3d');

        // Scene & Renderer
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x080b12, 0.015);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Camera & Controls
        this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 200);
        this.orbitControls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.activeCamMode = 'follow'; // 'follow', 'cockpit', 'top', 'orbit'

        // Environment Bounds & Invisible Ceiling
        this.ceilingY = 20.0;

        // Lighting
        this._setupLighting();

        // Environment & Obstacles & Food Targets
        this.obstacles = [];
        this.foodTargets = [];
        this.particleSplashes = [];
        this.foodScore = 0;
        this._buildArena();

        // Fruit Fly Agent & Brain
        this.flyModel = new FruitFlyModel();
        this.scene.add(this.flyModel.group);
        this.brain = new RoverConnectomeBrain(16); // 16 rays left, 16 rays right

        // Physics & Kinematics State
        this.flyPos = new THREE.Vector3(0, 2.5, 0);
        this.flyYaw = 0.0;
        this.flyPitch = 0.0; // 3D Pitch angle in radians (-45° dive to +45° climb)
        this.flySpeed = 0.0;
        this.isAutoPilot = true;
        this.dodgeCount = 0;
        this.flightDistance = 0.0;
        this.lastPos = this.flyPos.clone();

        // Spawn default maze layout & food targets
        this._spawnDefaultObstacles('maze3d');
        this._spawnDefaultFoodTargets();

        // Raycasting & Sensors (LC4 Obstacles + LC10 Food Targets)
        this.raycaster = new THREE.Raycaster();
        this.numRays = 16;
        this.maxRayDist = 22.0;

        // LC4 Threat Signals
        this.leftRaySignals = new Float32Array(this.numRays);
        this.rightRaySignals = new Float32Array(this.numRays);
        this.topRaySignals = new Float32Array(this.numRays);
        this.botRaySignals = new Float32Array(this.numRays);

        // LC10 Food Attraction Signals
        this.leftFoodSignals = new Float32Array(this.numRays);
        this.rightFoodSignals = new Float32Array(this.numRays);
        this.topFoodSignals = new Float32Array(this.numRays);
        this.botFoodSignals = new Float32Array(this.numRays);

        // Visual Ray Line Helpers
        this._setupRayLineHelpers();

        // Oscilloscope History Buffer
        this.oscilloscopeCanvas = document.getElementById('oscilloscopeCanvas');
        this.oscCtx = this.oscilloscopeCanvas ? this.oscilloscopeCanvas.getContext('2d') : null;
        this.historyLength = 120;
        this.historyLeftWing = new Array(this.historyLength).fill(1.0);
        this.historyRightWing = new Array(this.historyLength).fill(1.0);

        // Manual Controls Key State (WASD + Arrows + Q/E for Pitch)
        this.keys = {
            ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
            w: false, s: false, a: false, d: false,
            q: false, e: false, Q: false, E: false
        };

        // Events & Loop
        this.clock = new THREE.Clock();
        this._bindEvents();
        this._bindUI();

        // Start Loop
        this.animate();
    }

    _setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0x00f2fe, 1.2);
        sunLight.position.set(20, 40, 20);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        this.scene.add(sunLight);

        const magentaLight = new THREE.PointLight(0xf72585, 2, 50);
        magentaLight.position.set(-15, 10, -15);
        this.scene.add(magentaLight);

        const cyanLight = new THREE.PointLight(0x00f2fe, 2, 50);
        cyanLight.position.set(15, 10, 15);
        this.scene.add(cyanLight);

        const greenLight = new THREE.PointLight(0x70e000, 2, 60);
        greenLight.position.set(0, 12, 0);
        this.scene.add(greenLight);
    }

    _createHighContrastFloorTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const tileSize = 64;
        for (let y = 0; y < 512; y += tileSize) {
            for (let x = 0; x < 512; x += tileSize) {
                const isEven = (((x / tileSize) + (y / tileSize)) % 2 === 0);
                ctx.fillStyle = isEven ? '#0b1324' : '#14223d';
                ctx.fillRect(x, y, tileSize, tileSize);

                ctx.strokeStyle = isEven ? '#00f2fe' : '#f72585';
                ctx.lineWidth = 4;
                ctx.strokeRect(x, y, tileSize, tileSize);

                ctx.fillStyle = isEven ? '#ff0055' : '#ffb703';
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(12, 12);
        return texture;
    }

    _buildArena() {
        const arenaRadius = 45;

        // Ground Plane
        const floorTexture = this._createHighContrastFloorTexture();
        const planeGeo = new THREE.PlaneGeometry(arenaRadius * 2, arenaRadius * 2);
        const planeMat = new THREE.MeshStandardMaterial({
            map: floorTexture,
            roughness: 0.3,
            metalness: 0.5
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        this.scene.add(plane);
        this.groundMesh = plane;

        // Primary Floor Grid Helper
        const gridHelper = new THREE.GridHelper(arenaRadius * 2, 45, 0xffb703, 0x00f2fe);
        gridHelper.position.y = 0.02;
        this.scene.add(gridHelper);

        // Invisible Ceiling Grid Plane at Y = ceilingY (20.0m)
        const ceilingGrid = new THREE.GridHelper(arenaRadius * 2, 45, 0xff0055, 0xf72585);
        ceilingGrid.position.y = this.ceilingY;
        ceilingGrid.material.transparent = true;
        ceilingGrid.material.opacity = 0.35;
        this.scene.add(ceilingGrid);

        const ceilingGeo = new THREE.PlaneGeometry(arenaRadius * 2, arenaRadius * 2);
        const ceilingMat = new THREE.MeshStandardMaterial({
            color: 0xf72585,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide
        });
        const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
        ceilingMesh.position.y = this.ceilingY;
        ceilingMesh.rotation.x = Math.PI / 2;
        this.scene.add(ceilingMesh);

        // Ground Shadow Ring & Heading Arrow
        this.groundShadowRing = new THREE.Group();
        const shadowRingGeo = new THREE.RingGeometry(1.2, 1.5, 32);
        const shadowRingMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide });
        const shadowRing = new THREE.Mesh(shadowRingGeo, shadowRingMat);
        shadowRing.rotation.x = Math.PI / 2;
        this.groundShadowRing.add(shadowRing);

        const arrowShape = new THREE.Shape();
        arrowShape.moveTo(0, 2.2);
        arrowShape.lineTo(-0.6, 1.2);
        arrowShape.lineTo(0.6, 1.2);
        arrowShape.closePath();
        const arrowGeo = new THREE.ShapeGeometry(arrowShape);
        const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff0055, side: THREE.DoubleSide });
        const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
        arrowMesh.rotation.x = Math.PI / 2;
        this.groundShadowRing.add(arrowMesh);

        this.groundShadowRing.position.y = 0.08;
        this.scene.add(this.groundShadowRing);

        // 3D Outer Perimeter Wall Enclosure
        const wallHeight = this.ceilingY;
        const wallRadius = arenaRadius - 1.0;
        const cylGeo = new THREE.CylinderGeometry(wallRadius, wallRadius, wallHeight, 64, 1, true);
        const cylMat = new THREE.MeshStandardMaterial({
            color: 0xf72585,
            emissive: 0xf72585,
            emissiveIntensity: 0.4,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide
        });
        this.outerWallMesh = new THREE.Mesh(cylGeo, cylMat);
        this.outerWallMesh.position.y = wallHeight / 2;
        this.scene.add(this.outerWallMesh);

        // Outer Wall Glowing Top Torus Ring
        const topRingGeo = new THREE.TorusGeometry(wallRadius, 0.3, 12, 64);
        const topRingMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
        const topRing = new THREE.Mesh(topRingGeo, topRingMat);
        topRing.rotation.x = Math.PI / 2;
        topRing.position.y = wallHeight;
        this.scene.add(topRing);
    }

    _clearObstacles() {
        this.obstacles.forEach(obs => {
            this.scene.remove(obs.mesh);
            if (obs.mesh.geometry) obs.mesh.geometry.dispose();
            if (obs.mesh.children) {
                obs.mesh.children.forEach(child => {
                    if (child.geometry) child.geometry.dispose();
                });
            }
        });
        this.obstacles = [];
    }

    _spawnDefaultObstacles(type = 'maze3d') {
        this._clearObstacles();

        if (type === 'maze3d') {
            const maze3dDefs = [
                { type: 'wall', x: 0, z: -35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 0, z: 35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: -35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },

                { type: 'pillar', x: -33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: -33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },

                { type: 'low_wall', x: -16, z: -18, w: 26, h: 4.5, d: 3, y: 2.25, color: 0x00f2fe },
                { type: 'low_wall', x: 16, z: 18, w: 26, h: 4.5, d: 3, y: 2.25, color: 0x00f2fe },

                { type: 'gate', x: 0, z: -15, w: 28, h: 5.0, d: 4, y: 12.0, color: 0xf72585 },
                { type: 'gate', x: 0, z: 15, w: 28, h: 5.0, d: 4, y: 12.0, color: 0xf72585 },

                { type: 'wall', x: -15, z: 0, w: 18, h: 20, d: 3, y: 10, color: 0x4cc9f0 },
                { type: 'wall', x: 15, z: 0, w: 18, h: 20, d: 3, y: 10, color: 0x4cc9f0 },

                { type: 'floating', x: -10, z: 12, radius: 2.8, y: 8.5, color: 0xffb703 },
                { type: 'floating', x: 10, z: -12, radius: 2.8, y: 11.0, color: 0xffb703 },
                { type: 'floating', x: 0, z: 0, radius: 3.2, y: 9.0, color: 0xff0055 },

                { type: 'moving', x: -8, z: -25, radius: 2.2, y: 4.0, color: 0xff0055, speed: 1.2 },
                { type: 'moving', x: 8, z: 25, radius: 2.2, y: 8.0, color: 0x4cc9f0, speed: -1.2 }
            ];
            maze3dDefs.forEach(cfg => this.createObstacle(cfg));
        } else if (type === 'maze') {
            const mazeWalls = [
                { type: 'wall', x: 0, z: -35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 0, z: 35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: -35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: -33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: -33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'wall', x: -16, z: -18, w: 30, h: 20, d: 3, y: 10, color: 0xf72585 },
                { type: 'wall', x: 16, z: -18, w: 30, h: 20, d: 3, y: 10, color: 0xf72585 },
                { type: 'wall', x: -16, z: 18, w: 30, h: 20, d: 3, y: 10, color: 0xffb703 },
                { type: 'wall', x: 16, z: 18, w: 30, h: 20, d: 3, y: 10, color: 0xffb703 },
                { type: 'moving', x: -8, z: -25, radius: 2.2, y: 3.0, color: 0xff0055, speed: 1.2 },
                { type: 'moving', x: 8, z: 25, radius: 2.2, y: 3.0, color: 0x4cc9f0, speed: -1.2 }
            ];
            mazeWalls.forEach(cfg => this.createObstacle(cfg));
        } else if (type === 'corridor') {
            const corridorWalls = [
                { type: 'wall', x: -10, z: 0, w: 2, h: 20, d: 60, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 10, z: 0, w: 2, h: 20, d: 60, y: 10, color: 0x00f2fe },
                { type: 'gate', x: 0, z: 18, w: 18, h: 5, d: 3, y: 11, color: 0xff0055 },
                { type: 'low_wall', x: 0, z: -18, w: 18, h: 4, d: 3, y: 2, color: 0xffb703 },
                { type: 'moving', x: 0, z: 0, radius: 2.5, y: 5, color: 0xf72585, speed: 1.5 }
            ];
            corridorWalls.forEach(cfg => this.createObstacle(cfg));
        } else {
            const scatteredObs = [
                { type: 'floating', x: 0, z: 15, radius: 2.5, y: 8, color: 0xff0055 },
                { type: 'pillar', x: -12, z: 10, radius: 1.8, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 14, z: 8, radius: 2.0, h: 20, y: 10, color: 0xf72585 },
                { type: 'moving', x: -8, z: -14, radius: 2.5, y: 4, color: 0xffb703, speed: 0.8 },
                { type: 'moving', x: 10, z: -18, radius: 2.2, y: 9, color: 0x4cc9f0, speed: -1.0 },
                { type: 'floating', x: -18, z: 2, radius: 2.0, y: 12, color: 0xff0055 },
                { type: 'gate', x: 0, z: -5, w: 20, h: 4, d: 3, y: 10, color: 0x00f2fe }
            ];
            scatteredObs.forEach(cfg => this.createObstacle(cfg));
        }
    }

    _spawnDefaultFoodTargets() {
        // Clear existing food targets
        this.foodTargets.forEach(food => {
            this.scene.remove(food.group);
        });
        this.foodTargets = [];

        // Spawn 4 initial 3D glowing food targets
        const foodPositions = [
            { x: -10, y: 6.0, z: -8 },
            { x: 12, y: 9.0, z: 10 },
            { x: 0, y: 4.5, z: 22 },
            { x: -18, y: 8.0, z: -18 }
        ];

        foodPositions.forEach(pt => this.createFoodTarget(pt.x, pt.y, pt.z));
    }

    createFoodTarget(x, y, z) {
        const group = new THREE.Group();

        // Glowing Green Sphere Mesh
        const geo = new THREE.SphereGeometry(1.6, 24, 24);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x70e000,
            emissive: 0x70e000,
            emissiveIntensity: 0.8,
            roughness: 0.1,
            metalness: 0.3
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);

        // Outer Glowing Aura Halo Ring
        const haloGeo = new THREE.TorusGeometry(2.0, 0.15, 12, 32);
        const haloMat = new THREE.MeshBasicMaterial({ color: 0x38b000, transparent: true, opacity: 0.7 });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.rotation.x = Math.PI / 2;
        group.add(halo);

        // Point Light Source
        const pLight = new THREE.PointLight(0x70e000, 1.8, 20);
        group.add(pLight);

        group.position.set(x, y, z);
        this.scene.add(group);

        const foodObj = {
            group: group,
            mesh: mesh,
            halo: halo,
            x: x,
            y: y,
            z: z,
            radius: 1.6,
            bobTime: Math.random() * 10
        };
        this.foodTargets.push(foodObj);
    }

    createObstacle(cfg) {
        let mesh;
        const color = cfg.color || 0x00f2fe;
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.35,
            roughness: 0.2,
            metalness: 0.8
        });

        if (cfg.type === 'gate') {
            const group = new THREE.Group();
            const yPos = cfg.y || 10.0;
            const h = cfg.h || 4.0;
            const w = cfg.w || 20.0;
            const d = cfg.d || 4.0;

            const beamGeo = new THREE.BoxGeometry(w, h, d);
            const beam = new THREE.Mesh(beamGeo, mat);
            beam.position.set(0, yPos, 0);
            beam.castShadow = true;
            group.add(beam);

            const colGeo = new THREE.CylinderGeometry(1.2, 1.2, yPos, 16);
            const colL = new THREE.Mesh(colGeo, mat);
            colL.position.set(-w * 0.5 + 1.2, yPos * 0.5, 0);
            const colR = new THREE.Mesh(colGeo, mat);
            colR.position.set(w * 0.5 - 1.2, yPos * 0.5, 0);
            group.add(colL);
            group.add(colR);

            group.position.set(cfg.x, 0, cfg.z);
            this.scene.add(group);
            mesh = group;

            this.obstacles.push({
                mesh: mesh,
                type: 'gate',
                x: cfg.x,
                z: cfg.z,
                y: yPos,
                h: h,
                w: w,
                d: d,
                radius: w * 0.5
            });
            return;
        } else if (cfg.type === 'wall' || cfg.type === 'low_wall') {
            const h = cfg.h || (cfg.type === 'low_wall' ? 4.5 : 20);
            const yPos = cfg.y !== undefined ? cfg.y : h / 2;
            const geo = new THREE.BoxGeometry(cfg.w || 2, h, cfg.d || 2);
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.x, yPos, cfg.z);
        } else if (cfg.type === 'pillar') {
            const h = cfg.h || 20;
            const yPos = cfg.y !== undefined ? cfg.y : h / 2;
            const geo = new THREE.CylinderGeometry(cfg.radius || 2.0, cfg.radius || 2.0, h, 16);
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.x, yPos, cfg.z);
        } else {
            const r = cfg.radius || 2.2;
            const yPos = cfg.y !== undefined ? cfg.y : r + 0.5;
            const geo = new THREE.SphereGeometry(r, 20, 20);
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cfg.x, yPos, cfg.z);
        }

        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const obsObj = {
            mesh: mesh,
            radius: cfg.radius || Math.max(cfg.w || 2, cfg.d || 2) * 0.5,
            type: cfg.type,
            x: cfg.x,
            z: cfg.z,
            y: mesh.position.y,
            w: cfg.w || (cfg.radius ? cfg.radius * 2 : 2),
            h: cfg.h || (cfg.radius ? cfg.radius * 2 : 20),
            d: cfg.d || (cfg.radius ? cfg.radius * 2 : 2),
            initialX: cfg.x,
            initialZ: cfg.z,
            speed: cfg.speed || 0,
            moveTime: Math.random() * 10
        };

        this.obstacles.push(obsObj);
    }

    _setupRayLineHelpers() {
        this.rayLinesGroup = new THREE.Group();
        this.scene.add(this.rayLinesGroup);

        this.leftRayLines = [];
        this.rightRayLines = [];
        this.topRayLines = [];
        this.botRayLines = [];

        const leftMat = new THREE.LineBasicMaterial({ color: 0xf72585, transparent: true, opacity: 0.6 });
        const rightMat = new THREE.LineBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.6 });
        const topMat = new THREE.LineBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.7 });
        const botMat = new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.7 });

        for (let i = 0; i < this.numRays; i++) {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 5)]);

            const lineL = new THREE.Line(geo.clone(), leftMat.clone());
            this.rayLinesGroup.add(lineL);
            this.leftRayLines.push(lineL);

            const lineR = new THREE.Line(geo.clone(), rightMat.clone());
            this.rayLinesGroup.add(lineR);
            this.rightRayLines.push(lineR);

            const lineT = new THREE.Line(geo.clone(), topMat.clone());
            this.rayLinesGroup.add(lineT);
            this.topRayLines.push(lineT);

            const lineB = new THREE.Line(geo.clone(), botMat.clone());
            this.rayLinesGroup.add(lineB);
            this.botRayLines.push(lineB);
        }
    }

    _castEyeRays() {
        const leftEyePos = this.flyModel.getLeftEyeWorldPosition();
        const rightEyePos = this.flyModel.getRightEyeWorldPosition();
        const flyCenterPos = this.flyPos.clone().add(new THREE.Vector3(0, 0.4, 0));

        const obstacleMeshes = [];
        this.obstacles.forEach(o => {
            if (o.mesh) obstacleMeshes.push(o.mesh);
        });
        if (this.outerWallMesh) obstacleMeshes.push(this.outerWallMesh);

        const foodMeshes = [];
        this.foodTargets.forEach(f => {
            if (f.mesh) foodMeshes.push(f.mesh);
        });

        const get3DRayDir = (yaw, pitch, azimuthRad, elevationRad) => {
            const dir = new THREE.Vector3(0, 0, 1);
            dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -(pitch + elevationRad));
            dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + azimuthRad);
            return dir.normalize();
        };

        // 1. LC4 Left Eye Horizon Rays
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const azimuth = THREE.MathUtils.degToRad(-90 + frac * 90);
            const rayDir = get3DRayDir(this.flyYaw, this.flyPitch, azimuth, 0);

            // Obstacle raycast
            this.raycaster.set(leftEyePos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes, true);
            let hitDist = this.maxRayDist;
            if (hits.length > 0) hitDist = hits[0].distance;
            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.leftRaySignals[i] = threatVal;

            // Food raycast
            const foodHits = this.raycaster.intersectObjects(foodMeshes, true);
            let foodDist = this.maxRayDist;
            if (foodHits.length > 0) foodDist = foodHits[0].distance;
            this.leftFoodSignals[i] = Math.max(0, 1.0 - (foodDist / this.maxRayDist));

            const lineEnd = leftEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([leftEyePos.x, leftEyePos.y, leftEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.leftRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.leftRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.leftRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }

        // 2. LC4 Right Eye Horizon Rays
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const azimuth = THREE.MathUtils.degToRad(0 + frac * 90);
            const rayDir = get3DRayDir(this.flyYaw, this.flyPitch, azimuth, 0);

            this.raycaster.set(rightEyePos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes, true);
            let hitDist = this.maxRayDist;
            if (hits.length > 0) hitDist = hits[0].distance;
            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.rightRaySignals[i] = threatVal;

            const foodHits = this.raycaster.intersectObjects(foodMeshes, true);
            let foodDist = this.maxRayDist;
            if (foodHits.length > 0) foodDist = foodHits[0].distance;
            this.rightFoodSignals[i] = Math.max(0, 1.0 - (foodDist / this.maxRayDist));

            const lineEnd = rightEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([rightEyePos.x, rightEyePos.y, rightEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.rightRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.rightRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.rightRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }

        // 3. Overhead Top Elevation Rays
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const azimuth = THREE.MathUtils.degToRad(-45 + frac * 90);
            const rayDir = get3DRayDir(this.flyYaw, this.flyPitch, azimuth, Math.PI / 6);

            this.raycaster.set(flyCenterPos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes, true);
            let hitDist = this.maxRayDist;
            if (hits.length > 0) hitDist = hits[0].distance;
            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.topRaySignals[i] = threatVal;

            const foodHits = this.raycaster.intersectObjects(foodMeshes, true);
            let foodDist = this.maxRayDist;
            if (foodHits.length > 0) foodDist = foodHits[0].distance;
            this.topFoodSignals[i] = Math.max(0, 1.0 - (foodDist / this.maxRayDist));

            const lineEnd = flyCenterPos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([flyCenterPos.x, flyCenterPos.y, flyCenterPos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.topRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.topRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.topRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.1;
        }

        // 4. Downward Bottom Elevation Rays
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const azimuth = THREE.MathUtils.degToRad(-45 + frac * 90);
            const rayDir = get3DRayDir(this.flyYaw, this.flyPitch, azimuth, -Math.PI / 6);

            this.raycaster.set(flyCenterPos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes, true);
            let hitDist = this.maxRayDist;
            if (hits.length > 0) hitDist = hits[0].distance;
            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.botRaySignals[i] = threatVal;

            const foodHits = this.raycaster.intersectObjects(foodMeshes, true);
            let foodDist = this.maxRayDist;
            if (foodHits.length > 0) foodDist = foodHits[0].distance;
            this.botFoodSignals[i] = Math.max(0, 1.0 - (foodDist / this.maxRayDist));

            const lineEnd = flyCenterPos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([flyCenterPos.x, flyCenterPos.y, flyCenterPos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.botRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.botRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.botRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.1;
        }
    }

    _updateObstaclesAndFood(delta) {
        // Update Moving Hazards
        this.obstacles.forEach(obs => {
            if (obs.type === 'moving') {
                obs.moveTime += delta * obs.speed;
                if (obs.mesh) {
                    obs.mesh.position.x = obs.initialX + Math.sin(obs.moveTime) * 12;
                    obs.x = obs.mesh.position.x;
                }
            }
        });

        // Floating Animation for Food Targets
        this.foodTargets.forEach(food => {
            food.bobTime += delta * 2.5;
            if (food.group) {
                food.group.position.y = food.y + Math.sin(food.bobTime) * 0.5;
                if (food.halo) food.halo.rotation.z += delta * 1.5;
            }
        });

        // Check Food Collection
        for (let i = this.foodTargets.length - 1; i >= 0; i--) {
            const food = this.foodTargets[i];
            const dist = this.flyPos.distanceTo(food.group.position);
            if (dist < 3.8) {
                // Food Eaten! Trigger Green Particle Splash Effect
                this._createFoodParticleSplash(food.group.position.clone());
                this.scene.remove(food.group);
                this.foodTargets.splice(i, 1);
                this.foodScore++;

                // Respawn a new food target at random 3D position
                const newX = (Math.random() - 0.5) * 50;
                const newZ = (Math.random() - 0.5) * 50;
                const newY = 3.0 + Math.random() * 10.0;
                this.createFoodTarget(newX, newY, newZ);
            }
        }

        // Animate food particle splashes
        for (let i = this.particleSplashes.length - 1; i >= 0; i--) {
            const splash = this.particleSplashes[i];
            splash.life -= delta * 2.0;
            if (splash.life <= 0) {
                this.scene.remove(splash.group);
                this.particleSplashes.splice(i, 1);
            } else {
                splash.particles.forEach(p => {
                    p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
                });
                splash.group.scale.multiplyScalar(0.98);
            }
        }
    }

    _createFoodParticleSplash(pos) {
        const group = new THREE.Group();
        const particles = [];
        const mat = new THREE.MeshBasicMaterial({ color: 0x70e000 });
        const geo = new THREE.SphereGeometry(0.3, 8, 8);

        for (let i = 0; i < 15; i++) {
            const p = new THREE.Mesh(geo, mat.clone());
            p.position.copy(pos);
            p.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 8.0,
                (Math.random() - 0.5) * 8.0 + 3.0,
                (Math.random() - 0.5) * 8.0
            );
            group.add(p);
            particles.push(p);
        }

        this.scene.add(group);
        this.particleSplashes.push({ group: group, particles: particles, life: 1.0 });
    }

    _calculateAntennaOdors() {
        const leftAntennaPos = this.flyPos.clone().add(
            new THREE.Vector3(-0.4, 0.4, 0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw)
        );
        const rightAntennaPos = this.flyPos.clone().add(
            new THREE.Vector3(0.4, 0.4, 0.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw)
        );

        let leftOdor = 0.0;
        let rightOdor = 0.0;
        let odorPitch = 0.0;
        let closestDist = Infinity;

        let totalWeight = 0.0;
        let weightedDY = 0.0;
        let weightedDX = 0.0;
        let weightedDZ = 0.0;

        for (const food of this.foodTargets) {
            if (!food.group) continue;
            const distL = leftAntennaPos.distanceTo(food.group.position);
            const distR = rightAntennaPos.distanceTo(food.group.position);

            const intL = 1.0 / (1.0 + 0.002 * (distL * distL));
            const intR = 1.0 / (1.0 + 0.002 * (distR * distR));

            leftOdor += intL;
            rightOdor += intR;

            const distAvg = (distL + distR) * 0.5;
            if (distAvg < closestDist) {
                closestDist = distAvg;
            }

            const odorWeight = Math.pow(intL + intR, 2.0);
            const dx = food.group.position.x - this.flyPos.x;
            const dz = food.group.position.z - this.flyPos.z;
            const dy = food.group.position.y - this.flyPos.y;

            weightedDX += dx * odorWeight;
            weightedDZ += dz * odorWeight;
            weightedDY += dy * odorWeight;
            totalWeight += odorWeight;
        }

        let targetDY = 0.0;
        let targetDXZ = 1.0;
        if (totalWeight > 0.0001) {
            targetDY = weightedDY / totalWeight;
            const avgDX = weightedDX / totalWeight;
            const avgDZ = weightedDZ / totalWeight;
            targetDXZ = Math.max(0.5, Math.hypot(avgDX, avgDZ));
        }

        if (closestDist < 60.0 && Math.abs(targetDY) > 0.2) {
            // Compute exact 3D pitch elevation angle required to climb/descend to food altitude
            const reqAngle = Math.atan2(targetDY, targetDXZ); // in radians
            const maxPitchClamp = closestDist < 20.0 ? 1.25 : 0.85;
            odorPitch = Math.max(-maxPitchClamp, Math.min(maxPitchClamp, reqAngle));
        }

        return { leftOdor, rightOdor, odorPitch, closestDist, targetDY };
    }

    _updatePhysics(delta) {
        this._updateObstaclesAndFood(delta);
        this._castEyeRays();
        const odors = this._calculateAntennaOdors();

        const simDelta = delta * (this.simSpeedMultiplier || 0.65);
        let wLeft = 1.0;
        let wRight = 1.0;

        if (this.isAutoPilot) {
            // Run Connectome Neural Matrix Engine in 3D (LC4 Avoidance + LC10 Vision + LHON Olfactory Chemotaxis)
            const res = this.brain.update(
                this.leftRaySignals, this.rightRaySignals, this.topRaySignals, this.botRaySignals,
                this.leftFoodSignals, this.rightFoodSignals, this.topFoodSignals, this.botFoodSignals,
                odors.leftOdor, odors.rightOdor, odors.odorPitch
            );
            wLeft = res.wingPowerLeft;
            wRight = res.wingPowerRight;

            // Direct responsive 3D pitch tracking for altitude climbing toward food
            if (res.isForaging && Math.abs(odors.odorPitch) > 0.04) {
                // Adaptive lerp rate based on distance: fast pitch reaction when climbing
                const lerpRate = Math.min(0.45, 0.18 + (1.0 / Math.max(1.0, odors.closestDist || 10)) * 2.5);
                this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, odors.odorPitch, lerpRate);
            } else {
                this.flyPitch += res.pitchDrive * simDelta * 0.7;
                this.flyPitch *= 0.96; // Apply pitch dampening ONLY when NOT tracking odor pitch!
            }
        } else {
            // Manual Arrow/WASD/QE key drive
            if (this.keys.ArrowLeft || this.keys.a) wLeft = 0.3, wRight = 1.8;
            if (this.keys.ArrowRight || this.keys.d) wLeft = 1.8, wRight = 0.3;
            if (this.keys.ArrowUp || this.keys.w) wLeft = 1.5, wRight = 1.5;
            if (this.keys.ArrowDown || this.keys.s) wLeft = 0.4, wRight = 0.4;
            if (this.keys.q || this.keys.Q) this.flyPitch += 1.2 * simDelta;
            if (this.keys.e || this.keys.E) this.flyPitch -= 1.2 * simDelta;
            this.flyPitch *= 0.96;
        }

        this.flyPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.flyPitch));

        // Smooth biological movement speeds
        const forwardThrust = (wLeft + wRight) * 0.5 * 4.8;
        const turnRate = (wRight - wLeft) * 1.4;

        this.flyYaw += turnRate * simDelta;

        // Enhanced vertical climbing thrust when fly needs to climb to elevated food
        let verticalScale = 1.0;
        if (this.isAutoPilot && odors.targetDY > 0.5 && odors.closestDist < 25.0) {
            verticalScale = 1.45; // 45% boost to vertical climb velocity when ascending towards food
        }

        const speedXZ = forwardThrust * Math.cos(this.flyPitch);
        const speedY = forwardThrust * Math.sin(this.flyPitch) * verticalScale;

        this.flyPos.x += Math.sin(this.flyYaw) * speedXZ * simDelta;
        this.flyPos.z += Math.cos(this.flyYaw) * speedXZ * simDelta;
        this.flyPos.y += speedY * simDelta;

        // Ceiling & Ground Constraints
        if (this.flyPos.y >= this.ceilingY - 2.0) {
            this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, -0.6, 0.2);
        }
        if (this.flyPos.y > this.ceilingY) this.flyPos.y = this.ceilingY;

        if (this.flyPos.y <= 1.5) {
            this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, 0.2, 0.2);
        }
        if (this.flyPos.y < 1.0) this.flyPos.y = 1.0;

        // Outer Perimeter Containment
        const maxRadius = 42.0;
        const currentRadius = Math.hypot(this.flyPos.x, this.flyPos.z);
        if (currentRadius > maxRadius) {
            const angle = Math.atan2(this.flyPos.z, this.flyPos.x);
            this.flyPos.x = Math.cos(angle) * maxRadius;
            this.flyPos.z = Math.sin(angle) * maxRadius;
            const inwardAngle = Math.atan2(-this.flyPos.x, -this.flyPos.z);
            this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, inwardAngle, 0.4);
        }

        // Obstacle Collision
        const flyRadius = 1.2;
        this.obstacles.forEach(obs => {
            const obsY = obs.y !== undefined ? obs.y : 10;
            const obsH = obs.h || 20;

            const yMin = obsY - (obsH * 0.5) - flyRadius;
            const yMax = obsY + (obsH * 0.5) + flyRadius;

            if (this.flyPos.y >= yMin && this.flyPos.y <= yMax) {
                if (obs.type === 'wall' || obs.type === 'low_wall') {
                    const wHalf = (obs.w || 2) * 0.5 + flyRadius;
                    const dHalf = (obs.d || 2) * 0.5 + flyRadius;
                    const dx = this.flyPos.x - obs.x;
                    const dz = this.flyPos.z - obs.z;
                    if (Math.abs(dx) < wHalf && Math.abs(dz) < dHalf) {
                        this.flyYaw += Math.PI * 0.5;
                        this.flyPos.x += Math.sin(this.flyYaw) * 1.5;
                        this.flyPos.z += Math.cos(this.flyYaw) * 1.5;
                    }
                } else if (obs.type === 'gate') {
                    const wHalf = (obs.w || 20) * 0.5 + flyRadius;
                    const dHalf = (obs.d || 4) * 0.5 + flyRadius;
                    const dx = this.flyPos.x - obs.x;
                    const dz = this.flyPos.z - obs.z;

                    if (Math.abs(dx) < wHalf && Math.abs(dz) < dHalf) {
                        if (this.flyPos.y < obsY) {
                            this.flyPos.y = obsY - (obsH * 0.5) - flyRadius;
                            this.flyPitch = -0.5;
                        } else {
                            this.flyPos.y = obsY + (obsH * 0.5) + flyRadius;
                            this.flyPitch = 0.5;
                        }
                    }
                } else {
                    const minDist = (obs.radius || 2.0) + flyRadius;
                    const dx = this.flyPos.x - (obs.x || obs.mesh.position.x);
                    const dz = this.flyPos.z - (obs.z || obs.mesh.position.z);
                    const dist = Math.hypot(dx, dz);

                    if (dist < minDist && dist > 0.0001) {
                        const overlap = minDist - dist;
                        this.flyPos.x += (dx / dist) * overlap;
                        this.flyPos.z += (dz / dist) * overlap;

                        const avoidAngle = Math.atan2(dz, dx);
                        this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, avoidAngle, 0.35);
                    }
                }
            }
        });

        // Corner Stuck Saccade Reflex
        const moveDistThisFrame = this.flyPos.distanceTo(this.lastPos);
        const isNearObstacle = (this.brain.v_left_eye > 0.18 || this.brain.v_right_eye > 0.18);

        if (moveDistThisFrame < 0.06 && isNearObstacle) {
            this.stuckTimer = (this.stuckTimer || 0) + simDelta;
        } else {
            this.stuckTimer = Math.max(0, (this.stuckTimer || 0) - simDelta * 2.0);
        }

        if (this.stuckTimer > 0.5) {
            const backDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
            this.flyPos.add(backDir.multiplyScalar(4.0 * simDelta));
            const turnSign = Math.random() > 0.5 ? 1 : -1;
            this.flyYaw += turnSign * (Math.PI * 0.75 + (Math.random() - 0.5));
            this.stuckTimer = 0.0;
        }

        this.flyModel.group.position.copy(this.flyPos);
        this.flyModel.group.rotation.set(0, 0, 0);
        this.flyModel.group.rotation.y = this.flyYaw;
        this.flyModel.group.rotation.x = -this.flyPitch;

        if (this.groundShadowRing) {
            this.groundShadowRing.position.set(this.flyPos.x, 0.08, this.flyPos.z);
            this.groundShadowRing.rotation.y = this.flyYaw;
        }

        this.flyModel.updateWings(simDelta, wLeft, wRight, this.flyPitch);

        const moveDist = this.flyPos.distanceTo(this.lastPos);
        this.flightDistance += moveDist;
        this.lastPos.copy(this.flyPos);

        if (this.brain.v_left_eye > 0.4 || this.brain.v_right_eye > 0.4 || this.brain.v_top_eye > 0.4 || this.brain.v_bottom_eye > 0.4) {
            this.dodgeCount++;
        }

        this.historyLeftWing.push(wLeft);
        this.historyLeftWing.shift();
        this.historyRightWing.push(wRight);
        this.historyRightWing.shift();

        this._updateCamera();
        this._updateHUD(wLeft, wRight, forwardThrust);
    }

    _updateCamera() {
        if (!this.smoothLookTarget) {
            this.smoothLookTarget = this.flyPos.clone();
        }

        if (this.activeCamMode === 'follow') {
            const offset = new THREE.Vector3(0, 4.2, -9.5);
            offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch * 0.4);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            const targetCamPos = this.flyPos.clone().add(offset);
            this.camera.position.lerp(targetCamPos, 0.045);

            const rawLookTarget = this.flyPos.clone().add(
                new THREE.Vector3(0, 1.0, 3.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw)
            );
            this.smoothLookTarget.lerp(rawLookTarget, 0.06);
            this.camera.lookAt(this.smoothLookTarget);
        } else if (this.activeCamMode === 'cockpit') {
            const eyeOffset = new THREE.Vector3(0, 0.4, 0.75);
            eyeOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch);
            eyeOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            const targetCamPos = this.flyPos.clone().add(eyeOffset);
            this.camera.position.lerp(targetCamPos, 0.2);

            const lookDir = new THREE.Vector3(0, 0, 15.0);
            lookDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch);
            lookDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            const rawLookTarget = this.flyPos.clone().add(lookDir);
            this.smoothLookTarget.lerp(rawLookTarget, 0.15);
            this.camera.lookAt(this.smoothLookTarget);
        } else if (this.activeCamMode === 'top') {
            const targetCamPos = new THREE.Vector3(this.flyPos.x, this.ceilingY + 15, this.flyPos.z + 0.1);
            this.camera.position.lerp(targetCamPos, 0.06);
            this.smoothLookTarget.lerp(this.flyPos, 0.06);
            this.camera.lookAt(this.smoothLookTarget);
        } else if (this.activeCamMode === 'orbit') {
            this.orbitControls.target.lerp(this.flyPos, 0.08);
            this.orbitControls.update();
        }
    }

    _updateHUD(wLeft, wRight, speed) {
        const elSpeed = document.getElementById('statSpeed');
        const elDist = document.getElementById('statDist');
        const elFood = document.getElementById('statFood');
        const elAlt = document.getElementById('statAlt');
        const elPitch = document.getElementById('statPitch');

        if (elSpeed) elSpeed.innerText = speed.toFixed(1);
        if (elDist) elDist.innerText = Math.floor(this.flightDistance) + 'm';
        if (elFood) elFood.innerText = this.foodScore;
        if (elAlt) elAlt.innerText = this.flyPos.y.toFixed(1) + 'm';
        if (elPitch) elPitch.innerText = THREE.MathUtils.radToDeg(this.flyPitch).toFixed(0) + '°';

        // Eye Sensor Bars (Red/Cyan for Obstacles, Green overlay when Foraging)
        for (let i = 0; i < this.numRays; i++) {
            const barL = document.getElementById(`sbarL_${i}`);
            const barR = document.getElementById(`sbarR_${i}`);
            if (barL) {
                const threatL = this.leftRaySignals[i];
                const foodL = this.leftFoodSignals[i];
                const hL = Math.max(10, Math.floor(Math.max(threatL, foodL) * 100));
                barL.style.height = `${hL}%`;
                barL.style.backgroundColor = foodL > threatL ? '#70e000' : (threatL > 0.5 ? 'var(--danger-red)' : 'var(--accent-magenta)');
            }
            if (barR) {
                const threatR = this.rightRaySignals[i];
                const foodR = this.rightFoodSignals[i];
                const hR = Math.max(10, Math.floor(Math.max(threatR, foodR) * 100));
                barR.style.height = `${hR}%`;
                barR.style.backgroundColor = foodR > threatR ? '#70e000' : (threatR > 0.5 ? 'var(--danger-red)' : 'var(--accent-cyan)');
            }
        }

        // Antennal Olfactory Chemotaxis Gauges
        const fillOlL = document.getElementById('olfFillL');
        const numOlL = document.getElementById('olfNumL');
        const fillOlR = document.getElementById('olfFillR');
        const numOlR = document.getElementById('olfNumR');
        const modeOl = document.getElementById('olfModeLabel');

        const vOlL = this.brain.v_olf_left || 0;
        const vOlR = this.brain.v_olf_right || 0;

        if (fillOlL && numOlL) {
            fillOlL.style.width = `${Math.min(100, (vOlL / 2.0) * 100)}%`;
            numOlL.innerText = vOlL.toFixed(2);
        }
        if (fillOlR && numOlR) {
            fillOlR.style.width = `${Math.min(100, (vOlR / 2.0) * 100)}%`;
            numOlR.innerText = vOlR.toFixed(2);
        }
        if (modeOl) {
            if (this.brain.v_left_eye > 0.3 || this.brain.v_right_eye > 0.3) {
                modeOl.innerText = 'Avoidance (LC4)';
                modeOl.style.color = 'var(--danger-red)';
            } else if (vOlL > 0.1 || vOlR > 0.1) {
                modeOl.innerText = 'Tropotaxis & Surge (ORN-PN-LHON)';
                modeOl.style.color = '#70e000';
            } else {
                modeOl.innerText = 'Search / Cruising';
                modeOl.style.color = 'var(--accent-cyan)';
            }
        }

        const fillL = document.getElementById('wingFillL');
        const numL = document.getElementById('wingNumL');
        const fillR = document.getElementById('wingFillR');
        const numR = document.getElementById('wingNumR');

        if (fillL && numL) {
            fillL.style.width = `${Math.min(100, (wLeft / 2.5) * 100)}%`;
            numL.innerText = wLeft.toFixed(2);
        }
        if (fillR && numR) {
            fillR.style.width = `${Math.min(100, (wRight / 2.5) * 100)}%`;
            numR.innerText = wRight.toFixed(2);
        }

        this._drawOscilloscope();
    }

    _drawOscilloscope() {
        if (!this.oscCtx) return;
        const ctx = this.oscCtx;
        const w = this.oscilloscopeCanvas.width;
        const h = this.oscilloscopeCanvas.height;

        ctx.fillStyle = '#04080f';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        ctx.strokeStyle = '#f72585';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < this.historyLeftWing.length; i++) {
            const x = (i / (this.historyLength - 1)) * w;
            const val = this.historyLeftWing[i];
            const y = h - (val / 3.0) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < this.historyRightWing.length; i++) {
            const x = (i / (this.historyLength - 1)) * w;
            const val = this.historyRightWing[i];
            const y = h - (val / 3.0) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    _bindUI() {
        const toggle = document.getElementById('autoPilotToggle');
        const modeLabel = document.getElementById('modeLabel');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.isAutoPilot = e.target.checked;
                if (modeLabel) {
                    modeLabel.innerText = this.isAutoPilot ? 'Connectome Auto-Pilot (LC4 Avoid + LC10 Forage)' : 'Manual Flight Controls (WASD / Arrows / Q-E Pitch)';
                    modeLabel.style.color = this.isAutoPilot ? 'var(--accent-cyan)' : 'var(--accent-gold)';
                }
            });
        }

        const mazeSelect = document.getElementById('mazeSelect');
        if (mazeSelect) {
            mazeSelect.value = 'maze3d';
            mazeSelect.addEventListener('change', (e) => {
                this._spawnDefaultObstacles(e.target.value);
                this.flyPos.set(0, 2.5, 0);
                this.flyYaw = 0;
                this.flyPitch = 0;
            });
        }

        const speedSelect = document.getElementById('speedSelect');
        if (speedSelect) {
            speedSelect.value = '0.65';
            speedSelect.addEventListener('change', (e) => {
                this.simSpeedMultiplier = parseFloat(e.target.value) || 0.65;
            });
        }

        const toggleSidebarBtn = document.getElementById('btnToggleSidebar');
        const container = document.querySelector('.app-container');
        if (toggleSidebarBtn && container) {
            toggleSidebarBtn.addEventListener('click', () => {
                this.isSidebarCollapsed = !this.isSidebarCollapsed;
                if (this.isSidebarCollapsed) {
                    container.classList.add('sidebar-collapsed');
                    toggleSidebarBtn.innerText = '📊 Show Panels';
                    toggleSidebarBtn.classList.add('active');
                } else {
                    container.classList.remove('sidebar-collapsed');
                    toggleSidebarBtn.innerText = '🖥️ Fullscreen View';
                    toggleSidebarBtn.classList.remove('active');
                }
                setTimeout(() => this.onWindowResize(), 100);
            });
        }

        const camBtns = document.querySelectorAll('.cam-btn');
        camBtns.forEach(btn => {
            if (btn.id === 'btnToggleSidebar') return;
            btn.addEventListener('click', (e) => {
                camBtns.forEach(b => {
                    if (b.id !== 'btnToggleSidebar') b.classList.remove('active');
                });
                btn.classList.add('active');
                this.activeCamMode = btn.dataset.cam;
            });
        });

        // Spawn Food Button
        const btnSpawnFood = document.getElementById('btnSpawnFood');
        if (btnSpawnFood) {
            btnSpawnFood.addEventListener('click', () => {
                const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
                const spawnPos = this.flyPos.clone().add(forwardDir.multiplyScalar(12.0));
                this.createFoodTarget(spawnPos.x, Math.max(3.0, this.flyPos.y), spawnPos.z);
            });
        }

        // Spawn Obstacle Button
        const btnSpawn = document.getElementById('btnSpawnObstacle');
        if (btnSpawn) {
            btnSpawn.addEventListener('click', () => {
                const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
                const spawnPos = this.flyPos.clone().add(forwardDir.multiplyScalar(10.0));
                
                const randType = Math.random();
                if (randType < 0.4) {
                    this.createObstacle({
                        type: 'pillar',
                        x: spawnPos.x,
                        z: spawnPos.z,
                        radius: 2.2,
                        h: 20.0,
                        y: 10.0,
                        color: 0xff0055
                    });
                } else if (randType < 0.7) {
                    this.createObstacle({
                        type: 'sphere',
                        x: spawnPos.x,
                        z: spawnPos.z,
                        y: Math.max(2.2, this.flyPos.y),
                        radius: 2.5,
                        color: 0xff0055
                    });
                } else {
                    this.createObstacle({
                        type: 'gate',
                        x: spawnPos.x,
                        z: spawnPos.z,
                        y: Math.max(5.0, this.flyPos.y + 2.0),
                        w: 16.0,
                        h: 4.0,
                        color: 0xff0055
                    });
                }
            });
        }

        const btnReset = document.getElementById('btnResetFly');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.flyPos.set(0, 2.5, 0);
                this.flyYaw = 0;
                this.flyPitch = 0;
                this.foodScore = 0;
            });
        }

        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            const clickRay = new THREE.Raycaster();
            clickRay.setFromCamera(mouse, this.camera);
            const intersects = clickRay.intersectObject(this.groundMesh);
            if (intersects.length > 0) {
                const pt = intersects[0].point;
                // Shift click spawns food, normal click spawns obstacle
                if (e.shiftKey) {
                    this.createFoodTarget(pt.x, 6.0, pt.z);
                } else {
                    this.createObstacle({
                        type: Math.random() > 0.5 ? 'pillar' : 'sphere',
                        x: pt.x,
                        z: pt.z,
                        y: 2.5,
                        radius: 2.2,
                        h: 20.0,
                        color: 0xffb703
                    });
                }
            }
        });
    }

    _bindEvents() {
        window.addEventListener('resize', () => {
            const w = this.container.clientWidth;
            const h = this.container.clientHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });

        window.addEventListener('keydown', (e) => {
            if (this.keys.hasOwnProperty(e.key)) this.keys[e.key] = true;
        });

        window.addEventListener('keyup', (e) => {
            if (this.keys.hasOwnProperty(e.key)) this.keys[e.key] = false;
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        this._updatePhysics(delta);
        this.renderer.render(this.scene, this.camera);
    }
}

// Instantiate application on DOM Load
window.addEventListener('DOMContentLoaded', () => {
    window.flyRoverApp = new FlyRoverApp();
});
