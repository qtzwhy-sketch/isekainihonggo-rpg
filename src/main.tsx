import React from 'react'
import ReactDOM from 'react-dom/client'
import Phaser from 'phaser'

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a1a',
  scene: {
    create: create
  }
}

function create() {
  this.add.text(500, 300, '言灵RPG', {
    fontSize: '48px',
    color: '#ffffff'
  })
}

new Phaser.Game(config)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div id="game-container"></div>
  </React.StrictMode>,
)