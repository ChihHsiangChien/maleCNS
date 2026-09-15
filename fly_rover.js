/**
 * 3D Fruit Fly Autonomous Rover Simulation Controller (Three.js)
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

        // Lighting
        this._setupLighting();

        // Environment & Obstacles
        this.obstacles = [];
        this._buildArena();
        this._spawnDefaultObstacles();

        // Fruit Fly Agent & Brain
        this.flyModel = new FruitFlyModel();
        this.scene.add(this.flyModel.group);
        this.brain = new RoverConnectomeBrain(16); // 16 rays left, 16 rays right

        // Physics & Kinematics State
        this.flyPos = new THREE.Vector3(0, 2.5, 0);
        this.flyYaw = 0.0;
        this.flySpeed = 0.0;
        this.isAutoPilot = true;
        this.dodgeCount = 0;
        this.flightDistance = 0.0;
        this.lastPos = this.flyPos.clone();

        // Raycasting & Sensors
        this.raycaster = new THREE.Raycaster();
        this.numRays = 16;
        this.maxRayDist = 18.0;
        this.leftRaySignals = new Float32Array(this.numRays);
        this.rightRaySignals = new Float32Array(this.numRays);

        // Visual Ray Line Helpers
        this._setupRayLineHelpers();

        // Oscilloscope History Buffer
        this.oscilloscopeCanvas = document.getElementById('oscilloscopeCanvas');
        this.oscCtx = this.oscilloscopeCanvas ? this.oscilloscopeCanvas.getContext('2d') : null;
        this.historyLength = 120;
        this.historyLeftWing = new Array(this.historyLength).fill(1.0);
        this.historyRightWing = new Array(this.historyLength).fill(1.0);

        // Manual Controls Key State
        this.keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, s: false, a: false, d: false };

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

        // Bright Yellow Primary Grid Helper on Top for Maximum Motion Contrast
        const gridHelper = new THREE.GridHelper(arenaRadius * 2, 45, 0xffb703, 0x00f2fe);
        gridHelper.position.y = 0.02;
        this.scene.add(gridHelper);

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

        // 3D Physical Outer Perimeter Wall Enclosure Mesh
        const wallHeight = 8.0;
        const wallRadius = arenaRadius - 1.0;
        const cylGeo = new THREE.CylinderGeometry(wallRadius, wallRadius, wallHeight, 64, 1, true);
        const cylMat = new THREE.MeshStandardMaterial({
            color: 0xf72585,
            emissive: 0xf72585,
            emissiveIntensity: 0.4,
            transparent: true,
            opacity: 0.45,
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
        });
        this.obstacles = [];
    }

    _spawnDefaultObstacles(type = 'maze') {
        this._clearObstacles();

        if (type === 'maze') {
            // 🏰 Planar Maze Labyrinth Layout (平面迷宮)
            const mazeWalls = [
                // Outer Perimeter Boundary Walls
                { type: 'wall', x: 0, z: -35, w: 70, h: 6, d: 2, color: 0x00f2fe },
                { type: 'wall', x: 0, z: 35, w: 70, h: 6, d: 2, color: 0x00f2fe },
                { type: 'wall', x: -35, z: 0, w: 2, h: 6, d: 70, color: 0x00f2fe },
                { type: 'wall', x: 35, z: 0, w: 2, h: 6, d: 70, color: 0x00f2fe },

                // Inner Maze Partition Walls & Corridor Turnings
                { type: 'wall', x: -16, z: -18, w: 26, h: 6, d: 2, color: 0xf72585 },
                { type: 'wall', x: 16, z: -18, w: 26, h: 6, d: 2, color: 0xf72585 },
                { type: 'wall', x: -16, z: 18, w: 26, h: 6, d: 2, color: 0xffb703 },
                { type: 'wall', x: 16, z: 18, w: 26, h: 6, d: 2, color: 0xffb703 },

                // Center Divider Passages
                { type: 'wall', x: 0, z: -8, w: 2, h: 6, d: 18, color: 0x4cc9f0 },
                { type: 'wall', x: 0, z: 8, w: 2, h: 6, d: 18, color: 0x4cc9f0 },
                { type: 'wall', x: -12, z: 0, w: 16, h: 6, d: 2, color: 0x00f2fe },
                { type: 'wall', x: 12, z: 0, w: 16, h: 6, d: 2, color: 0x00f2fe },

                // Sentinel Moving Hazards patrolling maze corridors
                { type: 'moving', x: -8, z: -25, radius: 2.2, color: 0xff0055, speed: 1.2 },
                { type: 'moving', x: 8, z: 25, radius: 2.2, color: 0x4cc9f0, speed: -1.2 },
                { type: 'moving', x: -25, z: 8, radius: 2.0, color: 0xffb703, speed: 1.0 },
                { type: 'moving', x: 25, z: -8, radius: 2.0, color: 0xf72585, speed: -1.0 }
            ];

            mazeWalls.forEach(cfg => this.createObstacle(cfg));
        } else if (type === 'corridor') {
            // 🛣️ Dual Straight Corridors
            const corridorWalls = [
                { type: 'wall', x: -10, z: 0, w: 2, h: 6, d: 60, color: 0x00f2fe },
                { type: 'wall', x: 10, z: 0, w: 2, h: 6, d: 60, color: 0x00f2fe },
                { type: 'sphere', x: 0, z: 18, radius: 2.2, color: 0xff0055 },
                { type: 'sphere', x: 0, z: -18, radius: 2.2, color: 0xffb703 },
                { type: 'moving', x: 0, z: 0, radius: 2.5, color: 0xf72585, speed: 1.5 }
            ];
            corridorWalls.forEach(cfg => this.createObstacle(cfg));
        } else {
            // 🔮 Scattered Arena Layout
            const scatteredObs = [
                { type: 'sphere', x: 0, z: 15, radius: 2.2, color: 0xff0055 },
                { type: 'pillar', x: -12, z: 10, radius: 1.8, color: 0x00f2fe },
                { type: 'pillar', x: 14, z: 8, radius: 2.0, color: 0xf72585 },
                { type: 'moving', x: -8, z: -14, radius: 2.5, color: 0xffb703, speed: 0.8 },
                { type: 'moving', x: 10, z: -18, radius: 2.2, color: 0x4cc9f0, speed: -1.0 },
                { type: 'sphere', x: -18, z: 2, radius: 2.0, color: 0xff0055 },
                { type: 'sphere', x: 18, z: -4, radius: 1.9, color: 0x00f2fe },
                { type: 'pillar', x: 0, z: -25, radius: 2.5, color: 0xf72585 }
            ];
            scatteredObs.forEach(cfg => this.createObstacle(cfg));
        }
    }

    createObstacle(cfg) {
        let geo, mat;
        const color = cfg.color || 0x00f2fe;

        if (cfg.type === 'wall') {
            geo = new THREE.BoxGeometry(cfg.w || 2, cfg.h || 6, cfg.d || 2);
            mat = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.35,
                roughness: 0.2,
                metalness: 0.8
            });
        } else if (cfg.type === 'pillar') {
            geo = new THREE.CylinderGeometry(cfg.radius, cfg.radius, 10, 16);
            mat = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.3,
                roughness: 0.3,
                metalness: 0.7
            });
        } else {
            geo = new THREE.SphereGeometry(cfg.radius || 2.0, 20, 20);
            mat = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.4,
                roughness: 0.2,
                metalness: 0.5
            });
        }

        const mesh = new THREE.Mesh(geo, mat);
        let yPos = cfg.type === 'pillar' ? 5 : (cfg.type === 'wall' ? (cfg.h || 6) / 2 : (cfg.radius || 2.0) + 0.5);
        mesh.position.set(cfg.x, yPos, cfg.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        this.scene.add(mesh);

        const obsObj = {
            mesh: mesh,
            radius: cfg.radius || Math.max(cfg.w || 2, cfg.d || 2) * 0.5,
            type: cfg.type,
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

        const leftMat = new THREE.LineBasicMaterial({ color: 0xf72585, transparent: true, opacity: 0.6 });
        const rightMat = new THREE.LineBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.6 });

        for (let i = 0; i < this.numRays; i++) {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 5)]);

            const lineL = new THREE.Line(geo.clone(), leftMat.clone());
            this.rayLinesGroup.add(lineL);
            this.leftRayLines.push(lineL);

            const lineR = new THREE.Line(geo.clone(), rightMat.clone());
            this.rayLinesGroup.add(lineR);
            this.rightRayLines.push(lineR);
        }
    }

    _castEyeRays() {
        const leftEyePos = this.flyModel.getLeftEyeWorldPosition();
        const rightEyePos = this.flyModel.getRightEyeWorldPosition();
        const obstacleMeshes = this.obstacles.map(o => o.mesh);
        if (this.outerWallMesh) obstacleMeshes.push(this.outerWallMesh);

        const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);

        // 1. Left Eye Sector Rays (-90° to 0° azimuth, covering dead-center)
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const angle = THREE.MathUtils.degToRad(-90 + frac * 90); // -90 deg to 0 deg
            const rayDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).normalize();

            this.raycaster.set(leftEyePos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes);

            let hitDist = this.maxRayDist;
            if (hits.length > 0) {
                hitDist = hits[0].distance;
            }

            // Signal strength: 0.0 (clear) to 1.0 (immediate collision threat)
            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.leftRaySignals[i] = threatVal;

            // Update Visual Ray Line
            const lineEnd = leftEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const positions = new Float32Array([leftEyePos.x, leftEyePos.y, leftEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.leftRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            this.leftRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.leftRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }

        // 2. Right Eye Sector Rays (0° to +90° azimuth, covering dead-center)
        for (let i = 0; i < this.numRays; i++) {
            const frac = i / (this.numRays - 1);
            const angle = THREE.MathUtils.degToRad(0 + frac * 90); // 0 deg to +90 deg
            const rayDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).normalize();

            this.raycaster.set(rightEyePos, rayDir);
            const hits = this.raycaster.intersectObjects(obstacleMeshes);

            let hitDist = this.maxRayDist;
            if (hits.length > 0) {
                hitDist = hits[0].distance;
            }

            const threatVal = Math.max(0, 1.0 - (hitDist / this.maxRayDist));
            this.rightRaySignals[i] = threatVal;

            // Update Visual Ray Line
            const lineEnd = rightEyePos.clone().add(rayDir.clone().multiplyScalar(Math.min(hitDist, this.maxRayDist)));
            const positions = new Float32Array([rightEyePos.x, rightEyePos.y, rightEyePos.z, lineEnd.x, lineEnd.y, lineEnd.z]);
            this.rightRayLines[i].geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            this.rightRayLines[i].geometry.attributes.position.needsUpdate = true;
            this.rightRayLines[i].material.opacity = threatVal > 0.1 ? 0.9 : 0.15;
        }
    }

    _updateObstacles(delta) {
        this.obstacles.forEach(obs => {
            if (obs.type === 'moving') {
                obs.moveTime += delta * obs.speed;
                obs.mesh.position.x = obs.initialX + Math.sin(obs.moveTime) * 12;
            }
        });
    }

    _updatePhysics(delta) {
        this._updateObstacles(delta);
        this._castEyeRays();

        let wLeft = 1.0;
        let wRight = 1.0;

        if (this.isAutoPilot) {
            // Run Connectome Neural Matrix Engine
            const res = this.brain.update(this.leftRaySignals, this.rightRaySignals);
            wLeft = res.wingPowerLeft;
            wRight = res.wingPowerRight;
        } else {
            // Manual Arrow/WASD key drive
            if (this.keys.ArrowLeft || this.keys.a) wLeft = 0.3, wRight = 2.0;
            if (this.keys.ArrowRight || this.keys.d) wLeft = 2.0, wRight = 0.3;
            if (this.keys.ArrowUp || this.keys.w) wLeft = 1.8, wRight = 1.8;
            if (this.keys.ArrowDown || this.keys.s) wLeft = 0.4, wRight = 0.4;
        }

        // Kinematics calculations:
        // Differential Thrust Forward Speed: v ∝ (wLeft + wRight)
        // Differential Yaw Turn Angular Velocity: ω ∝ (wRight - wLeft)
        const forwardThrust = (wLeft + wRight) * 0.5 * 12.0;
        const turnRate = (wRight - wLeft) * 2.8;

        this.flyYaw += turnRate * delta;

        const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
        this.flyPos.add(forwardDir.multiplyScalar(forwardThrust * delta));

        // 1. Strict Outer Perimeter Wall Collision Containment (Radius = 42)
        const maxRadius = 42.0;
        const currentRadius = Math.hypot(this.flyPos.x, this.flyPos.z);
        if (currentRadius > maxRadius) {
            // Hard clamp fly position strictly inside wall boundary
            const angle = Math.atan2(this.flyPos.z, this.flyPos.x);
            this.flyPos.x = Math.cos(angle) * maxRadius;
            this.flyPos.z = Math.sin(angle) * maxRadius;

            // Reflect yaw angle back toward inward arena center
            const inwardAngle = Math.atan2(-this.flyPos.x, -this.flyPos.z);
            this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, inwardAngle, 0.4);
        }

        // 2. Strict Inner Maze Wall AABB Collision Containment
        this.obstacles.forEach(obs => {
            if (obs.type === 'wall' && obs.mesh && obs.mesh.geometry.parameters) {
                const wHalf = (obs.mesh.geometry.parameters.width || 2) * 0.5 + 1.2;
                const dHalf = (obs.mesh.geometry.parameters.depth || 2) * 0.5 + 1.2;
                const dx = this.flyPos.x - obs.mesh.position.x;
                const dz = this.flyPos.z - obs.mesh.position.z;

                if (Math.abs(dx) < wHalf && Math.abs(dz) < dHalf) {
                    const overlapX = wHalf - Math.abs(dx);
                    const overlapZ = dHalf - Math.abs(dz);
                    if (overlapX < overlapZ) {
                        this.flyPos.x += dx > 0 ? overlapX : -overlapX;
                    } else {
                        this.flyPos.z += dz > 0 ? overlapZ : -overlapZ;
                    }
                }
            }
        });

        // 3. Strict Sphere, Pillar & Moving Hazard Physical Collision Push-Back
        this.obstacles.forEach(obs => {
            if (obs.mesh && obs.type !== 'wall') {
                const obsX = obs.mesh.position.x;
                const obsZ = obs.mesh.position.z;
                const minDist = (obs.radius || 2.0) + 1.2; // obstacle radius + fly body collision radius
                const dx = this.flyPos.x - obsX;
                const dz = this.flyPos.z - obsZ;
                const dist = Math.hypot(dx, dz);

                if (dist < minDist && dist > 0.0001) {
                    const overlap = minDist - dist;
                    this.flyPos.x += (dx / dist) * overlap;
                    this.flyPos.z += (dz / dist) * overlap;

                    // Steer yaw away from collision center
                    const avoidAngle = Math.atan2(dz, dx);
                    this.flyYaw = THREE.MathUtils.lerp(this.flyYaw, avoidAngle, 0.35);
                }
            }
        });

        // Apply transformations to 3D Fly Mesh & Ground Target Shadow Ring
        this.flyModel.group.position.copy(this.flyPos);
        this.flyModel.group.rotation.y = this.flyYaw;
        if (this.groundShadowRing) {
            this.groundShadowRing.position.set(this.flyPos.x, 0.08, this.flyPos.z);
            this.groundShadowRing.rotation.y = this.flyYaw;
        }

        // Animate articulated wings
        this.flyModel.updateWings(delta, wLeft, wRight);

        // Update Stats
        const moveDist = this.flyPos.distanceTo(this.lastPos);
        this.flightDistance += moveDist;
        this.lastPos.copy(this.flyPos);

        // Check Dodge Event (High threat evasion)
        if (this.brain.v_left_eye > 0.4 || this.brain.v_right_eye > 0.4) {
            this.dodgeCount++;
        }

        // Update Oscilloscope History
        this.historyLeftWing.push(wLeft);
        this.historyLeftWing.shift();
        this.historyRightWing.push(wRight);
        this.historyRightWing.shift();

        // Update Camera
        this._updateCamera();

        // Update HUD DOM
        this._updateHUD(wLeft, wRight, forwardThrust);
    }

    _updateCamera() {
        if (this.activeCamMode === 'follow') {
            const offset = new THREE.Vector3(0, 4.5, -9.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
            const targetCamPos = this.flyPos.clone().add(offset);
            this.camera.position.lerp(targetCamPos, 0.1);
            this.camera.lookAt(this.flyPos.clone().add(new THREE.Vector3(0, 1.2, 3.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw)));
        } else if (this.activeCamMode === 'cockpit') {
            const eyeOffset = new THREE.Vector3(0, 0.4, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
            this.camera.position.copy(this.flyPos.clone().add(eyeOffset));
            const lookTarget = this.flyPos.clone().add(new THREE.Vector3(0, 0.4, 15.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw));
            this.camera.lookAt(lookTarget);
        } else if (this.activeCamMode === 'top') {
            this.camera.position.set(this.flyPos.x, 35, this.flyPos.z + 0.1);
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

        if (elSpeed) elSpeed.innerText = speed.toFixed(1);
        if (elDist) elDist.innerText = Math.floor(this.flightDistance) + 'm';
        if (elDodge) elDodge.innerText = this.dodgeCount;
        if (elSyn) elSyn.innerText = this.brain.synapseCount.toLocaleString();

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

        // Draw Oscilloscope Waveforms
        this._drawOscilloscope();
    }

    _drawOscilloscope() {
        if (!this.oscCtx) return;
        const ctx = this.oscCtx;
        const w = this.oscilloscopeCanvas.width;
        const h = this.oscilloscopeCanvas.height;

        ctx.fillStyle = '#04080f';
        ctx.fillRect(0, 0, w, h);

        // Center baseline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Left Wing Waveform (Magenta)
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

        // Right Wing Waveform (Cyan)
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
        // Auto-Pilot Toggle
        const toggle = document.getElementById('autoPilotToggle');
        const modeLabel = document.getElementById('modeLabel');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                this.isAutoPilot = e.target.checked;
                if (modeLabel) {
                    modeLabel.innerText = this.isAutoPilot ? 'Connectome Auto-Pilot (Drosophila Matrix)' : 'Manual Flight Controls (WASD / Arrows)';
                    modeLabel.style.color = this.isAutoPilot ? 'var(--accent-cyan)' : 'var(--accent-gold)';
                }
            });
        }

        // Maze Selector Dropdown
        const mazeSelect = document.getElementById('mazeSelect');
        if (mazeSelect) {
            mazeSelect.addEventListener('change', (e) => {
                this._spawnDefaultObstacles(e.target.value);
                this.flyPos.set(0, 2.5, 0);
                this.flyYaw = 0;
            });
        }

        // Camera Switchers
        const camBtns = document.querySelectorAll('.cam-btn');
        camBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                camBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeCamMode = btn.dataset.cam;
            });
        });

        // Spawn Obstacle Button
        const btnSpawn = document.getElementById('btnSpawnObstacle');
        if (btnSpawn) {
            btnSpawn.addEventListener('click', () => {
                const forwardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.flyYaw);
                const spawnPos = this.flyPos.clone().add(forwardDir.multiplyScalar(10.0));
                this.createObstacle({
                    type: Math.random() > 0.5 ? 'sphere' : 'pillar',
                    x: spawnPos.x,
                    z: spawnPos.z,
                    radius: 1.8 + Math.random() * 0.8,
                    color: 0xff0055
                });
            });
        }

        // Reset Fly Position Button
        const btnReset = document.getElementById('btnResetFly');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.flyPos.set(0, 2.5, 0);
                this.flyYaw = 0;
            });
        }

        // Mouse click in 3D canvas to drop obstacle
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
                this.createObstacle({
                    type: 'sphere',
                    x: pt.x,
                    z: pt.z,
                    radius: 2.0,
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
