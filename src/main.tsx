import React from 'react'
import ReactDOM from 'react-dom/client'
import Phaser from 'phaser'

type VocabQuizItem = {
  question: string
  choices: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
}

/** JLPT 风格词汇单选（内置题库，遇敌后随机抽一题） */
const VOCAB_QUIZZES: VocabQuizItem[] = [
  {
    question: '「図書館（としょかん）」の意味として正しいのは？',
    choices: ['图书馆', '餐厅', '车站', '邮局'],
    correctIndex: 0
  },
  {
    question: '「勉強（べんきょう）する」と意味が最も近いのは？',
    choices: ['学习', '睡觉', '跑步', '画画'],
    correctIndex: 0
  },
  {
    question: '「火曜日（かようび）」は曜日として何曜日？',
    choices: ['星期一', '星期二', '星期三', '星期四'],
    correctIndex: 1
  },
  {
    question: '「寒い（さむい）」の読み方として正しいのは？',
    choices: ['さむい', 'あつい', 'あたたかい', 'つめたい'],
    correctIndex: 0
  },
  {
    question: '「先生（せんせい）」の使い方として自然なのは？',
    choices: ['学校の先生', '電車の先生', '木の先生', '本の先生'],
    correctIndex: 0
  }
]

const PLAYER_HP_MAX = 100
const MONSTER_HP_MAX = 100
const DMG_ON_CORRECT = 30
const DMG_ON_WRONG = 20

type BattleUiRefs = {
  quizLayer: Phaser.GameObjects.Container
  optionTexts: Phaser.GameObjects.Text[]
  introTitle: Phaser.GameObjects.Text
  playerHpBarBg: Phaser.GameObjects.Rectangle
  playerHpBarFill: Phaser.GameObjects.Rectangle
  monsterHpBarBg: Phaser.GameObjects.Rectangle
  monsterHpBarFill: Phaser.GameObjects.Rectangle
  battleMessage: Phaser.GameObjects.Text
  btnAtkBg: Phaser.GameObjects.Rectangle
  btnAtk: Phaser.GameObjects.Text
  btnFleeBg: Phaser.GameObjects.Rectangle
  btnFlee: Phaser.GameObjects.Text
}

class MainScene extends Phaser.Scene {
  player!: Phaser.GameObjects.Rectangle
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  /** 每棵树：仅树干 20×40 碰撞（树冠不挡路） */
  private treeBounds: Phaser.Geom.Rectangle[] = []
  /** 草丛：仅在这些区域内移动才可能随机遇敌 */
  private grassRects: Phaser.Geom.Rectangle[] = []
  /** 道路：走在上面不算草丛，不触发遇敌 */
  private roadRects: Phaser.Geom.Rectangle[] = []
  private encounterCooldownUntil = 0
  /** 遇敌至战斗结束期间禁止移动（含闪屏阶段） */
  private movementLocked = false
  /** 战斗 UI 根节点（闪屏 / 压暗 / 窗口） */
  private battleRoot?: Phaser.GameObjects.Container
  /** 草丛内单株草叶（用于踩草动画） */
  private grassBlades: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse)[] = []
  /** 大地图玩家 HP（战斗外仍保留；战败后关闭战斗不自动回满） */
  private playerRpgHp = PLAYER_HP_MAX
  /** 灵石（战斗胜利奖励累计） */
  private spiritStones = 0

  constructor() {
    super('main')
  }

  /** 仅树干：中心 (x,y)，宽 20 高 40（与绘制一致；树叶不参与碰撞） */
  private addTreeCollider(x: number, y: number) {
    this.treeBounds.push(new Phaser.Geom.Rectangle(x - 10, y - 20, 20, 40))
  }

  private playerOverlapsAnyTree(): boolean {
    const pb = this.player.getBounds()
    for (const t of this.treeBounds) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(pb, t)) return true
    }
    return false
  }

  /** 玩家中心在草丛矩形内，且不在任何道路矩形内 */
  private isPlayerInTallGrass(): boolean {
    const px = this.player.x
    const py = this.player.y
    if (this.roadRects.some((r) => r.contains(px, py))) return false
    return this.grassRects.some((r) => r.contains(px, py))
  }

  /** 在草丛矩形内密集铺排 6×12 小叶片（矩形/椭圆），避开道路 */
  private fillGrassWithBlades(gx: number, gy: number, gw: number, gh: number) {
    const greens = [0x1a4d32, 0x143828, 0x245d3e, 0x2f6e48, 0x1e5236]
    const stepX = 11
    const stepY = 7

    for (let cx = gx + stepX * 0.5; cx < gx + gw - 2; cx += stepX) {
      for (let cy = gy + 8; cy < gy + gh - 4; cy += stepY) {
        const x = cx + Phaser.Math.Between(-3, 3)
        const y = cy + Phaser.Math.Between(-2, 2)
        if (this.roadRects.some((r) => r.contains(x, y))) continue

        const c = Phaser.Math.RND.pick(greens)
        const rot = Phaser.Math.FloatBetween(-0.28, 0.32)
        const useEllipse = Math.random() < 0.38

        const blade = useEllipse
          ? this.add.ellipse(x, y, 6, 12, c).setRotation(rot).setDepth(1)
          : this.add.rectangle(x, y, 6, 12, c).setRotation(rot).setDepth(1)

        blade.setData('baseY', y)
        blade.setData('baseScaleX', blade.scaleX)
        blade.setData('baseScaleY', blade.scaleY)
        blade.setData('rustling', false)
        this.grassBlades.push(blade)
      }
    }
  }

  /** 宝可梦式踩草：附近草叶短暂缩放 + 上下晃，约 0.2s */
  private rustleNearbyGrass() {
    const px = this.player.x
    const py = this.player.y
    const r = 50

    for (const blade of this.grassBlades) {
      if (blade.getData('rustling')) continue
      const d = Phaser.Math.Distance.Between(px, py, blade.x, blade.y)
      if (d > r) continue

      const baseY = blade.getData('baseY') as number
      const bsx = blade.getData('baseScaleX') as number
      const bsy = blade.getData('baseScaleY') as number

      blade.setData('rustling', true)
      this.tweens.add({
        targets: blade,
        y: baseY - 5,
        scaleX: bsx * 1.14,
        scaleY: bsy * 1.2,
        duration: 100,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          blade.setY(baseY)
          blade.setScale(bsx, bsy)
          blade.setData('rustling', false)
        }
      })
    }
  }

  /** 草丛逻辑区 + 浅绿道路；草丛用密集草叶绘制 */
  private createGrassAndRoads() {
    const roadColor = 0x7dd892

    const grassPatches: [number, number, number, number][] = [
      [16, 64, 580, 258],
      [684, 64, 580, 258],
      [16, 396, 520, 304],
      [744, 396, 520, 304],
      [544, 96, 192, 200]
    ]
    const roadPatches: [number, number, number, number][] = [
      [0, 332, 1280, 72],
      [598, 0, 84, 720],
      [120, 168, 520, 44],
      [680, 452, 480, 46]
    ]

    for (const [gx, gy, gw, gh] of grassPatches) {
      this.grassRects.push(new Phaser.Geom.Rectangle(gx, gy, gw, gh))
    }
    for (const [rx, ry, rw, rh] of roadPatches) {
      this.roadRects.push(new Phaser.Geom.Rectangle(rx, ry, rw, rh))
      this.add.rectangle(rx + rw / 2, ry + rh / 2, rw, rh, roadColor).setDepth(4)
    }
    for (const [gx, gy, gw, gh] of grassPatches) {
      this.fillGrassWithBlades(gx, gy, gw, gh)
    }
  }

  private closeBattle() {
    if (this.battleRoot) {
      this.battleRoot.destroy(true)
      this.battleRoot = undefined
    }
    this.movementLocked = false
  }

  /** 柔和双闪 → 压暗 → 战斗弹窗；遇敌后锁定移动，逃跑解除 */
  private beginEncounterSequence() {
    if (this.movementLocked) return
    this.movementLocked = true

    const w = 1280
    const h = 720
    const cx = w / 2
    const cy = h / 2

    const root = this.add.container(0, 0).setDepth(5000).setScrollFactor(0)
    this.battleRoot = root

    // 浅灰全屏闪层（低 alpha、短时长，避免刺眼）
    const flash = this.add.rectangle(cx, cy, w, h, 0xd8d8d8).setAlpha(0)
    root.add(flash)

    const softFlash = (peak: number, onDone: () => void) => {
      this.tweens.add({
        targets: flash,
        alpha: peak,
        duration: 58,
        ease: 'Sine.easeInOut',
        yoyo: true,
        onComplete: () => {
          flash.setAlpha(0)
          onDone()
        }
      })
    }

    const afterFlashes = () => {
      flash.destroy()

      const dim = this.add.rectangle(cx, cy, w, h, 0x05070c).setAlpha(0).setInteractive()
      root.addAt(dim, 0)

      this.tweens.add({
        targets: dim,
        alpha: 0.57,
        duration: 320,
        ease: 'Cubic.easeOut',
        onComplete: () => this.openBattlePanel(root, cx, cy)
      })
    }

    softFlash(0.075, () => {
      this.time.delayedCall(110, () => {
        softFlash(0.065, () => afterFlashes())
      })
    })
  }

  private hpBarFillColor(ratio: number): number {
    if (ratio > 0.5) return 0x50e070
    if (ratio > 0.22) return 0xf0e040
    return 0xff5050
  }

  /** 在战斗面板内挂载词汇四选一（与 HP 结算联动） */
  private mountVocabQuiz(
    panel: Phaser.GameObjects.Container,
    refreshHpBars: () => void
  ) {
    const ui = panel.getData('battleUi') as BattleUiRefs
    const { quizLayer, optionTexts } = ui

    quizLayer.removeAll(true)
    optionTexts.length = 0

    const item = Phaser.Math.RND.pick(VOCAB_QUIZZES)
    const optionYs = [-72, -22, 28, 78]

    const qText = this.add
      .text(0, -168, item.question, {
        fontSize: '20px',
        color: '#f2eee6',
        fontFamily: 'Microsoft YaHei, Meiryo, Hiragino Sans, sans-serif',
        align: 'center',
        wordWrap: { width: 480 }
      })
      .setOrigin(0.5)
    quizLayer.add(qText)

    const feedback = this.add
      .text(0, 132, '', {
        fontSize: '17px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'center',
        wordWrap: { width: 460 }
      })
      .setOrigin(0.5)
      .setVisible(false)
    quizLayer.add(feedback)

    let answered = false

    item.choices.forEach((label, i) => {
      const rowBg = this.add
        .rectangle(0, optionYs[i], 430, 42, 0x2a3d52)
        .setStrokeStyle(1, 0x4a6a88)
      const rowTxt = this.add
        .text(0, optionYs[i], label, {
          fontSize: '18px',
          color: '#ffffff',
          fontFamily: 'Microsoft YaHei, Meiryo, sans-serif',
          align: 'center',
          wordWrap: { width: 400 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })

      rowTxt.on('pointerdown', () => {
        if (answered || panel.getData('battleEnded')) return
        answered = true
        optionTexts.forEach((t) => t.disableInteractive())

        if (i === item.correctIndex) {
          let mon = (panel.getData('monsterHp') as number) - DMG_ON_CORRECT
          if (mon < 0) mon = 0
          panel.setData('monsterHp', mon)
          refreshHpBars()

          if (mon <= 0) {
            panel.setData('battleEnded', true)
            quizLayer.setVisible(false)
            quizLayer.removeAll(true)
            optionTexts.length = 0
            panel.setData('inQuiz', false)
            ui.btnAtk.setVisible(false)
            ui.btnAtkBg.setVisible(false)
            ui.introTitle.setVisible(false)
            ui.battleMessage
              .setText('战斗胜利！获得3颗灵石')
              .setColor('#ffd873')
              .setVisible(true)
            this.spiritStones += 3
            this.time.delayedCall(2600, () => this.closeBattle())
          } else {
            feedback
              .setText('答对了！怪物受到伤害')
              .setColor('#a8ffc4')
              .setVisible(true)
            this.time.delayedCall(450, () => {
              if (panel.getData('battleEnded')) return
              this.mountVocabQuiz(panel, refreshHpBars)
            })
          }
        } else {
          this.playerRpgHp = Math.max(0, this.playerRpgHp - DMG_ON_WRONG)
          refreshHpBars()

          if (this.playerRpgHp <= 0) {
            panel.setData('battleEnded', true)
            quizLayer.setVisible(false)
            quizLayer.removeAll(true)
            optionTexts.length = 0
            panel.setData('inQuiz', false)
            ui.btnAtk.setVisible(false)
            ui.btnAtkBg.setVisible(false)
            ui.introTitle.setVisible(false)
            ui.battleMessage
              .setText('战斗失败，请回旅馆休息')
              .setColor('#ff9a9a')
              .setVisible(true)
            this.time.delayedCall(2800, () => {
              this.playerRpgHp = PLAYER_HP_MAX
              this.closeBattle()
            })
          } else {
            feedback
              .setText('答错了！玩家受到伤害')
              .setColor('#ff9a9a')
              .setVisible(true)
            this.time.delayedCall(450, () => {
              if (panel.getData('battleEnded')) return
              this.mountVocabQuiz(panel, refreshHpBars)
            })
          }
        }
      })

      quizLayer.add(rowBg)
      quizLayer.add(rowTxt)
      optionTexts.push(rowTxt)
    })
  }

  private openBattlePanel(root: Phaser.GameObjects.Container, cx: number, cy: number) {
    const panel = this.add.container(cx, cy)
    root.add(panel)

    panel.setData('monsterHp', MONSTER_HP_MAX)
    panel.setData('battleEnded', false)
    panel.setData('inQuiz', false)

    const bg = this.add
      .rectangle(0, 0, 560, 540, 0x1a2633)
      .setStrokeStyle(3, 0x5c7a9a)

    const quizLayer = this.add.container(0, 0).setVisible(false)
    const optionTexts: Phaser.GameObjects.Text[] = []

    const introTitle = this.add
      .text(0, -248, '野生言灵怪出现了！', {
        fontSize: '26px',
        color: '#f8f2dc',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0.5)

    const playerLabel = this.add
      .text(-252, -212, '玩家', {
        fontSize: '18px',
        color: '#c8ffe8',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0, 0.5)

    const monsterLabel = this.add
      .text(-252, -182, '言灵怪', {
        fontSize: '18px',
        color: '#ffd4c8',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0, 0.5)

    const barCenterX = 28
    const hpBarW = 220
    const hpBarH = 16
    const hpFillH = 11
    const hpInnerMax = hpBarW - 4

    const playerHpBarBg = this.add
      .rectangle(barCenterX, -212, hpBarW, hpBarH, 0x101820)
      .setStrokeStyle(2, 0x3a4a5a)

    const playerHpBarFill = this.add
      .rectangle(barCenterX - hpBarW / 2 + 2, -212, hpInnerMax, hpFillH, 0x50e070)
      .setOrigin(0, 0.5)

    const monsterHpBarBg = this.add
      .rectangle(barCenterX, -182, hpBarW, hpBarH, 0x101820)
      .setStrokeStyle(2, 0x5a3a3a)

    const monsterHpBarFill = this.add
      .rectangle(barCenterX - hpBarW / 2 + 2, -182, hpInnerMax, hpFillH, 0x50e070)
      .setOrigin(0, 0.5)

    const battleMessage = this.add
      .text(0, -132, '', {
        fontSize: '18px',
        color: '#fff8dc',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'center',
        wordWrap: { width: 500 }
      })
      .setOrigin(0.5)
      .setVisible(false)

    const refreshHpBars = () => {
      const pr = Math.max(0, Math.min(1, this.playerRpgHp / PLAYER_HP_MAX))
      const mh = Math.max(0, panel.getData('monsterHp') as number)
      const mr = Math.max(0, Math.min(1, mh / MONSTER_HP_MAX))
      playerHpBarFill.width = hpInnerMax * pr
      playerHpBarFill.setFillStyle(this.hpBarFillColor(pr))
      monsterHpBarFill.width = hpInnerMax * mr
      monsterHpBarFill.setFillStyle(this.hpBarFillColor(mr))
    }
    refreshHpBars()

    const btnAtkBg = this.add.rectangle(-108, 52, 172, 44, 0x355a72)
    const btnAtk = this.add
      .text(-108, 52, '普通攻击', {
        fontSize: '22px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    const btnFleeBg = this.add.rectangle(108, 52, 172, 44, 0x4a3d55)
    const btnFlee = this.add
      .text(108, 52, '逃跑', {
        fontSize: '22px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    btnFlee.on('pointerdown', () => this.closeBattle())

    const uiRefs: BattleUiRefs = {
      quizLayer,
      optionTexts,
      introTitle,
      playerHpBarBg,
      playerHpBarFill,
      monsterHpBarBg,
      monsterHpBarFill,
      battleMessage,
      btnAtkBg,
      btnAtk,
      btnFleeBg,
      btnFlee
    }
    panel.setData('battleUi', uiRefs)

    btnAtk.on('pointerdown', () => {
      if (panel.getData('battleEnded')) return
      if (panel.getData('inQuiz')) return
      panel.setData('inQuiz', true)
      introTitle.setVisible(false)
      btnAtk.setVisible(false)
      btnAtkBg.setVisible(false)
      btnFleeBg.setPosition(0, 220)
      btnFlee.setPosition(0, 220)
      btnFleeBg.setSize(260, 42)
      this.mountVocabQuiz(panel, refreshHpBars)
      quizLayer.setVisible(true)
    })

    panel.add([
      bg,
      quizLayer,
      introTitle,
      playerLabel,
      monsterLabel,
      playerHpBarBg,
      playerHpBarFill,
      monsterHpBarBg,
      monsterHpBarFill,
      battleMessage,
      btnAtkBg,
      btnAtk,
      btnFleeBg,
      btnFlee
    ])
  }

  create() {

    // 背景
    this.cameras.main.setBackgroundColor('#1d3b2f')

    this.createGrassAndRoads()

    // 玩家
    this.player = this.add.rectangle(400, 300, 40, 40, 0x00ff99).setDepth(15)

    // 键盘输入
    this.cursors = this.input.keyboard!.createCursorKeys()

    // 标题
    this.add
      .text(20, 20, '言灵RPG Demo', {
        fontSize: '32px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setDepth(20)

    const TREE_COUNT = 14
    const minDistSq = 95 * 95
    const minFromPlayerSq = 115 * 115
    const playerSpawnX = 400
    const playerSpawnY = 300
    const placed: { x: number; y: number }[] = []

    for (let i = 0; i < TREE_COUNT; i++) {
      let x = 640
      let y = 360
      for (let attempt = 0; attempt < 80; attempt++) {
        x = Phaser.Math.Between(60, 1220)
        y = Phaser.Math.Between(60, 660)
        const farFromPlayer =
          (x - playerSpawnX) ** 2 + (y - playerSpawnY) ** 2 >= minFromPlayerSq
        const farFromTrees = placed.every(
          (p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= minDistSq
        )
        if (farFromPlayer && farFromTrees) break
      }
      placed.push({ x, y })

      // 树干
      this.add.rectangle(x, y, 20, 40, 0x8b5a2b).setDepth(10)

      // 树叶
      this.add.circle(x, y - 30, 40, 0x2e8b57).setDepth(10)

      this.addTreeCollider(x, y)
    }
  }

  update() {
    const speed = 4

    let dx = 0
    let dy = 0
    if (!this.movementLocked) {
      if (this.cursors.left.isDown) dx -= speed
      if (this.cursors.right.isDown) dx += speed
      if (this.cursors.up.isDown) dy -= speed
      if (this.cursors.down.isDown) dy += speed
    }

    // 分轴移动：撞树则该轴回退，避免斜向穿模
    if (dx !== 0) {
      this.player.x += dx
      if (this.playerOverlapsAnyTree()) this.player.x -= dx
    }
    if (dy !== 0) {
      this.player.y += dy
      if (this.playerOverlapsAnyTree()) this.player.y -= dy
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 20, 1260)
    this.player.y = Phaser.Math.Clamp(this.player.y, 20, 700)

    // 草丛中移动：踩草动画 + 概率随机遇敌
    const moved = dx !== 0 || dy !== 0
    if (!this.movementLocked && moved && this.isPlayerInTallGrass()) {
      this.rustleNearbyGrass()
    }

    if (
      !this.movementLocked &&
      moved &&
      this.isPlayerInTallGrass() &&
      this.time.now >= this.encounterCooldownUntil &&
      Math.random() < 0.006
    ) {
      this.beginEncounterSequence()
      this.encounterCooldownUntil = this.time.now + 2000
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game-container',
  scene: MainScene
}

new Phaser.Game(config)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div id="game-container"></div>
  </React.StrictMode>,
)