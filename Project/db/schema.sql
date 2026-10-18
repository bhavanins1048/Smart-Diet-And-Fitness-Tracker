CREATE DATABASE IF NOT EXISTS smart_fitness_tracker;
USE smart_fitness_tracker;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  age INT NULL,
  gender VARCHAR(20) NULL,
  height_cm DECIMAL(5,2) NULL,
  weight_kg DECIMAL(5,2) NULL,
  goal VARCHAR(120) NULL,
  calorie_goal INT NULL DEFAULT NULL,
  protein_goal INT NULL DEFAULT NULL,
  water_goal_ml INT NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  meal_date DATE NOT NULL,
  meal_type ENUM('Breakfast', 'Lunch', 'Dinner', 'Snack') NOT NULL,
  food_name VARCHAR(160) NOT NULL,
  calories INT NOT NULL,
  protein_g DECIMAL(6,2) NOT NULL DEFAULT 0,
  carbs_g DECIMAL(6,2) NOT NULL DEFAULT 0,
  fats_g DECIMAL(6,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_meals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  workout_date DATE NOT NULL,
  activity VARCHAR(140) NOT NULL,
  duration_minutes INT NOT NULL,
  calories_burned INT NOT NULL,
  intensity ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Medium',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_workouts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS water_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  log_date DATE NOT NULL,
  amount_ml INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_water_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
