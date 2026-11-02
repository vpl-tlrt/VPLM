# Cinematic Ask VPLM AI transformation — implementation specification

## Objective
Replace the primitive-box WebGL mascot with a cinematic orange Supra-inspired car-to-robot companion matching the supplied visual reference. Keep the launcher free-floating and preserve existing AI chat, parking operations, roles, and data flows.

## Open-source research
- Three.js (MIT): rendering, GLTFLoader, AnimationMixer, PBR materials, lighting.
- `manuelhintermayr/three-js-car-example` (MIT code; asset notices separate): lighting, reflection, GLB rendering reference. Its included Ford Anglia is not a Supra or transformer.
- `nbogie/three-js-cars-2` (MIT code, CC BY 4.0 GLB models): sample model workflows, attribution required for assets.
- `KanadeK/robot-expressive-codex-pet` (MIT code; upstream CC0 RobotExpressive model): robot animation reference, not a car-to-robot rig.
- Blender (free/open-source): author and rig custom car/robot GLB with linked mechanical panels.

No identified repository provides a verified, ready-to-use, cinematic Supra-to-robot asset. Do not imply otherwise.

## Delivery gates
1. Model curved orange sports-car body, glass, headlights, wheel geometry, panel seams, robot skeleton, and mechanically plausible connections. Respect third-party model licensing.
2. Rig linked panels, wheels, arms, torso, legs, and head; export reversible named GLB animation clips for car-to-robot and robot-to-car. Do not substitute box interpolation.
3. Render through Three.js with physically based materials, responsive lighting, transparent canvas and no visible launcher container. Click/tap must open the existing Ask VPLM AI interface.
4. Test animation forward/reverse, Android touch and performance, WebGL fallback, reduced-motion preference, keyboard accessibility and page navigation.
5. Run application typecheck/build and visual comparison with the reference on mobile and desktop. Publish to `main` only when actual quality meets requirements; verify GitHub Pages successful deployment.

## Scope protection
Changes should be isolated to the AI companion and its assets. Do not change parking bays, vehicle assignments, Supabase, admin roles, user management, or chat commands.

## Status
Research and isolated feature branch only. No replacement 3D model, successful visual QA, or publication yet.
