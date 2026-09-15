/**
 * 3D Fruit Fly Autonomous Rover Simulation Controller (Three.js)
 * Full 3D Volumetric Avoidance: Yaw turning, Pitch climbing/diving, Invisible Ceiling & Overpass Gaps
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

        // Environment & Obstacles
        this.obstacles = [];
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

        // Spawn default maze layout
        this._spawnDefaultObstacles('maze3d');

        // Raycasting & Sensors (Horizon + Overhead + Downward)
        this.raycaster = new THREE.Raycaster();
        this.numRays = 16;
        this.maxRayDist = 18.0;
        this.leftRaySignals = new Float32Array(this.numRays);
        this.rightRaySignals = new Float32Array(this.numRays);
        this.topRaySignals = new Float32Array(this.numRays);
        this.botRaySignals = new Float32Array(this.numRays);

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
    }

    _createHighContrastFloorTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        // High Contrast Cyber Checkerboard Tiles
        const tileSize = 64;
        for (let y = 0; y < 512; y += tileSize) {
            for (let x = 0; x < 512; x += tileSize) {
                const isEven = (((x / tileSize) + (y / tileSize)) % 2 === 0);
                ctx.fillStyle = isEven ? '#0b1324' : '#14223d';
                ctx.fillRect(x, y, tileSize, tileSize);

                // High Contrast Neon Grid Border
                ctx.strokeStyle = isEven ? '#00f2fe' : '#f72585';
                ctx.lineWidth = 4;
                ctx.strokeRect(x, y, tileSize, tileSize);

                // Glowing Corner Dots
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

        // Ground Plane with High Contrast Texture
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

        // Ground Shadow Ring & Heading Arrow attached beneath the Fruit Fly
        this.groundShadowRing = new THREE.Group();
        const shadowRingGeo = new THREE.RingGeometry(1.2, 1.5, 32);
        const shadowRingMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide });
        const shadowRing = new THREE.Mesh(shadowRingGeo, shadowRingMat);
        shadowRing.rotation.x = Math.PI / 2;
        this.groundShadowRing.add(shadowRing);

        // Arrow indicator pointing forward on ground
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

        // 3D Outer Perimeter Wall Enclosure (Height = ceilingY)
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
            // 🏰 3D Volumetric Labyrinth Layout (多層3D立體迷宮與過街橋天花板)
            const maze3dDefs = [
                // Seamless Outer Perimeter Boundary Walls
                { type: 'wall', x: 0, z: -35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 0, z: 35, w: 74, h: 20, d: 4, y: 10, color: 0x00f2fe },
                { type: 'wall', x: -35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 35, z: 0, w: 4, h: 20, d: 74, y: 10, color: 0x00f2fe },

                // Corner Smooth Junction Pillars
                { type: 'pillar', x: -33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: -33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: -33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },
                { type: 'pillar', x: 33, z: 33, radius: 3.0, h: 20, y: 10, color: 0x00f2fe },

                // 1. Low Barriers (Height = 4.5m) -> Fly can climb over (Y > 4.5)
                { type: 'low_wall', x: -16, z: -18, w: 26, h: 4.5, d: 3, y: 2.25, color: 0x00f2fe },
                { type: 'low_wall', x: 16, z: 18, w: 26, h: 4.5, d: 3, y: 2.25, color: 0x00f2fe },

                // 2. Suspended Overpass Gates (Height = 5.0m suspended at Y = 12m) -> Fly can dive underneath (Y < 9.5)
                { type: 'gate', x: 0, z: -15, w: 28, h: 5.0, d: 4, y: 12.0, color: 0xf72585 },
                { type: 'gate', x: 0, z: 15, w: 28, h: 5.0, d: 4, y: 12.0, color: 0xf72585 },

                // 3. Full Height Center Divider Passage Walls with Openings
                { type: 'wall', x: -15, z: 0, w: 18, h: 20, d: 3, y: 10, color: 0x4cc9f0 },
                { type: 'wall', x: 15, z: 0, w: 18, h: 20, d: 3, y: 10, color: 0x4cc9f0 },

                // 4. Floating Spheres in Mid-Air Space (Y = 7.0m to 14.0m)
                { type: 'floating', x: -10, z: 12, radius: 2.8, y: 8.5, color: 0xffb703 },
                { type: 'floating', x: 10, z: -12, radius: 2.8, y: 11.0, color: 0xffb703 },
                { type: 'floating', x: 0, z: 0, radius: 3.2, y: 9.0, color: 0xff0055 },

                // 5. Sentinel Moving Hazards patrolling mid-air corridors
                { type: 'moving', x: -8, z: -25, radius: 2.2, y: 4.0, color: 0xff0055, speed: 1.2 },
                { type: 'moving', x: 8, z: 25, radius: 2.2, y: 8.0, color: 0x4cc9f0, speed: -1.2 }
            ];
            maze3dDefs.forEach(cfg => this.createObstacle(cfg));
        } else if (type === 'maze') {
            // Planar Maze
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
            // Dual Straight Corridors
            const corridorWalls = [
                { type: 'wall', x: -10, z: 0, w: 2, h: 20, d: 60, y: 10, color: 0x00f2fe },
                { type: 'wall', x: 10, z: 0, w: 2, h: 20, d: 60, y: 10, color: 0x00f2fe },
                { type: 'gate', x: 0, z: 18, w: 18, h: 5, d: 3, y: 11, color: 0xff0055 },
                { type: 'low_wall', x: 0, z: -18, w: 18, h: 4, d: 3, y: 2, color: 0xffb703 },
                { type: 'moving', x: 0, z: 0, radius: 2.5, y: 5, color: 0xf72585, speed: 1.5 }
            ];
            corridorWalls.forEach(cfg => this.createObstacle(cfg));
        } else {
            // Scattered Arena
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
            // Suspended Overpass Gate Bridge
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

            // Left / Right Support Columns
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
            // Sphere / Floating / Moving
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

        // Helper to compute 3D direction vector from yaw, pitch, azimuth offset, elevation offset
        const get3DRayDir = (yaw, pitch, azimuthRad, elevationRad) => {
            const dir = new THREE.Vector3(0, 0, 1);
            dir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -(pitch + elevationRad));
            dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + azimuthRad);
            return dir.normalize();
        };

        // 1. Left Eye Horizon Rays (-90° to 0° azimuth)
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const azimuth = THREE.MathUtils.degToRad(-90 + frac * 90);
            const rayDir = get3DRayDir(this.flyYaw, this.flyPitch, azimuth, 0);

            this.raycaster.set(leftEyePos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes, true);

            let hitDist = this.maxRayDist;
            if (hits.length > 0) hitDist = hits[0].distance;

            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.leftRaySignals[i] = threatVal;

            const lineEnd = leftEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([leftEyePos.x, leftEyePos.y, leftEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.leftRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.leftRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.leftRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }

        // 2. Right Eye Horizon Rays (0° to +90° azimuth)
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

            const lineEnd = rightEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([rightEyePos.x, rightEyePos.y, rightEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.rightRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.rightRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.rightRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }

        // 3. Overhead Top Elevation Rays (+30° Pitch offset)
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

            const lineEnd = flyCenterPos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([flyCenterPos.x, flyCenterPos.y, flyCenterPos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.topRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.topRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.topRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.1;
        }

        // 4. Downward Bottom Elevation Rays (-30° Pitch offset)
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

            const lineEnd = flyCenterPos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const pos = new Float32Array([flyCenterPos.x, flyCenterPos.y, flyCenterPos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.botRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            this.botRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.botRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.1;
        }
    }

    _updateObstacles(delta) {
        this.obstacles.forEach(obs => {
            if (obs.type === 'moving') {
                obs.moveTime += delta * obs.speed;
                if (obs.mesh) {
                    obs.mesh.position.x = obs.initialX + Math.sin(obs.moveTime) * 12;
                    obs.x = obs.mesh.position.x;
                }
            }
        });
    }

    _updatePhysics(delta) {
        this._updateObstacles(delta);
        this._castEyeRays();

        let wLeft = 1.0;
        let wRight = 1.0;

        if (this.isAutoPilot) {
            // Run Connectome Neural Matrix Engine in 3D
            const res = this.brain.update(this.leftRaySignals, this.rightRaySignals, this.topRaySignals, this.botRaySignals);
            wLeft = res.wingPowerLeft;
            wRight = res.wingPowerRight;
            this.flyPitch += res.pitchDrive * delta * 1.5;
        } else {
            // Manual Arrow/WASD/QE key drive
            if (this.keys.ArrowLeft || this.keys.a) wLeft = 0.3, wRight = 2.0;
            if (this.keys.ArrowRight || this.keys.d) wLeft = 2.0, wRight = 0.3;
            if (this.keys.ArrowUp || this.keys.w) wLeft = 1.8, wRight = 1.8;
            if (this.keys.ArrowDown || this.keys.s) wLeft = 0.4, wRight = 0.4;
            if (this.keys.q || this.keys.Q) this.flyPitch += 1.8 * delta; // Pitch Up / Climb
            if (this.keys.e || this.keys.E) this.flyPitch -= 1.8 * delta; // Pitch Down / Dive
        }

        // Natural pitch decay back towards level flight (0 rad)
        this.flyPitch *= 0.96;
        // Clamp pitch angle between -45° (-0.785 rad) and +45° (+0.785 rad)
        this.flyPitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.flyPitch));

        // 6-DOF Kinematics:
        // Forward Thrust (Speed): v ∝ (wLeft + wRight)
        // Differential Yaw Angular Velocity: ω ∝ (wRight - wLeft)
        const forwardThrust = (wLeft + wRight) * 0.5 * 12.0;
        const turnRate = (wRight - wLeft) * 2.8;

        this.flyYaw += turnRate * delta;

        const speedXZ = forwardThrust * Math.cos(this.flyPitch);
        const speedY = forwardThrust * Math.sin(this.flyPitch);

        this.flyPos.x += Math.sin(this.flyYaw) * speedXZ * delta;
        this.flyPos.z += Math.cos(this.flyYaw) * speedXZ * delta;
        this.flyPos.y += speedY * delta;

        // 1. Invisible Ceiling Constraint (Y = 20.0m) & Ground Floor Constraint (Y = 1.0m)
        if (this.flyPos.y >= this.ceilingY - 2.0) {
            // Near invisible ceiling -> Pitch downward to reflect away
            this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, -0.6, 0.2);
        }
        if (this.flyPos.y > this.ceilingY) {
            this.flyPos.y = this.ceilingY;
        }

        if (this.flyPos.y <= 1.5) {
            // Near floor -> Pitch upward to climb away
            this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, 0.2, 0.2);
        }
        if (this.flyPos.y < 1.0) {
            this.flyPos.y = 1.0;
        }

        // 2. Outer Perimeter Wall Cylinder Containment (Radius = 42.0m)
        const maxRadius = 42.0;
        const currentRadius = Math.hypot(this.flyPos.x, this.flyPos.z);
        if (currentRadius > maxRadius) {
            const angle = Math.atan2(this.flyPos.z, this.flyPos.x);
            this.flyPos.x = Math.cos(angle) * maxRadius;
            this.flyPos.z = Math.sin(angle) * maxRadius;
            const inwardAngle = Math.atan2(-this.flyPos.x, -this.flyPos.z);
            this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, inwardAngle, 0.4);
        }

        // 3. 3D Volumetric Obstacle Physical Collision & Turning Torque
        const flyRadius = 1.2;
        this.obstacles.forEach(obs => {
            const obsY = obs.y !== undefined ? obs.y : 10;
            const obsH = obs.h || 20;

            // Check vertical height overlap interval
            const yMin = obsY - (obsH * 0.5) - flyRadius;
            const yMax = obsY + (obsH * 0.5) + flyRadius;

            if (this.flyPos.y >= yMin && this.flyPos.y <= yMax) {
                // Fly is within vertical range of this obstacle
                if (obs.type === 'wall' || obs.type === 'low_wall') {
                    const wHalf = (obs.w || 2) * 0.5 + flyRadius;
                    const dHalf = (obs.d || 2) * 0.5 + flyRadius;
                    const dx = this.flyPos.x - obs.x;
                    const dz = this.flyPos.z - obs.z;

                    if (Math.abs(dx) < wHalf && Math.abs(dz) < dHalf) {
                        const overlapX = wHalf - Math.abs(dx);
                        const overlapZ = dHalf - Math.abs(dz);
                        let wallNormalX = 0, wallNormalZ = 0;

                        if (overlapX < overlapZ) {
                            wallNormalX = dx > 0 ? 1 : -1;
                            this.flyPos.x += dx > 0 ? overlapX : -overlapX;
                        } else {
                            wallNormalZ = dz > 0 ? 1 : -1;
                            this.flyPos.z += dz > 0 ? overlapZ : -overlapZ;
                        }

                        const targetTurnAngle = Math.atan2(wallNormalZ, wallNormalX);
                        this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, targetTurnAngle, 0.45);
                    }
                } else if (obs.type === 'gate') {
                    // Overpass bridge beam box collision
                    const wHalf = (obs.w || 20) * 0.5 + flyRadius;
                    const dHalf = (obs.d || 4) * 0.5 + flyRadius;
                    const dx = this.flyPos.x - obs.x;
                    const dz = this.flyPos.z - obs.z;

                    if (Math.abs(dx) < wHalf && Math.abs(dz) < dHalf) {
                        // Push back vertically or horizontally
                        if (this.flyPos.y < obsY) {
                            this.flyPos.y = obsY - (obsH * 0.5) - flyRadius;
                            this.flyPitch = -0.5; // Dive
                        } else {
                            this.flyPos.y = obsY + (obsH * 0.5) + flyRadius;
                            this.flyPitch = 0.5; // Climb
                        }
                    }
                } else {
                    // Sphere / Pillar / Floating
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

        // 4. Biological Corner Anti-Stuck & Reverse Escape Saccade Reflex
        const moveDistThisFrame = this.flyPos.distanceTo(this.lastPos);
        const isNearObstacle = (this.brain.v_left_eye > 0.18 || this.brain.v_right_eye > 0.18);

        if (moveDistThisFrame < 0.06 && isNearObstacle) {
            this.stuckTimer = (this.stuckTimer || 0) + delta;
        } else {
            this.stuckTimer = Math.max(0, (this.stuckTimer || 0) - delta * 2.0);
        }

        if (this.stuckTimer > 0.5) {
            const backDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
            this.flyPos.add(backDir.multiplyScalar(4.0 * delta));
            const turnSign = Math.random() > 0.5 ? 1 : -1;
            this.flyYaw += turnSign * (Math.PI * 0.75 + (Math.random() - 0.5));
            this.stuckTimer = 0.0;
        }

        // Apply 3D position and rotational pitch/yaw transforms to Fly Mesh & Ground Shadow Ring
        this.flyModel.group.position.copy(this.flyPos);
        this.flyModel.group.rotation.set(0, 0, 0);
        this.flyModel.group.rotation.y = this.flyYaw;
        this.flyModel.group.rotation.x = -this.flyPitch;

        if (this.groundShadowRing) {
            this.groundShadowRing.position.set(this.flyPos.x, 0.08, this.flyPos.z);
            this.groundShadowRing.rotation.y = this.flyYaw;
        }

        // Animate wings with pitch dynamic wing beat control
        this.flyModel.updateWings(delta, wLeft, wRight, this.flyPitch);

        // Update Stats
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
        if (this.activeCamMode === 'follow') {
            const offset = new THREE.Vector3(0, 4.5, -9.0);
            offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch * 0.5);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            const targetCamPos = this.flyPos.clone().add(offset);
            this.camera.position.lerp(targetCamPos, 0.1);

            const lookTarget = this.flyPos.clone().add(new THREE.Vector3(0, 1.2, 3.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw));
            this.camera.lookAt(lookTarget);
        } else if (this.activeCamMode === 'cockpit') {
            const eyeOffset = new THREE.Vector3(0, 0.4, 0.75);
            eyeOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch);
            eyeOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            this.camera.position.copy(this.flyPos.clone().add(eyeOffset));

            const lookDir = new THREE.Vector3(0, 0, 15.0);
            lookDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.flyPitch);
            lookDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

            this.camera.lookAt(this.flyPos.clone().add(lookDir));
        } else if (this.activeCamMode === 'top') {
            this.camera.position.set(this.flyPos.x, this.ceilingY + 15, this.flyPos.z + 0.1);
            this.camera.lookAt(this.flyPos);
        } else if (this.activeCamMode === 'orbit') {
            this.orbitControls.target.copy(this.flyPos);
            this.orbitControls.update();
        }
    }

    _updateHUD(wLeft, wRight, speed) {
        // Stats Boxes
        const elSpeed = document.getElementById('statSpeed');
        const elDist = document.getElementById('statDist');
        const elDodge = document.getElementById('statDodge');
        const elSyn = document.getElementById('statSynapses');
        const elAlt = document.getElementById('statAlt');
        const elPitch = document.getElementById('statPitch');

        if (elSpeed) elSpeed.innerText = speed.toFixed(1);
        if (elDist) elDist.innerText = Math.floor(this.flightDistance) + 'm';
        if (elDodge) elDodge.innerText = this.dodgeCount;
        if (elSyn) elSyn.innerText = this.brain.synapseCount.toLocaleString();
        if (elAlt) elAlt.innerText = this.flyPos.y.toFixed(1) + 'm';
        if (elPitch) elPitch.innerText = THREE.MathUtils.radToDeg(this.flyPitch).toFixed(0) + '°';

        // Eye Sensor Bars
        for (let i = 0; i < this.numRays; i++) {
            const barL = document.getElementById(`sbarL_${i}`);
            const barR = document.getElementById(`sbarR_${i}`);
            if (barL) {
                const hL = Math.max(10, Math.floor(this.leftRaySignals[i] * 100));
                barL.style.height = `${hL}%`;
                barL.style.backgroundColor = this.leftRaySignals[i] > 0.5 ? 'var(--danger-red)' : 'var(--accent-magenta)';
            }
            if (barR) {
                const hR = Math.max(10, Math.floor(this.rightRaySignals[i] * 100));
                barR.style.height = `${hR}%`;
                barR.style.backgroundColor = this.rightRaySignals[i] > 0.5 ? 'var(--danger-red)' : 'var(--accent-cyan)';
            }
        }

        // Wing Power Gauges
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
                    modeLabel.innerText = this.isAutoPilot ? 'Connectome Auto-Pilot (3D Drosophila Matrix)' : 'Manual Flight Controls (WASD / Arrows / Q-E Pitch)';
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

        const camBtns = document.querySelectorAll('.cam-btn');
        camBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                camBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeCamMode = btn.dataset.cam;
            });
        });

        const btnSpawn = document.getElementById('btnSpawnObstacle');
        if (btnSpawn) {
            btnSpawn.addEventListener('click', () => {
                const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
                const spawnPos = this.flyPos.clone().add(forwardDir.multiplyScalar(10.0));
                
                // Spawn obstacle at the fruit fly's current altitude to ensure collision/dodging
                const randType = Math.random();
                if (randType < 0.4) {
                    // Full height pillar blocking all altitudes
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
                    // Ground sphere at current fly level
                    this.createObstacle({
                        type: 'sphere',
                        x: spawnPos.x,
                        z: spawnPos.z,
                        y: Math.max(2.2, this.flyPos.y),
                        radius: 2.5,
                        color: 0xff0055
                    });
                } else {
                    // Suspended gate
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
                // Spawn a full height pillar or ground sphere at clicked location
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
