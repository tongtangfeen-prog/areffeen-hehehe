import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  Cloud,
  CloudUpload,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  createAdminProduct,
  deleteAdminProduct,
  deleteStoreLogo,
  fetchAdminAuthStatus,
  fetchAdminDashboard,
  fetchAdminOrders,
  fetchAdminProducts,
  fetchAdminSettings,
  fetchSalesReport,
  getAdminToken,
  linkImageDriveFileId,
  loginAdmin,
  markAllOrdersAsRead,
  markOrderAsRead,
  markOrdersSheetsSynced,
  restockAdminProduct,
  setAdminToken,
  setupAdminAccount,
  updateAdminOrderStatus,
  updateAdminProduct,
  updateAdminSettings,
  uploadProductImages,
  uploadStoreLogo,
} from '../lib/api';
import { exportSalesToExcel, exportSalesToPdf } from '../lib/exportReports';
import {
  createBakerySpreadsheet,
  deleteDriveFileById,
  ensureBakeryDriveFolder,
  getWorkspaceAccessToken,
  initWorkspaceAuth,
  listDriveFolderFiles,
  syncOrdersToGoogleSheet,
  uploadImageBlobToDrive,
  workspaceGoogleSignIn,
  workspaceLogout,
  type DriveFileItem,
} from '../lib/workspaceAuth';
import {
  ORDER_STATUS_META,
  STOCK_STATE_META,
  type DashboardSummary,
  type OrderRecord,
  type OrderStatus,
  type Product,
  type ProductStatus,
  type SalesReportData,
  type StoreConfig,
} from '../types';
import { AdminImageManagerModal } from './AdminImageManagerModal';
import { ConfirmDialog } from './ConfirmDialog';
import { GoogleSignInButton } from './GoogleSignInButton';
import { SafeImage } from './SafeImage';

type AdminTab = 'overview' | 'products' | 'orders' | 'sales' | 'settings';

interface AdminDashboardProps {
  onBackToStore: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const ALL_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'delivering',
  'completed',
  'cancelled',
];

function getLocalDateStr(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onBackToStore,
  isDark,
  onToggleTheme,
}) => {
  // Admin Auth state
  const [authChecking, setAuthChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [adminUser, setAdminUser] = useState<{ username: string; role: string } | null>(null);
  const [authUsername, setAuthUsername] = useState('owner');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Navigation & UI state
  const [tab, setTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bannerToast, setBannerToast] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Core Data
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [chartRange, setChartRange] = useState<'daily' | 'last7Days' | 'monthly'>('last7Days');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [settings, setSettings] = useState<StoreConfig>({
    shipping_mode: 'fixed',
    shipping_fee: 40,
    free_shipping_threshold: 500,
    google_sheet_id: '',
    google_sheet_url: '',
    google_drive_folder_id: '',
  });

  // Sales Report state
  const [salesStart, setSalesStart] = useState(getLocalDateStr(29));
  const [salesEnd, setSalesEnd] = useState(getLocalDateStr(0));
  const [salesReport, setSalesReport] = useState<SalesReportData | null>(null);

  // Modals
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState('50');
  const [prodCapacity, setProdCapacity] = useState('30');
  const [prodStock, setProdStock] = useState('30');
  const [prodCategory, setProdCategory] = useState('บราวนี่ & เค้ก');
  const [prodStatus, setProdStatus] = useState<ProductStatus>('active');
  const [prodInitialFiles, setProdInitialFiles] = useState<Array<{ file: File; preview: string }>>(
    []
  );
  const [savingProduct, setSavingProduct] = useState(false);
  const initialFileInputRef = useRef<HTMLInputElement | null>(null);

  const [imageManagerProduct, setImageManagerProduct] = useState<Product | null>(null);
  const [restockProduct, setRestockProduct] = useState<Product | null>(null);
  const [restockMode, setRestockMode] = useState<'add' | 'new_round'>('add');
  const [restockQty, setRestockQty] = useState('20');

  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [shippingFeeDraft, setShippingFeeDraft] = useState('');

  // Confirm Dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    details?: string[];
    confirmLabel: string;
    tone: 'danger' | 'primary';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Google Workspace Auth + Drive & Sheets state
  const [wsNeedsAuth, setWsNeedsAuth] = useState(true);
  const [wsUser, setWsUser] = useState<User | null>(null);
  const [wsBusy, setWsBusy] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [sheetIdInput, setSheetIdInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setBannerToast(msg);
    window.setTimeout(() => {
      setBannerToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Initialize Workspace Auth listener
  useEffect(() => {
    const unsub = initWorkspaceAuth(
      (user) => {
        setWsUser(user);
        setWsNeedsAuth(false);
      },
      () => {
        setWsUser(null);
        setWsNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  // Check Admin auth status on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await fetchAdminAuthStatus();
        if (!active) return;
        setNeedsSetup(status.needsSetup);
        setEnvConfigured(status.envConfigured);
        if (getAdminToken()) {
          // Verify existing in-memory session
          const dash = await fetchAdminDashboard();
          if (!active) return;
          setDashboard(dash);
          setAdminUser({ username: 'owner', role: 'owner' });
        }
      } catch {
        setAdminToken(null);
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshAllAdminData = useCallback(async () => {
    if (!getAdminToken()) return;
    try {
      const [dash, prods, ords, cfg] = await Promise.all([
        fetchAdminDashboard(),
        fetchAdminProducts(),
        fetchAdminOrders(orderStatusFilter, orderSearch),
        fetchAdminSettings(),
      ]);
      setDashboard(dash);
      setProducts(prods);
      setOrders(ords);
      setSettings(cfg);
      setSheetIdInput(cfg.google_sheet_id || '');
      setGlobalError(null);
    } catch (err: any) {
      if (err?.status === 401) {
        setAdminToken(null);
        setAdminUser(null);
      } else {
        setGlobalError(err?.message || 'โหลดข้อมูลระบบหลังบ้านไม่สำเร็จ');
      }
    }
  }, [orderStatusFilter, orderSearch]);

  const refreshSalesReport = useCallback(async () => {
    if (!getAdminToken()) return;
    try {
      const report = await fetchSalesReport(salesStart, salesEnd);
      setSalesReport(report);
    } catch (err: any) {
      setGlobalError(err?.message || 'ไม่สามารถโหลดรายงานยอดขายได้');
    }
  }, [salesStart, salesEnd]);

  useEffect(() => {
    if (adminUser) {
      refreshAllAdminData();
    }
  }, [adminUser, refreshAllAdminData]);

  useEffect(() => {
    if (adminUser && (tab === 'sales' || tab === 'settings')) {
      refreshSalesReport();
    }
  }, [adminUser, tab, refreshSalesReport]);

  // Poll for new orders every 15s while logged into Admin
  useEffect(() => {
    if (!adminUser) return;
    const id = window.setInterval(async () => {
      if (!getAdminToken()) return;
      try {
        const dash = await fetchAdminDashboard();
        setDashboard(dash);
      } catch {
        // Silent background poll
      }
    }, 15000);
    return () => window.clearInterval(id);
  }, [adminUser]);

  // Auth submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (needsSetup) {
      if (authUsername.trim().length < 3) {
        setAuthError('ชื่อผู้ใช้ต้องมีความยาวอย่างน้อย 3 ตัวอักษร');
        return;
      }
      if (authPassword.length < 6) {
        setAuthError('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
        return;
      }
      if (authPassword !== authPasswordConfirm) {
        setAuthError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
      }
    }

    setAuthSubmitting(true);
    try {
      const result = needsSetup
        ? await setupAdminAccount(authUsername.trim(), authPassword)
        : await loginAdmin(authUsername.trim(), authPassword);
      setAdminToken(result.token);
      setAdminUser(result.admin);
      setNeedsSetup(false);
      setAuthPassword('');
      setAuthPasswordConfirm('');
      showToast(`ยินดีต้อนรับคุณ ${result.admin.username} เข้าสู่หลังบ้าน Bibi's Treats 🩵`);
    } catch (err: any) {
      setAuthError(err?.message || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    setAdminUser(null);
    setDashboard(null);
    setProducts([]);
    setOrders([]);
  };

  // Product modal handlers
  const openAddProductModal = () => {
    setEditingProduct(null);
    setProdName('');
    setProdDesc('');
    setProdPrice('55');
    setProdCapacity('30');
    setProdStock('30');
    setProdCategory('บราวนี่ & เค้ก');
    setProdStatus('active');
    setProdInitialFiles([]);
    setProductModalOpen(true);
  };

  const openEditProductModal = (p: Product) => {
    setEditingProduct(p);
    setProdName(p.name);
    setProdDesc(p.description);
    setProdPrice(String(p.price));
    setProdCapacity(String(p.capacity));
    setProdStock(String(p.stock));
    setProdCategory(p.category);
    setProdStatus(p.status);
    setProdInitialFiles([]);
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProduct(true);
    setGlobalError(null);
    try {
      const payload = {
        name: prodName.trim(),
        description: prodDesc.trim(),
        price: Number(prodPrice),
        capacity: Math.max(0, Math.floor(Number(prodCapacity))),
        stock: Math.max(0, Math.floor(Number(prodStock))),
        category: prodCategory.trim() || 'ขนมหวาน',
        status: prodStatus,
      };

      if (editingProduct) {
        await updateAdminProduct(editingProduct.id, payload);
        showToast(`บันทึกการแก้ไข "${payload.name}" เรียบร้อยแล้ว`);
      } else {
        const created = await createAdminProduct(payload);
        if (prodInitialFiles.length > 0) {
          await uploadProductImages(
            created.id,
            prodInitialFiles.map((f) => f.file)
          );
          prodInitialFiles.forEach((f) => URL.revokeObjectURL(f.preview));
        }
        showToast(`เพิ่มเมนูใหม่ "${payload.name}" เรียบร้อยแล้ว ✨`);
      }

      setProductModalOpen(false);
      await refreshAllAdminData();
    } catch (err: any) {
      setGlobalError(err?.message || 'บันทึกเมนูไม่สำเร็จ');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleToggleProductStatus = async (p: Product) => {
    const nextStatus: ProductStatus = p.status === 'active' ? 'inactive' : 'active';
    try {
      await updateAdminProduct(p.id, { status: nextStatus });
      showToast(
        nextStatus === 'active'
          ? `เปิดขายเมนู "${p.name}" แล้ว`
          : `ปิดการขายเมนู "${p.name}" ชั่วคราวแล้ว`
      );
      await refreshAllAdminData();
    } catch (err: any) {
      setGlobalError(err?.message || 'เปลี่ยนสถานะเมนูไม่สำเร็จ');
    }
  };

  const requestDeleteProduct = (p: Product) => {
    setConfirmDialog({
      title: `ลบเมนู "${p.name}"?`,
      description:
        'หากเมนูนี้เคยมีประวัติการสั่งซื้อ ระบบจะเก็บประวัติออเดอร์เดิมไว้ครบถ้วน และซ่อนเมนูออกจากหน้าร้าน',
      confirmLabel: 'ยืนยันการลบ',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          const res = await deleteAdminProduct(p.id);
          showToast(
            res.softDeleted
              ? `ซ่อนเมนู "${p.name}" เรียบร้อยแล้ว (เก็บประวัติออเดอร์เดิมไว้ครบถ้วน)`
              : `ลบเมนู "${p.name}" ออกจากระบบแล้ว`
          );
          await refreshAllAdminData();
        } catch (err: any) {
          setGlobalError(err?.message || 'ลบเมนูไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleRestockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockProduct) return;
    try {
      await restockAdminProduct(restockProduct.id, restockMode, Number(restockQty));
      showToast(
        restockMode === 'new_round'
          ? `เปิดรับออเดอร์รอบใหม่ "${restockProduct.name}" (${restockQty} ชิ้น) แล้ว`
          : `เติมสต็อก "${restockProduct.name}" เพิ่ม ${restockQty} ชิ้นแล้ว`
      );
      setRestockProduct(null);
      await refreshAllAdminData();
    } catch (err: any) {
      setGlobalError(err?.message || 'อัปเดตจำนวนสินค้าไม่สำเร็จ');
    }
  };

  // Order detail & status update
  const openOrderDetail = async (order: OrderRecord) => {
    setSelectedOrder(order);
    setShippingFeeDraft(order.shipping_fee === null ? '' : String(order.shipping_fee));
    if (order.is_read === 0) {
      try {
        await markOrderAsRead(order.id);
        await refreshAllAdminData();
      } catch {
        // Ignore read receipt error
      }
    }
  };

  const applyOrderStatusChange = async (order: OrderRecord, nextStatus: OrderStatus) => {
    const shippingVal =
      shippingFeeDraft.trim() !== '' && Number.isFinite(Number(shippingFeeDraft))
        ? Number(shippingFeeDraft)
        : undefined;

    if (nextStatus === 'cancelled' && order.status !== 'cancelled') {
      setConfirmDialog({
        title: `ยืนยันยกเลิกออเดอร์ ${order.order_number}?`,
        description:
          'เมื่อยกเลิกออเดอร์ ระบบจะคืนจำนวนสินค้า (Stock) กลับเข้าคลังโดยอัตโนมัติเพียงครั้งเดียวเพื่อป้องกันการคืนซ้ำ',
        details: order.items.map((it) => `คืนสต็อก ${it.product_name} จำนวน ${it.quantity} ชิ้น`),
        confirmLabel: 'ยืนยันยกเลิกออเดอร์',
        tone: 'danger',
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            const updated = await updateAdminOrderStatus(order.id, 'cancelled', shippingVal);
            setSelectedOrder(updated);
            showToast(`ยกเลิกออเดอร์ ${order.order_number} และคืนสต็อกเรียบร้อยแล้ว`);
            await refreshAllAdminData();
          } catch (err: any) {
            setGlobalError(err?.message || 'ยกเลิกออเดอร์ไม่สำเร็จ');
          } finally {
            setConfirmBusy(false);
            setConfirmDialog(null);
          }
        },
      });
      return;
    }

    try {
      const updated = await updateAdminOrderStatus(order.id, nextStatus, shippingVal);
      setSelectedOrder(updated);
      showToast(`อัปเดตออเดอร์ ${order.order_number} เป็น "${ORDER_STATUS_META[nextStatus].label}" แล้ว`);
      await refreshAllAdminData();
    } catch (err: any) {
      setGlobalError(err?.message || 'เปลี่ยนสถานะออเดอร์ไม่สำเร็จ');
    }
  };

  // Settings save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      const updated = await updateAdminSettings({
        shipping_mode: settings.shipping_mode,
        shipping_fee: Number(settings.shipping_fee || 0),
        free_shipping_threshold: Number(settings.free_shipping_threshold || 0),
        google_sheet_id: sheetIdInput.trim(),
      });
      setSettings(updated);
      showToast('บันทึกการตั้งค่าร้านเรียบร้อยแล้ว 🩵');
    } catch (err: any) {
      setGlobalError(err?.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setGlobalError('ไฟล์โลโก้มีขนาดใหญ่เกิน 5MB กรุณาเลือกไฟล์ที่เล็กลง');
      return;
    }
    setLogoUploading(true);
    setGlobalError(null);
    try {
      const updated = await uploadStoreLogo(file);
      setSettings(updated);
      showToast('อัปเดตโลโก้ร้านเรียบร้อยแล้ว 🩵');
    } catch (err: any) {
      setGlobalError(err?.message || 'อัปโหลดโลโก้ร้านไม่สำเร็จ');
    } finally {
      setLogoUploading(false);
    }
  };

  const requestDeleteStoreLogo = () => {
    setConfirmDialog({
      title: 'ยืนยันการลบโลโก้ร้าน?',
      description:
        'เมื่อลบโลโก้ร้านแล้ว หน้าร้านและหลังบ้านจะกลับไปแสดงชื่อร้าน "Bibi\'s Treats 🩵" ตามปกติ และคุณสามารถอัปโหลดโลโก้ใหม่ได้ทุกเมื่อ',
      confirmLabel: 'ยืนยันลบโลโก้',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        setGlobalError(null);
        try {
          const updated = await deleteStoreLogo();
          setSettings(updated);
          showToast('ลบโลโก้ร้านเรียบร้อยแล้ว');
        } catch (err: any) {
          setGlobalError(err?.message || 'ลบโลโก้ร้านไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  // ===================== GOOGLE WORKSPACE ACTIONS =====================

  const handleWorkspaceSignIn = async () => {
    setWsBusy(true);
    setGlobalError(null);
    try {
      const res = await workspaceGoogleSignIn();
      setWsUser(res.user);
      setWsNeedsAuth(false);
      showToast(`เชื่อมต่อ Google Workspace (${res.user.email}) สำเร็จแล้ว`);
      if (settings.google_drive_folder_id) {
        const files = await listDriveFolderFiles(res.accessToken, settings.google_drive_folder_id);
        setDriveFiles(files);
      }
    } catch (err: any) {
      setGlobalError(err?.message || 'เข้าสู่ระบบ Google Workspace ไม่สำเร็จ');
    } finally {
      setWsBusy(false);
    }
  };

  const handleWorkspaceSignOut = async () => {
    await workspaceLogout();
    setWsUser(null);
    setWsNeedsAuth(true);
    setDriveFiles([]);
    showToast('ยกเลิกการเชื่อมต่อ Google Workspace แล้ว');
  };

  const handleRefreshDriveFiles = async () => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setWsNeedsAuth(true);
      return;
    }
    setWsBusy(true);
    setGlobalError(null);
    try {
      const folder = await ensureBakeryDriveFolder(token, settings.google_drive_folder_id || undefined);
      if (folder.id !== settings.google_drive_folder_id) {
        const updated = await updateAdminSettings({ google_drive_folder_id: folder.id });
        setSettings(updated);
      }
      const files = await listDriveFolderFiles(token, folder.id);
      setDriveFiles(files);
      showToast(`โหลดไฟล์จากโฟลเดอร์ "${folder.name}" บน Google Drive แล้ว (${files.length} ไฟล์)`);
    } catch (err: any) {
      setGlobalError(err?.message || 'ไม่สามารถเชื่อมต่อ Google Drive ได้');
    } finally {
      setWsBusy(false);
    }
  };

  const requestBatchBackupPhotosToDrive = () => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setWsNeedsAuth(true);
      setGlobalError('กรุณา Sign in with Google ก่อนสำรองรูปภาพไปยัง Google Drive');
      return;
    }

    const targets = products
      .flatMap((p) =>
        p.images
          .filter((img) => !img.drive_file_id)
          .map((img) => ({ product: p, image: img }))
      );

    if (targets.length === 0) {
      showToast('รูปภาพสินค้าทั้งหมดถูกสำรองขึ้น Google Drive เรียบร้อยแล้ว');
      return;
    }

    setConfirmDialog({
      title: `สำรองรูปภาพ ${targets.length} รูปไปยัง Google Drive?`,
      description:
        'ระบบจะอัปโหลดรูปภาพสินค้าที่ยังไม่ได้สำรองไปยังโฟลเดอร์ "Bibi\'s Treats Photos" ใน Google Drive ของคุณ',
      details: targets.slice(0, 5).map((t) => `${t.product.name} (รูป #${t.image.id})`).concat(
        targets.length > 5 ? [`และอีก ${targets.length - 5} รูป...`] : []
      ),
      confirmLabel: `อัปโหลด ${targets.length} รูปไปยัง Drive`,
      tone: 'primary',
      onConfirm: async () => {
        setConfirmBusy(true);
        setGlobalError(null);
        try {
          const folder = await ensureBakeryDriveFolder(
            token,
            settings.google_drive_folder_id || undefined
          );
          if (folder.id !== settings.google_drive_folder_id) {
            const updated = await updateAdminSettings({ google_drive_folder_id: folder.id });
            setSettings(updated);
          }

          let uploadedCount = 0;
          for (const item of targets) {
            const res = await fetch(item.image.image_url);
            const blob = await res.blob();
            const safeName = `${item.product.name.replace(/[^a-zA-Z0-9ก-๙_-]+/g, '_')}_${item.image.id}.jpg`;
            const driveFile = await uploadImageBlobToDrive(token, folder.id, blob, safeName);
            await linkImageDriveFileId(item.image.id, driveFile.id);
            uploadedCount++;
          }

          const files = await listDriveFolderFiles(token, folder.id);
          setDriveFiles(files);
          await refreshAllAdminData();
          showToast(`สำรองรูปภาพ ${uploadedCount} รูปขึ้น Google Drive เรียบร้อยแล้ว ☁️`);
        } catch (err: any) {
          setGlobalError(err?.message || 'สำรองรูปขึ้น Google Drive ไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const requestDeleteDriveFile = (file: DriveFileItem) => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setWsNeedsAuth(true);
      return;
    }
    setConfirmDialog({
      title: `ลบไฟล์ "${file.name}" จาก Google Drive?`,
      description:
        'การดำเนินการนี้จะลบไฟล์สำรองนี้ออกจาก Google Drive ของคุณอย่างถาวร (รูปในระบบหน้าร้านยังคงอยู่)',
      confirmLabel: 'ลบไฟล์จาก Drive',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await deleteDriveFileById(token, file.id);
          setDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
          showToast(`ลบไฟล์ "${file.name}" ออกจาก Google Drive แล้ว`);
        } catch (err: any) {
          setGlobalError(err?.message || 'ลบไฟล์บน Google Drive ไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const requestCreateGoogleSheet = () => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setWsNeedsAuth(true);
      setGlobalError('กรุณา Sign in with Google ก่อนสร้าง Google Sheet');
      return;
    }
    setConfirmDialog({
      title: 'สร้าง Google Sheet ใหม่สำหรับ Bibi\'s Treats?',
      description:
        'ระบบจะสร้างสเปรดชีตชื่อ "Bibi\'s Treats — Orders & Sales" พร้อมแท็บ Orders และ Sales Summary ในบัญชี Google ของคุณ และซิงก์ออเดอร์ปัจจุบันลงไปทันที',
      confirmLabel: 'สร้างและซิงก์ Google Sheet',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmBusy(true);
        setGlobalError(null);
        try {
          const created = await createBakerySpreadsheet(token);
          const updatedCfg = await updateAdminSettings({
            google_sheet_id: created.spreadsheetId,
            google_sheet_url: created.spreadsheetUrl,
          });
          setSettings(updatedCfg);
          setSheetIdInput(created.spreadsheetId);

          const allOrders = await fetchAdminOrders('all', '');
          const latestSales = await fetchSalesReport(salesStart, salesEnd);
          const syncRes = await syncOrdersToGoogleSheet(
            token,
            created.spreadsheetId,
            allOrders,
            latestSales
          );
          await markOrdersSheetsSynced(allOrders.map((o) => o.id));
          await refreshAllAdminData();
          showToast(`สร้าง Google Sheet และซิงก์ ${syncRes.syncedRows} ออเดอร์เรียบร้อยแล้ว!`);
        } catch (err: any) {
          setGlobalError(err?.message || 'สร้าง Google Sheet ไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const requestSyncToGoogleSheet = () => {
    const token = getWorkspaceAccessToken();
    if (!token) {
      setWsNeedsAuth(true);
      setTab('settings');
      setGlobalError('กรุณา Sign in with Google ในหน้าตั้งค่าก่อนซิงก์ไปยัง Google Sheets');
      return;
    }
    const targetSheetId = sheetIdInput.trim() || settings.google_sheet_id || '';
    if (!targetSheetId) {
      requestCreateGoogleSheet();
      return;
    }

    setConfirmDialog({
      title: 'อัปเดตข้อมูลออเดอร์และยอดขายไปยัง Google Sheets?',
      description:
        'ระบบจะเขียนทับข้อมูลในแท็บแรกของ Google Sheet ที่เชื่อมไว้ด้วยรายการออเดอร์และสรุปยอดขายล่าสุดจากระบบ',
      details: [
        `Spreadsheet ID: ${targetSheetId}`,
        `จำนวนออเดอร์ที่จะซิงก์: ${orders.length} ออเดอร์`,
      ],
      confirmLabel: 'ยืนยันซิงก์ไปยัง Sheets',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmBusy(true);
        setGlobalError(null);
        try {
          const allOrders = await fetchAdminOrders('all', '');
          const latestSales = await fetchSalesReport(salesStart, salesEnd);
          const syncRes = await syncOrdersToGoogleSheet(
            token,
            targetSheetId,
            allOrders,
            latestSales
          );
          await markOrdersSheetsSynced(allOrders.map((o) => o.id));
          await refreshAllAdminData();
          showToast(
            `ซิงก์ข้อมูล ${syncRes.syncedRows} ออเดอร์ไปยังแท็บ "${syncRes.primarySheetTitle}" เรียบร้อยแล้ว`
          );
        } catch (err: any) {
          setGlobalError(err?.message || 'ซิงก์ไปยัง Google Sheets ไม่สำเร็จ');
        } finally {
          setConfirmBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const activeChartData = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.salesSeries[chartRange] || [];
  }, [dashboard, chartRange]);

  const activeChartTotals = useMemo(() => {
    return activeChartData.reduce(
      (acc, p) => ({
        revenue: acc.revenue + p.revenue,
        orders: acc.orders + p.orders,
        itemsSold: acc.itemsSold + p.itemsSold,
      }),
      { revenue: 0, orders: 0, itemsSold: 0 }
    );
  }, [activeChartData]);

  // ===================== AUTH SCREEN =====================
  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FBFF]">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#E3F2FF] mx-auto animate-pulse" />
          <p className="text-sm text-[#567394]">กำลังตรวจสอบสิทธิ์เจ้าของร้าน...</p>
        </div>
      </div>
    );
  }

  if (!adminUser) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#EAF5FF] via-[#F8FBFF] to-[#FFFDF9] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bakery-card rounded-3xl sm:rounded-[32px] p-5 sm:p-8">
          <div className="flex items-center justify-between gap-2 mb-4 sm:mb-5">
            <button
              type="button"
              onClick={onBackToStore}
              className="text-xs font-medium text-[#3B89CC] hover:text-[#235F96] flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              กลับไปหน้าร้าน Bibi&apos;s Treats
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              title={isDark ? 'โหมดสว่าง' : 'โหมดมืด'}
              className="p-2 rounded-xl bg-[#EFF7FF] hover:bg-[#DFEEFE] text-[#2F7CC0] transition-colors cursor-pointer shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#E4F3FF] text-[#2F7CC0] flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#567394]">Cute Blue Admin Dashboard</p>
              <h1 className="text-lg sm:text-xl font-bold text-[#1C3554] leading-snug">
                {needsSetup ? 'ตั้งค่าบัญชีเจ้าของร้านครั้งแรก' : 'เข้าสู่ระบบหลังบ้าน 🩵'}
              </h1>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-[#567394]">
            {needsSetup
              ? 'กำหนดชื่อผู้ใช้และรหัสผ่านสำหรับเจ้าของร้าน Bibi\'s Treats ระบบจะเข้ารหัสรหัสผ่านอย่างปลอดภัยบนเซิร์ฟเวอร์'
              : envConfigured
              ? 'กรอกชื่อผู้ใช้และรหัสผ่านเจ้าของร้านที่ตั้งค่าไว้ใน Secrets เพื่อจัดการเมนู รูปภาพ สต็อก และออเดอร์'
              : 'กรอกชื่อผู้ใช้และรหัสผ่านเจ้าของร้าน เพื่อเข้าสู่ระบบจัดการร้าน Bibi\'s Treats'}
          </p>

          {authError && (
            <div className="mt-4 rounded-2xl bg-[#FFF0F3] border border-[#F8C8D4] px-4 py-3 text-xs text-[#B4233C]">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                ชื่อผู้ใช้ (Username)
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="เช่น owner หรือ bibi"
                className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                รหัสผ่าน (Password)
              </label>
              <input
                type="password"
                required
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC]"
              />
            </div>

            {needsSetup && (
              <div>
                <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                  ยืนยันรหัสผ่านอีกครั้ง
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={authPasswordConfirm}
                  onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                  placeholder="กรอกรหัสผ่านเดิมอีกครั้ง"
                  className="w-full px-4 py-3 rounded-2xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm focus:outline-none focus:bg-white focus:border-[#3B89CC]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full h-12 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
            >
              {authSubmitting
                ? 'กำลังตรวจสอบ...'
                : needsSetup
                ? 'สร้างบัญชีเจ้าของร้านและเข้าสู่ระบบ'
                : 'เข้าสู่ระบบเจ้าของร้าน 💙'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ===================== ADMIN DASHBOARD SHELL =====================
  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'overview', label: 'ภาพรวมร้าน', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'products', label: 'จัดการเมนู & รูปภาพ', icon: <Package className="w-4 h-4" /> },
    {
      id: 'orders',
      label: 'จัดการออเดอร์',
      icon: <ShoppingBag className="w-4 h-4" />,
      badge: dashboard?.unreadOrdersCount || 0,
    },
    { id: 'sales', label: 'สรุปยอดขาย', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'ตั้งค่า & Google', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F6FAFF] text-[#1C3554] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-[#E1EFFB]">
        <div className="h-16 px-5 flex items-center justify-between border-b border-[#EAF3FC]">
          <span className="inline-flex items-center gap-2 font-display text-lg font-bold text-[#1C3554] whitespace-nowrap">
            {settings.store_logo_url && (
              <SafeImage
                src={settings.store_logo_url}
                alt="โลโก้ร้าน"
                className="w-8 h-8 rounded-xl object-cover border border-[#DCECFB] shrink-0"
              />
            )}
            <span>Bibi&apos;s Admin 🩵</span>
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`w-full px-3.5 py-2.5 rounded-2xl text-sm font-medium flex items-center justify-between transition-colors cursor-pointer ${
                tab === item.id
                  ? 'bg-[#E5F3FF] text-[#1D5FA7] font-semibold'
                  : 'text-[#4C6A8B] hover:bg-[#F3F9FF]'
              }`}
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                {item.icon}
                {item.label}
              </span>
              {item.badge && item.badge > 0 ? (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#E13E59] text-white text-xs font-bold flex items-center justify-center tabular-nums">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-[#EAF3FC] space-y-2">
          <button
            type="button"
            onClick={onBackToStore}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F9FF] hover:bg-[#E5F3FF] text-[#2F7CC0] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            ดูหน้าร้านลูกค้า
          </button>
          <button
            type="button"
            onClick={handleAdminLogout}
            className="w-full px-3.5 py-2 rounded-xl text-[#6B89A8] hover:bg-[#FFF0F3] hover:text-[#C42746] text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ ({adminUser.username})
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-[#1C3554]/40 backdrop-blur-[2px] flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-72 bg-white h-full p-4 flex flex-col justify-between shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#EAF3FC]">
                <span className="inline-flex items-center gap-2 font-display text-lg font-bold text-[#1C3554]">
                  {settings.store_logo_url && (
                    <SafeImage
                      src={settings.store_logo_url}
                      alt="โลโก้ร้าน"
                      className="w-7 h-7 rounded-lg object-cover border border-[#DCECFB] shrink-0"
                    />
                  )}
                  <span>Bibi&apos;s Admin 🩵</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 rounded-xl text-[#567394]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="mt-3 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-3.5 py-3 rounded-2xl text-sm font-medium flex items-center justify-between ${
                      tab === item.id
                        ? 'bg-[#E5F3FF] text-[#1D5FA7] font-semibold'
                        : 'text-[#4C6A8B]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      {item.icon}
                      {item.label}
                    </span>
                    {item.badge && item.badge > 0 ? (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#E13E59] text-white text-xs font-bold flex items-center justify-center tabular-nums">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </nav>
            </div>
            <div className="space-y-2 border-t border-[#EAF3FC] pt-4">
              <button
                type="button"
                onClick={onBackToStore}
                className="w-full py-2.5 rounded-xl bg-[#F3F9FF] text-[#2F7CC0] text-xs font-semibold"
              >
                กลับไปดูหน้าร้านลูกค้า
              </button>
              <button
                type="button"
                onClick={handleAdminLogout}
                className="w-full py-2 rounded-xl text-[#C42746] text-xs font-medium"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Admin Header */}
        <header className="sticky top-0 z-30 h-16 bg-white/92 backdrop-blur-md border-b border-[#E1EFFB] px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-[#4C6A8B] hover:bg-[#EFF7FF]"
              aria-label="เปิดเมนูหลังบ้าน"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-[#1C3554] truncate">
              {navItems.find((n) => n.id === tab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-2.5 rounded-xl bg-[#F3F9FF] hover:bg-[#E4F2FF] text-[#2F7CC0] transition-colors cursor-pointer"
              title={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                refreshAllAdminData();
                if (tab === 'sales') refreshSalesReport();
              }}
              className="p-2.5 rounded-xl bg-[#F3F9FF] hover:bg-[#E4F2FF] text-[#2F7CC0] transition-colors cursor-pointer"
              title="รีเฟรชข้อมูลล่าสุด"
              aria-label="รีเฟรชข้อมูล"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setTab('orders')}
              className="relative px-3.5 py-2 rounded-xl bg-[#EFF7FF] hover:bg-[#E1F0FE] text-[#1D5FA7] text-xs font-semibold flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">ออเดอร์ใหม่</span>
              <span className="font-mono tabular-nums font-bold">
                {dashboard?.unreadOrdersCount ?? 0}
              </span>
            </button>
          </div>
        </header>

        {/* Notifications & Alerts */}
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-5 space-y-4">
          {dashboard && dashboard.unreadOrdersCount > 0 && dashboard.latestUnreadOrder && (
            <div className="rounded-2xl bg-gradient-to-r from-[#E4F3FF] to-[#F3FAFF] border border-[#BDE0FC] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#3B89CC] text-white flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1C3554]">
                    🔔 มีออเดอร์ใหม่! ({dashboard.unreadOrdersCount} รายการที่ยังไม่ตรวจสอบ)
                  </p>
                  <p className="text-xs text-[#426385] tabular-nums">
                    Order <span className="font-mono font-semibold">{dashboard.latestUnreadOrder.order_number}</span> ·{' '}
                    {dashboard.latestUnreadOrder.customer_name} · ยอดรวม{' '}
                    {dashboard.latestUnreadOrder.total.toLocaleString()} บาท
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await markAllOrdersAsRead();
                    await refreshAllAdminData();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-[#CFE6FA] text-xs font-medium text-[#4C6A8B] hover:bg-[#F5FAFF] cursor-pointer"
                >
                  ทำเครื่องหมายว่าอ่านแล้ว
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('orders');
                    const found = orders.find((o) => o.id === dashboard.latestUnreadOrder?.id);
                    if (found) openOrderDetail(found);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                >
                  ดูออเดอร์
                </button>
              </div>
            </div>
          )}

          {bannerToast && (
            <div className="rounded-2xl bg-[#1C3554] text-white px-4 py-3 text-sm flex items-center justify-between">
              <span>{bannerToast}</span>
              <button type="button" onClick={() => setBannerToast(null)} className="text-xs opacity-75">
                ปิด
              </button>
            </div>
          )}

          {globalError && (
            <div className="rounded-2xl bg-[#FFF0F3] border border-[#F8C8D4] px-4 py-3 text-sm text-[#B4233C] flex items-center justify-between">
              <span>{globalError}</span>
              <button type="button" onClick={() => setGlobalError(null)} className="text-xs underline">
                ปิด
              </button>
            </div>
          )}
        </div>

        {/* Tab Viewports */}
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1">
          {/* ==================== TAB 1: OVERVIEW ==================== */}
          {tab === 'overview' && dashboard && (
            <div className="space-y-6">
              {/* 6 Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
                {[
                  { label: 'ออเดอร์ทั้งหมด', value: `${dashboard.totalOrders.toLocaleString()}`, unit: 'ออเดอร์' },
                  { label: 'ออเดอร์วันนี้', value: `${dashboard.todayOrders.toLocaleString()}`, unit: 'ออเดอร์' },
                  { label: 'ยอดขายวันนี้', value: `${dashboard.todaySales.toLocaleString()}`, unit: 'บาท' },
                  { label: 'ยอดขายรวม', value: `${dashboard.totalSales.toLocaleString()}`, unit: 'บาท' },
                  { label: 'สินค้าทั้งหมด', value: `${dashboard.totalProducts.toLocaleString()}`, unit: 'เมนู' },
                  { label: 'สินค้าคงเหลือ', value: `${dashboard.totalRemainingStock.toLocaleString()}`, unit: 'ชิ้น' },
                ].map((stat) => (
                  <div key={stat.label} className="bakery-card rounded-2xl p-3.5 sm:p-4">
                    <p className="text-[11px] sm:text-xs font-medium text-[#567394] leading-snug">
                      {stat.label}
                    </p>
                    <p className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold text-[#1C3554] tabular-nums">
                      {stat.value}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#7A95B2]">{stat.unit}</p>
                  </div>
                ))}
              </div>

              {/* Sales Chart + Best Selling Menu */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bakery-card rounded-3xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                    <div>
                      <h2 className="text-base font-bold text-[#1C3554]">Sales Overview</h2>
                      <p className="text-xs text-[#567394] tabular-nums">
                        ยอดขายยืนยันแล้ว {activeChartTotals.revenue.toLocaleString()} บาท ·{' '}
                        {activeChartTotals.orders} ออเดอร์ · {activeChartTotals.itemsSold} ชิ้น
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFF7FF]">
                      {(
                        [
                          ['daily', 'รายวัน'],
                          ['last7Days', '7 วันล่าสุด'],
                          ['monthly', 'รายเดือน'],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setChartRange(key)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            chartRange === key
                              ? 'bg-white text-[#1D5FA7] shadow-sm font-semibold'
                              : 'text-[#567394] hover:text-[#1C3554]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={activeChartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="pastelBlueArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#5CA9E6" stopOpacity={0.38} />
                            <stop offset="95%" stopColor="#5CA9E6" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={isDark ? '#243B59' : '#EAF2FA'}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: isDark ? '#98B4D4' : '#567394' }}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: isDark ? '#98B4D4' : '#567394' }}
                        />
                        <Tooltip
                          formatter={(val: any) => [`${Number(val).toLocaleString()} บาท`, 'ยอดขาย']}
                          contentStyle={{
                            borderRadius: 14,
                            border: isDark ? '1px solid #2C4768' : '1px solid #D9ECFF',
                            backgroundColor: isDark ? '#142236' : '#FFFFFF',
                            color: isDark ? '#EDF5FF' : '#1C3554',
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          stroke={isDark ? '#77C2FA' : '#3B89CC'}
                          strokeWidth={2.5}
                          fill="url(#pastelBlueArea)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Best Selling Menu */}
                <div className="lg:col-span-4 bakery-card rounded-3xl p-5 sm:p-6">
                  <h2 className="text-base font-bold text-[#1C3554]">Best Selling Menu</h2>
                  <p className="text-xs text-[#567394]">เรียงตามจำนวนที่ขายได้จริง</p>

                  <div className="mt-4 space-y-3">
                    {dashboard.bestSellers.length === 0 ? (
                      <p className="text-sm text-[#6B89A8] py-8 text-center">ยังไม่มีข้อมูลการขาย</p>
                    ) : (
                      dashboard.bestSellers.map((item, idx) => (
                        <div
                          key={`${item.product_name}-${idx}`}
                          className="flex items-center gap-3 py-1.5"
                        >
                          <span className="w-6 text-xs font-mono font-bold text-[#3B89CC] tabular-nums">
                            0{idx + 1}.
                          </span>
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#F1F8FF] shrink-0">
                            <SafeImage
                              src={item.product_image}
                              alt={item.product_name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#1C3554] truncate">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-[#567394] tabular-nums">
                              ขายแล้ว {item.units_sold} ชิ้น · {item.revenue.toLocaleString()} ฿
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Recent Orders (Mobile Cards + Desktop Table) */}
              <div className="bakery-card rounded-3xl overflow-hidden">
                <div className="px-4 sm:px-6 py-4 border-b border-[#EAF3FC] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-[#1C3554]">Recent Orders</h2>
                    <p className="text-xs text-[#567394] leading-snug">
                      แตะที่รายการเพื่อดูรายละเอียดหรืออัปเดตสถานะ
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('orders')}
                    className="text-xs font-semibold text-[#3B89CC] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ดูทั้งหมด →
                  </button>
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden divide-y divide-[#EEF5FC]">
                  {dashboard.recentOrders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => openOrderDetail(o)}
                      className="w-full text-left px-4 py-3.5 hover:bg-[#F7FBFF] active:bg-[#EFF7FF] transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-[#2F7CC0]">
                          {o.order_number}
                        </span>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-semibold whitespace-nowrap ${
                            ORDER_STATUS_META[o.status].colorClass
                          }`}
                        >
                          {ORDER_STATUS_META[o.status].label}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-[#1C3554] truncate">
                          {o.customer_name}
                        </span>
                        <span className="text-sm font-bold text-[#1C3554] tabular-nums shrink-0">
                          {o.total.toLocaleString()} ฿
                        </span>
                      </div>
                      <p className="text-xs text-[#4C6A8B] line-clamp-1">
                        {o.items.map((it) => `${it.product_name} ×${it.quantity}`).join(', ')}
                      </p>
                      <p className="text-[11px] font-mono text-[#7A95B2] tabular-nums">
                        {o.created_at}
                      </p>
                    </button>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F5FAFF] text-xs text-[#567394]">
                      <tr>
                        <th className="px-5 py-3 font-medium">เลขออเดอร์</th>
                        <th className="px-5 py-3 font-medium">ลูกค้า</th>
                        <th className="px-5 py-3 font-medium">รายการขนม</th>
                        <th className="px-5 py-3 font-medium text-right">ยอดรวม</th>
                        <th className="px-5 py-3 font-medium">วัน-เวลา</th>
                        <th className="px-5 py-3 font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF5FC]">
                      {dashboard.recentOrders.map((o) => (
                        <tr
                          key={o.id}
                          onClick={() => openOrderDetail(o)}
                          className="hover:bg-[#F7FBFF] cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3.5 font-mono font-semibold text-[#2F7CC0] whitespace-nowrap">
                            {o.order_number}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className="font-medium text-[#1C3554]">{o.customer_name}</span>
                          </td>
                          <td className="px-5 py-3.5 text-xs text-[#4C6A8B] max-w-xs truncate">
                            {o.items.map((it) => `${it.product_name} ×${it.quantity}`).join(', ')}
                          </td>
                          <td className="px-5 py-3.5 text-right font-semibold tabular-nums whitespace-nowrap">
                            {o.total.toLocaleString()} ฿
                          </td>
                          <td className="px-5 py-3.5 text-xs font-mono text-[#6B89A8] tabular-nums whitespace-nowrap">
                            {o.created_at}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                ORDER_STATUS_META[o.status].colorClass
                              }`}
                            >
                              {ORDER_STATUS_META[o.status].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: PRODUCTS & STOCK & IMAGES ==================== */}
          {tab === 'products' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[#1C3554]">จัดการเมนูขนม สต็อก และรูปภาพ</h2>
                  <p className="text-xs text-[#567394]">
                    เพิ่ม แก้ไข ลบ เปิด/ปิดการขาย จัดการหลายรูปภาพ และเปิดรับออเดอร์รอบใหม่ได้ทันที
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openAddProductModal}
                  className="px-5 py-2.5 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold flex items-center gap-2 shadow-sm whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  เพิ่มเมนูใหม่
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {products.map((p) => {
                  const stockMeta = STOCK_STATE_META[p.stock_state];
                  const percentLeft =
                    p.capacity > 0 ? Math.min(100, Math.round((p.stock / p.capacity) * 100)) : 0;

                  return (
                    <div
                      key={p.id}
                      className="bakery-card rounded-3xl overflow-hidden flex flex-col justify-between"
                    >
                      <div>
                        <div className="relative aspect-[4/3] bg-[#F2F8FF]">
                          <SafeImage
                            src={p.primary_image}
                            alt={p.name}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setImageManagerProduct(p)}
                            className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white text-[#1C3554] text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-[#3B89CC]" />
                            จัดการรูป ({p.images.length})
                          </button>
                        </div>

                        <div className="p-5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-[#567394]">{p.category}</span>
                            <span className={`font-semibold ${stockMeta.textClass}`}>
                              {stockMeta.emoji} {stockMeta.label}
                            </span>
                          </div>

                          <h3 className="mt-1 text-base font-bold text-[#1C3554]">{p.name}</h3>
                          <p className="mt-1 text-xs text-[#567394] line-clamp-2">{p.description}</p>

                          <p className="mt-3 text-lg font-bold text-[#2F7CC0] tabular-nums">
                            {p.price.toLocaleString()} บาท
                          </p>

                          {/* Stock Metrics */}
                          <div className="mt-3 rounded-2xl bg-[#F5FAFF] border border-[#E2EFFB] p-3 space-y-2">
                            <div className="grid grid-cols-3 gap-1 text-center tabular-nums">
                              <div>
                                <span className="block text-[10px] text-[#6B89A8]">รับออเดอร์</span>
                                <span className="text-xs font-semibold text-[#315072]">
                                  {p.capacity} ชิ้น
                                </span>
                              </div>
                              <div>
                                <span className="block text-[10px] text-[#6B89A8]">ขายแล้ว</span>
                                <span className="text-xs font-semibold text-[#315072]">
                                  {p.sold} ชิ้น
                                </span>
                              </div>
                              <div>
                                <span className="block text-[10px] text-[#6B89A8]">คงเหลือ</span>
                                <span className="text-xs font-bold text-[#1C3554]">
                                  {p.stock} ชิ้น
                                </span>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-[#DFEEFB] overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  p.stock <= 0
                                    ? 'bg-[#E13E59]'
                                    : p.stock_state === 'low'
                                    ? 'bg-[#E59A1A]'
                                    : 'bg-[#3B89CC]'
                                }`}
                                style={{ width: `${percentLeft}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="px-5 pb-5 pt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRestockProduct(p);
                            setRestockMode('add');
                            setRestockQty('20');
                          }}
                          className="flex-1 px-3 py-2 rounded-xl bg-[#E7F4FF] hover:bg-[#D7ECFF] text-[#1D5FA7] text-xs font-semibold whitespace-nowrap cursor-pointer"
                        >
                          เติมสต็อก / รอบใหม่
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleProductStatus(p)}
                          className="px-3 py-2 rounded-xl border border-[#DCECFB] hover:bg-[#F5FAFF] text-[#4C6A8B] text-xs font-medium whitespace-nowrap cursor-pointer"
                        >
                          {p.status === 'active' ? 'ปิดการขาย' : 'เปิดขาย'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditProductModal(p)}
                          className="p-2 rounded-xl border border-[#DCECFB] hover:bg-[#F5FAFF] text-[#2F7CC0] cursor-pointer"
                          title="แก้ไขเมนู"
                          aria-label={`แก้ไข ${p.name}`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDeleteProduct(p)}
                          className="p-2 rounded-xl border border-[#F7D7DF] hover:bg-[#FFF0F3] text-[#C42746] cursor-pointer"
                          title="ลบเมนู"
                          aria-label={`ลบ ${p.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== TAB 3: ORDER MANAGEMENT ==================== */}
          {tab === 'orders' && (
            <div className="space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {(['all', ...ALL_ORDER_STATUSES] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setOrderStatusFilter(st)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                        orderStatusFilter === st
                          ? 'bg-[#3B89CC] text-white'
                          : 'bg-white border border-[#DFEEFB] text-[#4C6A8B] hover:bg-[#EFF7FF]'
                      }`}
                    >
                      {st === 'all' ? 'ทั้งหมด' : ORDER_STATUS_META[st].label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full md:w-64">
                  <Search className="w-4 h-4 text-[#6B89A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="ค้นหาเลขออเดอร์ ชื่อ เบอร์ IG..."
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-white border border-[#D8EAFB] text-xs focus:outline-none focus:border-[#3B89CC]"
                  />
                </div>
              </div>

              <div className="bakery-card rounded-3xl overflow-hidden">
                {orders.length === 0 ? (
                  <div className="p-10 text-center text-sm text-[#567394]">
                    ไม่พบออเดอร์ที่ตรงกับเงื่อนไข
                  </div>
                ) : (
                  <>
                    {/* Mobile Order Card List */}
                    <div className="md:hidden divide-y divide-[#EEF5FC]">
                      {orders.map((o) => (
                        <div
                          key={o.id}
                          onClick={() => openOrderDetail(o)}
                          className={`p-4 space-y-2 cursor-pointer active:bg-[#F3F9FF] ${
                            o.is_read === 0 ? 'bg-[#F0F8FF]' : 'bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-[#2F7CC0]">
                                {o.order_number}
                              </span>
                              {o.is_read === 0 && (
                                <span className="text-[10px] font-semibold text-[#D63653]">ใหม่</span>
                              )}
                            </div>
                            <span
                              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${
                                ORDER_STATUS_META[o.status].colorClass
                              }`}
                            >
                              {ORDER_STATUS_META[o.status].label}
                            </span>
                          </div>

                          <div className="text-xs text-[#1C3554]">
                            <p className="font-semibold">{o.customer_name}</p>
                            <p className="text-[#567394] tabular-nums">
                              {o.customer_phone} · {o.customer_instagram}
                            </p>
                          </div>

                          <p className="text-xs text-[#4C6A8B] line-clamp-2 leading-relaxed">
                            {o.items.map((it) => `${it.product_name} ×${it.quantity}`).join(', ')}
                          </p>

                          <div className="pt-1 flex items-center justify-between text-xs">
                            <span className="font-mono text-[#6B89A8] tabular-nums">
                              {o.created_at}
                            </span>
                            <span className="text-sm font-bold text-[#2F7CC0] tabular-nums">
                              {o.total.toLocaleString()} บาท
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[#F5FAFF] text-xs text-[#567394]">
                          <tr>
                            <th className="px-5 py-3 font-medium">เลขออเดอร์</th>
                            <th className="px-5 py-3 font-medium">ลูกค้า / IG / เบอร์</th>
                            <th className="px-5 py-3 font-medium">รายการสินค้า</th>
                            <th className="px-5 py-3 font-medium text-right">ยอดรวม</th>
                            <th className="px-5 py-3 font-medium">วัน-เวลา</th>
                            <th className="px-5 py-3 font-medium">สถานะ</th>
                            <th className="px-5 py-3 font-medium text-right">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EEF5FC]">
                          {orders.map((o) => (
                            <tr
                              key={o.id}
                              className={`hover:bg-[#F7FBFF] transition-colors ${
                                o.is_read === 0 ? 'bg-[#F0F8FF]' : ''
                              }`}
                            >
                              <td className="px-5 py-3.5 font-mono font-bold text-[#2F7CC0] whitespace-nowrap">
                                {o.order_number}
                                {o.is_read === 0 && (
                                  <span className="ml-2 text-[10px] font-sans text-[#D63653]">ใหม่</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5">
                                <p className="font-semibold text-[#1C3554]">{o.customer_name}</p>
                                <p className="text-xs text-[#567394] tabular-nums">
                                  {o.customer_phone} · {o.customer_instagram}
                                </p>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-[#4C6A8B] max-w-xs">
                                {o.items.map((it) => `${it.product_name} ×${it.quantity}`).join(', ')}
                              </td>
                              <td className="px-5 py-3.5 text-right font-bold tabular-nums whitespace-nowrap">
                                {o.total.toLocaleString()} ฿
                              </td>
                              <td className="px-5 py-3.5 text-xs font-mono text-[#6B89A8] tabular-nums whitespace-nowrap">
                                {o.created_at}
                              </td>
                              <td className="px-5 py-3.5 whitespace-nowrap">
                                <span
                                  className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                    ORDER_STATUS_META[o.status].colorClass
                                  }`}
                                >
                                  {ORDER_STATUS_META[o.status].label}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openOrderDetail(o)}
                                  className="px-3.5 py-1.5 rounded-xl bg-[#E7F4FF] hover:bg-[#D5ECFF] text-[#1D5FA7] text-xs font-semibold cursor-pointer"
                                >
                                  ดูรายละเอียด
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB 4: SALES ANALYTICS ==================== */}
          {tab === 'sales' && (
            <div className="space-y-6">
              {/* Filter Bar + Exports */}
              <div className="bakery-card rounded-3xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end gap-3">
                  <div className="grid grid-cols-2 gap-2.5 sm:flex sm:gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#567394] mb-1">
                        วันที่เริ่มต้น
                      </label>
                      <input
                        type="date"
                        value={salesStart}
                        onChange={(e) => setSalesStart(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#567394] mb-1">
                        วันที่สิ้นสุด
                      </label>
                      <input
                        type="date"
                        value={salesEnd}
                        onChange={(e) => setSalesEnd(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: 'วันนี้', days: 0 },
                      { label: '7 วัน', days: 6 },
                      { label: '30 วัน', days: 29 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setSalesStart(getLocalDateStr(preset.days));
                          setSalesEnd(getLocalDateStr(0));
                        }}
                        className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-[#EFF7FF] hover:bg-[#DFEEFE] text-[#2F7CC0] text-xs font-medium cursor-pointer"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!salesReport}
                    onClick={() => salesReport && exportSalesToExcel(salesReport)}
                    className="px-3.5 py-2.5 rounded-xl bg-[#E4F6EC] hover:bg-[#D2EFDF] text-[#17693B] text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                    Export Excel
                  </button>
                  <button
                    type="button"
                    disabled={!salesReport}
                    onClick={() => salesReport && exportSalesToPdf(salesReport)}
                    className="px-3.5 py-2.5 rounded-xl bg-[#FFF0F3] hover:bg-[#FFE1E8] text-[#B4233C] text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <FileText className="w-4 h-4 shrink-0" />
                    Export PDF
                  </button>
                  <button
                    type="button"
                    onClick={requestSyncToGoogleSheet}
                    className="col-span-2 sm:col-span-1 px-4 py-2.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    Sync Google Sheets
                  </button>
                </div>
              </div>

              {salesReport && (
                <>
                  {/* Auto-calculated revenue cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { label: 'ยอดขายวันนี้', value: salesReport.todaySales },
                      { label: 'ยอดขาย 7 วันล่าสุด', value: salesReport.weeklySales },
                      { label: 'ยอดขายรายเดือน', value: salesReport.monthlySales },
                      { label: 'ยอดขายรวมทั้งหมด', value: salesReport.totalConfirmedSales },
                    ].map((c) => (
                      <div key={c.label} className="bakery-card rounded-2xl p-4 sm:p-5">
                        <p className="text-[11px] sm:text-xs text-[#567394]">{c.label}</p>
                        <p className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold text-[#2F7CC0] tabular-nums">
                          {c.value.toLocaleString()}{' '}
                          <span className="text-xs sm:text-sm font-medium">บาท</span>
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Period Breakdown by Status + Best Sellers */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-6 bakery-card rounded-3xl p-6">
                      <h3 className="text-base font-bold text-[#1C3554]">
                        แยกยอดขายตามสถานะออเดอร์ ({salesReport.startDate} – {salesReport.endDate})
                      </h3>
                      <p className="text-xs text-[#567394] mt-0.5">
                        ยอดขายจริงนับเฉพาะออเดอร์ที่ยืนยันแล้วและไม่ถูกยกเลิก ({salesReport.rangeConfirmedOrdersCount} ออเดอร์ ·{' '}
                        {salesReport.rangeItemsSold} ชิ้น)
                      </p>

                      <div className="mt-4 divide-y divide-[#EEF5FC]">
                        {salesReport.byStatus.map((row) => (
                          <div key={row.status} className="py-3 flex items-center justify-between text-sm">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                ORDER_STATUS_META[row.status].colorClass
                              }`}
                            >
                              {ORDER_STATUS_META[row.status].label}
                            </span>
                            <div className="text-right tabular-nums">
                              <span className="text-xs text-[#567394] mr-4">{row.count} ออเดอร์</span>
                              <span className="font-bold text-[#1C3554]">
                                {row.revenue.toLocaleString()} บาท
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-6 bakery-card rounded-3xl p-6">
                      <h3 className="text-base font-bold text-[#1C3554]">
                        เมนูขายดีที่สุดในช่วงวันที่เลือก
                      </h3>
                      <p className="text-xs text-[#567394] mt-0.5">
                        คำนวณจากออเดอร์ที่ยืนยันแล้วจริง
                      </p>

                      <div className="mt-4 space-y-3">
                        {salesReport.bestSellers.length === 0 ? (
                          <p className="text-sm text-[#6B89A8] py-8 text-center">
                            ยังไม่มีออเดอร์ที่ยืนยันแล้วในช่วงวันที่เลือก
                          </p>
                        ) : (
                          salesReport.bestSellers.map((b, i) => (
                            <div
                              key={b.product_name}
                              className="flex items-center justify-between gap-3 py-2 border-b border-[#F0F6FC] last:border-0"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-mono text-xs font-bold text-[#3B89CC] w-6">
                                  #{i + 1}
                                </span>
                                <span className="text-sm font-semibold text-[#1C3554] truncate">
                                  {b.product_name}
                                </span>
                              </div>
                              <div className="text-right tabular-nums shrink-0 text-xs">
                                <span className="text-[#567394] mr-3">{b.units_sold} ชิ้น</span>
                                <span className="font-bold text-[#2F7CC0]">
                                  {b.revenue.toLocaleString()} บาท
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ==================== TAB 5: SETTINGS & GOOGLE WORKSPACE ==================== */}
          {tab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
              {/* Left Column: Store Logo + Shipping Settings */}
              <div className="lg:col-span-5 space-y-5">
                {/* Store Logo Management Card */}
                <div className="bakery-card rounded-3xl p-4 sm:p-6 space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-[#1C3554]">โลโก้ร้าน (Store Logo)</h2>
                    <p className="text-xs text-[#567394] leading-relaxed">
                      เพิ่ม เปลี่ยน หรือลบโลโก้ร้าน เพื่อแสดงที่แถบด้านบนของหน้าร้านลูกค้าและหลังบ้าน
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#F2F8FF] border border-[#DCECFB] overflow-hidden flex items-center justify-center shrink-0">
                      {settings.store_logo_url ? (
                        <SafeImage
                          src={settings.store_logo_url}
                          alt="โลโก้ร้าน Bibi's Treats"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="w-7 h-7 text-[#8BBBE5]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-xs font-semibold text-[#1C3554]">
                        {settings.store_logo_url ? 'ใช้งานโลโก้ร้านอยู่' : 'ยังไม่ได้ตั้งค่าโลโก้ร้าน'}
                      </p>
                      <p className="text-[11px] text-[#567394] leading-snug">
                        รองรับ JPG, PNG, WEBP ขนาดไม่เกิน 5MB (แนะนำรูปสี่เหลี่ยมจัตุรัส)
                      </p>
                    </div>
                  </div>

                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleLogoFileChange}
                    className="hidden"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={logoUploading}
                      onClick={() => logoInputRef.current?.click()}
                      className="flex-1 min-w-[140px] h-10 px-4 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {logoUploading
                          ? 'กำลังอัปโหลด...'
                          : settings.store_logo_url
                          ? 'เปลี่ยนโลโก้ร้าน'
                          : 'เพิ่มโลโก้ร้าน'}
                      </span>
                    </button>

                    {settings.store_logo_url && (
                      <button
                        type="button"
                        disabled={logoUploading}
                        onClick={requestDeleteStoreLogo}
                        className="h-10 px-3.5 rounded-xl bg-[#FFF3F6] hover:bg-[#FFE3EA] text-[#C42746] border border-[#F9C6D3] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>ลบโลโก้</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Store Shipping Settings */}
                <form
                  onSubmit={handleSaveSettings}
                  className="bakery-card rounded-3xl p-4 sm:p-6 space-y-4 sm:space-y-5"
                >
                  <div>
                    <h2 className="text-base font-bold text-[#1C3554]">ตั้งค่าการจัดส่งและหน้าร้าน</h2>
                    <p className="text-xs text-[#567394] leading-relaxed">
                      กำหนดรูปแบบค่าจัดส่งที่แสดงในหน้าตะกร้าและหน้ายืนยันออเดอร์
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                        รูปแบบค่าจัดส่ง
                      </label>
                      <select
                        value={settings.shipping_mode}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            shipping_mode: e.target.value === 'pending' ? 'pending' : 'fixed',
                          }))
                        }
                        className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm"
                      >
                        <option value="fixed">กำหนดค่าจัดส่งคงที่ (คำนวณอัตโนมัติ)</option>
                        <option value="pending">แสดงเป็น &ldquo;รอยืนยัน&rdquo; (แจ้งค่าส่งภายหลัง)</option>
                      </select>
                    </div>

                    {settings.shipping_mode === 'fixed' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                            ค่าจัดส่ง (บาท)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={settings.shipping_fee}
                            onChange={(e) =>
                              setSettings((s) => ({ ...s, shipping_fee: Number(e.target.value) }))
                            }
                            className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                            ส่งฟรีเมื่อสั่งครบ (บาท) — ใส่ 0 หากไม่มีโปรส่งฟรี
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={settings.free_shipping_threshold}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                free_shipping_threshold: Number(e.target.value),
                              }))
                            }
                            className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-[#2A496B] mb-1.5">
                        Google Spreadsheet ID (ไม่บังคับ — สร้างใหม่ได้ด้านล่าง)
                      </label>
                      <input
                        type="text"
                        value={sheetIdInput}
                        onChange={(e) => setSheetIdInput(e.target.value)}
                        placeholder="เช่น 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                        className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-xs font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className="w-full h-11 rounded-2xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {settingsSaving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าร้าน'}
                  </button>
                </form>
              </div>

              {/* Google Workspace (Google Drive & Google Sheets) Panel */}
              <div className="lg:col-span-7 space-y-5">
                <div className="bakery-card rounded-3xl p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#E5F3FF] text-[#2F7CC0] flex items-center justify-center shrink-0">
                        <Cloud className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm sm:text-base font-bold text-[#1C3554] leading-snug">
                          Google Drive & Google Sheets
                        </h2>
                        <p className="text-xs text-[#567394] leading-relaxed">
                          สำรองรูปภาพขนมขึ้น Google Drive และซิงก์ออเดอร์ไปยัง Google Sheets
                        </p>
                      </div>
                    </div>

                    {wsNeedsAuth ? (
                      <div className="shrink-0">
                        <GoogleSignInButton
                          onClick={handleWorkspaceSignIn}
                          disabled={wsBusy}
                          label="Sign in with Google"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span className="text-xs font-medium text-[#17693B] flex items-center gap-1 break-all">
                          <Check className="w-4 h-4 shrink-0" />
                          {wsUser?.email}
                        </span>
                        <button
                          type="button"
                          onClick={handleWorkspaceSignOut}
                          className="px-3 py-1.5 rounded-xl border border-[#DCECFB] text-xs text-[#567394] hover:bg-[#FFF0F3] hover:text-[#C42746] cursor-pointer whitespace-nowrap"
                        >
                          ออกจาก Google
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Google Sheets Sync Block */}
                  <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-[#EAF3FC]">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#1C3554] flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-[#1E8E3E] shrink-0" />
                          <span>Google Sheets — ซิงก์ออเดอร์และยอดขาย</span>
                        </h3>
                        <p className="text-xs text-[#567394] mt-1 break-all leading-relaxed">
                          {settings.google_sheet_id
                            ? `เชื่อมกับ Sheet ID: ${settings.google_sheet_id}`
                            : 'ยังไม่ได้เชื่อม Google Sheet กดสร้างใหม่ได้ทันที'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {settings.google_sheet_url && (
                          <a
                            href={settings.google_sheet_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3.5 py-2 rounded-xl bg-[#F3F9FF] text-[#2F7CC0] text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
                          >
                            เปิด Sheet
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={wsNeedsAuth || wsBusy}
                          onClick={requestCreateGoogleSheet}
                          className="px-3.5 py-2 rounded-xl border border-[#CFE6FA] hover:bg-[#EFF7FF] text-[#1D5FA7] text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          สร้าง Sheet ใหม่
                        </button>
                        <button
                          type="button"
                          disabled={wsNeedsAuth || wsBusy}
                          onClick={requestSyncToGoogleSheet}
                          className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          ซิงก์ออเดอร์ทั้งหมดลง Sheets
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Google Drive Photos Block */}
                  <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-[#EAF3FC]">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#1C3554] flex items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-[#3B89CC] shrink-0" />
                          <span>Google Drive — โฟลเดอร์รูปภาพสินค้า</span>
                        </h3>
                        <p className="text-xs text-[#567394] mt-1 leading-relaxed">
                          สำรองรูปภาพขนมทั้งหมดขึ้นโฟลเดอร์ Bibi&apos;s Treats Photos บน Google Drive
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={wsNeedsAuth || wsBusy}
                          onClick={handleRefreshDriveFiles}
                          className="px-3.5 py-2 rounded-xl border border-[#CFE6FA] hover:bg-[#EFF7FF] text-[#1D5FA7] text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          โหลดไฟล์ใน Drive
                        </button>
                        <button
                          type="button"
                          disabled={wsNeedsAuth || wsBusy}
                          onClick={requestBatchBackupPhotosToDrive}
                          className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          <CloudUpload className="w-3.5 h-3.5 shrink-0" />
                          <span>สำรองรูปสินค้าทั้งหมดขึ้น Drive</span>
                        </button>
                      </div>
                    </div>

                    {driveFiles.length > 0 && (
                      <div className="mt-4 divide-y divide-[#EEF5FC] rounded-2xl border border-[#E5F1FC] overflow-hidden">
                        {driveFiles.map((f) => (
                          <div
                            key={f.id}
                            className="px-3.5 sm:px-4 py-2.5 bg-white flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-[#1C3554] truncate">{f.name}</p>
                              <p className="text-[11px] text-[#6B89A8] font-mono">
                                {f.createdTime ? f.createdTime.slice(0, 10) : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {f.webViewLink && (
                                <a
                                  href={f.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2F7CC0] hover:underline flex items-center gap-1 whitespace-nowrap"
                                >
                                  เปิดดู
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => requestDeleteDriveFile(f)}
                                className="p-1.5 rounded-lg text-[#C42746] hover:bg-[#FFF0F3] cursor-pointer"
                                aria-label={`ลบ ${f.name} จาก Drive`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== ADD / EDIT PRODUCT MODAL ==================== */}
      {productModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C3554]/45 backdrop-blur-[2px] p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveProduct}
            className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white border border-[#DCECFB] shadow-2xl overflow-hidden"
          >
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#F7FBFF] border-b border-[#E5F1FC] flex items-center justify-between gap-2">
              <h3 className="text-base sm:text-lg font-bold text-[#1C3554] truncate">
                {editingProduct ? `แก้ไขเมนู: ${editingProduct.name}` : '＋ เพิ่มเมนูขนมใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="p-2 rounded-xl text-[#567394] hover:bg-[#E7F3FF] shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#2A496B] mb-1">
                  ชื่อสินค้า *
                </label>
                <input
                  type="text"
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="เช่น Chocolate Brownie"
                  className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#2A496B] mb-1">
                  รายละเอียดสินค้า
                </label>
                <textarea
                  rows={2}
                  value={prodDesc}
                  onChange={(e) => setProdDesc(e.target.value)}
                  placeholder="บรรยายรสชาติและจุดเด่นของขนม..."
                  className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#2A496B] mb-1">
                    ราคา (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#2A496B] mb-1">
                    จำนวนที่เปิดรับ *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={prodCapacity}
                    onChange={(e) => {
                      setProdCapacity(e.target.value);
                      if (!editingProduct) setProdStock(e.target.value);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#2A496B] mb-1">
                    จำนวนคงเหลือ *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={prodStock}
                    onChange={(e) => setProdStock(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#2A496B] mb-1">หมวดหมู่</label>
                  <input
                    type="text"
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value)}
                    placeholder="เช่น บราวนี่ & เค้ก, คุกกี้, คัพเค้ก"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#2A496B] mb-1">
                    สถานะการขาย
                  </label>
                  <select
                    value={prodStatus}
                    onChange={(e) =>
                      setProdStatus(e.target.value === 'inactive' ? 'inactive' : 'active')
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm"
                  >
                    <option value="active">เปิดขายหน้าร้าน</option>
                    <option value="inactive">ปิดการขายชั่วคราว</option>
                  </select>
                </div>
              </div>

              {!editingProduct && (
                <div className="rounded-2xl border border-dashed border-[#A7D3F7] bg-[#F5FAFF] p-3.5 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <p className="text-xs font-semibold text-[#1C3554]">รูปภาพสินค้า (เพิ่มได้หลายรูป)</p>
                      <p className="text-[11px] text-[#567394]">รองรับ JPG, JPEG, PNG, WEBP</p>
                    </div>
                    <input
                      ref={initialFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = '';
                        const next = files.map((file) => ({
                          file,
                          preview: URL.createObjectURL(file),
                        }));
                        setProdInitialFiles((prev) => [...prev, ...next]);
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => initialFileInputRef.current?.click()}
                      className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-white border border-[#CFE6FA] text-xs font-semibold text-[#2F7CC0] cursor-pointer"
                    >
                      เลือกรูปภาพ
                    </button>
                  </div>

                  {prodInitialFiles.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {prodInitialFiles.map((item, idx) => (
                        <div key={idx} className="relative aspect-[4/3] rounded-xl overflow-hidden">
                          <img src={item.preview} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              URL.revokeObjectURL(item.preview);
                              setProdInitialFiles((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-[#1C3554]/75 text-white flex items-center justify-center"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-t border-[#E5F1FC] bg-[#F9FCFF] flex justify-end gap-2.5 sm:gap-3 pb-safe">
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-[#EFF7FF] text-[#4C6A8B] text-sm font-medium cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={savingProduct}
                className="px-5 py-2.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
              >
                {savingProduct ? 'กำลังบันทึก...' : 'บันทึกเมนู'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== RESTOCK / NEW BATCH MODAL ==================== */}
      {restockProduct && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C3554]/45 backdrop-blur-[2px] p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleRestockSubmit}
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white border border-[#DCECFB] shadow-2xl p-5 sm:p-6 space-y-4 pb-safe"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-[#1C3554] truncate">
                จัดการสต็อก: {restockProduct.name}
              </h3>
              <button
                type="button"
                onClick={() => setRestockProduct(null)}
                className="p-1.5 rounded-xl text-[#567394] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#F5FAFF] p-3 grid grid-cols-3 gap-1 text-center tabular-nums">
              <div>
                <span className="block text-[10px] text-[#6B89A8]">รับออเดอร์</span>
                <span className="text-xs font-semibold text-[#315072]">{restockProduct.capacity}</span>
              </div>
              <div>
                <span className="block text-[10px] text-[#6B89A8]">ขายแล้ว</span>
                <span className="text-xs font-semibold text-[#315072]">{restockProduct.sold}</span>
              </div>
              <div>
                <span className="block text-[10px] text-[#6B89A8]">คงเหลือ</span>
                <span className="text-xs font-bold text-[#2F7CC0]">{restockProduct.stock}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestockMode('add')}
                className={`p-3 rounded-2xl border text-xs font-semibold text-left cursor-pointer ${
                  restockMode === 'add'
                    ? 'border-[#3B89CC] bg-[#EAF5FF] text-[#1D5FA7]'
                    : 'border-[#DCECFB] text-[#567394]'
                }`}
              >
                เติมสต็อกเพิ่ม
                <span className="block font-normal mt-0.5 text-[11px] leading-snug">
                  บวกเพิ่มจากยอดเดิม
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRestockMode('new_round')}
                className={`p-3 rounded-2xl border text-xs font-semibold text-left cursor-pointer ${
                  restockMode === 'new_round'
                    ? 'border-[#3B89CC] bg-[#EAF5FF] text-[#1D5FA7]'
                    : 'border-[#DCECFB] text-[#567394]'
                }`}
              >
                เปิดรับรอบใหม่
                <span className="block font-normal mt-0.5 text-[11px] leading-snug">
                  รีเซ็ตจำนวนรับรอบนี้
                </span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#2A496B] mb-1">
                {restockMode === 'add' ? 'จำนวนที่ต้องการเพิ่ม (ชิ้น)' : 'จำนวนที่เปิดรับรอบใหม่ (ชิ้น)'}
              </label>
              <input
                type="number"
                required
                min={1}
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-[#F8FBFF] border border-[#D4E8FA] text-base sm:text-sm tabular-nums"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestockProduct(null)}
                className="px-4 py-2.5 rounded-xl bg-[#EFF7FF] text-xs font-medium text-[#4C6A8B]"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[#3B89CC] hover:bg-[#2E76B6] text-white text-xs font-semibold cursor-pointer"
              >
                บันทึกจำนวนสินค้า
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== ORDER DETAIL MODAL ==================== */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1C3554]/45 backdrop-blur-[2px] p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white border border-[#DCECFB] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#F7FBFF] border-b border-[#E5F1FC] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs text-[#567394] font-mono">{selectedOrder.created_at}</p>
                <h3 className="text-base sm:text-lg font-bold text-[#1C3554] font-mono truncate">
                  Order {selectedOrder.order_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-2 rounded-xl text-[#567394] hover:bg-[#E7F3FF] shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5 pb-safe">
              {/* Customer Info */}
              <div className="rounded-2xl bg-[#F5FAFF] border border-[#E1EFFB] p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] sm:text-xs text-[#567394]">ชื่อลูกค้า</p>
                  <p className="font-semibold text-[#1C3554]">{selectedOrder.customer_name}</p>
                </div>
                <div>
                  <p className="text-[11px] sm:text-xs text-[#567394]">เบอร์โทรศัพท์ / Instagram</p>
                  <p className="font-medium text-[#1C3554] tabular-nums break-words">
                    {selectedOrder.customer_phone} · {selectedOrder.customer_instagram}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] sm:text-xs text-[#567394]">ที่อยู่จัดส่ง</p>
                  <p className="text-[#1C3554] leading-relaxed">{selectedOrder.customer_address}</p>
                </div>
                {selectedOrder.note && (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] sm:text-xs text-[#567394]">หมายเหตุจากลูกค้า</p>
                    <p className="text-[#2F7CC0] font-medium leading-relaxed">{selectedOrder.note}</p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <h4 className="text-xs font-semibold text-[#567394] mb-2">รายการสินค้า</h4>
                <div className="divide-y divide-[#EEF5FC] border border-[#E6F1FC] rounded-2xl overflow-hidden">
                  {selectedOrder.items.map((it) => (
                    <div key={it.id} className="px-3.5 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#1C3554] leading-snug">{it.product_name}</p>
                        <p className="text-xs text-[#567394] tabular-nums">
                          {it.quantity} ชิ้น × {it.price.toLocaleString()} บาท
                        </p>
                      </div>
                      <span className="font-bold tabular-nums shrink-0 whitespace-nowrap">
                        {it.subtotal.toLocaleString()} ฿
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shipping Fee + Totals */}
              <div className="rounded-2xl border border-[#E6F1FC] p-3.5 sm:p-4 space-y-2.5 text-sm">
                <div className="flex justify-between text-[#567394]">
                  <span>ยอดสินค้า</span>
                  <span className="tabular-nums">{selectedOrder.subtotal.toLocaleString()} บาท</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#567394]">ค่าจัดส่ง (แก้ไขได้)</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={0}
                      value={shippingFeeDraft}
                      onChange={(e) => setShippingFeeDraft(e.target.value)}
                      placeholder="รอยืนยัน"
                      className="w-24 px-2.5 py-1.5 rounded-lg border border-[#D4E8FA] text-right text-base sm:text-xs tabular-nums"
                    />
                    <span className="text-xs text-[#567394]">บาท</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#EEF5FC] flex justify-between items-baseline text-sm sm:text-base font-bold">
                  <span>ยอดรวมสุทธิ</span>
                  <span className="text-base sm:text-lg text-[#2F7CC0] tabular-nums">
                    {selectedOrder.total.toLocaleString()} บาท
                  </span>
                </div>
              </div>

              {/* Status Controls */}
              <div>
                <h4 className="text-xs font-semibold text-[#567394] mb-2">อัปเดตสถานะออเดอร์</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ALL_ORDER_STATUSES.map((st) => {
                    const isCurrent = selectedOrder.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => applyOrderStatusChange(selectedOrder, st)}
                        className={`px-2.5 sm:px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border leading-snug ${
                          isCurrent
                            ? 'bg-[#3B89CC] text-white border-[#3B89CC]'
                            : st === 'cancelled'
                            ? 'bg-[#FFF5F7] text-[#B4233C] border-[#FAD5DF] hover:bg-[#FFE6EC]'
                            : 'bg-white text-[#1C3554] border-[#DCECFB] hover:bg-[#EFF7FF]'
                        }`}
                      >
                        {ORDER_STATUS_META[st].label}
                      </button>
                    );
                  })}
                </div>
                {selectedOrder.stock_restored === 1 && (
                  <p className="mt-2 text-xs text-[#B45309]">
                    * ออเดอร์นี้คืนสต็อกสินค้ากลับเข้าคลังแล้ว
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== IMAGE MANAGER MODAL ==================== */}
      <AdminImageManagerModal
        product={imageManagerProduct}
        driveFolderId={settings.google_drive_folder_id || ''}
        onSaveDriveFolderId={async (folderId) => {
          const updated = await updateAdminSettings({ google_drive_folder_id: folderId });
          setSettings(updated);
        }}
        onProductUpdated={(updated) => {
          setImageManagerProduct(updated);
          setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
        onClose={() => setImageManagerProduct(null)}
      />

      {/* ==================== CONFIRM DIALOG ==================== */}
      {confirmDialog && (
        <ConfirmDialog
          open={true}
          title={confirmDialog.title}
          description={confirmDialog.description}
          details={confirmDialog.details}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          busy={confirmBusy}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => !confirmBusy && setConfirmDialog(null)}
        />
      )}
    </div>
  );
};
