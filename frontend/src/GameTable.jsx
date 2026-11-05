import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import './GameTable.css';

export default function GameTable({ userProfile, onLeave }) {
  const gameRef = useRef(null);

  useEffect(() => {
    // Phaser ahora es TRANSPARENTE. Solo renderizará cartas encima del HTML.
    const config = {
      type: Phaser.AUTO,
      parent: gameRef.current,
      transparent: true, 
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 950,
        height: 500
      },
      scene: {
        preload: preload,
        create: create
      }
    };

    const game = new Phaser.Game(config);

    function preload() {
      // Las cartas se cargarán aquí
    }

    function create() {
      // De momento Phaser no dibuja nada de UI, lo hace React con CSS.
      // Aquí pondremos la lógica de las cartas.
    }

    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div className="casino-room">
      
      {/* HUD Superior */}
      <div className="top-hud">
        <div style={{ fontSize: '1.2rem' }}>
          💰 <strong>{userProfile.coins}</strong>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '8px 20px', margin: 0 }} onClick={onLeave}>
          SALIR DE LA MESA
        </button>
      </div>

      {/* La Mesa de Juego */}
      <div className="table-wrapper">
        <div className="table-felt">
          
          {/* Logo central en el tapete */}
          <div className="table-logo">
            <h2>MUS PREMIUM</h2>
            <p style={{ color: '#888', letterSpacing: '1px' }}>ESPERANDO JUGADORES...</p>
          </div>

          {/* Phaser Canvas Transparente para las Cartas */}
          <div ref={gameRef} className="phaser-container" />

          {/* Placas de Jugadores (HTML/CSS Puro para máxima calidad) */}
          <div className="player-pod pod-bottom">
            <p className="player-name">{userProfile.username.toUpperCase()}</p>
            <p className="player-role">Tú</p>
          </div>

          <div className="player-pod pod-top">
            <p className="player-name">ESPERANDO...</p>
            <p className="player-role">Compañero</p>
          </div>

          <div className="player-pod pod-left">
            <p className="player-name">ESPERANDO...</p>
            <p className="player-role">Rival 1</p>
          </div>

          <div className="player-pod pod-right">
            <p className="player-name">ESPERANDO...</p>
            <p className="player-role">Rival 2</p>
          </div>

        </div>
      </div>
    </div>
  );
}