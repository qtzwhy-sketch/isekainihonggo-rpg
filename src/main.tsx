import React from 'react'
import ReactDOM from 'react-dom/client'
import Phaser from 'phaser'
import { vocabulary, type VocabularyItem } from './data/vocabulary'
import { generateQuestion, type GeneratedQuestion } from './utils/questionGenerator'
import slime1Url from './assets/slime1.png'
import slime2Url from './assets/slime2.png'
import crowUrl from './assets/crow.png'
import heroUrl from "./assets/player/hero.png";

type EnemyType = 'slime' | 'crow'

/** 言灵乌鸦：外来语临时题库（至少 4 条供四选一） */
const CROW_VOCABULARY: VocabularyItem[] = [
  { id: 1001, word: 'コンピュータ', reading: 'こんぴゅーた', meaning: '电脑', level: 'N5' },
  { id: 1002, word: 'レストラン', reading: 'れすとらん', meaning: '餐厅', level: 'N5' },
  { id: 1003, word: 'カメラ', reading: 'かめら', meaning: '相机', level: 'N5' },
  { id: 1004, word: 'アイス', reading: 'あいす', meaning: '冰淇淋', level: 'N5' },
  { id: 1005, word: 'ホテル', reading: 'ほてる', meaning: '酒店', level: 'N5' },
  { id: 1006, word: 'タクシー', reading: 'たくしー', meaning: '出租车', level: 'N5' }
]

const PLAYER_HP_MAX = 100
const MONSTER_HP_MAX = 100
/** 第1层 Boss 比言灵怪多出的 HP（总 HP = 100 + 50） */
const BOSS_LAYER1_EXTRA_HP = 50
const BOSS_LAYER1_NAME = '尼德霍格'
const MASTERED_VOCAB_FOR_BOSS_HINT = 5
const DMG_ON_CORRECT = 30
const DMG_ON_WRONG = 20

/** 有史莱姆时题目/选项整体下移（史莱姆单独挂在 battleRoot 上，不在 panel 内） */
const QUIZ_LAYOUT_WITH_SLIME = { qTextY: -100, optionCentersY: [-8, 42, 92, 142] as const }
const QUIZ_LAYOUT_NO_SLIME = { qTextY: -178, optionCentersY: [-95, -45, 5, 55] as const }

type BattleUiRefs = {
  quizLayer: Phaser.GameObjects.Container
  optionTexts: Phaser.GameObjects.Text[]
  introTitle: Phaser.GameObjects.Text
  playerStatsHud: Phaser.GameObjects.Text
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
  player!: Phaser.GameObjects.Image
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
  /** 普通言灵战史莱姆（挂在 battleRoot 上，随战斗关闭销毁） */
  private monsterSprite?: Phaser.GameObjects.Image
  /** 草丛内单株草叶（用于踩草动画） */
  private grassBlades: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse)[] = []
  /** 大地图玩家 HP（战斗外仍保留；战败后关闭战斗不自动回满） */
  private playerRpgHp = PLAYER_HP_MAX
  /** 灵石（战斗胜利奖励累计） */
  private spiritStones = 0
  /** 战胜言灵怪累计「掌握词汇」次数（内存） */
  private masteredVocab = 0
  private playerLevel = 1
  private playerExp = 0
  private expToNextLevel = 100
  /** 大地图左上角角色状态 */
  private mapPlayerHud?: Phaser.GameObjects.Text
  /**
   * 错题本：key 为 vocabulary id，值为词条信息与累计答错次数（用于复仇怪抽题）
   */
  private wrongWords = new Map<
    number,
    { word: string; reading: string; meaning: string; wrongCount: number }
  >()
  /** 是否已击败第1层 Boss（封印解除，仅提示用） */
  private layer1BossDefeated = false
  /** 地图上 Boss 解锁提示文案 */
  private bossUnlockHint?: Phaser.GameObjects.Text
  private keyBossChallenge?: Phaser.Input.Keyboard.Key
  /** 当前普通战敌人类型（Boss 战不使用） */
  private currentEnemyType: EnemyType = 'slime'

  constructor() {
    super('main')
  }

  preload() {
    this.load.image("slime1", slime1Url);
    this.load.image("slime2", slime2Url);
    this.load.image("crow", crowUrl);
    this.load.image("hero", heroUrl);
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
    this.monsterSprite = undefined
    this.movementLocked = false
    this.refreshBossUnlockHint()
  }

  /** 掌握词汇达阈值且未击败 Boss 时显示地图提示 */
  private refreshBossUnlockHint() {
    if (!this.bossUnlockHint) return
    const unlocked =
      this.masteredVocab >= MASTERED_VOCAB_FOR_BOSS_HINT && !this.layer1BossDefeated
    this.bossUnlockHint.setVisible(unlocked)
    if (unlocked) {
      this.bossUnlockHint.setText(
        '你已掌握足够言灵，可以挑战第1层Boss：尼德霍格（按 B 键）'
      )
    }
  }

  /** 柔和双闪 → 压暗 → 战斗弹窗；遇敌后锁定移动，逃跑解除 */
  private beginEncounterSequence(isBoss = false) {
    if (this.movementLocked) return
    this.movementLocked = true

    if (!isBoss) {
      this.currentEnemyType = Math.random() < 0.7 ? 'slime' : 'crow'
    }

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
        onComplete: () => this.openBattlePanel(root, cx, cy, isBoss)
      })
    }

    softFlash(0.075, () => {
      this.time.delayedCall(110, () => {
        softFlash(0.065, () => afterFlashes())
      })
    })
  }

  /** 玩家 HP 填充色（随比例略变，保持绿色系） */
  private playerHpFillColor(ratio: number): number {
    if (ratio > 0.55) return 0x4ae082
    if (ratio > 0.25) return 0x38c96c
    return 0x24a858
  }

  /** 言灵怪 HP 填充色（随比例略变，保持红/橙红系） */
  private monsterHpFillColor(ratio: number): number {
    if (ratio > 0.55) return 0xff6b4a
    if (ratio > 0.25) return 0xff5533
    return 0xe83820
  }

  private getBattleVocabulary(): VocabularyItem[] {
    return this.currentEnemyType === 'crow' ? CROW_VOCABULARY : vocabulary
  }

  private findVocabEntry(targetId: number): VocabularyItem | undefined {
    return vocabulary.find((v) => v.id === targetId) ?? CROW_VOCABULARY.find((v) => v.id === targetId)
  }

  private enemyDamageHint(): string {
    return this.currentEnemyType === 'crow' ? '言灵乌鸦受到伤害！' : '言灵怪受到伤害！'
  }

  /** 下一题：史莱姆战 40% 错题复仇；乌鸦战仅用外来语题库 */
  private pickNextQuestion(): { question: GeneratedQuestion; fromRevenge: boolean } {
    const battleVocab = this.getBattleVocabulary()
    if (this.currentEnemyType === 'slime') {
      const pool = [...this.wrongWords.entries()].filter(([, r]) => r.wrongCount > 0)
      if (pool.length > 0 && Math.random() < 0.4) {
        const picked = Phaser.Math.RND.pick(pool)
        const target = vocabulary.find((v) => v.id === picked[0])
        if (target) {
          return { question: generateQuestion(vocabulary, { target }), fromRevenge: true }
        }
      }
    }
    return { question: generateQuestion(battleVocab), fromRevenge: false }
  }

  private enqueueNextBattleQuestion(panel: Phaser.GameObjects.Container) {
    const { question, fromRevenge } = this.pickNextQuestion()
    panel.setData('currentQuestion', question)
    panel.setData('fromRevenge', fromRevenge)
  }

  private registerWrongAnswer(targetId: number) {
    const v = this.findVocabEntry(targetId)
    if (!v) return
    const prev = this.wrongWords.get(targetId)
    if (prev) prev.wrongCount += 1
    else this.wrongWords.set(targetId, { word: v.word, reading: v.reading, meaning: v.meaning, wrongCount: 1 })
  }

  /** 答对复仇怪题目：错题计数 -1，归零则移除 */
  private applyRevengeCorrect(targetId: number) {
    const rec = this.wrongWords.get(targetId)
    if (!rec) return
    rec.wrongCount -= 1
    if (rec.wrongCount <= 0) this.wrongWords.delete(targetId)
  }

  private formatPlayerStatsLines(): string {
    return (
      `等级: ${this.playerLevel}\n` +
      `EXP: ${this.playerExp} / ${this.expToNextLevel}\n` +
      `灵石: ${this.spiritStones}\n` +
      `掌握词汇: ${this.masteredVocab}`
    )
  }

  private refreshPlayerStatsHud(panel?: Phaser.GameObjects.Container) {
    const text = this.formatPlayerStatsLines()
    this.mapPlayerHud?.setText(text)
    if (panel) {
      const ui = panel.getData('battleUi') as BattleUiRefs | undefined
      ui?.playerStatsHud?.setText(text)
    }
  }

  /** 战斗胜利 EXP；升级时回满 HP，返回是否发生升级 */
  private applyBattleVictoryExp(): boolean {
    this.playerExp += 10
    let leveledUp = false
    while (this.playerExp >= this.expToNextLevel) {
      this.playerLevel += 1
      this.playerExp -= this.expToNextLevel
      this.playerRpgHp = PLAYER_HP_MAX
      leveledUp = true
    }
    return leveledUp
  }

  /** 答对：史莱姆左右抖动 + 短暂受击变色（无 sprite 时跳过） */
  private playMonsterHitFeedback() {
    const s = this.monsterSprite
    if (!s || !s.active) return
    const baseX = s.x
    this.tweens.add({
      targets: s,
      x: baseX + 10,
      duration: 50,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        if (s.active) s.setX(baseX)
      }
    })
    s.setTint(0xff6666)
    this.time.delayedCall(200, () => {
      this.monsterSprite?.clearTint()
    })
  }

  /** 答错：镜头轻震 + 战斗面板抖动，表示玩家受击 */
  private playPlayerHitFeedback(panel: Phaser.GameObjects.Container) {
    this.cameras.main.shake(150, 0.005)
    const px = panel.x
    this.tweens.add({
      targets: panel,
      x: px + 8,
      duration: 50,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        if (panel.active) panel.setX(px)
      }
    })
    const redFx = this.add
      .rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0xff0000, 0.18)
      .setScrollFactor(0)
      .setDepth(5100)
    this.tweens.add({
      targets: redFx,
      alpha: 0,
      duration: 140,
      onComplete: () => redFx.destroy()
    })
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

    const isBossBattle = panel.getData('isBoss') as boolean
    const hasSlimePortrait = !isBossBattle && !!this.monsterSprite
    const layout = hasSlimePortrait ? QUIZ_LAYOUT_WITH_SLIME : QUIZ_LAYOUT_NO_SLIME

    const currentQuestion = panel.getData('currentQuestion') as GeneratedQuestion
    const fromRevenge = panel.getData('fromRevenge') as boolean
    const promptDisplay = fromRevenge
      ? `复仇怪出现了！\n\n${currentQuestion.prompt}`
      : currentQuestion.prompt
    const optW = 440
    const optH = 40
    const optCentersY = [...layout.optionCentersY]

    const qText = this.add
      .text(-265, layout.qTextY, promptDisplay, {
        fontSize: '19px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, Meiryo, Hiragino Sans, sans-serif',
        align: 'left',
        wordWrap: { width: 510 }
      })
      .setOrigin(0, 0)
    quizLayer.add(qText)

    const feedbackY = qText.y + qText.height + 10
    const feedback = this.add
      .text(-265, feedbackY, '', {
        fontSize: '16px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'left',
        wordWrap: { width: 520 },
        lineSpacing: 6
      })
      .setOrigin(0, 0)
      .setVisible(false)
    quizLayer.add(feedback)

    const continueHint = this.add
      .text(-265, 0, '点击继续', {
        fontSize: '17px',
        color: '#ffdd88',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'left'
      })
      .setOrigin(0, 0)
      .setVisible(false)
    quizLayer.add(continueHint)

    const quizRows: {
      bg: Phaser.GameObjects.Rectangle
      txt: Phaser.GameObjects.Text
    }[] = []

    let answered = false

    const hideQuizRows = () => {
      quizRows.forEach((r) => {
        r.bg.setVisible(false)
        r.txt.setVisible(false)
      })
    }

    currentQuestion.options.forEach((label, i) => {
      const rowBg = this.add
        .rectangle(0, optCentersY[i], optW, optH, 0x243040)
        .setStrokeStyle(2, 0x8aa4c8)
      const rowTxt = this.add
        .text(0, optCentersY[i], label, {
          fontSize: '18px',
          color: '#ffffff',
          fontFamily: 'Microsoft YaHei, Meiryo, sans-serif',
          align: 'center',
          wordWrap: { width: optW - 24 }
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })

      quizRows.push({ bg: rowBg, txt: rowTxt })

      rowTxt.on('pointerdown', () => {
        if (answered || panel.getData('battleEnded')) return
        answered = true
        optionTexts.forEach((t) => t.disableInteractive())

        const selectedChoice = label
        if (selectedChoice === currentQuestion.answer) {
          let mon = (panel.getData('monsterHp') as number) - DMG_ON_CORRECT
          if (mon < 0) mon = 0
          panel.setData('monsterHp', mon)
          refreshHpBars()
          this.playMonsterHitFeedback()

          if (mon <= 0) {
            if (fromRevenge) {
              this.applyRevengeCorrect(currentQuestion.targetId)
            }
            if (isBossBattle) {
              this.layer1BossDefeated = true
            }
            panel.setData('battleEnded', true)
            quizLayer.setVisible(false)
            quizLayer.removeAll(true)
            optionTexts.length = 0
            panel.setData('inQuiz', false)
            ui.btnAtk.setVisible(false)
            ui.btnAtkBg.setVisible(false)
            ui.introTitle.setVisible(false)
            this.spiritStones += 1
            this.masteredVocab += 1
            const leveledUp = this.applyBattleVictoryExp()
            let victoryText = isBossBattle
              ? '第1层封印解除！\n\n战斗胜利！\n\n获得灵石 x1\n掌握词汇 +1\nEXP +10'
              : '战斗胜利！\n\n获得灵石 x1\n掌握词汇 +1\nEXP +10'
            if (leveledUp) victoryText += '\n\nLEVEL UP!'
            ui.battleMessage.setText(victoryText).setColor('#ffffff').setVisible(true)
            this.refreshPlayerStatsHud(panel)
            this.refreshBossUnlockHint()
            this.time.delayedCall(2600, () => this.closeBattle())
          } else {
            if (fromRevenge) {
              this.applyRevengeCorrect(currentQuestion.targetId)
            }
            hideQuizRows()
            feedback
              .setText(
                isBossBattle
                  ? '✔ 正确！\n\n尼德霍格受到伤害！'
                  : `✔ 正确！\n\n${this.enemyDamageHint()}`
              )
              .setColor('#55ee99')
              .setVisible(true)
            this.time.delayedCall(1000, () => {
              if (panel.getData('battleEnded')) return
              this.enqueueNextBattleQuestion(panel)
              this.mountVocabQuiz(panel, refreshHpBars)
            })
          }
        } else {
          this.registerWrongAnswer(currentQuestion.targetId)
          this.playerRpgHp = Math.max(0, this.playerRpgHp - DMG_ON_WRONG)
          refreshHpBars()
          this.playPlayerHitFeedback(panel)

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
              .setColor('#ffffff')
              .setVisible(true)
            this.time.delayedCall(2800, () => {
              this.playerRpgHp = PLAYER_HP_MAX
              this.closeBattle()
            })
          } else {
            const target = this.findVocabEntry(currentQuestion.targetId)
            let wrongBody =
              '✖ 错误！\n\n' +
              (target
                ? `单词：${target.word}（${target.reading}）\n`
                : '') +
              `正确答案：${currentQuestion.answer}\n` +
              `意思：${target?.meaning ?? '—'}`
            if (target?.example) {
              wrongBody += `\n例句：${target.example}`
            }
            wrongBody += '\n\n玩家受到伤害！'

            hideQuizRows()
            feedback.setText(wrongBody).setColor('#ff6b6b').setVisible(true)
            continueHint
              .setY(feedback.y + feedback.height + 14)
              .setVisible(true)
              .setInteractive({ useHandCursor: true })
            continueHint.once('pointerdown', () => {
              if (panel.getData('battleEnded')) return
              continueHint.disableInteractive()
              this.enqueueNextBattleQuestion(panel)
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

  private openBattlePanel(
    root: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    isBoss = false
  ) {
    const panel = this.add.container(cx, cy)
    root.add(panel)

    this.monsterSprite?.destroy()
    this.monsterSprite = undefined

    const monsterHpMax = isBoss ? MONSTER_HP_MAX + BOSS_LAYER1_EXTRA_HP : MONSTER_HP_MAX
    panel.setData('monsterHp', monsterHpMax)
    panel.setData('monsterHpMax', monsterHpMax)
    panel.setData('isBoss', isBoss)
    panel.setData('battleEnded', false)
    panel.setData('inQuiz', false)
    this.enqueueNextBattleQuestion(panel)

    const panelW = 580
    const panelH = 640
    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x1a2633)
      .setStrokeStyle(3, 0x5c7a9a)

    const quizLayer = this.add.container(0, 0).setVisible(false)
    const optionTexts: Phaser.GameObjects.Text[] = []

    const titleY = -298
    const hudPad = 14
    const playerStatsHud = this.add
      .text(-panelW / 2 + hudPad, -panelH / 2 + hudPad, '', {
        fontSize: '15px',
        color: '#c8e6ff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'left',
        lineSpacing: 4
      })
      .setOrigin(0, 0)

    const introTitle = this.add
      .text(
        0,
        titleY,
        isBoss
          ? `${BOSS_LAYER1_NAME}出现了！`
          : this.currentEnemyType === 'crow'
            ? '言灵乌鸦出现了！'
            : '野生言灵怪出现了！',
        {
        fontSize: '26px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0.5)

    const nameLeft = -168
    const nameReservedW = 96
    const gapNameToBar = 22
    const barLeft = nameLeft + nameReservedW + gapNameToBar
    const hpBarW = 260
    const barCenterX = barLeft + hpBarW / 2

    const playerRowY = -248
    const monsterRowY = playerRowY + 32

    const hpBarH = 16
    const hpFillH = 11
    const hpInnerMax = hpBarW - 4

    const hpBarBgColor = 0x2a2a32
    const hpBarStrokeLight = 0xc8d4e8

    const playerLabel = this.add
      .text(nameLeft, playerRowY, '玩家', {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0, 0.5)

    const monsterLabel = this.add
      .text(
        nameLeft,
        monsterRowY,
        isBoss
          ? BOSS_LAYER1_NAME
          : this.currentEnemyType === 'crow'
            ? '言灵乌鸦'
            : '言灵怪',
        {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0, 0.5)

    const playerHpBarBg = this.add
      .rectangle(barCenterX, playerRowY, hpBarW, hpBarH, hpBarBgColor)
      .setStrokeStyle(2, hpBarStrokeLight)

    const playerHpBarFill = this.add
      .rectangle(barLeft + 2, playerRowY, hpInnerMax, hpFillH, 0x4ae082)
      .setOrigin(0, 0.5)

    const monsterHpBarBg = this.add
      .rectangle(barCenterX, monsterRowY, hpBarW, hpBarH, hpBarBgColor)
      .setStrokeStyle(2, hpBarStrokeLight)

    const monsterHpBarFill = this.add
      .rectangle(barLeft + 2, monsterRowY, hpInnerMax, hpFillH, 0xff6b4a)
      .setOrigin(0, 0.5)

    if (!isBoss) {
      if (this.currentEnemyType === 'crow') {
        this.monsterSprite = this.add
          .image(650, 220, 'crow')
          .setOrigin(0.5, 0.5)
          .setDisplaySize(140, 140)
          .setDepth(20)
      } else {
        const slimeKey = Math.random() < 0.5 ? 'slime1' : 'slime2'
        this.monsterSprite = this.add
          .image(650, 220, slimeKey)
          .setOrigin(0.5, 0.5)
          .setDisplaySize(120, 120)
          .setDepth(20)
      }
      root.add(this.monsterSprite)
    }

    const battleMessage = this.add
      .text(0, -40, '', {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'center',
        wordWrap: { width: 520 }
      })
      .setOrigin(0.5)
      .setVisible(false)

    const refreshHpBars = () => {
      const pr = Math.max(0, Math.min(1, this.playerRpgHp / PLAYER_HP_MAX))
      const mh = Math.max(0, panel.getData('monsterHp') as number)
      const monsterHpMax = (panel.getData('monsterHpMax') as number) ?? MONSTER_HP_MAX
      const mr = Math.max(0, Math.min(1, mh / monsterHpMax))
      playerHpBarFill.width = hpInnerMax * pr
      playerHpBarFill.setFillStyle(this.playerHpFillColor(pr))
      monsterHpBarFill.width = hpInnerMax * mr
      monsterHpBarFill.setFillStyle(this.monsterHpFillColor(mr))
    }
    refreshHpBars()

    const introBtnY = 258
    const introBtnW = 200
    const introBtnH = 44
    const btnAtkBg = this.add
      .rectangle(-122, introBtnY, introBtnW, introBtnH, 0x355a72)
      .setStrokeStyle(2, 0xa8c4e8)
    const btnAtk = this.add
      .text(-122, introBtnY, '普通攻击', {
        fontSize: '22px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })

    const btnFleeBg = this.add
      .rectangle(122, introBtnY, introBtnW, introBtnH, 0x4a3d55)
      .setStrokeStyle(2, 0xd0a8c8)
    const btnFlee = this.add
      .text(122, introBtnY, '逃跑', {
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
      playerStatsHud,
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
    this.refreshPlayerStatsHud(panel)

    btnAtk.on('pointerdown', () => {
      if (panel.getData('battleEnded')) return
      if (panel.getData('inQuiz')) return
      panel.setData('inQuiz', true)
      btnAtk.setVisible(false)
      btnAtkBg.setVisible(false)
      const fleeQuizY = 278
      btnFleeBg.setPosition(0, fleeQuizY)
      btnFlee.setPosition(0, fleeQuizY)
      btnFleeBg.setSize(280, 44)
      this.mountVocabQuiz(panel, refreshHpBars)
      quizLayer.setVisible(true)
    })

    panel.add([
      bg,
      playerStatsHud,
      introTitle,
      playerHpBarBg,
      playerHpBarFill,
      monsterHpBarBg,
      monsterHpBarFill,
      playerLabel,
      monsterLabel,
      quizLayer,
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

    this.player = this.add
      .image(400, 300, 'hero')
      .setDisplaySize(64, 64)
      .setDepth(10)

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.keyBossChallenge = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B)

    // 标题
    this.add
      .text(20, 20, '言灵RPG Demo', {
        fontSize: '32px',
        color: '#ffffff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif'
      })
      .setDepth(20)

    this.mapPlayerHud = this.add
      .text(20, 58, '', {
        fontSize: '16px',
        color: '#c8e6ff',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        align: 'left',
        lineSpacing: 4
      })
      .setOrigin(0, 0)
      .setDepth(20)
    this.refreshPlayerStatsHud()

    this.bossUnlockHint = this.add
      .text(20, 132, '', {
        fontSize: '16px',
        color: '#ffd88a',
        fontFamily: 'Microsoft YaHei, SimHei, sans-serif',
        wordWrap: { width: 1180 }
      })
      .setDepth(20)
      .setVisible(false)
    this.refreshBossUnlockHint()

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
      this.beginEncounterSequence(false)
      this.encounterCooldownUntil = this.time.now + 2000
    }

    if (
      this.keyBossChallenge &&
      Phaser.Input.Keyboard.JustDown(this.keyBossChallenge) &&
      !this.movementLocked &&
      !this.battleRoot &&
      this.masteredVocab >= MASTERED_VOCAB_FOR_BOSS_HINT &&
      !this.layer1BossDefeated
    ) {
      this.beginEncounterSequence(true)
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