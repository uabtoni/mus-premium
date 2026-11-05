const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Configuración de la conexión a PostgreSQL (Asegúrate de ajustar usuario/contraseña si es necesario)
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'mus_premium',
  password: 'admin', // Cambia esto por tu contraseña local de postgres si tienes una
  port: 5432,
});

// Comprobar conexión a la base de datos y crear tabla inicial de usuarios
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error al conectar a PostgreSQL:', err.stack);
  } else {
    console.log('🟢 Conectado correctamente a la base de datos PostgreSQL');
    release();
    
    // Crear tabla de usuarios si no existe
    client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        coins INT DEFAULT 1000,
        gems INT DEFAULT 50,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `, (err) => {
      if (err) console.error('Error creando tabla users:', err);
      else console.log('📁 Tabla "users" verificada/creada correctamente.');
    });
  }
});

// Configuración de Socket.io
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`🟢 Nuevo jugador conectado: ${socket.id}`);

  // Evento cuando un usuario se registra o inicia sesión desde el cliente
  socket.on('login_user', async (username) => {
    try {
      // Buscar si el usuario ya existe en la base de datos
      let result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      
      let user;
      if (result.rows.length === 0) {
        // Si no existe, lo creamos con 1000 monedas y 50 gemas de regalo de bienvenida
        const insertResult = await pool.query(
          'INSERT INTO users (username, coins, gems) VALUES ($1, 1000, 50) RETURNING *',
          [username]
        );
        user = insertResult.rows[0];
        console.log(`✨ Nuevo usuario registrado en BD: ${user.username}`);
      } else {
        user = result.rows[0];
        console.log(`👋 Usuario existente reconectado: ${user.username}`);
      }

      // Devolver los datos del usuario al cliente
      socket.emit('login_success', user);
    } catch (error) {
      console.error('Error en el login_user:', error);
      socket.emit('login_error', 'Error interno en el servidor');
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Jugador desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor de Mus Premium corriendo en el puerto ${PORT}`);
});