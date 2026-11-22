import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initDatabase,
  UPLOADS_DIR,
  getBangkokNowString,
  getBangkokDateString,
} from './src/server/db.ts';

initDatabase();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));

// Session signing key (env var or ephemeral in-memory fallback)
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.trim().length >= 16
    ? process.env.ADMIN_SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Password hashing helpers using scrypt + timingSafeEqual
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function timingSafeCompareStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

interface SessionPayload {
  username: string;
  role: string;
  exp: number;
}

function signSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.username || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface AuthedRequest extends Request {
  admin?: SessionPayload;
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบเจ้าของร้านก่อนดำเนินการ' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
    return;
  }
  req.admin = payload;
  next();
}

// Strict multer file upload validation (JPG, JPEG, PNG, WEBP up to 5MB)
const ALLOWED_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = ALLOWED_MIME_EXT[file.mimetype.toLowerCase()] || '.jpg';
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 8,
  },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_EXT[mime] || !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพ JPG, JPEG, PNG และ WEBP เท่านั้น'));
      return;
    }
    cb(null, true);
  },
});

// Safe removal of locally uploaded images (strictly confined to UPLOADS_DIR)
function deleteLocalUploadIfOwned(imageUrl: string | null | undefined) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return;
  const filename = path.basename(imageUrl);
  const resolvedPath = path.resolve(UPLOADS_DIR, filename);
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep)) return;
  if (fs.existsSync(resolvedPath)) {
    try {
      fs.unlinkSync(resolvedPath);
    } catch {
      // Ignore file removal races
    }
  }
}

// Serve uploaded images with path confinement
app.get('/uploads/:filename', (req: Request, res: Response) => {
  const safeName = path.basename(String(req.params.filename || ''));
  const resolved = path.resolve(UPLOADS_DIR, safeName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
    res.status(404).json({ error: 'ไม่พบไฟล์รูปภาพ' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolved);
});

// Domain helpers
function computeStockState(status: string, stock: number, capacity: number): string {
  if (status !== 'active') return 'closed';
  if (stock <= 0) return 'sold_out';
  const lowThreshold = Math.max(5, Math.ceil(capacity * 0.2));
  if (stock <= lowThreshold) return 'low';
  return 'ready';
}

function hydrateProducts(rows: any[]) {
  const imgStmt = db.prepare(`
    SELECT id, product_id, image_url, drive_file_id, is_primary, display_order, created_at
    FROM product_images
    WHERE product_id = ?
    ORDER BY is_primary DESC, display_order ASC, id ASC
  `);

  return rows.map((p) => {
    const images = imgStmt.all(p.id) as any[];
    const primary = images.find((i) => i.is_primary === 1) || images[0] || null;
    return {
      ...p,
      images,
      primary_image: primary ? primary.image_url : null,
      stock_state: computeStockState(p.status, p.stock, p.capacity),
    };
  });
}

function hydrateOrders(orderRows: any[]) {
  const itemStmt = db.prepare(`
    SELECT id, order_id, product_id, product_name, product_image, quantity, price, subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY id ASC
  `);
  return orderRows.map((o) => ({
    ...o,
    items: itemStmt.all(o.id),
  }));
}

function getSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM store_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// ===================== PUBLIC STOREFRONT API =====================

app.get('/api/store/config', (_req: Request, res: Response) => {
  const settings = getSettingsMap();
  res.json({
    shipping_mode: settings.shipping_mode === 'pending' ? 'pending' : 'fixed',
    shipping_fee: Number(settings.shipping_fee || 40),
    free_shipping_threshold: Number(settings.free_shipping_threshold || 500),
    store_logo_url: settings.store_logo_url || null,
  });
});

app.get('/api/products', (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT * FROM products
       WHERE is_deleted = 0 AND status = 'active'
       ORDER BY (CASE WHEN stock > 0 THEN 0 ELSE 1 END) ASC, id ASC`
    )
    .all();
  res.json({ products: hydrateProducts(rows) });
});

app.post('/api/cart/validate', (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    res.status(400).json({ valid: false, error: 'ตะกร้าสินค้าว่างเปล่า' });
    return;
  }

  const issues: Array<{ productId: number; name: string; available: number; requested: number }> = [];
  const checkStmt = db.prepare(
    'SELECT id, name, stock, status, is_deleted FROM products WHERE id = ?'
  );

  for (const item of items) {
    const productId = Number(item.productId);
    const requested = Math.max(0, Math.floor(Number(item.quantity)));
    const prod = checkStmt.get(productId) as any;
    if (!prod || prod.is_deleted === 1 || prod.status !== 'active') {
      issues.push({ productId, name: prod?.name || 'สินค้า', available: 0, requested });
    } else if (requested <= 0 || prod.stock < requested) {
      issues.push({ productId, name: prod.name, available: prod.stock, requested });
    }
  }

  if (issues.length > 0) {
    res.status(409).json({
      valid: false,
      error: 'สินค้าบางรายการมีจำนวนคงเหลือไม่เพียงพอ กรุณาปรับจำนวนในตะกร้า',
      issues,
    });
    return;
  }

  res.json({ valid: true });
});

// Atomic Checkout Transaction with Idempotency Key
app.post('/api/orders', (req: Request, res: Response) => {
  const { customer, items, note, idempotencyKey } = req.body || {};

  const name = String(customer?.name || '').trim();
  const phone = String(customer?.phone || '').trim();
  const instagram = String(customer?.instagram || '').trim();
  const address = String(customer?.address || '').trim();
  const cleanNote = String(note || '').trim().slice(0, 500);
  const cleanIdempotency =
    typeof idempotencyKey === 'string' && idempotencyKey.trim().length >= 8
      ? idempotencyKey.trim().slice(0, 120)
      : null;

  if (!name || name.length < 2 || name.length > 120) {
    res.status(400).json({ error: 'กรุณากรอกชื่อ–นามสกุลให้ถูกต้อง' });
    return;
  }
  const phoneDigits = normalizePhone(phone);
  if (phoneDigits.length < 9 || phoneDigits.length > 15) {
    res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง (9–15 หลัก)' });
    return;
  }
  if (!instagram || instagram.length > 80) {
    res.status(400).json({ error: 'กรุณากรอกชื่อ Instagram' });
    return;
  }
  if (!address || address.length < 8 || address.length > 500) {
    res.status(400).json({ error: 'กรุณากรอกที่อยู่จัดส่งให้ครบถ้วน' });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ' });
    return;
  }

  // Prevent duplicate submission if same idempotency key already created an order
  if (cleanIdempotency) {
    const existing = db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                c.instagram AS customer_instagram, c.address AS customer_address
         FROM orders o JOIN customers c ON o.customer_id = c.id
         WHERE o.idempotency_key = ?`
      )
      .get(cleanIdempotency);
    if (existing) {
      res.status(200).json({ order: hydrateOrders([existing])[0], deduplicated: true });
      return;
    }
  }

  // Consolidate duplicate productIds in payload
  const consolidated = new Map<number, number>();
  for (const raw of items) {
    const pid = Number(raw?.productId);
    const qty = Math.floor(Number(raw?.quantity));
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 200) {
      res.status(400).json({ error: 'จำนวนสินค้าไม่ถูกต้อง' });
      return;
    }
    consolidated.set(pid, (consolidated.get(pid) || 0) + qty);
  }

  const settings = getSettingsMap();
  const shippingMode = settings.shipping_mode === 'pending' ? 'pending' : 'fixed';
  const baseShippingFee = Number(settings.shipping_fee || 40);
  const freeThreshold = Number(settings.free_shipping_threshold || 500);
  const nowStr = getBangkokNowString();

  try {
    const createdOrderId = db.transaction(() => {
      const getProd = db.prepare(`
        SELECT p.*,
          (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, display_order ASC LIMIT 1) AS primary_image
        FROM products p
        WHERE p.id = ?
      `);
      const atomicDeduct = db.prepare(`
        UPDATE products
        SET stock = stock - ?, sold = sold + ?, updated_at = ?
        WHERE id = ? AND stock >= ? AND status = 'active' AND is_deleted = 0
      `);

      const verifiedLines: Array<{
        productId: number;
        name: string;
        image: string | null;
        price: number;
        quantity: number;
        subtotal: number;
      }> = [];

      let subtotal = 0;

      for (const [productId, qty] of consolidated.entries()) {
        const prod = getProd.get(productId) as any;
        if (!prod || prod.is_deleted === 1 || prod.status !== 'active') {
          throw new Error(`เมนู "${prod?.name || 'ที่เลือก'}" ปิดการขายแล้ว`);
        }
        if (prod.stock < qty) {
          throw new Error(
            prod.stock === 0
              ? `เมนู "${prod.name}" หมดแล้ว (SOLD OUT)`
              : `เมนู "${prod.name}" เหลือเพียง ${prod.stock} ชิ้น`
          );
        }

        const updateRes = atomicDeduct.run(qty, qty, nowStr, productId, qty);
        if (updateRes.changes !== 1) {
          throw new Error(`เมนู "${prod.name}" มีจำนวนคงเหลือไม่พอสำหรับออเดอร์นี้`);
        }

        const lineSub = Number(prod.price) * qty;
        subtotal += lineSub;
        verifiedLines.push({
          productId,
          name: prod.name,
          image: prod.primary_image || null,
          price: Number(prod.price),
          quantity: qty,
          subtotal: lineSub,
        });
      }

      const custInfo = db
        .prepare(
          `INSERT INTO customers (name, phone, instagram, address, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(name, phone, instagram.startsWith('@') ? instagram : `@${instagram}`, address, nowStr);
      const customerId = Number(custInfo.lastInsertRowid);

      const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM orders').get() as {
        maxId: number;
      };
      const nextNum = maxRow.maxId + 1;
      const orderNumber = `BT-${String(nextNum).padStart(4, '0')}`;

      let shippingFee: number | null = null;
      let total = subtotal;
      if (shippingMode === 'fixed') {
        shippingFee = freeThreshold > 0 && subtotal >= freeThreshold ? 0 : baseShippingFee;
        total = subtotal + shippingFee;
      }

      const orderInfo = db
        .prepare(
          `INSERT INTO orders
            (order_number, idempotency_key, customer_id, subtotal, shipping_fee, shipping_mode, total, note, status, is_read, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
        )
        .run(
          orderNumber,
          cleanIdempotency,
          customerId,
          subtotal,
          shippingFee,
          shippingMode,
          total,
          cleanNote,
          nowStr,
          nowStr
        );

      const orderId = Number(orderInfo.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const line of verifiedLines) {
        insertItem.run(
          orderId,
          line.productId,
          line.name,
          line.image,
          line.quantity,
          line.price,
          line.subtotal
        );
      }

      return orderId;
    })();

    const fullOrder = db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                c.instagram AS customer_instagram, c.address AS customer_address
         FROM orders o JOIN customers c ON o.customer_id = c.id
         WHERE o.id = ?`
      )
      .get(createdOrderId);

    res.status(201).json({ order: hydrateOrders([fullOrder])[0] });
  } catch (err: any) {
    res.status(409).json({ error: err?.message || 'ไม่สามารถสร้างออเดอร์ได้ กรุณาลองใหม่อีกครั้ง' });
  }
});

// Privacy-protected Customer Order Lookup (requires BOTH orderNumber and matching phone)
app.post('/api/orders/lookup', (req: Request, res: Response) => {
  const orderNumber = String(req.body?.orderNumber || '').trim().toUpperCase();
  const phoneInput = normalizePhone(String(req.body?.phone || ''));

  if (!orderNumber || phoneInput.length < 9) {
    res.status(400).json({ error: 'กรุณากรอกเลขที่ออเดอร์และเบอร์โทรศัพท์ที่ใช้สั่งซื้อให้ครบถ้วน' });
    return;
  }

  const orderRow = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
              c.instagram AS customer_instagram, c.address AS customer_address
       FROM orders o JOIN customers c ON o.customer_id = c.id
       WHERE UPPER(o.order_number) = ?`
    )
    .get(orderNumber) as any;

  if (!orderRow) {
    res.status(404).json({ error: 'ไม่พบข้อมูลออเดอร์ กรุณาตรวจสอบเลขที่ออเดอร์และเบอร์โทรศัพท์' });
    return;
  }

  const storedPhone = normalizePhone(orderRow.customer_phone || '');
  const phoneMatches = storedPhone === phoneInput;

  if (!phoneMatches) {
    res.status(404).json({ error: 'ไม่พบข้อมูลออเดอร์ กรุณาตรวจสอบเลขที่ออเดอร์และเบอร์โทรศัพท์' });
    return;
  }

  // Mask part of address/phone for extra safety while showing full order summary
  const hydrated = hydrateOrders([orderRow])[0];
  res.json({ order: hydrated });
});

// ===================== ADMIN AUTHENTICATION API =====================

app.get('/api/admin/auth/status', (_req: Request, res: Response) => {
  const envConfigured = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  const adminCount = (
    db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number }
  ).count;

  res.json({
    needsSetup: !envConfigured && adminCount === 0,
    envConfigured,
  });
});

app.post('/api/admin/auth/setup', (req: Request, res: Response) => {
  const envConfigured = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0);
  if (envConfigured) {
    res.status(403).json({ error: 'ระบบตั้งค่ารหัสผ่านผ่าน Environment Secret แล้ว กรุณาเข้าสู่ระบบปกติ' });
    return;
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username.length < 3 || username.length > 40) {
    res.status(400).json({ error: 'ชื่อผู้ใช้ต้องมีความยาว 3–40 ตัวอักษร' });
    return;
  }
  if (password.length < 6 || password.length > 100) {
    res.status(400).json({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' });
    return;
  }

  try {
    const created = db.transaction(() => {
      const existing = (
        db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number }
      ).count;
      if (existing > 0) {
        return false;
      }
      const hashed = hashPassword(password);
      db.prepare(
        'INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)'
      ).run(username, hashed, 'owner', getBangkokNowString());
      return true;
    })();

    if (!created) {
      res.status(409).json({ error: 'มีบัญชีเจ้าของร้านในระบบแล้ว กรุณาเข้าสู่ระบบ' });
      return;
    }

    const token = signSessionToken({
      username,
      role: 'owner',
      exp: Date.now() + SESSION_TTL_MS,
    });
    res.status(201).json({ token, admin: { username, role: 'owner' } });
  } catch {
    res.status(500).json({ error: 'ไม่สามารถสร้างบัญชีเจ้าของร้านได้' });
  }
});

app.post('/api/admin/auth/login', (req: Request, res: Response) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    return;
  }

  // Env passcode overrides claimed fallback hash
  const envPass = process.env.ADMIN_PASSWORD?.trim();
  if (envPass) {
    const envUser = process.env.ADMIN_USERNAME?.trim() || 'admin';
    if (
      timingSafeCompareStrings(username, envUser) &&
      timingSafeCompareStrings(password, envPass)
    ) {
      const token = signSessionToken({
        username: envUser,
        role: 'owner',
        exp: Date.now() + SESSION_TTL_MS,
      });
      res.json({ token, admin: { username: envUser, role: 'owner' } });
      return;
    }
    res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    return;
  }

  const adminRow = db
    .prepare('SELECT * FROM admins WHERE username = ?')
    .get(username) as any;

  if (!adminRow || !verifyPassword(password, adminRow.password_hash)) {
    res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    return;
  }

  const token = signSessionToken({
    username: adminRow.username,
    role: adminRow.role,
    exp: Date.now() + SESSION_TTL_MS,
  });

  res.json({
    token,
    admin: { username: adminRow.username, role: adminRow.role },
  });
});

app.get('/api/admin/auth/me', requireAdmin, (req: AuthedRequest, res: Response) => {
  res.json({ admin: { username: req.admin!.username, role: req.admin!.role } });
});

// ===================== ADMIN DASHBOARD & ANALYTICS =====================

app.get('/api/admin/dashboard', requireAdmin, (_req: Request, res: Response) => {
  const todayStr = getBangkokDateString(0);

  const totalOrders = (
    db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }
  ).c;

  const todayOrders = (
    db
      .prepare('SELECT COUNT(*) as c FROM orders WHERE substr(created_at, 1, 10) = ?')
      .get(todayStr) as { c: number }
  ).c;

  // Actual confirmed sales (confirmed, preparing, delivering, completed — excludes cancelled & pending)
  const confirmedStatuses = "('confirmed', 'preparing', 'delivering', 'completed')";

  const todaySales = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) as s FROM orders
         WHERE substr(created_at, 1, 10) = ? AND status IN ${confirmedStatuses}`
      )
      .get(todayStr) as { s: number }
  ).s;

  const totalSales = (
    db
      .prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE status IN ${confirmedStatuses}`)
      .get() as { s: number }
  ).s;

  const productStats = db
    .prepare(
      `SELECT COUNT(*) as totalProducts, COALESCE(SUM(stock), 0) as totalStock
       FROM products WHERE is_deleted = 0`
    )
    .get() as { totalProducts: number; totalStock: number };

  const unreadOrdersCount = (
    db.prepare('SELECT COUNT(*) as c FROM orders WHERE is_read = 0').get() as { c: number }
  ).c;

  const latestUnreadOrder =
    (db
      .prepare(
        `SELECT o.id, o.order_number, o.total, o.created_at, c.name AS customer_name
         FROM orders o JOIN customers c ON o.customer_id = c.id
         WHERE o.is_read = 0
         ORDER BY o.id DESC LIMIT 1`
      )
      .get() as any) || null;

  // 1) Daily (hourly buckets for today)
  const hourlyRows = db
    .prepare(
      `SELECT substr(o.created_at, 12, 2) AS hr,
              COALESCE(SUM(CASE WHEN o.status IN ${confirmedStatuses} THEN o.total ELSE 0 END), 0) AS revenue,
              COUNT(o.id) AS orders,
              COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS itemsSold
       FROM orders o
       WHERE substr(o.created_at, 1, 10) = ? AND o.status != 'cancelled'
       GROUP BY hr`
    )
    .all(todayStr) as any[];
  const hourlyMap = new Map(hourlyRows.map((r) => [r.hr, r]));
  const dailySeries = ['08', '10', '12', '14', '16', '18', '20', '22'].map((hr) => {
    const prevHr = String(Number(hr) - 1).padStart(2, '0');
    const r1 = hourlyMap.get(prevHr);
    const r2 = hourlyMap.get(hr);
    return {
      label: `${hr}:00`,
      dateKey: `${todayStr} ${hr}:00`,
      revenue: Number(r1?.revenue || 0) + Number(r2?.revenue || 0),
      orders: Number(r1?.orders || 0) + Number(r2?.orders || 0),
      itemsSold: Number(r1?.itemsSold || 0) + Number(r2?.itemsSold || 0),
    };
  });

  // 2) Last 7 days
  const last7Days: Array<{ label: string; dateKey: string; revenue: number; orders: number; itemsSold: number }> = [];
  const dayQuery = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN o.status IN ${confirmedStatuses} THEN o.total ELSE 0 END), 0) AS revenue,
            COUNT(o.id) AS orders,
            COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS itemsSold
     FROM orders o
     WHERE substr(o.created_at, 1, 10) = ? AND o.status != 'cancelled'`
  );
  for (let i = 6; i >= 0; i--) {
    const dk = getBangkokDateString(i);
    const row = dayQuery.get(dk) as any;
    const [, mm, dd] = dk.split('-');
    last7Days.push({
      label: `${dd}/${mm}`,
      dateKey: dk,
      revenue: Number(row?.revenue || 0),
      orders: Number(row?.orders || 0),
      itemsSold: Number(row?.itemsSold || 0),
    });
  }

  // 3) Monthly (last 6 months)
  const monthlyRows = db
    .prepare(
      `SELECT substr(o.created_at, 1, 7) AS ym,
              COALESCE(SUM(CASE WHEN o.status IN ${confirmedStatuses} THEN o.total ELSE 0 END), 0) AS revenue,
              COUNT(o.id) AS orders,
              COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS itemsSold
       FROM orders o
       WHERE o.status != 'cancelled'
       GROUP BY ym
       ORDER BY ym DESC
       LIMIT 6`
    )
    .all() as any[];
  const monthlySeries = monthlyRows.reverse().map((r) => ({
    label: r.ym,
    dateKey: r.ym,
    revenue: Number(r.revenue || 0),
    orders: Number(r.orders || 0),
    itemsSold: Number(r.itemsSold || 0),
  }));

  // Best sellers based on actual non-cancelled confirmed orders (fallback to all non-cancelled if none yet)
  const bestSellers = db
    .prepare(
      `SELECT oi.product_id, oi.product_name,
              MAX(oi.product_image) AS product_image,
              SUM(oi.quantity) AS units_sold,
              SUM(oi.subtotal) AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.status != 'cancelled'
       GROUP BY oi.product_name
       ORDER BY units_sold DESC, revenue DESC
       LIMIT 6`
    )
    .all();

  const recentOrderRows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
              c.instagram AS customer_instagram, c.address AS customer_address
       FROM orders o JOIN customers c ON o.customer_id = c.id
       ORDER BY o.id DESC
       LIMIT 8`
    )
    .all();

  res.json({
    totalOrders,
    todayOrders,
    todaySales,
    totalSales,
    totalProducts: productStats.totalProducts,
    totalRemainingStock: productStats.totalStock,
    unreadOrdersCount,
    latestUnreadOrder,
    salesSeries: {
      daily: dailySeries,
      last7Days,
      monthly: monthlySeries,
    },
    bestSellers,
    recentOrders: hydrateOrders(recentOrderRows),
  });
});

app.get('/api/admin/sales', requireAdmin, (req: Request, res: Response) => {
  const todayStr = getBangkokDateString(0);
  const weekAgoStr = getBangkokDateString(6);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  const startDate = String(req.query.startDate || getBangkokDateString(29)).slice(0, 10);
  const endDate = String(req.query.endDate || todayStr).slice(0, 10);

  const confirmedStatuses = "('confirmed', 'preparing', 'delivering', 'completed')";

  const todaySales = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS s FROM orders
         WHERE substr(created_at, 1, 10) = ? AND status IN ${confirmedStatuses}`
      )
      .get(todayStr) as { s: number }
  ).s;

  const weeklySales = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS s FROM orders
         WHERE substr(created_at, 1, 10) BETWEEN ? AND ? AND status IN ${confirmedStatuses}`
      )
      .get(weekAgoStr, todayStr) as { s: number }
  ).s;

  const monthlySales = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS s FROM orders
         WHERE substr(created_at, 1, 10) >= ? AND status IN ${confirmedStatuses}`
      )
      .get(monthStartStr) as { s: number }
  ).s;

  const totalConfirmedSales = (
    db
      .prepare(`SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE status IN ${confirmedStatuses}`)
      .get() as { s: number }
  ).s;

  const byStatusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
       FROM orders
       WHERE substr(created_at, 1, 10) BETWEEN ? AND ?
       GROUP BY status`
    )
    .all(startDate, endDate) as Array<{ status: string; count: number; revenue: number }>;

  const allStatuses = ['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled'];
  const statusMap = new Map(byStatusRows.map((r) => [r.status, r]));
  const byStatus = allStatuses.map((st) => ({
    status: st,
    count: Number(statusMap.get(st)?.count || 0),
    revenue: Number(statusMap.get(st)?.revenue || 0),
  }));

  const rangeConfirmedSales = byStatus
    .filter((b) => ['confirmed', 'preparing', 'delivering', 'completed'].includes(b.status))
    .reduce((acc, b) => acc + b.revenue, 0);
  const rangePendingSales = byStatus.find((b) => b.status === 'pending')?.revenue || 0;
  const rangeCancelledSales = byStatus.find((b) => b.status === 'cancelled')?.revenue || 0;
  const rangeOrdersCount = byStatus.reduce((acc, b) => acc + b.count, 0);
  const rangeConfirmedOrdersCount = byStatus
    .filter((b) => ['confirmed', 'preparing', 'delivering', 'completed'].includes(b.status))
    .reduce((acc, b) => acc + b.count, 0);

  const rangeItemsSold = (
    db
      .prepare(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS q
         FROM order_items oi JOIN orders o ON oi.order_id = o.id
         WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
           AND o.status IN ${confirmedStatuses}`
      )
      .get(startDate, endDate) as { q: number }
  ).q;

  const bestSellers = db
    .prepare(
      `SELECT oi.product_id, oi.product_name,
              MAX(oi.product_image) AS product_image,
              SUM(oi.quantity) AS units_sold,
              SUM(oi.subtotal) AS revenue
       FROM order_items oi JOIN orders o ON oi.order_id = o.id
       WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
         AND o.status IN ${confirmedStatuses}
       GROUP BY oi.product_name
       ORDER BY units_sold DESC, revenue DESC`
    )
    .all(startDate, endDate);

  const dailyBreakdownRows = db
    .prepare(
      `SELECT substr(o.created_at, 1, 10) AS dateKey,
              COALESCE(SUM(CASE WHEN o.status IN ${confirmedStatuses} THEN o.total ELSE 0 END), 0) AS revenue,
              COUNT(o.id) AS orders,
              COALESCE(SUM(CASE WHEN o.status IN ${confirmedStatuses}
                THEN (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)
                ELSE 0 END), 0) AS itemsSold
       FROM orders o
       WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
       GROUP BY dateKey
       ORDER BY dateKey ASC`
    )
    .all(startDate, endDate) as any[];

  const dailyBreakdown = dailyBreakdownRows.map((r) => {
    const [, mm, dd] = String(r.dateKey).split('-');
    return {
      label: `${dd}/${mm}`,
      dateKey: r.dateKey,
      revenue: Number(r.revenue || 0),
      orders: Number(r.orders || 0),
      itemsSold: Number(r.itemsSold || 0),
    };
  });

  const orderRows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
              c.instagram AS customer_instagram, c.address AS customer_address
       FROM orders o JOIN customers c ON o.customer_id = c.id
       WHERE substr(o.created_at, 1, 10) BETWEEN ? AND ?
       ORDER BY o.id DESC`
    )
    .all(startDate, endDate);

  res.json({
    startDate,
    endDate,
    todaySales,
    weeklySales,
    monthlySales,
    totalConfirmedSales,
    rangeConfirmedSales,
    rangePendingSales,
    rangeCancelledSales,
    rangeOrdersCount,
    rangeConfirmedOrdersCount,
    rangeItemsSold,
    byStatus,
    bestSellers,
    dailyBreakdown,
    orders: hydrateOrders(orderRows),
  });
});

// ===================== ADMIN PRODUCT & STOCK MANAGEMENT =====================

app.get('/api/admin/products', requireAdmin, (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM products WHERE is_deleted = 0 ORDER BY id DESC')
    .all();
  res.json({ products: hydrateProducts(rows) });
});

app.post('/api/admin/products', requireAdmin, (req: Request, res: Response) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const price = Number(req.body?.price);
  const capacity = Math.max(0, Math.floor(Number(req.body?.capacity || 0)));
  const stock = Math.max(0, Math.floor(Number(req.body?.stock ?? capacity)));
  const category = String(req.body?.category || 'ขนมหวาน').trim() || 'ขนมหวาน';
  const status = req.body?.status === 'inactive' ? 'inactive' : 'active';

  if (!name || name.length > 120) {
    res.status(400).json({ error: 'กรุณาระบุชื่อสินค้า' });
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    res.status(400).json({ error: 'กรุณาระบุราคาที่ถูกต้อง' });
    return;
  }

  const nowStr = getBangkokNowString();
  const effectiveCapacity = Math.max(capacity, stock);
  const info = db
    .prepare(
      `INSERT INTO products (name, description, price, capacity, stock, sold, category, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(name, description, price, effectiveCapacity, stock, category, status, nowStr, nowStr);

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ product: hydrateProducts([row])[0] });
});

app.put('/api/admin/products/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT * FROM products WHERE id = ? AND is_deleted = 0')
    .get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบสินค้านี้ในระบบ' });
    return;
  }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const description =
    req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
  const price = req.body?.price !== undefined ? Number(req.body.price) : existing.price;
  const capacity =
    req.body?.capacity !== undefined ? Math.max(0, Math.floor(Number(req.body.capacity))) : existing.capacity;
  const stock =
    req.body?.stock !== undefined ? Math.max(0, Math.floor(Number(req.body.stock))) : existing.stock;
  const category =
    req.body?.category !== undefined ? String(req.body.category).trim() : existing.category;
  const status =
    req.body?.status === 'inactive'
      ? 'inactive'
      : req.body?.status === 'active'
      ? 'active'
      : existing.status;

  if (!name || !Number.isFinite(price) || price < 0) {
    res.status(400).json({ error: 'ข้อมูลสินค้าไม่ถูกต้อง' });
    return;
  }

  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, price = ?, capacity = ?, stock = ?, category = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, description, price, Math.max(capacity, stock), stock, category, status, getBangkokNowString(), id);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: hydrateProducts([updated])[0] });
});

app.post('/api/admin/products/:id/restock', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const mode = req.body?.mode === 'new_round' ? 'new_round' : 'add';
  const quantity = Math.floor(Number(req.body?.quantity));

  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000) {
    res.status(400).json({ error: 'กรุณาระบุจำนวนสินค้าที่ต้องการเพิ่มให้ถูกต้อง' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM products WHERE id = ? AND is_deleted = 0')
    .get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบสินค้า' });
    return;
  }

  const nowStr = getBangkokNowString();
  if (mode === 'new_round') {
    db.prepare(
      `UPDATE products
       SET capacity = ?, stock = ?, sold = 0, status = 'active', updated_at = ?
       WHERE id = ?`
    ).run(quantity, quantity, nowStr, id);
  } else {
    db.prepare(
      `UPDATE products
       SET capacity = capacity + ?, stock = stock + ?, status = 'active', updated_at = ?
       WHERE id = ?`
    ).run(quantity, quantity, nowStr, id);
  }

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ product: hydrateProducts([updated])[0] });
});

app.delete('/api/admin/products/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT * FROM products WHERE id = ? AND is_deleted = 0')
    .get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบสินค้า' });
    return;
  }

  const hasHistory =
    (
      db.prepare('SELECT COUNT(*) as c FROM order_items WHERE product_id = ?').get(id) as {
        c: number;
      }
    ).c > 0;

  if (hasHistory) {
    // Preserve historical order records via soft delete
    db.prepare(
      `UPDATE products SET is_deleted = 1, status = 'inactive', updated_at = ? WHERE id = ?`
    ).run(getBangkokNowString(), id);
    res.json({ deleted: true, softDeleted: true });
    return;
  }

  const imgs = db
    .prepare('SELECT image_url FROM product_images WHERE product_id = ?')
    .all(id) as Array<{ image_url: string }>;

  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  for (const img of imgs) {
    deleteLocalUploadIfOwned(img.image_url);
  }

  res.json({ deleted: true, softDeleted: false });
});

// ===================== ADMIN IMAGE MANAGEMENT API =====================

app.post(
  '/api/admin/products/:id/images',
  requireAdmin,
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('images', 8)(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message || 'อัปโหลดรูปภาพไม่สำเร็จ' });
        return;
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    const productId = Number(req.params.id);
    const product = db
      .prepare('SELECT id FROM products WHERE id = ? AND is_deleted = 0')
      .get(productId);
    const files = (req.files as Express.Multer.File[]) || [];

    if (!product) {
      files.forEach((f) => deleteLocalUploadIfOwned(`/uploads/${f.filename}`));
      res.status(404).json({ error: 'ไม่พบสินค้าที่ต้องการเพิ่มรูปภาพ' });
      return;
    }
    if (files.length === 0) {
      res.status(400).json({ error: 'กรุณาเลือกรูปภาพอย่างน้อย 1 รูป' });
      return;
    }

    const existingCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM product_images WHERE product_id = ?')
        .get(productId) as { c: number }
    ).c;

    const maxOrder = (
      db
        .prepare(
          'SELECT COALESCE(MAX(display_order), -1) as m FROM product_images WHERE product_id = ?'
        )
        .get(productId) as { m: number }
    ).m;

    const insertImg = db.prepare(`
      INSERT INTO product_images (product_id, image_url, is_primary, display_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const nowStr = getBangkokNowString();

    db.transaction(() => {
      files.forEach((file, idx) => {
        const isPrimary = existingCount === 0 && idx === 0 ? 1 : 0;
        insertImg.run(productId, `/uploads/${file.filename}`, isPrimary, maxOrder + 1 + idx, nowStr);
      });
    })();

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    res.status(201).json({ product: hydrateProducts([updated])[0] });
  }
);

app.put(
  '/api/admin/images/:imageId',
  requireAdmin,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('image')(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message || 'เปลี่ยนรูปภาพไม่สำเร็จ' });
        return;
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    const imageId = Number(req.params.imageId);
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'กรุณาเลือกไฟล์รูปภาพใหม่' });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM product_images WHERE id = ?')
      .get(imageId) as any;

    if (!existing) {
      deleteLocalUploadIfOwned(`/uploads/${file.filename}`);
      res.status(404).json({ error: 'ไม่พบรูปภาพที่ต้องการเปลี่ยน' });
      return;
    }

    const newUrl = `/uploads/${file.filename}`;
    db.prepare('UPDATE product_images SET image_url = ?, drive_file_id = NULL WHERE id = ?').run(
      newUrl,
      imageId
    );
    deleteLocalUploadIfOwned(existing.image_url);

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.product_id);
    res.json({ product: hydrateProducts([updated])[0] });
  }
);

app.patch('/api/admin/images/:imageId/primary', requireAdmin, (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId);
  const existing = db.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบรูปภาพ' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ?').run(
      existing.product_id
    );
    db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(imageId);
  })();

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.product_id);
  res.json({ product: hydrateProducts([updated])[0] });
});

app.patch('/api/admin/images/:imageId/drive', requireAdmin, (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId);
  const driveFileId = req.body?.driveFileId ? String(req.body.driveFileId).trim().slice(0, 200) : null;
  const existing = db.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบรูปภาพ' });
    return;
  }
  db.prepare('UPDATE product_images SET drive_file_id = ? WHERE id = ?').run(driveFileId, imageId);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.product_id);
  res.json({ product: hydrateProducts([updated])[0] });
});

app.put('/api/admin/products/:id/images/reorder', requireAdmin, (req: Request, res: Response) => {
  const productId = Number(req.params.id);
  const imageIds = Array.isArray(req.body?.imageIds)
    ? req.body.imageIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n))
    : [];

  if (imageIds.length === 0) {
    res.status(400).json({ error: 'รายการเรียงลำดับรูปภาพไม่ถูกต้อง' });
    return;
  }

  const updateOrder = db.prepare(
    'UPDATE product_images SET display_order = ? WHERE id = ? AND product_id = ?'
  );

  db.transaction(() => {
    imageIds.forEach((imgId: number, idx: number) => {
      updateOrder.run(idx, imgId, productId);
    });
  })();

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.json({ product: hydrateProducts([updated])[0] });
});

app.delete('/api/admin/images/:imageId', requireAdmin, (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId);
  const existing = db.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบรูปภาพ' });
    return;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
    if (existing.is_primary === 1) {
      const nextImg = db
        .prepare(
          'SELECT id FROM product_images WHERE product_id = ? ORDER BY display_order ASC, id ASC LIMIT 1'
        )
        .get(existing.product_id) as any;
      if (nextImg) {
        db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(nextImg.id);
      }
    }
  })();

  deleteLocalUploadIfOwned(existing.image_url);

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.product_id);
  res.json({ product: hydrateProducts([updated])[0] });
});

// ===================== ADMIN ORDER MANAGEMENT API =====================

app.get('/api/admin/orders', requireAdmin, (req: Request, res: Response) => {
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim().toLowerCase();

  let sql = `
    SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
           c.instagram AS customer_instagram, c.address AS customer_address
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status !== 'all') {
    sql += ' AND o.status = ?';
    params.push(status);
  }
  if (search) {
    sql +=
      ' AND (LOWER(o.order_number) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(c.phone) LIKE ? OR LOWER(c.instagram) LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY o.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ orders: hydrateOrders(rows) });
});

app.patch('/api/admin/orders/:id/read', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE orders SET is_read = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/orders/mark-all-read', requireAdmin, (_req: Request, res: Response) => {
  db.prepare('UPDATE orders SET is_read = 1 WHERE is_read = 0').run();
  res.json({ ok: true });
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const newStatus = String(req.body?.status || '');
  const shippingFeeInput =
    req.body?.shipping_fee !== undefined && req.body?.shipping_fee !== null
      ? Number(req.body.shipping_fee)
      : undefined;

  const validStatuses = ['pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled'];
  if (!validStatuses.includes(newStatus)) {
    res.status(400).json({ error: 'สถานะออเดอร์ไม่ถูกต้อง' });
    return;
  }

  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบออเดอร์นี้' });
    return;
  }

  const nowStr = getBangkokNowString();

  try {
    db.transaction(() => {
      // Prevent restoring stock more than once on cancellation
      if (newStatus === 'cancelled' && existing.stock_restored === 0) {
        const items = db
          .prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?')
          .all(id) as Array<{ product_id: number | null; quantity: number }>;

        const restoreStmt = db.prepare(`
          UPDATE products
          SET stock = stock + ?, sold = MAX(0, sold - ?), updated_at = ?
          WHERE id = ?
        `);
        for (const it of items) {
          if (it.product_id) {
            restoreStmt.run(it.quantity, it.quantity, nowStr, it.product_id);
          }
        }
        db.prepare(
          'UPDATE orders SET status = ?, stock_restored = 1, is_read = 1, updated_at = ? WHERE id = ?'
        ).run(newStatus, nowStr, id);
      } else if (existing.status === 'cancelled' && newStatus !== 'cancelled' && existing.stock_restored === 1) {
        // Re-opening a cancelled order must re-deduct stock atomically
        const items = db
          .prepare('SELECT product_id, product_name, quantity FROM order_items WHERE order_id = ?')
          .all(id) as Array<{ product_id: number | null; product_name: string; quantity: number }>;

        const deductStmt = db.prepare(`
          UPDATE products
          SET stock = stock - ?, sold = sold + ?, updated_at = ?
          WHERE id = ? AND stock >= ?
        `);
        for (const it of items) {
          if (it.product_id) {
            const r = deductStmt.run(it.quantity, it.quantity, nowStr, it.product_id, it.quantity);
            if (r.changes !== 1) {
              throw new Error(`สินค้า "${it.product_name}" คงเหลือไม่พอสำหรับเปิดออเดอร์นี้อีกครั้ง`);
            }
          }
        }
        db.prepare(
          'UPDATE orders SET status = ?, stock_restored = 0, is_read = 1, updated_at = ? WHERE id = ?'
        ).run(newStatus, nowStr, id);
      } else {
        db.prepare(
          'UPDATE orders SET status = ?, is_read = 1, updated_at = ? WHERE id = ?'
        ).run(newStatus, nowStr, id);
      }

      if (shippingFeeInput !== undefined && Number.isFinite(shippingFeeInput) && shippingFeeInput >= 0) {
        const newTotal = Number(existing.subtotal) + shippingFeeInput;
        db.prepare(
          `UPDATE orders SET shipping_fee = ?, shipping_mode = 'fixed', total = ?, updated_at = ? WHERE id = ?`
        ).run(shippingFeeInput, newTotal, nowStr, id);
      }
    })();

    const updated = db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                c.instagram AS customer_instagram, c.address AS customer_address
         FROM orders o JOIN customers c ON o.customer_id = c.id
         WHERE o.id = ?`
      )
      .get(id);

    res.json({ order: hydrateOrders([updated])[0] });
  } catch (err: any) {
    res.status(409).json({ error: err?.message || 'ไม่สามารถเปลี่ยนสถานะออเดอร์ได้' });
  }
});

app.post('/api/admin/orders/mark-sheets-synced', requireAdmin, (req: Request, res: Response) => {
  const orderIds = Array.isArray(req.body?.orderIds)
    ? req.body.orderIds.map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n))
    : [];
  const stmt = db.prepare('UPDATE orders SET sheets_synced = 1 WHERE id = ?');
  db.transaction(() => {
    for (const oid of orderIds) stmt.run(oid);
  })();
  res.json({ ok: true });
});

// ===================== ADMIN SETTINGS API =====================

function buildAdminSettingsResponse(settings: Record<string, string>) {
  return {
    shipping_mode: settings.shipping_mode === 'pending' ? 'pending' : 'fixed',
    shipping_fee: Number(settings.shipping_fee || 40),
    free_shipping_threshold: Number(settings.free_shipping_threshold || 500),
    google_sheet_id: settings.google_sheet_id || '',
    google_sheet_url: settings.google_sheet_url || '',
    google_drive_folder_id: settings.google_drive_folder_id || '',
    store_logo_url: settings.store_logo_url || null,
  };
}

app.get('/api/admin/settings', requireAdmin, (_req: Request, res: Response) => {
  res.json(buildAdminSettingsResponse(getSettingsMap()));
});

app.put('/api/admin/settings', requireAdmin, (req: Request, res: Response) => {
  const upsert = db.prepare(
    'INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const updates: Array<[string, string]> = [];
  if (req.body?.shipping_mode === 'fixed' || req.body?.shipping_mode === 'pending') {
    updates.push(['shipping_mode', req.body.shipping_mode]);
  }
  if (req.body?.shipping_fee !== undefined && Number.isFinite(Number(req.body.shipping_fee))) {
    updates.push(['shipping_fee', String(Math.max(0, Number(req.body.shipping_fee)))]);
  }
  if (
    req.body?.free_shipping_threshold !== undefined &&
    Number.isFinite(Number(req.body.free_shipping_threshold))
  ) {
    updates.push([
      'free_shipping_threshold',
      String(Math.max(0, Number(req.body.free_shipping_threshold))),
    ]);
  }
  if (typeof req.body?.google_sheet_id === 'string') {
    updates.push(['google_sheet_id', req.body.google_sheet_id.trim().slice(0, 200)]);
  }
  if (typeof req.body?.google_sheet_url === 'string') {
    updates.push(['google_sheet_url', req.body.google_sheet_url.trim().slice(0, 400)]);
  }
  if (typeof req.body?.google_drive_folder_id === 'string') {
    updates.push(['google_drive_folder_id', req.body.google_drive_folder_id.trim().slice(0, 200)]);
  }

  db.transaction(() => {
    for (const [k, v] of updates) upsert.run(k, v);
  })();

  res.json(buildAdminSettingsResponse(getSettingsMap()));
});

app.post('/api/admin/settings/logo', requireAdmin, (req: Request, res: Response) => {
  upload.single('logo')(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: err?.message || 'อัปโหลดโลโก้ร้านไม่สำเร็จ' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'กรุณาเลือกไฟล์รูปโลโก้ร้าน (JPG, PNG, WEBP)' });
      return;
    }

    const prevSettings = getSettingsMap();
    const newLogoUrl = `/uploads/${req.file.filename}`;

    db.prepare(
      'INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('store_logo_url', newLogoUrl);

    if (prevSettings.store_logo_url && prevSettings.store_logo_url !== newLogoUrl) {
      deleteLocalUploadIfOwned(prevSettings.store_logo_url);
    }

    res.json(buildAdminSettingsResponse(getSettingsMap()));
  });
});

app.delete('/api/admin/settings/logo', requireAdmin, (_req: Request, res: Response) => {
  const prevSettings = getSettingsMap();
  if (prevSettings.store_logo_url) {
    deleteLocalUploadIfOwned(prevSettings.store_logo_url);
  }
  db.prepare(
    'INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('store_logo_url', '');

  res.json(buildAdminSettingsResponse(getSettingsMap()));
});

// ===================== VITE / STATIC SERVING =====================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bibi's Treats server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
