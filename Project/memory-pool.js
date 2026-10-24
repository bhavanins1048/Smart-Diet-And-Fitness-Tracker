const fs = require('fs');
const path = require('path');

class MemoryPool {
  constructor(filePath) {
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    this.filePath = filePath || (isServerless ? path.join('/tmp', 'fitness_data.json') : path.join(__dirname, 'db', 'fitness_data.json'));
    this.data = {
      users: [],
      meals: [],
      workouts: [],
      water_logs: []
    };
    this.autoInc = {
      users: 0,
      meals: 0,
      workouts: 0,
      water_logs: 0
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.data) this.data = parsed.data;
        if (parsed.autoInc) this.autoInc = parsed.autoInc;
      }
    } catch (e) {
      console.warn('MemoryPool load warning:', e.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ data: this.data, autoInc: this.autoInc }, null, 2));
    } catch (e) {
      console.warn('MemoryPool save warning:', e.message);
    }
  }

  sanitizeUser(u) {
    if (!u) return null;
    const { password_hash, ...rest } = u;
    return rest;
  }

  async query(sql, params = {}) {
    const clean = sql.trim();
    const upper = clean.toUpperCase();

    // 1. Health check
    if (upper.includes('SELECT 1 AS OK') || upper === 'SELECT 1') {
      return [[{ ok: 1 }], []];
    }

    // 2. Auth columns migration check
    if (upper.includes('INFORMATION_SCHEMA.COLUMNS')) {
      return [[{ COLUMN_NAME: 'email' }, { COLUMN_NAME: 'password_hash' }], []];
    }

    // 3. Schema migrations (ALTER TABLE / ADD UNIQUE / etc.)
    if (upper.startsWith('ALTER TABLE') || upper.startsWith('CREATE UNIQUE INDEX') || upper.startsWith('CREATE TABLE')) {
      return [{ affectedRows: 0 }, []];
    }

    // 4. Update legacy users
    if (upper.startsWith('UPDATE USERS SET EMAIL') || upper.startsWith('UPDATE USERS SET PASSWORD_HASH')) {
      return [{ affectedRows: 0 }, []];
    }

    // 5. SELECT id FROM users WHERE email = ?
    if (upper.startsWith('SELECT ID FROM USERS WHERE EMAIL = ?')) {
      const email = Array.isArray(params) ? params[0] : (params.email || '');
      const found = this.data.users.filter(u => u.email && u.email.toLowerCase() === String(email).toLowerCase());
      return [found.map(u => ({ id: u.id })), []];
    }

    // 6. SELECT * FROM users WHERE email = ?
    if (upper.startsWith('SELECT * FROM USERS WHERE EMAIL = ?')) {
      const email = Array.isArray(params) ? params[0] : (params.email || '');
      const found = this.data.users.find(u => u.email && u.email.toLowerCase() === String(email).toLowerCase());
      return [found ? [{ ...found }] : [], []];
    }

    // 7. SELECT ... FROM users WHERE id = ?
    if (upper.includes('FROM USERS WHERE ID = ?')) {
      const id = Number(Array.isArray(params) ? params[0] : (params.id || 0));
      const found = this.data.users.find(u => u.id === id);
      return [found ? [this.sanitizeUser(found)] : [], []];
    }

    // 8. INSERT INTO users
    if (upper.startsWith('INSERT INTO USERS')) {
      this.autoInc.users += 1;
      const id = this.autoInc.users;
      const p = Array.isArray(params) ? {} : params;
      const user = {
        id,
        name: p.name || 'User',
        email: p.email || '',
        password_hash: p.password_hash || '',
        age: null,
        gender: null,
        height_cm: null,
        weight_kg: null,
        goal: null,
        calorie_goal: null,
        protein_goal: null,
        water_goal_ml: null,
        created_at: new Date().toISOString()
      };
      this.data.users.push(user);
      this.save();
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 9. UPDATE users SET ... WHERE id = :id
    if (upper.startsWith('UPDATE USERS SET')) {
      const id = Number(params.id);
      const user = this.data.users.find(u => u.id === id);
      if (user) {
        if (params.name !== undefined) user.name = params.name;
        if (params.age !== undefined) user.age = params.age;
        if (params.gender !== undefined) user.gender = params.gender;
        if (params.height_cm !== undefined) user.height_cm = params.height_cm;
        if (params.weight_kg !== undefined) user.weight_kg = params.weight_kg;
        if (params.goal !== undefined) user.goal = params.goal;
        if (params.calorie_goal !== undefined) user.calorie_goal = params.calorie_goal;
        if (params.protein_goal !== undefined) user.protein_goal = params.protein_goal;
        if (params.water_goal_ml !== undefined) user.water_goal_ml = params.water_goal_ml;
        this.save();
      }
      return [{ affectedRows: user ? 1 : 0 }, []];
    }

    // 10. Aggregations: meals
    if (upper.includes('SUM(CALORIES)') && upper.includes('FROM MEALS')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.meals.filter(m => m.user_id === userId && m.meal_date === date);
      const calories = matching.reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
      const protein = matching.reduce((sum, m) => sum + (Number(m.protein_g) || 0), 0);
      const carbs = matching.reduce((sum, m) => sum + (Number(m.carbs_g) || 0), 0);
      const fats = matching.reduce((sum, m) => sum + (Number(m.fats_g) || 0), 0);
      return [[{ calories, protein, carbs, fats }], []];
    }

    // 11. Aggregations: workouts
    if (upper.includes('SUM(DURATION_MINUTES)') && upper.includes('FROM WORKOUTS')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.workouts.filter(w => w.user_id === userId && w.workout_date === date);
      const minutes = matching.reduce((sum, w) => sum + (Number(w.duration_minutes) || 0), 0);
      const burned = matching.reduce((sum, w) => sum + (Number(w.calories_burned) || 0), 0);
      return [[{ minutes, burned }], []];
    }

    // 12. Aggregations: water
    if (upper.includes('SUM(AMOUNT_ML)') && upper.includes('FROM WATER_LOGS')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.water_logs.filter(w => w.user_id === userId && w.log_date === date);
      const water = matching.reduce((sum, w) => sum + (Number(w.amount_ml) || 0), 0);
      return [[{ water }], []];
    }

    // 13. SELECT * FROM meals WHERE user_id = :userId AND meal_date = :date
    if (upper.includes('FROM MEALS WHERE USER_ID = :USERID AND MEAL_DATE = :DATE')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.meals
        .filter(m => m.user_id === userId && m.meal_date === date)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return [matching, []];
    }

    // 14. SELECT * FROM workouts WHERE user_id = :userId AND workout_date = :date
    if (upper.includes('FROM WORKOUTS WHERE USER_ID = :USERID AND WORKOUT_DATE = :DATE')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.workouts
        .filter(w => w.user_id === userId && w.workout_date === date)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return [matching, []];
    }

    // 15. SELECT * FROM water_logs WHERE user_id = :userId AND log_date = :date
    if (upper.includes('FROM WATER_LOGS WHERE USER_ID = :USERID AND LOG_DATE = :DATE')) {
      const userId = Number(params.userId);
      const date = String(params.date);
      const matching = this.data.water_logs
        .filter(w => w.user_id === userId && w.log_date === date)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return [matching, []];
    }

    // 16. INSERT INTO meals
    if (upper.startsWith('INSERT INTO MEALS')) {
      this.autoInc.meals += 1;
      const id = this.autoInc.meals;
      const item = {
        id,
        user_id: Number(params.user_id),
        meal_date: params.meal_date,
        meal_type: params.meal_type,
        food_name: params.food_name,
        calories: Number(params.calories) || 0,
        protein_g: Number(params.protein_g) || 0,
        carbs_g: Number(params.carbs_g) || 0,
        fats_g: Number(params.fats_g) || 0,
        created_at: new Date().toISOString()
      };
      this.data.meals.push(item);
      this.save();
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 17. INSERT INTO workouts
    if (upper.startsWith('INSERT INTO WORKOUTS')) {
      this.autoInc.workouts += 1;
      const id = this.autoInc.workouts;
      const item = {
        id,
        user_id: Number(params.user_id),
        workout_date: params.workout_date,
        activity: params.activity,
        duration_minutes: Number(params.duration_minutes) || 0,
        calories_burned: Number(params.calories_burned) || 0,
        intensity: params.intensity || 'Medium',
        created_at: new Date().toISOString()
      };
      this.data.workouts.push(item);
      this.save();
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 18. INSERT INTO water_logs
    if (upper.startsWith('INSERT INTO WATER_LOGS')) {
      this.autoInc.water_logs += 1;
      const id = this.autoInc.water_logs;
      const item = {
        id,
        user_id: Number(params.user_id),
        log_date: params.log_date,
        amount_ml: Number(params.amount_ml) || 0,
        created_at: new Date().toISOString()
      };
      this.data.water_logs.push(item);
      this.save();
      return [{ insertId: id, affectedRows: 1 }, []];
    }

    // 19. DELETE FROM table WHERE id = ? AND user_id = ?
    if (upper.startsWith('DELETE FROM')) {
      const match = upper.match(/DELETE FROM\s+(\w+)/i);
      const table = match ? match[1].toLowerCase() : '';
      const [id, userId] = Array.isArray(params) ? params : [params.id, params.userId];
      if (this.data[table]) {
        const initLen = this.data[table].length;
        this.data[table] = this.data[table].filter(row => !(row.id === Number(id) && row.user_id === Number(userId)));
        const affected = initLen - this.data[table].length;
        if (affected > 0) this.save();
        return [{ affectedRows: affected }, []];
      }
      return [{ affectedRows: 0 }, []];
    }

    return [[], []];
  }

  async end() {
    return Promise.resolve();
  }
}

module.exports = { MemoryPool };
