// js/main.js
import { scrapeDashboardLayout } from './scraper.js';
import { initPhysicsSimulation } from './simulation.js';

let gearTapCount = 0;
let clearTapTimer;

const triggerElement = document.getElementById('hidden-trigger');

triggerElement.addEventListener('click', () => {
    gearTapCount++;
    clearTimeout(clearTapTimer);
    
    // Reset tap window if the user takes longer than 800ms
    clearTapTimer = setTimeout(() => { gearTapCount = 0; }, 800);

    if (gearTapCount === 3) {
        switchTo3DMode();
        gearTapCount = 0;
    }
});

function switchTo3DMode() {
    document.getElementById('dashboard-view').style.opacity = '0';
    const container3D = document.getElementById('canvas3d-container');
    container3D.style.display = 'block';
    
    setTimeout(() => { container3D.style.opacity = '1'; }, 50);

    // Bootstrap engine only on first initiation to conserve mobile memory
    if (!container3D.querySelector('canvas')) {
        const layoutData = scrapeDashboardLayout();
        initPhysicsSimulation(layoutData);
    }
}
