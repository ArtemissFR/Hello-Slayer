/* ===== VARIABLES GLOBALES ===== */
let scene, camera, renderer, player, swordGroup, swordMesh;
let enemies = [], buildings = [], bonuses = [], particles = [], shields = [];
let keys = {}, score = 0, wave = 1, gameActive = false, isPaused = false;
let playerHP = 100, lastTime = 0, yaw = 0, pitch = 0;
let velocityY = 0;

// Statistiques Evolutives
let playerLvl = 1, playerXP = 0, xpToNextLevel = 100;
let baseSpeed = 0.35;
let maxJumps = 2;
let jumpsRemaining = 2;

let isAttacking = false, attackTime = 0, attackType = 'none';
let longSwordActive = false, swordTimer = 0, shieldActive = false;

// Système Allié
let companion = null, companionProjectiles = [], lastCompanionShot = 0;

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a0a1a); 
    scene.fog = new THREE.FogExp2(0x1a0a1a, 0.012);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xff00ff, 1.2);
    light.position.set(10, 20, 10);
    scene.add(light);

    player = new THREE.Group();
    scene.add(player);

    createPlayer();
    createMap();
    setupControls();
    gameLoop(0);
}

function createPlayer() {
    // Matériaux
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x2d3b1e, metalness: 0.7, roughness: 0.2 }); // Vert armure
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfff0f5 }); // Blanc/Rose très clair
    const detailMat = new THREE.MeshStandardMaterial({ color: 0xff0000 }); // Rouge (Nœud)
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x000000 });

    // 1. CORPS (Armure massive)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.7), armorMat);
    torso.position.y = 0.8;
    player.add(torso);

    // 2. TÊTE DE CHAT DANS LE CASQUE
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.45;

    // Casque extérieur
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.75), armorMat);
    headGroup.add(helmet);

    // Visage (l'intérieur rose/blanc)
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.1), skinMat);
    face.position.z = 0.35;
    headGroup.add(face);

    // Oreilles de chat
    const earGeo = new THREE.ConeGeometry(0.15, 0.25, 4);
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(-0.25, 0.4, 0.1);
    headGroup.add(earL);
    const earR = new THREE.Mesh(earGeo, skinMat);
    earR.position.set(0.25, 0.4, 0.1);
    headGroup.add(earR);

    // Petit Nœud Rouge (emblématique)
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.1), detailMat);
    bow.position.set(0.25, 0.35, 0.4);
    headGroup.add(bow);

    player.add(headGroup);

    // 3. JAMBES ET BRAS (Aspect robotique/armure)
    const limbGeo = new THREE.BoxGeometry(0.25, 0.5, 0.25);
    
    // Bras
    const armL = new THREE.Mesh(limbGeo, armorMat); armL.position.set(-0.55, 0.8, 0); player.add(armL);
    const armR = new THREE.Mesh(limbGeo, armorMat); armR.position.set(0.55, 0.8, 0); player.add(armR);
    
    // Jambes
    const legL = new THREE.Mesh(limbGeo, armorMat); legL.position.set(-0.25, 0.25, 0); player.add(legL);
    const legR = new THREE.Mesh(limbGeo, armorMat); legR.position.set(0.25, 0.25, 0); player.add(legR);

    // 4. ÉPÉE (Réparée pour l'agrandissement)
    swordGroup = new THREE.Group(); 
    swordGroup.position.set(0.6, 0.9, -0.2); 
    swordMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 2.5), 
        new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 5 })
    );
    swordMesh.position.z = -1.25;
    swordGroup.add(swordMesh); 
    player.add(swordGroup);
}

/* ===== SYSTEME DE NIVEAU ET CHOIX ===== */
function gainXP(amount) {
    playerXP += amount;
    if (playerXP >= xpToNextLevel) levelUp();
    updateUI();
}

function levelUp() {
    playerLvl++;
    playerXP = 0;
    xpToNextLevel = Math.floor(xpToNextLevel * 1.6);
    playerHP = Math.min(100, playerHP + 30);
    isPaused = true;
    document.exitPointerLock();
    document.getElementById("levelUpMenu").style.display = "flex";
}

function chooseUpgrade(type) {
    if (type === 'speed') baseSpeed += 0.06;
    else if (type === 'jump') maxJumps += 1;
    document.getElementById("levelUpMenu").style.display = "none";
    isPaused = false;
    renderer.domElement.requestPointerLock();
    createParticles(player.position, 0x00ffff);
}

/* ===== COMBAT & ANIMATIONS (RÉPARÉ) ===== */
function updateCombat(delta) {
    // Calcul de l'échelle selon le bonus actif
    let currentZScale = longSwordActive ? 2.5 : 1.0;
    let currentXYScale = longSwordActive ? 1.8 : 1.0;

    if (!isAttacking || isPaused) {
        // Retour à la position de repos avec l'échelle correcte
        swordGroup.rotation.y = THREE.MathUtils.lerp(swordGroup.rotation.y, -0.2, 0.1);
        swordGroup.rotation.x = THREE.MathUtils.lerp(swordGroup.rotation.x, 0, 0.1);
        swordMesh.scale.set(currentXYScale, currentXYScale, currentZScale);
        return;
    }

    attackTime += delta * 7;
    let progress = Math.min(attackTime, 1);

    if (attackType === 'horizontal') {
        swordGroup.rotation.y = 1.8 - (progress * 4);
    } else {
        swordGroup.rotation.x = -1.5 + (progress * 3);
    }

    // Garder l'échelle pendant l'attaque
    swordMesh.scale.set(currentXYScale, currentXYScale, currentZScale);

    if (progress > 0.3 && progress < 0.8) {
        const playerReach = longSwordActive ? 10 : 6;
        enemies.forEach(en => {
            const dist = player.position.distanceTo(en.position);
            // On vérifie la distance totale pour inclure les ennemis volants
            if (dist < (playerReach + en.userData.hitboxRadius) && !en.userData.hit) {
                damageEnemy(en); en.userData.hit = true;
            }
        });
    }
    
    if (attackTime >= 1) { 
        isAttacking = false; 
    }
}

/* ===== ENNEMIS (RÉPARÉS) ===== */
function createEnemy(type) {
    const en = new THREE.Group();
    let hp, speed, yPos;

    if (type === 'boss') {
        hp = 80; speed = 0.04; yPos = 0;
        const body = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 4), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
        body.position.y = 4; en.add(body);
        const head = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
        head.position.y = 9; en.add(head);
        const armGeo = new THREE.BoxGeometry(1.2, 5, 1.2);
        const armPos = [{x:-3,y:6,z:0},{x:3,y:6,z:0},{x:-3,y:3,z:0},{x:3,y:3,z:0}];
        armPos.forEach(p => { const a = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({color:0xff0000})); a.position.set(p.x,p.y,p.z); en.add(a); });
    } else if (type === 'flying') {
        en.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshStandardMaterial({ color: 0xffff00 })));
        hp = 1; speed = 0.15; yPos = 5; // Un peu plus bas
    } else {
        en.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x00ff00 })));
        hp = 2; speed = 0.1; yPos = 0.6;
    }

    const hb = createHealthBarCanvas();
    hb.sprite.position.y = (type === 'boss') ? 11 : 1.5;
    en.add(hb.sprite);
    en.position.set((Math.random()-0.5)*180, yPos, (Math.random()-0.5)*180);
    en.userData = { type, hp, maxHp: hp, speed, hit: false, healthBarInfo: hb, hitboxRadius: (type === 'boss' ? 4.5 : 1.5) };
    enemies.push(en); scene.add(en);
}

function damageEnemy(en) {
    en.userData.hp--;
    updateHealthBarUI(en);
    createParticles(en.position.clone().add(new THREE.Vector3(0, en.userData.type==='boss'?4:0, 0)), 0xff0000);
    if (en.userData.hp <= 0) {
        score += 100;
        if (en.userData.type === 'boss') { gainXP(150); spawnBonus(en.position, 'ally'); }
        else { gainXP(25); }
        scene.remove(en);
        enemies = enemies.filter(e => e !== en);
    }
}

function updateEnemies() {
    if (enemies.length === 0 && gameActive) { wave++; spawnWave(); }
    enemies.forEach(en => {
        const dir = new THREE.Vector3().subVectors(player.position, en.position).normalize();
        en.position.x += dir.x * en.userData.speed; en.position.z += dir.z * en.userData.speed;
        
        // Logique corrigée pour les volants : ils foncent sur toi s'ils sont proches
        if (en.userData.type === 'flying') {
            let targetY = (en.position.distanceTo(player.position) < 10) ? player.position.y + 1 : 5;
            en.position.y += (targetY - en.position.y) * 0.05;
        }

        en.lookAt(player.position.x, en.position.y, player.position.z);
        en.userData.healthBarInfo.sprite.lookAt(camera.position);

        if (player.position.distanceTo(en.position) < (en.userData.type === 'boss' ? 5 : 1.8)) {
            playerHP -= (en.userData.type === 'boss' ? 0.6 : 0.3);
            updateUI();
            if (playerHP <= 0) gameOver();
        }
    });
}

/* ===== MOUVEMENTS & BOUCLE ===== */
function updatePlayer(delta) {
    if (isPaused) return;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let move = new THREE.Vector3();
    if (keys['z'] || keys['w']) move.add(forward);
    if (keys['s']) move.add(forward.negate());
    if (keys['q'] || keys['a']) move.add(right.negate());
    if (keys['d']) move.add(right);
    if (move.length() > 0) player.position.add(move.normalize().multiplyScalar(baseSpeed));

    velocityY -= 0.02; player.position.y += velocityY;
    if (player.position.y <= 0) { player.position.y = 0; velocityY = 0; jumpsRemaining = maxJumps; }
    player.rotation.y = yaw;
}

function gameLoop(time) {
    requestAnimationFrame(gameLoop);
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (gameActive && !isPaused) {
        updatePlayer(delta); updateCombat(delta); updateEnemies(); updateBonuses(delta); 
        updateParticles(delta); updateCompanion(delta); updateProjectiles(delta);
        if (Math.random() < 0.003) spawnBonus(null, null);
    }
    updateCamera();
    renderer.render(scene, camera);
}

/* ===== SYSTÈME ALLIÉ & PROJ ===== */
function spawnAlly(pos) {
    if (companion) { companion.userData.hp = 50; updateHealthBarUI(companion); return; }
    companion = new THREE.Group();
    companion.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x00aaff })));
    const hb = createHealthBarCanvas(); hb.sprite.position.y = 1.5; companion.add(hb.sprite);
    companion.position.copy(pos).setY(0.6);
    companion.userData = { hp: 50, maxHp: 50, healthBarInfo: hb };
    scene.add(companion);
}

function updateCompanion(delta) {
    if (!companion) return;
    if (companion.position.distanceTo(player.position) > 4) {
        const dir = new THREE.Vector3().subVectors(player.position, companion.position).normalize();
        companion.position.x += dir.x * 0.12; companion.position.z += dir.z * 0.12;
    }
    companion.userData.healthBarInfo.sprite.lookAt(camera.position);
    let target = null, minDist = Infinity;
    enemies.forEach(en => { const d = companion.position.distanceTo(en.position); if (d < minDist) { minDist = d; target = en; }});
    if (target && Date.now() - lastCompanionShot > 1200 && minDist < 35) {
        shootProjectile(companion.position, target.position.clone().add(new THREE.Vector3(0, target.userData.type==='boss'?4:0, 0)));
        lastCompanionShot = Date.now();
    }
}

function shootProjectile(startPos, targetPos) {
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
    proj.position.copy(startPos).setY(1);
    const dir = new THREE.Vector3().subVectors(targetPos, proj.position).normalize();
    proj.userData = { dir, life: 3 };
    companionProjectiles.push(proj); scene.add(proj);
}

function updateProjectiles(delta) {
    companionProjectiles.forEach((p, i) => {
        p.position.add(p.userData.dir.clone().multiplyScalar(0.8)); p.userData.life -= delta;
        enemies.forEach(en => {
            if (p.position.distanceTo(en.position.clone().add(new THREE.Vector3(0, en.userData.type==='boss'?4:0, 0))) < (en.userData.type==='boss'?4:2)) {
                damageEnemy(en); p.userData.life = 0;
            }
        });
        if (p.userData.life <= 0) { scene.remove(p); companionProjectiles.splice(i, 1); }
    });
}

/* ===== UTILITAIRES & UI ===== */
function createHealthBarCanvas() {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
    sprite.scale.set(1.8, 0.2, 1);
    return { sprite, ctx, texture };
}

function updateHealthBarUI(entity) {
    const info = entity.userData.healthBarInfo;
    const percentage = Math.max(0, entity.userData.hp / entity.userData.maxHp);
    info.ctx.fillStyle = '#440000'; info.ctx.fillRect(0, 0, 128, 16);
    info.ctx.fillStyle = (entity === companion) ? '#00aaff' : '#ff0000';
    info.ctx.fillRect(0, 0, 128 * percentage, 16);
    info.texture.needsUpdate = true;
}

function updateUI() {
    document.getElementById("score").textContent = score;
    document.getElementById("wave").textContent = wave;
    document.getElementById("lvlText").textContent = playerLvl;
    document.getElementById("hpText").textContent = Math.ceil(playerHP);
    document.getElementById("healthBar").style.width = playerHP + "%";
    document.getElementById("xpBar").style.width = (playerXP / xpToNextLevel * 100) + "%";
}

function updateCamera() {
    const dist = 10;
    camera.position.set(player.position.x + Math.sin(yaw)*dist, player.position.y + 5 + pitch*3, player.position.z + Math.cos(yaw)*dist);
    camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);
}

function setupControls() {
    window.addEventListener('keydown', e => { 
        if (isPaused) return;
        keys[e.key.toLowerCase()] = true; 
        if (e.code === 'Space' && jumpsRemaining > 0) { velocityY = 0.45; jumpsRemaining--; }
    });
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
    window.addEventListener('mousemove', e => { 
        if (document.pointerLockElement && !isPaused) { 
            yaw -= e.movementX * 0.003; 
            pitch = Math.max(-0.8, Math.min(0.8, pitch + e.movementY * 0.003)); 
        }
    });
    window.addEventListener('mousedown', e => { 
        if (isPaused) return;
        if (!document.pointerLockElement) renderer.domElement.requestPointerLock(); 
        else if (!isAttacking && gameActive) { 
            isAttacking = true; attackTime = 0; 
            attackType = e.button === 2 ? 'vertical' : 'horizontal'; 
            enemies.forEach(en => en.userData.hit = false); 
        }
    });
}

function spawnWave() {
    const isBoss = wave % 5 === 0;
    for (let i = 0; i < (isBoss ? 1 : 4 + wave); i++) createEnemy(isBoss ? 'boss' : (Math.random() > 0.7 ? 'flying' : 'normal'));
}

function createMap() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    for (let i = 0; i < 50; i++) {
        const h = 15 + Math.random() * 30;
        const b = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), new THREE.MeshStandardMaterial({ color: 0x1a151a }));
        b.position.set((Math.random()-0.5)*300, h/2, (Math.random()-0.5)*300);
        if (b.position.length() < 30) continue;
        scene.add(b);
    }
}

function spawnBonus(pos, forcedType) {
    const type = forcedType || (Math.random() > 0.6 ? 'sword' : 'shield');
    let color = (type === 'sword') ? 0xffff00 : (type === 'shield' ? 0x00aaff : 0xff00ff);
    const b = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color, wireframe: true }));
    if (pos) b.position.copy(pos).setY(1.5); else b.position.set((Math.random()-0.5)*200, 1.5, (Math.random()-0.5)*200);
    b.userData = { type }; bonuses.push(b); scene.add(b);
}

function updateBonuses(delta) {
    bonuses.forEach((b, i) => {
        b.rotation.y += delta * 3;
        if (player.position.distanceTo(b.position) < 3) {
            if (b.userData.type === 'sword') { longSwordActive = true; swordTimer = 15; }
            else if (b.userData.type === 'shield') activateShield();
            else if (b.userData.type === 'ally') spawnAlly(b.position);
            scene.remove(b); bonuses.splice(i, 1);
        }
    });
    if (longSwordActive) { swordTimer -= delta; if (swordTimer <= 0) { longSwordActive = false; } }
    if (shieldActive) {
        shields.forEach((s, i) => {
            const angle = (Date.now() * 0.005) + (i * 2.1);
            s.position.set(player.position.x + Math.cos(angle)*4, 1.5, player.position.z + Math.sin(angle)*4);
            enemies.forEach(en => { if (s.position.distanceTo(en.position) < 3) damageEnemy(en); });
        });
    }
}

function activateShield() {
    if (shieldActive) return;
    shieldActive = true;
    for(let i=0; i<3; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({color: 0x00aaff}));
        shields.push(s); scene.add(s);
    }
    setTimeout(() => { shields.forEach(s => scene.remove(s)); shields = []; shieldActive = false; }, 10000);
}

function createParticles(pos, color) {
    for(let i=0; i<12; i++){
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({color}));
        p.position.copy(pos);
        p.userData = { vel: new THREE.Vector3((Math.random()-0.5)*0.6, Math.random()*0.6, (Math.random()-0.5)*0.6), life: 1 };
        particles.push(p); scene.add(p);
    }
}

function updateParticles(delta) {
    particles.forEach((p, i) => {
        p.position.add(p.userData.vel); p.userData.life -= delta * 1.5; p.scale.setScalar(p.userData.life);
        if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    });
}

function gameOver() { gameActive = false; document.getElementById("gameOver").style.display = "flex"; document.exitPointerLock(); }

document.getElementById("startBtn").onclick = () => {
    document.getElementById("menu").style.display = "none";
    document.getElementById("ui").style.display = "block";
    gameActive = true; init(); spawnWave();
};

function initMenuAnimation() {
    const canvas = document.getElementById('bloodCanvas');
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.reset();
        }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height - canvas.height;
            this.speed = 2 + Math.random() * 5;
            this.size = Math.random() * 3 + 1;
            this.color = Math.random() > 0.5 ? '#600' : '#f00'; // Sang ou braise
            this.opacity = Math.random() * 0.5 + 0.2;
        }
        update() {
            this.y += this.speed;
            this.x += Math.sin(this.y / 20); // Oscillation légère
            if (this.y > canvas.height) this.reset();
        }
        draw() {
            ctx.globalAlpha = this.opacity;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let i = 0; i < 100; i++) particles.push(new Particle());

    function animate() {
        if (!gameActive) { // On n'anime que si le menu est actif
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.update();
                p.draw();
            });
            requestAnimationFrame(animate);
        }
    }
    animate();
}

// Appelle la fonction immédiatement pour que l'animation tourne au chargement
initMenuAnimation();