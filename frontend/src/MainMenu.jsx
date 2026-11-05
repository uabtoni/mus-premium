import React from 'react';
import './MainMenu.css';

export default function MainMenu({ userProfile, onPlay, onLogout }) {
  return (
    <div className="lobby-container">
      {/* Barra de Navegación Superior */}
      <nav className="lobby-navbar">
        <div className="lobby-logo">MUS PREMIUM</div>
        <div className="lobby-stats">
          <span>💰 {userProfile.coins}</span>
          <span>💎 {userProfile.gems}</span>
          <div className="avatar-circle">
            {userProfile.username.charAt(0).toUpperCase()}
          </div>
        </div>
      </nav>

      <div className="lobby-content">
        {/* Menú Lateral */}
        <aside className="lobby-sidebar">
          <ul>
            <li className="active">🏠 Inicio</li>
            <li>👤 Mi Perfil</li>
            <li>👥 Lista de Amigos</li>
            <li>🏆 Clasificación</li>
            <li>⚙️ Ajustes</li>
            <li style={{ marginTop: 'auto', color: '#e74c3c' }} onClick={onLogout}>
              🚪 Cerrar Sesión
            </li>
          </ul>
        </aside>

        {/* Área Central: Selección de Modos de Juego */}
        <main className="lobby-main">
          <h1>Bienvenido al Club, {userProfile.username}</h1>
          
          <div className="modes-grid">
            <div className="mode-card primary" onClick={onPlay}>
              <h2>PARTIDA RÁPIDA</h2>
              <p>Únete a una mesa pública y juega al instante con otros jugadores.</p>
              <span className="entry-fee">Entrada: 100 💰</span>
            </div>

            <div className="mode-card" onClick={() => alert('Próximamente: Mesas Privadas')}>
              <h2 style={{color: '#fff'}}>MESA PRIVADA</h2>
              <p>Crea una sala con contraseña para jugar exclusivamente con tus amigos.</p>
              <span className="entry-fee">Gratis</span>
            </div>

            <div className="mode-card" onClick={() => alert('Próximamente: Torneos')}>
              <h2 style={{color: '#fff'}}>TORNEO VIP</h2>
              <p>Compite en llaves eliminatorias por el gran bote del fin de semana.</p>
              <span className="entry-fee">Entrada: 500 💰</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}