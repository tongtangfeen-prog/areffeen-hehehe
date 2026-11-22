import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const DB_PATH = path.resolve(DATA_DIR, 'bibis_treats.db');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      capacity INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      sold INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'ขนมหวาน',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      drive_file_id TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      instagram TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT UNIQUE,
      customer_id INTEGER NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      shipping_fee REAL,
      shipping_mode TEXT NOT NULL DEFAULT 'fixed',
      total REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'preparing', 'delivering', 'completed', 'cancelled')),
      is_read INTEGER NOT NULL DEFAULT 0,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      sheets_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours')),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      product_image TEXT,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+7 hours'))
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, display_order);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);

  seedDefaultSettings();
  seedInitialBakeryData();
}

function seedDefaultSettings() {
  const defaults: Record<string, string> = {
    shipping_mode: 'fixed',
    shipping_fee: '40',
    free_shipping_threshold: '500',
    google_sheet_id: '',
    google_sheet_url: '',
    google_drive_folder_id: '',
    store_logo_url: '',
  };

  const upsert = db.prepare(
    'INSERT OR IGNORE INTO store_settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    upsert.run(key, value);
  }
}

function seedInitialBakeryData() {
  const existingCount = (
    db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
  ).count;

  if (existingCount > 0) return;

  const seedProducts = [
    {
      name: 'Chocolate Brownie',
      description: 'Brownie ช็อกโกแลตแท้ 70% เข้มข้น เนื้อหนึบหน้าฟิล์ม อบสดใหม่ทุกเช้า',
      price: 50,
      capacity: 50,
      stock: 20,
      sold: 30,
      category: 'บราวนี่ & เค้ก',
      status: 'active',
      images: ['/src/assets/images/product_chocolate_brownie_1795268389915.jpg'],
    },
    {
      name: 'Blueberry Cloud Cupcake',
      description: 'คัพเค้กวานิลลาเนื้อนุ่มฟู ท็อปบัตเตอร์ครีมบลูเบอร์รี่สีฟ้าพาสเทลและบลูเบอร์รี่สด',
      price: 65,
      capacity: 30,
      stock: 14,
      sold: 16,
      category: 'คัพเค้ก',
      status: 'active',
      images: ['/src/assets/images/product_blueberry_cupcake_1795268391742.jpg'],
    },
    {
      name: 'Strawberry Cream Shortcake',
      description: 'ชอร์ตเค้กสไตล์ญี่ปุ่น สปอนจ์นุ่มละมุน ครีมสดหวานน้อย และสตรอว์เบอร์รี่คัดพิเศษ',
      price: 125,
      capacity: 20,
      stock: 4,
      sold: 16,
      category: 'บราวนี่ & เค้ก',
      status: 'active',
      images: ['/src/assets/images/product_strawberry_shortcake_1795268389281.jpg'],
    },
    {
      name: 'French Butter & Sea Salt Cookies',
      description: 'คุกกี้เนยสดฝรั่งเศสและซอฟต์คุกกี้ดาร์กช็อกโกแลตโรยเกลือทะเล (เซต 4 ชิ้น)',
      price: 95,
      capacity: 40,
      stock: 18,
      sold: 22,
      category: 'คุกกี้',
      status: 'active',
      images: ['/src/assets/images/product_butter_cookies_1795268391117.jpg'],
    },
    {
      name: 'Kyoto Matcha Basque Cheesecake',
      description: 'ชีสเค้กหน้าไหม้มัทฉะเกรดพิธีการจากเกียวโต เนื้อครีมมี่ละลายในปาก หอมชาเขียวแท้',
      price: 135,
      capacity: 15,
      stock: 9,
      sold: 6,
      category: 'ชีสเค้ก',
      status: 'active',
      images: ['/src/assets/images/product_matcha_cheesecake_1795268390178.jpg'],
    },
    {
      name: 'Hokkaido Milk Cream Bun',
      description: 'ขนมปังนุ่มไส้ครีมนมฮอกไกโดวานิลลาฝักแท้ โรยไอซิ่งบาง ๆ หอมละมุน (รอบนี้หมดแล้ว)',
      price: 55,
      capacity: 25,
      stock: 0,
      sold: 25,
      category: 'ขนมปัง & บัน',
      status: 'active',
      images: ['/src/assets/images/product_milk_bun_1795268389571.jpg'],
    },
  ];

  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, price, capacity, stock, sold, category, status)
    VALUES (@name, @description, @price, @capacity, @stock, @sold, @category, @status)
  `);
  const insertImage = db.prepare(`
    INSERT INTO product_images (product_id, image_url, is_primary, display_order)
    VALUES (?, ?, ?, ?)
  `);

  const productIds: Record<string, { id: number; price: number; image: string }> = {};

  const tx = db.transaction(() => {
    for (const p of seedProducts) {
      const info = insertProduct.run(p);
      const productId = Number(info.lastInsertRowid);
      p.images.forEach((imgUrl, idx) => {
        insertImage.run(productId, imgUrl, idx === 0 ? 1 : 0, idx);
      });
      productIds[p.name] = { id: productId, price: p.price, image: p.images[0] };
    }

    // Seed 4 sample orders across recent days so Admin Dashboard charts & reports start rich
    const formatOffsetDate = (daysAgo: number, hour: number, minute: number) => {
      const d = new Date(Date.now() + 7 * 3600 * 1000 - daysAgo * 86400 * 1000);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const hh = String(hour).padStart(2, '0');
      const mi = String(minute).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`;
    };

    const insertCustomer = db.prepare(`
      INSERT INTO customers (name, phone, instagram, address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO orders (order_number, customer_id, subtotal, shipping_fee, shipping_mode, total, note, status, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'fixed', ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const sampleOrders = [
      {
        orderNumber: 'BT-0001',
        name: 'พิมพ์ชนก รัตนกุล',
        phone: '0891234567',
        instagram: '@pim.sweetday',
        address: '88/12 ซอยอารีย์ 4 แขวงพญาไท เขตพญาไท กรุงเทพฯ 10400',
        note: 'ขอช้อนส้อม 2 ชุดค่ะ',
        status: 'completed',
        isRead: 1,
        createdAt: formatOffsetDate(4, 10, 15),
        items: [
          { name: 'Chocolate Brownie', qty: 4 },
          { name: 'Blueberry Cloud Cupcake', qty: 2 },
        ],
      },
      {
        orderNumber: 'BT-0002',
        name: 'ณัฐพล วงศ์สุวรรณ',
        phone: '0819876543',
        instagram: '@nat.coffeeclub',
        address: '215 ถนนนิมมานเหมินท์ ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200',
        note: 'ส่งช่วงบ่าย 2 โมงครับ',
        status: 'completed',
        isRead: 1,
        createdAt: formatOffsetDate(2, 13, 40),
        items: [
          { name: 'Strawberry Cream Shortcake', qty: 2 },
          { name: 'French Butter & Sea Salt Cookies', qty: 2 },
        ],
      },
      {
        orderNumber: 'BT-0003',
        name: 'กานต์ธิดา ใจดี',
        phone: '0924457788',
        instagram: '@karn.pastel',
        address: '45/9 หมู่บ้านเดอะปาล์ม บางนา-ตราด กม.5 สมุทรปราการ 10540',
        note: 'เขียนการ์ด Happy Birthday ให้หน่อยนะคะ',
        status: 'preparing',
        isRead: 1,
        createdAt: formatOffsetDate(1, 16, 20),
        items: [
          { name: 'Kyoto Matcha Basque Cheesecake', qty: 2 },
          { name: 'Chocolate Brownie', qty: 3 },
        ],
      },
      {
        orderNumber: 'BT-0004',
        name: 'อภิชญา สกุลไทย',
        phone: '0865541122',
        instagram: '@api.treats',
        address: '102 คอนโดโนเบิล เพลินจิต ถนนเพลินจิต แขวงลุมพินี ปทุมวัน กรุงเทพฯ 10330',
        note: 'ฝากไว้ที่นิติบุคคลได้เลยค่ะ',
        status: 'pending',
        isRead: 0,
        createdAt: formatOffsetDate(0, 9, 30),
        items: [
          { name: 'Chocolate Brownie', qty: 2 },
          { name: 'Blueberry Cloud Cupcake', qty: 2 },
          { name: 'French Butter & Sea Salt Cookies', qty: 1 },
        ],
      },
    ];

    for (const s of sampleOrders) {
      const custRes = insertCustomer.run(s.name, s.phone, s.instagram, s.address, s.createdAt);
      const custId = Number(custRes.lastInsertRowid);
      let subtotal = 0;
      const lineItems = s.items.map((it) => {
        const prod = productIds[it.name];
        const lineSub = prod.price * it.qty;
        subtotal += lineSub;
        return { ...prod, name: it.name, qty: it.qty, subtotal: lineSub };
      });
      const shippingFee = subtotal >= 500 ? 0 : 40;
      const total = subtotal + shippingFee;
      const ordRes = insertOrder.run(
        s.orderNumber,
        custId,
        subtotal,
        shippingFee,
        total,
        s.note,
        s.status,
        s.isRead,
        s.createdAt,
        s.createdAt
      );
      const orderId = Number(ordRes.lastInsertRowid);
      for (const li of lineItems) {
        insertItem.run(orderId, li.id, li.name, li.image, li.qty, li.price, li.subtotal);
      }
    }
  });

  tx();
}

export function getBangkokNowString(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function getBangkokDateString(daysAgo = 0): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000 - daysAgo * 86400 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
