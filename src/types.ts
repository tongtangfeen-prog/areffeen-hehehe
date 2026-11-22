export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export type ProductStatus = 'active' | 'inactive';

export type StockBadgeState = 'ready' | 'low' | 'sold_out' | 'closed';

export interface ProductImage {
  id: number;
  product_id: number;
  image_url: string;
  drive_file_id: string | null;
  is_primary: number;
  display_order: number;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  capacity: number;
  stock: number;
  sold: number;
  category: string;
  status: ProductStatus;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  images: ProductImage[];
  primary_image: string | null;
  stock_state: StockBadgeState;
}

export interface CartItem {
  productId: number;
  quantity: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  product_image: string | null;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface OrderRecord {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_instagram: string;
  customer_address: string;
  subtotal: number;
  shipping_fee: number | null;
  shipping_mode: 'fixed' | 'pending';
  total: number;
  note: string;
  status: OrderStatus;
  is_read: number;
  stock_restored: number;
  sheets_synced: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface StoreConfig {
  shipping_mode: 'fixed' | 'pending';
  shipping_fee: number;
  free_shipping_threshold: number;
  google_sheet_id?: string;
  google_sheet_url?: string;
  google_drive_folder_id?: string;
  store_logo_url?: string | null;
}

export interface SalesPoint {
  label: string;
  dateKey: string;
  revenue: number;
  orders: number;
  itemsSold: number;
}

export interface BestSellerItem {
  product_id: number | null;
  product_name: string;
  product_image: string | null;
  units_sold: number;
  revenue: number;
}

export interface DashboardSummary {
  totalOrders: number;
  todayOrders: number;
  todaySales: number;
  totalSales: number;
  totalProducts: number;
  totalRemainingStock: number;
  unreadOrdersCount: number;
  latestUnreadOrder: {
    id: number;
    order_number: string;
    total: number;
    customer_name: string;
    created_at: string;
  } | null;
  salesSeries: {
    daily: SalesPoint[];
    last7Days: SalesPoint[];
    monthly: SalesPoint[];
  };
  bestSellers: BestSellerItem[];
  recentOrders: OrderRecord[];
}

export interface SalesReportData {
  startDate: string;
  endDate: string;
  todaySales: number;
  weeklySales: number;
  monthlySales: number;
  totalConfirmedSales: number;
  rangeConfirmedSales: number;
  rangePendingSales: number;
  rangeCancelledSales: number;
  rangeOrdersCount: number;
  rangeConfirmedOrdersCount: number;
  rangeItemsSold: number;
  byStatus: Array<{
    status: OrderStatus;
    count: number;
    revenue: number;
  }>;
  bestSellers: BestSellerItem[];
  dailyBreakdown: SalesPoint[];
  orders: OrderRecord[];
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; colorClass: string; dotClass: string; stepIndex: number }
> = {
  pending: {
    label: 'รอยืนยัน',
    colorClass: 'text-[#9A5B00] bg-[#FFF4DC]',
    dotClass: 'bg-[#E59A1A]',
    stepIndex: 0,
  },
  confirmed: {
    label: 'ยืนยันแล้ว',
    colorClass: 'text-[#1D5FA7] bg-[#E3F2FF]',
    dotClass: 'bg-[#3B89CC]',
    stepIndex: 1,
  },
  preparing: {
    label: 'กำลังเตรียมสินค้า',
    colorClass: 'text-[#5B3FA6] bg-[#EFE9FF]',
    dotClass: 'bg-[#7A5CD6]',
    stepIndex: 2,
  },
  delivering: {
    label: 'กำลังจัดส่ง',
    colorClass: 'text-[#0E6E7C] bg-[#DFF6FA]',
    dotClass: 'bg-[#1EA3B5]',
    stepIndex: 3,
  },
  completed: {
    label: 'สำเร็จ',
    colorClass: 'text-[#17693B] bg-[#E1F7EA]',
    dotClass: 'bg-[#22A35A]',
    stepIndex: 4,
  },
  cancelled: {
    label: 'ยกเลิก',
    colorClass: 'text-[#B4233C] bg-[#FFE7EC]',
    dotClass: 'bg-[#E13E59]',
    stepIndex: -1,
  },
};

export const STOCK_STATE_META: Record<
  StockBadgeState,
  { label: string; emoji: string; textClass: string }
> = {
  ready: { label: 'พร้อมขาย', emoji: '🟢', textClass: 'text-[#17693B]' },
  low: { label: 'ใกล้หมด', emoji: '🟠', textClass: 'text-[#B45309]' },
  sold_out: { label: 'หมดแล้ว', emoji: '🔴', textClass: 'text-[#B4233C]' },
  closed: { label: 'ปิดการขาย', emoji: '⚫', textClass: 'text-[#52657A]' },
};
