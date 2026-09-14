/**
 * Space Invaders Arcade Engine & Connectome Brain Integration
 */

class SpaceInvadersGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.width = this.canvas.width;
        this.height = this.canvas.height;

        // Visualizer Canvases
        this.retinaCanvas = document.getElementById('retinaCanvas');
        this.retinaCtx = this.retinaCanvas.getContext('2d');
        this.motionCanvas = document.getElementById('motionCanvas');
        this.motionCtx = this.motionCanvas.getContext('2d');
        this.oscCanvas = document.getElementById('oscilloscopeCanvas');
        this.oscCtx = this.oscCanvas.getContext('2d');

        // Brain & AI Control Mode
        this.brain = new ConnectomeBrain(32);
        this.isAutoPilot = true;

        // Evolutionary Training Parameters
        this.generation = 1;
        this.populationSize = 10;
        this.currentGenomeIndex = 0;
        this.population = [];
        this.bestScore = 0;
        this.isTraining = false;

        this._initPopulation();
        this.resetGame();

        // Keyboard Controls
        this.keys = { left: false, right: false, space: false };
        this._setupKeyboardListeners();

        // Game Loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    _initPopulation() {
        this.population = [];
        for (let i = 0; i < this.populationSize; i++) {
            const b = new ConnectomeBrain(32);
            if (i > 0) b.mutate(0.3);
            this.population.push({
                brain: b,
                fitness: 0,
                score: 0
            });
        }
        this.brain = this.population[0].brain;
    }

    resetGame() {
        // Player Ship
        this.player = {
            x: this.width / 2 - 16,
            y: this.height - 35,
            width: 32,
            height: 18,
            speed: 5,
            color: '#00f0ff'
        };

        // Bullets
        this.playerBullets = [];
        this.enemyBullets = [];
        this.lastShotTime = 0;

        // Alien Swarm
        this.aliens = [];
        this.alienRows = 4;
        this.alienCols = 8;
        this.alienWidth = 28;
        this.alienHeight = 20;
        this.alienPadding = 12;
        this.alienOffsetTop = 40;
        this.alienOffsetLeft = 30;
        this.alienDirection = 1;
        this.alienStepDown = false;
        this.alienSpeed = 1.2;

        this._createAlienSwarm();

        // Particles
        this.particles = [];

        // Game Stats
        this.score = 0;
        this.lives = 3;
        this.gameOver = false;
        this.ticks = 0;
    }

    _createAlienSwarm() {
        this.aliens = [];
        for (let r = 0; r < this.alienRows; r++) {
            for (let c = 0; c < this.alienCols; c++) {
                const x = this.alienOffsetLeft + c * (this.alienWidth + this.alienPadding);
                const y = this.alienOffsetTop + r * (this.alienHeight + this.alienPadding);
                const color = r === 0 ? '#ff0055' : (r < 2 ? '#ffcc00' : '#00ff66');
                this.aliens.push({
                    x: x,
                    y: y,
                    width: this.alienWidth,
                    height: this.alienHeight,
                    color: color,
                    alive: true
                });
            }
        }
    }

    _setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') this.keys.left = true;
            if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = true;
            if (e.key === ' ' || e.key === 'Spacebar') this.keys.space = true;
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') this.keys.left = false;
            if (e.key === 'ArrowRight' || e.key === 'd') this.keys.right = false;
            if (e.key === ' ' || e.key === 'Spacebar') this.keys.space = false;
        });
    }

    gameLoop(now) {
        const dt = (now - this.lastTime) / 1000.0;
        this.lastTime = now;

        if (!this.gameOver) {
            this.update();
        } else {
            this._handleGameOver();
        }

        this.render();

        // Render Brain Telemetry Panels
            const diag = this.brain.processFrame(this.canvas, this.player.x, this.player.width);
        this._renderBrainPanels(diag);
        this._updateUIStats();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    update() {
        this.ticks++;

        // 1. Process Controls (Auto-Pilot Brain vs Human Keys)
        let moveLeft = this.keys.left;
        let moveRight = this.keys.right;
        let doShoot = this.keys.space;

        if (this.isAutoPilot) {
                const diag = this.brain.processFrame(this.canvas, this.player.x, this.player.width);
            moveLeft = diag.motor.moveLeft;
            moveRight = diag.motor.moveRight;
            doShoot = diag.motor.shoot;
        }

        // Highlight Motor Indicator Lights
        document.getElementById('lightLeft').className = 'signal-light' + (moveLeft ? ' active-left' : '');
        document.getElementById('lightRight').className = 'signal-light' + (moveRight ? ' active-right' : '');
        document.getElementById('lightShoot').className = 'signal-light' + (doShoot ? ' active-shoot' : '');

        // Move Player
        if (moveLeft && this.player.x > 5) {
            this.player.x -= this.player.speed;
        }
        if (moveRight && this.player.x < this.width - this.player.width - 5) {
            this.player.x += this.player.speed;
        }

        // Player Shoot
        const nowTime = performance.now();
        if (doShoot && nowTime - this.lastShotTime > 300) {
            this.playerBullets.push({
                x: this.player.x + this.player.width / 2 - 2,
                y: this.player.y,
                width: 4,
                height: 10,
                speed: 8
            });
            this.lastShotTime = nowTime;
        }

        // Update Bullets
        for (let i = this.playerBullets.length - 1; i >= 0; i--) {
            const b = this.playerBullets[i];
            b.y -= b.speed;
            if (b.y < 0) {
                this.playerBullets.splice(i, 1);
            }
        }

        // Update Enemy Bullets
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const eb = this.enemyBullets[i];
            eb.y += eb.speed;

            // Player Collision Check
            if (
                eb.x < this.player.x + this.player.width &&
                eb.x + eb.width > this.player.x &&
                eb.y < this.player.y + this.player.height &&
                eb.y + eb.height > this.player.y
            ) {
                this.enemyBullets.splice(i, 1);
                this._createExplosion(this.player.x + 16, this.player.y + 9, '#00f0ff');
                this.lives--;
                if (this.lives <= 0) {
                    this.gameOver = true;
                }
            } else if (eb.y > this.height) {
                this.enemyBullets.splice(i, 1);
            }
        }

        // Move Swarm
        let moveX = this.alienDirection * this.alienSpeed;
        let changeDir = false;

        const aliveAliens = this.aliens.filter(a => a.alive);
        if (aliveAliens.length === 0) {
            // Next Wave!
            this.score += 500;
            this.alienSpeed += 0.5;
            this._createAlienSwarm();
            return;
        }

        for (let a of aliveAliens) {
            a.x += moveX;
            if (a.x <= 10 || a.x + a.width >= this.width - 10) {
                changeDir = true;
            }
            if (a.y + a.height >= this.player.y) {
                this.gameOver = true;
            }
        }

        if (changeDir) {
            this.alienDirection *= -1;
            for (let a of aliveAliens) {
                a.y += 12;
            }
        }

        // Alien Shoot Random Chance
        if (Math.random() < 0.03 && aliveAliens.length > 0) {
            const randomAlien = aliveAliens[Math.floor(Math.random() * aliveAliens.length)];
            this.enemyBullets.push({
                x: randomAlien.x + randomAlien.width / 2 - 2,
                y: randomAlien.y + randomAlien.height,
                width: 4,
                height: 10,
                speed: 4
            });
        }

        // Bullet-Alien Collisions
        for (let i = this.playerBullets.length - 1; i >= 0; i--) {
            const b = this.playerBullets[i];
            for (let a of aliveAliens) {
                if (
                    b.x < a.x + a.width &&
                    b.x + b.width > a.x &&
                    b.y < a.y + a.height &&
                    b.y + b.height > a.y
                ) {
                    a.alive = false;
                    this.score += 100;
                    this._createExplosion(a.x + a.width / 2, a.y + a.height / 2, a.color);
                    this.playerBullets.splice(i, 1);
                    break;
                }
            }
        }

        // Particles Update
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= 0.03;
            if (p.alpha <= 0) this.particles.splice(i, 1);
        }

        // Update Genome Score
        if (this.isAutoPilot) {
            this.population[this.currentGenomeIndex].score = this.score;
            this.population[this.currentGenomeIndex].fitness = this.score + (this.ticks * 0.5);
        }
    }

    _handleGameOver() {
        if (this.isTraining || this.isAutoPilot) {
            // Next Genome in Evolutionary Population
            if (this.score > this.bestScore) this.bestScore = this.score;

            this.currentGenomeIndex++;
            if (this.currentGenomeIndex >= this.populationSize) {
                // Next Generation! Evolve Population
                this._evolvePopulation();
                this.generation++;
                this.currentGenomeIndex = 0;
            }

            this.brain = this.population[this.currentGenomeIndex].brain;
            this.resetGame();
        }
    }

    _evolvePopulation() {
        // Sort population by fitness
        this.population.sort((a, b) => b.fitness - a.fitness);

        const elites = this.population.slice(0, 3);
        const newPop = [];

        // Retain Elites
        for (let e of elites) {
            newPop.push({
                brain: e.brain.clone(),
                fitness: 0,
                score: 0
            });
        }

        // Fill remaining with mutated clones of elites
        while (newPop.length < this.populationSize) {
            const parent = elites[Math.floor(Math.random() * elites.length)];
            const childBrain = parent.brain.clone();
            childBrain.mutate(0.25);
            newPop.push({
                brain: childBrain,
                fitness: 0,
                score: 0
            });
        }

        this.population = newPop;
    }

    _createExplosion(x, y, color) {
        for (let i = 0; i < 12; i++) {
            this.particles.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6,
                color: color,
                alpha: 1.0
            });
        }
    }

    render() {
        // Clear Canvas
        this.ctx.fillStyle = '#05070a';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw Player Ship
        this.ctx.fillStyle = this.player.color;
        this.ctx.beginPath();
        this.ctx.moveTo(this.player.x + this.player.width / 2, this.player.y);
        this.ctx.lineTo(this.player.x + this.player.width, this.player.y + this.player.height);
        this.ctx.lineTo(this.player.x, this.player.y + this.player.height);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw Player Bullets
        this.ctx.fillStyle = '#ffcc00';
        for (let b of this.playerBullets) {
            this.ctx.fillRect(b.x, b.y, b.width, b.height);
        }

        // Draw Enemy Bullets
        this.ctx.fillStyle = '#ff0055';
        for (let eb of this.enemyBullets) {
            this.ctx.fillRect(eb.x, eb.y, eb.width, eb.height);
        }

        // Draw Alien Swarm
        for (let a of this.aliens) {
            if (a.alive) {
                this.ctx.fillStyle = a.color;
                this.ctx.fillRect(a.x, a.y, a.width, a.height);

                // Alien Eyes
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(a.x + 4, a.y + 4, 4, 4);
                this.ctx.fillRect(a.x + a.width - 8, a.y + 4, 4, 4);
            }
        }

        // Draw Particles
        for (let p of this.particles) {
            this.ctx.save();
            this.ctx.globalAlpha = p.alpha;
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(p.x, p.y, 3, 3);
            this.ctx.restore();
        }

        // Draw Game Over Overlay if Manual Mode
        if (this.gameOver && !this.isAutoPilot) {
            this.ctx.fillStyle = 'rgba(0,0,0,0.75)';
            this.ctx.fillRect(0, 0, this.width, this.height);

            this.ctx.fillStyle = '#ff0055';
            this.ctx.font = 'bold 28px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('GAME OVER', this.width / 2, this.height / 2 - 10);

            this.ctx.fillStyle = '#fff';
            this.ctx.font = '14px sans-serif';
            this.ctx.fillText('Press Restart to Play Again', this.width / 2, this.height / 2 + 20);
        }
    }

    _renderBrainPanels(diag) {
        const grid = 32;
        const rWidth = this.retinaCanvas.width;
        const rHeight = this.retinaCanvas.height;
        const cellW = rWidth / grid;
        const cellH = rHeight / grid;

        // 1. Render Retinal Visual Feed
        for (let y = 0; y < grid; y++) {
            for (let x = 0; x < grid; x++) {
                const idx = y * grid + x;
                const v = Math.floor(diag.retina[idx] * 255);
                this.retinaCtx.fillStyle = `rgb(${v},${v},${v})`;
                this.retinaCtx.fillRect(x * cellW, y * cellH, cellW, cellH);
            }
        }

        // 2. Render Motion Heatmap (JET Colormap)
        for (let y = 0; y < grid; y++) {
            for (let x = 0; x < grid; x++) {
                const idx = y * grid + x;
                const m = Math.min(1.0, diag.motion[idx] * 3.0);
                const r = Math.floor(m * 255);
                const b = Math.floor((1.0 - m) * 255);
                this.motionCtx.fillStyle = `rgb(${r}, 0, ${b})`;
                this.motionCtx.fillRect(x * cellW, y * cellH, cellW, cellH);
            }
        }

        // 3. Render Oscilloscope
        const oW = this.oscCanvas.width;
        const oH = this.oscCanvas.height;
        this.oscCtx.fillStyle = '#05070a';
        this.oscCtx.fillRect(0, 0, oW, oH);

        const vHist = this.brain.vHistory;
        if (vHist.length > 1) {
            this.oscCtx.strokeStyle = '#00f0ff';
            this.oscCtx.lineWidth = 2;
            this.oscCtx.beginPath();

            for (let i = 0; i < vHist.length; i++) {
                const px = (i / (this.brain.historyLen - 1)) * oW;
                const py = oH - 10 - Math.min(oH - 20, (vHist[i] / 15.0) * (oH - 20));
                if (i === 0) this.oscCtx.moveTo(px, py);
                else this.oscCtx.lineTo(px, py);
            }
            this.oscCtx.stroke();
        }
    }

    _updateUIStats() {
        document.getElementById('statScore').innerText = this.score;
        document.getElementById('statGen').innerText = this.generation;
        document.getElementById('statGenome').innerText = `${this.currentGenomeIndex + 1}/${this.populationSize}`;
        document.getElementById('statBest').innerText = this.bestScore;
    }
}

// Global Launcher
window.addEventListener('DOMContentLoaded', () => {
    const game = new SpaceInvadersGame();

    // Mode Switcher Toggle
    const modeToggle = document.getElementById('modeToggle');
    modeToggle.addEventListener('change', (e) => {
        game.isAutoPilot = e.target.checked;
        document.getElementById('modeLabel').innerText = game.isAutoPilot ? 'Fly Brain Auto-Pilot' : 'Human Control';
    });

    // Reset Button
    document.getElementById('btnRestart').addEventListener('click', () => {
        game.resetGame();
    });

    // Auto-Train Button
    document.getElementById('btnTrain').addEventListener('click', () => {
        game.isTraining = !game.isTraining;
        const btn = document.getElementById('btnTrain');
        btn.innerText = game.isTraining ? 'Pause Auto-Train' : 'Auto-Train Brain';
        btn.className = game.isTraining ? 'btn btn-magenta' : 'btn btn-primary';
    });
});
