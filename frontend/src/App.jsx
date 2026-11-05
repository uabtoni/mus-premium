import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import GameTable from './GameTable'
import MainMenu from './MainMenu'
import './App.css'

const socket = io('http://localhost:3000');

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [username, setUsername] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [inGame, setInGame] = useState(false);

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('login_success', (userData) => {
      setUserProfile(userData);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('login_success');
    };
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim() === '') return;
    socket.emit('login_user', username.trim());
  };

  const handleLogout = () => {
    setUserProfile(null);
    setUsername('');
    setInGame(false);
  };

  // 1. Si no hay perfil, mostramos el Login
  if (!userProfile) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>MUS PREMIUM</h1>
          <p>Edición Noche de Casino</p>
          
          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>NOMBRE DE USUARIO / APODO</label>
              <input 
                type="text" 
                placeholder="Ej. Tekko" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary">ENTRAR AL CLUB</button>
          </form>

          <div className="server-status">
            Estado del Servidor: {isConnected ? <span style={{ color: '#4caf50' }}>🟢 Online</span> : <span style={{ color: '#f44336' }}>🔴 Desconectado</span>}
          </div>
        </div>
      </div>
    );
  }

  // 2. Si hay perfil pero NO ha entrado a partida, mostramos el Menú Principal
  if (!inGame) {
    return (
      <MainMenu 
        userProfile={userProfile} 
        onPlay={() => setInGame(true)} 
        onLogout={handleLogout} 
      />
    );
  }

  // 3. Si ha pulsado en jugar, mostramos el Tapete de Juego
  return (
    <GameTable 
      userProfile={userProfile} 
      onLeave={() => setInGame(false)} 
    />
  );
}

export default App