/**
 * Procedural 3D Fruit Fly (Drosophila) Model & Wing Flap Kinematics for Three.js
 */

class FruitFlyModel {
    constructor() {
        this.group = new THREE.Group();
        this.wingFlapTime = 0;

        // Wing pivots for independent differential flapping
        this.leftWingPivot = new THREE.Group();
        this.rightWingPivot = new THREE.Group();

        // Left Eye and Right Eye 3D anchor points for raycasting & visualizer
        this.leftEyePos = new THREE.Vector3();
        this.rightEyePos = new THREE.Vector3();

        this._buildFlyMesh();
    }

    _buildFlyMesh() {
        // --- 1. Materials ---
        // Compound Eye Material (Glossy Ruby Red)
        const eyeMaterial = new THREE.MeshPhongMaterial({
            color: 0xd62828,
            emissive: 0x500000,
            shininess: 90,
            specular: 0xff6b6b
        });

        // Thorax Material (Dark Metallic Golden Brown)
        const thoraxMaterial = new THREE.MeshStandardMaterial({
            color: 0x3d2817,
            roughness: 0.4,
            metalness: 0.3
        });

        // Abdomen Material (Striped Tan & Black)
        const abdomenMaterial = new THREE.MeshStandardMaterial({
            color: 0x8c6239,
            roughness: 0.6,
            metalness: 0.1
        });

        // Wing Material (Translucent Iridescent Cyan/Silver)
        const wingMaterial = new THREE.MeshPhongMaterial({
            color: 0x88eeff,
            emissive: 0x002233,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            shininess: 100,
            specular: 0xffffff
        });

        // --- 2. Thorax (Body Center) ---
        const thoraxGeo = new THREE.SphereGeometry(0.5, 16, 16);
        thoraxGeo.scale(1.0, 0.8, 1.2);
        const thorax = new THREE.Mesh(thoraxGeo, thoraxMaterial);
        thorax.castShadow = true;
        this.group.add(thorax);

        // --- 3. Head & Compound Eyes ---
        const headGeo = new THREE.SphereGeometry(0.35, 16, 16);
        headGeo.scale(1.1, 0.9, 0.9);
        const head = new THREE.Mesh(headGeo, thoraxMaterial);
        head.position.set(0, 0.05, 0.65);
        head.castShadow = true;
        this.group.add(head);

        // Left Eye (Red Sphere)
        const eyeGeo = new THREE.SphereGeometry(0.18, 12, 12);
        eyeGeo.scale(1.0, 1.2, 1.1);

        const leftEye = new THREE.Mesh(eyeGeo, eyeMaterial);
        leftEye.position.set(-0.25, 0.1, 0.7);
        leftEye.rotation.y = -0.4;
        this.group.add(leftEye);
        this.leftEyeMesh = leftEye;

        // Right Eye (Red Sphere)
        const rightEye = new THREE.Mesh(eyeGeo, eyeMaterial);
        rightEye.position.set(0.25, 0.1, 0.7);
        rightEye.rotation.y = 0.4;
        this.group.add(rightEye);
        this.rightEyeMesh = rightEye;

        // Antennae
        const antGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6);
        const leftAnt = new THREE.Mesh(antGeo, thoraxMaterial);
        leftAnt.position.set(-0.1, 0.22, 0.9);
        leftAnt.rotation.set(-0.4, 0.2, -0.3);
        this.group.add(leftAnt);

        const rightAnt = new THREE.Mesh(antGeo, thoraxMaterial);
        rightAnt.position.set(0.1, 0.22, 0.9);
        rightAnt.rotation.set(-0.4, -0.2, 0.3);
        this.group.add(rightAnt);

        // --- 4. Abdomen ---
        const abdomenGeo = new THREE.ConeGeometry(0.48, 1.3, 16);
        abdomenGeo.rotateX(-Math.PI / 2);
        const abdomen = new THREE.Mesh(abdomenGeo, abdomenMaterial);
        abdomen.position.set(0, -0.1, -1.0);
        abdomen.scale.set(1.0, 0.85, 1.0);
        abdomen.castShadow = true;
        this.group.add(abdomen);

        // Abdomen Stripes (Rings)
        for (let i = 0; i < 4; i++) {
            const ringGeo = new THREE.TorusGeometry(0.4 - i * 0.07, 0.03, 8, 16);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0x1a1109 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            ring.position.set(0, -0.08, -0.5 - i * 0.22);
            this.group.add(ring);
        }

        // --- 5. Legs (6 bio legs) ---
        const legMat = new THREE.MeshStandardMaterial({ color: 0x22160d });
        const legOffsets = [
            { x: -0.4, z: 0.3, rotZ: 0.8, rotY: 0.3 },
            { x: 0.4, z: 0.3, rotZ: -0.8, rotY: -0.3 },
            { x: -0.45, z: 0.0, rotZ: 0.9, rotY: 0.0 },
            { x: 0.45, z: 0.0, rotZ: -0.9, rotY: 0.0 },
            { x: -0.4, z: -0.3, rotZ: 0.8, rotY: -0.3 },
            { x: 0.4, z: -0.3, rotZ: -0.8, rotY: 0.3 }
        ];

        legOffsets.forEach(cfg => {
            const legSeg1 = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6);
            const legMesh = new THREE.Mesh(legSeg1, legMat);
            legMesh.position.set(cfg.x, -0.3, cfg.z);
            legMesh.rotation.z = cfg.rotZ;
            legMesh.rotation.y = cfg.rotY;
            this.group.add(legMesh);
        });

        // --- 6. Articulated Left Wing & Right Wing ---
        // Create Left Wing Shape
        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0);
        wingShape.bezierCurveTo(-0.6, 0.4, -1.2, 1.2, -0.8, 1.8);
        wingShape.bezierCurveTo(-0.4, 2.2, 0.2, 2.0, 0.4, 1.4);
        wingShape.bezierCurveTo(0.5, 0.8, 0.3, 0.3, 0, 0);

        const wingGeo = new THREE.ShapeGeometry(wingShape);
        wingGeo.rotateX(-Math.PI / 2);
        wingGeo.scale(0.7, 0.7, 0.7);

        // Left Wing Assembly
        const leftWingMesh = new THREE.Mesh(wingGeo, wingMaterial);
        leftWingMesh.position.set(0, 0, 0);
        this.leftWingPivot.add(leftWingMesh);
        this.leftWingPivot.position.set(-0.3, 0.3, 0.1);
        this.group.add(this.leftWingPivot);

        // Right Wing Assembly (Mirror shape)
        const rightWingShape = new THREE.Shape();
        rightWingShape.moveTo(0, 0);
        rightWingShape.bezierCurveTo(0.6, 0.4, 1.2, 1.2, 0.8, 1.8);
        rightWingShape.bezierCurveTo(0.4, 2.2, -0.2, 2.0, -0.4, 1.4);
        rightWingShape.bezierCurveTo(-0.5, 0.8, -0.3, 0.3, 0, 0);

        const rightWingGeo = new THREE.ShapeGeometry(rightWingShape);
        rightWingGeo.rotateX(-Math.PI / 2);
        rightWingGeo.scale(0.7, 0.7, 0.7);

        const rightWingMesh = new THREE.Mesh(rightWingGeo, wingMaterial);
        rightWingMesh.position.set(0, 0, 0);
        this.rightWingPivot.add(rightWingMesh);
        this.rightWingPivot.position.set(0.3, 0.3, 0.1);
        this.group.add(this.rightWingPivot);

        // Scale total fly model to nice visible units
        this.group.scale.set(0.8, 0.8, 0.8);
    }

    /**
     * Updates wing flapping animation based on left and right wing motor power.
     * @param {number} delta Time step in seconds
     * @param {number} pLeft Left wing power (0.0 to 1.5+)
     * @param {number} pRight Right wing power (0.0 to 1.5+)
     */
    updateWings(delta, pLeft = 1.0, pRight = 1.0) {
        this.wingFlapTime += delta * 45; // Base high-frequency flap

        // Base frequency scaled by power
        const freqL = 0.8 + pLeft * 1.2;
        const freqR = 0.8 + pRight * 1.2;

        const ampL = 0.3 + Math.min(0.6, pLeft * 0.4);
        const ampR = 0.3 + Math.min(0.6, pRight * 0.4);

        // Flap rotation on Z axis (up-and-down roll) & Y axis (stroke angle)
        const leftAngleZ = Math.sin(this.wingFlapTime * freqL) * ampL;
        const rightAngleZ = -Math.sin(this.wingFlapTime * freqR) * ampR;

        const leftAngleY = Math.cos(this.wingFlapTime * freqL) * (ampL * 0.4) - 0.2;
        const rightAngleY = -Math.cos(this.wingFlapTime * freqR) * (ampR * 0.4) + 0.2;

        this.leftWingPivot.rotation.z = leftAngleZ;
        this.leftWingPivot.rotation.y = leftAngleY;

        this.rightWingPivot.rotation.z = rightAngleZ;
        this.rightWingPivot.rotation.y = rightAngleY;

        // Body dynamic roll and pitch tilting from wing power imbalance
        const powerDiff = pRight - pLeft; // Positive -> turn left, roll left
        this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, powerDiff * 0.35, 0.1);
        
        const totalPower = (pLeft + pRight) * 0.5;
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, (totalPower - 1.0) * -0.15, 0.1);
    }

    getLeftEyeWorldPosition() {
        this.leftEyeMesh.getWorldPosition(this.leftEyePos);
        return this.leftEyePos;
    }

    getRightEyeWorldPosition() {
        this.rightEyeMesh.getWorldPosition(this.rightEyePos);
        return this.rightEyePos;
    }
}
