import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import cookieSession from 'cookie-session';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { SITE_IMAGES, syncSiteImages } from './images.js';
const isProduction = process.env.NODE_ENV === 'production';

const ROOT_DIR = process.cwd();

async function sendSMSNotification(phone: string, message: string) {
  const apiKey = process.env.SMS_API_KEY;
  if (!apiKey) return;
  // Placeholder for SMS.ru or similar
  console.log(`[SMS] Sending to ${phone}: ${message}`);
}

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  if (process.env.RAILWAY_ENVIRONMENT && !process.env.PORT) {
    console.error('[startup] Railway не передал PORT — проверьте настройки сервиса.');
    process.exit(1);
  }

  if (isProduction && !process.env.SESSION_SECRET) {
    console.warn('ВНИМАНИЕ: SESSION_SECRET не задан. Задайте его в Railway Variables для безопасности.');
  }

  const app = express();
  app.get('/health', (_req, res) => res.status(200).send('ok'));
  app.use(compression());

  // Сразу открываем порт — Railway healthcheck не ждёт инициализации БД
  console.log(`[startup] NODE_ENV=${process.env.NODE_ENV} PORT=${process.env.PORT} → listen ${PORT}`);
  console.log(`[startup] Railway=${!!process.env.RAILWAY_ENVIRONMENT} DB path will be in /tmp on Railway`);

  await new Promise<void>((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[startup] Порт ${PORT} открыт (0.0.0.0), инициализация...`);
      resolve();
    });
  });

  try {

  // Global helpers for EJS
  app.locals.optImg = (url: string, w = 800) => {
    if (!url) return '';
    if (url.startsWith('/images/')) return url;
    if (url.includes('wsrv.nl') || url.includes('weserv.nl')) return url;
    // Proxied images for bypass blocks and optimization
    const isOptimizable = url.includes('unsplash.com') || url.includes('mixkit.co') || url.includes('soundhelix.com') || url.includes('pixabay.com');
    if (isOptimizable) {
        const baseUrl = url.split('?')[0];
        return `https://wsrv.nl/?url=${encodeURIComponent(baseUrl)}&w=${w}&q=60&output=webp&il`;
    }
    return url;
  };

  // Database setup (на Railway используем /tmp — гарантированно доступен для записи)
  const defaultDbPath = process.env.RAILWAY_ENVIRONMENT
    ? path.join('/tmp', 'niko.db')
    : path.join(ROOT_DIR, 'niko.db');
  const dbPath = process.env.DATABASE_PATH || defaultDbPath;
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Не удалось открыть базу данных:', message);
    app.get('*', (_req, res) => {
      res.status(503).type('text/plain').send(
        `Ошибка базы данных. Проверьте Deploy Logs на Railway.\n\n${message}`
      );
    });
    return;
  }

  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      phone TEXT,
      role TEXT DEFAULT 'user',
      points INTEGER DEFAULT 0,
      staff_status TEXT DEFAULT 'off' -- 'off', 'ready', 'busy'
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      price INTEGER,
      weekend_price INTEGER,
      image_url TEXT,
      category TEXT,
      capacity INTEGER DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS staff_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER,
      user_id INTEGER,
      staff_id INTEGER,
      content TEXT,
      rating INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(staff_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      discount_percent INTEGER,
      is_active INTEGER DEFAULT 1,
      expiry_date DATETIME,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      service_id INTEGER,
      booking_date TEXT,
      guests INTEGER,
      status TEXT DEFAULT 'pending',
      wishes TEXT,
      is_paid INTEGER DEFAULT 0,
      total_price INTEGER,
      promo_code_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(service_id) REFERENCES services(id),
      FOREIGN KEY(promo_code_id) REFERENCES promo_codes(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      service_id INTEGER,
      content TEXT,
      rating INTEGER,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      event_date TEXT,
      price INTEGER,
      image_url TEXT,
      capacity INTEGER,
      tickets_sold INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS event_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_id INTEGER,
      tickets INTEGER,
      total_price INTEGER,
      is_paid INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instructor_id INTEGER,
      booking_id INTEGER,
      note TEXT,
      status TEXT DEFAULT 'pending', -- pending, completed
      confirmation_status TEXT DEFAULT 'confirmed', -- confirmed, pending_confirmation
      FOREIGN KEY(instructor_id) REFERENCES users(id),
      FOREIGN KEY(booking_id) REFERENCES bookings(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      question TEXT,
      answer TEXT,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      code TEXT UNIQUE,
      amount INTEGER,
      status TEXT DEFAULT 'active',
      recipient_email TEXT,
      sender_name TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      icon TEXT,
      points_required INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id INTEGER,
      achievement_id INTEGER,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, achievement_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(achievement_id) REFERENCES achievements(id)
    );

    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      status TEXT DEFAULT 'active', -- 'active', 'repair', 'broken', 'replace'
      status_note TEXT,
      last_check DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS staff_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER,
      content TEXT,
      priority TEXT DEFAULT 'normal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS gallery_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      sender_role TEXT, -- 'user', 'admin', 'ai'
      content TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Ошибка инициализации БД:', message);
    app.get('*', (_req, res) => {
      res.status(503).type('text/plain').send(
        `Ошибка инициализации базы данных. Deploy Logs на Railway.\n\n${message}`
      );
    });
    return;
  }

  // Helper for logging history
  const logActivity = (userId: number, action: string, details: string) => {
    try {
      db.prepare('INSERT INTO user_history (user_id, action, details) VALUES (?, ?, ?)').run(userId, action, details);
    } catch (e) {
      console.error('Logging error:', e);
    }
  };

  // Add status and operator columns if not exists
  try {
    db.exec("ALTER TABLE users ADD COLUMN staff_status TEXT DEFAULT 'ready'");
  } catch (e) { /* already exists */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN needs_operator INTEGER DEFAULT 0");
  } catch (e) { /* already exists */ }
  try {
    db.exec('ALTER TABLE users ADD COLUMN rating_override REAL');
  } catch (e) { /* already exists */ }

  const getStaffRating = (staffId: number) => {
    const user = db.prepare('SELECT rating_override FROM users WHERE id = ?').get(staffId) as { rating_override: number | null } | undefined;
    if (user?.rating_override != null) return user.rating_override;
    const avg = db.prepare('SELECT AVG(rating) as avg_rating FROM staff_reviews WHERE staff_id = ?').get(staffId) as { avg_rating: number | null } | undefined;
    return avg?.avg_rating ?? 5.0;
  };

  const deleteUserById = (userId: number) => {
    const tx = db.transaction((id: number) => {
      db.prepare('DELETE FROM staff_reviews WHERE user_id = ? OR staff_id = ?').run(id, id);
      db.prepare(
        'DELETE FROM assignments WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = ?) OR instructor_id = ?'
      ).run(id, id);
      db.prepare('DELETE FROM event_bookings WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM bookings WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM reviews WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM questions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM certificates WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM user_history WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM staff_notes WHERE author_id = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    tx(userId);
  };

  // Seed services if empty
  const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get() as { count: number };
  if (serviceCount.count === 0) {
    const services = [
      { name: 'Квадроциклы', description: 'Захватывающие поездки по пересеченной местности.', price: 2500, weekend_price: 3000, image_url: SITE_IMAGES.services['Квадроциклы'], category: 'active' },
      { name: 'Конные прогулки', description: 'Спокойные прогулки на лошадях по лесным тропам.', price: 1500, weekend_price: 1800, image_url: SITE_IMAGES.services['Конные прогулки'], category: 'relax' },
      { name: 'Сплав по реке', description: 'Экстремальный рафтинг для любителей адреналина.', price: 3000, weekend_price: 3500, image_url: SITE_IMAGES.services['Сплав по реке'], category: 'water' },
      { name: 'Пейнтбол', description: 'Командная тактическая игра на лесной площадке.', price: 1200, weekend_price: 1500, image_url: SITE_IMAGES.services['Пейнтбол'], category: 'team' },
      { name: 'Баня на дровах', description: 'Традиционная русская баня с купелью.', price: 2000, weekend_price: 2500, image_url: SITE_IMAGES.services['Баня на дровах'], category: 'relax' }
    ];
    const stmt = db.prepare('INSERT INTO services (name, description, price, weekend_price, image_url, category) VALUES (?, ?, ?, ?, ?, ?)');
    services.forEach(s => stmt.run(s.name, s.description, s.price, s.weekend_price, s.image_url, s.category));
  }

  // Seed events if empty
  const eventCount = db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
  if (eventCount.count === 0) {
    const events = [
      { title: 'Йога-тур "Гармония"', description: 'Утренние медитации на берегу.', event_date: '2026-06-15T09:00', price: 3000, capacity: 20, image_url: SITE_IMAGES.events['Йога-тур "Гармония"'] },
      { title: 'Турнир по пейнтболу', description: 'Большой командный матч.', event_date: '2026-06-20T12:00', price: 1200, capacity: 50, image_url: SITE_IMAGES.events['Турнир по пейнтболу'] },
      { title: 'Концерт у костра', description: 'Живая музыка и песни под гитару.', event_date: '2026-06-25T20:00', price: 500, capacity: 100, image_url: SITE_IMAGES.events['Концерт у костра'] }
    ];
    const stmt = db.prepare('INSERT INTO events (title, description, event_date, price, capacity, image_url) VALUES (?, ?, ?, ?, ?, ?)');
    events.forEach(e => stmt.run(e.title, e.description, e.event_date, e.price, e.capacity, e.image_url));
  }

  // Seed achievements if empty
  const achCount = db.prepare('SELECT COUNT(*) as count FROM achievements').get() as { count: number };
  if (achCount.count === 0) {
    const achs = [
      { name: 'Новичок', description: 'Первое посещение Нико', icon: 'award', points: 0 },
      { name: 'Лесной марафонец', description: 'Накоплено более 500 баллов', icon: 'zap', points: 500 },
      { name: 'Мастер Сплава', description: 'Накоплено более 1000 баллов', icon: 'waves', points: 1000 },
      { name: 'Амбассадор Niko', description: 'Накоплено более 5000 баллов', icon: 'crown', points: 5000 }
    ];
    const stmt = db.prepare('INSERT INTO achievements (name, description, icon, points_required) VALUES (?, ?, ?, ?)');
    achs.forEach(a => stmt.run(a.name, a.description, a.icon, a.points));
  }

  // Seed gallery if empty
  const photoCount = db.prepare('SELECT COUNT(*) as count FROM gallery_photos').get() as { count: number };
  if (photoCount.count === 0) {
    const stmt = db.prepare('INSERT INTO gallery_photos (image_url) VALUES (?)');
    SITE_IMAGES.gallery.forEach(p => stmt.run(p));
  }

  try {
    syncSiteImages(db);
  } catch (e) {
    console.error('Ошибка синхронизации изображений:', e);
  }

  // Weather helper with persistence
  let cachedWeather: any = null;
  let lastWeatherFetch = 0;

  function getWeatherData() {
    const now = Date.now();
    if (cachedWeather && (now - lastWeatherFetch < 3600000)) { // 1 hour cache
      return cachedWeather;
    }

    // Deterministic mock weather for Emelyanovka (Orenburg region)
    const date = new Date();
    const day = date.getDate();
    const month = date.getMonth(); // 0 is January
    
    // Orenburg region in May (month 4) is usually 15-25°C
    let baseTemp = 18;
    if (month === 4) baseTemp = 20;
    
    const temp = baseTemp + (day % 5) - 2;
    const conditions = (day % 5 === 0) ? 'cloudy' : (day % 8 === 0 ? 'rain' : 'clear');
    const guestCount = 45 + (day * 4) % 70;

    cachedWeather = {
      location: 'Емельяновка',
      temp,
      conditions,
      humidity: 45 + (day % 10),
      pressure: 750 + (day % 5),
      guestsToday: guestCount,
      updatedAt: now,
      yandexUrl: 'https://yandex.ru/pogoda/emelyanovka-matveevka'
    };
    lastWeatherFetch = now;
    return cachedWeather;
  }

  // Seed admin if empty
  const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number };
  if (adminCount.count === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (email, password, name, phone, role) VALUES (?, ?, ?, ?, ?)').run(
      'admin@niko.ru', hashedPassword, 'Администратор', '+7 (000) 000-00-00', 'admin'
    );
    console.log('Admin user created: admin@niko.ru / admin123');
  }

  // Middleware
  app.set('trust proxy', true); // Trust all proxies
  
  const sessionSecret =
    process.env.SESSION_SECRET ||
    (process.env.RAILWAY_ENVIRONMENT ? 'railway-change-this-secret' : 'niko-dev-secret');

  app.use(cookieSession({
    name: 'niko.sid',
    keys: [sessionSecret],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
  }));

  // Protocol and Session Config Middleware
  app.use((req: any, res: any, next: any) => {
    res.locals.images = SITE_IMAGES;
    const start = Date.now();
    const forwarded = req.headers['forwarded'];
    const host = req.headers.host || '';
    const xfp = req.headers['x-forwarded-proto'] || '';
    
    const isHttps = (forwarded && String(forwarded).includes('proto=https')) || 
                    (host.includes('.run.app')) ||
                    (xfp === 'https');
    
    if (isHttps) {
      req.headers['x-forwarded-proto'] = 'https';
      Object.defineProperty(req, 'secure', { get: () => true, configurable: true });
      Object.defineProperty(req, 'protocol', { get: () => 'https', configurable: true });
      
      req.sessionOptions.secure = true;
      req.sessionOptions.sameSite = process.env.COOKIE_SAME_SITE || (isProduction ? 'lax' : 'none');
    } else {
      // Configure session for HTTP/Local
      req.sessionOptions.secure = false;
      req.sessionOptions.sameSite = 'lax';
      req.sessionOptions.partitioned = false;
    }

    if (!isProduction) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${req.method} ${req.url}`);
      console.log(`[DEBUG] Protocol: ${req.protocol}, Host: ${host}, Secure: ${req.secure}, SessionSecure: ${req.sessionOptions.secure}`);

      const originalSetHeader = res.setHeader;
      res.setHeader = function(name: string, value: any) {
        if (name.toLowerCase() === 'set-cookie') {
          console.log(`[DEBUG] Setting Cookie: ${JSON.stringify(value)}`);
        }
        return originalSetHeader.apply(this, arguments as any);
      };

      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[DEBUG] ${req.method} ${req.url} finished with status ${res.statusCode} in ${duration}ms`);
      });
    }

    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT_DIR, 'views'));

  app.get('/debug-session', (req: any, res) => {
    res.json({
      session: req.session,
      sessionOptions: req.sessionOptions,
      protocol: req.protocol,
      secure: req.secure,
      headers: req.headers
    });
  });

  // Auth Middleware
  app.use((req: any, res: any, next: any) => {
    console.log(`[DEBUG] Auth Middleware - UserID: ${req.session?.userId}`);
    if (req.session && req.session.userId) {
      try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
        res.locals.user = user || null;
        if (!user) {
          console.log(`[DEBUG] User ID ${req.session.userId} found in session but not in database. Clearing session.`);
          req.session.userId = null;
        }
      } catch (err) {
        console.error('[DEBUG] Error fetching user from DB:', err);
        res.locals.user = null;
      }
    } else {
      res.locals.user = null;
    }
    next();
  });

  const requireAuth = (req: any, res: any, next: any) => {
    console.log(`[DEBUG] requireAuth check - UserID: ${req.session?.userId}`);
    if (!req.session || !req.session.userId) {
      console.log('[DEBUG] Unauthorized access attempt, redirecting to /login');
      return res.redirect('/login');
    }
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId) as any;
    if (!user || user.role !== 'admin') return res.redirect('/');
    next();
  };

  // API routes
  app.get('/api/debug/session', (req: any, res) => {
    res.json({
      userId: req.session?.userId,
      sessionOptions: req.sessionOptions,
      protocol: req.protocol,
      secure: req.secure,
      headers: req.headers
    });
  });

  app.get('/api/debug/users', requireAuth, requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, email, name, role FROM users').all();
    res.json(users);
  });

  app.post('/api/chat', async (req: any, res) => {
    try {
      const { message } = req.body;
      const userId = req.session.userId;

      if (!userId) {
        return res.status(401).json({ error: 'Нужна авторизация' });
      }

      // Save user message
      db.prepare('INSERT INTO messages (user_id, sender_role, content) VALUES (?, ?, ?)').run(userId, 'user', message);

      res.json({ success: true });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  app.get('/api/chat/history', requireAuth, (req: any, res) => {
    const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(req.session.userId);
    res.json(messages);
  });

  app.get('/api/admin/chats', requireAuth, requireAdmin, (req, res) => {
    const chats = db.prepare(`
      SELECT u.id, u.name, u.email, u.needs_operator,
      (SELECT content FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM users u
      WHERE id IN (SELECT DISTINCT user_id FROM messages) OR u.needs_operator = 1
      ORDER BY u.needs_operator DESC, last_message_time DESC
    `).all();
    res.json(chats);
  });

  app.get('/api/admin/chat/:user_id', requireAuth, requireAdmin, (req, res) => {
    const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(req.params.user_id);
    res.json(messages);
  });

  app.post('/api/admin/chat/send', requireAuth, requireAdmin, (req: any, res) => {
    const { user_id, content } = req.body;
    db.prepare('INSERT INTO messages (user_id, sender_role, content) VALUES (?, ?, ?)').run(user_id, 'admin', content);
    res.json({ success: true });
  });

  app.post('/api/admin/chat/resolve', requireAuth, requireAdmin, (req, res) => {
    const { user_id } = req.body;
    db.prepare('UPDATE users SET needs_operator = 0 WHERE id = ?').run(user_id);
    res.json({ success: true });
  });

  // Routes
  app.get('/', async (req, res) => {
    const services = db.prepare('SELECT * FROM services LIMIT 3').all();
    const reviews = db.prepare(`
      SELECT r.*, u.name as user_name 
      FROM reviews r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.created_at DESC LIMIT 5
    `).all();
    const weather = getWeatherData();
    res.render('index', { services, reviews, weather, title: 'Главная' });
  });

  app.post('/reviews', requireAuth, (req: any, res) => {
    const { content, rating, image_url, service_id } = req.body;
    db.prepare('INSERT INTO reviews (user_id, content, rating, image_url, service_id) VALUES (?, ?, ?, ?, ?)').run(
      req.session.userId, content, parseInt(rating), image_url || null, service_id || null
    );
    res.redirect('/profile?success=review_added');
  });

  app.get('/about', (req, res) => {
    const weather = getWeatherData();
    res.render('about', { weather, title: 'О нас' });
  });

  app.get('/services', (req, res) => {
    const weather = getWeatherData();
    const services = db.prepare('SELECT * FROM services').all();
    res.render('services', { services, weather, title: 'Услуги' });
  });

  app.get('/booking', requireAuth, (req: any, res) => {
    const weather = getWeatherData();
    const services = db.prepare('SELECT * FROM services').all();
    const selectedServiceId = req.query.service || null;
    const error = req.query.error ? decodeURIComponent(req.query.error as string) : null;
    res.render('booking', { services, selectedServiceId, weather, title: 'Бронирование', error });
  });

  app.post('/booking', requireAuth, (req: any, res) => {
    const { service_id, date_day, date_slot, guests, wishes, promo_code } = req.body;
    const date = `${date_day}T${date_slot}`;
    
    // 1. Validate date is in the future
    const bookingDate = new Date(date);
    const now = new Date();
    if (bookingDate.getTime() < now.getTime() - 60000) {
      return res.redirect(`/booking?service=${service_id}&error=${encodeURIComponent('Дата и время бронирования должны быть в будущем')}`);
    }

    const existingBooking = db.prepare("SELECT id FROM bookings WHERE user_id = ? AND booking_date = ? AND status != 'cancelled'").get(req.session.userId, date);
    if (existingBooking) {
      return res.redirect(`/booking?service=${service_id}&error=${encodeURIComponent('У вас уже есть бронирование на это время')}`);
    }

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(service_id) as any;
    
    const dayOfWeek = bookingDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    let basePrice = isWeekend && service.weekend_price ? service.weekend_price : service.price;
    
    let finalPrice = basePrice * guests;
    let promoDiscount = 0;
    let promoId = null;

    if (promo_code) {
      const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND is_active = 1').get(promo_code) as any;
      if (promo) {
        promoDiscount = Math.floor(finalPrice * (promo.discount_percent / 100));
        finalPrice -= promoDiscount;
        promoId = promo.id;
      }
    }

    const currentBooked = db.prepare("SELECT SUM(guests) as count FROM bookings WHERE service_id = ? AND booking_date = ? AND status != 'cancelled'").get(service_id, date) as { count: number };
    const totalBooked = (currentBooked.count || 0) + guests;
    
    if (totalBooked > (service.capacity || 10)) {
      const available = (service.capacity || 10) - (currentBooked.count || 0);
      return res.redirect(`/booking?service=${service_id}&error=${encodeURIComponent(`К сожалению, на это время осталось всего ${available} мест(а).`)}`);
    }

    const result = db.prepare('INSERT INTO bookings (user_id, service_id, booking_date, guests, wishes, total_price, promo_code_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      req.session.userId, service_id, date, guests, wishes, finalPrice, promoId
    );

    logActivity(req.session.userId, 'Бронирование создано', `Услуга: ${service.name}, Дата: ${date}, Сумма: ${finalPrice} ₽`);

    // Handle Bundle Service (e.g., Banya)
    if (req.body.bundle_service === 'banya') {
      const banya = db.prepare("SELECT * FROM services WHERE name LIKE '%Баня%'").get() as any;
      if (banya) {
        // Create a second booking for 2 hours later, with 15% discount
        const bundleDate = new Date(bookingDate.getTime() + 2 * 60 * 60 * 1000).toISOString().replace('Z', '').split('.')[0];
        const bundlePrice = Math.floor(banya.price * 0.85); // 15% off
        db.prepare('INSERT INTO bookings (user_id, service_id, booking_date, guests, wishes, total_price, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          req.session.userId, banya.id, bundleDate, guests, 'Комбо-предложение (Скидка 15%)', bundlePrice, 'pending'
        );
      }
    }

    // SMS-уведомление клиенту (если настроен SMS_API_KEY)
    const userProfile = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) as any;
    sendSMSNotification(userProfile.phone, `Ваша бронь на ${service.name} (${date}) принята! Ждем вас.`);
    
    res.redirect(`/profile?success=booked&booking_id=${result.lastInsertRowid}`);
  });

  app.get('/payment/:booking_id', requireAuth, (req: any, res) => {
    const weather = getWeatherData();
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.session.userId) as any;
    const booking = db.prepare(`
      SELECT b.*, s.name as service_name 
      FROM bookings b 
      JOIN services s ON b.service_id = s.id 
      WHERE b.id = ? AND b.user_id = ?
    `).get(req.params.booking_id, req.session.userId) as any;
    
    if (!booking) return res.redirect('/profile');
    const error = req.query.error ? decodeURIComponent(req.query.error as string) : null;
    res.render('payment', { booking, user, weather, title: 'Оплата бронирования', error });
  });

  app.post('/payment/process', requireAuth, (req: any, res) => {
    const { booking_id, points_to_spend, cert_code } = req.body;
    
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(booking_id, req.session.userId) as any;
    if (!booking) return res.redirect('/profile');

    let currentPrice = booking.total_price;
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.session.userId) as any;

    // 1. Handle Points
    if (points_to_spend) {
      const points = parseInt(points_to_spend);
      if (points > 0) {
        if (points > user.points) {
          return res.redirect(`/payment/${booking_id}?error=${encodeURIComponent('Недостаточно баллов')}`);
        }
        const maxPointsAllowed = Math.floor(booking.total_price * 0.5);
        if (points > maxPointsAllowed) {
          return res.redirect(`/payment/${booking_id}?error=${encodeURIComponent('Можно списать не более 50% от суммы')}`);
        }
        currentPrice -= points;
        db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(points, req.session.userId);
      }
    }

    // 2. Handle Certificate
    if (cert_code) {
      const cert = db.prepare("SELECT * FROM certificates WHERE code = ? AND status = 'active'").get(cert_code) as any;
      if (!cert) {
        return res.redirect(`/payment/${booking_id}?error=${encodeURIComponent('Неверный или неактивный сертификат')}`);
      }
      
      // Enforce: only gifted certificates can be used (buyer != redeemer)
      if (Number(cert.user_id) === Number(req.session.userId)) {
        return res.redirect(`/payment/${booking_id}?error=${encodeURIComponent('Вы не можете использовать сертификат, который купили сами себе. Он предназначен для подарка другим пользователям.')}`);
      }
      
      // If certificate has recipient_email, verify it matches
      if (cert.recipient_email && cert.recipient_email !== res.locals.user.email) {
        return res.redirect(`/payment/${booking_id}?error=${encodeURIComponent('Этот сертификат принадлежит другому пользователю')}`);
      }

      const discountFromCert = Math.min(cert.amount, currentPrice);
      currentPrice -= discountFromCert;

      if (discountFromCert >= cert.amount) {
        // Delete certificate if balance becomes 0
        db.prepare("DELETE FROM certificates WHERE id = ?").run(cert.id);
      } else {
        db.prepare("UPDATE certificates SET amount = amount - ? WHERE id = ?").run(discountFromCert, cert.id);
      }
    }

    const pointsToAdd = Math.floor(currentPrice / 100);
    if (pointsToAdd > 0) {
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsToAdd, req.session.userId);
      logActivity(req.session.userId, 'Начислены баллы', `Получено: ${pointsToAdd} за оплату бронирования`);
    }

    db.prepare("UPDATE bookings SET is_paid = 1, status = 'confirmed', total_price = ? WHERE id = ?").run(currentPrice, booking_id);
    
    const serviceName = db.prepare('SELECT s.name FROM services s JOIN bookings b ON b.service_id = s.id WHERE b.id = ?').get(booking_id) as any;
    logActivity(req.session.userId, 'Оплата произведена', `Бронирование #${booking_id} (${serviceName?.name || 'услуга'}), Сумма: ${currentPrice} ₽`);
    
    res.redirect('/profile?success=paid');
  });

  app.post('/booking/cancel', requireAuth, (req: any, res) => {
    const { booking_id } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(booking_id, req.session.userId) as any;
    
    if (booking && booking.status === 'pending') {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking_id);
      logActivity(req.session.userId, 'Бронирование отменено', `ID: ${booking_id}`);
      res.redirect('/profile?success=cancelled');
    } else {
      res.redirect('/profile?error=cannot_cancel');
    }
  });

  app.post('/booking/repeat', requireAuth, (req: any, res) => {
    const { booking_id } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(booking_id, req.session.userId) as any;
    
    if (booking) {
      res.redirect(`/booking?service=${booking.service_id}`);
    } else {
      res.redirect('/profile');
    }
  });

  app.get('/faq', (req, res) => {
    const weather = getWeatherData();
    const faqs = [
      { q: 'Нужна ли специальная подготовка для сплава?', a: 'Нет, наши инструкторы проведут полный инструктаж перед началом.' },
      { q: 'Можно ли приехать с детьми?', a: 'Да, у нас есть услуги, подходящие для детей от 6 лет под присмотром родителей.' },
      { q: 'Есть ли у вас парковка?', a: 'Да, на территории базы отдыха есть бесплатная охраняемая парковка.' },
      { q: 'Что нужно брать с собой?', a: 'Удобную спортивную одежду и обувь. Все необходимое снаряжение мы выдаем.' }
    ];
    const questions = db.prepare('SELECT * FROM questions WHERE is_public = 1 ORDER BY created_at DESC').all();
    res.render('faq', { faqs, questions, weather, title: 'Вопросы и ответы', success: req.query.success });
  });

  app.post('/faq/ask', requireAuth, (req: any, res) => {
    const { question } = req.body;
    db.prepare('INSERT INTO questions (user_id, question) VALUES (?, ?)').run(req.session.userId, question);
    res.redirect('/faq?success=question_sent');
  });

  app.get('/gallery', (req, res) => {
    const weather = getWeatherData();
    const photos = db.prepare('SELECT * FROM gallery_photos ORDER BY created_at DESC').all();
    res.render('gallery', { photos, weather, title: 'Галерея' });
  });

  app.get('/events', (req, res) => {
    const weather = getWeatherData();
    const events = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all();
    res.render('events', { events, weather, title: 'Афиша мероприятий' });
  });

  app.post('/events/book', requireAuth, (req: any, res) => {
    const { event_id, tickets } = req.body;
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(event_id) as any;
    
    if (!event) return res.redirect('/events');
    if (event.tickets_sold + parseInt(tickets) > event.capacity) {
      return res.redirect('/events?error=sold_out');
    }

    const totalPrice = event.price * parseInt(tickets);
    const result = db.prepare('INSERT INTO event_bookings (user_id, event_id, tickets, total_price) VALUES (?, ?, ?, ?)').run(
      req.session.userId, event_id, tickets, totalPrice
    );
    db.prepare('UPDATE events SET tickets_sold = tickets_sold + ? WHERE id = ?').run(tickets, event_id);
    
    logActivity(req.session.userId, 'Билеты куплены', `Мероприятие: ${event.title}, Билетов: ${tickets}, Сумма: ${totalPrice} ₽`);
    
    res.redirect(`/payment/event/${result.lastInsertRowid}`);
  });

  app.get('/payment/event/:booking_id', requireAuth, (req: any, res) => {
    const weather = getWeatherData();
    const eb = db.prepare(`
      SELECT eb.*, e.title as service_name, e.price as unit_price
      FROM event_bookings eb 
      JOIN events e ON eb.event_id = e.id 
      WHERE eb.id = ? AND eb.user_id = ?
    `).get(req.params.booking_id, req.session.userId) as any;
    
    if (!eb) return res.redirect('/profile');
    
    // Adapted for payment.ejs
    const booking = {
      id: eb.id,
      service_name: eb.service_name,
      total_price: eb.total_price,
      guests: eb.tickets,
      is_paid: 0,
      is_event: true
    };
    
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.session.userId);
    res.render('payment', { booking, user, weather, title: 'Оплата билетов' });
  });

  app.post('/payment/event/process', requireAuth, (req: any, res) => {
    const { booking_id, points_to_spend, cert_code } = req.body;
    const eb = db.prepare('SELECT * FROM event_bookings WHERE id = ? AND user_id = ?').get(booking_id, req.session.userId) as any;
    
    if (!eb) return res.redirect('/profile');

    let currentPrice = eb.total_price;
    const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.session.userId) as any;

    // 1. Handle Points
    if (points_to_spend) {
      const points = parseInt(points_to_spend);
      if (points > 0) {
        if (points > user.points) {
          return res.redirect(`/payment/event/${booking_id}?error=${encodeURIComponent('Недостаточно баллов')}`);
        }
        const maxPointsAllowed = Math.floor(eb.total_price * 0.5);
        if (points > maxPointsAllowed) {
          return res.redirect(`/payment/event/${booking_id}?error=${encodeURIComponent('Можно списать не более 50% от суммы')}`);
        }
        currentPrice -= points;
        db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(points, req.session.userId);
      }
    }

    // 2. Handle Certificate
    if (cert_code) {
      const cert = db.prepare("SELECT * FROM certificates WHERE code = ? AND status = 'active'").get(cert_code) as any;
      if (!cert) {
        return res.redirect(`/payment/event/${booking_id}?error=${encodeURIComponent('Неверный или неактивный сертификат')}`);
      }
      
      // Enforce: only gifted certificates can be used (buyer != redeemer)
      if (Number(cert.user_id) === Number(req.session.userId)) {
        return res.redirect(`/payment/event/${booking_id}?error=${encodeURIComponent('Вы не можете использовать сертификат, который купили сами себе.')}`);
      }

      const discountFromCert = Math.min(cert.amount, currentPrice);
      currentPrice -= discountFromCert;

      if (discountFromCert >= cert.amount) {
        db.prepare("DELETE FROM certificates WHERE id = ?").run(cert.id);
      } else {
        db.prepare("UPDATE certificates SET amount = amount - ? WHERE id = ?").run(discountFromCert, cert.id);
      }
    }

    const pointsToAdd = Math.floor(currentPrice / 100);
    if (pointsToAdd > 0) {
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsToAdd, req.session.userId);
      logActivity(req.session.userId, 'Начислены баллы', `Получено: ${pointsToAdd} за покупку билетов`);
    }

    db.prepare('UPDATE event_bookings SET is_paid = 1, total_price = ? WHERE id = ?').run(currentPrice, booking_id);

    // Notify Admin

    res.redirect('/profile?success=event_paid');
  });

  const requireStaff = (req: any, res: any, next: any) => {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId) as any;
    if (user && (user.role === 'admin' || user.role === 'instructor')) {
      next();
    } else {
      res.redirect('/login');
    }
  };

  app.get('/staff', requireAuth, requireStaff, (req: any, res) => {
    const assignments = db.prepare(`
      SELECT a.*, b.booking_date, b.guests, b.total_price, s.name as service_name, u.name as client_name
      FROM assignments a
      JOIN bookings b ON a.booking_id = b.id
      JOIN services s ON b.service_id = s.id
      JOIN users u ON b.user_id = u.id
      WHERE a.instructor_id = ?
      ORDER BY b.booking_date ASC
    `).all(req.session.userId) as any[];
    
    const stats = assignments.reduce((acc, curr) => {
      if (curr.status === 'completed') {
        acc.totalCompleted++;
        acc.totalEarned += (curr.total_price * 0.2);
      }
      return acc;
    }, { totalCompleted: 0, totalEarned: 0 });

    const equipment = db.prepare('SELECT * FROM equipment').all();
    const notes = db.prepare(`
      SELECT n.*, u.name as author_name 
      FROM staff_notes n 
      JOIN users u ON n.author_id = u.id 
      ORDER BY n.created_at DESC LIMIT 10
    `).all();

    const staffRating = getStaffRating(Number(req.session.userId));

    const weather = getWeatherData();
    res.render('staff', { 
      assignments, 
      stats, 
      equipment,
      notes,
      weather,
      staffRating,
      title: 'Рабочее место' 
    });
  });

  app.get('/staff/verify/:id', requireAuth, requireStaff, (req: any, res) => {
    const weather = getWeatherData();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) as any;
    const booking = db.prepare(`
      SELECT b.*, s.name as service_name, s.price as service_price,
             u.name as user_name, u.email as user_email, u.role as user_role
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN users u ON b.user_id = u.id
      WHERE b.id = ?
    `).get(req.params.id) as any;

    if (!booking) {
      return res.redirect('/staff?error=booking_not_found');
    }

    res.render('staff-verification', { booking, user, weather, title: 'Проверка бронирования' });
  });

  app.post('/staff/status', requireAuth, requireStaff, (req: any, res: any) => {
    const { status } = req.body;
    db.prepare('UPDATE users SET staff_status = ? WHERE id = ?').run(status, req.session.userId);
    res.json({ success: true });
  });

  app.post('/staff/equipment/status', requireAuth, requireStaff, (req: any, res: any) => {
    const { id, status, note } = req.body;
    db.prepare('UPDATE equipment SET status = ?, status_note = ?, last_check = ? WHERE id = ?').run(status, note, new Date().toISOString(), id);
    res.json({ success: true });
  });

  app.post('/staff/assignment/status', requireAuth, requireStaff, (req: any, res: any) => {
    const { assignment_id, action } = req.body;
    if (action === 'confirm') {
      db.prepare("UPDATE assignments SET confirmation_status = 'confirmed' WHERE id = ?").run(assignment_id);
    } else if (action === 'complete') {
      db.prepare("UPDATE assignments SET status = 'completed' WHERE id = ?").run(assignment_id);
      
      const assignment = db.prepare(`
          SELECT b.user_id 
          FROM assignments a 
          JOIN bookings b ON a.booking_id = b.id 
          WHERE a.id = ?
      `).get(assignment_id) as any;
      
      if (assignment) {
          db.prepare('UPDATE users SET points = points + 50 WHERE id = ?').run(assignment.user_id);
      }
    }
    res.json({ success: true });
  });

  app.post('/staff/note', requireAuth, requireStaff, (req: any, res) => {
    const { content, priority } = req.body;
    db.prepare('INSERT INTO staff_notes (author_id, content, priority) VALUES (?, ?, ?)').run(req.session.userId, content, priority);
    res.redirect('/staff');
  });

  app.post('/api/review/staff', requireAuth, (req: any, res: any) => {
    const { assignment_id, staff_id, content, rating } = req.body;
    
    const wordCount = content ? content.trim().split(/\s+/).filter(Boolean).length : 0;
    if (wordCount < 20) {
      return res.status(400).json({ error: `Комментарий слишком короткий (${wordCount}/20 слов). Пожалуйста, напишите подробнее.` });
    }

    db.prepare('INSERT INTO staff_reviews (assignment_id, staff_id, user_id, rating, content) VALUES (?, ?, ?, ?, ?)')
      .run(assignment_id, staff_id, req.session.userId, rating, content);
    
    res.json({ success: true });
  });

  app.post('/booking/combo', requireAuth, (req: any, res) => {
    const { serviceIds, totalAmount } = req.body;
    const ids = serviceIds.split(',').map(Number);
    const date = new Date().toISOString().split('T')[0] + ' 12:00'; // Default time
    
    // Create multiple bookings as a batch
    const stmt = db.prepare('INSERT INTO bookings (user_id, service_id, booking_date, guests, status) VALUES (?, ?, ?, ?, ?)');
    ids.forEach((sid: number) => {
        stmt.run(req.session.userId, sid, date, 1, 'confirmed');
    });

    res.json({ success: true, redirect: '/profile?success=combo_booked' });
  });

  app.get('/notifications-help', (req, res) => {
    const weather = getWeatherData();
    res.render('notifications-help', { weather, title: 'Помощь по уведомлениям' });
  });

  app.post('/admin/assign', requireAuth, requireAdmin, (req: any, res: any) => {
    const { booking_id, instructor_id, note } = req.body;
    const instructor = db.prepare('SELECT staff_status as status FROM users WHERE id = ?').get(instructor_id) as any;
    
    // If instructor is busy or off, set confirmation to pending
    const confirmationStatus = (instructor.status === 'busy' || instructor.status === 'off') ? 'pending_confirmation' : 'confirmed';
    
    db.prepare('INSERT INTO assignments (booking_id, instructor_id, note, confirmation_status) VALUES (?, ?, ?, ?)').run(
      booking_id, instructor_id, note, confirmationStatus
    );
    res.redirect('/admin#staff-coordination');
  });

  app.get('/contact', (req, res) => {
    const weather = getWeatherData();
    res.render('contact', { weather, title: 'Контакты', success: req.query.success });
  });

  app.post('/contact', (req, res) => {
    // In a real app, we would send an email here
    res.redirect('/contact?success=sent');
  });

  app.get('/login', (req, res) => {
    const weather = getWeatherData();
    res.render('login', { weather, error: null, title: 'Вход' });
  });

  app.post('/login', (req: any, res) => {
    const { email, password } = req.body;
    console.log(`[DEBUG] Login attempt for: ${email}`);
    
    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
      
      if (user && bcrypt.compareSync(password, user.password)) {
        console.log(`[DEBUG] Login successful for user ID: ${user.id}`);
        
        // Ensure userId is a number (better-sqlite3 might return BigInt)
        req.session.userId = Number(user.id);
        console.log('[DEBUG] Session set, redirecting to /profile');
        res.redirect('/profile');
      } else {
        console.log('[DEBUG] Login failed: invalid credentials for', email);
        res.render('login', { weather: getWeatherData(), error: 'Неверный email или пароль', title: 'Вход' });
      }
    } catch (error) {
      console.error('[DEBUG] Login database error:', error);
      res.render('login', { weather: getWeatherData(), error: 'Ошибка базы данных', title: 'Вход' });
    }
  });

  app.get('/register', (req, res) => {
    const weather = getWeatherData();
    res.render('register', { weather, error: null, title: 'Регистрация' });
  });

  app.post('/register', (req: any, res) => {
    const { email, password, name, phone } = req.body;
    console.log(`[DEBUG] Registration attempt for: ${email}`);
    
    // Password validation: min 6 chars, uppercase, lowercase, special char
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=.{6,})/;
    if (!passwordRegex.test(password)) {
      return res.render('register', { 
        error: 'Пароль должен быть от 6 символов, содержать заглавные и строчные буквы, цифры и спецсимвол (!@#$%^&*)', 
        title: 'Регистрация',
        weather: getWeatherData() 
      });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    
    try {
      const result = db.prepare('INSERT INTO users (email, password, name, phone) VALUES (?, ?, ?, ?)').run(
        email, hashedPassword, name, phone
      );
      
      const newUserId = Number(result.lastInsertRowid);
      console.log(`[DEBUG] Registration successful, new user ID: ${newUserId}`);
      
      req.session.userId = newUserId;
      console.log('[DEBUG] Session set, redirecting to /profile');
      res.redirect('/profile');
    } catch (e: any) {
      console.error('[DEBUG] Registration error:', e.message);
      res.render('register', { weather: getWeatherData(), error: 'Email уже занят или произошла ошибка', title: 'Регистрация' });
    }
  });

  app.get('/logout', (req: any, res) => {
    req.session = null;
    res.redirect('/');
  });

  app.get('/certificates', (req, res) => {
    const weather = getWeatherData();
    const error = req.query.error ? decodeURIComponent(req.query.error as string) : null;
    res.render('certificates', { weather, title: 'Подарочные сертификаты Нико', error });
  });

  app.post('/certificates/buy', requireAuth, (req: any, res) => {
    const { amount, recipient_email, sender_name, message } = req.body;
    
    // Validate recipient if provided
    if (recipient_email) {
      const recipient = db.prepare('SELECT id FROM users WHERE email = ?').get(recipient_email);
      if (!recipient) {
        return res.redirect('/certificates?error=' + encodeURIComponent('Пользователь с такой почтой не зарегистрирован. Получатель должен иметь аккаунт в Niko.'));
      }
    }

    const code = 'CERT-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    db.prepare('INSERT INTO certificates (user_id, code, amount, recipient_email, sender_name, message) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.session.userId, code, amount, recipient_email || null, sender_name, message
    );
    logActivity(req.session.userId, 'Сертификат куплен', `Номинал: ${amount} ₽, Получатель: ${recipient_email || 'не указан'}`);
    res.redirect('/profile?success=cert_purchased');
  });

  app.get('/combos', (req, res) => {
    const weather = getWeatherData();
    const services = db.prepare('SELECT * FROM services').all();
    res.render('combos', { services, weather, title: 'Комбо-туры и пакеты' });
  });

  app.get('/profile', requireAuth, (req: any, res) => {
    console.log(`[DEBUG] Accessing /profile - UserID: ${req.session.userId}`);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) as any;
    
    const bookings = db.prepare(`
      SELECT b.*, s.name as service_name, s.price as service_price,
             a.id as assignment_id, a.instructor_id as staff_id, a.status as assignment_status,
             iu.name as staff_name,
             (SELECT COUNT(*) FROM staff_reviews WHERE assignment_id = a.id) as is_reviewed
      FROM bookings b 
      JOIN services s ON b.service_id = s.id 
      LEFT JOIN assignments a ON b.id = a.booking_id
      LEFT JOIN users iu ON a.instructor_id = iu.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.session.userId);

    const eventBookings = db.prepare(`
      SELECT eb.*, e.title as event_title, e.event_date
      FROM event_bookings eb
      JOIN events e ON eb.event_id = e.id
      WHERE eb.user_id = ?
      ORDER BY eb.created_at DESC
    `).all(req.session.userId);

    const certificates = db.prepare('SELECT * FROM certificates WHERE user_id = ? OR recipient_email = ?').all(req.session.userId, user.email);
    const history = db.prepare('SELECT * FROM user_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.session.userId);
    
    // Achievements logic
    const achievements = db.prepare('SELECT * FROM achievements').all() as any[];
    const unlockedIds = (db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(req.session.userId) as any[]).map(a => a.achievement_id);
    
    // Auto-unlock achievements based on points
    achievements.forEach(ach => {
        if (!unlockedIds.includes(ach.id) && (user.points || 0) >= ach.points_required) {
            try {
                db.prepare('INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)').run(user.id, ach.id);
                unlockedIds.push(ach.id);
            } catch(e) {}
        }
    });

    const userAchievements = achievements.map(ach => ({
        ...ach,
        isUnlocked: unlockedIds.includes(ach.id)
    }));

    const weather = getWeatherData();
    const promoCodes = db.prepare("SELECT * FROM promo_codes WHERE is_active = 1 AND (expiry_date IS NULL OR expiry_date > datetime('now'))").all();

    res.render('profile', { 
        bookings, 
        eventBookings, 
        user, 
        certificates, 
        userAchievements,
        history,
        weather,
        promoCodes,
        title: 'Личный кабинет', 
        success: req.query.success 
    });
  });

  app.post('/profile/edit', requireAuth, (req: any, res) => {
    const { name, phone } = req.body;
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(
      name, phone, req.session.userId
    );
    res.redirect('/profile?success=updated');
  });

  app.get('/news', (req, res) => {
    const weather = getWeatherData();
    const news = [
      { id: 1, title: 'Открытие сезона 2026', date: '2026-03-15', content: 'Мы рады сообщить об открытии нового сезона активного отдыха!', image: SITE_IMAGES.news[0] },
      { id: 2, title: 'Новые маршруты для квадроциклов', date: '2026-03-20', content: 'Мы разработали 3 новых экстремальных маршрута по лесному массиву.', image: SITE_IMAGES.news[1] },
      { id: 3, title: 'Скидки на групповые бронирования', date: '2026-03-25', content: 'При бронировании от 5 человек действует скидка 15% на все услуги.', image: SITE_IMAGES.news[2] }
    ];
    res.render('news', { news, weather, title: 'Новости' });
  });



  app.post('/faq/ask', requireAuth, (req: any, res) => {
    const { question } = req.body;
    db.prepare('INSERT INTO questions (user_id, question) VALUES (?, ?)').run(req.session.userId, question);
    res.redirect('/faq?success=asked');
  });

  app.post('/admin/equipment/add', requireAuth, requireAdmin, (req: any, res: any) => {
    const { name } = req.body;
    db.prepare('INSERT INTO equipment (name, status) VALUES (?, ?)').run(name, 'active');
    res.redirect('/admin#staff-coordination');
  });

  app.post('/admin/equipment/delete', requireAuth, requireAdmin, (req: any, res: any) => {
    const { id } = req.body;
    db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
    res.json({ success: true });
  });

  app.get('/admin', requireAuth, requireAdmin, (req: any, res: any) => {
    const weather = getWeatherData();
    const bookings = db.prepare(`
      SELECT b.*, s.name as service_name, s.price, u.email as user_email, u.name as user_name
      FROM bookings b 
      JOIN services s ON b.service_id = s.id 
      JOIN users u ON b.user_id = u.id
      ORDER BY b.created_at DESC
    `).all();
    const users = db.prepare('SELECT * FROM users').all();
    const services = db.prepare('SELECT * FROM services').all();
    const promoCodes = db.prepare('SELECT * FROM promo_codes').all();
    const reviews = db.prepare(`
      SELECT r.*, u.name as user_name, u.email as user_email
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `).all();
    const questions = db.prepare(`
      SELECT q.*, u.name as user_name, u.email as user_email
      FROM questions q
      JOIN users u ON q.user_id = u.id
      ORDER BY q.created_at DESC
    `).all();
    const instructorsRaw = db.prepare(`
      SELECT u.*, 
             (SELECT COUNT(*) FROM assignments WHERE instructor_id = u.id) as total_assignments
      FROM users u 
      WHERE u.role = 'instructor'
    `).all() as any[];
    const instructors = instructorsRaw.map((u) => ({
      ...u,
      average_rating: getStaffRating(u.id),
    }));
    const equipment = db.prepare('SELECT * FROM equipment').all();
    const unassignedBookings = db.prepare(`
      SELECT b.*, s.name as service_name, u.name as user_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN users u ON b.user_id = u.id
      LEFT JOIN assignments a ON b.id = a.booking_id
      WHERE a.id IS NULL AND b.status = 'confirmed'
      ORDER BY b.booking_date ASC
    `).all();

    const error = req.query.error ? decodeURIComponent(req.query.error as string) : null;
    res.render('admin', { bookings, users, services, reviews, promoCodes, questions, instructors, unassignedBookings, weather, equipment, title: 'Админ-панель', error });
  });

  app.post('/admin/service/edit', requireAuth, requireAdmin, (req: any, res: any) => {
    const { id, name, description, price, weekend_price, category, image_url, capacity } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'Не указаны id или название' });
    }
    const priceNum = Number(price);
    const weekendNum = weekend_price ? Number(weekend_price) : priceNum;
    db.prepare(
      'UPDATE services SET name = ?, description = ?, price = ?, weekend_price = ?, category = ?, image_url = ?, capacity = ? WHERE id = ?'
    ).run(
      String(name).trim(),
      String(description || '').trim(),
      priceNum,
      weekendNum,
      String(category || 'active'),
      image_url ? String(image_url).trim() : null,
      capacity ? Number(capacity) : 10,
      Number(id)
    );
    res.json({ success: true });
  });

  app.post('/admin/service/delete', requireAuth, requireAdmin, (req: any, res: any) => {
    const { id } = req.body;
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    res.json({ success: true });
  });

  app.post('/admin/service/add', requireAuth, requireAdmin, (req: any, res: any) => {
    const { name, description, price, weekend_price, category, image_url, capacity } = req.body;
    const priceNum = Number(price);
    db.prepare(
      'INSERT INTO services (name, description, price, weekend_price, category, image_url, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      String(name).trim(),
      String(description || '').trim(),
      priceNum,
      weekend_price ? Number(weekend_price) : priceNum,
      String(category || 'active'),
      image_url || SITE_IMAGES.defaultService,
      capacity ? Number(capacity) : 10
    );
    res.json({ success: true });
  });

  app.post('/admin/staff/rating', requireAuth, requireAdmin, (req: any, res: any) => {
    const { staff_id, rating } = req.body;
    const ratingNum = Number(rating);
    if (!staff_id || Number.isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5) {
      return res.status(400).json({ success: false, error: 'Рейтинг от 0 до 5' });
    }
    const staff = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'instructor'").get(staff_id);
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
    }
    db.prepare('UPDATE users SET rating_override = ? WHERE id = ?').run(ratingNum, staff_id);
    res.json({ success: true });
  });

  app.post('/admin/question/answer', requireAuth, requireAdmin, (req: any, res: any) => {
    const { question_id, answer, is_public } = req.body;
    db.prepare('UPDATE questions SET answer = ?, is_public = ? WHERE id = ?').run(
      answer, is_public === 'on' ? 1 : 0, question_id
    );
    res.redirect('/admin#questions');
  });

  app.post('/admin/promo/add', requireAuth, requireAdmin, (req: any, res: any) => {
    const { code, discount_percent, expiry_date } = req.body;
    db.prepare('INSERT INTO promo_codes (code, discount_percent, expiry_date) VALUES (?, ?, ?)')
      .run(code, discount_percent, expiry_date);
    res.redirect('/admin');
  });

  app.post('/admin/promo/toggle', requireAuth, requireAdmin, (req: any, res: any) => {
    const { id, is_active } = req.body;
    db.prepare('UPDATE promo_codes SET is_active = ? WHERE id = ?').run(is_active === '1' ? 0 : 1, id);
    res.redirect('/admin');
  });

  app.post('/admin/booking/status', requireAuth, requireAdmin, (req: any, res: any) => {
    const { booking_id, status } = req.body;
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, booking_id);
    res.redirect('/admin');
  });

  app.post('/admin/user/role', requireAuth, requireAdmin, (req: any, res: any) => {
    const { user_id, role } = req.body;
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user_id);
    res.redirect('/admin');
  });

  app.post('/admin/user/delete', requireAuth, requireAdmin, (req: any, res: any) => {
    const userId = Number(req.body.user_id);
    if (!userId) {
      return res.redirect('/admin?error=' + encodeURIComponent('Не указан пользователь'));
    }
    if (userId === Number(req.session.userId)) {
      return res.redirect('/admin?error=' + encodeURIComponent('Нельзя удалить свой аккаунт'));
    }

    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as { id: number; role: string } | undefined;
    if (!target) {
      return res.redirect('/admin?error=' + encodeURIComponent('Пользователь не найден'));
    }

    if (target.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
      if (adminCount.c <= 1) {
        return res.redirect('/admin?error=' + encodeURIComponent('Нельзя удалить последнего администратора'));
      }
    }

    try {
      deleteUserById(userId);
      res.redirect('/admin');
    } catch (err) {
      console.error('Delete user error:', err);
      res.redirect('/admin?error=' + encodeURIComponent('Не удалось удалить пользователя'));
    }
  });

  app.post('/admin/review/delete', requireAuth, requireAdmin, (req: any, res: any) => {
    const reviewId = Number(req.body.review_id);
    if (!reviewId) {
      return res.redirect('/admin?error=' + encodeURIComponent('Не указан отзыв'));
    }
    try {
      const result = db.prepare('DELETE FROM reviews WHERE id = ?').run(reviewId);
      if (result.changes === 0) {
        return res.redirect('/admin?error=' + encodeURIComponent('Отзыв не найден'));
      }
      res.redirect('/admin');
    } catch (err) {
      console.error('Delete review error:', err);
      res.redirect('/admin?error=' + encodeURIComponent('Не удалось удалить отзыв'));
    }
  });

  // End of Routes
  
  // Vite setup (moved after routes to avoid interference with EJS pages)
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(ROOT_DIR, 'public')));
    app.use(express.static(path.join(ROOT_DIR, 'dist')));
  }

  const publicUrl =
    process.env.APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${PORT}`);
  console.log(`Сервер готов: ${publicUrl} (порт ${PORT}, режим ${process.env.NODE_ENV || 'development'})`);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[startup] Ошибка инициализации:', message);
    app.get('*', (_req, res) => {
      res.status(503).type('text/plain').send(`Ошибка запуска: ${message}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});

