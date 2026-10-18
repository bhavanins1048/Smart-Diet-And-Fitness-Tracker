# Smart Diet and Fitness Tracker

Full-stack tracker using HTML, CSS, JavaScript, Node.js, Express, and MySQL.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create the database:

```bash
mysql -u root -p < db/schema.sql
```

3. Create `.env` from the example and update your MySQL password:

```bash
cp .env.example .env
```

4. Start the server:

```bash
npm start
```

Open `http://localhost:3000`.

## Features

- Register and login before opening the dashboard.
- Save profile, body metrics, and daily goals.
- Log meals with calories and macros.
- Log workouts with duration, intensity, and burned calories.
- Log water intake.
- View daily progress and delete entries.

## Existing Database Upgrade

If you created the database before login/register was added, restart the server after pulling these files. The backend will add the missing `email` and `password_hash` columns automatically.

You can also run the SQL migration manually:

```bash
mysql -u root -p < db/add_auth_columns.sql
```
