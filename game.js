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

// Système de Shake Caméra
let shakeIntensity = 0;
let shakeDecay = 0.9;

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
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    body.position.y = 1; player.add(body);
    
    // Pivot de l'épée
    swordGroup = new THREE.Group(); 
    swordGroup.position.set(0.6, 1.1, -0.2); 
    
    // Lame
    swordMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 2.5), 
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

/* ===== COMBAT & ANIMATIONS (MODIFIÉ) ===== */
function updateCombat(delta) {
    if (!isAttacking || isPaused) {
        // Position de repos fluide
        swordGroup.rotation.x = THREE.MathUtils.lerp(swordGroup.rotation.x, 0, 0.1);
        swordGroup.rotation.y = THREE.MathUtils.lerp(swordGroup.rotation.y, -0.2, 0.1);
        swordGroup.rotation.z = THREE.MathUtils.lerp(swordGroup.rotation.z, 0, 0.1);
        swordMesh.scale.set(1, 1, 1);
        return;
    }

    attackTime += delta * 3.5; // Vitesse de l'animation

    // Courbe d'animation : Phase de préparation (wind-up) puis impact rapide
    // Utilisation de Math.sin pour une fluidité organique
    let progress = Math.min(attackTime, 1);
    let swing = Math.sin(progress * Math.PI); 

    if (attackType === 'horizontal') {
        // Rotation horizontale avec un léger arc de cercle (tilt)
        swordGroup.rotation.y = 1.5 - (progress * 4); 
        swordGroup.rotation.z = swing * 0.5;
        
        // Effet de coupure visuelle (étirement de la lame pendant l'impact)
        if (progress > 0.3 && progress < 0.7) {
            swordMesh.scale.x = 0.2; // La lame s'affine
            swordMesh.scale.z = 1.4; // La lame s'allonge pour l'effet de sillage
        } else {
            swordMesh.scale.set(1, 1, 1);
        }
    } else {
        // Attaque verticale (écrasement)
        swordGroup.rotation.x = -1.2 + (progress * 3.5);
        swordGroup.rotation.y = -0.2;
        
        if (progress > 0.3 && progress < 0.7) {
            swordMesh.scale.y = 0.2;
            swordMesh.scale.z = 1.4;
        } else {
            swordMesh.scale.set(1, 1, 1);
        }
    }

    // Détection des collisions au moment du pic de vitesse (progress 0.5)
    if (progress > 0.4 && progress < 0.6) {
        const playerReach = longSwordActive ? 10 : 6;
        enemies.forEach(en => {
            const distXZ = Math.sqrt(Math.pow(player.position.x - en.position.x, 2) + Math.pow(player.position.z - en.position.z, 2));
            if (distXZ < (playerReach + en.userData.hitboxRadius) && !en.userData.hit) {
                damageEnemy(en); 
                en.userData.hit = true;
                shakeIntensity = Math.min(shakeIntensity + 0.5, 1.2); // Petit shake à l'impact
            }
        });
    }

    if (attackTime >= 1) {
        isAttacking = false;
        attackTime = 0;
    }
}

/* ===== ENNEMIS ===== */
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
        hp = 1; speed = 0.15; yPos = 6;
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

/* ===== BOUCLE & MOUVEMENTS ===== */
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
        if (shakeIntensity > 0) shakeIntensity *= shakeDecay;
    }
    updateCamera();
    renderer.render(scene, camera);
}

/* ===== SYSTÈME ALLIÉ ===== */
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

/* ===== UTILITAIRES & CONTROLES ===== */
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
    let targetPosX = player.position.x + Math.sin(yaw) * dist;
    let targetPosY = player.position.y + 5 + pitch * 3;
    let targetPosZ = player.position.z + Math.cos(yaw) * dist;

    if (shakeIntensity > 0.01) {
        targetPosX += (Math.random() - 0.5) * shakeIntensity;
        targetPosY += (Math.random() - 0.5) * shakeIntensity;
        targetPosZ += (Math.random() - 0.5) * shakeIntensity;
    }

    camera.position.set(targetPosX, targetPosY, targetPosZ);
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

/* ===== GESTION CARTE & VAGUES ===== */
function spawnWave() {
    const isBoss = wave % 5 === 0;
    for (let i = 0; i < (isBoss ? 1 : 4 + wave); i++) createEnemy(isBoss ? 'boss' : (Math.random() > 0.7 ? 'flying' : 'normal'));
}

function updateEnemies() {
    if (enemies.length === 0 && gameActive) { wave++; spawnWave(); }
    enemies.forEach(en => {
        const dir = new THREE.Vector3().subVectors(player.position, en.position).normalize();
        en.position.x += dir.x * en.userData.speed; en.position.z += dir.z * en.userData.speed;
        if (en.userData.type === 'flying') en.position.y += (player.position.y + 2 - en.position.y) * 0.02;
        en.lookAt(player.position.x, en.position.y, player.position.z);
        en.userData.healthBarInfo.sprite.lookAt(camera.position);
        if(en.userData.type === 'boss') en.children.forEach((c, i) => { if(i >= 2) c.rotation.x = Math.sin(Date.now()*0.005+i)*0.5; });
        if (player.position.distanceTo(en.position) < (en.userData.type === 'boss' ? 5 : 2)) {
            let damage = (en.userData.type === 'boss' ? 0.6 : 0.2);
            playerHP -= damage;
            shakeIntensity = Math.min(shakeIntensity + damage * 2, 1.5); 
            updateUI();
            if (playerHP <= 0) gameOver();
        }
    });
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
            if (b.userData.type === 'sword') { longSwordActive = true; swordTimer = 15; swordMesh.scale.set(1.5, 1.5, 2.5); }
            else if (b.userData.type === 'shield') activateShield();
            else if (b.userData.type === 'ally') spawnAlly(b.position);
            scene.remove(b); bonuses.splice(i, 1);
        }
    });
    if (longSwordActive) { swordTimer -= delta; if (swordTimer <= 0) { longSwordActive = false; swordMesh.scale.set(1, 1, 1); } }
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