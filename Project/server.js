require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const sqlitePool = require('./sqlite-pool');

const app = express();
const port = Number(process.env.PORT || 3000);

let sqliteInstance = null;
let useSqlite = false;

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_fitness_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

const pool = {
  async query(sql, params) {
    if (useSqlite) {
      return sqliteInstance.query(sql, params);
    }
    try {
      return await mysqlPool.query(sql, params);
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ER_ACCESS_DENIED_ERROR') {
        console.warn('MySQL connection failed, falling back to SQLite database:', err.message);
        useSqlite = true;
        sqliteInstance = sqlitePool.createPool();
        return sqliteInstance.query(sql, params);
      }
      throw err;
    }
  }
};

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'smart-fitness-tracker-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const publicUserFields = `
  id, name, email, age, gender, height_cm, weight_kg, goal,
  calorie_goal, protein_goal, water_goal_ml, created_at
`;

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedHash = '') => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const submittedHash = crypto.scryptSync(password, salt, 64);
  const savedHash = Buffer.from(hash, 'hex');
  return savedHash.length === submittedHash.length && crypto.timingSafeEqual(savedHash, submittedHash);
};

const requireUserId = (req, res) => {
  const userId = toNumber(req.session?.userId, 0);
  if (!userId) {
    res.status(401).json({ error: 'Please login first' });
    return null;
  }
  return userId;
};

const ensureAuthColumns = async () => {
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME IN ('email', 'password_hash')`
  );
  const existingColumns = new Set(columns.map((column) => column.COLUMN_NAME));

  if (!existingColumns.has('email')) {
    await pool.query('ALTER TABLE users ADD COLUMN email VARCHAR(191) NULL AFTER name');
  }

  if (!existingColumns.has('password_hash')) {
    await pool.query('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email');
  }

  await pool.query(
    `UPDATE users
     SET email = CONCAT('legacy', id, '@example.com')
     WHERE email IS NULL OR email = ''`
  );
  await pool.query(
    `UPDATE users
     SET password_hash = 'login-disabled-register-new-account'
     WHERE password_hash IS NULL OR password_hash = ''`
  );

  try {
    await pool.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }
};

app.get('/api/health', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ status: rows[0].ok === 1 ? 'ok' : 'error' });
}));

app.post('/api/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES (:name, :email, :password_hash)`,
    { name, email, password_hash: hashPassword(password) }
  );

  const [[user]] = await pool.query(`SELECT ${publicUserFields} FROM users WHERE id = ?`, [result.insertId]);
  req.session.userId = user.id;
  res.status(201).json({ user });
}));

app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  req.session.userId = user.id;
  delete user.password_hash;
  res.json({ user });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

app.get('/api/profile', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const [rows] = await pool.query(`SELECT ${publicUserFields} FROM users WHERE id = ?`, [userId]);
  res.json(rows[0] || null);
}));

app.post('/api/profile', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const profile = req.body;
  const payload = {
    name: profile.name || 'Demo User',
    age: profile.age || null,
    gender: profile.gender || null,
    height_cm: profile.height_cm || null,
    weight_kg: profile.weight_kg || null,
    goal: profile.goal || null,
    calorie_goal: profile.calorie_goal ? toNumber(profile.calorie_goal) : null,
    protein_goal: profile.protein_goal ? toNumber(profile.protein_goal) : null,
    water_goal_ml: profile.water_goal_ml ? toNumber(profile.water_goal_ml) : null
  };

  await pool.query(
    `UPDATE users
     SET name = :name, age = :age, gender = :gender, height_cm = :height_cm,
         weight_kg = :weight_kg, goal = :goal, calorie_goal = :calorie_goal,
         protein_goal = :protein_goal, water_goal_ml = :water_goal_ml
     WHERE id = :id`,
    { ...payload, id: userId }
  );
  res.json({ id: userId, ...payload });
}));

app.get('/api/summary', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const [[profile]] = await pool.query(`SELECT ${publicUserFields} FROM users WHERE id = ?`, [userId]);

  if (!profile) {
    res.json({ profile: null, totals: {}, meals: [], workouts: [], water: [] });
    return;
  }

  const [mealTotals] = await pool.query(
    `SELECT COALESCE(SUM(calories), 0) AS calories,
            COALESCE(SUM(protein_g), 0) AS protein,
            COALESCE(SUM(carbs_g), 0) AS carbs,
            COALESCE(SUM(fats_g), 0) AS fats
     FROM meals WHERE user_id = :userId AND meal_date = :date`,
    { userId: profile.id, date }
  );
  const [workoutTotals] = await pool.query(
    `SELECT COALESCE(SUM(duration_minutes), 0) AS minutes,
            COALESCE(SUM(calories_burned), 0) AS burned
     FROM workouts WHERE user_id = :userId AND workout_date = :date`,
    { userId: profile.id, date }
  );
  const [waterTotals] = await pool.query(
    `SELECT COALESCE(SUM(amount_ml), 0) AS water
     FROM water_logs WHERE user_id = :userId AND log_date = :date`,
    { userId: profile.id, date }
  );
  const [meals] = await pool.query(
    'SELECT * FROM meals WHERE user_id = :userId AND meal_date = :date ORDER BY created_at DESC',
    { userId: profile.id, date }
  );
  const [workouts] = await pool.query(
    'SELECT * FROM workouts WHERE user_id = :userId AND workout_date = :date ORDER BY created_at DESC',
    { userId: profile.id, date }
  );
  const [water] = await pool.query(
    'SELECT * FROM water_logs WHERE user_id = :userId AND log_date = :date ORDER BY created_at DESC',
    { userId: profile.id, date }
  );

  res.json({
    profile,
    date,
    totals: {
      ...mealTotals[0],
      ...workoutTotals[0],
      water: waterTotals[0].water,
      netCalories: toNumber(mealTotals[0].calories) - toNumber(workoutTotals[0].burned)
    },
    meals,
    workouts,
    water
  });
}));

app.post('/api/meals', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const item = req.body;
  const [result] = await pool.query(
    `INSERT INTO meals (user_id, meal_date, meal_type, food_name, calories, protein_g, carbs_g, fats_g)
     VALUES (:user_id, :meal_date, :meal_type, :food_name, :calories, :protein_g, :carbs_g, :fats_g)`,
    {
      user_id: userId,
      meal_date: item.meal_date,
      meal_type: item.meal_type,
      food_name: item.food_name,
      calories: toNumber(item.calories),
      protein_g: toNumber(item.protein_g),
      carbs_g: toNumber(item.carbs_g),
      fats_g: toNumber(item.fats_g)
    }
  );
  res.status(201).json({ id: result.insertId });
}));

app.post('/api/workouts', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const item = req.body;
  await pool.query(
    `INSERT INTO workouts (user_id, workout_date, activity, duration_minutes, calories_burned, intensity)
     VALUES (:user_id, :workout_date, :activity, :duration_minutes, :calories_burned, :intensity)`,
    {
      user_id: userId,
      workout_date: item.workout_date,
      activity: item.activity,
      duration_minutes: toNumber(item.duration_minutes),
      calories_burned: toNumber(item.calories_burned),
      intensity: item.intensity || 'Medium'
    }
  );
  res.status(201).json({ message: 'Workout saved' });
}));

app.post('/api/water', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  await pool.query(
    'INSERT INTO water_logs (user_id, log_date, amount_ml) VALUES (:user_id, :log_date, :amount_ml)',
    {
      user_id: userId,
      log_date: req.body.log_date,
      amount_ml: toNumber(req.body.amount_ml)
    }
  );
  res.status(201).json({ message: 'Water saved' });
}));

app.delete('/api/:type/:id', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const tableMap = { meals: 'meals', workouts: 'workouts', water: 'water_logs' };
  const table = tableMap[req.params.type];
  if (!table) {
    res.status(404).json({ error: 'Unknown resource' });
    return;
  }
  await pool.query(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [req.params.id, userId]);
  res.json({ message: 'Deleted' });
}));

const nutritionDict = {
  idli: { calories: 130, protein: 4, carbs: 28, fats: 1 },
  dosa: { calories: 168, protein: 3.9, carbs: 29, fats: 3.7 },
  avalakki: { calories: 110, protein: 2.5, carbs: 25, fats: 0.5 },
  poha: { calories: 110, protein: 2.5, carbs: 25, fats: 0.5 },
  paneer: { calories: 265, protein: 18, carbs: 1.2, fats: 20.8 },
  panneer: { calories: 265, protein: 18, carbs: 1.2, fats: 20.8 },
  "chicken breast": { calories: 165, protein: 31, carbs: 0, fats: 3.6 },
  chicken: { calories: 165, protein: 31, carbs: 0, fats: 3.6 },
  banana: { calories: 89, protein: 1.1, carbs: 22.8, fats: 0.3 },
  rice: { calories: 130, protein: 2.7, carbs: 28, fats: 0.3 },
  "white rice": { calories: 130, protein: 2.7, carbs: 28, fats: 0.3 },
  "brown rice": { calories: 111, protein: 2.6, carbs: 23, fats: 0.9 },
  roti: { calories: 264, protein: 9, carbs: 56, fats: 3 },
  chapati: { calories: 264, protein: 9, carbs: 56, fats: 3 },
  chapathi: { calories: 264, protein: 9, carbs: 56, fats: 3 },
  dal: { calories: 116, protein: 9, carbs: 20, fats: 0.4 },
  samosa: { calories: 262, protein: 3.5, carbs: 32, fats: 13 },
  egg: { calories: 155, protein: 13, carbs: 1.1, fats: 11 },
  "egg white": { calories: 52, protein: 11, carbs: 0.7, fats: 0.2 },
  oats: { calories: 389, protein: 16.9, carbs: 66.3, fats: 6.9 },
  "whey protein": { calories: 400, protein: 80, carbs: 6, fats: 6 },
  apple: { calories: 52, protein: 0.3, carbs: 13.8, fats: 0.2 },
  milk: { calories: 61, protein: 3.2, carbs: 4.8, fats: 3.3 },
  curd: { calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  curds: { calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  yogurt: { calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  upma: { calories: 180, protein: 4, carbs: 33, fats: 3.5 },
  almonds: { calories: 579, protein: 21.1, carbs: 21.6, fats: 49.9 },
  "peanut butter": { calories: 588, protein: 25, carbs: 20, fats: 50 },
  salmon: { calories: 208, protein: 20, carbs: 0, fats: 13 },
  biryani: { calories: 150, protein: 7, carbs: 19, fats: 5 },
  vada: { calories: 220, protein: 6, carbs: 24, fats: 12 },
  kichdi: { calories: 115, protein: 3.5, carbs: 21, fats: 2 },
  khichdi: { calories: 115, protein: 3.5, carbs: 21, fats: 2 }
};

app.get('/api/nutrition', asyncHandler(async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const query = req.query.query ? req.query.query.trim().toLowerCase() : '';
  if (!query) {
    res.status(400).json({ error: 'Query parameter is required' });
    return;
  }

  // 1. Look up in the local dictionary
  const exactMatch = nutritionDict[query];
  if (exactMatch) {
    res.json(exactMatch);
    return;
  }

  // Substring match
  const matchKey = Object.keys(nutritionDict).find(
    key => query.includes(key) || key.includes(query)
  );
  if (matchKey) {
    res.json(nutritionDict[matchKey]);
    return;
  }

  // 2. Open Food Facts API lookup (fallback)
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SmartFitnessTracker/1.0 (node-fetch)' }
    });
    if (response.ok) {
      const data = await response.json();
      const product = data.products?.find(p => p.nutriments && p.nutriments['energy-kcal_100g'] !== undefined);

      if (product) {
        const nut = product.nutriments;
        res.json({
          calories: Math.round(Number(nut['energy-kcal_100g'] || 0)),
          protein: Number((Number(nut['proteins_100g'] || 0)).toFixed(1)),
          carbs: Number((Number(nut['carbohydrates_100g'] || 0)).toFixed(1)),
          fats: Number((Number(nut['fat_100g'] || 0)).toFixed(1))
        });
        return;
      }
    }
  } catch (err) {
    console.error('Error fetching from Open Food Facts API:', err.message);
  }

  res.status(404).json({ error: 'Nutrition data not found' });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error', details: err.message });
});

let server;

const keepAlive = setInterval(() => {}, 60 * 60 * 1000);

process.on('SIGTERM', () => {
  clearInterval(keepAlive);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
});

ensureAuthColumns()
  .then(() => {
    server = app.listen(port, () => {
      console.log(`Smart tracker running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    clearInterval(keepAlive);
    console.error('Database setup failed:', error.message);
    process.exit(1);
  });
