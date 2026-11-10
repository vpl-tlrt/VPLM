// Inside your animation/render loop in js/simulation.js
if (fingerTargetPos) {
    const deltaX = fingerTargetPos.x - playerPhysics.position.x;
    const deltaY = fingerTargetPos.y - playerPhysics.position.y;
    const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Dead-zone threshold stops physics calculation when finger is directly on the car center
    if (totalDistance > 1.8) {
        let computedAngle = Math.atan2(deltaX, -deltaY);
        let orientationDelta = computedAngle - playerPhysics.angle;

        // Keep internal angles bound between -PI and +PI
        while (orientationDelta < -Math.PI) orientationDelta += Math.PI * 2;
        while (orientationDelta > Math.PI) orientationDelta -= Math.PI * 2;

        // Turn calculation matching realistic wheel limits
        let turningVelocity = 0.048;
        Matter.Body.setAngle(playerPhysics, playerPhysics.angle + Math.sign(orientationDelta) * Math.min(turningVelocity, Math.abs(orientationDelta)));

        // Linear traction acceleration forward vector
        let tractionForce = 0.0075;
        let driveVector = {
            x: Math.sin(playerPhysics.angle) * tractionForce,
            y: -Math.cos(playerPhysics.angle) * tractionForce
        };
        Matter.Body.applyForce(playerPhysics, playerPhysics.position, driveVector);
    }
}
