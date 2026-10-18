const api = {
  login: (payload) => fetch('/api/login', request('POST', payload)).then(readJson),
  register: (payload) => fetch('/api/register', request('POST', payload)).then(readJson),
  logout: () => fetch('/api/logout', { method: 'POST' }).then(readJson),
  summary: (date) => fetch(`/api/summary?date=${date}`).then(readJson),
  saveProfile: (payload) => fetch('/api/profile', request('POST', payload)).then(readJson),
  addMeal: (payload) => fetch('/api/meals', request('POST', payload)).then(readJson),
  addWorkout: (payload) => fetch('/api/workouts', request('POST', payload)).then(readJson),
  addWater: (payload) => fetch('/api/water', request('POST', payload)).then(readJson),
  remove: (type, id) => fetch(`/api/${type}/${id}`, { method: 'DELETE' }).then(readJson),
  nutrition: (query) => fetch(`/api/nutrition?query=${encodeURIComponent(query)}`).then(readJson)
};

const state = {
  userId: null,
  user: null,
  date: new Date().toISOString().slice(0, 10),
  selectedFoodBaseNutrients: null,
  activeUnit: 'servings'
};

const $ = (selector) => document.querySelector(selector);

function request(method, payload) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

async function readJson(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.details || data.error || 'Request failed');
  }
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setBusy(form, isBusy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;

  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = 'Saving...';
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }

  button.disabled = isBusy;
}

async function submitForm(event, action) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    setBusy(form, true);
    await action(form);
  } catch (error) {
    showToast(error.message || 'Something went wrong');
    console.error(error);
  } finally {
    setBusy(form, false);
  }
}

function fillForm(form, data) {
  if (!data) return;
  Array.from(form.elements).forEach((field) => {
    if (field.name && data[field.name] !== undefined && data[field.name] !== null) {
      field.value = data[field.name];
    }
  });
}

function percent(value, max) {
  if (!max) return 0;
  return Math.min(100, Math.round((Number(value || 0) / Number(max)) * 100));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function saveUser(user) {
  state.user = user;
  state.userId = user.id;
}

function clearUserDataUI() {
  $('#profileForm').reset();
  $('#mealList').innerHTML = '';
  $('#workoutList').innerHTML = '';
  $('#waterList').innerHTML = '';
  $('#caloriesTotal').textContent = '0 / 0';
  $('#proteinTotal').textContent = '0g / 0g';
  $('#waterTotal').textContent = '0 / 0 ml';
  $('#workoutTotal').textContent = '0 min';
  $('#burnedTotal').textContent = '0 kcal burned';
  $('#caloriesProgress').value = 0;
  $('#proteinProgress').value = 0;
  $('#waterProgress').value = 0;
  $('#mealForm').reset();
  $('#workoutForm').reset();
  $('#waterForm').reset();
  document.querySelectorAll('.nutrition-field').forEach(field => {
    field.setAttribute('data-highlight', 'false');
  });
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');
}

function showAuth() {
  $('#authScreen').classList.remove('hidden');
  $('#appScreen').classList.add('hidden');
}

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  $('#loginForm').classList.toggle('hidden', !isLogin);
  $('#registerForm').classList.toggle('hidden', isLogin);
  $('#loginTab').classList.toggle('active', isLogin);
  $('#registerTab').classList.toggle('active', !isLogin);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

async function refresh() {
  if (!state.userId) return;

  try {
    const data = await api.summary(state.date);
    if (data.profile) {
      state.userId = data.profile.id;
      state.user = data.profile;
      fillForm($('#profileForm'), data.profile);
    }
    renderSummary(data);
    renderLists(data);
    renderQuickFoodTags();
  } catch (error) {
    showToast(`Database connection issue: ${error.message}`);
  }
}

function renderSummary(data) {
  const profile = data.profile || {};
  const totals = data.totals || {};
  const calories = Math.round(Number(totals.calories || 0));
  const protein = Math.round(Number(totals.protein || 0));
  const water = Math.round(Number(totals.water || 0));
  const minutes = Math.round(Number(totals.minutes || 0));
  const burned = Math.round(Number(totals.burned || 0));

  $('#caloriesTotal').textContent = `${calories} / ${profile.calorie_goal || 0}`;
  $('#proteinTotal').textContent = `${protein}g / ${profile.protein_goal || 0}g`;
  $('#waterTotal').textContent = `${water} / ${profile.water_goal_ml || 0} ml`;
  $('#workoutTotal').textContent = `${minutes} min`;
  $('#burnedTotal').textContent = `${burned} kcal burned`;
  $('#caloriesProgress').value = percent(calories, profile.calorie_goal);
  $('#proteinProgress').value = percent(protein, profile.protein_goal);
  $('#waterProgress').value = percent(water, profile.water_goal_ml);
}

function emptyText(label) {
  return `<p class="status">No ${label} logged for this date.</p>`;
}

function renderLists(data) {
  $('#mealList').innerHTML = data.meals.length ? data.meals.map((meal) => `
    <div class="record">
      <div>
        <strong>${escapeHtml(meal.food_name)}</strong>
        <small>${escapeHtml(meal.meal_type)} - ${meal.calories} kcal - ${Number(meal.protein_g)}g protein</small>
      </div>
      <button type="button" data-delete="meals" data-id="${meal.id}" aria-label="Delete meal">x</button>
    </div>
  `).join('') : emptyText('meals');

  $('#workoutList').innerHTML = data.workouts.length ? data.workouts.map((workout) => `
    <div class="record">
      <div>
        <strong>${escapeHtml(workout.activity)}</strong>
        <small>${workout.duration_minutes} min - ${workout.calories_burned} kcal - ${escapeHtml(workout.intensity)}</small>
      </div>
      <button type="button" data-delete="workouts" data-id="${workout.id}" aria-label="Delete workout">x</button>
    </div>
  `).join('') : emptyText('workouts');

  $('#waterList').innerHTML = data.water.length ? data.water.map((water) => `
    <div class="record">
      <div>
        <strong>${water.amount_ml} ml</strong>
        <small>Hydration entry</small>
      </div>
      <button type="button" data-delete="water" data-id="${water.id}" aria-label="Delete water log">x</button>
    </div>
  `).join('') : emptyText('water');
}

function addDatedPayload(payload) {
  return {
    ...payload,
    meal_date: state.date,
    workout_date: state.date,
    log_date: state.date
  };
}

$('#trackDate').value = state.date;
$('#trackDate').addEventListener('change', (event) => {
  state.date = event.target.value;
  refresh();
});

$('#loginTab').addEventListener('click', () => setAuthMode('login'));
$('#registerTab').addEventListener('click', () => setAuthMode('register'));

$('#loginForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  const data = await api.login(formData(form));
  saveUser(data.user);
  form.reset();
  Array.from(form.elements).forEach((field) => {
    if (field.name) field.value = '';
  });
  showApp();
  showToast('Logged in successfully');
  await refresh();
}));

$('#registerForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  const data = await api.register(formData(form));
  saveUser(data.user);
  form.reset();
  Array.from(form.elements).forEach((field) => {
    if (field.name) field.value = '';
  });
  showApp();
  fillForm($('#profileForm'), data.user);
  showToast('Account created');
  await refresh();
}));

$('#logoutButton').addEventListener('click', async () => {
  try {
    await api.logout();
  } catch (err) {
    console.error('Logout request failed:', err);
  }
  state.user = null;
  state.userId = null;
  
  try {
    const favs = localStorage.getItem('fit_favs');
    const recents = localStorage.getItem('fit_recents');
    localStorage.clear();
    if (favs) localStorage.setItem('fit_favs', favs);
    if (recents) localStorage.setItem('fit_recents', recents);
    sessionStorage.clear();
  } catch (e) {}
  
  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.reset();
    Array.from(loginForm.elements).forEach((field) => {
      if (field.name) field.value = '';
    });
  }
  
  const registerForm = $('#registerForm');
  if (registerForm) {
    registerForm.reset();
    Array.from(registerForm.elements).forEach((field) => {
      if (field.name) field.value = '';
    });
  }

  clearUserDataUI();
  showAuth();
  showToast('Logged out');
});

$('#profileForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  const profile = await api.saveProfile(formData(form));
  saveUser({ ...state.user, ...profile });
  $('#profileStatus').textContent = 'Saved';
  showToast('Profile updated');
  await refresh();
}));

$('#mealForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  await api.addMeal(addDatedPayload(formData(form)));
  
  // Save to recents
  const foodName = $('#foodNameInput').value.trim();
  const base = state.selectedFoodBaseNutrients;
  if (foodName && base) {
    const info = getFoodInfo(foodName);
    addRecent({
      name: foodName,
      emoji: info.emoji,
      calories: base.calories,
      protein: base.protein,
      carbs: base.carbs,
      fats: base.fats
    });
  }

  form.reset();
  state.selectedFoodBaseNutrients = null;
  setMeasurementUnit('servings');
  $('#quantityInput').value = 1;
  updateFavStarState();

  document.querySelectorAll('.nutrition-field').forEach(field => {
    field.setAttribute('data-highlight', 'false');
  });
  showToast('Meal added');
  await refresh();
}));

$('#workoutForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  await api.addWorkout(addDatedPayload(formData(form)));
  form.reset();
  showToast('Workout added');
  await refresh();
}));

$('#waterForm').addEventListener('submit', (event) => submitForm(event, async (form) => {
  await api.addWater(addDatedPayload(formData(form)));
  form.reset();
  showToast('Water logged');
  await refresh();
}));

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;

  try {
    await api.remove(button.dataset.delete, button.dataset.id);
    showToast('Entry deleted');
    await refresh();
  } catch (error) {
    showToast(error.message || 'Delete failed');
    console.error(error);
  }
});

async function initApp() {
  try {
    const favs = localStorage.getItem('fit_favs');
    const recents = localStorage.getItem('fit_recents');
    localStorage.clear();
    if (favs) localStorage.setItem('fit_favs', favs);
    if (recents) localStorage.setItem('fit_recents', recents);
    sessionStorage.clear();
  } catch (e) {}

  const loginForm = $('#loginForm');
  if (loginForm) {
    loginForm.reset();
    Array.from(loginForm.elements).forEach((field) => {
      if (field.name) field.value = '';
    });
  }
  
  const registerForm = $('#registerForm');
  if (registerForm) {
    registerForm.reset();
    Array.from(registerForm.elements).forEach((field) => {
      if (field.name) field.value = '';
    });
  }

  clearUserDataUI();
  try {
    await api.logout();
  } catch (error) {}
  state.user = null;
  state.userId = null;
  showAuth();
}

const nutritionCache = {};

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

// Predefined foods mapping to emojis and standard serving sizes (in grams)
const foodMetadata = {
  "rice": { emoji: "🍚", servingSize: 150 },
  "white rice": { emoji: "🍚", servingSize: 150 },
  "brown rice": { emoji: "🍚", servingSize: 150 },
  "chicken breast": { emoji: "🍗", servingSize: 120 },
  "chicken": { emoji: "🍗", servingSize: 120 },
  "egg": { emoji: "🥚", servingSize: 50 },
  "egg white": { emoji: "🥚", servingSize: 30 },
  "banana": { emoji: "🍌", servingSize: 100 },
  "milk": { emoji: "🥛", servingSize: 200 },
  "curd": { emoji: "🥛", servingSize: 150 },
  "curds": { emoji: "🥛", servingSize: 150 },
  "yogurt": { emoji: "🥛", servingSize: 150 },
  "oats": { emoji: "🥣", servingSize: 150 },
  "whey protein": { emoji: "🥛", servingSize: 30 },
  "apple": { emoji: "🍎", servingSize: 120 },
  "dal": { emoji: "🥣", servingSize: 150 },
  "paneer": { emoji: "🧀", servingSize: 50 },
  "panneer": { emoji: "🧀", servingSize: 50 },
  "roti": { emoji: "🥙", servingSize: 50 },
  "chapati": { emoji: "🥙", servingSize: 50 },
  "chapathi": { emoji: "🥙", servingSize: 50 },
  "dosa": { emoji: "🥙", servingSize: 60 },
  "idli": { emoji: "🥙", servingSize: 50 },
  "vada": { emoji: "🥙", servingSize: 60 },
  "samosa": { emoji: "🥙", servingSize: 60 },
  "upma": { emoji: "🥙", servingSize: 150 },
  "avalakki": { emoji: "🥙", servingSize: 120 },
  "poha": { emoji: "🥙", servingSize: 120 },
  "almonds": { emoji: "🥜", servingSize: 15 },
  "peanut butter": { emoji: "🥜", servingSize: 16 },
  "salmon": { emoji: "🐟", servingSize: 150 },
  "biryani": { emoji: "🍚", servingSize: 200 },
  "kichdi": { emoji: "🥣", servingSize: 150 },
  "khichdi": { emoji: "🥣", servingSize: 150 }
};

const localFoods = [
  { name: "Rice", calories: 130, protein: 2.7, carbs: 28, fats: 0.3 },
  { name: "White Rice", calories: 130, protein: 2.7, carbs: 28, fats: 0.3 },
  { name: "Brown Rice", calories: 111, protein: 2.6, carbs: 23, fats: 0.9 },
  { name: "Chicken Breast", calories: 165, protein: 31, carbs: 0, fats: 3.6 },
  { name: "Chicken", calories: 165, protein: 31, carbs: 0, fats: 3.6 },
  { name: "Egg", calories: 155, protein: 13, carbs: 1.1, fats: 11 },
  { name: "Egg White", calories: 52, protein: 11, carbs: 0.7, fats: 0.2 },
  { name: "Banana", calories: 89, protein: 1.1, carbs: 22.8, fats: 0.3 },
  { name: "Milk", calories: 61, protein: 3.2, carbs: 4.8, fats: 3.3 },
  { name: "Curd", calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  { name: "Curds", calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  { name: "Yogurt", calories: 61, protein: 3.5, carbs: 4.7, fats: 3.3 },
  { name: "Oats", calories: 389, protein: 16.9, carbs: 66.3, fats: 6.9 },
  { name: "Whey Protein", calories: 400, protein: 80, carbs: 6, fats: 6 },
  { name: "Apple", calories: 52, protein: 0.3, carbs: 13.8, fats: 0.2 },
  { name: "Dal", calories: 116, protein: 9, carbs: 20, fats: 0.4 },
  { name: "Paneer", calories: 265, protein: 18, carbs: 1.2, fats: 20.8 },
  { name: "Panneer", calories: 265, protein: 18, carbs: 1.2, fats: 20.8 },
  { name: "Roti", calories: 264, protein: 9, carbs: 56, fats: 3 },
  { name: "Chapati", calories: 264, protein: 9, carbs: 56, fats: 3 },
  { name: "Chapathi", calories: 264, protein: 9, carbs: 56, fats: 3 },
  { name: "Dosa", calories: 168, protein: 3.9, carbs: 29, fats: 3.7 },
  { name: "Idli", calories: 130, protein: 4, carbs: 28, fats: 1 },
  { name: "Vada", calories: 220, protein: 6, carbs: 24, fats: 12 },
  { name: "Samosa", calories: 262, protein: 3.5, carbs: 32, fats: 13 },
  { name: "Upma", calories: 180, protein: 4, carbs: 33, fats: 3.5 },
  { name: "Avalakki", calories: 110, protein: 2.5, carbs: 25, fats: 0.5 },
  { name: "Poha", calories: 110, protein: 2.5, carbs: 25, fats: 0.5 },
  { name: "Almonds", calories: 579, protein: 21.1, carbs: 21.6, fats: 49.9 },
  { name: "Peanut Butter", calories: 588, protein: 25, carbs: 20, fats: 50 },
  { name: "Salmon", calories: 208, protein: 20, carbs: 0, fats: 13 },
  { name: "Biryani", calories: 150, protein: 7, carbs: 19, fats: 5 },
  { name: "Kichdi", calories: 115, protein: 3.5, carbs: 21, fats: 2 },
  { name: "Khichdi", calories: 115, protein: 3.5, carbs: 21, fats: 2 }
];

function getFoodInfo(name) {
  const clean = name.toLowerCase().trim();
  return foodMetadata[clean] || { emoji: "🥗", servingSize: 100 };
}

function renderQuickFoodTags() {
  const favs = JSON.parse(localStorage.getItem('fit_favs') || '[]');
  const recents = JSON.parse(localStorage.getItem('fit_recents') || '[]');

  const favList = $('#favFoodsList');
  const recentList = $('#recentFoodsList');

  if (favList) {
    if (favs.length === 0) {
      favList.innerHTML = '<span class="empty-tag-msg">No favorites yet</span>';
    } else {
      favList.innerHTML = favs.map(f => `
        <button type="button" class="food-tag" data-food-tag='${escapeHtml(JSON.stringify(f))}'>
          <span>${escapeHtml(f.emoji)}</span>
          <span>${escapeHtml(f.name)}</span>
        </button>
      `).join('');
    }
  }

  if (recentList) {
    if (recents.length === 0) {
      recentList.innerHTML = '<span class="empty-tag-msg">No recents yet</span>';
    } else {
      recentList.innerHTML = recents.map(f => `
        <button type="button" class="food-tag" data-food-tag='${escapeHtml(JSON.stringify(f))}'>
          <span>${escapeHtml(f.emoji)}</span>
          <span>${escapeHtml(f.name)}</span>
        </button>
      `).join('');
    }
  }
}

function selectFood(food) {
  $('#foodNameInput').value = food.name;
  state.selectedFoodBaseNutrients = {
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fats: food.fats
  };
  
  setMeasurementUnit('servings');
  $('#quantityInput').value = 1;
  
  updateCalculatedMacros();
  updateFavStarState();
  
  const dropdown = $('#autocompleteDropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function updateFavStarState() {
  const favToggleBtn = $('#favToggleBtn');
  if (!favToggleBtn) return;
  const name = $('#foodNameInput').value.trim();
  const favs = JSON.parse(localStorage.getItem('fit_favs') || '[]');
  const isFav = favs.some(f => f.name.toLowerCase() === name.toLowerCase());
  
  if (isFav) {
    favToggleBtn.classList.add('active');
    favToggleBtn.textContent = '★';
  } else {
    favToggleBtn.classList.remove('active');
    favToggleBtn.textContent = '☆';
  }
}

function toggleFavorite() {
  const name = $('#foodNameInput').value.trim();
  if (!name) return;
  
  const favs = JSON.parse(localStorage.getItem('fit_favs') || '[]');
  const index = favs.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
  
  if (index > -1) {
    favs.splice(index, 1);
    showToast(`${name} removed from favorites`);
  } else {
    const info = getFoodInfo(name);
    const base = state.selectedFoodBaseNutrients || { calories: 0, protein: 0, carbs: 0, fats: 0 };
    favs.push({
      name: name,
      emoji: info.emoji,
      calories: base.calories,
      protein: base.protein,
      carbs: base.carbs,
      fats: base.fats
    });
    showToast(`${name} added to favorites`);
  }
  
  localStorage.setItem('fit_favs', JSON.stringify(favs));
  updateFavStarState();
  renderQuickFoodTags();
}

function addRecent(food) {
  let recents = JSON.parse(localStorage.getItem('fit_recents') || '[]');
  recents = recents.filter(f => f.name.toLowerCase() !== food.name.toLowerCase());
  recents.unshift(food);
  if (recents.length > 5) {
    recents = recents.slice(0, 5);
  }
  localStorage.setItem('fit_recents', JSON.stringify(recents));
  renderQuickFoodTags();
}

function showAutocomplete(val) {
  const query = val.toLowerCase().trim();
  const dropdown = $('#autocompleteDropdown');
  if (!dropdown) return;

  if (query.length < 1) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    return;
  }

  const matches = localFoods.filter(f => f.name.toLowerCase().includes(query));

  if (matches.length === 0) {
    dropdown.innerHTML = `
      <div class="autocomplete-item" id="searchApiPrompt">
        <div class="autocomplete-food-info">
          <span class="autocomplete-emoji">🔍</span>
          <span class="autocomplete-name">Search for "${escapeHtml(val)}"...</span>
        </div>
      </div>
    `;
  } else {
    dropdown.innerHTML = matches.map(f => {
      const info = getFoodInfo(f.name);
      return `
        <div class="autocomplete-item" data-autocomplete-food='${escapeHtml(JSON.stringify({ ...f, emoji: info.emoji }))}'>
          <div class="autocomplete-food-info">
            <span class="autocomplete-emoji">${escapeHtml(info.emoji)}</span>
            <span class="autocomplete-name">${escapeHtml(f.name)}</span>
          </div>
          <span class="autocomplete-macros">${f.calories} kcal | P: ${f.protein}g</span>
        </div>
      `;
    }).join('');
  }
  dropdown.classList.remove('hidden');
}

function updateCalculatedMacros() {
  const qtyInput = $('#quantityInput');
  if (!qtyInput) return;
  const qty = parseFloat(qtyInput.value) || 0;
  const foodName = $('#foodNameInput').value;
  const foodInfo = getFoodInfo(foodName);
  
  let totalGrams = 0;
  if (state.activeUnit === 'servings') {
    totalGrams = qty * foodInfo.servingSize;
  } else {
    totalGrams = qty;
  }

  const factor = totalGrams / 100;
  const base = state.selectedFoodBaseNutrients || { calories: 0, protein: 0, carbs: 0, fats: 0 };

  const cal = Math.round((base.calories || 0) * factor);
  const pro = parseFloat(((base.protein || 0) * factor).toFixed(1));
  const carb = parseFloat(((base.carbs || 0) * factor).toFixed(1));
  const fat = parseFloat(((base.fats || 0) * factor).toFixed(1));

  $('#caloriesInput').value = cal || 0;
  $('#proteinInput').value = pro || 0;
  $('#carbsInput').value = carb || 0;
  $('#fatsInput').value = fat || 0;
}

function setMeasurementUnit(unit) {
  state.activeUnit = unit;
  
  document.querySelectorAll('.toggle-option').forEach(btn => {
    const active = btn.dataset.unit === unit;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  const unitLabel = $('#quantityUnitLabel');
  const qtyInput = $('#quantityInput');

  if (unit === 'servings') {
    if (unitLabel) unitLabel.textContent = 'Bowl(s)';
    if (qtyInput) {
      qtyInput.value = 1;
      qtyInput.min = 0.1;
      qtyInput.step = 0.25;
    }
    renderQuickPills([0.5, 1, 2]);
  } else {
    if (unitLabel) unitLabel.textContent = 'g';
    if (qtyInput) {
      qtyInput.value = 100;
      qtyInput.min = 1;
      qtyInput.step = 10;
    }
    renderQuickPills([50, 100, 200, 250]);
  }
  
  updateCalculatedMacros();
}

function renderQuickPills(values) {
  const container = $('#quickPillsContainer');
  if (!container) return;

  const currentVal = parseFloat($('#quantityInput').value);

  container.innerHTML = values.map(val => {
    const active = currentVal === val ? 'active' : '';
    const label = state.activeUnit === 'servings' 
      ? (val === 0.5 ? '½ Bowl' : `${val} Bowl${val > 1 ? 's' : ''}`)
      : `${val}g`;
    return `
      <button type="button" class="quick-pill ${active}" data-pill-val="${val}">
        ${label}
      </button>
    `;
  }).join('');
}

function updateQuickPillSelection(val) {
  document.querySelectorAll('.quick-pill').forEach(pill => {
    const pillVal = parseFloat(pill.dataset.pillVal);
    pill.classList.toggle('active', pillVal === val);
  });
}

function updateBaseNutrientsFromInputs() {
  const qty = parseFloat($('#quantityInput').value) || 0;
  const foodName = $('#foodNameInput').value;
  const foodInfo = getFoodInfo(foodName);
  
  let totalGrams = 0;
  if (state.activeUnit === 'servings') {
    totalGrams = qty * foodInfo.servingSize;
  } else {
    totalGrams = qty;
  }
  
  const factor = totalGrams / 100;
  if (factor > 0) {
    state.selectedFoodBaseNutrients = {
      calories: (parseFloat($('#caloriesInput').value) || 0) / factor,
      protein: (parseFloat($('#proteinInput').value) || 0) / factor,
      carbs: (parseFloat($('#carbsInput').value) || 0) / factor,
      fats: (parseFloat($('#fatsInput').value) || 0) / factor
    };
  }
}

async function fetchNutrition(foodName) {
  const query = foodName.trim();
  const form = $('#mealForm');
  if (query.length === 0) {
    state.selectedFoodBaseNutrients = null;
    fillForm(form, {
      calories: '',
      protein_g: '',
      carbs_g: '',
      fats_g: ''
    });
    document.querySelectorAll('.nutrition-field').forEach(field => {
      field.setAttribute('data-highlight', 'false');
    });
    updateFavStarState();
    return;
  }
  if (query.length < 2) return;

  const cacheKey = query.toLowerCase();
  const spinner = $('#nutritionSpinner');

  if (nutritionCache[cacheKey]) {
    const data = nutritionCache[cacheKey];
    state.selectedFoodBaseNutrients = {
      calories: data.calories,
      protein: data.protein,
      carbs: data.carbs,
      fats: data.fats
    };
    updateCalculatedMacros();
    document.querySelectorAll('.nutrition-field').forEach(field => {
      field.setAttribute('data-highlight', 'true');
    });
    updateFavStarState();
    return;
  }

  try {
    spinner.classList.remove('hidden');
    const data = await api.nutrition(query);
    nutritionCache[cacheKey] = data;
    state.selectedFoodBaseNutrients = {
      calories: data.calories,
      protein: data.protein,
      carbs: data.carbs,
      fats: data.fats
    };
    updateCalculatedMacros();
    document.querySelectorAll('.nutrition-field').forEach(field => {
      field.setAttribute('data-highlight', 'true');
    });
    updateFavStarState();
  } catch (error) {
    console.error('Error fetching nutrition:', error);
    showToast('Nutrition data not found.');
  } finally {
    spinner.classList.add('hidden');
  }
}

const debouncedFetch = debounce((val) => fetchNutrition(val), 500);

// Redesigned Add Meal Event Listeners Setup
$('#foodNameInput').addEventListener('input', (event) => {
  const val = event.target.value;
  showAutocomplete(val);
  updateFavStarState();
  debouncedFetch(val);
});

$('#favToggleBtn').addEventListener('click', () => {
  toggleFavorite();
});

document.addEventListener('click', (event) => {
  const dropdown = $('#autocompleteDropdown');
  if (dropdown && !event.target.closest('.search-group')) {
    dropdown.classList.add('hidden');
  }
});

const quickTagsContainer = $('#quickFoodTags');
if (quickTagsContainer) {
  quickTagsContainer.addEventListener('click', (event) => {
    const tag = event.target.closest('[data-food-tag]');
    if (!tag) return;
    const food = JSON.parse(tag.dataset.foodTag);
    selectFood(food);
  });
}

const dropdownEl = $('#autocompleteDropdown');
if (dropdownEl) {
  dropdownEl.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-autocomplete-food]');
    if (item) {
      const food = JSON.parse(item.dataset.autocompleteFood);
      selectFood(food);
      return;
    }

    const prompt = event.target.closest('#searchApiPrompt');
    if (prompt) {
      const searchVal = $('#foodNameInput').value;
      dropdownEl.classList.add('hidden');
      await fetchNutrition(searchVal);
    }
  });
}

document.querySelectorAll('.measurement-toggle .toggle-option').forEach(btn => {
  btn.addEventListener('click', () => {
    setMeasurementUnit(btn.dataset.unit);
  });
});

const quantityInputEl = $('#quantityInput');
if (quantityInputEl) {
  quantityInputEl.addEventListener('input', () => {
    const val = parseFloat(quantityInputEl.value) || 0;
    updateQuickPillSelection(val);
    updateCalculatedMacros();
  });
}

const minusBtn = $('#stepperMinus');
if (minusBtn) {
  minusBtn.addEventListener('click', () => {
    const qtyInput = $('#quantityInput');
    let val = parseFloat(qtyInput.value) || 0;
    
    if (state.activeUnit === 'servings') {
      val = Math.max(0.1, val - 0.25);
    } else {
      val = Math.max(10, val - 25);
    }
    
    qtyInput.value = val;
    updateQuickPillSelection(val);
    updateCalculatedMacros();
  });
}

const plusBtn = $('#stepperPlus');
if (plusBtn) {
  plusBtn.addEventListener('click', () => {
    const qtyInput = $('#quantityInput');
    let val = parseFloat(qtyInput.value) || 0;
    
    if (state.activeUnit === 'servings') {
      val = val + 0.25;
    } else {
      val = val + 25;
    }
    
    qtyInput.value = val;
    updateQuickPillSelection(val);
    updateCalculatedMacros();
  });
}

const quickPillsContainerEl = $('#quickPillsContainer');
if (quickPillsContainerEl) {
  quickPillsContainerEl.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-pill-val]');
    if (!pill) return;
    
    const val = parseFloat(pill.dataset.pillVal);
    $('#quantityInput').value = val;
    
    document.querySelectorAll('.quick-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    
    updateCalculatedMacros();
  });
}

document.querySelectorAll('.nutrition-field input').forEach(input => {
  input.addEventListener('input', (event) => {
    const field = event.target.closest('.nutrition-field');
    if (field) {
      field.setAttribute('data-highlight', 'false');
    }
    updateBaseNutrientsFromInputs();
  });
});

// Initial load configuration
setMeasurementUnit('servings');
renderQuickFoodTags();

// Add Workout Calorie Calculator Integration
const workoutMET = {
  "walking": { Low: 2.5, Medium: 3.5, High: 4.5 },
  "running": { Low: 6.0, Medium: 8.3, High: 11.0 },
  "cycling": { Low: 5.5, Medium: 7.5, High: 10.0 },
  "swimming": { Low: 5.0, Medium: 7.0, High: 9.5 },
  "yoga": { Low: 2.0, Medium: 2.5, High: 3.0 },
  "gym workout": { Low: 3.0, Medium: 5.0, High: 7.0 }
};

function detectActivity(inputVal) {
  const query = inputVal.toLowerCase().trim();
  if (!query) return "";
  
  if (query.includes("walk")) return "Walking";
  if (query.includes("run")) return "Running";
  if (query.includes("cycl") || query.includes("bike")) return "Cycling";
  if (query.includes("swim")) return "Swimming";
  if (query.includes("yoga")) return "Yoga";
  if (query.includes("gym") || query.includes("lift") || query.includes("strength") || query.includes("workout")) return "Gym Workout";
  
  return "";
}

function calculateWorkoutCalories() {
  const activityInput = $('#workoutActivityInput');
  const minutesInput = $('#workoutMinutesInput');
  const intensitySelect = $('#workoutIntensitySelect');
  const caloriesInput = $('#workoutCaloriesInput');
  const spinner = $('#workoutCalorieSpinner');

  if (!activityInput || !minutesInput || !intensitySelect || !caloriesInput) return;

  const activityVal = activityInput.value.trim();
  const minutesVal = parseFloat(minutesInput.value) || 0;
  const intensityVal = intensitySelect.value;

  if (!activityVal || minutesVal <= 0) return;

  const detected = detectActivity(activityVal);
  const activityKey = (detected || activityVal).toLowerCase();

  let metGroup = workoutMET[activityKey];
  if (!metGroup) {
    const foundKey = Object.keys(workoutMET).find(key => activityKey.includes(key) || key.includes(activityKey));
    if (foundKey) {
      metGroup = workoutMET[foundKey];
    } else {
      metGroup = { Low: 3.0, Medium: 5.0, High: 7.0 };
    }
  }

  const met = metGroup[intensityVal] || 5.0;

  const weight = parseFloat(state.user?.weight_kg) || 
                 (parseFloat($('#profileForm')?.querySelector('[name="weight_kg"]')?.value) || 70);

  const calculatedBurn = Math.round(met * 3.5 * (weight / 200) * minutesVal);

  const spinnerWrapper = caloriesInput.closest('.input-spinner-wrapper') || caloriesInput;
  
  if (spinner) spinner.classList.remove('hidden');
  spinnerWrapper.classList.add('pulse-calc-bg');
  
  caloriesInput.value = calculatedBurn;
  
  setTimeout(() => {
    if (spinner) spinner.classList.add('hidden');
    spinnerWrapper.classList.remove('pulse-calc-bg');
  }, 600);
}

// Workout Calorie Calculator Listeners
const activityInputEl = $('#workoutActivityInput');
if (activityInputEl) {
  activityInputEl.addEventListener('input', () => {
    calculateWorkoutCalories();
  });
  
  activityInputEl.addEventListener('blur', (e) => {
    const detected = detectActivity(e.target.value);
    if (detected) {
      e.target.value = detected;
      calculateWorkoutCalories();
    }
  });
}

const minutesInputEl = $('#workoutMinutesInput');
if (minutesInputEl) {
  minutesInputEl.addEventListener('input', () => {
    calculateWorkoutCalories();
  });
}

const intensitySelectEl = $('#workoutIntensitySelect');
if (intensitySelectEl) {
  intensitySelectEl.addEventListener('change', () => {
    calculateWorkoutCalories();
  });
}

initApp();
