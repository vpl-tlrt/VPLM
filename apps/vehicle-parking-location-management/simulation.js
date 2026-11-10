// js/simulation.js

export function initPhysicsSimulation(scrapedSlots) {
    const container3d = document.getElementById('canvas3d-container');
    let viewW = window.innerWidth;
    let viewH = window.innerHeight;

    // Matter.js engine abstractions
    const Engine = Matter.Engine,
          Bodies = Matter.Bodies,
          Composite = Matter.Composite,
          Body = Matter.Body;

    const physicsEngine = Engine.create({ gravity: { x: 0, y: 0 } });

    // Three.js scene creation pipeline
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040a09);
    scene.fog = new THREE.FogExp2(0x040a09, 0.02);

    const camera = new THREE.PerspectiveCamera(55, viewW / viewH, 0.1, 1000);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewW, viewH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container3d.appendChild(renderer.domElement);

    // Environment Lighting configurations
    const ambient = new THREE.AmbientLight(0x102a25, 2.5);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0x00ffcc, 1.5);
    directional.position.set(20, 40, 10);
    directional.castShadow = true;
    scene.add(directional);

    // Ground Plane Floor Mesh
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x050c0b, roughness: 0.85 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Parse slots to instantiate fixed obstacle bounds and matching colors 
    scrapedSlots.forEach(slot => {
        // Build the physical boundary boxes inside 3D environment space
        const bayGeo = new THREE.BoxGeometry(6.5, 0.05, 11);
        const bayMat = new THREE.MeshStandardMaterial({ color: slot.color, wireframe: true });
        const bayMesh = new THREE.Mesh(bayGeo, bayMat);
        bayMesh.position.set(slot.x, 0.02, slot.z);
        scene.add(bayMesh);

        // If the parsed state is occupied, anchor a static physical obstacle car chassis
        if (slot.isOccupied) {
            const obstacleObj = Bodies.rectangle(slot.x, slot.z, 5.5, 10, { isStatic: true });
            Composite.add(physicsEngine.world, obstacleObj);

            const obsGroup = new THREE.Group();
            const obsMesh = new THREE.Mesh(
                new THREE.BoxGeometry(2.2, 1.1, 4.6),
                new THREE.MeshStandardMaterial({ color: slot.color, roughness: 0.4 })
            );
            obsMesh.position.y = 0.55;
            obsGroup.add(obsMesh);
            obsGroup.position.set(slot.x, 0, slot.z);
            scene.add(obsGroup);
        }
    });

    // Instantiate User Playable Vehicle (The Main Controlled Active Chassis)
    const carWidth = 2.3, carLength = 4.7;
    const playerPhysics = Bodies.rectangle(0, 22, carWidth, carLength, {
        frictionAir: 0.09, // Provides realistic deceleration sliding curves
        density: 0.006
    });
    Composite.add(physicsEngine.world, playerPhysics);

    const userCarGroup = new THREE.Group();
    const mainBodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(carWidth, 1.1, carLength),
        new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.2, metalness: 0.3 })
    );
    mainBodyMesh.position.y = 0.55;
    mainBodyMesh.castShadow = true;
    userCarGroup.add(mainBodyMesh);

    // Windshield Cabin Layer details
    const cabinMesh = new THREE.Mesh(
        new THREE.BoxGeometry(carWidth * 0.8, 0.6, carLength * 0.45),
        new THREE.MeshStandardMaterial({ color: 0x040a09, roughness: 0.1 })
    );
    cabinMesh.position.set(0, 1.1, -0.2);
    userCarGroup.add(cabinMesh);
    scene.add(userCarGroup);

    // Target tracking mechanics variables
    let fingerTargetPos = null;
    let screenDragState = false;

    const raycaster = new THREE.Raycaster();
    const normalizedMouse = new THREE.Vector2();
    const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    function processInputCoordinates(event) {
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        normalizedMouse.x = (clientX / window.innerWidth) * 2 - 1;
        normalizedMouse.y = -(clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(normalizedMouse, camera);
        const rayIntersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(horizontalPlane, rayIntersection);

        fingerTargetPos = { x: rayIntersection.x, y: rayIntersection.z };
    }

    // Attach Unified Touch/Mouse Controls Event Listeners
    window.addEventListener('mousedown', (e) => { screenDragState = true; processInputCoordinates(e); });
    window.addEventListener('mousemove', (e) => { if(screenDragState) processInputCoordinates(e); });
    window.addEventListener('mouseup', () => { screenDragState = false; fingerTargetPos = null; });

    window.addEventListener('touchstart', (e) => { screenDragState = true; processInputCoordinates(e); }, { passive: false });
    window.addEventListener('touchmove', (e) => { if(screenDragState) processInputCoordinates(e); }, { passive: false });
    window.addEventListener('touchend', () => { screenDragState = false; fingerTargetPos = null; });

    // Main Runtime Loop (Steering Geometry & Frame Matrix Translation)
    function renderTick() {
        requestAnimationFrame(renderTick);
        Engine.update(physicsEngine);

        if (fingerTargetPos) {
            const deltaX = fingerTargetPos.x - playerPhysics.position.x;
            const deltaY = fingerTargetPos.y - playerPhysics.position.y;
            const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Distance dead-zone bounds logic blocks jitter shaking behavior when arriving at destination points
            if (totalDistance > 1.8) {
                let computedAngle = Math.atan2(deltaX, -deltaY);

                // Handle rotational angular differences cleanly
                let orientationDelta = computedAngle - playerPhysics.angle;
                while (orientationDelta < -Math.PI) orientationDelta += Math.PI * 2;
                while (orientationDelta > Math.PI) orientationDelta -= Math.PI * 2;

                // Ackermann-simulated steering radius geometry speeds
                let turningVelocity = 0.048;
                Body.setAngle(playerPhysics, playerPhysics.angle + Math.sign(orientationDelta) * Math.min(turningVelocity, Math.abs(orientationDelta)));

                // Continuous linear tracking force vector acceleration
                let tractionForce = 0.0075;
                let driveVector = {
                    x: Math.sin(playerPhysics.angle) * tractionForce,
                    y: -Math.cos(playerPhysics.angle) * tractionForce
                };
                Body.applyForce(playerPhysics, playerPhysics.position, driveVector);
            }
        }

        // Bridge computed rigid-body coordinates back into active Graphic transform matrices
        userCarGroup.position.set(playerPhysics.position.x, 0, playerPhysics.position.y);
        userCarGroup.rotation.y = -playerPhysics.angle;

        // Smooth Behind-The-Car Tracking Camera (Dr. Driving Style)
        camera.position.set(playerPhysics.position.x, playerPhysics.position.y + 32, playerPhysics.position.y + 22);
        camera.lookAt(playerPhysics.position.x, 0, playerPhysics.position.y);

        renderer.render(scene, camera);
    }

    renderTick();

    // Window Resize Handler Event Listener
    window.addEventListener('resize', () => {
        viewW = window.innerWidth;
        viewH = window.innerHeight;
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        renderer.setSize(viewW, viewH);
    });
}
