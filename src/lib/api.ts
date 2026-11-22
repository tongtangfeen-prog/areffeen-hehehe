import type {
  DashboardSummary,
  OrderRecord,
  OrderStatus,
  Product,
  ProductStatus,
  SalesReportData,
  StoreConfig,
} from '../types';

// Keep Admin session token strictly in memory (never localStorage or sessionStorage)
let adminBearerToken: string | null = null;

export function setAdminToken(token: string | null) {
  adminBearerToken = token;
}

export function getAdminToken(): string | null {
  return adminBearerToken;
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  requireAdminAuth = false
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (requireAdminAuth && adminBearerToken) {
    headers.set('Authorization', `Bearer ${adminBearerToken}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์') as Error & {
      status?: number;
      issues?: any[];
    };
    err.status = res.status;
    err.issues = data?.issues;
    throw err;
  }
  return data as T;
}

// ===================== PUBLIC STOREFRONT =====================

export async function fetchStoreConfig(): Promise<StoreConfig> {
  return requestJson<StoreConfig>('/api/store/config');
}

export async function fetchPublicProducts(): Promise<Product[]> {
  const data = await requestJson<{ products: Product[] }>('/api/products');
  return data.products;
}

export async function validateCartStock(items: Array<{ productId: number; quantity: number }>) {
  return requestJson<{ valid: boolean }>('/api/cart/validate', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function createOrder(payload: {
  customer: {
    name: string;
    phone: string;
    instagram: string;
    address: string;
  };
  items: Array<{ productId: number; quantity: number }>;
  note: string;
  idempotencyKey: string;
}): Promise<{ order: OrderRecord; deduplicated?: boolean }> {
  return requestJson('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function lookupCustomerOrder(
  orderNumber: string,
  phone: string
): Promise<{ order: OrderRecord }> {
  return requestJson('/api/orders/lookup', {
    method: 'POST',
    body: JSON.stringify({ orderNumber, phone }),
  });
}

// ===================== ADMIN AUTH =====================

export async function fetchAdminAuthStatus(): Promise<{
  needsSetup: boolean;
  envConfigured: boolean;
}> {
  return requestJson('/api/admin/auth/status');
}

export async function setupAdminAccount(
  username: string,
  password: string
): Promise<{ token: string; admin: { username: string; role: string } }> {
  return requestJson('/api/admin/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function loginAdmin(
  username: string,
  password: string
): Promise<{ token: string; admin: { username: string; role: string } }> {
  return requestJson('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchAdminMe(): Promise<{ admin: { username: string; role: string } }> {
  return requestJson('/api/admin/auth/me', {}, true);
}

// ===================== ADMIN DASHBOARD & SALES =====================

export async function fetchAdminDashboard(): Promise<DashboardSummary> {
  return requestJson('/api/admin/dashboard', {}, true);
}

export async function fetchSalesReport(
  startDate: string,
  endDate: string
): Promise<SalesReportData> {
  const qs = new URLSearchParams({ startDate, endDate });
  return requestJson(`/api/admin/sales?${qs.toString()}`, {}, true);
}

// ===================== ADMIN PRODUCTS & IMAGES =====================

export async function fetchAdminProducts(): Promise<Product[]> {
  const data = await requestJson<{ products: Product[] }>('/api/admin/products', {}, true);
  return data.products;
}

export async function createAdminProduct(payload: {
  name: string;
  description: string;
  price: number;
  capacity: number;
  stock: number;
  category: string;
  status: ProductStatus;
}): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    '/api/admin/products',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    true
  );
  return data.product;
}

export async function updateAdminProduct(
  id: number,
  payload: Partial<{
    name: string;
    description: string;
    price: number;
    capacity: number;
    stock: number;
    category: string;
    status: ProductStatus;
  }>
): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/products/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    true
  );
  return data.product;
}

export async function restockAdminProduct(
  id: number,
  mode: 'add' | 'new_round',
  quantity: number
): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/products/${id}/restock`,
    {
      method: 'POST',
      body: JSON.stringify({ mode, quantity }),
    },
    true
  );
  return data.product;
}

export async function deleteAdminProduct(
  id: number
): Promise<{ deleted: boolean; softDeleted: boolean }> {
  return requestJson(`/api/admin/products/${id}`, { method: 'DELETE' }, true);
}

export async function uploadProductImages(productId: number, files: File[]): Promise<Product> {
  const form = new FormData();
  files.forEach((f) => form.append('images', f));
  const data = await requestJson<{ product: Product }>(
    `/api/admin/products/${productId}/images`,
    {
      method: 'POST',
      body: form,
    },
    true
  );
  return data.product;
}

export async function replaceProductImage(imageId: number, file: File): Promise<Product> {
  const form = new FormData();
  form.append('image', file);
  const data = await requestJson<{ product: Product }>(
    `/api/admin/images/${imageId}`,
    {
      method: 'PUT',
      body: form,
    },
    true
  );
  return data.product;
}

export async function setPrimaryProductImage(imageId: number): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/images/${imageId}/primary`,
    { method: 'PATCH' },
    true
  );
  return data.product;
}

export async function linkImageDriveFileId(
  imageId: number,
  driveFileId: string | null
): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/images/${imageId}/drive`,
    {
      method: 'PATCH',
      body: JSON.stringify({ driveFileId }),
    },
    true
  );
  return data.product;
}

export async function reorderProductImages(
  productId: number,
  imageIds: number[]
): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/products/${productId}/images/reorder`,
    {
      method: 'PUT',
      body: JSON.stringify({ imageIds }),
    },
    true
  );
  return data.product;
}

export async function deleteProductImage(imageId: number): Promise<Product> {
  const data = await requestJson<{ product: Product }>(
    `/api/admin/images/${imageId}`,
    { method: 'DELETE' },
    true
  );
  return data.product;
}

// ===================== ADMIN ORDERS & SETTINGS =====================

export async function fetchAdminOrders(
  status = 'all',
  search = ''
): Promise<OrderRecord[]> {
  const qs = new URLSearchParams({ status, search });
  const data = await requestJson<{ orders: OrderRecord[] }>(
    `/api/admin/orders?${qs.toString()}`,
    {},
    true
  );
  return data.orders;
}

export async function markOrderAsRead(orderId: number) {
  return requestJson(`/api/admin/orders/${orderId}/read`, { method: 'PATCH' }, true);
}

export async function markAllOrdersAsRead() {
  return requestJson('/api/admin/orders/mark-all-read', { method: 'POST' }, true);
}

export async function updateAdminOrderStatus(
  orderId: number,
  status: OrderStatus,
  shippingFee?: number
): Promise<OrderRecord> {
  const data = await requestJson<{ order: OrderRecord }>(
    `/api/admin/orders/${orderId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, shipping_fee: shippingFee }),
    },
    true
  );
  return data.order;
}

export async function markOrdersSheetsSynced(orderIds: number[]) {
  return requestJson(
    '/api/admin/orders/mark-sheets-synced',
    {
      method: 'POST',
      body: JSON.stringify({ orderIds }),
    },
    true
  );
}

export async function fetchAdminSettings(): Promise<StoreConfig> {
  return requestJson('/api/admin/settings', {}, true);
}

export async function updateAdminSettings(payload: Partial<StoreConfig>): Promise<StoreConfig> {
  return requestJson(
    '/api/admin/settings',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    true
  );
}

export async function uploadStoreLogo(file: File): Promise<StoreConfig> {
  const form = new FormData();
  form.append('logo', file);
  return requestJson<StoreConfig>(
    '/api/admin/settings/logo',
    {
      method: 'POST',
      body: form,
    },
    true
  );
}

export async function deleteStoreLogo(): Promise<StoreConfig> {
  return requestJson<StoreConfig>(
    '/api/admin/settings/logo',
    {
      method: 'DELETE',
    },
    true
  );
}
